// ─── JOB Serenus · Content Script (WhatsApp Web) ────────────────────────────
//
//  ⚠️  GARANTIA DE SEGURANÇA — LEIA ANTES DE MEXER:
//  A leitura (análise de lead) continua 100% leitura: lê a conversa que JÁ
//  ESTÁ na tela, rola o histórico devagar como um humano, nunca digita no
//  campo de mensagem nem clica em "enviar" por conta própria.
//  A partir da Fase 1, existe TAMBÉM um envio — mas só de mensagens que o
//  consultor colocou explicitamente na fila pelo CRM (nunca decidido aqui, e
//  esse arquivo não tem NENHUMA lógica de "quando"/"o quê" mandar, só busca o
//  que já foi aprovado). Ritmo limitado no servidor (não aqui), nunca envia
//  em massa. Ao adicionar qualquer coisa nova de envio, sempre com origem
//  rastreável — nunca automático "por conta própria" da extensão.
//
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';
  if (window.__jobSerenusCarregado) return;
  window.__jobSerenusCarregado = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Base do site do JOB — pro link "Gerenciar funis no site". Padrão é produção;
  // se o popup configurou outra URL (jobUrl), hidrata daqui pra respeitar.
  let _SITE_BASE_URL_EXT = 'https://job-serenus-production.up.railway.app';
  try {
    chrome.storage.local.get(['jobUrl']).then((c) => {
      if (c && c.jobUrl) _SITE_BASE_URL_EXT = String(c.jobUrl).replace(/\/+$/, '');
    });
  } catch (e) { /* mantém o padrão de produção */ }

  // ── Descobre o container rolável das mensagens (o WhatsApp muda as classes,
  //    então detectamos pelo comportamento: dentro do #main, o elemento que
  //    realmente rola verticalmente). ──
  function acharPainelRolavel() {
    const main = document.querySelector('#main') || document.body;
    const candidatos = main.querySelectorAll('div');
    let melhor = null, melhorAltura = 0;
    for (const el of candidatos) {
      const st = getComputedStyle(el);
      if ((st.overflowY === 'auto' || st.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 40) {
        if (el.scrollHeight > melhorAltura) { melhor = el; melhorAltura = el.scrollHeight; }
      }
    }
    return melhor;
  }

  // ── Nome do contato/conversa aberta (do cabeçalho). ──
  function nomeDoContato() {
    const header = document.querySelector('#main header');
    if (!header) return '';
    const comTitle = header.querySelector('span[dir="auto"][title]');
    if (comTitle && comTitle.getAttribute('title')) return comTitle.getAttribute('title').trim();
    const span = header.querySelector('span[dir="auto"]');
    return span ? (span.textContent || '').trim() : '';
  }

  // ── Telefone do contato. O WhatsApp Web novo NÃO expõe mais o JID no data-id
  //    das mensagens, então: (1) se o "nome" da conversa é um telefone (lead frio
  //    não salvo — o caso mais comum aqui), extrai os dígitos; (2) fallback:
  //    procura um JID no DOM pra versões antigas. Se não achar, o JOB casa por
  //    nome. Nunca abre a ficha do contato — só lê o que está na tela. ──
  function telefoneDoContato() {
    const nome = nomeDoContato();
    if (/^[+\d\s()\-]+$/.test(nome || '')) {
      const dig = (nome || '').replace(/\D/g, '');
      if (dig.length >= 10 && dig.length <= 15) return dig;
    }
    for (const el of document.querySelectorAll('#main [data-id]')) {
      const id = el.getAttribute('data-id') || '';
      const m = id.match(/(\d{10,15})@[cs]/);
      if (m) return m[1];
    }
    return '';
  }

  // ── Centro horizontal do painel de conversa (pra decidir direção por posição). ──
  function centroDoPainel() {
    const main = document.querySelector('#main');
    if (!main) return null;
    const r = main.getBoundingClientRect();
    return r.left + r.width / 2;
  }

  // ── Direção da mensagem por GEOMETRIA: bolha à direita = enviada por mim
  //    (consultor), à esquerda = recebida (lead). É o sinal mais à prova de
  //    mudança de layout (validado no DOM real: bate 100% com o remetente do
  //    data-pre-plain-text). Fallback: compara o remetente com o nome do contato. ──
  function direcaoDaMensagem(cp, centro, nomeContato) {
    const r = cp.getBoundingClientRect();
    if (centro != null && r.width > 0) {
      return (r.left + r.width / 2) < centro ? 'lead' : 'consultor';
    }
    const pre = cp.getAttribute('data-pre-plain-text') || '';
    const rem = ((pre.match(/\]\s*([^:]+):/) || [])[1] || '').trim();
    if (rem && nomeContato && rem === nomeContato.trim()) return 'lead';
    return rem ? 'consultor' : 'lead';
  }

  // ── Raspa todas as mensagens de texto atualmente no DOM, em ordem. ──
  //    Âncora estável: .copyable-text com data-pre-plain-text="[HH:MM, DD/MM/AAAA] Nome: ".
  function rasparMensagensVisiveis() {
    const nodes = document.querySelectorAll('#main .copyable-text[data-pre-plain-text]');
    const centro = centroDoPainel();
    const nomeContato = nomeDoContato();
    const msgs = [];
    for (const cp of nodes) {
      const pre = cp.getAttribute('data-pre-plain-text') || '';
      const mh = pre.match(/\[([^\]]+)\]/);
      const hora = mh ? mh[1] : '';
      const alvo = cp.querySelector('span.selectable-text') || cp.querySelector('.selectable-text') || cp;
      let texto = (alvo.innerText || alvo.textContent || '').trim();
      if (!texto) continue;
      msgs.push({ de: direcaoDaMensagem(cp, centro, nomeContato), texto, hora });
    }
    return msgs;
  }

  // ── LINKS: a URL crua já vem junto do texto normal da mensagem (rasparMensagensVisiveis
  //    já pega isso). O que falta é a PRÉVIA que o WhatsApp desenha (título + domínio) —
  //    fica num bloco irmão fora do balão de texto. Só leitura do que já está renderizado
  //    na tela; nunca abre nem busca o link. ──
  function rasparLinks() {
    const nodes = document.querySelectorAll('#main .copyable-text[data-pre-plain-text]');
    const centro = centroDoPainel();
    const nomeContato = nomeDoContato();
    const vistos = new Set();
    const out = [];
    for (const cp of nodes) {
      const a = cp.querySelector('a[href^="http"]');
      if (!a || vistos.has(a.href)) continue;
      const pre = cp.getAttribute('data-pre-plain-text') || '';
      const mh = pre.match(/\[([^\]]+)\]/);
      const hora = mh ? mh[1] : '';
      // Sobe pelos ancestrais até achar um irmão (fora do balão de texto) com a
      // prévia (título + domínio) que o WhatsApp gera pra link com preview rica.
      let preview = '';
      let no = cp;
      for (let i = 0; i < 6 && no && no.parentElement; i++) {
        no = no.parentElement;
        const candidato = [...no.children]
          .filter((c) => !c.contains(cp) && !c.querySelector('.copyable-text'))
          .map((c) => (c.textContent || '').trim())
          .find((t) => t && t.length > 5 && t.length < 400);
        if (candidato) { preview = candidato; break; }
      }
      vistos.add(a.href);
      out.push({ de: direcaoDaMensagem(cp, centro, nomeContato), url: a.href, preview: preview.slice(0, 300), hora });
      if (out.length >= 15) break;
    }
    return out;
  }

  // ── Converte a hora tipo "[HH:MM, DD/MM/AAAA]" (DOM) ou "HH:MM, AAAA/M/D"
  //    (áudio) pra timestamp, pra comparar com a marca d'água da última
  //    mensagem já conhecida (modo incremental). Espelha _wa_parse_hora do backend. ──
  function parseHoraMs(h) {
    const m = /^\s*(\d{1,2}):(\d{2}),?\s*(\d{1,4})\/(\d{1,2})\/(\d{1,4})/.exec(h || '');
    if (!m) return null;
    const hh = +m[1], mi = +m[2];
    const a = m[3], b = m[4], c = m[5];
    try {
      if (a.length === 4) return new Date(+a, +b - 1, +c, hh, mi).getTime();
      return new Date(+c, +b - 1, +a, hh, mi).getTime();
    } catch (e) { return null; }
  }

  // ── Rola o histórico pra cima devagar até não carregar mais nada (ou um teto),
  //    pra pegar a conversa inteira e não só o que está na tela. Gentil e humano:
  //    pausa entre cada rolagem, nunca em loop apertado.
  //    `watermarkHora`: se o JOB já conhece essa conversa até um certo ponto
  //    (modo incremental), pára assim que a mensagem mais antiga carregada já
  //    cobrir esse ponto — não precisa voltar até o início de verdade. ──
  async function carregarHistorico(painel, atualizarStatus, watermarkHora) {
    if (!painel) return;
    const watermarkMs = watermarkHora ? parseHoraMs(watermarkHora) : null;
    let anterior = -1, estavel = 0;
    const MAX_ROLAGENS = 100;
    for (let i = 0; i < MAX_ROLAGENS; i++) {
      if (watermarkMs != null) {
        const msgs = rasparMensagensVisiveis();
        const primeiraMs = msgs.length ? parseHoraMs(msgs[0].hora) : null;
        if (primeiraMs != null && primeiraMs <= watermarkMs) break; // já cobriu o conhecido
      }
      // Força o scroll a mudar de verdade mesmo se já estiver em 0 — escrever
      // 0 de novo sem sair de lá não dispara o evento de scroll, e aí o
      // WhatsApp não percebe que precisa buscar mais histórico. Essa corrida
      // (rede mais lenta que o intervalo de checagem) fazia a leitura parar
      // no meio da conversa às vezes, sem pegar as mensagens mais antigas.
      painel.scrollTop = 40;
      await sleep(60);
      painel.scrollTop = 0;
      await sleep(650 + Math.floor(Math.random() * 250)); // ritmo humano
      const altura = painel.scrollHeight;
      if (atualizarStatus) atualizarStatus('Lendo histórico… (' + (i + 1) + ')');
      if (altura === anterior) {
        estavel++;
        if (estavel >= 4) break; // margem maior pra rede lenta não cortar cedo demais
      } else {
        estavel = 0;
        anterior = altura;
      }
    }
    // volta pro fim (estado normal da conversa)
    painel.scrollTop = painel.scrollHeight;
    await sleep(200);
  }

  // ── Deduplica mensagens iguais em sequência (a virtualização pode repetir). ──
  function dedup(msgs) {
    const out = [];
    let ultimo = '';
    for (const m of msgs) {
      const chave = m.de + '|' + m.texto + '|' + m.hora;
      if (chave !== ultimo) out.push(m);
      ultimo = chave;
    }
    return out;
  }

  // ── IMAGENS: raspa as fotos/cotações/documentos da conversa (blob: já
  //    renderizado), 100% leitura. fetch do blob same-origin funciona no content
  //    script (validado no DOM real). Redimensiona pra no máx 1600px e comprime
  //    em JPEG pra caber no payload. Direção pela mesma geometria do texto. ──
  const _WA_MAX_IMG = 8;

  async function imagemParaBase64(im) {
    const blob = await (await fetch(im.src)).blob();
    const bmp = await createImageBitmap(blob);
    const maxW = 1600;
    const escala = Math.min(1, maxW / bmp.width);
    const cw = Math.max(1, Math.round(bmp.width * escala));
    const ch = Math.max(1, Math.round(bmp.height * escala));
    const cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    cv.getContext('2d').drawImage(bmp, 0, 0, cw, ch);
    try { bmp.close(); } catch (e) {}
    // 0.92 (não 0.85): documento fotografado (RG/CNH/carteirinha) já vem
    // comprimido pelo WhatsApp; re-encodar em JPEG baixo por cima destruía o
    // texto fino e a IA não conseguia ler. 0.92 preserva legibilidade e continua
    // bem abaixo do teto de 7,5MB do servidor (foto a 1600px ~ 1MB base64).
    const dataUrl = cv.toDataURL('image/jpeg', 0.92);
    return dataUrl.split(',')[1] || '';
  }

  function horaProximaDaImagem(im) {
    let n = im;
    for (let i = 0; i < 8 && n; i++) {
      const t = n.querySelector && n.querySelector('[data-pre-plain-text]');
      if (t) {
        const m = (t.getAttribute('data-pre-plain-text') || '').match(/\[([^\]]+)\]/);
        if (m) return m[1];
      }
      n = n.parentElement;
    }
    return '';
  }

  async function rasparImagensVisiveis(atualizarStatus) {
    const centro = centroDoPainel();
    const cand = Array.from(document.querySelectorAll('#main img')).filter((im) =>
      (im.src || '').startsWith('blob:') && im.naturalWidth >= 150 && im.naturalHeight >= 150);
    // Monta metadado (barato) de todo mundo primeiro — antes só pegava as
    // PRIMEIRAS (mais antigas) até o teto, na ordem do DOM; podia deixar de
    // fora justo a cotação mais recente do lead numa conversa longa. Agora
    // prioriza lead+recente (igual áudio/PDF) ANTES de gastar tempo
    // convertendo pra base64. NÃO filtra por marca d'água — já tentamos e
    // era arriscado: uma imagem que ficasse de fora do teto numa rodada
    // anterior ficava escondida pra sempre (ver histórico do fix de áudio).
    const vistos = new Set();
    const candidatos = [];
    for (const im of cand) {
      if (vistos.has(im.src)) continue;
      vistos.add(im.src);
      const hora = horaProximaDaImagem(im);
      const horaMs = parseHoraMs(hora);
      const r = im.getBoundingClientRect();
      const de = (centro != null && r.width > 0)
        ? ((r.left + r.width / 2) < centro ? 'lead' : 'consultor') : 'lead';
      candidatos.push({ el: im, de, hora, horaMs: horaMs || 0 });
    }
    const doLead = candidatos.filter((c) => c.de === 'lead');
    const doConsultor = candidatos.filter((c) => c.de !== 'lead');
    const leadRecentes = doLead.slice(-_WA_MAX_IMG);
    const espacoConsultor = Math.max(0, _WA_MAX_IMG - leadRecentes.length);
    const consultorRecentes = espacoConsultor ? doConsultor.slice(-espacoConsultor) : [];
    const selecionados = [...leadRecentes, ...consultorRecentes].sort((a, b) => a.horaMs - b.horaMs);

    const out = [];
    for (const c of selecionados) {
      try {
        if (atualizarStatus) atualizarStatus('Lendo imagens… (' + (out.length + 1) + ')');
        const b64 = await imagemParaBase64(c.el);
        if (!b64) continue;
        out.push({ de: c.de, base64: b64, mime: 'image/jpeg', hora: c.hora });
      } catch (e) { /* imagem que falhar é ignorada, nunca derruba a análise */ }
    }
    return out;
  }

  // ── ÁUDIO: pede os áudios de voz pra ponte no main world (wpp-bridge.js), que
  //    usa a wa-js pra baixar sem play. Devolve [{de,base64,mime,hora}] ou []. ──
  function pedirAudios(limite) {
    return new Promise((resolve) => {
      const reqId = 'a' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      let pronto = false;
      function onMsg(ev) {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.source !== 'JOB_EXT_RESP' || d.reqId !== reqId) return;
        pronto = true;
        window.removeEventListener('message', onMsg);
        resolve(d.audios || []);
      }
      window.addEventListener('message', onMsg);
      window.postMessage({ source: 'JOB_EXT_REQ', tipo: 'baixar_audios', reqId, limite }, '*');
      setTimeout(() => {
        if (!pronto) { window.removeEventListener('message', onMsg); resolve([]); }
      }, 60000);
    });
  }

  function pedirDocumentos(limite) {
    return new Promise((resolve) => {
      const reqId = 'd' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      let pronto = false;
      function onMsg(ev) {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.source !== 'JOB_EXT_RESP' || d.reqId !== reqId) return;
        pronto = true;
        window.removeEventListener('message', onMsg);
        // encontrados = quantos PDFs existiam pra baixar; se baixou menos, o
        // servidor devolve documentos_falha e o painel avisa (nada de sumir PDF
        // em silêncio — conversa com 2 PDFs chegava com 1 e ninguém sabia).
        resolve({ documentos: d.documentos || [], encontrados: d.encontrados || (d.documentos || []).length });
      }
      window.addEventListener('message', onMsg);
      window.postMessage({ source: 'JOB_EXT_REQ', tipo: 'baixar_documentos', reqId, limite }, '*');
      setTimeout(() => {
        if (!pronto) { window.removeEventListener('message', onMsg); resolve({ documentos: [], encontrados: 0 }); }
      }, 60000);
    });
  }

  // ── TELEFONE via wa-js: pra contato salvo (nome próprio, não número), o DOM
  //    não expõe o telefone em lugar nenhum — mas o JID interno (chat.id) tem
  //    o número de verdade quando não é conta @lid (privacidade nova/business).
  //    Pede pra ponte no main world; devolve string de dígitos ou ''. ──
  function pedirTelefoneWpp() {
    return new Promise((resolve) => {
      const reqId = 't' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      let pronto = false;
      function onMsg(ev) {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.source !== 'JOB_EXT_RESP' || d.reqId !== reqId) return;
        pronto = true;
        window.removeEventListener('message', onMsg);
        resolve(d.telefone || '');
      }
      window.addEventListener('message', onMsg);
      window.postMessage({ source: 'JOB_EXT_REQ', tipo: 'obter_telefone', reqId }, '*');
      setTimeout(() => {
        if (!pronto) { window.removeEventListener('message', onMsg); resolve(''); }
      }, 5000);
    });
  }

  // ── Popup pra pedir o número quando o WhatsApp não expõe (conta business/@lid).
  //    Sem isso, o CRM criava um lead novo SEM número a cada envio (duplicado).
  //    Devolve os dígitos digitados (ou '' se o consultor pular). ──
  function pedirNumeroManual(nome) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.id = 'job-num-modal';
      wrap.innerHTML =
        '<div class="job-num-box">' +
          '<div class="job-num-tit">Número não identificado</div>' +
          '<div class="job-num-txt">O WhatsApp não mostrou o número de <b>' + ((nome || 'este contato').replace(/</g, '')) + '</b> (conta business ou de privacidade). Informe o WhatsApp dele pra salvar no CRM:</div>' +
          '<input class="job-num-inp" type="tel" inputmode="numeric" placeholder="Ex: 19 99999-8888" />' +
          '<div class="job-num-acoes">' +
            '<button class="job-num-pular" type="button">Pular</button>' +
            '<button class="job-num-ok" type="button">Salvar e enviar</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(wrap);
      const inp = wrap.querySelector('.job-num-inp');
      setTimeout(() => inp.focus(), 50);
      function fim(v) { wrap.remove(); resolve((v || '').trim()); }
      wrap.querySelector('.job-num-pular').addEventListener('click', () => fim(''));
      wrap.querySelector('.job-num-ok').addEventListener('click', () => fim(inp.value));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') fim(inp.value); if (e.key === 'Escape') fim(''); });
    });
  }

  // Garante um número pro lead: tenta pela wa-js; se não der, pergunta ao consultor.
  async function garantirTelefone(nome) {
    let tel = '';
    try { tel = (await pedirTelefoneWpp()) || telefoneDoContato(); } catch (e) { tel = telefoneDoContato(); }
    if (tel) return tel;
    return await pedirNumeroManual(nome);
  }

  // ── Número do PRÓPRIO WhatsApp logado (o do consultor), via wa-js. Vai junto
  //    da análise pro JOB atribuir o lead a quem está de fato conversando.
  //    Cacheado: não muda durante a sessão. ──
  let _meuNumeroCache = null;
  function pedirMeuNumero() {
    if (_meuNumeroCache) return Promise.resolve(_meuNumeroCache);
    return new Promise((resolve) => {
      const reqId = 'n' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      let pronto = false;
      function onMsg(ev) {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.source !== 'JOB_EXT_RESP' || d.reqId !== reqId) return;
        pronto = true;
        window.removeEventListener('message', onMsg);
        if (d.numero) _meuNumeroCache = d.numero;
        resolve(d.numero || '');
      }
      window.addEventListener('message', onMsg);
      window.postMessage({ source: 'JOB_EXT_REQ', tipo: 'obter_meu_numero', reqId }, '*');
      setTimeout(() => {
        if (!pronto) { window.removeEventListener('message', onMsg); resolve(''); }
      }, 5000);
    });
  }

  // Consultor escolhido no popup — cacheado pra comparações síncronas no render
  // (ex: "este lead é meu?" ao reabrir uma análise salva). Atualiza sozinho se
  // o popup mudar (storage.onChanged).
  let _usuarioIdPopup = null;
  try {
    chrome.storage.local.get(['usuarioId']).then(({ usuarioId }) => { _usuarioIdPopup = usuarioId || null; });
    chrome.storage.onChanged.addListener((mud, area) => {
      if (area === 'local' && mud.usuarioId) _usuarioIdPopup = mud.usuarioId.newValue || null;
    });
  } catch (e) { /* contexto invalidado — segue sem cache */ }

  // ── ID da conversa aberta agora (via wa-js). É o jeito à prova de falha de
  //    mandar pra conversa na tela mesmo quando o telefone não é lido (contato
  //    salvo, @lid business). Devolve '' se não der. ──
  function pedirChatId() {
    return new Promise((resolve) => {
      const reqId = 'c' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      let pronto = false;
      function onMsg(ev) {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.source !== 'JOB_EXT_RESP' || d.reqId !== reqId) return;
        pronto = true;
        window.removeEventListener('message', onMsg);
        resolve(d.chat_id || '');
      }
      window.addEventListener('message', onMsg);
      window.postMessage({ source: 'JOB_EXT_REQ', tipo: 'obter_chat_id', reqId }, '*');
      setTimeout(() => {
        if (!pronto) { window.removeEventListener('message', onMsg); resolve(''); }
      }, 5000);
    });
  }

  // ── ENVIO (Fase 1): pede pra ponte no main world mandar um texto
  //    específico. Só chamada pelo loop da fila (mais abaixo), nunca direto
  //    de uma ação de leitura. ──
  function pedirEnviarTexto(chatId, texto) {
    return new Promise((resolve) => {
      const reqId = 'e' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      let pronto = false;
      function onMsg(ev) {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.source !== 'JOB_EXT_RESP' || d.reqId !== reqId) return;
        pronto = true;
        window.removeEventListener('message', onMsg);
        resolve(d);
      }
      window.addEventListener('message', onMsg);
      window.postMessage({ source: 'JOB_EXT_REQ', tipo: 'enviar_texto', reqId, chatId, texto }, '*');
      setTimeout(() => {
        if (!pronto) { window.removeEventListener('message', onMsg); resolve({ erro: 'timeout_envio' }); }
      }, 30000);
    });
  }

  // ── ENVIO DE MÍDIA (item A): manda a mídia (dataURL, já baixada pelo
  //    background) pela ponte. Áudio vira nota de voz. ──
  function pedirEnviarMidia(chatId, midiaTipo, dataUrl, legenda) {
    return new Promise((resolve) => {
      const reqId = 'm' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      let pronto = false;
      function onMsg(ev) {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.source !== 'JOB_EXT_RESP' || d.reqId !== reqId) return;
        pronto = true;
        window.removeEventListener('message', onMsg);
        resolve(d);
      }
      window.addEventListener('message', onMsg);
      window.postMessage({ source: 'JOB_EXT_REQ', tipo: 'enviar_midia', reqId, chatId, midiaTipo, dataUrl, legenda }, '*');
      setTimeout(() => {
        if (!pronto) { window.removeEventListener('message', onMsg); resolve({ erro: 'timeout_envio' }); }
      }, 45000);
    });
  }


  // ═══════════════ UI: trilho fixo + painel docado ═══════════════
  // Pedido explícito: nada de elemento solto/flutuante — o padrão é um trilho
  // fino sempre visível na lateral (direita por padrão, esquerda por opção no
  // popup) e um painel que se DOCA ao lado dele, empurrando o WhatsApp de
  // verdade, igual WaSpeed/ZapVoice. Duas seções por enquanto: "analise" e
  // "mensagens" — dá pra crescer sem criar elemento novo, só adicionar item
  // no trilho.
  let _secaoAtiva = null; // 'analise' | 'mensagens' | null
  let _railSide = 'direita';

  async function carregarPreferenciaLado() {
    const { railSide } = await chrome.storage.local.get(['railSide']);
    _railSide = railSide === 'esquerda' ? 'esquerda' : 'direita';
    aplicarClassesHtml();
  }
  if (chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.railSide) {
        _railSide = changes.railSide.newValue === 'esquerda' ? 'esquerda' : 'direita';
        aplicarClassesHtml();
      }
    });
  }

  const JOB_PUSH_MIN_WIDTH = 1360; // trilho+painel+folga mínima pro WhatsApp não espremer
  function aplicarClassesHtml() {
    const html = document.documentElement;
    html.classList.toggle('job-push-esquerda', _railSide === 'esquerda');
    html.classList.add('job-push-trilho');
    if (_secaoAtiva) {
      const cabe = window.innerWidth >= JOB_PUSH_MIN_WIDTH;
      html.classList.toggle('job-push-painel', cabe);
      html.classList.toggle('job-overlay-painel', !cabe);
    } else {
      html.classList.remove('job-push-painel');
      html.classList.remove('job-overlay-painel');
    }
  }
  let _resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(aplicarClassesHtml, 150);
  });

  // Logo do JOB: o MESMO arquivo dos arcos do sistema (logo_arcos.png) girando
  // devagar, "JOB" parado no centro — idêntico à sidebar do site (spinSlow 20s).
  // Nada de anel genérico: é o logo real, liberado via web_accessible_resources.
  const _LOGO_ARCOS_URL = (function () {
    try { return chrome.runtime.getURL('logo_arcos.png'); } catch (e) { return ''; }
  })();
  function logoJobHTML() {
    return '<div class="job-logo">' +
      (_LOGO_ARCOS_URL ? '<img class="job-logo-arcos" src="' + _LOGO_ARCOS_URL + '" alt="">' : '') +
      '<span class="job-logo-txt">JOB</span></div>';
  }

  const _ICO_ANALISE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3"/></svg>';
  const _ICO_MENSAGENS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  const _ICO_FUNIS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>';

  // Kit de ícones SVG (traço, herda a cor via currentColor) — o Guilherme NÃO
  // quer emoji em interface nenhuma do JOB; qualquer ícone novo sai daqui.
  function _svgIco(nome, px) {
    const p = {
      texto: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
      audio: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>',
      imagem: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
      documento: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
      video: '<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
      clipe: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
      relogio: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
      chevron: '<polyline points="6 9 12 15 18 9"/>',
      funil: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
      estrela: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    }[nome] || '';
    const s = px || 14;
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
  }

  function criarTrilho() {
    if (document.getElementById('job-trilho')) return;
    const trilho = document.createElement('div');
    trilho.id = 'job-trilho';
    trilho.innerHTML =
      logoJobHTML() +
      '<button class="job-trilho-item" data-secao="analise" title="Análise de lead">' +
        '<span class="job-trilho-item-icone">' + _ICO_ANALISE + '</span>' +
        '<span class="job-trilho-item-label">Análise</span>' +
        '<span class="job-trilho-item-badge" id="job-trilho-badge" hidden>0</span>' +
      '</button>' +
      '<button class="job-trilho-item" data-secao="mensagens" title="Mensagens">' +
        '<span class="job-trilho-item-icone">' + _ICO_MENSAGENS + '</span>' +
        '<span class="job-trilho-item-label">Mensagens</span>' +
      '</button>' +
      '<button class="job-trilho-item" data-secao="funis" title="Funis">' +
        '<span class="job-trilho-item-icone">' + _ICO_FUNIS + '</span>' +
        '<span class="job-trilho-item-label">Funis</span>' +
      '</button>';
    trilho.querySelectorAll('.job-trilho-item').forEach((item) => {
      item.addEventListener('click', () => {
        const secao = item.dataset.secao;
        if (_secaoAtiva === secao) fecharSecao();
        else abrirSecao(secao);
      });
    });
    document.body.appendChild(trilho);
    aplicarClassesHtml();
  }

  function fecharSecao() {
    _secaoAtiva = null;
    const p = document.getElementById('job-painel-doc');
    if (p) p.remove();
    document.querySelectorAll('.job-trilho-item').forEach((i) => i.classList.remove('job-trilho-item-ativo'));
    aplicarClassesHtml();
  }

  // ESC fecha o painel da extensão (igual os modais do site do JOB). Só age
  // quando o painel está aberto — e aí segura o ESC pra ele não vazar pro
  // WhatsApp Web (que fecharia a conversa). Painel fechado: ESC segue normal.
  // Capture (true) pra pegar antes do handler do WhatsApp.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && _secaoAtiva) {
      fecharSecao();
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);

  function abrirSecao(secao) {
    _secaoAtiva = secao;
    document.querySelectorAll('.job-trilho-item').forEach((i) =>
      i.classList.toggle('job-trilho-item-ativo', i.dataset.secao === secao));
    let p = document.getElementById('job-painel-doc');
    if (!p) {
      p = document.createElement('div');
      p.id = 'job-painel-doc';
      p.innerHTML =
        '<div class="job-painel-doc-header">' +
          '<span class="job-painel-doc-logo">' + logoJobHTML() +
            '<span class="job-painel-doc-titulo">JOB <b>Serenus</b></span></span>' +
          '<button class="job-painel-doc-fechar" id="job-painel-doc-x">×</button>' +
        '</div>' +
        '<div class="job-painel-doc-corpo" id="job-painel-doc-corpo"></div>';
      document.body.appendChild(p);
      document.getElementById('job-painel-doc-x').addEventListener('click', fecharSecao);
    }
    p.classList.toggle('job-painel-doc-esquerda', _railSide === 'esquerda');
    aplicarClassesHtml();
    if (secao === 'analise') sincronizarPainelComConversa();
    else if (secao === 'mensagens') abrirSecaoMensagens();
    else if (secao === 'funis') abrirSecaoFunis();
  }

  function setCorpoSecao(html) {
    const c = document.getElementById('job-painel-doc-corpo');
    if (c) c.innerHTML = html;
    const cancelBtn = document.getElementById('job-cancelar-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => cancelarAnalise(cancelBtn.dataset.reqid));
    const analisarBtn = document.getElementById('job-analisar-btn');
    if (analisarBtn) analisarBtn.addEventListener('click', rodarAnalise);
  }

  // ═══════════════ Múltiplas análises em paralelo (estado + pílula) ═══════════════
  // A RASPAGEM (ler mensagens/áudio/imagem da tela) só funciona na conversa que
  // está aberta agora — não dá pra ler duas conversas ao mesmo tempo, é uma
  // limitação real do WhatsApp Web (só uma conversa fica no DOM por vez). Mas
  // depois que os dados já foram lidos, a ESPERA pela resposta do JOB (transcrição
  // + IA) não depende mais da tela — por isso dá pra trocar de conversa e deixar
  // rodando em segundo plano. Este bloco rastreia cada análise em andamento numa
  // Map (não um estado global único) e mostra uma pílula fixa com o total, pra
  // nunca "perder" uma análise que ficou rodando numa conversa que você já fechou,
  // nem confundir o painel com o resultado da conversa errada.
  const _analises = new Map(); // reqId -> {reqId, chave, telefone, nome, totalMsgs, status, resultado, erro, iniciadoEm, statusTexto}
  const _cancelados = new Set();

  function novoReqId() {
    return 'an_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  }

  function chaveConversa(telefone, nome) {
    return (telefone || '').trim() || ('nome:' + (nome || '').trim().toLowerCase());
  }

  function atualizarPilula() {
    const rodando = [..._analises.values()].filter((a) => a.status === 'rodando');
    const badge = document.getElementById('job-trilho-badge');
    if (!badge) return;
    if (!rodando.length) { badge.hidden = true; return; }
    badge.hidden = false;
    badge.textContent = String(rodando.length);
    badge.title = [..._analises.values()].filter((a) => a.status === 'rodando')
      .map((a) => (a.nome || a.telefone || 'Lead') + ' — ' + fmtDuracao((Date.now() - a.iniciadoEm) / 1000))
      .join('\n');
  }

  function telaCarregando(reqId, texto) {
    return '<div class="job-carregando"><div class="job-spin"></div><div id="job-status">' + esc(texto) + '</div></div>' +
      '<button class="job-cancelar" id="job-cancelar-btn" data-reqid="' + esc(reqId) + '">Cancelar análise</button>';
  }

  function telaSemAnalise() {
    return '<div class="job-sem-analise">' +
      '<div class="job-sem-analise-txt">Nenhuma análise ainda pra esta conversa.</div>' +
      '<button class="job-analisar-btn" id="job-analisar-btn">Analisar este lead</button>' +
      '</div>';
  }

  function telaBuscandoUltima() {
    return '<div class="job-carregando"><div class="job-spin"></div><div>Verificando análise salva…</div></div>';
  }

  function fmtDataHora(s) {
    if (!s) return '';
    try {
      const d = new Date(String(s).replace(' ', 'T'));
      if (isNaN(d.getTime())) return String(s);
      const p = (n) => String(n).padStart(2, '0');
      return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' às ' + p(d.getHours()) + ':' + p(d.getMinutes());
    } catch (e) { return String(s); }
  }

  // Retrato da ÚLTIMA análise salva no JOB (pode ter rodado em outro
  // computador, ou nesta mesma antes de fechar o Chrome) — a extensão só
  // guarda o resultado completo em memória (Map _analises), que se perde ao
  // recarregar; sem isso o consultor via "nenhuma análise" à toa toda vez que
  // reabria a conversa, mesmo já tendo analisado antes.
  function telaUltimaAnaliseSalva(ua, totalMsgs) {
    const cor = corFaixa(ua.faixa);
    return '<div class="job-ultima-analise">' +
      '<div class="job-ultima-analise-tag">Última análise salva</div>' +
      '<div class="job-score-wrap">' +
        '<div class="job-score-num" style="color:' + cor + '">' + (ua.score ?? '—') + '</div>' +
        '<div class="job-score-meta">' +
          '<div class="job-score-faixa" style="color:' + cor + '">' + esc((ua.faixa || '').toUpperCase()) + '</div>' +
          '<div class="job-score-sub">' + esc(fmtDataHora(ua.criado_em)) + (totalMsgs ? ' · ' + totalMsgs + ' mensagens' : '') + '</div>' +
        '</div>' +
      '</div>' +
      (ua.resumo ? '<div class="job-resumo">' + esc(ua.resumo) + '</div>' : '') +
      (ua.lead_id ? '<a class="job-lead-ok" href="' + esc(_SITE_BASE_URL_EXT) + '/crm?lead=' + ua.lead_id + '" target="_blank" rel="noopener">Abrir lead no CRM</a>' : '') +
      '<a class="job-lead-ok" href="' + esc(ua.conversa_url) + '" target="_blank" rel="noopener">Ver conversa completa</a>' +
      '<button class="job-analisar-btn" id="job-analisar-btn" style="margin-top:10px;">Analisar de novo</button>' +
      '</div>';
  }

  // Mesma tela de resultado de uma análise recém-rodada (renderResultado),
  // mas hidratada com o que já estava salvo no JOB — inclusive leitura da IA,
  // dados extraídos e sugestões. Antes disso existir, reabrir uma conversa já
  // analisada só mostrava um resumo raso (score + texto curto): o resto
  // (sugestoes_json) sempre esteve salvo no banco, só não voltava pra cá.
  // Se o registro for antigo (sem sugestoes_json) ou vier vazio, cai de volta
  // na tela rasa (telaUltimaAnaliseSalva) em vez de mostrar um painel rico
  // cheio de seções vazias.
  function telaUltimaAnaliseSalvaRica(ua, totalMsgs, telefone) {
    if (!ua.extracao && !ua.ia && !(ua.sugestoes || []).length) return telaUltimaAnaliseSalva(ua, totalMsgs);
    return '<div class="job-ultima-analise-tag">Última análise salva · ' + esc(fmtDataHora(ua.criado_em)) + '</div>' +
      renderResultado(ua, ua.lead ? ua.lead.nome : '', telefone, totalMsgs) +
      '<button class="job-analisar-btn" id="job-analisar-btn" style="margin-top:10px;">Analisar de novo</button>';
  }

  // Chama de novo o conteúdo certo da seção "Análise" quando o consultor troca
  // de conversa — nunca deixa a análise do cliente anterior "grudada" na tela
  // do cliente novo. Só mexe se a seção estiver de fato aberta agora.
  async function sincronizarPainelComConversa() {
    if (_secaoAtiva !== 'analise') return;
    const chaveAtual = chaveConversa(telefoneDoContato(), nomeDoContato());
    const doConversaAtual = [..._analises.values()]
      .filter((a) => a.chave === chaveAtual)
      .sort((a, b) => b.iniciadoEm - a.iniciadoEm)[0];
    if (doConversaAtual) {
      if (doConversaAtual.status === 'rodando') {
        setCorpoSecao(telaCarregando(doConversaAtual.reqId, doConversaAtual.statusTexto || 'Analisando…'));
      } else if (doConversaAtual.status === 'ok') {
        // O botão "Analisar de novo" tem que aparecer TAMBÉM aqui (resultado da
        // sessão atual, em memória) — antes só vinha na análise buscada do
        // servidor, então quem acabou de analisar ficava sem como reanalisar.
        setCorpoSecao(renderResultado(doConversaAtual.resultado, doConversaAtual.nome, doConversaAtual.telefone, doConversaAtual.totalMsgs) +
          '<button class="job-analisar-btn" id="job-analisar-btn" style="margin-top:10px;">Analisar de novo</button>');
        ligarBotaoCopiar();
      } else if (doConversaAtual.status === 'erro') {
        setCorpoSecao('<div class="job-erro">' + esc(doConversaAtual.erro || 'Falha ao analisar') + '</div>' + telaSemAnalise());
      } else if (doConversaAtual.status === 'cancelado') {
        setCorpoSecao('<div class="job-erro">Análise cancelada.</div>' + telaSemAnalise());
      }
      return;
    }
    // Nada rodado NESTA sessão — pergunta ao JOB se existe uma análise salva
    // de antes (outra sessão/computador). chaveAtual é comparada de novo
    // depois do fetch pra não pintar a tela errada se o consultor já trocou
    // de conversa enquanto a busca estava em voo.
    setCorpoSecao(telaBuscandoUltima());
    let telefone = '';
    try { telefone = (await pedirTelefoneWpp()) || telefoneDoContato(); } catch (e) { telefone = telefoneDoContato(); }
    if (_secaoAtiva !== 'analise' || chaveConversa(telefoneDoContato(), nomeDoContato()) !== chaveAtual) return;
    if (!telefone) { setCorpoSecao(telaSemAnalise()); return; }
    let resp = null;
    try { resp = await chrome.runtime.sendMessage({ type: 'estado', telefone }); } catch (e) { /* segue sem retrato */ }
    if (_secaoAtiva !== 'analise' || chaveConversa(telefoneDoContato(), nomeDoContato()) !== chaveAtual) return;
    const ultima = resp && resp.ok && resp.existe && resp.ultima_analise;
    setCorpoSecao(ultima ? telaUltimaAnaliseSalvaRica(ultima, resp.total_mensagens, telefone) : telaSemAnalise());
    if (ultima) ligarBotaoCopiar();
  }

  function cancelarAnalise(reqId) {
    if (!reqId) return;
    _cancelados.add(reqId);
    const a = _analises.get(reqId);
    if (a) a.status = 'cancelado';
    try { chrome.runtime.sendMessage({ type: 'cancelar', reqId }); } catch (e) { /* ignore */ }
    atualizarPilula();
    sincronizarPainelComConversa();
  }

  function notificarConclusao(a) {
    if (!a) return;
    const titulo = a.status === 'ok'
      ? 'Análise concluída — ' + (a.nome || a.telefone || 'lead')
      : 'Análise falhou — ' + (a.nome || a.telefone || 'lead');
    const msg = a.status === 'ok'
      ? 'Score ' + (a.resultado && a.resultado.score != null ? a.resultado.score : '—') + '/1000'
      : (a.erro || 'Erro desconhecido');
    try { chrome.runtime.sendMessage({ type: 'notificar', titulo, mensagem: msg }); } catch (e) { /* ignore */ }
  }

  // ═══════════════ Seção Mensagens: biblioteca de modelos ═══════════════
  // Biblioteca de modelos de mensagem, gerenciável AQUI dentro da extensão
  // (pedido direto do Guilherme, igual WaSpeed/ZapVoice): salvar texto pronto,
  // subir áudio/imagem, e GRAVAR áudio na hora — sem sair do WhatsApp. Mandar
  // um modelo continua passando pela mesma fila com limite de ritmo do
  // servidor. Envio de mídia em si (mandar o áudio pro lead) ainda é fase
  // futura — por ora a mídia fica salva no modelo, o botão Enviar manda o
  // texto.
  const MODELOS_CACHE_MS = 5 * 60 * 1000;
  let _modelosCache = null; // {ts, modelos}
  let _gestorModo = false; // gestor/admin: vê a biblioteca de todos, agrupada por consultor
  let _gravador = null, _gravChunks = [], _gravTimer = null, _gravInicio = 0;
  let _midiaAnexada = null; // {blob, nome, mime, tipo, dur}

  async function buscarModelos(forcar) {
    if (!forcar && _modelosCache && (Date.now() - _modelosCache.ts) < MODELOS_CACHE_MS) {
      return _modelosCache.modelos;
    }
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ type: 'listar_modelos' });
    } catch (e) {
      // "Extension context invalidated": a extensão foi atualizada/recarregada
      // mas ESTA aba do WhatsApp não — o content script ficou órfão do
      // background. Sinaliza pro chamador mostrar "recarregue a aba" em vez de
      // travar no spinner pra sempre (era esse o bug do "Carregando modelos…").
      throw new Error('CONTEXTO_INVALIDO');
    }
    const modelos = (resp && resp.ok && resp.modelos) || [];
    _gestorModo = !!(resp && resp.gestor);
    _modelosCache = { ts: Date.now(), modelos };
    return modelos;
  }

  function telaMensagensCarregando() {
    return '<div class="job-carregando"><div class="job-spin"></div><div>Carregando modelos…</div></div>';
  }

  function renderFormularioNovo() {
    let midiaChip = '';
    if (_midiaAnexada) {
      const rotTipo = { audio: 'Áudio pronto', imagem: 'Imagem pronta', video: 'Vídeo pronto', documento: 'PDF pronto' };
      const icoTipo = { audio: 'audio', imagem: 'imagem', video: 'imagem', documento: 'documento' };
      const rot = _svgIco(icoTipo[_midiaAnexada.tipo] || 'clipe', 12) + ' ' +
        (rotTipo[_midiaAnexada.tipo] || 'Arquivo pronto') +
        (_midiaAnexada.tipo === 'audio' && _midiaAnexada.dur ? ' (' + fmtDuracao(_midiaAnexada.dur) + ')' : '');
      midiaChip = '<div class="job-midia-chip">' + rot +
        '<button class="job-midia-x" id="job-midia-descartar" title="Remover">×</button></div>';
    }
    return '<div class="job-novo-modelo">' +
      '<div class="job-sec" style="margin-top:0">Novo modelo</div>' +
      '<input class="job-inp" id="job-novo-nome" placeholder="Nome (ex: Boas-vindas)">' +
      '<input class="job-inp" id="job-novo-categoria" list="job-cats" placeholder="Pasta (opcional — ex: Amil, Carência, Rede)">' +
      '<datalist id="job-cats">' + categoriasExistentes().map((c) => '<option value="' + esc(c) + '">').join('') + '</datalist>' +
      '<textarea class="job-inp job-inp-txt" id="job-novo-texto" placeholder="Texto da mensagem…"></textarea>' +
      '<div class="job-novo-acoes">' +
        '<button class="job-mini-btn" id="job-gravar-btn">' + _svgIco('audio', 12) + ' Gravar áudio</button>' +
        '<button class="job-mini-btn" id="job-anexar-btn">' + _svgIco('clipe', 12) + ' Anexar arquivo</button>' +
        '<input type="file" id="job-arquivo-input" accept="audio/*,image/*,video/*,application/pdf" style="display:none">' +
      '</div>' +
      '<div id="job-grav-status" class="job-grav-status"></div>' +
      midiaChip +
      '<button class="job-salvar-modelo" id="job-salvar-modelo-btn">Salvar modelo</button>' +
      '<div id="job-salvar-status" class="job-grav-status"></div>' +
      '</div>';
  }

  let _waFiltro = 'todos'; // todos | favoritos | texto | audio | imagem
  let _waBusca = '';

  function categoriasExistentes() {
    const cats = (_modelosCache ? _modelosCache.modelos : [])
      .map((m) => (m.categoria || '').trim()).filter(Boolean);
    return [...new Set(cats)].sort();
  }

  function tipoIcone(m) {
    const ico = { audio: 'audio', imagem: 'imagem', video: 'imagem', documento: 'documento' }[m.midia_tipo] || 'texto';
    return '<span class="job-tico tico-' + ico + '">' + _svgIco(ico, 13) + '</span>';
  }

  function modeloPassaFiltro(m) {
    const tipo = m.midia_tipo || 'texto';
    const okFiltro = _waFiltro === 'todos'
      || (_waFiltro === 'favoritos' && m.favorito)
      || tipo === _waFiltro;
    if (!okFiltro) return false;
    if (!_waBusca) return true;
    const q = _waBusca;
    return (m.nome || '').toLowerCase().indexOf(q) >= 0
      || (m.texto || '').toLowerCase().indexOf(q) >= 0
      || (m.categoria || '').toLowerCase().indexOf(q) >= 0;
  }

  function cardModelo(m) {
    let midia = '';
    if (m.midia_tipo === 'audio' && m.midia_url) {
      // Ouvir antes de enviar — o player do WhatsApp Web já mostra o áudio;
      // aqui é pra CONFERIR o modelo salvo antes de mandar (padrão ZapVoice).
      midia = '<audio class="job-modelo-audio" controls preload="none" src="' + esc(m.midia_url) + '"></audio>';
    } else if (m.midia_tipo === 'imagem' && m.midia_url) {
      midia = '<img class="job-modelo-img" src="' + esc(m.midia_url) + '" alt="">';
    } else if (m.midia_tipo === 'video' && m.midia_url) {
      midia = '<video class="job-modelo-img" controls preload="none" src="' + esc(m.midia_url) + '"></video>';
    } else if (m.midia_tipo === 'documento' && m.midia_url) {
      midia = '<a class="job-modelo-doc" href="' + esc(m.midia_url) + '" target="_blank" rel="noopener">' + _svgIco('documento', 12) + ' Abrir PDF</a>';
    }
    const estrela = '<button class="job-modelo-fav ' + (m.favorito ? 'ativo' : '') +
      '" data-modelo-id="' + m.id + '" title="Favoritar">★</button>';
    return '<div class="job-modelo-card">' +
      '<div class="job-modelo-topo">' +
        '<div class="job-modelo-nome"><span class="job-tipo-ico">' + tipoIcone(m) + '</span> ' + esc(m.nome) + '</div>' +
        estrela +
      '</div>' +
      '<div class="job-modelo-preview">' + esc(m.texto) + '</div>' +
      midia +
      '<div class="job-modelo-acoes">' +
        '<button class="job-modelo-enviar" data-modelo-id="' + m.id + '">' + rotuloEnviar(m) + '</button>' +
        '<button class="job-modelo-copiar" data-texto="' + esc(m.texto) + '">Copiar</button>' +
        '<button class="job-modelo-excluir" data-modelo-id="' + m.id + '" title="Excluir">×</button>' +
      '</div>' +
    '</div>';
  }

  function rotuloEnviar(m) {
    if (m.midia_tipo === 'audio') return 'Enviar áudio';
    if (m.midia_tipo === 'imagem') return 'Enviar imagem';
    if (m.midia_tipo === 'video') return 'Enviar vídeo';
    if (m.midia_tipo === 'documento') return 'Enviar PDF';
    return 'Enviar texto';
  }

  // Tipo do modelo pro agrupamento (Áudio/Imagem/PDF/Vídeo/Texto) — nível de
  // dentro da pasta, tudo automático do midia_tipo. Sem pasta manual.
  const _ORDEM_TIPO = ['Texto', 'Áudio', 'Imagem', 'PDF', 'Vídeo'];
  function _tipoModelo(m) {
    if (m.midia_tipo === 'audio') return 'Áudio';
    if (m.midia_tipo === 'imagem') return 'Imagem';
    if (m.midia_tipo === 'video') return 'Vídeo';
    if (m.midia_tipo === 'documento') return 'PDF';
    return 'Texto';
  }
  function _blocoPorTipo(itens) {
    const porTipo = new Map();
    itens.forEach((m) => {
      const t = _tipoModelo(m);
      if (!porTipo.has(t)) porTipo.set(t, []);
      porTipo.get(t).push(m);
    });
    let html = '';
    _ORDEM_TIPO.forEach((t) => {
      if (porTipo.has(t)) {
        html += '<div class="job-modelo-tipo">' + t + ' <span>(' + porTipo.get(t).length + ')</span></div>' +
          porTipo.get(t).map(cardModelo).join('');
      }
    });
    return html;
  }
  // Sub-pastas manuais dentro do consultor (categoria — ex: Amil, Carência, Rede).
  // "Geral" pros sem sub-pasta. Dentro de cada uma, agrupa por tipo.
  function _blocoPorCategoria(itens) {
    const porCat = new Map();
    itens.forEach((m) => {
      const cat = ((m.categoria || '').trim()) || 'Geral';
      if (!porCat.has(cat)) porCat.set(cat, []);
      porCat.get(cat).push(m);
    });
    const cats = [...porCat.keys()].sort((a, b) =>
      a === 'Geral' ? 1 : (b === 'Geral' ? -1 : a.localeCompare(b)));
    // Uma sub-pasta só (Geral) = não precisa da caixa, mostra direto por tipo.
    if (cats.length === 1) return _blocoPorTipo(porCat.get(cats[0]));
    let html = '';
    cats.forEach((cat) => {
      html += '<details class="job-subpasta" open><summary class="job-subpasta-nome">' +
        esc(cat) + ' <span>(' + porCat.get(cat).length + ')</span></summary>' +
        '<div class="job-subpasta-conteudo">' + _blocoPorTipo(porCat.get(cat)) + '</div></details>';
    });
    return html;
  }
  function renderListaModelos(modelos) {
    const filtrados = modelos.filter(modeloPassaFiltro);
    if (!filtrados.length) {
      return _waBusca || _waFiltro !== 'todos'
        ? '<div class="job-vazio">Nenhum modelo bate com esse filtro.</div>'
        : '<div class="job-vazio">Nenhum modelo salvo ainda. Crie o primeiro acima.</div>';
    }
    // Modelo do desenho do Guilherme: PASTA = consultor, DENTRO agrupado por TIPO
    // (áudio/texto/PDF/imagem). Gestor vê a pasta de cada consultor (recolhível);
    // consultor comum vê direto os tipos (é tudo dele). Nada de árvore/categoria.
    if (_gestorModo) {
      const porDono = new Map();
      filtrados.forEach((m) => {
        const d = (m.dono_nome || 'Compartilhado');
        if (!porDono.has(d)) porDono.set(d, []);
        porDono.get(d).push(m);
      });
      let out = '';
      porDono.forEach((itens, dono) => {
        out += '<details class="job-pasta" open><summary class="job-pasta-nome">' +
          esc(dono) + ' <span>(' + itens.length + ')</span></summary>' +
          '<div class="job-pasta-conteudo">' + _blocoPorCategoria(itens) + '</div></details>';
      });
      return out;
    }
    return _blocoPorCategoria(filtrados);
  }

  function renderModelos(modelos) {
    const chips = ['todos', 'favoritos', 'texto', 'audio', 'imagem'].map((f) => {
      const rot = {
        todos: 'Todos',
        favoritos: _svgIco('estrela', 11),
        texto: _svgIco('texto', 12),
        audio: _svgIco('audio', 12),
        imagem: _svgIco('imagem', 12),
      }[f];
      return '<button class="job-fchip ' + (_waFiltro === f ? 'on' : '') + '" data-f="' + f + '">' + rot + '</button>';
    }).join('');
    return renderFormularioNovo() +
      '<div class="job-biblioteca-controles">' +
        '<input class="job-inp" id="job-busca-modelo" placeholder="Buscar modelo…" value="' + esc(_waBusca) + '">' +
        '<div class="job-fchips">' + chips + '</div>' +
      '</div>' +
      '<div class="job-sec">Modelos salvos</div>' +
      '<div id="job-modelos-lista">' + renderListaModelos(modelos) + '</div>';
  }

  function rerenderListaModelos() {
    const c = document.getElementById('job-modelos-lista');
    if (!c) return;
    c.innerHTML = renderListaModelos(_modelosCache ? _modelosCache.modelos : []);
    ligarAcoesItens();
  }

  // Ações dos itens da lista (separadas do formulário, pra re-render de
  // busca/filtro não precisar rebindar o formulário e perder o que foi digitado).
  function ligarAcoesItens() {
    document.querySelectorAll('.job-modelo-enviar[data-modelo-id]').forEach((btn) => {
      btn.addEventListener('click', () => enviarModelo(btn));
    });
    document.querySelectorAll('.job-modelo-copiar').forEach((btn) => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.texto || '').then(() => {
          const original = btn.textContent;
          btn.textContent = 'Copiado!';
          setTimeout(() => { btn.textContent = original; }, 1500);
        });
      });
    });
    document.querySelectorAll('.job-modelo-excluir').forEach((btn) => {
      btn.addEventListener('click', () => excluirModelo(btn.dataset.modeloId));
    });
    document.querySelectorAll('.job-modelo-fav').forEach((btn) => {
      btn.addEventListener('click', () => toggleFavoritoModelo(btn.dataset.modeloId, btn));
    });
  }

  function ligarAcoesModelos() {
    const g = document.getElementById('job-gravar-btn');
    if (g) g.addEventListener('click', toggleGravacao);
    const a = document.getElementById('job-anexar-btn');
    const inp = document.getElementById('job-arquivo-input');
    if (a && inp) {
      a.addEventListener('click', () => inp.click());
      inp.addEventListener('change', () => {
        const f = inp.files[0];
        if (f) anexarArquivo(f);
      });
    }
    const desc = document.getElementById('job-midia-descartar');
    if (desc) desc.addEventListener('click', descartarMidia);
    const sv = document.getElementById('job-salvar-modelo-btn');
    if (sv) sv.addEventListener('click', salvarModeloNovo);

    const busca = document.getElementById('job-busca-modelo');
    if (busca) busca.addEventListener('input', () => { _waBusca = (busca.value || '').trim().toLowerCase(); rerenderListaModelos(); });
    document.querySelectorAll('.job-fchip').forEach((chip) => {
      chip.addEventListener('click', () => {
        _waFiltro = chip.dataset.f;
        document.querySelectorAll('.job-fchip').forEach((c) => c.classList.toggle('on', c === chip));
        rerenderListaModelos();
      });
    });

    ligarAcoesItens();
  }

  async function toggleFavoritoModelo(id, btn) {
    const resp = await chrome.runtime.sendMessage({ type: 'favorito_modelo', id });
    if (!resp || !resp.ok) return;
    btn.classList.toggle('ativo', resp.favorito);
    // atualiza o cache pra o filtro "favoritos" e a ordenação refletirem
    if (_modelosCache) {
      const m = _modelosCache.modelos.find((x) => String(x.id) === String(id));
      if (m) m.favorito = resp.favorito;
    }
  }

  // ── Gravação de áudio ao vivo (MediaRecorder). O WhatsApp Web já tem
  //    permissão de microfone (usa pra nota de voz), então getUserMedia
  //    normalmente passa direto. Se negar, mostra erro claro. ──
  async function toggleGravacao() {
    const btn = document.getElementById('job-gravar-btn');
    const st = document.getElementById('job-grav-status');
    if (_gravador && _gravador.state === 'recording') {
      _gravador.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      _gravChunks = [];
      _gravador = new MediaRecorder(stream);
      _gravador.ondataavailable = (e) => { if (e.data.size) _gravChunks.push(e.data); };
      _gravador.onstop = () => {
        clearInterval(_gravTimer);
        stream.getTracks().forEach((t) => t.stop());
        const dur = Math.round((Date.now() - _gravInicio) / 1000);
        const blob = new Blob(_gravChunks, { type: _gravChunks[0] ? _gravChunks[0].type : 'audio/webm' });
        _midiaAnexada = { blob, nome: 'gravacao.webm', mime: blob.type || 'audio/webm', tipo: 'audio', dur };
        redesenharMensagens();
      };
      _gravInicio = Date.now();
      _gravador.start();
      if (btn) btn.textContent = '■ Parar';
      _gravTimer = setInterval(() => {
        if (st) st.textContent = 'Gravando… ' + fmtDuracao(Math.round((Date.now() - _gravInicio) / 1000));
      }, 500);
    } catch (e) {
      if (st) st.textContent = 'Não consegui acessar o microfone: ' + e.message;
    }
  }

  function anexarArquivo(f) {
    const mime = f.type || '';
    const nome = (f.name || '').toLowerCase();
    let tipo = 'audio';
    if (mime.startsWith('image/')) tipo = 'imagem';
    else if (mime.startsWith('video/') || /\.(mp4|mov|m4v|3gp)$/.test(nome)) tipo = 'video';
    else if (mime === 'application/pdf' || nome.endsWith('.pdf')) tipo = 'documento';
    else if (mime.startsWith('audio/')) tipo = 'audio';
    _midiaAnexada = { blob: f, nome: f.name, mime: mime || 'application/octet-stream', tipo, dur: null };
    redesenharMensagens();
  }

  function descartarMidia() {
    _midiaAnexada = null;
    redesenharMensagens();
  }

  // Redesenha preservando o que já foi digitado no formulário (nome/texto).
  function redesenharMensagens() {
    const nomeAtual = (document.getElementById('job-novo-nome') || {}).value || '';
    const textoAtual = (document.getElementById('job-novo-texto') || {}).value || '';
    setCorpoSecaoMensagens(renderModelos(_modelosCache ? _modelosCache.modelos : []));
    ligarAcoesModelos();
    const n = document.getElementById('job-novo-nome');
    const t = document.getElementById('job-novo-texto');
    if (n) n.value = nomeAtual;
    if (t) t.value = textoAtual;
  }

  function blobParaBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  async function salvarModeloNovo() {
    const nome = (document.getElementById('job-novo-nome') || {}).value || '';
    const texto = (document.getElementById('job-novo-texto') || {}).value || '';
    const st = document.getElementById('job-salvar-status');
    const btn = document.getElementById('job-salvar-modelo-btn');
    if (!nome.trim() || !texto.trim()) { if (st) st.textContent = 'Preencha nome e texto.'; return; }
    const { usuarioId } = await chrome.storage.local.get(['usuarioId']);
    btn.disabled = true;
    if (st) st.textContent = 'Salvando…';
    const categoria = ((document.getElementById('job-novo-categoria') || {}).value || '').trim();
    const dados = { nome: nome.trim(), texto: texto.trim(), categoria, usuario_id: usuarioId || '' };
    if (_midiaAnexada) {
      try { dados.midia_base64 = await blobParaBase64(_midiaAnexada.blob); }
      catch (e) { if (st) st.textContent = 'Erro ao ler a mídia.'; btn.disabled = false; return; }
      dados.midia_nome = _midiaAnexada.nome;
      dados.midia_mime = _midiaAnexada.mime;
    }
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'criar_modelo', dados });
      if (!resp || !resp.ok) {
        if (st) st.textContent = 'Erro: ' + ((resp && resp.erro) || 'falha ao salvar');
        btn.disabled = false;
        return;
      }
      _midiaAnexada = null;
      await buscarModelos(true); // recarrega a lista com o novo
      if (_secaoAtiva === 'mensagens') { setCorpoSecaoMensagens(renderModelos(_modelosCache.modelos)); ligarAcoesModelos(); }
    } catch (e) {
      if (st) st.textContent = 'Erro: ' + e.message;
      btn.disabled = false;
    }
  }

  async function excluirModelo(id) {
    if (!confirm('Excluir este modelo?')) return;
    const resp = await chrome.runtime.sendMessage({ type: 'excluir_modelo', id });
    if (!resp || !resp.ok) { alert((resp && resp.erro) || 'Erro ao excluir'); return; }
    await buscarModelos(true);
    if (_secaoAtiva === 'mensagens') { setCorpoSecaoMensagens(renderModelos(_modelosCache.modelos)); ligarAcoesModelos(); }
  }

  // Ao clicar "Enviar texto" NÃO dispara na hora — abre um preview editável
  // (padrão do olho 👁 do WaSpeed), pra ter CERTEZA do que vai pro cliente e
  // poder ajustar antes. Só envia depois de confirmar.
  async function enviarModelo(btn) {
    const modelos = await buscarModelos(false);
    const modelo = modelos.find((m) => String(m.id) === btn.dataset.modeloId);
    if (!modelo) return;
    abrirPreviewEnvio(modelo);
  }

  // Aceita um modelo {texto, id, midia_tipo, midia_url} OU só um texto (composição
  // avulsa). Mídia mostra o áudio/imagem no preview; áudio não tem legenda (nota
  // de voz), imagem tem legenda opcional; texto puro exige mensagem.
  function abrirPreviewEnvio(modeloOuTexto) {
    const modelo = (typeof modeloOuTexto === 'object' && modeloOuTexto) ? modeloOuTexto : { texto: modeloOuTexto || '' };
    const modeloId = modelo.id || null;
    const midiaTipo = modelo.midia_tipo || null;
    const existente = document.getElementById('job-preview');
    if (existente) existente.remove();
    const nome = nomeDoContato() || 'este contato';
    let previaMidia = '';
    if (midiaTipo === 'audio' && modelo.midia_url) {
      previaMidia = '<div class="job-preview-midia"><span class="job-preview-midia-rot">' + _svgIco('audio', 12) + ' Nota de voz — ouça antes de enviar</span>' +
        '<audio controls preload="none" src="' + esc(modelo.midia_url) + '" style="width:100%"></audio></div>';
    } else if (midiaTipo === 'imagem' && modelo.midia_url) {
      previaMidia = '<div class="job-preview-midia"><img src="' + esc(modelo.midia_url) + '" alt="" style="max-width:100%;max-height:180px;border-radius:8px"></div>';
    }
    const ehAudio = midiaTipo === 'audio';
    const placeholder = midiaTipo === 'imagem' ? 'Legenda (opcional)…' : 'Escreva a mensagem…';
    const ov = document.createElement('div');
    ov.id = 'job-preview';
    ov.innerHTML =
      '<div class="job-preview-card">' +
        '<div class="job-preview-head"><span>Enviar para <b>' + esc(nome) + '</b></span>' +
          '<button class="job-preview-x" id="job-preview-x">×</button></div>' +
        previaMidia +
        (ehAudio ? '' : '<textarea class="job-preview-txt" id="job-preview-texto" placeholder="' + placeholder + '"></textarea>') +
        '<div class="job-preview-acoes">' +
          '<button class="job-preview-cancelar" id="job-preview-cancelar">Cancelar</button>' +
          '<button class="job-preview-enviar" id="job-preview-enviar">Enviar</button>' +
        '</div>' +
        '<div class="job-preview-status" id="job-preview-status"></div>' +
      '</div>';
    document.body.appendChild(ov);
    const ta = document.getElementById('job-preview-texto');
    if (ta) { ta.value = modelo.texto || ''; }
    const fechar = () => ov.remove();
    ov.addEventListener('click', (e) => { if (e.target === ov) fechar(); });
    document.getElementById('job-preview-x').addEventListener('click', fechar);
    document.getElementById('job-preview-cancelar').addEventListener('click', fechar);
    document.getElementById('job-preview-enviar').addEventListener('click', () => confirmarEnvioPreview(ov, modeloId, midiaTipo));
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }

  async function confirmarEnvioPreview(ov, modeloId, midiaTipo) {
    const ta = document.getElementById('job-preview-texto');
    const st = document.getElementById('job-preview-status');
    const btn = document.getElementById('job-preview-enviar');
    const texto = ((ta && ta.value) || '').trim();
    // Texto puro exige mensagem; mídia pode ir sem legenda.
    if (!texto && !midiaTipo) { if (st) st.textContent = 'A mensagem está vazia.'; return; }
    const { usuarioId } = await chrome.storage.local.get(['usuarioId']);
    if (!usuarioId) { if (st) st.textContent = 'Selecione seu usuário no popup da extensão primeiro.'; return; }
    btn.disabled = true;
    if (st) st.textContent = 'Enviando…';
    const nome = nomeDoContato();
    // chat_id da conversa aberta é o caminho à prova de falha (funciona pra
    // contato salvo e @lid). Telefone é só best-effort, pra casar o lead no CRM.
    let chatId = '';
    try { chatId = await pedirChatId(); } catch (e) { chatId = ''; }
    let telefone = await garantirTelefone(nome);
    if (!chatId && !telefone) {
      if (st) st.textContent = 'Não consegui identificar a conversa. Abra a conversa e tente de novo.';
      btn.disabled = false;
      return;
    }
    try {
      const payload = { telefone, nome, texto, usuario_id: usuarioId };
      if (chatId) payload.chat_id = chatId;
      if (modeloId) payload.modelo_id = modeloId;
      const resp = await chrome.runtime.sendMessage({ type: 'enviar_direto', payload });
      if (!resp || !resp.ok) {
        if (st) st.textContent = 'Erro: ' + ((resp && resp.erro) || 'falha ao enviar');
        btn.disabled = false;
        return;
      }
      await checarFilaDeEnvio();
      if (st) st.textContent = 'Enviado ✓';
      setTimeout(() => { ov.remove(); }, 800);
    } catch (e) {
      if (st) st.textContent = 'Erro: ' + e.message;
      btn.disabled = false;
    }
  }

  async function abrirSecaoMensagens() {
    setCorpoSecaoMensagens(telaMensagensCarregando());
    let modelos;
    try {
      modelos = await buscarModelos(false);
    } catch (e) {
      if (_secaoAtiva !== 'mensagens') return;
      setCorpoSecaoMensagens(_avisoRecarregarAba());
      return;
    }
    if (_secaoAtiva !== 'mensagens') return; // fechou/trocou de seção enquanto buscava
    setCorpoSecaoMensagens(renderModelos(modelos));
    ligarAcoesModelos();
  }

  // Aviso amigável quando o content script perdeu o vínculo com o background
  // (extensão atualizada e a aba não recarregada). Um botão que dá o reload.
  function _avisoRecarregarAba() {
    return '<div class="job-erro" style="text-align:center">' +
      'A extensão foi atualizada.<br><b>Recarregue esta aba do WhatsApp Web</b> pra voltar a funcionar.' +
      '<br><button class="job-analisar-btn" style="margin-top:12px" onclick="location.reload()">Recarregar agora</button>' +
      '</div>';
  }

  function setCorpoSecaoMensagens(html) {
    const c = document.getElementById('job-painel-doc-corpo');
    if (c) c.innerHTML = html;
  }

  // ═══════════════ Funis (sequência de disparo, estilo ZapVoice) ═══════════════
  // Um funil é uma sequência de passos (texto/áudio/imagem/PDF), cada um com um
  // intervalo. Aqui na extensão o consultor DISPARA o funil inteiro na conversa
  // aberta: manda o passo, espera o intervalo, manda o próximo — sempre uma
  // ação explícita dele numa conversa que está na tela, nunca em massa. Montar/
  // editar funis é no site (/crm/funis); aqui é só disparar. Envio de cada passo
  // reusa a MESMA ponte wa-js do envio avulso (texto e mídia do item A).
  const FUNIS_CACHE_MS = 5 * 60 * 1000;
  let _funisCache = null; // {ts, funis}
  let _funilRodando = false, _funilCancelar = false;

  async function buscarFunis(forcar) {
    // ATENÇÃO: o cache tem que devolver o MESMO formato {ok, funis} do caminho
    // fresco — já quebrou uma vez (cache devolvia o array cru, dispararFunil lia
    // res.ok, dava undefined e alertava "não tem passos" com os passos na tela).
    if (!forcar && _funisCache && (Date.now() - _funisCache.ts) < FUNIS_CACHE_MS) {
      return { ok: true, funis: _funisCache.funis };
    }
    // Devolve a resposta CRUA (não só o array) pra abrirSecaoFunis distinguir
    // "deu erro" de "não tem funil" — e nunca ficar preso no spinner.
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ type: 'listar_funis' });
    } catch (e) {
      return { ok: false, erro: 'Recarregue a aba do WhatsApp Web (a extensão foi atualizada): ' + (e && e.message || e) };
    }
    if (!resp || !resp.ok) return { ok: false, erro: (resp && resp.erro) || 'Não consegui falar com o JOB.' };
    const funis = resp.funis || [];
    _gestorModo = !!resp.gestor;
    _funisCache = { ts: Date.now(), funis };
    return { ok: true, funis };
  }

  function funilTipoIcone(tipo, px) {
    const t = ['audio', 'imagem', 'documento', 'video'].indexOf(tipo) >= 0 ? tipo : 'texto';
    return _svgIco(t, px || 13);
  }

  function fmtQuando(s) {
    s = s || 0;
    if (s <= 0) return 'imediatamente';
    const m = Math.floor(s / 60), r = s % 60;
    if (m && r) return 'após ' + m + 'min ' + r + 's';
    if (m) return 'após ' + m + 'min';
    return 'após ' + r + 's';
  }

  async function abrirSecaoFunis() {
    setCorpoSecaoMensagens('<div class="job-carregando"><div class="job-spin"></div><div>Carregando funis…</div></div>');
    let res;
    try {
      res = await buscarFunis(false);
    } catch (e) {
      res = { ok: false, erro: String(e && e.message || e) };
    }
    if (_secaoAtiva !== 'funis') return;
    if (!res || !res.ok) {
      setCorpoSecaoMensagens('<div class="job-erro">Não consegui carregar os funis.<br><span style="font-size:11px;opacity:.8">' + esc((res && res.erro) || '') + '</span></div>');
      return;
    }
    try {
      setCorpoSecaoMensagens(renderFunis(res.funis));
      ligarAcoesFunis();
    } catch (e) {
      setCorpoSecaoMensagens('<div class="job-erro">Erro ao montar a lista de funis:<br><span style="font-size:11px;opacity:.8">' + esc(String(e && e.message || e)) + '</span></div>');
    }
  }

  // Busca + "só favoritos" (padrão ZapVoice: Buscar… / Apenas favoritos).
  let _fnBusca = '', _fnSoFav = false;

  function funilPassaFiltro(f) {
    if (_fnSoFav && !f.favorito) return false;
    if (!_fnBusca) return true;
    return (f.nome || '').toLowerCase().indexOf(_fnBusca) >= 0
      || (f.categoria || '').toLowerCase().indexOf(_fnBusca) >= 0;
  }

  function renderFunis(funis) {
    return '<div class="job-biblioteca-controles">' +
        '<input class="job-inp" id="job-busca-funil" placeholder="Buscar funil…" value="' + esc(_fnBusca) + '">' +
        '<div class="job-fchips">' +
          '<button class="job-fchip ' + (_fnSoFav ? '' : 'on') + '" data-fn-fav="0">Todos</button>' +
          '<button class="job-fchip ' + (_fnSoFav ? 'on' : '') + '" data-fn-fav="1">' + _svgIco('estrela', 11) + ' Favoritos</button>' +
        '</div>' +
      '</div>' +
      '<div id="job-funis-lista">' + listaFunisHTML(funis) + '</div>' +
      '<a class="job-funis-gerenciar" href="' + esc(_SITE_BASE_URL_EXT) + '/crm/funis" target="_blank" rel="noopener">Gerenciar funis no site →</a>';
  }

  function listaFunisHTML(funis) {
    if (!funis.length) {
      return '<div class="job-vazio">Nenhum funil ainda.<br>Monte o primeiro em <b>Funis WhatsApp</b> no site do JOB.</div>';
    }
    const vis = funis.filter(funilPassaFiltro);
    if (!vis.length) return '<div class="job-vazio">Nenhum funil bate com esse filtro.</div>';
    // Gestor: pasta por consultor (recolhível), igual aos modelos. Funil é uma
    // sequência multi-tipo, então não tem sub-nível de tipo — só a pasta.
    if (!_gestorModo) return vis.map(cardFunil).join('');
    const grupos = new Map();
    vis.forEach((f) => {
      const chave = f.dono_nome || 'Compartilhado';
      if (!grupos.has(chave)) grupos.set(chave, []);
      grupos.get(chave).push(f);
    });
    let out = '';
    grupos.forEach((itens, dono) => {
      out += '<details class="job-pasta" open><summary class="job-pasta-nome">' +
        esc(dono) + ' <span>(' + itens.length + ')</span></summary>' +
        '<div class="job-pasta-conteudo">' + itens.map(cardFunil).join('') + '</div></details>';
    });
    return out;
  }

  function cardFunil(f) {
    const passos = f.passos || [];
    const totalS = passos.reduce((s, p) => s + (p.delay_segundos || 0), 0);
    const meta = passos.length
      ? passos.length + ' passo' + (passos.length > 1 ? 's' : '') + (totalS ? ' · ~' + fmtQuando(totalS).replace('após ', '') : '')
      : 'sem passos';
    // Cada passo é uma caixinha colorida pelo tipo (padrão ZapVoice): o
    // consultor bate o olho e sabe o que vai sair — áudio, imagem, texto, PDF.
    const listaPassos = passos.map((p, i) =>
      '<div class="job-fpasso t-' + esc(p.tipo || 'texto') + '">' +
        '<span class="job-fpasso-ico">' + funilTipoIcone(p.tipo, 14) + '</span>' +
        '<div class="job-fpasso-info">' +
          '<div class="job-fpasso-nome">' + esc(p.nome) + '</div>' +
          '<div class="job-fpasso-quando">' + _svgIco('relogio', 10) + ' Enviando ' + esc(fmtQuando(p.delay_segundos)) + '</div>' +
        '</div>' +
        '<span class="job-fpasso-num">' + (i + 1) + '</span>' +
      '</div>').join('');
    return '<div class="job-funil-card" data-funil-id="' + f.id + '">' +
      '<div class="job-funil-topo">' +
        '<span class="job-funil-ico">' + _svgIco('funil', 15) + '</span>' +
        '<div class="job-funil-titulo">' +
          '<div class="job-funil-nome">' + esc(f.nome) + (f.favorito ? ' <span class="job-funil-star">' + _svgIco('estrela', 11) + '</span>' : '') + '</div>' +
          '<div class="job-funil-meta">' + (f.categoria ? esc(f.categoria) + ' · ' : '') + esc(meta) + '</div>' +
        '</div>' +
        '<button class="job-funil-expandir" title="Mostrar/ocultar passos">' + _svgIco('chevron', 14) + '</button>' +
      '</div>' +
      '<div class="job-funil-passos">' + (listaPassos || '<div class="job-vazio" style="padding:8px 0 2px">Funil sem passos.</div>') + '</div>' +
      '<button class="job-funil-disparar" data-funil-id="' + f.id + '"' + (passos.length ? '' : ' disabled') + '>' +
        _ICO_ENVIAR + ' Disparar funil</button>' +
    '</div>';
  }

  const _ICO_ENVIAR = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';

  function rerenderFunisLista() {
    const c = document.getElementById('job-funis-lista');
    if (!c) return;
    c.innerHTML = listaFunisHTML(_funisCache ? _funisCache.funis : []);
    ligarAcoesListaFunis();
  }

  // Ações da LISTA (rebindadas a cada filtro/busca) separadas dos controles
  // (bindados uma vez — senão a busca perdia o foco a cada tecla).
  function ligarAcoesListaFunis() {
    document.querySelectorAll('.job-funil-expandir').forEach((btn) => {
      btn.addEventListener('click', () => {
        const card = btn.closest('.job-funil-card');
        const passos = card && card.querySelector('.job-funil-passos');
        if (!passos) return;
        passos.classList.toggle('fechado');
        btn.classList.toggle('fechado');
      });
    });
    document.querySelectorAll('.job-funil-disparar[data-funil-id]').forEach((btn) => {
      btn.addEventListener('click', () => dispararFunil(btn.dataset.funilId));
    });
  }

  function ligarAcoesFunis() {
    const busca = document.getElementById('job-busca-funil');
    if (busca) busca.addEventListener('input', () => {
      _fnBusca = (busca.value || '').trim().toLowerCase();
      rerenderFunisLista();
    });
    document.querySelectorAll('.job-fchip[data-fn-fav]').forEach((chip) => {
      chip.addEventListener('click', () => {
        _fnSoFav = chip.dataset.fnFav === '1';
        document.querySelectorAll('.job-fchip[data-fn-fav]').forEach((c) => c.classList.toggle('on', c === chip));
        rerenderFunisLista();
      });
    });
    ligarAcoesListaFunis();
  }

  // ── Toca a sequência: espera o intervalo do passo, manda, próximo. Mostra
  //    progresso passo-a-passo e deixa cancelar no meio. ──
  async function dispararFunil(funilId) {
    if (_funilRodando) { alert('Já tem um funil rodando — espere terminar ou cancele.'); return; }
    const res = await buscarFunis(false);
    // Três casos DIFERENTES, três mensagens — misturar tudo em "não tem passos"
    // já mascarou um bug real de cache.
    if (!res || !res.ok) { alert('Não consegui carregar o funil: ' + ((res && res.erro) || 'tente de novo.')); return; }
    const funil = (res.funis || []).find((f) => String(f.id) === String(funilId));
    if (!funil) { alert('Funil não encontrado — feche e abra a aba Funis pra recarregar.'); return; }
    if (!(funil.passos || []).length) { alert('Esse funil não tem passos. Adicione passos no site (Funis WhatsApp).'); return; }
    const { usuarioId } = await chrome.storage.local.get(['usuarioId']);
    if (!usuarioId) { alert('Selecione seu usuário no popup da extensão primeiro.'); return; }
    let chatId = '';
    try { chatId = await pedirChatId(); } catch (e) { chatId = ''; }
    if (!chatId) { alert('Abra a conversa do cliente antes de disparar o funil.'); return; }
    const nome = nomeDoContato() || 'este contato';
    if (!confirm('Disparar o funil "' + funil.nome + '" (' + funil.passos.length + ' passo(s)) para ' + nome + '?')) return;
    let telefone = await garantirTelefone(nome);

    _funilRodando = true; _funilCancelar = false;
    const prog = abrirProgressoFunil(funil, nome);
    let enviados = 0;
    for (let i = 0; i < funil.passos.length; i++) {
      if (_funilCancelar) break;
      const passo = funil.passos[i];
      await esperarComContagem(prog, i, Math.max(0, passo.delay_segundos || 0));
      if (_funilCancelar) break;
      marcarPasso(prog, i, 'enviando');
      let envio;
      try {
        if (passo.tipo && passo.tipo !== 'texto' && passo.midia_url) {
          const dl = await chrome.runtime.sendMessage({ type: 'baixar_midia', url: passo.midia_url });
          if (dl && dl.ok) envio = await pedirEnviarMidia(chatId, passo.tipo, dl.dataUrl, passo.texto);
          else envio = { ok: false, erro: (dl && dl.erro) || 'falha ao baixar a mídia' };
        } else {
          envio = await pedirEnviarTexto(chatId, passo.texto);
        }
      } catch (e) { envio = { ok: false, erro: String(e && e.message || e) }; }
      if (envio && envio.ok) { enviados++; marcarPasso(prog, i, 'ok'); }
      else { marcarPasso(prog, i, 'erro', (envio && envio.erro) || ''); }
    }
    _funilRodando = false;
    finalizarProgresso(prog, enviados, funil.passos.length, _funilCancelar);
    try { await chrome.runtime.sendMessage({ type: 'funil_disparado', funil_id: funil.id, telefone, enviados }); } catch (e) { /* registro é best-effort */ }
  }

  function abrirProgressoFunil(funil, nomeContato) {
    const existente = document.getElementById('job-funil-prog');
    if (existente) existente.remove();
    const linhas = funil.passos.map((p, i) =>
      '<div class="job-fp-linha" data-i="' + i + '">' +
        '<span class="job-fp-dot"></span>' +
        '<span class="job-fp-ico">' + funilTipoIcone(p.tipo) + '</span>' +
        '<span class="job-fp-nome">' + esc(p.nome) + '</span>' +
        '<span class="job-fp-estado"></span>' +
      '</div>').join('');
    const ov = document.createElement('div');
    ov.id = 'job-funil-prog';
    ov.innerHTML =
      '<div class="job-fp-card">' +
        '<div class="job-fp-head"><b>' + esc(funil.nome) + '</b><span>para ' + esc(nomeContato) + '</span></div>' +
        '<div class="job-fp-linhas">' + linhas + '</div>' +
        '<div class="job-fp-rodape">' +
          '<span class="job-fp-status" id="job-fp-status">Iniciando…</span>' +
          '<button class="job-fp-cancelar" id="job-fp-cancelar">Cancelar</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(ov);
    document.getElementById('job-fp-cancelar').addEventListener('click', () => {
      _funilCancelar = true;
      const s = document.getElementById('job-fp-status');
      if (s) s.textContent = 'Cancelando…';
    });
    return ov;
  }

  async function esperarComContagem(prog, i, segundos) {
    const linha = prog && prog.querySelector('.job-fp-linha[data-i="' + i + '"]');
    const estado = linha && linha.querySelector('.job-fp-estado');
    const status = document.getElementById('job-fp-status');
    if (linha) linha.classList.add('atual');
    let resta = segundos;
    while (resta > 0) {
      if (_funilCancelar) return;
      if (estado) estado.textContent = 'em ' + resta + 's';
      if (status) status.textContent = 'Passo ' + (i + 1) + ': aguardando ' + resta + 's';
      await new Promise((r) => setTimeout(r, 1000));
      resta--;
    }
    if (estado) estado.textContent = '';
  }

  function marcarPasso(prog, i, estado, erro) {
    const linha = prog && prog.querySelector('.job-fp-linha[data-i="' + i + '"]');
    const status = document.getElementById('job-fp-status');
    if (!linha) return;
    linha.classList.remove('atual');
    const est = linha.querySelector('.job-fp-estado');
    if (estado === 'enviando') {
      linha.classList.add('atual');
      if (est) est.textContent = 'enviando…';
      if (status) status.textContent = 'Passo ' + (i + 1) + ': enviando…';
    } else if (estado === 'ok') {
      linha.classList.add('ok');
      if (est) est.textContent = '✓';
    } else if (estado === 'erro') {
      linha.classList.add('erro');
      if (est) est.textContent = 'falhou';
      if (erro) linha.title = erro;
    }
  }

  function finalizarProgresso(prog, enviados, total, cancelado) {
    const status = document.getElementById('job-fp-status');
    const btn = document.getElementById('job-fp-cancelar');
    if (status) {
      status.textContent = cancelado
        ? ('Cancelado — ' + enviados + ' de ' + total + ' enviados.')
        : ('Concluído — ' + enviados + ' de ' + total + ' enviados.');
    }
    if (btn) { btn.textContent = 'Fechar'; btn.classList.add('job-fp-fechar');
      const novo = btn.cloneNode(true); btn.parentNode.replaceChild(novo, btn);
      novo.addEventListener('click', () => { const p = document.getElementById('job-funil-prog'); if (p) p.remove(); });
    }
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function corFaixa(faixa) {
    return { quente: '#1fd8a4', bom: '#4ade80', medio: '#facc15', baixo: '#fb923c' }[faixa] || '#f43f5e';
  }

  function linhaDado(rotulo, valor) {
    if (valor === null || valor === undefined || valor === '' ||
        (Array.isArray(valor) && !valor.length)) return '';
    const v = Array.isArray(valor) ? valor.join(', ') : String(valor);
    return '<div class="job-dado"><span>' + esc(rotulo) + '</span><b>' + esc(v) + '</b></div>';
  }

  function renderResultado(r, nome, telefone, totalMsgs) {
    const cor = corFaixa(r.faixa);
    const ex = r.extracao || {};
    const sugs = (r.sugestoes || []).map((s) => {
      const pc = s.prioridade === 'alta' ? '#f43f5e' : (s.prioridade === 'media' ? '#facc15' : '#8c93a8');
      return '<div class="job-sug"><div class="job-sug-tag" style="background:' + pc + '22;color:' + pc + '">' +
        esc(s.prioridade) + '</div><div class="job-sug-txt"><b>' + esc(s.titulo) + '</b><br>' +
        esc(s.detalhe) + '</div></div>';
    }).join('');
    // Dono do lead: avisa se já é do consultor, se está com OUTRO consultor no
    // JOB, ou pra quem o lead recém-criado foi (pedido do Guilherme, 14/07).
    // Na análise fresca o servidor manda lead_e_do_consultor resolvido pelo
    // NÚMERO do WhatsApp; ao reabrir (estado) compara com o consultor do popup.
    let ehMeu = r.lead_e_do_consultor;
    const respId = (r.lead_responsavel_id != null) ? Number(r.lead_responsavel_id) : null;
    if (ehMeu === undefined && respId != null && _usuarioIdPopup) ehMeu = (Number(_usuarioIdPopup) === respId);
    let donoLinha = '';
    if (r.lead) {
      if (r.lead_criado) {
        donoLinha = r.consultor_nome
          ? '<div class="job-lead-dono" style="font-size:11.5px;color:#1fd8a4;margin:4px 0 2px;">Atribuído a <b>' + esc(r.consultor_nome) + '</b>.</div>'
          : '<div class="job-ia-alerta">⚠ Lead criado SEM responsável — selecione seu usuário no popup da extensão (e cadastre seu telefone em Usuários no JOB).</div>';
      } else if (ehMeu === true) {
        donoLinha = '<div class="job-lead-dono" style="font-size:11.5px;color:#1fd8a4;margin:4px 0 2px;">Este lead já está no seu cadastro.</div>';
      } else if (r.lead_responsavel_nome && ehMeu === false) {
        donoLinha = '<div class="job-ia-alerta">⚠ Este lead está com OUTRO consultor no JOB: <b>' + esc(r.lead_responsavel_nome) + '</b>.</div>';
      } else if (r.lead_responsavel_nome) {
        donoLinha = '<div class="job-lead-dono" style="font-size:11.5px;color:#8c93a8;margin:4px 0 2px;">Responsável no JOB: <b>' + esc(r.lead_responsavel_nome) + '</b>.</div>';
      } else {
        donoLinha = '<div class="job-lead-dono" style="font-size:11.5px;color:#facc15;margin:4px 0 2px;">Este lead está sem responsável no JOB.</div>';
      }
    }
    const avisoConsultor = r.aviso_consultor
      ? '<div class="job-ia-alerta">⚠ ' + esc(r.aviso_consultor) + '</div>'
      : '';
    const leadBox = (r.lead
      ? '<a class="job-lead-ok" href="' + esc(r.lead.url) + '" target="_blank">' +
        (r.lead_criado ? 'Lead criado no CRM: <b>' : 'Lead no CRM: <b>') +
        esc(r.lead.nome) + '</b> — abrir ficha →</a>' + donoLinha
      : '<div class="job-lead-nao">Não consegui criar/achar o lead no CRM. ' +
        '<br><span>Telefone lido: ' + esc(telefone || '—') + '</span></div>') +
      avisoConsultor;
    const chips = '<span class="job-chip" style="border-color:' + cor + ';color:' + cor + '">' +
        esc(r.fase_funil || '') + '</span>' +
      (r.tags || []).filter((t) => t !== r.fase_funil && t !== (r.faixa || '').toUpperCase())
        .map((t) => '<span class="job-chip">' + esc(t) + '</span>').join('');
    const planoAtivo = { SEM_PLANO: 'Sem plano hoje', CANCELADO_RECENTE: 'Cancelado há pouco', ATIVO: 'Tem plano ativo' }[ex.plano_ativo];
    const tipoRot = { PJ: 'CNPJ / empresarial', ADESAO: 'Adesão (PF)', PF: 'Pessoa física' }[ex.tipo_contratacao];
    // Uma lista só de campos → gera o HTML E o texto copiável (sem drift entre
    // os dois): o Guilherme pediu pra poder copiar os dados do lead direto.
    const camposLead = [
      ['Cidade', ex.cidade],
      ['Idade(s)', ex.idades],
      ['Vidas', ex.vidas],
      ['Contratação', tipoRot],
      ['CNPJ', ex.cnpj],
      ['Plano atual', planoAtivo && (planoAtivo + (ex.operadora_atual ? ' (' + ex.operadora_atual + ')' : ''))],
      ['Operadora de interesse', ex.operadora_interesse],
      ['Plano que mais gostou', ex.plano_preferido],
      ['Urgência', ex.urgencia],
      ['Objeções', ex.objecoes],
    ];
    const temValor = (v) => !(v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length));
    const dados = camposLead.map((c) => linhaDado(c[0], c[1])).join('');
    const dadosTexto = camposLead.filter((c) => temValor(c[1]))
      .map((c) => c[0] + ': ' + (Array.isArray(c[1]) ? c[1].join(', ') : c[1])).join('\n');
    // Texto da ANÁLISE COMPLETA (um botão só copia tudo) — o Guilherme não quer
    // copiar seção por seção. Monta em texto limpo, na mesma ordem da tela.
    const acoesTxt = (r.sugestoes || [])
      .map((s) => '- [' + (s.prioridade || '') + '] ' + (s.titulo || '') + (s.detalhe ? ': ' + s.detalhe : '')).join('\n');
    const blocosCompleta = [
      'ANALISE DO LEAD — ' + (nome || telefone || ''),
      'Score: ' + (r.score != null ? r.score : '—') + '/1000' + (r.faixa ? ' (' + String(r.faixa).toUpperCase() + ')' : ''),
    ];
    if (dadosTexto) blocosCompleta.push('', 'DADOS DO LEAD', dadosTexto);
    if (r.docs_extraidos && String(r.docs_extraidos).trim()) blocosCompleta.push('', 'DADOS DOS DOCUMENTOS', String(r.docs_extraidos).trim());
    if (acoesTxt) blocosCompleta.push('', 'PROXIMAS ACOES', acoesTxt);
    if (r.followup) blocosCompleta.push('', 'FOLLOW-UP SUGERIDO', String(r.followup).trim());
    if (r.ia && r.ia.resumo) blocosCompleta.push('', 'LEITURA DA IA', String(r.ia.resumo).trim());
    const analiseCompletaTexto = blocosCompleta.join('\n');
    const pen = (r.penalidades || []).map((p) => '<span class="job-chip job-chip-pen">' +
      esc(p.regra) + ' ' + p.pontos + '</span>').join('');
    // Por que o score parou nesse teto — antes o backend calculava e mandava
    // o motivo, mas o painel nunca mostrava (consultor via um score baixo sem
    // saber o porquê, ex: "conversa parada há mais de 10 dias").
    const capBox = (r.cap && r.cap.motivo)
      ? '<div class="job-ia-alerta">🔒 Score limitado a ' + r.cap.valor + ': ' + esc(r.cap.motivo) + '</div>'
      : '';
    // Falha real de IA/transcrição (chave configurada, mas essa chamada não
    // deu certo) — diferente de "não configurado", que fica silencioso.
    const avisos = [];
    if (r.ia_falhou) avisos.push('A leitura por IA falhou nesta análise — o score seguiu só no motor de regras.');
    if (r.audios_falha) avisos.push(r.audios_falha + ' áudio(s) não puderam ser transcritos nesta análise.');
    if (r.documentos_falha) avisos.push(r.documentos_falha + ' PDF(s) da conversa não puderam ser baixados — clique em Analisar de novo pra tentar incluir.');
    const avisoFalhas = avisos.length
      ? avisos.map((a) => '<div class="job-ia-alerta">⚠ ' + esc(a) + '</div>').join('')
      : '';
    const partesRodape = [esc(nome || ''), totalMsgs + ' mensagens lidas'];
    if (r.duracao_segundos != null) partesRodape.push('levou ' + fmtDuracao(r.duracao_segundos));
    if (r.audios_do_cache) partesRodape.push(r.audios_do_cache + ' áudio(s) reaproveitados do cache');
    partesRodape.push('somente leitura');
    return (
      '<div class="job-score-wrap">' +
        '<div class="job-score-num" style="color:' + cor + '">' + (r.score != null ? r.score : '—') + '</div>' +
        '<div class="job-score-meta"><div class="job-score-faixa" style="color:' + cor + '">' +
          esc((r.faixa || '').toUpperCase()) + '</div>' +
          '<div class="job-score-sub">Score Lead · 0–1000 · ' + (r.categorias_consideradas || 0) + '/' +
          (r.categorias_totais || 28) + ' critérios</div></div>' +
      '</div>' +
      '<div class="job-barra"><div class="job-barra-fill" style="width:' + Math.round((r.score || 0) / 10) + '%;background:' + cor + '"></div></div>' +
      '<div class="job-chips">' + chips + pen + '</div>' +
      capBox +
      avisoFalhas +
      leadBox +
      '<button class="job-analisar-btn" id="job-cotar"' +
        ' data-lead="' + esc(String(r.lead ? r.lead.id : '')) + '"' +
        ' data-nome="' + esc((r.lead && r.lead.nome) || nome || '') + '"' +
        ' data-telefone="' + esc(telefone || '') + '"' +
        ' data-idades="' + esc(Array.isArray(ex.idades) ? ex.idades.join(',') : (ex.idades || '')) + '"' +
        ' style="width:100%;margin:6px 0 4px;background:#8b5cf6;">Cotar no JOB para este lead</button>' +
      '<button class="job-copy job-copy-full" id="job-analise-copy" data-texto="' + esc(analiseCompletaTexto) + '" style="width:100%;margin:4px 0 8px;">Copiar análise completa</button>' +
      (dados ? '<div class="job-sec">Dados do lead</div><div class="job-dados">' + dados + '</div>' +
        '<button class="job-copy" id="job-dados-copy" data-texto="' + esc(dadosTexto) + '">Copiar dados do lead</button>' : '') +
      '<div class="job-sec">Próximas ações</div>' +
      (sugs || '<div class="job-vazio">Sem sugestões.</div>') +
      '<div class="job-sec">Follow-up sugerido</div>' +
      '<div class="job-resumo" id="job-followup">' + esc(r.followup || '') + '</div>' +
      '<button class="job-copy" id="job-copy-btn">Copiar follow-up</button>' +
      seccaoAudios(r.transcricoes, r.audios_transcritos) +
      seccaoDocs(r.docs_extraidos, r.ia) +
      seccaoIA(r.ia) +
      '<div class="job-sec">Como está a conversa</div>' +
      '<div class="job-resumo">' + esc(r.resumo || '').replace(/\n/g, '<br>') + '</div>' +
      '<div class="job-rodape">' + partesRodape.join(' · ') + '</div>'
    );
  }

  function fmtDuracao(seg) {
    const s = Math.round(seg || 0);
    if (s < 60) return s + 's';
    return Math.floor(s / 60) + 'min ' + (s % 60) + 's';
  }

  // Bloco das transcrições de áudio — só aparece quando algum áudio foi
  // transcrito (ou seja, com OPENAI_API_KEY/GROQ_API_KEY ligada no JOB).
  function seccaoAudios(transcricoes, total) {
    const t = (transcricoes || []).filter((x) => x && x.texto);
    if (!t.length) return '';
    const linhas = t.map((x) => {
      const quem = x.de === 'lead' ? 'Cliente' : 'Consultor';
      return '<div class="job-audio-item"><span class="job-audio-quem">' + _svgIco('audio', 10) + ' ' + esc(quem) +
        (x.hora ? ' · ' + esc(String(x.hora).split(',')[0]) : '') + '</span>' +
        esc(x.texto) + '</div>';
    }).join('');
    return '<div class="job-sec">Áudios transcritos (' + (total || t.length) + ')</div>' + linhas;
  }

  // Bloco dos dados extraídos dos documentos (RG/CNH/comprovante) — no formato
  // padrão da corretora, copiável pra colar na proposta/onde precisar. Só
  // aparece quando o backend achou documento pessoal na conversa.
  function seccaoDocs(txt, ia) {
    if (txt && String(txt).trim()) {
      return '<div class="job-sec">Dados dos documentos</div>' +
        '<div class="job-resumo" id="job-docs-txt" style="white-space:pre-wrap;font-variant-numeric:tabular-nums;">' + esc(txt) + '</div>' +
        '<button class="job-copy" id="job-docs-copy" data-texto="' + esc(txt) + '">Copiar dados dos documentos</button>' +
        '<button class="job-analisar-btn" id="job-criar-proposta" style="margin-top:8px;">Fechei essa proposta — criar no JOB</button>';
    }
    // Sem dados extraídos: se a IA LEU imagens/PDFs mas não achou documento
    // pessoal, diz isso em vez de sumir (senão o consultor acha que "não
    // apareceu / é burro" sem saber o porquê). Só some de vez se não houve
    // nenhum anexo pra ler.
    const nImg = (ia && (ia.imagens_lidas || (ia.leitura_imagens || []).length)) || 0;
    const nDoc = (ia && (ia.documentos_lidos || (ia.leitura_documentos || []).length)) || 0;
    if (!nImg && !nDoc) return '';
    const partes = [];
    if (nImg) partes.push(nImg + ' imagem(ns)');
    if (nDoc) partes.push(nDoc + ' PDF(s)');
    return '<div class="job-sec">Dados dos documentos</div>' +
      '<div class="job-ia-alerta" style="color:var(--cinza);background:rgba(255,255,255,.04);border-color:var(--borda);">' +
      'A IA leu ' + partes.join(' e ') + ', mas não identificou RG/CNH/comprovante pra extrair dados de proposta. ' +
      'Se tiver documento na conversa, confira se está legível e clique em Analisar de novo.</div>';
  }

  // Bloco da leitura por IA (Claude) — só aparece quando o backend devolve `ia`
  // (ou seja, quando a ANTHROPIC_API_KEY está ligada no JOB). Sem chave, some.
  function seccaoIA(ia) {
    if (!ia) return '';
    const acoes = (ia.proximas_acoes || []).map((s) => {
      const pc = s.prioridade === 'alta' ? '#f43f5e' : (s.prioridade === 'media' ? '#facc15' : '#8c93a8');
      return '<div class="job-sug"><div class="job-sug-tag" style="background:' + pc + '22;color:' + pc + '">' +
        esc(s.prioridade) + '</div><div class="job-sug-txt"><b>' + esc(s.titulo) + '</b><br>' +
        esc(s.detalhe) + '</div></div>';
    }).join('');
    const alertas = (ia.sinais_atencao || []).length
      ? '<div class="job-ia-alertas">' + ia.sinais_atencao.map((a) =>
          '<div class="job-ia-alerta">⚠ ' + esc(a) + '</div>').join('') + '</div>'
      : '';
    const imgsLidas = (ia.leitura_imagens || []).filter(Boolean);
    const blocoImgs = imgsLidas.length
      ? '<div class="job-sec">O que a IA leu nas imagens (' + (ia.imagens_lidas || imgsLidas.length) + ')</div>' +
        imgsLidas.map((t) => '<div class="job-img-lida">' + _svgIco('imagem', 11) + ' ' + esc(t) + '</div>').join('')
      : '';
    const docsLidos = (ia.leitura_documentos || []).filter(Boolean);
    const blocoDocs = docsLidos.length
      ? '<div class="job-sec">O que a IA leu nos PDFs (' + (ia.documentos_lidos || docsLidos.length) + ')</div>' +
        docsLidos.map((t) => '<div class="job-img-lida">' + _svgIco('documento', 11) + ' ' + esc(t) + '</div>').join('')
      : '';
    return (
      '<div class="job-sec">Leitura da IA <span class="job-ia-badge">Claude</span></div>' +
      '<div class="job-resumo">' + esc(ia.resumo || '') + '</div>' +
      blocoImgs +
      blocoDocs +
      alertas +
      (acoes ? '<div class="job-sec">Próximas ações (IA)</div>' + acoes : '')
    );
  }

  function ligarBotaoCopiar() {
    const b = document.getElementById('job-copy-btn');
    if (b) {
      b.addEventListener('click', () => {
        const t = document.getElementById('job-followup');
        navigator.clipboard.writeText(t ? t.textContent : '').then(() => {
          b.textContent = 'Copiado!';
          setTimeout(() => { b.textContent = 'Copiar follow-up'; }, 1500);
        });
      });
    }
    // "Cotar no JOB para este lead": abre o multicálculo do JOB já vinculado ao
    // lead (lead_id -> a cotação salva aparece na aba Cotações da ficha do CRM)
    // e com as idades já extraídas preenchidas, pra cotar rápido da conversa.
    const bc = document.getElementById('job-cotar');
    if (bc) {
      bc.addEventListener('click', () => {
        const q = [];
        if (bc.dataset.lead) q.push('lead_id=' + encodeURIComponent(bc.dataset.lead));
        if (bc.dataset.nome) q.push('cliente_nome=' + encodeURIComponent(bc.dataset.nome));
        if (bc.dataset.telefone) q.push('cliente_telefone=' + encodeURIComponent(bc.dataset.telefone));
        if (bc.dataset.idades) q.push('idades=' + encodeURIComponent(bc.dataset.idades));
        window.open(_SITE_BASE_URL_EXT + '/cotacao' + (q.length ? '?' + q.join('&') : ''), '_blank');
      });
    }
    // Copiar a ANÁLISE COMPLETA (tudo de uma vez).
    const ba = document.getElementById('job-analise-copy');
    if (ba) {
      ba.addEventListener('click', () => {
        navigator.clipboard.writeText(ba.dataset.texto || '').then(() => {
          ba.textContent = 'Copiado!';
          setTimeout(() => { ba.textContent = 'Copiar análise completa'; }, 1500);
        });
      });
    }
    // Copiar os dados do lead (cidade, idades, vidas, CNPJ, operadora...).
    const bl = document.getElementById('job-dados-copy');
    if (bl) {
      bl.addEventListener('click', () => {
        navigator.clipboard.writeText(bl.dataset.texto || '').then(() => {
          bl.textContent = 'Copiado!';
          setTimeout(() => { bl.textContent = 'Copiar dados do lead'; }, 1500);
        });
      });
    }
    // Copiar os dados dos documentos (formato padrão da corretora).
    const bd = document.getElementById('job-docs-copy');
    if (bd) {
      bd.addEventListener('click', () => {
        navigator.clipboard.writeText(bd.dataset.texto || '').then(() => {
          bd.textContent = 'Copiado!';
          setTimeout(() => { bd.textContent = 'Copiar dados dos documentos'; }, 1500);
        });
      });
    }
    // "Fechei essa proposta — criar no JOB": abre o formulário de nova proposta
    // no site, já com o lead vinculado. (O pré-preenchimento dos dados extraídos
    // no formulário é a próxima fase.)
    const bp = document.getElementById('job-criar-proposta');
    if (bp) {
      bp.addEventListener('click', () => {
        // pega o lead_id do link "Lead no CRM" que já está na tela, se houver
        let leadId = '';
        const link = document.querySelector('.job-lead-ok[href*="crm?lead="]');
        if (link) { const m = (link.getAttribute('href') || '').match(/lead=(\d+)/); if (m) leadId = m[1]; }
        const url = _SITE_BASE_URL_EXT + '/nova-proposta' + (leadId ? ('?lead=' + leadId) : '');
        window.open(url, '_blank', 'noopener');
      });
    }
  }

  async function rodarAnalise() {
    const reqId = novoReqId();
    // Chave provisória com o telefone SÍNCRONO do DOM (telefoneDoContato) —
    // tem que bater com o que sincronizarPainelComConversa calcula na mesma
    // hora (abrirSecao('analise') já dispara a sincronização), senão a
    // primeira tela de carregamento não encontra esta entrada. O telefone de
    // verdade (via wa-js, assíncrono) só é confirmado mais abaixo, e a chave
    // é recalculada nesse ponto.
    const entrada = {
      reqId, chave: chaveConversa(telefoneDoContato(), nomeDoContato()), telefone: '', nome: nomeDoContato(),
      totalMsgs: 0, status: 'rodando', resultado: null, erro: null,
      iniciadoEm: Date.now(), statusTexto: 'Lendo a conversa…',
    };
    _analises.set(reqId, entrada);
    atualizarPilula();
    try {
      const painelRolavel = acharPainelRolavel();
      if (!painelRolavel) {
        _analises.delete(reqId);
        atualizarPilula();
        abrirSecao('analise');
        setCorpoSecao('<div class="job-erro">Abra uma conversa primeiro.</div>');
        return;
      }
      abrirSecao('analise');
      const status = (t) => {
        entrada.statusTexto = t;
        const e = document.getElementById('job-status');
        if (e) e.textContent = t;
      };

      // Leitura best-effort do nome/telefone só pra consultar o modo incremental
      // — logo depois de abrir o painel, o cabeçalho às vezes ainda não
      // renderizou (regressão real: isso já mandou nome vazio pro backend,
      // derrubando a criação automática do lead). Por isso o valor que REALMENTE
      // importa é lido de novo depois do carregarHistorico, quando o DOM já
      // estabilizou — igual sempre foi antes do modo incremental existir.
      const nomeInicial = nomeDoContato();
      let telefoneInicial = '';
      try { telefoneInicial = (await pedirTelefoneWpp()) || telefoneDoContato(); }
      catch (e) { telefoneInicial = telefoneDoContato(); }

      // Modo incremental: pergunta pro JOB se essa conversa já foi analisada
      // antes. Se sim, só precisa rolar até a última mensagem já conhecida —
      // não o histórico inteiro de novo. Mais rápido e mais barato. Se der
      // qualquer erro na consulta (ou não deu pra ler o telefone ainda),
      // segue sem marca d'água (lê tudo, como sempre foi).
      let watermark = null;
      if (telefoneInicial) {
        try {
          const est = await chrome.runtime.sendMessage({ type: 'estado', telefone: telefoneInicial });
          if (est && est.ok && est.existe) watermark = est.ultima_hora || null;
        } catch (e) { /* segue sem marca d'água */ }
      }

      await carregarHistorico(painelRolavel, status, watermark);
      if (_cancelados.has(reqId)) return;
      status('Organizando as mensagens…');
      const nome = nomeDoContato() || nomeInicial;
      let telefone = '';
      try { telefone = (await pedirTelefoneWpp()) || telefoneDoContato() || telefoneInicial; }
      catch (e) { telefone = telefoneDoContato() || telefoneInicial; }
      entrada.nome = nome;
      entrada.telefone = telefone;
      entrada.chave = chaveConversa(telefone, nome);
      const mensagens = dedup(rasparMensagensVisiveis());

      // Áudio/PDF/imagem NÃO usam a marca d'água do modo incremental —
      // já tentamos (pra economizar retranscrição) e era arriscado demais:
      // um áudio que ficasse de fora do teto numa rodada anterior (ou que
      // não tivesse sido transcrito por falta de chave configurada na hora)
      // ficava escondido PRA SEMPRE. Sempre relê o conjunto atual (com
      // prioridade lead+recente) — o custo de ocasionalmente re-transcrever
      // é bem menor que o risco de perder informação real do cliente.
      let imagens = [];
      try { imagens = await rasparImagensVisiveis(status); } catch (e) { imagens = []; }

      status('Baixando e transcrevendo áudios…');
      let audios = [];
      try { audios = await pedirAudios(12); } catch (e) { audios = []; }

      status('Baixando documentos PDF…');
      let documentos = [];
      let documentosEncontrados = 0;
      try {
        const rd = await pedirDocumentos(5);
        documentos = rd.documentos || [];
        documentosEncontrados = rd.encontrados || documentos.length;
      } catch (e) { documentos = []; }

      let links = [];
      try { links = rasparLinks(); } catch (e) { links = []; }

      if (_cancelados.has(reqId)) return;
      entrada.totalMsgs = mensagens.length;

      if (!mensagens.length && !imagens.length && !audios.length && !documentos.length && !links.length) {
        _analises.delete(reqId);
        atualizarPilula();
        setCorpoSecao('<div class="job-erro">Não achei mensagens, imagens, áudios, documentos nem links nesta conversa.</div>');
        return;
      }

      const extras = [];
      if (imagens.length) extras.push(imagens.length + ' imagem(ns)');
      if (audios.length) extras.push(audios.length + ' áudio(s)');
      if (documentos.length) extras.push(documentos.length + ' documento(s)');
      if (links.length) extras.push(links.length + ' link(s)');
      status(extras.length ? 'Analisando conversa + ' + extras.join(' + ') + ' no JOB…'
                           : 'Calculando o score no JOB…');
      // A PARTIR DAQUI a raspagem já terminou — dá pra trocar de conversa
      // sem prejuízo, o resto é só esperar a resposta de rede do JOB.
      // chrome.storage.local — nunca sync (limite de 8KB por item).
      const { usuarioId } = await chrome.storage.local.get(['usuarioId']);
      // Número do WhatsApp logado — o JOB atribui o lead pelo NÚMERO (quem está
      // de fato na conversa); o consultor do popup vira fallback.
      let meuNumero = '';
      try { meuNumero = await pedirMeuNumero(); } catch (e) { /* segue sem */ }
      const resp = await chrome.runtime.sendMessage({
        type: 'analisar', reqId,
        payload: { telefone, nome, mensagens, imagens, audios, documentos, links,
                   usuario_id: usuarioId || null, whatsapp_consultor: meuNumero || null,
                   documentos_encontrados: documentosEncontrados }
      });

      // Se o usuário cancelou enquanto a resposta ainda estava a caminho, não
      // sobrescreve o status 'cancelado' já aplicado por cancelarAnalise().
      if (entrada.status !== 'rodando') return;

      if (!resp || !resp.ok) {
        entrada.status = 'erro';
        entrada.erro = (resp && resp.erro) || 'Falha ao analisar';
      } else {
        entrada.status = 'ok';
        entrada.resultado = resp;
      }
      atualizarPilula();
      notificarConclusao(entrada);
      sincronizarPainelComConversa();
    } catch (e) {
      if (entrada.status === 'rodando') {
        entrada.status = 'erro';
        entrada.erro = 'Erro inesperado: ' + e.message;
        atualizarPilula();
        notificarConclusao(entrada);
        sincronizarPainelComConversa();
      }
    }
  }

  // ── Mantém o trilho presente mesmo com o WhatsApp recriando a tela (SPA). ──
  // carregarPreferenciaLado() é assíncrona (lê chrome.storage) — espera ela
  // resolver ANTES de criar o trilho (e antes de ligar o observer, que
  // recria o trilho se ele sumir), senão o trilho nasce no lado padrão
  // ('direita') e pula pro lado configurado um instante depois, toda vez que
  // o Chrome descarta a aba em segundo plano e recarrega o content script.
  carregarPreferenciaLado().then(() => {
    criarTrilho();
    const obs = new MutationObserver(() => {
      if (!document.getElementById('job-trilho')) criarTrilho();
    });
    obs.observe(document.body, { childList: true, subtree: false });
    verificarVersaoExtensao();
  });

  // ── Aviso de versão nova ──────────────────────────────────────────────────
  // Pergunta ao JOB qual é a versão mais nova da extensão. Se a que está rodando
  // aqui estiver atrás, mostra um balão fixo com o passo a passo pra atualizar.
  // Quem instalou pela Chrome Web Store atualiza sozinho (o Chrome faz em algumas
  // horas) — o balão só ajuda a apressar (fechar/reabrir o WhatsApp). Fica pendurado
  // até a versão bater; some sozinho quando o consultor já atualizou.
  function _cmpVersao(a, b) {
    const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pa[i] || 0) - (pb[i] || 0);
      if (d !== 0) return d < 0 ? -1 : 1;
    }
    return 0;
  }

  async function verificarVersaoExtensao() {
    let minha = '';
    try { minha = chrome.runtime.getManifest().version; } catch (e) { return; }
    let nova = '';
    try {
      const r = await fetch(_SITE_BASE_URL_EXT + '/api/whatsapp/versao', { cache: 'no-store' });
      const j = await r.json();
      nova = (j && j.versao) || '';
    } catch (e) { return; } // sem internet/JOB fora do ar: não incomoda
    if (!nova || _cmpVersao(minha, nova) >= 0) {
      const b = document.getElementById('job-aviso-versao');
      if (b) b.remove();
      return; // já está na mais nova (ou mais nova ainda, em dev)
    }
    mostrarAvisoVersao(minha, nova);
  }

  function mostrarAvisoVersao(minha, nova) {
    if (document.getElementById('job-aviso-versao')) return;
    const box = document.createElement('div');
    box.id = 'job-aviso-versao';
    box.innerHTML =
      '<div class="job-aviso-versao-topo">' +
        '<b>Atualização da extensão JOB</b>' +
        '<button class="job-aviso-versao-x" title="Depois">×</button>' +
      '</div>' +
      '<div class="job-aviso-versao-corpo">' +
        'Saiu a versão <b>' + nova + '</b> (você está na ' + minha + '). Para atualizar agora:' +
        '<ol>' +
          '<li>Feche <b>todas</b> as abas do WhatsApp Web.</li>' +
          '<li>Abra o WhatsApp Web de novo.</li>' +
        '</ol>' +
        '<div class="job-aviso-versao-nota">O Chrome atualiza sozinho em algumas horas — esses passos só apressam.</div>' +
      '</div>';
    document.body.appendChild(box);
    box.querySelector('.job-aviso-versao-x').addEventListener('click', () => box.remove());
    // Se a aba ficar aberta muito tempo, re-checa de hora em hora (o Chrome pode
    // ter atualizado em segundo plano — aí o balão some no próximo criarTrilho).
    setTimeout(verificarVersaoExtensao, 60 * 60 * 1000);
  }

  // ── Detecta troca de conversa (o WhatsApp Web é uma SPA — não navega, só
  //    troca o conteúdo — não existe evento nativo confiável pra "conversa
  //    trocou", então compara periodicamente). Só re-renderiza o painel quando
  //    a chave realmente muda, pra não piscar a cada tick. ──
  let _ultimaChaveVista = null;
  setInterval(() => {
    const chaveAgora = chaveConversa(telefoneDoContato(), nomeDoContato());
    if (chaveAgora === _ultimaChaveVista) return;
    _ultimaChaveVista = chaveAgora;
    sincronizarPainelComConversa();
  }, 1500);

  // ═══════════════ Fila de envio (Fase 1) ═══════════════
  // A cada ~20s pergunta ao JOB se tem alguma mensagem pra mandar (só se a
  // extensão estiver configurada). O QUE mandar e QUANDO foi decidido pelo
  // consultor lá no CRM — este loop só busca e executa, não decide nada.
  // O limite de ritmo de verdade mora no servidor (/api/whatsapp/fila/proximo);
  // o mutex aqui só evita duas consultas se sobrepondo na MESMA aba.
  let _filaOcupada = false;
  async function checarFilaDeEnvio() {
    if (_filaOcupada) return;
    const { extKey, usuarioId } = await chrome.storage.local.get(['extKey', 'usuarioId']);
    if (!extKey || !usuarioId) return;
    _filaOcupada = true;
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'fila_proximo', usuario_id: usuarioId });
      const item = resp && resp.ok && resp.item;
      if (!item) return;
      let envio;
      if (item.tipo && item.tipo !== 'texto' && item.midia_url) {
        // Mídia: o background baixa (CSP), a ponte manda pela wa-js.
        const dl = await chrome.runtime.sendMessage({ type: 'baixar_midia', url: item.midia_url });
        if (dl && dl.ok) {
          envio = await pedirEnviarMidia(item.chat_id, item.tipo, dl.dataUrl, item.texto);
        } else {
          envio = { ok: false, erro: (dl && dl.erro) || 'falha ao baixar a mídia' };
        }
      } else {
        envio = await pedirEnviarTexto(item.chat_id, item.texto);
      }
      await chrome.runtime.sendMessage({
        type: 'fila_confirmar', fila_id: item.id,
        ok: !!(envio && envio.ok), erro: (envio && envio.erro) || null,
        wpp_msg_id: (envio && envio.wpp_msg_id) || null,
      });
    } catch (e) { /* próxima rodada tenta de novo */ }
    finally { _filaOcupada = false; }
  }
  setInterval(checarFilaDeEnvio, 20000);

  // ═══════════════ Campanha (Fase 2): vigília de resposta + limpeza ═══════════════
  // Vigia os números que ESTE consultor disparou numa campanha: quando um deles
  // responde, avisa o JOB (o lead fica quente). Os que não respondem no prazo o
  // JOB marca como 'sem_resposta' e a extensão oferece apagar a conversa — sempre
  // com o consultor clicando, nunca automático (é irreversível no WhatsApp).
  const _campWatch = new Map();  // chatId -> { telefone, contato_id }
  let _campExcluir = [];         // [{ chat_id, telefone, contato_id }]

  function pedirApagarConversa(chatId) {
    return new Promise((resolve) => {
      const reqId = 'x' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      let pronto = false;
      function onMsg(ev) {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.source !== 'JOB_EXT_RESP' || d.reqId !== reqId) return;
        pronto = true; window.removeEventListener('message', onMsg); resolve(d);
      }
      window.addEventListener('message', onMsg);
      window.postMessage({ source: 'JOB_EXT_REQ', tipo: 'apagar_conversa', reqId, chatId }, '*');
      setTimeout(() => { if (!pronto) { window.removeEventListener('message', onMsg); resolve({ erro: 'timeout' }); } }, 15000);
    });
  }

  // A ponte avisa quando ENTRA uma mensagem (só o chatId). Se for de um número em
  // vigília, reporta a resposta ao JOB e tira da vigília.
  window.addEventListener('message', async (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== 'JOB_EXT_EVT' || d.tipo !== 'inbound' || !d.chatId) return;
    const alvo = _campWatch.get(d.chatId);
    if (!alvo) return;
    _campWatch.delete(d.chatId);
    try {
      const { usuarioId } = await chrome.storage.local.get(['usuarioId']);
      await chrome.runtime.sendMessage({ type: 'campanha_resposta', telefone: alvo.telefone, usuario_id: usuarioId });
    } catch (e) { /* próxima varredura reconcilia */ }
  });

  async function checarCampanhaAguardando() {
    const { extKey, usuarioId } = await chrome.storage.local.get(['extKey', 'usuarioId']);
    if (!extKey || !usuarioId) return;
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ type: 'campanha_aguardando', usuario_id: usuarioId });
    } catch (e) { return; }
    if (!resp || !resp.ok) return;
    _campWatch.clear();
    (resp.aguardando || []).forEach((a) => {
      if (a.chat_id) _campWatch.set(a.chat_id, { telefone: a.telefone, contato_id: a.contato_id });
    });
    _campExcluir = (resp.excluir || []).filter((e) => e.chat_id);
    if (_campExcluir.length) mostrarAvisoLimpeza(_campExcluir.length);
    else { const b = document.getElementById('job-aviso-limpeza'); if (b) b.remove(); }
  }
  setTimeout(checarCampanhaAguardando, 8000);
  setInterval(checarCampanhaAguardando, 90000);

  function mostrarAvisoLimpeza(qtd) {
    let box = document.getElementById('job-aviso-limpeza');
    if (box) { const q = box.querySelector('.job-limpeza-qtd'); if (q) q.textContent = qtd; return; }
    box = document.createElement('div');
    box.id = 'job-aviso-limpeza';
    box.innerHTML =
      '<div class="job-aviso-versao-topo"><b>Campanha — sem resposta</b>' +
        '<button class="job-aviso-versao-x" title="Depois">×</button></div>' +
      '<div class="job-aviso-versao-corpo"><span class="job-limpeza-qtd">' + qtd + '</span> conversa(s) sem resposta no prazo. Apagar essas conversas do seu WhatsApp?' +
        '<div style="margin-top:10px;"><button class="job-analisar-btn" id="job-limpar-btn">Apagar conversas</button></div>' +
        '<div class="job-aviso-versao-nota">Só apaga quem não respondeu. Ação irreversível.</div></div>';
    document.body.appendChild(box);
    box.querySelector('.job-aviso-versao-x').addEventListener('click', () => box.remove());
    box.querySelector('#job-limpar-btn').addEventListener('click', limparSemResposta);
  }

  async function limparSemResposta() {
    if (!_campExcluir.length) return;
    if (!confirm('Apagar ' + _campExcluir.length + ' conversa(s) sem resposta do seu WhatsApp? Isso não tem desfazer.')) return;
    const { usuarioId } = await chrome.storage.local.get(['usuarioId']);
    const btn = document.getElementById('job-limpar-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Apagando...'; }
    for (const e of _campExcluir.slice()) {
      const r = await pedirApagarConversa(e.chat_id);
      if (r && r.ok) {
        try { await chrome.runtime.sendMessage({ type: 'campanha_excluir', contato_id: e.contato_id, telefone: e.telefone, usuario_id: usuarioId }); } catch (x) { /* reconcilia depois */ }
      }
    }
    _campExcluir = [];
    const box = document.getElementById('job-aviso-limpeza'); if (box) box.remove();
  }

  // Trocou o consultor (ou chave/URL) no popup → joga fora o cache das listas,
  // senão a biblioteca/funis do consultor anterior ficam na tela por até 5 min.
  try {
    chrome.storage.onChanged.addListener((mud, area) => {
      if (area !== 'local') return;
      if (mud.usuarioId || mud.extKey || mud.jobUrl) {
        _modelosCache = null;
        _funisCache = null;
        if (_secaoAtiva === 'mensagens') abrirSecaoMensagens();
        else if (_secaoAtiva === 'funis') abrirSecaoFunis();
      }
    });
  } catch (e) { /* sem storage, sem cache pra limpar */ }
})();
