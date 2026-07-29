"""Preenchedor da Proposta de Adesao e da Ficha de Inclusao da Saude Beneficencia.

Projeto INDEPENDENTE do JOB: nao importa nada do ERP, nao usa o banco dele e sobe como
servico proprio no Railway. A unica coisa em comum e o repositorio.

Local:      python3 app.py            -> http://localhost:5057
Producao:   gunicorn app:app          (ver Procfile)

Variaveis de ambiente em producao:
    SENHA_ACESSO   senha unica de entrada (obrigatoria fora do localhost)
    SECRET_KEY     chave de sessao (se ausente, e gerada e as sessoes caem a cada deploy)
"""
import io
import json
import os
import re
import secrets
import urllib.error
import urllib.request
import zipfile
from functools import wraps

from flask import (Flask, jsonify, redirect, render_template, request, send_file,
                   session, url_for)

import leitor
import carta
import montagem
import motor
import regras
import contas
import propostas
import registro
from parser import parse_bloco_notas

app = Flask(__name__)
registro.iniciar()
contas.iniciar()
propostas.iniciar()
app.secret_key = os.environ.get('SECRET_KEY') or secrets.token_hex(32)

SENHA_ACESSO = os.environ.get('SENHA_ACESSO', '')
EXIGE_SENHA = bool(SENHA_ACESSO)

# Railway (e qualquer PaaS) injeta PORT. Se estamos hospedados e ninguem definiu a senha,
# o app NAO pode simplesmente abrir: ele gera documento com CPF, RG e dado de saude.
# Falha fechado - responde 503 em tudo ate a variavel existir.
#
# DEV_LOCAL desliga essa trava. Existe porque PORT sozinho e um sinal ruim de "estou
# em producao": ferramenta de preview local tambem injeta PORT, e a maquina do
# desenvolvedor caia em 503 sem motivo. Quem define DEV_LOCAL no PaaS e o dono do
# projeto, entao a trava continua servindo para o que foi feita: impedir que um
# deploy esquecido suba aberto na internet.
HOSPEDADO = bool(os.environ.get('PORT')) and not os.environ.get('DEV_LOCAL')
SEM_SENHA_EM_PRODUCAO = HOSPEDADO and not SENHA_ACESSO

SOMENTE_DIGITOS = re.compile(r'\D')


@app.before_request
def _bloqueia_sem_senha():
    """Trava tudo se o app foi hospedado sem SENHA_ACESSO configurada."""
    if SEM_SENHA_EM_PRODUCAO:
        return ('Configuracao incompleta: defina a variavel de ambiente SENHA_ACESSO '
                'antes de usar esta ferramenta. Ela gera documentos com dados pessoais '
                'e nao funciona sem controle de acesso.'), 503


def usuario_atual():
    """Quem esta logado, ou None. Le do banco a cada requisicao de proposito: assim
    desativar alguem ou mudar o papel vale na hora, sem esperar a sessao expirar."""
    uid = session.get('usuario_id')
    return contas.por_id(uid) if uid else None


def login_obrigatorio(f):
    """Os documentos gerados tem CPF, RG e dado de saude. Na internet aberta, nenhuma
    rota pode responder sem sessao."""
    @wraps(f)
    def wrapper(*a, **kw):
        if not usuario_atual():
            if request.path.startswith('/api/'):
                return jsonify({'erro': 'Sessão expirada. Entre de novo.'}), 401
            return redirect(url_for('login'))
        return f(*a, **kw)
    return wrapper


def gestor_obrigatorio(f):
    """Aprovar, devolver para correcao e mexer em usuario e so do gestor. A checagem
    fica no servidor: esconder o botao na tela nao impede ninguem de chamar a rota."""
    @wraps(f)
    def wrapper(*a, **kw):
        u = usuario_atual()
        if not u:
            return redirect(url_for('login'))
        if u.get('papel') != 'gestor':
            if request.path.startswith('/api/'):
                return jsonify({'erro': 'Só um gestor pode fazer isso.'}), 403
            return 'Só um gestor pode abrir esta página.', 403
        return f(*a, **kw)
    return wrapper


