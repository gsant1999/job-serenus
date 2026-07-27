"""Motor de preenchimento dos PDFs da Saude Beneficencia (Proposta + Ficha de Inclusao).
Nao mexe na estrutura dos PDFs originais - so escreve valores nos campos existentes.
"""
import os
import re
from datetime import date

from pypdf import PdfReader, PdfWriter
from pypdf.generic import BooleanObject, NameObject, TextStringObject

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

# Os modelos sao versionados junto do codigo (nao no R2, nao em ~/Downloads): modelo e
# codigo andam juntos, senao existe producao rodando com formulario divergente.
# Nome ASCII de proposito - o nome original vinha do macOS com acento em NFD e o Linux
# do Railway nao acha o arquivo.
MODELOS_DIR = os.path.join(BASE_DIR, 'modelos-pdf')
FOLHA_TEMPLATE = os.path.join(MODELOS_DIR, 'beneficencia_folha_proposta_2026-06.pdf')
FICHA_TEMPLATE = os.path.join(MODELOS_DIR, 'beneficencia_ficha_inclusao_2026-06.pdf')

# O achatamento depende de uma funcao interna do pypdf. Se uma atualizacao a remover, o
# except la embaixo engoliria a falha e a operadora receberia papel em branco - entao
# falhamos alto e cedo, no import, em vez de gerar documento invalido em silencio.
if not hasattr(PdfWriter, '_add_apstream_object'):
    raise RuntimeError(
        'pypdf incompativel: PdfWriter._add_apstream_object nao existe mais. '
        'O achatamento do PDF depende dela. Fixe pypdf==6.11.0 ou adapte motor._achatar().'
    )

# Agente de vendas padrao. A tela permite cadastrar outros e escolher qual assina a
# proposta; este aqui e so o que ja vem pronto para nao comecar vazio.
AGENTE = {
    'nome': 'GUILHERME AUGUSTO SANTOS',
    'cpf': '475.547.078-17',
    'telefone': '(19) 99875-2758',
}


def _agente(dados):
    """Agente que assina ESTA proposta. Cai no padrao se a tela nao mandar."""
    a = (dados or {}).get('agente') or {}
    return {
        'nome': (a.get('nome') or AGENTE['nome']).strip(),
        'cpf': (a.get('cpf') or AGENTE['cpf']).strip(),
        'telefone': (a.get('telefone') or AGENTE['telefone']).strip(),
    }

MESES = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO',
         'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO']

FAIXAS_MIN = [0, 19, 24, 29, 34, 39, 44, 49, 54, 59]

PLANOS = {
    'agile_standart': {
        'nome_folha': 'Ágile Standart CE 500',
        'ficha_choice': '/FichaInc1Choice4',
        'p2': 'Check Box16', 'p3': 'Check Box20', 'p4': 'Check Box26',
        'precos': [149.43, 166.81, 186.84, 210.51, 220.85, 266.32, 363.29, 446.57, 517.81, 753.70],
    },
    'sabe_300': {
        'nome_folha': 'Sabe CE 300 Standard',
        'ficha_choice': '/FichaInc1Choice5',
        'p2': 'Check Box asdasd', 'p3': 'Check Box21', 'p4': 'Check Box27',
        'precos': [155.22, 181.11, 213.10, 238.18, 251.31, 288.06, 383.69, 478.19, 618.63, 887.53],
    },
    'selection_200': {
        'nome_folha': 'Selection CE 200 Standard',
        'ficha_choice': '/FichaInc1Choice7',
        'p2': 'Check Box asdasdss', 'p3': 'Check Box22', 'p4': 'Check Box28',
        'precos': [182.18, 235.50, 291.77, 323.02, 354.29, 376.00, 468.27, 595.13, 724.43, 1041.61],
    },
    'sabe_200_access': {
        'nome_folha': 'Sabe CE 200 Standard Access',
        'ficha_choice': '/FichaInc1Choice6',
        'p2': 'fdgdfgdfg', 'p3': 'Check Box23', 'p4': 'Check Box29',
        'precos': [113.72, 132.69, 156.12, 174.50, 184.12, 211.05, 281.11, 350.35, 453.25, 650.27],
    },
    'selection_220_access': {
        'nome_folha': 'Selection CE 220 Standard Access',
        'ficha_choice': '/FichaInc1Choice8',
        'p2': 'Check Boxghjghj', 'p3': 'Check Box24', 'p4': 'Check Box30',
        'precos': [133.47, 172.53, 213.76, 236.66, 259.57, 275.47, 343.08, 436.02, 530.74, 763.12],
    },
    'agile_500_access': {
        'nome_folha': 'Ágile CE 500 Access',
        'ficha_choice': '/FichaInc1Choice3',
        'p2': 'Ágile CE 500 Access pg 3', 'p3': ' de Preços - Ágile CE 500', 'p4': ' de Preços Ágile 500',
        'precos': [109.47, 122.20, 136.88, 154.22, 161.79, 195.11, 266.15, 327.16, 379.35, 552.16],
    },
}

