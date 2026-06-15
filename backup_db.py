#!/usr/bin/env python3
"""
Script de backup automático do banco de dados.
Cria cópia do banco antes de cada deployment importante.
"""

import shutil
import os
from datetime import datetime
import sqlite3

def backup_database():
    """Faz backup do banco de dados SQLite."""
    db_path = os.path.expanduser("~/JOB_Serenus_Dados/job.db")
    backup_dir = os.path.expanduser("~/JOB_Serenus_Dados/backups")
    
    # Cria diretório de backups se não existir
    os.makedirs(backup_dir, exist_ok=True)
    
    if not os.path.exists(db_path):
        print("[BACKUP] Banco de dados não encontrado")
        return False
    
    # Gera nome do backup com timestamp
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_name = f"job_backup_{timestamp}.db"
    backup_path = os.path.join(backup_dir, backup_name)
    
    try:
        # Cria backup
        shutil.copy2(db_path, backup_path)
        
        # Verifica integridade do backup
        conn = sqlite3.connect(backup_path)
        conn.execute("SELECT COUNT(*) FROM usuarios")
        conn.close()
        
        print(f"✅ Backup criado: {backup_name}")
        
        # Limpa backups antigos (mantém últimos 10)
        backups = sorted([f for f in os.listdir(backup_dir) if f.startswith('job_backup_')])
        if len(backups) > 10:
            for old_backup in backups[:-10]:
                os.remove(os.path.join(backup_dir, old_backup))
                print(f"🗑️  Backup antigo removido: {old_backup}")
        
        return True
        
    except Exception as e:
        print(f"❌ Erro ao fazer backup: {e}")
        return False

if __name__ == '__main__':
    backup_database()
