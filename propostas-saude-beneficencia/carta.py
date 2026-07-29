"""Carta de cancelamento do contrato anterior, para as vendas administrativas.

Quando a vida ja esta na Beneficencia e vai para um contrato novo, a operadora precisa
de um pedido escrito para encerrar o contrato antigo - senao a pessoa fica com duas
apolices e a migracao trava. A carta vai na CAPA do contrato, antes da proposta.

O TEXTO E O QUE A OPERADORA PASSOU. Nao inventar redacao aqui: carta fora do modelo
volta da analise. Dois pontos do modelo que parecem detalhe e nao sao:

  - "sem a imposicao de eventuais multas contratuais ou permanencia minima" - e o que
    evita cobranca de multa por sair antes do prazo;
  - "estou migrando parte das vidas para um novo CNPJ" - e a justificativa que
    enquadra o pedido como venda administrativa em vez de cancelamento comum.

Quem assina e o REPRESENTANTE LEGAL DA EMPRESA do contrato anterior - nao o titular
pessoa fisica. Quando o contrato antigo e individual/familiar nao ha empresa, e o
texto muda para a pessoa falando por si.

Documento nosso, nao formulario da operadora - por isso e gerado do zero.
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


def _data_extenso(d):
    return f'{d.day} de {MESES[d.month - 1]} de {d.year}'


def _quebrar(texto, fonte, tamanho, largura, c):
    """Quebra o paragrafo na largura util - o reportlab nao quebra linha sozinho."""
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
        {titular: {nome, cpf}, empresa: {razao_social, cnpj}, origem: 'pf'|'empresarial'}
    """
    ant = dados.get('contrato_anterior') or {}
    quem = ant.get('titular') or {}
    if not (quem.get('nome') or '').strip():
        return None            # sem quem assine, nao ha carta

    empresa_ant = ant.get('empresa') or {}
    empresarial = (ant.get('origem') or 'empresarial') == 'empresarial'
    empresa_nova = dados.get('empresa') or {}
    vig = dados.get('vigencia') or {}
    largura_util = LARGURA - 2 * MARGEM

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    c.setTitle('Solicitação de cancelamento de contrato')
    y = ALTURA - MARGEM - 20 * mm

    def escrever(texto, fonte='Helvetica', tamanho=12, espaco=18, recuo=0):
        nonlocal y
        for linha in _quebrar(texto, fonte, tamanho, largura_util - recuo, c):
            c.setFont(fonte, tamanho)
            c.drawString(MARGEM + recuo, y, linha)
            y -= espaco

    def pular(n=1):
        nonlocal y
        y -= 18 * n

    # A data do cancelamento e o inicio de vigencia do contrato novo: um encerra no
    # dia em que o outro comeca, para nao haver dia sem cobertura.
    mes, ano = vig.get('mes') or '', vig.get('ano') or ''
    data_cancelamento = f'01/{mes}/{ano}' if mes and ano else ''

    # --- corpo, no texto da operadora -------------------------------------------
    if empresarial:
        corpo = (f"Eu, {quem.get('nome', '').upper()} portador do CPF Nº "
                 f"{quem.get('cpf', '')}, representante legal da empresa "
                 f"{(empresa_ant.get('razao_social') or '').upper()}, CNPJ "
                 f"{empresa_ant.get('cnpj', '')}, solicito o cancelamento do meu "
                 f"contrato para {data_cancelamento} sem a imposição de eventuais "
                 f"multas contratuais ou permanência mínima, pois, estou migrando "
                 f"parte das vidas para um novo CNPJ e incluindo novas vidas.")
    else:
        # Individual/familiar: nao ha empresa nem representante legal, mas o pedido e
        # o mesmo - inclusive a dispensa de multa e de permanencia minima.
        corpo = (f"Eu, {quem.get('nome', '').upper()} portador do CPF Nº "
                 f"{quem.get('cpf', '')}, titular do plano individual/familiar mantido "
                 f"junto a essa operadora, solicito o cancelamento do meu contrato para "
                 f"{data_cancelamento} sem a imposição de eventuais multas contratuais "
                 f"ou permanência mínima, pois, estou migrando para o plano coletivo "
                 f"empresarial da empresa {(empresa_nova.get('razao_social') or '').upper()}, "
                 f"CNPJ {empresa_nova.get('cnpj', '')}.")

    escrever(corpo)
    pular()

    # Quem sai junto. Nao esta no modelo da operadora, mas sem isso ela cancela so
    # quem assinou e os demais ficam pendurados no contrato antigo.
    migrantes = [m for m in (dados.get('migracoes') or []) if m.get('nome')]
    if migrantes:
        escrever('Seguem as vidas que migram:', tamanho=11.5)
        pular(0.3)
        for m in migrantes:
            partes = [m.get('nome', '').upper()]
            if m.get('cpf'):
                partes.append(f"CPF {m['cpf']}")
            if m.get('nascimento'):
                partes.append(f"nascido(a) em {m['nascimento']}")
            escrever('•  ' + ' — '.join(partes), tamanho=11, espaco=16, recuo=10)
        pular()

    cidade = (empresa_nova.get('cidade') or 'Campinas').title()
    escrever(f'{cidade}, {_data_extenso(hoje or datetime.date.today())}.')
    pular(3)

    # Linha de assinatura no formato do modelo
    c.setFont('Helvetica', 12)
    rodape = ('__________(assinatura do representante da empresa)_______________'
              if empresarial else '__________(assinatura do titular)_______________')
    c.drawString(MARGEM, y, rodape)
    y -= 18
    c.setFont('Helvetica-Bold', 11)
    c.drawString(MARGEM, y, quem.get('nome', '').upper())
    y -= 14
    c.setFont('Helvetica', 10)
    c.drawString(MARGEM, y, f"CPF {quem.get('cpf', '')}")

    c.showPage()
    c.save()
    buf.seek(0)
    return buf.getvalue()
