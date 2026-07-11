// ─── JOB Serenus · Content Script (WhatsApp Web) ────────────────────────────
//
//  ⚠️  GARANTIA DE SEGURANÇA — LEIA ANTES DE MEXER:
//  Este script é 100% LEITURA. Ele:
//    • lê a conversa que JÁ ESTÁ na tela (a sessão que VOCÊ abriu);
//    • rola o histórico pra cima devagar, como um humano, pra carregar mais;
//    • injeta um botão e um painel próprios na página.
//  Ele NUNCA:
//    • digita no campo de mensagem, clica em "enviar", nem manda nada;
//    • abre conexão de protocolo / API do WhatsApp;
//    • faz qualquer ação em massa ou automática de envio.
//  Ler o DOM da sua própria sessão é o mesmo que você lendo com os olhos —
//  é o caminho de MENOR risco possível de banir o número. Não adicione envio aqui.
//
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';
  if (window.__jobSerenusCarregado) return;
  window.__jobSerenusCarregado = true;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── Descobre o container rolável das mensagens (o WhatsApp muda as classes,
  //    então detectamos pelo comportamento: dentro do #main, o elemento que
  //    realmente rola verticalmente). ──
  function acharPainelRolavel() {
    const main = document.querySelector('#main') || document.body;
    const candidatos = main.querySelectorAll('div');
    let melhor = null, melhorAltura = 0;
    for (const el of candidatos) {
      const st = getComputedStyle(el);
      if ((st.overflowY === 'auto' || st.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight + 40) {
        if (el.scrollHeight > melhorAltura) { melhor = el; melhorAltura = el.scrollHeight; }
      }
    }
    return melhor;
  }

  // ── Nome do contato/conversa aberta (do cabeçalho). ──
  function nomeDoContato() {
    const header = document.querySelector('#main header');
    if (!header) return '';
    const comTitle = header.querySelector('span[dir="auto"][title]');
    if (comTitle && comTitle.getAttribute('title')) return comTitle.getAttribute('title').trim();
    const span = header.querySelector('span[dir="auto"]');
    return span ? (span.textContent || '').trim() : '';
  }

  // ── Telefone do contato. O WhatsApp Web novo NÃO expõe mais o JID no data-id
  //    das mensagens, então: (1) se o "nome" da conversa é um telefone (lead frio
  //    não salvo — o caso mais comum aqui), extrai os dígitos; (2) fallback:
  //    procura um JID no DOM pra versões antigas. Se não achar, o JOB casa por
  //    nome. Nunca abre a ficha do contato — só lê o que está na tela. ──
  function telefoneDoContato() {
    const nome = nomeDoContato();
    if (/^[+\d\s()\-]+$/.test(nome || '')) {
      const dig = (nome || '').replace(/\D/g, '');
      if (dig.length >= 10 && dig.length <= 15) return dig;
    }
    for (const el of document.querySelectorAll('#main [data-id]')) {
      const id = el.getAttribute('data-id') || '';
      const m = id.match(/(\d{10,15})@[cs]/);
      if (m) return m[1];
    }
    return '';
  }

  // ── Centro horizontal do painel de conversa (pra decidir direção por posição). ──
  function centroDoPainel() {
    const main = document.querySelector('#main');
    if (!main) return null;
    const r = main.getBoundingClientRect();
    return r.left + r.width / 2;
  }

  // ── Direção da mensagem por GEOMETRIA: bolha à direita = enviada por mim
  //    (consultor), à esquerda = recebida (lead). É o sinal mais à prova de
  //    mudança de layout (validado no DOM real: bate 100% com o remetente do
  //    data-pre-plain-text). Fallback: compara o remetente com o nome do contato. ──
  function direcaoDaMensagem(cp, centro, nomeContato) {
    const r = cp.getBoundingClientRect();
    if (centro != null && r.width > 0) {
      return (r.left + r.width / 2) < centro ? 'lead' : 'consultor';
    }
    const pre = cp.getAttribute('data-pre-plain-text') || '';
    const rem = ((pre.match(/\]\s*([^:]+):/) || [])[1] || '').trim();
    if (rem && nomeContato && rem === nomeContato.trim()) return 'lead';
    return rem ? 'consultor' : 'lead';
  }

  // ── Raspa todas as mensagens de texto atualmente no DOM, em ordem. ──
  //    Âncora estável: .copyable-text com data-pre-plain-text="[HH:MM, DD/MM/AAAA] Nome: ".
  function rasparMensagensVisiveis() {
    const nodes = document.querySelectorAll('#main .copyable-text[data-pre-plain-text]');
    const centro = centroDoPainel();
    const nomeContato = nomeDoContato();
    const msgs = [];
    for (const cp of nodes) {
      const pre = cp.getAttribute('data-pre-plain-text') || '';
      const mh = pre.match(/\[([^\]]+)\]/);
      const hora = mh ? mh[1] : '';
      const alvo = cp.querySelector('span.selectable-text') || cp.querySelector('.selectable-text') || cp;
      let texto = (alvo.innerText || alvo.textContent || '').trim();
      if (!texto) continue;
      msgs.push({ de: direcaoDaMensagem(cp, centro, nomeContato), texto, hora });
    }
    return msgs;
  }

  // ── Rola o histórico pra cima devagar até não carregar mais nada (ou um teto),
  //    pra pegar a conversa inteira e não só o que está na tela. Gentil e humano:
  //    pausa entre cada rolagem, nunca em loop apertado. ──
  async function carregarHistorico(painel, atualizarStatus) {
    if (!painel) return;
    let anterior = -1, estavel = 0;
    const MAX_ROLAGENS = 60;
    for (let i = 0; i < MAX_ROLAGENS; i++) {
      painel.scrollTop = 0;
      await sleep(650 + Math.floor(Math.random() * 250)); // ritmo humano
      const altura = painel.scrollHeight;
      if (atualizarStatus) atualizarStatus('Lendo histórico… (' + (i + 1) + ')');
      if (altura === anterior) {
        estavel++;
        if (estavel >= 2) break; // 2 rodadas sem crescer = chegou no começo
      } else {
        estavel = 0;
        anterior = altura;
      }
    }
    // volta pro fim (estado normal da conversa)
    painel.scrollTop = painel.scrollHeight;
    await sleep(200);
  }

  // ── Deduplica mensagens iguais em sequência (a virtualização pode repetir). ──
  function dedup(msgs) {
    const out = [];
    let ultimo = '';
    for (const m of msgs) {
      const chave = m.de + '|' + m.texto + '|' + m.hora;
      if (chave !== ultimo) out.push(m);
      ultimo = chave;
    }
    return out;
  }

  // ═══════════════ UI: botão + painel ═══════════════

  function criarBotao() {
    if (document.getElementById('job-btn')) return;
    const btn = document.createElement('button');
    btn.id = 'job-btn';
    btn.title = 'Analisar esta conversa no JOB (somente leitura)';
    btn.innerHTML = '<span class="job-btn-j">JOB</span><span class="job-btn-txt">Analisar lead</span>';
    btn.addEventListener('click', rodarAnalise);
    document.body.appendChild(btn);
  }

  function fecharPainel() {
    const p = document.getElementById('job-painel');
    if (p) p.remove();
  }

  function abrirPainel(conteudoHTML) {
    fecharPainel();
    const p = document.createElement('div');
    p.id = 'job-painel';
    p.innerHTML =
      '<div class="job-painel-topo"><span class="job-painel-titulo">JOB · Análise do lead</span>' +
      '<button class="job-painel-x" id="job-painel-x">×</button></div>' +
      '<div class="job-painel-corpo" id="job-painel-corpo">' + conteudoHTML + '</div>';
    document.body.appendChild(p);
    document.getElementById('job-painel-x').addEventListener('click', fecharPainel);
  }

  function setCorpo(html) {
    const c = document.getElementById('job-painel-corpo');
    if (c) c.innerHTML = html;
  }

  function esc(s) {
    return String(s || '').replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function corFaixa(faixa) {
    return { quente: '#1fd8a4', bom: '#4ade80', medio: '#facc15', baixo: '#fb923c' }[faixa] || '#f43f5e';
  }

  function linhaDado(rotulo, valor) {
    if (valor === null || valor === undefined || valor === '' ||
        (Array.isArray(valor) && !valor.length)) return '';
    const v = Array.isArray(valor) ? valor.join(', ') : String(valor);
    return '<div class="job-dado"><span>' + esc(rotulo) + '</span><b>' + esc(v) + '</b></div>';
  }

  function renderResultado(r, nome, telefone, totalMsgs) {
    const cor = corFaixa(r.faixa);
    const ex = r.extracao || {};
    const sugs = (r.sugestoes || []).map((s) => {
      const pc = s.prioridade === 'alta' ? '#f43f5e' : (s.prioridade === 'media' ? '#facc15' : '#8c93a8');
      return '<div class="job-sug"><div class="job-sug-tag" style="background:' + pc + '22;color:' + pc + '">' +
        esc(s.prioridade) + '</div><div class="job-sug-txt"><b>' + esc(s.titulo) + '</b><br>' +
        esc(s.detalhe) + '</div></div>';
    }).join('');
    const leadBox = r.lead
      ? '<a class="job-lead-ok" href="' + esc(r.lead.url) + '" target="_blank">Lead no CRM: <b>' +
        esc(r.lead.nome) + '</b> — abrir ficha →</a>'
      : '<div class="job-lead-nao">Nenhum lead com esse telefone/nome no CRM ainda. ' +
        '<br><span>Telefone lido: ' + esc(telefone || '—') + '</span></div>';
    const chips = '<span class="job-chip" style="border-color:' + cor + ';color:' + cor + '">' +
        esc(r.fase_funil || '') + '</span>' +
      (r.tags || []).filter((t) => t !== r.fase_funil && t !== (r.faixa || '').toUpperCase())
        .map((t) => '<span class="job-chip">' + esc(t) + '</span>').join('');
    const planoAtivo = { SEM_PLANO: 'Sem plano hoje', CANCELADO_RECENTE: 'Cancelado há pouco', ATIVO: 'Tem plano ativo' }[ex.plano_ativo];
    const tipoRot = { PJ: 'CNPJ / empresarial', ADESAO: 'Adesão (PF)', PF: 'Pessoa física' }[ex.tipo_contratacao];
    const dados =
      linhaDado('Cidade', ex.cidade) +
      linhaDado('Idade(s)', ex.idades) +
      linhaDado('Vidas', ex.vidas) +
      linhaDado('Contratação', tipoRot) +
      linhaDado('CNPJ', ex.cnpj) +
      linhaDado('Plano atual', planoAtivo && (planoAtivo + (ex.operadora_atual ? ' (' + ex.operadora_atual + ')' : ''))) +
      linhaDado('Operadora de interesse', ex.operadora_interesse) +
      linhaDado('Plano que mais gostou', ex.plano_preferido) +
      linhaDado('Urgência', ex.urgencia) +
      linhaDado('Objeções', ex.objecoes);
    const pen = (r.penalidades || []).map((p) => '<span class="job-chip job-chip-pen">' +
      esc(p.regra) + ' ' + p.pontos + '</span>').join('');
    return (
      '<div class="job-score-wrap">' +
        '<div class="job-score-num" style="color:' + cor + '">' + (r.score != null ? r.score : '—') + '</div>' +
        '<div class="job-score-meta"><div class="job-score-faixa" style="color:' + cor + '">' +
          esc((r.faixa || '').toUpperCase()) + '</div>' +
          '<div class="job-score-sub">Score Lead · 0–1000 · ' + (r.categorias_consideradas || 0) + '/' +
          (r.categorias_totais || 28) + ' critérios</div></div>' +
      '</div>' +
      '<div class="job-barra"><div class="job-barra-fill" style="width:' + Math.round((r.score || 0) / 10) + '%;background:' + cor + '"></div></div>' +
      '<div class="job-chips">' + chips + pen + '</div>' +
      leadBox +
      (dados ? '<div class="job-sec">Dados do lead</div><div class="job-dados">' + dados + '</div>' : '') +
      '<div class="job-sec">Próximas ações</div>' +
      (sugs || '<div class="job-vazio">Sem sugestões.</div>') +
      '<div class="job-sec">Follow-up sugerido</div>' +
      '<div class="job-resumo" id="job-followup">' + esc(r.followup || '') + '</div>' +
      '<button class="job-copy" id="job-copy-btn">Copiar follow-up</button>' +
      '<div class="job-sec">Como está a conversa</div>' +
      '<div class="job-resumo">' + esc(r.resumo || '').replace(/\n/g, '<br>') + '</div>' +
      '<div class="job-rodape">' + esc(nome || '') + ' · ' + totalMsgs + ' mensagens lidas · somente leitura</div>'
    );
  }

  function ligarBotaoCopiar() {
    const b = document.getElementById('job-copy-btn');
    if (!b) return;
    b.addEventListener('click', () => {
      const t = document.getElementById('job-followup');
      navigator.clipboard.writeText(t ? t.textContent : '').then(() => {
        b.textContent = 'Copiado!';
        setTimeout(() => { b.textContent = 'Copiar follow-up'; }, 1500);
      });
    });
  }

  async function rodarAnalise() {
    const btn = document.getElementById('job-btn');
    if (btn) btn.disabled = true;
    try {
      const painelRolavel = acharPainelRolavel();
      if (!painelRolavel) {
        abrirPainel('<div class="job-erro">Abra uma conversa primeiro.</div>');
        return;
      }
      abrirPainel('<div class="job-carregando"><div class="job-spin"></div><div id="job-status">Lendo a conversa…</div></div>');
      const status = (t) => { const e = document.getElementById('job-status'); if (e) e.textContent = t; };

      await carregarHistorico(painelRolavel, status);
      status('Organizando as mensagens…');
      const nome = nomeDoContato();
      const telefone = telefoneDoContato();
      const mensagens = dedup(rasparMensagensVisiveis());

      if (!mensagens.length) {
        abrirPainel('<div class="job-erro">Não achei mensagens de texto nesta conversa. ' +
          '(Conversas só de áudio/imagem ainda não são analisadas.)</div>');
        return;
      }

      status('Calculando o score no JOB…');
      const resp = await chrome.runtime.sendMessage({
        type: 'analisar',
        payload: { telefone, nome, mensagens }
      });

      if (!resp || !resp.ok) {
        abrirPainel('<div class="job-erro">' + esc((resp && resp.erro) || 'Falha ao analisar') +
          '</div><div class="job-rodape">Verifique a chave/URL no popup do JOB.</div>');
        return;
      }
      setCorpo(renderResultado(resp, nome, telefone, mensagens.length));
      ligarBotaoCopiar();
    } catch (e) {
      abrirPainel('<div class="job-erro">Erro inesperado: ' + esc(e.message) + '</div>');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  // ── Mantém o botão presente mesmo com o WhatsApp recriando a tela (SPA). ──
  criarBotao();
  const obs = new MutationObserver(() => { if (!document.getElementById('job-btn')) criarBotao(); });
  obs.observe(document.body, { childList: true, subtree: false });
})();
