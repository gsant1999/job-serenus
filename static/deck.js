/* Deck do JOB — a tela de envio pelo iPad.
   Nasceu do deck local (deck-ipad/), mas aqui não há PIN nem endereço de IP:
   quem autentica é a sessão do JOB. O que não mudou é quem envia — a extensão,
   na conversa que está aberta no Chrome deste consultor. */

const el = (id) => document.getElementById(id);
const tela = {
  conexao: el('conexao'), topo: el('zap-topo'), lista: el('zap-lista'),
  busca: el('zap-busca'), secoes: el('zap-secoes'),
  folha: el('folha'), cortina: el('cortina'), folhaTitulo: el('folha-titulo'),
  folhaTexto: el('folha-texto'), folhaAcoes: el('folha-acoes'),
  folhaConfirmar: el('folha-confirmar'),
};

let zap = { consultado: false, ligada: false, chat: null, rascunho: [],
            modelos: [], funis: [], comandos: [] };
let zapSecao = localStorage.getItem('deck_zap_secao') || 'mensagens';
let zapBusca = '';
// null = todas as pastas; '' = os que não estão em pasta nenhuma; texto = a pasta.
// Antes isto usava um caractere nulo como sentinela: funcionava e era ilegível,
// e ilegível em condição de filtro é bug esperando acontecer.
let zapPasta = null;
let zapEsperando = null;   // { id, chave } do comando que este iPad disparou
let confirmando = null;

/* ------------------------------------------------------------- servidor */

async function chamar(rota, opcoes) {
  const r = await fetch(rota, Object.assign({
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
  }, opcoes || {}));
  if (r.status === 401 || r.redirected) { location.href = '/login'; throw new Error('sessao'); }
  return r.json();
}

function escapar(texto) {
  const d = document.createElement('div');
  d.textContent = texto == null ? '' : texto;
  return d.innerHTML;
}

/* ------------------------------------------------------------- a tela */

function pintar() {
  tela.secoes.querySelectorAll('.zap-secao').forEach((b) => {
    b.setAttribute('aria-selected', String(b.dataset.secao === zapSecao));
  });
  tela.busca.hidden = (zapSecao === 'funis' ? zap.funis.length : zap.modelos.length) < 8;

  if (!zap.consultado) {
    tela.topo.dataset.estado = 'pronto';
    tela.topo.innerHTML = '<span class="zap-pulso"></span><div>'
      + '<p class="zap-rot">Procurando a extensão</p>'
      + '<p class="zap-motivo" style="color:var(--texto-fraco)">Perguntando quem está na conversa.</p></div>';
    pintarLista();
    return;
  }
  const parado = motivoDeNaoEnviar();
  tela.topo.dataset.estado = parado ? 'parado' : 'pronto';
  tela.topo.innerHTML = parado
    ? '<span class="zap-pulso"></span><div><p class="zap-rot">Sem conversa para enviar</p>'
      + '<p class="zap-motivo">' + escapar(parado) + '</p></div>'
    : '<span class="zap-pulso"></span><div style="flex:1;min-width:0">'
      + '<p class="zap-rot">Vai para a conversa aberta no computador</p>'
      + '<h2 class="zap-nome">' + escapar(zap.chat.nome || 'Conversa sem nome salvo') + '</h2>'
      + rascunhoHtml() + '</div>';
  pintarLista();
}

// As últimas falas da conversa. Nome no topo não basta: duas Marias existem, a
// conversa não — e é ela que diz se você está prestes a disparar no lugar certo.
function rascunhoHtml() {
  const falas = zap.rascunho || [];
  if (!falas.length) {
    return '<div class="zap-conversa"><p class="vazio">Sem mensagens de texto recentes '
         + 'nesta conversa.</p></div>';
  }
  return '<div class="zap-conversa">' + falas.map((f) =>
    '<div class="zap-fala" data-de="' + (f.de === 'consultor' ? 'consultor' : 'lead') + '">'
    + escapar(f.texto)
    + (f.hora ? '<span class="hora">' + escapar(f.hora) + '</span>' : '')
    + '</div>').join('') + '</div>';
}

