#!/usr/bin/env python3
"""As tres verificacoes do servidor. Falha com mensagem que diz o que fazer.

Existe porque `ast.parse` passa em codigo que nao sobe: em 09/08/2026 o app.py
compilava e estourava NameError no import — o site inteiro teria caido no
deploy. Sintaxe valida nao e o mesmo que aplicacao de pe.
"""
import os
import sys

# O script vive em scripts/, o app.py na raiz. Sem isto o `import app` procura
# no lugar errado e o CI acusa "o app nao importa" quando o problema e o path.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')))

os.environ.setdefault('JOB_DATA_DIR', '/tmp/ci-job')
os.environ.setdefault('WHATSAPP_EXT_KEY', 'chave-de-teste-do-ci')

falhas = []


def erro(titulo, detalhe):
    falhas.append(titulo)
    print('FALHOU: %s\n        %s' % (titulo, detalhe))


# ── 1. O APP SOBE ───────────────────────────────────────────────────────────
try:
    import app
except Exception as e:
    print('FALHOU: o app.py nao importa — o deploy derrubaria o site inteiro.')
    print('        %s: %s' % (type(e).__name__, e))
    print('        Rode: JOB_DATA_DIR=/tmp/x python3 -c "import app"')
    sys.exit(1)
print('ok: o app sobe')

# ── 2. NENHUMA ROTA APONTA PARA FUNCAO DE OUTRA FAMILIA ─────────────────────
# Pega o caso do POST /api/whatsapp/logout que passou a executar
# admin_extensao_sessoes: um recorte por linha levou o @app.route de uma funcao
# e colou em outra, 13 mil linhas acima. Compilava, subia, e fazia outra coisa.
ALIAS_CONHECIDOS = {'api_lead_sincronizar_midia', 'api_lead_comunicar_venda'}
por_endpoint = {}
for regra in app.app.url_map.iter_rules():
    fam = (str(regra).strip('/').split('/') or [''])[0]
    por_endpoint.setdefault(regra.endpoint, set()).add(fam)
for endpoint, familias in sorted(por_endpoint.items()):
    if len(familias) > 1 and endpoint not in ALIAS_CONHECIDOS:
        erro('a funcao %s responde por caminhos de familias diferentes: %s'
             % (endpoint, ', '.join(sorted(familias))),
             'Um @app.route provavelmente foi colado na funcao errada. '
             'Se for alias de proposito, acrescente em ALIAS_CONHECIDOS.')
if not falhas:
    print('ok: nenhuma rota no lugar errado')

# ── 3. AS ROTAS CRITICAS RESPONDEM O STATUS CERTO ───────────────────────────
# Pega mudanca de decorador que fecha a porta de quem ainda usa a chave antiga
# — foi o que quase derrubou as cinco consultoras sem login.
cliente = app.app.test_client()
CHAVE = {'X-Extension-Key': os.environ['WHATSAPP_EXT_KEY']}
for metodo, url, esperado in [
        ('GET', '/api/whatsapp/extensao/modelos?usuario_id=1', 200),
        ('GET', '/api/whatsapp/preferencias?usuario_id=1', 200),
        ('GET', '/api/whatsapp/versao', 200)]:
    r = cliente.open(url, method=metodo, headers=CHAVE)
    if r.status_code != esperado:
        erro('%s %s com a chave da extensao devolveu %s (esperado %s)'
             % (metodo, url, r.status_code, esperado),
             'A extensao em producao chama esta rota. Confira o decorador.')
for metodo, url in [('GET', '/api/whatsapp/extensao/modelos'),
                    ('GET', '/api/whatsapp/preferencias')]:
    r = cliente.open(url, method=metodo)
    if r.status_code not in (401, 403):
        erro('%s %s SEM credencial devolveu %s' % (metodo, url, r.status_code),
             'Rota protegida tem que recusar quem nao se identificou.')
if not falhas:
    print('ok: as rotas criticas respondem o status certo')


