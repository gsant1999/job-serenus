# Correções pendentes no backend de cotação

> Todas as linhas foram conferidas contra o `app.py` do commit **`e82e8f3`** (main,
> 06/08/2026). Confira `git log --oneline -1` antes de começar — se houver commit
> novo, os números andaram.
>
> Origem: revisão adversarial de 28 achados. **25 confirmados, 3 refutados.** Só o
> que está aqui foi verificado com a linha na mão; o que foi refutado ficou de fora.
>
> **Já corrigido, não refazer:** `c2db14d` (preço zero passava como elegível),
> `fd037c0` ("44–99 vidas" no cartão), `8b8f6c8` (falha ao listar não dizia o motivo),
> `004b4ad` (R$ 84 mil em cotações salvas apareciam como R$ 0,00), `e82e8f3`
> (cotação aberta pela ficha do lead nascia órfã do CRM).

---

## PRIORIDADE 1 — a flag `elegivel` não chega ao lead

**Por que é a primeira:** é dinheiro errado sendo gravado no CRM. Cinco achados
distintos da revisão são faces do mesmo problema.

### O que acontece

`calcular_cotacao()` (**app.py:29141**) é a **única** função que cria a chave
`elegivel` — em **app.py:29221**. E ela só alimenta rotas que devolvem JSON
(`/api/v1/cotacao/calcular` e `/cotacao/bloco/calcular`).

`registrar_cotacao_no_lead()` (**app.py:29227**), que é quem escreve no CRM, filtra
por essa chave em **app.py:29238**:

```python
planos_validos = [p for p in planos if p.get('elegivel', True) and (p.get('total') or 0) > 0]
```

O default é `True`. E **nenhum dos dois chamadores põe a chave**:

| Chamador | Linha | Como monta os planos |
|---|---|---|
| `_viva_para_apresentacao` (cotação ao vivo) | **app.py:27265** | laço próprio, sem `elegivel` |
| `/cotacao/salvar` | **app.py:29369** | laço inline em **29305-29320**, sem `elegivel` |

Resultado: `p.get('elegivel', True)` devolve `True` para todo mundo, sempre. O filtro
existe, tem docstring prometendo que funciona, e **nunca excluiu um plano na vida**.

### Dois vazamentos a mais dentro da própria função

Mesmo se a chave chegasse, dois trechos ignoram `planos_validos` e usam a lista crua:

- **app.py:29250** — `for p in planos:` monta `ops`, que vira o campo
  `operadora_cotada` do lead. Plano inelegível entra.
- **app.py:29265** — `totais = [float(p.get('total') or 0) for p in planos if (p.get('total') or 0) > 0]`
  alimenta a faixa de valor na timeline. Mesmo problema.

### E o motor duplicado voltou

O laço inline de `/cotacao/salvar` em **app.py:29312** faz `preco = pmap.get(fx, 0)` e
soma sempre (**app.py:29316**, `total_geral += total`), sem noção de elegibilidade.
Enquanto isso `calcular_cotacao` já corrige para `preco <= 0` (commit `c2db14d`) e só
soma `if elegivel`.

**O mesmo plano, para a mesma família, dá total diferente conforme o caminho.** É
exatamente o que descontinuar `/cotacao` tinha resolvido, e voltou por outra porta.

### O que fazer

Fazer `/cotacao/salvar` e `_viva_para_apresentacao` **usarem `calcular_cotacao()`** em
vez de recalcular inline. Uma conta, um lugar. Se por algum motivo não der, no mínimo:
gravar `elegivel` nos dois laços com a mesma regra (`preco <= 0` → `False`), e trocar
`planos` por `planos_validos` em **29250** e **29265**.

---

## PRIORIDADE 2 — o backfill de `entidade` é destrutivo e irreversível

**Está inerte hoje** (a flag `cot_entidade_backfill_20260805b` já está gravada em
produção e `cotacao_tabela` está zerada). **Volta a rodar no dia em que alguém limpar
a `meta_flags` para reprocessar depois de reimportar** — que é justamente o que se faz.
Corrigir antes disso.

### 2.1 O SELECT pega muito mais que Adesão — app.py:3828

```sql
WHERE modalidade LIKE '%Ades%' OR operadora LIKE '%Affix%'
   OR operadora LIKE '%SUPERMED%' OR linha LIKE '%(%'
```

