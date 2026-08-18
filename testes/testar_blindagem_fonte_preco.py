"""Nenhuma tela que a consultora abre pode dizer de onde vem o preço.

A regra é do Guilherme e é absoluta: o usuário final do JOB nunca fica sabendo
que a cotação passa por um sistema de terceiro. A única exceção é a máquina que
efetivamente busca o preço — a dele —, onde a instrução precisa ser literal
para ele conseguir agir.

Duas armadilhas que este teste existe para pegar:

1. COMENTÁRIO TAMBÉM VAZA. O JS das telas é <script> inline dentro do template,
   então comentário é servido no HTML e qualquer pessoa lê em "ver código-fonte".
2. O SUFIXO _trabalhador é endereçável por nome. As entradas de texto terminadas
   em `_trabalhador` são a leitura da máquina que cota. Sem guarda, um motivo que
   chegasse chamado 'painel_fechado_trabalhador' entregaria esse texto à
   consultora pela busca direta na tabela.

    python3 testes/testar_blindagem_fonte_preco.py
"""

import os
import re
import subprocess
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
os.environ['JOB_MODO_TESTE'] = '1'
os.environ['JOB_DATA_DIR'] = tempfile.mkdtemp(prefix='jobtest-blindagem-')
os.environ['SEED_DADOS_SERENUS'] = '0'

import app as A  # noqa: E402

FALHAS = []
PROIBIDO = re.compile(r'[Pp]ainel do [Cc]orretor|paineldocorretor|[Tt]rindade|[Ss]isweb')

# Telas que qualquer consultora abre. Admin-only fica de fora: são as
# ferramentas do próprio Guilherme, onde a instrução literal é o que serve.
ROTAS = ['/cotacao', '/cotacao/novo', '/cotacao/catalogo', '/manual', '/crm',
         '/propostas', '/nova-proposta', '/material-apoio', '/fluxo-caixa']

print('\n— Telas do site (texto E comentário servido no HTML)')
cli = A.app.test_client()
with cli.session_transaction() as s:
    s['user_id'] = 1
    s['perfil'] = 'consultor'

for rota in ROTAS:
    r = cli.get(rota, follow_redirects=True)
    if r.status_code != 200:
        print(f'  --    {rota:22} status {r.status_code}, pulado')
        continue
    achou = PROIBIDO.findall(r.data.decode('utf-8', 'ignore'))
    if achou:
        print(f'  VAZOU {rota:22} {len(achou)}x {sorted(set(achou))}')
        FALHAS.append(rota)
    else:
        print(f'  ok    {rota}')


print('\n— Textos de erro da extensão')
# Roda o trecho real de content.js em node: é a única forma de provar o
# comportamento do resolvedor em vez de conferir string por string.
PROVA = r'''
const fs=require('fs');
const src=fs.readFileSync('extensao-whatsapp/content.js','utf8');
function fatia(de,ate){const i=src.indexOf(de),j=src.indexOf(ate,i);
  if(i<0||j<0){console.log('ERRO marcador nao achado');process.exit(2);} return src.slice(i,j);}
const M=new Function('const esc=(x)=>String(x);\n'
  + fatia('  const _COT_EXPLICA = {','  // NÃO É AVISO SOLTO')
  + '\nreturn {_cotMotivo,_COT_EXPLICA};')();
const PROIBIDO=/painel do corretor|paineldocorretor|trindade|sisweb/i;
const out=[];
// 1. Nenhuma entrada da consultora nomeia a fonte.
for (const k of Object.keys(M._COT_EXPLICA)) {
  if (k.endsWith('_trabalhador')) continue;
  if (PROIBIDO.test(M._COT_EXPLICA[k])) out.push('entrada '+k);
}
// 2. Nem pelo resolvedor — inclusive pedindo a chave do trabalhador pelo nome.
for (const k of Object.keys(M._COT_EXPLICA).concat(['hash_expirado:preco','inventado'])) {
  if (PROIBIDO.test(M._cotMotivo(k,false))) out.push('_cotMotivo('+k+', consultora)');
}
// 3. Contraprova: a maquina que cota CONTINUA recebendo a instrucao literal.
if (!/painel do corretor/i.test(M._cotMotivo('painel_fechado',true)))
  out.push('a versao do trabalhador perdeu a instrucao util');
console.log(out.length ? 'VAZOU:'+out.join(' | ') : 'OK');
'''
r = subprocess.run(['node', '-e', PROVA], cwd=RAIZ, capture_output=True, text=True)
saida = (r.stdout or r.stderr).strip()
if saida == 'OK':
    print('  ok    nenhum texto de consultora nomeia a fonte')
    print('  ok    a máquina que cota mantém a instrução literal')
else:
    print(f'  VAZOU {saida}')
    FALHAS.append('extensao: ' + saida)

print()
if FALHAS:
    print(f'FALHOU: {len(FALHAS)}')
    for f in FALHAS:
        print('  -', f)
    sys.exit(1)
print('BLINDAGEM DA FONTE DO PREÇO: tudo passou')
