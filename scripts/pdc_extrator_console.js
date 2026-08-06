/* =====================================================================
   EXTRATOR AUTOMÁTICO — Painel do Corretor -> JOB
   Cola no Console do F12, LOGADO no PDC, com uma cotação COMPARATIVO
   aberta na tela (gere com TODAS as operadoras da cidade selecionadas e
   1 vida em CADA faixa etária — assim vem a tabela completa das 10).
   Ele percorre TODOS os planos sozinho (abre "Ver detalhes" de cada,
   lê os preços por faixa), junta tudo e baixa um .json pronto pra subir
   no JOB (Cotação > Importar do Painel do Corretor).
   Roda na SUA sessão, no seu ritmo (com pausa entre os planos).

   ADESÃO: também lê a ENTIDADE DE CLASSE e a administradora de cada plano.
   Na adesão a entidade muda preço e elegibilidade, e o JOB usa ela pra
   separar as linhas — sem ela, duas entidades do mesmo plano viram uma só
   e uma sobrescreve a outra. Se o Painel não trouxer a entidade rotulada,
   o script PERGUNTA uma vez no fim, com o que ele achou já preenchido.
   Ele não chuta: entidade errada é preço errado enviado ao cliente.
   No fim sai uma tabela no console com a contagem por entidade — confira
   ela antes de subir o arquivo.
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
      entidade: acharEntidade(t),
      administradora: acharAdministradora(t),
      precos,
    };
  }

  // ── Entidade de classe e administradora (só existem na Adesão) ────────────
  //
  // Na Adesão a entidade muda PREÇO e ELEGIBILIDADE — dois planos iguais em
  // entidades diferentes são linhas diferentes, e o JOB usa a entidade na chave
  // de deduplicação. Sem ela, uma entidade sobrescreve a outra na importação.
  //
  // Antes isso vinha grudado no nome da operadora ("Affix ANSP") porque as
  // tabelas eram digitadas à mão. O filtro de operadora da tela listava quatro
  // "Affix" como se fossem quatro operadoras.
  //
  // A leitura tenta o rótulo primeiro, que é o único jeito confiável. Se o
  // Painel não rotular, o script NÃO inventa: devolve vazio e pergunta uma vez
  // no fim, com o que conseguiu achar já preenchido. Chutar aqui seria pior que
  // não ter — entidade errada é preço errado enviado ao cliente.
  function acharEntidade(t) {
    const rotulado = t.match(/Entidade(?:\s+de\s+classe)?\s*:?\s*\n?\s*([^\n]{2,60})/i);
    if (rotulado) {
      const v = rotulado[1].trim().replace(/^[-–:]\s*/, '');
      if (v && !/^(n[ãa]o|nenhuma|-{1,2})$/i.test(v)) return limparEntidade(v);
    }
    // Siglas que já apareceram nas tabelas da corretora. Serve de rede, não de
    // regra: uma sigla nova não é reconhecida, e é por isso que existe a
    // pergunta de confirmação.
    const conhecida = t.match(/\b(ANSP|ASCOSERVI|FNEL|UNIPRO|ANASPL)\b/);
    return conhecida ? conhecida[1] : '';
  }

  // Tira o parêntese descritivo: "ANASPL  (curso superior)" -> "ANASPL".
  // O que está entre parênteses é a categoria profissional, não o nome da
  // entidade, e colado ali ele quebra o agrupamento no JOB.
  function limparEntidade(v) {
    return String(v).replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  }

  function acharAdministradora(t) {
    const rotulado = t.match(/Administradora\s*:?\s*\n?\s*([^\n]{2,60})/i);
    if (rotulado) return rotulado[1].trim().replace(/^[-–:]\s*/, '');
    const conhecida = t.match(/\b(Qualicorp|Affix|Elo Benef[íi]cios|Allcare|Alian[çc]a Adm|Plural)\b/i);
    return conhecida ? conhecida[1] : '';
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
      // A entidade entra na comparação: na Adesão, o MESMO plano em entidades
      // diferentes tem preço diferente e são duas linhas. Sem ela aqui, o
      // segundo virava "repetido, pulei" e a tabela dele nunca era extraída.
      const jaTem = planos.some(x => x.operadora === d.operadora && x.plano === d.plano && x.acomodacao === d.acomodacao && x.coparticipacao === d.coparticipacao && (x.entidade || '') === (d.entidade || ''));
      if (d.plano && Object.keys(d.precos).length && !jaTem) {
        planos.push(d);
        console.log('%c[PDC]  ✓ ' + (d.operadora || '') + (d.entidade ? ' [' + d.entidade + ']' : '') +
          ' — ' + d.plano + ' (' + Object.keys(d.precos).length + ' faixas)', 'color:#0a7');
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

  // ── Confirmação da entidade, uma vez por rodada ──────────────────────────
  //
  // Só pergunta na Adesão, e só se algum plano ficou sem. Uma rodada é sempre
  // uma entidade — ela é escolhida no Painel ANTES de gerar o comparativo —,
  // então uma pergunta resolve a lista inteira.
  //
  // Vem preenchida com o que foi lido da página: se o Painel rotulou, é só dar
  // OK. Se não rotulou, quem sabe a resposta é você, e digitar é melhor que o
  // script chutar. Cancelar deixa em branco, e aí o JOB importa sem entidade —
  // o que só atrapalha quando existe mais de uma entidade do mesmo plano.
  const ehAdesao = planos.some(p => /ades/i.test(p.modalidade || ''));
  const semEntidade = planos.filter(p => !p.entidade);
  if (ehAdesao && semEntidade.length) {
    const achada = (planos.find(p => p.entidade) || {}).entidade || '';
    const resp = prompt(
      'ADESÃO — qual a entidade de classe desta cotação?\n\n' +
      semEntidade.length + ' de ' + planos.length + ' plano(s) vieram sem ela.\n' +
      'Ex: ANSP, ASCOSERVI, FNEL, UNIPRO, ANASPL.\n\n' +
      'Sem entidade, duas entidades do mesmo plano viram uma linha só no JOB ' +
      'e uma sobrescreve a outra.',
      achada);
    if (resp && resp.trim()) {
      const v = limparEntidade(resp);
      semEntidade.forEach(p => { p.entidade = v; });
      console.log('%c[PDC] Entidade "' + v + '" aplicada a ' + semEntidade.length + ' plano(s).', 'color:#0a7');
    } else {
      console.warn('[PDC] Sem entidade. Se houver mais de uma entidade do mesmo plano, ' +
                   'a importação vai juntar as duas numa linha só.');
    }
  }

  const saida = {
    cidade,
    modalidade: (planos[0] && planos[0].modalidade) || '',
    extraido_em: new Date().toISOString(),
    planos,
  };

  // Mostra o que vai subir, agrupado por entidade — é a última chance de ver
  // que algo saiu torto ANTES do arquivo virar preço na tela do cliente.
  const porEntidade = {};
  planos.forEach(p => {
    const k = p.entidade || '(sem entidade)';
    porEntidade[k] = (porEntidade[k] || 0) + 1;
  });
  console.table(Object.keys(porEntidade).map(k => ({ entidade: k, planos: porEntidade[k] })));
  console.log('%c[PDC] Pronto: ' + planos.length + ' planos.', 'color:#0a7;font-weight:bold', saida);

  const nome = ('pdc_' + cidade + '_' + saida.modalidade).replace(/[^\w]+/g, '_').slice(0, 60) + '.json';
  const blob = new Blob([JSON.stringify(saida, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  console.log('%c[PDC] Baixado: ' + nome + ' — suba no JOB em Cotação > Importar do Painel do Corretor', 'color:#0a7;font-weight:bold');
  return saida;
})();
