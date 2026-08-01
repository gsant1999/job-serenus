# -*- coding: utf-8 -*-
"""
Gera rede_amil_data.json a partir dos TSVs coletados direto da API publica
da Amil (RedeCredenciadaCredenciado), para os planos:
  - Bronze SP Mais (amil_campinas_raw.tsv + amil_expansao_raw.tsv)
  - Prata QC, Ouro QC, S750 QP (amil_multiplanos_raw.tsv)

Fonte: portal oficial da Amil (busca avancada da rede credenciada),
https://www.amil.com.br/institucional/#/servicos/saude/rede-credenciada/amil/busca-avancada

Colunas amil_campinas_raw.tsv (8, sem plano/cidade): nome | tipoServico | especialidade | endereco | bairro | cep | telefones | crm
Colunas amil_expansao_raw.tsv (9, sem plano): nome | tipoServico | especialidade | cidade | endereco | bairro | cep | telefones | crm
Colunas amil_multiplanos_raw.tsv (10): nome | tipoServico | especialidade | cidade | plano | endereco | bairro | cep | telefones | crm
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
PLANOS_ORDEM = ["Bronze SP Mais", "Prata QC", "Ouro QC", "S750 QP"]

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


def ler_linhas(nome_arquivo, plano_fixo, cidade_fixa):
    """Le um TSV e retorna lista de (nome, tipo, esp, cidade, plano, end, bairro, cep, fones, crm)."""
    path = os.path.join(REPO, nome_arquivo)
    if not os.path.exists(path):
        return []
    with open(path, "r", encoding="utf-8") as f:
        lines = [l.rstrip("\n") for l in f if l.strip()]
    out = []
    for line in lines:
        parts = line.split("\t")
        if plano_fixo and cidade_fixa:
            # formato de 8 colunas (Campinas legado): sem cidade, sem plano
            if len(parts) < 7:
                continue
            nome, tipo, esp, end, bairro, cep, fones = parts[:7]
            crm = parts[7] if len(parts) > 7 else ""
            cidade = cidade_fixa
            plano = plano_fixo
        elif plano_fixo:
            # formato de 9 colunas (expansao Bronze SP Mais): com cidade, sem plano
            if len(parts) < 8:
                continue
            nome, tipo, esp, cidade, end, bairro, cep, fones = parts[:8]
            crm = parts[8] if len(parts) > 8 else ""
            cidade = title_pt(cidade)
            cidade = CIDADE_FIX.get(cidade, cidade)
            plano = plano_fixo
        else:
            # formato de 10 colunas (multiplanos): com cidade e plano
            if len(parts) < 9:
                continue
            nome, tipo, esp, cidade, plano, end, bairro, cep, fones = parts[:9]
            crm = parts[9] if len(parts) > 9 else ""
            cidade = title_pt(cidade)
            cidade = CIDADE_FIX.get(cidade, cidade)
        out.append((nome, tipo, esp, cidade, plano, end, bairro, cep, fones, crm))
    return out


def main():
    linhas = ler_linhas("amil_campinas_raw.tsv", plano_fixo="Bronze SP Mais", cidade_fixa="Campinas")
    linhas += ler_linhas("amil_expansao_raw.tsv", plano_fixo="Bronze SP Mais", cidade_fixa=None)
    linhas += ler_linhas("amil_multiplanos_raw.tsv", plano_fixo=None, cidade_fixa=None)

    # plano -> cidade -> tipo -> especialidade -> lista de prestadores (dedup por nome+endereco)
    data = {}
    seen = set()
    for nome, tipo, esp, cidade, plano, end, bairro, cep, fones, crm in linhas:
        key = (plano, cidade, nome, tipo, esp, end)
        if key in seen:
            continue
        seen.add(key)
        data.setdefault(plano, {}).setdefault(cidade, {}).setdefault(tipo, {}).setdefault(esp, []).append({
            "n": title_pt(nome),
            "e": title_pt(end) + (", " + title_pt(bairro) if bairro else "") + (" - CEP " + cep if cep else ""),
            "f": fones_list(fones),
            "crm": crm.strip() or None,
        })

    for plano in data:
        for cidade in data[plano]:
            for tipo in data[plano][cidade]:
                for esp in data[plano][cidade][tipo]:
                    data[plano][cidade][tipo][esp].sort(key=lambda p: p["n"])

    out = {
        "atualizado_em": "07/2026",
        "fonte": "Portal oficial Amil - busca avançada da rede credenciada",
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
            plano_out["cidades"].append(cidade_out)
        out["planos"].append(plano_out)

    dest = os.path.join(HERE, "rede_amil_data.json")
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
