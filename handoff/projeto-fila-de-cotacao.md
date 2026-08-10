# Projeto — a fila de cotação: uma conta, uma máquina, oito consultoras

> Guilherme, 10/08/2026: *"não tem problema ficar deslogando do meu e logando no
> outro... tinha que ter uma única conta, só que tem um problema de IP. Eu tenho
> uma outra máquina aqui que eu uso, um Dell, que eu posso deixar ligado o tempo
> todo."* E depois: *"cria uma conta dedicada, manda o contrato e começa... por
> hora desenhe tudo, deixe 100% operável."*
>
> Este documento é o desenho inteiro. O que o Antigravity executa está separado
> em `contrato-fila-de-cotacao-servidor.md`. O resto é meu.

---

## O problema, em uma frase

Hoje a extensão cota lendo a aba do Painel do Corretor **do próprio Chrome de
quem clicou**. São 8 contas, 8 logins, e a pergunta "como é que cota aqui"
todo dia. E a aba aberta na máquina do Guilherme não serve pra ninguém: o
Chrome do Danilo não enxerga a aba do Chrome do Guilherme.

## A solução, em uma frase

**Uma máquina cota para todas.** O Dell fica ligado com um login só do Painel,
em modo trabalhador. Os 8 WhatsApps mandam o pedido pro JOB; o JOB entrega pro
Dell; o Dell cota e devolve. **O consultor nunca vê o Painel.**

## Por que isto é mais seguro que hoje, e não menos

Esta é a parte contraintuitiva e vale escrever: **concentrar num IP é mais
discreto que espalhar em oito.** Uma conta acessada de oito redes diferentes ao
mesmo tempo é o padrão clássico de conta compartilhada — é o que qualquer
sistema marca. Uma conta, um IP, um navegador, cotando o dia inteiro, é o
perfil de **um corretor que trabalha muito**.

O que passa a controlar o risco não é *quantas pessoas*, é o **ritmo**. E o
ritmo passa a ser meu: uma cotação de cada vez, com as pausas humanas que o
`cotador-painel.js` já faz. O Painel nunca vê rajada, porque **existe uma fila
entre ele e as oito pessoas**. Hoje não existe — hoje oito pessoas podem
clicar ao mesmo tempo e ele vê oito frentes.

---

## 1. Como o Dell é reconhecido (e por que isso não pode ser frouxo)

O Guilherme perguntou: *"você sabe qual computador é?"* **Não, e o sistema
também não pode adivinhar.** Se qualquer extensão puder se declarar
trabalhadora, uma consultora com a extensão aberta pega os pedidos das outras e
tenta cotar sem sessão do Painel — a fila trava e ninguém entende por quê.

O JOB já tem a peça certa: a tabela `extensao_sessao`, um registro por aparelho
com token próprio. **O trabalhador é uma marca nessa linha**, ligada por você,
na tela de Configurações:

- na tela do JOB, a lista de aparelhos ganha um botão **"Este é o computador
  que cota"** — um por vez, e trocar de máquina é um clique;
- o Dell manda essa marca junto de cada pedido de trabalho;
- **quem não tem a marca não recebe pedido nenhum**, mesmo que peça.

Trocar o trabalhador (Dell quebrou, você viajou) é reapontar a marca. Sem
reinstalar nada.

## 2. A conta do Painel: dedicada, não a sua

O Guilherme disse as duas coisas na mesma mensagem — *"cria uma conta
dedicada"* e depois *"a minha"*. **Fica a dedicada, e a razão é operacional:**

Se o Dell roda com o login do Guilherme e essa conta trava, é o **acesso dele**
que some no meio de uma negociação. Com uma conta dedicada, o pior caso é a
fila parar — ruim, mas ninguém perde o próprio acesso. É a diferença entre um
problema e um problema no meio de uma venda.

**A conta é criada por ele, no Painel, à mão.** Eu não crio conta nem digito
credencial em sistema de terceiro — e não preciso: quem loga uma vez no Dell é
ele, e a sessão fica viva sozinha depois disso (é o que o cotador já faz).

## 3. O caminho de um pedido, ponta a ponta

```
consultora clica "Cotar agora"
        │
        ├─ extensão dela monta o pedido (cidade, vidas, modalidade, operadoras)
        │
        ▼
   JOB · POST /api/whatsapp/cotacao/fila            ← Antigravity
        │  grava o pedido, devolve o número dele
        │  e a posição na fila
        ▼
   JOB · GET /api/whatsapp/cotacao/fila/proximo     ← Antigravity
        │  SÓ o aparelho marcado como trabalhador recebe
        ▼
   Dell · cotador-painel.js cota na sessão do Painel    ← meu
        │
        ▼
   JOB · POST /api/whatsapp/cotacao/fila/<id>/pronto ← Antigravity
        │  guarda o resultado
        ▼
   extensão da consultora, que estava perguntando
   "já ficou pronto?", recebe e desenha o comparativo
```

**Nada de credencial do Painel passa pelo servidor do JOB.** O que trafega é
pedido (cidade, idades, operadoras) e resultado (preços). A sessão do Painel
nunca sai do Dell — igual hoje, só que numa máquina em vez de oito.

