"""A fila vence sozinha, mesmo com todas as extensões paradas.

Dois defeitos reais achados em 19/08/2026, olhando a fila de produção:

1. FUSO. `criado_em` vinha do default do banco (CURRENT_TIMESTAMP), que é UTC
   nos dois motores. O vencimento compara com horário de São Paulo. Resultado:
   mensagem recém-criada aparecia com idade NEGATIVA — 174 minutos no futuro —
   e ficava ~3h imune ao prazo. A trava de validade que nasceu do incidente de
   18/08 (43 mensagens velhas saíram de uma vez) só começava a valer 3h depois
   do previsto.

2. O VENCIMENTO DEPENDIA DA EXTENSÃO. A checagem morava dentro de
   /api/whatsapp/fila/proximo — a rota que a extensão chama para pedir
   trabalho. Ou seja: o consultor cuja extensão parou, que é justamente o caso
   que importa, nunca disparava a checagem. As mensagens dele ficavam
   'pendente' para sempre: não saíam, não venciam e não avisavam ninguém.

   Foi assim que 5 aberturas de lead pago (Aline e Bianca) ficaram de 8 a 15
   horas paradas. Leads que a Serenus pagou, sem primeira mensagem, em
   silêncio. Depender do componente quebrado para reportar a própria quebra é a
   receita da falha silenciosa.

    python3 testes/testar_fila_varredura.py
"""

import os
import sys
import tempfile
from datetime import timedelta

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
os.environ['JOB_MODO_TESTE'] = '1'
os.environ['JOB_DATA_DIR'] = tempfile.mkdtemp(prefix='jobtest-varre-')
os.environ['SEED_DADOS_SERENUS'] = '0'

import app as A  # noqa: E402

FALHAS = []


def checa(nome, cond, detalhe=''):
    print(('  ok    ' if cond else '  FALHA ') + nome + (f'  << {detalhe}' if detalhe and not cond else ''))
    if not cond:
        FALHAS.append(nome)


with A.app.app_context():
    conn = A.db()
    for uid, nome in ((1, 'Consultor Ativo'), (2, 'Consultor Sumido')):
        if not conn.execute("SELECT id FROM usuarios WHERE id=?", (uid,)).fetchone():
            conn.execute("INSERT INTO usuarios (id,nome,email,senha_hash,perfil,ativo) "
                         "VALUES (?,?,?,'x','consultor',1)", (uid, nome, f'u{uid}@t.com'))
    conn.commit()
    A.close_db(conn)


def semear(origem, idade_min, uid=1, tel='5519999990000'):
    """Cria um item com idade REAL de N minutos (carimbo em SP, como agora)."""
    with A.app.app_context():
        conn = A.db()
        quando = (A.datetime.now(A.TZ_SP) - timedelta(minutes=idade_min)).strftime('%Y-%m-%d %H:%M:%S')
        conn.execute("""INSERT INTO whatsapp_extensao_fila
            (lead_id,responsavel_id,telefone,chat_id,tipo,texto,origem,status,criado_em)
            VALUES (NULL,?,?,?,'texto','oi',?, 'pendente',?)""",
                     (uid, tel, tel + '@c.us', origem, quando))
        conn.commit()
        fid = conn.execute("SELECT MAX(id) m FROM whatsapp_extensao_fila").fetchone()['m']
        A.close_db(conn)
    return fid


def status(fid):
    with A.app.app_context():
        conn = A.db()
        r = conn.execute("SELECT status FROM whatsapp_extensao_fila WHERE id=?", (fid,)).fetchone()
        A.close_db(conn)
    return r['status'] if r else None


print('\n1) Todo insert carimba a hora — nenhum depende do default do banco')
import re  # noqa: E402
fonte = open(os.path.join(RAIZ, 'app.py'), encoding='utf-8').read()
sem_carimbo = 0
for m in re.finditer(r'INSERT INTO whatsapp_extensao_fila(.{0,360})', fonte, re.S):
    cols = re.search(r'\(([^)]*)\)', m.group(1))
    if not (cols and 'criado_em' in cols.group(1)):
        sem_carimbo += 1
checa('nenhum insert usa o default (UTC) do banco', sem_carimbo == 0, f'{sem_carimbo} sem criado_em')