@app.context_processor
def _injeta_usuario():
    return {'usuario': usuario_atual()}


@app.route('/login', methods=['GET', 'POST'])
def login():
    erro = ''
    if request.method == 'POST':
        u = contas.autenticar(request.form.get('login', ''), request.form.get('senha', ''))
        if u:
            session.clear()
            session['usuario_id'] = u['id']
            if u.get('trocar_senha'):
                return redirect(url_for('minha_senha'))
            return redirect(url_for('index'))
        # Mensagem unica de proposito: dizer "usuario nao existe" entrega quais logins
        # sao validos para quem esta tentando adivinhar.
        erro = 'Login ou senha incorretos.'
    return render_template('login.html', erro=erro)


@app.route('/minha-senha', methods=['GET', 'POST'])
@login_obrigatorio
def minha_senha():
    u = usuario_atual()
    erro = feito = ''
    if request.method == 'POST':
        nova = request.form.get('nova', '')
        if nova != request.form.get('confirma', ''):
            erro = 'As duas senhas não são iguais.'
        else:
            erro = contas.trocar_senha(u['id'], nova) or ''
            if not erro:
                feito = 'Senha trocada.'
    return render_template('senha.html', erro=erro, feito=feito,
                           obrigatorio=bool(u.get('trocar_senha')))


@app.route('/sair')
def sair():
    session.clear()
    return redirect(url_for('login'))


@app.route('/')
@login_obrigatorio
def index():
    """Com ?id= abre uma proposta existente para corrigir, em vez de comecar do zero."""
    pid = (request.args.get('id') or '').strip()
    proposta = propostas.obter(pid) if pid else None
    return render_template('index.html', agente=motor.AGENTE, planos=motor.PLANOS,
                           exige_senha=EXIGE_SENHA, ia_disponivel=leitor.disponivel(),
                           proposta=proposta, pagina='proposta')


@app.route('/api/cnpj/<cnpj>')
@login_obrigatorio
def api_cnpj(cnpj):
    """Proxy para a BrasilAPI (evita bloqueio de CORS no navegador)."""
    digitos = SOMENTE_DIGITOS.sub('', cnpj)
    if len(digitos) != 14:
        return jsonify({'erro': 'CNPJ precisa ter 14 digitos'}), 400
    url = f'https://brasilapi.com.br/api/cnpj/v1/{digitos}'
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; PropostaSaudeBeneficencia/1.0)'})
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            dados = json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return jsonify({'erro': f'CNPJ nao encontrado ou API indisponivel ({e.code})'}), 502
    except Exception as e:
        return jsonify({'erro': f'Falha ao consultar CNPJ: {e}'}), 502

    socios = dados.get('qsa') or []
    responsavel = None
    for s in socios:
        qual = (s.get('qualificacao_socio') or '').upper()
        if 'ADMINISTRADOR' in qual or 'TITULAR' in qual:
            responsavel = s
            break
    if not responsavel and socios:
        responsavel = socios[0]

    # Empresario individual e MEI nao tem quadro societario: a Receita devolve qsa
    # vazio e poe o nome da pessoa DENTRO da razao social, no formato
    # "52.725.505 LEANDRO GAMA PIMENTEL". Sem tratar isso, a tela ficava sem nenhum
    # representante legal para clicar - e boa parte da carteira e MEI.
    razao = dados.get('razao_social', '') or ''
    if not socios:
        nome_titular = re.sub(r'^[\d./\-\s]+', '', razao).strip()
        if nome_titular and nome_titular != razao.strip():
            socios = [{'nome_socio': nome_titular,
                       'qualificacao_socio': 'Empresário individual'}]
            responsavel = socios[0]

    # A Receita as vezes devolve o registro sem logradouro/numero. Nao e falha da
    # consulta - o dado nao esta la. Avisar e melhor do que deixar o campo vazio e o
    # corretor descobrir na hora que a operadora recusar por endereco incompleto.
    faltando = [r for r, v in (('endereço', dados.get('logradouro')),
                               ('número', dados.get('numero'))) if not (v or '').strip()]

    return jsonify({
        'razao_social': dados.get('razao_social', ''),
        'nome_fantasia': dados.get('nome_fantasia', ''),
        'endereco': dados.get('logradouro', ''),
        'numero': dados.get('numero', ''),
        'complemento': dados.get('complemento', ''),
        'bairro': dados.get('bairro', ''),
        'cidade': dados.get('municipio', ''),
        'uf': dados.get('uf', ''),
        'cep': dados.get('cep', ''),
        'telefone': dados.get('ddd_telefone_1', ''),
        'email': (dados.get('email') or '').lower(),
        'cnpj': dados.get('cnpj', digitos),
        'socios': [{'nome': s.get('nome_socio', ''), 'qualificacao': s.get('qualificacao_socio', '')} for s in socios],
        'responsavel_sugerido': responsavel.get('nome_socio') if responsavel else '',
        'aviso': ('A Receita não tem ' + ' nem '.join(faltando) + ' neste CNPJ — '
                  'preencha à mão.') if faltando else '',
    })


