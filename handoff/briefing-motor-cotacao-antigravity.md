# Briefing — Motor de Cotação do JOB Serenus (backend)

> **Substitui integralmente o plano anterior "Motor Híbrido com Cache Incremental Local".**
> Aquele plano foi escrito antes de alguém consultar o banco de produção. A consulta
> foi feita em 05/08/2026 e mudou quatro decisões. Se você recebeu o texto antigo,
> descarte — o que vale é este.
>
> Divisão de trabalho: **este documento é a especificação do backend.** O frontend e
> a UX ficam com o Claude Code, que também escreveu esta spec.

---

## 1. NÃO CONSTRUIR — já existe e está em produção

O plano antigo pedia para criar coisas que já estão no `app.py`. Construir de novo
significa duas implementações divergindo do mesmo cálculo.

| O plano antigo pedia | Já existe |
|---|---|
| `POST /api/cotacao/calcular` | **`POST /api/v1/cotacao/calcular`** — motor em `calcular_cotacao()` (app.py ~28480). Recebe `idades[]` + `planos[]`, devolve por faixa, total, distribuição e `avisos[]`. |
| `POST /api/cotacao/sincronizar-local` | **`POST /cotacao/tabelas/importar-pdc`** — recebe o JSON do extrator, faz upsert com dedup por `(operadora, plano, modalidade, acomodacao, coparticipacao, cidade, tipo_cnpj)`. Reimportar atualiza, não duplica. |
| Tabelas `cotacao_tabela` / `cotacao_preco` | Existem, com `cidade`, `vigencia`, `atualizado_em`, `abrangencia`, `linha`, `tipo_cnpj`. Mais `cotacao_rede`, `cotacao_watchlist`, `cotacao_salva`, `cotacao_viva`, `cotacao_legenda_modelo`. |
| Selo de frescor / TTL | Existe em `cotacao_tabelas()` (app.py ~27300): verde ≤7 dias, amarelo 8–21, vermelho >21 ou sem data. |
| Listagem de planos | `GET /api/v1/cotacao/planos` |

**Só um endpoint do plano antigo realmente não existe:** `GET /api/cotacao/status-tabelas`.

---

## 2. Já feito — não refazer

Dois commits já estão em produção. Partir daqui.

- **`7bf5bbc`** — `_meta_rastreio` consultava `crm_leads.fbclid`, coluna inexistente. Exceção engolida devolvia dicionário pela metade, e a tela renderizava zeros fabricados. Corrigido: fbclid lido de `dados_extras` (`click.fbclid`), cada contagem com try próprio, e o template só desenha se todas as chaves chegaram.
- **`a45e136`** — Passos 1 e 2 abaixo.
  - `atualizado_em` passou a ser gravado nos 4 caminhos de escrita (formulário, CSV, PDF, e o UPDATE de edição). Antes só o `importar-pdc` gravava.
  - Backfill idempotente (`meta_flags` = `cot_atualizado_em_20260805`) preencheu as 152 tabelas com `criado_em`, **não com a data de hoje** — elas nunca foram atualizadas, então a última vez que receberam preço foi quando nasceram.
  - `importar-pdc` gravava a **cidade dentro do campo `abrangencia`**. Corrigido: lê `abrangencia` do extrator, e sem ela deixa vazio.

---

## 3. Realidade medida em produção — 05/08/2026

Isto não é estimativa, é consulta ao banco. Todo número abaixo condiciona uma decisão.

```
cotacao_tabela ............ 152 linhas, todas ativas
  completas (10/10 faixas)   130
  incompletas                 22   <- ver §6, a maioria NÃO é defeito
cotacao_preco .............. 1.520 linhas, 1.406 com preço > 0
cotacao_rede ...............     0   <- vazia
operadoras .................    16
modalidade ................. PME 124 · PF 20 · Adesão 8

cidade preenchida ..........   0 de 152   <- watchlist não casa com nada
vigencia preenchida ........  47 de 152
atualizado_em ..............   0 de 152   <- CORRIGIDO no a45e136
nascimento das tabelas ..... 28/06 a 13/07/2026

cotacao_watchlist ..........   6 itens (Campinas e Sorocaba × PF/PME/Adesão)
cotacao_salva ..............  40 total · 33 em julho · 7 em junho · 0 em agosto
                              última cotação salva: 21/07/2026
cotacao_viva ...............   2
```

**Três conclusões que mudam o plano:**

