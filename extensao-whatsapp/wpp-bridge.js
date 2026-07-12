// ─── JOB Serenus · Ponte MAIN world (áudio + documentos) ────────────────────
//
//  Roda no CONTEXTO DA PÁGINA (world: MAIN), não no content script isolado —
//  porque a wa-js (window.WPP) vive no window da página. A própria extensão
//  injeta a lib (wa-js.vendor.js, carregado ANTES deste arquivo pelo
//  manifest.json — @wppconnect/wa-js oficial, vendorizado, sem depender de
//  extensão de terceiros como o WaSpeed).
//  O content.js (isolado) pede os áudios/documentos via postMessage; esta
//  ponte baixa e devolve. Só LEITURA: baixa a mídia que o usuário já vê na
//  conversa, sem apertar play/abrir nada, e NUNCA envia nada. Se o WPP não
//  existir, responde com erro e a análise segue sem esse anexo.
//
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';
  if (window.__jobWppBridge) return;
  window.__jobWppBridge = true;

  async function blobParaBase64(blob) {
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    const CH = 0x8000; // fatia pra não estourar o argumento do fromCharCode
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin);
  }

  function fmtHora(t) {
    try {
      const d = new Date((t || 0) * 1000);
      const p = (n) => String(n).padStart(2, '0');
      return p(d.getHours()) + ':' + p(d.getMinutes()) + ', ' +
             d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
    } catch (e) { return ''; }
  }

  function selecionarPorLead(itens, limite) {
    // Prioriza os itens do LEAD (áudio ou documento) — é o conteúdo do cliente
    // que importa pra qualificação e pro score, não pode ficar de fora só
    // porque o consultor mandou vários itens recentes por cima. Enche o resto
    // do teto (se sobrar espaço) com os itens do consultor, mais recentes primeiro.
    const doLead = itens.filter((m) => !(m.id && m.id.fromMe));
    const doConsultor = itens.filter((m) => m.id && m.id.fromMe);
    const leadRecentes = doLead.slice(-limite);
    const espacoConsultor = Math.max(0, limite - leadRecentes.length);
    const consultorRecentes = espacoConsultor ? doConsultor.slice(-espacoConsultor) : [];
    return [...leadRecentes, ...consultorRecentes].sort((a, b) => (a.t || 0) - (b.t || 0));
  }

  async function baixarAudios(limite) {
    if (!window.WPP || !window.WPP.chat || !window.WPP.chat.downloadMedia) {
      return { erro: 'wpp_ausente' };
    }
    const chat = window.WPP.chat.getActiveChat && window.WPP.chat.getActiveChat();
    if (!chat || !chat.id) return { erro: 'sem_conversa' };
    const chatId = chat.id._serialized;
    let msgs = [];
    try { msgs = await window.WPP.chat.getMessages(chatId, { count: 200 }); }
    catch (e) { return { erro: 'falha_mensagens' }; }
    // NÃO filtra por marca d'água (já tentamos — bug real: um áudio que ficou
    // de fora do teto numa rodada anterior, ou que não foi transcrito porque a
    // chave não estava configurada na hora, ficava escondido PRA SEMPRE, sem
    // aviso nenhum. Prioridade é nunca perder áudio de verdade — sempre manda
    // todos; manda também o id da mensagem (msg_id) pra o servidor poder
    // reaproveitar uma transcrição já feita antes pro MESMO áudio em vez de
    // pagar de novo — isso é diferente da marca d'água (nunca deixa de mandar
    // um áudio, só evita re-transcrever um que já foi transcrito com sucesso).
    const audios = msgs.filter((m) => m.type === 'ptt' || m.type === 'audio');
    const alvos = selecionarPorLead(audios, Math.max(1, limite || 12));
    const out = [];
    for (const m of alvos) {
      try {
        const media = await window.WPP.chat.downloadMedia(m.id._serialized);
        let b64 = '', mime = 'audio/ogg';
        if (media instanceof Blob) {
          b64 = await blobParaBase64(media);
          mime = media.type || mime;
        } else if (media && media.data) {
          const s = String(media.data);
          b64 = s.indexOf(',') >= 0 ? s.split(',')[1] : s;
          mime = media.mimetype || mime;
        }
        if (b64) {
          out.push({ de: (m.id.fromMe ? 'consultor' : 'lead'), msg_id: m.id._serialized,
                     base64: b64, mime: (mime || 'audio/ogg').split(';')[0], hora: fmtHora(m.t) });
        }
      } catch (e) { /* áudio que falhar é ignorado, nunca derruba a análise */ }
    }
    return { audios: out };
  }

  async function baixarDocumentos(limite) {
    if (!window.WPP || !window.WPP.chat || !window.WPP.chat.downloadMedia) {
      return { erro: 'wpp_ausente' };
    }
    const chat = window.WPP.chat.getActiveChat && window.WPP.chat.getActiveChat();
    if (!chat || !chat.id) return { erro: 'sem_conversa' };
    const chatId = chat.id._serialized;
    let msgs = [];
    try { msgs = await window.WPP.chat.getMessages(chatId, { count: 200 }); }
    catch (e) { return { erro: 'falha_mensagens' }; }
    // Só PDF — é o único formato de documento que a Claude lê nativamente.
    // Sem filtro por marca d'água — mesmo motivo do áudio (ver baixarAudios).
    const docs = msgs.filter((m) => m.type === 'document' &&
      (m.mimetype || '').toLowerCase() === 'application/pdf');
    const alvos = selecionarPorLead(docs, Math.max(1, limite || 5));
    const out = [];
    for (const m of alvos) {
      try {
        const media = await window.WPP.chat.downloadMedia(m.id._serialized);
        let b64 = '';
        if (media instanceof Blob) {
          b64 = await blobParaBase64(media);
        } else if (media && media.data) {
          const s = String(media.data);
          b64 = s.indexOf(',') >= 0 ? s.split(',')[1] : s;
        }
        if (b64) {
          out.push({ de: (m.id.fromMe ? 'consultor' : 'lead'), base64: b64,
                     nome: m.filename || 'documento.pdf', hora: fmtHora(m.t) });
        }
      } catch (e) { /* documento que falhar é ignorado, nunca derruba a análise */ }
    }
    return { documentos: out };
  }

  async function obterTelefone() {
    if (!window.WPP || !window.WPP.chat || !window.WPP.chat.getActiveChat) {
      return { erro: 'wpp_ausente' };
    }
    const chat = window.WPP.chat.getActiveChat();
    if (!chat || !chat.id) return { erro: 'sem_conversa' };
    // O JID só carrega o número de telefone de verdade pra contato "normal"
    // (server === 'c.us'). Contas business/privacidade nova usam @lid — um ID
    // interno que NÃO é o telefone; nesses casos o WhatsApp não expõe o
    // número real em lugar nenhum do cliente, então respondemos sem_numero e
    // o content.js cai pro método antigo (nome do cabeçalho/DOM).
    const server = chat.id.server || '';
    if (server !== 'c.us') return { erro: 'sem_numero_exposto' };
    const numero = chat.id.user || (chat.id._serialized || '').split('@')[0];
    if (!numero) return { erro: 'sem_numero_exposto' };
    return { telefone: numero };
  }

  window.addEventListener('message', async (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== 'JOB_EXT_REQ') return;
    let resp;
    try {
      if (d.tipo === 'baixar_audios') resp = await baixarAudios(d.limite);
      else if (d.tipo === 'baixar_documentos') resp = await baixarDocumentos(d.limite);
      else if (d.tipo === 'obter_telefone') resp = await obterTelefone();
      else return;
    } catch (e) { resp = { erro: 'excecao' }; }
    resp.source = 'JOB_EXT_RESP';
    resp.reqId = d.reqId;
    window.postMessage(resp, '*');
  });
})();
