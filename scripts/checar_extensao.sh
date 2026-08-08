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
[ $erro -eq 0 ] && echo "todos os JS da extensao compilam"
exit $erro
