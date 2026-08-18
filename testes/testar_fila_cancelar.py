"""Desistir de uma mensagem que ainda não saiu — e nunca poder "desistir" de uma
que já saiu.

Contexto (18/08/2026): o consultor clicava em enviar, o servidor respondia "o
WhatsApp libera este envio em cerca de 27 s", e a mensagem ficava na fila sem
nenhuma forma de voltar atrás. Fechar a janela não cancelava nada — a rotina de
fundo mandava assim que o intervalo abrisse. Quem achou que não tinha enviado
mandou de novo na mão, e o cliente recebeu duas vezes.

Na escala grande, é a mesma família do incidente do mesmo dia: 17 mensagens de
até três semanas atrás saíram quando uma rotina parada voltou.

A rota só SUBTRAI: não existe caminho aqui que faça uma mensagem sair. O pior
resultado possível é uma mensagem não ser enviada — que é exatamente o pedido.

    python3 testes/testar_fila_cancelar.py
"""

import os
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
os.environ['JOB_MODO_TESTE'] = '1'
os.environ['JOB_DATA_DIR'] = tempfile.mkdtemp(prefix='jobtest-fila-cancelar-')
os.environ['SEED_DADOS_SERENUS'] = '0'

import app as A  # noqa: E402

FALHAS = []


def checa(nome, cond, detalhe=''):
    print(('  ok    ' if cond else '  FALHA ') + nome + (f'  << {detalhe}' if detalhe and not cond else ''))
    if not cond:
        FALHAS.append(nome)


with A.app.app_context():
    conn = A.db()
    for uid, nome in ((1, 'Danilo'), (2, 'Outra consultora')):
        if not conn.execute("SELECT id FROM usuarios WHERE id=?", (uid,)).fetchone():
            conn.execute("INSERT INTO usuarios (id,nome,email,senha_hash,perfil,ativo) "
                         "VALUES (?,?,?,'x','consultor',1)", (uid, nome, f'{uid}@t.com'))
    conn.commit()
    A.close_db(conn)


def novo_item(status='pendente', responsavel=1, origem='crm_lead'):
    with A.app.app_context():
        conn = A.db()
        conn.execute("""INSERT INTO whatsapp_extensao_fila
            (lead_id, responsavel_id, telefone, chat_id, tipo, texto, origem, status, criado_em)
            VALUES (NULL,?,?,?,'texto',?,?,?,?)""",
                     (responsavel, '5519999990000', '5519999990000@c.us',
                      'Oi, vi que você pediu uma cotação', origem, status, A._agora_sp()))
        conn.commit()
        fid = conn.execute("SELECT MAX(id) m FROM whatsapp_extensao_fila").fetchone()['m']
        A.close_db(conn)
    return fid


def estado(fid):
    with A.app.app_context():
        conn = A.db()
        r = conn.execute("SELECT status, erro FROM whatsapp_extensao_fila WHERE id=?", (fid,)).fetchone()
        A.close_db(conn)
    return (r['status'], r['erro']) if r else (None, None)


def cliente(uid):
    c = A.app.test_client()
    with c.session_transaction() as s:
        s['user_id'] = uid
    return c


dono = cliente(1)
outra = cliente(2)


print('\n— O caso de todo dia: desistir antes de sair')
fid = novo_item('pendente')
r = dono.post(f'/api/whatsapp/fila/{fid}/cancelar', json={'usuario_id': 1})
checa('cancela mensagem pendente', r.status_code == 200 and (r.get_json() or {}).get('ok'),
      f'{r.status_code} {r.get_json()}')
st, erro = estado(fid)
checa('some da fila de envio', st == 'cancelado', f'status={st}')
checa('grava o motivo, pra ficar auditável', bool(erro), f'erro={erro}')

fid = novo_item('enviando')
r = dono.post(f'/api/whatsapp/fila/{fid}/cancelar', json={'usuario_id': 1})
checa('cancela mensagem já reivindicada (status enviando)',
      r.status_code == 200 and estado(fid)[0] == 'cancelado')

fid = novo_item('pendente')
r = dono.post(f'/api/whatsapp/fila/{fid}/cancelar',
              json={'usuario_id': 1, 'motivo': 'A janela de envio foi fechada antes de a mensagem sair.'})
checa('aceita o motivo que a extensão manda',
      'janela de envio' in (estado(fid)[1] or ''), estado(fid)[1])


print('\n— O que NÃO pode acontecer')
fid = novo_item('enviado')
r = dono.post(f'/api/whatsapp/fila/{fid}/cancelar', json={'usuario_id': 1})
checa('mensagem JÁ ENVIADA não pode ser "cancelada"', r.status_code == 409,
      f'{r.status_code} {r.get_json()}')
checa('e o estado dela não é tocado', estado(fid)[0] == 'enviado', estado(fid)[0])

fid = novo_item('pendente', responsavel=1)
r = outra.post(f'/api/whatsapp/fila/{fid}/cancelar', json={'usuario_id': 2})
checa('uma consultora não cancela o envio de outra', r.status_code == 403,
      f'{r.status_code} {r.get_json()}')
checa('a mensagem da colega continua de pé', estado(fid)[0] == 'pendente', estado(fid)[0])

r = dono.post('/api/whatsapp/fila/99999/cancelar', json={'usuario_id': 1})
checa('id que não existe responde 404, não 500', r.status_code == 404, str(r.status_code))

fid = novo_item('falhou')
r = dono.post(f'/api/whatsapp/fila/{fid}/cancelar', json={'usuario_id': 1})
checa('mensagem que já falhou não vira cancelada', r.status_code == 409, str(r.status_code))


print('\n— Repetir é seguro (a extensão repete quando a resposta se perde)')
fid = novo_item('pendente')
r1 = dono.post(f'/api/whatsapp/fila/{fid}/cancelar', json={'usuario_id': 1})
r2 = dono.post(f'/api/whatsapp/fila/{fid}/cancelar', json={'usuario_id': 1})
checa('primeira chamada cancela', r1.status_code == 200)
checa('segunda não quebra nem ressuscita a mensagem',
      r2.status_code == 409 and estado(fid)[0] == 'cancelado',
      f'{r2.status_code} status={estado(fid)[0]}')


print('\n— A rota nunca faz uma mensagem SAIR')
with A.app.app_context():
    conn = A.db()
    saiu = conn.execute("SELECT COUNT(*) c FROM whatsapp_extensao_fila WHERE status='enviado'").fetchone()['c']
    A.close_db(conn)
checa('nenhuma mensagem passou a "enviado" durante os testes', saiu == 1,
      f'{saiu} enviadas (só a que já nasceu assim)')

print()
if FALHAS:
    print(f'FALHOU: {len(FALHAS)}')
    for f in FALHAS:
        print('  -', f)
    sys.exit(1)
print('CANCELAR ENVIO: tudo passou')
