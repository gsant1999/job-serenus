# Biblioteca de Conteúdo — inventário antes de mexer

Levantado em 12/08/2026, na branch `worktree-biblioteca-conteudo`. Serve para uma
coisa: saber exatamente quem lê e quem escreve nas tabelas da biblioteca antes de
reorganizá-la, para nenhuma reorganização apagar conteúdo nem quebrar Funil,
Fluxo, extensão ou importador.

## Como a biblioteca é guardada hoje

| Tabela | O que guarda | Colunas que importam |
|---|---|---|
| `modelos_conteudo` | todo conteúdo, dos três canais | `tipo` (whatsapp/email/sms), `nome`, `assunto`, `corpo_html`, `corpo_texto`, `midia_arquivo`, `midia_tipo`, `categoria`, `favorito`, `ativo`, `pasta_id`, `dono_consultor_id` |
| `pastas` | a árvore | `nome`, `parent_id`, `consultor_id` (só na raiz) |
| `whatsapp_funis` | sequência de disparo da extensão | `nome`, `categoria`, `ativo`, `pasta_id`, `dono_consultor_id` |
| `whatsapp_funil_passos` | os passos da sequência | `funil_id`, `ordem`, `modelo_id`, `delay_segundos` |
| `fluxos` / `fluxo_passos` | automação de e-mail/SMS do CRM | `fluxo_passos.template` no formato `upload_<id de modelos_conteudo>` |
| `fluxo_envio_log` | o que cada fluxo enviou | `modelo_id` |

Três regras estruturais que a reorganização não pode violar:

1. **`fluxo_passos.template = 'upload_<id>'`.** O vínculo é pelo ID do conteúdo.
   Mover e transferir mantêm o ID; copiar e duplicar criam ID novo. Apagar e
   recriar um conteúdo — mesmo com nome idêntico — quebra todo Fluxo que aponta
   para ele.
2. **`dono_consultor_id` é denormalizado a partir da raiz da pasta.** Existe para
   a extensão filtrar com um `WHERE` direto a cada troca de conversa, sem subir a
   árvore. Quem muda a pasta precisa manter os dois campos coerentes.
3. **`consultor_id` só existe na pasta raiz.** O dono de uma subpasta é sempre
   calculado subindo até a raiz (`_pasta_dono`).

## Quem lê e quem escreve

Levantado por varredura do `app.py` (linha e função). "Escrita" = `INSERT`,
`UPDATE`, `DELETE` ou DDL.

### `modelos_conteudo` — 69 ocorrências, 20 escritas

Escrevem: `init_db` (L979, DDL) · `api_whatsapp_enviar_direto` (L23510, contador
`vezes_usado`) · `api_whatsapp_extensao_modelo_novo` (L23711) ·
`api_whatsapp_extensao_modelo_favorito` (L23738) ·
`api_whatsapp_extensao_modelo_excluir` (L23760) · `_duplicar_modelo_whatsapp`
(L23787) · `crm_modelo_email_novo` (L38057) · `crm_modelo_sms_novo` (L38084) ·
`crm_modelo_whatsapp_novo` (L38152) · `crm_importar_zapvoice` (L38297) ·
`crm_modelo_favorito` (L38369) · `crm_modelo_toggle` (L38401) ·
`crm_modelo_excluir` (L38418) · `crm_modelo_editar` (L38467) ·
`_pasta_recalcular_cascata` (L38515, troca dono em cascata) ·
`crm_modelo_mover_pasta` (L38653) · `crm_pastas_backfill_automatico` (L38701,
com `?reset=1` zera `pasta_id` e `dono_consultor_id` de tudo).

Leem, entre outros: `_txts_por_ids` (L9492) · `_campanha_disparar_funil` (L9625)
· `_lead_pago_opener` (L9694) · `_lead_atender_com_funil` (L9727) · `campanhas`
(L9886) · `campanha_detalhe` (L10142) · `api_whatsapp_enviar_direto` (L23441,
autorização do envio) · `api_whatsapp_extensao_modelos` (L23648) ·
`api_whatsapp_extensao_funis` (L23841) · `_fluxo_executar_passo` (L37461,
resolve `upload_<id>`) · `crm_fluxo_editor` (L37715) · `crm_fluxo_salvar`
(L37767) · `crm_modelos` (L37856) · `crm_modelos_exportar_backup` (L37945) ·
`_construir_arvore_pastas` (L38526, contagem) · `_funil_salvar_completo`
(L38862, valida os passos) · `crm_funis` (L38979).

### `pastas` — 50 ocorrências, 11 escritas

Escrevem: `init_db` (L1476) · `crm_importar_zapvoice` (L38239, cria a pasta da
importação) · `crm_pasta_nova` (L38559) · `crm_pasta_renomear` (L38577) ·
`crm_pasta_mover` (L38612) · `crm_pasta_excluir` (L38634) ·
`crm_pastas_backfill_automatico` (L38703, `DELETE FROM pastas` no modo reset) ·
`_achar_ou_criar_raiz` (L38751) · `_achar_ou_criar_sub` (L38759).

