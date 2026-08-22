/* Deck do JOB — a tela de envio pelo iPad.
   Nasceu do deck local (deck-ipad/), mas aqui não há PIN nem endereço de IP:
   quem autentica é a sessão do JOB. O que não mudou é quem envia — a extensão,
   na conversa que está aberta no Chrome deste consultor. */

const el = (id) => document.getElementById(id);
const tela = {
  topo: el('zap-topo'), lista: el('zap-lista'),
  busca: el('zap-busca'), secoes: el('zap-secoes'),
  folha: el('folha'), cortina: el('cortina'), folhaTitulo: el('folha-titulo'),
  folhaTexto: el('folha-texto'), folhaAcoes: el('folha-acoes'),
  folhaConfirmar: el('folha-confirmar'),
};

let zap = { consultado: false, modo: 'extensao', ligada: false, chat: null, rascunho: [],
            conversas: [], modelos: [], funis: [], comandos: [] };
// MODO NUVEM: computador desligado, WhatsApp conectado no servidor. A lista deixa
// de ser "as conversas abertas" e passa a ser "os seus leads do CRM", e o envio
// sai pela fila do JOB em vez de sair pela extensão. É outra promessa — mais
// lenta, sem conversa na tela — e a tela precisa dizer isso com todas as letras.
const naNuvem = () => zap.modo === 'nuvem';
// Destino escolhido na lista. null = manda para a conversa que estiver aberta,
// que é o caso comum de quem está sentado na frente do computador.
let zapAlvo = null;
let zapSecao = localStorage.getItem('deck_zap_secao') || 'mensagens';
let zapBusca = '';
// null = todas as pastas; '' = os que não estão em pasta nenhuma; texto = a pasta.
// Antes isto usava um caractere nulo como sentinela: funcionava e era ilegível,
// e ilegível em condição de filtro é bug esperando acontecer.
let zapPasta = null;
let semJob = false;        // o JOB parou de responder a este iPad
// O que foi para a fila da nuvem e ainda não teve desfecho.
let naNuvemEsperando = [];
let zapEsperando = null;   // { id, chave } do comando que este iPad disparou
let confirmando = null;

/* ------------------------------------------------------------- medição */

// O DECK CONTA DE SI MESMO.
//
// Ele subiu inteiro sem nenhuma medição: ninguém sabe quantas teclas são
// tocadas por dia, quais nunca são, nem quanto tempo leva do abrir até o
// disparo. Sem isso, a próxima melhoria seria palpite meu — e a régua da casa
// manda desenhar contra o erro que acontece, não contra o imaginado.
//
// Nunca atrapalha o trabalho: sai por fora do caminho do envio, não espera
// resposta e engole o próprio erro. Medição que trava a tela é pior que
// medição nenhuma.
const abriuEm = Date.now();
function medir(evento, extra) {
  try {
    fetch('/api/deck/uso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      keepalive: true,          // sobrevive à tela sendo fechada no meio
      body: JSON.stringify(Object.assign({
        evento, modo: zap.modo, ms: Date.now() - abriuEm,
      }, extra || {})),
    }).catch(() => {});
  } catch (e) { /* medir nunca derruba o deck */ }
}

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
  // Funil pela nuvem não existe: a aba some, em vez de ficar apagada. Aba
  // apagada é convite a um toque que não cumpre.
  tela.secoes.querySelector('[data-secao="funis"]').hidden = naNuvem();
  if (naNuvem() && zapSecao === 'funis') zapSecao = 'mensagens';

  pintarDestino();
  pintarLista();
}

// Na mão a barra é estreita: o rótulo do modo precisa caber inteiro em vez de
// terminar em reticências. Encurta a frase, não o sentido.
const estreito = () => window.matchMedia('(max-width: 699px)').matches;

