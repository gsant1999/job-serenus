// Tempo de resposta medido do HISTÓRICO, não de evento ao vivo.
//
// POR QUE ISTO EXISTE
//
// O `checarInbound` só marca "respondeu" enquanto a aba do WhatsApp está
// aberta. Consultor que responde pelo celular, ou depois de fechar o
// navegador, some da conta. Foi assim que a campanha #4 marcou 0% de resposta
// e ninguém soube dizer se a copy era ruim ou se a medição é que não via — e
// decisão de copy em cima de número errado é pior que decisão nenhuma.
//
// A medição agora vem do par "mensagem do cliente -> próxima minha" no
// histórico, então a resposta conta tenha ela saído de onde tiver.
//
// O que este teste trava é a MATEMÁTICA do pareamento, que é onde um erro
// silencioso vira número bonito e falso:
//
//  - rajada do cliente conta UMA espera, não uma por mensagem;
//  - conversa que eu comecei não é "resposta minha" a nada;
//  - conversa ainda sem resposta entra em "aguardando", não em tempo zero;
//  - resposta de 9 horas depois não é resposta, é recomeço de conversa;
//  - mediana e p95, nunca só média — uma conversa esquecida por 6h puxa a
//    média e faz um dia ruim parecer bom.
//
//   node testes/testar_tempo_resposta.js

const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync('extensao-whatsapp/wpp-bridge.js', 'utf8');
const i = src.indexOf('  const _RESP_TETO_MS');
const j = src.indexOf('  async function listarTodasConversas(');
if (i < 0 || j < 0) {
  console.error('FALHOU: não achei medirRespostas em wpp-bridge.js — reapontar o teste');
  process.exit(2);
}

const ctx = { console, Date, Math, Number };
vm.createContext(ctx);
vm.runInContext(src.slice(i, j), ctx);

let falhas = 0;
function checa(nome, cond, detalhe) {
  console.log((cond ? '  ok    ' : '  FALHA ') + nome + (!cond && detalhe ? `  << ${detalhe}` : ''));
  if (!cond) falhas++;
}

const HOJE = new Date();
HOJE.setHours(9, 0, 0, 0);
const base = Math.floor(HOJE.getTime() / 1000);
const seg = (n) => base + n;

// Monta uma conversa como o WhatsApp Web guarda: _models com {t, id:{fromMe}}
function chat(msgs, opts = {}) {
  return {
    id: { _serialized: (opts.id || '5519999990000') + '@c.us' },
    isGroup: !!opts.isGroup,
    msgs: { _models: msgs.map(([t, minha]) => ({ t, id: { fromMe: minha, _serialized: 'm' + t } })) },
  };
}

function medir(chats) {
  ctx.window = { WPP: { whatsapp: { ChatStore: { getModelsArray: () => chats } } } };
  return ctx.medirRespostas(0);
}

(async () => {
  console.log('\n1) O básico: uma pergunta, uma resposta');
  let r = await medir([chat([[seg(0), false], [seg(60), true]])]);
  checa('contou 1 resposta', r.respostas === 1, JSON.stringify(r));
  checa('mediu 60s', r.mediana_ms === 60000, `${r.mediana_ms}ms`);
  checa('ninguém ficou aguardando', r.aguardando === 0, `${r.aguardando}`);

  console.log('\n2) Rajada do cliente conta UMA espera, não cinco');
  r = await medir([chat([[seg(0), false], [seg(5), false], [seg(9), false], [seg(120), true]])]);
  checa('uma resposta só', r.respostas === 1, `${r.respostas}`);
  checa('conta desde a PRIMEIRA da rajada (120s)', r.mediana_ms === 120000, `${r.mediana_ms}ms`);

  console.log('\n3) Conversa que EU comecei não é resposta a nada');
  r = await medir([chat([[seg(0), true], [seg(30), true]])]);
  checa('nenhuma resposta contada', r.respostas === 0, `${r.respostas}`);
  checa('e não entra como aguardando', r.aguardando === 0, `${r.aguardando}`);

  console.log('\n4) Cliente esperando agora entra em "aguardando", não em tempo zero');
  r = await medir([chat([[seg(0), true], [seg(60), false]])]);
  checa('nenhuma resposta', r.respostas === 0, `${r.respostas}`);
  checa('marcou 1 aguardando', r.aguardando === 1, `${r.aguardando}`);
  checa('sabe há quanto tempo espera', r.mais_antiga_min >= 0, `${r.mais_antiga_min}`);

  console.log('\n5) O teto separa "resposta lenta" de "conversa nova"');
  // 9h é resposta RUIM, mas é resposta: tem que aparecer, senão o dia ruim
  // some da medição e o p95 fica bonito à custa da verdade.
  r = await medir([chat([[seg(0), false], [seg(9 * 3600), true]])]);
  checa('9h conta — é lenta, não inexistente', r.respostas === 1, `${r.respostas}`);
  // Acima de 12h já é o cliente voltando outro dia: contar isso como "tempo de
  // resposta" inventaria uma espera que ninguém viveu.
  r = await medir([chat([[seg(0), false], [seg(13 * 3600), true]])]);
  checa('13h não conta — é recomeço de conversa', r.respostas === 0, `${r.respostas}`);
  // E o cliente NÃO fica marcado como aguardando: eu respondi, ainda que
  // tarde. "Aguardando" é quem está sem resposta agora — misturar as duas
  // coisas inflaria a fila de espera com gente que já foi atendida.
  checa('quem já recebeu resposta não conta como aguardando', r.aguardando === 0, `${r.aguardando}`);

  console.log('\n6) Primeira resposta é medida à parte da conversa que segue');
  r = await medir([chat([[seg(0), false], [seg(30), true], [seg(100), false], [seg(400), true]])]);
  checa('duas respostas no total', r.respostas === 2, `${r.respostas}`);
  checa('só a primeira vira "primeira resposta"', r.primeira_mediana_ms === 30000, `${r.primeira_mediana_ms}ms`);

  console.log('\n7) Mediana e p95 — a média esconderia o dia ruim');
  r = await medir([
    chat([[seg(0), false], [seg(10), true]], { id: '5519000000001' }),
    chat([[seg(0), false], [seg(20), true]], { id: '5519000000002' }),
    chat([[seg(0), false], [seg(30), true]], { id: '5519000000003' }),
    chat([[seg(0), false], [seg(6 * 3600), true]], { id: '5519000000004' }),
  ]);
  checa('4 respostas', r.respostas === 4, `${r.respostas}`);
  checa('mediana não é puxada pelo caso extremo', r.mediana_ms === 25000, `${r.mediana_ms}ms`);
  checa('p95 mostra o extremo', r.p95_ms === 6 * 3600 * 1000, `${r.p95_ms}ms`);

  console.log('\n8) Grupo não entra na conta de atendimento');
  r = await medir([chat([[seg(0), false], [seg(60), true]], { isGroup: true })]);
  checa('grupo ignorado', r.conversas === 0, JSON.stringify(r));

  console.log('\n9) Sem WhatsApp carregado, diz o motivo em vez de mentir zero');
  ctx.window = { WPP: { whatsapp: {} } };
  r = await ctx.medirRespostas(0);
  checa('devolve erro, não medição vazia', !!r.erro, JSON.stringify(r));

  console.log();
  if (falhas) {
    console.log(`${falhas} FALHA(S)`);
    process.exit(1);
  }
  console.log('TEMPO DE RESPOSTA: a conta bate, e o que não é resposta não vira número.');
})();
