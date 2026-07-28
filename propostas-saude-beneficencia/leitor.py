"""Le os documentos enviados e devolve (a) os dados das pessoas e (b) o que e cada
arquivo, para o sistema distribuir tudo sozinho nos campos do contrato.

O corretor joga a pasta inteira de uma vez numa area so. A IA nao decide regra de
negocio - ela responde duas perguntas que exigem OLHAR o papel:

    "que documento e este?"  e  "de quem e?"

Quem e titular, quem e dependente e quem e o dono do CNPJ o sistema ja sabe (o
corretor marcou na secao 2), entao a distribuicao final e feita em codigo, casando
o nome lido com as pessoas cadastradas. Modelo nao adivinha regra de operadora.

Precisa de ANTHROPIC_API_KEY. Sem a chave, a ferramenta continua funcionando pelo
caminho manual (o botao que copia o prompt para o ChatGPT do proprio consultor).
"""
import base64
import io
import json
import os

# Modelo barato de proposito: a tarefa (ler campos de um documento) e facil para
# qualquer modelo de visao atual, e o volume e alto. Trocavel por variavel de
# ambiente sem mexer no codigo.
MODELO = os.environ.get('MODELO_LEITURA', 'claude-haiku-4-5')

# Reduz a foto antes de enviar. O custo e proporcional a area da imagem, e acima
# de ~1568px no lado maior o modelo nao ganha nada - so encarece.
LADO_MAXIMO = 1568
# Teto de imagens por leitura: evita que alguem suba a pasta errada e gere uma conta
# inesperada num clique so. Um contrato completo com dependente da ~10 imagens.
MAX_IMAGENS = 24
# Paginas por PDF. Duas bastam: a primeira diz o que o documento e, e documento de
# identidade em PDF costuma ter frente e verso. Contrato social tem 10 paginas e
# mandar todas so encarece sem mudar a classificacao.
PAGINAS_POR_PDF = 2

# Tipos que a IA pode atribuir. Sao tipos de PAPEL, nao posicoes no contrato - quem
# converte tipo em campo do contrato e o front, que sabe quem e titular e quem e
# dependente. Manter em sincronia com MAPA_TIPOS no index.html.
TIPOS = [
    'identidade',            # RG, CNH, CPF, carteira funcional
    'cartao_cnpj',
    'contrato_social',       # contrato social, CCMEI, requerimento de empresario
    'comprovante_endereco',  # conta de luz, agua, telefone, internet, boleto
    'certidao_casamento',
    'uniao_estavel',         # declaracao de uniao estavel (gov.br ou cartorio)
    'certidao_nascimento',
    'holerite',              # holerite verde padrao (vinculo de funcionario)
    'contrato_estagio',
    'carteira_trabalho',
    'outro',
]