@app.route('/api/parse-notas', methods=['POST'])
@login_obrigatorio
def api_parse_notas():
    texto = (request.get_json(force=True) or {}).get('texto', '')
    return jsonify(parse_bloco_notas(texto))


@app.route('/api/carta', methods=['POST'])
@login_obrigatorio
def api_carta():
    """Devolve so a carta de cancelamento, para o cliente assinar.

    Sai antes do contrato de proposito: o que vale na capa e o papel assinado, e a
    assinatura tem que acontecer entre gerar o modelo e montar o pacote."""
    dados = request.get_json(force=True) or {}
    try:
        pdf = carta.gerar(dados)
    except Exception:
        app.logger.exception('falha ao gerar a carta')
        return jsonify({'erro': 'Não foi possível gerar a carta.'}), 500
    if not pdf:
        return jsonify({'erro': 'Informe o titular do contrato anterior — é quem assina.'}), 400

    nome = (dados.get('contrato_anterior') or {}).get('titular', {}).get('nome', 'carta')
    limpo = re.sub(r'[^A-Za-z0-9]+', '_', nome).strip('_').upper() or 'CARTA'
    return send_file(io.BytesIO(pdf), mimetype='application/pdf', as_attachment=True,
                     download_name=f'CARTA_CANCELAMENTO_{limpo}.pdf')


@app.route('/api/gerar', methods=['POST'])
@login_obrigatorio
def api_gerar():
    """Gera os PDFs em memoria e devolve um ZIP direto ao navegador.

    Nada e gravado em disco: o container do Railway e efemero e, mais importante, nao
    faz sentido deixar documento com CPF/RG parado no servidor depois do download."""
    dados = request.get_json(force=True)
    try:
        pdfs = motor.gerar_tudo_memoria(dados)
    except ValueError as e:
        return jsonify({'erro': str(e)}), 400
    except Exception:
        app.logger.exception('falha ao gerar PDFs')
        return jsonify({'erro': 'Nao foi possivel gerar os documentos. Confira os dados e tente de novo.'}), 500

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for nome, conteudo in pdfs:
            z.writestr(nome, conteudo)
    buf.seek(0)

    prefixo = pdfs[0][0].rsplit('_Proposta.pdf', 1)[0] if pdfs else 'proposta'
    return send_file(buf, mimetype='application/zip', as_attachment=True,
                     download_name=f'{prefixo}_Adesao.zip')


