# -*- coding: utf-8 -*-
"""Monta templates/rede_beneficencia.html a partir de template.html + rede_beneficencia_data.json."""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

with open(os.path.join(HERE, "rede_beneficencia_data.json"), "r", encoding="utf-8") as f:
    data_json = f.read()

with open(os.path.join(HERE, "template.html"), "r", encoding="utf-8") as f:
    tpl = f.read()

out = tpl.replace("__BENE_DATA__", data_json)

dest = os.path.join(REPO, "templates", "rede_beneficencia.html")
with open(dest, "w", encoding="utf-8") as f:
    f.write(out)

print("OK ->", dest, "(%d bytes)" % len(out))
