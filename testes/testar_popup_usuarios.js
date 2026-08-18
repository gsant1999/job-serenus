// Prova que o combo de usuário do popup carrega com QUALQUER forma de login,
// não só com a chave antiga (extKey).
//
// Achado em 18/08/2026: o Danilo não conseguia enviar mensagem, disparar
// funil nem salvar cotação. Os três leem `usuarioId` do storage e recusam com
// "Selecione seu usuário no popup" se estiver vazio — e esse campo só era
// preenchido no popup se `extKey` existisse. `entrar()` (login por e-mail e
// senha, o caminho atual) grava `extToken`, nunca `extKey`, e nunca chama
// `carregarUsuarios()` sozinho. Quem loga pelo jeito novo e não clica em
// "Testar conexão" abre o popup com o combo vazio pra sempre — nada pra
// selecionar, mesmo estando conectado.
//
//   node testes/testar_popup_usuarios.js

const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync('extensao-whatsapp/popup.js', 'utf8');

function cenario(storage) {
  const chamadas = { usuarios: 0 };
  const elementos = {};
  const elemento = (id) => {
    if (!elementos[id]) {
      elementos[id] = {
        id, value: '', textContent: '', className: '',
        style: {}, checked: false, innerHTML: '',
        addEventListener: () => {},
      };
    }
    return elementos[id];
  };
  const documentFake = { getElementById: elemento };
  const chromeFake = {
    storage: { local: { get: async () => storage, set: async () => {} } },
    runtime: {
      getManifest: () => ({ version: '9.9.9' }),
      sendMessage: async (msg) => {
        if (msg.type === 'usuarios') { chamadas.usuarios++; return { ok: true, usuarios: [] }; }
        if (msg.type === 'sessao_confere') return { valida: true };
        return { ok: true };
      },
      lastError: undefined,
    },
    tabs: { query: async () => [] },
  };
  const ctx = { chrome: chromeFake, document: documentFake, console };
  vm.createContext(ctx);
  // O arquivo termina com `carregar();` no top-level — deixa rodar sozinho,
  // e a chamada que ele faz (ou não) é o que este teste confere.
  vm.runInContext(src, ctx, { filename: 'popup.js' });
  return chamadas;
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const falhas = [];

  // 1) Login novo (extToken), sem extKey — o caso do Danilo. Antes da
  //    correção, o combo ficava vazio pra sempre; agora carrega.
  {
    const chamadas = cenario({ extToken: 'tok123', extUsuario: { nome: 'Danilo' } });
    await esperar(30);
    if (chamadas.usuarios < 1) {
      falhas.push('login por token não carregou a lista de usuários (o bug do Danilo)');
    }
  }

  // 2) Login antigo (extKey) — continua carregando, como sempre carregou.
  {
    const chamadas = cenario({ extKey: 'chaveXYZ' });
    await esperar(30);
    if (chamadas.usuarios < 1) {
      falhas.push('login por chave antiga deixou de carregar (regressão)');
    }
  }

  // 3) Sem login nenhum — não tenta carregar, não há com o que autenticar.
  {
    const chamadas = cenario({});
    await esperar(30);
    if (chamadas.usuarios !== 0) {
      falhas.push('tentou carregar usuários sem nenhuma credencial');
    }
  }

  if (falhas.length) {
    console.error(`FALHOU: ${falhas.length}`);
    falhas.forEach((f) => console.error(' -', f));
    process.exit(1);
  }
  console.log('POPUP: combo de usuário carrega com token, com chave, e não tenta sem nenhum dos dois');
}

main();
