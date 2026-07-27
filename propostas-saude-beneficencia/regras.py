"""Regras de aceitacao e de comprovacao de vinculo da Saude Beneficencia.

Fonte: material "Composicao / Quem Pode Aderir" da operadora + orientacao do corretor.
Isto aqui e conhecimento de negocio, nao detalhe tecnico: e o que decide se a proposta
volta ou nao da operadora. Mudou a regra da Bene, muda este arquivo.

O principio que amarra tudo: **o vinculo tem que ficar claro a partir dos documentos**.
Nao basta escrever "conjuge" na ficha - o pacote precisa conter o papel que prova.
"""

# ─────────────────────── Quem pode ser TITULAR ───────────────────────
# chave -> (rotulo, como se comprova o vinculo com a empresa)
TITULARES = {
    'socio': (
        'Sócio',
        None,  # o contrato social / CCMEI ja comprova - nao pede documento extra
    ),
    'funcionario': (
        'Funcionário com vínculo (FGTS)',
        'Holerite verde padrão',
    ),
    'estagiario': (
        'Estagiário',
        'Contrato de estágio',
    ),
}

# Nao entram como titular, em nenhuma hipotese.
TITULARES_RECUSADOS = {
    'funcionario_afastado': 'Funcionário afastado',
    'prestador': 'Prestador de serviços',
}

# Entidades (associacao, condominio, sindicato, ONG...) entram, mas a operadora
# analisa caso a caso e so aceita funcionario que conste no FGTS.
AVISO_ENTIDADE = ('Agremiações, associações, clubes, condomínios, confederações, '
                  'cooperativas, entidades filantrópicas e religiosas, federações, '
                  'fundações, sindicatos e ONGs: aceitação sujeita a análise da '
                  'operadora, e apenas para funcionários constantes do FGTS.')


# ─────────────────── Quem pode ser DEPENDENTE e como provar ───────────────────
# chave -> (rotulo, grau, documento que comprova o parentesco)
#
# "grau" e so informativo: a Bene aceita direto e indireto, o que muda e a cadeia
# de documentos necessaria para o parentesco ficar demonstrado.
DEPENDENTES = {
    # --- diretos ---
    'conjuge': ('Cônjuge', 'direto',
                'Certidão de casamento'),
    'companheiro': ('Companheiro(a)', 'direto',
                    'Declaração de união estável assinada no gov.br ou autenticada em cartório'),
    'filho': ('Filho(a) natural ou adotivo(a)', 'direto',
              'Certidão de nascimento (ou documento com a filiação)'),

    # --- indiretos ---
    # None = nao pede papel novo; a filiacao impressa no documento do titular ja mostra
    # o parentesco. Vira observacao na tela, nao item de checklist.
    'pai_mae': ('Pai ou mãe', 'indireto', None),
    'sogro_sogra': ('Sogro ou sogra', 'indireto',
                    'Certidão de casamento do titular + documento do cônjuge com a filiação'),
    'irmao': ('Irmão(ã)', 'indireto',
              'Documentos dos dois com a mesma filiação'),
    'neto': ('Neto(a)', 'indireto',
             'Certidão de nascimento do neto + documento do filho(a) com a filiação'),
    'avo': ('Avô ou avó', 'indireto',
            'Documento do pai/mãe do titular com a filiação'),
    'bisneto': ('Bisneto(a)', 'indireto',
                'Cadeia de certidões até o titular'),
    'bisavo': ('Bisavô ou bisavó', 'indireto',
               'Cadeia de certidões até o titular'),
    'sobrinho': ('Sobrinho(a)', 'indireto',
                 'Certidão do sobrinho + documento do irmão(ã) do titular'),
    'tio': ('Tio(a)', 'indireto',
            'Documento do pai/mãe do titular + documento do tio(a) com a mesma filiação'),
    'cunhado': ('Cunhado(a)', 'indireto',
                'Certidão de casamento do titular + documento do cunhado(a)'),
    'nora_genro': ('Nora ou genro', 'indireto',
                   'Certidão de casamento do filho(a) do titular'),
}

