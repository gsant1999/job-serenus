# Handoff — Extrator de Rede Referenciada (para refazer na Amil)

Documento de transferência para um chat novo repetir o processo com **outra operadora (Amil)**.
Feito originalmente para a **SulAmérica** em 29/07/2026. Leia tudo antes de começar: a parte mais
importante é o **método de descoberta da API** (seção 2), porque os endpoints da Amil serão
diferentes.

**Entregável final da SulAmérica:** página HTML mobile-first (3 cidades, busca, filtros, PDF) +
planilha XLSX. Artifact publicado em `claude.ai/code/artifact/9dee1c30-65d7-4bf3-933b-9f39c6b9b5f3`.

---

## 1. O que foi entregue (escopo a replicar)

Uma página HTML **única e autocontida** (sem CDN, sem servidor, tudo embutido em base64) que o
consultor abre no celular para consultar a rede credenciada:

- Abas por cidade (São Paulo · Campinas · Rio de Janeiro)
- Busca livre por nome do prestador, bairro ou especialidade
- Filtro por tipo de estabelecimento (chips) e por especialidade (select)
- Cards com endereço (link p/ Google Maps), telefone (`tel:` clicável), badges de
  agendamento online / teleconsulta
- Tema claro/escuro (automático + toggle manual)
- Botão **PDF** que gera um PDF de verdade em JS puro e baixa o arquivo
- Logos Serenus + operadora no topo e no PDF; marca d'água "SERENUS CORRETORA · MATERIAL
  EXCLUSIVO" na tela e no PDF

**Volumes coletados na SulAmérica** (plano Direto Nacional, produto 557 / plano 87507):

| Cidade | Pronto Socorro | Hospital/Maternidade | Hospital Dia | Médico/Clínica/Diagnóstico | Total |
|---|---|---|---|---|---|
| São Paulo | 30 | 32 | 1 | 1.001 | **1.064** |
| Campinas | 4 | 6 | 0 | 242 | **252** |
| Rio de Janeiro | 29 | 29 | 0 | 825 | **883** |

---

## 2. Como descobrir a API da operadora (passo mais importante)

**Não tente raspar o HTML da página.** O portal da operadora normalmente é uma casca que embute um
iframe de um app de busca separado, e esse app tem uma API JSON limpa por trás. Foi assim na
SulAmérica e é o padrão do mercado (muitas usam o mesmo fornecedor de rede referenciada).

Receita que funcionou, na ordem:

1. **Abrir a URL do portal** que o usuário mandar (`preview_start` com a URL).
2. **Procurar o iframe real**:
   ```js
   Array.from(document.querySelectorAll('iframe')).map(f => f.src)
   ```
   Na SulAmérica isso revelou:
   `https://rederef-saude.appspot.com/rederef/buscaPrestadores?login=publico&canal=1&produto=557&plano=87507`
3. **Navegar direto para a URL do iframe** — dali em diante você está no app de busca de verdade,
   com acesso ao DOM e ao JS dele.
4. **Listar os campos do formulário** para descobrir os nomes dos parâmetros:
   ```js
   Array.from(document.querySelectorAll('input, select')).map(e => ({tag:e.tagName, type:e.type, id:e.id, name:e.name}))
   ```
5. **Baixar e ler o JS da busca.** Liste `Array.from(document.scripts).map(s=>s.src)`, ache o
   arquivo de busca (na SulAmérica: `/resources/js/buscaUnificada.js`), faça `fetch()` dele e
   procure a função que monta a URL da requisição (`grep` por `ajax`, `buscar`, `fetch`, `url =`).
   Foi assim que apareceu a assinatura completa do endpoint e o `getRaio()`.
6. **Preencher o formulário e clicar em Buscar UMA vez** pela UI, e então ler
   `read_network_requests` para confirmar a URL real e capturar o corpo da resposta.
7. **A partir daí, chamar a API direto via `javascript_tool`** (mesma origem = sem CORS, e você
   herda a sessão/captcha da página).

### O endpoint da SulAmérica (referência — a Amil será diferente)

```
GET /proximidade/prestador/buscar
  ?canal=1&latitude=<LAT>&longitude=<LNG>&categoria=<CAT>
  &produto=557&plano=87507
  &nome=&qualificacoes=&prefixoEmpresa=&empresa=
  &especialidade=<COD_ESP>&procedimento=&tipoPesquisaProcedimento=1
  &raio=<METROS>&programas=&ciCode=&elegivelPortaEntrada=false
Header obrigatório: captcha-token: <token>
```