ESQUEMA = {
    'type': 'object',
    'properties': {
        'arquivos': {
            'type': 'array',
            'description': 'Um item por ARQUIVO recebido, na mesma numeracao',
            'items': {
                'type': 'object',
                'properties': {
                    'indice': {'type': 'integer', 'description': 'O numero do ARQUIVO'},
                    'tipo': {'type': 'string', 'enum': TIPOS},
                    'pessoa': {
                        'type': 'string',
                        'description': 'Nome completo do titular do documento; vazio '
                                       'quando o documento nao e de uma pessoa',
                    },
                    'certeza': {'type': 'string', 'enum': ['alta', 'media', 'baixa']},
                },
                'required': ['indice', 'tipo', 'pessoa', 'certeza'],
                'additionalProperties': False,
            },
        },
        'pessoas': {
            'type': 'array',
            'items': {
                'type': 'object',
                'properties': {
                    'nome': {'type': 'string'},
                    'cpf': {'type': 'string'},
                    'rg': {'type': 'string'},
                    'nascimento': {'type': 'string', 'description': 'DD/MM/AAAA'},
                    'mae': {'type': 'string'},
                    'pai': {'type': 'string'},
                    'sexo': {'type': 'string', 'enum': ['M', 'F', '']},
                },
                'required': ['nome', 'cpf', 'rg', 'nascimento', 'mae', 'pai', 'sexo'],
                'additionalProperties': False,
            },
        },
        'empresa': {
            'type': 'object',
            'description': 'Sai do cartao CNPJ. So o numero ja basta: o resto a tela '
                           'busca na Receita sozinha.',
            'properties': {
                'cnpj': {'type': 'string', 'description': '00.000.000/0000-00'},
                'razao_social': {'type': 'string'},
            },
            'required': ['cnpj', 'razao_social'],
            'additionalProperties': False,
        },
        'endereco': {
            'type': 'object',
            'properties': {
                'rua': {'type': 'string'}, 'numero': {'type': 'string'},
                'complemento': {'type': 'string'}, 'bairro': {'type': 'string'},
                'cidade': {'type': 'string'}, 'uf': {'type': 'string'},
                'cep': {'type': 'string'},
            },
            'required': ['rua', 'numero', 'complemento', 'bairro', 'cidade', 'uf', 'cep'],
            'additionalProperties': False,
        },
        'observacoes': {
            'type': 'array', 'items': {'type': 'string'},
            'description': 'Campos ilegiveis ou duvidosos, para o corretor conferir',
        },
    },
    'required': ['arquivos', 'pessoas', 'empresa', 'endereco', 'observacoes'],
    'additionalProperties': False,
}

INSTRUCAO = """Você recebeu os documentos de uma proposta de plano de saúde empresarial
brasileira. Cada imagem vem precedida de uma linha "ARQUIVO n" que diz a qual arquivo
ela pertence — um mesmo arquivo pode ter mais de uma imagem (frente e verso, ou páginas
de um PDF).

Faça duas coisas.

**1) Classifique cada ARQUIVO** (um item em "arquivos" por número de ARQUIVO, nunca dois
para o mesmo número):

- "identidade": RG, CNH, CPF, carteira funcional ou de conselho de classe. Em "pessoa",
  o nome completo do dono do documento.
- "cartao_cnpj": cartão CNPJ / comprovante de inscrição da Receita Federal.
- "contrato_social": contrato social, CCMEI, requerimento de empresário, alteração
  contratual.
- "comprovante_endereco": conta de luz, água, gás, telefone, internet ou boleto no
  endereço. Em "pessoa", o nome que está na conta.
- "certidao_casamento", "uniao_estavel", "certidao_nascimento": as certidões. Em
  "pessoa", de quem é a certidão (na de nascimento, o nome de quem nasceu).
- "holerite", "contrato_estagio", "carteira_trabalho": papéis de vínculo de trabalho.
- "outro": qualquer coisa que não se encaixe.

Em "certeza", diga o quanto você confia na classificação: "alta", "media" ou "baixa".
Prefira "baixa" a chutar — o corretor revisa o que vier marcado assim.

**2) Extraia os dados das pessoas** dos documentos de identidade e certidões:

- Um mesmo documento em duas imagens (frente e verso) é UMA pessoa, não duas.
- A mesma pessoa aparecendo em documentos diferentes (RG e CNH) também é uma só:
  junte os dados.
- Datas em DD/MM/AAAA. A de NASCIMENTO, nunca a de emissão ou validade.
- CPF pontuado: 000.000.000-00. RG como está impresso.
- "mae" e "pai" vêm da filiação. Se só houver um, preencha o que existir.
- Sexo "M" ou "F" conforme o documento; se não estiver escrito, deduza pelo nome; se
  ainda assim não der, deixe vazio.
- O endereço vem do comprovante de endereço, se houver.
- Em "empresa", copie o CNPJ do cartão CNPJ exatamente como impresso, com pontuação.
  Se não houver cartão CNPJ entre os arquivos, deixe vazio — não invente e não tire o
  número do contrato social se estiver ilegível.

Campo que você não conseguir ler: deixe vazio e escreva em "observacoes" qual foi e de
quem. NUNCA invente e NUNCA chute dígito de CPF ou RG — um dígito errado faz a operadora
recusar a proposta inteira."""


