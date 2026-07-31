# -*- coding: utf-8 -*-
"""
Gera rede_amil_data.json a partir de amil_campinas_raw.tsv (Campinas) e
amil_expansao_raw.tsv (Valinhos, Hortolandia, Indaiatuba), coletados direto
da API publica da Amil (RedeCredenciadaCredenciado) para o plano
Bronze SP Mais (codigoRede 1077).

Fonte: portal oficial da Amil (busca avancada da rede credenciada),
https://www.amil.com.br/institucional/#/servicos/saude/rede-credenciada/amil/busca-avancada
Coleta em 31/10/2025 (Campinas) e 31/07/2026 (Valinhos/Hortolandia/Indaiatuba).

Colunas amil_campinas_raw.tsv (8): nome | tipoServico | especialidade | endereco | bairro | cep | telefones | crm
Colunas amil_expansao_raw.tsv (9): nome | tipoServico | especialidade | cidade | endereco | bairro | cep | telefones | crm
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

CIDADES_ORDEM = ["Campinas", "Valinhos", "Hortolândia", "Indaiatuba"]

CIDADE_FIX = {
    "Hortolandia": "Hortolândia",
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


def ler_linhas(nome_arquivo, cidade_fixa):
    """Le um TSV e retorna lista de (nome, tipo, esp, cidade, end, bairro, cep, fones, crm)."""
    path = os.path.join(REPO, nome_arquivo)
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        lines = [l.rstrip("\n") for l in f if l.strip()]
    out = []
    for line in lines:
        parts = line.split("\t")
        if cidade_fixa:
            # formato de 8 colunas, sem cidade (arquivo Campinas legado)
            if len(parts) < 7:
                continue
            nome, tipo, esp, end, bairro, cep, fones = parts[:7]
            crm = parts[7] if len(parts) > 7 else ""
            cidade = cidade_fixa
        else:
            # formato de 9 colunas, com cidade
            if len(parts) < 8:
                continue
            nome, tipo, esp, cidade, end, bairro, cep, fones = parts[:8]
            crm = parts[8] if len(parts) > 8 else ""
            cidade = title_pt(cidade)
            cidade = CIDADE_FIX.get(cidade, cidade)
        out.append((nome, tipo, esp, cidade, end, bairro, cep, fones, crm))
    return out


def main():
    linhas = ler_linhas("amil_campinas_raw.tsv", cidade_fixa="Campinas")
    linhas += ler_linhas("amil_expansao_raw.tsv", cidade_fixa=None)

    # cidade -> tipo -> especialidade -> lista de prestadores (dedup por nome+endereco)
    data = {}
    seen = set()
    for nome, tipo, esp, cidade, end, bairro, cep, fones, crm in linhas:
        key = (cidade, nome, tipo, esp, end)
        if key in seen:
            continue
        seen.add(key)
        data.setdefault(cidade, {}).setdefault(tipo, {}).setdefault(esp, []).append({
            "n": title_pt(nome),
            "e": title_pt(end) + (", " + title_pt(bairro) if bairro else "") + (" - CEP " + cep if cep else ""),
            "f": fones_list(fones),
            "crm": crm.strip() or None,
        })

    for cidade in data:
        for tipo in data[cidade]:
            for esp in data[cidade][tipo]:
                data[cidade][tipo][esp].sort(key=lambda p: p["n"])

    out = {
        "plano": "Bronze SP Mais",
        "atualizado_em": "07/2026",
        "fonte": "Portal oficial Amil - busca avançada da rede credenciada",
        "cidades": [],
    }

    cidades_presentes = [c for c in CIDADES_ORDEM if c in data]
    for c in data:
        if c not in cidades_presentes:
            cidades_presentes.append(c)

    for cidade in cidades_presentes:
        tipos_cidade = data.get(cidade, {})
        cidade_out = {"nome": cidade, "tipos": []}
        for tipo_key in TIPO_LABEL:
            if tipo_key not in tipos_cidade:
                continue
            esps = tipos_cidade[tipo_key]
            cidade_out["tipos"].append({
                "chave": tipo_key,
                "label": TIPO_LABEL[tipo_key],
                "especialidades": [
                    {"nome": title_pt(esp), "prestadores": preds}
                    for esp, preds in sorted(esps.items())
                ],
            })
        out["cidades"].append(cidade_out)

    dest = os.path.join(HERE, "rede_amil_data.json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    print("OK ->", dest)
    total_geral = 0
    for cidade_out in out["cidades"]:
        total_cidade = sum(len(p["prestadores"]) for t in cidade_out["tipos"] for p in t["especialidades"])
        total_geral += total_cidade
        print(" ", cidade_out["nome"], ":", total_cidade, "registros")
        for t in cidade_out["tipos"]:
            n = sum(len(p["prestadores"]) for p in t["especialidades"])
            print("   -", t["label"], ":", n, "registros em", len(t["especialidades"]), "especialidades")
    print("Total geral (com duplicatas entre especialidades):", total_geral)


if __name__ == "__main__":
    main()
