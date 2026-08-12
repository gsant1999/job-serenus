# -*- coding: utf-8 -*-
"""Monta o comparativo HTML a partir dos dados extraidos dos dois guias medicos."""
import json, html, re, sys

import os
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
SP = HERE
d = json.load(open(f"{SP}/dados.json", encoding="utf-8"))
linhas = json.load(open(f"{SP}/linhas.json", encoding="utf-8"))

santa_esp = [e for e in d["santa_especialidades"] if e not in ("Internação", "Urgência e Emergência")]
santa_docs = set(d["santa_medicos"])
bene_med = d["bene_med"]
santa_conhecidos = sorted(santa_docs & set(bene_med))

ROTULO_ST = {
    "Anestesiologia": "Anestesia", "Endocrinologia E Metabologia": "Endocrinologia",
    "Ortopedia E Traumatologia": "Ortopedia", "Otorrinolaringologia": "Otorrino",
    "Cirurgia Vascular": "Cirurgia vascular",
}

# ------------------------------------------------------------------ barras
def texto(docs, lug, por_local):
    if docs and not por_local:
        medicos = f"{docs} médico{'s' if docs > 1 else ''}"
        locais = f"{lug} {'locais' if lug > 1 else 'local'}"
        return f"{medicos} em {locais}"
    if lug:
        return f"{lug} clínica{'s' if lug > 1 else ''} credenciada{'s' if lug > 1 else ''}"
    return "não tem na rede"


def barra(l):
    pl = l.get("por_local", False)
    b = l["bd"] if (l["bd"] and not pl) else l["bp"] * 4
    m = l["md"] if (l["md"] and not pl) else l["mp_fora"] * 4
    if l["santa"] and not pl:
        m += 6
    esc = max(b, m, 1)
    selo = '<span class="esp-selo">mais a equipe do Hospital Santa Tereza</span>' if l["santa"] else ""
    return (
        '<div class="linha-esp">'
        f'<div class="esp-nome">{html.escape(l["esp"])}{selo}</div>'
        '<div class="esp-barras">'
        '<div class="bar-linha"><span class="bar-tag hoje">Beneficência</span>'
        f'<span class="bar-trilho"><span class="bar-preenche hoje" style="width:{round(100*b/esc)}%"></span></span>'
        f'<span class="bar-valor">{texto(l["bd"], l["bp"], pl)}</span></div>'
        '<div class="bar-linha"><span class="bar-tag novo">MedSênior</span>'
        f'<span class="bar-trilho"><span class="bar-preenche novo" style="width:{round(100*m/esc)}%"></span></span>'
        f'<span class="bar-valor">{texto(l["md"], l["mp_fora"], pl)}</span></div>'
        '</div></div>'
    )


PRIO = ["Cardiologia", "Geriatria", "Endocrinologia", "Oncologia", "Nefrologia", "Reumatologia",
        "Pneumologia", "Hematologia", "Psiquiatria", "Infectologia", "Clínica médica",
        "Neurologia", "Neurocirurgia", "Urologia", "Gastroenterologia", "Dermatologia",
        "Nutrição", "Fisioterapia", "Coloproctologia", "Cirurgia plástica"]


def grupo(lado):
    sel = [l for l in linhas if l["lado"] == lado]
    pref = {n: i for i, n in enumerate(PRIO)}
    sel.sort(key=lambda l: (pref.get(l["esp"], 90), -max(l["bd"], l["md"], l["bp"] * 4, l["mp_fora"] * 4)))
    return "\n".join(barra(l) for l in sel)


# ------------------------------------------------------------ medicos comuns
todos_med = set()
for e, prs in d["rede_med"].items():
    for p, s in prs.items():
        todos_med |= set(s)
comuns = sorted(todos_med & set(bene_med))

