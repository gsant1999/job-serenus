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

// reqId -> payload sendo montado em lotes (analisar_iniciar/_parte/_executar).
// O content script manda a base + as mídias em pedaços pequenos pra NUNCA
// trafegar um bloco gigante (que matava o service worker); aqui a gente acumula
// e só dispara o fetch no _executar. Some ao executar/cancelar; TTL de faxina
// pra não vazar se a aba morrer no meio.
const _partesAnalise = new Map();
function _faxinaPartes() {
  const agora = Date.now();
  for (const [k, v] of _partesAnalise) {
    if (agora - (v._ts || 0) > 10 * 60 * 1000) _partesAnalise.delete(k);
  }
}

// Esperas entre as tentativas quando a rede falha. O JOB roda no Railway, que
// REINICIA a cada deploy — nessa janela o fetch morre com "Failed to fetch" e,
// sem repetir, o consultor levava um erro vermelho na cara por um soluço de
// segundos ("isso é sempre um problema" — Guilherme, 27/07). Duas tentativas
// extras cobrem o soluço; queda longa cai na mensagem explicativa do fim.
const _RETRY_ESPERAS = [800, 2500];

async function chamarJob(caminho, metodo, corpo, timeoutMs, reqId, opts) {
  const { jobUrl, extKey } = await config();
  if (!extKey) {
    return { ok: false, erro: 'Configure a chave da extensão no popup (clique no ícone do JOB).' };
  }
  // Sem isso, se o servidor travasse (não desse erro, só não respondesse), o
  // painel ficava preso em "Calculando o score…" pra sempre, sem forma de
  // recuperar sem recarregar a aba. AbortController garante que SEMPRE
  // resolve dentro do prazo, erro claro em vez de promise pendurada.
  const limite = timeoutMs || 15000;
  // Repetir só é seguro quando a chamada não cria coisa nova: GET sempre; POST
  // apenas onde o servidor deduplica (marcar com {repetivel:true}). Repetir um
  // POST de enviar mensagem ou criar nota mandaria/gravaria DUAS vezes.
  const podeRepetir = !!(opts && opts.repetivel) || String(metodo || '').toUpperCase() === 'GET';
  const maxTentativas = podeRepetir ? _RETRY_ESPERAS.length + 1 : 1;
  for (let t = 0; t < maxTentativas; t++) {
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
        // Erro HTTP É uma resposta do servidor (chave errada, 404, 500) —
        // repetir não muda nada, então devolve na hora.
        return { ok: false, erro: (dados && dados.erro) || ('HTTP ' + resp.status), status: resp.status };
      }
      return dados || { ok: true };
    } catch (e) {
      // Timeout/cancelamento não é soluço de rede: não repete.
      if (e.name === 'AbortError') {
        clearTimeout(timer);
        if (reqId) _emAndamento.delete(reqId);
        return { ok: false, erro: (registro && registro.cancelado)
          ? 'Análise cancelada.'
          : 'O JOB demorou mais que ' + Math.round(limite / 1000) + 's pra responder — tente de novo.' };
      }
      // Falha de rede: se ainda há tentativa, espera e tenta de novo.
    } finally {
      clearTimeout(timer);
      if (reqId) _emAndamento.delete(reqId);
    }
    if (t < maxTentativas - 1) {
      await new Promise((r) => setTimeout(r, _RETRY_ESPERAS[t]));
    }
  }
  return { ok: false, erro: 'O JOB não respondeu. Se o sistema acabou de ser atualizado, isso passa em cerca de 1 minuto — tente de novo.' };
}