// A condição que governa a tela, dita com todas as letras — e com o que fazer.
function motivoDeNaoEnviar() {
  if (!zap.consultado) return 'Ainda perguntando ao computador.';
  if (!zap.ligada) {
    return 'A extensão do JOB não está falando com o deck. Abra o WhatsApp Web no '
         + 'Chrome do computador (e clique na aba uma vez).';
  }
  if (!zap.chat) {
    return 'Nenhuma conversa aberta no WhatsApp Web. Abra a conversa do cliente e '
         + 'ela aparece aqui.';
  }
  return '';
}

function pintarLista() {
  const travado = Boolean(motivoDeNaoEnviar());
  pintarPastas();
  let base = zapSecao === 'funis' ? zap.funis : zap.modelos;
  if (zapSecao !== 'funis' && zapPasta !== null) {
    base = base.filter((m) => (m.pasta || '') === zapPasta);
  }
  const itens = zapSecao === 'funis'
    ? filtrar(base, (f) => String(f.nome || '').toLowerCase())
    : filtrar(base, (m) => [m.titulo, m.texto, m.categoria, m.pasta].join(' ').toLowerCase());

  if (!itens.length) {
    tela.lista.innerHTML = '<p class="zap-vazio">' + escapar(textoDeListaVazia()) + '</p>';
    return;
  }
  tela.lista.innerHTML = '';
  itens.forEach((item) => tela.lista.appendChild(
    zapSecao === 'funis' ? cartaoFunil(item, travado) : cartaoModelo(item, travado)));
}

// A biblioteca tem centenas de itens; sem pasta, achar um áudio no iPad é
// rolagem infinita. As pastas só aparecem quando existe mais de uma — uma linha
// de filtro com uma opção só é ruído.
function pintarPastas() {
  const caixa = el('zap-pastas');
  if (zapSecao === 'funis') { caixa.hidden = true; return; }
  const pastas = [...new Set(zap.modelos.map((m) => m.pasta || '').filter(Boolean))].sort();
  if (pastas.length < 2) { caixa.hidden = true; zapPasta = null; return; }
  caixa.hidden = false;
  const semPasta = zap.modelos.some((m) => !(m.pasta || ''));
  const opcoes = [{ id: null, nome: 'Todas' }]
    .concat(pastas.map((n) => ({ id: n, nome: n })))
    .concat(semPasta ? [{ id: '', nome: 'Sem pasta' }] : []);
  caixa.innerHTML = '';
  opcoes.forEach((o) => {
    const b = document.createElement('button');
    b.className = 'zap-pasta';
    b.type = 'button';
    b.textContent = o.nome;
    b.setAttribute('aria-pressed', String(zapPasta === o.id));
    b.addEventListener('click', () => { zapPasta = o.id; pintarLista(); });
    caixa.appendChild(b);
  });
}

function textoDeListaVazia() {
  if (zapBusca) return 'Nada com esse nome na biblioteca.';
  if (zapPasta !== null) return 'Nenhuma mensagem nesta pasta.';
  if (!zap.consultado) return 'Carregando a biblioteca.';
  if (!zap.ligada) return 'A biblioteca aparece quando a extensão se conectar.';
  return zapSecao === 'funis'
    ? 'Nenhum funil cadastrado ainda. Monte um em Funis.'
    : 'Nenhuma mensagem na biblioteca ainda.';
}

function filtrar(itens, comoBuscar) {
  if (!zapBusca) return itens;
  return itens.filter((i) => comoBuscar(i).indexOf(zapBusca) >= 0);
}

const ROTULO_MIDIA = { audio: 'Áudio', imagem: 'Imagem', video: 'Vídeo', documento: 'PDF' };

