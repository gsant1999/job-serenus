# Contrato — "Nova versão" ainda abre a tela velha de cotação

> 06/08/2026. `app.py`, então é do Antigravity. O template novo é meu.
>
> Achado pelo Guilherme em produção: ele clicou em "Nova versão" numa cotação
> salva e caiu na tela antiga, com o banner "Cotação ao vivo — Experimentar".

---

## O que está acontecendo

A consolidação fechou a porta da frente e esqueceu a lateral:

| entrada | hoje | deveria |
|---|---|---|
| `/cotacao` | 301 → `/cotacao/novo` | ok |
| `/cotacao/<id>/reabrir` | renderiza **`cotacao.html`** (tela velha) | abrir `/cotacao/novo` pré-preenchido |

Quem leva o consultor pra lá:

- `templates/cotacao_salvas.html:71` — botão "Nova versão"
- `templates/cotacao_documento.html:93` — "+ Nova cotação (link novo)"

Não é regressão: essa rota nunca foi migrada. Mas o efeito pro consultor é o
mesmo — ele vê duas telas de cotação diferentes no mesmo sistema e não sabe
qual é a certa.

---

## O que muda

`cotacao_reabrir(cid)` para de renderizar `cotacao.html` e passa a **redirecionar**
para `/cotacao/novo?de=<cid>`.

Em `cotacao_novo()`, quando vier `de=<cid>`, montar o `prefill` a partir da
`cotacao_salva` daquele id — do mesmo jeito que ele já monta a partir de `lead`:

| campo | origem |
|---|---|
| `lead_id`, `cliente_nome`, `cliente_telefone`, `cliente_email` | colunas de `cotacao_salva` |
| `cidade`, `modalidade` | de `planos_json` (é onde estão hoje) |
| `vidas` | `vidas_json` |
| `planos` | `planos_json`, pra tela já vir com a seleção marcada |

**A regra do módulo continua valendo e é o motivo de isto ser um redirect e não
um "editar":** o token público `/c/<token>` é IMUTÁVEL. Reabrir **cria registro
novo** ao salvar; nunca faz UPDATE na cotação de origem. O texto dos dois
botões já promete isso ("link novo", "a original continua salva") — o
comportamento tem que continuar honrando.

**Se a cotação `de=<cid>` não existir ou não for do corretor:** abrir
`/cotacao/novo` limpo com um aviso, não 404. O consultor clicou num botão do
próprio sistema; 404 nessa situação parece que o sistema quebrou.

---

## Depois disso

`cotacao.html` fica sem nenhuma rota que o renderize. Confirmar com

```bash
grep -n "render_template('cotacao.html'" app.py
```

Se voltar vazio, o arquivo pode sair — mas **num commit separado**, depois de a
tela nova estar respondendo pelas duas entradas em produção. Apagar junto
transforma um problema fácil de reverter num difícil.

---

## Achado de arrumação, separado deste

`templates/cotacao_salvas (1).html` está **rastreado no git** — é cópia de
download (mesmo padrão de `app (1).py`), não template em uso. Ninguém renderiza.
Vale apagar, em commit próprio, sem misturar com o resto.

---

## Antes de entregar

```bash
git status --short          # se tiver arquivo que não é seu, NÃO troque de branch
.venv/bin/python scripts/auditar.py <sua-branch>
python3 -c "import ast; ast.parse(open('app.py').read())"
git log --oneline -1 origin/main
```

Ver `handoff/regra-branch-diretorio-compartilhado.md`. Branch a partir de `main`,
só `app.py`.