VENCIMENTO_FOLHA1 = {'05': '/Folha1Choice2', '10': '/Folha1Choice1', '15': '/Folha1Choice3', '20': '/Folha1Choice4'}
VENCIMENTO_GROUP17 = {'05': '/Choice1', '10': '/Choice2', '15': '/Choice3', '20': '/Choice4'}
ACOMODACAO_FICHA = {'coletiva': '/FichaInc1Choice3', 'privativa': '/FichaInc1Choice1'}

# Checkbox que deve SEMPRE ir marcado na pagina 3 da Folha.
CHECKBOX_EX_EMPREGADOS = 'Check Box19'

# Pagina 2 da Ficha: data da entrevista medica ou a palavra PORTABILIDADE.
FICHA_P2_CAMPOS = ['text_1gdme', 'text_2uxzv', 'text_3jbws', 'text_4ohsx']


# ─────────────────────────── formatacao ───────────────────────────

def so_digitos(v):
    return re.sub(r'\D', '', str(v or ''))


def fmt_telefone(v):
    d = so_digitos(v)
    if len(d) == 11:
        return f'({d[:2]}) {d[2:7]}-{d[7:]}'
    if len(d) == 10:
        return f'({d[:2]}) {d[2:6]}-{d[6:]}'
    return (v or '').strip()


def fmt_cep(v):
    d = so_digitos(v)
    return f'{d[:5]}-{d[5:]}' if len(d) == 8 else (v or '').strip()


def fmt_cnpj(v):
    d = so_digitos(v)
    if len(d) == 14:
        return f'{d[:2]}.{d[2:5]}.{d[5:8]}/{d[8:12]}-{d[12:]}'
    return (v or '').strip()


def fmt_cpf(v):
    d = so_digitos(v)
    if len(d) == 11:
        return f'{d[:3]}.{d[3:6]}.{d[6:9]}-{d[9:]}'
    return (v or '').strip()


def somente_numero_identidade(v):
    """Identidade nº: apenas o numero, sem orgao emissor/UF."""
    return so_digitos(v)


def fmt_moeda(valor):
    return f'{float(valor):,.2f}'.replace(',', '@').replace('.', ',').replace('@', '.')


# ─────────────────────────── calculo ───────────────────────────

def faixa_idx(idade):
    idx = 0
    for i, m in enumerate(FAIXAS_MIN):
        if idade >= m:
            idx = i
    return idx


def idade_em(nascimento_ddmmyyyy, referencia=None):
    d, m, y = [int(x) for x in str(nascimento_ddmmyyyy).split('/')]
    ref = referencia or date.today()
    return ref.year - y - ((ref.month, ref.day) < (m, d))


def calcular_mensalidade(plano_key, pessoas, mes, ano):
    """Soma o valor da faixa etaria de cada pessoa na data de inicio de vigencia."""
    precos = PLANOS[plano_key]['precos']
    ref = date(int(ano), int(mes), 1)
    total = 0.0
    for p in pessoas:
        nasc = p.get('nascimento')
        if nasc:
            total += precos[faixa_idx(idade_em(nasc, ref))]
    return round(total, 2)


# ─────────────────────────── valor por extenso ───────────────────────────

