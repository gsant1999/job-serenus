"""Confere que a tela nova de cotacao renderiza e que o salvar funciona.

Roda em SQLite local, sem tocar em producao.
"""
import os, sys, json
os.environ['JOB_DATA_DIR'] = '/tmp/jobtest-cotacao'
os.makedirs('/tmp/jobtest-cotacao', exist_ok=True)
sys.path.insert(0, '/Users/guilhermesantos/Desktop/job-serenus')

import app as A

falhas = []


def ok(cond, nome, extra=''):
    print(('PASSA  ' if cond else 'FALHA  ') + nome + ('  ' + extra if extra else ''))
    if not cond:
        falhas.append(nome)


c = A.app.test_client()
with c.session_transaction() as s:
    s['user_id'] = 1
    s['perfil'] = 'admin'

# 1. A tela abre
r = c.get('/cotacao/novo')
ok(r.status_code == 200, '1. /cotacao/novo abre', 'status=%d' % r.status_code)
html = r.get_data(as_text=True)
ok('Cotação ao vivo' in html, '1b. tem o titulo')
ok('JOB_SITE_REQ' in html, '1c. fala com a extensao')
ok('59-199' in html, '1d. usa a faixa do Painel no JS')
ok('59+' in html, '1e. mostra o rotulo do JOB pro consultor')

# 2. A tela antiga continua de pe
r2 = c.get('/cotacao')
ok(r2.status_code == 200, '2. /cotacao antiga continua abrindo', 'status=%d' % r2.status_code)
ok('/cotacao/novo' in r2.get_data(as_text=True), '2b. tem a porta pra tela nova')

# 3. Salvar uma cotacao de verdade
corpo = {
    'cidade': 'São Paulo - SP', 'modalidade': 2,
    'vidas': [{'faixa': '29-33', 'quantidade': 2}, {'faixa': '59-199', 'quantidade': 1}],
    'cotacaoId': '019fc330-c810-79f3-a00f-8004ecd1a841',
    'url': 'https://beta.paineldocorretor.com.br/cotacoes/x/edit',
    'ms': 9400, 'suspeitos': 0,
    'planos': [
        {'key': '93-60605-88325-', 'operadora': {'id': 93, 'nome': 'Amil'},
         'produto': {'id': 8797, 'nome': 'Amil Saúde - SP'},
         'plano': {'id': 60605, 'nome': 'Bronze SP', 'acomodacao': 0},
         'tabela': {'id': 88325, 'nome': 'Linha Amil', 'coparticipacao': True, 'mei': True,
                    'qtdVidaMin': 5, 'qtdVidaMax': 29},
         'total': 1234.56, 'conferido': True,
         'faixas': [{'faixa': '29-33', 'quantidade': 2, 'unitario': 400.0},
                    {'faixa': '59-199', 'quantidade': 1, 'unitario': 434.56}]},
        {'key': 'x-y-z-', 'operadora': {'id': 1, 'nome': 'Outra'}, 'plano': {'nome': 'Sem preco'},
         'tabela': {}, 'produto': {}, 'total': None, 'faixas': [], 'motivo': 'sem_valor_na_resposta'},
    ],
}
r3 = c.post('/cotacao/viva/salvar', json=corpo)
d3 = r3.get_json()
ok(r3.status_code == 200 and d3.get('ok'), '3. salva a cotacao', json.dumps(d3))
vid = d3.get('id')

# 4. O historico achatado so guarda plano COM preco
conn = A.db()
linhas = conn.execute("SELECT * FROM cotacao_viva_preco WHERE viva_id=?", (vid,)).fetchall()
ok(len(linhas) == 1, '4. so o plano com preco virou historico', '%d linha(s)' % len(linhas))
if linhas:
    L = dict(linhas[0])
    ok(abs(L['total'] - 1234.56) < .001, '4b. total gravado certo', str(L['total']))
    ok(L['operadora'] == 'Amil' and L['plano'] == 'Bronze SP', '4c. operadora e plano gravados')
    ok(L['coparticipacao'] == 1, '4d. coparticipacao gravada')
    # A assinatura e o que permite comparar a MESMA combinacao ao longo do tempo
    ok(L['vidas_assinatura'] == '00-18:0|19-23:0|24-28:0|29-33:2|34-38:0|39-43:0|'
                                '44-48:0|49-53:0|54-58:0|59+:1',
       '4e. assinatura de vidas normalizada', L['vidas_assinatura'])
    fx = json.loads(L['faixas_json'])
    ok(any(f['faixa'] == '59+' for f in fx),
       '4f. faixa do Painel traduzida pro nome do JOB', json.dumps(fx))