Leem: `_pasta_dono` (L38492) · `_pasta_recalcular_cascata` (L38513) ·
`_construir_arvore_pastas` (L38520) · `crm_modelo_mover_pasta` (L38650) ·
`crm_funil_mover_pasta` (L38669) · `_funil_salvar_completo` (L38875) ·
`crm_modelos_exportar_backup` (L37950).

### `whatsapp_funis` — 44 ocorrências, 16 escritas

Escrevem: `init_db` (L1459) · `api_whatsapp_extensao_funil_disparado` (L24244,
contador) · `crm_importar_zapvoice` (L38334) · `_pasta_recalcular_cascata`
(L38516) · `crm_funil_mover_pasta` (L38672) · `crm_pastas_backfill_automatico`
(L38702) · `_funil_salvar_completo` (L38887) · `_duplicar_funil` (L39029) ·
`crm_funil_novo` (L39096) · `crm_funil_renomear` (L39116) · `crm_funil_favorito`
(L39130) · `crm_funil_excluir` (L39143).

### `whatsapp_funil_passos` — 26 ocorrências, 12 escritas

Escrevem: `init_db` (L1469) · `crm_importar_zapvoice` (L38340) ·
`_funil_salvar_completo` (L38893, apaga e regrava a sequência inteira) ·
`_duplicar_funil` (L39036) · `crm_funil_excluir` (L39142) ·
`crm_funil_passo_novo` (L39163) · `crm_funil_passo_delay` (L39180) ·
`crm_funil_passo_mover` (L39206) · `crm_funil_passo_excluir` (L39219).

### `fluxos` / `fluxo_passos` / `fluxo_envio_log`

`fluxo_passos` é escrito por `_seed_fluxos_padrao` (L37329), `crm_fluxo_salvar`
(L37798, apaga e regrava) e `crm_fluxo_excluir` (L37816). Lido por
`_fluxo_inscrever` (L37397), `_processar_fluxos_pendentes` (L37574),
`crm_fluxos` (L37635), `crm_fluxo_editor` (L37704) e
`crm_modelos_exportar_backup` (L37955). `fluxo_envio_log` só é escrito pelo motor
de envio (L37587) e guarda `modelo_id`.

**Nenhuma rota da biblioteca escreve em `fluxo_passos`.** O vínculo é sempre pelo
ID — por isso mover e transferir são seguros e apagar não é.

## Permissões hoje

| Quem | Onde | O que vê |
|---|---|---|
| admin / supervisor / gestor_vendedor | site | tudo, os três canais |
| consultor | site | só o WhatsApp próprio (`crm_modelos`, L37853) |
| consultor | extensão | próprio + compartilhado; funil com passo de outro dono é omitido (L23839) |
| extensão, envio | servidor | `api_whatsapp_enviar_direto` (L23441) barra conteúdo de terceiro com 403 |

Buracos que a reorganização precisa fechar: várias rotas de escrita da biblioteca
usam `@admin_required` sem checar dono (`crm_modelo_favorito`, `crm_modelo_toggle`,
`crm_modelo_excluir`, `crm_modelo_editar`, `crm_modelo_mover_pasta`,
`crm_funil_mover_pasta`, `crm_pasta_*`). Como `admin_required` também deixa
passar consultor com o módulo `crm_modelos` liberado, um consultor com esse
módulo pode hoje editar e excluir conteúdo de qualquer colega pelo site.

## Dados legados

- Conteúdo com `pasta_id IS NULL` existe e não pode sumir da tela. Tratamento
  escolhido: aparecer numa pasta virtual **Sem localização**, dentro do
  proprietário correspondente (Compartilhado quando não tem dono). É visível e
  reversível — o gestor move de lá quando quiser, e nenhum `UPDATE` em massa é
  feito na migração.
- A raiz `A organizar`, criada pelo backfill de 2026, continua existindo como
  raiz sem dono. Não é apagada.
- E-mail e SMS nasceram sem dono e sem pasta: na árvore proprietário-primeiro
  eles aparecem em Compartilhado (ou em Sem localização, quando sem pasta).

## Ferramentas criadas nesta fase

- `scripts/inspecionar_biblioteca.py` — foto somente leitura da biblioteca
  (contagens por canal, por mídia, por dono, pastas, passos de funil e
  referências de Fluxo) com assinaturas de ID, mídia, vínculo e conteúdo.
  `--salvar` grava a foto; `--comparar` diz o que mudou e falha se mudou o que
  não devia.
- `testes/testar_biblioteca.py` — bateria em SQLite, banco novo a cada rodada,
  cobrindo os oito casos: WhatsApp, SMS, e-mail, mídia, Funil, passo de Funil,
  referência de Fluxo e permissões de gestor, dono e não-dono.

Rodar (da raiz do repositório):

```
/usr/bin/python3 testes/testar_biblioteca.py
JOB_DATA_DIR=/tmp/jobtest-biblioteca /usr/bin/python3 scripts/inspecionar_biblioteca.py --salvar /tmp/antes.json
```

O `python3` do Homebrew nesta máquina não tem as dependências do app (dateutil,
pytz, requests); o `/usr/bin/python3` tem.
