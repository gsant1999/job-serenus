# Painel do Corretor — como cotar sem abrir a tela

Levantado em 02/08/2026 a partir de duas sessões reais mapeadas no console
(Campinas/Hortolândia e São Paulo). Não é engenharia reversa de código deles:
é a leitura do que a própria página faz na sessão do Guilherme.

## Resposta curta

Dá pra cotar chamando o servidor deles direto. **Não precisa preencher formulário
nem clicar em nada.** A entrada é JSON limpo, a saída tem preço legível, e o
tempo mediano é ~130ms por chamada.

Consequência prática: **o JOB não guarda tabela de preço.** Cota ao vivo. O banco
guarda só o histórico do que já foi cotado — que serve pra responder se o painel
cair, e pra detectar reajuste comparando a mesma combinação semana a semana.

## As três chamadas que importam

Todas são Server Action do Next: `POST` na própria URL da página, com
`accept: text/x-component` e o cabeçalho `next-action` identificando qual função
roda no servidor deles. O corpo é um array JSON.

### 1. Criar a cotação (uma vez por sessão de trabalho)

```
POST /cotacoes/nova
next-action: 404f23429dd72035eb53050a99130f3b1df5350699
corpo: [{"titulo":"Cotação"}]
→ 303, e o id novo sai na URL de destino (UUID v7)
```

### 2. Listar os planos de uma operadora naquela cidade  ·  ~110ms

```
POST /cotacoes/<id>/edit?d=cenarios
next-action: 40c24f4d13ad0bcd73632205630d14bdf5fdfb8d82
corpo: [{
  "cidade": "São Paulo - SP",        // exatamente como vem do /api/cidades
  "modalidade": 2,                    // 2 = PME
  "credenciados": [],
  "perfil": "$undefined",
  "busca": "$undefined",
  "vidas": [{"faixa":"00-18","quantidade":1}, ... {"faixa":"59-199","quantidade":1}],
  "operadoraId": 93
}]
```

Volta a lista de combinações plano × tabela, em JSON direto — sem preço ainda
(`"valor":"$undefined"`), mas com tudo que descreve a oferta:

```json
{"key":"93-60605-88325-","modalidade":2,
 "administradora":{"id":93,"nome":"Amil"},
 "operadora":{"id":93,"nome":"Amil"},
 "produto":{"id":8797,"nome":"Amil Saúde - SP"},
 "plano":{"id":60605,"nome":"Bronze SP","acomodacao":0},
 "tabela":{"id":88325,"nome":"Linha Amil","contratacao":0,"remissao":false,
           "coparticipacao":true,"coparticipacaoTipo":"Parcial ",
           "mei":true,"qtdVidaMin":5,"qtdVidaMax":29}}
```

Repare que `qtdVidaMin`/`qtdVidaMax`, `mei` e `coparticipacao` já vêm aqui — dá
pra descartar o que não serve pro perfil do cliente ANTES de pedir preço, e
economizar chamada.

### 3. Pedir o preço de um plano  ·  240–860ms

```
POST /cotacoes/<id>/edit?d=cenarios
next-action: 6063cb77d7105b361840a5d5ae6fb52576abc990e3
corpo: ["<id da cotação>", { ...o objeto inteiro do passo 2, com o "key"... }]
```

A resposta é o render da tela (formato RSC), e dentro dele o preço vem em texto
normal:

- total mensal: `{"value":8858.28}`
- quebra por faixa: `"00 a 18"` … `1," x ","R$ 362,63"`, e assim por diante

Foi conferido em cinco planos diferentes (Amil Bronze SP e Alice Equilíbrio,
entre outros): total e quebra por faixa saíram em todos.

### De brinde: busca de cidade

```
GET /api/cidades?term=hortolandia
→ ["Hortolândia - SP", ...]
```

API JSON limpa. É daí que sai a string exata que os passos 2 e 3 esperam —
não adianta montar "São Paulo/SP" na mão, tem que ser o formato deles.

## As variáveis, com o nome que eles usam

| O que o consultor escolhe | Campo |
|---|---|
| Cidade | `cidade` — string `"Cidade - UF"`, vinda do `/api/cidades` |
| Faixa etária e vidas | `vidas[]` com `faixa` (`00-18` … `59-199`) e `quantidade` |
| Tipo de contratação | `modalidade` (2 = PME) |
| Operadora | `operadoraId` |
| Produto / plano | `produto.id`, `plano.id` — vêm do passo 2 |
| Acomodação | `plano.acomodacao` (0/1) |
| Coparticipação | `tabela.coparticipacao` + `coparticipacaoTipo` |
| MEI | `tabela.mei` |
| Mín/máx de vidas | `tabela.qtdVidaMin` / `qtdVidaMax` |

## O que trava, e como não travar

**O `next-action` muda a cada deploy deles.** É um hash da função no servidor.
Se a gente fixar no código, quebra silenciosamente no dia em que eles subirem
versão nova — e o pior tipo de quebra é a que devolve resultado errado em vez
de erro. Então: ler o hash da própria página no momento do uso, e ter um
canário que avisa quando nenhum dos três for encontrado.

**A sessão é a do corretor.** Nada disso funciona sem o login dele já ativo na
aba. É por isso que roda na extensão e não no servidor do JOB: quem chama é o
navegador do próprio consultor, com a sessão que ele já abriu. Nenhuma
credencial passa pelo JOB.

**O formato RSC não é contrato.** O passo 2 devolve JSON de verdade e é estável.
O passo 3 devolve o render da tela — o preço está lá em texto claro, mas a
posição dele pode mudar quando eles mexerem no layout. A leitura tem que ser
por âncora semântica (a chave da faixa, o `R$`), nunca por posição, e o canário
tem que gritar se um plano voltar sem preço.

## Quanto tempo leva um multicálculo

Medido: 22 chamadas reais, mediana 130ms, pior caso 858ms.

Uma cotação completa = 1 chamada de lista por operadora + 1 de preço por plano
escolhido. Com as chamadas em paralelo, 20 combinações fecham em **menos de um
segundo**. O gargalo não vai ser a rede deles — vai ser quantas a gente dispara
de uma vez sem parecer robô. Começar com 4 simultâneas e medir.
