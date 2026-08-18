"""Prova que as correções da auditoria de segurança da cotação continuam de pé.

Cada bloco aqui corresponde a um defeito real encontrado em 17/08/2026 e a uma
regra do roadmap. O teste existe pra que a correção não volte atrás sem alguém
perceber — vários destes eram invisíveis em produção porque o sintoma saía como
"tente novamente".

Roda em SQLite temporário, sem servidor e sem acessar produção.

    python3 testes/testar_auditoria_seguranca.py
"""

import json
import os
import re
import subprocess
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
os.environ['JOB_MODO_TESTE'] = '1'
os.environ['JOB_DATA_DIR'] = tempfile.mkdtemp(prefix='jobtest-auditoria-')
os.environ['SEED_DADOS_SERENUS'] = '0'

import app as A  # noqa: E402

FALHAS = []


def checa(nome, cond, detalhe=''):
    if cond:
        print(f'  ok    {nome}')
    else:
        print(f'  FALHA {nome}' + (f'  << {detalhe}' if detalhe else ''))
        FALHAS.append(nome)


def _ler(caminho):
    with open(os.path.join(RAIZ, caminho), encoding='utf-8') as f:
        return f.read()


APP = _ler('app.py')
BG = _ler('extensao-whatsapp/background.js')
CT = _ler('extensao-whatsapp/content.js')
TP = _ler('templates/cotacao_novo.html')
PB = _ler('extensao-whatsapp/painel-bridge.js')


print('\n— Regra 6: nenhuma credencial no repositório')
# Placeholder de docstring ("user:senha@host:porta") não é credencial: o que
# conta é host real, com ponto no domínio à direita do @.
achados = [l for l in subprocess.run(
    ['git', 'grep', '-nIE',
     r"postgres(ql)?://[^\"' ]+:[^\"' @]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
     '--', '*.py', '*.js', '*.json', '*.toml', '*.yml'],
    capture_output=True, text=True, cwd=RAIZ).stdout.strip().split('\n') if l.strip()]
checa('nenhuma string de conexão com senha versionada', not achados, ' | '.join(achados)[:160])


print('\n— Regra 5: a árvore de sessão do Painel não chega ao servidor')
checa('extensão limpa antes de mandar',
      '_semDetalheDeSessao' in BG and 'corpo = _semDetalheDeSessao(corpo)' in BG)
checa('servidor limpa antes de gravar',
      "_fila_sem_detalhe_de_sessao(req.get('resultado'))" in APP)
sujo = {'ok': False, 'motivo': 'http_500 em preco',
        'detalhe': {'arvore': 'SEGREDO', 'responderam': 'SEGREDO', 'enviei': 'SEGREDO'},
        'dados': {'planos': [{'chave': 'k', 'arvore': 'SEGREDO'}]}}
limpo = A._fila_sem_detalhe_de_sessao(sujo)
checa('scrub apaga a árvore, inclusive aninhada', 'SEGREDO' not in json.dumps(limpo))
checa('scrub preserva o motivo e o dado útil',
      limpo['motivo'] == 'http_500 em preco' and limpo['dados']['planos'][0]['chave'] == 'k')
checa('idade do cliente não vai pro log de erro',
      "idades: String(_cot.idades || '')," not in CT and 'vidas: String(_cot.idades' in CT)


print('\n— Regras 2 e 3: a interface não ensina a abrir o Painel')
checa('botão do Painel só na máquina que cota', '(souTrab && _cotPedeOPainel(motivo))' in CT)
checa('background recusa abrir fora do trabalhador', 'aparelho_nao_cota_no_painel' in BG)
checa('motivo testado por igualdade, não por prefixo',
      '_COT_PRECISA_PAINEL.some' not in CT and 'function _cotPedeOPainel' in CT)
checa('site não linka a fonte do preço',
      'paineldocorretor' not in TP)


print('\n— Regras 7 e 8: ao vivo primeiro, e cache não se renova sozinho')
# Ancora pela ORDEM das duas buscas, com os textos ja blindados: o rotulo da
# consulta ao vivo nao pode mais nomear a fonte (ver testar_blindagem_fonte_preco).
checa('ao vivo é tentado antes do banco',
      TP.index('Buscando operadoras ao vivo') < TP.index('Consultando planos no banco do JOB'))
checa('as duas fontes somam (operadoras só do JOB sobrevivem)', 'só na base do JOB' in TP)
checa('quando cai pro banco, a tela diz que é base salva',
      'base salva do JOB</b>, não consultado agora' in TP)
checa('origem viaja com o preço (site e extensão)',
      "fontePreco: 'tabela_job'" in TP and "fontePreco: 'tabela_job'" in CT)


print('\n— Ciclo de vida da fila')
checa('pytz: localize em vez de replace(tzinfo=)',
      'TZ_SP.localize(datetime.strptime' in APP
      and "'%Y-%m-%d %H:%M:%S').replace(tzinfo=TZ_SP)" not in APP)
checa('trabalhador escolhido por MAX, sem NULL na frente', 'MAX(trabalhador_sinal)' in APP)
checa('fila com desempate determinístico', 'ORDER BY criado_em ASC, id ASC LIMIT 1' in APP)
checa('requeue zera o progresso', APP.count("etapa='', fracao=0") >= 2)
checa('portão da fila exige sessão não revogada',
      'trabalhador_cotacao=1 AND revogado_em IS NULL AND trabalhador_sinal >= ?' in APP)
