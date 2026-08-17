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
  // TRAVA DE INJECAO DUPLA.
  //
  // Quando a extensao e recarregada, o service worker reinjeta os scripts nas
  // abas que ja estavam abertas, pra ninguem precisar dar F5 na mao. Sem esta
  // trava, uma aba que ainda tem o script vivo receberia um segundo — e no
  // mundo MAIN isso embrulharia o window.fetch duas vezes.
  //
  // O flag mora no `window` de CADA MUNDO. No MAIN ele sobrevive a recarga da
  // extensao (e o script de la continua funcionando, porque nao usa API da
  // extensao); no ISOLADO ele nasce limpo, que e justamente onde a reinjecao
  // precisa acontecer.
  // No mundo ISOLADO a trava pergunta se o script anterior ainda FALA com a
  // extensao. Depois de uma recarga, o contexto antigo pode continuar existindo
  // — mas morto: qualquer chamada a chrome.* estoura. Uma trava booleana pura
  // bloquearia justamente a reinjecao que conserta, e o conserto viraria
  // enfeite silencioso.
  if (window.__JOB_PAINEL_PONTE && window.__JOB_PAINEL_PONTE_VIVO()) return;
  window.__JOB_PAINEL_PONTE = 1;

  // O COTADOR DA PÁGINA É INJETADO DAQUI, NÃO PELO MANIFEST.
  //
  // Mesma razão do WhatsApp: pelo manifest ele só entra no carregamento. Se
  // faltar, a cotação simplesmente não acontece e ninguém sabe por quê.
  // `cotador-painel.js` tem trava própria (__JOB_COTADOR), então injetar de
  // novo é barato e não duplica nada.
  let _resolverCotador;
  const _cotadorPronto = new Promise((ok) => { _resolverCotador = ok; });
  (function _injetarCotador() {
    try {
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('cotador-painel.js');
      s.onload = () => { s.remove(); _resolverCotador(); };
      s.onerror = () => _resolverCotador();
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { _resolverCotador(); }
  })();
  window.__JOB_PAINEL_PONTE_VIVO = function () {
    try { return !!(chrome && chrome.runtime && chrome.runtime.id); }
    catch (e) { return false; }
  };


  // Guardado POR ENDEREÇO, não misturado.
  //
  // O beta e o Painel de produção são servidores diferentes, com deploys
  // diferentes — os identificadores de função de um não valem no outro. Uma
  // chave só para os dois faria o que fosse aprendido por último sobrescrever
  // o outro, e a cotação sairia chamando a função errada sem dar erro.
  const CHAVE = 'cotador_painel_hashes:' + location.origin;
  const CHAVE_MOD = 'cotador_painel_modalidades:' + location.origin;
  const pendentes = new Map();
  let seq = 0;

  // O QUE UM APRENDE, TODOS RECEBEM — mas a máquina local sempre tem razão.
  //
  // O `next-action` é gerado por BUILD, não por usuário: é a mesma string pros
  // oito consultores. Hoje cada máquina reaprende sozinha, e um deploy da
  // Trindade custa oito aprendizados manuais pra descobrir a mesma coisa.
  //
  // A nuvem entra como PALPITE, nunca como verdade. Deu 404, o cotador apaga o
  // papel (já fazia isso), a máquina reaprende observando e publica o novo.
  // Esta ordem é o que protege do deploy gradual: quando duas versões do Painel
  // coexistem, o hash certo numa máquina é 404 na outra — e aí cada uma
  // converge pro servidor que ELA está atingindo, sem uma derrubar a outra.
  //
  // Só o HASH atravessa. A `arvore` (next-router-state-tree) fica local até
  // alguém confirmar que ela não carrega nada do corretor.
  const PAPEIS_CONHECIDOS = ['criar', 'abrir', 'vidas', 'filtro', 'operadoras',
                             'planos', 'preco', 'entidade'];
  let ultimoPublicado = {};

  function publicarNaNuvem(dados) {
    try {
      const vivos = {}, mortos = [];
      PAPEIS_CONHECIDOS.forEach((k) => {
        const agora = dados[k] && dados[k].hash;
        const antes = ultimoPublicado[k];
        if (agora) vivos[k] = agora;
        // Só é MORTE quando havia hash e ele sumiu — o cotador zera o papel
        // exatamente no 404. Papel que nunca existiu não é morte, é silêncio,
        // e mandar isso como morte apagaria o acerto de outra máquina.
        else if (antes) mortos.push({ papel: k, hash: antes });
      });
      if (!Object.keys(vivos).length && !mortos.length) return;
      ultimoPublicado = vivos;
      chrome.runtime.sendMessage(
        { type: 'cotador_nuvem_gravar', origem: location.origin, papeis: vivos, mortos },
        () => { void chrome.runtime.lastError; });
    } catch (e) { /* sem nuvem, continua funcionando como antes */ }
  }

  // PERGUNTAR A NUVEM DE NOVO, NA HORA DA FALHA.
  //
  // Antes isto rodava UMA vez, quando a aba do Painel carregava. Parece
  // suficiente e nao e: o hash e publicado por quem cotou primeiro, e nao ha
  // nenhuma razao pra isso acontecer ANTES de a aba dos outros abrir. Quem
  // deixou a aba aberta de manha ficava com o que a nuvem tinha as 8h — e
  // quando o cotador falhava, mandava a pessoa ensinar de novo uma coisa que
  // ja estava guardada no servidor havia dez minutos.
  //
  // `preferirNuvem`: quando o cotador falhou porque o hash guardado nao vale
  // mais (deploy da Trindade), o local esta ERRADO e a nuvem e a fonte boa.
  // Na carga da pagina e o contrario: o local ja foi provado nesta maquina.
  function lerNuvem(preferirNuvem, aoTerminar) {
    const pronto = typeof aoTerminar === 'function' ? aoTerminar : function () {};
    let respondeu = false;
    const terminar = (v) => { if (!respondeu) { respondeu = true; pronto(v); } };
    try {
      chrome.storage.local.get([CHAVE], (r) => {
        const d = (r && r[CHAVE]) || null;
        try {
          chrome.runtime.sendMessage(
            { type: 'cotador_nuvem_ler', origem: location.origin },
            (resp) => {
              void chrome.runtime.lastError;
              const nuvem = (resp && resp.ok && resp.papeis) || null;
              if (!nuvem) { terminar(false); return; }
              const novos = {};
              Object.keys(nuvem).forEach((k) => {
                if (typeof nuvem[k] !== 'string') return;
                const local = d && d[k] && d[k].hash;
                if (!local || (preferirNuvem && local !== nuvem[k])) {
                  novos[k] = { hash: nuvem[k], arvore: null };
                }
              });
              if (!Object.keys(novos).length) { terminar(false); return; }
              window.postMessage({ source: 'JOB_COTADOR_BRIDGE', tipo: 'restaurar',
                                   dados: novos }, '*');
              // Guarda o palpite: se funcionar, na proxima abertura ja vale
              // como local e a nuvem nem precisa ser consultada.
              try {
                chrome.storage.local.set({ [CHAVE]: { ...(d || {}), ...novos } });
              } catch (e2) {}
              terminar(true);
            });
        } catch (e2) { terminar(false); }
      });
    } catch (e) { terminar(false); }
    // Sem resposta em 4s, quem esta esperando segue a vida. Melhor uma
    // tentativa que falha rapido que uma tela parada.
    setTimeout(() => terminar(false), 4000);
  }

  // Devolve o que foi aprendido em sessões anteriores assim que a página carrega.
  try {
    chrome.storage.local.get([CHAVE, CHAVE_MOD], (r) => {
      const d = (r && r[CHAVE]) || null;
      const mods = (r && r[CHAVE_MOD]) || [];
      _cotadorPronto.then(() => {
        if (d || mods.length) {
          window.postMessage({ source: 'JOB_COTADOR_BRIDGE', tipo: 'restaurar',
                               dados: { ...(d || {}), modalidades: mods } }, '*');
        }
        // O aprendizado local completo continua sendo a fonte principal. Ao
        // reabrir o Painel, republica os identificadores seguros no JOB para
        // que outra máquina também possa usá-los sem refazer uma cotação só
        // para ensinar. A árvore de sessão nunca sai deste navegador.
        publicarNaNuvem(d || {});
        // Depois do local, pergunta à nuvem — e só usa o que falta aqui.
        lerNuvem(false);
      });
    });
  } catch (e) { /* sem armazenamento a extensão aprende de novo, só isso */ }

  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== 'JOB_COTADOR') return;

    // O cotador travou por falta de hash (ou com hash vencido) e esta pedindo
    // pra consultar a nuvem AGORA, antes de mandar alguem ensinar de novo.
    if (d.tipo === 'nuvem_agora') {
      lerNuvem(!!d.preferirNuvem, (achou) => {
        window.postMessage({ source: 'JOB_COTADOR_BRIDGE', tipo: 'nuvem_respondeu',
                             reqId: d.reqId, achou: !!achou }, '*');
      });
      return;
    }

    if (d.tipo === 'aprendeu' && d.dados) {
      try { chrome.storage.local.set({ [CHAVE]: d.dados }); } catch (e) { /* idem */ }
      publicarNaNuvem(d.dados);
      // AVISA O JOB QUE JÁ APRENDEU.
      //
      // Aqui a corrente parava. A extensão reaprendia na hora em que o
      // consultor refazia o passo no Painel, guardava, e não contava pra
      // ninguém — a tela do JOB seguia com "Falta ensinar uma vez" na cara
      // dele até apertar F5. Era esse o F5.
      //
      // Agora o aviso segue pro background, que repassa às abas do JOB. A tela
      // confere de novo sozinha e volta a cotar sem recarregar nada.
      try {
        const papeis = Object.keys(d.dados).filter((k) => d.dados[k] && d.dados[k].hash);
        chrome.runtime.sendMessage({ type: 'cotador_aprendeu', papeis },
                                   () => { void chrome.runtime.lastError; });
      } catch (e) { /* sem o aviso, volta a depender do F5 — não quebra nada */ }
      return;
    }
    // A extensao descobriu sozinha como se chama um codigo: manda pro JOB
    // guardar. Sem passar pelo consultor — era isso que estava sobrando.
    if (d.tipo === 'modalidade_nomeada' && d.codigo != null && d.nome) {
      try {
        chrome.runtime.sendMessage({ type: 'modalidade_nomeada',
                                     codigo: d.codigo, nome: d.nome },
                                   () => { void chrome.runtime.lastError; });
      } catch (e) { /* sem JOB, o nome fica so nesta aba */ }
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
            fase: d.fase, feito: d.feito, total: d.total,
            planoChave: d.planoChave || '' },
          () => { void chrome.runtime.lastError; });
      } catch (e) { /* sem ouvinte, o andamento simplesmente não aparece */ }
      return;
    }
    if (d.tipo === 'resposta') {
      pendentes.delete(d.reqId);
      clearTimeout(espera.relogio);
      espera.responder({ ok: !!d.ok, motivo: d.motivo || '', faltando: d.faltando || [],
                         dados: d.dados || null, detalhe: d.detalhe || null });
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
    cotar_aqui:       ['cotar',    90000],  // preço é sequencial: 20 planos dão uns 15s
    cotador_estado:   ['estado',    5000],
    cotador_cidades:  ['cidades',   8000],
    cotador_catalogo: ['catalogo', 180000], // uma cidade tem ~19 operadoras, uma a uma
    cotador_modalidades: ['descobrir_modalidades', 40000],
    cotador_passo: ['passo', 30000],   // uma acao so: nunca deveria demorar tanto
    cotador_precos_lote: ['passo', 45000],
  };

  // ══ MANTER A SESSÃO VIVA ══════════════════════════════════════════════
  //
  // A dor diária: a sessão do Painel expira por inatividade e o consultor tem
  // que logar de novo no meio do atendimento. O sistema deles usa expiração
  // deslizante — cada requisição empurra o prazo pra frente.
  //
  // Então, enquanto a aba do Painel estiver ABERTA, este toque leve renova o
  // prazo. Não é login automático nem credencial guardada: é a mesma coisa que
  // acontece quando alguém deixa a aba aberta e clica de vez em quando. Sai do
  // navegador dele, com a sessão dele, do IP dele.
  //
  // Quatro cuidados, e cada um tem motivo:
  //   • Só com a aba aberta. Sem aba, não há o que renovar — e forjar sessão
  //     sem navegador é exatamente o rastro que não pode existir.
  //   • Intervalo longo (7 min) e com variação aleatória. Batida de relógio
  //     perfeita é a assinatura mais óbvia de robô que existe.
  //   • Pausa quando a aba está escondida há muito tempo: computador fechado
  //     não fica batendo no servidor deles.
  //   • HEAD na raiz do próprio site. É o menor pedido possível e não lê nem
  //     escreve dado nenhum.
  const _KEEPALIVE_BASE = 7 * 60 * 1000;
  let _ultimoToque = Date.now();

  function _agendarToque() {
    // ±90s de variação: sem isso são 8 requisições por hora no mesmo segundo.
    const atraso = _KEEPALIVE_BASE + Math.floor((Math.random() - 0.5) * 180000);
    setTimeout(async () => {
      try {
        // Aba escondida há mais de 2h: a pessoa não está trabalhando aqui.
        const parado = Date.now() - _ultimoToque > 2 * 60 * 60 * 1000;
        if (!document.hidden || !parado) {
          await fetch(location.origin + '/', { method: 'HEAD', credentials: 'include', cache: 'no-store' });
          _ultimoToque = Date.now();
        }
      } catch (e) { /* rede caiu: o próximo toque tenta */ }
      _agendarToque();
    }, atraso);
  }
  // Qualquer atividade real da pessoa também conta como toque — aí o nosso
  // nem precisa acontecer.
  ['click', 'keydown', 'visibilitychange'].forEach((ev) =>
    document.addEventListener(ev, () => { if (!document.hidden) _ultimoToque = Date.now(); }, true));
  _agendarToque();

  // Diz ao JOB que esta aba existe. É o que permite a extensão parar de dizer
  // "abra o Painel" quando ele já está aberto.
  try {
    chrome.runtime.sendMessage({ type: 'painel_vivo', origem: location.origin },
      () => { void chrome.runtime.lastError; });
  } catch (e) { /* sem background: segue */ }

  // FILA RAPIDA SEM TOCAR NO PAINEL.
  //
  // O alarme do Manifest V3 so pode acordar o worker em intervalos longos e
  // fazia cada etapa remota esperar ate um minuto. Esta ponte ja esta viva
  // enquanto a aba do Painel esta aberta, entao apenas acorda o background
  // para ele consultar o JOB. Nenhuma chamada sai para o Painel aqui.
  function _acordarFila() {
    try {
      chrome.runtime.sendMessage({ type: 'painel_fila_tick' },
        () => { void chrome.runtime.lastError; });
    } catch (e) { /* extensao recarregando: a reinjecao retoma */ }
    const atraso = 1600 + Math.floor(Math.random() * 700);
    setTimeout(_acordarFila, atraso);
  }
  setTimeout(_acordarFila, 1200);

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !ACEITOS[msg.type]) return;
    const [tipo, limite] = ACEITOS[msg.type];
    perguntarPagina(tipo, { pedido: msg.pedido, termo: msg.termo }, sendResponse, limite);
    return true;
  });
})();
