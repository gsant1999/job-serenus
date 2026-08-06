# A branch do diretório é compartilhada — leia antes do próximo `git checkout`

> 06/08/2026. Para o Antigravity. Não é sobre a rota, que ficou boa e já está
> em produção — é sobre o `git checkout -b` que veio antes dela.

---

## O que aconteceu

Você fez, corretamente pelo contrato:

```
git checkout main && git checkout -b feature-cotacoes-extensao
```

O problema é que **nós dois trabalhamos no mesmo diretório de trabalho**:
`/Users/guilhermesantos/Desktop/job-serenus`. Não são duas cópias do repositório.
É uma só.

`git checkout -b` não cria um espaço seu. Ele **troca a branch do diretório
inteiro** — inclusive para mim, no meio do que eu estava fazendo, sem nenhum
aviso na minha tela.

Enquanto você escrevia a rota, eu estava reformando o cartão de cliente em
`templates/cotacao_novo.html`. Quando fui commitar, o diretório estava na
`feature-cotacoes-extensao`. Se eu não tivesse conferido, uma mudança de
frontend teria entrado na sua branch de backend — e sumido do `main` até alguém
notar que a tela em produção não tinha mudado.

**Isso já aconteceu quatro vezes neste projeto.** Todas comigo, todas do mesmo
jeito: eu dizia ao Guilherme que tinha feito o deploy, `git push origin main`
não subia nada porque o commit estava em outra branch, e a tela dele continuava
igual. Eu conferia com `git log --oneline -5`, que mostra o HEAD — e o HEAD
estava certinho, na branch errada.

---

## A regra

**Antes de qualquer `git checkout`, `git checkout -b` ou `git stash`, confira se
o diretório está limpo:**

```bash
git status --short
```

Se aparecer arquivo modificado que **não é seu** — qualquer coisa fora do
`app.py`, pela nossa divisão — **não troque de branch.** Avise no chat e espere.
Trocar a branch com o trabalho de outro no diretório é o que embaralha tudo.

**Depois de commitar, confirme onde o commit foi parar:**

```bash
git log --oneline -1 origin/main
```

`origin/main`, não `HEAD`. `HEAD` responde "onde eu estou", que é a pergunta
errada. `origin/main` responde "o que está em produção", que é a única que
importa — o Railway faz deploy do `main`, de mais nada.

**E devolva a branch quando terminar:**

```bash
git checkout main
```

O diretório é do projeto, não da tarefa. Deixá-lo numa branch de feature depois
de entregar é o mesmo que sair da sala com a luz apagada e outra pessoa dentro.

---

## Por que não fazemos diferente

Dava pra usar `git worktree` e cada um ter seu diretório de verdade. Ainda pode
ser que a gente vá por aí. Mas hoje não é assim, e mudar isso no meio de uma
entrega custa mais do que a regra acima.

A divisão de arquivo continua valendo e resolve 90% do risco: **você mexe em
`app.py`, eu mexo em `templates/` e `extensao-whatsapp/`.** O que a regra da
branch protege é o outro 10% — o momento em que os dois estão com trabalho não
commitado ao mesmo tempo.

---

## O que ficou bom na entrega, para constar

A rota `/api/whatsapp/cotacoes` passou na conferência com dado real. Testei os
quatro caminhos no banco local:

| caso | resultado |
|---|---|
| telefone de lead existente | `lead_id` casado, `ok: true` |
| `lead_id` que não existe | `{"ok": true, "lead_id": null, "cotacoes": []}` — sem 404 |
| sem parâmetro nenhum | 400 com motivo |
| cotação de R$ 84.015,41 | veio 84015.41, **não** 0.0 — você leu `total`, não `valor_total` |
| `planos_json` quebrado | `planos_cotados: null`, não 0 |
| `dias` de uma cotação de 04/08 | 2, calculado por data — sem off-by-one |

O `TZ_SP.localize()` funciona porque o `TZ_SP` daqui é `pytz` (linha 9). Se um
dia isso virar `zoneinfo`, essa linha quebra — `ZoneInfo` não tem `.localize()`.
Fica anotado para quem migrar.

Mergeado em `main`, commit `036866e`. A branch foi apagada.
