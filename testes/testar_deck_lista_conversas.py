# -*- coding: utf-8 -*-
"""A lista de conversas sobrevive ao computador desligado.

O ponto todo: o consultor na rua tem que ver o NOME de quem ele estava
atendendo, e conseguir disparar para ele — sem nada aberto no Chrome.
"""
import os, sys, tempfile
os.environ['JOB_DATA_DIR'] = tempfile.mkdtemp(prefix='deck_conv_')
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app as A

falhas = []
def checar(cond, o_que):
    print(('  ok  ' if cond else ' FALHA') + '  ' + o_que)
    if not cond: falhas.append(o_que)

c = A.db()
c.execute("INSERT INTO usuarios (id,nome,email,senha_hash,perfil,ativo) VALUES (7,'Teste','t@t','x','consultor',1)")
c.execute("INSERT INTO crm_leads (id,nome,telefone,responsavel_id) VALUES (55,'Lead Nunca Abordado','19933334444',7)")
c.execute("INSERT INTO modelos_conteudo (id,tipo,nome,corpo_texto,ativo) VALUES (9,'whatsapp','Boas-vindas','Oi!',1)")
c.commit(); A.close_db(c)

# A extensao leu o WhatsApp e mandou a lista.
A._deck_guardar_conversas(7, [
    {'chatId': '5519998877665@c.us', 'nome': 'Marcela Ferraz', 'telefone': '5519998877665', 'em': 300},
    {'chatId': '5519991112222@c.us', 'nome': 'Joao Pedro',     'telefone': '5519991112222', 'em': 200},
    {'chatId': 'so-lid@lid',         'nome': 'Sem telefone',   'telefone': '',              'em': 100},
    {'chatId': '123@g.us',           'nome': 'Grupo da firma', 'telefone': '551900000',     'em': 400},
])

A._deck_nuvem_pronta = lambda uid: True     # WhatsApp de pe no servidor
cli = A.app.test_client()
with cli.session_transaction() as s:
    s['user_id'] = 7; s['perfil'] = 'consultor'

r = cli.get('/api/deck/whatsapp').get_json()
lista = r['extensao']['conversas']
nomes = [x['nome'] for x in lista]
checar(r.get('modo') == 'nuvem', 'a tela esta no modo nuvem')
checar(nomes[:2] == ['Marcela Ferraz', 'Joao Pedro'], 'as conversas vem primeiro, na ordem da mais recente')
checar('Grupo da firma' not in nomes, 'grupo nao entra como destino')
checar('Sem telefone' not in nomes, 'conversa sem telefone nao aparece (o servidor nao envia)')
checar('Lead Nunca Abordado' in nomes, 'o lead do CRM entra depois das conversas')
checar(lista[0].get('de') == 'conversa' and lista[-1].get('de') == 'lead',
       'cada nome diz de onde veio')

# Disparo para a CONVERSA, sem extensao nenhuma de pe.
r2 = cli.post('/api/deck/comando',
              json={'tipo': 'modelo', 'id': 9, 'chatId': '5519998877665@c.us'}).get_json()
checar((r2.get('comando') or {}).get('estado') == 'na_fila_nuvem', 'a conversa aceita disparo pela nuvem')
checar(r2.get('para') == 'Marcela Ferraz', 'o recado diz o nome certo: ' + str(r2.get('para')))

c = A.db()
f = [dict(x) for x in c.execute("SELECT * FROM whatsapp_extensao_fila WHERE origem='deck_nuvem'").fetchall()]
checar(len(f) == 1 and f[0]['telefone'] == '5519998877665', 'a fila recebeu o telefone da conversa')
checar(bool(f[0]['criado_em']), 'a fila nasceu com carimbo de hora proprio')
A.close_db(c)

# Conversa de outro consultor nao existe para mim.
r3 = cli.post('/api/deck/comando', json={'tipo': 'modelo', 'id': 9, 'chatId': '5511000000000@c.us'})
checar(r3.status_code == 404, 'conversa desconhecida e recusada')

# A lista e espelho: some do WhatsApp, some daqui.
A._deck_guardar_conversas(7, [
    {'chatId': '5519991112222@c.us', 'nome': 'Joao Pedro', 'telefone': '5519991112222', 'em': 900},
])
lista2 = cli.get('/api/deck/whatsapp').get_json()['extensao']['conversas']
checar('Marcela Ferraz' not in [x['nome'] for x in lista2],
       'quem saiu da lista do WhatsApp sai da lista guardada')

print('\n' + ('TUDO CERTO' if not falhas else 'FALHOU: ' + '; '.join(falhas)))
sys.exit(1 if falhas else 0)
