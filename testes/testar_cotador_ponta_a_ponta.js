// Roda o cotador-painel.js DE VERDADE contra um servidor falso que devolve as
// respostas reais capturadas no Painel do Corretor.
//
// Os testes em Python conferem os parsers isoladamente. Este confere o resto:
// que o aprendizado dos hashes chega, que a sequência criar → operadoras →
// planos → preço funciona, que o diff sequencial amarra cada preço ao plano
// certo, e que o resultado sai ordenado e sem furo.
//
//   node testes/testar_cotador_ponta_a_ponta.js
//
// Precisa do arquivo de captura em ~/Downloads/mapa-painel-v2.json.

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const CAPTURA = path.join(process.env.HOME, 'Downloads', 'mapa-painel-v2.json');
const COTADOR = path.join(__dirname, '..', 'extensao-whatsapp', 'cotador-painel.js');
const ORIGEM = 'https://beta.paineldocorretor.com.br';

if (!fs.existsSync(CAPTURA)) {
  console.log('PULADO: nao achei ' + CAPTURA);
  process.exit(0);
}
const captura = JSON.parse(fs.readFileSync(CAPTURA, 'utf8'));

// ── separar as respostas reais por papel ──────────────────────────────────
function papelDe(c) {
  if (typeof c.enviou !== 'string') return null;
  let d;
  try { d = JSON.parse(c.enviou); } catch (e) { return null; }
  if (!Array.isArray(d) || !d.length) return null;
  if (/\/cotacoes\/nova$/.test(c.url) && typeof (d[0] || {}).titulo === 'string') return 'criar';
  if (d.length === 1 && typeof d[0] === 'string') return 'abrir';
  if (d.length === 1 && d[0].cotacaoId && Array.isArray(d[0].vidas)) return 'vidas';
  if (d.length === 1 && d[0].filtro) return 'operadoras';
  if (d.length === 1 && d[0].operadoraId) return 'planos';
  if (d.length === 2 && typeof d[0] === 'string' && d[1].key) return 'preco';
  if (d.length === 2 && typeof d[0] === 'string' && d[1].cidade) return 'filtro';
  return null;
}

const porPapel = { criar: [], abrir: [], vidas: [], filtro: [],
                   operadoras: [], planos: [], preco: [] };
const hashes = {};       // papel -> hash, só pra rotear o servidor falso
const aprendido = {};    // papel -> {hash, arvore}, do jeito que o cotador guarda
captura.chamadas.forEach((c) => {
  const p = papelDe(c);
  if (!p) return;
  porPapel[p].push(c);
  hashes[p] = c.cabecalhos['next-action'];
  aprendido[p] = aprendido[p] || { hash: c.cabecalhos['next-action'],
                                   arvore: c.cabecalhos['next-router-state-tree'] || null };
});

// O servidor falso: responde pelo hash, na ordem em que a captura registrou.
const chamou = { criar: 0, abrir: 0, vidas: 0, filtro: 0, operadoras: 0, planos: 0, preco: 0 };
const corposEnviados = [];
function servidorFalso(url, cfg) {
  const hash = cfg.headers['next-action'];
  const papel = Object.keys(hashes).find((k) => hashes[k] === hash);
  if (!papel) throw new Error('hash desconhecido no teste: ' + hash);
  corposEnviados.push({ papel, url, corpo: JSON.parse(cfg.body), cab: cfg.headers });
  const lista = porPapel[papel];
  const c = lista[Math.min(chamou[papel], lista.length - 1)];
  chamou[papel]++;
  return Promise.resolve({
    ok: true, status: 200, url: ORIGEM + url,
    text: () => Promise.resolve(c.resposta),
  });
}

// ── janela de mentira, só com o que o cotador usa ─────────────────────────
//
// A janela precisa ser montada DENTRO do contexto da VM, não fora.
// O cotador faz `ev.source !== window` pra ignorar mensagem de terceiro; se a
// janela for um objeto de fora, o `window` de dentro é outra identidade e a
// checagem derruba tudo — o cotador ficava mudo e o teste só dava tempo
// esgotado, sem dizer por quê.
const caixa = {
  console,
  setImmediate,
  // Sem espera de verdade: o respiro é proposital em produção e só atrasaria
  // o teste. O que importa aqui é a ordem das chamadas, não o relógio.
  __fetch: (url, cfg) => servidorFalso(String(url).replace(ORIGEM, ''), cfg),
  __origem: ORIGEM,
};
vm.createContext(caixa);
vm.runInContext(`
  var window = globalThis;
  var self = globalThis;
  var location = { origin: __origem };
  var __ouvintes = [];
  var __recebidas = [];
  window.addEventListener = function (tipo, fn) { if (tipo === 'message') __ouvintes.push(fn); };
  window.postMessage = function (dados) {
    __recebidas.push(dados);
    // Entrega assíncrona, como no navegador — se fosse síncrona o teste
    // esconderia problema de ordem que só aparece de verdade.
    setImmediate(function () {
      __ouvintes.slice().forEach(function (fn) {
        try { fn({ source: window, data: dados }); } catch (e) { console.error(e); }
      });
    });
  };
  window.setTimeout = function (fn) { setImmediate(fn); return 0; };
  window.clearTimeout = function () {};
  window.fetch = function (url, cfg) { return __fetch(url, cfg); };
`, caixa, { filename: 'ambiente-de-teste.js' });

