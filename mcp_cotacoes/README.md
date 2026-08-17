# MCP de Cotações do JOB Serenus

Servidor MCP em Python/FastMCP, com transporte Streamable HTTP, para uso por
n8n, Chatwoot e outros agentes externos. O MCP não acessa o banco: ele chama a
API HTTP do JOB, onde continuam as regras de cálculo, vínculo com lead,
imutabilidade de links e permissões.

## Arquitetura

```text
Agente / n8n / Chatwoot
        |
        | Streamable HTTP + Bearer MCP_API_KEY
        v
MCP de Cotações
        |
        | HTTPS + Bearer JOB_API_KEY
        v
API v1 do JOB
        |
        +-- PostgreSQL e motor local de preços
        +-- fila da extensão para o Painel do Corretor
```

Há duas chaves em cada fronteira:

- `MCP_API_KEY`: tools normais do MCP.
- `MCP_ADMIN_API_KEY`: também libera agravo, tabelas e exclusões.
- `JOB_API_KEY`: chave do JOB com `cotacao:ler`, `cotacao:escrever`, `crm:ler`
  e `crm:escrever`, vinculada ao consultor usado pelo agente.
- `JOB_ADMIN_API_KEY`: mesmos escopos, mas vinculada a um usuário administrador.

As quatro chaves devem ser diferentes. Nenhuma é gravada no código ou no banco
do MCP.

Crie as duas chaves do JOB em **Configurações > Chaves de API**. A chave comum
deve pertencer ao consultor usado pelo agente; a administrativa, a um usuário
administrador. Ambas precisam dos escopos `cotacao:ler`, `cotacao:escrever`,
`crm:ler` e `crm:escrever`.

## Tools

| Tool | Tipo | Exemplo de `entrada` |
|---|---|---|
| `cotacoes_operadoras_listar` | leitura | `{}` |
| `cotacoes_planos_listar` | leitura | `{"cidade":"Campinas","modalidade":"PME","mei":true}` |
| `cotacoes_calcular_local` | leitura | `{"idades":[42,39,12],"planos":[10,11]}` |
| `cotacoes_ao_vivo_solicitar` | escrita | `{"cidade":"Campinas - SP","vidas":[{"faixa":"39-43","quantidade":2}],"modalidade":2}` |
| `cotacoes_ao_vivo_status` | leitura | `{"pedido_id":123}` |
| `cotacoes_ao_vivo_cancelar` | alteração | `{"pedido_id":123}` |
| `cotacoes_salvar_local` | escrita | `{"lead_id":45,"idades":[42,39],"planos":[10,11]}` |
| `cotacoes_salvar_ao_vivo` | escrita | `{"lead_id":45,"resultado":{"cidade":"Campinas - SP","vidas":[],"planos":[]}}` |
| `cotacoes_listar` | leitura | `{"lead_id":45,"limite":20}` |
| `cotacoes_consultar` | leitura | `{"cotacao_id":80}` |
| `cotacoes_imagem_obter` | leitura | `{"cotacao_id":80}` |
| `leads_buscar` | leitura | `{"termo":"19999999999"}` |
| `leads_criar` | escrita | `{"nome":"Cliente","telefone":"19999999999","origem":"Site"}` |
| `cotacoes_email_enviar` | escrita externa | `{"cotacao_id":80,"email":"cliente@example.com"}` |
| `cotacoes_nova_versao` | escrita | `{"cotacao_id":80,"idades":[43,40],"planos":[10,11]}` |
| `cotacoes_agravo_aplicar` | admin | `{"cotacao_id":80,"versao":0,"ajustes":{"0":{"39-43":599.9}}}` |
| `tabelas_consultar` | leitura | `{"tabela_id":10}` |
| `tabelas_criar` | admin | `{"operadora":"Exemplo","plano":"Plano A","precos":{"00-18":150.0}}` |
| `tabelas_atualizar` | admin | `{"tabela_id":10,"operadora":"Exemplo","plano":"Plano A","precos":{"00-18":155.0}}` |
| `tabelas_importar` | admin | `{"operadora":"Exemplo","tabelas":[{"operadora":"Exemplo","plano":"A","precos":{"00-18":150.0}}]}` |
| `tabelas_excluir` | admin destrutiva | `{"tabela_id":10,"confirmacao":"EXCLUIR TABELA 10"}` |
| `cotacoes_excluir` | admin destrutiva | `{"cotacao_id":80,"confirmacao":"EXCLUIR COTACAO 80"}` |

A exclusão total de tabelas não é exposta. Alterar uma cotação por agravo nunca
mexe na tabela-base; criar nova versão sempre gera outro registro e outro token.