DEPENDENTES_RECUSADOS = {
    'prestador': 'Prestador de serviços',
}


def documento_de_vinculo_do_titular(tipo):
    """Qual papel comprova que o titular pode aderir por essa empresa.
    Devolve None quando o contrato social ja resolve (caso do socio)."""
    if tipo in TITULARES_RECUSADOS:
        raise ValueError(f'{TITULARES_RECUSADOS[tipo]} nao pode ser titular nesta operadora.')
    if tipo not in TITULARES:
        raise ValueError(f'Tipo de titular desconhecido: {tipo}')
    return TITULARES[tipo][1]


def documento_de_parentesco(parentesco):
    """Qual papel comprova o parentesco do dependente com o titular."""
    if parentesco in DEPENDENTES_RECUSADOS:
        raise ValueError(f'{DEPENDENTES_RECUSADOS[parentesco]} nao pode ser dependente.')
    if parentesco not in DEPENDENTES:
        return 'Documento que comprove o parentesco com o titular'
    return DEPENDENTES[parentesco][2]


def checklist(tipo_titular, parentescos_dependentes, tem_criancas_sem_documento=False):
    """Monta a lista de documentos que ESTE caso exige, para o corretor conferir
    antes de mandar para a operadora.

    Devolve {'itens': [{chave, rotulo, obrigatorio, motivo}], 'observacoes': [str]}.

    'chave' e a mesma que montagem.py usa para posicionar o documento no contrato -
    e o que permite a tela montar os campos de upload sozinha, sem lista duplicada
    em dois lugares que sai de sincronia na primeira mudanca de regra.
    """
    observacoes = []
    itens = [
        ('cartao_cnpj', 'Cartão CNPJ', True, 'Identifica a empresa contratante'),
        ('contrato_social', 'Contrato social ou CCMEI', True, 'CCMEI quando a empresa é MEI'),
        ('doc_dono', 'Documento do dono da empresa', True, 'Sempre, mesmo que ele não entre no plano'),
        ('doc_titular', 'Documento do titular (RG, CPF ou CNH)', True, 'Identificação do titular'),
        ('comprovante_endereco', 'Comprovante de endereço', True, 'Obrigatório em toda proposta'),
    ]

    vinculo = documento_de_vinculo_do_titular(tipo_titular)
    if vinculo:
        itens.append(('vinculo', vinculo, True,
                      'O titular não é sócio — precisa comprovar o vínculo com a empresa'))

    parentescos = parentescos_dependentes or []
    if parentescos:
        itens.append(('doc_dependentes', 'Documento dos dependentes (RG, CPF ou CNH)', True,
                      'Identificação de cada dependente'))
    for p in parentescos:
        rotulo = DEPENDENTES.get(p, (p, '?', None))[0]
        prova = documento_de_parentesco(p)
        if prova:
            itens.append((f'parentesco_{p}', prova, True,
                          f'Comprova o parentesco de {rotulo} com o titular'))
        else:
            observacoes.append(
                f'{rotulo}: a filiação impressa no documento do titular já comprova o '
                f'parentesco — não precisa de papel adicional.')

    if tem_criancas_sem_documento:
        itens.append(('certidao_crianca', 'Certidão de nascimento da criança', True,
                      'Criança sem RG, CPF ou CNH entra pela certidão'))

    # tira duplicata mantendo a ordem (ex.: dois filhos pedem a mesma certidao)
    vistos, unicos = set(), []
    for chave, rotulo, obrig, motivo in itens:
        if chave in vistos:
            continue
        vistos.add(chave)
        unicos.append({'chave': chave, 'rotulo': rotulo,
                       'obrigatorio': obrig, 'motivo': motivo})
    return {'itens': unicos, 'observacoes': list(dict.fromkeys(observacoes))}
