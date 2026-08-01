# -*- coding: utf-8 -*-
"""
Gera rede_beneficencia_data.json a partir de bene_raw.tsv, coletado direto
do portal do Guia Medico da Saude Beneficencia (JSP + sessao, sem API
publica), para os planos Vital IF 400 Standard, Agile Access IF 500,
Sabe IF 200 Standard e Selection IF 200 Standard.

Fonte: https://portal.saudebeneficencia.com.br/PlanodeSaude/pls_paginaGuiaMedico.jsp
Coleta em 31/07/2026.

Colunas bene_raw.tsv (9): nome | crm | razaoSocial | especialidade | endereco | telefone | tipoPrestador | cidade | plano
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)

PLANOS_ORDEM = ["Vital IF 400 Standard", "Agile Access IF 500", "Sabe IF 200 Standard", "Selection IF 200 Standard"]
CIDADES_ORDEM = ["Campinas", "Valinhos", "Hortolândia"]


def title_pt(s):
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


def main():
    path = os.path.join(REPO, "bene_raw.tsv")
    with open(path, "r", encoding="utf-8") as f:
        lines = [l.rstrip("\n") for l in f if l.strip()]

    # plano -> cidade -> tipo -> especialidade -> lista de prestadores (dedup)
    data = {}
    seen = set()
    for line in lines:
        parts = line.split("\t")
        if len(parts) < 9:
            continue
        nome, crm, razao, esp, end, fone, tipo, cidade, plano = parts[:9]
        esp = esp.strip() or "Não especificado"
        tipo = tipo.strip() or "Outros"
        key = (plano, cidade, nome, crm, end)
        if key in seen:
            continue
        seen.add(key)
        data.setdefault(plano, {}).setdefault(cidade, {}).setdefault(tipo, {}).setdefault(esp, []).append({
            "n": title_pt(nome),
            "crm": crm.strip() or None,
            "razao": title_pt(razao) if razao.strip() else None,
            "e": end.strip() or None,
            "f": [fone.strip()] if fone.strip() else [],
        })

    for plano in data:
        for cidade in data[plano]:
            for tipo in data[plano][cidade]:
                for esp in data[plano][cidade][tipo]:
                    data[plano][cidade][tipo][esp].sort(key=lambda p: p["n"])

    out = {
        "atualizado_em": "07/2026",
        "fonte": "Portal oficial Saúde Beneficência - Guia médico",
        "planos": [],
    }

    planos_presentes = [p for p in PLANOS_ORDEM if p in data]
    for p in data:
        if p not in planos_presentes:
            planos_presentes.append(p)

    for plano in planos_presentes:
        cidades_plano = data.get(plano, {})
        cidades_presentes = [c for c in CIDADES_ORDEM if c in cidades_plano]
        for c in cidades_plano:
            if c not in cidades_presentes:
                cidades_presentes.append(c)

        plano_out = {"nome": plano, "cidades": []}
        for cidade in cidades_presentes:
            tipos_cidade = cidades_plano.get(cidade, {})
            cidade_out = {"nome": cidade, "tipos": []}
            for tipo_key in sorted(tipos_cidade.keys()):
                esps = tipos_cidade[tipo_key]
                cidade_out["tipos"].append({
                    "chave": tipo_key,
                    "label": tipo_key,
                    "especialidades": [
                        {"nome": esp, "prestadores": preds}
                        for esp, preds in sorted(esps.items())
                    ],
                })
            plano_out["cidades"].append(cidade_out)
        out["planos"].append(plano_out)

    dest = os.path.join(HERE, "rede_beneficencia_data.json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print("OK ->", dest)
    total_geral = 0
    for plano_out in out["planos"]:
        total_plano = 0
        print(plano_out["nome"] + ":")
        for cidade_out in plano_out["cidades"]:
            total_cidade = sum(len(p["prestadores"]) for t in cidade_out["tipos"] for p in t["especialidades"])
            total_plano += total_cidade
            print("  ", cidade_out["nome"], ":", total_cidade, "registros")
        total_geral += total_plano
        print("  Subtotal:", total_plano)
    print("Total geral (com duplicatas entre especialidades):", total_geral)


if __name__ == "__main__":
    main()
