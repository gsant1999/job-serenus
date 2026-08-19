"""O funil não morre junto com a aba — e o que ele promete, ele cumpre.

Até 19/08/2026 a sequência tocava DENTRO do WhatsApp Web: um laço em memória que
dormia o intervalo e mandava o próximo passo. Fechar ou recarregar a página
matava o funil no meio. O cliente ficava com dois passos de cinco — sem o teto
de coparticipação, sem a pergunta final — e ninguém era avisado: nem o
consultor (que achava que tinha mandado tudo), nem o servidor.

Agora a sequência inteira nasce na fila do servidor, cada passo com o horário em
que pode sair. Isso resolve o sumiço, mas abre três riscos novos que este
arquivo tranca:

1. ORDEM E RITMO. Se os horários saírem errados, o cliente recebe o áudio antes
   da imagem que o explica. O intervalo do passo vale ANTES dele sair — um
   primeiro passo com intervalo 0 tem que nascer liberado, senão o clique do
   consultor ganha uma espera que ele não pediu.

2. CANCELAR TEM QUE ALCANÇAR O SERVIDOR. Enquanto rodava na aba, cancelar era
   levantar uma flag no laço. Agora os passos que faltam são linhas no banco:
   se cancelar não as apagar, a tela diz "cancelado" enquanto o cliente recebe a
   sequência inteira.

3. FUNIL ATRASADO NÃO VIRA RAJADA. Se o consultor fechar o WhatsApp e voltar
   depois, os passos vencidos não podem sair todos de uma vez, fora de contexto.
   É a mesma lição do incidente de 18/08 (43 mensagens de até três semanas
   saíram quando uma rotina parada voltou), agora com prazo curto: funil
   disparado na mão é coisa de conversa ao vivo.

    python3 testes/testar_funil_persistencia.py
"""

import os
import sys
import tempfile
from datetime import timedelta

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
os.environ['JOB_MODO_TESTE'] = '1'
os.environ['JOB_DATA_DIR'] = tempfile.mkdtemp(prefix='jobtest-funil-')
os.environ['SEED_DADOS_SERENUS'] = '0'

import app as A  # noqa: E402

FALHAS = []
CHAT = '5519999990000@c.us'
TEL = '5519999990000'


def checa(nome, cond, detalhe=''):
    print(('  ok    ' if cond else '  FALHA ') + nome + (f'  << {detalhe}' if detalhe and not cond else ''))
    if not cond:
        FALHAS.append(nome)


def cliente(uid=1):
    c = A.app.test_client()
    with c.session_transaction() as s:
        s['user_id'] = uid
        s['perfil'] = 'admin'
    return c


with A.app.app_context():
    conn = A.db()
    for uid, nome in ((1, 'Consultor Um'), (2, 'Consultor Dois')):
        if not conn.execute("SELECT id FROM usuarios WHERE id=?", (uid,)).fetchone():
            conn.execute("INSERT INTO usuarios (id,nome,email,senha_hash,perfil,ativo) "
                         "VALUES (?,?,?,'x','consultor',1)", (uid, nome, f'u{uid}@t.com'))
    cur = conn.cursor()
    modelos = []
    for nome, txt, arq, mt in (('P1 texto', 'Bom dia!', None, None),
                               ('P2 audio', '', 'a.ogg', 'audio'),
                               ('P3 imagem', 'olha a tabela', 't.jpg', 'imagem')):
        cur.execute("""INSERT INTO modelos_conteudo
            (tipo,nome,corpo_texto,ativo,criado_por,midia_arquivo,midia_tipo,dono_consultor_id)
            VALUES ('whatsapp',?,?,1,1,?,?,1)""", (nome, txt, arq, mt))
        modelos.append(A._last_insert_id(cur))
    # Funil do consultor 1, com os mesmos intervalos de um funil real do acervo
    # (0s / 43s / 19s — "COPARTICIPAÇÃO VERA CRUZ").
    cur.execute("INSERT INTO whatsapp_funis (nome,ativo,criado_por,dono_consultor_id) "
                "VALUES ('VERA CRUZ COPART',1,1,1)")
    FUNIL = A._last_insert_id(cur)
    for ordem, (mid, delay) in enumerate(zip(modelos, [0, 43, 19]), 1):
        conn.execute("INSERT INTO whatsapp_funil_passos (funil_id,ordem,modelo_id,delay_segundos) "
                     "VALUES (?,?,?,?)", (FUNIL, ordem, mid, delay))
    # Funil que pertence a OUTRO consultor — ninguém mais pode disparar.
    cur.execute("INSERT INTO whatsapp_funis (nome,ativo,criado_por,dono_consultor_id) "
                "VALUES ('FUNIL DO COLEGA',1,2,2)")
    FUNIL_ALHEIO = A._last_insert_id(cur)
    conn.execute("INSERT INTO whatsapp_funil_passos (funil_id,ordem,modelo_id,delay_segundos) "
                 "VALUES (?,1,?,0)", (FUNIL_ALHEIO, modelos[0]))
    conn.commit()
    A.close_db(conn)


def linhas():
    with A.app.app_context():
        conn = A.db()
        r = [dict(x) for x in conn.execute(
            "SELECT id,tipo,texto,midia_arquivo,status,liberar_em FROM whatsapp_extensao_fila "
            "WHERE origem='funil_manual' ORDER BY id").fetchall()]
        A.close_db(conn)
    return r


print('\n1) A sequência inteira vira fila no servidor, com o ritmo do funil')
r = cliente().post(f'/api/whatsapp/extensao/funis/{FUNIL}/disparar',
                   json={'chat_id': CHAT, 'telefone': TEL, 'usuario_id': 1})
