# Auditoria da base — o JOB aguenta ser vendido para outras corretoras?

> Pedido do Guilherme, 09/08/2026: *"quero uma auditoria das ferramentas que
> usamos e quanto elas suportam nossa demanda se escalarmos para venda do
> sistema e da extensão para outros corretores, e se tem solução melhor no
> mercado. Tenho medo de estar construindo uma mansão sobre uma base de
> palafita."*
>
> Escrito pelo Claude. **Tudo aqui foi medido no repositório**, não estimado.
> A parte do servidor é para o Antigravity executar; a da extensão é minha.

---

## Veredito, antes dos detalhes

**A escolha de arquitetura está certa. O que falta é rede de segurança.**

A base não é palafita: é uma laje boa sem corrimão. O risco de escalar não está
em Flask, Postgres ou Railway — está em **não haver nada que impeça um erro de
chegar em dez clientes de uma vez**. Hoje o que segura isso é o Guilherme
olhando a tela.

Trocar de tecnologia não resolveria nada disso e custaria meses. O que resolve
custa dias.

---

## O que foi medido

| | |
|---|---|
| `app.py` | **38.984 linhas**, **498 rotas**, **111 tabelas** |
| Templates | 92 arquivos |
| Banco | Postgres no Railway (SQLite como fallback local) |
| Multi-corretora | **instância separada por cliente** — `corretora_id` não existe em nenhuma tabela, e isso é proposital (`PROVISIONAMENTO.md`) |
| Testes automatizados | **nenhum** rodando (há `test_*.py` antigos em `_arquivo/`) |
| CI | **nenhum** (`.github/workflows` não existe) |
| Monitoramento de erro | **nenhum** (0 ocorrências de Sentry/Rollbar/equivalente) |
| Migrações | 86 `add_col` idempotentes, **sem versionamento nem rollback** |
| Backup | JSON diário 22:00 (APScheduler no processo web) |
| Servidor em produção | **`app.run()` do Flask** — ver item 1 |

---

## O que é palafita de verdade

Em ordem de **risco ÷ custo de consertar**.

### 1. Produção roda no servidor de desenvolvimento do Flask

```
railway.json  ->  "startCommand": "python3 -u app.py"
Procfile      ->  "web: ... gunicorn -w 3 ..."
```

O `startCommand` do Railway **vence o Procfile**. O que sobe é
`app.run(debug=False, host='0.0.0.0', port=port)` — o servidor embutido do
Werkzeug, que a própria documentação dele diz para não usar em produção. O
`gunicorn==21.2.0` já está no `requirements.txt`, instalado e sem uso.

Consequência prática: um processo só, sem gestão de workers, sem reinício
gracioso, sem limite de requisição. Uma requisição pesada (leitura de PDF,
análise com IA) degrada todo mundo, e um travamento derruba a instância
inteira. Com uma corretora isso é um susto; com dez, é dez clientes parados.

**Conserto: uma linha.** Trocar o `startCommand` para o comando do Procfile.
É o melhor retorno desta lista inteira.

### 2. Nada impede uma regressão de chegar no cliente

Zero teste automatizado, zero CI. Em **uma única sessão de hoje**, nesta base:

- o `app.py` ficou sem subir (`NameError` num decorador) e só o `import app`
  pegou — `ast.parse` passava;
- `POST /api/whatsapp/logout` passou a executar uma página de admin, e só o
  `url_map` do Flask mostrou;
- 46 funções da extensão sumiram num recorte por linha e o pacote continuou
  compilando.

Nenhum desses três foi pego por ferramenta. Os três foram pegos por alguém
olhando. **Isso é exatamente o que não escala para dez clientes.**

O que muda o jogo aqui não é cobertura de teste — é um punhado de testes de
fumaça no que não pode quebrar:

- `import app` sobe;
- as rotas críticas respondem o status certo com e sem credencial;
- o `url_map` não tem rota apontando para função de outra família;
- o pacote da extensão tem os arquivos que o `manifest.json` declara.

Isso é meio dia de trabalho e um `.github/workflows/ci.yml`. Já existe metade
disso espalhado em `scripts/checar_extensao.sh`.

### 3. Ninguém fica sabendo quando quebra no cliente

Sem monitoramento de erro, a forma de descobrir um defeito é o cliente
reclamar. Com o Serenus isso funciona porque o Guilherme usa o sistema todo
dia. Com uma corretora que comprou, o caminho normal não é reclamar — é parar
de usar.

