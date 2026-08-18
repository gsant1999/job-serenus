"""A linha "Acomodação" do documento do cliente nunca mais pode sair em branco.

Em 18/08/2026 uma cotação real (id 79, Campinas PF, 3 planos) foi entregue com
a linha vazia nos três planos. A causa estava em `_viva_para_apresentacao`:
o valor só era traduzido quando era o singleton `True`/`False` do Python
(`is True` / `is False`), então 1/0 vindos de JSON caíam no ramo final e viravam
string vazia.

O histórico deste campo tem DOIS erros opostos, e o teste protege contra os dois:

- Antes de 621bbd7 o código chutava: tudo que não fosse claramente apartamento
  virava 'Enfermaria' — e escrevia 'Enfermaria' num plano Ambulatorial, no
  documento que vai pro cliente.
- 621bbd7 tirou o chute e passou a devolver vazio, o que sumiu com a linha.

Nenhum dos dois serve. Quando o dado não vem, a resposta é perguntar à base; só
quando nem ela sabe (ou sabe duas coisas diferentes) é que fica vazio.

    python3 testes/testar_acomodacao_documento.py
"""

import os
import sys
import tempfile

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
os.environ['JOB_MODO_TESTE'] = '1'
os.environ['JOB_DATA_DIR'] = tempfile.mkdtemp(prefix='jobtest-acomodacao-')
os.environ['SEED_DADOS_SERENUS'] = '0'

import app as A  # noqa: E402

FALHAS = []

with A.app.app_context():
    conn = A.db()
    for op, plano, acom in (('Medsênior', 'Medsênior CPS1', 'Enfermaria'),
                            ('Medsênior', 'Medsênior Black', 'Apartamento'),
                            # Mesma dupla operadora+plano com acomodações
                            # diferentes: aqui a base NÃO sabe responder.
                            ('Amil', 'Duplo', 'Enfermaria'),
                            ('Amil', 'Duplo', 'Apartamento')):
        conn.execute("INSERT INTO cotacao_tabela (operadora, plano, modalidade, acomodacao, "
                     "coparticipacao, cidade, ativo) VALUES (?,?,'PF',?,'Sem','Campinas - SP',1)",
                     (op, plano, acom))
    conn.commit()
    A.close_db(conn)


def caso(rotulo, plano, esperado, operadora='Medsênior'):
    d = {'planos': [{'total': 100.0, 'operadora': {'nome': operadora}, 'plano': plano,
                     'produto': {'nome': 'x'}, 'tabela': {}, '_tipo': 'PF',
                     'faixas': [{'faixa': '59+', 'quantidade': 2, 'unitario': 50.0}]}]}
    with A.app.app_context():
        planos, _, _ = A._viva_para_apresentacao(d)
    veio = planos[0]['acomodacao'] if planos else '(nenhum plano)'
    if veio == esperado:
        print(f'  ok    {rotulo:46} -> {veio!r}')
    else:
        print(f'  FALHA {rotulo:46} -> {veio!r}, esperava {esperado!r}')
        FALHAS.append(rotulo)


print('\n— O que a extensão e o site mandam')
caso('texto da base do JOB', {'nome': 'Medsênior CPS1', 'acomodacaoTxt': 'Enfermaria'}, 'Enfermaria')
caso('texto livre não vira Apartamento/Enfermaria',
     {'nome': 'Medsênior CPS1', 'acomodacao': 'Ambulatorial'}, 'Ambulatorial')
caso('booleano verdadeiro', {'nome': 'Medsênior CPS1', 'acomodacao': True}, 'Apartamento')
caso('booleano falso', {'nome': 'Medsênior CPS1', 'acomodacao': False}, 'Enfermaria')

print('\n— O buraco que esvaziou a linha na cotação 79')
caso('número 1 (JSON, não é bool do Python)', {'nome': 'Medsênior CPS1', 'acomodacao': 1}, 'Apartamento')
caso('número 0 (JSON, não é bool do Python)', {'nome': 'Medsênior CPS1', 'acomodacao': 0}, 'Enfermaria')

print('\n— Quando não vem nada, pergunta à base em vez de chutar')
caso('ausente, base responde Enfermaria', {'nome': 'Medsênior CPS1'}, 'Enfermaria')
caso('ausente, base responde Apartamento', {'nome': 'Medsênior Black'}, 'Apartamento')
caso('string vazia cai no mesmo caminho',
     {'nome': 'Medsênior Black', 'acomodacaoTxt': ''}, 'Apartamento')

print('\n— Vazio só quando é honesto (o chute é o erro antigo)')
caso('plano que não existe na base', {'nome': 'Não Existe'}, '')
caso('base sabe duas coisas diferentes', {'nome': 'Duplo'}, '', operadora='Amil')

print()
if FALHAS:
    print(f'FALHOU: {len(FALHAS)}')
    for f in FALHAS:
        print('  -', f)
    sys.exit(1)
print('ACOMODAÇÃO NO DOCUMENTO: tudo passou')
