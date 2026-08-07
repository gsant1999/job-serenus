# Contrato — três dimensões que ainda sobrescrevem preço certo

> 07/08/2026. `app.py`, do Antigravity. Continuação direta do contrato da faixa
> de vidas, que já está em produção e funcionando.
>
> Levantamento pedido pelo Guilherme: *"a Amil era exemplo — todos os planos
> devemos entender a situação e montar a tabela por semelhança de situação."*

---

## O que a chave tem hoje

Depois da sua entrega, `_aprender_do_vivo` casa a linha por:

```
operadora · plano · modalidade · acomodacao · coparticipacao · cidade
· entidade · vidas_min · vidas_max · mei
```

Isso matou o defeito da quantidade de vidas. **Faltam três.**

---

## 1. Abrangência (Interior / Nacional / Regional)

O Painel devolve `plano.produto = {id, nome}` — é a abrangência. O JOB **já sabe
disso**: `_viva_para_apresentacao` grava `'abrangencia': produto.nome`, a coluna
`abrangencia` existe em `cotacao_tabela`, e a extensão a mostra como etiqueta
justamente porque ela distingue planos.

Mas `_aprender_do_vivo` **não a lê nem a usa na chave**.

Consequência, idêntica à da faixa de vidas: "Smart UP · Interior" e "Smart UP ·
Nacional" na mesma cidade, mesma acomodação e mesma coparticipação **caem na
mesma linha**, e o segundo apaga o preço do primeiro. São planos diferentes, com
rede diferente e preço diferente.

**Isso não é hipótese:** na tela de planos da Hapvida aparecem "Smart UP"
repetido com abrangências diferentes — foi o que motivou eu subir os atributos
comuns pro cabeçalho na extensão.

## 2. Linha (`tabela.nome`, ex. "Amil Saúde - Interior I")

Já é **gravada** na coluna `linha`, mas **não entra na chave**. É o rótulo
comercial da tabela; duas linhas do mesmo plano têm preço diferente e hoje se
sobrescrevem.

## 3. Administradora (só importa na adesão)

`plano.administradora` vem do Painel e **não é lida em lugar nenhum**. Na adesão,
a mesma entidade contratada por administradoras diferentes tem preço diferente —
é o negócio delas. Sem isso na chave, adesão é a modalidade que mais sofre.

---

## O que fazer

1. **Colunas:** `abrangencia` já existe. Criar `administradora TEXT` por migração
   (`linha` já existe).
2. **Ler do plano:** `p['produto']['nome']`, `p['tabela']['nome']`,
   `p['administradora']['nome']` — todos podem vir como string OU como
   `{id, nome}`. **Use `_texto_painel()`**, que já existe exatamente pra isso e
   já trata o `"$undefined"` que o Next.js manda quando o campo é `undefined`.
3. **Entrar na chave** do SELECT e do INSERT, com `COALESCE(campo,'')=?` como as
   outras.
4. **`calcular_cotacao` não muda** — ele já casa por `tabela_id`, e mais
   dimensões só significam mais linhas distintas, não lógica nova.

## O que NÃO fazer

- **Nenhum backfill.** As linhas antigas foram aprendidas sem essas dimensões;
  preenchê-las é inventar. Nulo é a verdade e a linha continua servindo pra
  consulta, só não colide com as novas.
- **Não derive abrangência do nome do plano.** "Smart UP Nacional" às vezes tem
  o nome dentro, às vezes não — e adivinhar é justamente o que produz o preço
  errado silencioso.

---

## Como saber que ficou completo

O jeito honesto não é conferir contra esta lista — é **contar**.

Rode a matriz que o Guilherme descreveu, agora valendo para qualquer operadora:
mesma cidade, mesmo plano, variando uma dimensão por vez. **Cada combinação que
o Painel responde com preço diferente tem que virar uma linha própria.** Se duas
combinações diferentes caírem na mesma linha, sobrou dimensão — e a contagem diz
quantas.

**Deixe isso medível em vez de opinável.** Um log em `_aprender_do_vivo` quando
um UPDATE muda um preço que já existia:

```
[COTACAO] preço trocado: <operadora>/<plano> faixa <fx> R$X -> R$Y
```

Preço trocando é normal (reajuste, cotação nova). **Preço trocando várias vezes
no mesmo dia, pra cima e pra baixo, é sinal de que duas perguntas diferentes
estão caindo na mesma linha** — que é exatamente o defeito, e hoje ele é
invisível.

---

## Antes de entregar

```bash
git status --short          # arquivo que não é seu? NÃO troque de branch
.venv/bin/python scripts/auditar.py <sua-branch>
.venv/bin/python scripts/checar_contrato.py
python3 -c "import ast; ast.parse(open('app.py').read())"
git log --oneline -1 origin/main
```

**Teste obrigatório:** grave o mesmo plano/cidade/vidas duas vezes, mudando só a
abrangência (Interior → Nacional). Tem que virar **duas linhas**. Repita para a
linha e para a administradora.

Um commit por dimensão, ou um só se preferir — mas **separado da auditoria de
leads**, que é outro assunto.
