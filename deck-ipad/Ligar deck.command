#!/bin/sh
# Duplo-clique neste arquivo liga o deck. Nao precisa instalar nada.
# Fechar a janela do Terminal desliga o deck.
cd "$(dirname "$0")" || exit 1
PY=$(command -v python3 2>/dev/null)
[ -x "$PY" ] || PY=/usr/bin/python3
exec "$PY" servidor.py