- **reCAPTCHA v3**: o header `captcha-token` é obrigatório. Site key da SulAmérica:
  `6LdOzkUaAAAAANV9z7gQOokV2kNWI8WI_eSH80vC`. Gera-se assim, de dentro da página:
  ```js
  await new Promise(res => grecaptcha.ready(() =>
    grecaptcha.execute(SITE_KEY, {action:'buscaPrestador'}).then(res)));
  ```
  **Gere um token novo a cada chamada** — reaproveitar dá erro depois de algumas requisições.
- **Endpoints auxiliares** (sem captcha):
  - `/common/categoria/listar?canal=1&produto=..&plano=..` → tipos de estabelecimento
  - `/common/especialidade/listar?canal=1&produto=..&plano=..&categoria=<CAT>` → especialidades
    (código + descrição). **Chame para cada categoria** — na SulAmérica a categoria 3 tinha 106
    especialidades, a 1 tinha 7, a 2 tinha 25. Sem isso os códigos em `especialidadesAtendidas`
    ficam sem nome legível.
- **Categorias da SulAmérica**: `1`=Pronto Socorro, `2`=Hospital e Maternidade,
  `3`=Médico/Clínica/Centro Diagnóstico, `7`=Hospital Dia.
- **Resposta HTTP 204** (corpo vazio) quando não há resultado → `res.json()` estoura. Sempre use
  `res.text()` e `JSON.parse` dentro de try/catch.

---

## 3. A armadilha central: o limite de 50 resultados

**Cada consulta retorna no máximo 50 prestadores, os mais próximos do ponto pesquisado.** Isso é
silencioso — você recebe 50 e parece completo. Duas técnicas combinadas resolvem:

### 3.1 Grid de pontos geográficos (para hospitais/PS)
Rode a mesma busca a partir de vários pontos da cidade e acumule num dicionário deduplicado.
Você sabe que saturou quando pontos novos param de trazer registros novos.

Pontos usados (lat, lng), raio de 18 km:

```js
// São Paulo — 9 pontos
[[-23.5505,-46.6333],[-23.4700,-46.6350],[-23.6500,-46.6800],[-23.7800,-46.7500],
 [-23.5700,-46.5200],[-23.5500,-46.4200],[-23.5300,-46.7300],[-23.4600,-46.7700],[-23.6800,-46.4600]]

// Rio de Janeiro — 10 pontos
[[-22.9068,-43.1729],[-22.9711,-43.1822],[-23.0045,-43.3650],[-22.9056,-43.5606],
 [-22.9192,-43.6850],[-22.9025,-43.2775],[-22.8730,-43.3400],[-22.8300,-43.1950],
 [-22.8100,-43.3600],[-22.9500,-43.3600]]

// Campinas — 3 pontos, raio 22 km
[[-22.9099,-47.0626],[-22.8500,-47.0900],[-22.9700,-47.0300]]
```

### 3.2 Uma busca por especialidade (para médicos/clínicas)
Categoria 3 é a maior de longe. O grid geográfico **não** basta. A solução foi rodar a busca
**separadamente para cada uma das 106 especialidades** a partir do centro da cidade, com raio de
35 km. Isso praticamente elimina o limite, porque quase nenhuma especialidade individual tem mais
de 50 prestadores.

**Limitação residual que você DEVE informar ao usuário:** especialidades de altíssimo volume
(Clínica Médica, Cardiologia, Ginecologia, Ortopedia) ainda batem no teto de 50 em cidades
grandes. Nesses casos a lista traz os 50 mais próximos do centro e não é exaustiva. Isso está
declarado no rodapé da página e do PDF — mantenha essa honestidade.

### 3.3 Deduplicação e filtro de município
- Dedup pela chave `codigoPrestadorLocal` (identifica prestador **+** unidade; o mesmo laboratório
  aparece várias vezes em endereços diferentes e todos são válidos).
- **Filtre por município exato.** Um raio de 35 km em São Paulo traz Guarulhos, Osasco, Santo
  André etc. Compare `endereco.municipio.trim() === 'SAO PAULO'` (sem acento, maiúsculas — é assim
  que vem). Sem esse filtro, SP inflava de 1.064 para ~1.400 registros de outras cidades.

---

## 4. Armadilhas de ferramental (custaram tempo real)

