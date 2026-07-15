# Mapeamento do Painel do Corretor (Agger) — para a varredura automática

Investigação feita ao vivo (14/07/2026) inspecionando `beta.paineldocorretor.com.br`
logado como Serenus. Base pra construir o extrator (`pdc_extract.py`, a fazer).

## Plataforma
- **Next.js (App Router)** — dados vêm via **Server Actions** (POST nas próprias
  rotas `/cotacoes/{id}/edit`), resposta em formato **RSC Flight** (linhas
  `0:{...}` `1:{...}` com refs `$@1`), não uma API REST/JSON limpa.
- Auth: sessão Auth0 (`auth.paineldocorretor.com.br`) → cookies no domínio
  `beta.paineldocorretor.com.br`. O extrator reaproveita a sessão logada
  (Playwright com login manual, igual `botconversa_extract.py`).

## Fluxo do corretor (referência pra UX da /cotacao do JOB — regra de ouro:
## mexer SÓ nesta parte, NUNCA na ficha que o cliente vê)
1. `/cotacoes/nova` — informa **título** → Confirmar.
2. **Distribuição de vidas** (modal) — quantidade por faixa etária
   (00-18, 19-23, 24-28, 29-33, 34-38, 39-43, 44-48, 49-53, 54-58, 59+),
   ou "conversor" de datas de nascimento.
3. **"Quais planos deseja comparar?"** — grid de logos de operadora, com
   filtros na lateral: cidade, perfil do cliente, faixa de valor, hospitais
   de preferência, MEI, acomodação (Quarto Coletivo/Individual), coparticipação
   (Com/Sem), contratação (Opcional/Compulsória). Toggle Saúde/Dental e
   PF/PME/Adesão no topo.
4. Seleciona operadora(s) → **Continuar**.
5. **Comparativo** (`/edit?d=comparativo`) — cards lado a lado: logo, plano,
   "Saúde PME", acomodação, coparticipação, **N Hospitais**, **R$ X/mês**,
   "Ver detalhes"; "Adicionar Plano"; lateral com Distribuição (vidas) e CNPJ.
   Topo: "Ver hospitais", "Enviar".
6. **Ficha do cliente** (`/cotacoes/{id}/cenarios/{cenarioId}`) — página com a
   MARCA DA CORRETORA (Serenus), preço por faixa, "Tenho interesse" (WhatsApp),
   "N Hospitais / N Laboratórios". >>> ESSA TELA NÃO SE TOCA (regra de ouro).

## Estrutura de dados confirmada (extraível dos payloads)
- **Operadora**: `{id, nome, logotipo (url do CDN), iof}`. Ex.: id 3766 =
  "Plano de Saúde Vera Cruz".
- **Plano**: `{id, nome, acomodacao}`. Chave composta nas actions:
  `operadoraId-planoId-...` (ex. `3766-57980` = Vera Cruz / Vera Prata).
- **Preço**: **unitário por faixa etária × quantidade**. Confirmado:
  Vera Prata Enfermaria PME em Campinas, 2 vidas (19-23 + 24-28) = R$ 382,00
  = R$ 180,00 (19-23) + R$ 202,00 (24-28). Pra tabela completa (10 faixas),
  gerar a cotação com 1 vida em cada faixa e ler cada valor unitário.
- **Filtro da cotação**: `{cidade:"Campinas - SP", modalidade:2 (=PME),
  credenciados:[]}`, `vidas:[{faixa:"19-23", quantidade:1}, ...]`.
- **Rede credenciada** (`rede:[{regiao, credenciados:[...]}]`), cada credenciado:
  `{id, nome, site, endereco, bairro, cidade:{nome, id "Cidade - UF", uf, regiao,
  isCapital, coordenadas:{lat,lng}}, tipo ("Hospital"|"Laboratório"),
  atendimentos:["H,M,PS", ...], lat, lng}` + `legenda:[{sigla, descricao}]`
  (H=Hospital, M=Maternidade, PS=Pronto Socorro, etc.).
- **Cidade/região** normalizada: `{nome, id "Campinas - SP", uf, regiao
  "Campinas e Região", isCapital, coordenadas}`.

## Endpoints observados
- `POST /cotacoes/nova` (server action) → cria cotação, 303.
- `POST /cotacoes/{id}/edit` e `?d=cenarios` / `?d=comparativo` (server actions)
  → devolvem o RSC com operadoras/planos/rede/vidas/filtro do estado atual.
- Catálogo de operadoras disponíveis: carrega no passo do grid (por
  modalidade × cidade).

## >>> O CAMINHO LIMPO: seção "Busca ANS" (a MELHOR forma de atualizar o JOB)
Descoberto 14/07: a aba **Busca ANS** ("Dados oficiais da ANS") é MUITO mais
limpa que gerar cotações — é **GET dirigido por URL**, sem server action:

- `GET /busca-ans?cidade={Cidade - UF}&modalidade={1=PF|2=PME|3=Adesão}&comRedeNoLocal=false`
  → lista de **operadoras** daquela cidade+modalidade, cada uma com **código ANS**
  e link `/busca-ans/{codigoAns}`. (Ex.: Campinas PME = 65 operadoras; PF = 13.)
- `GET /busca-ans/{codigoAns}?cidade={Cidade - UF}&modalidade={m}`
  → página da operadora com TUDO:
  - Registro ANS + UF, **IDSS**, **Reajuste anual** (ex. 21,1%).
  - Seletor de modalidade/segmentação (ex. "INDIVIDUAL/FAMILIAR").
  - Por plano, 3 abas: **Preços** (tabela COMPLETA por faixa — as 10 faixas,
    com 2 valores por faixa = provável com/sem copart ou 2 planos),
    **Abrangência**, **Rede Credenciada**.

Amostra real extraída (registro 417092, PF, Individual/Familiar):
00-18 R$737,42 · 19-23 R$917,61 · 24-28 R$1.008,22 · 29-33 R$1.145,02 ·
34-38 R$1.350,78 · 39-43 R$1.419,54 · 44-48 R$1.730,85 · 49-53 R$2.365,86 ·
54-58 R$2.977,76 · 59+ R$3.619,52 (2º valor por faixa também presente).

**Por que é o caminho certo:** GET/URL (sem action-id nem geração de cotação),
dado oficial ANS (padronizado/confiável), preço+rede+abrangência num lugar só.
Preços renderizam client-side (ler do DOM ou do RSC lazy). Prices no fluxo de
cotação (server action) ficam como fallback/validação cruzada.

## Plano do extrator (a construir — BRASIL TODO, validar fatia primeiro)
1. Login manual (Playwright) → reutiliza cookies da sessão.
2. Enumerar **cidades** (seletor de cidade — autocomplete) e, por
   cidade×modalidade, `GET /busca-ans` → operadoras (códigos ANS).
3. Pra cada operadora: `GET /busca-ans/{codigoAns}` → parsear planos + preço
   por faixa (10 faixas) + abrangência + rede + reajuste + IDSS.
4. Dedup por (operadora, plano, cidade/abrangência). Rate-limit (não martelar).
5. Saída → tabelas do JOB: `cotacao_tabela` + `cotacao_preco` (já existem) +
   tabela nova de **rede** (hospitais/labs: cidade, coordenadas, cobertura) +
   guardar reajuste/IDSS por operadora. Rodar agendado pra manter atualizado.

## Cuidado / ética
- É a conta paga da própria Serenus, uso legítimo dos próprios dados.
- Rate-limit e execução fora de horário de pico; a varredura Brasil-todo é
  grande (muitas cidades × operadoras) — rodar em lote/agendado, não de uma vez
  bloqueante.
