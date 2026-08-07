# AGENTS.md — Diretrizes para agentes de IA no JOB Serenus

Este arquivo vale para qualquer agente que abrir este repositório (Antigravity/Gemini,
Cursor, Codex e afins). O `CLAUDE.md` é o mesmo conteúdo em mais detalhe — leia os dois
antes de escrever qualquer linha.

## O que é o projeto

ERP em **Flask + PostgreSQL (Railway)** da Serenus Corretora de Saúde.
Praticamente tudo vive em **um arquivo: `app.py` (~10,4k linhas)** + templates Jinja2 em
`templates/`. Substituiu o Pipefy.

- Produção: https://job-serenus-production.up.railway.app
- Deploy é **automático a partir do branch `main`** e leva ~2-3 min. Todo commit em `main`
  vai pro ar. Trate `main` como produção.
- Backlog e pendências: `ROADMAP.md` (fonte única).
- Régua de design de toda tela: `UX_APRENDIZADOS.md` (obrigatório).
- Guia operacional e visual do sistema: `GUIA_OPERACIONAL.md`.

## Regras inegociáveis

1. **Sem emojis.** Em nenhum botão, título, mensagem de interface, commit ou comentário.
   A limpeza foi feita à mão em 30/06/2026; não reintroduzir.
2. **Uma mudança por vez, commits pequenos.** Não misturar assuntos no mesmo commit.
3. **Não fazer mudança não solicitada.** Nada de refatorar de passagem, renomear variável
   "de brinde", reorganizar imports ou "melhorar" código que não faz parte do pedido.
4. **Não escolher tarefa sozinho.** Não puxar item do `ROADMAP.md` por conta própria —
   só o que foi pedido explicitamente.
5. **Nunca reescrever `app.py` inteiro.** Edições cirúrgicas, localizadas. Se a ferramenta
   quiser reformatar o arquivo todo, cancele.
6. Depois de editar `app.py`, **sempre** validar a sintaxe:
   ```
   python3 -c "import ast; ast.parse(open('app.py').read())"
   ```
7. **Nunca commitar segredo.** Chaves ficam em variáveis de ambiente no Railway.
   Não colar chave em código, em log ou no chat.

## Como testar antes de subir

Local, com SQLite (não encostar no Postgres de produção):

```
JOB_DATA_DIR=/tmp/jobtest python3
```

e dentro do Python usar `app.app.test_client()` com sessão `{'user_id': 1, 'perfil': 'admin'}`.

Depois do deploy, testar três coisas: a feature nova, **uma feature antiga**
(anti-regressão) e **abrir um anexo**.

## Mapa de módulos e matriz de impacto

Para uma análise completa de interdependências e efeito dominó entre módulos, consulte [MAPA_MODULOS.md](file:///Users/guilhermesantos/Desktop/job-serenus/MAPA_MODULOS.md).

| Módulo | Rotas principais | Templates |
|---|---|---|
| Auth/usuários | `/login /logout /esqueci-senha /setup/<token> /usuarios /minha-foto` | login, usuarios, setup_senha |
| Propostas | `/nova-proposta /salvar-proposta /propostas /proposta/<id>[/editar /fase /historico]` | form, propostas, detalhe |
| Financeiro propostas | `/parcela/<id>/* /proposta/<id>/{antecipacao,boleto-adesao,estornar}` | detalhe |
| Fluxo de caixa/config | `/fluxo-caixa /financeiro /repasses /producao /niveis /comissoes /regimes /operadoras /produtos /campos` | fluxo_caixa, financeiro |
| CRM | `/crm /crm/lead/<id>/* /crm/etapas /crm/painel /crm/importar[-agora]` | crm, crm_painel |
| Ingestão de leads | `/webhook/sheets` + `_importar_leads_automatico` | — |
| Cotação | `/cotacao /cotacao/tabelas/* /cotacao/salvar /cotacao/documento/<id> /c/<token>` | cotacao* |
| Material de apoio | `/material-apoio[/novo]` | material_apoio |
| Notificações | `/api/notificacoes[/marcar-lidas]`, helper `_notificar(...)` | base.html |
| BI/APIs | `/bi /api/bi/*` (header `X-API-Key`), `/api/propostas` | bi |
| Admin | `/admin/*` (todas com guard de admin) | — |
| Webhook Asaas | `/webhook/asaas` | — |

## Armadilhas já mordidas (não repetir)

- **Postgres vs SQLite:** `substr()` em timestamp precisa de `CAST(... AS TEXT)`.
  Nunca chamar `datetime.fromisoformat()` direto em valor vindo do banco — usar
  `_parse_dt_seguro()`. Row do SQLite não passa em `|tojson`: converter para dict na rota.
- **Anexos:** ficam em `/data/anexos` (local, achatado) e no R2
  (`propostas/{id}/{tipo}/arquivo`). Uploads anteriores a 27/06/2026 podem não existir mais.
- **Cotação:** o token público `/c/<token>` é **imutável**. "Nova versão" cria registro
  novo — nunca `UPDATE`. O agravo (`/ajustar`) só mexe no `planos_json` da cotação, jamais
  na tabela base.
- **Leads:** nome de aba na URL precisa de `urllib.parse.quote`. Colunas variam por
  planilha, use `_col()`. Dedup por `telefone_norm`. O job automático tem teto de 50 por
  rodada e ignora leads com mais de 30 dias.
- **Scheduler:** existem dois caminhos de importação (APScheduler + auto-pull por request
  com throttle de 10 min). O APScheduler morre em restart — **não remover nenhum dos dois**.
- **R2:** autenticar com `R2_ACCOUNT_ID/ACCESS_KEY/SECRET_KEY` (S3). O `R2_API_TOKEN` existe
  no ambiente mas não funciona com boto3.

## Base de conhecimento

Documentos originais ficam em `docs/`; a versão em Markdown, já estruturada, em
`knowledge/`. Quando a tarefa depender de um contrato, manual ou especificação, **procure
primeiro em `knowledge/*.md`** antes de pedir o PDF ao usuário. Para converter um documento
novo: `ingest docs/arquivo.pdf`.

## Interface

- Sem emojis (regra 1).
- Todo conceito difícil na tela leva um ícone "i" com a explicação ao lado.
- Cada perfil de usuário vê o que serve para ele.
- O menu já tem cerca de 25 itens: **tela nova não ganha item de menu automaticamente** —
  perguntar onde encaixar.
