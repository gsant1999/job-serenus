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

  // ── Botão "Desligar extensão" no popup: liga extensaoAtiva=false e a
  //    extensão simplesmente não injeta nada nessa aba (nenhum painel, ícone,
  //    polling) — pedido do Guilherme, 18/07. Precisa de F5 pra reativar (ou
  //    já nasce desligada se você abrir o WhatsApp com o toggle apagado). ──
  chrome.storage.local.get(['extensaoAtiva']).then((c) => {
    if (c && c.extensaoAtiva === false) {
      window.__jobSerenusCarregado = false;
      console.log('[JOB Serenus] extensão desligada nas configurações do popup — nada foi injetado nesta aba.');
      return;
    }
    _bootJobSerenus();
  }).catch(() => _bootJobSerenus()); // sem storage acessível: não trava o consultor, liga normal

  function _bootJobSerenus() {

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // A wa-js volta a carregar junto com o resto, pelo manifesto.
  //
  // Eu tinha passado a injeta-la DEPOIS que o WhatsApp abre, pra tirar meio
  // segundo de compilacao do caminho da inicializacao. Ganho real, e eu avisei
  // que nao conseguia testar dentro do WhatsApp — o Guilherme testou: a tela
  // ficava EM BRANCO ao voltar pra aba. Carregar a wa-js com o app ja rodando
  // mexe no carregador de modulos dele em hora ruim.
  //
  // Fica registrado pra ninguem tentar de novo achando que e otimizacao de
  // graca: WhatsApp em branco custa o dia do consultor; meio segundo na
  // abertura custa meio segundo.

  // Base do site do JOB — pro link "Gerenciar funis no site". Padrão é produção;
  // se o popup configurou outra URL (jobUrl), hidrata daqui pra respeitar.
  let _SITE_BASE_URL_EXT = 'https://job-serenus-production.up.railway.app';
  try {
    chrome.storage.local.get(['jobUrl']).then((c) => {
      if (c && c.jobUrl) _SITE_BASE_URL_EXT = String(c.jobUrl).replace(/\/+$/, '');
    });
  } catch (e) { /* mantém o padrão de produção */ }

  // ── Pastas (Funis/Mensagens) começam FECHADAS por padrão — só abrem se o
  //    próprio consultor abrir, e aí lembra (mesmo depois de F5) — pedido do
  //    Guilherme, 18/07: "mantenha as pastas sempre fechadas a não ser que o
  //    usuário abra a dele". ──
  let _pastasAbertas = new Set();
  try {
    chrome.storage.local.get(['pastasAbertas']).then((c) => {
      _pastasAbertas = new Set(c && c.pastasAbertas || []);
    });
  } catch (e) { /* começa fechado se falhar */ }
  function _pastaAberta(key) { return _pastasAbertas.has(key); }
  document.addEventListener('toggle', (e) => {
    const el = e.target;
    if (!el || !el.classList || !(el.classList.contains('job-pasta') || el.classList.contains('job-subpasta'))) return;
    const key = el.dataset.pastaKey;
    if (!key) return;
    if (el.open) _pastasAbertas.add(key); else _pastasAbertas.delete(key);
    try { chrome.storage.local.set({ pastasAbertas: [..._pastasAbertas] }); } catch (e2) { /* best-effort */ }
  }, true); // toggle não borbulha — precisa capture

  // ── Reporta erros JS pro JOB (visibilidade de bug em produção — antes só
  //    ficávamos sabendo se o consultor reclamasse). Deduplica por mensagem
  //    (não manda a mesma falha 50x) e limita a 15 reports por sessão da aba
  //    (nunca vira flood se algo entrar em loop de erro). ──
  const _errosReportados = new Set();
  let _errosContagem = 0;
  function _reportarErro(mensagem, stack) {
    if (!mensagem || _errosContagem >= 15) return;
    if (_ehContextoInvalidado(mensagem)) { _marcarContextoMorto(); return; } // benigno: F5 resolve, não é bug
    const chave = String(mensagem).slice(0, 200);
    if (_errosReportados.has(chave)) return;
    _errosReportados.add(chave); _errosContagem++;
    chrome.storage.local.get(['usuarioId']).then(({ usuarioId }) => {
      try {
        chrome.runtime.sendMessage({
          type: 'erro_log', usuario_id: usuarioId, mensagem: String(mensagem).slice(0, 2000),
          stack: String(stack || '').slice(0, 4000), url: location.href,
          versao: (chrome.runtime.getManifest() || {}).version || '',
        });
      } catch (e) { /* best-effort, nunca deixa um erro virar outro erro */ }
    }).catch(() => {});
  }
  window.addEventListener('error', (e) => {
    if (e && _ehContextoInvalidado(e.message || (e.error && e.error.message))) { _marcarContextoMorto(); return; }
    if (e && e.filename && /content\.js|wpp-bridge\.js/.test(e.filename)) {
      _reportarErro(e.message, e.error && e.error.stack);
    }
  });
  window.addEventListener('unhandledrejection', (e) => {
    const msg = e && e.reason && (e.reason.message || String(e.reason));
    if (_ehContextoInvalidado(msg)) { _marcarContextoMorto(); return; }
    // Sem filtro de origem aqui (rejection não expõe filename) — só reporta
    // se parecer coisa nossa (menciona job/wpp) pra não poluir com erro do
    // próprio WhatsApp Web.
    if (msg && /job|wpp|__jobwppbridge/i.test(msg)) _reportarErro(msg, e.reason && e.reason.stack);
  });

  // ═══════════════ CONTEXTO INVALIDADO (extensão atualizada c/ a aba aberta) ═══
  // Quando a extensão é recarregada/atualizada e ESTA aba não deu F5, o script
  // fica órfão: chrome.runtime.id vira undefined e qualquer chrome.* lança
  // "Extension context invalidated". Isso é BENIGNO (só precisa de F5), mas os
  // ~7 loops de polling relançavam o erro a cada tick (banner reaparecendo sem
  // parar). Aqui: detecta uma vez, PARA todos os loops e mostra UM aviso
  // amigável — sem banner vermelho de "erro", sem reportar ao servidor.
  let _contextoMorto = false;
  const _idsLoops = [];
  function _registrarLoop(id) { _idsLoops.push(id); return id; }
  function _contextoValido() {
    try { return !!(chrome.runtime && chrome.runtime.id); } catch (e) { return false; }
  }
  function _ehContextoInvalidado(e) {
    const m = String((e && e.message) || e || '');
    return /Extension context invalidated|context invalidated|CONTEXTO_INVALIDO/i.test(m);
  }
  function _pararLoops() {
    _idsLoops.forEach((id) => { try { clearInterval(id); } catch (e) {} });
    _idsLoops.length = 0;
  }
  let _avisoContextoMostrado = false;
  function _mostrarAvisoRecarregarGlobal() {
    if (_avisoContextoMostrado) return; _avisoContextoMostrado = true;
    try {
      if (document.getElementById('job-aviso-contexto')) return;
      const d = document.createElement('div');
      d.id = 'job-aviso-contexto';
      d.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#f43f5e;color:#fff;padding:9px 14px;font:13px -apple-system,sans-serif;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.35)';
      d.innerHTML = 'A extensão JOB foi atualizada. <b>Recarregue esta aba (F5)</b> para voltar a funcionar.' +
        ' <button id="job-aviso-reload" style="margin-left:12px;background:#fff;color:#b91c40;border:none;border-radius:6px;padding:5px 12px;font-weight:700;cursor:pointer">Recarregar agora</button>';
      document.body.appendChild(d);
      const b = d.querySelector('#job-aviso-reload');
      if (b) b.addEventListener('click', () => location.reload()); // location.reload é API de window: roda mesmo com o contexto órfão
    } catch (e) { /* nunca deixa o aviso virar outro erro */ }
  }
  function _marcarContextoMorto() {
    if (_contextoMorto) return;
    _contextoMorto = true;
    _pararLoops();
    _mostrarAvisoRecarregarGlobal();
  }
  // Leitura de storage que NUNCA lança/rejeita — se o contexto morreu, marca e
  // devolve {} (o chamador segue sem travar). Substitui os chrome.storage.get
  // que ficavam fora do try/catch nos loops.
  async function _safeStorageGet(chaves) {
    if (!_contextoValido()) { _marcarContextoMorto(); return {}; }
    try { return await chrome.storage.local.get(chaves); }
    catch (e) { if (_ehContextoInvalidado(e)) _marcarContextoMorto(); return {}; }
  }
  function _safeStorageSet(obj) {  // fire-and-forget, nunca lança
    if (!_contextoValido()) { _marcarContextoMorto(); return; }
    try { chrome.storage.local.set(obj).catch(() => {}); }
    catch (e) { if (_ehContextoInvalidado(e)) _marcarContextoMorto(); }
  }
  // Mensagem pro background que nunca lança nem rejeita "context invalidated":
  // devolve null nesse caso (e marca o contexto morto) — o chamador trata null.
  async function _safeSendMessage(msg) {
    if (!_contextoValido()) { _marcarContextoMorto(); return null; }
    try { return await chrome.runtime.sendMessage(msg); }
    catch (e) { if (_ehContextoInvalidado(e)) { _marcarContextoMorto(); return null; } throw e; }
  }

  // ── Descobre o container rolável das mensagens (o WhatsApp muda as classes,
  //    então detectamos pelo comportamento: dentro do #main, o elemento que
  //    realmente rola verticalmente). ──
  function acharPainelRolavel() {
    const main = _qsRemoto('mainContainer', ['#main']) || document.body;
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

  // ── Seletores DOM remotos: quando o WhatsApp muda o HTML dele e um seletor
  //    fixo no código para de achar o elemento, dá pra corrigir direto no
  //    site (/extensao/config-remota) sem esperar deploy nem loja — mesma
  //    ideia vista no WaSpeed (eles têm um config.json próprio pra isso).
  //    Sempre com fallback pro valor fixo se o remoto falhar/não tiver a chave. ──
  let _seletoresRemotos = null;
  let _flagsRemotas = null;
  // querySelector com fallback: usa a lista remota da chave se existir, senão o
  // padrão fixo. Devolve o primeiro elemento que casar.
  function _qsRemoto(chave, padrao, escopo) {
    const lista = (_seletoresRemotos && _seletoresRemotos[chave]) || padrao;
    const base = escopo || document;
    for (const sel of lista) {
      try { const el = base.querySelector(sel); if (el) return el; } catch (e) { /* seletor inválido, tenta o próximo */ }
    }
    return null;
  }
  // querySelectorAll com fallback: junta os resultados de TODOS os seletores da
  // lista (dedup por identidade), pra caso o WhatsApp use classes diferentes em
  // versões diferentes ao mesmo tempo.
  function _qsAllRemoto(chave, padrao, escopo) {
    const lista = (_seletoresRemotos && _seletoresRemotos[chave]) || padrao;
    const base = escopo || document;
    const vistos = new Set();
    for (const sel of lista) {
      try {
        base.querySelectorAll(sel).forEach((el) => vistos.add(el));
      } catch (e) { /* seletor inválido, tenta o próximo */ }
    }
    return [...vistos];
  }
  // Flag de comportamento remota (default true se o servidor não respondeu).
  function _flag(nome, padrao) {
    if (_flagsRemotas && Object.prototype.hasOwnProperty.call(_flagsRemotas, nome)) return !!_flagsRemotas[nome];
    return padrao !== undefined ? padrao : true;
  }
  async function carregarSeletoresRemotos() {
    try {
      const r = await fetch(_SITE_BASE_URL_EXT + '/api/whatsapp/config-remota', { cache: 'no-store' });
      const j = await r.json();
      if (j && j.ok) {
        if (j.seletores) _seletoresRemotos = j.seletores;
        if (j.flags) _flagsRemotas = j.flags;
        // Marca da instância conectada — a extensão é um artefato único, então
        // mostra a marca de QUEM ela conecta (cada cliente vê a dele).
        if (j.marca) { _marcaInstancia = String(j.marca); _aplicarMarca(); }
      }
    } catch (e) { /* sem internet: segue com os seletores/flags fixos do código */ }
  }

  let _marcaInstancia = '';
  // Atualiza o título do painel com a marca da instância (se já renderizado).
  function _aplicarMarca() {
    try {
      const el = document.querySelector('.job-painel-doc-titulo');
      if (el && _marcaInstancia) el.innerHTML = 'JOB <b>' + _marcaInstancia.replace(/[<>&]/g, '') + '</b>';
    } catch (e) { /* painel ainda não montado — pega no próximo render */ }
  }

  // ── Nome do contato/conversa aberta (do cabeçalho). ──
  function nomeDoContato() {
    const header = _qsRemoto('headerContato', ['#main header']);
    if (!header) return '';
    const comTitle = _qsRemoto('nomeContatoComTitulo', ['span[dir="auto"][title]'], header);
    if (comTitle && comTitle.getAttribute('title')) return comTitle.getAttribute('title').trim();
    const span = _qsRemoto('nomeContatoSpan', ['span[dir="auto"]'], header);
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
    for (const el of _qsAllRemoto('mensagensComDataId', ['#main [data-id]'])) {
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
    const nodes = _qsAllRemoto('mensagemComData', ['#main .copyable-text[data-pre-plain-text]']);
    const centro = centroDoPainel();
    const nomeContato = nomeDoContato();
    const msgs = [];
    for (const cp of nodes) {
      const pre = cp.getAttribute('data-pre-plain-text') || '';
      const mh = pre.match(/\[([^\]]+)\]/);
      const hora = mh ? mh[1] : '';
      const alvo = _qsRemoto('textoSelecionavel', ['span.selectable-text', '.selectable-text'], cp) || cp;
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
    const nodes = _qsAllRemoto('mensagemComData', ['#main .copyable-text[data-pre-plain-text]']);
    const centro = centroDoPainel();
    const nomeContato = nomeDoContato();
    const vistos = new Set();
    const out = [];
    for (const cp of nodes) {
      const a = _qsRemoto('linkNaMensagem', ['a[href^="http"]'], cp);
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
  const _WA_MAX_IMG = 20;

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
    const cand = _qsAllRemoto('imagensDaConversa', ['#main img']).filter((im) =>
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
    // encontrados = TOTAL de imagens únicas visíveis na conversa (antes do teto),
    // pra o painel avisar "X de Y ficaram de fora".
    return { imagens: out, encontrados: candidatos.length };
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
        resolve({ audios: d.audios || [], encontrados: d.encontrados || (d.audios || []).length });
      }
      window.addEventListener('message', onMsg);
      window.postMessage({ source: 'JOB_EXT_REQ', tipo: 'baixar_audios', reqId, limite }, '*');
      setTimeout(() => {
        if (!pronto) { window.removeEventListener('message', onMsg); resolve({ audios: [], encontrados: 0 }); }
      }, 120000);
    });
  }

  function pedirDocumentos(limite, forcarGrandes) {
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
        // pulados = PDFs do consultor com +5 páginas que nem baixamos (otimização).
        resolve({ documentos: d.documentos || [], encontrados: d.encontrados || (d.documentos || []).length,
                  pulados: Array.isArray(d.pulados) ? d.pulados : [] });
      }
      window.addEventListener('message', onMsg);
      window.postMessage({ source: 'JOB_EXT_REQ', tipo: 'baixar_documentos', reqId, limite, forcarGrandes: !!forcarGrandes }, '*');
      setTimeout(() => {
        if (!pronto) { window.removeEventListener('message', onMsg); resolve({ documentos: [], encontrados: 0, pulados: [] }); }
      }, 60000);
    });
  }

  // ── MENSAGENS via wa-js (Store), não do DOM. Devolve [{de,texto,hora}] ou [].
  //    Mais confiável e completo que raspar o HTML; cai vazio se a wa-js falhar,
  //    e aí o chamador usa a raspagem do DOM como reserva. ──
  function pedirMensagensWpp(limite) {
    return new Promise((resolve) => {
      const reqId = 'lm' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      let pronto = false;
      function onMsg(ev) {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.source !== 'JOB_EXT_RESP' || d.reqId !== reqId) return;
        pronto = true;
        window.removeEventListener('message', onMsg);
        resolve(Array.isArray(d.mensagens) ? d.mensagens : []);
      }
      window.addEventListener('message', onMsg);
      window.postMessage({ source: 'JOB_EXT_REQ', tipo: 'ler_mensagens', reqId, limite }, '*');
      setTimeout(() => {
        if (!pronto) { window.removeEventListener('message', onMsg); resolve([]); }
      }, 15000);
    });
  }

  // ── TELEFONE via wa-js: pra contato salvo (nome próprio, não número), o DOM
  //    não expõe o telefone em lugar nenhum — mas o JID interno (chat.id) tem
  //    o número de verdade quando não é conta @lid (privacidade nova/business).
  //    Pede pra ponte no main world; devolve string de dígitos ou ''. ──
  // Nome vindo da wa-js na última chamada de obter_telefone — lido direto do Store
  // do WhatsApp (chat.name/contact.pushname), não do DOM. Mais confiável que
  // nomeDoContato() porque não depende de seletor CSS, que quebra toda vez que o
  // WhatsApp muda a tela. Mesmo quando o número não é resolvível (@lid sem
  // permissão), esse nome costuma vir — é o "nome salvo no cabeçalho".
  let _ultimoNomeWpp = '';
  function nomeMaisConfiavel(nomeDom) { return _ultimoNomeWpp || nomeDom || ''; }

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
        if (d.nome) _ultimoNomeWpp = d.nome;
        resolve(d.telefone || '');
      }
      window.addEventListener('message', onMsg);
      window.postMessage({ source: 'JOB_EXT_REQ', tipo: 'obter_telefone', reqId, resolverLid: _flag('resolver_lid') }, '*');
      setTimeout(() => {
        if (!pronto) { window.removeEventListener('message', onMsg); resolve(''); }
      }, 9000);
    });
  }

  // ── Card (NÃO modal) pra pedir o número quando o WhatsApp não expõe (conta
  //    business/@lid). Fica num canto, sem travar a tela — o consultor pode
  //    clicar no nome do contato e abrir "Dados do contato" no próprio WhatsApp
  //    pra conferir o número lá, e depois digitar aqui (ou clicar Tentar de novo,
  //    que às vezes já resolve sozinho depois de abrir esses dados — o WhatsApp
  //    preenche o cache interno quando você olha o perfil). Devolve os dígitos
  //    digitados (ou '' se o consultor pular). ──
  function pedirNumeroManual(nome) {
    return new Promise((resolve) => {
      const existente = document.getElementById('job-num-modal');
      if (existente) existente.remove();
      const wrap = document.createElement('div');
      wrap.id = 'job-num-modal';
      wrap.innerHTML =
        '<div class="job-num-box">' +
          '<div class="job-num-tit"><span>Número não identificado</span><button class="job-num-fechar" type="button" title="Fechar">×</button></div>' +
          '<div class="job-num-txt">O WhatsApp não mostrou o número de <b>' + ((nome || 'este contato').replace(/</g, '')) + '</b> (conta business ou de privacidade). Você pode clicar no nome dele lá em cima pra abrir "Dados do contato" e conferir — ou digitar aqui:</div>' +
          '<input class="job-num-inp" type="tel" inputmode="numeric" placeholder="Ex: 19 99999-8888" />' +
          '<button class="job-num-retry" type="button">↻ Tentar de novo (depois de abrir os dados do contato)</button>' +
          '<div class="job-num-acoes">' +
            '<button class="job-num-pular" type="button">Pular</button>' +
            '<button class="job-num-ok" type="button">Salvar e enviar</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(wrap);
      const inp = wrap.querySelector('.job-num-inp');
      function fim(v) { wrap.remove(); resolve((v || '').trim()); }
      wrap.querySelector('.job-num-fechar').addEventListener('click', () => fim(''));
      wrap.querySelector('.job-num-pular').addEventListener('click', () => fim(''));
      wrap.querySelector('.job-num-ok').addEventListener('click', () => fim(inp.value));
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') fim(inp.value); if (e.key === 'Escape') fim(''); });
      wrap.querySelector('.job-num-retry').addEventListener('click', async () => {
        const btn = wrap.querySelector('.job-num-retry');
        btn.textContent = 'Tentando de novo…'; btn.disabled = true;
        let tel = '';
        try { tel = await pedirTelefoneWpp(); } catch (e) {}
        if (tel) { fim(tel); return; }
        btn.textContent = '↻ Ainda não achou — tente abrir os Dados do contato e clicar de novo';
        btn.disabled = false;
      });
    });
  }

  // Cache chat_id -> número, pra NUNCA perguntar duas vezes o mesmo contato.
  async function _cacheNumeroSalvar(chatId, tel) {
    if (!chatId || !tel) return;
    try {
      const { jobNumCache = {} } = await _safeStorageGet(['jobNumCache']);
      jobNumCache[chatId] = tel; _safeStorageSet({ jobNumCache });
    } catch (e) {}
  }
  async function _cacheNumeroLer(chatId) {
    if (!chatId) return '';
    try {
      const { jobNumCache = {} } = await _safeStorageGet(['jobNumCache']);
      return jobNumCache[chatId] || '';
    } catch (e) { return ''; }
  }

  // Garante um número pro lead, na ordem: (1) wa-js (resolve @lid pelo mapa interno),
  // (2) cache local por chat_id (já resolvido/digitado antes), (3) popup pro corretor.
  // O que for resolvido/digitado é guardado no cache — não pergunta de novo.
  async function garantirTelefone(nome, chatId) {
    let tel = '';
    try { tel = (await pedirTelefoneWpp()) || telefoneDoContato(); } catch (e) { tel = telefoneDoContato(); }
    if (tel) { await _cacheNumeroSalvar(chatId, tel); return tel; }
    const cached = await _cacheNumeroLer(chatId);
    if (cached) return cached;
    // Memória NO SERVIDOR (não só neste navegador): se QUALQUER consultor já
    // informou o número dessa conversa antes, o JOB já sabe — nunca pergunta de
    // novo, mesmo em outro PC/perfil de Chrome.
    try {
      const r = await chrome.runtime.sendMessage({ type: 'chat_lead', chat_id: chatId });
      if (r && r.ok && r.achou && r.telefone) {
        await _cacheNumeroSalvar(chatId, r.telefone);
        if (r.nome) _ultimoNomeWpp = _ultimoNomeWpp || r.nome;
        return r.telefone;
      }
    } catch (e) { /* segue pro popup se o servidor não responder */ }
    // Mesmo sem número, a wa-js costuma achar o NOME salvo (contato business/@lid)
    // — usa esse em vez do nome raspado do DOM (nomeDoContato), que quebra quando
    // o WhatsApp muda a tela. Melhora a mensagem do popup e o casamento no CRM.
    const manual = await pedirNumeroManual(nomeMaisConfiavel(nome));
    if (manual) await _cacheNumeroSalvar(chatId, manual);
    return manual;
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

  // Envia a análise em LOTES pro background (nunca numa mensagem gigante — isso
  // matava o service worker). O background acumula tudo por reqId e, no
  // 'analisar_executar', dispara UM fetch com o payload montado. Devolve a mesma
  // resposta que o /api/whatsapp/analisar sempre devolveu.
  async function enviarAnaliseEmLotes(reqId, base, audios, imagens, documentos) {
    const ini = await chrome.runtime.sendMessage({ type: 'analisar_iniciar', reqId, base });
    if (!ini || !ini.ok) return ini || { ok: false, erro: 'Falha ao iniciar a análise.' };
    const LOTE = 4; // poucos itens por mensagem = o SW nunca segura um bloco grande
    async function enviarTipo(tipo, arr) {
      for (let i = 0; i < (arr || []).length; i += LOTE) {
        const r = await chrome.runtime.sendMessage({ type: 'analisar_parte', reqId, tipo, itens: arr.slice(i, i + LOTE) });
        if (!r || !r.ok) throw new Error((r && r.erro) || 'Falha ao enviar mídia.');
      }
    }
    await enviarTipo('audios', audios);
    await enviarTipo('imagens', imagens);
    await enviarTipo('documentos', documentos);
    return await chrome.runtime.sendMessage({ type: 'analisar_executar', reqId });
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
  // Nome do arquivo pro documento: a wa-js mostra isso no balão do PDF. Vem da
  // última parte da midia_url (/crm/modelos/midia/<arquivo>); sem isso o PDF
  // chegava sempre como "documento" no WhatsApp do cliente.
  function _nomeArquivoDaUrl(url) {
    try {
      const limpa = String(url || '').split('?')[0].split('#')[0];
      const base = decodeURIComponent(limpa.substring(limpa.lastIndexOf('/') + 1)).trim();
      return base || '';
    } catch (e) { return ''; }
  }

  function pedirEnviarMidia(chatId, midiaTipo, dataUrl, legenda, nomeArquivo) {
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
      window.postMessage({ source: 'JOB_EXT_REQ', tipo: 'enviar_midia', reqId, chatId, midiaTipo, dataUrl, legenda, nomeArquivo }, '*');
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
  // DIREITA por padrão. Duas extensões de WhatsApp no MESMO lado disputam a
  // mesma margem do <html> e se sobrescrevem — a página oscila e os trilhos
  // ficam um por cima do outro. Na máquina do Guilherme o WaSpeed ocupa a
  // ESQUERDA, então a direita é o lado livre pro JOB (configuração que
  // comprovadamente funcionou, 29/07). Tentei inverter isso pra esquerda e
  // foi PIOR: sem preferência salva o JOB caía justamente em cima do WaSpeed.
  // Quem tiver o cenário inverso troca no popup — a escolha explícita manda.
  let _railSide = 'direita';

  async function carregarPreferenciaLado() {
    const { railSide } = await _safeStorageGet(['railSide']);
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

  // ── CONVIVÊNCIA COM OUTRAS EXTENSÕES (WaSpeed, ZapVoice...) ─────────────
  // Todas fixam um trilho estreito e alto na borda da tela e empurram a
  // página. Escolher "esquerda ou direita" na mão não resolve quando há DUAS
  // além da nossa: um lado sempre fica dobrado e um trilho senta em cima do
  // outro (relato do Guilherme, 29/07). Então medimos quanto já está ocupado
  // no NOSSO lado e nos encaixamos DEPOIS do vizinho, somando a margem.
  // Escreve em --job-viz, que o CSS usa pra posicionar trilho, painel e
  // popover e pra calcular o empurrão da página.
  let _vizOcupado = -1;   // -1 = ainda não medido

  function _medirVizinhos() {
    const larg = window.innerWidth, alt = window.innerHeight;
    let esq = 0, dir = 0;
    if (!larg || !alt) return { esquerda: 0, direita: 0 };
    for (const el of Array.from(document.body.children)) {
      // Nunca medir a gente mesmo (viraria laço: empurra, mede, empurra...).
      if (el.id === 'job-trilho' || el.id === 'job-painel-doc') continue;
      if (el.id === 'app' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
      let cs;
      try { cs = getComputedStyle(el); } catch (e) { continue; }
      if (cs.position !== 'fixed' || cs.display === 'none' || cs.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      // Assinatura de trilho: estreito, alto e encostado numa borda.
      if (r.width <= 0 || r.width > 220) continue;
      if (r.height < alt * 0.5) continue;
      if (r.left <= 2) esq = Math.max(esq, r.right);
      else if (r.right >= larg - 2) dir = Math.max(dir, larg - r.left);
    }
    return { esquerda: Math.round(esq), direita: Math.round(dir) };
  }

  function aplicarOffsetVizinhos() {
    if (_contextoMorto) return;
    const v = _medirVizinhos();
    const px = _railSide === 'esquerda' ? v.esquerda : v.direita;
    if (px === _vizOcupado) return;   // só escreve quando muda (evita thrash)
    _vizOcupado = px;
    document.documentElement.style.setProperty('--job-viz', px + 'px');
  }

  // Redimensionar e o momento em que a medida REALMENTE muda — reavalia na
  // hora, em vez de o usuario esperar ate 12s pelo trilho se ajeitar.
  window.addEventListener('resize', () => { try { aplicarOffsetVizinhos(); } catch (e) {} });

  const JOB_PUSH_MIN_WIDTH = 1360; // trilho+painel+folga mínima pro WhatsApp não espremer
  function aplicarClassesHtml() {
    const html = document.documentElement;
    html.classList.toggle('job-push-esquerda', _railSide === 'esquerda');
    html.classList.add('job-push-trilho');
    // Trocar de lado muda qual vizinho importa — remede antes de posicionar.
    _vizOcupado = -1;
    aplicarOffsetVizinhos();
    // O painel também precisa trocar de lado. Antes isso só era aplicado
    // dentro de abrirSecao(), então trocar o lado com o painel JÁ ABERTO movia
    // só o trilho — o painel ficava do lado errado, parecendo que a
    // preferência "não funciona".
    const painel = document.getElementById('job-painel-doc');
    if (painel) painel.classList.toggle('job-painel-doc-esquerda', _railSide === 'esquerda');
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
  const _ICO_INBOX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>';
  const _ICO_CNPJ = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-3"/><path d="M9 9v.01M9 12v.01M9 15v.01M9 18v.01"/></svg>';
  const _ICO_NOTA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/></svg>';
  const _ICO_CRM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="7" r="4"/><path d="M5.5 21a6.5 6.5 0 0 1 13 0"/><path d="M21 8v6M18 11h6"/></svg>';
  const _ICO_COPIAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';

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
      olho: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
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
      '</button>' +
      '<button class="job-trilho-item" data-secao="inbox" title="Leads novos">' +
        '<span class="job-trilho-item-icone">' + _ICO_INBOX + '</span>' +
        '<span class="job-trilho-item-label">Leads</span>' +
        '<span class="job-trilho-item-badge" id="job-inbox-badge" hidden>0</span>' +
      '</button>' +
      '<button class="job-trilho-item" data-secao="cnpj" title="Consultar CNPJ">' +
        '<span class="job-trilho-item-icone">' + _ICO_CNPJ + '</span>' +
        '<span class="job-trilho-item-label">CNPJ</span>' +
      '</button>' +
      '<button class="job-trilho-item" data-secao="notas" title="Notas do lead">' +
        '<span class="job-trilho-item-icone">' + _ICO_NOTA + '</span>' +
        '<span class="job-trilho-item-label">Notas</span>' +
      '</button>' +
      (_devLigado ? '<button class="job-trilho-item" data-secao="dev" title="Modo desenvolvedor: estado de tudo e disparo manual">' +
        '<span class="job-trilho-item-icone">&lt;/&gt;</span>' +
        '<span class="job-trilho-item-label">Dev</span></button>' : '') +
      '<button class="job-trilho-item" data-secao="fila" title="Sua fila de hoje: o que o JOB diz pra fazer agora, com o motivo e a frase pronta">' +
        '<span class="job-trilho-item-icone">' + _ICO_FILA + '</span>' +
        '<span class="job-trilho-item-label">Hoje</span>' +
        '<span class="job-fila-badge" id="job-fila-badge" hidden></span>' +
      '</button>' +
      '<button class="job-trilho-item" data-secao="ficha" title="Ficha do lead: etapa, sub-status, etiquetas, qualificação e atividade">' +
        '<span class="job-trilho-item-icone">' + _ICO_CRM + '</span>' +
        '<span class="job-trilho-item-label">CRM</span>' +
      '</button>' +
      '<div class="job-trilho-rodape">' +
        '<button class="job-trilho-mini" id="job-trilho-config-btn" title="Configurações (tema, desligar)">' + _ICO_CONFIG + '</button>' +
      '</div>' +
      '<div class="job-trilho-versao" id="job-trilho-versao" title="Versão instalada"></div>';
    trilho.querySelectorAll('.job-trilho-item').forEach((item) => {
      item.addEventListener('click', () => {
        if (item.dataset.acao === 'crm') { _abrirLeadNoCrm(item); return; }  // legado: nenhum botão usa mais
        const secao = item.dataset.secao;
        if (_secaoAtiva === secao) fecharSecao();
        else abrirSecao(secao);
      });
    });
    document.body.appendChild(trilho);
    document.getElementById('job-trilho-config-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleConfigPopover();
    });
    aplicarClassesHtml();
    atualizarSeloVersao();
  }

  const _ICO_CONFIG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

  // ── Popover de config no trilho: tema (claro/escuro) + desligar a extensão
  //    nesta aba — pedido explícito do Guilherme, 18/07 ("cadê o botão de
  //    desligar/configurar NO TRILHO?", não só no popup do Chrome). ──
  async function toggleConfigPopover() {
    const existente = document.getElementById('job-trilho-config');
    if (existente) { existente.remove(); return; }
    const { tema } = await _safeStorageGet(['tema']);
    const temaAtual = tema === 'claro' ? 'claro' : 'escuro';
    const pop = document.createElement('div');
    pop.id = 'job-trilho-config';
    pop.className = 'job-trilho-config';
    pop.innerHTML =
      '<div class="job-trilho-config-tit">Aparência</div>' +
      '<div class="job-trilho-config-linha">' +
        '<span>Tema do painel</span>' +
        '<div class="job-trilho-tema-btns">' +
          '<button data-tema="escuro" class="' + (temaAtual === 'escuro' ? 'ativo' : '') + '">Escuro</button>' +
          '<button data-tema="claro" class="' + (temaAtual === 'claro' ? 'ativo' : '') + '">Claro</button>' +
        '</div>' +
      '</div>' +
      '<div class="job-trilho-config-linha">' +
        '<span>Modo desenvolvedor</span>' +
        '<div class="job-trilho-tema-btns">' +
          '<button data-dev="1" class="' + (_devLigado ? 'ativo' : '') + '">Ligado</button>' +
          '<button data-dev="0" class="' + (_devLigado ? '' : 'ativo') + '">Desligado</button>' +
        '</div>' +
      '</div>' +
      '<button class="job-trilho-config-atualizar" id="job-trilho-atualizar-btn">Forçar verificação de atualização</button>' +
      '<div class="job-trilho-config-nota" id="job-trilho-atualizar-status"></div>' +
      '<button class="job-trilho-config-desligar" id="job-trilho-desligar-btn">Desligar extensão nesta aba</button>';
    document.body.appendChild(pop);
    const btn = document.getElementById('job-trilho-config-btn');
    if (btn) {
      const r = btn.getBoundingClientRect();
      pop.style.bottom = (window.innerHeight - r.bottom + r.height + 8) + 'px';
    }
    pop.querySelectorAll('[data-dev]').forEach((b) => {
      b.addEventListener('click', async () => {
        _devLigado = b.dataset.dev === '1';
        await _safeStorageSet({ jobDevMode: _devLigado });
        // Recria o trilho pro botão Dev aparecer/sumir na hora.
        const t = document.getElementById('job-trilho');
        if (t) t.remove();
        criarTrilho();
        const p = document.getElementById('job-trilho-config');
        if (p) p.remove();
      });
    });
    pop.querySelectorAll('.job-trilho-tema-btns button[data-tema]').forEach((b) => {
      b.addEventListener('click', async () => {
        const novoTema = b.dataset.tema;
        _safeStorageSet({ tema: novoTema });
        document.body.setAttribute('data-job-tema', novoTema);
        pop.querySelectorAll('.job-trilho-tema-btns button').forEach((x) => x.classList.toggle('ativo', x === b));
      });
    });
    // "Forçar atualização": só funciona de verdade em cópia instalada pela
    // Chrome Web Store (é ela que tem update_url). Em cópia "Carregar sem
    // compactação" o Chrome NUNCA autoatualiza — avisamos isso claramente em
    // vez de fingir que funcionou (pedido honesto, não gambiarra).
    document.getElementById('job-trilho-atualizar-btn').addEventListener('click', async () => {
      const st = document.getElementById('job-trilho-atualizar-status');
      if (st) st.textContent = 'Verificando…';
      let resp;
      try { resp = await chrome.runtime.sendMessage({ type: 'forcar_update' }); } catch (e) { resp = null; }
      if (!st) return;
      if (!resp || !resp.ok) {
        st.textContent = 'Não consegui verificar. Se essa cópia foi carregada manualmente (modo desenvolvedor), ela nunca atualiza sozinha — precisa recarregar o arquivo na mão.';
      } else if (resp.status === 'update_available') {
        st.textContent = 'Atualização encontrada (v' + (resp.versaoNova || '?') + ') — baixando e aplicando sozinho, a aba vai recarregar em instantes.';
      } else if (resp.status === 'no_update') {
        st.textContent = 'Já está na versão mais recente disponível na Chrome Web Store.';
      } else if (resp.status === 'throttled') {
        st.textContent = 'Você checou recente demais — o Chrome limita a frequência dessa verificação. Tente de novo em alguns minutos.';
      } else {
        st.textContent = String(resp.status || 'Sem resposta.');
      }
    });
    document.getElementById('job-trilho-desligar-btn').addEventListener('click', async () => {
      if (!confirm('Desligar a extensão JOB nesta aba do WhatsApp? Pra ligar de novo, use o popup da extensão (ícone JOB na barra do Chrome) e dê F5.')) return;
      _safeStorageSet({ extensaoAtiva: false });
      const t = document.getElementById('job-trilho'); if (t) t.remove();
      const p = document.getElementById('job-painel-doc'); if (p) p.remove();
      pop.remove();
      document.documentElement.classList.remove('job-push-trilho', 'job-push-painel', 'job-overlay-painel', 'job-push-esquerda');
    });
    // Fecha ao clicar fora — sem isso ficava aberto até apertar de novo no ícone.
    setTimeout(() => {
      document.addEventListener('click', function fechar(ev) {
        if (pop.contains(ev.target)) return;
        pop.remove();
        document.removeEventListener('click', fechar);
      });
    }, 0);
  }

  // ── Selo discreto de versão no rodapé do trilho: mostra a instalada e, se
  //    tiver uma mais nova disponível, mostra ela também em destaque — pedido
  //    do Guilherme, 18/07 (mesma ideia do "7.4.3.67" que o próprio WhatsApp
  //    mostra no canto da barra dele). ──
  function atualizarSeloVersao(nova) {
    const el = document.getElementById('job-trilho-versao');
    if (!el) return;
    let minha = '';
    try { minha = chrome.runtime.getManifest().version; } catch (e) { return; }
    if (nova && _cmpVersao(minha, nova) < 0) {
      el.innerHTML = '<span class="job-trilho-versao-num">v' + esc(minha) + '</span>' +
        '<span class="job-trilho-versao-nova">nova: ' + esc(nova) + '</span>';
      el.title = 'Instalada: ' + minha + ' — disponível: ' + nova + ' (feche e reabra o WhatsApp Web pra atualizar)';
      el.classList.add('tem-nova');
    } else {
      el.innerHTML = '<span class="job-trilho-versao-num">v' + esc(minha) + '</span>';
      el.title = 'Versão instalada — está na mais recente';
      el.classList.remove('tem-nova');
    }
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
    if (e.key !== 'Escape') return;
    // Prioridade: primeiro fecha o painel da bolha de funis (se estiver
    // aberto) — não cancela nenhum envio, só recolhe a bolha pro pontinho.
    if (_bubbleAberta) {
      _bubbleAberta = false;
      renderBubble();
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    if (_secaoAtiva) {
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
            '<span class="job-painel-doc-titulo">JOB' + (_marcaInstancia ? ' <b>' + _marcaInstancia.replace(/[<>&]/g, '') + '</b>' : '') + '</span></span>' +
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
    else if (secao === 'inbox') abrirSecaoInbox();
    else if (secao === 'cnpj') abrirSecaoCnpj();
    else if (secao === 'notas') abrirSecaoNotas();
    else if (secao === 'crm') abrirSecaoNovoLead();
    else if (secao === 'fila') abrirSecaoFila();
    else if (secao === 'ficha') abrirSecaoFicha();
    else if (secao === 'dev') abrirSecaoDev();
  }

  // ═══════════════ Transcrição dentro da bolha do áudio ═══════════════
  // Botão "Transcrever" DENTRO da bolha, texto aparecendo ali mesmo — igual à
  // WaSpeed, que é a referência que o Guilherme passou.
  //
  // MUDEI DE POSIÇÃO sobre o #main: eu tinha construído isso como etiqueta
  // flutuante posicionada por coordenada, pra não encostar na árvore React. A
  // WaSpeed injeta na bolha e funciona em produção — e a minha versão flutuante
  // exigia reposicionar a cada rolagem, que foi o que deixou o WhatsApp lento.
  // O que quebrou o envio naquela vez foi uma BARRA fixa na estrutura do #main,
  // não um nó no fim de uma bolha. Aqui: só acrescenta filho, nunca altera nó
  // existente, e a injeção é idempotente (marca .job-tr-slot).
  //
  // SOB DEMANDA muda tudo: sem varredura, sem download em massa, sem custo
  // surpresa. O consultor pede o áudio que ele quer ler.
  // Ponte generica pro main world. Eu vinha CHAMANDO _pedirPonte sem nunca
  // te-la escrito — as chamadas falhavam com "_pedirPonte is not defined" e o
  // erro so aparecia dentro da bolha, no lugar da transcricao. Mesmo protocolo
  // das outras chamadas do arquivo: reqId unico, listener que se remove, teto
  // de tempo pra nunca ficar pendurado.
  function _pedirPonte(tipo, extra, timeoutMs) {
    return new Promise((resolve) => {
      const reqId = 'p' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
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
      window.postMessage(Object.assign({ source: 'JOB_EXT_REQ', tipo, reqId }, extra || {}), '*');
      setTimeout(() => {
        if (!pronto) { window.removeEventListener('message', onMsg); resolve({ erro: 'timeout' }); }
      }, timeoutMs || 15000);
    });
  }

  const TR = {
    cache: new Map(),        // msg_id -> texto ('' = tentou e não deu)
    ocupado: new Set(),
    // Motivo POR AUDIO. Era uma string so pra extensao inteira: dois audios
    // falhando por motivos diferentes mostravam os dois o motivo do ultimo.
    erro: new Map(),
    aviso: '',
    diag: { etapa: 'nao_iniciou' },
    // Contadores de custo. Existem porque "a extensao ta lenta" e
    // indistinguivel de "o WhatsApp ta lento" sem numero — e porque, sem medir,
    // eu ia adivinhar qual das dez coisas era a culpada. Aparecem no modo
    // desenvolvedor e vao no canario.
    perf: { regs: 0, passadas: 0, linhas: 0, ms: 0, pior: 0, puladas: 0 },
  };

  function _trPodeRodar() { return !!document.querySelector('#main'); }

  // QUEM DIZ que a mensagem e audio e o WhatsApp, nao um seletor de CSS.
  //
  // Era aqui que estava o problema: eu procurava <audio>, [data-icon="ptt"] e
  // afins. O WhatsApp trocou a marcacao — nao ha mais <audio> na bolha e o icone
  // mudou de nome — entao o filtro rejeitava TODA linha e nenhum botao nascia.
  // Sem erro no console, sem nada quebrado: so silencio, que e o pior modo de
  // falhar e me custou varias rodadas de adivinhacao.
  //
  // Agora eu pergunto pro proprio WhatsApp (wa-js) quais mensagens da conversa
  // sao ptt/audio e caso com a linha pelo data-id, que e o mesmo id dos dois
  // lados. Seletor de CSS quebra a cada atualizacao; o tipo da mensagem, nao.
  // DETECCAO 100% LOCAL, sem perguntar nada a ninguem.
  //
  // Eu buscava as 400 ultimas mensagens pela wa-js a CADA conversa aberta so pra
  // saber quais linhas eram audio. Caro — uma leitura do store inteiro por chat,
  // toda vez — e fragil: quando aquela chamada falhava eu ficava sem os ids, sem
  // o lado da bolha e sem transcricao. Era exatamente o que estava na tela do
  // Guilherme: bloco nascendo a esquerda embaixo de um audio nosso, e "nao deu
  // pra transcrever" nos dois.
  //
  // O DOM ja tem as duas informacoes de graca:
  //   - se e audio: icone de ptt/audio ou botao de tocar na propria linha;
  //   - de quem e: o data-id do WhatsApp comeca com "true_" quando a mensagem e
  //     nossa e "false_" quando e do contato — nao depende de classe de CSS.
  // ── DOCUMENTO: um botao POR ARQUIVO, na propria bolha ─────────────────────
  //
  // A primeira versao lia tudo que a conversa tinha. O Guilherme testou e o
  // resultado foi exatamente o problema: leu um e-mail e a foto de uma fachada de
  // predio. Pagou pra descobrir que nao era documento. Numa conversa de venda a
  // maioria das imagens NAO e documento — e print de cotacao, apresentacao de
  // rede, carteirinha.
  //
  // Quem sabe qual arquivo importa e ele, olhando. Entao o botao vai na bolha do
  // arquivo, igual ao de transcrever audio: um clique, um documento, um custo.
  // sel: quais arquivos o consultor marcou pra ler JUNTOS. Ler em lote nao e so
  // conforto: e uma chamada de modelo em vez de N, entao sai mais rapido e mais
  // barato — e o modelo ainda enxerga os documentos como um conjunto (frente e
  // verso do mesmo RG deixam de virar duas pessoas).
  const DOC = { estado: new Map(), sel: new Set() };
  const DOC_MAX_LOTE = 10;

  // UMA LISTA SO. Antes a mesma lista de ancoras estava escrita em dois lugares
  // (o "e arquivo?" e o "onde encolho o bloco?") — bastava eu melhorar uma pra
  // foto ser reconhecida e mesmo assim nao ganhar botao, que foi o que
  // aconteceu: PDF com "Juntar" e a foto do RG ao lado sem nada.
  const _DOC_ANCORAS =
    '[data-icon="document"], [data-icon*="document"], [data-icon="media-download"],' +
    '[data-testid="media-canvas"], [data-icon="image"], [data-testid="image-thumb"],' +
    'img[src^="blob:"], img[src^="data:image"]';

  function _docAncora(row) {
    // Imagem ou PDF na bolha. Audio ja tem o proprio botao e fica de fora.
    if (_trLinhaEhAudio(row)) return null;
    for (const el of row.querySelectorAll(_DOC_ANCORAS)) {
      if (el.tagName === 'IMG') {
        // Figurinha, emoji e foto de perfil tambem sao <img>. Nao ha documento
        // nenhum pra ler ali — e um botao "Ler documento" embaixo de cada
        // figurinha da conversa seria pior que nao ter botao.
        const w = el.clientWidth || el.naturalWidth || 0;
        if (w && w < 90) continue;
        if (el.closest('[data-icon="sticker"], [aria-label*="igurinha"], [aria-label*="ticker"]')) continue;
      }
      return el;
    }
    // ULTIMO RECURSO, por GEOMETRIA. Foto no WhatsApp nem sempre e <img>: ja
    // apareceu como <canvas> e como <div style="background-image:url(blob:…)">.
    // Perseguir a marcacao do dia e perder — e por isso que a conta de agua
    // ficava sem bloco enquanto o PDF ao lado tinha. Aqui a pergunta e outra:
    // tem alguma coisa desenhada, grande, dentro desta bolha?
    for (const el of row.querySelectorAll('canvas, div[style*="blob:"], div[style*="url("]')) {
      const w = el.clientWidth || 0, h = el.clientHeight || 0;
      if (w >= 90 && h >= 60) return el;
    }
    return null;
  }

  function _docLinhaEhArquivo(row) { return !!_docAncora(row); }

  // ETAPA E RELOGIO. Doze segundos em silencio parecem quarenta — foi por isso
  // que ouvi "compensa mandar pro ChatGPT". O trabalho e o mesmo; o que faltava
  // era a tela dizer em que pe esta. E de quebra passa a existir um numero:
  // sem isso "demorou muito" e indistinguivel de download lento ou rede lenta.
  const _docCrono = new Map();

  function _docPintarEtapa(id) {
    const e = DOC.estado.get(id) || {};
    if (e.status !== 'lendo') return;
    const seg = e.t0 ? Math.round((Date.now() - e.t0) / 1000) : 0;
    const sel = window.CSS && window.CSS.escape ? window.CSS.escape(id) : id;
    // So o texto do span e reescrito — re-renderizar o slot inteiro a cada
    // segundo derrubaria listener e foco.
    document.querySelectorAll('.job-doc-slot[data-msg="' + sel + '"] .job-doc-etapa')
      .forEach((el) => { el.textContent = (e.etapa || 'lendo') + '… ' + seg + 's'; });
  }

  function _docEtapa(id, etapa) {
    const e = DOC.estado.get(id) || {};
    e.etapa = etapa;
    DOC.estado.set(id, e);
    _docPintarEtapa(id);
  }

  function _docCronoLigar(id) {
    _docCronoDesligar(id);
    _docCrono.set(id, setInterval(() => _docPintarEtapa(id), 1000));
  }

  function _docCronoDesligar(id) {
    const t = _docCrono.get(id);
    if (t) { clearInterval(t); _docCrono.delete(id); }
  }

  function docRenderSlot(slot, id) {
    // A bolha inteira do arquivo e clicavel pelo WhatsApp: qualquer clique que
    // escape do nosso bloco abre o PDF. Uma trava so, na captura, vale por
    // todos os controles de dentro — e nao depende de eu lembrar de repetir
    // stopPropagation em cada botao novo que eu criar aqui.
    if (!slot._jobTravado) {
      slot._jobTravado = true;
      // BORBULHA, nao captura. Na captura o listener do pai roda ANTES do alvo,
      // entao parar ali matava os proprios botoes — medi, e nem "Ler documento"
      // respondia. Na borbulha o botao age primeiro e o evento morre aqui,
      // antes de chegar na bolha do WhatsApp.
      ['click', 'mousedown', 'mouseup', 'pointerdown', 'dblclick'].forEach((ev) =>
        slot.addEventListener(ev, (x) => x.stopPropagation()));
    }
    const e = DOC.estado.get(id) || {};
    if (e.status === 'lendo') {
      const seg = e.t0 ? Math.round((Date.now() - e.t0) / 1000) : 0;
      slot.innerHTML = '<div class="job-tr-carregando"><span class="job-doc-etapa">' +
        esc((e.etapa || 'lendo') + '… ' + seg + 's') + '</span></div>';
      return;
    }
    if (e.status === 'ok' && e.resultado) {
      const r = e.resultado;
      const a = (r.arquivos || [])[0] || {};
      const campos = (r.campos_preenchidos || []);
      const rot = r.rotulos || {};
      const tipos = r.tipos || [];
      // O TIPO E CONFIRMAVEL AQUI. A IA propoe, o consultor decide — e aqui vale
      // dobrado: o tipo vira o NOME do arquivo, e o nome e o que faz a pasta
      // baixada servir pra subir na operadora sem abrir um por um.
      // TRES PERGUNTAS, nesta ordem: que documento e, de quem e, e — se for de
      // dependente — qual o parentesco. A IA propoe o tipo e o codigo propoe a
      // titularidade (comparando o nome com o do titular no cadastro), mas quem
      // confirma e o consultor: e ele que responde pela ficha na operadora, e
      // certidao de casamento sem dizer que aquele dependente e conjuge nao
      // comprova vinculo nenhum.
      const pars = r.parentescos || [];
      const parRot = r.parentesco_rotulos || {};
      const comprova = r.parentesco_comprova || {};
      const sel =
        '<select class="job-doc-sel" data-campo="tipo" data-doc="' + (a.doc_id || '') + '">' +
          tipos.map((t) => '<option value="' + t + '"' + (t === a.tipo ? ' selected' : '') + '>' +
            esc(rot[t] || t) + '</option>').join('') + '</select>' +
        '<select class="job-doc-sel" data-campo="titularidade" data-doc="' + (a.doc_id || '') + '">' +
          '<option value=""' + (!a.titularidade ? ' selected' : '') + '>de quem?</option>' +
          '<option value="titular"' + (a.titularidade === 'titular' ? ' selected' : '') + '>Titular</option>' +
          '<option value="dependente"' + (a.titularidade === 'dependente' ? ' selected' : '') + '>Dependente</option>' +
        '</select>' +
        '<select class="job-doc-sel job-doc-par" data-campo="parentesco" data-doc="' + (a.doc_id || '') + '"' +
          (a.titularidade === 'dependente' ? '' : ' hidden') + '>' +
          '<option value="">parentesco?</option>' +
          pars.map((p) => '<option value="' + p + '"' + (p === a.parentesco ? ' selected' : '') + '>' +
            esc(parRot[p] || p) + '</option>').join('') + '</select>';
      // SEM LEAD VINCULADO nao existe onde guardar, entao nao existe doc_id, e
      // sem doc_id nao existem os tres seletores. Isso acontecia CALADO: a tela
      // mostrava um "OUTRO" fixo que ninguem conseguia corrigir e o consultor
      // achava que a leitura tinha errado. Agora diz o motivo.
      const semLead = !a.doc_id;
      const ondeFoi = r.lead_id
        ? '<a class="job-doc-link" href="' + _SITE_BASE_URL_EXT + '/lead/' + r.lead_id +
          '" target="_blank" rel="noopener" title="Abre a ficha do lead no JOB: os documentos guardados, os campos preenchidos e o botao de baixar a pasta inteira">' +
          _ICO_ABRIR + 'ver no JOB</a>'
        : '';
      slot.innerHTML = '<div class="job-doc-lido">' +
        (a.doc_id ? sel : '<span class="job-doc-tipo">' + esc(rot[a.tipo] || a.tipo || 'sem tipo') + '</span>') +
        (a.pessoa ? '<span class="job-doc-pessoa">' + esc(a.pessoa) + '</span>' : '') +
        (a.certeza === 'baixa' ? '<span class="job-doc-duvida">conferir</span>' : '') +
        (a.ja_lido ? '<span class="job-doc-duvida" title="Este arquivo ja tinha sido lido antes — isto e o que esta gravado, nao custou nada agora. Use ler de novo se estiver errado.">ja lido</span>' : '') +
        (a.nome_final ? '<div class="job-doc-nome">' + esc(a.nome_final) + '</div>' : '') +
        '<div class="job-doc-dica">' + esc(a.parentesco && comprova[a.parentesco]
          ? 'comprova com: ' + comprova[a.parentesco] : '') + '</div>' +
        (semLead
          ? '<div class="job-doc-campos job-doc-alerta">esta conversa não está ligada a um lead — nada foi guardado e não dá pra classificar. Vincule o lead na aba do JOB e leia de novo.</div>'
          : (campos.length
              ? '<div class="job-doc-campos">preencheu: ' + esc(campos.join(', ')) + '</div>'
              : '<div class="job-doc-campos">' + esc(a.pessoa
                  ? 'guardado no lead — a ficha já tinha esses dados'
                  : 'guardado no lead — este papel não traz dado de cadastro') + '</div>')) +
        ((r.observacoes || []).length ? '<div class="job-doc-obs" title="' +
           esc(r.observacoes.join(' · ')) + '">' + esc(r.observacoes[0]) + '</div>' : '') +
        // O caminho de volta: onde o dado foi parar, e como refazer se saiu
        // errado. Sem o "ler de novo" uma classificacao ruim ficava presa pra
        // sempre — o arquivo ja estava no cache por conteudo.
        '<div class="job-doc-acoes">' + ondeFoi +
          '<button type="button" class="job-doc-link" data-ac="reler" ' +
          'title="Le este arquivo outra vez, do zero, ignorando o que ja estava gravado">refazer a leitura</button>' +
        '</div>' +
      '</div>';
      const salvar = async () => {
        const nm = slot.querySelector('.job-doc-nome');
        const par = slot.querySelector('[data-campo="parentesco"]');
        const resp = await _safeSendMessage({ type: 'documento_tipo', docId: a.doc_id,
          tipo: (slot.querySelector('[data-campo="tipo"]') || {}).value,
          titularidade: (slot.querySelector('[data-campo="titularidade"]') || {}).value,
          parentesco: par && !par.hidden ? par.value : '' }).catch(() => null);
        if (resp && resp.ok) {
          a.nome_final = resp.nome_final;
          if (nm) nm.textContent = resp.nome_final;
        } else if (nm) { nm.textContent = 'não deu pra salvar'; }
      };
      const rl = slot.querySelector('[data-ac="reler"]');
      if (rl) rl.addEventListener('click', (ev) => {
        ev.stopPropagation();
        DOC.estado.delete(id);
        docLerVarios([id], true);
      });
      slot.querySelectorAll('.job-doc-sel').forEach((sl) => {
        sl.addEventListener('click', (ev) => ev.stopPropagation());
        sl.addEventListener('change', async (ev) => {
          ev.stopPropagation();
          const par = slot.querySelector('[data-campo="parentesco"]');
          if (sl.dataset.campo === 'tipo') a.tipo = sl.value;
          if (sl.dataset.campo === 'titularidade') {
            a.titularidade = sl.value;
            // Parentesco so aparece pra dependente — perguntar o parentesco do
            // titular seria perguntar de quem ele e parente dele mesmo.
            if (par) { par.hidden = sl.value !== 'dependente'; if (par.hidden) par.value = ''; }
          }
          if (sl.dataset.campo === 'parentesco') {
            a.parentesco = sl.value;
            // Dica do papel que comprova aquele vinculo. Nao trava nada: quem
            // decide o que a operadora aceita e o consultor.
            const dica = slot.querySelector('.job-doc-dica');
            if (dica) dica.textContent = comprova[sl.value] ? ('comprova com: ' + comprova[sl.value]) : '';
          }
          await salvar();
        });
      });
      return;
    }
    if (e.status === 'erro') {
      slot.innerHTML = '<button class="job-tr-btn falhou" type="button" data-ac="ler" title="' + esc(e.erro || '') + '">' +
        _ICO_DOC + 'Ler documento</button>' +
        '<span class="job-tr-motivo">' + esc(e.erro || '') + '</span>';
    } else {
      slot.innerHTML = '<button class="job-tr-btn" type="button" data-ac="ler">' + _ICO_DOC + 'Ler documento</button>';
    }
    // BOTAO, nao caixinha de 12px. A caixinha era alvo pequeno demais dentro de
    // uma bolha que o WhatsApp inteira trata como "abrir o arquivo": errar por
    // dois pixels abria o PDF. Agora e um botao do mesmo tamanho do outro, e
    // nenhum clique dentro do bloco chega no WhatsApp.
    const marcado = DOC.sel.has(id);
    slot.insertAdjacentHTML('beforeend',
      '<button type="button" class="job-tr-btn job-doc-junta' + (marcado ? ' marcado' : '') +
      '" data-ac="juntar" title="Junta este arquivo com outros e le todos numa chamada so — mais rapido e mais barato que um por um.">' +
      (marcado ? _ICO_CHECK + 'Marcado' : _ICO_MAIS + 'Juntar') + '</button>');
    const j = slot.querySelector('[data-ac="juntar"]');
    if (j) j.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (DOC.sel.has(id)) { DOC.sel.delete(id); }
      else {
        if (DOC.sel.size >= DOC_MAX_LOTE) return;
        DOC.sel.add(id);
      }
      docAtualizarSlot(id);
      _docBarraAtualizar();
    });
    const b = slot.querySelector('[data-ac="ler"]');
    if (b) b.addEventListener('click', (ev) => { ev.stopPropagation(); docLer(id); });
  }

  // O botao de ler o lote mora na barra da conversa, junto de "Transcrever
  // tudo": e o unico lugar que existe uma vez so, em vez de repetido em cada
  // bolha, e some sozinho quando nao ha nada marcado.
  // O lote PRESTA CONTAS na barra.
  //
  // Antes o botao sumia no fim — inclusive quando dava errado — e as bolhas
  // selecionadas costumam estar fora da tela, entao o consultor clicava e nao
  // acontecia nada visivel. Agora a barra mostra que esta lendo, e depois diz
  // quantos deram certo. Sem isso o lote e um botao que engole o clique.
  let _docBarraAviso = null;

  function _docBarraAtualizar() {
    const barra = document.querySelector('.job-barra-conv');
    if (!barra) return;
    let b = barra.querySelector('[data-ac="lerdocs"]');
    const n = DOC.sel.size;
    if (!n && !_docBarraAviso) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement('button');
      b.type = 'button';
      b.className = 'job-bc-btn';
      b.dataset.ac = 'lerdocs';
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        if (b.disabled) return;
        docLerVarios(Array.from(DOC.sel));
      });
      barra.insertBefore(b, barra.firstChild);
    }
    if (_docBarraAviso) {
      b.disabled = !!_docBarraAviso.ocupado;
      b.classList.toggle('job-bc-erro', !!_docBarraAviso.erro);
      b.title = _docBarraAviso.title || '';
      b.innerHTML = _ICO_DOC + '<span>' + esc(_docBarraAviso.texto) + '</span>';
      return;
    }
    b.disabled = false;
    b.classList.remove('job-bc-erro');
    b.title = 'Le os ' + n + ' arquivos marcados numa chamada so';
    b.innerHTML = _ICO_DOC + '<span>Ler ' + n + ' documento' + (n > 1 ? 's' : '') + '</span>';
  }

  function _docBarraDizer(texto, opc) {
    _docBarraAviso = Object.assign({ texto: texto }, opc || {});
    _docBarraAtualizar();
  }

  function _docBarraLimpar(msAte) {
    setTimeout(() => { _docBarraAviso = null; _docBarraAtualizar(); }, msAte || 5000);
  }

  function docAtualizarSlot(id) {
    const sel = window.CSS && window.CSS.escape ? window.CSS.escape(id) : id;
    document.querySelectorAll('.job-doc-slot[data-msg="' + sel + '"]').forEach((s) => docRenderSlot(s, id));
  }

  // UM caminho so pra ler: um arquivo e o lote de um. Manter duas funcoes quase
  // iguais e como o bug do "Copiar conversa" duplicado nasce.
  function docLer(id) { return docLerVarios([id]); }

  async function docLerVarios(ids, reler) {
    const alvos = (ids || []).filter((id) => (DOC.estado.get(id) || {}).status !== 'lendo');
    if (!alvos.length) return;
    alvos.forEach((id) => {
      DOC.estado.set(id, { status: 'lendo', etapa: 'baixando o arquivo', t0: Date.now() });
      docAtualizarSlot(id);
      _docCronoLigar(id);
    });
    const lote = alvos.length > 1;
    let deuCerto = false;
    const falhar = (lista, msg) => {
      lista.forEach((id) => DOC.estado.set(id, { status: 'erro', erro: msg }));
      // A MENSAGEM DE ERRO TEM QUE CHEGAR NA TELA. As bolhas marcadas quase
      // sempre estao fora da vista quando o lote roda — sem isto, o clique
      // simplesmente sumia e nao dava nem pra saber o que falhou.
      if (lote) { _docBarraDizer(String(msg).slice(0, 44), { erro: true, title: msg }); _docBarraLimpar(9000); }
    };
    if (lote) _docBarraDizer('baixando ' + alvos.length + ' arquivos…', { ocupado: true });
    try {
      const baixado = await _pedirPonte('baixar_midia_ids', { ids: alvos }, 120000);
      const arqs = (baixado && baixado.arquivos) || [];
      if (!arqs.length) {
        falhar(alvos, (baixado && baixado.erros && baixado.erros[alvos[0]]) || 'não consegui baixar');
        return;
      }
      // Quem nao baixou nao trava quem baixou.
      const baixados = arqs.map((a) => a.msg_id);
      alvos.filter((id) => baixados.indexOf(id) < 0).forEach((id) =>
        DOC.estado.set(id, { status: 'erro',
          erro: (baixado.erros && baixado.erros[id]) || 'não consegui baixar' }));
      baixados.forEach((id) => _docEtapa(id, arqs.length > 1
        ? 'lendo ' + arqs.length + ' documentos' : 'lendo o documento'));
      if (lote) _docBarraDizer('lendo ' + arqs.length + ' documentos…', { ocupado: true });
      let tel = '';
      try { tel = (await pedirTelefoneWpp()) || telefoneDoContato(); } catch (x) { tel = telefoneDoContato(); }
      const r = await _safeSendMessage({ type: 'documentos_ler', telefone: tel,
        leadId: (_ficha && _ficha.lead && _ficha.lead.id) || null, reler: !!reler,
        arquivos: arqs.map((a) => ({ nome: a.nome, base64: a.base64, mime: a.mime, tipo: a.tipo }))
      }).catch(() => null);
      if (!r || !r.ok) {
        falhar(baixados, (r && r.erro) || 'o JOB não respondeu');
        return;
      }
      // Reparte o resultado: o servidor numera por ARQUIVO n, na ordem em que
      // mandamos. Cada bolha fica com o SEU arquivo, nunca com o do vizinho.
      arqs.forEach((a, i) => {
        const meu = (r.arquivos || []).filter((x) => x.indice === i + 1);
        DOC.estado.set(a.msg_id, { status: 'ok',
          resultado: Object.assign({}, r, { arquivos: meu.length ? meu : [{}] }) });
      });
      deuCerto = true;
      if (lote) {
        const perdidos = alvos.length - arqs.length;
        _docBarraDizer(arqs.length + ' lido' + (arqs.length > 1 ? 's' : '') +
          (perdidos > 0 ? ' · ' + perdidos + ' falhou' : ''),
          { title: 'Abra a ficha do lead pra ver tudo junto: ' +
                   (r.lead_id ? _SITE_BASE_URL_EXT + '/lead/' + r.lead_id : 'sem lead vinculado') });
        _docBarraLimpar(7000);
      }
    } catch (x) {
      falhar(alvos, String((x && x.message) || x).slice(0, 90));
    } finally {
      alvos.forEach((id) => {
        // Falhou: A MARCACAO FICA. Limpar a selecao no erro obrigava a remarcar
        // os quatro arquivos um por um, rolando a conversa toda de novo.
        if (deuCerto) DOC.sel.delete(id);
        _docCronoDesligar(id);
        docAtualizarSlot(id);
      });
      _docBarraAtualizar();
    }
  }

  function _trLinhaEhAudio(row) {
    return !!row.querySelector(
      'audio, [data-icon="ptt"], [data-icon*="ptt"], [data-icon*="audio"],' +
      '[data-icon="audio-play"], [data-icon="play"],' +
      '[aria-label*="udio"], [data-testid*="audio"], [data-testid*="ptt"]');
  }

  // A BOLHA, achada por geometria — nao por classe de CSS nem por formato de id.
  //
  // E o aprendizado da WaSpeed: ela nao tenta descobrir de que lado a mensagem
  // esta pra depois alinhar. Ela injeta DENTRO da bolha, e o alinhamento vem de
  // graca — a bolha ja esta no lugar certo, ja tem a cor certa, ja tem a largura
  // certa. Toda vez que eu tentei deduzir o lado (classe message-out, prefixo
  // "true_" no data-id) errei, porque essas duas coisas mudam quando o WhatsApp
  // e redesenhado. A geometria nao muda: a bolha e o maior bloco dentro da linha
  // que NAO ocupa a linha inteira.
  // Elemento SUBSTITUIDO nao pinta filho. Medido no Chrome: appendChild num
  // <img>/<canvas> entra no DOM e devolve zero client rects — o bloco some da
  // tela sem erro nenhum. E a ancora de imagem E o proprio <img src="blob:">.
  const _TR_SUBSTITUIDO = { IMG: 1, CANVAS: 1, VIDEO: 1, AUDIO: 1, IFRAME: 1,
                            PICTURE: 1, INPUT: 1, EMBED: 1, SVG: 1, svg: 1 };

  // Linha de flex que nao quebra: pousar aqui vira COLUNA ao lado do nome do
  // arquivo — exatamente o que apareceu na tela. Medido: um filho com
  // flex-basis:100% NAO quebra linha em container flex-wrap:nowrap, que e o
  // padrao do card do WhatsApp. Por isso a recusa mora aqui no JS, e nao num
  // CSS que nunca chegou a pegar.
  function _trEhLinhaFlex(el) {
    try {
      const s = getComputedStyle(el);
      if (s.display !== 'flex' && s.display !== 'inline-flex') return false;
      if ((s.flexDirection || 'row').indexOf('column') === 0) return false;
      return (s.flexWrap || 'nowrap').indexOf('wrap') !== 0;
    } catch (e) { return false; }
  }

  // O documento PARA NA PRIMEIRA bolha subindo, nao vai ate a mais de fora.
  //
  // Errei nas duas pontas antes de acertar. Pegando a mais INTERNA sem filtro,
  // caia no card do arquivo (icone | nome | tamanho), que e um flex row, e o
  // bloco virava a coluna da direita. Pegando a mais EXTERNA (o mesmo caminho do
  // audio), passava da bolha e pousava num wrapper de ~87% da linha — dai o
  // retangulo gigante vazio atravessando a conversa.
  // O certo e subir e parar no PRIMEIRO ancestral que sabe pintar um filho
  // embaixo: nao e elemento substituido e nao e linha de flex sem quebra. Esse
  // ancestral E a bolha, porque o card foi recusado logo abaixo dela.
  function _trBolhaDoc(row, ancora) {
    const larguraLinha = row.clientWidth || 1;
    let el = ancora;
    if (el) {
      for (const teto of [0.75, 0.94]) {
        let e2 = el;
        for (let i = 0; i < 10 && e2 && e2 !== row; i++) {
          const w = e2.clientWidth;
          if (w > 160 && w < larguraLinha * teto
              && !_TR_SUBSTITUIDO[e2.tagName] && !_trEhLinhaFlex(e2)) {
            return { alvo: e2, solto: false };
          }
          e2 = e2.parentElement;
        }
      }
    }
    // NUNCA devolve vazio: botao que some e pior que botao no lugar mais ou
    // menos certo. Foi o que aconteceu na 2.71.0.
    return { alvo: row, solto: true };
  }

  function _trBolha(row, ancora) {
    const larguraLinha = row.clientWidth || 1;
    // Ancora: algo que esta SEMPRE dentro da bolha. Pra audio e o controle de
    // tocar; pra documento/imagem e o icone do arquivo ou a propria miniatura.
    // Antes so conhecia audio — por isso o botao do documento nascia solto na
    // esquerda da tela, fora de qualquer bolha, que foi o que ficou horrivel.
    let el = ancora || null;
    if (!el) {
      el = row.querySelector('[data-icon="audio-play"], [data-icon="play"], [data-icon*="ptt"], audio')
           || row.querySelector('[aria-label*="udio"]');
    }
    if (!el) return null;
    let melhor = null;
    for (let i = 0; i < 8 && el && el !== row; i++) {
      const w = el.clientWidth;
      // Larga o bastante pra ser bolha, estreita o bastante pra nao ser a linha.
      if (w > 150 && w < larguraLinha * 0.94) melhor = el;
      el = el.parentElement;
    }
    return melhor;
  }

  // De que lado ficou — so pra escolher a COR do rotulo. Se errar aqui nada
  // desalinha, porque quem posiciona e a bolha.
  function _trLado(bolha, row) {
    try {
      const b = bolha.getBoundingClientRect(), r = row.getBoundingClientRect();
      return (b.left - r.left) > (r.right - b.right) ? 'consultor' : 'lead';
    } catch (e) { return 'lead'; }
  }

  function trInjetar(raizes) {
    if (!_trPodeRodar()) return;
    const _t0 = performance.now();
    try { _barraConvInjetar(); } catch (e) { /* barra e ganho, nao requisito */ }
    const main = document.querySelector('#main');
    let linhas;
    if (raizes && raizes.length) {
      const vistos = new Set();
      linhas = [];
      for (const r of raizes) {
        if (!r || r.nodeType !== 1 || !main.contains(r)) continue;
        if (r.hasAttribute && r.hasAttribute('data-id') && !vistos.has(r)) { vistos.add(r); linhas.push(r); }
        if (r.querySelectorAll) {
          r.querySelectorAll('[data-id]').forEach((x) => { if (!vistos.has(x)) { vistos.add(x); linhas.push(x); } });
        }
      }
    } else {
      linhas = main.querySelectorAll('[data-id]');
    }
    TR.perf.passadas++;
    TR.perf.linhas += linhas.length;
    for (const row of linhas) {
      const id = row.getAttribute('data-id') || '';
      if (!id) continue;
      // A LINHA JA ESTA PRONTA? Entao nao mede nada dela.
      //
      // Antes, toda passada refazia a conta inteira em toda linha: procurar
      // icone, medir largura de oito ancestrais, pedir retangulo. Medir
      // geometria forca o navegador a recalcular o layout na hora — e isso,
      // vezes as linhas da tela, vezes as passadas, era o travamento.
      // A esmagadora maioria das linhas nao mudou nada desde a ultima vez.
      if (row._jobPronta === id) { TR.perf.puladas++; continue; }
      // Documento/imagem: botao proprio, um por arquivo.
      // Linha reaproveitada pra OUTRA mensagem: o bloco velho fica pendurado com
      // o id antigo e passa a mostrar o resultado do vizinho. Some daqui.
      if (row._jobId !== id) {
        row._jobId = id;
        row.querySelectorAll('.job-doc-slot, .job-tr-slot').forEach((s) => {
          if (s.dataset.msg && s.dataset.msg !== id) s.remove();
        });
      }
      let pendente = false;
      if (_docLinhaEhArquivo(row)) {
        // Bloco que caiu no fallback NAO e definitivo. Enquanto o WhatsApp
        // pinta, a linha mede 0px, nenhum ancestral entra na faixa e o bloco
        // nasce solto; quando a linha ja tem largura, tenta de novo. Mas
        // MOVENDO o mesmo bloco (appendChild move o que ja esta no DOM) — criar
        // outro duplicaria o botao, que foi o que aconteceu com "Copiar conversa".
        let sd = row.querySelector('.job-doc-slot');
        const solto = !!(sd && sd.classList.contains('job-doc-solto'));
        // Tentar pra sempre e o que custava caro. A bolha aparece nos
        // primeiros instantes de pintura ou nao aparece mais — depois de
        // algumas tentativas o bloco solto E o resultado final, e remedir a
        // geometria daquela linha a cada mutacao da conversa nao muda nada,
        // so gasta. Cinco e folga: na pratica acerta na primeira ou na segunda.
        if (solto) sd._jobTentativas = (sd._jobTentativas || 0) + 1;
        const tentarDeNovo = solto && sd._jobTentativas <= 5;
        pendente = tentarDeNovo;
        if (!sd || tentarDeNovo) {
          const ancoraD = _docAncora(row);
          const r = _trBolhaDoc(row, ancoraD);
          const lado = _trLado(ancoraD || r.alvo, row) === 'consultor' ? 'job-tr-dir' : 'job-tr-esq';
          // Ja estava solto e continua sem bolha: deixa quieto, nao fica pulando.
          if (r && r.alvo && !(sd && r.solto)) {
            if (!sd) { sd = document.createElement('div'); sd.dataset.msg = id; }
            sd.className = 'job-doc-slot' + (r.solto ? ' job-doc-solto ' + lado : '');
            r.alvo.appendChild(sd);
            // Ultima defesa: pergunta pra TELA se o bloco existe de verdade.
            // Alvo substituido (<img>, <canvas>) aceita o filho no DOM e nao
            // pinta nada — o botao sumia sem erro nenhum.
            if (!r.solto && !sd.getClientRects().length) {
              sd.className = 'job-doc-slot job-doc-solto ' + lado;
              row.appendChild(sd);
            }
            docRenderSlot(sd, id);
            // Nasceu solto: a linha ainda nao pode ser dada por pronta, senao
            // ela nunca mais tenta achar a bolha e o botao fica pra sempre no
            // canto. Continua pendente ate acertar ou gastar as tentativas.
            if (sd.classList.contains('job-doc-solto')) {
              pendente = (sd._jobTentativas || 0) <= 5;
            }
          }
        }
      }
      if (row.querySelector('.job-tr-slot[data-msg="' + (window.CSS && window.CSS.escape ? window.CSS.escape(id) : id) + '"]:not(.job-doc-slot)')) {
        if (!pendente) row._jobPronta = id;
        continue;
      }
      if (!_trLinhaEhAudio(row)) {
        // Nao e audio e o documento ja esta resolvido: nao ha mais nada pra
        // fazer nesta linha enquanto ela for esta mensagem. E o caso da imensa
        // maioria das linhas de uma conversa — texto puro.
        if (!pendente) row._jobPronta = id;
        continue;
      }
      const bolha = _trBolha(row);
      if (!bolha) continue;             // sem bolha identificada, nao inventa lugar
      const slot = document.createElement('div');
      slot.className = 'job-tr-slot ' + (_trLado(bolha, row) === 'consultor' ? 'job-tr-dir' : 'job-tr-esq');
      slot.dataset.msg = id;
      // DENTRO da bolha: herda posicao, largura e cor de quem ja esta no lugar certo.
      bolha.appendChild(slot);
      trRenderSlot(slot, id);
      if (!pendente) row._jobPronta = id;
    }
    const _gasto = performance.now() - _t0;
    TR.perf.ms += _gasto;
    if (_gasto > TR.perf.pior) TR.perf.pior = _gasto;
  }

  function trRenderSlot(slot, id) {
    const texto = TR.cache.get(id);
    if (TR.ocupado.has(id)) {
      slot.innerHTML = '<div class="job-tr-carregando">transcrevendo…</div>';
      return;
    }
    if (texto === undefined) {
      slot.innerHTML = '<button class="job-tr-btn" type="button">' + _ICO_TRANSCREVER + 'Transcrever</button>';
      const b = slot.querySelector('button');
      if (b) b.addEventListener('click', (ev) => { ev.stopPropagation(); trTranscrever(id); });
      return;
    }
    if (texto === '') {
      // Mensagem curta e discreta: o erro tecnico vai pro title, nao pra tela.
      // Uma linha vermelha do tamanho da conversa inteira pra cada audio que
      // falhou e pior do que nao ter transcricao nenhuma.
      // Falhou: volta a ser o MESMO botao de antes, que e o que a pessoa quer
      // clicar. "tentar de novo" como link separado ao lado de uma frase de erro
      // e feio e redundante — o botao ja e a tentativa. O motivo fica no
      // title, discreto, e some assim que der certo.
      const pq = TR.erro.get(id) || '';
      slot.innerHTML = '<button class="job-tr-btn falhou" type="button" title="' +
        esc(pq || 'não deu certo — clique pra tentar de novo') + '">' +
        _ICO_TRANSCREVER + 'Transcrever</button>' +
        (pq ? '<span class="job-tr-motivo">' + esc(pq) + '</span>' : '');
      const b = slot.querySelector('button');
      if (b) b.addEventListener('click', (ev) => {
        ev.stopPropagation(); TR.cache.delete(id); TR.erro.delete(id); trTranscrever(id);
      });
      return;
    }
    slot.innerHTML = '<div class="job-tr-texto"><span class="job-tr-tag">transcricao</span>' +
      esc(texto) + '<button class="job-tr-copiar" type="button" title="Copiar">' + _ICO_COPIAR + '</button></div>';
    const c = slot.querySelector('.job-tr-copiar');
    if (c) c.addEventListener('click', (ev) => {
      ev.stopPropagation();
      navigator.clipboard.writeText(texto).then(() => {
        c.classList.add('ok');
        setTimeout(() => c.classList.remove('ok'), 1200);
      }).catch(() => {});
    });
  }

  function trAtualizarSlot(id) {
    document.querySelectorAll('.job-tr-slot[data-msg="' + (window.CSS && window.CSS.escape ? window.CSS.escape(id) : id) + '"]')
      .forEach((slot) => trRenderSlot(slot, id));
  }

  async function trTranscrever(id) {
    if (TR.ocupado.has(id)) return;
    TR.ocupado.add(id);
    trAtualizarSlot(id);
    try {
      // 1) Já transcrito antes? Custa nada e responde na hora.
      const cache = await _safeSendMessage({ type: 'transcricoes_cache', ids: [id] }).catch(() => null);
      if (cache && cache.ok && (cache.transcricoes || {})[id]) {
        TR.cache.set(id, cache.transcricoes[id]);
        return;
      }
      if (cache && cache.ok && typeof cache.gasto_mes_usd === 'number'
          && cache.gasto_mes_usd >= cache.teto_mes_usd) {
        TR.erro.set(id, 'teto de custo do mês atingido');
        TR.cache.set(id, '');
        return;
      }
      // 2) Baixa só ESTE áudio. É o único ponto que precisa da wa-js.
      const baixado = await _pedirPonte('baixar_audios_ids', { ids: [id] }, 90000);
      const audios = (baixado && baixado.audios) || [];
      if (!audios.length) {
        // O bridge agora diz o motivo POR AUDIO — usa ele antes de qualquer
        // mensagem generica minha.
        const pq = (baixado && baixado.erros && baixado.erros[id])
                || (baixado && baixado.erro) || 'não consegui baixar o áudio';
        TR.erro.set(id, pq);
        TR.cache.set(id, '');
        return;
      }
      const r = await _safeSendMessage({ type: 'transcrever_audios', audios }).catch(() => null);
      if (!r || !r.ok) {
        TR.erro.set(id, (r && (r.detalhe || r.erro)) || 'o JOB não respondeu');
        TR.cache.set(id, '');
        return;
      }
      TR.cache.set(id, (r.transcricoes || {})[id] || '');
      TR.erro.delete(id);
    } catch (e) {
      TR.cache.set(id, '');
      TR.erro.set(id, String((e && e.message) || e).slice(0, 90));
    } finally {
      TR.ocupado.delete(id);
      trAtualizarSlot(id);
      TR.diag = { etapa: 'sob_demanda', ultimo: id, cache: TR.cache.size,
                  quando: new Date().toLocaleTimeString('pt-BR') };
    }
  }

  // ── BARRA NO CABECALHO DA CONVERSA ──────────────────────────────────────
  //
  // Estava no trilho lateral e o Guilherme reclamou com razao: as duas acoes sao
  // SOBRE A CONVERSA ABERTA, entao o lugar delas e junto do nome dela — nao numa
  // gaveta que precisa ser aberta pra descobrir a que conversa se referem. Mesma
  // logica do botao dentro da bolha: a acao mora onde esta o objeto dela.
  //
  // So acrescenta filho no fim do cabecalho, nunca mexe em no existente, e e
  // idempotente (marca .job-barra-conv).
  function _barraConvInjetar() {
    const main = document.querySelector('#main');
    if (!main) return;
    const cab = main.querySelector('header');
    if (!cab || cab.querySelector('.job-barra-conv')) return;
    const box = document.createElement('div');
    box.className = 'job-barra-conv';
    box.innerHTML =
      '<button type="button" class="job-bc-btn" data-ac="transcrever" title="Transcrever todos os áudios desta conversa">' +
        _ICO_TRANSCREVER + '<span>Transcrever tudo</span></button>' +
      '<button type="button" class="job-bc-btn" data-ac="copiar" title="Copiar a conversa inteira: texto e áudio transcrito, na ordem, com hora e quem falou">' +
        _ICO_COPIAR + '<span>Copiar conversa</span></button>';
    cab.appendChild(box);

    const btn = (ac) => box.querySelector('[data-ac="' + ac + '"]');
    const rotulo = (b, t) => { const e = b.querySelector('span'); if (e) e.textContent = t; };

    const bt = btn('transcrever');
    bt.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (bt.disabled) return;
      bt.disabled = true;
      const r0 = 'Transcrever tudo';
      try {
        const p = await transcreverTudo((x) => {
          rotulo(bt, x.rodando ? (x.feitos + '/' + x.total) : r0);
        });
        rotulo(bt, p.total === 0 ? 'Sem áudio'
          : (p.erros ? p.erros + ' falhou(ram)' : 'Pronto: ' + p.total));
      } catch (e) {
        rotulo(bt, 'Falhou');
      } finally {
        setTimeout(() => { rotulo(bt, r0); bt.disabled = false; }, 2600);
      }
    });

    const bc = btn('copiar');
    bc.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (bc.disabled) return;
      bc.disabled = true;
      const r0 = 'Copiar conversa';
      try {
        const r = await conversaEmTexto();
        if (!r.total) { rotulo(bc, 'Conversa vazia'); return; }
        await navigator.clipboard.writeText(r.texto);
        // Diz o buraco em vez de esconder: copiar "com sucesso" sem avisar que 6
        // audios faltaram faz colar um registro furado sem saber.
        rotulo(bc, r.semTranscricao ? (r.total + ' copiadas · ' + r.semTranscricao + ' áudio(s) sem transcrição')
                                    : (r.total + ' copiadas'));
      } catch (e) {
        rotulo(bc, 'Não deu');
      } finally {
        setTimeout(() => { rotulo(bc, r0); bc.disabled = false; }, 3200);
      }
    });
  }

  const _ICO_DOC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
    '<polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>';
  const _ICO_MAIS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
  const _ICO_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  const _ICO_ABRIR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M10 14 21 3M18 13v8H3V6h8"/></svg>';

  // ── COPIAR A CONVERSA INTEIRA ───────────────────────────────────────────
  // Texto e audio transcrito no MESMO fio, na ordem do WhatsApp, com hora e quem
  // falou. E o que faltava pra conversa sair daqui e virar registro em qualquer
  // lugar — e-mail pra operadora, ficha do lead, analise fora da ferramenta.
  // Audio sem transcricao entra marcado, nao sumido: a conversa tem que
  // continuar fazendo sentido, e quem le precisa saber que ali falta um pedaco.
  async function conversaEmTexto() {
    const conv = await _pedirPonte('ler_conversa_completa', { limite: 800 }, 25000);
    const msgs = (conv && conv.mensagens) || [];
    if (!msgs.length) return { texto: '', total: 0, semTranscricao: 0 };
    // Transcricoes: as desta sessao mais as que o JOB ja guardou (nao paga de novo).
    const ids = msgs.filter((m) => m.tipo === 'ptt' || m.tipo === 'audio').map((m) => m.msg_id);
    const doServidor = {};
    if (ids.length) {
      const r = await _safeSendMessage({ type: 'transcricoes_cache', ids }).catch(() => null);
      if (r && r.ok) Object.assign(doServidor, r.transcricoes || {});
    }
    const quem = (m) => (m.de === 'consultor' ? 'Você' : (conv.titulo || m.nome || 'Cliente'));
    const linhas = [];
    let semTranscricao = 0;
    for (const m of msgs) {
      let corpo = m.texto;
      if (m.tipo === 'ptt' || m.tipo === 'audio') {
        const t = TR.cache.get(m.msg_id) || doServidor[m.msg_id] || '';
        if (t) corpo = '[áudio] ' + t;
        else { corpo = '[áudio não transcrito]'; semTranscricao++; }
      } else if (!corpo && m.rotulo) {
        corpo = '[' + m.rotulo + ']';
      }
      if (!corpo) continue;
      linhas.push('[' + m.hora + '] ' + quem(m) + ': ' + corpo);
    }
    const cab = (conv.titulo ? conv.titulo + ' — ' : '') +
                'conversa do WhatsApp · ' + linhas.length + ' mensagem(ns)' +
                ' · copiado em ' + new Date().toLocaleString('pt-BR');
    return { texto: cab + '\n\n' + linhas.join('\n'), total: linhas.length, semTranscricao };
  }

  // ── TRANSCREVER TUDO ────────────────────────────────────────────────────
  // Um a um, de proposito. Disparar dez downloads e dez chamadas de IA de uma vez
  // trava o WhatsApp e pode estourar o teto de custo sem o consultor ver. O que
  // ja esta em cache nao e refeito — o segundo clique custa zero.
  const TRTUDO = { rodando: false, feitos: 0, total: 0, erros: 0, pulados: 0 };

  // Cede o processador. requestAnimationFrame espera o proximo quadro pintar —
  // e a garantia de que a interface andou; o setTimeout e o piso pra aba em
  // segundo plano, onde rAF nao dispara.
  function _respirar() {
    return new Promise((r) => {
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(r, 0));
      else setTimeout(r, 16);
    });
  }
  function _quandoVisivel() {
    return new Promise((r) => {
      if (!document.hidden) return r();
      const f = () => { if (!document.hidden) { document.removeEventListener('visibilitychange', f); r(); } };
      document.addEventListener('visibilitychange', f);
    });
  }

  async function transcreverTudo(aoAndar) {
    if (TRTUDO.rodando) return TRTUDO;
    const conv = await _pedirPonte('ler_conversa_completa', { limite: 800 }, 25000);
    const ids = (conv && conv.audios) || [];
    Object.assign(TRTUDO, { rodando: true, feitos: 0, total: ids.length, erros: 0, pulados: 0 });
    if (aoAndar) aoAndar(TRTUDO);
    try {
      // Pergunta de uma vez o que ja existe: barato, e evita pagar de novo.
      const jaTem = {};
      if (ids.length) {
        const r = await _safeSendMessage({ type: 'transcricoes_cache', ids }).catch(() => null);
        if (r && r.ok) Object.assign(jaTem, r.transcricoes || {});
      }
      // Os que ja tem texto saem PRIMEIRO e de uma vez: e so pintar, nao ha
      // rede nem decodificacao envolvida. Isso faz a maioria dos audios
      // aparecer instantaneamente e deixa a fila cara so com o que falta.
      const faltam = [];
      for (const id of ids) {
        const pronto = TR.cache.get(id) || jaTem[id];
        if (pronto) {
          TR.cache.set(id, pronto);
          trAtualizarSlot(id);
          TRTUDO.pulados++; TRTUDO.feitos++;
        } else {
          faltam.push(id);
        }
      }
      if (aoAndar) aoAndar(TRTUDO);

      for (const id of faltam) {
        // DEVOLVE A MAO PRO NAVEGADOR entre um audio e outro.
        //
        // Era aqui que travava: baixar e decodificar audio em base64 e trabalho
        // pesado, e um `for` com await encadeado nunca solta o event loop tempo
        // suficiente — o WhatsApp fica sem processar rolagem, clique e render
        // enquanto a fila anda. Duas pausas curtas custam quase nada no total e
        // devolvem a interface pra quem esta usando.
        await _respirar();
        await trTranscrever(id);
        if (!TR.cache.get(id)) TRTUDO.erros++;
        TRTUDO.feitos++;
        if (aoAndar) aoAndar(TRTUDO);
        await _respirar();
        // Aba escondida: para de trabalhar e volta quando ela aparecer. Sem
        // isso a fila continua consumindo CPU numa aba que ninguem esta vendo.
        if (document.hidden) await _quandoVisivel();
      }
    } finally {
      TRTUDO.rodando = false;
      if (aoAndar) aoAndar(TRTUDO);
    }
    return TRTUDO;
  }

  const _ICO_TRANSCREVER = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>' +
    '<path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>';
  // _ICO_COPIAR já existe no arquivo — reusado aqui.

  // Injeção: observa SÓ a lista de mensagens, com folga. Sem reposicionamento em
  // rolagem, sem varredura, sem chamada de rede — a injeção é só criar um botão
  // nas bolhas novas. Foi o reposicionamento por coordenada que pesou antes.
  let _trTimer = null;
  let _trPend = [];
  function trAgendarInjecao(raizes) {
    if (raizes && raizes.length) _trPend.push(...raizes);
    if (_trTimer) return;
    _trTimer = setTimeout(() => {
      _trTimer = null;
      const lote = _trPend; _trPend = [];
      try { trInjetar(lote); } catch (e) {}
    }, 400);
  }


  // ── CANARIO ──────────────────────────────────────────────────────────────
  // A extensao vive dentro do WhatsApp, que muda sem avisar. Quando muda, o
  // sintoma chega distorcido ("o JOB parou", "o WhatsApp travou") e dias
  // depois. Isto pergunta a cada peca se ela ainda funciona e manda pro JOB.
  //
  // As sondas de TELA medem o que quebrou de verdade em 01/08: de todas as
  // bolhas de arquivo visiveis, quantas ficaram sem o bloco. E o teste do
  // sintoma, nao do seletor — se o WhatsApp trocar o nome do icone, isto acusa
  // do mesmo jeito que se ele trocar a arvore.
  async function _canarioTela() {
    const main = document.querySelector('#main');
    if (!main) return [];                     // nenhuma conversa aberta: nao avalia
    // MEDIR DEPOIS DE INJETAR, nao no meio.
    //
    // Ele contava as bolhas no instante em que rodava — inclusive as que
    // acabaram de entrar na tela pela rolagem e que o injetor ainda nao tinha
    // visitado. Dava '4 de 5' e '12 de 14' e acusava quebra num bloco que
    // funciona: media a corrida, nao a capacidade. Forca uma passada e da um
    // tempo pro DOM assentar antes de contar.
    try { trInjetar(); } catch (e) { /* injetar nao pode derrubar o canario */ }
    await new Promise((r) => setTimeout(r, 350));
    const out = [];
    const linhas = main.querySelectorAll('[data-id]');
    out.push({ cap: 'dom_linhas', ok: linhas.length > 0, ms: 0,
               detalhe: linhas.length + ' linhas na tela' });
    if (!linhas.length) return out;
    let arq = 0, arqOk = 0, aud = 0, audOk = 0;
    for (const row of linhas) {
      try {
        if (_trLinhaEhAudio(row)) {
          aud++;
          if (row.querySelector('.job-tr-slot')) audOk++;
        } else if (_docLinhaEhArquivo(row)) {
          arq++;
          if (row.querySelector('.job-doc-slot')) arqOk++;
        }
      } catch (e) { /* uma linha estranha nao derruba a rodada */ }
    }
    // Zero bolhas daquele tipo na tela nao e falha — e ausencia de amostra.
    if (arq) out.push({ cap: 'dom_arquivo', ok: arqOk === arq, ms: 0,
                        detalhe: arqOk + ' de ' + arq + ' bolhas de arquivo com o bloco' });
    if (aud) out.push({ cap: 'dom_audio', ok: audOk === aud, ms: 0,
                        detalhe: audOk + ' de ' + aud + ' bolhas de audio com o bloco' });
    return out;
  }

  async function canarioRodar(motivo) {
    let daPonte = [], semConversa = false;
    try {
      const r = await _pedirPonte('canario', {}, 20000);
      daPonte = (r && r.checagens) || [];
      semConversa = !!(r && r.semConversa);
    } catch (e) {
      // A ponte nao responder JA E a noticia: significa que o mundo do
      // WhatsApp nao esta alcancavel a partir daqui.
      daPonte = [{ cap: 'wa_js', ok: false, ms: 0,
                   detalhe: 'a ponte nao respondeu: ' + String((e && e.message) || e).slice(0, 120) }];
    }
    const checagens = daPonte.concat(await _canarioTela());
    if (!checagens.length) return null;
    try {
      await _safeSendMessage({ type: 'canario', versao: _versaoExt(), checagens: checagens });
    } catch (e) { /* sem rede agora; a proxima rodada conta */ }
    const ruins = checagens.filter((c) => !c.ok);
    if (ruins.length) console.warn('[JOB canario] ' + motivo + ' — quebrado:',
      ruins.map((c) => c.cap + ' (' + (c.detalhe || '') + ')').join(' | '));
    checagens.semConversa = semConversa;
    return checagens;
  }

  function _versaoExt() {
    try { return (chrome.runtime.getManifest() || {}).version || ''; } catch (e) { return ''; }
  }

  // Rodar na hora, do console, quando eu precisar diagnosticar junto com ele:
  //   window.__jobCanario().then(console.table)
  try { window.__jobCanario = () => canarioRodar('pedido na mao'); } catch (e) {}

  function canarioIniciar() {
    // 40 s depois de carregar: o WhatsApp precisa ter subido o store, e a
    // primeira meia dezena de segundos ja e disputada demais.
    setTimeout(() => { canarioRodar('na abertura'); }, 40000);
    // De 6 em 6 horas. Nao e monitoramento de segundo a segundo — e detectar
    // uma atualizacao do WhatsApp no mesmo dia, em vez de na semana seguinte.
    setInterval(() => { canarioRodar('rodada periodica'); }, 6 * 60 * 60 * 1000);
  }

  function trIniciar() {
    setTimeout(() => {
      trInjetar();
      const main = document.querySelector('#main') || document.body;
      // Passa adiante SO os nos adicionados — e a informacao que o proprio
      // observer ja entrega de graca e que eu estava jogando fora.
      // NAO ESCUTAR A SI MESMA. Era isto que travava o WhatsApp.
      //
      // A extensao escreve no DOM (cria o bloco, troca o innerHTML do botao,
      // pinta a etapa da leitura a cada segundo). Cada escrita dessas e uma
      // mutacao DENTRO do #main — que este mesmo observer via, e que agendava
      // outra passada, que escrevia de novo. Laco fechado: com uma conversa
      // aberta a extensao ficava varrendo a tela pra sempre, sozinha, medindo
      // geometria linha por linha. Nao era lentidao de uma funcao: era trabalho
      // que nunca terminava.
      //
      // O truque e um closest SO, com os dois seletores juntos. Se o que vier
      // primeiro subindo for um bloco NOSSO, a mutacao foi nossa e nao
      // interessa. Se for a linha do WhatsApp, ai sim ha o que fazer. Um
      // closest a mais por registro custaria caro justamente nos momentos de
      // rolagem, que e quando ha milhares deles.
      const _MEU = '.job-doc-slot, .job-tr-slot, .job-barra-conv, .job-painel, .job-modal';
      const obs = new MutationObserver((regs) => {
        // Set, nao array: rolar a conversa gera milhares de registros que
        // apontam pra mesma meia duzia de linhas. Sem isto, a mesma linha era
        // varrida centenas de vezes na mesma passada.
        const novos = new Set();
        // O NO ADICIONADO NAO BASTA. Quando o WhatsApp re-renderiza o interior de
        // uma bolha que ja existe, ele apaga o meu bloco junto (ele nao conhece
        // esse filho) e adiciona os filhos dele de volta. A linha em si nunca e
        // re-adicionada, e os nos adicionados nao tem data-id nem contem um —
        // entao a varredura nao visitava aquela linha e o botao sumia de vez.
        // Era exatamente o que acontecia ao rolar a conversa: o botao ia embora
        // e nao voltava, mesmo com o arquivo ainda marcado la em cima.
        // Subir ate a linha resolve os dois casos: linha nova e linha redesenhada.
        for (const r of regs) {
          const t = r.target;
          // O WhatsApp APAGOU um bloco nosso. Acontece toda vez que ele
          // redesenha o interior de uma bolha: ele nao conhece aquele filho e
          // leva junto. Aqui a linha precisa perder a marca de "ja esta
          // pronta", senao o botao some ao rolar a conversa e nao volta — que
          // era o bug antigo, e o pulo de linha pronta o traria de volta.
          if (r.removedNodes && r.removedNodes.length) {
            for (const n of r.removedNodes) {
              if (n.nodeType !== 1 || !n.classList) continue;
              if (!n.classList.contains('job-doc-slot') && !n.classList.contains('job-tr-slot')) continue;
              const linha = t && t.closest ? t.closest('[data-id]') : null;
              if (linha) { linha._jobPronta = null; novos.add(linha); }
            }
          }
          if (t && t.nodeType === 1 && t.closest) {
            const alvo = t.closest('[data-id], ' + _MEU);
            // Achou um bloco nosso antes da linha: escrita nossa, ignora.
            if (alvo && alvo.hasAttribute('data-id')) novos.add(alvo);
          }
          if (!r.addedNodes || !r.addedNodes.length) continue;
          for (const n of r.addedNodes) {
            if (n.nodeType !== 1) continue;
            if (n.classList && (n.classList.contains('job-doc-slot') ||
                                n.classList.contains('job-tr-slot'))) continue;
            const pai = n.closest ? n.closest('[data-id], ' + _MEU) : null;
            if (pai && pai.hasAttribute('data-id')) novos.add(pai);
            else if (!pai && n.querySelector && n.querySelector('[data-id]')) novos.add(n);
          }
        }
        TR.perf.regs += regs.length;
        if (novos.size) trAgendarInjecao([...novos]);
      });
      obs.observe(main, { childList: true, subtree: true });
      // Troca de conversa troca o #main inteiro: reobserva sem drama.
      // Ronda so pra reatar o observer quando a CONVERSA troca (#main e
      // recriado). Nao varre mais a conversa inteira a cada 4s: se nada mudou,
      // nao ha o que injetar, e o observer avisa quando muda.
      setInterval(() => {
        const m = document.querySelector('#main');
        if (m && !m._jobTrObservado) {
          m._jobTrObservado = true;
          obs.observe(m, { childList: true, subtree: true });
          trInjetar();               // varredura cheia UMA vez, na troca de conversa
        }
      }, 4000);
      try { canarioIniciar(); } catch (e) { /* canario nao pode derrubar a extensao */ }
    }, 6000);
  }

  function trDiagnosticoHtml() {
    const d = TR.diag || {};
    const p = TR.perf;
    // Quanto a extensao custou desde que a aba abriu.
    //
    // "A extensao ta lenta" e indistinguivel de "o WhatsApp ta lento" sem
    // numero. Media e enganosa aqui — uma passada de 400ms trava a digitacao
    // e some numa media de centenas de passadas —, entao mostra a PIOR
    // tambem. E "linhas puladas" e a medida direta do conserto: quanto maior
    // a proporcao, menos geometria esta sendo remedida a toa.
    const total = p.linhas || 1;
    const perf = '<div class="job-tr-diag"><b>Custo:</b> ' +
      p.passadas + ' passada(s) · ' + Math.round(p.ms) + 'ms no total · pior ' +
      Math.round(p.pior) + 'ms · ' + p.regs + ' mutações vistas · ' +
      Math.round(p.puladas / total * 100) + '% das linhas puladas</div>';
    return '<div class="job-tr-diag"><b>Transcrição:</b> sob demanda · ' +
      document.querySelectorAll('.job-tr-slot').length + ' botão(ões) na tela · ' +
      TR.cache.size + ' em memória · ' + TR.erro.size + ' com erro' +
      (d.quando ? ' <span class="job-tr-diag-h">' + esc(d.quando) + '</span>' : '') + '</div>' + perf;
  }

  // ═══════════════ Modo desenvolvedor ═══════════════
  // Tudo na mão: o que está de pé, o que falhou e por quê, com botão pra disparar
  // cada coisa na hora em vez de esperar o relógio. Existe porque um recurso que
  // falha calado é indistinguível de um recurso que não existe — foi o que
  // aconteceu com a transcrição, e me custou três rodadas de adivinhação.
  let _devLigado = false;

  async function abrirSecaoDev() {
    setCorpoSecao('<div class="job-sem-analise"><div class="job-carregando"></div>' +
                  '<div class="job-sem-analise-txt">Coletando estado…</div></div>');
    const ponte = await _pedirPonte('listar_audios', {}, 12000);
    const temWpp = !(ponte && ponte.erro === 'wpp_ausente');
    const d = TR.diag || {};
    const linha = (rot, val, ruim) =>
      '<div class="job-dev-linha' + (ruim ? ' ruim' : '') + '"><span>' + esc(rot) +
      '</span><b>' + esc(val) + '</b></div>';
    setCorpoSecao(
      '<div class="job-dev">' +
        '<div class="job-cnpj-titulo">Diagnóstico</div>' +
        '<div class="job-cnpj-sub">Estado real de cada peça, agora.</div>' +
        linha('Versão da extensão', (chrome.runtime.getManifest() || {}).version || '?') +
        linha('Ponte wa-js', temWpp ? 'respondendo' : 'FORA (' + ((ponte && ponte.erro) || 'sem resposta') + ')', !temWpp) +
        linha('Conversa aberta', (ponte && ponte.chat_id) ? ponte.chat_id : 'nenhuma', !(ponte && ponte.chat_id)) +
        linha('Áudios na conversa', String((ponte && ponte.audios && ponte.audios.length) || 0)) +
        linha('Transcrições em memória', String(TR.cache.size)) +
        linha('Botões injetados', String(document.querySelectorAll('.job-tr-slot').length)) +
        linha('Última etapa', String(d.etapa || '—') + (d.quando ? ' · ' + d.quando : ''),
              d.etapa === 'ponte_fora') +
        (TR.erro.size ? linha('Último erro', Array.from(TR.erro.values()).slice(-1)[0], true) : '') +
        linha('Varredura (motivo)', VAR.motivo || '—') +
        linha('Varredura', VAR.rodando ? 'rodando agora'
              : (VAR.ultimaRodada ? 'última: ' + new Date(VAR.ultimaRodada).toLocaleTimeString('pt-BR') : 'ainda não rodou')) +
        linha('Varredura (placar)', VAR.placar.analisadas + ' analisadas · ' +
              VAR.placar.puladas + ' puladas · ' + VAR.placar.erros + ' erros') +
        '<div class="job-dev-btns">' +
          '<button class="job-cnpj-btn" id="dev-transcrever">Transcrever esta conversa agora</button>' +
          '<button class="job-cnpj-btn" id="dev-varrer">Rodar a varredura agora</button>' +
          '<button class="job-cnpj-btn" id="dev-repintar">Repintar etiquetas</button>' +
        '</div>' +
        '<div class="job-dev-saida" id="dev-saida"></div>' +
      '</div>');

    const saida = (t) => { const e = document.getElementById('dev-saida'); if (e) e.textContent = t; };
    const btn = (id, rot, fn) => {
      const b = document.getElementById(id);
      if (!b) return;
      b.addEventListener('click', async () => {
        b.disabled = true; const t0 = b.textContent; b.textContent = 'Rodando…';
        try { saida(await fn() || 'ok'); } catch (e) { saida('ERRO: ' + (e && e.message || e)); }
        b.disabled = false; b.textContent = t0;
        abrirSecaoDev();
      });
    };
    btn('dev-transcrever', 'transcrever', async () => {
      trInjetar();
      return 'botões na tela=' + document.querySelectorAll('.job-tr-slot').length +
             ' · em memória=' + TR.cache.size;
    });
    btn('dev-varrer', 'varrer', async () => {
      const p = await varreduraRodar(true);
      return 'analisadas=' + p.analisadas + ' · puladas=' + p.puladas + ' · erros=' + p.erros;
    });
    btn('dev-repintar', 'repintar', async () => {
      trInjetar(); return 'slots=' + document.querySelectorAll('.job-tr-slot').length;
    });
  }

  // ═══════════════ Varredura diária das conversas ═══════════════
  // Roda sozinha, em segundo plano, e é deliberadamente LENTA: uma conversa por
  // vez com pausa entre elas. O gargalo não é o servidor, é a máquina do
  // consultor (baixar e descriptografar áudio) — e ele está trabalhando nela.
  const VAR = {
    ligada: true,
    rodando: false,
    ultimaRodada: 0,
    INTERVALO_MS: 30 * 60 * 1000,   // de meia em meia hora
    PAUSA_ENTRE_MS: 8000,           // respiro entre conversas
    MAX_POR_RODADA: 12,             // teto por rodada, pra nunca virar mutirão
    HORAS: 24,
    motivo: '',
    placar: { analisadas: 0, puladas: 0, erros: 0 },
  };

  // Config vem do SERVIDOR (/configuracoes). Nasce desligada: um mecanismo que
  // gasta dinheiro e usa a máquina do consultor não pode ligar sozinho porque
  // alguém instalou a extensão.
  async function varreduraConfig() {
    try {
      const { usuarioId } = await _safeStorageGet(['usuarioId']);
      const r = await fetch(_SITE_BASE_URL_EXT + '/api/whatsapp/config-remota' +
                            (usuarioId ? '?usuario_id=' + encodeURIComponent(usuarioId) : ''),
                            { cache: 'no-store' });
      const d = await r.json();
      return (d && d.varredura) || null;
    } catch (e) { return null; }
  }

  async function varreduraRodar(manual) {
    if (VAR.rodando) return VAR.placar;
    const cfg = await varreduraConfig();
    if (!cfg) { VAR.motivo = 'sem_config'; return VAR.placar; }
    VAR.motivo = cfg.motivo || '';
    if (!manual && !cfg.pode_rodar) return VAR.placar;
    // O painel manda os números: intervalo, teto e janela deixam de estar
    // cravados no código, onde ninguém conseguia mexer.
    VAR.INTERVALO_MS = Math.max(5, cfg.intervalo_min || 30) * 60000;
    VAR.MAX_POR_RODADA = Math.max(1, cfg.max_rodada || 12);
    VAR.HORAS = Math.max(1, cfg.horas || 24);
    if (!manual && !cfg.rodar_agora && Date.now() - VAR.ultimaRodada < VAR.INTERVALO_MS) return VAR.placar;
    VAR.rodando = true;
    VAR.ultimaRodada = Date.now();
    try {
      const lista = await _pedirPonte('listar_conversas_dia', { horas: VAR.HORAS }, 40000);
      const conversas = (lista && lista.conversas) || [];
      if (!conversas.length) return VAR.placar;

      // 1) PERGUNTA ANTES DE SUBIR: o servidor é quem sabe o que já foi
      //    analisado. Conversa sem novidade nunca sai daqui.
      const decisao = await _safeSendMessage({ type: 'conversas_pendentes', conversas }).catch(() => null);
      if (!decisao || !decisao.ok) return VAR.placar;
      VAR.placar.puladas += (decisao.pular || []).length;
      const fila = (decisao.analisar || []).slice(0, VAR.MAX_POR_RODADA);
      const porId = {};
      conversas.forEach((c) => { porId[c.chat_id] = c; });

      for (const alvo of fila) {
        if (!VAR.ligada && !manual) break;
        try {
          await varreduraUmaConversa(alvo, porId[alvo.chat_id] || {});
          VAR.placar.analisadas += 1;
        } catch (e) {
          VAR.placar.erros += 1;
        }
        await new Promise((r) => setTimeout(r, VAR.PAUSA_ENTRE_MS));
      }
    } finally {
      VAR.rodando = false;
    }
    return VAR.placar;
  }

  async function varreduraUmaConversa(alvo, meta) {
    const conv = await _pedirPonte('ler_conversa_de',
      { chatId: alvo.chat_id, desdeMsgId: alvo.desde_msg_id, limite: 400 }, 60000);
    if (!conv || conv.erro) throw new Error(conv && conv.erro || 'falha_leitura');
    const audios = conv.audios || [];

    // 2) Áudio já transcrito NÃO é baixado nem enviado: manda só o id, e o
    //    servidor usa o cache. É o que faz a varredura custar quase nada depois
    //    que a transcrição inline já passou pela conversa.
    let cacheados = {};
    if (audios.length) {
      const r = await _safeSendMessage({ type: 'transcricoes_cache',
        ids: audios.map((a) => a.msg_id) }).catch(() => null);
      if (r && r.ok) cacheados = r.transcricoes || {};
    }
    const semCache = audios.filter((a) => !(a.msg_id in cacheados)).map((a) => a.msg_id);
    const baixados = {};
    if (semCache.length) {
      // Lotes pequenos: baixar 30 áudios de uma vez é o que trava a máquina.
      for (let i = 0; i < semCache.length; i += 3) {
        const r = await _pedirPonte('baixar_audios_ids', { ids: semCache.slice(i, i + 3) }, 90000);
        ((r && r.audios) || []).forEach((a) => { baixados[a.msg_id] = a; });
        await new Promise((res) => setTimeout(res, 1200));
      }
    }
    const payloadAudios = audios.map((a) => {
      const b = baixados[a.msg_id];
      return b ? { msg_id: a.msg_id, de: a.de, hora: a.hora, base64: b.base64, mime: b.mime }
               : { msg_id: a.msg_id, de: a.de, hora: a.hora };   // servidor usa o cache
    });

    // 3) MODO ECONÔMICO: sem imagem e sem PDF. É onde o custo mora, e o que
    //    preenche o CRM sai da conversa falada.
    const { usuarioId } = await _safeStorageGet(['usuarioId']);
    const resp = await _safeSendMessage({
      type: 'analisar_varredura',
      payload: {
        economico: true,
        chat_id: alvo.chat_id,
        telefone: meta.telefone || '',
        nome: meta.nome || '',
        usuario_id: usuarioId || null,
        mensagens: conv.mensagens || [],
        audios: payloadAudios,
        ultima_msg_id: conv.ultima_msg_id || meta.ultima_msg_id || '',
        ultima_msg_em: meta.ultima_msg_em || 0,
      },
    });
    if (!resp || !resp.ok) throw new Error((resp && resp.erro) || 'falha_analise');
    return resp;
  }

  function varreduraIniciar() {
    // 4 minutos pra primeira checagem e 5 em 5 depois. A checagem em si é um GET
    // de config; se estiver desligada (o padrão), o custo é isso e mais nada.
    setTimeout(() => { varreduraRodar(false); }, 240000);
    setInterval(() => { varreduraRodar(false); }, 5 * 60 * 1000);
  }

  // ═══════════════ Ficha do lead (CRM dentro do WhatsApp) ═══════════════
  // O painel inteiro do CRM na mesma aba: etapa, sub-status, etiquetas, campos
  // personalizados, qualificação e atividade. Mora no #job-painel-doc, que é
  // filho do document.body — NUNCA do #main. Inserir nó estranho na árvore React
  // do WhatsApp corrompe a reconciliação e quebra o ENVIO DE MENSAGEM (já
  // aconteceu em produção com a barra de notas).
  let _ficha = null;        // último payload do servidor
  let _fichaTel = '';
  let _fichaSujo = false;   // tem alteração não salva?

  async function abrirSecaoFicha() {
    setCorpoSecao('<div class="job-sem-analise"><div class="job-carregando"></div><div class="job-sem-analise-txt">Abrindo a ficha do lead…</div></div>');
    let tel = '';
    try { tel = (await pedirTelefoneWpp()) || telefoneDoContato(); } catch (e) { tel = telefoneDoContato(); }
    if (!tel) {
      setCorpoSecao('<div class="job-erro">Abra uma conversa primeiro pra ver a ficha do lead.</div>');
      return;
    }
    _fichaTel = tel;
    await _carregarFicha({ telefone: tel });
  }

  async function _carregarFicha(alvo) {
    let resp;
    try { resp = await _safeSendMessage(Object.assign({ type: 'ficha_lead' }, alvo)); } catch (e) { resp = null; }
    if (!resp || !resp.ok) {
      setCorpoSecao('<div class="job-erro">Não consegui abrir a ficha agora. ' +
        '<button class="job-copy" id="job-ficha-retry" style="width:auto;display:inline;padding:4px 10px;margin-left:6px;">Tentar de novo</button></div>');
      const rt = document.getElementById('job-ficha-retry');
      if (rt) rt.addEventListener('click', () => _carregarFicha(alvo));
      return;
    }
    _ficha = resp;
    // Qual conversa esta aberta agora. E o que permite oferecer o botao de
    // vincular exatamente quando falta — e nao oferecer quando ja esta feito.
    try {
      const c = await _pedirPonte('obter_chat_id', {}, 8000);
      _chatAberto = (c && c.chat_id) || '';
    } catch (e) { _chatAberto = ''; }
    _fichaSujo = false;
    const idNovo = (resp.lead && resp.lead.id) || null;
    if (_fichaPend.leadId !== idNovo) _fichaPend = _fichaPendVazio(idNovo);
    if (!resp.existe) { _renderFichaSemLead(); return; }
    _renderFicha('dados');
  }

  function _renderFichaSemLead() {
    setCorpoSecao(
      '<div class="job-ficha">' +
        '<div class="job-cnpj-titulo">Sem lead no JOB</div>' +
        '<div class="job-cnpj-sub">Esse número não está no CRM. Cadastre pra ter etapa, etiquetas e qualificação aqui dentro.</div>' +
        '<button class="job-cnpj-btn" id="job-ficha-criar">Cadastrar este lead</button>' +
      '</div>');
    const b = document.getElementById('job-ficha-criar');
    if (b) b.addEventListener('click', () => abrirSecaoNovoLead());
  }

  // Abas em vez de rolagem longa: o consultor está no meio de uma conversa, e o
  // que ele precisa (mudar etapa, marcar etiqueta) tem que caber sem rolar.
  const _FICHA_ABAS = [
    { id: 'dados', rot: 'Lead' },
    { id: 'qualif', rot: 'Qualificação' },
    { id: 'ativid', rot: 'Atividade' },
  ];

  // ── NOME PADRONIZADO DO CONTATO ─────────────────────────────────────────
  //
  // O Guilherme ja nomeia assim na mao ("LEAD | Jenifer (MEU PROPRIO VERA CRUZ)",
  // "Sandra - Mae Da MARIANE (CLIENTE AMIL)") — o padrao existe, so nao e
  // consistente, porque depende de ele lembrar da forma naquele dia. O ganho
  // nao e escrever o nome: e escrever SEMPRE IGUAL, pra busca do WhatsApp achar
  // e pra bater o olho na lista e saber o que aquilo e.
  //
  // Nada automatico, por decisao dele: a agenda do telefone e pessoal e nao pode
  // ser reescrita pelas costas de ninguem. A extensao PROPOE, ele edita, e so
  // acontece o que ele clicar.
  const _PARTES_NOME = [
    { id: 'etapa',     rot: 'Etapa' },
    { id: 'origem',    rot: 'Origem' },
    { id: 'operadora', rot: 'Operadora' },
    { id: 'cidade',    rot: 'Cidade' },
    { id: 'consultor', rot: 'Consultor' },
  ];
  let _partesLigadas = { etapa: true, origem: true, operadora: false, cidade: false, consultor: false };

  function _pedacoDaFicha(id) {
    const f = _ficha, l = (f && f.lead) || {};
    if (id === 'etapa') {
      const e = ((f.etapas || []).find((x) => x.id === l.etapa)) || {};
      // Rotulo curto e estavel. O que interessa na lista do WhatsApp e o
      // ESTADO (e lead? ja e cliente?), nao o nome exato da coluna do funil.
      if (e.tipo === 'ganho') return 'CLIENTE';
      if (e.tipo === 'perdido') return '';
      return 'LEAD';
    }
    if (id === 'origem') {
      const o = (l.origem || '').toString();
      if (/facebook|meta|instagram/i.test(o)) return 'META';
      if (/google/i.test(o)) return 'GOOGLE';
      if (/indica/i.test(o)) return 'INDICACAO';
      if (/medsenior/i.test(o)) return 'MEDSENIOR';
      return '';
    }
    if (id === 'operadora') {
      const c = (f.campos_val || {});
      const v = (c.operadora_cotada && c.operadora_cotada.valor) || (c.plano_atual && c.plano_atual.valor) || '';
      return (v || '').split(',')[0].trim().toUpperCase();
    }
    if (id === 'cidade') return (l.cidade || '').trim();
    if (id === 'consultor') return (_ficha.responsavel_nome || '').split(' ')[0] || '';
    return '';
  }

  function _montarNomeContato() {
    const l = (_ficha && _ficha.lead) || {};
    const nome = (l.nome || nomeDoContato() || '').trim();
    const pre = _partesLigadas.etapa ? _pedacoDaFicha('etapa') : '';
    const dentro = ['origem', 'operadora', 'cidade', 'consultor']
      .filter((k) => _partesLigadas[k])
      .map((k) => _pedacoDaFicha(k))
      .filter(Boolean);
    // "LEAD | Gabriela Silveira (META · VERA CRUZ)" — prefixo primeiro porque e
    // o que agrupa na lista ordenada por nome; o contexto vai entre parenteses,
    // que e onde o olho ignora quando nao precisa dele.
    return (pre ? pre + ' | ' : '') + nome + (dentro.length ? ' (' + dentro.join(' · ') + ')' : '');
  }

  function _vcfDoContato(nome, tel) {
    const so = String(tel || '').replace(/\D/g, '');
    const e164 = so ? '+' + (so.startsWith('55') ? so : '55' + so) : '';
    // vCard 3.0: e o formato que iPhone e Android abrem sem app nenhum. FN e o
    // que aparece na agenda; N vai igual pra nao virar "sem sobrenome" no iOS.
    return ['BEGIN:VCARD', 'VERSION:3.0',
            'N:;' + nome + ';;;', 'FN:' + nome,
            (e164 ? 'TEL;TYPE=CELL:' + e164 : ''),
            'NOTE:Cadastrado pelo JOB Serenus',
            'END:VCARD'].filter(Boolean).join('\r\n');
  }

  function _blocoNomeContato() {
    return '<div class="job-nomec">' +
      '<div class="job-nomec-tit">Nome do contato' +
        '<span class="job-nomec-i" title="Monta o nome no mesmo padrão sempre, pra você achar o contato pela busca do WhatsApp e entender a lista de relance. Nada é salvo sozinho: você edita e escolhe o que fazer.">i</span>' +
      '</div>' +
      '<div class="job-nomec-chips">' +
        _PARTES_NOME.map((p) => '<button type="button" class="job-nomec-chip' +
          (_partesLigadas[p.id] ? ' on' : '') + '" data-parte="' + p.id + '">' + p.rot + '</button>').join('') +
      '</div>' +
      '<input type="text" class="job-campo" id="job-nomec-val">' +
      '<div class="job-nomec-btns">' +
        '<button type="button" class="job-cnpj-btn" id="job-nomec-copiar">Copiar nome</button>' +
        '<button type="button" class="job-cnpj-btn" id="job-nomec-vcf">Baixar contato (.vcf)</button>' +
      '</div>' +
      '<div class="job-nomec-dica" id="job-nomec-dica">Copie e cole em "Novo contato" do WhatsApp. ' +
        'O .vcf abre direto na agenda do celular — é o que leva o contato pro telefone.</div>' +
    '</div>';
  }

  function _ligarNomeContato() {
    const inp = document.getElementById('job-nomec-val');
    if (!inp) return;
    const dica = (t) => { const e = document.getElementById('job-nomec-dica'); if (e) e.textContent = t; };
    inp.value = _montarNomeContato();
    document.querySelectorAll('.job-nomec-chip').forEach((c) => {
      c.addEventListener('click', () => {
        const k = c.dataset.parte;
        // Chip sem conteudo naquele lead nao pode "ligar" e nao fazer nada —
        // isso parece defeito. Diz o que falta em vez de ficar mudo.
        if (!_partesLigadas[k] && !_pedacoDaFicha(k)) {
          dica('Este lead não tem ' + (c.textContent || '').toLowerCase() + ' preenchido no CRM.');
          return;
        }
        _partesLigadas[k] = !_partesLigadas[k];
        c.classList.toggle('on', _partesLigadas[k]);
        inp.value = _montarNomeContato();
        // Guarda a escolha: um padrao que muda a cada lead nao e padrao.
        try { chrome.storage.local.set({ jobNomeContatoPartes: _partesLigadas }); } catch (e) {}
      });
    });
    const bc = document.getElementById('job-nomec-copiar');
    if (bc) bc.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(inp.value.trim());
        bc.textContent = 'Copiado';
        dica('Agora abra "Novo contato" no WhatsApp e cole no campo Nome.');
        setTimeout(() => { bc.textContent = 'Copiar nome'; }, 1800);
      } catch (e) { dica('Não consegui copiar — selecione e copie à mão.'); }
    });
    const bv = document.getElementById('job-nomec-vcf');
    if (bv) bv.addEventListener('click', () => {
      const nome = inp.value.trim();
      if (!nome) { dica('Escreva um nome antes.'); return; }
      const tel = ((_ficha && _ficha.lead && _ficha.lead.telefone) || _fichaTel || '');
      const blob = new Blob([_vcfDoContato(nome, tel)], { type: 'text/vcard;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = nome.replace(/[\\/:*?"<>|]/g, '-').slice(0, 60) + '.vcf';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      dica('Baixado. Abra o arquivo no celular (AirDrop, e-mail ou Drive) pra salvar na agenda.');
    });
  }

  // Mesmo relogio do card do CRM, no mesmo formato — pra os dois lugares
  // contarem a mesma coisa do mesmo jeito.
  function _cronFichaTexto(segs) {
    const d = Math.floor(segs / 86400), h = Math.floor(segs / 3600) % 24;
    const m = Math.floor(segs / 60) % 60, s2 = Math.floor(segs) % 60;
    const dd = (n) => String(n).padStart(2, '0');
    if (d > 0) return d + 'd ' + dd(h) + ':' + dd(m);
    if (h > 0) return h + ':' + dd(m) + ':' + dd(s2);
    return dd(m) + ':' + dd(s2);
  }
  function _tickCronFicha() {
    const el = document.getElementById('job-cron-ss');
    if (!el || !el.dataset.desde) return;
    const segs = Math.max(0, Date.now() / 1000 - parseInt(el.dataset.desde, 10));
    el.textContent = _cronFichaTexto(segs);
    el.classList.remove('morno', 'parado');
    if (segs >= 432000) el.classList.add('parado');
    else if (segs >= 86400) el.classList.add('morno');
  }
  _registrarLoop(setInterval(_tickCronFicha, 1000));

  let _chatAberto = '';

  function _blocoVinculoChat(f, l) {
    const chats = (f && f.wa_chats) || [];
    const atual = _chatAberto || '';
    const jaTem = atual && chats.indexOf(atual) >= 0;
    const curto = atual ? (atual.split('@')[0].slice(0, 18) + (atual.split('@')[0].length > 18 ? '…' : '')) : '';
    const eLid = atual.indexOf('@lid') > 0;
    if (jaTem) {
      return '<div class="job-vinc ok">' +
        '<span class="job-vinc-tag ' + (eLid ? 'lid' : 'num') + '">' + (eLid ? '@lid' : 'nº') + '</span>' +
        '<code>' + esc(curto) + '</code>' +
        '<span class="job-vinc-txt">conversa vinculada a este lead</span></div>';
    }
    if (!atual) {
      return '<div class="job-vinc"><span class="job-vinc-txt">Não consegui identificar a conversa aberta.</span></div>';
    }
    return '<div class="job-vinc falta">' +
      '<span class="job-vinc-tag ' + (eLid ? 'lid' : 'num') + '">' + (eLid ? '@lid' : 'nº') + '</span>' +
      '<code>' + esc(curto) + '</code>' +
      '<button type="button" class="job-vinc-btn" id="job-vincular">Vincular esta conversa a este lead</button>' +
      '<div class="job-vinc-dica" id="job-vinc-dica">O @lid vive dentro do WhatsApp — só dá pra capturar com a conversa aberta. ' +
      'Depois disso o lead passa a mostrar o @lid no CRM e a conversa entra nas análises.</div></div>';
  }

  async function _ligarVinculoChat(l) {
    const b = document.getElementById('job-vincular');
    if (!b) return;
    const dica = (t) => { const e = document.getElementById('job-vinc-dica'); if (e) e.textContent = t; };
    b.addEventListener('click', async () => {
      b.disabled = true; const r0 = b.textContent; b.textContent = 'Vinculando…';
      try {
        let tel = '';
        try { tel = (await pedirTelefoneWpp()) || telefoneDoContato(); } catch (e) { tel = telefoneDoContato(); }
        const r = await _safeSendMessage({ type: 'vincular_chats', conversas: [
          { chat_id: _chatAberto, telefone: tel, nome: nomeDoContato(), lead_id: l.id }] }).catch(() => null);
        if (r && r.ok && r.ligados) {
          b.remove();
          dica('Pronto: esta conversa agora é deste lead. O @lid já aparece no CRM.');
        } else {
          b.disabled = false; b.textContent = r0;
          dica('Não deu pra vincular. Recarregue a aba do WhatsApp e tente de novo.');
        }
      } catch (e) {
        b.disabled = false; b.textContent = r0;
        dica('Falhou: ' + ((e && e.message) || e));
      }
    });
  }

  // MARCAR A CONVERSA COMO PESSOAL.
  //
  // Pede confirmacao porque o efeito e silencioso e duradouro: a partir daqui o
  // JOB nao le mais esta conversa nem cria card dela. Uma pessoa que marcar sem
  // querer o proprio lead ia passar dias sem entender por que ele "sumiu" — a
  // frase do confirm diz exatamente isso, e onde desfazer.
  function _ligarNaoLead(l) {
    const b = document.getElementById('job-nao-lead');
    if (!b) return;
    b.addEventListener('click', async () => {
      const nome = nomeDoContato() || 'esta conversa';
      if (!confirm('Marcar "' + nome + '" como NÃO É LEAD?\n\n'
                 + 'O JOB para de ler esta conversa e nunca mais cria lead dela.\n'
                 + 'Serve pra amigo, família, fornecedor — quem não é cliente.\n\n'
                 + 'Dá pra desfazer no JOB, em Leads excluídos.')) return;
      b.disabled = true; const r0 = b.textContent; b.textContent = 'Marcando…';
      const aviso = document.getElementById('job-ficha-aviso');
      const dizer = (t) => { if (aviso) aviso.textContent = t; };
      try {
        let tel = '';
        try { tel = (await pedirTelefoneWpp()) || telefoneDoContato(); } catch (e) { tel = telefoneDoContato(); }
        const r = await _safeSendMessage({ type: 'ignorar_conversa',
          chat_id: _chatAberto, telefone: tel, nome: nome }).catch(() => null);
        if (r && r.ok) {
          b.textContent = 'Marcada como pessoal';
          dizer('Pronto: esta conversa não vira mais lead.');
        } else {
          b.disabled = false; b.textContent = r0;
          dizer('Não deu pra marcar' + ((r && r.erro) ? ': ' + r.erro : '') + '.');
        }
      } catch (e) {
        b.disabled = false; b.textContent = r0;
        dizer('Falhou: ' + ((e && e.message) || e));
      }
    });
  }

  function _renderFicha(aba) {
    const f = _ficha, l = f.lead || {};
    const etapaAtual = (f.etapas || []).find((e) => e.id === l.etapa);
    const falta = f.campos_faltando || [];
    const saude = f.saude || {};
    let corpo = '';
    if (aba === 'dados') corpo = _fichaAbaDados(f, l);
    else if (aba === 'qualif') corpo = _fichaAbaQualif(f);
    else corpo = _fichaAbaAtividade(f);

    setCorpoSecao(
      '<div class="job-ficha">' +
        '<div class="job-ficha-topo">' +
          '<div class="job-ficha-nome">' + esc(l.nome || _fichaTel) + '</div>' +
          '<div class="job-ficha-linha">' +
            '<span class="job-ficha-etapa" style="background:' + esc((etapaAtual && etapaAtual.cor) || '#64748b') + '22;color:' +
              esc((etapaAtual && etapaAtual.cor) || '#94a3b8') + ';">' + esc((etapaAtual && etapaAtual.nome) || l.etapa || '—') + '</span>' +
            (saude.texto ? '<span class="job-ficha-saude job-saude-' + esc(saude.nivel || '') + '">' + esc(saude.texto) + '</span>' : '') +
            (f.responsavel_nome ? '<span class="job-ficha-resp">' + esc(f.responsavel_nome) + '</span>' : '') +
          '</div>' +
        '</div>' +
        (falta.length
          ? '<div class="job-ficha-trava">Pra este card sair da etapa: <b>' +
            falta.map((x) => esc(x.nome)).join(', ') + '</b></div>' : '') +
        '<div class="job-ficha-abas">' +
          _FICHA_ABAS.map((t) => '<button class="job-ficha-aba' + (t.id === aba ? ' on' : '') +
            '" data-aba="' + t.id + '">' + t.rot + '</button>').join('') +
        '</div>' +
        '<div class="job-ficha-corpo">' + corpo + '</div>' +
        '<div class="job-ficha-rodape">' +
          '<button class="job-cnpj-btn" id="job-ficha-salvar">Salvar no JOB</button>' +
          // NAO E LEAD. O consultor fala com amigo, familia e fornecedor no
          // mesmo WhatsApp, e cada analise virava um card no CRM. O botao mora
          // ao lado do Salvar porque e a mesma decisao, invertida: "isto entra"
          // ou "isto nunca entra". Discreto de proposito — e acao rara, mas tem
          // que estar onde a pessoa ja esta olhando quando percebe o engano.
          '<button class="job-nao-lead" id="job-nao-lead" ' +
            'title="Marca esta conversa como pessoal: o JOB para de ler e nunca mais cria lead dela.">' +
            'Não é lead</button>' +
          '<span class="job-ficha-aviso" id="job-ficha-aviso"></span>' +
        '</div>' +
        (aba === 'dados' ? _blocoNomeContato() : '') +
        '<a class="job-ficha-link" id="job-ficha-abrir-crm" href="#">Abrir a ficha completa no JOB</a>' +
      '</div>');
    _ligarEventosFicha(aba);
    if (aba === 'dados') { _ligarNomeContato(); _ligarVinculoChat(_ficha.lead || {}); }
    _ligarNaoLead(_ficha.lead || {});
  }

  // Valor a exibir: o que o consultor digitou tem prioridade sobre o que veio do
  // servidor. Sem isso, ir na aba Atividade e voltar apagava tudo que ele escreveu,
  // porque _renderFicha remontava o HTML sempre a partir de _ficha.
  function _pend(escopo, chave, doServidor) {
    const p = _fichaPend[escopo];
    return (p && Object.prototype.hasOwnProperty.call(p, chave)) ? p[chave] : doServidor;
  }

  function _fichaAbaDados(f, l) {
    const marcadasPend = _fichaPend.etiquetas;
    const etqs = new Set(marcadasPend || f.etiquetas_marcadas || []);
    return '' +
      _campoTxt('nome', 'Nome', _pend('base', 'nome', l.nome || '')) +
      _campoTxt('empresa', 'Cidade / empresa', _pend('base', 'empresa', l.empresa || '')) +
      _campoTxt('email', 'E-mail', _pend('base', 'email', l.email || '')) +
      _campoTxt('valor_estimado', 'Valor estimado', _pend('base', 'valor_estimado',
        l.valor_estimado != null ? String(l.valor_estimado).replace('.', ',') : '')) +
      // Agrupado por quadro: a lista vem com as etapas de TODOS os funis, e sem
      // dizer de qual era cada uma o consultor tirava o lead do kanban comercial
      // achando que só estava mudando de etapa (o quadro do lead vem da etapa).
      // VINCULO DA CONVERSA. O @lid nao e gerado pelo JOB: ele existe dentro do
      // WhatsApp e so pode ser capturado com a conversa aberta. Aqui o consultor
      // faz isso num clique — ele sabe melhor que qualquer heuristica que ESTA
      // conversa e deste lead, e em conversa @lid o telefone as vezes nem existe
      // pra casar sozinho.
      _blocoVinculoChat(f, l) +
      '<div class="job-ficha-campo"><label>Etapa</label>' +
        '<select data-ficha="etapa">' + _fichaOpcoesEtapa(f, l) + '</select></div>' +
        _perdaHtml() +
      // CRONOMETRO junto do sub-status, igual ao card do CRM. Aqui e onde o
      // consultor decide o que fazer com o lead: saber HA QUANTO TEMPO ele esta
      // parado no mesmo passo muda a decisao, e antes esse tempo so existia no
      // site. Sem sub-status escolhido nao ha o que cronometrar.
      '<div class="job-ficha-campo"><label>Sub-status <span class="job-ficha-dica">o que falta pra avançar</span>' +
        ((l.sub_status && f.saude && f.saude.desde_ts)
          ? '<span class="job-ficha-cron" id="job-cron-ss" data-desde="' + f.saude.desde_ts + '">' +
            esc(f.saude.idade_txt || '') + '</span>' : '') +
        '</label>' +
        '<select data-ficha="sub_status">' +
          '<option value="">Sem sub-status</option>' +
          (f.sub_status_etapa || []).map((o) => '<option value="' + esc(o) + '"' +
            (o === (_fichaPend.sub_status !== null ? _fichaPend.sub_status : (l.sub_status || '')) ? ' selected' : '') +
            '>' + esc(o) + '</option>').join('') +
          ((l.sub_status && (f.sub_status_etapa || []).indexOf(l.sub_status) === -1)
            ? '<option value="' + esc(l.sub_status) + '" selected>' + esc(l.sub_status) + ' (de outra etapa)</option>' : '') +
        '</select></div>' +
      '<div class="job-ficha-campo"><label>Etiquetas <span class="job-ficha-dica">por que está parado</span></label>' +
        '<div class="job-ficha-etqs">' +
          (f.etiquetas_todas || []).map((e) => {
            const on = etqs.has(e.id);
            return '<label class="job-ficha-etq' + (on ? ' on' : '') + '"' + (on ? ' style="background:' + esc(e.cor) + '"' : '') +
              '><input type="checkbox" data-etq="' + e.id + '" data-cor="' + esc(e.cor) + '"' + (on ? ' checked' : '') + '>' +
              esc(e.nome) + '</label>';
          }).join('') +
        '</div></div>';
  }

  function _fichaOpcoesEtapa(f, l) {
    const sel = _fichaPend.etapa || l.etapa;
    const opt = (e) => '<option value="' + esc(e.id) + '"' +
      (e.id === sel ? ' selected' : '') + '>' + esc(e.nome) + '</option>';
    const quadros = f.quadros || [];
    if (quadros.length < 2) return (f.etapas || []).map(opt).join('');
    let html = '';
    quadros.forEach((q) => {
      const doQuadro = (f.etapas || []).filter((e) => (e.quadro || 'comercial') === q.slug);
      if (doQuadro.length) {
        html += '<optgroup label="' + esc(q.nome) + '">' + doQuadro.map(opt).join('') + '</optgroup>';
      }
    });
    // Etapa que não pertence a quadro nenhum não pode sumir do select, senão o
    // lead seria movido sozinho ao salvar.
    const soltas = (f.etapas || []).filter((e) =>
      !quadros.some((q) => q.slug === (e.quadro || 'comercial')));
    if (soltas.length) html += '<optgroup label="Sem quadro">' + soltas.map(opt).join('') + '</optgroup>';
    return html;
  }

  function _fichaAbaQualif(f) {
    const def = f.campos_def || [], val = f.campos_val || {};
    // Ordem dos blocos igual à do CRM: o que trava a etapa primeiro, porque é o
    // que impede o lead de andar. Automático é leitura — quem escreve é o import.
    const ordem = [
      { m: 'saida', rot: 'Obrigatório pra sair da etapa' },
      { m: 'conversa', rot: 'Ao longo da conversa' },
      { m: 'automatico', rot: 'Chega preenchido' },
      { m: 'proposta', rot: 'Na proposta' },
    ];
    let html = '';
    ordem.forEach((g) => {
      const doGrupo = def.filter((c) => c.momento === g.m);
      if (!doGrupo.length) return;
      html += '<div class="job-ficha-grupo job-fg-' + g.m + '"><div class="job-ficha-grupo-tit">' + g.rot + '</div>' +
        doGrupo.map((c) => {
          const doServidor = (val[c.chave] || {}).valor || '';
          let v = _pend('campos', c.chave, doServidor);
          if (Array.isArray(v)) v = v.join(', ');
          return _fichaCampoPers(c, v);
        }).join('') + '</div>';
    });
    return html || '<div class="job-notas-vazio">Nenhum campo cadastrado.</div>';
  }

  function _fichaCampoPers(c, v) {
    const dica = c.dica ? '<span class="job-ficha-dica">' + esc(c.dica) + '</span>' : '';
    let ctrl;
    if (c.momento === 'automatico' || c.fonte === 'utm') {
      ctrl = '<div class="job-ficha-lido' + (v ? '' : ' vazio') + '">' + (v ? esc(v) : '— ainda não chegou') + '</div>';
    } else if (c.tipo === 'select') {
      ctrl = '<select data-campo="' + esc(c.chave) + '"><option value="">—</option>' +
        (c.opcoes || []).map((o) => '<option value="' + esc(o) + '"' + (o === v ? ' selected' : '') + '>' + esc(o) + '</option>').join('') +
        ((v && (c.opcoes || []).indexOf(v) === -1) ? '<option value="' + esc(v) + '" selected>' + esc(v) + ' (fora da lista)</option>' : '') +
        '</select>';
    } else if (c.tipo === 'multiselect') {
      const marc = String(v).split(',').map((x) => x.trim()).filter(Boolean);
      ctrl = '<div class="job-ficha-etqs" data-campo="' + esc(c.chave) + '" data-multi="1">' +
        (c.opcoes || []).map((o) => '<label class="job-ficha-etq"><input type="checkbox" value="' + esc(o) + '"' +
          (marc.indexOf(o) > -1 ? ' checked' : '') + '>' + esc(o) + '</label>').join('') + '</div>';
    } else if (c.tipo === 'booleano') {
      ctrl = '<select data-campo="' + esc(c.chave) + '"><option value="">—</option>' +
        '<option value="Sim"' + (v === 'Sim' ? ' selected' : '') + '>Sim</option>' +
        '<option value="Não"' + (v === 'Não' ? ' selected' : '') + '>Não</option></select>';
    } else if (c.tipo === 'texto_longo') {
      ctrl = '<textarea rows="2" data-campo="' + esc(c.chave) + '">' + esc(v) + '</textarea>';
    } else {
      const t = c.tipo === 'data' ? 'date' : (c.tipo === 'mes' ? 'month' : (c.tipo === 'numero' ? 'number' : 'text'));
      ctrl = '<input type="' + t + '" data-campo="' + esc(c.chave) + '" value="' + esc(v) + '">';
    }
    return '<div class="job-ficha-campo"><label>' + esc(c.nome) + dica + '</label>' + ctrl + '</div>';
  }

  function _fichaAbaAtividade(f) {
    const ats = f.atividades || [];
    const pb = f.playbook;
    let html = '<div class="job-ficha-campo"><label>Registrar atividade</label>' +
      '<textarea rows="3" id="job-ficha-ativ" placeholder="O que aconteceu nesta conversa…">' +
      esc(_fichaPend.atividade || '') + '</textarea></div>';
    if (pb) {
      html += '<div class="job-ficha-grupo job-fg-pb"><div class="job-ficha-grupo-tit">Sugestão de mensagem · ' + esc(pb.titulo || '') + '</div>' +
        (pb.rascunho ? '<div class="job-ficha-rascunho">Rascunho: revise antes de mandar.</div>' : '') +
        (pb.passos || []).map((p, i) =>
          '<div class="job-ficha-passo">' +
            '<div class="job-ficha-passo-top">' + esc(p.titulo || ('Passo ' + (i + 1))) +
              (p.quando ? '<span class="job-ficha-quando">' + esc(p.quando) + '</span>' : '') + '</div>' +
            '<div class="job-ficha-msg" id="job-pb-' + i + '">' + esc(p.msg || '') + '</div>' +
            '<button class="job-ficha-usar" data-pb="' + i + '">Copiar mensagem</button>' +
          '</div>').join('') +
        '</div>';
    }
    html += '<div class="job-ficha-grupo"><div class="job-ficha-grupo-tit">Histórico</div>' +
      (ats.length
        ? ats.map((a) => '<div class="job-nota-item"><div class="job-nota-txt">' + esc(a.descricao || '') + '</div>' +
            '<div class="job-nota-meta">' + esc([a.usuario_nome, a.tipo, _tempoBrCurto(a.criado_em)].filter(Boolean).join(' · ')) + '</div></div>').join('')
        : '<div class="job-notas-vazio">Sem atividade registrada ainda.</div>') +
      '</div>';
    return html;
  }

  function _campoTxt(chave, rot, v) {
    return '<div class="job-ficha-campo"><label>' + esc(rot) + '</label>' +
      '<input type="text" data-ficha="' + chave + '" value="' + esc(v) + '"></div>';
  }

  function _ligarEventosFicha(aba) {
    document.querySelectorAll('.job-ficha-aba').forEach((b) => {
      b.addEventListener('click', () => {
        // Guarda o que foi digitado antes de trocar de aba: re-renderizar sem
        // isso jogaria fora a digitação, que é a pior coisa que um painel faz.
        _absorverFicha();
        _renderFicha(b.dataset.aba);
      });
    });
    document.querySelectorAll('.job-ficha [data-ficha], .job-ficha [data-campo], .job-ficha [data-etq]').forEach((el) => {
      el.addEventListener('input', () => { _fichaSujo = true; });
      el.addEventListener('change', () => { _fichaSujo = true; });
    });
    // Etiqueta pinta na hora — feedback imediato, salvamento vem no Salvar
    document.querySelectorAll('.job-ficha [data-etq]').forEach((chk) => {
      chk.addEventListener('change', () => {
        const lab = chk.closest('.job-ficha-etq');
        if (!lab) return;
        lab.classList.toggle('on', chk.checked);
        lab.style.background = chk.checked ? (chk.dataset.cor || '') : '';
      });
    });
    // Trocar a etapa muda a lista de sub-status, então avisa em vez de mentir
    const selEtapa = document.querySelector('.job-ficha [data-ficha="etapa"]');
    if (selEtapa) {
      selEtapa.addEventListener('change', () => {
        const av = document.getElementById('job-ficha-aviso');
        if (av) av.textContent = selEtapa.value !== (_ficha.lead || {}).etapa
          ? 'Mudança de etapa limpa o sub-status.' : '';
        _perdaMostrar(selEtapa.value);
      });
      _perdaMostrar(selEtapa.value);
    }
    const salvar = document.getElementById('job-ficha-salvar');
    if (salvar) salvar.addEventListener('click', () => _salvarFicha(aba));
    const link = document.getElementById('job-ficha-abrir-crm');
    if (link && _ficha && _ficha.lead) {
      link.href = _SITE_BASE_URL_EXT + '/crm?lead=' + _ficha.lead.id;
      link.target = '_blank';
      link.rel = 'noopener';
    }
    // Copia em vez de escrever na caixa: mexer no DOM de composição do WhatsApp
    // é justamente o tipo de intervenção que já quebrou o envio de mensagem.
    document.querySelectorAll('.job-ficha-usar').forEach((b) => {
      b.addEventListener('click', () => {
        const el = document.getElementById('job-pb-' + b.dataset.pb);
        if (!el) return;
        navigator.clipboard.writeText(el.textContent || '').then(() => {
          b.textContent = 'Copiado';
          setTimeout(() => { b.textContent = 'Copiar mensagem'; }, 1500);
        }).catch(() => { b.textContent = 'Falha ao copiar'; });
      });
    });
  }

  // ── MOTIVO DA PERDA, DENTRO DO WHATSAPP ─────────────────────────────────
  // O consultor acabou de ler a conversa: e o unico instante em que ele sabe
  // por que perdeu. Obrigar a abrir o site pra responder e garantir que ele nao
  // responde — foi assim que 216 perdas ficaram com "Nao informado".
  // ── FILA DE HOJE, DENTRO DO WHATSAPP ────────────────────────────────────
  // A tarefa aparece ONDE O TRABALHO ACONTECE. A /crm/agenda com 0 futuras ja
  // provou que tela separada nao e aberta. Mesma consulta do dashboard e da
  // agenda: os tres dizem o mesmo numero.
  const _ICO_FILA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/>' +
    '<path d="M16 2v4M8 2v4M3 10h18M9 16l2 2 4-4"/></svg>';

  let _fila = [];

  async function abrirSecaoFila() {
    const p = document.getElementById('job-painel-corpo');
    if (!p) return;
    p.innerHTML = '<div class="job-vazio">carregando sua fila…</div>';
    const r = await _safeSendMessage({ type: 'fila_hoje' }).catch(() => null);
    if (!r || !r.ok) {
      p.innerHTML = '<div class="job-vazio">Não consegui carregar a fila agora.</div>';
      return;
    }
    _fila = r.fila || [];
    _filaBadge(r.resumo || {});
    if (!_fila.length) {
      p.innerHTML = '<div class="job-vazio"><b>Nada na fila de hoje.</b><br>' +
        'Quando entrar lead novo ou uma cotação ficar parada, aparece aqui.</div>';
      return;
    }
    const res = r.resumo || {};
    p.innerHTML =
      '<div class="job-fila-cab">' +
        (res.atrasadas ? '<b class="job-fila-atraso">' + res.atrasadas + ' atrasada(s)</b> · ' : '') +
        (res.hoje || 0) + ' para hoje</div>' +
      _fila.map((t) => _filaItem(t)).join('');
    p.querySelectorAll('[data-fila]').forEach((b) => {
      b.addEventListener('click', () => _filaAcao(b.dataset.fila, parseInt(b.dataset.id, 10), b));
    });
  }

  function _filaItem(t) {
    return '<div class="job-fila-item' + (t.atrasada ? ' atrasada' : '') + '" id="job-fila-' + t.id + '">' +
      '<div class="job-fila-tit">' + esc(t.assunto) + '</div>' +
      '<div class="job-fila-lead">' + esc(t.lead || 'Sem nome') +
        (t.atrasada ? '<span class="job-fila-tag">desde ' + esc((t.quando || '').slice(0, 10)) + '</span>' : '') +
      '</div>' +
      (t.motivo ? '<div class="job-fila-motivo">' + esc(t.motivo) + '</div>' : '') +
      (t.frase ? '<div class="job-fila-frase">' + esc(t.frase) + '</div>' : '') +
      '<div class="job-fila-acoes">' +
        (t.telefone ? '<button type="button" class="job-tr-btn" data-fila="abrir" data-id="' + t.id + '">Abrir conversa</button>' : '') +
        '<button type="button" class="job-tr-btn" data-fila="feito" data-id="' + t.id + '">Concluir</button>' +
        '<button type="button" class="job-tr-btn" data-fila="adiar" data-id="' + t.id + '">Amanhã</button>' +
      '</div></div>';
  }

  async function _filaAcao(acao, id, botao) {
    const t = _fila.find((x) => x.id === id);
    if (!t) return;
    if (acao === 'abrir') {
      // Copia a frase e abre a conversa NA ABA QUE JA ESTA CARREGADA — abrir um
      // popup novo faz o WhatsApp carregar tudo de novo.
      try { if (t.frase) await navigator.clipboard.writeText(t.frase); } catch (e) {}
      try {
        await _pedirPonte('abrir_chat', { telefone: t.telefone, texto: t.frase || '' }, 15000);
      } catch (e) {
        window.open('https://web.whatsapp.com/send?phone=' + String(t.telefone).replace(/\D/g, ''), '_blank');
      }
      return;
    }
    botao.disabled = true;
    const r = await _safeSendMessage({ type: 'fila_acao', tarefa_id: id,
      acao: acao === 'adiar' ? 'adiar' : 'feito', dias: 1 }).catch(() => null);
    if (r && r.ok) {
      const el = document.getElementById('job-fila-' + id);
      if (el) el.remove();
      _fila = _fila.filter((x) => x.id !== id);
      _filaBadge({ hoje: _fila.length });
    } else {
      botao.disabled = false;
    }
  }

  function _filaBadge(res) {
    const b = document.getElementById('job-fila-badge');
    if (!b) return;
    const n = (res.atrasadas || 0) + (res.hoje || 0);
    b.hidden = !n;
    b.textContent = n > 99 ? '99+' : String(n);
    b.classList.toggle('atraso', !!res.atrasadas);
  }

  // O numero aparece no trilho sem o consultor precisar abrir a secao.
  async function filaAtualizarBadge() {
    const r = await _safeSendMessage({ type: 'fila_hoje' }).catch(() => null);
    if (r && r.ok) _filaBadge(r.resumo || {});
  }

  function _perdaEhEtapaPerdida(slug) {
    const e = ((_ficha && _ficha.etapas) || []).find((x) => (x.id || x.slug) === slug);
    return !!(e && (e.tipo === 'perdido'));
  }

  function _perdaMostrar(slug) {
    const cx = document.getElementById('job-perda-bloco');
    if (!cx) return;
    const mostra = _perdaEhEtapaPerdida(slug) && slug !== ((_ficha.lead || {}).etapa || '');
    cx.hidden = !mostra;
    if (mostra) {
      const sel = cx.querySelector('[data-campo="motivo_perda"]');
      if (sel && !sel.options.length) {
        const ops = (_ficha.motivos_perda || []);
        sel.innerHTML = '<option value="">— por que perdeu? —</option>' +
          ops.map((o) => '<option value="' + esc(o) + '">' + esc(o) + '</option>').join('');
        sel.addEventListener('change', () => {
          const ex = cx.querySelector('.job-perda-expl');
          if (ex) ex.textContent = ((_ficha.motivos_ajuda || {})[sel.value] || '');
        });
      }
    }
  }

  function _perdaHtml() {
    return '<div class="job-perda" id="job-perda-bloco" hidden>' +
      '<div class="job-perda-tit">Por que perdeu?' +
      '<i class="job-i" title="A operadora nao pede isso; quem pede e voce. Sem motivo, o relatorio de perda nao existe e o mes que vem ninguem sabe o que consertar. Responda agora, que voce acabou de ler a conversa.">i</i></div>' +
      '<select class="job-perda-sel" data-campo="motivo_perda"></select>' +
      '<div class="job-perda-expl"></div>' +
      '</div>';
  }

  // Lê o DOM pro objeto em memória. Existe porque as abas re-renderizam: sem
  // absorver antes, trocar de aba apagaria o que o consultor acabou de digitar.
  // leadId dentro do rascunho: sem isso o que foi digitado no lead A sobrevivia a
  // troca de conversa e era GRAVADO no lead B — inclusive nota de atividade, que
  // entrava no histórico do cliente errado assinada pelo consultor.
  function _fichaPendVazio(leadId) {
    return { leadId: leadId || null, base: {}, campos: {}, etiquetas: null,
             atividade: '', etapa: null, sub_status: null };
  }
  let _fichaPend = _fichaPendVazio(null);
  function _absorverFicha() {
    document.querySelectorAll('.job-ficha [data-ficha]').forEach((el) => {
      const k = el.dataset.ficha;
      if (k === 'etapa') _fichaPend.etapa = el.value;
      else if (k === 'sub_status') {
        _fichaPend.sub_status = el.value;
        // Zera na hora, igual ao card: o consultor acabou de mexer, o tempo
        // volta pro zero na frente dele em vez de esperar o proximo carregamento.
        const c = document.getElementById('job-cron-ss');
        if (c) {
          if (el.value) { c.dataset.desde = Math.floor(Date.now() / 1000); c.textContent = '00:00'; c.className = 'job-ficha-cron'; }
          else { c.remove(); }
        }
      }
      else _fichaPend.base[k] = el.value;
    });
    document.querySelectorAll('.job-ficha [data-campo]').forEach((el) => {
      if (el.dataset.multi) {
        _fichaPend.campos[el.dataset.campo] =
          Array.from(el.querySelectorAll('input:checked')).map((i) => i.value);
      } else {
        _fichaPend.campos[el.dataset.campo] = el.value;
      }
    });
    const etqs = document.querySelectorAll('.job-ficha [data-etq]');
    if (etqs.length) {
      _fichaPend.etiquetas = Array.from(etqs).filter((c) => c.checked).map((c) => parseInt(c.dataset.etq, 10));
    }
    const at = document.getElementById('job-ficha-ativ');
    if (at) _fichaPend.atividade = at.value || '';
  }

  async function _salvarFicha(aba) {
    _absorverFicha();
    const btn = document.getElementById('job-ficha-salvar');
    const av = document.getElementById('job-ficha-aviso');
    // Cinto de segurança: se o rascunho for de outro lead, não manda nada dele.
    if (_fichaPend.leadId && _fichaPend.leadId !== _ficha.lead.id) {
      _fichaPend = _fichaPendVazio(_ficha.lead.id);
      _absorverFicha();
    }
    const dados = Object.assign({}, _fichaPend.base, {
      lead_id: _ficha.lead.id,
      // Só o id: a extensão não guarda o nome do consultor. Quem resolve o nome
      // pra assinar a atividade é o backend, que já tem a tabela de usuários.
      usuario_id: _usuarioIdPopup || null,
      campos: _fichaPend.campos,
    });
    if (_fichaPend.etiquetas) dados.etiquetas = _fichaPend.etiquetas;
    if (_fichaPend.sub_status !== null) dados.sub_status = _fichaPend.sub_status;
    if (_fichaPend.atividade) dados.atividade = _fichaPend.atividade;
    if (_fichaPend.etapa && _fichaPend.etapa !== (_ficha.lead || {}).etapa) dados.etapa = _fichaPend.etapa;
    if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
    if (av) av.textContent = '';
    let resp;
    try { resp = await _safeSendMessage({ type: 'ficha_salvar', dados: dados }); } catch (e) { resp = null; }
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar no JOB'; }
    if (!resp || !resp.ok) {
      if (av) { av.className = 'job-ficha-aviso erro'; av.textContent = (resp && resp.erro) || 'Falha ao salvar — tente de novo.'; }
      return;
    }
    // Recarrega do servidor: é ele quem sabe o que foi aceito (a etapa pode ter
    // sido barrada) e o que a API do CNPJ preencheu sozinha.
    _fichaPend = _fichaPendVazio(_ficha.lead.id);
    const erros = [].concat(resp.avisos || [], resp.etapa_ok === false ? [resp.etapa_erro] : []).filter(Boolean);
    await _carregarFicha({ lead_id: _ficha.lead.id });
    const av2 = document.getElementById('job-ficha-aviso');
    if (av2) {
      if (erros.length) { av2.className = 'job-ficha-aviso erro'; av2.textContent = erros.join(' · '); }
      else { av2.className = 'job-ficha-aviso ok'; av2.textContent = 'Salvo' + ((resp.mudou || []).length ? ': ' + resp.mudou.slice(0, 4).join(', ') : ''); }
    }
  }

  // ═══════════════ Consulta de CNPJ (Receita via BrasilAPI) ═══════════════
  // Em vez de raspar o cnpjreva (CAPTCHA) e o CCMEI (gov.br), o backend usa a
  // BrasilAPI e devolve os dados da Receita + se é MEI. O certificado CCMEI o
  // consultor abre manualmente (botão) e loga na hora.
  function _fmtCnpj(dig) {
    dig = String(dig || '').replace(/\D/g, '').slice(0, 14);
    if (dig.length !== 14) return dig;
    return dig.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }
  function _dataBr(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : (iso || '');
  }
  function _cnpjNaConversa() {
    try {
      const main = document.querySelector('#main');
      const txt = main ? (main.innerText || '') : '';
      const m = txt.match(/\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}/);
      if (m) { const d = m[0].replace(/\D/g, ''); if (d.length === 14) return d; }
    } catch (e) { /* sem conversa aberta, tudo bem */ }
    return '';
  }
  function abrirSecaoCnpj() {
    const pre = _cnpjNaConversa();
    setCorpoSecao(
      '<div class="job-cnpj-wrap">' +
        '<div class="job-cnpj-titulo">Consultar CNPJ</div>' +
        '<div class="job-cnpj-sub">Dados da Receita (razão social, abertura, situação, sócios, natureza jurídica) e se é MEI — sem CAPTCHA, sem gov.br.</div>' +
        '<input id="job-cnpj-input" class="job-cnpj-input" inputmode="numeric" placeholder="00.000.000/0000-00" value="' + esc(_fmtCnpj(pre)) + '" />' +
        '<button class="job-cnpj-btn" id="job-cnpj-btn">Consultar</button>' +
        '<div id="job-cnpj-resultado"></div>' +
      '</div>');
    const input = document.getElementById('job-cnpj-input');
    const btn = document.getElementById('job-cnpj-btn');
    const disparar = () => _consultarCnpjUI((input.value || '').replace(/\D/g, ''));
    if (btn) btn.addEventListener('click', disparar);
    if (input) {
      input.addEventListener('input', () => { input.value = _fmtCnpj(input.value); });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') disparar(); });
      input.focus();
    }
    if (pre) disparar();
  }
  async function _consultarCnpjUI(dig) {
    const box = document.getElementById('job-cnpj-resultado');
    if (!box) return;
    if (String(dig || '').length !== 14) {
      box.innerHTML = '<div class="job-ia-alerta">⚠ Digite os 14 números do CNPJ.</div>';
      return;
    }
    box.innerHTML = '<div class="job-sem-analise"><div class="job-carregando"></div><div class="job-sem-analise-txt">Consultando na Receita…</div></div>';
    let resp;
    try { resp = await _safeSendMessage({ type: 'consultar_cnpj', cnpj: dig }); }
    catch (e) { resp = null; }
    if (!resp || !resp.ok || !resp.cnpj) {
      box.innerHTML = '<div class="job-ia-alerta">⚠ ' + esc((resp && resp.erro) || 'Não consegui consultar esse CNPJ agora.') + '</div>';
      return;
    }
    box.innerHTML = _renderCnpjCard(resp.cnpj);
    const bc = document.getElementById('job-cnpj-copy');
    if (bc) bc.addEventListener('click', () => {
      navigator.clipboard.writeText(bc.dataset.texto || '').then(() => {
        bc.textContent = 'Copiado!';
        setTimeout(() => { bc.textContent = 'Copiar dados'; }, 1500);
      });
    });
    // Copiar item a item (CNPJ, data, município, natureza jurídica, CNAE,
    // quadro societário isoladamente) — cada linha tem seu próprio botão.
    box.querySelectorAll('.job-cnpj-copy-item').forEach((b) => {
      b.addEventListener('click', () => {
        navigator.clipboard.writeText(b.dataset.valor || '').then(() => {
          b.classList.add('copiado');
          setTimeout(() => b.classList.remove('copiado'), 1200);
        });
      });
    });
    // "Salvar no lead" grava os dados do CNPJ como nota presa ao telefone da
    // CONVERSA ABERTA (não do CNPJ pesquisado — podem ser números diferentes,
    // ex: consultor confere o CNPJ de terceiro antes de perguntar ao lead).
    const bs = document.getElementById('job-cnpj-salvar-lead');
    if (bs) bs.addEventListener('click', async () => {
      bs.disabled = true; bs.textContent = 'Salvando…';
      let tel = '';
      try { tel = (await pedirTelefoneWpp()) || telefoneDoContato(); } catch (e) { tel = telefoneDoContato(); }
      const ok = await _salvarNotaLead(tel, bs.dataset.texto || '');
      bs.textContent = ok ? 'Salvo no lead!' : 'Falha — tentar de novo';
      if (ok) { setTimeout(() => { bs.disabled = false; bs.textContent = 'Salvar no lead (nota)'; }, 2000); }
      else bs.disabled = false;
    });
  }
  // Só a Receita federal via URL pré-preenche o campo (?cnpj=, confirmado
  // manualmente — o CAPTCHA continua manual, óbvio). O CCMEI e a JUCESP não
  // aceitam parâmetro público conhecido: abrem a página normal, busca manual.
  function _linkCnpjReva(dig) {
    return 'https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/Cnpjreva_Solicitacao.asp?cnpj=' + dig;
  }
  function _renderCnpjCard(c) {
    const selo = (txt, cls) => '<span class="job-cnpj-selo ' + cls + '">' + esc(txt) + '</span>';
    // Cada linha ganha um botão de copiar só daquele valor — o Guilherme
    // pediu pra poder copiar item a item, não só o bloco inteiro.
    const linha = (rot, val) => val ? '<div class="job-cnpj-linha">' +
      '<span class="job-cnpj-rot">' + esc(rot) + '</span>' +
      '<span class="job-cnpj-val">' + esc(val) + '</span>' +
      '<button class="job-cnpj-copy-item" data-valor="' + esc(val) + '" title="Copiar ' + esc(rot) + '">' + _ICO_COPIAR + '</button>' +
      '</div>' : '';
    const socios = (c.socios || []).map((s) => s.nome + (s.qualificacao ? ' (' + s.qualificacao + ')' : '')).join('; ');
    const natureza = [c.natureza_codigo, c.natureza_descricao].filter(Boolean).join(' - ');
    const ehSP = /(-|\s)SP$/i.test((c.municipio || '').trim());
    const txtCopia = [
      'CNPJ: ' + _fmtCnpj(c.cnpj),
      'Razão social: ' + (c.nome || ''),
      c.fantasia ? 'Nome fantasia: ' + c.fantasia : '',
      'Abertura: ' + _dataBr(c.data_abertura),
      'Situação: ' + (c.situacao || ''),
      'Município: ' + (c.municipio || ''),
      'Natureza jurídica: ' + natureza,
      c.cnae ? 'Atividade: ' + c.cnae : '',
      'MEI: ' + (c.eh_mei ? 'Sim' : 'Não') + (c.eh_simples ? ' | Simples: Sim' : ''),
      socios ? 'Quadro societário: ' + socios : '',
    ].filter(Boolean).join('\n');
    return '<div class="job-cnpj-card">' +
      '<div class="job-cnpj-titulo-row">' +
        '<div class="job-cnpj-titulo-txt">' +
          '<div class="job-cnpj-nome">' + esc(c.nome || '—') + '</div>' +
          (c.fantasia ? '<div class="job-cnpj-fant">' + esc(c.fantasia) + '</div>' : '') +
        '</div>' +
        (c.nome ? '<button class="job-cnpj-copy-item" data-valor="' + esc(c.nome) + '" title="Copiar razão social">' + _ICO_COPIAR + '</button>' : '') +
      '</div>' +
      '<div class="job-cnpj-selos">' +
        selo(c.ativa ? 'Ativa' : (c.situacao || 'Situação?'), c.ativa ? 'ok' : 'no') +
        selo(c.eh_mei ? 'É MEI' : 'Não é MEI', c.eh_mei ? 'ok' : 'no') +
        (c.eh_simples ? selo('Simples Nacional', 'info') : '') +
      '</div>' +
      linha('CNPJ', _fmtCnpj(c.cnpj)) +
      linha('Data de abertura', _dataBr(c.data_abertura)) +
      linha('Município', c.municipio) +
      linha('Natureza jurídica', natureza) +
      linha('Atividade (CNAE)', c.cnae) +
      linha('Quadro societário', socios) +
      '<div class="job-cnpj-acoes">' +
        '<button class="job-copy" id="job-cnpj-copy" data-texto="' + esc(txtCopia) + '">Copiar dados</button>' +
        '<a class="job-cnpj-link" href="' + esc(_linkCnpjReva(c.cnpj)) + '" target="_blank" rel="noopener" title="Abre com o CNPJ já preenchido, só falta o CAPTCHA">Cartão CNPJ (Receita)</a>' +
      '</div>' +
      '<div class="job-cnpj-acoes">' +
        '<a class="job-cnpj-link" href="https://mei.receita.economia.gov.br/certificado/visualizacao" target="_blank" rel="noopener">Abrir CCMEI</a>' +
        (ehSP ? '<a class="job-cnpj-link" href="https://www.jucesponline.sp.gov.br/Default.aspx" target="_blank" rel="noopener" title="Empresa é de SP — busca manual pelo CNPJ ou nome">Pesquisar na JUCESP</a>' : '') +
      '</div>' +
      '<div class="job-cnpj-acoes-2">' +
        '<button class="job-cnpj-salvar-lead" id="job-cnpj-salvar-lead" data-texto="' + esc('Consulta CNPJ:\n' + txtCopia) + '">Salvar no lead (nota)</button>' +
      '</div>' +
      '<div class="job-cnpj-fonte">Fonte: ' + esc(c.fonte || 'Receita') + '. Cartão CNPJ e CCMEI abrem com CAPTCHA/login manual do consultor' + (ehSP ? '; JUCESP também (busca manual)' : '') + '.</div>' +
    '</div>';
  }

  // ═══════════════ Inbox de leads novos (atendimento imediato) ═══════════════
  // Os últimos leads que caíram pra ESTE consultor e ainda não foram chamados,
  // com o tempo correndo e cor conforme a espera (verde < 5min, amarelo < 15,
  // vermelho depois). Botão "Atender" abre a conversa e tira o lead da lista.
  // O mais parado fica no topo. Pedido do Guilherme: de cara na extensão.
  let _inboxCache = [];
  let _inboxTimer = null;

  function _inboxCor(seg) {
    // Devolve variável CSS (resolve por tema) em vez de hex fixo — o âmbar/verde
    // fixos sumiam no tema claro.
    if (seg < 300) return 'var(--job-sucesso)';   // < 5 min
    if (seg < 900) return 'var(--job-warn)';        // < 15 min
    return 'var(--job-danger)';                     // parado demais
  }
  function _inboxTempo(seg) {
    if (seg < 60) return 'agora';
    var m = Math.floor(seg / 60);
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60);
    return h + 'h' + (m % 60 ? ' ' + (m % 60) + 'min' : '');
  }
  function _segDesde(iso) {
    var t = Date.parse((iso || '').replace(' ', 'T'));
    if (isNaN(t)) return 0;
    return Math.max(0, Math.floor((Date.now() - t) / 1000));
  }

  // Sincronia de identidade das conversas. Fica aqui, na aba Leads, porque e uma
  // acao sobre o CRM INTEIRO — nao sobre a conversa aberta.
  function _blocoSincLid() {
    return '<div class="job-sinc">' +
      '<button type="button" class="job-cnpj-btn" id="job-sinc-lid">Sincronizar @lid de todas as conversas</button>' +
      '<div class="job-sinc-dica" id="job-sinc-dica">Liga cada conversa do seu WhatsApp ao lead certo no CRM, ' +
        'pra o @lid aparecer nos cards. Só identifica conversa — não cria nem altera lead.</div>' +
    '</div>';
  }

  async function _ligarSincLid() {
    const b = document.getElementById('job-sinc-lid');
    if (!b) return;
    const dica = (t) => { const e = document.getElementById('job-sinc-dica'); if (e) e.textContent = t; };
    b.addEventListener('click', async () => {
      b.disabled = true; const r0 = b.textContent; b.textContent = 'Lendo conversas…';
      try {
        const r = await _pedirPonte('listar_todas_conversas', { teto: 2000 }, 60000);
        const convs = (r && r.conversas) || [];
        if (!convs.length) {
          dica('Não achei conversa com telefone identificável. Role a lista de conversas do WhatsApp e tente de novo.');
          return;
        }
        // Em lotes: 500 conversas num POST so e payload grande e request longo —
        // se cair no meio, perde tudo. Em lotes, o que ja foi fica salvo.
        let ligados = 0, semLead = 0, enviados = 0;
        for (let i = 0; i < convs.length; i += 200) {
          const lote = convs.slice(i, i + 200);
          b.textContent = 'Ligando ' + Math.min(i + lote.length, convs.length) + '/' + convs.length + '…';
          const resp = await _safeSendMessage({ type: 'vincular_chats', conversas: lote }).catch(() => null);
          if (resp && resp.ok) { ligados += resp.ligados || 0; semLead += resp.sem_lead || 0; }
          enviados += lote.length;
        }
        // Diz o que NAO casou: conversa sem lead no CRM e informacao util
        // (contato pessoal, fornecedor, grupo) — nao e falha escondida.
        dica(ligados + ' conversa(s) ligada(s) ao lead. ' + semLead + ' sem lead no CRM. ' +
             (r.com_lid ? ('Das ' + r.com_lid + ' em @lid, resolvi o telefone de ' + r.lid_resolvidos + '. ') : '') +
             'Abra o CRM pra ver os @lid nos cards.');
      } catch (e) {
        dica('Não deu: ' + ((e && e.message) || e));
      } finally { b.disabled = false; b.textContent = 'Sincronizar @lid de todas as conversas'; }
    });
  }

  function renderInbox() {
    if (!_inboxCache.length) {
      return '<div class="job-sem-analise"><div class="job-sem-analise-txt">Nenhum lead novo esperando. Quando cair um lead pra você, ele aparece aqui na hora.</div></div>' + _blocoSincLid();
    }
    var html = '<div class="job-inbox-lista">';
    _inboxCache.forEach(function (l) {
      var seg = _segDesde(l.criado_em);
      var cor = _inboxCor(seg);
      html += '<div class="job-inbox-card" data-id="' + l.id + '" data-chat="' + (l.chat_id || '') + '" data-tel="' + (l.telefone || '') + '" style="border-left:3px solid ' + cor + ';">' +
        '<div class="job-inbox-top">' +
          '<span class="job-inbox-nome">' + (l.nome || 'Lead').replace(/</g, '') + '</span>' +
          (l.pago ? '<span class="job-inbox-pago">PAGO</span>' : '') +
          '<span class="job-inbox-tempo" data-iso="' + (l.criado_em || '') + '" style="color:' + cor + ';">' + _inboxTempo(seg) + '</span>' +
        '</div>' +
        '<div class="job-inbox-tel">' + (l.telefone || '') + '</div>' +
        '<button class="job-inbox-atender">Atender agora</button>' +
      '</div>';
    });
    return html + '</div>' + _blocoSincLid();
  }

  function ligarAcoesInbox() {
    document.querySelectorAll('.job-inbox-atender').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var card = btn.closest('.job-inbox-card');
        atenderLead(card.dataset.id, card.dataset.chat, card.dataset.tel);
      });
    });
  }

  // NUNCA navega/recarrega a página do WhatsApp Web (web.whatsapp.com/send?phone=
  // trocava a tela inteira e às vezes dava erro de "número inválido" do próprio
  // WhatsApp — pedido explícito do Guilherme, 18/07: "não quero que fique
  // atualizando a página do whatsapp"). O disparo do funil é 100% server-side
  // (fila), não precisa de nenhuma conversa aberta na tela pra funcionar.
  function _avisoInbox(msg, cor, linkNum) {
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;right:18px;bottom:90px;z-index:999999;background:' + (cor || '#1f2937') +
      ';color:#fff;padding:10px 14px;border-radius:8px;font-size:13px;max-width:280px;box-shadow:0 4px 14px rgba(0,0,0,.3);';
    var texto = document.createElement('div');
    texto.textContent = msg;
    el.appendChild(texto);
    if (linkNum) {
      var a = document.createElement('a');
      a.href = 'https://web.whatsapp.com/send?phone=' + linkNum;
      a.target = '_blank'; // abre em aba nova — NUNCA na aba atual (não recarrega o que já está aberto)
      a.textContent = 'Abrir conversa em nova aba →';
      a.style.cssText = 'display:block;margin-top:6px;color:#fff;text-decoration:underline;font-size:12px;';
      el.appendChild(a);
    }
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 8000);
  }

  var _ERROS_ATENDER = {
    sem_funil_configurado: 'Esse consultor não tem funil de atendimento configurado (Usuários → editar → Funil de atendimento).',
    funil_sem_passos: 'O funil de atendimento configurado não tem passos.',
    sem_telefone: 'Não foi possível localizar o telefone deste lead.',
  };

  async function atenderLead(leadId, chatId, telefone) {
    var resp = null;
    try {
      const { usuarioId } = await _safeStorageGet(['usuarioId']);
      resp = await chrome.runtime.sendMessage({ type: 'inbox_atender', lead_id: parseInt(leadId, 10), usuario_id: usuarioId });
    } catch (e) { /* segue mesmo se falhar o report */ }
    _inboxCache = _inboxCache.filter(function (l) { return String(l.id) !== String(leadId); });
    atualizarBadgeInbox();
    if (_secaoAtiva === 'inbox') { setCorpoSecaoInbox(renderInbox()); ligarAcoesInbox(); _ligarSincLid(); }
    var num = (telefone || '').replace(/\D/g, '');
    if (resp && resp.ok) {
      _avisoInbox('Funil disparado: ' + (resp.passos_enfileirados || 0) + ' mensagem(ns) na fila.', '#0f766e', num);
    } else if (resp && resp.erro) {
      _avisoInbox(_ERROS_ATENDER[resp.erro] || (resp.msg || 'Não foi possível disparar o funil de atendimento.'), '#b91c1c', num);
    }
  }

  function setCorpoSecaoInbox(html) {
    const c = document.getElementById('job-painel-doc-corpo');
    if (c) c.innerHTML = html;
  }

  async function abrirSecaoInbox() {
    setCorpoSecaoInbox('<div class="job-sem-analise"><div class="job-sem-analise-txt">Carregando leads…</div></div>');
    await buscarInbox();
    if (_secaoAtiva !== 'inbox') return;
    setCorpoSecaoInbox(renderInbox());
    ligarAcoesInbox();
  }

  async function buscarInbox() {
    if (_contextoMorto) return;
    const { extKey, usuarioId } = await _safeStorageGet(['extKey', 'usuarioId']);
    if (!extKey || !usuarioId) return;
    try {
      const r = await chrome.runtime.sendMessage({ type: 'inbox', usuario_id: usuarioId });
      if (r && r.ok) { _inboxCache = r.leads || []; atualizarBadgeInbox(); }
    } catch (e) { /* próxima rodada tenta de novo */ }
  }

  function atualizarBadgeInbox() {
    var b = document.getElementById('job-inbox-badge');
    if (!b) return;
    var n = _inboxCache.length;
    // destaca vermelho se algum lead está esperando há muito
    if (n) { b.hidden = false; b.textContent = n; } else { b.hidden = true; }
  }

  // Atualiza o tempo/cor a cada 20s (client-side) e re-busca a lista a cada 45s.
  function ligarLoopInbox() {
    if (_inboxTimer) return;
    _inboxTimer = setInterval(function () {
      // tick visual do tempo, se a seção estiver aberta
      if (_secaoAtiva === 'inbox') {
        document.querySelectorAll('.job-inbox-tempo').forEach(function (el) {
          var seg = _segDesde(el.dataset.iso);
          el.textContent = _inboxTempo(seg);
          el.style.color = _inboxCor(seg);
          var card = el.closest('.job-inbox-card');
          if (card) card.style.borderLeftColor = _inboxCor(seg);
        });
      }
    }, 20000);
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
    const fx = classeFaixa(ua.faixa);
    return '<div class="job-ultima-analise">' +
      '<div class="job-ultima-analise-tag">Última análise salva</div>' +
      '<div class="job-score-wrap">' +
        '<div class="job-score-num ' + fx + '">' + (ua.score ?? '—') + '</div>' +
        '<div class="job-score-meta">' +
          '<div class="job-score-faixa ' + fx + '">' + esc((ua.faixa || '').toUpperCase()) + '</div>' +
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
  let _syncToken = 0; // marca a sincronização atual (pro watchdog do spinner)
  async function sincronizarPainelComConversa() {
    if (_secaoAtiva !== 'analise') return;
    const chaveAtual = chaveConversa(telefoneDoContato(), nomeDoContato());
    // Identidade ESTÁVEL da conversa aberta pro guard "trocou de conversa?".
    // NÃO usar telefoneDoContato() aqui: o número raspado do DOM flipa (aparece
    // só depois que o WhatsApp termina de renderizar os data-id) — durante a
    // busca do telefone a chave mudava de 'nome:x' pra o número, o guard achava
    // que trocou de conversa, saía com return e DEIXAVA O SPINNER GIRANDO PRA
    // SEMPRE (bug do "Verificando análise salva…" que nunca saía). O nome do
    // cabeçalho é estável; leitura vazia (re-render) não conta como troca.
    const nomeAtual = nomeDoContato();
    const trocouDeConversa = () => {
      if (_secaoAtiva !== 'analise') return true;
      const n = nomeDoContato();
      return !!(n && n !== nomeAtual);
    };
    // Casa por CHAVE (telefone confirmado via wa-js quando a análise começou)
    // OU por NOME (estável) — nunca só pela chave calculada AGORA com
    // telefoneDoContato(): durante o carregarHistorico (rodarAnalise fica
    // rolando a tela pra carregar histórico antigo), a leitura de telefone via
    // DOM (data-id) fica instável a cada re-render da virtualização — a chave
    // calculada aqui não batia mais com a da análise 'rodando', o painel
    // "perdia" a análise em andamento e mostrava "Analisar este lead" de novo
    // (bug real: parecia travado, mas a análise seguia rodando por trás —
    // Guilherme, 21/07: "trava depois de clicar Analisar, em qualquer lead").
    const doConversaAtual = [..._analises.values()]
      .filter((a) => a.chave === chaveAtual || (nomeAtual && a.nome === nomeAtual))
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
    // Watchdog: o spinner "Verificando análise salva…" NUNCA pode ficar preso.
    // Se em 12s a resolução do telefone / o estado não voltarem (rede lenta,
    // conta @lid difícil, aba estrangulada em 2o plano), cai pro botão de
    // analisar em vez de girar pra sempre. O token evita que um watchdog velho
    // pise numa sincronização mais nova.
    const _tk = ++_syncToken;
    setTimeout(() => {
      if (_tk !== _syncToken || _secaoAtiva !== 'analise') return;
      const c = document.getElementById('job-painel-doc-corpo');
      if (c && c.querySelector('.job-carregando')) setCorpoSecao(telaSemAnalise());
    }, 12000);
    let telefone = '';
    try { telefone = (await pedirTelefoneWpp()) || telefoneDoContato(); } catch (e) { telefone = telefoneDoContato(); }
    if (trocouDeConversa()) return;
    if (!telefone) { setCorpoSecao(telaSemAnalise()); return; }
    let resp = null;
    try { resp = await chrome.runtime.sendMessage({ type: 'estado', telefone }); } catch (e) { /* segue sem retrato */ }
    if (trocouDeConversa()) return;
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

  // ── Prévia de mídia dentro do painel: NÃO dá pra usar <img src="url do JOB">
  //    direto — o WhatsApp Web tem um CSP estrito que bloqueia carregar imagem/
  //    áudio de fora do domínio dele (por isso o player aparecia "0:00/0:00" e a
  //    imagem nem carregava). Solução: o background (que tem host_permissions e
  //    não sofre o CSP da página) baixa a mídia, devolve base64, e aqui a gente
  //    vira um blob: URL (mesma-origem, o CSP libera) e injeta no <img>/<audio>.
  //    Carrega SÓ quando o elemento fica visível (abrir o olho / a pasta) via
  //    IntersectionObserver — não baixa tudo de uma vez. ──
  function _dataUrlParaBlobUrl(dataUrl) {
    const virg = dataUrl.indexOf(',');
    const meta = dataUrl.slice(0, virg);
    const b64 = dataUrl.slice(virg + 1);
    const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([bytes], { type: mime }));
  }
  const _midiaObserver = ('IntersectionObserver' in window)
    ? new IntersectionObserver((entradas) => {
        for (const en of entradas) {
          if (en.isIntersecting) { _midiaObserver.unobserve(en.target); _carregarUmaMidia(en.target); }
        }
      }, { root: null, rootMargin: '150px' })
    : null;
  async function _carregarUmaMidia(ph) {
    if (!ph || ph.getAttribute('data-midia-carregada')) return;
    ph.setAttribute('data-midia-carregada', '1');
    const url = ph.getAttribute('data-midia-url');
    const tipo = ph.getAttribute('data-midia-tipo');
    try {
      const dl = await chrome.runtime.sendMessage({ type: 'baixar_midia', url });
      if (!dl || !dl.ok) { ph.textContent = 'não consegui carregar a prévia'; return; }
      const blobUrl = _dataUrlParaBlobUrl(dl.dataUrl);
      let el;
      if (tipo === 'imagem') { el = document.createElement('img'); el.className = 'job-modelo-img'; el.src = blobUrl; }
      else if (tipo === 'video') { el = document.createElement('video'); el.className = 'job-modelo-img'; el.controls = true; el.src = blobUrl; }
      else if (tipo === 'audio') { el = document.createElement('audio'); el.className = 'job-modelo-audio'; el.controls = true; el.src = blobUrl; }
      if (el) ph.replaceWith(el); else ph.remove();
    } catch (e) { ph.textContent = 'erro ao carregar prévia'; }
  }
  function _observarMidias(container) {
    if (!container) return;
    const pend = container.querySelectorAll('[data-midia-url]:not([data-midia-carregada])');
    pend.forEach((ph) => { if (_midiaObserver) _midiaObserver.observe(ph); else _carregarUmaMidia(ph); });
  }
  // Placeholder HTML pra mídia (imagem/áudio/vídeo). PDF continua sendo um link
  // (abre em aba nova — navegação, não sofre o CSP de embed).
  function midiaLazyHtml(tipo, url) {
    if (!url) return '';
    if (tipo === 'documento') {
      return '<a class="job-modelo-doc" href="' + esc(url) + '" target="_blank" rel="noopener">' + _svgIco('documento', 12) + ' Abrir PDF</a>';
    }
    if (tipo === 'imagem' || tipo === 'audio' || tipo === 'video') {
      return '<div class="job-midia-lazy" data-midia-url="' + esc(url) + '" data-midia-tipo="' + esc(tipo) + '">carregando prévia…</div>';
    }
    return '';
  }

  function cardModelo(m) {
    // Ouvir/ver antes de enviar — carrega via background (CSP do WhatsApp bloqueia
    // src externo direto), só quando fica visível.
    const midia = m.midia_url ? midiaLazyHtml(m.midia_tipo, m.midia_url) : '';
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
      const key = 'modelos:sub:' + cat;
      html += '<details class="job-subpasta" data-pasta-key="' + esc(key) + '"' + (_pastaAberta(key) ? ' open' : '') + '><summary class="job-subpasta-nome">' +
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
        const key = 'modelos:dono:' + dono;
        out += '<details class="job-pasta" data-pasta-key="' + esc(key) + '"' + (_pastaAberta(key) ? ' open' : '') + '><summary class="job-pasta-nome">' +
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
    _observarMidias(c);
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
    const { usuarioId } = await _safeStorageGet(['usuarioId']);
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
    const { usuarioId } = await _safeStorageGet(['usuarioId']);
    if (!usuarioId) { if (st) st.textContent = 'Selecione seu usuário no popup da extensão primeiro.'; return; }
    btn.disabled = true;
    if (st) st.textContent = 'Enviando…';
    let nome = nomeDoContato();
    // chat_id da conversa aberta é o caminho à prova de falha (funciona pra
    // contato salvo e @lid). Telefone é só best-effort, pra casar o lead no CRM.
    let chatId = '';
    try { chatId = await pedirChatId(); } catch (e) { chatId = ''; }
    let telefone = await garantirTelefone(nome, chatId);
    nome = nomeMaisConfiavel(nome); // depois de garantirTelefone, a wa-js já tentou achar o nome de verdade
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
  // (a extensão se atualizou e ESTA aba não foi recarregada — o código rodando
  // aqui virou uma cópia velha, órfã do background novo). Não é "você está
  // desatualizado": a extensão já está na última versão, é só esta aba que
  // precisa de um F5. Um botão dá o reload.
  function _avisoRecarregarAba() {
    return '<div class="job-erro" style="text-align:center">' +
      'A extensão foi atualizada num segundo plano.<br><b>Esta aba do WhatsApp Web precisa recarregar</b> ' +
      'pra pegar a versão nova (a extensão em si já está atualizada).' +
      '<br><button class="job-analisar-btn" id="job-recarregar-aba" style="margin-top:12px">Recarregar agora</button>' +
      '</div>';
  }

  function setCorpoSecaoMensagens(html) {
    const c = document.getElementById('job-painel-doc-corpo');
    if (c) {
      c.innerHTML = html;
      _observarMidias(c);
      // O CSP do WhatsApp Web bloqueia onclick inline — o botão de recarregar
      // só funciona com listener de verdade. location.reload() é API de window
      // (não chrome.*), então roda mesmo com o contexto da extensão invalidado.
      const btnReload = c.querySelector('#job-recarregar-aba');
      if (btnReload) btnReload.addEventListener('click', function () { location.reload(); });
    }
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
  // Fila de execuções: cada disparo vira um "job" independente. Jobs em
  // conversas DIFERENTES rodam em paralelo (não se atrapalham). Dois jobs pro
  // MESMO contato (chatId) enfileiram — o segundo só começa quando o primeiro
  // terminar, pra nunca intercalar mensagem de um funil com a de outro na
  // mesma conversa. Acompanhados numa bolha discreta e arrastável (não trava
  // mais a tela — pedido do Guilherme, 18/07).
  let _filaFunis = []; // [{id, funil, nomeContato, chatId, telefone, usuarioId, status, passoAtual, segundosRestantes, enviados, cancelar}]
  const _chatsOcupados = new Set();

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
      const key = 'funis:dono:' + dono;
      out += '<details class="job-pasta" data-pasta-key="' + esc(key) + '"' + (_pastaAberta(key) ? ' open' : '') + '><summary class="job-pasta-nome">' +
        esc(dono) + ' <span>(' + itens.length + ')</span></summary>' +
        '<div class="job-pasta-conteudo">' + itens.map(cardFunil).join('') + '</div></details>';
    });
    return out;
  }

  // Conteúdo de verdade de um passo do funil (texto inteiro + mídia tocável/
  // visível) — os dados já vêm prontos com buscarFunis (texto e midia_url),
  // não precisa baixar nada só pra mostrar aqui.
  function previewConteudoPasso(p) {
    const midia = p.midia_url ? midiaLazyHtml(p.tipo, p.midia_url) : '';
    const texto = (p.texto || '').trim();
    return (texto ? '<div class="job-modelo-preview">' + esc(texto) + '</div>' : '') + midia;
  }

  function cardFunil(f) {
    const passos = f.passos || [];
    const totalS = passos.reduce((s, p) => s + (p.delay_segundos || 0), 0);
    const meta = passos.length
      ? passos.length + ' passo' + (passos.length > 1 ? 's' : '') + (totalS ? ' · ~' + fmtQuando(totalS).replace('após ', '') : '')
      : 'sem passos';
    // Cada passo é uma caixinha colorida pelo tipo (padrão ZapVoice): o
    // consultor bate o olho e sabe o que vai sair — áudio, imagem, texto, PDF.
    // Clicar no "olho" mostra o conteúdo de verdade antes de disparar (o texto
    // inteiro, toca o áudio, vê a imagem) — antes só mostrava o NOME do
    // modelo, sem dar pra conferir o que ia sair de fato. Pedido do
    // Guilherme, 18/07.
    const listaPassos = passos.map((p, i) =>
      '<div class="job-fpasso t-' + esc(p.tipo || 'texto') + '">' +
        '<div class="job-fpasso-linha">' +
          '<span class="job-fpasso-ico">' + funilTipoIcone(p.tipo, 14) + '</span>' +
          '<div class="job-fpasso-info">' +
            '<div class="job-fpasso-nome">' + esc(p.nome) + '</div>' +
            '<div class="job-fpasso-quando">' + _svgIco('relogio', 10) + ' Enviando ' + esc(fmtQuando(p.delay_segundos)) + '</div>' +
          '</div>' +
          '<button class="job-fpasso-olho" title="Ver conteúdo">' + _svgIco('olho', 14) + '</button>' +
          '<span class="job-fpasso-num">' + (i + 1) + '</span>' +
        '</div>' +
        '<div class="job-fpasso-preview fechado">' + previewConteudoPasso(p) + '</div>' +
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
    _observarMidias(c);
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
    document.querySelectorAll('.job-fpasso-olho').forEach((btn) => {
      btn.addEventListener('click', () => {
        const passo = btn.closest('.job-fpasso');
        const preview = passo && passo.querySelector('.job-fpasso-preview');
        if (!preview) return;
        preview.classList.toggle('fechado');
        const aberto = !preview.classList.contains('fechado');
        btn.classList.toggle('ativo', aberto);
        // Ao abrir, carrega a mídia na hora (não espera o IntersectionObserver).
        if (aberto) preview.querySelectorAll('[data-midia-url]:not([data-midia-carregada])').forEach(_carregarUmaMidia);
      });
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

  function _uid() {
    return 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ── Dispara um funil: cria um "job" e entra na fila. Jobs em conversas
  //    DIFERENTES rodam em paralelo (não se atrapalham). Dois jobs pro MESMO
  //    contato enfileiram — o segundo só começa quando o primeiro terminar,
  //    pra nunca intercalar mensagens de dois funis na mesma conversa. ──
  async function dispararFunil(funilId) {
    const res = await buscarFunis(false);
    // Três casos DIFERENTES, três mensagens — misturar tudo em "não tem passos"
    // já mascarou um bug real de cache.
    if (!res || !res.ok) { alert('Não consegui carregar o funil: ' + ((res && res.erro) || 'tente de novo.')); return; }
    const funil = (res.funis || []).find((f) => String(f.id) === String(funilId));
    if (!funil) { alert('Funil não encontrado — feche e abra a aba Funis pra recarregar.'); return; }
    if (!(funil.passos || []).length) { alert('Esse funil não tem passos. Adicione passos no site (Funis WhatsApp).'); return; }
    const { usuarioId } = await _safeStorageGet(['usuarioId']);
    if (!usuarioId) { alert('Selecione seu usuário no popup da extensão primeiro.'); return; }
    let chatId = '';
    try { chatId = await pedirChatId(); } catch (e) { chatId = ''; }
    if (!chatId) { alert('Abra a conversa do cliente antes de disparar o funil.'); return; }
    const nome = nomeDoContato() || 'este contato';
    if (!confirm('Disparar o funil "' + funil.nome + '" (' + funil.passos.length + ' passo(s)) para ' + nome + '?')) return;
    let telefone = await garantirTelefone(nome, chatId);

    const job = {
      id: _uid(), funil, chatId, nomeContato: nome, telefone, usuarioId,
      status: 'aguardando', passoAtual: 0, segundosRestantes: 0, enviados: 0, cancelar: false,
    };
    _filaFunis.push(job);
    const podeComecar = !_chatsOcupados.has(chatId);
    if (podeComecar) { _chatsOcupados.add(chatId); job.status = 'rodando'; }
    renderBubble();
    if (podeComecar) executarJob(job);
  }

  async function executarJob(job) {
    const { funil } = job;
    function reportarProgresso(passoIdx, segundosRestantes) {
      job.passoAtual = passoIdx; job.segundosRestantes = segundosRestantes || 0;
      renderBubble();
      try {
        chrome.runtime.sendMessage({
          type: 'funil_progresso', usuario_id: job.usuarioId, job_uid: job.id,
          funil_id: funil.id, funil_nome: funil.nome, nome: job.nomeContato, telefone: job.telefone,
          passo_atual: passoIdx + 1, total_passos: funil.passos.length,
          segundos_restantes: segundosRestantes || 0, status: 'rodando',
        });
      } catch (e) { /* best-effort, nunca trava o disparo */ }
    }
    reportarProgresso(0, 0);
    for (let i = 0; i < funil.passos.length; i++) {
      if (job.cancelar) break;
      const passo = funil.passos[i];
      const segundos = Math.max(0, passo.delay_segundos || 0);
      let resta = segundos;
      reportarProgresso(i, resta);
      while (resta > 0) {
        if (job.cancelar) break;
        await new Promise((r) => setTimeout(r, 1000));
        resta--;
        if (resta % 3 === 0) reportarProgresso(i, resta);
        else { job.segundosRestantes = resta; renderBubble(); }
      }
      if (job.cancelar) break;
      job.enviando = i; renderBubble();
      let envio;
      try {
        if (passo.tipo && passo.tipo !== 'texto' && passo.midia_url) {
          const dl = await chrome.runtime.sendMessage({ type: 'baixar_midia', url: passo.midia_url });
          if (dl && dl.ok) envio = await pedirEnviarMidia(job.chatId, passo.tipo, dl.dataUrl, passo.texto, _nomeArquivoDaUrl(passo.midia_url));
          else envio = { ok: false, erro: (dl && dl.erro) || 'falha ao baixar a mídia' };
        } else {
          envio = await pedirEnviarTexto(job.chatId, passo.texto);
        }
      } catch (e) { envio = { ok: false, erro: String(e && e.message || e) }; }
      job.enviando = -1;
      if (envio && envio.ok) { job.enviados++; job.passoAtual = i + 1; }
      renderBubble();
    }
    job.status = job.cancelar ? 'cancelado' : 'concluido';
    renderBubble();
    try { await chrome.runtime.sendMessage({ type: 'funil_disparado', funil_id: funil.id, telefone: job.telefone, enviados: job.enviados, usuario_id: job.usuarioId, job_uid: job.id }); } catch (e) { /* registro é best-effort */ }
    // Libera o chat pro próximo job enfileirado pra ele (se tiver).
    _chatsOcupados.delete(job.chatId);
    const proximo = _filaFunis.find((j) => j.status === 'aguardando' && j.chatId === job.chatId);
    if (proximo) { _chatsOcupados.add(job.chatId); proximo.status = 'rodando'; executarJob(proximo); }
    // Some da bolha sozinho depois de um tempo — mas fica visível o bastante
    // pra dar tempo do consultor ver que terminou (ou que deu erro).
    setTimeout(() => {
      _filaFunis = _filaFunis.filter((j) => j.id !== job.id);
      renderBubble();
    }, 8000);
    renderBubble();
  }

  function cancelarJob(jobId) {
    const job = _filaFunis.find((j) => j.id === jobId);
    if (!job) return;
    if (job.status === 'aguardando') {
      _filaFunis = _filaFunis.filter((j) => j.id !== jobId);
    } else {
      job.cancelar = true;
    }
    renderBubble();
  }

  function fecharJobDaLista(jobId) {
    _filaFunis = _filaFunis.filter((j) => j.id !== jobId);
    renderBubble();
  }

  // ── Bolha discreta e arrastável: fica um pontinho pequeno no canto (não
  //    trava mais a tela — pedido do Guilherme, 18/07). Clique expande a
  //    lista de execuções (paralelas e enfileiradas); arrastar move o
  //    conjunto pra qualquer canto da tela. ──
  let _bubblePos = null; // {left, top} em px — null = ainda não foi movida (posição padrão)
  let _bubbleAberta = false;

  function _bubbleEl() { return document.getElementById('job-funil-bubble'); }

  function renderBubble() {
    if (!_filaFunis.length) {
      const el = _bubbleEl();
      if (el) el.remove();
      return;
    }
    let el = _bubbleEl();
    if (!el) {
      el = document.createElement('div');
      el.id = 'job-funil-bubble';
      document.body.appendChild(el);
      ligarDragBubble(el);
    }
    if (_bubblePos) { el.style.left = _bubblePos.left + 'px'; el.style.top = _bubblePos.top + 'px'; }

    const rodando = _filaFunis.filter((j) => j.status === 'rodando').length;
    const aguardando = _filaFunis.filter((j) => j.status === 'aguardando').length;

    const linhas = _filaFunis.map((j) => {
      let sub;
      if (j.status === 'aguardando') sub = 'na fila — espera a conversa liberar';
      else if (j.status === 'concluido') sub = 'concluído — ' + j.enviados + '/' + j.funil.passos.length + ' enviados';
      else if (j.status === 'cancelado') sub = 'cancelado — ' + j.enviados + '/' + j.funil.passos.length + ' enviados';
      else if (typeof j.enviando === 'number' && j.enviando >= 0) sub = 'passo ' + (j.enviando + 1) + '/' + j.funil.passos.length + ': enviando…';
      else sub = 'passo ' + (j.passoAtual + 1) + '/' + j.funil.passos.length + (j.segundosRestantes ? (' — em ' + j.segundosRestantes + 's') : '');
      const acaoBtn = (j.status === 'rodando' || j.status === 'aguardando')
        ? '<button class="job-fb-cancelar" data-jid="' + j.id + '">' + (j.status === 'aguardando' ? 'tirar da fila' : 'cancelar') + '</button>'
        : '<button class="job-fb-fechar" data-jid="' + j.id + '">fechar</button>';
      return '<div class="job-fb-linha job-fb-' + j.status + '">' +
        '<div class="job-fb-linha-top"><b>' + esc(j.funil.nome) + '</b><span>' + esc(j.nomeContato) + '</span></div>' +
        '<div class="job-fb-linha-sub">' + esc(sub) + '</div>' +
        acaoBtn +
      '</div>';
    }).join('');

    el.innerHTML =
      '<div class="job-fb-dot" id="job-fb-dot" title="Funis rodando — arraste pra mover">' +
        (rodando || aguardando) +
      '</div>' +
      '<div class="job-fb-painel" id="job-fb-painel" style="display:' + (_bubbleAberta ? 'block' : 'none') + '">' +
        '<div class="job-fb-cab">Funis em andamento</div>' +
        linhas +
      '</div>';

    document.getElementById('job-fb-dot').addEventListener('click', (e) => {
      if (el.dataset.arrastou === '1') { el.dataset.arrastou = ''; return; } // não abre se acabou de arrastar
      _bubbleAberta = !_bubbleAberta;
      renderBubble();
    });
    el.querySelectorAll('.job-fb-cancelar').forEach((b) => b.addEventListener('click', () => cancelarJob(b.dataset.jid)));
    el.querySelectorAll('.job-fb-fechar').forEach((b) => b.addEventListener('click', () => fecharJobDaLista(b.dataset.jid)));
  }

  function ligarDragBubble(el) {
    const dot = () => el.querySelector('#job-fb-dot');
    let arrastando = false, offX = 0, offY = 0;
    el.addEventListener('mousedown', (e) => {
      if (!e.target.closest('#job-fb-dot')) return; // só arrasta pelo pontinho, não pelo painel aberto
      arrastando = true;
      const r = el.getBoundingClientRect();
      offX = e.clientX - r.left; offY = e.clientY - r.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!arrastando) return;
      el.dataset.arrastou = '1';
      const left = Math.min(Math.max(4, e.clientX - offX), window.innerWidth - 60);
      const top = Math.min(Math.max(4, e.clientY - offY), window.innerHeight - 60);
      _bubblePos = { left, top };
      el.style.left = left + 'px'; el.style.top = top + 'px';
      el.style.right = 'auto'; el.style.bottom = 'auto';
    });
    document.addEventListener('mouseup', () => { arrastando = false; });
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  // Classe da faixa (não mais cor fixa): o CSS resolve a cor por tema via --fx.
  function classeFaixa(faixa) {
    return { quente: 'faixa-quente', bom: 'faixa-bom', medio: 'faixa-medio', baixo: 'faixa-baixo' }[faixa] || 'faixa-ruim';
  }

  function linhaDado(rotulo, valor) {
    if (valor === null || valor === undefined || valor === '' ||
        (Array.isArray(valor) && !valor.length)) return '';
    const v = Array.isArray(valor) ? valor.join(', ') : String(valor);
    return '<div class="job-dado"><span>' + esc(rotulo) + '</span><b>' + esc(v) + '</b></div>';
  }

  function renderResultado(r, nome, telefone, totalMsgs) {
    const fx = classeFaixa(r.faixa);
    const ex = r.extracao || {};
    const sugs = (r.sugestoes || []).map((s) => {
      const pcl = s.prioridade === 'alta' ? 'p-alta' : (s.prioridade === 'media' ? 'p-media' : 'p-baixa');
      return '<div class="job-sug"><div class="job-sug-tag ' + pcl + '">' +
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
          ? '<div class="job-lead-dono ok">Atribuído a <b>' + esc(r.consultor_nome) + '</b>.</div>'
          : '<div class="job-ia-alerta">⚠ Lead criado SEM responsável — selecione seu usuário no popup da extensão (e cadastre seu telefone em Usuários no JOB).</div>';
      } else if (ehMeu === true) {
        donoLinha = '<div class="job-lead-dono ok">Este lead já está no seu cadastro.</div>';
      } else if (r.lead_responsavel_nome && ehMeu === false) {
        donoLinha = '<div class="job-ia-alerta">⚠ Este lead está com OUTRO consultor no JOB: <b>' + esc(r.lead_responsavel_nome) + '</b>.</div>';
      } else if (r.lead_responsavel_nome) {
        donoLinha = '<div class="job-lead-dono neutro">Responsável no JOB: <b>' + esc(r.lead_responsavel_nome) + '</b>.</div>';
      } else {
        donoLinha = '<div class="job-lead-dono warn">Este lead está sem responsável no JOB.</div>';
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
    // Transparência do teto: nunca cortar mídia em silêncio. Diz "X de Y".
    if (r.audios_cortados) avisos.push(r.audios_cortados + ' de ' + (r.audios_encontrados || '?') + ' áudios ficaram de fora (limite de 60 por análise) — os mais recentes entraram.');
    if (r.imagens_cortadas) avisos.push(r.imagens_cortadas + ' de ' + (r.imagens_encontrados || '?') + ' imagens ficaram de fora (limite de 20 por análise).');
    if (r.documentos_falha) avisos.push(r.documentos_falha + ' de ' + (r.documentos_encontrados || '?') + ' PDF(s) não entraram (limite ou falha de download) — Analisar de novo pra tentar incluir.');
    const avisoFalhas = avisos.length
      ? avisos.map((a) => '<div class="job-ia-alerta">⚠ ' + esc(a) + '</div>').join('')
      : '';
    // PDFs do consultor com +5 páginas que nem baixamos (otimização) — aviso
    // próprio, com botão pra ler mesmo assim se o Guilherme quiser.
    const avisoPulados = (Array.isArray(r._pulados) && r._pulados.length)
      ? '<div class="job-ia-alerta">⚠ ' + esc(r._pulados.length + ' PDF(s) que o consultor enviou não foram lidos por terem mais de 5 páginas (material de apoio costuma não mudar a análise): ' +
          r._pulados.map((p) => p.nome + ' (' + p.paginas + ' pág)').join(', ')) +
          '<div style="margin-top:7px;"><button class="job-copy" id="job-avaliar-pdfs" style="font-size:12px;padding:4px 10px;">Avaliar esses PDFs mesmo assim</button></div></div>'
      : '';
    const partesRodape = [esc(nome || ''), totalMsgs + ' mensagens lidas'];
    if (r.duracao_segundos != null) partesRodape.push('levou ' + fmtDuracao(r.duracao_segundos));
    if (r.audios_do_cache) partesRodape.push(r.audios_do_cache + ' áudio(s) reaproveitados do cache');
    partesRodape.push('somente leitura');
    return (
      '<div class="job-score-wrap">' +
        '<div class="job-score-num ' + fx + '">' + (r.score != null ? r.score : '—') + '</div>' +
        '<div class="job-score-meta"><div class="job-score-faixa ' + fx + '">' +
          esc((r.faixa || '').toUpperCase()) + '</div>' +
          '<div class="job-score-sub">Score Lead · 0–1000 · ' + (r.categorias_consideradas || 0) + '/' +
          (r.categorias_totais || 28) + ' critérios</div></div>' +
      '</div>' +
      '<div class="job-barra"><div class="job-barra-fill ' + fx + '" style="width:' + Math.round((r.score || 0) / 10) + '%;"></div></div>' +
      '<div class="job-chips">' + chips + pen + '</div>' +
      capBox +
      avisoFalhas +
      avisoPulados +
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
    // "Avaliar esses PDFs mesmo assim" — reanalisa forçando a leitura dos PDFs
    // grandes do consultor que foram pulados pela otimização.
    const bpdf = document.getElementById('job-avaliar-pdfs');
    if (bpdf) {
      bpdf.addEventListener('click', () => {
        bpdf.disabled = true;
        bpdf.textContent = 'Reanalisando com os PDFs…';
        rodarAnalise(true);
      });
    }
  }

  // ═══════════════ Notas do lead — aba do trilho ═══════════════
  // Anotações presas ao telefone (mora no nosso banco). ATENÇÃO — a primeira
  // versão disso era uma barra flutuante em cima da conversa; deu problema
  // (não salvava de forma confiável) e a barra ORIGINAL antes dela inseria
  // direto em #main, o que QUEBROU O ENVIO de mensagem (bug real, confirmado
  // em produção 23/07/2026). Por isso agora é uma aba normal do trilho —
  // mesmo padrão já comprovado da aba CNPJ: document.body via setCorpoSecao,
  // nunca toca no DOM do WhatsApp, resolve o telefone NA HORA (sem estado
  // global que pode ficar desatualizado entre trocas de conversa).
  function _tempoBrCurto(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    return m ? (m[3] + '/' + m[2] + ' ' + m[4] + ':' + m[5]) : '';
  }

  async function abrirSecaoNotas() {
    setCorpoSecao('<div class="job-sem-analise"><div class="job-carregando"></div><div class="job-sem-analise-txt">Abrindo notas…</div></div>');
    let tel = '';
    try { tel = (await pedirTelefoneWpp()) || telefoneDoContato(); } catch (e) { tel = telefoneDoContato(); }
    const nome = nomeDoContato();
    if (!tel) {
      setCorpoSecao('<div class="job-erro">Abra uma conversa primeiro pra ver as notas do lead.</div>');
      return;
    }
    await _carregarNotasSecao(tel, nome);
  }

  async function _carregarNotasSecao(tel, nome) {
    let resp;
    try { resp = await _safeSendMessage({ type: 'notas_listar', telefone: tel }); } catch (e) { resp = null; }
    if (!resp || !resp.ok) {
      setCorpoSecao('<div class="job-erro">Não consegui carregar as notas agora. <button class="job-copy" id="job-notas-retry" style="width:auto;display:inline;padding:4px 10px;margin-left:6px;">Tentar de novo</button></div>');
      const rt = document.getElementById('job-notas-retry');
      if (rt) rt.addEventListener('click', () => _carregarNotasSecao(tel, nome));
      return;
    }
    _renderSecaoNotas(tel, nome, resp.notas || []);
  }

  function _renderSecaoNotas(tel, nome, notas) {
    const lista = notas.length
      ? notas.map((no) =>
          '<div class="job-nota-item">' +
            '<div class="job-nota-txt">' + esc(no.texto) + '</div>' +
            '<div class="job-nota-meta">' + esc([no.autor_nome, _tempoBrCurto(no.criado_em)].filter(Boolean).join(' · ')) +
              '<button class="job-nota-del" data-id="' + no.id + '" title="Excluir">×</button></div>' +
          '</div>').join('')
      : '<div class="job-notas-vazio" style="padding:6px 2px;">Ainda sem notas deste lead. Escreva a primeira abaixo.</div>';
    setCorpoSecao(
      '<div class="job-notas-secao">' +
        '<div class="job-cnpj-titulo">Notas do lead</div>' +
        '<div class="job-cnpj-sub">' + esc(nome || tel) + ' — fica salvo no JOB, qualquer consultor que abrir essa conversa vê.</div>' +
        '<div class="job-notas-lista">' + lista + '</div>' +
        '<textarea id="job-nota-input" class="job-nota-input" rows="3" placeholder="Escrever uma nota deste lead…"></textarea>' +
        '<button class="job-cnpj-btn" id="job-nota-salvar">Salvar nota</button>' +
      '</div>');
    const salvar = document.getElementById('job-nota-salvar');
    const input = document.getElementById('job-nota-input');
    if (salvar && input) {
      salvar.addEventListener('click', async () => {
        const txt = (input.value || '').trim();
        if (!txt) { input.focus(); return; }
        salvar.disabled = true; salvar.textContent = 'Salvando…';
        const ok = await _salvarNotaLead(tel, txt);
        if (ok) { await _carregarNotasSecao(tel, nome); }
        else { salvar.disabled = false; salvar.textContent = 'Falha ao salvar — tentar de novo'; }
      });
    }
    document.querySelectorAll('.job-nota-del').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = parseInt(b.dataset.id, 10);
        b.disabled = true;
        try { await _safeSendMessage({ type: 'notas_excluir', id }); } catch (e) { /* ignora */ }
        await _carregarNotasSecao(tel, nome);
      });
    });
  }

  // Cria uma nota no telefone informado. texto obrigatório. Retorna bool.
  async function _salvarNotaLead(tel, texto) {
    if (!tel) { try { tel = (await pedirTelefoneWpp()) || telefoneDoContato(); } catch (e) { tel = telefoneDoContato(); } }
    if (!tel) return false;
    const { usuarioId } = await _safeStorageGet(['usuarioId']);
    // Manda o chat_id junto: e com ele que o JOB amarra a nota ao @lid e, de
    // quebra, registra o vinculo da conversa com o lead.
    let chatId = '';
    try { const r = await _pedirPonte('obter_chat_id', {}, 8000); chatId = (r && r.chat_id) || ''; } catch (e) {}
    let resp;
    try { resp = await _safeSendMessage({ type: 'notas_criar', telefone: tel, texto,
                                          usuario_id: usuarioId, chatId }); }
    catch (e) { resp = null; }
    return !!(resp && resp.ok);
  }

  // Acha o lead no CRM do JOB pelo telefone da conversa aberta e abre em nova
  // aba. Ação direta do trilho (não abre seção) — pedido do Guilherme pra
  // pular a busca manual no CRM.
  async function _abrirLeadNoCrm(btn) {
    const rotuloOriginal = btn.querySelector('.job-trilho-item-label');
    const setLabel = (t) => { if (rotuloOriginal) rotuloOriginal.textContent = t; };
    let tel = '';
    try { tel = (await pedirTelefoneWpp()) || telefoneDoContato(); } catch (e) { tel = telefoneDoContato(); }
    if (!tel) { setLabel('Sem conversa'); setTimeout(() => setLabel('CRM'), 2200); return; }
    setLabel('Buscando…');
    let resp;
    try { resp = await _safeSendMessage({ type: 'lead_por_telefone', telefone: tel }); } catch (e) { resp = null; }
    if (resp && resp.ok && resp.achou && resp.lead_id) {
      window.open(_SITE_BASE_URL_EXT + '/crm?lead=' + resp.lead_id, '_blank', 'noopener');
      setLabel('CRM');
    } else {
      // Não achou lead pelo telefone: em vez de só avisar "sem lead", oferece
      // cadastrar na hora (opcional — o consultor decide). Pedido do Guilherme:
      // com dados completos, pra não entrar lead capenga no funil.
      setLabel('CRM');
      abrirSecao('crm');
    }
  }

  // ═══════════ Cadastrar lead no CRM direto da conversa ═══════════
  // Só aparece quando o botão CRM não achou ninguém por telefone. Nome e
  // telefone vêm pré-preenchidos da conversa aberta (o telefone é validado
  // contra o número real, não digitado à mão), e a origem é obrigatória —
  // lead sem origem não deixa medir canal depois.
  const _ORIGENS_LEAD = ['Indicação', 'Google', 'Facebook', 'Instagram', 'MEDSENIOR', 'Site', 'manual'];
  const _ORIGEM_ROTULO = { 'MEDSENIOR': 'MedSênior', 'manual': 'Manual / prospecção' };

  async function abrirSecaoNovoLead() {
    setCorpoSecao('<div class="job-sem-analise"><div class="job-carregando"></div><div class="job-sem-analise-txt">Lendo a conversa…</div></div>');
    let tel = '';
    try { tel = (await pedirTelefoneWpp()) || telefoneDoContato(); } catch (e) { tel = telefoneDoContato(); }
    if (!tel) {
      setCorpoSecao('<div class="job-erro">Abra uma conversa primeiro pra cadastrar o lead.</div>');
      return;
    }
    // Nome do cabeçalho só serve se NÃO for o próprio número (contato não salvo).
    const nomeBruto = (nomeDoContato() || '').trim();
    const nomeSugerido = /^[+\d\s()\-]+$/.test(nomeBruto) ? '' : nomeBruto;
    setCorpoSecao(
      '<div class="job-novolead">' +
        '<div class="job-cnpj-titulo">Cadastrar lead no CRM</div>' +
        '<div class="job-cnpj-sub">Este número ainda não está no JOB. Cadastre com os dados completos pra ele entrar no funil e ser medido por canal.</div>' +
        '<label class="job-nl-lbl">Nome <span class="job-nl-req">obrigatório</span></label>' +
        '<input id="job-nl-nome" class="job-cnpj-input" placeholder="Nome do lead" value="' + esc(nomeSugerido) + '" />' +
        '<label class="job-nl-lbl">Telefone <span class="job-nl-ok">da conversa</span></label>' +
        '<input id="job-nl-tel" class="job-cnpj-input" value="' + esc(_fmtTelBr(tel)) + '" readonly />' +
        '<label class="job-nl-lbl">Como chegou <span class="job-nl-req">obrigatório</span></label>' +
        '<select id="job-nl-origem" class="job-cnpj-input">' +
          '<option value="">Selecione…</option>' +
          _ORIGENS_LEAD.map((o) => '<option value="' + esc(o) + '">' + esc(_ORIGEM_ROTULO[o] || o) + '</option>').join('') +
        '</select>' +
        '<label class="job-nl-lbl">Observação <span class="job-nl-opt">opcional</span></label>' +
        '<textarea id="job-nl-obs" class="job-nota-input" rows="2" placeholder="Ex: indicado pela Ana, quer plano pra 3 vidas"></textarea>' +
        '<button class="job-cnpj-btn" id="job-nl-salvar">Cadastrar no CRM</button>' +
        '<div id="job-nl-msg"></div>' +
      '</div>');
    const bt = document.getElementById('job-nl-salvar');
    if (bt) bt.addEventListener('click', () => _salvarNovoLead(tel));
    const inNome = document.getElementById('job-nl-nome');
    if (inNome) inNome.focus();
  }

  function _fmtTelBr(t) {
    const d = String(t || '').replace(/\D/g, '').replace(/^55/, '');
    if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return String(t || '');
  }

  async function _salvarNovoLead(telefone) {
    const msg = document.getElementById('job-nl-msg');
    const bt = document.getElementById('job-nl-salvar');
    const nome = (document.getElementById('job-nl-nome') || {}).value || '';
    const origem = (document.getElementById('job-nl-origem') || {}).value || '';
    const obs = (document.getElementById('job-nl-obs') || {}).value || '';
    const aviso = (txt) => { if (msg) msg.innerHTML = '<div class="job-ia-alerta">⚠ ' + esc(txt) + '</div>'; };
    if (!nome.trim()) { aviso('Informe o nome do lead.'); return; }
    if (!origem) { aviso('Selecione como o lead chegou.'); return; }
    if (msg) msg.innerHTML = '';
    if (bt) { bt.disabled = true; bt.textContent = 'Cadastrando…'; }
    const { usuarioId } = await _safeStorageGet(['usuarioId']);
    let resp;
    try {
      resp = await _safeSendMessage({ type: 'lead_criar', nome: nome.trim(), telefone,
        origem, observacoes: obs.trim(), usuario_id: usuarioId });
    } catch (e) { resp = null; }
    if (!resp || !resp.ok) {
      aviso((resp && resp.erro) || 'Não consegui cadastrar agora. Tente de novo.');
      if (bt) { bt.disabled = false; bt.textContent = 'Cadastrar no CRM'; }
      return;
    }
    const url = _SITE_BASE_URL_EXT + '/crm?lead=' + resp.lead_id;
    setCorpoSecao(
      '<div class="job-novolead">' +
        '<div class="job-cnpj-titulo">' + (resp.ja_existia ? 'Esse lead já existia' : 'Lead cadastrado') + '</div>' +
        '<div class="job-cnpj-sub">' + (resp.ja_existia
          ? 'Já havia um lead com esse telefone no JOB — abrimos o existente em vez de duplicar.'
          : 'Entrou no funil em "Lead Novo", atribuído a você.') + '</div>' +
        '<a class="job-cnpj-link" href="' + esc(url) + '" target="_blank" rel="noopener" style="display:flex;margin-top:12px;">Abrir no CRM</a>' +
      '</div>');
  }

  async function rodarAnalise(forcarPdfGrandes) {
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
      // Mensagens de texto DA WA-JS (fonte confiável, histórico completo, não
      // quebra com mudança de layout) — igual ZapVoice/WaSpeed. Se a wa-js
      // falhar/vier vazia, cai na raspagem do DOM (reserva) pra nunca deixar o
      // consultor sem análise. O carregarHistorico acima segue valendo pras
      // IMAGENS (essas ainda vêm do DOM).
      let msgsBrutas = [];
      try { msgsBrutas = await pedirMensagensWpp(500); } catch (e) { msgsBrutas = []; }
      if (!msgsBrutas.length) msgsBrutas = rasparMensagensVisiveis();
      const mensagens = dedup(msgsBrutas);

      // Áudio/PDF/imagem NÃO usam a marca d'água do modo incremental —
      // já tentamos (pra economizar retranscrição) e era arriscado demais:
      // um áudio que ficasse de fora do teto numa rodada anterior (ou que
      // não tivesse sido transcrito por falta de chave configurada na hora)
      // ficava escondido PRA SEMPRE. Sempre relê o conjunto atual (com
      // prioridade lead+recente) — o custo de ocasionalmente re-transcrever
      // é bem menor que o risco de perder informação real do cliente.
      let imagens = [];
      let imagensEncontradas = 0;
      try {
        const ri = await rasparImagensVisiveis(status);
        imagens = ri.imagens || [];
        imagensEncontradas = ri.encontrados || imagens.length;
      } catch (e) { imagens = []; }

      status('Baixando e transcrevendo áudios…');
      let audios = [];
      let audiosEncontrados = 0;
      // Teto alto de propósito: conversas de venda têm MUITO áudio (a Hellen
      // tinha 34) e a análise precisa deles TODOS — a parte do cliente é o que
      // mais importa. Antes o teto era 12 e cortava 22 em silêncio. Agora a
      // transcrição roda em paralelo e é cacheada por msg_id no servidor, e o
      // Groq é baratíssimo, então subir o teto não pesa em custo nem em tempo.
      try {
        const ra = await pedirAudios(60);
        audios = ra.audios || [];
        audiosEncontrados = ra.encontrados || audios.length;
      } catch (e) { audios = []; }

      status('Baixando documentos PDF…');
      let documentos = [];
      let documentosEncontrados = 0;
      let pdfsPulados = [];
      try {
        const rd = await pedirDocumentos(15, forcarPdfGrandes);
        documentos = rd.documentos || [];
        documentosEncontrados = rd.encontrados || documentos.length;
        pdfsPulados = rd.pulados || [];
      } catch (e) { documentos = []; }

      let links = [];
      try { links = rasparLinks(); } catch (e) { links = []; }

      // TRAVA DE TAMANHO DO PAYLOAD. Mandar tudo numa mensagem só pro service
      // worker (44 áudios + imagens + PDFs = dezenas de MB) estoura a memória
      // do SW: ele MORRE e a análise falha ANTES de chegar no servidor (foi o
      // que quebrou na Hellen e no Fernando — o POST /analisar nem aparecia no
      // log). Mantém os ÁUDIOS (prioridade do Guilherme, e são pequenos) e
      // encaixa o máximo de imagens/PDF num teto seguro; o que não couber é
      // cortado e vira "X de Y" no painel (os *_encontrados seguem sendo o
      // total real). Prioriza os menores pra caber o máximo de itens.
      const _PAYLOAD_MAX_B64 = 22 * 1024 * 1024; // freio de segurança (o envio em lotes já evita o estouro; isto é só p/ conversa monstruosa)
      const _tamB64 = (m) => (m && m.base64 ? m.base64.length : 0);
      let _orcamento = _PAYLOAD_MAX_B64;
      const _audiosOk = [];
      for (const a of audios) { const t = _tamB64(a); if (t <= _orcamento) { _audiosOk.push(a); _orcamento -= t; } }
      const _pesadas = [
        ...imagens.map((x) => ({ tipo: 'img', item: x })),
        ...documentos.map((x) => ({ tipo: 'doc', item: x })),
      ].sort((p, q) => _tamB64(p.item) - _tamB64(q.item));
      const _imagensOk = [], _documentosOk = [];
      for (const p of _pesadas) {
        const t = _tamB64(p.item);
        if (t <= _orcamento) { (p.tipo === 'img' ? _imagensOk : _documentosOk).push(p.item); _orcamento -= t; }
      }
      audios = _audiosOk; imagens = _imagensOk; documentos = _documentosOk;

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
      const { usuarioId } = await _safeStorageGet(['usuarioId']);
      // Número do WhatsApp logado — o JOB atribui o lead pelo NÚMERO (quem está
      // de fato na conversa); o consultor do popup vira fallback.
      let meuNumero = '';
      try { meuNumero = await pedirMeuNumero(); } catch (e) { /* segue sem */ }
      // ENVIO EM LOTES: mandar tudo numa mensagem só pro service worker estoura
      // a memória dele (ele morre e a análise falha ANTES de chegar no servidor
      // — foi o que quebrou com 44 áudios). Aqui manda a BASE (texto/meta, leve),
      // depois as mídias em lotes pequenos que o background vai acumulando, e só
      // então dispara UM fetch com tudo montado. Sem pacote gigante, sem perder
      // mídia. O reqId amarra os lotes e permite cancelar.
      const _baseAnalise = {
        telefone, nome, mensagens, links,
        usuario_id: usuarioId || null, whatsapp_consultor: meuNumero || null,
        documentos_encontrados: documentosEncontrados,
        audios_encontrados: audiosEncontrados, imagens_encontrados: imagensEncontradas,
      };
      const resp = await enviarAnaliseEmLotes(reqId, _baseAnalise, audios, imagens, documentos);

      // Se o usuário cancelou enquanto a resposta ainda estava a caminho, não
      // sobrescreve o status 'cancelado' já aplicado por cancelarAnalise().
      if (entrada.status !== 'rodando') return;

      if (!resp || !resp.ok) {
        entrada.status = 'erro';
        entrada.erro = (resp && resp.erro) || 'Falha ao analisar';
      } else {
        entrada.status = 'ok';
        // Anexa os PDFs pulados pela otimização (só quando NÃO foi forçado) —
        // o painel usa pra mostrar o aviso + botão "avaliar mesmo assim".
        if (!forcarPdfGrandes && pdfsPulados.length) resp._pulados = pdfsPulados;
        entrada.resultado = resp;
      }
      atualizarPilula();
      notificarConclusao(entrada);
      sincronizarPainelComConversa();
    } catch (e) {
      // Contexto invalidado (extensão atualizada, aba órfã) é benigno — mostra o
      // aviso de F5, não um "Erro inesperado" vermelho preso no painel.
      if (_ehContextoInvalidado(e)) { _analises.delete(reqId); atualizarPilula(); _marcarContextoMorto(); return; }
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
  _safeStorageGet(['jobDevMode']).then((c) => { _devLigado = !!(c && c.jobDevMode); }).catch(() => {});
  // Padrao de nome escolhido pelo consultor — vale pra todos os leads dele.
  _safeStorageGet(['jobNomeContatoPartes']).then((c) => {
    if (c && c.jobNomeContatoPartes) Object.assign(_partesLigadas, c.jobNomeContatoPartes);
  }).catch(() => {});
  carregarPreferenciaLado().then(() => {
    criarTrilho();
    const obs = new MutationObserver(() => {
      if (!document.getElementById('job-trilho')) criarTrilho();
    });
    obs.observe(document.body, { childList: true, subtree: false });
    // Transcrição colada no áudio. Best-effort: se qualquer coisa aqui falhar, o
    // resto da extensão continua funcionando — transcrição é ganho, não requisito.
    try { trIniciar(); } catch (e) { console.warn('[JOB] transcrição não iniciou:', e); }
    try { varreduraIniciar(); } catch (e) { console.warn('[JOB] varredura não iniciou:', e); }
    verificarVersaoExtensao();
    // Reverifica sozinho a cada 20min, SEMPRE — antes só reagendava quando
    // achava atualização, então uma aba aberta por horas sem update na hora
    // do primeiro check nunca mais avisava depois (hora que "demora" pra
    // avisar era essa: aba antiga, sem re-checagem nenhuma agendada).
    _registrarLoop(setInterval(verificarVersaoExtensao, 20 * 60 * 1000));
    carregarSeletoresRemotos();
    _registrarLoop(setInterval(carregarSeletoresRemotos, 15 * 60 * 1000));
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
    atualizarSeloVersao(nova);
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
  }

  // ── Detecta troca de conversa (o WhatsApp Web é uma SPA — não navega, só
  //    troca o conteúdo — não existe evento nativo confiável pra "conversa
  //    trocou", então compara periodicamente). Só re-renderiza o painel quando
  //    a chave realmente muda, pra não piscar a cada tick.
  //    NOME apenas (não telefone): telefoneDoContato() lê o DOM (data-id das
  //    mensagens) e fica instável durante o scroll do carregarHistorico (a
  //    virtualização re-renderiza a lista) — comparar com telefone incluído
  //    disparava "trocou de conversa" à toa a cada 1.5s enquanto uma análise
  //    rodava, resincronizando o painel e derrubando o spinner de "Analisando…"
  //    de volta pra "Analisar este lead", mesmo com a análise seguindo rodando
  //    por trás (bug real: parecia travado — Guilherme, 21/07). ──
  let _ultimaChaveVista = null;
  let _tickViz = 0;
  _registrarLoop(setInterval(() => {
    if (!_contextoValido()) { _marcarContextoMorto(); return; }
    // Aba em segundo plano nao precisa de nada disto. O consultor deixa o
    // WhatsApp aberto o dia inteiro atras de outras abas; sem esta linha a
    // extensao continuava medindo layout a cada 1,5s numa aba que ninguem esta
    // vendo, e o navegador inteiro pagava por isso.
    if (document.hidden) return;
    // Eu dizia no comentario que remedir "e barato". Nao e: _medirVizinhos roda
    // getComputedStyle + getBoundingClientRect em cada filho do body, e isso
    // forca o navegador a recalcular layout. A cada 1,5s, pra sempre, em cima
    // do WhatsApp — era jank garantido. O que ele detecta (outra extensao com
    // trilho aparecendo ou sumindo) muda raramente: 12s cobre com folga, e
    // redimensionar a janela reavalia na hora.
    if ((++_tickViz % 8) === 0) aplicarOffsetVizinhos();
    const chaveAgora = nomeDoContato() || chaveConversa(telefoneDoContato(), nomeDoContato());
    if (chaveAgora === _ultimaChaveVista) return;
    _ultimaChaveVista = chaveAgora;
    sincronizarPainelComConversa();
  }, 1500));

  // ═══════════════ Fila de envio (Fase 1) ═══════════════
  // A cada ~20s pergunta ao JOB se tem alguma mensagem pra mandar (só se a
  // extensão estiver configurada). O QUE mandar e QUANDO foi decidido pelo
  // consultor lá no CRM — este loop só busca e executa, não decide nada.
  // O limite de ritmo de verdade mora no servidor (/api/whatsapp/fila/proximo);
  // o mutex aqui só evita duas consultas se sobrepondo na MESMA aba.
  let _filaOcupada = false;
  // Agenda a proxima checagem pro instante em que o servidor VAI liberar, em vez
  // de esperar o tique fixo. Era aqui a lentidao do funil: o gate anti-bloqueio
  // libera entre 12s e 45s, e a extensao so perguntava de 20 em 20 — liberou aos
  // 12, ela so viu aos 20; liberou aos 45, so viu aos 60. Num funil de 5 passos
  // isso vira minutos de espera que nao protegem nada, porque a protecao e o
  // gate, nao o atraso de quem pergunta.
  // ── MEDIR, nao achar ────────────────────────────────────────────────────
  // Guarda o tempo de cada operacao e manda em lote, de vez em quando. Sem isto
  // toda queixa de lentidao vira eu lendo codigo e adivinhando; com isto vira
  // "o envio esta em 38s, antes estava em 14". Nao viaja conteudo de conversa.
  const _MET = [];
  function _metrica(operacao, ms, ok, detalhe) {
    try {
      _MET.push({ operacao, ms: Math.round(ms), ok: ok !== false, detalhe: detalhe || '' });
      if (_MET.length >= 12) _enviarMetricas();
    } catch (e) { /* medir nunca pode atrapalhar */ }
  }
  async function _enviarMetricas() {
    if (!_MET.length) return;
    const lote = _MET.splice(0, 50);
    try {
      const { usuarioId } = await _safeStorageGet(['usuarioId']);
      lote.forEach((m) => { m.usuario_id = usuarioId || null; });
      await _safeSendMessage({ type: 'metricas', metricas: lote });
    } catch (e) { /* perdeu a medida, nao o trabalho */ }
  }
  _registrarLoop(setInterval(_enviarMetricas, 120000));

  let _filaTimer = null;
  function _agendarFila(segundos) {
    if (_filaTimer) clearTimeout(_filaTimer);
    const ms = Math.max(600, Math.min((segundos || 0) * 1000 + 400, 60000));
    _filaTimer = setTimeout(() => { _filaTimer = null; checarFilaDeEnvio(); }, ms);
  }

  async function checarFilaDeEnvio() {
    if (_contextoMorto) return;
    if (_filaOcupada) return;
    const { extKey, usuarioId } = await _safeStorageGet(['extKey', 'usuarioId']);
    if (!extKey || !usuarioId) return;
    _filaOcupada = true;
    const _t0 = Date.now();
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'fila_proximo', usuario_id: usuarioId });
      const item = resp && resp.ok && resp.item;
      if (!item) {
        // Nada agora: volta exatamente quando o gate abrir.
        if (resp && typeof resp.espera_s === 'number') _agendarFila(resp.espera_s);
        return;
      }
      let envio;
      if (item.tipo && item.tipo !== 'texto' && item.midia_url) {
        // Mídia: o background baixa (CSP), a ponte manda pela wa-js.
        const dl = await chrome.runtime.sendMessage({ type: 'baixar_midia', url: item.midia_url });
        if (dl && dl.ok) {
          envio = await pedirEnviarMidia(item.chat_id, item.tipo, dl.dataUrl, item.texto, _nomeArquivoDaUrl(item.midia_url));
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
      _metrica('envio_' + (item.tipo || 'texto'), Date.now() - _t0, !!(envio && envio.ok));
      // Mandou uma: tenta a proxima ja. O servidor decide se pode — aqui so
      // deixamos de dormir 20s a toa entre uma e outra.
      _agendarFila(1);
    } catch (e) { /* próxima rodada tenta de novo */ }
    finally { _filaOcupada = false; }
  }
  // Batida de seguranca: se nada agendar (aba dormiu, erro engolido), a fila
  // volta a andar sozinha. O caminho normal e o _agendarFila.
  _registrarLoop(setInterval(checarFilaDeEnvio, 20000));

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
  // O site do JOB pediu pra abrir uma conversa NESTA aba (via background).
  chrome.runtime.onMessage.addListener((msg, _rem, responder) => {
    if (!msg || msg.type !== 'abrir_chat_aqui') return;
    (async () => {
      try {
        const r = await _pedirPonte('abrir_chat', { chatId: msg.chatId || '', telefone: msg.telefone || '', texto: msg.texto || '' }, 12000);
        responder({ ok: !!(r && r.ok), motivo: (r && r.erro) || '' });
      } catch (e) {
        responder({ ok: false, motivo: String((e && e.message) || e) });
      }
    })();
    return true;
  });

  // "TESTAR AGORA", pedido da tela de Configuracoes do JOB.
  //
  // Sem isto, saber se uma peca voltou a funcionar era esperar a rodada
  // periodica (6h) ou reabrir o WhatsApp — e enquanto isso a tela continuava
  // dizendo "quebrou" mesmo depois da correcao ter subido. Diagnostico que so
  // atualiza sozinho nao serve pra confirmar conserto.
  chrome.runtime.onMessage.addListener((msg, _rem, responder) => {
    if (!msg || msg.type !== 'canario_agora') return;
    (async () => {
      try {
        const checagens = await canarioRodar('pedido pela tela do JOB');
        const ruins = (checagens || []).filter((c) => !c.ok);
        responder({ ok: true, total: (checagens || []).length, quebradas: ruins.length,
                    // Teste parcial precisa CHEGAR na tela como parcial, senao
                    // a pessoa le a linha velha como resposta do teste novo.
                    semConversa: !!(checagens && checagens.semConversa),
                    versao: _versaoExt() });
      } catch (e) {
        responder({ ok: false, motivo: String((e && e.message) || e).slice(0, 160) });
      }
    })();
    return true;
  });

  window.addEventListener('message', async (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== 'JOB_EXT_EVT' || d.tipo !== 'inbound' || !d.chatId) return;
    const alvo = _campWatch.get(d.chatId);
    if (!alvo) return;
    // Confirma pela leitura antes de reportar: só se a última é do contato E a gente
    // só mandou a saudação (não respondeu manual). Evita disparar funil quando um
    // humano já assumiu (mesmo pelo celular).
    let ok = false;
    try { ok = await pedirChecarInbound(d.chatId); } catch (e) { ok = false; }
    if (!ok) return;
    _campWatch.delete(d.chatId);
    try {
      const { usuarioId } = await _safeStorageGet(['usuarioId']);
      await chrome.runtime.sendMessage({ type: 'campanha_resposta', telefone: alvo.telefone, usuario_id: usuarioId });
    } catch (e) { /* próxima varredura reconcilia */ }
  });

  function pedirChecarInbound(chatId) {
    return new Promise((resolve) => {
      const reqId = 'ci' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      let pronto = false;
      function onMsg(ev) {
        if (ev.source !== window) return;
        const d = ev.data;
        if (!d || d.source !== 'JOB_EXT_RESP' || d.reqId !== reqId) return;
        pronto = true; window.removeEventListener('message', onMsg); resolve(!!(d && d.inbound));
      }
      window.addEventListener('message', onMsg);
      window.postMessage({ source: 'JOB_EXT_REQ', tipo: 'checar_inbound', reqId, chatId }, '*');
      setTimeout(() => { if (!pronto) { window.removeEventListener('message', onMsg); resolve(false); } }, 8000);
    });
  }

  async function checarCampanhaAguardando() {
    if (_contextoMorto) return;
    const { extKey, usuarioId } = await _safeStorageGet(['extKey', 'usuarioId']);
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
    // Dedup por chat_id também aqui (defesa em profundidade — o servidor já
    // deduplica, mas um backend velho não pode duplicar o aviso; chat_id
    // normaliza '5519...' e '19...' pro mesmo chat).
    const _chatsVistos = new Set();
    _campExcluir = _campExcluir.filter((e) => {
      if (_chatsVistos.has(e.chat_id)) return false;
      _chatsVistos.add(e.chat_id); return true;
    });
    // O "×" vale de verdade: quem dispensou o aviso não o vê de novo a cada
    // varredura de 60s (era a "insistência" que o Guilherme reclamou). Guarda a
    // assinatura da lista dispensada; só reaparece se surgir contato NOVO.
    const _assin = _campExcluir.map((e) => e.telefone).sort().join(',');
    const { limpezaDispensada } = await _safeStorageGet(['limpezaDispensada']);
    if (_campExcluir.length && _assin === limpezaDispensada) {
      const bx = document.getElementById('job-aviso-limpeza'); if (bx) bx.remove();
    } else {
      mostrarAvisoLimpeza(_campExcluir, _assin);
    }
    // POLLING de resposta (fallback do evento): lê cada chat vigiado e, se o contato
    // já respondeu, reporta ao JOB. Cap por rodada pra não pesar. Confiável mesmo
    // quando o evento chat.new_message não dispara.
    let checados = 0;
    for (const [chatId, alvo] of _campWatch) {
      if (checados >= 15) break;
      checados++;
      try {
        const respondeu = await pedirChecarInbound(chatId);
        if (respondeu) {
          _campWatch.delete(chatId);
          await chrome.runtime.sendMessage({ type: 'campanha_resposta', telefone: alvo.telefone, usuario_id: usuarioId });
        }
      } catch (e) { /* próxima rodada tenta de novo */ }
    }
  }
  setTimeout(checarCampanhaAguardando, 8000);
  _registrarLoop(setInterval(checarCampanhaAguardando, 60000));

  // ── Bate ponto pro painel de aptidão do disparo: versão, número do WhatsApp
  //    logado e se a wa-js está de pé. O admin vê na aba Disparos quem está apto. ──
  async function baterPontoDisparo() {
    if (_contextoMorto) return;
    const { extKey, usuarioId } = await _safeStorageGet(['extKey', 'usuarioId']);
    if (!extKey || !usuarioId) return;
    let versao = ''; try { versao = chrome.runtime.getManifest().version; } catch (e) {}
    let numero = ''; try { numero = await pedirMeuNumero(); } catch (e) {}
    try {
      await chrome.runtime.sendMessage({ type: 'presenca', usuario_id: usuarioId, versao, numero, wpp_ok: !!numero });
    } catch (e) { /* próxima batida tenta de novo */ }
  }
  setTimeout(baterPontoDisparo, 6000);
  _registrarLoop(setInterval(baterPontoDisparo, 60000));

  // Inbox de leads novos: busca a cada 45s (mesmo com a seção fechada, pra o
  // badge do trilho avisar) + tick visual do tempo.
  setTimeout(buscarInbox, 9000);
  _registrarLoop(setInterval(buscarInbox, 45000));
  ligarLoopInbox();

  // ── VARREDURA DO CATALOGO, UM PEDACO POR VEZ ─────────────────────────────
  //
  //  Varrer todas as cidades de uma vez seriam centenas de consultas seguidas
  //  ao Painel — rapido, e exatamente o pico que nao se parece com nenhum
  //  corretor trabalhando. Entao vira rotina de fundo: de tempos em tempos
  //  pergunta ao JOB se alguma cidade venceu o intervalo e faz UMA.
  //
  //  Mora aqui, no WhatsApp, porque esta e a aba que fica aberta o dia todo.
  //  Agendador no servidor nao resolveria: quem fala com o Painel e o
  //  navegador do corretor, nao o Railway.
  //
  //  Regras de convivencia, e elas sao o ponto:
  //   · so roda se a aba do Painel estiver aberta — nunca abre aba sozinha;
  //   · uma cidade por rodada, nunca duas;
  //   · intervalo longo e irregular entre rodadas;
  //   · datar mesmo quando falha, senao um alvo problematico bateria na porta
  //     deles sem parar, todo ciclo, pra sempre.
  const _VARRE_MIN = 22 * 60 * 1000;      // ~22 min entre tentativas
  let _varreOcupada = false;

  async function varreduraDeFundo() {
    if (_varreOcupada) return;
    _varreOcupada = true;
    try {
      const alvo = await chrome.runtime.sendMessage({ type: 'catalogo_proximo' });
      if (!alvo || !alvo.ok || !alvo.alvo) return;      // nada vencido: fica quieto
      const a = alvo.alvo;
      const vidas = (alvo.faixas || []).map((f) => ({ faixa: f, quantidade: 1 }));
      const r = await chrome.runtime.sendMessage({
        type: 'cotador_catalogo',
        pedido: { cidade: a.cidade, modalidade: a.modalidade, vidas },
      });
      if (!r || !r.ok) {
        // Painel fechado nao e erro do alvo: nao data, so tenta na proxima.
        if (r && (r.motivo === 'painel_fechado' || r.motivo === 'painel_precisa_recarregar')) return;
        await chrome.runtime.sendMessage({ type: 'catalogo_gravar',
          dados: { cidade: a.cidade, modalidade: a.modalidade,
                   erro: (r && r.motivo) || 'sem_resposta' } });
        return;
      }
      await chrome.runtime.sendMessage({ type: 'catalogo_gravar', dados: r.dados });
    } catch (e) {
      /* varredura de fundo nunca pode atrapalhar o consultor */
    } finally {
      _varreOcupada = false;
    }
  }

  // Primeira tentativa bem depois de abrir: os primeiros minutos do WhatsApp
  // ja sao disputados, e isto nao tem pressa nenhuma.
  setTimeout(varreduraDeFundo, 4 * 60 * 1000);
  _registrarLoop(setInterval(() => {
    // Intervalo irregular: um relogio certinho de 22 em 22 minutos, todo dia,
    // e um padrao. Somar um tanto aleatorio nao custa nada e tira o padrao.
    if (Math.random() < 0.75) varreduraDeFundo();
  }, _VARRE_MIN));

  // Formata o telefone (dígitos) num rótulo BR legível pro aviso de limpeza.
  function fmtTelLimpezaBr(t) {
    const d = String(t || '').replace(/\D/g, '');
    if (d.length === 13 && d.startsWith('55')) return '+55 (' + d.slice(2, 4) + ') ' + d.slice(4, 9) + '-' + d.slice(9);
    if (d.length === 12 && d.startsWith('55')) return '+55 (' + d.slice(2, 4) + ') ' + d.slice(4, 8) + '-' + d.slice(8);
    if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
    if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
    return t || '';
  }

  // Aviso de LIMPEZA pós-campanha. Antes só dizia "2 conversa(s)" — perigoso pra
  // uma ação IRREVERSÍVEL. Agora lista QUEM (nome + telefone) e explica o motivo
  // (contatos que você disparou e não responderam no prazo).
  function mostrarAvisoLimpeza(lista, assinatura) {
    const itens = Array.isArray(lista) ? lista : [];
    const qtd = itens.length;
    if (!qtd) { const b0 = document.getElementById('job-aviso-limpeza'); if (b0) b0.remove(); return; }
    const linhas = itens.slice(0, 6).map((e) => {
      const nome = (e.nome || '').trim();
      const tel = fmtTelLimpezaBr(e.telefone || '');
      return '<div style="font-size:12px;opacity:.92;padding:2px 0;">' +
        (nome ? '<b>' + esc(nome) + '</b> · ' : '') + esc(tel) + '</div>';
    }).join('');
    const mais = qtd > 6 ? '<div style="font-size:11.5px;opacity:.7;padding-top:2px;">+ ' + (qtd - 6) + ' outro(s)</div>' : '';
    const corpo =
      '<div class="job-aviso-versao-topo"><b>Limpeza pós-campanha</b>' +
        '<button class="job-aviso-versao-x" title="Depois">×</button></div>' +
      '<div class="job-aviso-versao-corpo">' +
        'Estes <b>' + qtd + '</b> contato(s) que você disparou na campanha <b>não responderam</b> no prazo. ' +
        'Quer apagar essas conversas do seu WhatsApp pra limpar a lista?' +
        '<div style="margin:8px 0;max-height:150px;overflow-y:auto;">' + linhas + mais + '</div>' +
        '<div style="margin-top:6px;"><button class="job-analisar-btn" id="job-limpar-btn">Apagar conversas</button></div>' +
        '<div class="job-aviso-versao-nota">Só apaga quem não respondeu. Ação irreversível no WhatsApp.</div>' +
      '</div>';
    let box = document.getElementById('job-aviso-limpeza');
    if (!box) { box = document.createElement('div'); box.id = 'job-aviso-limpeza'; document.body.appendChild(box); }
    box.innerHTML = corpo;
    box.querySelector('.job-aviso-versao-x').addEventListener('click', () => {
      box.remove();
      // Dispensa PERSISTENTE (vale entre F5s): esta lista não volta a incomodar;
      // só reaparece se um contato NOVO entrar na limpeza (assinatura muda).
      if (assinatura) { try { chrome.storage.local.set({ limpezaDispensada: assinatura }); } catch (e) { /* sem storage */ } }
    });
    box.querySelector('#job-limpar-btn').addEventListener('click', limparSemResposta);
  }

  async function limparSemResposta() {
    if (!_campExcluir.length) return;
    if (!confirm('Apagar ' + _campExcluir.length + ' conversa(s) sem resposta do seu WhatsApp? Isso não tem desfazer.')) return;
    const { usuarioId } = await _safeStorageGet(['usuarioId']);
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
      if (mud.tema) aplicarTema(mud.tema.newValue);
    });
  } catch (e) { /* sem storage, sem cache pra limpar */ }

  // ── Tema claro/escuro (escolhido no popup) — aplica no load e ao vivo se
  //    trocar sem precisar de F5. ──
  function aplicarTema(tema) {
    document.body.setAttribute('data-job-tema', tema === 'claro' ? 'claro' : 'escuro');
  }
  chrome.storage.local.get(['tema']).then((c) => aplicarTema(c && c.tema)).catch(() => {});

  } // fim de _bootJobSerenus
})();
