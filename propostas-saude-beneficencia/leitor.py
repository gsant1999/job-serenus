"""Le os documentos enviados (RG, CNH, comprovante de endereco) e devolve os dados
ja estruturados, para o corretor nao redigitar nada.

Os MESMOS arquivos que montam o contrato alimentam o preenchimento: sobe uma vez,
serve para as duas coisas.

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
# Teto de imagens por leitura: evita que alguem suba 40 fotos e gere uma conta
# inesperada num clique so.
MAX_IMAGENS = 12

ESQUEMA = {
    'type': 'object',
    'properties': {
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
    'required': ['pessoas', 'endereco', 'observacoes'],
    'additionalProperties': False,
}

INSTRUCAO = """Você recebeu fotos/digitalizações de documentos brasileiros (RG, CNH,
comprovante de endereço) de uma proposta de plano de saúde.

Extraia os dados EXATAMENTE como aparecem. Regras:

- Um mesmo documento pode aparecer em duas imagens (frente e verso): junte numa
  pessoa só, não invente duas.
- Datas sempre em DD/MM/AAAA. A data de NASCIMENTO, nunca a de emissão ou validade.
- CPF com pontuação: 000.000.000-00. RG como está impresso.
- "mae" e "pai" vêm da filiação. Se só houver um, preencha o que existir e deixe o
  outro vazio.
- Sexo: "M" ou "F" conforme o documento. Se não estiver escrito, deduza pelo nome;
  se ainda assim não der, deixe vazio.
- Campo que você não conseguir ler: deixe vazio e escreva em "observacoes" qual foi
  e de quem. NUNCA invente e NUNCA chute dígito de CPF ou RG.
- O endereço vem do comprovante de endereço, se houver algum.

Se a imagem estiver ilegível, diga isso em "observacoes" em vez de adivinhar. Um
dígito errado de CPF faz a proposta ser recusada pela operadora."""


class SemChave(RuntimeError):
    """Nao ha ANTHROPIC_API_KEY configurada."""


def disponivel():
    return bool(os.environ.get('ANTHROPIC_API_KEY'))


def _preparar(dados, nome):
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


def _paginas_do_pdf(dados, limite=4):
    """PDF tambem e documento: converte as primeiras paginas em imagem.
    Precisa do pypdfium2, que ja vem junto do pdfplumber."""
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
            preparado = _preparar(buf.getvalue(), f'pag{i}')
            if preparado:
                saida.append(preparado)
    except Exception:
        return saida
    return saida


def ler(arquivos):
    """arquivos: [(nome, bytes)]. Devolve o dicionario do ESQUEMA."""
    if not disponivel():
        raise SemChave('ANTHROPIC_API_KEY não configurada.')

    import anthropic

    imagens = []
    for nome, dados in arquivos:
        if dados[:5] == b'%PDF-':
            imagens.extend(_paginas_do_pdf(dados))
        else:
            p = _preparar(dados, nome)
            if p:
                imagens.append(p)
        if len(imagens) >= MAX_IMAGENS:
            break
    imagens = imagens[:MAX_IMAGENS]

    if not imagens:
        return {'pessoas': [], 'endereco': {}, 'observacoes': [
            'Nenhuma imagem legível foi enviada.']}

    conteudo = [{'type': 'image', 'source': {'type': 'base64', 'media_type': mt, 'data': b64}}
                for mt, b64 in imagens]
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
    dados['_uso'] = {
        'imagens': len(imagens),
        'tokens_entrada': resposta.usage.input_tokens,
        'tokens_saida': resposta.usage.output_tokens,
        'modelo': MODELO,
    }
    return dados


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
