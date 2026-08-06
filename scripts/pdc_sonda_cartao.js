/* SONDA — só olha e copia, não navega, não clica, não baixa nada.
   Cole no Console na tela de COMPARATIVO (a dos cartões). */
(() => {
  const bts = [...document.querySelectorAll('button, a')]
    .filter(b => /ver detalhes/i.test(b.textContent || ''));
  if (!bts.length) return console.warn('[SONDA] nenhum "Ver detalhes" nesta tela.');

  // Sobe do botão até o elemento que contém logo + preço: esse é o cartão.
  const cartaoDe = (b) => {
    let n = b;
    for (let i = 0; i < 8 && n; i++) {
      n = n.parentElement;
      if (n && n.querySelector('img') && /R\$\s*[\d.]+,\d{2}/.test(n.innerText || '')) return n;
    }
    return null;
  };

  const amostra = bts.slice(0, 4).map((b, i) => {
    const c = cartaoDe(b);
    if (!c) return { i, erro: 'cartao nao encontrado subindo do botao' };
    const img = c.querySelector('img');
    return {
      i,
      linhas: (c.innerText || '').split('\n').map(s => s.trim()).filter(Boolean),
      img_alt: img ? (img.alt || '') : '(sem img)',
      img_title: img ? (img.getAttribute('title') || '') : '',
      img_src: img ? String(img.src).slice(-90) : '',
      classes_cartao: (c.className || '').slice(0, 120),
    };
  });

  const saida = { total_cartoes: bts.length, amostra };
  console.log(saida);
  try { copy(JSON.stringify(saida, null, 1)); console.log('%c[SONDA] copiado — cole no chat.', 'color:#0a7;font-weight:bold'); }
  catch (e) { console.log('[SONDA] selecione o objeto acima, botao direito > Copy object.'); }
})();
