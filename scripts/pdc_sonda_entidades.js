/* =====================================================================
   SONDA DE ENTIDADES — Painel do Corretor              (v2, 06/08/2026)
   Cole no Console na tela que lista as entidades ("ANASPL", "UNICOM-Serv"…),
   cada uma com um "i" ao lado.

   A v1 procurava o "i" por rótulo ou pelo texto "i" e achou ZERO: no Painel
   ele é um SVG desenhado, sem aria-label, sem title e sem texto nenhum.
   Procurar pelo ícone era o caminho errado.

   A v2 vai pela outra ponta: acha as LINHAS das entidades pelo texto e passa
   o mouse em tudo que for interativo dentro delas. E, dê certo ou não, ela
   despeja a estrutura da lista — assim, se falhar, ainda dá pra consertar sem
   você ter que rodar de novo.

   Só lê e passa o mouse. Não clica em seta, não navega, não baixa arquivo.
   ===================================================================== */
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const txt = (n) => (n && (n.innerText || n.textContent) || '').trim();
  const corpo = document.body.innerText || '';

  // ── 1. Onde estão as entidades ───────────────────────────────────────────
  // Uma linha de entidade é um elemento com pouco texto, sem filho que também
  // tenha pouco texto (ou seja: a folha da lista), e que não é botão de menu.
  const LIXO = /^(voltar|cotações|configurações|busca ans|beta|dental|adesão|pme|pf|saúde)$/i;
  const folhas = [...document.querySelectorAll('li, [role="option"], [role="menuitem"], button, a, div')]
    .filter(n => {
      const t = txt(n);
      if (!t || t.length > 70 || t.includes('\n')) return false;
      if (LIXO.test(t)) return false;
      if (!/[A-Za-zÀ-ÿ]/.test(t)) return false;
      // é folha: nenhum filho tem o mesmo texto (evita pegar o contêiner)
      return ![...n.children].some(f => txt(f) === t);
    });

  // Tira duplicata por texto, mantendo o elemento mais interno.
  const porTexto = new Map();
  folhas.forEach(n => { if (!porTexto.has(txt(n))) porTexto.set(txt(n), n); });
  const linhas = [...porTexto.values()];

  console.log('%c[SONDA-ENT] ' + linhas.length + ' linha(s) curta(s) na tela.',
    'color:#0a7;font-weight:bold');
  console.log('[SONDA-ENT] textos:', linhas.map(txt));

  // ── 2. Hover em tudo que for interativo dentro de cada linha ─────────────
  const antes = new Set([...document.querySelectorAll('body *')]);
  const novoTexto = () => {
    const cand = [...document.querySelectorAll(
      '[role="tooltip"], [data-radix-popper-content-wrapper], [class*="tooltip"], [class*="popover"], [data-state="delayed-open"]')]
      .concat([...document.querySelectorAll('body *')].filter(e => !antes.has(e)));
    return cand.map(txt).filter(t => t && t.length > 25).sort((a, b) => b.length - a.length)[0] || '';
  };

  const achados = [];
  for (const linha of linhas.slice(0, 20)) {
    const sigla = txt(linha);
    // Candidatos a "i": svg, botão, ou qualquer coisa pequena dentro da linha.
    const alvos = [linha, ...linha.querySelectorAll('svg, button, [role="button"], span, i')];
    let tooltip = '';
    for (const alvo of alvos) {
      ['pointerover', 'mouseover', 'mouseenter', 'focus'].forEach(ev => {
        try { alvo.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true })); } catch (e) {}
      });
      await sleep(380);
      tooltip = novoTexto();
      ['pointerout', 'mouseout', 'mouseleave', 'blur'].forEach(ev => {
        try { alvo.dispatchEvent(new MouseEvent(ev, { bubbles: true, cancelable: true })); } catch (e) {}
      });
      if (tooltip && tooltip !== sigla) break;
      await sleep(120);
    }
    achados.push({ sigla, tooltip: tooltip.slice(0, 4000) });
    console.log('[SONDA-ENT] ' + sigla + ' -> ' +
      (tooltip ? tooltip.length + ' caracteres' : 'sem tooltip'));
  }

  // ── 3. Diagnóstico: como a lista é montada ───────────────────────────────
  // Vai junto sempre. Se o hover não pegar nada, é com isto que eu conserto
  // sem você precisar rodar mais uma vez.
  const amostra = linhas.slice(0, 4).map(n => ({
    texto: txt(n),
    tag: n.tagName,
    classe: (n.className && String(n.className) || '').slice(0, 100),
    pai_html: (n.parentElement ? n.parentElement.outerHTML : '').slice(0, 700),
  }));

  const saida = {
    url: location.href,
    total_linhas: linhas.length,
    tem_ANASPL_na_tela: /ANASPL/i.test(corpo),
    svgs_na_tela: document.querySelectorAll('svg').length,
    achados,
    amostra_estrutura: amostra,
  };
  console.log(saida);
  try {
    copy(JSON.stringify(saida, null, 1));
    console.log('%c[SONDA-ENT] copiado — cole no chat.', 'color:#0a7;font-weight:bold');
  } catch (e) {
    console.log('[SONDA-ENT] botao direito no objeto acima > Copy object.');
  }
})();
