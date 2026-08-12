# Biblioteca de Conteúdo — relatório de auditoria (12/08/2026)

Branch: `worktree-biblioteca-conteudo`. Fases 0 a 3 do handoff entregues; fases 4
a 6 planejadas aqui e **não** implementadas. Nada foi enviado nem mesclado na
`main`.

## Commits

| Hash | O que entrou |
|---|---|
| `8401c3b` | Rede de segurança: inventário, inspetor somente leitura, bateria de testes |
| `5ccc9f2` | APIs da biblioteca por proprietário + autorização nas rotas antigas |
| `11a8b4c` | Tela da Biblioteca reconstruída + bancada de telas do site |
| `2a54c4a` | Extensão alinhada (duas raízes, pastas reais, p95 no Diagnóstico) |

## Arquivos

Criados:

- `scripts/inspecionar_biblioteca.py` — foto somente leitura da biblioteca, com
  `--salvar` e `--comparar`. Abre o SQLite em `mode=ro` e o Postgres em
  transação `READ ONLY`; não importa o `app.py` de propósito (importar roda o
  `init_db`, que já seria escrita de esquema).
- `testes/testar_biblioteca.py` — 92 verificações em SQLite, banco novo a cada
  rodada.
- `scripts/bancada_biblioteca.py` — renderiza a tela com o Flask real e fotografa
  nos dois temas em 1440, 1024, 768 e 375.
- `scripts/medir_carga_extensao.py` — mede mediana, p95 e tamanho da resposta das
  duas rotas que a extensão usa, com 400 mensagens.
- `handoff/biblioteca-conteudo-inventario.md` — quem lê e quem escreve em cada
  tabela da biblioteca.

Alterados: `app.py`, `templates/crm_modelos.html` (reescrito),
`templates/base.html` (item de menu "Modelos" → "Biblioteca"),
`extensao-whatsapp/content.js`, `extensao-whatsapp/background.js`,
`scripts/bancada-mensagens-funis.html`, `ROADMAP.md`.

## O que mudou, e por quê

**A biblioteca passou a ser uma árvore de proprietários.** Raiz = `Compartilhado`
mais uma pasta-mãe por consultor; abaixo, subpastas livres. Em qualquer pasta
convivem WhatsApp, SMS e e-mail — canal virou filtro. Era o agrupamento por canal
antes do agrupamento por dono que deixava `/crm/modelos` confusa.

**As quatro operações têm efeitos distintos e escritos na tela:**

| Operação | Efeito | Funis e Fluxos |
|---|---|---|
| Mover | só a pasta muda; ID e dono ficam | continuam válidos |
| Transferir | dono e pasta mudam; o ID fica | continuam válidos |
| Copiar | cria item novo no destino | não mudam de alvo |
| Duplicar | copiar no mesmo lugar | não mudam de alvo |

Nenhuma delas apaga e recria registro. Isso não é preferência de estilo: `Fluxo`
aponta para conteúdo por `fluxo_passos.template = 'upload_<id>'`, e recriar com
ID novo quebraria todo fluxo que usa aquele conteúdo.

**Transferir funil valida as dependências antes de agir.** Se algum passo aponta
para mensagem de outro proprietário, o servidor responde 409 com a lista e o
gestor escolhe: transferir as mensagens junto (o dono antigo deixa de vê-las) ou
copiá-las para o destino (o original fica onde está). Na folha, a cor cheia está
na opção de copiar — é a que não tira nada de ninguém.

**Dado legado não sumiu e não foi migrado.** Conteúdo com `pasta_id` nulo aparece
numa pasta virtual **Sem localização** dentro do proprietário correspondente.
Nenhum `UPDATE` em massa foi rodado: a organização continua sendo decisão do
gestor, item a item, e é reversível.

**Buraco de permissão fechado.** `crm_modelo_editar`, `crm_modelo_excluir`,
`crm_modelo_toggle`, `crm_modelo_favorito`, `crm_modelo_mover_pasta`,
`crm_funil_mover_pasta` e as rotas de pasta usavam `@admin_required` sem olhar o
dono. Como `admin_required` também deixa passar consultor com o módulo
`crm_modelos` liberado, um consultor podia editar e excluir conteúdo de qualquer
colega pelo site. Agora todas checam o dono.

**Extensão.** Mensagens e Funis abrem em duas raízes — `Minha biblioteca` e
`Compartilhado` — e, dentro, as pastas de verdade do JOB, fechadas. Conteúdo
antigo sem pasta continua caindo na categoria como nome de subpasta, para nada
mudar de lugar na tela da consultora antes de o gestor organizar. Busca e filtro
abrem as pastas com resultado (resultado escondido em pasta fechada é o mesmo que
resultado nenhum). Nenhum observer ou intervalo novo foi criado.

## Verificação

Tudo abaixo roda com `/usr/bin/python3` — o `python3` do Homebrew nesta máquina
não tem as dependências do app (dateutil, pytz, requests).

