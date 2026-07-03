# ROADMAP — JOB Serenus

Fonte única de pendências e melhorias. Atualizar ao concluir ou decidir algo.
Legenda: [ ] pendente · [~] em andamento · [x] feito · (?) aguardando decisão do Guilherme

## Bugs / correções curtas

- [ ] Asaas API 401 — boleto/NF parados. Guilherme confirmou (03/07): não mexer por enquanto, está resolvido do lado dele. Existe ferramenta de diagnóstico pronta em `/admin/asaas/diag` (mostra estado da chave sem expô-la + testa conexão real) e `/admin/asaas/testar-chave` (testa qualquer chave ao vivo sem precisar redeploy) se precisar revisitar
- [ ] MedSênior PF — falta registro de `recebimento` (tabela de comissão por operadora/plano). Já existe diagnóstico pronto: rota admin que lista `propostas_comissao_zerada` (propostas com `comissao_total_corretora` NULL/0 por falta de match na tabela `recebimento`). Falta: rodar o diagnóstico, identificar o(s) plano(s) MedSênior PF sem linha correspondente, e cadastrar o valor de comissão
- [ ] "Melhorar sistema de idades" na cotação (feedback Danilo) (?) — hoje é um único campo de texto livre que mistura idade e data de nascimento (placeholder: "Ex: 25, 30 e 15/03/1990"), parseado no servidor. Provável fonte da confusão, mas falta o Guilherme/Danilo confirmarem o que exatamente incomoda antes de redesenhar
- [ ] Rotacionar chaves expostas (Postgres, ASAAS_API_KEY, BREVO_API_KEY) — ação manual no painel Railway, não é mudança de código

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

## Cotação

- [x] Ordenar por operadora A-Z + menor preço; badge segue o mais barato
- [x] Logos com fallback (uploads sumidos pré-volume)
- [x] **Destaque por cores (básico)**: botão "Destacar planos" no documento liga/desliga contorno colorido automático por operadora (cor fixa por plano, definida no `_build_cot`)
- [x] **Gerar cotação abre em nova página** (feedback Danilo 03/07): o formulário de gerar cotação navegava na mesma aba, substituindo o construtor. Agora abre o documento em aba nova (`target="_blank"`), mantendo o construtor intacto pra criar outra cotação em seguida
- [x] **Botões do documento renomeados** (03/07, achado ao investigar pedido do Guilherme sobre links duplicados): "Editar valores" → "Corrigir valor (mesmo link)" com confirmação explícita antes de salvar; "Nova versão" → "+ Nova cotação (link novo)" — ficava fácil clicar no errado achando que ia gerar uma cotação nova e sem querer alterar a que já foi mandada pro cliente
- [x] **Material de apoio — upload não falha mais em silêncio**: se o arquivo não conseguir subir (R2/disco), agora avisa na tela em vez de salvar o item sem o arquivo sem dizer nada
- [x] **Pastas do material de apoio**: agora dá pra criar pasta vazia dentro de uma operadora (nova ou existente) pra organizar antes de ter conteúdo — igual ao Painel do Corretor. Botão "+ Pasta" na sidebar e dentro de cada operadora; exclui pasta vazia
- [ ] Destaque avançado no documento (correção 03/07: o básico já existe, isto é sobre a versão avançada) — o que falta de fato: escolher manualmente qual linha/coluna destacar (ex: só a acomodação ou só o copart de um plano específico), misturar cores por célula em vez de 1 cor fixa por plano inteiro, e permitir vários destaques simultâneos na mesma coluna
- [ ] UX da montagem da cotação (Guilherme acha confusa; referência: Painel do Corretor) — sem escopo definido, precisa de conversa
- [ ] Filtro por região/CEP e cotação com dependentes — confirmado: nenhum dos dois existe hoje em `/cotacao`
- [ ] Validade da cotação (data de expiração exibida ao cliente no documento) — correção 03/07: "vigência" já existe, mas é campo da TABELA de preços (mês de referência, ex: "07/2026"), não uma data de validade da cotação em si mostrada pro cliente. São coisas diferentes, isto aqui ainda não existe
- [ ] Evitar tabelas duplicadas no import — confirmado: hoje só existe limpeza manual reativa (`/admin/emergency/limpar-duplicatas`), sem nenhum aviso preventivo no momento do import. Precisa checar operadora+plano+copart antes de salvar e avisar se já existe
- [ ] Material de apoio: link público para enviar item ao cliente — confirmado: não existe rota pública hoje (`/material-apoio` é só interno, login obrigatório; o módulo em si — pastas por operadora/tipo, editor de texto rico — já existe e está completo). Seguiria o mesmo padrão já usado em `/c/<token>` (cotação) e `/u/<token>` (upload de comprovante)

## Financeiro

- [x] Custos com justificativa: quem pagou (Gabriel/Guilherme/Karen/Danilo/Bianca/Caixa) + fonte (Caixa ou Terceiro) + comprovante anexado
- [x] Comprovante pelo celular: link tokenizado /u/<token> com QR — abre a câmera, fotografa e sobe direto

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
