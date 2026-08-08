# CONTRATO — API unificada do JOB (v1)

> Decidido pelo Guilherme em 08/08/2026.
> Dono do código: **Antigravity** (`app.py`, migrações, tela de chaves).
> Dono da extensão e do consumo: **Claude**.
> Nada em produção sem auditoria cruzada e sem o OK do Guilherme.

---

## 0. O problema que isto resolve

Hoje o JOB tem **quatro portas de entrada** que não se conhecem:

| porta | como identifica | rotas |
|---|---|---|
| `login_required` (`app.py:4756`) | sessão do site | 393 |
| `_wa_auth_ok` (`app.py:17894`) | chave compartilhada **ou** token de aparelho | 56 |
| `login_ou_extensao` (`app.py:4681`) | sessão **ou** token | 3 |
| `api_requer_chave` (`app.py:19427`) | chave de API + escopo | 5 |

Três defeitos estruturais nisso:

1. **Escopo é ficção.** Existe **um único** escopo em todo o sistema
   (`cotacao:ler`). A chave do Gabriel carregava `cotacao:escrever` e
   `crm:ler` — nenhum dos dois protegia rota nenhuma. Escopo escrito e nunca
   conferido é pior que escopo nenhum: dá sensação de controle sem controle.
2. **Chave de API não tem dono.** `api_chave` não guarda `usuario_id`. Toda
   ação por chave é anônima: não dá pra saber quem criou o lead, nem atribuir
   a cotação a um consultor, nem auditar depois.
3. **Cada rota pergunta "veio de onde"** em vez de "pode fazer isto". Por isso
   abrir uma rota existente pra extensão vira uma edição manual por rota — foi
   o que travou os botões de Legenda e Copiar imagem.

---

## 1. O modelo

Uma porta só. Ela responde três perguntas, separadas de propósito:

```
QUEM É?          identidade   pessoa · aparelho · integração
PODE O QUÊ?      escopo       crm:ler, whatsapp:enviar, ...
AGINDO POR QUEM? ator         g.usuario_id — sempre uma pessoa real
```

### As três identidades

| tipo | credencial | vira `g.usuario_id` |
|---|---|---|
| **pessoa** | e-mail e senha → sessão do site | o usuário logado |
| **aparelho** | token `<sess_id>.<segredo>` (já existe, `extensao_sessao`) | dono da sessão |
| **integração** | chave `job_live_...` em `Authorization: Bearer` | **o usuário dono da chave** |

**Toda chave de integração passa a ter dono obrigatório.** Uma chave age *como*
alguém. Sem isso não há auditoria possível.

### Contexto que a porta monta

```python
g.usuario_id   # int, sempre preenchido
g.perfil       # 'admin' | 'consultor' | ...
g.escopos      # set[str]
g.auth_via     # 'sessao' | 'token' | 'chave'
g.corretora_id # sempre 1 por enquanto — ver seção 6
```

---

## 2. Os escopos, por intenção de uso

Agrupados pelo que a pessoa **quer fazer**, não por tabela do banco:

| escopo | libera |
|---|---|
| `crm:ler` | leads, fichas, notas, etapas, funil, agenda |
| `crm:escrever` | criar/editar lead, mover etapa, nota, atividade |
| `cotacao:ler` | tabelas, planos, cotações salvas, imagem, legenda |
| `cotacao:escrever` | calcular, salvar cotação, reabrir, corrigir valor |
| `whatsapp:ler` | conversas, fila, presença, transcrições, inbox |
| `whatsapp:enviar` | mandar mensagem, disparo, campanha, funil |
| `financeiro:ler` | parcelas, repasses, comissões, fluxo de caixa |
| `financeiro:escrever` | baixar parcela, estornar, lançar |
| `propostas:ler` / `propostas:escrever` | propostas e fases |
| `ia:usar` | Ghostwriter, análise, caça-documentos |
| `admin` | usuários, chaves, configuração, aparelhos |

