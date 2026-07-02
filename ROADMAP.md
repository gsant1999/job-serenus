# ROADMAP — JOB Serenus

Fonte única de pendências e melhorias. Atualizar ao concluir ou decidir algo.
Legenda: [ ] pendente · [~] em andamento · [x] feito · (?) aguardando decisão do Guilherme

## Bugs / correções curtas

- [ ] Asaas API 401 — boleto/NF parados; investigar credencial no Railway
- [ ] MedSênior PF — falta registro de `recebimento`
- [ ] "Melhorar sistema de idades" na cotação (feedback Danilo — detalhar o que incomoda) (?)
- [ ] Rotacionar chaves expostas (Postgres, ASAAS_API_KEY, BREVO_API_KEY)

## CRM (feedback Danilo 30/06/2026)

- [x] ESC fecha modais (global, todas as páginas)
- [x] Fuso horário: todas as horas em São Paulo (timeline mostrava UTC, 3h à frente)
- [x] Atribuição de consultor determinística (primeiro nome exato; ambíguo não atribui)
- [x] Notificações também vão ao WhatsApp do consultor via WaSpeed (requer env WASPEED_TOKEN)
- [ ] **Atividades futuras / agenda**: agendar conversa (data + assunto) no lead; visão "minha agenda do dia" como submódulo do CRM; lembrete por e-mail e por WhatsApp do consultor via WaSpeed (remetente: Guilherme (19) 99875-2758)
- [ ] **WhatsApp integrado**: hoje há envio via WaSpeed no modal do lead — evoluir junto com a agenda (templates de mensagem, histórico no timeline)
- [ ] **E-mails de correção de contato**: templates prontos no CRM (telefone errado → "chame o corretor" com link wa.me; sem sucesso no contato), e-mail bonito (padrão do e-mail de cotação), com rastreio de abertura (pixel) e de clique (link com redirect)
- [ ] Notificação de lead parado há X dias sem atividade (usa o sino)

## Cotação

- [x] Ordenar por operadora A-Z + menor preço; badge segue o mais barato
- [x] Logos com fallback (uploads sumidos pré-volume)
- [ ] Destaque avançado no documento: cobrir coluna inteira, mix de cores, destacar acomodação/copart, vários destaques por coluna
- [ ] UX da montagem da cotação (Guilherme acha confusa; referência: Painel do Corretor)
- [ ] Filtro por região/CEP; vigência/validade da cotação; dependentes
- [ ] Evitar tabelas duplicadas no import (avisar se operadora+plano+copart já existe)
- [ ] Material de apoio: link público para enviar item ao cliente

## Estratégicos (aguardando lapidação com o Guilherme)

- (?) **RevOps de raiz** — MKT → Vendas → CS integrados: funil único (origem do lead → cotação → proposta → pós-venda/renovação), metas e taxas de conversão por etapa, receita por canal
- (?) **Manual de utilização** por perfil (admin / consultor / supervisora) — didático, dentro do sistema
- (?) **IA interna (Llama 3/3.1)** — casos de uso e hospedagem a definir
- (?) **Financeiro + BI ampliados** — /financeiro e /bi
- [ ] Sincronização de comissões com Google Sheets (código preparado em sessão anterior)
- [ ] Google Drive OAuth para contratos (baixa prioridade)

## Infra / qualidade

- [x] Notificações (sino) — cotação aberta, proposta nova, comissão liberada/paga, leads importados
- [x] Sino na sidebar (não sobrepõe conteúdo) + som ao chegar notificação
- [x] Datas em dd/mm/aaaa nas listagens (financeiro, fluxo, detalhe, cotações salvas)
- [x] Modo claro com contraste completo
- [x] Leads automáticos das planilhas (pull 15 min + por request + botão)
- [x] Emojis removidos de toda a interface
- [x] Código morto removido (scheduler duplicado, migração legada)
- [ ] Dividir app.py em módulos (blueprints) — refactor grande, planejar janela
- [ ] Testes automatizados mínimos (smoke test de rotas) rodando antes do deploy