## 4. O que a consultora vê

Esta é a parte que decide se o projeto presta. Espera muda é sistema
quebrado; espera com número é espera.

**Enquanto está na fila:**

```
┌──────────────────────────────────────────┐
│  Buscando os preços                      │
│  ███████░░░░░░░░░░░░░░░░░░░  2 na frente │
│  Costuma levar 8 segundos.               │
└──────────────────────────────────────────┘
```

- a barra anda de verdade — ela acompanha **as etapas da cotação**, não um
  relógio inventado: entrou na fila → minha vez → buscando operadoras →
  buscando preços (3 de 6) → montando o comparativo;
- **"2 na frente"** sai da fila real, não é enfeite;
- **"costuma levar 8 segundos"** é a mediana medida das últimas cotações, não
  um chute — e some quando ainda não houver medição suficiente;
- passou de 25 segundos, o texto muda sozinho pra dizer que está demorando mais
  que o normal, com o botão de cancelar ao lado.

**O consultor nunca vê a palavra "Painel", "fila do Dell" nem nada de máquina.**
Ele vê "buscando os preços". Como o JOB busca é problema do JOB.

## 5. Quando o Dell cai — e ele vai cair

Ponto único é ponto único. Ignorar isso é o jeito de descobrir do pior jeito:
com oito pessoas paradas e ninguém sabendo por quê.

**A luz de saúde.** O Dell manda um sinal de vida a cada minuto. O JOB guarda o
último. A partir daí:

| situação | o que acontece |
|---|---|
| sinal com menos de 3 min | tudo normal, ninguém vê nada |
| sem sinal há 3 min | **você** recebe aviso no sino do JOB e no WhatsApp |
| sem sinal há 3 min **e** alguém tenta cotar | a consultora vê: *"A busca de preços está fora do ar. O Guilherme já foi avisado."* — com o botão de **cotar pelas tabelas do JOB**, que não dependem do Painel |
| sessão do Painel caiu (Dell ligado, login expirado) | mesmo aviso, texto diferente: *"precisa entrar de novo no Painel"*, e no Dell aparece o botão que abre a tela de login |

**A saída pelas tabelas do JOB é o que impede o dia de parar.** MedSênior,
Beneficência Vital, Santa Tereza e as outras já não passam pelo Painel — com o
Dell fora do ar, essas continuam cotando normalmente. É o argumento de sempre:
cada operadora que sai pra tabela própria encolhe este risco por baixo.

## 6. Fazer a fila andar rápido, sem parecer oito pessoas

Uma conta = uma cotação por vez. Quem chegou depois espera. O jeito de a espera
ser curta **não é abrir mais frentes** (é exatamente isso que denuncia), é
**cada cotação terminar mais cedo**.

Onde está o tempo, medido: **97% é o Painel respondendo**; as pausas humanas
que eu coloco são 3%. E dentro de uma cotação, o preço de cada plano é uma
chamada independente — hoje elas vão uma atrás da outra.

**Buscar os preços dos planos em paralelo** (3 de cada vez, não todos) encurta
a cotação inteira e faz a fila andar. E não muda o que o Painel vê de forma
suspeita: um corretor com a tela aberta dispara várias dessas chamadas ao
mudar um filtro — é o comportamento normal daquela tela, não uma anomalia.

**As pausas humanas ficam.** Elas custam 3% e são o que separa "usuário
rápido" de "robô".

## 7. Ordem de entrega

Cada etapa termina funcionando. Nada de meia ponte.

**Etapa 1 — a fila existe e uma cotação atravessa.**
Servidor (Antigravity) + trabalhador no Dell + a espera com barra.
No fim desta etapa: a Bianca clica em Cotar e o preço vem do Dell. **Isto já é
usável.**

**Etapa 2 — a fila não some sem avisar.**
Sinal de vida, aviso pra você, mensagem honesta pra consultora, saída pelas
tabelas do JOB.

**Etapa 3 — a fila anda rápido.**
Preços em paralelo, mediana real no "costuma levar X segundos".

**Etapa 4 — trocar de máquina sem chamar ninguém.**
O botão "Este é o computador que cota" na tela de aparelhos.

Etapa 1 é o gargalo e depende do Antigravity entregar as rotas. As outras três
são minhas e não travam ninguém.

## 8. O que este projeto NÃO resolve

Escrito de propósito, pra não virar promessa:

- **Não tira o Painel do caminho.** Continua sendo sistema de terceiro, e se
  eles mudarem a tela, o cotador quebra igual hoje (a receita de conserto está
  em `wa-js-dependencia-critica.md`, o padrão é o mesmo).
- **Não faz oito cotações ao mesmo tempo.** É uma conta. Se isso virar
  gargalo de verdade — medido, não achado — a conversa é comprar uma segunda
  conta e uma segunda máquina, não abrir frentes na mesma.
- **Não some com o risco do ponto único.** Reduz o tempo em que você fica cego
  pra ele, e dá uma saída pelas tabelas próprias. Não é a mesma coisa que
  redundância.
