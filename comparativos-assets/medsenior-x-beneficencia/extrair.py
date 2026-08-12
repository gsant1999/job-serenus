import pdfplumber, re, json, unicodedata
from collections import defaultdict

SP = "/private/tmp/claude-501/-Users-guilhermesantos-Desktop-job-serenus--claude-worktrees-saude-beneficencia-medsenior-campinas-e6b486/dfa999e2-730c-40bd-a84e-3c562f8af867/scratchpad"
MED = "/Users/guilhermesantos/Downloads/Guia Medico Completo.pdf"
BENE = "/Users/guilhermesantos/Downloads/RELATORIO_CPLS_1052_1208202611563367484858836584834.PDF"


def norm(s):
    s = unicodedata.normalize("NFD", s)
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"[^A-Za-z ]", " ", s.upper())
    return re.sub(r"\s+", " ", s).strip()


# =====================================================================
# BENEFICENCIA — duas colunas, corta ao meio
# =====================================================================
bene_txt = []
with pdfplumber.open(BENE) as pdf:
    for pg in pdf.pages:
        w, h = pg.width, pg.height
        for x0, x1 in ((0, w / 2), (w / 2, w)):
            t = pg.crop((x0, 60, x1, h - 40)).extract_text(x_tolerance=1.5) or ""
            bene_txt.append(t)
bene = "\n".join(bene_txt)
open(f"{SP}/bene_col.txt", "w", encoding="utf-8").write(bene)

bene_med, linhas = {}, bene.split("\n")
for i, l in enumerate(linhas):
    m = re.match(r"^(.+?) - CRM: ([\w/]+)\s*$", l.strip())
    if not m:
        continue
    nome, crm = m.group(1).strip(), m.group(2)
    corpo = []
    for l2 in linhas[i + 1 : i + 12]:
        if re.match(r"^.+ - (CRM|CNPJ): ", l2.strip()):
            break
        corpo.append(l2.strip())
    txt = "\n".join(corpo)
    razao = re.search(r"Razão social: (.+)", txt)
    end = re.search(r"Endereço: (.+)", txt)
    espec = ""
    if razao:
        resto = txt[txt.index(razao.group(0)) + len(razao.group(0)) :].strip().split("\n")
        espec = resto[0].strip() if resto else ""
    n = norm(nome)
    if not n:
        continue
    bene_med.setdefault(n, {"nome": nome, "crm": crm, "onde": []})
    bene_med[n]["onde"].append({
        "espec": espec,
        "razao": razao.group(1).strip() if razao else "",
        "end": end.group(1).strip() if end else "",
    })

bene_cnpj = {m.group(2): m.group(1).strip()
             for m in re.finditer(r"^(.+?) - CNPJ: (\d{14})\s*$", bene, re.M)}

# especialidades declaradas na Bene (campo apos "Razão social")
bene_espec = defaultdict(set)
for n, d in bene_med.items():
    for o in d["onde"]:
        for e in re.split(r"[;/]", o["espec"]):
            e = e.strip()
            if e and not e.startswith(("Endereço", "Telefone", "Tipo", "Título", "Razão")):
                bene_espec[e].add(n)

# =====================================================================
# MEDSENIOR — faixa de especialidade = size 14 branco; prestador = size 12
# =====================================================================
eventos = []   # (pagina, top, tipo, texto)
with pdfplumber.open(MED) as pdf:
    for pi, pg in enumerate(pdf.pages):
        crop = pg.crop((0, 62, pg.width, pg.height - 42))
        ws = crop.extract_words(extra_attrs=["size", "non_stroking_color"])
        linhas_pg = defaultdict(list)
        for w in ws:
            linhas_pg[round(w["top"] / 3)].append(w)
        for key in sorted(linhas_pg):
            grupo = sorted(linhas_pg[key], key=lambda w: w["x0"])
            texto = " ".join(g["text"] for g in grupo)
            sz = max(g["size"] for g in grupo)
            cor = str(grupo[0].get("non_stroking_color"))
            top = grupo[0]["top"]
            if sz >= 13.5 and "1.0, 1.0, 1.0" in cor:
                eventos.append((pi, top, "ESPEC", texto.strip()))
            elif sz >= 11.5:
                eventos.append((pi, top, "PREST", texto.strip()))
            else:
                eventos.append((pi, top, "TXT", texto.strip()))

rede = defaultdict(lambda: defaultdict(set))
prest_espec = defaultdict(set)
prest_cnpj, prest_end = {}, {}

espec_atual = prest = None
modo = None
buf = []


def fecha():
    global buf, modo
    if buf and prest and espec_atual:
        for nome in " ".join(buf).split(" - "):
            n = norm(nome)
            if 5 < len(n) < 60 and len(n.split()) >= 2:
                rede[espec_atual][prest].add(n)
    buf, modo = [], None


for pi, top, tipo, txt in eventos:
    if tipo == "ESPEC":
        fecha()
        espec_atual, prest = txt, None
        continue
    if tipo == "PREST":
        fecha()
        prest = txt
        if espec_atual:
            prest_espec[prest].add(espec_atual)
        continue
    if txt.startswith("CNPJ:"):
        fecha()
        if prest:
            prest_cnpj[prest] = txt.replace("CNPJ:", "").strip()
        continue
    if txt.startswith("Corpo Clínico:"):
        fecha()
        modo = "corpo"
        continue
    if txt.startswith(("Endereço:", "Telefones:")):
        fecha()
        modo = "end" if txt.startswith("Endereço:") else None
        continue
    if modo == "corpo":
        buf.append(txt)
    elif modo == "end" and prest and prest not in prest_end:
        prest_end[prest] = txt
fecha()

santa_espec = defaultdict(set)
for e, prs in rede.items():
    for p, s in prs.items():
        if "Santa Tereza" in p:
            santa_espec[e] |= s
todos_santa = set().union(*santa_espec.values()) if santa_espec else set()

json.dump({
    "santa_especialidades": {k: sorted(v) for k, v in santa_espec.items()},
    "santa_medicos": sorted(todos_santa),
    "rede_med": {e: {p: sorted(s) for p, s in prs.items()} for e, prs in rede.items()},
    "prest_espec": {k: sorted(v) for k, v in prest_espec.items()},
    "prest_cnpj": prest_cnpj, "prest_end": prest_end,
    "bene_med": bene_med, "bene_cnpj": bene_cnpj,
    "bene_espec": {k: sorted(v) for k, v in bene_espec.items()},
}, open(f"{SP}/dados.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

print(f"Bene      : {len(bene_med)} medicos, {len(bene_cnpj)} PJs, {len(bene_espec)} especialidades")
print(f"MedSenior : {len(rede)} especialidades, {len(prest_espec)} prestadores")
print(f"Santa Tereza: {len(santa_espec)} especialidades, {len(todos_santa)} medicos unicos\n")
for e in sorted(santa_espec):
    print(f"   {e:36s} {len(santa_espec[e]):3d}")
