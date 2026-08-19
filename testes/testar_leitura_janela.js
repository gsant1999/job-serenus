// A leitura pede pouco e só aumenta quando precisa.
//
// Até 19/08/2026 a extensão pedia 120 mensagens com marca d'água e 400 sem, em
// rotina automática. Deu 41.203 mensagens carregadas na aba do Guilherme e
// ~1,2 GB de heap — o WhatsApp carrega e não devolve. WaSpeed pede 20 e
// ZapVoice 20; a diferença não era técnica, era apetite.
//
// Este teste prova as três peças do conserto sem depender do WhatsApp aberto:
//   1. marca d'água já na coleção -> não carrega NADA (o disabledAwaitHydrate deles)
//   2. marca fora da janela curta -> escalona sozinha em vez de desistir
//   3. marca que não existe em lugar nenhum -> continua mandando tudo (como antes)
//
//     node testes/testar_leitura_janela.js
const fs = require('fs');
const src = fs.readFileSync('extensao-whatsapp/wpp-bridge.js', 'utf8');

function trecho(assinatura) {
  const i = src.indexOf(assinatura);
  if (i < 0) throw new Error('não achei: ' + assinatura);
  return src.slice(i, src.indexOf('\n  }\n', i) + 4);
}

function msg(id, t) { return { id: { _serialized: id, fromMe: false }, type: 'chat', body: 'oi ' + id, t: t || 1 }; }

function montar(cen) {
  const pedidos = [];
  global.window = { WPP: { chat: {}, whatsapp: { ChatStore: { get: () => cen.colecao ? { msgs: { getModelsArray: () => cen.colecao } } : null } } } };
  const fab = new Function('_mensagensDoChat', '_dedupPorId', 'fmtHora', 'pedidos',
    trecho('function _janelaJaCarregada') + trecho('async function lerConversaDe') +
    '\nreturn lerConversaDe;');
  const buscar = async (chatId, quantas) => { pedidos.push(quantas); return cen.porPedido(quantas); };
  return { fn: fab(buscar, (a) => a, () => '10:00', pedidos), pedidos };
}

const universo = Array.from({ length: 500 }, (_, k) => msg('M' + k, k + 1));
const casos = [
  ['marca já na coleção — não carrega nada',
   { colecao: universo.slice(400), porPedido: () => universo.slice(-40) }, 'M450',
   (r, p) => r.sem_hidratar === true && p.length === 0],
  ['marca fora da janela curta — escalona',
   { colecao: null, porPedido: (q) => universo.slice(-q) }, 'M350',
   (r, p) => p[0] === 40 && p.length > 1 && r.sem_hidratar === false && r.total_janela > 0],
  ['marca inexistente — manda tudo, como antes',
   { colecao: null, porPedido: (q) => universo.slice(-q) }, 'NAO_EXISTE',
   (r, p) => p.length === 3 && r.total_janela === r.carregadas],
  ['primeira leitura (sem marca) — um pedido só',
   { colecao: null, porPedido: (q) => universo.slice(-q) }, null,
   (r, p) => p.length === 1 && p[0] === 150],
];

(async () => {
  let mau = 0;
  for (const [nome, cen, marca, conferir] of casos) {
    const { fn, pedidos } = montar(cen);
    const r = await fn('55199@c.us', marca, marca ? 40 : 150);
    const ok = !r.erro && conferir(r, pedidos);
    if (!ok) mau++;
    console.log((ok ? 'ok     ' : 'FALHOU ') + nome +
      '  -> pedidos: [' + pedidos.join(', ') + '] carregadas: ' + (r.carregadas || 0) +
      ' sem_hidratar: ' + r.sem_hidratar);
  }
  console.log('\nfalhas:', mau);
  process.exit(mau ? 1 : 0);
})();
