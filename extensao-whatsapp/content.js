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

  // Uma geracao nova so pode assumir depois de a anterior entregar tudo que
  // deixou pendurado no document/window. Recarregar a extensao invalida a API
  // chrome da geracao velha, mas nao desconecta observer nem remove listener.
  if (window.__JOB_CONTENT && window.__JOB_CONTENT_VIVO && window.__JOB_CONTENT_VIVO()) return;
  try {
    if (typeof window.__JOB_CONTENT_LIMPAR === 'function') window.__JOB_CONTENT_LIMPAR();
  } catch (e) {}
  const _limpezasGeracao = [];
  let _geracaoLimpa = false;
  function _aoLimpar(fn) { _limpezasGeracao.push(fn); return fn; }
  function _ouvir(alvo, tipo, fn, opcoes) {
    alvo.addEventListener(tipo, fn, opcoes);
    _aoLimpar(() => { try { alvo.removeEventListener(tipo, fn, opcoes); } catch (e) {} });
    return fn;
  }
  function _observar(obs) {
    _aoLimpar(() => { try { obs.disconnect(); } catch (e) {} });
    return obs;
  }
  function _escutarChrome(evento, fn) {
    evento.addListener(fn);
    _aoLimpar(() => { try { evento.removeListener(fn); } catch (e) {} });
    return fn;
  }
  function _limparGeracao() {
    if (_geracaoLimpa) return;
    _geracaoLimpa = true;
    while (_limpezasGeracao.length) {
      try { _limpezasGeracao.pop()(); } catch (e) {}
    }
    try { window.__jobSerenusCarregado = false; } catch (e) {}
  }
  window.__JOB_CONTENT = 1;
  window.__JOB_CONTENT_VIVO = function () {
    try { return !!(chrome && chrome.runtime && chrome.runtime.id); }
    catch (e) { return false; }
  };
  window.__JOB_CONTENT_LIMPAR = _limparGeracao;
  // Primeira atualizacao vinda de uma versao que ainda nao tinha o protocolo
  // acima: o contexto morreu, mas a flag antiga ficou no window.
  window.__jobSerenusCarregado = false;

  // ── A PONTE DA PÁGINA É INJETADA POR AQUI, NÃO PELO MANIFEST ──────────────
  //
  // Pelo manifest, o mundo MAIN só é injetado quando a página carrega. Se a
  // ponte não subir, a barra abre e nada funciona, e a única saída é F5 — foi
  // exatamente o que aconteceu e custou horas.
  //
  // Injetando daqui, a gente injeta DE NOVO quando perceber que faltou. O
  // injetor decide o que carregar (a wa-js só se ela não estiver lá) e em que
  // ordem.
  let _ponteConfirmada = false;
  let _tentativasPonte = 0;

  function _injetarPonteNaPagina() {
    try {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('injetor.js');
      s.dataset.wajs = chrome.runtime.getURL('wa-js.vendor.js');
      s.dataset.ponte = chrome.runtime.getURL('wpp-bridge.js');
      s.onload = () => s.remove();
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { /* extensão recarregada no meio: a próxima rodada tenta */ }
  }

  _ouvir(window, 'message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== 'JOB_INJETOR') return;
    if (d.tipo === 'pronto' && d.temPonte) _ponteConfirmada = true;
  });

  // Vigia barato: a cada 5s, enquanto a ponte não confirmar, tenta de novo.
  // Para depois de 12 tentativas (1 minuto) pra não ficar batendo pra sempre
  // numa aba onde o WhatsApp nem terminou de abrir.
  let _vigia = null;
  function _iniciarPonte() {
    if (_vigia) return;
    _injetarPonteNaPagina();
    _vigia = setInterval(() => {
      if (_ponteConfirmada || ++_tentativasPonte > 12) {
        clearInterval(_vigia); _vigia = null; return;
      }
      _injetarPonteNaPagina();
    }, 5000);
  }
  _aoLimpar(() => { if (_vigia) clearInterval(_vigia); });
  // TRAVA DE INJECAO DUPLA.
  //
  // Quando a extensao e recarregada, o service worker reinjeta os scripts nas
  // abas que ja estavam abertas, pra ninguem precisar dar F5 na mao. Sem esta
  // trava, uma aba que ainda tem o script vivo receberia um segundo — e no
  // mundo MAIN isso embrulharia o window.fetch duas vezes.
  //
  // O flag mora no `window` de CADA MUNDO. No MAIN ele sobrevive a recarga da
  // extensao (e o script de la continua funcionando, porque nao usa API da
  // extensao); no ISOLADO ele nasce limpo, que e justamente onde a reinjecao
  // precisa acontecer.
  // No mundo ISOLADO a trava pergunta se o script anterior ainda FALA com a
  // extensao. Depois de uma recarga, o contexto antigo pode continuar existindo
  // — mas morto: qualquer chamada a chrome.* estoura. Uma trava booleana pura
  // bloquearia justamente a reinjecao que conserta, e o conserto viraria
  // enfeite silencioso.
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

  // A extensao desligada no popup nao injeta a biblioteca pesada da ponte nem
  // acorda seus observadores. Antes, a ponte era iniciada antes de ler o toggle:
  // a interface sumia, mas o trabalho caro continuava invisivel na pagina.
  _iniciarPonte();

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

  // ── Pastas (Funis/Mensagens) começam FECHADAS em cada abertura da tela.
  //    Com centenas de itens, lembrar uma pasta aberta transforma a volta à
  //    biblioteca numa parede de conteúdo. Quem quiser consulta, abre ali.
  let _pastasAbertas = new Set();
  function _pastaAberta(key) { return _pastasAbertas.has(key); }
  _ouvir(document, 'toggle', (e) => {
    const el = e.target;
    if (!el || !el.classList || !(el.classList.contains('job-pasta') || el.classList.contains('job-subpasta'))) return;
    const key = el.dataset.pastaKey;
    if (!key) return;
    if (el.open) _pastasAbertas.add(key); else _pastasAbertas.delete(key);
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
  _ouvir(window, 'error', (e) => {
    if (e && _ehContextoInvalidado(e.message || (e.error && e.error.message))) { _marcarContextoMorto(); return; }
    if (e && e.filename && /content\.js|wpp-bridge\.js/.test(e.filename)) {
      _reportarErro(e.message, e.error && e.error.stack);
    }
  });
  _ouvir(window, 'unhandledrejection', (e) => {
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
  function _soComAbaVisivel(fn) {
    return function () {
      if (document.hidden || _contextoMorto) return;
      return fn.apply(this, arguments);
    };
  }
  // Diferente de uma pausa curta dentro de uma ação em andamento, estes são
  // agendamentos de fundo. Eles precisam pertencer à geração atual: recarregar
  // a extensão não pode deixar uma geração morta acordando minutos depois para
  // consultar API, ler conversas ou iniciar outra rotina.
  const _idsTimeouts = new Set();
  function _registrarTimeout(fn, ms) {
    const id = setTimeout(() => {
      _idsTimeouts.delete(id);
      fn();
    }, ms);
    _idsTimeouts.add(id);
    return id;
  }

  // ── TETO DE MEMÓRIA DOS CACHES ────────────────────────────────────────────
  //
  // POR QUE EXISTE: a aba do WhatsApp fica aberta o dia inteiro, e vários Maps
  // aqui só cresciam. O pior deles guardava o resultado COMPLETO de cada
  // análise (leitura de IA de imagens e PDFs, texto extraído de documento,
  // transcrições) e nunca soltava no caminho de sucesso. Isso não derruba a
  // aba em rajada — vai empurrando pro teto do V8 ao longo das horas, que é
  // o "Aw, Snap!" aparecendo no meio da tarde sem causa aparente.
  //
  // Map em JS mantém ORDEM DE INSERÇÃO. Então o mais antigo é o primeiro do
  // iterador — não preciso guardar timestamp pra saber quem sai.
  //
  // NADA AQUI É FONTE DE VERDADE: análise perdida o painel rebusca no servidor,
  // transcrição perdida volta ao botão "Transcrever" (e o servidor tem cache,
  // então não paga de novo), documento perdido volta ao botão "Ler documento".
  // Por isso dá pra despejar sem quebrar tela — o que NÃO dá é despejar
  // trabalho em andamento, e é isso que o `protegido` abaixo garante.
  function _capMap(mapa, teto, protegido) {
    if (!mapa || mapa.size <= teto) return 0;
    let saiu = 0;
    for (const [k, v] of mapa) {
      // `mapa.size` puro: o delete abaixo JÁ reduz o size. Eu tinha escrito
      // `mapa.size - saiu` aqui e isso descontava duas vezes — parava a 55 com
      // teto de 50, deixando o Map sempre acima do limite. Pego no teste.
      if (mapa.size <= teto) break;
      if (protegido && protegido(v, k)) continue;   // em andamento: fica
      mapa.delete(k);                               // apagar durante o for de Map é seguro
      saiu++;
    }
    return saiu;
  }

  // Set não tem o que priorizar (todo item pesa igual e nenhum é resultado de
  // trabalho), então limpar inteiro é mais simples e mais barato que despejar
  // um a um. O custo de esvaziar é reprocessar no máximo um item repetido.
  function _capSet(conjunto, teto) {
    if (conjunto && conjunto.size > teto) { conjunto.clear(); return true; }
    return false;
  }

  const _TETO_ANALISES = 50;
  const _TETO_DOC = 100;
  const _TETO_TR = 100;
  const _TETO_SETS = 200;

  // ── SHADOW DOM NAS BOLHAS DA CONVERSA ─────────────────────────────────────
  //
  // Os blocos que injetamos DENTRO das bolhas (.job-doc-slot e .job-tr-slot)
  // passam a viver num Shadow Root. Dois ganhos concretos:
  //
  // 1. CSS não vaza nos dois sentidos. O content.css tem 124 KB no escopo
  //    global do WhatsApp, com classes genéricas (.faixa-bom, .faixa-medio…)
  //    que podem colidir com as deles. Dentro do shadow, nada disso escapa —
  //    e o CSS deles também para de mexer no nosso.
  //
  // 2. Nossas próprias mutações somem do radar do MutationObserver. Hoje
  //    existe um bloco defensivo inteiro (o seletor _MEU com closest) só pra
  //    filtrar as escritas que nós mesmos causamos dentro do #main — o
  //    comentário lá diz "NAO ESCUTAR A SI MESMA. Era isto que travava o
  //    WhatsApp". Mutação dentro de shadow root não atravessa a fronteira:
  //    o observer nem fica sabendo. Deixa de precisar filtrar.
  //
  // O QUE ISSO **NÃO** RESOLVE, e é importante não esperar: o React continua
  // podendo remover o HOSPEDEIRO, porque ele segue sendo um filho estranho
  // dentro de uma árvore que o React gerencia. O "botão some ao rolar a
  // conversa" é isso, e quem resolve continua sendo a reinjeção (_jobPronta +
  // observer), não o Shadow DOM.
  //
  // mode:'open' de propósito: permite reencontrar a raiz por host.shadowRoot,
  // sem precisar de um Map lateral guardando host→raiz — que num código que
  // já está brigando com memória seria mais uma estrutura pra vazar. O
  // isolamento de CSS e de mutação é idêntico nos dois modos; 'closed' só
  // esconderia de scripts externos, e o WhatsApp não tem motivo pra procurar.
  let _folhaJob = null;
  const _raizesSemFolha = [];

  (async function _carregarFolhaJob() {
    try {
      if (typeof CSSStyleSheet === 'undefined' || !('replace' in CSSStyleSheet.prototype)) return;
      const txt = await (await fetch(chrome.runtime.getURL('content.css'))).text();
      const folha = new CSSStyleSheet();
      await folha.replace(txt);
      _folhaJob = folha;
      // UMA folha só, compartilhada por referência entre todas as raízes —
      // não é uma cópia de 124 KB por bolha.
      for (const r of _raizesSemFolha) {
        try { r.adoptedStyleSheets = [folha]; } catch (e) { /* raiz já morreu */ }
      }
      _raizesSemFolha.length = 0;
    } catch (e) { /* fica o <link> de reserva */ }
  })();

  function _jobRaiz(host) {
    if (!host || !host.attachShadow) return host;      // sem suporte: comportamento antigo
    // Conteudo em Shadow DOM nao conta para o seletor CSS `:empty` aplicado ao
    // hospedeiro. Marca explicitamente que este slot ganhou interface; sem a
    // marca, o proprio CSS reduz o botao a zero mesmo depois de renderizado.
    try { host.classList.add('job-slot-com-conteudo'); } catch (e) {}
    if (host.shadowRoot) return host.shadowRoot;       // já tem: reaproveita
    let raiz;
    try { raiz = host.attachShadow({ mode: 'open' }); }
    catch (e) { return host; }                          // não pôde: não quebra a bolha
    if (_folhaJob) {
      try { raiz.adoptedStyleSheets = [_folhaJob]; } catch (e) { /* nada */ }
    } else {
      // A folha ainda está carregando. O <link> segura o estilo enquanto isso
      // (o navegador busca o arquivo uma vez e reusa), e a raiz entra na fila
      // pra receber a folha compartilhada assim que ela chegar.
      try {
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = chrome.runtime.getURL('content.css');
        raiz.appendChild(l);
      } catch (e) { /* nada */ }
      _raizesSemFolha.push(raiz);
    }
    return raiz;
  }
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
    _idsTimeouts.forEach((id) => { try { clearTimeout(id); } catch (e) {} });
    _idsTimeouts.clear();
    _limparGeracao();
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

  // ══ CACHE DO TELEFONE RESOLVIDO ═══════════════════════════════════════
  //
  // Resolver o telefone de uma conversa @lid é a chamada mais lenta da
  // extensão: ela pergunta ao servidor do WhatsApp e às vezes leva segundos.
  // E era refeita TODA vez que a Análise abria, mesmo na mesma conversa —
  // abrir, fechar e abrir de novo pagava o preço três vezes.
  //
  // A chave é o NOME do cabeçalho, que é estável; o número raspado do DOM
  // oscila e seria chave ruim. Trocou de conversa, o cache não serve mais.
  var _telCache = { chave: '', tel: '', ts: 0 };
  var _TEL_CACHE_MS = 5 * 60 * 1000;

  function pedirTelefoneWpp() {
    const chave = nomeDoContato() || '';
    if (chave && _telCache.chave === chave && _telCache.tel &&
        (Date.now() - _telCache.ts) < _TEL_CACHE_MS) {
      return Promise.resolve(_telCache.tel);
    }
    return _pedirTelefoneWppReal().then((tel) => {
      if (chave && tel) _telCache = { chave: chave, tel: tel, ts: Date.now() };
      return tel;
    });
  }

  function _pedirTelefoneWppReal() {
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
    _escutarChrome(chrome.storage.onChanged, (mud, area) => {
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
    _escutarChrome(chrome.storage.onChanged, (changes, area) => {
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
  _ouvir(window, 'resize', () => {
    try { aplicarOffsetVizinhos(); } catch (e) {}
    // A barra do trilho é medida em pixels: se o trilho muda de altura (janela
    // redimensionada, item Dev entrando ou saindo), a medida velha aponta pro
    // lugar errado.
    try { _trilhoMarcaSincronizar(); } catch (e) {}
  });

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
  _ouvir(window, 'resize', () => {
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

  const _ICO_ANALISE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 20.2h15"/><path d="M4.5 20.2V4.2"/><rect x="8" y="13.4" width="3.1" height="6.8" rx="1.2"/><rect x="13.2" y="8.6" width="3.1" height="11.6" rx="1.2"/><rect x="18.4" y="11" width="3.1" height="9.2" rx="1.2"/></svg>';
  const _ICO_MENSAGENS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20.4 11.8c0 3.9-3.76 7.05-8.4 7.05-.95 0-1.87-.13-2.72-.38L4.6 20.2l1.42-3.9A6.83 6.83 0 0 1 3.6 11.8C3.6 7.9 7.36 4.75 12 4.75s8.4 3.15 8.4 7.05Z"/><path d="M8.7 11.7h.02M11.99 11.7h.02M15.28 11.7h.02"/></svg>';
  const _ICO_FUNIS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3.4 4.9h17.2a.6.6 0 0 1 .46.99l-6.2 7.36v5.4a.6.6 0 0 1-.33.54l-3.4 1.7a.6.6 0 0 1-.87-.54v-7.1L3.14 5.89a.6.6 0 0 1 .46-.99Z"/></svg>';
  const _ICO_INBOX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M6.6 4.8h10.8a2 2 0 0 1 1.83 1.2l2.27 5.1v6.1a2 2 0 0 1-2 2H4.5a2 2 0 0 1-2-2v-6.1l2.27-5.1a2 2 0 0 1 1.83-1.2Z"/><path d="M2.5 12.6h4.4l1.5 2.5h7.2l1.5-2.5h4.4"/></svg>';
  const _ICO_CNPJ = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.8 20.6h18.4"/><path d="M5.4 20.6V5.9a1 1 0 0 1 .66-.94l6.2-2.2a1 1 0 0 1 1.34.94v16.9"/><path d="M13.6 9.6l4.36 1.55a1 1 0 0 1 .64.94v8.51"/><path d="M8.6 8.3v.02M8.6 11.6v.02M8.6 14.9v.02"/></svg>';
  const _ICO_NOTA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M19.4 12.6v6.2a2 2 0 0 1-2 2H6.1a2 2 0 0 1-2-2V6.9a2 2 0 0 1 2-2h6.1"/><path d="M17.5 3.3a1.9 1.9 0 0 1 2.7 2.7l-7.6 7.6-3.4.7.7-3.4 7.6-7.6Z"/></svg>';
  const _ICO_COTACAO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12.9 2.9H19a2 2 0 0 1 2 2v6.1a2 2 0 0 1-.59 1.42l-8 8a2 2 0 0 1-2.83 0l-6.1-6.1a2 2 0 0 1 0-2.83l8-8A2 2 0 0 1 12.9 2.9Z"/><path d="M16.6 7.4v.02"/></svg>';
  const _ICO_CRM = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.2" cy="7.9" r="3.7"/><path d="M3.6 20.4a6.6 6.6 0 0 1 13.2 0"/><path d="M19.6 6.4v5.4M16.9 9.1h5.4"/></svg>';
  // OS OUTROS TRES QUE TAMBEM NAO EXISTIAM.
  //
  // Achei o `_ICO_DOC` pelo console e consertei so ele — sem procurar os
  // vizinhos. Uma hora depois o mesmo erro voltou com `_ICO_MAIS`, e uma
  // auditoria de trinta segundos mostrou que faltavam TRES. Consertar o
  // sintoma que apareceu, em vez da familia inteira, custou uma ida e volta
  // e mais uma hora do Guilherme.
  //
  // Agora `scripts/checar_extensao.sh` recusa o pacote quando um `_ICO_*` e
  // usado sem existir — a busca que eu deveria ter feito de primeira roda
  // sozinha antes de todo commit.
  const _ICO_MAIS = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" ' +
    'stroke="currentColor" stroke-width="2.2" stroke-linecap="round">' +
    '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
  const _ICO_CHECK = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" ' +
    'stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<polyline points="20 6 9 17 4 12"/></svg>';
  const _ICO_ABRIR = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>' +
    '<polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';

  // O ICONE DO "LER DOCUMENTO" — que nao existia.
  //
  // `_ICO_DOC` era usado em QUATRO lugares e nao estava definido em lugar
  // nenhum. Sumiu num recorte, e o efeito foi este: `docRenderSlot` estourava
  // com ReferenceError toda vez que tentava desenhar o botao. O bloco era
  // criado, ficava VAZIO, e a regra que esconde bloco vazio o tornava
  // invisivel. Tres blocos na tela, nenhum botao, nenhum sintoma.
  //
  // Foi a causa raiz do dia inteiro de 10/08/2026 — e as duas outras coisas
  // que eu "consertei" antes disso eram sintomas dela.
  const _ICO_DOC = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" ' +
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>' +
    '<polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/>' +
    '<line x1="16" y1="17" x2="8" y2="17"/></svg>';

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
      mais: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
      voltar: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
      cima: '<polyline points="18 15 12 9 6 15"/>',
      baixo: '<polyline points="6 9 12 15 18 9"/>',
      lixo: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
      lapis: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4z"/>',
    }[nome] || '';
    const s = px || 14;
    // Mesmo traço dos ícones do trilho: 1.7 em vez de 2. Nos tamanhos que a
    // extensão usa (11 a 16px), traço de 2 fecha os vãos e o desenho vira mancha.
    return '<svg viewBox="0 0 24 24" width="' + s + '" height="' + s + '" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>';
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
      '<button class="job-trilho-item" data-secao="cotacao" title="Cotações deste cliente: ver, copiar o link e mandar na conversa">' +
        '<span class="job-trilho-item-icone">' + _ICO_COTACAO + '</span>' +
        '<span class="job-trilho-item-label">Cotações</span>' +
        '<span class="job-trilho-ponto" data-ponto="cotacao" hidden></span>' +
      '</button>' +
      '<button class="job-trilho-item" data-secao="notas" title="Notas do lead">' +
        '<span class="job-trilho-item-icone">' + _ICO_NOTA + '</span>' +
        '<span class="job-trilho-item-label">Notas</span>' +
        '<span class="job-trilho-ponto" data-ponto="notas" hidden></span>' +
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
        '<span class="job-trilho-ponto" data-ponto="ficha" hidden></span>' +
      '</button>' +
      '<div class="job-trilho-rodape">' +
        '<button class="job-trilho-mini" id="job-trilho-config-btn" title="Configurações (tema, desligar)">' + _ICO_CONFIG + '</button>' +
      '</div>' +
      '<div class="job-trilho-versao" id="job-trilho-versao" title="Versão instalada"></div>' +
      // UMA barra pro trilho inteiro, que anda até o item ativo (ver o CSS).
      '<div class="job-trilho-marca" id="job-trilho-marca"></div>';
    trilho.querySelectorAll('.job-trilho-item').forEach((item) => {
      // A barra sai na hora do CLIQUE, não quando a seção termina de carregar.
      // Esperar a resposta do servidor pra mover o indicador é o que fazia o
      // trilho parecer travado em conexão lenta: a pessoa clicava e nada
      // acontecia por meio segundo.
      item.addEventListener('pointerdown', () => {
        if (item.dataset.secao && _secaoAtiva !== item.dataset.secao) _trilhoMarcaPara(item);
      });
      item.addEventListener('click', () => {
        if (item.dataset.acao === 'crm') { _abrirLeadNoCrm(item); return; }  // legado: nenhum botão usa mais
        const secao = item.dataset.secao;
        if (_secaoAtiva === secao) fecharSecao();
        else abrirSecao(secao);
      });
    });
    document.body.appendChild(trilho);
    // O trilho pode ganhar/perder o item Dev depois de montado; a barra precisa
    // remedir quando isso acontecer.
    try {
      const obsTamanho = _observar(new ResizeObserver(() => {
        try { _trilhoMarcaSincronizar(); } catch (e) {}
      }));
      obsTamanho.observe(trilho);
    } catch (e) { /* navegador sem ResizeObserver: o resize da janela cobre */ }
    // A fonte da marca carrega depois do primeiro desenho e muda a altura dos
    // itens: quem mediu antes fica com a pílula em cima do item errado. A
    // bancada pegou isso; aqui é barato garantir.
    try {
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(() => { try { _trilhoMarcaSincronizar(); } catch (e) {} });
      }
    } catch (e) { /* sem Font Loading API: o ResizeObserver cobre */ }
    document.getElementById('job-trilho-config-btn').addEventListener('click', (e) => {
      // A engrenagem abre a SEÇÃO, não mais o balãozinho. O balão cabia três
      // linhas e a configuração cresceu — entrar no sistema não cabe num
      // popover de 200px.
      e.stopPropagation();
      if (_secaoAtiva === 'config') fecharSecao();
      else abrirSecao('config');
    });
    aplicarClassesHtml();
    atualizarSeloVersao();
  }

  const _ICO_CONFIG = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.1"/><path d="M19.2 14.6a1.5 1.5 0 0 0 .3 1.65l.05.06a1.8 1.8 0 1 1-2.55 2.55l-.06-.05a1.5 1.5 0 0 0-1.65-.3 1.5 1.5 0 0 0-.9 1.37v.17a1.8 1.8 0 1 1-3.6 0v-.09a1.5 1.5 0 0 0-.98-1.37 1.5 1.5 0 0 0-1.65.3l-.06.05a1.8 1.8 0 1 1-2.55-2.55l.05-.06a1.5 1.5 0 0 0 .3-1.65 1.5 1.5 0 0 0-1.37-.9H4.3a1.8 1.8 0 1 1 0-3.6h.09a1.5 1.5 0 0 0 1.37-.98 1.5 1.5 0 0 0-.3-1.65l-.05-.06a1.8 1.8 0 1 1 2.55-2.55l.06.05a1.5 1.5 0 0 0 1.65.3h.07a1.5 1.5 0 0 0 .9-1.37V4.3a1.8 1.8 0 1 1 3.6 0v.09a1.5 1.5 0 0 0 .9 1.37 1.5 1.5 0 0 0 1.65-.3l.06-.05a1.8 1.8 0 1 1 2.55 2.55l-.05.06a1.5 1.5 0 0 0-.3 1.65v.07a1.5 1.5 0 0 0 1.37.9h.17a1.8 1.8 0 1 1 0 3.6h-.09a1.5 1.5 0 0 0-1.37.9Z"/></svg>';

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
      if (!await _confirmar({
        titulo: 'Desligar o JOB nesta aba?',
        texto: 'O painel some deste WhatsApp Web. Pra ligar de novo, use o ícone do JOB na barra do Chrome e dê F5.',
        ok: 'Desligar', perigo: true })) return;
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
    _trilhoMarcaPara(null);
    aplicarClassesHtml();
  }

  // ══ A BARRA DO TRILHO ═════════════════════════════════════════════════
  //
  // Ela mede o item e escreve a posição/altura em variáveis CSS; a transição
  // mora no CSS. Como o alvo é sempre uma posição absoluta (e não um
  // "de-para"), clicar noutra seção no meio do movimento só muda o destino —
  // a barra continua de onde estiver, sem recomeçar do zero e sem pulo.
  function _trilhoMarcaPara(item) {
    const m = document.getElementById('job-trilho-marca');
    const trilho = document.getElementById('job-trilho');
    if (!m || !trilho) return;
    if (!item) { m.classList.remove('on'); return; }
    const rt = trilho.getBoundingClientRect();
    const ri = item.getBoundingClientRect();
    // A marca AGORA É a pílula do item: mesma posição e mesma altura, sem
    // folga. O recuo lateral é do CSS (left/right 6px), pra não depender de
    // medida aqui.
    m.style.setProperty('--y', Math.round(ri.top - rt.top + trilho.scrollTop) + 'px');
    m.style.setProperty('--h', Math.max(0, Math.round(ri.height)) + 'px');
    m.classList.add('on');
  }

  function _trilhoMarcaSincronizar() {
    const ativo = document.querySelector('.job-trilho-item-ativo');
    _trilhoMarcaPara(ativo || null);
  }

  // ══ PONTOS POR CONTATO ════════════════════════════════════════════════
  //
  // O ponto diz "esta seção tem coisa DESTE contato" — não é pendência, por
  // isso é ponto e não número. Só acende com dado que a extensão realmente
  // tem: nada de piscar por suposição.
  //
  // LIMITE HONESTO DE HOJE: os caches de cotação e de ficha só se enchem
  // depois que a pessoa abre a seção uma vez naquela conversa. Então o ponto
  // aparece a partir da primeira visita e ao salvar uma cotação, não antes.
  // Pra ele acender já na abertura da conversa falta UMA chamada que devolva
  // o resumo do contato de uma vez — está pedida no contrato do trilho.
  function _trilhoPonto(secao, ligado) {
    const p = document.querySelector('.job-trilho-ponto[data-ponto="' + secao + '"]');
    if (p) p.hidden = !ligado;
  }

  // Trocou de conversa: apaga tudo. Ponto de conversa anterior é pior que
  // ponto nenhum — manda a pessoa procurar o que não está lá.
  function _trilhoPontosLimpar() {
    document.querySelectorAll('.job-trilho-ponto').forEach((p) => { p.hidden = true; });
  }

  function _trilhoPontosDoCache() {
    try {
      const cot = _cotCache && _cotCache.dados;
      if (cot) _trilhoPonto('cotacao', !!(cot.cotacoes && cot.cotacoes.length));
      if (_ficha && _ficha.existe) _trilhoPonto('ficha', true);
      // O ponto de NOTAS não sai daqui: `_ficha` não traz as notas (elas vêm
      // de `notas_listar`, chamada à parte). Ele é aceso lá, quando a lista
      // chega de verdade — acender por suposição é pior que não acender.
    } catch (e) { /* marca do trilho nunca pode derrubar a extensão */ }
  }

  // ESC fecha o painel da extensão (igual os modais do site do JOB). Só age
  // quando o painel está aberto — e aí segura o ESC pra ele não vazar pro
  // WhatsApp Web (que fecharia a conversa). Painel fechado: ESC segue normal.
  // Capture (true) pra pegar antes do handler do WhatsApp.
  _ouvir(document, 'keydown', (e) => {
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


  // ── PORTEIRO: EXTENSÃO LIGADA E SEM CREDENCIAL ───────────────────────────
  //
  // Instalou, não configurou, e nada funciona sem dizer por quê — a pessoa
  // clica em tudo e conclui que a extensão está quebrada. Agora ela diz.
  //
  // A REGRA É "SEM CREDENCIAL NENHUMA", não "sem login". Hoje os oito
  // consultores usam a chave compartilhada e o login ainda nem existe no
  // servidor: barrar por falta de login travaria todo mundo agora. Quem tem a
  // chave passa; quem não tem nada vê a porta.
  async function _semCredencial() {
    const g = await _safeStorageGet(['extToken', 'extKey']);
    if (g.extToken) return false;                  // entrou: está resolvido

    // SEM TOKEN. A chave antiga ainda vale ENQUANTO o servidor não souber
    // fazer login — hoje a rota nem existe em produção (404), e exigir login
    // agora travaria os oito consultores no meio do expediente.
    //
    // Quando a rota subir, esta mesma linha passa a exigir o login sozinha,
    // sem versão nova da extensão. O portão liga no dia em que faz sentido.
    // PORTAO LIBERADO em 08/08, por decisao do Guilherme.
    //
    // Com `true`, a extensao pergunta ao servidor se ele sabe fazer login. Se
    // souber (e sabe: /api/whatsapp/login esta no ar), quem nao tem token ve o
    // portao e precisa entrar — a chave antiga deixa de bastar.
    //
    // A saida continua existindo: o link discreto no portao desliga a extensao
    // naquela maquina. Ninguem fica sem o WhatsApp de trabalho por causa da
    // nossa extensao.
    //
    // Pra reverter: voltar pra `false` e publicar. Leva um minuto.
    const PORTAO_EXIGE_LOGIN = true;

    let servidorTemLogin = false;
    if (PORTAO_EXIGE_LOGIN) {
      try {
        const r = await _safeSendMessage({ type: 'servidor_tem_login' });
        servidorTemLogin = !!(r && r.tem);
      } catch (e) { servidorTemLogin = false; }
    }

    if (servidorTemLogin) return true;             // dá pra entrar: então entre
    return !String(g.extKey || '').trim();         // ainda não dá: a chave serve
  }

  // O PORTÃO. Cobre o WhatsApp inteiro, embaçado, e só sai com login.
  //
  // Aviso dentro do painel não força nada: a pessoa fecha o painel e continua
  // usando o WhatsApp com a extensão instalada e cega. O portão põe a decisão
  // na frente — é o que a WaSpeed faz, e é o que o Guilherme pediu.
  //
  // TEM SAÍDA, e ela não é opcional: quem não tem credencial nenhuma ficaria
  // sem o WhatsApp de trabalho por causa da NOSSA extensão. O link discreto
  // desliga a extensão nesta máquina e devolve a tela.
  function _fecharPortao() {
    const p = document.getElementById('job-portao');
    if (p) p.remove();
    document.documentElement.classList.remove('job-com-portao');
  }

  function _abrirPortao() {
    if (document.getElementById('job-portao')) return;
    const d = document.createElement('div');
    d.id = 'job-portao';
    // O LOGIN INTEIRO NO MEIO DA TELA.
    //
    // Antes o portão só dizia "entre" e mandava pro painel lateral — dois
    // passos pra uma coisa só, e o segundo numa coluna estreita. Estando no
    // meio, com o WhatsApp embaçado atrás, a tela toda pede uma coisa e é
    // óbvio o que fazer.
    d.innerHTML =
      '<div class="job-portao-cartao">' +
        '<div class="job-portao-brilho"></div>' +
        '<div class="job-portao-logo">' + logoJobHTML() + '</div>' +
        '<div class="job-portao-t">Entre no JOB para continuar</div>' +
        '<div class="job-portao-s">A extensão está ligada neste computador e precisa ' +
          'saber quem é você antes de trabalhar na sua conversa.</div>' +
        '<div class="job-portao-campo">' +
          '<label for="job-po-email">Seu e-mail do JOB</label>' +
          '<input id="job-po-email" type="email" autocomplete="username" ' +
            'placeholder="voce@serenuscorretora.com.br">' +
        '</div>' +
        '<div class="job-portao-campo">' +
          '<label for="job-po-senha">Sua senha</label>' +
          '<input id="job-po-senha" type="password" autocomplete="current-password" ' +
            'placeholder="a mesma do site">' +
        '</div>' +
        '<div class="job-portao-campo">' +
          '<label for="job-po-apelido">Nome deste computador</label>' +
          '<input id="job-po-apelido" type="text" placeholder="notebook da Bia, WhatsApp 2…">' +
        '</div>' +
        '<button type="button" class="job-portao-bt" id="job-portao-entrar">Entrar</button>' +
        '<div class="job-portao-msg" id="job-portao-msg"></div>' +
        '<div class="job-portao-p">Você pode entrar em mais de um computador com o mesmo ' +
          'usuário — um por WhatsApp.</div>' +
        '<button type="button" class="job-portao-off" id="job-portao-off">' +
          'Não quero usar o JOB neste computador</button>' +
      '</div>';
    document.body.appendChild(d);
    document.documentElement.classList.add('job-com-portao');

    const msg = (t, cls) => {
      const m = document.getElementById('job-portao-msg');
      if (m) { m.textContent = t; m.className = 'job-portao-msg ' + (cls || ''); }
    };
    const be = document.getElementById('job-portao-entrar');
    const entrar = async () => {
      const email = (document.getElementById('job-po-email').value || '').trim();
      const senha = document.getElementById('job-po-senha').value || '';
      const apelido = (document.getElementById('job-po-apelido').value || '').trim();
      if (!email || !senha) { msg('Preencha e-mail e senha.', 'err'); return; }
      be.disabled = true; be.textContent = 'Entrando…';
      let r = null;
      try { r = await _safeSendMessage({ type: 'login', payload: { email, senha, apelido } }); }
      catch (e) { r = null; }
      be.disabled = false; be.textContent = 'Entrar';
      if (!r || !r.ok) {
        // O MOTIVO APARECE. "Não deu" faz a pessoa tentar a mesma senha três
        // vezes; "senha incorreta" e "usuário inativo" se resolvem de formas
        // diferentes.
        msg(r && r.erro === 'credenciais_invalidas' ? 'E-mail ou senha incorretos.'
          : r && r.erro === 'usuario_inativo' ? 'Este usuário está inativo no JOB.'
          : (r && r.erro) || 'Não consegui entrar agora.', 'err');
        return;
      }
      document.getElementById('job-po-senha').value = '';
      msg('Tudo certo, ' + ((r.usuario && r.usuario.nome) || '') + '.', 'ok');
      setTimeout(_fecharPortao, 600);
    };
    if (be) be.addEventListener('click', entrar);
    // Enter na senha entra — quem digita senha espera isso.
    const isen = document.getElementById('job-po-senha');
    if (isen) isen.addEventListener('keydown', (e) => { if (e.key === 'Enter') entrar(); });
    const iem = document.getElementById('job-po-email');
    if (iem) setTimeout(() => { try { iem.focus(); } catch (e) {} }, 120);

    const bo = document.getElementById('job-portao-off');
    if (bo) bo.addEventListener('click', async () => {
      if (!await _confirmar({
        titulo: 'Desligar o JOB neste computador?',
        texto: 'O painel some do WhatsApp Web. Pra voltar, ligue de novo no ícone do JOB na barra do Chrome.',
        ok: 'Desligar', perigo: true })) return;
      _safeStorageSet({ extensaoAtiva: false });
      _fecharPortao();
      location.reload();
    });
  }

  // "CONECTADO" TEM QUE SER VERDADE DO LADO DE LA, NAO SO DAQUI.
  //
  // O token mora no Chrome; quem o cancela e o servidor. Enquanto ninguem
  // perguntava, os dois discordavam em silencio: o painel mostrava o nome, o
  // selo verde e "Sair deste computador", e o JOB listava zero aparelhos.
  //
  // Nao da pra deixar isso por conta do service worker: no Manifest V3 ele
  // dorme, e uma extensao dormindo nunca descobre que foi desconectada. Este
  // script, nao — ele vive enquanto o WhatsApp estiver aberto. Entao a
  // pergunta sai daqui.
  //
  // Trava de tempo pra nao virar enxurrada: o portao e reconferido a cada
  // mudanca de storage e a cada volta pra aba.
  let _ultimaConfirmacao = 0;
  // 30s, nao 2 minutos. O Guilherme reparou: revogado no site, a extensao
  // seguia aberta no WhatsApp. Dois minutos de "conectado" depois de
  // desconectado sao dois minutos em que a tela mente. Trinta segundos e uma
  // chamada de nada — /ping devolve tres campos — e abrir o painel confere na
  // hora, sem esperar relogio nenhum.
  const _CONFIRMA_CADA_MS = 30000;
  async function _confirmarSessaoNoServidor(forcar) {
    const agora = Date.now();
    if (!forcar && agora - _ultimaConfirmacao < _CONFIRMA_CADA_MS) return;
    _ultimaConfirmacao = agora;
    try {
      const r = await _safeSendMessage({ type: 'sessao_confere' });
      // Só o 401 derruba. Sem resposta, servidor fora do ar ou rede caída não
      // deslogam ninguém — quem não sabe não mexe.
      if (r && r.valida === false && r.tinhaToken) _abrirPortao();
    } catch (e) { /* sem resposta: nao mexe */ }
  }

  async function _conferirPortao() {
    try {
      const g = await _safeStorageGet(['extensaoAtiva']);
      if (g.extensaoAtiva === false) { _fecharPortao(); return; }
      if (await _semCredencial()) { _abrirPortao(); return; }
      _fecharPortao();
      // Tem token guardado: agora confere se ele ainda vale LA.
      _confirmarSessaoNoServidor(false);
    } catch (e) { _fecharPortao(); }
  }

  // Voltar pra aba e o momento certo de reconferir: e quando a pessoa vai
  // usar, e e quando ela descobriria do jeito ruim.
  try {
    _ouvir(document, 'visibilitychange', () => {
      if (document.hidden) { try { _pausarLoopInbox(); } catch (e) {} return; }
      try { ligarLoopInbox(); } catch (e) {}
      _confirmarSessaoNoServidor(false);
      // O que ficou pausado nao precisa disparar tudo no mesmo milissegundo.
      // Atualiza primeiro o que aparece na tela e espalha as consultas leves.
      _registrarTimeout(() => { try { filaVarreduraTick(); } catch (e) {} }, 300);
      _registrarTimeout(() => { try { buscarInbox(); } catch (e) {} }, 1200);
      _registrarTimeout(() => { try { _sinoBuscar(); } catch (e) {} }, 2200);
      _registrarTimeout(() => { try { checarCampanhaAguardando(); } catch (e) {} }, 3500);
    });
  } catch (e) { /* sem isso, ainda confere na abertura */ }

  // O RELOGIO QUE EU PROMETI NO COMENTARIO E NUNCA ESCREVI.
  //
  // `_CONFIRMA_CADA_MS` era so um PISO: ele limitava chamadas que ja iriam
  // acontecer, e nao agendava nenhuma. Com a aba aberta, visivel, e o painel ja
  // aberto desde antes, os tres gatilhos existentes (abertura do painel, volta
  // pra aba, mudanca de storage) nao disparam — e a extensao nunca mais
  // perguntava nada ao servidor. Revogar as 00:54 e a tela seguir dizendo
  // "conectado" as 01:16 era o comportamento exato deste codigo.
  //
  // Foi o defeito que anulou todos os outros consertos da noite: servidor
  // recusando certo, extensao sabendo reagir, e ninguem perguntando.
  //
  // `forcar` verdadeiro porque o proprio intervalo passa a ser a trava de
  // ritmo; com `false` e periodo igual ao piso, viraria corrida de
  // milissegundo. `document.hidden` poupa a rede com a aba em segundo plano —
  // ao voltar, o ouvinte acima ja confere na hora.
  _registrarLoop(setInterval(() => {
    if (!document.hidden) _confirmarSessaoNoServidor(true);
  }, _CONFIRMA_CADA_MS));

  // Reconfere quando a credencial muda (login feito noutra aba, por exemplo).
  try {
    _escutarChrome(chrome.storage.onChanged, (mud) => {
      if (mud.extToken || mud.extKey || mud.extensaoAtiva) _conferirPortao();
    });
  } catch (e) { /* sem storage, o portão só é avaliado na carga */ }


  // ── CONTATO MARCADO COMO PESSOAL: A EXTENSÃO INTEIRA FECHA ───────────────
  //
  // Marcar como pessoal antes só fazia o JOB parar de LER a conversa. O resto
  // continuava aberto: dava pra analisar, cotar, mandar funil e salvar nota
  // pra alguém que já tinha sido declarado "não é cliente". Ou seja, a marca
  // dizia uma coisa e a ferramenta permitia outra.
  //
  // Agora fecha tudo. E o desfazer NÃO fica aqui: quem marcou por engano
  // resolve no JOB, na tela de auditoria. Botão de desfazer ao lado do de
  // marcar transforma uma decisão em dois cliques reversíveis, e aí ela deixa
  // de ser decisão.
  let _bloqCache = { chave: '', bloqueado: false };

  async function _contatoBloqueado() {
    let tel = '';
    try { tel = (await pedirTelefoneWpp()) || telefoneDoContato(); } catch (e) { tel = telefoneDoContato(); }
    let chat = '';
    try { const c = await _pedirPonte('obter_chat_id', {}, 6000); chat = (c && c.chat_id) || ''; }
    catch (e) { chat = ''; }
    const chave = (chat || '') + '|' + (tel || '');
    if (!chat && !tel) return false;          // sem conversa não há o que bloquear
    if (_bloqCache.chave === chave) return _bloqCache.bloqueado;
    let resp = null;
    try { resp = await _safeSendMessage({ type: 'ficha_lead', chat_id: chat, telefone: tel }); }
    catch (e) { resp = null; }
    // Falhou a consulta? NÃO bloqueia. Errar pro lado de bloquear deixaria o
    // consultor sem ferramenta por causa de um soluço de rede, e ele não teria
    // como saber que foi isso.
    if (!resp || !resp.ok) return false;
    _bloqCache = { chave: chave, bloqueado: !!resp.ignorada };
    return _bloqCache.bloqueado;
  }

  function _telaBloqueada() {
    setCorpoSecao(
      '<div class="job-bloqueado">' +
        '<div class="job-bloqueado-t">Contato marcado como pessoal</div>' +
        '<div class="job-bloqueado-s">Alguém declarou que este número não é cliente. ' +
          'Por isso o JOB não lê esta conversa, não cria lead, não cota e não envia nada por aqui.</div>' +
        '<div class="job-bloqueado-s" style="margin-top:10px">Se foi engano, desfaça no JOB, ' +
          'em <b>CRM → Auditar leads</b>. Aqui não dá — de propósito.</div>' +
      '</div>');
  }


  // ═══════════════ CONFIGURAÇÃO — dentro do WhatsApp, não no popup ═════════
  //
  // O popup do Chrome é uma caixinha: em 380px tudo vira lista vertical de
  // rótulo+campo, sem hierarquia, e parece desleixado por mais capricho que se
  // ponha. A WaSpeed não usa popup — a tela de perfil deles é um painel dentro
  // da página, com largura inteira, cartões com título e ícone em cada linha.
  // É o espaço que permite a hierarquia, não o estilo.
  //
  // Então a configuração passa a morar aqui, no mesmo painel onde já vivem
  // Análise, Funis e CRM. O popup fica com o mínimo.
  function _cfgTile(svg, cor) {
    return '<span class="job-cfg-tile" style="--tile:' + cor + '">' + svg + '</span>';
  }

  const _ICO_PESSOA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>';
  const _ICO_LINK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>';
  const _ICO_PINCEL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="13.5" cy="6.5" r=".5"/><circle cx="17.5" cy="10.5" r=".5"/><circle cx="8.5" cy="7.5" r=".5"/><circle cx="6.5" cy="12.5" r=".5"/><path d="M12 2a10 10 0 0 0 0 20 2 2 0 0 0 2-2v-1a2 2 0 0 1 2-2h1a4 4 0 0 0 4-4 10 10 0 0 0-9-11z"/></svg>';

  // O popup manda abrir a configuração aqui — é onde ela mora.
  try {
    _escutarChrome(chrome.runtime.onMessage, (msg, remetente, responder) => {
      if (msg && msg.type === 'abrir_config') {
        abrirSecao('config');
        // RESPONDE. Sem isto o popup nao distingue "o painel abriu" de "esta
        // aba nao tem a extensao carregada" — e nos dois casos ficava calado.
        try { responder({ ok: true }); } catch (e) {}
        return true;
      }
    });
  } catch (e) { /* sem extensão viva, nada a fazer */ }

  // O QUE ESTA TELA RESPONDE, EM ORDEM DE QUEM ESTRAGA MAIS O DIA:
  //
  // 1. Esta aba esta rodando a versao nova? Recarregar a extensao NAO troca o
  //    codigo de uma aba ja aberta — so o F5 troca. Sem esta linha, uma aba
  //    velha se comporta como uma nova quebrada, e nao ha nada na tela que
  //    denuncie. Custou uma noite inteira em 10/08.
  // 2. O JOB responde? Distingue "o sistema caiu" de "a minha conta caiu", que
  //    tem consertos completamente diferentes.
  // 3. Esta conta ainda vale aqui? O token e apagado la, nao aqui.
  //
  // Sem jargao e sem nome de peca: quem le isso e o consultor as 9h da manha.
  function _sitLinha(estado, texto, acao) {
    return '<div class="job-sit-l job-sit-' + estado + '">' +
      '<span class="job-sit-p"></span><span class="job-sit-t">' + texto + '</span>' +
      (acao || '') + '</div>';
  }

  async function _pintarSituacao() {
    const cx = document.getElementById('job-sit');
    if (!cx) return;
    let aqui = '';
    try { aqui = (chrome.runtime.getManifest() || {}).version || ''; } catch (e) {}

    let linhas = '';
    let tudoBem = true;

    // 1. VERSAO DESTA ABA
    let instalada = '';
    try {
      const r = await _safeSendMessage({ type: 'versao_instalada' });
      instalada = (r && r.versao) || '';
    } catch (e) { /* sem resposta: nao acusa nada */ }
    if (instalada && aqui && instalada !== aqui) {
      tudoBem = false;
      linhas += _sitLinha('ruim',
        'Esta aba está com uma versão antiga (v' + esc(aqui) + '). ' +
        'A instalada é a v' + esc(instalada) + '.',
        '<button type="button" class="job-sit-bt" id="job-sit-recarregar">Recarregar esta aba</button>');
    } else {
      linhas += _sitLinha('ok', 'Esta aba está com a versão atual' +
        (aqui ? ' (v' + esc(aqui) + ')' : '') + '.');
    }

    // 2 e 3. CONEXAO E CONTA — a mesma pergunta responde as duas, porque uma
    // conta so pode ser conferida se o JOB estiver respondendo.
    let r2 = null;
    try { r2 = await _safeSendMessage({ type: 'sessao_confere' }); } catch (e) { r2 = null; }
    if (!r2) {
      tudoBem = false;
      linhas += _sitLinha('ruim', 'Não consegui falar com o JOB agora. ' +
        'Se persistir, confira o endereço logo abaixo.');
    } else if (r2.tinhaToken === false) {
      tudoBem = false;
      linhas += _sitLinha('ruim', 'Este computador não está conectado a nenhuma conta. ' +
        'Entre com seu e-mail e senha acima.');
    } else if (r2.valida === false) {
      tudoBem = false;
      linhas += _sitLinha('ruim', 'Esta conta foi desconectada deste computador. ' +
        'Entre de novo acima.');
    } else if (r2.incerta) {
      linhas += _sitLinha('meio', 'O JOB não respondeu agora. ' +
        'Sua conta continua valendo — é a conexão que está oscilando.');
    } else {
      linhas += _sitLinha('ok', 'Conectado ao JOB e com a conta em dia.');
    }

    // O BOTAO DOS DETALHES EXISTE PORQUE ESTE PAINEL PODE ESTAR ERRADO.
    //
    // Ele le a situacao pela MESMA conferencia que pode ter quebrado — se ela
    // quebrar, o painel repete a mesma mentira com cara de diagnostico. Os
    // dados crus nao passam por interpretacao nenhuma: dizem se existe conta
    // guardada aqui, o que o servidor respondeu literalmente, e quando.
    //
    // Fica atras de um botao pra nao virar poluicao pro consultor, que so
    // precisa das frases acima.
    cx.innerHTML = linhas +
      (tudoBem ? '' : '<div class="job-sit-rod">Se você não entendeu alguma linha, ' +
        'tire um print desta tela e mande — ela foi feita pra isso.</div>') +
      '<button type="button" class="job-sit-det" id="job-sit-det">Copiar detalhes</button>';

    const bd = document.getElementById('job-sit-det');
    if (bd) bd.addEventListener('click', async () => {
      const g2 = await _safeStorageGet(['extToken', 'extKey', 'extUsuario', 'extApelido',
                                        'jobUrl', 'swSubiuEm', 'swTemAlarme', 'swVersao',
                                        'batidaEm', 'batidaPainel', 'batidaResposta']);
      // O token NAO vai junto, nem pedaco dele: ele e a chave da conta. O que
      // interessa e SE existe, nao qual e.
      const bruto = {
        versaoDestaAba: aqui,
        versaoInstalada: instalada,
        temContaGuardadaAqui: !!g2.extToken,
        temChaveAntigaAqui: !!g2.extKey,
        nomeGuardado: (g2.extUsuario && g2.extUsuario.nome) || null,
        apelidoGuardado: g2.extApelido || null,
        enderecoDoJob: g2.jobUrl || null,
        respostaDaConferencia: r2,
        motorSubiuEm: g2.swSubiuEm || null,
        motorTemRelogio: g2.swTemAlarme,
        motorVersao: g2.swVersao || null,
        ultimoSinalEm: g2.batidaEm || null,
        ultimoSinalResposta: g2.batidaResposta || null,
        painelDoCorretorAberto: g2.batidaPainel,
        agora: new Date().toISOString(),
      };
      try {
        await navigator.clipboard.writeText(JSON.stringify(bruto, null, 2));
        bd.textContent = 'Copiado — pode colar';
      } catch (e) {
        bd.textContent = 'Não consegui copiar';
      }
      setTimeout(() => { bd.textContent = 'Copiar detalhes'; }, 4000);
    });

    const br = document.getElementById('job-sit-recarregar');
    // location.reload e API da janela: funciona mesmo com o vinculo da extensao
    // ja perdido, que e exatamente o caso em que este botao aparece.
    if (br) br.addEventListener('click', () => location.reload());
  }

  async function abrirSecaoConfig() {
    const g = await _safeStorageGet(['jobUrl', 'extToken', 'extUsuario', 'extApelido',
                                     'railSide', 'tema', 'extensaoAtiva']);
    const u = g.extUsuario || null;
    const entrou = !!(u && u.nome);
    let versao = '';
    try { versao = (chrome.runtime.getManifest() || {}).version || ''; } catch (e) {}

    setCorpoSecao(
      '<div class="job-cfg">' +
        // O logo do JOB no alto, grande. Era a primeira coisa que faltava:
        // uma tela de configuração sem marca parece formulário de ninguém.
        '<div class="job-cfg-hero">' +
          '<div class="job-cfg-hero-logo">' + logoJobHTML() + '</div>' +
          '<div class="job-cfg-hero-txt">' +
            '<div class="job-cfg-hero-n">JOB Serenus</div>' +
            '<div class="job-cfg-hero-s">Análise de conversa, cotação e biblioteca</div>' +
          '</div>' +
          (versao ? '<span class="job-cfg-versao">v' + esc(versao) + '</span>' : '') +
        '</div>' +

        '<div class="job-cfg-bloco">' +
          '<div class="job-cfg-bloco-t">' + _cfgTile(_ICO_PESSOA, '#21c58f') + 'Sua conta</div>' +
          '<div class="job-cfg-cartao">' +
            (entrou
              ? '<div class="job-cfg-quem">' +
                  '<span class="job-cfg-av">' + esc((u.nome || '?').trim().charAt(0).toUpperCase()) + '</span>' +
                  '<div class="job-cfg-quem-txt">' +
                    '<div class="job-cfg-quem-n">' + esc(u.nome) + '</div>' +
                    '<div class="job-cfg-quem-s">' + esc(g.extApelido || 'este computador') + '</div>' +
                    '<span class="job-cfg-selo">conectado</span>' +
                  '</div>' +
                '</div>' +
                '<button type="button" class="job-cfg-bt job-cfg-bt-sair" id="job-cfg-sair">Sair deste computador</button>'
              : '<div class="job-cfg-campo"><label>Seu e-mail do JOB</label>' +
                  '<input id="job-cfg-email" type="email" placeholder="voce@serenus.com.br"></div>' +
                '<div class="job-cfg-campo"><label>Sua senha</label>' +
                  '<input id="job-cfg-senha" type="password" placeholder="a mesma do site"></div>' +
                '<div class="job-cfg-campo"><label>Nome deste computador</label>' +
                  '<input id="job-cfg-apelido" type="text" placeholder="notebook da Bia, WhatsApp 2…"></div>' +
                '<button type="button" class="job-cfg-bt job-cfg-bt-primario" id="job-cfg-entrar">Entrar</button>' +
                '<div class="job-cfg-dica">Você pode entrar em mais de um computador com o mesmo ' +
                  'usuário — um por WhatsApp. O nome serve pra saber qual desconectar depois.</div>') +
            '<div class="job-cfg-msg" id="job-cfg-msg"></div>' +
          '</div>' +
        '</div>' +

        // ESTA TELA RESPONDE "ESTA TUDO CERTO?" SEM NINGUEM PRECISAR PERGUNTAR.
        //
        // A noite de 10/08 foi gasta sem conseguir responder tres coisas
        // simples: esta aba esta rodando a versao nova? o JOB esta respondendo?
        // esta conta ainda vale? Cada uma exigiu consulta ao banco ou console
        // aberto. Sao dados que a propria extensao tem na mao — o custo de
        // mostrar e zero e o custo de nao mostrar foi uma noite.
        //
        // Fica dentro de Configurações, aberta, sem modo escondido: quem precisa
        // e o consultor as 9h da manha, nao quem sabe onde clicar.
        '<div class="job-cfg-bloco">' +
          '<div class="job-cfg-bloco-t">' + _cfgTile(_ICO_CHECK, '#8b5cf6') + 'Está tudo certo?</div>' +
          '<div class="job-cfg-cartao" id="job-sit">' +
            '<div class="job-sit-l"><span class="job-sit-p"></span>' +
              '<span class="job-sit-t">Conferindo…</span></div>' +
          '</div>' +
        '</div>' +

        '<div class="job-cfg-bloco">' +
          '<div class="job-cfg-bloco-t">' + _cfgTile(_ICO_LINK, '#3b82f6') + 'Conexão</div>' +
          '<div class="job-cfg-cartao">' +
            // O ENDERECO PADRAO APARECE PREENCHIDO.
            //
            // Vazio, a pessoa acha que falta configurar e nao entra. Na verdade
            // o service worker ja cai no padrao quando o campo esta vazio — o
            // que faltava era MOSTRAR isso.
            '<div class="job-cfg-campo"><label>Endereço do JOB</label>' +
              '<input id="job-cfg-url" type="text" value="' +
                esc(g.jobUrl || _SITE_BASE_URL_EXT || '') + '"></div>' +
            '<button type="button" class="job-cfg-bt" id="job-cfg-testar">Testar conexão</button>' +
          '</div>' +
        '</div>' +

        '<div class="job-cfg-bloco">' +
          '<div class="job-cfg-bloco-t">' + _cfgTile(_ICO_PINCEL, '#a855f7') + 'Aparência</div>' +
          '<div class="job-cfg-cartao">' +
            '<div class="job-cfg-campo"><label>Lado do painel</label>' +
              '<select id="job-cfg-lado">' +
                '<option value="direita"' + (g.railSide !== 'esquerda' ? ' selected' : '') + '>Direita</option>' +
                '<option value="esquerda"' + (g.railSide === 'esquerda' ? ' selected' : '') + '>Esquerda</option>' +
              '</select></div>' +
            '<div class="job-cfg-campo"><label>Cor do painel</label>' +
              '<select id="job-cfg-tema">' +
                '<option value="escuro"' + (g.tema !== 'claro' ? ' selected' : '') + '>Escuro</option>' +
                '<option value="claro"' + (g.tema === 'claro' ? ' selected' : '') + '>Claro</option>' +
              '</select></div>' +
            '<div class="job-cfg-dica" style="margin-top:2px">Deixe no lado oposto ao trilho de outra ' +
              'extensão. Duas no mesmo lado se sobrepõem.</div>' +
            '<label class="job-cfg-chave">' +
              '<input type="checkbox" id="job-cfg-ativa"' + (g.extensaoAtiva !== false ? ' checked' : '') + '>' +
              '<span class="job-cfg-chave-bola"></span>' +
              '<span class="job-cfg-chave-txt">Extensão ligada neste computador</span>' +
            '</label>' +
          '</div>' +
        '</div>' +

        // O ACESSO ANTIGO PRECISA CONTINUAR ALCANÇÁVEL AQUI.
        //
        // Eu movi a chave compartilhada pro popup e não trouxe pro painel novo.
        // Resultado: quem entrasse no portão não tinha como voltar a usar a
        // chave por dentro da extensão — caminho de ida sem volta, justamente
        // no dia em que o portão passou a exigir login.
        //
        // Fica recolhido e com o motivo escrito: ela diz "sou a extensão" e não
        // diz quem é você. É rede de segurança, não a porta principal.
        '<details class="job-cfg-antigo">' +
          '<summary>Acesso antigo (chave compartilhada)</summary>' +
          '<div class="job-cfg-cartao" style="margin-top:8px">' +
            '<div class="job-cfg-campo"><label>Chave da extensão</label>' +
              '<input id="job-cfg-chave" type="password" ' +
                'value="' + esc(g.extKey || '') + '" placeholder="cole a chave"></div>' +
            '<div class="job-cfg-dica" style="margin-top:0">Esta chave é a mesma em ' +
              'todas as máquinas: ela diz "sou a extensão" e não diz quem é você. ' +
              'Entrando com e-mail e senha acima, o JOB passa a saber — e este ' +
              'bloco pode sumir.</div>' +
          '</div>' +
        '</details>' +
      '</div>');

    const msg = (t, cls) => {
      const m = document.getElementById('job-cfg-msg');
      if (m) { m.textContent = t; m.className = 'job-cfg-msg ' + (cls || ''); }
    };
    const salvarCfg = () => {
      const url = (document.getElementById('job-cfg-url') || {}).value;
      _safeStorageSet({
        jobUrl: (url || '').trim().replace(/\/+$/, ''),
        railSide: (document.getElementById('job-cfg-lado') || {}).value === 'esquerda' ? 'esquerda' : 'direita',
        tema: (document.getElementById('job-cfg-tema') || {}).value === 'claro' ? 'claro' : 'escuro',
        extensaoAtiva: !!(document.getElementById('job-cfg-ativa') || {}).checked,
        extKey: ((document.getElementById('job-cfg-chave') || {}).value || '').trim(),
      });
    };
    ['job-cfg-url', 'job-cfg-lado', 'job-cfg-tema', 'job-cfg-ativa', 'job-cfg-chave'].forEach((id) => {
      const e = document.getElementById(id);
      if (e) e.addEventListener('change', salvarCfg);
    });

    const bt = document.getElementById('job-cfg-testar');
    if (bt) bt.addEventListener('click', async () => {
      salvarCfg();
      bt.disabled = true; bt.textContent = 'Testando…';
      let r = null;
      try { r = await _safeSendMessage({ type: 'ping' }); } catch (e) { r = null; }
      bt.disabled = false; bt.textContent = 'Testar conexão';
      msg(r && r.ok ? 'Conectado ao JOB.' : ((r && r.erro) || 'Não consegui falar com o JOB.'),
          r && r.ok ? 'ok' : 'err');
    });

    const be = document.getElementById('job-cfg-entrar');
    if (be) be.addEventListener('click', async () => {
      const email = (document.getElementById('job-cfg-email').value || '').trim();
      const senha = document.getElementById('job-cfg-senha').value || '';
      const apelido = (document.getElementById('job-cfg-apelido').value || '').trim();
      if (!email || !senha) { msg('Preencha e-mail e senha.', 'err'); return; }
      salvarCfg();
      be.disabled = true; be.textContent = 'Entrando…';
      let r = null;
      try { r = await _safeSendMessage({ type: 'login', payload: { email, senha, apelido } }); }
      catch (e) { r = null; }
      be.disabled = false; be.textContent = 'Entrar';
      if (!r || !r.ok) {
        msg(r && r.erro === 'credenciais_invalidas' ? 'E-mail ou senha incorretos.'
          : r && r.erro === 'usuario_inativo' ? 'Este usuário está inativo no JOB.'
          : (r && r.erro) || 'Não consegui entrar agora.', 'err');
        return;
      }
      abrirSecaoConfig();     // redesenha já mostrando quem entrou
    });

    _pintarSituacao();

    const bs = document.getElementById('job-cfg-sair');
    if (bs) bs.addEventListener('click', async () => {
      bs.disabled = true; bs.textContent = 'Saindo…';
      try { await _safeSendMessage({ type: 'logout' }); } catch (e) {}
      abrirSecaoConfig();
    });
  }

  async function abrirSecao(secao) {
    // Abrir o painel e o momento em que a pessoa vai usar: confere AGORA, sem
    // respeitar a trava de tempo. E aqui que ela descobriria do jeito ruim.
    _confirmarSessaoNoServidor(true);
    _secaoAtiva = secao;
    document.querySelectorAll('.job-trilho-item').forEach((i) =>
      i.classList.toggle('job-trilho-item-ativo', i.dataset.secao === secao));
    _trilhoMarcaSincronizar();
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
    // A GUARDA VEM ANTES DE QUALQUER SEÇÃO. Uma por uma seria uma porta
    // esquecida a cada seção nova — e seção nova aparece toda semana.
    // A configuração escapa da guarda: ela não é sobre o contato, e travar
    // o acesso a ela numa conversa marcada deixaria a pessoa sem como entrar
    // ou desligar a extensão.
    // O porteiro vem antes de tudo, menos da própria configuração — que é
    // justamente onde a pessoa resolve.
    if (secao !== 'config' && await _semCredencial()) { _abrirPortao(); return; }
    if (secao !== 'config' && await _contatoBloqueado()) { _telaBloqueada(); return; }

    if (secao === 'analise') sincronizarPainelComConversa();
    else if (secao === 'mensagens') abrirSecaoMensagens();
    else if (secao === 'funis') abrirSecaoFunis();
    else if (secao === 'inbox') abrirSecaoInbox();
    else if (secao === 'cnpj') abrirSecaoCnpj();
    else if (secao === 'cotacao') abrirSecaoCotacao();
    else if (secao === 'notas') abrirSecaoNotas();
    else if (secao === 'crm') abrirSecaoNovoLead();
    else if (secao === 'fila') abrirSecaoFila();
    else if (secao === 'ficha') abrirSecaoFicha();
    else if (secao === 'dev') abrirSecaoDev();
    else if (secao === 'config') abrirSecaoConfig();
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
    perf: { regs: 0, passadas: 0, linhas: 0, ms: 0, pior: 0, puladas: 0, geo: 0, geoN: 0 },
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
  // sao ptt/audio e caso com a linha pelo data-id. Seletor de CSS quebra a cada
  // atualizacao; o tipo da mensagem, nao. DETECCAO 100% LOCAL, sem perguntar
  // nada a ninguem.
  //
  // CORRECAO DE 11/08/2026: esta linha dizia "que e o mesmo id dos dois lados".
  // NAO E — em conversa `@lid` o DOM e o store escrevem `remote` diferente, e a
  // comparacao exata nao casa nada (medido: 10 audios achados, 0 na tela). O
  // casamento agora normaliza o id dos dois lados; ver `_trHashDoId` perto do
  // `_TR_AUDIO_IDS`. Deixo o erro escrito aqui de proposito: foi este comentario
  // que me fez procurar o defeito na wa-js por horas em vez de na comparacao.
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
    //
    // DOIS PASSOS, e não um seletor só: '.job-doc-slot ... .job-doc-etapa'
    // atravessaria a fronteira do shadow e não acharia nada — seletor de fora
    // não enxerga dentro da raiz. Acha o hospedeiro na luz, entra na raiz dele.
    document.querySelectorAll('.job-doc-slot[data-msg="' + sel + '"]').forEach((host) => {
      const raiz = host.shadowRoot || host;
      raiz.querySelectorAll('.job-doc-etapa')
        .forEach((el) => { el.textContent = (e.etapa || 'lendo') + '… ' + seg + 's'; });
    });
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
    // A trava acima fica no HOSPEDEIRO de propósito: clique e mouse são
    // eventos compostos, então atravessam a fronteira do shadow e chegam aqui
    // do mesmo jeito. Continua valendo por todos os controles de dentro.
    const raiz = _jobRaiz(slot);
    const e = DOC.estado.get(id) || {};
    if (e.status === 'lendo') {
      const seg = e.t0 ? Math.round((Date.now() - e.t0) / 1000) : 0;
      raiz.innerHTML = '<div class="job-tr-carregando"><span class="job-doc-etapa">' +
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
      raiz.innerHTML = '<div class="job-doc-lido">' +
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
        const nm = raiz.querySelector('.job-doc-nome');
        const par = raiz.querySelector('[data-campo="parentesco"]');
        const resp = await _safeSendMessage({ type: 'documento_tipo', docId: a.doc_id,
          tipo: (raiz.querySelector('[data-campo="tipo"]') || {}).value,
          titularidade: (raiz.querySelector('[data-campo="titularidade"]') || {}).value,
          parentesco: par && !par.hidden ? par.value : '' }).catch(() => null);
        if (resp && resp.ok) {
          a.nome_final = resp.nome_final;
          if (nm) nm.textContent = resp.nome_final;
        } else if (nm) { nm.textContent = 'não deu pra salvar'; }
      };
      const rl = raiz.querySelector('[data-ac="reler"]');
      if (rl) rl.addEventListener('click', (ev) => {
        ev.stopPropagation();
        DOC.estado.delete(id);
        docLerVarios([id], true);
      });
      raiz.querySelectorAll('.job-doc-sel').forEach((sl) => {
        sl.addEventListener('click', (ev) => ev.stopPropagation());
        sl.addEventListener('change', async (ev) => {
          ev.stopPropagation();
          const par = raiz.querySelector('[data-campo="parentesco"]');
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
            const dica = raiz.querySelector('.job-doc-dica');
            if (dica) dica.textContent = comprova[sl.value] ? ('comprova com: ' + comprova[sl.value]) : '';
          }
          await salvar();
        });
      });
      return;
    }
    if (e.status === 'erro') {
      raiz.innerHTML = '<button class="job-tr-btn falhou" type="button" data-ac="ler" title="' + esc(e.erro || '') + '">' +
        _ICO_DOC + 'Ler documento</button>' +
        '<span class="job-tr-motivo">' + esc(e.erro || '') + '</span>';
    } else {
      raiz.innerHTML = '<button class="job-tr-btn" type="button" data-ac="ler">' + _ICO_DOC + 'Ler documento</button>';
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
    const j = raiz.querySelector('[data-ac="juntar"]');
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
    const b = raiz.querySelector('[data-ac="ler"]');
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
      // Aqui é onde este Map realmente engorda: cada entrada carrega a resposta
      // inteira do servidor (texto extraído do documento). Documento 'lendo'
      // nunca sai — despejar ele deixaria o cronômetro girando pra sempre numa
      // bolha que ninguém mais atualiza.
      _capMap(DOC.estado, _TETO_DOC, (v) => v && v.status === 'lendo');
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

  // A FONTE CONFIAVEL VOLTOU — SO QUE SEM O CUSTO QUE A TIROU DA ULTIMA VEZ.
  //
  // Em 31/07 a checagem por CSS (icone "ptt", data-testid de audio) substituiu
  // a pergunta direta ao WhatsApp (wa-js) porque perguntar buscava as 400
  // ultimas mensagens da conversa a CADA passada do varredor — caro, e pesava
  // no proprio WhatsApp. Virou so CSS.
  //
  // Em 11/08 o botao sumiu de TODO audio, em toda conversa. O motivo apareceu
  // no proprio HTML inspecionado: o WhatsApp novo usa nomes de classe
  // ofuscados (`x1n2onr6`, sem significado) e o icone que o seletor procurava
  // deixou de existir do jeito esperado. Isso nao e um seletor errado pra
  // consertar — e a prova de que seletor de CSS nao e mais um chao firme pra
  // pisar: o WhatsApp pode trocar de novo amanha, sem aviso, e o botao some
  // de novo em silencio.
  //
  // A pergunta direta ao WhatsApp NAO precisa custar cada passada: ela roda
  // UMA vez por conversa aberta (o gatilho e `_barraConvInjetar`, que so roda
  // de novo quando o rodape e recriado — e o rodape so e recriado quando a
  // conversa troca) e guarda os ids num Set. Depois disso, saber se uma linha
  // e audio vira uma consulta ao Set — sem rede, sem custo por passada. O
  // CSS fica de reserva pra ANTES do Set estar pronto (a fracao de segundo
  // logo apos abrir a conversa) e pra quando a ponte falhar.
  const _TR_AUDIO_IDS = new Set();
  // O MESMO ID, ESCRITO DE DOIS JEITOS.
  //
  // Medido em 11/08/2026, conversa 187943809491161@lid: a ponte devolveu 10
  // audios e NENHUM casou com linha do DOM. Nao era a wa-js (getActiveChat
  // respondia, listar_audios voltou sem erro) — era a comparacao aqui, que
  // exigia string identica.
  //
  // O id de mensagem do WhatsApp e `origem_remote_id[...]`. Só a parte final
  // identifica a MENSAGEM; o `remote` diz ONDE ela esta — e e justamente isso
  // que muda quando a conversa passa a ser endereçada por `@lid` em vez do
  // telefone: um lado escreve `false_5519...@c.us_3EB0...`, o outro
  // `false_1879...@lid_3EB0...`. Mesma mensagem, strings diferentes.
  //
  // ISTO JA ESTAVA RESOLVIDO — e eu nao reusei. `_idCru` (wpp-bridge.js:478)
  // existe exatamente por causa deste bug, e o comentario de la ja conta a
  // historia toda. Quando a deteccao de audio passou a vir da ponte, o
  // casamento aqui voltou a comparar a string inteira e o conserto de la nao
  // valia mais pra ca.
  //
  // POR QUE AQUI PEGA SO `p[2]` E NAO `slice(2).join('_')` COMO O `_idCru`:
  // em GRUPO o serializado tem uma quarta parte, o participante — e ele tambem
  // muda de `@lid` pra `@c.us` entre o DOM e o store. Mantendo o participante,
  // grupo continuaria sem casar (testado: os dois lados dao strings
  // diferentes). O hash sozinho ja identifica a mensagem, entao e o unico
  // pedaco que serve pros dois formatos e pros dois tipos de conversa.
  // Colisao nao e risco real: o hash e unico por mensagem e a comparacao so
  // acontece dentro da conversa aberta.
  const _TR_AUDIO_HASH = new Set();
  const _TR_AUDIO_CANONICO = new Map();

  function _trHashDoId(id) {
    const p = String(id || '').split('_');
    return (p.length > 2 ? p[2] : p[p.length - 1] || '').trim();
  }

  function _trLinhaEhAudio(row) {
    const id = row.getAttribute('data-id') || '';
    if (id && _TR_AUDIO_IDS.has(id)) return true;
    const h = _trHashDoId(id);
    if (h && _TR_AUDIO_HASH.has(h)) return true;
    return !!row.querySelector(
      'audio, [data-icon="ptt"], [data-icon*="ptt"], [data-icon*="audio"],' +
      '[data-icon="audio-play"], [data-icon="play"],' +
      '[aria-label*="udio"], [data-testid*="audio"], [data-testid*="ptt"]');
  }

  function _trIdCanonico(id) {
    if (_TR_AUDIO_IDS.has(id)) return id;
    return _TR_AUDIO_CANONICO.get(_trHashDoId(id)) || id;
  }

  // Chamada UMA vez por conversa aberta (ver `_barraConvInjetar`), e de novo
  // a cada `_TR_AUDIO_REFRESH_MS` enquanto ela continua aberta — mensagem de
  // audio nova, chegando ao vivo, tambem precisa entrar no Set. Silenciosa: se
  // a ponte falhar, quem sustenta a deteccao nesse intervalo e o CSS.
  const _TR_AUDIO_REFRESH_MS = 90000;
  async function _trAtualizarIdsDeAudio() {
    try {
      const r = await _pedirPonte('listar_audios', {}, 12000);
      if (r && Array.isArray(r.audios)) {
        _TR_AUDIO_IDS.clear();
        _TR_AUDIO_HASH.clear();
        _TR_AUDIO_CANONICO.clear();
        for (const a of r.audios) {
          if (!a || !a.msg_id) continue;
          // O msg_id CANONICO continua sendo o do store — e ele que vai pro
          // servidor, pro cache de transcricao e pro download. O normalizado
          // serve SO pra achar a linha na tela.
          _TR_AUDIO_IDS.add(a.msg_id);
          const h = _trHashDoId(a.msg_id);
          if (h) {
            _TR_AUDIO_HASH.add(h);
            _TR_AUDIO_CANONICO.set(h, a.msg_id);
          }
        }
        // ESTA RESPOSTA CHEGA TARDE DEMAIS PRA PASSADA QUE JA RODOU.
        //
        // `trInjetar` pula toda linha marcada `_jobPronta` — e ela ja marcou
        // essas linhas ANTES de a ponte responder (isto aqui e assincrono, com
        // ate 12s de teto). Sem desmarcar, a linha que acabou de ser
        // reconhecida como audio nunca mais e visitada e o botao so apareceria
        // se o WhatsApp redesenhasse a bolha por conta propria.
        //
        // Desmarca so as linhas que AGORA sao audio (nao a conversa inteira) e
        // pede uma passada. Se nenhuma mudou, nao mexe em nada.
        try {
          let mudou = 0;
          for (const row of document.querySelectorAll('#main [data-id]')) {
            if (!row._jobPronta) continue;
            if (!_trLinhaEhAudio(row)) continue;
            if (row.querySelector('.job-tr-slot')) continue;  // ja tem botao
            row._jobPronta = null;
            mudou++;
          }
          if (mudou) trInjetar();
        } catch (e) { /* passada seguinte cobre */ }
      }
    } catch (e) { /* Set fica com o que tinha (ou vazio) — CSS cobre o resto */ }
  }
  // Audio chegando ao vivo na MESMA conversa tambem precisa entrar no Set —
  // o gatilho de `_barraConvInjetar` so dispara na troca de conversa, nao a
  // cada mensagem nova dentro dela. Aba em segundo plano nao gasta nada.
  _registrarLoop(setInterval(() => {
    if (!_contextoValido() || document.hidden) return;
    _trAtualizarIdsDeAudio();
  }, _TR_AUDIO_REFRESH_MS));

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
  // QUANTO CUSTA MEDIR GEOMETRIA — separado do resto da passada.
  //
  // Guilherme, 10/08/2026, no Diagnostico: aba em 1,2 GB e PIOR CASO 340ms.
  // 340ms numa passada e congelamento visivel, e esta acima do limite que eu
  // mesmo pus pra dizer "o problema e nosso".
  //
  // O suspeito e aritmetico: achar a bolha sobe ate 10 ancestrais lendo
  // `clientWidth` de cada um, DUAS vezes (dois tetos). Ler largura obriga o
  // navegador a recalcular o layout na hora. Sao ~25 recalculos forcados por
  // linha nova; rolar traz 30 linhas de uma vez.
  //
  // Isto NAO conserta nada — mede. Se `geo` for a maior parte dos 340ms, o
  // conserto e separar leitura de escrita (medir tudo, depois inserir tudo),
  // que colapsa N recalculos em um. Se nao for, o conserto e outro e eu teria
  // reescrito a peca errada.
  function _trBolhaDoc(row, ancora) {
    const _g0 = performance.now();
    try {
      return _trBolhaDocMedir(row, ancora);
    } finally {
      TR.perf.geo += performance.now() - _g0;
      TR.perf.geoN++;
    }
  }
  function _trBolhaDocMedir(row, ancora) {
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
    let melhor = null;
    for (let i = 0; el && i < 8 && el !== row; i++) {
      const w = el.clientWidth;
      // Larga o bastante pra ser bolha, estreita o bastante pra nao ser a linha.
      if (w > 150 && w < larguraLinha * 0.94) melhor = el;
      el = el.parentElement;
    }
    if (melhor) return melhor;

    // A ANCORA MORREU E LEVOU O BOTAO JUNTO.
    //
    // Ate aqui, sem ancora esta funcao devolvia `null` — e o injetor
    // (`if (!bolha) continue`) descartava a linha em silencio. O problema: os
    // seletores acima sao os MESMOS que o comentario de ~2258 ja declara
    // obsoletos ("o WhatsApp trocou a marcacao, nao ha mais <audio> na bolha e
    // o icone mudou de nome"). Quando a deteccao de audio migrou pra wa-js, ela
    // deixou de depender desses seletores; a ancora nao. Resultado medido em
    // 11/08/2026: 10 audios reconhecidos, 0 botoes na tela, nenhum erro.
    //
    // A licao ja estava escrita no caminho do documento (`_trBolhaDocMedir`):
    // "NUNCA devolve vazio: botao que some e pior que botao no lugar mais ou
    // menos certo". O caminho do audio nao tinha essa rede — agora tem.
    //
    // Sem ancora semantica, nao tenta adivinhar um ancestral pela area. Esse
    // palpite podia escolher um wrapper com altura fixa e overflow, deixando o
    // botao no DOM mas recortado. A propria linha e o fallback estavel.
    // Botao levemente fora do lugar e recuperavel; botao que nao existe, nao.
    // A marca importa: pendurado na linha inteira, sem a classe de solto, o
    // bloco atravessa a conversa de ponta a ponta (foi o que ficou horrivel no
    // documento antes da `.job-doc-solto` existir). Quem cria o slot le esta
    // marca e limita a largura.
    row._jobTrSolto = true;
    return row;
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

    // ── FASE 1: MEDIR TUDO ANTES DE ESCREVER QUALQUER COISA ─────────────
    //
    // MEDIDO: 280ms dos 340ms do pior caso estavam aqui — 82%. E o custo nao
    // e a medicao em si, e a INTERCALACAO.
    //
    // O laco de baixo fazia, por linha: medir a bolha (le layout), inserir o
    // bloco (invalida o layout), medir a proxima (o navegador recalcula a
    // pagina INTEIRA de novo). Cada insercao joga fora o layout que a leitura
    // seguinte precisa, entao N linhas custam N recalculos completos em vez
    // de um. Rolar traz 30 linhas de uma vez.
    //
    // Aqui todas as medicoes acontecem juntas, antes da primeira escrita: o
    // navegador calcula o layout UMA vez e responde todas as perguntas com
    // ele. O laco de baixo continua identico — so pega a medida pronta em vez
    // de pedir na hora.
    //
    // Nada muda no resultado: as mesmas linhas, a mesma bolha, o mesmo lado.
    // Muda quando a pergunta e feita.
    for (const row of linhas) {
      row._jobMedida = null;
      const id = row.getAttribute('data-id') || '';
      if (!id || row._jobPronta === id) continue;
      if (!_docLinhaEhArquivo(row)) continue;
      const sdAtual = row.querySelector('.job-doc-slot');
      const soltoAtual = !!(sdAtual && sdAtual.classList.contains('job-doc-solto'));
      // Mesma condicao do laco de baixo — se ele nao for medir, nao mede aqui.
      const vaiMedir = !sdAtual || (soltoAtual && (sdAtual._jobTentativas || 0) < 5);
      if (!vaiMedir) continue;
      const anc = _docAncora(row);
      row._jobMedida = { ancora: anc, bolha: _trBolhaDoc(row, anc) };
    }

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
          // A medida veio da fase 1, feita antes de qualquer escrita. Quando
          // ela nao existe (linha que entrou depois, caso raro), mede aqui
          // mesmo — melhor pagar um recalculo que perder o botao.
          const _m = row._jobMedida;
          const ancoraD = _m ? _m.ancora : _docAncora(row);
          const r = _m ? _m.bolha : _trBolhaDoc(row, ancoraD);
          row._jobMedida = null;
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
      if (row.querySelector('.job-tr-slot:not(.job-doc-slot)')) {
        if (!pendente) row._jobPronta = id;
        continue;
      }
      if (!_trLinhaEhAudio(row)) {
        // ERA AQUI QUE O "LER DOCUMENTO" SUMIA.
        //
        // Linha que nao e audio e nao tem bloco de documento era dada por
        // PRONTA na primeira passada — e linha pronta nunca mais e reavaliada
        // (essa marca existe por desempenho, e o desempenho depende dela).
        //
        // So que a bolha de PDF do WhatsApp nao nasce pronta: a miniatura, o
        // canvas e o icone chegam depois, assincronos. Quando o varredor passa
        // no instante em que a linha aparece, `_docAncora` nao acha nada,
        // porque ainda nao HA nada — e a linha e carimbada como texto puro pra
        // sempre. O botao nunca aparece, sem erro nenhum no console.
        //
        // Isso tambem explica por que parecia intermitente ("antes tinha"):
        // dependia de a passada cair antes ou depois da miniatura pintar.
        //
        // Agora a linha sem documento ganha algumas passadas de tolerancia
        // antes de virar definitiva. Se em ~6 rodadas nao apareceu arquivo
        // nenhum, e texto mesmo e a marca vale — o custo extra fica so nos
        // primeiros segundos de vida de cada linha, nao na conversa inteira.
        if (!pendente) {
          const jaTemDoc = !!row.querySelector('.job-doc-slot');
          if (jaTemDoc) {
            row._jobPronta = id;
          } else {
            row._jobDocTent = (row._jobDocTent === undefined || row._jobIdTent !== id)
              ? 1 : row._jobDocTent + 1;
            row._jobIdTent = id;
            if (row._jobDocTent > 6) row._jobPronta = id;
          }
        }
        continue;
      }
      row._jobTrSolto = false;
      const bolha = _trBolha(row);
      if (!bolha) continue;             // nao deveria mais acontecer; guarda mantida
      // NO MODO SOLTO A GEOMETRIA NAO SERVE PRA DECIDIR O LADO.
      //
      // `_trLado` compara a bolha com a linha; no solto as duas SAO o mesmo
      // elemento, entao a conta vira `0 > 0` — sempre falso, sempre 'lead'.
      // Audio enviado pelo consultor sairia com a cor de recebido. Aviso do
      // Codex, conferido na conta.
      //
      // O proprio id ja diz de quem e: o serializado comeca com `true_` quando
      // a mensagem e minha. E mais confiavel que geometria, e nao custa layout.
      const lado = row._jobTrSolto
        ? (String(id).lastIndexOf('true_', 0) === 0 ? 'consultor' : 'lead')
        : _trLado(bolha, row);
      const slot = document.createElement('div');
      const idAudio = _trIdCanonico(id);
      slot.className = 'job-tr-slot ' + (lado === 'consultor' ? 'job-tr-dir' : 'job-tr-esq')
                     + (row._jobTrSolto ? ' job-tr-solto' : '');
      slot.dataset.msg = idAudio;
      // DENTRO da bolha: herda posicao, largura e cor de quem ja esta no lugar certo.
      bolha.appendChild(slot);
      trRenderSlot(slot, idAudio);
      if (!pendente) row._jobPronta = id;
    }
    const _gasto = performance.now() - _t0;
    TR.perf.ms += _gasto;
    if (_gasto > TR.perf.pior) TR.perf.pior = _gasto;
  }

  function trRenderSlot(slot, id) {
    const raiz = _jobRaiz(slot);
    const texto = TR.cache.get(id);
    if (TR.ocupado.has(id)) {
      raiz.innerHTML = '<div class="job-tr-carregando">transcrevendo…</div>';
      return;
    }
    if (texto === undefined) {
      raiz.innerHTML = '<button class="job-tr-btn" type="button">' + _ICO_TRANSCREVER + 'Transcrever</button>';
      const b = raiz.querySelector('button');
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
      raiz.innerHTML = '<button class="job-tr-btn falhou" type="button" title="' +
        esc(pq || 'não deu certo — clique pra tentar de novo') + '">' +
        _ICO_TRANSCREVER + 'Transcrever</button>' +
        (pq ? '<span class="job-tr-motivo">' + esc(pq) + '</span>' : '');
      const b = raiz.querySelector('button');
      if (b) b.addEventListener('click', (ev) => {
        ev.stopPropagation(); TR.cache.delete(id); TR.erro.delete(id); trTranscrever(id);
      });
      return;
    }
    raiz.innerHTML = '<div class="job-tr-texto"><span class="job-tr-tag">transcricao</span>' +
      esc(texto) + '<button class="job-tr-copiar" type="button" title="Copiar">' + _ICO_COPIAR + '</button></div>';
    const c = raiz.querySelector('.job-tr-copiar');
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
      const txt = ((r.transcricoes || {})[id] || '').strip ? (r.transcricoes[id] || '').strip() : String(r.transcricoes[id] || '').trim();
      TR.cache.set(id, txt || '[áudio não transcrito]');
      TR.erro.delete(id);
    } catch (e) {
      TR.cache.set(id, '');
      TR.erro.set(id, String((e && e.message) || e).slice(0, 90));
    } finally {
      TR.ocupado.delete(id);
      trAtualizarSlot(id);
      // No finally: vale pro caminho de sucesso E pro de erro, e os dois
      // inserem em TR.cache. Áudio sendo transcrito agora (TR.ocupado) nunca
      // sai — perder a entrada no meio faria o slot voltar pro botão enquanto
      // a transcrição ainda está em voo.
      _capMap(TR.cache, _TETO_TR, (_v, k) => TR.ocupado.has(k));
      _capMap(TR.erro, _TETO_TR, (_v, k) => TR.ocupado.has(k));
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
  // A BARRA DESCE DO CABEÇALHO PRA JUNTO DA CAIXA DE DIGITAR.
  //
  // No cabeçalho ela disputava espaço com o nome do contato, com os botões de
  // chamada e com a busca do WhatsApp — e em janela estreita empurrava o nome
  // pra fora. Junto do campo de digitar ela fica onde a mão já está, e vira o
  // que é: três atalhos, não uma segunda barra de navegação.
  //
  // Vira BOLA COM ÍCONE: o rótulo sai da tela e vive no `title`, porque três
  // rótulos escritos ali competiriam com o texto que a pessoa está redigindo.
  // O de salvar contato mantém o texto, porque é o único que ele quis
  // destacar — e é o único que grava.
  // Enquanto trabalha, a bola precisa mostrar número ("3/12") — e número não
  // cabe num círculo de 34px. Ela vira pílula enquanto o texto é diferente do
  // rótulo de repouso, e volta a ser bola quando termina.
  function _bcRotulo(b, txt) {
    const e = b.querySelector('span');
    if (e) e.textContent = txt;
    if (b.classList.contains('job-bc-bola')) {
      const base = b.dataset.rot || '';
      b.classList.toggle('job-bc-ocupada', !!base && txt !== base);
    }
  }

  // TRANSCREVER, com trava de repetição.
  //
  // Ele custa dinheiro e prende a conversa. Duplo clique, ou clicar de novo
  // logo depois de terminar, refaria o trabalho pelo mesmo resultado. Por isso
  // o botão desaparece quando termina: se não sobrou áudio sem texto, ele não
  // tem mais o que fazer nesta conversa — e botão sem trabalho é justamente o
  // que convida o clique à toa.
  function _barraConvLigarTranscrever(box, bt) {
    const r0 = bt.dataset.rot || 'Transcrever';
    bt.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (bt.disabled) return;
      bt.disabled = true;
      try {
        const p = await transcreverTudo((x) => {
          _bcRotulo(bt, x.rodando ? (x.feitos + '/' + x.total) : r0);
        });
        _bcRotulo(bt, p.total === 0 ? 'Sem áudio'
          : (p.erros ? p.erros + ' falhou(ram)' : 'Pronto: ' + p.total));
        // Some depois de mostrar o resultado: não há mais áudio pra transcrever.
        setTimeout(() => { if (bt.isConnected) bt.remove(); }, 2600);
      } catch (e) {
        _bcRotulo(bt, 'Falhou');
        setTimeout(() => { _bcRotulo(bt, r0); bt.disabled = false; }, 2600);
      }
    });
  }

  function _barraConvLigarSalvar(bsv) {
    const rotulo = _bcRotulo;
    bsv.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      if (bsv.disabled) return;
      bsv.disabled = true;
      const r0 = 'Salvar contato';
      try {
        let chat = '';
        try { const c = await _pedirPonte('obter_chat_id', {}, 8000); chat = (c && c.chat_id) || ''; }
        catch (e) { chat = ''; }
        if (!chat) { rotulo(bsv, 'Abra a conversa'); return; }
        // A ficha traz etapa, origem, operadora e consultor — que é o que o
        // nome padrão usa. Sem ela, cai no nome que está na tela.
        if (!_ficha || !_ficha.lead) {
          try {
            let tel = '';
            try { tel = (await pedirTelefoneWpp()) || telefoneDoContato(); } catch (e2) { tel = telefoneDoContato(); }
            if (tel) await _carregarFicha({ telefone: tel });
          } catch (e) { /* segue com o nome da tela */ }
        }
        const sugerido = (_ficha && _ficha.lead ? _montarNomeContato() : (nomeDoContato() || '')).trim();
        // A ÚLTIMA PALAVRA É DE QUEM CONHECE O CLIENTE. O padrão monta, a
        // folha mostra, a pessoa corrige se quiser — sem sair da conversa e
        // sem um segundo botão.
        const nome = await _folhaSalvarContato(sugerido);
        if (!nome) { rotulo(bsv, r0); return; }
        const partes = nome.split(/\s+/);
        const primeiro = partes.shift() || nome;
        const sobrenome = partes.join(' ');
        let r = null;
        try { r = await _pedirPonte('salvar_contato', { chatId: chat, nome: primeiro, sobrenome }, 15000); }
        catch (e) { _falhaTecnica('salvar contato (cabeçalho)', e); }
        if (r && r.ok) {
          rotulo(bsv, 'Salvo'); bsv.classList.add('ok');
          // SOME depois de confirmar: o contato agora tem nome, e o botão
          // deixou de ter trabalho. Deixar ele aceso é convidar o segundo
          // clique que grava de novo o que já está gravado.
          setTimeout(() => { if (bsv.isConnected) bsv.remove(); }, 2400);
          return;
        }
        // Diz QUAL problema. 'sem_suporte' manda pro caminho que funciona.
        rotulo(bsv, (r && r.erro) === 'sem_suporte' ? 'Não dá aqui' : 'Falhou');
        if (r && r.erro) _falhaTecnica('salvar contato (cabeçalho): ' + r.erro, null);
      } finally {
        setTimeout(() => { rotulo(bsv, r0); bsv.classList.remove('ok'); bsv.disabled = false; }, 2800);
      }
    });
  }

  // ══ QUEM APARECE, E QUANDO ════════════════════════════════════════════
  //
  // Botão que está sempre ali convida clique à toa — e dois destes têm custo
  // real: transcrever gasta API e prende a conversa por minutos; salvar
  // contato escreve na agenda. Então cada um só entra quando a situação dele
  // existe:
  //
  //   TRANSCREVER   só se houver áudio AINDA NÃO transcrito, e o rótulo diz
  //                 quantos — que é o que faz a pessoa pensar antes de clicar.
  //   SALVAR        só se o contato AINDA NÃO está salvo. Contato salvo tem
  //                 nome; não salvo aparece como número. Se já tem nome, o
  //                 botão não tem trabalho a fazer.
  //   COPIAR        sempre: não custa nada e não escreve em lugar nenhum.
  //
  // Tudo em segundo plano: a barra aparece na hora com o Copiar, e os outros
  // dois entram quando a checagem volta. Esperar pra desenhar deixaria o
  // rodapé pulando.
  async function _barraConvContexto(box) {
    if (!box || !box.isConnected) return;

    // ── Salvar contato: o nome da conversa é um telefone? ──
    try {
      const nome = (nomeDoContato() || '').trim();
      const soDigitos = nome.replace(/[^0-9]/g, '');
      const pareceTelefone = nome && soDigitos.length >= 10 && soDigitos.length >= nome.replace(/\s/g, '').length - 4;
      if (pareceTelefone && !box.querySelector('[data-ac="salvarcontato"]')) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'job-bc-btn job-bc-salvar';
        b.dataset.ac = 'salvarcontato';
        b.title = 'Este número não está salvo. Grava no seu WhatsApp com o nome no padrão do JOB, e sincroniza pro celular.';
        b.innerHTML = _ICO_SALVAR_CONTATO + '<span>Salvar contato</span>';
        box.appendChild(b);
        b.dataset.rot = 'Salvar contato';
        _barraConvLigarSalvar(b);
      }
    } catch (e) { /* checagem é ganho, não requisito */ }

    // ── Transcrever: existe áudio sem transcrição? ──
    try {
      const r = await _pedirPonte('listar_audios', {}, 12000);
      const lista = (r && r.audios) || [];
      // Só os que ainda NÃO temos texto. Oferecer transcrever o que já está
      // transcrito é gastar de novo pelo mesmo resultado.
      const faltam = lista.filter((a) => !TR.cache.has(a.id) || !TR.cache.get(a.id)).length;
      if (faltam > 0 && box.isConnected && !box.querySelector('[data-ac="transcrever"]')) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'job-bc-btn job-bc-bola';
        b.dataset.ac = 'transcrever';
        // O NÚMERO NO RÓTULO É O FREIO. "Transcrever 12 áudios" faz pensar;
        // "Transcrever tudo" não diz o tamanho do que se está pedindo.
        b.title = 'Transcrever ' + faltam + (faltam === 1 ? ' áudio' : ' áudios') +
          ' desta conversa. Demora e consome crédito de transcrição.';
        b.innerHTML = _ICO_TRANSCREVER + '<span>Transcrever ' + faltam + '</span>';
        box.insertBefore(b, box.firstChild);
        b.dataset.rot = 'Transcrever ' + faltam;
        _barraConvLigarTranscrever(box, b);
      }
    } catch (e) { /* sem áudio detectável: o botão simplesmente não aparece */ }
  }

  function _barraConvInjetar() {
    const main = document.querySelector('#main');
    if (!main) return;
    const pe = main.querySelector('footer');
    if (!pe || pe.querySelector('.job-barra-conv')) return;
    // Limpa versões antigas (cabeçalho, fileira de bolas) pra quem estava com
    // a extensão aberta durante a atualização não ficar com as duas.
    main.querySelectorAll('header .job-barra-conv').forEach((e) => e.remove());

    const box = document.createElement('div');
    box.className = 'job-barra-conv job-barra-conv-pe';
    // UM BOTÃO SÓ, e o nome de cada ação aparece quando ele abre.
    //
    // A fileira de bolas resolvia o espaço mas criava outro problema: ícone
    // sozinho não diz o que faz, e ele precisou perguntar. Três ícones mudos
    // ao lado do campo de digitar são três perguntas.
    //
    // Em repouso é um botão discreto com a marca do JOB. Aberto, cada ação tem
    // ícone, NOME e uma linha dizendo o que acontece — inclusive o custo, no
    // caso da transcrição, que é onde a pessoa decide se vale.
    box.innerHTML =
      '<button type="button" class="job-bc-menu-bt" id="job-bc-menu-bt" ' +
        'aria-haspopup="menu" aria-expanded="false" title="Ações do JOB nesta conversa">' +
        logoJobHTML() + '</button>';
    pe.insertBefore(box, pe.firstChild);
    // Barra nova (troca de conversa recria o #main): repinta o pino do que ja
    // se sabe, sem ir na rede de novo.
    try { _bcSinalPintar(); } catch (e) {}
    // MESMO GATILHO: rodape novo e o sinal mais barato que existe de "e uma
    // conversa diferente". A lista de audios desta conversa vem uma vez aqui
    // — nao bloqueia a barra, roda por conta propria.
    try { _trAtualizarIdsDeAudio(); } catch (e) {}

    // ══ O TEMA QUEM DIZ É O PIXEL, NÃO A CLASSE ═══════════════════════
    //
    // O botão vive dentro do rodapé DELES, então quem manda no fundo atrás
    // dele é o tema do WhatsApp. Eu tentei ler a classe `dark` do <html> e a
    // preferência do sistema — os dois são palpite: a classe pode mudar de
    // nome num redesenho deles, e a preferência do sistema não diz nada se a
    // pessoa escolheu tema claro no WhatsApp com o Mac no escuro.
    //
    // O que não erra é MEDIR: pego a cor de fundo real do rodapé, calculo a
    // luminância e decido. Funciona com qualquer marcação, hoje e depois de
    // qualquer redesenho, porque a pergunta que eu faço é a mesma que o olho
    // faz — "esse fundo é claro ou escuro?".
    _bcAplicarTemaDoWhats(box, pe);

    const bt = box.querySelector('#job-bc-menu-bt');
    bt.addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (box._bcMenu && box._bcMenu.isConnected) { _bcMenuFechar(box); return; }
      _bcMenuAbrir(box, bt);
    });
  }

  // Sobe pelos ancestrais até achar quem realmente pinta o fundo: o rodapé
  // costuma ser transparente e herdar de um pai.
  function _corDeFundoReal(el) {
    let n = el;
    for (let i = 0; i < 8 && n; i++) {
      const c = getComputedStyle(n).backgroundColor || '';
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const p = m[1].split(',').map((x) => parseFloat(x));
        const a = p.length > 3 ? p[3] : 1;
        if (a > 0.2) return { r: p[0], g: p[1], b: p[2] };
      }
      n = n.parentElement;
    }
    return null;
  }

  function _bcAplicarTemaDoWhats(box, pe) {
    try {
      const c = _corDeFundoReal(pe) || _corDeFundoReal(document.body);
      if (!c) return;   // não deu pra medir: fica no padrão escuro
      // Luminância percebida (Rec. 709): verde pesa mais que vermelho, e
      // vermelho mais que azul — média simples erraria em fundo azulado, que
      // é justamente o do WhatsApp escuro.
      const lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
      box.classList.toggle('job-bc-claro', lum > 0.5);
      box.classList.toggle('job-bc-escuro', lum <= 0.5);
    } catch (e) { /* medir é ganho, não requisito */ }
  }

  function _bcMenuFechar(box) {
    // Ele mora no body agora, então não dá pra procurar dentro do box.
    const m = box._bcMenu;
    if (!m || !m.isConnected) { box._bcMenu = null; return; }
    m.classList.remove('on');
    const bt = box.querySelector('#job-bc-menu-bt');
    if (bt) bt.setAttribute('aria-expanded', 'false');
    setTimeout(() => { if (m.isConnected) m.remove(); }, 200);
    box._bcMenu = null;
    if (box._bcFora) document.removeEventListener('click', box._bcFora, true);
    if (box._bcEsc) document.removeEventListener('keydown', box._bcEsc, true);
    if (box._bcPos) { window.removeEventListener('resize', box._bcPos); box._bcPos = null; }
  }

  // O menu é MONTADO A CADA ABERTURA, não uma vez e escondido. Assim o que
  // aparece é o estado de agora: quantos áudios faltam, se o contato já foi
  // salvo. Menu montado uma vez mente na segunda conversa.
  async function _bcMenuAbrir(box, bt) {
    // O MENU VAI PRO BODY, NÃO PRA DENTRO DO RODAPÉ.
    //
    // Dentro do rodapé ele simplesmente não aparecia: o WhatsApp recorta o que
    // passa das bordas daquele bloco, e o menu abre PRA CIMA — ou seja, todo
    // ele cai fora do recorte. Ficava aberto no DOM e invisível na tela.
    //
    // No body, com posição fixa calculada a partir do botão, ele escapa de
    // qualquer recorte de qualquer versão do WhatsApp. O preço é recalcular a
    // posição quando a janela muda de tamanho — barato, e feito abaixo.
    const m = document.createElement('div');
    m.className = 'job-bc-menu';
    m.setAttribute('role', 'menu');
    m.innerHTML = '<div class="job-bc-menu-carregando">Vendo o que dá pra fazer aqui…</div>';
    document.body.appendChild(m);
    box._bcMenu = m;

    const posicionar = () => {
      if (!m.isConnected || !bt.isConnected) return;
      const r = bt.getBoundingClientRect();
      m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 348)) + 'px';
      m.style.bottom = Math.max(8, window.innerHeight - r.top + 8) + 'px';
    };
    posicionar();
    box._bcPos = posicionar;
    window.addEventListener('resize', posicionar);
    requestAnimationFrame(() => m.classList.add('on'));
    bt.setAttribute('aria-expanded', 'true');

    box._bcFora = (e) => {
      if (box.contains(e.target)) return;
      if (box._bcMenu && box._bcMenu.contains(e.target)) return;  // clique DENTRO do menu
      _bcMenuFechar(box);
    };
    box._bcEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); _bcMenuFechar(box); } };
    document.addEventListener('click', box._bcFora, true);
    document.addEventListener('keydown', box._bcEsc, true);

    const itens = [];

    let faltam = 0;
    try {
      const r = await _pedirPonte('listar_audios', {}, 12000);
      const lista = (r && r.audios) || [];
      // Só os que ainda NÃO têm texto: oferecer transcrever o que já foi pago
      // é gastar de novo pelo mesmo resultado.
      faltam = lista.filter((a) => !TR.cache.has(a.id) || !TR.cache.get(a.id)).length;
    } catch (e) { faltam = 0; }
    if (faltam > 0) {
      itens.push({ ac: 'transcrever', ico: _ICO_TRANSCREVER,
        rot: 'Transcrever ' + faltam + (faltam === 1 ? ' áudio' : ' áudios'),
        dica: 'Demora e consome crédito de transcrição.' });
    }

    itens.push({ ac: 'copiar', ico: _ICO_COPIAR, rot: 'Copiar conversa',
      dica: 'Texto e áudio transcrito, na ordem, com hora e quem falou.' });

    // Contato salvo tem nome; não salvo aparece como número. Se já tem nome, o
    // botão não teria trabalho a fazer.
    const nomeChat = (nomeDoContato() || '').trim();
    const soDigitos = nomeChat.replace(/[^0-9]/g, '');
    const naoSalvo = nomeChat && soDigitos.length >= 10 &&
      soDigitos.length >= nomeChat.replace(/\s/g, '').length - 4;
    if (naoSalvo) {
      itens.push({ ac: 'salvarcontato', ico: _ICO_SALVAR_CONTATO, rot: 'Salvar contato',
        dica: 'Você confere e edita o nome antes de gravar.', destaque: true });
    } else {
      itens.push({ ac: 'salvarcontato', ico: _ICO_SALVAR_CONTATO, rot: 'Corrigir o nome salvo',
        dica: 'Regrava este contato com o nome no padrão do JOB.' });
    }

    if (!m.isConnected) return;
    m.innerHTML = _bcStatusHTML() + itens.map((i) =>
      '<button type="button" class="job-bc-item' + (i.destaque ? ' destaque' : '') + '" ' +
        'role="menuitem" data-ac="' + i.ac + '">' +
        '<span class="job-bc-item-ico">' + i.ico + '</span>' +
        '<span class="job-bc-item-txt">' +
          '<span class="rot">' + esc(i.rot) + '</span>' +
          '<span class="dica">' + esc(i.dica) + '</span>' +
        '</span></button>').join('');

    const acao = (n) => m.querySelector('[data-ac="' + n + '"]');
    const rot = (b, txt) => { const e = b.querySelector('.rot'); if (e) e.textContent = txt; };

    const bTr = acao('transcrever');
    if (bTr) bTr.addEventListener('click', async () => {
      if (bTr.disabled) return;
      bTr.disabled = true;
      try {
        const pr = await transcreverTudo((x) => {
          rot(bTr, x.rodando ? ('Transcrevendo ' + x.feitos + '/' + x.total) : 'Transcrevendo…');
        });
        if (!pr.erros) {
          rot(bTr, 'Pronto: ' + pr.total);
          setTimeout(() => _bcMenuFechar(box), 2200);
          return;
        }
        // FALHA COM MOTIVO E COM SAÍDA.
        //
        // Antes dizia só "1 falhou(ram)" e fechava o menu. O consultor ficava
        // sabendo que faltou um áudio, sem saber qual, por quê, nem como
        // resolver — e a conversa segue com um buraco na leitura.
        const quantos = pr.erros;
        const sos = pr.falhados.slice();
        const sub = bTr.querySelector('.dica');
        rot(bTr, quantos + ' não transcreveu — tentar de novo');
        if (sub) sub.textContent = pr.motivo || 'Toque para repetir só os que falharam.';
        bTr.disabled = false;
        bTr.addEventListener('click', async function repetir(ev) {
          ev.stopPropagation();
          bTr.removeEventListener('click', repetir);
          bTr.disabled = true;
          const p2 = await transcreverTudo((x) => {
            rot(bTr, 'Tentando ' + x.feitos + '/' + x.total);
          }, sos);
          rot(bTr, p2.erros ? (p2.erros + ' continuam sem transcrever') : 'Pronto');
          if (sub && p2.erros) sub.textContent = p2.motivo || '';
          setTimeout(() => _bcMenuFechar(box), 2600);
        }, { once: false });
      } catch (e) { rot(bTr, 'Não consegui transcrever'); setTimeout(() => _bcMenuFechar(box), 2200); }
    });

    const bCp = acao('copiar');
    if (bCp) bCp.addEventListener('click', async () => {
      if (bCp.disabled) return;
      bCp.disabled = true;
      try {
        const r = await conversaEmTexto();
        if (!r.total) rot(bCp, 'Conversa vazia');
        else {
          await navigator.clipboard.writeText(r.texto);
          rot(bCp, r.semTranscricao
            ? (r.total + ' copiadas · ' + r.semTranscricao + ' sem transcrição')
            : ('Copiado: ' + r.total + ' mensagens'));
        }
      } catch (e) { rot(bCp, 'Não consegui copiar'); }
      setTimeout(() => _bcMenuFechar(box), 1800);
    });

    const bSv = acao('salvarcontato');
    if (bSv) bSv.addEventListener('click', async () => {
      if (bSv.disabled) return;
      bSv.disabled = true;
      try {
        let chat = '';
        try { const c = await _pedirPonte('obter_chat_id', {}, 8000); chat = (c && c.chat_id) || ''; }
        catch (e) { chat = ''; }
        if (!chat) { rot(bSv, 'Abra a conversa'); bSv.disabled = false; return; }
        if (!_ficha || !_ficha.lead) {
          try {
            let tel = '';
            try { tel = (await pedirTelefoneWpp()) || telefoneDoContato(); } catch (e2) { tel = telefoneDoContato(); }
            if (tel) await _carregarFichaSilenciosa({ telefone: tel });
          } catch (e) { /* segue com o nome da tela */ }
        }
        const sugerido = (_ficha && _ficha.lead ? _montarNomeContato() : nomeChat).trim();
        // Fecha o menu ANTES da folha: dois painéis abertos ao mesmo tempo
        // deixam a pessoa sem saber qual está no comando.
        _bcMenuFechar(box);
        const nome = await _folhaSalvarContato(sugerido);
        if (!nome) return;
        const partes = nome.split(/\s+/);
        const primeiro = partes.shift() || nome;
        const sobrenome = partes.join(' ');
        let r = null;
        try { r = await _pedirPonte('salvar_contato', { chatId: chat, nome: primeiro, sobrenome }, 15000); }
        catch (e) { _falhaTecnica('salvar contato (menu)', e); }
        _dizerNoRodape(r && r.ok
          ? 'Contato salvo. Chega no celular na próxima sincronização.'
          : ((r && r.erro) === 'sem_suporte'
              ? 'Este WhatsApp Web não permite salvar por aqui.'
              : 'Não consegui salvar agora. Tente de novo.'));
        if (r && r.erro) _falhaTecnica('salvar contato (menu): ' + r.erro, null);
      } catch (e) { _falhaTecnica('salvar contato (menu)', e); }
    });
  }

  // Aviso curto junto do campo de digitar. A folha já fechou quando a resposta
  // chega, e sem isto ninguém fica sabendo se gravou.
  function _dizerNoRodape(txt) {
    try {
      const box = document.querySelector('.job-barra-conv-pe');
      if (!box) return;
      const velho = box.querySelector('.job-bc-aviso');
      if (velho) velho.remove();
      const d = document.createElement('div');
      d.className = 'job-bc-aviso';
      d.textContent = txt;
      box.appendChild(d);
      requestAnimationFrame(() => d.classList.add('on'));
      setTimeout(() => { d.classList.remove('on'); setTimeout(() => d.remove(), 220); }, 3400);
    } catch (e) { /* aviso nunca pode derrubar nada */ }
  }

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
  const TRTUDO = { rodando: false, feitos: 0, total: 0, erros: 0, pulados: 0,
                   falhados: [], motivo: '' };

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

  // `sos` (opcional): repetir SÓ estes ids, em vez de varrer a conversa toda.
  // É o que transforma "1 falhou(ram)" — que não diz qual nem o quê — em algo
  // que o consultor consegue resolver com um clique.
  async function transcreverTudo(aoAndar, sos) {
    if (TRTUDO.rodando) return TRTUDO;
    let ids;
    if (Array.isArray(sos) && sos.length) {
      ids = sos.slice();
    } else {
      const conv = await _pedirPonte('ler_conversa_completa', { limite: 800 }, 25000);
      ids = (conv && conv.audios) || [];
    }
    Object.assign(TRTUDO, { rodando: true, feitos: 0, total: ids.length, erros: 0,
                            pulados: 0, falhados: [], motivo: '' });
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
          // "Transcrever tudo" numa conversa longa insere em rajada — sem teto
          // aqui, uma única rodada já estoura sozinha o limite.
          _capMap(TR.cache, _TETO_TR, (_v, k) => TR.ocupado.has(k));
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
        if (TR.erro.has(id)) {
          TRTUDO.erros++;
          TRTUDO.falhados.push(id);
          // O MOTIVO DO PRIMEIRO. "1 falhou" manda o consultor abrir chamado;
          // "não consegui baixar o áudio" ele resolve rolando a conversa até a
          // mídia carregar e clicando de novo.
          if (!TRTUDO.motivo) TRTUDO.motivo = TR.erro.get(id) || '';
        }
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

  // Pessoa com um "+": a mesma figura do CRM no trilho, que é onde o consultor
  // já aprendeu que "gente entrando no sistema" tem essa cara.
  const _ICO_SALVAR_CONTATO = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" ' +
    'stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="9.6" cy="7.6" r="3.5"/><path d="M3.4 20a6.2 6.2 0 0 1 12.4 0"/>' +
    '<path d="M19.4 6.6v5.4M16.7 9.3h5.4"/></svg>';

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
    // ── O JUIZ INDEPENDENTE ──────────────────────────────────────────────
    //
    // A conta acima tem um furo que so aparece quando importa: ela pergunta
    // "esta linha e documento?" usando `_docLinhaEhArquivo`, que e A MESMA
    // funcao que desenha o botao. Se o detector para de reconhecer a bolha de
    // PDF — que foi o que aconteceu quando o WhatsApp mudou a pintura da
    // miniatura —, o canario conta ZERO documentos, chama de "ausencia de
    // amostra" e declara tudo certo. Uma verificacao que se mede com a peca
    // quebrada nunca acusa a quebra.
    //
    // Aqui a pergunta vai pra outra fonte: a wa-js, que sabe o TIPO de cada
    // mensagem sem depender de seletor de tela nenhum. Se ela diz que ha tres
    // documentos entre as linhas visiveis e nos desenhamos zero botoes, o
    // problema esta no nosso lado — e o alerta sai sozinho, sem ninguem
    // precisar abrir uma conversa com PDF e reclamar.
    try {
      const conv = await _pedirPonte('ler_conversa_completa', { limite: 150 }, 15000);
      const porHash = {};
      ((conv && conv.mensagens) || []).forEach((m) => { porHash[_trHashDoId(m.msg_id)] = m.tipo || ''; });
      const visiveis = Array.from(linhas).map((r) => r.getAttribute('data-id') || '');
      const TIPO_ARQ = ['document', 'image'];
      const TIPO_AUD = ['ptt', 'audio'];
      let vArq = 0, vAud = 0;
      visiveis.forEach((id) => {
        const tp = porHash[_trHashDoId(id)];
        if (!tp) return;                       // linha que a wa-js nao viu: nao conta
        if (TIPO_ARQ.indexOf(tp) >= 0) vArq++;
        else if (TIPO_AUD.indexOf(tp) >= 0) vAud++;
      });
      const slotsArq = main.querySelectorAll('.job-doc-slot').length;
      const slotsAud = main.querySelectorAll('.job-tr-slot:not(.job-doc-slot)').length;
      // Tolerancia de um: a linha pode ter entrado na tela no meio da medicao.
      if (vArq) {
        out.push({ cap: 'contrato_documento', ok: slotsArq >= vArq - 1, ms: 0,
          detalhe: 'a wa-js ve ' + vArq + ' documento(s)/imagem(ns) nas linhas visiveis e a '
                 + 'extensao desenhou ' + slotsArq + ' bloco(s)'
                 + (slotsArq >= vArq - 1 ? '' : ' — o seletor de bolha de documento parou de casar') });
      }
      if (vAud) {
        out.push({ cap: 'contrato_audio', ok: slotsAud >= vAud - 1, ms: 0,
          detalhe: 'a wa-js ve ' + vAud + ' audio(s) nas linhas visiveis e a extensao desenhou '
                 + slotsAud + ' bloco(s)'
                 + (slotsAud >= vAud - 1 ? '' : ' — o seletor de bolha de audio parou de casar') });
      }
    } catch (e) {
      out.push({ cap: 'contrato_tela', ok: false, ms: 0,
                 detalhe: 'nao consegui perguntar a wa-js: ' + String((e && e.message) || e).slice(0, 90) });
    }

    // Zero bolhas daquele tipo na tela nao e falha — e ausencia de amostra.
    if (arq) out.push({ cap: 'dom_arquivo', ok: arqOk === arq, ms: 0,
                        detalhe: arqOk + ' de ' + arq + ' bolhas de arquivo com o bloco' });
    if (aud) out.push({ cap: 'dom_audio', ok: audOk === aud, ms: 0,
                        detalhe: audOk + ' de ' + aud + ' bolhas de audio com o bloco' });
    return out;
  }

  // ── SAUDE E SINO, NA BARRA DA CONVERSA ────────────────────────────────────
  //
  // "Coloque um validador se esta tudo certo — igual na aba de cotacao do site.
  //  Pode ser algo mais discreto, o usuario nao precisa saber da gambiarra."
  //
  // Entao o repouso e SILENCIO. Etiqueta verde permanente dizendo "tudo certo"
  // e ruido: ninguem le, e quando aparece a vermelha ninguem percebe a
  // diferenca. So aparece bolinha quando ha o que dizer — e o "esta tudo certo"
  // fica dentro do menu, pra quando ele quiser conferir.
  //
  // Nenhum rotulo conta COMO funciona. "Fora do ar" e o que interessa; que o
  // preco vem de uma aba, de uma fila ou de um Dell e problema nosso.
  const _SAUDE = new Map();
  let _sinoNaoLidas = 0;

  function _saudePor(chave, ok, texto) {
    const antes = _SAUDE.get(chave);
    if (antes && antes.ok === ok && antes.texto === texto) return;
    _SAUDE.set(chave, { ok: !!ok, texto: texto || '' });
    _bcSinalPintar();
  }
  function _saudeRuins() {
    const r = [];
    _SAUDE.forEach((v) => { if (!v.ok && v.texto) r.push(v.texto); });
    return r;
  }

  // A bolinha vive no proprio botao do JOB — nao ha espaco pra um segundo
  // botao ao lado do campo de digitar, e um sino solto seria mais um icone
  // mudo que ele ja disse que nao quer.
  function _bcSinalPintar() {
    document.querySelectorAll('.job-bc-menu-bt').forEach((bt) => {
      let p = bt.querySelector('.job-bc-pino');
      const ruins = _saudeRuins().length;
      const n = _sinoNaoLidas;
      if (!ruins && !n) { if (p) p.remove(); return; }
      if (!p) {
        p = document.createElement('span');
        p.className = 'job-bc-pino';
        bt.appendChild(p);
      }
      // Defeito vence aviso: se as duas coisas existem, a que precisa de acao
      // e a que quebrou.
      p.className = 'job-bc-pino' + (ruins ? ' alerta' : ' aviso');
      p.textContent = ruins ? '' : (n > 9 ? '9+' : String(n));
      bt.title = ruins ? _saudeRuins()[0]
                       : (n + (n === 1 ? ' aviso novo do JOB' : ' avisos novos do JOB'));
    });
  }

  async function _sinoBuscar() {
    let r = null;
    try { r = await _safeSendMessage({ type: 'notificacoes' }); } catch (e) { r = null; }
    // Rota ainda fechada pra credencial da extensao: nao inventa numero.
    if (!r || !r.ok) { _sinoNaoLidas = 0; _sinoItens = []; _bcSinalPintar(); return; }
    _sinoNaoLidas = r.nao_lidas || 0;
    _sinoItens = (r.itens || []).slice(0, 6);
    _bcSinalPintar();
  }
  let _sinoItens = [];

  // O bloco de status que abre junto do menu. Uma linha quando esta tudo bem —
  // e a resposta pra "esta funcionando?" sem ele precisar testar cotando.
  function _bcStatusHTML() {
    const ruins = _saudeRuins();
    let h = '<div class="job-bc-status' + (ruins.length ? ' ruim' : '') + '">' +
      '<span class="job-bc-status-p"></span><span>' +
      (ruins.length ? esc(ruins[0]) : 'Tudo certo por aqui') + '</span></div>';
    if (_sinoItens.length) {
      h += '<div class="job-bc-sino">' +
        _sinoItens.map((i) =>
          '<div class="job-bc-sino-i' + (i.lida ? '' : ' nova') + '">' +
            '<b>' + esc(i.titulo || '') + '</b>' +
            (i.descricao ? '<span>' + esc(i.descricao) + '</span>' : '') +
            (i.quando ? '<i>' + esc(i.quando) + '</i>' : '') +
          '</div>').join('') +
        '</div>';
    }
    return h;
  }

  // ELE NAO PODE SER O DETECTOR DE DEFEITO.
  //
  // "Voce precisa saber quando algo nao esta funcionando, sem eu precisar te
  // avisar." Ele tem razao, e o canario ja sabia — so que contava pro servidor
  // e pro console, dois lugares onde ele nunca esta. Quem descobria que o
  // "Ler documento" tinha sumido continuava sendo ele, abrindo a conversa.
  //
  // Aqui a checagem passa a falar NO LUGAR onde o defeito aparece: a conversa.
  // A pergunta e feita pra wa-js, que sabe o tipo de cada mensagem sem depender
  // de seletor de tela — ela ve tres documentos, nos desenhamos zero, o
  // problema e nosso e a barra diz isso com essas palavras.
  //
  // Uma vez por conversa aberta. Nao e para ficar perguntando: o custo e uma
  // chamada a ponte, e repetir a cada rolagem gastaria por nada.
  const _CONF_JA = new Set();
  async function _conferirBlocosDaConversa() {
    const main = document.querySelector('#main');
    if (!main) return;
    const linhas = main.querySelectorAll('[data-id]');
    if (!linhas.length) return;
    const marca = (linhas[linhas.length - 1].getAttribute('data-id') || '') + ':' + linhas.length;
    if (_CONF_JA.has(marca)) return;
    _CONF_JA.add(marca);
    if (_CONF_JA.size > 40) _CONF_JA.clear();
    let quebrou = null;
    try {
      const conv = await _pedirPonte('ler_conversa_completa', { limite: 150 }, 15000);
      const porHash = {};
      ((conv && conv.mensagens) || []).forEach((m) => { porHash[_trHashDoId(m.msg_id)] = m.tipo || ''; });
      let vArq = 0, vAud = 0;
      Array.from(linhas).forEach((r) => {
        const tp = porHash[_trHashDoId(r.getAttribute('data-id') || '')];
        if (!tp) return;
        if (tp === 'document' || tp === 'image') vArq++;
        else if (tp === 'ptt' || tp === 'audio') vAud++;
      });
      // CONTAR BLOCO NAO E CONTAR BOTAO.
      //
      // Isto contava `.job-doc-slot` — e no dia 10/08 havia TRES na tela, todos
      // vazios, porque `docRenderSlot` estourava antes de escrever o botao. A
      // verificacao disse "Tudo certo por aqui" com o defeito na cara.
      //
      // E a mesma armadilha do canario de ontem, um nivel mais fundo: eu troquei
      // "o seletor achou?" por "o bloco existe?", quando a pergunta que importa
      // e "o botao esta la?". So conta bloco com filho dentro.
      const cheio = (sel) => Array.prototype.filter.call(
        main.querySelectorAll(sel), (e) => ((e.shadowRoot || e).children.length > 0)).length;
      const sArq = cheio('.job-doc-slot');
      const sAud = cheio('.job-tr-slot:not(.job-doc-slot)');
      // Tolerancia de um: linha pode ter entrado na tela no meio da medicao.
      if (vArq && sArq < vArq - 1) {
        quebrou = 'Vejo ' + vArq + (vArq === 1 ? ' documento' : ' documentos') +
                  ' nesta conversa e não consegui pôr o botão de ler em ' +
                  (sArq ? 'todos' : 'nenhum') + '. O defeito é meu, não seu.';
      } else if (vAud && sAud < vAud - 1) {
        quebrou = 'Vejo ' + vAud + (vAud === 1 ? ' áudio' : ' áudios') +
                  ' nesta conversa e não consegui pôr o botão de transcrever em ' +
                  (sAud ? 'todos' : 'nenhum') + '. O defeito é meu, não seu.';
      }
    } catch (e) { return; }               // sem a wa-js nao da pra julgar: cala
    _saudePor('blocos', !quebrou, quebrou || '');
    if (!quebrou) return;
    _docAvisoQuebra(quebrou);
    // E avisa o JOB junto, pra aparecer em Configuracoes sem ele reclamar.
    try { canarioRodar('bloco faltando na conversa'); } catch (e) {}
  }

  // O aviso mora na barra da conversa, com saida: "Tentar de novo" forca uma
  // passada nova do injetor. As vezes resolve — a bolha pode ter entrado na
  // tela depois. Quando nao resolve, o texto fica, e e a prova de que o
  // problema existe e nao e impressao dele.
  function _docAvisoQuebra(texto) {
    const barra = document.querySelector('.job-barra-conv');
    if (!barra) return;
    let a = barra.querySelector('.job-bc-quebra');
    if (!a) {
      a = document.createElement('div');
      a.className = 'job-bc-quebra';
      barra.insertBefore(a, barra.firstChild);
    }
    a.innerHTML = '<span class="job-bc-quebra-t"></span>' +
      '<button type="button" class="job-bc-quebra-b">Tentar de novo</button>';
    a.querySelector('.job-bc-quebra-t').textContent = texto;
    a.querySelector('.job-bc-quebra-b').addEventListener('click', (ev) => {
      ev.stopPropagation();
      const b = ev.currentTarget;
      b.disabled = true; b.textContent = 'Conferindo…';
      try { trInjetar(); } catch (e) {}
      setTimeout(() => {
        _CONF_JA.clear();
        a.remove();
        _conferirBlocosDaConversa();
      }, 900);
    });
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
    _registrarTimeout(() => { canarioRodar('na abertura'); }, 40000);
    // De 6 em 6 horas. Nao e monitoramento de segundo a segundo — e detectar
    // uma atualizacao do WhatsApp no mesmo dia, em vez de na semana seguinte.
    _registrarLoop(setInterval(_soComAbaVisivel(() => {
      canarioRodar('rodada periodica');
    }), 6 * 60 * 60 * 1000));
  }

  function trIniciar() {
    _registrarTimeout(() => {
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
      const obs = _observar(new MutationObserver((regs) => {
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
      }));
      obs.observe(main, { childList: true, subtree: true });
      // Troca de conversa troca o #main inteiro: reobserva sem drama.
      // Ronda so pra reatar o observer quando a CONVERSA troca (#main e
      // recriado). Nao varre mais a conversa inteira a cada 4s: se nada mudou,
      // nao ha o que injetar, e o observer avisa quando muda.
      _registrarLoop(setInterval(() => {
        if (document.hidden) return;
        const m = document.querySelector('#main');
        if (m && !m._jobTrObservado) {
          m._jobTrObservado = true;
          obs.observe(m, { childList: true, subtree: true });
          trInjetar();               // varredura cheia UMA vez, na troca de conversa
          // E, cinco segundos depois, confere se o que a wa-js ve tem bloco na
          // tela. Cinco e nao zero: o injetor acabou de rodar e as bolhas ainda
          // estao entrando. Perguntar cedo demais acusaria quebra em conversa
          // que esta so carregando — alarme falso ensina a ignorar alarme.
          _registrarTimeout(() => {
            try { _conferirBlocosDaConversa(); } catch (e) {}
          }, 5000);
        }
      }, 4000));
      try { canarioIniciar(); } catch (e) { /* canario nao pode derrubar a extensao */ }
      // O SINO. Dois minutos e o intervalo do sino do site — mesma fonte,
      // mesmo ritmo, pra nao existir "o site ja avisou e a extensao nao".
      try {
        _sinoBuscar();
        _registrarLoop(setInterval(_soComAbaVisivel(() => { _sinoBuscar(); }), 2 * 60 * 1000));
      } catch (e) { /* sem sino a extensao segue igual */ }
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
      Math.round(p.puladas / total * 100) + '% das linhas puladas' +
      // A FATIA DA GEOMETRIA. Sem separar, "340ms de pior caso" nao diz o que
      // consertar — e reescrever a peca errada custa mais que nao mexer.
      (p.geoN
        ? ' · <b>' + Math.round(p.geo) + 'ms procurando a bolha</b> (' +
          Math.round(p.geo / (p.ms || 1) * 100) + '% do total, em ' + p.geoN + ' linhas)'
        : ' · geometria ainda não medida') +
      '</div>';
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

  // Quantas cópias da biblioteca do WhatsApp estão na página.
  //
  // Existe porque eu mesmo empilhei cópias: a reinjeção automática mandava o
  // `wa-js.vendor.js` (492 KB) de novo a cada recarga da extensão, e mandar
  // mensagem foi ficando lento. Corrigido — mas o número fica na tela, porque
  // sem ele "está lento" volta a ser palpite.
  //
  // A página só é limpa de verdade com F5: cópia já injetada não se desfaz.
  function _copiasWpp() {
    try { return (window.__JOB_WPP_COPIAS != null) ? window.__JOB_WPP_COPIAS : '?'; }
    catch (e) { return '?'; }
  }

  async function abrirSecaoDev() {
    setCorpoSecao(_telaCarregando('Coletando estado…'));
    // Estado da fila de cotacao: quando o worker subiu e o que a ultima batida
    // devolveu. Sem isto, "o sinal esta NULL" e um beco sem saida — nao da pra
    // saber se a batida nem sai, se sai sem credencial, ou se o servidor
    // recusa. Cada uma dessas hipoteses custou uma rodada de tentativa e erro.
    const sw = await _safeStorageGet(['swSubiuEm', 'swTemAlarme', 'swVersao',
                                      'batidaEm', 'batidaPainel', 'batidaResposta']);
    const ponte = await _pedirPonte('listar_audios', {}, 12000);
    const temWpp = !(ponte && ponte.erro === 'wpp_ausente');
    const d = TR.diag || {};
    const linha = (rot, val, ruim) =>
      '<div class="job-dev-linha' + (ruim ? ' ruim' : '') + '"><span>' + esc(rot) +
      '</span><b>' + esc(val) + '</b></div>';
    setCorpoSecao(
      _secHead('Diagnóstico', 'Estado real de cada peça, agora.') +
      '<div class="job-dev">' +
        linha('Versão da extensão', (chrome.runtime.getManifest() || {}).version || '?') +
        linha('Ponte wa-js', temWpp ? 'respondendo' : 'FORA (' + ((ponte && ponte.erro) || 'sem resposta') + ')', !temWpp) +
        linha('Conversa aberta', (ponte && ponte.chat_id) ? ponte.chat_id : 'nenhuma', !(ponte && ponte.chat_id)) +
        linha('Áudios na conversa', String((ponte && ponte.audios && ponte.audios.length) || 0)) +
        linha('Transcrições em memória', String(TR.cache.size)) +
        // MEMORIA DA ABA. "Codigo de erro 5" no Chrome e o renderizador
        // morrendo, e a causa mais comum e memoria. Sem numero, "foi a
        // extensao?" e opiniao — a minha inclusive. O teto que o Chrome da a
        // uma aba costuma ficar perto de 4 GB; chegando la, ela morre com essa
        // tela e sem log nenhum.
        (function () {
          const m = (window.performance && window.performance.memory) || null;
          if (!m) return '';
          const mb = (v) => Math.round((v || 0) / 1048576) + ' MB';
          const uso = m.usedJSHeapSize || 0, teto = m.jsHeapSizeLimit || 0;
          const perto = teto && uso > teto * 0.75;
          return linha('Memória desta aba', mb(uso) + ' de ' + mb(teto) +
                       (perto ? ' — perto do teto, dê F5' : ''), !!perto);
        })() +
        linha('Botões injetados', String(document.querySelectorAll('.job-tr-slot').length)) +
        // Mais de 1 cópia = a página acumulou biblioteca e o envio fica lento.
        // Marcado como ruim de propósito: é acionável (F5 resolve).
        linha('Cópias da ponte wa-js', String(_copiasWpp()) + (_copiasWpp() > 1 ? ' — dê F5 nesta aba' : ''),
              _copiasWpp() > 1) +
        linha('Última etapa', String(d.etapa || '—') + (d.quando ? ' · ' + d.quando : ''),
              d.etapa === 'ponte_fora') +
        (TR.erro.size ? linha('Último erro', Array.from(TR.erro.values()).slice(-1)[0], true) : '') +
        '<div id="job-dev-tempos"></div>' +
        (function () {
          const q = (t) => t ? new Date(t).toLocaleTimeString('pt-BR') : '—';
          const semAlarme = sw.swTemAlarme === false;
          // Sem batida ha mais de 3 min o servidor ja considera a maquina
          // morta — e a fila para de aceitar pedido de quem nao tem Painel.
          const velha = sw.batidaEm && (Date.now() - new Date(sw.batidaEm).getTime() > 180000);
          return linha('Motor da extensão', 'subiu ' + q(sw.swSubiuEm) +
                       ' · v' + (sw.swVersao || '?') +
                       (semAlarme ? ' · SEM RELÓGIO (permissão alarms)' : ''), semAlarme) +
                 linha('Sinal de vida', (sw.batidaEm ? q(sw.batidaEm) : 'nunca bateu') +
                       ' · ' + (sw.batidaResposta || '—') +
                       (sw.batidaPainel ? ' · Painel aberto' : ' · sem Painel aqui'),
                       !sw.batidaEm || !!velha);
        })() +
        linha('Varredura (motivo)', VAR.motivo || '—') +
        linha('Varredura', VAR.rodando ? 'rodando agora'
              : (VAR.ultimaRodada ? 'última: ' + new Date(VAR.ultimaRodada).toLocaleTimeString('pt-BR') : 'ainda não rodou')) +
        linha('Varredura (placar)', VAR.placar.analisadas + ' analisadas · ' +
              VAR.placar.puladas + ' puladas · ' + VAR.placar.erros + ' erros') +
        '<div class="job-dev-btns">' +
          '<button class="job-cnpj-btn" id="dev-transcrever">Transcrever esta conversa agora</button>' +
          '<button class="job-cnpj-btn" id="dev-varrer">Rodar a varredura agora</button>' +
          '<button class="job-cnpj-btn" id="dev-repintar">Repintar etiquetas</button>' +
          '<button class="job-cnpj-btn" id="dev-bruto">Copiar dados brutos dos planos</button>' +
          '<button class="job-cnpj-btn" id="dev-bolha">Copiar como a bolha está montada</button>' +
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
    // OS DADOS CRUS, DO JEITO QUE O PAINEL MANDOU.
    //
    // Hoje eu descubro que um campo existe do pior jeito: alguem repara que a
    // tela do Painel mostra "73 Hospitais" e a nossa nao, e ai eu adivinho o
    // nome do campo. Adivinhei duas vezes e errei as duas — "Ambulatorial"
    // virou "Apartamento" e a coparticipacao virou palavra minha.
    //
    // Isto acaba com o chute: copia a resposta INTEIRA de um plano, sem
    // recorte nenhum, do jeito que a resposta deles chegou. O que aparece aqui
    // e o que existe. O que nao aparece, nao existe — e ai a conversa e com a
    // Trindade, nao comigo.
    //
    // Nao vai preco nem nome de cliente: sao os planos da tela de escolha,
    // antes de qualquer cotacao. Mesmo assim a saida e o texto cru, entao ela
    // fica no diagnostico e nao num botao que qualquer um encosta.
    // COMO A BOLHA ESTA MONTADA — so a estrutura, nenhum texto.
    //
    // "Ta dando problema na bolha" com um print e o maximo que eu consigo ver:
    // que esta torta. Qual elemento o bloco pegou, e se aquele elemento tem
    // altura fixa ou corta o que passa dele, so o DOM responde — e adivinhar
    // isso ja me custou duas correcoes erradas hoje.
    //
    // Copia TAG, CLASSE e a geometria de cada nivel das bolhas de arquivo.
    // NENHUM texto de mensagem, nenhum src, nenhum nome, nenhum telefone: essa
    // e a diferenca entre um diagnostico e um vazamento de conversa de
    // cliente. O que interessa aqui e a forma, nao o conteudo.
    btn('dev-bolha', 'bolha', async () => {
      const linhas = document.querySelectorAll('#main [data-id]');
      const achados = [];
      for (const row of linhas) {
        if (!_docLinhaEhArquivo(row) && !row.querySelector('.job-doc-slot')) continue;
        const cam = [];
        let el = row.querySelector('.job-doc-slot') || _docAncora(row);
        // Sobe ate a linha desenhando a arvore de fora pra dentro.
        while (el && el !== row && cam.length < 9) {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          cam.unshift({
            tag: el.tagName.toLowerCase(),
            classe: String(el.className || '').slice(0, 90),
            l: Math.round(r.width) + 'x' + Math.round(r.height),
            overflow: cs.overflow, altura: cs.height, aspecto: cs.aspectRatio,
            pos: cs.position, display: cs.display,
          });
          el = el.parentElement;
        }
        achados.push({
          temSlot: !!row.querySelector('.job-doc-slot'),
          slotSolto: !!row.querySelector('.job-doc-slot.job-doc-solto'),
          slotVazio: !!(row.querySelector('.job-doc-slot') || {}).children
                     && !(row.querySelector('.job-doc-slot').children.length),
          caminho: cam,
        });
        if (achados.length >= 4) break;
      }
      if (!achados.length) return 'Nenhuma bolha de arquivo nesta conversa. Abra a conversa onde a bolha está torta e clique de novo.';
      const txt = JSON.stringify({ versao: (chrome.runtime.getManifest() || {}).version, bolhas: achados }, null, 2);
      try { await navigator.clipboard.writeText(txt); } catch (e) {
        return 'Nao consegui copiar: ' + ((e && e.message) || e);
      }
      return 'Copiado: ' + achados.length + ' bolha(s), so estrutura — nenhum texto de mensagem. Cole aqui na conversa.';
    });
    btn('dev-bruto', 'bruto', async () => {
      const pls = (_cot && _cot.planos) || [];
      if (!pls.length) {
        return 'Nenhum plano carregado. Abra Cotar agora, escolha cidade e ' +
               'operadora ate a lista de planos aparecer, e clique aqui de novo.';
      }
      const txt = JSON.stringify({
        operadora: (_cot.operadoraAtual || {}).nome || '',
        cidade: _cot.cidade || '', modalidade: _cot.modalidade || '',
        quantos: pls.length, planos: pls,
      }, null, 2);
      try { await navigator.clipboard.writeText(txt); } catch (e) {
        return 'Nao consegui copiar (' + ((e && e.message) || e) + '). ' +
               'Tamanho: ' + txt.length + ' caracteres.';
      }
      return 'Copiado: ' + pls.length + ' plano(s) da ' +
             ((_cot.operadoraAtual || {}).nome || 'operadora') +
             ', ' + txt.length + ' caracteres. Cole aqui na conversa.';
    });

    // TEMPO DAS IDAS AO JOB. Mediana e PIOR caso, nunca média: dez chamadas de
    // 200ms e uma de 9s dão média de 1s, que não descreve nem uma nem outra —
    // e é a de 9s que trava o consultor.
    try {
      const t = await _safeSendMessage({ type: 'tempos' });
      const cx = document.getElementById('job-dev-tempos');
      if (cx && t && t.ok && t.rotas && t.rotas.length) {
        cx.innerHTML = '<div class="job-dev-sub">Últimas ' + t.amostras +
          ' chamadas ao JOB (mediana · p95 · pior)</div>' +
          t.rotas.slice(0, 8).map((r) =>
            '<div class="job-dev-linha' + (r.pior > 4000 ? ' ruim' : '') + '">' +
            '<span>' + esc(r.rota.replace('/api/whatsapp/', '')) + ' <i>×' + r.n + '</i></span>' +
            '<b>' + r.mediana + 'ms · ' + (r.p95 == null ? '—' : r.p95 + 'ms') +
            ' · ' + r.pior + 'ms</b></div>').join('');
      } else if (cx) {
        cx.innerHTML = '<div class="job-dev-sub">Nenhuma chamada ao JOB ainda nesta sessão.</div>';
      }
    } catch (e) { /* diagnóstico não pode derrubar o diagnóstico */ }

  }

  // ═══════════════ GATE ÚNICO PRA QUEM MEXE NA WA-JS ═══════════════
  //
  // Existem TRÊS rotinas de fundo que tocam o WhatsApp por conta própria:
  // mandar da fila de envio (checarFilaDeEnvio), a varredura diária automática
  // (varreduraRodar) e a varredura em fila do painel do CRM (filaVarreduraTick).
  // Cada uma sozinha já tenta ser leve — uma conversa por vez, com pausa. O
  // problema é que elas não sabiam UMA DA OUTRA: nada impedia a varredura
  // automática de disparar no meio de uma varredura em fila, ou o envio de
  // acontecer junto com as duas. Três rotinas mexendo no WhatsApp Web AO MESMO
  // TEMPO, na MESMA aba — que já é pesada sozinha —, é o tipo de carga que
  // trava a aba ou derruba a conexão. Isso é diferente de mandar mensagem
  // rápido demais (que o servidor já regula em _WA_FILA_GATE_*): aqui o
  // problema é volume de trabalho simultâneo, não velocidade de envio.
  //
  // Por isso este gate: quem quiser tocar a wa-js tenta pegar; se outra rotina
  // já está com ele, desiste dessa vez e tenta de novo daqui a pouco — nunca
  // duas ao mesmo tempo.
  const _JOB_GATE = { ocupado: false, por: '' };
  function _jobGateTentar(quem) {
    if (_JOB_GATE.ocupado) return false;
    _JOB_GATE.ocupado = true;
    _JOB_GATE.por = quem;
    return true;
  }
  function _jobGateSoltar() {
    _JOB_GATE.ocupado = false;
    _JOB_GATE.por = '';
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
    // Não marca ultimaRodada antes de conseguir o gate: se outra rotina está
    // usando o WhatsApp agora, esta tentativa não conta como "rodou" — o
    // próximo tick (em minutos, não em INTERVALO_MS inteiro) tenta de novo.
    if (!_jobGateTentar('varredura_auto')) return VAR.placar;
    VAR.rodando = true;
    VAR.ultimaRodada = Date.now();
    let leiturasNestaRodada = 0;
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
        } finally {
          // Mesmo uma leitura que termina em erro pode ter feito a wa-js
          // carregar histórico. Conta a tentativa para a válvula de RAM; o
          // reload só acontece entre rodadas e com a aba fora de foco.
          leiturasNestaRodada += 1;
        }
        await new Promise((r) => setTimeout(r, VAR.PAUSA_ENTRE_MS));
      }
    } finally {
      VAR.rodando = false;
      _jobGateSoltar();
    }
    // A válvula existia apenas na fila manual. A varredura automática também
    // lê histórico pela mesma wa-js e, portanto, precisa da mesma proteção.
    // Não liga a varredura: ela continua obedecendo `pode_rodar` no servidor.
    if (leiturasNestaRodada) {
      _lidosNestaSessao += leiturasNestaRodada;
      await _talvezRecarregarPraLiberarRam();
    }
    return VAR.placar;
  }

  async function varreduraUmaConversa(alvo, meta) {
    // O TETO MUDA COM A MARCA D'ÁGUA. Pedir a conversa por chatId faz a wa-js
    // CARREGAR aquele tanto de mensagens na memória do WhatsApp Web — e ela
    // não devolve depois; é assim que o cliente deles funciona (confirmado
    // lendo _mensagensDoChat: conversa fechada só mantém em memória o que já
    // carregou). Com marca d'água (leitura de novo, o caso comum numa fila
    // grande) 120 é folga de sobra pro que chegou de novo; sem ela (primeira
    // vez que este chat é lido) mantém 400, porque aí é a única chance de
    // pegar o histórico. Não é micro-otimização: é o que evita que ler uma
    // fila de 70+ leads acumule o histórico inteiro de todos eles na aba.
    const teto = alvo.desde_msg_id ? 120 : 400;
    const conv = await _pedirPonte('ler_conversa_de',
      { chatId: alvo.chat_id, desdeMsgId: alvo.desde_msg_id, limite: teto }, 60000);
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

    // 3) MODO ECONÔMICO: sem imagem e sem PDF. É onde o custo mora, e o que
    //    preenche o CRM sai da conversa falada.
    const { usuarioId } = await _safeStorageGet(['usuarioId']);

    // NENHUM BASE64 SOBREVIVE AO SEU LOTE — NEM AQUI, NEM NO SERVICE WORKER.
    //
    // Prova do crash, renderer do WhatsApp em 11/08/2026 21:05:59:
    //   v8-oom-lo-space-size 2588.41MB de 4096, "ran out of reservation".
    // Large Object Space e onde STRING GRANDE mora, e base64 de audio e
    // exatamente isso.
    //
    // O codigo original baixava em lotes de 3 mas guardava tudo num objeto
    // `baixados` consumido so no fim: o lote limitava CONCORRENCIA, nao
    // MEMORIA. Ao terminar a conversa, todos os base64 dela estavam vivos ao
    // mesmo tempo, mais o clone estruturado e mais o JSON.stringify.
    //
    // A 4.79 tentou resolver mandando lote a lote pro service worker. Nao
    // resolveu: so mudou o acumulo de processo — o SW juntava tudo em
    // `_partesAnalise` e serializava no fim. Trocar o lugar do problema nao e
    // conserto.
    //
    // Agora cada lote e TRANSCRITO na hora. O servidor grava a transcricao no
    // cache por msg_id (e ainda dedupe por filehash), entao o lote pode ser
    // solto imediatamente e a analise do fim leva SO OS IDS. Depois de cada
    // volta deste laco, nao existe base64 vivo em lugar nenhum.
    const _pausa = (ms) => new Promise((res) => setTimeout(res, ms));
    for (let i = 0; i < semCache.length; i += 3) {
      const ids = semCache.slice(i, i + 3);
      let r = null;
      let lote = [];
      let pendentes = [];
      // Comeca supondo que nenhum id foi resolvido. Cada transcricao com texto
      // tira o proprio id daqui; o que sobrar no finally e falha de VERDADE —
      // inclui download ausente, resposta parcial e provedor que devolveu vazio.
      const semTexto = new Set(ids);
      try {
        // Lotes pequenos: baixar 30 audios de uma vez e o que trava a maquina.
        r = await _pedirPonte('baixar_audios_ids', { ids }, 90000);
        lote = (r && Array.isArray(r.audios)) ? r.audios : [];
        if (!lote.length) continue;
        // Uma tentativa a mais so pro lote: antes, audio que nao transcrevia
        // aqui ainda tinha uma segunda chance porque o base64 seguia junto pra
        // analise. Agora nao segue — entao a chance extra vem aqui, e continua
        // custando um lote de memoria, nao a conversa inteira.
        let tr = await _safeSendMessage({ type: 'transcrever_audios', audios: lote }).catch(() => null);
        const marcarResolvidos = (resp) => {
          const textos = (resp && resp.ok && resp.transcricoes) || {};
          for (const a of lote) {
            const mid = a && a.msg_id;
            if (mid && String(textos[mid] || '').trim()) semTexto.delete(mid);
          }
        };
        marcarResolvidos(tr);
        // `ok:true` significa que a ROTA respondeu, nao que cada audio ganhou
        // texto: o servidor representa falha individual por `transcricoes[id]
        // === ''`. Retenta somente os que continuaram vazios.
        pendentes = lote.filter((a) => a && semTexto.has(a.msg_id));
        if (pendentes.length) {
          await _pausa(800);
          tr = await _safeSendMessage({ type: 'transcrever_audios', audios: pendentes }).catch(() => null);
          marcarResolvidos(tr);
        }
      } catch (e) { /* o Set conserva os ids que nao foram resolvidos */ }
      finally {
        // Solta as referencias ANTES da pausa: e nesta janela ociosa que o
        // coletor tem chance de recolher os base64 deste lote.
        pendentes.length = 0;
        lote.length = 0;
        try { if (r && Array.isArray(r.audios)) r.audios.length = 0; } catch (e2) {}
        r = null;
      }
      await _pausa(1200);
    }

    // 3) MODO ECONOMICO: sem imagem e sem PDF. E onde o custo mora, e o que
    //    preenche o CRM sai da conversa falada.
    //
    // O payload leva TODOS os audios da conversa, sempre so com o id — os que
    // ja tinham cache e os que acabaram de ser transcritos acima. O servidor
    // resolve o texto pelo msg_id. Audio cujo lote falhou vai sem texto, que e
    // o mesmo que acontecia antes quando o download falhava.
    const payloadAudios = audios.map((a) => ({ msg_id: a.msg_id, de: a.de, hora: a.hora }));
    const resp = await _safeSendMessage({
      type: 'analisar_varredura',
      payload: {
        economico: true,
        chat_id: alvo.chat_id,
        telefone: meta.telefone || '',
        nome: meta.nome || '',
        lead_id: meta.lead_id || null,
        // De ONDE veio esta leitura, pra o custo ter procedencia no painel.
        origem: meta.origem || 'varredura',
        // E DE ONDE VEIO A DECISAO DE LER — que e outra coisa.
        //
        // O servidor usa isto pra decidir se cria lead no CRM. Analise que o
        // consultor pediu significa que ele ja decidiu que aquilo e lead;
        // varredura nao significa nada disso — ela le TODA conversa que teve
        // mensagem, e era por isso que fornecedor, contador e o tecnico do
        // ar-condicionado viravam lead e enchiam a tela de auditoria.
        //
        // Sem este campo a regra nova nao surte efeito nenhum: o padrao do
        // servidor e 'manual', pra extensao antiga nao mudar de comportamento.
        origem_analise: 'varredura',
        lote_id: meta.lote_id || null,
        usuario_id: usuarioId || null,
        mensagens: conv.mensagens || [],
        audios: payloadAudios,
        // Reusa o contrato que o servidor ja mostra no resultado: ele compara
        // quantos existiam com quantos ids encontraram texto no cache. Campo
        // novo e ignorado esconderia a falha em vez de explica-la.
        audios_encontrados: audios.length,
        ultima_msg_id: conv.ultima_msg_id || meta.ultima_msg_id || '',
        ultima_msg_em: meta.ultima_msg_em || 0,
      },
    });
    if (!resp || !resp.ok) throw new Error((resp && resp.erro) || 'falha_analise');
    return resp;
  }

  // ── O @lid se liga sozinho, uma vez por dia ──────────────────────────────
  //
  // Isto era só um botão, e botão depende de alguém lembrar. O resultado
  // aparecia no CRM como "@lid falta vincular" na maioria dos cards — dos 70
  // leads de julho de uma consultora, UM tinha conversa ligada. E sem o
  // vínculo, nada mais funciona direito: o card não mostra a conversa, a
  // varredura por leads não alcança ninguém, e a mesma pessoa vira dois leads
  // porque o sistema não reconhece que já a conhece.
  //
  // Não usa IA e não cria nem altera lead: lista as conversas e pergunta ao
  // servidor de quem é cada uma. O custo é uma listagem local e alguns POSTs.
  // Por isso pode rodar sozinho — o que era caro (analisar) continua sendo
  // decisão de quem manda, na tela de varredura.
  const _SINC_CADA_MS = 24 * 60 * 60 * 1000;
  let _sincLidReagendada = false;

  async function _sincLidAuto() {
    try {
      const { usuarioId } = await _safeStorageGet(['usuarioId']);
      // Sem consultor escolhido no popup não dá pra saber de quem é o WhatsApp
      // — e ligar conversa ao lead errado é pior que não ligar.
      if (!usuarioId) return;
      const chave = 'job_sinc_lid_em';
      const guardado = await _safeStorageGet([chave]);
      const ultimo = Number(guardado[chave] || 0);
      if (Date.now() - ultimo < _SINC_CADA_MS) return;

      // Esta leitura percorre até 2.000 conversas. Ela não pode disputar a
      // mesma wa-js com envio ou varredura: além de pesar, concorrência aqui
      // deixa o cliente do WhatsApp reter histórico desnecessariamente.
      if (!_jobGateTentar('sinc_lid_auto')) {
        if (!_sincLidReagendada) {
          _sincLidReagendada = true;
          _registrarTimeout(() => {
            _sincLidReagendada = false;
            _sincLidAuto();
          }, 5 * 60 * 1000);
        }
        return;
      }

      try {
        const r = await _pedirPonte('listar_todas_conversas', { teto: 2000 }, 60000);
        const convs = (r && r.conversas) || [];
        if (!convs.length) return;
        let ligados = 0;
        for (let i = 0; i < convs.length; i += 200) {
          const resp = await _safeSendMessage({ type: 'vincular_chats',
                                                conversas: convs.slice(i, i + 200) }).catch(() => null);
          if (resp && resp.ok) ligados += resp.ligados || 0;
          // Respiro entre lotes: são POSTs grandes, e não há pressa nenhuma aqui.
          await new Promise((x) => setTimeout(x, 1500));
        }
        // Marca DEPOIS de terminar: se cair no meio, tenta de novo na próxima
        // abertura em vez de esperar 24h com o trabalho pela metade.
        try { await chrome.storage.local.set({ [chave]: Date.now() }); } catch (e) {}
        if (ligados) console.log('[JOB] @lid: ' + ligados + ' conversa(s) ligadas ao lead.');
      } finally {
        _jobGateSoltar();
      }
    } catch (e) { /* silencioso de proposito: e manutencao, nao tarefa do consultor */ }
  }

  function varreduraIniciar() {
    // 4 minutos pra primeira checagem e 5 em 5 depois. A checagem em si é um GET
    // de config; se estiver desligada (o padrão), o custo é isso e mais nada.
    _registrarTimeout(_soComAbaVisivel(() => { varreduraRodar(false); }), 240000);
    _registrarLoop(setInterval(_soComAbaVisivel(() => { varreduraRodar(false); }), 5 * 60 * 1000));
    // O vínculo roda ANTES da varredura (90s), porque a varredura por leads
    // depende dele. E fora do horário comercial também: ligar identidade não
    // incomoda ninguém e não gasta IA.
    _registrarTimeout(_soComAbaVisivel(() => { _sincLidAuto(); }), 90000);
    _registrarLoop(setInterval(_soComAbaVisivel(() => { _sincLidAuto(); }), 6 * 60 * 60 * 1000));
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
    setCorpoSecao(_telaCarregando('Abrindo a ficha do lead…'));
    let tel = '';
    try { tel = (await pedirTelefoneWpp()) || telefoneDoContato(); } catch (e) { tel = telefoneDoContato(); }
    if (!tel) {
      setCorpoSecao(_secHead('CRM', 'Ficha do lead: etapa, etiquetas, qualificação e atividade.') +
        '<div class="job-sem-analise">' +
          '<div class="job-sem-analise-t">Nenhuma conversa aberta</div>' +
          '<div class="job-sem-analise-txt">A ficha é de quem está na tela. Abra a conversa do cliente e volte aqui.</div>' +
        '</div>');
      return;
    }
    _fichaTel = tel;
    await _carregarFicha({ telefone: tel });
  }

  // Busca a ficha SEM desenhar nada. O `_carregarFicha` pinta a tela do CRM —
  // chamar ele de outra seção jogaria a ficha por cima da tela onde a pessoa
  // está. Aqui só enche `_ficha`, pra quem quiser desenhar um resumo.
  async function _carregarFichaSilenciosa(alvo) {
    let resp;
    try { resp = await _safeSendMessage(Object.assign({ type: 'ficha_lead', chat_id: _chatAberto }, alvo)); }
    catch (e) { resp = null; }
    if (!resp || !resp.ok) return false;
    _ficha = resp;
    _fichaIgnorada = !!resp.ignorada;
    if (alvo && alvo.telefone) _fichaTel = alvo.telefone;
    _trilhoPontosDoCache();
    return true;
  }

  async function _carregarFicha(alvo) {
    let resp;
    try { resp = await _safeSendMessage(Object.assign({ type: 'ficha_lead', chat_id: _chatAberto }, alvo)); } catch (e) { resp = null; }
    if (!resp || !resp.ok) {
      setCorpoSecao(_secHead('CRM', 'Ficha do lead: etapa, etiquetas, qualificação e atividade.') +
        _telaFalha('Não consegui abrir a ficha',
          'Pode ser a conexão ou o JOB fora do ar por um instante. Os dados do lead continuam salvos.',
          'job-ficha-retry', 'Tentar de novo'));
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
    _fichaIgnorada = !!resp.ignorada;
    _trilhoPontosDoCache();
    if (!resp.existe) { _renderFichaSemLead(); return; }
    _renderFicha('dados');
  }

  function _renderFichaSemLead() {
    setCorpoSecao(
      _secHead('CRM', 'Ficha do lead: etapa, etiquetas, qualificação e atividade.') +
      '<div class="job-ficha">' +
        '<div class="job-sem-analise-t" style="text-align:left">Este número não está no CRM</div>' +
        '<div class="job-sec-sub">Cadastre pra ter etapa, etiquetas e qualificação aqui dentro — ou marque como pessoal, se não for cliente.</div>' +
        '<button class="job-cnpj-btn" id="job-ficha-criar">Cadastrar este lead</button>' +
        // AQUI É ONDE ELE MAIS FAZ FALTA, e era exatamente onde faltava: eu
        // tinha posto o "Não é lead" só no rodapé da FICHA, que só existe
        // quando já há lead. Na conversa que NÃO é lead — o caso do amigo, do
        // fornecedor, do colega — a tela era só "Cadastrar", como se a única
        // resposta possível fosse sim. As duas respostas moram juntas agora.
        (_fichaIgnorada
          ? '<div class="job-nao-lead marcada">Marcada como pessoal — o JOB não lê esta conversa.' +
            '<button type="button" id="job-desmarcar">desfazer</button></div>'
          : '<button class="job-nao-lead" id="job-nao-lead" ' +
            'title="Marca esta conversa como pessoal: o JOB nunca lê nem cria lead dela.">' +
            'Não é lead — parar de ler esta conversa</button>') +
        '<div class="job-sinc-dica" id="job-ficha-aviso"></div>' +
      '</div>');
    const b = document.getElementById('job-ficha-criar');
    if (b) b.addEventListener('click', () => abrirSecaoNovoLead());
    _ligarNaoLead({});
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


  // ══ SALVAR O CONTATO NO CELULAR ═══════════════════════════════════════
  //
  // Antes eram DOIS botões principais lado a lado — "Copiar nome" e "Baixar
  // contato (.vcf)" — sem hierarquia, e o caminho que eles ofereciam não
  // levava a lugar nenhum: o .vcf caía na pasta de downloads do COMPUTADOR, e
  // a dica mandava o consultor se virar com AirDrop, e-mail ou Drive pra levar
  // até o telefone. Ninguém faz isso no meio de um atendimento.
  //
  // Agora o botão FAZ a coisa: usa a mesma ação do "Adicionar contato" do
  // WhatsApp Web, com sincronização pra agenda ligada. Grava na conta e o
  // WhatsApp leva pro aparelho — sem arquivo, e sem pedir autorização de
  // conta Google ou Apple, que exigiria o consultor autorizar acesso à agenda
  // dele e é um projeto inteiro, não um botão.
  //
  // Sobrou UM secundário: copiar o nome. Ele é a saída pra quando a versão do
  // WhatsApp Web não tiver a função — aí o consultor cola no "Novo contato"
  // do próprio WhatsApp.
  function _blocoNomeContato() {
    return '<div class="job-nomec">' +
      '<div class="job-nomec-tit">Salvar contato' +
        '<span class="job-nomec-i" title="Monta o nome no mesmo padrão sempre, pra você achar o contato pela busca do WhatsApp e entender a lista de relance. Nada é salvo sozinho: você edita e escolhe o que fazer.">i</span>' +
      '</div>' +
      // O CHIP MOSTRA O VALOR, NÃO A CATEGORIA.
      //
      // Eles diziam só "Origem", "Operadora", "Cidade" — o consultor via cinco
      // pílulas com nome de categoria e não tinha como saber o que cada uma
      // acrescenta ao nome. A pergunta que ele fez foi literalmente "qual é a
      // função desses botões?", e a resposta certa não é um texto de ajuda: é
      // o chip dizer "Origem · RH" e ele ver o RH aparecer no nome ao ligar.
      //
      // Sem valor no lead, o chip fica desligado e diz o que falta — em vez de
      // ser um botão que liga e não muda nada, que parece defeito.
      '<div class="job-nomec-sub">Toque pra somar ao nome</div>' +
      '<div class="job-nomec-chips">' +
        _PARTES_NOME.map((p) => {
          const val = _pedacoDaFicha(p.id);
          const on = _partesLigadas[p.id] && val;
          return '<button type="button" class="job-nomec-chip' + (on ? ' on' : '') +
            (val ? '' : ' vazio') + '" data-parte="' + p.id + '"' + (val ? '' : ' disabled') +
            ' title="' + (val ? p.rot + ': ' + esc(val) : 'Este lead não tem ' + p.rot.toLowerCase() + ' preenchido no CRM') + '">' +
            '<span class="cat">' + p.rot + '</span>' +
            (val ? '<span class="val">' + esc(val) + '</span>' : '<span class="val vazio">—</span>') +
            '</button>';
        }).join('') +
      '</div>' +
      // O NOME INTEIRO TEM QUE CABER. Era um input de uma linha: com etapa,
      // origem e operadora ligadas o nome passa de 40 caracteres e sumia no
      // meio da palavra — e é justamente ele que a pessoa veio conferir.
      // Textarea que cresce mostra tudo, e continua editável.
      '<textarea class="job-campo job-nomec-val" id="job-nomec-val" rows="2" ' +
        'aria-label="Nome que vai pra agenda" placeholder="Nome do contato"></textarea>' +
      // UMA ação principal, e ela FAZ a coisa — não prepara pra você fazer.
      '<button type="button" class="job-cnpj-btn" id="job-nomec-salvar">Salvar na agenda</button>' +
      '<div class="job-nomec-btns">' +
        '<button type="button" class="job-copy" id="job-nomec-copiar">Copiar nome</button>' +
      '</div>' +
      '<div class="job-nomec-dica" id="job-nomec-dica">Grava no seu WhatsApp e ele sincroniza ' +
        'pro celular — sem baixar arquivo nenhum.</div>' +
    '</div>';
  }

  // O campo cresce com o texto: nome de 60 caracteres não pode depender de a
  // pessoa arrastar a barra de rolagem pra conferir o fim.
  function _autoAltura(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }

  function _ligarNomeContato() {
    const inp = document.getElementById('job-nomec-val');
    if (!inp) return;
    inp.addEventListener('input', () => _autoAltura(inp));
    const dica = (t) => { const e = document.getElementById('job-nomec-dica'); if (e) e.textContent = t; };
    inp.value = _montarNomeContato();
    _autoAltura(inp);
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
        _autoAltura(inp);
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
    // SALVAR DE VERDADE, não preparar pra você salvar.
    //
    // Usa a mesma ação do "Adicionar contato" do WhatsApp Web, com
    // sincronização pra agenda ligada: grava na conta e o WhatsApp leva pro
    // aparelho. Sem arquivo, sem AirDrop, sem autorizar Google nem Apple.
    const bs = document.getElementById('job-nomec-salvar');
    if (bs) bs.addEventListener('click', async () => {
      const nome = inp.value.trim();
      if (!nome) { dica('Escreva um nome antes.'); inp.focus(); return; }
      // O contato é o da CONVERSA ABERTA — é dela que sai o id que o WhatsApp
      // entende. Sem conversa aberta não há o que salvar.
      const alvo = _chatAberto || '';
      if (!alvo) { dica('Abra a conversa deste lead antes de salvar.'); return; }
      bs.disabled = true; const r0 = bs.textContent; bs.textContent = 'Salvando…';
      // Primeira palavra vira nome, o resto sobrenome: é assim que a agenda
      // do celular ordena, e nome inteiro num campo só vira lista desordenada.
      const partes = nome.split(/\s+/);
      const primeiro = partes.shift() || nome;
      const sobrenome = partes.join(' ');
      let r = null;
      try { r = await _pedirPonte('salvar_contato', { chatId: alvo, nome: primeiro, sobrenome }, 15000); }
      catch (e) { _falhaTecnica('salvar contato', e); }
      if (r && r.ok) {
        bs.textContent = 'Salvo na agenda';
        dica('Pronto. Já está no seu WhatsApp e chega no celular na próxima sincronização.');
        setTimeout(() => { bs.textContent = r0; bs.disabled = false; }, 2600);
        return;
      }
      bs.textContent = r0; bs.disabled = false;
      // Erro que diz o que fazer. 'sem_suporte' é o caso real de um WhatsApp
      // Web mais velho que a função — e aí o consultor precisa saber que o
      // caminho existe, só não por aqui.
      dica((r && r.erro) === 'sem_suporte'
        ? 'Este WhatsApp Web não permite salvar por aqui. Use "Copiar nome" e adicione pelo próprio WhatsApp.'
        : 'Não consegui salvar agora. Tente de novo; se insistir, use "Copiar nome".');
      if (r && r.erro) _falhaTecnica('salvar contato: ' + r.erro, null);
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
  _registrarLoop(setInterval(_soComAbaVisivel(_tickCronFicha), 1000));

  let _chatAberto = '';
  // Se a conversa aberta ja foi marcada como pessoal. Vem do servidor com a
  // ficha — o botao precisa dizer 'ja esta marcada', nao se oferecer de novo.
  let _fichaIgnorada = false;

  function _blocoVinculoChat(f, l) {
    const chats = (f && f.wa_chats) || [];
    const atual = _chatAberto || '';
    const jaTem = atual && chats.indexOf(atual) >= 0;
    const curto = atual ? (atual.split('@')[0].slice(0, 18) + (atual.split('@')[0].length > 18 ? '…' : '')) : '';
    const eLid = atual.indexOf('@lid') > 0;
    if (jaTem) {
      // ERA UMA FAIXA MORTA. O identificador é a informação mais importante
      // desta tela — é ele que amarra a conversa ao lead — e estava impresso
      // como um número solto de 15 dígitos, sem hierarquia e sem servir pra
      // nada. Agora a linha inteira é o atalho pro lead no CRM do JOB: quem
      // olha o vínculo é justamente quem quer abrir a ficha completa.
      // DESTINOS DIFERENTES, DE PROPÓSITO. O vínculo leva à FICHA do lead
      // (/lead/<id>), que é a página com tudo dele; o "Abrir no JOB" do rodapé
      // leva ao QUADRO do CRM. Mandar os dois pro mesmo lugar era ter dois
      // botões fazendo a mesma coisa em telas diferentes.
      const lid = (l && l.id) ? (_SITE_BASE_URL_EXT + '/lead/' + l.id) : '';
      const dentro =
        '<span class="job-vinc-tag ' + (eLid ? 'lid' : 'num') + '">' + (eLid ? '@lid' : 'nº') + '</span>' +
        '<span class="job-vinc-id">' + esc(curto) + '</span>' +
        '<span class="job-vinc-txt">vinculada' + (l && l.nome ? ' a ' + esc(l.nome) : ' a este lead') + '</span>' +
        (lid ? '<span class="job-vinc-seta">' + _svgIco('chevron', 13) + '</span>' : '');
      return lid
        ? '<a class="job-vinc ok clicavel" href="' + esc(lid) + '" target="_blank" rel="noopener" ' +
          'title="Abrir a ficha completa deste lead no JOB">' + dentro + '</a>'
        : '<div class="job-vinc ok">' + dentro + '</div>';
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
    // DESFAZER TEM QUE EXISTIR. Marcar errado e facil (o cliente que manda do
    // numero pessoal), e sem volta o consultor perde o lead sem entender.
    const d = document.getElementById('job-desmarcar');
    if (d) d.addEventListener('click', async () => {
      d.disabled = true; d.textContent = 'desfazendo…';
      let tel = '';
      try { tel = (await pedirTelefoneWpp()) || telefoneDoContato(); } catch (e) { tel = telefoneDoContato(); }
      const r = await _safeSendMessage({ type: 'ignorar_conversa', chat_id: _chatAberto,
                                         telefone: tel, desmarcar: true }).catch(() => null);
      if (r && r.ok) { _fichaIgnorada = false; _bloqCache = { chave: '', bloqueado: false }; abrirSecaoFicha(); }
      else { d.disabled = false; d.textContent = 'desfazer'; }
    });
    const b = document.getElementById('job-nao-lead');
    if (!b) return;
    b.addEventListener('click', async () => {
      const nome = nomeDoContato() || 'esta conversa';
      if (!await _confirmar({
        titulo: 'Marcar ' + nome + ' como não é lead?',
        texto: 'O JOB para de ler esta conversa e nunca mais cria lead dela. '
             + 'Serve pra amigo, família, fornecedor — quem não é cliente.\n\n'
             + 'Dá pra desfazer no JOB, em Leads excluídos.',
        ok: 'Marcar como pessoal', perigo: true })) return;
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
          // Vale na hora: sem isto o cache antigo deixaria a barra aberta
          // até a conversa trocar.
          _bloqCache = { chave: '', bloqueado: false };
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
      // O nome saiu do topo porque agora vive no cabeçalho da seção: aparecia
      // duas vezes, uma embaixo da outra, quando os dois passaram a existir.
      _secHead('CRM', (l.nome || _fichaTel || 'Ficha do lead')) +
      '<div class="job-ficha">' +
        '<div class="job-ficha-topo">' +
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
          // SALVAR NASCE DESLIGADO. Ele ficava aceso o tempo todo, convidando a
          // gravar uma ficha em que nada mudou — escrita à toa no banco e uma
          // ação que não faz nada, que é o pior tipo de botão. Só acende
          // quando existe alteração; o texto diz o estado em vez de mandar.
          '<button class="job-cnpj-btn" id="job-ficha-salvar" disabled>Nada para salvar</button>' +
          // NAO E LEAD. O consultor fala com amigo, familia e fornecedor no
          // mesmo WhatsApp, e cada analise virava um card no CRM. O botao mora
          // ao lado do Salvar porque e a mesma decisao, invertida: "isto entra"
          // ou "isto nunca entra". Discreto de proposito — e acao rara, mas tem
          // que estar onde a pessoa ja esta olhando quando percebe o engano.
          (_fichaIgnorada
            ? '<div class="job-nao-lead marcada">Marcada como pessoal<button type="button" id="job-desmarcar">desfazer</button></div>'
            // O rótulo tinha uma frase inteira dentro, e o botão ocupava a
            // largura toda por causa dela — parecia a ação principal do
            // rodapé, sendo a mais rara. Duas palavras bastam: a folha de
            // confirmação já explica o que acontece, e explicar duas vezes
            // não deixa mais claro, deixa mais pesado.
            : '<button class="job-nao-lead" id="job-nao-lead" ' +
              'title="Marca esta conversa como pessoal: o JOB para de ler e nunca mais cria lead dela.">' +
              'Não é lead</button>') +
          // ABRIR NO JOB SOBE PRO RODAPE. Ele existia, mas como link discreto
          // DEPOIS do bloco 'Nome do contato' — que e longo — entao vivia fora
          // da vista: pra achar era preciso rolar ate o fim de uma coluna
          // estreita. Aqui fica junto do Salvar, que e onde a mao ja esta.
          '<a class="job-ficha-abrir" id="job-ficha-abrir-crm" href="#" target="_blank" rel="noopener">' +
            'Ver no CRM</a>' +
          '<span class="job-ficha-aviso" id="job-ficha-aviso"></span>' +
        '</div>' +
        (aba === 'dados' ? _blocoNomeContato() : '') +
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
      // O RELÓGIO NÃO PODE DEPENDER DO SUB-STATUS. Ele só aparecia com um
      // sub-status escolhido — e é exatamente no lead SEM sub-status que
      // saber há quanto tempo ele está parado importa mais. O CRM do site
      // mostra sempre; aqui passa a mostrar também, dizendo o que conta.
      '<div class="job-ficha-campo"><label>Sub-status <span class="job-ficha-dica">o que falta pra avançar</span>' +
        ((f.saude && f.saude.desde_ts)
          ? '<span class="job-ficha-cron" id="job-cron-ss" data-desde="' + f.saude.desde_ts + '" ' +
            'title="Tempo parado ' + (l.sub_status ? 'neste sub-status' : 'nesta etapa') + '">' +
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
    return html || '<div class="job-notas-vazio">Nenhum campo extra configurado para este funil. Quem configura é o admin, em Campos, no site.</div>';
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
    // SUJO LIGA O SALVAR. Uma função só, chamada de qualquer campo, pra não
    // existir um caminho que altera a ficha e esquece de acender o botão.
    const _marcarSujo = () => {
      _fichaSujo = true;
      const s = document.getElementById('job-ficha-salvar');
      if (s && s.disabled) { s.disabled = false; s.textContent = 'Salvar no JOB'; }
    };
    document.querySelectorAll('.job-ficha [data-ficha], .job-ficha [data-campo], .job-ficha [data-etq]').forEach((el) => {
      el.addEventListener('input', _marcarSujo);
      el.addEventListener('change', _marcarSujo);
    });
    // A ficha pode nascer suja: quem troca de aba com alteração pendente volta
    // e o botão tem que continuar aceso.
    if (_fichaSujo) {
      const s0 = document.getElementById('job-ficha-salvar');
      if (s0) { s0.disabled = false; s0.textContent = 'Salvar no JOB'; }
    }
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
  const _ICO_FILA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3.3" y="4.9" width="17.4" height="16.1" rx="2.8"/><path d="M3.3 9.7h17.4"/><path d="M8.1 2.9v3.6M15.9 2.9v3.6"/><path d="M8.9 14.9l2.2 2.2 4.1-4.4"/></svg>';

  let _fila = [];

  // A TELA "HOJE" ESCREVIA NUM ELEMENTO QUE NÃO EXISTE.
  //
  // Ela buscava `job-painel-corpo` — id que aparecia uma única vez no arquivo
  // inteiro, sobra de um painel que deixou de existir. `p` vinha null, a
  // função saía na segunda linha e a seção abria em branco, sempre, sem erro
  // nenhum no console. O corpo do painel é `job-painel-doc-corpo`, que é o que
  // o setCorpoSecao já usa nas outras dez telas.
  const _FILA_SUB = 'O que o JOB diz pra atacar agora, com o motivo de cada um.';

  async function abrirSecaoFila() {
    setCorpoSecao(_secHead('Hoje', _FILA_SUB) + _telaCarregando('Montando sua fila…'));
    const r = await _safeSendMessage({ type: 'fila_hoje' }).catch(() => null);
    if (_secaoAtiva !== 'fila') return;
    if (!r || !r.ok) {
      setCorpoSecao(_secHead('Hoje', _FILA_SUB) + _telaFalha(
        'Não consegui montar a fila',
        'Pode ser a conexão ou o JOB fora do ar por um instante. Tente de novo.',
        'job-fila-retry', 'Tentar de novo'));
      const b = document.getElementById('job-fila-retry');
      if (b) b.addEventListener('click', abrirSecaoFila);
      return;
    }
    _fila = r.fila || [];
    _filaBadge(r.resumo || {});
    if (!_fila.length) {
      // ESTADO VAZIO QUE DIZ SE É BOM OU RUIM. "Nada na fila de hoje" sozinho
      // deixava a dúvida: está tudo em dia ou não carregou?
      setCorpoSecao(_secHead('Hoje', _FILA_SUB) +
        '<div class="job-sem-analise">' +
          '<div class="job-sem-analise-t">Você está em dia</div>' +
          '<div class="job-sem-analise-txt">Nada atrasado e nada marcado pra hoje. ' +
            'Quando entrar lead novo ou uma cotação ficar parada, aparece aqui sozinho.</div>' +
        '</div>');
      return;
    }
    const res = r.resumo || {};
    setCorpoSecao(
      _secHead('Hoje', _FILA_SUB, _fila.length) +
      '<div class="job-fila-cab">' +
        (res.atrasadas ? '<b class="job-fila-atraso">' + res.atrasadas + ' atrasada(s)</b> · ' : '') +
        (res.hoje || 0) + ' para hoje</div>' +
      _fila.map((t) => _filaItem(t)).join(''));
    document.querySelectorAll('#job-painel-doc-corpo [data-fila]').forEach((b) => {
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
  // ── Cotações do cliente, dentro da conversa ────────────────────────────
  //
  // O ganho aqui não é "ter cotação na extensão". É NÃO SAIR DA CONVERSA:
  // hoje o cliente pergunta "e aquele orçamento?" e o consultor troca de aba,
  // abre o JOB, procura na lista, copia o link e volta. Cada troca de aba no
  // meio de um atendimento é uma chance de perder o cliente.
  //
  // Esta é a metade que NÃO depende da base local de preço estar cheia: mostra
  // o que já existe, não cota nada. Cotar aqui dentro vem depois.
  let _cotCache = { chave: '', dados: null };

  // Valor ausente devolve vazio, NUNCA "R$ 0,00" — Number(null) é 0, e zero
  // afirma "esta cotação não vale nada". Esse defeito já mostrou R$ 84.015,41
  // como R$ 0,00 na tela do JOB (commit 004b4ad); aqui é na frente do cliente.
  function _cotMoeda(v) {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    if (!isFinite(n)) return '';
    return 'R$ ' + n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function _cotQuando(dias) {
    if (typeof dias !== 'number' || !isFinite(dias) || dias < 0) return '';
    if (dias === 0) return 'hoje';
    if (dias === 1) return 'ontem';
    if (dias < 30) return 'há ' + dias + ' dias';
    if (dias < 60) return 'há 1 mês';
    return 'há ' + Math.floor(dias / 30) + ' meses';
  }

  // Quem chega pelo botão "Cotar" da análise já disse o que quer: cotar. Este
  // sinal pula a lista de cotações antigas e abre o formulário direto, com as
  // idades que a análise já extraiu da conversa.
  let _cotDireto = false;

  async function abrirSecaoCotacao() {
    if (_cotDireto) { _cotDireto = false; abrirSecaoCotarInline(); return; }
    setCorpoSecao(_telaCarregando('Procurando as cotações deste cliente…'));
    let tel = '';
    try { tel = (await pedirTelefoneWpp()) || telefoneDoContato(); } catch (e) { tel = telefoneDoContato(); }
    tel = String(tel || '').replace(/\D/g, '');
    if (!tel) {
      // Isto não é AVISO, é estado da tela: usar o ladrilho amarelo aqui fazia
      // parecer que algo deu errado, quando só falta abrir uma conversa.
      setCorpoSecao(_secHead('Cotações', _COT_SUB) + _vazio(
        'Nenhuma conversa aberta',
        'As cotações são de quem está na tela. Abra a conversa do cliente e volte aqui.'));
      return;
    }
    // O cache é por telefone e só dura enquanto o painel está aberto: o
    // consultor abre a seção várias vezes na mesma conversa, e não faz sentido
    // bater no servidor a cada uma. Trocou de conversa, a chave muda sozinha.
    let resp = (_cotCache.chave === tel) ? _cotCache.dados : null;
    if (!resp) {
      try { resp = await _safeSendMessage({ type: 'cotacoes_do_lead', telefone: tel }); }
      catch (e) { resp = null; }
      if (resp && resp.ok) { _cotCache = { chave: tel, dados: resp }; _trilhoPontosDoCache(); }
    }
    // Falha NÃO é lista vazia. Lista vazia afirma "nunca cotamos pra este
    // cliente"; falha afirma "não consegui saber". A primeira, dita errada,
    // vira um consultor dizendo ao cliente que nunca cotou — quando cotou.
    if (!resp || !resp.ok) {
      setCorpoSecao(_secHead('Cotações', _COT_SUB) + _telaFalha(
        'Não consegui carregar as cotações',
        'Isso não quer dizer que não existam — só que não consegui perguntar agora.',
        'job-cot-retry', 'Tentar de novo'));
      const br = document.getElementById('job-cot-retry');
      if (br) br.addEventListener('click', () => { _cotCache = { chave: '', dados: null }; abrirSecaoCotacao(); });
      return;
    }
    _cotPintar(resp, tel);
  }

  // O LINK PRO JOB LEVA O QUE JÁ SE SABE.
  //
  // Abria /cotacao/novo praticamente em branco: o consultor preenchia cidade,
  // tipo e idades AQUI, clicava em "abrir no JOB" e digitava tudo de novo lá.
  // Agora vai o lead (a tela abre já ligada, e sem lead a cotação não sai), o
  // nome e o telefone do cliente — que servem de rede quando o lead não casa —
  // e o que ele já respondeu no painel.
  //
  // `cidade` vai junto, mas a rota ainda não lê esse parâmetro: enquanto ela
  // não ler, a tela cai na cidade padrão do consultor. Está no contrato.
  function _cotLinkJob(resp) {
    const q = [];
    const põe = (k, v) => { if (v) q.push(k + '=' + encodeURIComponent(v)); };
    const L = resp || _cotLead || {};
    põe('lead', L.lead_id || L.id);
    põe('cliente_nome', L.lead_nome || L.nome || nomeDoContato());
    põe('cliente_telefone', L.telefone || telefoneDoContato());
    if (_cot) {
      põe('cidade', _cot.cidade);
      põe('modalidade', _cotRotulo(_cot.modalidade));
      // Vidas: por faixa quando ele contou por faixa, por idade quando digitou.
      // Mandar as duas deixaria a tela do JOB escolher, e ela soma o que achar
      // primeiro — cotação com o dobro de gente.
      if (_cot.faixas) {
        _COT_FAIXAS.forEach((f, i) => { põe('fx_' + i, _cot.faixas[f]); });
      } else {
        põe('idades', _cot.idades);
      }
    }
    return _SITE_BASE_URL_EXT + '/cotacao/novo' + (q.length ? '?' + q.join('&') : '');
  }

  var _COT_SUB = 'Cotações deste cliente: mandar o link, copiar e cotar de novo.';

  function _cotPintar(resp, tel) {
    // Guarda o lead da conversa: salvar a cotação exige vínculo, e é aqui
    // que ele já veio resolvido pelo servidor.
    _cotLead = { id: resp.lead_id || 0, nome: resp.lead_nome || '', telefone: tel || '' };
    const lista = resp.cotacoes || [];
    const nome = resp.lead_nome || nomeDoContato() || 'este cliente';
    const linkNovo = _cotLinkJob(resp);

    let corpo;
    if (!lista.length) {
      // Vazio com saída. Dizer só "nenhuma cotação" deixa o consultor parado
      // com o cliente esperando do outro lado.
      corpo = _vazio('Nenhuma cotação para este cliente',
        'Cotação salva aqui vira um link com apresentação, imagem e PDF pra mandar na conversa.'
        + (resp.lead_id ? '' : ' Este número ainda não é um lead do CRM, e sem lead a cotação não é salva.'));
    } else {
      // O título salvo começa com o nome do cliente ("Beatriz · Campinas - SP ·
      // Adesão"), mas o nome já está no cabeçalho e é o mesmo em todos os
      // cartões. Repetido três vezes, ele empurra pra segunda linha justamente
      // o que diferencia uma cotação da outra. Corta só quando bate mesmo.
      const semNome = (t) => {
        const s = String(t || '');
        const corte = s.indexOf(' · ');
        if (corte > 0 && nome && s.slice(0, corte).trim() === String(nome).trim()) {
          return s.slice(corte + 3);
        }
        return s;
      };
      corpo = lista.map((c) => {
        const partes = [];
        if (c.planos_cotados) partes.push(c.planos_cotados + (c.planos_cotados === 1 ? ' plano' : ' planos'));
        if (c.total) partes.push(_cotMoeda(c.total));
        return '<div class="job-cot-item">' +
            '<div class="job-cot-item-topo">' +
              '<div class="job-cot-item-t">' + esc(semNome(c.titulo) || 'Cotação #' + c.id) + '</div>' +
              (_cotQuando(c.dias) ? '<span class="job-cot-item-q">' + esc(_cotQuando(c.dias)) + '</span>' : '') +
            '</div>' +
            (partes.length ? '<div class="job-cot-item-s">' + esc(partes.join(' · ')) + '</div>' : '') +
            (c.url
              ? '<div class="job-cot-item-acoes">' +
                  // AS DUAS SAO SECUNDARIAS DE PROPOSITO. Cada cartao do
                  // historico tinha um botao verde cheio igual ao "Cotar
                  // agora" — tres verdes iguais na mesma tela, e o unico que
                  // ele quase sempre quer some no meio. Verde cheio agora so
                  // existe uma vez aqui.
                  '<button class="job-cot-bt-copiar forte" data-url="' + esc(c.url) + '">Mandar na conversa</button>' +
                  '<button class="job-cot-bt-copiar" data-url="' + esc(c.url) + '">Copiar link</button>' +
                '</div>'
              // Sem token não existe link público. Dizer o motivo evita o
              // consultor procurar um botão que nunca vai aparecer.
              : '<div class="job-cot-item-s job-cot-sem-link">Sem link público — abra no JOB para gerar.</div>') +
          '</div>';
      }).join('');
    }

    setCorpoSecao(
      // O cabeçalho vira o mesmo das outras dez telas: título fixo, subtítulo
      // dizendo DE QUEM são as cotações, e o total no contador — que era texto
      // corrido no subtítulo e agora tem lugar próprio.
      _secHead('Cotações', nome, lista.length || '') +
      '<div class="job-cot-wrap">' +
        // A ACAO EM CIMA, O HISTORICO EMBAIXO.
        //
        // Estava ao contrario: primeiro a pilha de cotacoes velhas, e o "Cotar
        // agora" so aparecia depois de rolar tudo. Nove em cada dez vezes que
        // ele abre esta aba e pra cotar de novo, nao pra reler o que ja fez —
        // e o historico crescendo empurrava o botao pra fora da tela.
        //
        // E ele e o UNICO verde cheio da tela agora. Antes cada cartao do
        // historico tinha um igual, entao "em evidencia" nao queria dizer
        // nada.
        '<button class="job-cot-bt-mandar job-cot-agora" id="job-cot-agora">' +
          'Cotar agora' +
        '</button>' +
        '<div class="job-cot-agora-s">Preço buscado na hora. O comparativo sai aqui mesmo, ' +
          'com imagem pronta pra mandar.</div>' +
        (lista.length
          ? '<div class="job-cot-hist-t">Já cotadas para ' + esc(nome) +
              '<span class="job-cot-hist-n">' + lista.length + '</span></div>'
          : '') +
        corpo +
        // O link pro JOB continua existindo porque a tela de la compara vinte
        // planos de uma vez, o que nao cabe num painel de conversa — mas e a
        // excecao, e por isso e um atalho no rodape.
        '<a class="job-cot-nova job-cot-nova-atalho" href="' + esc(linkNovo) + '" ' +
          'target="_blank" rel="noopener" title="Abre a tela de cotação do site, com o lead já ligado">' +
          'Comparar operadoras no JOB' +
        '</a>' +
      '</div>');
    const ba = document.getElementById('job-cot-agora');
    if (ba) ba.addEventListener('click', abrirSecaoCotarInline);

    document.querySelectorAll('.job-cot-bt-copiar').forEach((b) => {
      b.addEventListener('click', () => {
        navigator.clipboard.writeText(b.dataset.url || '').then(() => {
          const antes = b.textContent;
          b.textContent = 'Copiado';
          setTimeout(() => { b.textContent = antes; }, 1500);
        });
      });
    });
    document.querySelectorAll('.job-cot-bt-mandar').forEach((b) => {
      b.addEventListener('click', () => _cotMandar(b));
    });
  }

  // Manda o link na conversa aberta pelo mesmo caminho dos outros envios da
  // extensão (enviar_direto), pra a mensagem entrar no histórico do lead no
  // CRM igual às outras — e não como um texto solto que ninguém registrou.
  async function _cotMandar(btn) {
    const url = btn.dataset.url || '';
    if (!url) return;
    const antes = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Enviando…';
    const { usuarioId } = await _safeStorageGet(['usuarioId']);
    if (!usuarioId) {
      btn.textContent = 'Escolha seu usuário no popup';
      btn.disabled = false;
      setTimeout(() => { btn.textContent = antes; }, 2600);
      return;
    }
    let nome = nomeDoContato();
    let chatId = '';
    try { chatId = await pedirChatId(); } catch (e) { chatId = ''; }
    let telefone = await garantirTelefone(nome, chatId);
    nome = nomeMaisConfiavel(nome);
    if (!chatId && !telefone) {
      btn.textContent = 'Não identifiquei a conversa';
      btn.disabled = false;
      setTimeout(() => { btn.textContent = antes; }, 2600);
      return;
    }
    if (_foiRepetido(chatId || telefone, midiaTipo || 'texto', texto, modeloId)) {
      if (st) st.textContent = 'Esta mesma mensagem já foi enviada a este contato há pouco. O JOB bloqueou a repetição.';
      btn.disabled = false;
      return;
    }
    try {
      const payload = { telefone, nome, texto: url, usuario_id: usuarioId };
      if (chatId) payload.chat_id = chatId;
      const r = await chrome.runtime.sendMessage({ type: 'enviar_direto', payload });
      if (r && r.ok) {
        btn.textContent = 'Enviado';
        setTimeout(() => { btn.textContent = antes; btn.disabled = false; }, 2000);
      } else {
        btn.textContent = 'Falhou — tentar de novo';
        btn.disabled = false;
      }
    } catch (e) {
      btn.textContent = 'Falhou — tentar de novo';
      btn.disabled = false;
    }
  }

  // ── Cotar dentro da conversa, sem abrir aba ───────────────────────────
  //
  // QUEM MARCA O RITMO É ESTA ABA, e isso não é detalhe de estilo.
  //
  // O motor (cotador-painel.js) roda na aba do Painel do Corretor, que fica em
  // SEGUNDO PLANO enquanto o consultor olha o WhatsApp. O Chrome estrangula
  // temporizador de aba escondida: as pausas de 300–900ms viravam até um minuto
  // cada, e o que era pra levar dez segundos levava quinze minutos. Por isso o
  // motor expõe "um passo por vez, sem relógio lá dentro" e a pausa acontece
  // aqui, na aba visível, onde o relógio funciona. O espaçamento irregular que
  // o servidor deles vê continua exatamente o mesmo.
  const _COT_FAIXAS = ['00-18', '19-23', '24-28', '29-33', '34-38',
                       '39-43', '44-48', '49-53', '54-58', '59-199'];
  // Teto baixo de propósito. Na tela do JOB o consultor compara 20 planos com
  // calma; aqui ele está com o cliente digitando do outro lado. Cada preço é
  // uma ida ao Painel com pausa humana no meio — 6 é o que cabe numa conversa.
  const _COT_MAX = 6;

  // ── A COMPOSICAO DA COTACAO, ANTES DE COTAR ───────────────────────────────
  //
  // Pedido do Guilherme: "ao selecionar um produto antes de cotar, deve ficar
  // claro o que selecionei, porque se eu for cotar outra coisa eu preciso ter
  // a referencia da composicao da cotacao, antes mesmo de cotar."
  //
  // Ate agora a marcacao morria na tela da operadora: ir pra proxima limpava
  // tudo, e a unica memoria era o comparativo — que so existe DEPOIS de cotar.
  // Ele montava uma proposta de tres operadoras sem nunca ver a proposta
  // inteira antes de pedir preco.
  //
  // A sacola atravessa operadoras e as duas fontes. O teto de 6 passou a ser
  // dela, nao da tela: seis planos e o que cabe num comparativo que o cliente
  // le, venham de onde vierem.
  let _cotSacola = [];

  // Identidade de um plano marcado. Nome sozinho nao serve: "Ouro" existe em
  // enfermaria e apartamento, com e sem coparticipacao, e sao planos
  // diferentes com precos diferentes.
  function _cotChaveDe(p, operadoraId) {
    const pl = (p && p.plano) || {}, tb = (p && p.tabela) || {};
    return [operadoraId, _cotNomePlano(p), _cotAcomod(pl) || '?',
            _cotCopart(tb), _texto(p && p.produto)].join('|');
  }
  function _cotNaSacola(chave) {
    return _cotSacola.some((x) => x.chave === chave);
  }
  function _cotSacolaTirar(chave) {
    _cotSacola = _cotSacola.filter((x) => x.chave !== chave);
  }

  // O bloco que ele le. Aparece nas duas telas onde a pergunta "o que eu ja
  // tenho?" acontece: na lista de planos e na de operadoras.
  //
  // LINHA, NAO CHIP. Em chip so cabe o nome — e a primeira versao mostrou
  // "Bronze SP Mais" duas vezes seguidas, que e o mesmo nome em enfermaria e
  // apartamento. Ele leu como marcacao duplicada e reclamou com razao: o que
  // separa os dois estava escondido justamente no bloco que existe pra dizer
  // o que ele escolheu.
  // `comBotao`: so na tela de OPERADORAS. Na de planos o rodape ja tem o
  // "Ver precos" com a mesma contagem, e dois botoes dizendo a mesma coisa na
  // mesma tela fazem o consultor parar pra decidir qual e o certo.
  function _cotSacolaHTML(comBotao) {
    if (!_cotSacola.length) return '';
    const porOp = new Map();
    _cotSacola.forEach((x) => {
      if (!porOp.has(x.operadoraNome)) porOp.set(x.operadoraNome, []);
      porOp.get(x.operadoraNome).push(x);
    });
    let linhas = '';
    porOp.forEach((itens, op) => {
      // So o que DIFERE dentro da operadora. Repetir "Coparticipacao parcial"
      // em quatro linhas iguais nao separa nada e rouba a largura de quem
      // separa. Com um item so, mostra a acomodacao — que e o que o cliente
      // pergunta primeiro.
      const ets = itens.map((x) => _cotEtiquetas(x.plano).map((e) => e.t));
      const varia = itens.length > 1
        ? (ets[0] || []).filter((v) => !ets.every((l) => l.indexOf(v) >= 0))
        : [];
      linhas += '<div class="job-cot-comp-gr">' +
        '<div class="job-cot-comp-opn">' + esc(op) +
          '<span class="job-cot-comp-opq">' + itens.length + '</span></div>' +
        itens.map((x, k) => {
          const proprias = itens.length > 1
            ? (ets[k] || []).filter((v) => varia.indexOf(v) >= 0)
            : (ets[k] || []).slice(0, 1);
          return '<div class="job-cot-comp-l">' +
            '<span class="job-cot-comp-n">' + esc(x.nome) + '</span>' +
            (proprias.length
              ? '<span class="job-cot-comp-d">' + esc(proprias.join(' · ')) + '</span>' : '') +
            '<button type="button" class="job-cot-comp-x" data-chave="' + esc(x.chave) + '" ' +
              'aria-label="Tirar ' + esc(x.nome) + ' da cotação" ' +
              'title="Tirar da cotação">×</button>' +
          '</div>';
        }).join('') +
      '</div>';
    });
    const falta = _COT_MAX - _cotSacola.length;
    return '<div class="job-cot-comp">' +
      '<div class="job-cot-comp-t">Nesta cotação' +
        '<span class="job-cot-comp-c">' + _cotSacola.length + ' de ' + _COT_MAX + '</span></div>' +
      linhas +
      '<div class="job-cot-comp-s">' +
        (falta > 0
          ? 'Cabem mais ' + falta + '. Pode somar de outras operadoras — sai tudo no mesmo comparativo.'
          : 'Cheio. Tire um pra marcar outro.') +
      '</div>' +
      // COTAR DAQUI, sem ter que entrar numa operadora de novo.
      //
      // Na tela de operadoras nao havia botao nenhum de cotar: o que ja estava
      // marcado so podia ser cotado voltando pra dentro de uma operadora e
      // rolando ate o fim da lista. Aqui ele fecha a conta de onde esta.
      //
      // Fica em contorno, nao cheio: na tela de planos o botao do rodape
      // continua sendo o fim natural da lista, e dois verdes cheios brigando
      // e o defeito que eu acabei de tirar da tela de Cotacoes.
      (comBotao
        ? '<button type="button" class="job-cot-bt-copiar forte job-cot-comp-ir" ' +
            'id="job-cot-comp-precos">Ver preços destes ' + _cotSacola.length + '</button>'
        : '') +
    '</div>';
  }

  // Liga os "x". `aoMudar` repinta a tela de onde o clique veio.
  function _cotSacolaLigar(aoMudar) {
    document.querySelectorAll('.job-cot-comp-x').forEach((b) =>
      b.addEventListener('click', () => { _cotSacolaTirar(b.dataset.chave); aoMudar(); }));
    const bp = document.getElementById('job-cot-comp-precos');
    if (bp) bp.addEventListener('click', () => _cotPrecosSacola());
  }

  // MODALIDADE É CÓDIGO, NÃO TEXTO. O filtro que vai pro Painel usa 1/2/3, e
  // eu mandei "PF"/"PME"/"Adesão": o Painel recebia um valor que não existe e
  // devolvia lista de outro tipo de contratação. O rótulo fica só na tela.
  const _COT_ROTULOS = ['0 a 18', '19 a 23', '24 a 28', '29 a 33', '34 a 38',
                        '39 a 43', '44 a 48', '49 a 53', '54 a 58', '59 ou mais'];
  const _COT_TIPOS = [{ cod: 1, rot: 'PF' }, { cod: 2, rot: 'PME' }, { cod: 3, rot: 'Adesão' }];
  function _cotRotulo(cod) {
    const t = _COT_TIPOS.filter((x) => x.cod === Number(cod))[0];
    return t ? t.rot : '';
  }
  let _cot = null;      // estado do fluxo aberto agora
  // Cidade padrão, como na tela do JOB: quem atende a mesma praça o dia inteiro
  // não deve redigitar a cidade a cada cliente.
  // A cópia local existe pra tela abrir preenchida SEM esperar rede. O servidor
  // é a verdade, e chega logo depois — se divergirem, vence o servidor, porque
  // é ele que o site também lê.
  let _cotCidadePadrao = '';
  try {
    chrome.storage.local.get(['cot_cidade_padrao'], (r) => {
      _cotCidadePadrao = (r && r.cot_cidade_padrao) || '';
    });
  } catch (e) {}
  async function _cotPrefServidor() {
    try {
      const { usuarioId } = await _safeStorageGet(['usuarioId']);
      if (!usuarioId) return;
      const r = await _safeSendMessage({ type: 'pref_ler', usuario_id: usuarioId });
      const c = r && r.ok && r.cidade;
      if (c && c !== _cotCidadePadrao) {
        _cotCidadePadrao = c;
        try { chrome.storage.local.set({ cot_cidade_padrao: c }); } catch (e) {}
      }
    } catch (e) { /* sem servidor, vale a cópia local — como antes */ }
  }
  // O que já foi cotado NESTA conversa, acumulado por operadora. Sem isto, cotar
  // a segunda operadora apagava a primeira da tela e o consultor perdia a
  // comparação — que é o motivo de existir um multicálculo.
  let _cotFeitas = [];
  let _cotLead = null;  // lead da conversa, resolvido pelo servidor
  let _cotErroLead = '';

  function _cotRespira(min, max) {
    const faixa = max - min;
    const ms = Math.random() < 0.85
      ? min + Math.random() * faixa * 0.45
      : max + Math.random() * faixa * 1.6;
    return new Promise((r) => setTimeout(r, ms));
  }
  function _cotEmbaralhar(lista) {
    const c = lista.slice();
    for (let i = c.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = c[i]; c[i] = c[j]; c[j] = t;
    }
    return c;
  }
  // Idade solta ("5, 50, 55") em vez das dez faixas: num painel estreito, dez
  // contadores é um formulário; o consultor tem a idade na conversa, não a
  // faixa. A conversão é a mesma tabela da ANS que o JOB usa.
  function _cotFaixaDaIdade(i) {
    const lim = [[18, 0], [23, 1], [28, 2], [33, 3], [38, 4], [43, 5], [48, 6], [53, 7], [58, 8]];
    for (let k = 0; k < lim.length; k++) if (i <= lim[k][0]) return _COT_FAIXAS[lim[k][1]];
    return _COT_FAIXAS[9];
  }
  function _cotVidasDeTexto(txt) {
    const idades = String(txt || '').split(/[,;eE\s]+/)
      .map((s) => parseInt(s, 10)).filter((n) => !isNaN(n) && n >= 0 && n <= 120);
    const conta = {};
    idades.forEach((i) => { const f = _cotFaixaDaIdade(i); conta[f] = (conta[f] || 0) + 1; });
    return { vidas: _COT_FAIXAS.filter((f) => conta[f]).map((f) => ({ faixa: f, quantidade: conta[f] })),
             total: idades.length };
  }

  // O plano vem do Painel como OBJETO: nome, acomodação e coparticipação moram
  // em p.plano e p.tabela, não na raiz. Eu lia p.nome e a lista inteira saía
  // com "Plano" em toda linha — o consultor escolheria no escuro.
  // A REGRA DO NOME QUE O CLIENTE LE — ditada por ele, palavra por palavra:
  //
  //   empresarial  ->  RAZAO SOCIAL          (e "RAZAO SOCIAL - MEI" se for MEI)
  //   pessoa fisica ->  NOME COMPLETO (PF)
  //
  // Sem nada digitado, cai no nome do contato — que e o comportamento velho, e
  // e por isso que o campo diz isso em voz alta em vez de deixar acontecer.
  function _cotNomeCliente(bruto, ehPME, ehMEI) {
    const s = String(bruto || '').trim().replace(/\s+/g, ' ');
    if (!s) return '';
    if (ehPME) return ehMEI ? s + ' - MEI' : s;
    return s + ' (PF)';
  }

  // O nome de agora, ja com a regra aplicada. Em branco cai no contato —
  // que e o comportamento velho, dito em voz alta no formulario.
  function _cotClienteAtual() {
    const c = _cot || {};
    const tratado = _cotNomeCliente(c.clienteNome, String(c.modalidade) === '2', c.clienteMei);
    return tratado || (_cotLead && _cotLead.nome) || nomeDoContato() || 'Cliente';
  }

  // CONTEXTO DO DOCUMENTO — corretor, marca e empresa do lead.
  //
  // A extensao sabia so o id e o nome de quem entrou, entao o desenho saia sem
  // logo, sem o e-mail do consultor e com o nome do contato no lugar do nome
  // do cliente. Buscado uma vez e guardado: nao muda durante o expediente.
  let _cotCtx = null;
  async function _cotContexto() {
    if (_cotCtx) return _cotCtx;
    const { usuarioId } = await _safeStorageGet(['usuarioId']);
    let r = null;
    try {
      r = await _safeSendMessage({ type: 'cotacao_contexto', usuarioId: usuarioId || '',
                                   leadId: (_cotLead && _cotLead.id) || '' });
    } catch (e) { r = null; }
    // Guarda ate a resposta ruim: sem isto, cada repintura tentaria de novo
    // e a tela ficaria pedindo o mesmo dado a cada clique.
    _cotCtx = (r && r.ok) ? r : { ok: false, corretor: {}, lead: {}, marca: {} };
    return _cotCtx;
  }

  // Tira "60.744.947 " da frente de "60.744.947 GUILHERME HENRIQUE LOPES",
  // e SO quando esses digitos sao a raiz do CNPJ que acabou de ser consultado.
  function _cotNomeSemRaiz(nome, cnpjDigitos) {
    const n = String(nome || '').trim();
    const raiz = String(cnpjDigitos || '').replace(/[^0-9]/g, '').slice(0, 8);
    if (!n || raiz.length !== 8) return n;
    const m = n.match(/^([0-9][0-9.\/-]{7,})\s+(.+)$/);
    if (!m) return n;
    if (m[1].replace(/[^0-9]/g, '') !== raiz) return n;
    const resto = m[2].trim();
    return resto.length >= 3 ? resto : n;
  }

  function _cotNomePlano(p) {
    return ((p && p.plano) || {}).nome || (p && p.nome) || 'Plano';
  }
  // COPARTICIPAÇÃO NÃO É SIM OU NÃO.
  //
  // O Painel devolve `coparticipacaoTipo` — Parcial ou Completa — e o JOB já
  // normaliza isso (`_copart_texto`). Eu achatava em "Com coparticipação" e
  // jogava fora exatamente a informação que decide a venda: parcial cobra só
  // consulta e exame; completa cobra também internação. Mesmo texto dos dois
  // lados, pra ninguém ler uma coisa na extensão e outra no documento.
  //
  // E A PALAVRA E DELES, NAO MINHA.
  //
  // A versao anterior classificava: pegava o `coparticipacaoTipo`, procurava
  // 'parcial'/'total'/'complet'/'integral' dentro dele e devolvia UM DOS MEUS
  // dois rotulos. Funciona enquanto eles escrevem o que eu previ. No dia em
  // que aparecer um terceiro tipo — e existe, porque a tela deles ja mostra
  // "Coparticipacao" sem qualificador ao lado de "Coparticipacao Parcial" —
  // ele cai no generico "Com coparticipacao" e a distincao morre, sem erro
  // nenhum, com o consultor achando que leu o que o Painel disse.
  //
  // Agora o tipo vai INTEIRO, do jeito que veio. Eu so acrescento a palavra
  // "Coparticipacao" na frente quando ela nao esta la — e nao mexo em mais
  // nada. Classificar dado de terceiro e sempre uma aposta de que eu conheco a
  // lista toda dele. Nao conheco.
  function _cotCopart(tb) {
    if (!(tb || {}).coparticipacao) return 'Sem coparticipação';
    const bruto = String((tb || {}).coparticipacaoTipo || '').trim();
    if (!bruto || bruto === '$undefined') return 'Com coparticipação';
    return /copartic/i.test(bruto) ? bruto : ('Coparticipação ' + bruto);
  }
  // Atributos como ETIQUETAS, não como frase corrida. O consultor procura um
  // atributo específico ("tem MEI?", "aceita 2 vidas?") e varrer texto pra
  // achar é o que faz ele errar o plano na frente do cliente.
  // AMBULATORIAL VIRAVA APARTAMENTO. Nao e informacao faltando: e informacao
  // TROCADA, no atributo que mais decide a venda.
  //
  // A conta era `pl.acomodacao ? 'Apartamento' : 'Enfermaria'`. Ela assume que
  // o campo e booleano. O Painel manda a palavra — e "Ambulatorial" e uma
  // string cheia, portanto verdadeira, portanto virava "Apartamento". O plano
  // que NAO tem internacao nenhuma aparecia pro consultor, e ia pro cliente,
  // como quarto individual.
  //
  // O comentario logo abaixo ja avisava do risco na direcao contraria
  // (traduzir texto pro booleano faria Ambulatorial virar Enfermaria) e mesmo
  // assim a coercao ficou. Aviso escrito nao conserta codigo.
  //
  // Regra nova, sem esperteza: palavra vira ela mesma, booleano vira o par que
  // o booleano significa, e o que nao for nem um nem outro NAO VIRA NADA.
  // Etiqueta em branco e um consultor perguntando; etiqueta errada e uma venda
  // desfeita.
  function _cotAcomod(pl) {
    const o = pl || {};
    const v = (o.acomodacaoTxt !== undefined && o.acomodacaoTxt !== null && o.acomodacaoTxt !== '')
      ? o.acomodacaoTxt : o.acomodacao;
    if (typeof v === 'string') {
      const t = v.trim();
      return (!t || t === '$undefined') ? '' : t;
    }
    if (v === true) return 'Apartamento';
    if (v === false) return 'Enfermaria';
    return '';
  }

  function _cotEtiquetas(p) {
    const pl = (p && p.plano) || {}, tb = (p && p.tabela) || {};
    const et = [];
    // O Painel manda booleano; a tabela do JOB manda texto ('Apartamento',
    // 'Enfermaria', 'Ambulatorial'...). Traduzir o texto pro booleano faria
    // 'Ambulatorial' virar 'Enfermaria' na tela — mentira em etiqueta.
    const ac = _cotAcomod(pl);
    if (ac) et.push({ k: 'acomodacao', t: ac, c: '' });
    const cop = _cotCopart(tb);
    et.push({ k: 'copart', t: cop, c: cop === 'Sem coparticipação' ? 'ok' : 'aviso' });
    if (tb.mei === true) et.push({ k: 'mei', t: 'Aceita MEI', c: 'ok' });
    const vmin = tb.qtdVidaMin, vmax = tb.qtdVidaMax;
    if (vmin || vmax) {
      et.push({ k: 'vidas', t: (vmin || 1) + (vmax ? ' a ' + vmax : '+') + ' vidas', c: '' });
    }
    const prod = ((p && p.produto) || {}).nome;
    if (prod) et.push({ k: 'produto', t: prod, c: '' });
    const ent = _texto(p && p.entidade);
    if (ent) et.push({ k: 'entidade', t: ent, c: '' });
    // O QUE O PAINEL MANDAVA E A GENTE ENGOLIA.
    //
    // A resposta deles traz `tabela.nome` e `administradora` em toda linha, e
    // `planosDaOperadora` devolve o array cru — ou seja, os dois SEMPRE
    // estiveram aqui dentro. So que `_cotEtiquetas` nunca leu nenhum dos dois,
    // entao morriam no caminho entre o Painel e a tela.
    //
    // Foi isso que produziu a gaveta da Hapvida com quatro linhas escritas
    // "Smart UP": os quatro tem o mesmo nome de plano e tabelas diferentes, e a
    // tabela era justamente o campo que nao aparecia. O nome do plano nao e a
    // unica identidade dele — e nas operadoras que reaproveitam nome, nao e nem
    // a principal.
    //
    // Entram no fim de proposito: sao desempate, nao manchete. Quando as quatro
    // linhas tem a mesma tabela, o filtro de "so o que muda" tira isso da tela
    // sozinho e nada disso aparece.
    const tab = _texto(p && p.tabela) || ((p && p.tabela) || {}).nome;
    if (tab) et.push({ k: 'tabela', t: tab, c: '' });
    const adm = _texto(p && p.administradora);
    if (adm) et.push({ k: 'administradora', t: adm, c: '' });
    return et;
  }

  // O QUE MUDA DE UM PLANO PRO OUTRO — e SO isso.
  //
  // A gaveta da Hapvida veio com quatro linhas escritas "Smart UP", com quatro
  // precos diferentes e nada dizendo por que. O consultor tinha que adivinhar
  // ou abrir o Painel pra conferir — na frente do cliente.
  //
  // Despejar todas as etiquetas em toda linha resolveria e criaria outro
  // problema: quatro linhas repetindo "Aceita MEI · 1 a 29 vidas" enterram a
  // unica palavra que interessa. Entao entra so o atributo cujo valor NAO e
  // igual em todos. Se os quatro sao Enfermaria, "Enfermaria" nao ajuda a
  // escolher e nao aparece.
  //
  // Atributo presente em uns e ausente em outros (um aceita MEI, o outro nao)
  // TAMBEM e diferenca — por isso a contagem entra na conta, nao so os valores.
  function _cotDiferencas(lista) {
    if (!lista || lista.length < 2) return null;
    const porChave = {};
    lista.forEach((p) => _cotEtiquetas(p).forEach((e) => {
      (porChave[e.k] = porChave[e.k] || []).push(e.t);
    }));
    const mudam = {};
    Object.keys(porChave).forEach((k) => {
      const v = porChave[k];
      if (v.length !== lista.length || v.some((x) => x !== v[0])) mudam[k] = true;
    });
    return mudam;
  }
  function _texto(v) {
    if (!v) return '';
    if (typeof v === 'string') return v === '$undefined' ? '' : v;
    return (v && v.nome) || '';
  }
  function _cotEtiquetasHTML(p) {
    return '<span class="job-cot-tags">' + _cotEtiquetas(p).map((e) =>
      '<span class="job-cot-tag' + (e.c ? ' ' + e.c : '') + '">' + esc(e.t) + '</span>').join('') + '</span>';
  }
  function _cotDetalhePlano(p) {
    return _cotEtiquetas(p).map((e) => e.t).join(' · ');
  }

  // OS RELOGIOS PRECISAM ESTAR EM ORDEM, DO MENOR PRA O MAIOR.
  //
  // Quando o passo vai pra fila, quem espera sao quatro relogios em serie: a
  // aba que pediu, a fila no JOB (2 min), a maquina que executa (90s) e a
  // recuperacao do servidor (3 min). Se o de fora for MENOR que o de dentro,
  // quem pediu desiste enquanto o trabalho continua — e ninguem fica sabendo
  // que aquele preco chegou tarde.
  //
  // Local, 45s continua certo: sem fila no meio, passar disso e defeito. Mas
  // assim que o primeiro sinal de fila chega, a espera legitima passa a ser a
  // da fila, e o relogio daqui sobe pra 150s — acima dos 2 min dela, pra que a
  // fila consiga dizer o proprio motivo em vez de morrer no grito daqui.
  let _cotFilaSinal = 0;
  const _COT_ESPERA_FILA_MS = 150000;

  function _cotPasso(pedido, ms) {
    return new Promise((resolve) => {
      let respondeu = false;
      const t0 = Date.now();
      const limiteLocal = ms || 45000;
      const vencer = () => {
        if (respondeu) return;
        const naFila = _cotFilaSinal > t0;
        const limite = naFila ? Math.max(limiteLocal, _COT_ESPERA_FILA_MS) : limiteLocal;
        if (Date.now() - t0 < limite) { setTimeout(vencer, 1000); return; }
        respondeu = true; resolve({ ok: false, motivo: 'sem_resposta_a_tempo' });
      };
      const relogio = setTimeout(vencer, limiteLocal);
      _safeSendMessage({ type: 'cotador_passo', pedido: pedido }).then((r) => {
        if (respondeu) return;
        respondeu = true; clearTimeout(relogio); resolve(r || { ok: false, motivo: 'sem_resposta' });
      }).catch(() => {
        if (respondeu) return;
        respondeu = true; clearTimeout(relogio); resolve({ ok: false, motivo: 'extensao_indisponivel' });
      });
    });
  }

  // Cada motivo vira uma frase que diz O QUE FAZER. "precisa_aprender" sozinho
  // manda o consultor abrir um chamado; a instrução resolve em um minuto.
  // Motivos que NAO sao sobre o plano, e sim sobre o caminho ate o Painel.
  const _COT_CAMINHO_MORTO = {
    sem_resposta_a_tempo: 1, extensao_indisponivel: 1, sem_resposta: 1,
    painel_fechado: 1, painel_precisa_recarregar: 1,
    painel_fechado_no_trabalhador: 1, fila_demorou: 1, sem_trabalhador: 1,
  };

  const _COT_EXPLICA = {
    // "NESTE COMPUTADOR" NAO E DETALHE — e a frase inteira.
    //
    // O Danilo nao conseguiu cotar e o Guilherme achou que era defeito, porque
    // ELE estava com a aba do Painel aberta na maquina dele. So que a extensao
    // le as abas do proprio Chrome de quem clicou: a aba do Guilherme e
    // invisivel pro Chrome do Danilo. Sem essas duas palavras, a mensagem
    // parece dizer "alguem tem que estar com o Painel aberto" — e ai um erro
    // de um minuto vira uma hora de conversa achando que o sistema quebrou.
    painel_fechado: 'O JOB busca o preço pela <b>sua sessão</b> no Painel do Corretor, ' +
      'aberta <b>neste computador</b> — a aba de outra pessoa não serve, nem no mesmo escritório. ' +
      'Enquanto a aba fica aberta aqui, o JOB segura a sessão viva sozinho.',
    painel_precisa_recarregar: 'A aba do Painel do Corretor está aberta neste computador, ' +
      'mas precisa de <b>F5</b> depois da atualização da extensão.',
    precisa_aprender: 'Vá na aba do <b>Painel do Corretor</b> e faça uma cotação na mão até <b>ver o preço na tela</b>. ' +
      'A extensão aprende vendo você usar, e destrava sozinha — não precisa terminar nem salvar a cotação lá.',
    hash_expirado: 'O Painel do Corretor publicou uma versão nova e um atalho venceu. ' +
      'Faça uma cotação na mão lá até <b>ver o preço</b> — a extensão reaprende sozinha.',
    sem_resposta_a_tempo: 'O Painel demorou demais pra responder. Confira se a aba dele está aberta e tente de novo.',
    // As tabelas do JOB nao passam pelo Painel — o erro delas e outro, e a
    // saida tambem. Cair na frase do Painel mandaria ele abrir a aba errada.
    tabelas_do_job: 'Não consegui ler as tabelas do JOB agora. ' +
      'Se acabou de instalar a extensão, entre com e-mail e senha no popup (ícone do JOB).',
    sem_idades_para_calcular: 'As tabelas do JOB cobram por <b>idade</b>, não por faixa. ' +
      'Volte em "Cotar agora" e digite as idades (ex.: <b>59</b>) em vez de contar por faixa.',
    extensao_indisponivel: 'A extensão não respondeu. Recarregue a página do WhatsApp (F5).'
  };
  function _cotMotivo(m) {
    const s = String(m || '');
    if (s.indexOf('hash_expirado') === 0) return _COT_EXPLICA.hash_expirado;
    return _COT_EXPLICA[s] || 'Não consegui falar com o Painel do Corretor agora. Motivo: ' + esc(s || 'desconhecido');
  }
  // NÃO É AVISO SOLTO, É TELA. Ela abria com um ladrilho amarelo e um "Voltar"
  // verde de largura cheia: sem cabeçalho, sem dizer onde a pessoa está, e com
  // a saída pintada como se fosse a ação principal. O consultor chegava aqui
  // depois de pedir preço e via uma faixa de aviso órfã.
  // A MIGALHA DA COTAÇÃO É O CABEÇALHO DELA.
  //
  // Nas telas de operadora e comparativo o "onde estou" não é um título: é a
  // migalha ("Campinas - SP · PME · 2 vidas"), que ainda por cima é clicável
  // pra corrigir. Ela responde melhor que um título — mas rolava pra fora da
  // tela justamente nas duas telas mais longas da extensão, e aí o consultor
  // perdia de vista pra qual cidade e quantas vidas eram aqueles preços.
  // Aqui ela ganha a mesma casca grudada das outras dez.
  function _cotCabecalho(topoHtml, titulo, extra) {
    return '<div class="job-sec-head job-sec-head-cot">' + topoHtml +
      '<div class="job-sec-head-row">' +
        '<div class="job-sec-t">' + titulo + '</div>' +
        (extra || '') +
      '</div></div>';
  }

  // Motivos em que o consultor precisa do Painel na tela. Pra eles a tela
  // oferece o botão que ABRE a aba, em vez de mandar procurar.
  const _COT_PRECISA_PAINEL = ['painel_fechado', 'precisa_aprender', 'hash_expirado',
                               'painel_precisa_recarregar', 'sem_resposta_a_tempo'];

  function _cotErro(motivo, aoVoltar) {
    setCorpoSecao(_secHead('Cotar agora', 'Preço buscado no Painel do Corretor na hora, pela sua sessão.') +
      '<div class="job-cot-wrap">' +
      '<div class="job-sem-analise job-vazio-bloco" style="text-align:left">' +
        '<div class="job-sem-analise-t">Não consegui buscar o preço</div>' +
        '<div class="job-sem-analise-txt" style="max-width:none;margin-left:0;margin-right:0">' +
          _cotMotivo(motivo) + '</div>' +
      '</div>' +
      (_COT_PRECISA_PAINEL.some((x) => String(motivo || '').indexOf(x) === 0)
        // UM CLIQUE, não uma instrução. Mandar "vá na aba do Painel" obriga o
        // consultor a saber o endereço, abrir e achar — no meio do
        // atendimento, com o cliente esperando.
        ? '<button class="job-cnpj-btn" id="job-cot-abrir-painel" type="button">Abrir o Painel do Corretor</button>'
        : '') +
      '<button class="job-cot-nova job-cot-voltar" id="job-cot-volta" type="button">Voltar</button></div>');
    const b = document.getElementById('job-cot-volta');
    if (b) b.addEventListener('click', aoVoltar || abrirSecaoCotacao);
    const bp = document.getElementById('job-cot-abrir-painel');
    if (bp) bp.addEventListener('click', async () => {
      bp.disabled = true; const r0 = bp.textContent; bp.textContent = 'Abrindo…';
      const r = await _safeSendMessage({ type: 'painel_abrir' }).catch(() => null);
      // Diz o que aconteceu: focar uma aba que já existia e abrir uma nova são
      // coisas diferentes, e o consultor precisa saber em qual ele está.
      bp.textContent = (r && r.ok)
        ? (r.tinha ? 'Painel em foco — volte aqui depois' : 'Painel aberto — faça o login')
        : r0;
      setTimeout(() => { bp.textContent = r0; bp.disabled = false; }, 3200);
    });
  }

  function abrirSecaoCotarInline() {
    const v = _cot || {};
    setCorpoSecao(
      // Cabeçalho igual ao das outras dez telas — e grudado no topo, que aqui
      // importa mais que em qualquer lugar: a tela tem dez faixas etárias e é
      // a única em que o consultor rola bastante sem saber onde está.
      _secHead('Cotar agora', 'Preço buscado no Painel do Corretor na hora, pela sua sessão.') +
      '<div class="job-cot-wrap">' +
        '<label class="job-cot-rot" id="job-cot-p1"><i>1</i> Cidade' +
          _cotAjuda('A cidade define QUEM ATENDE. Um plano de Campinas não existe em Sorocaba, ' +
                    'e a lista de operadoras muda inteira.') + '</label>' +
        '<div class="job-cot-campo-sug">' +
          '<input id="job-cot-cidade" class="job-cnpj-input" autocomplete="off" placeholder="Campinas - SP" value="' + esc(v.cidade || _cotCidadePadrao || '') + '">' +
          '<div id="job-cot-sug" class="job-cot-sug"></div>' +
        '</div>' +
        // PREFERÊNCIA, NÃO CAMPO DE FORMULÁRIO. Era um quadrado que só mudava
        // de cor — quem não distingue verde de cinza não via estado nenhum —
        // e o rótulo trocava de frase entre os dois estados: uma hora ordem
        // ("Usar X como padrão"), outra hora constatação ("Esta é a sua
        // cidade padrão"). Rótulo que muda de natureza obriga a reler.
        // Agora: interruptor carrega o estado, rótulo fica parado, e a linha
        // de baixo diz a consequência com o nome da cidade.
        '<button type="button" class="job-cot-fixar" id="job-cot-fixar" role="switch" aria-checked="false">' +
          '<span class="job-sw"><span class="job-sw-bola"></span></span>' +
          '<span class="job-cot-fixar-txt">' +
            '<span class="rot">Usar como cidade padrão</span>' +
            '<span class="txt"></span>' +
          '</span>' +
        '</button>' +
        '<label class="job-cot-rot" id="job-cot-p2"><i>2</i> Tipo de contratação' +
          _cotAjuda('PF é pessoa física. PME precisa de CNPJ. Adesão exige o cliente pertencer ' +
                    'a uma entidade de classe. O preço e os planos mudam com isso.') + '</label>' +
        '<div class="job-cot-seg" id="job-cot-tipo">' +
          _COT_TIPOS.map((t) =>
            '<button type="button" data-v="' + t.cod + '"' +
            (Number(v.modalidade || 1) === t.cod ? ' class="on"' : '') + '>' + t.rot + '</button>').join('') +
        '</div>' +
        '<label class="job-cot-rot" id="job-cot-p3"><i>3</i> Quem vai usar' +
          _cotAjuda('O preço é por faixa etária E depende de quantas vidas tem no total: ' +
                    'a mesma faixa custa menos num contrato de 20 vidas que num de 2.') + '</label>' +
        '<input id="job-cot-idades" class="job-cnpj-input" placeholder="55 5 50" value="' + esc(v.idades || '') + '">' +

        '<div class="job-cot-dica" id="job-cot-dica"></div>' +
        // Duas formas de dizer a mesma coisa. Quem tem a idade na conversa
        // digita; quem já pensa em faixa (proposta antiga, planilha da
        // operadora) conta na faixa direto, sem inventar uma idade que caiba.
        '<button type="button" class="job-cot-trocar" id="job-cot-modo"></button>' +
        // DEZ LINHAS IGUAIS COM ZERO NÃO SÃO UMA LISTA, SÃO UMA PAREDE.
        // A tela abre com as dez faixas em 0 e todas com o mesmo peso — o olho
        // não tem onde pousar e o consultor conta nos dedos onde parou. Agora
        // a linha com gente ACENDE e as vazias recuam; o "−" some quando não
        // há o que tirar, porque botão que não faz nada é ruído; e o total
        // fica fixo no rodapé da lista, que é a resposta que ele confere antes
        // de buscar preço.
        '<div id="job-cot-faixas" class="job-cot-faixas">' +
          _COT_FAIXAS.map((f, i) => {
            const n = ((v.faixas || {})[f]) || 0;
            return '<div class="job-cot-fx' + (n ? ' tem' : '') + '" data-f="' + f + '">' +
              '<span>' + _COT_ROTULOS[i] + '</span>' +
              '<button type="button" data-d="-1" aria-label="Tirar uma vida de ' + _COT_ROTULOS[i] + '"' +
                (n ? '' : ' disabled') + '>−</button>' +
              '<b>' + n + '</b>' +
              '<button type="button" data-d="1" aria-label="Somar uma vida em ' + _COT_ROTULOS[i] + '">+</button>' +
            '</div>';
          }).join('') +
          '<div class="job-cot-fx-total" id="job-cot-fx-total"></div>' +
        '</div>' +
        // PASSO PROPRIO. Estava enfiado dentro do "Quem vai usar", que e sobre
        // vidas e idades — dois assuntos no mesmo numero, e ele leu como
        // pergunta solta ("o que seria?"). Aqui e um passo, com numero.
        // PASSO 4 — QUEM VAI NA COTACAO, PELO CNPJ.
        //
        // A primeira versao disto era um campo de texto pedindo a razao social
        // na mao. O Guilherme cortou: o CNPJ e que sabe a razao social, se a
        // empresa e MEI e em que cidade ela fica — e a extensao ja consulta
        // CNPJ noutra aba, com a mesma rota.
        //
        // O CNPJ e OPCIONAL de proposito: cotar pessoa fisica pra quem tem CNPJ
        // e caso comum, e obrigar o numero pra seguir travaria a metade dos
        // atendimentos. Sem ele, o nome vai na mao como antes.
        '<label class="job-cot-rot" id="job-cot-p4" style="margin-top:18px"><i>4</i> Quem vai na cotação' +
          _cotAjuda('É o nome que o CLIENTE lê no documento e na imagem — não o nome do ' +
                    'contato daqui do WhatsApp, que é anotação sua. No empresarial, o CNPJ ' +
                    'preenche razão social, MEI e cidade de uma vez.') + '</label>' +
        '<div id="job-cot-cnpj-bloco" style="display:none">' +
          '<div class="job-cot-cnpj-linha">' +
            '<input id="job-cot-cnpj" class="job-cnpj-input" autocomplete="off" ' +
              'inputmode="numeric" placeholder="CNPJ da empresa (opcional)">' +
            '<button type="button" class="job-cnpj-btn" id="job-cot-cnpj-btn">Buscar</button>' +
          '</div>' +
          '<div id="job-cot-cnpj-res"></div>' +
        '</div>' +
        // SEM CAIXINHA DE "E MEI".
        //
        // Tinha uma, e o Guilherme cortou: a consulta do CNPJ ja responde isso
        // (`opcao_pelo_mei`). Perguntar de novo e pedir ao consultor um dado
        // que o sistema tem — e abrir espaco pra ele marcar errado e o "- MEI"
        // sair na cotacao de uma empresa que nao e.
        //
        // Sem CNPJ consultado, a extensao nao sabe e nao inventa: o nome sai
        // limpo, sem sufixo.
        '<input id="job-cot-cliente" class="job-cnpj-input" autocomplete="off" placeholder="" value="">' +
        '<div class="job-cot-dica" id="job-cot-cliente-ex"></div>' +
        '<button class="job-cot-bt-mandar" id="job-cot-buscar" style="width:100%;margin-top:14px" disabled>' +
          'Escolha a cidade</button>' +
        // Preencheu aqui, escolhe onde continuar. Antes ele preenchia no painel,
        // abria o JOB e digitava tudo de novo — o mesmo trabalho duas vezes.
        '<a class="job-cot-nova job-cot-so-pronto" id="job-cot-abrirjob" href="#" target="_blank" rel="noopener">' +
          'Abrir no JOB</a>' +
        '<button class="job-cot-nova job-cot-voltar" id="job-cot-cancelar" type="button">Voltar</button>' +
      '</div>');

    const iCid = document.getElementById('job-cot-cidade');
    const iIda = document.getElementById('job-cot-idades');
    const iCli = document.getElementById('job-cot-cliente');
    const exCli = document.getElementById('job-cot-cliente-ex');
    // MEI vem da consulta do CNPJ, nunca de campo na tela.
    let meiDoCnpj = false;
    // O EXEMPLO MOSTRA O RESULTADO, nao explica a regra. Ele digita e ve na
    // hora como o nome vai sair no documento do cliente.
    const verCliente = () => {
      const bt = document.querySelector('#job-cot-tipo button.on');
      const pme = String((bt && bt.dataset.v) || (_cot && _cot.modalidade) || '') === '2';
      const bl = document.getElementById('job-cot-cnpj-bloco');
      if (bl) bl.style.display = pme ? '' : 'none';
      // O PLACEHOLDER DIZ O QUE DIGITAR. "Razão social da empresa, ou nome
      // completo da pessoa" obrigava a escolher metade da frase; agora ele
      // acompanha o tipo que ja foi escolhido no passo 2.
      if (iCli) iCli.placeholder = pme ? 'Razão social da empresa'
                                       : 'Nome completo do beneficiário';
      if (!exCli) return;
      const bruto = (iCli && iCli.value || '').trim();
      const contato = (_cotLead && _cotLead.nome) || nomeDoContato() || 'o contato';
      exCli.textContent = bruto
        ? 'O cliente vai ler: ' + _cotNomeCliente(bruto, pme, meiDoCnpj)
        : 'Em branco, o cliente lê "' + contato + '" — que é o nome do contato aqui do WhatsApp.';
    };
    // PREENCHIMENTO AUTOMATICO DESLIGADO, DE PROPOSITO.
    //
    // Eu puxava a razao social de `crm_leads.empresa`. Na primeira tela real
    // ela veio "Amparo" — que e CIDADE. A coluna esta misturada: uns leads tem
    // cidade ali, outros empresa. E o defeito que o contrato 6 existe pra
    // separar (`contrato-lead-cidade-empresa-cnpj.md`), e ate ele rodar
    // sugerir dali e oferecer lixo com cara de dado bom — pior que campo
    // vazio, porque o consultor confia e manda pro cliente.
    //
    // Religar quando a migracao separar cidade de empresa.
    if (iCli) iCli.addEventListener('input', verCliente);
    verCliente();

    // ── O CNPJ PREENCHE O RESTO ──────────────────────────────────────────
    //
    // Razao social, MEI e cidade saem os tres da mesma consulta. Digitar os
    // tres a mao, com o cliente esperando, e onde nasce a divergencia entre o
    // que esta na cotacao e o que esta no contrato.
    //
    // Nada e sobrescrito calado: a cidade so troca se ele mandar, porque a
    // sede da empresa nem sempre e onde o plano vai valer (matriz em Sao Paulo,
    // funcionarios em Campinas — cota-se Campinas).
    const iCnpj = document.getElementById('job-cot-cnpj');
    const bCnpj = document.getElementById('job-cot-cnpj-btn');
    const rCnpj = document.getElementById('job-cot-cnpj-res');
    if (iCnpj) {
      iCnpj.addEventListener('input', () => {
        const d = iCnpj.value.replace(/\D/g, '').slice(0, 14);
        iCnpj.value = d.replace(/^(\d{2})(\d)/, '$1.$2')
                       .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
                       .replace(/\.(\d{3})(\d)/, '.$1/$2')
                       .replace(/(\d{4})(\d)/, '$1-$2');
      });
      iCnpj.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); if (bCnpj) bCnpj.click(); }
      });
    }
    if (bCnpj) bCnpj.addEventListener('click', async () => {
      const dig = (iCnpj.value || '').replace(/\D/g, '');
      if (dig.length !== 14) {
        rCnpj.innerHTML = '<div class="job-cot-dica">Faltam dígitos — o CNPJ tem 14.</div>';
        return;
      }
      const antes = bCnpj.textContent;
      bCnpj.disabled = true; bCnpj.textContent = 'Buscando…';
      let r = null;
      try { r = await _safeSendMessage({ type: 'consultar_cnpj', cnpj: dig }); }
      catch (e) { r = null; }
      bCnpj.disabled = false; bCnpj.textContent = antes;
      const c = (r && r.ok && r.cnpj) || null;
      if (!c) {
        rCnpj.innerHTML = '<div class="job-cot-dica">' +
          esc((r && r.erro) || 'Não consegui consultar agora. Dá pra digitar o nome à mão abaixo.') +
          '</div>';
        return;
      }
      _cot = _cot || {};
      _cot.cnpj = dig;
      _cot.cnpjDados = c;
      // O NOME DO MEI VEM COM A RAIZ DO CNPJ NA FRENTE.
      //
      // A Receita registra MEI assim: "60.744.947 GUILHERME HENRIQUE LOPES".
      // E a razao social de verdade — nao e erro de leitura. So que ela vai
      // parar na cotacao que o CLIENTE le, e ali parece dado de sistema
      // vazado, nao documento de corretora.
      //
      // Corta so quando os digitos sao a raiz do PROPRIO CNPJ consultado.
      // Cortar numero do comeco de qualquer nome mutilaria razao social
      // legitima que comeca com numero — e existem.
      if (iCli) iCli.value = _cotNomeSemRaiz(c.nome || '', dig);
      meiDoCnpj = !!c.eh_mei;
      verCliente();
      // SITUACAO CADASTRAL APARECE. Operadora recusa proposta de empresa
      // baixada ou suspensa, e descobrir isso depois da assinatura e o pior
      // momento possivel.
      const selo = (txt, cls) => '<span class="job-cot-tag' + (cls ? ' ' + cls : '') + '">' + esc(txt) + '</span>';
      rCnpj.innerHTML =
        '<div class="job-cot-cnpj-cartao' + (c.ativa ? '' : ' alerta') + '">' +
          '<div class="job-cot-cnpj-nome">' + esc(c.nome || 'Empresa') + '</div>' +
          '<div class="job-cot-tags">' +
            selo(c.situacao || 'situação desconhecida', c.ativa ? 'ok' : 'aviso') +
            (c.eh_mei ? selo('MEI', 'ok') : '') +
            (c.municipio ? selo(c.municipio, '') : '') +
          '</div>' +
          (c.cnae ? '<div class="job-cot-cnpj-cnae">' + esc(c.cnae) + '</div>' : '') +
          (!c.ativa
            ? '<div class="job-cot-dica">Empresa não está ativa na Receita. ' +
              'Operadora recusa proposta assim — confirme antes de cotar.</div>' : '') +
          (c.municipio && cidadeDoCatalogo && c.municipio !== cidadeDoCatalogo
            ? '<button type="button" class="job-cot-bt-copiar" id="job-cot-usar-cidade" ' +
              'style="width:100%;margin-top:8px">Cotar para ' + esc(c.municipio) + '</button>'
            : '') +
        '</div>';
      const bc = document.getElementById('job-cot-usar-cidade');
      if (bc) bc.addEventListener('click', async () => {
        // A CIDADE TEM QUE SER A STRING DO CATALOGO DELES.
        //
        // Este botao escrevia `c.municipio` no campo — e `municipio` e uma
        // string que NOS montamos ("INDAIATUBA - SP", cidade + ' - ' + UF). O
        // Painel nao tem cidade com esse nome, entao a busca respondia
        // "nenhuma cidade com esse nome" e o consultor achava que tinha
        // digitado errado. O proprio comentario da funcao de busca ja avisava:
        // montar na mao nao funciona.
        //
        // Agora ele PROCURA no catalogo com o nome puro (sem o " - UF") e
        // escolhe. Um resultado: escolhe sozinho. Mais de um: abre a lista
        // filtrada, pra ele decidir — cidade errada muda preco.
        const puro = String(c.municipio || '').replace(/\s*-\s*[A-Z]{2}\s*$/i, '').trim();
        if (!puro) return;
        bc.disabled = true; bc.textContent = 'Procurando na lista…';
        let achados = [];
        try {
          const rr = await _safeSendMessage({ type: 'cotador_cidades', termo: puro });
          achados = (rr && rr.ok && Array.isArray(rr.cidades)) ? rr.cidades : [];
        } catch (e) { achados = []; }
        bc.disabled = false;
        if (!achados.length) {
          bc.textContent = 'O Painel não tem ' + puro + ' na lista';
          return;
        }
        const nomeDe = (x) => (typeof x === 'string' ? x : (x.nome || x.label || x.descricao || ''));
        const exato = achados.filter((x) => nomeDe(x).toLowerCase() === puro.toLowerCase());
        const escolhido = (exato.length === 1) ? exato[0] : (achados.length === 1 ? achados[0] : null);
        if (escolhido) {
          iCid.value = nomeDe(escolhido);
          iCid.classList.add('ok');
          iCid.dispatchEvent(new Event('input', { bubbles: true }));
          bc.textContent = 'Cidade: ' + nomeDe(escolhido);
          return;
        }
        // Mais de uma: devolve a escolha pra ele, com o campo ja filtrado.
        iCid.value = puro;
        iCid.dispatchEvent(new Event('input', { bubbles: true }));
        iCid.focus();
        bc.textContent = achados.length + ' cidades com esse nome — escolha na lista';
      });
    });
    const dica = document.getElementById('job-cot-dica');
    const box = document.getElementById('job-cot-sug');
    let relogioCid = null;
    // Só a cidade ESCOLHIDA NA LISTA serve. Digitada à mão, o Painel devolve
    // 500 — a string tem que ser a do catálogo deles.
    let cidadeDoCatalogo = (v.cidade && v.cidadeOk) ? v.cidade
                          : (!v.cidade && _cotCidadePadrao) ? _cotCidadePadrao : '';
    if (cidadeDoCatalogo) iCid.classList.add('ok');

    // Conta as vidas enquanto ele digita. Sem isso, "5, 50, 55" e "5 50 55"
    // parecem a mesma coisa e um deles vira uma vida só, descoberto só depois
    // de a cotação inteira sair errada.
    // Duas formas, UMA fonte de verdade: `vidasAgora()` decide pelo modo aberto.
    // Somar as duas faria a cotação sair com o dobro de gente sem ninguém ver.
    const caixaFx = document.getElementById('job-cot-faixas');
    const btModo = document.getElementById('job-cot-modo');
    // FAIXA É O PRINCIPAL. Digitar idade continua existindo pra quem tem a
    // idade na conversa, mas quem abre a tela vê a forma que a operadora usa.
    let porFaixa = !(v.idades && v.idades.trim());
    const contFx = Object.assign({}, v.faixas || {});

    function vidasAgora() {
      if (!porFaixa) return _cotVidasDeTexto(iIda.value);
      const vidas = _COT_FAIXAS.filter((f) => contFx[f] > 0)
        .map((f) => ({ faixa: f, quantidade: contFx[f] }));
      return { vidas: vidas, total: vidas.reduce((n, x) => n + x.quantidade, 0) };
    }
    const linkJob = document.getElementById('job-cot-abrirjob');
    const btBuscar = document.getElementById('job-cot-buscar');
    function atualizarLink() {
      const r = vidasAgora();
      const pronto = !!cidadeDoCatalogo && r.total > 0;
      // O BOTÃO DIZ O QUE FALTA, em vez de só ficar apagado. Botão cinza sem
      // motivo faz a pessoa clicar de novo achando que travou.
      // ESTADO DE CADA PASSO NA TELA. Feito é verde e some da frente; o que
      // falta é o único aceso. Sem isso, três blocos idênticos e a pessoa não
      // sabe onde está — ela lê tudo de novo a cada volta.
      const feito1 = !!cidadeDoCatalogo, feito3 = r.total > 0;
      const marca = (id, ok, agora) => {
        const el2 = document.getElementById(id);
        if (!el2) return;
        el2.classList.toggle('feito', ok);
        el2.classList.toggle('agora', !ok && agora);
      };
      marca('job-cot-p1', feito1, true);
      marca('job-cot-p2', feito1, false);
      marca('job-cot-p3', feito3, feito1);
      btBuscar.disabled = !pronto;
      btBuscar.textContent = !cidadeDoCatalogo ? 'Escolha a cidade'
                           : !r.total ? 'Informe as vidas'
                           : 'Buscar operadoras';
      // O link pro JOB só aparece quando leva alguma coisa: abrir a tela vazia
      // é justamente o que ele reclamou.
      linkJob.classList.toggle('off', !pronto);
      const tipo = (document.querySelector('#job-cot-tipo button.on') || {}).dataset;
      const antes = _cot;
      _cot = { cidade: cidadeDoCatalogo, modalidade: Number((tipo && tipo.v) || 1),
               idades: iIda.value, faixas: porFaixa ? contFx : null,
               clienteNome: (iCli && iCli.value || '').trim(),
               clienteMei: meiDoCnpj,
               cnpj: (iCnpj && iCnpj.value || '').replace(/\D/g, ''),
               cnpjDados: (_cot && _cot.cnpjDados) || null,
               vidas: r.vidas, totalVidas: r.total };
      linkJob.href = _cotLinkJob(null);
      _cot = antes;
    }
    const contar = () => {
      const r = vidasAgora();
      dica.textContent = r.total
        ? r.total + (r.total === 1 ? ' vida' : ' vidas') + ' · ' +
          r.vidas.map((x) => x.quantidade + '× ' + x.faixa.replace('-199', '+')).join(', ')
        : (porFaixa ? 'Some as pessoas em cada faixa.'
                    : 'Uma idade por pessoa, separadas por espaço ou vírgula.');
      dica.classList.toggle('ok', r.total > 0);
      atualizarLink();
    };
    function pintarModo() {
      caixaFx.classList.toggle('ver', porFaixa);
      iIda.style.display = porFaixa ? 'none' : '';
      btModo.textContent = porFaixa ? 'digitar as idades' : 'contar por faixa';
      let soma = 0;
      caixaFx.querySelectorAll('.job-cot-fx').forEach((d) => {
        const n = contFx[d.dataset.f] || 0;
        soma += n;
        d.querySelector('b').textContent = n;
        d.classList.toggle('tem', n > 0);
        // O "−" fica desligado quando não há o que tirar: botão que não faz
        // nada é ruído, e em dez linhas o ruído multiplica por dez.
        const menos = d.querySelector('button[data-d="-1"]');
        if (menos) menos.disabled = n === 0;
      });
      // O total mora no fim da lista, que é onde o olho chega depois de contar
      // — e é o número que ele confere antes de buscar preço.
      const tot = document.getElementById('job-cot-fx-total');
      if (tot) {
        tot.textContent = soma ? (soma + (soma === 1 ? ' vida no total' : ' vidas no total'))
                               : 'Nenhuma vida marcada ainda';
        tot.classList.toggle('tem', soma > 0);
      }
      contar();
    }
    btModo.addEventListener('click', () => { porFaixa = !porFaixa; pintarModo(); });
    caixaFx.querySelectorAll('.job-cot-fx button').forEach((b2) => {
      b2.addEventListener('click', () => {
        const f = b2.parentElement.dataset.f;
        contFx[f] = Math.max(0, Math.min(99, (contFx[f] || 0) + Number(b2.dataset.d)));
        pintarModo();
      });
    });
    iIda.addEventListener('input', contar);
    pintarModo();

    document.querySelectorAll('#job-cot-tipo button').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('#job-cot-tipo button').forEach((o) => o.classList.remove('on'));
        setTimeout(verCliente, 0);   // "É MEI" só existe no empresarial
        b.classList.add('on');
      });
    });

    iCid.addEventListener('input', () => {
      clearTimeout(relogioCid);
      cidadeDoCatalogo = '';
      iCid.classList.remove('ok');
      pintarFixar();
      const termo = iCid.value.trim();
      if (termo.length < 3) { box.className = 'job-cot-sug'; return; }
      relogioCid = setTimeout(async () => {
        let r;
        try { r = await _safeSendMessage({ type: 'cotador_cidades', termo: termo }); }
        catch (e) { r = null; }
        // A LISTA VEM DIRETO EM `dados`. Eu lia `dados.cidades`, que é undefined:
        // a sugestão nunca aparecia, o consultor digitava a cidade à mão e o
        // Painel devolvia http_500 em operadoras — porque a string tem que ser
        // exatamente a do catálogo deles ("Campinas - SP"), não o que a gente
        // escreve. O erro parecia do Painel e era meu.
        const lista = (r && r.ok && Array.isArray(r.dados)) ? r.dados : [];
        // LISTA VAZIA SEMPRE DIZ POR QUÊ.
        //
        // Eu só mostrava o motivo quando `r` existia e vinha com ok:false. Se a
        // chamada estourava (sem aba do Painel, extensão recarregada), `r` era
        // null, a condição não pegava e a lista simplesmente não abria — o
        // consultor digitava a cidade e não acontecia nada. Silêncio é o pior
        // erro possível aqui, porque parece que o campo não funciona.
        if (!lista.length) {
          const motivo = r ? (r.ok ? '' : r.motivo) : 'extensao_indisponivel';
          box.innerHTML = '<div class="job-cot-sug-vazio">' +
            (motivo ? _cotMotivo(motivo).replace(/<[^>]*>/g, '')
                    : 'Nenhuma cidade com esse nome no Painel. Confira a grafia.') +
            '</div>';
          box.className = 'job-cot-sug ver';
          return;
        }
        box.innerHTML = lista.slice(0, 8).map((c) => {
          const nome = (c && c.nome) || c;
          return '<button type="button" data-v="' + esc(nome) + '">' + esc(nome) + '</button>';
        }).join('');
        box.className = 'job-cot-sug ver';
        box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
          iCid.value = b.dataset.v;
          cidadeDoCatalogo = b.dataset.v;   // só esta serve pro Painel
          box.className = 'job-cot-sug';
          iCid.classList.add('ok');
          pintarFixar();
        }));
      }, 300);
    });

    // Fixar a cidade. Linha própria e com marca visível, como na tela do JOB:
    // recurso que não se acha é recurso que não existe.
    const btFixar = document.getElementById('job-cot-fixar');
    function pintarFixar() {
      const atual = cidadeDoCatalogo || '';
      const fixa = !!atual && atual === _cotCidadePadrao;
      btFixar.classList.toggle('on', fixa);
      btFixar.setAttribute('aria-checked', fixa ? 'true' : 'false');
      // O rótulo não muda; a linha de apoio diz o que essa escolha faz, com
      // o nome da cidade — que é a informação que a pessoa quer conferir.
      btFixar.querySelector('.txt').textContent = fixa
        ? atual + ' já vem preenchida nas próximas cotações'
        : (atual ? 'Começa toda cotação em ' + atual : 'Escolha a cidade primeiro');
      btFixar.disabled = !atual;
    }
    // Resolve o lead em segundo plano e reescreve o link quando chegar.
    _cotGarantirLead().then(() => { try { atualizarLink(); } catch (e) {} });
    // E confere a cidade padrão no servidor: se ele mudou noutra máquina, a
    // tela se corrige sozinha em vez de manter a cópia velha desta aqui.
    _cotPrefServidor().then(() => {
      if (!iCid.value && _cotCidadePadrao) {
        iCid.value = _cotCidadePadrao;
        cidadeDoCatalogo = _cotCidadePadrao;
        iCid.classList.add('ok');
        try { pintarFixar(); atualizarLink(); } catch (e) {}
      }
    });

    btFixar.addEventListener('click', () => {
      if (!cidadeDoCatalogo) return;
      _cotCidadePadrao = (_cotCidadePadrao === cidadeDoCatalogo) ? '' : cidadeDoCatalogo;
      try { chrome.storage.local.set({ cot_cidade_padrao: _cotCidadePadrao }); } catch (e) {}
      // Grava no JOB também: é a mesma preferência que a tela do site lê, e
      // guardar só aqui era o motivo de ela sumir ao trocar de máquina.
      _safeStorageGet(['usuarioId']).then(({ usuarioId }) => {
        if (usuarioId) _safeSendMessage({ type: 'pref_gravar', usuario_id: usuarioId,
                                          cidade: _cotCidadePadrao }).catch(() => {});
      }).catch(() => {});
      pintarFixar();
    });
    pintarFixar();

    document.getElementById('job-cot-cancelar').addEventListener('click', abrirSecaoCotacao);
    document.getElementById('job-cot-buscar').addEventListener('click', () => {
      const r = vidasAgora();
      if (!cidadeDoCatalogo) {
        dica.textContent = iCid.value.trim()
          ? 'Escolha a cidade na lista que aparece — digitada à mão o Painel não reconhece.'
          : 'Falta a cidade.';
        dica.classList.remove('ok');
        iCid.focus();
        return;
      }
      if (!r.total) { dica.textContent = 'Falta a idade de quem vai usar o plano.'; dica.classList.remove('ok'); return; }
      const tipo = (document.querySelector('#job-cot-tipo button.on') || {}).dataset;
      // A SACOLA MORRE AQUI, DE PROPOSITO. Cidade, tipo e vidas sao a base do
      // preco: um plano marcado pra Campinas com 2 vidas nao e o mesmo plano
      // em Sorocaba com 4. Carregar a marcacao adiante seria montar uma
      // proposta que nao existe.
      _cotSacola = [];
      _cot = { cidade: cidadeDoCatalogo, cidadeOk: true, modalidade: Number((tipo && tipo.v) || 1),
               idades: iIda.value, faixas: porFaixa ? contFx : null,
               clienteNome: (iCli && iCli.value || '').trim(),
               clienteMei: meiDoCnpj,
               cnpj: (iCnpj && iCnpj.value || '').replace(/\D/g, ''),
               cnpjDados: (_cot && _cot.cnpjDados) || null,
               vidas: r.vidas, totalVidas: r.total };
      _cotBuscarOperadoras();
    });
  }

  // O LEAD PRECISA ESTAR RESOLVIDO AQUI, não só na aba de cotações.
  //
  // `_cotLead` só era preenchido quando o consultor passava pela lista de
  // cotações. Entrando direto pelo botão "Cotar" da análise, ele ficava nulo e
  // o link pro JOB saía sem o lead — que foi o que o Guilherme viu.
  async function _cotGarantirLead() {
    if (_cotLead && _cotLead.id) return _cotLead;
    let tel = '';
    try { tel = (await pedirTelefoneWpp()) || telefoneDoContato(); } catch (e) { tel = telefoneDoContato(); }
    tel = String(tel || '').replace(/\D/g, '');
    if (!tel) return null;
    let r = null;
    try { r = await _safeSendMessage({ type: 'cotacoes_do_lead', telefone: tel }); } catch (e) { r = null; }
    if (r && r.ok) _cotLead = { id: r.lead_id || 0, nome: r.lead_nome || '', telefone: tel };
    else _cotLead = { id: 0, nome: '', telefone: tel };
    return _cotLead;
  }

  // O "i" explica o CONCEITO, não o campo. Quem não sabe o que é adesão não é
  // ajudado por "escolha o tipo" — é ajudado por "exige entidade de classe".
  // Usa title nativo: funciona no hover e no foco por teclado, e não inventa
  // uma camada de tooltip que teria que ser mantida.
  function _cotAjuda(texto) {
    return '<button type="button" class="job-i" aria-label="O que é isso?" ' +
           'data-ajuda="' + esc(texto) + '">i</button>';
  }

  // O BALAO DO "i" — clique, nao hover.
  //
  // Era `title` nativo e o Guilherme reclamou que nao funciona. Tooltip nativo
  // exige o ponteiro parado por mais de um segundo em cima de um alvo de 14px,
  // coisa que ninguem faz no meio de um atendimento — e dentro do WhatsApp Web
  // ele as vezes nem sai.
  //
  // Um listener so, no documento, por delegacao: os "i" nascem e morrem a cada
  // repintura de tela, e ligar um por um significaria esquecer os proximos.
  let _iBalao = null, _iDono = null;
  function _iFechar() {
    if (_iBalao) { _iBalao.remove(); _iBalao = null; }
    if (_iDono) { _iDono.classList.remove('on'); _iDono = null; }
  }
  function _iAbrir(el) {
    _iFechar();
    const b = document.createElement('div');
    b.className = 'job-i-balao';
    b.textContent = el.dataset.ajuda || '';
    document.body.appendChild(b);
    const r = el.getBoundingClientRect(), c = b.getBoundingClientRect();
    // Cabe embaixo? Fica embaixo. Senao sobe. E nunca passa da borda: o painel
    // vive encostado na direita da tela.
    const esq = Math.max(8, Math.min(window.innerWidth - c.width - 8, r.left + r.width / 2 - c.width / 2));
    const abaixo = r.bottom + 8 + c.height < window.innerHeight;
    b.style.left = esq + 'px';
    b.style.top = (abaixo ? r.bottom + 8 : r.top - c.height - 8) + 'px';
    el.classList.add('on');
    _iBalao = b; _iDono = el;
  }
  _ouvir(document, 'click', (ev) => {
    const alvo = ev.target && ev.target.closest && ev.target.closest('.job-i');
    if (alvo) {
      ev.preventDefault(); ev.stopPropagation();
      if (_iDono === alvo) { _iFechar(); return; }   // segundo clique fecha
      _iAbrir(alvo);
      return;
    }
    if (_iBalao) _iFechar();
  }, true);
  _ouvir(document, 'keydown', (ev) => { if (ev.key === 'Escape') _iFechar(); }, true);
  _ouvir(window, 'scroll', _iFechar, true);

  // TOPO DE NAVEGACAO: seta de voltar + onde estamos + o que ja foi cotado.
  //
  // Sem seta, sair de uma operadora exigia achar o botao certo la embaixo, e
  // trocar de cidade exigia voltar duas telas às cegas. E sem o resumo, o que
  // ja foi cotado sumia da vista assim que ele entrava na proxima operadora —
  // ele perdia a conta do que tinha e recomecava.
  // A SETA DIZ PRA ONDE VOLTA.
  //
  // Era um chevron sozinho. Chevron sozinho obriga a lembrar de onde se veio —
  // e nesta aba se vem de quatro telas diferentes. `rotulo` é o nome da tela
  // de destino, escrito ao lado da seta.
  function _cotTopo(aoVoltar, rotulo) {
    const n = _cotFeitas.reduce((a, f) => a + f.planos.length, 0);
    return '<div class="job-cot-topo">' +
      '<button type="button" class="job-cot-seta" id="job-cot-seta" ' +
        'title="Voltar para ' + esc(rotulo || 'a tela anterior') + '">' +
        '<span class="seta"></span>' + esc(rotulo || 'Voltar') + '</button>' +
      '<button type="button" class="job-cot-migalha" id="job-cot-trocar-base" ' +
        'title="Mudar cidade, tipo ou quem vai usar">' +
        esc(_cot && _cot.cidade ? _cot.cidade : '') +
        (_cot && _cot.modalidade ? ' · ' + esc(_cotRotulo(_cot.modalidade)) : '') +
        (_cot && _cot.totalVidas ? ' · ' + _cot.totalVidas + (_cot.totalVidas === 1 ? ' vida' : ' vidas') : '') +
      '</button>' +
      (n ? '<button type="button" class="job-cot-sacola" id="job-cot-ver-comparativo" ' +
             'title="Ver o comparativo com o que já foi cotado">' + n + '</button>' : '') +
    '</div>';
  }
  // Liga os três botões do topo. `aoVoltar` é o único que muda por tela.
  function _cotTopoLigar(aoVoltar) {
    const bv = document.getElementById('job-cot-seta');
    if (bv) bv.addEventListener('click', aoVoltar);
    const bt = document.getElementById('job-cot-trocar-base');
    if (bt) bt.addEventListener('click', abrirSecaoCotarInline);
    const bc = document.getElementById('job-cot-ver-comparativo');
    if (bc) bc.addEventListener('click', _cotPintarResultado);
  }

  function _cotBase() {
    return { cidade: _cot.cidade, modalidade: _cot.modalidade, vidas: _cot.vidas,
             titulo: (nomeDoContato() || 'Cliente') + ' · ' + _cot.cidade + ' · ' + _cotRotulo(_cot.modalidade) };
  }
  // TELA DE ESPERA COM SAIDA.
  //
  // Buscar operadora ou preco no Painel leva segundos e as vezes nao volta.
  // Sem botao aqui, o consultor ficava presto numa tela sem nada clicavel no
  // meio do atendimento — a unica saida era fechar o painel inteiro.
  //
  // `_cotGer` e o que faz o botao valer: sair incrementa a geracao, e a
  // resposta que chegar depois ve que a geracao mudou e nao pinta por cima da
  // tela onde ele ja esta. Botao que so navega, sem isso, seria pior que
  // botao nenhum: a tela voltaria sozinha alguns segundos depois.
  function _cotEsperando(txt, sub, aoVoltar, rotulo) {
    setCorpoSecao(
      (aoVoltar ? _cotTopo(aoVoltar, rotulo) : '') + _telaCarregando(txt, sub) +
      '<div class="job-cot-fila" id="job-cot-fila"></div>');
    if (aoVoltar) _cotTopoLigar(() => { _cotGer++; aoVoltar(); });
  }

  // ESPERA MUDA PARECE SISTEMA TRAVADO.
  //
  // Quando o preco vem de outra maquina, a espera deixa de ser "o Painel esta
  // respondendo" e passa a ter uma fila no meio. Sem dizer isso, o consultor
  // olha uma tela parada e conclui que quebrou — e clica de novo, que e a
  // pior coisa que ele pode fazer.
  //
  // A palavra "fila" nao aparece, nem "Dell", nem "servidor": ele ve quantos
  // estao na frente e o que esta acontecendo agora. COMO o JOB busca o preco e
  // problema do JOB.
  try {
    _escutarChrome(chrome.runtime.onMessage, (msg) => {
      if (!msg || msg.type !== 'fila_andamento') return;
      _cotFilaSinal = Date.now();
      const cx = document.getElementById('job-cot-fila');
      if (!cx) return;
      const n = msg.posicao || 0;
      const etapa = String(msg.etapa || '').trim();
      cx.innerHTML =
        (n > 0
          ? '<b>' + n + (n === 1 ? ' na frente' : ' na frente') + '</b> — já já é a sua vez.'
          : (etapa ? esc(etapa) : 'Buscando os preços…')) +
        (msg.fracao > 0
          ? '<div class="job-cot-barra" style="margin-top:8px"><i style="width:' +
            Math.round(Math.min(1, msg.fracao) * 100) + '%"></i></div>'
          : '');
    });
  } catch (e) { /* sem o aviso, a espera volta a ser muda — nao quebra nada */ }
  // Geracao da navegacao. Sobe a cada saida; resposta de geracao velha e
  // descartada em vez de repintar.
  let _cotGer = 0;

  async function _cotBuscarOperadoras() {
    _cotEsperando('Vendo quem atende ' + _cot.cidade + '…', '', abrirSecaoCotarInline, 'Cotar agora');
    const b = _cotBase();
    // reaproveitar: a pergunta "quem atende essa cidade?" não merece uma cotação
    // nova no sistema deles. Dezenas de cotações vazias com o nome do consultor
    // num dia de trabalho é rastro do tipo que fica.
    const g = _cotGer;
    const rc = await _cotPasso(Object.assign({ acao: 'criar', reaproveitar: true }, b));
    if (g !== _cotGer) return;
    if (!rc.ok) { _cotErro(rc.motivo, abrirSecaoCotarInline); return; }
    _cot.cotacaoId = rc.dados.cotacaoId;
    await _cotRespira(400, 1100);
    const r = await _cotPasso(Object.assign({ acao: 'operadoras', cotacaoId: _cot.cotacaoId }, b));
    if (g !== _cotGer) return;
    if (!r.ok) { _cotErro(r.motivo, abrirSecaoCotarInline); return; }
    _cot.operadoras = (r.dados && r.dados.operadoras) || [];
    _cotPintarOperadoras();
  }

  // MEMÓRIA DE LOGOS, enchida aos poucos.
  //
  // Uma operadora é buscada UMA vez na vida da instalação: o resultado fica em
  // chrome.storage e nas próximas cotações a logo já está lá, sem rede. Quem
  // não tiver logo continua com a inicial, que é ícone legítimo e não buraco.
  const _cotLogos = {};        // memória desta aba, pra não ir ao storage a cada pintura
  let _cotLogosLidos = false;

  // LOGOS QUE O PAINEL NÃO TEM, embutidas na extensão.
  //
  // Cinco operadoras vinham sem logo porque o Painel não devolve a delas — não
  // era falha da busca. Baixei do site oficial de cada uma, aparei a folga e
  // guardei aqui. Vêm de `chrome-extension://`, que é o único endereço de
  // imagem que a página do WhatsApp aceita sem discussão.
  //
  // A comparação é por trecho do nome normalizado, porque o Painel escreve
  // "Plano de Saúde Vera Cruz" e o arquivo se chama só "vera-cruz". Casar por
  // igualdade exata quebraria no dia em que eles mudarem o nome comercial.
  const _COT_LOGOS_PROPRIAS = [
    // Amhe Med e Fenix Medical entraram em 09/08 pelo mesmo motivo das outras:
    // o Painel nao devolve logo delas e a linha ficava so com a inicial, o que
    // o Guilherme leu como imagem quebrada. Baixadas dos sites oficiais
    // (amhemed.com.br e fenix.med.br), PNG com transparencia.
    { chave: 'amhe',         arq: 'logos/amhemed.png' },
    { chave: 'fenix',        arq: 'logos/fenix-medical.png' },
    { chave: 'vera cruz',    arq: 'logos/vera-cruz.png' },
    { chave: 'salusmed',     arq: 'logos/salusmed.png' },
    { chave: 'samp',         arq: 'logos/samp.png' },
    { chave: 'santa tereza', arq: 'logos/santa-tereza.png' },
    { chave: 'select',       arq: 'logos/select.png' },
  ];
  function _cotLogoPropria(nome) {
    const n = String(nome || '').toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const achou = _COT_LOGOS_PROPRIAS.filter((x) => n.indexOf(x.chave) >= 0)[0];
    if (!achou) return '';
    try { return chrome.runtime.getURL(achou.arq); } catch (e) { return ''; }
  }

  function _cotChaveLogo(nome) {
    return 'logo_op:' + String(nome || '').trim().toLowerCase().slice(0, 60);
  }
  async function _cotCarregarLogos() {
    if (_cotLogosLidos) return;
    _cotLogosLidos = true;
    try {
      const tudo = await new Promise((ok) => chrome.storage.local.get(null, (r) => ok(r || {})));
      Object.keys(tudo).forEach((k) => {
        if (k.indexOf('logo_op:') === 0 && typeof tudo[k] === 'string') _cotLogos[k] = tudo[k];
        // 'xlogo_op:...' guarda QUANDO a busca falhou, pra poder tentar de novo.
        else if (k.indexOf('xlogo_op:') === 0 && typeof tudo[k] === 'number') _cotLogos[k] = tudo[k];
      });
    } catch (e) {}
  }
  // Desenha as logos que já estão na memória e busca as que faltam, uma a uma.
  // Sequencial de propósito: são poucas e não vale abrir quinze conexões pra
  // desenhar ícone — a tela já está utilizável sem elas.
  async function _cotPintarLogos(ops) {
    await _cotCarregarLogos();
    for (let i = 0; i < ops.length; i++) {
      const o = ops[i];
      const chave = _cotChaveLogo(o.nome);
      // A embutida vence: já está na máquina, não vai à rede e é justamente
      // das operadoras que o Painel não cobre.
      const propria = _cotLogoPropria(o.nome);
      if (propria) {
        const alvoP = document.querySelector('.job-cot-op[data-id="' + String(o.id).replace(/"/g, '') + '"]');
        if (alvoP && !alvoP.querySelector('img')) {
          const imgP = document.createElement('img');
          imgP.alt = ''; imgP.src = propria;
          alvoP.insertBefore(imgP, alvoP.firstChild);
        }
        _cotLogos[chave] = propria;
        continue;
      }
      if (!o.logotipo) continue;                 // o Painel não tem logo dessa: a inicial é a resposta
      let dado = _cotLogos[chave];
      // FRACASSO NÃO É PERMANENTE.
      //
      // Eu guardava a falha como string vazia e nunca mais tentava. Um soluço
      // de rede, ou o Painel lento naquele segundo, apagava a logo daquela
      // operadora para sempre — foi o que aconteceu com a Select. Agora a falha
      // é guardada COM A DATA e se refaz depois de três dias; o acerto continua
      // guardado para sempre, que é o que evita rede à toa.
      if (typeof dado === 'string' && dado) { /* já temos */ }
      else {
        const falha = _cotLogos['x' + chave];
        const recente = falha && (Date.now() - falha) < 3 * 24 * 3600 * 1000;
        if (recente) continue;
        let r = null;
        try { r = await _safeSendMessage({ type: 'logo_operadora', url: o.logotipo }); }
        catch (e) { r = null; }
        dado = (r && r.ok && r.dataUrl) || '';
        if (dado) {
          _cotLogos[chave] = dado;
          try { chrome.storage.local.set({ [chave]: dado }); } catch (e) {}
        } else {
          _cotLogos['x' + chave] = Date.now();
          try { chrome.storage.local.set({ ['x' + chave]: Date.now() }); } catch (e) {}
        }
      }
      if (!dado) continue;
      const alvo = document.querySelector('.job-cot-op[data-id="' + String(o.id).replace(/"/g, '') + '"]');
      if (!alvo || alvo.querySelector('img')) continue;
      const img = document.createElement('img');
      img.alt = '';
      img.src = dado;
      alvo.insertBefore(img, alvo.firstChild);
    }
  }


  // ── MÍNIMO DE VIDAS PARA CONTRATAR (PME) ────────────────────────────────
  //
  // NÃO CONFUNDIR com a faixa da tabela de preço. "Esta tabela vale de 5 a 29
  // vidas" não quer dizer que a operadora só vende a partir de 5 — quer dizer
  // que, para menos, o preço vem de OUTRA tabela, que a gente pode nem ter
  // visto ainda. Foi essa confusão que quase me fez bloquear venda de verdade:
  // no catálogo, a Amil aparece só com a faixa 5-29, e os PDFs dela têm 2 e
  // 3-4 vidas.
  //
  // Então o mínimo de CONTRATAÇÃO vem daqui — regra comercial, dita pelo
  // Guilherme — e as faixas continuam servindo só pra escolher a tabela certa.
  //
  // Um dia isto deve virar cadastro no JOB. Enquanto for lista, mora num lugar
  // só e é este.
  const _COT_MIN_VIDAS_PADRAO = 2;
  const _COT_MIN_VIDAS = [
    { casa: /meds[eê]nior|med s[eê]nior/i,      min: 1 },
    { casa: /hapvida|notre ?dame/i,             min: 1 },
    { casa: /benefic[eê]ncia/i,                 min: 1 },
    { casa: /sulam[eé]rica|sul am[eé]rica/i,    min: 3 },
    { casa: /bradesco/i,                        min: 3 },
    { casa: /porto seguro/i,                    min: 3 },
  ];

  function _cotMinVidas(nomeOperadora) {
    const n = String(nomeOperadora || '');
    for (const r of _COT_MIN_VIDAS) if (r.casa.test(n)) return r.min;
    return _COT_MIN_VIDAS_PADRAO;
  }

  function _cotPintarOperadoras() {
    const ops = _cot.operadoras || [];
    // PME é o único com mínimo de vidas; PF e adesão são por pessoa.
    const ehPME = String(_cot.modalidade) === '2';
    const totalVidas = _cot.totalVidas || 0;
    setCorpoSecao(
      _cotCabecalho(_cotTopo(abrirSecaoCotarInline, 'Cotar agora'), 'Operadoras',
        ops.length ? '<span class="job-sec-cont">' + ops.length + '</span>' : '') +
      '<div class="job-cot-wrap">' +
      '<div class="job-sec-sub">Escolha uma de cada vez — cada uma que você cotar soma no mesmo comparativo.</div>' +
      '<div id="job-cot-comp">' + _cotSacolaHTML(true) + '</div>' +
      '<div class="job-cot-fonte-t" style="margin-bottom:8px">Pelo Painel do Corretor</div>' +
      (ops.length
        ? '<div class="job-cot-ops">' + ops.map((o) => {
            const jaFoi = _cotFeitas.filter((f) => String(f.operadoraId) === String(o.id))[0];
            // A logo é da tela deles e pode ser barrada pela política de imagem
            // do WhatsApp Web. Por isso ela é ENFEITE: some sozinha se não
            // carregar (onerror), e o nome continua respondendo pela linha.
            // Operadora que não aceita essa quantidade de vidas aparece
            // APAGADA e dizendo o porquê, em vez de deixar cotar e a proposta
            // ser recusada depois de assinada.
            const minV = ehPME ? _cotMinVidas(o.nome) : 1;
            const bloqueada = ehPME && totalVidas > 0 && totalVidas < minV;
            return '<button type="button" class="job-cot-op' + (jaFoi ? ' feita' : '') +
              (bloqueada ? ' bloqueada" disabled title="' +
                 esc(o.nome + ' exige no mínimo ' + minV + ' vidas no PME') + '"' : '"') +
              ' data-id="' + esc(o.id) + '">' +
              // A INICIAL É O PADRÃO, a logo entra por cima quando existir.
              //
              // Antes eu punha <img src="https://..."> com onerror inline. Duas
              // coisas erradas: a página do WhatsApp barra imagem de outro
              // endereço, E bloqueia handler inline — então o fallback nunca
              // rodava e o que aparecia era o ícone de imagem quebrada em toda
              // linha. Agora a logo vem do service worker já como data:, e só
              // é desenhada depois de estar na mão.
              '<span class="job-cot-op-ini">' + esc((o.nome || '?').trim().charAt(0).toUpperCase()) + '</span>' +
              '<span class="job-cot-op-n">' + esc(o.nome) + '</span>' +
              (bloqueada ? '<span class="job-cot-op-min">mín. ' + minV + ' vidas</span>' : '') +
              (jaFoi ? '<span class="job-cot-op-ok">' + jaFoi.planos.length +
                       (jaFoi.planos.length === 1 ? ' plano' : ' planos') + '</span>' : '') +
            '</button>';
          }).join('') + '</div>'
        : '<div class="job-cot-vazio"><div class="job-cot-vazio-t">Nenhuma operadora atende essa combinação.</div>' +
          '<div class="job-cot-vazio-s">Quem atende muda com a idade e o tipo. Confira a cidade e as idades.</div></div>') +
      // DUAS FONTES, UMA TELA. Em cima o que vem do Painel do Corretor (preco
      // ao vivo, na sessao dele); embaixo as tabelas importadas no JOB, que e
      // onde vivem MedSenior, Beneficencia Vital, Santa Tereza e as grades de
      // PDF da Hapvida. O comparativo e o mesmo pras duas, entao dá pra
      // misturar — que era exatamente o que nao dava.
      '<div class="job-cot-fonte">' +
        '<div class="job-cot-fonte-t">Operadoras fora do Painel</div>' +
        '<div class="job-cot-fonte-s">MedSênior, Beneficência Vital, Santa Tereza e outras ' +
          'que o Painel não cota. Marque planos aqui e eles entram no ' +
          '<b>mesmo comparativo</b> das de cima.</div>' +
        '<div id="job-cot-ops-job">' + _cotBlocoOpsJob() + '</div>' +
      '</div>' +
      '<button class="job-cot-nova" id="job-cot-voltar" style="border:none;cursor:pointer;width:100%;font-family:inherit">Mudar dados</button>' +
    '</div>');
    // A lista do JOB chega depois e repinta so o pedaco dela — a lista do
    // Painel, que ja esta na mao, nao pisca.
    const ligarJob = () => {
      document.querySelectorAll('#job-cot-ops-job .job-cot-op').forEach((b) =>
        b.addEventListener('click', () => _cotBuscarPlanosJob(b.dataset.job)));
    };
    if (_cotOpsJob === null) {
      _cotCarregarOpsJob().then(() => {
        const cx = document.getElementById('job-cot-ops-job');
        if (cx) { cx.innerHTML = _cotBlocoOpsJob(); ligarJob(); }
      });
    } else { ligarJob(); }
    _cotSacolaLigar(_cotPintarOperadoras);
    _cotTopoLigar(abrirSecaoCotarInline);
    const bmd = document.getElementById('job-cot-voltar');
    if (bmd) bmd.addEventListener('click', abrirSecaoCotarInline);
    document.querySelectorAll('.job-cot-op').forEach((b) => b.addEventListener('click', () => {
      const o = ops.filter((x) => String(x.id) === b.dataset.id)[0];
      if (o) _cotBuscarPlanos(o);
    }));
    _cotPintarLogos(ops);   // as logos chegam depois; a lista já funciona sem elas
  }

  // ── SEGUNDA FONTE: AS TABELAS DO PROPRIO JOB ─────────────────────────────
  //
  // A cotacao so falava com o Painel do Corretor. MedSenior, Beneficencia
  // Vital, Santa Tereza e as grades de PDF da Hapvida nao estao la — estao no
  // JOB, importadas de PDF. Por isso nao dava pra cotar 59 anos na
  // Beneficencia nem misturar operadoras: nao era limitacao de tela, era fonte
  // desligada.
  //
  // As duas fontes caem no MESMO _cotFeitas, entao o comparativo mistura e o
  // "Salvar no JOB" salva tudo junto.
  let _cotOpsJob = null;        // null = ainda nao buscou; [] = buscou e nao ha
  let _cotOpsJobErro = '';

  // Traduz uma tabela do JOB pro formato que o resto da tela ja entende.
  // Sem MEI de proposito: a tabela do JOB nao tem essa coluna, e o nivel de
  // gaveta correspondente se apaga sozinho quando so ha um valor.
  function _cotDoJob(x) {
    const cop = String(x.coparticipacao || '').trim();
    const semCop = !cop || /^(sem|nao|não|0|-)$/i.test(cop);
    return {
      _job: true,
      _planoId: x.id != null ? x.id : x.plano_id,
      plano: { nome: x.plano || 'Plano', acomodacaoTxt: (x.acomodacao || '').trim() },
      // A abrangencia e o que separa MedSenior Campinas 1 de Campinas 2 — e
      // por isso ela ocupa o lugar do produto na arvore de gavetas.
      produto: { nome: (x.abrangencia || '').trim() },
      // MEI COM TRES ESTADOS, nao dois. `true` = a tabela aceita; `false` =
      // esta escrito que nao aceita; `null` = NINGUEM PREENCHEU.
      // Achatar os tres em booleano foi o que travou a venda: sem o campo, o
      // plano caia em "nao aceita" e sumia a operadora inteira pro cliente MEI.
      tabela: { coparticipacao: !semCop, coparticipacaoTipo: cop,
                mei: (x.mei === true || x.mei === 1) ? true
                     : ((x.mei === false || x.mei === 0) ? false : null),
                qtdVidaMin: x.vidas_min || 0, qtdVidaMax: x.vidas_max || 0 },
      operadora: { nome: x.operadora || '' },
      vigencia: x.vigencia || '',
    };
  }

  async function _cotCarregarOpsJob() {
    let r = null;
    try { r = await _safeSendMessage({ type: 'cotacao_tabelas', somenteOperadoras: true }); }
    catch (e) { r = null; }
    if (r && r.ok && Array.isArray(r.operadoras)) { _cotOpsJob = r.operadoras; return; }
    // Sem o filtro `?operadoras=1` no servidor ainda: monta a lista a partir
    // da resposta cheia. Funciona, so gasta mais — e some quando o filtro
    // existir.
    if (r && r.ok && Array.isArray(r.planos)) {
      const m = new Map();
      r.planos.forEach((x) => m.set(x.operadora, (m.get(x.operadora) || 0) + 1));
      _cotOpsJob = Array.from(m, ([nome, planos]) => ({ nome: nome, planos: planos }))
        .filter((o) => o.nome).sort((a, b) => a.nome.localeCompare(b.nome));
      return;
    }
    _cotOpsJob = [];
    // O MOTIVO APARECE NA TELA. "Nao carregou" manda o consultor abrir chamado;
    // "entre no popup" ele resolve em dez segundos.
    _cotOpsJobErro = (r && r.erro) || 'Não consegui falar com o JOB agora.';
  }

  function _cotBlocoOpsJob() {
    if (_cotOpsJob === null) {
      return '<div class="job-cot-dica">Vendo as tabelas do JOB…</div>';
    }
    if (!_cotOpsJob.length) {
      return '<div class="job-cot-dica">' + esc(_cotOpsJobErro ||
        'Nenhuma tabela importada no JOB ainda. Importe em Cotações → Tabelas.') + '</div>';
    }
    return '<div class="job-cot-ops">' + _cotOpsJob.map((o) => {
      const jaFoi = _cotFeitas.filter((f) => String(f.operadoraId) === 'job:' + o.nome)[0];
      return '<button type="button" class="job-cot-op' + (jaFoi ? ' feita' : '') +
        '" data-job="' + esc(o.nome) + '">' +
        '<span class="job-cot-op-ini">' + esc((o.nome || '?').trim().charAt(0).toUpperCase()) + '</span>' +
        '<span class="job-cot-op-n">' + esc(o.nome) + '</span>' +
        (jaFoi ? '<span class="job-cot-op-ok">' + jaFoi.planos.length +
                 (jaFoi.planos.length === 1 ? ' plano' : ' planos') + '</span>'
               : '<span class="job-cot-op-min">' + o.planos + ' tabelas</span>') +
      '</button>';
    }).join('') + '</div>';
  }

  async function _cotBuscarPlanosJob(nome) {
    _cotEsperando('Vendo as tabelas de ' + nome + '…', '', _cotPintarOperadoras, 'Operadoras');
    const g = _cotGer;
    let r = null;
    try {
      r = await _safeSendMessage({ type: 'cotacao_tabelas', operadora: nome,
                                   modalidade: _cotRotulo(_cot.modalidade) });
    } catch (e) { r = null; }
    if (g !== _cotGer) return;
    const lista = (r && r.ok && Array.isArray(r.planos)) ? r.planos : null;
    if (!lista) { _cotErro((r && r.erro) || 'tabelas_do_job', _cotPintarOperadoras); return; }
    _cot.operadoraAtual = { id: 'job:' + nome, nome: nome, fonte: 'job' };
    _cot.planos = lista.map(_cotDoJob);
    _cotPintarPlanos();
  }

  // Preco das tabelas do JOB: UMA chamada com todos os planos marcados, contra
  // as idades cruas. E por isso que 59 anos funciona aqui sem faixa — o motor
  // do JOB faz a conta da faixa sozinho, do mesmo jeito que o site faz.
  async function _cotPrecosJob(alvo, emLote) {
    _cotEsperando('Calculando ' + alvo.length + (alvo.length === 1 ? ' plano…' : ' planos…'),
                  '', _cotPintarPlanos, 'Planos');
    const g = _cotGer;
    const idades = String(_cot.idades || '').split(/[^0-9]+/)
      .map((s) => parseInt(s, 10)).filter((n) => !isNaN(n) && n >= 0 && n <= 120);
    if (!idades.length) { _cotErro('sem_idades_para_calcular', _cotPintarPlanos); return; }
    let r = null;
    try {
      r = await _safeSendMessage({ type: 'cotacao_tabelas_calcular', idades: idades,
                                   planos: alvo.map((p) => p._planoId) });
    } catch (e) { r = null; }
    if (g !== _cotGer) return;
    if (!r || !r.ok) { _cotErro((r && r.erro) || 'tabelas_do_job', _cotPintarPlanos); return; }
    const porId = {};
    (r.resultados || []).forEach((x) => { porId[String(x.plano_id)] = x; });
    // AVISO DO MOTOR VIRA MOTIVO NA LINHA. Plano fora da faixa de vidas ou com
    // preco faltando em uma faixa some do calculo — sem isto ele sumiria da
    // tela sem explicacao, e o consultor acharia que a extensao engoliu.
    const motivo = {};
    (r.avisos || []).forEach((a) => { motivo[String(a.plano_id)] = a.mensagem || a.codigo; });
    const feitos = alvo.map((p) => {
      const x = porId[String(p._planoId)];
      return Object.assign({}, p, (x && x.elegivel)
        // `unitario` e o nome que o servidor le ao salvar (ele escreve
        // f['unitario']); o motor do JOB chama de `preco`. Sem esta linha a
        // cotacao salva sai com as faixas zeradas no documento do cliente.
        ? { total: x.total, conferido: true,
            faixas: (x.linhas || []).map((l) => Object.assign({ unitario: l.preco }, l)) }
        : { total: null, motivo: motivo[String(p._planoId)] || 'sem_valor_na_resposta' });
    });
    feitos.sort((a, b) => (a.total == null) - (b.total == null) || (a.total - b.total));
    _cot.resultado = feitos;
    _cotFeitas = _cotFeitas.filter((f) => String(f.operadoraId) !== String(_cot.operadoraAtual.id));
    _cotFeitas.push({ operadoraId: _cot.operadoraAtual.id,
                      nome: _cot.operadoraAtual.nome, planos: feitos });
    // ADIANTA A REDE E A DECODIFICACAO, antes de ele clicar em "Ver imagem".
    _cotPreAquecer();
    if (!emLote) _cotPintarResultado();
  }

  async function _cotBuscarPlanos(op) {
    _cotEsperando('Vendo os planos da ' + op.nome + '…', '', _cotPintarOperadoras, 'Operadoras');
    const g = _cotGer;
    const r = await _cotPasso(Object.assign({ acao: 'planos', cotacaoId: _cot.cotacaoId,
                                             operadoraId: op.id }, _cotBase()));
    if (g !== _cotGer) return;            // ele saiu; nao pinta por cima
    if (!r.ok) { _cotErro(r.motivo, _cotPintarOperadoras); return; }
    _cot.operadoraAtual = op;
    _cot.planos = (r.dados && r.dados.planos) || [];
    _cotPintarPlanos();
  }


  // ── AS GAVETAS DA LISTA DE PLANOS ────────────────────────────────────────
  //
  // Uma operadora devolve vinte e poucos planos que, na lista corrida, parecem
  // vinte repetições do mesmo nome. O que separa um do outro são coisas que o
  // consultor conhece de cor — produto, coparticipação, acomodação, MEI — e é
  // por elas que a lista tem que estar dividida.
  //
  // Duas gavetas, não cinco: PRODUTO por fora (é o que muda rede e preço) e
  // COPARTICIPAÇÃO por dentro (é a primeira pergunta que o cliente faz). O
  // resto continua como etiqueta na linha, porque virar gaveta deixaria cada
  // uma com um plano só — e gaveta de um item é ruído, não organização.
  // ORDEM DAS GAVETAS — decidida pelo Guilherme, e ela nao muda:
  //
  //     OPERADORA  >  MEI / nao MEI  >  coparticipacao  >  PRODUTO
  //
  // E a ordem em que ele elimina opcao na frente do cliente. MEI vem primeiro
  // porque nao se negocia: ou a tabela aceita ou nao aceita, e isso corta
  // metade da lista antes de qualquer conversa. Depois vem a coparticipacao,
  // que o cliente pergunta sozinho. So entao o produto, que e onde se compara
  // rede e preco. A tela estava ao contrario — produto por fora, sem nivel de
  // MEI nenhum — e ele reclamou disso mais de uma vez.
  const _COT_NIVEIS = [
    { chave: 'mei',     de: (tb) => (tb.mei === true ? 'Aceita MEI' : 'Não aceita MEI') },
    { chave: 'copart',  de: (tb, p) => _cotCopart(tb) },
    { chave: 'produto', de: (tb, p) => _texto(p && p.produto) || 'Sem produto definido' },
  ];

  // Arvore de grupos na ordem acima. Cada no e { rotulo, filhos: Map, itens: [] }.
  //
  // NIVEL COM UM VALOR SO NAO VIRA GAVETA. Gaveta de item unico cobra um
  // clique e nao separa nada — some, e o valor dela sobe pro cabecalho como
  // etiqueta comum, que e onde ele ja aparece.
  function _cotArvore(pls, idxs, nivel) {
    if (nivel >= _COT_NIVEIS.length) return { folha: true, itens: idxs };
    const n = _COT_NIVEIS[nivel];
    const m = new Map();
    idxs.forEach((i) => {
      const p = pls[i];
      const r = n.de((p && p.tabela) || {}, p);
      if (!m.has(r)) m.set(r, []);
      m.get(r).push(i);
    });
    if (m.size <= 1) return _cotArvore(pls, idxs, nivel + 1);   // nivel mudo: pula
    const filhos = new Map();
    m.forEach((sub, rotulo) => filhos.set(rotulo, _cotArvore(pls, sub, nivel + 1)));
    return { folha: false, chave: n.chave, filhos: filhos };
  }

  function _cotContar(no) {
    if (no.folha) return no.itens.length;
    let n = 0; no.filhos.forEach((f) => { n += _cotContar(f); });
    return n;
  }

  // Desenha a arvore. `prof` so muda a casca visual: a de fora e o cartao, as
  // de dentro sao linhas recuadas — tres cartoes encaixados num painel de 380
  // pixels viram uma escada de bordas e o consultor perde o fio.
  function _cotArvoreHTML(no, linha, prof) {
    if (no.folha) return no.itens.map(linha).join('');
    let html = '';
    no.filhos.forEach((filho, rotulo) => {
      const cls = prof === 0 ? 'job-cot-gaveta' : 'job-cot-subgaveta';
      // FECHADAS. Aberto, o consultor rola uma lista longa procurando o que
      // quer; fechado, ele le os titulos e abre um. Quem sabe o que procura
      // chega mais rapido — e e sempre o caso aqui.
      html += '<details class="' + cls + ' job-cot-nivel-' + esc(no.chave) + '">' +
        '<summary><span class="job-cot-gaveta-n">' + esc(rotulo) + '</span>' +
        '<span class="job-cot-gaveta-q">' + _cotContar(filho) + '</span></summary>' +
        _cotArvoreHTML(filho, linha, prof + 1) +
      '</details>';
    });
    return html;
  }

  function _cotPintarPlanos() {
    const pls = _cot.planos || [];
    // O QUE É IGUAL EM TODOS SOBE PRO CABEÇALHO.
    //
    // A lista repetia "Aceita MEI · 2 a 2 vidas · Amil Saúde - Interior I" em
    // TODAS as linhas. Atributo que não varia não distingue plano nenhum: só
    // empurra pra baixo o que decide (acomodação e coparticipação) e faz sete
    // planos parecerem o mesmo. Comum em cima, diferente na linha.
    const porPlano = pls.map((p) => _cotEtiquetas(p));
    const comuns = pls.length > 1
      ? porPlano[0].filter((e) => porPlano.every((lista) => lista.some((x) => x.t === e.t)))
      : [];
    const eComum = (t) => comuns.some((c) => c.t === t);

    const logoTopo = _cotLogos[_cotChaveLogo(_cot.operadoraAtual.nome)];
    setCorpoSecao(
      _cotCabecalho(_cotTopo(_cotPintarOperadoras, 'Operadoras'), esc(_cot.operadoraAtual.nome)) +
      '<div class="job-cot-wrap">' +
      (logoTopo ? '<img class="job-cot-logo-topo" src="' + esc(logoTopo) + '" alt="">' : '') +
      (comuns.length
        ? '<div class="job-cot-tags job-cot-tags-topo">' + comuns.map((e) =>
            '<span class="job-cot-tag' + (e.c ? ' ' + e.c : '') + '">' + esc(e.t) + '</span>').join('') +
          '</div>'
        : '') +
      '<div class="job-sec-sub">Vale para todos os planos abaixo.</div>' +
      '<div id="job-cot-comp">' + _cotSacolaHTML() + '</div>' +
      (pls.length
        ? (function () {
            const linha = (i) => {
              const proprias = porPlano[i].filter((e) => !eComum(e.t));
              const ch = _cotChaveDe(pls[i], _cot.operadoraAtual.id);
              // SABENDO QUE E MEI, o que nao aceita MEI nao pode ser marcado.
              //
              // Pedido dele: "caso seja empresarial mesmo, liberar apenas as
              // opcoes que condiz com o CNPJ". Bloqueado e nao escondido: some
              // da tela ele procuraria o plano e acharia que a extensao perdeu;
              // bloqueado com o motivo escrito, ele entende em um segundo.
              // AUSENCIA DE INFORMACAO NAO E "NAO ACEITA".
              //
              // A regra era `mei !== true`. Como as tabelas do JOB nem
              // devolviam o campo, TODO plano de operadora fora do Painel
              // aparecia bloqueado pra cliente MEI — Vera Cruz, MedSenior,
              // Beneficencia, todas. Quatro linhas cinzas e o botao morto, sem
              // uma palavra dizendo por que. Venda que existe, travada por um
              // campo em branco.
              //
              // Agora so bloqueia quando esta escrito que NAO aceita. Quando
              // ninguem preencheu, libera e avisa — decidir por falta de dado
              // e o consultor perdendo negocio calado.
              const _meiTab = (pls[i].tabela || {}).mei;
              const naoServeMei = !!(_cot.clienteMei && _meiTab === false);
              const meiDuvida = !!(_cot.clienteMei && (_meiTab === null || _meiTab === undefined));
              // A marcacao sobrevive a troca de operadora: quem ja esta na
              // sacola volta marcado quando ele volta pra ca.
              return '<label class="job-cot-plano' + (naoServeMei ? ' bloq' : '') + '"' +
                (naoServeMei ? ' title="Esta tabela não aceita MEI"' : '') + '>' +
                '<input type="checkbox" data-i="' + i + '"' +
                ' data-chave="' + esc(ch) + '"' + (naoServeMei ? ' disabled' : '') +
                (_cotNaSacola(ch) && !naoServeMei ? ' checked' : '') + '>' +
                '<span><b>' + esc(_cotNomePlano(pls[i])) + '</b>' +
                (proprias.length
                  ? '<span class="job-cot-tags">' + proprias.map((e) =>
                      '<span class="job-cot-tag' + (e.c ? ' ' + e.c : '') + '">' + esc(e.t) + '</span>').join('') +
                    '</span>'
                  : '') +
                (naoServeMei ? '<span class="job-cot-porque">Não aceita MEI</span>' : '') +
                (meiDuvida ? '<span class="job-cot-porque aviso">Confirme se aceita MEI</span>' : '') +
                '</span></label>';
            };
            const arvore = _cotArvore(pls, pls.map((p, i) => i), 0);
            // Poucos planos e nenhum nivel que separe: lista corrida mesmo.
            if (arvore.folha && pls.length <= 6) return pls.map((p, i) => linha(i)).join('');
            return _cotArvoreHTML(arvore, linha, 0);
          })()
        : '<div class="job-cot-vazio"><div class="job-cot-vazio-t">Nenhum plano serve para essas vidas</div>' +
          '<div class="job-cot-vazio-s">Cada operadora tem um mínimo de vidas e faixas próprias. Tente outra operadora ou revise a quantidade.</div></div>') +
      '<button class="job-cot-bt-mandar" id="job-cot-precos" style="width:100%;margin-top:12px" disabled>Marque um plano</button>' +
      '<button class="job-cot-nova" id="job-cot-volta-ops" style="border:none;cursor:pointer;width:100%;font-family:inherit">Outra operadora</button>' +
    '</div>');
    const bt = document.getElementById('job-cot-precos');
    // O teto e da SACOLA, nao da tela: seis planos e o que cabe num
    // comparativo que o cliente le, venham de uma operadora ou de quatro.
    const atualizar = () => {
      const n = _cotSacola.length;
      document.querySelectorAll('.job-cot-plano input').forEach((o) => {
        // `.bloq` posto na pintura (MEI) manda mais que o teto: reabilitar
        // aqui devolveria o clique num plano que a empresa nao pode contratar.
        if (o.parentElement.hasAttribute('title')) return;
        o.disabled = (n >= _COT_MAX && !o.checked);
        o.parentElement.classList.toggle('bloq', o.disabled);
      });
      bt.disabled = !n;
      bt.textContent = n ? 'Ver preços (' + n + ')' : 'Marque um plano';
      const cx = document.getElementById('job-cot-comp');
      if (cx) { cx.innerHTML = _cotSacolaHTML(); _cotSacolaLigar(_cotPintarPlanos); }
    };
    document.querySelectorAll('.job-cot-plano input').forEach((c) => c.addEventListener('change', () => {
      const p = pls[+c.dataset.i], ch = c.dataset.chave;
      if (c.checked) {
        if (!_cotNaSacola(ch)) {
          _cotSacola.push({ chave: ch, nome: _cotNomePlano(p), plano: p,
                            operadoraId: _cot.operadoraAtual.id,
                            operadoraNome: _cot.operadoraAtual.nome,
                            fonte: _cot.operadoraAtual.fonte || 'painel' });
        }
      } else { _cotSacolaTirar(ch); }
      atualizar();
    }));
    atualizar();
    _cotTopoLigar(_cotPintarOperadoras);
    document.getElementById('job-cot-volta-ops').addEventListener('click', _cotPintarOperadoras);
    bt.addEventListener('click', () => _cotPrecosSacola());
  }

  // COTA A SACOLA INTEIRA, uma operadora de cada vez.
  //
  // Antes o botao cotava so o que estava marcado NA TELA — montar tres
  // operadoras exigia cotar, voltar, cotar de novo, e ele so via a proposta
  // completa no fim. Agora ele monta tudo e manda uma vez.
  //
  // Cada fonte tem o seu jeito: o Painel e sequencial por imposicao dele (a
  // resposta nao diz de qual plano e), as tabelas do JOB sao uma chamada so.
  async function _cotPrecosSacola() {
    const grupos = [];
    _cotSacola.forEach((x) => {
      let g = grupos.filter((y) => y.id === x.operadoraId)[0];
      if (!g) { g = { id: x.operadoraId, nome: x.operadoraNome, fonte: x.fonte, planos: [] };
                grupos.push(g); }
      g.planos.push(x.plano);
    });
    for (let i = 0; i < grupos.length; i++) {
      const g = grupos[i];
      _cot.operadoraAtual = { id: g.id, nome: g.nome, fonte: g.fonte };
      const g0 = _cotGer;
      if (g.fonte === 'job') await _cotPrecosJob(g.planos, grupos.length > 1);
      else await _cotPrecos(g.planos, grupos.length > 1);
      if (g0 !== _cotGer) return;      // ele saiu no meio
    }
    _cotPintarResultado();
  }

  // Preço é sequencial por imposição do Painel: a resposta traz os cenários
  // juntos, sem dizer qual é de qual plano — a diferença pra resposta anterior
  // é o plano que se acabou de pedir. Ordem sorteada porque duas cotações da
  // mesma cidade produziriam a mesma sequência de chamadas, e sequência
  // repetida é padrão.
  // `emLote`: veio da sacola com mais de uma operadora. Ai quem pinta o
  // comparativo e o laco, no fim — senao a tela pisca uma vez por operadora.
  async function _cotPrecos(alvo, emLote) {
    const fila = _cotEmbaralhar(alvo);
    const feitos = [];
    // Sair no meio da busca PARA a busca. Sem a guarda, a seta so trocava a
    // tela e o laco seguia batendo no Painel por tras — rastro de maquina
    // pedindo preco de uma cotacao que ninguem esta mais olhando.
    const g = _cotGer;
    for (let i = 0; i < fila.length; i++) {
      setCorpoSecao(_cotTopo(_cotPintarPlanos, 'Planos') +
        _secHead('Buscando preços',
        esc(_cot.operadoraAtual.nome), (i + 1) + '/' + fila.length) +
        '<div class="job-cot-wrap">' +
        '<div class="job-cot-barra"><i style="width:' + Math.round((i / fila.length) * 100) + '%"></i></div>' +
        (feitos.length ? _cotCartoes(feitos) : '') +
        '<div class="job-cot-dica">Um plano por vez, com pausa entre eles — é assim que o Painel é usado à mão.</div>' +
      '</div>');
      _cotTopoLigar(() => { _cotGer++; _cotPintarPlanos(); });
      const r = await _cotPasso(Object.assign({ acao: 'preco', cotacaoId: _cot.cotacaoId,
                                               plano: fila[i] }, _cotBase()));
      if (g !== _cotGer) return;
      const cartao = (r.ok && r.dados && r.dados.cartao) || null;
      // Sem valor NÃO inventa e não some: entra marcado como não cotado. Preço
      // errado numa proposta é pior que preço faltando.
      feitos.push(Object.assign({}, fila[i], cartao
        ? { total: cartao.total, faixas: cartao.faixas, conferido: cartao.conferido }
        : { total: null, motivo: r.motivo || 'sem_valor_na_resposta' }));
      // CAMINHO MORTO NAO SE TENTA SEIS VEZES.
      //
      // "Sem preco pra este plano" e resposta: o Painel respondeu e aquele
      // plano nao tem valor. Ja "nao respondeu ninguem" nao e sobre o plano —
      // e o caminho inteiro que caiu, e ele vai cair igual nos proximos. Com
      // seis planos e 45s cada, insistir custava quatro minutos e meio de tela
      // parada pra chegar no mesmo lugar. Os que sobram entram marcados, nao
      // somem: continua sem preco inventado.
      if (!cartao && _COT_CAMINHO_MORTO[r.motivo]) {
        for (let j = i + 1; j < fila.length; j++) {
          feitos.push(Object.assign({}, fila[j], { total: null, motivo: r.motivo }));
        }
        break;
      }
      if (i + 1 < fila.length) { await _cotRespira(240, 780); if (g !== _cotGer) return; }
    }
    feitos.sort((a, b) => (a.total == null) - (b.total == null) || (a.total - b.total));
    _cot.resultado = feitos;
    // Acumula por operadora. Cotar a segunda apagava a primeira da tela — e
    // comparar duas operadoras é o motivo de existir um multicálculo.
    _cotFeitas = _cotFeitas.filter((f) => String(f.operadoraId) !== String(_cot.operadoraAtual.id));
    _cotFeitas.push({ operadoraId: _cot.operadoraAtual.id,
                      nome: _cot.operadoraAtual.nome, planos: feitos });
    // ADIANTA A REDE E A DECODIFICACAO, antes de ele clicar em "Ver imagem".
    _cotPreAquecer();
    if (!emLote) _cotPintarResultado();
  }

  // SEM SELO DE "MAIS BARATO".
  //
  // Tinha um, e saiu por decisão do Guilherme: o preço já está do lado, o
  // consultor sabe ler, e esse texto pode acabar num print ou num texto
  // copiado pro cliente. Rotular plano de saúde como "o mais barato" é um
  // enquadramento que ofende — o cliente não está procurando o mais barato,
  // está procurando o que resolve.
  function _cotCartoes(lista) {
    const mudam = _cotDiferencas(lista);
    return lista.map((p) => {
      let dif = mudam ? _cotEtiquetas(p).filter((e) => mudam[e.k]) : [];
      // Se ainda assim nada difere, a diferenca existe e esta num campo que
      // nem o Painel manda. Dizer isso e melhor que quatro linhas identicas.
      if (mudam && !dif.length) {
        dif = [{ k: 'x', t: 'condições diferentes', c: '' }];
      }
      return '<div class="job-cot-res' + (p.total == null ? ' sem' : '') + '">' +
        '<div class="job-cot-res-n">' + esc(_cotNomePlano(p)) +
          (dif.length ? '<span class="job-cot-res-dif">' + dif.map((e) =>
            '<span class="job-cot-tag' + (e.c ? ' ' + e.c : '') + '">' +
            esc(e.t) + '</span>').join('') + '</span>' : '') +
        '</div>' +
        '<div class="job-cot-res-v">' +
          (p.total == null ? 'sem preço' : _cotMoeda(p.total)) +
        '</div>' +
      '</div>';
    }).join('');
  }

  function _cotPintarResultado() {
    const todos = _cotFeitas.reduce((a, f) => a.concat(f.planos), []);
    const comPreco = todos.filter((p) => p.total != null);
    // GAVETA POR OPERADORA, como o Painel faz.
    //
    // Empilhado, cotar três operadoras vira uma lista de vinte linhas e o
    // consultor rola pra achar. Fechada, cada operadora cabe numa linha com o
    // resumo que interessa — quantos planos e a partir de quanto. A última
    // cotada abre sozinha, porque é a que ele acabou de pedir.
    const grupos = _cotFeitas.map((f, i) => {
      const cp = f.planos.filter((p) => p.total != null);
      const menor = cp.length ? cp.reduce((m, p) => Math.min(m, p.total), Infinity) : null;
      const aberta = (i === _cotFeitas.length - 1);
      const logo = _cotLogos[_cotChaveLogo(f.nome)];
      return '<div class="job-cot-gaveta' + (aberta ? ' aberta' : '') + '" data-op="' + esc(f.operadoraId) + '">' +
        '<button type="button" class="job-cot-gaveta-t">' +
          (logo ? '<img src="' + esc(logo) + '" alt="">' : '') +
          '<span class="job-cot-gaveta-n">' + esc(f.nome) + '</span>' +
          '<span class="job-cot-gaveta-r">' + f.planos.length +
            (menor != null ? ' · desde ' + _cotMoeda(menor) : '') + '</span>' +
          '<span class="job-cot-gaveta-s"></span>' +
        '</button>' +
        '<div class="job-cot-gaveta-c">' + _cotCartoes(f.planos) + '</div>' +
      '</div>';
    }).join('');

    // Sem subtítulo: a migalha do topo já diz cidade, tipo e vidas, e ainda
    // é clicável pra mudar. Repetir logo abaixo é eco.
    setCorpoSecao(
      _cotCabecalho(_cotTopo(_cotPintarOperadoras, 'Operadoras'), 'Comparativo',
        comPreco.length ? '<span class="job-sec-cont">' + comPreco.length + '</span>' : '') +
      '<div class="job-cot-wrap">' +
      grupos +
      (comPreco.length
        // UMA ação principal. As outras existem, mas não competem: salvar é o
        // que transforma isto em cotação de verdade — com link, documento e
        // registro no lead. O resto é atalho.
        ? '<button class="job-cot-bt-mandar" id="job-cot-salvar" style="width:100%;margin-top:12px" ' +
            'title="Cria a cotação no JOB: gera o link do cliente, entra na ficha do lead e em Cotações salvas">' +
            'Salvar no JOB</button>' +
          // O ÓBVIO PRECISA SER DITO. Quem só quer ver preço não é obrigado a
          // salvar — e quem quer mandar pro cliente precisa saber que link,
          // imagem, legenda e apresentação só nascem depois de salvar. Sem
          // esta linha, a pessoa fica procurando botão que ainda não existe.
          '<div class="job-cot-dica">Consultar não salva nada. Salve para liberar ' +
            'o link do cliente, a imagem, a legenda e a apresentação.</div>' +
          '<div class="job-cot-dica" id="job-cot-salvo"></div>' +
          '<div id="job-cot-pos"></div>' +
          '<div class="job-cot-rodape">' +
            '<button type="button" id="job-cot-mandar" title="Manda os preços como texto simples, sem link nem apresentação">' +
              'Mandar preços em texto</button>' +
            '<button type="button" id="job-cot-mais" title="Volta à lista de operadoras e soma ao comparativo">' +
              'Cotar outra operadora</button>' +
          '</div>'
        : '<div class="job-ia-alerta">Nenhum preço voltou. Isso não quer dizer que não exista — o Painel não respondeu o valor.</div>' +
          '<div class="job-cot-rodape"><button type="button" id="job-cot-mais">Cotar outra operadora</button></div>') +
    '</div>');

    document.querySelectorAll('.job-cot-gaveta-t').forEach((b) => b.addEventListener('click', () => {
      b.parentElement.classList.toggle('aberta');
    }));
    _cotTopoLigar(_cotPintarOperadoras);
    document.getElementById('job-cot-mais').addEventListener('click', _cotPintarOperadoras);
    const bm = document.getElementById('job-cot-mandar');
    if (bm) bm.addEventListener('click', () => _cotMandarTexto(bm, comPreco));
    const bs = document.getElementById('job-cot-salvar');
    if (bs) bs.addEventListener('click', () => _cotSalvarNoJob(bs, comPreco));
  }

  // ── A COTACAO DESENHADA NO CANVAS, A MAO ───────────────────────────────
  //
  // A primeira versao montava um HTML de 980px fora da tela e passava no
  // html2canvas. Funcionava, e era lento de um jeito que nao dava pra
  // otimizar: o html2canvas clona o DOM inteiro, le estilo computado de cada
  // no, resolve fonte e imagem e rasteriza — tudo na thread principal. O
  // Chrome chegou a mostrar "Pagina sem resposta" por cima do WhatsApp dele.
  //
  // Baixar escala e encolher a logo ajudou pouco, porque o custo nao esta nos
  // pixels: esta em interpretar CSS. A saida foi parar de interpretar. Aqui a
  // cotacao e desenhada com a API 2D — texto, linha e imagem. Sao ~15 chamadas
  // de fillText por plano; nao ha o que ficar lento.
  //
  // O preco disso e que o layout vive em codigo, nao em CSS. Vale: e um
  // documento so, de forma fixa, e ja estava em estilo inline de todo jeito.
  const _CV = {
    W: 1000, PAD: 44, ESC: 2,
    COR_T: '#0b141a', COR_S: '#54656f', COR_F: '#8696a0',
    LINHA: '#eceff1', VERDE: '#1fa97f',
    UI: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif',
  };
  let _msDesenho = 0;
  function _cvFonte(peso, px) { return peso + ' ' + px + 'px ' + _CV.UI; }
  // Corta com reticencias em vez de deixar vazar por cima da coluna vizinha.
  function _cvCortar(ctx, txt, max) {
    let s = String(txt == null ? '' : txt);
    if (ctx.measureText(s).width <= max) return s;
    while (s.length > 1 && ctx.measureText(s + '…').width > max) s = s.slice(0, -1);
    return s + '…';
  }
  function _cvLinhas(ctx, txt, max) {
    const fora = []; let linha = '';
    String(txt || '').split(/\s+/).forEach((pal) => {
      const t2 = linha ? linha + ' ' + pal : pal;
      if (ctx.measureText(t2).width > max && linha) { fora.push(linha); linha = pal; }
      else linha = t2;
    });
    if (linha) fora.push(linha);
    return fora;
  }
  // Decodificar imagem custa, e as logos nao mudam entre um desenho e outro.
  // Sem este cache, cotar de novo pro mesmo cliente pagava tudo de novo.
  const _cvCache = new Map();
  const _TETO_CV_IMAGENS = 24;
  function _cvImagem(src) {
    if (!src) return Promise.resolve(null);
    if (_cvCache.has(src)) return Promise.resolve(_cvCache.get(src));
    return new Promise((ok) => {
      const im = new Image();
      im.onload = () => {
        _cvCache.set(src, im);
        _capMap(_cvCache, _TETO_CV_IMAGENS);
        ok(im);
      };
      im.onerror = () => {
        _cvCache.set(src, null);
        _capMap(_cvCache, _TETO_CV_IMAGENS);
        ok(null);
      };   // falha nao derruba a imagem
      im.src = src;
    });
  }

  async function _cotDesenharPNG(lista) {
    const td = Date.now();
    await _cotContexto();
    await _cotCarregarLogos();
    const medidor = document.createElement('canvas').getContext('2d');
    if (!medidor) return null;

    const ctxx = _cotCtx || {}, co = ctxx.corretor || {}, mc = ctxx.marca || {};
    const cliente = _cotClienteAtual();
    const hoje = new Date(), dd = (n) => (n < 10 ? '0' : '') + n;
    const quando = dd(hoje.getDate()) + '/' + dd(hoje.getMonth() + 1) + '/' + hoje.getFullYear() +
                   ' ' + dd(hoje.getHours()) + ':' + dd(hoje.getMinutes());
    const meta = [['Cotação', quando], ['Corretor', co.nome], ['E-mail', co.email],
                  ['Telefone', co.telefone], ['Cliente', cliente],
                  ['WhatsApp', _cotLead && _cotLead.telefone]].filter((x) => x[1]);

    const opDe = (p) => _texto(p.operadora) ||
      (_cotFeitas.filter((f) => f.planos.indexOf(p) >= 0)[0] || {}).nome || '';
    // As faixas vem com nomes diferentes das duas fontes. Ler so um nome
    // deixaria metade da tabela vazia na mao do cliente.
    const linhasDe = (p) => (p.faixas || []).map((f) => ({
      rot: f.label || f.faixa || '',
      qtd: f.qtd != null ? f.qtd : (f.quantidade != null ? f.quantidade : 1),
      val: f.unitario != null ? f.unitario : (f.preco != null ? f.preco : f.valor),
    })).filter((f) => f.rot);
    const faixas = [];
    lista.forEach((p) => linhasDe(p).forEach((f) => {
      if (!faixas.some((x) => x.rot === f.rot)) faixas.push({ rot: f.rot, qtd: f.qtd });
    }));
    const valor = (p, rot) => {
      const f = linhasDe(p).filter((x) => x.rot === rot)[0];
      return f && f.val != null ? _cotMoeda(f.val) : '—';
    };

    const imgMarca = await _cvImagem(mc.logo || '');
    const imgsOp = await Promise.all(
      lista.map((p) => _cvImagem(_cotLogos[_cotChaveLogo(opDe(p))] || '')));

    const RODAPE = 'Informativo Referencial: valores e demais condições são determinados pelas ' +
      'seguradoras e podem ser alterados a qualquer momento. Reservamo-nos o direito de corrigir ' +
      'eventuais erros, não vinculando esta oferta à prestação do serviço, que se dará apenas no ' +
      'ato da assinatura do contrato.';
    medidor.font = _cvFonte('400', 11);
    const rodapeLinhas = _cvLinhas(medidor, RODAPE, _CV.W - _CV.PAD * 2);

    const hCab = 26 + meta.length * 21 + 26;
    const hLogos = imgsOp.some(Boolean) ? 44 : 0;
    const hNomes = 52, hLinha = 38, hTotal = 56;
    const H = _CV.PAD + 22 + hCab + hLogos + hNomes + (3 + faixas.length) * hLinha +
              hTotal + 28 + rodapeLinhas.length * 17 + _CV.PAD;

    const cv = document.createElement('canvas');
    cv.width = _CV.W * _CV.ESC;
    cv.height = Math.round(H) * _CV.ESC;
    const ctx = cv.getContext('2d');
    ctx.scale(_CV.ESC, _CV.ESC);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, _CV.W, H);

    let y = _CV.PAD + 22;
    const larguraMarca = imgMarca ? Math.min(230, imgMarca.width * (40 / imgMarca.height)) : 0;
    ctx.textAlign = 'left'; ctx.fillStyle = _CV.COR_T; ctx.font = _cvFonte('800', 27);
    const titulo = cliente + ' · ' + (_cot.cidade || '') + ' · ' + _cotRotulo(_cot.modalidade);
    ctx.fillText(_cvCortar(ctx, titulo, _CV.W - _CV.PAD * 2 - larguraMarca - 24), _CV.PAD, y);
    // A LOGO JA DIZ O NOME: o wordmark tem "Serenus" e "CORRETORA" desenhados
    // dentro dele, e escrever de novo embaixo saia repetido na imagem.
    if (imgMarca) {
      const h = 40, w = imgMarca.width * (h / imgMarca.height);
      ctx.drawImage(imgMarca, _CV.W - _CV.PAD - w, _CV.PAD - 8, w, h);
    } else if (mc.nome_curto) {
      ctx.textAlign = 'right';
      ctx.font = _cvFonte('800', 15);
      ctx.fillText(mc.nome_curto, _CV.W - _CV.PAD, _CV.PAD + 6);
      ctx.font = _cvFonte('400', 11); ctx.fillStyle = _CV.COR_F;
      ctx.fillText('Corretora', _CV.W - _CV.PAD, _CV.PAD + 22);
      ctx.textAlign = 'left';
    }
    y += 26;
    meta.forEach((par) => {
      ctx.font = _cvFonte('400', 12); ctx.fillStyle = _CV.COR_F;
      ctx.fillText(par[0], _CV.PAD, y);
      ctx.font = _cvFonte('500', 13); ctx.fillStyle = _CV.COR_S;
      ctx.fillText(_cvCortar(ctx, par[1], 520), _CV.PAD + 84, y);
      y += 21;
    });
    y += 26;

    const x0 = _CV.PAD, larguraRot = 210;
    const larguraCol = (_CV.W - _CV.PAD * 2 - larguraRot) / lista.length;
    const centro = (i) => x0 + larguraRot + larguraCol * i + larguraCol / 2;

    if (hLogos) {
      imgsOp.forEach((im, i) => {
        if (!im) return;
        let h = 28, w = im.width * (h / im.height);
        if (w > larguraCol - 20) { w = larguraCol - 20; h = im.height * (w / im.width); }
        ctx.drawImage(im, centro(i) - w / 2, y - 4, w, h);
      });
      y += hLogos;
    }
    ctx.textAlign = 'center';
    lista.forEach((p, i) => {
      ctx.font = _cvFonte('700', 16); ctx.fillStyle = _CV.COR_T;
      ctx.fillText(_cvCortar(ctx, _cotNomePlano(p), larguraCol - 12), centro(i), y + 14);
      ctx.font = _cvFonte('400', 11.5); ctx.fillStyle = _CV.COR_F;
      ctx.fillText(_cvCortar(ctx, opDe(p), larguraCol - 12), centro(i), y + 30);
    });
    y += hNomes;

    const risco = (yy) => {
      ctx.strokeStyle = _CV.LINHA; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, yy + 0.5); ctx.lineTo(_CV.W - _CV.PAD, yy + 0.5); ctx.stroke();
    };
    risco(y - 12);

    const linha = (rot, valores, extra) => {
      ctx.textAlign = 'left';
      ctx.font = _cvFonte('400', 13.5); ctx.fillStyle = _CV.COR_S;
      ctx.fillText(rot, x0, y + 14);
      if (extra) {
        const w = ctx.measureText(rot).width;
        ctx.font = _cvFonte('700', 12); ctx.fillStyle = _CV.VERDE;
        ctx.fillText(extra, x0 + w + 7, y + 14);
      }
      ctx.textAlign = 'center';
      ctx.font = _cvFonte('400', 13.5); ctx.fillStyle = _CV.COR_T;
      valores.forEach((v, i) => ctx.fillText(_cvCortar(ctx, v, larguraCol - 12), centro(i), y + 14));
      y += hLinha;
      risco(y - 12);
    };

    linha('Modalidade', lista.map(() => _cotRotulo(_cot.modalidade)));
    linha('Acomodação', lista.map((p) => {
      const pl = p.plano || {};
      return _cotAcomod(pl);
    }));
    linha('Coparticipação', lista.map((p) => _cotCopart(p.tabela || {})));
    faixas.forEach((f) => linha(f.rot, lista.map((p) => valor(p, f.rot)), f.qtd + 'x'));

    ctx.textAlign = 'left';
    ctx.font = _cvFonte('800', 15); ctx.fillStyle = _CV.COR_T;
    ctx.fillText('Total', x0, y + 20);
    ctx.textAlign = 'center';
    ctx.font = _cvFonte('800', 19);
    lista.forEach((p, i) =>
      ctx.fillText(p.total == null ? '—' : _cotMoeda(p.total), centro(i), y + 22));
    y += hTotal;

    risco(y - 14);
    ctx.textAlign = 'left';
    ctx.font = _cvFonte('400', 11); ctx.fillStyle = _CV.COR_F;
    rodapeLinhas.forEach((l) => { ctx.fillText(l, x0, y + 10); y += 17; });

    // JPEG, E POR toBlob.
    //
    // `toDataURL('image/png')` era metade do tempo total: codificar PNG de
    // 2000px sem perda e caro e trava a thread enquanto codifica. E o PNG nao
    // sobrevive de todo jeito — o WhatsApp recomprime toda imagem em JPEG
    // antes de mandar, entao o trabalho extra ia pro lixo. `toBlob` entrega a
    // codificacao pro navegador de forma assincrona, fora do caminho critico.
    const url = await new Promise((ok) => {
      try {
        cv.toBlob((b) => {
          if (!b) { ok(null); return; }
          const l = new FileReader();
          l.onloadend = () => ok(l.result);
          l.onerror = () => ok(null);
          l.readAsDataURL(b);
        }, 'image/jpeg', 0.92);
      } catch (e) { ok(null); }
    });
    _msDesenho = Date.now() - td;
    return url;
  }

  // A AREA DE TRANSFERENCIA DO CHROME SO ACEITA PNG.
  //
  // A imagem nasce JPEG de proposito (metade do tempo de desenho, e o WhatsApp
  // recomprime em JPEG de todo jeito). So que `ClipboardItem` com image/jpeg
  // levanta NotAllowedError — o botao caia direto no catch e escrevia
  // "Use Baixar". Ou seja: "Copiar" NUNCA copiou, desde que existe.
  //
  // Aqui a imagem e reencodada em PNG SO pra copiar. Mandar e baixar continuam
  // no JPEG, que e o caminho quente.
  function _cotPngPraCopiar(dataUrl) {
    return new Promise((ok, falhou) => {
      const im = new Image();
      im.onload = () => {
        try {
          const cv = document.createElement('canvas');
          cv.width = im.naturalWidth; cv.height = im.naturalHeight;
          cv.getContext('2d').drawImage(im, 0, 0);
          cv.toBlob((b) => (b ? ok(b) : falhou(new Error('canvas nao devolveu blob'))),
                    'image/png');
        } catch (e) { falhou(e); }
      };
      im.onerror = () => falhou(new Error('a imagem da cotacao nao carregou'));
      im.src = dataUrl;
    });
  }

  // Pre-aquece o desenho: decodifica a logo da corretora e as das operadoras
  // ANTES de ele clicar. A primeira decodificacao custa mais de um segundo e a
  // segunda quase nada; rodando aqui, quando o comparativo aparece, ele nunca
  // paga a primeira.
  async function _cotPreAquecer() {
    try {
      const ctx = await _cotContexto();
      await _cotCarregarLogos();
      const alvos = [((ctx || {}).marca || {}).logo];
      _cotFeitas.forEach((f) => alvos.push(_cotLogos[_cotChaveLogo(f.nome)]));
      await Promise.all(alvos.filter(Boolean).map(_cvImagem));
    } catch (e) {}
  }

  // Salva no JOB o que acabou de ser cotado: vira registro, ganha link público
  // e conta na produção. Sem isso a cotação mais rápida do sistema seria a
  // única que não existe em lugar nenhum.
  //
  // Os planos vão COMO VIERAM DO PAINEL. O servidor lê p['plano']['nome'],
  // p['operadora']['nome'] e f['unitario'] — achatar aqui quebraria a leitura
  // e foi exatamente o que me custou uma rodada de conserto.
  async function _cotSalvarNoJob(btn, lista) {
    const aviso = document.getElementById('job-cot-salvo');
    const dizer = (t, ok) => { if (aviso) { aviso.textContent = t; aviso.classList.toggle('ok', !!ok); } };
    if (!lista.length) { dizer('Não há preço para salvar.'); return; }
    const { usuarioId } = await _safeStorageGet(['usuarioId']);
    if (!usuarioId) { dizer('Escolha seu usuário no popup da extensão primeiro.'); return; }
    // BECO SEM SAÍDA VIRA BOTÃO.
    //
    // Antes isto dizia "cadastre o lead" e não dava como. O consultor estava no
    // meio de um atendimento, com o comparativo pronto na tela, e a única saída
    // era abrir o JOB noutra aba — exatamente o que este painel existe pra
    // evitar. Agora o cadastro acontece aqui, com o nome e o telefone da
    // conversa, e o salvamento segue na sequência.
    if (!_cotLead || !_cotLead.id) {
      if (aviso) {
        aviso.innerHTML = '';
        const b1 = document.createElement('button');
        b1.className = 'job-cot-bt-copiar';
        b1.style.cssText = 'width:100%;margin-top:8px';
        b1.textContent = 'Cadastrar ' + (_cotLead && _cotLead.nome || nomeDoContato() || 'este contato') + ' no CRM';
        b1.title = 'Cria o lead com o nome e o telefone desta conversa e salva a cotação em seguida';
        b1.addEventListener('click', async () => {
          b1.disabled = true; b1.textContent = 'Cadastrando…';
          const novo = await _cotCriarLead(usuarioId);
          if (!novo) {
            b1.disabled = false;
            // O MOTIVO DO SERVIDOR APARECE. "Não consegui cadastrar" não diz se
            // faltou nome, se o telefone da conversa não tem DDD, ou se o JOB
            // caiu — e as três se resolvem de formas diferentes.
            b1.textContent = 'Tentar de novo';
            const m = document.createElement('div');
            m.className = 'job-cot-dica';
            m.textContent = _cotErroLead || 'Não consegui cadastrar agora.';
            b1.insertAdjacentElement('afterend', m);
            return;
          }
          b1.remove();
          _cotSalvarNoJob(btn, lista);           // segue de onde parou
        });
        aviso.appendChild(b1);
        aviso.insertAdjacentHTML('afterbegin',
          '<div>Este número ainda não é um lead do CRM. Sem lead a cotação não é salva.</div>');
      }
      return;
    }
    btn.disabled = true;
    const antes = btn.textContent;
    btn.textContent = 'Salvando…';
    // NADA DE DESENHAR AGORA.
    //
    // Ja tentei "paralelizar" o desenho com o salvamento e nao existe paralelo
    // aqui: rede espera, mas rasterizar ocupa a thread. O salvar foi de 0,4s
    // pra 25s. Primeiro o salvamento, que e espera pura; o desenho depois,
    // quando a tela ja respondeu.
    const t0 = Date.now();
    let r;
    try {
      r = await _safeSendMessage({ type: 'cotacao_salvar', payload: {
        usuario_id: usuarioId,
        lead_id: _cotLead.id,
        telefone: _cotLead.telefone || '',
        // O NOME QUE O CLIENTE LE, nao o do contato. "Lead | Milena" e
        // anotacao do consultor pra se achar na agenda — e ia parar no
        // documento e na imagem que o cliente recebe.
        cliente_nome: _cotClienteAtual(),
        cliente_telefone: _cotLead.telefone || '',
        titulo: _cotClienteAtual() + ' · ' + _cot.cidade +
                ' · ' + _cotRotulo(_cot.modalidade),
        cidade: _cot.cidade,
        modalidade: _cot.modalidade,
        vidas: _cot.vidas,
        planos: lista.map((p) => Object.assign({}, p, { _tipo: _cotRotulo(_cot.modalidade) }))
      } });
    } catch (e) { r = null; }
    const msSalvar = Date.now() - t0;
    btn.disabled = false;
    btn.textContent = antes;
    if (!r || !r.ok) {
      const m = (r && r.erro) || '';
      dizer(m === 'sem_lead' ? 'A cotação só é salva com um lead do CRM ligado.'
          : m === 'usuario_invalido' ? 'Seu usuário não foi reconhecido. Escolha de novo no popup.'
          : m === 'sem_cidade' ? 'Faltou a cidade na cotação.'
          : 'Não consegui salvar agora. Os preços continuam aqui — tente de novo.');
      return;
    }
    // A lista de cotações do cliente muda a partir de agora.
    _cotCache = { chave: '', dados: null };
    btn.textContent = 'Salvo no JOB';
    btn.disabled = true;
    // O NUMERO APARECE. Ele disse "muito lento o salvar" e eu nao tinha como
    // saber se era 1s ou 12s — a rota e so INSERT e a ida e volta medida na
    // producao e de meio segundo. Com o tempo na tela, da pra separar "o JOB
    // esta devagar" de "a impressao e de lento".
    dizer('Salva no lead e em Cotações salvas · ' +
          (msSalvar / 1000).toFixed(1).replace('.', ',') + 's', true);

    // O QUE VEM DEPOIS DE SALVAR É O QUE O CLIENTE RECEBE.
    //
    // Resumo em texto é o mínimo. O documento do JOB tem apresentação, envio
    // por e-mail, imagem pra mandar, destaque de plano e link próprio — e é
    // isso que o consultor manda quando quer vender, não três linhas de preço.
    const pos = document.getElementById('job-cot-pos');
    if (!pos) return;
    const doc = _SITE_BASE_URL_EXT + '/cotacao/documento/' + r.id;
    const r_id = r.id;
    // O QUE DÁ PRA FAZER DAQUI, E O QUE NÃO DÁ.
    //
    // Tudo que viaja como LINK funciona aqui dentro. Copiar imagem e PDF não:
    // a imagem da cotação é desenhada NO NAVEGADOR quando alguém abre o
    // documento (o servidor não tem navegador), então ela só existe depois
    // dessa primeira abertura. Prometer o botão aqui seria prometer o que eu
    // não posso entregar — o botão do documento diz o que tem lá.
    pos.innerHTML =
      '<button class="job-cot-bt-mandar" id="job-cot-link" style="width:100%;margin-top:8px" ' +
        'title="Manda o link da apresentação na conversa aberta">Mandar link</button>' +
      '<div class="job-cot-item-acoes">' +
        '<button class="job-cot-bt-copiar" id="job-cot-copiarlink" style="flex:1" ' +
          'title="Copia o link do cliente pra área de transferência">Copiar link</button>' +
        '<button class="job-cot-bt-copiar" id="job-cot-copiartexto" style="flex:1" ' +
          'title="Copia os preços como texto">Copiar preços</button>' +
      '</div>' +
      // LEGENDA — o texto que acompanha a cotação no WhatsApp.
      //
      // Só existe aqui porque a rota do site passou a aceitar o token da
      // extensão. Era exatamente o caso que o login veio resolver.
      '<div class="job-cot-item-acoes">' +
        '<button class="job-cot-bt-copiar" id="job-cot-legenda" style="flex:1" ' +
          'title="Escolhe uma legenda cadastrada no JOB e manda na conversa">Legenda</button>' +
        '<button class="job-cot-bt-copiar" id="job-cot-imagem" style="flex:1" ' +
          'title="Mostra a imagem aqui antes de mandar, com copiar, baixar e enviar">' +
          'Ver imagem da cotação</button>' +
      '</div>' +
      '<div id="job-cot-preview"></div>' +
      '<div id="job-cot-legendas"></div>' +
      // O LINK PRA APRESENTACAO VOLTOU, COM O NOME DO QUE TEM ATRAS DELE.
      //
      // Ele saiu quando a imagem passou a nascer aqui: era a unica coisa nesta
      // tela que ainda tirava o consultor do WhatsApp, e foi nele que o
      // Guilherme clicou achando que era o "Ver imagem". Eu escrevi na epoca
      // que o que so existe la continuava "a um clique pelo JOB". Estava
      // errado: tirei o unico clique que havia. Ele perguntou "cade o botao de
      // editar o valor, de destacar, de recomendacao" — e a resposta era que
      // eu tinha fechado a porta.
      //
      // Volta DEPOIS do preview e da legenda, com o rotulo dizendo o que tem
      // do outro lado. O erro antigo era um link generico no meio do caminho
      // de quem so quer mandar a cotacao; um link nomeado, no fim, e outra
      // coisa — ninguem clica nele por engano.
      '<a class="job-cot-nova" href="' +
        esc(_SITE_BASE_URL_EXT + '/cotacao/documento/' + r.id) + '" ' +
        'target="_blank" rel="noopener" ' +
        'title="Abre esta mesma cotação no JOB, numa aba nova. O link do cliente não muda.">' +
        'Ajustar esta cotação no JOB</a>' +
      '<div class="job-cot-prev-dica" style="margin-top:5px">Corrigir valor sem trocar ' +
        'o link do cliente, destacar plano, copiar um plano só, gerar PDF. Abre numa aba ' +
        'do JOB — o WhatsApp continua aqui.</div>' +
      // NOVA COTAÇÃO É LINK NOVO, e a frase precisa deixar isso claro: o
      // cliente que já recebeu o link antigo continua vendo o antigo. Quem
      // quer CORRIGIR um valor sem trocar o link usa "Corrigir valor" lá
      // dentro do documento — são coisas diferentes e confundi-las manda dois
      // preços diferentes pro mesmo cliente.
      '<a class="job-cot-nova" href="' + esc(_SITE_BASE_URL_EXT + '/cotacao/' + r.id + '/reabrir') + '" ' +
        'target="_blank" rel="noopener" ' +
        'title="Cria uma cotação nova, com link próprio. Esta aqui não muda — quem já recebeu o link continua vendo ela.">' +
        'Nova cotação (link novo)</a>' +
      '<div class="job-cot-rodape">' +
        '<button type="button" id="job-cot-denovo" title="Mantém cidade, tipo e vidas e volta pras operadoras">' +
          'Cotar de novo para este cliente</button>' +
        '<button type="button" id="job-cot-anteriores" title="Todas as cotações já feitas para este cliente">' +
          'Cotações anteriores</button>' +
      '</div>';
    const bdn = document.getElementById('job-cot-denovo');
    if (bdn) bdn.addEventListener('click', () => {
      // Mesma pergunta, comparativo limpo: ele quer montar outra proposta pro
      // mesmo cliente, não somar na que acabou de salvar.
      _cotFeitas = [];
      _cotPintarOperadoras();
    });
    const ban = document.getElementById('job-cot-anteriores');
    if (ban) ban.addEventListener('click', abrirSecaoCotacao);
    // A IMAGEM NAO TIRA MAIS O CONSULTOR DA CONVERSA.
    //
    // Ela e desenhada NO NAVEGADOR quando alguem abre o documento — o servidor
    // nao tem navegador. O jeito antigo de provocar isso era window.open(): o
    // WhatsApp sumia da frente, ele caia numa aba do JOB no meio do
    // atendimento e ainda tinha que voltar e clicar de novo. Agora quem abre e
    // o background, numa aba INATIVA que ele nao ve, e que se fecha sozinha.
    //
    // Guarda de imagem ja buscada: os tres botoes (copiar, baixar, mandar)
    // pedem a mesma imagem. Sem isto, cada um abriria a sua aba.
    // A imagem e desenhada aqui, entao "buscar" virou "desenhar". Guarda o
    // resultado porque os tres botoes pedem a mesma coisa.
    let _imgCache = null;
    async function _cotPegarImagem(btn, aoTer) {
      if (_imgCache) { aoTer(_imgCache); return; }
      const antes = btn.textContent;
      btn.disabled = true; btn.textContent = 'Desenhando…';
      const dataUrl = await _cotDesenharPNG(lista);
      btn.disabled = false; btn.textContent = antes;
      if (dataUrl) { _imgCache = dataUrl; aoTer(dataUrl); return; }
      btn.textContent = 'Não consegui desenhar';
      setTimeout(() => { btn.textContent = antes; }, 3200);
    }

    // PREVIEW: ele ve o que o cliente vai receber ANTES de mandar.
    //
    // Pedido do Guilherme. Ate agora "Copiar imagem" copiava uma imagem que
    // ele nunca tinha visto — e uma cotacao com o plano errado em destaque so
    // aparecia depois, na conversa do cliente. As tres acoes moram debaixo do
    // preview porque so fazem sentido depois de ele olhar.
    function _cotPreview(dataUrl) {
      const cx = document.getElementById('job-cot-preview');
      if (!cx) return;
      cx.innerHTML =
        '<div class="job-cot-prev">' +
          '<img src="' + esc(dataUrl) + '" alt="Imagem da cotação">' +
          '<div class="job-cot-prev-leg">É isto que o cliente recebe.' +
            (_msDesenho ? ' <span style="opacity:.65">Desenhada em ' +
              (_msDesenho / 1000).toFixed(1).replace('.', ',') + 's.</span>' : '') +
          '</div>' +
          // A LEGENDA PERTENCE A IMAGEM.
          //
          // "Mandar na conversa" mandava a imagem pelada. Ele disse que quase
          // sempre quer um texto junto: as vezes o padrao da corretora, as
          // vezes um bem personalizado. Mandar primeiro e escrever depois
          // chega ao cliente como duas mensagens soltas, e a primeira e uma
          // imagem sem contexto.
          //
          // Agora o texto viaja NA imagem (a ponte ja aceitava legenda e a
          // gente nao usava). O campo comeca vazio: quem nao quer legenda so
          // manda, como antes.
          '<div class="job-cot-prev-leg-cx">' +
            '<div class="job-cot-prev-leg-t">Legenda' +
              _cotAjuda('Vai junto com a imagem, na mesma mensagem — não como um ' +
                        'segundo balão. Em branco, a imagem sai sozinha.') + '</div>' +
            '<textarea id="job-cot-prev-txt" class="job-cot-prev-txt" rows="2" ' +
              'placeholder="Escreva a legenda, ou escolha uma pronta"></textarea>' +
            '<button type="button" class="job-cot-bt-copiar" id="job-cot-prev-prontas" ' +
              'style="width:100%">Usar uma legenda pronta</button>' +
            '<div id="job-cot-prev-lista"></div>' +
          '</div>' +
          '<div class="job-cot-item-acoes">' +
            '<button type="button" class="job-cot-bt-mandar" id="job-cot-prev-mandar" style="flex:2">' +
              'Mandar na conversa</button>' +
            '<button type="button" class="job-cot-bt-copiar" id="job-cot-prev-copiar" style="flex:1">' +
              'Copiar</button>' +
            '<button type="button" class="job-cot-bt-copiar" id="job-cot-prev-baixar" style="flex:1">' +
              'Baixar</button>' +
          '</div>' +
          // O CAMINHO DO TEXTO MUITO PERSONALIZADO. Digitar um texto longo num
          // campo de painel e pior do que colar a imagem e escrever no proprio
          // WhatsApp, com emoji, correcao e o teclado que ele ja usa.
          '<div class="job-cot-prev-dica">Texto muito personalizado? <b>Copiar</b> ' +
            'cola a imagem na conversa e você escreve ali mesmo.</div>' +
        '</div>';
      cx.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

      const txt = document.getElementById('job-cot-prev-txt');
      const legenda = () => (txt && txt.value || '').trim();
      // O BOTAO DIZ O QUE VAI ACONTECER: com texto no campo, ele para de
      // dizer so "mandar" e passa a dizer que a legenda vai junto.
      const rotularMandar = () => {
        if (!bmd || bmd.disabled) return;
        bmd.textContent = legenda() ? 'Mandar com legenda' : 'Mandar na conversa';
      };
      if (txt) txt.addEventListener('input', rotularMandar);

      // As legendas prontas vem do JOB (Cotações → Legendas). Elas PREENCHEM o
      // campo em vez de mandar direto: quase toda legenda pronta leva um ajuste
      // — o primeiro nome, o dia da visita — e travar isso obrigaria a escolher
      // entre "pronta" e "minha".
      const bpr = document.getElementById('job-cot-prev-prontas');
      const lst = document.getElementById('job-cot-prev-lista');
      if (bpr) bpr.addEventListener('click', async () => {
        if (lst.innerHTML) { lst.innerHTML = ''; return; }      // segundo clique fecha
        lst.innerHTML = '<div class="job-cot-dica">Buscando as legendas…</div>';
        let r = null;
        try { r = await _safeSendMessage({ type: 'cotacao_legendas' }); } catch (e) { r = null; }
        const legs = Array.isArray(r) ? r : ((r && r.legendas) || []);
        if (!legs.length) {
          lst.innerHTML = '<div class="job-cot-dica">' +
            esc((r && r.erro) || 'Nenhuma legenda cadastrada. Crie em Cotações → Legendas, no JOB.') +
            '</div>';
          return;
        }
        lst.innerHTML = legs.map((m, i) =>
          '<button type="button" class="job-cot-leg" data-i="' + i + '">' +
            '<b>' + esc(m.nome || 'Legenda') + '</b>' +
            '<span>' + esc(String(m.texto || '').slice(0, 90)) + '</span></button>').join('');
        lst.querySelectorAll('.job-cot-leg').forEach((b) => b.addEventListener('click', () => {
          const m = legs[+b.dataset.i] || {};
          if (txt) { txt.value = m.texto || ''; txt.focus(); }
          lst.innerHTML = '';
          rotularMandar();
        }));
      });

      const bmd = document.getElementById('job-cot-prev-mandar');
      bmd.addEventListener('click', async () => {
        bmd.disabled = true; bmd.textContent = 'Mandando…';
        let chatId = '';
        try { chatId = await pedirChatId(); } catch (e) { chatId = ''; }
        if (!chatId) {
          bmd.disabled = false;
          bmd.textContent = 'Abra a conversa e tente de novo';
          setTimeout(rotularMandar, 3200);
          return;
        }
        const env = await pedirEnviarMidia(chatId, 'imagem', dataUrl, legenda(),
                                           'cotacao-' + r_id + '.jpg');
        bmd.disabled = false;
        bmd.textContent = (env && env.ok) ? 'Mandada' : 'Não saiu — tente de novo';
        setTimeout(rotularMandar, 3000);
      });
      document.getElementById('job-cot-prev-copiar').addEventListener('click', async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        try {
          // O ClipboardItem recebe a PROMESSA, nao o blob pronto. Esperar o PNG
          // primeiro e so depois chamar o clipboard faz o navegador perder o
          // gesto do clique quando a reencodacao demora.
          await navigator.clipboard.write([
            new ClipboardItem({ 'image/png': _cotPngPraCopiar(dataUrl) }),
          ]);
          b.textContent = 'Copiada';
        } catch (err) { b.textContent = 'Não copiou — use Baixar'; }
        b.disabled = false;
        setTimeout(() => { b.textContent = 'Copiar'; }, 2600);
      });
      document.getElementById('job-cot-prev-baixar').addEventListener('click', (e) => {
        const a = document.createElement('a');
        a.href = dataUrl; a.download = 'cotacao-' + r_id + '.jpg';
        document.body.appendChild(a); a.click(); a.remove();
        e.currentTarget.textContent = 'Baixada';
        setTimeout(() => { e.currentTarget.textContent = 'Baixar'; }, 2200);
      });
    }

    const bimg = document.getElementById('job-cot-imagem');
    if (bimg) bimg.addEventListener('click', () => _cotPegarImagem(bimg, _cotPreview));

    // A IMAGEM COMECA SOZINHA, NA HORA DE SALVAR.
    //
    // Antes ela so nascia quando ele clicava — e ai ficava lendo "Montando a
    // imagem..." parado, no meio do atendimento. O trabalho e o mesmo; o que
    // mudou e QUANDO ele acontece. Salvou, ja comeca; quando ele rolar ate
    // aqui, a imagem em geral ja esta desenhada.
    //
    // Sem botao piscando: enquanto vem, aparece so o lugar dela reservado.
    // Se falhar, nao ha alarme nenhum — o botao "Ver imagem" continua ali e
    // tenta de novo. Erro de coisa que ele nao pediu nao merece susto.
    if (bimg) {
      const cx = document.getElementById('job-cot-preview');
      if (cx) cx.innerHTML = '<div class="job-cot-prev-vazio">Preparando a imagem da cotação…</div>';
      // DEPOIS QUE A TELA RESPONDEU, e so quando o navegador estiver ocioso.
      //
      // O desenho e caro e trava a thread. Rodando aqui, ele acontece enquanto
      // o consultor le o resultado — e se ele clicar em "Ver imagem" antes, o
      // botao desenha na hora e este agendamento so encontra o cache.
      const desenhar = () =>
        _cotPegarImagem({ set textContent(v) {}, get textContent() { return ''; }, disabled: false },
                        (dataUrl) => _cotPreview(dataUrl))
          .catch(() => {})
          .finally(() => {
            const c2 = document.getElementById('job-cot-preview');
            if (c2 && c2.querySelector('.job-cot-prev-vazio')) c2.innerHTML = '';
          });
      if (typeof requestIdleCallback === 'function') requestIdleCallback(desenhar, { timeout: 3000 });
      else setTimeout(desenhar, 400);
    }

    const bleg = document.getElementById('job-cot-legenda');
    if (bleg) bleg.addEventListener('click', async () => {
      const caixa = document.getElementById('job-cot-legendas');
      if (!caixa) return;
      if (caixa.innerHTML) { caixa.innerHTML = ''; return; }   // segundo clique fecha
      caixa.innerHTML = '<div class="job-cot-dica">Buscando as legendas…</div>';
      let r = null;
      try { r = await _safeSendMessage({ type: 'cotacao_legendas' }); } catch (e) { r = null; }
      // A rota devolve a LISTA crua (array), não um {ok:...} — é a mesma que o
      // documento do site consome. Aceito os dois formatos pra não quebrar se
      // um dia mudar.
      const lista = Array.isArray(r) ? r : ((r && r.legendas) || []);
      if (!lista.length) {
        caixa.innerHTML = '<div class="job-cot-dica">' +
          (r && r.erro ? esc(r.erro)
                       : 'Nenhuma legenda cadastrada. Crie em Cotações → Legendas, no JOB.') +
          '</div>';
        return;
      }
      caixa.innerHTML = lista.map((m, i) =>
        '<button type="button" class="job-cot-leg" data-i="' + i + '">' +
          '<b>' + esc(m.nome || 'Legenda') + '</b>' +
          '<span>' + esc(String(m.corpo || '').slice(0, 90)) + '</span>' +
        '</button>').join('');
      caixa.querySelectorAll('.job-cot-leg').forEach((b) => b.addEventListener('click', async () => {
        const m = lista[+b.dataset.i];
        const txt = String(m.corpo || '');
        try {
          await navigator.clipboard.writeText(txt);
          b.querySelector('b').textContent = 'Copiada — cole na conversa';
        } catch (e) {
          // Sem permissão de área de transferência, mostra o texto pra copiar
          // na mão em vez de falhar calado.
          caixa.innerHTML = '<textarea class="job-cot-leg-txt" readonly>' + esc(txt) + '</textarea>';
        }
      }));
    });

    const bcl = document.getElementById('job-cot-copiarlink');
    if (bcl) bcl.addEventListener('click', () => {
      navigator.clipboard.writeText(r.url || doc).then(() => {
        bcl.textContent = 'Copiado';
        setTimeout(() => { bcl.textContent = 'Copiar link'; }, 1500);
      });
    });
    const bct = document.getElementById('job-cot-copiartexto');
    if (bct) bct.addEventListener('click', () => {
      navigator.clipboard.writeText(_cotTextoPrecos(lista)).then(() => {
        bct.textContent = 'Copiado';
        setTimeout(() => { bct.textContent = 'Copiar preços'; }, 1500);
      });
    });
    const bl = document.getElementById('job-cot-link');
    if (bl && r.url) {
      bl.dataset.url = r.url;
      bl.addEventListener('click', () => _cotMandar(bl));
    } else if (bl) {
      bl.disabled = true;
      bl.textContent = 'Sem link público — abra no JOB';
    }
  }

  // Um texto só, usado pelo "mandar" e pelo "copiar" — duas versões do mesmo
  // resumo divergiriam no primeiro ajuste.
  function _cotTextoPrecos() {
    const cab = _cot.cidade + ' · ' + _cotRotulo(_cot.modalidade) + ' · ' +
      _cot.totalVidas + (_cot.totalVidas === 1 ? ' vida' : ' vidas');
    const blocos = _cotFeitas.map((f) => {
      const linhas = f.planos.filter((p) => p.total != null)
        .map((p) => '• ' + _cotNomePlano(p) + ' — ' + _cotMoeda(p.total) + '/mês');
      return linhas.length ? f.nome + '\n' + linhas.join('\n') : '';
    }).filter(Boolean);
    return cab + '\n\n' + blocos.join('\n\n');
  }
  // Cria o lead com o que a conversa já oferece. O servidor deduplica por
  // telefone, então clicar duas vezes devolve o mesmo lead em vez de criar dois.
  async function _cotCriarLead(usuarioId) {
    let nome = nomeDoContato();
    let chatId = '';
    try { chatId = await pedirChatId(); } catch (e) { chatId = ''; }
    let telefone = await garantirTelefone(nome, chatId);
    nome = nomeMaisConfiavel(nome) || nome;
    if (!telefone) telefone = (_cotLead && _cotLead.telefone) || '';
    if (!telefone) return null;
    let r = null;
    try {
      // 'manual' NÃO é enfeite: o servidor só aceita origem de uma lista fechada
      // (_WA_ORIGENS_LEAD) e recusa qualquer outra com "Selecione como o lead
      // chegou". Eu tinha inventado 'WhatsApp (cotação)' — o cadastro falharia
      // em 100% das vezes, com uma mensagem que não diz o porquê. Quem chegou
      // pela conversa e não veio de campanha é 'manual', que é a verdade: quem
      // cadastrou foi o consultor.
      r = await _safeSendMessage({ type: 'lead_criar', nome: nome || telefone,
                                   telefone: telefone, origem: 'manual',
                                   usuario_id: usuarioId });
    } catch (e) { r = null; }
    const id = r && r.ok && r.lead_id;
    if (!id) { _cotErroLead = (r && r.erro) || 'O JOB não respondeu.'; return null; }
    _cotErroLead = '';
    _cotLead = { id: id, nome: nome || '', telefone: telefone };
    _cotCache = { chave: '', dados: null };   // a lista de cotações mudou
    return _cotLead;
  }

  function _cotMandarTexto(btn) {
    btn.dataset.url = _cotTextoPrecos();   // _cotMandar manda o conteúdo de dataset.url
    _cotMandar(btn);
  }

  function abrirSecaoCnpj() {
    const pre = _cnpjNaConversa();
    setCorpoSecao(
      _secHead('CNPJ', 'Dados da Receita: razão social, abertura, situação, sócios e se é MEI. Sem CAPTCHA, sem gov.br.') +
      '<div class="job-cnpj-wrap">' +
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
      box.innerHTML = '<div class="job-ia-alerta">Digite os 14 números do CNPJ.</div>';
      return;
    }
    box.innerHTML = _telaCarregando('Consultando na Receita…');
    let resp;
    try { resp = await _safeSendMessage({ type: 'consultar_cnpj', cnpj: dig }); }
    catch (e) { resp = null; }
    if (!resp || !resp.ok || !resp.cnpj) {
      box.innerHTML = '<div class="job-ia-alerta">' + esc((resp && resp.erro) || 'Não consegui consultar esse CNPJ agora.') + '</div>';
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
      '<div class="job-sec-t-row">' +
        '<div class="job-sec-t-txt">' +
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

  // ── FILA DO SERVIDOR ────────────────────────────────────────────────────
  //
  // O consultor nao aperta nada: quando existe lote pra ele, a extensao pega UM
  // item, le, devolve o resultado e espera o intervalo que o servidor mandou.
  //
  // Por que nao um laco com tudo de uma vez: (1) segurava a aba dele e qualquer
  // fechada perdia o progresso; (2) ler dezenas em rajada dentro do WhatsApp e
  // padrao de robo, e numero derrubado custa muito mais que uma varredura lenta.
  // Um por vez, com respiro, roda no fundo sem ninguem esperando na frente.
  const FILA = { rodando: false, proximaEm: 0 };

  // ── VÁLVULA DE ESCAPE: RECARREGAR PRA LIBERAR RAM ─────────────────────────
  //
  // O que sobra depois de tudo: a memória que NÃO é nossa. Cada conversa lida
  // fica retida pela wa-js e pelo React do WhatsApp, e eles não devolvem. Os
  // tetos que pus nos nossos caches (v3.24) e a marca d'água (v3.21) reduziram
  // o nosso lado; o lado deles só zera recarregando a página.
  //
  // Não tento chamar o coletor de lixo nem limpar os Stores internos deles —
  // mexer nos Stores quebra a UI, e o coletor não é chamável de fora.
  //
  // TRÊS TRAVAS, porque um recarregamento na hora errada é pior que o crash:
  //  · só ENTRE leads (nunca no meio de um) — se recarregar com um item
  //    'lendo', ele ficaria preso no servidor. Existe reclaim de 10 min lá
  //    agora, mas depender dele seria desperdiçar 10 minutos de fila;
  //  · só com a aba EM SEGUNDO PLANO — recarregar o WhatsApp na cara de quem
  //    está digitando perde a mensagem pela metade;
  //  · nunca duas vezes em menos de 10 min, mesmo que a contagem zere por bug.
  //    É a trava que torna um laço de recarregamento impossível.
  const _RELOAD_A_CADA = 15;          // leads lidos antes de liberar a RAM
  const _RELOAD_INTERVALO_MIN = 10;   // piso entre dois recarregamentos
  let _lidosNestaSessao = 0;

  async function _talvezRecarregarPraLiberarRam() {
    if (_lidosNestaSessao < _RELOAD_A_CADA) return false;
    // Aba visível = o consultor está nela. Espera ele sair (a contagem fica
    // acumulada; recarrega no primeiro tick com a aba escondida).
    if (document.visibilityState === 'visible') return false;
    try {
      const { jobUltimoReload } = await _safeStorageGet(['jobUltimoReload']);
      const desde = Date.now() - (jobUltimoReload || 0);
      if (jobUltimoReload && desde < _RELOAD_INTERVALO_MIN * 60000) return false;
      await chrome.storage.local.set({
        jobReloadMemoria: true,       // o boot lê isto pra retomar sozinho
        jobUltimoReload: Date.now(),  // gravado ANTES de recarregar: se o boot
                                      // falhar, o piso de tempo ainda vale e
                                      // não vira laço
      });
    } catch (e) { return false; }     // sem storage: não recarrega às cegas
    console.log('[JOB] ' + _lidosNestaSessao + ' leads lidos — recarregando pra liberar memória.');
    window.location.reload();
    return true;
  }

  async function filaVarreduraTick() {
    if (FILA.rodando || Date.now() < FILA.proximaEm) return;
    let usuarioId = null;
    try { ({ usuarioId } = await _safeStorageGet(['usuarioId'])); } catch (e) { return; }
    if (!usuarioId) return;
    FILA.rodando = true;
    try {
      const r = await _safeSendMessage({ type: 'varredura_proximo', consultor_id: usuarioId })
        .catch(() => null);
      const item = r && r.ok && r.item;
      if (!item) {
        // Sem fila: nao adianta perguntar de novo em seguida.
        FILA.proximaEm = Date.now() + 120000;
        return;
      }
      // Outra rotina (envio ou varredura automática) está usando o WhatsApp
      // agora. O item continua 'pendente' no servidor — não perde o lugar na
      // fila, só tenta de novo em breve em vez de disputar a aba.
      if (!_jobGateTentar('varredura_fila')) {
        FILA.proximaEm = Date.now() + 5000;
        return;
      }
      let ok = false, erro = '';
      try {
        // O LEAD VAI JUNTO. O lote sabe de quem e a conversa; sem mandar, a
        // analise era gravada sem dono e nao aparecia em lugar nenhum.
        // A MARCA D'ÁGUA TAMBÉM VAI JUNTO — antes não ia, e por isso todo lead
        // deste caminho lia a conversa inteira de novo, mesmo o que já tinha
        // sido lido no dia anterior.
        await varreduraUmaConversa(
          { chat_id: item.chat_id, desde_msg_id: item.desde_msg_id || null },
          { lead_id: item.lead_id, nome: item.nome || '',
            origem: 'varredura_lote', lote_id: item.lote_id });
        ok = true;
      } catch (e) {
        // O MOTIVO VIAJA. "deu erro em alguns" nao serve pra ninguem: o painel
        // precisa dizer em QUAL lead e POR QUE, pra separar conversa apagada de
        // peca quebrada.
        erro = String((e && e.message) || e).slice(0, 180);
      } finally {
        _jobGateSoltar();
      }
      await _safeSendMessage({ type: 'varredura_resultado', item_id: item.item_id,
                               ok: ok, erro: erro }).catch(() => null);
      FILA.proximaEm = Date.now() + Math.max(5, item.espera_seg || 25) * 1000;
      // AQUI e em nenhum outro lugar: o item já foi reportado ao servidor, o
      // gate já foi solto, e o próximo ainda não foi pego. É o único instante
      // em que recarregar não perde trabalho nem prende lead nenhum.
      _lidosNestaSessao++;
      await _talvezRecarregarPraLiberarRam();
    } finally {
      FILA.rodando = false;
    }
  }

  function filaVarreduraIniciar() {
    // Comeca depois da extensao assentar; o relogio real e o proximaEm.
    _registrarTimeout(() => { filaVarreduraTick(); }, 60000);
    _registrarLoop(setInterval(_soComAbaVisivel(() => { filaVarreduraTick(); }), 15000));
    _retomarSeFoiReloadDeMemoria();
  }

  // Voltou de um recarregamento nosso? Retoma a fila sem esperar o minuto
  // inteiro — senão cada liberação de RAM custaria um minuto parado, e numa
  // fila de 76 leads isso vira cinco minutos jogados fora.
  //
  // A flag é apagada ANTES de retomar: se a retomada falhar por qualquer
  // motivo, o próximo boot é um boot normal. Flag que sobrevive ao próprio
  // uso é o que transforma um recurso destes em laço.
  async function _retomarSeFoiReloadDeMemoria() {
    try {
      const { jobReloadMemoria } = await _safeStorageGet(['jobReloadMemoria']);
      if (!jobReloadMemoria) return;
      await chrome.storage.local.set({ jobReloadMemoria: false });
      // A wa-js precisa assentar antes de qualquer leitura — sem esta espera a
      // primeira conversa depois do reload volta vazia (falha_mensagens).
      _registrarTimeout(() => { filaVarreduraTick(); }, 20000);
      console.log('[JOB] retomando a fila depois de liberar memória.');
    } catch (e) { /* sem storage: o tick normal de 60s assume */ }
  }

  async function _ligarSincLid() {
    const b = document.getElementById('job-sinc-lid');
    if (!b) return;
    const dica = (t) => { const e = document.getElementById('job-sinc-dica'); if (e) e.textContent = t; };
    b.addEventListener('click', async () => {
      b.disabled = true; const r0 = b.textContent; b.textContent = 'Lendo conversas…';
      if (!_jobGateTentar('sinc_lid_manual')) {
        dica('O JOB está terminando outra tarefa no WhatsApp. Tente de novo em alguns segundos.');
        b.disabled = false; b.textContent = r0;
        return;
      }
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
      } finally {
        _jobGateSoltar();
        b.disabled = false; b.textContent = 'Sincronizar @lid de todas as conversas';
      }
    });
  }

  var _INBOX_SUB = 'Leads que caíram pra você e ainda não foram atendidos — o mais antigo primeiro.';

  function renderInbox() {
    if (!_inboxCache.length) {
      return _secHead('Leads', _INBOX_SUB) +
        '<div class="job-sem-analise">' +
          '<div class="job-sem-analise-t">Nenhum lead esperando</div>' +
          // "Está tudo atendido" logo acima de "267 sem lead no CRM" fazia
          // parecer contradição. São contas diferentes: esta lista conta os
          // leads QUE CAÍRAM PRA VOCÊ e ainda não foram atendidos; aquele
          // número conta conversas que não viraram lead nenhum. Dizer o que
          // se conta resolve, e é mais honesto que "tudo atendido".
          '<div class="job-sem-analise-txt">Nenhum lead novo aguardando o seu primeiro contato. ' +
            'Isto conta só os que caíram pra você — conversa sem lead no CRM é outra coisa, ' +
            'e aparece no número abaixo.</div>' +
        '</div>' + _blocoSincLid();
    }
    var html = _secHead('Leads', _INBOX_SUB, _inboxCache.length) + '<div class="job-inbox-lista">';
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
    setCorpoSecaoInbox(_secHead('Leads', _INBOX_SUB) + _telaCarregando('Buscando seus leads…'));
    await buscarInbox();
    if (_secaoAtiva !== 'inbox') return;
    setCorpoSecaoInbox(renderInbox());
    ligarAcoesInbox();
    // FALTAVA ISTO. O botao de sincronizar @lid era desenhado toda vez, mas o
    // clique so era ligado quando a lista se redesenhava por OUTRO motivo
    // (atender um lead). Ao abrir a aba — o caminho normal — ele estava la,
    // visivel e morto: clicar nao fazia nada e nao dizia nada.
    _ligarSincLid();
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
    if (_inboxTimer || document.hidden) return;
    _inboxTimer = setInterval(function () {
      if (document.hidden) return;
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
    _registrarLoop(_inboxTimer);
  }
  function _pausarLoopInbox() {
    if (!_inboxTimer) return;
    clearInterval(_inboxTimer);
    const i = _idsLoops.indexOf(_inboxTimer);
    if (i >= 0) _idsLoops.splice(i, 1);
    _inboxTimer = null;
  }

  function setCorpoSecao(html) {
    const c = document.getElementById('job-painel-doc-corpo');
    if (c) {
      _revogarPreviasMidia();
      c.innerHTML = html;
    }
    const cancelBtn = document.getElementById('job-cancelar-btn');
    if (cancelBtn) cancelBtn.addEventListener('click', () => cancelarAnalise(cancelBtn.dataset.reqid));
    const analisarBtn = document.getElementById('job-analisar-btn');
    if (analisarBtn) analisarBtn.addEventListener('click', rodarAnalise);
    // O resumo do lead aparece em várias telas; o botão dele é ligado aqui,
    // junto com os outros, pra não existir um caminho que desenha e esquece.
    const irFicha = document.getElementById('job-resumo-ficha');
    if (irFicha) irFicha.addEventListener('click', () => abrirSecao('ficha'));
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

  // A análise usa a MESMA casca de carregamento das outras telas; o que ela tem
  // a mais é o #job-status (o texto muda durante a corrida) e o botão de
  // cancelar. Antes era um terceiro desenho de spinner só pra ela.
  function telaCarregando(reqId, texto) {
    return _secHead('Análise', _ANALISE_SUB) +
      '<div class="job-sem-analise"><div class="job-carregando"></div>' +
      '<div class="job-sem-analise-txt" id="job-status">' + esc(texto) + '</div></div>' +
      '<button class="job-cancelar" id="job-cancelar-btn" data-reqid="' + esc(reqId) + '">Cancelar análise</button>';
  }

  var _ANALISE_SUB = 'O JOB lê a conversa e devolve o resumo, o interesse e o que fazer a seguir.';

  // ══ O QUE O JOB JÁ SABE ═══════════════════════════════════════════════
  //
  // A tela de Análise abria vazia — um título e um botão — como se o JOB não
  // soubesse nada daquela pessoa. Mas ele sabe: etapa, origem, responsável,
  // cidade, empresa, e-mail, há quanto tempo está parado, e tudo que já foi
  // respondido na qualificação. Esconder isso até alguém clicar em "analisar"
  // faz o consultor abrir o site pra ver o que já estava aqui.
  //
  // O score NÃO entra aqui de propósito: ele nasce da análise da conversa
  // (tabela wa_analise), não do cadastro. Mostrar um score antes de ler a
  // conversa seria inventar número — e número inventado numa tela de decisão
  // é pior que número nenhum. Ele aparece assim que a leitura roda.
  function _resumoDoLead() {
    const f = _ficha, l = (f && f.lead) || null;
    if (!f || !f.existe || !l) return '';

    // `proc` e a marca de procedencia (ja vem como HTML pronto). Os campos do
    // cadastro (telefone, e-mail, empresa) nao levam marca: eles nasceram do
    // cadastro e marcar todos seria ruido — a marca existe pra distinguir o que
    // NAO e obvio.
    const linha = (rot, val, cls, proc) => val
      ? '<div class="job-resumo-l' + (cls ? ' ' + cls : '') + '">' +
          '<span class="k">' + esc(rot) + '</span>' +
          '<span class="v">' + esc(val) + (proc || '') + '</span></div>'
      : '';

    const etapa = (f.etapas || []).find((e) => e.id === l.etapa);
    // O VALOR VEM DENTRO DE UM OBJETO.
    //
    // `campos_val[chave]` é {valor, fonte, valor_ia, revisado_em} — eu lia o
    // objeto inteiro e o String() devolvia "[object Object]" em TODOS eles:
    // campanha, criativo, tipo de plano, CNPJ, página que converteu. Os dados
    // das campanhas estavam ali o tempo todo; ninguém conseguia ler.
    //
    // `valor_ia` entra quando não há valor humano: é o que a leitura extraiu e
    // ainda não foi confirmado — melhor mostrar marcado do que esconder.
    const valorDoCampo = (o) => {
      if (o === null || o === undefined) return '';
      if (typeof o !== 'object') return String(o);
      const v = (o.valor !== null && o.valor !== undefined) ? String(o.valor) : '';
      if (v.trim()) return v;
      const ia = (o.valor_ia !== null && o.valor_ia !== undefined) ? String(o.valor_ia) : '';
      return ia.trim() ? ia : '';
    };

    // ── DE ONDE VEIO ESTE DADO ────────────────────────────────────────────
    //
    // Pedido dele: "os dados extraidos nao citam a origem. 'Operadora cotada:
    // Vera Cruz' nao diz se veio do cadastro, da campanha, ou de uma frase que
    // a IA leu numa mensagem. Sem isso nao da pra conferir — so pra acreditar."
    //
    // A procedencia SEMPRE esteve gravada (`crm_lead_campos.fonte`) e viajava
    // ate aqui na ficha. A tela mostrava so o valor. Isto e exibir o que ja
    // existe, nao inventar dado novo.
    //
    // Os nomes sao os que o consultor usa, nao os do banco: 'api_cnpj' nao diz
    // nada pra ele; 'Receita Federal' diz tudo — inclusive que aquilo nao se
    // discute com o cliente.
    const _FONTES = {
      consultor:  { rot: 'digitado',        cls: 'humano' },
      ia:         { rot: 'lido da conversa', cls: 'ia' },
      api_cnpj:   { rot: 'Receita Federal',  cls: 'oficial' },
      automatico: { rot: 'da campanha',      cls: 'campanha' },
      cotacao:    { rot: 'da cotação',       cls: 'sistema' },
      mutirao:    { rot: 'do mutirão',       cls: 'humano' },
    };
    const procedencia = (o) => {
      if (!o || typeof o !== 'object') return '';
      const temHumano = String(o.valor || '').trim() !== '';
      // Valor que a IA extraiu e ninguem confirmou. E o caso que mais precisa
      // de marca: e palpite de leitura, nao dado conferido.
      if (!temHumano) return '<span class="job-proc ia">lido da conversa · a confirmar</span>';
      const f = String(o.fonte || '');
      // 'extensao:12' — o que importa e que foi gente, na extensao.
      const base = f.indexOf('extensao:') === 0 ? { rot: 'pela extensão', cls: 'humano' } : _FONTES[f];
      if (!base) return '';
      const quando = o.revisado_em ? ' · ' + _tempoBrCurto(o.revisado_em) : '';
      return '<span class="job-proc ' + base.cls + '">' + esc(base.rot + quando) + '</span>';
    };

    // Chaves que já apareceram acima como campo do lead. Sem isto "Origem"
    // saía duas vezes — uma do cadastro, outra da qualificação — e ficava a
    // dúvida sobre qual vale.
    const jaMostrado = new Set(['origem', 'email', 'e_mail', 'telefone', 'empresa', 'nome']);
    // ...E TAMBEM PELO RÓTULO. A lista acima compara a CHAVE do campo, e o
    // print dele mostrava "ORIGEM: Indicação" duas vezes seguidas: são dois
    // campos de chaves diferentes ('origem' e o de qualificação) com o mesmo
    // nome na tela. Repetir o mesmo rótulo com o mesmo valor não informa nada
    // e faz duvidar de qual dos dois vale.
    const rotulosVistos = new Set(['origem', 'telefone', 'e-mail', 'email', 'empresa', 'nome']);
    const rotuloNovo = (nome) => {
      const k = String(nome || '').trim().toLowerCase();
      if (!k || rotulosVistos.has(k)) return false;
      rotulosVistos.add(k);
      return true;
    };

    // Só os RESPONDIDOS: listar os vazios transformaria o resumo numa lista de
    // buracos, e o buraco tem lugar próprio (a aba de qualificação).
    const respondidos = (f.campos_def || [])
      .filter((c) => !jaMostrado.has(String(c.chave || '').toLowerCase()))
      .map((c) => ({ nome: c.nome, v: valorDoCampo((f.campos_val || {})[c.chave]),
                     p: procedencia((f.campos_val || {})[c.chave]) }))
      .filter((x) => x.v && x.v.trim() !== '')
      .filter((x) => rotuloNovo(x.nome))
      .slice(0, 10);

    return '<div class="job-resumo">' +
      '<div class="job-resumo-cab">' +
        '<div class="job-resumo-nome">' + esc(l.nome || _fichaTel || 'Sem nome') + '</div>' +
        (etapa
          ? '<span class="job-resumo-etapa" style="background:' + esc((etapa.cor || '#64748b')) + '22;color:' +
            esc(etapa.cor || '#94a3b8') + '">' + esc(etapa.nome) + '</span>'
          : '') +
      '</div>' +
      (f.saude && f.saude.texto
        ? '<div class="job-resumo-saude job-saude-' + esc(f.saude.nivel || '') + '">' +
          esc(f.saude.texto) + '</div>' : '') +
      '<div class="job-resumo-grade">' +
        linha('Telefone', l.telefone) +
        linha('E-mail', l.email) +
        linha('Empresa', l.empresa) +
        linha('Origem', l.origem) +
        linha('Responsável', f.responsavel_nome) +
        linha('Sub-status', l.sub_status) +
        respondidos.map((x) => linha(x.nome, x.v, '', x.p)).join('') +
      '</div>' +
      // A saída pra ficha completa mora aqui: quem lê o resumo e quer mudar
      // alguma coisa não devia ter que caçar a aba.
      '<button type="button" class="job-resumo-ir" id="job-resumo-ficha">Abrir a ficha do lead</button>' +
      '</div>';
  }

  function telaSemAnalise() {
    return _secHead('Análise', _ANALISE_SUB) +
      _resumoDoLead() +
      '<div class="job-sem-analise">' +
      '<div class="job-sem-analise-t">Ainda sem análise</div>' +
      '<div class="job-sem-analise-txt">O JOB ainda não leu esta conversa. A leitura devolve o resumo, o interesse e o Score do Lead — demora alguns segundos e fica salva.</div>' +
      '<button class="job-analisar-btn" id="job-analisar-btn">Analisar este lead</button>' +
      '</div>';
  }

  // A falha da análise tem tela própria, com o botão de tentar de novo DENTRO
  // dela — o mesmo id de sempre, pra continuar ligado no handler existente.
  // `erro` só entra se for uma frase que o consultor entenda; mensagem técnica
  // fica no console, nunca aqui.
  function telaFalhaAnalise(erro, cancelado) {
    const legivel = String(erro || '');
    const tecnico = /[{}<>]|Error|error|fetch|undefined|null|TypeError/.test(legivel);
    return _secHead('Análise', _ANALISE_SUB) +
      '<div class="job-sem-analise">' +
      '<div class="job-sem-analise-t">' +
        (cancelado ? 'Análise cancelada' : 'Não consegui analisar esta conversa') + '</div>' +
      '<div class="job-sem-analise-txt">' +
        (cancelado
          ? 'Nada foi salvo. Você pode rodar de novo quando quiser.'
          : (legivel && !tecnico ? esc(legivel)
             : 'Pode ser a conexão ou uma conversa curta demais pra analisar. Tente de novo.')) +
      '</div>' +
      '<button class="job-analisar-btn" id="job-analisar-btn">Tentar de novo</button>' +
      '</div>';
  }

  function telaBuscandoUltima() {
    return _telaCarregando('Verificando análise salva…');
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
  // ── COMPARACAO COM A ANALISE ANTERIOR ────────────────────────────────────
  //
  // Pedido dele, e ele tem razao: "nao fala se teve analises anteriores e se
  // houve melhora ou piora". Um score de 640 sozinho nao diz nada — 640 depois
  // de 720 e um lead esfriando, e 640 depois de 480 e um lead esquentando. Sao
  // conversas opostas com o mesmo numero na tela.
  //
  // O retrato anterior fica guardado por telefone no armazenamento local: ele
  // ja veio do servidor quando a tela abriu, entao comparar nao custa chamada
  // nenhuma. Guardo score, data e quantas mensagens tinham sido lidas.
  const _CHAVE_ANT = 'jobAnaliseAnterior';
  // Retrato anterior ja lido, pra tela desenhar sem virar assincrona.
  let _antParaTela = null;
  async function _analiseAnteriorLer(tel) {
    if (!tel) return null;
    try {
      const g = await _safeStorageGet([_CHAVE_ANT]);
      return ((g && g[_CHAVE_ANT]) || {})[String(tel).replace(/\D/g, '')] || null;
    } catch (e) { return null; }
  }
  async function _analiseAnteriorGravar(tel, r, totalMsgs) {
    const d = String(tel || '').replace(/\D/g, '');
    if (!d || !r || r.score == null) return;
    try {
      const g = await _safeStorageGet([_CHAVE_ANT]);
      const mapa = (g && g[_CHAVE_ANT]) || {};
      mapa[d] = { score: r.score, quando: new Date().toISOString(), msgs: totalMsgs || 0 };
      // Teto: uma aba aberta o dia inteiro passa por muitas conversas, e isto
      // e armazenamento local — 300 contatos e memoria de sobra pra comparar.
      const chaves = Object.keys(mapa);
      if (chaves.length > 300) chaves.slice(0, chaves.length - 300).forEach((k) => delete mapa[k]);
      await new Promise((ok) => chrome.storage.local.set({ [_CHAVE_ANT]: mapa }, ok));
    } catch (e) {}
  }
  // A faixa que abre o resultado: de quando e esta leitura, o que mudou desde a
  // anterior, e quantas mensagens novas entraram nela.
  function _faixaComparacao(ant, r, totalMsgs, quando) {
    const partes = [];
    partes.push(quando ? 'Lida em ' + esc(fmtDataHora(quando)) : 'Lida agora');
    if (totalMsgs) partes.push(totalMsgs + ' mensagens');
    let delta = '';
    if (ant && ant.score != null && r && r.score != null) {
      const d = r.score - ant.score;
      const novas = totalMsgs && ant.msgs ? Math.max(0, totalMsgs - ant.msgs) : 0;
      partes.push('anterior ' + ant.score + ' em ' + esc(fmtDataHora(ant.quando)));
      if (novas) partes.push(novas + ' mensagem(ns) nova(s) desde então');
      delta = '<span class="job-delta ' + (d > 0 ? 'sobe' : d < 0 ? 'desce' : 'igual') + '">' +
        (d > 0 ? '+' : '') + d + '</span>';
    } else {
      partes.push('primeira leitura desta conversa');
    }
    return '<div class="job-comparacao">' + delta +
      '<span class="job-comparacao-txt">' + partes.join(' · ') + '</span></div>';
  }

  function telaUltimaAnaliseSalvaRica(ua, totalMsgs, telefone) {
    if (!ua.extracao && !ua.ia && !(ua.sugestoes || []).length) return telaUltimaAnaliseSalva(ua, totalMsgs);
    return '<div class="job-ultima-analise-tag">Última análise salva</div>' +
      _faixaComparacao(_antParaTela, ua, totalMsgs, ua.criado_em) +
      renderResultado(ua, ua.lead ? ua.lead.nome : '', telefone, totalMsgs) +
      '<button class="job-analisar-btn" id="job-analisar-btn" style="margin-top:10px;">Analisar de novo</button>';
  }

  // Chama de novo o conteúdo certo da seção "Análise" quando o consultor troca
  // de conversa — nunca deixa a análise do cliente anterior "grudada" na tela
  // do cliente novo. Só mexe se a seção estiver de fato aberta agora.
  let _syncToken = 0; // marca a sincronização atual (pro watchdog do spinner)
  // ══ CACHE DO ESTADO, por conversa ═══════════════════════════════════════
  // Reabrir a Análise na mesma conversa pagava outra ida ao servidor pra
  // receber o mesmo retrato. Trinta segundos cobrem o vai-e-volta entre as
  // abas sem esconder análise recém-rodada — e rodar análise limpa o cache.
  var _estadoCache = { chave: '', dados: null, ts: 0 };
  var _ESTADO_CACHE_MS = 30 * 1000;
  // A ficha do lead alimenta o resumo da Análise. Ela só era buscada quando o
  // consultor abria a aba CRM — então a tela mais usada da extensão abria sem
  // saber nada de quem estava do outro lado. Buscar aqui é UMA chamada, com
  // cache por conversa, e ela redesenha a tela quando chega.
  // Telefone já consultado nesta conversa. Sem isto, um contato SEM lead
  // (resposta ok, `lead` nulo) faria a busca disparar de novo a cada
  // sincronização — a cada 1,5s, pra sempre, contra o servidor.
  var _resumoBuscado = '';

  // Só os dígitos: `pedirTelefoneWpp` devolve "5519981142436" e o DOM às vezes
  // devolve "(19) 98114-2436". Comparar as duas formas cruas diria que são
  // contatos diferentes e a ficha seria rebuscada a cada sincronização.
  function _soDigitos(v) { return String(v || '').replace(/\D/g, ''); }

  async function _garantirFichaParaResumo() {
    try {
      let tel = '';
      try { tel = (await pedirTelefoneWpp()) || telefoneDoContato(); } catch (e) { tel = telefoneDoContato(); }
      // A FICHA TEM QUE SER DESTE CONTATO.
      //
      // O teste era só "já tenho uma ficha?" — sem perguntar de QUEM. Abrindo
      // a conversa da Sandra depois da do Mauricio, a ficha do Mauricio ainda
      // estava na memória, a função saía aqui e a aba Análise mostrava o nome,
      // o telefone e a cidade do Mauricio em cima da conversa da Sandra. Foi
      // exatamente o que o Guilherme viu na tela.
      //
      // Dado de outro cliente na tela é o pior defeito possível neste painel:
      // não parece erro, parece informação.
      if (_ficha && _ficha.lead && _fichaTel &&
          _soDigitos(_fichaTel) === _soDigitos(tel) && _soDigitos(tel)) return;
      if (!tel || _resumoBuscado === tel) return;
      _resumoBuscado = tel;
      const veio = await _carregarFichaSilenciosa({ telefone: tel });
      // Redesenha só se a pessoa AINDA está na Análise: a busca demora, e
      // pintar por cima de uma tela que ela já trocou é o pior tipo de bug.
      if (veio && _secaoAtiva === 'analise') sincronizarPainelComConversa();
    } catch (e) { _falhaTecnica('resumo do lead', e); }
  }

  async function sincronizarPainelComConversa() {
    if (_secaoAtiva !== 'analise') return;
    // Ele chegou na aba: o aviso de "tem coisa nova aqui" cumpriu o papel.
    try { _trilhoPonto('analise', false); } catch (e) {}
    // Puxa a ficha em segundo plano: não bloqueia nada e redesenha quando
    // chega. Sem await de propósito — a análise não pode esperar o CRM.
    _garantirFichaParaResumo();
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
        setCorpoSecao(
          _faixaComparacao(doConversaAtual._anterior, doConversaAtual.resultado,
                           doConversaAtual.totalMsgs, doConversaAtual.terminadoEm) +
          renderResultado(doConversaAtual.resultado, doConversaAtual.nome, doConversaAtual.telefone, doConversaAtual.totalMsgs) +
          '<button class="job-analisar-btn" id="job-analisar-btn" style="margin-top:10px;">Analisar de novo</button>');
        ligarBotaoCopiar();
      } else if (doConversaAtual.status === 'erro') {
        // UMA MENSAGEM, NÃO DUAS. Antes saía o erro E, logo abaixo, o
        // "Nenhuma análise ainda pra esta conversa" — duas frases que se
        // contradizem: uma diz que tentou e falhou, a outra que nunca houve
        // tentativa. Quem lê não sabe se está quebrado ou vazio.
        setCorpoSecao(telaFalhaAnalise(doConversaAtual.erro));
      } else if (doConversaAtual.status === 'cancelado') {
        setCorpoSecao(telaFalhaAnalise('', true));
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
    if (_estadoCache.chave === telefone && _estadoCache.dados &&
        (Date.now() - _estadoCache.ts) < _ESTADO_CACHE_MS) {
      resp = _estadoCache.dados;
    } else {
      try { resp = await chrome.runtime.sendMessage({ type: 'estado', telefone }); } catch (e) { /* segue sem retrato */ }
      if (resp && resp.ok) _estadoCache = { chave: telefone, dados: resp, ts: Date.now() };
    }
    if (trocouDeConversa()) return;
    const ultima = resp && resp.ok && resp.existe && resp.ultima_analise;
    // O retrato anterior vem do armazenamento local — sem chamada nenhuma.
    _antParaTela = await _analiseAnteriorLer(telefone);
    if (trocouDeConversa()) return;
    setCorpoSecao(ultima ? telaUltimaAnaliseSalvaRica(ultima, resp.total_mensagens, telefone) : telaSemAnalise());
    if (ultima) ligarBotaoCopiar();
  }

  function cancelarAnalise(reqId) {
    if (!reqId) return;
    _cancelados.add(reqId);
    // Só recebia .add(), nunca saía nada. Cada item é uma string curta, então
    // o peso é pequeno — mas é crescimento sem teto numa aba que fica aberta o
    // dia inteiro. Esvaziar é seguro: o Set só serve pra descartar a resposta
    // de uma análise que o consultor cancelou, e essas respostas chegam em
    // segundos. Um reqId antigo já não tem mais resposta em voo pra ignorar.
    _capSet(_cancelados, _TETO_SETS);
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
    // O AVISO NAO PODE DEPENDER DA NOTIFICACAO DO CHROME.
    //
    // Ele disse: "as vezes termina a analise e nao avisa nada". Notificacao do
    // sistema pode estar desligada, silenciada ou perdida atras de outra
    // janela — e ai a analise termina em silencio absoluto. O ponto no trilho
    // e nosso, aparece dentro do WhatsApp, e some quando ele abre a aba.
    try { _trilhoPonto('analise', true); } catch (e) {}
    // Se ele estiver OLHANDO outra aba do painel, uma faixa diz o que ficou
    // pronto e leva pra la em um clique.
    try {
      if (_secaoAtiva && _secaoAtiva !== 'analise') {
        _dizerNoRodape(a.status === 'ok'
          ? 'Análise de ' + (a.nome || 'lead') + ' pronta · score ' +
            ((a.resultado && a.resultado.score != null) ? a.resultado.score : '—')
          : 'A análise de ' + (a.nome || 'lead') + ' falhou');
      }
    } catch (e) {}
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
  let _novoModeloAberto = false;

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

  // Com cabeçalho: a espera não pode tirar da tela a única coisa que diz onde
  // a pessoa está. Era a última tela da extensão que ainda fazia isso.
  function telaMensagensCarregando() {
    return _secHead('Mensagens', 'Suas frases, áudios e imagens prontos — mande na conversa sem digitar de novo.') +
      _telaCarregando('Carregando suas mensagens…');
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
      '<div class="job-novo-modelo-head"><div><b>Nova mensagem</b><span>Salve uma vez para reutilizar em qualquer conversa.</span></div>' +
        '<button id="job-novo-cancelar" aria-label="Fechar nova mensagem">×</button></div>' +
      '<label for="job-novo-nome">Nome da mensagem</label>' +
      '<input class="job-inp" id="job-novo-nome" placeholder="Ex: Boas-vindas">' +
      '<label for="job-novo-categoria">Pasta <span>opcional</span></label>' +
      '<input class="job-inp" id="job-novo-categoria" list="job-cats" placeholder="Ex: Amil, Carência ou Rede">' +
      '<datalist id="job-cats">' + categoriasExistentes().map((c) => '<option value="' + esc(c) + '">').join('') + '</datalist>' +
      '<label for="job-novo-texto">Mensagem</label>' +
      '<textarea class="job-inp job-inp-txt" id="job-novo-texto" placeholder="Texto da mensagem…"></textarea>' +
      '<div class="job-novo-acoes">' +
        '<button class="job-mini-btn" id="job-gravar-btn">' + _svgIco('audio', 12) + ' Gravar áudio</button>' +
        '<button class="job-mini-btn" id="job-anexar-btn">' + _svgIco('clipe', 12) + ' Anexar arquivo</button>' +
        '<input type="file" id="job-arquivo-input" accept="audio/*,image/*,video/*,application/pdf" style="display:none">' +
      '</div>' +
      '<div id="job-grav-status" class="job-grav-status"></div>' +
      midiaChip +
      '<button class="job-salvar-modelo" id="job-salvar-modelo-btn">Salvar mensagem</button>' +
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
      || (m.categoria || '').toLowerCase().indexOf(q) >= 0
      || (m.pasta || '').toLowerCase().indexOf(q) >= 0;
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
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    _urlsPreviaMidia.add(url);
    return url;
  }
  const _urlsPreviaMidia = new Set();
  function _revogarPreviasMidia() {
    for (const url of _urlsPreviaMidia) {
      try { URL.revokeObjectURL(url); } catch (e) {}
    }
    _urlsPreviaMidia.clear();
  }
  _aoLimpar(_revogarPreviasMidia);
  const _midiaObserver = ('IntersectionObserver' in window)
    ? _observar(new IntersectionObserver((entradas) => {
        for (const en of entradas) {
          if (en.isIntersecting) { _midiaObserver.unobserve(en.target); _carregarUmaMidia(en.target); }
        }
      }, { root: null, rootMargin: '150px' }))
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
    // O ★ era um caractere de fonte: mudava de desenho conforme o sistema e
    // não é o mesmo traço do chip de Favoritos logo ali em cima. _svgIco já
    // tem a estrela — usar o mesmo desenho nos dois lugares é o mínimo pra
    // parecer o mesmo produto.
    const estrela = '<button class="job-modelo-fav ' + (m.favorito ? 'ativo' : '') +
      '" data-modelo-id="' + m.id + '" title="' +
      (m.favorito ? 'Tirar dos favoritos' : 'Marcar como favorito') + '">' +
      _svgIco('estrela', 13) + '</button>';
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
        '<button class="job-modelo-duplicar" data-modelo-id="' + m.id + '" title="Criar uma cópia">Duplicar</button>' +
        (m.pode_editar ? '<button class="job-modelo-excluir" data-modelo-id="' + m.id + '" title="Excluir">×</button>' : '') +
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
  // ── A BIBLIOTECA AQUI TEM DUAS RAÍZES: "Minha biblioteca" e "Compartilhado".
  //    É a mesma organização do site (dono primeiro, canal depois), sem trazer
  //    a administração pesada pra dentro do WhatsApp: aqui é achar, conferir e
  //    mandar. Conteúdo de colega não chega nem na resposta do servidor.
  function _raizDoModelo(m) { return m.compartilhado ? 'Compartilhado' : 'Minha biblioteca'; }

  // `pasta` é o caminho de verdade, já pronto do JOB (sem a pasta-mãe, que é a
  // raiz aqui). Enquanto sobrar conteúdo antigo sem pasta, a categoria — que
  // era a pasta de antes — segue valendo de nome: assim nada muda de lugar na
  // tela da consultora antes de o gestor organizar.
  function _pastaDoItem(m) {
    return ((m.pasta || '').trim()) || ((m.categoria || '').trim());
  }

  // Busca ou filtro ligado abre as pastas: resultado escondido dentro de pasta
  // fechada é o mesmo que resultado nenhum.
  function _abrirPorFiltro() { return !!(_waBusca || _waFiltro !== 'todos'); }

  function _blocoPorPasta(itens, prefixo, forcarAberto) {
    const porPasta = new Map();
    itens.forEach((m) => {
      const cam = _pastaDoItem(m);
      if (!porPasta.has(cam)) porPasta.set(cam, []);
      porPasta.get(cam).push(m);
    });
    const nomes = [...porPasta.keys()].sort((a, b) =>
      (a === '' ? 1 : (b === '' ? -1 : a.localeCompare(b))));
    let html = '';
    nomes.forEach((cam) => {
      const itensPasta = porPasta.get(cam);
      if (!cam) { html += _blocoPorTipo(itensPasta); return; }   // solto na raiz
      const key = prefixo + ':pasta:' + cam;
      html += '<details class="job-subpasta" data-pasta-key="' + esc(key) + '"' +
        ((forcarAberto || _pastaAberta(key)) ? ' open' : '') + '><summary class="job-subpasta-nome">' +
        esc(cam) + ' <span>(' + itensPasta.length + ')</span></summary>' +
        '<div class="job-subpasta-conteudo">' + _blocoPorTipo(itensPasta) + '</div></details>';
    });
    return html;
  }

  function renderListaModelos(modelos) {
    const filtrados = modelos.filter(modeloPassaFiltro);
    if (!filtrados.length) {
      return (_waBusca || _waFiltro !== 'todos')
        ? _vazioFiltro('mensagem', 'job-limpar-f-modelo')
        : _vazio('Nenhuma mensagem salva',
            'Aqui ficam suas frases, áudios e imagens prontos — os que você repete todo dia. Use Nova mensagem para salvar o primeiro.');
    }
    const forcarAberto = _abrirPorFiltro();
    const porRaiz = new Map([['Minha biblioteca', []], ['Compartilhado', []]]);
    filtrados.forEach((m) => porRaiz.get(_raizDoModelo(m)).push(m));
    let out = '';
    porRaiz.forEach((itens, raiz) => {
      if (!itens.length) return;
      const key = 'modelos:raiz:' + raiz;
      out += '<details class="job-pasta" data-pasta-key="' + esc(key) + '"' +
        ((forcarAberto || _pastaAberta(key)) ? ' open' : '') + '><summary class="job-pasta-nome">' +
        esc(raiz) + ' <span>(' + itens.length + ')</span></summary>' +
        '<div class="job-pasta-conteudo">' + _blocoPorPasta(itens, 'modelos:' + raiz, forcarAberto) +
        '</div></details>';
    });
    return out;
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
    const _qtd = (modelos && modelos.length) || 0;
    return _secHead('Mensagens', 'Suas frases, áudios e imagens prontos — mande na conversa aberta sem digitar de novo.', _qtd || '') +
      (_novoModeloAberto
        ? renderFormularioNovo()
        : '<button class="job-mensagem-criar" id="job-mensagem-criar">' + _svgIco('mais', 14) + ' Nova mensagem</button>') +
      '<div class="job-biblioteca-controles">' +
        '<input class="job-inp" id="job-busca-modelo" placeholder="Buscar mensagem…" value="' + esc(_waBusca) + '">' +
        '<div class="job-fchips">' + chips + '</div>' +
      '</div>' +
      '<div class="job-sec">Mensagens salvas</div>' +
      '<div id="job-modelos-lista">' + renderListaModelos(modelos) + '</div>';
  }

  function rerenderListaModelos() {
    const c = document.getElementById('job-modelos-lista');
    if (!c) return;
    c.innerHTML = renderListaModelos(_modelosCache ? _modelosCache.modelos : []);
    ligarAcoesItens();
    _ligarLimparFiltroModelo();
    _observarMidias(c);
  }

  function _ligarLimparFiltroModelo() {
    const b = document.getElementById('job-limpar-f-modelo');
    if (!b) return;
    b.addEventListener('click', () => {
      _waBusca = ''; _waFiltro = 'todos';
      const inp = document.getElementById('job-busca-modelo');
      if (inp) inp.value = '';
      document.querySelectorAll('.job-fchip[data-f]').forEach((c) =>
        c.classList.toggle('on', c.dataset.f === 'todos'));
      rerenderListaModelos();
    });
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
    document.querySelectorAll('.job-modelo-duplicar').forEach((btn) => {
      btn.addEventListener('click', () => duplicarModelo(btn.dataset.modeloId, btn));
    });
    document.querySelectorAll('.job-modelo-fav').forEach((btn) => {
      btn.addEventListener('click', () => toggleFavoritoModelo(btn.dataset.modeloId, btn));
    });
  }

  function ligarAcoesModelos() {
    const criar = document.getElementById('job-mensagem-criar');
    if (criar) criar.addEventListener('click', () => {
      _novoModeloAberto = !_novoModeloAberto;
      redesenharMensagens();
      const nome = document.getElementById('job-novo-nome');
      if (nome) nome.focus();
    });
    const cancelarNovo = document.getElementById('job-novo-cancelar');
    if (cancelarNovo) cancelarNovo.addEventListener('click', () => {
      _novoModeloAberto = false;
      _midiaAnexada = null;
      redesenharMensagens();
    });
    _ligarLimparFiltroModelo();
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
      if (btn) btn.textContent = 'Parar gravação';
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
    const categoriaAtual = (document.getElementById('job-novo-categoria') || {}).value || '';
    setCorpoSecaoMensagens(renderModelos(_modelosCache ? _modelosCache.modelos : []));
    ligarAcoesModelos();
    const n = document.getElementById('job-novo-nome');
    const t = document.getElementById('job-novo-texto');
    const c = document.getElementById('job-novo-categoria');
    if (n) n.value = nomeAtual;
    if (t) t.value = textoAtual;
    if (c) c.value = categoriaAtual;
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
      _novoModeloAberto = false;
      await buscarModelos(true); // recarrega a lista com o novo
      if (_secaoAtiva === 'mensagens') { setCorpoSecaoMensagens(renderModelos(_modelosCache.modelos)); ligarAcoesModelos(); }
    } catch (e) {
      if (st) st.textContent = 'Erro: ' + e.message;
      btn.disabled = false;
    }
  }

  async function excluirModelo(id) {
    if (!await _confirmar({
      titulo: 'Excluir este modelo?',
      texto: 'Ele sai da sua biblioteca em todos os aparelhos. Não dá pra desfazer.',
      ok: 'Excluir', perigo: true })) return;
    const resp = await chrome.runtime.sendMessage({ type: 'excluir_modelo', id });
    if (!resp || !resp.ok) { _dizerNoRodape((resp && resp.erro) || 'Não consegui excluir a mensagem.'); return; }
    await buscarModelos(true);
    if (_secaoAtiva === 'mensagens') { setCorpoSecaoMensagens(renderModelos(_modelosCache.modelos)); ligarAcoesModelos(); }
  }

  async function duplicarModelo(id, btn) {
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Duplicando…';
    const resp = await chrome.runtime.sendMessage({ type: 'duplicar_modelo', id });
    if (!resp || !resp.ok) {
      btn.disabled = false; btn.textContent = original;
      _dizerNoRodape((resp && resp.erro) || 'Não consegui duplicar a mensagem.');
      return;
    }
    await buscarModelos(true);
    if (_secaoAtiva === 'mensagens') {
      setCorpoSecaoMensagens(renderModelos(_modelosCache.modelos));
      ligarAcoesModelos();
    }
    _dizerNoRodape('Cópia criada na sua biblioteca.');
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

  async function _enviarItemDaFila(item) {
    if (item.tipo && item.tipo !== 'texto' && item.midia_url) {
      const dl = await _safeSendMessage({ type: 'baixar_midia', url: item.midia_url });
      if (!dl || !dl.ok) return { ok: false, erro: (dl && dl.erro) || 'falha ao baixar a mídia' };
      return pedirEnviarMidia(item.chat_id, item.tipo, dl.dataUrl, item.texto,
        _nomeArquivoDaUrl(item.midia_url));
    }
    return pedirEnviarTexto(item.chat_id, item.texto);
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
      // O POST acima só CRIA a mensagem na fila. Antes a tela dizia
      // "Enviado" nesse ponto, embora o WhatsApp ainda nem tivesse recebido
      // a chamada; daí a sensação correta de que o botão mentia e demorava.
      // Para um clique explícito, pede o próprio item agora, sem esperar o
      // polling. O servidor continua aplicando o mesmo limite de ritmo.
      if (!_jobGateTentar('envio_direto')) {
        if (st) st.textContent = 'Outra tarefa do JOB está terminando. Sua mensagem ficou pronta para enviar em seguida.';
        _agendarFila(1);
        return;
      }
      try {
        const pronto = await _safeSendMessage({ type: 'fila_enviar_agora',
          fila_id: resp.id, usuario_id: usuarioId });
        const item = pronto && pronto.ok && pronto.item;
        if (!item) {
          const espera = Math.max(1, Math.ceil(Number(pronto && pronto.espera_s) || 1));
          if (st) st.textContent = 'O WhatsApp libera este envio em cerca de ' + espera + ' s. A mensagem ficou na fila.';
          _agendarFila(espera);
          return;
        }
        if (st) st.textContent = 'Enviando pelo WhatsApp…';
        const envio = await _enviarItemDaFila(item);
        await _safeSendMessage({ type: 'fila_confirmar', fila_id: item.id,
          ok: !!(envio && envio.ok), erro: (envio && envio.erro) || null,
          wpp_msg_id: (envio && envio.wpp_msg_id) || null });
        if (!envio || !envio.ok) {
          if (st) st.textContent = 'Não consegui enviar: ' + ((envio && envio.erro) || 'falha no WhatsApp') + '. Tente novamente.';
          btn.disabled = false;
          _agendarFila(1);
          return;
        }
        _registrarEnvio(chatId || telefone, midiaTipo || 'texto', texto, modeloId);
        if (st) st.textContent = 'Enviado pelo WhatsApp.';
        _agendarFila(1);
        setTimeout(() => { ov.remove(); }, 800);
      } finally {
        _jobGateSoltar();
      }
    } catch (e) {
      if (st) st.textContent = 'Erro: ' + e.message;
      btn.disabled = false;
    }
  }

  async function abrirSecaoMensagens() {
    _pastasAbertas.clear();
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
  // intervalo. O consultor DISPARA na conversa aberta; o gestor também monta e
  // edita AQUI, sem perder o contexto do WhatsApp. Site e extensão salvam o
  // mesmo rascunho completo, então não existem dois formatos de funil.
  const FUNIS_CACHE_MS = 5 * 60 * 1000;
  let _funisCache = null; // {ts, funis, gestor}
  let _fnRascunho = null;
  let _fnEditorSujo = false;
  let _fnPickerBusca = '';
  let _fnPickerAberto = false;
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
      _gestorModo = !!_funisCache.gestor;
      return { ok: true, funis: _funisCache.funis, gestor: _gestorModo };
    }
    // Devolve a resposta CRUA (não só o array) pra abrirSecaoFunis distinguir
    // "deu erro" de "não tem funil" — e nunca ficar preso no spinner.
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({ type: 'listar_funis' });
    } catch (e) {
      // Sem a exceção colada no fim: a frase já diz o que fazer, e o texto
      // técnico só assustava quem ia ler.
      _falhaTecnica('funis: ponte com o background', e);
      return { ok: false, erro: 'Recarregue a aba do WhatsApp Web — a extensão foi atualizada.' };
    }
    if (!resp || !resp.ok) return { ok: false, erro: (resp && resp.erro) || 'Não consegui falar com o JOB.' };
    const funis = resp.funis || [];
    _gestorModo = !!resp.gestor;
    _funisCache = { ts: Date.now(), funis, gestor: _gestorModo };
    return { ok: true, funis, gestor: _gestorModo };
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

  // FALHA SE APRESENTA COM UMA SAÍDA, NÃO COM A EXCEÇÃO.
  //
  // Aqui saía o texto cru do erro na tela do consultor. Não ajudava ninguém
  // (quem lê não sabe o que fazer com "Failed to fetch") e entregava pista de
  // stack pra quem não devia ver. O detalhe técnico vai pro console — é lá
  // que ele serve — e a tela diz o que houve e qual é o próximo passo.
  function _telaFalha(titulo, saida, idBotao, rotuloBotao) {
    return '<div class="job-erro job-erro-bloco">' +
      '<div class="job-erro-t">' + esc(titulo) + '</div>' +
      '<div class="job-erro-d">' + esc(saida) + '</div>' +
      (idBotao ? '<button class="job-analisar-btn" id="' + idBotao + '">' + esc(rotuloBotao) + '</button>' : '') +
      '</div>';
  }

  function _falhaTecnica(onde, e) {
    try { console.warn('[JOB] ' + onde, e); } catch (_) {}
  }

  // CABEÇALHO DE SEÇÃO — um só, nas onze telas.
  //
  // `titulo` diz onde você está; `sub` diz pra que a tela serve, numa linha.
  // `contador` é opcional e mora aqui de propósito: o mesmo bloco responde
  // "onde estou" e "quanto tem", em vez de espalhar o número pela tela.
  function _secHead(titulo, sub, contador) {
    return '<div class="job-sec-head">' +
      '<div class="job-sec-head-row">' +
        '<div class="job-sec-t">' + esc(titulo) + '</div>' +
        (contador != null && contador !== ''
          ? '<span class="job-sec-cont">' + esc(String(contador)) + '</span>' : '') +
      '</div>' +
      (sub ? '<div class="job-sec-sub">' + esc(sub) + '</div>' : '') +
      '</div>';
  }

  // ══ FOLHA DE CONFIRMAÇÃO ══════════════════════════════════════════════
  //
  // O `confirm()` do navegador abria uma caixa escrita "web.whatsapp.com diz"
  // — o WhatsApp assinando uma pergunta do JOB. Fora de feio, é errado: quem
  // está perguntando é a extensão, e a caixa nativa não deixa separar a ação
  // destrutiva do cancelar, nem dizer em cor o que vai acontecer.
  //
  // A folha sobe de baixo do painel, com o fundo recuando atrás dela. Sobe
  // porque foi de lá que veio: fechar desce pelo mesmo caminho — entrada e
  // saída simétricas. Quem clica fora, ou aperta ESC, cancela: a saída barata
  // é sempre a segura.
  //
  // Devolve Promise<boolean>, então quem chama troca `confirm(...)` por
  // `await _confirmar({...})` e nada mais muda.
  function _confirmar({ titulo, texto, ok, perigo }) {
    return new Promise((resolve) => {
      // Dentro do painel ela é filha dele (absoluta, cobre só o painel). No
      // portão o painel não existe: cai no body e precisa de posição fixa,
      // senão ela se ancora no topo do documento e some da tela.
      const painel = document.getElementById('job-painel-doc');
      const raiz = painel || document.body;
      const velha = document.getElementById('job-folha');
      if (velha) velha.remove();

      const el = document.createElement('div');
      el.id = 'job-folha';
      el.className = 'job-folha' + (perigo ? ' perigo' : '') + (painel ? '' : ' solta');
      el.innerHTML =
        '<div class="job-folha-fundo"></div>' +
        '<div class="job-folha-caixa" role="dialog" aria-modal="true">' +
          '<div class="job-folha-puxador"></div>' +
          '<div class="job-folha-t">' + esc(titulo) + '</div>' +
          '<div class="job-folha-d">' + esc(texto || '') + '</div>' +
          '<button class="job-folha-ok" id="job-folha-ok">' + esc(ok || 'Confirmar') + '</button>' +
          '<button class="job-folha-nao" id="job-folha-nao">Cancelar</button>' +
        '</div>';
      raiz.appendChild(el);
      // Um quadro depois, pra transição sair do estado fechado em vez de
      // nascer já aberta — sem isso não há movimento nenhum.
      requestAnimationFrame(() => el.classList.add('on'));

      let respondido = false;
      const fechar = (v) => {
        if (respondido) return; respondido = true;
        el.classList.remove('on');
        document.removeEventListener('keydown', naTecla, true);
        // Espera a saída terminar; se o navegador não animar, o tempo cobre.
        setTimeout(() => el.remove(), 260);
        resolve(v);
      };
      function naTecla(e) {
        if (e.key === 'Escape') { e.stopPropagation(); fechar(false); }
        else if (e.key === 'Enter') { e.stopPropagation(); fechar(true); }
      }
      document.addEventListener('keydown', naTecla, true);
      el.querySelector('.job-folha-fundo').addEventListener('click', () => fechar(false));
      el.querySelector('#job-folha-nao').addEventListener('click', () => fechar(false));
      el.querySelector('#job-folha-ok').addEventListener('click', () => fechar(true));
      // O foco começa no CANCELAR, não no confirmar: quem aperta espaço sem
      // ler não pode apagar nada por acidente.
      setTimeout(() => { const n = el.querySelector('#job-folha-nao'); if (n) n.focus(); }, 40);
    });
  }

  // ══ FOLHA DE SALVAR CONTATO ═══════════════════════════════════════════
  //
  // O botão do cabeçalho salvava direto, com o nome que as regras do CRM
  // montaram. Funciona, mas tira a última palavra de quem conhece o cliente —
  // e nome de contato é coisa que se corrige olhando.
  //
  // Em vez de um segundo botão ou de mandar pra aba do CRM, o próprio botão
  // abre uma folha flutuante com o nome já pronto e editável, e os pedaços
  // que o compõem à mão. Mesma linguagem do portão de login: superfície de
  // vidro por cima do WhatsApp, fundo recuando atrás.
  //
  // Devolve Promise<string|null> — o nome final, ou null se cancelou.
  function _folhaSalvarContato(nomeInicial) {
    return new Promise((resolve) => {
      const velha = document.getElementById('job-folha');
      if (velha) velha.remove();

      const chips = _PARTES_NOME.map((pp) => {
        const val = _pedacoDaFicha(pp.id);
        const on = _partesLigadas[pp.id] && val;
        return '<button type="button" class="job-nomec-chip' + (on ? ' on' : '') +
          (val ? '' : ' vazio') + '" data-parte="' + pp.id + '"' + (val ? '' : ' disabled') + '>' +
          '<span class="cat">' + pp.rot + '</span>' +
          '<span class="val' + (val ? '' : ' vazio') + '">' + (val ? esc(val) : '—') + '</span>' +
          '</button>';
      }).join('');

      const el = document.createElement('div');
      el.id = 'job-folha';
      el.className = 'job-folha solta job-folha-nome';
      el.innerHTML =
        '<div class="job-folha-fundo"></div>' +
        '<div class="job-folha-caixa" role="dialog" aria-modal="true">' +
          '<div class="job-folha-puxador"></div>' +
          '<div class="job-folha-t">Salvar contato</div>' +
          '<div class="job-folha-d">Confira o nome antes de gravar. Ele fica assim no seu WhatsApp e no celular.</div>' +
          '<div class="job-nomec-sub">Toque pra somar ao nome</div>' +
          '<div class="job-nomec-chips">' + chips + '</div>' +
          '<textarea id="job-folha-nome" class="job-campo job-nomec-val" rows="2" ' +
            'aria-label="Nome que vai pra agenda">' + esc(nomeInicial || '') + '</textarea>' +
          '<button class="job-folha-ok" id="job-folha-ok">Salvar na agenda</button>' +
          '<button class="job-folha-nao" id="job-folha-nao">Cancelar</button>' +
        '</div>';
      document.body.appendChild(el);
      requestAnimationFrame(() => el.classList.add('on'));

      const inp = el.querySelector('#job-folha-nome');
      let respondido = false;
      const fechar = (v) => {
        if (respondido) return; respondido = true;
        el.classList.remove('on');
        document.removeEventListener('keydown', naTecla, true);
        setTimeout(() => el.remove(), 260);
        resolve(v);
      };
      function naTecla(e) {
        if (e.key === 'Escape') { e.stopPropagation(); fechar(null); }
        else if (e.key === 'Enter' && document.activeElement === inp) {
          e.stopPropagation(); fechar((inp.value || '').trim() || null);
        }
      }
      document.addEventListener('keydown', naTecla, true);
      el.querySelector('.job-folha-fundo').addEventListener('click', () => fechar(null));
      el.querySelector('#job-folha-nao').addEventListener('click', () => fechar(null));
      el.querySelector('#job-folha-ok').addEventListener('click', () => fechar((inp.value || '').trim() || null));
      // Ligar/desligar um pedaço reescreve o nome NA HORA: é o que faz o chip
      // deixar de ser aposta. E respeita quem já editou à mão — só reescreve
      // se o campo ainda estiver com o texto que o padrão montou.
      let ultimoMontado = nomeInicial || '';
      el.querySelectorAll('.job-nomec-chip:not(.vazio)').forEach((c) => {
        c.addEventListener('click', () => {
          const k = c.dataset.parte;
          _partesLigadas[k] = !_partesLigadas[k];
          c.classList.toggle('on', _partesLigadas[k]);
          try { chrome.storage.local.set({ jobNomeContatoPartes: _partesLigadas }); } catch (e) {}
          const novo = _montarNomeContato();
          if ((inp.value || '').trim() === String(ultimoMontado).trim()) { inp.value = novo; _autoAltura(inp); }
          ultimoMontado = novo;
        });
      });
      // O foco vai pro CAMPO, não no cancelar: aqui a pessoa veio pra escrever.
      _autoAltura(inp);
      inp.addEventListener('input', () => _autoAltura(inp));
      setTimeout(() => { if (inp) { inp.focus(); inp.select(); } }, 60);
    });
  }

  // ESTADO VAZIO — dois tipos, e eles não são a mesma coisa.
  //
  // "Nunca houve" é a tela do primeiro dia: ela precisa dizer pra que serve o
  // lugar e como começar. "O filtro não achou" é um beco: existe conteúdo, e o
  // que a pessoa quer é voltar. Tratar os dois igual — que era o caso — deixa
  // o novato sem instrução e o veterano sem saída.
  //
  // `acao` é HTML de botão/link opcional. Sem ação, o estado vazio só informa,
  // e informar sem oferecer saída é metade do trabalho.
  function _vazio(titulo, texto, acao) {
    return '<div class="job-sem-analise job-vazio-bloco">' +
      '<div class="job-sem-analise-t">' + esc(titulo) + '</div>' +
      '<div class="job-sem-analise-txt">' + esc(texto) + '</div>' +
      (acao || '') +
      '</div>';
  }

  // Beco de filtro: o texto diz o que foi filtrado e o botão desfaz.
  function _vazioFiltro(oQue, idBotao) {
    return _vazio('Nada bate com esse filtro',
      'Você tem ' + oQue + ' cadastrado, só não neste recorte.',
      '<button class="job-analisar-btn job-vazio-btn" id="' + idBotao + '">Limpar filtro</button>');
  }

  // UM jeito de dizer "carregando", em vez dos três que existiam. O texto vem
  // por parâmetro porque dizer O QUE está carregando é o que faz a espera
  // parecer curta.
  function _telaCarregando(texto, dica) {
    return '<div class="job-sem-analise"><div class="job-carregando"></div>' +
      '<div class="job-sem-analise-txt">' + esc(texto || 'Carregando…') + '</div>' +
      (dica ? '<div class="job-cot-dica" style="text-align:center">' + esc(dica) + '</div>' : '') +
      '</div>';
  }

  async function abrirSecaoFunis() {
    _pastasAbertas.clear();
    setCorpoSecaoMensagens(_secHead('Funis', _FUNIS_SUB) + _telaCarregando('Carregando seus funis…'));
    let res;
    try {
      res = await buscarFunis(false);
    } catch (e) {
      _falhaTecnica('funis: busca', e);
      res = { ok: false };
    }
    if (_secaoAtiva !== 'funis') return;
    if (!res || !res.ok) {
      setCorpoSecaoMensagens(_secHead('Funis', _FUNIS_SUB) + _telaFalha(
        'Não consegui carregar os funis',
        'Pode ser a conexão ou o JOB fora do ar por um instante. Tente de novo; se insistir, avise o suporte.',
        'job-funis-retry', 'Tentar de novo'));
      const b = document.getElementById('job-funis-retry');
      if (b) b.addEventListener('click', abrirSecaoFunis);
      return;
    }
    try {
      setCorpoSecaoMensagens(renderFunis(res.funis));
      ligarAcoesFunis();
    } catch (e) {
      _falhaTecnica('funis: montagem da lista', e);
      setCorpoSecaoMensagens(_secHead('Funis', _FUNIS_SUB) + _telaFalha(
        'Não consegui montar a lista de funis',
        'Os funis vieram, mas algo na lista não pôde ser desenhado. Monte e edite pelo site enquanto isto não é corrigido.',
        'job-funis-retry', 'Tentar de novo'));
      const b = document.getElementById('job-funis-retry');
      if (b) b.addEventListener('click', abrirSecaoFunis);
    }
  }

  // Busca + "só favoritos" (padrão ZapVoice: Buscar… / Apenas favoritos).
  let _fnBusca = '', _fnSoFav = false;

  function funilPassaFiltro(f) {
    if (_fnSoFav && !f.favorito) return false;
    if (!_fnBusca) return true;
    return (f.nome || '').toLowerCase().indexOf(_fnBusca) >= 0
      || (f.categoria || '').toLowerCase().indexOf(_fnBusca) >= 0
      || (f.pasta || '').toLowerCase().indexOf(_fnBusca) >= 0;
  }

  var _FUNIS_SUB = 'Sequências prontas: cada passo sai na hora certa, na conversa que está aberta.';

  function renderFunis(funis) {
    return _secHead('Funis', _FUNIS_SUB, (funis && funis.length) || '') +
      '<button class="job-funil-criar" id="job-funil-criar">' +
        _svgIco('mais', 14) + ' Montar funil</button>' +
      '<div class="job-biblioteca-controles">' +
        '<input class="job-inp" id="job-busca-funil" placeholder="Buscar funil…" value="' + esc(_fnBusca) + '">' +
        '<div class="job-fchips">' +
          '<button class="job-fchip ' + (_fnSoFav ? '' : 'on') + '" data-fn-fav="0">Todos</button>' +
          '<button class="job-fchip ' + (_fnSoFav ? 'on' : '') + '" data-fn-fav="1">' + _svgIco('estrela', 11) + ' Favoritos</button>' +
        '</div>' +
      '</div>' +
      '<div id="job-funis-lista">' + listaFunisHTML(funis) + '</div>' +
      '<a class="job-funis-gerenciar" href="' + esc(_SITE_BASE_URL_EXT) + '/crm/funis" target="_blank" rel="noopener">Abrir central de funis no JOB</a>';
  }

  function listaFunisHTML(funis) {
    if (!funis.length) {
      return _vazio('Nenhum funil montado',
        'Um funil envia texto, áudio, imagem ou PDF em sequência, com o intervalo que você definir.',
        '<button class="job-analisar-btn job-vazio-btn" id="job-funil-vazio-criar">Montar o primeiro funil</button>');
    }
    const vis = funis.filter(funilPassaFiltro);
    if (!vis.length) return _vazioFiltro('funil', 'job-limpar-f-funil');
    // Mesmas duas raízes das mensagens — Minha biblioteca e Compartilhado —, e
    // dentro delas as pastas do JOB. Funil é sequência multi-tipo, então não
    // tem o sub-nível de tipo que as mensagens têm.
    const forcarAberto = !!(_fnBusca || _fnSoFav);
    const porRaiz = new Map([['Minha biblioteca', []], ['Compartilhado', []]]);
    vis.forEach((f) => porRaiz.get(f.compartilhado ? 'Compartilhado' : 'Minha biblioteca').push(f));
    let out = '';
    porRaiz.forEach((itens, raiz) => {
      if (!itens.length) return;
      const key = 'funis:raiz:' + raiz;
      const porPasta = new Map();
      itens.forEach((f) => {
        const cam = ((f.pasta || '').trim()) || ((f.categoria || '').trim());
        if (!porPasta.has(cam)) porPasta.set(cam, []);
        porPasta.get(cam).push(f);
      });
      const nomes = [...porPasta.keys()].sort((a, b) =>
        (a === '' ? 1 : (b === '' ? -1 : a.localeCompare(b))));
      let dentro = '';
      nomes.forEach((cam) => {
        const doGrupo = porPasta.get(cam);
        if (!cam) { dentro += doGrupo.map(cardFunil).join(''); return; }
        const chave = 'funis:' + raiz + ':pasta:' + cam;
        dentro += '<details class="job-subpasta" data-pasta-key="' + esc(chave) + '"' +
          ((forcarAberto || _pastaAberta(chave)) ? ' open' : '') + '><summary class="job-subpasta-nome">' +
          esc(cam) + ' <span>(' + doGrupo.length + ')</span></summary>' +
          '<div class="job-subpasta-conteudo">' + doGrupo.map(cardFunil).join('') + '</div></details>';
      });
      out += '<details class="job-pasta" data-pasta-key="' + esc(key) + '"' +
        ((forcarAberto || _pastaAberta(key)) ? ' open' : '') + '><summary class="job-pasta-nome">' +
        esc(raiz) + ' <span>(' + itens.length + ')</span></summary>' +
        '<div class="job-pasta-conteudo">' + dentro + '</div></details>';
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
      '<div class="job-funil-passos">' + (listaPassos || '<div class="job-vazio" style="padding:8px 0 2px">Este funil está vazio: nenhum passo pra disparar. Edite no site pra adicionar.</div>') + '</div>' +
      '<div class="job-funil-acoes">' +
        (f.pode_editar ? '<button class="job-funil-editar" data-funil-id="' + f.id + '">' +
          _svgIco('lapis', 13) + ' Editar</button>' : '') +
        '<button class="job-funil-duplicar" data-funil-id="' + f.id + '">' +
          _ICO_COPIAR + ' Duplicar</button>' +
        '<button class="job-funil-disparar" data-funil-id="' + f.id + '"' + (passos.length ? '' : ' disabled') + '>' +
          _ICO_ENVIAR + ' Disparar</button>' +
      '</div>' +
    '</div>';
  }

  const _ICO_ENVIAR = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';

  function _fnTipoDoModelo(m) {
    return (m && ['audio', 'imagem', 'video', 'documento'].includes(m.midia_tipo || m.tipo))
      ? (m.midia_tipo || m.tipo) : 'texto';
  }

  function _fnPassoDoModelo(m) {
    return {
      modelo_id: m.id,
      nome: m.nome || 'Mensagem sem nome',
      texto: m.texto || '',
      tipo: _fnTipoDoModelo(m),
      midia_url: m.midia_url || null,
      delay_segundos: (_fnRascunho && _fnRascunho.passos.length) ? 5 : 0,
    };
  }

  function _fnDelayOpcoes(valor) {
    const opcoes = [
      [0, 'Agora'], [5, '5 s'], [10, '10 s'], [30, '30 s'],
      [60, '1 min'], [120, '2 min'], [300, '5 min'],
    ];
    if (!opcoes.some((o) => o[0] === valor)) opcoes.push([valor, fmtQuando(valor).replace('após ', '')]);
    return opcoes.sort((a, b) => a[0] - b[0]).map((o) =>
      '<option value="' + o[0] + '"' + (o[0] === valor ? ' selected' : '') + '>' + esc(o[1]) + '</option>'
    ).join('');
  }

  function _fnCardEditor(p, i, total) {
    const tipo = p.tipo || 'texto';
    const previa = (p.texto || '').trim();
    return '<div class="job-funil-editor-bloco" role="listitem">' +
      '<div class="job-funil-conector">' +
        '<span class="job-funil-conector-linha"></span>' +
        '<label for="job-fn-delay-' + i + '">' + (i === 0 ? 'Começa' : 'Depois') + '</label>' +
        '<select id="job-fn-delay-' + i + '" class="job-funil-delay" data-index="' + i +
          '" aria-label="Espera antes da mensagem ' + (i + 1) + '">' +
          _fnDelayOpcoes(Math.max(0, Number(p.delay_segundos) || 0)) +
        '</select>' +
      '</div>' +
      '<div class="job-funil-editor-passo t-' + esc(tipo) + '">' +
        '<span class="job-funil-editor-num">' + (i + 1) + '</span>' +
        '<span class="job-funil-editor-ico">' + funilTipoIcone(tipo, 15) + '</span>' +
        '<div class="job-funil-editor-info">' +
          '<div class="job-funil-editor-nome">' + esc(p.nome) + '</div>' +
          (previa ? '<div class="job-funil-editor-previa">' + esc(previa) + '</div>' : '') +
        '</div>' +
        '<div class="job-funil-editor-acoes">' +
          '<button class="job-funil-mover" data-index="' + i + '" data-dir="-1"' + (i === 0 ? ' disabled' : '') +
            ' aria-label="Mover mensagem ' + (i + 1) + ' para cima">' + _svgIco('cima', 14) + '</button>' +
          '<button class="job-funil-mover" data-index="' + i + '" data-dir="1"' + (i === total - 1 ? ' disabled' : '') +
            ' aria-label="Mover mensagem ' + (i + 1) + ' para baixo">' + _svgIco('baixo', 14) + '</button>' +
          '<button class="job-funil-remover" data-index="' + i + '" aria-label="Remover mensagem ' + (i + 1) + '">' +
            _svgIco('lixo', 14) + '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function _fnResultadosModelos() {
    const modelos = (_modelosCache && _modelosCache.modelos) || [];
    const q = (_fnPickerBusca || '').trim().toLowerCase();
    return modelos.filter((m) => {
      if (!q) return true;
      return (m.nome || '').toLowerCase().includes(q)
        || (m.texto || '').toLowerCase().includes(q)
        || (m.categoria || '').toLowerCase().includes(q);
    }).sort((a, b) => {
      const an = (a.nome || '').toLowerCase(), bn = (b.nome || '').toLowerCase();
      const ap = q && an.startsWith(q) ? 0 : 1, bp = q && bn.startsWith(q) ? 0 : 1;
      return ap - bp || an.localeCompare(bn);
    }).slice(0, 40);
  }

  function _fnPickerListaHTML() {
    const resultados = _fnResultadosModelos();
    if (!resultados.length) {
      return '<div class="job-funil-picker-vazio">Nenhuma mensagem bate com a busca. Tente pelo nome ou pela pasta.</div>';
    }
    return resultados.map((m) => {
      const tipo = _fnTipoDoModelo(m);
      return '<button class="job-funil-picker-item" type="button" data-modelo-id="' + m.id + '">' +
        '<span class="job-funil-picker-ico t-' + tipo + '">' + funilTipoIcone(tipo, 14) + '</span>' +
        '<span class="job-funil-picker-info"><b>' + esc(m.nome) + '</b>' +
          '<small>' + esc((m.categoria || 'Geral') + ' · ' + (tipo === 'documento' ? 'PDF' : tipo)) + '</small></span>' +
      '</button>';
    }).join('');
  }

  function renderEditorFunil() {
    const r = _fnRascunho;
    const passos = r.passos || [];
    return '<div class="job-funil-editor">' +
      '<div class="job-funil-editor-nav">' +
        '<button id="job-funil-editor-voltar" aria-label="Voltar para os funis">' + _svgIco('voltar', 15) + '</button>' +
        '<div><b>' + (r.id ? 'Editar funil' : 'Novo funil') + '</b><span>Monte a sequência sem sair da conversa</span></div>' +
      '</div>' +
      '<div class="job-funil-editor-campos">' +
        '<label for="job-funil-editor-nome">Nome do funil</label>' +
        '<input class="job-inp" id="job-funil-editor-nome" maxlength="200" autocomplete="off" value="' + esc(r.nome || '') +
          '" placeholder="Ex: Primeiro contato PME">' +
        '<label for="job-funil-editor-cat">Pasta <span>opcional</span></label>' +
        '<input class="job-inp" id="job-funil-editor-cat" maxlength="120" autocomplete="off" value="' + esc(r.categoria || '') +
          '" placeholder="Ex: PME ou Renovação">' +
      '</div>' +
      '<div class="job-funil-editor-resumo"><b>Sequência</b><span>' + passos.length + ' ' + (passos.length === 1 ? 'mensagem' : 'mensagens') +
        (passos.length ? ' · ' + esc(fmtQuando(passos.reduce((s, p) => s + (Number(p.delay_segundos) || 0), 0)).replace('após ', '')) : '') + '</span></div>' +
      '<div class="job-funil-editor-lista" role="list">' +
        (passos.length ? passos.map((p, i) => _fnCardEditor(p, i, passos.length)).join('')
          : '<div class="job-funil-editor-vazio"><b>A sequência está vazia</b><span>Adicione a primeira mensagem abaixo. Ela pode sair na hora ou depois de um intervalo.</span></div>') +
      '</div>' +
      '<div class="job-funil-adicionar">' +
        '<button id="job-funil-abrir-picker" type="button">' + _svgIco('mais', 14) + ' Adicionar mensagem</button>' +
        (_fnPickerAberto ? '<div class="job-funil-picker">' +
          '<label for="job-funil-picker-busca">Buscar na biblioteca</label>' +
          '<input class="job-inp" id="job-funil-picker-busca" autocomplete="off" value="' + esc(_fnPickerBusca) +
            '" placeholder="Nome, texto ou pasta" aria-controls="job-funil-picker-lista">' +
          '<div id="job-funil-picker-lista" class="job-funil-picker-lista">' + _fnPickerListaHTML() + '</div>' +
        '</div>' : '') +
      '</div>' +
      '<div class="job-funil-editor-rodape">' +
        '<div id="job-funil-editor-status" class="job-funil-editor-status" aria-live="polite"></div>' +
        '<button class="job-funil-editor-cancelar" id="job-funil-editor-cancelar" type="button">Cancelar</button>' +
        '<button class="job-funil-editor-salvar" id="job-funil-editor-salvar" type="button">Salvar funil</button>' +
      '</div>' +
    '</div>';
  }

  function _fnEditorStatus(texto, erro) {
    const el = document.getElementById('job-funil-editor-status');
    if (!el) return;
    el.textContent = texto || '';
    el.classList.toggle('erro', !!erro);
  }

  function _fnAtualizarPicker() {
    const lista = document.getElementById('job-funil-picker-lista');
    if (lista) {
      lista.innerHTML = _fnPickerListaHTML();
      ligarItensPickerFunil();
    }
  }

  function ligarItensPickerFunil() {
    document.querySelectorAll('.job-funil-picker-item[data-modelo-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const m = ((_modelosCache && _modelosCache.modelos) || []).find((x) => String(x.id) === btn.dataset.modeloId);
        if (!m) return;
        _fnRascunho.passos.push(_fnPassoDoModelo(m));
        _fnEditorSujo = true;
        _fnPickerAberto = false;
        _fnPickerBusca = '';
        setCorpoSecaoMensagens(renderEditorFunil());
        ligarEditorFunil();
      });
    });
  }

  async function voltarDaEdicaoFunil() {
    if (_fnEditorSujo && !await _confirmar({
      titulo: 'Descartar alterações?',
      texto: 'O funil volta ao estado em que estava antes de abrir o editor.',
      ok: 'Descartar alterações',
    })) return;
    _fnRascunho = null;
    _fnEditorSujo = false;
    _fnPickerAberto = false;
    await abrirSecaoFunis();
  }

  async function abrirEditorFunil(funilId) {
    setCorpoSecaoMensagens(_secHead(funilId ? 'Editar funil' : 'Novo funil', 'Preparando sua biblioteca…') +
      _telaCarregando('Carregando mensagens…'));
    let modelos;
    try { modelos = await buscarModelos(false); }
    catch (e) { setCorpoSecaoMensagens(_avisoRecarregarAba()); return; }
    if (_secaoAtiva !== 'funis') return;
    const funil = funilId && _funisCache
      ? _funisCache.funis.find((f) => String(f.id) === String(funilId)) : null;
    if (funilId && !funil) {
      setCorpoSecaoMensagens(_telaFalha('Funil não encontrado', 'Volte à lista e tente abrir de novo.', 'job-funis-retry', 'Voltar à lista'));
      const retry = document.getElementById('job-funis-retry');
      if (retry) retry.addEventListener('click', abrirSecaoFunis);
      return;
    }
    _fnRascunho = funil ? {
      id: funil.id, nome: funil.nome || '', categoria: funil.categoria || '',
      passos: (funil.passos || []).map((p) => ({
        modelo_id: p.modelo_id, nome: p.nome, texto: p.texto || '', tipo: p.tipo || 'texto',
        midia_url: p.midia_url || null, delay_segundos: Number(p.delay_segundos) || 0,
      })),
    } : { id: null, nome: '', categoria: '', passos: [] };
    _fnEditorSujo = false;
    _fnPickerBusca = '';
    _fnPickerAberto = !modelos.length;
    setCorpoSecaoMensagens(renderEditorFunil());
    ligarEditorFunil();
    const nome = document.getElementById('job-funil-editor-nome');
    if (nome && !funil) nome.focus();
  }

  async function salvarEditorFunil() {
    const nome = document.getElementById('job-funil-editor-nome');
    const cat = document.getElementById('job-funil-editor-cat');
    _fnRascunho.nome = (nome && nome.value || '').trim();
    _fnRascunho.categoria = (cat && cat.value || '').trim();
    if (!_fnRascunho.nome) {
      _fnEditorStatus('Dê um nome ao funil.', true);
      if (nome) nome.focus();
      return;
    }
    if (!_fnRascunho.passos.length) {
      _fnEditorStatus('Adicione pelo menos uma mensagem à sequência.', true);
      return;
    }
    const btn = document.getElementById('job-funil-editor-salvar');
    if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }
    let resp;
    try {
      resp = await chrome.runtime.sendMessage({
        type: 'salvar_funil',
        dados: {
          id: _fnRascunho.id,
          nome: _fnRascunho.nome,
          categoria: _fnRascunho.categoria,
          passos: _fnRascunho.passos.map((p) => ({
            modelo_id: p.modelo_id,
            delay_segundos: Math.max(0, Number(p.delay_segundos) || 0),
          })),
        },
      });
    } catch (e) {
      resp = { ok: false, erro: 'Recarregue a aba do WhatsApp Web e tente novamente.' };
    }
    if (!resp || !resp.ok) {
      _fnEditorStatus((resp && resp.erro) || 'Não consegui salvar. Tente de novo.', true);
      if (btn) { btn.disabled = false; btn.textContent = 'Salvar funil'; }
      return;
    }
    _fnEditorSujo = false;
    _fnRascunho = null;
    _funisCache = null;
    await abrirSecaoFunis();
    _dizerNoRodape('Funil salvo e pronto para usar.');
  }

  function ligarEditorFunil() {
    const voltar = document.getElementById('job-funil-editor-voltar');
    const cancelar = document.getElementById('job-funil-editor-cancelar');
    const salvar = document.getElementById('job-funil-editor-salvar');
    if (voltar) voltar.addEventListener('click', voltarDaEdicaoFunil);
    if (cancelar) cancelar.addEventListener('click', voltarDaEdicaoFunil);
    if (salvar) salvar.addEventListener('click', salvarEditorFunil);
    ['job-funil-editor-nome', 'job-funil-editor-cat'].forEach((id) => {
      const inp = document.getElementById(id);
      if (inp) inp.addEventListener('input', () => {
        if (id === 'job-funil-editor-nome') _fnRascunho.nome = inp.value;
        else _fnRascunho.categoria = inp.value;
        _fnEditorSujo = true;
        _fnEditorStatus('');
      });
    });
    document.querySelectorAll('.job-funil-delay[data-index]').forEach((sel) => {
      sel.addEventListener('change', () => {
        const p = _fnRascunho.passos[Number(sel.dataset.index)];
        if (p) {
          p.delay_segundos = Number(sel.value) || 0;
          _fnEditorSujo = true;
          setCorpoSecaoMensagens(renderEditorFunil());
          ligarEditorFunil();
        }
      });
    });
    document.querySelectorAll('.job-funil-mover[data-index]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.index), j = i + Number(btn.dataset.dir);
        if (j < 0 || j >= _fnRascunho.passos.length) return;
        const trocado = _fnRascunho.passos[i];
        _fnRascunho.passos[i] = _fnRascunho.passos[j];
        _fnRascunho.passos[j] = trocado;
        _fnEditorSujo = true;
        setCorpoSecaoMensagens(renderEditorFunil()); ligarEditorFunil();
      });
    });
    document.querySelectorAll('.job-funil-remover[data-index]').forEach((btn) => {
      btn.addEventListener('click', () => {
        _fnRascunho.passos.splice(Number(btn.dataset.index), 1);
        _fnEditorSujo = true;
        setCorpoSecaoMensagens(renderEditorFunil()); ligarEditorFunil();
      });
    });
    const abrirPicker = document.getElementById('job-funil-abrir-picker');
    if (abrirPicker) abrirPicker.addEventListener('click', () => {
      _fnPickerAberto = !_fnPickerAberto;
      setCorpoSecaoMensagens(renderEditorFunil()); ligarEditorFunil();
      const inp = document.getElementById('job-funil-picker-busca'); if (inp) inp.focus();
    });
    const busca = document.getElementById('job-funil-picker-busca');
    if (busca) {
      busca.addEventListener('input', () => { _fnPickerBusca = busca.value || ''; _fnAtualizarPicker(); });
      busca.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          _fnPickerAberto = false; setCorpoSecaoMensagens(renderEditorFunil()); ligarEditorFunil();
        } else if (e.key === 'Enter') {
          const primeiro = document.querySelector('.job-funil-picker-item[data-modelo-id]');
          if (primeiro) { e.preventDefault(); primeiro.click(); }
        }
      });
    }
    ligarItensPickerFunil();
  }

  function rerenderFunisLista() {
    const c = document.getElementById('job-funis-lista');
    if (!c) return;
    c.innerHTML = listaFunisHTML(_funisCache ? _funisCache.funis : []);
    ligarAcoesListaFunis();
    _ligarLimparFiltroFunil();
    _observarMidias(c);
  }

  // O botão do estado vazio precisa ser religado a cada redesenho da lista —
  // oferecer uma saída que não abre é pior que não oferecer nenhuma.
  function _ligarLimparFiltroFunil() {
    const b = document.getElementById('job-limpar-f-funil');
    if (!b) return;
    b.addEventListener('click', () => {
      _fnBusca = ''; _fnSoFav = false;
      const inp = document.getElementById('job-busca-funil');
      if (inp) inp.value = '';
      document.querySelectorAll('.job-fchip[data-fn-fav]').forEach((c) =>
        c.classList.toggle('on', c.dataset.fnFav === '0'));
      rerenderFunisLista();
    });
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
    document.querySelectorAll('.job-funil-editar[data-funil-id]').forEach((btn) => {
      btn.addEventListener('click', () => abrirEditorFunil(btn.dataset.funilId));
    });
    document.querySelectorAll('.job-funil-duplicar[data-funil-id]').forEach((btn) => {
      btn.addEventListener('click', () => duplicarFunil(btn.dataset.funilId, btn));
    });
    const vazioCriar = document.getElementById('job-funil-vazio-criar');
    if (vazioCriar) vazioCriar.addEventListener('click', () => abrirEditorFunil(null));
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
    const criar = document.getElementById('job-funil-criar');
    if (criar) criar.addEventListener('click', () => abrirEditorFunil(null));
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
    _ligarLimparFiltroFunil();
  }

  async function duplicarFunil(id, btn) {
    const original = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Duplicando…';
    const resp = await chrome.runtime.sendMessage({ type: 'duplicar_funil', id });
    if (!resp || !resp.ok) {
      btn.disabled = false; btn.innerHTML = original;
      _dizerNoRodape((resp && resp.erro) || 'Não consegui duplicar o funil.');
      return;
    }
    _funisCache = null;
    await abrirSecaoFunis();
    _dizerNoRodape('Cópia do funil criada na sua pasta.');
  }

  function _uid() {
    return 'j' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Trava local de repetição: não deixa o mesmo conteúdo sair duas vezes em
  // seguida para a mesma conversa, seja pelo botão da biblioteca ou por passo
  // de funil. É deliberadamente uma recusa imediata, não uma espera oculta.
  const _ENVIO_REPETIDO_MS = 2 * 60 * 1000;
  const _enviosRecentes = new Map();
  function _chaveEnvio(chatId, tipo, texto, modeloId) {
    return [chatId || '', tipo || 'texto', modeloId || '',
      String(texto || '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('pt-BR')].join('|');
  }
  function _foiRepetido(chatId, tipo, texto, modeloId) {
    const agora = Date.now();
    for (const [k, quando] of _enviosRecentes) if (agora - quando > _ENVIO_REPETIDO_MS) _enviosRecentes.delete(k);
    const chave = _chaveEnvio(chatId, tipo, texto, modeloId);
    const anterior = _enviosRecentes.get(chave);
    return !!(anterior && agora - anterior < _ENVIO_REPETIDO_MS);
  }
  function _registrarEnvio(chatId, tipo, texto, modeloId) {
    _enviosRecentes.set(_chaveEnvio(chatId, tipo, texto, modeloId), Date.now());
  }

  // ── Dispara um funil: cria um "job" e entra na fila. Jobs em conversas
  //    DIFERENTES rodam em paralelo (não se atrapalham). Dois jobs pro MESMO
  //    contato enfileiram — o segundo só começa quando o primeiro terminar,
  //    pra nunca intercalar mensagens de dois funis na mesma conversa. ──
  async function dispararFunil(funilId) {
    const res = await buscarFunis(false);
    // Três casos DIFERENTES, três mensagens — misturar tudo em "não tem passos"
    // já mascarou um bug real de cache.
    if (!res || !res.ok) { _dizerNoRodape('Não consegui carregar o funil. Tente de novo.'); return; }
    const funil = (res.funis || []).find((f) => String(f.id) === String(funilId));
    if (!funil) { _dizerNoRodape('Funil não encontrado. Abra a aba Funis novamente.'); return; }
    if (!(funil.passos || []).length) { _dizerNoRodape('Esse funil está vazio. Edite e adicione a primeira mensagem.'); return; }
    const { usuarioId } = await _safeStorageGet(['usuarioId']);
    if (!usuarioId) { _dizerNoRodape('Entre no popup do JOB antes de disparar.'); return; }
    let chatId = '';
    try { chatId = await pedirChatId(); } catch (e) { chatId = ''; }
    if (!chatId) { _dizerNoRodape('Abra a conversa do cliente antes de disparar.'); return; }
    const nome = nomeDoContato() || 'este contato';
    const totalS = funil.passos.reduce((s, p) => s + (Number(p.delay_segundos) || 0), 0);
    if (!await _confirmar({
      titulo: 'Disparar "' + funil.nome + '"?',
      texto: funil.passos.length + ' ' + (funil.passos.length === 1 ? 'mensagem' : 'mensagens') +
           ' para ' + nome + (totalS ? ', ao longo de aproximadamente ' + fmtQuando(totalS).replace('após ', '') : ', começando agora') + '.',
      ok: 'Disparar agora' })) return;
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
      if (_foiRepetido(job.chatId, passo.tipo, passo.texto, passo.modelo_id)) {
        job.bloqueados = (job.bloqueados || 0) + 1;
        job.enviando = -1;
        job.erro = 'Passo repetido bloqueado para este contato.';
        renderBubble();
        continue;
      }
      let envio;
      try {
        if (passo.tipo && passo.tipo !== 'texto' && passo.midia_url) {
          const dl = await chrome.runtime.sendMessage({ type: 'baixar_midia', url: passo.midia_url });
          if (dl && dl.ok) envio = await pedirEnviarMidia(job.chatId, passo.tipo, dl.dataUrl, passo.texto, _nomeArquivoDaUrl(passo.midia_url));
          else envio = { ok: false, erro: (dl && dl.erro) || 'falha ao baixar a mídia' };
        } else {
          envio = await pedirEnviarTexto(job.chatId, passo.texto);
        }
      } catch (e) {
        // A bolha do funil mostra este texto passo a passo: tem que ser uma
        // frase, não um objeto de exceção.
        _falhaTecnica('funil: envio do passo', e);
        envio = { ok: false, erro: 'não consegui enviar este passo' };
      }
      job.enviando = -1;
      if (envio && envio.ok) { _registrarEnvio(job.chatId, passo.tipo, passo.texto, passo.modelo_id); job.enviados++; job.passoAtual = i + 1; }
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
    _ouvir(document, 'mousemove', (e) => {
      if (!arrastando) return;
      el.dataset.arrastou = '1';
      const left = Math.min(Math.max(4, e.clientX - offX), window.innerWidth - 60);
      const top = Math.min(Math.max(4, e.clientY - offY), window.innerHeight - 60);
      _bubblePos = { left, top };
      el.style.left = left + 'px'; el.style.top = top + 'px';
      el.style.right = 'auto'; el.style.bottom = 'auto';
    });
    _ouvir(document, 'mouseup', () => { arrastando = false; });
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
          : '<div class="job-ia-alerta">Lead criado SEM responsável — selecione seu usuário no popup da extensão (e cadastre seu telefone em Usuários no JOB).</div>';
      } else if (ehMeu === true) {
        donoLinha = '<div class="job-lead-dono ok">Este lead já está no seu cadastro.</div>';
      } else if (r.lead_responsavel_nome && ehMeu === false) {
        donoLinha = '<div class="job-ia-alerta">Este lead está com OUTRO consultor no JOB: <b>' + esc(r.lead_responsavel_nome) + '</b>.</div>';
      } else if (r.lead_responsavel_nome) {
        donoLinha = '<div class="job-lead-dono neutro">Responsável no JOB: <b>' + esc(r.lead_responsavel_nome) + '</b>.</div>';
      } else {
        donoLinha = '<div class="job-lead-dono warn">Este lead está sem responsável no JOB.</div>';
      }
    }
    const avisoConsultor = r.aviso_consultor
      ? '<div class="job-ia-alerta">' + esc(r.aviso_consultor) + '</div>'
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
    // ── A CAPA DA ANALISE ────────────────────────────────────────────────
    //
    // A tela tem tudo: score, criterios, dados do lead, documentos, acoes,
    // follow-up, leitura da IA. O problema e que so tem ISSO — pra saber do
    // que se trata era preciso rolar a tela inteira e montar o quadro de
    // cabeca. No meio de um atendimento, com o cliente esperando, ninguem faz.
    //
    // Tres linhas, com o que ja veio na resposta: o que ele quer, em que pe
    // esta, e o que fazer agora. Linha sem dado nao aparece — capa com buraco
    // e pior que capa nenhuma.
    const primeira = (r.sugestoes || [])[0];
    const querPartes = [
      tipoRot,
      ex.vidas ? ex.vidas + (String(ex.vidas) === '1' ? ' vida' : ' vidas') : '',
      ex.cidade,
      ex.operadora_interesse || ex.plano_preferido,
    ].filter(Boolean);
    const estaPartes = [
      r.fase_funil,
      (r.cap && r.cap.motivo) ? r.cap.motivo : '',
      ex.urgencia ? 'urgência: ' + ex.urgencia : '',
    ].filter(Boolean);
    const capaL = (rot, val) => val
      ? '<div class="job-capa-l"><span class="k">' + rot + '</span>' +
        '<span class="v">' + esc(val) + '</span></div>' : '';
    const capa = (querPartes.length || estaPartes.length || primeira)
      ? '<div class="job-capa">' +
          capaL('Quer', querPartes.join(' · ')) +
          capaL('Está em', estaPartes.join(' · ')) +
          capaL('Fazer agora', primeira
            ? (primeira.titulo || '') + (primeira.detalhe ? ' — ' + primeira.detalhe : '')
            : '') +
        '</div>'
      : '';
    const pen = (r.penalidades || []).map((p) => '<span class="job-chip job-chip-pen">' +
      esc(p.regra) + ' ' + p.pontos + '</span>').join('');
    // Por que o score parou nesse teto — antes o backend calculava e mandava
    // o motivo, mas o painel nunca mostrava (consultor via um score baixo sem
    // saber o porquê, ex: "conversa parada há mais de 10 dias").
    const capBox = (r.cap && r.cap.motivo)
      ? '<div class="job-ia-alerta">Score limitado a ' + r.cap.valor + ': ' + esc(r.cap.motivo) + '</div>'
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
      ? avisos.map((a) => '<div class="job-ia-alerta">' + esc(a) + '</div>').join('')
      : '';
    // PDFs do consultor com +5 páginas que nem baixamos (otimização) — aviso
    // próprio, com botão pra ler mesmo assim se o Guilherme quiser.
    const avisoPulados = (Array.isArray(r._pulados) && r._pulados.length)
      ? '<div class="job-ia-alerta">' + esc(r._pulados.length + ' PDF(s) que o consultor enviou não foram lidos por terem mais de 5 páginas (material de apoio costuma não mudar a análise): ' +
          r._pulados.map((p) => p.nome + ' (' + p.paginas + ' pág)').join(', ')) +
          '<div style="margin-top:7px;"><button class="job-copy" id="job-avaliar-pdfs" style="font-size:12px;padding:4px 10px;">Avaliar esses PDFs mesmo assim</button></div></div>'
      : '';
    const partesRodape = [esc(nome || ''), totalMsgs + ' mensagens lidas'];
    if (r.duracao_segundos != null) partesRodape.push('levou ' + fmtDuracao(r.duracao_segundos));
    if (r.audios_do_cache) partesRodape.push(r.audios_do_cache + ' áudio(s) reaproveitados do cache');
    partesRodape.push('somente leitura');
    return (
            // _secHead já escapa: passar esc() aqui escaparia duas vezes e o nome
      // com acento sairia como entidade na tela.
      _secHead('Análise', (nome || telefone || 'Esta conversa'), totalMsgs ? totalMsgs + ' msgs' : '') +
      '<div class="job-score-wrap">' +
        '<div class="job-score-num ' + fx + '">' + (r.score != null ? r.score : '—') + '</div>' +
        '<div class="job-score-meta"><div class="job-score-faixa ' + fx + '">' +
          esc((r.faixa || '').toUpperCase()) + '</div>' +
          '<div class="job-score-sub">Score Lead · 0–1000 · ' + (r.categorias_consideradas || 0) + '/' +
          (r.categorias_totais || 28) + ' critérios</div></div>' +
      '</div>' +
      '<div class="job-barra"><div class="job-barra-fill ' + fx + '" style="width:' + Math.round((r.score || 0) / 10) + '%;"></div></div>' +
      capa +
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
      // "Sem sugestões." não dizia se era bom sinal ou defeito.
      (sugs || _vazio('Nada a corrigir aqui',
        'A leitura não encontrou nenhuma ação pendente nesta conversa. Isso é bom sinal — não é falha.')) +
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
          '<div class="job-ia-alerta">' + esc(a) + '</div>').join('') + '</div>'
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
    // O QUE FALTA PERGUNTAR. Vem da leitura da conversa: os dados de
    // qualificação que ainda não existem e travam esta venda, já com a pergunta
    // escrita. Clicar copia — a distância entre "sei o que falta" e "perguntei"
    // tem que ser um clique, senão continua faltando.
    const faltas = (ia.o_que_falta || []).filter((f) => f && f.pergunta);
    const blocoFalta = faltas.length
      ? '<div class="job-sec">Falta perguntar (' + faltas.length + ')</div>' +
        faltas.map((f) =>
          '<div class="job-falta" data-q="' + esc(f.pergunta) + '" title="Clique para copiar a pergunta">' +
          '<b>' + esc(f.dado || '') + '</b><span>' + esc(f.pergunta) + '</span></div>').join('')
      : '';
    return (
      // SEM O NOME DO FORNECEDOR. Dizia "Claude" aqui: pista de stack numa
      // tela que um dia chega perto de cliente ou de outra corretora, e que
      // fica errada no dia em que o motor mudar. Quem lê quer saber que a
      // leitura é automática — não de quem é o motor.
      '<div class="job-sec">Leitura automática da conversa</div>' +
      '<div class="job-resumo">' + esc(ia.resumo || '') + '</div>' +
      blocoImgs +
      blocoDocs +
      alertas +
      blocoFalta +
      (acoes ? '<div class="job-sec">Próximas ações (IA)</div>' + acoes : '')
    );
  }

  // Copia a pergunta que falta com um clique. Delegado no documento porque a
  // ficha é remontada inteira a cada análise — listener por elemento morreria.
  _ouvir(document, 'click', (ev) => {
    const el = ev.target && ev.target.closest && ev.target.closest('.job-falta');
    if (!el || !el.dataset.q) return;
    navigator.clipboard.writeText(el.dataset.q).then(() => {
      const antes = el.style.borderColor;
      el.style.borderColor = 'var(--job-acento)';
      const marca = el.querySelector('b');
      const txt = marca ? marca.textContent : '';
      if (marca) marca.textContent = 'copiado';
      setTimeout(() => {
        el.style.borderColor = antes;
        if (marca) marca.textContent = txt;
      }, 1400);
    }).catch(() => {});
  }, true);

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
        // Abria aba nova no JOB. Agora cota aqui mesmo, com as idades que a
        // análise já leu da conversa — era o último lugar da extensão que
        // obrigava o consultor a sair do atendimento pra cotar.
        _cot = { idades: bc.dataset.idades || '', cidade: '', modalidade: 1 };
        _cotDireto = true;
        abrirSecao('cotacao');
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
    setCorpoSecao(_telaCarregando('Abrindo notas…'));
    let tel = '';
    try { tel = (await pedirTelefoneWpp()) || telefoneDoContato(); } catch (e) { tel = telefoneDoContato(); }
    const nome = nomeDoContato();
    if (!tel) {
      setCorpoSecao(_secHead('Notas', 'Ficam salvas no JOB; qualquer consultor que abrir esta conversa vê.') +
        _vazio('Nenhuma conversa aberta',
          'As notas são de quem está na tela. Abra a conversa do cliente e volte aqui.'));
      return;
    }
    await _carregarNotasSecao(tel, nome);
  }

  async function _carregarNotasSecao(tel, nome) {
    let resp;
    try { resp = await _safeSendMessage({ type: 'notas_listar', telefone: tel }); } catch (e) { resp = null; }
    if (!resp || !resp.ok) {
      setCorpoSecao(_secHead('Notas', (nome || tel || 'Este lead')) + _telaFalha(
        'Não consegui carregar as notas',
        'Pode ser a conexão ou o JOB fora do ar por um instante. As notas continuam salvas.',
        'job-notas-retry', 'Tentar de novo'));
      const rt = document.getElementById('job-notas-retry');
      if (rt) rt.addEventListener('click', () => _carregarNotasSecao(tel, nome));
      return;
    }
    _trilhoPonto('notas', !!(resp.notas && resp.notas.length));
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
      _secHead('Notas', (nome || tel || 'Este lead') + ' — fica salvo no JOB; qualquer consultor que abrir esta conversa vê.') +
      '<div class="job-notas-secao">' +
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
    setCorpoSecao(_telaCarregando('Lendo a conversa…'));
    let tel = '';
    try { tel = (await pedirTelefoneWpp()) || telefoneDoContato(); } catch (e) { tel = telefoneDoContato(); }
    if (!tel) {
      setCorpoSecao(_secHead('CRM', 'Cadastre o lead pra ele entrar no funil e ser medido por canal.') +
        _vazio('Nenhuma conversa aberta',
          'O cadastro sai da conversa aberta — é dela que vêm o nome e o telefone. Abra e volte aqui.'));
      return;
    }
    // Nome do cabeçalho só serve se NÃO for o próprio número (contato não salvo).
    const nomeBruto = (nomeDoContato() || '').trim();
    const nomeSugerido = /^[+\d\s()\-]+$/.test(nomeBruto) ? '' : nomeBruto;
    setCorpoSecao(
      _secHead('CRM', 'Este número ainda não está no JOB. Cadastre pra ele entrar no funil e ser medido por canal.') +
      '<div class="job-novolead">' +
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
    const aviso = (txt) => { if (msg) msg.innerHTML = '<div class="job-ia-alerta">' + esc(txt) + '</div>'; };
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
      _secHead(resp.ja_existia ? 'Esse lead já existia' : 'Lead cadastrado', '') +
      '<div class="job-novolead">' +
        '<div class="job-sec-sub">' + (resp.ja_existia
          ? 'Já havia um lead com esse telefone no JOB — abrimos o existente em vez de duplicar.'
          : 'Entrou no funil em "Lead Novo", atribuído a você.') + '</div>' +
        '<a class="job-cnpj-link" href="' + esc(url) + '" target="_blank" rel="noopener" style="display:flex;margin-top:12px;">Abrir no CRM</a>' +
      '</div>');
  }

  async function rodarAnalise(forcarPdfGrandes) {
    // A análise nova torna o retrato velho na hora: sem isto, o consultor
    // analisaria e continuaria vendo "ainda sem análise" por até 30s.
    _estadoCache = { chave: '', dados: null, ts: 0 };
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
    // ESTE É O MAIOR DOS TRÊS: cada entrada guarda o resultado COMPLETO da
    // análise (leitura de IA em imagens e PDFs, docs_extraidos, transcrições)
    // e, até agora, o caminho de sucesso nunca removia — só o de erro.
    //
    // 'rodando' NUNCA sai. Despejar uma análise em andamento
    // faria o painel "perder" a análise e mostrar "Analisar este lead" com ela
    // ainda rodando por trás — que é exatamente o bug documentado na
    // sincronizarPainelComConversa ("trava depois de clicar Analisar").
    // Canceladas antigas podem sair quando o teto estourar; a atual continua
    // presente porque e a entrada mais nova do Map.
    _capMap(_analises, _TETO_ANALISES,
            (a) => a && a.status === 'rodando');
    atualizarPilula();
    try {
      const painelRolavel = acharPainelRolavel();
      if (!painelRolavel) {
        _analises.delete(reqId);
        atualizarPilula();
        abrirSecao('analise');
        setCorpoSecao(_vazio('Nenhuma conversa aberta',
          'Esta tela trabalha sobre a conversa que está na tela. Abra uma e volte aqui.'));
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
      // ÁUDIO JÁ TRANSCRITO NÃO É BAIXADO NEM ENVIADO.
      //
      // Aqui era `pedirAudios(60)`: sessenta áudios baixados em base64 DE UMA
      // VEZ, todos vivos na memória da aba ao mesmo tempo, depois copiados
      // inteiros pro service worker, depois serializados num único POST. Três
      // cópias do mesmo material antes de sair da máquina — e base64 ocupa 33%
      // a mais que o arquivo. Numa conversa de 107 áudios isso explica sozinho
      // o pico de gigabytes que apareceu no painel do Railway.
      //
      // E o pior: era desperdício puro. O servidor guarda cada transcrição por
      // msg_id (`whatsapp_transcricoes_cache`), e a varredura JÁ usava isso —
      // manda só o id e o servidor pega do cache. A análise pedida à mão nunca
      // aprendeu o truque e rebaixava tudo do zero, toda vez.
      //
      // Agora: lista os ids (barato, sem mídia), pergunta quais já têm texto,
      // baixa e TRANSCREVE so o que falta em lotes de 3, e solta o base64 antes
      // do lote seguinte. A analise final manda apenas ids; o servidor le o
      // texto do cache que acabou de ser preenchido.
      try {
        const lista = await _pedirPonte('listar_audios', {}, 15000);
        const todos = ((lista && lista.audios) || []).slice(0, 60);
        audiosEncontrados = (lista && lista.encontrados) || todos.length;
        let cacheados = {};
        if (todos.length) {
          const rc = await _safeSendMessage({ type: 'transcricoes_cache',
            ids: todos.map((a) => a.msg_id) }).catch(() => null);
          if (rc && rc.ok) cacheados = rc.transcricoes || {};
        }
        const faltam = todos.filter((a) => !(a.msg_id in cacheados)).map((a) => a.msg_id);
        for (let i = 0; i < faltam.length; i += 3) {
          if (_cancelados.has(reqId)) break;
          const ids = faltam.slice(i, i + 3);
          let rb = null;
          let lote = [];
          let pendentes = [];
          const semTexto = new Set(ids);
          try {
            status('Baixando áudio ' + Math.min(i + 3, faltam.length) + ' de ' + faltam.length + '…');
            rb = await _pedirPonte('baixar_audios_ids', { ids }, 90000);
            lote = (rb && Array.isArray(rb.audios)) ? rb.audios : [];
            if (!lote.length) continue;
            if (_cancelados.has(reqId)) continue;
            status('Transcrevendo áudio ' + Math.min(i + 3, faltam.length) + ' de ' + faltam.length + '…');
            const marcarResolvidos = (resp) => {
              const textos = (resp && resp.ok && resp.transcricoes) || {};
              for (const a of lote) {
                const mid = a && a.msg_id;
                if (mid && String(textos[mid] || '').trim()) semTexto.delete(mid);
              }
            };
            let tr = await _safeSendMessage({ type: 'transcrever_audios', audios: lote }).catch(() => null);
            marcarResolvidos(tr);
            pendentes = lote.filter((a) => a && semTexto.has(a.msg_id));
            if (pendentes.length) {
              await new Promise((res) => setTimeout(res, 800));
              tr = await _safeSendMessage({ type: 'transcrever_audios', audios: pendentes }).catch(() => null);
              marcarResolvidos(tr);
            }
          } catch (e) { /* a analise final presta contas pelo total encontrado */ }
          finally {
            // `pendentes` e `lote` apontam pros mesmos objetos grandes de `rb`.
            // Esvazia os tres antes de ceder a thread, para nenhum base64 de um
            // lote sobreviver ate o download do proximo.
            pendentes.length = 0;
            lote.length = 0;
            try { if (rb && Array.isArray(rb.audios)) rb.audios.length = 0; } catch (e2) {}
            rb = null;
          }
          // Devolve a mão pro navegador entre lotes — sem isso a aba trava.
          await new Promise((res) => setTimeout(res, 400));
        }
        // Sempre so metadado leve. O backend aceita id sem base64 quando o
        // cache existe; se algum audio falhou, `audios_encontrados` abaixo faz
        // o resultado avisar quantos ficaram de fora em vez de fingir sucesso.
        audios = todos.map((a) => ({ msg_id: a.msg_id, de: a.de, hora: a.hora }));
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
        setCorpoSecao(_vazio('Conversa sem conteúdo',
          'Não achei mensagem, imagem, áudio, documento nem link aqui. Se a conversa é longa, role um pouco pra cima pra o WhatsApp carregar o histórico e tente de novo.'));
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
        // Ele CLICOU em analisar: ja decidiu que e lead. O servidor cria no CRM.
        origem_analise: 'manual',
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
        entrada.terminadoEm = new Date().toISOString();
        // Lê o retrato ANTERIOR antes de gravar o novo por cima — é ele que
        // permite dizer "subiu 85 desde a leitura de terça".
        entrada._anterior = await _analiseAnteriorLer(entrada.telefone || telefone);
        await _analiseAnteriorGravar(entrada.telefone || telefone, resp, entrada.totalMsgs);
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
    // O portão é avaliado assim que a barra existe. Sem credencial nenhuma, o
    // WhatsApp fica embaçado até a pessoa entrar (ou desligar a extensão).
    _conferirPortao();
    const obs = _observar(new MutationObserver(() => {
      if (!document.getElementById('job-trilho')) criarTrilho();
    }));
    obs.observe(document.body, { childList: true, subtree: false });
    // Transcrição colada no áudio. Best-effort: se qualquer coisa aqui falhar, o
    // resto da extensão continua funcionando — transcrição é ganho, não requisito.
    try { trIniciar(); } catch (e) { console.warn('[JOB] transcrição não iniciou:', e); }
    try { varreduraIniciar(); } catch (e) { console.warn('[JOB] varredura não iniciou:', e); }
    try { filaVarreduraIniciar(); } catch (e) { console.warn('[JOB] fila não iniciou:', e); }
    verificarVersaoExtensao();
    // Reverifica sozinho a cada 20min, SEMPRE — antes só reagendava quando
    // achava atualização, então uma aba aberta por horas sem update na hora
    // do primeiro check nunca mais avisava depois (hora que "demora" pra
    // avisar era essa: aba antiga, sem re-checagem nenhuma agendada).
    _registrarLoop(setInterval(_soComAbaVisivel(verificarVersaoExtensao), 20 * 60 * 1000));
    carregarSeletoresRemotos();
    _registrarLoop(setInterval(_soComAbaVisivel(carregarSeletoresRemotos), 15 * 60 * 1000));
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
        // A INSTRUCAO ANTIGA ERA MENTIRA NESTE MODELO DE DISTRIBUICAO.
        //
        // Ela mandava fechar as abas do WhatsApp e dizia que o Chrome atualiza
        // sozinho em algumas horas. As duas coisas sao verdade pra extensao
        // instalada pela loja; a JOB e distribuida por LINK. O Chrome nunca
        // atualiza sozinho, e fechar aba nao muda nada — a pessoa fazia os dois
        // passos, via a versao velha de novo, e concluia que o aviso estava
        // quebrado.
        'Saiu a versão <b>' + nova + '</b> e você está na <b>' + minha + '</b>.' +
        // A SUA VERSAO CONTINUA FUNCIONANDO.
        //
        // Com melhoria saindo toda hora e sem loja pra empurrar, cada consultora
        // fica numa versao diferente por semanas. O aviso nao pode soar como
        // "voce esta obsoleto" — quando alguma coisa de fato parar de funcionar
        // numa versao, o aviso tera outras palavras.
        '<div class="job-aviso-versao-nota">' +
          'A sua versão <b>continua funcionando</b> — atualizar é ganho, não obrigação.' +
        '</div>' +
        '<a class="job-aviso-versao-bt" href="' + esc(_SITE_BASE_URL_EXT + '/extensao') + '" ' +
          'target="_blank" rel="noopener">Atualizar agora (leva um minuto)</a>' +
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
    // A conversa mudou: os pontos do contato anterior não valem mais, e o
    // resumo pode ser buscado de novo pro contato novo.
    _trilhoPontosLimpar();
    _resumoBuscado = '';
    // A FICHA DO CONTATO ANTERIOR MORRE AQUI, e não quando a próxima chegar.
    // Entre a troca de conversa e a resposta do servidor passam ~1s; nesse
    // intervalo a tela mostrava os dados de quem ficou pra trás, com cara de
    // certo. Melhor a tela vazia por um segundo do que o cliente errado.
    _ficha = null; _fichaTel = ''; _fichaIgnorada = false;
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
  _registrarLoop(setInterval(_soComAbaVisivel(_enviarMetricas), 120000));

  let _filaTimer = null;
  function _agendarFila(segundos) {
    if (_filaTimer) clearTimeout(_filaTimer);
    const ms = Math.max(600, Math.min((segundos || 0) * 1000 + 400, 60000));
    _filaTimer = setTimeout(() => { _filaTimer = null; checarFilaDeEnvio(); }, ms);
  }

  async function checarFilaDeEnvio() {
    if (_contextoMorto) return;
    // A fila precisa continuar existindo em segundo plano, mas nao precisa
    // acordar o WhatsApp a cada 20 segundos sem ninguem olhando. Uma rodada por
    // minuto preserva os envios agendados e deixa a aba descansar.
    if (document.hidden) { _agendarFila(60); return; }
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
      // Outra rotina (varredura automática ou em fila) está usando o
      // WhatsApp agora. A mensagem continua na fila do servidor — só adia.
      if (!_jobGateTentar('envio')) { _agendarFila(5); return; }
      try {
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
      } finally { _jobGateSoltar(); }
    } catch (e) { /* próxima rodada tenta de novo */ }
    finally {
      _filaOcupada = false;
      if (!_filaTimer) _agendarFila(document.hidden ? 60 : 20);
    }
  }
  // Um unico relogio recursivo. O setInterval antigo continuava acordando a
  // pagina a cada 20 segundos mesmo quando a funcao decidia nao fazer nada.
  _agendarFila(20);
  _aoLimpar(() => { if (_filaTimer) clearTimeout(_filaTimer); });

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
  _escutarChrome(chrome.runtime.onMessage, (msg, _rem, responder) => {
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
  _escutarChrome(chrome.runtime.onMessage, (msg, _rem, responder) => {
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

  _ouvir(window, 'message', async (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== 'JOB_EXT_EVT' || !d.chatId) return;

    if (d.tipo === 'inbound_texto' && d.texto) {
      analisarCacaDocumentos(d.chatId, d.texto);
      return;
    }

    if (d.tipo !== 'inbound') return;
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

  let DICIONARIO_CACA_DOCS = [];

  async function carregarDicionarioCacaDocs() {
    try {
      const r = await fetch(_SITE_BASE_URL_EXT + '/api/ia/caca-docs/regras', { cache: 'no-store' });
      const j = await r.json();
      if (j && j.ok && j.regras) DICIONARIO_CACA_DOCS = j.regras;
    } catch(e) {
      console.warn('Erro ao carregar regras do caça-documentos', e);
    }
  }
  
  _registrarTimeout(carregarDicionarioCacaDocs, 5000);

  function analisarCacaDocumentos(chatId, texto) {
    if (!texto) return;
    const txt = texto.toLowerCase();
    
    // Procura a primeira regra que bate
    for (const regra of DICIONARIO_CACA_DOCS) {
      const match = regra.palavras.find(p => txt.includes(p));
      if (match) {
        mostrarOverlayCacaDocs(regra);
        break; // Só mostra um por vez pra não poluir
      }
    }
  }

  let _overlayCacaDocsTimer = null;
  function mostrarOverlayCacaDocs(regra) {
    let overlay = document.getElementById('job-caca-docs');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'job-caca-docs';
      overlay.style.cssText = `
        position: fixed;
        bottom: 80px;
        right: 20px;
        background: #fff;
        border: 1px solid #e2e8f0;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        border-radius: 8px;
        padding: 12px 16px;
        z-index: 999999;
        display: flex;
        align-items: center;
        gap: 12px;
        font-family: system-ui, sans-serif;
        color: #1e293b;
        animation: jobFadeInUp 0.3s ease;
      `;
      // Adiciona keyframe se não existir
      if (!document.getElementById('job-caca-docs-style')) {
        const st = document.createElement('style');
        st.id = 'job-caca-docs-style';
        st.innerHTML = `
          @keyframes jobFadeInUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
          .job-caca-btn { background: #6d28d9; color: #fff; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 600; }
          .job-caca-btn:hover { background: #5b21b6; }
          .job-caca-x { background: transparent; border: none; font-size: 16px; color: #94a3b8; cursor: pointer; padding: 0 4px; }
          .job-caca-x:hover { color: #ef4444; }
        `;
        document.head.appendChild(st);
      }
      document.body.appendChild(overlay);
    }

    overlay.innerHTML = `
      <div style="font-size: 11px; font-weight: bold; background: #f1f5f9; color: #64748b; padding: 4px 8px; border-radius: 4px; border: 1px solid #e2e8f0; text-transform: uppercase;">${regra.icone}</div>
      <div style="flex:1;">
        <div style="font-size:11px; text-transform:uppercase; font-weight:700; color:#6d28d9; margin-bottom:2px;">Sugestão Rápida</div>
        <div style="font-size:13px; font-weight:500;">Enviar <b>${regra.nome}</b>?</div>
      </div>
      <button class="job-caca-btn" onclick="alert('Funcionalidade de enviar será acoplada ao repositório de PDFs! (simulação)'); this.parentElement.remove();">Enviar</button>
      <button class="job-caca-x" onclick="this.parentElement.remove()" title="Isso não ajuda">×</button>
    `;

    // Some depois de 15 segundos se não clicar
    if (_overlayCacaDocsTimer) clearTimeout(_overlayCacaDocsTimer);
    _overlayCacaDocsTimer = setTimeout(() => {
      if (overlay && overlay.parentElement) overlay.remove();
    }, 15000);
  }

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
  _registrarTimeout(_soComAbaVisivel(checarCampanhaAguardando), 8000);
  _registrarLoop(setInterval(_soComAbaVisivel(checarCampanhaAguardando), 60000));

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
  function _agendarPresenca(ms) {
    _registrarTimeout(async () => {
      try { await baterPontoDisparo(); }
      finally { _agendarPresenca(document.hidden ? 180000 : 60000); }
    }, ms);
  }
  // Visivel: 1 min. Oculta: 3 min, suficiente para o painel saber que a sessao
  // existe sem acordar a ponte do WhatsApp a cada minuto.
  _agendarPresenca(6000);

  // Inbox de leads novos: busca a cada 45s enquanto o WhatsApp esta visivel.
  // Ao voltar para a aba, o listener de visibilidade atualiza o badge na hora.
  _registrarTimeout(_soComAbaVisivel(buscarInbox), 9000);
  _registrarLoop(setInterval(_soComAbaVisivel(buscarInbox), 45000));
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
    if (document.hidden) return;
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
  _registrarTimeout(_soComAbaVisivel(varreduraDeFundo), 4 * 60 * 1000);
  _registrarLoop(setInterval(() => {
    // Intervalo irregular: um relogio certinho de 22 em 22 minutos, todo dia,
    // e um padrao. Somar um tanto aleatorio nao custa nada e tira o padrao.
    if (!document.hidden && Math.random() < 0.75) varreduraDeFundo();
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
    if (!await _confirmar({
      titulo: 'Apagar ' + _campExcluir.length + ' conversa(s)?',
      texto: 'São as conversas sem resposta. Elas saem do seu WhatsApp e isso não tem desfazer.',
      ok: 'Apagar', perigo: true })) return;
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
    _escutarChrome(chrome.storage.onChanged, (mud, area) => {
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
