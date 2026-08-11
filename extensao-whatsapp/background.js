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

// CRONÔMETRO DAS CHAMADAS — pra "está lento" virar número.
//
// Guarda as últimas 60 idas ao JOB por rota, com quanto cada uma demorou. É o
// que permite responder "lento onde?": se o envio demora 4s e a rota respondeu
// em 300ms, o gargalo está na página (biblioteca duplicada, aba pesada), não
// no servidor. Sem isso a conversa vira palpite dos dois lados.
//
// Só na memória do service worker: some quando ele dorme, e é pra ser assim —
// isto é diagnóstico do momento, não histórico.
const _TEMPOS = [];
function _anotarTempo(caminho, ms, ok) {
  _TEMPOS.push({ caminho, ms: Math.round(ms), ok: !!ok, quando: Date.now() });
  if (_TEMPOS.length > 60) _TEMPOS.shift();
}
function _resumoTempos() {
  const porRota = {};
  _TEMPOS.forEach((t) => {
    (porRota[t.caminho] = porRota[t.caminho] || []).push(t.ms);
  });
  // Mediana e o pior caso. Média esconde justamente a chamada que travou —
  // dez de 200ms e uma de 9s dão média de 1s, que não descreve nem uma nem outra.
  return Object.keys(porRota).map((c) => {
    const v = porRota[c].slice().sort((a, b) => a - b);
    return { rota: c, n: v.length, mediana: v[Math.floor(v.length / 2)], pior: v[v.length - 1] };
  }).sort((a, b) => b.pior - a.pior);
}

// ═══════════════════════ FILA DE COTACAO ═══════════════════════════════
//
// Uma maquina cota para todas. Quem nao tem o Painel aberto manda o pedido
// pro JOB; a maquina marcada como trabalhadora pega, cota na sessao dela e
// devolve. O consultor nunca ve o Painel — some a pergunta "como e que cota
// aqui", que era metade do problema.
//
// O DESVIO E O ULTIMO RECURSO, nao o primeiro. Quem tem Painel local continua
// cotando por ele: sem rede no meio, sem fila, e sem passar a depender de uma
// segunda maquina estar ligada. So cai na fila quem hoje receberia
// "Painel fechado" e ficaria sem cotar.

const _FILA_ESPERA_MS = 300;      // de quanto em quanto o pedinte pergunta
const _FILA_LIMITE_MS = 120000;   // 2 min: uma cotacao inteira cabe folgada

// Manda um passo pra fila e espera a resposta. `cb(null)` quando nao ha
// trabalhador — ai quem chamou devolve o "Painel fechado" de sempre, que
// continua sendo a verdade naquele caso.
function _filaPedir(pedido, cb) {
  chamarJob('/api/whatsapp/cotacao/fila', 'POST', { pedido: pedido }, 15000)
    .then((r) => {
      if (!r || !r.ok || !r.id) { cb(null); return; }
      const id = r.id;
      const t0 = Date.now();
      const perguntar = () => {
        if (Date.now() - t0 > _FILA_LIMITE_MS) {
          cb({ ok: false, motivo: 'fila_demorou' });
          return;
        }
        chamarJob('/api/whatsapp/cotacao/fila/' + id, 'GET', null, 12000).then((s) => {
          if (!s || !s.ok) { setTimeout(perguntar, _FILA_ESPERA_MS); return; }
          if (s.estado === 'pronto') { cb(s.resultado || { ok: false, motivo: 'sem_resposta' }); return; }
          if (s.estado === 'erro') { cb({ ok: false, motivo: s.erro || 'fila_erro' }); return; }
          if (s.estado === 'cancelado') { cb({ ok: false, motivo: 'cancelado' }); return; }
          // Ainda esperando ou rodando: avisa a tela onde esta na fila e
          // pergunta de novo. Espera muda parece sistema travado.
          _filaAvisarTela(id, s);
          setTimeout(perguntar, _FILA_ESPERA_MS);
        }).catch(() => setTimeout(perguntar, _FILA_ESPERA_MS));
      };
      perguntar();
    })
    .catch(() => cb(null));
}

// O andamento vai pra aba que pediu, pelo mesmo caminho do andamento local.
function _filaAvisarTela(id, s) {
  if (_abaQuePediuCotacao == null) return;
  try {
    chrome.tabs.sendMessage(_abaQuePediuCotacao, {
      type: 'fila_andamento', id: id, estado: s.estado,
      posicao: s.posicao || 0, etapa: s.etapa || '', fracao: s.fracao || 0,
    }, () => { void chrome.runtime.lastError; });
  } catch (e) { /* aba fechou: o andamento some, a cotacao continua */ }
}

// ── O LADO TRABALHADOR ─────────────────────────────────────────────────
//
// Esta maquina pergunta ao JOB se ha trabalho. Se ela nao for a marcada, o
// servidor responde `nao_e_trabalhador` — e ai ela pergunta muito de vez em
// quando, pra nao gastar rede das outras sete a toa. Nao existe rota separada
// pra "sou eu?": a propria resposta do /proximo ja diz.
let _trabRitmo = 2000;            // enquanto e trabalhadora
const _TRAB_RITMO_LENTO = 300000; // 5 min, quando nao e
let _trabOcupado = false;

function _trabalhadorTick() {
  if (_trabOcupado) return;
  chamarJob('/api/whatsapp/cotacao/fila/proximo', 'GET', null, 12000).then((r) => {
    if (!r) return;
    if (r.motivo === 'nao_e_trabalhador') { _trabRitmo = _TRAB_RITMO_LENTO; return; }
    _trabRitmo = 2000;
    if (!r.ok || !r.id) return;
    _trabOcupado = true;
    _trabalhadorExecutar(r.id, r.pedido);
  }).catch(() => {});
}

