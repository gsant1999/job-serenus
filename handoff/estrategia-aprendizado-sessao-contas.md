# Três perguntas do Guilherme sobre o cotador — o que é fato e o que é decisão

> 07/08/2026. Escrito para revisão externa (Gemini) antes de implementar.
> As afirmações abaixo foram lidas no código deste repositório, não deduzidas.

---

## Pergunta 1 — "não dá pra salvar como eu cotei e injetar depois?"

**Já salva.** `extensao-whatsapp/painel-bridge.js` grava o que foi aprendido em
`chrome.storage.local`, com chave por origem (`cotador_painel_hashes:<origin>`),
e devolve para a página assim que a aba do Painel carrega. Fechar o navegador,
reiniciar a máquina e atualizar a extensão **não apagam** isso.

Então o problema não é memória. É **validade**.

O Painel do Corretor é Next.js. Cada ação de servidor é identificada por um
`next-action`, que é **gerado por build**. Quando a Trindade publica uma versão,
o identificador aprendido ontem deixa de existir e o servidor responde 404. O
cotador então apaga aquele papel de propósito (`cotador-painel.js`, linha ~330):
insistir com um identificador morto faria todo preço voltar 404 para sempre.

**Nenhum cookie, storage ou "injeção" resolve isso.** Não é esquecimento — é uma
chave que caducou do lado deles. Guardar por mais tempo só guardaria lixo.

### O desperdício que É real, e tem conserto

Hoje cada máquina reaprende **sozinha**. Com 8 consultores, um deploy da Trindade
custa 8 aprendizados manuais para descobrir exatamente a mesma informação — e o
`next-action` é **por build, não por usuário**: é a mesma string para todo mundo.

**Proposta: o que um aprende, todos recebem.**

```
POST /api/whatsapp/cotador/aprendido   { build, papeis: {criar:{hash,arvore}, ...} }
GET  /api/whatsapp/cotador/aprendido?build=<id>   -> os papéis conhecidos
```

- Quem aprender publica no JOB, marcado com o **id do build** do Painel.
- Toda extensão consulta ao abrir a aba e injeta o que já existe.
- Resultado: "falta ensinar uma vez" passa de *uma vez por pessoa por deploy*
  para *uma vez por deploy*, para a corretora inteira.

**A chave tem que ser o build, não a data.** Guardado por data, um hash morto
seria distribuído para todos e todo mundo quebraria junto. O id do build do
Next.js precisa ser confirmado na implementação (candidatos: `__NEXT_DATA__.buildId`
ou o segmento de `/_next/static/<buildId>/`). **Se não houver id de build
confiável, esta proposta não deve ser feita** — distribuir hash sem saber a
qual versão pertence é pior que o problema atual.

**Custo honesto:** o JOB passa a guardar a impressão digital de como falamos com
o sistema deles, num servidor nosso. Hoje isso só existe espalhado nos
navegadores. É concentrar prova em um lugar.

---

## Pergunta 2 — "o login do Painel cai o tempo todo"

A sessão é deles e o tempo de expiração é deles. **Não controlamos.**

Duas coisas que NÃO devem ser feitas:

1. **Manter a sessão viva com batidas periódicas.** Um pedido a cada X minutos,
   sem ninguém na frente, durante a madrugada, é o padrão mais fácil de detectar
   que existe — mais fácil que qualquer coisa ligada a tempo de resposta. Vai
   contra a regra que já governa este módulo.
2. Guardar a senha do Painel para relogar sozinho. Credencial de terceiro
   guardada por nós é risco que não se justifica por comodidade.

O que dá para fazer, e vale:

- **Distinguir "deslogado" de "quebrou".** Hoje os dois viram erro genérico.
  Deslogado é uma frase: "faça login na aba do Painel".
- **Não perder o trabalho.** Se cair no meio, os preços já obtidos continuam na
  tela e o consultor retoma de onde parou.

**Mas veja a pergunta 3 antes de aceitar que a queda é normal.** Existe uma
hipótese melhor.

---

## Pergunta 3 — "posso desativar as 8 contas e usar uma só?"

Esta é a decisão com mais consequência das três, e a recomendação é **não**.

### A hipótese que liga com a pergunta 2

Muitos sistemas permitem **uma sessão ativa por conta**: quando alguém entra, a
sessão anterior é derrubada. Se isso valer no Painel, e se já houver conta
compartilhada hoje, **isso explicaria sozinho o "cai a cada X minutos"** — não
seria expiração, seria o colega logando.

Se for esse o caso, ir para **uma conta só torna o problema permanente**: oito
pessoas se derrubando o dia inteiro.

**Teste, antes de decidir** (5 minutos, sem código): entre na mesma conta em
dois navegadores diferentes e use o primeiro. Se ele pedir login de novo, a
consolidação está descartada.

### Os outros três custos

1. **Detecção.** Uma conta acessada de 8 máquinas, 8 IPs e possivelmente 8
   cidades, ao mesmo tempo, todo dia, é a anomalia mais barata de encontrar que
   existe — não exige olhar tempo de resposta nem padrão de chamada. É o oposto
   do objetivo de não parecer máquina. Hoje, oito pessoas em oito contas
   parecem oito pessoas **porque são**.
2. **Atribuição.** Toda cotação criada no Painel fica com o nome de um corretor
   só. Se produção, comissão ou histórico forem lidos de lá, isso se perde.
3. **Termos de uso.** Compartilhar credencial costuma ser violação explícita e
   fácil de provar — mais direta que automação.

### Se a decisão for consolidar mesmo assim

Vale saber o que muda: as 8 contas de hoje **isolam o risco** (uma bloqueada,
sete seguem trabalhando). Uma conta só concentra tudo — o bloqueio passa a ser
evento de parar a corretora inteira, não de parar uma pessoa.

**Pergunta que falta responder, e que muda a recomendação:** por que reduzir?
Se for custo por licença, dá para pesar contra o risco. Se for trabalho de
administrar, tem solução mais barata que consolidar.

---

## O que já foi corrigido enquanto isto era escrito

O aviso "falta ensinar uma vez" mostrava sempre o texto genérico, mesmo quando
faltava **um** passo. A extensão já devolvia a lista (`faltando`) e existia o
mapa que traduz cada papel em gesto — a tela descartava. Quem fazia a cotação
inteira e continuava travado refazia tudo e parava no mesmo ponto.

Corrigido em `b119e98`: o aviso lista os gestos que faltam, um a um.

---

## Ordem sugerida

1. **Rodar o teste de sessão concorrente** (5 min). Decide a pergunta 3 e pode
   explicar a 2.
2. **Confirmar se existe id de build** no Painel. Decide se a pergunta 1 tem
   solução ou não.
3. Só então implementar o compartilhamento de aprendizado.

Nada aqui deve ser implementado antes dos dois primeiros itens: os dois são
medições baratas que podem invalidar o resto.
