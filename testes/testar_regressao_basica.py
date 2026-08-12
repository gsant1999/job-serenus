"""REGRESSAO OBRIGATORIA: o que ja funcionava tem que continuar funcionando.

A regra do projeto e testar, depois de toda mudanca, a feature nova MAIS uma
feature antiga MAIS a abertura de um anexo. Este arquivo e a parte antiga.

Nao testa a entrega desta leva — testa o que ela poderia ter quebrado de
passagem: a proposta abre, a previa de antecipacao responde, o anexo baixa, e as
telas financeiras que ganharam painel novo continuam de pe.

    JOB_MODO_TESTE=1 JOB_DATA_DIR=/tmp/jobtest python3 testes/testar_regressao_basica.py
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('JOB_MODO_TESTE', '1')
os.environ.setdefault('JOB_DATA_DIR', tempfile.mkdtemp(prefix='jobtest-reg-'))

import app as A  # noqa: E402

falhas = []


def checa(nome, cond, detalhe=''):
    if cond:
        print(f'  ok   {nome}')
    else:
        print(f'  FALHA {nome} {detalhe}')
        falhas.append(f'{nome} {detalhe}')


def cliente():
    c = A.app.test_client()
    with c.session_transaction() as s:
        s['user_id'] = 1
        s['perfil'] = 'admin'
        s['nome'] = 'Admin Teste'
    return c


def semear():
    """Uma venda de consultor com parcela — o caso mais comum do sistema, e o
    que NAO deve ser afetado pela regra do gestor."""
    conn = A.db()
    conn.execute("DELETE FROM parcelas WHERE proposta_id IN "
                 "(SELECT id FROM propostas WHERE razao_social LIKE 'TESTE REGRESSAO%')")
    conn.execute("DELETE FROM propostas WHERE razao_social LIKE 'TESTE REGRESSAO%'")
    # Reaproveita o usuario quando ele ja existe: semear() e chamado por mais de
    # um teste, e o e-mail e unico no banco.
    ja = conn.execute("SELECT id FROM usuarios WHERE email=?",
                      ('teste.regressao@x.com',)).fetchone()
    if ja:
        uid = ja['id']
    else:
        cur = conn.execute("""INSERT INTO usuarios (nome, email, perfil, regime_base, ativo)
                              VALUES (?,?,?,?,1)""",
                           ('Consultor Regressao', 'teste.regressao@x.com', 'consultor',
                            'sem_lead_sem_fixo'))
        uid = A._last_insert_id(cur)
    cur = conn.execute("""INSERT INTO propostas (usuario_id, consultor, numero_proposta,
                    razao_social, status, comissao_total_corretora, vigencia, modalidade,
                    tipo_contrato, acomodacao, fator_moderador, total_vidas, valor,
                    adm_operadora, criado_em)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                 (uid, 'Consultor Regressao', '77700001', 'TESTE REGRESSAO LTDA', 'Implantada',
                  900.0, '2026-07-01', 'PME', 'Novo', 'Enfermaria', 'Sem', 2, 900.0,
                  'Amil', A._agora_sp()))
    pid = A._last_insert_id(cur)
    conn.execute("""INSERT INTO parcelas (proposta_id, numero, percentual, valor, status,
                    data_prevista) VALUES (?,?,?,?,?,?)""",
                 (pid, 1, 100, 300.0, 'Pendente de receber', '2026-08-10'))
    conn.commit()
    A.close_db(conn)
    return pid


def teste_proposta_antiga():
    print('\n[reg] rota antiga de proposta')
    pid = semear()
    c = cliente()
    r = c.get(f'/proposta/{pid}')
    corpo = r.get_data(as_text=True)
    checa('a proposta abre', r.status_code == 200, r.status_code)
    checa('mostra o cliente', 'TESTE REGRESSAO LTDA' in corpo)
    checa('mostra a parcela', '300,00' in corpo)
    checa('venda de consultor NAO ganha bloqueio de regra do gestor',
          'a regra do gestor está incompleta' not in corpo)
    r2 = c.get('/propostas')
    checa('a listagem abre', r2.status_code == 200, r2.status_code)
    r3 = c.get(f'/proposta/{pid}/historico')
    checa('o historico da proposta responde', r3.status_code in (200, 302), r3.status_code)


def teste_previa_antecipacao():
    print('\n[reg] prévia de antecipação')
    pid = semear()
    c = cliente()
    r = c.get(f'/proposta/{pid}/antecipacao/preview')
    checa('a prévia responde sem estourar', r.status_code in (200, 400, 404), r.status_code)
    checa('não é erro 500', r.status_code != 500, r.get_data(as_text=True)[:150])


def teste_anexo():
    print('\n[reg] abertura de anexo')
    c = cliente()
    caminho = os.path.join(A.UPLOAD_FOLDER, 'regressao_teste_anexo.txt')
    with open(caminho, 'w') as f:
        f.write('anexo de regressao')
    r = c.get('/anexos/regressao_teste_anexo.txt')
    checa('anexo existente abre', r.status_code == 200, r.status_code)
    checa('com o conteúdo certo', b'regressao' in r.get_data())
    r2 = c.get('/anexos/nao_existe_de_jeito_nenhum.pdf')
    checa('anexo inexistente dá 404, não 500', r2.status_code == 404, r2.status_code)


def teste_telas_principais():
    print('\n[reg] telas principais continuam de pé')
    c = cliente()
    for rota in ('/', '/propostas', '/financeiro', '/fluxo-caixa', '/crm',
                 '/comissoes', '/usuarios', '/comissoes/extrato'):
        r = c.get(rota)
        checa(f'{rota} responde', r.status_code in (200, 302), r.status_code)
        if r.status_code == 200:
            checa(f'{rota} não é erro interno',
                  'Internal Server Error' not in r.get_data(as_text=True)[:400])


def teste_calculo_de_consultor_intacto():
    print('\n[reg] o motor de comissão do consultor não mudou')
    r = A.calc_comissao('Amil', 'sem_lead_sem_fixo', 0, 1000.0, 'PME', '')
    checa('responde com a estrutura de sempre',
          all(k in r for k in ('total_corretora', 'consultor', 'liquido', 'regua_mens')), list(r))
    checa('plano derivado corretamente', r['plano'] == 'PME', r['plano'])
    checa('PF continua sendo PF',
          A.calc_comissao('Amil', 'sem_lead_sem_fixo', 0, 500.0, 'PF', 'PF')['plano'] == 'PF')


if __name__ == '__main__':
    print('=' * 66)
    print('REGRESSÃO BÁSICA — o que já existia continua funcionando')
    print('=' * 66)
    teste_proposta_antiga()
    teste_previa_antecipacao()
    teste_anexo()
    teste_telas_principais()
    teste_calculo_de_consultor_intacto()
    print('\n' + '=' * 66)
    if falhas:
        print(f'FALHAS ({len(falhas)}):')
        for f in falhas:
            print('  - ' + f)
        sys.exit(1)
    print('Tudo passou.')
