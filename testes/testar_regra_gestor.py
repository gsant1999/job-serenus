"""Testes do MOTOR DE REGRA DO GESTOR/ADMIN VENDEDOR (Fase 3).

O que estes testes protegem:

  1. AUSENCIA NAO E ZERO. Retencao sem aliquota informada bloqueia; ela nao vira
     0% em silencio. O JOB nao inventa imposto.
  2. SNAPSHOT IMUTAVEL. Mudar a regra hoje nao pode mudar o que foi combinado
     numa venda de ontem.
  3. BLOQUEIO REAL. Sem regra completa, liberar e pagar PIX sao recusados — nao
     e so um aviso amarelo na tela que todo mundo aprende a ignorar.
  4. SUGESTAO NAO E APLICACAO. 100% na primeira fracao e sugestao; sem alguem
     confirmar, a regra continua incompleta.
  5. RASCUNHO PASSA. Regra incompleta nao impede CADASTRAR a venda — so impede
     o dinheiro andar.

Como rodar:

    JOB_MODO_TESTE=1 JOB_DATA_DIR=/tmp/jobtest python3 testes/testar_regra_gestor.py
"""
import os
import sys
import json
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('JOB_MODO_TESTE', '1')
os.environ.setdefault('JOB_DATA_DIR', tempfile.mkdtemp(prefix='jobtest-regra-'))

import app as A  # noqa: E402

falhas = []


def checa(nome, cond, detalhe=''):
    if cond:
        print(f'  ok   {nome}')
    else:
        print(f'  FALHA {nome} {detalhe}')
        falhas.append(f'{nome} {detalhe}')


def cliente(perfil='admin', uid=1):
    c = A.app.test_client()
    with c.session_transaction() as s:
        s['user_id'] = uid
        s['perfil'] = perfil
        s['nome'] = 'Gestor Teste'
    return c


def limpar():
    conn = A.db()
    for t in ('proposta_regra_snapshot', 'gestor_retencao', 'gestor_regra'):
        conn.execute(f"DELETE FROM {t}")
    conn.execute("DELETE FROM parcelas WHERE proposta_id IN "
                 "(SELECT id FROM propostas WHERE razao_social LIKE 'TESTE REGRA%')")
    conn.execute("DELETE FROM propostas WHERE razao_social LIKE 'TESTE REGRA%'")
    conn.execute("DELETE FROM usuarios WHERE email LIKE 'teste.regra%'")
    conn.commit()
    A.close_db(conn)


def criar_gestor(conn, email='teste.regra.gestor@x.com', perfil='admin'):
    cur = conn.execute("""INSERT INTO usuarios (nome, email, perfil, regime_base, ativo)
                          VALUES (?,?,?,'',1)""", ('Gestor Teste', email, perfil))
    return A._last_insert_id(cur)


