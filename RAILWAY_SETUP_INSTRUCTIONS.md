# 🚀 Instruções para Railway IA - Setup Automático JOB Serenus

## Status Atual
- ✅ `railway.json` commitado no GitHub
- ✅ Código pronto para usar Volume `/data`
- ✅ ASAAS_API_KEY já na config
- ⏳ **Aguarda Railway processar**

## O que a IA do Railway DEVE FAZER

### 1️⃣ APLICAR RAILWAY.JSON (CRÍTICO)
**Arquivo:** `/railway.json` (raiz do repositório)

**Ações:**
- Ler `railway.json` automaticamente (Railway carrega isso no deploy)
- Criar Volume `job-data` com mount path `/data`
- Anexar Volume ao serviço `job-serenus`
- Adicionar variáveis de ambiente:
  - `JOB_DATA_DIR=/data`
  - `ASAAS_API_KEY=$aact_prod_000MzkwODA2MWY2OGM3MWRlMDU2NWM3MzJlNzZmNGZhZGY6OjY5MGNjNzA4LTFjMzAtNDAzNi04NjQxLWViZWYzOGE0ODliNzo6JGFhY2hfZDk3Y2NhYmEtOTA0OC00YzVmLTgyNjMtNjc5ZjEyNDgxYjc0`

### 2️⃣ REDEPLOY AUTOMÁTICO
- Reconhecer mudança em `railway.json`
- Triggerar novo deployment
- Aguardar build completar (Python 3.13 + dependências)
- Iniciar com `python3 app.py`

### 3️⃣ VALIDAR SAÚDE
Healthcheck: `GET /` → status 200
Se falhar, rollback automático

### 4️⃣ RESULTADO ESPERADO
- Banco de dados persiste em `/data` (não mais em `~/JOB_Serenus_Dados`)
- App reconhece ASAAS_API_KEY automaticamente
- `/admin/asaas/teste` retorna `{"ok": true, "saldo": ...}`

---

## O que VOCÊ (usuário) AINDA PRECISA FAZER

### ⚠️ No painel do Asaas (5 min)
1. Vai em: **Integrações → Webhooks**
2. Clica: **+ Novo Webhook**
3. URL: `https://job-serenus-production.up.railway.app/webhook/asaas`
4. Eventos: Marca **Transferências** (todos)
5. Salva

### ✅ Teste final
Acessa: https://job-serenus-production.up.railway.app/admin/asaas/teste (logado como admin)

Resultado esperado: `{"ok": true, "saldo": 1234.56, "ambiente": "produção"}`

---

## Cronograma Esperado
- T+0min: Push do railway.json → Railway detecta
- T+2min: Build inicia
- T+5min: Deploy completa, app online com `/data`
- T+6min: Você configura webhook no Asaas
- T+7min: Tudo funcionando 🎉

---

## FAQ

**P: E se o volume não criar?**
R: Railway criará automaticamente no primeiro deploy que lê `railway.json`. Se não, volta para modo local `~/JOB_Serenus_Dados`.

**P: E se a chave Asaas for inválida?**
R: App inicia normal, mas `/admin/asaas/teste` retornará erro 400. Verifique a chave.

**P: Posso testar localmente antes?**
R: Sim! `export JOB_DATA_DIR=/tmp/data && python3 app.py` testa o Volume local.

---

*Instrução gerada para Railway IA em 2026-06-16*
