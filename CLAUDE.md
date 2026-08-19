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
6. **Toda mudança de interface passa pela skill `ux-job` antes de ser escrita.** Ela é a régua (regras inegociáveis, valores de acabamento e movimento, checklist) e tem precedência sobre as skills genéricas de design instaladas em `.claude/skills/` — `apple-design` e `emil-design-eng` para consultar, `animate` para construir movimento, `review-animations` para criticar. Nenhum commit de visual sai sem passar pela bancada de telas.

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

## Onde o projeto mora (leia antes de criar arquivo em massa)

O repositorio fica em `~/Desktop/job-serenus`, e **`~/Desktop` e um link para o iCloud Drive**.
Tudo que existe aqui e sincronizado na nuvem, arquivo por arquivo.

Em 19/08/2026 isso derrubou a maquina (MacBook Air M2, 8 GB): o iCloud e o Spotlight varrendo
29.775 arquivos ao mesmo tempo, com 1,1 TB escritos no SSD em 11 h. Das ~2.200 alteracoes que o
iCloud subiu nas ultimas 24 h, **1.709 eram `.claude/worktrees` e 472 eram `.git`** — 99,8% do
trafego era ferramenta trabalhando, nao codigo do Guilherme.

**O que ja esta em vigor (nao desfazer):**

- `.claude/worktrees` **nao mora mais aqui**. E um link para `~/Developer/job-serenus-worktrees`,
  fora do iCloud. O caminho `~/Desktop/job-serenus/.claude/worktrees/...` continua valendo — use
  normalmente. Nao substitua o link por pasta de verdade.
- `.claude/worktrees` e `.git` tem `.metadata_never_index` dentro: desliga o Spotlight nessas
  pastas. Se o arquivo sumir, o Spotlight volta a indexar tudo. Recriar com `touch`.
- **Apague o worktree quando terminar a tarefa.** Cada um e ~70 MB e ~570 arquivos; doze
  acumulados foi o que estourou a maquina. Mas **antes de apagar, confira se alguma sessao ainda
  esta usando** — em 19/08 apaguei worktrees de sessoes vivas e elas quebraram com
  `[Errno 2] No such file or directory`:

  ```bash
  ps -Ao pid,etime,args | grep "claude-code/.*MacOS/claude" | grep -v grep   # sessoes abertas
  git worktree list                                                          # quem usa o que
  ```

- **Apagar worktree nao perde trabalho** — o conteudo mora no `.git`, a pasta e descartavel.
  Se uma sessao reclamar que o caminho sumiu, recrie no mesmo lugar:

  ```bash
  git worktree add ~/Desktop/job-serenus/.claude/worktrees/<nome> claude/<nome>
  ```

  Confira depois que o commit bate com o GitHub. Se a branch so existir local, publique antes.

**Cuidado ao copiar ou mover o repo:** 11.615 arquivos estao *so na nuvem* (dataless), a maior
parte em `video-ads/` (1,1 GB). Qualquer `cp`, `ditto` ou `rsync` da pasta inteira forca o download
de todos e **trava**. Se precisar mover o repo, baixe tudo antes, numa janela de manutencao.

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

## Base de conhecimento (knowledge/)

Este projeto usa o pipeline `ingest` para converter documentos (PDF, Word, Excel,
imagens, audio) em Markdown antes de servirem de contexto.

- Documentos originais ficam em `docs/` (nao processados).
- Versoes em Markdown, prontas para leitura, ficam em `knowledge/`.
- Para converter um novo documento: `ingest docs/arquivo.pdf`
- Para reprocessar uma pasta inteira: `ingest docs/`

Sempre que a tarefa envolver informacao de um documento (contrato, manual, livro,
especificacao), procure primeiro em `knowledge/*.md` antes de pedir o arquivo bruto
ao usuario — o Markdown ja esta estruturado e e mais confiavel que o PDF original.