1. **A sincronização nunca rodou.** Dos 4 caminhos de escrita, só o `importar-pdc`
   preenchia `cidade` e `atualizado_em`. Estando 0/152, nenhuma das 152 tabelas veio
   do Painel do Corretor — o cache inteiro é carga manual.
2. **A watchlist está órfã.** Ela guarda `(cidade, modalidade)`, e nenhuma tabela tem
   cidade. O pré-aquecimento não tem com o que casar até o primeiro lote entrar pelo
   `importar-pdc`.
3. **A ferramenta parou de ser usada.** 33 cotações em julho, zero em agosto. Vale
   descobrir o porquê antes de investir em escala.

---

## 4. Decisões fechadas — o que mudou em relação ao plano antigo

### 4.1 Frescor ancora na VIGÊNCIA, não num TTL de 15 dias

O plano antigo dizia "TTL de 15 dias". Está errado pela natureza do dado: preço de
plano de saúde não envelhece devagar, ele muda de uma vez, em reajuste com data
marcada. Um prazo fixo serve preço vencido por até 15 dias sem ninguém saber.

**Regra correta:**
- **Âncora principal:** o campo `vigencia` da própria tabela. Passou a vigência, está
  velha no dia seguinte, independente de quantos dias tem.
- **Rede de segurança:** o prazo por `atualizado_em`, mantendo a régua que já está no
  ar (verde ≤7 / amarelo 8–21 / vermelho >21).
- Quem não tem vigência cai só na rede de segurança.

Isso importa porque o link público `/c/<token>` é **imutável por design**. Preço errado
enviado ao cliente não tem como ser corrigido no mesmo link.

`calcular_cotacao()` já emite `vigencia_expirada` em `avisos[]`. Manter e ampliar.

### 4.2 Pré-aquecimento pela watchlist, lazy só como rede

O cache "sob demanda" cobra do freguês errado: a cotação que popula o cache é
justamente a que não tem cache — a do corretor no telefone com o cliente.

**Regra correta:** a `cotacao_watchlist` define quais `(cidade, modalidade)` ficam
quentes. A sincronização pré-preenche essas. O lazy fica só como rede para combinação
não prevista.

### 4.3 "Risco zero" não existe

IP residencial fecha um vetor de rede. O que denuncia automação é o **padrão**: volume,
cadência, horário. Tratar como "risco baixo **se** a cadência imitar uso humano". Não
rodar em rajada.

### 4.4 Entidade de classe precisa de campo próprio

O plano antigo não mencionava. Na Adesão, a entidade de classe muda **preço e
elegibilidade**. Hoje ela está enfiada em dois campos ao mesmo tempo:

```
dentro de `operadora`:  "Affix ANSP" · "Affix ASCOSERVI" · "Affix FNEL" ·
                        "Affix UNIPRO" · "SUPERMED - ANASPL  (curso superior)"
dentro de `linha`:      "(Servidor Público…" · "(Comercio, Indústria…" ·
                        "(Estudante - B…" · "(curso superior)"
```

Efeito no corretor: o filtro de operadora lista **4 "Affix" como se fossem 4
operadoras diferentes**. São 23 tabelas afetadas.

---

## 5. Passos de backend a executar

### Passo 3 — coluna `entidade`

- Migração: `("cotacao_tabela", "entidade", "TEXT DEFAULT ''")` na lista de migrações
  já existente (app.py ~3200).
- Backfill nas 23 linhas: extrair a entidade de `operadora` e de `linha`, deixando
  `operadora` com a **administradora** apenas (`Affix`, `SUPERMED`) e `entidade` com o
  nome da entidade (`ANSP`, `ASCOSERVI`, `FNEL`, `UNIPRO`, `ANASPL`).
- Idempotente via `meta_flags`.
- `importar-pdc` passa a ler `p.get('entidade')` e `p.get('administradora_nome')`.
- **Atenção:** a chave de dedup precisa incluir `entidade`, senão duas entidades do
  mesmo plano viram uma linha só e uma sobrescreve a outra.

### Passo 4 — as 5 duplicidades

Cinco combinações aparecem 2× cada, indistinguíveis pela chave de dedup atual:

```
2x  SUPERMED - ANASPL · Platinum R2 Supermed     · PME/Apartamento/Parcial
2x  Medsênior · Medsênior Infinite               · PF/Apartamento/Sem
2x  Medsênior · Medsênior Infinite               · PME/Apartamento/Sem
2x  Medsênior · Medsênior Black                  · PF/Apartamento/Sem
2x  Medsênior · Medsênior Black Corporate        · PME/Apartamento/Sem
```

