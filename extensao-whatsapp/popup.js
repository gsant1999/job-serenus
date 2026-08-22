// Config da extensão: URL do JOB + chave, salvos em chrome.storage.local
// (nunca usar chrome.storage.sync aqui — tem limite de 8KB por item e fica
// sujeito à cota de sincronização da conta Google; local não tem essa
// restrição, e esse dado é só deste computador mesmo, não precisa sincronizar).
const JOB_URL_PADRAO = 'https://job-serenus-production.up.railway.app';

const $ = (id) => document.getElementById(id);

function status(txt, cls) {
  const s = $('status');
  s.textContent = txt;
  s.className = cls || 'info';
}

// O popup agora leva pro painel em vez de tentar ser a tela. Abre uma aba do
// WhatsApp (ou usa a que já estiver aberta) e pede pro painel abrir em
// Configurações — que é onde a tela de verdade mora.
async function abrirPainel() {
  try {
    const abas = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' });
    if (!abas || !abas.length) {
      await chrome.tabs.create({ url: 'https://web.whatsapp.com/' });
      window.close();
      return;
    }
    // O RECADO VAI ANTES DE FOCAR A ABA, E O POPUP SÓ FECHA DEPOIS DELE.
    //
    // Estava ao contrário: focava a aba, mandava a mensagem e chamava
    // window.close() na sequência. Focar outra aba já fecha o popup sozinho —
    // e fechar o popup MATA o contexto que estava mandando a mensagem. Ela
    // saía pela metade e o painel nunca abria em Configurações. Era só isso.
    try {
      await chrome.tabs.sendMessage(abas[0].id, { type: 'abrir_config' });
    } catch (e) {
      // A aba pode estar sem o content script (WhatsApp ainda carregando).
      status('Abra o WhatsApp Web e clique na engrenagem do painel.', 'err');
      return;
    }
    await chrome.tabs.update(abas[0].id, { active: true });
    try { await chrome.windows.update(abas[0].windowId, { focused: true }); } catch (e) {}
    window.close();
  } catch (e) {
    status('Abra o WhatsApp Web e clique na engrenagem do painel.', 'err');
  }
}

function pintarQuem(usuario, apelido) {
  const entrou = !!(usuario && usuario.nome);
  $('sair').style.display = entrou ? '' : 'none';
  $('quemNome').className = 'quem-n' + (entrou ? '' : ' fora');
  if (entrou) {
    $('quemNome').textContent = usuario.nome;
    $('quemIni').textContent = (usuario.nome || '?').trim().charAt(0).toUpperCase();
    $('quemAparelho').textContent = apelido || 'este computador';
  } else {
    $('quemNome').textContent = 'Não conectado';
    $('quemIni').textContent = '?';
    $('quemAparelho').textContent = 'Entre pelo painel no WhatsApp';
  }
}

async function entrar() {
  const email = ($('loginEmail').value || '').trim();
  const senha = $('loginSenha').value || '';
  const apelido = ($('loginApelido').value || '').trim();
  if (!email || !senha) { status('Preencha e-mail e senha.', 'err'); return; }
  // A URL precisa estar salva ANTES: o login vai pra ela.
  await salvar();
  status('Entrando…', 'info');
  const r = await chrome.runtime.sendMessage({ type: 'login', payload: { email, senha, apelido } });
  if (!r || !r.ok) {
    // O MOTIVO DO SERVIDOR APARECE. "Não deu" faz a pessoa tentar a mesma
    // senha três vezes; "senha incorreta" e "usuário inativo" se resolvem de
    // formas diferentes.
    status(r && r.erro === 'credenciais_invalidas' ? 'E-mail ou senha incorretos.'
         : r && r.erro === 'usuario_inativo' ? 'Este usuário está inativo no JOB.'
         : (r && r.erro) || 'Não consegui entrar agora.', 'err');
    return;
  }
  // A senha some da tela junto com o sucesso — ela não é guardada em lugar
  // nenhum, e deixá-la no campo só aumenta a chance de alguém ver.
  $('loginSenha').value = '';
  pintarQuem(r.usuario, apelido);
  status('Conectado como ' + ((r.usuario && r.usuario.nome) || 'você') + '.', 'ok');
}

async function sair() {
  if (!confirm('Sair deste aparelho? Você precisa entrar de novo pra usar a extensão aqui.')) return;
  status('Saindo…', 'info');
  await chrome.runtime.sendMessage({ type: 'logout' });
  pintarQuem(null, '');
  status('Saiu deste aparelho.', 'info');
}

