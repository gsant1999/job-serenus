# CONTRATO — a comissão está sendo contada duas vezes maior do que é

> Guilherme, 10/08/2026: *"temos valores de comissões muito altas que estão
> prejudicando tudo."*
>
> Ele está certo, e o defeito é de uma linha só de SQL — repetida em quatro
> lugares. **`app.py` é seu; a auditoria e o diagnóstico são meus.**

---

## O defeito, em uma frase

**Estorno marca a parcela como cancelada. O Financeiro nunca olhou para isso.**

Todas as somas de comissão filtram por `status NOT IN ('Pago ao corretor')`.
`'Cancelada / Estornada'` também não é `'Pago ao corretor'` — então a parcela
cancelada **continua somando como dinheiro a entrar**, para sempre.

E o DRE é pior: não filtra status nenhum.

## Medido, não achado

`scripts/auditoria_financeiro.py` roda em qualquer banco, **só lê**, e mostra o
valor de hoje, o correto e a diferença. Com um caso de teste de duas propostas:

```
A receber (operadoras)      hoje R$ 3000,00   correto R$ 1500,00   dif R$ 1500,00
DRE · receita bruta         hoje R$ 4000,00   correto R$ 2000,00   dif R$ 2000,00

causa · parcela cancelada/estornada .... R$ 600,00
causa · proposta estornada ou excluída .. R$ 900,00
```

**Rode ele em produção antes de corrigir e guarde a saída.** É o antes/depois —
e sem ele "corrigimos" vira opinião.

## As quatro consultas, em `financeiro()`

Todas somam `parcelas` sem olhar a proposta dona dela.

| linha | o que calcula | o que falta |
|---|---|---|
| `receber_mes` | A receber (operadoras) | excluir cancelada + proposta estornada/excluída |
| `pagar_consultor` | A pagar (consultores) | idem |
| `futuras` | a tabela de comissões futuras | idem |
| `tot_mes` (DRE) | receita bruta e repasse | **não filtra status nenhum** |

### O filtro que falta, e vale para as quatro

```sql
JOIN propostas pr ON pr.id = p.proposta_id
WHERE p.competencia = ?
  AND p.status <> 'Cancelada / Estornada'
  AND COALESCE(pr.estornada, 0) = 0
  AND COALESCE(pr.status, '') <> 'Excluída'
```

Em `receber_mes`/`pagar_consultor`/`futuras`, mantenha também o
`AND p.status <> 'Pago ao corretor'` que já existe. No DRE **não**: ele é
competência, conta pago e a pagar — só não pode contar cancelado.

**Use `JOIN`, não `LEFT JOIN`.** Parcela sem proposta é órfã e não deve entrar
em número de dinheiro. O script mede quantas existem; se houver, me avise antes
de mexer nelas — apagar dado é outro assunto.

## Por que isto não é opinião de estilo

A tela de **Produção** já faz certo há tempo (`app.py:4409`):

```sql
AND status <> 'Excluída' AND COALESCE(estornada,0)=0
```

Dois módulos, duas regras, para a mesma pergunta. É por isso que ele diz que os
números não batem entre as telas — porque não batem mesmo.

## Teste antes de subir

1. `.venv/bin/python3 scripts/ci_servidor.py` — as três passam.
2. `scripts/auditoria_financeiro.py` em produção **antes** e **depois**: as
   linhas "hoje" e "correto" precisam ficar iguais depois da correção.
3. Uma proposta estornada de verdade: o valor dela some do Financeiro e o
   histórico do estorno continua na proposta.
4. Uma proposta normal: o valor **não** muda. Se mudar, o filtro pegou demais.

## O que NÃO fazer

- **Não apague parcela nenhuma.** O defeito é de leitura, não de dado. Parcela
  cancelada tem que continuar existindo — ela é o registro de que houve estorno.
- **Não mexa no cálculo da comissão.** O valor de cada parcela está certo; o
  que está errado é quais parcelas entram na soma.
- Não "conserte" a tela de Produção pra bater com o Financeiro. É o contrário:
  Produção está certa.

## Prioridade

**Na frente de tudo.** Enquanto isto não subir, ele está decidindo em cima de
número inflado — e decisão errada custa mais caro que qualquer tela feia.