// PARA QUEM VAI — a barra fixa do topo.
//
// Altura travada, conteúdo trocado por dentro. Antes o cartão era reescrito
// inteiro a cada batida e mudava de 76px para mais de 200 conforme a conversa
// entrava e saía: a mesa saltava debaixo do dedo entre o olho mirar e a mão
// encostar. Aqui todo toque errado é uma mensagem no cliente errado.
function pintarDestino() {
  const parado = zap.consultado ? motivoDeNaoEnviar() : '';
  const alvo = alvoAtual();
  tela.topo.dataset.modo = naNuvem() ? 'nuvem' : 'extensao';
  tela.topo.dataset.estado = !zap.consultado ? 'procurando' : (parado ? 'parado' : 'pronto');

  let rot, nome, nota;
  if (!zap.consultado) {
    rot = 'Procurando o computador';
    nome = 'Um instante';
    nota = 'Perguntando quem está na conversa.';
  } else if (parado) {
    rot = 'Não dá para enviar agora';
    nome = naNuvem() ? 'Escolha o cliente' : 'Nenhuma conversa';
    nota = parado;
  } else if (naNuvem()) {
    rot = estreito() ? 'Pelo servidor' : 'Pelo servidor — o computador pode estar desligado';
    nome = alvo.nome || 'Sem nome salvo';
    nota = 'Entra na fila e sai em alguns minutos. A conversa não aparece aqui.';
  } else {
    rot = alvo.escolhido
      ? (estreito() ? 'Vai abrir esta conversa' : 'Vai abrir esta conversa no computador')
      : (estreito() ? 'Conversa aberta no PC' : 'Conversa aberta no computador');
    nome = alvo.nome || 'Conversa sem nome salvo';
    nota = ultimaFala() || 'Toque no nome para ver a conversa.';
  }

  tela.topo.innerHTML =
    '<span class="zap-pulso" aria-hidden="true"></span>'
    + '<button class="zap-quem" type="button" id="zap-ver">'
    + '<span class="zap-rot">' + escapar(rot) + '</span>'
    + '<span class="zap-nome">' + escapar(nome) + '</span>'
    + '<span class="zap-nota">' + escapar(nota) + '</span></button>'
    + (zap.conversas.length
        ? '<button class="zap-trocar" type="button" id="zap-trocar">'
          + (alvo && alvo.escolhido ? 'Trocar' : 'Escolher') + '</button>'
        : '');

  const bt = el('zap-trocar');
  if (bt) bt.addEventListener('click', abrirEscolhaDeConversa);
  const ver = el('zap-ver');
  if (ver) ver.addEventListener('click', abrirConversa);
}

// Uma linha só. A conversa inteira mora na folha — é lá que a decisão acontece,
// e é lá que ela cabe sem empurrar a mesa para fora da tela.
function ultimaFala() {
  const falas = zap.rascunho || [];
  if (!falas.length) return '';
  const f = falas[falas.length - 1];
  const quem = f.de === 'consultor' ? 'Você' : 'Ele';
  return quem + ': "' + String(f.texto || '').slice(0, 70) + '"'
       + (f.hora ? ' — ' + f.hora : '');
}

// A conversa, quando pedida. Nome no topo não basta: duas Marias existem, a
// conversa não — e é ela que diz se você está prestes a disparar no lugar certo.
function abrirConversa() {
  const falas = zap.rascunho || [];
  const alvo = alvoAtual();
  if (naNuvem()) {
    abrirFolha({ titulo: (alvo && alvo.nome) || 'Este contato',
      texto: 'Pelo servidor o JOB não lê a conversa — ele só entrega. Para ver o que '
           + 'foi dito, abra o WhatsApp no celular ou ligue o computador.',
      confirmar: null });
    return;
  }
  abrirFolha({ titulo: (alvo && alvo.nome) || 'Conversa aberta', texto: '', confirmar: null });
  const caixa = document.createElement('div');
  caixa.className = 'zap-conversa';
  caixa.innerHTML = falas.length
    ? falas.map((f) =>
        '<div class="zap-fala" data-de="' + (f.de === 'consultor' ? 'consultor' : 'lead') + '">'
        + escapar(f.texto)
        + (f.hora ? '<span class="hora">' + escapar(f.hora) + '</span>' : '')
        + '</div>').join('')
    : '<p class="vazio">Sem mensagens de texto recentes nesta conversa.</p>';
  tela.folhaTexto.insertAdjacentElement('afterend', caixa);
}

