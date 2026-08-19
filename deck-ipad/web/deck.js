/* Deck do JOB — a tela do iPad.
   Fala com o servidor que roda no MacBook. Toda ação tem reação imediata:
   trava o botão, mostra que está rodando e diz como terminou. */

const guardado = {
  get token() { return localStorage.getItem('deck_token') || ''; },
  set token(v) { localStorage.setItem('deck_token', v); },
  get pagina() { return localStorage.getItem('deck_pagina') || ''; },
  set pagina(v) { localStorage.setItem('deck_pagina', v); },
};

const el = (id) => document.getElementById(id);
const tela = {
  pareamento: el('pareamento'), deck: el('deck'), abas: el('abas'), grade: el('grade'),
  conexao: el('conexao'), avisoAcesso: el('aviso-acesso'), avisoConfig: el('aviso-config'),
  folha: el('folha'), cortina: el('cortina'), folhaTitulo: el('folha-titulo'),
  folhaTexto: el('folha-texto'), folhaSaida: el('folha-saida'), folhaAcoes: el('folha-acoes'),
  folhaConfirmar: el('folha-confirmar'), pin: el('pin'), erroPin: el('erro-pin'),
};

let config = { paginas: [] };
let paginaAtual = '';
let ultimaExecucaoPorBotao = {};   // id do botão -> id da execução disparada aqui
let saidaPorBotao = {};            // id do botão -> última saída completa
let ultimaSaidaVista = null;
let relogio = null;
let confirmando = null;

/* --------------------------------------------------------------- icones */

const D = {
  raio: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  conversa: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.9-.9L3 20.5l1.5-4.4A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z"/>',
  banco: '<path d="M3 21h18M5 21V10M19 21V10M9 21V10M15 21V10M12 3l9 5H3z"/>',
  olho: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  lupa: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.35-4.35"/>',
  engrenagem: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.2A1.7 1.7 0 0 0 7.1 19.7l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3.1 14H3a2 2 0 1 1 0-4h.2A1.7 1.7 0 0 0 4.3 7.1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.2a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.2a1.7 1.7 0 0 0-1.4 1z"/>',
  tela: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>',
  nuvem: '<path d="M18 17h-.7a4.5 4.5 0 1 0-1.6-8.7A6.5 6.5 0 1 0 6 16.5"/><path d="M12 21v-9M9 15l3-3 3 3"/>',
  microfone: '<rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 19v3"/>',
  'microfone-mudo': '<rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 19v3M3 3l18 18"/>',
  volume: '<path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>',
  cadeado: '<rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l2-3h8l2 3h3a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  janela: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>',
  terminal: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 9l3 3-3 3M13 15h5"/>',
  pasta: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  texto: '<path d="M4 7V5h16v2M9 19h6M12 5v14"/>',
};

function icone(nome) {
  return `<svg class="icone" width="24" height="24" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${D[nome] || D.raio}</svg>`;
}

/* ------------------------------------------------------------ servidor */

