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

async function carregar() {
  const { jobUrl, extKey, usuarioId, railSide } = await chrome.storage.local.get(['jobUrl', 'extKey', 'usuarioId', 'railSide']);
  $('jobUrl').value = jobUrl || JOB_URL_PADRAO;
  $('extKey').value = extKey || '';
  $('railSide').value = railSide === 'esquerda' ? 'esquerda' : 'direita';
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
  await chrome.storage.local.set({ jobUrl, extKey, usuarioId, railSide });
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

$('salvar').addEventListener('click', salvar);
$('testar').addEventListener('click', testar);
// Sem isso, escolher o consultor na lista (já populada por "Testar conexão")
// só era salvo se o usuário clicasse "Salvar" de novo depois — fácil de
// esquecer, e aí o lead criado automaticamente ficava sem responsável.
$('usuarioId').addEventListener('change', salvar);
$('railSide').addEventListener('change', salvar);
carregar();
