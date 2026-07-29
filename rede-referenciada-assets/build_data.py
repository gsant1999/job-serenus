import json, re

SCRATCH = "/private/tmp/claude-501/-Users-guilhermesantos-Desktop-job-serenus--claude-worktrees-extract-healthcare-network-sp-campinas-b31ee7/93256248-530d-4530-a474-4922f6639fed/scratchpad"

with open(f"{SCRATCH}/hospitais.json", encoding="utf-8") as f:
    hosp = json.load(f)
with open(f"{SCRATCH}/sp3.json", encoding="utf-8") as f:
    sp3 = json.load(f)
with open(f"{SCRATCH}/camp3.json", encoding="utf-8") as f:
    camp3 = json.load(f)
with open(f"{SCRATCH}/hospitais_rio.json", encoding="utf-8") as f:
    hosp_rio = json.load(f)
with open(f"{SCRATCH}/rio3.json", encoding="utf-8") as f:
    rio3 = json.load(f)

TIPO_SHORT = {
    "Pronto Socorro": "ps",
    "Hospital e Maternidade": "hm",
    "Hospital Dia": "hd",
    "Medico, Clinica, Centro Diagnostico": "mc",
}

def title_cap(s):
    s = (s or "").strip()
    if not s:
        return ""
    small = {"de", "da", "do", "das", "dos", "e"}
    words = s.split()
    out = []
    for i, w in enumerate(words):
        wl = w.lower()
        if i > 0 and wl in small:
            out.append(wl)
        else:
            out.append(wl.capitalize())
    return " ".join(out)

def fmt_addr(p):
    end = title_cap(p.get("endereco", ""))
    numero = (p.get("numero") or "").strip()
    comp = title_cap(p.get("complemento", ""))
    if numero and numero != "S/N":
        addr = f"{end}, {numero}"
    elif numero == "S/N":
        addr = f"{end}, S/N"
    else:
        addr = end
    if comp:
        addr += f" - {comp}"
    return addr

def fmt_cep(cep):
    cep = re.sub(r"\D", "", cep or "")
    if len(cep) < 8:
        cep = cep.zfill(8)
    return f"{cep[:5]}-{cep[5:]}"

def clean_tel(t):
    digits = re.sub(r"\D", "", t)
    return digits

def build_record(p, tipo_label):
    tels = []
    for t in (p.get("telefones") or []):
        d = clean_tel(t)
        if d and d not in tels:
            tels.append(d)
    esps = [title_cap(e) for e in (p.get("especialidades") or [])]
    esps = [e for e in esps if e and not e.startswith("Cod:")]
    rec = {
        "n": title_cap(p["nome"]),
        "t": TIPO_SHORT[tipo_label],
        "e": fmt_addr(p),
        "b": title_cap(p.get("bairro", "")),
        "c": fmt_cep(p.get("cep", "")),
        "f": tels,
        "s": esps,
    }
    if p.get("agendamentoOnline"):
        rec["o"] = 1
    if p.get("teleconsulta"):
        rec["v"] = 1
    quals = p.get("qualificacoes") or []
    if quals:
        rec["q"] = quals
    return rec

def build_city(hosp_map, key1, key2, key7, medicos):
    recs = []
    for p in hosp_map.get(key1, []):
        recs.append(build_record(p, "Pronto Socorro"))
    for p in hosp_map.get(key2, []):
        recs.append(build_record(p, "Hospital e Maternidade"))
    for p in hosp_map.get(key7, []):
        recs.append(build_record(p, "Hospital Dia"))
    for p in medicos:
        recs.append(build_record(p, "Medico, Clinica, Centro Diagnostico"))
    return recs

sp_records = build_city(hosp, "sp1", "sp2", "sp7", sp3)
camp_records = build_city(hosp, "camp1", "camp2", "camp7", camp3)
rio_records = build_city(hosp_rio, "rio1", "rio2", "rio7", rio3)

# rio7 key doesn't exist in hosp_rio (empty) -> handle gracefully
hosp_rio.setdefault("rio7", [])
rio_records = build_city(hosp_rio, "rio1", "rio2", "rio7", rio3)

data = {
    "sp": {"label": "Sao Paulo", "records": sp_records},
    "camp": {"label": "Campinas", "records": camp_records},
    "rio": {"label": "Rio de Janeiro", "records": rio_records},
}

for city, d in data.items():
    tipos = {}
    esps = {}
    for r in d["records"]:
        tipos[r["t"]] = tipos.get(r["t"], 0) + 1
        for e in r["s"]:
            esps[e] = esps.get(e, 0) + 1
    print(city, "total:", len(d["records"]), "tipos:", tipos, "especialidades:", len(esps))

out_path = f"{SCRATCH}/rede_data.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

import os
print("saved:", out_path, "size:", os.path.getsize(out_path))
