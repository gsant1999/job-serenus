#!/usr/bin/env python3
"""Confere se a extensão fala com o servidor do jeito que o servidor exige.

POR QUE ISTO EXISTE
-------------------
O botão "Cadastrar lead" da extensão falhava em 100% das vezes. A rota só
aceita `origem` de uma lista fechada (`_WA_ORIGENS_LEAD`) e a extensão mandava
'WhatsApp (cotação)', que eu inventei. Ninguém percebeu porque o erro só
aparece quando um humano clica — e a mensagem ("Selecione como o lead chegou")
não diz que quem errou foi o código.

É uma família inteira de defeito, não um caso: os dois lados são escritos em
arquivos diferentes, em linguagens diferentes, e o acordo entre eles só existe
na cabeça de quem escreveu. Este script põe o acordo no CI.

O QUE ELE PEGA
--------------
1. ROTA QUE NÃO EXISTE — a extensão chama um caminho que o app.py não serve
   (erro de digitação, rota renomeada, rota que nunca foi criada).
2. VALOR FORA DA LISTA — a extensão manda uma string literal num campo que o
   servidor valida contra uma lista fechada.

O QUE ELE NÃO PEGA, e continua sendo na mão
-------------------------------------------
- se o NÚMERO que a rota devolve é o número certo;
- campo montado dinamicamente (só literais são conferidos);
- validação que não seja `x not in LISTA`.

Uso:  .venv/bin/python scripts/checar_contrato.py
Sai com 1 se achar problema — dá pra prender num hook.
"""
import ast
import json
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP = os.path.join(RAIZ, 'app.py')
EXT = os.path.join(RAIZ, 'extensao-whatsapp')


