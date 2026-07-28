"""Configuracao do gunicorn em producao.

Existe por um motivo so: apagar a assinatura do servidor. Por padrao o gunicorn
responde "Server: gunicorn/21.2.0" em toda requisicao, o que entrega a stack para
quem apenas abriu o site. O cabecalho e escrito pela propria biblioteca, depois do
app - por isso nao adianta mexer no Flask; tem que ser aqui.
"""
import gunicorn

# Os dois nomes: a versao 21 monta o cabecalho a partir de SERVER, versoes vizinhas
# usam SERVER_SOFTWARE. Setar so um deixa vazar "gunicorn" - conferido na pratica.
gunicorn.SERVER = 'servidor'
gunicorn.SERVER_SOFTWARE = 'servidor'

bind = '0.0.0.0:' + __import__('os').environ.get('PORT', '8000')
workers = 2
timeout = 120
