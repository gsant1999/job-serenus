# Inteligência de captura de documentos — extraída da Bene

Este documento explica, em detalhe, como o sistema `propostas-saude-beneficencia/`
lê os documentos que o cliente manda e transforma isso em dado estruturado. É a
base para levar a mesma capacidade para a extensão do JOB.

Fontes: `leitor.py` (motor de leitura) + trecho de `templates/index.html` (distribuição
no navegador). Ambos no repo `job-serenus`.

---

## A ideia central: dividir o trabalho entre IA e regra de negócio

O ponto mais importante do desenho, e o que faz o sistema ser confiável, é este:
**a IA nunca decide quem é quem no negócio — ela só responde duas perguntas que
exigem olhar o papel.**

> "Que documento é este?" e "De quem é?"

Quem é titular, quem é dependente, quem é o dono do CNPJ — isso o **sistema já
sabe**, porque o consultor marcou isso na tela antes de soltar os documentos. A
distribuição final (este RG vai no campo "documento do titular") é feita em
**código determinístico**, casando o nome que a IA leu com as pessoas que já
existem no cadastro. A IA nunca decide regra de negócio da operadora.

Essa separação é o que evita que um erro de "criatividade" do modelo vire um erro
de negócio. Se a IA errar a classificação de um documento, o pior caso é o
documento cair no lugar errado — nunca o sistema inventa uma regra que não existe.

---

## Passo 1 — Preparar as imagens (antes de gastar com IA)

Cada arquivo que o usuário solta pode ser foto (JPG/PNG) ou PDF.

- **Foto**: reduzida para no máximo 1568px no lado maior. Acima disso o modelo de
  visão não ganha precisão — só custa mais. Convertida para JPEG qualidade 85.
  Corrige rotação EXIF (foto de celular vem com rotação embutida no metadado, não
  no pixel).
- **PDF**: renderiza só as **2 primeiras páginas** como imagem. A primeira já diz
  o que o documento é; a segunda cobre frente/verso de identidade. Um contrato
  social de 10 páginas não precisa mandar todas — só encareceria sem mudar a
  classificação.
- **Teto de 24 imagens por leitura**: evita que alguém solte a pasta errada (500
  fotos) e gere uma conta inesperada num clique.
- **Distribuição em rodadas**: se há muitos arquivos, o sistema pega a 1ª imagem de
  cada arquivo, depois a 2ª de cada, etc., em vez de esgotar o teto nas primeiras
  páginas de um PDF gordo. Sem isso, um contrato social de 10 páginas no início da
  fila comeria o teto inteiro e os documentos do fim ficariam invisíveis para a IA.

## Passo 2 — Uma chamada, duas tarefas, saída estruturada

Todas as imagens preparadas vão numa **única chamada** ao modelo (Claude Haiku
4.5), cada uma precedida por um marcador de texto `ARQUIVO n: nome_do_arquivo`.
Isso deixa claro para o modelo quais imagens pertencem ao mesmo documento (frente
e verso do mesmo RG, por exemplo).

A resposta é forçada a bater num **schema JSON** (`output_config.format:
json_schema`) — não é "peça para responder em JSON", é uma garantia estrutural da
API. Isso elimina o parsing frágil de texto livre.

O schema pede duas coisas em paralelo:

**a) Classificação por arquivo** (`arquivos[]`): para cada arquivo, um tipo (de
uma lista fechada — identidade, cartão CNPJ, contrato social, comprovante de
endereço, certidão de casamento, união estável, certidão de nascimento, holerite,
contrato de estágio, carteira de trabalho, ou "outro"), de quem é o documento (nome
completo), e um nível de **certeza** (alta/média/baixa). Certeza baixa é
instrução explícita no prompt — "prefira dizer que não tem certeza a chutar".

**b) Extração de dados de pessoa** (`pessoas[]`): nome, CPF, RG, nascimento, mãe,
pai, sexo — só dos documentos de identidade e certidões. Regras explícitas no
prompt:
- Duas imagens do mesmo documento (frente/verso) = uma pessoa só, não duas.
- A mesma pessoa em documentos diferentes (RG e CNH) = os dados se somam, não
  duplicam.
- Data é sempre a de **nascimento**, nunca emissão/validade — erro comum de OCR
  ingênuo.
- **Nunca chuta dígito de CPF ou RG.** Se não conseguir ler, deixa vazio e escreve
  em `observacoes` o quê e de quem. Esta é a regra de segurança mais importante do
  prompt: um dígito errado faz a operadora recusar a proposta inteira, e isso é
  muito pior que um campo vazio que o humano preenche.

Junto: dados da empresa (CNPJ do cartão) e endereço (do comprovante), se existirem
nos arquivos enviados.

## Passo 3 — Limpeza da resposta antes de confiar nela

O código nunca aceita a resposta do modelo cegamente:

- Se o modelo devolver um índice de arquivo que não existe ou duplicado, é
  descartado.
- Se um arquivo **não foi classificado** (por exemplo, ficou de fora por causa do
  teto de 24 imagens), ele não desaparece da tela — entra como "outro"/certeza
  baixa, para o humano resolver na mão. Nunca deixa um arquivo sumir silenciosamente.
- Se nem todos os arquivos couberam no teto, isso vira uma observação visível
  ("só couberam X dos Y arquivos").

## Passo 4 — Distribuição automática (isto roda no navegador, não na IA)

