# MAPA DE MÓDULOS E MATRIZ DE IMPACTO — JOB SERENUS

Este documento serve como mapa de referência rápida para navegação, localização cirúrgica de código e análise de efeito dominó (impacto cruzado) antes de qualquer alteração no `app.py` ou templates.

---

## 1. Módulos do Sistema e Detalhamento

### 1. Auth / Usuários
- **Rotas:** `/login`, `/logout`, `/esqueci-senha`, `/setup/<token>`, `/usuarios`, `/minha-foto`
- **Templates:** `login.html`, `usuarios.html`, `setup_senha.html`
- **Tabelas afetadas:** `usuarios`, `tokens_senha`
- **Helpers:** `_verificar_senha()`, `_hash_senha()`, `login_required`, `admin_required`
- **Impacto Cruzado (Efeito Dominó):**
  - **Afeta:** Todos os módulos (controle de sessão, permissão por perfil e autoria de registros).
  - **É afetado por:** Alterações em perfis de acesso, permissões ou colunas da tabela `usuarios`.

---

### 2. Propostas e Anexos
- **Rotas:** `/nova-proposta`, `/salvar-proposta`, `/propostas`, `/proposta/<id>`, `/proposta/<id>/editar`, `/proposta/<id>/fase`, `/proposta/<id>/historico`
- **Templates:** `form.html`, `propostas.html`, `detalhe.html`
- **Tabelas afetadas:** `propostas`, `historico_propostas`, `anexos_proposta`
- **Helpers:** `_notificar()`, `_salvar_anexo_r2()`, `_parse_dt_seguro()`
- **Impacto Cruzado (Efeito Dominó):**
  - **Afeta:** 
    - **Financeiro propostas:** Mudança de fase para 'Implantada' ou 'Aprovada' gera/atualiza parcelas automaticamente.
    - **CRM:** Alteração de status da proposta reflete no lead associado.
    - **BI / Relatórios:** Mudança em valores, datas ou fases altera métricas consolidadas de produção e BI.
    - **Notificações:** Troca de fase dispara avisos para o corretor responsável e gestores.
  - **É afetado por:** Mudança no cadastro de Operadoras, Produtos ou Regimes de contratação.

---

### 3. Financeiro de Propostas (Parcelas, Boletos e Estornos)
- **Rotas:** `/parcela/<id>/*`, `/proposta/<id>/antecipacao`, `/proposta/<id>/boleto-adesao`, `/proposta/<id>/estornar`
- **Templates:** `detalhe.html` (aba financeira)
- **Tabelas afetadas:** `parcelas`, `estornos`, `boletos_adesao`
- **Helpers:** `_calcular_repasses()`, `_parse_dt_seguro()`
- **Impacto Cruzado (Efeito Dominó):**
  - **Afeta:**
    - **Fluxo de Caixa / Repasses:** Status de pagamento de parcelas determina saldo a repassar para corretores e receita líquida.
    - **BI:** Métricas de inadimplência, faturamento e estornos.
  - **É afetado por:** Alterações nas fases das propostas e regras de comissionamento/regimes.

---

### 4. Fluxo de Caixa, Regras e Configurações
- **Rotas:** `/fluxo-caixa`, `/financeiro`, `/repasses`, `/producao`, `/niveis`, `/comissoes`, `/regimes`, `/operadoras`, `/produtos`, `/campos`
- **Templates:** `fluxo_caixa.html`, `financeiro.html`
- **Tabelas afetadas:** `lancamentos_caixa`, `repasses`, `niveis_comissao`, `regras_comissao`, `regimes`, `operadoras`, `produtos`
- **Impacto Cruzado (Efeito Dominó):**
  - **Afeta:** Cálculo de comissão de todas as novas propostas e recálculo de repasses futuros.
  - **É afetado por:** Baixas e liquidações de parcelas de propostas.

---

### 5. CRM e Funil de Leads
- **Rotas:** `/crm`, `/crm/lead/<id>/*`, `/crm/etapas`, `/crm/painel`, `/crm/importar`, `/crm/importar-agora`
- **Templates:** `crm.html`, `crm_painel.html`
- **Tabelas afetadas:** `leads`, `etapas_crm`, `historico_leads`
- **Helpers:** `_col()`, `_limpar_telefone()`, `_notificar()`
- **Impacto Cruzado (Efeito Dominó):**
  - **Afeta:** Propostas (quando um lead vira proposta).
  - **É afetado por:** Ingestão de leads via Google Sheets (`/webhook/sheets`) ou importação manual.

