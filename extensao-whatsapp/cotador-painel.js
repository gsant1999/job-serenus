// ─── JOB Serenus · Cotador no Painel do Corretor (world: MAIN) ──────────────
//
//  Roda no contexto da página do Painel. Precisa ser MAIN world porque quem
//  chama é o navegador do próprio consultor, com a sessão que ele já abriu —
//  nenhuma credencial do Painel passa pelo servidor do JOB, e nada é digitado
//  por nós. É o login dele fazendo o que já faz, sem ele clicar.
//
//  O Painel não tem API pública e a Trindade não quer liberar. Mas a tela deles
//  conversa com o servidor por Server Action do Next: POST na própria URL, com
//  JSON de entrada e o cabeçalho next-action dizendo qual função roda lá. Isso
//  a gente consegue repetir — e responde em ~130ms, o que torna multicálculo
//  viável de verdade.
//
//  Quatro funções interessam:
//    A · criar cotação            → devolve o id (UUID)
//    B · operadoras da cidade     → JSON limpo, com logo
//    C · planos de uma operadora  → JSON limpo (sem preço ainda)
//    D · preço de um plano        → render da tela, com o valor em texto
//
// ─── A parte frágil, e o que fazemos com ela ────────────────────────────────
//
//  O next-action é um hash da função no servidor DELES: muda a cada deploy que
//  a Trindade fizer. Fixar no código seria o pior tipo de bug — no dia do
//  deploy a cotação passaria a devolver resultado errado em vez de erro.
//
//  Por isso este arquivo NÃO tem hash nenhum escrito. Ele aprende assistindo:
//  quando o consultor faz uma cotação na mão, a gente reconhece cada chamada
//  pelo FORMATO do corpo (que é estável) e guarda o hash que veio junto. Se o
//  deploy deles mudar os hashes, o cotador avisa que precisa aprender de novo
//  em vez de mentir um número.
//
// ─── Não deixar rastro ──────────────────────────────────────────────────────
//
//  Regra do Guilherme, e ela manda no desenho: nada aqui pode denunciar que
//  tem máquina do outro lado. Na prática:
//
//  · Cabeçalho nosso, nenhum. Só os que a tela deles já manda.
//  · Nada pendurado no window, nada no console. Quem abrir o inspetor naquela
//    máquina — inclusive um suporte deles num acesso remoto — não vê nada.
//  · A cotação criada tem o título padrão deles ("Cotação"). "Cotação JOB"
//    seria uma etiqueta nossa dentro do sistema deles, guardada pra sempre.
//  · Ritmo com variação. O que denuncia robô não é velocidade: é regularidade.
//    Vinte chamadas espaçadas igualzinho não existem em navegação humana.
//
//  O preço disso é honesto: a cotação sai em segundos, não em um segundo. Dá
//  pra ir mais rápido, mas aí começa a parecer o que é.
//
// ─────────────────────────────────────────────────────────────────────────────

