# Mapa de Dispersão de Dados (Onde a Informação Vive)

Este documento define **para onde vai** cada dado que a IA extrai da conversa do WhatsApp, mapeado por Abas do Sistema (Job Serenus). A IA usa esse mapa para decidir se um dado é relevante e como ele deve ser estruturado.

## ABA 1: CRM (Qualificação e Ficha do Lead)
O motor pega as nuances do texto para construir o pipeline do consultor.

*   `fase_funil` -> Determina a coluna visual do lead no Kanban.
*   `operadora_atual`, `valor_pago_hoje`, `mes_reajuste` -> Usados na aba lateral de qualificação para o consultor armar o argumento de "Economia Financeira".
*   `hospital_preferencia`, `condicoes_saude` -> Avisos críticos no cabeçalho do lead. Se a IA errar aqui (ex: ignorar um autismo ou um tratamento oncológico), o plano cotado não vai atender o cliente.
*   `urgencia`, `quem_decide` -> Metadados para priorização de follow-up.
*   `o_que_falta` -> É o comando direto para o consultor ("Copie e cole isso no WhatsApp").

## ABA 2: COTAÇÃO (O Motor Financeiro)
A IA busca fatos exatos para que a aba de cotação filtre as tabelas de preços corretas.

*   `tipo_contratacao` -> Filtra as tabelas no banco (Se for PME/CNPJ, a aba ignora tabelas PF).
*   `cidade` -> Filtra a tabela regional (Amil Campinas vs Amil SP).
*   `idades` (exatas) -> Populam a simulação quando o cliente diz no chat.
*   `faixas_etarias` -> Populam a simulação quando o cliente manda uma tabela prévia (PDF/Imagem) onde não dá pra saber as idades, apenas a quantidade por faixa.
*   `vidas` -> Soma total, validando as idades.

## ABA 3: PROPOSTAS / FECHAMENTO (Documentação e Burocracia)
A IA olha *quase exclusivamente para os anexos* e deve entregar com 100% de precisão para a emissão de contrato.

*   `documentos_pessoas` -> Bloco JSON com os dados exatos (CPF, RG, CNH, Certidões) para o back-office imputar no sistema da operadora (ex: Amil, Bradesco). Se a IA errar 1 dígito de CPF, o back-office reprova a proposta.
*   `dados_empresa` -> Extraído de Cartão CNPJ. Alimenta a contratação PME.
*   `operadora_atual` / `plano_atual` -> Para abater as carências ("Compra de Carência"). O sistema usa isso para mostrar ao cliente: "Você não tem carência para consultas pois veio da SulAmérica". Extraído da "carteirinha antiga" ou "boleto pago" enviados no chat.
