# Diagnóstico de UX — trilho e telas da extensão

> Pedido do Guilherme em 08/08/2026: *"COLOQUE NAS TAREFAS A NECESSIDA DE
> MELHOR O DESIGNER E A UX DO TRILHO DA EXTENSÃO TODA, TA TUDO MUITO FEITO
> TBM."*
>
> Isto é **diagnóstico, não execução.** Nenhuma linha de código foi mexida.
> Régua: `UX_APRENDIZADOS.md` (Fabricio Teixeira), o padrão WaSpeed/ZapVoice,
> e o que já valeu no painel de Configuração 3.63.0 e no portão 3.66.0 — que
> foram as duas telas que ele aprovou sem ressalva.
>
> Leia, corte o que não quiser, e marque a ordem. Eu executo pelo que sobrar.

---

## O resumo, se você só ler isto

**11 telas, e elas não parecem do mesmo produto.** Metade tem cabeçalho,
metade não. Há três jeitos diferentes de dizer "carregando". Os estados vazios
mudam de voz de uma tela pra outra. Duas telas mostram mensagem de erro de
programador pro consultor.

Não é que cada tela esteja ruim isoladamente. É que **elas foram construídas
uma de cada vez, cada uma resolvendo o seu problema**, e nunca passaram juntas
por uma régua. O resultado é o "tá tudo muito feito" que você viu: nada está
quebrado, e nada parece cuidado.

**Os 4 primeiros itens abaixo resolvem a maior parte da sensação** e não mexem
em fluxo nenhum — são padrão, não redesenho.

---

## GRAVES — FEITOS na 3.78.0 (08/08)

Os três abaixo estão corrigidos. O texto fica como registro do que era.

### G1. Erro de programador chegando ao consultor

`content.js:7071` e `7078`, na tela de Funis:

```js
'<div class="job-erro">Erro ao montar a lista de funis:<br>' + esc(String(e.message))
```

O consultor vê a mensagem crua da exceção. Isso **fere a blindagem da
interface** — nenhuma pista de stack, fornecedor ou erro técnico pode chegar ao
usuário final — e não ajuda ninguém: quem lê não sabe o que fazer.

Acontece em 5 lugares (`grep "e.message || e"`).

**Conserto:** mensagem humana com o próximo passo na tela, detalhe técnico só
no `console`. Regra do "óbvio dito": erro diz o que houve **e o que fazer**.

### G2. Símbolos pictográficos na interface

Regra 1 do `CLAUDE.md`, sem emoji. Sobraram:

| onde | o quê |
|---|---|
| `content.js:7532` | `🔒` no aviso de score limitado |
| `content.js:6564` | `★` no botão de favoritar |
| `content.js:6782` | `■ Parar` |
| 10 lugares | `⚠` nos avisos |

O `★` e o `■` têm substituto pronto: já existe `_svgIco()` no arquivo, usado no
chip de Favoritos ao lado. O `⚠` vira um ladrilho colorido, que é o padrão que
você aprovou na Configuração.

### G3. A tela de Análise mostra o erro e o vazio ao mesmo tempo

`content.js:6345`: em caso de falha, imprime a mensagem de erro **e** a tela de
"sem análise" logo abaixo. Duas mensagens contraditórias empilhadas — o
consultor não sabe se deu errado ou se não tem nada.

---

## ESTRUTURAIS — E1 e E2 FEITOS na 3.79.0 (08/08)

Dois defeitos reais apareceram fazendo: a tela **Hoje** escrevia num elemento
que não existe (`job-painel-corpo`, referência única no arquivo) e abria em
branco sempre; e `.job-carregando` era usado como roda mas o CSS dele era de
bloco de texto — em vinte telas a espera era um espaço em branco sem roda
nenhuma. Os dois estão corrigidos.

### E1. Metade das telas tem cabeçalho, metade não

**Têm** (via `.job-cnpj-titulo`): Cotações, Cotar agora, Operadoras,
Comparativo, CNPJ, Notas, Cadastrar lead, Diagnóstico, Sem lead.

**Não têm**: Mensagens, Funis, Leads (inbox), Hoje (fila), CRM (ficha),
Análise.

Quem entra numa tela sem cabeçalho **não sabe onde está** — o trilho lateral é
só um ícone aceso, e o painel abre sem se apresentar. É a queixa número um do
livro: *"toda tela deve deixar claro onde ele está"*.

**Conserto:** um cabeçalho só, igual em todas — título, uma linha de subtítulo
dizendo pra que serve, e o lugar do contador quando houver. Uma função, onze
chamadas.

E de quebra some a esquisitice de a classe do cabeçalho de tudo se chamar
`job-cnpj-titulo` — herança de quando existia só a tela de CNPJ.

### E2. Três jeitos de dizer "carregando"

`job-carregando` (12x), `job-sem-analise` com spinner (20x), `job-spin` (4x), e
os textos variam: "Carregando funis…", "Carregando modelos…", "carregando sua
fila…" — este último em minúscula.

Nada quebra. Mas o olho registra que cada tela foi feita por uma pessoa
diferente, e é metade da sensação de desleixo.

**Conserto:** um estado de carregamento só, com o texto vindo por parâmetro.

### E3. Os estados vazios não têm voz — FEITO na 3.80.0

