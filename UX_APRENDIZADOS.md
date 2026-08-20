# Aprendizados de UX — job-serenus e extensão JOB

Fonte: "Introdução e boas práticas em UX Design" (Fabricio Teixeira), extraído e
mapeado em 02/08/2026 via pipeline `ingest` + análise para os dois produtos do
ecossistema JOB. Documento de referência para decisões de design — não é um
checklist obrigatório, é insumo para priorização.

## Princípios extraídos do livro

### Simplicidade e redução de carga cognitiva
- Remova antes de organizar: elimine qualquer campo, botão ou texto que não seja essencial para a tarefa antes de tentar reorganizar a tela (modelo dos "4 R" de Giles Colbourne: Remover, Organizar, Esconder, Mover).
- Ofereça informações em pequenas doses: pergunte "qual a ação principal que o usuário deve tomar agora?" e corte tudo que não serve diretamente a ela.
- Revele progressivamente: mostre só o essencial de início e exponha campos/detalhes extras somente após uma ação do usuário.
- Cada decisão forçada custa segundos de esforço cognitivo: toda vez que você oferece 5 opções onde 2 bastariam, o usuário perde tempo processando.
- Simplifique formulários ao mínimo necessário: pergunte se cada campo pode ser adiado para depois.
- Prefira campos especializados a campo de texto livre: para datas, use seletor de calendário em vez de exigir formato digitado.
- Use fluxo sem cadastro quando o objetivo imediato do usuário não é criar conta — peça só o mínimo e complete o cadastro depois.

### Hierarquia visual e organização
- Crie hierarquia clara: use tamanho, peso e cor para indicar o que deve ser lido/clicado primeiro; limite a quantidade de tamanhos de fonte na mesma tela.
- Quando tudo é destacado, nada se destaca: resista ao pedido de "adicionar mais um banner/CTA" sem remover ou rebaixar outro elemento.
- Agrupe itens similares com estilo visual similar e categorize por tema em vez de listar tudo junto.
- Use cor para diferenciar apenas a ação principal.
- Equilibre texto e imagem conforme a tarefa: em fluxos de pagamento/confirmação, imagens decorativas competem com o foco necessário.

### Orientação e feedback ao usuário
- Nunca deixe o usuário sem saber o que fazer a seguir: toda tela deve deixar claro onde ele está, qual a próxima ação, e o que acontece ao clicar no botão principal.
- Nomeie botões pela consequência da ação, não por verbos genéricos.
- Toda ação precisa de uma reação imediata: se o usuário clica em salvar/enviar e nada muda na tela, ele vai clicar de novo — gera duplicidade de registros.
- Sinalize progresso de tarefas longas fora do fluxo bloqueante.
- Dê feedback textual claro em erros de validação, incluindo instrução de como corrigir.
- Relacione visualmente o erro com o campo que o causou.

### Prevenção de erros
- Prevenir é melhor que sinalizar após o fato: desabilite/oculte opções que levariam a erro certo.
- Confirme intenção em situações ambíguas ou de alto risco antes de executar a ação.
- Separe visualmente e fisicamente ações destrutivas de ações de confirmação para evitar cliques acidentais.
- Ofereça desfazer/reverter facilmente para ações tomadas por gatilhos "invisíveis" ou pouco óbvios.
- Estude os erros mais comuns nas métricas/logs reais e desenhe a interface para evitar especificamente esses erros.

### Microinterações e detalhes
- Pequenos detalhes bem cuidados diferenciam produtos com funcionalidades parecidas — priorize pulir os pontos de contato mais frequentes (login, salvar, marcar como lido) em vez de só adicionar features novas.
- Reaproveite um mesmo elemento de interface para comunicar duas informações relacionadas em vez de criar elemento novo a cada necessidade.
- Personalize com base no histórico do próprio uso: destaque a ação mais frequente do usuário.
- Mude o rótulo do botão conforme o contexto do usuário para evitar duplicidade acidental e confirmar intenção.
- Antecipe a intenção do usuário com atalhos contextuais.
- Faça o trabalho pesado pelo usuário sempre que possível: infira dados em vez de pedir digitação manual.
- Dê alguns segundos de "tolerância" após ações rápidas do usuário quando o custo de erro for alto.

