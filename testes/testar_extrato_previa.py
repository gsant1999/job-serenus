"""Testes da PRE-CONFERENCIA em lote do extrato da Affinity (Fase 1).

A propriedade que estes testes existem para proteger e uma so: a previa LE e nao
GRAVA. Por isso o teste mais importante daqui nao verifica numero nenhum — ele
tira uma foto de todas as tabelas do banco antes e depois de subir os 32 PDFs e
exige que as duas fotos sejam identicas. Se um dia alguem "melhorar" a previa
inserindo o extrato de passagem, esse teste quebra antes do dinheiro andar.

O segundo grupo protege a LEITURA FECHADA: a soma das linhas lidas tem que bater
com o total impresso no proprio extrato. Foi assim que o 1374214 apareceu — ele
lia R$ 1.706,16 de R$ 2.648,85 e nao reclamava, porque a linha que sumiu nao
existe pra reclamar de si mesma.

Como rodar (SQLite local, nunca o Postgres de producao):

    JOB_MODO_TESTE=1 JOB_DATA_DIR=/tmp/jobtest python3 testes/testar_extrato_previa.py

JOB_MODO_TESTE=1 desliga o APScheduler e o auto-pull de leads. Sem isso o
importador de leads grava em thread de fundo no meio do teste e a foto do banco
muda por causa do CRM — o teste acusaria a previa de um estrago que nao foi dela.

Os testes de integracao usam os PDFs reais em ~/Downloads. Sem eles (CI), esses
testes sao PULADOS e os unitarios, que rodam com fixtures proprias, continuam
valendo.
"""
import os
import sys
import hashlib
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('JOB_MODO_TESTE', '1')
os.environ.setdefault('JOB_DATA_DIR', tempfile.mkdtemp(prefix='jobtest-previa-'))

import app as A  # noqa: E402

PASTA_PDFS = os.path.expanduser('~/Downloads')
CODIGOS = ['1341896', '1342197', '1345055', '1345503', '1347580', '1350012', '1350988',
           '1351086', '1351088', '1351540', '1353737', '1354207', '1356555', '1359407',
           '1359414', '1361036', '1362124', '1362131', '1367785', '1367799', '1367928',
           '1368194', '1368294', '1370597', '1370605', '1373170', '1373177', '1373410',
           '1374214', '1374289', '1376172', '1376752']

falhas = []
pulados = []


def checa(nome, cond, detalhe=''):
    if cond:
        print(f'  ok   {nome}')
    else:
        print(f'  FALHA {nome} {detalhe}')
        falhas.append(f'{nome} {detalhe}')


def pula(nome, motivo):
    print(f'  pula {nome} — {motivo}')
    pulados.append(nome)


def pdfs_disponiveis():
    return all(os.path.exists(os.path.join(PASTA_PDFS, c + '.pdf')) for c in CODIGOS)


def cliente():
    c = A.app.test_client()
    with c.session_transaction() as s:
        s['user_id'] = 1
        s['perfil'] = 'admin'
    return c


def sem_emojis(texto, estrito=False):
    """Regra 1 do projeto. Testa as FAIXAS de emoji, nao 'caractere alto': acento,
    travessao e o box-drawing usado nos comentarios do proprio app moram acima de
    0x2500 e nao sao emoji.

    A pagina renderizada usa a faixa larga (pictogramas). A faixa estrita, com
    dingbats, so vale para os arquivos desta entrega: o 'x' de fechar o menu no
    base.html cai nela e e anterior a este trabalho — nao e emoji e nao e nosso."""
    faixas = [(0x1F300, 0x1FAFF), (0xFE0F, 0xFE0F), (0x2B00, 0x2BFF)]
    if estrito:
        faixas.append((0x2600, 0x27BF))
    return not any(any(a <= ord(ch) <= b for a, b in faixas) for ch in texto)


def foto_do_banco():
    """Contagem + hash do conteudo de toda tabela. Contar linha sozinho nao pega
    UPDATE — e UPDATE em parcela e exatamente o estrago que a Fase 1 nao pode
    fazer."""
    conn = A.db()
    tabelas = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").fetchall()]
    foto = {}
    for t in tabelas:
        if t.startswith('sqlite_'):
            continue
        linhas = conn.execute(f'SELECT * FROM "{t}"').fetchall()
        h = hashlib.sha256()
        for r in linhas:
            h.update(repr(tuple(r)).encode('utf-8', 'replace'))
        foto[t] = (len(linhas), h.hexdigest())
    A.close_db(conn)
    return foto


