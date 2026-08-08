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

import pdfplumber

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
        esperada = FAIXAS[len(corrente)] if len(corrente) < len(FAIXAS) else None
        if rotulo != esperada:
            if len(corrente) == len(FAIXAS):
                achadas.append(corrente)
            corrente = [(i, rotulo, valores)] if rotulo == FAIXAS[0] else []
            continue
        corrente.append((i, rotulo, valores))
    if len(corrente) == len(FAIXAS):
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


_ACOM = [('apartamento', 'Apartamento'), ('enfermaria', 'Enfermaria'),
         ('individual', 'Apartamento'), ('coletiv', 'Enfermaria')]


def _campos(coluna, comum, pagina_txt):
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


def ler_pdf(caminho):
    saida = []
    with pdfplumber.open(caminho) as pdf:
        for npag, pagina in enumerate(pdf.pages, 1):
            txt = pagina.extract_text() or ''
            for ancoras, precos, inicio, linhas in _grades_da_pagina(pagina):
                passo = _passo(linhas, inicio, precos)
                colunas, comum = _cabecalho(linhas, inicio, ancoras, passo)
                for j, coluna in enumerate(colunas):
                    nome, acom, ans = _campos(coluna, comum, txt)
                    if not nome:
                        continue
                    saida.append({
                        'arquivo': os.path.basename(caminho), 'pagina': npag,
                        'plano': nome, 'acomodacao': acom, 'ans': ans,
                        'faixas': {fx: col[j] for fx, col in precos.items()},
                    })
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
