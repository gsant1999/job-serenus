# Proposta Saúde Beneficência

Preenche a **Proposta de Adesão** e a **Ficha de Inclusão** da Saúde Beneficência a partir
do CNPJ e de um bloco de notas em texto. Gera os PDFs oficiais preenchidos, sem alterar
o layout dos formulários da operadora.

**Projeto independente do JOB.** Não importa nada do ERP, não usa o banco dele e sobe como
serviço próprio. A única coisa em comum é o repositório.

## Rodar na sua máquina

```
cd propostas-saude-beneficencia
python3 app.py
```

Abre em http://localhost:5057. Sem `SENHA_ACESSO` definida, entra direto (é o modo local).

## Subir no Railway

Serviço **novo**, separado do JOB:

1. Novo serviço no mesmo repositório
2. **Root Directory:** `propostas-saude-beneficencia`
3. **Watch Paths:** `propostas-saude-beneficencia/**` — sem isso, todo deploy do JOB
   reconstrói esta ferramenta e vice-versa
4. Variáveis de ambiente:
   - `SENHA_ACESSO` — obrigatória. Sem ela, qualquer um na internet abre a ferramenta.
   - `SECRET_KEY` — string aleatória. Sem ela as sessões caem a cada deploy.

O `Procfile` já define o start (`gunicorn app:app`).

## Como funciona

1. Cola o CNPJ e busca — razão social e endereço vêm da BrasilAPI
2. Cola o bloco de notas (nome, CPF, RG, nascimento, mãe, SUS, endereço, contato).
   Sem o bloco pronto, o botão **Copiar prompt para o ChatGPT** entrega um prompt que
   lê fotos de documento e devolve o texto já no formato certo — custo zero, usa a conta
   de ChatGPT do próprio consultor.
3. Marca papel (titular/dependente), plano, acomodação, vigência e declaração de saúde
4. Gera — baixa um ZIP com a Proposta e uma Ficha por titular

Regras já embutidas: uma Ficha por titular; mais de 3 dependentes duplica a Ficha daquele
titular; estado civil concorda com o sexo; sexo é deduzido do primeiro nome; o valor da
mensalidade é calculado pela faixa etária de cada pessoa na data de início de vigência.

## Privacidade

Os PDFs são gerados **em memória** e vão direto para o navegador. Nada com CPF, RG ou
dado de saúde é gravado no servidor. A pasta `saida/` (uso local) está no `.gitignore`.

## Manutenção

- **`pypdf` está pinado em 6.11.0 de propósito.** O achatamento do PDF usa
  `PdfWriter._add_apstream_object`, que é API interna da biblioteca. O `motor.py` falha no
  import se ela sumir, em vez de gerar documento em branco. Ao subir de versão, rode o
  `conferir.py` antes de confiar no resultado.
- **`conferir.py`** lê os bytes do texto dentro do PDF, não a imagem. Existe porque o
  visualizador que eu usava (poppler) renderizava certo coisas que o Acrobat renderizava
  errado — texto gravado em UTF-16 numa fonte de 1 byte saía com espaço entre as letras,
  e isso não aparecia na conferência visual.

  ```
  python3 conferir.py caminho/do.pdf
  ```
- **Os modelos em `modelos-pdf/`** têm a competência no nome (`2026-06`). A operadora
  troca o formulário por competência: ao receber um novo, adicione o arquivo com a data
  nova e atualize as constantes no topo do `motor.py`.
- **Nomes de arquivo em ASCII, sem acento.** O nome original vinha do macOS com acento em
  NFD e o Linux do Railway não encontrava o arquivo.