O último termo entra **qualquer tabela com parêntese no campo `linha`**, de qualquer
modalidade e operadora. Uma linha "Amil Fácil (Campinas)" entra no backfill.

### 2.2 O UPDATE grava por cima do nome da operadora — app.py:3854

```python
conn.execute("UPDATE cotacao_tabela SET operadora=?, entidade=?, linha=? WHERE id=?", ...)
```

Qualquer registro selecionado que tenha `' - '` no nome da operadora cai no ramo
genérico e tem `operadora` reescrita. Não há cópia do valor antigo em lugar nenhum:
**é perda de dado sem volta.**

### 2.3 A entidade do SUPERMED sai com o parêntese grudado — app.py:3839-3841

`ent = op[11:].strip()` leva tudo depois de `'SUPERMED - '`, inclusive
`'(curso superior)'`. A limpeza de parêntese existe, mas está atrás de `if not ent`,
então nunca compõe com esse ramo. Resultado real:
`entidade = "ANASPL  (curso superior)"` em vez de `"ANASPL"`.

### 2.4 Não é idempotente e não faz rollback em SQLite

- A flag só entra **depois** do laço (**app.py:3856**). Se o laço morrer no meio, parte
  das linhas já foi alterada e a flag não existe.
- O rollback está atrás de `if is_pg:` (**app.py:3860**). Em SQLite as alterações
  parciais ficam pendentes, e o `conn.commit()` do Passo 4 grava esse estado.
- Na segunda passada, `linha` nunca foi limpa (o `new_lin` de **3835** não muda), então
  o ramo do parêntese reprocessa e **sobrescreve a entidade que já estava certa**.

### O que fazer

1. Tirar `OR linha LIKE '%(%'` ou restringir a `modalidade LIKE '%Ades%'`.
2. Não reescrever `operadora` sem antes guardar o original — sugiro gravar
   `operadora_original` numa coluna nova, ou só preencher `entidade` e deixar
   `operadora` intacta (a tela já mostra a entidade em linha separada).
3. `ent` do SUPERMED passa pela mesma limpeza de parêntese dos outros ramos.
4. Flag e alterações na **mesma transação**; rollback fora do `if is_pg`.
5. Limpar `linha` junto, senão a segunda passada desfaz a primeira.

---

## PRIORIDADE 3 — a deduplicação apaga a tabela ativa

Mesma situação: inerte hoje (flag `cot_dedup_duplicidades_20260805` gravada), volta a
rodar no reprocessamento.

### 3.1 A chave ignora `ativo` — app.py:3874

O `GROUP BY` usa operadora, plano, modalidade, acomodação, coparticipação, tipo_cnpj,
cidade e entidade. **Não inclui `ativo`, `linha`, `abrangencia` nem `vigencia`.** Uma
tabela ativa e uma desativada com os mesmos preços entram no mesmo grupo.

### 3.2 O sobrevivente é escolhido por id, não por qualidade — app.py:3883

`ORDER BY id DESC` mantém `tids[0]` (o id **maior**) e o `DELETE` em **app.py:3895**
apaga o resto. Então:

- se a linha **ativa** tem id menor, ela é a apagada e a **inativa** sobrevive;
- entre duas linhas vazias, sobrevive a de id maior, sem preferir a que tem faixas.

### 3.3 Nada reaponta `cotacao_salva.tabela_ids_json`

As cotações salvas guardam os ids das tabelas usadas (gravado em **app.py:29354**,
lido em **app.py:27251** e **app.py:29360**). O dedup apaga ids sem atualizar essas
referências: cotação antiga passa a apontar para tabela que não existe mais.

### 3.4 O Passo 4 roda mesmo se o Passo 3 falhou — app.py:3866

O `try` do dedup é independente e não consulta nenhum resultado do backfill (o `except`
de **3859** só imprime). Se o Passo 3 morreu no meio, o Passo 4 deduplica em cima de
`entidade` meio preenchida — e `entidade` **faz parte da chave de agrupamento**.

### O que fazer

1. `ativo` entra no `GROUP BY`, ou o dedup só considera `WHERE ativo=1`.
2. Escolher o sobrevivente por **completude** (mais faixas com `preco > 0`), depois por
   `atualizado_em` mais recente, e só então por id.