// Cria um modelo com upload de mídia (multipart) — não passa por chamarJob
// (que é JSON). O content script manda o arquivo como base64 (Blob não
// atravessa chrome.runtime.sendMessage); aqui remonta num Blob e posta como
// FormData. O envio precisa acontecer AQUI (o content script não consegue
// fetch pro JOB por causa do CSP do WhatsApp Web).
async function criarModelo(dados) {
  const { jobUrl, extKey } = await config();
  if (!extKey) return { ok: false, erro: 'Configure a chave da extensão no popup.' };
  try {
    const fd = new FormData();
    fd.append('nome', dados.nome || '');
    fd.append('texto', dados.texto || '');
    if (dados.usuario_id) fd.append('usuario_id', dados.usuario_id);
    if (dados.midia_base64 && dados.midia_nome) {
      const bin = atob(dados.midia_base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: dados.midia_mime || 'application/octet-stream' });
      fd.append('arquivo_midia', blob, dados.midia_nome);
    }
    const resp = await fetch(jobUrl + '/api/whatsapp/extensao/modelos/novo', {
      method: 'POST', headers: { 'X-Extension-Key': extKey }, body: fd,
    });
    const d = await resp.json().catch(() => null);
    if (!resp.ok) return { ok: false, erro: (d && d.erro) || ('HTTP ' + resp.status) };
    return d || { ok: true };
  } catch (e) {
    return { ok: false, erro: 'Falha ao salvar modelo: ' + e.message };
  }
}

