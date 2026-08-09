#!/usr/bin/env python3
"""Le tabela de preco em PDF de operadora, no formato "grade simples".

QUAL FORMATO E ESTE
-------------------
O da Amil (scripts/extrair_tabelas.py) vem de gerador automatico e e sempre
igual. Ja o material que a propria operadora publica — manual do corretor da
Vera Cruz, tabela da Affix, da Allcare — cada um tem um desenho, mas todos
compartilham a mesma espinha:

    <cabecalho com o nome do plano, o codigo ANS, a acomodacao>
    0 a 18 anos     R$ 249,92     R$ 329,96
    19 a 23 anos    R$ 294,90     R$ 389,36
    ...

Entao o leitor nao procura um token fixo ("Acomodacao", como o da Amil). Ele
acha as LINHAS DE FAIXA — que sao reconheciveis sozinhas — e deduz as colunas
a partir de onde os precos caem. Cabecalho e o que estiver acima, na mesma
coluna.

Isso e o que faz ele atravessar formatos diferentes: a unica coisa que os tres
PDFs da Vera Cruz tem em comum e exatamente essa espinha.

O QUE ELE RECUSA
----------------
Grade que nao tiver as dez faixas na ordem. Manual do corretor e cheio de
tabela que parece preco e nao e (coparticipacao por item, taxa de associacao,
limite por procedimento) — todas com "R$" e nenhuma com faixa etaria. Exigir
as dez faixas separa preco de plano de qualquer outro numero da pagina, sem
precisar entender a pagina.

Uso:
    .venv/bin/python scripts/extrair_grade.py <pdf-ou-pasta> [--resumo]
"""
import json
import os
import re
import sys
import unicodedata

import subprocess

import pdfplumber


def _texto_pdftotext(caminho, pagina):
    """Texto da pagina pelo pdftotext.

    O pdfplumber nao devolve celula GIRADA: na tabela da Allcare o rotulo
    "Com coparticipacao Total" fica na vertical, na coluna da esquerda, e
    sumia — a tabela nascia sem coparticipacao e a rota recusava. O pdftotext
    entrega essa celula.
    """
    try:
        r = subprocess.run(['pdftotext', '-f', str(pagina), '-l', str(pagina),
                            '-layout', caminho, '-'],
                           capture_output=True, text=True, timeout=30)
        return r.stdout or ''
    except Exception:
        return ''

FAIXAS = ['00-18', '19-23', '24-28', '29-33', '34-38',
          '39-43', '44-48', '49-53', '54-58', '59+']
# O rotulo da ultima faixa e '59+', igual ao FAIXAS_ETARIAS do app.py. O PDF
# escreve "59 ou +" e era assim que saia daqui — a rota de importacao descarta
# faixa fora da lista dela, entao 1.076 precos (o mais caro de cada tabela)
# sumiriam calados e a tabela pareceria completa.

# Cada operadora escreve a faixa de um jeito: "0 a 18 anos", "0-18",
# "59 anos ou +", "59 anos >", "59+". Todas viram o mesmo rotulo interno,
# senao a mesma faixa nasceria com tres nomes no banco e nenhuma cotacao
# encontraria as tres.
# Minimo de faixas pra uma grade valer. Tres e o que a MedSenior tem (49+).
# Menos que isso comeca a aceitar tabela de outra natureza com numero do lado.
MIN_FAIXAS = 3

_INICIO = {0: '00-18', 19: '19-23', 24: '24-28', 29: '29-33', 34: '34-38',
           39: '39-43', 44: '44-48', 49: '49-53', 54: '54-58', 59: '59+'}


def _sem_acento(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s or '')
                   if unicodedata.category(c) != 'Mn')


def _faixa(texto):
    """Rotulo de faixa etaria -> nome interno, ou None."""
    t = _sem_acento(texto).lower().replace('anos', ' ').strip()
    t = re.sub(r'\s+', ' ', t)
    m = re.match(r'^(\d{1,2})\s*(?:a|-|ate)\s*(\d{2})\b', t)
    if m:
        return _INICIO.get(int(m.group(1)))
    if re.match(r'^59\s*(\+|>|ou|e)?', t):
        return '59+'
    return None


