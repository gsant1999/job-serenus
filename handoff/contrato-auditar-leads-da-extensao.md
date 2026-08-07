# Contrato — auditar os leads que a extensão criou sozinha

> 07/08/2026. `app.py`, do Antigravity. Uma rota de leitura e uma de ação.
> A tela é minha e eu construo.

---

## O número que motiva isto

Em produção, `crm_leads` por origem:

```
Facebook              4692
Google                 653
WhatsApp (extensão)    230   <-- criados sozinhos, nunca auditados
Google (Página1)       154
manual                  45
```

**230 leads entraram sem ninguém olhar.** E o consultor fala com amigo, família
e fornecedor no mesmo WhatsApp — parte desses 230 não é cliente e nunca vai ser.

Cada um deles hoje: entra no funil, entra na conta de "leads do mês", pode
receber disparo, e polui a medição de conversão. Um CRM com gente que não é
cliente mede errado tudo o que depende de contagem de lead.

---

## O que já existe e NÃO deve ser refeito

- **O bloqueio funciona.** `POST /api/whatsapp/ignorar` marca a conversa como
  pessoal: o JOB para de ler e nunca mais cria lead dela. A extensão já expõe
  isso, e o botão acabou de ficar visível (3.47.0).
- **A notificação existe** ("Lead criado pela extensão de WhatsApp").

O que falta é **ver os 230 de uma vez**. Auditar um por um, abrindo conversa
por conversa no WhatsApp, ninguém faz — e a prova é que ninguém fez.

---

## 1. A rota de leitura

```
GET /crm/leads-da-extensao?de=2026-08-01&ate=2026-08-07&consultor=7
    @login_required

-> { "ok": true,
     "leads": [ { "id": 561, "nome": "Suzana (MULTI)",
                  "telefone": "(19) 99805-8837",
                  "criado_em": "2026-08-07T09:12:00-03:00",
                  "consultor_id": 7, "consultor_nome": "Beatriz",
                  "etapa": "Novo", "tem_proposta": false,
                  "ultima_mensagem": "2026-08-06T22:10:00-03:00" } ],
     "consultores": [ {"id": 7, "nome": "Beatriz"} ] }
```

- **Filtro `origem = 'WhatsApp (extensão)'`** — é a marca que a criação
  automática já grava. Confira a string exata no banco antes de escrever
  (`SELECT DISTINCT origem FROM crm_leads`), porque acento e parênteses contam.
- `de`/`ate` por **data**, não datetime. Sem os dois, devolva os últimos 30 dias.
- `consultor` opcional. A lista `consultores` vem junto pra tela montar o filtro
  sem uma segunda chamada.
- **Teto de 500** e ordem do mais novo pro mais antigo.

**`tem_proposta` é o campo que evita erro caro:** lead que já virou proposta
**não é** candidato a "não é lead". Marcar como pessoal quem já está em
negociação apagaria trabalho de verdade. A tela vai usar isso pra bloquear a
ação, mas o servidor deve mandar o dado — a tela não pode adivinhar.

---

## 2. A rota de ação

A extensão já bloqueia por conversa. A auditoria acontece no site, onde não há
chave de extensão — então precisa de um par com sessão:

```
POST /crm/lead/<int:lid>/nao-e-lead     @login_required
     -> { "ok": true }
```

Deve fazer **exatamente o mesmo** que `/api/whatsapp/ignorar` faz hoje, para o
telefone daquele lead. **Reaproveite a mesma função interna** — duas
implementações do mesmo bloqueio divergem no primeiro ajuste, e aí a extensão
bloqueia e o site não (ou o contrário), sem ninguém entender por quê.

**Recuse quando o lead já tiver proposta**, com
`{"ok": false, "erro": "lead_com_proposta"}`. A trava é do servidor, não da
tela: a tela pode estar desatualizada, o servidor não.

---

## 2b. TRÊS PORTAS pra mesma tela — e um contador

Decisão do Guilherme: a auditoria precisa ser encontrável de três lugares.
A tela é uma só; o que muda é como se chega nela.

1. **Item próprio no menu lateral**, com o número de leads esperando auditoria
   ao lado. **Some quando a fila zera** — item de menu que vive marcando zero
   vira ruído e some da atenção justamente quando volta a ter algo.
2. **Dentro do CRM**, onde os leads moram.
3. **Pelo sino**: a notificação "Lead criado pela extensão de WhatsApp" já
   existe e hoje não leva a lugar nenhum útil. Ela deve apontar pra auditoria
   **daquele dia**.

Pro contador, o servidor precisa de um número barato — não a lista inteira:

```
GET /crm/leads-da-extensao/pendentes  ->  {"ok": true, "n": 230}
```

**"Pendente" precisa de definição, e ela é sua decisão de modelagem:** um lead
auditado e aprovado não pode continuar contando pra sempre. Sugiro uma coluna
`auditado_em TIMESTAMP` em `crm_leads` — nula = nunca auditado. Aprovar grava a
data; "não é lead" bloqueia (e sai da fila por consequência). Sem isso, o
contador nasce em 230 e nunca desce, e a pessoa aprende a ignorá-lo.

**Então a rota de ação são duas, não uma:**

```
POST /crm/lead/<int:lid>/nao-e-lead     -> bloqueia (ver abaixo)
POST /crm/lead/<int:lid>/e-lead         -> só grava auditado_em
```

`e-lead` não muda nada no lead além da marca de auditoria. **Não mexa em etapa,
responsável ou status** — quem aprova está dizendo "isto é cliente de verdade",
não "mude o funil dele".

---

## 3. O que NÃO fazer

- **Não apague o lead.** Marcar como pessoal é reversível e auditável; `DELETE`
  não. A conversa do extensão já diz "dá pra desfazer em Leads excluídos".
- **Não crie uma tabela nova de "ignorados".** Já existe o mecanismo do
  `/api/whatsapp/ignorar` — use.
- **Não filtre por nome** ("parece nome de parente"). Chute sobre pessoa é
  exatamente o que a auditoria humana existe pra evitar.
- **Nunca `str(e)` no campo `erro`.**

---

## 4. Antes de entregar

```bash
git status --short          # arquivo que não é seu? NÃO troque de branch
.venv/bin/python scripts/auditar.py <sua-branch>
.venv/bin/python scripts/checar_contrato.py
python3 -c "import ast; ast.parse(open('app.py').read())"
git log --oneline -1 origin/main
```

**Teste que não pode faltar:** um lead com proposta ligada tem que ser recusado
pelo POST, mesmo forçando a chamada na mão. Se passar, a trava não existe.

**Lembrete que já custou confusão:** o Chrome carrega a extensão **direto de
`extensao-whatsapp/`** no diretório do repositório. Diretório em branch antiga =
o consultor volta de versão sem saber. Termine em `main`.

Um commit por rota.
