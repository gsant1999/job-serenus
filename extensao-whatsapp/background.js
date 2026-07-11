// ─── JOB Serenus · Service Worker (ponte de rede) ───────────────────────────
// O content script NÃO consegue chamar o JOB direto: o WhatsApp Web tem um CSP
// estrito que bloqueia fetch pra fora do domínio dele. Então o content script
// manda os dados pra cá (service worker), que não sofre o CSP da página e tem
// host_permissions, e ESTE arquivo faz a chamada HTTP pro JOB.
//
// Este worker SÓ FALA COM O JOB. Ele nunca toca no WhatsApp — não tem como
// enviar mensagem daqui. Toda a superfície de risco de "banir o número" mora
// no WhatsApp Web, e o content script é 100% leitura.

const JOB_URL_PADRAO = 'https://job-serenus-production.up.railway.app';

async function config() {
  // chrome.storage.local — nunca sync (limite de 8KB por item, sujeito à
  // cota da conta Google; local não tem essa restrição).
  const { jobUrl, extKey } = await chrome.storage.local.get(['jobUrl', 'extKey']);
  return {
    jobUrl: (jobUrl || JOB_URL_PADRAO).replace(/\/+$/, ''),
    extKey: extKey || ''
  };
}

async function chamarJob(caminho, metodo, corpo, timeoutMs) {
  const { jobUrl, extKey } = await config();
  if (!extKey) {
    return { ok: false, erro: 'Configure a chave da extensão no popup (clique no ícone do JOB).' };
  }
  // Sem isso, se o servidor travasse (não desse erro, só não respondesse), o
  // painel ficava preso em "Calculando o score…" pra sempre, sem forma de
  // recuperar sem recarregar a aba. AbortController garante que SEMPRE
  // resolve dentro do prazo, erro claro em vez de promise pendurada.
  const limite = timeoutMs || 15000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limite);
  try {
    const resp = await fetch(jobUrl + caminho, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        'X-Extension-Key': extKey
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: controller.signal
    });
    let dados = null;
    try { dados = await resp.json(); } catch (e) { dados = null; }
    if (!resp.ok) {
      return { ok: false, erro: (dados && dados.erro) || ('HTTP ' + resp.status), status: resp.status };
    }
    return dados || { ok: true };
  } catch (e) {
    const erro = e.name === 'AbortError'
      ? 'O JOB demorou mais que ' + Math.round(limite / 1000) + 's pra responder — tente de novo.'
      : 'Não consegui falar com o JOB: ' + e.message;
    return { ok: false, erro };
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'ping') {
    chamarJob('/api/whatsapp/ping', 'GET', null, 15000).then(sendResponse);
    return true; // resposta assíncrona
  }
  if (msg && msg.type === 'usuarios') {
    chamarJob('/api/whatsapp/usuarios', 'GET', null, 15000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'estado') {
    chamarJob('/api/whatsapp/estado?telefone=' + encodeURIComponent(msg.telefone || ''), 'GET', null, 15000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'analisar') {
    // Mais generoso: pode encadear várias transcrições de áudio sequenciais
    // no servidor (até 90s cada) + leitura pela Claude.
    chamarJob('/api/whatsapp/analisar', 'POST', msg.payload, 300000).then(sendResponse);
    return true;
  }
  return false;
});
