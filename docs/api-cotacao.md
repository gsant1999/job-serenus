# API do JOB — Módulo de Cotação

> # SUPERADO — NÃO CODE A PARTIR DAQUI
>
> **08/08/2026.** A autenticação descrita neste documento (`X-API-Key` e
> `X-Extension-Key` conferidos rota a rota) é exatamente o que o
> **`handoff/contrato-api-unificada.md`** substitui. Construir a partir daqui
> cria rotas que já nascem precisando ser migradas — foi o que aconteceu em
> 08/08 e custou um dia de trabalho.
>
> **Se você quer construir API: leia `handoff/contrato-api-unificada.md`.**
> Este arquivo fica só como registro do desenho de julho.

---

> **Estado em 30/07/2026.** Este documento descreve o que **existe hoje** e
> especifica o que precisa ser construído. Onde algo ainda não existe, está
> marcado **`[A CONSTRUIR]`** — nada aqui é apresentado como pronto sem ser.
>
> Cada afirmação sobre o código atual foi conferida contra `app.py`. Duas
> afirmações da primeira versão deste texto estavam erradas e foram corrigidas:
> `cotacao_tabela.atualizado_em` já existe, e `/cotacao/legendas/api` exige
> sessão de login (não serve para integração).

---

## 1. O ponto de partida honesto

**Hoje o módulo de cotação não tem API.** Ele é HTML de ponta a ponta:

| Rota atual | O que faz | Por que não serve como API |
|---|---|---|
| `GET /cotacao` | Renderiza a tela de montagem | Devolve HTML, exige sessão de login |
| `POST /cotacao/salvar` | Calcula e salva | Recebe `request.form`, responde **redirect 302** |
| `GET /cotacao/documento/<id>` | Documento da cotação | HTML |
| `GET /c/<token>` | Link público pro cliente | HTML |
| `GET /cotacao/legendas/api` | Legendas | **Único JSON que já existe** — mas exige sessão de login (`@login_required`), então não serve para integração |

Consequência prática: o CRM e a extensão **não conseguem cotar**. Para oferecer
"cotar este lead" dentro do WhatsApp, hoje seria preciso abrir o site e refazer
tudo à mão.

O objetivo desta API é que **o mesmo motor de cálculo** sirva os três consumidores:
site, CRM e extensão.

---

## 2. Como o JOB já autentica (não invente um terceiro jeito)

Existem **dois** esquemas em produção, e a API de cotação deve usar os mesmos:

| Esquema | Header | Variável | Quem usa |
|---|---|---|---|
| Chave de integração | `X-API-Key` | `API_KEY_BI` | `/api/bi/*` (Power BI) |
| Chave da extensão | `X-Extension-Key` | `WHATSAPP_EXT_KEY` | `/api/whatsapp/*` |
| Sessão de login | cookie | — | telas internas |

**Regra:** `_wa_auth_ok()` é *fail-closed* — sem a variável de ambiente definida,
recusa tudo. A API de cotação herda esse comportamento: **nunca** ficar aberta por
falta de configuração.

> **Atenção:** a chave da extensão diz que a chamada **vem do JOB**, não **quem**
> está chamando. Onde a identidade importa (cotação atribuída a um corretor),
> o `usuario_id` precisa ser validado contra o banco, não aceito do cliente.
> Foi exatamente esse o furo corrigido em `api_whatsapp_lead_salvar` nesta semana.

---

## 3. O modelo de dados que já existe

```
cotacao_tabela          ← uma linha por PLANO cotável
  id, operadora, plano, modalidade, acomodacao, coparticipacao,
  linha, tipo_cnpj, abrangencia, vigencia, ativo

cotacao_preco           ← preço por faixa etária (1:N com tabela)
  tabela_id, faixa, preco

cotacao_rede            ← hospitais/rede do plano (1:N)
  tabela_id, nome, cidade, cobertura

cotacao_salva           ← uma cotação MONTADA e enviada
  id, token, lead_id, corretor_id, cliente_nome/email/telefone,
  vidas_json, planos_json, total, orientacao, criado_em

cotacao_engajamento     ← o que o cliente fez no link público
  cotacao_id, evento, dados, criado_em
```

### 3.1 As faixas etárias são fixas

```
00-18  19-23  24-28  29-33  34-38  39-43  44-48  49-53  54-58  59+
```

São as faixas da ANS. **Não são configuráveis** e não devem virar parâmetro da
API — mudar isso quebra toda tabela de preço já cadastrada.

### 3.2 O motor de cálculo, em uma frase

> Conta quantas vidas caem em cada faixa, multiplica pelo preço daquela faixa
> naquele plano, soma.

```
total_plano = Σ (qtd_vidas_na_faixa × preco_da_faixa)
```