class SemChave(RuntimeError):
    """Nao ha ANTHROPIC_API_KEY configurada."""


def disponivel():
    return bool(os.environ.get('ANTHROPIC_API_KEY'))


def _preparar(dados):
    """Reduz e converte para JPEG. Devolve (media_type, base64) ou None se nao for
    imagem legivel."""
    from PIL import Image, ImageOps

    try:
        im = Image.open(io.BytesIO(dados))
    except Exception:
        return None
    im = ImageOps.exif_transpose(im)
    if im.mode not in ('RGB', 'L'):
        im = im.convert('RGB')

    escala = min(LADO_MAXIMO / max(im.width, im.height), 1.0)
    if escala < 1.0:
        im = im.resize((int(im.width * escala), int(im.height * escala)), Image.LANCZOS)

    buf = io.BytesIO()
    im.convert('RGB').save(buf, format='JPEG', quality=85, optimize=True)
    return 'image/jpeg', base64.standard_b64encode(buf.getvalue()).decode()


def _paginas_do_pdf(dados, limite=PAGINAS_POR_PDF):
    """PDF tambem e documento: converte as primeiras paginas em imagem."""
    try:
        import pypdfium2 as pdfium
    except ImportError:
        return []
    saida = []
    try:
        doc = pdfium.PdfDocument(io.BytesIO(dados))
        for i in range(min(len(doc), limite)):
            pil = doc[i].render(scale=200 / 72).to_pil()
            buf = io.BytesIO()
            pil.convert('RGB').save(buf, format='JPEG', quality=85, optimize=True)
            preparado = _preparar(buf.getvalue())
            if preparado:
                saida.append(preparado)
    except Exception:
        return saida
    return saida


def _imagens_por_arquivo(arquivos):
    """arquivos: [(nome, bytes)] -> [(indice, nome, media_type, b64)] respeitando o teto.

    Percorre em rodadas (primeira imagem de cada arquivo, depois a segunda...) para
    que um PDF gordo no comeco da fila nao consuma o teto e deixe os documentos do
    fim sem nenhuma imagem - o que faria a IA nem enxergar que eles existem."""
    por_arquivo = []
    for nome, dados in arquivos:
        if dados[:5] == b'%PDF-':
            por_arquivo.append(_paginas_do_pdf(dados))
        else:
            p = _preparar(dados)
            por_arquivo.append([p] if p else [])

    saida, rodada = [], 0
    while len(saida) < MAX_IMAGENS:
        avancou = False
        for i, imagens in enumerate(por_arquivo):
            if rodada < len(imagens):
                avancou = True
                saida.append((i + 1, arquivos[i][0]) + imagens[rodada])
                if len(saida) >= MAX_IMAGENS:
                    break
        if not avancou:
            break
        rodada += 1
    # Volta a ordem natural (arquivo 1 antes do 2) para a IA nao ver as paginas
    # embaralhadas.
    saida.sort(key=lambda x: x[0])
    return saida


