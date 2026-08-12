#!/usr/bin/env python3
"""Mede o que a extensao baixa quando abre Mensagens e Funis.

"Ficou mais leve" e "ficou mais pesado" sao as duas frases que mais custam caro
nesse projeto quando ditas sem numero. Este script monta uma biblioteca do
tamanho da real (400 mensagens, metade compartilhada, espalhadas em pastas),
chama as duas rotas que a extensao usa e devolve mediana, p95 e o tamanho da
resposta.

Roda em SQLite proprio, nunca toca em producao:

    /usr/bin/python3 scripts/medir_carga_extensao.py

Para comparar com a versao anterior do servidor, rode o mesmo script numa copia
do repositorio com o `app.py` antigo — as duas medidas saem no mesmo formato.
"""
import json
import os
import shutil
import sys
import time

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = '/tmp/jobmedir-biblioteca'
QUANTOS = 400
RODADAS = 30

shutil.rmtree(BASE, ignore_errors=True)
os.makedirs(BASE, exist_ok=True)
os.environ['JOB_DATA_DIR'] = BASE
os.environ['WHATSAPP_EXT_KEY'] = 'chave-de-medicao'
os.environ.setdefault('SEED_DADOS_SERENUS', '0')
sys.path.insert(0, RAIZ)

import app as A  # noqa: E402

TEXTO = ('Olá {{nome}}, tudo bem? Passando para falar do seu plano de saúde. '
         'Consigo te mandar as opções agora mesmo, é rápido. ') * 6


def semear():
    conn = A.db()
    cur = conn.cursor()
    cur.execute("INSERT INTO usuarios (nome,email,perfil,ativo) VALUES (?,?,?,1)",
                ('Consultora Medida', 'medida@teste.local', 'consultor'))
    uid = A._last_insert_id(cur)
    cur.execute("INSERT INTO pastas (nome,parent_id,consultor_id) VALUES ('Compartilhado',NULL,NULL)")
    raiz_comum = A._last_insert_id(cur)
    cur.execute("INSERT INTO pastas (nome,parent_id,consultor_id) VALUES (?,NULL,?)",
                ('Consultora Medida', uid))
    raiz_dela = A._last_insert_id(cur)
    pastas = []
    for i, nome in enumerate(['Operadoras', 'Campanhas', 'Pós-venda', 'Primeiro contato']):
        pai = raiz_comum if i % 2 == 0 else raiz_dela
        cur.execute("INSERT INTO pastas (nome,parent_id,consultor_id) VALUES (?,?,NULL)", (nome, pai))
        sub = A._last_insert_id(cur)
        pastas.append((sub, None if pai == raiz_comum else uid))
        cur.execute("INSERT INTO pastas (nome,parent_id,consultor_id) VALUES (?,?,NULL)",
                    ('Amil', sub))
        pastas.append((A._last_insert_id(cur), None if pai == raiz_comum else uid))
    for i in range(QUANTOS):
        pasta_id, dono = pastas[i % len(pastas)]
        midia = ('MODELO_WPP_MEDIDA_%d.ogg' % i) if i % 3 == 0 else None
        cur.execute("""INSERT INTO modelos_conteudo
            (tipo,nome,corpo_texto,ativo,criado_por,midia_arquivo,midia_tipo,categoria,pasta_id,dono_consultor_id)
            VALUES ('whatsapp',?,?,1,?,?,?,?,?,?)""",
            ('Mensagem de teste %03d' % i, TEXTO, uid, midia,
             'audio' if midia else None, 'Amil', pasta_id, dono))
    cur.execute("""INSERT INTO whatsapp_funis (nome,ativo,criado_por,pasta_id,dono_consultor_id)
        VALUES ('Funil de medicao',1,?,?,?)""", (uid, pastas[0][0], pastas[0][1]))
    conn.commit()
    A.close_db(conn)
    return uid


def medir(cliente, url, uid):
    tempos = []
    corpo = b''
    for _ in range(RODADAS):
        t0 = time.perf_counter()
        r = cliente.get('%s?usuario_id=%d' % (url, uid),
                        headers={'X-Extension-Key': os.environ['WHATSAPP_EXT_KEY']})
        tempos.append((time.perf_counter() - t0) * 1000)
        corpo = r.get_data()
    tempos.sort()
    return {
        'rota': url,
        'mediana_ms': round(tempos[len(tempos) // 2]),
        'p95_ms': round(tempos[min(len(tempos) - 1, int(len(tempos) * 0.95))]),
        'kb': round(len(corpo) / 1024, 1),
        'itens': len(json.loads(corpo).get('modelos', json.loads(corpo).get('funis', []))),
    }


def main():
    uid = semear()
    cliente = A.app.test_client()
    print('Biblioteca de medicao: %d mensagens, metade compartilhada, em 8 pastas.' % QUANTOS)
    print('%d chamadas por rota. Tempo do servidor, sem rede.' % RODADAS)
    print('')
    for url in ('/api/whatsapp/extensao/modelos', '/api/whatsapp/extensao/funis'):
        m = medir(cliente, url, uid)
        print('%-42s mediana %4dms   p95 %4dms   %6.1fKB   %d itens'
              % (m['rota'].replace('/api/whatsapp/extensao/', ''), m['mediana_ms'],
                 m['p95_ms'], m['kb'], m['itens']))


if __name__ == '__main__':
    main()
