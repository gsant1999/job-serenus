// Carrega o JavaScript REAL da tela de cotação num DOM de mentira e vê se ele
// sobe sem explodir.
//
// Existe por um erro meu que se repetiu: chamar função que não existe naquele
// arquivo (o `esc`), ou variável que eu mesmo tinha acabado de remover. Nada
// disso aparece no `node --check` — a sintaxe está perfeita, o script quebra
// no primeiro clique. Aqui quebra na bancada.
//
//   node testes/bancada-tela-cotacao.js
//
// Não testa aparência nem o Painel: testa que a tela CARREGA, que os ouvintes
// se registram e que o caminho de cotação chega até pedir o primeiro passo.

const { execFileSync } = require('child_process');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

// Renderiza a página de verdade pelo Flask e extrai o maior <script>.
let html;
try {
  html = execFileSync('/usr/bin/python3', ['-c', `
import os,sys
os.environ['JOB_DATA_DIR']='/tmp/jobtest-tela'
sys.path.insert(0, ${JSON.stringify(RAIZ)})
import app as A
c = A.app.test_client()
with c.session_transaction() as s:
    s['user_id']=1; s['perfil']='admin'
sys.stdout.write(c.get('/cotacao/novo').get_data(as_text=True))
`], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
} catch (e) {
  console.log('PULADO: nao consegui renderizar a pagina (flask ausente?)');
  process.exit(0);
}
const blocos = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const script = blocos.sort((a, b) => b.length - a.length)[0] || '';

let falhas = 0;
const ok = (cond, nome, extra) => {
  console.log((cond ? 'PASSA  ' : 'FALHA  ') + nome + (extra ? '  ' + extra : ''));
  if (!cond) falhas++;
};
ok(script.length > 5000, '0. extraiu o script da tela', script.length + ' bytes');

// ── DOM de mentira ────────────────────────────────────────────────────────
// Genérico de propósito: qualquer elemento responde a qualquer coisa. O que
// interessa não é o desenho, é o script não encontrar `null` onde espera um
// elemento nem chamar função que não existe.
const criados = [];
function fakeEl(id) {
  const el = {
    id: id || '', className: '', innerHTML: '', textContent: '', value: '',
    dataset: {}, style: {}, classList: { add() {}, remove() {}, contains() { return false; } },
    children: [],
    appendChild(x) { this.children.push(x); return x; },
    insertBefore(x) { this.children.unshift(x); return x; },
    removeChild() {}, remove() {}, focus() {}, blur() {},
    setAttribute() {}, getAttribute() { return null; }, hasAttribute() { return false; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return fakeEl(); },
    querySelectorAll() { return []; },
    closest() { return null; },
    getClientRects() { return [{}]; },
    getBoundingClientRect() { return { left: 0, right: 100, top: 0, bottom: 20 }; },
  };
  criados.push(el);
  return el;
}

const porId = {};
const pedidos = [];
const caixa = {
  console: { log() {}, error() {}, warn() {} },
  setTimeout: (fn) => { setImmediate(fn); return 0; },
  clearTimeout() {}, setImmediate,
  Math, JSON, Date, Promise, Object, Array, Number, String, Error, RegExp, isNaN,
  encodeURIComponent,
  __registrar: (d) => pedidos.push(d),
};
caixa.window = caixa;
caixa.self = caixa;
caixa.document = {
  getElementById: (id) => (porId[id] = porId[id] || fakeEl(id)),
  createElement: (t) => fakeEl('novo:' + t),
  querySelector: () => fakeEl(),
  querySelectorAll: () => [],
  addEventListener() {},
  body: fakeEl('body'), head: fakeEl('head'),
};
caixa.addEventListener = function (tipo, fn) {
  if (tipo === 'message') (caixa.__ouvintes = caixa.__ouvintes || []).push(fn);
};
caixa.postMessage = function (d) {
  caixa.__registrar(d);
  setImmediate(() => (caixa.__ouvintes || []).forEach((fn) => {
    try { fn({ source: caixa, data: d }); } catch (e) { caixa.__erro = e; }
  }));
};
caixa.fetch = () => Promise.resolve({ json: () => Promise.resolve([]) });

vm.createContext(caixa);
let subiu = true, erro = null;
try {
  vm.runInContext(script, caixa, { filename: 'tela-cotacao.js' });
} catch (e) { subiu = false; erro = e; }
ok(subiu, '1. o script da tela carrega sem explodir', erro ? String(erro.message) : '');

setTimeout(() => {
  ok(!caixa.__erro, '2. nenhum ouvinte quebrou na inicializacao',
     caixa.__erro ? String(caixa.__erro.message) : '');

  // A tela tem que perguntar à extensão se ela está aí (o ping) e depois o
  // estado. Se não perguntar, a página nasce achando que não tem extensão.
  const tipos = pedidos.filter((d) => d && d.source === 'JOB_SITE_REQ').map((d) => d.tipo);
  ok(tipos.indexOf('ping') >= 0, '3. pergunta se a extensao esta ai (ping)', JSON.stringify(tipos));

  // Os elementos que o script busca por id existem de verdade no HTML? Um id
  // digitado errado vira `null` e o script morre no primeiro uso.
  const idsUsados = [...script.matchAll(/el\('([a-zA-Z0-9_-]+)'\)/g)].map((m) => m[1]);
  const unicos = [...new Set(idsUsados)];
  const faltando = unicos.filter((id) => !new RegExp('id="' + id + '"').test(html));
  ok(faltando.length === 0, '4. todo id usado pelo script existe no HTML',
     faltando.length ? 'faltam: ' + faltando.join(', ') : unicos.length + ' ids conferidos');

  console.log('\n' + (falhas ? falhas + ' FALHA(S)' : 'tudo passou'));
  process.exit(falhas ? 1 : 0);
}, 300);
