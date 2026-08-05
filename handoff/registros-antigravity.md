# Registros de Alterações e Handoff Técnico — Antigravity (IA)

Este arquivo serve como registro de alterações, contexto de arquitetura e notas de handoff entre os agentes de IA (Antigravity e Claude Code).

---

## Sessão: 04/08/2026 – 05/08/2026

### 1. Ingestão Instantânea de Leads & Webhook
- **Commit:** `4b292ff` (`fix(ux): webhook de leads agora estende base.html do JOB com sidebar e topbar`)
- **Arquivos Alterados:**
  - `app.py`: Rota `/webhook/sheets` atualizada para aceitar `GET` e `POST`. Captura do campo `facebook_lead_id` (Meta Lead Ads) integrada aos `dados_extras` do lead e mapeamento em `_MIDIA_CAMINHOS`.
  - `templates/webhook_sheets_status.html`: Criado template visual integrado ao `base.html` do JOB, contendo status do webhook, botões de cópia de URL/Token e simulador interativo de teste POST ao vivo.

### 2. Estabilidade da Extensão do WhatsApp (`extensao-whatsapp`)
- **Commits:** `51052be` / `a58b8d2` / `4b292ff`
- **Arquivos Alterados:**
  - `extensao-whatsapp/content.js`:
    - Adicionado expurgo FIFO (`_capMap` e `_capSet`) com teto de 50 análises e 100 documentos/transcrições para prevenir vazamento de memória RAM.
    - Encapsulamento dos slots `.job-doc-slot` e `.job-tr-slot` em Shadow Root para isolar o `content.css` e impedir que mutações internas disparem o `MutationObserver`.
  - `extensao-whatsapp/wpp-bridge.js`:
    - Adicionada trava defensiva `_lendo` e `_TIPOS_LEITURA` para impedir que chamadas de leitura em lote invoquem métodos de navegação da `wa-js` por engano.
  - `extensao-whatsapp/manifest.json`:
    - `content.css` adicionado a `web_accessible_resources` para ser adotado nos Shadow Roots.

---

### 3. Melhorias na IA de Leitura e Score do Lead (`app.py`)
- **Commit:** `3b02325` (`feat(ia): amplia janela de contexto para 48k chars e melhora leitura de audios em app.py`)
- **Arquivos Alterados:**
  - `app.py`:
    - Ampliada a janela de contexto de texto de conversas longas enviadas para a Claude de **24.000 para 48.000 caracteres**, permitindo analisar históricos extensos de atendimento sem perda de mensagens.
    - Ampliado o teto de transcrição de áudio salvas em resumo de **600 para 1.500 caracteres**, garantindo que depoimentos e falas longas de voz do lead sejam consideras integralmente na análise de IA e no cálculo do Score.

### 4. Arquitetura do Motor Inteligente de Score Lead & Machine Learning
- **Documentação Mestra:** [`handoff/motor-score-lead-inteligente.md`](file:///Users/guilhermesantos/Desktop/job-serenus/handoff/motor-score-lead-inteligente.md)
- **Síntese Teórica de 6 Fontes:**
  1. *NPS Crítica (Enegep 2020)*: Modelo multidimensional em substituição a um indicador isolado.
  2. *Guia CRO (Alaska Digital)*: Equação de conversão MECLABS ($C = 4M + 3V + 2(I-F) - 2A$).
  3. *4DX & Kaizen (VendaMais)*: Foco em Medidas de Direção (*leading indicators*) em tempo real.
  4. *Análise de Sistemas (Atena 2024)*: SDLC, engenharia de requisitos e *feedback loops* de IA.
  5. *SPIN Selling (Neil Rackham)*: Mapeamento de Necessidades Implícitas vs Explícitas e classificação de resultados (Pedido, Avanço, Continuação, Recusa).
  6. *Score & LGPD (Elisa Pinho 2021)*: Mapeamento dos 5 C's do crédito (Caráter, Capacidade, Capital, Colateral, Condições) e Princípio da Parcimônia para evitar *overfitting* na IA.


