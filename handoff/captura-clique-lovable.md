# Captura do clique do anúncio — o que falta fora do JOB

Medido em 04/08/2026, contra produção e contra as páginas no ar.

## O que já funciona

- **As landing pages capturam o `gclid`.** Confirmado lendo o bundle publicado de
  `cotacao-a.veracruzplano.com.br` e `cotacao-b.veracruzplano.com.br`: o
  `utmTracker` lê `gclid` da URL e o `webhookSender` manda no payload do formulário.
- **O JOB sabe ler.** `_processar_lead` procura as colunas `gclid`/`GCLID`/`GClid`
  na planilha, e `/webhook/sheets` lê `gclid`, `gbraid`, `wbraid` e `gcl_id`.
  A partir de 04/08 também preenche o clique em lead que **já existe** (antes só
  gravava na criação, e o Apps Script reenvia o mesmo telefone o tempo todo).

## O que quebra a corrente

### 1. A planilha não tem coluna de clique — é o bloqueio principal

A planilha `[AUTOMAÇÃO] Leads Guilherme Google`
(`1QT8y8rfbMaHb5POrYFZKjdccpgMLLY3WRjBjxFmold8`, aba `Página1`) tem 29 colunas.
Nenhuma é `gclid`. São 1.417 linhas de lead sem nenhum identificador de clique.

Resultado em produção: **5.627 leads no CRM, zero com `gclid`.**

O formulário manda o `gclid` para o n8n da maggiodigital
(`https://webhooks.maggiodigital.com.br/webhook/form-gui-lovable2`), e o fluxo do
n8n grava a linha na planilha — mas sem levar esse campo.

**O que pedir a quem mantém o n8n:** no nó que faz o *Append row* na planilha,
acrescentar quatro colunas e mapear os campos que já chegam no payload:

| Coluna na planilha | Campo no payload |
|---|---|
| `gclid` | `gclid` |
| `gbraid` | `gbraid` |
| `wbraid` | `wbraid` |
| `landing_url` | `page` |

Não precisa mexer em mais nada: o JOB já lê essas colunas com esse nome.

### 2. As páginas não capturam `gbraid`/`wbraid` — perde o iPhone

Quando o clique vem de iPhone ou de dentro de um app, o Google **não manda
`gclid`**: manda `gbraid` ou `wbraid`. Os bundles no ar não têm nenhum dos dois
(verificado por busca no JS publicado). Metade do tráfego mobile não tem como
voltar pro Google, mesmo com o resto da corrente pronta.

### 3. O clique morre quando a aba fecha

O `utmTracker` guarda em `sessionStorage`, que só vive enquanto a aba está aberta.
Quem clica no anúncio, fecha, e volta depois pra preencher o formulário chega sem
clique nenhum. O padrão do mercado é cookie de 90 dias — que é justamente a janela
que o Google aceita entre o clique e a conversão.

## Patch para o `src/lib/utmTracker.ts`

Resolve os itens 2 e 3. Substitui o arquivo inteiro.

```ts
// Captura e persiste os parâmetros de campanha e o identificador do clique.
//
// Cookie de 90 dias, não sessionStorage: 90 dias é a janela que o Google aceita
// entre o clique e a conversão, e sessionStorage morre quando a aba fecha — quem
// clica no anúncio, fecha e volta depois pra preencher chegaria sem clique nenhum.
//
// gbraid/wbraid entram junto com gclid: em iPhone e dentro de app o Google não
// manda gclid, manda um desses dois. Sem eles, metade do tráfego mobile não tem
// como ser devolvida como venda.
const CHAVE = 'job_utm';
const DIAS = 90;

const CAMPOS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'gclid', 'gbraid', 'wbraid', 'fbclid',
] as const;

export type StoredUtms = Record<(typeof CAMPOS)[number], string> & { landing_url: string };

const vazio = (): StoredUtms =>
  ({ ...Object.fromEntries(CAMPOS.map((k) => [k, ''])), landing_url: '' }) as StoredUtms;

const escreverCookie = (valor: string): void => {
  const exp = new Date(Date.now() + DIAS * 864e5).toUTCString();
  // SameSite=Lax deixa o cookie sobreviver à chegada vinda do anúncio.
  document.cookie = `${CHAVE}=${encodeURIComponent(valor)};expires=${exp};path=/;SameSite=Lax`;
};

const lerCookie = (): string => {
  const m = document.cookie.match(new RegExp('(?:^|; )' + CHAVE + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
};

export const captureUtms = (): void => {
  if (typeof window === 'undefined') return;

  const params = new URLSearchParams(window.location.search);
  const daUrl: Partial<StoredUtms> = {};
  let temClique = false;
  let temAlgo = false;

  for (const k of CAMPOS) {
    const v = (params.get(k) || '').trim();
    if (!v) continue;
    daUrl[k] = v;
    temAlgo = true;
    if (k === 'gclid' || k === 'gbraid' || k === 'wbraid') temClique = true;
  }
  if (!temAlgo) return;
  if (temClique) daUrl.landing_url = window.location.href.split('#')[0];

  // PRIMEIRO TOQUE, com uma exceção: uma visita nova que traz clique de anúncio
  // sobrescreve. É a visita que o Google vai querer creditar, e é a única cujo
  // identificador ainda está dentro da janela de conversão.
  let atual: Partial<StoredUtms> = {};
  try {
    atual = JSON.parse(lerCookie() || '{}');
  } catch {
    atual = {};
  }
  const temCliqueSalvo = !!(atual.gclid || atual.gbraid || atual.wbraid);
  if (temCliqueSalvo && !temClique) return;

  escreverCookie(JSON.stringify({ ...vazio(), ...atual, ...daUrl }));
};

export const getStoredUtms = (): StoredUtms => {
  if (typeof window === 'undefined') return vazio();
  try {
    return { ...vazio(), ...JSON.parse(lerCookie() || '{}') };
  } catch {
    return vazio();
  }
};

captureUtms();
```

E no `src/lib/webhookSender.ts`, o `getMetadata()` passa a mandar os três
identificadores em vez de só o `gclid`:

```ts
const getMetadata = () => {
  const u = getStoredUtms();
  return {
    page: typeof window !== 'undefined' ? window.location.href : '',
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    gclid: u.gclid,
    gbraid: u.gbraid,
    wbraid: u.wbraid,
    landing_url: u.landing_url,
    utm_source: u.utm_source,
    utm_medium: u.utm_medium,
    utm_campaign: u.utm_campaign,
    utm_term: u.utm_term,
    utm_content: u.utm_content,
  };
};
```

O tipo `WebhookPayload` precisa ganhar `gbraid?`, `wbraid?` e `landing_url?`.

## Antes de tudo isso: o auto-tagging

Nada acima serve se o Google não estiver marcando as URLs. Em **Google Ads →
Configurações da conta → Marcação automática**, a opção "Marcar o URL final"
precisa estar ligada. É ela que faz o `?gclid=...` aparecer na URL do anúncio.

Se estiver desligada, as páginas capturam corretamente um parâmetro que nunca
chega — e o número de leads com clique continua zero.

## LGPD

`gclid` e UTM são cookies de rastreio, não essenciais: exigem consentimento
explícito (banner opt-in, nada pré-marcado). O lead é de plano de saúde, então:
o formulário não deve coletar condição de saúde na captação, e o identificador
do clique nunca pode ser usado para segmentar por saúde.
