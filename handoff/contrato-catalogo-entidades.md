# Contrato — catálogo de entidades de classe

> Escrito em 06/08/2026. É `app.py`, então é do Antigravity. O frontend já
> existe e está no ar; só falta trocar o armazenamento.
>
> **Antes disso, as Prioridades 2 e 3 de `correcoes-pendentes-cotacao.md`** — o
> backfill de `entidade` destrutivo e a dedup que apaga a linha ativa. Elas são
> perda de dado esperando reprocessamento; isto aqui é melhoria. Ordem sugerida:
> 2, 3, depois isto.

---

## 1. Para que serve

Na Adesão, a entidade de classe é o **portão**: se o cliente não pode entrar
nela, o plano não importa. O Painel do Corretor guarda o nome por extenso e a
lista de profissões aceitas atrás de um "i", e até hoje isso só existia lá.

A extensão já sabe buscar (papel `entidade`, commit `fe02fdb`) e a tela já
mostra numa janela com busca (`ce25887`). O que falta é **guardar no JOB**.

## 2. Onde está hoje, e por que isso não basta

O resultado fica no **`localStorage` do navegador**, por 30 dias.

Funciona, mas é por máquina. Se a Juliana abrir a mesma entidade no computador
dela, o JOB pergunta ao Painel de novo — e cada pergunta ao Painel é rastro que
estamos tentando reduzir (ver `handoff/cotacao-na-extensao.md`, §4.5).

**Guardado no banco, um consultor abre e a corretora inteira já tem.** O Painel
é consultado uma vez, não uma vez por pessoa.

---

## 3. A tabela

```sql
CREATE TABLE IF NOT EXISTS cotacao_entidade (
    id SERIAL PRIMARY KEY,
    sigla TEXT NOT NULL,              -- "ANASPL", "UNICOM-Serv", "ABPS-Econ"
    nome TEXT DEFAULT '',             -- nome por extenso
    administradora TEXT DEFAULT '',   -- "Supermed", "Affix", "Qualicorp"
    profissoes_json TEXT DEFAULT '[]',
    atualizado_em TIMESTAMP,
    criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Chave de unicidade: `(sigla, administradora)`.** A mesma sigla pode existir em
administradoras diferentes com regras diferentes. `CAECS - CAECS` mostra que
sigla e administradora às vezes coincidem; `ANAPROLIE-1` e `ANAPROLIE-2` são
entidades distintas e não podem ser normalizadas para uma.

**`atualizado_em` sempre preenchido na escrita.** Foi a falta disso que deixou
152 tabelas de cotação sem data e o selo de frescor inútil (commit `a45e136`).

**Índice** em `(sigla, administradora)` — é por onde a leitura busca.

---

## 4. As rotas

### 4.1 Ler

```
GET /cotacao/entidade?sigla=ANASPL&administradora=Supermed
    @login_required

    achou:      { "ok": true, "achou": true,
                  "sigla": "ANASPL",
                  "nome": "Associação Nacional dos Servidores Públicos e
                           Profissionais Liberais",
                  "administradora": "Supermed",
                  "profissoes": ["Administrador", "Arquiteto", …],
                  "dias_atualizado": 4 }

    não achou:  { "ok": true, "achou": false }
```

**`achou: false` não é erro.** É a resposta legítima "ninguém capturou essa
entidade ainda", e a tela usa isso para decidir perguntar ao Painel. Devolver
404 ou `ok:false` faria a tela tratar como falha e mostrar aviso de erro para
algo que é normal no primeiro acesso.

`administradora` é opcional na busca: sem ela, devolve a primeira da sigla.

### 4.2 Gravar

```
POST /cotacao/entidade
    @login_required
    corpo: { "sigla": "ANASPL", "nome": "...", "administradora": "Supermed",
             "profissoes": ["Administrador", "Arquiteto", …] }

    -> { "ok": true, "id": 12, "criou": true|false }
```

Upsert por `(sigla, administradora)`. Sempre atualiza `atualizado_em`.

**Não grava vazio por cima de cheio.** Se chegar `profissoes: []` numa entidade
que já tem 47 guardadas, mantém as 47. Uma consulta que falhou pela metade não
pode apagar o que já estava certo — é a mesma regra do `_aprender_do_vivo`, que
soma faixas em vez de substituir a tabela.

Ignorar `"$undefined"`: é assim que o Next.js serializa `undefined`, e ele chega
aqui parecendo texto legítimo. Já mordeu uma vez (`705c31d`) — `_texto_painel()`
em `app.py` já resolve isso e pode ser reaproveitada.

### 4.3 Listar (para uma tela de administração, depois)

```
GET /cotacao/bloco/entidades          [admin]
    -> { "ok": true, "entidades": [ { id, sigla, nome, administradora,
                                      qtd_profissoes, dias_atualizado } ] }
```

Não devolve a lista inteira de profissões de todas — só a contagem. Com dezenas
de entidades × dezenas de profissões, o payload cresce à toa numa tela que só
lista.

---

## 5. A regra que vale mais que tudo aqui

Consulta que falha **não devolve a chave com zero nem lista vazia**. Devolve
`{"ok": false, "erro": "<texto humano>"}` e deixa a tela dizer "não consegui
ler".

Foi o defeito do commit `7bf5bbc` — uma função devolveu o dicionário pela
metade, a tela aceitou como medição válida e desenhou zeros que ninguém mediu.
Reapareceu duas vezes depois (`004b4ad`, `c2db14d`). Aqui a versão seria pior:
uma entidade aparecendo com "aceita 0 profissões" faria o consultor dizer ao
cliente que ele não pode entrar.

**Nunca `str(e)` no campo `erro`.** A mensagem crua do Postgres entrega a stack
para o consultor e não ajuda ninguém — o log guarda o texto inteiro.

---

## 6. O que muda no frontend depois (é meu, não precisa fazer)

Quando as rotas existirem, a tela passa a:

1. perguntar ao JOB primeiro (`GET /cotacao/entidade`)
2. só perguntar ao Painel se `achou: false`
3. gravar no JOB o que o Painel respondeu (`POST /cotacao/entidade`)

O `localStorage` continua como primeira camada — evita ida ao servidor dentro da
mesma sessão —, mas deixa de ser a única memória.

---

## 7. Regras do projeto

Do `CLAUDE.md`:

1. **Sem emojis** em botões ou interface.
2. **Uma mudança por vez, commits pequenos.**
3. **Não fazer mudanças não solicitadas.**
4. Validar: `python3 -c "import ast; ast.parse(open('app.py').read())"`
5. Testar local (SQLite) antes do deploy.

Armadilhas deste módulo:

- **`close_db(conn)` mata o que vem depois** — falha em silêncio dentro do
  try/except. Já aconteceu 3× no projeto.
- **`is_pg` é local de `init_db()`.** Fora dela, `DB_MODE == 'postgres'`.
- **Erro em transação PG aborta tudo que veio antes** — cada consulta com try e
  rollback próprios.

## 8. Divisão

`app.py` é seu. `templates/` e `extensao-whatsapp/` são do Claude Code.

Branch nova a partir de `main`, só `app.py`, sem merge direto — o deploy sai
automático do `main` e não há staging.

**Atenção:** `git checkout -b` troca a branch do diretório de trabalho
compartilhado. Foi assim que três commits de frontend foram parar na branch
errada na semana passada, e o `git push origin main` teve sucesso sem fazer nada.