Sentry no plano gratuito cobre isso e leva uma tarde.

### 4. Não dá para saber em que versão cada instância está

86 `add_col` idempotentes fazem o schema convergir, e isso funciona bem para
uma instância. Para dez: não há como perguntar "a instância da corretora X já
tem a coluna Y?", nem desfazer uma migração ruim. A migração de
cidade/empresa é o primeiro caso em que isso importa — ela **muda dado**, não
só estrutura.

Não é urgente hoje. Vira urgente no terceiro cliente.

### 5. Uma versão ruim da extensão atinge todos os clientes ao mesmo tempo

A extensão é um artefato único na Chrome Web Store, publicado à mão a cada
versão. Não há canal de teste nem liberação gradual. Hoje, quando eu erro, o
Guilherme percebe em minutos porque está testando. Com dez corretoras, o erro
chega em todas antes de alguém abrir o WhatsApp.

A Chrome Web Store tem canal de teste e liberação percentual de graça. É
configuração, não código.

### 6. Dois agentes, um `.git`

Não é código, é operação — mas já custou trabalho hoje: o Antigravity trocou de
branch dentro do meu diretório e apagou alterações não commitadas. Já havia
acontecido antes (`regra-branch-diretorio-compartilhado.md`).

Com um cliente, dá para reconstruir. Com um cliente esperando entrega, não.

### 7. Chaves de produção expostas

Postgres, ASAAS e BREVO do Serenus foram expostas em chat e continuam sem
rotacionar (está escrito no `CLAUDE.md` e no `PROVISIONAMENTO.md`). Não afeta
instância de cliente — cada uma tem as suas — mas afeta o Serenus, que é o
primeiro cliente.

---

## O que NÃO é problema (para não gastar dinheiro à toa)

**A escolha de instância separada por corretora está certa.** Isolamento
físico: banco próprio, deploy próprio, chaves próprias. Para dado de saúde e
LGPD é a arquitetura mais defensável que existe, e elimina de uma vez a classe
inteira de bug "cliente A viu dado do cliente B" — que é o pesadelo de todo
SaaS multi-inquilino e que, num arquivo de 39 mil linhas com 498 rotas, seria
questão de tempo.

O custo dela é operacional (N deploys, N bancos), não arquitetural. Railway
resolve isso com projeto por cliente, e o `PROVISIONAMENTO.md` já documenta o
passo a passo.

**Trocar Flask/Postgres/Railway por outra coisa não resolve nada desta lista.**
Nenhum dos sete itens acima existe por causa da tecnologia escolhida — todos
existem por falta de prática (teste, CI, monitoramento, versionamento). Django,
Rails ou Next teriam exatamente os mesmos sete buracos se construídos do mesmo
jeito. Um port custaria meses e reintroduziria defeitos já corrigidos.

**As 39 mil linhas num arquivo só incomodam menos do que parecem.** É feio, e
dificulta dois agentes trabalharem em paralelo, mas não é o que vai quebrar no
cliente. Dividir em módulos é uma melhoria de conforto, não de risco — e
qualquer divisão feita com pressa é exatamente como se perde uma rota.

---

## O que muda quando forem dez corretoras

| hoje (1 cliente) | com 10 |
|---|---|
| Guilherme testa e avisa | ninguém avisa; o cliente some |
| deploy manual, ele acompanha | deploy tem que ser seguro sozinho |
| um banco para olhar | dez, em versões possivelmente diferentes |
| extensão errada = ele reclama | extensão errada = dez corretoras paradas |
| "eu sei o que mudou ontem" | precisa estar escrito |

O padrão: **tudo que hoje depende de uma pessoa atenta precisa virar
verificação automática.** Não é sobre tamanho de servidor — é sobre quem
percebe o erro.

---

## Ordem sugerida

1. **Trocar o `startCommand` para gunicorn** — uma linha, e é o maior ganho.
2. **CI com testes de fumaça** — meio dia; impede as três falhas de hoje.
3. **Sentry** — uma tarde; é como se descobre defeito em cliente que não fala.
4. **Canal de teste da extensão na Chrome Web Store** — configuração.
5. **Rotacionar as chaves do Serenus.**
6. **Migrações versionadas** — a partir do terceiro cliente.

Do 1 ao 3 fecham o buraco real. O resto é manutenção.

---

## Divisão

