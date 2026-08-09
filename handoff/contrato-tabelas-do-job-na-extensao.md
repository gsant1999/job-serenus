# CONTRATO — as tabelas do JOB entram na cotação da extensão

> Pedido do Guilherme, 09/08/2026:
> *"POR QUE NÃO CONSIGO FAZER MIX DE OPERADORAS NA ABA DE COTAÇÃO NA EXTENSÃO
> E NO SITE DA CERTO, PRECISO PODER FAZER TBM. E SE DESEJAR COTAR PARA 59
> ANOS, BENEFICÊNCIA VITAL E MEDSÊNIOR (CAMPINAS 1 E CAMPINAS 2) HOJE NA
> EXTENSÃO EU NÃO CONSIGO."*
>
> Dono do servidor: **Antigravity**. Dono da extensão: **Claude**.
> **Conclua tudo sem perguntar item por item.** Seção 10 do `ESCOPO-ANTIGRAVITY.md`.

---

## 0. O defeito, medido

A cotação da extensão fala com **uma fonte só**: o Painel do Corretor, pela
sessão do consultor. Tudo o que ela lista — cidades, operadoras, planos,
preço — vem de lá.

MedSênior, Beneficência Vital, Santa Tereza e as grades de PDF da Hapvida
**não estão no Painel**. Elas estão no JOB, na tabela `cotacao_tabela` +
`cotacao_preco`, importadas de PDF. Por isso ele não consegue cotá-las na
extensão: não é limitação de tela, é fonte que não está ligada.

É a mesma causa do "não consigo misturar operadoras": misturar exige que as
duas fontes caiam no mesmo comparativo.

## 1. O que precisa mudar no servidor — e é pouco

As duas rotas **já existem e já fazem exatamente o que falta**:

| rota | o que faz | linha aprox. |
|---|---|---|
| `GET /api/v1/cotacao/planos` | lista `cotacao_tabela` com os preços por faixa | `app.py:19519` |
| `POST /api/v1/cotacao/calcular` | calcula por idades cruas, sem salvar | `app.py:19548` |

A segunda tem no próprio docstring: *"É o que a extensão usa pra mostrar preço
na conversa sem sujar o banco"*. **Ela nunca foi usada pela extensão** — porque
as duas estão atrás de `@api_requer_chave('cotacao:ler')`, que exige registro
em `api_chave`. A extensão entra por token do consultor.

### 1.1 Trocar o decorador nas duas

```python
@login_ou_extensao        # no lugar de @api_requer_chave('cotacao:ler')
```

É o mesmo decorador que `GET /api/v1/cotacao/<cid>/imagem` já usa, aberto pra
extensão em 08/08 por decisão dele. **Não invente autenticação nova.**

Cuidado real: a chave `'GABRIEL TESTE'` foi revogada, mas confira se alguma
chave viva usa o escopo `cotacao:ler` antes de trocar. Se usar, aceite os
**dois** caminhos em vez de trocar — chave OU sessão/extensão.

### 1.2 Dois filtros que faltam em `/planos`

A extensão precisa montar a lista sem baixar tudo:

- `?operadoras=1` → devolve só `{"ok": true, "operadoras": [{"nome": "...",
  "planos": 12}]}`. Sem isso a extensão baixa 500 tabelas com todos os preços
  só pra desenhar a lista de operadoras.
- `?abrangencia=` → o filtro já existe pra `modalidade`, `acomodacao`,
  `coparticipacao` e `operadora`; **`abrangencia` ficou de fora**, e é
  justamente a coluna que separa **MedSênior Campinas 1 de Campinas 2**.

### 1.3 `/planos` devolve `vidas_min` e `vidas_max`

Fui conferir e retiro o que ia pedir aqui: `/calcular` **já** devolve
`abrangencia` e `vigencia` em cada item de `resultados` (`calcular_cotacao`,
final da função). Não mexa nisso.

O que falta mesmo é em `/planos`: ele monta o JSON à mão e deixa de fora
`vidas_min` e `vidas_max`, que existem na tabela e que `calcular_cotacao` usa
pra recusar plano fora da faixa. Sem eles a extensão deixa marcar um plano de
5 a 29 vidas numa cotação de 2, e o consultor só descobre no cálculo. Inclua
os dois.

## 2. O que eu faço na extensão (já construído contra este contrato)

Uma segunda fonte na tela de operadoras, chamada **Tabelas do JOB**, com as
mesmas gavetas da outra (MEI > coparticipação > produto). O preço vem de
`/calcular` com as idades cruas — por isso 59 anos funciona sem faixa.

O resultado entra no **mesmo** `_cotFeitas` do Painel: o comparativo mistura as
duas fontes, e o "Salvar no JOB" salva tudo junto, com a origem marcada em
cada plano.

Enquanto 1.1 não estiver no ar, a fonte aparece com a razão escrita na tela —
não some e não mente.

## 3. Teste — contra Postgres

1. `GET /api/v1/cotacao/planos` com token de consultor → 200 (hoje é 401)
2. `?operadoras=1` → lista curta, sem preço
3. `?operadora=MedSênior&abrangencia=Campinas 2` → só as tabelas dessa
4. `POST /calcular` com `{"idades":[59],"planos":[<id>]}` → preço da faixa 59+
5. Cada item de `/planos` traz `vidas_min` e `vidas_max`
6. Chave de API antiga (se alguma viva usar `cotacao:ler`) continua passando

Rota que você não viu responder não foi testada.

## 4. Prioridade

Entra **depois** do Lote 1 da API e da tela de chaves — mas na frente do
contrato 5 (cidade/empresa/CNPJ), porque é o que o Guilherme está pedindo
agora e o lado da extensão já está pronto esperando.
