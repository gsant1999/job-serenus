"""Tudo que a extensão pede à wa-js tem que existir no pacote embarcado.

A wa-js é a peça mais frágil do projeto: ela traduz o WhatsApp, e quando o
WhatsApp muda por baixo, ela quebra — às vezes só numa função. Já aconteceu em
27c8a43 (4.3.1 -> 4.4.2) e de novo em 18/08/2026, quando o canário acusou que
achar mensagem por id e identificar a conta logada tinham parado.

Este teste não prova que a wa-js FUNCIONA — só o WhatsApp aberto prova isso.
Ele prova que a versão embarcada não removeu nada que a extensão chama. É a
metade que dá pra verificar sem depender do WhatsApp, e é a que pega o erro
mais bobo e mais caro: subir uma versão nova que apagou um método.

    python3 testes/testar_wajs_contrato.py
"""

import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = os.path.join(RAIZ, 'extensao-whatsapp')
BUNDLE = os.path.join(EXT, 'wa-js.vendor.js')

FALHAS = []


def checa(nome, cond, detalhe=''):
    print(('  ok    ' if cond else '  FALHA ') + nome + (f'  << {detalhe}' if detalhe and not cond else ''))
    if not cond:
        FALHAS.append(nome)


with open(BUNDLE, encoding='utf-8', errors='ignore') as f:
    bundle = f.read()

# 1. O pacote é o que dizemos que é.
cab = bundle[:200]
m = re.search(r'wppconnect-team/wa-js v([0-9]+\.[0-9]+\.[0-9]+)', cab)
print('\n— O pacote embarcado')
checa('o cabeçalho declara a versão', bool(m), cab[:100])
versao = m.group(1) if m else '?'
print(f'        wa-js v{versao}, {len(bundle):,} bytes'.replace(',', '.'))

with open(os.path.join(EXT, 'wa-js.vendor.js.LICENSE.txt'), encoding='utf-8', errors='ignore') as f:
    lic = f.read()
checa('o arquivo de licença é da MESMA versão',
      f'wa-js v{versao}' in lic,
      'licença e bundle de versões diferentes')

# 2. Toda chamada WPP.<area>.<metodo> feita pela extensão existe no pacote.
#    Minificado não tem como resolver o objeto; o que dá para afirmar é que o
#    IDENTIFICADOR ainda aparece. Some do bundle = método removido, e isso é o
#    que este teste pega.
usos = set()
for arquivo in sorted(os.listdir(EXT)):
    if not arquivo.endswith('.js') or arquivo.startswith('wa-js.vendor'):
        continue
    with open(os.path.join(EXT, arquivo), encoding='utf-8', errors='ignore') as f:
        src = f.read()
    for area, metodo in re.findall(r'WPP\.([A-Za-z]+)\.([A-Za-z_][A-Za-z0-9_]*)', src):
        usos.add((area, metodo, arquivo))

print(f'\n— O que a extensão chama da wa-js ({len(set((a, m) for a, m, _ in usos))} métodos)')
vistos = {}
for area, metodo, arquivo in sorted(usos):
    vistos.setdefault((area, metodo), []).append(arquivo)

for (area, metodo), arquivos in sorted(vistos.items()):
    # Nomes curtos demais dão falso positivo em bundle minificado; os que
    # importam de verdade são os compostos.
    if len(metodo) < 5:
        print(f'  --    WPP.{area}.{metodo}  (nome curto, não dá para afirmar em bundle minificado)')
        continue
    checa(f'WPP.{area}.{metodo}', metodo in bundle,
          'sumiu do pacote — usado em ' + ', '.join(sorted(set(arquivos))))

# 3. As peças internas que o canário e a mídia usam por baixo do WPP.
print('\n— Peças internas que a extensão alcança direto')
for peca in ('MsgStore', 'ChatStore', 'LruMediaStore', 'MediaBlobCache'):
    usado = any(peca in open(os.path.join(EXT, a), encoding='utf-8', errors='ignore').read()
                for a in os.listdir(EXT)
                if a.endswith('.js') and not a.startswith('wa-js.vendor'))
    if usado:
        checa(peca, peca in bundle, 'a extensão usa e o pacote não tem mais')

# 4. A versão declarada da extensão acompanha.
with open(os.path.join(EXT, 'VERSAO_ESTAVEL'), encoding='utf-8') as f:
    estavel = f.read().strip()
import json
with open(os.path.join(EXT, 'manifest.json'), encoding='utf-8') as f:
    manifesto = json.load(f)['version']
print('\n— Versão da extensão')
checa('manifest.json e VERSAO_ESTAVEL batem', estavel == manifesto,
      f'manifest={manifesto} VERSAO_ESTAVEL={estavel}')

print()
if FALHAS:
    print(f'FALHOU: {len(FALHAS)}')
    for f_ in FALHAS:
        print('  -', f_)
    sys.exit(1)
print(f'CONTRATO DA WA-JS OK (v{versao}, extensão {manifesto})')
