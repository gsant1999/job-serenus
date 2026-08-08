// ─── JOB Serenus · Injetor (roda NA PÁGINA) ─────────────────────────────────
//
//  POR QUE ISTO EXISTE
//  -------------------
//  Antes, os scripts que rodam no contexto da página (a wa-js e a nossa ponte)
//  eram declarados no manifest com `world: MAIN`. Funciona, com um limite duro:
//  o Chrome só injeta no carregamento da página. Se por qualquer motivo a ponte
//  não subir — e isso aconteceu — a única saída é o consultor dar F5. Enquanto
//  ele não der, a barra abre e nada funciona: não sabe qual conversa está
//  aberta, não envia, não analisa.
//
//  Agora quem injeta é o nosso próprio código, e por isso ele pode injetar
//  DE NOVO quando perceber que faltou, sem recarregar nada.
//
//  Este arquivo roda na página (é uma tag <script> comum), então NÃO tem acesso
//  a chrome.* — os endereços dos arquivos chegam por atributo `data-`, postos
//  por quem o injetou.
//
//  A ORDEM IMPORTA E É SEQUENCIAL: a ponte usa a wa-js. Carregar as duas de uma
//  vez às vezes funcionava e às vezes não, dependendo de qual terminava
//  primeiro — o tipo de defeito que aparece em uma máquina em cada dez.
(function () {
  'use strict';
  const eu = document.currentScript;
  if (!eu) return;
  const urlWaJs = eu.dataset.wajs || '';
  const urlPonte = eu.dataset.ponte || '';

  function carregar(url) {
    return new Promise((ok, falhou) => {
      const s = document.createElement('script');
      s.src = url;
      s.onload = () => { s.remove(); ok(); };
      s.onerror = () => { s.remove(); falhou(new Error('falhou: ' + url)); };
      (document.head || document.documentElement).appendChild(s);
    });
  }

  (async () => {
    try {
      // A wa-js NÃO tem trava contra carregar duas vezes (é biblioteca de
      // terceiro). Duas cópias remendam as entranhas do WhatsApp em cima uma da
      // outra e o envio fica lento — já custou isso uma vez. Por isso ela só
      // entra quando realmente não está lá.
      if (!window.WPP && urlWaJs) await carregar(urlWaJs);
      // A ponte tem trava própria: se já estiver de pé, o arquivo executa e sai
      // na primeira linha. Injetar de novo é barato e é justamente o que
      // conserta a aba órfã.
      if (urlPonte) await carregar(urlPonte);
      window.postMessage({ source: 'JOB_INJETOR', tipo: 'pronto',
                           temWPP: !!window.WPP,
                           temPonte: !!window.__JOB_WPP_PONTE }, '*');
    } catch (e) {
      window.postMessage({ source: 'JOB_INJETOR', tipo: 'falhou',
                           erro: String(e && e.message || e) }, '*');
    }
  })();
})();
