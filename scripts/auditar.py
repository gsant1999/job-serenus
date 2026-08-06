#!/usr/bin/env python3
"""Auditoria rápida de uma entrega no app.py — estática, sem rede, sem IA.

    .venv/bin/python scripts/auditar.py            # o que está sem commit
    .venv/bin/python scripts/auditar.py <ref>      # um commit ou branch

Cada checagem aqui nasceu de um defeito que JÁ passou nesta base e custou
tempo. Não é lint genérico: é a lista dos erros que este projeto comete.

  COLUNA INEXISTENTE  crm_leads.fbclid (7bf5bbc) e cotacao_salva.valor_total
                      (004b4ad). Os dois passaram por revisão humana e só
                      apareceram porque alguém consultou o banco. É a checagem
                      mais valiosa daqui.
  EXCECAO CRUA        str(e) no campo `erro` entrega a stack do Postgres pro
                      consultor (004b4ad).
  is_pg FORA          é local de init_db(); fora dela levanta NameError que o
                      try/except engole.
  DEPOIS DO close_db  código após ele falha em silêncio. 3 ocorrências.
  CODIGO MORTO        94 linhas inalcançáveis embaixo de um return (26354).
  FRONTEIRA           app.py é do Antigravity; templates/ e extensao-whatsapp/
                      são do Claude Code.
"""
import ast
import re
import subprocess
import sys

APP = 'app.py'


def sh(*args):
    return subprocess.run(args, capture_output=True, text=True).stdout


def linhas_novas(ref):
    """Só as linhas ACRESCENTADAS, com o número no arquivo final."""
    diff = sh('git', 'diff', '-U0', ref, '--', APP) if ref else sh('git', 'diff', '-U0', '--', APP)
    out, n = [], 0
    for l in diff.split('\n'):
        m = re.match(r'^@@ -\d+(?:,\d+)? \+(\d+)', l)
        if m:
            n = int(m.group(1)) - 1
            continue
        if l.startswith('+') and not l.startswith('+++'):
            n += 1
            out.append((n, l[1:]))
        elif not l.startswith('-'):
            n += 1
    return out


def esquema(fonte):
    """Colunas de cada tabela: CREATE TABLE + a lista de migrações."""
    cols = {}
    for m in re.finditer(r'CREATE TABLE IF NOT EXISTS (\w+)\s*\((.*?)\n\s*\)', fonte, re.S):
        tab, corpo = m.group(1), m.group(2)
        s = cols.setdefault(tab, set())
        for linha in corpo.split(','):
            c = re.match(r'\s*(\w+)\s+[A-Za-z]', linha.strip())
            if c and c.group(1).upper() not in ('PRIMARY', 'FOREIGN', 'UNIQUE', 'CHECK'):
                s.add(c.group(1).lower())
    # O terceiro elemento tem aspas DENTRO ("TEXT DEFAULT ''"), entao nao da
    # pra fechar com [^"']* — foi assim que 'entidade' passou por nao-coluna.
    for m in re.finditer(r'\(\s*["\'](\w+)["\']\s*,\s*["\'](\w+)["\']\s*,', fonte):
        cols.setdefault(m.group(1), set()).add(m.group(2).lower())
    return cols


SQL_PALAVRAS = {
    'select', 'from', 'where', 'and', 'or', 'not', 'null', 'is', 'as', 'on', 'in',
    'count', 'sum', 'avg', 'min', 'max', 'coalesce', 'cast', 'text', 'integer', 'real',
    'order', 'by', 'group', 'having', 'limit', 'offset', 'desc', 'asc', 'join', 'left',
    'inner', 'outer', 'distinct', 'set', 'values', 'into', 'insert', 'update', 'delete',
    'case', 'when', 'then', 'else', 'end', 'like', 'ilike', 'exists', 'union', 'all',
    'now', 'interval', 'filter', 'over', 'lower', 'upper', 'substr', 'length', 'trim',
    'date_trunc', 'string_agg', 'nullif', 'lastval', 'last_insert_rowid', 'true', 'false',
    'c', 'n', 'p', 't', 'l', 'r', 'x', 'v', 'id', 'day', 'days', 'hours', 'month', 'year',
    # Python que aparece colado no SQL e não é coluna nenhuma.
    'fetchone', 'fetchall', 'execute', 'format', 'strip', 'lower', 'upper', 'join',
    'append', 'conn', 'cur', 'self', 'json', 'dumps', 'loads', 'int', 'float', 'str',
    'true', 'false', 'none', 'else', 'elif', 'return', 'except', 'try', 'with', 'for',
    'marc', 'params', 'linhas', 'rows', 'row', 'dict', 'list', 'keys', 'items', 'get',
}


