# Assets — Rede Referenciada

Fontes para regerar a página de consulta da rede referenciada. Ver
`../HANDOFF-REDE-REFERENCIADA.md` para o contexto completo e o roteiro de outras operadoras.

| Arquivo | O que é |
|---|---|
| `rede_referenciada.html` | **Página final**, autocontida (dados + logos embutidos). É o que se serve. |
| `template.html` | Template com placeholders `__DATA__`, `__*_B64__`. Edite aqui, não no HTML final. |
| `build.py` | Injeta dados e logos no template → gera `rede_referenciada.html`. |
| `build_data.py` | Converte os JSONs brutos da coleta em `rede_data.json` (registros compactados). |
| `rede_data.json` | Dados dos 2.199 prestadores (SP, Campinas, Rio). |
| `pdfgen_browser.js` | Gerador de PDF em JS puro, sem dependências. Reaproveitável. |
| `serenus-logo-black.png` / `-light.png` | Logo Serenus para tema claro / escuro (tela). |
| `serenus-logo.jpg` / `sula-logo.jpg` | Versões JPEG dos logos, usadas dentro do PDF (`/DCTDecode`). |

## Regerar

```bash
python3 build.py
```

Depois valide o JS antes de publicar:

```bash
python3 -c "import re;print(re.findall(r'<script>(.*?)</script>',open('rede_referenciada.html').read(),re.S)[-1])" > /tmp/x.js && node --check /tmp/x.js
```