vm.runInContext(fs.readFileSync(COTADOR, 'utf8'), caixa, { filename: 'cotador-painel.js' });

// Fala com o cotador de dentro do contexto, pra manter a identidade de window.
const enviar = vm.runInContext('(function (d) { window.postMessage(d); })', caixa);
const ouvir = vm.runInContext('(function (fn) { window.addEventListener("message", fn); })', caixa);
const chavesDaJanela = () => vm.runInContext('Object.keys(globalThis)', caixa);

// ── testes ────────────────────────────────────────────────────────────────
let falhas = 0;
const ok = (cond, nome, extra) => {
  console.log((cond ? 'PASSA  ' : 'FALHA  ') + nome + (extra ? '  ' + extra : ''));
  if (!cond) falhas++;
};

function perguntar(tipo, pedido, msLimite) {
  return new Promise((resolve, reject) => {
    const reqId = 'teste-' + tipo + '-' + Math.random();
    const relogio = setTimeout(() => reject(new Error('nao respondeu: ' + tipo)), msLimite || 20000);
    ouvir((ev) => {
      const d = ev.data;
      if (d && d.source === 'JOB_COTADOR' && d.tipo === 'resposta' && d.reqId === reqId) {
        clearTimeout(relogio);
        resolve(d);
      }
    });
    enviar({ source: 'JOB_COTADOR_BRIDGE', tipo, reqId, pedido });
  });
}

