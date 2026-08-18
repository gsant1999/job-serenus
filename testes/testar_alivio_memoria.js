// Prova que o alivio automatico de memoria nao perde nada.
//
// Quando a aba encosta em 75% do teto, a extensao despeja os proprios caches em
// vez de pedir F5 pra consultora. Isso so e aceitavel porque tudo que ela guarda
// e refazivel — mas duas coisas NAO podem acontecer:
//
//   1. despejar trabalho EM ANDAMENTO (audio transcrevendo, documento sendo
//      lido, analise rodando): o trabalho se perderia de verdade;
//   2. zerar os logos sem zerar o `_cotLogosLidos`, que e o guarda de recarga —
//      a cotacao ficaria sem logo ate o F5, ou seja, exatamente a funcionalidade
//      perdida que a regra do projeto proibe.
//
// Roda assim, da raiz do repositorio:  node testes/testar_alivio_memoria.js

const fs = require('fs');
const src = fs.readFileSync('extensao-whatsapp/content.js', 'utf8');

function fatiar(de, ate, rotulo) {
  const i = src.indexOf(de);
  const j = src.indexOf(ate, i + 1);
  if (i < 0 || j < 0 || j <= i) {
    console.error('nao achei ' + rotulo + ' no content.js — o teste precisa ser atualizado junto');
    process.exit(1);
  }
  return src.slice(i, j);
}

// As funcoes REAIS: se o _capMap mudar, este teste sente.
const fonteCapMap = fatiar('function _capMap(', '  // Set não tem o que priorizar', '_capMap');
const fonteCapSet = fatiar('function _capSet(', '  const _TETO_ANALISES', '_capSet');
const fonteAliviar = fatiar('function _cxAliviar(', '  // Varre os retratos que ficaram para tr', '_cxAliviar');

function montar() {
  const TR = {
    cache: new Map([['a', 'texto'], ['ocupado1', 'parcial'], ['b', 'texto']]),
    erro: new Map([['e1', 'falhou']]),
    ocupado: new Set(['ocupado1']),
  };
  const DOC = {
    estado: new Map([
      ['d1', { status: 'pronto' }],
      ['d2', { status: 'lendo' }],   // EM ANDAMENTO
    ]),
  };
  const _analises = new Map([
    ['a1', { status: 'ok' }],
    ['a2', { status: 'rodando' }],   // EM ANDAMENTO
  ]);
  const _cvCache = new Map([['img1', {}], ['img2', {}]]);
  const _cotLogos = { 'logo_op:amil': 'data:image/png;base64,AAA', 'logo_op:sulamerica': 'data:...' };
  const _enviosRecentes = new Map([['x', 1]]);
  const _chatsVistos = new Set(['c1', 'c2']);

  const metricas = [];
  const gravados = [];
  let pendente = null;

  const corpo =
    fonteCapMap + '\n' + fonteCapSet + '\n' +
    'let _cotLogosLidos = true;\n' +
    fonteAliviar + '\n' +
    'return { aliviar: _cxAliviar, lidos: () => _cotLogosLidos };';

  const api = new Function(
    'TR', 'DOC', '_analises', '_cvCache', '_cotLogos', '_enviosRecentes', '_chatsVistos',
    '_registrarTimeout', '_metrica', '_cxGravar', '_CX_NASCEU', 'window',
    corpo
  )(
    TR, DOC, _analises, _cvCache, _cotLogos, _enviosRecentes, _chatsVistos,
    (fn) => { pendente = fn; return 1; },
    (op, ms, ok, det) => metricas.push({ op, ms, ok, det }),
    (limpo, motivo) => gravados.push(motivo),
    Date.now() - 3600000,
    // O heap LIDO DEPOIS da limpeza. Fica alto de proposito: e o cenario em que
    // soltar tudo o que era nosso nao resolveu — justamente o que precisa virar
    // registro, porque prova que a memoria nao esta na extensao.
    { performance: { memory: { usedJSHeapSize: 3_700_000_000, jsHeapSizeLimit: 4_000_000_000 } } }
  );

  return { api, TR, DOC, _analises, _cvCache, _cotLogos, _enviosRecentes, _chatsVistos,
           metricas, gravados, correrPendente: () => pendente && pendente() };
}

const testes = [];
function teste(nome, fn) { testes.push([nome, fn]); }

teste('despeja transcricoes ja prontas', (c) => !c.TR.cache.has('a') && !c.TR.cache.has('b'));
teste('PROTEGE o audio que esta transcrevendo agora', (c) => c.TR.cache.has('ocupado1'));
teste('despeja documento ja lido', (c) => !c.DOC.estado.has('d1'));
teste('PROTEGE o documento sendo lido agora', (c) => c.DOC.estado.has('d2'));
teste('despeja analise concluida', (c) => !c._analises.has('a1'));
teste('PROTEGE a analise rodando agora', (c) => c._analises.has('a2'));
teste('despeja as imagens decodificadas da cotacao', (c) => c._cvCache.size === 0);
teste('despeja os logos (data URL, o item mais pesado)', (c) => Object.keys(c._cotLogos).length === 0);
teste('RELIGA a recarga dos logos (senao a cotacao perde a imagem)',
      (c) => c.api.lidos() === false);
teste('limpa os conjuntos de deduplicacao', (c) => c._enviosRecentes.size === 0 && c._chatsVistos.size === 0);

teste('mede e reporta quanto soltou', (c) => {
  c.correrPendente();
  const m = c.metricas.find((x) => x.op === 'alivio_memoria');
  return !!m && /MB para .*MB, \d+ itens/.test(m.det || '');
});
teste('acusa quando continua no limite mesmo depois de soltar tudo', (c) => {
  c.correrPendente();
  return !!c.metricas.find((x) => x.op === 'aba_no_limite_apos_alivio' && x.ok === false);
});
teste('nao estoura quando um cache ainda nem existe', (c) => {
  // Simula o boot no meio: alguns caches ainda nao foram criados.
  let erro = null;
  try {
    const c2 = montar();
    c2.TR.cache = null; c2._cvCache = null;
    c2.api.aliviar({ usedJSHeapSize: 1e9, jsHeapSizeLimit: 4e9 });
  } catch (e) { erro = e; }
  return erro === null;
});

let mau = 0;
for (const [nome, fn] of testes) {
  const c = montar();
  // O heap depois fica ALTO de proposito nos dois testes de metrica: e o cenario
  // em que a limpeza nao resolveu, que e o que precisa virar registro.
  c.api.aliviar({ usedJSHeapSize: 3_800_000_000, jsHeapSizeLimit: 4_000_000_000 });
  let ok = false, erro = null;
  try { ok = !!fn(c); } catch (e) { erro = e; }
  if (!ok) mau++;
  console.log((ok ? '  ok   ' : '  FALHA ') + nome + (erro ? ' [estourou: ' + erro.message + ']' : ''));
}

console.log('\n' + '='.repeat(62));
console.log(testes.length + ' verificacoes, ' + mau + ' falhas');
if (mau) process.exit(1);
console.log('alivio de memoria: limpa o que da pra refazer, preserva o que esta em curso');
