"""Monta o contrato final: junta os PDFs que o sistema gera com os documentos que o
cliente envia, na ordem exata que a Saude Beneficencia espera.

Ordem (ditada pelo corretor, conferida contra o contrato real do REINO DO ACAI):

    1. Proposta de Adesao ............. gerada pelo sistema
    2. Cartao CNPJ .................... enviado
    3. Contrato social OU CCMEI ....... enviado (CCMEI quando a empresa e MEI)
    4. Documento do dono da empresa ... enviado

    Por titular (repete o bloco):
    5. Ficha de Inclusao .............. gerada pelo sistema
    6. Documento do titular ........... enviado (RG, CPF e/ou CNH)
    7. Documento dos dependentes ...... enviado (RG, CPF e/ou CNH; certidao de
                                        nascimento quando a crianca nao tem nenhum)
    8. Comprovante de endereco ........ enviado, obrigatorio

    9. Comprovacao de vinculo ......... enviado, SEMPRE por ultimo e SO quando o
                                        titular nao e o dono do CNPJ (se for o dono,
                                        o contrato social ja comprova)

Aceita PDF e imagem (foto de documento). Imagem vira pagina PDF no tamanho A4.
"""
import io
import os

from pypdf import PdfReader, PdfWriter

# A4 em pontos PDF (1 ponto = 1/72 pol)
A4_LARGURA, A4_ALTURA = 595.28, 841.89
# Densidade da folha gerada a partir de foto. A folha e montada em pixels nessa
# densidade e salva declarando o mesmo DPI - e o que faz o PDF sair no tamanho A4
# de verdade. Montar em pixels de 72 dpi e salvar a 150 encolhe a pagina para 1/2.
#
# 130 e o ponto de equilibrio medido: derruba a pagina de foto de 269 KB para 179 KB
# (-33%) e um RG fotografado ainda chega ao analista com ~190 DPI no documento -
# acima dos 150 DPI que OCR e leitura humana pedem. Descer mais economiza centavos
# de armazenamento e arrisca o que custa caro: proposta recusada por ilegibilidade.
DPI_FOLHA = int(os.environ.get('COMPRESSAO_DPI', '130'))
# Qualidade do JPEG dentro do PDF. 80 nao deixa artefato visivel em texto impresso.
QUALIDADE_JPEG = int(os.environ.get('COMPRESSAO_JPEG', '80'))
A4_PX = (int(A4_LARGURA / 72 * DPI_FOLHA), int(A4_ALTURA / 72 * DPI_FOLHA))

EXT_IMAGEM = {'.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.bmp', '.tif', '.tiff'}

# Etapas do contrato, na ordem. 'chave' e o nome do campo que a interface envia.
ETAPAS_EMPRESA = [
    ('cartao_cnpj', 'Cartão CNPJ', True),
    ('contrato_social', 'Contrato social ou CCMEI', True),
    ('doc_dono', 'Documento do dono da empresa', True),
]
ETAPAS_TITULAR = [
    ('doc_titular', 'Documento do titular', True),
    ('doc_dependentes', 'Documento dos dependentes', False),
    ('comprovante_endereco', 'Comprovante de endereço', True),
]
ETAPA_VINCULO = ('vinculo', 'Comprovação de vínculo com a empresa', False)


