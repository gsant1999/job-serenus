#!/usr/bin/env python3
"""Auditoria dos números do Financeiro — mede a divergência, não opina sobre ela.

Guilherme, 10/08/2026: *"temos valores de comissões muito altas que estão
prejudicando tudo."*

SÓ LÊ. Nenhum INSERT, UPDATE ou DELETE. Pode rodar em produção.

    python scripts/auditoria_financeiro.py            # todos os meses com parcela
    python scripts/auditoria_financeiro.py 2026-08    # um mês só

NÃO IMPORTA O `app.py` — e isso é decisão, não preguiça. Importar o app roda o
schema, os backfills e sobe o APScheduler: auditoria que liga agendador em
produção deixou de ser auditoria. Aqui é conexão direta e `SELECT`, nada mais.

Usa `DATABASE_URL` quando existe (Postgres do Railway) e cai no SQLite de
`JOB_DATA_DIR` quando não existe (máquina de desenvolvimento).

O que ele responde, com número:

  1. Quanto das parcelas somadas como "a receber" está CANCELADA/ESTORNADA.
  2. Quanto pertence a proposta EXCLUÍDA ou ESTORNADA.
  3. Quanto o DRE conta a mais por não filtrar status nenhum.

Cada linha mostra o valor de HOJE, o CORRIGIDO e a diferença. Diferença zero
com base cheia significa que o defeito existe no código e ainda não custou
dinheiro — e isso também é resposta. Diferença zero com base VAZIA não
significa nada, e o script avisa quando é esse o caso.
"""
import os
import sys

MES = (sys.argv[1] if len(sys.argv) > 1 else '').strip()


def _do_url(u):
    """Quebra postgresql://user:senha@host:porta/base — só o pg8000 precisa."""
    from urllib.parse import urlparse, unquote
    x = urlparse(u)
    return {'user': unquote(x.username or ''), 'password': unquote(x.password or ''),
            'host': x.hostname or '', 'port': x.port or 5432,
            'database': (x.path or '/').lstrip('/')}


def conectar():
    """Devolve (conexão, marcador, nome do banco). Sem tocar no app."""
    url = (os.environ.get('DATABASE_URL') or '').strip()
    if url:
        # DRIVER: tenta os tres que existem no mundo Python, em ordem.
        #
        # No console do Railway o `python` pode nao ser o mesmo interpretador
        # que roda a aplicacao — e ai o psycopg2 "nao existe" mesmo estando no
        # requirements. Em vez de morrer com uma frase que nao ajuda, o script
        # diz QUAL python esta rodando e o que fazer.
        conectar_pg = None
        try:
            import psycopg2
            conectar_pg = psycopg2.connect
        except ImportError:
            try:
                import psycopg          # psycopg 3
                conectar_pg = psycopg.connect
            except ImportError:
                try:
                    import pg8000.dbapi as pg8000
                    conectar_pg = lambda u: pg8000.connect(**_do_url(u))
                except ImportError:
                    conectar_pg = None
        if conectar_pg is None:
            print('ERRO: DATABASE_URL existe, mas nenhum driver de Postgres neste interpretador.')
            print('      Interpretador: %s' % sys.executable)
            print('      Versão: %s' % sys.version.split()[0])
            print('')
            print('      O app usa psycopg2 e ele ESTÁ no requirements.txt — então')
            print('      provavelmente este `python` não é o que roda a aplicação.')
            print('      Tente, nesta ordem:')
            print('        python3 scripts/auditoria_financeiro.py')
            print('        /usr/local/bin/python scripts/auditoria_financeiro.py')
            print('        python -m pip show psycopg2-binary')
            sys.exit(2)
        if url.startswith('postgres://'):
            url = url.replace('postgres://', 'postgresql://', 1)
        return conectar_pg(url), '%s', 'PostgreSQL (produção)'
    import sqlite3
    caminho = os.path.join(os.environ.get('JOB_DATA_DIR', '/tmp'), 'job.db')
    if not os.path.exists(caminho):
        print('ERRO: sem DATABASE_URL e sem banco em %s.' % caminho)
        print('      Rodar contra banco vazio devolve R$ 0,00 e não prova nada.')
        sys.exit(2)
    return sqlite3.connect(caminho), '?', 'SQLite %s' % caminho


CONN, MARCA, ONDE = conectar()


def q(sql, p=()):
    cur = CONN.cursor()
    cur.execute(sql.replace('?', MARCA), p)
    linha = cur.fetchone()
    cur.close()
    return (linha[0] if linha else 0) or 0


def qlista(sql, p=()):
    cur = CONN.cursor()
    cur.execute(sql.replace('?', MARCA), p)
    linhas = [r[0] for r in cur.fetchall()]
    cur.close()
    return linhas


def moeda(v):
    return ('R$ %0.2f' % (float(v or 0))).replace('.', ',')


def linha(rot, hoje, certo):
    dif = float(hoje or 0) - float(certo or 0)
    marca = '' if abs(dif) < 0.005 else '   <<< DIFERENÇA'
    print('  %-40s hoje %15s   correto %15s   dif %14s%s'
          % (rot, moeda(hoje), moeda(certo), moeda(dif), marca))
    return dif


