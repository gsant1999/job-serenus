# CONTRATO — rede de segurança: gunicorn, CI e Sentry

> Guilherme, 09/08/2026: *"manda o Antigravity fazer os três agora"*.
>
> Vem de `auditoria-base-para-escalar.md`. São os três itens que fecham o
> buraco real antes de vender o JOB para outra corretora.
>
> **Conclua os três sem perguntar item por item** — seção 10 do
> `ESCOPO-ANTIGRAVITY.md`. Mas leia as armadilhas: o item 1 tem uma que
> quebra em produção e não aparece em teste local.

---

## 1. Produção sai do servidor de desenvolvimento

### O que fazer

`railway.json` hoje:

```json
"startCommand": "python3 -u app.py"
```

Isso sobe `app.run()` do Werkzeug — o servidor de desenvolvimento do Flask, um
processo, sem gestão de workers. O `Procfile` já tem o comando certo e o
`gunicorn==21.2.0` já está no `requirements.txt`, instalado e sem uso:

```
web: python3 init_production.py && gunicorn -w 3 -b 0.0.0.0:$PORT --timeout 300 app:app
```

Leve esse comando para o `startCommand`. **Confira também no painel do
Railway**: se houver um Start Command escrito lá, ele vence o arquivo, e o
Guilherme precisa trocar na mão.

### ⚠️ A ARMADILHA — leia antes de subir

**Hoje é um processo. Com `-w 3` passam a ser três.** Tudo que hoje é
"uma vez por servidor" vira "três vezes", e nada disso dá erro — só faz o
trabalho em triplicata, em silêncio:

| o que | onde | o que acontece com 3 workers |
|---|---|---|
| APScheduler (backup 22:00 + import de leads) | `_iniciar_scheduler_backup` | **3 backups e 3 importações** por agendamento |
| `_AUTO_PULL_LOCK` (trava do pull por requisição) | módulo | é um lock **por processo** — não trava nada entre workers |
| `_ULTIMO_AUTO_PULL` (throttle de 10 min) | variável de módulo | cada worker tem o seu → até 3 pulls por janela |
| `_API_USO` (limite por minuto da API) | dicionário de módulo | o limite vira **3× o configurado** |
| `_CNPJ_CACHE`, `_estado`/cachês em memória | módulo | cada worker com o seu — não é erro, só menos eficiente |

**Sem tratar isso, o import de leads pode rodar em paralelo consigo mesmo** — e
esse job cria lead. Duplicata de lead é dado sujo que alguém vai limpar à mão
depois.

### Como resolver (escolha e diga qual escolheu)

**Opção A — o scheduler só no primeiro worker.** Gunicorn não numera workers de
forma estável, mas dá para eleger um dono por arquivo de trava no volume
(`/data/scheduler.lock`, criado com `O_CREAT|O_EXCL`): quem conseguir criar,
roda; os outros não. Simples e sem dependência nova.

**Opção B — trava no banco.** Uma linha em `meta_flags` com carimbo de tempo:
antes de rodar o job, tenta marcar "estou rodando desde X"; se já houver marca
recente, desiste. Funciona também entre instâncias e é o mesmo padrão da trava
da migração que você já fez.

**Prefiro a B** — sobrevive a restart, funciona com qualquer número de workers e
usa mecanismo que já existe no projeto. Mas a decisão é sua; diga na conversa.

O limite da API (`_API_USO`) também precisa virar contagem no banco, ou aceitar
explicitamente que o teto é por worker (e então escrever isso no comentário,
para ninguém debugar isso daqui a seis meses).

### Teste antes de subir

1. `JOB_DATA_DIR=/tmp/x python3 -c "import app"` — sobe.
2. Rodar local com `gunicorn -w 3` e conferir **nos logs** que o scheduler
   anuncia início **uma vez só**, não três.
3. Uma requisição de cada família (login, uma rota da extensão, uma da API).

---