_UNI = ['', 'UM', 'DOIS', 'TRÊS', 'QUATRO', 'CINCO', 'SEIS', 'SETE', 'OITO', 'NOVE']
_DEZ19 = ['DEZ', 'ONZE', 'DOZE', 'TREZE', 'QUATORZE', 'QUINZE', 'DEZESSEIS', 'DEZESSETE', 'DEZOITO', 'DEZENOVE']
_DEZENA = ['', '', 'VINTE', 'TRINTA', 'QUARENTA', 'CINQUENTA', 'SESSENTA', 'SETENTA', 'OITENTA', 'NOVENTA']
_CENTENA = ['', 'CENTO', 'DUZENTOS', 'TREZENTOS', 'QUATROCENTOS', 'QUINHENTOS', 'SEISCENTOS', 'SETECENTOS', 'OITOCENTOS', 'NOVECENTOS']


def _ate_999(n):
    if n == 0:
        return ''
    if n == 100:
        return 'CEM'
    partes = []
    c, resto = divmod(n, 100)
    if c:
        partes.append(_CENTENA[c])
    if resto:
        if resto < 10:
            partes.append(_UNI[resto])
        elif resto < 20:
            partes.append(_DEZ19[resto - 10])
        else:
            dez, uni = divmod(resto, 10)
            s = _DEZENA[dez]
            if uni:
                s += ' E ' + _UNI[uni]
            partes.append(s)
    return ' E '.join(partes)


def numero_por_extenso(n):
    n = int(n)
    if n == 0:
        return 'ZERO'
    milhar, resto = divmod(n, 1000)
    partes = []
    if milhar:
        partes.append('MIL' if milhar == 1 else _ate_999(milhar) + ' MIL')
    if resto:
        partes.append(_ate_999(resto))
    return ' E '.join(partes) if (milhar and resto and resto < 100) else ' '.join(partes)


def valor_por_extenso(valor):
    valor = round(float(valor) + 1e-9, 2)
    reais = int(valor)
    centavos = int(round((valor - reais) * 100))
    partes = []
    if reais:
        partes.append(numero_por_extenso(reais) + (' REAL' if reais == 1 else ' REAIS'))
    if centavos:
        partes.append(numero_por_extenso(centavos) + (' CENTAVO' if centavos == 1 else ' CENTAVOS'))
    return ' E '.join(partes) if partes else 'ZERO REAIS'


# ─────────────────────────── escrita no PDF ───────────────────────────

_HEX_TJ = re.compile(rb'<([0-9A-Fa-f]+)>\s*Tj')


def _corrigir_texto_hex(stream_obj):
    """Conserta o texto que o pypdf gravou no fluxo de aparencia.

    O pypdf nao consegue montar o mapa de glifos da fonte /Helv deste PDF e cai num
    fallback que grava cada caractere em UTF-16BE (2 bytes). Mas /Helv e uma fonte
    simples, de 1 byte por glifo: o leitor entao trata o byte 0x00 de cada par como um
    glifo proprio e desenha um branco antes de cada letra - era o "R E I N O  D O  A C A I".
    (O poppler ignora esses zeros, por isso o defeito so aparecia no Acrobat/Preview.)

    Alem disso o pypdf escapa '(' ')' '\\' antes de gravar, escape que nao existe em
    string hexadecimal e virava barra visivel no documento.

    Aqui reescrevemos como hexadecimal de 1 byte (cp1252 = WinAnsi), que e o que a fonte
    espera. Em hexadecimal nao existe escape, entao o problema dos parenteses some junto."""
    try:
        data = stream_obj.get_data()
    except Exception:
        return False

    def _fix(m):
        bruto = bytes.fromhex(m.group(1).decode())
        if len(bruto) % 2:
            return m.group(0)
        try:
            txt = bruto.decode('utf-16-be')
        except Exception:
            return m.group(0)
        txt = txt.replace('\\(', '(').replace('\\)', ')').replace('\\\\', '\\')
        try:
            um_byte = txt.encode('cp1252')
        except UnicodeEncodeError:
            return m.group(0)
        return b'<' + um_byte.hex().encode() + b'> Tj'

    novo = _HEX_TJ.sub(_fix, data)
    if novo != data:
        stream_obj.set_data(novo)
        return True
    return False


def _sanear_widgets(page):
    """Conserta o texto dos campos preenchidos (ver _corrigir_texto_hex)."""
    annots = page.get('/Annots')
    if not annots:
        return
    for a in annots:
        o = a.get_object()
        ap = o.get('/AP')
        if ap and '/N' in ap:
            n = ap['/N']
            if hasattr(n, 'get_data'):
                _corrigir_texto_hex(n)