**Antigravity (servidor):** itens 1, 2 (parte do `app.py`), 3, 5, 6.
**Claude (extensão e cliente):** item 2 (parte da extensão), item 4.

Nenhum item desta lista exige parar o que está em andamento. O item 1 pode ir
hoje.

---

# Parte 2 — "várias ferramentas desalinhadas"

> *"Sinto que estamos com várias ferramentas e estratégias desalinhadas e não
> conectadas ou mal implementadas."* — Guilherme, 09/08/2026

A sensação está certa e dá para contar. **O padrão não é ferramenta a mais: é
a mesma decisão tomada em vários lugares diferentes.**

## Quantas formas existem hoje de responder "esta pessoa pode?"

Contado no `main`:

| forma | ocorrências |
|---|---|
| `@login_required` | 393 |
| `@admin_required` | 234 |
| `_wa_auth_ok()` dentro da rota | 57 |
| `session.get('perfil') != 'admin'` escrito à mão | **49** |
| `_modulos_permitidos_atual` (módulos por consultor) | 4 |
| `@login_ou_extensao` | 3 |
| `@api_requer_chave` | 2 |
| `@chave_ou_login_ou_extensao` | 2 |

**São oito.** E o mais revelador: **49 rotas checam admin escrevendo a regra à
mão**, ao lado de 234 que usam o decorador. É a mesma regra em duas gramáticas
— e é assim que uma delas fica para trás no dia em que a regra mudar.

O `@requer` foi criado justamente para virar a nona e substituir as outras. Ele
está na branch do Antigravity e **não está no `main`** — ou seja, a produção
hoje roda com as oito, e o Lote 1 não protege ninguém ainda. Enquanto não for
mesclado, essa contagem não muda.

## A extensão manda três credenciais diferentes

`background.js` alterna entre `Authorization: Bearer <token>`,
`X-Extension-Key: <chave>` e, num ponto, só a chave em `multipart`. Isso é
transição planejada e documentada — mas **transição inacabada é acoplamento**:
cada rota nova precisa aceitar as três, e foi exatamente aí que o `@requer`
esqueceu a chave antiga e quase derrubou as cinco consultoras que ainda não
fizeram login.

## O mesmo trabalho feito duas vezes, de propósito

Estes são **decisões conscientes**, não descuido — mas cada um é um lugar a
mais para divergir, e vale saber que existem:

| tarefa | onde acontece | por quê |
|---|---|---|
| importar leads | APScheduler **+** pull por requisição | o scheduler morre em restart |
| desenhar a cotação | `cotacao_documento.html` (html2canvas) **+** canvas na extensão | o documento do site exige sessão; a extensão não pode abrir aba |
| guardar arquivo | volume do Railway **+** R2 | volume some em recriação de serviço |

Os três se justificam. O risco não é existirem — é **mudarem em um lado só**.
O da cotação é o mais provável: se alguém mudar a coluna do documento no site,
a imagem da extensão continua com a antiga e ninguém percebe até um cliente
receber as duas.

## O que está mal conectado (e não deveria)

- **`crm_leads.empresa` guarda cidade e empresa misturadas.** É a raiz do
  "Amparo" aparecendo como razão social no passo 4 da cotação. Contrato 5/6.
- **As legendas da cotação existiam no site desde sempre** e só hoje ficaram
  alcançáveis de onde importa (junto da imagem). O recurso existia e não estava
  ligado.
- **`campos_val` guarda `valor`, `valor_ia`, `fonte` e `revisado_em`** — a
  procedência de cada dado está gravada — e a tela mostra só o valor. O dado
  para auditar está lá; falta exibir.

## O que fazer com isso

Não é refatorar tudo. É **parar de aumentar a divergência** e fechar as duas
que custam mais:

1. **Terminar a migração da autenticação, ou parar de espalhá-la.** Oito formas
   é o estado pior possível — pior que uma ruim. Mesclar o `@requer` no `main` e
   converter as 49 checagens à mão fecha a maior parte.
2. **Fechar a transição de credencial da extensão.** Enquanto as cinco
   consultoras não entrarem com e-mail e senha, toda rota nova carrega o custo
   das três portas. É uma tarde de trabalho **do Guilherme**, não de código.
3. **Marcar as duplicações conscientes no código**, uma linha de comentário em
   cada ponta dizendo "existe outro igual em X" — para quem mudar um lado saber
   do outro. É o mais barato desta lista e o que evita o defeito mais caro.