| Problema | Sintoma | Solução |
|---|---|---|
| `javascript_tool` tem timeout de 30 s | O lote morre no meio e você não sabe o que já rodou | Rode em **lotes de 15–25 itens** e mantenha um `Set` de códigos já processados (`espDone`), pulando os repetidos. Assim relançar o lote é seguro e idempotente. |
| Browser pane "fica escondido" | `javascript_tool` retorna "pane may be stuck" | Chame `tabs_select` no tabId antes de tentar de novo. Acontece com frequência; não é erro real. |
| Retorno grande demais | "result exceeds maximum allowed tokens", salvo em arquivo | O arquivo é um JSON `[{type,text}]` cujo `text` é **uma string que contém outro JSON**. Parse com `json.JSONDecoder().raw_decode()` e depois `json.loads` no resultado se vier `str`. |
| `alert()` / `confirm()` no artifact | **Travou o PDF silenciosamente.** O diálogo é bloqueado no sandbox, nada aparece e o código entende como "cancelado" | Nunca use `alert`/`confirm` em artifact. Use um toast em DOM. |
| `window.print()` no artifact | Botão de PDF não fazia nada | **Não dependa de `window.print()`.** Gere os bytes do PDF em JS. Ver seção 5. |
| `<a download>` no artifact | **PDF gerava mas o arquivo nunca aparecia nos Downloads**, e o toast dizia sucesso | O iframe do artifact tem `sandbox` sem `allow-downloads` → o Chrome bloqueia o download **sem lançar erro**. Entregue o PDF por `window.open(blobUrl)` (aba nova = fora do sandbox) e, se o popup for barrado, mostre num `<iframe src=blobUrl>` dentro da página. Ver `deliverPdf()`. |
| Objeto de content stream sem `/Length` | PDF abre, imagens aparecem, **texto não é extraído** | Todo objeto com `stream` precisa de `<< /Length N >>` no dicionário. |

---

## 5. Geração do PDF (código reaproveitável)

O arquivo **`pdfgen_browser.js`** (no scratchpad da sessão original, ~300 linhas) é um escritor de
PDF do zero, sem nenhuma dependência, que roda no navegador. Reaproveite inteiro — só troque os
textos e os logos. O que ele faz:

