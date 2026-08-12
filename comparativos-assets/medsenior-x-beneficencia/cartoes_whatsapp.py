# -*- coding: utf-8 -*-
"""Gera os cartoes de WhatsApp do comparativo (1080x1350, formato 4:5).

Nao sao recortes da pagina: sao pecas desenhadas para a tela do celular, com
tipografia grande. Os numeros saem de linhas.json, o mesmo arquivo que alimenta
a pagina, para os dois nunca discordarem.

Uso:  python3 cartoes_whatsapp.py
Saida: whatsapp/01-capa.png ... e whatsapp/resumo.txt
"""
import base64
import json
import os
import subprocess
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
SAIDA = os.path.join(HERE, "whatsapp")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

linhas = {l["esp"]: l for l in json.load(open(f"{HERE}/linhas.json", encoding="utf-8"))}
dados = json.load(open(f"{HERE}/dados.json", encoding="utf-8"))

N_GANHA = sum(1 for l in linhas.values() if l["lado"] == "med")
N_TOTAL = len(linhas)
todos_med = set()
for e, prs in dados["rede_med"].items():
    for p, s in prs.items():
        todos_med |= set(s)
N_COMUNS = len(todos_med & set(dados["bene_med"]))


def b64(caminho, mime):
    return f"data:{mime};base64," + base64.b64encode(open(caminho, "rb").read()).decode()


LOGO_SERENUS = b64(f"{REPO}/static/brand/serenus-logo-black-640.png", "image/png")
LOGO_BENE = b64(f"{REPO}/static/operadoras/saude-beneficencia.png", "image/png")
LOGO_MED = b64(f"{REPO}/static/operadoras/medsenior.svg", "image/svg+xml")

BASE = """<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>
  :root{
    --papel:#FBFAF6; --branco:#fff; --tinta:#182019; --tinta-2:#48544B; --tinta-3:#6B776E;
    --linha:#DAD5C7; --bene:#B03A34; --bene-fundo:#FAEEEC; --bene-linha:#E7C7C3;
    --med:#0D6B38; --med-fundo:#EAF3EC; --med-linha:#B5D4BE; --med-barra:#2E8C4E; --lima:#95BF3C;
    --display:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
    --corpo:"Seravek","Gill Sans Nova",Avenir,"Lucida Grande",system-ui,sans-serif;
  }
  *{box-sizing:border-box;margin:0;padding:0;}
  body{width:1080px;height:1350px;background:var(--papel);color:var(--tinta);
       font-family:var(--corpo);overflow:hidden;}
  .cartao{width:100%;height:100%;padding:72px 68px;display:flex;flex-direction:column;}
  .topo{margin-bottom:56px;}
  .selo{font-size:23px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;
        color:var(--tinta-3);}
  h1{font-family:var(--display);font-size:82px;line-height:1.08;font-weight:600;
     letter-spacing:-.015em;margin-bottom:34px;}
  h1.menor{font-size:66px;}
  .lead{font-size:36px;line-height:1.42;color:var(--tinta-2);}
  .corpo{flex:1;display:flex;flex-direction:column;justify-content:center;}
  .rodape{display:flex;align-items:center;justify-content:space-between;
          border-top:2px solid var(--linha);padding-top:26px;margin-top:auto;}
  .rodape span{font-size:23px;color:var(--tinta-3);line-height:1.4;}
  .rodape img{height:44px;}
  b.verde{color:var(--med);} b.vermelho{color:var(--bene);}
</style></head><body><div class="cartao">__CONTEUDO__</div></body></html>"""

RODAPE = """<div class="rodape">
  <span>Rede apurada nos guias médicos oficiais<br>das duas operadoras, em 12/08/2026</span>
  <img src="%s" alt="">
</div>""" % LOGO_SERENUS


def duelo_num(rotulo_a, valor_a, rotulo_b, valor_b, legenda_a="", legenda_b=""):
    return f"""
<div style="display:grid;grid-template-columns:1fr 1fr;gap:34px;margin-bottom:44px;">
  <div style="background:var(--bene-fundo);border:3px solid var(--bene-linha);border-radius:20px;padding:44px 40px;">
    <div style="font-size:24px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--bene);margin-bottom:18px;">{rotulo_a}</div>
    <div style="font-family:var(--display);font-size:132px;line-height:1;font-weight:600;color:var(--bene);">{valor_a}</div>
    <div style="font-size:30px;line-height:1.35;color:var(--tinta-2);margin-top:16px;">{legenda_a}</div>
  </div>
  <div style="background:var(--med-fundo);border:3px solid var(--med-linha);border-radius:20px;padding:44px 40px;">
    <div style="font-size:24px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--med);margin-bottom:18px;">{rotulo_b}</div>
    <div style="font-family:var(--display);font-size:132px;line-height:1;font-weight:600;color:var(--med);">{valor_b}</div>
    <div style="font-size:30px;line-height:1.35;color:var(--tinta-2);margin-top:16px;">{legenda_b}</div>
  </div>
</div>"""