@app.route('/api/checklist', methods=['POST'])
@login_obrigatorio
def api_checklist():
    """Diz quais documentos ESTE caso exige. A tela usa para montar os campos de
    upload - assim a lista vive so em regras.py e nunca sai de sincronia."""
    d = request.get_json(force=True) or {}
    try:
        return jsonify(regras.checklist(
            d.get('tipo_titular') or 'socio',
            d.get('parentescos') or [],
            bool(d.get('crianca_sem_documento')),
            bool(d.get('filho_em_comum')),
            bool(d.get('tem_portabilidade')),
            bool(d.get('tem_migracao')),
        ))
    except ValueError as e:
        return jsonify({'erro': str(e)}), 400


@app.route('/api/ler-documentos', methods=['POST'])
@login_obrigatorio
def api_ler_documentos():
    """Le os documentos enviados e devolve o bloco de notas ja preenchido.

    Sao os MESMOS arquivos que vao montar o contrato - o corretor sobe uma vez so.

    As mensagens devolvidas ao navegador sao deliberadamente genericas: nao citam
    fornecedor, nome de variavel nem provedor de hospedagem. Quem opera o sistema nao
    precisa saber como ele foi montado, e quem nao opera nao deve descobrir pela tela.
    O detalhe real do erro vai para o log do servidor."""
    if not leitor.disponivel():
        return jsonify({'erro': 'Leitura automática indisponível neste ambiente. '
                                'Anexe os documentos campo a campo.',
                        'sem_chave': True}), 503

    # 'arquivo' e a area onde o corretor solta a pasta inteira de uma vez. A ordem
    # do getlist e a mesma da tela, e e ela que amarra a classificacao de volta ao
    # arquivo certo (leitor.ler devolve indice 1-based nessa ordem).
    arquivos = [(f.filename, f.read()) for f in request.files.getlist('arquivo')
                if f and f.filename]
    if not arquivos:
        # Compatibilidade com o fluxo antigo, campo por campo.
        for chave in request.files:
            if chave.startswith(('doc_', 'comprovante_endereco', 'certidao_')):
                arquivos += [(f.filename, f.read()) for f in request.files.getlist(chave)
                             if f and f.filename]
    if not arquivos:
        return jsonify({'erro': 'Envie ao menos um documento.'}), 400

    try:
        dados = leitor.ler(arquivos)
    except leitor.SemChave:
        return jsonify({'erro': 'Leitura automática indisponível neste ambiente. '
                                'Anexe os documentos campo a campo.',
                        'sem_chave': True}), 503
    except Exception as e:
        # O texto cru identifica o provedor e nao ajuda quem esta na tela. Vai inteiro
        # para o log do servidor; o navegador recebe so a acao possivel. 'codigo' e uma
        # etiqueta interna para o suporte cruzar com o log sem expor nada.
        app.logger.exception('falha ao ler documentos')
        texto = str(e).lower()
        if 'authentication' in texto or 'api-key' in texto or 'unauthorized' in texto:
            amigavel, codigo = ('Leitura automática temporariamente indisponível. '
                                'Anexe os documentos campo a campo.', 'L-01')
        elif 'credit' in texto or 'quota' in texto or 'billing' in texto:
            amigavel, codigo = ('Limite de processamento atingido. Anexe os documentos '
                                'campo a campo.', 'L-02')
        elif 'rate' in texto or 'overloaded' in texto or 'timeout' in texto:
            amigavel, codigo = ('Serviço ocupado. Tente de novo em alguns segundos.', 'L-03')
        else:
            amigavel, codigo = ('Não foi possível ler os documentos. Confira se as fotos '
                                'estão legíveis e tente de novo.', 'L-09')
        return jsonify({'erro': amigavel, 'codigo': codigo}), 502

    registro.gravar_leitura(dados.get('_uso') or {})
    dados['bloco_notas'] = leitor.para_bloco_notas(dados)
    # O navegador nao precisa saber qual motor leu os documentos, nem em que unidade
    # ele cobra. Fica so o que serve para quem usa: quantas paginas e quanto custou.
    u = dados.get('_uso') or {}
    dados['_uso'] = {'imagens': u.get('imagens', 0), 'arquivos': u.get('arquivos', 0),
                     'custo_brl': u.get('custo_brl', 0.0)}
    return jsonify(dados)


