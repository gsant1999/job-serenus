#!/usr/bin/env python3
"""Extrai todos os fluxos do BotConversa (workspace 206993, bot 192727) via a
API interna que o próprio app usa (a mesma que o navegador chama quando você
abre um fluxo no construtor), e empacota tudo — textos, imagens, vídeos,
áudios, PDFs — num .zip pronto pra subir no JOB.

Uso:
    pip install playwright requests
    playwright install chromium
    python3 scripts/botconversa_extract.py

O script abre uma janela de navegador de verdade. Faça login no BotConversa
nela como sempre faz (usuário e senha, na tela do próprio BotConversa) — o
script espera você terminar e continua sozinho a partir daí, reaproveitando
a sessão que você acabou de abrir pra chamar a API. Ele nunca vê nem grava
sua senha.

Saída: scripts/botconversa_export.zip — suba esse arquivo em
Modelos > Importar fluxos do BotConversa dentro do JOB.
"""
import json
import os
import time
import zipfile
from pathlib import Path
from urllib.parse import urlparse

import requests
from playwright.sync_api import sync_playwright

BOT_ID = 192727
WORKSPACE_ID = 206993
API_BASE = "https://backend.botconversa.com.br/api/v1"
LOGIN_URL = f"https://app.botconversa.com.br/{WORKSPACE_ID}/login"

SCRIPT_DIR = Path(__file__).parent
OUT_DIR = SCRIPT_DIR / "botconversa_export_tmp"
ZIP_PATH = SCRIPT_DIR / "botconversa_export.zip"

# Nome do campo dentro de cada tipo de sub-bloco de mídia que carrega a URL
# real do arquivo (varia por tipo: image_send_message_sub_block.image,
# video_..._sub_block.video, etc.) — em vez de fixar o nome, pegamos o
# primeiro valor que parece uma URL, o que também protege contra pequenas
# variações que a gente não viu em todos os tipos durante a investigação.
TIPO_MIDIA_SUBBLOCO = {
    "image_send_message_sub_block": "imagem",
    "video_send_message_sub_block": "video",
    "audio_send_message_sub_block": "audio",
    "file_send_message_sub_block": "documento",
}


def esperar_login(page):
    print("\n>>> Faça login no BotConversa na janela que abriu, do jeito que você sempre faz.")
    print(">>> Assim que o painel carregar, o script continua sozinho...\n")
    while True:
        token = page.evaluate("() => localStorage.getItem('authToken')")
        if token:
            return token
        time.sleep(1.5)


def listar_flows(sess):
    r = sess.get(f"{API_BASE}/flows/bot/short/{BOT_ID}/")
    r.raise_for_status()
    return r.json()


def listar_folders(sess):
    r = sess.get(f"{API_BASE}/folders/bot/{BOT_ID}/?page=0")
    r.raise_for_status()
    return r.json()


def blocos_do_flow(sess, flow_id):
    r = sess.get(f"{API_BASE}/blocks/flow/{flow_id}/?bot_id={BOT_ID}")
    r.raise_for_status()
    return r.json()


def _url_do_subbloco(dados):
    for v in dados.values():
        if isinstance(v, str) and v.startswith("http"):
            return v
    return None


