# -*- coding: utf-8 -*-
"""A medicao do deck: registra o que interessa e NAO registra o que nao deve."""
import os, sys, tempfile
os.environ['JOB_DATA_DIR'] = tempfile.mkdtemp(prefix='deck_medir_')
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import app as A

falhas = []
def checar(cond, o_que):
    print(('  ok  ' if cond else ' FALHA') + '  ' + o_que)
    if not cond: falhas.append(o_que)

c = A.db()
c.execute("INSERT INTO usuarios (id,nome,email,senha_hash,perfil,ativo) VALUES (7,'Consultor','c@c','x','consultor',1)")
c.execute("UPDATE usuarios SET perfil='admin' WHERE id=1")
c.commit(); A.close_db(c)

cli = A.app.test_client()
with cli.session_transaction() as s:
    s['user_id'] = 7; s['perfil'] = 'consultor'

cli.post('/api/deck/uso', json={'evento': 'abriu', 'modo': 'nuvem'})
for ms, buscou in ((4000, False), (9000, True), (60000, False)):
    cli.post('/api/deck/uso', json={'evento': 'tocou', 'modo': 'nuvem', 'chave': 'modelo:9',
                                    'rotulo': 'Boas-vindas', 'secao': 'mensagens',
                                    'pasta': 'Abertura', 'buscou': buscou, 'ms': ms})
cli.post('/api/deck/uso', json={'evento': 'desfecho', 'chave': 'modelo:9', 'desfecho': 'foi'})
cli.post('/api/deck/uso', json={'evento': 'desfecho', 'chave': 'modelo:9',
                                'desfecho': 'falhou', 'motivo': 'numero invalido'})
r = cli.post('/api/deck/uso', json={'evento': 'inventado'})
checar(r.status_code == 400, 'evento que nao existe e recusado')

c = A.db()
linhas = [dict(x) for x in c.execute("SELECT * FROM deck_uso").fetchall()]
checar(len(linhas) == 6, f'registrou 6 linhas, veio {len(linhas)}')
colunas = set(linhas[0].keys())
checar(not (colunas & {'telefone', 'chat_id', 'texto', 'nome_cliente'}),
       'nao existe coluna para dado de cliente')
A.close_db(c)

# Consultor nao ve o uso do time.
checar(cli.get('/api/deck/uso/resumo').status_code == 403, 'consultor nao ve o resumo')

with cli.session_transaction() as s:
    s['user_id'] = 1; s['perfil'] = 'admin'
res = cli.get('/api/deck/uso/resumo').get_json()
checar(res['toques'] == 3 and res['aberturas'] == 1, 'contou toques e aberturas')
checar(res['achar_a_tecla_segundos']['mediana'] == 9.0,
       'mediana em segundos: ' + str(res['achar_a_tecla_segundos']['mediana']))
checar(res['achar_a_tecla_segundos']['p95'] == 60.0,
       'p95 mostra o dia ruim, que a media esconderia: ' + str(res['achar_a_tecla_segundos']['p95']))
checar(res['usou_busca_pct'] == 33, 'quanto da busca foi usada: ' + str(res['usou_busca_pct']))
checar(res['teclas_mais_tocadas'][0] == ['Boas-vindas', 3], 'ranking por tecla')
checar(res['falha_pct'] == 50 and res['motivos_de_falha'][0][0] == 'numero invalido',
       'falha com o motivo junto')
checar('Consultor' in res['por_consultor'], 'diz de quem e o numero')

print('\n' + ('TUDO CERTO' if not falhas else 'FALHOU: ' + '; '.join(falhas)))
sys.exit(1 if falhas else 0)