@app.route('/api/contrato', methods=['POST'])
@login_obrigatorio
def api_contrato():
    """Gera a Proposta e as Fichas e junta com os documentos enviados, na ordem da
    operadora. Recebe multipart: campo 'dados' com o JSON e um campo por documento."""
    try:
        dados = json.loads(request.form.get('dados') or '{}')
    except json.JSONDecodeError:
        return jsonify({'erro': 'Dados da proposta inválidos.'}), 400

    try:
        pdfs = motor.gerar_tudo_memoria(dados)
    except ValueError as e:
        return jsonify({'erro': str(e)}), 400
    except Exception:
        app.logger.exception('falha ao gerar os PDFs da proposta')
        return jsonify({'erro': 'Não foi possível gerar a proposta. Confira os dados.'}), 500

    # Documentos que vieram AGORA do navegador.
    enviados = {}
    for chave in request.files:
        arquivos = [(f.filename, f.read()) for f in request.files.getlist(chave) if f and f.filename]
        if arquivos:
            enviados[chave] = arquivos

    # Corrigindo uma proposta que ja existe: parte do que esta guardado e deixa o que
    # veio agora substituir so a sua propria chave. Sem isso, regerar sem reanexar tudo
    # produzia um contrato SEM nenhum documento - a v2 saia com 1,9 MB no lugar de 7,1.
    u = usuario_atual()
    pid = (request.form.get('proposta_id') or '').strip() or None
    anexos = dict(propostas.anexos_para_montagem(pid)) if pid else {}
    anexos.update(enviados)

    # A mesma lista que a tela usa para montar os campos de upload decide o que o
    # contrato vai cobrar. Uma fonte so - antes o checklist exigia certidao de
    # casamento e o contrato saia sem reclamar da falta dela.
    tipo_titular = dados.get('tipo_titular') or 'socio'
    parentescos = [d.get('parentesco_key') for g in (dados.get('titulares') or [])
                   for d in (g.get('dependentes') or []) if d.get('parentesco_key')]
    try:
        filho_comum = any(d.get('filho_em_comum') for g in (dados.get('titulares') or [])
                          for d in (g.get('dependentes') or []))
        pessoas = [p for g in (dados.get('titulares') or [])
                   for p in ([g.get('titular') or {}] + (g.get('dependentes') or []))]
        exigidos = [i for i in regras.checklist(
            tipo_titular, parentescos,
            bool(dados.get('crianca_sem_documento')),
            filho_comum,
            any(p.get('portabilidade') for p in pessoas),
            any(p.get('migracao') for p in pessoas))['itens'] if i['obrigatorio']]
    except ValueError:
        exigidos = []          # tipo de titular recusado ja teria barrado antes

    # A capa e a carta ASSINADA, quando ela ja foi anexada. O modelo gerado so entra
    # como reserva, para o pacote nao sair sem nada no lugar - e o checklist cobra a
    # assinada de qualquer forma.
    folha_carta = None
    if not anexos.get('carta_cancelamento'):
        try:
            folha_carta = carta.gerar(dados)
        except Exception:
            app.logger.exception('falha ao gerar a carta de cancelamento')

    try:
        final, roteiro = montagem.montar(
            {'proposta': pdfs[0][1], 'fichas': [b for _, b in pdfs[1:]],
             'carta': folha_carta},
            anexos,
            titular_e_dono=tipo_titular == 'socio',
            exigidos=exigidos,
        )
    except Exception:
        app.logger.exception('falha ao montar o contrato')
        return jsonify({'erro': 'Não foi possível montar o contrato.'}), 500

    registro.gravar_contrato(final, dados, roteiro)

    # A proposta passa a existir como registro editavel: dados + cada anexo separado.
    # E o que permite voltar depois e trocar so a declaracao de uniao estavel.
    try:
        pid = propostas.salvar(dados, u, pid)
        # So o que veio agora: regravar os guardados seria reescrever arquivo igual.
        for chave, itens in enviados.items():
            for nome, conteudo in itens:
                propostas.guardar_anexo(pid, chave, nome, conteudo, u)
        propostas.guardar_versao(pid, final, roteiro, u)
    except Exception:
        app.logger.exception('falha ao guardar a proposta')
        pid = None

    prefixo = pdfs[0][0].rsplit('_Proposta.pdf', 1)[0]
    resp = send_file(io.BytesIO(final), mimetype='application/pdf', as_attachment=True,
                     download_name=f'CONTRATO_{prefixo}.pdf')
    # O roteiro vai no cabecalho: o navegador baixa o PDF e ainda consegue mostrar o
    # que entrou e o que faltou, sem precisar de uma segunda requisicao.
    # ensure_ascii=True de proposito: cabecalho HTTP e latin-1, e acento em UTF-8
    # chega corrompido do outro lado ("Adesao" virava "Ades?o"). Escapado como
    # \uXXXX o cabecalho fica ASCII puro e o JSON.parse do navegador desfaz.
    resp.headers['X-Roteiro'] = json.dumps(roteiro, ensure_ascii=True)
    if pid:
        resp.headers['X-Proposta'] = pid
    resp.headers['Access-Control-Expose-Headers'] = 'X-Roteiro, X-Proposta, Content-Disposition'
    return resp


