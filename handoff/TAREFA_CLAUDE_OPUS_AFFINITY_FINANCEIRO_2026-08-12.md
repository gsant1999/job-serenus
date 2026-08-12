# Tarefa: concluir Affinity, comissão de gestores e integração financeira

Trabalhe somente nesta worktree isolada. Leia `AGENTS.md`, `CLAUDE.md`, `UX_APRENDIZADOS.md`, `MAPA_MODULOS.md`, `GUIA_OPERACIONAL.md` e o relatório `/Users/guilhermesantos/Desktop/job-serenus/entregas/AUDITORIA_AFFINITY_FINANCEIRO_GESTORES_2026-08-12.md` antes de editar.

Não faça push, merge ou deploy. Não toque no branch `main`. Não use o banco de produção. Faça commits pequenos por etapa. Não use emojis.

## Contexto comprovado

- `main` está em `98a533c`.
- O commit isolado `4edc362` contém uma primeira pré-conferência de 32 PDFs. Inspecione-o e porte apenas o que estiver correto; não faça cherry-pick cego.
- Os 32 PDFs reais estão em `~/Downloads` e são os códigos listados em `testes/testar_extrato_previa.py` do commit `4edc362`.
- O PDF `1374214.pdf` tem duas linhas: R$ 1.706,16 e R$ 942,69; o parser atual perde a segunda porque `[Porto Seguro` vem truncado. O total correto é R$ 2.648,85 e o líquido, após tarifa de R$ 4,00, é R$ 2.644,85.
- O teste de invariância da prévia falhou porque o scheduler importou leads durante o teste. Crie um mecanismo explícito e seguro para desativar schedulers/auto-pull em teste, sem alterar o comportamento de produção.
- O importador publicado `/comissoes/extrato` grava imediatamente e diz incorretamente que extrato é dinheiro que entrou.
- `lancamento_salvar()` repete a mesma `data_vencimento` em todas as parcelas.
- O legado `gestor_vendedor` entrega 100% de toda a comissão em uma parcela; isso não representa a nova regra.
- Na criação/edição de usuários, perfis não consultores são forçados para `sem_lead_sem_fixo`, portanto o comportamento de gestores é inconsistente.
- A alíquota de imposto ainda não foi informada. Nunca invente valor padrão.

## Ordem obrigatória

### Commit 1: pré-conferência Affinity correta e isolada

1. Portar a pré-conferência de `4edc362` para esta branch.
2. Corrigir o parser para ler as duas linhas de `1374214` sem afrouxar a ponto de aceitar linha inválida.
3. Conferir cada PDF pelo total impresso; diferença de um centavo bloqueia importação.
4. Preservar `1345055` como ajuste/transferência de efeito financeiro zero.
5. Preservar no `1359414` as parcelas 1,2,3,4,5,7,9,11 para as duas propostas, bruto R$ 250,05 e líquido esperado R$ 246,05.
6. Desativar scheduler e auto-pull apenas quando uma variável explícita de teste estiver ativa. O teste de invariância deve passar sem writes concorrentes.
7. A prévia não pode fazer INSERT/UPDATE/DELETE.
8. Corrigir o texto: PDF Affinity é valor apurado/informado pela Affinity, não prova de entrada no banco.
9. Deixar o importador antigo visível apenas como legado e impedir importação de arquivo cuja leitura não feche com o total impresso.

Critérios: os 32 arquivos leem, `1374214` soma R$ 2.648,85, o teste de invariância passa, duplicidade por código aparece, sem proposta e ambiguidade são estados diferentes.

### Commit 2: importação controlada e conciliação append-only

1. Criar `Importar itens prontos`; importar somente código novo, leitura fechada e match seguro por número ou vínculo manual confirmado.
2. Nunca sobrescrever proposta/parcela congelada e nunca trocar status financeiro automaticamente.
3. Guardar PDF/origem, código, datas, tipo, valores impressos, item, proposta/parcela vinculada, usuário e timestamps.
4. Itens sem match ficam em fila de revisão com busca e vínculo manual auditado.
5. Modelar estados separados: `previsto`, `apurado_affinity`, `entrada_confirmada`, `liberado_repasse`, `pix_iniciado`, `pago`.
6. Entrada confirmada exige identificador Asaas ou confirmação humana com usuário/data/observação. Valor/data parecidos não bastam.
7. Antecipação é marcada como antecipação e não como entrada confirmada.
8. Operações precisam ser idempotentes.

