// ─── JOB Serenus · Content Script (WhatsApp Web) ────────────────────────────
//
//  ⚠️  GARANTIA DE SEGURANÇA — LEIA ANTES DE MEXER:
//  Este script é 100% LEITURA. Ele:
//    • lê a conversa que JÁ ESTÁ na tela (a sessão que VOCÊ abriu);
//    • rola o histórico pra cima devagar, como um humano, pra carregar mais;
//    • injeta um botão e um painel próprios na página.
//  Ele NUNCA:
//    • digita no campo de mensagem, clica em "enviar", nem manda nada;
//    • abre conexão de protocolo / API do WhatsApp;
//    • faz qualquer ação em massa ou automática de envio.
//  Ler o DOM da sua própria sessão é o mesmo que você lendo com os olhos —
//  é o caminho de MENOR risco possível de banir o número. Não adicione envio aqui.
//
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';
  if (window.__jobSerenusCarregado) return;
  window.__jobSerenusCarregado = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    const dataUrl = cv.toDataURL('image/jpeg', 0.85);
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
        resolve(d.documentos || []);
      }
      window.addEventListener('message', onMsg);
      window.postMessage({ source: 'JOB_EXT_REQ', tipo: 'baixar_documentos', reqId, limite }, '*');
      setTimeout(() => {
        if (!pronto) { window.removeEventListener('message', onMsg); resolve([]); }
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

  // ═══════════════ UI: botão + painel ═══════════════

  function criarBotao() {
    if (document.getElementById('job-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'job-btn';
    btn.title = 'Analisar esta conversa no JOB (somente leitura)';
    btn.innerHTML = '<span class="job-btn-j">JOB</span><span class="job-btn-txt">Analisar lead</span>';
    btn.addEventListener('click', rodarAnalise);
    document.body.appendChild(btn);
  }

  function fecharPainel() {
    const p = document.getElementById('job-painel');
    if (p) p.remove();
  }

  function minimizarPainel(ev) {
    if (ev) ev.stopPropagation();
    const p = document.getElementById('job-painel');
    if (p) p.classList.add('job-painel-min-ativo');
  }

  function restaurarPainel() {
    const p = document.getElementById('job-painel');
    if (p && p.classList.contains('job-painel-min-ativo')) p.classList.remove('job-painel-min-ativo');
  }

  function abrirPainel(conteudoHTML) {
    fecharPainel();
    const p = document.createElement('div');
    p.id = 'job-painel';
    p.innerHTML =
      '<div class="job-painel-topo"><span class="job-painel-titulo">JOB · Análise do lead</span>' +
      '<button class="job-painel-min" id="job-painel-min" title="Minimizar (continua rodando)">–</button>' +
      '<button class="job-painel-x" id="job-painel-x">×</button></div>' +
      '<div class="job-painel-corpo" id="job-painel-corpo">' + conteudoHTML + '</div>';
    document.body.appendChild(p);
    document.getElementById('job-painel-x').addEventListener('click', (ev) => { ev.stopPropagation(); fecharPainel(); });
    document.getElementById('job-painel-min').addEventListener('click', minimizarPainel);
    p.querySelector('.job-painel-topo').addEventListener('click', restaurarPainel);
    const cancelBtn = document.getElementById('job-cancelar-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => cancelarAnalise(cancelBtn.dataset.reqid));
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
    let pill = document.getElementById('job-pilula');
    if (!rodando.length) { if (pill) pill.remove(); return; }
    if (!pill) {
      pill = document.createElement('div');
      pill.id = 'job-pilula';
      pill.addEventListener('click', () => {
        const lista = [..._analises.values()].filter((a) => a.status === 'rodando')
          .map((a) => (a.nome || a.telefone || 'Lead') + ' — ' + fmtDuracao((Date.now() - a.iniciadoEm) / 1000))
          .join('\n');
        alert('Analisando agora:\n\n' + lista);
      });
      document.body.appendChild(pill);
    }
    pill.textContent = '🔄 ' + rodando.length + (rodando.length === 1 ? ' análise em andamento' : ' análises em andamento');
  }

  function telaCarregando(reqId, texto) {
    return '<div class="job-carregando"><div class="job-spin"></div><div id="job-status">' + esc(texto) + '</div></div>' +
      '<button class="job-cancelar" id="job-cancelar-btn" data-reqid="' + esc(reqId) + '">Cancelar análise</button>';
  }

  // Chama de novo o painel certo quando o consultor troca de conversa — nunca
  // deixa a análise do cliente anterior "grudada" na tela do cliente novo. Se
  // não tiver análise pra conversa atual, fecha o painel (fica só o botão).
  function sincronizarPainelComConversa() {
    const chaveAtual = chaveConversa(telefoneDoContato(), nomeDoContato());
    const doConversaAtual = [..._analises.values()]
      .filter((a) => a.chave === chaveAtual)
      .sort((a, b) => b.iniciadoEm - a.iniciadoEm)[0];
    if (!doConversaAtual) { fecharPainel(); return; }
    if (doConversaAtual.status === 'rodando') {
      abrirPainel(telaCarregando(doConversaAtual.reqId, doConversaAtual.statusTexto || 'Analisando…'));
    } else if (doConversaAtual.status === 'ok') {
      abrirPainel('');
      setCorpo(renderResultado(doConversaAtual.resultado, doConversaAtual.nome, doConversaAtual.telefone, doConversaAtual.totalMsgs));
      ligarBotaoCopiar();
    } else if (doConversaAtual.status === 'erro') {
      abrirPainel('<div class="job-erro">' + esc(doConversaAtual.erro || 'Falha ao analisar') + '</div>');
    } else if (doConversaAtual.status === 'cancelado') {
      abrirPainel('<div class="job-erro">Análise cancelada.</div>');
    }
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

  function setCorpo(html) {
    const c = document.getElementById('job-painel-corpo');
    if (c) c.innerHTML = html;
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
    const leadBox = r.lead
      ? '<a class="job-lead-ok" href="' + esc(r.lead.url) + '" target="_blank">' +
        (r.lead_criado ? 'Lead criado no CRM: <b>' : 'Lead no CRM: <b>') +
        esc(r.lead.nome) + '</b> — abrir ficha →</a>'
      : '<div class="job-lead-nao">Não consegui criar/achar o lead no CRM. ' +
        '<br><span>Telefone lido: ' + esc(telefone || '—') + '</span></div>';
    const chips = '<span class="job-chip" style="border-color:' + cor + ';color:' + cor + '">' +
        esc(r.fase_funil || '') + '</span>' +
      (r.tags || []).filter((t) => t !== r.fase_funil && t !== (r.faixa || '').toUpperCase())
        .map((t) => '<span class="job-chip">' + esc(t) + '</span>').join('');
    const planoAtivo = { SEM_PLANO: 'Sem plano hoje', CANCELADO_RECENTE: 'Cancelado há pouco', ATIVO: 'Tem plano ativo' }[ex.plano_ativo];
    const tipoRot = { PJ: 'CNPJ / empresarial', ADESAO: 'Adesão (PF)', PF: 'Pessoa física' }[ex.tipo_contratacao];
    const dados =
      linhaDado('Cidade', ex.cidade) +
      linhaDado('Idade(s)', ex.idades) +
      linhaDado('Vidas', ex.vidas) +
      linhaDado('Contratação', tipoRot) +
      linhaDado('CNPJ', ex.cnpj) +
      linhaDado('Plano atual', planoAtivo && (planoAtivo + (ex.operadora_atual ? ' (' + ex.operadora_atual + ')' : ''))) +
      linhaDado('Operadora de interesse', ex.operadora_interesse) +
      linhaDado('Plano que mais gostou', ex.plano_preferido) +
      linhaDado('Urgência', ex.urgencia) +
      linhaDado('Objeções', ex.objecoes);
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
      (dados ? '<div class="job-sec">Dados do lead</div><div class="job-dados">' + dados + '</div>' : '') +
      '<div class="job-sec">Próximas ações</div>' +
      (sugs || '<div class="job-vazio">Sem sugestões.</div>') +
      '<div class="job-sec">Follow-up sugerido</div>' +
      '<div class="job-resumo" id="job-followup">' + esc(r.followup || '') + '</div>' +
      '<button class="job-copy" id="job-copy-btn">Copiar follow-up</button>' +
      seccaoAudios(r.transcricoes, r.audios_transcritos) +
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
      return '<div class="job-audio-item"><span class="job-audio-quem">🎤 ' + esc(quem) +
        (x.hora ? ' · ' + esc(String(x.hora).split(',')[0]) : '') + '</span>' +
        esc(x.texto) + '</div>';
    }).join('');
    return '<div class="job-sec">Áudios transcritos (' + (total || t.length) + ')</div>' + linhas;
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
        imgsLidas.map((t) => '<div class="job-img-lida">🖼 ' + esc(t) + '</div>').join('')
      : '';
    const docsLidos = (ia.leitura_documentos || []).filter(Boolean);
    const blocoDocs = docsLidos.length
      ? '<div class="job-sec">O que a IA leu nos PDFs (' + (ia.documentos_lidos || docsLidos.length) + ')</div>' +
        docsLidos.map((t) => '<div class="job-img-lida">📄 ' + esc(t) + '</div>').join('')
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
    if (!b) return;
    b.addEventListener('click', () => {
      const t = document.getElementById('job-followup');
      navigator.clipboard.writeText(t ? t.textContent : '').then(() => {
        b.textContent = 'Copiado!';
        setTimeout(() => { b.textContent = 'Copiar follow-up'; }, 1500);
      });
    });
  }

  async function rodarAnalise() {
    const btn = document.getElementById('job-btn');
    const reqId = novoReqId();
    // Chave provisória (nome/telefone ainda não confirmados) — atualizada assim
    // que der pra ler direito, mais abaixo. Registra já pra pílula/cancelar
    // funcionarem desde a primeira tela de carregamento.
    const entrada = {
      reqId, chave: chaveConversa('', nomeDoContato()), telefone: '', nome: nomeDoContato(),
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
        abrirPainel('<div class="job-erro">Abra uma conversa primeiro.</div>');
        return;
      }
      abrirPainel(telaCarregando(reqId, entrada.statusTexto));
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
      try { documentos = await pedirDocumentos(5); } catch (e) { documentos = []; }

      let links = [];
      try { links = rasparLinks(); } catch (e) { links = []; }

      if (_cancelados.has(reqId)) return;
      entrada.totalMsgs = mensagens.length;

      if (!mensagens.length && !imagens.length && !audios.length && !documentos.length && !links.length) {
        _analises.delete(reqId);
        atualizarPilula();
        abrirPainel('<div class="job-erro">Não achei mensagens, imagens, áudios, documentos nem links nesta conversa.</div>');
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
      const resp = await chrome.runtime.sendMessage({
        type: 'analisar', reqId,
        payload: { telefone, nome, mensagens, imagens, audios, documentos, links, usuario_id: usuarioId || null }
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
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ── Mantém o botão presente mesmo com o WhatsApp recriando a tela (SPA). ──
  criarBotao();
  const obs = new MutationObserver(() => { if (!document.getElementById('job-btn')) criarBotao(); });
  obs.observe(document.body, { childList: true, subtree: false });

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
})();