def _preco(t):
    """'R$ 1.424,30' ou 'R$ 153' -> float. Nao e preco -> None.

    O manual da Vera Cruz publica valor cheio, sem centavos ("R$ 153"). Exigir
    virgula descartaria a tabela inteira; aceitar qualquer numero traria numero
    de pagina e codigo ANS. O 'R$' e o que separa os dois.
    """
    t = t.strip()
    if not t.startswith('R$'):
        return None
    n = t[2:].strip().replace('.', '').replace(',', '.')
    try:
        return float(n)
    except ValueError:
        return None


def _linhas(palavras, tol=7):
    """Agrupa palavras em linha visual.

    A tolerancia e 7, nao 4: no manual da Vera Cruz a ultima faixa sai com as
    palavras desalinhadas em ~5pt, e com 4 ela virava duas linhas — a grade
    perdia a decima faixa e era recusada inteira.
    """
    out = []
    for w in sorted(palavras, key=lambda w: (w['top'], w['x0'])):
        if out and abs(w['top'] - out[-1][0]) <= tol:
            out[-1][1].append(w)
        else:
            out.append([w['top'], [w]])
    return [(t, sorted(ws, key=lambda w: w['x0'])) for t, ws in out]


def _centro(w):
    return (w['x0'] + w['x1']) / 2.0


def _juntar_reais(ws):
    """'R$' e '249,92' vem como duas palavras. Devolve (centro, valor)."""
    out = []
    i = 0
    while i < len(ws):
        t = ws[i]['text']
        if t == 'R$' and i + 1 < len(ws):
            v = _preco('R$ ' + ws[i + 1]['text'])
            if v is not None:
                out.append(((ws[i]['x0'] + ws[i + 1]['x1']) / 2.0, v))
                i += 2
                continue
        v = _preco(t)
        if v is not None:
            out.append((_centro(ws[i]), v))
        i += 1
    return out


def _mais_perto(x, ancoras, limite=60):
    melhor, dist = None, limite
    for i, a in enumerate(ancoras):
        if abs(x - a) < dist:
            melhor, dist = i, abs(x - a)
    return melhor


def _grades_da_pagina(pagina):
    """Toda sequencia de dez faixas na pagina -> (ancoras, precos, inicio)."""
    linhas = _linhas(pagina.extract_words())
    achadas = []
    corrente = []          # [(indice_da_linha, faixa, [(x, valor)])]
    for i, (top, ws) in enumerate(linhas):
        # O rotulo nao esta sempre no comeco da linha. Na tabela da Allcare a
        # coluna da esquerda traz "Com coparticipacao Total" e a faixa vem
        # depois; procurar so no inicio nao achava nenhuma tabela ali.
        rotulo = None
        for ini in range(0, min(4, len(ws))):
            for n in range(ini + 1, min(ini + 5, len(ws)) + 1):
                rotulo = _faixa(' '.join(w['text'] for w in ws[ini:n]))
                if rotulo:
                    break
            if rotulo:
                break
        valores = _juntar_reais(ws)
        if not valores:
            # Linha SEM PRECO nao interrompe: o manual da Vera Cruz enfia
            # "*Condicoes validas ate 30/06" no meio da tabela, e tratar isso
            # como fim da grade descartava a tabela inteira por causa de um
            # rodape. O que interrompe e linha com preco e sem faixa — essa
            # sim e outra tabela.
            continue
        if not rotulo:
            if len(corrente) == len(FAIXAS):
                achadas.append(corrente)
            corrente = []
            continue
        # NEM TODA OPERADORA VENDE PRAS DEZ FAIXAS.
        #
        # A MedSenior so vende a partir de 49 anos: a tabela dela tem TRES
        # faixas (49-53, 54-58, 59+). Exigir as dez rejeitava o arquivo inteiro
        # e devolvia zero tabela, sem dizer por que.
        #
        # O que continua sendo exigido: as faixas vem NA ORDEM da lista
        # canonica, sem pular, e sao pelo menos MIN_FAIXAS. Isso ja separa
        # preco de plano de qualquer outra tabela da pagina — as de
        # coparticipacao tem rotulo de procedimento, nao de idade, e nao
        # chegam nem na primeira.
        prox = FAIXAS.index(corrente[-1][1]) + 1 if corrente else None
        esperada = FAIXAS[prox] if (prox is not None and prox < len(FAIXAS)) else None
        if corrente and rotulo != esperada:
            if len(corrente) >= MIN_FAIXAS:
                achadas.append(corrente)
            corrente = [(i, rotulo, valores)]
            continue
        corrente.append((i, rotulo, valores))
    if len(corrente) >= MIN_FAIXAS:
        achadas.append(corrente)

    saida = []
    for seq in achadas:
        # Colunas: a primeira faixa define quantas sao e onde ficam. Depois
        # cada preco vai pra ancora mais proxima. Faixa que trouxer um numero
        # a mais ou a menos que a primeira derruba a grade — e sinal de que a
        # leitura escorregou, e preco escorregado e preco de outro plano.
        ancoras = [x for x, _ in seq[0][2]]
        precos = {}
        ok = True
        for _, rotulo, valores in seq:
            if len(valores) != len(ancoras):
                ok = False
                break
            col = {}
            for x, v in valores:
                j = _mais_perto(x, ancoras)
                if j is None:
                    ok = False
                    break
                col[j] = v
            if not ok or len(col) != len(ancoras):
                ok = False
                break
            precos[rotulo] = col
        if ok:
            saida.append((ancoras, precos, seq[0][0], linhas))
    return saida