3. `UPDATE` em `cotacao_salva.tabela_ids_json` reapontando os ids fundidos — ou não
   apagar, só marcar `ativo=0`, que preserva a referência.
4. O Passo 4 só roda se o Passo 3 gravou a flag dele.

---

## O RESTO — confirmados, sem urgência

| # | O quê | Linha | Efeito |
|---|---|---|---|
| 1 | `status-tabelas` conta "completas" por número de LINHAS | **app.py:28517** | `HAVING COUNT(*) >= 10` sem `AND preco > 0`: 10 faixas zeradas contam como tabela completa. Mesmo defeito do `c2db14d`, em outro lugar. |
| 2 | ~94 linhas de código morto | **app.py:26354-26447** | `def cotacao()` (26349) faz `return redirect(..., 301)` na 26353; tudo abaixo é inalcançável até a 26449. |
| 3 | Ordenação perdeu a normalização de acento | **app.py:26892** | `x['operadora'].lower()` no lugar do `_norm_txt`: "Única Saúde" e "Unimed" ordenam errado entre si. |
| 4 | `planos_json` corrompido vira `planos_cotados: 0` com `ok: true` | **app.py:27014-27019** | `except: pass`. Cotação com JSON quebrado aparece como "0 planos" em vez de sinalizar erro. |
| 5 | Id inválido some sem aviso | **app.py:29159** | O pré-filtro `isdigit()` descarta antes de chegar ao aviso `plano_inexistente`. Quem chamou não sabe que o plano foi ignorado. |
| 6 | `total` de `/bloco/salvas` ignora o filtro `q` | **app.py:27046** | O contador do topo contradiz a lista devolvida quando há busca. |
| 7 | `total_geral` não é a soma dos `resultados` | **app.py:29213** | Plano inelegível fica na lista com seu total parcial, mas fora do `total_geral`, sem campo que explique. |
| 8 | `idade_min = 0` para tabela sem preço nenhum | **app.py:26868** | Indistinguível de "cobre desde recém-nascido". Devolver `null` quando não houver faixa medida. |
| 9 | Aviso diz "vidas não cobertas" mas o total conta essas vidas | **app.py:29204** | Texto e número discordam no mesmo payload. |
| 10 | `importar-pdc` perdeu a porta por módulo do `admin_required` | **app.py:28356** | `_checar_auth_escrita_cotacao` exige `perfil == 'admin'`; o `admin_required` antigo também liberava consultor com o módulo. Consultor que importava tabela deixou de conseguir. Pode ser intencional — confirme com o Guilherme. |

---

## Regras do projeto — valem para todo commit

Do `CLAUDE.md`:

1. **Sem emojis** em botões ou interface.
2. **Uma mudança por vez, commits pequenos.**
3. **Não fazer mudanças não solicitadas.**
4. Validar: `python3 -c "import ast; ast.parse(open('app.py').read())"`
5. Testar local antes do deploy: `JOB_DATA_DIR=/tmp/jobtest` + `app.app.test_client()`
   com sessão `{'user_id':1,'perfil':'admin'}`.

Armadilhas que já morderam **este** módulo:

- **`close_db(conn)` mata o que vem depois** — falha em silêncio dentro do try/except.
  Aconteceu 3× no projeto.
- **`is_pg` é local de `init_db()`.** Fora dela, `DB_MODE == 'postgres'`.
- **Erro em transação PG aborta tudo que veio antes.** Cada consulta de diagnóstico com
  try + rollback próprios.
- **Zero medido e zero por engano são indistinguíveis na tela.** Consulta que falha
  devolve `{"ok": false, "erro": ...}`, nunca a chave com zero. Foi o defeito do
  `7bf5bbc` e ele reapareceu duas vezes desde então (`004b4ad`, e o item 1 acima).
- **`templates/` é do Claude Code.** Se precisar de dado novo na tela, acrescente
  variável no contexto e avise — não edite o template.

## Divisão de trabalho

Branch `backend-cotacao` já foi mergeada. Para esta rodada: branch nova a partir de
`main`, **só `app.py`**, sem merge direto — o deploy sai automático do `main` e não há
staging.

```bash
git checkout main && git pull
git checkout -b cotacao-correcoes
```

**Rode do diretório principal com cuidado:** `git checkout -b` troca a branch do
diretório de trabalho compartilhado. Foi assim que três commits de frontend foram parar
na branch errada na semana passada.
