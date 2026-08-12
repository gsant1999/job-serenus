#!/usr/bin/env python3
"""Bancada de telas do SITE — desenha a Biblioteca e fotografa.

A bancada que existia (`scripts/bancada-telas.html`) e da extensao. Esta e a do
site: renderiza a tela com o Flask de verdade, sobre um banco SQLite de teste,
e tira foto nos dois temas e em quatro larguras. Existe pela mesma razao da
outra — mudanca de visual que ninguem olhou renderizada volta como retrabalho.

Uso (da raiz do repositorio):

    /usr/bin/python3 testes/testar_biblioteca.py     # popula o banco de teste
    /usr/bin/python3 scripts/bancada_biblioteca.py   # gera as fotos

As imagens saem em /tmp/bancada-biblioteca/. Nada aqui vai para producao.
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
SAIDA = '/tmp/bancada-biblioteca'
PORTA = 8912
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
LARGURAS = [(1440, 1000), (1024, 900), (768, 900), (375, 780)]

os.environ.setdefault('JOB_DATA_DIR', '/tmp/jobtest-biblioteca')
os.environ.setdefault('WHATSAPP_EXT_KEY', 'chave-de-teste-biblioteca')
sys.path.insert(0, RAIZ)

import app as A  # noqa: E402


def servidor_estatico():
    """Serve a raiz do repo só para o CSS e as imagens de /static resolverem."""
    handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(*a, directory=RAIZ, **kw)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = socketserver.TCPServer(('127.0.0.1', PORTA), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def html_da_tela(cliente, url, tema, script_extra=''):
    r = cliente.get(url)
    if r.status_code != 200:
        raise SystemExit('%s respondeu %d' % (url, r.status_code))
    html = r.get_data(as_text=True)
    if script_extra:
        html = html.replace('</body>', '<script>%s</script></body>' % script_extra)
    html = html.replace('"/static/', '"http://127.0.0.1:%d/static/' % PORTA)
    if tema == 'claro':
        html = html.replace('<html lang="pt-BR">', '<html lang="pt-BR" data-theme="light">')
    # Fonte externa e Chart.js não carregam offline e só atrasam a captura.
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

    conn = A.db()
    pasta = conn.execute("""SELECT p.id FROM pastas p
        WHERE EXISTS (SELECT 1 FROM modelos_conteudo m WHERE m.pasta_id=p.id)
        ORDER BY (SELECT COUNT(*) FROM modelos_conteudo m WHERE m.pasta_id=p.id) DESC
        LIMIT 1""").fetchone()
    A.close_db(conn)
    pasta_id = pasta['id'] if pasta else 0

    # As folhas são metade da experiência: abrir uma na captura é a única forma
    # de conferir o texto da consequência, o verbo do botão e o contraste.
    url_pasta = '/crm/modelos?escopo=pasta&pasta_id=%d' % pasta_id
    abre_mover = ("var it=(BIB_LISTAGEM.itens||[])[0]; if(it) bibFolhaDestino(it,'mover','conteudo');")
    abre_transferir = ("var it=(BIB_LISTAGEM.funis||[])[0]||(BIB_LISTAGEM.itens||[])[0];"
                       "if(it) bibFolhaTransferir(it,'funil',"
                       "[{nome:'Ana - primeiro contato',dono_nome:'Ana Consultora'}]);")
    abre_novo = "bibFolhaNovo();"
    telas = [
        ('inicio', '/crm/modelos', ''),
        ('pasta', url_pasta, ''),
        ('folha-mover', url_pasta, abre_mover),
        ('folha-transferir', url_pasta, abre_transferir),
        ('folha-novo', url_pasta, abre_novo),
    ]
    feitas = []
    for nome, url, extra in telas:
        for tema in ('escuro', 'claro'):
            caminho_html = os.path.join(SAIDA, '%s-%s.html' % (nome, tema))
            with open(caminho_html, 'w', encoding='utf-8') as fh:
                fh.write(html_da_tela(cliente, url, tema, extra))
            for largura, altura in LARGURAS:
                # O Chrome sem interface não abre janela menor que 500px: pedir
                # 375 devolvia um RECORTE de 500, e a tela estreita parecia
                # quebrada quando não estava. O iframe dá a largura de verdade.
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
    httpd.shutdown()
    print('Fotos em %s:' % SAIDA)
    for f in feitas:
        tamanho = os.path.getsize(f) if os.path.exists(f) else 0
        print('   %s  %s' % (os.path.basename(f), 'ok' if tamanho else 'FALHOU'))


if __name__ == '__main__':
    main()
