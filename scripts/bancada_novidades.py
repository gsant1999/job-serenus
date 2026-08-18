#!/usr/bin/env python3
"""Bancada de telas do SITE — desenha as Novidades e fotografa.

Mesmo molde da `bancada_biblioteca.py`: renderiza com o Flask de verdade, sobre
um banco SQLite de teste, e fotografa nos dois temas e em quatro larguras.
Existe pela regra 7 da regua de UX do JOB — nenhum commit que muda visual sai
sem passar por aqui.

Uso (da raiz do repositorio):

    /usr/bin/python3 scripts/bancada_novidades.py

Ele mesmo semeia o conteudo, entao nao depende de rodar teste antes. As imagens
saem em /tmp/bancada-novidades/. Nada aqui vai para producao.
"""
import os
import re
import shutil
import subprocess
import sys
import threading
import http.server
import socketserver

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = '/tmp/bancada-novidades'
PORTA = 8913
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
LARGURAS = [(1440, 1000), (1024, 900), (768, 900), (375, 820)]

os.environ.setdefault('JOB_DATA_DIR', '/tmp/jobtest-novidades')
os.environ.setdefault('JOB_MODO_TESTE', '1')
os.environ.setdefault('WHATSAPP_EXT_KEY', 'chave-de-teste-novidades')
shutil.rmtree(os.environ['JOB_DATA_DIR'], ignore_errors=True)
sys.path.insert(0, RAIZ)

import app as A  # noqa: E402

# Conteudo realista, escrito como a consultora leria. Texto de mentira do tipo
# "Lorem ipsum" esconde justamente o que a bancada existe pra mostrar: se o
# titulo de duas linhas quebra bem, se o corpo longo respira, se a etiqueta
# encosta na data.
# A ordem aqui e de PUBLICACAO: mais antigo primeiro, como acontece na vida.
# Eu tinha semeado do mais novo pro mais velho e a bancada mostrou a lista
# invertida — parecia defeito da tela e era defeito do dado de teste.
SEMENTE = [
    ("Consulta de CNPJ preenche o resto do formulário", "novidade", "ambos", "4.95.0",
     "Digite o CNPJ e o endereço, a razão social e a cidade entram sozinhos."),
    ("Repasses somam o mês fechado, não os últimos 30 dias", "melhoria", "sistema", None,
     "A tela de Repasses passou a considerar o mês fechado. O número agora bate "
     "com o que você vê no extrato da operadora."),
    ("Cotação sai em imagem direto na conversa", "novidade", "ambos", "4.97.0", None),
    ("A aba do WhatsApp para de fechar sozinha no meio da tarde", "melhoria", "extensao", "4.98.0",
     "A extensão agora limpa a própria memória antes de a aba encher. "
     "Você não precisa fazer nada, e nenhuma conversa se perde."),
    ("A extensão avisa quando o WhatsApp muda", "correcao", "extensao", "4.98.1",
     "O canário passou a testar o mesmo caminho que o envio usa de verdade. "
     "Quando o WhatsApp atualiza e alguma coisa para de funcionar, você fica "
     "sabendo em minutos, e não pela conversa que não foi."),
]


def servidor_estatico():
    """Serve a raiz do repo só para o CSS e as imagens de /static resolverem."""
    handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(*a, directory=RAIZ, **kw)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(('127.0.0.1', PORTA), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def html_da_tela(cliente, url, tema):
    r = cliente.get(url)
    if r.status_code != 200:
        raise SystemExit('%s respondeu %d' % (url, r.status_code))
    html = r.get_data(as_text=True)
    html = html.replace('"/static/', '"http://127.0.0.1:%d/static/' % PORTA)
    if tema == 'claro':
        html = html.replace('<html lang="pt-BR">', '<html lang="pt-BR" data-theme="light">')
    html = re.sub(r'<link[^>]+fonts\.googleapis[^>]*>', '', html)
    html = re.sub(r'<script[^>]+cdn\.jsdelivr[^>]*></script>', '', html)
    return html


def main():
    if not os.path.exists(CHROME):
        raise SystemExit('Google Chrome não encontrado em %s' % CHROME)
    shutil.rmtree(SAIDA, ignore_errors=True)
    os.makedirs(SAIDA, exist_ok=True)
    httpd = servidor_estatico()
    cliente = A.app.test_client()
    with cliente.session_transaction() as s:
        s['user_id'] = 1
        s['perfil'] = 'admin'

    for titulo, tipo, alvo, versao, corpo in SEMENTE:
        cliente.post('/novidades/salvar', data={
            'titulo': titulo, 'tipo': tipo, 'alvo': alvo,
            'versao': versao or '', 'corpo': corpo or '',
        })

    # DUAS VISITAS, DE PROPOSITO. Na primeira tudo e novo e a barra da esquerda
    # aparece em todos os itens; na segunda ja foi lido e a lista fica limpa.
    # Os dois estados precisam ser olhados: e comum um deles ficar bonito e o
    # outro nao — e o estado lido e o que a pessoa ve 90% das vezes.
    feitas = []
    for visita, nome in ((1, 'nao-lido'), (2, 'lido')):
        for tema in ('escuro', 'claro'):
            html = html_da_tela(cliente, '/novidades', tema)
            caminho_html = os.path.join(SAIDA, '%s-%s.html' % (nome, tema))
            with open(caminho_html, 'w', encoding='utf-8') as fh:
                fh.write(html)
            for largura, altura in LARGURAS:
                # O Chrome sem interface não abre janela menor que 500px: pedir
                # 375 devolvia um RECORTE de 500. O iframe dá a largura de verdade.
                moldura = os.path.join(SAIDA, 'moldura-%s-%s-%d.html' % (nome, tema, largura))
                with open(moldura, 'w', encoding='utf-8') as fh:
                    fh.write('<!doctype html><meta charset="utf-8">'
                             '<body style="margin:0;background:#5b5b66">'
                             '<iframe src="%s" style="width:%dpx;height:%dpx;border:0;display:block" '
                             'title="tela"></iframe></body>'
                             % (os.path.basename(caminho_html), largura, altura))
                png = os.path.join(SAIDA, '%s-%s-%d.png' % (nome, tema, largura))
                subprocess.run([
                    CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
                    '--force-device-scale-factor=1', '--virtual-time-budget=2500',
                    '--window-size=%d,%d' % (max(largura, 500), altura),
                    '--screenshot=%s' % png, 'file://' + moldura,
                ], capture_output=True)
                feitas.append(png)
        del visita

    httpd.shutdown()
    print('Fotos em %s:' % SAIDA)
    for f in feitas:
        tamanho = os.path.getsize(f) if os.path.exists(f) else 0
        print('   %-28s %s' % (os.path.basename(f), 'ok' if tamanho else 'FALHOU'))


if __name__ == '__main__':
    main()
