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

if falhas:
    print('\n%d verificacao(oes) falharam.' % len(falhas))
    sys.exit(1)
print('\nTudo certo.')