## Variáveis de ambiente

| Variável | Obrigatória | Uso |
|---|---|---|
| `MCP_API_KEY` | sim | Bearer das tools normais |
| `MCP_ADMIN_API_KEY` | sim | Bearer das tools administrativas |
| `JOB_BASE_URL` | sim | URL HTTPS do JOB |
| `JOB_API_KEY` | sim | Integração normal do JOB |
| `JOB_ADMIN_API_KEY` | sim | Integração do JOB vinculada a admin |
| `MCP_PUBLIC_URL` | recomendada | Origem pública do servidor, sem `/mcp` |
| `JOB_API_TIMEOUT` | não | Timeout em segundos; padrão 30 |
| `MCP_HOST` | não | Interface; padrão `0.0.0.0` |
| `MCP_PORT` ou `PORT` | não | Porta; padrão 8000 |
| `MCP_ALLOW_INSECURE_HTTP` | não | Use `1` somente em ambiente controlado |

Gere chaves aleatórias com um gerenciador de segredos. Não use os exemplos
deste README como credenciais.

## Rodar localmente

```bash
python3 -m venv /tmp/job-cotacoes-mcp
/tmp/job-cotacoes-mcp/bin/pip install -r mcp_cotacoes/requirements.txt

export MCP_API_KEY='uma-chave-aleatoria-com-pelo-menos-24-caracteres'
export MCP_ADMIN_API_KEY='outra-chave-aleatoria-com-pelo-menos-24-caracteres'
export JOB_BASE_URL='http://127.0.0.1:5000'
export JOB_API_KEY='job_live_chave_normal'
export JOB_ADMIN_API_KEY='job_live_chave_admin'

/tmp/job-cotacoes-mcp/bin/python -m mcp_cotacoes.server
```

O endpoint será `http://127.0.0.1:8000/mcp`.

## Testar com MCP Inspector

Antes do teste manual, rode a integração isolada da API do JOB:

```bash
JOB_MODO_TESTE=1 .venv/bin/python testes/testar_mcp_cotacoes.py
```

```bash
npx @modelcontextprotocol/inspector
```

No Inspector:

1. escolha Streamable HTTP;
2. informe `http://127.0.0.1:8000/mcp`;
3. adicione `Authorization: Bearer <MCP_API_KEY>`;
4. teste primeiro `cotacoes_operadoras_listar` e `leads_buscar`;
5. repita com `MCP_ADMIN_API_KEY` para as tools administrativas.

## n8n

No subnó **MCP Client Tool** ligado ao AI Agent:

1. Endpoint: `https://mcp.seudominio.com/mcp`.
2. Transport: **HTTP Streamable**.
3. Authentication: **Bearer Auth**.
4. Credential: valor de `MCP_API_KEY` sem o prefixo `Bearer`.
5. Em Tools to Include, selecione apenas as tools necessárias ao fluxo.

Para administração, crie outro credential com `MCP_ADMIN_API_KEY` e outro MCP
Client Tool contendo apenas as tools administrativas. Não entregue a chave
administrativa ao agente de atendimento do Chatwoot.

## Docker

Na raiz do repositório:

```bash
docker build -f mcp_cotacoes/Dockerfile -t job-cotacoes-mcp:1.0.0 .
docker run --rm -p 8000:8000 \
  --env-file /caminho/seguro/job-cotacoes-mcp.env \
  job-cotacoes-mcp:1.0.0
```

O arquivo `compose.example.yml` traz uma stack para Portainer/Traefik. Ajuste o
nome da rede externa e o `certresolver` ao ambiente real. Cadastre os segredos
no Portainer ou no mecanismo de secrets da infraestrutura; não versione `.env`.
O arquivo `.env.example` contém somente placeholders para orientar o cadastro.

## Fluxo ponta a ponta

Cotação local:

1. `leads_buscar` ou `leads_criar`.
2. `cotacoes_planos_listar`.
3. `cotacoes_calcular_local`.
4. `cotacoes_salvar_local`.
5. enviar a `url_publica` pelo Chatwoot ou usar `cotacoes_email_enviar`.

Cotação ao vivo:

1. `cotacoes_ao_vivo_solicitar`.
2. repetir `cotacoes_ao_vivo_status` até `estado=pronto` ou erro.
3. passar o resultado para `cotacoes_salvar_ao_vivo`.
4. enviar a `url_publica` retornada.

O servidor não guarda credenciais, cookies nem tokens do Painel do Corretor.
A cotação ao vivo só funciona quando a máquina trabalhadora está sinalizando
vida e mantém uma aba autenticada do Painel aberta.