# Rótulos que a operadora usa pra dizer "o nome do plano é este".
_ROTULO_PRODUTO = re.compile(r'^\s*(produto|plano|planos)\s*$', re.I)
# Linhas que vêm logo depois e NÃO são nome: elas ajudam a saber onde a linha
# do produto termina.
_ROTULO_OUTROS = re.compile(r'^\s*(segmenta|acomoda|registro|c[oó]d|coparticipa|abrang|vigência|vigencia)', re.I)


# O que NUNCA é nome de produto, mesmo aparecendo na linha certa.
_NAO_E_NOME = re.compile(
    r'^(amb[+\w]*|hosp\w*|obst\w*|enferm\w*|apart\w*|coletiv\w*|privativ\w*|'
    r'\d{3}\.\d{3}/\d{2}-\d|\d{4,6}|r\$|com|sem|total|parcial|'
    r'segmenta\w*|acomoda\w*|registro|c[oó]d\w*|produto|plano)$', re.I)


def _nome_de_produto(txt):
    """Diz se o texto pode ser nome de plano.

    Três coisas se disfarçam de nome na linha do produto e nenhuma é:

    • O BANNER com letras espaçadas — "C O M C O P A R T I C I". Ele atravessa
      as colunas e cai no balde de qualquer uma. Reconhecido pela razão entre
      letras e palavras: nome de plano tem palavras de 3+ letras.
    • A SEGMENTAÇÃO e a ACOMODAÇÃO — "AMB+HOSP+OBST", "ENFERM", "APART".
      Elas têm campo próprio no resultado; repetir no nome é ruído.
    • CÓDIGO e REGISTRO ANS — números soltos, que também têm campo próprio.
    """
    t = txt.strip()
    if not t:
        return False
    partes = t.split()
    # Letras soltas separadas por espaço: média de caracteres por palavra < 1,6.
    if len(t.replace(' ', '')) / max(1, len(partes)) < 1.6:
        return False
    # Todas as palavras sendo rótulo estrutural: não é nome.
    if all(_NAO_E_NOME.match(x) for x in partes):
        return False
    # Sobrou só pontuação ou número solto.
    if not re.search(r'[A-Za-zÀ-ÿ]{2}', t):
        return False
    return True


