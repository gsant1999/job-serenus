# Contrato — salvar a cotação feita dentro do WhatsApp

> 06/08/2026. `app.py`, então é do Antigravity. Uma rota.
>
> A cotação inline já está no ar (extensão 3.34.0): o consultor cota dentro da
> conversa, sem trocar de aba. O que falta é ela **virar registro no JOB**.

---

## O buraco

Hoje o consultor cota na conversa, vê os preços e manda o texto pro cliente.
Mas aquilo **não existe em lugar nenhum**: não aparece em Cotações salvas, não
gera link `/c/<token>`, não conta na produção e não volta como conversão pro
Meta nem pro Google.

Ou seja: a cotação mais rápida do sistema é a única que não é registrada. É o
contrário do que o resto do JOB faz.

---

> **CORRIGIDO EM 07/08/2026 — o formato de `planos` abaixo estava ERRADO.**
> Eu descrevi um plano achatado (`{"nome": ..., "operadora": "Amil"}`). O
> servidor lê `p['plano']['nome']`, `p['operadora']['nome']` e `f['unitario']`,
> porque é o formato que vem do Painel e que o resto do sistema já usa. Mandar
> achatado quebra com `'str' object has no attribute 'get'`.
> O formato certo está em `handoff/contrato-dias-negativo-e-cidade-reabrir.md`
> e já é o que a extensão manda desde a 3.36.0.

## A rota

```
POST /api/whatsapp/cotacao/salvar
     methods=['POST', 'OPTIONS']
     _wa_auth_ok() + _wa_cors()      (mesmo par de /api/whatsapp/cotacoes)

body: { "usuario_id": 7,                     <- quem cotou (popup da extensão)
        "lead_id": 561,                      <- OBRIGATÓRIO, ver abaixo
        "telefone": "5519993334444",         <- fallback se lead_id não vier
        "titulo": "Beatriz · Campinas - SP · Adesão",
        "cidade": "Campinas - SP",
        "modalidade": "Adesão",
        "vidas": [ {"faixa": "00-18", "quantidade": 1},
                   {"faixa": "49-53", "quantidade": 1} ],
        "planos": [ {"nome": "Amil S380 Nacional", "operadora": "Amil",
                     "acomodacao": "Enfermaria", "coparticipacao": "Sem",
                     "total": 1247.90, "faixas": [...]} ] }

-> { "ok": true, "id": 44, "token": "a1b2c3d4",
     "url": "https://job-serenus-production.up.railway.app/c/a1b2c3d4" }
```

**Reaproveitar `_cotacao_viva_gravar(conn, d, usuario_id, origem)`**, que já
existe e é o que `/cotacao/viva/salvar` usa. A diferença é só de porta de
entrada:

| | `/cotacao/viva/salvar` | esta rota |
|---|---|---|
| quem é o corretor | `session['user_id']` | `usuario_id` do corpo |
| autenticação | sessão do navegador | chave da extensão |
| origem | `'site'` | `'whatsapp'` |

Passar `origem='whatsapp'` importa: daqui a um mês a pergunta "cotar no
WhatsApp vende mais que cotar na tela?" só tem resposta se a origem estiver
gravada desde o primeiro registro. Depois não dá pra reconstruir.

---

## A regra que não pode afrouxar

**Sem `lead_id` a cotação não é salva.** Devolver
`{"ok": false, "erro": "sem_lead"}` com 400, igual `/cotacao/viva/salvar` já faz.

Isso não é burocracia: sem o vínculo, a venda não volta como conversão pro Meta
nem pro Google, e o funil não sabe que aquele lead recebeu proposta. Foi decisão
firme do Guilherme e vale aqui igual: **a extensão é justamente onde a tentação
de pular o cadastro é maior**, porque o consultor está no meio de uma conversa.

Se vier só `telefone`, usar `_buscar_lead_por_telefone(conn, tel_norm)` — o
mesmo que a `/api/whatsapp/cotacoes` usa. Se não casar com lead nenhum,
`{"ok": false, "erro": "sem_lead"}`: o telefone é de quem está na conversa, e
criar lead calado por causa de um POST é gente entrando no CRM sem ninguém saber.

---

## `usuario_id`

Vem do popup da extensão, então é **entrada externa**: confirmar que existe e
está ativo antes de gravar como corretor da cotação. Sem essa checagem, um
`usuario_id` errado atribui a venda ao consultor errado — e comissão atribuída
errada é discussão com pessoa, não com sistema.

Se não existir: `{"ok": false, "erro": "usuario_invalido"}`, 400.

---

## Falha

Mesma regra do resto do módulo: consulta que falha **não devolve sucesso vazio**.
`{"ok": false, "erro": "<texto humano>"}`, nunca `str(e)` — o log guarda o texto
inteiro. A extensão mostra o erro e mantém os preços na tela pro consultor não
perder o trabalho.

---

## Antes de entregar

```bash
git status --short          # arquivo que não é seu? NÃO troque de branch
.venv/bin/python scripts/auditar.py <sua-branch>
python3 -c "import ast; ast.parse(open('app.py').read())"
git log --oneline -1 origin/main
```

Ver `handoff/regra-branch-diretorio-compartilhado.md`. Branch a partir de `main`,
só `app.py`, sem merge direto.

Armadilhas do módulo: `close_db(conn)` mata o que vem depois; a coluna é `total`,
**não** `valor_total`; erro em transação PG aborta o que veio antes.
