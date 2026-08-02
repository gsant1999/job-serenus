// ─────────────────────────────────────────────────────────────────────────────
// MAPEADOR DO PAINEL DO CORRETOR — v2 (o miolo)
//
// O v1 já respondeu a pergunta grande: a cotação deles é uma chamada de
// servidor com JSON de entrada, e responde em ~130ms. Multicálculo em
// paralelo é viável.
//
// Faltam duas coisas, e é só isso que este v2 pega:
//
//   1. O cabeçalho Next-Action — o identificador da função no servidor deles.
//      Sem ele a chamada não sai. Muda a cada deploy do painel deles, então
//      precisamos saber onde ele aparece pra ler dinamicamente depois.
//
//   2. A RESPOSTA INTEIRA da chamada de cenários (o v1 guardou só o começo,
//      e no começo só tem referência de componente). É aqui que mora o preço.
//
// Diferença de comportamento: o v1 guardava tudo pela metade. Este guarda
// pouca coisa, mas inteira. Só as chamadas de cotação — analytics, imagem e
// navegação ficam de fora, senão o arquivo passa de 10MB e não serve.
//
// Não manda nada pra lugar nenhum. Só observa a sua própria sessão.
//
// ── COMO USAR ────────────────────────────────────────────────────────────────
// 1. Entre no Painel do Corretor com o seu login.
// 2. Console: Cmd+Option+J (Mac) ou Ctrl+Shift+J (Windows).
// 3. Cole este arquivo inteiro, Enter. Responde "mapeador v2 ligado".
// 4. Faça UMA cotação de verdade — e ABRA UM PLANO, veja o preço na tela.
//    O preço só vem na resposta se você chegar até a tela que mostra preço.
// 5. Console:  JOBMAPA2.relatorio()
// 6. Baixa mapa-painel-v2.json — arraste pro Claude.
// ─────────────────────────────────────────────────────────────────────────────

window.JOBMAPA2 = (function () {
  const chamadas = [];

  // Só interessa o que cota. O resto é ruído que estoura o tamanho do arquivo.
  function interessa(url) {
    return /\/cotacoes\/[^/]+\/edit/.test(url) ||
           /\/cotacoes\/nova/.test(url) ||
           /\/api\/cidades/.test(url);
  }

  // Os cabeçalhos podem vir de três formatos diferentes (Headers, array ou
  // objeto simples) dependendo de como a página chamou. Normaliza os três.
  function lerCabecalhos(cfg, primeiroArg) {
    const fora = {};
    const guarda = (k, v) => {
      const chave = String(k).toLowerCase();
      // Nunca guardar credencial. Só o que descreve a chamada.
      if (/cookie|authorization|token|senha|password|x-api/.test(chave)) return;
      fora[chave] = String(v).slice(0, 300);
    };
    const h = (cfg && cfg.headers) || (primeiroArg && primeiroArg.headers);
    if (!h) return fora;
    if (typeof h.forEach === 'function' && !Array.isArray(h)) h.forEach((v, k) => guarda(k, v));
    else if (Array.isArray(h)) h.forEach(([k, v]) => guarda(k, v));
    else Object.keys(h).forEach((k) => guarda(k, h[k]));
    return fora;
  }

  // Corpo pode ser string, FormData ou URLSearchParams. Server Action do
  // Next manda FormData com frequência, e o v1 perdia justamente esses.
  function lerCorpo(b) {
    if (b == null) return null;
    if (typeof b === 'string') return b.slice(0, 4000);
    try {
      if (b instanceof FormData || b instanceof URLSearchParams) {
        const pares = [];
        b.forEach((v, k) => pares.push([k, typeof v === 'string' ? v.slice(0, 2000) : '(arquivo)']));
        return { formato: 'formdata', pares };
      }
    } catch (e) { /* ambientes onde FormData não existe */ }
    return '(corpo não textual)';
  }

  const fetchOriginal = window.fetch;
  window.fetch = function (...args) {
    const inicio = Date.now();
    const url = (args[0] && args[0].url) || String(args[0] || '');
    const cfg = args[1] || {};
    if (!interessa(url)) return fetchOriginal.apply(this, args);
    return fetchOriginal.apply(this, args).then((resp) => {
      resp.clone().text().then((corpo) => {
        chamadas.push({
          metodo: (cfg.method || (args[0] && args[0].method) || 'GET').toUpperCase(),
          url,
          cabecalhos: lerCabecalhos(cfg, args[0]),
          enviou: lerCorpo(cfg.body),
          ms: Date.now() - inicio,
          status: resp.status,
          tamanhoResposta: (corpo || '').length,
          // AQUI está a diferença do v1: resposta inteira, não os primeiros
          // 1200 caracteres. O preço mora depois do cabeçalho de componentes.
          resposta: corpo || '',
        });
      }).catch(() => {});
      return resp;
    });
  };

  console.log('%c mapeador v2 ligado ', 'background:#1fd8a4;color:#000;font-weight:700;padding:2px 6px;');
  console.log('Faça uma cotação e ABRA UM PLANO até ver preço na tela. Depois: JOBMAPA2.relatorio()');

  return {
    relatorio() {
      const saida = {
        pagina: location.href,
        quando: new Date().toISOString(),
        chamadas,
        resumo: {
          quantas: chamadas.length,
          maiorResposta: chamadas.length ? Math.max(...chamadas.map((c) => c.tamanhoResposta)) : 0,
        },
      };
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([JSON.stringify(saida, null, 1)],
                                            { type: 'application/json' }));
      a.download = 'mapa-painel-v2.json';
      a.click();
      console.log('%c baixei mapa-painel-v2.json — arraste pro Claude ',
                  'background:#3b82f6;color:#fff;padding:2px 6px;');
      return saida.resumo;
    },
    limpar() { chamadas.length = 0; console.log('zerado'); },
  };
})();