| Verificação | Resultado |
|---|---|
| `python3 -c "import ast; ast.parse(open('app.py').read())"` | passa |
| `/usr/bin/python3 testes/testar_biblioteca.py` | 92 de 92 verificações |
| `/usr/bin/python3 scripts/ci_servidor.py` | app sobe, rotas no lugar, status certos |
| `node --check content.js` e `background.js` | passam |
| `bash scripts/checar_extensao.sh` | 449 funções (piso 340), todos os JS compilam |
| `git diff --check` | limpo |

**Preservação de dados, medida.** Numa biblioteca de teste com 30 conteúdos dos
três canais, 1 funil de 6 passos e 3 referências de Fluxo, foram executadas 30
transferências, 30 movimentações e 1 transferência de funil com dependências. O
inspetor comparou as fotos:

```
igual  total de conteudos            30      igual  passos de funil             6
igual  conteudos com midia            8      igual  referencias de Fluxo        3
igual  assinatura dos IDs                    igual  assinatura das midias
igual  assinatura dos passos de funil        igual  assinatura das referencias de Fluxo
igual  assinatura do conteudo (nome, assunto, HTML, texto)
```

**Permissões testadas** (gestor, dono e não-dono): consultor não lista pasta de
colega (403), não alcança o compartilhado pela busca do site, não move, edita,
exclui nem desativa conteúdo alheio (403 em cada), e não transfere para outro
proprietário (403). Pela extensão, o servidor barra envio de conteúdo de terceiro
(403) e funil com passo de outro dono nem aparece na resposta.

**Referência de Fluxo testada antes e depois** de mover e transferir, para e-mail
e SMS: o passo continua resolvendo o mesmo conteúdo (`_fluxo_executar_passo`
devolve o mesmo `modelo_id`, sem "não existe mais").

**Peso da extensão, medido com 400 mensagens** (`scripts/medir_carga_extensao.py`,
mesma carga nas duas versões):

| | mediana | p95 | resposta |
|---|---|---|---|
| Antes (`6c08423`) | 4 ms | 8 ms | 438,6 KB |
| Depois | 4 ms | 5 ms | 457,5 KB |

O crescimento de 4,3% é o caminho da pasta e a marca de compartilhado por item
(~48 bytes). A diferença de p95 está dentro do ruído de medição local; o que
importa é que não subiu.

**Telas conferidas** (`scripts/bancada_biblioteca.py`, imagens em
`/tmp/bancada-biblioteca/`): estado inicial, pasta aberta, folha de mover, folha
de transferir com dependências e folha de novo conteúdo — nos temas claro e
escuro, em 1440, 1024, 768 e 375. A bancada mostrou que o Chrome sem interface
não abre janela menor que 500px: o "quebrado no celular" era recorte da captura,
não layout. Por isso as capturas estreitas passaram a usar iframe.

## Como reproduzir

```bash
# 1. Bateria completa (cria o banco de teste do zero)
/usr/bin/python3 testes/testar_biblioteca.py

# 2. Foto da biblioteca e comparação antes/depois
JOB_DATA_DIR=/tmp/jobtest-biblioteca /usr/bin/python3 scripts/inspecionar_biblioteca.py --salvar /tmp/antes.json
# ... faça as operações ...
JOB_DATA_DIR=/tmp/jobtest-biblioteca /usr/bin/python3 scripts/inspecionar_biblioteca.py --comparar /tmp/antes.json

# 3. Telas (imagens em /tmp/bancada-biblioteca)
/usr/bin/python3 scripts/bancada_biblioteca.py

# 4. Peso da carga da extensão
/usr/bin/python3 scripts/medir_carga_extensao.py

# 5. Verificações do repositório
/usr/bin/python3 scripts/ci_servidor.py
bash scripts/checar_extensao.sh
```

Antes de subir para produção, rodar o inspetor **contra o Postgres** (com
`DATABASE_URL`), guardar a foto, e comparar depois do deploy. É leitura pura.

## Limitações e riscos conhecidos

1. **Medição só local.** Os números de peso e tempo saem de SQLite com carga
   sintética de 400 mensagens. A biblioteca real (232 áudios, 91 imagens, 51
   documentos) está em Postgres, com latência de rede que este teste não tem.
   Repetir a medida com o Diagnóstico da extensão depois do deploy — ele agora
   mostra p95 junto da mediana e do pior caso.
2. **A rota da árvore cria pasta.** `_bib_garantir_raizes` insere as raízes que
   faltam quando a tela abre. É idempotente e só insere o que não existe, mas é
   escrita numa requisição GET. Em produção isso acontece uma vez.
3. **Sem índice único nas raízes.** Duas requisições simultâneas na primeira
   abertura poderiam criar duas raízes para o mesmo consultor. O helper sempre
   usa a mais antiga, então o efeito seria cosmético (uma pasta vazia
   sobrando). Não criei o índice para não arriscar falhar a migração num banco
   que já tenha duplicata.
4. **Raiz "A organizar" continua existindo** como raiz sem dono, do backfill
   antigo. Aparece na árvore depois de Compartilhado. Não apaguei nada.
