# Arquitetura do Motor Inteligente de Score Lead e Aprendizado de Vendas

Este documento estabelece o projeto arquitetural e conceitual do **Motor de Score Lead Evolutivo e Aprendizado de Conversão (Machine Learning & LLM Feedback Loop)** do **JOB Serenus**. 

O objetivo é transformar o cálculo estático de score em um **sistema preditivo e auto-ajustável**, que aprende continuamente com o histórico de leads ganhos (vendas fechadas) e leads perdidos (motivos de perda), identificando padrões recorrentes de objeções, tempo de resposta, perfil e gatilhos de conversão.

---

## 1. Síntese Teórica Integrada da Literatura (6 Obras de Referência)

A arquitetura do motor foi desenvolvida a partir da convergência de 6 obras fundamentais:

```
┌───────────────────────────────────────────────────────────────────────────┐
│                     MATRIZ TEÓRICA DO SCORE LEAD                          │
├──────────────────────┬────────────────────────────────────────────────────┤
│ Referência           │ Contribuição Arquitetural no JOB Serenus          │
├──────────────────────┼────────────────────────────────────────────────────┤
│ 1. Critical NPS      │ Abandono da métrica única; adoção de scoring       │
│    (Enegep 2020)     │ multidimensional (Perfil + Comportamento + Contexto)│
├──────────────────────┼────────────────────────────────────────────────────┤
│ 2. CRO & MECLABS     │ Aplicação da fórmula de conversão:                 │
│    (Alaska Digital)  │ C = 4M + 3V + 2(I - F) - 2A                        │
├──────────────────────┼────────────────────────────────────────────────────┤
│ 3. 4DX & Kaizen      │ Foco em Medidas de Direção (leading indicators)    │
│    (VendaMais)       │ em tempo real durante o atendimento no WhatsApp     │
├──────────────────────┼────────────────────────────────────────────────────┤
│ 4. Análise Sistemas  │ Engenharia de requisitos, modularidade e loop      │
│    (Atena 2024)      │ de realimentação (feedback loop) contínuo          │
├──────────────────────┼────────────────────────────────────────────────────┤
│ 5. SPIN Selling      │ Mapeamento de Necessidades Implícitas vs Explícitas│
│    (Neil Rackham)    │ e estágios da negociação (Avanço vs Continuação)   │
├──────────────────────┼────────────────────────────────────────────────────┤
│ 6. Score & LGPD      │ Aplicação dos 5 C's do crédito ao lead scoring e   │
│    (Elisa Pinho 2021)│ Princípio da Parcimônia (modelos preditivos enxutos)│
└──────────────────────┴────────────────────────────────────────────────────┘
```

---

## 2. Incorporação do Framework SPIN Selling no Motor de IA

Segundo Neil Rackham em *SPIN Selling*, em vendas complexas e de alto valor (como planos de saúde familiares e PME):
- Apresentar soluções ou características cedo demais cria **objeções de preço e atrito**.
- Vendedores de alta performance focam em transformar **Necessidades Implícitas** (queixas simples) em **Necessidades Explícitas** (desejos claros e intenção firme de compra).

### A. Mapeamento de Perguntas e Respostas SPIN na Conversa
A camada de IA (Claude) passará a classificar o diálogo no WhatsApp nos 4 vetores SPIN:

1. **S - Situação (Contexto):** Idades, operadora atual, valor pago hoje, município, tipo de contratação (PF/PJ).
2. **P - Problema (Dores Implícitas):** Queixas sobre carência, reajuste alto, falta de cobertura hospitalar ou atendimento ruim da operadora atual.
3. **I - Implicação (Urgência & Gravidade):** Consequências do problema exploradas na conversa (ex: risco de ficar sem cobertura durante tratamento, gasto excessivo de reembolso, insatisfação dos funcionários da empresa).
4. **N - Necessidade de Solução (Declarações Explícitas de Valor):** Declarações em que o lead expressa o que precisa (*"Preciso fechar um plano com o Hospital Vera Cruz até a semana que vem"*).