@app.route('/acompanhamento')
@login_obrigatorio
def acompanhamento():
    """Fila de propostas. O gestor ve todas; o consultor, so as dele."""
    u = usuario_atual()
    situacao = (request.args.get('situacao') or '').strip() or None
    apenas_minhas = u['papel'] != 'gestor'
    return render_template(
        'acompanhamento.html',
        lista=propostas.listar(situacao, u['id'] if apenas_minhas else None),
        contagem=propostas.contar_por_situacao(),
        situacoes=propostas.SITUACOES, filtro=situacao,
        pagina='acompanhamento')


@app.route('/proposta/<pid>')
@login_obrigatorio
def ver_proposta(pid):
    p = propostas.obter(pid)
    if not p:
        return 'Proposta não encontrada.', 404
    u = usuario_atual()
    if u['papel'] != 'gestor' and p['consultor_id'] != u['id']:
        return 'Esta proposta é de outro consultor.', 403
    return render_template('proposta.html', p=p, situacoes=propostas.SITUACOES,
                           pagina='acompanhamento')


@app.route('/api/proposta/<pid>/anexo/<chave>', methods=['DELETE'])
@login_obrigatorio
def api_remover_anexo(pid, chave):
    """Tira um documento da proposta. Usado quando o corretor vai trocar um anexo
    errado - sem isso o antigo continuaria entrando no contrato para sempre."""
    u = usuario_atual()
    p = propostas.obter(pid)
    if not p:
        return jsonify({'erro': 'Proposta não encontrada.'}), 404
    if u['papel'] != 'gestor' and p['consultor_id'] != u['id']:
        return jsonify({'erro': 'Esta proposta é de outro consultor.'}), 403
    propostas.remover_anexo(pid, chave)
    propostas.registrar_evento(pid, u, 'anexo', f'removeu {chave}')
    return jsonify({'ok': True})


@app.route('/proposta/<pid>/situacao', methods=['POST'])
@login_obrigatorio
def mudar_situacao(pid):
    u = usuario_atual()
    erro = propostas.mudar_situacao(pid, request.form.get('situacao', ''), u,
                                    request.form.get('texto', ''))
    if erro:
        return render_template('recado.html', erro=erro, voltar=url_for('ver_proposta', pid=pid)), 400
    return redirect(url_for('ver_proposta', pid=pid))