É isso. Não há desconto, carência ou regra de vidas mínimas embutidos — o que
existe de agravo entra depois, via `POST /cotacao/<id>/ajustar`, e **só altera o
`planos_json` da cotação, nunca a tabela base**.

---

## 4. A API `[A CONSTRUIR]`

Prefixo: `/api/v1/cotacao`. Versionado desde o primeiro dia — é mais barato do que
descobrir depois que a extensão de 40 consultores depende de um formato.

Todas as respostas: `application/json`, com `{"ok": true|false}` na raiz.

### 4.1 Catálogo — o que dá para cotar

```http
GET /api/v1/cotacao/planos?modalidade=PME&acomodacao=Enfermaria&operadora=Amil
X-API-Key: <chave>
```

```json
{
  "ok": true,
  "planos": [
    {
      "id": 42,
      "operadora": "Amil",
      "plano": "Amil 400 QP Nacional",
      "modalidade": "PME",
      "acomodacao": "Enfermaria",
      "coparticipacao": "Parcial",
      "abrangencia": "Nacional",
      "vigencia": "2026-07",
      "faixas": {
        "00-18": 210.44, "19-23": 245.10, "24-28": 268.90,
        "29-33": 301.22, "34-38": 330.15, "39-43": 372.80,
        "44-48": 428.55, "49-53": 512.30, "54-58": 640.75, "59+": 1024.60
      }
    }
  ],
  "total": 1
}
```

**Filtros:** `modalidade`, `acomodacao`, `coparticipacao`, `operadora`, `cidade`
(via `cotacao_rede`), `ativo` (padrão `1`).

### 4.2 Calcular — sem salvar nada

```http
POST /api/v1/cotacao/calcular
X-API-Key: <chave>

{
  "idades": [42, 39, 12, 8],
  "planos": [42, 57, 61]
}
```

```json
{
  "ok": true,
  "vidas": 4,
  "distribuicao": { "00-18": 2, "34-38": 1, "39-43": 1 },
  "resultados": [
    {
      "plano_id": 42,
      "operadora": "Amil",
      "plano": "Amil 400 QP Nacional",
      "linhas": [
        { "faixa": "00-18", "label": "0 a 18 anos", "qtd": 2, "preco": 210.44, "subtotal": 420.88 },
        { "faixa": "34-38", "label": "34 a 38 anos", "qtd": 1, "preco": 330.15, "subtotal": 330.15 },
        { "faixa": "39-43", "label": "39 a 43 anos", "qtd": 1, "preco": 372.80, "subtotal": 372.80 }
      ],
      "total": 1123.83
    }
  ]
}
```

**Idempotente e sem efeito colateral.** É a chamada que a extensão usa para
mostrar preço dentro da conversa sem sujar o banco com cotação de rascunho.

**Erros previstos:**

| Situação | HTTP | `erro` |
|---|---|---|
| `idades` vazio | 400 | `idades_obrigatorias` |
| idade fora de 0–120 | 400 | `idade_invalida` |
| `planos` vazio | 400 | `planos_obrigatorios` |
| plano inexistente/inativo | 200 | omitido do resultado + `avisos[]` |
| plano sem preço na faixa | 200 | linha com `preco: 0` + `avisos[]` |

> A última linha é importante: **tabela incompleta não pode virar preço zero
> silencioso.** Hoje `pmap.get(fx, 0)` devolve zero sem avisar ninguém — na API
> isso precisa aparecer em `avisos`.

### 4.3 Salvar — vira documento e link público

```http
POST /api/v1/cotacao
X-Extension-Key: <chave>

{
  "idades": [42, 39, 12, 8],
  "planos": [
    { "plano_id": 42, "recomendacao": "1a" },
    { "plano_id": 57 }
  ],
  "cliente": { "nome": "Maria Silva", "telefone": "19991046030", "email": "" },
  "lead_id": 1234,
  "usuario_id": 7,
  "orientacao": "horizontal",
  "titulo": "Plano familiar — 4 vidas"
}
```

```json
{
  "ok": true,
  "cotacao_id": 903,
  "token": "aB3xY7kQp",
  "url_publica": "https://job-serenus-production.up.railway.app/c/aB3xY7kQp",
  "url_documento": "/cotacao/documento/903",
  "total": 2841.60,
  "lead_id": 1234,
  "lead_vinculo": "informado"
}
```

**Vínculo com o CRM.** Se `lead_id` vier, usa. Se não vier, cai na busca por
telefone/e-mail que a rota atual já faz — o mesmo princípio da venda: **id
conhecido não pode ser jogado fora para depois ser readivinhado**.

