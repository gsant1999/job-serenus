# Comparativos de rede

Cada pasta aqui é um comparativo entre duas operadoras, apurado nos guias médicos
oficiais e publicado no JOB em **Rede de Atendimento > Comparativos**.

## O que já existe

| Pasta | Rota no JOB |
|---|---|
| `medsenior-x-beneficencia/` | `/rede-comparativos/medsenior-x-beneficencia` |

## Como um comparativo é montado

```
guia da operadora A (PDF)  ─┐
                            ├─ extrair.py ─→ dados.json ─┐
guia da operadora B (PDF)  ─┘                            ├─ build.py ─→ templates/*.html
                              quadro.py ─→ linhas.json ──┘
```

- **`extrair.py`** lê os dois PDFs e monta `dados.json`: médicos com CRM,
  prestadores com CNPJ, especialidades e corpo clínico de cada hospital.
  O guia da Beneficência é de duas colunas, por isso cada página é cortada ao
  meio antes de extrair. No da MedSênior, a faixa de especialidade é reconhecida
  pelo texto branco em corpo 14, e o nome do prestador pelo corpo 12.
- **`quadro.py`** compara as duas redes e grava `linhas.json`, com o veredito de
  cada especialidade. Detalhe que muda o resultado: o guia da MedSênior repete o
  mesmo corpo clínico do hospital em 15 especialidades, então esses nomes são
  descontados da contagem e o hospital entra como um selo à parte. Sem isso a
  barra da MedSênior fica maior justamente onde ela perde.
- **`build.py`** monta o template Jinja em `templates/`. Ele **falha de
  propósito** se sobrar travessão no texto que o cliente vê: material da Serenus
  não usa travessão.
- **`cartoes_whatsapp.py`** gera os cartões de `whatsapp/` em 1080x1350, via
  Chrome headless. Os números saem de `linhas.json`, o mesmo arquivo da página,
  para os dois nunca discordarem.

## Regerar depois de trocar os PDFs

```bash
cd comparativos-assets/medsenior-x-beneficencia
python3 extrair.py            # precisa de pdfplumber
python3 quadro.py
python3 build.py
python3 cartoes_whatsapp.py   # opcional, só se for remandar no WhatsApp
```

Os caminhos dos PDFs de origem estão no topo do `extrair.py`.

## Publicar um comparativo novo

1. Crie a pasta com os quatro scripts, apontando para os PDFs novos.
2. Rode o pipeline acima.
3. Registre a peça no dicionário `COMPARATIVOS` do `app.py`, com slug, título,
   nome do template e os logos das duas operadoras.
4. Acrescente o card em `templates/rede_atendimento_hub.html`.

O índice, o link temporário para o cliente e a rota pública `/comp/<token>`
funcionam sozinhos a partir do dicionário.