Esta é a parte que "fecha o círculo" e é, na prática, a peça mais valiosa para
reaproveitar. Depois que a IA devolve `{tipo, pessoa}` por arquivo, o **JavaScript
da tela** casa isso com o cadastro:

- `normNome()`: normaliza nome (remove acento, maiúsculas, só letras) para
  comparação tolerante.
- `mesmaPessoa(a, b)`: nome de documento raramente bate caractere a caractere com o
  que foi digitado (abreviação, nome do meio faltando). A regra usada: **primeiro
  e último "sobrenome" iguais já conta como a mesma pessoa** — sem exigir bater
  tudo. Isso resolve o caso comum de "BRUNO S SANTOS" no RG casar com "BRUNO
  SANTOS DA SILVA" cadastrado.
- `distribuir()`: para cada arquivo classificado como identidade, verifica se o
  nome bate com o titular, com algum dependente, ou com o dono do CNPJ (pode ser
  mais de um ao mesmo tempo — o RG do sócio-titular vale como documento do titular
  **e** documento do dono simultaneamente, e o sistema marca os dois destinos).
- Documento que não bate com ninguém cadastrado não é forçado em lugar nenhum —
  fica "sem destino" e o corretor escolhe manualmente num seletor.
- **Correção manual gruda**: se o corretor corrigir o destino de um arquivo à mão,
  essa escolha nunca é sobrescrita numa redistribuição automática seguinte (troca
  de papel de uma pessoa, por exemplo).
- A distribuição **roda de novo automaticamente** toda vez que o cadastro muda
  (ex.: você marca alguém como titular em vez de dependente) — os documentos se
  reorganizam sozinhos sem precisar reanexar nada.

## Custo e economia

- Modelo escolhido de propósito por ser barato: a tarefa (ler campos de um
  documento) não exige um modelo caro, e o volume é alto.
- Preço rastreado por chamada (tokens de entrada/saída → USD → BRL) e mostrado na
  tela de gestão, para o Guilherme acompanhar gasto real, não estimativa.
- Câmbio fixo por variável de ambiente — não vale a complexidade de buscar cotação
  em tempo real para uma tela de custo interno.

## Caminho sem IA (fallback)

Quando `ANTHROPIC_API_KEY` não está configurada, o sistema não trava — cai num
caminho manual: um botão copia um prompt pronto para o consultor colar no ChatGPT
dele junto com as fotos, e colar a resposta de volta num campo de texto que um
**parser determinístico** (`parser.py`) interpreta no mesmo formato. Ou seja, a
"inteligência de extração" tem duas implementações que convergem para o mesmo
schema de saída — uma paga e automática, outra grátis e manual.

---

## O que é genérico (reaproveitável em qualquer extração de documento) vs. específico da Bene

**Genérico — reaproveitável direto na extensão do JOB:**
- A técnica de rotular imagens com `ARQUIVO n` antes de mandar ao modelo.
- Duas tarefas na mesma chamada (classificar + extrair) com schema JSON forçado.
- A escala de imagem (1568px) e a lógica de amostragem de páginas de PDF.
- A distribuição em rodadas para não deixar arquivos "engolidos" pelo teto.
- `normNome` / `mesmaPessoa` — casamento de nome tolerante a abreviação.
- O princípio "nunca chuta dígito, sempre reporta incerteza" — vale para qualquer
  domínio com dado sensível (CPF, valores financeiros, etc.).
- A separação IA-classifica / código-decide-regra-de-negócio.

**Específico da Bene — precisa ser reescrito para o caso do JOB:**
- A lista de tipos de documento (`TIPOS`) é do vocabulário da operadora Saúde
  Beneficência (contrato social, certidão de união estável, etc.). Para o JOB, a
  lista de tipos dependeria do que o "mapa de dados do cliente" da extensão
  precisa capturar.
- O schema de pessoa (`nome/cpf/rg/nascimento/mae/pai/sexo`) reflete o que a Ficha
  de Inclusão da Bene pede. Pode ser diferente do que o JOB precisa mandar para o
  "sistema Job site" e depois comunicar à fintech.
- O destino da distribuição (`doc_titular`, `doc_dono`, `parentesco_conjuge`...) é
  o vocabulário de campos do contrato da Bene.

---

## Sobre o pedido de levar isso para a extensão do JOB

Entendo o pedido como: o corretor arrasta documentos num campo novo no trilho da
extensão → a extensão lê e monta um "mapa de dados do cliente" → esse mapa
preenche a proposta no site do JOB → e dispara um aviso para a fintech de que a
venda foi protocolada.

Isso é uma peça de arquitetura nova (não é só copiar `leitor.py` para dentro da
extensão — uma extensão de Chrome não tem servidor Python rodando nela). Antes de
eu começar a desenhar isso, preciso que você decida uma coisa que muda a
arquitetura inteira: **onde a leitura vai rodar** — dá para chamar a API da
Anthropic direto do JavaScript da extensão (expõe a chave no client, ou passa por
um proxy), ou ela chama o servidor do JOB (que faria a leitura, como a Bene faz
hoje), ou chama este próprio servidor da Bene, que já tem o motor pronto.

Isso eu não decido sozinho — é exatamente o tipo de escolha que muda o que
construo depois. Quando estiver pronto para seguir, me chama que eu levanto as
opções com prós/contras de cada uma.