# ─────────────────────── unitarios (sem PDF, sempre rodam) ───────────────────

def teste_modo_teste_ligado():
    print('\n[unit] modo de teste desliga o que grava sozinho')
    checa('MODO_TESTE ativo', A.MODO_TESTE is True)
    # Chamar o auto-pull nao pode nem tentar: se ele rodasse, o teste de
    # invariancia mais abaixo veria o CRM mexendo no banco e culparia a previa.
    A._auto_pull_leads_throttled()
    checa('auto-pull nao marcou execucao', A._ULTIMO_AUTO_PULL == 0.0, A._ULTIMO_AUTO_PULL)
    checa('lock do auto-pull esta livre', A._AUTO_PULL_LOCK.acquire(blocking=False))
    A._AUTO_PULL_LOCK.release()


def teste_tipo_item():
    print('\n[unit] rotulo de linha')
    checa('linha da tabela por operadora e normal', A._ext_tipo_item({}) == 'normal')
    checa('antecipacao', A._ext_tipo_item({'tipo': 'Antecipação'}) == 'antecipação')
    checa('estorno indevido vira estorno', A._ext_tipo_item({'tipo': 'Estorno indevido'}) == 'estorno')


def teste_data_pagamento():
    print('\n[unit] data de pagamento')
    cab = {'nf_situacao': 'Nota Fiscal não recebida. Pagamento efetuado em 03/07/2026 - TED.'}
    checa('le a data do texto da NF', A._ext_data_pagamento(cab) == '03/07/2026')
    cab2 = {'nf_situacao': 'Nota Fiscal não recebida. Valor transferido para extrato nº 1345503.'}
    checa('extrato transferido nao tem data de pagamento', A._ext_data_pagamento(cab2) == '')
    checa('sem NF nao inventa data', A._ext_data_pagamento({}) == '')


def teste_regex_credito_truncado():
    """O bug do 1374214, isolado. A linha com a operadora cortada tem que ser
    lida; linha invalida tem que continuar sendo recusada."""
    print('\n[unit] linha de credito com operadora cortada pelo PDF')
    boa = ('[Antecipação][Parc #1][100,00%] Prop. 3211344 - KORPER MEDICAL COMERCIO DE PRODUTOS '
           'HOSPITALARES L - [Porto Seguro R$ 942,69 R$ 0,00 0,00% R$ 0,00 R$ 0,00 R$ 942,69')
    m = A._EXT_RX_CREDITO.match(boa)
    checa('linha com colchete faltando agora casa', m is not None)
    if m:
        d = m.groupdict()
        checa('valor bruto lido inteiro', A._ext_num(d['bruto']) == 942.69, d['bruto'])
        checa('proposta lida', d['proposta'] == '3211344', d['proposta'])
        checa('operadora truncada sinalizada', d['fecha'] is None, d['fecha'])
    fechada = ('[Antecipação][Parc #1][100,00%] Prop. 17853505620367 - DIANA GERMAINE ELISABETE '
               'VOGELAAR 10574870822 - [Medsênior] R$ 1.706,16 R$ 0,00 0,00% R$ 0,00 R$ 0,00 R$ 1.706,16')
    m2 = A._EXT_RX_CREDITO.match(fechada)
    checa('linha normal continua casando', m2 is not None)
    if m2:
        checa('operadora inteira quando o PDF nao cortou',
              m2.group('operadora') == 'Medsênior' and m2.group('fecha') == ']',
              m2.group('operadora'))
    # As recusas: afrouxar o colchete nao pode ter aberto a porta pra lixo.
    for ruim, porque in [
        ('[Antecipação][Parc #1][100,00%] Prop. 3211344 - NOME - [Porto Seguro R$ 942,69',
         'faltam os seis valores'),
        ('Prop. 3211344 - NOME - [Porto Seguro R$ 942,69 R$ 0,00 0,00% R$ 0,00 R$ 0,00 R$ 942,69',
         'sem o prefixo [tipo][Parc][pct]'),
        ('[Antecipação][Parc #1][100,00%] NOME - [Porto Seguro R$ 942,69 R$ 0,00 0,00% R$ 0,00 '
         'R$ 0,00 R$ 942,69', 'sem Prop. <numero>'),
        ('Total de Créditos e Débitos: R$ 2.648,85 R$ 0,00 R$ 0,00 R$ 0,00 R$ 2.644,85',
         'linha de total'),
    ]:
        checa(f'recusa linha invalida ({porque})', A._EXT_RX_CREDITO.match(ruim) is None)


