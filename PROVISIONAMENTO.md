# Provisionar uma instância de cliente (JOB white-label)

O JOB é vendido como **instância separada por corretora**: mesmo código do
Serenus, deploy próprio + banco vazio próprio → o cliente **nunca** vê dado do
Serenus (isolamento físico). Este é o passo a passo pra subir uma nova.

## Visão geral
- **Código:** o mesmo repositório (`main`). Nada de fork — toda melhoria vale
  pra todos. O comportamento muda por variável de ambiente.
- **Banco:** um Postgres novo e vazio, só do cliente.
- **Isolamento garantido por:** `MODO_OPERADOR=0`, `SEED_DADOS_SERENUS=0`,
  `SEED_ADMIN_*` (admin do cliente), `BRAND_*` (marca do cliente). Ver
  `.env.cliente.example`.

## Passo a passo (Railway)
1. **Novo projeto no Railway** (separado do Serenus) → **+ Postgres**.
2. **Deploy do serviço web** a partir deste repositório (`main`), start command
   como o do Serenus (`python3 -u app.py`).
3. **Variáveis** (aba Variables): copie de `.env.cliente.example` e preencha.
   Mínimo pra isolar e marcar:
   - `DATABASE_URL` (do Postgres novo), `SECRET_KEY` (aleatória), `WHATSAPP_EXT_KEY`.
   - `MODO_OPERADOR=0`, `SEED_DADOS_SERENUS=0`.
   - `SEED_ADMIN_NOME/EMAIL/SENHA` = o dono da corretora cliente.
   - `BRAND_NOME/NOME_CURTO/CORRETORA/SUPORTE_EMAIL` (+ `BRAND_LOGO_URL` se tiver).
   - Chaves de integração que o cliente vai usar (`ANTHROPIC_API_KEY`,
     `GROQ_API_KEY`, etc.) — **cada cliente com as SUAS**, nunca as do Serenus.
4. **Subir.** No 1o boot o `init_db` cria o schema e semeia SÓ o admin do
   cliente + scaffold genérico (níveis, etapas do CRM). Sem comissões/Affinity
   do Serenus.
5. **Login** com o `SEED_ADMIN_EMAIL/SENHA` → trocar a senha → cadastrar
   operadoras, comissões, usuários e etapas do CRM do cliente.

## Extensão do WhatsApp (por consultor do cliente)
- A extensão é um artefato único (Chrome Web Store). O `host_permissions` já
  cobre qualquer instância `*.up.railway.app`.
- No **popup da extensão**, o consultor aponta o **URL do JOB do cliente** e cola
  a `WHATSAPP_EXT_KEY` da instância dele. A extensão puxa a marca da instância e
  mostra "JOB <marca do cliente>".

## Suporte (quando PRECISAR mexer na instância do cliente)
- Setar temporariamente `MODO_OPERADOR=1` nas variáveis da instância do cliente
  libera as ferramentas de infra/diagnóstico (emergency, backup, db, testar-*,
  observabilidade, erros da extensão) pra você. **Voltar pra 0** depois.

## O que NUNCA vai pra instância de cliente (checado em código)
- Login/admin do Serenus, comissões negociadas, recebimento, config Affinity
  (`SEED_DADOS_SERENUS=0`).
- Importação de leads das planilhas do Serenus (gateado por marca — não roda).
- BotConversa / meninas / ZapVoice / manual do Serenus (somem por marca).
- Ferramentas de operador (somem com `MODO_OPERADOR=0`).

## Rotação de chaves (pendência do Serenus, não do produto)
As chaves de produção do Serenus (Postgres, ASAAS, BREVO) foram expostas em
chat e devem ser rotacionadas no Railway do Serenus. Não afeta instâncias de
cliente (cada uma tem as suas).