**`whatsapp:enviar` é separado de `whatsapp:ler` de propósito.** Uma integração
que lê conversa pra alimentar relatório não pode mandar mensagem em nome de
ninguém. É a diferença entre um vazamento chato e um desastre com cliente.

**`admin` não é escopo comum:** exige `g.perfil == 'admin'` **além** do escopo.
Chave nenhuma ganha `admin` — nem a minha, nem a sua.

---

## 3. Escopos por tipo de usuário

O que cada perfil recebe automaticamente quando entra por **sessão** ou por
**aparelho**. Aqui o escopo é derivado do perfil, não guardado:

| perfil | escopos |
|---|---|
| `admin` | todos |
| `gestor` | tudo menos `admin` |
| `consultor` | `crm:*`, `cotacao:*`, `whatsapp:*`, `propostas:*`, `ia:usar` |
| `financeiro` | `financeiro:*`, `propostas:ler`, `crm:ler` |
| `visualizador` | só os `:ler` |

Se o perfil não estiver na tabela, **cai em `visualizador`** — nunca em "tudo".
Perfil desconhecido é caso de erro, e erro não pode abrir porta.

**A chave de integração é diferente:** os escopos dela são os que foram
escolhidos na criação, **limitados pelo perfil do dono**. Chave criada por um
consultor nunca ganha `financeiro:escrever`, mesmo se pedirem.

---

## 4. Escopos por intenção de utilização

Os quatro casos reais de hoje, e o que cada um pede:

**A extensão no WhatsApp** (aparelho, 8 consultores)
`crm:*` · `cotacao:*` · `whatsapp:*` · `ia:usar`
Não recebe `financeiro:*` nem `admin`. Se a extensão for comprometida, o
financeiro não vai junto.

**O n8n / planilha de leads** (integração)
`crm:escrever` apenas. Ele só empurra lead.

**Um parceiro que cota** (integração — o caso da chave do Gabriel)
`cotacao:ler` · `cotacao:escrever`. Sem CRM, sem WhatsApp.

**BI / relatório** (integração)
Só `:ler`, dos módulos que o relatório usa. Nunca `escrever`, nunca `enviar`.

Regra ao criar chave: **começa vazia e você marca o que precisa.** Nunca
começa com tudo marcado pra depois desmarcar.

---

## 5. Como uma rota fica

```python
@app.route('/api/v1/cotacao/<int:cid>/imagem')
@requer('cotacao:ler')
def api_cotacao_imagem(cid):
    ...
```

`@requer` substitui os quatro decoradores. Ele aceita sessão, token e chave,
nessa ordem, e devolve:

- `401 nao_autenticado` — nenhuma credencial válida
- `403 sem_permissao` — autenticou mas falta o escopo, com
  `{"escopo_exigido": "...", "escopos_que_voce_tem": [...]}`
- `429 limite_excedido` — só pra chave, com `Retry-After`

Mensagem **igual** pra chave inexistente e revogada, como já é hoje.

### Erros dizem o que fazer

Regra do `ESCOPO-ANTIGRAVITY.md` seção 9, e vale na API: o corpo do erro diz o
que houve **e o próximo passo**. `sem_permissao` diz qual escopo falta.
`nao_autenticado` diz onde mandar a credencial.

---

## 6. Multi-corretora: preparar, não construir

Decisão do Guilherme: **`g.corretora_id` existe desde já e vale sempre `1`.**

- A porta preenche o campo.
- Nenhuma consulta filtra por ele ainda.
- Nenhuma tabela ganha coluna agora.

O ganho é que no dia da segunda corretora o isolamento entra **na porta e nas
consultas**, sem refazer autenticação. Custo hoje: uma linha.

**Não construa isolamento de verdade.** Não adicione coluna `corretora_id` em
tabela nenhuma neste contrato.

---

## 7. Tela de chaves — admin

