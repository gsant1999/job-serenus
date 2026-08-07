# Contrato — `dias` negativo e cidade perdida ao reabrir

> 07/08/2026. `app.py`, do Antigravity. Dois ajustes pequenos, achados testando
> a entrega anterior — que foi mergeada e está em produção (`a321793`).
>
> **A rota `/api/whatsapp/cotacao/salvar` está correta.** A falha que apareceu
> no primeiro teste foi do **meu contrato**, que descreveu um formato de plano
> achatado que não existe no sistema. Corrigido do meu lado na extensão 3.36.0.

---

## 1. `dias` volta negativo — `/api/whatsapp/cotacoes`

Cotação salva agora aparece na conversa como **`dias: -1`**.

**Causa medida.** O Postgres de produção roda em `Etc/UTC`
(`current_setting('TimeZone')`) e `criado_em` é gravado sem fuso, pelo
`DEFAULT CURRENT_TIMESTAMP` — ou seja, **é um horário UTC**. A rota faz:

```python
if dt_criacao.tzinfo is None:
    dt_criacao = TZ_SP.localize(dt_criacao)     # <- trata UTC como se fosse SP
dias = (agora_date - dt_criacao.date()).days
```

`localize()` não converte: ele *carimba* o fuso. Um horário UTC carimbado como
São Paulo fica 3 horas adiantado. Toda cotação feita **depois das 21h de
Brasília** cai no dia seguinte e devolve `dias = -1`.

Não é caso raro: é justamente o horário em que se atende cliente no WhatsApp.

**Conserto:** carimbar UTC e depois converter para São Paulo.

```python
if dt_criacao.tzinfo is None:
    dt_criacao = pytz.utc.localize(dt_criacao).astimezone(TZ_SP)
```

**Confirme com dado, não com leitura** — salve uma cotação e confira que
`dias` é `0`:

```bash
curl -s -H "X-Extension-Key: $WHATSAPP_EXT_KEY" \
  "http://localhost:8080/api/whatsapp/cotacoes?lead_id=<id>" | python3 -m json.tool
```

**Verifique se o mesmo carimbo aparece em outro lugar.** `TZ_SP.localize(` sobre
valor vindo do banco tem o mesmo defeito em qualquer rota:

```bash
grep -n "TZ_SP.localize(" app.py
```

Onde o valor for horário do banco, é UTC e precisa de `astimezone`. Onde for
horário construído no código (um `datetime(2026, 8, 6, 9, 0)` literal), o
`localize` está certo — decida caso a caso, não troque em massa.

---

## 2. `cidade` some ao reabrir — `cotacao_novo()`

O prefill de `/cotacao/novo?de=<cid>` faz:

```python
prefill['cidade'] = planos[0].get('cidade') or ''
```

Só que os planos gravados em `planos_json` **não têm a chave `cidade`**. Quem
monta esse JSON é `_viva_para_apresentacao`, e as chaves de cada plano são:
`operadora, plano, modalidade, acomodacao, coparticipacao, abrangencia,
vigencia, linhas, total, recomendacao, elegivel`.

Resultado: `prefill['cidade']` é **sempre** string vazia. O consultor clica em
"Nova versão", recupera cliente, lead, idades e tipo — e tem que digitar a
cidade de novo. Sem cidade a tela não cota.

**De onde tirar de verdade:** `cotacao_viva.cidade`, que já é gravada. A ligação
é por lead + proximidade de horário, ou — melhor — **gravando o vínculo**: hoje
não existe coluna ligando `cotacao_salva` à `cotacao_viva` que a originou.

Duas saídas, escolha e diga qual:

- **(a) Coluna nova** `cotacao_salva.viva_id`, preenchida nas duas rotas que
  gravam (`/cotacao/viva/salvar` e `/api/whatsapp/cotacao/salvar`). Reabrir lê
  a cidade de lá. Resolve para as cotações **novas**; as antigas continuam sem.
- **(b) Coluna `cidade` direto em `cotacao_salva`**, preenchida no INSERT.
  Mais simples, e o reabrir passa a ler um campo só.

**Prefiro a (b)** — a cidade é atributo da cotação, não de um plano dela, e
guardar onde se lê evita um JOIN que só existe pra desfazer um erro de modelagem.

**Migração:** as 43 cotações que já existem ficam com `cidade` nula. Não invente
valor pra elas — nulo é a verdade, e o consultor digita. **Não escreva backfill
que chute cidade a partir do plano.**

---

## 3. O que NÃO precisa mudar

Confirmado por teste, não deduzido:

| caso | resultado |
|---|---|
| sem lead nem telefone | `sem_lead`, 400 |
| `usuario_id` inexistente | `usuario_invalido`, 400 |
| sem `usuario_id` | `usuario_invalido`, 400 |
| sem chave da extensão | 401 |
| cotação de R$ 1.247,90 | gravada como 1247.9, com `origem='whatsapp'` |
| `/cotacao/3/reabrir` | 302 → `/cotacao/novo?de=3`, lead religado, idades "5, 50" |
| `/cotacao/9999/reabrir` | 302 → `/cotacao/novo`, sem 404 |

O `_last_insert_id(conn.cursor()…)` com fallback é o mesmo padrão da rota que já
existia — mantive.

---

## Antes de entregar

```bash
git status --short          # arquivo que não é seu? NÃO troque de branch
.venv/bin/python scripts/auditar.py <sua-branch>
python3 -c "import ast; ast.parse(open('app.py').read())"
git log --oneline -1 origin/main
```

Branch a partir de `main`, só `app.py`. Um commit por assunto: o fuso e a cidade
são dois problemas diferentes.
