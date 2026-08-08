# Contrato — plugar o Vault no motor de IA

> 07/08/2026. `app.py`, do Antigravity. Nasce do `resumo_para_claude.md` dele.
> O conteúdo do Vault está bom. **O jeito de plugar, como está escrito, não
> funciona em produção** — e a razão é chata, não conceitual.

---

## Antes de tudo: o crédito

Os quatro arquivos estão bem feitos. As regras nascem de falha real e cada uma
diz qual erro ela evita — é o formato certo. E a **ordem dos blocos está certa
para cache**: regra estável primeiro, `memoria_ativa.json` (o que muda) por
último, então o prefixo caro fica em cache e só a ponta é reprocessada. Se a
memória estivesse no começo, cada aprendizado novo invalidaria o prompt inteiro.

O que segue são três defeitos de encaixe, não de conteúdo.

---

## 1. BLOQUEADOR — o Vault não existe no servidor

```
$ git check-ignore -v knowledge/motor-ia/regras_ouro.md
.gitignore:12:knowledge/*    knowledge/motor-ia/regras_ouro.md
```

`knowledge/` é ignorado de propósito: a pasta recebe documento de cliente e
dado de saúde não vai pro repositório (LGPD). Os quatro arquivos existem **só
na máquina do Guilherme**. No Railway não há nenhum deles.

Do jeito descrito, em produção o código ou estoura no `open()`, ou — se o erro
for engolido — manda o prompt **sem regra nenhuma** e segue extraindo. É a pior
forma de falhar: silenciosa, plausível, e pior justamente onde ninguém olha.

**O que fazer:** o Vault sai de `knowledge/` e vai para **`motor-ia/` na raiz**,
rastreada no git. Ele não é documento de cliente — é regra de negócio, pertence
ao código. Não desligue a regra do `.gitignore` para `knowledge/`: ela está
certa e protege outra coisa.

**E a falha tem que ser alta, não baixa:**

```python
# Vault ausente NAO pode virar analise silenciosa sem regra. Se faltar
# arquivo, registre e conte — a extracao sem o Vault e pior que a de ontem,
# e hoje nao ha como saber que ela aconteceu.
if faltando:
    app.logger.error('[IA] Vault incompleto: %s', faltando)
```

---

## 2. Não SOME o Vault ao prompt — MOVA as regras para ele

Isto não estava no resumo e é o que mais custa se passar batido.

O `_CLAUDE_SYSTEM_ANALISE` (app.py, linhas ~15479-15596) já tem **10 KB** de
instrução. E ele **já cobre 4 das 5 Regras de Ouro**: o caso da conta de água,
o vazio-em-vez-de-chute, a fusão frente e verso, e o `valor_pago_hoje` versus
preço da cotação. Conferi no arquivo, não deduzi.

Concatenar o Vault por cima disso faz três estragos ao mesmo tempo:

1. **Dobra o custo** de um pedaço que já é grande, repetindo o que já foi dito.
2. **Cria duas fontes para a mesma regra.** Daqui a três meses alguém ajusta a
   regra no `regras_ouro.md`, o texto do `app.py` continua dizendo o contrário,
   e o modelo recebe as duas. Instrução contraditória não dá erro — dá
   resultado pior, sem explicação.
3. **Mata a promessa do Vault.** A graça era "edito o markdown e a IA muda".
   Não muda, se a versão antiga continua embutida no Python.

**O que fazer:** para cada regra que já está no `_CLAUDE_SYSTEM_ANALISE` e
também no Vault, **apague a do `app.py`**. O Python fica com o papel dele
(quem é o motor, formato de saída, contexto da chamada) e o Vault com o dele
(regra de negócio). Uma regra, um lugar.

O que o Vault traz de **novo** e não existe hoje no prompt — mantenha inteiro:

- o dicionário semântico de saúde (TEA, ABA, "toma remédio contínuo", …);
- a regra do pet fora da contagem de vidas;
- a regra do verbo ("fugindo da Unimed" é objeção, não interesse);
- o `mapa_dados.md`, que dá ao modelo o **impacto** de cada campo.