async function carregar() {
  const { jobUrl, extKey, extToken, usuarioId, railSide, tema, extensaoAtiva, extUsuario, extApelido } =
    await chrome.storage.local.get(['jobUrl', 'extKey', 'extToken', 'usuarioId', 'railSide', 'tema',
                                    'extensaoAtiva', 'extUsuario', 'extApelido']);
  pintarQuem(extUsuario, extApelido);
  if (extApelido) $('loginApelido').value = extApelido;
  // O QUE ESTA GUARDADO AQUI NAO PROVA NADA.
  //
  // Este popup mostrava o nome e o botao "Sair deste computador" so porque
  // havia um `extUsuario` no storage — mesmo depois de um admin ter
  // desconectado o aparelho pelo site. Quem abria via a si proprio conectado,
  // nao tinha o que clicar, fechava, e continuava desconectado. Isso aconteceu
  // tres vezes seguidas hoje, com "entrei pelo popup" que nunca criou sessao.
  //
  // Agora pergunta ao servidor. Se o token morreu, o background apaga tudo e
  // esta tela volta pro formulario de entrar, que e a unica coisa que resolve.
  if (extUsuario) {
    try {
      const r = await chrome.runtime.sendMessage({ type: 'sessao_confere' });
      // So o 401 derruba: servidor fora do ar nao desloga ninguem.
      if (r && r.valida === false && r.tinhaToken) {
        pintarQuem(null, '');
        status('Este aparelho foi desconectado. Entre de novo.', 'err');
      }
    } catch (e) { /* sem resposta: nao mexe no que esta na tela */ }
  }
  try {
    const v = (chrome.runtime.getManifest() || {}).version;
    if (v) $('topoVersao').textContent = 'Extensão do WhatsApp · v' + v;
  } catch (e) {}
  $('jobUrl').value = jobUrl || JOB_URL_PADRAO;
  $('extKey').value = extKey || '';
  // Direita é o padrão (mesma regra do content.js). O que importa é o JOB
  // ficar no lado OPOSTO ao trilho de outra extensão — duas no mesmo lado
  // disputam a margem do <html> e se sobrepõem.
  $('railSide').value = railSide === 'esquerda' ? 'esquerda' : 'direita';
  $('tema').value = tema === 'claro' ? 'claro' : 'escuro';
  $('extensaoAtiva').checked = extensaoAtiva !== false; // default ligada
  // GATEADO SO NO extKey, O LOGIN NOVO NUNCA CARREGAVA A LISTA.
  //
  // `entrar()` (e-mail + senha) nunca chama `carregarUsuarios` — so o botao
  // "Testar conexao" chamava. Quem loga pelo jeito novo e nao clica em testar
  // abre o popup com o combo de usuario vazio pra sempre: nada pra selecionar,
  // mesmo estando conectado. E a extensao inteira barra em cima disso — enviar
  // mensagem, disparar funil e salvar cotacao todos leem `usuarioId` do
  // storage e recusam com "Selecione seu usuario no popup" se estiver vazio.
  // A dica da mensagem virava um beco sem saida: o campo que ela manda abrir
  // nunca tinha o que escolher.
  //
  // `usuarios` (background.js) ja aceita as duas formas de entrar, igual toda
  // chamada que passa por `chamarJob` — o gate aqui nunca teve motivo pra ser
  // so extKey.
  if (extKey || extToken) await carregarUsuarios(usuarioId);
  else atualizarAvisoUsuario();
}

async function carregarUsuarios(selecionadoId) {
  const resp = await chrome.runtime.sendMessage({ type: 'usuarios' });
  const sel = $('usuarioId');
  const atual = selecionadoId != null ? String(selecionadoId) : sel.value;
  if (!resp || !resp.ok) return;
  sel.innerHTML = '<option value="">Selecione…</option>' +
    (resp.usuarios || []).map((u) => '<option value="' + u.id + '">' + u.nome + '</option>').join('');
  if (atual) sel.value = atual;
  atualizarAvisoUsuario();
}

function atualizarAvisoUsuario() {
  const aviso = $('usuarioIdAviso');
  if (aviso) aviso.style.display = $('usuarioId').value ? 'none' : '';
}

async function salvar() {
  const jobUrl = ($('jobUrl').value || JOB_URL_PADRAO).trim().replace(/\/+$/, '');
  const extKey = ($('extKey').value || '').trim();
  const usuarioId = $('usuarioId').value || '';
  const railSide = $('railSide').value === 'esquerda' ? 'esquerda' : 'direita';
  const tema = $('tema').value === 'claro' ? 'claro' : 'escuro';
  const extensaoAtiva = $('extensaoAtiva').checked;
  await chrome.storage.local.set({ jobUrl, extKey, usuarioId, railSide, tema, extensaoAtiva });
  atualizarAvisoUsuario();
  status('Salvo.', 'ok');
}

async function testar() {
  await salvar();
  status('Testando…', 'info');
  const resp = await chrome.runtime.sendMessage({ type: 'ping' });
  if (resp && resp.ok) {
    status('Conectado ao JOB ✓', 'ok');
    await carregarUsuarios();
  } else {
    status((resp && resp.erro) || 'Falha na conexão', 'err');
  }
}

