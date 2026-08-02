"""Testa os parsers do cotador contra as respostas REAIS do Painel do Corretor.

Nao chama o Painel: le o arquivo do mapeamento e confere se a leitura acerta.
E uma traducao fiel das funcoes de cotador-painel.js — se algo passar aqui e
falhar la, a diferenca esta na traducao, nao na logica.
"""
import json, re, sys

MAPA = '/Users/guilhermesantos/Downloads/mapa-painel-v2.json'
d = json.load(open(MAPA))

UUID36 = r'[0-9a-f-]{36}'


def classificar(url, corpo):
    try:
        x = json.loads(corpo)
    except Exception:
        return None
    if not isinstance(x, list) or not x:
        return None
    if re.search(r'/cotacoes/nova$', url) and isinstance(x[0], dict) and isinstance(x[0].get('titulo'), str):
        return 'criar'
    if len(x) == 1 and isinstance(x[0], dict) and isinstance(x[0].get('filtro'), dict) and x[0]['filtro'].get('cidade'):
        return 'operadoras'
    if len(x) == 1 and isinstance(x[0], dict) and x[0].get('operadoraId') and isinstance(x[0].get('vidas'), list):
        return 'planos'
    if len(x) == 2 and isinstance(x[0], str) and isinstance(x[1], dict) and x[1].get('key') and x[1].get('plano'):
        return 'preco'
    return None


def primeiro_array(texto):
    for linha in str(texto).split('\n'):
        v = linha.find(':')
        if v < 0:
            continue
        resto = linha[v + 1:]
        if not resto.startswith('['):
            continue
        try:
            x = json.loads(resto)
        except Exception:
            continue
        if isinstance(x, list) and x and isinstance(x[0], dict):
            return x
    return None


RX_VALOR = re.compile(r'"value":([\d.]+)\}')
RX_FAIXA = re.compile(
    r'\["\$","div","(\d+-\d+)",\{[\s\S]{0,300}?"children":\[(\d+)," x ","R\$\s?([\d.]+,\d\d)"\]')


def cartoes(texto):
    pos = [(m.start(), float(m.group(1))) for m in RX_VALOR.finditer(texto)]
    saida = []
    for i, (p, total) in enumerate(pos):
        fim = pos[i + 1][0] if i + 1 < len(pos) else min(len(texto), p + 6000)
        trecho = texto[p:fim]
        faixas = [{'faixa': f.group(1),
                   'quantidade': int(f.group(2)),
                   'unitario': float(f.group(3).replace('.', '').replace(',', '.'))}
                  for f in RX_FAIXA.finditer(trecho)]
        soma = sum(f['quantidade'] * f['unitario'] for f in faixas)
        t = round(total, 2)
        saida.append({'total': t, 'faixas': faixas,
                      'conferido': bool(faixas) and abs(soma - t) < 0.05})
    return saida


def novo_cartao(antes, depois):
    sobra = list(depois)
    for a in antes:
        for i, b in enumerate(sobra):
            if b['total'] == a['total']:
                sobra.pop(i)
                break
    return sobra[0] if sobra else None


def serve(plano, vidas, exig):
    total = sum(int(v.get('quantidade') or 0) for v in (vidas or []))
    t = plano.get('tabela') or {}
    if t.get('qtdVidaMin') and total < t['qtdVidaMin']:
        return False
    if t.get('qtdVidaMax') and total > t['qtdVidaMax']:
        return False
    e = exig or {}
    if e.get('coparticipacao') is not None and bool(t.get('coparticipacao')) != bool(e['coparticipacao']):
        return False
    if e.get('mei') is True and t.get('mei') is not True:
        return False
    if e.get('acomodacao') is not None and (plano.get('plano') or {}).get('acomodacao') != e['acomodacao']:
        return False
    return True


falhas = []


def ok(cond, nome, extra=''):
    print(('PASSA  ' if cond else 'FALHA  ') + nome + ('  ' + extra if extra else ''))
    if not cond:
        falhas.append(nome)


chamadas = [c for c in d['chamadas'] if isinstance(c.get('enviou'), str)]

# 1. Reconhece os quatro papeis, e cada papel tem um hash so
papeis = {}
for c in chamadas:
    p = classificar(c['url'], c['enviou'])
    h = (c.get('cabecalhos') or {}).get('next-action')
    if p and h:
        papeis.setdefault(p, set()).add(h)
ok(len(papeis) == 4, '1. reconhece os 4 papeis', str(sorted(papeis)))
for p, hs in sorted(papeis.items()):
    ok(len(hs) == 1, '1.%s: um hash so' % p, list(hs)[0][:14] + '...')

# 2. Nenhum hash classificado como dois papeis diferentes
por_hash = {}
for c in chamadas:
    p = classificar(c['url'], c['enviou'])
    h = (c.get('cabecalhos') or {}).get('next-action')
    if p and h:
        por_hash.setdefault(h, set()).add(p)
ok(all(len(s) == 1 for s in por_hash.values()), '2. nenhum hash com dois papeis')

# 3. Operadoras
c_op = next(c for c in chamadas if classificar(c['url'], c['enviou']) == 'operadoras')
ops = primeiro_array(c_op['resposta'])
ok(bool(ops) and len(ops) > 5 and ops[0].get('id') and ops[0].get('nome'),
   '3. le operadoras', '%d operadoras, 1a=%s' % (len(ops or []), (ops or [{}])[0].get('nome')))

