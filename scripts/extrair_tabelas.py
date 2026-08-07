#!/usr/bin/env python3
"""Le os PDFs de tabela de preco e devolve preco por faixa, em JSON.

POR QUE NAO DA PRA LER O TEXTO CORRIDO
--------------------------------------
`pdftotext -layout` produz uma grade bonita de olhar e traicoeira de
programar: nome de plano tem espaco no meio ("Amil Prata"), rotulo de faixa
quebra em duas linhas ("00-" / "18"), e coluna vazia vira espaco que some.
Partir por espaco erra a coluna em silencio — e errar coluna aqui e dizer
que o Prata custa o preco do Ouro.

Entao a leitura e por POSICAO. Cada palavra do PDF tem x e y. As colunas sao
ancoradas na linha "Acomodacao", onde cada coluna tem exatamente um token
(QC ou QP), e cada preco vai pra ancora mais proxima do seu centro. Nome de
plano e codigo entram pela mesma regra. Coluna que nao existe nao tem ancora,
entao nao ha pra onde o preco errado ir.

O QUE ELE NAO FAZ
-----------------
Nao grava no banco. Cospe JSON pra conferencia. Gravar preco errado e caro
de desfazer; olhar antes e barato.

Uso:
    .venv/bin/python scripts/extrair_tabelas.py tabelas-operadoras/Amil > amil.json
    .venv/bin/python scripts/extrair_tabelas.py <pdf> --resumo
"""
import json
import os
import re
import sys
import unicodedata

import pdfplumber

FAIXAS = ['00-18', '19-23', '24-28', '29-33', '34-38',
          '39-43', '44-48', '49-53', '54-58', '59 ou +']

# O rotulo da ultima faixa quebra em duas linhas de um jeito que o extrator
# de palavras devolve como "59" e "ou +" separados; e as outras as vezes vem
# como "00-" / "18". Normalizar aqui evita um `if` em cada uso.
_FX_SOLTA = re.compile(r'^(\d{2})-?$')


def _sem_acento(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s)
                   if unicodedata.category(c) != 'Mn')


def _num(t):
    """'1.234,56' -> 1234.56. Nao e preco -> None."""
    # O PDF escreve milhar dos dois jeitos: "1.129,94" numa tabela e "1129,94"
    # noutra. Exigir o ponto derrubava a linha de 59+ das tabelas caras — e a
    # grade inteira era recusada por faltar uma faixa.
    if not re.fullmatch(r'\d+(\.\d{3})*,\d{2}', t):
        return None
    return float(t.replace('.', '').replace(',', '.'))


def _linhas(palavras, tol=4):
    """Agrupa palavras em linhas visuais pelo topo, com tolerancia."""
    out = []
    for w in sorted(palavras, key=lambda w: (w['top'], w['x0'])):
        if out and abs(w['top'] - out[-1][0]) <= tol:
            out[-1][1].append(w)
        else:
            out.append([w['top'], [w]])
    return [(t, sorted(ws, key=lambda w: w['x0'])) for t, ws in out]


def _centro(w):
    return (w['x0'] + w['x1']) / 2.0


def _mais_perto(x, ancoras, limite=40):
    """Indice da ancora mais proxima, ou None se nenhuma estiver perto.

    O limite existe pra que rotulo de faixa e texto solto da margem nao sejam
    puxados pra dentro de uma coluna.
    """
    melhor, dist = None, limite
    for i, a in enumerate(ancoras):
        d = abs(x - a)
        if d < dist:
            melhor, dist = i, d
    return melhor


def _contexto(pagina_texto, anterior):
    """Cabecalho que vale pra pagina: modalidade, vidas, regiao, copart.

    O cabecalho nem sempre se repete na pagina da tabela — as vezes ele esta
    na pagina anterior. Por isso o contexto e HERDADO: o que a pagina nao
    disser continua valendo da ultima que disse. Zerar a cada pagina faria a
    tabela nascer sem faixa de vidas, que e justamente a dimensao que a gente
    consertou pra nao perder.
    """
    c = dict(anterior)
    t = _sem_acento(pagina_texto)

    m = re.search(r'Total de ([\d]+)(?:\s*a\s*(\d+))? vidas', t)
    if m:
        c['vidas_min'] = int(m.group(1))
        c['vidas_max'] = int(m.group(2)) if m.group(2) else int(m.group(1))
    # O hifen faz parte do nome: "INTERIOR SP - 1" e "INTERIOR SP - 2" sao
    # regioes de PRECO diferentes. Recortar no hifen juntava as duas numa so
    # — e a segunda sobrescreveria a primeira, que e o defeito que essa tabela
    # inteira existe pra evitar.
    m = re.search(r'Regiao:\s*([A-Za-z0-9 -]+?)\s*\n', t)
    if m:
        c['regiao'] = m.group(1).strip()
    m = re.search(r'Planos ([A-Za-z]+) -', t)
    if m:
        c['modalidade'] = m.group(1).strip()
    m = re.search(r'Tabela de Precos\s*-\s*(.+)', t)
    if m:
        c['linha'] = m.group(1).strip()

    if 'Sem Coparticipacao' in t:
        c['coparticipacao'] = 'Sem'
    elif 'Com Coparticipacao Parcial' in t:
        c['coparticipacao'] = 'Parcial (TP)'
    elif re.search(r'Com Coparticipacao\s*30', t):
        c['coparticipacao'] = '30%'
    return c


