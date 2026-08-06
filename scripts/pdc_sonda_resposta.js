/* =====================================================================
   SONDA DA RESPOSTA — Painel do Corretor                    (06/08/2026)

   Cole no Console da aba do PAINEL e depois use o Painel normalmente por
   uns 30 segundos: escolha a entidade, clique numa operadora, veja planos.

   Ela não clica em nada e não muda a página. Só fica ouvindo as respostas
   que o Painel já manda pro navegador, e anota o que vem dentro.

   Responde duas perguntas de uma vez:

   1. A lista de PROFISSÕES da entidade já chega junto e está sendo jogada
      fora? A extensão hoje lê só o PRIMEIRO array de cada resposta — se as
      profissões vierem no segundo, elas nunca foram vistas, e o conserto é
      de uma linha.

   2. Qual chamada a tela de escolha da entidade faz? Sabendo isso, a
      extensão pode aprender esse passo como aprende os outros sete, e o
      JOB passa a mostrar os requisitos sem ninguém capturar nada de novo.
   ===================================================================== */
(() => {
  const achados = [];
  const PISTA = /profiss|ocupac|ocupaç|entidad|elegib|requisit|categoria|associac|associaç|sindicat/i;

  const original = window.fetch;
  window.fetch = function (...args) {
    const url = (args[0] && args[0].url) || String(args[0] || '');
    const cfg = args[1] || {};
    const p = original.apply(this, args);
    try {
      p.then((resp) => {
        const clone = resp.clone();
        clone.text().then((txt) => {
          if (!txt || txt.length < 40) return;
          // A resposta do Next vem em linhas "N:conteudo". Anota TODAS as que
          // trazem array de objeto — é justamente o que a extensão descarta.
          const linhas = [];
          String(txt).split('\n').forEach((l) => {
            const v = l.indexOf(':');
            if (v < 0) return;
            const resto = l.slice(v + 1);
            if (resto[0] !== '[' && resto[0] !== '{') return;
            try {
              const d = JSON.parse(resto);
              const amostra = JSON.stringify(d).slice(0, 260);
              linhas.push({
                indice: l.slice(0, v),
                tipo: Array.isArray(d) ? 'array(' + d.length + ')' : 'objeto',
                chaves: Array.isArray(d)
                  ? (d[0] && typeof d[0] === 'object' ? Object.keys(d[0]).slice(0, 14) : [])
                  : Object.keys(d).slice(0, 14),
                tem_pista: PISTA.test(amostra),
                amostra,
              });
            } catch (e) { /* linha de componente */ }
          });
          if (!linhas.length) return;
          const h = cfg.headers;
          const pega = (k) => (h && typeof h.get === 'function' ? h.get(k) : (h || {})[k]);
          achados.push({
            url: String(url).slice(-70),
            acao: pega('next-action') || pega('Next-Action') || '(sem next-action)',
            corpo: typeof cfg.body === 'string' ? cfg.body.slice(0, 220) : '',
            linhas,
          });
          const comPista = linhas.filter((x) => x.tem_pista).length;
          console.log('[SONDA-R] ' + linhas.length + ' bloco(s) de dado' +
            (comPista ? ' — ' + comPista + ' COM PISTA de entidade/profissao' : ''));
        });
      });
    } catch (e) { /* ouvir nunca pode quebrar a pagina */ }
    return p;
  };

  console.log('%c[SONDA-R] Ouvindo. Use o Painel normalmente por ~30s: escolha a entidade, ' +
    'clique numa operadora, veja os planos.', 'color:#0a7;font-weight:bold');
  console.log('%c[SONDA-R] Quando terminar, rode:  pararSonda()', 'color:#0a7;font-weight:bold');

  window.pararSonda = () => {
    window.fetch = original;
    const comPista = [];
    achados.forEach((a) => a.linhas.forEach((l) => { if (l.tem_pista) comPista.push({ acao: a.acao, ...l }); }));
    const saida = {
      chamadas_ouvidas: achados.length,
      blocos_com_pista: comPista.length,
      // O que interessa primeiro: blocos que falam de entidade/profissao.
      com_pista: comPista.slice(0, 8),
      // E o mapa geral, pra eu ver o que a extensao descarta hoje.
      todas: achados.map((a) => ({ acao: a.acao, corpo: a.corpo,
        blocos: a.linhas.map((l) => ({ i: l.indice, tipo: l.tipo, chaves: l.chaves, pista: l.tem_pista })) })),
    };
    console.log(saida);
    try { copy(JSON.stringify(saida, null, 1)); console.log('%c[SONDA-R] copiado — cole no chat.',
      'color:#0a7;font-weight:bold'); }
    catch (e) { console.log('[SONDA-R] botao direito no objeto acima > Copy object.'); }
    return saida;
  };
})();
