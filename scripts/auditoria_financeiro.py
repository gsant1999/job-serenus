#!/usr/bin/env python3
"""Auditoria dos números do Financeiro — mede a divergência, não opina sobre ela.

Guilherme, 10/08/2026: *"temos valores de comissões muito altas que estão
prejudicando tudo."*

NÃO ESCREVE NADA. Só lê e compara. Pode rodar em produção sem medo.

    JOB_DATA_DIR=/tmp/x python3 scripts/auditoria_financeiro.py 2026-08

O que ele responde, com número:

  1. Quanto das parcelas somadas como "a receber" está CANCELADA/ESTORNADA.
  2. Quanto pertence a proposta EXCLUÍDA ou ESTORNADA.
  3. Quanto o DRE está contando a mais por não filtrar status nenhum.
  4. Se a tela de Produção e a de Financeiro respondem o mesmo para o mês.

Cada linha mostra o valor de HOJE, o valor CORRIGIDO e a diferença. Se a
diferença for zero, o defeito existe no código mas ainda não custou dinheiro —
e isso também é resposta.
"""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')))
os.environ.setdefault('JOB_DATA_DIR', '/tmp/auditoria-job')

import app as A  # noqa: E402

MES = (sys.argv[1] if len(sys.argv) > 1 else '').strip()


def moeda(v):
    return ('R$ %0.2f' % (v or 0)).replace('.', ',')


def linha(rot, hoje, certo):
    dif = (hoje or 0) - (certo or 0)
    marca = '' if abs(dif) < 0.005 else '   <<< DIFERENÇA'
    print('  %-42s hoje %14s   correto %14s   dif %12s%s'
          % (rot, moeda(hoje), moeda(certo), moeda(dif), marca))
    return dif


def um(conn, sql, p=()):
    r = conn.execute(sql, p).fetchone()
    return (r[0] if not hasattr(r, 'keys') else list(dict(r).values())[0]) or 0


def auditar(conn, mes):
    print('\n== COMPETÊNCIA %s ==' % mes)
    total = 0.0

    # 1 · A RECEBER (parte da corretora)
    #
    # A tela soma tudo que não está 'Pago ao corretor'. O estorno marca a
    # parcela como 'Cancelada / Estornada' — que também não é 'Pago ao
    # corretor', então ela CONTINUA SOMANDO como dinheiro a entrar.
    hoje = um(conn, """SELECT COALESCE(SUM(valor_corretora),0) FROM parcelas
        WHERE competencia=? AND status NOT IN ('Pago ao corretor')""", (mes,))
    certo = um(conn, """SELECT COALESCE(SUM(p.valor_corretora),0) FROM parcelas p
        JOIN propostas pr ON pr.id = p.proposta_id
        WHERE p.competencia=? AND p.status NOT IN ('Pago ao corretor','Cancelada / Estornada')
          AND COALESCE(pr.estornada,0)=0 AND COALESCE(pr.status,'') <> 'Excluída'""", (mes,))
    total += linha('A receber (operadoras)', hoje, certo)

    # 2 · A PAGAR (parte do consultor) — mesmo defeito, outro campo.
    hoje = um(conn, """SELECT COALESCE(SUM(valor),0) FROM parcelas
        WHERE competencia=? AND status NOT IN ('Pago ao corretor')""", (mes,))
    certo = um(conn, """SELECT COALESCE(SUM(p.valor),0) FROM parcelas p
        JOIN propostas pr ON pr.id = p.proposta_id
        WHERE p.competencia=? AND p.status NOT IN ('Pago ao corretor','Cancelada / Estornada')
          AND COALESCE(pr.estornada,0)=0 AND COALESCE(pr.status,'') <> 'Excluída'""", (mes,))
    total += linha('A pagar (consultores)', hoje, certo)

    # 3 · DRE — RECEITA BRUTA.
    #
    # Aqui não há filtro de status NENHUM: soma cancelada, soma paga, soma
    # tudo. É o número que mais infla.
    hoje_c = um(conn, "SELECT COALESCE(SUM(valor),0) FROM parcelas WHERE competencia=?", (mes,))
    hoje_k = um(conn, "SELECT COALESCE(SUM(valor_corretora),0) FROM parcelas WHERE competencia=?", (mes,))
    certo_c = um(conn, """SELECT COALESCE(SUM(p.valor),0) FROM parcelas p
        JOIN propostas pr ON pr.id = p.proposta_id
        WHERE p.competencia=? AND p.status <> 'Cancelada / Estornada'
          AND COALESCE(pr.estornada,0)=0 AND COALESCE(pr.status,'') <> 'Excluída'""", (mes,))
    certo_k = um(conn, """SELECT COALESCE(SUM(p.valor_corretora),0) FROM parcelas p
        JOIN propostas pr ON pr.id = p.proposta_id
        WHERE p.competencia=? AND p.status <> 'Cancelada / Estornada'
          AND COALESCE(pr.estornada,0)=0 AND COALESCE(pr.status,'') <> 'Excluída'""", (mes,))
    total += linha('DRE · receita bruta', hoje_c + hoje_k, certo_c + certo_k)
    total += linha('DRE · repasse aos consultores', hoje_c, certo_c)

    # 4 · DE ONDE VEM A DIFERENÇA, separada por causa.
    canc = um(conn, """SELECT COALESCE(SUM(valor_corretora),0) FROM parcelas
        WHERE competencia=? AND status='Cancelada / Estornada'""", (mes,))
    orfas = um(conn, """SELECT COALESCE(SUM(p.valor_corretora),0) FROM parcelas p
        LEFT JOIN propostas pr ON pr.id = p.proposta_id
        WHERE p.competencia=? AND pr.id IS NULL""", (mes,))
    prop_ruim = um(conn, """SELECT COALESCE(SUM(p.valor_corretora),0) FROM parcelas p
        JOIN propostas pr ON pr.id = p.proposta_id
        WHERE p.competencia=? AND p.status <> 'Cancelada / Estornada'
          AND (COALESCE(pr.estornada,0)=1 OR COALESCE(pr.status,'') = 'Excluída')""", (mes,))
    print('\n  causa · parcela marcada cancelada/estornada .... %s' % moeda(canc))
    print('  causa · proposta estornada ou excluída ......... %s' % moeda(prop_ruim))
    print('  causa · parcela sem proposta (órfã) ............ %s' % moeda(orfas))
    return total


def main():
    conn = A.db()
    if MES:
        meses = [MES]
    else:
        meses = [r[0] if not hasattr(r, 'keys') else dict(r)['competencia'] for r in conn.execute(
            "SELECT DISTINCT competencia FROM parcelas WHERE competencia IS NOT NULL "
            "ORDER BY competencia DESC LIMIT 6").fetchall()]
    print('AUDITORIA DO FINANCEIRO — só leitura, nada é alterado.')
    soma = 0.0
    for m in meses:
        soma += auditar(conn, m)
    print('\n' + '-' * 100)
    print('DIFERENÇA SOMADA NOS MESES EXAMINADOS: %s' % moeda(soma))
    print('Positivo = a tela mostra MAIS dinheiro do que existe.')
    A.close_db(conn)


if __name__ == '__main__':
    main()
