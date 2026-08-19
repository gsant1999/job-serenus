"""O pacote que o consultor baixa tem TODOS os arquivos que o manifest pede.

Este erro já aconteceu quatro vezes, sempre igual: a extensão ganha um arquivo,
a lista do pacote não fica sabendo, e o Chrome recusa a extensão INTEIRA na
máquina de quem estava atualizando — nunca aqui. Na última (19/08/2026) foi o
painel nativo: o manifest passou a declarar `side_panel: painel.html` e o pacote
não levava `painel.html`, `painel.css` nem `painel.js`. O Danilo levou o erro
"Side panel file path must exist" achando que era a pasta dele.

O servidor já se recusa a servir pacote incompleto. Este teste antecipa a
recusa: pega o buraco no commit, não no meio da atualização do consultor.

    JOB_MODO_TESTE=1 JOB_DATA_DIR=/tmp/jobtest python3 testes/testar_pacote_extensao.py
"""
import io
import json
import os
import sys
import tempfile
import zipfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('JOB_MODO_TESTE', '1')
os.environ.setdefault('JOB_DATA_DIR', tempfile.mkdtemp(prefix='jobtest-ext-'))

import app as A  # noqa: E402

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = os.path.join(RAIZ, 'extensao-whatsapp')
falhas = []


def checa(nome, cond, detalhe=''):
    print(('  ok    ' if cond else '  FALHA ') + nome + (f'  << {detalhe}' if detalhe and not cond else ''))
    if not cond:
        falhas.append(nome)


cliente = A.app.test_client()
with cliente.session_transaction() as s:
    s['user_id'] = 1
    s['perfil'] = 'admin'

with open(os.path.join(EXT, 'manifest.json'), encoding='utf-8') as f:
    manifesto = json.load(f)

print('\n— O servidor sabe o que o manifest pede')
checa('nada faltando no pacote', not A._extensao_arquivos_faltando(),
      ', '.join(A._extensao_arquivos_faltando()))

print('\n— O zip do download')
r = cliente.get('/extensao/download')
checa('o download responde', r.status_code == 200, f'HTTP {r.status_code}')
no_zip = set(zipfile.ZipFile(io.BytesIO(r.data)).namelist()) if r.status_code == 200 else set()

# Toda página que o manifest aponta, e o que a página carrega depois. O Chrome
# recusa a extensão inteira se qualquer uma delas faltar.
paginas = [(manifesto.get('action') or {}).get('default_popup'),
           (manifesto.get('side_panel') or {}).get('default_path')]
for pagina in [p for p in paginas if p]:
    checa(f'{pagina} está no zip', pagina in no_zip)
    for ref in A._extensao_assets_do_html(EXT, {pagina}):
        checa(f'{ref} (pedido por {pagina}) está no zip', ref in no_zip)

print('\n— A instalação automática entrega a mesma lista')
m = cliente.get('/extensao/manifesto-instalacao').get_json()
checa('manifesto de instalação ok', bool(m and m.get('ok')), str(m)[:120])
checa('mesma lista do zip', set(m.get('arquivos', [])) == no_zip,
      f"só no zip: {sorted(no_zip - set(m.get('arquivos', [])))} | "
      f"só no manifesto: {sorted(set(m.get('arquivos', [])) - no_zip)}")
for nome in sorted(no_zip):
    if cliente.get('/extensao/arquivo/' + nome).status_code != 200:
        checa(f'{nome} é servido', False, 'a lista promete e a rota nega')

print('\n— A lista continua sendo a tranca da rota')
for mal in ('app.py', '..%2Fapp.py', '..%2F..%2Fapp.py', 'logos%2F..%2F..%2Fapp.py'):
    checa(f'recusa {mal}', cliente.get('/extensao/arquivo/' + mal).status_code == 404)

print()
if falhas:
    print(f'FALHOU: {len(falhas)}')
    for f_ in falhas:
        print('  -', f_)
    sys.exit(1)
print(f'PACOTE DA EXTENSÃO OK ({len(no_zip)} arquivos, versão {manifesto["version"]})')
