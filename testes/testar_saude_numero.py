# -*- coding: utf-8 -*-
"""A saude do numero: o silencio de quem nunca falou com voce.

Nasceu do numero recem-comprado que caiu ao conectar, em 21/08/2026.
"""
import os, sys, tempfile
os.environ['JOB_DATA_DIR'] = tempfile.mkdtemp(prefix='saude_')
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app as A

falhas = []
def checar(cond, o_que):
    print(('  ok  ' if cond else ' FALHA') + '  ' + o_que)
    if not cond: falhas.append(o_que)

c = A.db()
c.execute("INSERT INTO usuarios (id,nome,email,senha_hash,perfil,ativo) VALUES (7,'Cauteloso','a@a','x','consultor',1)")
c.execute("INSERT INTO usuarios (id,nome,email,senha_hash,perfil,ativo) VALUES (8,'Afobado','b@b','x','consultor',1)")

agora = A._agora_sp()
def envio(uid, chat, origem, status='enviado'):
    c.execute("""INSERT INTO whatsapp_extensao_fila
        (responsavel_id, telefone, chat_id, tipo, texto, origem, status, criado_em, enviado_em)
        VALUES (?,?,?,'texto','oi',?,?,?,?)""",
        (uid, chat.split('@')[0], chat, origem, status, agora, agora))

# Cauteloso: fala com quem ja conversava. Todos conhecidos.
for i in range(10):
    chat = f"55199000000{i:02d}@c.us"
    c.execute("INSERT INTO wa_conversa_estado (chat_id, ultima_msg_em) VALUES (?,?)", (chat, 1.0))
    envio(7, chat, 'extensao_direto')

# Afobado: 40 desconhecidos, e ninguem deu sinal de vida.
for i in range(40):
    envio(8, f"55119111111{i:02d}@c.us", 'disparo_base')
for i in range(3):
    envio(8, f"5511922222{i:03d}@c.us", 'disparo_base', 'falhou')
c.commit(); A.close_db(c)

conn = A.db()
s = A._saude_dos_numeros(conn, dias=14)
A.close_db(conn)
por = {x['nome']: x for x in s['consultores']}

checar(por['Cauteloso']['frios'] == 0, 'quem continua conversa nao conta como frio')
checar(por['Cauteloso']['risco'] == 'baixo', 'e o risco dele e baixo')
checar(por['Afobado']['frios'] == 40, 'quem aborda desconhecido conta certo: ' + str(por['Afobado']['frios']))
checar(por['Afobado']['silencio_pct'] == 100, 'silencio total aparece como 100%')
checar(por['Afobado']['risco'] == 'alto', 'e vira risco alto: ' + por['Afobado']['risco'])
checar(por['Afobado']['falhas'] == 3, 'as que nao sairam sao contadas separado')
checar(por['Cauteloso']['manuais'] == 10 and por['Cauteloso']['automaticos'] == 0,
       'envio manual e separado do automatico — as travas so freiam o automatico')
checar(por['Afobado']['automaticos'] == 40, 'campanha conta como automatico')
checar(s['teto_dia'] == A._TRAVA_TETO_DIARIO and s['teto_frio'] == A._TRAVA_TETO_FRIO,
       'a regua e a mesma das travas, para o numero ser comparavel')

# So o admin ve o numero do time.
cli = A.app.test_client()
with cli.session_transaction() as ss:
    ss['user_id'] = 7; ss['perfil'] = 'consultor'
checar(cli.get('/api/whatsapp/saude').status_code in (302, 403),
       'consultor nao ve a saude do time')

print('\n' + ('TUDO CERTO' if not falhas else 'FALHOU: ' + '; '.join(falhas)))
sys.exit(1 if falhas else 0)