### B. Classificação dos Estágios da Visita no CRM
O motor deixa de classificar a interação de forma binária e passa a identificar 4 estados de progresso:
- **Pedido (Win):** Proposta emitida, contrato assinado ou documentos enviados.
- **Avanço (Progress):** Ação concreta que aproxima a venda (ex: lead enviou cotação anterior, aprovou o valor, agendou reunião).
- **Continuação (Stall):** Conversa amigável mas sem compromisso de ação (*"Gostei, depois conversamos"*).
- **Recusa (Loss):** Recusa explícita ou fechamento com concorrente.

---

## 3. Integração dos 5 C's do Crédito e Princípio da Parcimônia

Da dissertação de *Score de Crédito, Big Data e LGPD* (Elisa Pinho, 2021), adaptamos os **5 C's do Crédito** para o **Score de Adimplência e Qualificação Comercial**:

1. **Caráter (Confiabilidade):** Histórico de pontualidade na troca de mensagens, idoneidade das informações fornecidas e confirmação documental.
2. **Capacidade (Fit Financeiro):** Compatibilidade entre o valor do plano cotado e a faixa salarial/porte do CNPJ.
3. **Capital (Estrutura Comercial/PME):** Tempo de fundação do CNPJ/MEI e número de vidas a integrar.
4. **Colateral (Garantias de Aceitação):** Prontidão de documentos pessoais (RG, CPF, comprovante de residência, CNS) que garantem entrada rápida na operadora.
5. **Condições (Momento do Lead):** Proximidade da data de reajuste anual da operadora atual ou urgência de migração sem carência.

### Princípio da Parcimônia (Occam's Razor em ML)
Conforme demonstrado nos testes econométricos de regressão logística, **modelos simplificados e enxutos com covariáveis de forte significância estatística superam modelos hiper-parametrizados**, pois evitam *overfitting* (sobreajuste). O Motor de Score Lead do JOB manterá um **número enxuto de parâmetros ponderados de alto impacto**.

---

## 4. Costura do Sistema Atual de Pesos com o Sistema Novo

O novo sistema **não descarta as 16 categorias legadas do `app.py`**, mas as organiza e repondera em **3 Blocos Principais de Pontuação**, enriquecidos pelas métricas de CRO, SPIN e 5 C's:

$$\text{Score Final} = \text{Bloco 1 (Perfil e 5 Cs)} + \text{Bloco 2 (Vetor CRO MECLABS)} + \text{Bloco 3 (Dinamismo SPIN)}$$

---

### Tabela Comparativa de Pesos: Sistema Atual vs. Sistema Novo Costurado

| Categoria / Vetor | Sistema Atual (Teto 1000) | Sistema Novo Costurado (Teto 1000) | Justificativa Teórica & Regra de Negócio |
|---|---|---|---|
| **[Bloco 1] Vidas & Porte** | 10 a 50 pts | **20 a 100 pts** | *Capital/Capacidade*: PMEs (5+ vidas) geram maior ticket e comissão no JOB. |
| **[Bloco 1] PJ, CNPJ & MEI** | 30 a 50 pts | **40 a 100 pts** | *Caráter/Capital*: Distingue CNPJ consolidado (>6 meses, +100pts) de MEI recente (+50pts) ou PF (+40pts). |
| **[Bloco 1] Fit Geográfico & Rede** | 25 a 50 pts | **35 a 100 pts** | *Condições*: Alinhamento da operadora (ex: Vera Cruz em Campinas) + hospital preferido. |
| **[Bloco 1] Plano Atual & Upgrade** | 25 a 50 pts | **30 a 100 pts** | *Capacidade*: Troca de operadora T1/T2 ou migração de plano ativo com histórico de pagamento. |
| **[Bloco 2] Motivação ($4M$)** | 15 a 40 pts (Budget) | **até 120 pts** | *MECLABS (Peso 4)*: Dor aguda (reajuste alto no plano atual, gestação, urgência médica). |
| **[Bloco 2] Proposta de Valor ($3V$)** | 10 a 50 pts (Cobertura) | **até 90 pts** | *MECLABS (Peso 3)*: Alinhamento entre a necessidade do cliente e o preço/cobertura ofertado. |
| **[Bloco 2] Incentivo à Ação ($2I$)** | 0 a 30 pts (Prontidão) | **até 60 pts** | *MECLABS (Peso 2)*: Janela de carência, promoção de adesão ou desconto de tabela. |
| **[Bloco 2] Fricções ($2F$)** | 0 a 40 pts (Forma Pag.) | **até -40 pts (Penalidade)** | *MECLABS (Peso -2)*: Falta de documentação, burocracia de carência ou CPT exigida. |
| **[Bloco 2] Ansiedades ($2A$)** | 10 a 40 pts (Inadimpl.) | **até -40 pts (Penalidade)** | *MECLABS (Peso -2)*: Insegurança do cliente quanto a preço, medo de carência ou trocas. |
| **[Bloco 3] Necessidades Explícitas** | 0 a 35 pts (Regras) | **até 100 pts** | *SPIN Selling*: Lead verbalizou intenção firme de compra (*"Quero contratar a Unimed por R$ 600"*). |
| **[Bloco 3] Perguntas de Implicação** | N/A (não existia) | **até 75 pts** | *SPIN Selling*: Lead reconheceu a gravidade e o custo financeiro/social do problema atual. |
| **[Bloco 3] Estágio de Avanço** | N/A (não existia) | **até 75 pts** | *SPIN Selling*: Ação concreta (envio de cotação anterior, agendamento, envio de documentos). |