checa('/etapa renova pegado_em', 'SET etapa=?, fracao=?, pegado_em=?' in APP)
checa('limpeza cobre pedido que nunca terminou',
      'terminado_em IS NULL AND criado_em < ?' in APP)
checa('recuperação só do dono',
      APP.index('item = conn.execute("SELECT * FROM cotacao_fila WHERE id=?", (cid,)).fetchone()')
      < APP.index('if pode_ver_resultado:'))
checa('etapa só do dono', "(item['etapa'] or '') if pode_ver_resultado else ''" in APP)
checa('conexão esquecida é fechada no fim da requisição',
      '@app.teardown_request' in APP and '_lembrar_conexao' in APP)

ponte = max(int(x) for x in re.findall(r"\['[a-z_]+',\s*(\d+)\]", PB))
cao = int(re.search(r'_TRAB_LIMITE_MS = (\d+)', BG).group(1))
cliente = int(re.search(r'_FILA_LIMITE_MS = (\d+)', BG).group(1))
servidor = 5 * 60 * 1000    # cutoff_preso em app.py
checa('relógios em série: ponte < cão de guarda < cliente < servidor',
      ponte < cao < cliente < servidor,
      f'{ponte} < {cao} < {cliente} < {servidor}')
checa('só o trabalhador puxa da fila', 'if (!_souTrabalhador) return false;' in BG)


print('\n— Comportamento (rodando de verdade)')


def _plano(fonte=None, valor=100.0):
    p = {'operadora': {'nome': 'SulAmerica'}, 'plano': {'nome': 'Plano X', 'acomodacao': 1},
         'produto': {'nome': 'Produto'}, 'tabela': {'nome': 'Linha', 'coparticipacao': False},
         'total': valor, 'key': 'k1',
         'faixas': [{'faixa': '19 a 23', 'quantidade': 1, 'unitario': valor}]}
    if fonte:
        p['fontePreco'] = fonte
    return p


with A.app.app_context():
    conn = A.db()
    n_tabela = A._aprender_do_vivo(conn, 'Campinas - SP', 2, [_plano('tabela_job')])
    n_vivo = A._aprender_do_vivo(conn, 'Campinas - SP', 2, [_plano('painel_ao_vivo')])
    n_sem = A._aprender_do_vivo(conn, 'Campinas - SP', 2, [_plano(None, 111.0)])
    colunas = [r[1] for r in conn.execute("PRAGMA table_info(cotacao_viva_preco)").fetchall()]
    conn.commit()
    A.close_db(conn)

checa('preço de tabela NÃO renova a data da própria tabela', n_tabela == 0, f'aprendeu {n_tabela}')
checa('preço ao vivo continua alimentando a base', n_vivo == 1, f'aprendeu {n_vivo}')
checa('preço sem marca continua aprendendo (extensão antiga)', n_sem == 1, f'aprendeu {n_sem}')
checa('origem fica gravada pra auditoria', 'fonte_preco' in colunas)

# A fila precisa aceitar o pedido de PREÇO. Era o defeito que deixava o
# aparelho sem Painel montar a cotação inteira e morrer na última etapa.
from datetime import datetime  # noqa: E402

with A.app.app_context():
    conn = A.db()
    if not conn.execute("SELECT id FROM usuarios WHERE id=1").fetchone():
        conn.execute("INSERT INTO usuarios (id,nome,email,senha_hash,perfil,ativo) "
                     "VALUES (1,'Teste','t@t.com','x','admin',1)")
    agora = datetime.now(A.TZ_SP).strftime('%Y-%m-%d %H:%M:%S')
    conn.execute("DELETE FROM extensao_sessao")
    conn.execute("INSERT INTO extensao_sessao (id,usuario_id,token_hash,criado_em,"
                 "trabalhador_cotacao,trabalhador_sinal) VALUES (99,1,'h',?,1,?)", (agora, agora))
    conn.commit()
    A.close_db(conn)

cliente_http = A.app.test_client()
with cliente_http.session_transaction() as s:
    s['user_id'] = 1


def _pedir(tipo, chave):
    return cliente_http.post('/api/whatsapp/cotacao/fila', json={
        'pedido': {'type': tipo, 'pedido': {'planos': [{'key': 'k'}]}},
        'chave_pedido': chave})


r = _pedir('cotador_precos_paralelos', 'cot-teste-preco')
checa('a fila aceita o pedido de PREÇO',
      r.status_code == 200 and r.get_json().get('id'), f'{r.status_code} {r.get_json()}')
r = _pedir('apagar_tudo', 'cot-teste-invalido')
checa('a porta não abriu demais (tipo desconhecido = 400)', r.status_code == 400)
for tipo in ('cotar_aqui', 'cotador_cidades', 'cotador_catalogo',
             'cotador_modalidades', 'cotador_passo', 'cotador_estado'):
    rr = _pedir(tipo, 'cot-teste-' + tipo)
    if rr.status_code != 200:
        FALHAS.append(f'tipo antigo {tipo} quebrou ({rr.status_code})')
checa('os seis tipos que já funcionavam continuam passando',
      not [f for f in FALHAS if f.startswith('tipo antigo')])

print()
if FALHAS:
    print(f'FALHOU: {len(FALHAS)} verificação(ões)')
    for f in FALHAS:
        print('  -', f)
    sys.exit(1)
print('AUDITORIA DE SEGURANÇA: tudo passou')
