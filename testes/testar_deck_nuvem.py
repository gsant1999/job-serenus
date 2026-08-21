# -*- coding: utf-8 -*-
"""O deck com o computador desligado.

Prova as duas metades: a tela declara o modo nuvem e serve leads + biblioteca do
banco; e o toque no cartão entra na FILA, não vira comando para a extensão.
"""
import os, sys, tempfile
os.environ['JOB_DATA_DIR'] = tempfile.mkdtemp(prefix='deck_nuvem_')
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app as A

falhas = []
def checar(cond, o_que):
    print(('  ok  ' if cond else ' FALHA') + '  ' + o_que)
    if not cond: falhas.append(o_que)

c = A.db()
c.execute("INSERT INTO usuarios (id,nome,email,senha_hash,perfil,ativo) VALUES (7,'Teste','t@t','x','consultor',1)")
c.execute("INSERT INTO crm_leads (id,nome,telefone,responsavel_id) VALUES (55,'Cliente da Rua','19998877665',7)")
c.execute("INSERT INTO modelos_conteudo (id,tipo,nome,corpo_texto,ativo) VALUES (9,'whatsapp','Boas-vindas','Oi, tudo bem?',1)")
c.commit(); A.close_db(c)

A._deck_nuvem_pronta = lambda uid: True     # WhatsApp do consultor de pé no servidor

cli = A.app.test_client()
with cli.session_transaction() as s:
    s['user_id'] = 7; s['perfil'] = 'consultor'

r = cli.get('/api/deck/whatsapp').get_json()
checar(r.get('modo') == 'nuvem', 'a tela declara que está no modo nuvem')
conversas = r['extensao']['conversas']
checar(any(x['chatId'] == 'lead:55' for x in conversas), 'o lead do CRM aparece na lista')
checar(any(m['id'] == 9 and m['titulo'] == 'Boas-vindas' for m in r['extensao']['modelos']),
       'a biblioteca vem do banco, sem extensão')
checar(r['extensao']['funis'] == [], 'funil não é oferecido pela nuvem')

r2 = cli.post('/api/deck/comando', json={'tipo': 'modelo', 'id': 9, 'chatId': 'lead:55'}).get_json()
checar((r2.get('comando') or {}).get('estado') == 'na_fila_nuvem', 'o envio responde "na fila", não "enviado"')

c = A.db()
f = c.execute("SELECT * FROM whatsapp_extensao_fila WHERE origem='deck_nuvem'").fetchall()
checar(len(f) == 1, 'entrou exatamente um item na fila')
if f:
    d = dict(f[0])
    checar(d['responsavel_id'] == 7 and d['lead_id'] == 55, 'a fila guarda o dono e o lead')
    checar(d['texto'] == 'Oi, tudo bem?' and d['status'] == 'pendente', 'texto e status corretos')
    checar('19998877665' in (d['telefone'] or '').replace('55', '', 1) or d['telefone'].endswith('19998877665'),
           'telefone normalizado: ' + str(d['telefone']))
A.close_db(c)

# Lead de outro consultor não pode ser alvo — a lista é pública para quem sabe o id.
c = A.db()
c.execute("INSERT INTO crm_leads (id,nome,telefone,responsavel_id) VALUES (56,'De outro','19911112222',8)")
c.commit(); A.close_db(c)
r3 = cli.post('/api/deck/comando', json={'tipo': 'modelo', 'id': 9, 'chatId': 'lead:56'})
checar(r3.status_code == 404, 'lead de outro consultor é recusado')

# ── O DESFECHO VOLTA PARA A TELA ──────────────────────────────────────────────
# É o que dispensa abrir o WhatsApp só para conferir se chegou.
r4 = cli.post('/api/deck/comando', json={'tipo': 'modelo', 'id': 9, 'chatId': 'lead:55'}).get_json()
fila_id = (r4.get('comando') or {}).get('fila_id')
checar(bool(fila_id), 'o envio devolve o numero da mensagem na fila')

est = cli.get('/api/deck/whatsapp').get_json()
linha = next((f for f in est.get('fila', []) if f['id'] == fila_id), None)
checar(linha is not None and linha['status'] == 'pendente', 'a tela ve a mensagem esperando')

c = A.db()
c.execute("UPDATE whatsapp_extensao_fila SET status='enviado' WHERE id=?", (fila_id,))
c.commit(); A.close_db(c)
est2 = cli.get('/api/deck/whatsapp').get_json()
linha2 = next((f for f in est2.get('fila', []) if f['id'] == fila_id), None)
checar(linha2 is not None and linha2['status'] == 'enviado', 'a tela ve que chegou')

print('\n' + ('TUDO CERTO' if not falhas else 'FALHOU: ' + '; '.join(falhas)))
sys.exit(1 if falhas else 0)
