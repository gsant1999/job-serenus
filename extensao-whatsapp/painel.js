/* ══════════════════════════════════════════════════════════════════════
   PAINEL NATIVO — a superfície de gestão do JOB

   POR QUE ELE EXISTE, SE JÁ TEM O PAINEL DOCADO
   O painel docado é injetado DENTRO do WhatsApp. Isso custa duas coisas: em
   janela estreita ele espreme a conversa até o conteúdo ser cortado, e toda
   vez que o WhatsApp muda o HTML dele há risco de o painel quebrar. Este aqui
   é do navegador: largura própria que o usuário arrasta, e nada a ver com o
   DOM do WhatsApp.

   O QUE ELE NÃO SUBSTITUI
   Ele não fica colado no campo de digitar — não tem como, é outra superfície.
   A barra de itens continua sendo o caminho rápido de quem está digitando.
   Aqui é onde se procura com calma numa biblioteca de centenas de itens.

   O DESTINO DO ENVIO PRECISA ESTAR ESCRITO. Por não morar dentro do WhatsApp,
   "a conversa aberta" deixa de ser óbvio — o cabeçalho diz qual é, e sem
   conversa os botões ficam desabilitados em vez de falharem no clique.
   ══════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const ICO = {
    funil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
    modelo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  };

  const $ = (id) => document.getElementById(id);
  const esc = (t) => String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

  let TODOS = [];
  let aba = 'tudo';
  let soFav = false;
  let conversa = null;   // {chatId, nome} da aba do WhatsApp
  let abaWppId = null;

  function msg(tipo, extra) {
    return new Promise((ok) => {
      try { chrome.runtime.sendMessage(Object.assign({ type: tipo }, extra || {}), (r) => { void chrome.runtime.lastError; ok(r); }); }
      catch (e) { ok(null); }
    });
  }

  // Pergunta ao content script qual conversa está aberta. Só o content script
  // sabe — o painel não enxerga a página.
  async function acharConversa() {
    try {
      const abas = await chrome.tabs.query({ url: '*://web.whatsapp.com/*' });
      if (!abas || !abas.length) return null;
      // A ativa primeiro; se nenhuma estiver ativa, a primeira que existir.
      const alvo = abas.find((a) => a.active) || abas[0];
      abaWppId = alvo.id;
      return await new Promise((ok) => {
        try {
          chrome.tabs.sendMessage(alvo.id, { type: 'painel_conversa' }, (r) => {
            void chrome.runtime.lastError;
            ok(r && r.ok ? r : null);
          });
        } catch (e) { ok(null); }
      });
    } catch (e) { return null; }
  }

  function pintarConversa() {
    const cx = $('pn-conversa');
    const nome = $('pn-conversa-nome');
    if (conversa && conversa.chatId) {
      cx.classList.remove('pn-sem');
      nome.textContent = conversa.nome || 'conversa aberta';
      $('pn-rodape-txt').textContent = 'O envio abre a confirmação antes de sair.';
    } else {
      cx.classList.add('pn-sem');
      nome.textContent = 'nenhuma';
      $('pn-rodape-txt').textContent =
        'Abra uma conversa no WhatsApp Web para poder enviar daqui.';
    }
    pintarLista();
  }

  async function carregar() {
    const out = [];
    const rf = await msg('listar_funis');
    if (rf && rf.ok) {
      for (const f of rf.funis || []) {
        out.push({ tipo: 'funil', id: f.id, nome: f.nome || '', fav: !!f.favorito,
                   passos: (f.passos || []).length });
      }
    }
    const rm = await msg('listar_modelos');
    if (rm && rm.ok) {
      for (const m of rm.modelos || []) {
        out.push({ tipo: 'modelo', id: m.id, nome: m.nome || '', fav: !!m.favorito,
                   midia: m.midia_tipo || 'texto' });
      }
    }
    TODOS = out;
    if (!out.length) {
      $('pn-lista').innerHTML =
        '<p class="pn-estado">Nada aqui ainda.<br>Cadastre funis e modelos em Modelos, no site do JOB. ' +
        'Se você acabou de entrar, abra o popup da extensão e confirme o login.</p>';
      return;
    }
    pintarLista();
  }

  function filtrar() {
    const alvo = norm($('pn-busca').value);
    return TODOS.filter((i) =>
      (aba === 'tudo' || i.tipo === aba) &&
      (!soFav || i.fav) &&
      (!alvo || norm(i.nome).includes(alvo)));
  }

  function pintarLista() {
    const lista = filtrar();
    const el = $('pn-lista');
    if (!TODOS.length) return;
    if (!lista.length) {
      el.innerHTML = '<p class="pn-estado">Nada com esse filtro. Apague a busca para ver tudo.</p>';
      return;
    }
    const semConversa = !(conversa && conversa.chatId);
    el.innerHTML = lista.map((i, n) =>
      '<button type="button" class="pn-item" data-n="' + n + '"' + (semConversa ? ' disabled' : '') +
        ' title="' + esc(i.nome) + '">' +
        '<span class="pn-item-ico" aria-hidden="true">' + (i.tipo === 'funil' ? ICO.funil : ICO.modelo) + '</span>' +
        '<span class="pn-item-corpo">' +
          '<span class="pn-item-nome">' + esc(i.nome) + '</span>' +
          '<span class="pn-item-sub">' +
            (i.tipo === 'funil' ? 'Funil' : 'Modelo · ' + esc(i.midia)) +
            (i.fav ? ' · favorito' : '') +
          '</span>' +
        '</span>' +
        (i.tipo === 'funil' ? '<span class="pn-item-n">' + i.passos + '</span>' : '') +
      '</button>').join('');
    el._lista = lista;
  }

  $('pn-lista').addEventListener('click', async (ev) => {
    const b = ev.target.closest && ev.target.closest('.pn-item');
    if (!b || b.disabled) return;
    const item = ($('pn-lista')._lista || [])[Number(b.dataset.n)];
    if (!item || !abaWppId) return;
    // Manda o content script abrir a MESMA confirmação de sempre. O painel
    // nunca envia sozinho: um clique aqui, longe da conversa, é ainda mais
    // fácil de errar de destino do que na tela do WhatsApp.
    try {
      chrome.tabs.sendMessage(abaWppId, {
        type: 'painel_abrir_item', item_tipo: item.tipo, item_id: item.id,
      }, () => { void chrome.runtime.lastError; });
      // Traz o WhatsApp pra frente: a confirmação abriu lá, não aqui.
      chrome.tabs.update(abaWppId, { active: true });
    } catch (e) { /* aba fechou entre o clique e o envio */ }
  });

  $('pn-busca').addEventListener('input', pintarLista);
  $('pn-fav').addEventListener('click', () => {
    soFav = !soFav;
    $('pn-fav').setAttribute('aria-pressed', soFav ? 'true' : 'false');
    try { chrome.storage.local.set({ jobPainelSoFav: soFav }); } catch (e) {}
    pintarLista();
  });
  document.querySelectorAll('.pn-aba').forEach((b) => {
    b.addEventListener('click', () => {
      aba = b.dataset.aba;
      document.querySelectorAll('.pn-aba').forEach((o) => {
        const on = o === b;
        o.classList.toggle('pn-aba-on', on);
        o.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      pintarLista();
    });
  });

  async function inicio() {
    try {
      const c = await new Promise((ok) => chrome.storage.local.get(['jobItensSoFav', 'jobTema'], ok));
      soFav = !!(c && c.jobItensSoFav);
      $('pn-fav').setAttribute('aria-pressed', soFav ? 'true' : 'false');
      if (c && c.jobTema === 'claro') document.documentElement.setAttribute('data-tema', 'claro');
    } catch (e) {}
    conversa = await acharConversa();
    pintarConversa();
    await carregar();
    // A conversa muda enquanto o painel está aberto: reconsulta de tempos em
    // tempos. É barato (uma mensagem ao content script) e evita o pior caso,
    // que é mandar pro contato anterior.
    setInterval(async () => {
      const nova = await acharConversa();
      const mudou = (nova && nova.chatId) !== (conversa && conversa.chatId);
      conversa = nova;
      if (mudou) pintarConversa();
    }, 3000);
  }

  inicio();
})();
