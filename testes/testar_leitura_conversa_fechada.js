const fs = require('fs');
const src = fs.readFileSync('extensao-whatsapp/wpp-bridge.js','utf8');
const i = src.indexOf('async function _mensagensDoChat');
const j = src.indexOf('\n  }\n', i) + 4;
const fn = src.slice(i, j).replace('async function _mensagensDoChat', 'async function');

function montar(cen){
  const ALVO='55199@c.us';
  const colecaoAtiva = Array.from({length:120},(_,k)=>({id:{_serialized:'A'+k}}));
  const colecaoFechada = [{id:{_serialized:'ultima'}}];        // o que o WhatsApp guarda de chat fechado
  const doGetMessages  = Array.from({length:80},(_,k)=>({id:{_serialized:'G'+k}}));
  global.window = { WPP: { chat: {
    getActiveChat: () => cen.abertaOutra ? {id:{_serialized:'OUTRA@c.us'}, msgs:{getModelsArray:()=>colecaoAtiva}}
                     : (cen.aberta ? {id:{_serialized:ALVO}, msgs:{getModelsArray:()=>colecaoAtiva}} : null),
    getMessages: cen.getMessagesQuebrada ? () => { throw new TypeError("reading 'get'"); }
               : (cen.semGetMessages ? undefined : async () => doGetMessages),
  }, whatsapp: { ChatStore: { get: () => ({ msgs: { getModelsArray: () => colecaoFechada } }) } } } };
  return eval('(' + fn + ')');
}
(async () => {
  const casos = [
    ['conversa ABERTA — usa a coleção (completa)',        {aberta:true},              120],
    ['conversa FECHADA — carrega com getMessages',        {},                          80],
    ['outra aberta, alvo fechado — não pega a errada',    {abertaOutra:true},          80],
    ['fechada + wa-js quebrada — cai pro que houver',     {getMessagesQuebrada:true},   1],
    ['aberta + wa-js quebrada — coleção salva',           {aberta:true,getMessagesQuebrada:true}, 120],
  ];
  let mau=0;
  for (const [nome,cen,esp] of casos){
    const f = montar(cen);
    const r = await f('55199@c.us', 400);
    const ok = r.length === esp;
    if(!ok) mau++;
    console.log((ok?'ok     ':'FALHOU ')+nome+' -> '+r.length+' msgs (esperado '+esp+')');
  }
  console.log('\nfalhas:', mau);
  process.exit(mau?1:0);
})();