def extrair_passos(flow_json):
    """Segue a cadeia block_to a partir do bloco inicial (type=5) e devolve
    a sequência ordenada de passos (texto ou mídia) da conversa. Fluxos
    ramificados (menu/condição) não foram vistos na amostragem — se
    aparecerem, essa função simplesmente segue o primeiro block_to que achar
    e ignora ramos alternativos, então revise manualmente esses casos."""
    blocks_by_id = {b["id"]: b for b in flow_json.get("blocks", [])}
    inicial = next((b for b in flow_json.get("blocks", []) if b.get("type") == 5), None)
    if not inicial:
        return []
    passos = []
    atual_id = inicial.get("block_to")
    visitados = set()
    while atual_id and atual_id not in visitados:
        visitados.add(atual_id)
        bloco = blocks_by_id.get(atual_id)
        if not bloco:
            break
        smb = bloco.get("send_message_block")
        if smb:
            subs = sorted(smb.get("send_message_sub_block") or [], key=lambda s: s.get("position") or 0)
            for sub in subs:
                txt_sub = sub.get("text_send_message_sub_block")
                if txt_sub:
                    texto = (txt_sub.get("text") or "").strip()
                    if texto:
                        passos.append({"tipo": "texto", "texto": texto})
                    continue
                for chave, tipo in TIPO_MIDIA_SUBBLOCO.items():
                    dados = sub.get(chave)
                    if dados:
                        url = _url_do_subbloco(dados)
                        nome_original = dados.get("file_name")
                        if url:
                            passos.append({"tipo": tipo, "url": url, "nome_original": nome_original})
                        break
        atual_id = bloco.get("block_to")
    return passos


def baixar_midia(url, destino):
    if destino.exists():
        return True
    try:
        r = requests.get(url, timeout=30)
        r.raise_for_status()
        destino.write_bytes(r.content)
        return True
    except Exception as e:
        print(f"    falhou ao baixar mídia ({url}): {e}")
        return False


def main():
    OUT_DIR.mkdir(exist_ok=True)
    media_dir = OUT_DIR / "media"
    media_dir.mkdir(exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        page = browser.new_page()
        page.goto(LOGIN_URL)
        token = esperar_login(page)
        browser.close()

    print("Login confirmado. Buscando lista de fluxos...")
    sess = requests.Session()
    sess.headers["Authorization"] = f"Bearer {token}"
    sess.headers["Accept"] = "application/json"

    flows = listar_flows(sess)
    folders = listar_folders(sess)
    folder_nome = {fo["id"]: fo["name"] for fo in folders}

    print(f"{len(flows)} fluxos encontrados. Extraindo um por um...\n")

    manifesto = []
    total = len(flows)
    for i, fl in enumerate(flows, 1):
        flow_id, nome = fl["id"], fl["name"]
        print(f"[{i}/{total}] {nome} (id={flow_id})")
        try:
            detalhe = blocos_do_flow(sess, flow_id)
        except Exception as e:
            print(f"    falhou ao buscar o fluxo: {e}")
            continue

        categoria = folder_nome.get(detalhe.get("folder"))
        passos = extrair_passos(detalhe)

        passos_finais = []
        for j, passo in enumerate(passos):
            if passo["tipo"] == "texto":
                passos_finais.append(passo)
                continue
            url = passo["url"]
            sufixo = Path(urlparse(url).path).suffix or ".bin"
            nome_arq_local = f"{flow_id}_{j}{sufixo}"
            if baixar_midia(url, media_dir / nome_arq_local):
                passos_finais.append({
                    "tipo": passo["tipo"],
                    "arquivo_local": nome_arq_local,
                    "nome_original": passo.get("nome_original"),
                })

        manifesto.append({
            "flow_id": flow_id,
            "nome": nome,
            "categoria": categoria,
            "passos": passos_finais,
        })
        time.sleep(0.3)  # não martelar a API do BotConversa

    (OUT_DIR / "manifest.json").write_text(
        json.dumps(manifesto, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(OUT_DIR / "manifest.json", "manifest.json")
        for arq in media_dir.iterdir():
            zf.write(arq, f"media/{arq.name}")

    total_midias = sum(1 for f in manifesto for p in f["passos"] if p["tipo"] != "texto")
    total_textos = sum(1 for f in manifesto for p in f["passos"] if p["tipo"] == "texto")
    print(f"\nPronto! {len(manifesto)} fluxos extraídos ({total_textos} textos, {total_midias} mídias).")
    print(f"Zip gerado em: {ZIP_PATH}")
    print("Agora vá em Modelos (WhatsApp) > \"Importar fluxos do BotConversa\" no JOB e suba esse arquivo.")


if __name__ == "__main__":
    main()
