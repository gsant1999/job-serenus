#!/usr/bin/env python3
"""Arruma os PDFs de tabela de preco baixados, por operadora.

POR QUE NAO ORGANIZAR PELO NOME DO ARQUIVO
------------------------------------------
O nome que a Koter/Affinity da ao download e comercial, nao tecnico:
"linha_amil_black_interior_1_sp_-_jun_26.pdf". Ele nao diz a modalidade
(PME? adesao?), a vigencia real vem abreviada e a regiao aparece as vezes
so no miolo. Confiar no nome e como confiar em pasta de Downloads: funciona
ate o dia em que alguem renomeia.

Entao a classificacao le o TEXTO da primeira pagina, onde a propria
operadora declara tudo:

    Tabela de Precos - Linha Amil Black
    Planos PME - Porte I - Total de 2 vidas
    Regiao: SAO PAULO

Arquivo que nao tiver esse cabecalho vai pra _nao_reconhecidos/ em vez de
ser chutado numa pasta qualquer. Arquivo no lugar errado e pior que arquivo
solto: o importador leria e gravaria preco de Sao Paulo como se fosse do
interior, sem ninguem perceber.

Uso:
    .venv/bin/python scripts/organizar_tabelas.py            # ve o que faria
    .venv/bin/python scripts/organizar_tabelas.py --mover    # move de verdade

Le de ~/Downloads e escreve em tabelas-operadoras/<operadora>/<modalidade>/<regiao>/
"""
import os
import re
import shutil
import subprocess
import sys
import unicodedata

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESTINO = os.path.join(RAIZ, 'tabelas-operadoras')
ORIGEM = os.path.expanduser('~/Downloads')

# Operadoras que a corretora trabalha. Lista fechada de proposito: nome novo
# cai em _nao_reconhecidos e aparece pra gente decidir, em vez de virar uma
# pasta "Amil Black" separada da "Amil" por um detalhe de escrita.
OPERADORAS = [
    ('amil', 'Amil'),
    ('sao camilo', 'Sao Camilo'),
    ('vera cruz', 'Vera Cruz'),
    ('medsenior', 'MedSenior'),
    ('med senior', 'MedSenior'),
    ('beneficencia', 'Saude Beneficencia'),
    ('sulamerica', 'SulAmerica'),
    ('sul america', 'SulAmerica'),
    ('hapvida', 'Hapvida'),
    ('notredame', 'NotreDame'),
    ('notre dame', 'NotreDame'),
    ('unimed', 'Unimed'),
    ('porto seguro', 'Porto Seguro'),
    ('bradesco', 'Bradesco'),
]

MODALIDADES = [
    ('planos pme', 'PME'),
    ('planos pj', 'PME'),
    ('adesao', 'Adesao'),
    ('coletivo por adesao', 'Adesao'),
    ('individual', 'Individual'),
    ('familiar', 'Individual'),
]


def _sem_acento(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s)
                   if unicodedata.category(c) != 'Mn')


def _texto(caminho, paginas=2):
    """Primeiras paginas em texto. Sem camada de texto -> string vazia."""
    try:
        r = subprocess.run(['pdftotext', '-f', '1', '-l', str(paginas), '-layout',
                            caminho, '-'], capture_output=True, text=True, timeout=60)
        return r.stdout or ''
    except Exception:
        return ''


def _limpar(s):
    """Vira nome de pasta: sem acento, sem barra, sem espaco duplo."""
    s = _sem_acento(s).strip()
    s = re.sub(r'[^A-Za-z0-9 ._-]', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def classificar(caminho):
    """-> (operadora, modalidade, regiao, linha) ou None se nao reconhecer."""
    txt = _texto(caminho)
    if 'Tabela de Pre' not in txt:
        return None
    plano = _sem_acento(txt).lower()

    # Busca no texto SEM acento: "Região" e "Preços" trazem c-cedilha e til, e
    # um `[a-z]*` nao os alcanca — o campo saia vazio e tudo caia em
    # "Regiao indefinida", que e exatamente o erro silencioso que a pasta
    # deveria evitar.
    puro = _sem_acento(txt)

    m = re.search(r'Tabela de Pre[a-z]*\s*-\s*(.+)', puro)
    linha = _limpar(m.group(1)) if m else ''

    # A operadora aparece no titulo da linha ("Linha Amil Black"); quando nao,
    # procura no corpo. Titulo primeiro porque o corpo cita rede credenciada de
    # outras operadoras e daria falso positivo.
    op = ''
    for chave, nome in OPERADORAS:
        if chave in _sem_acento(linha).lower():
            op = nome
            break
    if not op:
        for chave, nome in OPERADORAS:
            if chave in plano:
                op = nome
                break
    if not op:
        return None

    mod = ''
    for chave, nome in MODALIDADES:
        if chave in plano:
            mod = nome
            break
    mod = mod or 'Indefinido'

    # Com o hifen: "INTERIOR SP - 1" e "- 2" tem preco diferente e nao podem
    # cair na mesma pasta.
    m = re.search(r'Regiao:\s*([A-Za-z0-9 -]+)', puro)
    regiao = _limpar(m.group(1)) if m else 'Regiao indefinida'

    return op, mod, regiao, linha


def main():
    mover = '--mover' in sys.argv
    pdfs = sorted(f for f in os.listdir(ORIGEM) if f.lower().endswith('.pdf'))
    if not pdfs:
        print('Nenhum PDF em', ORIGEM)
        return 0

    feitos, ignorados = 0, 0
    for nome in pdfs:
        origem = os.path.join(ORIGEM, nome)
        c = classificar(origem)
        if not c:
            ignorados += 1
            continue
        op, mod, regiao, linha = c
        pasta = os.path.join(DESTINO, op, mod, regiao)
        destino = os.path.join(pasta, nome)
        print('%-46s -> %s/%s/%s' % (nome[:46], op, mod, regiao))
        feitos += 1
        if not mover:
            continue
        os.makedirs(pasta, exist_ok=True)
        # Mesmo arquivo baixado de novo (reajuste) sobrescreve: a tabela mais
        # recente e a que vale, e guardar as duas confundiria o importador.
        shutil.move(origem, destino)

    print('\n%d tabela(s) reconhecida(s), %d PDF(s) ignorado(s) (nao sao tabela).'
          % (feitos, ignorados))
    if not mover:
        print('Nada foi movido. Rode com --mover para valer.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