ESP_LIMPA = {
    "Neuro Cirurgia": "Neurocirurgia", "Neurologia Clínica": "Neurologia",
    "Cirurgia Ginecologica": "Cirurgia ginecológica", "Obstetrícia": "Ginecologia",
}
ESP_MANUAL = {"ANDRE LUIS PEREIRA VIEIRA": "Clínica médica"}
LOCAL_LIMPO = {
    "Hospital e Maternidade Santa Tereza": "Hospital Santa Tereza",
    "MEDSENIOR CAMPINAS": "Clínica MedSênior, Barão de Itapura",
    "Unidade Avançada Nova Campinas Madre Theodora": "Unidade Madre Theodora, Nova Campinas",
    "Nefrocamp Nefrologistas Associados LTDA": "Nefrocamp, Jardim Guanabara",
    "Davita": "DaVita, Jardim Planalto", "DaVita": "DaVita, Parque Taquaral",
    "SAUDE INTEGRADA VIDA": "Saúde Integrada Vida, Centro",
    "GMS-ER SERVCOS MEDICOS S/A": "GMS-ER, Vila João Jorge",
    "CLÍNICA ZECCHIN": "Clínica Zecchin, Centro",
    "SAO PADRE PIO SERVICOS MEDICOS LTDA": "São Padre Pio, Jardim Guanabara",
    "FAHL E GUSSON LTDA": "Fahl e Gusson, Cambuí",
    "Manso Clinica": "Manso Clínica, Vila Itapura",
    "CLÍNICA GERAÇÃO CRESCENTE": "Geração Crescente, Barão Geraldo",
    "Neuron Serviços Medicos e Reabilitação SS LTDA": "Neuron, Nossa Senhora Auxiliadora",
    "CARELLI PERES SERVICOS MEDICOS SOCIEDADE SIMPLES LTDA": "Carelli Peres, Jardim Bela Vista",
    "PEDRO RODRIGUES SERVICOS MEDICOS LTDA": "Consultório próprio, Vila Itapura",
    "CLINICA MEDICA VALBERT DE CASTRO S/S LTDA": "Valbert de Castro, Vila Itapura",
    "Tania Aparecida Martins da Costa Eirelle": "Consultório próprio, Centro",
}
MINUSCULAS = {"de", "da", "do", "dos", "das", "e"}
ACENTOS = {"Girao": "Girão", "Marcal": "Marçal", "Aragao": "Aragão",
           "Goncalves": "Gonçalves", "Fabio": "Fábio", "Tania": "Tânia",
           "Pamela": "Pâmela", "Andre": "André", "Nathalia": "Nathália"}


def titulo(nome):
    saida = []
    for i, p in enumerate(nome.split()):
        b = p.lower()
        if i and b in MINUSCULAS:
            saida.append(b)
        else:
            c = p.capitalize()
            saida.append(ACENTOS.get(c, c))
    return " ".join(saida)


tr = []
for n in comuns:
    b = bene_med[n]
    espb = sorted({o["espec"] for o in b["onde"] if o["espec"] and 3 < len(o["espec"]) < 40})
    esp = ESP_MANUAL.get(n) or (ESP_LIMPA.get(espb[0], espb[0]) if espb else "Clínica médica")
    locais = sorted({p for e, prs in d["rede_med"].items() for p, s in prs.items() if n in s})
    loc = LOCAL_LIMPO.get(locais[0], titulo(locais[0])) if locais else ""
    tr.append(f'<tr><td class="nome">{html.escape(titulo(b["nome"]))}</td>'
              f'<td>{html.escape(esp)}</td><td class="onde">{html.escape(loc)}</td></tr>')

