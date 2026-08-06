# Cotar dentro da conversa do WhatsApp — estratégia

> Pedido do Guilherme em 06/08/2026: *"quero levar a cotação para dentro da
> extensão, cotar na conversa do whatsapp abrindo um popup ao lado para cotar."*
>
> Este documento é para **pensar a estratégia antes de escrever código**. Ele
> descreve o que já existe, onde estão as armadilhas reais, e as decisões que
> precisam ser tomadas. Não é uma especificação para implementar — é o material
> para decidir COMO implementar.

---

## 1. O problema que isso resolve

Hoje o consultor está numa conversa do WhatsApp, o cliente pergunta o preço, e
ele precisa: trocar de aba, abrir o JOB, digitar o nome do cliente de novo,
escolher cidade, informar as vidas, cotar, salvar, copiar o link e voltar para
colar na conversa.

Cada troca de aba é uma chance de perder o cliente na conversa — e o consultor
já tem o WhatsApp aberto na frente dele com o telefone da pessoa na tela.

**O ganho não é "ter cotação na extensão". É não sair da conversa.**

---

## 2. O que JÁ existe — não reconstruir

Levantado no código em 06/08/2026.

### 2.1 A extensão já tem interface injetada no WhatsApp

`content.js` roda em `web.whatsapp.com` e já monta:

- **`#job-trilho`** — a barra lateral própria da extensão
- **`#job-painel-doc`** — um painel que abre ao lado da conversa, com título,
  scroll, histórico e lado configurável (`job-painel-doc-esquerda`)
- Blocos injetados dentro das bolhas de mensagem (`.job-doc-slot`, `.job-tr-slot`),
  já isolados em Shadow DOM

**O popup pedido não precisa nascer do zero.** Já existe um painel lateral com
o comportamento de abrir/fechar ao lado da conversa.

### 2.2 A extensão já sabe quem é o cliente

`content.js:5849` já pergunta ao JOB quem é o lead pelo telefone da conversa:

```js
_safeSendMessage({ type: 'lead_por_telefone', telefone: tel })
```

que cai em `background.js:605` → `GET /api/whatsapp/lead-por-telefone`.

**Isso é grande**: a cotação dentro da conversa já nasce com o lead ligado, sem
ninguém digitar nada. E o vínculo com o lead virou **obrigatório** para cotar
(commit `133bfd2`), então esse caminho é o único que já chega pronto.

### 2.3 O motor de cotação já existe e roda em OUTRA aba

`cotador-painel.js` roda em `paineldocorretor.com.br` — não no WhatsApp. Ele:

- aprende os 7 passos (+1 opcional, `entidade`) observando o corretor usar o Painel
- cota ao vivo: cria a cotação, lista operadoras, lista planos, pede preço a preço
- é acionado por `postMessage` vindo do `painel-bridge.js`

**A comunicação entre abas já está montada:** o `background.js` já encaminha
mensagens entre a aba do WhatsApp, a do Painel e a do JOB. O caminho
`cotacao_andamento` e o `cotador_aprendeu` (commit `4591a7e`) são exemplos vivos
disso funcionando.

### 2.4 O JOB já tem a base local e o cálculo

- `POST /cotacao/bloco/calcular` — calcula da base local, com sessão
- `GET /cotacao/bloco/planos` — lista planos da base local
- `POST /cotacao/viva/salvar` — salva, gera o link `/c/<token>` e escreve no lead
- `_aprender_do_vivo()` — cada cotação ao vivo enche a base local sozinha

---

## 3. As decisões que precisam ser tomadas

### 3.1 De onde vem o preço: base local ou Painel ao vivo?

Esta é **a** decisão. As duas têm consequência forte.

**Base local (`/cotacao/bloco/calcular`)**
- Responde em menos de meio segundo
- Não abre nada no Painel, não cria cotação lá, **zero rastro**
- Não depende de aba do Painel aberta nem de a extensão ter aprendido
- Mas só cobre cidade/modalidade que já estejam no cache — e a base foi zerada
  em 06/08/2026, está enchendo aos poucos

