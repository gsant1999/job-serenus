"""Mensagem vence no prazo do próprio tipo — e nunca morre calada.

O teto de validade nasceu no incidente de 18/08/2026 (17 mensagens de até três
semanas atrás saíram para clientes quando uma rotina parada voltou). Começou em
6h, foi para 1h no mesmo dia, e ainda era o instrumento errado sozinho:

- Um número só para tudo trata igual coisas com pressas diferentes. Uma abertura
  de lead pago ("oi, vi que você pediu uma cotação") só vale perto do momento em
  que a pessoa preencheu o formulário; uma hora depois já chega estranha. Uma
  mensagem que o consultor digitou para uma conversa aberta dura mais.

- E, pior: vencer em silêncio. O item virava `cancelado_atraso` e ninguém ficava
  sabendo. O consultor achava que tinha mandado; o cliente nunca recebeu nada.
  É a mesma falha silenciosa que já custou 7 dias de leitura parada aqui.

O que fecha o assunto não é o número — é a pendência. A mensagem pode não sair,
mas alguém sempre fica sabendo, com o telefone de quem ficou sem resposta.

    python3 testes/testar_fila_validade.py
"""

import os
import sys
import tempfile
from datetime import timedelta

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
os.environ['JOB_MODO_TESTE'] = '1'
os.environ['JOB_DATA_DIR'] = tempfile.mkdtemp(prefix='jobtest-validade-')
os.environ['SEED_DADOS_SERENUS'] = '0'

import app as A  # noqa: E402

FALHAS = []


def checa(nome, cond, detalhe=''):
    print(('  ok    ' if cond else '  FALHA ') + nome + (f'  << {detalhe}' if detalhe and not cond else ''))
    if not cond:
        FALHAS.append(nome)


with A.app.app_context():
    conn = A.db()
    if not conn.execute("SELECT id FROM usuarios WHERE id=1").fetchone():
        conn.execute("INSERT INTO usuarios (id,nome,email,senha_hash,perfil,ativo) "
                     "VALUES (1,'Danilo','d@t.com','x','consultor',1)")
    conn.commit()
    A.close_db(conn)


def semear(origem, idade_min, tel='5519999990000'):
    with A.app.app_context():
        conn = A.db()
        quando = (A.datetime.now(A.TZ_SP) - timedelta(minutes=idade_min)).strftime('%Y-%m-%d %H:%M:%S')
        conn.execute("""INSERT INTO whatsapp_extensao_fila
            (lead_id, responsavel_id, telefone, chat_id, tipo, texto, origem, status, criado_em)
            VALUES (NULL,1,?,?,'texto',?,?, 'pendente',?)""",
                     (tel, tel + '@c.us', 'Oi, vi que voce pediu uma cotacao', origem, quando))
        conn.commit()
        fid = conn.execute("SELECT MAX(id) m FROM whatsapp_extensao_fila").fetchone()['m']
        A.close_db(conn)
    return fid


def puxar():
    """Chama a rota que a extensão chama — é ela que aplica o vencimento."""
    c = A.app.test_client()
    with c.session_transaction() as s:
        s['user_id'] = 1
    return c.get('/api/whatsapp/fila/proximo?usuario_id=1')


def status(fid):
    with A.app.app_context():
        conn = A.db()
        r = conn.execute("SELECT status, erro FROM whatsapp_extensao_fila WHERE id=?", (fid,)).fetchone()
        A.close_db(conn)
    return (r['status'], r['erro'] or '') if r else (None, '')


def pendencias_de(fid):
    with A.app.app_context():
        conn = A.db()
        r = conn.execute("""SELECT titulo, descricao, severidade, como_resolver, usuario_id
                            FROM notificacoes WHERE chave=? AND resolvida_em IS NULL""",
                         (f'wa_fila_venceu:{fid}',)).fetchall()
        A.close_db(conn)
    return [dict(x) for x in r]


print('\n— O prazo é do tipo da mensagem, não um número só pra tudo')
print(f'    lead_pago: {A._wa_fila_validade_min("lead_pago")} min'
      f'  |  crm_lead: {A._wa_fila_validade_min("crm_lead")} min'
      f'  |  campanha_funil: {A._wa_fila_validade_min("campanha_funil")} min')
checa('abertura de lead pago vence em minutos, não horas',
      A._wa_fila_validade_min('lead_pago') <= 20)
checa('mensagem comum tem mais folga que a abertura',
      A._wa_fila_validade_min('crm_lead') > A._wa_fila_validade_min('lead_pago'))
checa('origem desconhecida cai no padrão, não em zero',
      A._wa_fila_validade_min('coisa_que_nao_existe') == A._WA_FILA_VALIDADE_HORAS * 60)

print('\n— Lead pago de 30 minutos: já não vale a pena mandar')
fid = semear('lead_pago', 30)
puxar()
st, erro = status(fid)
checa('venceu', st == 'cancelado_atraso', f'status={st}')
checa('e o motivo fica escrito, pra ficar auditável', 'min na fila' in erro, erro[:80])

print('\n— E ALGUÉM FICA SABENDO. Este é o ponto do conserto.')
p = pendencias_de(fid)
checa('abriu pendência no sino', len(p) == 1, f'{len(p)} pendências')
if p:
    checa('a pendência é do consultor dono da mensagem', p[0]['usuario_id'] == 1)
    checa('diz que é lead pago sem resposta', 'Lead pago' in (p[0]['titulo'] or ''), p[0]['titulo'])
    checa('traz o telefone de quem ficou esperando',
          '5519999990000' in (p[0]['descricao'] or ''), p[0]['descricao'])
    checa('é tratada como erro, não como aviso qualquer',
          p[0]['severidade'] == 'erro', p[0]['severidade'])
    checa('diz o que fazer agora', 'na mão' in (p[0]['como_resolver'] or ''), p[0]['como_resolver'])

print('\n— Mensagem comum de 30 minutos ainda vale: não pode ser morta junto')
fid2 = semear('crm_lead', 30)
puxar()
st2, _ = status(fid2)
checa('continua viva', st2 in ('pendente', 'enviando'), f'status={st2}')
checa('e não abriu pendência à toa', len(pendencias_de(fid2)) == 0)

print('\n— Mensagem comum passada do prazo também avisa')
fid3 = semear('crm_lead', 90)
puxar()
st3, _ = status(fid3)
p3 = pendencias_de(fid3)
checa('venceu', st3 == 'cancelado_atraso', f'status={st3}')
checa('abriu pendência', len(p3) == 1)
if p3:
    checa('mas sem alarme de lead pago, que é outra urgência',
          p3[0]['severidade'] == 'atencao', p3[0]['severidade'])

print('\n— Lead pago recém-criado sai normalmente')
fid4 = semear('lead_pago', 2)
r = puxar()
d = r.get_json() or {}
checa('a rota entrega a mensagem nova', bool(d.get('item')), str(d)[:120])
checa('e ela não virou pendência', len(pendencias_de(fid4)) == 0)

print('\n— Repetir a checagem não duplica pendência no sino')
puxar(); puxar()
checa('a mesma mensagem vencida tem uma pendência só', len(pendencias_de(fid)) == 1,
      f'{len(pendencias_de(fid))}')

print()
if FALHAS:
    print(f'FALHOU: {len(FALHAS)}')
    for f in FALHAS:
        print('  -', f)
    sys.exit(1)
print('VALIDADE DA FILA: prazo por tipo, e nada morre calado')