def barra_esp(nome, bene_txt, bene_pct, med_txt, med_pct):
    return f"""
<div style="margin-bottom:38px;">
  <div style="font-size:36px;font-weight:600;margin-bottom:18px;">{nome}</div>
  <div style="display:flex;align-items:center;gap:22px;margin-bottom:12px;">
    <span style="width:210px;font-size:26px;font-weight:700;color:var(--bene);">Beneficência</span>
    <span style="flex:1;height:34px;background:#fff;border:2px solid var(--linha);border-radius:6px;overflow:hidden;">
      <span style="display:block;height:100%;width:{bene_pct}%;background:var(--bene);"></span></span>
    <span style="width:300px;font-size:27px;color:var(--tinta-2);">{bene_txt}</span>
  </div>
  <div style="display:flex;align-items:center;gap:22px;">
    <span style="width:210px;font-size:26px;font-weight:700;color:var(--med);">MedSênior</span>
    <span style="flex:1;height:34px;background:#fff;border:2px solid var(--linha);border-radius:6px;overflow:hidden;">
      <span style="display:block;height:100%;width:{med_pct}%;background:var(--med-barra);"></span></span>
    <span style="width:300px;font-size:27px;color:var(--tinta-2);">{med_txt}</span>
  </div>
</div>"""


CARTOES = {}

# 1 ------------------------------------------------------------------ capa
CARTOES["01-capa"] = f"""
<div class="topo"><span class="selo">Campinas</span></div>
<div class="corpo">
  <h1>Pelo mesmo valor,<br>uma rede montada<br>para quem já passou<br>dos 59.</h1>
  <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:44px;
              border:3px solid var(--linha);border-radius:20px;padding:48px 44px;background:#fff;">
    <div style="text-align:center;">
      <img src="{LOGO_BENE}" style="height:84px;margin-bottom:22px;" alt="">
      <div style="font-size:26px;color:var(--tinta-3);">o plano de hoje</div>
    </div>
    <div style="font-family:var(--display);font-size:52px;color:var(--tinta-3);">x</div>
    <div style="text-align:center;">
      <img src="{LOGO_MED}" style="height:110px;margin-bottom:6px;" alt="">
      <div style="font-size:26px;color:var(--med);font-weight:700;">a proposta</div>
    </div>
  </div>
</div>
{RODAPE}"""

# 2 ------------------------------------------------------------------ placar
CARTOES["02-placar"] = f"""
<div class="topo"><span class="selo">O comparativo</span></div>
<div class="corpo">
  <h1 class="menor">Comparamos as duas<br>redes especialidade<br>por especialidade.</h1>
  <div style="background:var(--med);border-radius:20px;padding:60px 52px;margin:14px 0 40px;">
    <div style="font-family:var(--display);font-size:190px;line-height:1;font-weight:600;color:#fff;">{N_GANHA}</div>
    <div style="font-size:40px;line-height:1.3;color:#fff;margin-top:18px;">
      das {N_TOTAL} especialidades têm<br><b>mais opção na MedSênior</b>
    </div>
  </div>
  <p class="lead">E o ganho está onde a saúde mais pede atenção depois dos 60:
     coração, hormônios, pulmão, rim, reumatismo e oncologia.</p>
</div>
{RODAPE}"""

# 3 ------------------------------------------------------------------ coracao
_card = linhas["Cardiologia"]
CARTOES["03-coracao"] = f"""
<div class="topo"><span class="selo">Cardiologia</span></div>
<div class="corpo">
  <h1 class="menor">O Hospital do Coração<br>entra para a sua rede.</h1>
  <p class="lead" style="margin-bottom:44px;">Referência em coração em Campinas, na Av. Benjamin
     Constant. Ele <b class="verde">não existe</b> no plano de hoje.</p>
  {duelo_num("Beneficência", _card["bd"], "MedSênior", _card["md"],
             "cardiologistas em 2 lugares", "cardiologistas em 7 lugares")}
  <p class="lead">Mais o corpo clínico do Hospital Santa Tereza, onde ficam as consultas
     e o pronto-socorro.</p>
</div>
{RODAPE}"""

