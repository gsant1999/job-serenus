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

import motor
from parser import parse_bloco_notas

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY') or secrets.token_hex(32)

SENHA_ACESSO = os.environ.get('SENHA_ACESSO', '')
EXIGE_SENHA = bool(SENHA_ACESSO)

# Railway (e qualquer PaaS) injeta PORT. Se estamos hospedados e ninguem definiu a senha,
# o app NAO pode simplesmente abrir: ele gera documento com CPF, RG e dado de saude.
# Falha fechado - responde 503 em tudo ate a variavel existir.
HOSPEDADO = bool(os.environ.get('PORT'))
SEM_SENHA_EM_PRODUCAO = HOSPEDADO and not SENHA_ACESSO

SOMENTE_DIGITOS = re.compile(r'\D')


@app.before_request
def _bloqueia_sem_senha():
    """Trava tudo se o app foi hospedado sem SENHA_ACESSO configurada."""
    if SEM_SENHA_EM_PRODUCAO:
        return ('Configuracao incompleta: defina a variavel de ambiente SENHA_ACESSO '
                'antes de usar esta ferramenta. Ela gera documentos com dados pessoais '
                'e nao funciona sem controle de acesso.'), 503


def login_obrigatorio(f):
    """Os documentos gerados tem CPF, RG e dado de saude. Na internet aberta, nenhuma
    rota pode responder sem sessao."""
    @wraps(f)
    def wrapper(*a, **kw):
        if EXIGE_SENHA and not session.get('autenticado'):
            if request.path.startswith('/api/'):
                return jsonify({'erro': 'Sessao expirada. Recarregue a pagina e entre de novo.'}), 401
            return redirect(url_for('login'))
        return f(*a, **kw)
    return wrapper


@app.route('/login', methods=['GET', 'POST'])
def login():
    if not EXIGE_SENHA:
        session['autenticado'] = True
        return redirect(url_for('index'))
    erro = ''
    if request.method == 'POST':
        # compare_digest evita vazar o tamanho da senha pelo tempo de resposta
        if secrets.compare_digest(request.form.get('senha', ''), SENHA_ACESSO):
            session['autenticado'] = True
            return redirect(url_for('index'))
        erro = 'Senha incorreta.'
    return render_template('login.html', erro=erro)


@app.route('/sair')
def sair():
    session.clear()
    return redirect(url_for('login'))


@app.route('/')
@login_obrigatorio
def index():
    return render_template('index.html', agente=motor.AGENTE, planos=motor.PLANOS,
                           exige_senha=EXIGE_SENHA)


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
    })


@app.route('/api/parse-notas', methods=['POST'])
@login_obrigatorio
def api_parse_notas():
    texto = (request.get_json(force=True) or {}).get('texto', '')
    return jsonify(parse_bloco_notas(texto))


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


@app.after_request
def _sem_cache(resp):
    """A tela carrega dado pessoal; nao deixar cache no navegador nem em proxy."""
    resp.headers['Cache-Control'] = 'no-store'
    return resp


if __name__ == '__main__':
    # Em producao quem sobe o app e o gunicorn (ver Procfile). Este bloco e para rodar
    # na maquina do corretor - mas respeita PORT e escuta em 0.0.0.0 caso algum PaaS
    # execute o arquivo direto: senao o processo sobe em 127.0.0.1 e nada de fora chega.
    porta = int(os.environ.get('PORT', 5057))
    hospedado = bool(os.environ.get('PORT'))
    app.run(host='0.0.0.0' if hospedado else '127.0.0.1', port=porta, debug=not hospedado)
