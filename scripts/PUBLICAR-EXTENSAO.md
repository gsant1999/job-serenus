# Publicar a extensão na Chrome Web Store (não listada)

Objetivo: deixar a extensão "online" pra a equipe instalar com 1 clique e
**atualizar sozinha** (fim do problema de ficar presa numa versão velha).
Modo "não listada": não aparece em busca, só quem tem o link instala.

## O que já está pronto (feito pelo assistente)
- **Arquivo pra subir:** `dist/job-serenus-extensao.zip` (na pasta do projeto).
- **Política de privacidade (exigida pela loja):**
  https://job-serenus-production.up.railway.app/extensao/privacidade
- **Textos da loja e justificativas** (abaixo).

## O que só você pode fazer
Criar a conta de desenvolvedor, pagar a taxa e aceitar os termos — o
assistente não faz login, não paga nem aceita termos no seu lugar.

---

## Passo a passo

1. Acesse **https://chrome.google.com/webstore/devconsole** e entre com uma
   conta Google da Serenus (idealmente uma conta "de sistema", não a pessoal —
   ex.: `ti@serenuscorretora.com.br` — pra não ficar amarrado a uma pessoa).
2. Pague a **taxa única de US$ 5** (só na primeira vez, vale pra sempre).
3. Clique em **"Novo item"** e envie o `dist/job-serenus-extensao.zip`.
4. Preencha a ficha da loja com os textos abaixo.
5. Em **Visibilidade**, escolha **"Não listada"**.
6. Envie pra revisão. A 1ª revisão do Google leva de algumas horas a poucos
   dias. Depois de aprovada, você recebe o **link de instalação** — manda pra
   equipe, cada um instala com 1 clique.

## Textos pra colar na ficha da loja

**Nome:** JOB Serenus — Análise de WhatsApp

**Descrição curta (já no .zip):** Painel dentro do WhatsApp Web para
consultores da Serenus: analisa o lead, calcula o Score e envia mensagens da
biblioteca.

**Descrição detalhada:**
> Ferramenta interna da Serenus Corretora de Saúde. Adiciona um painel ao
> WhatsApp Web que ajuda o consultor a: analisar a conversa do lead e calcular
> um Score no sistema JOB da corretora; e enviar mensagens/áudios da biblioteca
> de modelos da equipe. Todo envio é uma ação explícita do consultor — nunca
> automático nem em massa. Uso restrito à equipe da Serenus.

**Categoria:** Fluxo de trabalho e planejamento (ou Produtividade).

**Finalidade única (single purpose):** Auxiliar consultores da Serenus a
analisar leads e enviar mensagens padronizadas dentro do WhatsApp Web.

**Política de privacidade (URL):**
https://job-serenus-production.up.railway.app/extensao/privacidade

**Justificativa das permissões** (a loja pergunta uma a uma):
- `storage`: guardar as configurações do consultor no navegador.
- `notifications`: avisar quando uma análise termina.
- Acesso a `web.whatsapp.com`: é onde o painel é exibido e a conversa é lida.
- Acesso ao sistema JOB (`job-serenus-production.up.railway.app`): enviar a
  análise e buscar os modelos de mensagem.

**Uso de dados (declaração obrigatória):** marque que o produto **coleta**
"conteúdo de comunicações do usuário" (a conversa analisada). Declare que os
dados são usados só pra funcionalidade do app, **não são vendidos** e **não são
usados pra publicidade**.

---

## Depois de publicada — como a equipe instala
Manda o link da loja pra cada consultora. Ela clica em "Usar no Chrome" /
"Adicionar". Pronto — e toda correção que eu publicar chega sozinha (algumas
horas), sem copiar pasta nunca mais.

## Atenção pro futuro (corretores externos / SaaS)
Hoje a extensão usa **uma chave compartilhada** pra falar com o JOB — ok pra
equipe interna. Se um dia for pra corretores de FORA, antes disso precisa de
**login por usuário** na extensão (a chave compartilhada poderia ser extraída
por quem instalar). É um projeto à parte — me avisa quando chegar essa hora.

## Se preferir não usar a loja agora
Dá pra continuar por pasta, mas volta o problema de hoje (sem auto-update, cada
correção = copiar a pasta pra todo mundo). A loja é o certo pra escalar.
