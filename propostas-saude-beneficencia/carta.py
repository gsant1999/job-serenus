"""Carta de cancelamento do contrato anterior, para as vendas administrativas.

Quando a vida ja esta na Beneficencia e vai para um contrato novo, a operadora precisa
de um pedido escrito para encerrar o contrato antigo - senao a pessoa fica com duas
apolices e a migracao trava. A carta vai na CAPA do contrato, antes da proposta.

Quem assina e o titular do CONTRATO ANTERIOR, que nem sempre e o titular do novo: no
caso comum a esposa era titular do plano da familia e passa a dependente do marido.

Documento nosso, nao formulario da operadora - por isso e gerado do zero, e nao
preenchendo PDF pronto como o resto do sistema.
"""
import io
import datetime

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

MARGEM = 25 * mm
LARGURA, ALTURA = A4

MESES = ('janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
         'agosto', 'setembro', 'outubro', 'novembro', 'dezembro')

# Como o contrato antigo e descrito na carta. A operadora trata os dois casos do mesmo
# jeito, mas o texto precisa bater com o que a pessoa tem em maos.
ORIGENS = {
    'pf': 'plano individual/familiar',
    'empresarial': 'plano coletivo empresarial',
}


def _data_extenso(hoje=None):
    d = hoje or datetime.date.today()
    return f'{d.day} de {MESES[d.month - 1]} de {d.year}'


def _quebrar(texto, fonte, tamanho, largura, c):
    """Quebra o paragrafo na largura util. O reportlab nao quebra linha sozinho."""
    palavras, linhas, atual = texto.split(), [], ''
    for p in palavras:
        teste = (atual + ' ' + p).strip()
        if c.stringWidth(teste, fonte, tamanho) <= largura:
            atual = teste
        else:
            if atual:
                linhas.append(atual)
            atual = p
    if atual:
        linhas.append(atual)
    return linhas


def gerar(dados, hoje=None):
    """Devolve os bytes do PDF, ou None se este caso nao pede carta.

    Espera em dados['contrato_anterior']:
        {titular: {nome, cpf}, origem: 'pf'|'empresarial', numero: str, operadora: str}
    e usa dados['migracoes'] para listar quem sai junto.
    """
    ant = (dados.get('contrato_anterior') or {})
    titular_ant = (ant.get('titular') or {})
    if not (titular_ant.get('nome') or '').strip():
        return None            # sem quem assine, nao ha carta

    empresa = dados.get('empresa') or {}
    vig = dados.get('vigencia') or {}
    largura_util = LARGURA - 2 * MARGEM

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle('Solicitação de cancelamento de contrato')
    y = ALTURA - MARGEM

    def escrever(texto, fonte='Helvetica', tamanho=11, espaco=15, recuo=0):
        nonlocal y
        for linha in _quebrar(texto, fonte, tamanho, largura_util - recuo, c):
            c.setFont(fonte, tamanho)
            c.drawString(MARGEM + recuo, y, linha)
            y -= espaco

    def pular(n=1):
        nonlocal y
        y -= 15 * n

    cidade = empresa.get('cidade') or 'Campinas'
    escrever(f'{cidade.title()}, {_data_extenso(hoje)}', tamanho=11)
    pular(2)

    escrever('À', fonte='Helvetica-Bold')
    escrever(ant.get('operadora') or 'ASSOCIAÇÃO DE SAÚDE PORTUGUESA DE BENEFICÊNCIA',
             fonte='Helvetica-Bold')
    pular()
    escrever('Ref.: Solicitação de cancelamento de contrato', fonte='Helvetica-Bold')
    pular(2)

    numero = (ant.get('numero') or '').strip()
    origem = ORIGENS.get(ant.get('origem'), ORIGENS['empresarial'])
    ident = f', de nº {numero},' if numero else ''

    escrever(
        f"Eu, {titular_ant.get('nome', '').upper()}, inscrito(a) no CPF sob o nº "
        f"{titular_ant.get('cpf', '')}, na qualidade de titular do {origem}{ident} "
        f"mantido junto a essa operadora, venho por meio desta solicitar o CANCELAMENTO "
        f"do referido contrato.")
    pular()

    escrever(
        f"O pedido decorre da minha migração para o plano coletivo empresarial "
        f"contratado pela empresa {empresa.get('razao_social', '').upper()}, inscrita no "
        f"CNPJ sob o nº {empresa.get('cnpj', '')}, com início de vigência previsto para "
        f"{vig.get('mes', '')}/{vig.get('ano', '')}.")
    pular()

    escrever(
        'Solicito que o encerramento seja processado de forma a não haver interrupção '
        'de cobertura entre um contrato e outro.')
    pular()

    # Dependentes que saem junto. Sem isso a operadora cancela so o titular e os
    # demais ficam pendurados no contrato antigo.
    migrantes = [m for m in (dados.get('migracoes') or []) if m.get('nome')]
    outros = [m for m in migrantes
              if m.get('nome', '').strip().upper() != titular_ant.get('nome', '').strip().upper()]
    if outros:
        escrever('O cancelamento abrange também os seguintes beneficiários vinculados '
                 'ao contrato:')
        pular(0.4)
        for m in outros:
            partes = [m.get('nome', '').upper()]
            if m.get('cpf'):
                partes.append(f"CPF {m['cpf']}")
            if m.get('nascimento'):
                partes.append(f"nascido(a) em {m['nascimento']}")
            if m.get('parentesco'):
                partes.append(str(m['parentesco']).lower())
            escrever('•  ' + ' — '.join(partes), tamanho=10.5, espaco=14, recuo=8)
        pular()

    escrever('Sem mais para o momento, coloco-me à disposição para os esclarecimentos '
             'que se fizerem necessários.')
    pular(3)

    c.line(MARGEM, y, MARGEM + 75 * mm, y)
    y -= 14
    c.setFont('Helvetica-Bold', 11)
    c.drawString(MARGEM, y, titular_ant.get('nome', '').upper())
    y -= 14
    c.setFont('Helvetica', 10)
    c.drawString(MARGEM, y, f"CPF {titular_ant.get('cpf', '')}")

    c.showPage()
    c.save()
    buf.seek(0)
    return buf.getvalue()
