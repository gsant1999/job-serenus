// ─── JOB Serenus · Service Worker (ponte de rede) ───────────────────────────
// O content script NÃO consegue chamar o JOB direto: o WhatsApp Web tem um CSP
// estrito que bloqueia fetch pra fora do domínio dele. Então o content script
// manda os dados pra cá (service worker), que não sofre o CSP da página e tem
// host_permissions, e ESTE arquivo faz a chamada HTTP pro JOB.
//
// Este worker SÓ FALA COM O JOB (nunca toca no WhatsApp diretamente — quem
// manda mensagem de verdade é a ponte MAIN world, wpp-bridge.js). A partir
// da Fase 1, esse HTTP inclui perguntar ao JOB "tem algo pra mandar?" e
// confirmar depois de mandar — mas a decisão de QUE mensagem e QUANDO é
// sempre do consultor lá no CRM, nunca decidida aqui.

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

// reqId -> {controller, cancelado}. Só existe enquanto a chamada está em voo —
// permite que o content script cancele uma análise específica (pode ter mais
// de uma rodando pra conversas diferentes ao mesmo tempo) sem afetar as outras.
const _emAndamento = new Map();

async function chamarJob(caminho, metodo, corpo, timeoutMs, reqId) {
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
  const registro = reqId ? { controller, cancelado: false } : null;
  if (reqId) _emAndamento.set(reqId, registro);
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
    let erro;
    if (e.name === 'AbortError') {
      erro = (registro && registro.cancelado)
        ? 'Análise cancelada.'
        : 'O JOB demorou mais que ' + Math.round(limite / 1000) + 's pra responder — tente de novo.';
    } else {
      erro = 'Não consegui falar com o JOB: ' + e.message;
    }
    return { ok: false, erro };
  } finally {
    clearTimeout(timer);
    if (reqId) _emAndamento.delete(reqId);
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
    chamarJob('/api/whatsapp/analisar', 'POST', msg.payload, 300000, msg.reqId).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'enviar_direto') {
    // Compor e mandar direto do painel da extensão, sem precisar abrir o
    // site do JOB — enfileira e casa/cria o lead pelo telefone da conversa.
    chamarJob('/api/whatsapp/enviar-direto', 'POST', msg.payload, 15000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'listar_modelos') {
    // Biblioteca de modelos de mensagem — só leitura (criar/editar é só no
    // site, admin). Usado pela seção "Mensagens" do painel.
    chamarJob('/api/whatsapp/extensao/modelos', 'GET', null, 15000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'cancelar') {
    const registro = _emAndamento.get(msg.reqId);
    if (registro) { registro.cancelado = true; registro.controller.abort(); }
    sendResponse({ ok: true });
    return false;
  }
  if (msg && msg.type === 'fila_proximo') {
    chamarJob('/api/whatsapp/fila/proximo?usuario_id=' + encodeURIComponent(msg.usuario_id || ''), 'GET', null, 15000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'fila_confirmar') {
    chamarJob('/api/whatsapp/fila/' + encodeURIComponent(msg.fila_id) + '/confirmar', 'POST',
      { ok: msg.ok, erro: msg.erro, wpp_msg_id: msg.wpp_msg_id }, 15000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'notificar') {
    // Aviso local do sistema operacional — só isso, nada é enviado pra fora.
    // Sem isso, minimizar o painel ou trocar de conversa fazia o consultor
    // perder o momento em que a análise terminava (tinha que ficar olhando).
    try {
      chrome.notifications.create('', {
        type: 'basic',
        iconUrl: 'icon128.png',
        title: msg.titulo || 'JOB Serenus',
        message: msg.mensagem || '',
      });
    } catch (e) { /* notificação é best-effort, nunca derruba a análise */ }
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
