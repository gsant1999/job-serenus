# Arquitetura do Motor Inteligente de Score Lead e Aprendizado de Vendas

Este documento estabelece o projeto arquitetural e conceitual do **Motor de Score Lead Evolutivo e Aprendizado de Conversão (Machine Learning & LLM Feedback Loop)** do **JOB Serenus**. 

O objetivo é transformar o cálculo estático de score em um **sistema preditivo e auto-ajustável**, que aprende continuamente com o histórico de leads ganhos (vendas fechadas) e leads perdidos (motivos de perda), identificando padrões recorrentes de objeções, tempo de resposta, perfil e gatilhos de conversão.

---

## 1. Síntese Teórica Integrada da Literatura (7 Obras de Referência)

A arquitetura do motor foi desenvolvida a partir da convergência de 7 obras fundamentais:

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
├──────────────────────┼────────────────────────────────────────────────────┤
│ 7. Adm. de Marketing │ Customer Lifetime Value (LTV), Funil de Retenção   │
│    (Kotler & Keller) │ e potencial de comissão recorrente (Up/Cross-sell) │
└──────────────────────┴────────────────────────────────────────────────────┘
```

### A. Valor Vitalício do Cliente & Funil de Retenção (Kotler & Keller, 14ª Ed.)
- **Achado Principal:** O valor de um cliente não se encerra na primeira transação, mas no **Customer Lifetime Value (LTV)** — que inclui o tempo de permanência no plano de saúde (baixo churn), o valor recorrente das comissões da corretora, o potencial de cross-selling (plano odonto/seguro) e up-selling (migração PF $\rightarrow$ PME).
- **Aplicação no JOB:** Leads com maior probabilidade de permanência longa (famílias com dependentes jovens, empresas estabelecidas) recebem **bonificação de LTV** no Score Lead.

### B. Práticas Globais de IA & Machine Learning para Vendas (GitHub Benchmarks)
- **Modelo Híbrido (Regras Determinísticas + LLM Semântica):** Evita alucinações de IA isoladas. As regras duras filtram dados concretos e a LLM extrai nuanças comportamentais.
- **Human-in-the-Loop:** O consultor valida os motivos de perda no CRM, realimentando o aprendizado da máquina.
- **Prevenção de Model Drift:** Re-calibração periódica dos pesos com base nos dados de vendas do último trimestre.

---

## 2. Incorporação do Framework SPIN Selling no Motor de IA

Segundo Neil Rackham em *SPIN Selling*, em vendas complexas e de alto valor (como planos de saúde familiares e PME):
- Apresentar soluções ou características cedo demais cria **objeções de preço e atrito**.
- Vendedores de alta performance focam em transformar **Necessidades Implícitas** (queixas simples) em **Necessidades Explícitas** (desejos claros e intenção firme de compra).

### Mapeamento SPIN:
1. **S - Situação:** Idades, operadora atual, valor pago hoje, município, tipo de contratação (PF/PJ).
2. **P - Problema:** Queixas sobre carência, reajuste alto, falta de cobertura hospitalar ou atendimento ruim.
3. **I - Implicação:** Consequências do problema (risco de ficar sem cobertura durante tratamento, gasto excessivo de reembolso, insatisfação de colaboradores).
4. **N - Necessidade de Solução:** Declarações em que o lead expressa o que precisa (*"Preciso fechar um plano com o Hospital Vera Cruz até a semana que vem"*).

---

## 3. Costura do Sistema Legado de Pesos com o Sistema Novo

O novo sistema **organiza as 16 categorias legadas do `app.py` em 4 Blocos Principais de Pontuação**:

$$\text{Score Final} = \text{Bloco 1 (Perfil e 5 Cs)} + \text{Bloco 2 (Vetor CRO MECLABS)} + \text{Bloco 3 (Dinamismo SPIN)} + \text{Bloco 4 (Potencial LTV Kotler)}$$

---

### Tabela Comparativa de Pesos: Legado vs. Novo Costurado

| Categoria / Vetor | Sistema Legado (Teto 1000) | Sistema Novo Costurado (Teto 1000) | Justificativa Teórica & Regra de Negócio |
|---|---|---|---|
| **[Bloco 1] Vidas & Porte** | 10 a 50 pts | **20 a 90 pts** | *Capital/Capacidade*: PMEs (5+ vidas) geram maior ticket e comissão. |
| **[Bloco 1] PJ, CNPJ & MEI** | 30 a 50 pts | **40 a 90 pts** | *Caráter/Capital*: CNPJ consolidado (>6 meses, +90pts) vs MEI recente (+45pts) vs PF (+35pts). |
| **[Bloco 1] Fit Geográfico & Rede** | 25 a 50 pts | **35 a 80 pts** | *Condições*: Alinhamento da operadora (ex: Vera Cruz em Campinas) + hospital preferido. |
| **[Bloco 1] Plano Atual & Upgrade** | 25 a 50 pts | **30 a 80 pts** | *Capacidade*: Troca de operadora T1/T2 ou migração de plano ativo com histórico positivo. |
| **[Bloco 2] Motivação ($4M$)** | 15 a 40 pts (Budget) | **até 110 pts** | *MECLABS (Peso 4)*: Dor aguda (reajuste alto no plano atual, gestação, urgência médica). |
| **[Bloco 2] Proposta de Valor ($3V$)** | 10 a 50 pts (Cobertura) | **até 80 pts** | *MECLABS (Peso 3)*: Alinhamento entre a necessidade do cliente e a cobertura ofertada. |
| **[Bloco 2] Incentivo à Ação ($2I$)** | 0 a 30 pts (Prontidão) | **até 50 pts** | *MECLABS (Peso 2)*: Janela de carência, promoção de adesão ou desconto de tabela. |
| **[Bloco 2] Fricções ($2F$)** | 0 a 40 pts (Forma Pag.) | **até -40 pts (Penalidade)** | *MECLABS (Peso -2)*: Falta de documentação, burocracia de carência ou CPT exigida. |
| **[Bloco 2] Ansiedades ($2A$)** | 10 a 40 pts (Inadimpl.) | **até -40 pts (Penalidade)** | *MECLABS (Peso -2)*: Insegurança do cliente quanto a preço, medo de carência ou trocas. |
| **[Bloco 3] Necessidades Explícitas** | 0 a 35 pts (Regras) | **até 90 pts** | *SPIN Selling*: Lead verbalizou intenção firme de compra (*"Quero contratar Unimed por R$ 600"*). |
| **[Bloco 3] Perguntas de Implicação** | N/A (não existia) | **até 70 pts** | *SPIN Selling*: Lead reconheceu a gravidade e o custo financeiro do problema atual. |
| **[Bloco 3] Estágio de Avanço** | N/A (não existia) | **até 70 pts** | *SPIN Selling*: Ação concreta (envio de cotação anterior, agendamento, envio de documentos). |
| **[Bloco 4] Potencial LTV & Retenção** | N/A (não existia) | **até 130 pts** | *Kotler & Keller*: Famílias jovens, baixo risco de churn e potencial de venda de produtos adicionais. |

---

### Faixas de Classificação do Lead (Notas de Corte)

- **900 a 1000 pts — QUENTE (Fechamento Imediato):** Documentos pessoais/CNPJ já enviados + Necessidade Explícita confirmada na conversa.
- **750 a 899 pts — QUENTE (Alta Propensão):** Contratação PME ou urgência declarada + alinhamento de preço.
- **550 a 749 pts — MÉDIO (Em Maturação):** Negociação real que exige apresentação de proposta ou superação de ansiedades.
- **350 a 549 pts — BAIXO (Baixo Engajamento):** Fricção alta, falta de documentação ou dúvida de orçamento.
- **Abaixo de 350 pts — IMPROVÁVEL (Sem Relevância Comercial):** Conversa informal/pessoal ou lead sem perfil comercial para plano de saúde.

---

## 4. Arquitetura do Loop de Aprendizado (LLM Feedback Loop)

```
[ Conversa WhatsApp + Anexos ]
             │
             ▼
