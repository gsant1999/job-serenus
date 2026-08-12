"""Rede de seguranca da Biblioteca de Conteudo (WhatsApp, SMS, e-mail e Funis).

Antes de reorganizar a biblioteca, e preciso ter como provar que nada se perdeu.
Este arquivo monta uma biblioteca de mentira num SQLite proprio (nunca toca em
producao), com os oito casos que a reorganizacao pode quebrar: conteudo de
WhatsApp, de SMS, de e-mail, conteudo com midia, Funil, passo de Funil,
referencia de Fluxo (`upload_<id>`) e as permissoes de gestor, dono e nao-dono.

Roda assim, da raiz do repositorio:

    /usr/bin/python3 testes/testar_biblioteca.py

O interpretador importa: o `python3` do Homebrew nao tem as dependencias do
app (dateutil, pytz, requests); o do sistema tem.
"""
import os
import shutil
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = '/tmp/jobtest-biblioteca'

# Banco novo a cada rodada: teste que depende de sobra da rodada anterior nao
# prova nada. Feito ANTES de importar o app, que ja abre o banco no import.
shutil.rmtree(BASE, ignore_errors=True)
os.makedirs(BASE, exist_ok=True)
os.environ['JOB_DATA_DIR'] = BASE
os.environ['WHATSAPP_EXT_KEY'] = 'chave-de-teste-biblioteca'
os.environ.setdefault('SEED_DADOS_SERENUS', '0')
sys.path.insert(0, RAIZ)

import app as A  # noqa: E402

falhas = []


def ok(cond, nome, extra=''):
    print(('PASSA  ' if cond else 'FALHA  ') + nome + (('  ' + str(extra)) if extra else ''))
    if not cond:
        falhas.append(nome)


def _ins(conn, sql, params):
    cur = conn.cursor()
    cur.execute(sql, params)
    return A._last_insert_id(cur)


# ─── Biblioteca de mentira ──────────────────────────────────────────────────
DADOS = {}


