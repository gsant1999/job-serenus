# JOB Serenus — Extensão de Análise de WhatsApp

Extensão de navegador (Chrome/Edge) que lê a conversa aberta no **WhatsApp Web**,
casa com o lead no **JOB** (ou cria automaticamente), calcula o **Score Lead**
oficial (0–1000) e mostra **sugestões de próxima ação** — direto ao lado da
conversa. A partir da versão `2.0.0` também manda mensagem de texto, mas só
quando o consultor coloca explicitamente na fila pelo CRM (nunca em massa,
nunca por conta própria da extensão).

## Segurança: leitura sempre foi, envio é sob demanda e com limite

A **análise de lead continua 100% leitura**: lê a conversa que você já abriu,
rola o histórico devagar (ritmo humano), baixa mídia que já está na tela sem
apertar play, nunca digita ou clica em "enviar" por conta própria.

A partir da Fase 1, existe **também** um envio — com um desenho pensado pra
minimizar risco:

- só manda mensagem que o consultor colocou explicitamente na fila do CRM
  (`/crm/lead/<id>/whatsapp-extensao/enfileirar`) — a extensão nunca decide
  sozinha o quê ou quando mandar;
- o limite de ritmo entre envios mora no **servidor** (não dá pra burlar
  mudando o client), configurável via `WA_FILA_GATE_SEGUNDOS`;
- sem disparo em massa nesta fase — isso é uma fase futura própria, com
  aquecimento de número e teto diário, só depois de validar em volume baixo.

Ler o DOM da sua própria sessão continua sendo o caminho de menor risco pra
leitura. Pro envio, o risco real é inerente a automatizar WhatsApp Web não
oficial — o desenho aqui existe pra reduzir esse risco, não pra fingir que
ele não existe.

## Instalação (uma vez)

1. Abra `chrome://extensions` no Chrome (ou `edge://extensions` no Edge).
2. Ligue o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e selecione a pasta `extensao-whatsapp`.
4. O ícone azul do JOB aparece na barra. Clique nele e preencha:
   - **URL do JOB**: `https://job-serenus-production.up.railway.app`
   - **Chave da extensão**: a mesma do Railway (variável `WHATSAPP_EXT_KEY`).
   - **Quem está usando (consultor)**: seleciona seu nome na lista — é quem vira
     o responsável de qualquer lead criado automaticamente por essa análise.
5. Clique em **Testar conexão** — deve dizer "Conectado ao JOB ✓".

Sempre que a extensão for atualizada (novo `git pull`), volte em
`chrome://extensions` e clique no ícone de recarregar (⟳) da extensão — o
Chrome não pega os arquivos novos sozinho.

## Configuração no servidor (uma vez)

No Railway, variáveis relevantes (só `WHATSAPP_EXT_KEY` é obrigatória; o resto
tem valor padrão e degrada gracioso se faltar):

```
WHATSAPP_EXT_KEY = <sua-chave-secreta>        # obrigatória — sem ela o endpoint recusa tudo (fail-closed)
ANTHROPIC_API_KEY = sk-ant-...                # leitura de imagem/PDF/link e resumo pela IA (Claude)
CLAUDE_MODEL = claude-haiku-4-5               # opcional, padrão já é o mais barato
GROQ_API_KEY = gsk_...                        # transcrição de áudio — ~9x mais barata, prioridade (com fallback pra OpenAI se a chamada falhar de verdade)
OPENAI_API_KEY = sk-...                       # fallback de transcrição — retenção zero documentada (relevante por ser dado de saúde)
USD_BRL_TAXA = 5.10                           # câmbio fixo pro painel de custo mostrar em R$ (ajustar de vez em quando)
```

A **mesma** `WHATSAPP_EXT_KEY` vai no popup da extensão.

## Uso no dia a dia

A extensão vive num **trilho fino fixo na lateral do WhatsApp Web** (direita
por padrão, dá pra trocar pra esquerda no popup) — sem botão solto, sem
janela flutuando por cima da conversa. Clicar num ícone do trilho **doca**
um painel ao lado, empurrando o WhatsApp (ou sobrepondo, em tela estreita).

**Análise de lead** (ícone "Análise"):
1. Abra uma conversa de lead e clique no ícone.
2. Se ainda não tem análise pra essa conversa, aparece o botão **"Analisar
   este lead"**. A extensão lê o histórico inteiro (ou só o que for novo, se
   já tiver analisado antes — modo incremental), baixa imagens, áudio, PDF e
   links, manda tudo pro JOB e mostra:
   - **Score Lead 0–1000** e a faixa (quente / bom / médio / baixo / improvável),
     com quantos dos 28 critérios oficiais entraram na conta;
   - se o lead **já existe no CRM** (com link pra ficha) ou **foi criado agora**;
   - **dados extraídos** da conversa e dos anexos (cidade, idade/faixa etária,
     CNPJ, operadora, plano preferido, tipo de contratação...);
   - **leitura da IA** (Claude): resumo, o que foi lido em cada imagem/PDF,
     sinais de atenção, próximas ações concretas;
   - **áudios transcritos**, com quem falou cada um;
   - **follow-up pronto** pra copiar e colar.