def _fonte(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


def rotas_do_servidor(src):
    """Caminhos servidos pelo Flask, com os métodos aceitos."""
    achadas = {}
    for m in re.finditer(r"@app\.route\(\s*'([^']+)'(.*?)\)", src, re.S):
        caminho, resto = m.group(1), m.group(2)
        metodos = re.findall(r"'(GET|POST|PUT|DELETE|OPTIONS)'", resto) or ['GET']
        achadas[caminho] = set(metodos)
    return achadas


def listas_fechadas(src):
    """Constantes de módulo que são lista de strings: NOME -> [valores]."""
    try:
        arvore = ast.parse(src)
    except SyntaxError:
        return {}
    out = {}
    for no in arvore.body:
        if not isinstance(no, ast.Assign) or len(no.targets) != 1:
            continue
        alvo = no.targets[0]
        if not isinstance(alvo, ast.Name):
            continue
        v = no.value
        if isinstance(v, (ast.List, ast.Tuple, ast.Set)):
            vals = [e.value for e in v.elts
                    if isinstance(e, ast.Constant) and isinstance(e.value, str)]
            if vals and len(vals) == len(v.elts):
                out[alvo.id] = vals
    return out


def validacoes(src, constantes):
    """Acha `if <var> not in <CONST>:` e liga <var> ao campo do JSON.

    O padrão real do app.py é:
        origem = (d.get('origem') or '').strip()
        ...
        if origem not in _WA_ORIGENS_LEAD:
    Então o nome da variável e o `d.get('campo')` são ligados por atribuição.
    """
    campos = {}   # variavel -> campo do corpo
    for m in re.finditer(r"(\w+)\s*=\s*\(?\s*d\.get\(\s*'([^']+)'", src):
        campos[m.group(1)] = m.group(2)

    regras = []   # (campo, [valores aceitos])
    for m in re.finditer(r"if\s+(\w+)\s+not\s+in\s+(\w+)\s*:", src):
        var, const = m.group(1), m.group(2)
        if const in constantes and var in campos:
            regras.append((campos[var], constantes[const], const))
    return regras


# Arquivos que o manifest não carrega (cópias soltas) e código de terceiro não
# são nossos e não falam com o servidor. Conferi-los só produz ruído.
def _arquivos_vivos():
    try:
        m = json.load(open(os.path.join(EXT, 'manifest.json'), encoding='utf-8'))
    except Exception:
        return []
    vivos = {'background.js'}
    for c in m.get('content_scripts') or []:
        vivos.update(c.get('js') or [])
    vivos.discard('wa-js.vendor.js')      # biblioteca de terceiro
    return sorted(vivos)


def mensagens_por_rota():
    """`type` do sendMessage -> rota que o service worker chama com ele.

    É o que permite escopar: só interessa o literal que viaja NAQUELE payload,
    não qualquer `tipo:` solto no arquivo — sem isso o verificador acusa toda
    mensagem interna da extensão e vira ruído que ninguém lê.
    """
    s = _fonte(os.path.join(EXT, 'background.js'))
    pares = {}
    for m in re.finditer(r"msg\.type === '(\w+)'([\s\S]{0,600}?)chamarJob\(\s*'([^']+)'", s):
        pares.setdefault(m.group(1), m.group(3).split('?')[0])
    return pares


def literais_da_extensao(campo, tipos_validos):
    """Valores literais mandados naquele campo DENTRO de um sendMessage.

    Só olha o trecho entre `type: 'X'` e o fim daquela chamada. Valor montado
    em variável não é conferido — dizer que está errado sem saber seria pior
    que calar.
    """
    achados = []
    for nome in _arquivos_vivos():
        caminho = os.path.join(EXT, nome)
        if not os.path.exists(caminho):
            continue
        s = _fonte(caminho)
        for m in re.finditer(r"type:\s*'(\w+)'([\s\S]{0,700}?)\}\s*\)", s):
            if m.group(1) not in tipos_validos:
                continue
            for v in re.finditer(r"""['"]?%s['"]?\s*:\s*(['"])([^'"]{1,60})\1"""
                                 % re.escape(campo), m.group(2)):
                achados.append((nome, v.group(2), m.group(1)))
    return achados


def caminhos_chamados():
    """Rotas que a extensão chama, pelo chamarJob do service worker."""
    s = _fonte(os.path.join(EXT, 'background.js'))
    out = []
    for m in re.finditer(r"chamarJob\(\s*'([^']+)'\s*,\s*'(\w+)'", s):
        # tira query string e concatenação
        caminho = m.group(1).split('?')[0].rstrip("' +")
        out.append((caminho, m.group(2)))
    return out


def casa_rota(caminho, rotas):
    """Compara ignorando os conversores do Flask (<int:cid>, <token>)."""
    if caminho in rotas:
        return caminho
    for r in rotas:
        padrao = re.sub(r'<[^>]+>', '[^/]+', r)
        if re.fullmatch(padrao, caminho.rstrip('/')):
            return r
    # a extensão às vezes monta o fim do caminho por concatenação
    for r in rotas:
        if r.startswith(caminho) and caminho.count('/') >= 3:
            return r
    return None


def _blocos_por_rota(src):
    """Cada rota e o corpo da função dela, até a próxima rota.

    Recortar com um regex de tamanho limitado NÃO funciona: função longa passa
    do teto e o bloco some, e o verificador cala justamente onde havia
    validação. Partir a fonte por `@app.route` é exato e não tem teto.
    """
    partes = src.split('@app.route(')
    blocos = {}
    for pedaco in partes[1:]:
        m = re.match(r"\s*'([^']+)'", pedaco)
        if m:
            blocos.setdefault(m.group(1), pedaco)
    return blocos


def _rota_valida(caminho, campo, blocos):
    """A função que serve `caminho` contém a validação daquele campo?"""
    trecho = blocos.get(caminho)
    if not trecho:
        return False
    return ("d.get('%s')" % campo) in trecho and 'not in' in trecho


def main():
    src = _fonte(APP)
    rotas = rotas_do_servidor(src)
    consts = listas_fechadas(src)
    regras = validacoes(src, consts)

    problemas = []

    # 1) rota que a extensão chama e o servidor não serve
    for caminho, metodo in caminhos_chamados():
        achada = casa_rota(caminho, rotas)
        if not achada:
            problemas.append(
                ('ROTA INEXISTENTE',
                 "a extensão chama %s %s e o app.py não serve esse caminho" % (metodo, caminho)))
        elif metodo.upper() not in rotas[achada] and metodo.upper() != 'GET':
            problemas.append(
                ('METODO ERRADO',
                 "a extensão chama %s %s, mas a rota aceita %s"
                 % (metodo, caminho, '/'.join(sorted(rotas[achada])))))

    # 2) valor literal fora da lista fechada, só no payload que vai pra rota
    #    que tem aquela validação
    porrota = mensagens_por_rota()
    blocos = _blocos_por_rota(src)
    for campo, aceitos, const in regras:
        # quais `type` de mensagem chegam numa rota que valida este campo?
        tipos = {t for t, r in porrota.items() if _rota_valida(r, campo, blocos)}
        if not tipos:
            continue
        for arquivo, valor, tipo in literais_da_extensao(campo, tipos):
            if valor not in aceitos:
                problemas.append(
                    ('VALOR FORA DA LISTA',
                     "%s manda %s='%s' em '%s', e o servidor só aceita %s (%s)"
                     % (arquivo, campo, valor, tipo, ', '.join(aceitos), const)))

    print('Contrato extensão ↔ servidor')
    print('  %d rota(s) chamada(s) · %d validação(ões) de lista fechada'
          % (len(caminhos_chamados()), len(regras)))
    if not problemas:
        print('\n  nada a apontar.')
        return 0
    print()
    for tipo, texto in problemas:
        print('  [%s] %s' % (tipo, texto))
    print('\n  %d problema(s). Cada um quebra em tempo de uso, não de teste.' % len(problemas))
    return 1


if __name__ == '__main__':
    sys.exit(main())
