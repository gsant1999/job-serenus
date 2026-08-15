---
name: ux-job
description: Régua de UX do ecossistema JOB (site Flask/Jinja2 da Serenus e extensão de WhatsApp). Use ao criar, alterar ou revisar qualquer tela, componente, formulário, rótulo de botão, mensagem de erro ou fluxo — no site ou na extensão. Traz as regras inegociáveis do projeto, o checklist de avaliação e os pontos onde o JOB já errou antes.
---

# UX do JOB

Esta é a régua de design do ecossistema JOB. Ela tem precedência sobre skills
genéricas de design (`apple-design`, `emil-design-eng`, `animate`,
`review-animations`, `design-critic`, `ux-friction-analyzer`, `frontend-design`,
`ui-ux-pro-max`): aquelas são fonte de consulta, esta é a decisão. Quando uma
sugerir algo que contraria esta, esta ganha.

O aprofundamento de cada princípio está em `UX_APRENDIZADOS.md`, na raiz do
repositório — leia sob demanda, não por padrão.

**Consulte antes de desenhar, não depois:** `apple-design` para hierarquia,
material, tipografia e gesto; `emil-design-eng` para acabamento de componente e
decisão de animação; `animate` para construir um movimento novo;
`review-animations` para criticar um que já existe.

## Regras inegociáveis

Estas não são preferências. Quebrar qualquer uma é bug.

1. **Sem emojis.** Em botão, rótulo, mensagem, título, log visível — em nada. Foi
   feita limpeza total em 30/06/2026; não reintroduzir.
2. **O óbvio deve ser dito.** Toda condição que governa a tela precisa estar
   escrita nela. Se um botão só funciona com o WhatsApp conectado, se um campo só
   aceita PDF, se um envio respeita intervalo — está na tela, não na cabeça de
   quem programou.
3. **Todo conceito difícil leva um "i".** Score, agravo, coparticipação, roleta,
   janela de 24h: ícone de informação ao lado, com explicação em linguagem de
   corretor, não de sistema.
4. **Configuração mora no painel, não no popup.** O popup é para agir. Ajuste,
   preferência e cadastro ficam em tela cheia. É o que faz a interface parecer
   produto e não extensão amadora.
5. **Cada perfil vê o que serve para ele.** Admin, consultor e financeiro não
   compartilham a mesma tela por preguiça de segmentar. Ao lado de cada número,
   quem é dono dele.
6. **Nada de rastro de fornecedor, IA ou stack** chega ao usuário final. Nem em
   texto, nem em nome de classe visível, nem em mensagem de erro.
7. **Olhar antes de mandar.** Nenhum commit que muda visual sai sem passar pela
   bancada de telas. Ver com os próprios olhos, nos dois temas, antes de commitar.

## O que fazer em toda tela

**Antes de organizar, remova.** A ordem é Remover → Organizar → Esconder → Mover.
Pergunte qual é a ação principal agora e corte o que não serve a ela. Campo que
pode ser preenchido depois não nasce no formulário.

**Uma ação principal, uma cor.** Cor cheia só na ação principal; o resto é
contorno ou texto. Se pedirem mais um CTA, algum outro tem que ser rebaixado —
quando tudo se destaca, nada se destaca.

**Hierarquia por tamanho e peso, não por cinza.** Limite quantos tamanhos de
fonte coexistem numa tela.

**Botão diz a consequência.** "Enviar" sozinho não serve. "Enviar proposta ao
cliente", "Salvar e voltar", "Gerar boleto de adesão". E o rótulo muda com o
contexto: se o lead já recebeu a sequência do funil, o botão diz isso em vez de
convidar a reenviar do zero.

**Toda ação tem reação imediata.** Se o usuário clica em salvar e a tela não
muda, ele clica de novo — e o JOB ganha registro duplicado. Estado de carregando,
travar o botão, confirmação visível: sempre.

**Erro fala com o usuário.** Diz o que aconteceu, como corrigir, e fica visualmente
ligado ao campo que o causou. Nunca uma mensagem de exceção crua.

**Ação destrutiva fica longe da confirmação** — separada visual e fisicamente. E
confirmação de intenção antes de executar qualquer coisa ambígua ou cara.

**Sistema faz o trabalho pesado.** Inferir em vez de pedir digitação. Data é
seletor, nunca texto livre. Dado que o JOB já tem não se pergunta de novo.

**Explique por que está pedindo.** Principalmente dado sensível — é corretora de
saúde, o usuário tem razão em desconfiar.

**Componente antes de tela.** Botão, chip, badge e folha se constroem uma vez e
se reusam entre popup, sidebar e overlays. Estilizar cada tela isolada é como o
app virou remendo. O CSS de componente compartilhado mora em `base.html`, não na
tela — três cópias divergem na primeira mudança de cor.

## Acabamento e movimento

O que separa "funciona" de "parece produto" não é feature: é o acabamento, e ele
se decide em valores, não em gosto. Todo número abaixo é escolha defensável — se
você não sabe justificar um espaçamento, um tempo ou um alinhamento, ele está
errado.

**Coisa igual se parece igual, se comporta igual e mora no mesmo lugar.** Dois
tratamentos visuais para o mesmo nível de hierarquia é o defeito mais caro e o
mais comum — foi exatamente isso que deixou a sidebar do JOB torta. Se dois itens
são irmãos, eles têm a mesma margem esquerda, o mesmo tamanho de letra e a mesma
afordância.

**Nada de `transition: all`.** Nomeie a propriedade. `all` anima layout sem
querer e derruba frame.

