# Regras de Ouro (Anti-Alucinação)

Este documento contém as regras absolutas e irrevogáveis que a IA deve seguir ao ler conversas e anexos. Elas nascem de falhas reais históricas e não podem ser violadas.

## 1. A Regra do "Assunto do Anexo" (O Caso Sanasa)
*   **O Erro Histórico:** A IA projetou o contexto da conversa (ex: cliente falando sobre plano da "Vera Cruz") sobre a foto de uma conta de água (Sanasa), lendo-a como se fosse uma carteirinha de plano.
*   **A Regra:** IDENTIFIQUE primeiro do que se trata a imagem. Se a foto for uma conta de luz/água, foto pessoal, exame médico não-relacionado, ou extrato bancário, **declare isso explicitamente e encerre a extração desse anexo**.
*   **NUNCA projete um nome de operadora do texto da conversa sobre uma imagem genérica.**

## 2. A Regra do Vazio Honesto vs. Suposição Estatística
*   **O Erro Histórico:** O cliente mencionou "vou colocar meus filhos" e a IA chutou "2 crianças de 10 e 12 anos" baseada na média demográfica. Outro erro: assumiu plano "Familiar" automaticamente.
*   **A Regra:** Se o dado não foi explicitamente *dito no áudio/texto* ou *visível na imagem*, deixe vazio. Um campo vazio força o consultor a fazer a pergunta correta no WhatsApp. Um campo preenchido com chute vai parar na cotação e suja o cálculo. "Vazio honesto é melhor que chute".

## 3. A Regra do Documento Ilegível e Parcial
*   **O Erro Histórico:** A IA viu uma CNH, leu o nome e o CPF, achou o RG embaçado e devolveu um array vazio `[]` descartando todo o documento.
*   **A Regra:** Extraia TUDO o que estiver legível. Se o documento for reconhecido como um RG/CNH/CNS, preencha campo a campo. Se o RG não está legível, coloque `""` no RG e preencha o Nome e CPF normalmente. Nunca invente um dígito para fechar a máscara do número.

## 4. A Regra de Fusão de Frente e Verso
*   **O Erro Histórico:** A IA leu a frente de um RG como "Pessoa 1" e o verso do mesmo RG como "Pessoa 2".
*   **A Regra:** Imagens sucessivas do mesmo documento (frente e verso) ou diferentes documentos da MESMA pessoa (ex: RG e Comprovante de Residência no mesmo nome) devem gerar **apenas UM bloco** no sistema consolidando os dados.

## 5. A Regra do Valor Pago Hoje vs. Valor da Cotação
*   **O Erro Histórico:** A IA colocou o preço do plano cotado (que ela deve vender) na coluna `valor_pago_hoje` (que é o custo do plano atual do lead). Isso zera a "Economia Mensal" no cálculo do CRM.
*   **A Regra:** O que o lead paga "hoje" é histórico (e vai pro CRM). O valor da "proposta" é futuro (e vai pra Aba Propostas). Se o lead falar "gostei do preço de R$ 600", isso NÃO é o que ele paga hoje.
