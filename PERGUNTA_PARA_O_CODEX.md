# Perguntas para o Codex — módulo financeiro do JOB

> Copie tudo abaixo da linha e mande para o Codex. Depois me traz a resposta inteira.

---

Você trabalhou no módulo financeiro do JOB Serenus (`app.py`, Flask + PostgreSQL) e escreveu o `COMISSOES_DOMINIO.md`, o `GUIA_OPERACIONAL.md` e a auditoria em `entregas/AUDITORIA_AFFINITY_FINANCEIRO_GESTORES_2026-08-12.md`. Criou, entre outras coisas: `fin_evento`, `affinity_conciliacao`, `comissao_extrato`, `gestor_regra`, `gestor_retencao`, `proposta_regra_snapshot`, `_fin_visao()` e a tela `/comissoes/central`.

Outro agente (Claude) trabalhou no mesmo arquivo depois de você e construiu coisas em paralelo que não conversaram com o seu desenho — telas que liam `parcelas` e `affinity_conciliacao` direto em vez do razão `fin_evento`. Isso foi desligado por uma chave (`FINANCEIRO_NOVO`) e documentado em `HANDOFF_FINANCEIRO_2026-08-14.md`.

Preciso que você **explique o seu desenho** para que os dois lados parem de brigar. Responda em português, de forma direta, sem reescrever código agora. Se não souber algo ou se tiver mudado de ideia depois, diga isso explicitamente em vez de racionalizar.

## 1. O razão (`fin_evento`)

1.1. Por que você criou um razão append-only em vez de somar as tabelas existentes? Qual problema concreto isso resolveu?

1.2. Quais são **todos** os valores possíveis de `fin_evento.estado`, e o que cada um significa em dinheiro real? Qual é a transição válida entre eles?

1.3. O que significam `papel`, `sinal` e `fracao`? Quando `sinal` é -1?

1.4. Como `chave_idem` é montada? O que garante que reimportar o mesmo extrato duas vezes não duplica?

1.5. **Quem escreve em `fin_evento` hoje?** Liste as funções/rotas. O evento nasce automaticamente em algum ponto, ou depende de ação humana?

1.6. Se eu quiser responder "quanto entrou na conta em agosto/2026", qual é a consulta exata e correta em cima de `fin_evento`?

## 2. A relação entre previsão, apuração e entrada

2.1. `parcelas` é previsão, `affinity_conciliacao` é apuração, `fin_evento` é fato. **Em que momento** uma parcela vira conciliação, e a conciliação vira evento? É automático ou manual?

2.2. Uma parcela pode existir sem nunca virar evento? O que acontece com ela no fechamento do mês?

2.3. `parcelas` tem `competencia` **e** `data_prevista`. Qual das duas manda para o Financeiro? Elas podem divergir?

2.4. Como o estorno deveria aparecer no razão? Um evento de sinal negativo? Qual `estado`?

## 3. A conta do gestor

3.1. Explique a diferença prática entre `fracoes_json`, `gestor_json` e `gestor_retencao`, com um exemplo numérico de uma venda de R$ 1.000.

3.2. Por que `gestor_retencao.percentual` é NULL-able? O que o sistema faz quando é NULL?

3.3. `_fin_visao()` soma o bruto do gestor a partir do snapshot congelado. **Como você pretendia escopar isso por competência?** A fração tem `mes` (índice 1,2,3…), não uma competência — qual era a ligação prevista entre a fração e o mês do calendário?

3.4. No painel, "Bruto do gestor" e "Líquido para PIX" aparecem com o **mesmo valor**, com uma "Retenção" entre eles (que é da Serenus, não do gestor). Isso é o comportamento esperado? Se sim, como o leitor deveria entender essa sequência?

## 4. A régua de recebimento

4.1. A régua de recebimento (quando a operadora paga, e quanto em cada mês) hoje só existe dentro de `gestor_regra.fracoes_json`. **Venda de consultor não tem régua nenhuma** — o recebível da corretora é fatiado proporcionalmente à régua do consultor, que é outra coisa. Você tinha percebido isso? Qual era o plano?

4.2. Sua auditoria lista "régua de recebimento da Affinity/operadora: fração, percentual e momento esperado" como **a implementar**. Onde ela deveria morar: em `recebimento`, numa tabela nova, ou dentro de `gestor_regra`? Por quê?

4.3. `recebimento.total` guarda o valor **negociado** (a Amil está com 2,8 = 280%), que é diferente da tabela publicada da Affinity (240%). Como você trataria essa diferença — campo de promoção, tabela de vigência, ou outra coisa?

## 5. A porta única

5.1. Qual era a intenção de `/comissoes/central`? O que deveria e o que **não** deveria morar lá?

5.2. Onde deveria ficar a conferência "esperado × recebido × repassado"? Dentro da central, no Financeiro, ou em tela própria?

5.3. Quantas telas o módulo financeiro deveria ter, no seu desenho? Liste-as e diga a pergunta que cada uma responde.

## 6. O que ficou pela metade

6.1. Sua auditoria de 12/08 lista vários itens como "não implementado" (retenção/imposto automático, saldo líquido Serenus, alerta de regra ausente bloqueante, ligação Fluxo de Caixa ↔ Financeiro pelo razão). **Quais desses você chegou a fazer depois?** Quais continuam abertos?

6.2. O defeito que você mesmo apontou — `lancamento_salvar()` repetindo `data_vencimento` em todas as parcelas de um custo parcelado — foi corrigido?

6.3. O parser do PDF `1374214` perdia uma linha (lia R$ 1.706,16 e perdia R$ 942,69). Foi corrigido?

6.4. Existe alguma parte do seu trabalho que está numa branch e **não** foi para `main`? Qual branch e o que tem lá?

## 7. Riscos e armadilhas

7.1. Qual é a coisa mais fácil de quebrar nesse módulo sem perceber?

7.2. Que suposição sua alguém de fora provavelmente violaria por não conhecer?

7.3. Se você tivesse que refazer, o que faria diferente?

---

**Formato da resposta:** responda item por item, numerado. Onde a resposta for "não sei" ou "não fiz", diga isso — é mais útil do que uma justificativa construída depois. Onde houver decisão de negócio pendente que só o Guilherme pode responder, aponte a pergunta.