$('abrirPainel').addEventListener('click', abrirPainel);
$('entrar').addEventListener('click', entrar);
$('sair').addEventListener('click', sair);
// Enter no campo da senha entra — quem digita senha espera isso, e sem ele a
// pessoa aperta Enter, nada acontece, e ela acha que travou.
$('loginSenha').addEventListener('keydown', (e) => { if (e.key === 'Enter') entrar(); });
// SEM BOTÃO SALVAR. Cada campo salva ao sair dele — botão de salvar num
// painel de configuração é uma armadilha: a pessoa muda, fecha, e a mudança
// se perde sem aviso. Ele continua no HTML (escondido) porque `testar()` o usa.
$('jobUrl').addEventListener('change', salvar);
$('extKey').addEventListener('change', salvar);
$('testar').addEventListener('click', testar);
// Sem isso, escolher o consultor na lista (já populada por "Testar conexão")
// só era salvo se o usuário clicasse "Salvar" de novo depois — fácil de
// esquecer, e aí o lead criado automaticamente ficava sem responsável.
$('usuarioId').addEventListener('change', salvar);
$('railSide').addEventListener('change', salvar);
$('tema').addEventListener('change', salvar);
$('extensaoAtiva').addEventListener('change', salvar);
carregar();

/* ═══════════════ WhatsApp na nuvem ═══════════════
   Ligado, o consultor manda mensagem e funil com o computador desligado.

   O QR SO E PEDIDO NO CLIQUE. Ele vale ~40s e o servidor tem teto de codigos
   por conexao; um laco de renovacao queima o teto e a tela passa a exibir um
   codigo morto sem dizer nada. Em 20/08/2026 foi exatamente assim que a gente
   perdeu uma hora. Por isso: sem laco, e cada codigo novo e um clique. */

// TEMPO LIMITE OBRIGATORIO.
//
// Sem ele, JOB que nao responde deixava o cartao em "verificando..." e o botao
// em "gerando..." para sempre, sem dizer nada a ninguem. Foi assim que este
// mesmo cartao nasceu quebrado em 21/08/2026: a tela parecia estar pensando
// quando na verdade a chamada tinha morrido. Toda chamada daqui volta em no
// maximo 15s, com erro legivel.
async function nuvemChamar(caminho, metodo) {
  let jobUrl = JOB_URL_PADRAO, extKey = '';
  try { ({ jobUrl, extKey } = await config()); } catch (e) { /* usa o padrao */ }
  let extToken = '';
  try { ({ extToken } = await chrome.storage.local.get(['extToken'])); } catch (e) {}
  if (!extKey && !extToken) {
    return { ok: false, erro: 'Entre com seu e-mail e senha no popup antes.' };
  }
  const cab = { 'Content-Type': 'application/json' };
  if (extKey) cab['X-Extension-Key'] = extKey;
  if (extToken) cab.Authorization = 'Bearer ' + extToken;
  const ctrl = new AbortController();
  const corta = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch((jobUrl || JOB_URL_PADRAO) + caminho,
      { method: metodo || 'GET', headers: cab, signal: ctrl.signal });
    clearTimeout(corta);
    const bruto = await r.text();
    let d;
    try { d = JSON.parse(bruto); } catch (e) {
      return { ok: false, erro: 'O JOB respondeu ' + r.status + ' (resposta ilegivel).' };
    }
    if (!r.ok && !d.erro) d.erro = 'O JOB respondeu ' + r.status + '.';
    return d;
  } catch (e) {
    clearTimeout(corta);
    return { ok: false,
             erro: e.name === 'AbortError'
               ? 'O JOB nao respondeu em 15 segundos.'
               : 'Nao consegui falar com o JOB: ' + (e.message || 'erro de rede') };
  }
}

function nuvemPintar(estado, recado) {
  const luz = $('nuvemLuz');
  if (luz) luz.dataset.e = estado || '';
  const r = $('nuvemRecado');
  if (r) r.textContent = recado || '';
  const conectado = estado === 'conectado';
  const mostrandoQr = !$('nuvemQr').hidden;
  $('nuvemConectar').hidden = conectado || mostrandoQr;
  $('nuvemOutro').hidden = conectado || !mostrandoQr;
  $('nuvemSair').hidden = !conectado;
  if (conectado) { $('nuvemQr').hidden = true; }
}

function nuvemMostrar(sim) {
  // `hidden` sozinho nao basta: a regra .nuvem{display:flex} do CSS ganha dele.
  // Sem esta linha o cartao aparecia mesmo quando devia estar escondido.
  const c = $('nuvem');
  c.hidden = !sim;
  c.style.display = sim ? 'flex' : 'none';
}