(function () {
  'use strict';
  // Trava contra rodar duas vezes, sem aparecer.
  //
  // Uma propriedade normal no window sai no autocomplete do console e no
  // Object.keys — é exatamente o rastro que não podemos deixar. Definida
  // assim ela não é enumerável: quem não souber o nome não encontra.
  try {
    if (Object.getOwnPropertyDescriptor(window, '__jcp')) return;
    Object.defineProperty(window, '__jcp', { value: 1, enumerable: false, configurable: false });
  } catch (e) { return; }

  const ORIGEM = location.origin;

  // O que foi aprendido observando, por papel. Nunca escrito à mão.
  //
  // Cada papel guarda o SEU hash e a SUA árvore de rotas. Guardar uma árvore
  // só para os quatro parecia economia e era erro: a primeira aprendida é a da
  // tela /cotacoes/nova, que não tem id de cotação nenhum — e ela ia junto nas
  // chamadas de preço, que precisam da rota /cotacoes/<id>/edit. O pedido saía
  // com a rota errada em silêncio.
  // Sete ações, não quatro.
  //
  // Eu tinha mapeado só as quatro que devolvem dado e achei que bastava. Não
  // bastava: o preço voltava http_500 em TODO plano, porque o servidor deles
  // não recebe as vidas no pedido de preço — ele lê da COTAÇÃO. E quem grava
  // as vidas na cotação é a ação 'vidas', que a tela deles dispara logo depois
  // de criar e que eu nunca chamava. O mesmo vale pro 'filtro' (cidade e tipo
  // de contratação): também fica guardado na cotação, não vai no pedido.
  //
  // Lição, e é ela que vale: eu tratei como "as chamadas que trazem coisa" o
  // que na verdade era "as chamadas que trazem coisa MAIS o estado que elas
  // pressupõem". As que não devolvem nada eram justamente as que montavam o
  // terreno.
  const PAPEIS = ['criar', 'abrir', 'vidas', 'filtro', 'operadoras', 'planos', 'preco'];
  const APRENDIDO = { criar: null, abrir: null, vidas: null, filtro: null,
                      operadoras: null, planos: null, preco: null };

  // Códigos de modalidade vistos em cotação de verdade.
  //
  // Só sabemos com certeza que 2 é PME, porque foi o que a captura mostrou.
  // Chutar o número de PF ou Adesão seria pedir preço do produto errado e
  // mostrar como certo. Então a extensão anota os que ela VÊ: o consultor faz
  // uma cotação de PF na mão uma vez, e a partir daí PF fica disponível.
  const MODALIDADES = {};

  // Última cotação criada nesta aba. Serve de "rascunho" para as perguntas de
  // apoio (lista de operadoras), pra não criar uma cotação por pergunta.
  let ultimaCotacao = null;

  // ── Reconhecer a chamada pelo formato do corpo ────────────────────────────
  // O hash muda; o formato não. `{filtro:{...}}` só existe na busca de
  // operadora, `operadoraId` só na lista de planos, e o preço é o único que
  // manda o id da cotação como primeiro item junto com a `key` do plano.
  function classificar(url, corpo) {
    let d;
    try { d = JSON.parse(corpo); } catch (e) { return null; }
    if (!Array.isArray(d) || !d.length) return null;
    if (/\/cotacoes\/nova$/.test(url) && d[0] && typeof d[0].titulo === 'string') return 'criar';
    // ["<uuid>"] e só isso: abrir a cotação.
    if (d.length === 1 && typeof d[0] === 'string') return 'abrir';
    // [{cotacaoId, nome, vidas}] — grava a distribuição de vidas NA cotação.
    if (d.length === 1 && d[0] && d[0].cotacaoId && Array.isArray(d[0].vidas)) return 'vidas';
    if (d.length === 1 && d[0] && d[0].filtro && d[0].filtro.cidade) return 'operadoras';
    if (d.length === 1 && d[0] && d[0].operadoraId && Array.isArray(d[0].vidas)) return 'planos';
    if (d.length === 2 && typeof d[0] === 'string' && d[1] && d[1].key && d[1].plano) return 'preco';
    // [uuid, {cidade, modalidade...}] SEM key — grava cidade e contratação na
    // cotação. Vem depois do 'preco' na ordem dos testes de propósito: o preço
    // também tem cidade, e sem essa ordem os dois se confundiriam.
    if (d.length === 2 && typeof d[0] === 'string' && d[1] && d[1].cidade) return 'filtro';
    return null;
  }

  function guardar(papel, hash, arvore) {
    if (!papel || !hash) return;
    const tinha = APRENDIDO[papel];
    if (tinha && tinha.hash === hash && tinha.arvore) return;
    APRENDIDO[papel] = { hash, arvore: arvore || (tinha && tinha.arvore) || null };
    window.postMessage({ source: 'JOB_COTADOR', tipo: 'aprendeu', dados: { ...APRENDIDO } }, ORIGEM);
  }

  // Anota qual código de modalidade o corretor usou de verdade.
  //
  // O corpo diz `modalidade: 2` e mais nada — o nome ("PME") está na tela
  // deles, não na chamada. Então a extensão só coleta o NÚMERO, e quem dá
  // nome é o Guilherme, uma vez, na tela de cotação do JOB. Chutar que 1 é PF
  // seria pedir preço do produto errado e mostrar como certo.
  function anotarModalidade(papel, corpo) {
    if (papel !== 'operadoras' && papel !== 'planos') return;
    try {
      const d = JSON.parse(corpo)[0];
      const m = (d.filtro || d).modalidade;
      if (typeof m === 'number' && !MODALIDADES[m]) {
        MODALIDADES[m] = true;
        window.postMessage({ source: 'JOB_COTADOR', tipo: 'modalidades',
                             dados: Object.keys(MODALIDADES).map(Number) }, ORIGEM);
      }
    } catch (e) { /* corpo em formato novo: ignora, não inventa */ }
  }

  // Escuta a página sem atrapalhar: repassa a chamada igualzinha e só anota.
  const fetchOriginal = window.fetch;
  window.fetch = function (...args) {
    try {
      const url = (args[0] && args[0].url) || String(args[0] || '');
      const cfg = args[1] || {};
      if (typeof cfg.body === 'string' && cfg.headers) {
        const h = cfg.headers;
        const pega = (k) => (typeof h.get === 'function' ? h.get(k) : h[k]);
        const hash = pega('next-action') || pega('Next-Action');
        if (hash) {
          const papel = classificar(url, cfg.body);
          guardar(papel, hash, pega('next-router-state-tree') || pega('Next-Router-State-Tree'));
          anotarModalidade(papel, cfg.body);
        }
      }
    } catch (e) { /* observar nunca pode quebrar a página do corretor */ }
    return fetchOriginal.apply(this, args);
  };

  // Hashes que já tínhamos de sessões anteriores, vindos do armazenamento.
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || !ev.data || ev.data.source !== 'JOB_COTADOR_BRIDGE') return;
    if (ev.data.tipo !== 'restaurar' || !ev.data.dados) return;
    // Só aceita no formato certo. Se o guardado for de uma versão anterior da
    // extensão, o cotador prefere dizer que não sabe e aprender de novo — meio
    // hash restaurado seria pior que hash nenhum.
    PAPEIS.forEach((k) => {
      const v = ev.data.dados[k];
      if (v && typeof v.hash === 'string') APRENDIDO[k] = { hash: v.hash, arvore: v.arvore || null };
    });
    (ev.data.dados.modalidades || []).forEach((m) => {
      if (typeof m === 'number') MODALIDADES[m] = true;
    });
  });

  // ── Falar com o servidor deles ────────────────────────────────────────────

  function arvorePara(papel, cotacaoId) {
    // A árvore guardada tem o id da cotação em que foi aprendida. Trocar o id
    // é suficiente: o resto do caminho (/cotacoes/[id]/edit) não muda.
    const arv = APRENDIDO[papel] && APRENDIDO[papel].arvore;
    if (!arv || !cotacaoId) return arv || null;
    return arv.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, cotacaoId);
  }

  async function acao(papel, caminho, corpo, cotacaoId) {
    const aprendido = APRENDIDO[papel];
    if (!aprendido || !aprendido.hash) throw new Error('nao_aprendeu:' + papel);
    const cab = { 'accept': 'text/x-component', 'content-type': 'text/plain;charset=UTF-8',
                  'next-action': aprendido.hash };
    const arv = arvorePara(papel, cotacaoId);
    if (arv) cab['next-router-state-tree'] = arv;
    const resp = await fetchOriginal.call(window, ORIGEM + caminho, {
      method: 'POST', headers: cab, body: JSON.stringify(corpo),
      credentials: 'include', redirect: 'follow',
    });
    if (!resp.ok && resp.status !== 303) throw new Error('http_' + resp.status);
    return { texto: await resp.text(), resp };
  }

  // A resposta vem em linhas "N:conteudo". As ações de dado põem o resultado
  // numa linha que é JSON puro — pegamos a primeira que for array de objeto.
  function primeiroArray(texto) {
    for (const linha of String(texto).split('\n')) {
      const v = linha.indexOf(':');
      if (v < 0) continue;
      const resto = linha.slice(v + 1);
      if (resto[0] !== '[') continue;
      try {
        const d = JSON.parse(resto);
        if (Array.isArray(d) && d.length && typeof d[0] === 'object') return d;
      } catch (e) { /* linha de componente, não de dado */ }
    }
    return null;
  }

  // ── Ler o preço ───────────────────────────────────────────────────────────
  //
  //  Aqui mora a única leitura por texto do projeto inteiro, e ela é assim
  //  porque a resposta do preço é o render da tela, não um JSON de dado. O
  //  valor está em texto claro; o que não existe é etiqueta ligando cada preço
  //  ao seu plano. Por isso o preço vai um plano por vez lá embaixo.
  function cartoes(texto) {
    const achados = [];
    const rx = /"value":([\d.]+)\}/g;
    let m;
    const posicoes = [];
    while ((m = rx.exec(texto))) posicoes.push([m.index, parseFloat(m[1])]);
    posicoes.forEach(([pos, total], i) => {
      const fim = i + 1 < posicoes.length ? posicoes[i + 1][0] : Math.min(texto.length, pos + 6000);
      const trecho = texto.slice(pos, fim);
      const faixas = [];
      // Ancorar na CHAVE da linha, não no rótulo que o corretor lê.
      //
      // O rótulo muda de forma no fim da tabela: as nove primeiras faixas
      // dizem "54 a 58", e a última diz "59 ou mais". Lendo pelo rótulo a
      // faixa mais cara ficava de fora e o somatório dava menos que o total —
      // ninguém perceberia, porque o total vem certo do mesmo jeito. A chave
      // ("59-199") é a mesma que a gente já manda no pedido.
      const rx2 = /\["\$","div","(\d+-\d+)",\{[\s\S]{0,300}?"children":\[(\d+)," x ","R\$\s?([\d.]+,\d\d)"\]/g;
      let f;
      while ((f = rx2.exec(trecho))) {
        faixas.push({ faixa: f[1], quantidade: Number(f[2]),
                      unitario: Number(f[3].replace(/\./g, '').replace(',', '.')) });
      }
      // Conferência de graça: a soma das faixas TEM que dar o total. Se um dia
      // eles mudarem o desenho e a leitura das faixas começar a perder linha,
      // isso avisa — em vez de a extensão mostrar um detalhamento incompleto
      // ao lado de um total certo, que é o erro que ninguém enxerga.
      const soma = faixas.reduce((s, f) => s + f.quantidade * f.unitario, 0);
      const t = Math.round(total * 100) / 100;
      achados.push({ total: t, faixas, conferido: !!faixas.length && Math.abs(soma - t) < 0.05 });
    });
    return achados;
  }

  // Tira do conjunto novo o que já estava no anterior. Usa contagem, não
  // presença: dois planos podem custar exatamente o mesmo, e nesse caso o
  // segundo continua sendo resultado legítimo.
  function novoCartao(antes, depois) {
    const sobra = depois.slice();
    antes.forEach((a) => {
      const i = sobra.findIndex((b) => b.total === a.total);
      if (i >= 0) sobra.splice(i, 1);
    });
    return sobra[0] || null;
  }

  // ── As quatro chamadas ────────────────────────────────────────────────────

  // Espera com variação, entre uma chamada e outra.
  //
  // O que denuncia máquina não é ser rápido — é ser CERTINHO. Vinte chamadas
  // igualmente espaçadas em 40ms não existem em navegação humana; o mesmo
  // volume com intervalo irregular é só um corretor com pressa. O custo disso
  // é a cotação sair em segundos em vez de em um segundo, e vale pagar.
  function respira(min, max) {
    return new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
  }

  async function criarCotacao(titulo) {
    // Título igual ao que a tela deles manda por padrão. "Cotação JOB" seria
    // uma etiqueta nossa dentro do sistema deles — resíduo puro.
    const { texto } = await acao('criar', '/cotacoes/nova', [{ titulo: titulo || 'Cotação' }]);
    // Ler o id por "cotacaoId", e não pelo primeiro UUID do corpo.
    //
    // A resposta do "criar" é o render inteiro da página nova, e nele vêm
    // JUNTO os ids das cotações antigas da lista. O primeiro UUID do texto é
    // de outra cotação — a de outro cliente. Seria o pior tipo de erro: a
    // extensão cotaria calada dentro do orçamento errado. "cotacaoId" aparece
    // uma vez só e é sempre o da cotação recém-criada (conferido na captura).
    const m = String(texto).match(/"cotacaoId":"([0-9a-f-]{36})"/i);
    if (!m) throw new Error('sem_id_de_cotacao');
    return m[1];
  }

  // A única chamada que não é Server Action: API JSON limpa, sem hash, e é de
  // onde sai a string EXATA de cidade que todo o resto espera. Montar
  // "São Paulo/SP" na mão não funciona — tem que ser o formato deles.
  async function buscarCidades(termo) {
    const t = String(termo || '').trim();
    if (t.length < 3) return [];
    const resp = await fetchOriginal.call(window,
      ORIGEM + '/api/cidades?term=' + encodeURIComponent(t),
      { credentials: 'include', headers: { accept: 'application/json' } });
    if (!resp.ok) throw new Error('http_' + resp.status);
    const d = await resp.json();
    return Array.isArray(d) ? d : [];
  }

  // Monta o terreno na cotação recém-criada.
  //
  // Nada disso devolve dado — e foi por isso que passou despercebido. Mas é
  // aqui que a cotação passa a saber quantas vidas tem e de que cidade é, e o
  // pedido de preço depende das duas coisas: ele manda só a identidade do
  // plano e espera que o resto já esteja gravado.
  async function abrirCotacao(cotacaoId) {
    await acao('abrir', `/cotacoes/${cotacaoId}/edit`, [cotacaoId], cotacaoId);
  }

  async function salvarVidas(cotacaoId, vidas) {
    await acao('vidas', `/cotacoes/${cotacaoId}/edit`,
               [{ cotacaoId, nome: 'GERAL', vidas: vidas || [] }], cotacaoId);
  }

  async function salvarFiltro(cotacaoId, p) {
    await acao('filtro', `/cotacoes/${cotacaoId}/edit?d=cenarios`,
               [cotacaoId, { cidade: p.cidade,
                             modalidade: p.modalidade == null ? 2 : p.modalidade,
                             credenciados: [], perfil: '$undefined' }], cotacaoId);
  }

  function filtroBase(p) {
    return { cidade: p.cidade, modalidade: p.modalidade == null ? 2 : p.modalidade,
             credenciados: [], perfil: '$undefined', vidas: p.vidas };
  }

  async function operadorasDaCidade(cotacaoId, p) {
    const { texto } = await acao('operadoras', `/cotacoes/${cotacaoId}/edit?d=cenarios`,
                                 [{ filtro: filtroBase(p) }], cotacaoId);
    return primeiroArray(texto) || [];
  }

  async function planosDaOperadora(cotacaoId, p, operadoraId) {
    const { texto } = await acao('planos', `/cotacoes/${cotacaoId}/edit?d=cenarios`,
                                 [{ ...filtroBase(p), busca: '$undefined', operadoraId }], cotacaoId);
    return primeiroArray(texto) || [];
  }

  async function precoDoPlano(cotacaoId, p, plano, antes) {
    const corpo = [cotacaoId, {
      cidade: p.cidade, modalidade: p.modalidade == null ? 2 : p.modalidade,
      credenciados: [], perfil: '$undefined',
      key: plano.key, administradora: plano.administradora, operadora: plano.operadora,
      produto: plano.produto, plano: plano.plano, tabela: plano.tabela,
    }];
    const { texto } = await acao('preco', `/cotacoes/${cotacaoId}/edit?d=cenarios`, corpo, cotacaoId);
    const agora = cartoes(texto);
    return { cartao: novoCartao(antes, agora), estado: agora };
  }

  // Descarta antes de pedir preço o que não serve pro cliente. Cada plano
  // descartado aqui é uma chamada de ~250ms que não acontece — e como o preço
  // é a única etapa sequencial, é aqui que a cotação fica rápida.
  function serve(plano, vidas, exigencias) {
    const total = (vidas || []).reduce((s, v) => s + (Number(v.quantidade) || 0), 0);
    const t = plano.tabela || {};
    if (t.qtdVidaMin && total < t.qtdVidaMin) return false;
    if (t.qtdVidaMax && total > t.qtdVidaMax) return false;
    const e = exigencias || {};
    if (e.coparticipacao != null && !!t.coparticipacao !== !!e.coparticipacao) return false;
    if (e.mei === true && t.mei !== true) return false;
    if (e.acomodacao != null && (plano.plano || {}).acomodacao !== e.acomodacao) return false;
    return true;
  }

  // ── O multicálculo ────────────────────────────────────────────────────────

  async function cotar(pedido, aoAndar) {
    const p = pedido || {};
    if (!p.cidade) throw new Error('sem_cidade');
    if (!Array.isArray(p.vidas) || !p.vidas.length) throw new Error('sem_vidas');
    const avisa = (fase, feito, total) => {
      try { aoAndar && aoAndar({ fase, feito, total }); } catch (e) { /* aviso não derruba cotação */ }
    };
    const t0 = Date.now();

    // Consulta de apoio reaproveita a última cotação; só cotação de verdade
    // cria uma nova.
    //
    // Toda chamada ao Painel precisa de um id de cotação na URL, inclusive a
    // pergunta boba "quais operadoras atendem essa cidade?". Criando uma por
    // pergunta, o consultor deixaria dezenas de cotações vazias no sistema
    // deles num dia de trabalho — cada uma com o nome dele. Rastro puro, e do
    // tipo que fica.
    let cotacaoId = null;
    if (p.somenteOperadoras && ultimaCotacao) {
      cotacaoId = ultimaCotacao;
    } else {
      avisa('criando');
      cotacaoId = await criarCotacao(p.titulo);
      ultimaCotacao = cotacaoId;
      // Mesmo terreno que o caminho passo a passo monta. Sem isto o preço volta
      // http_500 em todo plano — o servidor deles lê as vidas da cotação, não
      // do pedido. Deixar as duas rotas diferentes seria plantar o mesmo bug
      // de novo no dia em que a extensão do WhatsApp usar esta função.
      await abrirCotacao(cotacaoId);
      await salvarVidas(cotacaoId, p.vidas);
      await respira(400, 1100);
    }
    avisa('operadoras');
    const todas = await operadorasDaCidade(cotacaoId, p);
    await salvarFiltro(cotacaoId, p);
    await respira(300, 900);
    const escolhidas = Array.isArray(p.operadoraIds) && p.operadoraIds.length
      ? todas.filter((o) => p.operadoraIds.includes(o.id))
      : todas;

    // A tela pergunta "quais operadoras atendem essa cidade?" antes de deixar o
    // consultor escolher. Sem esta saída, essa pergunta viraria uma cotação
    // inteira — dezenas de consultas ao Painel só pra desenhar uns botões.
    if (p.somenteOperadoras) {
      return { cotacaoId, url: ORIGEM + '/cotacoes/' + cotacaoId + '/edit',
               cidade: p.cidade, vidas: p.vidas,
               operadoras: todas.map((o) => ({ id: o.id, nome: o.nome, logotipo: o.logotipo })),
               planosEncontrados: 0, planosCotados: 0, descartados: 0, suspeitos: 0,
               ms: Date.now() - t0, planos: [] };
    }

    // Duas listas por vez, com respiro entre os lotes.
    //
    // Quatro em paralelo seria mais rápido, mas quatro chamadas saindo no
    // mesmo milissegundo é coisa que a tela deles nunca faz — um corretor
    // clica numa operadora de cada vez. Duas ainda cabe em "o cara clicou
    // rápido"; quatro não cabe em nada.
    const planos = [];
    for (let i = 0; i < escolhidas.length; i += 2) {
      const lote = escolhidas.slice(i, i + 2);
      const r = await Promise.all(lote.map((o) =>
        planosDaOperadora(cotacaoId, p, o.id).catch(() => [])));
      r.forEach((lista) => planos.push(...lista));
      avisa('planos', Math.min(i + 2, escolhidas.length), escolhidas.length);
      if (i + 2 < escolhidas.length) await respira(280, 900);
    }

    const candidatos = planos.filter((pl) => serve(pl, p.vidas, p.exigencias));
    const teto = p.maxPlanos || 20;
    const alvo = candidatos.slice(0, teto);

    // Preço é sequencial por imposição deles: a resposta traz todos os
    // cenários juntos, sem dizer qual preço é de qual plano. Um por vez, a
    // diferença em relação à resposta anterior é o plano que acabamos de pedir.
    const resultado = [];
    let estado = [];
    for (let i = 0; i < alvo.length; i++) {
      try {
        const r = await precoDoPlano(cotacaoId, p, alvo[i], estado);
        estado = r.estado;
        if (r.cartao) {
          resultado.push({ ...alvo[i], total: r.cartao.total, faixas: r.cartao.faixas,
                           conferido: r.cartao.conferido });
        } else {
          // Sem valor não inventa: marca como não cotado e segue. Preço errado
          // numa proposta é pior que preço faltando.
          resultado.push({ ...alvo[i], total: null, faixas: [], motivo: 'sem_valor_na_resposta' });
        }
      } catch (e) {
        resultado.push({ ...alvo[i], total: null, faixas: [], motivo: String(e.message || e) });
      }
      avisa('precos', i + 1, alvo.length);
      if (i + 1 < alvo.length) await respira(240, 780);
    }

    resultado.sort((a, b) => (a.total == null) - (b.total == null) || (a.total - b.total));
    return {
      cotacaoId,
      url: ORIGEM + '/cotacoes/' + cotacaoId + '/edit',
      cidade: p.cidade,
      vidas: p.vidas,
      operadoras: escolhidas.map((o) => ({ id: o.id, nome: o.nome, logotipo: o.logotipo })),
      planosEncontrados: planos.length,
      planosCotados: resultado.length,
      descartados: planos.length - candidatos.length,
      // Quantos vieram com detalhamento que não fecha com o total. Zero é o
      // esperado; qualquer coisa acima disso é sinal de que a tela deles mudou.
      suspeitos: resultado.filter((r) => r.total != null && !r.conferido).length,
      ms: Date.now() - t0,
      planos: resultado,
    };
  }

  // ── Um passo por vez, sem relógio aqui dentro ─────────────────────────────
  //
  //  Quem manda no ritmo passou a ser a tela do JOB, e por um motivo medido:
  //  esta aba fica em SEGUNDO PLANO enquanto o consultor olha o JOB, e o Chrome
  //  estrangula temporizador de aba escondida. As esperas de 300–900ms que eu
  //  programei aqui viravam ate um minuto cada depois de alguns minutos oculta
  //  — quinze esperas numa cotacao, e o que era pra levar dez segundos levava
  //  quinze minutos. Nao era a rede da Trindade: era o navegador dormindo.
  //
  //  Aqui cada acao e uma chamada e acabou. A pausa entre elas acontece na aba
  //  visivel, onde o relogio funciona — e o disfarce continua igual, porque o
  //  que o servidor deles ve e exatamente o mesmo espacamento irregular.
  let _cartoesAtuais = [];

  async function passo(p) {
    const a = (p && p.acao) || '';
    if (a === 'criar') {
      // Consulta de apoio (só listar operadoras) reaproveita a cotação que já
      // existe. Criar uma por pergunta deixaria dezenas de cotações vazias com
      // o nome do corretor dentro do sistema deles num dia de trabalho.
      if (p.reaproveitar && ultimaCotacao) {
        return { cotacaoId: ultimaCotacao,
                 url: ORIGEM + '/cotacoes/' + ultimaCotacao + '/edit', reaproveitada: true };
      }
      _cartoesAtuais = [];
      ultimaCotacao = await criarCotacao(p.titulo);
      // As vidas vão JUNTO com a criação, sempre. Separar em outro passo seria
      // dar chance de existir cotação sem distribuição — e cotação sem
      // distribuição é exatamente a que devolve 500 no preço.
      await abrirCotacao(ultimaCotacao);
      await salvarVidas(ultimaCotacao, p.vidas);
      return { cotacaoId: ultimaCotacao,
               url: ORIGEM + '/cotacoes/' + ultimaCotacao + '/edit' };
    }
    if (a === 'operadoras') {
      const lista = await operadorasDaCidade(p.cotacaoId, p);
      // Grava a cidade e o tipo de contratação na cotação: o pedido de preço
      // não os manda, lê daqui.
      await salvarFiltro(p.cotacaoId, p);
      return { operadoras: lista.map((o) => ({ id: o.id, nome: o.nome, logotipo: o.logotipo })) };
    }
    if (a === 'planos') {
      return { planos: await planosDaOperadora(p.cotacaoId, p, p.operadoraId) };
    }
    // Gravar cidade e contratação sem precisar listar operadora nenhuma.
    //
    // Quando o consultor já escolheu o plano na navegação, a cotação pula a
    // listagem inteira e vai direto ao preço — mas o preço lê a cidade DA
    // cotação. Sem este passo separado, pular a listagem traria de volta o
    // http_500 por outro caminho.
    if (a === 'filtro') {
      await salvarFiltro(p.cotacaoId, p);
      return { ok: true };
    }
    if (a === 'selecionar') {
      // A peneira mora aqui, e nao na tela, pra existir uma regra so. Duas
      // copias da mesma regra divergem no primeiro ajuste.
      let candidatos = p.planos || [];
      // Produto escolhido pelo consultor corta antes de tudo. Cada plano que
      // ele nao quer e uma consulta de ~1s ao Painel que nao acontece — e o
      // jeito mais eficaz de acelerar sem mexer no disfarce.
      if (Array.isArray(p.produtoIds) && p.produtoIds.length) {
        candidatos = candidatos.filter(
          (pl) => p.produtoIds.indexOf((pl.produto || {}).id) >= 0);
      }
      const servem = candidatos.filter((pl) => serve(pl, p.vidas, p.exigencias));
      return { alvo: servem.slice(0, p.maxPlanos || 20),
               encontrados: (p.planos || []).length,
               descartados: (p.planos || []).length - servem.length };
    }
    if (a === 'preco') {
      const r = await precoDoPlano(p.cotacaoId, p, p.plano, _cartoesAtuais);
      _cartoesAtuais = r.estado;
      return { cartao: r.cartao };
    }
    throw new Error('passo_desconhecido:' + a);
  }

  // ── Catálogo: o que existe, sem perguntar preço ───────────────────────────
  //
  //  Cotar responde "quanto custa para ESTE cliente". O catálogo responde
  //  "o que existe nesta cidade" — quais operadoras atendem, quais planos elas
  //  têm, com e sem coparticipação, enfermaria ou apartamento, de quantas a
  //  quantas vidas. Isso não muda por cliente e não precisa de preço, então dá
  //  pra varrer uma vez e guardar no JOB.
  //
  //  Uma cidade+modalidade por chamada, de propósito: quem manda no ritmo é a
  //  tela do JOB, que pode parar no meio, mostrar andamento e espaçar a
  //  varredura ao longo do dia. Um botão que dispara mil chamadas de uma vez
  //  seria rápido e seria exatamente o que não podemos fazer.
  async function catalogo(p) {
    if (!p || !p.cidade) throw new Error('sem_cidade');
    const t0 = Date.now();
    const modalidade = p.modalidade == null ? 2 : p.modalidade;

    // Vidas só existem aqui porque o filtro deles exige; o catálogo é o mesmo.
    // Uma vida por faixa faz a lista vir completa, sem corte por quantidade.
    const vidas = (p.vidas && p.vidas.length) ? p.vidas
      : ['00-18', '19-23', '24-28', '29-33', '34-38', '39-43', '44-48', '49-53', '54-58', '59-199']
        .map((f) => ({ faixa: f, quantidade: 1 }));
    const pedido = { cidade: p.cidade, modalidade, vidas };

    let cotacaoId = ultimaCotacao;
    if (!cotacaoId) {
      cotacaoId = await criarCotacao(p.titulo);
      ultimaCotacao = cotacaoId;
      await respira(400, 1100);
    }

    const operadoras = await operadorasDaCidade(cotacaoId, pedido);
    let chamadas = 1;
    const planos = [];
    for (let i = 0; i < operadoras.length; i++) {
      await respira(320, 950);
      try {
        const lista = await planosDaOperadora(cotacaoId, pedido, operadoras[i].id);
        chamadas++;
        lista.forEach((pl) => planos.push({
          operadoraId: operadoras[i].id,
          operadora: (pl.operadora || {}).nome || operadoras[i].nome,
          administradora: (pl.administradora || {}).nome || '',
          produtoId: (pl.produto || {}).id, produto: (pl.produto || {}).nome || '',
          planoId: (pl.plano || {}).id, plano: (pl.plano || {}).nome || '',
          acomodacao: (pl.plano || {}).acomodacao,
          tabelaId: (pl.tabela || {}).id, tabela: (pl.tabela || {}).nome || '',
          contratacao: (pl.tabela || {}).contratacao,
          coparticipacao: !!(pl.tabela || {}).coparticipacao,
          coparticipacaoTipo: ((pl.tabela || {}).coparticipacaoTipo || '').trim(),
          remissao: !!(pl.tabela || {}).remissao,
          mei: (pl.tabela || {}).mei === true,
          vidaMin: (pl.tabela || {}).qtdVidaMin, vidaMax: (pl.tabela || {}).qtdVidaMax,
          chave: pl.key,
        }));
      } catch (e) {
        // Uma operadora que falha não pode derrubar a varredura inteira: a
        // próxima rodada pega o que ficou faltando.
        planos.push({ operadoraId: operadoras[i].id, operadora: operadoras[i].nome,
                      erro: String(e && e.message || e) });
      }
      if (p.aoAndar !== false) {
        window.postMessage({ source: 'JOB_COTADOR', tipo: 'andamento', reqId: p.reqId,
                             fase: 'catalogo', feito: i + 1, total: operadoras.length }, ORIGEM);
      }
    }

    return {
      cidade: p.cidade, modalidade, chamadas, ms: Date.now() - t0,
      operadoras: operadoras.map((o) => ({ id: o.id, nome: o.nome, logotipo: o.logotipo })),
      planos,
    };
  }

  // Descobre quais códigos de modalidade existem, sem chutar.
  //
  // Sabemos que 2 é PME porque foi o que a captura mostrou. Os outros (PF,
  // Adesão) são números que ninguém documentou. Em vez de adivinhar — o que
  // faria a cotação pedir preço do produto errado e mostrar como certo —, a
  // extensão pergunta por cada código e traz de volta QUEM atende em cada um.
  // O Guilherme olha a lista de operadoras e reconhece qual é qual: a lista de
  // PF não se parece com a de PME.
  //
  // Custo: seis consultas leves, uma vez na vida. Não vale automatizar mais
  // que isso; vale menos ainda errar.
  async function descobrirModalidades(cidade) {
    if (!cidade) throw new Error('sem_cidade');
    let cotacaoId = ultimaCotacao;
    if (!cotacaoId) {
      cotacaoId = await criarCotacao();
      ultimaCotacao = cotacaoId;
      await respira(400, 1100);
    }
    const vidas = [{ faixa: '29-33', quantidade: 1 }];
    const achados = [];
    // Até 9, não até 5. A tela deles tem PF, PME e Adesão em Saúde E os mesmos
    // três em Dental — são seis combinações possíveis, e eu só procurava seis
    // códigos contando a partir do zero. Sondar alguns a mais custa uma
    // consulta leve cada e evita concluir que um tipo "não existe" quando na
    // verdade eu é que parei de procurar cedo.
    for (let m = 0; m <= 9; m++) {
      try {
        const ops = await operadorasDaCidade(cotacaoId, { cidade, modalidade: m, vidas });
        if (ops.length) {
          achados.push({ codigo: m, quantas: ops.length,
                         amostra: ops.slice(0, 6).map((o) => o.nome) });
          MODALIDADES[m] = true;
        }
      } catch (e) { /* código que não existe responde erro: só pular */ }
      await respira(300, 900);
    }
    if (achados.length) {
      window.postMessage({ source: 'JOB_COTADOR', tipo: 'modalidades',
                           dados: Object.keys(MODALIDADES).map(Number) }, ORIGEM);
    }
    return { cidade, achados };
  }

  // ── Ponte com o resto da extensão ─────────────────────────────────────────

  function faltando() {
    return PAPEIS.filter((k) => !(APRENDIDO[k] && APRENDIDO[k].hash));
  }

  window.addEventListener('message', async (ev) => {
    if (ev.source !== window || !ev.data || ev.data.source !== 'JOB_COTADOR_BRIDGE') return;
    const d = ev.data;
    const responder = (payload) => window.postMessage(
      { source: 'JOB_COTADOR', tipo: 'resposta', reqId: d.reqId, ...payload }, ORIGEM);

    if (d.tipo === 'estado') {
      responder({ ok: true, pronto: !faltando().length, faltando: faltando(),
                  modalidades: Object.keys(MODALIDADES).map(Number) });
      return;
    }
    if (d.tipo === 'passo') {
      const f = faltando();
      if (f.length) { responder({ ok: false, motivo: 'precisa_aprender', faltando: f }); return; }
      try { responder({ ok: true, dados: await passo(d.pedido) }); }
      catch (e) { responder({ ok: false, motivo: String(e && e.message || e) }); }
      return;
    }
    if (d.tipo === 'descobrir_modalidades') {
      const f = faltando();
      if (f.length) { responder({ ok: false, motivo: 'precisa_aprender', faltando: f }); return; }
      try { responder({ ok: true, dados: await descobrirModalidades((d.pedido || {}).cidade) }); }
      catch (e) { responder({ ok: false, motivo: String(e && e.message || e) }); }
      return;
    }
    if (d.tipo === 'catalogo') {
      const f = faltando();
      if (f.length) { responder({ ok: false, motivo: 'precisa_aprender', faltando: f }); return; }
      try {
        responder({ ok: true, dados: await catalogo({ ...(d.pedido || {}), reqId: d.reqId }) });
      } catch (e) { responder({ ok: false, motivo: String(e && e.message || e) }); }
      return;
    }
    if (d.tipo === 'cidades') {
      try { responder({ ok: true, dados: await buscarCidades(d.termo) }); }
      catch (e) { responder({ ok: false, motivo: String(e && e.message || e) }); }
      return;
    }
    if (d.tipo === 'cotar') {
      const f = faltando();
      if (f.length) { responder({ ok: false, motivo: 'precisa_aprender', faltando: f }); return; }
      try {
        responder({ ok: true, dados: await cotar(d.pedido, (a) => window.postMessage(
          { source: 'JOB_COTADOR', tipo: 'andamento', reqId: d.reqId, ...a }, ORIGEM)) });
      } catch (e) {
        responder({ ok: false, motivo: String(e && e.message || e) });
      }
    }
  });

  // Nada de atalho global nem de log: qualquer coisa pendurada no window fica
  // visível pra quem abrir o console naquela máquina — inclusive um suporte da
  // Trindade num acesso remoto. O cotador não deixa rastro na página.
})();
