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

---

# REVISÃO APÓS VALIDAÇÃO EXTERNA (Gemini) — 07/08/2026

Três correções aceitas, uma correção devolvida. O plano abaixo substitui o de cima.

## Aceito: a indexação por build id era desnecessária e frágil

O ponto que eu não tinha visto: **deploy gradual**. Se a Trindade usa Vercel ou
*Skew Protection*, duas builds coexistem por horas — o hash certo para um
servidor é 404 no outro. Indexar por build id não resolve isso e ainda depende
de descobrir o build id, que no App Router é frágil.

**Arquitetura nova, sem build id:**

1. A extensão pergunta ao JOB: *"qual foi o último hash que funcionou?"*
2. Usa como **palpite**. Deu 200, ótimo.
3. Deu 404, descarta o palpite, volta a **observar** o corretor usando o Painel,
   e avisa o JOB: *"o hash Y morreu, aprendi o Z"*.

**A verdade local sempre vence a nuvem.** Assim, durante um deploy gradual, uma
máquina não quebra a outra — cada uma converge para o hash do servidor que ela
está atingindo. É mais simples que a minha proposta e mais robusto.

## Aceito: existe uma terceira saída para a sessão caindo

Ping **preso à presença humana**: só dispara se houver `mousemove`/`keydown`/
`scroll` na aba do Painel **e** a última requisição real tiver mais de ~15 min.
Se o consultor sai e larga o PC ligado, a extensão dorme junto e a sessão cai —
que é o comportamento esperado.

Isso não é o cron cego que eu descartei: o disparo é consequência de alguém
estar ali. Ressalva honesta: continua sendo uma requisição que o humano não
pediu. Fica dentro do ruído de uso normal, mas não é zero.

## Aceito: meu teste de sessão concorrente tem falso negativo

Dois navegadores no mesmo PC compartilham o IP da corretora, e o sistema pode
tolerar 2–3 sessões (PC + celular é uso legítimo). Não cair em meia hora não
prova nada sobre 8 pessoas em 8 IPs.

Pior: detecção por anomalia costuma ser **assíncrona**. Oito pessoas em redes
diferentes na mesma conta acionam heurística de *account takeover* e o bloqueio
vem dias depois, não na primeira hora.

**Consequência prática:** não apostar a decisão nesse teste. Se ele "passar", a
consolidação ganha um argumento que não tem base.

### Argumento contra que eu não tinha listado

**Caos de tela compartilhada.** É app reativo: notificação do cliente de um
consultor aparece na tela do outro, e cotação em rascunho vira trabalho
colaborativo acidental — um sobrescreve o do outro sem perceber.

## Devolvido: a criptografia de bound arguments não nos atinge do mesmo jeito

O alerta é correto em geral: se a Trindade usa `.bind()` com argumentos
embutidos, o Next.js 14+ os criptografa, e **copiar a requisição de um usuário
para outro** quebraria ou gravaria no nome errado.

Só que **nós não copiamos requisição.** Em `cotador-painel.js`, o corpo é
`JSON.stringify(corpo)` — montado por nós, a partir de cidade, modalidade,
vidas e id da cotação. O que atravessa de um usuário para outro na proposta é
**só o hash e a árvore de rota**. A identidade continua vindo do cookie de
sessão do próprio corretor (`credentials: 'include'`).

E há uma prova mais forte, que dispensa medição: **se essas ações exigissem
argumentos criptografados, o cotador já não funcionaria hoje** — ele nunca
teve o blob, sempre montou o corpo do zero. Ele funciona. Logo, as ações que
usamos aceitam argumento simples.

**O que sobra para medir, e é mais estreito:** a `next-router-state-tree` que
guardamos junto do hash. Hoje trocamos só o UUID da cotação dentro dela. Antes
de compartilhar entre usuários, confirmar que ela não carrega nada específico
do corretor. Se carregar, compartilha-se **só o hash** e cada máquina usa a
própria árvore.

## Ordem revisada

1. **Comparar a `next-router-state-tree` de dois corretores** na aba Network.
   Decide se compartilha hash+árvore ou só o hash. É a única medição que ainda
   bloqueia a implementação.
2. **Implementar o compartilhamento** no modelo "nuvem é palpite, local é
   verdade".
3. **Ping preso à presença humana** para a sessão.
4. **Contas:** decidir pelo risco de negócio — atribuição de comissão, caos de
   tela compartilhada e parada geral se a conta única for bloqueada. Não pelo
   teste de login concorrente.
