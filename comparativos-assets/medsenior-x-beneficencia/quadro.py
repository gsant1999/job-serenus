# -*- coding: utf-8 -*-
"""Calcula o quadro por especialidade.

Metrica das barras: medicos NOMINAIS de cada plano, descontando o bloco repetido
do corpo clinico do Santa Tereza (que o guia da MedSenior lista igual em 15
especialidades). Quando o guia nao nomeia profissionais, conta locais.
"""
import json, re, unicodedata
from collections import defaultdict

SP = "/private/tmp/claude-501/-Users-guilhermesantos-Desktop-job-serenus--claude-worktrees-saude-beneficencia-medsenior-campinas-e6b486/dfa999e2-730c-40bd-a84e-3c562f8af867/scratchpad"
d = json.load(open(f"{SP}/dados.json", encoding="utf-8"))
rede, prest_espec, bene_espec, bene_med = d["rede_med"], d["prest_espec"], d["bene_espec"], d["bene_med"]
santa_docs = set(d["santa_medicos"])


def base(e):
    e = unicodedata.normalize("NFD", e)
    e = "".join(c for c in e if unicodedata.category(c) != "Mn").upper()
    return re.sub(r"\s+", " ", re.sub(r"[^A-Z ]", " ", e)).strip()


GRUPO = {
    "CARDIOLOGIA": "Cardiologia", "ARRITMOLOGIA": "Cardiologia",
    "GERIATRIA": "Geriatria",
    "ENDOCRINOLOGIA E METABOLOGIA": "Endocrinologia", "ENDOCRINOLOGIA": "Endocrinologia",
    "ORTOPEDIA E TRAUMATOLOGIA": "Ortopedia", "ORTOPEDIA": "Ortopedia",
    "ORTOPEDIA JOELHO": "Ortopedia", "ORTOPEDIA QUADRIL": "Ortopedia",
    "ORTOPEDIA PE E TORNOZELO": "Ortopedia",
    "OFTALMOLOGIA": "Oftalmologia", "OTORRINOLARINGOLOGIA": "Otorrinolaringologia",
    "NEUROLOGIA": "Neurologia", "NEUROLOGIA CLINICA": "Neurologia",
    "NEUROCIRURGIA": "Neurocirurgia", "NEURO CIRURGIA": "Neurocirurgia",
    "UROLOGIA": "Urologia",
    "GINECOLOGIA": "Ginecologia", "CIRURGIA GINECOLOGICA": "Ginecologia",
    "DERMATOLOGIA": "Dermatologia",
    "GASTROENTEROLOGIA": "Gastroenterologia", "COLOPROCTOLOGIA": "Coloproctologia",
    "PNEUMOLOGIA": "Pneumologia", "NEFROLOGIA": "Nefrologia",
    "REUMATOLOGIA": "Reumatologia",
    "ONCOLOGIA CLINICA": "Oncologia", "ONCOLOGIA": "Oncologia",
    "CIRURGIA ONCOLOGICA": "Oncologia", "RADIOTERAPIA": "Oncologia",
    "HEMATOLOGIA E HEMOTERAPIA": "Hematologia", "HEMATOLOGIA": "Hematologia",
    "INFECTOLOGIA": "Infectologia",
    "PSIQUIATRIA": "Psiquiatria", "PSICOLOGIA": "Psicologia",
    "ANGIOLOGIA": "Angiologia e cirurgia vascular",
    "CIRURGIA VASCULAR": "Angiologia e cirurgia vascular",
    "ANGIOLOGIA E CIRURGIA VASCULAR": "Angiologia e cirurgia vascular",
    "CIRURGIA PLASTICA": "Cirurgia plástica", "MASTOLOGIA": "Mastologia",
    "FISIOTERAPIA": "Fisioterapia", "FISIATRIA": "Fisioterapia",
    "FONOAUDIOLOGIA": "Fonoaudiologia",
    "NUTRICAO": "Nutrição", "NUTRICIONISTA": "Nutrição", "NUTROLOGIA": "Nutrição",
    "ACUPUNTURA": "Acupuntura", "MEDICO DA DOR": "Medicina da dor",
    "ALERGIA E IMUNOLOGIA": "Alergia e imunologia", "HOMEOPATIA": "Homeopatia",
    "CLINICA MEDICA": "Clínica médica", "CLINICA GERAL": "Clínica médica",
    "CLINICA MEDICA GERAL": "Clínica médica",
    "MEDICINA DE FAMILIA E COMUNIDADE": "Clínica médica",
    "CIRURGIA GERAL": "Cirurgia geral",
    "CIRURGIA DE CABECA E PESCOCO": "Cabeça e pescoço",
    "CIRURGIA BUCO MAXILO FACIAL": "Bucomaxilofacial",
    "CIRURGIA E TRAUMATOLOGIA BUCOMAXILOFACIAL": "Bucomaxilofacial",
    "CIRURGIA TORACICA": "Cirurgia torácica", "GENETICA MEDICA": "Genética médica",
    "TERAPIA OCUPACIONAL": "Terapia ocupacional",
}