def criar_venda(conn, usuario_id, operadora='Amil', razao='TESTE REGRA VENDA LTDA'):
    cur = conn.execute("""INSERT INTO propostas (usuario_id, consultor, numero_proposta,
                    razao_social, status, comissao_total_corretora, vigencia, modalidade,
                    tipo_contrato, acomodacao, fator_moderador, total_vidas, valor,
                    adm_operadora, criado_em)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                 (usuario_id, 'Gestor Teste', None, razao, 'Implantada', 1000.0, '2026-07-01',
                  'PME', 'Novo', 'Enfermaria', 'Sem', 1, 1000.0, operadora, A._agora_sp()))
    return A._last_insert_id(cur)


def cadastrar_regra(conn, operadora='Amil', plano='PME', confirmada=1,
                    fracoes=None, gestor=None):
    fracoes = fracoes if fracoes is not None else [
        {'ordem': 1, 'percentual': 30.0, 'evento': '1a mensalidade', 'mes': 1},
        {'ordem': 2, 'percentual': 40.0, 'evento': '2a mensalidade', 'mes': 2},
        {'ordem': 3, 'percentual': 30.0, 'evento': '3a mensalidade', 'mes': 3},
    ]
    gestor = gestor if gestor is not None else [
        {'ordem': 1, 'percentual_gestor': 100.0},
        {'ordem': 2, 'percentual_gestor': 0.0},
        {'ordem': 3, 'percentual_gestor': 0.0},
    ]
    cur = conn.execute("""INSERT INTO gestor_regra
        (operadora, obs, plano, fracoes_json, gestor_json, confirmada, ativo, criado_por, criado_em)
        VALUES (?,'',?,?,?,?,1,?,?)""",
        (operadora, plano, json.dumps(fracoes), json.dumps(gestor), confirmada,
         'teste', A._agora_sp()))
    return A._last_insert_id(cur)


def teste_regra_incompleta_bloqueia():
    print('\n[unit] o que conta como regra incompleta')
    checa('sem regra nenhuma bloqueia', len(A._gestor_regra_faltas(None, [])) == 1)
    regra = {'fracoes_json': '[]', 'gestor_json': '[]', 'confirmada': 1}
    falta = A._gestor_regra_faltas(regra, [])
    checa('sem regua de recebimento bloqueia',
          any('régua de recebimento' in f for f in falta), falta)
    regra = {'fracoes_json': json.dumps([{'ordem': 1, 'percentual': 100.0, 'evento': '1a'}]),
             'gestor_json': '[]', 'confirmada': 1}
    falta = A._gestor_regra_faltas(regra, [])
    checa('sem regua do gestor bloqueia', any('régua do gestor' in f for f in falta), falta)
    regra = {'fracoes_json': json.dumps([{'ordem': 1, 'percentual': None, 'evento': '1a'}]),
             'gestor_json': json.dumps([{'ordem': 1, 'percentual_gestor': 100.0}]),
             'confirmada': 1}
    falta = A._gestor_regra_faltas(regra, [])
    checa('fracao sem percentual bloqueia', any('sem percentual' in f for f in falta), falta)


def teste_retencao_sem_aliquota():
    print('\n[unit] aliquota nao informada nao vira zero')
    base = {'fracoes_json': json.dumps([{'ordem': 1, 'percentual': 100.0, 'evento': '1a'}]),
            'gestor_json': json.dumps([{'ordem': 1, 'percentual_gestor': 100.0}]),
            'confirmada': 1}
    ret_sem = [{'tipo': 'imposto', 'nome': 'ISS', 'percentual': None,
                'base_calculo': 'bruto_gestor', 'responsavel': 'gestor'}]
    falta = A._gestor_regra_faltas(base, ret_sem)
    checa('retencao sem aliquota bloqueia',
          any('sem alíquota informada' in f for f in falta), falta)
    checa('a mensagem diz que o JOB nao inventa',
          any('não inventa' in f for f in falta), falta)
    ret_zero = [{'tipo': 'imposto', 'nome': 'ISS', 'percentual': 0.0,
                 'base_calculo': 'bruto_gestor', 'responsavel': 'gestor'}]
    checa('aliquota ZERO e uma decisao valida, nao bloqueia',
          A._gestor_regra_faltas(base, ret_zero) == [], A._gestor_regra_faltas(base, ret_zero))
    ret_sem_base = [{'tipo': 'imposto', 'nome': 'ISS', 'percentual': 5.0,
                     'base_calculo': '', 'responsavel': 'gestor'}]
    checa('retencao sem base de calculo bloqueia',
          any('base de cálculo' in f for f in A._gestor_regra_faltas(base, ret_sem_base)))
    ret_sem_resp = [{'tipo': 'imposto', 'nome': 'ISS', 'percentual': 5.0,
                     'base_calculo': 'bruto_gestor', 'responsavel': ''}]
    checa('retencao sem responsavel bloqueia',
          any('responsável' in f for f in A._gestor_regra_faltas(base, ret_sem_resp)))


def teste_sugestao_nao_e_confirmacao():
    print('\n[unit] sugestao 100/0 nao vale sem confirmacao')
    regra = {'fracoes_json': json.dumps([{'ordem': 1, 'percentual': 100.0, 'evento': '1a'}]),
             'gestor_json': json.dumps([{'ordem': 1, 'percentual_gestor': 100.0}]),
             'confirmada': 0}
    falta = A._gestor_regra_faltas(regra, [])
    checa('regra nao confirmada continua incompleta',
          any('ninguém confirmou' in f for f in falta), falta)
    regra['confirmada'] = 1
    checa('confirmada e completa', A._gestor_regra_faltas(regra, []) == [])


def teste_conta_do_gestor():
    print('\n[unit] a conta: recebido, bruto, retencao, liquido e saldo')
    snap = {
        'completa': 1,
        'fracoes_json': json.dumps([
            {'ordem': 1, 'percentual': 30.0, 'evento': '1a mensalidade', 'mes': 1},
            {'ordem': 2, 'percentual': 70.0, 'evento': '2a mensalidade', 'mes': 2}]),
        'gestor_json': json.dumps([
            {'ordem': 1, 'percentual_gestor': 100.0},
            {'ordem': 2, 'percentual_gestor': 0.0}]),
        'retencoes_json': json.dumps([
            {'tipo': 'imposto', 'nome': 'ISS', 'percentual': 10.0,
             'base_calculo': 'bruto_gestor', 'responsavel': 'gestor'}]),
    }
    r = A._gestor_calcular(snap, 1000.0)
    checa('duas fracoes', len(r['fracoes']) == 2, len(r['fracoes']))
    f1, f2 = r['fracoes']
    checa('fracao 1 recebe 300', abs(f1['recebido'] - 300.0) < 0.01, f1['recebido'])
    checa('bruto do gestor na 1a e 300 (100% dela)',
          abs(f1['bruto_gestor'] - 300.0) < 0.01, f1['bruto_gestor'])
    checa('retencao de 10% sobre o bruto do gestor = 30',
          abs(f1['retencao_gestor'] - 30.0) < 0.01, f1['retencao_gestor'])
    checa('liquido pro PIX do gestor = 270',
          abs(f1['liquido_gestor'] - 270.0) < 0.01, f1['liquido_gestor'])
    checa('saldo Serenus na 1a fracao = 0 (tudo do gestor, imposto e dele)',
          abs(f1['saldo_serenus'] - 0.0) < 0.01, f1['saldo_serenus'])
    checa('2a fracao inteira e da Serenus',
          abs(f2['saldo_serenus'] - 700.0) < 0.01, f2['saldo_serenus'])
    checa('gestor nao leva nada na 2a', abs(f2['bruto_gestor']) < 0.01, f2['bruto_gestor'])
    checa('total liquido do gestor = 270',
          abs(r['total_liquido_gestor'] - 270.0) < 0.01, r['total_liquido_gestor'])
    checa('total saldo Serenus = 700',
          abs(r['total_saldo_serenus'] - 700.0) < 0.01, r['total_saldo_serenus'])
    # Regra incompleta: nao calcula nada. Numero com regra pela metade vira decisao.
    snap2 = dict(snap); snap2['completa'] = 0
    checa('snapshot incompleto nao calcula', A._gestor_calcular(snap2, 1000.0)['fracoes'] == [])


def teste_snapshot_imutavel():
    print('\n[unit] snapshot congela a regra na venda')
    limpar()
    conn = A.db()
    uid = criar_gestor(conn)
    cadastrar_regra(conn)
    pid = criar_venda(conn, uid)
    conn.commit()
    A._gestor_congelar_snapshot(conn, pid, 'Amil', 'PME', uid, 'Gestor Teste')
    conn.commit()
    snap1 = A._gestor_snapshot(conn, pid)
    checa('snapshot criado e completo', snap1 and snap1['completa'] == 1,
          snap1 and snap1.get('falta_json'))
    antes = snap1['gestor_json']

    # Regra muda depois: 50/50 em vez de 100/0.
    conn.execute("""UPDATE gestor_regra SET gestor_json=? WHERE operadora='Amil' AND plano='PME'""",
                 (json.dumps([{'ordem': 1, 'percentual_gestor': 50.0},
                              {'ordem': 2, 'percentual_gestor': 50.0},
                              {'ordem': 3, 'percentual_gestor': 0.0}]),))
    conn.commit()
    criou = A._gestor_congelar_snapshot(conn, pid, 'Amil', 'PME', uid, 'Outro')
    conn.commit()
    snap2 = A._gestor_snapshot(conn, pid)
    A.close_db(conn)
    checa('nao recongela snapshot existente', criou is False)
    checa('a venda antiga mantem a regra antiga', snap2['gestor_json'] == antes,
          f'{antes} -> {snap2["gestor_json"]}')

    # A venda nova pega a regra nova.
    conn = A.db()
    pid2 = criar_venda(conn, uid, razao='TESTE REGRA VENDA NOVA LTDA')
    conn.commit()
    A._gestor_congelar_snapshot(conn, pid2, 'Amil', 'PME', uid, 'Gestor Teste')
    conn.commit()
    snap3 = A._gestor_snapshot(conn, pid2)
    A.close_db(conn)
    checa('venda nova pega a regra nova', '50.0' in snap3['gestor_json'], snap3['gestor_json'])


def teste_bloqueio_liberacao_e_pix():
    print('\n[unit] sem regra completa: nao libera e nao paga PIX')
    limpar()
    conn = A.db()
    uid = criar_gestor(conn)
    pid = criar_venda(conn, uid, operadora='OperadoraSemRegra')
    conn.commit()
    A._gestor_congelar_snapshot(conn, pid, 'OperadoraSemRegra', 'PME', uid, 'Gestor Teste')
    cur = conn.execute("""INSERT INTO parcelas (proposta_id, numero, percentual, valor, status)
                          VALUES (?,?,?,?,?)""", (pid, 1, 100, 300.0, 'Recebido e não repassado'))
    parc_id = A._last_insert_id(cur)
    conn.commit()
    b = A._gestor_bloqueio(conn, pid)
    A.close_db(conn)
    checa('a venda de gestor sem regra bloqueia', b['bloqueia'] is True, b)
    checa('o bloqueio diz operadora e plano',
          b['operadora'] == 'OperadoraSemRegra' and b['plano'] == 'PME', b)
    checa('o bloqueio traz a acao direta', '/comissoes/regra-gestor?' in b['link'], b['link'])

    c = cliente()
    r = c.post(f'/parcela/{parc_id}/acao', data={'acao': 'liberar'})
    checa('liberar e recusado', r.status_code == 400, r.status_code)
    checa('a recusa explica o porque',
          'regra de comissão do gestor' in (r.get_json() or {}).get('msg', ''),
          r.get_data(as_text=True)[:150])
    r = c.post(f'/parcela/{parc_id}/status', data={'status': 'Liberado para o corretor'})
    checa('trocar status na mao tambem e recusado', r.status_code == 400, r.status_code)
    conn = A.db()
    st = conn.execute("SELECT status FROM parcelas WHERE id=?", (parc_id,)).fetchone()['status']
    A.close_db(conn)
    checa('a parcela nao andou', st == 'Recebido e não repassado', st)

    # PIX: forca o estado liberado no banco (como se tivesse sido liberado antes
    # da regra quebrar) e confere que o pagamento ainda assim e barrado.
    conn = A.db()
    conn.execute("UPDATE parcelas SET status='Liberado para o corretor' WHERE id=?", (parc_id,))
    conn.commit()
    ok, info = A._pagar_parcela_asaas_core(conn, parc_id, 'Gestor Teste')
    A.close_db(conn)
    checa('PIX barrado mesmo com a parcela liberada', ok is False, info)
    checa('o motivo do PIX barrado e a regra', 'regra de comissão do gestor' in str(info), info)


def teste_consultor_nao_e_bloqueado():
    print('\n[unit] venda de consultor nao passa pela regra do gestor')
    limpar()
    conn = A.db()
    cur = conn.execute("""INSERT INTO usuarios (nome, email, perfil, regime_base, ativo)
                          VALUES (?,?,?,?,1)""",
                       ('Consultor Teste', 'teste.regra.consultor@x.com', 'consultor',
                        'sem_lead_sem_fixo'))
    uid = A._last_insert_id(cur)
    pid = criar_venda(conn, uid, operadora='OperadoraSemRegra',
                      razao='TESTE REGRA CONSULTOR LTDA')
    conn.commit()
    b = A._gestor_bloqueio(conn, pid)
    A.close_db(conn)
    checa('venda de consultor nao bloqueia', b['bloqueia'] is False, b)
    checa('e nem e marcada como venda de gestor', b['eh_gestor'] is False, b)


def teste_rascunho_passa():
    print('\n[unit] regra incompleta nao impede cadastrar a venda')
    limpar()
    conn = A.db()
    uid = criar_gestor(conn)
    pid = criar_venda(conn, uid, operadora='OutraSemRegra', razao='TESTE REGRA RASCUNHO LTDA')
    conn.commit()
    criou = A._gestor_congelar_snapshot(conn, pid, 'OutraSemRegra', 'PME', uid, 'Gestor')
    conn.commit()
    snap = A._gestor_snapshot(conn, pid)
    existe = conn.execute("SELECT id FROM propostas WHERE id=?", (pid,)).fetchone()
    A.close_db(conn)
    checa('a venda foi cadastrada', existe is not None)
    checa('o snapshot foi criado mesmo incompleto', criou is True and snap is not None)
    checa('e ele registra que esta incompleto', snap['completa'] == 0, snap['completa'])
    checa('guardando o que falta, por escrito',
          len(json.loads(snap['falta_json'])) > 0, snap['falta_json'])


def teste_usuario_gestor_sem_regime_de_consultor():
    print('\n[unit] cadastro de gestor nao recebe regime de consultor')
    limpar()
    c = cliente()
    c.post('/usuario/novo', data={'nome': 'Gestor Novo Teste',
                                  'email': 'teste.regra.novo@x.com', 'perfil': 'admin',
                                  'regime_base': 'com_lead'})
    conn = A.db()
    u = conn.execute("SELECT perfil, regime_base FROM usuarios WHERE email=?",
                     ('teste.regra.novo@x.com',)).fetchone()
    A.close_db(conn)
    checa('usuario criado', u is not None)
    if u:
        checa('admin nao fica com regime de consultor',
              (u['regime_base'] or '') == '', repr(u['regime_base']))
    c.post('/usuario/novo', data={'nome': 'Consultor Novo Teste',
                                  'email': 'teste.regra.cons@x.com', 'perfil': 'consultor',
                                  'regime_base': 'com_lead'})
    conn = A.db()
    u2 = conn.execute("SELECT regime_base FROM usuarios WHERE email=?",
                      ('teste.regra.cons@x.com',)).fetchone()
    conn.execute("DELETE FROM usuarios WHERE email LIKE 'teste.regra%'")
    conn.commit()
    A.close_db(conn)
    checa('consultor continua com o regime escolhido',
          u2 and u2['regime_base'] == 'com_lead', u2 and u2['regime_base'])


def teste_legado_preservado():
    print('\n[unit] o legado gestor_vendedor continua legivel, sem recalculo')
    r = A.calc_comissao('Amil', 'gestor_vendedor', 0, 1000.0, 'PME', '')
    checa('o modelo legado ainda responde', r['modelo'] == 'gestor_vendedor', r['modelo'])
    checa('e continua entregando tudo numa parcela', r['num_parcelas'] == 1, r['num_parcelas'])
    checa('rotulo do legado preservado',
          A.MODELO_NOME.get('gestor_vendedor', '').startswith('Gestor Vendedor'),
          A.MODELO_NOME.get('gestor_vendedor'))


def teste_telas():
    print('\n[unit] telas da regra e dos alertas')
    c = cliente()
    r = c.get('/comissoes/regra-gestor')
    corpo = r.get_data(as_text=True)
    checa('tela da regra abre', r.status_code == 200, r.status_code)
    checa('diz que a regra e comercial, nao da pessoa',
          'A regra é comercial, não é da pessoa' in corpo)
    checa('separa as tres coisas',
          'régua de recebimento' in corpo and 'régua do gestor' in corpo and 'retenção' in corpo)
    checa('sugestao aparece como sugestao', 'Sugerir 100% na primeira' in corpo)
    faixas = [(0x1F300, 0x1FAFF), (0xFE0F, 0xFE0F), (0x2B00, 0x2BFF)]
    checa('sem emoji', not any(any(a <= ord(ch) <= b for a, b in faixas) for ch in corpo))
    for rota in ('/financeiro', '/fluxo-caixa'):
        rr = c.get(rota)
        checa(f'{rota} continua abrindo', rr.status_code == 200, rr.status_code)
    # A venda de gestor sem regra tem que aparecer na proposta.
    limpar()
    conn = A.db()
    uid = criar_gestor(conn)
    pid = criar_venda(conn, uid, operadora='SemRegraNaTela', razao='TESTE REGRA TELA LTDA')
    conn.commit()
    A._gestor_congelar_snapshot(conn, pid, 'SemRegraNaTela', 'PME', uid, 'Gestor')
    conn.commit()
    A.close_db(conn)
    rp = c.get(f'/proposta/{pid}')
    corpo = rp.get_data(as_text=True)
    checa('proposta abre', rp.status_code == 200, rp.status_code)
    checa('a proposta mostra o bloqueio',
          'a regra do gestor está incompleta' in corpo, corpo[:100] if rp.status_code != 200 else '')
    checa('com a operadora exata', 'SemRegraNaTela' in corpo)
    checa('e o link direto pra configuracao', '/comissoes/regra-gestor?' in corpo)
    rf = c.get('/fluxo-caixa')
    checa('o Fluxo de Caixa tambem avisa',
          'Regra de comissão do gestor incompleta' in rf.get_data(as_text=True))
    rfi = c.get('/financeiro')
    checa('o Financeiro tambem avisa',
          'Regra de comissão do gestor incompleta' in rfi.get_data(as_text=True))
    limpar()


def teste_permissoes():
    print('\n[unit] so admin mexe na regra')
    consultor = A.app.test_client()
    with consultor.session_transaction() as s:
        s['user_id'] = 99
        s['perfil'] = 'consultor'
    r = consultor.get('/comissoes/regra-gestor')
    checa('consultor nao abre a regra', r.status_code in (302, 403), r.status_code)
    r = consultor.post('/comissoes/regra-gestor/salvar',
                       json={'operadora': 'X', 'plano': 'PME', 'fracoes': []})
    checa('consultor nao salva regra', r.status_code in (302, 403), r.status_code)


if __name__ == '__main__':
    print('=' * 66)
    print('REGRA DO GESTOR/ADMIN VENDEDOR — Fase 3')
    print('=' * 66)
    teste_regra_incompleta_bloqueia()
    teste_retencao_sem_aliquota()
    teste_sugestao_nao_e_confirmacao()
    teste_conta_do_gestor()
    teste_snapshot_imutavel()
    teste_bloqueio_liberacao_e_pix()
    teste_consultor_nao_e_bloqueado()
    teste_rascunho_passa()
    teste_usuario_gestor_sem_regime_de_consultor()
    teste_legado_preservado()
    teste_telas()
    teste_permissoes()
    print('\n' + '=' * 66)
    if falhas:
        print(f'FALHAS ({len(falhas)}):')
        for f in falhas:
            print('  - ' + f)
        sys.exit(1)
    print('Tudo passou.')