def _imagem_para_pdf(dados):
    """Converte foto de documento em uma pagina A4, preservando a proporcao.

    O Pillow so entra aqui - se a pessoa mandar so PDF, nem e importado."""
    from PIL import Image, ImageOps

    im = Image.open(io.BytesIO(dados))
    # Fotos de celular trazem a rotacao no EXIF; sem isso o documento sai deitado.
    im = ImageOps.exif_transpose(im)
    if im.mode not in ('RGB', 'L'):
        im = im.convert('RGB')

    # Documento mais largo que alto (foto deitada) entra em paisagem, senao a CNH
    # fica minuscula no meio de uma folha em pe.
    alvo = A4_PX if im.height >= im.width else (A4_PX[1], A4_PX[0])

    escala = min(alvo[0] / im.width, alvo[1] / im.height)
    # Nunca amplia: ampliar foto de documento so borra e engorda o arquivo.
    escala = min(escala, 1.0)
    largura, altura = max(1, int(im.width * escala)), max(1, int(im.height * escala))
    im = im.resize((largura, altura), Image.LANCZOS)

    folha = Image.new('RGB', alvo, 'white')
    folha.paste(im, ((alvo[0] - largura) // 2, (alvo[1] - altura) // 2))

    buf = io.BytesIO()
    folha.save(buf, format='PDF', resolution=float(DPI_FOLHA),
               quality=QUALIDADE_JPEG, optimize=True)
    buf.seek(0)
    return buf.getvalue()


def _para_paginas(nome_arquivo, dados):
    """Devolve um PdfReader com o conteudo, seja ele PDF ou imagem."""
    ext = os.path.splitext(nome_arquivo or '')[1].lower()
    if ext in EXT_IMAGEM:
        dados = _imagem_para_pdf(dados)
    elif dados[:5] != b'%PDF-':
        # Extensao desconhecida: decide pelo conteudo, nao pelo nome do arquivo.
        dados = _imagem_para_pdf(dados)
    return PdfReader(io.BytesIO(dados))


def montar(gerados, anexos, titular_e_dono, exigidos=None):
    """Monta o contrato final.

    gerados:  {'proposta': bytes, 'fichas': [bytes, ...]}  - saida do motor
    anexos:   {chave: [(nome_arquivo, bytes), ...]}        - o que o corretor subiu
    titular_e_dono: bool - se True, a comprovacao de vinculo nao entra
    exigidos: [{'chave','rotulo'}] obrigatorios DESTE caso, vindo de regras.checklist()

    'exigidos' existe porque a lista de comprovacoes de parentesco depende de quem sao
    os dependentes - isso e regra de negocio e mora em regras.py. Sem receber a lista,
    esta funcao so sabia cobrar o que esta fixo aqui em cima, e um conjuge sem certidao
    de casamento passava batido: o checklist da tela cobrava e o contrato nao reclamava.

    Devolve (bytes_do_pdf, roteiro) onde roteiro descreve o que entrou e o que faltou,
    para a interface mostrar ao corretor antes de ele mandar para a operadora.
    """
    escritor = PdfWriter()
    roteiro = []

    def _juntar(rotulo, itens):
        if not itens:
            return 0
        total = 0
        for nome, dados in itens:
            try:
                leitor = _para_paginas(nome, dados)
            except Exception as e:
                roteiro.append({'etapa': rotulo, 'arquivo': nome, 'ok': False,
                                'detalhe': f'nao foi possivel ler: {e}'})
                continue
            for pag in leitor.pages:
                escritor.add_page(pag)
            total += len(leitor.pages)
            roteiro.append({'etapa': rotulo, 'arquivo': nome, 'ok': True,
                            'paginas': len(leitor.pages)})
        return total

    # 0. Carta de cancelamento do contrato anterior (so nas vendas administrativas).
    # Vai na CAPA porque e o pedido que autoriza a operadora a encerrar a apolice
    # antiga - o analista precisa ver antes de abrir a proposta.
    if gerados.get('carta'):
        _juntar('Carta de cancelamento do contrato anterior',
                [('Carta.pdf', gerados['carta'])])

    # 1. Proposta de Adesao
    _juntar('Proposta de Adesão', [('Proposta.pdf', gerados['proposta'])])

    # 2 a 4. Documentos da empresa
    for chave, rotulo, obrigatorio in ETAPAS_EMPRESA:
        itens = anexos.get(chave) or []
        if not itens and obrigatorio:
            roteiro.append({'etapa': rotulo, 'arquivo': None, 'ok': False,
                            'detalhe': 'faltando'})
        _juntar(rotulo, itens)

    # 5 a 8. Um bloco por titular: ficha + documentos + comprovante
    fichas = gerados.get('fichas') or []
    for i, ficha in enumerate(fichas):
        sufixo = f' (titular {i + 1})' if len(fichas) > 1 else ''
        _juntar(f'Ficha de Inclusão{sufixo}', [(f'Ficha_{i + 1}.pdf', ficha)])
        for chave, rotulo, obrigatorio in ETAPAS_TITULAR:
            # Com mais de um titular, a interface manda doc_titular_1, doc_titular_2...
            itens = anexos.get(f'{chave}_{i + 1}') or (anexos.get(chave) if i == 0 else None) or []
            if not itens and obrigatorio:
                roteiro.append({'etapa': f'{rotulo}{sufixo}', 'arquivo': None, 'ok': False,
                                'detalhe': 'faltando'})
            _juntar(f'{rotulo}{sufixo}', itens)

            # Logo depois dos documentos dos dependentes entram os papeis que provam o
            # parentesco (certidao de casamento, uniao estavel, certidao de nascimento).
            # Ficam colados no bloco do dependente para o analista da operadora ler o
            # vinculo sem folhear o contrato inteiro atras da certidao.
            if chave == 'doc_dependentes':
                enviados = [k for k in sorted(anexos)
                            if k.startswith('parentesco_') or k == 'certidao_crianca']
                for k in enviados:
                    _juntar(f'Comprovação de parentesco{sufixo}', anexos[k])

                # E cobra as que este caso exige e nao vieram. Só no bloco do primeiro
                # titular: a lista de exigidos é da proposta inteira, não por titular,
                # e repetir a cobrança em cada bloco contaria a mesma falta várias vezes.
                if i == 0:
                    for item in (exigidos or []):
                        k = item.get('chave', '')
                        if not (k.startswith('parentesco_') or k == 'certidao_crianca'):
                            continue
                        if not anexos.get(k):
                            roteiro.append({'etapa': item.get('rotulo', k), 'arquivo': None,
                                            'ok': False, 'detalhe': 'faltando'})

    # 9. Vinculo - sempre por ultimo, e so quando o titular nao e o dono do CNPJ
    chave, rotulo, _ = ETAPA_VINCULO
    if not titular_e_dono:
        itens = anexos.get(chave) or []
        if not itens:
            roteiro.append({'etapa': rotulo, 'arquivo': None, 'ok': False,
                            'detalhe': 'faltando - obrigatorio porque o titular nao e o dono do CNPJ'})
        _juntar(rotulo, itens)

    # Compressao SEM PERDA dos fluxos de conteudo. Nao toca nas imagens do formulario
    # oficial da operadora de proposito: recomprimi-las mudaria o visual do documento,
    # e o documento tem que chegar na operadora igual ao original. O que da para
    # encolher sem risco, encolhe; o resto e o preco de manter a folha intacta.
    for pagina in escritor.pages:
        try:
            pagina.compress_content_streams(level=9)
        except Exception:
            pass

    buf = io.BytesIO()
    escritor.write(buf)
    buf.seek(0)
    return buf.getvalue(), roteiro


def pendencias(roteiro):
    """Lista o que falta, para a interface avisar antes de enviar a operadora."""
    return [r for r in roteiro if not r.get('ok')]