# 5. A cotacao salva reabre
r5 = c.get('/cotacao/viva/%d' % vid)
ok(r5.status_code == 200 and 'Bronze SP' in r5.get_data(as_text=True),
   '5. a cotacao salva reabre com os planos', 'status=%d' % r5.status_code)

# 6. Sem cidade nao grava
r6 = c.post('/cotacao/viva/salvar', json={'planos': []})
ok(r6.status_code == 400, '6. sem cidade, recusa', 'status=%d' % r6.status_code)

# 7. Batizar modalidade
r7 = c.post('/cotacao/modalidade', json={'codigo': 1, 'nome': 'PF'})
d7 = r7.get_json()
ok(r7.status_code == 200 and d7['modalidades'].get('1') == 'PF' or
   d7['modalidades'].get(1) == 'PF', '7. batiza um codigo de modalidade', json.dumps(d7))
r7b = c.get('/cotacao/novo')
ok('PF' in r7b.get_data(as_text=True), '7b. o nome novo aparece na tela')

# 8. A rota da extensao exige chave
r8 = c.post('/api/whatsapp/cotacao', json=corpo)
ok(r8.status_code == 401, '8. extensao sem chave e barrada', 'status=%d' % r8.status_code)

# ── catálogo ───────────────────────────────────────────────────────────────
r9 = c.get('/cotacao/catalogo')
ok(r9.status_code == 200, '9. /cotacao/catalogo abre', 'status=%d' % r9.status_code)

CAT = {
    'cidade': 'Campinas - SP', 'modalidade': 2,
    'operadoras': [{'id': 93, 'nome': 'Amil', 'logotipo': 'x.svg'},
                   {'id': 4036, 'nome': 'Alice', 'logotipo': 'y.svg'}],
    'planos': [
        {'operadoraId': 93, 'operadora': 'Amil', 'administradora': 'Amil',
         'produtoId': 8797, 'produto': 'Amil Saúde - SP', 'planoId': 60605, 'plano': 'Bronze SP',
         'acomodacao': 0, 'tabelaId': 88325, 'tabela': 'Linha Amil', 'contratacao': 0,
         'coparticipacao': True, 'coparticipacaoTipo': 'Parcial', 'mei': True,
         'vidaMin': 5, 'vidaMax': 29, 'chave': '93-60605-88325-'},
        {'operadoraId': 4036, 'operadora': 'Alice', 'produtoId': 7950, 'produto': 'Alice',
         'planoId': 54962, 'plano': 'Equilíbrio', 'acomodacao': 1, 'tabelaId': 99937,
         'tabela': 'Tabela de Valores', 'coparticipacao': False,
         'coparticipacaoTipo': 'Sem Coparticipação', 'mei': False,
         'vidaMin': 3, 'vidaMax': 29, 'chave': '4036-54962-99937-'},
        {'operadoraId': 93, 'operadora': 'Amil', 'plano': 'Total SP', 'acomodacao': 1,
         'coparticipacao': True, 'coparticipacaoTipo': 'Total', 'vidaMin': 5, 'vidaMax': 99,
         'chave': '93-1-1-'},
        {'operadoraId': 1, 'operadora': 'Falhou', 'erro': 'http_500'},
    ],
}
r10 = c.post('/cotacao/catalogo/gravar', json=CAT)
d10 = r10.get_json()
ok(r10.status_code == 200 and d10.get('planos') == 3,
   '10. grava o catalogo, ignorando o que falhou', json.dumps(d10))

j = c.get('/cotacao/catalogo.json').get_json()
ok(j['total'] == 3, '10b. consulta devolve os tres', str(j['total']))
faixas = sorted(p['copart_faixa'] for p in j['planos'])
ok(faixas == ['Completa', 'Parcial', 'Sem'],
   '10c. coparticipacao classificada nas tres', str(faixas))

j2 = c.get('/cotacao/catalogo.json?coparticipacao=Sem').get_json()
ok(j2['total'] == 1 and j2['planos'][0]['plano'] == 'Equilíbrio',
   '10d. filtra por coparticipacao', str(j2['total']))
