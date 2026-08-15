# Handoff — motor financeiro (14/08/2026)

Documento de retomada. O **motor** foi construído e testado; a **interface** foi
desligada porque não conversava com o resto do sistema. Aqui está o que existe,
o que está desligado, por que, e o que fazer para religar direito.

## Estado atual

`FINANCEIRO_NOVO = False` em `app.py` (ou env `FINANCEIRO_NOVO=1` para ligar).

| Peça | Estado | Onde |
|---|---|---|
| Régua de recebimento (quando a operadora paga) | **ligado** | `recebimento.regua_json`, `calc_comissao`, `gerar_parcelas` |
| Promoção como fração extra | **ligado** | `_aplicar_promocao`, `recebimento.promo_total/promo_parcela` |
| Curvas de estorno (34 regras, 194 faixas) | **ligado** | `estorno_regra`, `estorno_faixa`, `calcular_estorno` |
| Cobrança do estorno (débito ao consultor) | **ligado** | `/proposta/<id>/estorno/aplicar`, modal em `detalhe.html` |
| Tela de conferência | **DESLIGADA** → redireciona | `/comissoes/conferencia` |
| Import assistido da tabela | **DESLIGADA** → redireciona | `/comissoes/tabela` |
| "Saúde do dinheiro" no BI | **DESLIGADA** | `_bi_saude_dinheiro` |
| "O que não fechou" no Financeiro | **DESLIGADA** | `financeiro.html` |

## Por que foi desligado

O `COMISSOES_DOMINIO.md` define a fonte de verdade por pergunta, e o item 5 do
checklist é *"Financeiro e Fluxo de Caixa continuam lendo a mesma fonte?"*.

As telas novas leem `parcelas` e `affinity_conciliacao` **direto**, em vez do
razão `fin_evento`. Por isso os números não batem com os do Financeiro. Também
ignoraram `/comissoes/central`, que já era a porta única da cadeia de comissão.

**Defeito concreto observado na tela de Financeiro** (independe do que foi
adicionado — é anterior e continua lá):

- Card **"Bruto esperado" R$ 10.087,46** = `_fin_visao` → só vendas de gestor
  (`regime_aplicado IN ('socio_gestor_regra','socio_gestor_pendente')`), **sem
  filtro de competência** — soma todas as vendas de gestor de todos os tempos.
- Linha **"A receber (operadoras)" R$ 41.391,40** = `SUM(parcelas.valor_corretora)`
  filtrado por `data_prevista` do mês, **todas** as vendas.

Os dois rótulos leem como "o que vamos receber" e têm escopos diferentes.
Corrigir isso é pré-requisito de qualquer tela nova.

Também na mesma tela: **"Bruto do gestor" e "Líquido para PIX" mostram o mesmo
valor** com uma "Retenção" entre eles, porque a retenção é da Serenus e não do
gestor. Lido de cima para baixo, parece conta errada.

## Para religar, na ordem

1. Unificar o escopo dos dois números acima e rotular cada um com o que ele
   realmente conta.
2. Reescrever `conferir_comissao` e `_bi_saude_dinheiro` lendo `fin_evento`.
3. Levar a conferência para dentro de `/comissoes/central` — não criar tela nova.
4. Só então religar a chave.

## Fatos comerciais apurados (valem independente do código)

Fontes convertidas em `knowledge/affinity-tabela-comissoes.pdf.md` e
`knowledge/affinity-regras-estorno.pdf.md`. Dados normalizados em
`dados/tabela_affinity_2026-08.json` (210 linhas) e
`dados/estorno_affinity_2026-08.json` (34 regras).

### Condições promocionais (diferença cai no mês seguinte ao fim da régua)