def _limpar_nome(txt):
    """Tira do nome o que tem campo próprio, quando o rótulo não foi achado.

    Rede de segurança: mesmo sem a linha PRODUTO, o nome não pode carregar a
    segmentação ("AMB+HOSP+OBST"), a acomodação ("ENFERM", "APART"), o código
    interno ou o banner com letras espaçadas ("C O M C O P A R T I C I") —
    tudo isso já sai em coluna própria, e repetido no nome vira lixo que
    impede o casamento com o catálogo.
    """
    if not txt:
        return ''
    # O banner é uma sequência de LETRAS SOLTAS. Some qualquer corrida de três
    # ou mais tokens de um caractere.
    palavras = txt.split()
    fora, corrida = [], []
    for w in palavras:
        if len(w) == 1 and w.isalpha():
            corrida.append(w)
            continue
        if len(corrida) >= 3:
            corrida = []
        elif corrida:
            fora.extend(corrida); corrida = []
        fora.append(w)
    if len(corrida) < 3:
        fora.extend(corrida)
    # Sai o que tem campo próprio, mais o que é claramente texto de capa:
    # data de vigência, faixa de vidas, valor em reais.
    # CONSERVADOR DE PROPÓSITO. Eu tentei tirar data, faixa de vidas e valor
    # daqui também — e a regra comeu o "900" de "PREMIUM 900 (CARE)", que é
    # nome. Limpar demais estraga nome bom; limpar de menos deixa lixo que
    # aparece no resumo e pede o rótulo. O segundo erro se conserta olhando;
    # o primeiro passa despercebido.
    #
    # Aqui sai só o que tem coluna própria no resultado: segmentação,
    # acomodação, registro ANS e código interno.
    limpo = [w for w in fora if not _NAO_E_NOME.match(w)]
    saida = ' '.join(limpo).strip(' -–—·|')
    # Número solto de 3 ou 4 dígitos É nome de plano na Hapvida — 500, 600,
    # 900, 1000. Rejeitar isso devolvia o cabeçalho sujo inteiro pra uma linha
    # cujo nome real era só "500".
    if re.fullmatch(r'\d{3,4}(\.\d+)?', saida):
        return saida
    if not re.search(r'[A-Za-zÀ-ÿ]{2}', saida):
        return ''
    return saida


def _produto_rotulado(linhas, ini, ancoras, passo=0):
    """Nome do plano lido da linha PRODUTO, quando ela existe.

    O PDF da Hapvida tem a tabela ROTULADA: uma linha "PRODUTO" com o nome de
    cada plano, outra "SEGMENTAÇÃO", outra "ACOMODAÇÃO", outra "CÓD. INTERNO".
    A operadora está dizendo o nome — e a gente estava raspando o cabeçalho
    inteiro e recebendo o banner "COM COPARTICIPAÇÃO PARCIAL" com as letras
    espaçadas ("C O M C O P A R T I C I") grudado no nome.

    Ler o rótulo é melhor que reconhecer vocabulário por dois motivos: sai o
    nome EXATO que a operadora vende (SMART UP, SMART PRIME, NOSSO MÉDICO
    CAMPINAS), e funciona pra plano que ninguém cadastrou ainda — vocabulário
    só acerta o que já foi ditado.

    Devolve [] quando a página não tem linha rotulada; aí o vocabulário assume.
    """
    # Procura pra cima a partir do início da grade: o cabeçalho fica logo
    # acima dos preços, e olhar a página inteira pegaria a tabela anterior.
    # Sobe até achar o rótulo — ou até bater na TABELA ANTERIOR. O limite não é
    # um número de linhas (que erra quando o cabeçalho tem muitas), é a
    # fronteira real: linha com preço pertence à tabela de cima, e o PRODUTO
    # dela não é o desta.
    alvo = None
    for i in range(ini - 1, max(-1, ini - 30), -1):
        ws = linhas[i][1]
        if not ws:
            continue
        if _ROTULO_PRODUTO.match(ws[0]['text']):
            alvo = ws[1:]
            break
        # Linha de preço: é a tabela anterior. Para aqui.
        if sum(1 for w in ws if re.search(r'\d{1,3},\d{2}$', w['text'])) >= 2:
            break
    if not alvo:
        return []

    # AS COLUNAS JÁ EXISTEM — não invente distância.
    #
    # A primeira versão agrupava por um vão fixo de 26pt e fundia nomes
    # vizinhos: "PREMIUM 900 (CARE) PREMIUM 900 INFINITY 1000.11" saía como um
    # nome só. Qualquer número fixo erra, porque o espaçamento muda de PDF pra
    # PDF e de página pra página.
    #
    # As âncoras das colunas de preço são a geometria real da tabela. Cada
    # palavra vai pra âncora mais próxima; palavras da mesma âncora formam um
    # nome. Assim o agrupamento acompanha a tabela em vez de adivinhá-la.
    # PRIMEIRO junta as palavras de um mesmo nome, DEPOIS distribui.
    #
    # Distribuir palavra a palavra quebrava nomes de duas palavras: cada
    # coluna de preço tem âncora própria, e "SMART UP" caía metade numa e
    # metade na outra. Virou "SMART" e "UP".
    #
    # O corte entre um nome e o seguinte é medido, não chutado: o passo entre
    # colunas é a largura real de uma coluna nesta página, e um vão maior que
    # 40% dela é fronteira. Dentro de um nome as palavras quase se encostam.
    limite = max(14.0, (passo or 0) * 0.40)
    grupos, atual = [], []
    for w in alvo:
        if atual and (w['x0'] - atual[-1]['x1']) > limite:
            grupos.append(atual); atual = []
        atual.append(w)
    if atual:
        grupos.append(atual)

    nomes = []
    for g in grupos:
        txt = ' '.join(x['text'] for x in g).strip()
        if not _nome_de_produto(txt):
            continue
        nomes.append(((g[0]['x0'] + g[-1]['x1']) / 2.0, txt))

    if not nomes:
        return []

    # CADA COLUNA PEGA O NOME MAIS PRÓXIMO, e o mesmo nome pode servir a duas.
    #
    # A versão anterior guardava um nome por âncora e DESCARTAVA o segundo
    # quando dois caíam na mesma — e a coluna que perdeu o nome voltava pro
    # cabeçalho cru, com "AMB+HOSP+OBST ENFERM 41279" grudado.
    #
    # Um plano ocupa duas colunas quando tem enfermaria e apartamento, e o nome
    # vem escrito uma vez só, centralizado sobre as duas. É assim que a Hapvida
    # monta, e "mais próximo" resolve os dois casos sem descartar nada.
    fora = []
    for a in ancoras:
        melhor, dist = '', 1e9
        for x, nome in nomes:
            d = abs(x - a)
            if d < dist:
                melhor, dist = nome, d
        fora.append(melhor)
    return fora


