// Prova que _mensagensDoChat sobrevive à wa-js quebrada.
const fs = require('fs');
const src = fs.readFileSync('extensao-whatsapp/wpp-bridge.js', 'utf8');
const i = src.indexOf('async function _mensagensDoChat');
const j = src.indexOf('function _colecaoDaConversa');
const fn = src.slice(i, j);

function montar(cenario) {
  const chatId = '55199@c.us';
  const colecao = [{ id: { _serialized: 'A' } }, { id: { _serialized: 'B' } }];
  global.window = { WPP: { chat: {
    getActiveChat: () => cenario.semChatAtivo ? null
      : { id: { _serialized: cenario.outroChat ? 'OUTRO@c.us' : chatId },
          msgs: cenario.colecaoVazia ? { getModelsArray: () => [] }
                                     : { getModelsArray: () => colecao } },
    getMessages: cenario.getMessagesQuebrada
      ? () => { throw new TypeError("Cannot read properties of undefined (reading 'get')"); }
      : (cenario.semGetMessages ? undefined : async () => [{ id: { _serialized: 'S1' } }]),
  }, whatsapp: { ChatStore: { get: () => cenario.storeTem
      ? { msgs: { getModelsArray: () => [{ id: { _serialized: 'Z' } }] } } : null } } } };
  return eval('(' + fn.replace('async function _mensagensDoChat', 'async function') + ')');
}

(async () => {
  const casos = [
    ['wa-js quebrada, coleção cheia (o caso de hoje)', { getMessagesQuebrada: true }, 2],
    ['wa-js quebrada e coleção vazia',                 { getMessagesQuebrada: true, colecaoVazia: true }, 0],
    ['tudo funcionando',                               {}, 2],
    ['coleção vazia, wa-js ok (histórico não rolado)', { colecaoVazia: true }, 1],
    ['getMessages nem existe mais',                    { semGetMessages: true }, 2],
    ['chat aberto é OUTRO — não pode devolver o errado',{ outroChat: true, semGetMessages: true }, 0],
    ['chat aberto é outro, mas o Store tem',           { outroChat: true, storeTem: true, semGetMessages: true }, 1],
  ];
  let mau = 0;
  for (const [nome, cen, esperado] of casos) {
    const f = montar(cen);
    let r;
    try { r = await f('55199@c.us', 200); } catch (e) { r = 'ESTOUROU: ' + e.message; }
    const n = Array.isArray(r) ? r.length : r;
    const ok = n === esperado;
    if (!ok) mau++;
    console.log((ok ? 'ok     ' : 'FALHOU ') + nome + ' -> ' + n + ' msg(s), esperado ' + esperado);
  }
  console.log('\nfalhas:', mau);
  process.exit(mau ? 1 : 0);
})();
