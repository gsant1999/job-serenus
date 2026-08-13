# Domínio de Comissões e Recebimentos

Este documento é a referência curta do domínio financeiro-comercial do JOB.
Antes de mudar uma tela ou cálculo, comece por aqui. Ele evita que uma regra de
consultor seja usada em uma venda de gestor, ou que uma tabela histórica seja
alterada acreditando que ela alimenta o Financeiro.

## Árvore oficial

```text
Operadora + variação + plano
  └── recebimento
        └── quanto a Serenus recebe no total (número de mensalidades)
              ├── venda de consultor
              │     └── repasse_corretor + regime/nivel do consultor
              └── venda de gestor/admin
                    └── gestor_regra + gestor_retencao
                          └── proposta_regra_snapshot (acordo congelado)

Proposta congelada
  └── parcelas (previsão e valor líquido a pagar ao vendedor)
        └── affinity_conciliacao (apurado no extrato)
              └── fin_evento (razão: fato financeiro imutável)
```

## Fonte de verdade por pergunta

| Pergunta | Fonte | Não usar |
|---|---|---|
| Quanto a operadora paga à corretora? | `recebimento` | `comissoes` legado |
| Quanto recebe um consultor? | `repasse_corretor` + `usuarios.regime_base` + nível | `gestor_regra` |
| Quanto recebe gestor/admin que vende? | `proposta_regra_snapshot`, criado a partir de `gestor_regra` e `gestor_retencao` | `repasse_corretor` |
| O que está previsto para pagar? | `parcelas` | a regra atual, que pode ter mudado depois |
| O que a Affinity apurou? | `affinity_conciliacao` | previsão de parcela |
| O que realmente entrou? | `fin_evento` com estado `entrada_confirmada` | status visual de proposta |

## Regimes de consultor

Os únicos regimes de consultor são: `sem_lead_sem_fixo`, `com_lead` (N1, N2,
N3) e `com_fixo_lead`. Eles só servem a usuários de perfil consultor e usam
`repasse_corretor`.

`gestor_vendedor` é legado: pode permanecer em venda histórica, mas nenhuma venda
nova deve nascer nesse código. Vendas novas de admin, supervisor ou gestor usam
`socio_gestor_regra` ou, se faltar cadastro, `socio_gestor_pendente`.

## Regra de gestor/admin vendedor

Uma regra é comercial, não pessoal: chave `operadora + obs + plano`.

1. `fracoes_json`: quando a operadora paga e qual o peso de cada fração.
2. `gestor_json`: qual parte de cada fração é do gestor.
3. `gestor_retencao`: imposto/taxa, alíquota, base e responsável.

O snapshot da proposta é imutável. Uma regra alterada hoje só vale para as
vendas futuras; não altera uma venda passada silenciosamente.

## Migração de vendas antigas

Venda antiga de gestor que estiver em regime de consultor pode ser migrada apenas
na própria proposta. A migração é bloqueada se houver parcela liberada ou paga,
PIX iniciado ou entrada conciliada. Antes de recriar as parcelas, o estado
anterior é gravado em `historico_proposta`.

Não há migração automática em massa.

## Legado preservado

- `comissoes`: tabela anterior. Consulta histórica somente; não alimenta cálculo.
- `regimes` e `repasses`: partes do caminho de consultores; não usar em gestor.
- `gestor_vendedor`: código de propostas antigas; não criar novas vendas com ele.

## Pontos de código

| Responsabilidade | Entrada principal |
|---|---|
| Cálculo de consultor | `calc_comissao()` |
| Cálculo de gestor | `_gestor_calculo_inicial()` e `_gestor_calcular()` |
| Congelamento de regra | `_gestor_congelar_snapshot()` |
| Migração unitária | `_migrar_venda_legada_para_gestor()` |
| Parcelas de consultor | `gerar_parcelas()` |
| Parcelas de gestor | `gerar_parcelas_socio_gestor()` |
| Visão consolidada | `_fin_visao()` |
| Central operacional | `/comissoes/central` |

## Checklist antes de alterar

1. A venda é de consultor ou de gestor/admin?
2. A regra é por operadora, variação e plano exatos?
3. A proposta já tem snapshot/financeiro em movimento? Se sim, não recalcular.
4. A mudança é de previsão, apuração de extrato ou confirmação de entrada?
5. Financeiro e Fluxo de Caixa continuam lendo a mesma fonte?