| tela | texto atual |
|---|---|
| Funis | "Nenhum funil ainda. Monte o primeiro em Funis WhatsApp no site." |
| Modelos | "Nenhum modelo salvo ainda. Crie o primeiro acima." |
| Fila | "Nada na fila de hoje." |
| Sugestões | **"Sem sugestões."** |
| Filtro sem resultado | "Nenhum funil bate com esse filtro." |

Os dois primeiros estão certos — dizem o que fazer. **"Sem sugestões." e "Nada
na fila de hoje." não explicam nada**: é bom sinal ou é defeito? O consultor
não sabe se está tudo em dia ou se algo não carregou.

Estado vazio é a tela que a pessoa mais vê no primeiro dia. Ele **explica**, e
oferece a saída.

### E4. O trilho não diz o que está em dia — FEITO na 3.81.0 (parcial, ver nota)

Nove itens, e só três podem mostrar contador (Análise, Leads, Hoje). Os outros
seis são ícone e nome, sempre iguais, com ou sem coisa pra fazer.

O trilho é a única parte da extensão que fica sempre visível. Hoje ele é um
menu; podia ser um painel de estado — é exatamente o que a WaSpeed faz e o que
te fez gostar da tela deles.

**Isto é o único item da lista que muda comportamento, não só aparência.**
Trato como proposta separada, não junto com o resto.

---

## POR TELA — o que eu faria em cada uma

Ordenado por quanto tempo o consultor passa nela.

**Análise** — a mais usada e a de pior estado. Erro e vazio empilhados (G3),
sem cabeçalho, e o `🔒` do score. É por onde eu começaria.

**Hoje (fila)** — sem cabeçalho, e o vazio ("Nada na fila de hoje") não diz se
é bom ou ruim. Essa tela é a que decide o dia da pessoa; merece o tratamento do
portão.

**Cotações** — a mais trabalhada e a mais perto do padrão. Pequenos ajustes:
o comparativo já ganhou a linha do "consultar não salva", e as gavetas estão
congeladas até você estudar o Painel.

**Mensagens e Funis** — as duas mais próximas da WaSpeed (busca + chips +
favoritos) e as duas sem cabeçalho. Ganham muito com E1 e E2, quase de graça.

**Leads (inbox)** — sem cabeçalho e sem estado vazio próprio.

**CRM (ficha)** — muitos campos empilhados sem agrupamento. É a que mais
precisa dos "4 R": remover antes de organizar.

**CNPJ** — a mais consistente do conjunto (título, subtítulo que explica o que
faz e por quê, resultado em cartão com copiar item a item). É o padrão de fato;
o que eu proponho é levar as outras dez até ela.

**Notas, Cadastrar lead** — pequenas e razoáveis. Só padronização.

---

## A ordem que eu recomendo

**1. ~~G1, G2, G3~~ — FEITOS na 3.78.0.**

**2. ~~E1 e E2~~ — FEITOS na 3.79.0.** 23 cabeçalhos e 13 carregamentos, todos
pela mesma função.

**3. ~~E3~~ — FEITO na 3.80.0.** Dois tipos separados: "nunca houve"
(explica pra que serve o lugar) e "o filtro não achou" (oferece limpar).

**4. Análise e Hoje** — as duas telas mais usadas, tratadas a fundo.

**5. ~~E4~~ — FEITO na 3.81.0**, com uma parte pendente de servidor.

O que entrou: barra ativa única que **desliza** entre os itens (antes cada item
tinha a sua e ela sumia de um lugar pra aparecer noutro, sem caminho entre os
dois); marcas unificadas em duas linguagens — **número** = tem gente esperando
você, **ponto** = esta seção tem conteúdo deste contato; resposta no aperto ao
clicar; e nada de marca em Mensagens, Funis e CNPJ, que são bibliotecas.

**O que falta, e é do servidor:** os pontos só acendem depois que a pessoa
abre a seção uma vez naquela conversa, porque é aí que o cache se enche. Pra
acenderem já ao abrir a conversa falta **uma chamada só** que devolva o resumo
do contato — se tem cotação, se tem nota, se tem ficha. Pedido escrito na
`conversa.md`. Enquanto não existe, o ponto fica apagado: acender por
suposição seria mandar a pessoa procurar o que talvez não esteja lá.

**6. O resto**, tela a tela, conforme você for validando.

---

## O que eu NÃO vou mexer sem você mandar

- **Gavetas de plano** — congeladas até você estudar o Painel do Corretor
- **Ordem dos itens do trilho** — mexer nisso muda a memória muscular de oito
  pessoas no meio do expediente
- **Qualquer fluxo** — este documento é sobre como a coisa se apresenta, não
  sobre o que ela faz

---

## Como eu meço se funcionou

Regra sua, de "medir antes de opinar": não adianta eu dizer que ficou melhor.

O que dá pra medir, e que eu instrumento junto com a entrega: quantas vezes uma
tela é aberta e fechada **sem nenhuma ação** (indica que a pessoa não achou o
que queria), e quantas vezes o consultor abre a mesma tela duas vezes seguidas
em menos de 10 segundos (indica que ele não entendeu o que viu).

Se esses dois números não caírem, o redesenho foi só gosto meu.