async function chamar(rota, opcoes = {}) {
  const r = await fetch(rota, {
    ...opcoes,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${guardado.token}`,
      ...(opcoes.headers || {}),
    },
  });
  if (r.status === 401) { mostrarPareamento(); throw new Error('nao pareado'); }
  return r.json();
}

/* ---------------------------------------------------------- pareamento */

function mostrarPareamento() {
  tela.deck.hidden = true;
  tela.pareamento.hidden = false;
  tela.pin.focus();
  pararRelogio();
}

el('parear').addEventListener('click', async () => {
  const pin = tela.pin.value.trim();
  if (pin.length !== 4) { erroPin('Digite os quatro dígitos que aparecem na janela do Mac.'); return; }
  try {
    const r = await fetch('/api/parear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    }).then((x) => x.json());
    if (r.token) {
      guardado.token = r.token;
      tela.erroPin.hidden = true;
      tela.pareamento.hidden = true;
      tela.deck.hidden = false;
      iniciar();
    } else {
      erroPin(r.erro || 'Não consegui ligar este iPad ao Mac.');
    }
  } catch {
    erroPin('O Mac não respondeu. Confira se o deck está ligado nele.');
  }
});

tela.pin.addEventListener('input', () => {
  tela.pin.value = tela.pin.value.replace(/\D/g, '').slice(0, 4);
  tela.erroPin.hidden = true;
});

function erroPin(texto) {
  tela.erroPin.textContent = texto;
  tela.erroPin.hidden = false;
}

/* --------------------------------------------------------------- telas */

function desenharAbas() {
  tela.abas.innerHTML = '';
  config.paginas.forEach((p) => {
    const b = document.createElement('button');
    b.className = 'aba';
    b.type = 'button';
    b.textContent = p.nome;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(p.id === paginaAtual));
    b.addEventListener('click', () => {
      paginaAtual = p.id;
      guardado.pagina = p.id;
      desenharAbas();
      desenharGrade();
      acelerarRelogio();
    });
    tela.abas.appendChild(b);
  });
}

function desenharGrade() {
  const pagina = config.paginas.find((p) => p.id === paginaAtual) || config.paginas[0];
  tela.grade.innerHTML = '';
  if (!pagina) return;
  tela.grade.className = 'grade';
  pagina.botoes.forEach((botao) => {
    tela.grade.appendChild(
      botao.controle === 'deslizante' ? montarDeslizante(botao) : montarTijolo(botao),
    );
  });
}

function montarTijolo(botao) {
  const b = document.createElement('button');
  b.className = 'tijolo';
  b.type = 'button';
  b.dataset.botao = botao.id;
  if (botao.cuidado) b.dataset.cuidado = '1';
  b.innerHTML = `
    ${icone(botao.icone)}
    <span class="rotulo">${escapar(botao.rotulo)}</span>
    <span class="dica">${escapar(botao.dica || '')}</span>
    <span class="selo"></span>
    <span class="andamento"></span>`;
  b.addEventListener('click', () => tocar(botao, b));
  return b;
}

function montarDeslizante(botao) {
  const d = document.createElement('div');
  d.className = 'tijolo deslizante';
  d.dataset.botao = botao.id;
  d.innerHTML = `
    <span class="linha-icone">
      ${icone(botao.icone)}
      <span class="rotulo">${escapar(botao.rotulo)}</span>
      <span class="valor">--</span>
    </span>
    <input type="range" min="${botao.minimo}" max="${botao.maximo}" step="${botao.passo}"
           value="${botao.minimo}" aria-label="${escapar(botao.rotulo)}">
    <span class="dica">${escapar(botao.dica || '')}</span>`;
  const faixa = d.querySelector('input');
  const valor = d.querySelector('.valor');
  faixa.addEventListener('input', () => { valor.textContent = faixa.value + (botao.unidade || ''); });
  faixa.addEventListener('change', () => {
    chamar(`/api/acao/${botao.id}`, {
      method: 'POST',
      body: JSON.stringify({ valor: Number(faixa.value) }),
    }).catch(() => {});
  });
  return d;
}

function escapar(texto) {
  const d = document.createElement('div');
  d.textContent = texto;
  return d.innerHTML;
}

/* ---------------------------------------------------------------- toque */

function tocar(botao, tijolo) {
  if (tijolo.dataset.estado === 'rodando') return;
  if (tijolo.dataset.estado === 'falhou') { verSaida(botao); return; }
  if (botao.confirmar) { pedirConfirmacao(botao, tijolo); return; }
  disparar(botao, tijolo);
}

async function disparar(botao, tijolo) {
  marcar(tijolo, 'rodando', 'rodando');
  try {
    const r = await chamar(`/api/acao/${botao.id}`, { method: 'POST' });
    if (r.erro) { marcar(tijolo, 'falhou', 'falhou'); saidaPorBotao[botao.id] = r.erro; return; }
    ultimaExecucaoPorBotao[botao.id] = r.execucao;
    acelerarRelogio();
  } catch {
    marcar(tijolo, 'falhou', 'falhou');
    saidaPorBotao[botao.id] = 'O Mac não respondeu. Confira se o deck continua ligado nele.';
  }
}

function marcar(tijolo, estado, selo) {
  if (!tijolo) return;
  tijolo.dataset.estado = estado;
  const s = tijolo.querySelector('.selo');
  if (s) s.textContent = selo || '';
}

function tijoloDe(botaoId) {
  return tela.grade.querySelector(`[data-botao="${botaoId}"]`);
}

function botaoDe(botaoId) {
  for (const p of config.paginas) {
    const achado = p.botoes.find((b) => b.id === botaoId);
    if (achado) return achado;
  }
  return null;
}

/* --------------------------------------------------------------- folha */

function abrirFolha({ titulo, texto, saida, confirmar, risco }) {
  tela.folhaTitulo.textContent = titulo;
  tela.folhaTexto.textContent = texto || '';
  tela.folhaTexto.hidden = !texto;
  tela.folhaSaida.textContent = saida || '';
  tela.folhaSaida.hidden = !saida;
  tela.folhaAcoes.hidden = !confirmar;
  if (confirmar) {
    tela.folhaConfirmar.textContent = confirmar;
    tela.folhaConfirmar.classList.toggle('risco', Boolean(risco));
  }
  tela.cortina.hidden = false;
  tela.folha.hidden = false;
  requestAnimationFrame(() => {
    tela.cortina.classList.add('aberta');
    tela.folha.classList.add('aberta');
  });
  if (saida) tela.folhaSaida.scrollTop = tela.folhaSaida.scrollHeight;
}

function fecharFolha() {
  confirmando = null;
  tela.cortina.classList.remove('aberta');
  tela.folha.classList.remove('aberta');
  setTimeout(() => { tela.folha.hidden = true; tela.cortina.hidden = true; }, 280);
}

el('fechar-folha').addEventListener('click', fecharFolha);
el('folha-cancelar').addEventListener('click', fecharFolha);
tela.cortina.addEventListener('click', fecharFolha);

tela.folhaConfirmar.addEventListener('click', () => {
  const pedido = confirmando;
  fecharFolha();
  if (pedido) disparar(pedido.botao, pedido.tijolo);
});

function pedirConfirmacao(botao, tijolo) {
  confirmando = { botao, tijolo };
  abrirFolha({
    titulo: botao.rotulo,
    texto: botao.confirmar,
    confirmar: botao.rotulo,
    risco: botao.cuidado,
  });
}

function verSaida(botao) {
  abrirFolha({
    titulo: botao.rotulo,
    saida: saidaPorBotao[botao.id] || 'Sem saída guardada para este botão.',
  });
}

el('ver-registro').addEventListener('click', () => {
  if (!ultimaSaidaVista) {
    abrirFolha({ titulo: 'Última saída', texto: 'Nenhum botão foi tocado ainda nesta sessão.' });
    return;
  }
  abrirFolha({ titulo: ultimaSaidaVista.rotulo, saida: ultimaSaidaVista.saida || 'Sem saída.' });
});

el('como-liberar').addEventListener('click', () => {
  abrirFolha({
    titulo: 'Liberar o teclado do Mac',
    texto: 'No MacBook: menu Apple > Ajustes do Sistema > Privacidade e Segurança > '
      + 'Acessibilidade. Ligue a chave do Terminal (ou do aplicativo de onde o deck foi '
      + 'iniciado) e ligue o deck de novo. Sem isso, o Mac bloqueia qualquer programa que '
      + 'tente apertar teclas por você.',
  });
});

el('recarregar').addEventListener('click', async () => {
  const r = await chamar('/api/recarregar', { method: 'POST' }).catch(() => null);
  if (!r) return;
  if (r.erro) { tela.avisoConfig.textContent = r.erro; tela.avisoConfig.hidden = false; return; }
  aplicarConfig(r.config);
});

/* -------------------------------------------------------------- relogio */

function pararRelogio() { if (relogio) { clearTimeout(relogio); relogio = null; } }

function agendar(ms) {
  pararRelogio();
  relogio = setTimeout(bater, ms);
}

function acelerarRelogio() { agendar(400); }

async function bater() {
  if (document.hidden) { agendar(3000); return; }
  try {
    const estado = await chamar('/api/estado');
    aplicarEstado(estado);
    conexao(true);
    agendar(algoRodando(estado) ? 900 : 4000);
  } catch {
    conexao(false);
    agendar(3000);
  }
}

function algoRodando(estado) {
  return (estado.execucoes || []).some((e) => e.estado === 'rodando');
}

function conexao(ligado) {
  tela.conexao.textContent = ligado
    ? 'Ligado ao MacBook'
    : 'Sem conexão com o MacBook. Confira se o deck continua ligado nele.';
  tela.conexao.classList.toggle('caiu', !ligado);
}

function aplicarEstado(estado) {
  (estado.execucoes || []).forEach((exe) => {
    if (ultimaExecucaoPorBotao[exe.botao] !== exe.id) return;
    saidaPorBotao[exe.botao] = exe.saida;
    const tijolo = tijoloDe(exe.botao);
    if (exe.estado === 'rodando') { marcar(tijolo, 'rodando', 'rodando'); return; }

    ultimaSaidaVista = { rotulo: exe.rotulo, saida: exe.saida };
    delete ultimaExecucaoPorBotao[exe.botao];

    if (exe.estado === 'pronto') {
      marcar(tijolo, 'pronto', `pronto ${exe.duracao}s`);
      setTimeout(() => { if (tijolo && tijolo.dataset.estado === 'pronto') marcar(tijolo, '', ''); }, 2400);
    } else if (exe.estado === 'cancelado') {
      marcar(tijolo, '', '');
    } else {
      marcar(tijolo, 'falhou', 'falhou');
      const dica = tijolo && tijolo.querySelector('.dica');
      if (dica) dica.textContent = 'Falhou. Toque para ver o que aconteceu.';
    }
  });

  Object.entries(estado.alternaveis || {}).forEach(([id, ligado]) => {
    const tijolo = tijoloDe(id);
    const botao = botaoDe(id);
    if (!tijolo || !botao) return;
    tijolo.dataset.ligado = ligado ? '1' : '0';
    const rotulo = tijolo.querySelector('.rotulo');
    if (rotulo) rotulo.textContent = ligado ? botao.rotulo_ligado : botao.rotulo;
    const svg = tijolo.querySelector('svg');
    if (svg) svg.innerHTML = (ligado ? D[botao.icone_ligado] : D[botao.icone]) || D.raio;
  });

  Object.entries(estado.deslizantes || {}).forEach(([id, valor]) => {
    const tijolo = tijoloDe(id);
    if (!tijolo) return;
    const faixa = tijolo.querySelector('input[type="range"]');
    const mostrador = tijolo.querySelector('.valor');
    const botao = botaoDe(id);
    if (!faixa || document.activeElement === faixa) return;
    faixa.value = valor;
    if (mostrador) mostrador.textContent = Math.round(valor) + ((botao && botao.unidade) || '');
  });

  tela.avisoAcesso.hidden = estado.acessibilidade !== false;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  acelerarRelogio();
  baterWhatsapp(true);   // voltou pra tela: o nome da conversa não pode estar velho
});

/* -------------------------------------------------------------- partida */

function aplicarConfig(nova) {
  config = nova;
  tela.avisoConfig.hidden = !nova.erro;
  if (nova.erro) tela.avisoConfig.textContent = nova.erro;
  const guardada = guardado.pagina;
  paginaAtual = config.paginas.some((p) => p.id === guardada)
    ? guardada
    : (config.paginas[0] || {}).id || '';
  desenharAbas();
  desenharGrade();
}

async function iniciar() {
  try {
    aplicarConfig(await chamar('/api/config'));
    conexao(true);
    bater();
  } catch {
    conexao(false);
  }
}

if (guardado.token) {
  tela.deck.hidden = false;
  iniciar();
} else {
  mostrarPareamento();
}