Onde: `/admin/api-chaves`. Só `perfil == 'admin'`.

Espelha a tela de Aparelhos, que já existe e ele aprovou:

- Lista: nome · dono · prefixo (`job_live_a1b2…`) · escopos · último uso ·
  criada em · botão Revogar
- Criar: nome, **dono** (select de usuários), escopos por caixa de seleção
  agrupados por módulo, começando **todas desmarcadas**
- A chave inteira aparece **uma vez**, na criação, com o aviso de que não
  aparece de novo. Guarda só o hash.
- Revogar pede confirmação e mostra o resultado (a revogação de aparelho não
  mostrava — mesmo defeito, não repita)
- Chave revogada continua na lista, riscada. Sumir da lista apaga a auditoria.

Sem emoji. Sem badge colorida escrita "ATIVA" — use o mesmo padrão visual da
tela de Aparelhos.

---

## 8. Migração — em lotes, e nesta ordem

**Nada de trocar as 56 rotas de uma vez.** Oito pessoas dependem delas e cinco
consultores estão terminando de migrar pro login agora.

**Lote 1 — a porta, sem trocar rota nenhuma.**
`@requer` escrito, testado, e `api_chave` ganhando `usuario_id`. Chave antiga
sem dono continua funcionando e loga `[API] chave sem dono id=<n>`.
Nenhuma rota existente muda. Isto sozinho já pode ir pro ar.

**Lote 2 — as 5 rotas `api_requer_chave`.** São públicas, poucas, e o
comportamento é o mesmo. Serve de prova.

**Lote 3 — as 3 de `login_ou_extensao`.**

**Lote 4 — as 56 de `_wa_auth_ok`, em grupos de ~10 por família de rota**
(`cotacao`, `lead`, `fila`, `campanha`, ...). **Gatilho:** o log
`[EXT] chave antiga usada` parar de aparecer por 48h — quer dizer que os oito
já entraram pelo login.

**Lote 5 — `login_required`.** Este é o maior e o menos urgente. Só depois de
tudo acima rodando por uma semana.

Entre lotes, a porta antiga continua viva. Em nenhum momento existe uma janela
em que alguém fica de fora.

---

## 9. Teste — o que eu vou conferir na auditoria

Rode contra **Postgres** (`railway run -s Postgres`), não só SQLite.

1. Sessão do site chega numa rota `@requer('crm:ler')` → 200
2. Token de aparelho na mesma rota → 200, e `g.usuario_id` é o dono do token
3. Chave com `crm:ler` → 200; a mesma chave em `crm:escrever` → **403**, com o
   escopo exigido no corpo
4. Chave revogada → 401, mesma mensagem de chave inexistente
5. Sem credencial → 401
6. Consultor não consegue criar chave com `financeiro:escrever`
7. `admin` recusado pra chave, mesmo com o dono sendo admin
8. Rota antiga não migrada continua respondendo igual
9. `/admin/api-chaves` **aberta no navegador** — não vale só `test_client`
10. Chave criada aparece uma vez e o hash bate na chamada seguinte

**Rota que você não viu responder não foi testada.** Já entregou duas rotas
mortas com `get_db()`; o helper é `db()`.

---

## 10. O que NÃO entra neste contrato

- Isolamento multi-corretora de verdade (seção 6)
- Trocar `login_required` (fica pro lote 5, depois)
- Qualquer arquivo em `extensao-whatsapp/` — o consumo é do Claude
- OAuth, refresh token, JWT. Não precisamos, e cada um é uma superfície nova.
- Rate limit por escopo. O limite por minuto de hoje basta.

---

## 11. Ordem de trabalho combinada

Você toca **em paralelo**: o Ghostwriter (já iniciado, esperando a decisão de
modelo) e o **Lote 1** desta API. São arquivos diferentes e não se cruzam.

Não comece o Lote 2 antes de o Lote 1 estar auditado por mim e aprovado pelo
Guilherme.
