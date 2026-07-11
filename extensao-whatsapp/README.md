# JOB Serenus — Extensão de Análise de WhatsApp

Extensão de navegador (Chrome/Edge) que lê a conversa aberta no **WhatsApp Web**,
casa com o lead no **JOB**, calcula o **Score do lead** e mostra **sugestões de
próxima ação** — direto ao lado da conversa.

## Segurança: por que isso NÃO bane o número

A extensão é **100% leitura**. Ela:

- lê a conversa que **você já abriu** na sua sessão do WhatsApp Web;
- rola o histórico pra cima devagar (ritmo humano) pra carregar mais mensagens;
- injeta um botão e um painel próprios na página.

Ela **nunca**:

- digita no campo de mensagem, clica em "enviar" nem manda nada;
- abre conexão de protocolo/API do WhatsApp;
- faz qualquer ação em massa ou envio automático.

Ler o DOM da sua própria sessão é o mesmo que você lendo com os olhos — é o
caminho de **menor risco possível** de banir o número. Diferente de disparo em
massa (que é o que realmente derruba número), aqui não há envio nenhum.

## Instalação (uma vez)

1. Abra `chrome://extensions` no Chrome (ou `edge://extensions` no Edge).
2. Ligue o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e selecione a pasta `extensao-whatsapp`.
4. O ícone azul do JOB aparece na barra. Clique nele e preencha:
   - **URL do JOB**: `https://job-serenus-production.up.railway.app`
   - **Chave da extensão**: a mesma do Railway (variável `WHATSAPP_EXT_KEY`).
5. Clique em **Testar conexão** — deve dizer "Conectado ao JOB ✓".

## Configuração no servidor (uma vez)

No Railway, adicione a variável de ambiente:

```
WHATSAPP_EXT_KEY = <sua-chave-secreta>
```

Sem essa variável o endpoint recusa tudo (fail-closed). Use uma chave forte, por
exemplo a gerada nesta entrega. A **mesma** chave vai no popup da extensão.

## Uso no dia a dia

1. Abra o WhatsApp Web e clique numa conversa de lead.
2. Clique no botão **"JOB · Analisar lead"** (canto inferior direito).
3. A extensão lê a conversa (rola o histórico), manda pro JOB e mostra:
   - **Score 0–100** e a faixa (quente / morno / frio);
   - se o telefone **casou com um lead** no CRM (com link pra ficha);
   - **sugestões** de próxima ação;
   - um **resumo** das últimas trocas.

A análise também fica registrada na timeline do lead no CRM.

## Arquitetura

```
WhatsApp Web ──(lê DOM)── content.js ──(mensagem)── background.js ──(HTTPS)── JOB /api/whatsapp/analisar
                                                                                  │
                                                                    casa lead · score · sugestões
```

- `content.js` roda dentro do WhatsApp Web (leitura + UI).
- `background.js` (service worker) faz a chamada HTTP — o content script não
  consegue por causa do CSP do WhatsApp Web.
- O JOB casa pelo `telefone_norm`, grava em `whatsapp_analises` e responde.

## O que ainda vem depois

- O **Score** hoje é heurístico (palavras-chave de interesse/recusa, engajamento).
  Quando o Guilherme mandar as regras do "Score Lead" dele, é só trocar os pesos
  em `_wa_score_conversa` no `app.py` — a conversa inteira já fica gravada, então
  dá pra reprocessar o histórico com a régua nova sem raspar o WhatsApp de novo.
