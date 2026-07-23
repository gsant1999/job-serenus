// ─── JOB Serenus · Ponte MAIN world (áudio + documentos + envio) ────────────
//
//  Roda no CONTEXTO DA PÁGINA (world: MAIN), não no content script isolado —
//  porque a wa-js (window.WPP) vive no window da página. A própria extensão
//  injeta a lib (wa-js.vendor.js, carregado ANTES deste arquivo pelo
//  manifest.json — @wppconnect/wa-js oficial, vendorizado, sem depender de
//  extensão de terceiros como o WaSpeed).
//  O content.js (isolado) pede via postMessage: baixar áudio/documento (só
//  leitura, sem apertar play/abrir nada) e, a partir da Fase 1, mandar uma
//  mensagem de texto específica — SEMPRE originada de uma ação explícita do
//  consultor na fila do CRM, nunca em massa/automático por conta própria
//  desta ponte. Se o WPP não existir, responde com erro e a análise/envio
//  segue sem essa parte.
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

  // Remove mensagens repetidas pelo id (_serialized) — o getMessages devolve
  // itens duplicados quando o count pedido é maior que o total (busca no
  // servidor + cache). Vale pra texto, áudio e PDF.
  function _dedupPorId(itens) {
    const vistos = new Set();
    const out = [];
    for (const m of (itens || [])) {
      const mid = m && m.id && m.id._serialized;
      if (mid) { if (vistos.has(mid)) continue; vistos.add(mid); }
      out.push(m);
    }
    return out;
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
    const audios = _dedupPorId(msgs.filter((m) => m.type === 'ptt' || m.type === 'audio'));
    const alvos = selecionarPorLead(audios, Math.max(1, limite || 12));
    // Baixa em PARALELO (lotes de 5): o teto de áudios subiu bastante (conversas
    // de venda têm dezenas) e baixar um a um chegava perto do timeout. Cada
    // download é decrypt de rede — 5 de cada vez é rápido sem sobrecarregar.
    async function baixarUm(m) {
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
          return { de: (m.id.fromMe ? 'consultor' : 'lead'), msg_id: m.id._serialized,
                   base64: b64, mime: (mime || 'audio/ogg').split(';')[0], hora: fmtHora(m.t) };
        }
      } catch (e) { /* áudio que falhar é ignorado, nunca derruba a análise */ }
      return null;
    }
    const out = [];
    for (let i = 0; i < alvos.length; i += 5) {
      const lote = await Promise.all(alvos.slice(i, i + 5).map(baixarUm));
      for (const r of lote) if (r) out.push(r);
    }
    // encontrados = TOTAL de áudios na conversa (antes do teto), pra o painel
    // avisar "X de Y ficaram de fora" — nada de cortar em silêncio.
    return { audios: out, encontrados: audios.length };
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
    // O mime confiável mora em m.mediaData.mimetype (a wa-js nem sempre espelha
    // pro topo do modelo); confiar só em m.mimetype descartava o PDF em silêncio
    // (bug: CNH-e.pdf da Cintia nunca chegava ao Claude). Fallback pela extensão
    // do nome também, caso nenhum mime venha.
    const docs = _dedupPorId(msgs.filter((m) => {
      if (m.type !== 'document') return false;
      const mt = (m.mimetype || (m.mediaData && m.mediaData.mimetype) || '').toLowerCase();
      return mt === 'application/pdf' || /\.pdf$/i.test(m.filename || '');
    }));
    const alvos = selecionarPorLead(docs, Math.max(1, limite || 5));
    const out = [];
    for (const m of alvos) {
      try {
        // Retry 1x: o download da mídia falha esporadicamente (mídia ainda não
        // sincronizada) e antes o PDF sumia da análise em silêncio — conversa
        // com 2 PDFs chegava com 1 no Claude sem ninguém saber (caso 14/07).
        let media = null;
        for (let t = 0; t < 2 && !media; t++) {
          try { media = await window.WPP.chat.downloadMedia(m.id._serialized); }
          catch (e) { media = null; }
        }
        let b64 = '';
        if (media instanceof Blob) {
          b64 = await blobParaBase64(media);
        } else if (media && media.data) {
          const s = String(media.data);
          b64 = s.indexOf(',') >= 0 ? s.split(',')[1] : s;
        }
        if (b64) {
          // msg_id (igual áudio) — deixa o servidor reconhecer "esse PDF já foi
          // salvo antes" numa reanálise, em vez de gravar o mesmo arquivo de novo
          // a cada rodada (a extensão manda de novo tudo que ainda está na tela).
          out.push({ de: (m.id.fromMe ? 'consultor' : 'lead'), base64: b64,
                     nome: m.filename || 'documento.pdf', hora: fmtHora(m.t), msg_id: m.id._serialized });
        }
      } catch (e) { /* documento que falhar é ignorado, nunca derruba a análise */ }
    }
    // encontrados = TOTAL de PDFs na conversa (antes do teto). Se entraram
    // menos (teto OU falha de download), o painel avisa "X de Y" em vez de
    // fingir que leu tudo.
    return { documentos: out, encontrados: docs.length };
  }

  // Lê as MENSAGENS DE TEXTO direto da wa-js (Store), não do DOM. Antes o
  // content.js raspava o HTML da tela (frágil: quebra quando o WhatsApp muda o
  // layout, e só pegava o que tinha rolado). Aqui vem tudo da fonte — a mesma
  // que já usamos pra áudio/PDF (getMessages) — com texto, remetente e hora
  // confiáveis, sem rolar a tela. Inclui a legenda de mídia (caption), que é
  // texto que o cliente/corretor escreveu.
  async function lerMensagens(limite) {
    if (!window.WPP || !window.WPP.chat || !window.WPP.chat.getMessages) return { erro: 'wpp_ausente' };
    const chat = window.WPP.chat.getActiveChat && window.WPP.chat.getActiveChat();
    if (!chat || !chat.id) return { erro: 'sem_conversa' };
    const chatId = chat.id._serialized;
    let msgs = [];
    try { msgs = await window.WPP.chat.getMessages(chatId, { count: Math.max(50, limite || 500) }); }
    catch (e) { return { erro: 'falha_mensagens' }; }
    // DEDUP por id (_dedupPorId): pedir 'count' maior que o total faz o
    // getMessages buscar no servidor e devolver de novo mensagens que já
    // estavam no cache — vinham DUPLICADAS ("Perfeito, sem pressa." 2x).
    const out = [];
    for (const m of _dedupPorId(msgs)) {
      let texto = '';
      if (m.type === 'chat') texto = m.body || '';        // mensagem de texto
      else if (m.caption) texto = m.caption;              // legenda de imagem/vídeo/PDF
      texto = (texto || '').trim();
      if (!texto) continue;                                // pula mídia sem legenda, sistema, etc.
      out.push({ de: (m.id && m.id.fromMe ? 'consultor' : 'lead'), texto: texto.slice(0, 4000), hora: fmtHora(m.t) });
    }
    return { mensagens: out };
  }

  // Cache de resolução telefone por conversa. A escada @lid abaixo faz chamadas
  // de REDE (getPnLidEntry com fallback no servidor, requestPhoneNumber) e era
  // refeita do zero TODA vez que o consultor trocava de conversa — por isso o
  // "Verificando análise salva…" demorava. Aqui guarda o resultado por chatId:
  // número resolvido não muda (cache longo); negativa retenta rápido (o servidor
  // pode liberar o número depois). Guilherme, 19/07: "muito lento pra verificar".
  const _telCache = new Map(); // chave -> {res, ts}
  const _TEL_CACHE_POS_MS = 30 * 60 * 1000; // achou número: não muda
  const _TEL_CACHE_NEG_MS = 45 * 1000;      // não achou: retenta logo

  async function obterTelefone(resolverLid) {
    let chave = '';
    try {
      const WA = window.WPP;
      const chat = WA && WA.chat && WA.chat.getActiveChat && WA.chat.getActiveChat();
      if (chat && chat.id) {
        const id = chat.id._serialized || (chat.id.user + '@' + chat.id.server);
        chave = id + '|' + (resolverLid === false ? '0' : '1');
      }
    } catch (e) {}
    if (chave) {
      const c = _telCache.get(chave);
      if (c) {
        const ttl = (c.res && c.res.telefone) ? _TEL_CACHE_POS_MS : _TEL_CACHE_NEG_MS;
        if (Date.now() - c.ts < ttl) return c.res;
      }
    }
    const res = await _obterTelefoneResolver(resolverLid);
    // Não cacheia falha transitória de ambiente (wpp ainda carregando): retentar
    // logo pode dar certo. Número resolvido e "sem número exposto" (negativa
    // legítima) são cacheáveis.
    if (chave && res && res.erro !== 'wpp_ausente' && res.erro !== 'sem_conversa') {
      _telCache.set(chave, { res, ts: Date.now() });
    }
    return res;
  }

  async function _obterTelefoneResolver(resolverLid) {
    // resolverLid (flag remota do JOB, default true): quando false, NÃO tenta a
    // escada de resolução @lid (chega a chamar requestPhoneNumber, que às vezes
    // mexe na UI do WhatsApp). Serve de "freio de emergência" se um dia o
    // WhatsApp mudar e essa resolução passar a atrapalhar — desliga sem deploy.
    if (resolverLid === undefined) resolverLid = true;
    const WA = window.WPP;
    if (!WA || !WA.chat || !WA.chat.getActiveChat) return { erro: 'wpp_ausente' };
    const chat = WA.chat.getActiveChat();
    if (!chat || !chat.id) return { erro: 'sem_conversa' };
    const digits = (v) => (v ? String(v).replace(/\D/g, '') : '');
    const fromWid = (w) => w && (w.user || (w._serialized || '').split('@')[0]);
    const wid = chat.id;
    // Nome salvo, direto da wa-js (Store), NÃO do DOM — o WhatsApp muda a tela sem
    // avisar e quebra qualquer seletor CSS; isso aqui é o mesmo dado que alimenta a
    // tela, só que lido da fonte. Serve mesmo quando o número não é resolvível
    // (conta @lid) — o consultor ainda vê quem é e o CRM casa por nome.
    function nomeDoChat() {
      try {
        const c = chat.contact || (WA.whatsapp && WA.whatsapp.ContactStore && WA.whatsapp.ContactStore.get(wid));
        return (chat.name || chat.formattedTitle || (c && (c.name || c.pushname || c.shortName)) || '') + '';
      } catch (e) { return ''; }
    }
    // Contato normal (c.us): o número está no próprio JID.
    if (wid.server === 'c.us') {
      const n = digits(fromWid(wid));
      if (n) return { telefone: n, nome: nomeDoChat() };
    }
    // Freio de emergência remoto: se a resolução @lid estiver desligada, para
    // aqui e devolve só o nome (o CRM ainda casa por nome).
    if (!resolverLid) return { erro: 'lid_desligado', nome: nomeDoChat() };
    // @lid (business/privacidade): o número real NÃO está no cabeçalho/JID, mas a
    // wa-js tem o mapa interno lid->pn. Escada de resolução (achado do workflow).
    const cid = wid._serialized || (fromWid(wid) + '@' + wid.server);
    let nomeAchado = nomeDoChat();
    // 1) alto nível: cache + fallback no servidor (queryExists)
    try {
      if (WA.contact && WA.contact.getPnLidEntry) {
        const e = await WA.contact.getPnLidEntry(cid);
        if (e && e.contact) nomeAchado = nomeAchado || e.contact.pushname || e.contact.name || e.contact.shortName || '';
        const n = digits(fromWid(e && e.phoneNumber));
        if (n) return { telefone: n, nome: nomeAchado };
      }
    } catch (e) { /* tenta a próxima */ }
    // 2) cache síncrono lid->pn
    try {
      if (WA.whatsapp && WA.whatsapp.lidPnCache && WA.whatsapp.lidPnCache.getPhoneNumber) {
        const n = digits(fromWid(WA.whatsapp.lidPnCache.getPhoneNumber(wid)));
        if (n) return { telefone: n, nome: nomeAchado };
      }
    } catch (e) {}
    // 3) ContactModel (getPnForLid recebe o modelo, não o wid) + campo phoneNumber
    try {
      const cm = WA.whatsapp && WA.whatsapp.ContactStore && WA.whatsapp.ContactStore.get(wid);
      if (cm) {
        nomeAchado = nomeAchado || cm.pushname || cm.name || cm.shortName || '';
        try { const n = digits(fromWid(WA.whatsapp.functions.getPnForLid(cm))); if (n) return { telefone: n, nome: nomeAchado }; } catch (e) {}
        const n2 = digits(fromWid(cm.phoneNumber)); if (n2) return { telefone: n2, nome: nomeAchado };
      }
    } catch (e) {}
    // 4) função baixo nível (aceita lid wid)
    try {
      if (WA.whatsapp && WA.whatsapp.functions && WA.whatsapp.functions.getPhoneNumber) {
        const n = digits(fromWid(WA.whatsapp.functions.getPhoneNumber(wid)));
        if (n) return { telefone: n, nome: nomeAchado };
      }
    } catch (e) {}
    // 5) força o servidor a revelar e tenta de novo o passo 1 (pode falhar — o
    //    WhatsApp nem sempre libera; ainda assim tenta, é o caso legítimo de negócio
    //    respondendo quem te procurou)
    try {
      if (WA.chat.requestPhoneNumber) {
        await WA.chat.requestPhoneNumber(cid);
        const e = await WA.contact.getPnLidEntry(cid);
        if (e && e.contact) nomeAchado = nomeAchado || e.contact.pushname || e.contact.name || e.contact.shortName || '';
        const n = digits(fromWid(e && e.phoneNumber));
        if (n) return { telefone: n, nome: nomeAchado };
      }
    } catch (e) {}
    // Não achou o número de jeito nenhum — devolve pelo menos o nome (nunca deixa
    // o consultor/CRM completamente às cegas).
    return { erro: 'sem_numero_exposto', nome: nomeAchado };
  }

  // Número do PRÓPRIO WhatsApp logado nesta aba (o do consultor). Usado pelo
  // JOB pra atribuir o lead a quem está de fato conversando — o consultor do
  // popup é só fallback (é manual e vive esquecido/errado).
  async function obterMeuNumero() {
    if (!window.WPP || !window.WPP.conn || !window.WPP.conn.getMyUserId) {
      return { erro: 'wpp_ausente' };
    }
    try {
      const wid = window.WPP.conn.getMyUserId();
      const numero = wid && (wid.user || (wid._serialized || '').split('@')[0]);
      if (!numero) return { erro: 'sem_numero' };
      return { numero: String(numero) };
    } catch (e) {
      return { erro: 'falha' };
    }
  }

  // ── ID da conversa aberta AGORA (serializado). Funciona pra contato normal
  //    (c.us) E pra @lid (business/privacidade nova) — é o id interno que a
  //    wa-js aceita pra mandar, mesmo quando o telefone real não é exposto.
  //    É o jeito à prova de falha de mandar pra conversa que está na tela,
  //    sem depender de descobrir o número. ──
  async function obterChatIdAtivo() {
    if (!window.WPP || !window.WPP.chat || !window.WPP.chat.getActiveChat) {
      return { erro: 'wpp_ausente' };
    }
    const chat = window.WPP.chat.getActiveChat();
    if (!chat || !chat.id) return { erro: 'sem_conversa' };
    return { chat_id: chat.id._serialized || '' };
  }

  // ── ENVIO (Fase 1) — a ÚNICA função desta ponte que manda alguma coisa pro
  //    WhatsApp. Cada chamada é uma mensagem específica que o consultor pediu
  //    explicitamente pra mandar (via fila do CRM) — nunca em massa, nunca
  //    automático sem origem rastreável. wa-js manda direto pelo chatId, sem
  //    precisar abrir/navegar até a conversa na tela primeiro. ──
  async function enviarTexto(chatId, texto) {
    if (!window.WPP || !window.WPP.chat || !window.WPP.chat.sendTextMessage) {
      return { erro: 'wpp_ausente' };
    }
    if (!chatId || !texto) return { erro: 'parametros_invalidos' };
    try {
      const res = await window.WPP.chat.sendTextMessage(chatId, texto);
      const msgId = (res && res.id && res.id._serialized) || (res && res._serialized) || null;
      return { ok: true, wpp_msg_id: msgId };
    } catch (e) {
      return { ok: false, erro: String((e && e.message) || e).slice(0, 200) };
    }
  }

  // ── ENVIO DE MÍDIA (item A): recebe a mídia já em dataURL (o background
  //    baixou do JOB — a página não pode por causa do CSP do WhatsApp) e manda
  //    pela wa-js. Áudio vai como NOTA DE VOZ (isPtt) — igual "gravado na hora"
  //    do ZapVoice, não como arquivo. ──
  async function enviarMidia(chatId, tipo, dataUrl, legenda) {
    if (!window.WPP || !window.WPP.chat || !window.WPP.chat.sendFileMessage) {
      return { erro: 'wpp_ausente' };
    }
    if (!chatId || !dataUrl) return { erro: 'parametros_invalidos' };
    try {
      const opts = {};
      if (tipo === 'audio') { opts.type = 'audio'; opts.isPtt = true; }
      else if (tipo === 'imagem') { opts.type = 'image'; if (legenda) opts.caption = legenda; }
      else if (tipo === 'video') { opts.type = 'video'; if (legenda) opts.caption = legenda; }
      else { opts.type = 'document'; opts.filename = 'documento'; }
      const res = await window.WPP.chat.sendFileMessage(chatId, dataUrl, opts);
      const msgId = (res && res.id && res.id._serialized) || (res && res._serialized) || null;
      return { ok: true, wpp_msg_id: msgId };
    } catch (e) {
      return { ok: false, erro: String((e && e.message) || e).slice(0, 200) };
    }
  }

  // ── APAGAR CONVERSA (Fase 2): quando o consultor decide limpar um contato que
  //    não respondeu à campanha. Irreversível no WhatsApp — só é chamado por ação
  //    explícita do consultor (botão), nunca automático. ──
  async function apagarConversa(chatId) {
    if (!window.WPP || !window.WPP.chat || !window.WPP.chat.delete) return { erro: 'wpp_ausente' };
    if (!chatId) return { erro: 'parametros_invalidos' };
    try {
      const r = await window.WPP.chat.delete(chatId);
      return { ok: true, status: (r && r.status) || 200 };
    } catch (e) {
      return { ok: false, erro: String((e && e.message) || e).slice(0, 200) };
    }
  }

  // ── INBOUND (Fase 2): escuta mensagens RECEBIDAS e avisa o content script.
  //    Repassa SÓ o chatId (nunca o conteúdo) — o content script decide se é um
  //    número de campanha em vigília antes de reportar ao JOB. Registra UMA vez,
  //    quando a wa-js fica pronta (pode não estar no load). ──
  let _jobInboundLigado = false;
  function ligarInbound() {
    if (_jobInboundLigado || !window.WPP || !window.WPP.on) return;
    try {
      window.WPP.on('chat.new_message', (msg) => {
        try {
          if (!msg || !msg.id || msg.id.fromMe) return;   // só o que ENTROU (do contato)
          const chatId = (msg.id.remote && msg.id.remote._serialized)
            || (msg.from && msg.from._serialized) || '';
          if (chatId) window.postMessage({ source: 'JOB_EXT_EVT', tipo: 'inbound', chatId }, '*');
        } catch (e) { /* nunca derruba a wa-js */ }
      });
      _jobInboundLigado = true;
    } catch (e) { /* tenta de novo no timer */ }
  }
  ligarInbound();
  const _jobInboundTimer = setInterval(() => {
    ligarInbound();
    if (_jobInboundLigado) clearInterval(_jobInboundTimer);
  }, 3000);

  // ── Checa por LEITURA se um chat já teve resposta do contato (fallback do evento
  //    chat.new_message, que nem sempre dispara). Lê as últimas msgs e vê se a mais
  //    recente NÃO é nossa (fromMe===false) = o contato respondeu. Mais confiável. ──
  async function checarInbound(chatId) {
    if (!window.WPP || !window.WPP.chat || !window.WPP.chat.getMessages) return { inbound: false };
    try {
      const msgs = await window.WPP.chat.getMessages(chatId, { count: 12 });
      if (!msgs || !msgs.length) return { inbound: false };
      let nossas = 0;
      for (const m of msgs) { if (m && m.id && m.id.fromMe) nossas++; }
      const ult = msgs[msgs.length - 1];
      const ultimaDoContato = !!(ult && ult.id && ult.id.fromMe === false);
      // Só conta como "respondeu p/ disparar o funil" se: a última mensagem é do
      // CONTATO **e** a gente só mandou UMA vez (a saudação). Se houver 2+ nossas,
      // um humano já respondeu (mesmo pelo celular) — NÃO dispara o funil.
      return { inbound: !!(ultimaDoContato && nossas <= 1) };
    } catch (e) { return { inbound: false }; }
  }

  window.addEventListener('message', async (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== 'JOB_EXT_REQ') return;
    let resp;
    try {
      if (d.tipo === 'baixar_audios') resp = await baixarAudios(d.limite);
      else if (d.tipo === 'baixar_documentos') resp = await baixarDocumentos(d.limite);
      else if (d.tipo === 'ler_mensagens') resp = await lerMensagens(d.limite);
      else if (d.tipo === 'obter_telefone') resp = await obterTelefone(d.resolverLid);
      else if (d.tipo === 'obter_meu_numero') resp = await obterMeuNumero();
      else if (d.tipo === 'obter_chat_id') resp = await obterChatIdAtivo();
      else if (d.tipo === 'enviar_texto') resp = await enviarTexto(d.chatId, d.texto);
      else if (d.tipo === 'enviar_midia') resp = await enviarMidia(d.chatId, d.midiaTipo, d.dataUrl, d.legenda);
      else if (d.tipo === 'apagar_conversa') resp = await apagarConversa(d.chatId);
      else if (d.tipo === 'checar_inbound') resp = await checarInbound(d.chatId);
      else return;
    } catch (e) { resp = { erro: 'excecao' }; }
    resp.source = 'JOB_EXT_RESP';
    resp.reqId = d.reqId;
    window.postMessage(resp, '*');
  });
})();