def semear():
    conn = A.db()
    ana = _ins(conn, "INSERT INTO usuarios (nome,email,perfil,ativo) VALUES (?,?,?,1)",
               ('Ana Consultora', 'ana@teste.local', 'consultor'))
    bruno = _ins(conn, "INSERT INTO usuarios (nome,email,perfil,ativo) VALUES (?,?,?,1)",
                 ('Bruno Consultor', 'bruno@teste.local', 'consultor'))
    raiz_comp = _ins(conn, "INSERT INTO pastas (nome,parent_id,consultor_id) VALUES (?,NULL,NULL)",
                     ('Compartilhado',))
    raiz_ana = _ins(conn, "INSERT INTO pastas (nome,parent_id,consultor_id) VALUES (?,NULL,?)",
                    ('Ana Consultora', ana))
    raiz_bruno = _ins(conn, "INSERT INTO pastas (nome,parent_id,consultor_id) VALUES (?,NULL,?)",
                      ('Bruno Consultor', bruno))
    sub_ana = _ins(conn, "INSERT INTO pastas (nome,parent_id,consultor_id) VALUES (?,?,NULL)",
                   ('Primeiro contato', raiz_ana))
    sub_ana2 = _ins(conn, "INSERT INTO pastas (nome,parent_id,consultor_id) VALUES (?,?,NULL)",
                    ('Pos-venda', raiz_ana))
    sub_comp = _ins(conn, "INSERT INTO pastas (nome,parent_id,consultor_id) VALUES (?,?,NULL)",
                    ('Operadoras', raiz_comp))

    def modelo(tipo, nome, **kw):
        return _ins(conn, """INSERT INTO modelos_conteudo
            (tipo,nome,assunto,corpo_html,corpo_texto,variante,ativo,criado_por,
             midia_arquivo,midia_tipo,categoria,favorito,vezes_usado,pasta_id,dono_consultor_id)
            VALUES (?,?,?,?,?,?,1,1,?,?,?,0,0,?,?)""",
            (tipo, nome, kw.get('assunto'), kw.get('corpo_html'), kw.get('corpo_texto'),
             kw.get('variante'), kw.get('midia_arquivo'), kw.get('midia_tipo'),
             kw.get('categoria'), kw.get('pasta_id'), kw.get('dono')))

    wa_ana = modelo('whatsapp', 'Ana - primeiro contato', corpo_texto='Oi {{nome}}, tudo bem?',
                    pasta_id=sub_ana, dono=ana, categoria='Primeiro contato')
    wa_ana_audio = modelo('whatsapp', 'Ana - audio de apresentacao', corpo_texto='Escuta esse audio',
                          midia_arquivo='MODELO_WPP_TESTE_audio.ogg', midia_tipo='audio',
                          pasta_id=sub_ana, dono=ana)
    wa_bruno = modelo('whatsapp', 'Bruno - retomada', corpo_texto='Bruno falando',
                      pasta_id=raiz_bruno, dono=bruno)
    wa_comp = modelo('whatsapp', 'Compartilhado - tabela Amil', corpo_texto='Segue a tabela',
                     midia_arquivo='MODELO_WPP_TESTE_tabela.pdf', midia_tipo='documento',
                     pasta_id=sub_comp, dono=None)
    email_comp = modelo('email', 'E-mail de renovacao', assunto='{{nome}}, sua renovacao',
                        corpo_html='<html><body>Ola {{nome}}</body></html>', pasta_id=sub_comp)
    sms_comp = modelo('sms', 'SMS de reforco', corpo_texto='{{nome}}, consegue falar hoje?',
                      pasta_id=sub_comp)
    email_ana = modelo('email', 'Ana - proposta enviada', assunto='Sua proposta',
                       corpo_html='<html><body>Proposta</body></html>',
                       pasta_id=sub_ana2, dono=ana)
    sms_ana = modelo('sms', 'Ana - lembrete', corpo_texto='Lembrete da Ana', pasta_id=sub_ana2, dono=ana)
    # Legado: sem pasta e sem dono. Nao pode sumir da tela em nenhuma fase.
    wa_legado = modelo('whatsapp', 'Legado sem pasta', corpo_texto='Item antigo do acervo')

    funil_ana = _ins(conn, """INSERT INTO whatsapp_funis
        (nome,categoria,favorito,ativo,vezes_disparado,criado_por,pasta_id,dono_consultor_id)
        VALUES (?,NULL,0,1,0,?,?,?)""", ('Ana - boas-vindas', ana, sub_ana, ana))
    for ordem, mid in enumerate([wa_ana, wa_ana_audio], 1):
        _ins(conn, """INSERT INTO whatsapp_funil_passos (funil_id,ordem,modelo_id,delay_segundos)
             VALUES (?,?,?,?)""", (funil_ana, ordem, mid, 5))
    funil_comp = _ins(conn, """INSERT INTO whatsapp_funis
        (nome,categoria,favorito,ativo,vezes_disparado,criado_por,pasta_id,dono_consultor_id)
        VALUES (?,NULL,0,1,0,?,?,NULL)""", ('Compartilhado - tabela', 1, sub_comp))
    _ins(conn, """INSERT INTO whatsapp_funil_passos (funil_id,ordem,modelo_id,delay_segundos)
         VALUES (?,1,?,5)""", (funil_comp, wa_comp))
    # Funil da Ana que depende de conteudo do Bruno: o caso que a transferencia
    # tem que enxergar antes de mover qualquer coisa.
    funil_misto = _ins(conn, """INSERT INTO whatsapp_funis
        (nome,categoria,favorito,ativo,vezes_disparado,criado_por,pasta_id,dono_consultor_id)
        VALUES (?,NULL,0,1,0,?,?,?)""", ('Ana - com passo do Bruno', ana, sub_ana, ana))
    _ins(conn, """INSERT INTO whatsapp_funil_passos (funil_id,ordem,modelo_id,delay_segundos)
         VALUES (?,1,?,5)""", (funil_misto, wa_ana))
    _ins(conn, """INSERT INTO whatsapp_funil_passos (funil_id,ordem,modelo_id,delay_segundos)
         VALUES (?,2,?,5)""", (funil_misto, wa_bruno))

    fluxo = _ins(conn, "INSERT INTO fluxos (nome,descricao,ativo) VALUES (?,?,1)",
                 ('Fluxo de teste', 'Usa e-mail e SMS da biblioteca'))
    _ins(conn, """INSERT INTO fluxo_passos (fluxo_id,ordem,canal,template,delay_dias)
         VALUES (?,1,'email',?,0)""", (fluxo, 'upload_%d' % email_comp))
    _ins(conn, """INSERT INTO fluxo_passos (fluxo_id,ordem,canal,template,delay_dias)
         VALUES (?,2,'sms',?,1)""", (fluxo, 'upload_%d' % sms_comp))
    conn.commit()
    A.close_db(conn)
    DADOS.update(dict(ana=ana, bruno=bruno, raiz_comp=raiz_comp, raiz_ana=raiz_ana,
                      raiz_bruno=raiz_bruno, sub_ana=sub_ana, sub_ana2=sub_ana2,
                      sub_comp=sub_comp, wa_ana=wa_ana, wa_ana_audio=wa_ana_audio,
                      wa_bruno=wa_bruno, wa_comp=wa_comp, email_comp=email_comp,
                      sms_comp=sms_comp, email_ana=email_ana, sms_ana=sms_ana,
                      wa_legado=wa_legado, funil_ana=funil_ana, funil_comp=funil_comp,
                      funil_misto=funil_misto, fluxo=fluxo))


