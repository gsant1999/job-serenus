/* =====================================================================
   EXTRATOR AUTOMÁTICO — Painel do Corretor -> JOB
   Cola no Console do F12, LOGADO no PDC, com uma cotação COMPARATIVO
   aberta na tela (gere com TODAS as operadoras da cidade selecionadas e
   1 vida em CADA faixa etária — assim vem a tabela completa das 10).
   Ele percorre TODOS os planos sozinho (abre "Ver detalhes" de cada,
   lê os preços por faixa), junta tudo e baixa um .json pronto pra subir
   no JOB (Cotação > Importar do Painel do Corretor).
   Roda na SUA sessão, no seu ritmo (com pausa entre os planos).
   ===================================================================== */
(async () => {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const L = () => document.body.innerText.split('\n').map(s => s.trim()).filter(Boolean);
  const esperar = async (cond, timeout = 12000, passo = 250) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) { if (cond()) return true; await sleep(passo); }
    return false;
  };
  const naDetalhe = () => location.href.includes('/cenarios/');
  const noComparativo = () => location.href.includes('/edit');

  // Lê preços por faixa + cabeçalho na página de DETALHE de um plano.
  function lerDetalhe() {
    const linhas = L();
    const faixas = ['00 a 18','19 a 23','24 a 28','29 a 33','34 a 38','39 a 43','44 a 48','49 a 53','54 a 58','59'];
    const precos = {};
    for (let i = 0; i < linhas.length; i++) {
      for (const fx of faixas) {
        if (linhas[i].startsWith(fx)) {
          for (let j = i; j < Math.min(i + 5, linhas.length); j++) {
            const m = linhas[j].match(/R\$\s*([\d.]+,\d{2})/);
            if (m) { precos[fx === '59' ? '59 ou mais' : fx] = m[1]; break; }
          }
        }
      }
    }
    const t = document.body.innerText;
    const g = (re) => { const m = t.match(re); return m ? (m[1] || m[0]) : null; };
    return {
      operadora: g(/Porto Seguro Sa[uú]de|Porto Sa[uú]de|Vera Cruz|Amil|Hapvida[\w ]*|MedS[eê]nior|SulAm[eé]rica|Bradesco|GNDI|Unimed[\w ]*|Santa Tereza|S[aã]o Bernardo[\w ]*|Sa[uú]de Benefic[eê]ncia|Omint|Care Plus|Proasa|SalusMed|Leader|Dona Sa[uú]de|[A-Z][\wçãáéíóú ]+Sa[uú]de/),
      plano: (t.match(/Plano\s+([^\n]+)/) || [])[1] || null,
      acomodacao: g(/Quarto individual \(apartamento\)|Apartamento|Enfermaria|Quarto coletivo/i),
      coparticipacao: g(/Sem coparticipa[çc][aã]o|Com coparticipa[çc][aã]o/i),
      modalidade: (t.match(/Sa[uú]de\s+(PME|PF|Ades[aã]o)/i) || [])[0] || null,
      precos,
    };
  }

  // Acha os botões "Ver detalhes" (um por plano no comparativo).
  const botoesDetalhe = () =>
    [...document.querySelectorAll('button, a')].filter(b => /ver detalhes/i.test(b.textContent || ''));

  if (!noComparativo()) {
    alert('Abra a COTAÇÃO (tela de comparativo, com os cards dos planos) antes de rodar.');
    return;
  }

  const cidade = prompt('Cidade da cotação (ex: Campinas - SP):', 'Campinas - SP') || '';
  const nTotal = botoesDetalhe().length;
  if (!nTotal) { alert('Não achei nenhum plano com "Ver detalhes" nesta tela.'); return; }
  console.log('%c[PDC] ' + nTotal + ' plano(s) encontrado(s). Extraindo...', 'color:#0a7;font-weight:bold');

  const planos = [];
  for (let i = 0; i < nTotal; i++) {
    // volta a lista de botões a cada iteração (o DOM muda ao navegar)
    const botoes = botoesDetalhe();
    if (i >= botoes.length) break;
    botoes[i].click();
    const ok = await esperar(() => naDetalhe() && /\d{2} a \d{2}/.test(document.body.innerText), 12000);
    if (ok) {
      await sleep(400);
      const d = lerDetalhe();
      const jaTem = planos.some(x => x.operadora === d.operadora && x.plano === d.plano && x.acomodacao === d.acomodacao && x.coparticipacao === d.coparticipacao);
      if (d.plano && Object.keys(d.precos).length && !jaTem) {
        planos.push(d);
        console.log('%c[PDC]  ✓ ' + (d.operadora || '') + ' — ' + d.plano + ' (' + Object.keys(d.precos).length + ' faixas)', 'color:#0a7');
      } else if (jaTem) {
        console.log('[PDC]  (plano repetido, pulei)');
      } else {
        console.warn('[PDC]  ✗ plano ' + (i + 1) + ' sem preços legíveis, pulei');
      }
    } else {
      console.warn('[PDC]  ✗ plano ' + (i + 1) + ': detalhe não carregou, pulei');
    }
    history.back();
    await esperar(noComparativo, 12000);
    await sleep(600); // ritmo humano — não martelar o PDC
  }

  const saida = {
    cidade,
    modalidade: (planos[0] && planos[0].modalidade) || '',
    extraido_em: new Date().toISOString(),
    planos,
  };
  console.log('%c[PDC] Pronto: ' + planos.length + ' planos.', 'color:#0a7;font-weight:bold', saida);

  const nome = ('pdc_' + cidade + '_' + saida.modalidade).replace(/[^\w]+/g, '_').slice(0, 60) + '.json';
  const blob = new Blob([JSON.stringify(saida, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  console.log('%c[PDC] Baixado: ' + nome + ' — suba no JOB em Cotação > Importar do Painel do Corretor', 'color:#0a7;font-weight:bold');
  return saida;
})();
