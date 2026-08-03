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
//
// A partir da versão 2.83 também leva pedido de COTAÇÃO. A tela de cotação do
// JOB não consegue falar com o Painel do Corretor sozinha: quem fala é a aba do
// Painel, com a sessão do próprio corretor. A página pede aqui, a extensão faz
// lá, e o resultado volta pro JOB.
(function () {
  'use strict';

  const _SABE = ['abrir_chat', 'cotar', 'passo', 'abas', 'catalogo', 'cotador_estado',
                 'cotador_cidades', 'descobrir_modalidades', 'canario_agora'];
  let _versao = '';
  try { _versao = chrome.runtime.getManifest().version; } catch (e) { /* contexto órfão */ }

  // Lista fechada do que a página pode pedir. O que não está aqui não passa —
  // é a diferença entre uma ponte e um buraco.
  function traduzir(d) {
    if (d.tipo === 'abrir_chat') {
      return { type: 'abrir_chat_whatsapp',
               telefone: String(d.telefone || '').slice(0, 30),
               chatId: String(d.chatId || '').slice(0, 120),
               texto: String(d.texto || '').slice(0, 4000) };
    }
    // 'Testar agora' da tela de Configuracoes: a pagina pede o diagnostico na
    // hora, em vez de esperar a rodada de 6h — que era a unica forma de saber
    // se uma peca voltou a funcionar depois de uma correcao.
    if (d.tipo === 'canario_agora') return { type: 'canario_agora' };
    if (d.tipo === 'cotar') return { type: 'cotar_painel', pedido: d.pedido };
    // `aba` diz em QUAL aba do Painel executar. É o que permite a tela rodar
    // mais de uma frente ao mesmo tempo sem que duas escrevam na mesma cotação.
    if (d.tipo === 'passo') return { type: 'cotador_passo', pedido: d.pedido, aba: d.aba };
    if (d.tipo === 'abas') return { type: 'cotador_abas' };
    if (d.tipo === 'catalogo') return { type: 'cotador_catalogo', pedido: d.pedido };
    if (d.tipo === 'descobrir_modalidades') {
      return { type: 'cotador_modalidades', pedido: d.pedido };
    }
    if (d.tipo === 'cotador_estado') return { type: 'cotador_pronto' };
    if (d.tipo === 'cotador_cidades') {
      return { type: 'cotador_cidades', termo: String(d.termo || '').slice(0, 80) };
    }
    return null;
  }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== 'JOB_SITE_REQ') return;
    const pedido = traduzir(d);
    const responder = (resp) => {
      window.postMessage({ source: 'JOB_SITE_RESP', reqId: d.reqId,
                           ok: !!(resp && resp.ok), motivo: (resp && resp.motivo) || '',
                           dados: (resp && resp.dados) || null,
                           faltando: (resp && resp.faltando) || [],
                           modalidades: (resp && resp.modalidades) || [],
                           versao: (resp && resp.versao) || undefined,
                           semConversa: (resp && resp.semConversa) || undefined,
                           sabe: (resp && resp.sabe) || undefined,
                           // Quantas abas o background examinou. Vai junto pra
                           // tela poder dizer o que aconteceu de verdade em vez
                           // de chutar "deve estar fechado".
                           abas: (resp && resp.abas),
                           detalhe: (resp && resp.detalhe) || null,
                           abasExaminadas: (resp && resp.abasExaminadas) }, '*');
    };
    // "Voce esta ai?" — a pagina PERGUNTA em vez de so esperar o anuncio.
    //
    // O anuncio e postado quando este script carrega. Se isso acontecer antes
    // de a pagina ter registrado o ouvinte dela, a mensagem se perde no ar e a
    // pagina conclui que nao ha extensao — para sempre, porque anuncio nao se
    // repete. Perguntar tira a corrida do caminho.
    if (d.tipo === 'ping') {
      responder({ ok: true, versao: _versao, sabe: _SABE });
      return;
    }
    // Pedido que esta ponte nao conhece merece uma NEGATIVA, nao silencio.
    //
    // Antes ela simplesmente voltava, a pagina esperava ate estourar o tempo e
    // o tempo estourado era lido como "o Painel deve estar fechado". Custou uma
    // rodada inteira de investigacao no lugar errado. Agora, quando o site
    // pedir algo que so uma ponte mais nova sabe fazer, ele ouve isso na hora.
    if (!pedido) {
      if (d.reqId) responder({ ok: false, motivo: 'ponte_nao_conhece:' + (d.tipo || '') });
      return;
    }
    try {
      chrome.runtime.sendMessage(pedido, (resp) => {
        if (chrome.runtime.lastError) { responder({ ok: false, motivo: 'extensao_indisponivel' }); return; }
        responder(resp);
      });
    } catch (e) {
      responder({ ok: false, motivo: 'extensao_indisponivel' });
    }
  });
  // Deixa a página saber que a extensão está aqui — assim o botão só promete o
  // caminho rápido quando ele existe de verdade.
  //
  // Vai junto a VERSAO e o que esta ponte sabe fazer. Sem isso, uma aba que
  // ficou com a ponte velha (a pagina foi recarregada ANTES da extensao) se
  // anuncia igualzinho a uma nova, ignora calada o pedido de cotacao, e a tela
  // fica esperando ate estourar o tempo — e entao acusa "Painel fechado", que
  // e o diagnostico errado. Com a versao na mao, a tela sabe dizer a verdade:
  // recarregue ESTA pagina.
  // Andamento da cotação chegando da extensão: repassa pra página, que é quem
  // mostra. Sem isto a tela fica muda enquanto o Painel é consultado plano a
  // plano, e mudez de quinze segundos parece defeito.
  try {
    chrome.runtime.onMessage.addListener((m) => {
      if (m && m.type === 'cotacao_andamento') {
        window.postMessage({ source: 'JOB_SITE_RESP', tipo: 'andamento',
                             fase: m.fase, feito: m.feito, total: m.total }, '*');
      }
    });
  } catch (e) { /* sem andamento a cotação ainda funciona, só fica calada */ }

  window.postMessage({ source: 'JOB_SITE_RESP', tipo: 'extensao_presente', ok: true,
                       versao: _versao, sabe: _SABE }, '*');
})();