# 4. Planos
c_pl = [c for c in chamadas if classificar(c['url'], c['enviou']) == 'planos']
planos0 = primeiro_array(c_pl[0]['resposta'])
ok(bool(planos0) and all(p.get('key') and p.get('plano') and p.get('tabela') for p in planos0),
   '4. le planos', '%d planos, 1o=%s' % (len(planos0 or []), (planos0 or [{}])[0].get('plano', {}).get('nome')))

# 5. O diff sequencial rende um cartao novo por chamada de preco
c_pr = [c for c in chamadas if classificar(c['url'], c['enviou']) == 'preco']
estado, novos = [], 0
for c in c_pr:
    agora = cartoes(c['resposta'])
    if novo_cartao(estado, agora):
        novos += 1
    estado = agora
ok(novos == len(c_pr), '5. cada preco rende um cartao novo', '%d de %d' % (novos, len(c_pr)))

# 6. Soma das faixas bate com o total
conf = bate = 0
for c in c_pr:
    for cart in cartoes(c['resposta']):
        if not cart['faixas']:
            continue
        conf += 1
        soma = sum(f['quantidade'] * f['unitario'] for f in cart['faixas'])
        if abs(soma - cart['total']) < 0.05:
            bate += 1
ok(conf > 0 and bate == conf, '6. soma das faixas bate com o total',
   '%d de %d cartoes com faixa' % (bate, conf))

# 6b. Toda faixa pedida volta detalhada — inclusive a ultima ("59 ou mais"),
#     que e a mais cara e a que o rotulo humano escondia.
faixas_por_cartao = [len(c['faixas']) for x in c_pr for c in cartoes(x['resposta']) if c['faixas']]
ok(faixas_por_cartao and min(faixas_por_cartao) == 10,
   '6b. as 10 faixas voltam, inclusive "59 ou mais"',
   'minimo=%d maximo=%d' % (min(faixas_por_cartao or [0]), max(faixas_por_cartao or [0])))
ok(all(c['conferido'] for x in c_pr for c in cartoes(x['resposta']) if c['faixas']),
   '6c. a guarda "conferido" acende verde em todos')

# 7. Filtro de vidas: os 122 planos reais sao todos de 3-29 ou 5-29 vidas, entao
#    com 10 vidas TODOS passam mesmo — o que precisa ser testado e a fronteira.
def com(n):
    return [{'faixa': '29-33', 'quantidade': n}]


todos = [p for c in c_pl for p in (primeiro_array(c['resposta']) or [])]
minimos = sorted({p['tabela']['qtdVidaMin'] for p in todos})
ok(len([p for p in todos if serve(p, com(10), {})]) == len(todos),
   '7a. 10 vidas cabe em todos os planos reais', '%d planos' % len(todos))
ok(len([p for p in todos if serve(p, com(2), {})]) == 0,
   '7b. 2 vidas nao cabe em nenhum (minimo e %s)' % minimos)
ok(len([p for p in todos if serve(p, com(40), {})]) == 0,
   '7c. 40 vidas estoura o maximo de todos')
ok(0 < len([p for p in todos if serve(p, com(4), {})]) < len(todos),
   '7d. 4 vidas separa os de minimo 3 dos de minimo 5',
   '%d de %d' % (len([p for p in todos if serve(p, com(4), {})]), len(todos)))

# 7e. Exigencias: coparticipacao filtra de verdade nos dois sentidos
comCo = len([p for p in todos if serve(p, com(10), {'coparticipacao': True})])
semCo = len([p for p in todos if serve(p, com(10), {'coparticipacao': False})])
ok(comCo > 0 and semCo > 0 and comCo + semCo == len(todos),
   '7e. coparticipacao parte a lista em duas', 'com=%d sem=%d' % (comCo, semCo))

# 7f. Todo plano cotado tem faixa de vidas declarada — senao o filtro seria cego
ok(all(p['tabela'].get('qtdVidaMin') and p['tabela'].get('qtdVidaMax') for p in todos),
   '7f. todo plano declara minimo e maximo de vidas')

# 8. Id da cotacao criada
c_nova = next(c for c in chamadas if classificar(c['url'], c['enviou']) == 'criar')
m = re.search(r'"cotacaoId":"(%s)"' % UUID36, c_nova['resposta'], re.I)
esperado = re.search(UUID36, d['pagina']).group(0)
ok(bool(m) and m.group(1) == esperado, '8. le o id da cotacao criada',
   '%s (esperado %s)' % (m.group(1) if m else 'nao achou', esperado))

# 9. Por que a ancora "cotacaoId" e nao um UUID solto: o corpo traz os ids de
#    OUTRAS cotacoes junto (a lista do corretor). O primeiro UUID calha de ser
#    o certo nesta captura, mas isso e ordem de render, nao garantia.
outros = set(re.findall(UUID36, c_nova['resposta'], re.I)) - {esperado}
ok(len(outros) > 0, '9. o corpo traz ids de outras cotacoes (por isso a ancora)',
   '%d outros ids no mesmo corpo' % len(outros))
ok(len(set(re.findall(r'"cotacaoId":"(%s)"' % UUID36, c_nova['resposta'], re.I))) == 1,
   '9b. "cotacaoId" aparece com um valor unico')

# 10. Resposta de LISTA nao tem "value" — o parser de preco nao confunde
ok(len(RX_VALOR.findall(c_pl[0]['resposta'])) == 0,
   '10. resposta de lista nao tem valor solto')

print('\n' + ('%d FALHA(S)' % len(falhas) if falhas else 'tudo passou'))
sys.exit(1 if falhas else 0)