### Commit 3: motor de regra de gestor/admin vendedor

Todos os admins/gestores podem vender. A regra é comercial por operadora + observação/variação + plano, nunca duplicada por pessoa.

Separe obrigatoriamente:

1. `régua de recebimento`: cada fração que a operadora/Affinity paga, percentual e mês/evento;
2. `régua do gestor`: percentual de cada fração recebida que pertence ao gestor;
3. `retenção`: tipo, percentual, base de cálculo, responsabilidade, vigência e observação;
4. `saldo Serenus`: recebido menos bruto do gestor, retenções de responsabilidade da empresa e despesas.

Regra de negócio solicitada: a primeira mensalidade pertence ao gestor, descontada a retenção aplicável. As demais frações ficam com a Serenus conforme a regra da operadora. Na interface, sugira 100% ao gestor na primeira fração e 0% nas demais, mas exija confirmação e permita edição. Não invente alíquota, quantidade de frações ou percentuais.

Crie snapshot imutável da regra em proposta nova/aprovada. Mudança futura da regra não altera proposta antiga.

Sem regra completa:

- alerta grande na proposta, Financeiro e Fluxo de Caixa, indicando operadora/variação/plano ausentes;
- permitir rascunho;
- bloquear geração financeira, liberação e PIX;
- ação direta para abrir a configuração correta.

Mantenha o legado `gestor_vendedor` apenas para leitura histórica. Não recalcule histórico.

### Commit 4: histórico e integração Financeiro/Fluxo de Caixa

1. Criar simulador histórico sem escrita: mostra regra sugerida, valores atuais, valores simulados e diferenças.
2. Aplicação histórica somente por seleção explícita, com backup, confirmação e log. Bloquear parcelas pagas, conciliadas ou com PIX.
3. Unificar a leitura financeira das duas telas usando a mesma fonte de eventos/razão, sem duplicar lançamentos.
4. Exibir: bruto esperado, apurado Affinity, entrada Asaas confirmada, bruto gestor, retenção, líquido para PIX, saldo Serenus e status.
5. Verde apenas para entrada/recebido; obrigações a pagar usam semântica de saída.
6. Corrigir parcelamento de custos/fixos: cada parcela avança o vencimento um mês. Defina e teste a política de dia 29/30/31 em mês menor, preservando o último dia válido.
7. Exportação XLSX/CSV deve reproduzir exatamente o recorte da seção que o usuário está exportando e o total da tela. Se houver mais de uma seção financeira, deixe explícito o escopo ou crie abas no XLSX.

### Commit 5: operação, testes e documentação

1. Atualizar `GUIA_OPERACIONAL.md` com um fluxo simples para o operador.
2. Todo conceito difícil recebe `i` com explicação objetiva.
3. Criar testes SQLite para parser, invariância, idempotência, permissões, snapshot, regra ausente, retenção sem alíquota, histórico protegido, conciliação e PIX bloqueado.
4. Testar rota antiga de proposta, prévia de antecipação e abertura de anexo.
5. Validar sintaxe com `python3 -c "import ast; ast.parse(open('app.py').read())"`.

## Restrições financeiras

- Não executar PIX real.
- Não importar os PDFs em produção.
- Não considerar previsão ou PDF como dinheiro recebido.
- Não confirmar imposto, retenção ou comissão sem configuração explícita.
- Não recalcular nem modificar valores históricos automaticamente.
- Não adicionar dependência sem necessidade.
- Não reformatar `app.py`.

## Relatório final obrigatório

Ao terminar, informe:

- commits e arquivos alterados;
- resultados dos 32 PDFs, incluindo `1374214`, `1345055` e `1359414`;
- número de itens com match exato, sugestão por nome, sem proposta, ambíguos e divergentes;
- testes executados e resultados;
- decisões que ainda exigem informação do Guilherme;
- riscos e itens não implementados;
- confirmação explícita de que não houve push, merge, deploy, importação produtiva nem PIX.
