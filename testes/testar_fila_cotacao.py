"""Regressões do contrato da fila de cotação da extensão.

Roda em SQLite temporário, sem servidor e sem acessar produção.

    python3 testes/testar_fila_cotacao.py
"""

import hashlib
import os
import sys
import tempfile


sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ['JOB_MODO_TESTE'] = '1'
os.environ['JOB_DATA_DIR'] = tempfile.mkdtemp(prefix='jobtest-fila-cotacao-')
os.environ['SEED_DADOS_SERENUS'] = '0'

import app as A  # noqa: E402


FALHAS = []


def checa(nome, cond, detalhe=''):
    if cond:
        print(f'  ok   {nome}')
    else:
        print(f'  FALHA {nome}: {detalhe}')
        FALHAS.append(f'{nome}: {detalhe}')


def semear_aparelho(conn, nome, email, apelido):
    cur = conn.execute(
        """INSERT INTO usuarios (nome, email, perfil, regime_base, ativo)
           VALUES (?,?,?,?,1)""",
        (nome, email, 'consultor', 'sem_lead_sem_fixo'),
    )
    uid = A._last_insert_id(cur)
    segredo = f'segredo-{apelido}'
    cur = conn.execute(
        """INSERT INTO extensao_sessao
           (usuario_id, token_hash, apelido, criado_em, ultimo_uso)
           VALUES (?,?,?,?,?)""",
        (uid, hashlib.sha256(segredo.encode()).hexdigest(), apelido,
         A._agora_sp(), A._agora_sp()),
    )
    sid = A._last_insert_id(cur)
    return uid, sid, f'{sid}.{segredo}'


def chamar(cliente, token, metodo, caminho, json=None):
    return cliente.open(
        caminho,
        method=metodo,
        json=json,
        headers={'Authorization': f'Bearer {token}'},
    )


def corpo(resposta):
    return resposta.status_code, resposta.get_json(silent=True) or {}