print('\n2) Idade de uma mensagem recém-criada é positiva (era -174 min)')
novo = semear('lead_pago', 0)
with A.app.app_context():
    conn = A.db()
    nasceu = conn.execute("SELECT criado_em FROM whatsapp_extensao_fila WHERE id=?", (novo,)).fetchone()['criado_em']
    A.close_db(conn)
idade = A._wa_segundos_desde(nasceu)
checa('idade não é negativa', idade is not None and idade >= -1, f'{idade}s')
checa('idade é de segundos, não de horas', idade is not None and abs(idade) < 120, f'{idade}s')

print('\n3) A varredura vence sem NENHUMA extensão chamar a rota')
velho_pago = semear('lead_pago', 45, uid=2)     # limite 20 min
velho_funil = semear('funil_manual', 30, uid=2)  # limite 5 min
novo_pago = semear('lead_pago', 2, uid=2)        # ainda dentro do prazo
checa('nasceram pendentes', all(status(x) == 'pendente' for x in (velho_pago, velho_funil, novo_pago)))

with A.app.app_context():
    conn = A.db()
    n = A._wa_fila_vencer_atrasados(conn)   # sem usuario_id = varre todo mundo
    conn.commit()
    A.close_db(conn)
checa('a varredura venceu os atrasados', n >= 2, f'venceu {n}')
checa('lead pago de 45 min venceu', status(velho_pago) == 'cancelado_atraso', status(velho_pago))
checa('funil de 30 min venceu', status(velho_funil) == 'cancelado_atraso', status(velho_funil))
checa('o de 2 min continua de pé', status(novo_pago) == 'pendente', status(novo_pago))

print('\n4) Quem ficou sem mensagem vira pendência (ninguém morre calado)')
# A pendência vive em `notificacoes` (tipo='pendencia'), não numa tabela
# separada. A primeira versão deste teste consultava `pendencias`, engolia o
# erro de tabela inexistente e passava com -1: teste que passa por acidente é
# pior que teste nenhum, porque dá sensação de cobertura sem cobrir nada.
with A.app.app_context():
    conn = A.db()
    linhas = [dict(x) for x in conn.execute(
        "SELECT usuario_id, titulo, severidade FROM notificacoes "
        "WHERE chave LIKE 'wa_fila_venceu:%' AND tipo='pendencia'").fetchall()]
    A.close_db(conn)
checa('abriu pendência para cada vencido', len(linhas) >= 2, f'{len(linhas)} pendência(s)')
checa('lead pago é tratado como erro, não aviso',
      any(x['severidade'] == 'erro' for x in linhas))
checa('a pendência vai para o dono da mensagem',
      bool(linhas) and all(x['usuario_id'] == 2 for x in linhas),
      str([x['usuario_id'] for x in linhas]))
checa('o texto chega acentuado ao consultor',
      any('não' in (x['titulo'] or '') for x in linhas),
      str([(x['titulo'] or '')[:40] for x in linhas]))

print('\n5) A varredura tem rede de segurança contra restart')
checa('roda no agendador', "sched.add_job(_varrer_fila_vencida" in fonte)
checa('e também por request (APScheduler morre em restart)', '_varrer_fila_throttled()' in fonte)
checa('o throttle é de 5 min', '_VARREDURA_FILA_INTERVALO = 300' in fonte)

print('\n6) A migração do fuso é função própria, não pendurada em outra')
checa('existe função própria', 'def _migrar_fila_criado_em_utc():' in fonte)
checa('é chamada no startup', '\n_migrar_fila_criado_em_utc()' in fonte)
# Pendurar migração em migração alheia herda o early-return dela: foi assim que
# a primeira versão nunca rodou em produção.
_ini = fonte.find('def _migrar_motivo_recusa_corretor():')
_fim = fonte.find('\ndef ', _ini + 10)
checa('não vive dentro da migração que retorna cedo',
      'fila_criado_em_utc' not in fonte[_ini:_fim])

print('\n7) Varrer duas vezes não reabre nem duplica')
with A.app.app_context():
    conn = A.db()
    n2 = A._wa_fila_vencer_atrasados(conn)
    conn.commit()
    A.close_db(conn)
checa('segunda varredura não vence nada de novo', n2 == 0, f'venceu {n2}')
checa('o já vencido continua vencido', status(velho_pago) == 'cancelado_atraso')

print()
if FALHAS:
    print(f'{len(FALHAS)} FALHA(S): ' + ', '.join(FALHAS))
    sys.exit(1)
print('tudo certo: a fila vence sozinha, na hora certa, e avisa quem precisa saber.')
