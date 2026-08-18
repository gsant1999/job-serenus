"""
Script de importação segura: SQLite → PostgreSQL
Uso: python3 import_propostas_from_sqlite.py
"""
import sqlite3
import psycopg2
import os

sqlite_db = os.path.expanduser("~/JOB_Serenus_Dados/job.db")
# A CREDENCIAL NAO MORA MAIS AQUI.
#
# Este arquivo teve, versionada, a senha do Postgres em texto puro. Apagar a
# linha nao desfaz a exposicao — o commit antigo continua no historico, e a
# senha so deixa de valer quando for rotacionada. O que esta linha garante e
# que nao ha uma SEGUNDA exposicao a partir de agora.
#
# Sem DATABASE_URL o script para de cara, em vez de cair num destino embutido:
# um padrao silencioso e como a credencial voltou a aparecer aqui da primeira
# vez.
pg_url = os.environ.get('DATABASE_URL')
if not pg_url:
    raise SystemExit('Defina DATABASE_URL antes de rodar este script.')

print("🔄 Iniciando importação SQLite → PostgreSQL...")

try:
    sqlite_conn = sqlite3.connect(sqlite_db)
    sqlite_conn.row_factory = sqlite3.Row
    sqlite_cur = sqlite_conn.cursor()
    
    sqlite_cur.execute("SELECT * FROM propostas ORDER BY id")
    propostas = sqlite_cur.fetchall()
    print(f"✅ Lido {len(propostas)} propostas do SQLite")
    
    pg_conn = psycopg2.connect(pg_url)
    pg_cur = pg_conn.cursor()
    
    pg_cur.execute("DELETE FROM propostas")
    print("🗑️  Tabela propostas limpa")
    
    for prop in propostas:
        data = dict(prop)
        cols = list(data.keys())
        vals = []
        
        for col in cols:
            val = data[col]
            if val is None:
                vals.append("NULL")
            elif isinstance(val, (int, float)):
                vals.append(str(val))
            elif isinstance(val, str):
                safe_val = val.replace("'", "''")
                vals.append(f"'{safe_val}'")
            else:
                vals.append(f"'{str(val)}'")
        
        cols_str = ", ".join(cols)
        vals_str = ", ".join(vals)
        
        sql = f"INSERT INTO propostas ({cols_str}) VALUES ({vals_str})"
        pg_cur.execute(sql)
    
    pg_conn.commit()
    print(f"✅ {len(propostas)} propostas importadas com sucesso!")
    
    sqlite_conn.close()
    pg_conn.close()

except Exception as e:
    print(f"❌ ERRO: {e}")
    import traceback
    traceback.print_exc()
