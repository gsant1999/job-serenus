# ROADMAP — JOB Serenus

Fonte única de pendências e melhorias. Atualizar ao concluir ou decidir algo.
Legenda: [ ] pendente · [~] em andamento · [x] feito · (?) aguardando decisão do Guilherme

## Bugs / correções curtas

- [x] **Lead duplicado indo pra dois consultores diferentes** (Gabriel, PDF 04/07) — resolvido pelas correções da mesma data: fallback "chuta Guilherme" removido, leitura da planilha corrigida (endpoint que estava desatualizado), preenchimento só quando responsável está NULL (nunca sobrescreve), + correção em massa de ~3000 leads mal atribuídos
- [ ] Asaas API 401 — boleto/NF parados. Guilherme confirmou (03/07): não mexer por enquanto, está resolvido do lado dele. Existe ferramenta de diagnóstico pronta em `/admin/asaas/diag` (mostra estado da chave sem expô-la + testa conexão real) e `/admin/asaas/testar-chave` (testa qualquer chave ao vivo sem precisar redeploy) se precisar revisitar
- [ ] MedSênior PF — falta registro de `recebimento` (tabela de comissão por operadora/plano). Já existe diagnóstico pronto: rota admin que lista `propostas_comissao_zerada` (propostas com `comissao_total_corretora` NULL/0 por falta de match na tabela `recebimento`). Falta: rodar o diagnóstico, identificar o(s) plano(s) MedSênior PF sem linha correspondente, e cadastrar o valor de comissão
- [ ] "Melhorar sistema de idades" na cotação (feedback Danilo) (?) — hoje é um único campo de texto livre que mistura idade e data de nascimento (placeholder: "Ex: 25, 30 e 15/03/1990"), parseado no servidor. Provável fonte da confusão, mas falta o Guilherme/Danilo confirmarem o que exatamente incomoda antes de redesenhar
- [ ] Rotacionar chaves expostas (Postgres, ASAAS_API_KEY, BREVO_API_KEY) — ação manual no painel Railway, não é mudança de código
- [ ] **Taxa de resposta 0% no disparo — descobrir se é a saudação ou a detecção** (visto em 03/08/2026 na campanha #4, "CAMPANHA MEI 6 MESES - CAMPINAS - CONTINUAÇÃO": 52 enviados, 0 respostas em 3 dias). Guilherme pediu pra registrar e **não atacar agora**. Duas hipóteses, e é preciso MEDIR antes de mexer em qualquer uma:
  - **(A) a saudação não funciona** — problema de copy. Como medir: abrir 8-10 das conversas disparadas no WhatsApp e ver se o contato leu e ignorou. Se leu e ignorou em massa, é a mensagem.
  - **(B) a detecção de resposta não pega** — problema técnico, e mais provável de passar despercebido. Marcar "respondeu" depende da extensão estar aberta na aba do WhatsApp do consultor (`checarInbound` em `extensao-whatsapp/wpp-bridge.js` → `campanha_contato.respondeu_em`). Consultor que fechou o WhatsApp Web recebe a resposta no celular e o JOB nunca fica sabendo. Como medir: comparar `respondeu_em` com as conversas reais, e conferir se os 5 consultores estavam "Aptos" na janela do disparo.
  - **Por que importa:** se for (B), a taxa de resposta de **todas** as campanhas está subestimada, e qualquer decisão de copy tomada em cima desse número foi tomada em cima de dado errado.
  - **ATUALIZAÇÃO 18/08/2026 — a hipótese (B) ganhou um suspeito concreto.** A auditoria achou que `checarCampanhaAguardando()` (a rotina que reporta resposta de lead ao JOB) estava **desligada** para quem entrou pelo login de e-mail/senha: ela exigia a chave antiga `extKey`, que o login novo nunca grava. Mesma trava matava o batimento de presença, então o consultor ainda contava como offline na roleta. Corrigido na extensão **4.98.0** — mas **o número só volta a ser confiável depois que todos atualizarem**. Não tomar decisão de copy com dado anterior a isso. Ver a seção de 18/08 no fim deste arquivo.

## CRM (feedback Danilo — checklist atualizado 03/07/2026)

- [x] ESC fecha modais (global, todas as páginas)
- [x] Fuso horário: todas as horas em São Paulo (timeline mostrava UTC, 3h à frente)
- [x] Atribuição de consultor determinística (primeiro nome exato; ambíguo não atribui)
- [x] Notificações também vão ao WhatsApp do consultor via WaSpeed (requer env WASPEED_TOKEN)
- [x] **Atividades futuras / agenda**: agendar na ficha do lead (data/hora + assunto); página /crm/agenda (atrasadas/hoje/próximas, admin vê de todos); lembrete automático no sino + WhatsApp via WaSpeed ~30 min antes
- [x] **Transferência em massa de leads**: filtros por etapa/data/busca, selecionar "de" e "para" consultor, transferir N leads de uma vez (admin only) com registro na timeline
- [x] **E-mails de correção de contato**: 2 templates (telefone incorreto / sem sucesso), e-mail bonito, rastreio de abertura (pixel /t/) e clique (redirect /r/ → wa.me do corretor); avisa no sino+WhatsApp quando o cliente abre/clica. Construído e no ar desde 02/07 — no checklist do Danilo de 03/07 ainda aparece como pendente, provavelmente ele não testou/validou ainda. Confirmar com ele
- [x] Notificação de lead parado 7+ dias sem atividade (resumo diário 09:00 por consultor)
- [x] **Valor Estimado em formato brasileiro**: campo era `type="number"` (padrão americano, ponto decimal) na ficha do lead — agora aceita vírgula/ponto de milhar como o resto do sistema
- [x] **Lembrete de atividade no WhatsApp do consultor** (esclarecido 03/07 — não é o WhatsApp com o lead, é o lembrete automático da agenda pro consultor): WASPEED_TOKEN configurado em produção (Railway) e testado ao vivo — mensagem real enviada com sucesso pro WhatsApp do Danilo (19 99216-3663) com o formato "JOB Serenus - assunto da atividade". A partir de agora todo lembrete de agenda (30 min antes) e notificação (lead parado, comissão, etc.) chega de verdade no WhatsApp de cada consultor, partindo do número do Guilherme via WaSpeed. Nova rota `/admin/testar-whatsapp` fica disponível pra diagnóstico futuro
- [ ] **WhatsApp — evolução (mensagem direto com o lead)**: já existe mais do que o esperado — 3 templates rápidos na ficha do lead, envio via WaSpeed, e toda mensagem ENVIADA já é registrada na timeline. O que falta de fato: (a) não há captura de mensagens RECEBIDAS do lead — a timeline só mostra o que o consultor mandou, sem as respostas dele (precisaria de webhook do WaSpeed para inbound); (b) só 3 templates fixos, sem tela de gestão pra criar/editar novos
- [x] **Sub-status dentro da coluna do funil** (Gabriel, PDF 04/07): Follow up 1/2/3, Aguardando resposta, Sem interesse — select direto no card do Kanban (sem abrir a ficha), + filtro por status na busca
- [x] **Card muda de cor conforme tempo sem ação** (Gabriel, PDF 04/07): 2+ dias sem nenhuma atividade = "esfriando" (amarelo), 5+ dias = "frio" (vermelho), baseado no último `atualizado_em` do lead
- [x] **BotConversa — botão de abrir conversa direto do lead** (Gabriel, PDF 04/07): API oficial mapeada (ver [[canais-whatsapp-por-consultor]]); `subscriber_id` da API não serve como `chat_id` da URL (confirmado testando ao vivo), solução foi busca por telefone dentro do inbox (`?search=telefone`). Aparece só pras leads das 3 consultoras que usam BotConversa
- [ ] Enviar mensagem automática por mudança de etapa via BotConversa — depende de decidir regras (qual etapa dispara qual mensagem)

## Cotação

- [x] Ordenar por operadora A-Z + menor preço; badge segue o mais barato
- [x] Logos com fallback (uploads sumidos pré-volume)
- [x] **Destaque por cores (básico)**: botão "Destacar planos" no documento liga/desliga contorno colorido automático por operadora (cor fixa por plano, definida no `_build_cot`)
- [x] **Gerar cotação abre em nova página** (feedback Danilo 03/07): o formulário de gerar cotação navegava na mesma aba, substituindo o construtor. Agora abre o documento em aba nova (`target="_blank"`), mantendo o construtor intacto pra criar outra cotação em seguida
- [x] **Botões do documento renomeados** (03/07, achado ao investigar pedido do Guilherme sobre links duplicados): "Editar valores" → "Corrigir valor (mesmo link)" com confirmação explícita antes de salvar; "Nova versão" → "+ Nova cotação (link novo)" — ficava fácil clicar no errado achando que ia gerar uma cotação nova e sem querer alterar a que já foi mandada pro cliente
- [x] **Material de apoio — upload não falha mais em silêncio**: se o arquivo não conseguir subir (R2/disco), agora avisa na tela em vez de salvar o item sem o arquivo sem dizer nada
- [x] **Pastas do material de apoio**: agora dá pra criar pasta vazia dentro de uma operadora (nova ou existente) pra organizar antes de ter conteúdo — igual ao Painel do Corretor. Botão "+ Pasta" na sidebar e dentro de cada operadora; exclui pasta vazia
- [x] **Link público limpo pro cliente** (Gabriel, PDF 04/07): removidas as ferramentas internas do corretor (Destacar planos, Legenda, Copiar imagem, Baixar, PDF) da view pública — só a view logada do corretor continua com tudo. Adicionados botões "Gostei dessa proposta" / "Me explique mais essa opção" (deixando claro que não é a contratação), clique avisa o corretor e registra na timeline do lead
### Auditoria de segurança da cotação (17/08/2026)

Varredura das 8 regras do roadmap de cotação. 34 achados confirmados, 17 refutados.
Corrigidos e travados em `testes/testar_auditoria_seguranca.py` (35 verificações):
credencial fora do repositório, árvore de sessão do Painel barrada em duas camadas,
interface parou de ensinar consultora a abrir o Painel, motivo real da falha chegando
à tela, ao vivo antes do banco na tela do site, cache sem renovar a própria data, e o
ciclo de vida da fila (relógio pytz, posse, retenção, requeue, conexão vazando).

Ficaram três, cada uma por um motivo:

- [~] **Cada clique em "Ver preços" cria 3 cotações no Painel da Trindade** — estudado a fundo em 18/08/2026. **Decisão do Guilherme: deixar parado até dar pra testar com o Painel aberto.** O rastro acumula devagar; quebrar a cotação atinge alguém no meio de um atendimento. Não vale trocar um risco lento por um imediato sem conseguir provar.
  - **Confirmado no código:** `precos_lote` chama `criarCotacao()` incondicionalmente, sem reuso (`extensao-whatsapp/cotador-painel.js:1142`). Frentes = `min(3, planos)` sobre lista cortada em 6 (`background.js:307,313`). As 3 "frentes" usam a MESMA aba (`background.js:294-303`) — separar cotação é o que as isola, não a aba. Título com o nome do cliente, três iguais, 180 ms de intervalo fixo (`background.js:347`) — a única cadência determinística de um sistema em que todo o resto é sorteado.
  - **É regressão de 17/08, não dívida antiga.** Nasceu em `b6ba565` (14:34) e `1f8d0ba` (14:55). Antes, `_cotPrecos` usava `acao:'preco'` com o `cotacaoId` da abertura: um atendimento inteiro era UMA cotação. O multiplicador tem 1 dia — não há backlog grande para limpar.
  - **NÃO FAZER: uma cotação compartilhada pelas 3 frentes.** Era o que estava escrito aqui antes e está errado. O preço é lido do HTML da tela e descoberto **por diferença** contra a resposta anterior, porque não há etiqueta ligando preço a plano (`cotador-painel.js:484`). Frentes concorrentes na mesma cotação devolvem preço certo no plano errado, **em silêncio**, indo para a proposta do cliente. Já aconteceu e foi corrigido em `4b4f01c` (10/08).
  - **Saída recomendada quando der:** uma frente, em série. É o caminho que já roda hoje quando o consultor pede um plano só. Custo estimado (NÃO medido): +0,16 s com 3 planos, +0,68 s com 6. Ganho: 3 → 1 cotação por clique e 21 → 11 chamadas ao servidor deles num lote de 6 — as 5 chamadas de montagem por frente são o desperdício, não os preços.
  - **Melhor ainda, mas com armadilha:** uma cotação por ATENDIMENTO (voltar ao de antes de `b6ba565`). Fica mais rápido que hoje, mas o "preço anterior" vive só na memória da aba (`_cartoesPorCotacao`) — se a aba recarregar no meio, o preço seguinte pode sair errado calado. Resolver isso antes.
  - **Não dá pra saber daqui:** quantas cotações já existem na conta (o id é descartado em `background.js:352` — hoje não dá nem para contar nem para apagar depois), nem se o sistema deles distingue cotação vazia, tem limite ou expurga sozinho. Só olhando a conta.
  - **A regra já estava escrita** em `cotador-painel.js:795` e `:948` ("dezenas de cotações vazias... rastro puro, e do tipo que fica"). O caminho do preço foi o que escapou dela.
- [x] **Busca de cidade pela sessão local** — ENCERRADO em 18/08/2026 pelo Guilherme: está funcionando na extensão de todos, não gastar tempo com isso. Era a única exceção que não passa pela fila (`extensao-whatsapp/background.js`, a guarda `if (!_souTrabalhador && msg.type !== 'cotador_cidades')`), criada de propósito no `7fe675e` para resolver a latência do heartbeat. Na prática não muda nada para quem não tem o Painel aberto: sem aba, a extensão já cai na fila sozinha. Se aparecer de novo numa varredura, é decisão consciente — não pendência.
- [ ] **`-w 1` no gunicorn: o reciclo por `--max-requests` para o site inteiro** (`Procfile`). Sem segundo worker, o processo sai e o substituto importa 49 mil linhas antes de responder — "o sistema travou por alguns segundos", sem erro no log, várias vezes por dia. Subir para `-w 2` **não pode ser feito hoje**: `_FILA_ESCUTAS_ATIVAS` é um set em memória de processo, e com dois workers cada um teria o seu — a mesma sessão abriria uma escuta por processo e prenderia 2 threads. A proteção precisa migrar para o banco antes. E o roadmap manda reavaliar infra só depois de 24h de medição.

- [ ] Destaque avançado no documento (correção 03/07: o básico já existe, isto é sobre a versão avançada) — o que falta de fato: escolher manualmente qual linha/coluna destacar (ex: só a acomodação ou só o copart de um plano específico), misturar cores por célula em vez de 1 cor fixa por plano inteiro, e permitir vários destaques simultâneos na mesma coluna
- [ ] UX da montagem da cotação (Guilherme acha confusa; referência: Painel do Corretor) — sem escopo definido, precisa de conversa
- [ ] Filtro por região/CEP e cotação com dependentes — confirmado: nenhum dos dois existe hoje em `/cotacao`
- [ ] Validade da cotação (data de expiração exibida ao cliente no documento) — correção 03/07: "vigência" já existe, mas é campo da TABELA de preços (mês de referência, ex: "07/2026"), não uma data de validade da cotação em si mostrada pro cliente. São coisas diferentes, isto aqui ainda não existe
- [ ] Evitar tabelas duplicadas no import — confirmado: hoje só existe limpeza manual reativa (`/admin/emergency/limpar-duplicatas`), sem nenhum aviso preventivo no momento do import. Precisa checar operadora+plano+copart antes de salvar e avisar se já existe
- [ ] Material de apoio: link público para enviar item ao cliente — confirmado: não existe rota pública hoje (`/material-apoio` é só interno, login obrigatório; o módulo em si — pastas por operadora/tipo, editor de texto rico — já existe e está completo). Seguiria o mesmo padrão já usado em `/c/<token>` (cotação) e `/u/<token>` (upload de comprovante)

## Financeiro

- [x] Custos com justificativa: quem pagou (Gabriel/Guilherme/Karen/Danilo/Bianca/Caixa) + fonte (Caixa ou Terceiro) + comprovante anexado
- [x] Comprovante pelo celular: link tokenizado /u/<token> com QR — abre a câmera, fotografa e sobe direto

### PRD Módulo Financeiro (Gabriel/Karen, jul/2026) — `knowledge/prd-financeiro.docx.md`

- [x] **Fase 1** (04/08/2026, commit `0540827`): campos centro_custo / tipo_lancamento / canal_midia; filtro de faixa de vencimento (01-10, 11-20, 21-31, próximos 7 dias, VENCIDAS) + centro + status + tipo + meio de pagamento; status **Vencido calculado** (nunca gravado — gravar viraria mentira com data de validade); calendário de vencimentos por dia
- [ ] **BACKFILL — bloqueia a Fase 2.** Medido em produção 04/08/2026: **51 de 51 lançamentos sem `centro_custo` E sem `tipo_lancamento`**; 14 dos 51 também sem `data_vencimento`. Total parado: R$ 28.156,60 (37 custos = R$ 21.156,60 + 14 fixos = R$ 7.000,00).
  Consequência: os dashboards da Fase 2 (pizza por centro, mídia ÷ receita, Fixo × Ferramentas × Mídia) saem **vazios ou pela metade** até isso ser preenchido — não é um detalhe cosmético, é o eixo de corte de todos eles.
  Padrão sugerido (mutirão com sugestão por palavra-chave + confirmação em lote, igual ao mutirão de motivo de perda do CRM). Mapeamento inferido das planilhas e das descrições reais:
  - **Estrutura** — ALUGUEL (R$ 8.250 em 3 lanç.), CONDOMINIO (R$ 685,78), MOVEIS FREITAS (3× R$ 1.167), MOVEIS PARAISO (4× R$ 600), FRIGOBAR, MESA RECEPÇÃO
  - **Pessoal** — FIXO JULIANA AZEVEDO (6× R$ 500), FIXO JENIFER (4× R$ 500), demais "FIXO <nome>"
  - **Ferramentas** — hosting, Agger, WaSpeed, Funenseg
  - **Mídia** — Meta e Google Ads (+ `canal_midia`); é o bloco de 64% do gasto segundo o PRD
  - **Impostos** — a confirmar; ADVOGADO GABRIEL (2× R$ 1.250) provavelmente Estrutura, não Imposto — **perguntar antes de assumir**
- [ ] **Fase 2** — dashboards de despesa e receita, fluxo de caixa projetado, DRE gerencial (aproveitar a aba DRE que já existe)
- [ ] **Fase 3** — dashboards de mídia (CPL, CAC, ROI/ROAS, payback), alertas automáticos, indicadores (runway, break-even). Depende da conversão offline/gclid pra CPL e CAC fazerem sentido
- (?) PRD recomenda **centralizar a mídia num único meio de pagamento** — hoje está em 3 cartões (Porto, BB, Renner), o que dificulta conciliação. Decisão do Gabriel, não técnica

## Estratégicos (aguardando lapidação com o Guilherme)

- (?) **RevOps de raiz** — correção 03/07: já existe uma base real, não é do zero. `/crm/painel` (desde 28/06) já mostra KPIs (total, abertos, ganhos, perdidos, taxa de conversão, sem 1º contato, pipeline estimado), funil por etapa, leads por origem com conversão, ranking de consultores e motivos de perda, com filtro por período. O que falta pra virar "funil único MKT→Vendas→CS de raiz": estender a medição pra além do CRM (cotação → proposta → pós-venda/renovação), metas por etapa, receita por canal de origem
- (?) **Manual de utilização** por perfil (admin / consultor / supervisora) — didático, dentro do sistema. Nada construído ainda
- (?) **IA interna (Llama 3/3.1)** — casos de uso e hospedagem a definir. Nada construído ainda
- (?) **Financeiro + BI ampliados** — correção 03/07: `/financeiro` já tem DRE mensal e comissões a receber por mês; `/bi` já tem evolução mensal, produção por consultor, detalhamento por operadora e por modalidade. Não é blank slate — falta o Guilherme dizer especificamente o que sente falta que essas telas não cobrem hoje
- [ ] Sincronização de comissões com Google Sheets — correção 03/07: **não encontrei nenhum código nem commit correspondente no repositório.** A nota "código preparado em sessão anterior" no roadmap anterior não bate com o histórico real (228 commits revisados) — pode ter sido perdido, nunca commitado, ou é uma informação incorreta que entrou no roadmap por engano. Tratando como não iniciado até confirmação
- [ ] Google Drive OAuth para contratos (baixa prioridade) — nota: Google Drive foi removido do sistema em 19/06/2026 (commit `117c0c7`, motivo: manter só armazenamento local/R2); este item seria uma reintegração pontual só pra contratos, não o Drive completo de volta

## Infra / qualidade

- [x] Notificações (sino) — cotação aberta, proposta nova, comissão liberada/paga, leads importados
- [x] Sino na sidebar (não sobrepõe conteúdo) + som ao chegar notificação
- [x] Datas em dd/mm/aaaa nas listagens (financeiro, fluxo, detalhe, cotações salvas)
- [x] Modo claro com contraste completo
- [x] Leads automáticos das planilhas (pull 15 min + por request + botão)
- [x] Emojis removidos de toda a interface
- [x] Código morto removido (scheduler duplicado, migração legada)
- [ ] Dividir app.py em módulos (blueprints) — refactor grande, planejar janela. app.py está em 11.317 linhas (era ~10.4k), só cresce
- [ ] Testes automatizados mínimos (smoke test de rotas) rodando antes do deploy — confirmado: zero arquivos de teste no repo hoje
- (?) **Migrar Postgres do Railway pra banco na VPS** (pedido do Gabriel via PDF, 04/07/2026) — mais segurança e possibilidade de escala. Guilherme confirmou: não é pra agora, "vamos conversar mais pra frente" — só registrar como pendência, não iniciar sem sinal verde

## Biblioteca de Conteúdo (reorganização de 12/08/2026)

Feito na branch `worktree-biblioteca-conteudo` (fases 0 a 3 do handoff). Relatório
de auditoria, decisões e passo a passo de reprodução em
[handoff/biblioteca-conteudo-relatorio.md](handoff/biblioteca-conteudo-relatorio.md).

- [x] **Rede de segurança antes de mexer**: inventário de quem lê e escreve nas tabelas da biblioteca (`handoff/biblioteca-conteudo-inventario.md`), `scripts/inspecionar_biblioteca.py` (foto somente leitura, compara antes/depois) e `testes/testar_biblioteca.py` (92 verificações em SQLite, banco novo a cada rodada)
- [x] **APIs por proprietário**: árvore (Compartilhado + pasta-mãe por consultor, criadas de forma idempotente), listagem por pasta/canal/busca paginada, e mover, transferir, copiar e duplicar com efeitos distintos. Mover e transferir preservam o ID — é o que mantém `fluxo_passos.template = upload_<id>` válido
- [x] **Transferência de funil valida as dependências**: funil que usa mensagem de outro dono devolve a lista e exige escolher entre transferir ou copiar as mensagens; nunca cria funil quebrado em silêncio
- [x] **Tela `/crm/modelos` reconstruída**: árvore de proprietários fechada por padrão, canal como filtro (WhatsApp, SMS e e-mail convivem na mesma pasta), vínculos "usado em N funis/fluxos" visíveis, e mover/transferir/copiar/excluir em folha própria, sem `alert()`/`confirm()`
- [x] **Buraco de permissão fechado**: editar, excluir, desativar, favoritar e mover de pasta passaram a checar o dono. Antes, consultor com o módulo liberado mexia no conteúdo de qualquer colega pelo site
- [x] **Extensão alinhada**: Mensagens e Funis abrem em Minha biblioteca e Compartilhado, com as pastas do JOB fechadas; busca e filtro abrem as pastas com resultado. Medido com 400 mensagens: mediana 4ms antes e depois, p95 8ms → 5ms, resposta +4,3%
- [x] **Bancada de telas do site** (`scripts/bancada_biblioteca.py`): renderiza a tela com o Flask de verdade e fotografa nos dois temas em 1440, 1024, 768 e 375
- [ ] Fase 4 — busca contextual no compositor da extensão (sugerir conteúdo enquanto digita, nunca enviar sozinho)
- [ ] Fase 5 — gatilhos e Fluxos como dois projetos separados (nunca ativos por padrão; persistência e log antes de qualquer grafo visual)
- [ ] Fase 6 — governança (rascunho/aprovado/arquivado, detecção de duplicado sugerindo, nunca removendo) e recomendação de conteúdo
- [ ] Publicar a extensão: a mudança de Mensagens/Funis exige subir versão no `manifest.json` (hoje 4.94.0) e enviar manualmente à Chrome Web Store

## Extensão — memória e travamento (levantamento iniciado 10/08/2026)

> Guilherme, 10/08/2026: *"como deixamos a extensão melhor em termos de não
> travar e devorar a RAM do computador?"* — e, na mesma conversa, o Chrome dele
> avisando **"uso elevado da memória: 2,3 GB"** na aba do WhatsApp.
>
> **RESOLVIDO em 10/08/2026, com medição antes e depois.** O que sobrou de
> pendência está no fim desta seção.

### O resultado, medido nas duas pontas

| | antes | depois |
|---|---|---|
| Pior caso de uma passada | **340 ms** | ~70 ms |
| Procurando a bolha | **280 ms** (82% do total) | **12 ms** |
| Memória da aba | 1,2 GB | (não era a causa) |

**A causa não era a memória, e não era a quantidade de medição — era a
INTERCALAÇÃO.** O laço media a bolha, inseria o bloco, media a próxima. Cada
inserção invalida o layout que a leitura seguinte precisa, então o navegador
recalculava a página inteira a cada linha. Trinta linhas entrando numa rolagem
custavam trinta recálculos completos.

O conserto (4.57.0) foi mover todas as medições para antes da primeira
escrita. O laço que desenha continuou idêntico — mudou **quando** a pergunta é
feita, não a resposta.

**A lição que vale mais que o conserto:** o dossiê de mercado apontava
`subtree: true` e leitura de DOM como o vilão, e propunha reescrever o coração
da extensão. O número mostrou que o gargalo era outro, e a correção coube em
duas fases dentro de uma função. **Medir primeiro economizou semanas de
reescrita — e a reescrita teria atacado a peça errada.**

### O que já se sabe, medido ou lido no código

- **2,3 GB numa aba** — aviso do próprio Chrome, print do Guilherme. O teto de
  uma aba fica perto de 4 GB, e ao encostar nele ela morre com a tela
  "Ah, não! Código de erro: 5", que ele já viu duas vezes hoje.
- **A extensão já se mede**: passadas, linhas varridas, linhas puladas, tempo
  total e PIOR CASO. Está em Configurações → Diagnóstico, e desde 4.52.0
  mostra também a memória da aba. **Ninguém nunca abriu.** Esse número decide
  se o problema é nosso: pior caso < 50ms e não é; > 200ms e é.
- **O que o Antigravity propôs no dossiê já existe** (debounce de 400ms em
  `trAgendarInjecao`, `Set` de dedup, marca `_jobPronta` por linha). E ele leu
  a versão 3.21.0 — a atual é 4.55.0. Só a ideia de ler módulos em vez de HTML
  é nova, e a `wa-js` já faz isso pra áudio e documento.

### Suspeitos levantados (crescem e não se sabe se são soltos)

Achados por varredura, **ainda não confirmados como vazamento**:

- `TR.cache` — transcrições por `msg_id`. Só perde item quando falha.
- `_cvCache` (`content.js`) — imagens decodificadas do desenho da cotação.
- `_cotLogos` — logos em data URL, memória da aba.
- `DOC.estado` / `_docCrono` — estado por documento.
- `_analises` — uma entrada por análise, com o resultado inteiro dentro.
- `_SAUDE`, `_errosReportados`, `_pastasAbertas` — pequenos, mas sem teto.

Existe um utilitário de poda em `content.js:215-225` (apaga do Map e limpa o
Set quando passa de um teto) — **usado em alguns lugares e não em outros**.
Metade do trabalho pode ser só aplicar o que já existe.

### O que continua pendente (e não é urgente)

1. **A memória em si.** 1,2 GB numa aba continua alto, mas **não era a causa do
   travamento** — o travamento era layout. Vale confirmar quais estruturas
   retêm de verdade (tamanho, não contagem: `_cvCache` com cinco imagens pesa
   mais que `TR.cache` com quinhentas transcrições) e aplicar teto com o
   utilitário que já existe em `content.js:215`.
2. **Sobra uma intercalação menor**: depois de inserir o bloco, o código
   pergunta à tela se ele pintou (`getClientRects`). É outro recálculo, mas só
   nas linhas com documento — poucas. Só mexer se o número voltar a subir.
3. **Ler módulo em vez de DOM** (a ideia boa do dossiê) deixa de ser urgente:
   o gargalo que a justificava caiu 23×. Fica como melhoria de arquitetura,
   não como conserto.

### O que já foi feito e conta como parte disso

- 4.41.0: análise parou de rebaixar áudio já transcrito (cache por `msg_id`).
- 4.42.0: imagem da cotação desenhada em canvas à mão, não com html2canvas —
  118ms contra travar o WhatsApp inteiro.
- 4.52.0: memória da aba no Diagnóstico.

## BotConversa (integração — em construção a partir de 04/07/2026)

- (?) API oficial mapeada: `POST /subscriber/{id}/send_message/` (mandar msg automática por etapa do CRM), `POST /subscriber/{id}/change_conversation_status/` (atribuir atendente via campo `manager`), `GET /subscriber/get_by_phone/{tel}/` (achar contato pelo telefone do lead). Auth: header `API-KEY`. Limite 600 req/min. Exige `has_opt_in_whatsapp:true` ao criar contato (política Meta)
- Limitação confirmada: **não existe webhook oficial documentado pra saber quando o cliente responde** — API é só de saída (JOB → BotConversa). Não dá pra sincronizar resposta do cliente automaticamente
- [~] Botão na ficha do lead pra abrir a conversa do BotConversa em popup (URL+ID do lead/subscriber) — pedido 04/07/2026, em construção
- [ ] Enviar mensagem automática por mudança de etapa do CRM — depende de decidir regras (qual etapa dispara qual mensagem) e ter a chave API de produção
- [ ] Sincronizar atendente responsável (JOB responsavel_id → BotConversa manager) — só faz sentido pras 3 consultoras que usam BootConversa (Prisciele/Juliana/Jenifer), ver [[canais-whatsapp-por-consultor]]

## HANDOFF — Cotação, segurança e wa-js (17/08 18h → 18/08 11h25)

Sessão paralela à de baixo (não a mesma). Escopo: o bug do Danilo na cotação,
a auditoria de segurança das 8 regras do roadmap de cotação, e a atualização da
wa-js depois do canário acusar quebra. **Sem incidente em produção** — pode ler
depois do handoff da tarde, que é o urgente.

### Histórico da sessão, em ordem

| Quando | Duração aprox. | O que |
|---|---|---|
| 17/08 ~17h45–18:02 | ~15 min | Diagnóstico e correção do bug do Danilo: `cotador_precos_paralelos` fora da lista de tipos aceitos pela fila — preço nunca chegava a ser pedido, caía como `painel_fechado` |
| 17/08 18:02 | — | Deploy `13aa4fa`, confirmado no ar |
| 18/08 00:01–00:22 | ~35 min | Auditoria completa das 8 regras (workflow, 38 agentes): 34 achados, 17 refutados. Correções em 6 commits — credencial, vazamento de sessão do fornecedor, textos que ensinavam a abrir o Painel, motivo real da falha, ciclo de vida da fila, relógios |
| 18/08 00:22–00:52 | ~30 min | Cobrança do Guilherme sobre vazamento do nome do fornecedor → varredura e correção em 40 pontos (`b858b26`); descoberta e correção do bug da acomodação vazia (`cc040a1`) |
| 18/08 00:52–01:37 | ~45 min | Segunda rodada da acomodação (causa raiz completa, `4169ba6`); estudo somente-leitura das 3 cotações vazias por clique (workflow, 6 agentes) — decisão do Guilherme: deixar parado; registro no ROADMAP |
| *(gap — sessão ociosa; outras sessões trabalharam no projeto nesse intervalo)* | | |
| 18/08 ~11h00–11:25 | ~25 min | Canário da extensão acusa quebra (`achar_msg`, `conta`). Diagnóstico: não fomos nós — wa-js 4.6.0 corrige exatamente a área. Baixado do release oficial, SHA256 conferido, contrato de API testado, deploy. Decisão da busca de cidade registrada como encerrada |

**Tempo de trabalho ativo estimado: ~2h30min**, espalhado por ~17h de relógio
(o Guilherme dormiu no meio). Não inclui o tempo dos workflows em si rodando em
segundo plano (~40 min de agentes, paralelos ao resto).

### O que foi corrigido (29 de 34 achados da auditoria)

- **Crítico:** senha do Postgres em texto puro em 2 scripts do repositório
  (`check_railway_db.py`, `import_propostas_from_sqlite.py`) — removida do
  código, mas **a senha antiga só perde validade quando for trocada no
  Supabase** (ver pendências).
- **Crítico:** em erro, a extensão mandava a árvore de sessão do Painel
  (`next-router-state-tree`) pro nosso servidor, gravada em
  `cotacao_fila.resultado_json`. Barrado em duas camadas (extensão e
  servidor) para não depender de todo mundo estar na versão nova.
- **Crítico → depois achado maior:** a interface ensinava a consultora a
  abrir o Painel do fornecedor ("faça o login"), em 3 lugares. Corrigido, e
  depois de cobrança, varrido em **40 pontos** — inclusive comentários dentro
  de `<script>` inline, que são servidos no HTML e aparecem em "ver
  código-fonte". Travado em `testes/testar_blindagem_fonte_preco.py`.
- **Alto:** a tela de cotação do site respondia da tabela salva sem tentar o
  Painel ao vivo, e preço de tabela era gravado como se fosse ao vivo — com a
  data renovada, então o alerta de preço desatualizado nunca disparava.
- **Alto → dois bugs, não um:** a linha "Acomodação" saía em branco no
  documento do cliente. Causa: comparação `is True`/`is False` não pegava
  valores `1`/`0` vindos de JSON. Não era regressão desta sessão isolada — o
  bug nasceu em `621bbd7` (17/08 à tarde) — mas **minha própria mudança
  (`b0ddc3e`) expôs o bug**, ao rotear Saúde Beneficência e MedSênior pelo
  caminho ao vivo (onde o campo falta) em vez do banco (onde é texto e
  funcionava). Corrigido: aceita `1`/`0`, consulta a base quando falta, e o
  aprendizado automático parou de chutar `'Enfermaria'` quando não sabe.
- Motivo real da falha chegando à tela em vez de "tente novamente" genérico;
  relógio pytz errado em 6 min; posse de pedido da fila; retenção; conexão de
  banco vazando; ordem dos timeouts da fila estava invertida.
- **wa-js 4.5.0 → 4.6.0** (depois virou 4.6.0 dentro da extensão 4.97.1, hoje
  carregada por trás da 4.98.0 de outra sessão — o bundle não foi tocado por
  ela). Baixado do release oficial, SHA256 conferido byte a byte, contrato de
  API testado (`testes/testar_wajs_contrato.py`).

Tudo travado em teste: `testar_auditoria_seguranca.py`,
`testar_blindagem_fonte_preco.py`, `testar_acomodacao_documento.py`,
`testar_documento_acomodacao.py`, `testar_wajs_contrato.py`, mais o
`testar_cotacao_e_catalogo.py` que estava quebrado desde antes e foi
consertado no caminho.

### O que aprendemos

1. **Sintoma genérico esconde causa específica.** "Tente novamente" e
   "Painel fechado" cobriam ~5 causas diferentes, 3 delas impossíveis de
   resolver tentando de novo. Isso adiou o diagnóstico do Danilo e teria
   adiado outros.
2. **Minha primeira recomendação para as cotações vazias estava errada.** Eu
   ia sugerir uma cotação compartilhada entre as 3 frentes paralelas — o
   estudo mostrou que isso reintroduziria um bug já corrigido em `4b4f01c`
   (preço colado no plano errado, em silêncio). Só a leitura funda evitou
   entregar uma correção pior que o problema.
3. **"Não é regressão de hoje" precisa ser checado, não afirmado.** Eu disse
   isso sobre a acomodação e estava certo sobre a origem do bug, mas errado
   sobre o efeito — minha própria mudança de horas antes foi o que expôs o
   bug antigo na prática. Corrigi publicamente quando o Guilherme perguntou.
4. **Blindagem do nome do fornecedor tem armadilha em comentário.** Código
   dentro de `<script>` inline nos templates Jinja é servido no HTML — um
   comentário meu, escrito para explicar a correção, vazou o próprio domínio
   que eu estava tirando.
5. **Trabalho em paralelo é a realidade agora.** Múltiplas sessões mexem no
   mesmo repositório ao mesmo tempo. Antes de reportar estado ou subir
   qualquer coisa, sincronizar com `origin/main` primeiro — encontrei
   commits novos duas vezes nesta sessão sem esperar por eles.

### PENDENTE

- [ ] **Rotacionar a senha do Postgres no Supabase** · só o Guilherme pode
  fazer · **~5 min** · a única ação que continua exposta até ser feita.
- [ ] **Testar a wa-js 4.6.0 contra o WhatsApp real** · aguardando
  confirmação — não recebi retorno se o canário voltou ao verde depois do F5
  · **~5 min** de teste, quando o Guilherme puder.
- [~] **3 cotações vazias por clique no Painel** · decisão: parado até dar
  pra testar com o Painel aberto · **~20–30 min** quando houver a janela ·
  ver análise completa na seção Cotação acima (NÃO fazer cotação
  compartilhada — está escrito lá o porquê).
- [ ] **`gunicorn -w 1`: reciclo trava o site inteiro por alguns segundos,
  várias vezes por dia** · precisa tirar `_FILA_ESCUTAS_ATIVAS` da memória do
  processo antes de poder subir pra `-w 2` · sem prazo definido, é infra ·
  estimativa grosseira não medida, ~1–2h.

## Inteligência de Vendas, leitura de conversa e falha silenciosa (18/08/2026)

Sessão longa que começou em "arruma a página de Inteligência de Vendas" e virou
uma caçada a uma classe de defeito: **o sistema parar de funcionar sem ninguém
ficar sabendo**. Sete commits no ar. Tudo abaixo foi medido contra o banco de
produção, não deduzido.

### O que foi feito

- [x] **Inteligência de Vendas mostrava 1 venda; passou a mostrar 71.** A página
  contava `status_operacional='Emitida/Ativa'`. Das 71 propostas vivas, 48
  estavam no valor DEFAULT da coluna e 1 em Emitida/Ativa — a tela media a
  disciplina de preencher a esteira, não a venda. Base agora é toda proposta
  viva (não excluída, não estornada), que é o que "Proposta cadastrada" já
  significa no próprio JOB.
- [x] **O cruzamento com a análise de conversa casava por telefone, e o telefone
  morreu com o @lid.** 1992 das 2033 análises têm `telefone_norm` vazio; 2000
  têm `lead_id`. Trocando a chave, 21 vendas ganham análise (por telefone eram
  3). Objeções, cidade, score e tempo até fechar eram painel vazio por
  construção.
- [x] **A página deixou de olhar o andamento da proposta** (decisão do Guilherme,
  18/08: "essa parte de status é desnecessária, não temos usabilidade"). No
  lugar entrou **"O perfil de quem contrata"**: fatores lidos do CADASTRO da
  proposta, que existem para as 71 e não só para as 21 com conversa — vidas,
  idade do titular na data da venda, valor mensal, acomodação, coparticipação,
  modalidade. Cada painel declara sobre quantas vendas conseguiu medir.
- [x] **`/ebook-vendas`** — o material de treino montado na hora das vendas
  reais, em 4 capítulos, com `@media print` próprio (o navegador é o gerador de
  PDF; biblioteca nova no Railway seria custo sem ganho).
- [x] **Fila obrigatória de leitura das vendas fechadas.** Toda proposta nova já
  nasce enfileirada; lote com prioridade passa na frente da varredura
  exploratória; idempotente. Reusa o protocolo que a extensão já tem — zero
  código novo nela.
- [x] **Pendências no sino** — notificação que só sai quando o problema acaba.
  Tem `chave` (identidade do problema), `como_resolver` escrito junto, e não
  tem botão de dispensar de propósito. Marcar como lida NÃO tira do sino nem do
  contador. Dois detectores ligados: extensão abaixo do mínimo (em duas
  gravidades) e leitura de conversa calada 6h+ em horário comercial.
- [x] **Tela "Está rodando agora?"** em Configurações: por pessoa, último sinal,
  versão, quantas leu hoje e o MOTIVO REAL de não estar rodando. Fecha dizendo
  onde cada coisa mora (conversa → análise → mensuração → inteligência).
- [x] Barra de filtro do `.toolbar` endireitada no `base.html` (a regra global
  dava largura total a todo `<select>`; qualquer tela com filtro de select
  virava uma pilha).
- [x] Tabela de log do Ghostwriter: `criado_em` estava escrita duas vezes no
  CREATE do PostgreSQL. Em produção era só barulho (a tabela já existia), mas
  num banco NOVO ela nunca seria criada — e isso importa com a venda para outras
  corretoras.

### O apagão de 7 dias, e a causa raiz

A varredura automática **parou em 11/08 às 17:17 e ficou até 18/08 sem ler uma
única conversa**, com a tela de configuração mostrando tudo ligado e 5
consultores marcados. Ninguém percebeu.

Causa: `/api/whatsapp/config-remota` respondia `pode_rodar=False,
motivo='nao_autenticado'` **cravado**, para todo mundo, para sempre. A decisão
por consultor tinha saído dali por um motivo correto (a rota é pública e a
decisão por usuário deixava enumerar quem existe) — mas nada colocou ela de
volta. `rodar_agora` era derivado do mesmo motivo cravado: o botão "Rodar agora"
apertado em 12/08 não fez nada.

Custo real da leitura, para dimensionar: **1.922 análises em agosto por US$ 4,40**
(US$ 0,0023 por conversa). Custo nunca foi a restrição.

### A regra que ficou (inegociável)

**Versão nova melhora; versão velha NÃO PARA O TRABALHO.**

O primeiro conserto do apagão exigiu uma rota que só a 4.96 conhece — e com isso
toda extensão anterior parou de ler conversa. Guilherme cortou: *"as novas
versões devem sempre melhorar a usabilidade, mas não podem impedir o trabalho no
dia a dia; temos que extrair o mínimo possível, ou notificar que aquele usuário
está abaixo do mínimo aceitável"*.

Implementado em `EXT_VERSAO` (app.py):

- `bloqueia_abaixo` (3.27.0) — **único** caso em que bloquear vence rodar, porque
  abaixo disso a leitura grava dado errado (1 mensagem por conversa, sem dono) e
  o estrago é permanente e silencioso.
- `ideal` — abaixo disso trabalha reduzido e **abre pendência**. Nunca bloqueia.

E as duas gravidades têm textos diferentes de propósito: a travada diz que
parou, a atrasada diz que continua trabalhando. Pintar as duas de vermelho
ensina a ignorar as duas.

### O que a auditoria encontrou (2 rodadas, 29 agentes)

A primeira rodada morreu no limite de sessão (12 de 17 agentes); a segunda
terminou inteira. **O achado mais caro não estava na varredura:**

- [x] **Quatro rotinas de fundo da extensão estavam mortas para quem entrou pelo
  login novo.** Elas exigiam a chave ANTIGA (`extKey`), e o login por e-mail e
  senha — que o portão OBRIGA — grava `extToken` e nunca `extKey`. Fila de envio
  (mensagens ficavam "na fila" e nunca saíam), inbox de leads, vigília de
  campanha (resposta de lead nunca reportada: a campanha parecia ruim, era a
  extensão muda) e o batimento de presença (o consultor contava como OFFLINE e
  saía do rodízio de disparo). Todas saíam por um `return` mudo.
  **Isto pode explicar a taxa de resposta 0% do disparo registrada em 03/08 —
  ver o item da hipótese (B) mais acima.**
- [x] E o inbox não ficava só vazio: **afirmava "Nenhum lead esperando"** a
  partir de uma lista que nunca foi buscada. Agora são três estados.
- [x] O vigia da ponte desistia após 1 minuto em silêncio absoluto, e o motivo da
  falha do injetor chegava e era descartado.

### Pendente — gravidade ALTA (confirmado por verificação cética, NÃO corrigido)

Cada um mexe em dinheiro ou em lead. Não foram atacados porque cada um é uma
decisão de comportamento, não um bug óbvio.

- [ ] **`app.py:8263` — webhook do Asaas com token inválido responde 200 e não
  grava nada em `webhook_log`.** O Asaas não reenvia: pagamento confirmado que o
  JOB nunca soube. Conserto: responder 401 e registrar a tentativa.
- [ ] **`app.py:48733` — planilha inacessível vira lista vazia e conta como
  sucesso.** Os dois leitores só olham exceção; não checam status HTTP nem
  Content-Type. Planilha que virou tela de login = leads param de entrar sem um
  log.
- [ ] **`app.py:45181` — cada lead que falha ao gravar some sem log e sem
  contador** (`except Exception:` sem `as e`). Rodada com zero leads tem a mesma
  assinatura de sucesso.
- [ ] **`app.py:11535` — lead pago é marcado como atendido ANTES do envio
  acontecer**, e o consultor é avisado de um envio que ainda não saiu. Se
  falhar, ninguém atende e a métrica diz que atendeu. Conserto proposto: marcar
  em `/api/whatsapp/fila/<id>/confirmar`, e abrir pendência na falha terminal.
- [ ] **`app.py:45652` — o funil avança de passo mesmo com o envio falhando**, e
  `fluxo_envio_log` é write-only (nenhuma tela lê). Sem token do WhatsApp, a
  inscrição percorre tudo e termina "concluída" com zero mensagens entregues.
  Conserto proposto: separar falha permanente de temporária, repetir a
  temporária 3× usando o próprio log como contador, e fazer alguma tela ler a
  tabela.

### Pendente — gravidade MÉDIA

- [ ] `app.py:24684` — disparo: versão abaixo de 2.21.0 (ou desconhecida) tira o
  consultor da roleta, e **o consultor não recebe aviso nenhum** (só o admin vê
  em `/campanhas`). Mesma classe da regra acima: deveria degradar + notificar.
  O literal `_EXT_VERSAO_MIN_DISPARO` está fora de `EXT_VERSAO` — unificar.
- [ ] `app.py:41854` — lembrete da agenda é marcado como enviado e comitado ANTES
  de tentar enviar; nada devolve `lembrete_enviado` para 0.
- [ ] `app.py:48764` — guarda de marca desliga a importação de leads inteira com
  um `return` mudo.
- [ ] `app.py:28846` e `29067` — `"gestor": False` cravado em dois endpoints da
  biblioteca (irmãos diretos do bug do `config-remota`); `"pode_editar": True`
  cravado desenha Excluir em modelo que o servidor recusa.
- [ ] `app.py:32841` — variável local cravada em True bloqueia
  `/comissoes/regra-gestor/aplicar-historico` inteira.
- [ ] `app.py:24579` — `/api/whatsapp/presenca` responde 200 com `{"ok": False}`
  sem motivo e sem log.

### Descartado na verificação

- Faxina e resgate da fila de cotação só rodam com trabalhador vivo — **não é
  defeito**: a fila não cresce sem trabalhador (a porta de entrada recusa), e o
  resgate está posicionado onde tem efeito. Resíduo menor: o DELETE de 7 dias
  também depende do `/proximo`, então dados podem ficar além da política se
  ninguém voltar por semanas.

### Ação obrigatória do Guilherme

- [ ] **Publicar a extensão 4.98.0 na Chrome Web Store.** Nada do que foi
  consertado na extensão chega a ninguém antes disso — e são quatro rotinas
  religadas, não melhorias.
- [ ] Abrir `/inteligencia-vendas` e clicar em "Mandar ler as conversas prontas"
  (eram 33 na última medição). Depois disso não precisa mais: proposta nova já
  nasce enfileirada.

### Lições que valem para o próximo trabalho

1. **Medir antes de opinar, sempre.** Eu errei um diagnóstico nesta sessão:
   apontei crashes de JS da extensão como causa do apagão. A causa era uma linha
   cravada no servidor. O que separou o palpite do fato foi consultar o banco de
   produção.
2. **Silêncio não é sinal de saúde.** Toda negativa precisa deixar rastro: quem,
   quando, qual versão, qual motivo. Um `return` mudo numa rotina de fundo custa
   dias.
3. **Uma correção de segurança pode desligar uma funcionalidade inteira.** Tirar
   a decisão da rota pública estava certo; não recolocá-la em lugar nenhum não
   foi percebido por sete dias.
4. **Política escrita em comentário não é política.** `EXT_VERSAO` existia
   documentando a regra enquanto o ponto que de fato bloqueava usava um número
   solto — mexer na política não mudava nada.
5. **Tela que afirma sem ter olhado é pior que tela vazia.** "Nenhum lead
   esperando" a partir de lista nunca buscada; "Pode rodar" em verde para quem a
   fila recusa.

---

## HANDOFF — 18/08/2026, fim da tarde (ler isto primeiro)

Continuação da seção acima. A sessão seguiu depois do registro anterior e
**causou um incidente em produção**. Quem pegar o trabalho daqui: leia o
incidente antes de tocar em qualquer coisa que fale com cliente.

### Histórico da sessão, em ordem

| Quando | O que |
|---|---|
| Manhã | Inteligência de Vendas: 1 venda → 71. Cruzamento por `lead_id` no lugar de telefone |
| Manhã | Guilherme corta o status da proposta da página; entra "O perfil de quem contrata" |
| Manhã | `/ebook-vendas` no ar; fila obrigatória de leitura das vendas |
| Meio-dia | Descoberto o apagão de 7 dias na varredura (causa: `pode_rodar=False` cravado) |
| Meio-dia | Pendências no sino + tela "Está rodando agora?" |
| Tarde | Auditoria em 2 rodadas (29 agentes). Achado: 4 rotinas da extensão mortas pelo `extKey` |
| Tarde | Religo as 4 rotinas → **INCIDENTE**: fila drena 3 semanas de mensagens atrasadas |
| Tarde | Sangramento contido, trava de validade de 6h no ar |

### O INCIDENTE (18/08, ~14h) — causa, estrago e correção

**Causa:** a fila de envio estava morta havia semanas para quem entrou pelo login
novo (a rotina da extensão exigia a chave antiga `extKey`, que o login por
e-mail/senha não grava). Os itens foram **acumulando no servidor**: 43, o mais
velho de 27/07. Religuei a rotina **sem medir o que estava represado**. A fila
começou a drenar o atraso inteiro.

**Estrago que consumou (não dá para desfazer):** 17 mensagens atrasadas saíram
para clientes — 7 criadas em 13/08, 5 em 14/08, 3 em 12/08, 2 em 17/08. Eram
aberturas de lead pago ("Oi, vi que você pediu uma cotação") e 2 apresentações.

**Estrago evitado:** 43 itens marcados `cancelado_atraso` com o motivo gravado
(não apagados, para ficar auditável). Incluía leads de 27, 28 e 30 de julho.

**Correção no ar** (`7d37a87`): `_WA_FILA_VALIDADE_HORAS = 6` em
`/api/whatsapp/fila/proximo`. Item mais velho que 6h não é entregue — vence no
lugar. Mora ali porque é o único ponto por onde todo envio passa: vale para
qualquer versão de extensão e não depende de ninguém lembrar de limpar nada.

**Como conferir se voltou a acontecer:**
```sql
select count(*) from whatsapp_extensao_fila
where status in ('pendente','enviando') and criado_em < now() - interval '6 hours';
-- tem que ser 0, sempre
```

### Estado de produção ao fechar a sessão

- `main` em `7d37a87`, deploy Online
- Fila de envio: 5 pendentes + 4 enviando (todos das últimas 6h, legítimos), 43 cancelados por atraso
- **A varredura VOLTOU:** última análise 18/08 14:05. Total 2.033 → **2.261** (228 lidas hoje)
- **Vendas com conversa lida: 21 → 41 de 71.** A Inteligência de Vendas está enchendo sozinha
- 3 pendências abertas no sino
- Extensão: Danilo já na 4.98.0; Aline e Guilherme na 4.97.0; Juliana e Karen sem versão reportada

### DECISÃO NOVA — não publicar na Chrome Web Store

Guilherme, 18/08: **não publicar a extensão na loja.** A entrega termina no
repositório; a atualização acontece por ↻ em `chrome://extensions` + F5 no
WhatsApp. Não escrever "publique na loja" como pendência, e **não desenhar
correção que só funcione depois de todos atualizarem** — ver a regra de versão
na seção anterior.

### PENDENTE — em ordem de ataque, com tempo estimado

Tempo = trabalho de código + teste local. Não inclui deploy (~3 min) nem
verificação em produção.

#### Prioridade 1 — a máquina de envio (mesma que causou o incidente)

Fazer os três juntos, na mesma leva, porque mexem na mesma engrenagem. **Medir o
que está represado ANTES de mexer**, e mostrar o número ao Guilherme.

- [ ] **`app.py:11535` — lead pago marcado como atendido ANTES do envio sair** ·
  **~45 min** · GRAVIDADE ALTA. Se o envio falhar, ninguém atende e a métrica diz
  que atendeu. Conserto: mover a marcação para
  `/api/whatsapp/fila/<id>/confirmar` (ramo de sucesso) e abrir pendência na
  falha terminal (3 tentativas). Terceiro detector em `_pendencias_reconciliar`
  para o caso "extensão offline" (lead pago esperando >15 min em horário
  comercial), que é o cenário mais provável e hoje é mudo.
- [ ] **`app.py:45652` — funil avança de passo mesmo com envio falhando** ·
  **~90 min** · GRAVIDADE ALTA. Sem token do WhatsApp, a inscrição percorre tudo
  e termina "concluída" com zero mensagens entregues. `fluxo_envio_log` é
  write-only (nenhuma tela lê). Conserto: `_fluxo_executar_passo` passa a devolver
  se a falha é permanente; temporária repete 3× usando o próprio log como
  contador; e alguma tela precisa ler a tabela, senão o conserto é invisível.
- [ ] **`app.py:41854` — lembrete da agenda marcado como enviado antes de tentar
  enviar** · **~20 min** · MÉDIA. Nada devolve `lembrete_enviado` para 0.

#### Prioridade 2 — entrada de leads (dinheiro na porta)

- [ ] **`app.py:48733` — planilha inacessível vira lista vazia e conta como
  sucesso** · **~40 min** · ALTA. Os dois leitores só olham exceção; não checam
  status HTTP nem Content-Type. Planilha que virou tela de login = leads param de
  entrar sem um log. Conserto: checar status/Content-Type e abrir pendência.
- [ ] **`app.py:45181` — lead que falha ao gravar some sem log e sem contador** ·
  **~25 min** · ALTA. `except Exception:` sem `as e`. Rodada com zero leads tem a
  mesma assinatura de sucesso. Conserto: contar, logar e abrir pendência se a
  rodada inteira falhar.
- [ ] **`app.py:48764` — guarda de marca desliga a importação com `return` mudo** ·
  **~15 min** · MÉDIA.

#### Prioridade 3 — dinheiro que entra e o JOB não sabe

- [ ] **`app.py:8263` — webhook do Asaas com token inválido responde 200 e não
  grava nada** · **~30 min** · ALTA. O Asaas não reenvia: pagamento confirmado
  que o JOB nunca soube. Conserto: 401 + registrar a tentativa em `webhook_log`.
  Atenção: mexer em webhook de pagamento pede teste cuidadoso.

#### Prioridade 4 — negativas cravadas (irmãs do bug do apagão)

- [ ] **`app.py:28846` e `29067` — `"gestor": False` cravado** em dois endpoints
  da biblioteca · **~30 min** os dois · o modo gestor nunca liga para ninguém.
- [ ] **`app.py:28843` — `"pode_editar": True` cravado** desenha Excluir em
  modelo que o servidor recusa · **~15 min**.
- [ ] **`app.py:32841` — variável local cravada em True** bloqueia
  `/comissoes/regra-gestor/aplicar-historico` inteira · **~20 min**.
- [ ] **`app.py:24579` — `/api/whatsapp/presenca` responde 200 com `{"ok": False}`**
  sem motivo e sem log · **~15 min**.

#### Prioridade 5 — unificar a política de versão

- [ ] **`app.py:24684` + `_EXT_VERSAO_MIN_DISPARO`** · **~40 min** · MÉDIA. O
  disparo tira o consultor da roleta por versão e **o consultor não é avisado**
  (só o admin vê em `/campanhas`). Deveria degradar + abrir pendência, como a
  varredura já faz. O literal está fora de `EXT_VERSAO` — unificar.
- [ ] **`_MIN_VARREDURA` na rota** ainda é literal em vez de ler
  `EXT_VERSAO['bloqueia_abaixo']` · **~10 min**. Duas fontes da verdade com o
  mesmo valor hoje; a próxima pessoa que mexer num só cria divergência.

#### Pendências operacionais (não é código)

- [ ] Juliana e Karen aparecem **sem versão reportada** — conferir se a extensão
  delas está atualizada e rodando. A tela "Está rodando agora?" em
  `/configuracoes` mostra o motivo de cada uma. · **~10 min**
- [ ] Decidir o que fazer com os leads que apareceram de uma vez no inbox quando
  a rotina religou — muitos já esfriaram. Guilherme não respondeu ainda. **(?)**
- [ ] Índices em `notificacoes` (`chave`, `resolvida_em`) e política de retenção
  para avisos antigos · **~20 min**. A tabela não tem um índice e nunca é podada;
  a reconciliação de pendência roda no pulso da extensão, que é frequente.

### O que NÃO fazer (aprendido do jeito caro)

1. **Nunca religar rotina que fala com cliente sem medir o represado.** Consertar
   uma falha silenciosa pode LIBERAR um estrago que o silêncio estava segurando.
   Foi exatamente isso hoje. Uma consulta de dez segundos ao banco evitaria.
2. **Não desenhar correção que só funciona na versão nova.** Versão velha degrada
   e abre pendência; nunca para de trabalhar.
3. **Não confiar em dedução onde cabe medição.** Eu errei o diagnóstico do apagão
   apontando crashes de JS; a causa era uma linha cravada no servidor.
4. **Não tratar tela vazia como estado positivo.** "Nenhum lead esperando" a
   partir de lista nunca buscada; "Pode rodar" verde para quem a fila recusa.
5. **Não confiar em `except` silencioso nem para o próprio conserto.** Um
   `KeyError` engolido deixou um detector de pendência mudo — foi o teste que
   pegou, não o log.

### Aviso sobre trabalhar em vários chats ao mesmo tempo

Não existe coordenação automática entre chats. Cada um trabalha numa cópia
separada (havia 11 abertas em 18/08) e **nenhum vê o trabalho não enviado do
outro**. O git obriga quem envia depois a integrar — nada se perde, mas nada se
amarra sozinho.

**O risco concreto:** dois chats mexendo na mesma engrenagem (fila, funil,
disparo) podem produzir consertos que interagem de um jeito que nenhum dos dois
previu. Antes de mexer na máquina de envio, conferir `git log origin/main` e
`git worktree list` para ver o que andou.