j3 = c.get('/cotacao/catalogo.json?vidas=4').get_json()
ok(j3['total'] == 1 and j3['planos'][0]['operadora'] == 'Alice',
   '10e. filtra por quantidade de vidas', str(j3['total']))
j4 = c.get('/cotacao/catalogo.json?acomodacao=1&mei=0').get_json()
ok(j4['total'] == 2, '10f. filtra por acomodacao', str(j4['total']))

# 11. Varrer de novo nao duplica, e marca o que sumiu
CAT2 = dict(CAT)
CAT2['planos'] = [CAT['planos'][0]]          # Alice e Total SP sairam de linha
r11 = c.post('/cotacao/catalogo/gravar', json=CAT2)
ok(r11.get_json().get('planos') == 1, '11. segunda varredura grava so o que veio')
j5 = c.get('/cotacao/catalogo.json').get_json()
ok(j5['total'] == 1, '11b. o que sumiu sai da consulta', str(j5['total']))
todos = conn.execute("SELECT chave, sumiu_em FROM catalogo_plano ORDER BY chave").fetchall()
ok(len(todos) == 3, '11c. mas continua no banco, nao apaga', '%d linhas' % len(todos))
ok(sum(1 for t in todos if t['sumiu_em']) == 2, '11d. os dois ficam datados como retirados')

# 12. Registro da varredura
rv = c.post('/cotacao/catalogo/varredura', json={'acao': 'abrir', 'alvos': 6}).get_json()
ok(rv.get('ok') and rv.get('id'), '12. abre o registro da varredura', json.dumps(rv))
rf = c.post('/cotacao/catalogo/varredura',
            json={'id': rv['id'], 'feitos': 6, 'planos': 120, 'estado': 'terminada'}).get_json()
ok(rf.get('ok'), '12b. fecha o registro')

# 13. Plano que sumiu e VOLTA deixa de estar marcado como retirado
r13 = c.post('/cotacao/catalogo/gravar', json=CAT)
ok(r13.get_json().get('planos') == 3, '13. terceira varredura traz os tres de volta')
j6 = c.get('/cotacao/catalogo.json').get_json()
ok(j6['total'] == 3, '13b. os que voltaram reaparecem na consulta', str(j6['total']))
vivos = conn.execute("SELECT COUNT(*) AS n FROM catalogo_plano WHERE sumiu_em IS NULL").fetchone()
ok(vivos['n'] == 3, '13c. a marca de retirado foi desfeita', str(vivos['n']))


# 14. Seletor de cidade do proprio JOB (lista do IBGE, formato do Painel)
cid = c.get('/api/cidades?term=hortolandia').get_json()
ok(cid == ['Hortolândia - SP'], '14. acha sem acento igual ao Painel', json.dumps(cid, ensure_ascii=False))
cid2 = c.get('/api/cidades?term=hor').get_json()
ok('Horizonte - CE' in cid2 and 'Belo Horizonte - MG' in cid2,
   '14b. trecho no meio do nome tambem acha', '%d resultados' % len(cid2))
ok(cid2.index('Horizonte - CE') < cid2.index('Belo Horizonte - MG'),
   '14c. quem COMECA com o termo vem antes')
ok(c.get('/api/cidades?term=c').get_json() == [], '14d. uma letra so nao busca')
ok(len(c.get('/api/cidades?term=sao').get_json()) <= 40, '14e. teto de 40 sugestoes')
# As 18 cidades vistas no Painel de verdade tem que existir aqui
vistas = ['Belo Horizonte - MG', 'Hortolândia - SP', 'Campinas - SP', 'São Paulo - SP',
          'Novo Horizonte do Sul - MS', 'Monte Horebe - PB']
faltando = [v for v in vistas
            if v not in c.get('/api/cidades?term=' + v.split(' - ')[0][:6]).get_json()]
ok(not faltando, '14f. as cidades reais do Painel existem no JOB', str(faltando))

# 15. Operadoras do catalogo, sem passar pela extensao
op = c.get('/cotacao/catalogo/operadoras.json?cidade=Campinas - SP&modalidade=2').get_json()
ok(op['ok'] and len(op['operadoras']) == 2,
   '15. tela pega operadoras do catalogo sem o Painel', str(len(op['operadoras'])))
op2 = c.get('/cotacao/catalogo/operadoras.json?cidade=Cidade Inexistente - XX').get_json()
ok(op2['operadoras'] == [], '15b. cidade sem catalogo devolve vazio, nao erro')