## 2. CI — quatro perguntas antes de qualquer coisa subir

`.github/workflows/ci.yml`, rodando em todo push e pull request. **Não é
cobertura de teste** — são quatro verificações que teriam pego os três defeitos
de hoje:

1. **O app sobe.** `JOB_DATA_DIR=/tmp/ci python3 -c "import app"`.
   Pega o `NameError: name 'requer' is not defined` que o `ast.parse` deixou
   passar e que teria derrubado o site inteiro no deploy.

2. **Nenhuma rota aponta para a função errada.** Percorrer `app.url_map` e
   falhar se algum endpoint responder por caminhos de famílias diferentes
   (ex.: `/api/whatsapp/...` servido por `admin_*`). Pega o
   `POST /api/whatsapp/logout` que passou a executar `admin_extensao_sessoes`.
   Alias legítimos (`/crm/lead/...` e `/lead/...`) entram numa lista de exceções
   explícita — se a lista crescer, é sinal, não conveniência.

3. **As rotas críticas respondem o status certo.** Com o app de teste em
   SQLite: sem credencial → 401/403; com `X-Extension-Key` de teste → 200.
   Cubra pelo menos `/api/whatsapp/extensao/modelos`, `/api/whatsapp/estado`,
   `/api/v1/cotacao/planos` e `/api/whatsapp/cotacao/salvar`.
   Pega mudança de decorador que fecha a porta de quem ainda usa a chave antiga.

4. **O pacote da extensão está completo.** Rodar
   `scripts/checar_extensao.sh` (já existe: compila todo JS e tem piso de
   contagem de funções) e conferir que **todo arquivo declarado no
   `manifest.json` existe**. Pega as 46 funções que sumiram num recorte e o
   logo que entra no pacote sem entrar no `web_accessible_resources`.

**Sem segredo nenhum no CI.** Tudo roda em SQLite com `JOB_DATA_DIR`
temporário. Se algum teste precisar de chave de verdade, o teste está errado.

Deixe os quatro **falhando o build** de verdade — CI que só avisa é CI que
ninguém lê.

---

## 3. Sentry — saber que quebrou antes do cliente sumir

`sentry-sdk[flask]` no `requirements.txt`, ligado por `SENTRY_DSN` no ambiente.
**Sem DSN, não liga e não reclama** — instância de cliente que não configurar
segue funcionando igual.

### O cuidado que não é opcional

Este sistema carrega **conversa de cliente e dado de saúde**. Um relatório de
erro que leve o corpo da requisição junto vira vazamento de dado sensível para
um terceiro, e isso é LGPD.

- `send_default_pii=False` (é o padrão — não mude).
- Um `before_send` que **remove o corpo da requisição** e apaga cabeçalhos
  `Authorization`, `X-API-Key` e `X-Extension-Key`.
- Nada de mandar `conversa_json`, transcrição, texto de mensagem ou base64 de
  documento. Se for preciso contexto, mande **id do lead**, não o conteúdo.
- `traces_sample_rate` baixo (0.05) ou desligado: performance não é o problema
  hoje e amostragem alta custa dinheiro.

Marque a versão (`release`) com o hash do commit, para saber em qual deploy o
erro apareceu.

### Teste

Uma rota escondida que levanta exceção de propósito, chamada uma vez, e
confirmar que o evento chegou **sem corpo de requisição e sem cabeçalho de
autenticação**. Depois apague a rota.

---

## 4. Ordem e prioridade

Nesta ordem: **1 → 2 → 3**. O item 1 é o de maior ganho, mas é o único que pode
piorar as coisas se a armadilha dos três workers não for tratada — então ele
vai primeiro e vai com cuidado.

Os três entram **na frente** do resto da sua fila, por decisão do Guilherme.

Escreva na `conversa.md` no fim: qual opção você escolheu para a trava do
scheduler, e o que o CI pegou (ou não pegou) na primeira execução.
