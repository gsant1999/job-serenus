#!/usr/bin/env python3
"""
Sincroniza dados de backup pra o banco ANTES da app iniciar.
Roda como pre-deploy command no Railway.
"""
import os
import shutil
import sqlite3
from pathlib import Path

DATA_DIR = os.environ.get("JOB_DATA_DIR") or os.path.join(os.path.expanduser("~"), "JOB_Serenus_Dados")
HOME_DB = os.path.join(os.path.expanduser("~"), "JOB_Serenus_Dados", "job.db")
DATA_DB = os.path.join(DATA_DIR, "job.db")

print(f"[SYNC] Sincronizando dados...")
print(f"[SYNC] DATA_DIR = {DATA_DIR}")
print(f"[SYNC] HOME_DB  = {HOME_DB}")
print(f"[SYNC] DATA_DB  = {DATA_DB}")

# Cria diretórios se não existirem
os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(os.path.dirname(DATA_DB), exist_ok=True)

# Verifica qual banco tem dados
home_has_data = False
data_has_data = False

if os.path.exists(HOME_DB):
    try:
        conn = sqlite3.connect(HOME_DB)
        n = conn.execute("SELECT COUNT(*) FROM propostas").fetchone()[0]
        home_has_data = n > 0
        conn.close()
        print(f"[SYNC] HOME_DB: {n} propostas")
    except Exception as e:
        print(f"[SYNC] HOME_DB erro: {e}")

if os.path.exists(DATA_DB):
    try:
        conn = sqlite3.connect(DATA_DB)
        n = conn.execute("SELECT COUNT(*) FROM propostas").fetchone()[0]
        data_has_data = n > 0
        conn.close()
        print(f"[SYNC] DATA_DB: {n} propostas")
    except Exception as e:
        print(f"[SYNC] DATA_DB erro: {e}")

# Sincroniza: se HOME tem dados e DATA não, copia HOME → DATA
if home_has_data and not data_has_data:
    print(f"[SYNC] HOME tem dados, DATA vazio. Copiando...")
    try:
        shutil.copy2(HOME_DB, DATA_DB)
        print(f"[SYNC] ✅ Cópia feita com sucesso")
    except Exception as e:
        print(f"[SYNC] ❌ Erro ao copiar: {e}")

# Se DATA tem dados, copia DATA → HOME (backup)
if data_has_data and (not home_has_data or os.path.getsize(DATA_DB) > os.path.getsize(HOME_DB)):
    print(f"[SYNC] DATA tem dados, sincronizando para HOME...")
    try:
        shutil.copy2(DATA_DB, HOME_DB)
        print(f"[SYNC] ✅ Backup feito")
    except Exception as e:
        print(f"[SYNC] ⚠️ Erro ao fazer backup: {e}")

# Verifica resultado final
try:
    conn = sqlite3.connect(DATA_DB)
    n_final = conn.execute("SELECT COUNT(*) FROM propostas").fetchone()[0]
    conn.close()
    print(f"[SYNC] ✅ FINAL: {n_final} propostas em {DATA_DIR}")
    if n_final == 0:
        print(f"[SYNC] ⚠️ AVISO: banco ainda está vazio!")
except Exception as e:
    print(f"[SYNC] ❌ ERRO: não conseguiu verificar resultado: {e}")
    exit(1)
