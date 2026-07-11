// Config da extensão: URL do JOB + chave, salvos em chrome.storage.sync.
const JOB_URL_PADRAO = 'https://job-serenus-production.up.railway.app';

const $ = (id) => document.getElementById(id);

function status(txt, cls) {
  const s = $('status');
  s.textContent = txt;
  s.className = cls || 'info';
}

async function carregar() {
  const { jobUrl, extKey, usuarioId } = await chrome.storage.sync.get(['jobUrl', 'extKey', 'usuarioId']);
  $('jobUrl').value = jobUrl || JOB_URL_PADRAO;
  $('extKey').value = extKey || '';
  if (extKey) await carregarUsuarios(usuarioId);
}

async function carregarUsuarios(selecionadoId) {
  const resp = await chrome.runtime.sendMessage({ type: 'usuarios' });
  const sel = $('usuarioId');
  const atual = selecionadoId != null ? String(selecionadoId) : sel.value;
  if (!resp || !resp.ok) return;
  sel.innerHTML = '<option value="">Selecione…</option>' +
    (resp.usuarios || []).map((u) => '<option value="' + u.id + '">' + u.nome + '</option>').join('');
  if (atual) sel.value = atual;
}

async function salvar() {
  const jobUrl = ($('jobUrl').value || JOB_URL_PADRAO).trim().replace(/\/+$/, '');
  const extKey = ($('extKey').value || '').trim();
  const usuarioId = $('usuarioId').value || '';
  await chrome.storage.sync.set({ jobUrl, extKey, usuarioId });
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
carregar();
