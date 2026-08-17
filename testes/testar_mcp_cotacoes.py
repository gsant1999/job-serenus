"""Integração da API usada pelo MCP de cotações.

Roda somente em SQLite temporário e não inicia servidor nem acessa produção.

    JOB_MODO_TESTE=1 python3 testes/testar_mcp_cotacoes.py
"""

import os
import sys
import tempfile


sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ['JOB_MODO_TESTE'] = '1'
os.environ['JOB_DATA_DIR'] = tempfile.mkdtemp(prefix='jobtest-mcp-')
os.environ['SEED_DADOS_SERENUS'] = '0'

import app as A  # noqa: E402


FALHAS = []
CHAVE_COMUM = 'job_live_teste_mcp_comum_1234567890'
CHAVE_ADMIN = 'job_live_teste_mcp_admin_0987654321'


def checa(nome, cond, detalhe=''):
    if cond:
        print(f'  ok   {nome}')
    else:
        print(f'  FALHA {nome}: {detalhe}')
        FALHAS.append(f'{nome}: {detalhe}')


def json_ok(resposta):
    corpo = resposta.get_json(silent=True) or {}
    return resposta.status_code, corpo


def semear_credenciais():
    conn = A.db()
    admin = conn.execute("SELECT id FROM usuarios WHERE perfil='admin' ORDER BY id LIMIT 1").fetchone()
    cur = conn.execute(
        """INSERT INTO usuarios (nome, email, perfil, regime_base, ativo)
           VALUES (?,?,?,?,1)""",
        ('Consultor MCP', 'consultor.mcp@teste.local', 'consultor', 'sem_lead_sem_fixo'),
    )
    consultor_id = A._last_insert_id(cur)
    escopos = 'cotacao:ler,cotacao:escrever,crm:ler,crm:escrever'
    agora = A._agora_sp()
    for nome, chave, usuario_id in (
        ('MCP comum teste', CHAVE_COMUM, consultor_id),
        ('MCP admin teste', CHAVE_ADMIN, admin['id']),
    ):
        conn.execute(
            """INSERT INTO api_chave
               (nome, prefixo, hash, escopos, usuario_id, criado_por, criado_em)
               VALUES (?,?,?,?,?,?,?)""",
            (nome, chave[:15], A._api_hash(chave), escopos, usuario_id, admin['id'], agora),
        )
    conn.commit()
    A.close_db(conn)
    return consultor_id


def chamada(cliente, metodo, caminho, *, admin=False, json=None, query_string=None):
    chave = CHAVE_ADMIN if admin else CHAVE_COMUM
    return cliente.open(
        caminho,
        method=metodo,
        json=json,
        query_string=query_string,
        headers={'Authorization': f'Bearer {chave}'},
    )