(async () => {
  // 1. Sem hash aprendido, recusa em vez de tentar e errar
  const semAprender = await perguntar('cotar', { cidade: 'São Paulo - SP', vidas: [{ faixa: '29-33', quantidade: 10 }] });
  ok(semAprender.ok === false && semAprender.motivo === 'precisa_aprender',
     '1. sem hash aprendido, recusa cotar', JSON.stringify(semAprender.faltando));

  // 2. Recebe os hashes guardados e passa a se declarar pronto
  enviar({ source: 'JOB_COTADOR_BRIDGE', tipo: 'restaurar', dados: aprendido });
  await new Promise((r) => setImmediate(r));
  const estado = await perguntar('estado');
  ok(estado.ok && estado.pronto === true, '2. depois de restaurar, fica pronto',
     'faltando=' + JSON.stringify(estado.faltando));

  // 3. A cotação inteira roda e devolve preço
  const r = await perguntar('cotar', {
    cidade: 'São Paulo - SP',
    vidas: [{ faixa: '29-33', quantidade: 10 }],
    operadoraIds: [93],
    maxPlanos: 5,
  }, 40000);
  ok(r.ok === true, '3. a cotacao completa roda', r.motivo || '');
  const dados = r.dados || {};
  ok(dados.cotacaoId === '019fc330-c810-79f3-a00f-8004ecd1a841',
     '3b. usa o id da cotacao criada', dados.cotacaoId);
  ok(Array.isArray(dados.planos) && dados.planos.length === 5,
     '3c. cotou os 5 planos pedidos', 'planos=' + (dados.planos || []).length);

  // 4. Cada plano saiu com preço, e nenhum saiu com preço de outro
  const totais = (dados.planos || []).map((p) => p.total);
  ok(totais.every((t) => typeof t === 'number' && t > 0), '4. todo plano tem total',
     JSON.stringify(totais));
  ok(new Set(totais).size === totais.length, '4b. nenhum total repetido entre planos');
  ok(totais.slice().sort((a, b) => a - b).join() === totais.join(),
     '4c. sai ordenado do mais barato', JSON.stringify(totais));

  // 5. O detalhamento por faixa veio inteiro e fecha com o total
  const comFaixa = (dados.planos || []).filter((p) => (p.faixas || []).length);
  ok(comFaixa.length === (dados.planos || []).length, '5. todo plano tem detalhamento por faixa');
  ok(comFaixa.every((p) => p.faixas.length === 10), '5b. as 10 faixas em todos');
  ok(dados.suspeitos === 0, '5c. nenhum plano suspeito', 'suspeitos=' + dados.suspeitos);

  // 6. O que foi ENVIADO ao servidor deles tem o formato certo
  const envCriar = corposEnviados.find((c) => c.papel === 'criar');
  ok(envCriar && envCriar.corpo[0].titulo === 'Cotação',
     '6. titulo padrao deles, sem etiqueta nossa', JSON.stringify(envCriar.corpo));
  const envPreco = corposEnviados.filter((c) => c.papel === 'preco');
  ok(envPreco.every((c) => c.corpo[0] === dados.cotacaoId && c.corpo[1].key),
     '6b. preco manda o id certo e a key do plano');
  ok(envPreco.every((c) => c.cab['next-router-state-tree'] &&
                           c.cab['next-router-state-tree'].includes(dados.cotacaoId)),
     '6c. a arvore de rotas foi reapontada pro id novo');

  // 7. Nenhum cabeçalho nosso vazou pro servidor deles
  const permitidos = ['accept', 'content-type', 'next-action', 'next-router-state-tree'];
  const intrusos = [...new Set(corposEnviados.flatMap((c) => Object.keys(c.cab)))]
    .filter((k) => !permitidos.includes(k));
  ok(intrusos.length === 0, '7. nenhum cabecalho nosso na chamada', JSON.stringify(intrusos));

  // 8. Nada visível pendurado na janela
  const chaves = chavesDaJanela();
  ok(!chaves.includes('__jcp') && !chaves.includes('JOBCOTADOR'),
     '8. nada nosso aparece no console da pagina',
     'chaves suspeitas=' + JSON.stringify(chaves.filter((k) => /job|jcp|cotador/i.test(k))));

  // 10. A busca de operadoras nao cria cotacao nova nem sai pedindo preco
  const criouAntes = chamou.criar;
  const precoAntes = chamou.preco;
  const so = await perguntar('cotar', {
    cidade: 'São Paulo - SP', vidas: [{ faixa: '29-33', quantidade: 10 }], somenteOperadoras: true,
  }, 20000);
  ok(so.ok && (so.dados.operadoras || []).length > 5, '10. lista operadoras da cidade',
     (so.dados && so.dados.operadoras || []).length + ' operadoras');
  ok(chamou.criar === criouAntes, '10b. reaproveita a cotacao, nao cria outra',
     'criadas no total=' + chamou.criar);
  ok(chamou.preco === precoAntes, '10c. nao pede preco de nada');

  // 9. Cidade faltando é erro claro, não cotação vazia
  const semCidade = await perguntar('cotar', { vidas: [{ faixa: '29-33', quantidade: 1 }] });
  ok(semCidade.ok === false && semCidade.motivo === 'sem_cidade',
     '9. sem cidade, erro claro', semCidade.motivo);

  // 11. A SEQUENCIA que faltava: criar -> abrir -> vidas, antes de qualquer preco.
  //     Era isto que faltava e fazia TODO preco voltar http_500: o servidor deles
  //     nao recebe as vidas no pedido de preco, ele le da cotacao.
  const ordem = corposEnviados.map((c) => c.papel);
  ok(ordem[0] === 'criar' && ordem[1] === 'abrir' && ordem[2] === 'vidas',
     '11. grava as vidas na cotacao logo apos criar', ordem.slice(0, 4).join(' -> '));
  const iVidas = ordem.indexOf('vidas'), iPreco = ordem.indexOf('preco');
  ok(iVidas >= 0 && iVidas < iPreco, '11b. as vidas entram ANTES do primeiro preco',
     'vidas=' + iVidas + ' preco=' + iPreco);
  const iFiltro = ordem.indexOf('filtro');
  ok(iFiltro >= 0 && iFiltro < iPreco, '11c. a cidade tambem e gravada antes do preco',
     'filtro=' + iFiltro);
  const envVidas = corposEnviados.find((c) => c.papel === 'vidas');
  ok(envVidas && envVidas.corpo[0].cotacaoId === dados.cotacaoId &&
     Array.isArray(envVidas.corpo[0].vidas) && envVidas.corpo[0].vidas.length > 0,
     '11d. manda as vidas certas, na cotacao certa',
     JSON.stringify(envVidas ? envVidas.corpo[0].vidas : null));


  // 12. As DEZ faixas, sempre. A tela deles manda a distribuicao completa; meia
  //     distribuicao deixa a cotacao num estado que a tela deles nunca produz.
  const vs = envVidas ? envVidas.corpo[0].vidas : [];
  ok(vs.length === 10, '12. manda as dez faixas, inclusive as zeradas', vs.length + ' faixas');
  ok(vs.filter((f) => f.quantidade > 0).length === 1 &&
     vs.filter((f) => f.faixa === '29-33')[0].quantidade === 10,
     '12b. a quantidade cai na faixa certa');
  const envFiltro = corposEnviados.find((c) => c.papel === 'operadoras');
  ok(envFiltro && envFiltro.corpo[0].filtro.vidas.length === 10,
     '12c. a busca de operadoras tambem manda as dez');


  console.log('\n' + (falhas ? falhas + ' FALHA(S)' : 'tudo passou'));
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error('EXPLODIU:', e); process.exit(1); });
