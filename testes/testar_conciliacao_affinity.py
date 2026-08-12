"""Testes da IMPORTACAO CONTROLADA e da CONCILIACAO da Affinity (Fase 2).

O que estes testes protegem:

  1. IDEMPOTENCIA. Importar o mesmo lote duas vezes nao pode dobrar dinheiro.
     E o erro mais facil de cometer com 32 arquivos na mesa e o mais caro:
     ninguem confere um total que ja parece plausivel.
  2. NAO SOBRESCREVER. A importacao nao encosta em propostas, parcelas,
     recebimento, repasse_corretor nem lancamentos. Um PDF da Affinity nao manda
     em parcela paga.
  3. APURADO NAO E RECEBIDO. Nada vira 'entrada_confirmada' sozinho. So com
     identificador Asaas ou confirmacao humana com observacao.
  4. NOME NAO VIRA VINCULO. Casamento por razao social e sugestao na tela e
     recusa na gravacao.

Como rodar:

    JOB_MODO_TESTE=1 JOB_DATA_DIR=/tmp/jobtest python3 testes/testar_conciliacao_affinity.py
"""
import os
import sys
import hashlib
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('JOB_MODO_TESTE', '1')
os.environ.setdefault('JOB_DATA_DIR', tempfile.mkdtemp(prefix='jobtest-conc-'))

import app as A  # noqa: E402

PASTA_PDFS = os.path.expanduser('~/Downloads')
falhas, pulados = [], []


def checa(nome, cond, detalhe=''):
    if cond:
        print(f'  ok   {nome}')
    else:
        print(f'  FALHA {nome} {detalhe}')
        falhas.append(f'{nome} {detalhe}')


def pula(nome, motivo):
    print(f'  pula {nome} — {motivo}')
    pulados.append(nome)


def cliente(perfil='admin'):
    c = A.app.test_client()
    with c.session_transaction() as s:
        s['user_id'] = 1
        s['perfil'] = perfil
        s['nome'] = 'Guilherme Teste'
    return c


def limpar():
    conn = A.db()
    conn.execute("DELETE FROM affinity_conciliacao")
    conn.execute("DELETE FROM fin_evento")
    conn.execute("DELETE FROM propostas WHERE razao_social LIKE 'TESTE CONC%'")
    conn.commit()
    A.close_db(conn)