| Operadora | Tabela | Promo | Diferença | Cai na |
|---|---|---|---|---|
| Amil PME 02–99 | 240% (100/100/40) | 280% | +40% | 4ª |
| SulAmérica PME 02–99 | 240% (100/100/40) | 280% | +40% | 4ª |
| Porto Seguro 03–99 | 240% (100/100/40) | 280% | +40% | 4ª |
| Bradesco 03–199 | 300% (100/100/100) | 300% | — | — |
| Med Sênior SP/RJ 01–29 | 150% (100/50) | 170% | +20% | 3ª |

Na tabela publicada ele aparece como **"Med Sênior"** (com espaço e acento).

### Divergências entre o cadastro e a tabela (conferir com a Affinity)

- **Bradesco PME**: sistema **330%**, tabela 300%, Guilherme disse 300%.
- **Med Sênior PME**: sistema **180%**, Guilherme disse 170%; não casa por nome
  com a tabela de PME.
- **Alice PME**: sistema 300%, tabela 240%.
- **Qualicorp PME**: sistema 300%, tabela 320% (sistema MENOR que a tabela).

### O total do sistema não é a tabela

`recebimento.total` já carrega a condição negociada (Amil está com 2,8 = 280%
contra 240% publicados). **Importar o total da tabela rebaixa o valor
negociado.** Por isso o import assistido só preenche a régua e trata total maior
que a tabela como promoção.

### Casamento de nomes

O sistema guarda a variação em três formatos: `Affix` + obs `Hapvida`,
`Affix (Hapvida)` e `Allcare Humana`. A tabela sempre separa empresa e produto.
O casamento é por conjunto de palavras (Jaccard), descartando termos que não
distinguem ninguém. Resultado real: **91 exatos, 3 prováveis, 18 ambíguos,
21 sem correspondência** de 133 configurações.

### Estorno — o que a curva precisa suportar

Até 16 degraus (Porto Seguro). Regras diferentes por escopo na mesma operadora
(Amil Dental × Médico, SulAmérica 12m × 24m, Hapvida PF × PME). Vigência por
data (Amil Médico ≥ 01/08/2026, Hapvida ≥ 01/12/2024, SulAmérica 24m ≥
03/03/2026, Klini ≥ 01/08/2026). Cinco bases de cálculo:

- acumulado ("1ª à Nª")
- parcela específica — **Unimed Guarulhos com 4 pagas estorna a 3ª**, não o acumulado
- sobre total repassado
- por dias (Seguros Unimed movimentação, Qualicorp +90d, Supermed 90/180d)
- pro-rata por dias usados (Prevent Senior) — exige conferência manual

Decisão do Guilherme: o sistema **calcula e cobra do consultor**, via lançamento
a débito abatido nas próximas comissões, com prévia e confirmação de admin.

Atenção em `Seguros Unimed / Contratos`: a curva publicada tem a 7ª parcela em
33,33% e a 8ª em 50% — degrau que sobe. Confirmar com a Affinity antes de cobrar.

## Bugs corrigidos no caminho (esses ficam)

1. **`init_db` no PostgreSQL**: as ~40 tabelas eram criadas com um commit único.
   Um erro deixava a transação abortada e **todas as tabelas seguintes não eram
   criadas**, em silêncio. Agora é um commit por tabela, com rollback e log do
   nome da tabela que falhou.
2. **`detalhe.html`**: `const DEPS_JSON = {{ ... else '"[]"' }}` — o ramo else
   virava `&#34;[]&#34;` pelo autoescape e **quebrava todo o bloco de script**
   em qualquer proposta sem dependentes (estornar, excluir, tudo morto).
3. **Fluxo de caixa**: proposta estornada some do fluxo; a linha do estorno
   precisava passar, senão o débito ficava invisível.

## O que NÃO fazer

- Não importar a tabela sobrescrevendo `recebimento.total`.
- Não criar tela nova de comissão: usar `/comissoes/central`.
- Não recalcular venda antiga; snapshot é imutável (`proposta_regra_snapshot`).
- Não somar `parcelas` para responder "o que entrou" — isso é `fin_evento`.
