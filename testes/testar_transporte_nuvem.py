# -*- coding: utf-8 -*-
"""A fila escolhe o transporte certo — e nunca os dois.

O erro que este teste existe para impedir e o cliente receber a mesma mensagem
duas vezes: uma pela extensao do consultor e outra pelo servidor.
"""
import os, sys
from datetime import datetime, timedelta
os.environ.setdefault('JOB_DATA_DIR', '/tmp/jobtest_transporte')
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app as A

falhas = []
def checa(nome, esperado, obtido, extra=''):
    ok = esperado == obtido
    print(f"  {'ok ' if ok else 'FALHOU'} {nome}")
    if not ok:
        falhas.append(nome); print(f"         esperava {esperado}, veio {obtido} {extra}")

AGORA = datetime.now(A.TZ_SP)

print("=== quem esta vivo fica com o item ===")
vivo = {'varr_visto_em': (AGORA - timedelta(minutes=1)).strftime('%Y-%m-%d %H:%M:%S')}
checa("batimento de 1 min = extensao viva", True, A._nuvem_extensao_viva(vivo, AGORA))

morto = {'varr_visto_em': (AGORA - timedelta(minutes=30)).strftime('%Y-%m-%d %H:%M:%S')}
checa("batimento de 30 min = extensao fora", False, A._nuvem_extensao_viva(morto, AGORA))

checa("nunca bateu = extensao fora", False, A._nuvem_extensao_viva({'varr_visto_em': None}, AGORA))
checa("carimbo estragado nao quebra", False, A._nuvem_extensao_viva({'varr_visto_em': 'lixo'}, AGORA))

print("=== a carencia existe: item novo espera a extensao ===")
checa("carencia configurada em minutos", True, A._NUVEM_CARENCIA_MIN >= 1,
      f"(hoje {A._NUVEM_CARENCIA_MIN})")
checa("teto por rodada existe", True, 0 < A._NUVEM_POR_RODADA <= 30,
      f"(hoje {A._NUVEM_POR_RODADA})")

print("=== a nuvem obedece as mesmas travas ===")
conn = A.db()
UID = 99902
conn.execute("DELETE FROM whatsapp_extensao_fila WHERE responsavel_id=?", (UID,))
conn.commit()
madrugada = AGORA.replace(hour=3)
pode, m = A._trava_verificar(conn, UID, {'origem': 'disparo_base', 'chat_id': 'x@c.us'}, madrugada)
checa("campanha de madrugada continua travada na nuvem", False, pode)
A.close_db(conn)

print("=== sem servidor configurado, o dreno nao faz nada ===")
antes_url = A._EVOLUTION_URL
A._EVOLUTION_URL = ''
try:
    A._wa_drenar_pela_nuvem()   # nao pode levantar
    print("  ok  dreno sem servidor nao quebra")
except Exception as e:
    falhas.append("dreno sem servidor"); print("  FALHOU dreno sem servidor:", e)
A._EVOLUTION_URL = antes_url

print()
if falhas:
    print("FALHOU:", ", ".join(falhas)); sys.exit(1)
print("A fila escolhe certo.")
