// ─── JOB Serenus · Ponte do Painel do Corretor (world isolado) ──────────────
//
//  O cotador precisa rodar no contexto da página (MAIN world), porque quem
//  chama o servidor da Trindade é a sessão do próprio corretor. Mas o MAIN
//  world não enxerga a extensão. Este arquivo é a única coisa no meio: leva
//  pedido do resto da extensão pra página e traz a resposta de volta.
//
//  Também guarda os hashes aprendidos. Sem isso, o consultor teria que fazer
//  uma cotação na mão toda vez que abrisse o navegador — com isso, só quando
//  a Trindade fizer deploy e os hashes antigos pararem de valer.
//
//  Escopo mínimo de propósito: não lê a página, não toca no formulário deles e
//  não repassa nada que não seja a nossa própria mensagem.
(function () {
  'use strict';

  const CHAVE = 'cotador_painel_hashes';
  const CHAVE_MOD = 'cotador_painel_modalidades';
  const pendentes = new Map();
  let seq = 0;

  // Devolve o que foi aprendido em sessões anteriores assim que a página carrega.
  try {
    chrome.storage.local.get([CHAVE, CHAVE_MOD], (r) => {
      const d = (r && r[CHAVE]) || null;
      const mods = (r && r[CHAVE_MOD]) || [];
      if (d || mods.length) {
        window.postMessage({ source: 'JOB_COTADOR_BRIDGE', tipo: 'restaurar',
                             dados: { ...(d || {}), modalidades: mods } }, '*');
      }
    });
  } catch (e) { /* sem armazenamento a extensão aprende de novo, só isso */ }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== 'JOB_COTADOR') return;

    if (d.tipo === 'aprendeu' && d.dados) {
      try { chrome.storage.local.set({ [CHAVE]: d.dados }); } catch (e) { /* idem */ }
      return;
    }
    if (d.tipo === 'modalidades' && Array.isArray(d.dados)) {
      try { chrome.storage.local.set({ [CHAVE_MOD]: d.dados }); } catch (e) { /* idem */ }
      return;
    }
    const espera = pendentes.get(d.reqId);
    if (!espera) return;
    if (d.tipo === 'andamento') {
      // Andamento é informativo: avisa quem quiser ouvir e continua esperando.
      // O callback vazio existe pra consumir o lastError quando ninguém está
      // ouvindo — sem ele o Chrome despeja erro no console a cada plano.
      try {
        chrome.runtime.sendMessage(
          { type: 'cotacao_andamento', reqId: d.reqId,
            fase: d.fase, feito: d.feito, total: d.total },
          () => { void chrome.runtime.lastError; });
      } catch (e) { /* sem ouvinte, o andamento simplesmente não aparece */ }
      return;
    }
    if (d.tipo === 'resposta') {
      pendentes.delete(d.reqId);
      clearTimeout(espera.relogio);
      espera.responder({ ok: !!d.ok, motivo: d.motivo || '', faltando: d.faltando || [],
                         dados: d.dados || null });
    }
  });

  function perguntarPagina(tipo, extra, responder, msLimite) {
    const reqId = 'c' + (++seq) + '-' + Date.now();
    const relogio = setTimeout(() => {
      pendentes.delete(reqId);
      responder({ ok: false, motivo: 'demorou_demais' });
    }, msLimite);
    pendentes.set(reqId, { responder, relogio });
    window.postMessage({ source: 'JOB_COTADOR_BRIDGE', tipo, reqId, ...extra }, '*');
  }

  // O que a extensão aceita pedir daqui, e quanto tempo espera por cada um.
  // Lista fechada de propósito: o que não está aqui não atravessa.
  const ACEITOS = {
    cotar_aqui:      ['cotar',   90000],   // preço é sequencial: 20 planos dão uns 15s
    cotador_estado:  ['estado',   5000],
    cotador_cidades: ['cidades',  8000],
  };

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !ACEITOS[msg.type]) return;
    const [tipo, limite] = ACEITOS[msg.type];
    perguntarPagina(tipo, { pedido: msg.pedido, termo: msg.termo }, sendResponse, limite);
    return true;
  });
})();