def teste_classificacao_ajuste():
    print('\n[unit] classificacao: ajuste nunca e entrada')
    cab = {'nf_situacao': 'Nota Fiscal não recebida. Valor transferido para extrato nº 1345503 - AcumuladoVlMinimo.',
           'total_bruto': 0.0, 'total_liquido': 568.71, 'debitos': -568.71}
    cls = A._ext_classificar_extrato(cab, [{'tipo': 'Estorno indevido'}])
    checa('transferencia identificada', cls['transferido_para'] == '1345503', cls['transferido_para'])
    checa('classifica como ajuste', cls['ajuste'] is True)
    checa('efeito liquido zero', abs(cls['liquido_esperado']) < 0.01, cls['liquido_esperado'])
    checa('marca estorno e transferencia',
          'estorno' in cls['tipos'] and 'transferência' in cls['tipos'], cls['tipos'])

    normal = {'nf_situacao': 'Nota Fiscal não recebida. Pagamento efetuado em 03/07/2026 - TED.',
              'total_bruto': 250.05, 'total_liquido': 250.05, 'debitos': -4.0}
    cn = A._ext_classificar_extrato(normal, [{}, {}])
    checa('extrato normal nao e ajuste', cn['ajuste'] is False)
    checa('liquido esperado desconta a tarifa', abs(cn['liquido_esperado'] - 246.05) < 0.01,
          cn['liquido_esperado'])

    ant = {'nf_situacao': 'Pagamento efetuado em 15/06/2026 - TED.',
           'total_bruto': 2194.18, 'total_liquido': 2194.18, 'debitos': -4.0}
    ca = A._ext_classificar_extrato(ant, [{'tipo': 'Antecipação'}, {'tipo': 'Antecipação'}])
    checa('antecipacao marcada em separado', ca['tem_antecipacao'] is True)
    checa('antecipacao nao vira ajuste', ca['ajuste'] is False)