---

### Faixas de Classificação do Lead (Notas de Corte)

- **900 a 1000 pts — QUENTE (Fechamento Imediato):** Documentos pessoais/CNPJ enviados + Necessidade Explícita confirmada.
- **750 a 899 pts — QUENTE (Alta Propensão):** Contratação PME ou urgência declarada + alinhamento de preço.
- **550 a 749 pts — MÉDIO (Em Maturação):** Negociação real que exige envio/ajuste de proposta ou esclarecimento de ansiedades.
- **350 a 549 pts — BAIXO (Baixo Engajamento):** Fricção alta, falta de documentação ou dúvida de orçamento.
- **Abaixo de 350 pts — IMPROVÁVEL (Sem Relevância Comercial):** Conversa pessoal ou lead sem perfil para plano de saúde.


---

## 5. Modelo de Dados e Pipeline no `app.py`

### Novas Tabelas SQL

#### Tabela: `wa_aprendizado_leads`
```sql
CREATE TABLE IF NOT EXISTS wa_aprendizado_leads (
    id SERIAL PRIMARY KEY,
    lead_id INTEGER REFERENCES crm_leads(id),
    desfecho VARCHAR(20) NOT NULL, -- 'GANHO', 'PERDIDO', 'AVANCO', 'CONTINUACAO'
    motivo_perda TEXT,
    score_no_momento INTEGER,
    vetores_cro JSONB,
    indicadores_spin JSONB,
    fator_chave_vitoria_derrota TEXT,
    objecoes_superadas TEXT[],
    duracao_dias NUMERIC(10,2),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

#### Tabela: `wa_padroes_recorrentes`
```sql
CREATE TABLE IF NOT EXISTS wa_padroes_recorrentes (
    id SERIAL PRIMARY KEY,
    tipo VARCHAR(20) NOT NULL, -- 'OPORTUNIDADE', 'RISCO'
    categoria VARCHAR(50) NOT NULL, -- 'OPERADORA', 'PERFIL', 'OBJICAO', 'TIMING'
    titulo TEXT NOT NULL,
    descricao TEXT NOT NULL,
    frequencia INTEGER DEFAULT 1,
    impacto_conversao_pct NUMERIC(5,2),
    atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 6. Próximos Passos de Execução no Backend

1. **Atualização da função `_wa_score_lead` em `app.py`:** Incorporar os vetores de CRO e SPIN na atribuição de pontos por categoria.
2. **Criação do módulo de pós-mortem de lead:** Gatilho automático ao alterar a etapa do lead para Ganhou/Perdeu no CRM.
3. **Criação das tabelas no banco de dados.**
4. **Handoff:** Manter o registro atualizado em `handoff/registros-antigravity.md` para integração fluida com o Claude Code.