corpo = r.get_json() or {}
checa('disparar responde ok', r.status_code == 200 and corpo.get('ok'), f'{r.status_code} {corpo}')
checa('os 3 passos foram enfileirados', corpo.get('total') == 3, str(corpo.get('total')))
ls = linhas()
checa('3 linhas no banco', len(ls) == 3, str(len(ls)))

base = A._parse_dt_seguro(ls[0]['liberar_em'])
offs = [int((A._parse_dt_seguro(x['liberar_em']) - base).total_seconds()) for x in ls]
# 0 / 43 / 62: o intervalo de cada passo é esperado ANTES dele sair, acumulando.
checa('ritmo preservado (t+0, t+43, t+62)', offs == [0, 43, 62], str(offs))
checa('ordem: texto, áudio, imagem', [x['tipo'] for x in ls] == ['texto', 'audio', 'imagem'],
      str([x['tipo'] for x in ls]))
checa('mídia veio junto', [x['midia_arquivo'] for x in ls] == [None, 'a.ogg', 't.jpg'],
      str([x['midia_arquivo'] for x in ls]))

agora = A.datetime.now(A.TZ_SP)
p1 = A._parse_dt_seguro(ls[0]['liberar_em'])
if p1.tzinfo is None:
    agora = agora.replace(tzinfo=None)
checa('primeiro passo nasce liberado (clique não espera)', p1 <= agora)

print('\n2) O clique explícito entrega o primeiro passo na hora')
r = cliente().post(f"/api/whatsapp/fila/{ls[0]['id']}/enviar-agora", json={'usuario_id': 1})
corpo = r.get_json() or {}
checa('enviar-agora aceita funil_manual', r.status_code == 200 and corpo.get('ok'),
      f'{r.status_code} {corpo}')
checa('devolveu o item pra extensão mandar', bool(corpo.get('item')), str(corpo)[:120])

print('\n3) Cancelar alcança o servidor: passo pendente não sai')
alvo = ls[2]['id']
r = cliente().post(f'/api/whatsapp/fila/{alvo}/cancelar',
                   json={'usuario_id': 1, 'motivo': 'funil cancelado pelo consultor'})
checa('cancelar responde ok', r.status_code == 200, str(r.status_code))
with A.app.app_context():
    conn = A.db()
    st = conn.execute("SELECT status FROM whatsapp_extensao_fila WHERE id=?", (alvo,)).fetchone()['status']
    A.close_db(conn)
checa('o passo cancelado saiu de pendente', st != 'pendente', f'status={st}')

print('\n4) Funil atrasado não vira rajada: vence em 5 minutos')
checa('prazo do funil_manual é curto', A._wa_fila_validade_min('funil_manual') == 5,
      str(A._wa_fila_validade_min('funil_manual')))
checa('é bem menor que o padrão', A._wa_fila_validade_min('funil_manual') < A._wa_fila_validade_min('outra_coisa'))

with A.app.app_context():
    conn = A.db()
    velho = (A.datetime.now(A.TZ_SP) - timedelta(minutes=30)).strftime('%Y-%m-%d %H:%M:%S')
    conn.execute("""INSERT INTO whatsapp_extensao_fila
        (lead_id,responsavel_id,telefone,chat_id,tipo,texto,origem,status,criado_em,liberar_em)
        VALUES (NULL,1,?,?,'texto','passo atrasado','funil_manual','pendente',?,?)""",
                 (TEL, CHAT, velho, velho))
    conn.commit()
    atrasado = conn.execute("SELECT MAX(id) m FROM whatsapp_extensao_fila").fetchone()['m']
    conn.execute("UPDATE whatsapp_extensao_fila SET status='enviado' WHERE status='enviando'")
    conn.execute("UPDATE whatsapp_extensao_fila SET enviado_em=NULL WHERE 1=1")
    conn.commit()
    A.close_db(conn)
cliente().get('/api/whatsapp/fila/proximo?usuario_id=1')
with A.app.app_context():
    conn = A.db()
    st = conn.execute("SELECT status FROM whatsapp_extensao_fila WHERE id=?", (atrasado,)).fetchone()['status']
    A.close_db(conn)
checa('passo de 30 min atrás não sai — vence', st != 'pendente', f'status={st}')

print('\n5) Ninguém dispara o funil de um colega')
r = cliente(1).post(f'/api/whatsapp/extensao/funis/{FUNIL_ALHEIO}/disparar',
                    json={'chat_id': CHAT, 'telefone': TEL, 'usuario_id': 1})
checa('funil de outro dono é recusado', r.status_code == 403, str(r.status_code))

print('\n6) Funil sem passo não cria fila fantasma')
with A.app.app_context():
    conn = A.db()
    cur = conn.cursor()
    cur.execute("INSERT INTO whatsapp_funis (nome,ativo,criado_por,dono_consultor_id) "
                "VALUES ('VAZIO',1,1,1)")
    vazio = A._last_insert_id(cur)
    conn.commit()
    A.close_db(conn)
r = cliente().post(f'/api/whatsapp/extensao/funis/{vazio}/disparar',
                   json={'chat_id': CHAT, 'telefone': TEL, 'usuario_id': 1})
checa('funil vazio é recusado com motivo', r.status_code == 400, str(r.status_code))

print('\n7) Sem conversa aberta não dispara')
r = cliente().post(f'/api/whatsapp/extensao/funis/{FUNIL}/disparar',
                   json={'chat_id': '', 'telefone': TEL, 'usuario_id': 1})
checa('sem chat_id é recusado', r.status_code == 400, str(r.status_code))

print()
if FALHAS:
    print(f'{len(FALHAS)} FALHA(S): ' + ', '.join(FALHAS))
    sys.exit(1)
print('tudo certo: o funil sobrevive à aba, respeita o ritmo, e não vira rajada.')