def _achatar(writer):
    """'Queima' os valores preenchidos dentro da propria pagina e remove o formulario.

    E o mesmo formato que a operadora ja recebe hoje (o PDF de exemplo da Sandra nao
    tem AcroForm). Sem campos interativos, cada visualizador (Preview, Acrobat, Chrome)
    desenha exatamente a mesma coisa - acaba o problema de marcacao de radio/checkbox
    que aparecia so em alguns leitores, e ninguem altera o documento sem querer."""
    seq = 0
    for pnum, page in enumerate(writer.pages):
        annots = page.get('/Annots')
        if not annots:
            continue
        for a in annots:
            try:
                o = a.get_object()
            except Exception:
                continue
            if o.get('/Subtype') != '/Widget':
                continue
            ap = o.get('/AP')
            if not ap or '/N' not in ap:
                continue
            alvo = ap['/N'].get_object()
            if not hasattr(alvo, 'get_data'):
                # Dicionario de estados (checkbox/radio): usa o estado atual (/AS).
                # O estado /Off tambem entra - e ele que desenha o circulo/quadrado
                # vazio das opcoes nao escolhidas.
                estado = o.get('/AS')
                if estado is None or estado not in alvo:
                    # Campo que nunca foi tocado nao tem /AS - vale o estado desmarcado,
                    # que e quem desenha o quadradinho/circulo vazio.
                    if '/Off' not in alvo:
                        continue
                    estado = '/Off'
                alvo = alvo[estado].get_object()
            # Alguns fluxos (os quadradinhos de checkbox) nao definem a cor do traco e
            # herdam a cor corrente da pagina - que aqui ja esta branca, deixando o
            # quadrado invisivel. Fixamos preto, que e o estado inicial correto.
            if '/JobEstadoOk' not in alvo:
                try:
                    alvo.set_data(b'0 G 0 g\n' + alvo.get_data())
                    alvo[NameObject('/JobEstadoOk')] = BooleanObject(True)
                except Exception:
                    pass

            rect = [float(x) for x in o['/Rect']]
            seq += 1
            try:
                writer._add_apstream_object(
                    page, alvo, f'ach{pnum}_{seq}', min(rect[0], rect[2]), min(rect[1], rect[3])
                )
            except Exception:
                continue
        del page['/Annots']
    raiz = writer._root_object
    if '/AcroForm' in raiz:
        del raiz['/AcroForm']


def _maiusculas_exceto_email(valores):
    """Tudo em caixa alta, exceto e-mail. Valores de radio/checkbox (comecam com '/')
    precisam bater exatamente com o nome do estado no PDF, entao nao mexemos neles."""
    out = {}
    for k, v in valores.items():
        if isinstance(v, str) and not v.startswith('/') and '@' not in v:
            out[k] = v.strip().upper()
        elif isinstance(v, str):
            out[k] = v.strip()
        else:
            out[k] = v
    return out


# Largura media por caractere em Helvetica (fracao do tamanho da fonte). Maiusculas
# sao mais largas que a media geral - por isso 0.68, para nao subestimar.
_LARGURA_CHAR = 0.68
_TAMANHO_PADRAO = 13.5   # o que o pypdf usa quando o /DA pede tamanho 0 (automatico)
_TAMANHO_MINIMO = 6.0

_BT_ET = re.compile(rb'BT\b.*?\bET\b', re.S)


def _ajustar_fonte_para_caber(page, valores):
    """Reduz o tamanho da fonte quando o texto nao cabe na largura do campo.

    Sem isso o fluxo de aparencia recorta o fim da palavra - foi o que aconteceu com
    'SELECTION CE 200 STANDARD', que saiu como 'SELECTION CE 200'. Calculamos um
    tamanho explicito em vez de usar 0 (automatico), porque o automatico do pypdf
    escolhe 13.5 e pode acabar MAIOR que o tamanho original do formulario."""
    annots = page.get('/Annots')
    if not annots:
        return
    for a in annots:
        try:
            o = a.get_object()
        except Exception:
            continue
        nome = o.get('/T')
        if nome not in valores:
            continue
        texto = valores[nome]
        if not isinstance(texto, str) or texto.startswith('/') or not texto:
            continue
        da = o.get('/DA')
        if not da:
            continue
        m = re.search(r'/(\S+)\s+([\d.]+)\s+Tf', str(da))
        if not m:
            continue
        atual = float(m.group(2)) or _TAMANHO_PADRAO
        rect = [float(x) for x in o['/Rect']]
        largura_util = abs(rect[2] - rect[0]) - 4
        precisa = len(texto) * _LARGURA_CHAR * atual
        if precisa <= largura_util:
            continue
        cabe = largura_util / (len(texto) * _LARGURA_CHAR)
        novo_tam = max(_TAMANHO_MINIMO, min(atual, round(cabe, 1)))
        novo_da = str(da).replace(m.group(0), f'/{m.group(1)} {novo_tam} Tf')
        o[NameObject('/DA')] = TextStringObject(novo_da)


