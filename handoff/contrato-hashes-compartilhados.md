# Contrato — o que um consultor ensina, os outros recebem

> 07/08/2026. `app.py`, então é do Antigravity. Duas rotas, uma tabela.
>
> **A extensão já está pronta e no ar (3.38.0).** Ela chama estas rotas, leva
> 404 e segue funcionando como antes. Nada quebra enquanto isto não existir —
> só continua custando um aprendizado manual por pessoa.

---

## 1. O problema, em número

A extensão cota dentro da sessão do consultor reaproveitando as chamadas do
Painel do Corretor (Next.js). Cada ação de servidor é identificada por um
header `next-action`, que é **gerado por build**. Quando a Trindade publica uma
versão, o identificador antigo devolve 404 e a extensão precisa reaprender
observando o consultor usar o Painel uma vez.

O `next-action` **não varia por usuário** — é a mesma string para os oito
consultores. Mas hoje cada máquina reaprende sozinha.

**Um deploy da Trindade custa 8 aprendizados manuais para descobrir exatamente
a mesma informação.** Com esta rota, custa 1.

---

## 2. As rotas

```
GET  /api/whatsapp/cotador/hashes?origem=https://paineldocorretor.com.br
     -> { "ok": true,
          "papeis": { "criar": "a1b2…", "operadoras": "c3d4…", "preco": "e5f6…" } }

POST /api/whatsapp/cotador/hashes
     body: { "origem": "https://paineldocorretor.com.br",
             "papeis": { "criar": "a1b2…", "preco": "e5f6…" },
             "mortos": [ { "papel": "planos", "hash": "velho…" } ] }
     -> { "ok": true }

     methods=['GET','POST','OPTIONS'] + _wa_auth_ok() + _wa_cors()
```

**`origem` é chave, não enfeite.** O Painel de produção e o de homologação são
servidores diferentes, com deploys diferentes: um hash de um não vale no outro.
Guardar os dois na mesma chave faria a última gravação sobrescrever a outra e a
cotação chamaria a função errada **sem dar erro** — o pior tipo de falha.
Sanitizar: aceitar só origem `https://` e no máximo 120 caracteres.

Papéis válidos: `criar, abrir, vidas, filtro, operadoras, planos, preco,
entidade`. **Ignorar chave fora dessa lista** — é entrada externa.

O hash é opaco para nós: string curta, `[A-Za-z0-9_-]`, teto de 200 caracteres.
Recusar o que não casar, sem tentar consertar.

### Tabela

```sql
cotador_hash (
  id, origem TEXT, papel TEXT, hash TEXT,
  visto_em TIMESTAMP,      -- última vez publicado como vivo
  usuario_id INTEGER,      -- quem ensinou (só para diagnóstico)
  UNIQUE(origem, papel)
)
```

Uma linha por `(origem, papel)`: guardamos **o hash que está valendo**, não
histórico. Publicação nova sobrescreve e atualiza `visto_em`.

---

## 3. A regra que vale mais que o resto

**`mortos` apaga; `papeis` grava. Nunca o contrário.**

Quando um hash devolve 404, a extensão o apaga localmente e reporta em
`mortos`. O servidor deve **apagar a linha somente se o hash guardado for
exatamente aquele**:

```sql
DELETE FROM cotador_hash WHERE origem=? AND papel=? AND hash=?
```

O `AND hash=?` é o ponto inteiro. Sem ele:

> A máquina A está numa versão velha do Painel (deploy gradual) e reporta
> "o hash X morreu". Nesse meio tempo a máquina B já aprendeu o hash Y, novo e
> funcionando, e publicou. Um DELETE sem conferir o hash apagaria o Y — e as
> oito máquinas voltariam a "falta ensinar uma vez", por causa da máquina mais
> atrasada. **A cada deploy da Trindade.**

Deploy gradual não é hipótese: se eles usam Vercel, duas builds coexistem por
horas.

---

## 4. Ordem, prazo e silêncio

- **O GET é palpite, não verdade.** A extensão restaura o dela primeiro e só usa
  a resposta nos papéis que faltam localmente. Não precisa ser transacional nem
  perfeitamente consistente.
- **Prazo curto** — a extensão desiste em 6s (GET) e 8s (POST). Consulta lenta
  aqui atrasa a abertura da aba do Painel do consultor.
- **Falhar em silêncio é o comportamento certo.** Sem estas rotas, a extensão
  aprende sozinha como sempre aprendeu. Isto é conveniência; **não pode virar
  dependência para cotar**. Não faça nada que transforme erro daqui em erro na
  tela do consultor.
- **O POST é de mão única:** a extensão não espera resposta. Devolva `{"ok":
  true}` e pronto.

---

## 5. O que NÃO fazer

- **Não guardar a `arvore`** (`next-router-state-tree`). A extensão manda só o
  hash de propósito: ainda não foi confirmado se a árvore carrega algo do
  corretor. Se vier no corpo, ignore.
- **Não versionar por data.** Data não diz de qual build o hash é. A validade é
  descoberta pelo uso: funcionou (200) ou morreu (404).
- **Não expor isto fora de `/api/whatsapp/*`.** É rota de extensão, autenticada
  por chave, sem sessão de navegador.
- **Nunca `str(e)` no campo `erro`** — o log guarda o texto inteiro.

---

## 6. O custo, dito na cara

Isto concentra num servidor nosso a impressão digital de como falamos com o
sistema deles. Hoje isso só existe espalhado nos navegadores dos consultores.
É decisão tomada pelo Guilherme com o risco na mesa — está registrado aqui para
quem ler depois saber que foi escolha, não descuido.

---

## 7. Antes de entregar

```bash
git status --short          # arquivo que não é seu? NÃO troque de branch
.venv/bin/python scripts/auditar.py <sua-branch>
python3 -c "import ast; ast.parse(open('app.py').read())"
git log --oneline -1 origin/main
```

Teste local em SQLite, com a chave da extensão no ambiente:

```bash
curl -s -H "X-Extension-Key: $WHATSAPP_EXT_KEY" -H "Content-Type: application/json" \
  -X POST -d '{"origem":"https://paineldocorretor.com.br","papeis":{"criar":"AAA"},"mortos":[]}' \
  http://localhost:8080/api/whatsapp/cotador/hashes

curl -s -H "X-Extension-Key: $WHATSAPP_EXT_KEY" \
  "http://localhost:8080/api/whatsapp/cotador/hashes?origem=https://paineldocorretor.com.br"
```

**O teste que não pode faltar** — o `AND hash=?` da seção 3:

1. POST grava `criar = AAA`.
2. POST grava `criar = BBB` (outra máquina aprendeu o novo).
3. POST com `mortos: [{"papel":"criar","hash":"AAA"}]` (máquina atrasada).
4. GET tem que devolver **`BBB`**. Se voltar vazio, o `AND hash=?` não está lá.

Branch a partir de `main`, só `app.py`. Um commit.
