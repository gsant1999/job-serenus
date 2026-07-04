import os
import psycopg2

db_url = "postgresql://postgres:8G@vitoriafernanda@db.ghzdebngvkuhjygjuypm.supabase.co:5432/postgres?sslmode=require"

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