def _capturar_aparencias(page):
    """Guarda o desenho original de cada campo - e ele que traz a BORDA (o 'caixote')
    que aparece em volta dos campos no formulario."""
    orig = {}
    for a in page.get('/Annots') or []:
        try:
            o = a.get_object()
        except Exception:
            continue
        nome = o.get('/T')
        ap = o.get('/AP')
        if nome is None or not ap or '/N' not in ap:
            continue
        n = ap['/N'].get_object()
        if hasattr(n, 'get_data'):
            try:
                orig[str(nome)] = n.get_data()
            except Exception:
                pass
    return orig


def _restaurar_bordas(page, orig):
    """O pypdf REESCREVE o desenho do campo ao preencher, e o desenho novo tem so o
    texto - a borda do campo se perde e o documento fica visualmente diferente do
    original. Aqui redesenhamos a borda original por baixo do texto novo."""
    for a in page.get('/Annots') or []:
        try:
            o = a.get_object()
        except Exception:
            continue
        nome = o.get('/T')
        ap = o.get('/AP')
        if nome is None or str(nome) not in orig or not ap or '/N' not in ap:
            continue
        n = ap['/N'].get_object()
        if not hasattr(n, 'get_data'):
            continue
        try:
            novo = n.get_data()
        except Exception:
            continue
        antigo = orig[str(nome)]
        if novo == antigo or b'/JobBorda' in novo:
            continue
        # Do desenho original aproveitamos so o contorno; qualquer texto que houvesse
        # nele e descartado para nao duplicar conteudo.
        so_contorno = _BT_ET.sub(b'', antigo).strip()
        if not so_contorno:
            continue
        n.set_data(b'q\n' + so_contorno + b'\nQ\n/JobBorda\n' + novo)


def _fill(src, dst, valores_por_pagina, achatar=True):
    """dst pode ser um caminho (str) ou um buffer em memoria (BytesIO).

    Em producao usamos BytesIO: o diretorio da aplicacao no Railway e efemero, entao
    gravar PDF de cliente em disco ali e perder o arquivo no proximo deploy - e deixar
    dado pessoal no container enquanto isso."""
    reader = PdfReader(src)
    writer = PdfWriter()
    writer.append(reader)
    for pnum, valores in valores_por_pagina.items():
        pagina = writer.pages[pnum]
        valores = _maiusculas_exceto_email(valores)
        aparencias = _capturar_aparencias(pagina)
        _ajustar_fonte_para_caber(pagina, valores)
        writer.update_page_form_field_values(pagina, valores, auto_regenerate=False)
        _sanear_widgets(pagina)
        _restaurar_bordas(pagina, aparencias)
    if achatar:
        _achatar(writer)
    if hasattr(dst, 'write'):
        writer.write(dst)
    else:
        with open(dst, 'wb') as f:
            writer.write(f)
    return dst


# ─────────────────────────── Folha de Rosto / Proposta ───────────────────────────

def validar(dados):
    """Devolve lista de erros que impedem a geracao."""
    erros = []
    emp = dados.get('empresa', {})
    if not so_digitos(emp.get('telefone')):
        erros.append('Telefone da empresa e obrigatorio.')
    if not (emp.get('email') or '').strip():
        erros.append('E-mail da empresa e obrigatorio.')
    if not (emp.get('razao_social') or '').strip():
        erros.append('Razao social e obrigatoria.')
    if not (dados.get('representante', {}).get('nome') or '').strip():
        erros.append('Representante legal e obrigatorio.')
    if not dados.get('titulares'):
        erros.append('E preciso ao menos 1 titular.')
    vig = dados.get('vigencia', {})
    if vig.get('vencimento') not in VENCIMENTO_FOLHA1:
        erros.append('Dia de vencimento da mensalidade e obrigatorio.')
    if not vig.get('mes') or not vig.get('ano'):
        erros.append('Mes/ano de inicio de vigencia sao obrigatorios.')
    return erros


