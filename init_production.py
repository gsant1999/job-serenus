#!/usr/bin/env python3
"""
Script para inicializar o banco de dados em produção (Railway).
Cria todas as tabelas se não existirem.
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from app import app, init_db
from backup_db import backup_database

if __name__ == '__main__':
    print("[BACKUP] Iniciando backup do banco antes de deploy...")
    backup_database()
    print("[INIT] Inicializando banco de dados para produção...")
    
    try:
        with app.app_context():
            init_db()
        print("✅ Banco de dados inicializado com sucesso!")
        sys.exit(0)
    except Exception as e:
        print(f"❌ Erro ao inicializar: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
