// ─────────────────────────────────────────────────────────────────────────────
// MAPEADOR DO PAINEL DO CORRETOR
//
// Pra que serve: descobrir COMO o painel da Trindade cota, antes de escrever
// uma linha de extensão. A pergunta que isto responde vale meses de trabalho:
//
//   dá pra chamar o endereço de cotação deles direto (rápido, várias em
//   paralelo), ou vamos ter que preencher o formulário e clicar (lento, uma
//   por vez)?
//
// A resposta muda o projeto inteiro. Se for o primeiro caso, um multicálculo
// de 20 combinações leva ~3 segundos; se for o segundo, leva um minuto.
//
// Não manda nada pra lugar nenhum: só olha o que a própria página já faz, e
// imprime aqui no console pra você copiar. Nada é salvo, nada é enviado.
//
// ── COMO USAR ────────────────────────────────────────────────────────────────
// 1. Entre no Painel do Corretor normalmente, com o seu login.
// 2. Abra o console: Cmd+Option+J (Mac) ou Ctrl+Shift+J (Windows).
// 3. Cole este arquivo inteiro e dê Enter. Ele responde "mapeador ligado".
// 4. FAÇA UMA COTAÇÃO DE VERDADE na tela, do jeito que você faz sempre.
// 5. Volte ao console e digite:   JOBMAPA.relatorio()
// 6. Copie tudo que aparecer e me mande.
// ─────────────────────────────────────────────────────────────────────────────

window.JOBMAPA = (function () {
  const chamadas = [];

  // ── 1. Escuta o que a página pede pro servidor ────────────────────────────
  // Não interfere: repassa a chamada igualzinho e só anota o que passou.
  const fetchOriginal = window.fetch;
  window.fetch = function (...args) {
    const inicio = Date.now();
    const url = (args[0] && args[0].url) || String(args[0] || '');
    const cfg = args[1] || {};
    return fetchOriginal.apply(this, args).then((resp) => {
      const copia = resp.clone();
      copia.text().then((corpo) => {
        chamadas.push({
          via: 'fetch',
          metodo: (cfg.method || 'GET').toUpperCase(),
          url,
          enviou: typeof cfg.body === 'string' ? cfg.body.slice(0, 1200) : null,
          ms: Date.now() - inicio,
          status: resp.status,
          respostaInicio: (corpo || '').slice(0, 1200),
          tamanhoResposta: (corpo || '').length,
        });
      }).catch(() => {});
      return resp;
    });
  };

  const abrirOriginal = XMLHttpRequest.prototype.open;
  const enviarOriginal = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (metodo, url) {
    this.__job = { metodo, url, inicio: Date.now() };
    return abrirOriginal.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (corpo) {
    const req = this;
    if (req.__job) {
      req.addEventListener('load', () => {
        chamadas.push({
          via: 'xhr',
          metodo: (req.__job.metodo || 'GET').toUpperCase(),
          url: req.__job.url,
          enviou: typeof corpo === 'string' ? corpo.slice(0, 1200) : null,
          ms: Date.now() - req.__job.inicio,
          status: req.status,
          respostaInicio: String(req.responseText || '').slice(0, 1200),
          tamanhoResposta: String(req.responseText || '').length,
        });
      });
    }
    return enviarOriginal.apply(this, arguments);
  };

  // ── 2. Lê o formulário: quais campos existem e o que cada um aceita ───────
  // É daqui que saem as VARIÁVEIS: cidade, faixa etária, vidas, produto,
  // acomodação, coparticipação, tipo de CNPJ.
  function campos() {
    const achados = [];
    document.querySelectorAll('select, input, textarea').forEach((el) => {
      if (el.type === 'hidden' || el.type === 'password') return;   // senha nunca
      const rot = (el.labels && el.labels[0] && el.labels[0].textContent || '').trim();
      const item = {
        tipo: el.tagName.toLowerCase() + (el.type ? ':' + el.type : ''),
        nome: el.name || el.id || '(sem nome)',
        rotulo: rot.slice(0, 60) || el.placeholder || '',
        valorAgora: el.type === 'checkbox' || el.type === 'radio' ? el.checked : (el.value || ''),
      };
      if (el.tagName === 'SELECT') {
        item.opcoes = [...el.options].slice(0, 400).map((o) => ({ valor: o.value, texto: o.textContent.trim() }));
        item.quantasOpcoes = el.options.length;
      }
      achados.push(item);
    });
    return achados;
  }

  console.log('%c mapeador ligado ', 'background:#1fd8a4;color:#000;font-weight:700;padding:2px 6px;');
  console.log('Agora faça UMA cotação normal na tela. Depois digite: JOBMAPA.relatorio()');

  return {
    relatorio() {
      // Só o que interessa: chamadas que carregaram dado, não imagem/css/fonte.
      const uteis = chamadas.filter((c) =>
        !/\.(png|jpe?g|gif|svg|css|woff2?|ttf|ico)(\?|$)/i.test(c.url) && c.tamanhoResposta > 0);
      const saida = {
        pagina: location.href,
        quando: new Date().toISOString(),
        camposDoFormulario: campos(),
        chamadasQueOServidorRespondeu: uteis,
        resumo: {
          totalDeChamadas: chamadas.length,
          uteis: uteis.length,
          maisLenta: uteis.length ? Math.max(...uteis.map((c) => c.ms)) + 'ms' : '-',
        },
      };
      console.log(saida);
      // Copia pro clipboard quando o navegador deixa — é muito texto pra
      // selecionar na mão.
      try {
        copy(JSON.stringify(saida, null, 1));
        console.log('%c copiado pro clipboard — pode colar pro Claude ',
                    'background:#3b82f6;color:#fff;padding:2px 6px;');
      } catch (e) {
        console.log('Selecione o objeto acima, clique com o botão direito e "Copy object".');
      }
      return saida;
    },
    limpar() { chamadas.length = 0; console.log('zerado'); },
  };
})();
