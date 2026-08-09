#!/usr/bin/env python3
"""Todo arquivo declarado no manifest.json existe de verdade.

Pega o caso das logos que entram na pasta e nao em web_accessible_resources (e
o inverso): a extensao instala e a imagem simplesmente nao carrega — sem erro
no console, sem nada.
"""
import json
import os
import sys

BASE = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    '..', 'extensao-whatsapp'))
m = json.load(open(os.path.join(BASE, 'manifest.json')))

declarados = []
for cs in m.get('content_scripts', []):
    declarados += cs.get('js', []) + cs.get('css', [])
for war in m.get('web_accessible_resources', []):
    declarados += war.get('resources', [])
sw = (m.get('background') or {}).get('service_worker')
if sw:
    declarados.append(sw)
declarados += list((m.get('icons') or {}).values())
acao = m.get('action') or {}
if acao.get('default_popup'):
    declarados.append(acao['default_popup'])
declarados += list((acao.get('default_icon') or {}).values())

faltando = [d for d in sorted(set(declarados))
            if '*' not in d and not os.path.exists(os.path.join(BASE, d))]
if faltando:
    print('FALHOU: o manifest.json declara arquivo que nao existe no pacote:')
    for f in faltando:
        print('        %s' % f)
    print('        A extensao instala e essa parte simplesmente nao funciona.')
    sys.exit(1)
print('ok: os %d arquivos declarados no manifest existem' % len(set(declarados)))