function cartaoModelo(m, travado) {
  const b = document.createElement('button');
  b.className = 'zap-card';
  b.type = 'button';
  b.dataset.chave = 'modelo:' + m.id;
  b.disabled = travado;
  b.innerHTML = '<span class="zap-chip">' + escapar(ROTULO_MIDIA[m.midia_tipo] || 'Texto') + '</span>'
    + '<span class="zap-titulo">' + escapar(m.titulo || 'Sem título') + '</span>'
    + '<span class="zap-previa">' + escapar(m.texto || (m.midia_tipo ? 'Sem legenda' : '')) + '</span>';
  b.addEventListener('click', () => confirmarModelo(m, b));
  return b;
}

function cartaoFunil(f, travado) {
  const passos = f.passos || [];
  const total = passos.reduce((s, p) => s + (Number(p.delay_segundos) || 0), 0);
  const b = document.createElement('button');
  b.className = 'zap-card';
  b.type = 'button';
  b.dataset.chave = 'funil:' + f.id;
  b.disabled = travado;
  b.innerHTML = '<span class="zap-chip">' + passos.length
      + (passos.length === 1 ? ' mensagem' : ' mensagens') + '</span>'
    + '<span class="zap-titulo">' + escapar(f.nome || 'Funil sem nome') + '</span>'
    + '<span class="zap-previa">' + escapar(total ? 'Termina ' + duracao(total) : 'Tudo de uma vez') + '</span>';
  b.addEventListener('click', () => confirmarFunil(f, b));
  return b;
}

function duracao(seg) {
  if (seg < 60) return 'em ' + seg + 's';
  if (seg < 3600) return 'em cerca de ' + Math.round(seg / 60) + ' min';
  return 'em cerca de ' + (Math.round(seg / 360) / 10).toString().replace('.', ',') + ' h';
}

function quandoDoPasso(acumulado) {
  if (!acumulado) return 'na hora';
  if (acumulado < 60) return acumulado + 's depois';
  return Math.round(acumulado / 60) + ' min depois';
}

/* --------------------------------------------------------------- folha */

function abrirFolha(o) {
  tela.folhaTitulo.textContent = o.titulo;
  desenharMidia(o.midia);
  tela.folhaTexto.textContent = o.texto || '';
  tela.folhaTexto.hidden = !o.texto;
  desenharLista(o.lista);
  tela.folhaAcoes.hidden = !o.confirmar;
  if (o.confirmar) tela.folhaConfirmar.textContent = o.confirmar;
  tela.cortina.hidden = false;
  tela.folha.hidden = false;
  requestAnimationFrame(() => {
    tela.cortina.classList.add('aberta');
    tela.folha.classList.add('aberta');
  });
}

// Ouvir o áudio ANTES de mandar. Áudio errado não tem desfazer do outro lado —
// e no iPad, sem player, o consultor só descobre qual era depois de enviar.
function desenharMidia(midia) {
  let caixa = el('folha-midia');
  if (!midia || !midia.url) {
    if (caixa) { caixa.innerHTML = ''; caixa.remove(); }
    return;
  }
  if (!caixa) {
    caixa = document.createElement('div');
    caixa.id = 'folha-midia';
    caixa.className = 'zap-midia';
    tela.folhaTitulo.parentElement.insertAdjacentElement('afterend', caixa);
  }
  if (midia.tipo === 'audio') {
    caixa.innerHTML = '<audio controls preload="none" src="' + escapar(midia.url) + '"></audio>';
  } else if (midia.tipo === 'imagem') {
    caixa.innerHTML = '<img alt="" src="' + escapar(midia.url) + '">';
  } else {
    caixa.innerHTML = '<p class="arquivo">' + escapar(ROTULO_MIDIA[midia.tipo] || 'Arquivo')
      + ' — vai anexado à mensagem</p>';
  }
}