**Painel ao vivo (`cotador-painel.js`)**
- Cobre qualquer cidade
- Custa **6 min 14 s para 20 planos** (medido em `cotacao_viva.ms`)
- Exige a aba do Painel aberta e a extensão com os passos aprendidos
- Cria cotação no sistema deles a cada consulta

**Seis minutos com o cliente esperando na conversa não é opção.** Uma cotação de
WhatsApp precisa responder em segundos.

Isso sugere: **base local como regra, e o ao vivo NÃO como plano B automático.**
Se a cidade não está no cache, é melhor dizer "essa cidade ainda não está no JOB,
cote pela tela" do que travar a conversa por seis minutos. Mas isso é decisão do
Guilherme, não técnica.

### 3.2 Quantas vidas, e como perguntar sem formulário

A cotação precisa de idades. Num popup ao lado da conversa não cabe o formulário
inteiro da tela.

Caminhos a considerar:
- Ler do lead: se o CRM já tem as idades dos dependentes, não pergunta nada
- Um campo só, livre: "35, 32, 8" — três números e acabou
- Ler da própria conversa: o cliente costuma dizer as idades por escrito

O terceiro é o mais valioso e o mais arriscado. A extensão já lê a conversa (é o
que a varredura faz), mas errar idade é errar preço.

### 3.3 O que o consultor faz com o resultado

O popup mostra os planos. Depois disso, o fluxo natural é **mandar na conversa**.
Isso já existe do lado do JOB: `/cotacao/viva/salvar` gera o link `/c/<token>`,
que é imutável e feito para o cliente abrir.

Então o botão final não é "salvar" — é **"enviar na conversa"**, que salva, pega
o link e escreve na caixa de mensagem. A extensão já sabe enviar mensagem.

### 3.4 Onde o popup vive

Reaproveitar `#job-painel-doc` ou criar um irmão?

A favor de reaproveitar: o comportamento de abrir ao lado, o lado configurável e
o Shadow DOM já estão resolvidos e testados.
Contra: ele é o painel de documentos, com histórico e scroll próprios. Enfiar
cotação ali pode virar um painel que faz duas coisas mal.

---

## 4. Armadilhas conhecidas — todas já custaram caro neste projeto

1. **Memória do Chrome.** A extensão já derrubou o WhatsApp por consumo. Houve
   uma rodada inteira de correções (caps FIFO nos Maps, Shadow DOM, reload
   estratégico). Qualquer coisa nova que guarde estado precisa de teto.

2. **Roubo de foco.** `openChatBottom` NAVEGA a tela. Já causou "a tela fica
   piscando e indo para outra conversa sozinha" (revertido em `1c2503f`). Existe
   uma trava de navegação no `wpp-bridge.js` — respeitar.

3. **A wa-js quebra quando o WhatsApp atualiza.** Já documentado. Qualquer coisa
   que dependa dela herda essa fragilidade.

4. **Zero medido e zero por engano.** Já apareceu três vezes neste módulo
   (`7bf5bbc`, `004b4ad`, `c2db14d`). Consulta que falha nunca pode virar número
   na tela.

5. **Rastro no Painel.** 415 cotações criadas no sistema deles, todas iguais. Se
   o popup cotar ao vivo, multiplica isso. É mais um argumento para a base local.

---

## 5. O que este documento NÃO decide

- Se o popup cota ao vivo ou só da base local
- Se lê idades da conversa
- Se reaproveita `#job-painel-doc` ou cria outro
- O desenho visual

Essas quatro dependem do Guilherme e do que ele quer priorizar.

---

## 6. Divisão de trabalho

- **`extensao-whatsapp/`** e **`templates/`** — Claude Code
- **`app.py`** — Antigravity

Se o popup precisar de rota nova no JOB, ela é do Antigravity, e o contrato vem
escrito antes — como foi com `/cotacao/bloco/*`.

**Antes de qualquer coisa nova:** as três prioridades de
`handoff/correcoes-pendentes-cotacao.md` continuam abertas. A primeira delas —
a flag `elegivel` não chegar ao lead — significa que o valor gravado no CRM pode
vir de um plano que não cobre o cliente. Isso é dinheiro errado no funil todo
dia, e vale mais que feature nova.
