# Contrato — cotações do lead dentro da conversa do WhatsApp

> 06/08/2026. É `app.py`, então é do Antigravity. Uma rota só.
>
> O frontend (`extensao-whatsapp/content.js`) é do Claude Code e será feito em
> paralelo — o painel já existe, o que falta é de onde tirar os dados.

---

## 1. O que muda pro consultor

Hoje: o cliente pergunta no WhatsApp "e aquele orçamento?". O consultor troca de
aba, abre o JOB, procura o cliente na lista, acha a cotação, copia o link, volta
pra conversa e cola.

Depois: ele vê as cotações daquele cliente **na própria conversa**, e manda o
link com um clique.

**O ganho não é "ter cotação na extensão". É não sair da conversa** — cada troca
de aba no meio de um atendimento é uma chance de perder o cliente.

Isto é a metade que **não depende da base local estar cheia**: mostra o que já
existe, não cota nada. Cotar dentro da conversa vem depois, quando o cache
tiver volume (ver `handoff/cotacao-na-extensao.md`).

---

## 2. A rota

Uma só. Autenticação **por chave da extensão**, como as outras `/api/whatsapp/*`
— a extensão não tem sessão de navegador.

```
GET /api/whatsapp/cotacoes?telefone=5519993334444
GET /api/whatsapp/cotacoes?lead_id=561
    methods=['GET', 'OPTIONS']
    _wa_auth_ok() + _wa_cors()      (mesmo par de /api/whatsapp/lead/ficha)

    -> { "ok": true,
         "lead_id": 561,
         "lead_nome": "Guilherme Augusto Santos",
         "cotacoes": [
           { "id": 42,
             "titulo": "Guilherme Santos · Campinas - SP · Adesão",
             "token": "a1b2c3d4",
             "url": "https://job-serenus-production.up.railway.app/c/a1b2c3d4",
             "total": 5723.12,
             "planos_cotados": 3,
             "criado_em": "2026-08-05T14:00:00-03:00",
             "dias": 1 }
         ] }
```

**Ordenar da mais nova pra mais antiga, teto de 10.** O consultor quer a última;
histórico completo é a tela do JOB.

**`cotacoes: []` é resposta legítima** — cliente que nunca foi cotado. Não é erro
e não pode virar 404: a extensão pergunta isso em toda conversa que abre, e um
404 por conversa encheria o log de falha que não é falha.

**Se o telefone não casar com lead nenhum:** `{"ok": true, "lead_id": null,
"cotacoes": []}`. Mesma lógica — abrir conversa de quem não é lead é normal.

**A `url` vem montada pelo servidor.** Só ele sabe o endereço público
(`_SITE_BASE_URL`); a extensão montando na mão erraria em ambiente de teste.

---

## 3. De onde sai cada campo

Tudo de `cotacao_salva`:

| campo | origem | cuidado |
|---|---|---|
| `total` | coluna **`total`** | **NÃO existe `valor_total`.** Ler o nome errado devolve None, o `or 0` vira 0.0 e a tela mostra R$ 0,00. Foi o commit `004b4ad` — R$ 84.015,41 apresentados como zero |
| `planos_cotados` | `len(json.loads(planos_json))` | JSON quebrado → **não** mande 0 calado; omita o campo ou mande `null` |
| `token` | coluna `token` | sem token não há link; devolva `url: null` e a tela esconde o botão |
| `criado_em` | coluna `criado_em` | ISO com fuso de SP |
| `dias` | calculado | dias desde `criado_em`, por DATA (não datetime) — comparar timestamp dá off-by-one por fuso |

**O casamento do telefone** usa `_buscar_lead_por_telefone(conn, tel_norm)`, que
já existe e já deduplica. Não escrever outro.

---

## 4. A regra que vale mais que o resto

Consulta que falha **não devolve lista vazia**. Devolve
`{"ok": false, "erro": "<texto humano>"}`.

Lista vazia afirma "este cliente nunca foi cotado". Falha afirma "não consegui
saber". São coisas diferentes, e a segunda vira um consultor dizendo ao cliente
que nunca cotou pra ele — quando cotou.

Esse defeito já apareceu **três vezes** neste módulo (`7bf5bbc`, `004b4ad`,
`c2db14d`). Aqui a versão é conversa com cliente na frente.

**Nunca `str(e)` no campo `erro`** — o log guarda o texto inteiro.

---

## 5. Antes de entregar

```bash
.venv/bin/python scripts/auditar.py <sua-branch>
```

Ele pega coluna inexistente (exatamente o caso do `valor_total` acima), `str(e)`
vazando, código morto e violação de fronteira. E diz em que branch o diretório
está — `git checkout -b` troca a branch do diretório compartilhado.

## 6. Regras do projeto

Do `CLAUDE.md`: sem emojis; uma mudança por commit; validar com
`python3 -c "import ast; ast.parse(open('app.py').read())"`; testar local em
SQLite antes do deploy.

Armadilhas deste módulo: `close_db(conn)` mata o que vem depois (3 ocorrências);
`is_pg` é local de `init_db()`; erro em transação PG aborta o que veio antes.

Branch a partir de `main`, só `app.py`, sem merge direto.
