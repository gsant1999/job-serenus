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
  const { jobUrl, extKey, usuarioId, railSide, tema, extensaoAtiva, extUsuario, extApelido } =
    await chrome.storage.local.get(['jobUrl', 'extKey', 'usuarioId', 'railSide', 'tema',
                                    'extensaoAtiva', 'extUsuario', 'extApelido']);
  pintarQuem(extUsuario, extApelido);
  if (extApelido) $('loginApelido').value = extApelido;
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
  if (extKey) await carregarUsuarios(usuarioId);
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