// Roda o pedido na aba do Painel DESTA maquina e devolve o resultado.
//
// Se nao houver Painel aqui, devolve ERRO em vez de ficar quieto: a maquina
// marcada como trabalhadora sem Painel aberto e um defeito de configuracao, e
// quem esta esperando precisa saber disso em vez de esperar pra sempre.
function _trabalhadorExecutar(id, pedido) {
  const terminar = (corpo) => {
    chamarJob('/api/whatsapp/cotacao/fila/' + id + '/pronto', 'POST', corpo, 20000)
      .catch(() => {})
      .then(() => { _trabOcupado = false; });
  };
  chrome.tabs.query({}, (todas) => {
    const lista = (todas || []).filter(
      (a) => a.url && a.url.indexOf('paineldocorretor.com.br') >= 0);
    const aba = lista.filter((a) => a.active)[0] || lista[0];
    if (!aba) { terminar({ erro: 'painel_fechado_no_trabalhador' }); return; }
    let respondeu = false;
    const relogio = setTimeout(() => {
      if (!respondeu) { respondeu = true; terminar({ erro: 'sem_resposta_a_tempo' }); }
    }, 90000);
    try {
      chrome.tabs.sendMessage(aba.id, pedido, (r) => {
        if (respondeu) return;
        respondeu = true; clearTimeout(relogio);
        if (chrome.runtime.lastError) { terminar({ erro: 'painel_precisa_recarregar' }); return; }
        terminar({ resultado: r || { ok: false, motivo: 'sem_resposta' } });
      });
    } catch (e) {
      if (!respondeu) { respondeu = true; clearTimeout(relogio); terminar({ erro: String(e && e.message || e) }); }
    }
  });
}

// SINAL DE VIDA. Escreve numa coluna propria no servidor — nao no carimbo
// generico da sessao, que qualquer requisicao ja atualiza. Um Dell com o
// Painel morto e o navegador ativo pareceria vivo, e e justamente o caso que
// este sinal existe pra pegar.
function _trabalhadorVivo() {
  chrome.tabs.query({}, (todas) => {
    const temPainel = (todas || []).some(
      (a) => a.url && a.url.indexOf('paineldocorretor.com.br') >= 0);
    chamarJob('/api/whatsapp/trabalhador/vivo', 'POST',
              { painel_logado: temPainel }, 10000).catch(() => {});
  });
}

// Dois relogios, de proposito. O de trabalho muda de ritmo sozinho conforme a
// maquina seja ou nao a marcada; o de vida bate sempre, porque uma maquina
// que parou de bater e exatamente o que o outro lado precisa descobrir.
(function _filaIniciar() {
  const passo = () => { try { _trabalhadorTick(); } catch (e) {} setTimeout(passo, _trabRitmo); };
  setTimeout(passo, 8000);
  setInterval(() => { try { _trabalhadorVivo(); } catch (e) {} }, 60000);
})();


