#!/usr/bin/env python3
"""
Script de retroalimentação em lote do Aprendizado de IA para vendas do Guilherme.
Varre todos os leads ganhos/fechados e perdidos do Guilherme e registra no wa_aprendizado_leads.
"""
import os
import sys
import json

# Adiciona o diretório raiz do projeto ao sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from app import db, close_db, _registrar_aprendizado_lead, DB_MODE

def executar_retroalimentacao(filtro_nome='Guilherme'):
    conn = db()
    is_pg = DB_MODE == 'postgres'
    print(f"[RETRORUN] Modo do banco: {DB_MODE.upper()}")
    
    # 1. Busca IDs de usuários que correspondem ao filtro
    usuarios = conn.execute(
        "SELECT id, nome, email FROM usuarios WHERE nome LIKE ? OR email LIKE ?",
        (f'%{filtro_nome}%', f'%{filtro_nome}%')
    ).fetchall()
    uids = [u['id'] if hasattr(u, 'keys') else u[0] for u in usuarios]
    print(f"[RETRORUN] Usuários encontrados ({len(uids)}): {[dict(u) for u in usuarios]}")
    
    if not uids:
        print("[RETRORUN] Nenhum usuário encontrado com esse filtro.")
        close_db(conn)
        return

    # 2. Busca leads encerrados/ganhos ou perdidos
    ph_uids = ','.join(['?'] * len(uids))
    query_leads = f"""
        SELECT id, nome, etapa, perdido_motivo, responsavel_id, criado_em 
        FROM crm_leads 
        WHERE responsavel_id IN ({ph_uids})
          AND (
            etapa IN ('Ganhou', 'GANHO', 'Perdido', 'PERDIDO', 'Proposta cadastrada', 'Ativo', 'Contrato emitido')
            OR perdido_motivo IS NOT NULL
          )
        ORDER BY id DESC
    """
    leads = conn.execute(query_leads, tuple(uids)).fetchall()
    print(f"[RETRORUN] Total de leads fechados/perdidos encontrados: {len(leads)}")
    
    sucessos = 0
    erros = 0
    for l in leads:
        lead_dict = dict(l) if hasattr(l, 'keys') else {
            'id': l[0], 'nome': l[1], 'etapa': l[2], 'perdido_motivo': l[3]
        }
        lid = lead_dict['id']
        etapa = str(lead_dict.get('etapa') or '').upper()
        motivo = lead_dict.get('perdido_motivo')
        
        desfecho = 'PERDIDO' if ('PERDIDO' in etapa or motivo) else 'GANHO'
        
        try:
            print(f"[RETRORUN] Processando lead #{lid} - {lead_dict.get('nome')} | Desfecho: {desfecho}...")
            _registrar_aprendizado_lead(conn, lid, desfecho, motivo_perda=motivo)
            conn.commit()
            sucessos += 1
        except Exception as e:
            print(f"[RETRORUN] Erro no lead #{lid}: {e}")
            erros += 1

    close_db(conn)
    print(f"[RETRORUN] Concluído! Processados com sucesso: {sucessos} | Erros: {erros}")

if __name__ == '__main__':
    filtro = sys.argv[1] if len(sys.argv) > 1 else 'Guilherme'
    executar_retroalimentacao(filtro)
