# Contrato — a base de preço está sobrescrevendo preço certo com preço certo

> 07/08/2026. `app.py`, do Antigravity. Três coisas, a primeira é grave.
>
> Achado pelo Guilherme, verificado no código antes de escrever.

---

## 1. GRAVE — a tabela local não separa por quantidade de vidas

`_aprender_do_vivo` casa a linha da `cotacao_tabela` por:

```sql
WHERE operadora=? AND plano=? AND modalidade=? AND acomodacao=?
  AND coparticipacao=? AND COALESCE(cidade,'')=? AND COALESCE(entidade,'')=?
```

**Falta a faixa de quantidade de vidas.** E o preço por faixa etária depende
dela: 19-23 anos numa cotação de **2 vidas** custa diferente de 19-23 anos numa
de **20 vidas** — quanto mais vidas, mais barato por cabeça.

Hoje acontece isto:

1. Consultor cota Vera Prata para 2 vidas. Gravamos 19-23 = R$ 400.
2. Outro cota Vera Prata para 20 vidas. **Acha a mesma linha** e, pela regra
   "preço novo substitui o antigo", grava 19-23 = R$ 310.
3. A base agora responde R$ 310 para qualquer quantidade de vidas.

Não é preço velho vencendo preço novo — são **dois preços certos**, de perguntas
diferentes, um apagando o outro. E o erro é silencioso: a tabela fica bonita,
com data recente, respondendo errado.

### Por que é fácil de consertar

O Painel **já modela isso**. Cada plano vem com `tabela.qtdVidaMin` e
`tabela.qtdVidaMax`, e o próprio motor filtra por isso (`serve()` em
`cotador-painel.js`, linhas ~688). O mesmo plano aparece como linhas diferentes
para faixas de vidas diferentes. Nós é que colapsamos.

### O que fazer

1. **Duas colunas novas** em `cotacao_tabela` (migração, `ADD COLUMN IF NOT EXISTS`):
   `vidas_min INTEGER`, `vidas_max INTEGER`.
2. **Entram na chave** do `SELECT` e do `INSERT` de `_aprender_do_vivo`, lidas de
   `p['tabela']['qtdVidaMin']` e `['qtdVidaMax']`. Sem valor → `NULL`, e
   `COALESCE(vidas_min,0)=?` para casar.
3. **Entram também no cálculo** (`calcular_cotacao`): só serve a linha cuja faixa
   contém a quantidade de vidas pedida. Linha que não contém **não é resposta
   pior, é resposta errada** — melhor devolver "não tenho" do que um preço de
   outra faixa.
4. **MEI também falta.** `tabela.mei` diferencia plano e hoje é ignorado. Coluna
   `mei INTEGER DEFAULT 0`, na chave junto.

### O que NÃO fazer

**Não faça backfill nas 6 linhas que já existem.** Elas foram aprendidas sem
saber de qual faixa de vidas vieram — chutar é inventar preço. Deixe
`vidas_min/max` nulas e trate nulo como "não sei a faixa": pode ser mostrado com
ressalva, nunca usado como se fosse de todas.

---

## 2. `/cotacao/novo` não lê `?cidade=`

Uma linha. O `prefill` lê `idades`, `modalidade`, `acomodacao`, `coparticipacao`,
`mei`, `op`, `cliente_*` — mas não `cidade`:

```python
'cidade': (request.args.get('cidade') or '').strip(),
```

A extensão (3.41.0) já manda `?cidade=Campinas - SP`, e o template já consome
`PREFILL.cidade` (commit `9323c30`). Falta só a rota passar adiante. Sem isso o
consultor preenche a cidade no painel, clica em "abrir no JOB" e digita de novo.

---

## 3. Cidade padrão: extensão e site guardam em lugares diferentes

