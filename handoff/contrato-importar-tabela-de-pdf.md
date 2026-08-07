# Contrato — receber tabela de preço vinda de PDF oficial da operadora

> 07/08/2026. `app.py`, do Antigravity. Uma migração e uma rota.
> Os extratores são meus e já estão em `main` (`scripts/extrair_*.py`,
> `scripts/casar_catalogo.py`). Eles leem e conferem; **nada grava ainda**.

---

## O que mudou no problema

Até ontem a `cotacao_tabela` só enchia de um jeito: `_aprender_do_vivo`,
uma cotação por vez, ~18,7 s por plano. Varrer o catálogo assim daria
**112 horas** de Painel ligado — medido, não estimado. Por isso a tabela tem 9
linhas e o motor local praticamente não responde.

A Affinity liberou as **tabelas oficiais em PDF**. Elas trazem a grade inteira
de uma vez, e com camada de texto — dá pra ler por programa, sem IA no meio.

Estado hoje, com os extratores já rodando:

```
Amil        9 PDFs   1.066 tabelas   10.660 preços
Vera Cruz   3 PDFs      10 tabelas      100 preços
```

**Conferido contra o que o Painel já tinha devolvido: 32 de 32 preços batem,
centavo a centavo, zero divergência.** Não é "confia": é comparação com dado
que já estava no banco (`cotacao_viva_preco`).

E 100% dos nomes de plano do PDF já casam com `catalogo_plano` — a ponte de
nomes está feita e testada ("Amil Prata" → `Prata`, "S6500 R3" no arquivo
Black → `S6500 Black R3`).

Falta o pedaço que é seu: **guardar**.

---

## 1. Migração

```sql
ALTER TABLE cotacao_tabela ADD COLUMN IF NOT EXISTS codigo TEXT DEFAULT '';
ALTER TABLE cotacao_tabela ADD COLUMN IF NOT EXISTS fonte  TEXT DEFAULT 'painel';
ALTER TABLE cotacao_tabela ADD COLUMN IF NOT EXISTS vigencia_pdf TEXT DEFAULT '';
```

`abrangencia`, `linha`, `administradora`,
`vidas_min/max` e `mei` **já existem** e já estão na chave. Não recrie.

**`codigo`** é o número do plano na operadora (`967048`) ou o registro ANS
(`498.081/24-6`). Ele é o único identificador que atravessa PDF, proposta e
sistema da operadora — o nome cada plataforma escreve de um jeito. Guardar
agora custa uma coluna; recuperar depois custa reimportar tudo.

**`fonte`** distingue linha aprendida do Painel (`'painel'`) de linha importada
do PDF (`'pdf'`). Sem isso não dá pra responder "de onde veio esse preço?", e é
a pergunta que aparece justamente quando um preço parece errado.

---

## 2. A rota

```
POST /cotacao/tabela/importar        @login_required + guard admin
```

Corpo — **este formato exato**, é o que meu script já cospe:

```json
{ "operadora": "Amil",
  "fonte": "pdf",
  "vigencia_pdf": "2026-06",
  "tabelas": [
    { "plano": "Prata",
      "codigo": "967071",
      "modalidade": "PME",
      "acomodacao": "QC",
      "coparticipacao": "30%",
      "linha": "Linha Amil",
      "abrangencia": "INTERIOR SP - 1",
      "administradora": "Amil",
      "cidade": "",
      "vidas_min": 3, "vidas_max": 4,
      "mei": 1,
      "faixas": { "00-18": 226.91, "19-23": 265.48, "24-28": 323.89,
                  "29-33": 388.67, "34-38": 408.10, "39-43": 448.91,
                  "44-48": 561.14, "49-53": 617.25, "54-58": 771.56,
                  "59 ou +": 1350.23 } }
  ] }
```

Os valores acima são reais — é o Amil Prata QC, MEI, coparticipação 30%,
Interior 1, faixa de 3 a 4 vidas. Os quatro primeiros preços já foram
conferidos contra o Painel e batem.

Resposta:

```json
{ "ok": true, "criadas": 812, "atualizadas": 254, "recusadas": 0,
  "precos_trocados": [ {"plano":"Prata","faixa":"19-23","de":265.48,"para":268.10} ] }
```

### Regras da gravação

