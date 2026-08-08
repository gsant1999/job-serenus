#!/usr/bin/env python3
import urllib.request
import csv
import io
import sys
import os

# Adiciona diretório pai ao path para importar as configs de banco do app
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import db, close_db, DB_MODE

CSV_URL = "https://docs.google.com/spreadsheets/d/1UUBsggnJZ0jPuUtrtwCfiPD5ob93aIevW_L9WuvdWag/export?format=csv"

def ingerir_matriz():
    print("Baixando planilha de concorrência do Google Sheets...")
    try:
        req = urllib.request.Request(CSV_URL)
        with urllib.request.urlopen(req) as response:
            content = response.read().decode('utf-8')
    except Exception as e:
        print(f"Erro ao baixar planilha: {e}")
        sys.exit(1)

    print("Conectando ao banco de dados...")
    conn = db()
    
    # Cria a tabela caso não exista (proteção extra caso _init_db não tenha rodado)
    if DB_MODE == 'postgres':
        conn.execute("""
            CREATE TABLE IF NOT EXISTS produtos_concorrencia (
                id SERIAL PRIMARY KEY,
                nivel_id INTEGER,
                operadora TEXT NOT NULL,
                nome_plano TEXT NOT NULL,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
    else:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS produtos_concorrencia (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nivel_id INTEGER,
                operadora TEXT NOT NULL,
                nome_plano TEXT NOT NULL,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
    
    # Limpa tabela atual para substituir com os dados mais recentes
    conn.execute("DELETE FROM produtos_concorrencia")
    
    reader = csv.reader(io.StringIO(content))
    header = next(reader)
    
    operadoras = [op.strip() for op in header]
    
    inseridos = 0
    nivel_id = 1
    
    for row in reader:
        # Pula se a linha inteira estiver vazia
        if not any(val.strip() for val in row):
            continue
            
        for idx, col in enumerate(row):
            if idx >= len(operadoras):
                break
                
            plano = col.strip()
            # Na planilha às vezes o texto tem quebra de linha (ex: "200 Campinas\nEnf")
            plano = plano.replace('\n', ' ').strip()
            
            operadora = operadoras[idx]
            
            if plano:
                conn.execute(
                    "INSERT INTO produtos_concorrencia (nivel_id, operadora, nome_plano) VALUES (?, ?, ?)",
                    (nivel_id, operadora, plano)
                )
                inseridos += 1
        nivel_id += 1
        
    conn.commit()
    close_db(conn)
    print(f"Sucesso! {inseridos} planos inseridos, distribuídos em {nivel_id - 1} níveis de concorrência.")

if __name__ == "__main__":
    ingerir_matriz()
