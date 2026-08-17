// ─── JOB Serenus · Ponte MAIN world (áudio + documentos + envio) ────────────
//
//  Roda no CONTEXTO DA PÁGINA (world: MAIN), não no content script isolado —
//  porque a wa-js (window.WPP) vive no window da página. A própria extensão
//  injeta a lib (wa-js.vendor.js, carregado ANTES deste arquivo pelo
//  manifest.json — @wppconnect/wa-js oficial, vendorizado, sem depender de
//  extensão de terceiros como o WaSpeed).
//  O content.js (isolado) pede via postMessage: baixar áudio/documento (só
//  leitura, sem apertar play/abrir nada) e, a partir da Fase 1, mandar uma
//  mensagem de texto específica — SEMPRE originada de uma ação explícita do
//  consultor na fila do CRM, nunca em massa/automático por conta própria
//  desta ponte. Se o WPP não existir, responde com erro e a análise/envio
//  segue sem essa parte.
//
// ─────────────────────────────────────────────────────────────────────────────

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
  // Conta quantas vezes esta ponte foi injetada nesta página. Serve de
  // termômetro: mais de 1 significa que a página acumulou cópias e precisa de
  // F5 — foi o que deixou o envio lento quando eu reinjetava o MAIN world.
  window.__JOB_WPP_COPIAS = (window.__JOB_WPP_COPIAS || 0) + 1;
  if (window.__JOB_WPP_PONTE) return;
  window.__JOB_WPP_PONTE = 1;

  if (window.__jobWppBridge) return;
  window.__jobWppBridge = true;

  // ── TRAVA DE NAVEGAÇÃO ────────────────────────────────────────────────────
  //
  // POR QUE EXISTE: em 04/08/2026 eu (Claude) coloquei openChatBottom dentro de
  // _mensagensDoChat pra resolver leitura de conversa @lid nunca aberta,
  // afirmando que ele "carrega na memória sem trocar a tela". Está errado —
  // ele NAVEGA (abrirChat usa exatamente esse método justamente pra abrir
  // conversa). Numa varredura de dezenas de leads, a tela do consultor passou
  // a pular de conversa em conversa enquanto ele trabalhava.
  //
  // O comentário "não use openChatBottom aqui" não impede ninguém. Isto impede.
  //
  // COMO FUNCIONA: enquanto uma rotina de LEITURA está rodando, _lendo > 0 e
  // nenhuma navegação passa. Contador (não booleano) porque leituras podem se
  // sobrepor — booleano seria zerado pela primeira que terminasse, liberando a
  // trava com outra ainda em curso. try/finally garante que nunca fica presa.
  let _lendo = 0;

  async function _comLeitura(fn) {
    _lendo++;
    try { return await fn(); } finally { _lendo--; }
  }

  // Clique humano que cai no meio de uma leitura não pode ser descartado: o
  // consultor pediu, e a alternativa (recusar) faz o site abrir o wa.me numa
  // aba nova — justamente o que o botão existe pra evitar. Leitura dura
  // segundos, então esperar um pouco resolve sem perder a intenção dele.
  async function _esperarLeitura(tetoMs) {
    const ate = Date.now() + (tetoMs || 4000);
    while (_lendo > 0 && Date.now() < ate) {
      await new Promise((r) => setTimeout(r, 100));
    }
    return _lendo === 0;
  }

  // ÚNICO caminho de navegação da ponte. Qualquer função que queira trocar a
  // conversa da tela passa por aqui — e aqui a trava é conferida.
  async function _navegarConversa(alvo) {
    if (_lendo > 0) {
      const liberou = await _esperarLeitura(4000);
      if (!liberou) {
        console.warn('[JOB] navegação recusada: leitura em andamento (alvo ' + alvo + ')');
        return { ok: false, erro: 'leitura_em_andamento' };
      }
    }
    if (!window.WPP || !window.WPP.chat) return { ok: false, erro: 'wpp_ausente' };
    if (window.WPP.chat.openChatBottom) await window.WPP.chat.openChatBottom(alvo);
    else if (window.WPP.chat.openChat) await window.WPP.chat.openChat(alvo);
    else return { ok: false, erro: 'sem_metodo_navegacao' };
    return { ok: true };
  }

  // FileReader em vez de montar a string na mao.
  //
  // A versao anterior concatenava o audio inteiro em pedacos de 32 KB e chamava
  // btoa no fim — tudo SINCRONO, na thread da pagina. Este bridge roda no MAIN
  // world, ou seja, na thread do proprio WhatsApp: um audio de 1 MB vira ~1
  // milhao de caracteres concatenados e a interface congela enquanto isso.
  // Transcrever varios seguidos multiplicava o congelamento — era o travamento
  // que o Guilherme sentia no "transcrever todos".
  //
  // readAsDataURL faz a mesma conversao no motor do navegador, fora da thread
  // de script, e avisa quando termina. O laco manual fica so como reserva.
  function blobParaBase64(blob) {
    return new Promise((resolve, reject) => {
      try {
        const fr = new FileReader();
        fr.onload = () => {
          const s = String(fr.result || '');
          const v = s.indexOf(',');
          resolve(v >= 0 ? s.slice(v + 1) : s);
        };
        fr.onerror = () => reject(fr.error || new Error('falha ao ler o áudio'));
        fr.readAsDataURL(blob);
      } catch (e) { reject(e); }
    });
  }

  function fmtHora(t) {
    try {
      const d = new Date((t || 0) * 1000);
      const p = (n) => String(n).padStart(2, '0');
      return p(d.getHours()) + ':' + p(d.getMinutes()) + ', ' +
             d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
    } catch (e) { return ''; }
  }

  // Remove mensagens repetidas pelo id (_serialized) — o getMessages devolve
  // itens duplicados quando o count pedido é maior que o total (busca no
  // servidor + cache). Vale pra texto, áudio e PDF.
  function _dedupPorId(itens) {
    const vistos = new Set();
    const out = [];
    for (const m of (itens || [])) {
      const mid = m && m.id && m.id._serialized;
      if (mid) { if (vistos.has(mid)) continue; vistos.add(mid); }
      out.push(m);
    }
    return out;
  }

  function selecionarPorLead(itens, limite) {
    // Prioriza os itens do LEAD (áudio ou documento) — é o conteúdo do cliente
    // que importa pra qualificação e pro score, não pode ficar de fora só
    // porque o consultor mandou vários itens recentes por cima. Enche o resto
    // do teto (se sobrar espaço) com os itens do consultor, mais recentes primeiro.
    const doLead = itens.filter((m) => !(m.id && m.id.fromMe));
    const doConsultor = itens.filter((m) => m.id && m.id.fromMe);
    const leadRecentes = doLead.slice(-limite);
    const espacoConsultor = Math.max(0, limite - leadRecentes.length);
    const consultorRecentes = espacoConsultor ? doConsultor.slice(-espacoConsultor) : [];
    return [...leadRecentes, ...consultorRecentes].sort((a, b) => (a.t || 0) - (b.t || 0));
  }

  async function baixarAudios(limite) {
    if (!window.WPP || !window.WPP.chat || !window.WPP.chat.downloadMedia) {
      return { erro: 'wpp_ausente' };
    }
    const chat = window.WPP.chat.getActiveChat && window.WPP.chat.getActiveChat();
    if (!chat || !chat.id) return { erro: 'sem_conversa' };
    const chatId = chat.id._serialized;
    const msgs = await _mensagensDoChat(chatId, 200);
    if (!msgs.length) return { erro: 'falha_mensagens' };
    // NÃO filtra por marca d'água (já tentamos — bug real: um áudio que ficou
    // de fora do teto numa rodada anterior, ou que não foi transcrito porque a
    // chave não estava configurada na hora, ficava escondido PRA SEMPRE, sem
    // aviso nenhum. Prioridade é nunca perder áudio de verdade — sempre manda
    // todos; manda também o id da mensagem (msg_id) pra o servidor poder
    // reaproveitar uma transcrição já feita antes pro MESMO áudio em vez de
    // pagar de novo — isso é diferente da marca d'água (nunca deixa de mandar
    // um áudio, só evita re-transcrever um que já foi transcrito com sucesso).
    const audios = _dedupPorId(msgs.filter((m) => m.type === 'ptt' || m.type === 'audio'));
    const alvos = selecionarPorLead(audios, Math.max(1, limite || 12));
    // Baixa em PARALELO (lotes de 5): o teto de áudios subiu bastante (conversas
    // de venda têm dezenas) e baixar um a um chegava perto do timeout. Cada
    // download é decrypt de rede — 5 de cada vez é rápido sem sobrecarregar.
    async function baixarUm(m) {
      try {
        const media = await window.WPP.chat.downloadMedia(m.id._serialized);
        let b64 = '', mime = 'audio/ogg';
        if (media instanceof Blob) {
          b64 = await blobParaBase64(media);
          mime = media.type || mime;
        } else if (media && media.data) {
          const s = String(media.data);
          b64 = s.indexOf(',') >= 0 ? s.split(',')[1] : s;
          mime = media.mimetype || mime;
        }
        if (b64) {
          return { de: (m.id.fromMe ? 'consultor' : 'lead'), msg_id: m.id._serialized,
                   base64: b64, mime: (mime || 'audio/ogg').split(';')[0], hora: fmtHora(m.t) };
        }
      } catch (e) { /* áudio que falhar é ignorado, nunca derruba a análise */ }
      return null;
    }
    const out = [];
    for (let i = 0; i < alvos.length; i += 5) {
      const lote = await Promise.all(alvos.slice(i, i + 5).map(baixarUm));
      for (const r of lote) if (r) out.push(r);
    }
    // encontrados = TOTAL de áudios na conversa (antes do teto), pra o painel
    // avisar "X de Y ficaram de fora" — nada de cortar em silêncio.
    return { audios: out, encontrados: audios.length };
  }

  // ── VARREDURA DIÁRIA ──
  // Lista as conversas com atividade nas últimas N horas, SEM ler mensagem
  // nenhuma: só o que o servidor precisa pra decidir o que vale analisar.
  // TODAS as conversas, com o telefone resolvido SEM tocar na rede.
  //
  // O @lid so aparecia nos cards que a extensao ja tinha visto — uma minoria dos
  // 5.502 leads. Isso e uma varredura unica que amarra tudo de uma vez: le a
  // lista inteira de conversas e, pra cada @lid, resolve o telefone pelos passos
  // LOCAIS da escada (cache lid->pn, ContactStore, getPhoneNumber). De proposito
  // fica de fora o requestPhoneNumber, que fala com o servidor do WhatsApp e
  // mexe na UI — fazer isso centenas de vezes seguidas e pedir bloqueio.
  function _telLocalDoLid(wid) {
    const WA = window.WPP;
    const dig = (v) => String((v && (v._serialized || v.user)) || v || '').replace(/\D/g, '');
    try {
      if (WA.whatsapp && WA.whatsapp.lidPnCache && WA.whatsapp.lidPnCache.getPhoneNumber) {
        const n = dig(WA.whatsapp.lidPnCache.getPhoneNumber(wid));
        if (n) return n;
      }
    } catch (e) {}
    try {
      const cm = WA.whatsapp && WA.whatsapp.ContactStore && WA.whatsapp.ContactStore.get(wid);
      if (cm) {
        try { const n = dig(WA.whatsapp.functions.getPnForLid(cm)); if (n) return n; } catch (e) {}
        const n2 = dig(cm.phoneNumber); if (n2) return n2;
      }
    } catch (e) {}
    try {
      if (WA.whatsapp && WA.whatsapp.functions && WA.whatsapp.functions.getPhoneNumber) {
        const n = dig(WA.whatsapp.functions.getPhoneNumber(wid));
        if (n) return n;
      }
    } catch (e) {}
    return '';
  }

  async function listarTodasConversas(teto) {
    if (!window.WPP || !window.WPP.chat) return { erro: 'wpp_ausente' };
    let chats = [];
    // ChatStore tem TUDO que ja carregou, sem paginar nem pedir ao servidor.
    try {
      const CS = window.WPP.whatsapp && window.WPP.whatsapp.ChatStore;
      if (CS && CS.getModelsArray) chats = CS.getModelsArray() || [];
    } catch (e) { chats = []; }
    if (!chats.length) {
      try { chats = await window.WPP.chat.list({ count: Math.max(200, teto || 2000), onlyUsers: true }); }
      catch (e) { return { erro: 'falha_lista' }; }
    }
    const out = [];
    let comLid = 0, resolvidos = 0;
    for (const c of chats.slice(0, Math.max(50, teto || 2000))) {
      try {
        if (!c || !c.id || c.isGroup) continue;
        const cid = c.id._serialized;
        if (cid.indexOf('@g.us') > 0 || cid.indexOf('status@') === 0) continue;
        let tel = '';
        if (cid.indexOf('@c.us') > 0) tel = cid.split('@')[0].replace(/\D/g, '');
        else if (cid.indexOf('@lid') > 0) { comLid++; tel = _telLocalDoLid(c.id); if (tel) resolvidos++; }
        // Sem telefone o servidor nao tem como achar o lead — nao adianta mandar.
        if (!tel) continue;
        out.push({ chat_id: cid, telefone: tel, nome: (c.formattedTitle || c.name || '') });
      } catch (e) { /* um chat problematico nao derruba a varredura */ }
    }
    return { conversas: out, total_chats: chats.length, com_lid: comLid, lid_resolvidos: resolvidos };
  }

  async function listarConversasDoDia(horas) {
    if (!window.WPP || !window.WPP.chat || !window.WPP.chat.list) return { erro: 'wpp_ausente' };
    const corte = Date.now() / 1000 - (Math.max(1, horas || 24) * 3600);
    let chats = [];
    try { chats = await window.WPP.chat.list({ count: 200, onlyUsers: true }); }
    catch (e) { return { erro: 'falha_lista' }; }
    const out = [];
    for (const c of chats) {
      try {
        if (!c || !c.id || c.isGroup) continue;
        const t = c.t || (c.lastReceivedKey && c.lastReceivedKey.t) || 0;
        if (t && t < corte) continue;
        const cid = c.id._serialized;
        // Telefone só quando o WhatsApp expõe (@c.us). Em @lid ele fica vazio de
        // propósito — quem resolve a pessoa é o servidor, pelo vínculo já salvo.
        let tel = '';
        if (cid.indexOf('@c.us') > 0) tel = cid.split('@')[0].replace(/\D/g, '');
        const ultima = (c.lastReceivedKey && c.lastReceivedKey._serialized) || '';
        out.push({ chat_id: cid, telefone: tel, nome: (c.formattedTitle || c.name || ''),
                   ultima_msg_id: ultima, ultima_msg_em: t, msgs: c.msgs ? c.msgs.length : 0 });
      } catch (e) { /* um chat problemático não pode derrubar a varredura */ }
    }
    return { conversas: out };
  }

  // Lê UMA conversa (não precisa ser a aberta), opcionalmente só o que veio
  // DEPOIS de uma mensagem — é o incremental que evita reanalisar o histórico.
  async function lerConversaDe(chatId, desdeMsgId, limite) {
    if (!window.WPP || !window.WPP.chat) return { erro: 'wpp_ausente' };
    let msgs = await _mensagensDoChat(chatId, Math.max(50, limite || 400));
    if (!msgs.length) return { erro: 'falha_mensagens' };
    msgs = _dedupPorId(msgs);
    let corte = -1;
    if (desdeMsgId) {
      corte = msgs.findIndex((m) => m.id && m.id._serialized === desdeMsgId);
    }
    // Só o que veio DEPOIS da última analisada. Se não achou a marca (mensagem
    // apagada, histórico truncado), manda tudo — perder contexto é pior que
    // pagar de novo, e o caso é raro.
    const janela = corte >= 0 ? msgs.slice(corte + 1) : msgs;
    const mensagens = [], audios = [];
    for (const m of janela) {
      const de = m.id && m.id.fromMe ? 'consultor' : 'lead';
      if (m.type === 'chat' && (m.body || '').trim()) {
        mensagens.push({ de, texto: String(m.body).slice(0, 4000), hora: fmtHora(m.t) });
      } else if (m.type === 'ptt' || m.type === 'audio') {
        audios.push({ msg_id: m.id._serialized, de, hora: fmtHora(m.t) });
      }
    }
    const ultima = msgs.length ? msgs[msgs.length - 1].id._serialized : (desdeMsgId || '');
    return { mensagens, audios, ultima_msg_id: ultima, total_janela: janela.length };
  }

  // Lista os áudios da conversa SEM baixar nada. É o que permite consultar o
  // cache antes: abrir uma conversa antiga não pode significar subir dezenas de
  // megabytes de áudio que já foram transcritos e pagos.
  async function listarAudios() {
    if (!window.WPP || !window.WPP.chat) {
      return { erro: 'wpp_ausente' };
    }
    const chat = window.WPP.chat.getActiveChat && window.WPP.chat.getActiveChat();
    if (!chat || !chat.id) return { erro: 'sem_conversa' };
    const chatId = chat.id._serialized;
    const msgs = await _mensagensDoChat(chatId, 400);
    if (!msgs.length) return { erro: 'falha_mensagens' };
    const audios = _dedupPorId(msgs.filter((m) => m.type === 'ptt' || m.type === 'audio'));
    return {
      chat_id: chatId,
      // Mais recente primeiro: é a ordem em que a transcrição interessa.
      audios: audios.map((m) => ({
        msg_id: m.id._serialized,
        de: (m.id.fromMe ? 'consultor' : 'lead'),
        t: m.t || 0,
        hora: fmtHora(m.t),
      })).sort((a, b) => (b.t || 0) - (a.t || 0)),
    };
  }

  // Baixa SÓ os áudios pedidos (os que não têm cache).
  // ACHAR e BAIXAR sem passar pelo parser de id da wa-js.
  //
  // O erro real, agora com etapa nomeada, foi:
  //   getMessageById: Cannot read properties of undefined (reading '_serialized')
  //
  // Fui ler a wa-js empacotada. getMessageById faz MsgKey.fromString(id) e depois
  // assertGetChat(key.remote). Em conversa @lid — o WhatsApp novo, que esconde o
  // telefone — esse remote nao vira um Wid valido nesta versao da lib, e estoura
  // no _serialized. E downloadMedia() chama getMessageById LOGO NA PRIMEIRA
  // LINHA, entao passar o objeto da mensagem tambem nao adiantava: ela reconverte
  // pra string e cai no mesmo lugar. Por isso as quatro tentativas anteriores
  // falharam do mesmo jeito.
  //
  // A saida: achar o modelo pela COLECAO da conversa (nenhum id e interpretado) e
  // baixar direto do modelo, refazendo o que a propria wa-js faz depois de achar
  // — cache de blob primeiro, download so se precisar.
  // AS MENSAGENS DE UM CHAT, POR DOIS CAMINHOS.
  //
  // 03/08/2026: WPP.chat.getMessages() comecou a estourar
  // "Cannot read properties of undefined (reading 'get')" — a wa-js foi por agua
  // abaixo com uma atualizacao do WhatsApp, como ela sempre vai. Como TODA
  // leitura de conversa passava por ela, caiu tudo de uma vez: analise, audio,
  // documento, checagem de resposta.
  //
  // A colecao do chat (chat.msgs.getModelsArray) e outro caminho: ja esta em
  // memoria — e o que a tela desenha —, nao monta chave a partir do id e nao
  // depende dos modulos internos que a wa-js resolve na carga. Ela vem PRIMEIRO
  // agora. getMessages fica como reforco pra quando a colecao estiver vazia
  // (conversa recem-aberta, historico ainda nao rolado), que e onde ela ajuda.
  //
  // Isto nao dispensa atualizar a wa-js quando ela quebrar — so faz a extensao
  // continuar de pe enquanto isso nao acontece.
  async function _mensagensDoChat(chatId, quantas) {
    const alvo = String(chatId || '');
    const chat = (() => {
      try { return window.WPP.chat.getActiveChat && window.WPP.chat.getActiveChat(); }
      catch (e) { return null; }
    })();
    const ehAtiva = !!(chat && chat.id && (!alvo || chat.id._serialized === alvo));

    // A COLECAO SO SERVE PRA CONVERSA ABERTA.
    //
    // Erro que custou uma varredura inteira (03/08): eu pus a colecao na frente
    // pra TODA conversa. Na aberta ela e completa — e o que a tela desenha. Em
    // conversa FECHADA o WhatsApp so mantem em memoria o que ja carregou, que e
    // quase sempre a ULTIMA mensagem. Resultado: 28 conversas lidas com UMA
    // mensagem cada, score de lixo, e nenhum aviso de que algo estava errado.
    // getMessages e quem CARREGA; a colecao so espelha o que ja esta carregado.
    if (ehAtiva) {
      try {
        if (chat.msgs && chat.msgs.getModelsArray) {
          const m = chat.msgs.getModelsArray() || [];
          if (m.length) return m;
        }
      } catch (e) { /* cai pro getMessages */ }
    }
    if (window.WPP.chat.getMessages) {
      try {
        const m = await window.WPP.chat.getMessages(alvo, { count: Math.max(12, quantas || 200) });
        if (m && m.length) return m;
      } catch (e) { /* wa-js quebrada: cai pra colecao, ver abaixo */ }
    }

    // CONVERSA QUE O CONSULTOR NUNCA ABRIU: materializa o chat e tenta de novo.
    //
    // Foi ler a wa-js empacotada que explicou o 'falha_mensagens' (27 dos 30
    // erros da fila). getMessages faz assertGetChat(), que só OLHA no
    // ChatStore — sincrono. Conversa nunca aberta não está lá, então ele fica
    // sem `lastReceivedKey`, a consulta sai sem âncora e volta vazia. A
    // própria lib tem o par disso: assertFindChat(), que faz
    // `await chat.find(e)` e materializa o chat antes de usar.
    //
    // find é BUSCA, não navegação — é o oposto do openChatBottom que eu tentei
    // de manhã e que virava a tela do consultor. Nada aqui toca na interface;
    // e a trava de navegação continua valendo, então se eu estiver errado de
    // novo ela barra em vez de deixar piscar.
    if (alvo && window.WPP.chat.find) {
      try {
        await window.WPP.chat.find(alvo);
        const m3 = await window.WPP.chat.getMessages(alvo, { count: Math.max(12, quantas || 200) });
        if (m3 && m3.length) return m3;
      } catch (e) { /* nem com find: cai pros recursos abaixo */ }
    }
    // Ultimo recurso — quando a wa-js esta quebrada (foi o caso as 11:22 de
    // 03/08). Melhor pouca mensagem que nenhuma, MAS quem chama precisa saber
    // que pode vir incompleto: por isso o total viaja no retorno da leitura.
    try {
      if (ehAtiva && chat.msgs && chat.msgs.getModelsArray) return chat.msgs.getModelsArray() || [];
      const W = window.WPP.whatsapp;
      const c2 = alvo && W && W.ChatStore && W.ChatStore.get && W.ChatStore.get(alvo);
      if (c2 && c2.msgs && c2.msgs.getModelsArray) return c2.msgs.getModelsArray() || [];
    } catch (e) { /* nada */ }

    // NAO USAR openChatBottom AQUI. Eu tentei em 04/08 pra resolver o
    // 'falha_mensagens' de conversa @lid nunca aberta, na suposicao de que ele
    // carregava o chat "na memoria sem trocar a tela". ERRADO: ele NAVEGA a
    // tela — a prova esta neste mesmo arquivo, em abrirChat(), que usa
    // exatamente este metodo justamente PARA abrir a conversa. Numa varredura
    // que percorre dezenas de leads isso vira a tela do consultor pulando de
    // conversa em conversa sozinha, piscando. Se um dia for preciso carregar
    // conversa nunca aberta, tem que ser por um caminho que comprovadamente
    // nao mexe na navegacao — e comprovado medindo, nao supondo.
    return [];
  }


  function _colecaoDaConversa() {
    const W = window.WPP && window.WPP.whatsapp;
    const chat = window.WPP.chat.getActiveChat && window.WPP.chat.getActiveChat();
    if (chat && chat.msgs && chat.msgs.getModelsArray) return chat.msgs.getModelsArray();
    if (W && W.ChatStore && chat && chat.id) {
      const c2 = W.ChatStore.get(chat.id);
      if (c2 && c2.msgs && c2.msgs.getModelsArray) return c2.msgs.getModelsArray();
    }
    return [];
  }

  // O ID DA MENSAGEM, sem o remote.
  //
  // Aqui estava o erro seguinte: eu comparava o data-id do DOM com o
  // id._serialized do store, e eles NAO SAO IGUAIS em conversa @lid. O
  // serializado tem tres partes — fromMe_remote_id — e o WhatsApp escreve no DOM
  // um remote (@lid) enquanto o store guarda outro (o telefone, @c.us), ou
  // vice-versa. Comparando a string inteira, nada casa, e a mensagem que esta na
  // TELA aparece como "nao carregada".
  //
  // A ultima parte — o id em si — e a mesma nos dois lados. E o unico pedaco que
  // identifica a mensagem sem depender de como o WhatsApp resolveu chamar a
  // pessoa naquele momento.
  function _idCru(serial) {
    const p = String(serial || '').split('_');
    return (p.length > 2 ? p.slice(2).join('_') : p[p.length - 1] || '').trim();
  }

  function _casa(modelo, alvoSerial, alvoCru) {
    if (!modelo || !modelo.id) return false;
    if (modelo.id._serialized === alvoSerial) return true;
    if (!alvoCru) return false;
    // .id.id e o id cru na wa-js; se nao existir, tira do serializado dele.
    const cru = modelo.id.id || _idCru(modelo.id._serialized);
    return !!cru && cru === alvoCru;
  }

  function _acharModelo(id) {
    const cru = _idCru(id);
    // 1) Colecao da conversa aberta — e onde a mensagem da tela SEMPRE esta.
    try {
      const m = _colecaoDaConversa().find((x) => _casa(x, id, cru));
      if (m) return { msg: m, via: 'colecao' };
    } catch (e) { /* segue */ }
    // 2) Store global.
    try {
      const W = window.WPP && window.WPP.whatsapp;
      if (W && W.MsgStore) {
        if (W.MsgStore.get) {
          const direto = W.MsgStore.get(id);
          if (direto) return { msg: direto, via: 'store' };
        }
        if (W.MsgStore.getModelsArray) {
          const m = W.MsgStore.getModelsArray().find((x) => _casa(x, id, cru));
          if (m) return { msg: m, via: 'store_varredura' };
        }
      }
    } catch (e) { /* segue */ }
    return { msg: null, via: null };
  }

  // Tira o Blob de onde ele estiver. Ordem = do mais instantaneo pro mais caro.
  //
  // O "audio nao veio apos o download" era eu olhando UM lugar so
  // (mediaData.mediaBlob.forceToBlob) depois de mandar baixar. O WhatsApp guarda
  // a midia decifrada em varios lugares dependendo de como ela chegou — se o
  // audio ja tocou, ela ja esta em memoria e nao ha nada a baixar. E por isso que
  // as outras ferramentas parecem instantaneas: elas leem o que ja esta ali, em
  // vez de pedir de novo.
  function _paraArrayBuffer(v) {
    if (!v) return null;
    if (v instanceof ArrayBuffer) return v;
    if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength).slice().buffer;
    try { return new Uint8Array(v).slice().buffer; } catch (e) { return null; }
  }

  // O BLOB MORA NO CACHE DE MIDIA, indexado por filehash — nao no modelo.
  //
  // Foi o que faltou: reli a wa-js empacotada e ela procura, NESTA ordem,
  // LruMediaStore(filehash) -> MediaBlobCache(filehash) -> mediaData.mediaBlob.
  // Eu so olhava o ultimo. Por isso "nao consegui ler o audio" mesmo depois do
  // download terminar sem erro: o audio estava decifrado, num cache que eu nao
  // consultava. E tambem por isso as outras ferramentas parecem instantaneas —
  // pra audio ja ouvido, esse cache responde na hora, sem rede.
  async function _blobPorFilehash(md) {
    const W = window.WPP && window.WPP.whatsapp;
    const fh = md && md.filehash;
    if (!fh || !W) return null;
    try {
      if (W.LruMediaStore && typeof W.LruMediaStore.get === 'function') {
        const bruto = await W.LruMediaStore.get(fh).catch(() => null);
        const ab = _paraArrayBuffer(bruto);
        if (ab) return new Blob([ab], { type: md.mimetype || 'audio/ogg' });
      }
    } catch (e) { /* proximo */ }
    try {
      if (W.MediaBlobCache && typeof W.MediaBlobCache.has === 'function'
          && W.MediaBlobCache.has(fh)) {
        const b = W.MediaBlobCache.get(fh);
        if (b) return b;
      }
    } catch (e) { /* proximo */ }
    return null;
  }

  function _blobDeQualquerLugar(msg) {
    const cand = [];
    const md = msg && msg.mediaData;
    if (md) {
      cand.push(md.mediaBlob, md._mediaBlob, md.blob, md.mediaObject, md.preview, md.fullHeightThumb);
    }
    if (msg && msg.mediaObject) cand.push(msg.mediaObject, msg.mediaObject.blob);
    for (const c of cand) {
      if (!c) continue;
      try {
        if (c instanceof Blob) return c;
        if (typeof c.forceToBlob === 'function') { const b = c.forceToBlob(); if (b) return b; }
        if (c._blob instanceof Blob) return c._blob;
        if (c.blob instanceof Blob) return c.blob;
      } catch (e) { /* proximo */ }
    }
    return null;
  }

  async function _blobDoModelo(msg) {
    // `mediaData` E PISTA, NAO PORTEIRO.
    //
    // Aqui havia `if (!msg.mediaData) throw new Error('mensagem sem midia')`, e
    // esse throw desistia ANTES do caminho 2 — o downloadMedia com o id do
    // store, que e exatamente o que existe pra quando o modelo nao tem o blob
    // em maos. Numa conversa com 107 audios, os 107 falharam com essa mesma
    // frase: mensagem encontrada (senao o erro seria "nao achei a mensagem"),
    // audio tocando na tela, e o codigo desistindo sem tentar baixar.
    //
    // A causa provavel do `mediaData` sumir e a de sempre: o WhatsApp atualiza
    // e a wa-js velha deixa de enxergar o campo (ver a receita em
    // wa-js-dependencia-critica). Mas seja qual for a causa, desistir por causa
    // de UMA pista, tendo outras tres, esta errado.
    //
    // Agora so falha depois de tentar tudo — e o erro diz o TIPO da mensagem,
    // que e o que separa "wa-js desatualizada" (tipo ptt, sem mediaData) de
    // "achei a mensagem errada" (tipo chat).
    let b = null;
    if (msg.mediaData) {
      // 1) JA ESTA AQUI? Mesma ordem da wa-js: cache por filehash primeiro (e
      //    onde o audio decifrado realmente fica). Audio ja ouvido responde
      //    aqui, sem rede — o caminho instantaneo.
      b = await _blobPorFilehash(msg.mediaData);
      if (b) return b;
    }
    b = _blobDeQualquerLugar(msg);
    if (b) return b;
    // 2) Caminho oficial da wa-js, mas com O ID DO STORE, nao o do DOM. O do
    //    store tem remote @c.us, que o parser dela entende; era o id do DOM
    //    (@lid) que estourava. Usar a funcao pronta e melhor do que refazer o
    //    que ela ja faz: ela trata cache, retentativa e video-como-documento.
    try {
      const ser = msg.id && msg.id._serialized;
      if (ser) {
        const m = await window.WPP.chat.downloadMedia(ser);
        if (m) return m;
      }
    } catch (e) { /* cai pro proximo */ }
    // Sem `mediaData` os passos abaixo dependem dele: se chegou aqui sem, o que
    // havia pra tentar ja foi tentado. Falha dizendo O TIPO, pra proxima vez
    // este erro apontar a causa em vez de repetir a mesma frase 107 vezes.
    if (!msg.mediaData) {
      throw new Error('sem mediaData (tipo: ' + (msg.type || '?') + ') — ' +
                      'wa-js pode estar desatualizada');
    }
    // 3) Baixa pelo proprio modelo e reprocura EM TODOS os lugares — inclusive
    //    o cache por filehash, que e pra onde o download escreve de verdade.
    if (typeof msg.downloadMedia === 'function') {
      await msg.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1, isUserInitiated: true });
      b = await _blobPorFilehash(msg.mediaData);
      if (b) return b;
      b = _blobDeQualquerLugar(msg);
      if (b) return b;
    }
    // 4) Ultimo recurso: o <audio> da propria bolha. Se o WhatsApp esta tocando
    //    ou ja tocou, existe um blob: URL ali — ler dele nao depende de wa-js
    //    nenhuma. So funciona depois de dar play, entao fica por ultimo.
    try {
      const ser = (msg.id && msg.id._serialized) || '';
      const cru = _idCru(ser);
      for (const el of document.querySelectorAll('#main [data-id] audio[src^="blob:"]')) {
        const linha = el.closest('[data-id]');
        const did = linha && linha.getAttribute('data-id');
        if (did && (did === ser || _idCru(did) === cru)) {
          const r = await fetch(el.src);
          const bl = await r.blob();
          if (bl && bl.size) return bl;
        }
      }
    } catch (e) { /* acabou */ }
    throw new Error('áudio não está em cache — toque o áudio uma vez e clique de novo');
  }

  // Baixa UMA midia especifica por id — imagem ou PDF. Mesmo motor do audio: o
  // _acharModelo/_blobDoModelo nunca foi especifico de audio, so o nome era.

  // ── CANARIO ──────────────────────────────────────────────────────────────
  // Verifica que cada peca AINDA EXISTE e responde. Nao envia mensagem, nao
  // baixa midia, nao abre conversa: uma rodada tem que custar quase nada, senao
  // vira mais um motivo de o WhatsApp ficar lento — que e a queixa que originou
  // metade das correcoes deste arquivo.
  //
  // Capacidade que NAO DA PRA AVALIAR agora (nenhuma conversa aberta, por
  // exemplo) e OMITIDA da resposta. Reportar 'ok' sem ter testado e pior que
  // nao reportar: verde falso e o que faz alguem parar de olhar o painel.
  async function canarioProbe() {
    const out = [];
    const p = (cap, fn) => {
      const t0 = Date.now();
      try {
        const r = fn();
        if (r === undefined) return;                 // nao avaliavel: omite
        out.push({ cap, ok: !!r, ms: Date.now() - t0,
                   detalhe: r === true || r ? null : 'nao respondeu' });
      } catch (e) {
        out.push({ cap, ok: false, ms: Date.now() - t0,
                   detalhe: String((e && e.message) || e).slice(0, 180) });
      }
    };
    p('wa_js', () => !!(window.WPP && window.WPP.chat && window.WPP.whatsapp));
    if (!(window.WPP && window.WPP.chat)) return { checagens: out };

    p('enviar', () => typeof WPP.chat.sendTextMessage === 'function' &&
                     typeof WPP.chat.sendFileMessage === 'function');
    p('baixar', () => typeof WPP.chat.downloadMedia === 'function');
    p('conta', () => {
      const id = WPP.conn && WPP.conn.getMyUserId && WPP.conn.getMyUserId();
      return !!(id && (id._serialized || id.user));
    });
    p('midia', () => {
      // O cofre onde a midia decifrada mora antes de virar blob. E o caminho
      // que a transcricao e a leitura de documento usam em conversa @lid.
      const m = window.WPP.whatsapp;
      return !!(m && (m.LruMediaStore || m.MediaBlobCache));
    });

    const chat = (() => { try { return WPP.chat.getActiveChat(); } catch (e) { return null; } })();
    // Sem conversa aberta nao da pra testar leitura — e isso nao e defeito.
    //
    // MAS TEM QUE SER DITO. O teste parcial voltava calado, a tela seguia
    // mostrando o estado da ultima rodada completa, e quem clicou em 'Testar
    // agora' lia a linha velha como se fosse a resposta do teste que ele acabou
    // de pedir. Foi o que aconteceu: 'quebrou as 11:22' continuou na tela depois
    // da correcao ja instalada, porque nao havia conversa aberta pra testar.
    if (!chat) return { checagens: out, semConversa: true };
    p('conversa', () => !!(chat.id && (chat.id._serialized || chat.id.user)));

    // O CANARIO TEM QUE TESTAR O CAMINHO QUE O PRODUTO USA. Ele chamava
    // WPP.chat.getMessages direto: quando ela quebrou (03/08), o canario acusou
    // 'a leitura das mensagens quebrou' — mas a leitura de verdade continuava
    // funcionando pela colecao do chat. Pior: 'achar_msg', que e CRITICA, ficava
    // sem dado nenhum, porque so rodava se getMessages tivesse respondido.
    // Alarme falso de um lado e cegueira do outro, na mesma queda.
    let msgs = [];
    try { msgs = await _mensagensDoChat(chat.id._serialized, 3); } catch (e) { msgs = []; }
    p('mensagens', () => Array.isArray(msgs) && msgs.length > 0);
    const alvo = (msgs || []).find((m) => m && m.id);
    if (alvo) {
      const bruto = alvo.id._serialized || String(alvo.id);
      p('achar_msg', () => {
        const a = _acharModelo(bruto);
        return !!(a && a.msg);
      });
    }
    return { checagens: out };
  }

  async function baixarMidiaPorId(ids) {
    if (!window.WPP || !window.WPP.chat) return { erro: 'wpp_ausente' };
    const out = [], erros = {};
    // 10 e nao 6: o consultor marca varios documentos de uma vez, e o teto de
    // paginas de quem le fica no servidor (24), nao aqui.
    for (const id of (ids || []).slice(0, 10)) {
      const achado = _acharModelo(id);
      if (!achado.msg) { erros[id] = 'mensagem não está carregada'; continue; }
      try {
        const blob = await _blobDoModelo(achado.msg);
        const b64 = await blobParaBase64(blob);
        const m = achado.msg;
        // EM DOCUMENTO, QUEM MANDA E O m.mimetype. O blob.type que o WhatsApp
        // devolve pra PDF ja veio 'image/jpeg' (e a miniatura da 1a pagina), e
        // com isso a carta de permanencia foi parar na pasta como OUTRO.jpeg.
        const mime = ((m.type === 'document' ? (m.mimetype || blob.type) : (blob.type || m.mimetype))
                      || (m.type === 'document' ? 'application/pdf' : 'image/jpeg')).split(';')[0];
        out.push({ msg_id: id, base64: b64, mime,
                   nome: m.filename || m.caption || (m.type === 'document' ? 'documento.pdf' : 'foto.jpg'),
                   tipo: (m.type === 'document' ? 'documento' : 'imagem') });
      } catch (e) {
        erros[id] = String((e && e.message) || e).slice(0, 90);
      }
    }
    return { arquivos: out, erros };
  }

  async function baixarAudiosPorId(ids) {
    if (!window.WPP || !window.WPP.chat || !window.WPP.chat.downloadMedia) {
      return { erro: 'wpp_ausente' };
    }
    const alvos = (ids || []).slice(0, 10);
    const out = [];
    // O motivo da falha SOBE. Antes o catch engolia tudo em silêncio e a bolha
    // só dizia "não consegui baixar o áudio" — sem saída pro consultor e sem
    // pista pra mim. Um áudio que falha continua não derrubando o lote.
    const erros = {};
    for (const id of alvos) {
      let media = null;
      const achado = _acharModelo(id);
      if (achado.msg) {
        try {
          media = await _blobDoModelo(achado.msg);
        } catch (e1) {
          erros[id] = String((e1 && e1.message) || e1 || 'falha no download').slice(0, 90);
        }
      } else {
        // Diagnostico junto: sem saber quantas mensagens estavam visiveis pro
        // codigo, "nao achei" nao diz se o problema e a busca ou a colecao.
        let n = 0;
        try { n = _colecaoDaConversa().length; } catch (e) { n = -1; }
        erros[id] = 'não achei a mensagem (' + n + ' na conversa)';
      }
      if (!media) {
        // Ultimo recurso: o caminho da wa-js. Funciona em conversa antiga
        // (@c.us), onde o parser de id dela nao tem problema nenhum.
        try { media = await window.WPP.chat.downloadMedia(id); erros[id] = ''; } catch (e) {}
      }
      if (!media) { erros[id] = erros[id] || 'mídia vazia'; continue; }
      try {
        let b64 = '', mime = 'audio/ogg';
        if (media instanceof Blob) {
          b64 = await blobParaBase64(media);
          mime = media.type || mime;
        } else if (media && media.data) {
          const str = String(media.data);
          b64 = str.indexOf(',') >= 0 ? str.split(',')[1] : str;
          mime = media.mimetype || mime;
        }
        // filehash junto: e a identidade do CONTEUDO do audio. Com ele o
        // servidor reconhece um audio ja transcrito em OUTRA conversa e nao
        // paga de novo — o caso do audio-modelo que sai pra dezenas de leads.
        const fh = (achado.msg && achado.msg.mediaData && achado.msg.mediaData.filehash) || '';
        if (b64) out.push({ msg_id: id, base64: b64, filehash: fh,
                            mime: (mime || 'audio/ogg').split(';')[0] });
        else erros[id] = 'áudio veio vazio';
      } catch (e3) {
        erros[id] = String((e3 && e3.message) || e3 || 'falha ao ler').slice(0, 90);
      }
    }
    return { audios: out, erros };
  }

  async function baixarDocumentos(limite, forcarGrandes) {
    if (!window.WPP || !window.WPP.chat || !window.WPP.chat.downloadMedia) {
      return { erro: 'wpp_ausente' };
    }
    const chat = window.WPP.chat.getActiveChat && window.WPP.chat.getActiveChat();
    if (!chat || !chat.id) return { erro: 'sem_conversa' };
    const chatId = chat.id._serialized;
    const msgs = await _mensagensDoChat(chatId, 200);
    if (!msgs.length) return { erro: 'falha_mensagens' };
    // Só PDF — é o único formato de documento que a Claude lê nativamente.
    // Sem filtro por marca d'água — mesmo motivo do áudio (ver baixarAudios).
    // O mime confiável mora em m.mediaData.mimetype (a wa-js nem sempre espelha
    // pro topo do modelo); confiar só em m.mimetype descartava o PDF em silêncio
    // (bug: CNH-e.pdf da Cintia nunca chegava ao Claude). Fallback pela extensão
    // do nome também, caso nenhum mime venha.
    const docs = _dedupPorId(msgs.filter((m) => {
      if (m.type !== 'document') return false;
      const mt = (m.mimetype || (m.mediaData && m.mediaData.mimetype) || '').toLowerCase();
      return mt === 'application/pdf' || /\.pdf$/i.test(m.filename || '');
    }));
    // Otimização: PDF que o CONSULTOR enviou (fromMe) com mais de 5 páginas é
    // quase sempre material de apoio (fotos de hospital, catálogo) — ler não
    // muda a análise do cliente e custa muito (44MB/19pág travava tudo). Então
    // pulamos e avisamos, oferecendo "avaliar mesmo assim". PDF do CLIENTE
    // (RG, comprovante, carteirinha) é sempre lido por inteiro, sem teto.
    const LIMITE_PAG_CONSULTOR = 5;
    const pulados = [];
    const _paginas = (m) => Number(m.pageCount || (m.mediaData && m.mediaData.pageCount) || 0) || 0;
    const docsFiltrados = forcarGrandes ? docs : docs.filter((m) => {
      const daConsultor = !!(m.id && m.id.fromMe);
      const pg = _paginas(m);
      if (daConsultor && pg > LIMITE_PAG_CONSULTOR) {
        pulados.push({ nome: m.filename || 'documento.pdf', paginas: pg });
        return false;
      }
      return true;
    });
    const alvos = selecionarPorLead(docsFiltrados, Math.max(1, limite || 5));
    const out = [];
    // O pedido inteiro aceita 22 MB. Parar PDFs em 12 MB evita baixar tudo e
    // só então descobrir que não cabe, deixando espaço para imagens e texto.
    const ORCAMENTO_PDF_B64 = 12 * 1024 * 1024;
    let bytesB64 = 0;
    for (const m of alvos) {
      try {
        // Retry 1x: o download da mídia falha esporadicamente (mídia ainda não
        // sincronizada) e antes o PDF sumia da análise em silêncio — conversa
        // com 2 PDFs chegava com 1 no Claude sem ninguém saber (caso 14/07).
        let media = null;
        for (let t = 0; t < 2 && !media; t++) {
          try { media = await window.WPP.chat.downloadMedia(m.id._serialized); }
          catch (e) { media = null; }
        }
        let b64 = '';
        if (media instanceof Blob) {
          b64 = await blobParaBase64(media);
        } else if (media && media.data) {
          const s = String(media.data);
          b64 = s.indexOf(',') >= 0 ? s.split(',')[1] : s;
        }
        if (b64) {
          if (bytesB64 + b64.length > ORCAMENTO_PDF_B64) break;
          bytesB64 += b64.length;
          // msg_id (igual áudio) — deixa o servidor reconhecer "esse PDF já foi
          // salvo antes" numa reanálise, em vez de gravar o mesmo arquivo de novo
          // a cada rodada (a extensão manda de novo tudo que ainda está na tela).
          out.push({ de: (m.id.fromMe ? 'consultor' : 'lead'), base64: b64,
                     nome: m.filename || 'documento.pdf', hora: fmtHora(m.t), msg_id: m.id._serialized });
        }
      } catch (e) { /* documento que falhar é ignorado, nunca derruba a análise */ }
    }
    // encontrados = PDFs elegíveis (já sem os pulados por página). Se entraram
    // menos que isso (teto de contagem OU falha de download), o painel avisa
    // "X de Y". Os pulados por página têm aviso próprio (pulados_paginas).
    return { documentos: out, encontrados: docsFiltrados.length, pulados: pulados };
  }

  // Lê as MENSAGENS DE TEXTO direto da wa-js (Store), não do DOM. Antes o
  // content.js raspava o HTML da tela (frágil: quebra quando o WhatsApp muda o
  // layout, e só pegava o que tinha rolado). Aqui vem tudo da fonte — a mesma
  // que já usamos pra áudio/PDF (getMessages) — com texto, remetente e hora
  // confiáveis, sem rolar a tela. Inclui a legenda de mídia (caption), que é
  // texto que o cliente/corretor escreveu.
  // Conversa INTEIRA, na ordem do WhatsApp, com tudo que der pra identificar.
  //
  // lerMensagens() serve pra IA e por isso joga fora o que nao tem texto. Pra
  // copiar a conversa isso nao vale: audio sem legenda e justamente o que o
  // consultor mais quer levar junto (transcrito), e uma conversa sem os "[foto]"
  // no meio perde o fio de quem respondeu o que.
  async function lerConversaCompleta(limite) {
    if (!window.WPP || !window.WPP.chat) return { erro: 'wpp_ausente' };
    const chat = window.WPP.chat.getActiveChat && window.WPP.chat.getActiveChat();
    if (!chat || !chat.id) return { erro: 'sem_conversa' };
    // A COLECAO DO CHAT primeiro (ver _mensagensDoChat): getMessages() monta
    // chave a partir do id e quebra em conversa @lid — mesma raiz do bug do
    // download — e agora tambem quebra sozinha quando o WhatsApp atualiza.
    const msgs = await _mensagensDoChat(chat.id._serialized, Math.max(50, limite || 800));
    if (!msgs.length) return { erro: 'falha_mensagens' };
    const ROTULO = { image: 'foto', video: 'vídeo', document: 'documento', sticker: 'figurinha',
                     location: 'localização', vcard: 'contato', ptt: 'áudio', audio: 'áudio' };
    const out = [];
    for (const m of _dedupPorId(msgs)) {
      if (!m || !m.id) continue;
      const tipo = m.type || 'chat';
      let texto = '';
      if (tipo === 'chat') texto = m.body || '';
      else if (m.caption) texto = m.caption;
      out.push({
        msg_id: m.id._serialized,
        de: (m.id.fromMe ? 'consultor' : 'lead'),
        tipo,
        // Ordem crua do WhatsApp: quem ordena e o t, nao a hora formatada
        // (que empata dentro do mesmo minuto e embaralha a leitura).
        t: m.t || 0,
        hora: fmtHora(m.t),
        texto: (texto || '').trim().slice(0, 4000),
        rotulo: ROTULO[tipo] || '',
        nome: (m.senderObj && (m.senderObj.pushname || m.senderObj.formattedName)) || '',
      });
    }
    out.sort((a, b) => (a.t || 0) - (b.t || 0));
    return {
      chat_id: chat.id._serialized,
      titulo: (chat.formattedTitle || chat.name || ''),
      mensagens: out,
      audios: out.filter((x) => x.tipo === 'ptt' || x.tipo === 'audio').map((x) => x.msg_id),
    };
  }

  async function lerMensagens(limite) {
    if (!window.WPP || !window.WPP.chat) return { erro: 'wpp_ausente' };
    const chat = window.WPP.chat.getActiveChat && window.WPP.chat.getActiveChat();
    if (!chat || !chat.id) return { erro: 'sem_conversa' };
    const chatId = chat.id._serialized;
    const msgs = await _mensagensDoChat(chatId, Math.max(50, limite || 500));
    if (!msgs.length) return { erro: 'falha_mensagens' };
    // DEDUP por id (_dedupPorId): pedir 'count' maior que o total faz o
    // getMessages buscar no servidor e devolver de novo mensagens que já
    // estavam no cache — vinham DUPLICADAS ("Perfeito, sem pressa." 2x).
    const out = [];
    for (const m of _dedupPorId(msgs)) {
      let texto = '';
      if (m.type === 'chat') texto = m.body || '';        // mensagem de texto
      else if (m.caption) texto = m.caption;              // legenda de imagem/vídeo/PDF
      texto = (texto || '').trim();
      if (!texto) continue;                                // pula mídia sem legenda, sistema, etc.
      out.push({ de: (m.id && m.id.fromMe ? 'consultor' : 'lead'), texto: texto.slice(0, 4000), hora: fmtHora(m.t) });
    }
    return { mensagens: out };
  }

  // Cache de resolução telefone por conversa. A escada @lid abaixo faz chamadas
  // de REDE (getPnLidEntry com fallback no servidor, requestPhoneNumber) e era
  // refeita do zero TODA vez que o consultor trocava de conversa — por isso o
  // "Verificando análise salva…" demorava. Aqui guarda o resultado por chatId:
  // número resolvido não muda (cache longo); negativa retenta rápido (o servidor
  // pode liberar o número depois). Guilherme, 19/07: "muito lento pra verificar".
  const _telCache = new Map(); // chave -> {res, ts}
  const _TEL_CACHE_POS_MS = 30 * 60 * 1000; // achou número: não muda
  const _TEL_CACHE_NEG_MS = 45 * 1000;      // não achou: retenta logo

  async function obterTelefone(resolverLid) {
    let chave = '';
    try {
      const WA = window.WPP;
      const chat = WA && WA.chat && WA.chat.getActiveChat && WA.chat.getActiveChat();
      if (chat && chat.id) {
        const id = chat.id._serialized || (chat.id.user + '@' + chat.id.server);
        chave = id + '|' + (resolverLid === false ? '0' : '1');
      }
    } catch (e) {}
    if (chave) {
      const c = _telCache.get(chave);
      if (c) {
        const ttl = (c.res && c.res.telefone) ? _TEL_CACHE_POS_MS : _TEL_CACHE_NEG_MS;
        if (Date.now() - c.ts < ttl) return c.res;
      }
    }
    const res = await _obterTelefoneResolver(resolverLid);
    // Não cacheia falha transitória de ambiente (wpp ainda carregando): retentar
    // logo pode dar certo. Número resolvido e "sem número exposto" (negativa
    // legítima) são cacheáveis.
    if (chave && res && res.erro !== 'wpp_ausente' && res.erro !== 'sem_conversa') {
      _telCache.set(chave, { res, ts: Date.now() });
    }
    return res;
  }

  async function _obterTelefoneResolver(resolverLid) {
    // resolverLid (flag remota do JOB, default true): quando false, NÃO tenta a
    // escada de resolução @lid (chega a chamar requestPhoneNumber, que às vezes
    // mexe na UI do WhatsApp). Serve de "freio de emergência" se um dia o
    // WhatsApp mudar e essa resolução passar a atrapalhar — desliga sem deploy.
    if (resolverLid === undefined) resolverLid = true;
    const WA = window.WPP;
    if (!WA || !WA.chat || !WA.chat.getActiveChat) return { erro: 'wpp_ausente' };
    const chat = WA.chat.getActiveChat();
    if (!chat || !chat.id) return { erro: 'sem_conversa' };
    const digits = (v) => (v ? String(v).replace(/\D/g, '') : '');
    const fromWid = (w) => w && (w.user || (w._serialized || '').split('@')[0]);
    const wid = chat.id;
    // Nome salvo, direto da wa-js (Store), NÃO do DOM — o WhatsApp muda a tela sem
    // avisar e quebra qualquer seletor CSS; isso aqui é o mesmo dado que alimenta a
    // tela, só que lido da fonte. Serve mesmo quando o número não é resolvível
    // (conta @lid) — o consultor ainda vê quem é e o CRM casa por nome.
    function nomeDoChat() {
      try {
        const c = chat.contact || (WA.whatsapp && WA.whatsapp.ContactStore && WA.whatsapp.ContactStore.get(wid));
        return (chat.name || chat.formattedTitle || (c && (c.name || c.pushname || c.shortName)) || '') + '';
      } catch (e) { return ''; }
    }
    // Contato normal (c.us): o número está no próprio JID.
    if (wid.server === 'c.us') {
      const n = digits(fromWid(wid));
      if (n) return { telefone: n, nome: nomeDoChat() };
    }
    // Freio de emergência remoto: se a resolução @lid estiver desligada, para
    // aqui e devolve só o nome (o CRM ainda casa por nome).
    if (!resolverLid) return { erro: 'lid_desligado', nome: nomeDoChat() };
    // @lid (business/privacidade): o número real NÃO está no cabeçalho/JID, mas a
    // wa-js tem o mapa interno lid->pn. Escada de resolução (achado do workflow).
    const cid = wid._serialized || (fromWid(wid) + '@' + wid.server);
    let nomeAchado = nomeDoChat();
    // 1) alto nível: cache + fallback no servidor (queryExists)
    try {
      if (WA.contact && WA.contact.getPnLidEntry) {
        const e = await WA.contact.getPnLidEntry(cid);
        if (e && e.contact) nomeAchado = nomeAchado || e.contact.pushname || e.contact.name || e.contact.shortName || '';
        const n = digits(fromWid(e && e.phoneNumber));
        if (n) return { telefone: n, nome: nomeAchado };
      }
    } catch (e) { /* tenta a próxima */ }
    // 2) cache síncrono lid->pn
    try {
      if (WA.whatsapp && WA.whatsapp.lidPnCache && WA.whatsapp.lidPnCache.getPhoneNumber) {
        const n = digits(fromWid(WA.whatsapp.lidPnCache.getPhoneNumber(wid)));
        if (n) return { telefone: n, nome: nomeAchado };
      }
    } catch (e) {}
    // 3) ContactModel (getPnForLid recebe o modelo, não o wid) + campo phoneNumber
    try {
      const cm = WA.whatsapp && WA.whatsapp.ContactStore && WA.whatsapp.ContactStore.get(wid);
      if (cm) {
        nomeAchado = nomeAchado || cm.pushname || cm.name || cm.shortName || '';
        try { const n = digits(fromWid(WA.whatsapp.functions.getPnForLid(cm))); if (n) return { telefone: n, nome: nomeAchado }; } catch (e) {}
        const n2 = digits(fromWid(cm.phoneNumber)); if (n2) return { telefone: n2, nome: nomeAchado };
      }
    } catch (e) {}
    // 4) função baixo nível (aceita lid wid)
    try {
      if (WA.whatsapp && WA.whatsapp.functions && WA.whatsapp.functions.getPhoneNumber) {
        const n = digits(fromWid(WA.whatsapp.functions.getPhoneNumber(wid)));
        if (n) return { telefone: n, nome: nomeAchado };
      }
    } catch (e) {}
    // 5) força o servidor a revelar e tenta de novo o passo 1 (pode falhar — o
    //    WhatsApp nem sempre libera; ainda assim tenta, é o caso legítimo de negócio
    //    respondendo quem te procurou)
    try {
      if (WA.chat.requestPhoneNumber) {
        await WA.chat.requestPhoneNumber(cid);
        const e = await WA.contact.getPnLidEntry(cid);
        if (e && e.contact) nomeAchado = nomeAchado || e.contact.pushname || e.contact.name || e.contact.shortName || '';
        const n = digits(fromWid(e && e.phoneNumber));
        if (n) return { telefone: n, nome: nomeAchado };
      }
    } catch (e) {}
    // Não achou o número de jeito nenhum — devolve pelo menos o nome (nunca deixa
    // o consultor/CRM completamente às cegas).
    return { erro: 'sem_numero_exposto', nome: nomeAchado };
  }

  // Número do PRÓPRIO WhatsApp logado nesta aba (o do consultor). Usado pelo
  // JOB pra atribuir o lead a quem está de fato conversando — o consultor do
  // popup é só fallback (é manual e vive esquecido/errado).
  async function obterMeuNumero() {
    if (!window.WPP || !window.WPP.conn || !window.WPP.conn.getMyUserId) {
      return { erro: 'wpp_ausente' };
    }
    try {
      const wid = window.WPP.conn.getMyUserId();
      const numero = wid && (wid.user || (wid._serialized || '').split('@')[0]);
      if (!numero) return { erro: 'sem_numero' };
      return { numero: String(numero) };
    } catch (e) {
      return { erro: 'falha' };
    }
  }

  // ── ID da conversa aberta AGORA (serializado). Funciona pra contato normal
  //    (c.us) E pra @lid (business/privacidade nova) — é o id interno que a
  //    wa-js aceita pra mandar, mesmo quando o telefone real não é exposto.
  //    É o jeito à prova de falha de mandar pra conversa que está na tela,
  //    sem depender de descobrir o número. ──
  // Troca de conversa POR DENTRO — sem recarregar a pagina.
  //
  // openChat aceita o id do chat; quando so temos o telefone, monta o
  // '55DDDNUMERO@c.us'. Em conversa @lid o chatId salvo e o unico caminho, e por
  // isso ele vem primeiro: o telefone as vezes nem existe do lado do WhatsApp.
  async function abrirChat(chatId, telefone, texto) {
    if (!window.WPP || !window.WPP.chat) return { erro: 'wpp_ausente' };
    const alvos = [];
    if (chatId) alvos.push(chatId);
    const dig = String(telefone || '').replace(/\D/g, '');
    if (dig) alvos.push((dig.startsWith('55') ? dig : '55' + dig) + '@c.us');
    for (const alvo of alvos) {
      try {
        // Passa pela trava: se uma leitura estiver rodando, espera ela sair
        // antes de trocar a tela (e desiste se demorar demais). É a mesma
        // porta que as rotinas de varredura encontram fechada.
        const nav = await _navegarConversa(alvo);
        if (!nav.ok) {
          if (nav.erro === 'leitura_em_andamento') return { erro: nav.erro };
          continue;   // método ausente/wpp fora: tenta o próximo alvo
        }
        // Deixa a mensagem ESCRITA na caixa, sem enviar. O consultor revisa e
        // manda — que e como ele ja trabalhava com o link wa.me?text=. Enviar
        // sozinho seria mudar o que o botao faz sem ninguem pedir.
        if (texto) {
          try {
            if (window.WPP.chat.setInputText) await window.WPP.chat.setInputText(texto, alvo);
          } catch (e) { /* abriu a conversa, que e o principal */ }
        }
        return { ok: true, chat_id: alvo };
      } catch (e) { /* tenta o proximo */ }
    }
    return { erro: 'nao_abriu' };
  }

  async function obterChatIdAtivo() {
    if (!window.WPP || !window.WPP.chat || !window.WPP.chat.getActiveChat) {
      return { erro: 'wpp_ausente' };
    }
    const chat = window.WPP.chat.getActiveChat();
    if (!chat || !chat.id) return { erro: 'sem_conversa' };
    return { chat_id: chat.id._serialized || '' };
  }

  // ── ENVIO (Fase 1) — a ÚNICA função desta ponte que manda alguma coisa pro
  //    WhatsApp. Cada chamada é uma mensagem específica que o consultor pediu
  //    explicitamente pra mandar (via fila do CRM) — nunca em massa, nunca
  //    automático sem origem rastreável. wa-js manda direto pelo chatId, sem
  //    precisar abrir/navegar até a conversa na tela primeiro. ──
  // ── CONFIRMAÇÃO REAL DE ENVIO ──────────────────────────────────────────
  // sendTextMessage/sendFileMessage resolvem assim que a mensagem entra na
  // fila LOCAL (aparece na tela com relojinho) — NÃO quando o servidor do
  // WhatsApp aceita. Reportar "enviado" aí era mentira: o consultor via
  // "enviado" e a mensagem só saía segundos depois (ou falhava em silêncio).
  // O retorno traz `sendMsgResult`, uma promise que resolve com o resultado
  // de verdade ('OK' | 'ERROR_NETWORK' | ...). Esperamos ela, com teto de
  // tempo pra nunca pendurar o envio se a confirmação não vier.
  const _CONFIRMA_MS = 12000;        // texto
  const _CONFIRMA_MS_MIDIA = 25000;  // mídia: tem upload antes (cabe no teto de 45s do chamador)
  async function _confirmarEnvio(res, tetoMs) {
    if (!res || !res.sendMsgResult) return { confirmado: false };
    try {
      const r = await Promise.race([
        Promise.resolve(res.sendMsgResult),
        new Promise((ok) => setTimeout(() => ok('__timeout__'), tetoMs || _CONFIRMA_MS)),
      ]);
      if (r === '__timeout__') return { confirmado: false };
      const st = String((r && r.messageSendResult) || r || '');
      if (st && st !== 'OK') return { confirmado: true, falhou: true, motivo: st };
      return { confirmado: true };
    } catch (e) {
      return { confirmado: false };
    }
  }

  async function enviarTexto(chatId, texto) {
    if (!window.WPP || !window.WPP.chat || !window.WPP.chat.sendTextMessage) {
      return { erro: 'wpp_ausente' };
    }
    if (!chatId || !texto) return { erro: 'parametros_invalidos' };
    try {
      const res = await window.WPP.chat.sendTextMessage(chatId, texto);
      const msgId = (res && res.id && res.id._serialized) || (res && res._serialized) || null;
      const c = await _confirmarEnvio(res);
      if (c.falhou) return { ok: false, erro: 'WhatsApp não aceitou o envio (' + c.motivo + ')' };
      return { ok: true, wpp_msg_id: msgId, confirmado: c.confirmado };
    } catch (e) {
      return { ok: false, erro: String((e && e.message) || e).slice(0, 200) };
    }
  }

  // ── SALVAR CONTATO NA AGENDA ──────────────────────────────────────────
  //
  // O consultor quer o lead salvo no telefone dele. O caminho que existia era
  // baixar um .vcf na pasta de downloads do COMPUTADOR e se virar pra levar
  // até o celular — ninguém faz isso no meio de um atendimento.
  //
  // A wa-js expõe `contact.save`, que é a MESMA ação do "Adicionar contato" do
  // WhatsApp Web. Com `syncToAddressbook` ele grava na conta e o WhatsApp
  // sincroniza pro aparelho — que é como o contato chega na agenda do celular
  // sem pedir autorização de Google nem de Apple.
  //
  // A assinatura mudou entre versões da wa-js: umas recebem
  // (wid, nome, {lastName, syncToAddressbook}), outras
  // (wid, nome, sobrenome, {syncToAddressbook}). Tento a primeira e caio na
  // segunda — adivinhar UMA e errar é o botão que não faz nada.
  async function salvarContato(chatId, nome, sobrenome) {
    if (!window.WPP || !window.WPP.contact || typeof window.WPP.contact.save !== 'function') {
      return { ok: false, erro: 'sem_suporte' };
    }
    if (!chatId || !nome) return { ok: false, erro: 'parametros_invalidos' };
    const primeiro = String(nome).trim();
    const ultimo = String(sobrenome || '').trim();
    const opts = { lastName: ultimo, surname: ultimo, syncToAddressbook: true };
    try {
      await window.WPP.contact.save(chatId, primeiro, opts);
      return { ok: true, forma: 'objeto' };
    } catch (e1) {
      try {
        await window.WPP.contact.save(chatId, primeiro, ultimo, { syncToAddressbook: true });
        return { ok: true, forma: 'posicional' };
      } catch (e2) {
        return { ok: false, erro: String((e2 && e2.message) || e2).slice(0, 200) };
      }
    }
  }

  // ── ENVIO DE MÍDIA (item A): recebe a mídia já em dataURL (o background
  //    baixou do JOB — a página não pode por causa do CSP do WhatsApp) e manda
  //    pela wa-js. Áudio vai como NOTA DE VOZ (isPtt) — igual "gravado na hora"
  //    do ZapVoice, não como arquivo. ──
  async function enviarMidia(chatId, tipo, dataUrl, legenda, nomeArquivo) {
    if (!window.WPP || !window.WPP.chat || !window.WPP.chat.sendFileMessage) {
      return { erro: 'wpp_ausente' };
    }
    if (!chatId || !dataUrl) return { erro: 'parametros_invalidos' };
    try {
      const opts = {};
      if (tipo === 'audio') { opts.type = 'audio'; opts.isPtt = true; }
      else if (tipo === 'imagem') { opts.type = 'image'; if (legenda) opts.caption = legenda; }
      else if (tipo === 'video') { opts.type = 'video'; if (legenda) opts.caption = legenda; }
      else {
        // Documento TAMBÉM aceita caption (DocumentMessageOptions estende
        // FileMessageOptions) — antes a legenda do PDF era descartada em
        // silêncio (reclamação do Danilo) e o nome ia fixo como 'documento'.
        opts.type = 'document';
        opts.filename = nomeArquivo || 'documento.pdf';
        if (legenda) opts.caption = legenda;
      }
      const res = await window.WPP.chat.sendFileMessage(chatId, dataUrl, opts);
      const msgId = (res && res.id && res.id._serialized) || (res && res._serialized) || null;
      // Mesma confirmação real do texto — mídia é ainda mais sujeita a demora
      // (upload do arquivo antes do envio), então "enviado" otimista enganava mais.
      const c = await _confirmarEnvio(res, _CONFIRMA_MS_MIDIA);
      if (c.falhou) return { ok: false, erro: 'WhatsApp não aceitou o envio (' + c.motivo + ')' };
      return { ok: true, wpp_msg_id: msgId, confirmado: c.confirmado };
    } catch (e) {
      return { ok: false, erro: String((e && e.message) || e).slice(0, 200) };
    }
  }

  // ── APAGAR CONVERSA (Fase 2): quando o consultor decide limpar um contato que
  //    não respondeu à campanha. Irreversível no WhatsApp — só é chamado por ação
  //    explícita do consultor (botão), nunca automático. ──
  async function apagarConversa(chatId) {
    if (!window.WPP || !window.WPP.chat || !window.WPP.chat.delete) return { erro: 'wpp_ausente' };
    if (!chatId) return { erro: 'parametros_invalidos' };
    try {
      const r = await window.WPP.chat.delete(chatId);
      return { ok: true, status: (r && r.status) || 200 };
    } catch (e) {
      return { ok: false, erro: String((e && e.message) || e).slice(0, 200) };
    }
  }

  // ── INBOUND (Fase 2): escuta mensagens RECEBIDAS e avisa o content script.
  //    Repassa SÓ o chatId (nunca o conteúdo) — o content script decide se é um
  //    número de campanha em vigília antes de reportar ao JOB. Registra UMA vez,
  //    quando a wa-js fica pronta (pode não estar no load). ──
  let _jobInboundLigado = false;
  function ligarInbound() {
    if (_jobInboundLigado || !window.WPP || !window.WPP.on) return;
    try {
      window.WPP.on('chat.new_message', (msg) => {
        try {
          if (!msg || !msg.id || msg.id.fromMe) return;   // só o que ENTROU (do contato)
          const chatId = (msg.id.remote && msg.id.remote._serialized)
            || (msg.from && msg.from._serialized) || '';
          if (chatId) {
            window.postMessage({ source: 'JOB_EXT_EVT', tipo: 'inbound', chatId }, '*');
            // Envia o texto da mensagem para o Caça-Documentos
            if (msg.body && typeof msg.body === 'string') {
              window.postMessage({ source: 'JOB_EXT_EVT', tipo: 'inbound_texto',
                                   chatId, texto: msg.body }, '*');
            }
          }
        } catch (e) { /* nunca derruba a wa-js */ }
      });
      _jobInboundLigado = true;
    } catch (e) { /* tenta de novo no timer */ }
  }
  // A wa-js agora chega DEPOIS que o WhatsApp abre (ela custava meio segundo
  // de compilacao disputando a thread com a inicializacao dele). Esta ronda e
  // o que reata o gancho quando ela finalmente aparece — e o teto existe pra
  // nao ficar batendo pra sempre se ela nao vier.
  ligarInbound();
  let _jobInboundTentativas = 0;
  const _jobInboundTimer = setInterval(() => {
    ligarInbound();
    if (_jobInboundLigado || ++_jobInboundTentativas > 100) clearInterval(_jobInboundTimer);
  }, 3000);

  // ── Checa por LEITURA se um chat já teve resposta do contato (fallback do evento
  //    chat.new_message, que nem sempre dispara). Lê as últimas msgs e vê se a mais
  //    recente NÃO é nossa (fromMe===false) = o contato respondeu. Mais confiável. ──
  async function checarInbound(chatId) {
    if (!window.WPP || !window.WPP.chat) return { inbound: false };
    try {
      const msgs = await _mensagensDoChat(chatId, 12);
      if (!msgs || !msgs.length) return { inbound: false };
      let nossas = 0;
      for (const m of msgs) { if (m && m.id && m.id.fromMe) nossas++; }
      const ult = msgs[msgs.length - 1];
      const ultimaDoContato = !!(ult && ult.id && ult.id.fromMe === false);
      // Só conta como "respondeu p/ disparar o funil" se: a última mensagem é do
      // CONTATO **e** a gente só mandou UMA vez (a saudação). Se houver 2+ nossas,
      // um humano já respondeu (mesmo pelo celular) — NÃO dispara o funil.
      return { inbound: !!(ultimaDoContato && nossas <= 1) };
    } catch (e) { return { inbound: false }; }
  }

  // TIPOS QUE SÓ LEEM. Enquanto um deles roda, _navegarConversa recusa —
  // então nenhuma leitura consegue trocar a tela do consultor, nem por
  // engano de quem editar essas funções depois.
  //
  // A marcação fica AQUI, no despacho, e não dentro de cada função: é um lugar
  // só em vez de treze, e um tipo de leitura novo que alguém adicione amanhã
  // só precisa entrar nesta lista pra já nascer protegido.
  //
  // 'abrir_chat', 'enviar_*' e 'apagar_conversa' NÃO entram: são ações que o
  // consultor pediu, e navegar é o trabalho delas.
  const _TIPOS_LEITURA = new Set([
    'baixar_audios', 'listar_audios', 'listar_conversas_dia', 'listar_todas_conversas',
    'ler_conversa_de', 'baixar_audios_ids', 'baixar_midia_ids', 'canario',
    'baixar_documentos', 'ler_mensagens', 'ler_conversa_completa',
    'obter_telefone', 'obter_meu_numero', 'obter_chat_id', 'checar_inbound',
  ]);

  window.addEventListener('message', async (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== 'JOB_EXT_REQ') return;
    let resp;
    const _ehLeitura = _TIPOS_LEITURA.has(d.tipo);
    if (_ehLeitura) _lendo++;
    try {
      if (d.tipo === 'baixar_audios') resp = await baixarAudios(d.limite);
      else if (d.tipo === 'listar_audios') resp = await listarAudios();
      else if (d.tipo === 'listar_conversas_dia') resp = await listarConversasDoDia(d.horas);
      else if (d.tipo === 'listar_todas_conversas') resp = await listarTodasConversas(d.teto);
      else if (d.tipo === 'ler_conversa_de') resp = await lerConversaDe(d.chatId, d.desdeMsgId, d.limite);
      else if (d.tipo === 'baixar_audios_ids') resp = await baixarAudiosPorId(d.ids);
      else if (d.tipo === 'baixar_midia_ids') resp = await baixarMidiaPorId(d.ids);
      else if (d.tipo === 'canario') resp = await canarioProbe();
      else if (d.tipo === 'baixar_documentos') resp = await baixarDocumentos(d.limite, d.forcarGrandes);
      else if (d.tipo === 'ler_mensagens') resp = await lerMensagens(d.limite);
      else if (d.tipo === 'ler_conversa_completa') resp = await lerConversaCompleta(d.limite);
      else if (d.tipo === 'obter_telefone') resp = await obterTelefone(d.resolverLid);
      else if (d.tipo === 'obter_meu_numero') resp = await obterMeuNumero();
      else if (d.tipo === 'obter_chat_id') resp = await obterChatIdAtivo();
      else if (d.tipo === 'abrir_chat') resp = await abrirChat(d.chatId, d.telefone, d.texto);
      else if (d.tipo === 'enviar_texto') resp = await enviarTexto(d.chatId, d.texto);
      else if (d.tipo === 'enviar_midia') resp = await enviarMidia(d.chatId, d.midiaTipo, d.dataUrl, d.legenda, d.nomeArquivo);
      else if (d.tipo === 'salvar_contato') resp = await salvarContato(d.chatId, d.nome, d.sobrenome);
      else if (d.tipo === 'apagar_conversa') resp = await apagarConversa(d.chatId);
      else if (d.tipo === 'checar_inbound') resp = await checarInbound(d.chatId);
      else return;
    } catch (e) { resp = { erro: 'excecao' }; }
    finally {
      // SEMPRE solta a trava — inclusive no `return` do else (tipo
      // desconhecido) e em qualquer exceção. Contador preso em 1 travaria a
      // navegação pro resto da vida da aba, e o consultor ficaria com o botão
      // "Abrir conversa" morto sem nenhuma pista do motivo.
      if (_ehLeitura) _lendo--;
    }
    resp.source = 'JOB_EXT_RESP';
    resp.reqId = d.reqId;
    window.postMessage(resp, '*');
  });
})();