semear()

# Clientes separados de proposito: cookie de sessao do site mascara o token da
# extensao (o `requer` da a vez pra sessao), e o teste deixaria de provar o que
# a consultora vive no WhatsApp.
c_admin = A.app.test_client()
with c_admin.session_transaction() as s:
    s['user_id'] = 1
    s['perfil'] = 'admin'
c_ana = A.app.test_client()
with c_ana.session_transaction() as s:
    s['user_id'] = DADOS['ana']
    s['perfil'] = 'consultor'
c_ext = A.app.test_client()
CHAVE = {'X-Extension-Key': os.environ['WHATSAPP_EXT_KEY']}


def ext_get(url, usuario_id):
    sep = '&' if '?' in url else '?'
    return c_ext.get('%s%susuario_id=%d' % (url, sep, usuario_id), headers=CHAVE)


def ext_post(url, usuario_id, corpo=None):
    dados = dict(corpo or {})
    dados['usuario_id'] = usuario_id
    return c_ext.post(url, headers=CHAVE, json=dados)


print('')
print('── 1. A biblioteca abre e mostra os tres canais ────────────────────────')
r = c_admin.get('/crm/modelos')
ok(r.status_code == 200, '1a. /crm/modelos abre para o gestor', 'status=%d' % r.status_code)
html = r.get_data(as_text=True)
ok('Ana - primeiro contato' in html, '1b. mostra conteudo de WhatsApp')
ok('E-mail de renovacao' in html, '1c. mostra conteudo de e-mail')
ok('SMS de reforco' in html, '1d. mostra conteudo de SMS')
ok('Legado sem pasta' in html, '1e. mostra o item legado sem pasta (nao some)')

print('')
print('── 2. Extensao: proprio + compartilhado, nunca o do colega ─────────────')
r = ext_get('/api/whatsapp/extensao/modelos', DADOS['ana'])
ok(r.status_code == 200, '2a. extensao lista mensagens', 'status=%d' % r.status_code)
nomes = [m['nome'] for m in (r.get_json() or {}).get('modelos', [])]
ok('Ana - primeiro contato' in nomes, '2b. Ana ve o proprio conteudo')
ok('Compartilhado - tabela Amil' in nomes, '2c. Ana ve o compartilhado')
ok('Bruno - retomada' not in nomes, '2d. Ana NAO ve o conteudo do Bruno')
r = ext_get('/api/whatsapp/extensao/funis', DADOS['ana'])
funis = [f['nome'] for f in (r.get_json() or {}).get('funis', [])]
ok('Ana - boas-vindas' in funis, '2e. Ana ve o proprio funil')
ok('Compartilhado - tabela' in funis, '2f. Ana ve o funil compartilhado')
ok('Ana - com passo do Bruno' not in funis,
   '2g. funil com passo de outro dono nao vaza pela extensao')