// Passos do funil: o consultor precisa ver o que vai sair e quando, antes de
// mandar. Uma sequência disparada às cegas é a definição de mensagem errada.
function desenharLista(itens) {
  let ul = el('folha-lista');
  if (!itens || !itens.length) { if (ul) ul.remove(); return; }
  if (!ul) {
    ul = document.createElement('ul');
    ul.id = 'folha-lista';
    ul.className = 'zap-passos';
    tela.folhaTexto.insertAdjacentElement('afterend', ul);
  }
  ul.innerHTML = itens.map((i) =>
    '<li><span class="quando">' + escapar(i.quando) + '</span><span>' + escapar(i.texto) + '</span></li>').join('');
}

function fecharFolha() {
  confirmando = null;
  desenharMidia(null);   // sem isto o áudio continua tocando com a folha fechada
  tela.cortina.classList.remove('aberta');
  tela.folha.classList.remove('aberta');
  setTimeout(() => { tela.folha.hidden = true; tela.cortina.hidden = true; }, 280);
}

function confirmarModelo(m, card) {
  const nome = zap.chat.nome || 'a conversa aberta';
  confirmando = { tipo: 'modelo', id: m.id, chave: card.dataset.chave };
  abrirFolha({
    titulo: m.titulo || 'Enviar mensagem',
    midia: m.midia_tipo ? { tipo: m.midia_tipo, url: m.midia_url } : null,
    texto: m.texto || (m.midia_tipo ? ROTULO_MIDIA[m.midia_tipo] + ' sem legenda.' : ''),
    confirmar: 'Enviar para ' + nome,
  });
}

function confirmarFunil(f, card) {
  const nome = zap.chat.nome || 'a conversa aberta';
  const passos = f.passos || [];
  let acumulado = 0;
  const lista = passos.map((p, i) => {
    acumulado += Number(p.delay_segundos) || 0;
    return { quando: quandoDoPasso(acumulado),
             texto: (i + 1) + '. ' + (ROTULO_MIDIA[p.tipo] || 'Texto') };
  });
  confirmando = { tipo: 'funil', id: f.id, chave: card.dataset.chave };
  abrirFolha({
    titulo: f.nome || 'Disparar funil',
    midia: null,
    texto: passos.length + (passos.length === 1 ? ' mensagem' : ' mensagens') + ' para ' + nome
         + (acumulado ? ', ' + duracao(acumulado) + '.' : ', tudo agora.'),
    lista,
    confirmar: 'Disparar para ' + nome,
  });
}

/* --------------------------------------------------------------- envio */

async function disparar(pedido) {
  const card = tela.lista.querySelector('[data-chave="' + pedido.chave + '"]');
  if (card) { card.dataset.estado = 'indo'; card.disabled = true; }
  try {
    const r = await chamar('/api/deck/comando', {
      method: 'POST',
      body: JSON.stringify({ tipo: pedido.tipo, id: pedido.id }),
    });
    if (r.erro) { recado(r.erro, 'erro'); soltarCard(pedido.chave); return; }
    zapEsperando = { id: r.comando.id, chave: pedido.chave, em: Date.now() };
    recado('Mandando para ' + r.para + '…', 'espera');
    bater(true);
  } catch (e) {
    if (String(e.message) === 'sessao') return;
    recado('O JOB não respondeu. Confira a conexão e tente de novo.', 'erro');
    soltarCard(pedido.chave);
  }
}

function soltarCard(chave) {
  const card = tela.lista.querySelector('[data-chave="' + chave + '"]');
  if (card) { delete card.dataset.estado; card.disabled = Boolean(motivoDeNaoEnviar()); }
}

/* O recado do último envio. Some sozinho quando deu certo; fica quando não deu,
   porque erro que some antes de ser lido é erro que ninguém corrige. */
