# -*- coding: utf-8 -*-
"""As travas de envio realmente freiam? Uma a uma, contra o banco de teste.

Trava que nao freia e pior que trava nenhuma: da a sensacao de protecao e
deixa o numero de uma pessoa exposto. Este teste existe para que ninguem
possa afrouxar uma delas sem que apareca aqui.
"""
import os, sys
from datetime import datetime, timedelta
os.environ.setdefault('JOB_DATA_DIR', '/tmp/jobtest_travas')
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app as A

falhas = []

def checa(nome, esperado, obtido, motivo=''):
    ok = (esperado == obtido)
    print(f"  {'ok ' if ok else 'FALHOU'} {nome}")
    if not ok:
        falhas.append(nome)
        print(f"         esperava pode={esperado}, veio pode={obtido} ({motivo[:70]})")
    elif motivo:
        print(f"         motivo: {motivo[:76]}")

conn = A.db()
UID = 99901
conn.execute("DELETE FROM whatsapp_extensao_fila WHERE responsavel_id=?", (UID,))
conn.commit()

DIA = datetime(2026, 8, 21)
MEIO_DIA = DIA.replace(hour=14)
MADRUGADA = DIA.replace(hour=3)

print("=== 1. clique de gente nunca e travado ===")
for h in (MADRUGADA, MEIO_DIA):
    pode, m = A._trava_verificar(conn, UID, {'origem': 'funil_manual', 'chat_id': 'x@c.us'}, h)
    checa(f"funil_manual as {h.hour}h passa", True, pode, m)

print("=== 2. janela de horario ===")
pode, m = A._trava_verificar(conn, UID, {'origem': 'disparo_base', 'chat_id': 'x@c.us'}, MADRUGADA)
checa("campanha as 3h e travada", False, pode, m)
pode, m = A._trava_verificar(conn, UID, {'origem': 'disparo_base', 'chat_id': 'x@c.us'}, MEIO_DIA)
checa("campanha as 14h passa", True, pode, m)
pode, m = A._trava_verificar(conn, UID, {'origem': 'lead_pago', 'chat_id': 'x@c.us'}, MADRUGADA)
checa("lead pago as 3h passa (ele acabou de pedir)", True, pode, m)

print("=== 3. teto diario ===")
hoje = MEIO_DIA.strftime('%Y-%m-%d %H:%M:%S')
for i in range(A._TRAVA_TETO_DIARIO):
    conn.execute("""INSERT INTO whatsapp_extensao_fila
        (responsavel_id, telefone, chat_id, texto, origem, status, enviado_em)
        VALUES (?,?,?,?,?,?,?)""",
        (UID, '5519999', f'conhecido{i}@c.us', 'oi', 'disparo_base', 'enviado', hoje))
conn.commit()
pode, m = A._trava_verificar(conn, UID, {'origem': 'lead_pago', 'chat_id': 'x@c.us'}, MEIO_DIA)
checa(f"passou de {A._TRAVA_TETO_DIARIO} no dia, trava", False, pode, m)

print("=== 4. teto de contato frio ===")
conn.execute("DELETE FROM whatsapp_extensao_fila WHERE responsavel_id=?", (UID,))
for i in range(A._TRAVA_TETO_FRIO):
    conn.execute("""INSERT INTO whatsapp_extensao_fila
        (responsavel_id, telefone, chat_id, texto, origem, status, enviado_em)
        VALUES (?,?,?,?,?,?,?)""",
        (UID, '5519999', f'frio{i}@c.us', 'oi', 'disparo_base', 'enviado', hoje))
conn.commit()
pode, m = A._trava_verificar(conn, UID, {'origem': 'disparo_base', 'chat_id': 'novo@c.us'}, MEIO_DIA)
checa(f"passou de {A._TRAVA_TETO_FRIO} frios, trava desconhecido", False, pode, m)
# quem ja conversou continua podendo receber
conn.execute("INSERT OR REPLACE INTO wa_conversa_estado (chat_id) VALUES (?)", ('amigo@c.us',))
conn.commit()
pode, m = A._trava_verificar(conn, UID, {'origem': 'disparo_base', 'chat_id': 'amigo@c.us'}, MEIO_DIA)
checa("mesmo assim, quem ja conversou passa", True, pode, m)

print("=== 5. freio por falha em sequencia ===")
conn.execute("DELETE FROM whatsapp_extensao_fila WHERE responsavel_id=?", (UID,))
for i in range(A._TRAVA_FALHAS_SEGUIDAS):
    conn.execute("""INSERT INTO whatsapp_extensao_fila
        (responsavel_id, telefone, chat_id, texto, origem, status)
        VALUES (?,?,?,?,?,?)""",
        (UID, '5519999', f'f{i}@c.us', 'oi', 'disparo_base', 'falhou'))
conn.commit()
pode, m = A._trava_verificar(conn, UID, {'origem': 'lead_pago', 'chat_id': 'x@c.us'}, MEIO_DIA)
checa(f"{A._TRAVA_FALHAS_SEGUIDAS} falhas seguidas param o consultor", False, pode, m)
# um sucesso no meio quebra a sequencia
conn.execute("""INSERT INTO whatsapp_extensao_fila
    (responsavel_id, telefone, chat_id, texto, origem, status, enviado_em)
    VALUES (?,?,?,?,?,?,?)""",
    (UID, '5519999', 'ok@c.us', 'oi', 'disparo_base', 'enviado', hoje))
conn.commit()
pode, m = A._trava_verificar(conn, UID, {'origem': 'lead_pago', 'chat_id': 'x@c.us'}, MEIO_DIA)
checa("um envio bom destrava", True, pode, m)

conn.execute("DELETE FROM whatsapp_extensao_fila WHERE responsavel_id=?", (UID,))
conn.commit()
A.close_db(conn)

print()
if falhas:
    print("FALHOU:", ", ".join(falhas))
    sys.exit(1)
print("Todas as travas freiam.")
