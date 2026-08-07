#!/usr/bin/env python3
"""Liga o preco lido do PDF ao plano que o Painel conhece.

POR QUE ESTE PASSO EXISTE
-------------------------
O PDF e o Painel falam da mesma coisa com palavras diferentes:

    PDF                          catalogo_plano (Painel)
    "Amil Prata"                 plano   = "Prata"
    "S6500 R3" (arquivo Black)   plano   = "S6500 Black R3"
    regiao "INTERIOR SP - 1"     produto = "Amil Saude - Interior I"
    arquivo "Linha Amil Black"   tabela  = "Linha Black"

Sem essa ponte, gravar o preco do PDF cria uma tabela paralela que nenhuma
cotacao encontra: o motor procura pelo nome do Painel e o preco esta guardado
pelo nome da operadora. Ficaria a impressao de base cheia com cotacao vazia.

O QUE ELE NAO FAZ, DE PROPOSITO
-------------------------------
Nao grava nada e nao adivinha coparticipacao. O PDF diz "30%" e "Parcial
(TP)"; o catalogo diz "Completa", "Completa 30%", "Parcial", "Parcial 30%".
Qual corresponde a qual so o PRECO prova — e o preco a gente confere contra o
Painel, nao contra o nome. Entao aqui a coparticipacao e RELATADA, nunca
casada. Chutar essa ligacao e o jeito mais rapido de gravar o preco com
coparticipacao errada, que e pior que nao ter preco.

Uso:
    .venv/bin/python scripts/casar_catalogo.py <extraido.json> [--faltantes]
    (precisa de DATABASE_PUBLIC_URL no ambiente: railway run -s Postgres ...)
"""
import collections
import json
import os
import re
import sys
import unicodedata

import psycopg2
import psycopg2.extras


def sa(s):
    s = ''.join(c for c in unicodedata.normalize('NFD', s or '')
                if unicodedata.category(c) != 'Mn')
    return re.sub(r'\s+', ' ', s).strip().lower()


# Palavras que grudam no nome do plano quando o cabecalho do PDF tem texto
# corrido ao lado da coluna. Sao rotulos da propria tabela, nunca nome de
# plano — tirar e limpeza, nao adivinhacao.
_LIXO = ['nossos', 'valores', 'plano', 'produto', 'tabela', 'segmentacao',
         'acomodacao', 'faixa etaria', 'grupo de municipios', 'enfermaria',
         'apartamento', 'ambulatorial', 'hospitalar', 'obstetricia',
         'com obstetricia', 'copart', 'coparticipacao', 'adesao', 'mais adesao']


def limpar_nome(bruto, operadora=''):
    """Nome do plano como o Painel escreve: sem a operadora, sem rotulo."""
    n = sa(bruto)
    for lixo in sorted(_LIXO, key=len, reverse=True):
        n = n.replace(lixo, ' ')
    if operadora:
        n = n.replace(sa(operadora), ' ')
    n = re.sub(r'[+]', ' mais ', n)
    n = re.sub(r'[^a-z0-9 ]', ' ', n)
    return re.sub(r'\s+', ' ', n).strip()


def _variantes(nome, linha):
    """Nomes plausiveis pro mesmo plano.

    O catalogo chama "S6500 Black R3" o que o PDF, dentro do arquivo da linha
    Black, chama so de "S6500 R3" — a linha esta no nome do arquivo, nao na
    coluna. Gerar a variante e barato; deixar de gerar custa o plano inteiro.
    """
    v = {nome}
    m = re.match(r'^(s\d{3,4})\s+(r\d)$', nome)
    if m and 'black' in sa(linha):
        v.add('%s black %s' % (m.group(1), m.group(2)))
    if nome.startswith('amil '):
        v.add(nome[5:])
    return v


def carregar_catalogo(cur, operadora):
    cur.execute("""SELECT cidade, plano, produto, tabela, acomodacao,
                          coparticipacao, copart_tipo, mei, vida_min, vida_max,
                          administradora
                   FROM catalogo_plano WHERE operadora ILIKE %s""",
                ('%' + operadora + '%',))
    return cur.fetchall()


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    itens = json.load(open(sys.argv[1]))
    mostrar_faltantes = '--faltantes' in sys.argv

    c = psycopg2.connect(os.environ['DATABASE_PUBLIC_URL'])
    cur = c.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    # A operadora vem do caminho onde o organizador guardou o arquivo.
    operadora = 'Amil' if 'amil' in sys.argv[1].lower() else 'Vera Cruz'
    catalogo = carregar_catalogo(cur, operadora)
    por_nome = collections.defaultdict(list)
    for r in catalogo:
        por_nome[limpar_nome(r['plano'], operadora)].append(r)

    achou = collections.Counter()
    faltam = collections.Counter()
    coparts = collections.defaultdict(set)

    for t in itens:
        nome = limpar_nome(t['plano'], operadora)
        if not nome:
            faltam['(nome vazio)'] += 1
            continue
        linhas = []
        for v in _variantes(nome, t.get('linha', '') or t.get('arquivo', '')):
            linhas += por_nome.get(v, [])
        if not linhas:
            faltam[nome] += 1
            continue
        achou[nome] += 1
        if t.get('coparticipacao'):
            for r in linhas:
                coparts[t['coparticipacao']].add(r['copart_tipo'])

    n_ok = sum(achou.values())
    print('%d entradas do PDF: %d casaram com o catalogo, %d nao'
          % (len(itens), n_ok, sum(faltam.values())))
    print('%d nomes distintos casados, %d nomes distintos sem par'
          % (len(achou), len(faltam)))

    if coparts:
        print('\ncoparticipacao — o PDF diz X, o catalogo tem Y '
              '(RELATO, nao ligacao):')
        for k in sorted(coparts):
            print('  %-14s -> %s' % (k, sorted(coparts[k])))

    if mostrar_faltantes and faltam:
        print('\nsem par no catalogo:')
        for nome, n in faltam.most_common():
            print('  %-34s %d' % (nome, n))
    return 0


if __name__ == '__main__':
    sys.exit(main())