print('')
print('── 3. Envio pela extensao respeita o dono ──────────────────────────────')
r = ext_post('/api/whatsapp/enviar-direto', DADOS['ana'], {
    'chat_id': '5511999990001@c.us', 'nome': 'Lead Teste 1',
    'texto': 'Oi', 'modelo_id': DADOS['wa_ana']})
ok(r.status_code == 200 and (r.get_json() or {}).get('ok'),
   '3a. Ana envia o proprio conteudo', 'status=%d' % r.status_code)
r = ext_post('/api/whatsapp/enviar-direto', DADOS['ana'], {
    'chat_id': '5511999990002@c.us', 'nome': 'Lead Teste 2',
    'texto': 'Segue', 'modelo_id': DADOS['wa_comp']})
ok(r.status_code == 200 and (r.get_json() or {}).get('ok'),
   '3b. Ana envia o conteudo compartilhado', 'status=%d' % r.status_code)
r = ext_post('/api/whatsapp/enviar-direto', DADOS['ana'], {
    'chat_id': '5511999990003@c.us', 'nome': 'Lead Teste 3',
    'texto': 'Nao devia sair', 'modelo_id': DADOS['wa_bruno']})
ok(r.status_code == 403, '3c. o servidor barra o envio de conteudo do colega',
   'status=%d' % r.status_code)

print('')
print('── 4. Permissoes de nao-dono nas acoes da extensao ─────────────────────')
r = ext_post('/api/whatsapp/extensao/modelos/%d/excluir' % DADOS['wa_bruno'], DADOS['ana'])
ok(r.status_code == 403, '4a. Ana nao exclui conteudo do Bruno', 'status=%d' % r.status_code)
r = ext_post('/api/whatsapp/extensao/modelos/%d/favorito' % DADOS['wa_bruno'], DADOS['ana'])
ok(r.status_code == 403, '4b. Ana nao favorita conteudo do Bruno', 'status=%d' % r.status_code)
r = ext_post('/api/whatsapp/extensao/modelos/%d/duplicar' % DADOS['wa_bruno'], DADOS['ana'])
ok(r.status_code == 403, '4c. Ana nao duplica conteudo do Bruno', 'status=%d' % r.status_code)
r = ext_post('/api/whatsapp/extensao/modelos/%d/duplicar' % DADOS['wa_comp'], DADOS['ana'])
ok(r.status_code == 200, '4d. Ana duplica o compartilhado para a pasta dela',
   'status=%d' % r.status_code)
copia_id = (r.get_json() or {}).get('id')

print('')
print('── 5. Duplicar cria item novo e nao encosta no original ────────────────')
conn = A.db()
orig = dict(conn.execute("SELECT * FROM modelos_conteudo WHERE id=?", (DADOS['wa_comp'],)).fetchone())
copia = dict(conn.execute("SELECT * FROM modelos_conteudo WHERE id=?", (copia_id,)).fetchone())
A.close_db(conn)
ok(copia_id != DADOS['wa_comp'], '5a. a copia tem ID proprio')
ok(orig['dono_consultor_id'] is None, '5b. o original continua compartilhado')
ok(copia['dono_consultor_id'] == DADOS['ana'], '5c. a copia nasce com dono')
ok(copia['midia_arquivo'] == orig['midia_arquivo'],
   '5d. a copia reaproveita o arquivo de midia (nao duplica o blob)')
ok(orig['corpo_texto'] == 'Segue a tabela', '5e. o texto do original nao mudou')