def ler(arquivos):
    """arquivos: [(nome, bytes)] na ordem em que o corretor soltou.
    Devolve o dicionario do ESQUEMA; 'arquivos[].indice' e 1-based nessa mesma ordem."""
    if not disponivel():
        raise SemChave('ANTHROPIC_API_KEY não configurada.')

    import anthropic

    imagens = _imagens_por_arquivo(arquivos)
    if not imagens:
        return {'arquivos': [], 'pessoas': [], 'empresa': {}, 'endereco': {},
                'observacoes': ['Nenhuma imagem legível foi enviada.']}

    conteudo = []
    for indice, nome, media_type, b64 in imagens:
        conteudo.append({'type': 'text', 'text': f'ARQUIVO {indice}: {nome}'})
        conteudo.append({'type': 'image', 'source': {
            'type': 'base64', 'media_type': media_type, 'data': b64}})
    conteudo.append({'type': 'text', 'text': INSTRUCAO})

    cliente = anthropic.Anthropic()
    resposta = cliente.messages.create(
        model=MODELO,
        max_tokens=4000,
        messages=[{'role': 'user', 'content': conteudo}],
        output_config={'format': {'type': 'json_schema', 'schema': ESQUEMA}},
    )

    texto = next((b.text for b in resposta.content if b.type == 'text'), '{}')
    dados = json.loads(texto)

    # Devolve o nome do arquivo junto da classificacao: a tela mostra "rg.jpg ->
    # documento de identidade", e o corretor confere sem abrir nada.
    nomes = {i + 1: nome for i, (nome, _) in enumerate(arquivos)}
    vistos = set()
    limpos = []
    for a in dados.get('arquivos', []):
        i = a.get('indice')
        if i not in nomes or i in vistos:
            continue          # indice inventado ou repetido: descarta
        vistos.add(i)
        a['arquivo'] = nomes[i]
        limpos.append(a)
    # Arquivo que a IA nao classificou (ou que nem coube no teto de imagens) nao pode
    # sumir da tela - entra como desconhecido para o corretor resolver na mao.
    for i, nome in sorted(nomes.items()):
        if i not in vistos:
            limpos.append({'indice': i, 'arquivo': nome, 'tipo': 'outro',
                           'pessoa': '', 'certeza': 'baixa'})
    dados['arquivos'] = sorted(limpos, key=lambda a: a['indice'])

    enviadas = len({i for i, _, _, _ in imagens})
    if enviadas < len(arquivos):
        dados.setdefault('observacoes', []).append(
            f'Só couberam {enviadas} dos {len(arquivos)} arquivos nesta leitura '
            f'(teto de {MAX_IMAGENS} imagens). Os demais ficaram sem classificação.')

    dados['_uso'] = uso(resposta.usage.input_tokens, resposta.usage.output_tokens,
                        len(arquivos), len(imagens))
    return dados


# Preco do Haiku 4.5 (USD por milhao de tokens). Se MODELO mudar, mude aqui tambem -
# o numero que aparece na tela de gestao sai daqui.
PRECO_ENTRADA_USD = 1.00
PRECO_SAIDA_USD = 5.00
# Cambio usado para mostrar o custo em real. E uma referencia fixa de propria vontade:
# buscar cotacao em tempo real numa tela de custo interno nao paga o que custa manter.
CAMBIO_BRL = float(os.environ.get('CAMBIO_BRL', '5.40'))


def uso(tokens_entrada, tokens_saida, n_arquivos=0, n_imagens=0):
    """Traduz tokens em dinheiro. Usado na tela e no registro de custo."""
    usd = (tokens_entrada / 1e6) * PRECO_ENTRADA_USD + (tokens_saida / 1e6) * PRECO_SAIDA_USD
    return {
        'arquivos': n_arquivos,
        'imagens': n_imagens,
        'tokens_entrada': tokens_entrada,
        'tokens_saida': tokens_saida,
        'modelo': MODELO,
        'custo_usd': round(usd, 6),
        'custo_brl': round(usd * CAMBIO_BRL, 4),
    }


def para_bloco_notas(dados):
    """Converte o resultado no mesmo formato de texto que o parser ja entende, para
    o corretor poder revisar e corrigir antes de usar."""
    partes = []
    for p in dados.get('pessoas', []):
        linhas = [p.get('nome', ''), p.get('cpf', ''), p.get('rg', ''), p.get('nascimento', '')]
        if p.get('pai'):
            linhas.append(p['pai'])
        if p.get('mae'):
            linhas.append(p['mae'])   # a mae fica por ultimo: o parser le assim
        partes.append('\n'.join([l for l in linhas if l]))

    e = dados.get('endereco') or {}
    if e.get('rua'):
        end = [e.get('rua', ''), e.get('numero', ''), e.get('bairro', ''), e.get('cidade', '')]
        if e.get('cep'):
            end.append(f"CEP: {e['cep']}")
        partes.append('\n'.join([l for l in end if l]))

    return '\n\n'.join(partes)