def testar_fluxo():
    conn = A.db()
    uid_a, sid_a, token_a = semear_aparelho(
        conn, 'Consultor Fila A', 'fila.a@teste.local', 'Aparelho A')
    uid_b, sid_b, token_b = semear_aparelho(
        conn, 'Consultor Fila B', 'fila.b@teste.local', 'Aparelho B')
    conn.execute(
        "UPDATE extensao_sessao SET trabalhador_cotacao=1 WHERE id=?", (sid_a,))
    conn.commit()
    A.close_db(conn)

    cliente = A.app.test_client()

    r = chamar(cliente, token_a, 'POST', '/api/whatsapp/trabalhador/vivo',
                {'painel_logado': False})
    checa('Painel fechado recusa sinal', corpo(r) == (200, {'ok': False, 'motivo': 'painel_fechado'}), corpo(r))
    conn = A.db()
    sinal = conn.execute(
        "SELECT trabalhador_sinal FROM extensao_sessao WHERE id=?", (sid_a,)).fetchone()
    checa('Painel fechado apaga sinal anterior', sinal['trabalhador_sinal'] is None, dict(sinal))
    A.close_db(conn)

    pedido = {'type': 'cotador_passo', 'pedido': {'cidade': 'Campinas - SP'}}
    r = chamar(cliente, token_b, 'POST', '/api/whatsapp/cotacao/fila',
                {'pedido': pedido, 'chave_pedido': 'pedido-sem-worker'})
    checa('Fila recusa máquina sem Painel', corpo(r)[1].get('motivo') == 'sem_trabalhador', corpo(r))

    r = chamar(cliente, token_a, 'POST', '/api/whatsapp/trabalhador/vivo',
                {'painel_logado': True})
    checa('Painel aberto grava sinal', corpo(r) == (200, {'ok': True}), corpo(r))

    dados = {'pedido': pedido, 'chave_pedido': 'pedido-idempotente-1'}
    r1 = chamar(cliente, token_b, 'POST', '/api/whatsapp/cotacao/fila', dados)
    r2 = chamar(cliente, token_b, 'POST', '/api/whatsapp/cotacao/fila', dados)
    id1 = corpo(r1)[1].get('id')
    checa('Repetir criação devolve o mesmo pedido', id1 and corpo(r2)[1].get('id') == id1,
          (corpo(r1), corpo(r2)))
    conn = A.db()
    qtd = conn.execute(
        "SELECT COUNT(*) AS c FROM cotacao_fila WHERE chave_pedido='pedido-idempotente-1'"
    ).fetchone()['c']
    checa('Repetir criação não duplica a fila', qtd == 1, qtd)
    A.close_db(conn)

    r = chamar(cliente, token_a, 'GET', '/api/whatsapp/cotacao/fila/proximo')
    checa('Worker toma o pedido mais antigo', corpo(r)[1].get('id') == id1, corpo(r))

    conn = A.db()
    conn.execute("""
        UPDATE extensao_sessao
        SET trabalhador_cotacao=1, trabalhador_sinal=? WHERE id=?
    """, (A._agora_sp(), sid_b))
    conn.commit()
    A.close_db(conn)
    r = chamar(cliente, token_b, 'POST', f'/api/whatsapp/cotacao/fila/{id1}/etapa',
                {'etapa': 'Tentativa alheia', 'fracao': 2})
    checa('Outro aparelho não altera progresso', r.status_code == 409, corpo(r))

    r = chamar(cliente, token_b, 'POST', f'/api/whatsapp/cotacao/fila/{id1}/cancelar', {})
    checa('Dono cancela pedido em execução', corpo(r)[1].get('ok') is True, corpo(r))
    r = chamar(cliente, token_a, 'POST', f'/api/whatsapp/cotacao/fila/{id1}/pronto',
                {'resultado': {'ok': True, 'preco': 123.45}})
    checa('Resultado atrasado não ressuscita cancelado', r.status_code == 409, corpo(r))
    conn = A.db()
    estado = conn.execute("SELECT estado FROM cotacao_fila WHERE id=?", (id1,)).fetchone()['estado']
    checa('Cancelado permanece cancelado', estado == 'cancelado', estado)

    # Monta um resultado pertencente a A e confirma que B só enxerga o estado.
    cur = conn.execute("""
        INSERT INTO cotacao_fila
          (usuario_id, sessao_id, pedido_json, estado, resultado_json, erro,
           criado_em, terminado_em, chave_pedido)
        VALUES (?, ?, '{}', 'pronto', '{"cliente":"dado privado"}',
                'detalhe privado', ?, ?, 'resultado-privado')
    """, (uid_a, sid_a, A._agora_sp(), A._agora_sp()))
    privado_id = A._last_insert_id(cur)
    conn.commit()
    A.close_db(conn)
    r = chamar(cliente, token_b, 'GET', f'/api/whatsapp/cotacao/fila/{privado_id}')
    j = corpo(r)[1]
    checa('Terceiro não recebe resultado', j.get('estado') == 'pronto' and j.get('resultado') is None, j)
    checa('Terceiro não recebe detalhe de erro', j.get('erro') is None, j)

    # A troca administrativa só fica viva depois da primeira batida real.
    admin = A.db().execute(
        "SELECT id FROM usuarios WHERE perfil='admin' ORDER BY id LIMIT 1"
    ).fetchone()
    with cliente.session_transaction() as sessao:
        sessao['user_id'] = admin['id']
        sessao['perfil'] = 'admin'
    r = cliente.post(f'/admin/extensao/sessao/{sid_b}/trabalhador', json={'ligado': True})
    checa('Admin troca o worker', corpo(r)[1].get('ok') is True, corpo(r))
    conn = A.db()
    linhas = conn.execute("""
        SELECT id, trabalhador_cotacao, trabalhador_sinal
        FROM extensao_sessao WHERE id IN (?, ?) ORDER BY id
    """, (sid_a, sid_b)).fetchall()
    checa('Troca zera todos os sinais antigos',
          sum(int(x['trabalhador_cotacao'] or 0) for x in linhas) == 1 and
          all(x['trabalhador_sinal'] is None for x in linhas), [dict(x) for x in linhas])
    A.close_db(conn)

    r = cliente.post(f'/admin/extensao/sessoes/{uid_b}/{sid_b}/revogar')
    checa('Admin desconecta o worker', r.status_code == 302, r.status_code)
    conn = A.db()
    desligado = conn.execute("""
        SELECT revogado_em, trabalhador_cotacao, trabalhador_sinal
        FROM extensao_sessao WHERE id=?
    """, (sid_b,)).fetchone()
    checa('Desconectar remove função e sinal imediatamente',
          desligado['revogado_em'] is not None and
          not desligado['trabalhador_cotacao'] and desligado['trabalhador_sinal'] is None,
          dict(desligado))
    A.close_db(conn)


if __name__ == '__main__':
    print('Fila de cotação da extensão')
    testar_fluxo()
    if FALHAS:
        print(f'\nFalhas: {len(FALHAS)}')
        for falha in FALHAS:
            print('  - ' + falha)
        raise SystemExit(1)
    print('\nTudo passou.')
