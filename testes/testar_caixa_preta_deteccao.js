// Prova que a caixa-preta so acusa morte quando a aba REALMENTE morreu.
//
// O risco desta feature nao e deixar de registrar um crash — e registrar um
// crash que nao houve. Se ela acusar morte quando a consultora so deu F5, ou
// quando existe outra janela do WhatsApp aberta, o banco enche de morte falsa e
// a medicao passa a mentir. Ai e pior do que nao medir: leva a mexer no lugar
// errado com numero na mao, que e exatamente o erro que o ROADMAP registra ter
// custado quase semanas na rodada anterior.
//
// Roda assim, da raiz do repositorio:  node testes/testar_caixa_preta_deteccao.js

const fs = require('fs');

const src = fs.readFileSync('extensao-whatsapp/content.js', 'utf8');
const i = src.indexOf('async function _cxVarrerMortes');
const j = src.indexOf('function _cxIniciar');
if (i < 0 || j < 0 || j <= i) {
  console.error('nao achei _cxVarrerMortes no content.js — o teste precisa ser atualizado junto');
  process.exit(1);
}
const fonte = src.slice(i, j);

const MINHA = 'jobRetrato:sMINHA';
const PERIODO = 30000;
const AGORA = Date.now();
const VELHO = AGORA - PERIODO * 5;   // passou dos 3 periodos: dona sumiu
const RECENTE = AGORA - PERIODO;     // dentro da janela: dona esta viva

function montar(armazem) {
  const enviados = [];
  const removidos = [];
  const chrome = { storage: { local: { remove: (ks) => { removidos.push.apply(removidos, ks); } } } };
  const f = new Function(
    '_CX_CHAVE', '_CX_PERIODO', '_safeStorageGet', '_safeSendMessage', 'chrome',
    fonte + '\nreturn _cxVarrerMortes;'
  )(
    MINHA, PERIODO,
    async () => armazem,
    async (m) => { enviados.push(m); return { ok: true }; },
    chrome
  );
  return { f, enviados, removidos };
}

const casos = [
  {
    nome: 'aba morreu sem se despedir (o caso do codigo de erro 5)',
    armazem: { 'jobRetrato:sMORTA': { sessao: 'sMORTA', limpo: false, ultimo_sinal: VELHO, heap_usado: 3.1e9 } },
    mortes: 1, removidas: ['jobRetrato:sMORTA'],
  },
  {
    nome: 'F5 ou fechar a aba: pagehide gravou limpo, nao e morte',
    armazem: { 'jobRetrato:sLIMPA': { sessao: 'sLIMPA', limpo: true, ultimo_sinal: VELHO, motivo: 'saida_limpa' } },
    mortes: 0, removidas: ['jobRetrato:sLIMPA'],
  },
  {
    nome: 'OUTRA JANELA DO WHATSAPP ABERTA AGORA: viva, nao pode virar morte',
    armazem: { 'jobRetrato:sVIVA': { sessao: 'sVIVA', limpo: false, ultimo_sinal: RECENTE } },
    mortes: 0, removidas: [],
  },
  {
    nome: 'extensao atualizada: o service worker marcou limpo, nao e morte',
    armazem: { 'jobRetrato:sUPD': { sessao: 'sUPD', limpo: true, ultimo_sinal: VELHO, motivo: 'extensao_atualizada' } },
    mortes: 0, removidas: ['jobRetrato:sUPD'],
  },
  {
    nome: 'navegador reiniciado: marcado pelo onStartup, nao e morte',
    armazem: { 'jobRetrato:sBOOT': { sessao: 'sBOOT', limpo: true, ultimo_sinal: VELHO, motivo: 'navegador_reiniciou' } },
    mortes: 0, removidas: ['jobRetrato:sBOOT'],
  },
  {
    nome: 'o proprio retrato desta aba nunca se acusa',
    armazem: { [MINHA]: { sessao: 'sMINHA', limpo: false, ultimo_sinal: VELHO } },
    mortes: 0, removidas: [],
  },
  {
    nome: 'chave de outra coisa no storage nao e tocada',
    armazem: { extKey: 'abc', usuarioId: 7, tema: 'escuro' },
    mortes: 0, removidas: [],
  },
  {
    nome: 'retrato corrompido sai do storage sem virar morte',
    armazem: { 'jobRetrato:sRUIM': 'isto nao e um objeto', 'jobRetrato:sNULO': null },
    mortes: 0, removidas: ['jobRetrato:sRUIM', 'jobRetrato:sNULO'],
  },
  {
    nome: 'uma morta e uma viva ao mesmo tempo: acusa so a morta',
    armazem: {
      'jobRetrato:sMORTA': { sessao: 'sMORTA', limpo: false, ultimo_sinal: VELHO },
      'jobRetrato:sVIVA': { sessao: 'sVIVA', limpo: false, ultimo_sinal: RECENTE },
      extKey: 'abc',
    },
    mortes: 1, removidas: ['jobRetrato:sMORTA'],
  },
  {
    nome: 'duas mortas em sequencia: as duas sao reportadas',
    armazem: {
      'jobRetrato:sM1': { sessao: 'sM1', limpo: false, ultimo_sinal: VELHO },
      'jobRetrato:sM2': { sessao: 'sM2', limpo: false, ultimo_sinal: VELHO - 100000 },
    },
    mortes: 2, removidas: ['jobRetrato:sM1', 'jobRetrato:sM2'],
  },
  {
    nome: 'retrato sem ultimo_sinal conta como velho (aba antiga, ja sumiu)',
    armazem: { 'jobRetrato:sSEM': { sessao: 'sSEM', limpo: false } },
    mortes: 1, removidas: ['jobRetrato:sSEM'],
  },
  {
    nome: 'storage vazio nao faz nada',
    armazem: {},
    mortes: 0, removidas: [],
  },
];

(async () => {
  let mau = 0;
  for (const c of casos) {
    const { f, enviados, removidos } = montar(c.armazem);
    let erro = null;
    try { await f(); } catch (e) { erro = e; }

    const mortes = enviados.filter((m) => m && m.type === 'aba_morreu').length;
    const remOk = removidos.length === c.removidas.length &&
      c.removidas.every((k) => removidos.indexOf(k) >= 0);
    const ok = !erro && mortes === c.mortes && remOk;

    if (!ok) mau++;
    console.log((ok ? '  ok   ' : '  FALHA ') + c.nome);
    if (!ok) {
      if (erro) console.log('        estourou: ' + erro.message);
      console.log('        mortes esperadas=' + c.mortes + ' obtidas=' + mortes);
      console.log('        removidas esperadas=' + JSON.stringify(c.removidas) +
                  ' obtidas=' + JSON.stringify(removidos));
    }
    // O retrato enviado tem que ser o da aba morta, com a memoria do instante
    // da morte — mandar a chave errada aqui tornaria o dado inutil.
    if (ok && mortes === 1) {
      const r = enviados[0].retrato || {};
      if (!r.sessao) { console.log('        FALHA: retrato foi sem a sessao'); mau++; }
    }
  }

  console.log('\n' + '='.repeat(62));
  console.log(casos.length + ' cenarios, ' + mau + ' falhas');
  if (mau) process.exit(1);
  console.log('deteccao de morte da aba: so acusa quando morreu de verdade');
})();
