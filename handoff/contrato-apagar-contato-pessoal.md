# CONTRATO — apagar o contato marcado como pessoal

> Pedido do Guilherme, 08/08/2026, palavras dele:
> *"quando marcarmos que não é um lead (cliente) na aba de crm do trilho da
> extensão, tem que bloquear todo o uso da extensão, em qualquer parte. deve
> excluir tudo daquele contato no crm do job site, excluir as conversa salvas,
> tudo mesmo. não deve ser tão facil voltar a tras"*
>
> Dono do código: **Antigravity** (`app.py`).
> A parte da extensão **já está pronta** desde a 3.59.0 — não toque nela.

---

## 0. O que já existe e o que falta

**Pronto (Claude, extensão 3.59.0):** marcar como pessoal bloqueia a extensão
inteira naquela conversa — CRM, cotação, notas, fila, tudo. O consultor vê
"Contato marcado como pessoal" e nenhuma aba abre.

**Falta (você):** o servidor **não apaga nada**. A rota
`/crm/lead/<lid>/nao-e-lead` (`app.py:38750`) hoje só faz duas coisas:

```python
UPDATE crm_leads SET auditado_em=? WHERE id=?
_ignorar_conversa_wa(...)
```

O lead continua inteiro no banco, aparecendo em lista, em relatório, em
contagem e em disparo. É exatamente o que ele não quer.

---

## 1. O que apagar

Tudo que estiver amarrado àquele `lead_id` **ou** ao `telefone_norm` dele:

- `crm_leads` — o lead
- cotações do lead (e os planos delas)
- notas, atividades, agenda, tarefas
- fila da extensão, execuções de funil, campanha
- conversas e transcrições salvas
- análises e score

**Descubra a lista real** com `grep -n "lead_id" app.py` antes de escrever.
Tabela que eu esqueci aqui e existe no banco também entra. Se ficar em dúvida
se uma tabela entra, **escreva na conversa e não apague** — apagar de menos se
conserta, apagar demais não.

---

## 2. O que NUNCA apagar

**Proposta.** Se existir proposta não-excluída amarrada ao lead, a rota
**recusa** e não apaga nada — nem parcialmente. Isso já está certo no código de
hoje (`lead_com_proposta`, 400); mantenha.

Nada de apagar em cascata sem checar isso primeiro. Proposta é dinheiro e
contrato de cliente.

---

## 3. A cópia antes de apagar

Antes de qualquer `DELETE`, grave uma linha em **`crm_lead_excluido`** — a
tabela já existe (`app.py:1284`) e já é usada em dois lugares
(`app.py:26944` e `app.py:31907`). Siga o mesmo formato desses dois.

- `motivo` = `'marcado como pessoal'`
- `dados_json` = o lead inteiro **mais** o que você apagou junto (cotações,
  notas, conversas), serializado. É a única chance de voltar atrás.
- `excluido_por_id` = `g.usuario_id` de quem marcou

**Sem a cópia gravada, não apague.** Grave, confira que gravou, aí apague — na
mesma transação.

---

## 4. Transação — a armadilha do Postgres

Tudo num `try` só, com `conn.rollback()` no `except`. Se qualquer `DELETE`
falhar, **nada** foi apagado e a cópia não fica órfã.

Cuidado com o padrão `try/except: pass` — no Postgres ele deixa a transação
abortada e contamina tudo que vem depois. Foi o defeito que você mesmo achou
no `add_col`, e ele reaparece aqui se o `except` não fizer `rollback()`.

---

## 5. "Não deve ser tão fácil voltar atrás"

Frase dele, e é requisito, não estilo.

- **Não** faça um botão "desfazer" na tela.
- A volta existe, mas é manual: alguém com acesso ao banco lê
  `crm_lead_excluido` e recria. É de propósito.
- O `_ignorar_conversa_wa` continua sendo chamado — o telefone entra na lista
  de ignorados e **não volta a virar lead sozinho** na próxima importação da
  planilha. Confira que a dedup por `telefone_norm` respeita essa lista;
  se não respeitar, o lead renasce em 15 minutos e o apagamento foi inútil.

Este último ponto é o que mais tem chance de quebrar. **Teste ele
explicitamente.**

---

## 6. Resposta da rota

```json
{ "ok": true, "apagados": { "cotacoes": 3, "notas": 5, "conversas": 12 } }
```

A extensão mostra o que sumiu. Regra da seção 9 do escopo — **o óbvio tem que
ser dito**: quem marca um contato como pessoal precisa ver o tamanho do que
acabou de apagar, não um "pronto" mudo.

Recusa por proposta continua `{"ok": false, "erro": "lead_com_proposta"}` com
400, e eu já trato isso na extensão.

---

## 7. Testes — contra Postgres

1. Lead sem proposta → apaga, e `crm_lead_excluido` ganha a linha com
   `dados_json` preenchido
2. Lead **com** proposta → 400, e **nada** foi apagado (confira contando as
   cotações antes e depois)
3. Lead com cotação, nota e conversa → os três somem, e os contadores da
   resposta batem com o que sumiu
4. **Rodar a importação de leads depois** e conferir que o telefone **não
   voltou** — é o teste da seção 5
5. Forçar erro no meio (nome de tabela errado de propósito) e conferir que o
   `rollback` deixou tudo como estava, inclusive sem cópia órfã

Rota que você não viu responder não foi testada.

---

## 8. Prioridade

Este contrato é o **item 4** da fila. Faça depois do Lote 1 da API e da
evolução da tela de chaves. Não comece antes de o Lote 1 estar auditado.