def checar_dicionario(novas, todas_colunas):
    """d.get('coluna') / d['coluna'] com nome que não existe em tabela nenhuma.

    É o defeito do valor_total (004b4ad): a coluna chama-se `total`, o código
    lia `valor_total`, o get devolvia None, o `or 0` virava 0.0 e R$ 84 mil
    apareceram como R$ 0,00 na tela. Não passa por SQL, então a checagem de
    coluna não pega — mas o nome não existe em lugar nenhum do banco.

    Só acusa quando o nome PARECE coluna (tem underline e um pedaço que é
    coluna de verdade), pra não reclamar de toda chave de dicionário do
    arquivo."""
    erros = []
    for n, txt in novas:
        for m in re.finditer(r"""(?:\.get\(|\[)\s*['"]([a-z][a-z0-9_]{4,})['"]""", txt):
            nome = m.group(1)
            if nome in todas_colunas or '_' not in nome:
                continue
            pedacos = nome.split('_')
            # "valor_total" tem "total", que é coluna. "planos_cotados" não tem
            # pedaço que seja coluna — provavelmente é chave de payload mesmo.
            if any(p in todas_colunas for p in pedacos if len(p) > 3):
                perto = [c for c in todas_colunas if any(p in c for p in pedacos if len(p) > 3)]
                erros.append((n, nome, sorted(perto)[:4], txt.strip()[:80]))
    return erros


def checar_colunas(novas, cols):
    """Coluna citada que não existe na tabela — o defeito mais caro daqui."""
    erros = []
    for n, txt in novas:
        # Varre só o TEXTO DO SQL, não a linha Python inteira.
        #
        # Varrendo a linha toda, `passo3_ok = conn.execute("SELECT ...")` fazia
        # `passo3_ok` (nome de variável) virar "coluna inexistente", e o mesmo
        # com valor de string e alias. Cinco falsos positivos numa entrega
        # limpa — e auditor que grita à toa é auditor que ninguém lê.
        for sql in re.findall(r'["\']{1,3}([^"\']*\bFROM\b[^"\']*)["\']{1,3}', txt, re.I | re.S):
            m = re.search(r'\bFROM\s+(\w+)\b', sql, re.I)
            if not m:
                continue
            tab = m.group(1)
            if tab not in cols:
                continue
            # Fora: o que vem depois de `as` (apelido) e o que está entre
            # aspas dentro do próprio SQL (valor, não coluna).
            limpo = re.sub(r"'[^']*'", ' ', sql)
            limpo = re.sub(r'\bas\s+\w+', ' ', limpo, flags=re.I)
            trecho = limpo
            for ident in re.findall(r'\b([a-z][a-z0-9_]{3,})\b', trecho):
                if ident in SQL_PALAVRAS or ident in cols or ident in cols[tab]:
                    continue
                # Existir em OUTRA tabela so perdoa quando ha JOIN. Sem join, a
                # coluna tem que ser DAQUELA tabela — foi exatamente assim que
                # crm_leads.fbclid passou (fbclid existe, mas em meta_conversoes)
                # e a tela desenhou zeros que ninguem mediu (7bf5bbc).
                if re.search(r'\bJOIN\b', txt, re.I):
                    if any(ident in outras for outras in cols.values()):
                        continue
                elif ident not in cols[tab] and not any(
                        ident in outras for outras in cols.values()):
                    pass                      # nao existe em lugar nenhum: acusa
                elif ident not in cols[tab]:
                    erros.append((n, tab, ident + ' (existe em outra tabela)', txt.strip()[:90]))
                    continue
                erros.append((n, tab, ident, txt.strip()[:90]))
    return erros