// PARA QUEM VAI. É a pergunta mais importante da tela inteira.
// Sem escolha, vale a conversa aberta no computador. Com escolha, o WhatsApp
// pula para ela antes de enviar — e quem escolheu precisa ver isso escrito.
function alvoAtual() {
  if (zapAlvo) return { chatId: zapAlvo.chatId, nome: zapAlvo.nome, escolhido: true };
  if (naNuvem()) return null;   // sem extensão não existe "conversa aberta"

  if (zap.chat) return { chatId: zap.chat.chatId, nome: zap.chat.nome, escolhido: false };
  return null;
}

// A condição que governa a tela, dita com todas as letras — e com o que fazer.
function motivoDeNaoEnviar() {
  if (semJob) {
    return 'O iPad perdeu a conexão com o JOB. Confira o wi-fi; ele volta sozinho '
         + 'quando a rede voltar.';
  }
  if (!zap.consultado) return 'Ainda perguntando ao computador.';
  if (naNuvem()) {
    if (zapSecao === 'funis') {
      return 'Funil só com o computador ligado. Pelo servidor dá para mandar as '
           + 'mensagens da biblioteca, uma de cada vez.';
    }
    if (!alvoAtual()) return 'Escolha o cliente na lista para o servidor enviar.';
    return '';
  }
  if (!zap.ligada) {
    return 'A extensão do JOB não está falando com o deck. Abra o WhatsApp Web no '
         + 'Chrome do computador (e clique na aba uma vez).';
  }
  if (!alvoAtual()) {
    return 'Nenhuma conversa aberta no WhatsApp Web. Abra a conversa do cliente, '
         + 'ou escolha uma na lista.';
  }
  return '';
}

function pintarLista() {
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
    zapSecao === 'funis' ? cartaoFunil(item) : cartaoModelo(item)));
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
  if (!zap.ligada && !naNuvem()) return 'A biblioteca aparece quando a extensão se conectar.';
  // MENTIRA QUE A TELA CONTAVA. Ela dizia "nenhum funil cadastrado" para quem
  // tem seis — porque a memória do servidor recomeça vazia a cada deploy e a
  // extensão só reenvia a biblioteca de dois em dois minutos. Vazio por falta
  // de cadastro e vazio por falta de resposta são coisas diferentes, e a
  // segunda se resolve sozinha em instantes: dizer qual é das duas é o mínimo.
  if (!zap.catalogoChegou) {
    return 'Ainda recebendo a sua biblioteca do computador. Isso leva até dois minutos.';
  }
  return zapSecao === 'funis'
    ? 'Nenhum funil cadastrado ainda. Monte um em Funis.'
    : 'Nenhuma mensagem na biblioteca ainda.';
}

function filtrar(itens, comoBuscar) {
  if (!zapBusca) return itens;
  return itens.filter((i) => comoBuscar(i).indexOf(zapBusca) >= 0);
}

const ROTULO_MIDIA = { audio: 'Áudio', imagem: 'Imagem', video: 'Vídeo', documento: 'PDF' };

/* ------------------------------------------------------------- ícones */
/* Numa mesa, o ícone é quem se lê primeiro — o rótulo confirma. Traço, não
   preenchimento: em tecla pequena, sólido vira mancha. */

const D = {
  texto: '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.9-.9L3 20.5l1.5-4.4A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z"/>',
  audio: '<rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 19v3"/>',
  imagem: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="M21 15l-5-5-8 8"/>',
  documento: '<path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5M9 13h6M9 17h6"/>',
  video: '<rect x="2" y="5" width="14" height="14" rx="2"/><path d="M16 10l6-3v10l-6-3z"/>',
  funil: '<path d="M3 4h18l-7 8v7l-4 2v-9z"/>',
};

function icone(nome, px) {
  const t = px || 26;
  return `<svg class="icone" width="${t}" height="${t}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${D[nome] || D.texto}</svg>`;
}



function cartaoModelo(m) {
  const tipo = m.midia_tipo || 'texto';
  const b = document.createElement('button');
  b.className = 'zap-tecla';
  b.type = 'button';
  b.dataset.chave = 'modelo:' + m.id;
  b.dataset.tipo = tipo;
  // A marca do canto só para mídia. Texto é o caso comum: carimbar "TEXTO" em
  // oito de dez teclas é ruído que some com o que de fato distingue uma da outra.
  b.innerHTML = (ROTULO_MIDIA[tipo] ? '<span class="marca">' + ROTULO_MIDIA[tipo] + '</span>' : '')
    + icone(tipo, 38)
    + '<span class="rotulo">' + escapar(m.titulo || 'Sem título') + '</span>'
    + '<span class="zap-andamento"></span>';
  b.addEventListener('click', () => { marcarCard(b.dataset.chave, ''); confirmarModelo(m, b); });
  return b;
}