# 16. Produtos do catalogo, pra escolher ANTES de cotar
pr = c.get('/cotacao/catalogo/produtos.json?cidade=Campinas - SP&modalidade=2').get_json()
nomes = sorted(x['produto'] for x in pr['produtos'])
ok(pr['ok'] and len(pr['produtos']) == 3, '16. lista produtos da cidade', str(nomes))
ok(all('planos' in x and 'operadora' in x for x in pr['produtos']),
   '16b. cada produto diz quantos planos e de quem')
pr2 = c.get('/cotacao/catalogo/produtos.json?cidade=Campinas - SP&modalidade=2&operadoras=93').get_json()
ok(all(x['operadora'] == 'Amil' for x in pr2['produtos']),
   '16c. filtra produtos por operadora', str([x['produto'] for x in pr2['produtos']]))
pr3 = c.get('/cotacao/catalogo/produtos.json?cidade=Nao Varrida - SP').get_json()
ok(pr3['produtos'] == [], '16d. cidade sem catalogo devolve vazio, nao erro')


# 17. Rodizio mensal: alvos, quem esta vencido, e datar depois de varrer
rv = c.post('/cotacao/catalogo/alvos', json={'alvos': [
    {'cidade': 'Campinas - SP', 'modalidade': 2, 'intervalo_dias': 30},
    {'cidade': 'Hortolandia - SP', 'modalidade': 2, 'intervalo_dias': 30}]}).get_json()
ok(rv['ok'] and len(rv['alvos']) == 2, '17. poe cidades no rodizio', str(len(rv['alvos'])))
ok(rv['vencido'] is not None, '17b. quem nunca foi varrido ja conta como vencido',
   (rv['vencido'] or {}).get('cidade'))

# Duas vezes o mesmo alvo nao duplica
rv2 = c.post('/cotacao/catalogo/alvos', json={'alvos': [
    {'cidade': 'Campinas - SP', 'modalidade': 2}]}).get_json()
ok(len(rv2['alvos']) == 2, '17c. por o mesmo alvo de novo nao duplica', str(len(rv2['alvos'])))

# A extensao sem chave nao consegue perguntar nem gravar
ok(c.get('/api/whatsapp/catalogo/proximo').status_code == 401,
   '17d. extensao sem chave e barrada ao perguntar')
ok(c.post('/api/whatsapp/catalogo/gravar', json={}).status_code == 401,
   '17e. extensao sem chave e barrada ao gravar')

# Depois de varrer, o alvo fica datado e sai da fila
conn.execute("UPDATE catalogo_alvo SET ultima_em=? WHERE cidade=?", (A._agora_sp(), 'Campinas - SP'))
conn.commit()
rv3 = c.get('/cotacao/catalogo/alvos').get_json()
venc = rv3['vencido']
ok(venc and venc['cidade'] == 'Hortolandia - SP',
   '17f. o vencido passa a ser o outro', (venc or {}).get('cidade'))

# Com todos datados hoje, nada vencido
conn.execute("UPDATE catalogo_alvo SET ultima_em=?", (A._agora_sp(),))
conn.commit()
ok(c.get('/cotacao/catalogo/alvos').get_json()['vencido'] is None,
   '17g. com tudo em dia, a extensao nao tem o que fazer')

# Alvo antigo volta pra fila
conn.execute("UPDATE catalogo_alvo SET ultima_em='2020-01-01 10:00:00' WHERE cidade=?",
             ('Hortolandia - SP',))
conn.commit()
v4 = c.get('/cotacao/catalogo/alvos').get_json()['vencido']
ok(v4 and v4['cidade'] == 'Hortolandia - SP', '17h. passado o intervalo, volta pra fila')


# 18. A extensao batiza o codigo sozinha (le o rotulo na tela do Painel)
ok(c.post('/api/whatsapp/cotacao/modalidade', json={'codigo': 3, 'nome': 'Adesao'}).status_code == 401,
   '18. sem chave, nao batiza')
ok(c.post('/api/whatsapp/cotacao/modalidade', json={'codigo': 3},
          headers={'X-Extension-Key': 'errada'}).status_code == 401,
   '18b. chave errada tambem nao')

print('\n' + ('%d FALHA(S)' % len(falhas) if falhas else 'tudo passou (final)'))
sys.exit(1 if falhas else 0)