### Honestidade e confiança
- Seja honesto sobre por que está pedindo uma informação: explique brevemente o uso de cada dado coletado, principalmente em dados sensíveis/pessoais.
- Comunique benefícios, não apenas funcionalidades.

### Microtextos (UX writing)
- Textos de interface têm valor funcional e emocional — trate-os com o mesmo cuidado que o layout.
- Evite nomes de ação vagos como "Enviar" sozinho; diga o que acontece depois.
- Elimine texto de instrução desnecessário quando o contexto já é óbvio.
- Use linguagem humana, não de sistema/máquina.
- Mantenha textos curtos por padrão.
- Teste microtextos com usuários reais pedindo que verbalizem o que acham que vai acontecer ao clicar.
- Adeque o tom de voz ao público-alvo específico.

### Consistência e sistema de padrões
- Construa e mantenha uma biblioteca de padrões de interação reaproveitável entre telas.
- Inconsistência visual entre elementos de função parecida confunde o usuário e passa impressão de sistema "remendado".
- Padronização não elimina criatividade, mas copiar cegamente um padrão de outro produto sem entender o problema que ele resolvia pode ser um erro.
- Pense em "átomos" de design (Atomic Design de Brad Frost): construa os menores componentes reutilizáveis primeiro antes de montar telas completas.

### Testes e validação com usuários reais
- Teste de usabilidade não precisa ser caro: sentar do lado de 3-5 usuários reais já gera insight de altíssimo valor.
- Teste cedo, mesmo com protótipo ou rascunho.
- Não trate pesquisa como etapa formal separada: pode ser uma conversa informal recorrente.
- Métricas quantitativas revelam padrões reais de comportamento que a intuição do time sozinha não capta.
- Teste A/B é mais confiável que perguntar diretamente ao usuário quando o objetivo é prever comportamento real.

### Performance como parte da UX
- Performance de carregamento é parte da experiência: usuários abandonam após ~2-3 segundos de espera.
- Otimize imagens, reduza número de requisições e elimine redirects desnecessários.
- Em contexto mobile/conexão ruim, o "custo" percebido de lentidão é ainda maior do que em desktop.

### Prevenção de "produtos que ninguém usa" / priorização
- Comece pela necessidade do usuário, só depois escolha a tecnologia.
- Defina a proposição de valor do produto/feature antes de codar.
- Saber dizer não a uma funcionalidade é tão parte do design quanto desenhar a que será feita.
- Estratégia do cupcake: entregue uma coisa pequena e completa, depois evolua.
- Priorize funcionalidades pelo Kano Model (esforço x satisfação): primeiro cubra o mínimo que evita frustração, depois busque "quick wins".
- Um produto nunca está "pronto": defina KPIs de sucesso antes de lançar e reserve tempo para ajustar depois.

### Checklist rápido de avaliação
- **Simples**: dá para remover, revelar progressivamente, padronizar, simplificar, priorizar, adiar, testar e analisar mais alguma coisa nesta tela?
- **Acionável**: está claro o que fazer a seguir, o rótulo explica a consequência, o usuário sabe onde está e o que fazer se der erro?
- **Inteligente**: a ação mais comum está destacada, o sistema previne e tolera erros, usa dados que já tem sobre o usuário para poupar trabalho?
- **Agradável**: o tom de voz reflete a marca, há contraste/legibilidade suficiente, o tempo do usuário é respeitado, há alguma pequena surpresa positiva?
- **Relevante**: a funcionalidade entrega o que o usuário realmente espera, foi validada com uso real, as métricas mostram uso de fato?