def _planos_por_faixa(linhas, ini, fim, ancoras):
    """Nome de plano que aparece UMA vez e vale pra mais de uma coluna.

    Na Santa Tereza o "PLUS" fica centralizado sobre duas colunas (quarto
    coletivo e privativo). Nenhuma das duas o pega pelo centro, e as duas
    ficavam com "QUARTO COLETIVO" e "Quarto privativo" como nome de plano.

    Aqui cada nome reconhecido vale da posição dele PRA DIREITA, até o próximo
    nome — que é como o olho lê um banner sobre colunas.
    """
    achados = []
    for top, ws in linhas[ini:fim]:
        for w in ws:
            nome = _plano_conhecido(w['text'])
            if nome:
                achados.append((w['x0'], nome))
    if not achados:
        return [''] * len(ancoras)
    # MAIS PRÓXIMO, não "o último à esquerda". O "PLUS" da Santa Tereza fica
    # CENTRALIZADO sobre as duas colunas dele, então ele nasce à direita da
    # quarta — pela regra da esquerda, a quarta herdava o "REGIONAL" da coluna
    # anterior, que é preço de outro plano com nome errado.
    fora = []
    for a in ancoras:
        melhor, dist = '', 1e9
        for x, nome in achados:
            d = abs(x - a)
            if d < dist:
                melhor, dist = nome, d
        fora.append(melhor)
    return fora


def _cabecalho(linhas, ate, ancoras, passo, limite=10):
    # Dez linhas, nao seis: o cabecalho da Affix empilha nome, segmentacao,
    # coparticipacao, acomodacao e codigo ANS antes da primeira faixa, e com
    # seis o nome do plano ficava de fora — sobrava "MAIS", que nao casa com
    # nada. Subir mais e seguro porque a parada acontece no primeiro preco.
    """Palavras acima da grade, por coluna, e o texto comum a todas."""
    porcoluna = [[] for _ in ancoras]
    comum = []
    # Para de subir ao esbarrar num preco: acima desta grade pode estar OUTRA,
    # e puxar as linhas dela batizaria o Vera Ouro com o preco do Vera Prata
    # no nome ("R$ 913,50 VERA OURO" foi o que apareceu no teste).
    # Alem do preco, um SALTO VERTICAL tambem encerra o cabecalho. No manual
    # da Vera Cruz existe outra tabela logo acima, sem preco nenhum (produtos
    # x acomodacao) — so o espaco em branco separa as duas, e sem esta regra o
    # nome do plano saia com "VERA CRUZ HOSPITAL" grudado na frente.
    #
    # O tamanho do salto e RELATIVO ao passo das linhas da propria grade. Um
    # limite fixo em pontos serve pra um PDF e nao serve pro seguinte: com 25
    # pontos a tabela da Allcare perdia o cabecalho inteiro (as linhas dela sao
    # mais espacadas) e todos os planos dela sumiam sem erro nenhum.
    salto = max(20.0, passo * 1.9)
    i = ate - 1
    while (i > 0 and ate - i < limite
           and not _juntar_reais(linhas[i - 1][1])
           and linhas[i][0] - linhas[i - 1][0] <= salto):
        i -= 1
    for top, ws in linhas[i:ate]:
        for w in ws:
            j = _mais_perto(_centro(w), ancoras, limite=55)
            (porcoluna[j] if j is not None else comum).append(w['text'])
    return ([re.sub(r'\s+', ' ', ' '.join(c)).strip() for c in porcoluna],
            ' '.join(comum))



