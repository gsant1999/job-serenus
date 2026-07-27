"""Confere o PDF gerado lendo os BYTES do texto, nao a imagem.

O poppler (pdftoppm/pdftotext) e tolerante e desenha corretamente coisas que o
Acrobat/Preview desenham errado - foi assim que passou despercebido o texto gravado
em UTF-16 numa fonte de 1 byte, que no leitor real virava "R E I N O  D O  A C A I".
Este script olha o fluxo de aparencia de verdade.

Uso: python3 conferir.py saida/ARQUIVO.pdf
"""
import re
import sys

from pypdf import PdfReader

HEX_TJ = re.compile(rb'<([0-9A-Fa-f]+)>\s*Tj')
LIT_TJ = re.compile(rb'\(((?:[^()\\]|\\.)*)\)\s*Tj')


def conferir(caminho):
    r = PdfReader(caminho)
    problemas = []
    total_textos = 0

    for pnum, page in enumerate(r.pages):
        recursos = page.get('/Resources') or {}
        xobjs = recursos.get('/XObject')
        fluxos = []
        if xobjs:
            for nome in xobjs.keys():
                if str(nome).startswith('/Fm_'):
                    try:
                        fluxos.append((str(nome), xobjs[nome].get_object().get_data()))
                    except Exception:
                        pass
        for nome, dados in fluxos:
            for m in HEX_TJ.finditer(dados):
                total_textos += 1
                bruto = bytes.fromhex(m.group(1).decode())
                if b'\x00' in bruto:
                    amostra = bruto.decode('utf-16-be', 'replace')[:40]
                    problemas.append(
                        f'pag {pnum + 1} {nome}: texto em 2 bytes numa fonte de 1 byte '
                        f'(vai sair com espaco entre as letras) -> {amostra!r}'
                    )
            for m in LIT_TJ.finditer(dados):
                total_textos += 1
                txt = m.group(1)
                if re.search(rb'\\\\[()]', txt):
                    problemas.append(f'pag {pnum + 1} {nome}: escape duplicado -> {txt[:40]!r}')

    acro = r.trailer['/Root'].get('/AcroForm')
    paginas_com_form = [i + 1 for i, p in enumerate(r.pages) if p.get('/Annots')]

    print(f'== {caminho}')
    print(f'   trechos de texto conferidos: {total_textos}')
    print(f'   AcroForm removido (achatado): {"sim" if acro is None else "NAO"}')
    print(f'   paginas ainda com campos: {paginas_com_form or "nenhuma"}')
    if problemas:
        print(f'   {len(problemas)} PROBLEMA(S):')
        for p in problemas:
            print(f'     - {p}')
        return False
    print('   nenhum problema de codificacao encontrado')
    return True


if __name__ == '__main__':
    alvos = sys.argv[1:]
    if not alvos:
        import glob
        import os
        alvos = sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'saida', '*.pdf')))
    ok = all(conferir(a) for a in alvos)
    sys.exit(0 if ok else 1)