- Monta objetos PDF 1.4 na mão (fontes Helvetica/Helvetica-Bold, XObjects de imagem JPEG via
  `/DCTDecode`, `ExtGState` para a opacidade da marca d'água)
- Quebra de linha por **largura real do glifo** (tabelas de métricas do Helvetica embutidas), não
  por contagem de caracteres
- Paginação automática com cabeçalho na primeira página e cabeçalho curto nas seguintes
- Marca d'água diagonal repetida via matriz de rotação (`Tm`)
- Agrupa por tipo de estabelecimento quando nenhum filtro de tipo está ativo
- Respeita a busca/filtro ativos e nomeia o arquivo conforme (`rede-<operadora>-<cidade>-<esp>.pdf`)
- Entrega via `new Blob([bytes], {type:'application/pdf'})` + `<a download>.click()`

**Detalhes que importam:**
- Logos no PDF devem ser **JPEG** (não PNG): `/DCTDecode` aceita o JPEG direto, sem precisar
  implementar compressão. Achate a transparência sobre fundo branco antes.
- Fonte base Helvetica **não tem acentuação confiável** em WinAnsi pelo caminho que usamos —
  os textos do PDF foram escritos sem acento de propósito (`pdfStr()` troca char > 255 por `?`).
  Se acento no PDF for requisito, aí precisa embutir uma fonte TrueType com subsetting (bem mais
  trabalhoso).
- Teste de verdade antes de entregar: rodar em **jsdom**, interceptar `URL.createObjectURL` para
  capturar o Blob, salvar em disco e abrir com `pypdf` (contar páginas, extrair texto) e renderizar
  com `pypdfium2` para olhar. Simule `alert`/`confirm`/`print` **lançando exceção**, para provar que
  o gerador não depende deles.

---

## 6. Formato dos dados

Registros compactados (chaves curtas para o payload não explodir; ~390 KB de JSON para 2.199
registros):

```js
{
  n: "Nome Do Prestador",        // Title Case
  t: "ps" | "hm" | "hd" | "mc",  // tipo de estabelecimento
  e: "R Exemplo, 123 - Sala 4",  // endereço + número + complemento
  b: "Bairro",
  c: "01234-567",                // CEP formatado
  f: ["1130474488", ...],        // telefones só dígitos (formatados na exibição)
  s: ["Cardiologia", ...],       // especialidades legíveis
  o: 1,                          // (opcional) agendamento online
  v: 1,                          // (opcional) teleconsulta
  q: ["A","N"]                   // (opcional) qualificações QUALISS
}
```

Estrutura final: `{ sp: {label, records[]}, camp: {...}, rio: {...} }`, embutida na página num
`<script type="application/json">`.

---

## 7. Ativos de marca

- **Logo Serenus (oficial):** `~/Downloads/Cópia de LOGO01.png` (3831×984, PNG transparente,
  wordmark "Serenus CORRETORA" com arco colorido). **Este é o correto.**
  - ⚠️ **Não use** `static/logo_arcos.png` nem `static/logo.png` do repo do JOB — são o ícone
    "arcos"/JOB, marca errada para material de cliente. Foi um erro cometido e corrigido.
  - Para o modo escuro foi gerada uma variante clara programaticamente: recolorir só os pixels
    quase-pretos e de baixa saturação (`max(r,g,b) < 90 && (max-min) < 25`) para `#EAF0EC`,
    preservando as cores saturadas do arco.
- **Logo da operadora:** pegue do próprio portal dela. Na SulAmérica:
  `https://portal.sulamericaseguros.com.br/assets/logo-sula130.png` (achado via
  `document.querySelectorAll('img')` filtrando por `/logo/i` na home). Para a Amil, repita esse
  processo no portal deles.
- Os dois logos entram na página como `data:` URI base64 (a CSP do artifact bloqueia host externo).

---

## 8. Hospedagem — DECIDIDO, ainda não implementado

O artifact fica em `claude.ai/code/artifact/...` e qualquer pessoa com o link acessa. Guilherme
recusou isso (não quer o domínio da Claude nem acesso aberto) e **decidiu em 29/07/2026**:

- **Onde:** rota dentro do **ERP JOB** (`job-serenus-production.up.railway.app`), aproveitando o
  login que já existe.
- **Acesso:** **link temporário, com prazo de validade.**

### O que isso significa na prática (dois níveis)

1. **Consultor** entra pela rota autenticada (`/rede-referenciada`), atrás do `login` normal do
   JOB — navega, filtra, baixa PDF.
2. **Cliente** recebe um **link temporário** que o consultor gera na tela. O link expira; depois
   do prazo, para de funcionar.

### Implementação sugerida

Existe um padrão pronto no ERP para copiar: o token público da cotação (`/c/<token>`). Reaproveitar
a mesma ideia, **com uma diferença crítica**: o token da cotação é imutável e sem prazo, aqui ele
precisa **expirar**.

- Tabela nova (ex.: `rede_link`): `token` (aleatório, urlsafe), `cidade`/filtros opcionais,
  `criado_por`, `criado_em`, `expira_em`, `revogado`.
- Rota autenticada `/rede-referenciada` → a página + um botão "Gerar link para cliente" com escolha
  de prazo (24 h / 7 dias / 30 dias).
- Rota pública `/rede/<token>` → valida `expira_em` e `revogado` antes de servir; se expirou,
  mostra uma tela dizendo que o link venceu e para pedir um novo ao consultor (não dar 404 seco).
- Lembrar das armadilhas de PG do projeto: usar `_parse_dt_seguro()` para ler datas do banco, nunca
  `datetime.fromisoformat()` direto.
- A página em si já é autocontida (um HTML só, assets em base64), então servir é trivial —
  `render_template` ou até `send_file`.

**Não implementado ainda.** Nenhuma linha do `app.py` foi tocada por este projeto.

Vale registrar: a marca d'água **desestimula** repasse casual, mas não é proteção real — é
HTML/CSS e pode ser removida por quem souber mexer. Controle de acesso de verdade vem do login +
expiração do token.

---

## 9. Roteiro sugerido para a Amil

1. Pedir ao usuário a **URL do portal de rede credenciada da Amil**, já com o produto/plano
   escolhido (como foi feito na SulAmérica).
2. Rodar a receita da **seção 2** para achar a API real. Não presuma que é igual — só o método se
   repete.
3. Mapear categorias e especialidades pelos endpoints auxiliares.
4. Testar se existe limite de resultados por consulta (**peça 1 cidade e conte** — se vier um
   número redondo tipo 50/100, é teto). Aplicar as técnicas da seção 3.
5. Coletar em lotes pequenos com `Set` de controle (seção 4).
6. Filtrar por município exato, deduplicar, salvar JSON no scratchpad.
7. Reaproveitar `template.html` + `pdfgen_browser.js`, trocando: logo da operadora, nome do plano
   no rodapé/cabeçalho, e os rótulos de categoria (a Amil pode ter tipos diferentes de "Hospital
   Dia" etc.).
8. Validar em jsdom (dados, filtros, e o PDF de cidade inteira) **antes** de publicar.
9. Publicar e, se a decisão da seção 8 já tiver saído, hospedar no domínio próprio.

## 10. Regras do projeto a respeitar

Do `CLAUDE.md` e do histórico com o usuário:

- **Sem emojis** em botões/interface.
- Uma mudança por vez, commits pequenos, nada de mudança não solicitada.
- Não priorizar tarefa por conta própria — só o que ele pediu explicitamente.
- Validar sintaxe depois de editar (`python3 -c "import ast; ast.parse(...)"` para `app.py`;
  `node --check` para o JS extraído do HTML).
- Testar antes de entregar e **relatar falha como falha** — não afirmar que funciona sem ter visto
  funcionar.
