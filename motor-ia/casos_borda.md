# Casos de Borda e Dicionário Semântico (Memória Histórica)

Neste arquivo documentamos como a IA deve reagir a frases e cenários não literais e pegadinhas linguísticas nas conversas do WhatsApp.

## 1. Dicionário de Saúde (Tradução Leiga para Técnica)
Os clientes não usam termos técnicos. A IA deve usar as "âncoras semânticas" abaixo para entender as Condições de Saúde (`condicoes_saude`):

*   **"Toma remédio contínuo"**, **"Hipertenso"**, **"Pressão alta"**, **"Diabetes"**: Marcar como condição pré-existente.
*   **"TEA"**, **"Autista"**, **"Faz terapias"**, **"Fono e T.O"**, **"ABA"**: Condição de saúde crítica. Custo altíssimo para operadora. Sempre extrair e alertar.
*   **"Tem um probleminha no coração"**, **"Fez cirurgia"**: Extrair como condição.
*   **"Só pra rotina"**, **"Nunca usamos"**, **"Todo mundo saudável"**: Marcar como `nada declarado`.

## 2. Dicionário Familiar (Quem entra no plano)
Os clientes usam termos coloquiais que a IA precisa converter em `vidas` e `composicao_familiar`:

*   "Eu, minha patroa e os dois moleques" -> Vidas: 4, Composição: [Cônjuge, Filhos].
*   "Pra mim e pro meu velho" -> Depende do contexto, pode ser Pai ou Sócio. A IA deve listar como "Pais" (se for o pai) ou manter vazio e gerar a pergunta "Quem seria o seu velho?" no `o_que_falta`.
*   "Vou colocar os funcionários" -> PME (CNPJ). Vidas: 1+ (Sócio/Funcionários).

## 3. Pegadinhas Históricas (Não Caia)

*   **A "Gravidez" Oculta:** O cliente pergunta: *"Tem cobertura pra parto?"*. A IA não deve assumir imediatamente que há uma gravidez, MAS deve gerar o aviso em `sinais_atencao`: "Cliente perguntou de parto, verificar se há gestação em curso".
*   **A "Urgência" do Boleto Vencido:** Cliente diz: *"Meu plano venceu e cancelaram"*. Isso é URGÊNCIA ALTA. A IA deve marcar `tem_plano_hoje` como `cancelou_recente` (o que muda completamente a regra de compra de carência).
*   **A Cotação Genérica:** Consultor manda: *"Segue simulação de tabela do Bradesco"*. A IA **não deve** colocar Bradesco como `operadora_atual`, nem o valor dessa simulação em `valor_pago_hoje`. Isso é o que está sendo oferecido, não o que o cliente tem.
