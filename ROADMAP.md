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

## Extensão — memória e travamento (levantamento iniciado 10/08/2026)

> Guilherme, 10/08/2026: *"como deixamos a extensão melhor em termos de não
> travar e devorar a RAM do computador?"* — e, na mesma conversa, o Chrome dele
> avisando **"uso elevado da memória: 2,3 GB"** na aba do WhatsApp.
>
> **Levantamento começado, NÃO terminado.** Ficou pausado pra fechar a fila de
> cotação primeiro. Retomar daqui — não do zero.

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

### O caminho, na ordem

1. **Ler o número do Diagnóstico** numa conversa longa, depois de rolar. Sem
   ele, qualquer conserto é chute.
2. **Confirmar quais estruturas retêm de verdade** — tamanho em memória, não
   contagem de itens. `_cvCache` com cinco imagens pesa mais que `TR.cache`
   com quinhentas transcrições.
3. **Aplicar teto no que retém**, com o utilitário que já existe.
4. **O caminho grande, se o número justificar**: trocar leitura de DOM por
   leitura de módulo do WhatsApp. É reescrita do coração da extensão — não
   começar sem o número da etapa 1.

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
