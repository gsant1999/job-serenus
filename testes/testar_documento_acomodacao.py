"""A linha "Acomodação" do documento do cliente nunca fica muda.

Célula em branco no documento que o cliente recebe parece defeito — e num
comparativo de plano de saúde levanta dúvida sobre o resto dos números. Mas uma
fileira inteira de "não informado" também não ajuda a comparar nada.

Então: quando pelo menos um plano tem o dado, a linha aparece e o que falta diz
"Não informado". Quando nenhum tem, a linha inteira sai.

    python3 testes/testar_documento_acomodacao.py
"""
import os, sys, tempfile, json

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
os.environ['JOB_MODO_TESTE'] = '1'
os.environ['JOB_DATA_DIR'] = tempfile.mkdtemp(prefix='jobtest-doc-acom-')
os.environ['SEED_DADOS_SERENUS'] = '0'

import app as A  # noqa: E402
falhas=[]

def montar(acoms):
    planos=[{'operadora':'Op','plano':f'Plano {i}','modalidade':'PF','acomodacao':a,
             'coparticipacao':'Sem','abrangencia':'x','total':100.0,'elegivel':True,'recomendacao':'',
             'vigencia':'','linhas':[{'faixa':'59+','label':'59 ou mais','preco':50.0,'qtd':2,'subtotal':100.0}]}
            for i,a in enumerate(acoms)]
    with A.app.app_context():
        c=A.db()
        c.execute("""INSERT INTO cotacao_salva (token, orientacao, corretor_id, corretor_nome,
            corretor_email, corretor_telefone, cliente_nome, cliente_email, cliente_telefone,
            titulo, vidas_json, planos_json, total, tabela_ids_json, cidade, modalidades)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            ('tk'+str(len(acoms))+acoms[0][:3].replace(' ','_'),'horizontal',1,'C','e','','Cli','','',
             'T', json.dumps({'59+':2}), json.dumps(planos,ensure_ascii=False), 100.0,'[]','Campinas - SP','["PF"]'))
        c.commit()
        vid=c.execute("SELECT MAX(id) m FROM cotacao_salva").fetchone()['m']
        A.close_db(c)
    return vid

cli=A.app.test_client()
with cli.session_transaction() as s: s['user_id']=1; s['perfil']='admin'

# 1. todos conhecidos -> linha aparece com os valores
vid=montar(['Enfermaria','Apartamento'])
h=cli.get(f'/cotacao/documento/{vid}').data.decode('utf-8','ignore')
if 'Acomodação' not in h: falhas.append('1. linha sumiu com valores conhecidos')
if 'Enfermaria' not in h or 'Apartamento' not in h: falhas.append('1b. valores nao apareceram')
print('1. todos conhecidos      -> linha presente, valores impressos')

# 2. um vazio -> linha aparece, o vazio vira texto
vid=montar(['Enfermaria',''])
h=cli.get(f'/cotacao/documento/{vid}').data.decode('utf-8','ignore')
if 'Acomodação' not in h: falhas.append('2. linha sumiu com um valor conhecido')
if 'Não informado' not in h: falhas.append('2b. celula vazia nao virou "Não informado"')
print('2. um vazio              -> linha presente, vazio vira "Não informado"')

# 3. todos vazios -> linha some
vid=montar(['',''])
h=cli.get(f'/cotacao/documento/{vid}').data.decode('utf-8','ignore')
if 'Acomodação' in h: falhas.append('3. linha ficou, toda vazia')
print('3. todos vazios          -> linha some')

print()
if falhas: print('FALHOU:'); [print(' -',f) for f in falhas]; sys.exit(1)
print('DOCUMENTO OK: 3 casos')