# ── 4. O QUE JA FOI CONQUISTADO NAO PODE SUMIR EM SILENCIO ──────────────────
#
# Guilherme, 10/08/2026: *"o que mais me incomoda e que as coisas somem e voce
# nao sabe que sumiu, ou alguem apaga e voce nao sabe quem apagou. Eu tenho que
# ficar me preocupando com tudo."*
#
# Esta lista existe pra ele nao precisar. Cada item aqui e uma funcao que
# custou trabalho pra ficar certa e que, se desaparecer num recorte, num
# `git reset`, num script de substituicao ou numa mao errada, some CALADA — o
# app continua subindo, as rotas continuam respondendo, e ninguem descobre ate
# alguem tentar usar.
#
# COMO USAR: quando uma funcao ficar pronta e importar, acrescente aqui. Um
# item a mais custa milissegundos; um item a menos custa um dia de conversa
# achando que voce esta ficando louco.
#
# ROTA que sumiu = funcao inteira que sumiu. FUNCAO com nome citado = a peca
# interna que faz aquilo funcionar (nome do arquivo, tipo do documento, etc).
ROTAS_QUE_NAO_PODEM_SUMIR = [
    # Documentos do lead: ler, classificar e baixar renomeado. Esta e a
    # corrente que transforma foto de RG no WhatsApp em proposta preenchida.
    ('/lead/<int:lid>/documentos.zip', 'baixar os documentos do lead ja renomeados'),
    ('/api/whatsapp/documentos/tipo', 'confirmar tipo e titularidade do documento, pela extensao'),
    ('/lead/documento/tipo', 'confirmar tipo e titularidade do documento, pelo site'),
    # Cotacao: o link do cliente e imutavel e a correcao de valor mantem o link.
    ('/c/<token>', 'a pagina publica da cotacao'),
    ('/cotacao/<int:cid>/ajustar', 'corrigir valor sem trocar o link do cliente'),
    ('/cotacao/documento/<int:cid>', 'o documento da cotacao'),
    # Financeiro: a tela que mostra dinheiro.
    ('/financeiro', 'a tela do financeiro'),
    # Extensao: o que as cinco consultoras usam o dia inteiro.
    ('/api/whatsapp/analisar', 'a analise da conversa'),
    ('/api/whatsapp/cotador/hashes', 'o aprendizado do cotador compartilhado entre as oito'),
]
FUNCOES_QUE_NAO_PODEM_SUMIR = [
    ('_DOC_TIPOS', 'o catalogo de tipos de documento'),
    ('_DOC_ROTULO', 'o rotulo que vira o NOME do arquivo baixado'),
    ('_doc_nome_final', 'o nome final do arquivo, com titular/dependente e parentesco'),
    ('_conferencia_mes', 'previsto x recebido, proposta por proposta'),
    ('_previsao_meses', 'a previsao dos proximos meses'),
    ('_limpar_url', 'o filtro de PII antes de mandar erro pro Sentry'),
    ('_lanc_faixa_where', 'o filtro de vencimento do financeiro'),
]

_regras = {str(r) for r in app.app.url_map.iter_rules()}
for caminho, oque in ROTAS_QUE_NAO_PODEM_SUMIR:
    if caminho not in _regras:
        erro('a rota %s SUMIU (%s)' % (caminho, oque),
             'Ela existia e alguem tirou. Se foi de proposito, remova desta '
             'lista no mesmo commit — explicando por que. Se nao foi, '
             'procure no `git log -p` quem levou.')
for nome, oque in FUNCOES_QUE_NAO_PODEM_SUMIR:
    if not hasattr(app, nome):
        erro('%s SUMIU do app.py (%s)' % (nome, oque),
             'Mesma regra: some de proposito com a linha removida daqui no '
             'mesmo commit, ou nao some.')
if not falhas:
    print('ok: nada do que ja funcionava desapareceu')

# ── 5. Aspas duplas dentro de um atributo onclick ──────────────────────
#
# O botao "Desconectar" da tela de usuarios passou dias sem funcionar por
# causa disto: o apelido do aparelho entrava no onclick por JSON.stringify,
# que devolve o texto entre aspas DUPLAS — a mesma aspa que fecha o atributo.
# O onclick terminava no meio e o botao virava enfeite.
#
# E o pior tipo de defeito: HTML invalido nao e erro de codigo. Nao sai nada
# no console, nao abre confirmacao, nao vai requisicao. O botao esta la, o
# clique nao faz nada, e nao ha pista nenhuma de onde procurar.
import glob as _glob
import re as _re
_ATRIB_JS = _re.compile(r'on\w+="[^"\n]*\+[^"\n]*JSON\.stringify')
for _arq in sorted(_glob.glob('templates/**/*.html', recursive=True)):
    with open(_arq, encoding='utf-8') as _f:
        for _n, _linha in enumerate(_f, 1):
            if _ATRIB_JS.search(_linha):
                erro('%s:%d monta um atributo on...="" com JSON.stringify' % (_arq, _n),
                     'JSON.stringify devolve aspas DUPLAS e elas fecham o '
                     'atributo — o clique morre em silencio. Use um helper '
                     'que escape pro JavaScript e depois pro HTML (veja '
                     '`argJs` em templates/usuarios.html), ou passe o valor '
                     'por data-atributo em vez de por argumento.')
if not falhas:
    print('ok: nenhum atributo de clique montado com aspas duplas')

if falhas:
    print('\n%d verificacao(oes) falharam.' % len(falhas))
    sys.exit(1)
print('\nTudo certo.')