[ Extração Multidimensional (Claude 3.5) ]
 (Motivação, Valor, Fricção, Ansiedade, Perfil, LTV)
             │
             ▼
[ Cálculo do Score Lead Multidimensional (0 - 1000) ]
             │
             ▼
[ Desfecho do Lead no CRM ] ───► ( Lead GANHO  ou  Lead PERDIDO )
                                          │
                                          ▼
                         [ Síntese de Aprendizado via LLM ]
                                          │
                                          ▼
                         [ Tabela: wa_aprendizado_leads ]
                                (Padrões & Gatilhos)
                                          │
                                          ▼
                         [ Ajuste Dinâmico de Pesos & Relatórios ]
```

---

## 5. Modelo de Dados (Tabelas PostgreSQL/SQLite)

### Tabela: `wa_aprendizado_leads`
```sql
CREATE TABLE IF NOT EXISTS wa_aprendizado_leads (
    id SERIAL PRIMARY KEY,
    lead_id INTEGER REFERENCES crm_leads(id),
    desfecho VARCHAR(20) NOT NULL, -- 'GANHO', 'PERDIDO'
    motivo_perda TEXT,
    score_no_momento INTEGER,
    vetores_cro JSONB,
    indicadores_spin JSONB,
    potencial_ltv JSONB,
    fator_chave_vitoria_derrota TEXT,
    objecoes_superadas TEXT[],
    duracao_dias NUMERIC(10,2),
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Tabela: `wa_padroes_recorrentes`
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
