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
#
# ÂNCORA DE MARCA, não só nome de operadora. O material que a operadora publica
# muitas vezes não escreve o próprio nome no topo — escreve o nome do PRODUTO
# ("Smart UP", "Amhe Plus"). Sem isso, nada do que veio fora da Koter é
# reconhecido, que foi o que aconteceu na primeira rodada: 113 PDFs, 0
# classificados.
MARCAS = [
    ('smart up', 'Hapvida NotreDame'),
    ('nosso medico', 'Hapvida NotreDame'),
    ('amhe plus', 'Amhemed'),
    ('amhe ', 'Amhemed'),
    ('vera prata', 'Vera Cruz'),
    ('vera ouro', 'Vera Cruz'),
]

OPERADORAS = [
    ('amil', 'Amil'),
    ('hapvida', 'Hapvida NotreDame'),
    ('notredame', 'Hapvida NotreDame'),
    ('notre dame', 'Hapvida NotreDame'),
    ('amhemed', 'Amhemed'),
    ('medsenior', 'MedSenior'),
    ('plena saude', 'Plena Saude'),
    ('prevent senior', 'Prevent Senior'),
    ('biovida', 'Biovida'),
    ('blue med', 'Blue Med Senior'),
    ('gs garantia', 'GS Garantia'),
    ('hbc saude', 'HBC Saude'),
    ('med tour', 'Med Tour'),
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
    # "DEMAIS EMPRESAS", "PORTE II (2 a 29 vidas)" e "MEI" sao todos PME na
    # Hapvida — MEI e um recorte de quem contrata, nao outra modalidade.
    # Sem isto eles caiam em "Adesao" por causa de um "adesao" solto no corpo,
    # e tabela de PME viraria tabela de adesao numa pasta so.
    ('demais empresas', 'PME'),
    ('promocional - mei', 'PME'),
    ('porte i', 'PME'),
    ('porte ii', 'PME'),
    ('tabela de vendas pme', 'PME'),
    ('tabela pme', 'PME'),
    ('tabela_pme', 'PME'),
    ('adesao', 'Adesao'),
    ('coletivo por adesao', 'Adesao'),
    ('individual', 'Individual'),
    ('pessoa fisica', 'Individual'),
    ('tabela de vendas pf', 'Individual'),
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
    plano = _sem_acento(txt).lower()

    # Antes exigia o cabecalho "Tabela de Precos -", que so o gerador da Koter
    # escreve. O material publicado pela propria operadora se chama "TABELA DE
    # VENDAS", "TABELA PME", ou nem tem titulo. Com a regra antiga, 113 PDFs
    # baixados viraram 0 classificados — o organizador parecia funcionar e nao
    # reconhecia nada que nao viesse da Koter.
    if not ('tabela de pre' in plano or 'tabela de venda' in plano
            or 'tabela pme' in plano or 'tabela_pme' in plano
            or re.search(r'faixa\s*etaria', plano)):
        return None

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
    # O CABECALHO decide, nao a pagina inteira. Tabela de venda cita
    # concorrente no corpo (rede, comparativo) — a tabela da Hapvida em
    # Campinas foi classificada como Amil porque a palavra "amil" aparecia
    # perdida no meio. As primeiras linhas sao onde a operadora se identifica.
    cabecalho = '\n'.join(plano.split('\n')[:14])

    op = ''
    for chave, nome in OPERADORAS:
        if chave in _sem_acento(linha).lower():
            op = nome
            break
    if not op:
        for chave, nome in MARCAS + OPERADORAS:
            if chave in cabecalho:
                op = nome
                break
    if not op:
        for chave, nome in OPERADORAS:
            if chave in plano:
                op = nome
                break
    # Por ultimo, a marca do PRODUTO. Vem depois do nome da operadora de
    # proposito: material que compara concorrentes cita varias marcas, e o nome
    # proprio no topo e mais confiavel que uma marca citada no meio.
    if not op:
        for chave, nome in MARCAS:
            if chave in plano:
                op = nome
                break
    if not op:
        return None

    # Mesma logica da operadora: o TITULO manda. "TABELA DE VENDAS - PLANO DE
    # SAUDE INDIVIDUAL" e individual, mesmo que a palavra "adesao" apareca no
    # regulamento la embaixo — e aparece.
    mod = ''
    for chave, nome in MODALIDADES:
        if chave in cabecalho:
            mod = nome
            break
    if not mod:
        for chave, nome in MODALIDADES:
            if chave in plano:
                mod = nome
                break
    mod = mod or 'Indefinido'

    # Com o hifen: "INTERIOR SP - 1" e "- 2" tem preco diferente e nao podem
    # cair na mesma pasta.
    m = re.search(r'Regiao:\s*([A-Za-z0-9 -]+)', puro)
    if m:
        regiao = _limpar(m.group(1))
    else:
        # Material da operadora poe a praca no titulo ("Campinas-SP",
        # "CAMPINAS"), nao num campo "Regiao:". Sem isto tudo cairia em
        # "Regiao indefinida" e as pracas se misturariam numa pasta so — e
        # praca diferente e PRECO diferente.
        # Aceita conectivo minusculo: sem isso "Sao Jose dos Campos" virava
        # "Campos" e "Mogi das Cruzes" virava "Cruzes" — duas pracas
        # diferentes podiam colidir na mesma pasta com nome truncado.
        m = re.search(r'\b([A-Z][a-zA-Z]+(?: (?:de|do|da|dos|das|[A-Z][a-zA-Z]+))'
                      r'{0,3})\s*-\s*SP\b', puro)
        if not m:
            # So nas primeiras linhas: caixa alta solta no meio do documento e
            # titulo de secao, nao praca. "SOROCABA" veio assim numa rodada de
            # teste, num PDF que nem era de Sorocaba.
            topo = '\n'.join(puro.split('\n')[:8])
            m = re.search(r'\n\s*([A-Z]{4,}(?: [A-Z]{2,}){0,3})\s*\n', topo)
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