def teste_casamento_nunca_chuta():
    print('\n[unit] casamento nunca escolhe entre dois candidatos')
    conn = A.db()
    conn.execute("DELETE FROM propostas WHERE razao_social LIKE 'TESTE PREVIA%'")
    conn.commit()
    for i, (num, rz) in enumerate([('99900001', 'TESTE PREVIA UNICA LTDA'),
                                   ('99900002', 'TESTE PREVIA REPETIDA LTDA'),
                                   ('99900003', 'TESTE PREVIA REPETIDA LTDA')]):
        conn.execute("""INSERT INTO propostas (usuario_id, consultor, numero_proposta,
                        razao_social, status, comissao_total_corretora, vigencia, modalidade,
                        tipo_contrato, acomodacao, fator_moderador, total_vidas, valor, criado_em)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                     (1, 'Guilherme', num, rz, 'Implantada', 1000.0 + i, '01/07/2026', 'PME',
                      'Novo', 'Enfermaria', 'Sem', 1, 500.0, A._agora_sp()))
    conn.commit()

    p, crit, amb, cand = A._ext_casar_previa(conn, {'numero_proposta': '99900001', 'cliente': 'X'})
    checa('casa pelo numero da proposta', p is not None and crit == 'numero_proposta')

    p, crit, amb, cand = A._ext_casar_previa(
        conn, {'numero_proposta': '', 'cliente': 'TESTE PREVIA UNICA LTDA'})
    checa('nome com um candidato casa como fraco', p is not None and crit == 'razao_social')

    p, crit, amb, cand = A._ext_casar_previa(
        conn, {'numero_proposta': '', 'cliente': 'TESTE PREVIA REPETIDA LTDA'})
    checa('nome com dois candidatos NAO casa', p is None and amb is True and cand == 2,
          f'p={p} amb={amb} cand={cand}')

    p, crit, amb, cand = A._ext_casar_previa(
        conn, {'numero_proposta': '77700000', 'cliente': 'NAO EXISTE NO JOB SA'})
    checa('sem proposta nao e ambiguidade', p is None and amb is False and cand == 0)

    # Parcela exata: so com casamento seguro.
    pid = conn.execute("SELECT id FROM propostas WHERE numero_proposta='99900001'").fetchone()[0]
    conn.execute("""INSERT INTO parcelas (proposta_id, numero, percentual, valor, status)
                    VALUES (?,?,?,?,?)""", (pid, 1, 100, 500.0, 'Pendente de receber'))
    conn.commit()
    checa('acha a parcela quando o casamento foi pelo numero',
          (A._ext_parcela_exata(conn, pid, 1, 'numero_proposta') or {}).get('numero') == 1)
    checa('nao aponta parcela em casamento por nome',
          A._ext_parcela_exata(conn, pid, 1, 'razao_social') is None)
    checa('parcela inexistente nao inventa',
          A._ext_parcela_exata(conn, pid, 9, 'numero_proposta') is None)

    conn.execute("DELETE FROM parcelas WHERE proposta_id=?", (pid,))
    conn.execute("DELETE FROM propostas WHERE razao_social LIKE 'TESTE PREVIA%'")
    conn.commit()
    A.close_db(conn)


def teste_rota_get():
    print('\n[unit] rota abre e avisa que nao grava')
    c = cliente()
    r = c.get('/comissoes/extrato/lote/previsualizar')
    corpo = r.get_data(as_text=True)
    checa('GET responde 200', r.status_code == 200, r.status_code)
    checa('a tela diz que nao grava nada', 'Esta tela não grava nada' in corpo)
    checa('a tela diz que extrato e valor apurado, nao dinheiro na conta',
          'valor apurado, não é dinheiro na conta' in corpo)
    checa('sem emoji na tela', sem_emojis(corpo))
    raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    for arq in ('templates/comissao_extrato_previa.html', 'templates/comissao_extrato.html'):
        with open(os.path.join(raiz, arq), encoding='utf-8') as f:
            checa(f'sem emoji em {arq}', sem_emojis(f.read(), estrito=True))
    r2 = c.post('/comissoes/extrato/lote/previsualizar', data={})
    checa('POST sem arquivo explica o que fazer',
          'Escolha pelo menos um PDF' in r2.get_data(as_text=True))


# ─────────────────── integracao (precisa dos 32 PDFs reais) ──────────────────

def teste_leitura_dos_32():
    print('\n[int] leitura dos 32 extratos')
    if not pdfs_disponiveis():
        return pula('leitura dos 32 extratos', f'PDFs nao encontrados em {PASTA_PDFS}')
    lidos, fecharam, abertos = 0, 0, []
    for cod in CODIGOS:
        with open(os.path.join(PASTA_PDFS, cod + '.pdf'), 'rb') as f:
            cab, itens, _av = A.ler_extrato_affinity(f.read(), cod + '.pdf')
        if cab.get('codigo_comissao') == cod:
            lidos += 1
        else:
            print(f'    codigo divergente em {cod}: {cab.get("codigo_comissao")}')
        if cab.get('leitura_fechada'):
            fecharam += 1
        else:
            abertos.append((cod, cab.get('conf_diferenca')))
    checa('os 32 PDFs leem o proprio codigo de comissao', lidos == 32, f'{lidos}/32')
    checa('os 32 fecham com o total impresso no proprio extrato', fecharam == 32,
          f'{fecharam}/32 — abertos: {abertos}')


def teste_1374214_as_duas_linhas():
    """O bloqueador da auditoria. Sem o colchete opcional, some R$ 942,69."""
    print('\n[int] 1374214 le as DUAS linhas')
    caminho = os.path.join(PASTA_PDFS, '1374214.pdf')
    if not os.path.exists(caminho):
        return pula('1374214', 'PDF ausente')
    with open(caminho, 'rb') as f:
        cab, itens, av = A.ler_extrato_affinity(f.read(), '1374214.pdf')
    checa('duas linhas lidas', len(itens) == 2, len(itens))
    valores = sorted(round(i['bruto'], 2) for i in itens)
    checa('as duas linhas sao 942,69 e 1.706,16', valores == [942.69, 1706.16], valores)
    checa('bruto total 2.648,85', abs(cab['total_bruto'] - 2648.85) < 0.01, cab['total_bruto'])
    cls = A._ext_classificar_extrato(cab, itens)
    checa('liquido 2.644,85 (2.648,85 - 4,00 de tarifa)',
          abs(cls['liquido_esperado'] - 2644.85) < 0.01, cls['liquido_esperado'])
    checa('leitura fecha com o total impresso', cab['leitura_fechada'] is True,
          cab.get('conf_diferenca'))
    checa('avisa que o PDF cortou o nome da operadora',
          any('cortou o nome' in a for a in av), av)
    checa('a linha cortada fica marcada',
          any(i.get('operadora_truncada') for i in itens))


def teste_1345055_e_ajuste():
    print('\n[int] 1345055 e ajuste, nunca entrada')
    caminho = os.path.join(PASTA_PDFS, '1345055.pdf')
    if not os.path.exists(caminho):
        return pula('1345055', 'PDF ausente')
    with open(caminho, 'rb') as f:
        cab, itens, _av = A.ler_extrato_affinity(f.read(), '1345055.pdf')
    cls = A._ext_classificar_extrato(cab, itens)
    checa('efeito liquido zero', abs(cls['liquido_esperado']) < 0.01, cls['liquido_esperado'])
    checa('classificado como ajuste', cls['ajuste'] is True)
    checa('aponta o extrato de destino', cls['transferido_para'] == '1345503',
          cls['transferido_para'])
    checa('nao tem data de pagamento', A._ext_data_pagamento(cab) == '')
    # Extrato transferido nao emite nota: a ancora dele e o total de creditos e
    # debitos, nao o valor da NF. Sem essa segunda ancora, ele seria marcado como
    # leitura falha para sempre — e nao e: ele esta lido inteiro e vale zero.
    checa('leitura fecha pela ancora de creditos e debitos',
          cab['leitura_fechada'] is True and cab['conf_ancora'] == 'creditos_debitos',
          f"{cab.get('leitura_fechada')} / {cab.get('conf_ancora')}")


def teste_1359414_regua_de_parcelas():
    print('\n[int] 1359414 preserva a regua 1,2,3,4,5,7,9,11')
    caminho = os.path.join(PASTA_PDFS, '1359414.pdf')
    if not os.path.exists(caminho):
        return pula('1359414', 'PDF ausente')
    with open(caminho, 'rb') as f:
        cab, itens, _av = A.ler_extrato_affinity(f.read(), '1359414.pdf')
    esperado = [1, 2, 3, 4, 5, 7, 9, 11]
    for prop in ('97147934', '97147980'):
        parcelas = sorted(i['parcela'] for i in itens if i['numero_proposta'] == prop)
        checa(f'proposta {prop} com a regua explicita', parcelas == esperado, parcelas)
    checa('16 linhas no total', len(itens) == 16, len(itens))
    checa('bruto 250,05', abs(cab['total_bruto'] - 250.05) < 0.01, cab['total_bruto'])
    cls = A._ext_classificar_extrato(cab, itens)
    checa('liquido esperado 246,05 (250,05 - 4,00 de tarifa)',
          abs(cls['liquido_esperado'] - 246.05) < 0.01, cls['liquido_esperado'])
    checa('leitura fecha', cab['leitura_fechada'] is True, cab.get('conf_diferenca'))


def teste_leitura_incompleta_e_recusada():
    """Prova a trava, sem depender de PDF quebrado: entrega um cabecalho com
    diferenca e confere que a rota antiga recusa em vez de gravar."""
    print('\n[unit] arquivo com leitura incompleta nao entra')
    original = A.ler_extrato_affinity

    def falso(_dados, nome=''):
        cab = {'arquivo': nome, 'codigo_comissao': '9999999', 'cadastro_cod': '217326',
               'cadastro_nome': 'SERENUS VITAE LTDA', 'geracao': '04/08/2026',
               'previsao': '05/08/2026', 'nf_situacao': 'Pagamento efetuado em 05/08/2026 - TED.',
               'total_bruto': 1706.16, 'total_liquido': 1706.16, 'debitos': -4.0,
               'total_impresso': 2648.85, 'conf_ancora': 'nota_fiscal',
               'conf_impresso': 2648.85, 'conf_lido': 1706.16,
               'conf_diferenca': -942.69, 'leitura_fechada': False}
        itens = [{'operadora': 'Medsênior', 'cliente': 'X', 'numero_proposta': '17853505620367',
                  'parcela': 1, 'data_cadastro': '', 'data_assinatura': '', 'vigencia': '',
                  'vl_parcela': 1706.16, 'percentual': 100.0, 'bruto': 1706.16, 'taxa': 0.0,
                  'desp_adm': 0.0, 'iss': 0.0, 'liquido': 1706.16, 'tipo': 'Antecipação'}]
        return cab, itens, ['A leitura não fechou']
    A.ler_extrato_affinity = falso
    try:
        conn = A.db()
        antes = conn.execute("SELECT COUNT(*) c FROM comissao_extrato").fetchone()['c']
        A.close_db(conn)
        c = cliente()
        import io
        r = c.post('/comissoes/extrato',
                   data={'pdf': (io.BytesIO(b'%PDF-falso'), 'quebrado.pdf')},
                   content_type='multipart/form-data')
        corpo = r.get_data(as_text=True)
        checa('o importador recusa e explica', 'A leitura não fechou com o extrato' in corpo,
              corpo[:200])
        conn = A.db()
        depois = conn.execute("SELECT COUNT(*) c FROM comissao_extrato").fetchone()['c']
        A.close_db(conn)
        checa('nada foi gravado', antes == depois, f'{antes} -> {depois}')
    finally:
        A.ler_extrato_affinity = original


def teste_lote_na_rota():
    print('\n[int] os 32 PDFs pela rota, com totais e duplicidade')
    if not pdfs_disponiveis():
        return pula('lote na rota', f'PDFs nao encontrados em {PASTA_PDFS}')
    c = cliente()
    # 1345503 vai DUAS vezes de proposito: e o teste da duplicidade por codigo
    # dentro do proprio lote, que e o erro facil de cometer com 32 arquivos.
    envio = [(open(os.path.join(PASTA_PDFS, cod + '.pdf'), 'rb'), cod + '.pdf')
             for cod in CODIGOS + ['1345503']]
    try:
        r = c.post('/comissoes/extrato/lote/previsualizar',
                   data={'pdfs': envio}, content_type='multipart/form-data')
    finally:
        for f, _ in envio:
            f.close()
    corpo = r.get_data(as_text=True)
    checa('POST responde 200', r.status_code == 200, r.status_code)
    checa('mostra os 33 arquivos enviados', '>33<' in corpo or '33</b>' in corpo)
    checa('1345055 aparece como estorno/ajuste', 'estorno/ajuste' in corpo)
    checa('marca o codigo repetido no lote', 'aparece mais de uma vez neste lote' in corpo)
    checa('nenhum arquivo com leitura incompleta', 'leitura incompleta</span>' not in corpo)
    checa('sem emoji no resultado', sem_emojis(corpo))


def teste_totais_do_lote():
    """Confere os NUMEROS do lote, nao so que a pagina abriu. Usa o mesmo
    conferidor que a rota usa, sem HTML no meio."""
    print('\n[int] totais do lote de 32')
    if not pdfs_disponiveis():
        return pula('totais do lote', f'PDFs nao encontrados em {PASTA_PDFS}')
    conn = A.db()
    arquivos = []
    for cod in CODIGOS:
        with open(os.path.join(PASTA_PDFS, cod + '.pdf'), 'rb') as f:
            arquivos.append((cod + '.pdf', f.read()))
    linhas = A._ext_conferir_lote(conn, arquivos)
    A.close_db(conn)
    resumo, por_cadastro = A._ext_resumo_lote(linhas)
    checa('32 arquivos analisados', resumo['arquivos'] == 32, resumo['arquivos'])
    checa('nenhuma leitura incompleta', resumo['nao_fecharam'] == 0, resumo['nao_fecharam'])
    checa('1 ajuste (o 1345055)', resumo['ajustes'] == 1, resumo['ajustes'])
    porcod = {l['codigo']: l for l in linhas}
    checa('1374214 com liquido 2.644,85',
          abs(porcod['1374214']['liquido_esperado'] - 2644.85) < 0.01,
          porcod.get('1374214', {}).get('liquido_esperado'))
    checa('1359414 com liquido 246,05',
          abs(porcod['1359414']['liquido_esperado'] - 246.05) < 0.01,
          porcod.get('1359414', {}).get('liquido_esperado'))
    checa('1345055 nao entra no apurado',
          porcod['1345055']['situacao'] == 'ajuste', porcod['1345055']['situacao'])
    # O apurado tem que ser a soma dos liquidos, menos ajuste e duplicado.
    esperado = round(sum(l['liquido_esperado'] for l in linhas if not l['ajuste']), 2)
    checa('apurado bate com a soma dos liquidos nao-ajuste',
          abs(resumo['apurado'] - esperado) < 0.01, f"{resumo['apurado']} != {esperado}")
    print(f"    apurado no lote: R$ {resumo['apurado']:.2f} | bruto R$ {resumo['bruto']:.2f} | "
          f"itens {resumo['itens']} | casados {resumo['casados']} | por nome {resumo['fracos']} | "
          f"sem proposta {resumo['itens_sem_proposta']} | ambiguos {resumo['itens_ambiguos']} | "
          f"divergentes {resumo['itens_divergentes']}")


def teste_banco_intacto():
    print('\n[int] INVARIANCIA: o banco nao muda')
    if not pdfs_disponiveis():
        return pula('invariancia do banco', f'PDFs nao encontrados em {PASTA_PDFS}')
    antes = foto_do_banco()
    c = cliente()
    envio = [(open(os.path.join(PASTA_PDFS, cod + '.pdf'), 'rb'), cod + '.pdf')
             for cod in CODIGOS]
    try:
        c.post('/comissoes/extrato/lote/previsualizar',
               data={'pdfs': envio}, content_type='multipart/form-data')
    finally:
        for f, _ in envio:
            f.close()
    depois = foto_do_banco()
    difs = [t for t in set(antes) | set(depois) if antes.get(t) != depois.get(t)]
    checa('nenhuma tabela mudou depois de conferir 32 extratos', not difs, difs)


def teste_regressao_extrato_antigo():
    print('\n[reg] tela antiga /comissoes/extrato e abertura de anexo')
    c = cliente()
    r = c.get('/comissoes/extrato')
    corpo = r.get_data(as_text=True)
    checa('lista de extratos ainda abre', r.status_code == 200, r.status_code)
    checa('importador antigo continua na tela', 'Ler e importar este arquivo' in corpo)
    checa('esta marcado como modo antigo', 'modo antigo' in corpo)
    checa('link para a previa aparece', '/comissoes/extrato/lote/previsualizar' in corpo)
    checa('nao diz mais que extrato e dinheiro que entrou',
          'dinheiro que entrou' not in corpo)
    r2 = c.post('/comissoes/extrato', data={})
    checa('importar sem arquivo continua avisando',
          'Escolha o PDF do extrato' in r2.get_data(as_text=True))

    # Anexo: a rota tem que responder — 200 com o arquivo, ou 404 honesto quando
    # o arquivo nao existe mais. O que nao pode e estourar 500.
    with open(os.path.join(A.UPLOAD_FOLDER, 'previa_teste_anexo.txt'), 'w') as f:
        f.write('anexo de teste da pre-conferencia')
    ra = c.get('/anexos/previa_teste_anexo.txt')
    checa('abrir anexo existente devolve o arquivo', ra.status_code == 200, ra.status_code)
    checa('conteudo do anexo confere',
          b'pre-conferencia' in ra.get_data(), ra.get_data()[:40])
    rb = c.get('/anexos/nao_existe_mesmo.pdf')
    checa('anexo inexistente da 404, nao 500', rb.status_code == 404, rb.status_code)


if __name__ == '__main__':
    print('=' * 66)
    print('PRE-CONFERENCIA DO EXTRATO DA AFFINITY — Fase 1 (leitura, sem gravar)')
    print('=' * 66)
    teste_modo_teste_ligado()
    teste_tipo_item()
    teste_data_pagamento()
    teste_regex_credito_truncado()
    teste_classificacao_ajuste()
    teste_casamento_nunca_chuta()
    teste_rota_get()
    teste_leitura_incompleta_e_recusada()
    teste_leitura_dos_32()
    teste_1374214_as_duas_linhas()
    teste_1345055_e_ajuste()
    teste_1359414_regua_de_parcelas()
    teste_lote_na_rota()
    teste_totais_do_lote()
    teste_banco_intacto()
    teste_regressao_extrato_antigo()
    print('\n' + '=' * 66)
    if pulados:
        print(f'PULADOS ({len(pulados)}): ' + ', '.join(pulados))
    if falhas:
        print(f'FALHAS ({len(falhas)}):')
        for f in falhas:
            print('  - ' + f)
        sys.exit(1)
    print('Tudo passou.')