**O token é imutável.** Nunca reescreva uma cotação enviada: "nova versão" cria
registro novo. O link que o cliente recebeu tem que continuar mostrando o que ele
viu — isso é regra de negócio, não detalhe de implementação.

### 4.4 Ler uma cotação

```http
GET /api/v1/cotacao/903
```

Devolve o mesmo payload do salvamento, mais `engajamento` (o que o cliente fez):

```json
{
  "ok": true,
  "cotacao": { "...": "..." },
  "engajamento": [
    { "evento": "abriu", "criado_em": "2026-07-30 14:02:11" },
    { "evento": "clicou_plano", "dados": "{\"plano_id\":42}", "criado_em": "..." }
  ]
}
```

### 4.5 Ajustar (agravo)

```http
POST /api/v1/cotacao/903/ajustar
{ "plano_id": 42, "percentual": 15 }
```

Altera **só** o `planos_json` desta cotação. **Nunca** toca em `cotacao_tabela`.

---

## 5. Como cada consumidor usa

### CRM (`/crm`)
- Botão **Cotar** na ficha → `POST /calcular` com as idades de
  `composicao_familiar` e `numero_vidas` (campos personalizados que já existem).
- Ao salvar, manda `lead_id` — o vínculo nasce certo.
- A cotação aparece na timeline do lead (`/crm/lead/<id>/cotacoes` já existe).

### Extensão (WhatsApp)
- `GET /planos` uma vez por sessão, com cache local.
- `POST /calcular` enquanto o consultor conversa — resposta rápida, sem gravar.
- `POST /cotacao` quando ele decide mandar → devolve `url_publica`, que vira a
  mensagem enviada.
- Autenticação: `X-Extension-Key` + `usuario_id` **validado no servidor**.

### Integrações externas
- `X-API-Key`, só leitura (`/planos`, `/calcular`).
- Escrita fica fora até existir chave por parceiro — hoje `API_KEY_BI` é uma
  chave só para tudo, e escrita com ela não tem como ser auditada por origem.

---

## 6. O que precisa ser resolvido antes de considerar pronto

Isto não é lista de desejos — é o que impede a API de ser confiável:

1. **Preço zero silencioso.** `pmap.get(fx, 0)` transforma tabela incompleta em
   preço zero. Numa tela alguém estranha; numa API vira proposta errada.
   → `avisos[]` obrigatório, e `preco_ausente: true` na linha.

2. **Vigência não é verificada.** `cotacao_tabela.vigencia` existe e ninguém
   compara com a data de hoje. A API pode cotar com tabela vencida sem avisar.
   → `vigencia_expirada` em `avisos[]`.

3. **`cotacao_preco` não tem `atualizado_em`.** A tabela `cotacao_tabela` **já
   tem** essa coluna (verificado no schema), mas a de PREÇO não — e é o preço que
   muda. Sem isso, um cliente da API não sabe se o catálogo mudou e rebaixa tudo
   sempre.
   → coluna `atualizado_em` em `cotacao_preco`, e `ETag`/`If-Modified-Since` em
   `GET /planos`.

4. **`API_KEY_BI` é uma chave única para todos os consumidores.** Não dá para
   revogar um parceiro sem derrubar o Power BI.
   → tabela de chaves por consumidor, com escopo (`leitura` / `escrita`) — vale
   quando houver o primeiro parceiro externo, não antes.

5. **Sem limite de requisição.** `/calcular` roda no mesmo processo que serve o
   CRM. Um cliente em laço derruba o sistema inteiro.
   → teto por chave.

---

## 7. Ordem sugerida de construção

| Passo | Entrega | Por que nesta ordem |
|---|---|---|
| 1 | `GET /planos` + `POST /calcular` | Só leitura, sem risco. Já destrava a extensão mostrar preço |
| 2 | `avisos[]` (preço ausente, vigência) | Antes de qualquer escrita: API que mente é pior que API que falta |
| 3 | `POST /cotacao` + `GET /cotacao/<id>` | Escrita, com `lead_id` |
| 4 | `atualizado_em` em `cotacao_preco` + cache | Quando houver consumidor externo |
| 5 | Chaves por consumidor + limite | Quando houver o primeiro parceiro |

Os passos 1 e 2 **reaproveitam o motor que já existe** (`_faixa_da_idade`,
`FAIXAS_ETARIAS`, o laço de `/cotacao/salvar`). O trabalho real é extrair esse
cálculo para uma função pura, chamada tanto pela tela quanto pela API — hoje ele
está embutido na rota, misturado com `request.form` e `redirect`.

**Esse é o primeiro passo de código:** extrair `calcular_cotacao(idades, plano_ids)`
de dentro de `/cotacao/salvar`. Enquanto o cálculo viver dentro da rota HTML, toda
API vai ser uma cópia dele — e duas cópias divergem.