# ── VOCABULÁRIO DE PLANOS, POR OPERADORA ─────────────────────────────────────
#
# Nestes PDFs o nome do plano vive num banner que atravessa as colunas, e
# raspar o cabeçalho trazia junto pedaços de titulo: "TABELA CPS Atendimento em
# Ca", "EM À 29 VIDAS DIRIGIDO AMERI". Preço saía certo e nome saía impossível
# de casar com nada.
#
# Então em vez de adivinhar o nome, a gente RECONHECE num vocabulário que o
# Guilherme ditou. É o oposto de chutar: o nome só sai se for um plano que a
# operadora realmente vende.
#
# Coluna cujo cabeçalho não bater com nada da lista fica com o texto cru — e
# aparece no resumo como sujeira, que é o sinal de que falta plano aqui.
PLANOS_CONHECIDOS = [
    # Santa Tereza — Global, Regional, Plus e Dirigido Americana, cada um com
    # coparticipação parcial e completa.
    (r'dirigido\s*americana', 'Dirigido Americana'),
    (r'\bglobal\b',           'Global'),
    (r'\bregional\b',         'Regional'),
    (r'\bplus\b',             'Plus'),
    # MedSênior — CPS é a linha de Campinas; Black e Infinite são as de cima.
    # No PME os nomes ganham "Corporate".
    (r'\binfinite\b',         'Infinite'),
    (r'\bblack\s*\d?\b',     'Black'),
    (r'\bcps\b',              'CPS'),
]


def _plano_conhecido(texto, modalidade=''):
    """Acha o nome do plano dentro do cabeçalho bagunçado, ou devolve ''."""
    t = _sem_acento(texto).lower()
    for padrao, nome in PLANOS_CONHECIDOS:
        if re.search(padrao, t):
            # No PME a MedSenior chama de Corporate. O sufixo vem da
            # modalidade, nao do texto — o PDF nem sempre escreve.
            if nome in ('CPS', 'Black', 'Infinite') and modalidade == 'PME':
                return nome + ' Corporate'
            return nome
    return ''

_ACOM = [('apartamento', 'Apartamento'), ('enfermaria', 'Enfermaria'),
         ('individual', 'Apartamento'), ('coletiv', 'Enfermaria')]


def _campos(coluna, comum, pagina_txt, modalidade=''):
    """Separa nome do plano, acomodacao e codigo ANS do cabecalho da coluna."""
    txt = coluna + ' ' + comum
    puro = _sem_acento(txt).lower()

    acom = ''
    for chave, nome in _ACOM:
        if chave in puro:
            acom = nome
            break

    m = re.search(r'\b(\d{3}[./]\d{3}[./]\d{2}-\d)\b', txt)
    ans = m.group(1) if m else ''

    # O vocabulário primeiro. Só se ele não reconhecer nada é que sobra a
    # limpeza por remoção de rótulo, que é o método frágil.
    conhecido = _plano_conhecido(coluna, modalidade)
    if conhecido:
        return conhecido, acom, ans

    nome = coluna
    for lixo in [ans, 'Enfermaria', 'Apartamento', 'Grupo de municípios',
                 'Grupo de municipios', 'Faixa etária', 'Faixa etaria']:
        if lixo:
            nome = nome.replace(lixo, ' ')
    nome = re.sub(r'\s+', ' ', nome).strip(' .-')
    return nome, acom, ans


