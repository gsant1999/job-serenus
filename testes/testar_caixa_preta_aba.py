"""Caixa-preta da aba do WhatsApp: o registro que prova por que a aba morreu.

Guilherme, 18/08/2026: "TEMOS QUE MENSURAR AS FALHAS." A aba do WhatsApp dos
consultores estava morrendo com "Ah, nao! Codigo de erro: 5" — o renderizador do
Chrome sendo morto, quase sempre por memoria — e nao sobrava prova nenhuma.
Crash de renderizador NAO dispara window.onerror, entao o /api/whatsapp/erro,
que ja existia, nunca ficava sabendo: a falha mais grave era a unica invisivel.

Este arquivo trava o lado do servidor dessa caixa-preta: a rota aceita o retrato
que a aba gravou antes de morrer, recusa evento desconhecido, nao deixa numero
torto entrar no banco, e responde mediana e p95 — que e como o projeto exige ler
medicao (nunca so a media).

Roda assim, da raiz do repositorio:

    /usr/bin/python3 testes/testar_caixa_preta_aba.py

O interpretador importa: o `python3` do Homebrew nao tem as dependencias do app
(dateutil, pytz, requests); o do sistema tem.
"""
import json
import os
import shutil
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = '/tmp/jobtest-caixa-preta'

# Banco novo a cada rodada: teste que depende de sobra da rodada anterior nao
# prova nada. Feito ANTES de importar o app, que ja abre o banco no import.
shutil.rmtree(BASE, ignore_errors=True)
os.makedirs(BASE, exist_ok=True)
os.environ['JOB_DATA_DIR'] = BASE
os.environ['JOB_MODO_TESTE'] = '1'
sys.path.insert(0, RAIZ)

import app as A  # noqa: E402

FALHAS = []
PASSOU = []


def checar(rotulo, condicao, detalhe=''):
    if condicao:
        PASSOU.append(rotulo)
        print('  ok   %s' % rotulo)
    else:
        FALHAS.append('%s %s' % (rotulo, detalhe))
        print('  FALHA %s %s' % (rotulo, detalhe))


def cliente():
    c = A.app.test_client()
    with c.session_transaction() as s:
        s['user_id'] = 1
        s['perfil'] = 'admin'
    return c


def percentil(valores, p):
    """Percentil por posicao, sem numpy. Lista precisa vir ordenada."""
    if not valores:
        return None
    i = int(round((p / 100.0) * (len(valores) - 1)))
    return valores[max(0, min(len(valores) - 1, i))]