Antes de apagar: comparar os preços dos dois lados. Se divergirem, **não é duplicata**
— é a mesma tabela em cidades diferentes que perderam a cidade. Nesse caso o certo é
descobrir a cidade, não fundir. Só fundir se os preços forem idênticos, mantendo a de
`criado_em` mais recente.

### Passo 5 — `COTACAO_WRITE_API_KEY`

`/cotacao/tabelas/importar-pdc` hoje é `@login_required @admin_required`, o que
funciona pela tela mas não serve para o script residencial rodar sozinho.

- Aceitar **também** header `X-Cotacao-Key` conferido contra `os.environ['COTACAO_WRITE_API_KEY']`.
- Chave **de escrita, separada** da de leitura (`@api_requer_chave('cotacao:ler')` já
  existe e é outra coisa). Quem grava preço em massa não compartilha credencial com
  quem consulta.
- Sem a variável no ambiente, a rota continua só com sessão de admin — nunca liberar
  por ausência de configuração.
- Comparar com `hmac.compare_digest`.

### Passo 6 — `GET /api/cotacao/status-tabelas`

O único endpoint novo. Contrato exato:

```json
{
  "ok": true,
  "total": 152,
  "ativas": 152,
  "completas": 130,
  "frescor": { "fresca": 0, "ok": 0, "velha": 152, "sem_data": 0 },
  "ultima_sincronizacao": "2026-07-13T16:55:32-03:00",
  "operadoras": [ { "nome": "Porto Saúde", "tabelas": 46, "mais_velha_dias": 38 } ],
  "watchlist": [ { "cidade": "Campinas - SP", "modalidade": "PME", "tabelas": 0 } ]
}
```

**Regra inegociável de contrato** (é o defeito do `7bf5bbc` se repetindo): se uma
consulta falhar, **não devolver a chave com zero**. Ou a chave vem com o número medido,
ou não vem. Zero significa "medi e deu zero", nunca "não consegui medir". A tela
distingue os dois casos e mostra "não foi possível medir" no segundo.

---

## 6. Achados que precisam de decisão, não de código imediato

### 6.1 Faixa ausente é idade mínima de venda, não tabela quebrada

As "22 incompletas" quase todas não são defeito. O padrão medido:

```
Medsênior (18 tabelas)      44-48, 49-53, 54-58, 59+     vende de 44 em diante
Beneficência Vital           49-53, 54-58, 59+            vende de 49 em diante
Beneficência Access (4)      19-23 … 59+  (falta 00-18)   não cobre menor de 18
```

Faixa ausente é **sempre um bloco contíguo no começo**. Confirmado pelo Guilherme:
a Medsênior é operadora de sênior e vende de 44 anos em diante — é o produto.

**Consequência de modelagem:** o certo não é `10 faixas = completa`, é registrar a
**idade mínima de venda** por tabela. Sugestão: campo `idade_min` derivado da menor
faixa com preço, ou um flag `catalogo_parcial_ok`.

### 6.2 DEFEITO REAL — plano não elegível vira o "mais barato"

`calcular_cotacao()` emite o aviso `preco_ausente` quando a faixa não tem preço — bom.
**Mas o total continua somando zero naquela faixa.** E `registrar_cotacao_no_lead()`
escolhe o plano por `min(planos, key=total)`.

Cenário: cotar uma família com um filho de 30 anos contra a Medsênior. O de 30 entra
como R$ 0. A Medsênior fica artificialmente a mais barata, ganha o `min()`, e o valor
vai escrito no `valor_estimado` do lead. Se a tela nova puser uma badge "Mais
Econômico" por preço, ela vai apontar para um plano que **não cobre aquela pessoa**.

**Correção necessária:** plano com `preco_ausente` para uma faixa que tem vida deve
ser marcado **não elegível** e ficar fora do ranking de preço — não apenas avisado.

---

## 7. Consolidação da tela — Passo 7

**Direção definida pelo Guilherme em 05/08/2026, e ela mudou:** a UX de
`/cotacao/novo` **fica como está** (espelha o Painel do Corretor, os consultores já
têm o hábito) e só melhora. Não redesenhar. O plano antigo pedia "interface moderna e
intuitiva do zero" — **isso está cancelado**.

