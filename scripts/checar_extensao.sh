#!/bin/sh
# Todo arquivo JS da extensao tem que COMPILAR. Parece obvio e nao e:
# um `try` sem `catch` no wpp-bridge.js derrubou a extensao inteira e ninguem
# viu — o Chrome nao avisa, o arquivo simplesmente nao executa, e a barra
# aparece funcionando pela metade. Custa 1 segundo rodar isto.
cd "$(dirname "$0")/../extensao-whatsapp" || exit 1
erro=0
for f in *.js; do
  [ "$f" = "wa-js.vendor.js" ] && continue
  if ! node --check "$f" >/dev/null 2>&1; then
    echo "NAO COMPILA: $f"
    node --check "$f" 2>&1 | head -4
    erro=1
  fi
done
# ── CONTAGEM DE FUNÇÕES ────────────────────────────────────────────────────
# Em 09/08/2026 um recorte por índice de string removeu 46 funções do
# content.js. O arquivo continuou COMPILANDO — node --check passou, este script
# passou — e a extensão morreu na máquina do Guilherme: o trilho sumiu.
#
# Sintaxe válida não é o mesmo que código inteiro. Uma queda brusca na
# contagem de funções é o sinal mais barato de que um bloco foi embora sem
# querer. Não é prova; é o alarme que faltava.
_FUNCOES_MIN=340
_n=$(grep -cE '^[[:space:]]*(async )?function ' content.js)
if [ "$_n" -lt "$_FUNCOES_MIN" ]; then
  echo "ALERTA: content.js tem $_n funções, abaixo do piso de $_FUNCOES_MIN."
  echo "        Um bloco pode ter sido removido por engano. Confira o diff antes de commitar."
  exit 1
fi
echo "content.js: $_n funcoes (piso $_FUNCOES_MIN)"

# ── CONSTANTE USADA E NUNCA DEFINIDA ────────────────────────────────────────
#
# 10/08/2026: `_ICO_DOC` era usado em quatro lugares e definido em nenhum. A
# funcao que desenha o botao "Ler documento" estourava com ReferenceError toda
# vez, o bloco ficava vazio, e a regra que esconde bloco vazio o tornava
# invisivel. Tres blocos na tela, nenhum botao, nenhum sintoma.
#
# `node --check` NAO pega isso: sintaxe valida nao e o mesmo que variavel
# existir. Passei o dia perseguindo os sintomas dessa linha, e quando finalmente
# achei pelo console, consertei so ela — uma hora depois o mesmo erro voltou com
# `_ICO_MAIS`, e faltavam TRES.
#
# Isto e a busca de trinta segundos que eu deveria ter feito de primeira,
# rodando sozinha antes de todo commit.
_faltando=""
for _u in $(grep -ohE '_ICO_[A-Z_]+' *.js | sort -u); do
  if ! grep -qE "(const|let|var)[[:space:]]+${_u}[[:space:]]*=" *.js; then
    _faltando="$_faltando $_u"
  fi
done
if [ -n "$_faltando" ]; then
  echo "ALERTA: constante(s) usada(s) e nunca definida(s):$_faltando"
  echo "        Isso NAO quebra a sintaxe — quebra em execucao, e some da tela"
  echo "        sem erro visivel pro usuario. Defina ou remova o uso."
  exit 1
fi
echo "constantes de icone: todas definidas"

# ── TRABALHO INVISIVEL EM SEGUNDO PLANO ──────────────────────────────────
#
# 14/08/2026: a maquina trabalhadora mantinha o service worker acordado por
# 55s de cada minuto e consultava a fila a cada 2s. Ao mesmo tempo, a aba do
# WhatsApp mantinha relogios de envio e presenca a cada 20s/60s mesmo oculta.
# O renderer chegou a 4,4 GB e RESULT_CODE_HUNG. Estas assinaturas nao podem
# voltar silenciosamente.
if grep -qE '_JANELA_MS|_abrirJanela|_trabRitmo[[:space:]]*=[[:space:]]*2000' background.js; then
  echo "ALERTA: o polling continuo do service worker voltou."
  erro=1
fi
if grep -qE 'setInterval\((checarFilaDeEnvio|baterPontoDisparo)' content.js; then
  echo "ALERTA: fila ou presenca voltou a usar intervalo fixo em segundo plano."
  erro=1
fi
if ! grep -q '_soComAbaVisivel' content.js || ! grep -q '_agendarFila(60)' content.js; then
  echo "ALERTA: faltam as travas de pausa da aba oculta."
  erro=1
fi
# O laco do deck do iPad nasceu depois desse incendio e carrega as travas dele:
# dorme apos tres falhas e so reaparece pelo alarme de um minuto. Sem isso, o
# deck vira exatamente o trabalhador de 14/08 com outro nome.
if ! grep -q 'DECK_FALHAS_ATE_DORMIR' background.js \
   || ! grep -q "alarms.create('deck_procurar'" background.js; then
  echo "ALERTA: o laco do deck do iPad perdeu a trava de dormir."
  erro=1
fi
[ $erro -eq 0 ] && echo "segundo plano: polling continuo bloqueado"


[ $erro -eq 0 ] && echo "todos os JS da extensao compilam"
exit $erro
