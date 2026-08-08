# ESCOPO — Antigravity

> Definido pelo Guilherme em 07/08/2026, depois de a extensão passar horas
> quebrada em produção.
>
> **Isto não é sugestão. É o limite do que você pode tocar.**
> Fora daqui, você não edita: você escreve na `handoff/conversa.md` e espera.

---

## O que aconteceu, para não se repetir

No commit `4e84b04` você editou `extensao-whatsapp/wpp-bridge.js` — arquivo
que não era da sua tarefa — e apagou a linha `} catch (e) { ... }` de um bloco
`try`.

`try` sem `catch` não passa no analisador do JavaScript. O arquivo **não
executa**. E esse arquivo é a ponte que sabe qual conversa está aberta, quem é
o contato e por onde todo envio passa.

Consequência: **a extensão inteira ficou morta**. A barra abria, os menus
apareciam, e nada funcionava. O Guilherme ficou horas nisso, com clientes
esperando, e ainda levou duas correções erradas antes de alguém desconfiar do
óbvio. O Chrome não avisa esse tipo de erro em lugar nenhum — o arquivo some em
silêncio.

Não foi má-fé. Foi mexer fora do escopo e não conferir. As duas coisas param
aqui.

---

## 1. O QUE É SEU

**`app.py`** — inteiro. Rotas, migrações, consultas, regras de negócio no
servidor. É seu, e é onde você deve estar.

**`templates/`** — apenas as telas que a sua própria tarefa criar. Tela que já
existe e é de outro assunto, não.

**`scripts/`** — scripts de servidor e de ingestão que a sua tarefa pedir.

**`motor-ia/`** — o Vault. É seu.

**`handoff/conversa.md`** — sempre. Escreva antes e depois de trabalhar.

---

## 2. O QUE VOCÊ NUNCA TOCA

**`extensao-whatsapp/` — a pasta inteira.** Nenhum arquivo, nenhuma linha,
nem para "só acrescentar", nem para "é um ajuste pequeno".

Ela tem três motivos para ser intocável:

1. **O Chrome carrega direto dessa pasta.** O que você salva ali está rodando
   na máquina do Guilherme no segundo seguinte, sem deploy, sem revisão.
2. **Erro de sintaxe ali é invisível.** Não há tela vermelha, não há log. Só
   para de funcionar.
3. **Ela é a ferramenta de trabalho de oito pessoas** durante o expediente.

Se a sua tarefa precisar de algo na extensão — um campo novo, uma chamada nova,
um botão — **escreva na `conversa.md` o que precisa e pare.** O Claude faz.
É rápido: descreva a rota, o formato do payload e o que a tela deve mostrar.

**Também nunca:**

- `templates/` de telas que não são da sua tarefa
- `.gitignore`
- `dist/`, `logos/`, `tabelas-operadoras/`
- `scripts/extrair_*.py`, `scripts/casar_catalogo.py`, `scripts/organizar_tabelas.py`
- qualquer arquivo que apareça no `git status` e não seja seu

---

## 3. ANTES DE CADA COMMIT — sem exceção

```bash
git status --short                    # arquivo que não é seu? PARE
python3 -c "import ast; ast.parse(open('app.py').read())"
./scripts/checar_extensao.sh          # mesmo sem ter tocado nela
.venv/bin/python scripts/checar_contrato.py
grep -n "get_db(" app.py              # tem que voltar VAZIO
```

O `checar_extensao.sh` é obrigatório **mesmo quando você jura que não encostou
na extensão** — porque desta vez você também jurava.

---

## 4. ROTA NOVA SÓ EXISTE DEPOIS DE SER CHAMADA

Você já entregou **duas rotas mortas**: a de importação e a do Caça-Documentos,
as duas com `get_db()`, que não existe neste projeto. O helper é `db()`.

Teste que não bate na rota **não prova que a rota existe**. Antes de dizer
"entregue":

- abra a rota no navegador, ou
- chame com `app.test_client()` e confira o código HTTP.

Se você não viu a resposta, ela não foi testada.

---

## 5. ONDE VOCÊ TRABALHA

```
~/Desktop/JOB-antigravity     branch antigravity/trabalho
```

**Nunca** em `~/Desktop/job-serenus`. Aquela pasta fica sempre em `main` porque
é de onde o Chrome carrega a extensão. Se você trocar a branch dela, o
Guilherme passa a rodar a sua versão em andamento sem saber.

Termine em `main`? Não. **Termine na sua branch e avise na conversa.** Quem
junta em `main` é o Claude, depois de auditar.

---

## 6. O QUE NUNCA É DECISÃO SUA

- Dado de cliente saindo do sistema — para onde vai, o que vai junto
- Qualquer coisa que envolva dinheiro, comissão ou preço mostrado a cliente
- O que entra em produção e quando
- Prioridade: o que se faz e em que ordem

Achou que algo é urgente? **Escreva na conversa que acha, e pare.** Quem decide
é o Guilherme.

---

## 7. AUDITORIA CRUZADA — vale nos dois sentidos

Decisão do Guilherme em 08/08, depois de um dia em que cada um achou defeito
do outro.

**Como funciona:** um escreve, o outro audita antes de ir pro ar. Não é
desconfiança — é que dois pares de olhos independentes pegam o que um par não
pega. Em 08/08 a auditoria do login encontrou 13 defeitos críticos que os
testes do autor não pegaram, incluindo um que só aparece em Postgres e um que
deixava qualquer máquina derrubar os oito consultores.

**E vale para o Claude também.** No mesmo dia você achou dois defeitos dele que
eram reais e importantes:
- o `_wa_auth_ok()` que só olhava `X-Extension-Key` — quem fizesse login
  passaria a mandar só o token e seria recusado pelas ~50 rotas antigas;
- o `try/except: pass` silencioso na migração, que no Postgres deixa a
  transação abortada e contamina tudo depois.

Nos dois casos você estava certo e o conserto entrou. **Aponte sempre.** Achou
erro no que o Claude escreveu — extensão, template, contrato, o que for —
escreva aqui na conversa, com linha e cenário. Contrato mal escrito também é
erro: dois defeitos de hoje nasceram de contrato meu impreciso (a faixa
`"59 ou +"` e o formato do retorno do login).

**O que NÃO muda:** quem acha o erro **aponta, não corrige sozinho** fora do
próprio escopo. Você não mexe em `extensao-whatsapp/`; o Claude não reescreve o
`app.py` por preferência de formato. Quem é dono do arquivo faz a correção.

**E nada vai pro ar sem o Guilherme.** Concordar entre vocês dois não é
aprovação — é recomendação. A palavra final é dele, sempre.

## 8. Errar é esperado; repetir o mesmo erro não

Quando um de vocês erra, o outro escreve na conversa **o que era, por que
passou despercebido, e o que evita a próxima**. Não é cobrança — é a única
forma de o segundo mês ser melhor que o primeiro.

Padrão observado até aqui, e vale como alerta permanente: **os erros são de
BORDA, não de lógica.** O nome do helper deste projeto (`db()` e não
`get_db()`), a lista de migração, o fechamento de bloco, `lastrowid` no
Postgres. O código dentro da função costuma estar certo. Por isso as checagens
mecânicas antes do commit valem mais que releitura.

## 9. Se estiver em dúvida

Escreva na `conversa.md` e espere. Um dia parado custa menos que uma hora de
extensão quebrada no meio do expediente — e essa conta já foi paga hoje.