print('')
print('── 6. Referencia de Fluxo (upload_<id>) continua resolvendo ────────────')
conn = A.db()
passos = [dict(p) for p in conn.execute(
    "SELECT * FROM fluxo_passos WHERE fluxo_id=? ORDER BY ordem", (DADOS['fluxo'],)).fetchall()]
lead_sem_contato = {'id': 1, 'nome': 'Lead Sem Contato', 'email': '', 'telefone': '',
                    'responsavel_id': DADOS['ana']}
res_email = A._fluxo_executar_passo(conn, passos[0], lead_sem_contato)
res_sms = A._fluxo_executar_passo(conn, passos[1], lead_sem_contato)
A.close_db(conn)
# Nao envia nada: o lead nao tem e-mail nem telefone. Se o modelo tivesse sumido,
# a mensagem seria "Modelo enviado #N nao existe mais" — e esse e o ponto.
ok(res_email[2] == DADOS['email_comp'], '6a. o passo de e-mail achou o modelo certo', res_email[1])
ok('nao existe mais' not in (res_email[1] or ''), '6b. o modelo de e-mail continua la')
ok(res_sms[2] == DADOS['sms_comp'], '6c. o passo de SMS achou o modelo certo', res_sms[1])
ok('nao existe mais' not in (res_sms[1] or ''), '6d. o modelo de SMS continua la')

print('')
print('── 7. Mover de pasta preserva o ID e o vinculo do Fluxo ────────────────')
r = c_admin.post('/crm/modelos/%d/mover-pasta' % DADOS['email_comp'],
                 json={'pasta_id': DADOS['raiz_comp']})
ok(r.status_code == 200 and (r.get_json() or {}).get('ok'),
   '7a. gestor move um e-mail de pasta', 'status=%d' % r.status_code)
conn = A.db()
depois = dict(conn.execute("SELECT id, pasta_id, corpo_html FROM modelos_conteudo WHERE id=?",
                           (DADOS['email_comp'],)).fetchone())
passo = dict(conn.execute("SELECT * FROM fluxo_passos WHERE fluxo_id=? AND ordem=1",
                          (DADOS['fluxo'],)).fetchone())
res = A._fluxo_executar_passo(conn, passo, lead_sem_contato)
A.close_db(conn)
ok(depois['id'] == DADOS['email_comp'], '7b. o ID do e-mail nao mudou ao mover')
ok(depois['pasta_id'] == DADOS['raiz_comp'], '7c. a pasta mudou')
ok(depois['corpo_html'] and 'Ola {{nome}}' in depois['corpo_html'], '7d. o HTML continua intacto')
ok(res[2] == DADOS['email_comp'], '7e. o Fluxo continua achando o mesmo modelo depois de mover')

print('')
print('── 8. Conteudo com midia sobrevive as operacoes ────────────────────────')
conn = A.db()
audio = dict(conn.execute("SELECT midia_arquivo, midia_tipo FROM modelos_conteudo WHERE id=?",
                          (DADOS['wa_ana_audio'],)).fetchone())
passos_funil = [dict(p) for p in conn.execute(
    "SELECT ordem, modelo_id FROM whatsapp_funil_passos WHERE funil_id=? ORDER BY ordem",
    (DADOS['funil_ana'],)).fetchall()]
A.close_db(conn)
ok(audio['midia_arquivo'] == 'MODELO_WPP_TESTE_audio.ogg', '8a. o arquivo do audio continua ligado')
ok(audio['midia_tipo'] == 'audio', '8b. o tipo da midia continua audio')
ok([p['modelo_id'] for p in passos_funil] == [DADOS['wa_ana'], DADOS['wa_ana_audio']],
   '8c. os passos do funil continuam apontando para os mesmos conteudos')

print('')
if falhas:
    print('%d verificacao(oes) falharam:' % len(falhas))
    for f in falhas:
        print('   - ' + f)
    sys.exit(1)
print('Tudo passou.')