def preencher_folha(dados, caminho_saida):
    empresa = dados['empresa']
    rep = dados['representante']
    plano_key = dados['plano']['produto']
    plano = PLANOS[plano_key]
    vig = dados['vigencia']
    pag = dados.get('pagamento', {})
    carencia = bool(dados.get('carencia_outra_operadora'))
    corr = dados.get('endereco_correspondencia') or {}
    agente = _agente(dados)

    mes = int(vig['mes'])
    ano = str(vig['ano'])

    p0 = {
        'RAZÃO SOCIAL': empresa['razao_social'],
        'NOME FANTASIA': empresa.get('nome_fantasia', ''),
        'FONES': fmt_telefone(empresa.get('telefone')),
        'EMAIL': (empresa.get('email') or '').strip(),
        # Endereco da empresa: SEMPRE o do cartao CNPJ.
        'ENDEREÇO': empresa['endereco'],
        'N': empresa.get('numero', ''),
        'COMPL': empresa.get('complemento', ''),
        'BAIRRO': empresa['bairro'],
        'CEP': fmt_cep(empresa.get('cep')),
        'CIDADE': empresa['cidade'],
        'CONTATO': empresa.get('contato', ''),
        'CORRETORA PJ': agente['nome'],
        'TELEFONES': agente['cpf'],
        'CORRETORA PF': agente['telefone'],
        'Produto': plano['nome_folha'],
        'Número de vidas': str(dados['plano']['vidas']),
        '01 de': MESES[mes - 1],
        'de': ano,
        'Folha1Group1': '/Folha1Choice1' if pag.get('recebeu') else '/Folha1Choice2',
        'Folha1Group2': '/Folha1Choice3' if carencia else '/Folha1Choice1',
        'Folha1Group3': VENCIMENTO_FOLHA1[vig['vencimento']],
    }
    # Endereco de correspondencia: o endereco pessoal informado no bloco de notas.
    if corr.get('endereco'):
        p0['ENDEREÇO DE CORRESPONDÊNCIA'] = corr.get('endereco', '')
        p0['N_2'] = corr.get('numero', '')
        p0['COMPL_2'] = corr.get('complemento', '')
        p0['BAIRRO_2'] = corr.get('bairro', '')
        p0['CEP_2'] = fmt_cep(corr.get('cep'))
        p0['CIDADE_2'] = corr.get('cidade', '')

    # O valor da mensalidade vai SEMPRE preenchido (marcando SIM ou NAO no item 5).
    valor = pag.get('valor') or 0
    if valor:
        p0['VALOR R'] = fmt_moeda(valor)
    if pag.get('valor_migracoes'):
        p0['R'] = fmt_moeda(pag['valor_migracoes'])

    # Pagina 2: migracoes (so preenche se houver).
    p1 = {'CORRETOR  RESPONSÁVEL': agente['nome']}
    campos_mig = [f'Folha2Text{i}' for i in range(2, 32)]
    for i, m in enumerate((dados.get('migracoes') or [])[:10]):
        base = i * 3
        p1[campos_mig[base]] = m.get('nome', '')
        p1[campos_mig[base + 1]] = fmt_moeda(m.get('valor', 0))
        p1[campos_mig[base + 2]] = m.get('observacao', '')

    # Pagina 3: contrato. Endereco SEMPRE o da empresa (cartao CNPJ).
    p2 = {
        'Text2': f'01/{mes:02d}/{ano}',
        'Text3': empresa['razao_social'],
        'Text4': fmt_cnpj(empresa.get('cnpj')),
        'Text5': f"{empresa['endereco']}, {empresa.get('numero', '')}".strip(', '),
        'Text6': empresa['bairro'],
        'Text7': empresa['cidade'],
        'Text8': empresa['uf'],
        'Text9': fmt_cep(empresa.get('cep')),
        'Text10': rep['nome'],
        'Text11': somente_numero_identidade(rep.get('identidade')),
        'Text12': fmt_cpf(rep.get('cpf')),
        plano['p2']: '/Yes',
        'Group17': VENCIMENTO_GROUP17[vig['vencimento']],
        CHECKBOX_EX_EMPREGADOS: '/Yes',
    }
    rep2 = dados.get('representante_2') or {}
    if rep2.get('nome'):
        p2['Text15'] = rep2['nome']
        p2['Text13'] = somente_numero_identidade(rep2.get('identidade'))
        p2['Text14'] = fmt_cpf(rep2.get('cpf'))

    p3 = {plano['p3']: '/Yes'}
    p4 = {
        plano['p4']: '/Yes',
        'Text32': f'{mes:02d}/{ano}',
        'Text33': agente['nome'],
        'Text34': agente['cpf'],
    }

    # Pagina 6 (RECIBO) fica SEMPRE em branco - por decisao do corretor.
    return _fill(FOLHA_TEMPLATE, caminho_saida, {0: p0, 1: p1, 2: p2, 3: p3, 4: p4})