def _blocos_da_pagina(pagina):
    """Cada tabela da pagina -> (mei, ancoras, planos, acomodacoes, precos, codigos).

    Uma pagina tem uma ou duas tabelas, separadas pelos titulos "Demais
    empresas" e "MEI". Essa palavra e a UNICA coisa que distingue duas tabelas
    com preco diferente pro mesmo plano — perde-la e reintroduzir o defeito de
    sobrescrever preco certo com preco certo.
    """
    linhas = _linhas(pagina.extract_words())
    # Marca onde comeca cada bloco e se ele e MEI.
    marcos = []
    for i, (top, ws) in enumerate(linhas):
        txt = _sem_acento(' '.join(w['text'] for w in ws)).strip()
        if txt == 'MEI':
            marcos.append((i, 1))
        elif txt.startswith('Demais empresas'):
            marcos.append((i, 0))
    if not marcos:
        marcos = [(0, 0)]

    blocos = []
    for n, (ini, mei) in enumerate(marcos):
        fim = marcos[n + 1][0] if n + 1 < len(marcos) else len(linhas)
        blocos.append((mei, linhas[ini:fim]))
    return blocos


def _fatiar_por_tabela(linhas):
    """Um bloco pode conter MAIS DE UMA tabela — fatia numa lista.

    Uma pagina traz, por exemplo, "Bronze SP / SP Mais" e logo abaixo
    "Prata / Ouro / Platinum": mesmo titulo ("Demais empresas"), duas grades
    com colunas diferentes. Ler so a primeira descartava metade dos planos em
    silencio — o total batia como plausivel e faltava plano que existe.

    A linha "Acomodacao" e o comeco de cada grade.
    """
    marcos = [i for i, (top, ws) in enumerate(linhas)
              if _sem_acento(ws[0]['text']).startswith('Acomodac')]

    def _cabecalho(ate):
        """Linhas de nome do plano: sobe ate esbarrar em preco.

        Nao da pra pegar 'tudo acima': acima da segunda grade esta a PRIMEIRA,
        com precos e codigos dela. Puxar isso batizaria o Prata com o codigo
        do Bronze. Preco e a fronteira natural entre uma grade e a de cima.
        """
        # No maximo quatro linhas acima. O nome do plano nunca ocupa mais que
        # isso, e sem o teto uma pagina que comeca com paragrafo explicativo
        # (sem preco pra servir de fronteira) transformava a explicacao em
        # nome de plano — "o primeiro corretor Autori" virou plano numa
        # rodada de teste.
        topo = linhas[ate][0]
        i = ate - 1
        while i >= 0 and ate - i <= 4 and topo - linhas[i][0] <= 45:
            if any(_num(w['text']) is not None or re.fullmatch(r'9\d{5}', w['text'])
                   for w in linhas[i][1]):
                break
            i -= 1
        return linhas[i + 1:ate]

    return [(_cabecalho(ini),
             linhas[ini: (marcos[n + 1] if n + 1 < len(marcos) else len(linhas))])
            for n, ini in enumerate(marcos)]


