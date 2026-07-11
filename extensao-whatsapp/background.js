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
  // chrome.storage.local (não sync — o limite de 8KB por item do sync às
  // vezes disparava "quota exceeded"; local não tem essa restrição).
  let { jobUrl, extKey } = await chrome.storage.local.get(['jobUrl', 'extKey']);
  if (jobUrl === undefined && extKey === undefined) {
    const antigo = await chrome.storage.sync.get(['jobUrl', 'extKey', 'usuarioId']);
    if (antigo.jobUrl || antigo.extKey) {
      await chrome.storage.local.set(antigo);
      jobUrl = antigo.jobUrl; extKey = antigo.extKey;
    }
  }
  return {
    jobUrl: (jobUrl || JOB_URL_PADRAO).replace(/\/+$/, ''),
    extKey: extKey || ''
  };
}

async function chamarJob(caminho, metodo, corpo) {
  const { jobUrl, extKey } = await config();
  if (!extKey) {
    return { ok: false, erro: 'Configure a chave da extensão no popup (clique no ícone do JOB).' };
  }
  try {
    const resp = await fetch(jobUrl + caminho, {
      method: metodo,
      headers: {
        'Content-Type': 'application/json',
        'X-Extension-Key': extKey
      },
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    let dados = null;
    try { dados = await resp.json(); } catch (e) { dados = null; }
    if (!resp.ok) {
      return { ok: false, erro: (dados && dados.erro) || ('HTTP ' + resp.status), status: resp.status };
    }
    return dados || { ok: true };
  } catch (e) {
    return { ok: false, erro: 'Não consegui falar com o JOB: ' + e.message };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'ping') {
    chamarJob('/api/whatsapp/ping', 'GET', null).then(sendResponse);
    return true; // resposta assíncrona
  }
  if (msg && msg.type === 'usuarios') {
    chamarJob('/api/whatsapp/usuarios', 'GET', null).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'estado') {
    chamarJob('/api/whatsapp/estado?telefone=' + encodeURIComponent(msg.telefone || ''), 'GET', null).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'analisar') {
    chamarJob('/api/whatsapp/analisar', 'POST', msg.payload).then(sendResponse);
    return true;
  }
  return false;
});
