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

[ $erro -eq 0 ] && echo "todos os JS da extensao compilam"
exit $erro