## Mapeamento para o job-serenus (site)

**Formulários e telas longas**
- Revisar `/nova-proposta` e telas de lead do CRM: quantos campos podem ser adiados/ocultados até depois do fluxo mínimo?
- Conferir se todo campo de data já usa seletor visual em vez de digitação livre.

**Feedback e prevenção de erro — relacionado a bugs já corrigidos**
- O bug "envio sem anexo dizia enviado" ([103c1ab](https://github.com/gsant1999/job-serenus/commit/103c1ab)) é exatamente o princípio "confirme intenção antes de executar" (ex. do livro: Gmail avisa quando você menciona "anexo" mas não anexou nada). Vale generalizar essa lógica para outros envios (proposta, boleto, e-mail de cotação).
- Toda ação de salvar/enviar precisa de reação visual imediata — auditar `/salvar-proposta` e os botões de fluxo financeiro (parcela/antecipação) contra clique duplo acidental.

**Consistência**
- Auditar inconsistência visual entre módulos antigos e novos do `app.py`/templates — o app cresceu por partes (CRM, cotação, propostas, financeiro) em momentos diferentes.

**Priorização (framework, não implementação)**
- Modelo Kano é um bom filtro pro `ROADMAP.md`: separar "evita frustração" (bugs, básico) de "quick win alto impacto/baixo esforço" antes de features grandes (ex. motor de cotação multicálculo).

## Mapeamento para a extensão JOB (Chrome/WhatsApp)

**Atomic Design — o achado mais aplicável aqui**
- A extensão tem popup + sidebar + overlays diferentes (biblioteca de mídia, funis, disparo em roleta) — vale montar uma biblioteca própria de componentes atômicos (botão, chip, badge) reutilizados entre essas superfícies, em vez de estilizar cada tela isolada. Bate com a referência ZapVoice/WaSpeed já usada.

**Microinterações**
- Rótulo de botão mudando por contexto ("Comprar" → "Comprar de novo") se aplica ao funil de disparo: se um lead já recebeu a sequência, o botão devia indicar isso em vez de convidar a reenviar do zero.
- Antecipar intenção com atalhos contextuais é a lógica do projeto de atendimento imediato de leads (chamar lead pago na hora).

**Performance**
- Contexto de WhatsApp Web/mobile do consultor em campo = tolerância a lentidão ainda menor que desktop — relevante pro carregamento da biblioteca de mídia (232 áudios + 91 imagens + 51 docs).

## Como falar com o Guilherme (vale para resposta, não só para tela)

A régua de "o óbvio deve ser dito" vale também para o que eu escrevo para ele.
Reclamação real, 20/08/2026: *"está falando muito em linguagem de máquina, está
muito difícil o texto, não é claro (...) daí eu não entendo o que está
acontecendo."*

**A ordem é sempre esta, nesta sequência:**

1. **O que é** — em uma frase, em português de gente. O assunto antes do detalhe.
2. **Por que importa** — o que muda no negócio dele se isso for ou não for feito.
3. **O que eu preciso dele** — a pergunta ou a decisão, explícita e separada.
4. **O detalhe técnico** — por último, e só se ajudar a decidir.

**O que não vai no corpo da resposta:** caminho de arquivo, número de linha, nome
de função, SQL, código HTTP, nome de coluna. Nada disso ajuda ele a decidir. Se
for indispensável para provar alguma coisa, vai no fim, curto e rotulado como
prova.

**Ele não é técnico e não precisa ser.** Ele é o dono: decide o que vale a pena,
quanto risco aceita e o que entra primeiro. Texto que exige tradução antes de
virar decisão é texto mal escrito, não leitor com dificuldade.

**Toda sugestão vem com o custo e a consequência.** "Quer que eu faça X?" sem
dizer quanto tempo leva, o que pode quebrar e o que acontece se não fizer é
empurrar a decisão para ele sem dar o que decidir.