3. Dá pra trocar de conversa com a análise ainda rodando — ela continua em
   segundo plano (um badge no ícone mostra quantas estão em andamento) e o
   painel mostra sempre a análise certa pra conversa que estiver aberta.
   Notificação do sistema avisa quando termina.

A análise fica registrada na timeline do lead no CRM, sobe os dados de
qualificação pra ficha (sem apagar o que já tiver sido preenchido à mão), e
dispara uma notificação no sino do JOB quando cria um lead novo.

**Mensagens** (ícone "Mensagens"):
Lista os modelos de mensagem de WhatsApp cadastrados no site (`/crm/modelos`,
admin) — nome, prévia do texto, se tem mídia anexada. Botão **Enviar** manda
o texto pra conversa aberta agora (pela mesma fila com limite de ritmo do
servidor); **Copiar texto** pra quem preferir colar manualmente. Criar/editar
modelo é só no site — a extensão nunca decide sozinha o que existe na
biblioteca. Modelo com áudio/imagem anexado fica listado mas ainda não pode
ser enviado (fase própria futura).

## Custo

Cada análise grava o custo real (tokens da Claude + segundos de áudio
transcrito). Painel completo em `/whatsapp-analises` no JOB: gasto em R$ (e
US$) por hoje/semana/mês/ano/total, separado por provedor (Claude vs.
transcrição), mais o comparativo de score contra o desfecho real dos leads
(ganho/perdido) — essa parte fica confiável com o tempo, conforme mais leads
analisados pela extensão forem fechando o funil.

## Arquitetura

```
WhatsApp Web ──(lê DOM)── content.js ──(postMessage)── wpp-bridge.js (MAIN world / wa-js)
                   │                                    baixa áudio/PDF, resolve telefone real
                   │
                   └──(mensagem)── background.js ──(HTTPS)── JOB /api/whatsapp/*
                                                                  │
                                                     casa/cria lead · score · qualificação · custo
```

- `content.js` roda isolado dentro do WhatsApp Web (leitura do DOM + UI do painel).
- `wpp-bridge.js` roda no **mesmo contexto da página** (`world: MAIN`), porque
  é onde vive `window.WPP` — a wa-js já injetada pela extensão WaSpeed. É por
  aí que se baixa áudio/PDF sem apertar play e se resolve o telefone real via
  `chat.id` (só funciona pra contato "normal"; conta business/privacidade nova
  usa `@lid`, um ID interno que o WhatsApp não expõe como telefone em lugar
  nenhum do cliente — nesse caso cai pro nome como identificador).
- `background.js` (service worker) é o único lugar que faz `fetch` pro JOB — o
  content script não consegue por causa do CSP do WhatsApp Web.
- O JOB casa por `telefone_norm` (ou nome), grava em `whatsapp_analises`,
  atualiza/cria o lead em `crm_leads` e responde.

## Motor de Score e IA

- **Score Lead**: modelo oficial 0–1000, 28 categorias (0–50 cada, passo de 5),
  normalização dinâmica — categoria sem evidência na conversa/anexo sai do
  cálculo (nunca some nem pontua sozinha), penalidades e tetos por cenário
  crítico, arredondado pra múltiplo de 50. Código em `_wa_extrair_lead` e
  `_wa_score_lead` no `app.py`.
- **IA (Claude)**: opcional — sem `ANTHROPIC_API_KEY` o sistema roda 100% no
  motor heurístico, sem custo nem latência extra. Com a chave, a Claude lê a
  conversa + imagens + PDFs + links e devolve leitura narrativa (nunca
  recalcula o score, só pode derrubá-lo se a conversa não for uma negociação
  real) e dados estruturados vistos em anexo (idade/faixa etária, CNPJ, tipo
  de contratação, plano preferido) que têm prioridade sobre um regex fraco no
  texto solto. Código em `_analisar_com_claude`.
- **Transcrição de áudio**: opcional — sem `OPENAI_API_KEY`/`GROQ_API_KEY` os
  áudios simplesmente não entram na análise (resto funciona normal). Prioriza
  os áudios do **lead** sobre os do consultor quando a conversa tem mais que o
  teto de 12. Código em `_transcrever_audio`.
