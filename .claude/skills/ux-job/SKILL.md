---
name: ux-job
description: Régua de UX do ecossistema JOB (site Flask/Jinja2 da Serenus e extensão de WhatsApp). Use ao criar, alterar ou revisar qualquer tela, componente, formulário, rótulo de botão, mensagem de erro ou fluxo — no site ou na extensão. Traz as regras inegociáveis do projeto, o checklist de avaliação e os pontos onde o JOB já errou antes.
---

# UX do JOB

Esta é a régua de design do ecossistema JOB. Ela tem precedência sobre skills
genéricas de design (`apple-design`, `frontend-design`, `ui-ux-pro-max`): aquelas
são fonte de consulta, esta é a decisão. Quando uma sugerir algo que contraria
esta, esta ganha.

O aprofundamento de cada princípio está em `UX_APRENDIZADOS.md`, na raiz do
repositório — leia sob demanda, não por padrão.

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
app virou remendo.

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
- **Relevante** — isso resolve o que o usuário espera de fato, ou só o que foi pedido literalmente?

## Medir, não opinar

Instrumente junto com a entrega, não depois. Mediana e p95 — nunca só a média.
Erro comum no log real é briefing de redesenho: desenhe contra o erro que
acontece, não contra o que você imagina que aconteceria.