# ─────────────────────────── Ficha de Inclusao ───────────────────────────

DEP_CAMPOS = [
    ('FichaInc1Text22', 'FichaInc1Text23', 'FichaInc1Text24', 'FichaInc1Text25', 'FichaInc1Text26',
     'FichaInc1Text27', 'FichaInc1Text28', 'FichaInc1Text29', 'FichaInc1Text30'),
    ('FichaInc1Text31', 'FichaInc1Text32', 'FichaInc1Text33', 'FichaInc1Text34', 'FichaInc1Text35',
     'FichaInc1Text36', 'FichaInc1Text37', 'FichaInc1Text38', 'FichaInc1Text39'),
    ('FichaInc1Text40', 'FichaInc1Text41', 'FichaInc1Text42', 'FichaInc1Text43', 'FichaInc1Text44',
     'FichaInc1Text46', 'FichaInc1Text47', 'FichaInc1Text48', 'FichaInc1Text49'),
]


def _saude_texto(pessoa):
    """Pagina 2 da Ficha: data da entrevista medica OU a palavra PORTABILIDADE."""
    if pessoa.get('portabilidade'):
        return 'PORTABILIDADE'
    return (pessoa.get('data_entrevista') or '').strip()


def preencher_ficha(empresa_nome, titular, dependentes, data_inclusao, cidade, plano_key,
                    acomodacao, caminho_saida, inclusao_apenas_dependente=False):
    plano = PLANOS[plano_key]
    d, m, y = data_inclusao.split('/')
    p0 = {
        'FichaInc1Group2': '/FichaInc1Choice2' if inclusao_apenas_dependente else '/FichaInc1Choice1',
        'FichaInc1Text2': data_inclusao,
        'FichaInc1Text3': empresa_nome,
        'FichaInc1Text4': titular['nome'],
        'FichaInc1Text5': fmt_cpf(titular.get('cpf')),
        'FichaInc1Text6': titular.get('rg', ''),
        'FichaInc1Text7': titular.get('nascimento', ''),
        'FichaInc1Text8': titular.get('sexo', ''),
        'FichaInc1Text9': titular.get('mae', ''),
        'FichaInc1Text10': titular.get('sus', ''),
        'FichaInc1Text11': titular.get('estado_civil', ''),
        'FichaInc1Text12': titular.get('endereco', ''),
        'FichaInc1Text13': titular.get('numero', ''),
        'FichaInc1Text14': titular.get('complemento', ''),
        'FichaInc1Text15': titular.get('bairro', ''),
        'FichaInc1Text16': titular.get('cidade', ''),
        'FichaInc1Text17': titular.get('uf', ''),
        'FichaInc1Text18': fmt_cep(titular.get('cep')),
        'FichaInc1Text19': fmt_telefone(titular.get('telefone1')),
        'FichaInc1Text20': fmt_telefone(titular.get('telefone2')) if titular.get('telefone2') else '',
        'FichaInc1Text21': (titular.get('email') or '').strip(),
        'FichaInc1Group1': plano['ficha_choice'],
        'FichaInc1Group3': ACOMODACAO_FICHA[acomodacao],
        'FichaInc1Text50': cidade,
        'FichaInc1Text51': d,
        'FichaInc1Text52': m,
        'FichaInc1Text53': y,
    }
    for i, dep in enumerate(dependentes[:3]):
        c = DEP_CAMPOS[i]
        p0[c[0]] = dep['nome']
        p0[c[1]] = dep.get('mae', '')
        p0[c[2]] = dep.get('estado_civil', '')
        p0[c[3]] = fmt_cpf(dep.get('cpf'))
        p0[c[4]] = dep.get('rg', '')
        p0[c[5]] = dep.get('nascimento', '')
        p0[c[6]] = dep.get('sexo', '')
        p0[c[7]] = dep.get('parentesco', '')
        p0[c[8]] = dep.get('sus', '')

    # Pagina 2: data da entrevista medica ou PORTABILIDADE, por pessoa.
    p1 = {}
    texto_titular = _saude_texto(titular)
    if texto_titular:
        p1[FICHA_P2_CAMPOS[0]] = texto_titular
    for i, dep in enumerate(dependentes[:3]):
        texto = _saude_texto(dep)
        if texto:
            p1[FICHA_P2_CAMPOS[i + 1]] = texto

    paginas = {0: p0}
    if p1:
        paginas[1] = p1
    return _fill(FICHA_TEMPLATE, caminho_saida, paginas)


