# CONTRATO — cidade, empresa, CNPJ e e-mail do lead

> Pedido do Guilherme, 09/08/2026:
> *"a célula cidade e empresa devem ser coisas diferentes. o botão/célula
> cidades deve puxar as cidades igual em cotações quando pedimos. o botão/
> célula da empresa deve puxar as informações do cnpj e da razão social
> quando disponível pelo cliente ou quando o usuário passar/analisar o cnpj do
> cliente na aba de cnpj. esses dados devem casar com o preenchimento no lead
> (crm) no job site."*
>
> Dono do servidor: **Antigravity**. Dono da extensão: **Claude**.
> **Conclua tudo o que está aqui sem perguntar item por item.** O contrato é a
> autorização — seção 10 do `ESCOPO-ANTIGRAVITY.md`.

---

## 0. O defeito, medido

Na ficha do CRM dentro da extensão existe **um campo só** rotulado
`Cidade / empresa`, gravando na coluna `crm_leads.empresa`
(`content.js`, `_fichaAbaDados`).

Ao mesmo tempo, o banco **já tem colunas separadas** para as duas coisas, como
campos de qualificação (`app.py:3094`):

```
("crm_leads", "qual_cidade", "TEXT"),
("crm_leads", "qual_cnpj",   "TEXT"),
```

Resultado prático, e é o que o Guilherme está sentindo: **existem dois lugares
para dizer a cidade do mesmo lead e eles não conversam.** O consultor preenche
na extensão, abre o CRM no site e o campo está vazio — ou o contrário.

`email` já existe como coluna e como campo na extensão. Não é o problema; ele
só está invisível debaixo do campo confuso acima.

---

## 1. A decisão que só você pode tomar, e ela vem primeiro

**Qual coluna é a verdade para CIDADE?** `crm_leads.empresa` (onde a extensão
grava hoje) ou `crm_leads.qual_cidade` (onde o CRM do site lê)?

Enquanto isso não estiver decidido, **eu não mexo na extensão** — se eu gravar
num lugar e o site ler no outro, o consultor preenche e a tela dele continua
vazia, que é exatamente o problema invertido.

**Você decide e executa**, sem perguntar. O critério: qual delas o CRM do site
já usa para exibir, filtrar e relatar. Essa ganha. A outra vira origem de
migração.

Escreva na `conversa.md` qual venceu e por quê. Uma linha basta.

---

## 2. O que fazer no servidor

### 2.1 Separar cidade de empresa

- `crm_leads.empresa` passa a guardar **só empresa/razão social**.
- Cidade passa a viver **na coluna que você decidiu na seção 1**.
- **Migração dos dados existentes:** o campo `empresa` hoje tem uma mistura —
  uns leads têm cidade ali, outros têm empresa, outros os dois separados por
  hífen ou barra. **Não adivinhe com regex.** Migre o que for inequívoco (bate
  exatamente com um nome de cidade do catálogo) e deixe o resto onde está,
  logando quantos ficaram. Um lead com o dado no campo errado é recuperável;
  um lead com o dado apagado por um regex esperto, não.
- Coluna nova entra **na lista de migração**, não só no `CREATE TABLE` —
  produção é sempre um banco velho.

### 2.2 Razão social e CNPJ

O JOB já consulta CNPJ (BrasilAPI, sem gov.br) — a rota existe e a tela de
CNPJ da extensão usa. O que falta é **guardar o resultado no lead**:

- `crm_leads.qual_cnpj` recebe o CNPJ (só dígitos, sem máscara — máscara é
  coisa de tela).
- `crm_leads.empresa` recebe a **razão social** devolvida pela consulta.
- Rota nova: `POST /api/whatsapp/lead/<lid>/cnpj` com `{"cnpj": "..."}`,
  que consulta, grava as duas colunas e devolve
  `{"ok": true, "razao_social": "...", "cnpj": "..."}`.
  Assim a extensão preenche com um clique em vez de o consultor copiar da tela
  de CNPJ e colar na ficha.

### 2.3 Cidades para a busca

A tela de cotação da extensão já busca cidade num catálogo — e **só a cidade
escolhida na lista serve**, porque o Painel do Corretor recusa string digitada
à mão. A ficha do lead precisa da **mesma lista**, senão o consultor grava
"Campinas" na ficha e "Campinas - SP" na cotação, e os dois nunca casam.

Reaproveite a fonte que a cotação já usa. Se ela hoje vem de uma rota que só a
cotação enxerga, exponha a mesma para a ficha — **não crie uma segunda lista
de cidades.**

### 2.4 A ficha tem que devolver os campos

`/api/whatsapp/lead/ficha` (ou o nome atual) passa a incluir, no `lead`:
`cidade` (da coluna vencedora), `empresa`, `cnpj`, `email`. E aceitar os
quatro no salvamento.

---

## 3. O que eu faço depois que você entregar

- Separar em dois campos: **Cidade** (com a mesma busca da cotação) e
  **Empresa**.
- Botão de consultar CNPJ dentro do campo Empresa, chamando 2.2.
- O e-mail sai de baixo do campo confuso e ganha lugar próprio, visível quando
  o lead está vinculado.

Não faço nada disso antes da seção 1 estar decidida.

---

## 4. Teste — contra Postgres

1. Lead com cidade em `empresa` → migração move ou deixa, e o log diz qual
2. Lead com empresa em `empresa` → **não** é movido
3. Gravar cidade pela extensão → aparece no CRM do site, no mesmo campo
4. Gravar cidade pelo site → aparece na extensão
5. `POST .../cnpj` com CNPJ válido → grava razão social e CNPJ, devolve os dois
6. CNPJ inválido → erro que diz o que fazer, sem gravar nada
7. Busca de cidade na ficha devolve **as mesmas strings** que a da cotação

Rota que você não viu responder não foi testada.

---

## 5. Prioridade

Este contrato entra **depois** do Lote 1 da API (`contrato-api-unificada.md`)
e da tela de chaves. Ele é o item 5 da fila.

Quando chegar nele, **conclua tudo** — decisão da seção 1, migração, as duas
rotas e o teste — e só escreva na conversa no fim, com o resultado. Perguntar
item por item é o que a seção 10 do escopo existe para evitar.
