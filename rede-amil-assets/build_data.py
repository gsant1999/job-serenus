# -*- coding: utf-8 -*-
"""
Gera rede_amil_data.json a partir de amil_campinas_raw.tsv, coletado direto da
API publica da Amil (RedeCredenciadaCredenciado) para o plano Bronze SP Mais
(codigoRede 1077), cidade de Campinas.

Fonte: portal oficial da Amil (busca avancada da rede credenciada),
https://www.amil.com.br/institucional/#/servicos/saude/rede-credenciada/amil/busca-avancada
Coleta em 31/10/2025 (ver rede-amil-assets/README.md para o metodo).

Colunas do TSV: nome | tipoServico | especialidade | endereco | bairro | cep | telefones | crm
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

TIPO_LABEL = {
    "CONSULTORIOS - CLINICAS - TERAPIAS": "Consultórios, Clínicas e Terapias",
    "HOSPITAIS PARA INTERNACAO": "Hospitais para Internação",
    "PRONTO-SOCORRO 24H (URGENCIA E EMERGENCIA)": "Pronto-Socorro 24h",
    "HEMODIALISE": "Hemodiálise",
    "TEA": "TEA (Transtorno do Espectro Autista)",
    "LABORATORIOS E EXAMES": "Laboratórios e Exames",
}


def title_pt(s):
    """Title-case simples preservando siglas curtas comuns."""
    words = s.strip().split()
    out = []
    for w in words:
        wl = w.lower()
        if wl in ("de", "da", "do", "das", "dos", "e"):
            out.append(wl)
        elif len(w) <= 3 and w.isupper() and w.isalpha():
            out.append(w)
        else:
            out.append(w[:1].upper() + w[1:].lower())
    return " ".join(out)


def fones_list(raw):
    parts = [p.strip() for p in raw.split(";") if p.strip()]
    out = []
    for p in parts:
        if "-" in p:
            ddd, num = p.split("-", 1)
            out.append("(" + ddd + ") " + num)
        else:
            out.append(p)
    return out


def main():
    path = os.path.join(REPO, "amil_campinas_raw.tsv")
    with open(path, "r", encoding="utf-8") as f:
        lines = [l.rstrip("\n") for l in f if l.strip()]

    # tipo -> especialidade -> lista de prestadores (dedup por nome+endereco)
    data = {}
    seen = set()
    for line in lines:
        parts = line.split("\t")
        if len(parts) < 7:
            continue
        nome, tipo, esp, end, bairro, cep, fones = parts[:7]
        crm = parts[7] if len(parts) > 7 else ""
        key = (nome, tipo, esp, end)
        if key in seen:
            continue
        seen.add(key)
        data.setdefault(tipo, {}).setdefault(esp, []).append({
            "n": title_pt(nome),
            "e": title_pt(end) + (", " + title_pt(bairro) if bairro else "") + (" - CEP " + cep if cep else ""),
            "f": fones_list(fones),
            "crm": crm.strip() or None,
        })

    # ordena prestadores por nome dentro de cada especialidade
    for tipo in data:
        for esp in data[tipo]:
            data[tipo][esp].sort(key=lambda p: p["n"])

    out = {
        "plano": "Bronze SP Mais",
        "cidade": "Campinas",
        "atualizado_em": "10/2025",
        "fonte": "Portal oficial Amil - busca avançada da rede credenciada",
        "tipos": [],
    }
    for tipo_key in TIPO_LABEL:
        if tipo_key not in data:
            continue
        esps = data[tipo_key]
        out["tipos"].append({
            "chave": tipo_key,
            "label": TIPO_LABEL[tipo_key],
            "especialidades": [
                {"nome": title_pt(esp), "prestadores": preds}
                for esp, preds in sorted(esps.items())
            ],
        })

    dest = os.path.join(HERE, "rede_amil_data.json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    total = sum(len(p["prestadores"]) for t in out["tipos"] for p in t["especialidades"])
    print("OK ->", dest)
    for t in out["tipos"]:
        n = sum(len(p["prestadores"]) for p in t["especialidades"])
        print(" ", t["label"], ":", n, "registros em", len(t["especialidades"]), "especialidades")
    print("Total (com duplicatas entre especialidades):", total)


if __name__ == "__main__":
    main()