# O filtro que falta nas quatro consultas da tela, escrito uma vez só.
LIMPO = ("""
    JOIN propostas pr ON pr.id = p.proposta_id
    WHERE p.competencia = ?
      AND p.status <> 'Cancelada / Estornada'
      AND COALESCE(pr.estornada, 0) = 0
      AND COALESCE(pr.status, '') <> 'Excluída'
""")


def auditar(mes):
    print('\n== COMPETÊNCIA %s ==' % mes)
    total = 0.0

    # 1 · A RECEBER — a tela soma tudo que não está 'Pago ao corretor'. Estorno
    #     marca a parcela como 'Cancelada / Estornada', que também não é
    #     'Pago ao corretor' — então ela CONTINUA somando como dinheiro a entrar.
    hoje = q("""SELECT COALESCE(SUM(valor_corretora),0) FROM parcelas
                WHERE competencia=? AND status NOT IN ('Pago ao corretor')""", (mes,))
    certo = q("SELECT COALESCE(SUM(p.valor_corretora),0) FROM parcelas p" + LIMPO +
              " AND p.status NOT IN ('Pago ao corretor')", (mes,))
    total += linha('A receber (operadoras)', hoje, certo)

    # 2 · A PAGAR — mesmo defeito, outro campo.
    hoje = q("""SELECT COALESCE(SUM(valor),0) FROM parcelas
                WHERE competencia=? AND status NOT IN ('Pago ao corretor')""", (mes,))
    certo = q("SELECT COALESCE(SUM(p.valor),0) FROM parcelas p" + LIMPO +
              " AND p.status NOT IN ('Pago ao corretor')", (mes,))
    total += linha('A pagar (consultores)', hoje, certo)

    # 3 · DRE — aqui não há filtro de status NENHUM. É o que mais infla.
    hoje_c = q("SELECT COALESCE(SUM(valor),0) FROM parcelas WHERE competencia=?", (mes,))
    hoje_k = q("SELECT COALESCE(SUM(valor_corretora),0) FROM parcelas WHERE competencia=?", (mes,))
    certo_c = q("SELECT COALESCE(SUM(p.valor),0) FROM parcelas p" + LIMPO, (mes,))
    certo_k = q("SELECT COALESCE(SUM(p.valor_corretora),0) FROM parcelas p" + LIMPO, (mes,))
    total += linha('DRE · receita bruta', hoje_c + hoje_k, certo_c + certo_k)
    total += linha('DRE · repasse aos consultores', hoje_c, certo_c)

    # 4 · DE ONDE VEM A DIFERENÇA, separada por causa — sem isto "está inflado"
    #     não vira conserto, vira suspeita.
    canc = q("""SELECT COALESCE(SUM(valor_corretora),0) FROM parcelas
                WHERE competencia=? AND status='Cancelada / Estornada'""", (mes,))
    ruim = q("""SELECT COALESCE(SUM(p.valor_corretora),0) FROM parcelas p
                JOIN propostas pr ON pr.id = p.proposta_id
                WHERE p.competencia=? AND p.status <> 'Cancelada / Estornada'
                  AND (COALESCE(pr.estornada,0)=1 OR COALESCE(pr.status,'')='Excluída')""", (mes,))
    orfas = q("""SELECT COALESCE(SUM(p.valor_corretora),0) FROM parcelas p
                 LEFT JOIN propostas pr ON pr.id = p.proposta_id
                 WHERE p.competencia=? AND pr.id IS NULL""", (mes,))
    print('\n  causa · parcela marcada cancelada/estornada .... %s' % moeda(canc))
    print('  causa · proposta estornada ou excluída ......... %s' % moeda(ruim))
    print('  causa · parcela sem proposta (órfã) ............ %s' % moeda(orfas))
    return total


def main():
    print('AUDITORIA DO FINANCEIRO — só leitura, nada é alterado.')
    print('Banco: %s' % ONDE)
    n_parc = q('SELECT COUNT(*) FROM parcelas')
    n_prop = q('SELECT COUNT(*) FROM propostas')
    print('Base: %s parcela(s) e %s proposta(s).' % (n_parc, n_prop))
    if not n_parc:
        print('\nBASE VAZIA. Qualquer resultado aqui é R$ 0,00 e NÃO prova nada —')
        print('rode onde os dados estão (o Postgres de produção).')
        return
    meses = [MES] if MES else qlista(
        "SELECT DISTINCT competencia FROM parcelas WHERE competencia IS NOT NULL "
        "ORDER BY competencia DESC LIMIT 12")
    soma = 0.0
    for m in meses:
        soma += auditar(m)
    print('\n' + '-' * 104)
    print('DIFERENÇA SOMADA NOS %d MÊS(ES) EXAMINADO(S): %s' % (len(meses), moeda(soma)))
    print('Positivo = a tela mostra MAIS dinheiro do que existe.')


if __name__ == '__main__':
    try:
        main()
    finally:
        try:
            CONN.close()
        except Exception:
            pass
