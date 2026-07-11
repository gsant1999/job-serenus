// Config da extensão: URL do JOB + chave, salvos em chrome.storage.sync.
const JOB_URL_PADRAO = 'https://job-serenus-production.up.railway.app';

const $ = (id) => document.getElementById(id);

function status(txt, cls) {
  const s = $('status');
  s.textContent = txt;
  s.className = cls || 'info';
}

async function carregar() {
  const { jobUrl, extKey } = await chrome.storage.sync.get(['jobUrl', 'extKey']);
  $('jobUrl').value = jobUrl || JOB_URL_PADRAO;
  $('extKey').value = extKey || '';
}

async function salvar() {
  const jobUrl = ($('jobUrl').value || JOB_URL_PADRAO).trim().replace(/\/+$/, '');
  const extKey = ($('extKey').value || '').trim();
  await chrome.storage.sync.set({ jobUrl, extKey });
  status('Salvo.', 'ok');
}

async function testar() {
  await salvar();
  status('Testando…', 'info');
  const resp = await chrome.runtime.sendMessage({ type: 'ping' });
  if (resp && resp.ok) {
    status('Conectado ao JOB ✓', 'ok');
  } else {
    status((resp && resp.erro) || 'Falha na conexão', 'err');
  }
}

$('salvar').addEventListener('click', salvar);
$('testar').addEventListener('click', testar);
carregar();