med_prest, med_docs, tem_santa = defaultdict(set), defaultdict(set), set()
for p, esps in prest_espec.items():
    for e in esps:
        g = GRUPO.get(base(e))
        if g:
            med_prest[g].add(p)
            if "Santa Tereza" in p:
                tem_santa.add(g)
for e, prs in rede.items():
    g = GRUPO.get(base(e))
    if g:
        for p, s in prs.items():
            med_docs[g] |= set(s)

bene_prest, bene_docs = defaultdict(set), defaultdict(set)
for e, nomes in bene_espec.items():
    g = GRUPO.get(base(e))
    if not g:
        continue
    bene_docs[g] |= set(nomes)
    for n in nomes:
        for o in bene_med[n]["onde"]:
            if o["razao"]:
                bene_prest[g].add(o["razao"])

linhas = []
for g in sorted(set(med_prest) | set(bene_prest)):
    bd, bp = len(bene_docs.get(g, ())), len(bene_prest.get(g, ()))
    # medicos da MedSenior sem o bloco repetido do hospital
    mdf = len(med_docs.get(g, set()) - santa_docs)
    mp = len(med_prest.get(g, ()))
    mp_fora = len([p for p in med_prest.get(g, ()) if "Santa Tereza" not in p])
    linhas.append({
        "esp": g, "bd": bd, "bp": bp, "md": mdf, "mp": mp, "mp_fora": mp_fora,
        "santa": g in tem_santa,
    })

# valor comparavel. so compara medicos com medicos: se um dos lados nao nomeia
# profissionais (psicologia, fisioterapia, fonoaudiologia), a comparacao cai
# para locais dos dois lados, que e a base comum.
for l in linhas:
    if l["bd"] and l["md"]:
        b, m = l["bd"], l["md"]
    else:
        b, m = l["bp"] * 4, l["mp_fora"] * 4
        l["por_local"] = True
    # o hospital proprio entra como reforco, nao como dezenas de especialistas
    if l["santa"]:
        m += 6
    l["peso_b"], l["peso_m"] = b, m
    if m >= b * 1.6:
        l["lado"] = "med"
    elif b >= m * 1.6:
        l["lado"] = "bene"
    else:
        l["lado"] = "empate"

json.dump(linhas, open(f"{SP}/linhas.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

for lado in ("med", "empate", "bene"):
    sel = [l for l in linhas if l["lado"] == lado]
    print(f"\n### {lado.upper()} ({len(sel)})")
    for l in sorted(sel, key=lambda x: -x["peso_m"]):
        st = " +ST" if l["santa"] else "   "
        print(f"  {l['esp']:32s} Bene {l['bd']:3d}med/{l['bp']}loc   Med {l['md']:3d}med/{l['mp_fora']}loc{st}")