function cartaoFunil(f) {
  const passos = f.passos || [];
  const total = passos.reduce((s, p) => s + (Number(p.delay_segundos) || 0), 0);
  const b = document.createElement('button');
  b.className = 'zap-tecla';
  b.type = 'button';
  b.dataset.chave = 'funil:' + f.id;
  b.dataset.tipo = 'funil';
  // O canto diz o tamanho do disparo sem gastar linha de rótulo. `title` saiu:
  // no iPad não existe cursor, então aquele texto nunca aparecia para ninguém.
  b.innerHTML = '<span class="marca">' + passos.length + ' msg</span>'
    + icone('funil', 38)
    + '<span class="rotulo">' + escapar(f.nome || 'Funil sem nome') + '</span>'
    + '<span class="zap-andamento"></span>';
  b.addEventListener('click', () => { marcarCard(b.dataset.chave, ''); confirmarFunil(f, b); });
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
  // Dois cancelares na mesma folha ("Fechar" e "Não fazer") é uma escolha a mais
  // para quem já está decidindo. Com ação, fica só o par decidir/não decidir.
  el('fechar-folha').hidden = Boolean(o.confirmar);
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
  const contatos = el('zap-contatos');
  if (contatos) contatos.remove();
  tela.cortina.classList.remove('aberta');
  tela.folha.classList.remove('aberta');
  setTimeout(() => { tela.folha.hidden = true; tela.cortina.hidden = true; }, 280);
}

// A guarda que saiu da mesa mora aqui: se não dá para enviar, a folha diz o
// motivo e o que fazer, e não oferece o botão de confirmar.
function folhaImpedida() {
  const parado = motivoDeNaoEnviar();
  if (!parado) return false;
  abrirFolha({ titulo: 'Ainda não dá para enviar', texto: parado, confirmar: null });
  return true;
}

function confirmarModelo(m, card) {
  if (folhaImpedida()) return;
  const alvo = alvoAtual();
  const nome = (alvo && alvo.nome) || 'a conversa aberta';
  confirmando = { tipo: 'modelo', id: m.id, chave: card.dataset.chave };
  abrirFolha({
    titulo: m.titulo || 'Enviar mensagem',
    midia: m.midia_tipo ? { tipo: m.midia_tipo, url: m.midia_url } : null,
    texto: m.texto || (m.midia_tipo ? ROTULO_MIDIA[m.midia_tipo] + ' sem legenda.' : ''),
    confirmar: 'Enviar para ' + nome,
  });
}