def _ler_bloco(mei, linhas, anteriores):
    """Uma grade -> dict com planos e precos, ou None.

    `anteriores` sao as linhas acima desta grade dentro do bloco: e de la que
    vem o nome do plano, porque o cabecalho fica acima da linha "Acomodacao".
    """
    idx_acom = 0
    acom_ws = [w for w in linhas[idx_acom][1]
               if w['text'].upper() in ('QC', 'QP')]
    if not acom_ws:
        return None
    ancoras = [_centro(w) for w in acom_ws]
    acomodacoes = [w['text'].upper() for w in acom_ws]

    # Nome do plano: tudo acima da linha de acomodacao que caia numa coluna.
    # Vem quebrado em varias linhas ("Amil" / "Bronze" / "SP Mais") e a ordem
    # de leitura (topo, depois x) reconstroi o nome na ordem certa.
    nomes = [[] for _ in ancoras]
    for top, ws in anteriores:
        for w in ws:
            if _sem_acento(w['text']).strip() in ('Plano', 'Demais', 'empresas', 'MEI'):
                continue
            j = _mais_perto(_centro(w), ancoras)
            if j is not None:
                nomes[j].append(w['text'])
    planos = [re.sub(r'\s+', ' ', ' '.join(n)).strip() for n in nomes]

    # A FAIXA VEM DA ORDEM, NAO DO ROTULO.
    #
    # Ler o rotulo parece o certo e nao e: quando a coluna e estreita, o PDF
    # quebra "00-18" em tres linhas visuais — "00-", depois a linha inteira de
    # precos, depois "18". Quem tenta remontar o texto perde a ligacao entre o
    # rotulo e a linha de preco, e o resultado sai deslocado de uma faixa: o
    # preco de 19-23 gravado como 00-18, em silencio.
    #
    # A ordem, essa nao quebra. Toda grade traz as dez faixas, de cima pra
    # baixo, sempre nesta sequencia. Se vierem menos de dez, a grade nao e o
    # que a gente pensa e ela e recusada inteira — melhor faltar tabela do que
    # ter tabela torta.
    precos = {}
    codigos = [''] * len(ancoras)
    ordem = []
    for top, ws in linhas[idx_acom + 1:]:
        valores = {}
        for w in ws:
            t = w['text'].strip()
            if re.fullmatch(r'9\d{5}', t):
                j = _mais_perto(_centro(w), ancoras)
                if j is not None:
                    codigos[j] = t
                continue
            v = _num(t)
            if v is None:
                continue
            j = _mais_perto(_centro(w), ancoras)
            if j is not None:
                valores[j] = v
        if valores:
            ordem.append(valores)

    if len(ordem) != len(FAIXAS):
        return None
    for i, valores in enumerate(ordem):
        precos[FAIXAS[i]] = valores
    return {'mei': mei, 'planos': planos, 'acomodacoes': acomodacoes,
            'codigos': codigos, 'precos': precos}


def ler_pdf(caminho):
    """-> lista de tabelas, cada uma ja com o contexto do cabecalho."""
    saida = []
    ctx = {'vidas_min': None, 'vidas_max': None, 'regiao': '',
           'modalidade': '', 'linha': '', 'coparticipacao': ''}
    with pdfplumber.open(caminho) as pdf:
        for pagina in pdf.pages:
            ctx = _contexto(pagina.extract_text() or '', ctx)
            grades = [(mei, cab, gr)
                      for mei, linhas in _blocos_da_pagina(pagina)
                      for cab, gr in _fatiar_por_tabela(linhas)]
            for mei, cabecalho, grade in grades:
                b = _ler_bloco(mei, grade, cabecalho)
                if not b:
                    continue
                for j, plano in enumerate(b['planos']):
                    if not plano:
                        continue
                    faixas = {}
                    for fx, col in b['precos'].items():
                        if j in col:
                            faixas[fx] = col[j]
                    if not faixas:
                        continue
                    saida.append({
                        'arquivo': os.path.basename(caminho),
                        'linha': ctx['linha'], 'regiao': ctx['regiao'],
                        'modalidade': ctx['modalidade'],
                        'vidas_min': ctx['vidas_min'], 'vidas_max': ctx['vidas_max'],
                        'coparticipacao': ctx['coparticipacao'],
                        'mei': b['mei'], 'plano': plano,
                        'acomodacao': b['acomodacoes'][j],
                        'codigo': b['codigos'][j], 'faixas': faixas,
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
    alvo = sys.argv[1]
    resumo = '--resumo' in sys.argv

    tudo = []
    for p in _pdfs(alvo):
        try:
            t = ler_pdf(p)
        except Exception as e:
            print('FALHOU %s: %s' % (os.path.basename(p), e), file=sys.stderr)
            continue
        print('%-50s %4d tabelas' % (os.path.basename(p)[:50], len(t)),
              file=sys.stderr)
        tudo += t

    faltando = [t for t in tudo if not t['vidas_min'] or not t['coparticipacao']]
    if faltando:
        print('AVISO: %d tabela(s) sem faixa de vidas ou sem coparticipacao — '
              'nao devem ser gravadas.' % len(faltando), file=sys.stderr)

    print('TOTAL %d tabelas, %d precos' %
          (len(tudo), sum(len(t['faixas']) for t in tudo)), file=sys.stderr)

    if resumo:
        for t in tudo[:20]:
            print('%-26s %-4s %-12s vidas %s-%s mei=%d  %s' %
                  (t['plano'][:26], t['acomodacao'], t['coparticipacao'],
                   t['vidas_min'], t['vidas_max'], t['mei'],
                   ' '.join('%s=%s' % (k, v) for k, v in
                            list(t['faixas'].items())[:3])), file=sys.stderr)
    else:
        json.dump(tudo, sys.stdout, ensure_ascii=False, indent=1)
    return 0


if __name__ == '__main__':
    sys.exit(main())
