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

## 9. O ÓBVIO SEMPRE TEM QUE SER DITO

Regra do Guilherme, 08/08/2026.

Se a tela tem uma condição — um botão que só existe depois de um passo, um
campo que só aparece pra certo perfil, um limite, uma espera — **a tela diz
isso, com todas as letras, antes de a pessoa esbarrar.**

O caso que criou a regra: na cotação da extensão, os botões de link, imagem,
legenda e apresentação só nascem depois de "Salvar no JOB". Isso está certo —
sem cotação salva não existe link pra mandar. Mas a tela não avisava, e ele
passou tempo procurando botão que não existia ainda. O comportamento estava
certo; a comunicação estava faltando.

"Está claro pra quem construiu" não conta. **Quem construiu nunca é o usuário.**

Vale em tudo que você entrega: rota que recusa, campo obrigatório, migração que
demora, limite por dia, resultado vazio. Estado sem explicação é defeito.
Mensagem de erro diz o que houve **e o que fazer** — não só que houve.

## 9-A. O ÍNDICE É A FONTE — `handoff/INDICE.md`

Antes de abrir qualquer contrato, abra o `INDICE.md`. Documento que não estiver
marcado **ATIVO** ali **não é ordem de trabalho**, por mais que pareça.

Em 08/08 você procurou "Lote" e "API" no repositório, achou `docs/api-cotacao.md`
— documento de julho, com a autenticação velha — e construiu 4 rotas a partir
dele. O contrato aprovado estava em `handoff/`, no meio de outros 22 arquivos
sem índice. A culpa foi da falta de índice, não sua. Agora existe.

Achou um documento que parece encaixar e não está no índice? **Pergunte na
`conversa.md` antes de codar.**

## 10. ANDE SOZINHO — quando perguntar e quando não

Regra do Guilherme, 08/08/2026. Ele não quer ser consultado a cada passo.
**Você tem contrato escrito: contrato aprovado É a autorização.**

### Ande sem perguntar

- Tudo que já está num contrato em `handoff/` aprovado pelo Guilherme
- Escolher nome de função, de variável, de tabela auxiliar, de índice
- Como estruturar a consulta, onde colocar o helper, como organizar o código
- Escrever e rodar teste, e **corrigir o que o teste apontar**
- Migração de coluna que o próprio contrato pede
- Refazer o seu próprio trabalho quando você mesmo achar defeito nele
- Commit na **sua branch**, quantos quiser

Não peça confirmação de nada disso. Se está no contrato, **faça e avise
depois** na `conversa.md`, com o que ficou pronto e o que você testou.

### PARE e escreva na conversa

- O contrato não cobre o caso, ou cobre de um jeito que você acha errado
- Precisa de algo em `extensao-whatsapp/` (seção 2 — nunca toca)
- Precisa mudar tabela ou rota que **outro contrato** já usa
- Dado de cliente saindo do sistema
- Dinheiro, comissão, preço mostrado a cliente
- Escolha que prende o sistema por muito tempo (modelo de IA, formato de
  token, esquema que vai virar dependência)
- Qualquer coisa indo pra `main` ou pra produção

### O que fazer quando parar

**Não fique esperando de braços cruzados.** Escreva a pergunta na
`conversa.md`, **com a sua recomendação e o motivo** — não pergunta aberta — e
**vá trabalhar em outra parte do contrato** enquanto isso. Quase sempre há
lote independente esperando.

Pergunta boa: *"Recomendo X porque Y; a alternativa é Z, que custa W.
Enquanto isso sigo no Lote 2."*
Pergunta ruim: *"Como deseja prosseguir?"*

### Fim de tarefa

Terminou um lote: **teste, escreva na conversa o que fez e o que testou, e
comece o próximo lote do contrato.** Só avise. Não peça licença.

## 11. Se estiver em dúvida

Escreva na `conversa.md` e espere. Um dia parado custa menos que uma hora de
extensão quebrada no meio do expediente — e essa conta já foi paga hoje.