def testar_fluxo():
    consultor_id = semear_credenciais()
    cliente = A.app.test_client()

    r = cliente.get('/api/v1/cotacao/planos')
    checa('credencial obrigatória', r.status_code in (401, 403), r.status_code)

    tabela = {
        'operadora': 'Operadora Teste MCP',
        'plano': 'Plano Integração',
        'modalidade': 'PME',
        'acomodacao': 'Enfermaria',
        'coparticipacao': 'Sem',
        'cidade': 'Campinas - SP',
        'vidas_min': 1,
        'vidas_max': 10,
        'mei': True,
        'precos': {'29-33': 321.45, '39-43': 456.78},
    }
    r = chamada(cliente, 'POST', '/api/v1/cotacao/tabelas', json=tabela)
    checa('consultor não administra tabela', r.status_code == 403, json_ok(r))
    r = chamada(cliente, 'POST', '/api/v1/cotacao/tabelas', admin=True, json=tabela)
    status, corpo = json_ok(r)
    checa('admin cria tabela', status == 201 and corpo.get('ok'), (status, corpo))
    tabela_id = (corpo.get('tabela') or {}).get('id')

    r = chamada(
        cliente,
        'GET',
        '/api/v1/cotacao/planos',
        query_string={'cidade': 'Campinas - SP', 'mei': '1', 'ids': str(tabela_id)},
    )
    status, corpo = json_ok(r)
    planos = corpo.get('planos') or []
    checa('lista plano com filtros MCP', status == 200 and len(planos) == 1, (status, corpo))
    checa('lista metadados completos', planos and planos[0].get('cidade') == 'Campinas - SP'
          and planos[0].get('mei') is True, planos)

    r = chamada(
        cliente,
        'POST',
        '/api/v1/cotacao/calcular',
        json={'idades': [30, 40], 'planos': [{'plano_id': tabela_id, 'recomendacao': '1a'}]},
    )
    status, corpo = json_ok(r)
    checa('calcula sem salvar', status == 200 and corpo.get('total_geral') == 778.23, (status, corpo))

    lead = {
        'nome': 'Cliente MCP',
        'telefone': '(19) 99999-1111',
        'email': 'cliente.mcp@teste.local',
        'origem': 'Site',
    }
    r = chamada(cliente, 'POST', '/api/v1/crm/leads', json=lead)
    status, corpo = json_ok(r)
    checa('cria lead vinculado à chave', status == 201 and corpo.get('ok'), (status, corpo))
    lead_id = (corpo.get('lead') or {}).get('id')
    checa('lead pertence ao consultor', (corpo.get('lead') or {}).get('responsavel_id') == consultor_id, corpo)
    r = chamada(cliente, 'POST', '/api/v1/crm/leads', json=lead)
    status, corpo = json_ok(r)
    checa('deduplica lead por telefone', status == 200 and corpo.get('ja_existia') is True, (status, corpo))
    r = chamada(cliente, 'GET', '/api/v1/crm/leads/buscar', query_string={'q': 'Cliente MCP'})
    status, corpo = json_ok(r)
    checa('busca lead do usuário', status == 200 and corpo.get('total') == 1, (status, corpo))

    salvar = {
        'lead_id': lead_id,
        'idades': [30, 40],
        'planos': [tabela_id],
        'recomendacoes': {str(tabela_id): '1a'},
        'cidade': 'Campinas - SP',
        'titulo': 'Cotação pelo MCP',
    }
    r = chamada(cliente, 'POST', '/api/v1/cotacao', json=salvar)
    status, corpo = json_ok(r)
    cotacao = corpo.get('cotacao') or {}
    checa('salva cotação local', status == 201 and cotacao.get('id'), (status, corpo))
    cotacao_id = cotacao.get('id')
    token_original = cotacao.get('token')
    checa('devolve link público', bool(cotacao.get('url_publica')), cotacao)

    r = chamada(cliente, 'GET', f'/api/v1/cotacao/{cotacao_id}')
    status, corpo = json_ok(r)
    checa('consulta cotação própria', status == 200 and corpo.get('cotacao', {}).get('id') == cotacao_id,
          (status, corpo))
    r = chamada(cliente, 'GET', '/api/v1/cotacao/salvas', query_string={'lead_id': lead_id})
    status, corpo = json_ok(r)
    checa('lista histórico próprio', status == 200 and corpo.get('total') == 1, (status, corpo))
    r = chamada(cliente, 'GET', f'/api/v1/cotacao/{cotacao_id}/imagem')
    checa('imagem ausente tem erro acionável', r.status_code == 404, json_ok(r))

    r = chamada(cliente, 'POST', f'/api/v1/cotacao/{cotacao_id}/nova-versao', json={})
    status, corpo = json_ok(r)
    nova = corpo.get('cotacao') or {}
    nova_id = nova.get('id')
    checa('nova versão cria outro registro', status == 201 and nova_id != cotacao_id, (status, corpo))
    checa('nova versão troca token', nova.get('token') and nova.get('token') != token_original, nova)

    r = chamada(
        cliente,
        'POST',
        f'/api/v1/cotacao/{cotacao_id}/agravo',
        admin=True,
        json={'versao': 0, 'ajustes': {'0': {'29-33': 400.0}}},
    )
    status, corpo = json_ok(r)
    checa('agravo altera só a cotação', status == 200 and corpo.get('versao') == 1, (status, corpo))
    r = chamada(
        cliente,
        'POST',
        f'/api/v1/cotacao/{cotacao_id}/agravo',
        admin=True,
        json={'versao': 0, 'ajustes': {'0': {'29-33': 410.0}}},
    )
    checa('agravo rejeita versão antiga', r.status_code == 409, json_ok(r))
    r = chamada(cliente, 'GET', f'/api/v1/cotacao/tabelas/{tabela_id}')
    _, corpo_tabela = json_ok(r)
    checa('agravo não altera tabela-base', corpo_tabela.get('tabela', {}).get('precos', {}).get('29-33') == 321.45,
          corpo_tabela)

    envios = []

    def email_falso(destino, assunto, corpo_email, remetente_nome=None):
        envios.append((destino, assunto, corpo_email, remetente_nome))

    A._enviar_email = email_falso
    r = chamada(cliente, 'POST', f'/api/v1/cotacao/{cotacao_id}/enviar-email', json={})
    status, corpo = json_ok(r)
    checa('envia e-mail pelo endereço do lead', status == 200 and len(envios) == 1, (status, corpo))

    vivo = {
        'cidade': 'Campinas - SP',
        'modalidade': 2,
        'vidas': [{'faixa': '29-33', 'quantidade': 1}],
        'planos': [{
            'key': '1-2-3-',
            'operadora': {'id': 1, 'nome': 'Operadora Ao Vivo'},
            'produto': {'id': 2, 'nome': 'Produto Ao Vivo'},
            'plano': {'id': 3, 'nome': 'Plano Ao Vivo', 'acomodacao': 0},
            'tabela': {'id': 4, 'nome': 'Tabela Ao Vivo', 'coparticipacao': False},
            'total': 500.0,
            'faixas': [{'faixa': '29-33', 'quantidade': 1, 'unitario': 500.0}],
        }],
    }
    r = chamada(
        cliente,
        'POST',
        '/api/v1/cotacao/ao-vivo/salvar',
        json={'lead_id': lead_id, 'resultado': vivo},
    )
    status, corpo = json_ok(r)
    checa('salva resultado ao vivo', status == 201 and corpo.get('cotacao', {}).get('id'), (status, corpo))

    r = chamada(
        cliente,
        'POST',
        '/api/whatsapp/cotacao/fila',
        json={'pedido': {'type': 'cotar_aqui', 'pedido': {'cidade': 'Campinas - SP'}}},
    )
    status, corpo = json_ok(r)
    checa('fila ao vivo informa trabalhador ausente', status == 200 and corpo.get('motivo') == 'sem_trabalhador',
          (status, corpo))

    r = chamada(
        cliente,
        'PUT',
        f'/api/v1/cotacao/tabelas/{tabela_id}',
        admin=True,
        json={'plano': 'Plano Integração Atualizado', 'precos': {'29-33': 333.33}},
    )
    status, corpo = json_ok(r)
    checa('admin atualiza tabela parcialmente', status == 200 and
          corpo.get('tabela', {}).get('plano') == 'Plano Integração Atualizado', (status, corpo))

    lote = {
        'operadora': 'Operadora Lote MCP',
        'tabelas': [{
            'operadora': 'Será substituída',
            'plano': 'Plano Lote',
            'precos': {'29-33': 250.0},
        }],
    }
    r = chamada(cliente, 'POST', '/api/v1/cotacao/tabelas/importar', admin=True, json=lote)
    status, corpo = json_ok(r)
    checa('admin importa lote', status == 200 and corpo.get('criadas') == 1, (status, corpo))
    lote_id = (corpo.get('ids') or [None])[0]
    lote['tabelas'][0]['precos']['29-33'] = 255.0
    r = chamada(cliente, 'POST', '/api/v1/cotacao/tabelas/importar', admin=True, json=lote)
    status, corpo = json_ok(r)
    checa('reimportação atualiza sem duplicar', status == 200 and corpo.get('atualizadas') == 1
          and corpo.get('ids') == [lote_id], (status, corpo))

    r = chamada(
        cliente,
        'POST',
        f'/api/v1/cotacao/tabelas/{lote_id}/excluir',
        admin=True,
        json={'confirmacao': 'errada'},
    )
    checa('exclusão de tabela exige frase exata', r.status_code == 400, json_ok(r))
    r = chamada(
        cliente,
        'POST',
        f'/api/v1/cotacao/tabelas/{lote_id}/excluir',
        admin=True,
        json={'confirmacao': f'EXCLUIR TABELA {lote_id}'},
    )
    checa('admin exclui uma tabela', r.status_code == 200, json_ok(r))

    r = chamada(
        cliente,
        'POST',
        f'/api/v1/cotacao/{nova_id}/excluir',
        admin=True,
        json={'confirmacao': 'errada'},
    )
    checa('exclusão de cotação exige frase exata', r.status_code == 400, json_ok(r))
    r = chamada(
        cliente,
        'POST',
        f'/api/v1/cotacao/{nova_id}/excluir',
        admin=True,
        json={'confirmacao': f'EXCLUIR COTACAO {nova_id}'},
    )
    checa('admin exclui uma cotação', r.status_code == 200, json_ok(r))


if __name__ == '__main__':
    print('Integração da API do MCP de cotações')
    testar_fluxo()
    if FALHAS:
        print(f'\nFalhas: {len(FALHAS)}')
        for falha in FALHAS:
            print('  - ' + falha)
        raise SystemExit(1)
    print('\nTudo passou.')
