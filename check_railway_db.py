import os
import psycopg2

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
db_url = os.environ.get('DATABASE_URL')
if not db_url:
    raise SystemExit('Defina DATABASE_URL antes de rodar este script.')

try:
    conn = psycopg2.connect(db_url)
    cur = conn.cursor()
    
    # Contar propostas no PostgreSQL
    cur.execute("SELECT COUNT(*) FROM propostas;")
    count = cur.fetchone()[0]
    
    print(f"✅ PostgreSQL conectado!")
    print(f"📊 Total de propostas: {count}")
    
    if count > 0:
        cur.execute("SELECT id, cliente, operadora, valor FROM propostas LIMIT 5;")
        for row in cur.fetchall():
            print(f"  - {row[1]} ({row[2]}): R${row[3]}")
    else:
        print("❌ Banco vazio (sem propostas)")
    
    conn.close()
except Exception as e:
    print(f"❌ Erro: {e}")
