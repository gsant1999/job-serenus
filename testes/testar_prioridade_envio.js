// Mensagem pro cliente não espera a varredura terminar.
//
// Três rotinas mexem no WhatsApp e não podem rodar juntas: mandar da fila, a
// varredura automática e a varredura em fila do CRM. A trava resolvia o
// travamento e criava outro problema — a varredura é LONGA (dezenas de
// conversas, uma por vez, com pausa) e o envio é curto e urgente. Enquanto ela
// rodava, a mensagem esperava.
//
// Em 18/08/2026 isso custou caro: quatro aberturas de lead pago ficaram paradas
// desde as 11h da manhã, com a varredura correndo atrás de 7 dias de atraso.
// Quatro pessoas pediram cotação e não receberam a primeira mensagem.
//
// Regra: quem tem pressa PEDE a vez, e a varredura cede entre uma conversa e
// outra. O teto de espera do envio deixa de ser "o tempo que a varredura levar"
// e passa a ser "uma conversa".
//
//   node testes/testar_prioridade_envio.js

const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync('extensao-whatsapp/content.js', 'utf8');
const i = src.indexOf('  const _JOB_GATE = {');
const j = src.indexOf('\n  // ═══════════════ Varredura diária', i);
if (i < 0 || j < 0) {
  console.error('FALHOU: não achei o bloco do gate em content.js — reapontar o teste');
  process.exit(2);
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(
  src.slice(i, j) +
  '\nthis.g = { tentar: _jobGateTentar, soltar: _jobGateSoltar, cederam: _jobGateCederam, estado: _JOB_GATE };',
  ctx
);
const g = ctx.g;

const falhas = [];
function checa(nome, cond, detalhe) {
  console.log((cond ? '  ok    ' : '  FALHA ') + nome + (!cond && detalhe ? `  << ${detalhe}` : ''));
  if (!cond) falhas.push(nome);
}

console.log('\n— A trava continua fazendo o que existia pra fazer');
g.soltar();
checa('a primeira rotina entra', g.tentar('varredura_auto') === true);
checa('a segunda não entra junto', g.tentar('varredura_fila') === false);
g.soltar();
checa('depois de soltar, a próxima entra', g.tentar('varredura_fila') === true);

console.log('\n— Envio pede a vez e a varredura sabe que precisa ceder');
g.soltar();
g.tentar('varredura_auto');
checa('varredura rodando, ninguém pediu ainda', g.cederam() === false);
checa('envio bate na porta e é recusado agora', g.tentar('envio') === false);
checa('mas a varredura passa a saber que tem alguém esperando', g.cederam() === true);
g.soltar();
checa('ao ceder, o pedido é zerado', g.cederam() === false);

console.log('\n— Envio direto (clique do consultor) tem o mesmo passe');
g.soltar();
g.tentar('varredura_auto');
g.tentar('envio_direto');
checa('clique explícito também fura a fila', g.cederam() === true);

console.log('\n— Rotina de fundo NÃO fura a fila de outra rotina de fundo');
g.soltar();
g.tentar('envio');
checa('envio rodando', g.estado.por === 'envio');
g.tentar('varredura_auto');
checa('varredura esperando não interrompe um envio em curso', g.cederam() === false,
      'varredura ganhou passe de urgência que não devia ter');
g.tentar('varredura_fila');
checa('nem a varredura em fila', g.cederam() === false);
g.tentar('sinc_lid_auto');
checa('nem a sincronização', g.cederam() === false);

console.log('\n— Vários pedidos não se perdem nem travam');
g.soltar();
g.tentar('varredura_auto');
g.tentar('envio');
g.tentar('envio');
g.tentar('envio_direto');
checa('três pedidos urgentes seguem pedindo a vez', g.cederam() === true);
g.soltar();
checa('um soltar zera todos os pedidos', g.cederam() === false);
checa('e a vez fica livre de verdade', g.tentar('envio') === true);

console.log();
if (falhas.length) {
  console.error(`FALHOU: ${falhas.length}`);
  falhas.forEach((f) => console.error(' -', f));
  process.exit(1);
}
console.log('PRIORIDADE DO ENVIO: mensagem pro cliente fura a fila da varredura (14 casos)');
