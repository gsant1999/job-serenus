// A extensão e o servidor têm que ler acomodação do MESMO jeito.
//
// Em 18/08/2026 elas divergiram: o servidor foi corrigido para entender
// acomodação vinda como 1/0 (JSON não manda booleano do Python), a extensão
// não. Resultado, na mesma cotação 83: o documento do site mostrava
// "Enfermaria / Enfermaria / Apartamento" e a imagem desenhada pela extensão
// — que usa a cópia dela da regra — saía com a linha "Acomodação" em branco.
// O consultor mandava pro cliente a versão muda.
//
// Este teste roda a função real da extensão, extraída do arquivo, contra a
// mesma tabela-verdade que `testes/testar_acomodacao_documento.py` usa do lado
// do servidor. Se alguém consertar um lado sozinho de novo, isto quebra.
//
//   node testes/testar_acomodacao_extensao.js

const fs = require('fs');
const vm = require('vm');

const src = fs.readFileSync('extensao-whatsapp/content.js', 'utf8');
const i = src.indexOf('  function _cotAcomod(pl) {');
const j = src.indexOf('\n  function _cotEtiquetas(', i);
if (i < 0 || j < 0) {
  console.error('FALHOU: não achei _cotAcomod em content.js — o teste precisa ser reapontado');
  process.exit(2);
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(src.slice(i, j) + '\nthis._cotAcomod = _cotAcomod;', ctx);
const _cotAcomod = ctx._cotAcomod;

const falhas = [];
function caso(rotulo, plano, esperado) {
  const veio = _cotAcomod(plano);
  if (veio === esperado) {
    console.log(`  ok    ${rotulo.padEnd(46)} -> ${JSON.stringify(veio)}`);
  } else {
    console.log(`  FALHA ${rotulo.padEnd(46)} -> ${JSON.stringify(veio)}, esperava ${JSON.stringify(esperado)}`);
    falhas.push(rotulo);
  }
}

console.log('\n— O que a base do JOB e o Painel mandam');
caso('texto da base do JOB', { acomodacaoTxt: 'Enfermaria' }, 'Enfermaria');
caso('texto livre não vira Apartamento/Enfermaria', { acomodacao: 'Ambulatorial' }, 'Ambulatorial');
caso('booleano verdadeiro', { acomodacao: true }, 'Apartamento');
caso('booleano falso', { acomodacao: false }, 'Enfermaria');

console.log('\n— O buraco que esvaziou a linha na imagem da cotação');
caso('número 1 (JSON, não é booleano)', { acomodacao: 1 }, 'Apartamento');
caso('número 0 (JSON, não é booleano)', { acomodacao: 0 }, 'Enfermaria');

console.log('\n— Vazio só quando é honesto');
caso('campo ausente', {}, '');
caso('string vazia sem alternativa', { acomodacaoTxt: '' }, '');
caso('o "$undefined" que o Painel manda', { acomodacao: '$undefined' }, '');
caso('plano nulo não derruba', null, '');

console.log('\n— acomodacaoTxt tem precedência sobre acomodacao');
caso('texto ganha do booleano', { acomodacaoTxt: 'Ambulatorial', acomodacao: true }, 'Ambulatorial');
caso('texto vazio cede a vez pro número', { acomodacaoTxt: '', acomodacao: 1 }, 'Apartamento');

console.log();
if (falhas.length) {
  console.error(`FALHOU: ${falhas.length}`);
  falhas.forEach((f) => console.error(' -', f));
  process.exit(1);
}
console.log('ACOMODAÇÃO NA EXTENSÃO: lê igual ao servidor (12 casos)');
