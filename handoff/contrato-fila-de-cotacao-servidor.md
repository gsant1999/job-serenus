# CONTRATO — a fila de cotação (o lado do servidor)

> Guilherme, 10/08/2026: *"cria uma conta dedicada, manda o contrato e começa."*
>
> O desenho inteiro está em `projeto-fila-de-cotacao.md` — **leia antes**, são
> cinco minutos e explica por que cada peça existe. Aqui está só a sua parte.
>
> **Conclua sem perguntar item por item** (seção 10 do `ESCOPO-ANTIGRAVITY.md`).
> Eu faço a extensão dos dois lados: o trabalhador no Dell e a espera na tela da
> consultora. **Você faz a fila.** Ela é o encontro dos dois — se a forma da
> resposta mudar, os dois lados quebram, então o formato abaixo é contrato.

---

## O que é

Uma máquina só (um Dell ligado o tempo todo, com um login do Painel do
Corretor) passa a cotar para as oito consultoras. O servidor é o **correio**
entre elas e essa máquina: guarda o pedido, entrega pro trabalhador, guarda o
resultado, devolve pra quem pediu.

Nenhuma credencial do Painel toca o servidor. O que trafega é pedido (cidade,
idades, operadoras) e resultado (preços).

---

## 1. A tabela

```sql
CREATE TABLE cotacao_fila (
  id            SERIAL PRIMARY KEY,
  usuario_id    INTEGER NOT NULL,      -- quem pediu
  sessao_id     INTEGER,               -- extensao_sessao de quem pediu
  pedido_json   TEXT NOT NULL,         -- opaco pro servidor: repassa como veio
  estado        TEXT NOT NULL,         -- 'esperando' | 'rodando' | 'pronto' | 'erro' | 'cancelado'
  resultado_json TEXT,
  erro          TEXT,
  etapa         TEXT,                  -- texto curto do progresso, ver secao 4
  criado_em     TIMESTAMP NOT NULL,
  pegado_em     TIMESTAMP,
  terminado_em  TIMESTAMP,
  trabalhador_sessao INTEGER           -- qual aparelho pegou
);
CREATE INDEX ix_cotacao_fila_estado ON cotacao_fila(estado, id);
```

**`pedido_json` e `resultado_json` são opacos.** Não interprete, não valide o
conteúdo, não "melhore". Eles são o contrato entre as duas pontas da extensão e
vão mudar de forma sem te avisar. Guarde e devolva igual.

Migração idempotente, no padrão dos 86 `add_col` que já existem.

## 2. Quem é o trabalhador

**Não invente detecção.** Se qualquer extensão puder se declarar trabalhadora,
uma consultora pega os pedidos das outras e trava a fila sem erro nenhum.

Uma coluna em `extensao_sessao`:

```
ALTER TABLE extensao_sessao ADD COLUMN trabalhador_cotacao INTEGER DEFAULT 0
```

- **Um por vez.** Ao marcar uma sessão, desmarque todas as outras na mesma
  transação. Não pode haver duas — duas máquinas cotando na mesma conta do
  Painel é exatamente o que este projeto existe pra evitar.
- Marcar/desmarcar: rota de admin, usada pela tela de aparelhos que **eu** vou
  montar. `POST /admin/extensao/sessao/<id>/trabalhador` com `{"ligado": true}`.
  Só admin.

## 3. As rotas

Todas com o mesmo guarda das outras rotas da extensão
(`chave_ou_login_ou_extensao`). Nenhuma inventa autenticação nova.

### `POST /api/whatsapp/cotacao/fila` — a consultora larga o pedido

Entrada: `{"pedido": <qualquer json>}`
Saída: `{"ok": true, "id": 123, "posicao": 2}`

`posicao` = quantos pedidos em `esperando` ou `rodando` estão na frente
(id menor). **Zero significa "é a próxima", não "não tem fila"** — a tela usa
esse número direto, então acerte a contagem.

Recuse com `{"ok": false, "motivo": "sem_trabalhador"}` (HTTP 200, não é erro
de programa) quando **não houver nenhuma sessão marcada como trabalhador, ou o
último sinal de vida tiver mais de 3 minutos**. É isso que faz a consultora ver
"a busca de preços está fora do ar" em vez de esperar para sempre.

### `GET /api/whatsapp/cotacao/fila/proximo` — o Dell pede trabalho

Só responde pedido se a sessão que chamou tiver `trabalhador_cotacao = 1`.
Qualquer outra: `{"ok": false, "motivo": "nao_e_trabalhador"}`.

Pega o **mais antigo em `esperando`**, marca `rodando`, grava `pegado_em` e
`trabalhador_sessao`, devolve `{"ok": true, "id": 123, "pedido": {...}}`.
Sem nada na fila: `{"ok": true, "id": null}`.