def gerar_fichas(empresa_nome, titulares, data_inclusao, cidade, plano_key, acomodacao,
                 prefixo_arquivo, saida_dir):
    """1 ficha por titular. Se o titular tiver mais de 3 dependentes, duplica a ficha dele.
    Versao em disco - usada pela ferramenta local. Em producao use gerar_tudo_memoria()."""
    arquivos = []
    for nome_arq, _ in _plano_de_fichas(titulares, prefixo_arquivo):
        arquivos.append(os.path.join(saida_dir, nome_arq))
    i = 0
    for t in titulares:
        deps = list(t.get('dependentes') or [])
        chunks = [deps[i2:i2 + 3] for i2 in range(0, len(deps), 3)] or [[]]
        for idx, chunk in enumerate(chunks):
            preencher_ficha(empresa_nome, t['titular'], chunk, data_inclusao, cidade,
                            plano_key, acomodacao, arquivos[i],
                            inclusao_apenas_dependente=(idx > 0))
            i += 1
    return arquivos


def _plano_de_fichas(titulares, prefixo_arquivo):
    """Devolve [(nome_do_arquivo, (titular, dependentes_do_lote, eh_continuacao))].
    Uma ficha por titular; se passar de 3 dependentes, a ficha dele e duplicada."""
    itens = []
    contador = 1
    for t in titulares:
        deps = list(t.get('dependentes') or [])
        chunks = [deps[i:i + 3] for i in range(0, len(deps), 3)] or [[]]
        for idx, chunk in enumerate(chunks):
            nome = str(t['titular']['nome']).upper().replace(' ', '_')[:40]
            itens.append((f'{prefixo_arquivo}_Ficha_{contador:02d}_{nome}.pdf',
                          (t['titular'], chunk, idx > 0)))
            contador += 1
    return itens


def gerar_tudo_memoria(dados):
    """Gera a Proposta e todas as Fichas SEM tocar em disco.

    Devolve [(nome_do_arquivo, bytes)]. E o que a rota do JOB usa: o PDF vai direto do
    processo para o navegador do corretor, sem passar por disco do container."""
    from io import BytesIO

    erros = validar(dados)
    if erros:
        raise ValueError(' | '.join(erros))

    empresa = dados['empresa']
    prefixo = str(empresa['razao_social']).upper().split(',')[0].replace(' ', '_')[:40]
    prefixo = re.sub(r'[^A-Z0-9_]', '', prefixo) or 'PROPOSTA'

    saida = []

    buf = BytesIO()
    preencher_folha(dados, buf)
    saida.append((f'{prefixo}_Proposta.pdf', buf.getvalue()))

    vig = dados['vigencia']
    data_inclusao = f"01/{int(vig['mes']):02d}/{vig['ano']}"
    cidade = empresa.get('cidade', '')
    for nome_arq, (titular, deps, continuacao) in _plano_de_fichas(dados['titulares'], prefixo):
        b = BytesIO()
        preencher_ficha(empresa['razao_social'], titular, deps, data_inclusao, cidade,
                        dados['plano']['produto'], dados['plano']['acomodacao'], b,
                        inclusao_apenas_dependente=continuacao)
        saida.append((nome_arq, b.getvalue()))

    return saida