@app.route('/proposta/<pid>/versao/<int:numero>')
@login_obrigatorio
def baixar_versao(pid, numero):
    u = usuario_atual()
    p = propostas.obter(pid)
    if not p:
        return 'Proposta não encontrada.', 404
    if u['papel'] != 'gestor' and p['consultor_id'] != u['id']:
        return 'Esta proposta é de outro consultor.', 403
    caminho = propostas.caminho_versao(pid, numero)
    if not caminho:
        return 'Versão não encontrada.', 404
    return send_file(caminho, mimetype='application/pdf', as_attachment=True,
                     download_name=f'CONTRATO_{p["empresa"] or pid}_v{numero}.pdf')


@app.route('/usuarios', methods=['GET', 'POST'])
@gestor_obrigatorio
def usuarios():
    erro = feito = ''
    if request.method == 'POST':
        acao = request.form.get('acao')
        if acao == 'criar':
            _, erro = contas.criar(
                request.form.get('login', ''), request.form.get('nome', ''),
                request.form.get('senha', ''), request.form.get('papel', 'consultor'),
                request.form.get('cpf', ''), request.form.get('telefone', ''))
            erro = erro or ''
            feito = '' if erro else 'Usuário criado. Ele troca a senha no primeiro acesso.'
        elif acao == 'ativo':
            erro = contas.definir_ativo(request.form.get('id'),
                                        request.form.get('valor') == '1') or ''
        elif acao == 'papel':
            erro = contas.definir_papel(request.form.get('id'),
                                        request.form.get('valor', '')) or ''
    return render_template('usuarios.html', lista=contas.listar(), erro=erro, feito=feito,
                           pagina='usuarios')


@app.route('/gestao')
@gestor_obrigatorio
def gestao():
    """Quanto a ferramenta custou e o que ela ja gerou."""
    return render_template('gestao.html', resumo=registro.resumo(),
                           contratos=registro.listar(),
                           persistente=registro.disponivel(),
                           pasta=registro.DADOS_DIR, pagina='custos')


@app.route('/gestao/contrato/<ident>')
@login_obrigatorio
def baixar_contrato(ident):
    caminho = registro.caminho_pdf(ident)
    if not caminho:
        return 'Contrato nao encontrado.', 404
    return send_file(caminho, mimetype='application/pdf', as_attachment=True,
                     download_name=f'CONTRATO_{ident}.pdf')


@app.after_request
def _cabecalhos(resp):
    """A tela carrega dado pessoal; nao deixar cache no navegador nem em proxy.

    Tambem apaga a assinatura do servidor: por padrao o cabecalho Server anuncia
    'Werkzeug/3.1.8 Python/3.9.6', o que entrega a stack inteira de graca a quem so
    abriu o site. Nada aqui substitui autenticacao - so evita facilitar."""
    resp.headers['Cache-Control'] = 'no-store'
    resp.headers['X-Content-Type-Options'] = 'nosniff'
    resp.headers['Referrer-Policy'] = 'same-origin'
    resp.headers['X-Frame-Options'] = 'SAMEORIGIN'
    return resp


if __name__ == '__main__':
    # Em producao quem sobe o app e o gunicorn (ver Procfile e railway.json). O
    # railway.json existe porque o Railway ignora o Procfile e, achando um app.py,
    # executava ESTE bloco em producao - subindo o servidor de desenvolvimento do
    # Flask, que atende uma requisicao por vez. Gerar um contrato de 7 MB travava o
    # site para todo mundo ate terminar.
    #
    # Este bloco e para rodar
    # na maquina do corretor - mas respeita PORT e escuta em 0.0.0.0 caso algum PaaS
    # execute o arquivo direto: senao o processo sobe em 127.0.0.1 e nada de fora chega.
    porta = int(os.environ.get('PORT', 5057))
    app.run(host='0.0.0.0' if HOSPEDADO else '127.0.0.1', port=porta, debug=not HOSPEDADO)