1. **Mesma chave = UPDATE, não linha nova.** A chave é a que já existe hoje
   (operadora · plano · modalidade · acomodacao · coparticipacao · cidade ·
   entidade · vidas_min · vidas_max · mei), agora **mais** `abrangencia`,
   `linha` e `administradora`. Reimportar o mesmo PDF duas vezes tem que dar
   `criadas: 0` na segunda — se duplicar, a chave está incompleta.

2. **Recuse a tabela sem `vidas_min`/`vidas_max` ou sem `coparticipacao`.**
   Devolva no contador `recusadas` e siga com as outras. Linha sem faixa de
   vidas é exatamente o defeito que a gente acabou de consertar; deixar entrar
   pela porta nova desfaz o conserto.

3. **`precos_trocados` não é enfeite.** Toda vez que um UPDATE mudar um preço
   que já existia, registre no retorno e no log. Preço mudando é normal
   (reajuste). Preço mudando **pra cima e pra baixo no mesmo dia** é sinal de
   que duas perguntas diferentes estão caindo na mesma linha — e hoje isso é
   invisível.

4. **`fonte='pdf'` não pode ser sobrescrito por `_aprender_do_vivo` sem
   registro.** Se uma cotação ao vivo trouxer preço diferente do que veio do
   PDF, grave o preço novo (ele é mais recente) **e logue os dois**. Um dos
   dois está errado e a gente precisa saber qual — o silêncio aqui é o que
   transforma base grande em base grande e errada.

---

## 3. O que NÃO fazer — e o item 1 é o mais importante

**Não normalize a coparticipação.** O PDF manda `"30%"` e `"Parcial (TP)"`.
O catálogo do Painel tem `Completa`, `Completa 30%`, `Parcial`, `Parcial 30%`.
Parece óbvio qual vai em qual. **Não é, e eu deliberadamente não casei.**

Grave a string do PDF como veio. Se você "traduzir" e errar, o resultado é
preço certo guardado na coparticipação errada: a cotação sai com número
plausível e a conta do cliente vem diferente. Essa ligação a gente resolve
comparando preço com o Painel, não adivinhando nome.

**Não mexa em `_aprender_do_vivo`.** Ele continua funcionando como está. As
duas fontes convivem: PDF enche em lote, Painel corrige e cobre o que a
Affinity não publica (e ela não publica tudo — já verificamos).

**Não faça backfill de `fonte` nas linhas antigas.** Elas vieram do Painel,
então `'painel'` como default já é a verdade. Nada a preencher.

**Não crie tabela nova.** `cotacao_tabela` + `cotacao_preco` já têm o formato
exato do PDF. Faltavam três colunas, não um modelo novo.

---

## 4. Antes de entregar

```bash
git status --short          # arquivo que não é seu? NÃO troque de branch
.venv/bin/python scripts/auditar.py <sua-branch>
.venv/bin/python scripts/checar_contrato.py
python3 -c "import ast; ast.parse(open('app.py').read())"
git log --oneline -1 origin/main
```

**Teste obrigatório 1 — idempotência.** Importe o mesmo lote duas vezes. A
segunda tem que dar `criadas: 0, atualizadas: N`. Se criar de novo, duplicou.

**Teste obrigatório 2 — a recusa funciona.** Mande uma tabela sem `vidas_min`.
Tem que voltar em `recusadas` e **não** aparecer no banco. Forçe na mão; se
passar, a trava não existe.

**Teste obrigatório 3 — a dimensão nova separa.** Duas tabelas iguais em tudo,
mudando só `abrangencia` (`INTERIOR SP - 1` → `INTERIOR SP - 2`). Tem que virar
**duas linhas**. Esse par é real: as duas regiões do interior de SP têm preço
diferente, e foi assim que a gente descobriu.

**Lembrete que já custou confusão:** o Chrome carrega a extensão direto de
`extensao-whatsapp/` no diretório do repositório. Diretório em branch antiga =
o consultor volta de versão sem saber. Termine em `main`.

Um commit para a migração, um para a rota.

---

## 5. Depois que estiver de pé

Eu rodo a importação da Amil e da Vera Cruz e comparo linha a linha com os 32
preços do Painel — se algum divergir, o número aparece antes de qualquer
consultor cotar. Não vou dizer "importei 10.760 preços, confia".
