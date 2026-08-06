/* =====================================================================
   SONDA DE ENTIDADES — Painel do Corretor
   Cole no Console na tela de ESCOLHA DA ENTIDADE (aquela que lista
   "ANASPL", "UNICOM-Serv"... com o "i" ao lado de cada uma).

   Só lê. Não clica em seta, não navega, não baixa arquivo. A única coisa
   que ele faz além de ler é passar o mouse por cima de cada "i" para o
   tooltip aparecer — é o mesmo gesto que você faria, com pausa entre um
   e outro.

   O que interessa: o "i" traz o NOME COMPLETO da entidade e a LISTA DE
   PROFISSÕES aceitas. Na adesão isso é a primeira pergunta, não a última:
   não adianta o plano ser bom se o cliente não pode entrar na entidade.
   ===================================================================== */
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const txt = (n) => (n && (n.innerText || n.textContent) || '').trim();

  // O "i" costuma ser um botão pequeno sem texto, ou com aria-label.
  const infos = [...document.querySelectorAll('button, [role="button"], svg, span')]
    .filter(n => {
      const a = (n.getAttribute && (n.getAttribute('aria-label') || n.getAttribute('title')) || '').toLowerCase();
      if (/informa|info|detalhe|requisito|profiss/.test(a)) return true;
      const t = txt(n);
      return t === 'i' || t === 'ⓘ';
    });

  // Linha da entidade: sobe do "i" até achar um bloco com texto curto (a sigla).
  const linhaDe = (n) => {
    let p = n;
    for (let i = 0; i < 6 && p; i++) {
      p = p.parentElement;
      if (p && txt(p) && txt(p).length < 120) return p;
    }
    return null;
  };

  // Tudo que já está no DOM sem precisar de hover.
  const passivo = (n) => {
    const out = {};
    ['aria-label', 'title', 'aria-describedby', 'data-tooltip', 'data-content', 'data-state']
      .forEach(k => { const v = n.getAttribute && n.getAttribute(k); if (v) out[k] = v; });
    if (out['aria-describedby']) {
      const alvo = document.getElementById(out['aria-describedby']);
      if (alvo) out.descrito = txt(alvo).slice(0, 3000);
    }
    return out;
  };

  console.log('%c[SONDA-ENT] ' + infos.length + ' icone(s) de informacao nesta tela.',
    'color:#0a7;font-weight:bold');
  if (!infos.length) {
    console.warn('[SONDA-ENT] Nenhum "i" encontrado. Voce esta na tela que lista as ' +
      'entidades (ANASPL, UNICOM-Serv...)? Se sim, me mande um print que eu ajusto a busca.');
    return;
  }

  // Marca o que já existe na tela ANTES do hover, pra saber o que o hover criou.
  const antes = new Set([...document.querySelectorAll('body *')]);

  const achados = [];
  for (let i = 0; i < Math.min(infos.length, 12); i++) {
    const n = infos[i];
    const linha = linhaDe(n);
    const registro = {
      i,
      sigla_provavel: (txt(linha) || '').split('\n')[0] || '',
      atributos: passivo(n),
      tooltip: '',
    };

    // Hover, do jeito que um mouse faria.
    ['pointerover', 'mouseover', 'mouseenter', 'focus'].forEach(ev => {
      try { n.dispatchEvent(new MouseEvent(ev, { bubbles: true })); } catch (e) {}
    });
    await sleep(450);

    // O tooltip é o elemento novo (ou role=tooltip) com mais texto.
    const candidatos = [...document.querySelectorAll('[role="tooltip"], [data-radix-popper-content-wrapper], [class*="tooltip"], [class*="popover"]')]
      .concat([...document.querySelectorAll('body *')].filter(e => !antes.has(e)));
    const melhor = candidatos
      .map(e => txt(e))
      .filter(t => t && t.length > 20)
      .sort((a, b) => b.length - a.length)[0] || '';
    registro.tooltip = melhor.slice(0, 4000);

    ['pointerout', 'mouseout', 'mouseleave', 'blur'].forEach(ev => {
      try { n.dispatchEvent(new MouseEvent(ev, { bubbles: true })); } catch (e) {}
    });
    await sleep(250);

    achados.push(registro);
    console.log('[SONDA-ENT] ' + (registro.sigla_provavel || '?') + ' -> ' +
      (registro.tooltip ? registro.tooltip.length + ' caracteres de tooltip' : 'TOOLTIP VAZIO'));
  }

  const saida = {
    url: location.href,
    cabecalho: txt(document.querySelector('h1, h2, header')) .slice(0, 120),
    total_icones: infos.length,
    achados,
  };
  console.log(saida);
  try {
    copy(JSON.stringify(saida, null, 1));
    console.log('%c[SONDA-ENT] copiado — cole no chat.', 'color:#0a7;font-weight:bold');
  } catch (e) {
    console.log('[SONDA-ENT] botao direito no objeto acima > Copy object.');
  }
})();
