# Contrato — login de verdade na extensão

> 08/08/2026. `app.py`, do Antigravity. Decisão do Guilherme.
> A parte da extensão (tela de login, guardar o token, mandar no cabeçalho) é
> do Claude e vai junto.
>
> **É a mudança mais estrutural da semana.** Leia inteiro antes de começar.

---

## O problema, medido

```python
def _wa_auth_ok():
    esperada = os.environ.get('WHATSAPP_EXT_KEY')
    recebida = request.headers.get('X-Extension-Key')
    return bool(esperada) and recebida == esperada
```

Uma chave só, igual nas oito máquinas. E quem é o consultor **não vem dela** —
vem de um `usuario_id` que a própria extensão manda no corpo.

Três consequências, todas reais hoje:

1. **Quem tem a chave pode dizer que é qualquer consultor.** A chave está em
   oito máquinas, num campo de texto do popup.
2. **Consultor que sai da empresa continua valendo**, porque não há o que
   revogar sem trocar a chave de todo mundo.
3. **As rotas do site recusam a extensão**, e com razão — nenhuma delas pode
   confiar num `usuario_id` que veio de fora. É por isso que legenda e imagem
   não funcionam na extensão: não é limitação técnica, é desconfiança correta.

---

## A decisão: token por APARELHO, ligado a um usuário

Não é "um token por pessoa". É **um token por login**, e a mesma pessoa pode ter
vários — o Guilherme roda mais de um WhatsApp com o mesmo consultor, e isso
tem que continuar valendo.

```
Beatriz  ->  token A  (notebook dela)
         ->  token B  (máquina do WhatsApp 2)
Gustavo  ->  token C
```

Revogar o token B não derruba o A. Apagar a Beatriz derruba os dois.

---

## 1. A tabela

```sql
CREATE TABLE IF NOT EXISTS extensao_sessao (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    apelido TEXT DEFAULT '',        -- "notebook da Bia", "WhatsApp 2"
    criado_em TIMESTAMP,
    ultimo_uso TIMESTAMP,
    revogado_em TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_extensao_sessao_hash ON extensao_sessao(token_hash);
```

**Guarde o HASH do token, nunca o token.** Se o banco vazar, um token em texto
puro é uma sessão pronta para uso; um hash não é. Use o mesmo mecanismo de
senha que o projeto já tem — não invente outro.

O `apelido` é o que permite o Guilherme olhar a lista e saber qual aparelho
revogar. Sem ele, a tela mostra cinco linhas iguais e ninguém mexe em nenhuma.

---

## 2. As rotas

```
POST /api/whatsapp/login          _wa_cors(), SEM guarda (é a porta de entrada)
     { "email": "...", "senha": "...", "apelido": "notebook da Bia" }
  -> { "ok": true, "token": "...", "usuario": { "id": 7, "nome": "Beatriz" } }
  -> { "ok": false, "erro": "credenciais_invalidas" }
  -> { "ok": false, "erro": "usuario_inativo" }
```

- **Reaproveite a verificação de senha do `/login` que já existe.** Duas
  implementações do mesmo confere-senha divergem no primeiro ajuste.
- O token vai **uma única vez**, na resposta. Não há rota que devolva o token
  de novo — perdeu, faz login outra vez.
- **Limite de tentativas por e-mail e por IP.** Sem isso esta rota é um
  adivinhador de senha aberto para a internet. Se o projeto já tem algo assim
  no `/login`, use o mesmo.
- **Nunca registre a senha no log**, nem em erro, nem truncada.

```
POST /api/whatsapp/logout         @login_ou_extensao
  -> revoga o token que fez a chamada
```

```
GET  /admin/extensao/sessoes      @login_required + admin
POST /admin/extensao/sessoes/<id>/revogar
```
A tela é minha; a rota é sua. Devolva por sessão: `usuario_nome`, `apelido`,
`criado_em`, `ultimo_uso`, `revogado_em`.

---

## 3. O decorador — é aqui que "de vez" acontece

```python
@login_ou_extensao
def cotacao_legendas_api():
    ...
```

Ele aceita **três** formas, nesta ordem:

1. **Sessão do site** (`session['user_id']`) — como hoje.
2. **Token da extensão** (`Authorization: Bearer <token>`) → acha em
   `extensao_sessao` pelo hash, ignora revogado, carimba `ultimo_uso`.
3. **Chave antiga** (`X-Extension-Key`) — **só durante a transição**, ver item 5.

Em qualquer caso ele deixa o usuário resolvido em `g.usuario_id` e `g.usuario`.

### A regra que dá sentido a tudo

**Rota protegida por este decorador NUNCA lê `usuario_id` do corpo ou da query.
Lê de `g.usuario_id`.**

Se o `usuario_id` continuar vindo de fora, a gente trocou de fechadura e deixou
a janela aberta. Onde as rotas de hoje usam `d.get('usuario_id')`, passe a usar
`g.usuario_id` — **exceto** nas rotas que ainda estão na transição (item 5), que
continuam aceitando o do corpo até a chave morrer.

### Não usar cookie

Cookie de extensão para o site exigiria afrouxar `SameSite` no JOB inteiro, o
que enfraquece a proteção de CSRF de todas as telas. **Token no cabeçalho** dá
o mesmo resultado sem tocar nisso. Não troque por conveniência.

---

## 4. O que abrir agora (e só isto)

Depois do decorador pronto, troque `@login_required` por `@login_ou_extensao`
em **duas** rotas, que são as que o Guilherme está esperando:

```
/cotacao/legendas/api
/api/v1/cotacao/<int:cid>/imagem      (esta hoje usa api_requer_chave)
```

**Não saia trocando o decorador em massa.** Cada rota aberta é uma superfície
nova; abrir as duas que têm dono e motivo é diferente de abrir cinquenta porque
deu para abrir.

---

## 5. A transição, que é o que evita parar oito pessoas

No dia do deploy, ninguém fez login ainda. Se a chave antiga parar de valer no
mesmo minuto, **oito consultores travam no meio de atendimento**.

Então:

1. A chave antiga **continua funcionando** normalmente.
2. Toda vez que uma chamada entrar pela chave antiga, registre:
   `app.logger.info('[EXT] chave antiga usada em %s', request.path)`
3. Quando esse log **parar de aparecer por 48h**, a chave sai — aí é de vez.

O log é o que transforma "acho que todo mundo já migrou" em fato. Sem ele, ou
a gente tira cedo e derruba alguém, ou nunca tira.

---

## 6. O que NÃO fazer

- **Não guarde senha na extensão.** Ela manda e-mail e senha uma vez, recebe o
  token, e esquece a senha. Guardar seria pior que a chave compartilhada de
  hoje: seriam oito senhas reais em `chrome.storage`.
- **Não faça o token expirar sozinho.** O consultor está no meio de um
  atendimento; deslogar no meio é pior que o risco que isso cobre. Revogação é
  por decisão, na tela do admin.
- **Não reaproveite a `WHATSAPP_EXT_KEY` como token de ninguém.**
- **Não mexa na extensão.** A tela de login do popup é do Claude.

---

## 7. Antes de entregar

```bash
git status --short          # arquivo que não é seu? PARE
python3 -c "import ast; ast.parse(open('app.py').read())"
./scripts/checar_extensao.sh
grep -n "get_db(" app.py    # tem que voltar vazio
.venv/bin/python scripts/checar_contrato.py
```

**Teste 1 — o login funciona e o errado falha.** Faça login pelo `curl` com a
senha certa e com a errada. Tem que sair token num caso e `credenciais_invalidas`
no outro. **Você tem que VER as duas respostas** — não vale deduzir.

**Teste 2 — token revogado para de valer.** Crie a sessão, chame uma rota,
revogue, chame de novo. A segunda tem que ser recusada.

**Teste 3 — dois aparelhos do mesmo consultor.** Dois logins do mesmo usuário
geram dois tokens diferentes, os dois funcionam, e revogar um não derruba o
outro. **Este é requisito do Guilherme, não detalhe.**

**Teste 4 — a chave antiga ainda entra e deixa rastro.** Chamada com
`X-Extension-Key` continua respondendo, e o log registra.

Um commit para a tabela e o decorador, um para as rotas de login/logout, um
para a tela de sessões. Na sua branch; quem junta em `main` é o Claude.
