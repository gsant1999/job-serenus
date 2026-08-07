# Contrato — Cotações salvas precisa dizer DE QUEM, DE ONDE e DE QUE TIPO

> 07/08/2026. `app.py`, do Antigravity. Uma rota, quatro campos.
>
> A tela é minha (`templates/cotacao_novo.html`, aba `#salvas`) e eu construo o
> agrupamento e os filtros. Só que ela não pode agrupar pelo que não recebe.

---

## O problema, nas palavras do Guilherme

> "precisamos organizar as cotações por consultor, por cliente (sistema de
> pastas e subpastas) e podemos colocar filtros: se eu cotei para Campinas e
> São Paulo, se eu cotei PF, PME e Adesão. **Não quero ficar abrindo todas as
> cotações para saber do que se trata.**"

Hoje a lista é uma pilha plana. Com 43 cotações já dá trabalho; com 8
consultores cotando pelo WhatsApp vai a centenas em semanas, e a única forma de
saber o que é cada uma é abrindo uma por uma.

---

## O que a rota devolve hoje

`GET /cotacao/bloco/salvas` → por cotação:

```
id, titulo, cliente_nome, cliente_telefone, cliente_email,
token, criado_em, planos_cotados, lead_id, lead_nome, valor_total
```

**Falta tudo que serve pra agrupar e filtrar.**

---

## O que precisa entrar

| campo | de onde | por quê |
|---|---|---|
| `corretor_id` | coluna `cotacao_salva.corretor_id` | pasta de primeiro nível: por consultor |
| `corretor_nome` | coluna `corretor_nome` (já existe) | rótulo da pasta |
| `cidade` | coluna `cidade` | filtro |
| `modalidade` | ver abaixo | filtro |

### `modalidade` não é coluna — é derivada

`cotacao_salva` não tem essa coluna. O valor existe **dentro de cada plano** no
`planos_json` (chave `modalidade`, gravada por `_viva_para_apresentacao` a partir
de `_tipo`).

Uma cotação pode ter planos de tipos diferentes — o consultor compara PF e PME
na mesma proposta de propósito. Então **devolva a lista dos tipos distintos**,
não uma string:

```json
"modalidades": ["PME", "Adesão"]
```

**Não invente quando o JSON não disser.** Lista vazia é resposta honesta: a tela
mostra "tipo não registrado" e o filtro não esconde a cotação por engano. Uma
cotação some da lista por causa de um palpite errado e o consultor jura que
perdeu o trabalho.

**Cuidado com custo:** são até 500 cotações e o `planos_json` é grande. Fazer
`json.loads` de todas a cada abertura da aba é o tipo de coisa que fica lenta em
seis meses sem ninguém notar quando. Duas saídas, escolha e me diga qual:

- **(a)** derivar no SELECT, aceitando o custo enquanto o volume é pequeno, e
  **medir**: logue o tempo da rota quando passar de 300ms;
- **(b)** coluna `modalidades TEXT` em `cotacao_salva`, preenchida nas duas
  rotas que gravam (`/cotacao/viva/salvar` e `/api/whatsapp/cotacao/salvar`),
  com as antigas ficando nulas — **sem backfill que chute**, mesma regra da
  faixa de vidas.

**Prefiro a (b)**, pelo mesmo motivo da cidade: é atributo da cotação, não de um
plano dela, e guardar onde se lê evita reprocessar JSON pra sempre.

---

## Filtros no servidor ou na tela?

**Na tela.** Não crie parâmetros de filtro na rota.

A lista já vem inteira (teto de 500) e filtrar em JavaScript é instantâneo, sem
ida ao servidor a cada clique. Se um dia passar de 500, aí sim a paginação e o
filtro vão pro servidor juntos — antes disso é complexidade sem problema.

O que a rota precisa é **devolver o dado**, não filtrar.

---

## O que NÃO fazer

- **Não some com cotação de outro consultor pro admin.** A regra atual já está
  certa (admin vê tudo, consultor vê a sua) e é o que permite a pasta por
  consultor existir. Não mexer.
- **Não derive cidade do título.** O título é texto livre montado pra humano;
  o dia em que alguém mudar o formato, o filtro passa a mentir. Cidade vem da
  coluna, e cotação antiga sem cidade aparece em "sem cidade" — que é a verdade.
- **Nunca `str(e)` no campo `erro`.**

---

## Antes de entregar

```bash
git status --short          # arquivo que não é seu? NÃO troque de branch
.venv/bin/python scripts/auditar.py <sua-branch>
python3 -c "import ast; ast.parse(open('app.py').read())"
git log --oneline -1 origin/main
```

**Aviso novo, e importante:** o Chrome do Guilherme carrega a extensão
**direto de `extensao-whatsapp/` no diretório do repositório**. Quando o
diretório fica numa branch antiga, a extensão que ele usa **volta de versão
sozinha** — já aconteceu (3.42.0 virou 3.41.0 e ele viu "não atualiza"). Ao
terminar, volte pra `main`.

Um commit por assunto.