async function chamarJob(caminho, metodo, corpo, timeoutMs, reqId, opts) {
  const _t0 = Date.now();
  const _anota = (ok) => { try { _anotarTempo(caminho.split('?')[0], Date.now() - _t0, ok); } catch (e) {} };
  const { jobUrl, extKey } = await config();
  const { extToken } = await chrome.storage.local.get(['extToken']);
  // DUAS FORMAS DE ENTRAR, ENQUANTO A TROCA ACONTECE.
  //
  // O token é do consultor que fez login — ele diz QUEM é. A chave é a antiga,
  // igual nas oito máquinas, e só diz "sou a extensão". Enquanto nem todos
  // tiverem entrado, as duas valem; quem tem token manda as duas e o servidor
  // usa a melhor. Exigir só o token hoje travaria oito pessoas no meio do
  // expediente.
  if (!extKey && !extToken) {
    return { ok: false, erro: 'Entre com seu e-mail e senha no popup da extensão (clique no ícone do JOB).' };
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
        // TOKEN MANDA A CHAVE EMBORA.
        //
        // Se as duas viajassem juntas, o servidor registraria "chave antiga
        // usada" em toda chamada de todo mundo — e era esse log que ia dizer
        // quando dá pra desligar a chave. Mandando só uma, o log passa a
        // significar exatamente uma coisa: ALGUÉM AINDA NÃO ENTROU.
        headers: Object.assign(
          { 'Content-Type': 'application/json' },
          extToken ? { 'Authorization': 'Bearer ' + extToken }
                   : (extKey ? { 'X-Extension-Key': extKey } : {})
        ),
        body: corpo ? JSON.stringify(corpo) : undefined,
        signal: controller.signal
      });
      let dados = null;
      try { dados = await resp.json(); } catch (e) { dados = null; }
      if (!resp.ok) {
        // Erro HTTP É uma resposta do servidor (chave errada, 404, 500) —
        // repetir não muda nada, então devolve na hora.
        _anota(false);
        return { ok: false, erro: (dados && dados.erro) || ('HTTP ' + resp.status), status: resp.status };
      }
      _anota(true);
      return dados || { ok: true };
    } catch (e) {
      // Timeout/cancelamento não é soluço de rede: não repete.
      if (e.name === 'AbortError') {
        clearTimeout(timer);
        if (reqId) _emAndamento.delete(reqId);
        _anota(false);
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
  _anota(false);
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

// Qual aba pediu a cotação em curso — pra saber pra onde devolver o andamento.
// Uma só: cotar é ação de um consultor por vez, não fila.
let _abaQuePediuCotacao = null;

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
  // LOGIN E SAÍDA.
  //
  // A senha atravessa uma vez e não é guardada em lugar nenhum — o que fica na
  // máquina é o token. Guardar a senha seria pior que a chave compartilhada de
  // hoje: seriam oito senhas de verdade em chrome.storage.
  if (msg && msg.type === 'login') {
    (async () => {
      const { jobUrl } = await config();
      try {
        const resp = await fetch(jobUrl + '/api/whatsapp/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(msg.payload || {}),
        });
        let d = null;
        try { d = await resp.json(); } catch (e) { d = null; }
        if (resp.status === 404) {
          sendResponse({ ok: false, erro: 'O JOB ainda não tem a tela de login da extensão. ' +
                                          'Continue com a chave por enquanto.' });
          return;
        }
        if (!resp.ok || !d || !d.ok) {
          sendResponse({ ok: false, erro: (d && d.erro) || ('HTTP ' + resp.status) });
          return;
        }
        // O SERVIDOR MANDA PLANO, EU GUARDO ANINHADO.
        //
        // Meu contrato pediu {"usuario": {id, nome}}; ele entregou
        // {"usuario_id", "nome"} — mesma informação, formato diferente. A
        // extensão é minha, então quem se adapta sou eu: mandar refazer o
        // `app.py` por preferência de formato é custo sem ganho. Aceito os
        // dois, pra não quebrar se um dia mudar.
        const usu = d.usuario
          || (d.usuario_id ? { id: d.usuario_id, nome: d.nome || '' } : null);
        await chrome.storage.local.set({
          extToken: d.token,
          extUsuario: usu,
          extApelido: (msg.payload && msg.payload.apelido) || '',
          // O consultor passa a vir de quem entrou, não de um campo escolhido
          // à mão. Manter os dois em pé discordando seria pior que qualquer um
          // dos dois sozinho.
          usuarioId: (usu && usu.id) || '',
        });
        sendResponse({ ok: true, usuario: usu });
      } catch (e) {
        sendResponse({ ok: false, erro: 'Não consegui falar com o JOB agora.' });
      }
    })();
    return true;
  }
  // O SERVIDOR JÁ SABE FAZER LOGIN?
  //
  // É o que decide se o portão pode exigir login. Hoje a rota nem existe em
  // produção (404): exigir login agora travaria os oito consultores no meio do
  // expediente. Quando ela subir, o portão passa a exigir sozinho, sem eu
  // precisar publicar versão nova da extensão.
  //
  // A resposta fica guardada por 10 minutos: é uma pergunta por aba, não por
  // clique, e um servidor que acabou de subir aparece em minutos.
  if (msg && msg.type === 'servidor_tem_login') {
    (async () => {
      const agora = Date.now();
      const c = await chrome.storage.local.get(['loginServidorOk', 'loginServidorEm']);
      if (c.loginServidorEm && agora - c.loginServidorEm < 600000) {
        sendResponse({ ok: true, tem: !!c.loginServidorOk });
        return;
      }
      const { jobUrl } = await config();
      let tem = false;
      try {
        // Corpo vazio de propósito: se a rota existir ela responde 400 (falta
        // e-mail), e 400 é prova de que existe. Só o 404 diz que não existe.
        const r = await fetch(jobUrl + '/api/whatsapp/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
        });
        tem = r.status !== 404;
      } catch (e) {
        // Sem rede não dá pra afirmar que o servidor NÃO tem login. Na dúvida,
        // não trava ninguém: mantém a última resposta conhecida.
        tem = !!c.loginServidorOk;
        sendResponse({ ok: true, tem: tem });
        return;
      }
      await chrome.storage.local.set({ loginServidorOk: tem, loginServidorEm: agora });
      sendResponse({ ok: true, tem: tem });
    })();
    return true;
  }
  if (msg && msg.type === 'logout') {
    (async () => {
      // Avisa o servidor pra revogar, mas NÃO depende disso pra limpar aqui:
      // se o JOB estiver fora do ar, sair da máquina tem que funcionar mesmo
      // assim — senão a pessoa fica presa numa sessão que ela quer encerrar.
      try { await chamarJob('/api/whatsapp/logout', 'POST', {}, 8000); } catch (e) {}
      await chrome.storage.local.remove(['extToken', 'extUsuario', 'extApelido']);
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (msg && msg.type === 'enviar_direto') {
    // Compor e mandar direto do painel da extensão, sem precisar abrir o
    // site do JOB — enfileira e casa/cria o lead pelo telefone da conversa.
    chamarJob('/api/whatsapp/enviar-direto', 'POST', msg.payload, 15000).then(sendResponse);
    return true;
  }
  // AS LEGENDAS DA COTACAO.
  //
  // A rota do site (/cotacao/legendas/api) passou a aceitar o token da
  // extensao — foi pra isso que o login existiu. Antes ela so respondia a
  // quem tinha sessao do site, e por isso o botao nao podia existir aqui.
  // A IMAGEM DA COTACAO, como data: URL.
  //
  // A imagem e desenhada NO NAVEGADOR quando alguem abre o documento — o
  // servidor nao tem navegador. Entao ela so existe depois da primeira
  // abertura, e o 404 com url_documento e resposta legitima, nao erro: a
  // barra sabe abrir o documento e tentar de novo.
  if (msg && msg.type === 'cotacao_imagem') {
    buscarImagem(msg.id).then(sendResponse);
    return true;
  }
  // NENHUMA JANELA, NENHUMA ABA. NUNCA MAIS.
  //
  // Isto abria o documento no navegador so pra provocar o desenho da imagem —
  // primeiro numa aba fixada (aparecia na barra dele), depois numa janela
  // minimizada que o Chrome resolveu abrir POR CIMA DE TUDO. Duas tentativas,
  // duas vezes tirando o consultor do WhatsApp no meio do atendimento.
  //
  // Agora a extensao desenha a cotacao sozinha, dentro do painel, e transforma
  // esse desenho em PNG ali mesmo (html2canvas embarcado). Nao depende do
  // servidor, nao abre nada e e instantaneo. Esta mensagem some do content.js;
  // fica aqui so respondendo pra quem tiver a versao velha carregada.
  if (msg && msg.type === 'cotacao_imagem_gerar') {
    sendResponse({ ok: false, erro: 'gerado_no_painel' });
    return true;
  }

  // AS TABELAS DO PROPRIO JOB COMO SEGUNDA FONTE DE COTACAO.
  //
  // A cotacao da extensao so falava com o Painel do Corretor. MedSenior,
  // Beneficencia Vital, Santa Tereza e as grades de PDF da Hapvida nao estao
  // la — estao aqui, em cotacao_tabela, importadas de PDF. Por isso o
  // Guilherme nao conseguia cotar 59 anos na Beneficencia nem misturar
  // operadoras: nao era limitacao de tela, era fonte desligada.
  //
  // As rotas ja existiam (contrato-tabelas-do-job-na-extensao.md). Enquanto o
  // decorador delas nao aceitar o token do consultor, isto responde 401 e a
  // tela diz o motivo em vez de sumir.
  if (msg && msg.type === 'cotacao_tabelas') {
    const q = new URLSearchParams();
    if (msg.somenteOperadoras) q.set('operadoras', '1');
    if (msg.operadora) q.set('operadora', msg.operadora);
    if (msg.modalidade) q.set('modalidade', msg.modalidade);
    chamarJob('/api/v1/cotacao/planos?' + q.toString(), 'GET', null, 20000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'cotacao_tabelas_calcular') {
    // POST que nao cria nada — so calcula. Por isso pode repetir.
    chamarJob('/api/v1/cotacao/calcular', 'POST',
              { idades: msg.idades, planos: msg.planos }, 25000, null,
              { repetivel: true }).then(sendResponse);
    return true;
  }
  // Cabecalho do documento: corretor, marca (com o logo ja em data URL) e os
  // dados de empresa do lead. Uma chamada, porque sao tres perguntas que so
  // aparecem juntas.
  if (msg && msg.type === 'cotacao_contexto') {
    const q = new URLSearchParams();
    if (msg.usuarioId) q.set('usuario_id', msg.usuarioId);
    if (msg.leadId) q.set('lead_id', msg.leadId);
    chamarJob('/api/whatsapp/extensao/cotacao/contexto?' + q.toString(),
              'GET', null, 15000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'cotacao_legendas') {
    chamarJob('/cotacao/legendas/api', 'GET', null, 12000).then(sendResponse);
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
  // Cotações já feitas pra este cliente. A extensão pergunta isso toda vez que
  // uma conversa abre, então lista vazia é resposta normal (cliente que nunca
  // foi cotado) e não pode virar erro na tela.
  if (msg && msg.type === 'cotacoes_do_lead') {
    const qs = msg.lead_id
      ? 'lead_id=' + encodeURIComponent(msg.lead_id)
      : 'telefone=' + encodeURIComponent(String(msg.telefone || '').replace(/\D/g, ''));
    chamarJob('/api/whatsapp/cotacoes?' + qs, 'GET', null, 15000).then(sendResponse);
    return true;
  }
  // Cidade padrão do consultor, a MESMA do site. Ela morava só na máquina:
  // trocou de computador, perdeu — e a do site e a da extensão podiam divergir
  // sem ninguém entender por quê.
  if (msg && msg.type === 'pref_ler') {
    chamarJob('/api/whatsapp/preferencias?usuario_id=' + encodeURIComponent(msg.usuario_id || ''),
              'GET', null, 6000).then((r) => sendResponse(r || { ok: false }))
                                .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg && msg.type === 'pref_gravar') {
    chamarJob('/api/whatsapp/preferencias', 'POST',
              { usuario_id: msg.usuario_id, cidade: msg.cidade || '' },
              8000, null, { repetivel: true }).then(() => {}).catch(() => {});
    return;   // mão única: ninguém espera resposta pra continuar cotando
  }
  // LOGO DA OPERADORA, buscada AQUI e não na página.
  //
  // A página do WhatsApp barra imagem de outro endereço, e o service worker
  // não tem essa restrição. Ele busca, converte pra data: e devolve — a página
  // nunca faz o pedido, então não há o que barrar.
  //
  // Uma vez por operadora: o content script guarda o resultado e não volta a
  // pedir. É assim que a memória de logos se enche sozinha, sem varredura.
  if (msg && msg.type === 'logo_operadora') {
    (async () => {
      try {
        const u = String(msg.url || '');
        if (!/^https:\/\//.test(u)) { sendResponse({ ok: false }); return; }
        const ctrl = new AbortController();
        const relogio = setTimeout(() => ctrl.abort(), 8000);
        const r = await fetch(u, { signal: ctrl.signal });
        clearTimeout(relogio);
        if (!r.ok) { sendResponse({ ok: false }); return; }
        const b = await r.blob();
        // Teto de 120 KB: logo é ícone. Acima disso é banner ou página de erro
        // disfarçada, e encher o armazenamento com isso quebraria o resto.
        if (!/^image\//.test(b.type) || b.size > 120 * 1024) { sendResponse({ ok: false }); return; }
        // APARA A MARGEM MORTA antes de guardar.
        //
        // Logo de operadora quase sempre vem com folga transparente ou branca em
        // volta — às vezes metade da imagem. Encaixada num espaço pequeno, essa
        // folga come o que deveria ser lido e a marca fica minúscula. Aparando,
        // a mesma caixa passa a mostrar só a marca.
        //
        // Feito AQUI porque o service worker tem OffscreenCanvas e a página do
        // WhatsApp não deixaria desenhar imagem de outro endereço.
        let dataUrl = null;
        try { dataUrl = await _aparar(b); } catch (e) { dataUrl = null; }
        if (!dataUrl) {
          dataUrl = await new Promise((ok, err) => {
            const fr = new FileReader();
            fr.onload = () => ok(fr.result);
            fr.onerror = err;
            fr.readAsDataURL(b);
          });
        }
        sendResponse({ ok: true, dataUrl });
      } catch (e) { sendResponse({ ok: false }); }
    })();
    return true;
  }
  // Salvar no JOB a cotação feita dentro da conversa. Timeout maior que os
  // outros porque grava em dois lugares (histórico vivo + apresentação).
  if (msg && msg.type === 'cotacao_salvar') {
    chamarJob('/api/whatsapp/cotacao/salvar', 'POST', msg.payload || {}, 25000).then(sendResponse);
    return true;
  }
  // Ficha completa do lead: UMA chamada traz lead, etapas, sub-status, campos,
  // etiquetas e atividades. Timeout maior que os 10s dos outros porque é o
  // agregado — mas ainda assim uma ida só, pro painel não montar aos pedaços.
  // Transcrição inline: consulta de cache é barata e frequente; a transcrição em
  // si sobe áudio, então tem timeout bem maior.
  if (msg && msg.type === 'conversas_pendentes') {
    chamarJob('/api/whatsapp/conversas/pendentes', 'POST', { conversas: msg.conversas || [] }, 20000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'varredura_proximo') {
    // A VERSAO VAI JUNTO: o servidor recusa a fila pra extensao anterior a
    // 3.16.0, que lia 1 mensagem por conversa e gravava analise sem dono.
    let _v = '';
    try { _v = (chrome.runtime.getManifest() || {}).version || ''; } catch (e) {}
    chamarJob('/api/whatsapp/varredura/proximo?consultor_id=' +
      encodeURIComponent(msg.consultor_id || '') + '&versao=' + encodeURIComponent(_v),
      'GET', null, 20000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'varredura_resultado') {
    chamarJob('/api/whatsapp/varredura/item', 'POST',
      { item_id: msg.item_id, ok: !!msg.ok, erro: msg.erro || '' }, 20000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'analisar_varredura') {
    // 300s, nao 180. Conversa longa com audio sem cache passa de tres minutos
    // com folga — e desistir no meio nao economizava nada: o servidor terminava
    // a analise e cobrava por ela do mesmo jeito, so que o resultado se perdia
    // e o lead virava 'erro'. Pagar e jogar fora e o pior dos dois mundos.
    chamarJob('/api/whatsapp/analisar', 'POST', msg.payload || {}, 300000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'metricas') {
    chamarJob('/api/whatsapp/metrica', 'POST', { metricas: msg.metricas || [] }, 12000).then(sendResponse);
    return true;
  }

  // A fila de hoje: mesma consulta do dashboard e da agenda.
  if (msg && msg.type === 'fila_hoje') {
    chrome.storage.local.get(['usuarioId']).then(({ usuarioId }) =>
      chamarJob('/api/whatsapp/fila?usuario_id=' + (usuarioId || 0), 'GET', null, 12000)
    ).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'fila_acao') {
    chrome.storage.local.get(['usuarioId']).then(({ usuarioId }) =>
      chamarJob('/api/whatsapp/fila/acao', 'POST',
        { tarefa_id: msg.tarefa_id, usuario_id: usuarioId || 0,
          acao: msg.acao, dias: msg.dias || 1 }, 12000)
    ).then(sendResponse);
    return true;
  }

  // Rodizio da varredura: a extensao pergunta o que venceu e devolve o que
  // varreu. O content script nao consegue falar com o JOB direto (CSP do
  // WhatsApp), entao passa por aqui como todo o resto.
  if (msg && msg.type === 'modalidade_nomeada') {
    chamarJob('/api/whatsapp/cotacao/modalidade', 'POST',
              { codigo: msg.codigo, nome: msg.nome }, 15000, null, { repetivel: true })
      .then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'catalogo_proximo') {
    chamarJob('/api/whatsapp/catalogo/proximo', 'GET', null, 15000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'catalogo_gravar') {
    chamarJob('/api/whatsapp/catalogo/gravar', 'POST', msg.dados || {}, 30000).then(sendResponse);
    return true;
  }
  // O canario: a extensao contando o que ainda funciona nela.
  // O SINO DENTRO DO WHATSAPP.
  //
  // Mesma fonte do sino do site — nao existe segunda lista de aviso, senao uma
  // fica velha. Se a rota recusar (ela ainda e login_required no app.py, e o
  // Antigravity vai abrir pra credencial da extensao), volta vazio e o sino
  // simplesmente nao aparece. Nada quebra enquanto isso.
  if (msg && msg.type === 'notificacoes') {
    chamarJob('/api/notificacoes', 'GET', null, 9000).then((r) => {
      if (!r || !r.ok) { sendResponse({ ok: false, nao_lidas: 0, itens: [] }); return; }
      sendResponse({ ok: true, nao_lidas: r.nao_lidas || 0, itens: r.itens || [] });
    }).catch(() => sendResponse({ ok: false, nao_lidas: 0, itens: [] }));
    return true;
  }
  if (msg && msg.type === 'notificacoes_lidas') {
    chamarJob('/api/notificacoes/marcar-lidas', 'POST', {}, 9000)
      .then(sendResponse).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg && msg.type === 'canario') {
    chamarJob('/api/whatsapp/canario', 'POST',
      { versao: msg.versao || '', checagens: msg.checagens || [] }, 12000).then(sendResponse);
    return true;
  }
  // COTAR NO PAINEL DO CORRETOR, DA ABA QUE O CORRETOR JA DEIXOU ABERTA.
  //
  // A cotacao nao pode sair daqui nem do servidor do JOB: quem fala com a
  // Trindade e a sessao do proprio corretor, na aba dele. Este trecho so acha
  // essa aba e repassa o pedido — se ela nao existir, diz isso em vez de
  // tentar abrir uma e logar alguem.
  //
  // Nao foca a aba de proposito. Roubar o foco no meio de um atendimento e
  // pior que esperar: o consultor esta no WhatsApp falando com o cliente.
  // ANDAMENTO DA COTACAO, DE VOLTA PRA QUEM PEDIU.
  //
  // A aba do Painel avisa a cada plano cotado, mas esse aviso morria aqui: nao
  // havia quem escutasse, e a tela do JOB ficava com um retangulo vazio por
  // quinze segundos. Quinze segundos sem sinal parecem um minuto, e o
  // consultor nao tem como saber se esta rodando ou se quebrou.
  if (msg && msg.type === 'cotacao_andamento') {
    if (_abaQuePediuCotacao != null) {
      chrome.tabs.sendMessage(_abaQuePediuCotacao, msg, () => { void chrome.runtime.lastError; });
    }
    return;   // nao responde: e aviso de mao unica
  }
  // A EXTENSAO REAPRENDEU — conta pra TODAS as abas do JOB.
  //
  // Diferente do andamento, que volta so pra quem pediu: aqui nao houve
  // pedido. O consultor estava com a tela do JOB parada em "Falta ensinar uma
  // vez", foi ate o Painel, refez o passo, e a extensao aprendeu sozinha. Sem
  // este aviso ele precisa adivinhar que ja pode voltar, e a unica forma de
  // descobrir era apertando F5. Era esse o F5 que o incomodava.
  //
  // Vai pra todas as abas do JOB porque ele costuma ter mais de uma aberta, e
  // nao da pra saber qual esta esperando.
  // O que um consultor ensina, os outros recebem. O `next-action` é por BUILD,
  // não por usuário — é a mesma string pra todo mundo. Sem isto, um deploy da
  // Trindade custa um aprendizado manual POR PESSOA pra descobrir o mesmo.
  //
  // Prazo curto e falha silenciosa de propósito: isto é conveniência. Se o JOB
  // estiver fora do ar, a extensão aprende sozinha como sempre aprendeu — não
  // pode virar dependência pra cotar.
  if (msg && msg.type === 'tempos') {
    sendResponse({ ok: true, rotas: _resumoTempos(), amostras: _TEMPOS.length });
    return;
  }
  if (msg && msg.type === 'cotador_nuvem_ler') {
    chamarJob('/api/whatsapp/cotador/hashes?origem=' + encodeURIComponent(msg.origem || ''),
              'GET', null, 6000).then((r) => sendResponse(r || { ok: false }))
                                .catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg && msg.type === 'cotador_nuvem_gravar') {
    chamarJob('/api/whatsapp/cotador/hashes', 'POST',
              { origem: msg.origem || '', papeis: msg.papeis || {}, mortos: msg.mortos || [] },
              8000, null, { repetivel: true })
      .then(() => {}).catch(() => {});
    return;   // aviso de mão única: ninguém espera resposta pra continuar cotando
  }
  if (msg && msg.type === 'cotador_aprendeu') {
    chrome.tabs.query({}, (todas) => {
      (todas || []).forEach((a) => {
        if (!a || !a.url) return;
        if (a.url.indexOf('job-serenus') < 0 && a.url.indexOf('localhost') < 0) return;
        chrome.tabs.sendMessage(a.id, { type: 'cotador_aprendeu', papeis: msg.papeis || [] },
                                () => { void chrome.runtime.lastError; });
      });
    });
    return;   // aviso de mao unica, como o andamento
  }
  if (msg && (msg.type === 'cotar_painel' || msg.type === 'cotador_pronto' ||
              msg.type === 'cotador_cidades' || msg.type === 'cotador_catalogo' ||
              msg.type === 'cotador_modalidades' || msg.type === 'cotador_passo')) {
    const oQuePedir =
      msg.type === 'cotar_painel'        ? { type: 'cotar_aqui', pedido: msg.pedido } :
      msg.type === 'cotador_cidades'     ? { type: 'cotador_cidades', termo: msg.termo } :
      msg.type === 'cotador_catalogo'    ? { type: 'cotador_catalogo', pedido: msg.pedido } :
      msg.type === 'cotador_modalidades' ? { type: 'cotador_modalidades', pedido: msg.pedido } :
      msg.type === 'cotador_passo'       ? { type: 'cotador_passo', pedido: msg.pedido } :
                                           { type: 'cotador_estado' };
    // Guarda quem pediu, pra devolver o andamento pra aba certa.
    // `cotador_passo` entrou na lista por causa da fila: o andamento dela
    // ("2 na frente") precisa achar a aba que pediu, e antes so o multicalculo
    // registrava isso.
    if ((msg.type === 'cotar_painel' || msg.type === 'cotador_catalogo' ||
         msg.type === 'cotador_passo') &&
        sender && sender.tab && sender.tab.id != null) {
      _abaQuePediuCotacao = sender.tab.id;
    }
    // Lista TODAS as abas e filtra aqui, em vez de pedir ao Chrome pra casar
    // endereço.
    //
    // O filtro por padrão de URL do chrome.tabs.query devolve lista vazia sem
    // dizer por quê quando a permissão daquele endereço não está valendo
    // naquele instante — e vazio é indistinguível de "não tem aba aberta".
    // Foi assim que a extensão disse "Painel fechado" com o Painel na frente
    // do Guilherme. Filtrando pelo endereço aqui dentro, a única coisa que
    // precisa valer é a permissão "tabs", que a extensão já tem desde sempre.
    chrome.tabs.query({}, (todas) => {
      const lista = (todas || []).filter(
        (a) => a.url && a.url.indexOf('paineldocorretor.com.br') >= 0);
      // Prefere a aba que o consultor está usando: se ele tem mais de uma
      // aberta, a ativa é a que ele acabou de olhar.
      // Quantas abas do Painel existem: a tela usa isso pra decidir se pode
      // dividir o trabalho em mais de uma frente.
      if (msg.type === 'cotador_abas') { sendResponse({ ok: true, abas: lista.length }); return; }
      // Aba escolhida por indice, quando a tela esta rodando varias frentes em
      // paralelo. Cada frente tem a SUA aba e a sua cotacao — sem isso duas
      // frentes escreveriam na mesma cotacao e os precos se embaralhariam.
      const aba = (msg.aba != null && lista.length)
        ? lista[msg.aba % lista.length]
        : (lista.filter((a) => a.active)[0] || lista[0]);
      if (!aba) {
        // SEM PAINEL AQUI? ENTAO PERGUNTA PRA MAQUINA QUE TEM.
        //
        // Era aqui que a cotacao morria com "Painel fechado" — e foi o que o
        // Danilo levou. A aba do Guilherme, na maquina do Guilherme, e
        // invisivel pro Chrome do Danilo, e sempre vai ser.
        //
        // Agora, quando nao ha Painel NESTE navegador, o pedido vai pra fila
        // do JOB e uma maquina marcada como trabalhadora responde por ele. A
        // ordem importa: local PRIMEIRO. Quem tem o Painel aberto continua
        // cotando pela propria sessao, sem rede no meio e sem fila — nada do
        // que funciona hoje passa a depender do Dell estar ligado.
        _filaPedir(oQuePedir, (r) => {
          if (r) { sendResponse(r); return; }
          // Diz quantas abas foram examinadas: sem isso, "Painel fechado" é
          // palpite, e quem está do outro lado não tem como saber se o problema
          // é a aba ou a extensão.
          sendResponse({ ok: false, motivo: 'painel_fechado',
                         abasExaminadas: (todas || []).length });
        });
        return;
      }
      chrome.tabs.sendMessage(aba.id, oQuePedir, (r) => {
        if (chrome.runtime.lastError) {
          // Aba aberta mas sem o script (extensao atualizada e sem F5 ainda).
          sendResponse({ ok: false, motivo: 'painel_precisa_recarregar' });
          return;
        }
        sendResponse(r || { ok: false, motivo: 'sem_resposta' });
      });
    });
    return true;
  }
  // ABRIR A CONVERSA NA ABA QUE JA EXISTE.
  //
  // Pedido do Guilherme: o botao do CRM abria aba nova e o WhatsApp recarregava
  // tudo. Aqui o caminho e outro — acha a aba do WhatsApp Web ja aberta, foca
  // nela e manda o content script trocar de conversa por dentro. Nada recarrega.
  // So cria aba nova quando NAO existe nenhuma, que e o unico caso em que
  // carregar do zero e inevitavel.
  // "Testar agora" da tela de Configuracoes: manda o canario rodar JA, na aba
  // do WhatsApp que estiver aberta, e devolve o resultado pra pagina.
  // Sem aba aberta nao ha o que testar — e isso e resposta, nao erro: o
  // diagnostico so existe de dentro do WhatsApp.
  if (msg && msg.type === 'canario_agora') {
    chrome.tabs.query({}, (abas) => {
      const aba = (abas || []).find((a) => a && a.url && a.url.indexOf('web.whatsapp.com') > -1);
      if (!aba) { sendResponse({ ok: false, motivo: 'whatsapp_fechado' }); return; }
      chrome.tabs.sendMessage(aba.id, { type: 'canario_agora' }, (r) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, motivo: 'aba_sem_extensao' });
          return;
        }
        // 'semConversa' sobe junto: sem conversa aberta o teste e parcial, e a
        // tela precisa dizer isso em vez de deixar a linha velha passar por nova.
        sendResponse(r || { ok: false, motivo: 'sem_resposta' });
      });
    });
    return true;
  }
  if (msg && msg.type === 'abrir_chat_whatsapp') {
    const tel = String(msg.telefone || '').replace(/\D/g, '');
    const texto = String(msg.texto || '').slice(0, 4000);
    const comDdi = tel ? (tel.startsWith('55') ? tel : '55' + tel) : '';
    chrome.tabs.query({ url: 'https://web.whatsapp.com/*' }, (abas) => {
      const aba = (abas || [])[0];
      if (!aba) {
        if (!comDdi) { sendResponse({ ok: false, motivo: 'sem_telefone' }); return; }
        chrome.tabs.create({ url: 'https://web.whatsapp.com/send?phone=' + comDdi + (texto ? '&text=' + encodeURIComponent(texto) : ''), active: true },
          () => sendResponse({ ok: true, motivo: 'aba_nova' }));
        return;
      }
      chrome.tabs.update(aba.id, { active: true }, () => {
        if (aba.windowId != null) { try { chrome.windows.update(aba.windowId, { focused: true }); } catch (e) {} }
        chrome.tabs.sendMessage(aba.id, { type: 'abrir_chat_aqui', telefone: comDdi, chatId: msg.chatId || '', texto: msg.texto || '' },
          (r) => {
            if (chrome.runtime.lastError) {
              // Aba aberta mas sem content script (F5 pendente): navega nela
              // mesmo assim — ainda e melhor que abrir outra.
              if (comDdi) chrome.tabs.update(aba.id, { url: 'https://web.whatsapp.com/send?phone=' + comDdi + (texto ? '&text=' + encodeURIComponent(texto) : '') });
              sendResponse({ ok: true, motivo: 'navegou_na_aba' });
              return;
            }
            sendResponse({ ok: !!(r && r.ok), motivo: (r && r.motivo) || '' });
          });
      });
    });
    return true;
  }
  if (msg && msg.type === 'documento_tipo') {
    chamarJob('/api/whatsapp/documentos/tipo', 'POST',
      { doc_id: msg.docId, tipo: msg.tipo, titularidade: msg.titularidade || '',
        parentesco: msg.parentesco || '' }, 15000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'documentos_ler') {
    chamarJob('/api/whatsapp/documentos/ler', 'POST',
      { telefone: msg.telefone, lead_id: msg.leadId || null, reler: !!msg.reler,
        arquivos: msg.arquivos || [] },
      180000).then(sendResponse);
    return true;
  }
  // ── ABRIR / FOCAR A ABA DO PAINEL ─────────────────────────────────────
  //
  // A mensagem de erro mandava o consultor "ir na aba do Painel". Se ela não
  // existe, ele tem que saber o endereço, abrir e logar — no meio de um
  // atendimento, com o cliente esperando. Um clique resolve: se a aba existe,
  // foca; se não, abre.
  if (msg && msg.type === 'painel_abrir') {
    chrome.tabs.query({ url: 'https://*.paineldocorretor.com.br/*' }, (abas) => {
      const viva = (abas || [])[0];
      if (viva) {
        chrome.tabs.update(viva.id, { active: true });
        chrome.windows.update(viva.windowId, { focused: true }, () => { void chrome.runtime.lastError; });
        sendResponse({ ok: true, tinha: true });
        return;
      }
      chrome.tabs.create({ url: 'https://paineldocorretor.com.br/', active: true },
        () => sendResponse({ ok: true, tinha: false }));
    });
    return true;
  }
  // A aba do Painel avisa que está viva. Guardado com hora, pra a extensão
  // saber a diferença entre "nunca abriu" e "abriu e fechou".
  if (msg && msg.type === 'painel_vivo') {
    chrome.storage.local.set({ painelVivoEm: Date.now() });
    return false;
  }

  if (msg && msg.type === 'vincular_chats') {
    chamarJob('/api/whatsapp/chats/vincular', 'POST', { conversas: msg.conversas || [] }, 45000).then(sendResponse);
    return true;
  }
  // "Nao e lead": marca a conversa como pessoal. O JOB para de ler e, na
  // revisao das 19h, apaga o card que tiver nascido dela antes da marcacao.
  if (msg && msg.type === 'ignorar_conversa') {
    chamarJob('/api/whatsapp/ignorar', 'POST', {
      chat_id: msg.chat_id || '', telefone: msg.telefone || '',
      nome: msg.nome || '', motivo: msg.motivo || '', desmarcar: !!msg.desmarcar,
    }, 20000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'transcricoes_cache') {
    chamarJob('/api/whatsapp/transcricoes', 'POST',
      { ids: msg.ids || [], filehashes: msg.filehashes || {} }, 15000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'transcrever_audios') {
    chamarJob('/api/whatsapp/transcrever', 'POST', { audios: msg.audios || [] }, 120000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'ficha_lead') {
    let q = msg.lead_id ? ('lead_id=' + encodeURIComponent(msg.lead_id))
                        : ('telefone=' + encodeURIComponent(msg.telefone || ''));
    // O chat_id vai junto: conversa em @lid nao tem telefone, e e justamente ela
    // que precisa ser reconhecida como 'ja marcada como pessoal'.
    if (msg.chat_id) q += '&chat_id=' + encodeURIComponent(msg.chat_id);
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
      { telefone: msg.telefone, texto: msg.texto, usuario_id: msg.usuario_id,
        chat_id: msg.chatId || '' }, 10000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'notas_excluir') {
    chamarJob('/api/whatsapp/notas/excluir', 'POST', { id: msg.id }, 10000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'lead_por_telefone') {
    // Manda o chat_id junto: e o que permite ao JOB amarrar o @lid ao lead na
    // hora em que o consultor abre a conversa, sem nenhum passo extra pra ele.
    chamarJob('/api/whatsapp/lead-por-telefone?telefone=' + encodeURIComponent(msg.telefone || '') +
      (msg.chatId ? '&chat_id=' + encodeURIComponent(msg.chatId) : '') +
      (msg.nome ? '&nome=' + encodeURIComponent(msg.nome) : ''), 'GET', null, 10000).then(sendResponse);
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


// Recorta a folga em volta da marca: transparente OU quase branca.
//
// Devolve null quando não dá pra decidir (formato que o navegador não decodifica,
// imagem toda clara, recorte que sobrou menor que um selo). Null faz o chamador
// usar a imagem original — melhor a logo com folga do que logo recortada errada.
async function _aparar(blob) {
  const bmp = await createImageBitmap(blob);
  const L = bmp.width, A = bmp.height;
  if (!L || !A || L * A > 4000 * 4000) return null;
  const cv = new OffscreenCanvas(L, A);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, L, A).data;
  // "Vazio" = transparente ou perto do branco. O segundo caso existe porque
  // muita logo vem em JPG, sem canal alfa, com fundo branco.
  const vazio = (i) => d[i + 3] < 24 || (d[i] > 244 && d[i + 1] > 244 && d[i + 2] > 244);
  let x0 = L, y0 = A, x1 = -1, y1 = -1;
  for (let y = 0; y < A; y++) {
    for (let x = 0; x < L; x++) {
      if (vazio((y * L + x) * 4)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0 || y1 < 0) return null;                 // imagem inteira "vazia"
  const m = 2;                                       // respiro, pra não encostar
  x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m);
  x1 = Math.min(L - 1, x1 + m); y1 = Math.min(A - 1, y1 + m);
  const nl = x1 - x0 + 1, na = y1 - y0 + 1;
  if (nl < 8 || na < 8) return null;
  // Recorte que quase não muda nada não vale reencodar: perde qualidade à toa.
  if (nl > L * 0.94 && na > A * 0.94) return null;
  // Sobe a resolução até 3x pro ícone não sair borrado em tela retina, com teto
  // pra não guardar imagem grande de graça.
  const escala = Math.min(3, Math.max(1, 96 / Math.max(nl, na)));
  const saida = new OffscreenCanvas(Math.round(nl * escala), Math.round(na * escala));
  const sctx = saida.getContext('2d');
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(bmp, x0, y0, nl, na, 0, 0, saida.width, saida.height);
  const png = await saida.convertToBlob({ type: 'image/png' });
  return await new Promise((ok, err) => {
    const fr = new FileReader();
    fr.onload = () => ok(fr.result);
    fr.onerror = err;
    fr.readAsDataURL(png);
  });
}


// ─── REINJEÇÃO AUTOMÁTICA: fim do "recarregue a aba" ────────────────────────
//
// Quando a extensão é atualizada ou recarregada, o Chrome invalida os content
// scripts que já estavam nas abas abertas. Eles continuam lá, mas sem acesso à
// extensão: a aba do Painel vira "está aberta, mas precisa de F5", e a do
// WhatsApp para de responder. Todo dia de trabalho tem várias atualizações, e
// pedir F5 em cada uma é pedir para o consultor lembrar de algo que a máquina
// sabe fazer.
//
// Aqui a extensão reinjeta sozinha. Cada script tem uma trava (`window.__JOB_*`)
// que impede injeção dupla — e a trava é o que faz isto ser seguro:
//
//   - no mundo MAIN o flag SOBREVIVE à recarga da extensão, então o script de
//     lá (que não usa API da extensão e continua funcionando) NÃO é reinjetado
//     e o window.fetch não é embrulhado duas vezes;
//   - no mundo ISOLADO o flag nasce limpo, e é exatamente ali que a ponte
//     precisa voltar a existir.
//
// Falha em silêncio de propósito: aba em outro endereço, aba descartada pelo
// Chrome ou permissão negada não devem virar erro na cara de ninguém — o pior
// caso é o comportamento de antes, que é pedir F5.
// SÓ O MUNDO ISOLADO É REINJETADO DAQUI.
//
// O mundo MAIN (wa-js, wpp-bridge, cotador-painel) agora é injetado pela
// própria página — content.js chama injetor.js, painel-bridge.js chama
// cotador-painel.js. A vantagem é que a página percebe quando faltou e injeta
// de novo sozinha, sem F5. Daqui, do service worker, só dava pra injetar em
// dois momentos (instalação e boot) e eu errei as duas vezes que tentei.
//
// Aqui fica o que morre de verdade na recarga da extensão: a ponte do mundo
// ISOLADO, que perde a ligação com o chrome.* e tem trava com prova de vida.
const _REINJETAR = [
  { host: 'web.whatsapp.com',                        isolado: ['content.js'] },
  { host: 'paineldocorretor.com.br',                 isolado: ['painel-bridge.js'] },
  { host: 'job-serenus-production.up.railway.app',   isolado: ['site-bridge.js'] },
];

async function _reinjetarNasAbasAbertas(motivo) {
  let abas = [];
  try { abas = await chrome.tabs.query({}); } catch (e) { return; }
  for (const aba of abas) {
    if (!aba.id || !aba.url) continue;
    const alvo = _REINJETAR.filter((x) => aba.url.indexOf(x.host) >= 0)[0];
    if (!alvo) continue;
    if (!alvo.isolado || !alvo.isolado.length) continue;
    try {
      await chrome.scripting.executeScript({
        target: { tabId: aba.id, allFrames: false },
        files: alvo.isolado,
        world: 'ISOLATED',
      });
    } catch (e) { /* aba morta, sem permissão, ou já saiu do ar */ }
  }
}

// Atualização da extensão e recarga do service worker são os dois momentos em
// que as abas ficam órfãs.
chrome.runtime.onInstalled.addListener((d) => _reinjetarNasAbasAbertas(d && d.reason));
chrome.runtime.onStartup.addListener(() => _reinjetarNasAbasAbertas('startup'));


// Busca a imagem ja pronta da cotacao. 404 aqui nao e erro: quer dizer que
// ninguem abriu o documento ainda e ela nao foi desenhada — quem chama
// resolve isso mandando `cotacao_imagem_gerar`.
async function buscarImagem(id) {
  const { jobUrl, extKey } = await config();
  const { extToken } = await chrome.storage.local.get(['extToken']);
  try {
    const resp = await fetch(jobUrl + '/api/v1/cotacao/' + id + '/imagem', {
      headers: Object.assign({},
        extToken ? { 'Authorization': 'Bearer ' + extToken }
                 : (extKey ? { 'X-Extension-Key': extKey } : {})),
    });
    if (resp.status === 404) return { ok: false, erro: 'imagem_ausente' };
    if (!resp.ok) return { ok: false, erro: 'HTTP ' + resp.status };
    const blob = await resp.blob();
    return await new Promise((r) => {
      const l = new FileReader();
      l.onloadend = () => r({ ok: true, dataUrl: l.result });
      l.onerror = () => r({ ok: false, erro: 'falha_ao_ler' });
      l.readAsDataURL(blob);
    });
  } catch (e) {
    return { ok: false, erro: 'Não consegui buscar a imagem agora.' };
  }
}