O site guarda por usuário no banco (`_pref_cotacao`, rota `/cotacao/preferencia`,
por sessão). A extensão guarda na máquina (`chrome.storage.local`), porque não
tem sessão. Resultado: trocou de computador, perdeu; e a cidade do site e a da
extensão podem divergir sem ninguém entender por quê.

```
GET  /api/whatsapp/preferencias?usuario_id=7   -> {"ok": true, "cidade": "Campinas - SP"}
POST /api/whatsapp/preferencias  {"usuario_id": 7, "cidade": "Campinas - SP"}
     _wa_auth_ok() + _wa_cors()
```

Reaproveitar `_pref_cotacao`/a gravação que já existe, trocando
`session['user_id']` por `usuario_id` do corpo — **validando que o usuário existe
e está ativo**, como em `/api/whatsapp/cotacao/salvar`.

Prazo curto e falha silenciosa: sem isto a extensão usa a cópia local, como hoje.

---

## 4. Pequeno, mas some da tela: `#salvas` não mostra o lead

`/cotacao/bloco/salvas` devolve por cotação: `id, titulo, token, valor_total,
planos_cotados, criado_em, cliente_nome, cliente_email, cliente_telefone`.
**Não devolve `lead_id`.** A cotação está ligada ao lead no banco (conferi), mas
a lista não deixa ver de quem é nem chegar na ficha.

Incluir `lead_id` (e `lead_nome` por join, se for barato) no retorno. A tela é
minha, eu ligo depois.

---

## 5. O que foi CONFERIDO e está certo — não mexer

Testado com dado real, não deduzido:

| | |
|---|---|
| cotação salva pela extensão aparece em `/cotacao/novo#salvas` | sim |
| `lead_id` gravado em `cotacao_salva` | sim |
| `registrar_cotacao_no_lead` escreveu `valor_estimado` no lead | sim |
| coluna `cidade` gravada pela rota da extensão | sim |
| `?lead=`, `?cliente_nome=`, `?modalidade=`, `?fx_0..9=` chegam no PREFILL | sim |

---

## 6. Antes de entregar

```bash
git status --short          # arquivo que não é seu? NÃO troque de branch
.venv/bin/python scripts/auditar.py <sua-branch>
python3 -c "import ast; ast.parse(open('app.py').read())"
git log --oneline -1 origin/main
```

**Um commit por item** — são quatro assuntos diferentes, e o item 1 é o único
que mexe em dado gravado. Se algo der errado, o item 1 tem que poder voltar
sozinho.

**Teste obrigatório do item 1:** grave o mesmo plano/cidade duas vezes, uma com
`qtdVidaMin=1,qtdVidaMax=2` e outra com `qtdVidaMin=10,qtdVidaMax=29`, e confira
que viraram **duas linhas** em `cotacao_tabela`, cada uma com seus preços. Se
virar uma linha só, a chave não está completa.

---

## 7. A matriz que o Guilherme mandou rodar — e por que ela vem DEPOIS

Ele descreveu o teste de aceitação certo, no Painel, na mão:

> Amil · Campinas **e** São Paulo · 2, 5, 10, 20 e 30 vidas · com MEI **e** sem
> MEI · produto Bronze.

São 2 cidades × 5 quantidades × 2 (MEI) = **20 cotações do mesmo plano**, que
hoje devolvem preços diferentes e amanhã têm que virar **20 linhas** na
`cotacao_tabela` — não uma linha reescrita 20 vezes.

**Rodar essa matriz ANTES do conserto piora a base, não melhora.** Cada cotação
acha a mesma linha e sobrescreve a anterior; ao fim das 20, sobra o preço da
última, colado num plano que parece ter preço para todas as situações. Hoje são
6 linhas erradas; depois da varredura seriam 6 linhas erradas com cara de
completas.

**Ordem:** conserta a chave (item 1) → roda a matriz → confere que nasceram 20
linhas distintas. Se nascerem menos, a chave ainda está incompleta e a
contagem diz exatamente quantas dimensões faltam.