5. **Edição de e-mail continua limitada** ao nome: a rota
   `/crm/modelos/<id>/editar` nunca aceitou trocar o HTML, e ampliar isso estava
   fora do escopo. A folha diz isso na tela em vez de deixar o gestor descobrir.
6. **Criação de SMS e e-mail segue sendo do gestor**, como já era. O consultor
   vê e administra os próprios, mas não cria conteúdo desses dois canais.
7. **A extensão precisa de versão nova para ir à loja.** `manifest.json` está em
   4.94.0; publicar exige subir a versão e enviar manualmente.
8. **Categoria e pasta convivem.** `modelos_conteudo.categoria` continua no banco
   e é usada como nome de subpasta na extensão para conteúdo sem `pasta_id`.
   Quando tudo estiver em pasta, esse fallback pode sair.

---

# Plano das fases 4 a 6 (não implementadas)

Não foram implementadas de propósito: cada uma é produto novo, com risco próprio,
e o handoff pede que sejam feitas depois das fases 0 a 3 aprovadas em uso real.

## Fase 4 — busca contextual no compositor

**O que é.** Enquanto o consultor digita na caixa de mensagem do WhatsApp, a
extensão sugere conteúdo da biblioteca dele. Nunca envia sozinho.

**Como fazer, na ordem:**

1. **Índice local, não requisição por tecla.** A extensão já tem a biblioteca em
   memória (cache de 5 min). Montar um índice simples na primeira abertura:
   nome normalizado sem acento, primeiras palavras do texto e nome da pasta.
   Zero ida ao servidor durante a digitação.
2. **Gatilho explícito.** Um prefixo (`/` no começo da linha, como o WhatsApp
   Business faz) ou duas letras mais um atalho. Observar toda digitação sem
   gatilho é caro e assusta — e a extensão roda dentro de sistema de terceiro.
3. **Ordem das sugestões:** exato, prefixo, nome contendo, texto contendo. No
   máximo 5, com o canal e a pasta visíveis em cada uma.
4. **Seleção explícita antes de substituir.** Enter ou clique. O rascunho nunca é
   apagado: a sugestão entra no lugar do trecho digitado, e Esc desfaz.
5. **Permissão igual à da lista:** próprio mais compartilhado, nunca de colega.
6. **Custo medido:** tempo do índice na abertura e tempo por tecla (mediana e
   p95) no Diagnóstico, antes de liberar para todo mundo.

**Riscos:** ouvinte de teclado no campo do WhatsApp é o ponto mais frágil da
extensão — o seletor muda quando o WhatsApp atualiza (ver
`wa-js: dependência crítica`). Precisa de desligamento automático quando o campo
não for encontrado, e de limpeza de ciclo de vida do ouvinte.

## Fase 5 — gatilhos e Fluxos (dois projetos separados)

São dois produtos. Misturar os dois numa entrega é o caminho mais curto para os
dois ficarem pela metade.

**5a — Gatilhos.** Regra que dispara quando algo acontece (lead mudou de etapa,
respondeu, ficou N dias parado).

1. Persistência primeiro: tabela de regra, tabela de execução, log com motivo.
2. Comparadores explícitos (igual, contém, começa com, vazio), com normalização
   de acento e caixa.
3. Janela antirrepetição por lead e por regra, horário permitido, escopo (quais
   consultores, quais etapas) e pausa global de um clique.
4. **Nunca ativo por padrão.** Regra nasce em rascunho, com simulação obrigatória
   sobre os últimos N leads antes de poder ligar.
5. Cancelamento: toda execução agendada precisa ser cancelável, e o cancelamento
   fica no log.

**5b — Fluxos.** Evolução dos `fluxos` que já existem.

1. Nós tipados (mensagem, espera, condição, fim) e transições explícitas.
2. Estados: rascunho, publicado, arquivado. Publicado não é editável no lugar —
   publicar cria versão nova, como já é na cotação.
3. Histórico por lead: onde ele está, por onde passou, o que foi enviado.
4. Pausa e retomada por lead e por fluxo inteiro.
5. **Grafo visual por último.** Sem persistência e log seguros, o desenho bonito
   só esconde que o motor não é confiável.

## Fase 6 — governança e recomendação

1. **Ciclo de vida do conteúdo:** rascunho, aprovado, arquivado, com autor, quem
   revisou e quando. Arquivado some da extensão mas continua resolvendo em
   funis e fluxos antigos — nunca apagar por status.
2. **Duplicado é sugestão, nunca remoção automática.** Comparar por texto
   normalizado e por mídia idêntica; mostrar os pares e deixar o gestor decidir.
   Um "limpar duplicados" automático apagaria conteúdo em uso.
3. **Uso e conversão por conteúdo e por funil:** `vezes_usado` já existe;
   falta cruzar com resposta do lead e com venda (`propostas.lead_id`), que é o
   mesmo cruzamento pendente do motor de score.
4. **Recomendação** por etapa do CRM, produto, cidade e histórico — sempre
   explicando por que sugeriu, e sempre com o envio partindo de uma ação humana.