# 4 ------------------------------------------------------------------ hospitais
CARTOES["04-hospitais"] = f"""
<div class="topo"><span class="selo">Internação e urgência</span></div>
<div class="corpo">
  <h1 class="menor">Cinco hospitais<br>no lugar de um.</h1>
  {duelo_num("Beneficência", 3, "MedSênior", 5,
             "hospitais, e um deles resolve quase tudo", "hospitais, em seis endereços")}
  <div style="background:#fff;border:3px solid var(--med-linha);border-radius:20px;padding:40px 42px;">
    <div style="font-size:26px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;
                color:var(--med);margin-bottom:22px;">Para onde você pode ir</div>
    <div style="font-size:31px;line-height:1.65;color:var(--tinta);">
      Hospital do Coração de Campinas<br>
      Hospital e Maternidade Santa Tereza<br>
      Casa de Saúde Campinas<br>
      Hospital Renascença<br>
      Day Hospital
    </div>
  </div>
</div>
{RODAPE}"""

# 5 ------------------------------------------------------------------ laboratorio
CARTOES["05-laboratorio"] = f"""
<div class="topo"><span class="selo">Exame de sangue</span></div>
<div class="corpo">
  <h1 class="menor">Coleta perto de casa,<br>não só no centro.</h1>
  {duelo_num("Beneficência", 7, "MedSênior", 18,
             "endereços, todos na região central", "endereços, espalhados pela cidade")}
  <div style="background:var(--med-fundo);border:3px solid var(--med-linha);border-radius:20px;padding:40px 42px;">
    <div style="font-size:31px;line-height:1.6;color:var(--tinta-2);">
      Taquaral, Ponte Preta, Barão Geraldo, Santa Cândida, Jardim do Lago,
      Guanabara, Vila Rica, Viracopos, Nova Campinas, Jardim Brasil e mais.
    </div>
  </div>
</div>
{RODAPE}"""

# 6 ------------------------------------------------------------------ geriatria
_ger = linhas["Geriatria"]
CARTOES["06-geriatria"] = f"""
<div class="topo"><span class="selo">Geriatria</span></div>
<div class="corpo">
  <h1 class="menor">Um plano feito<br>para a sua idade.</h1>
  {duelo_num("Beneficência", _ger["bd"], "MedSênior", _ger["md"],
             "geriatra credenciado na cidade", "geriatras, em equipe fixa")}
  <p class="lead">A clínica própria da MedSênior, na Av. Barão de Itapura, tem equipe fixa de
     geriatria, clínica médica, cardiologia e endocrinologia no mesmo prédio. É acompanhamento
     ao longo do tempo, não consulta avulsa.</p>
</div>
{RODAPE}"""

# 7 ------------------------------------------------------------------ medicos
CARTOES["07-medicos"] = f"""
<div class="topo"><span class="selo">Os seus médicos</span></div>
<div class="corpo">
  <h1 class="menor">Você não precisa<br>trocar todo mundo.</h1>
  <div style="background:#fff;border:3px solid var(--med-linha);border-radius:20px;
              padding:56px 48px;margin-bottom:40px;">
    <div style="font-family:var(--display);font-size:172px;line-height:1;font-weight:600;color:var(--med);">{N_COMUNS}</div>
    <div style="font-size:38px;line-height:1.35;color:var(--tinta-2);margin-top:18px;">
      médicos atendem pelos <b>dois planos</b> e continuam com você
    </div>
  </div>
  <p class="lead">Mais 13 clínicas e laboratórios que seguem no mesmo endereço de sempre,
     incluindo o Laboratório Samuel Pessoa e o Centro de Oncologia Campinas.</p>
</div>
{RODAPE}"""


def gerar():
    if os.path.isdir(SAIDA):
        shutil.rmtree(SAIDA)
    os.makedirs(SAIDA)
    for nome, conteudo in CARTOES.items():
        html = BASE.replace("__CONTEUDO__", conteudo)
        caminho_html = os.path.join(SAIDA, nome + ".html")
        open(caminho_html, "w", encoding="utf-8").write(html)
        png = os.path.join(SAIDA, nome + ".png")
        subprocess.run([
            CHROME, "--headless", "--disable-gpu", "--hide-scrollbars",
            "--force-device-scale-factor=1", "--window-size=1080,1350",
            "--screenshot=" + png, "file://" + caminho_html,
        ], check=True, capture_output=True)
        os.remove(caminho_html)
        print("  %-18s %6.0f KB" % (nome + ".png", os.path.getsize(png) / 1024))
    print("\n%d cartões em %s" % (len(CARTOES), SAIDA))


if __name__ == "__main__":
    gerar()
