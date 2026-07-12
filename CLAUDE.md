# JOB Serenus — Guia do Projeto

ERP em **Flask + PostgreSQL (Railway)** da Serenus Corretora de Saúde. Um arquivo (`app.py`, ~10.4k linhas) + templates Jinja2. Substituiu o Pipefy.

- **Produção:** https://job-serenus-production.up.railway.app (deploy automático do `main`, ~2-3 min)
- **Repo:** https://github.com/gsant1999/job-serenus
- **Backlog/melhorias:** ver `ROADMAP.md` (fonte única de pendências)

## Regras de trabalho (inegociáveis)

1. **Sem emojis** em botões/interface (limpeza total feita em 30/06/2026 — não reintroduzir).
2. **Uma mudança por vez, commits pequenos.** Não misturar assuntos num commit.
3. **Não fazer mudanças não solicitadas.**
4. Validar sintaxe após editar `app.py`: `python3 -c "import ast; ast.parse(open('app.py').read())"`
5. Testar local antes do deploy (SQLite): `JOB_DATA_DIR=/tmp/jobtest python3` + `app.app.test_client()` com sessão `{'user_id':1,'perfil':'admin'}`. Após deploy: testar a feature + uma antiga (anti-regressão) + abrir um anexo.

## Mapa de módulos (rotas por região do app.py — use grep para o exato)

| Módulo | Rotas principais | Templates |
|---|---|---|
| Auth/usuários | `/login /logout /esqueci-senha /setup/<token> /usuarios /minha-foto` | login, usuarios, setup_senha |
| Propostas | `/nova-proposta /salvar-proposta /propostas /proposta/<id>[/editar /fase /historico]` | form, propostas, detalhe |
| Financeiro propostas | `/parcela/<id>/* /proposta/<id>/{antecipacao,boleto-adesao,estornar}` | detalhe |
| Fluxo de caixa/config | `/fluxo-caixa /financeiro /repasses /producao /niveis /comissoes /regimes /operadoras /produtos /campos` | fluxo_caixa, financeiro, ... |
| CRM | `/crm /crm/lead/<id>/* /crm/etapas /crm/painel /crm/importar[-agora]` | crm, crm_painel |
| Ingestão de leads | `/webhook/sheets` (push Apps Script) + `_importar_leads_automatico` (pull 15min + throttle por request 10min + botão) | — |
| Cotação | `/cotacao /cotacao/tabelas/* /cotacao/salvar /cotacao/documento/<id> /c/<token> /cotacao/<id>/{reabrir,ajustar,enviar-email} /cotacao/legendas` | cotacao*, 9 arquivos |
| Material de apoio | `/material-apoio[/novo]` (navegador de pastas operadora→tipo) | material_apoio |
| Notificações (sino) | `/api/notificacoes[/marcar-lidas]`; helper `_notificar(usuario_id,tipo,titulo,desc,link)`, `_notificar_admins` | base.html (sino) |
| BI/APIs | `/bi /api/bi/*` (header X-API-Key=env API_KEY_BI) `/api/propostas` (login) | bi |
| Admin/emergency | `/admin/*` (todas com guard admin — decorator ou check inline) | — |
| Webhook Asaas | `/webhook/asaas` (+ `webhook_log`) | — |

## Armadilhas conhecidas

- **PG vs SQLite:** `substr()` em timestamp precisa de `CAST(... AS TEXT)`; nunca `datetime.fromisoformat()` direto em valor do banco — usar `_parse_dt_seguro()`; Row do SQLite não passa no `|tojson` (converter p/ dict na rota).
- **Anexos:** local `/data/anexos` (achatado) + R2 (`propostas/{id}/{tipo}/arq`). Servir: local → varredura do bucket por sufixo. Uploads pré-27/06/2026 podem não existir mais (logos: já tem fallback p/ embutido).
- **Cotação:** token público `/c/<token>` é IMUTÁVEL; "Nova versão" cria registro novo (nunca UPDATE). Agravo (`/ajustar`) só mexe no `planos_json` da cotação, nunca na tabela base.
- **Leads (planilhas):** nome de aba na URL precisa de `urllib.parse.quote` (espaço/acento). Colunas variam por planilha → `_col()` faz mapeamento flexível. Dedup por `telefone_norm`. Job automático tem teto de 50/rodada e ignora leads datados >30 dias (histórico completo só via `/crm/importar`).
- **Scheduler:** APScheduler no processo web morre em restart — por isso existe também o auto-pull por request (throttle 10 min). Não remover nenhum dos dois.
- **R2:** usar `R2_ACCOUNT_ID/ACCESS_KEY/SECRET_KEY` (S3). `R2_API_TOKEN` existe no env mas NÃO funciona com boto3.

## Pendências urgentes conhecidas

- MedSênior PF sem registro de `recebimento`.
- Chaves de produção já expostas em chat — rotacionar quando possível (Postgres, ASAAS_API_KEY, BREVO_API_KEY).