// Baixa a mídia de um modelo (URL do JOB) e devolve dataURL base64. O content
// script/página não consegue por causa do CSP do WhatsApp Web; o background
// tem host_permissions pro domínio do JOB.
async function baixarMidiaDataUrl(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return { ok: false, erro: 'HTTP ' + resp.status };
    const blob = await resp.blob();
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onloadend = () => res(String(r.result));
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
    return { ok: true, dataUrl };
  } catch (e) {
    return { ok: false, erro: 'Falha ao baixar mídia: ' + e.message };
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
  // ── Análise em LOTES (não estoura o service worker em conversa pesada) ──
  if (msg && msg.type === 'analisar_iniciar') {
    _faxinaPartes();
    const base = msg.base || {};
    _partesAnalise.set(msg.reqId, {
      _ts: Date.now(),
      telefone: base.telefone, nome: base.nome,
      mensagens: base.mensagens || [], links: base.links || [],
      usuario_id: base.usuario_id || null, whatsapp_consultor: base.whatsapp_consultor || null,
      documentos_encontrados: base.documentos_encontrados || 0,
      audios_encontrados: base.audios_encontrados || 0,
      imagens_encontrados: base.imagens_encontrados || 0,
      audios: [], imagens: [], documentos: [],
    });
    sendResponse({ ok: true });
    return true;
  }
  if (msg && msg.type === 'analisar_parte') {
    const acc = _partesAnalise.get(msg.reqId);
    if (!acc) { sendResponse({ ok: false, erro: 'Sessão de análise expirou — tente de novo.' }); return true; }
    const alvo = acc[msg.tipo];
    if (Array.isArray(alvo) && Array.isArray(msg.itens)) { for (const it of msg.itens) alvo.push(it); acc._ts = Date.now(); }
    sendResponse({ ok: true });
    return true;
  }
  if (msg && msg.type === 'analisar_executar') {
    const acc = _partesAnalise.get(msg.reqId);
    if (!acc) { sendResponse({ ok: false, erro: 'Sessão de análise expirou — tente de novo.' }); return true; }
    _partesAnalise.delete(msg.reqId); // libera a memória do SW antes do fetch
    const { _ts, ...payload } = acc;
    chamarJob('/api/whatsapp/analisar', 'POST', payload, 300000, msg.reqId).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'enviar_direto') {
    // Compor e mandar direto do painel da extensão, sem precisar abrir o
    // site do JOB — enfileira e casa/cria o lead pelo telefone da conversa.
    chamarJob('/api/whatsapp/enviar-direto', 'POST', msg.payload, 15000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'listar_modelos') {
    // Manda o consultor escolhido no popup: o JOB devolve só a biblioteca DELE
    // (+ itens sem dono, material da corretora) — cada um vê a própria voz.
    chrome.storage.local.get(['usuarioId']).then(({ usuarioId }) =>
      chamarJob('/api/whatsapp/extensao/modelos' +
        (usuarioId ? '?usuario_id=' + encodeURIComponent(usuarioId) : ''), 'GET', null, 15000)
    ).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'listar_funis') {
    chrome.storage.local.get(['usuarioId']).then(({ usuarioId }) =>
      chamarJob('/api/whatsapp/extensao/funis' +
        (usuarioId ? '?usuario_id=' + encodeURIComponent(usuarioId) : ''), 'GET', null, 15000)
    ).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'funil_disparado') {
    // Só registra que o funil foi tocado (contador + timeline do lead) — o
    // envio de cada passo já aconteceu client-side pela ponte wa-js. Manda
    // usuario_id pra o servidor fechar a execução ao vivo do painel.
    chamarJob('/api/whatsapp/extensao/funis/' + encodeURIComponent(msg.funil_id) + '/disparado', 'POST',
      { telefone: msg.telefone || '', enviados: msg.enviados || 0, usuario_id: msg.usuario_id, job_uid: msg.job_uid }, 15000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'funil_progresso') {
    chamarJob('/api/whatsapp/funil/progresso', 'POST', {
      usuario_id: msg.usuario_id, job_uid: msg.job_uid, funil_id: msg.funil_id, funil_nome: msg.funil_nome,
      nome: msg.nome, telefone: msg.telefone, passo_atual: msg.passo_atual,
      total_passos: msg.total_passos, segundos_restantes: msg.segundos_restantes, status: msg.status,
    }, 10000).then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg && msg.type === 'criar_modelo') {
    criarModelo(msg.dados).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'excluir_modelo') {
    chamarJob('/api/whatsapp/extensao/modelos/' + encodeURIComponent(msg.id) + '/excluir', 'POST', {}, 15000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'favorito_modelo') {
    chamarJob('/api/whatsapp/extensao/modelos/' + encodeURIComponent(msg.id) + '/favorito', 'POST', {}, 15000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'baixar_midia') {
    // Baixa a mídia do JOB e devolve como dataURL — só o background pode
    // (host_permissions); a página do WhatsApp bloqueia fetch externo (CSP).
    baixarMidiaDataUrl(msg.url).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'cancelar') {
    const registro = _emAndamento.get(msg.reqId);
    if (registro) { registro.cancelado = true; registro.controller.abort(); }
    _partesAnalise.delete(msg.reqId); // descarta lotes acumulados que não viraram fetch
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
  if (msg && msg.type === 'campanha_aguardando') {
    chamarJob('/api/whatsapp/campanha/aguardando?usuario_id=' + encodeURIComponent(msg.usuario_id || ''), 'GET', null, 15000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'campanha_resposta') {
    chamarJob('/api/whatsapp/campanha/resposta', 'POST',
      { telefone: msg.telefone, usuario_id: msg.usuario_id }, 15000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'campanha_excluir') {
    chamarJob('/api/whatsapp/campanha/excluir-conversa', 'POST',
      { contato_id: msg.contato_id, telefone: msg.telefone, usuario_id: msg.usuario_id }, 15000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'chat_lead') {
    chamarJob('/api/whatsapp/chat-lead?chat_id=' + encodeURIComponent(msg.chat_id || ''), 'GET', null, 10000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'consultar_cnpj') {
    const dig = String(msg.cnpj || '').replace(/\D/g, '');
    chamarJob('/api/whatsapp/cnpj/' + encodeURIComponent(dig), 'GET', null, 20000).then(sendResponse);
    return true;
  }
  // Ficha completa do lead: UMA chamada traz lead, etapas, sub-status, campos,
  // etiquetas e atividades. Timeout maior que os 10s dos outros porque é o
  // agregado — mas ainda assim uma ida só, pro painel não montar aos pedaços.
  // Transcrição inline: consulta de cache é barata e frequente; a transcrição em
  // si sobe áudio, então tem timeout bem maior.
  if (msg && msg.type === 'transcricoes_cache') {
    chamarJob('/api/whatsapp/transcricoes', 'POST', { ids: msg.ids || [] }, 15000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'transcrever_audios') {
    chamarJob('/api/whatsapp/transcrever', 'POST', { audios: msg.audios || [] }, 120000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'ficha_lead') {
    const q = msg.lead_id ? ('lead_id=' + encodeURIComponent(msg.lead_id))
                          : ('telefone=' + encodeURIComponent(msg.telefone || ''));
    chamarJob('/api/whatsapp/lead/ficha?' + q, 'GET', null, 15000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'ficha_salvar') {
    // repetivel:false — é escrita; repetir cegamente poderia duplicar atividade.
    chamarJob('/api/whatsapp/lead/salvar', 'POST', msg.dados || {}, 20000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'notas_listar') {
    chamarJob('/api/whatsapp/notas?telefone=' + encodeURIComponent(msg.telefone || ''), 'GET', null, 10000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'notas_criar') {
    chamarJob('/api/whatsapp/notas', 'POST',
      { telefone: msg.telefone, texto: msg.texto, usuario_id: msg.usuario_id }, 10000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'notas_excluir') {
    chamarJob('/api/whatsapp/notas/excluir', 'POST', { id: msg.id }, 10000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'lead_por_telefone') {
    chamarJob('/api/whatsapp/lead-por-telefone?telefone=' + encodeURIComponent(msg.telefone || ''), 'GET', null, 10000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'lead_criar') {
    chamarJob('/api/whatsapp/lead/criar', 'POST', {
      nome: msg.nome, telefone: msg.telefone, origem: msg.origem,
      email: msg.email, empresa: msg.empresa, observacoes: msg.observacoes,
      usuario_id: msg.usuario_id,
      // repetivel: o servidor deduplica por telefone (_buscar_lead_por_telefone),
      // então repetir por soluço de rede devolve o lead existente, não duplica.
    }, 15000, null, { repetivel: true }).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'presenca') {
    chamarJob('/api/whatsapp/presenca', 'POST',
      { usuario_id: msg.usuario_id, versao: msg.versao, numero: msg.numero, wpp_ok: msg.wpp_ok },
      10000, null, { repetivel: true }).then(sendResponse);   // só atualiza estado, repetir é inócuo
    return true;
  }
  if (msg && msg.type === 'inbox') {
    chamarJob('/api/whatsapp/inbox?usuario_id=' + encodeURIComponent(msg.usuario_id || ''), 'GET', null, 12000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'inbox_atender') {
    chamarJob('/api/whatsapp/inbox/atender', 'POST', { lead_id: msg.lead_id, usuario_id: msg.usuario_id }, 12000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'forcar_update') {
    // Só funciona de verdade em extensão instalada pela Chrome Web Store
    // (tem update_url apontando pra Google). Em cópia "Carregar sem
    // compactação" (modo desenvolvedor) o Chrome NUNCA autoatualiza sozinho —
    // não existe alternativa segura a isso; qualquer "baixa e substitui
    // sozinho" seria a extensão reescrevendo a si mesma, e o Chrome bloqueia
    // isso de propósito (segurança, evita extensão virar malware depois de
    // instalada). O botão força o Chrome a CONSULTAR a Store agora em vez de
    // esperar o timer periódico dele — é o máximo que dá pra apressar.
    try {
      chrome.runtime.requestUpdateCheck((status, details) => {
        sendResponse({ ok: true, status, versaoNova: details && details.version });
      });
    } catch (e) { sendResponse({ ok: false, erro: String(e && e.message || e) }); }
    return true;
  }
  if (msg && msg.type === 'erro_log') {
    // Best-effort — nunca deve travar nada nem virar loop de erro.
    chamarJob('/api/whatsapp/erro', 'POST', {
      usuario_id: msg.usuario_id, versao: msg.versao, mensagem: msg.mensagem,
      stack: msg.stack, url: msg.url,
    }, 8000).then(sendResponse).catch(() => sendResponse({ ok: false }));
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
        title: msg.titulo || 'JOB',
        message: msg.mensagem || '',
      });
    } catch (e) { /* notificação é best-effort, nunca derruba a análise */ }
    sendResponse({ ok: true });
    return false;
  }
  return false;
});

// Erros dentro do próprio service worker (não passam por chrome.runtime.sendMessage
// porque ele não manda mensagem pra si mesmo) — reporta direto.
self.addEventListener('error', (e) => {
  chamarJob('/api/whatsapp/erro', 'POST', {
    mensagem: 'background.js: ' + String(e.message || e), stack: String(e.error && e.error.stack || ''),
    url: 'background.js', versao: chrome.runtime.getManifest().version,
  }, 8000).catch(() => {});
});
self.addEventListener('unhandledrejection', (e) => {
  chamarJob('/api/whatsapp/erro', 'POST', {
    mensagem: 'background.js (promise): ' + String(e.reason && e.reason.message || e.reason),
    stack: String(e.reason && e.reason.stack || ''), url: 'background.js',
    versao: chrome.runtime.getManifest().version,
  }, 8000).catch(() => {});
});