def main():
    ref = sys.argv[1] if len(sys.argv) > 1 else None
    fonte = open(APP, encoding='utf-8').read()
    achados = []

    # 0. FRONTEIRA — quem mexeu no que
    st = sh('git', 'diff', '--name-only', ref) if ref else sh('git', 'diff', '--name-only')
    fora = [f for f in st.split('\n')
            if f and f != APP and (f.startswith('templates/') or f.startswith('extensao-whatsapp/'))]
    if fora:
        achados.append(('FRONTEIRA', 0,
                        'arquivo do Claude Code alterado: ' + ', '.join(fora[:4])))

    # 1. SINTAXE — nada mais faz sentido se isto falha
    try:
        ast.parse(fonte)
    except SyntaxError as e:
        print(f"SINTAXE QUEBRADA na linha {e.lineno}: {e.msg}")
        return 2

    novas = linhas_novas(ref)
    if not novas:
        print("Nenhuma linha nova em app.py.")
        return 0

    cols = esquema(fonte)

    for n, tab, ident, txt in checar_colunas(novas, cols):
        achados.append(('COLUNA INEXISTENTE', n, f"{tab}.{ident}  →  {txt}"))

    todas_cols = set()
    for s in cols.values():
        todas_cols |= s
    for n, nome, perto, txt in checar_dicionario(novas, todas_cols):
        achados.append(('CHAVE SUSPEITA', n,
                        f"'{nome}' não é coluna. Existe: {', '.join(perto)}  →  {txt}"))

    for n, txt in novas:
        if re.search(r'["\']erro["\']\s*:\s*str\(e\)', txt):
            achados.append(('EXCECAO CRUA', n, 'str(e) vai pro cliente: ' + txt.strip()[:70]))
        if re.search(r'\bis_pg\b', txt):
            achados.append(('is_pg', n, 'confirme que está dentro de init_db(): ' + txt.strip()[:60]))
        if re.search(r'@app\.route', txt):
            achados.append(('ROTA NOVA', n, 'confira o decorator de permissão: ' + txt.strip()[:70]))

    # 2. CODIGO APOS close_db, e CODIGO MORTO — precisa da estrutura, não da linha
    arv = ast.parse(fonte)
    novas_ns = {n for n, _ in novas}
    for fn in [x for x in ast.walk(arv) if isinstance(x, (ast.FunctionDef, ast.AsyncFunctionDef))]:
        corpo = fn.body
        for i, no in enumerate(corpo):
            ln = getattr(no, 'lineno', 0)
            if isinstance(no, ast.Return) and i < len(corpo) - 1:
                mortas = sum(1 for x in corpo[i + 1:])
                if any(getattr(x, 'lineno', 0) in novas_ns for x in corpo[i + 1:]) or ln in novas_ns:
                    achados.append(('CODIGO MORTO', ln,
                                    f"{mortas} bloco(s) inalcançáveis depois do return em {fn.name}()"))
            if (isinstance(no, ast.Expr) and isinstance(no.value, ast.Call)
                    and getattr(no.value.func, 'id', '') == 'close_db'):
                depois = [x for x in corpo[i + 1:]
                          if 'conn.execute' in ast.dump(x) or 'conn.commit' in ast.dump(x)]
                if depois and (ln in novas_ns or any(getattr(x, 'lineno', 0) in novas_ns for x in depois)):
                    achados.append(('DEPOIS DO close_db', ln,
                                    f"{fn.name}() usa conn depois de fechar — falha em silêncio"))

    # ── Relatório ──
    print(f"Auditoria de {APP}" + (f" ({ref})" if ref else " (sem commit)") +
          f" — {len(novas)} linha(s) nova(s)\n")
    if not achados:
        print("  Nada a apontar nas checagens automáticas.")
    else:
        ordem = {'FRONTEIRA': 0, 'COLUNA INEXISTENTE': 1, 'DEPOIS DO close_db': 2,
                 'CODIGO MORTO': 3, 'EXCECAO CRUA': 4, 'is_pg': 5, 'ROTA NOVA': 6, 'CHAVE SUSPEITA': 1}
        for tipo, n, msg in sorted(achados, key=lambda a: (ordem.get(a[0], 9), a[1])):
            print(f"  [{tipo}] {APP}:{n}\n      {msg}")

    print("\n  O que NÃO se checa aqui, e continua sendo na mão:")
    print("    - se ok:false cobre CADA consulta ou só o try externo")
    print("    - se o número que a rota devolve é o número certo")
    print("    - migração destrutiva (backfill que reescreve sem cópia)")
    return 1 if any(a[0] in ('FRONTEIRA', 'COLUNA INEXISTENTE', 'CHAVE SUSPEITA', 'DEPOIS DO close_db')
                    for a in achados) else 0


if __name__ == '__main__':
    sys.exit(main())