### 7.1 O ponto que ninguém tinha notado: as duas telas fazem coisas opostas

- **`/cotacao/novo`** é o cotador **ao vivo**: puxa preço do Painel do Corretor pela
  sessão do consultor, via extensão, e grava em `cotacao_viva` (2 registros). O
  subtítulo dele, hoje, na tela, diz: *"O JOB não guarda tabela — então não existe
  tabela desatualizada aqui."*
- **`/cotacao`** é o multicálculo da **base local**: lê `cotacao_tabela` +
  `cotacao_preco` (as 152) e é o que alimenta `cotacao_salva` (as 40 cotações).

Manter a primeira e matar a segunda, como está pedido, tiraria do ar justamente a tela
que usa a base local — que é tudo o que este projeto está construindo.

**Resolução:** mantém-se a **interface** do `/cotacao/novo` (layout, fluxo, hábito) e
**troca-se o motor por baixo** para a base local. A cara boa fica, o mecanismo passa a
ser o do cache. O `/cotacao` sai porque a função dele sobe para dentro dessa cara.

**Consequência obrigatória:** aquele subtítulo vira mentira no minuto da troca. Tem que
ser reescrito para dizer a verdade nova — que o preço vem da base do JOB, com a data da
última atualização à vista. O frontend cuida disso.

### 7.2 O ganho de velocidade — medido, e um N+1 que impede o "<50ms"

Os dois lados, medidos em 05/08/2026:

```
COTAÇÃO AO VIVO (numeros reais de cotacao_viva.ms, em producao)
  20 planos, Campinas - SP ....... 373,6 s   = 6 min 14 s   (18,7 s por plano)
   1 plano ........................  1,5 s

BASE LOCAL (calcular_cotacao com 152 tabelas x 10 faixas)
   10 planos ->  20 consultas ...... ~0,1 a 0,2 s no Postgres da Railway
   30 planos ->  60 consultas ...... ~0,2 a 0,5 s
  152 planos -> 304 consultas ...... ~0,9 a 2,4 s
```

O ganho para uma cotação típica é de **6 minutos para menos de meio segundo**.

**Mas o "<50ms" do plano antigo não é alcançável hoje**, e a razão é um N+1:
`calcular_cotacao()` faz **duas consultas por plano** dentro do laço `for tid in
plano_ids` — um `SELECT * FROM cotacao_tabela WHERE id=?` e um `SELECT faixa, preco
FROM cotacao_preco WHERE tabela_id=?`. Comparar as 152 vira 304 idas ao banco.

**Correção (backend, pequena):** buscar tudo de uma vez, exatamente como
`api_v1_cotacao_planos()` (app.py ~19010) já faz:

```python
marc = ','.join(['?'] * len(ids))
conn.execute(f"SELECT tabela_id, faixa, preco FROM cotacao_preco WHERE tabela_id IN ({marc})", ids)
```

304 consultas viram 2. Aí sim o "<50ms" é real, e ele deixa de crescer com o catálogo
— que é o que importa, porque o cache existe justamente para crescer.

**O que não some:** os 6 minutos não desaparecem, eles **mudam de lugar**. Saem do
momento em que o cliente está esperando no telefone e vão para a sincronização, que
roda uma vez por cidade, sem ninguém do outro lado. Com a watchlist atual (Campinas e
Sorocaba × PF/PME/Adesão = 6 combinações), a carga inicial custa da ordem de meia hora
de extração — uma vez — e depois só quando a tabela vence.

### 7.3 Bônus: some uma implementação duplicada do cálculo

`cotacao()` (app.py ~26263) calcula **inline**, com laço próprio sobre `cotacao_preco`,
separado de `calcular_cotacao()` (~28480). São dois motores para a mesma conta — que é
exatamente o risco que o docstring de `calcular_cotacao` descreve: *"Duas cópias
divergem: um dia alguém corrige um arredondamento de um lado só e o preço da tela deixa
de bater com o da API."* Já aconteceu.

Ao descontinuar `/cotacao`, **`calcular_cotacao()` fica como motor único.** Não portar
o laço inline para lugar nenhum.

**Funções do `cotacao()` que precisam sobreviver dentro de `calcular_cotacao()` ou dos
filtros da nova tela** (conferir uma a uma antes de apagar):