async function nuvemEstado() {
  const d = await nuvemChamar('/api/whatsapp/extensao/nuvem/estado');
  if (d && d.disponivel === false) { nuvemMostrar(false); return; }  // nao ligado no sistema
  if (!d || d.ok === false) {
    // ERRO APARECE. Antes isto escondia o cartao e ninguem descobria por que.
    nuvemMostrar(true);
    nuvemPintar('caiu', d && d.erro ? d.erro : 'Nao consegui verificar.');
    return;
  }
  nuvemMostrar(true);
  nuvemPintar(d.estado, d.recado);
}

async function nuvemPedirQr(botao) {
  const antes = botao.textContent;
  botao.disabled = true;
  botao.textContent = 'gerando…';
  const d = await nuvemChamar('/api/whatsapp/extensao/nuvem/qr', 'POST');
  botao.disabled = false;
  botao.textContent = antes;
  if (d && d.ja_conectado) { nuvemEstado(); return; }
  if (!d || !d.ok || !d.qr) {
    // O erro fica na tela, com o texto que o servidor mandou. Codigo que nao
    // veio precisa dizer POR QUE, senao o consultor fica apontando a camera
    // para nada — ou pior, olhando um botao escrito "gerando..." que nunca
    // termina.
    $('nuvemQr').hidden = true;
    nuvemPintar('caiu', (d && d.erro) || 'Nao consegui gerar o codigo. Tente de novo.');
    return;
  }
  $('nuvemQrImg').src = d.qr;
  $('nuvemQr').hidden = false;
  nuvemPintar('conectando', 'Escaneie agora — o codigo vale cerca de 40 segundos.');
  // Confere sozinho por pouco tempo, so para trocar a tela quando conectar.
  // Isto NAO gera codigo novo: so pergunta o estado.
  let voltas = 0;
  const tique = setInterval(async () => {
    voltas++;
    const e = await nuvemChamar('/api/whatsapp/extensao/nuvem/estado');
    if (e && e.estado === 'conectado') { clearInterval(tique); nuvemPintar('conectado', e.recado); }
    else if (voltas >= 20) {
      clearInterval(tique);
      $('nuvemQr').hidden = true;
      nuvemPintar('caiu', 'O codigo venceu. Toque em conectar para gerar outro.');
    }
  }, 3000);
}

function nuvemLigarBotoes() {
  nuvemMostrar(false);   // some ate saber que tem o que mostrar
  const c = $('nuvemConectar'), o = $('nuvemOutro'), s = $('nuvemSair');
  if (c) c.addEventListener('click', () => nuvemPedirQr(c));
  if (o) o.addEventListener('click', () => nuvemPedirQr(o));
  if (s) s.addEventListener('click', async () => {
    if (!confirm('Desconectar seu WhatsApp do servidor? Mensagem agendada deixa de sair.')) return;
    await nuvemChamar('/api/whatsapp/extensao/nuvem/desconectar', 'POST');
    $('nuvemQr').hidden = true;
    nuvemEstado();
  });
  nuvemEstado();
}

document.addEventListener('DOMContentLoaded', nuvemLigarBotoes);

/* ─────────────── O DECK, SEMPRE À MÃO ───────────────
   O endereço do deck e o PIN moravam só na janela do Mac, e o endereço mudava
   sozinho quando o roteador quisesse — o atalho do iPad quebrava sem avisar.
   Aqui eles aparecem onde ele já olha. A pergunta vai para a PRÓPRIA máquina
   (127.0.0.1): de fora, ninguém consegue essa resposta. */
async function deckMostrar() {
  const cartao = document.getElementById('deckCartao');
  const luz = document.getElementById('deckLuz');
  const recado = document.getElementById('deckRecado');
  const copiar = document.getElementById('deckCopiar');
  if (!cartao) return;
  cartao.hidden = false;
  try {
    const ctrl = new AbortController();
    const corta = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch('http://127.0.0.1:8765/api/aqui', { signal: ctrl.signal });
    clearTimeout(corta);
    const d = await r.json();
    if (!d || !d.endereco) throw new Error('sem resposta');
    luz.dataset.e = 'conectado';
    recado.textContent = d.endereco + ' — PIN ' + d.pin
      + (d.fixo ? '' : ' (este endereço muda; ligue o deck de novo para corrigir)');
    copiar.hidden = false;
    copiar.onclick = () => {
      navigator.clipboard.writeText(d.endereco).then(() => {
        copiar.textContent = 'Endereço copiado';
        setTimeout(() => { copiar.textContent = 'Copiar o endereço'; }, 2000);
      });
    };
  } catch (e) {
    // Deck desligado é estado normal, não erro: ele só roda quando ele liga.
    luz.dataset.e = '';
    recado.textContent = 'Desligado no Mac. Abra "Ligar deck" na pasta do JOB.';
    copiar.hidden = true;
  }
}
deckMostrar();