def main():
    c = cliente()

    print('\n1. A morte da aba chega e fica gravada')
    r = c.post('/api/whatsapp/saude-aba', json={
        'evento': 'morte', 'usuario_id': 1, 'sessao': 'sabc123',
        'versao': '4.95.20', 'aberta_ms': 7 * 3600 * 1000,
        'heap_usado': 3_100_000_000, 'heap_teto': 4_000_000_000,
        'nos_dom': 128_400, 'loops': 19, 'copias_ponte': '2',
        'operacao': 'envio_imagem',
        'caches': {'transcricoes': 100, 'imagens_cotacao': 24, 'logos': 340},
        'oculta': 0, 'motivo': '',
    })
    checar('rota aceita a morte', r.status_code == 200 and (r.get_json() or {}).get('ok'),
           '-> %s %s' % (r.status_code, r.get_json()))

    conn = A.db()
    linha = conn.execute("SELECT * FROM wa_saude_aba WHERE sessao='sabc123'").fetchone()
    d = dict(linha) if linha is not None else {}
    checar('gravou o heap no instante da morte', d.get('heap_usado') == 3_100_000_000,
           '-> %s' % d.get('heap_usado'))
    checar('gravou o teto da aba', d.get('heap_teto') == 4_000_000_000)
    checar('gravou o que a aba estava fazendo', d.get('operacao') == 'envio_imagem')
    checar('gravou o tempo de aba aberta', d.get('aberta_ms') == 7 * 3600 * 1000)
    checar('gravou copias da ponte wa-js', str(d.get('copias_ponte')) == '2')
    caches = json.loads(d.get('caches') or '{}')
    checar('gravou o tamanho de cada cache', caches.get('logos') == 340,
           '-> %s' % caches)

    print('\n2. Evento desconhecido e recusado (nao polui a tabela)')
    r2 = c.post('/api/whatsapp/saude-aba', json={'evento': 'sei-la'})
    checar('recusa evento fora da lista', r2.status_code == 400,
           '-> %s' % r2.status_code)
    r2b = c.post('/api/whatsapp/saude-aba', json={})
    checar('recusa corpo sem evento', r2b.status_code == 400)

    print('\n3. Numero torto nao entra no banco nem derruba a rota')
    r3 = c.post('/api/whatsapp/saude-aba', json={
        'evento': 'retrato', 'sessao': 'slixo',
        'heap_usado': 'abc',            # nao e numero
        'nos_dom': -5,                  # negativo
        'aberta_ms': 99 ** 9,           # absurdo, tem que ser limitado
        'caches': 'nao sou um dicionario',
        'operacao': 'x' * 500,          # longo demais
    })
    checar('rota sobrevive a lixo', r3.status_code == 200, '-> %s' % r3.status_code)
    lx = conn.execute("SELECT * FROM wa_saude_aba WHERE sessao='slixo'").fetchone()
    lx = dict(lx) if lx is not None else {}
    checar('texto nao vira numero', lx.get('heap_usado') is None, '-> %s' % lx.get('heap_usado'))
    checar('negativo e descartado', lx.get('nos_dom') is None, '-> %s' % lx.get('nos_dom'))
    checar('tempo absurdo e limitado', (lx.get('aberta_ms') or 0) <= 7 * 24 * 3600 * 1000,
           '-> %s' % lx.get('aberta_ms'))
    checar('caches invalido vira nulo', lx.get('caches') is None)
    checar('operacao e truncada', len(lx.get('operacao') or '') <= 40,
           '-> %s' % len(lx.get('operacao') or ''))

    print('\n4. Mediana e p95 do heap na hora da morte')
    for i, heap in enumerate([1_900_000_000, 2_400_000_000, 3_600_000_000, 3_900_000_000]):
        c.post('/api/whatsapp/saude-aba', json={
            'evento': 'morte', 'usuario_id': 1, 'sessao': 'sm%d' % i,
            'heap_usado': heap, 'heap_teto': 4_000_000_000, 'aberta_ms': 3600_000,
        })
    vals = [x[0] for x in conn.execute(
        """SELECT heap_usado FROM wa_saude_aba
           WHERE evento='morte' AND heap_usado IS NOT NULL
           ORDER BY heap_usado""").fetchall()]
    checar('as 5 mortes estao no banco', len(vals) == 5, '-> %s' % len(vals))
    med, p95 = percentil(vals, 50), percentil(vals, 95)
    print('     mediana: %.2f GB · p95: %.2f GB' % (med / 1e9, p95 / 1e9))
    checar('mediana sai da consulta', med == 3_100_000_000, '-> %s' % med)
    checar('p95 sai da consulta', p95 == 3_900_000_000, '-> %s' % p95)

    print('\n5. Nada de conteudo de conversa nem dado de cliente na tabela')
    cols = [r[1] for r in conn.execute("PRAGMA table_info(wa_saude_aba)").fetchall()]
    proibidas = {'telefone', 'mensagem', 'texto', 'conversa', 'nome', 'chat_id', 'cpf'}
    vazou = proibidas.intersection(set(cols))
    checar('tabela so tem contador', not vazou, '-> vazou %s' % vazou)
    print('     colunas: %s' % ', '.join(cols))

    print('\n6. Regressao: a metrica que ja existia continua funcionando')
    rm = c.post('/api/whatsapp/metrica', json={
        'metricas': [{'operacao': 'envio_texto', 'ms': 1200, 'ok': True, 'usuario_id': 1}]})
    checar('/api/whatsapp/metrica intacta',
           rm.status_code == 200 and (rm.get_json() or {}).get('gravadas') == 1,
           '-> %s %s' % (rm.status_code, rm.get_json()))
    re_ = c.post('/api/whatsapp/erro', json={
        'usuario_id': 1, 'versao': '4.95.20', 'mensagem': 'erro de teste', 'url': 'x'})
    checar('/api/whatsapp/erro intacta',
           re_.status_code == 200 and (re_.get_json() or {}).get('ok'),
           '-> %s' % re_.status_code)

    A.close_db(conn)

    print('\n' + '=' * 62)
    print('%d verificacoes, %d falhas' % (len(PASSOU) + len(FALHAS), len(FALHAS)))
    if FALHAS:
        for f in FALHAS:
            print('  - %s' % f)
        return 1
    print('caixa-preta da aba: tudo certo')
    return 0


if __name__ == '__main__':
    sys.exit(main())