- filtro `mei` — `tipo_cnpj` vazio OU em (`todos`, `todos os portes`, `todos os tipos`) OU igual ao valor pedido
- filtro múltiplo por operadora (`op` repetido)
- filtros `modalidade`, `acomodacao`, `coparticipacao`
- distribuição por faixa (`fx_0`..`fx_9`) convertida em idades representativas `[5,20,25,30,35,40,45,50,55,60]`
- ordenação `operadora A-Z, depois menor preço`
- separação de tabelas incompletas

### 7.4 Consolidação das quatro rotas em uma

`/cotacao/novo` absorve `/cotacao/salvas`, `/cotacao/tabelas` e `/cotacao/legendas`
como abas. `/cotacao` é descontinuada. Quatro itens de menu viram um.

**Layout já definido pelo frontend** — a aba "Cotar" é a tela atual intacta; as outras
três entram como painéis irmãos, carregados só quando abertos.

O backend precisa entregar **três rotas JSON novas**, uma por aba. Não empilhar 152
tabelas + 40 cotações + legendas na abertura de `/cotacao/novo`: a tela existe para
cotar rápido, e carregar tudo no primeiro paint mata os 2-3 segundos que o usuário
tolera.

```
GET /cotacao/bloco/salvas?q=<busca>
    -> { "ok": true, "eh_admin": bool, "total": int,
         "cotacoes": [ { id, titulo, cliente_nome, cliente_telefone, cliente_email,
                         token, criado_em, planos_cotados, valor_total } ] }
    Regra: quem NÃO é admin só recebe as próprias (corretor_id). Filtrar no SQL.

GET /cotacao/bloco/tabelas                      [admin]
    -> { "ok": true, "n_velhas": int,
         "tabelas": [ { id, operadora, plano, entidade, modalidade, acomodacao,
                        coparticipacao, cidade, abrangencia, vigencia,
                        precos_ok, dias_atualizado, frescor } ],
         "watchlist": [ { id, cidade, modalidade } ] }
    frescor: "fresca" | "ok" | "velha" | "sem_data"  (mesma régua de cotacao_tabelas())

GET /cotacao/bloco/legendas                     [admin]
    -> { "ok": true, "modelos": [ { id, nome, corpo } ] }
```

**Regra de contrato, a mesma do §5 e inegociável:** consulta que falha **não devolve a
chave com zero**. Devolver `{"ok": false, "erro": "<texto curto>"}` e deixar a tela
dizer "não foi possível carregar". Zero significa "medi e deu zero", nunca "não
consegui medir". Foi exatamente esse defeito que gerou o commit `7bf5bbc`.

**Permissão é no servidor, não no template.** Tabelas e legendas são `@admin_required`
hoje. O consultor comum não pode nem receber o JSON — a rota responde 403, não uma
lista vazia.

**Rotas antigas continuam respondendo** (links salvos, favoritos). Só `/cotacao` sai,
com redirect 301 para `/cotacao/novo`. As ações POST já existentes
(`/cotacao/legendas/salvar`, `/cotacao/salvas/<id>/excluir`, `/cotacao/watchlist/add`,
`/cotacao/tabelas/<id>/excluir`, os importadores) **ficam onde estão** — a tela nova
chama as mesmas URLs. Não recriar nenhuma.

---

## 8. Regras do projeto — valem para todo commit

Do `CLAUDE.md`:

1. **Sem emojis** em botões ou interface. Limpeza total feita em 30/06/2026, não reintroduzir.
2. **Uma mudança por vez, commits pequenos.** Não misturar assuntos.
3. **Não fazer mudanças não solicitadas.**
4. Validar após editar: `python3 -c "import ast; ast.parse(open('app.py').read())"`
5. Testar local antes do deploy (SQLite): `JOB_DATA_DIR=/tmp/jobtest` + `app.app.test_client()`
   com sessão `{'user_id':1,'perfil':'admin'}`.

Armadilhas que já morderam neste módulo:

- **`close_db(conn)` mata o que vem depois.** Código colocado após ele falha em
  silêncio dentro do try/except. Aconteceu 3× no projeto.
- **`is_pg` é local de `init_db()`.** Usar no escopo do módulo levanta NameError
  engolido. Fora dela, usar `DB_MODE == 'postgres'`.
- **Erro em transação PG contamina tudo antes.** Cada consulta de diagnóstico com seu
  próprio try + rollback.
- **Token `/c/<token>` é IMUTÁVEL.** "Nova versão" cria registro novo, nunca UPDATE.
- Row do SQLite não passa no `|tojson` — converter para dict na rota.
