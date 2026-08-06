/* =====================================================================
   EXTRATOR AUTOMÁTICO — Painel do Corretor -> JOB           (v2, 06/08/2026)
   Cole no Console do F12, LOGADO no PDC, com uma cotação COMPARATIVO
   aberta na tela (gere com TODAS as operadoras da cidade selecionadas e
   1 vida em CADA faixa etária — assim vem a tabela completa das 10).
   Roda na SUA sessão, no seu ritmo (com pausa entre os planos).

   O QUE MUDOU NA v2 — e por quê
   A v1 lia tudo da página de DETALHE, com regex em cima do texto da tela.
   Resultado real da primeira rodada em Campinas: 17 planos extraídos, todos
   com `operadora: null` e 13 dos 17 sem entidade. O arquivo baixou assim
   mesmo, sem avisar nada.
   A razão apareceu na sonda: a operadora é o LOGO, uma imagem — texto nenhum
   pra regex achar. E a entidade não está no detalhe, está no CARTÃO.

   Então agora são duas leituras que se completam:
     CARTÃO  (tela de comparativo) = QUEM É o plano
        operadora (do alt do logo), administradora, entidade, acomodação,
        coparticipação e tamanho da rede
     DETALHE (uma página por plano) = QUANTO CUSTA
        os preços por faixa etária

   E no fim ele CONFERE antes de baixar: plano sem operadora, sem preço ou
   sem entidade em cotação de Adesão aparece numa lista de pendências. A v1
   baixava 17 planos quebrados em silêncio.
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

  // Acha os botões "Ver detalhes" (um por plano no comparativo).
  const botoesDetalhe = () =>
    [...document.querySelectorAll('button, a')].filter(b => /ver detalhes/i.test(b.textContent || ''));

  // ── CARTÃO: sobe do botão até o bloco que tem logo E preço ────────────────
  const cartaoDe = (b) => {
    let n = b;
    for (let i = 0; i < 8 && n; i++) {
      n = n.parentElement;
      if (n && n.querySelector('img') && /R\$\s*[\d.]+,\d{2}/.test(n.innerText || '')) return n;
    }
    return null;
  };

  const ACOMODACOES = /^(enfermaria|apartamento|quarto coletivo|quarto individual)/i;
  const COPART = /coparticipa[çc][aã]o/i;

  // "Supermed - UNICOM-Serv" -> administradora Supermed, entidade UNICOM-Serv.
  // Separa no hífen COM espaços dos dois lados: a entidade em si costuma ter
  // hífen colado ("UNICOM-Serv", "ABPS-Econ") e separar nele quebraria o nome.
  function lerCartao(c) {
    if (!c) return {};
    const linhas = (c.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
    const img = c.querySelector('img');
    const fora = (s) => ACOMODACOES.test(s) || COPART.test(s) || /^\d+$/.test(s) ||
                        /hospitais?$/i.test(s) || /^R\$$/.test(s) || /^\/m[êe]s$/i.test(s) ||
                        /ver detalhes/i.test(s);

    let administradora = '', entidade = '';
    for (const s of linhas.slice(1)) {
      if (fora(s)) continue;
      const m = s.match(/^(.{2,40}?)\s+-\s+(.{2,40})$/);
      if (m) { administradora = m[1].trim(); entidade = limparEntidade(m[2]); break; }
    }

    return {
      // O alt do logo é a operadora, em texto limpo ("Amil", "Go Care Saúde").
      operadora: (img && (img.alt || img.getAttribute('title') || '').trim()) || '',
      plano_cartao: linhas[0] || '',
      administradora,
      entidade,
      acomodacao: linhas.find(s => ACOMODACOES.test(s)) || '',
      coparticipacao: linhas.find(s => COPART.test(s)) || '',
      rede: (() => {
        const i = linhas.findIndex(s => /hospitais?$/i.test(s));
        return i > 0 && /^\d+$/.test(linhas[i - 1]) ? Number(linhas[i - 1]) : null;
      })(),
    };
  }

  // Tira o parêntese descritivo: "ANASPL (curso superior)" -> "ANASPL".
  // O que está no parêntese é a categoria profissional, não o nome da entidade,
  // e colado ali quebra o agrupamento no JOB.
  function limparEntidade(v) {
    return String(v || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }

  // ── DETALHE: só os preços por faixa ──────────────────────────────────────
  function lerPrecos() {
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
    return { precos, plano: (t.match(/Plano\s+([^\n]+)/) || [])[1] || null };
  }

  if (!noComparativo()) {
    alert('Abra a COTAÇÃO (tela de comparativo, com os cards dos planos) antes de rodar.');
    return;
  }

  const cidade = prompt('Cidade da cotação (ex: Campinas - SP):', 'Campinas - SP') || '';
  const nTotal = botoesDetalhe().length;
  if (!nTotal) { alert('Não achei nenhum plano com "Ver detalhes" nesta tela.'); return; }

  // Lê TODOS os cartões primeiro, de uma vez, antes de navegar para qualquer
  // detalhe. Depois que se sai da tela o DOM some, e era isso que fazia a v1
  // perder a identidade dos planos.
  const cartoes = botoesDetalhe().map(b => lerCartao(cartaoDe(b)));
  const ehAdesao = cartoes.some(c => c.entidade || c.administradora);

  console.log('%c[PDC] ' + nTotal + ' plano(s). ' +
    (ehAdesao ? 'Adesão detectada (administradora e entidade no cartão).' : 'Sem entidade nos cartões.'),
    'color:#0a7;font-weight:bold');

  const modalidade = prompt('Modalidade desta cotação:', ehAdesao ? 'Adesão' : 'PME') || '';

  const planos = [];
  for (let i = 0; i < nTotal; i++) {
    const botoes = botoesDetalhe();
    if (i >= botoes.length) break;
    const cart = cartoes[i] || {};
    botoes[i].click();
    const ok = await esperar(() => naDetalhe() && /\d{2} a \d{2}/.test(document.body.innerText), 12000);
    if (ok) {
      await sleep(400);
      const det = lerPrecos();
      const plano = cart.plano_cartao || det.plano || '';
      // A identidade vem do cartão; do detalhe vem só o preço.
      const d = {
        operadora: cart.operadora || '',
        plano,
        administradora: cart.administradora || '',
        entidade: cart.entidade || '',
        acomodacao: cart.acomodacao || '',
        coparticipacao: cart.coparticipacao || '',
        modalidade,
        rede_qtd: cart.rede,
        precos: det.precos,
      };
      // Entidade entra na comparação: o MESMO plano em entidades diferentes
      // tem preço diferente e são duas linhas no JOB.
      const jaTem = planos.some(x => x.operadora === d.operadora && x.plano === d.plano &&
        x.acomodacao === d.acomodacao && x.coparticipacao === d.coparticipacao &&
        (x.entidade || '') === (d.entidade || ''));
      if (plano && Object.keys(d.precos).length && !jaTem) {
        planos.push(d);
        console.log('%c[PDC]  ok  ' + (d.operadora || '(SEM OPERADORA)') +
          (d.entidade ? '  [' + d.administradora + ' / ' + d.entidade + ']' : '') +
          ' — ' + d.plano + ' (' + Object.keys(d.precos).length + ' faixas)', 'color:#0a7');
      } else if (jaTem) {
        console.log('[PDC]  (plano repetido, pulei)');
      } else {
        console.warn('[PDC]  plano ' + (i + 1) + ' sem preços legíveis, pulei');
      }
    } else {
      console.warn('[PDC]  plano ' + (i + 1) + ': detalhe não carregou, pulei');
    }
    history.back();
    await esperar(noComparativo, 12000);
    await sleep(600); // ritmo humano — não martelar o PDC
  }

  // ── CONFERÊNCIA antes de baixar ──────────────────────────────────────────
  //
  // A v1 baixou 17 planos com operadora nula sem dizer nada, e só se descobriu
  // abrindo o arquivo. Preço errado que entra na base vira preço errado no link
  // que o cliente recebe — e esse link é imutável.
  const pend = [];
  planos.forEach(p => {
    const faltam = [];
    if (!p.operadora) faltam.push('operadora');
    if (Object.keys(p.precos).length < 10) faltam.push(Object.keys(p.precos).length + '/10 faixas');
    if (ehAdesao && !p.entidade) faltam.push('entidade');
    if (faltam.length) pend.push({ plano: p.plano, falta: faltam.join(', ') });
  });

  console.table(planos.map(p => ({
    operadora: p.operadora || '(vazio)',
    plano: p.plano,
    administradora: p.administradora || '-',
    entidade: p.entidade || '-',
    faixas: Object.keys(p.precos).length,
  })));

  if (pend.length) {
    console.warn('%c[PDC] ' + pend.length + ' plano(s) com pendência — confira antes de subir no JOB:',
      'color:#c62828;font-weight:bold');
    console.table(pend);
  } else {
    console.log('%c[PDC] Todos os ' + planos.length + ' planos completos.', 'color:#0a7;font-weight:bold');
  }

  const saida = { cidade, modalidade, extraido_em: new Date().toISOString(), planos };

  const nome = ('pdc_' + cidade + '_' + modalidade).replace(/[^\w]+/g, '_').slice(0, 60) + '.json';
  const blob = new Blob([JSON.stringify(saida, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  console.log('%c[PDC] Baixado: ' + nome + (pend.length ? ' — MAS confira as pendências acima.' :
    ' — suba no JOB em Cotação > Tabelas de preço.'), 'color:#0a7;font-weight:bold');
  return saida;
})();
