# -*- coding: utf-8 -*-
"""O seletor de conversa vindo do proprio WhatsApp do servidor.

Sem extensao, sem computador ligado. Os casos sao os que aparecem de verdade na
conta do Guilherme: 482 conversas, das quais a maioria sem nome e boa parte sem
telefone.
"""
import os, sys, tempfile
os.environ['JOB_DATA_DIR'] = tempfile.mkdtemp(prefix='deck_evo_')
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app as A

falhas = []
def checar(cond, o_que):
    print(('  ok  ' if cond else ' FALHA') + '  ' + o_que)
    if not cond: falhas.append(o_que)

c = A.db()
c.execute("INSERT INTO usuarios (id,nome,email,senha_hash,perfil,ativo) VALUES (7,'Teste','t@t','x','consultor',1)")
c.execute("""INSERT INTO crm_leads (id,nome,telefone,telefone_norm,responsavel_id)
             VALUES (55,'Marcela Ferraz','19982093051','5519982093051',7)""")
c.execute("INSERT INTO modelos_conteudo (id,tipo,nome,corpo_texto,ativo) VALUES (9,'whatsapp','Oi','Ola!',1)")
c.commit(); A.close_db(c)

# O que o Evolution devolve de verdade, com os quatro casos que importam.
RESPOSTA = [
    {"remoteJid": "5519982093051@s.whatsapp.net", "pushName": "", "updatedAt": "2026-08-21T13:00:00Z"},
    {"remoteJid": "5519988932221@s.whatsapp.net", "pushName": "Roberta", "updatedAt": "2026-08-21T12:00:00Z"},
    {"remoteJid": "5519986004642@s.whatsapp.net", "pushName": "", "updatedAt": "2026-08-21T11:00:00Z"},
    {"remoteJid": "99093619708088@lid",           "pushName": "", "updatedAt": "2026-08-21T14:00:00Z"},
    {"remoteJid": "120363406879950542@g.us", "pushName": "Serenus & Affinity", "updatedAt": "2026-08-21T15:00:00Z"},
]
A._evolution_chamar = lambda metodo, caminho, corpo=None, tempo=25: (True, RESPOSTA)
A._deck_nuvem_pronta = lambda uid: True
A._EVO_CONVERSAS_CACHE.clear()

cli = A.app.test_client()
with cli.session_transaction() as s:
    s['user_id'] = 7; s['perfil'] = 'consultor'

r = cli.get('/api/deck/whatsapp').get_json()
lista = r['extensao']['conversas']
nomes = [x['nome'] for x in lista]
checar(r.get('modo') == 'nuvem', 'a tela esta no modo nuvem')
checar('Serenus & Affinity' not in nomes, 'grupo nao entra como destino')
checar(not any('@lid' in x['chatId'] for x in lista),
       'conversa sem telefone fica de fora (o servidor envia por numero)')
checar(nomes[0] == 'Marcela Ferraz', 'o nome vem do CRM quando o WhatsApp nao sabe: ' + str(nomes[0]))
checar('Roberta' in nomes, 'sem CRM, vale o nome que o WhatsApp tem')
checar(any(n.startswith('(19)') for n in nomes),
       'sem nome em lugar nenhum, mostra o telefone legivel: ' + str(nomes))
checar(all(x.get('de') for x in lista), 'cada linha diz de onde veio')

# E o envio aceita esse destino, que nunca passou pela extensao.
r2 = cli.post('/api/deck/comando',
              json={'tipo': 'modelo', 'id': 9, 'chatId': '5519982093051@s.whatsapp.net'}).get_json()
checar((r2.get('comando') or {}).get('estado') == 'na_fila_nuvem',
       'a conversa do servidor aceita disparo')
checar(r2.get('para') == 'Marcela Ferraz', 'o recado diz o nome do CRM')

c = A.db()
f = [dict(x) for x in c.execute("SELECT telefone FROM whatsapp_extensao_fila WHERE origem='deck_nuvem'").fetchall()]
checar(len(f) == 1 and f[0]['telefone'] == '5519982093051', 'a fila recebeu o telefone certo')
A.close_db(c)

# Conversa que nao esta na lista dele nao vira destino.
r3 = cli.post('/api/deck/comando', json={'tipo': 'modelo', 'id': 9, 'chatId': '5511999990000@s.whatsapp.net'})
checar(r3.status_code == 404, 'conversa fora da lista e recusada')

# Servidor fora do ar nao apaga a tela: vale o que a extensao tinha gravado.
A._evolution_chamar = lambda *a, **k: (False, None)
A._EVO_CONVERSAS_CACHE.clear()
A._deck_guardar_conversas(7, [{'chatId': '5519911112222@c.us', 'nome': 'De reserva',
                               'telefone': '5519911112222', 'em': 5}])
lista2 = cli.get('/api/deck/whatsapp').get_json()['extensao']['conversas']
checar('De reserva' in [x['nome'] for x in lista2],
       'sem resposta do servidor, vale a lista que a extensao gravou')

print('\n' + ('TUDO CERTO' if not falhas else 'FALHOU: ' + '; '.join(falhas)))
sys.exit(1 if falhas else 0)