**A pegada tem que ser atômica** (`UPDATE ... WHERE estado='esperando'` com
`RETURNING`, ou `SELECT ... FOR UPDATE SKIP LOCKED`). Se o Dell perguntar duas
vezes rápido, não pode pegar o mesmo pedido duas vezes.

### `POST /api/whatsapp/cotacao/fila/<id>/etapa` — o Dell conta onde está

Entrada: `{"etapa": "buscando precos (3 de 6)", "fracao": 0.55}`
Grava e pronto. É o que faz a barra andar de verdade em vez de fingir.

### `POST /api/whatsapp/cotacao/fila/<id>/pronto` — o Dell devolve

Entrada: `{"resultado": <json>}` ou `{"erro": "texto curto"}`
Marca `pronto`/`erro`, grava `terminado_em`.

### `GET /api/whatsapp/cotacao/fila/<id>` — a consultora pergunta

Saída: `{"ok": true, "estado": "rodando", "posicao": 1, "etapa": "...",
"fracao": 0.55, "resultado": null}`

Quando `pronto`, vem o `resultado`. **Só quem pediu (ou admin) lê** — cotação
tem nome, telefone e preço de cliente.

### `POST /api/whatsapp/cotacao/fila/<id>/cancelar`

Só quem pediu. Marca `cancelado`. Se já estava `rodando`, marque assim mesmo —
o Dell descobre ao devolver e o resultado é descartado.

### `POST /api/whatsapp/trabalhador/vivo` — o sinal de vida

Só a sessão trabalhadora. Entrada: `{"painel_logado": true}`.
Guarde carimbo de tempo e o `painel_logado` (o Dell sabe dizer se a sessão do
Painel ainda vale).

`GET /api/whatsapp/trabalhador/estado` devolve o último sinal, se está vivo
(< 3 min) e se o Painel está logado. **Eu uso isso na tela; use você no aviso.**

## 4. Duas coisas que vão dar errado se não forem tratadas agora

**1. Pedido que ficou preso em `rodando`.** O Dell reiniciou no meio, o Chrome
matou a aba, acabou a luz. O pedido fica `rodando` para sempre e a consultora
espera para sempre.

Um pedido em `rodando` há mais de **3 minutos** volta pra `esperando` (uma vez
só; na segunda, vira `erro` com "não consegui buscar os preços"). Faça no
próprio `GET /fila/proximo` e no `GET /fila/<id>` — **não crie job novo no
APScheduler**: ele já é frágil (morre em restart, roda em duplicata com mais de
um worker) e este caminho não precisa dele.

**2. Fila que cresce sem ninguém olhar.** Pedidos `pronto` e `erro` com mais de
7 dias podem ser apagados. Sem isso a tabela vira lixo — e ela guarda telefone
de cliente, então não é só espaço, é dado sensível parado.

## 5. Teste antes de subir

1. `JOB_DATA_DIR=/tmp/x .venv/bin/python3 -c "import app"` — sobe.
2. `python3 scripts/ci_servidor.py` — as três passam.
3. Sem trabalhador marcado: `POST /fila` devolve `sem_trabalhador`.
4. Com trabalhador marcado mas sem sinal de vida há 4 min: **mesmo resultado**.
   (Este é o que costuma escapar.)
5. Sessão que **não** é trabalhador chamando `/fila/proximo`:
   `nao_e_trabalhador`.
6. Dois `GET /fila/proximo` seguidos com um pedido só na fila: o segundo devolve
   `id: null`. **Não pode entregar o mesmo pedido duas vezes.**
7. Pedido em `rodando` com `pegado_em` de 5 minutos atrás: volta pra
   `esperando`.
8. Usuário A não consegue ler o `/fila/<id>` do usuário B.

## 6. O que NÃO fazer

- **Não interprete o `pedido_json`.** Ele é meu contrato com a minha própria
  extensão e vai mudar.
- **Não cote no servidor.** O servidor não tem navegador e não tem sessão do
  Painel — e nunca vai ter. Isso já foi decidido e não é para reabrir.
- **Não guarde nada do Painel** (cookie, token, credencial). Se você precisar
  de algo assim para fazer funcionar, pare e me escreva na `conversa.md`:
  significa que eu desenhei errado.
- **Não mande a fila pro Sentry.** `pedido_json` tem telefone e nome de
  cliente.

## 7. Prioridade

**Na frente da sua fila**, depois de terminar a correção do `_limpar_url` (o
`\b` que deixa passar `cliente_telefone` — está no fim da `conversa.md`).

Escreva na `conversa.md` quando terminar: quais rotas subiram e o que o teste 6
(pegada dupla) devolveu.