function confirmarFunil(f, card) {
  if (folhaImpedida()) return;
  const alvo = alvoAtual();
  const nome = (alvo && alvo.nome) || 'a conversa aberta';
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

/* ------------------------------------------------------- escolher conversa */

function abrirEscolhaDeConversa() {
  abrirFolha({ titulo: 'Para quem vai',
               texto: naNuvem()
                 ? 'As suas conversas do WhatsApp, guardadas da última vez que o '
                   + 'computador esteve ligado. Depois delas, os leads do CRM.'
                 : '',
               confirmar: null });
  const corpo = document.createElement('div');
  corpo.id = 'zap-contatos';
  corpo.className = 'zap-contatos';
  tela.folhaTexto.insertAdjacentElement('afterend', corpo);

  const busca = document.createElement('input');
  busca.className = 'zap-busca';
  busca.type = 'search';
  busca.placeholder = naNuvem() ? 'Buscar o cliente pelo nome' : 'Buscar pelo nome';
  busca.setAttribute('aria-label', 'Buscar conversa pelo nome');
  corpo.appendChild(busca);

  const lista = document.createElement('div');
  lista.className = 'zap-contatos-lista';
  corpo.appendChild(lista);

  function desenhar() {
    const q = busca.value.trim().toLowerCase();
    const itens = zap.conversas.filter((c) => !q || (c.nome || '').toLowerCase().indexOf(q) >= 0);
    lista.innerHTML = '';
    if (zap.chat && !naNuvem()) lista.appendChild(linhaConversa(
      { chatId: zap.chat.chatId, nome: zap.chat.nome }, true));
    if (!itens.length) {
      const p = document.createElement('p');
      p.className = 'zap-vazio';
      p.textContent = q ? 'Nenhum nome assim na lista.'
        : (naNuvem() ? 'Nada guardado ainda. Abra o WhatsApp Web no computador uma '
                     + 'vez para o JOB aprender a sua lista de conversas.'
                     : 'A lista aparece quando a extensão terminar de ler as conversas.');
      lista.appendChild(p);
      return;
    }
    itens.forEach((c) => {
      if (zap.chat && c.chatId === zap.chat.chatId) return;   // já está no topo
      lista.appendChild(linhaConversa(c, false));
    });
  }
  busca.addEventListener('input', desenhar);
  desenhar();
}

function linhaConversa(c, ehAberta) {
  const b = document.createElement('button');
  b.className = 'zap-contato';
  b.type = 'button';
  const escolhida = zapAlvo ? zapAlvo.chatId === c.chatId : ehAberta;
  b.setAttribute('aria-pressed', String(escolhida));
  // De onde veio o nome importa: uma conversa do WhatsApp é gente que já falou
  // com você; um lead do CRM pode nunca ter recebido nada. Quem escolhe precisa
  // saber qual dos dois está tocando.
  const etiqueta = ehAberta ? 'aberta agora'
    : (c.de === 'conversa' ? 'conversa do WhatsApp'
    : (c.de === 'lead' ? 'lead do CRM' : ''));
  b.innerHTML = '<span class="nome">' + escapar(c.nome || 'Sem nome salvo') + '</span>'
    + (etiqueta ? '<span class="etiqueta">' + etiqueta + '</span>' : '');
  b.addEventListener('click', () => {
    // Escolher a conversa que já está aberta é o mesmo que não escolher nada:
    // assim o deck não fica prometendo abrir o que já está na frente.
    zapAlvo = ehAberta ? null : { chatId: c.chatId, nome: c.nome };
    fecharFolha();
    pintar();
  });
  return b;
}

/* --------------------------------------------------------------- envio */

async function disparar(pedido) {
  const card0 = tela.lista.querySelector('[data-chave="' + pedido.chave + '"]');
  medir('tocou', {
    chave: pedido.chave,
    rotulo: card0 ? (card0.querySelector('.rotulo') || {}).textContent : '',
    secao: zapSecao, pasta: zapPasta === null ? 'todas' : (zapPasta || 'sem pasta'),
    buscou: Boolean(zapBusca),
  });
  const card = tela.lista.querySelector('[data-chave="' + pedido.chave + '"]');
  marcarCard(pedido.chave, 'indo');
  try {
    const alvo = alvoAtual();
    const r = await chamar('/api/deck/comando', {
      method: 'POST',
      body: JSON.stringify({ tipo: pedido.tipo, id: pedido.id,
                             chatId: (alvo && alvo.escolhido) ? alvo.chatId : '' }),
    });
    if (r.erro) { recado(r.erro, 'erro'); marcarCard(pedido.chave, 'falhou'); return; }
    // Pela nuvem não há o que esperar na tela: o envio é do servidor e leva
    // minutos. Fingir "entregue" agora seria a mentira mais fácil de contar.
    if (r.comando.estado === 'na_fila_nuvem') {
      recado(r.comando.mensagem, 'ok');
      marcarCard(pedido.chave, 'atencao');       // saiu daqui, mas ainda não chegou lá
      // Fica de olho até o servidor entregar. Sem isto o consultor teria que
      // abrir o WhatsApp só para saber se chegou — a troca de tela que este
      // deck existe para acabar.
      naNuvemEsperando.push({ filaId: r.comando.fila_id, chave: pedido.chave,
                              para: r.para, em: Date.now() });
      return;
    }
    zapEsperando = { id: r.comando.id, chave: pedido.chave, em: Date.now() };
    recado('Mandando para ' + r.para + '…', 'espera');
    bater(true);
  } catch (e) {
    if (String(e.message) === 'sessao') return;
    recado('O JOB não respondeu. Confira a conexão e tente de novo.', 'erro');
    marcarCard(pedido.chave, 'falhou');
  }
}

const SELO = { indo: 'Indo', foi: 'Enviado', falhou: 'Não foi',
               atencao: 'Na fila', espera: 'Aguarde' };

/* Verde e vermelho sozinhos não contam a história: quem não distingue as duas
   cores fica sem saber, e no sol da rua qualquer tinta fraca some. Por isso o
   canto da tecla passa a dizer a palavra — a cor é o reforço, não a informação. */
function marcarCard(chave, estado, segundos) {
  const card = tela.lista.querySelector('[data-chave="' + chave + '"]');
  if (!card) return;
  card.disabled = (estado === 'indo');
  if (!estado) { delete card.dataset.estado; pintarSelo(card, ''); return; }
  card.dataset.estado = estado;
  pintarSelo(card, SELO[estado] || '');
  clearTimeout(card._voltar);
  // O que deu certo volta ao normal sozinho; o que deu errado FICA. Erro que
  // some antes de ser lido é erro que ninguém corrige.
  if (segundos) card._voltar = setTimeout(() => marcarCard(chave, ''), segundos * 1000);
}

function pintarSelo(card, texto) {
  let selo = card.querySelector('.selo');
  if (!texto) { if (selo) selo.remove(); return; }
  if (!selo) {
    selo = document.createElement('span');
    selo.className = 'selo';
    card.appendChild(selo);
  }
  selo.textContent = texto;
}

function soltarCard(chave) {
  marcarCard(chave, '');
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

// O DESFECHO CHEGA AQUI, NÃO NO WHATSAPP.
//
// "Na fila" não é resposta: o consultor quer saber se entrou na conversa. A
// tecla acompanha até o fim — âmbar enquanto espera, verde quando o servidor
// entregou, vermelho quando não deu.
function conferirFila(fila) {
  if (!naNuvemEsperando.length) return;
  naNuvemEsperando = naNuvemEsperando.filter((p) => {
    const item = fila.find((f) => f.id === p.filaId);
    if (!item) {
      // Uma hora é o alcance do que o servidor conta. Passou disso sem desfecho,
      // é melhor dizer que perdi o rastro do que deixar a tecla âmbar para sempre.
      if (Date.now() - p.em < 3600000) return true;
      marcarCard(p.chave, 'falhou');
      recado('Perdi o rastro desta mensagem. Confira a conversa no WhatsApp.', 'erro');
      return false;
    }
    if (item.status === 'pendente' || item.status === 'enviando') {
      marcarCard(p.chave, item.status === 'enviando' ? 'indo' : 'atencao');
      return true;
    }
    if (item.status === 'enviado') {
      medir('desfecho', { chave: p.chave, desfecho: 'foi' });
      marcarCard(p.chave, 'foi', 8);
      recado('Chegou no WhatsApp de ' + p.para + '.', 'ok');
    } else {
      medir('desfecho', { chave: p.chave, desfecho: 'falhou', motivo: item.erro || '' });
      marcarCard(p.chave, 'falhou');
      recado('Não saiu para ' + p.para + '. ' + (item.erro || 'Tente de novo.'), 'erro');
    }
    return false;
  });
}

/* -------------------------------------------------------------- relógio */

// `deVolta` é a primeira batida ao abrir a tela (ou ao voltar pra ela): essa não
// espera nada. Quem abre o deck tem que ver quem está na conversa AGORA.
async function bater(deVolta) {
  if (document.hidden && !deVolta) { setTimeout(bater, 3000); return; }
  try {
    const r = await chamar('/api/deck/whatsapp');
    const antes = JSON.stringify([zap.consultado, zap.modo, zap.ligada, zap.chat, zap.rascunho,
      zap.modelos.length, zap.funis.length]);
    zap = {
      consultado: true,
      modo: r.modo || 'extensao',
      ligada: r.extensao.ligada,
      chat: r.extensao.chat,
      rascunho: r.extensao.rascunho || [],
      conversas: r.extensao.conversas || [],
      modelos: r.extensao.modelos || [],
      funis: r.extensao.funis || [],
      catalogoChegou: Boolean(r.catalogo_chegou),
      comandos: r.comandos || [],
    };
    if (zapAlvo && zap.conversas.length
        && !zap.conversas.some((c) => c.chatId === zapAlvo.chatId)
        && !(zap.chat && zap.chat.chatId === zapAlvo.chatId)) {
      zapAlvo = null;   // saiu da lista: volta para a conversa aberta em vez de mentir
    }
    conferirComando();
    conferirFila(r.fila || []);
    // Só repinta quando algo mudou: repintar a cada 2,5s mataria o toque em
    // curso e piscaria a tela na cara de quem está usando.
    if (JSON.stringify([zap.consultado, zap.modo, zap.ligada, zap.chat, zap.rascunho,
        zap.modelos.length, zap.funis.length]) !== antes) pintar();
    conexao(true);
  } catch (e) {
    if (String(e.message) === 'sessao') return;
    conexao(false);
  }
  setTimeout(bater, 2500);
}

// "Ligado ao JOB" era uma linha de 13px cinza no canto, e "a extensão respondeu"
// era outra frase em outro lugar. Na cabeça de quem usa é a MESMA pergunta:
// dá para enviar agora? Uma pergunta, um lugar — a barra de destino.
function conexao(ligado) {
  if (semJob === !ligado) return;
  semJob = !ligado;
  pintarDestino();
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
    marcarCard(zapEsperando.chave, 'falhou');
    zapEsperando = null;
    return;
  }
  if (cmd.estado === 'na_fila' || cmd.estado === 'entregue') return;
  const ruim = (cmd.estado === 'falhou' || cmd.estado === 'expirado');
  const tom = ruim ? 'erro' : (cmd.estado === 'esperando' ? 'espera' : 'ok');
  recado(cmd.mensagem, tom);
  // Verde some em 6 segundos porque a tecla vai ser usada de novo; vermelho e
  // âmbar ficam até alguém tocar nela outra vez.
  medir('desfecho', { chave: zapEsperando.chave,
                      desfecho: ruim ? 'falhou' : 'foi',
                      motivo: ruim ? (cmd.mensagem || '') : '' });
  marcarCard(zapEsperando.chave,
             ruim ? 'falhou' : (cmd.estado === 'esperando' ? 'espera' : 'foi'),
             ruim || cmd.estado === 'esperando' ? 0 : 6);
  zapEsperando = null;
}

/* ----------------------------------------------------------------- tema */

// Três estados, não dois: "Automático" é o padrão e devolve o comando ao
// sistema. Um interruptor de dois estados não tem como voltar para isso.
const TEMAS = [
  { id: '',       rotulo: 'Tema: automático' },
  { id: 'claro',  rotulo: 'Tema: claro' },
  { id: 'escuro', rotulo: 'Tema: escuro' },
];

function aplicarTema(id) {
  if (id) document.documentElement.dataset.tema = id;
  else delete document.documentElement.dataset.tema;
  const b = el('zap-tema');
  const atual = TEMAS.find((x) => x.id === id) || TEMAS[0];
  // No telefone o botão fica ao lado das seções e não cabe a frase inteira; a
  // palavra sozinha continua dizendo qual dos três está valendo.
  b.textContent = estreito() ? atual.rotulo.replace('Tema: ', '') : atual.rotulo;
  b.setAttribute('aria-label', atual.rotulo + '. Toque para trocar.');
  b.dataset.tema = id;
  // A barra do Safari e os controles do sistema (player de áudio, rolagem)
  // seguem junto; sem isto o player nasce branco no meio de uma folha escura.
  const escuro = id === 'escuro'
    || (!id && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', escuro ? '#0e0f12' : '#f1f2f5');
}

el('zap-tema').addEventListener('click', () => {
  const i = TEMAS.findIndex((x) => x.id === (localStorage.getItem('deck_tema') || ''));
  const proximo = TEMAS[(i + 1) % TEMAS.length];
  localStorage.setItem('deck_tema', proximo.id);
  aplicarTema(proximo.id);
});
aplicarTema(localStorage.getItem('deck_tema') || '');
setTimeout(() => medir('abriu'), 1500);   // depois da primeira batida, para saber o modo

/* -------------------------------------------------------------- partida */

tela.secoes.querySelectorAll('.zap-secao').forEach((b) => {
  b.addEventListener('click', () => {
    zapSecao = b.dataset.secao;
    zapBusca = '';
    tela.busca.value = '';
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
