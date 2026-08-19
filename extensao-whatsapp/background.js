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
  // Mediana, p95 e o pior caso. Média esconde justamente a chamada que travou —
  // dez de 200ms e uma de 9s dão média de 1s, que não descreve nem uma nem outra.
  // O p95 é o que dá pra comparar entre duas versões: o pior caso isolado pode
  // ser a máquina que entrou em suspensão no meio da chamada.
  return Object.keys(porRota).map((c) => {
    const v = porRota[c].slice().sort((a, b) => a - b);
    const p95 = v[Math.min(v.length - 1, Math.ceil(v.length * 0.95) - 1)];
    return { rota: c, n: v.length, mediana: v[Math.floor(v.length / 2)], p95: p95, pior: v[v.length - 1] };
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

// RELOGIOS EM SERIE, DO MENOR PRO MAIOR.
//
// Estavam invertidos: a ponte do Painel aceita ate 180s pra um catalogo
// (painel-bridge.js, ACEITOS), o cao de guarda do trabalhador cortava aos 90s
// e o cliente desistia aos 120s. Um catalogo de ~19 operadoras leva ~110s:
// o trabalhador ja tinha gravado 'sem_resposta_a_tempo' e a resposta boa
// chegava pra ser descartada — catalogo que nunca terminava por mais que se
// tentasse. A ordem tem que ser ponte < cao de guarda < cliente, e o
// servidor (3 min pra considerar preso) por ultimo.
const _FILA_ESPERA_MS = 2000;     // 1s dobrava as consultas de status sem ganho
const _TRAB_LIMITE_MS = 195000;   // ponte (180s) + folga
const _FILA_LIMITE_MS = 210000;   // cliente espera mais que o cao de guarda

// Manda um passo pra fila e espera a resposta. `cb(null)` quando nao ha
// trabalhador — ai quem chamou devolve o "Painel fechado" de sempre, que
// continua sendo a verdade naquele caso.
function _filaPedir(pedido, cb) {
  const chave = 'cot-' + Date.now().toString(36) + '-' +
    (globalThis.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
  chamarJob('/api/whatsapp/cotacao/fila', 'POST',
            { pedido: pedido, chave_pedido: chave }, 15000, null, { repetivel: true })
    .then((r) => {
      // O MOTIVO DO SERVIDOR NAO PODE MORRER AQUI.
      //
      // `cb(null)` fazia quem chamou responder 'painel_fechado' pra tudo. Era
      // o diagnostico errado no caso exato que a fila existe pra resolver: o
      // servidor dizia 'sem_trabalhador' e a consultora lia que precisava
      // abrir o Painel na maquina dela. cb(null) fica so pra falha de rede,
      // onde nao ha motivo nenhum pra contar.
      if (!r || !r.ok || !r.id) {
        const m = r && (r.motivo || r.erro);
        cb(m ? { ok: false, motivo: m } : null);
        return;
      }
      const id = r.id;
      const t0 = Date.now();
      const perguntar = () => {
        if (Date.now() - t0 > _FILA_LIMITE_MS) {
          // DESISTIU AQUI? ENTAO AVISA LA.
          //
          // Sem isso o pedido continuava 'rodando' no JOB: a maquina
          // trabalhadora seguia cotando pra ninguem, e o proximo da fila
          // esperava atras de um trabalho que ja nao interessa mais. O
          // servidor so se recuperava sozinho depois de 3 min de silencio.
          chamarJob('/api/whatsapp/cotacao/fila/' + id + '/cancelar', 'POST', {}, 8000)
            .catch(() => {});
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
// Esta maquina pergunta ao JOB se ha trabalho. Uma consulta por minuto deixa o
// service worker dormir entre rodadas. A versao anterior abria uma janela de
// 55 segundos e consultava a cada 2 segundos: na maquina trabalhadora o worker
// ficava acordado praticamente o tempo inteiro, mesmo sem nenhuma cotacao.
let _trabOcupado = false;
let _trabConsultando = false;
let _trabUltimaConsulta = 0;
let _paraleloAtual = null;
let _souTrabalhador = false;

function _trabalhadorTick() {
  const agora = Date.now();
  if (_trabOcupado || _trabConsultando || agora - _trabUltimaConsulta < 1500) return;
  _trabConsultando = true;
  _trabUltimaConsulta = agora;
  // A chamada fica pendente no JOB por até 20s. É o servidor que acorda esta
  // extensão quando entra trabalho; temporizador de aba escondida não manda
  // mais no tempo da fila.
  chamarJob('/api/whatsapp/cotacao/fila/proximo?esperar=20', 'GET', null, 25000).then((r) => {
    if (!r) return;
    if (r.motivo === 'nao_e_trabalhador' || r.motivo === 'trabalhador_indisponivel') return;
    if (!r.ok || !r.id) return;
    _trabOcupado = true;
    _trabalhadorExecutar(r.id, r.pedido);
  }).catch(() => {}).finally(() => {
    _trabConsultando = false;
    // Renova a escuta enquanto este for o aparelho responsável. O pequeno
    // intervalo só cede o event loop; não é o relógio que determina a busca.
    if (_souTrabalhador && !_trabOcupado) setTimeout(_trabalhadorTick, 500);
  });
}

// Roda o pedido na aba do Painel DESTA maquina e devolve o resultado.
//
// Se nao houver Painel aqui, devolve ERRO em vez de ficar quieto: a maquina
// marcada como trabalhadora sem Painel aberto e um defeito de configuracao, e
// quem esta esperando precisa saber disso em vez de esperar pra sempre.
// O DETALHE DE ERRO NAO SOBE PRO SERVIDOR.
//
// `passo` anexa {enviei, responderam, arvore} quando o Painel devolve erro
// (cotador-painel.js). Isso e ouro pra depurar NA MAQUINA que executou e nao
// pode existir em lugar nenhum alem dela: `arvore` e a next-router-state-tree
// da sessao do Painel, e `responderam` e o corpo cru da resposta deles, que
// num 403 costuma trazer identificacao de sessao. Indo pro /pronto, isso era
// gravado em cotacao_fila.resultado_json e ficava no Postgres.
//
// O `motivo` sobrevive inteiro — e ele que a tela precisa. So o anexo cai.
function _semDetalheDeSessao(v) {
  if (Array.isArray(v)) return v.map(_semDetalheDeSessao);
  if (!v || typeof v !== 'object') return v;
  const fora = { detalhe: 1, arvore: 1, responderam: 1, enviei: 1 };
  const limpo = {};
  Object.keys(v).forEach((k) => { if (!fora[k]) limpo[k] = _semDetalheDeSessao(v[k]); });
  return limpo;
}

function _trabalhadorExecutar(id, pedido) {
  const terminar = (corpo) => {
    corpo = _semDetalheDeSessao(corpo);
    // A transição no servidor é condicional e, por isso, repetir é seguro. Se
    // a resposta HTTP se perder depois do UPDATE, a segunda tentativa recebe
    // conflito sem ressuscitar nem duplicar o pedido.
    chamarJob('/api/whatsapp/cotacao/fila/' + id + '/pronto', 'POST', corpo,
              20000, null, { repetivel: true })
      .catch(() => {})
      .then(() => {
        _trabOcupado = false;
        _trabalhadorTick();
      });
  };
  if (pedido && pedido.type === 'cotador_precos_paralelos') {
    _precosParalelosExecutar(pedido.pedido || {}, (feito, total) => {
      chamarJob('/api/whatsapp/cotacao/fila/' + id + '/etapa', 'POST',
                { etapa: 'Conferindo preços — ' + feito + ' de ' + total,
                  fracao: total ? feito / total : 0 }, 8000).catch(() => {});
    }).then((r) => terminar(r && r.ok
        // FALHA TOTAL E ERRO, NAO 'PRONTO'.
        //
        // Devolvendo {resultado:{ok:false}} o registro ficava estado='pronto',
        // erro=NULL: pra quem olha a fila no banco a cotacao "deu certo", e o
        // motivo real (Painel fechado aqui, outra cotacao em andamento) nao
        // sobrevivia em lugar nenhum do servidor.
        ? { resultado: r }
        : { erro: (r && r.motivo) || 'falha_no_trabalhador' }))
      .catch(() => terminar({ erro: 'falha_nas_frentes_de_preco' }));
    return;
  }
  chrome.tabs.query({}, (todas) => {
    const lista = (todas || []).filter(
      (a) => a.url && a.url.indexOf('paineldocorretor.com.br') >= 0);
    const ativa = lista.filter((a) => a.active)[0];
    const candidatas = ativa ? [ativa].concat(lista.filter((a) => a.id !== ativa.id)) : lista;
    if (!candidatas.length) { terminar({ erro: 'painel_fechado_no_trabalhador' }); return; }
    let respondeu = false;
    const relogio = setTimeout(() => {
      if (!respondeu) { respondeu = true; terminar({ erro: 'sem_resposta_a_tempo_no_trabalhador' }); }
    }, _TRAB_LIMITE_MS);
    const tentar = (indice) => {
      if (respondeu) return;
      if (indice >= candidatas.length) {
        respondeu = true; clearTimeout(relogio);
        terminar({ erro: 'painel_precisa_recarregar_no_trabalhador' });
        return;
      }
      try {
        chrome.tabs.sendMessage(candidatas[indice].id, pedido, (r) => {
          if (respondeu) return;
          if (chrome.runtime.lastError) { tentar(indice + 1); return; }
          respondeu = true; clearTimeout(relogio);
          terminar({ resultado: r || { ok: false, motivo: 'sem_resposta' } });
        });
      } catch (e) { tentar(indice + 1); }
    };
    tentar(0);
  });
}

function _abasDoPainel() {
  return new Promise((resolve) => chrome.tabs.query({}, (todas) => resolve(
    (todas || []).filter((a) => a.url && a.url.indexOf('paineldocorretor.com.br') >= 0))));
}

async function _garantirAbasPainel(quantas) {
  const abas = await _abasDoPainel();
  if (!abas.length) return [];
  // Uma aba autenticada suporta varias requisicoes independentes. As frentes
  // sao logicas e cada uma cria seu proprio cotacaoId; abrir abas fisicas so
  // poluia o navegador e ainda submetia os timers ao estrangulamento de abas
  // ocultas do Chrome. Repetir a referencia envia os lotes concorrentes pela
  // mesma ponte, sem misturar o estado de cada cotacao.
  const aba = abas.find((a) => a.active) || abas[0];
  return Array.from({ length: quantas }, () => aba);
}

async function _precosParalelosExecutar(pedido, aoAndar) {
  const planos = Array.isArray(pedido.planos) ? pedido.planos.slice(0, 6) : [];
  if (!planos.length) return { ok: true, dados: { planos: [], frentes: 0, ms: 0 } };
  if (_paraleloAtual) return { ok: false, motivo: 'outra_cotacao_em_andamento' };
  _paraleloAtual = { total: planos.length, concluidos: new Set(), aoAndar: aoAndar };
  const t0 = Date.now();
  let abas = [];
  try { abas = await _garantirAbasPainel(Math.min(3, planos.length)); }
  catch (e) {
    _paraleloAtual = null;
    _anotarTempo('cotacao:precos_paralelos', Date.now() - t0, false);
    return { ok: false, motivo: 'painel_fechado' };
  }
  if (!abas.length) {
    _paraleloAtual = null;
    _anotarTempo('cotacao:precos_paralelos', Date.now() - t0, false);
    return { ok: false, motivo: 'painel_fechado' };
  }
  const lotes = abas.map(() => []);
  planos.forEach((p, i) => lotes[i % lotes.length].push(p));
  const executar = (aba, lote, indice) => new Promise((resolve) => {
    setTimeout(() => {
      const porChave = {};
      lote.forEach((p) => { porChave[String(p.key || p.chave || '')] = p; });
      try {
        chrome.tabs.sendMessage(aba.id, {
          type: 'cotador_precos_lote',
          pedido: Object.assign({}, pedido, { acao: 'precos_lote', planos: lote,
                                              reqId: 'frente-' + indice + '-' + Date.now() })
        }, (r) => {
          if (chrome.runtime.lastError || !r || !r.ok) {
            resolve(lote.map((p) => ({ chave: p.key || p.chave || '', plano: p,
                                      cartao: null, motivo: 'frente_nao_respondeu' })));
            return;
          }
          resolve((r.dados && r.dados.planos) || []);
        });
      } catch (e) {
        resolve(lote.map((p) => ({ chave: p.key || p.chave || '', plano: p,
                                  cartao: null, motivo: 'frente_nao_respondeu' })));
      }
    }, indice * 180);
  });
  try {
    const partes = await Promise.all(abas.map((a, i) => executar(a, lotes[i], i)));
    _anotarTempo('cotacao:precos_paralelos', Date.now() - t0, true);
    return { ok: true, dados: { planos: partes.flat(), frentes: abas.length,
                                ms: Date.now() - t0 } };
  } finally {
    _paraleloAtual = null;
  }
}

// SINAL DE VIDA. Escreve numa coluna propria no servidor — nao no carimbo
// generico da sessao, que qualquer requisicao ja atualiza. Um Dell com o
// Painel morto e o navegador ativo pareceria vivo, e e justamente o caso que
// este sinal existe pra pegar.
function _trabalhadorVivo() {
  return new Promise((resolve) => chrome.tabs.query({}, (todas) => {
    const lista = (todas || []).filter(
      (a) => a.url && a.url.indexOf('paineldocorretor.com.br') >= 0);
    const aba = lista.find((a) => a.active) || lista[0];
    const bater = (painelPronto) => {
      chamarJob('/api/whatsapp/trabalhador/vivo', 'POST',
                { painel_logado: painelPronto }, 10000, null, { repetivel: true })
        .then((r) => {
          _souTrabalhador = !!(r && r.ok);
          _anotarBatida(painelPronto, r);
          resolve(_souTrabalhador);
        })
        .catch((e) => {
          _souTrabalhador = false;
          _anotarBatida(painelPronto, { erro: String(e && e.message || e) });
          resolve(false);
        });
    };
    if (!aba) { bater(false); return; }
    // Aba aberta não basta: depois de atualizar a extensão, ela pode estar sem
    // a ponte que executa a cotação. Só anunciamos disponibilidade quando a
    // ponte responde de fato; o conteúdo da resposta não precisa estar pronto.
    try {
      chrome.tabs.sendMessage(aba.id, { type: 'cotador_estado' }, () => {
        const respondeu = !chrome.runtime.lastError;
        bater(respondeu);
      });
    } catch (e) { bater(false); }
  }));
}

// O QUE ACONTECEU NA ULTIMA BATIDA — GRAVADO, NAO SO TENTADO.
//
// O `trabalhador_sinal` no servidor ficou NULL a noite inteira e nao havia
// como saber onde a corrente quebrava: se a batida nao saia, se saia sem
// token, se o servidor recusava, ou se o worker nem acordava. Cada hipotese
// dessas custou uma rodada de tentativa e erro.
//
// Agora fica escrito: quando foi, se havia Painel aberto, e o que o servidor
// respondeu. Aparece no diagnostico do painel, entao da pra ler sem devtools.
function _anotarBatida(temPainel, r) {
  try {
    chrome.storage.local.set({
      batidaEm: new Date().toISOString(),
      batidaPainel: !!temPainel,
      // `{ok:false}` sem erro e a resposta do servidor pra "voce nao e a
      // maquina marcada" — que e uma informacao, nao uma falha.
      batidaResposta: !r ? 'sem resposta'
        : (r.erro ? String(r.erro)
          // "sem_aparelho" NAO e o mesmo que "nao marcada". A primeira quer
          // dizer que o JOB nao sabe qual aparelho e este — quem entrou pela
          // chave antiga, sem login, cai aqui — e nao se resolve marcando
          // maquina nenhuma. Junte as duas e o diagnostico manda consertar a
          // coisa errada, que foi o que aconteceu.
          : (r.motivo === 'sem_aparelho'
              ? 'o JOB nao sabe qual aparelho e este — falta entrar com e-mail e senha'
            : (r.motivo === 'nao_marcada' || r.ok === false
              ? 'este aparelho nao e o marcado pra cotar'
              : 'gravado'))),
    });
  } catch (e) { /* diagnostico nao pode derrubar a batida */ }
}

// RELOGIO DE SERVICE WORKER NAO E RELOGIO.
//
// Isto aqui era um setTimeout em cadeia e um setInterval de 60s. Num service
// worker do Manifest V3 os dois sao inuteis: o Chrome MATA o worker depois de
// ~30s parado, e os temporizadores morrem junto. O worker so volta quando
// acontece um EVENTO. Resultado medido: a sessao 10 estava marcada como a
// maquina que cota e o `trabalhador_sinal` no banco continuava NULL — pro
// servidor, uma maquina ligada, logada e configurada certo parecia morta, e a
// fila responderia "sem_trabalhador" pra todo mundo.
//
// `chrome.alarms` e o unico relogio que sobrevive: ele acorda o worker uma vez,
// faz uma rodada curta e deixa o Chrome suspende-lo de novo. A fila aceita essa
// latencia: o pedinte espera ate 2 minutos e o proximo alarme acontece em no
// maximo 1 minuto.
const _ALARME = 'job-fila';

async function _extensaoLigada() {
  try {
    const c = await chrome.storage.local.get(['extensaoAtiva']);
    return c.extensaoAtiva !== false;
  } catch (e) { return true; }
}

async function _rodadaDeFundo() {
  if (!await _extensaoLigada()) return;
  // Primeiro comprova que esta maquina continua marcada E tem Painel aberto.
  // Só depois tenta tomar trabalho. Em paralelo, o tick podia vencer a batida
  // e usar um sinal antigo justo quando o Painel havia sido fechado.
  let podeTrabalhar = false;
  try { podeTrabalhar = await _trabalhadorVivo(); } catch (e) {}
  if (podeTrabalhar) {
    try { _trabalhadorTick(); } catch (e) {}
  }
}

// NADA DISTO PODE DERRUBAR O WORKER INTEIRO.
//
// Isto roda no topo do arquivo. Se `chrome.alarms` nao existir — permissao
// nova que o Chrome ainda nao concedeu, extensao carregada de um jeito
// diferente — a excecao acontece ANTES do resto do arquivo, e o service
// worker inteiro morre com ela: some o painel, some a analise, some tudo. Um
// relogio da fila nao vale esse risco, entao ele falha sozinho e o resto
// segue, com o relogio velho como reserva.
if (chrome.alarms && chrome.alarms.create) {
  try {
    chrome.alarms.create(_ALARME, { periodInMinutes: 1 });
    chrome.alarms.onAlarm.addListener((al) => {
      if (al.name !== _ALARME) return;
      _rodadaDeFundo().catch(() => {});
    });
  } catch (e) { _relogioVelho(); }
} else {
  _relogioVelho();
}

// A reserva e o que existia antes: temporizador em cadeia. Ele morre junto com
// o worker e por isso nao serve como relogio de verdade — mas enquanto o
// worker esta de pe (que e quando alguem esta usando a extensao) ele funciona,
// e e melhor que silencio.
function _relogioVelho() {
  setTimeout(() => { _rodadaDeFundo().catch(() => {}); }, 8000);
  setInterval(() => { _rodadaDeFundo().catch(() => {}); }, 60000);
}

// O worker tambem acorda por outros motivos (uma mensagem da aba, por
// exemplo). Quando isso acontece, nao ha razao pra esperar o proximo alarme.
_rodadaDeFundo().catch(() => {});

// CAIXA-PRETA DO WORKER.
//
// Um service worker que nao subiu nao deixa rastro: nao ha tela, nao ha log
// que fique. Ficamos duas horas sem conseguir dizer se ele estava morto ou so
// dormindo. Estas tres linhas ficam gravadas e respondem isso na hora, sem
// depender de pegar o console aberto no momento certo.
try {
  chrome.storage.local.set({
    swSubiuEm: new Date().toISOString(),
    swTemAlarme: !!(chrome.alarms && chrome.alarms.create),
    swVersao: (chrome.runtime.getManifest() || {}).version || '?',
  });
} catch (e) { /* sem diagnostico, o resto continua */ }


// Apaga a sessao morta e faz o estado da extensao contar a verdade.
//
// Uma vez so: com varias chamadas em voo, todas voltam 401 juntas e sem esta
// trava a extensao limparia e avisaria N vezes seguidas.
let _sessaoMorrendo = false;
async function _sessaoMorreu() {
  if (_sessaoMorrendo) return;
  _sessaoMorrendo = true;
  try {
    // A CHAVE ANTIGA SAI JUNTO.
    //
    // O servidor agora recusa o Bearer revogado mesmo com a chave presente
    // (conserto do mesmo dia, do lado de la). Mas enquanto a chave continuar
    // guardada aqui, um segundo problema sobra: quem reabre o popup ve o
    // campo "Chave de acesso" preenchido e pode achar que basta salvar de
    // novo pra voltar a funcionar sem entrar com senha. Apagando os dois, so
    // sobra um caminho pra voltar: o login.
    await chrome.storage.local.remove(['extToken', 'extUsuario', 'extApelido', 'extKey']);
    // O aviso vai pro icone, nao pra uma notificacao do sistema: ninguem
    // precisa de um alarme, precisa de saber onde clicar. O icone da barra e
    // exatamente onde a pessoa vai clicar pra resolver.
    try {
      await chrome.action.setBadgeText({ text: '!' });
      await chrome.action.setBadgeBackgroundColor({ color: '#be123c' });
      await chrome.action.setTitle({ title: 'JOB — este aparelho foi desconectado. Clique para entrar de novo.' });
    } catch (e) { /* sem badge, o popup ainda mostra a tela de entrar */ }
  } finally {
    // Solta depois de um tempo: se a pessoa entrar de novo e for desconectada
    // outra vez, o aviso tem que voltar a funcionar.
    setTimeout(() => { _sessaoMorrendo = false; }, 30000);
  }
}

// Baixa um arquivo BINÁRIO do JOB e devolve como data URL.
//
// O chamarJob acima faz resp.json() e serve pra tudo que é dado; um PDF morre
// ali. E o content script não pode buscar sozinho porque a extensão autentica
// por token, não por cookie (ver o comentário grande em chamarJob) — um <a
// href> direto só funcionaria pra quem estivesse logado no JOB no mesmo
// Chrome, que é exatamente o admin, e a falha ficaria invisível justo pra
// quem testa.
async function baixarArquivoJob(caminho, timeoutMs) {
  const { jobUrl, extKey } = await config();
  const { extToken } = await chrome.storage.local.get(['extToken']);
  if (!extKey && !extToken) {
    return { ok: false, erro: 'Entre com seu e-mail e senha no popup da extensão (clique no ícone do JOB).' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 30000);
  try {
    const resp = await fetch(jobUrl + caminho, {
      method: 'GET',
      credentials: 'omit',
      headers: extToken ? { 'Authorization': 'Bearer ' + extToken }
                        : (extKey ? { 'X-Extension-Key': extKey } : {}),
      signal: controller.signal
    });
    if (!resp.ok) {
      // Quando dá erro, o servidor responde JSON com o motivo — e o motivo
      // ('sem cadastro' x 'base fora do ar') é o que o consultor precisa ler.
      let j = null;
      try { j = await resp.json(); } catch (e) { j = null; }
      return { ok: false, erro: (j && j.erro) || 'Não consegui baixar o cartão SUS agora.' };
    }
    const buf = await resp.arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const disp = resp.headers.get('Content-Disposition') || '';
    const m = disp.match(/filename="([^"]+)"/);
    return { ok: true, dataUrl: 'data:application/pdf;base64,' + btoa(bin),
             nome: m ? m[1] : 'CARTAO SUS.pdf' };
  } catch (e) {
    return { ok: false, erro: e && e.name === 'AbortError'
      ? 'A base do Ministério da Saúde demorou demais. Tente de novo.'
      : 'Não consegui baixar o cartão SUS agora.' };
  } finally { clearTimeout(timer); }
}

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
        // SEM COOKIE. ESTA CHAMADA E DO APARELHO, NAO DO NAVEGADOR.
        //
        // Foi isto que escondeu tudo na noite de 10/08. O Chrome manda os
        // cookies do JOB junto com as chamadas da extensao, e a PRIMEIRA porta
        // dos decoradores no servidor e a sessao do site. Resultado: quem
        // estivesse logado no JOB naquele navegador — o admin, sempre — era
        // autenticado pelo proprio login do site, e o token do aparelho virava
        // decoracao. Revogar o aparelho nao mudava nada, o /ping respondia 200
        // com o token morto, e o painel dizia "conectado" com toda a razao do
        // ponto de vista dele.
        //
        // Pior: cada consultora veria um comportamento diferente da mesma
        // extensao, dependendo de estar ou nao logada no site naquele Chrome.
        //
        // `omit` faz a chamada valer por si: ou o token do aparelho autentica,
        // ou nao passa.
        credentials: 'omit',
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
        // DESCONECTADO E DIFERENTE DE "DEU ERRO".
        //
        // O token mora aqui no Chrome. Quando um admin desconecta o aparelho
        // pelo site, nada aqui muda: o popup seguia mostrando a pessoa logada,
        // com nome e tudo, e a extensao so parava de funcionar em silencio.
        // Foi assim que o Guilherme "entrou pelo popup" sem entrar — nao havia
        // o que clicar, porque a tela nao estava pedindo login.
        //
        // O servidor agora diz `sessao_revogada` e so isso. Apagar o token
        // aqui faz o popup voltar sozinho pra tela de entrar, que e a unica
        // acao que resolve.
        if (resp.status === 401 && dados && dados.erro === 'sessao_revogada') {
          await _sessaoMorreu();
          _anota(false);
          return { ok: false, erro: 'Este aparelho foi desconectado. Entre de novo pelo ' +
                                    'popup da extensao (clique no icone do JOB).',
                   status: 401, sessaoRevogada: true };
        }
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
  const { extToken } = await chrome.storage.local.get(['extToken']);
  if (!extKey && !extToken) return { ok: false, erro: 'Entre no JOB pelo popup da extensão.' };
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
      method: 'POST', headers: extToken
        ? { 'Authorization': 'Bearer ' + extToken }
        : { 'X-Extension-Key': extKey }, body: fd,
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

// O DECK MUDOU DE ENDERECO: AGORA ELE E UMA TELA DO JOB.
//
// Ate 19/08/2026 isto apontava para um servidor rodando no proprio Mac
// (127.0.0.1:8765), e o consultor tinha que ligar o deck na maquina, descobrir
// o IP e digitar um PIN no iPad — que ainda por cima mudava a cada partida.
// Agora quem guarda os comandos e o JOB: o iPad abre /deck com o login normal,
// de qualquer lugar, inclusive fora do escritorio.
//
// Devolve SEMPRE um objeto, nunca lanca: quem chama e um laco e nao pode
// quebrar porque ninguem abriu o deck hoje — que e o estado normal do dia.
async function deckPonte(rota, corpo) {
  try {
    const r = await chamarJob(rota, 'POST', corpo || {}, 8000);
    if (!r || !r.ok) return { ok: false, erro: (r && r.erro) || 'o JOB nao respondeu' };
    return { ok: true, dados: r };
  } catch (e) {
    return { ok: false, erro: 'o JOB nao respondeu' };
  }
}

// ═══════════════ Laço do deck do iPad ═══════════════
//
// POR QUE O LAÇO MORA AQUI E NÃO NO CONTENT SCRIPT.
//
// O consultor usa o deck justamente quando NÃO está olhando o Chrome — a aba do
// WhatsApp Web fica atrás o dia inteiro. O Chrome estrangula setTimeout de aba
// escondida para uma vez por minuto: um laço de 2s lá viraria um laço de 60s, e
// o botão do iPad pareceria quebrado.
//
// POR QUE ELE DORME, E COMO.
//
// Em 14/08/2026 um trabalhador deste mesmo service worker ficava acordado 55s
// de cada minuto consultando a fila a cada 2s. O renderer chegou a 4,4 GB e
// RESULT_CODE_HUNG. A regra que saiu dali vale aqui inteira:
//
//   1. Deck desligado (o normal do dia) = UMA batida por minuto, pelo alarme,
//      e nada mais. Sem porta aberta, sem service worker de pé, sem perguntar
//      nada para a aba do WhatsApp.
//   2. A busca é um fetch pelado em 127.0.0.1. Falhou, dormiu. Só depois de o
//      deck responder é que a aba passa a ser consultada.
//   3. O ritmo rápido é o DECK quem manda, e ele só pede pressa enquanto o iPad
//      está de fato com a tela aberta. Deck ligado e esquecido na mesa volta
//      sozinho para o ritmo lento.
//   4. Três falhas seguidas e o laço encerra. O alarme reencontra depois.

const DECK_BEAT_PADRAO = 2000;      // enquanto o iPad está olhando
const DECK_BEAT_OCIOSO = 15000;     // deck ligado, iPad guardado
const DECK_FALHAS_ATE_DORMIR = 3;   // depois disso o laço encerra e o alarme assume
let _deckLacoVivo = false;
let _deckFalhas = 0;
let _deckCatalogoEm = 0;
let _deckKickEm = 0;

function _deckPrecisaCatalogo() { return (Date.now() - _deckCatalogoEm) > 120000; }

// A aba do WhatsApp Web onde o envio vai acontecer. Com duas abertas, manda na
// que está na frente — é a conversa que o consultor tem em mente.
async function _deckAba() {
  try {
    const abas = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    if (!abas.length) return null;
    return (abas.find((a) => a.active) || abas[abas.length - 1]).id;
  } catch (e) { return null; }
}

// chrome.tabs.sendMessage fica pendurado se o content script morreu (aba
// recarregando, extensão atualizada). Sem este teto, o laço inteiro trava.
function _deckPerguntarAba(tabId, msg, tetoMs) {
  return new Promise((resolve) => {
    let respondeu = false;
    const corta = setTimeout(() => { if (!respondeu) { respondeu = true; resolve(null); } }, tetoMs || 8000);
    try {
      chrome.tabs.sendMessage(tabId, msg, (resp) => {
        void chrome.runtime.lastError;
        if (respondeu) return;
        respondeu = true; clearTimeout(corta); resolve(resp || null);
      });
    } catch (e) {
      if (!respondeu) { respondeu = true; clearTimeout(corta); resolve(null); }
    }
  });
}

// Uma batida: conta ao deck qual conversa está aberta e executa o que ele pediu.
// Devolve o intervalo até a próxima, ou 0 para encerrar o laço.
async function _deckBatida() {
  const tabId = await _deckAba();
  if (!tabId) return 0;                       // sem WhatsApp Web não há o que enviar
  const info = await _deckPerguntarAba(tabId,
    { type: 'deck_info', comCatalogo: _deckPrecisaCatalogo() }, 9000) || {};
  const r = await deckPonte('/api/whatsapp/extensao/deck/sincronizar',
    { chat: info.chat || null, catalogo: info.catalogo || null });
  if (!r.ok) {
    _deckFalhas++;
    return _deckFalhas >= DECK_FALHAS_ATE_DORMIR ? 0 : DECK_BEAT_OCIOSO;
  }
  _deckFalhas = 0;
  if (info.catalogo) _deckCatalogoEm = Date.now();
  for (const cmd of ((r.dados && r.dados.comandos) || [])) {
    // Um comando de cada vez: dois envios simultâneos na mesma conversa é
    // exatamente o jeito de o cliente receber tudo fora de ordem.
    const res = await _deckPerguntarAba(tabId, { type: 'deck_executar', cmd }, 120000);
    await deckPonte('/api/whatsapp/extensao/deck/resultado', {
      id: cmd.id,
      ok: !!(res && res.ok),
      estado: (res && res.estado) || '',
      mensagem: (res && res.mensagem) || 'A aba do WhatsApp Web não respondeu. Não enviei nada.',
    });
  }
  const pedido = Number(r.dados && r.dados.intervalo) || 2;
  return Math.max(DECK_BEAT_PADRAO, Math.min(DECK_BEAT_OCIOSO, pedido * 1000));
}

async function _deckLaco() {
  if (_deckLacoVivo) return;
  _deckLacoVivo = true;
  _deckFalhas = 0;
  try {
    for (;;) {
      let proxima = 0;
      try { proxima = await _deckBatida(); } catch (e) { proxima = 0; }
      if (!proxima) break;                    // dorme: o alarme reencontra o deck
      await new Promise((res) => setTimeout(res, proxima));
    }
  } finally {
    _deckLacoVivo = false;
  }
}

// A busca de um minuto em um minuto: uma chamada curta, sem envolver a aba. É o
// único trabalho de fundo que sobra quando ninguém está com o deck aberto.
async function _deckProcurar() {
  if (_deckLacoVivo) return;
  const r = await deckPonte('/api/whatsapp/extensao/deck/sincronizar', { chat: null, catalogo: null });
  if (r.ok) _deckLaco();
}

chrome.alarms.create('deck_procurar', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a && a.name === 'deck_procurar') _deckProcurar();
});

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
          // Mesma razao do `chamarJob`: entrar tem que valer pelo e-mail e
          // senha digitados, nao por um cookie do site que por acaso existe
          // naquele navegador. Sem `omit`, o admin logado no JOB "entrava"
          // sem que a senha fosse conferida de verdade.
          credentials: 'omit',
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
        // Entrou: some o "!" do icone. Aviso que fica depois de resolvido
        // ensina a ignorar aviso.
        _sessaoMorrendo = false;
        try {
          await chrome.action.setBadgeText({ text: '' });
          await chrome.action.setTitle({ title: 'JOB' });
        } catch (e) { /* o badge e enfeite; entrar ja e o que importa */ }
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
  // "ESTOU CONECTADO?" QUEM RESPONDE E O SERVIDOR.
  //
  // O painel dizia "conectado" olhando so o que estava guardado aqui no
  // Chrome. Como o token e apagado do lado do servidor, os dois discordavam em
  // silencio: a tela mostrava o nome, o selo verde e "Sair deste computador",
  // enquanto o JOB listava zero aparelhos. Foi exatamente o que aconteceu hoje.
  //
  // O /ping e a rota mais barata que exige credencial. Se o token morreu, ela
  // responde 401 e o `chamarJob` ja apaga tudo — o portao abre sozinho, porque
  // ele escuta a mudanca do storage.
  // QUAL VERSAO ESTA INSTALADA DE VERDADE.
  //
  // O content script de uma aba antiga responde a versao ANTIGA quando pergunta
  // o proprio manifesto — foi assim que o painel mostrou v4.64.0 com a v4.71.0
  // instalada, e ninguem percebeu por horas. O background sempre roda o codigo
  // novo, entao so ele sabe a verdade. Comparar as duas e o unico jeito da aba
  // descobrir sozinha que esta velha.
  if (msg && msg.type === 'versao_instalada') {
    let v = '';
    try { v = (chrome.runtime.getManifest() || {}).version || ''; } catch (e) {}
    sendResponse({ ok: true, versao: v });
    return true;
  }
  if (msg && msg.type === 'sessao_confere') {
    (async () => {
      const { extToken } = await chrome.storage.local.get(['extToken']);
      if (!extToken) { sendResponse({ valida: false, tinhaToken: false }); return; }
      const r = await chamarJob('/api/whatsapp/ping', 'GET', null, 10000);
      // So o 401 derruba. Servidor fora do ar, rede caida ou 500 NAO sao
      // motivo pra deslogar ninguem: nesses casos a resposta e "nao sei", e
      // quem nao sabe nao mexe.
      if (r && r.sessaoRevogada) { sendResponse({ valida: false, tinhaToken: true }); return; }
      sendResponse({ valida: true, incerta: !(r && r.ok !== false) });
    })();
    return true;
  }
  // A TELA DE USUARIOS AVISOU: "ALGUEM FOI DESCONECTADO AGORA MESMO".
  //
  // Fogo-e-esquece: uma chamada barata que ja existe (/ping), fora do relogio
  // normal. Se o token daqui morreu, o 401 sessao_revogada dispara dentro do
  // proprio chamarJob e ja limpa tudo — o portao abre sozinho porque o
  // content.js escuta a mudanca do storage. Se nao for este aparelho, a
  // resposta e 200 e nada muda.
  if (msg && msg.type === 'conferir_sessao_agora') {
    chamarJob('/api/whatsapp/ping', 'GET', null, 8000).catch(() => {});
    sendResponse({ ok: true });
    return true;
  }
  if (msg && msg.type === 'logout') {
    (async () => {
      // Avisa o servidor pra revogar, mas NÃO depende disso pra limpar aqui:
      // se o JOB estiver fora do ar, sair da máquina tem que funcionar mesmo
      // assim — senão a pessoa fica presa numa sessão que ela quer encerrar.
      try { await chamarJob('/api/whatsapp/logout', 'POST', {}, 8000); } catch (e) {}
      // Mesma razao do _sessaoMorreu: "Sair deste computador" tem que
      // significar sair de verdade, sem a chave antiga sustentando por baixo.
      await chrome.storage.local.remove(['extToken', 'extUsuario', 'extApelido', 'extKey']);
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
    if (msg.cidade) q.set('cidade', msg.cidade);
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
    chamarJob('/api/whatsapp/extensao/modelos', 'GET', null, 15000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'listar_funis') {
    chamarJob('/api/whatsapp/extensao/funis', 'GET', null, 15000).then(sendResponse);
    return true;
  }
  // PONTE COM O DECK DO IPAD.
  //
  // O deck e um servidor que roda no PROPRIO Mac (127.0.0.1:8765) e serve uma
  // pagina de botoes para o iPad. Quando o consultor toca "enviar" la, quem
  // executa e esta extensao, na conversa aberta do WhatsApp Web.
  //
  // O fetch mora AQUI, no service worker, e nao no content script: a pagina do
  // WhatsApp e https e publica, e o Chrome trata pedido de pagina publica para
  // endereco da rede local com desconfianca (Private Network Access). O service
  // worker tem host_permissions e nao passa por essa peneira.
  // A aba avisa que o consultor chegou nela: vale uma busca na hora, em vez de
  // esperar a virada do minuto. É evento de usuário, não relógio de fundo.
  if (msg && msg.type === 'deck_procurar_agora') {
    if (Date.now() - _deckKickEm > 20000) { _deckKickEm = Date.now(); _deckProcurar(); }
    sendResponse({ ok: true });
    return true;
  }
  if (msg && msg.type === 'deck_ponte') {
    deckPonte(msg.rota, msg.corpo).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'salvar_funil') {
    chamarJob('/api/whatsapp/extensao/funis/salvar', 'POST', msg.dados || {}, 20000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'duplicar_funil') {
    chamarJob('/api/whatsapp/extensao/funis/' + encodeURIComponent(msg.id) + '/duplicar',
      'POST', {}, 15000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'tempo_resposta') {
    chamarJob('/api/whatsapp/tempo-resposta', 'POST', msg.medicao || {}, 15000).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'funil_disparar') {
    // Enfileira o funil INTEIRO no servidor, com horario absoluto por passo.
    // O envio deixou de morar na aba: se o WhatsApp Web fechar no meio, os
    // passos que faltam continuam de pe no servidor.
    chamarJob('/api/whatsapp/extensao/funis/' + encodeURIComponent(msg.funil_id) + '/disparar', 'POST',
      { chat_id: msg.chat_id || '', telefone: msg.telefone || '', usuario_id: msg.usuario_id }, 20000).then(sendResponse);
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
  if (msg && msg.type === 'duplicar_modelo') {
    chamarJob('/api/whatsapp/extensao/modelos/' + encodeURIComponent(msg.id) + '/duplicar',
      'POST', {}, 15000).then(sendResponse);
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
  if (msg && msg.type === 'fila_enviar_agora') {
    chamarJob('/api/whatsapp/fila/' + encodeURIComponent(msg.fila_id) + '/enviar-agora', 'POST',
      { usuario_id: msg.usuario_id }, 15000).then(sendResponse);
    return true;
  }
  // DESISTIR DE UMA MENSAGEM QUE AINDA NAO SAIU.
  //
  // `repetivel` porque a chamada so subtrai: cancelar duas vezes da o mesmo
  // resultado que cancelar uma. Se a resposta se perder na rede, repetir e
  // seguro — e nao repetir seria pior, porque a mensagem sairia.
  if (msg && msg.type === 'fila_cancelar') {
    chamarJob('/api/whatsapp/fila/' + encodeURIComponent(msg.fila_id) + '/cancelar', 'POST',
      { usuario_id: msg.usuario_id, motivo: msg.motivo || '' }, 15000, null,
      { repetivel: true }).then(sendResponse);
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
  // Cartão SUS (CNS) por CPF + nascimento. 25 s porque quem responde é a base
  // do Ministério da Saúde, que é mais lenta que a BrasilAPI do CNPJ.
  if (msg && msg.type === 'consultar_cns') {
    const qs = 'cpf=' + encodeURIComponent(String(msg.cpf || '').replace(/\D/g, '')) +
               '&nascimento=' + encodeURIComponent(msg.nascimento || '');
    chamarJob('/api/whatsapp/cns?' + qs, 'GET', null, 25000).then(sendResponse);
    return true;
  }
  // O PDF do cartão SUS. Não dá pra ser um link na tela: a extensão não manda
  // cookie, então quem busca o arquivo é o background (que tem o token) e
  // devolve como data URL pro content script salvar.
  if (msg && msg.type === 'baixar_cartao_sus') {
    const qs = 'cpf=' + encodeURIComponent(String(msg.cpf || '').replace(/\D/g, '')) +
               '&nascimento=' + encodeURIComponent(msg.nascimento || '');
    baixarArquivoJob('/api/whatsapp/cartao-sus.pdf?' + qs).then(sendResponse);
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
  // A DECISAO DE RODAR A VARREDURA VEM AUTENTICADA.
  //
  // Ela morava em /api/whatsapp/config-remota, que e publica. Devolver decisao
  // por usuario numa rota publica deixava enumerar quem existe, entao ela saiu
  // de la — e ficou sem casa: a rota passou a responder 'nao_autenticado' pra
  // todo mundo, a varredura entendeu "nao posso" e parou 7 dias em silencio.
  // Aqui ela volta pela porta autenticada, que chamarJob ja sabe abrir (o token
  // do consultor vai no cabecalho). A versao viaja junto pra tela de saude
  // conseguir dizer quem esta atrasado.
  if (msg && msg.type === 'varredura_pode') {
    let _vp = '';
    try { _vp = (chrome.runtime.getManifest() || {}).version || ''; } catch (e) {}
    chamarJob('/api/whatsapp/varredura/pode?versao=' + encodeURIComponent(_vp),
      'GET', null, 15000).then(sendResponse);
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
    if (_paraleloAtual && msg.planoChave) {
      _paraleloAtual.concluidos.add(String(msg.planoChave));
      try {
        _paraleloAtual.aoAndar(_paraleloAtual.concluidos.size, _paraleloAtual.total);
      } catch (e) {}
      return;
    }
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
              msg.type === 'cotador_modalidades' || msg.type === 'cotador_passo' ||
              msg.type === 'cotador_precos_paralelos')) {
    const oQuePedir =
      msg.type === 'cotar_painel'        ? { type: 'cotar_aqui', pedido: msg.pedido } :
      msg.type === 'cotador_cidades'     ? { type: 'cotador_cidades', termo: msg.termo } :
      msg.type === 'cotador_catalogo'    ? { type: 'cotador_catalogo', pedido: msg.pedido } :
      msg.type === 'cotador_modalidades' ? { type: 'cotador_modalidades', pedido: msg.pedido } :
      msg.type === 'cotador_precos_paralelos' ? { type: 'cotador_precos_paralelos', pedido: msg.pedido } :
      msg.type === 'cotador_passo'       ? { type: 'cotador_passo', pedido: msg.pedido } :
                                           { type: 'cotador_estado' };
    // Guarda quem pediu, pra devolver o andamento pra aba certa.
    // `cotador_passo` entrou na lista por causa da fila: o andamento dela
    // ("2 na frente") precisa achar a aba que pediu, e antes so o multicalculo
    // registrava isso.
    if ((msg.type === 'cotar_painel' || msg.type === 'cotador_catalogo' ||
         msg.type === 'cotador_passo' || msg.type === 'cotador_precos_paralelos') &&
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
      const pedirAoTrabalhador = () => _filaPedir(oQuePedir, (r) => {
        if (r) { sendResponse(r); return; }
        // Aqui so chega falha de rede: o servidor nao respondeu nada. Chamar
        // isso de 'painel_fechado' era o erro de diagnostico que mandava a
        // consultora abrir uma aba do Painel que nao resolveria nada.
        sendResponse({ ok: false, motivo: 'fila_sem_resposta',
                       abasExaminadas: (todas || []).length });
      });

      // SOMENTE O APARELHO MARCADO USA A PROPRIA SESSAO DO PAINEL.
      // Uma aba esquecida no computador de outro consultor nao pode desviar a
      // cotacao para um acesso que sera cancelado. Todos os demais aparelhos
      // enviam o pedido ao trabalhador central, mesmo que ainda tenham uma
      // sessao antiga aberta localmente.
      // Cidade é uma consulta somente leitura. Se este computador tem o
      // Painel aberto, usa a sessão local imediatamente mesmo enquanto o
      // sinal de trabalhador ainda está sendo renovado. Sem isso, a cidade
      // padrão parecia funcionar por já estar salva, mas qualquer outra
      // ficava presa na fila até o próximo heartbeat.
      if (!_souTrabalhador && msg.type !== 'cotador_cidades') {
        pedirAoTrabalhador();
        return;
      }
      if (msg.type === 'cotador_precos_paralelos' && lista.length) {
        _precosParalelosExecutar(msg.pedido || {}, (feito, total) => {
          if (_abaQuePediuCotacao == null) return;
          chrome.tabs.sendMessage(_abaQuePediuCotacao,
            { type: 'cotacao_andamento', fase: 'precos', feito: feito, total: total },
            () => { void chrome.runtime.lastError; });
        }).then(sendResponse).catch(() => sendResponse(
          { ok: false, motivo: 'falha_nas_frentes_de_preco' }));
        return;
      }
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
        pedirAoTrabalhador();
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
  // QUEM PERGUNTA E A TELA, PRA NAO OFERECER O QUE NAO PODE.
  //
  // So o aparelho marcado como trabalhador tem acesso ao Painel. A tela de
  // erro precisa saber disso ANTES de desenhar: oferecer "Abrir o Painel do
  // Corretor" pra quem nao tem acesso e ensinar a burlar o desenho.
  if (msg && msg.type === 'sou_trabalhador') {
    sendResponse({ ok: true, sou: !!_souTrabalhador });
    return false;
  }
  if (msg && msg.type === 'painel_abrir') {
    // A TRANCA DE VERDADE E AQUI, NAO NA TELA.
    //
    // Um desenho pode ser burlado; esta recusa nao. Numa maquina que nao e a
    // trabalhadora, a extensao nao abre nem foca o Painel do Corretor — e a
    // regra de nao reativar acesso de quem nao deve ter.
    if (!_souTrabalhador) {
      sendResponse({ ok: false, motivo: 'aparelho_nao_cota_no_painel' });
      return false;
    }
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
    // A abertura da ponte e um evento confiavel e barato: aproveita para
    // renovar o sinal e buscar trabalho sem esperar o alarme de um minuto.
    _rodadaDeFundo().catch(() => {});
    return false;
  }
  if (msg && msg.type === 'painel_fila_tick') {
    // SO A MAQUINA QUE COTA PERGUNTA POR TRABALHO.
    //
    // Uma consultora com uma aba do Painel esquecida disparava ~1.700
    // chamadas por hora a /fila/proximo que o servidor rejeitava na primeira
    // linha — trafego e log inuteis, e uma escuta a mais competindo pelas 4
    // threads do gunicorn. A linha 179 ja aplica esta mesma guarda ao
    // reagendamento; faltava na porta de entrada.
    if (!_souTrabalhador) return false;
    // A aba do Painel apenas acorda a extensao. A consulta vai ao JOB; nada e
    // clicado, lido ou requisitado no Painel ate existir uma cotacao real.
    // O sinal de trabalhador continua renovado pelo alarme, portanto este
    // caminho faz somente a retirada leve da fila.
    _trabalhadorTick();
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