def _passo(linhas, inicio, precos):
    """Distancia tipica entre duas linhas de faixa desta grade."""
    tops = [t for t, _ in linhas[inicio:inicio + len(precos) * 3]]
    gaps = sorted(b - a for a, b in zip(tops, tops[1:]) if b > a)
    return gaps[len(gaps) // 2] if gaps else 18.0


def _contexto(texto, herdado):
    """Dimensoes que valem pra pagina: modalidade, copart, administradora...

    Sao herdadas: o cabecalho que declara "ADESAO" ou "Affix" aparece uma vez,
    na capa, e as paginas de preco seguintes nao repetem. Zerar a cada pagina
    faria a tabela nascer sem modalidade — e a rota de importacao recusa, com
    razao, tabela sem dimensao. Foi o que aconteceu na primeira tentativa: as
    10 tabelas da Vera Cruz foram todas recusadas.
    """
    c = dict(herdado)
    t = _sem_acento(texto).lower()

    if 'por adesao' in t or 'adesao' in t:
        c['modalidade'] = 'Adesao'
    elif 'pessoa fisica' in t or 'individual' in t:
        c['modalidade'] = 'Individual'
    elif ' pme' in t or ' pj' in t:
        c['modalidade'] = 'PME'

    for chave, nome in [('affix', 'Affix'), ('allcare', 'Allcare'),
                        ('2care', 'Allcare'), ('corpe', 'Corpe')]:
        if chave in t:
            c['administradora'] = nome
            break

    # A string vai como o PDF escreve. Traduzir "com coparticipacao" pro
    # vocabulario do Painel ("Completa"/"Parcial") e adivinhacao, e adivinhar
    # aqui guarda preco certo na coparticipacao errada.
    if 'sem coparticipacao' in t:
        c['coparticipacao'] = 'Sem'
    elif 'coparticipacao total' in t:
        c['coparticipacao'] = 'Total'
    # A Santa Tereza nao escreve "coparticipacao parcial": escreve
    # "COPARTICIPACAO POR EVENTO   PARCIAL", com o rotulo longe da palavra.
    # Sem isto a pagina inteira saia sem coparticipacao — e a rota de
    # importacao recusa, com razao, tabela sem essa dimensao.
    elif re.search(r'coparticipacao[^\n]{0,60}parcial', t) or 'copart parcial' in t:
        c['coparticipacao'] = 'Parcial'
    elif 'com coparticipacao' in t or 'participativos' in t:
        c['coparticipacao'] = 'Com coparticipacao'

    # PROMOCIONAL x ATUAL SAO TABELAS DIFERENTES DO MESMO PLANO.
    #
    # A Santa Tereza publica as duas no mesmo PDF: "Tabela promocional PME" e
    # "Tabela atual PME 2025", com precos diferentes pro mesmo Global/Enfermaria.
    # Sem separar, a segunda sobrescreve a primeira — o defeito de sempre, e o
    # mais caro deles, porque promocional tem prazo e a atual nao.
    if re.search(r'tabela\s+promocional', t):
        c['linha'] = 'Promocional'
    elif re.search(r'tabela\s+atual', t):
        c['linha'] = 'Atual'

    m = re.search(r'grupo de munic[a-z]*\s*\n?\s*([a-z ]{3,30})', t)
    if m:
        c['abrangencia'] = _sem_acento(m.group(1)).strip().title()

    # QUANTAS VIDAS: adesao e individual nao tem faixa de vidas — o preco e por
    # pessoa. Mas a tabela do JOB exige a faixa preenchida (linha sem faixa foi
    # o defeito que a gente consertou), entao vai 1 a 999, que quer dizer
    # "serve pra qualquer quantidade". Deixar nulo faria a rota recusar; chutar
    # "2 a 29" seria inventar uma regra que a operadora nao tem.
    m = re.search(r'(\d+)\s*a\s*(\d+)\s*vidas', t)
    if m:
        c['vidas_min'], c['vidas_max'] = int(m.group(1)), int(m.group(2))
    elif c.get('vidas_min') is None and c.get('modalidade'):
        # Nenhuma faixa declarada = o preco nao varia por quantidade de vidas.
        # Vale pra adesao e individual (preco por pessoa) e tambem pra PME de
        # operadora que publica uma tabela so, como a Vera Cruz.
        c['vidas_min'], c['vidas_max'] = 1, 999
    return c


def _do_caminho(caminho):
    """Modalidade e administradora deduzidas da PASTA.

    A tabela da Allcare nao escreve "adesao" em lugar nenhum do PDF — quem
    sabe que ela e de adesao e o organizador, que ja classificou o arquivo
    lendo o conteudo. Usar a pasta aqui e reaproveitar essa decisao, nao
    chutar; e ela so entra quando o PDF nao disser nada.
    """
    partes = [_sem_acento(x).lower() for x in caminho.split(os.sep)]
    fora = {}
    for p in partes:
        if p in ('adesao', 'pme', 'individual'):
            fora['modalidade'] = {'adesao': 'Adesao', 'pme': 'PME',
                                  'individual': 'Individual'}[p]
        if p in ('affix', 'allcare', 'corpe'):
            fora['administradora'] = p.title()
    return fora


def ler_pdf(caminho):
    saida = []
    ctx = {'modalidade': '', 'administradora': '', 'coparticipacao': '',
           'abrangencia': '', 'vidas_min': None, 'vidas_max': None, 'linha': ''}
    ctx.update(_do_caminho(caminho))
    with pdfplumber.open(caminho) as pdf:
        for npag, pagina in enumerate(pdf.pages, 1):
            txt = pagina.extract_text() or ''
            ctx = _contexto(txt + '\n' + _texto_pdftotext(caminho, npag), ctx)
            for ancoras, precos, inicio, linhas in _grades_da_pagina(pagina):
                passo = _passo(linhas, inicio, precos)
                colunas, comum = _cabecalho(linhas, inicio, ancoras, passo)
                # O banner de plano pode ficar acima do bloco que o _cabecalho
                # recorta, e cobrir mais de uma coluna. Esta varredura olha um
                # pedaço maior e resolve por posição.
                banner = _planos_por_faixa(linhas, max(0, inicio - 12), inicio, ancoras)
                # ROTULADO GANHA DE TUDO. Quando a operadora escreve "PRODUTO:
                # SMART UP", esse é o nome — não o que a gente reconheceu num
                # vocabulário nem o que sobrou do cabeçalho raspado.
                rotulado = _produto_rotulado(linhas, inicio, ancoras, passo)
                for j, coluna in enumerate(colunas):
                    nome, acom, ans = _campos(coluna, comum, txt, ctx.get('modalidade') or '')
                    if banner[j] and not _plano_conhecido(coluna):
                        nome = banner[j]
                    if rotulado and rotulado[j]:
                        nome = rotulado[j]
                    else:
                        # Sem rótulo achado: pelo menos tira do nome o que já
                        # tem coluna própria. Nome com código e segmentação
                        # dentro não casa com catálogo nenhum.
                        limpo = _limpar_nome(nome)
                        if limpo:
                            nome = limpo
                    if not nome:
                        continue
                    linha = dict(ctx)
                    linha.update({
                        'arquivo': os.path.basename(caminho), 'pagina': npag,
                        'plano': nome, 'acomodacao': acom, 'ans': ans,
                        'codigo': ans,
                        'faixas': {fx: col[j] for fx, col in precos.items()},
                    })
                    saida.append(linha)
    return saida


def _pdfs(alvo):
    if os.path.isfile(alvo):
        return [alvo]
    achados = []
    for raiz, _, arqs in os.walk(alvo):
        achados += [os.path.join(raiz, a) for a in sorted(arqs)
                    if a.lower().endswith('.pdf')]
    return achados


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    tudo = []
    for p in _pdfs(sys.argv[1]):
        try:
            t = ler_pdf(p)
        except Exception as e:
            print('FALHOU %s: %s' % (os.path.basename(p), e), file=sys.stderr)
            continue
        print('%-46s %3d tabelas' % (os.path.basename(p)[:46], len(t)),
              file=sys.stderr)
        tudo += t
    print('TOTAL %d tabelas, %d precos' %
          (len(tudo), sum(len(t['faixas']) for t in tudo)), file=sys.stderr)

    if '--resumo' in sys.argv:
        for t in tudo:
            print('p%-3d %-28s %-12s %-14s %s' %
                  (t['pagina'], t['plano'][:28], t['acomodacao'], t['ans'],
                   ' '.join('%s=%s' % (k, v)
                            for k, v in list(t['faixas'].items())[:3])),
                  file=sys.stderr)
    else:
        json.dump(tudo, sys.stdout, ensure_ascii=False, indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
