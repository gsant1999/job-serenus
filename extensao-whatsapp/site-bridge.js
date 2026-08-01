// Ponte entre o SITE do JOB e a extensão.
//
// O botão "abrir conversa" do CRM fazia window.open pro WhatsApp Web: abria uma
// aba NOVA e o WhatsApp recarregava tudo do zero — sincronizar conversa por
// conversa leva dezenas de segundos, e o consultor ficava olhando pra tela de
// carregamento cada vez que queria falar com um lead.
//
// O certo é ir pra aba que JÁ está aberta e trocar de conversa lá dentro. Só a
// extensão consegue: a página não tem como mexer em outra aba. Este arquivo é a
// única coisa que roda no site do JOB, e faz só isso — recebe o pedido por
// postMessage e repassa pro background, que acha a aba e manda abrir o chat.
//
// Escopo mínimo de propósito: ignora qualquer mensagem que não seja a nossa, não
// lê nada da página e não devolve dado nenhum pra ela além do "deu certo".
(function () {
  'use strict';
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== 'JOB_SITE_REQ' || d.tipo !== 'abrir_chat') return;
    const responder = (ok, motivo) => {
      window.postMessage({ source: 'JOB_SITE_RESP', reqId: d.reqId, ok: !!ok, motivo: motivo || '' }, '*');
    };
    try {
      chrome.runtime.sendMessage(
        { type: 'abrir_chat_whatsapp', telefone: String(d.telefone || '').slice(0, 30),
          chatId: String(d.chatId || '').slice(0, 120), texto: String(d.texto || '').slice(0, 4000) },
        (resp) => {
          if (chrome.runtime.lastError) { responder(false, 'extensao_indisponivel'); return; }
          responder(resp && resp.ok, (resp && resp.motivo) || '');
        });
    } catch (e) {
      responder(false, 'extensao_indisponivel');
    }
  });
  // Deixa a página saber que a extensão está aqui — assim o botão só promete o
  // caminho rápido quando ele existe de verdade.
  window.postMessage({ source: 'JOB_SITE_RESP', tipo: 'extensao_presente', ok: true }, '*');
})();