CLINICAS = [
    ("J.M Rezende", "Otorrinolaringologia", "Rua Barreto Leme, 1.550, Centro"),
    ("Clínica Valbert de Castro", "Ginecologia", "Av. Francisco Glicério, 2.331, Vila Itapura"),
    ("Clínica Zecchin", "Endocrinologia", "Av. Francisco Glicério, 1.326, Centro"),
    ("Manso Clínica", "Cabeça e pescoço", "Rua Barata Ribeiro, 79, Vila Itapura"),
    ("Carelli Peres", "Cirurgia plástica", "Rua Pero Lopes, 820, Jardim Bela Vista"),
    ("GMS-ER", "Pneumologia", "Rua Vitoriano dos Anjos, 880, Vila João Jorge"),
    ("C P Ortopedia", "Ortopedia", "Rua Orlando Fagnani, 488, Jardim Planalto"),
    ("Consultório da Dra. Tânia Martins", "Cardiologia", "Rua Joaquim Novaes, 223, Centro"),
    ("Denise Coutinho Giesta", "Acupuntura", "Rua Professor Luiz Rosa, 61, Botafogo"),
    ("Clínica Lótus", "Psicologia e nutrição", "Rua Orlando Fagnani, 470, Nova Campinas"),
    ("Saúde Integrada Vida", "Urologia", "Rua Duque de Caxias, 933, Centro"),
    ("Centro de Oncologia Campinas", "Oncologia e radioterapia", "Rua Alberto de Salvo, 311, Barão Geraldo"),
    ("Laboratório Samuel Pessoa", "Exames de sangue", "Av. Andrade Neves, 1.746, Jardim Chapadão"),
]

vals = dict(
    n_st_esp=len(santa_esp), n_st_docs=36, n_st_int=49,
    n_st_conhecidos=len(santa_conhecidos),
    n_comuns=len(comuns), n_clin=len(CLINICAS),
    n_ganha=sum(1 for l in linhas if l["lado"] == "med"),
    n_empata=sum(1 for l in linhas if l["lado"] == "empate"),
    n_perde=sum(1 for l in linhas if l["lado"] == "bene"),
    n_total=len(linhas),
    chips="\n".join(f'<span class="chip">{html.escape(ROTULO_ST.get(e, e))}</span>'
                    for e in sorted(santa_esp, key=lambda x: ROTULO_ST.get(x, x))),
    conhecidos="\n".join(
        f'<li>{html.escape(titulo(bene_med[n]["nome"]))}'
        f'<span class="crm">CRM {bene_med[n]["crm"]}</span></li>' for n in santa_conhecidos),
    tabela="\n".join(tr),
    clinicas="\n".join(f'<li><span class="lugar-nome">{html.escape(a)}</span>'
                       f'<span class="lugar-end">{html.escape(b)} &middot; {html.escape(c)}</span></li>'
                       for a, b, c in CLINICAS),
    ganha=grupo("med"), empata=grupo("empate"), perde=grupo("bene"),
)

pag = open(f"{SP}/template.html", encoding="utf-8").read()
for k, v in vals.items():
    pag = pag.replace("__" + k.upper() + "__", str(v))

# ------------------------------------------------------------------ conferencia
# Guilherme nao quer travessao no material: passa por IA. A checagem roda sobre o
# texto que o cliente ve, ja sem CSS, script, tags e expressoes do Jinja.
erros = []
sobrou = sorted(set(re.findall(r"__[A-Z_]+__", pag)))
if sobrou:
    erros.append("placeholder nao substituido: " + str(sobrou[:5]))
visivel = re.sub(r"<style.*?</style>|<script.*?</script>", " ", pag, flags=re.S)
visivel = re.sub(r"\{\{.*?\}\}|\{%.*?%\}", " ", visivel, flags=re.S)
visivel = re.sub(r"<[^>]+>", " ", visivel)
for simbolo, nome in [("—", "travessao"), ("–", "meia risca"), (" - ", "hifen solto")]:
    achados = [m.start() for m in re.finditer(re.escape(simbolo), visivel)]
    if achados:
        trechos = [visivel[max(0, a - 45):a + 45].replace("\n", " ") for a in achados[:4]]
        erros.append(f"{nome} no texto ({len(achados)}x): " + " || ".join(trechos))
if erros:
    print("FALHOU:")
    for e in erros:
        print("  -", e)
    sys.exit(1)

dest = os.path.join(REPO, "templates", "comparativo_medsenior_beneficencia.html")
open(dest, "w", encoding="utf-8").write(pag)
print("OK ->", dest, "|", {k: v for k, v in vals.items() if isinstance(v, int)})
print("tamanho:", len(pag) // 1024, "KB")
