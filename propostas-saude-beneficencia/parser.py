"""Interpreta o bloco de notas (texto solto) que o usuario ja mantem com os dados
das pessoas (nome/cpf/rg/nascimento/mae/sus), endereco, empresa (CNPJ) e contato.
Formato esperado (flexivel, separado por linhas em branco):

NOME COMPLETO
CPF
RG ORGAO UF
DD/MM/AAAA
EMISSÃO: DD/MM/AAAA
NATURAL: CIDADE - UF
NOME DO PAI
NOME DA MÃE
CNES ou SUS: numero

<repete para cada pessoa>

RUA
NUMERO
BAIRRO
CIDADE
CEP: 00000-000

CNPJ: 00.000.000/0000-00
RAZAO SOCIAL

(DD) NUMERO
email@dominio.com
"""
import re

from sexo import deduzir_sexo

CPF_RE = re.compile(r'\d{3}\.?\d{3}\.?\d{3}-?\d{2}')
DATA_RE = re.compile(r'^\d{2}/\d{2}/\d{4}$')
CEP_RE = re.compile(r'(\d{5}-?\d{3})')
TEL_RE = re.compile(r'\(?\d{2}\)?\s?\d{4,5}-?\d{4}')


def _parse_pessoa(linhas):
    nome = linhas[0].strip() if len(linhas) > 0 else ''
    cpf = linhas[1].strip() if len(linhas) > 1 else ''
    rg = linhas[2].strip() if len(linhas) > 2 else ''
    nascimento = ''
    sus = ''
    telefone = ''
    email = ''
    nomes_extra = []
    for ln in linhas[3:]:
        ln_up = ln.upper()
        if DATA_RE.match(ln.strip()):
            if not nascimento:
                nascimento = ln.strip()
        elif ln_up.startswith('EMISS'):
            continue
        elif ln_up.startswith('NATURAL'):
            continue
        elif ln_up.startswith('CNES') or ln_up.startswith('SUS') or 'CARTAO DO SUS' in ln_up or 'CARTÃO DO SUS' in ln_up:
            m = re.search(r'(\d{5,})', ln)
            if m:
                sus = m.group(1)
        elif '@' in ln:
            # E-mail escrito junto dos dados da pessoa. Precisa sair daqui: a mae e o
            # ULTIMO nome extra do bloco, entao um e-mail no fim da lista virava o
            # nome da mae na ficha que vai para a operadora.
            email = ln.strip().lower()
        elif TEL_RE.search(ln) and not DATA_RE.match(ln.strip()):
            telefone = ln.strip()
        else:
            nomes_extra.append(ln.strip())
    mae = nomes_extra[-1] if nomes_extra else ''
    return {'nome': nome, 'cpf': cpf, 'rg': rg, 'nascimento': nascimento, 'mae': mae,
            'sus': sus, 'sexo': deduzir_sexo(nome),
            'telefone1': telefone, 'email': email}


def _parse_empresa(linhas):
    cnpj = ''
    razao = ''
    for ln in linhas:
        if ln.upper().startswith('CNPJ'):
            m = re.search(r'[\d./-]{14,}', ln)
            if m:
                cnpj = m.group(0).strip()
        elif not razao:
            razao = ln.strip()
    return {'cnpj': cnpj, 'razao_social': razao}


def _parse_endereco(linhas):
    d = {'rua': '', 'numero': '', 'bairro': '', 'cidade': '', 'cep': ''}
    textos = []
    for ln in linhas:
        if ln.upper().startswith('CEP'):
            m = CEP_RE.search(ln)
            if m:
                d['cep'] = m.group(1)
        elif re.match(r'^\d+[A-Za-z]?$', ln.strip()):
            d['numero'] = ln.strip()
        else:
            textos.append(ln.strip())
    if len(textos) >= 1:
        d['rua'] = textos[0]
    if len(textos) >= 2:
        d['bairro'] = textos[1]
    if len(textos) >= 3:
        d['cidade'] = textos[2]
    return d


def _parse_contato(linhas):
    tel = ''
    email = ''
    for ln in linhas:
        if '@' in ln:
            email = ln.strip()
        elif TEL_RE.search(ln):
            tel = ln.strip()
    return {'telefone': tel, 'email': email}


def parse_bloco_notas(texto):
    texto = (texto or '').replace('\r\n', '\n').replace('\r', '\n')
    blocos = re.split(r'\n\s*\n', texto.strip())
    pessoas = []
    empresa = {}
    endereco = {}
    contato = {}
    for bloco in blocos:
        linhas = [l.strip() for l in bloco.split('\n') if l.strip()]
        if not linhas:
            continue
        junto = '\n'.join(linhas).upper()
        if 'CALCULO DAS IDADES' in junto or 'CÁLCULO DAS IDADES' in junto:
            continue
        primeira_upper = linhas[0].upper()
        segunda = linhas[1] if len(linhas) > 1 else ''
        if primeira_upper.startswith('CNPJ'):
            empresa = _parse_empresa(linhas)
        elif any(l.upper().startswith('CEP') for l in linhas):
            endereco = _parse_endereco(linhas)
        elif any('@' in l for l in linhas) and len(linhas) <= 3:
            contato = _parse_contato(linhas)
        elif CPF_RE.search(segunda):
            pessoas.append(_parse_pessoa(linhas))
        # bloco nao reconhecido: ignorado (mostrado como "nao interpretado" na UI se precisar)
    # Telefone e e-mail escritos dentro do bloco da pessoa valem como contato: o
    # corretor ja forneceu o dado, nao faz sentido a tela pedir de novo.
    if not contato.get('telefone') or not contato.get('email'):
        for p in pessoas:
            if not contato.get('telefone') and p.get('telefone1'):
                contato['telefone'] = p['telefone1']
            if not contato.get('email') and p.get('email'):
                contato['email'] = p['email']
    return {'pessoas': pessoas, 'empresa': empresa, 'endereco': endereco, 'contato': contato}