---

## 3. O self-check é promessa; parte dele já pode ser garantia

A chamada já usa `output_config` com `json_schema` — a API recusa resposta fora
do formato e o modelo refaz. Isso é validação de verdade. O checklist do
resumo, olhado com isso em mente, se divide:

| item do checklist | onde deve morar |
|---|---|
| "deixei o array de idades vazio?" | **schema** — sem default, sem preenchimento |
| "`valor_pago_hoje` é o plano antigo?" | **Python**, depois da resposta |
| "extraí de uma conta de luz?" | prompt (é julgamento) |
| "fundi frente e verso?" | prompt (é julgamento) |
| "conflita com a memória ativa?" | prompt (é julgamento) |

**Mantenha o checklist no prompt** — ele ajuda de verdade. Mas duplique em
código os dois que são verificáveis. Uma checagem que só existe no prompt não
deixa rastro: quando falhar, e vai falhar, não há log dizendo qual filtro
passou batido. Uma que roda em Python devolve motivo e conta.

Sugestão concreta para o `valor_pago_hoje`: se o valor devolvido for igual a
algum preço da cotação daquele lead, **zere e registre**. É o erro histórico
descrito no próprio `regras_ouro.md`, e ele é detectável sem julgamento nenhum.

---

## 4. `memoria_ativa.json` precisa de teto e de data

Hoje tem 2 aprendizados e 1 KB. Do jeito que está descrito, só cresce. Em seis
meses ela é o maior bloco do prompt e os erros de fevereiro competem com os de
agosto pela atenção do modelo.

- **Campo `data`** em cada aprendizado (falta hoje).
- **Teto de 40 entradas**, as mais antigas caem.
- Se um erro derrubado voltar a acontecer, ele entra de novo — e essa
  reentrada é o sinal de que aquele aprendizado não pegou. Vale um log.

---

## 5. Uma linha do resumo que precisa mudar

> *"instruir o modelo (Claude, OpenAI, Gemini)"*

Não. **Análise de conversa e documento de cliente é sempre pela API oficial da
Anthropic.** É regra do Guilherme e aqui trata de dado de saúde — condição
pré-existente, laudo, CPF. Deixar "ou Gemini" escrito num guia de operação é
exatamente como isso vira prática daqui a seis meses, quando alguém quiser
economizar e o documento disser que pode.

---

## 6. Antes de entregar

```bash
git status --short          # arquivo que não é seu? NÃO troque de branch
.venv/bin/python scripts/auditar.py <sua-branch>
.venv/bin/python scripts/checar_contrato.py
python3 -c "import ast; ast.parse(open('app.py').read())"
git log --oneline -1 origin/main
```

**Teste 1 — o Vault chega em produção.** Depois do deploy, uma extração real
tem que registrar no log que carregou os 4 arquivos. Rodar local não prova
nada: o defeito é justamente que local funciona.

**Teste 2 — Vault ausente não passa calado.** Renomeie um arquivo e rode. Tem
que aparecer `[IA] Vault incompleto`. Se a análise sair normal e silenciosa, a
proteção não existe.

**Teste 3 — a regra nova pega.** Uma conversa com "quero incluir meu pug"
tem que devolver `vidas: 1`. É o primeiro aprendizado da memória ativa e hoje
não está em lugar nenhum do prompt — se continuar dando 2, o Vault não está
sendo lido de verdade.

**Teste 4 — não duplicou.** Depois de mover as regras, o
`_CLAUDE_SYSTEM_ANALISE` tem que ter **encolhido**. Se ele continuar do mesmo
tamanho e o Vault entrar por cima, o item 2 não foi feito.

Um commit para mover o Vault, um para a injeção, um para a limpeza do prompt
antigo. **A limpeza é a que precisa poder voltar sozinha** — é a que muda o que
o modelo lê.