**Anime só `transform` e `opacity`.** São as duas que rodam na GPU. Animar
`height`, `width`, `margin` ou `padding` refaz layout a cada frame.

**Decida se deve animar, pela frequência:**

| Quantas vezes por dia o usuário vê | Decisão |
|---|---|
| Centenas (atalho, salvar, abrir menu) | Sem animação nenhuma |
| Dezenas (hover, trocar de item da lista) | Reduzir ao mínimo |
| Ocasional (folha, modal, confirmação) | Animação padrão |
| Raro (primeira vez, comemoração) | Pode ter graça |

Movimento que se repete o dia inteiro vira atraso. Nada disparado por teclado
anima.

**Curvas e tempos do JOB:**

```css
--ease-saida:   cubic-bezier(.23, 1, .32, 1);    /* entra/sai: começa rápido */
--ease-mov:     cubic-bezier(.77, 0, .175, 1);   /* move na tela */
--ease-folha:   cubic-bezier(.32, .72, 0, 1);    /* folha/gaveta, curva iOS */
```

| Elemento | Duração |
|---|---|
| Resposta de clique | 100–160 ms |
| Dica, popover pequeno | 125–200 ms |
| Menu, select | 150–250 ms |
| Folha, modal, gaveta | 200–400 ms |

Acima de 300 ms em elemento de interface, reduza. **Nunca `ease-in`** em
interface: ele adia o começo justo no instante em que o usuário está olhando, e
faz a tela parecer lenta com o mesmo tempo no relógio.

**Botão responde ao dedo.** `transform: scale(.97)` no `:active`, com transição
de ~140 ms. Vale para qualquer coisa pressionável.

**Nada nasce do nada.** Nunca `scale(0)`. Comece em `scale(.95)` com
`opacity: 0`.

**Popover cresce de onde foi chamado**, não do centro — `transform-origin` no
gatilho. Modal é a exceção: ele não tem gatilho no espaço, fica centrado.

**Sai pelo mesmo caminho que entrou.** Painel que entra pela direita sai pela
direita. Entrar por um lado e sair por outro desorienta.

**Hover só onde existe mouse:** `@media (hover: hover) and (pointer: fine)`. Em
toque, hover dispara no tap e gruda.

**`prefers-reduced-motion` não é "sem retorno".** Troque deslocamento por
opacidade, tire elástico e mantenha o que ajuda a entender.

**Sem oscilação eterna.** Nada de laço infinito lento em elemento presente em
toda tela — é distração permanente e camada de composição queimada à toa.

**Tipografia é escala, não um tamanho.** Título grande pede `letter-spacing`
negativo (≈ `-0.02em`) e entrelinha curta; texto corrido fica perto de zero com
entrelinha folgada. Hierarquia se faz com peso + tamanho + entrelinha juntos.

## Onde o JOB já errou

Casos reais. Se o que você está fazendo se parece com um destes, pare e resolva.

- **"Enviado" sem anexo** ([103c1ab](https://github.com/gsant1999/job-serenus/commit/103c1ab)):
  o sistema confirmou um envio que não aconteceu. Toda confirmação precisa
  descrever o que de fato saiu. Generalizar para proposta, boleto e e-mail de
  cotação.
- **Clique duplo em salvar** gerando registro duplicado — auditar
  `/salvar-proposta` e os botões de parcela/antecipação.
- **Alerta do navegador no lugar de folha própria** — resolvido na extensão
  ([e52912e](https://github.com/gsant1999/job-serenus/commit/e52912e)); não voltar
  a usar `alert`/`confirm` nativos.
- **Inconsistência entre módulos**: CRM, cotação, propostas e financeiro nasceram
  em épocas diferentes. Ao mexer num, conferir se o padrão bate com o mais novo.

## Contexto que muda a decisão

**Site (Flask + Jinja2 + CSS puro).** Não há React nem Tailwind. Exemplos de
código das skills genéricas precisam de tradução manual — os princípios valem, o
código não. O menu já tem ~25 itens: tela nova não ganha item de menu sem
discussão.

**Extensão (Chrome sobre WhatsApp Web).** O consultor está em campo, muitas vezes
em conexão ruim: a tolerância a lentidão é menor que no desktop. Carregamento da
biblioteca de mídia (232 áudios, 91 imagens, 51 documentos) é problema de UX, não
só de infra. A extensão roda dentro de sistema de terceiro — nada na interface
pode denunciar automação. Referência visual: ZapVoice/WaSpeed.

**Agenda não é fila.** Compromisso marcado e lead a atacar são coisas diferentes
e não dividem a mesma lista.

## Checklist antes de dar por pronto

- **Simples** — dá para remover, adiar ou revelar progressivamente mais alguma coisa?
- **Acionável** — está claro onde estou, o que fazer agora, e o que acontece se der erro?
- **Inteligente** — a ação mais comum está destacada? O sistema previne o erro em vez de avisar depois? Usa o que já sabe sobre o usuário?
- **Agradável** — contraste e legibilidade suficientes nos dois temas? O tempo do usuário foi respeitado?
- **Acabado** — irmãos alinhados na mesma margem e no mesmo tamanho? Nenhum `transition: all`? Nenhum `ease-in`? Só `transform`/`opacity` animando? Botão com resposta no `:active`? `prefers-reduced-motion` tratado? Nenhum valor que você não saiba justificar?
- **Relevante** — isso resolve o que o usuário espera de fato, ou só o que foi pedido literalmente?

## Medir, não opinar

Instrumente junto com a entrega, não depois. Mediana e p95 — nunca só a média.
Erro comum no log real é briefing de redesenho: desenhe contra o erro que
acontece, não contra o que você imagina que aconteceria.
