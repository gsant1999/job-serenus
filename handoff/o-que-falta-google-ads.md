# Conversão offline do Google Ads — o que falta, e quem faz

Medido em 04/08/2026 contra a conta real e contra o banco de produção.

## O que já está funcionando (não precisa de ninguém)

- Marcação automática da conta Google Ads: **ligada**. O `gclid` está na URL dos anúncios.
- Conta **SERENUS VITAR** (2156798395), moeda BRL, fuso São Paulo.
- Ação de conversão **7707727385 "CRM - Lead Qualificado"**, tipo `UPLOAD_CLICKS`, ativa.
- Login OAuth: funciona (troca refresh token por access token, e lê a conta).
- O JOB: fila de conversão, envio automático de hora em hora, tela de acompanhamento,
  botão de teste que valida sem gravar nada.

## Falta 1 — Google Cloud (30 minutos, pessoa com acesso ao projeto)

O projeto do Google Cloud é o dono das credenciais. São três ajustes lá dentro.

### 1.1 Habilitar a Data Manager API

`APIs e serviços → Biblioteca → "Data Manager API" → Ativar`

**Por que:** o Google fechou o caminho antigo. Ao tentar enviar hoje, ele responde
textualmente: *"New integrations for uploading click conversions should use the Data
Manager API. Usage of ConversionUploadService.UploadClickConversions is limited to
existing users."* É uma API **diferente** da Google Ads API — ter a Ads API ligada
não serve.

### 1.2 Cadastrar o endereço de retorno da autorização

`APIs e serviços → Credenciais → o cliente OAuth → URIs de redirecionamento autorizados → Adicionar`

Colar exatamente isto, sem barra no final:

```
https://job-serenus-production.up.railway.app/google-ads/autorizado
```

**Por que:** o cliente OAuth é do tipo "aplicativo Web", então só aceita voltar para
endereços cadastrados. Sem isso a autorização morre em `redirect_uri_mismatch` — que
foi o erro que apareceu ao tentar pelo caminho de linha de comando.

### 1.3 Marcar o escopo da Data Manager na tela de consentimento

`Google Auth Platform → Acesso a dados → Adicionar ou remover escopos → marcar Data Manager API`

**Por que:** é um escopo classificado como sensível pelo Google. Se não estiver
marcado ali, a autorização até funciona, mas volta **sem** a permissão de entregar
conversão — e o erro só aparece depois, no envio, como `403`.

### Como saber que deu certo

No JOB: **Conversão offline → Autorizar no Google**. A tela de retorno diz quais
escopos vieram. Depois, **Testar ligação**: os cinco degraus têm que passar.

## Falta 2 — a landing page (quem mexe no Lovable)

Dois projetos: `vera-cruz-teste-A-formulario-curto` e `vera-cruz-teste-B-prova-social`.

**Nenhuma credencial do Google vai para a página.** Elas rodam no navegador do
visitante — qualquer pessoa lê o código-fonte. A página só captura e avisa; quem fala
com o Google é o servidor.

### 2.1 Avisar o JOB no envio do formulário

Depois de enviar o formulário (junto do webhook que já existe, não no lugar dele):

```js
fetch('https://job-serenus-production.up.railway.app/api/clique', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    telefone: dados.telefone,          // o mesmo do formulário
    gclid:  utms.gclid,
    gbraid: utms.gbraid,
    wbraid: utms.wbraid,
    utm_source: utms.utm_source,
    utm_medium: utms.utm_medium,
    utm_campaign: utms.utm_campaign,
    landing_url: window.location.href,
  }),
}).catch(() => {});   // nunca pode atrapalhar o envio do lead
```

**Por que:** hoje o `gclid` vai para o n8n e morre lá, porque a planilha não tem
coluna para ele. Este atalho tira o n8n do caminho do clique. O lead continua indo
pelo caminho de sempre — nada duplica.

### 2.2 Cookie de 90 dias e captura de iPhone

Está no arquivo `captura-clique-lovable.md`, com o código pronto para substituir o
`utmTracker.ts`. Resolve dois furos:

- hoje o clique é guardado em `sessionStorage`, que **morre quando a aba fecha**;
- hoje só se captura `gclid`. Em iPhone e dentro de app o Google manda `gbraid` ou
  `wbraid` — e isso é metade do tráfego mobile.

## Falta 3 — o n8n (opcional agora)

Com o item 2.1 no ar, o n8n **deixa de ser bloqueio**. Continua valendo pedir a quem
mantém (maggiodigital) que acrescente quatro colunas no nó que grava a planilha —
`gclid`, `gbraid`, `wbraid`, `landing_url` — porque isso dá um segundo caminho para o
mesmo dado, e as colunas N até AC da planilha estão livres. Mas não trava mais nada.

## Resumo de quem faz o quê

| # | O quê | Onde | Quem |
|---|---|---|---|
| 1.1 | Ativar Data Manager API | Google Cloud | quem administra o projeto |
| 1.2 | Cadastrar URI de retorno | Google Cloud → Credenciais | idem |
| 1.3 | Marcar escopo Data Manager | Google Auth Platform | idem |
| — | Clicar em Autorizar e Testar | JOB | Guilherme |
| 2.1 | Avisar o clique ao JOB | Lovable (2 projetos) | quem mexe nas páginas |
| 2.2 | Cookie 90d + gbraid/wbraid | Lovable (2 projetos) | idem |
| 3 | Colunas de clique na planilha | n8n maggiodigital | opcional |

## Uma expectativa honesta sobre o resultado

Não é interruptor de faturamento. O Smart Bidding do Google precisa de volume para
aprender — a régua usual é 30 a 50 conversões por mês. Hoje o sistema tem **1 venda**
marcada como Emitida/Ativa, e 5% dos leads vêm do Google Ads.

O ganho imediato não é o algoritmo otimizar; é **passar a saber quais buscas viram
venda**, em vez de quais viram formulário. Isso já muda o que pausar e o que
aumentar. A otimização automática vem depois, com volume.

Vale registrar dois problemas de qualidade de dado que aparecem no meio disso, e que
valem tanto quanto: a campanha do Google chega na planilha sempre como a palavra
`search` (não o nome real), e o `utm_term` tem só dois valores fixos em vez da palavra
que a pessoa digitou. Com `{keyword}` no modelo de acompanhamento, o relatório por
busca passa a existir.
