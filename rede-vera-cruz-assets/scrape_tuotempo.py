# -*- coding: utf-8 -*-
"""
Coleta a rede PROPRIA da Vera Cruz (medico + especialidade + unidade) via a API
publica do TuoTempo (sistema de agendamento do proprio grupo Vera Cruz).

Confirmado com o usuario: essa rede propria (unidades tipo Centro Clinico Nova
Campinas, Centro Clinico Guanabara, Centro Medico Vera Cruz Indaiatuba etc.) e a
MESMA nos planos Vera Prata e Vera Ouro -- nao e credenciada, e o corpo clinico
proprio do grupo. Usa esses dados para enriquecer as "unidades" ja extraidas dos
PDFs oficiais (que so tinham lista de especialidades, sem nome de medico).
"""
import json
import time
import urllib.request
import urllib.parse

BASE = "https://app.tuotempo.com/api/v3/tt_elf_tasy_careveracruz_prod/"
Q = {"version": "1.1", "lang": "pt_BR", "application": "MOP", "client": "desktop"}
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                         "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}

# Nomes das areas no TuoTempo que correspondem a unidades de consulta da rede propria
# (chave usada no JSON de saida -> variações de nome no TuoTempo)
AREA_MAP = {
    "Ambulatorio Casa de Saude": ["CASA DE SAÚDE"],
    "Centro Clinico Guanabara": ["CENTRO CLINICO GUANABARA", "CENTRO CLÍNICO GUANABARA"],
    "Centro Clinico Nova Campinas": ["CENTRO CLINICO NOVA CAMPINAS"],
    "Centro Medico Sao Camilo Indaiatuba": ["CENTRO MÉDICO SÃO CAMILO INDAIATUBA"],
    "Espaco Vera Cruz": ["ESPAÇO VERA CRUZ - SHOPPING IGUATEMI"],
    "Centro Medico Vera Cruz Indaiatuba": ["VERA CRUZ CENTRO MÉDICO DE INDAIATUBA"],
    "Vera Cruz Neurologia e Coluna": ["VERA CRUZ NEUROLOGIA E COLUNA"],
    "Ambulatorio Hospital Vera Cruz": ["AMBULATÓRIO HOSPITAL VERA CRUZ"],
}

# Nomes que nao sao medicos de verdade (recursos de agenda/exame/placeholder)
JUNK_NAMES = {
    "CONSULTA (NOVA)", "AMBULATÓRIO CURATIVOS", "CMI - ECOCARDIOGRAMA",
    "CNE - ELETROENCEFALOGRAMA",
}
# Especialidades que na verdade sao nomes de EXAME (nao especialidade medica) --
# aparecem coladas em alguns resourceid por erro de cadastro; filtra fora da lista.
EXAME_KEYWORDS = ("DOPPLER", "ECOCARDIOGRAMA", "ELETROENCEFALOGRAMA", "MAPEAMENTO CEREBRAL")


def get(path, **params):
    qs = dict(Q)
    qs.update(params)
    url = BASE + path + "?" + urllib.parse.urlencode(qs)
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)


def main():
    areas_resp = get("areas", fields="areaid,areaTitle")
    areas = areas_resp["return"]["results"]

    by_name = {}
    for a in areas:
        j = get("resources", areaid=a["areaid"], fields="resourceid,resourceName")
        docs = (j.get("return") or {}).get("results") or []
        by_name.setdefault(a["areaTitle"], {})
        for d in docs:
            by_name[a["areaTitle"]][d["resourceid"]] = d["resourceName"]

    out = {}
    all_ids = set()
    for key, names in AREA_MAP.items():
        merged = {}
        for n in names:
            merged.update(by_name.get(n, {}))
        out[key] = merged
        all_ids.update(merged.keys())

    print("Medicos unicos a resolver especialidade:", len(all_ids))

    spec_cache = {}
    for i, rid in enumerate(all_ids):
        j = get("activities", resourceid=rid, fields="activityTitle")
        results = (j.get("return") or {}).get("results") or []
        spec_cache[rid] = [r["activityTitle"] for r in results]
        if (i + 1) % 50 == 0:
            print("  ...", i + 1, "/", len(all_ids))

    final = {}
    for key, docs in out.items():
        rows = []
        seen_names = set()
        for rid, name in docs.items():
            if name in JUNK_NAMES:
                continue
            specs = [s for s in spec_cache.get(rid, []) if not any(k in s.upper() for k in EXAME_KEYWORDS)]
            if not specs:
                continue
            dedup_key = (name, tuple(sorted(specs)))
            if dedup_key in seen_names:
                continue
            seen_names.add(dedup_key)
            rows.append({"n": name.title(), "e": specs})
        rows.sort(key=lambda r: r["n"])
        final[key] = rows

    with open("tuotempo_propria.json", "w", encoding="utf-8") as f:
        json.dump(final, f, ensure_ascii=False, separators=(",", ":"))

    for k, v in final.items():
        print(k, len(v))


if __name__ == "__main__":
    main()