let sumicoDoRecado = null;
function recado(texto, tom) {
  let caixa = el('zap-recado');
  if (!caixa) {
    caixa = document.createElement('div');
    caixa.id = 'zap-recado';
    caixa.className = 'zap-recado';
    caixa.setAttribute('role', 'status');
    caixa.addEventListener('click', () => caixa.classList.remove('aberto'));
    document.body.appendChild(caixa);
  }
  caixa.dataset.tom = tom;
  caixa.textContent = texto;
  requestAnimationFrame(() => caixa.classList.add('aberto'));
  clearTimeout(sumicoDoRecado);
  if (tom === 'ok') sumicoDoRecado = setTimeout(() => caixa.classList.remove('aberto'), 4200);
}

/* -------------------------------------------------------------- relógio */

// `deVolta` é a primeira batida ao abrir a tela (ou ao voltar pra ela): essa não
// espera nada. Quem abre o deck tem que ver quem está na conversa AGORA.
async function bater(deVolta) {
  if (document.hidden && !deVolta) { setTimeout(bater, 3000); return; }
  try {
    const r = await chamar('/api/deck/whatsapp');
    const antes = JSON.stringify([zap.consultado, zap.ligada, zap.chat, zap.rascunho,
      zap.modelos.length, zap.funis.length]);
    zap = {
      consultado: true,
      ligada: r.extensao.ligada,
      chat: r.extensao.chat,
      rascunho: r.extensao.rascunho || [],
      modelos: r.extensao.modelos || [],
      funis: r.extensao.funis || [],
      comandos: r.comandos || [],
    };
    conferirComando();
    // Só repinta quando algo mudou: repintar a cada 2,5s mataria o toque em
    // curso e piscaria a tela na cara de quem está usando.
    if (JSON.stringify([zap.consultado, zap.ligada, zap.chat, zap.rascunho,
        zap.modelos.length, zap.funis.length]) !== antes) pintar();
    conexao(true);
  } catch (e) {
    if (String(e.message) === 'sessao') return;
    conexao(false);
  }
  setTimeout(bater, 2500);
}

function conexao(ligado) {
  tela.conexao.textContent = ligado ? 'Ligado ao JOB' : 'Sem conexão com o JOB.';
  tela.conexao.classList.toggle('caiu', !ligado);
}

function conferirComando() {
  if (!zapEsperando) return;
  const cmd = zap.comandos.find((c) => c.id === zapEsperando.id);
  // Deploy no meio do caminho leva o comando junto (ele mora em memória). Sem
  // este teto o cartão ficaria travado para sempre, esperando uma resposta que
  // não vem mais.
  if (!cmd) {
    if (Date.now() - zapEsperando.em < 120000) return;
    recado('Perdi o rastro deste envio. Confira a conversa antes de mandar de novo.', 'erro');
    soltarCard(zapEsperando.chave);
    zapEsperando = null;
    return;
  }
  if (cmd.estado === 'na_fila' || cmd.estado === 'entregue') return;
  const tom = (cmd.estado === 'falhou' || cmd.estado === 'expirado') ? 'erro'
            : (cmd.estado === 'esperando' ? 'espera' : 'ok');
  recado(cmd.mensagem, tom);
  soltarCard(zapEsperando.chave);
  zapEsperando = null;
}

/* -------------------------------------------------------------- partida */

tela.secoes.querySelectorAll('.zap-secao').forEach((b) => {
  b.addEventListener('click', () => {
    zapSecao = b.dataset.secao;
    localStorage.setItem('deck_zap_secao', zapSecao);
    pintar();
  });
});
tela.busca.addEventListener('input', () => {
  zapBusca = tela.busca.value.trim().toLowerCase();
  pintarLista();
});
el('fechar-folha').addEventListener('click', fecharFolha);
el('folha-cancelar').addEventListener('click', fecharFolha);
tela.cortina.addEventListener('click', fecharFolha);
tela.folhaConfirmar.addEventListener('click', () => {
  const pedido = confirmando;
  fecharFolha();
  if (pedido) disparar(pedido);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) bater(true); });

pintar();
bater(true);