---

### 6. Ingestão de Leads (Webhooks & Background Jobs)
- **Rotas / Background:** `/webhook/sheets`, função `_importar_leads_automatico()`
- **Tabelas afetadas:** `leads`, `historico_leads`
- **Helpers:** Dedup por `telefone_norm`, throttle de 10 min, cap de 50 leads/rodada.
- **Impacto Cruzado (Efeito Dominó):**
  - **Afeta:** Painel CRM, distribuição automática de leads para corretores e notificações.
  - **É afetado por:** Formato e nomes de abas das planilhas externas do Google Sheets.

---

### 7. Cotação de Planos
- **Rotas:** `/cotacao`, `/cotacao/tabelas/*`, `/cotacao/salvar`, `/cotacao/documento/<id>`, `/c/<token>` (pública imutável)
- **Templates:** `cotacao.html`, `cotacao_documento.html`, `cotacao_publica.html`
- **Tabelas afetadas:** `cotacoes`, `tabelas_preco`
- **Impacto Cruzado (Efeito Dominó):**
  - **Afeta:** Links públicos enviados aos clientes via `/c/<token>`.
  - **Isolamento:** Token `/c/<token>` é imutável. Novas versões geram novos registros. O agravo (`/ajustar`) altera somente `planos_json` da cotação.

---

### 8. Material de Apoio
- **Rotas:** `/material-apoio`, `/material-apoio/novo`
- **Templates:** `material_apoio.html`
- **Tabelas afetadas:** `materiais_apoio`
- **Impacto Cruzado (Efeito Dominó):** Módulo independente. Baixo impacto cruzado com o restante do sistema.

---

### 9. Notificações
- **Rotas:** `/api/notificacoes`, `/api/notificacoes/marcar-lidas`
- **Helper principal:** `_notificar(user_id, titulo, mensagem, link)`
- **Templates:** `base.html` (sino de notificações no header)
- **Tabelas afetadas:** `notificacoes`
- **Impacto Cruzado (Efeito Dominó):** Consumido por Propostas, CRM, Financeiro e Admin para alertar usuários.

---

### 10. BI e APIs de Integração
- **Rotas:** `/bi`, `/api/bi/*`, `/api/propostas`
- **Templates:** `bi.html`
- **Impacto Cruzado (Efeito Dominó):** Consome dados de Propostas, Parcelas, Produção e CRM. Alterações na estrutura do banco exigem atualização das queries de BI.

---

### 11. Webhook Asaas e Cobrança
- **Rotas:** `/webhook/asaas`
- **Tabelas afetadas:** `parcelas`, `boletos_adesao`, `log_webhooks`
- **Impacto Cruzado (Efeito Dominó):** Baixa automática de parcelas e boletos de adesão ao receber liquidação via PIX/Boleto.

---

## 2. Matriz Sintética de Impacto Cruzado

| Módulo Alterado | Módulos com Risco de Efeito Dominó | O que validar após alteração |
|---|---|---|
| **Auth / Usuários** | Todo o sistema | Login, permissões por perfil, autorias registradas |
| **Propostas** | Financeiro, CRM, BI, Notificações | Geração de parcelas, troca de fase, histórico, anexos |
| **Financeiro** | Fluxo de caixa, BI, Repasses | Saldo do corretor, estornos, relatórios de faturamento |
| **CRM / Ingestão** | Propostas, Notificações | Duplicidade de telefone, troca de etapa, atribuição de corretor |
| **Cotação** | Links públicos `/c/<token>` | Visualização do cliente, gravação de versão nova (sem UPDATE) |
| **BI / APIs** | Integradores externos e painéis | Headers `X-API-Key`, retorno JSON das APIs |

---

## 3. Checklist de Anti-Regressão (Obrigatório após qualquer deploy)

1. **Feature Nova:** Validar a alteração específica solicitada.
2. **Feature Antiga (Anti-regressão):** Testar uma rota correlata do mesmo domínio.
3. **Anexos:** Abrir e visualizar ao menos 1 anexo existente em `/proposta/<id>`.