def semear_vendas():
    """Duas vendas: uma casa pelo numero do extrato de teste, a outra so por nome."""
    conn = A.db()
    ids = {}
    for num, rz in [('99911111', 'TESTE CONC CASA PELO NUMERO LTDA'),
                    ('', 'TESTE CONC SO PELO NOME LTDA')]:
        cur = conn.execute("""INSERT INTO propostas (usuario_id, consultor, numero_proposta,
                        razao_social, status, comissao_total_corretora, vigencia, modalidade,
                        tipo_contrato, acomodacao, fator_moderador, total_vidas, valor,
                        adm_operadora, criado_em)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                     (1, 'Guilherme', num or None, rz, 'Implantada', 1000.0, '01/07/2026', 'PME',
                      'Novo', 'Enfermaria', 'Sem', 1, 500.0, 'Amil', A._agora_sp()))
        ids[rz] = A._last_insert_id(cur)
    conn.commit()
    A.close_db(conn)
    return ids


def lote_falso(codigo='7000001', fechada=True, ajuste=False, debitos=-4.0):
    """Linha de lote no formato que _afy_importar_lote consome. Fixture propria:
    o teste de importacao nao pode depender de PDF na maquina de quem roda."""
    return {
        'arquivo': f'{codigo}.pdf', 'arquivo_hash': hashlib.sha256(codigo.encode()).hexdigest()[:32],
        'falhou': False, 'erro_leitura': '', 'codigo': codigo,
        'cadastro_cod': '217326', 'cadastro_nome': 'SERENUS VITAE LTDA',
        'geracao': '04/08/2026', 'previsao': '05/08/2026', 'data_pagamento': '05/08/2026',
        'nf_situacao': 'Pagamento efetuado em 05/08/2026 - TED.',
        'total_bruto': 1500.0, 'total_liquido': 1500.0, 'debitos': debitos,
        'total_impresso': 1500.0, 'leitura_fechada': fechada, 'conf_ancora': 'nota_fiscal',
        'conf_impresso': 1500.0, 'conf_lido': 1500.0 if fechada else 900.0,
        'conf_diferenca': 0.0 if fechada else -600.0,
        'liquido_esperado': round(1500.0 + debitos, 2),
        'tipo_txt': 'normal', 'tipos': ['normal'], 'transferido_para': '', 'ajuste': ajuste,
        'dup_lote': False, 'dup_banco': False, 'duplicado': False,
        'precisa_revisao': False, 'situacao': 'pronto', 'avisos': [],
        'sem_proposta': 0, 'ambiguos': 0, 'casados': 1, 'fracos': 1, 'com_parcela': 0,
        'divergentes': 0, 'n_itens': 2,
        'itens': [
            {'operadora': 'Amil', 'cliente': 'TESTE CONC CASA PELO NUMERO LTDA',
             'numero_proposta': '99911111', 'parcela': 1, 'percentual': 100.0,
             'bruto': 1000.0, 'liquido': 1000.0, 'tipo': 'normal',
             'proposta_id': None, 'criterio': 'numero_proposta', 'seguro': True,
             'ambiguo': False, 'candidatos': 1, 'parcela_id': None, 'razao_social': '',
             'consultor': 'Guilherme', 'job_esperado': 1000.0, 'divergencia': 0.0,
             'operadora_truncada': False},
            {'operadora': 'Amil', 'cliente': 'TESTE CONC SO PELO NOME LTDA',
             'numero_proposta': '', 'parcela': 1, 'percentual': 100.0,
             'bruto': 500.0, 'liquido': 500.0, 'tipo': 'normal',
             'proposta_id': None, 'criterio': 'razao_social', 'seguro': False,
             'ambiguo': False, 'candidatos': 1, 'parcela_id': None, 'razao_social': '',
             'consultor': 'Guilherme', 'job_esperado': 1000.0, 'divergencia': -500.0,
             'operadora_truncada': False},
        ],
    }


def foto_financeira():
    """Foto das tabelas que a importacao NAO pode tocar."""
    conn = A.db()
    foto = {}
    for t in ('propostas', 'parcelas', 'recebimento', 'repasse_corretor', 'lancamentos'):
        try:
            linhas = conn.execute(f'SELECT * FROM "{t}"').fetchall()
        except Exception:
            continue
        h = hashlib.sha256()
        for r in linhas:
            h.update(repr(tuple(r)).encode('utf-8', 'replace'))
        foto[t] = (len(linhas), h.hexdigest())
    A.close_db(conn)
    return foto


def teste_importacao_idempotente():
    print('\n[unit] importar duas vezes nao dobra dinheiro')
    limpar()
    ids = semear_vendas()
    pid_num = ids['TESTE CONC CASA PELO NUMERO LTDA']
    lote = lote_falso()
    lote['itens'][0]['proposta_id'] = pid_num

    conn = A.db()
    r1 = A._afy_importar_lote(conn, [lote], 1, 'Guilherme Teste')
    conn.commit()
    checa('primeira importacao grava 2 linhas', r1['itens'] == 2, r1)
    checa('uma vinculada pelo numero', r1['vinculados'] == 1, r1['vinculados'])
    checa('uma sem vinculo (nome nao vale)', r1['sem_vinculo'] == 1, r1['sem_vinculo'])
    checa('valor apurado desconta a tarifa', abs(r1['valor'] - 1496.0) < 0.01, r1['valor'])

    n1 = conn.execute("SELECT COUNT(*) c FROM affinity_conciliacao").fetchone()['c']
    v1 = conn.execute("SELECT COALESCE(SUM(valor*sinal),0) v FROM fin_evento").fetchone()['v']

    # Marca o codigo como ja importado, que e o que a previa faria na 2a rodada.
    lote2 = lote_falso()
    lote2['itens'][0]['proposta_id'] = pid_num
    r2 = A._afy_importar_lote(conn, [lote2], 1, 'Guilherme Teste')
    conn.commit()
    n2 = conn.execute("SELECT COUNT(*) c FROM affinity_conciliacao").fetchone()['c']
    v2 = conn.execute("SELECT COALESCE(SUM(valor*sinal),0) v FROM fin_evento").fetchone()['v']
    A.close_db(conn)
    checa('segunda importacao nao grava nada', n1 == n2, f'{n1} -> {n2}')
    checa('razao nao mudou de valor', abs(v1 - v2) < 0.001, f'{v1} -> {v2}')
    checa('a segunda rodada nao conta itens', r2['itens'] == 0, r2['itens'])


def teste_nao_toca_no_financeiro_existente():
    print('\n[unit] importar nao mexe em proposta, parcela nem lancamento')
    limpar()
    ids = semear_vendas()
    pid = ids['TESTE CONC CASA PELO NUMERO LTDA']
    conn = A.db()
    conn.execute("""INSERT INTO parcelas (proposta_id, numero, percentual, valor, status)
                    VALUES (?,?,?,?,?)""", (pid, 1, 100, 1000.0, 'Pago'))
    conn.commit()
    A.close_db(conn)
    antes = foto_financeira()
    lote = lote_falso(codigo='7000002')
    lote['itens'][0]['proposta_id'] = pid
    conn = A.db()
    A._afy_importar_lote(conn, [lote], 1, 'Guilherme Teste')
    conn.commit()
    A.close_db(conn)
    depois = foto_financeira()
    difs = [t for t in set(antes) | set(depois) if antes.get(t) != depois.get(t)]
    checa('nenhuma tabela financeira antiga mudou', not difs, difs)
    conn = A.db()
    st = conn.execute("SELECT status FROM parcelas WHERE proposta_id=?", (pid,)).fetchone()['status']
    A.close_db(conn)
    checa('parcela paga continua paga', st == 'Pago', st)


def teste_leitura_incompleta_nao_importa():
    print('\n[unit] leitura que nao fechou nao entra')
    limpar()
    conn = A.db()
    r = A._afy_importar_lote(conn, [lote_falso(codigo='7000003', fechada=False)], 1, 'Teste')
    conn.commit()
    n = conn.execute("SELECT COUNT(*) c FROM affinity_conciliacao").fetchone()['c']
    A.close_db(conn)
    checa('nada gravado', n == 0, n)
    checa('diz o motivo', any('não fechou' in m for _a, m in r['ignorados']), r['ignorados'])


def teste_ajuste_nao_vira_dinheiro():
    print('\n[unit] ajuste de efeito zero fica registrado mas nao soma')
    limpar()
    conn = A.db()
    lote = lote_falso(codigo='7000004', ajuste=True)
    A._afy_importar_lote(conn, [lote], 1, 'Teste')
    conn.commit()
    n = conn.execute("SELECT COUNT(*) c FROM affinity_conciliacao WHERE estado='ajuste_sem_efeito'").fetchone()['c']
    ev = conn.execute("SELECT COUNT(*) c FROM fin_evento").fetchone()['c']
    A.close_db(conn)
    checa('as linhas ficam registradas', n == 2, n)
    checa('nenhum evento de dinheiro', ev == 0, ev)


def teste_entrada_exige_prova():
    print('\n[unit] entrada confirmada exige Asaas ou pessoa assinando')
    limpar()
    ids = semear_vendas()
    pid = ids['TESTE CONC CASA PELO NUMERO LTDA']
    lote = lote_falso(codigo='7000005')
    lote['itens'][0]['proposta_id'] = pid
    conn = A.db()
    A._afy_importar_lote(conn, [lote], 1, 'Guilherme Teste')
    conn.commit()
    cid_ok = conn.execute("""SELECT id FROM affinity_conciliacao
                             WHERE codigo_comissao='7000005' AND proposta_id IS NOT NULL""").fetchone()['id']
    cid_sem = conn.execute("""SELECT id FROM affinity_conciliacao
                              WHERE codigo_comissao='7000005' AND proposta_id IS NULL""").fetchone()['id']
    estados = [r['estado'] for r in conn.execute(
        "SELECT estado FROM affinity_conciliacao WHERE codigo_comissao='7000005'").fetchall()]
    A.close_db(conn)
    checa('nada nasce como entrada confirmada', 'entrada_confirmada' not in estados, estados)

    c = cliente()
    r = c.post(f'/comissoes/conciliacao/{cid_ok}/confirmar-entrada', json={})
    checa('sem prova nenhuma, recusa', r.status_code == 400, r.status_code)
    r = c.post(f'/comissoes/conciliacao/{cid_ok}/confirmar-entrada',
               json={'confirmacao_humana': True, 'observacao': 'ok'})
    checa('confirmacao humana sem observacao decente, recusa', r.status_code == 400, r.status_code)
    r = c.post(f'/comissoes/conciliacao/{cid_sem}/confirmar-entrada',
               json={'asaas_id': 'pay_123456'})
    checa('item sem venda apontada nao confirma entrada', r.status_code == 400, r.status_code)

    r = c.post(f'/comissoes/conciliacao/{cid_ok}/confirmar-entrada',
               json={'asaas_id': 'pay_123456'})
    checa('com identificador Asaas, confirma', r.status_code == 200 and r.get_json().get('ok'),
          r.get_data(as_text=True)[:120])
    conn = A.db()
    linha = conn.execute("SELECT * FROM affinity_conciliacao WHERE id=?", (cid_ok,)).fetchone()
    ev = conn.execute("""SELECT COUNT(*) c FROM fin_evento
                         WHERE estado='entrada_confirmada'""").fetchone()['c']
    A.close_db(conn)
    checa('estado mudou', linha['estado'] == 'entrada_confirmada', linha['estado'])
    checa('guarda quem confirmou e quando', bool(linha['entrada_por']) and bool(linha['entrada_em']))
    checa('guarda a referencia do Asaas', linha['entrada_ref'] == 'pay_123456', linha['entrada_ref'])
    checa('razao ganhou um evento de entrada', ev == 1, ev)

    # Idempotencia da confirmacao: repetir nao duplica evento.
    r = c.post(f'/comissoes/conciliacao/{cid_ok}/confirmar-entrada', json={'asaas_id': 'pay_123456'})
    conn = A.db()
    ev2 = conn.execute("""SELECT COUNT(*) c FROM fin_evento
                          WHERE estado='entrada_confirmada'""").fetchone()['c']
    A.close_db(conn)
    checa('confirmar de novo nao duplica evento', ev2 == 1, ev2)


def teste_vinculo_manual_auditado():
    print('\n[unit] vinculo manual pede motivo e fica assinado')
    limpar()
    ids = semear_vendas()
    pid_nome = ids['TESTE CONC SO PELO NOME LTDA']
    lote = lote_falso(codigo='7000006')
    conn = A.db()
    A._afy_importar_lote(conn, [lote], 1, 'Guilherme Teste')
    conn.commit()
    cid = conn.execute("""SELECT id FROM affinity_conciliacao
                          WHERE codigo_comissao='7000006' AND estado='sem_vinculo'
                          ORDER BY id LIMIT 1""").fetchone()['id']
    A.close_db(conn)
    c = cliente()
    r = c.post(f'/comissoes/conciliacao/{cid}/vincular', json={'proposta_id': pid_nome})
    checa('sem motivo escrito, recusa', r.status_code == 400, r.status_code)
    r = c.post(f'/comissoes/conciliacao/{cid}/vincular',
               json={'proposta_id': pid_nome, 'observacao': 'Conferi o CNPJ no contrato assinado'})
    checa('com motivo, vincula', r.status_code == 200 and r.get_json().get('ok'),
          r.get_data(as_text=True)[:120])
    conn = A.db()
    linha = conn.execute("SELECT * FROM affinity_conciliacao WHERE id=?", (cid,)).fetchone()
    A.close_db(conn)
    checa('venda apontada', linha['proposta_id'] == pid_nome, linha['proposta_id'])
    checa('criterio marcado como manual', linha['vinculo_criterio'] == 'manual')
    checa('guarda quem, quando e por que',
          bool(linha['vinculo_por']) and bool(linha['vinculo_em'])
          and 'CNPJ' in (linha['vinculo_observacao'] or ''))
    # Vinculo nao se sobrescreve.
    r = c.post(f'/comissoes/conciliacao/{cid}/vincular',
               json={'proposta_id': pid_nome, 'observacao': 'tentando de novo'})
    checa('vinculo existente nao e sobrescrito', r.status_code == 400, r.status_code)


def teste_permissoes():
    print('\n[unit] so admin importa e concilia')
    consultor = A.app.test_client()
    with consultor.session_transaction() as s:
        s['user_id'] = 2
        s['perfil'] = 'consultor'
        s['nome'] = 'Consultor Teste'
    for rota in ('/comissoes/conciliacao', '/comissoes/extrato/lote/previsualizar'):
        r = consultor.get(rota, follow_redirects=False)
        checa(f'consultor nao abre {rota}', r.status_code in (302, 403), r.status_code)
    r = consultor.post('/comissoes/extrato/lote/importar', data={})
    checa('consultor nao importa', r.status_code in (302, 403), r.status_code)
    r = consultor.post('/comissoes/conciliacao/1/confirmar-entrada', json={'asaas_id': 'x'})
    checa('consultor nao confirma entrada', r.status_code in (302, 403), r.status_code)


def teste_tela_conciliacao():
    print('\n[unit] tela da conciliacao')
    c = cliente()
    r = c.get('/comissoes/conciliacao?estado=todos')
    corpo = r.get_data(as_text=True)
    checa('abre', r.status_code == 200, r.status_code)
    checa('diz que apurado nao e recebido', 'Apurado não é recebido' in corpo)
    faixas = [(0x1F300, 0x1FAFF), (0xFE0F, 0xFE0F), (0x2B00, 0x2BFF)]
    checa('sem emoji', not any(any(a <= ord(ch) <= b for a, b in faixas) for ch in corpo))
    r2 = c.get('/comissoes/conciliacao/buscar?q=TESTE CONC')
    checa('busca responde', r2.status_code == 200 and r2.get_json().get('ok'))
    r3 = c.get('/comissoes/conciliacao/buscar?q=ab')
    checa('busca curta nao varre o banco', r3.get_json().get('propostas') == [])


def teste_lote_real_importa_uma_vez():
    print('\n[int] lote real de 32: importa uma vez e so')
    codigos = ['1341896', '1345055', '1359414', '1374214']
    if not all(os.path.exists(os.path.join(PASTA_PDFS, c + '.pdf')) for c in codigos):
        return pula('lote real', 'PDFs nao encontrados')
    limpar()
    conn = A.db()
    arquivos = []
    for cod in codigos:
        with open(os.path.join(PASTA_PDFS, cod + '.pdf'), 'rb') as f:
            arquivos.append((cod + '.pdf', f.read()))
    linhas = A._ext_conferir_lote(conn, arquivos)
    r1 = A._afy_importar_lote(conn, linhas, 1, 'Guilherme Teste')
    conn.commit()
    # Reconferir (as linhas agora sabem que o codigo ja existe) e reimportar.
    linhas2 = A._ext_conferir_lote(conn, arquivos)
    r2 = A._afy_importar_lote(conn, linhas2, 1, 'Guilherme Teste')
    conn.commit()
    total = conn.execute("SELECT COUNT(*) c FROM affinity_conciliacao").fetchone()['c']
    soma = conn.execute("SELECT COALESCE(SUM(valor*sinal),0) v FROM fin_evento").fetchone()['v']
    aj = conn.execute("""SELECT COUNT(*) c FROM affinity_conciliacao
                         WHERE codigo_comissao='1345055'
                           AND estado='ajuste_sem_efeito'""").fetchone()['c']
    v1374 = conn.execute("""SELECT COALESCE(SUM(liquido),0) v FROM affinity_conciliacao
                            WHERE codigo_comissao='1374214'""").fetchone()['v']
    A.close_db(conn)
    checa('primeira passada importa', r1['itens'] > 0, r1['itens'])
    checa('segunda passada nao importa nada', r2['itens'] == 0, r2['itens'])
    checa('segunda passada reconhece os codigos ja importados',
          r2['ja_importados'] == len(codigos), r2['ja_importados'])
    checa('1345055 entrou como ajuste', aj == 1, aj)
    checa('1374214 com as duas linhas somando 2.648,85',
          abs(v1374 - 2648.85) < 0.01, v1374)
    esperado = round(1531.90 + 246.05 + 2644.85, 2)  # 1345055 e ajuste: nao entra
    checa('razao soma o liquido dos extratos que sao entrada',
          abs(soma - esperado) < 0.01, f'{soma} != {esperado} (total {total} linhas)')


if __name__ == '__main__':
    print('=' * 66)
    print('CONCILIACAO DA AFFINITY — Fase 2 (importacao controlada)')
    print('=' * 66)
    teste_importacao_idempotente()
    teste_nao_toca_no_financeiro_existente()
    teste_leitura_incompleta_nao_importa()
    teste_ajuste_nao_vira_dinheiro()
    teste_entrada_exige_prova()
    teste_vinculo_manual_auditado()
    teste_permissoes()
    teste_tela_conciliacao()
    teste_lote_real_importa_uma_vez()
    print('\n' + '=' * 66)
    if pulados:
        print(f'PULADOS ({len(pulados)}): ' + ', '.join(pulados))
    if falhas:
        print(f'FALHAS ({len(falhas)}):')
        for f in falhas:
            print('  - ' + f)
        sys.exit(1)
    print('Tudo passou.')
