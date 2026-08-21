#!/usr/bin/env python3
"""Deck do iPad — o servidor que roda no MacBook.

O iPad abre uma pagina no Safari e cada toque vira um comando executado aqui.
Usa so a biblioteca padrao do Python: nao precisa instalar nada.

Para ligar:
    python3 deck-ipad/servidor.py

Os botoes moram em botoes.json — mexer la nao exige mexer aqui.
"""
from __future__ import annotations

import json
import os
import secrets
import shlex
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

RAIZ = Path(__file__).resolve().parent          # deck-ipad/
REPO = RAIZ.parent                              # raiz do repositorio JOB
WEB = RAIZ / "web"
ARQ_CONFIG = RAIZ / "botoes.json"
ARQ_TOKEN = RAIZ / ".token"
ARQ_REGISTRO = RAIZ / "registro.log"
ARQ_FOTO = RAIZ / ".foto.jpg"        # ultima foto da camera; o git ignora

PORTA = int(os.environ.get("DECK_PORTA", "8765"))
LIMITE_SAIDA = 20_000        # caracteres guardados por execucao
TEMPO_MAX_PADRAO = 300       # segundos ate matar um comando pendurado
MAX_ERROS_PIN = 5            # tentativas de pareamento antes de travar


# ---------------------------------------------------------------- utilidades

def agora() -> str:
    return datetime.now().strftime("%H:%M:%S")


def registrar(linha: str) -> None:
    """Toda acao disparada fica no registro. Falha silenciosa e o inimigo."""
    carimbo = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    try:
        with ARQ_REGISTRO.open("a", encoding="utf-8") as f:
            f.write(f"{carimbo}  {linha}\n")
    except OSError:
        pass


def ip_da_rede() -> str:
    """O IP que o iPad enxerga. Nao abre conexao de verdade."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def rede_local(ip: str) -> bool:
    """So aceita comando de aparelho da propria casa/escritorio."""
    if ip in ("127.0.0.1", "::1", "localhost"):
        return True
    partes = ip.split(".")
    if len(partes) != 4 or not all(p.isdigit() for p in partes):
        return False
    a, b = int(partes[0]), int(partes[1])
    return a == 10 or (a == 172 and 16 <= b <= 31) or (a == 192 and b == 168)


def ambiente_do_login() -> dict:
    """O PATH do shell de login, resolvido UMA vez.

    Abrir `zsh -l` a cada toque custava 1,4s por botao — num deck isso e a
    diferenca entre instantaneo e quebrado. Aqui paga-se esse pedagio na
    partida e todo comando depois roda em `zsh -c`, que custa 0,01s.
    """
    ambiente = os.environ.copy()
    try:
        r = subprocess.run(["/bin/zsh", "-lc", "echo $PATH"],
                           capture_output=True, text=True, timeout=15)
        caminho = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""
        if caminho:
            ambiente["PATH"] = caminho
    except (subprocess.SubprocessError, OSError, IndexError):
        pass
    return ambiente


AMBIENTE = ambiente_do_login()
# Onde o deck mora, para os comandos poderem escrever ali sem caminho cravado —
# a pasta do repositório muda de máquina para máquina.
AMBIENTE["DECK_RAIZ"] = str(RAIZ)


def texto_applescript(valor: str) -> str:
    return valor.replace("\\", "\\\\").replace('"', '\\"')


def rodar_osascript(script: str, tempo: int = 20) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["/usr/bin/osascript", "-"],
        input=script, capture_output=True, text=True, timeout=tempo,
    )


# ------------------------------------------------------------ teclas do teclado

MODIFICADORES = {
    "cmd": "command down", "command": "command down", "comando": "command down",
    "shift": "shift down",
    "alt": "option down", "option": "option down", "opt": "option down",
    "ctrl": "control down", "control": "control down", "controle": "control down",
}

CODIGOS = {
    "return": 36, "enter": 76, "tab": 48, "space": 49, "espaco": 49,
    "delete": 51, "backspace": 51, "escape": 53, "esc": 53,
    "left": 123, "esquerda": 123, "right": 124, "direita": 124,
    "down": 125, "baixo": 125, "up": 126, "cima": 126,
    "home": 115, "end": 119, "pageup": 116, "pagedown": 121,
    "f1": 122, "f2": 120, "f3": 99, "f4": 118, "f5": 96, "f6": 97,
    "f7": 98, "f8": 100, "f9": 101, "f10": 109, "f11": 103, "f12": 111,
}


def script_de_teclas(combinacao: str) -> str:
    """'cmd+shift+4' vira o AppleScript que o System Events entende."""
    pecas = [p.strip().lower() for p in combinacao.split("+") if p.strip()]
    if not pecas:
        raise ValueError("Combinação de teclas vazia.")
    mods = [MODIFICADORES[p] for p in pecas[:-1] if p in MODIFICADORES]
    if len(mods) != len(pecas) - 1:
        desconhecidos = [p for p in pecas[:-1] if p not in MODIFICADORES]
        raise ValueError(f"Modificador que não existe: {', '.join(desconhecidos)}")
    tecla = pecas[-1]
    usando = f" using {{{', '.join(mods)}}}" if mods else ""
    if tecla in CODIGOS:
        acao = f"key code {CODIGOS[tecla]}{usando}"
    elif len(tecla) == 1:
        acao = f'keystroke "{texto_applescript(tecla)}"{usando}'
    else:
        raise ValueError(f"Tecla que não existe: {tecla}")
    return f'tell application "System Events" to {acao}'


_CACHE_ACESSO: tuple[float, bool] = (0.0, False)


def acessibilidade_liberada(forcar: bool = False) -> bool:
    """O Mac deixa o deck controlar teclado e janelas? Guardado por 30s."""
    global _CACHE_ACESSO
    quando, valor = _CACHE_ACESSO
    if not forcar and time.time() - quando < 30:
        return valor
    resposta = _perguntar_acessibilidade()
    _CACHE_ACESSO = (time.time(), resposta)
    return resposta


def _perguntar_acessibilidade() -> bool:
    try:
        r = rodar_osascript(
            'tell application "System Events" to return UI elements enabled', tempo=8
        )
        return r.returncode == 0 and r.stdout.strip().lower() == "true"
    except (subprocess.SubprocessError, OSError):
        return False


# --------------------------------------------------------------- configuracao

class Config:
    """botoes.json lido do disco, com os botoes indexados por id."""

    def __init__(self) -> None:
        self.paginas: list[dict] = []
        self.botoes: dict[str, dict] = {}
        self.versao = 0
        self.erro: str | None = None
        self.carregar()

    def carregar(self) -> str | None:
        try:
            dados = json.loads(ARQ_CONFIG.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            self.erro = f"O botoes.json não pôde ser lido: {e}"
            return self.erro

        paginas, botoes = [], {}
        for pagina in dados.get("paginas", []):
            itens = []
            for botao in pagina.get("botoes", []):
                bid = botao.get("id")
                if not bid or bid in botoes:
                    continue
                botoes[bid] = botao
                itens.append(bid)
            paginas.append({
                "id": pagina.get("id", ""),
                "nome": pagina.get("nome", ""),
                "tela": pagina.get("tela", ""),
                "botoes": itens,
            })
        self.paginas, self.botoes, self.erro = paginas, botoes, None
        self.versao += 1
        return None

    def para_o_ipad(self) -> dict:
        """O iPad recebe rotulo e feitio — nunca o comando que sera executado."""
        paginas = []
        for pagina in self.paginas:
            visiveis = []
            for bid in pagina["botoes"]:
                b = self.botoes[bid]
                item = {
                    "id": bid,
                    "rotulo": b.get("rotulo", bid),
                    "dica": b.get("dica", ""),
                    "icone": b.get("icone", "raio"),
                    "controle": b.get("controle", "botao"),
                    "confirmar": b.get("confirmar"),
                    "cuidado": bool(b.get("cuidado")),
                    "precisa_acessibilidade": precisa_acessibilidade(b),
                }
                if item["controle"] == "deslizante":
                    item["minimo"] = b.get("minimo", 0)
                    item["maximo"] = b.get("maximo", 100)
                    item["passo"] = b.get("passo", 5)
                    item["unidade"] = b.get("unidade", "")
                if item["controle"] == "alternar":
                    item["rotulo_ligado"] = b.get("rotulo_ligado", item["rotulo"])
                    item["icone_ligado"] = b.get("icone_ligado", item["icone"])
                visiveis.append(item)
            paginas.append({"id": pagina["id"], "nome": pagina["nome"],
                            "tela": pagina.get("tela", ""), "botoes": visiveis})
        return {"paginas": paginas, "versao": self.versao, "erro": self.erro}


def precisa_acessibilidade(botao: dict) -> bool:
    """Teclas e digitacao so funcionam com a permissao do macOS concedida."""
    def olhar(acao: dict) -> bool:
        tipo = acao.get("tipo")
        if tipo in ("teclas",):
            return True
        if tipo == "texto" and acao.get("colar", True):
            return True
        if tipo == "sequencia":
            return any(olhar(p) for p in acao.get("passos", []))
        return False
    return olhar(botao.get("acao", {}))


# ------------------------------------------------------------------ execucoes

class Execucao:
    """Uma corrida de um botao: o que saiu, quanto durou, se deu certo."""

    contador = 0
    trava = threading.Lock()

    def __init__(self, botao_id: str, rotulo: str) -> None:
        with Execucao.trava:
            Execucao.contador += 1
            self.id = Execucao.contador
        self.botao_id = botao_id
        self.rotulo = rotulo
        self.estado = "rodando"          # rodando | pronto | falhou | cancelado
        self.saida = ""
        self.inicio = time.time()
        self.fim: float | None = None
        self.processo: subprocess.Popen | None = None
        self.cancelado = False

    def escrever(self, texto: str) -> None:
        self.saida = (self.saida + texto)[-LIMITE_SAIDA:]

    def encerrar(self, estado: str) -> None:
        self.estado = estado
        self.fim = time.time()
        registrar(f"{self.botao_id} -> {estado} ({self.duracao():.1f}s)")

    def duracao(self) -> float:
        return (self.fim or time.time()) - self.inicio

    def resumo(self) -> dict:
        return {
            "id": self.id,
            "botao": self.botao_id,
            "rotulo": self.rotulo,
            "estado": self.estado,
            "saida": self.saida,
            "duracao": round(self.duracao(), 1),
        }


EXECUCOES: dict[int, Execucao] = {}
TRAVA_EXEC = threading.Lock()
RODANDO_POR_BOTAO: dict[str, int] = {}


def executar_botao(botao: dict, valor: float | None = None) -> Execucao:
    """Dispara o botao numa thread e devolve a execucao ja em andamento."""
    exe = Execucao(botao.get("id", "?"), botao.get("rotulo", ""))
    with TRAVA_EXEC:
        EXECUCOES[exe.id] = exe
        RODANDO_POR_BOTAO[exe.botao_id] = exe.id
        # nao guarda historico infinito na memoria
        if len(EXECUCOES) > 200:
            for antigo in sorted(EXECUCOES)[:50]:
                EXECUCOES.pop(antigo, None)
    registrar(f"{exe.botao_id} disparado" + (f" valor={valor}" if valor is not None else ""))

    def correr() -> None:
        try:
            ok = rodar_acao(botao.get("acao", {}), exe, valor)
            if exe.cancelado:
                exe.encerrar("cancelado")
            else:
                exe.encerrar("pronto" if ok else "falhou")
        except Exception as e:                       # noqa: BLE001 - vira texto na tela
            exe.escrever(f"\n{type(e).__name__}: {e}\n")
            exe.encerrar("falhou")
        finally:
            with TRAVA_EXEC:
                if RODANDO_POR_BOTAO.get(exe.botao_id) == exe.id:
                    RODANDO_POR_BOTAO.pop(exe.botao_id, None)

    threading.Thread(target=correr, daemon=True).start()
    return exe


def rodar_acao(acao: dict, exe: Execucao, valor: float | None = None) -> bool:
    """Cada tipo de acao sabe se virar. Devolve se deu certo."""
    tipo = acao.get("tipo")

    if tipo == "sequencia":
        for i, passo in enumerate(acao.get("passos", []), 1):
            exe.escrever(f"[passo {i}] {passo.get('tipo', '?')}\n")
            if not rodar_acao(passo, exe, valor):
                exe.escrever("A sequência parou aqui: o passo acima falhou.\n")
                return False
            if exe.cancelado:
                return False
        return True

    if tipo == "shell":
        comando = substituir_valor(acao.get("comando", ""), valor)
        return rodar_processo(["/bin/zsh", "-c", comando], exe, acao)

    if tipo == "applescript":
        script = substituir_valor(acao.get("script", ""), valor)
        return rodar_processo(["/usr/bin/osascript", "-"], exe, acao, entrada=script)

    if tipo == "abrir":
        alvo = acao.get("alvo", "")
        if alvo.startswith(("http://", "https://")):
            return rodar_processo(["/usr/bin/open", alvo], exe, acao)
        if acao.get("aplicativo", True) and not alvo.startswith("/"):
            return rodar_processo(["/usr/bin/open", "-a", alvo], exe, acao)
        return rodar_processo(["/usr/bin/open", os.path.expanduser(alvo)], exe, acao)

    if tipo == "atalho":
        return rodar_processo(["/usr/bin/shortcuts", "run", acao.get("nome", "")], exe, acao)

    if tipo == "teclas":
        try:
            script = script_de_teclas(acao.get("combinacao", ""))
        except ValueError as e:
            exe.escrever(f"{e}\n")
            return False
        ok = rodar_processo(["/usr/bin/osascript", "-"], exe, acao, entrada=script)
        if not ok and not acessibilidade_liberada():
            exe.escrever(
                "\nO macOS não autorizou o deck a usar o teclado do Mac.\n"
                "Ajustes do Sistema > Privacidade e Segurança > Acessibilidade: "
                "ligue a chave do Terminal e ligue o deck de novo.\n"
            )
        return ok

    if tipo == "texto":
        # O TEXTO PODE MORAR FORA DO REPOSITÓRIO.
        #
        # Chave PIX, assinatura e endereço são dados do dono, não do projeto:
        # com `arquivo`, o botão lê de um arquivo local que o git ignora. Assim
        # a chave de recebimento não vai parar num commit — e trocar o texto não
        # exige mexer em código.
        if acao.get("arquivo"):
            caminho = RAIZ / "textos" / str(acao["arquivo"])
            try:
                conteudo = caminho.read_text(encoding="utf-8").strip()
            except OSError:
                exe.escrever(
                    f"Falta o arquivo com o texto ({acao['arquivo']}). "
                    f"Crie ele em deck-ipad/textos/ e toque de novo.\n"
                )
                return False
            if not conteudo:
                exe.escrever(f"O arquivo {acao['arquivo']} está vazio.\n")
                return False
        else:
            conteudo = substituir_valor(acao.get("texto", ""), valor)
        try:
            subprocess.run(["/usr/bin/pbcopy"], input=conteudo.encode("utf-8"), timeout=10)
        except (subprocess.SubprocessError, OSError) as e:
            exe.escrever(f"Não consegui copiar: {e}\n")
            return False
        fim = conteudo[-6:] if len(conteudo) > 6 else conteudo
        exe.escrever(f"Copiado: {len(conteudo)} caracteres, terminando em {fim}\n")
        if acao.get("colar", True):
            script = 'tell application "System Events" to keystroke "v" using {command down}'
            if not rodar_processo(["/usr/bin/osascript", "-"], exe, acao, entrada=script):
                exe.escrever(
                    "Copiei o texto, mas não consegui colar: falta a permissão de "
                    "Acessibilidade no Mac.\n"
                )
                return False
            exe.escrever("Colado no aplicativo que estava na frente do Mac.\n")
        return True

    if tipo == "url":
        return chamar_url(acao, exe)

    exe.escrever(f"Tipo de ação que o deck não conhece: {tipo}\n")
    return False


def substituir_valor(texto: str, valor: float | None) -> str:
    if valor is None:
        return texto
    inteiro = int(round(valor))
    return texto.replace("{valor}", str(inteiro))


def rodar_processo(cmd: list[str], exe: Execucao, acao: dict, entrada: str | None = None) -> bool:
    """Roda e vai jogando a saida na tela do iPad, linha a linha."""
    tempo_max = int(acao.get("tempo_max", TEMPO_MAX_PADRAO))
    try:
        p = subprocess.Popen(
            cmd, cwd=str(REPO), env=AMBIENTE,
            stdin=subprocess.PIPE if entrada else subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            text=True, bufsize=1, start_new_session=True,
        )
    except OSError as e:
        exe.escrever(f"Não consegui rodar: {e}\n")
        return False

    exe.processo = p
    if entrada:
        try:
            p.stdin.write(entrada)
            p.stdin.close()
        except (BrokenPipeError, ValueError):
            pass

    limite = time.time() + tempo_max
    for linha in p.stdout:
        exe.escrever(linha)
        if time.time() > limite:
            exe.escrever(f"\nPassou de {tempo_max}s sem terminar. Encerrei.\n")
            encerrar_processo(p)
            return False
    try:
        p.wait(timeout=max(1, int(limite - time.time())))
    except subprocess.TimeoutExpired:
        exe.escrever(f"\nPassou de {tempo_max}s sem terminar. Encerrei.\n")
        encerrar_processo(p)
        return False
    return p.returncode == 0


def encerrar_processo(p: subprocess.Popen) -> None:
    try:
        os.killpg(os.getpgid(p.pid), 15)
        time.sleep(1.5)
        if p.poll() is None:
            os.killpg(os.getpgid(p.pid), 9)
    except (ProcessLookupError, PermissionError, OSError):
        pass


def chamar_url(acao: dict, exe: Execucao) -> bool:
    endereco = acao.get("endereco", "")
    metodo = acao.get("metodo", "GET").upper()
    corpo = acao.get("corpo")
    dados = json.dumps(corpo).encode("utf-8") if corpo is not None else None
    req = urllib.request.Request(endereco, data=dados, method=metodo)
    for chave, valor in (acao.get("cabecalhos") or {}).items():
        req.add_header(chave, valor)
    if dados:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=int(acao.get("tempo_max", 30))) as r:
            texto = r.read(2000).decode("utf-8", "replace")
            exe.escrever(f"{r.status} {r.reason}\n{texto}\n")
            return 200 <= r.status < 400
    except urllib.error.HTTPError as e:
        exe.escrever(f"{e.code} {e.reason}\n{e.read(1000).decode('utf-8', 'replace')}\n")
        return False
    except (urllib.error.URLError, OSError, ValueError) as e:
        exe.escrever(f"Não consegui falar com o endereço: {e}\n")
        return False


# ------------------------------------------------- estado dos botoes de alternar

CACHE_ESTADOS: dict[str, tuple[float, str]] = {}


def consultar_estado(botao: dict) -> str | None:
    """Roda a consulta do botao de alternar. Cache curto: o iPad pergunta sempre."""
    consulta = botao.get("consulta")
    if not consulta:
        return None
    bid = botao.get("id", "")
    quando, guardado = CACHE_ESTADOS.get(bid, (0.0, ""))
    if time.time() - quando < 2.0:
        return guardado
    try:
        r = subprocess.run(["/bin/zsh", "-c", consulta], cwd=str(REPO), env=AMBIENTE,
                           capture_output=True, text=True, timeout=10)
        valor = r.stdout.strip().splitlines()[-1].strip() if r.stdout.strip() else ""
    except (subprocess.SubprocessError, OSError, IndexError):
        valor = ""
    CACHE_ESTADOS[bid] = (time.time(), valor)
    return valor


def botao_ligado(botao: dict) -> bool:
    valor = (consultar_estado(botao) or "").lower()
    return valor in ("1", "true", "sim", "ligado", "on")


# ------------------------------------------------------------------- servidor

class Pareamento:
    """Um PIN de quatro digitos aparece no Mac; o iPad digita uma vez so."""

    def __init__(self) -> None:
        self.pin = f"{secrets.randbelow(10000):04d}"
        self.erros = 0
        self.token = self.token_guardado()

    @staticmethod
    def token_guardado() -> str:
        if ARQ_TOKEN.exists():
            guardado = ARQ_TOKEN.read_text(encoding="utf-8").strip()
            if guardado:
                return guardado
        novo = secrets.token_urlsafe(24)
        ARQ_TOKEN.write_text(novo, encoding="utf-8")
        os.chmod(ARQ_TOKEN, 0o600)
        return novo

    def conferir(self, pin: str) -> str | None:
        if self.erros >= MAX_ERROS_PIN:
            return None
        if secrets.compare_digest(pin.strip(), self.pin):
            return self.token
        self.erros += 1
        registrar(f"PIN errado ({self.erros}/{MAX_ERROS_PIN})")
        return None


CONFIG = Config()
PAREAMENTO = Pareamento()

TIPOS = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json",
    ".png": "image/png",
}


class Deck(BaseHTTPRequestHandler):
    server_version = "Deck"
    sys_version = ""

    # ---- infraestrutura de resposta

    def responder(self, codigo: int, corpo: bytes, tipo: str) -> None:
        self.send_response(codigo)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(corpo)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def json_ok(self, dados: dict, codigo: int = 200) -> None:
        self.responder(codigo, json.dumps(dados).encode("utf-8"),
                       "application/json; charset=utf-8")

    def log_message(self, *args) -> None:      # silencia o log padrao
        pass

    def autorizado(self) -> bool:
        cabecalho = self.headers.get("Authorization", "")
        enviado = cabecalho[7:] if cabecalho.startswith("Bearer ") else ""
        return bool(enviado) and secrets.compare_digest(enviado, PAREAMENTO.token)

    def corpo_json(self) -> dict:
        try:
            tamanho = int(self.headers.get("Content-Length", "0"))
            if tamanho <= 0 or tamanho > 200_000:
                return {}
            return json.loads(self.rfile.read(tamanho).decode("utf-8"))
        except (ValueError, json.JSONDecodeError):
            return {}

    # ---- rotas

    def do_GET(self) -> None:
        if not rede_local(self.client_address[0]):
            self.responder(403, b"fora da rede local", "text/plain; charset=utf-8")
            return
        caminho = urlparse(self.path).path
        if caminho.startswith("/api/"):
            self.api_get(caminho)
        else:
            self.arquivo(caminho)

    def do_POST(self) -> None:
        if not rede_local(self.client_address[0]):
            self.responder(403, b"fora da rede local", "text/plain; charset=utf-8")
            return
        caminho = urlparse(self.path).path
        corpo = self.corpo_json()

        if caminho == "/api/parear":
            token = PAREAMENTO.conferir(str(corpo.get("pin", "")))
            if token:
                print(f"[{agora()}] iPad pareado ({self.client_address[0]})")
                self.json_ok({"token": token})
            else:
                travado = PAREAMENTO.erros >= MAX_ERROS_PIN
                self.json_ok({"erro": "PIN bloqueado. Desligue e ligue o deck no Mac." if travado
                              else "PIN errado. Ele muda toda vez que o deck é religado no "
                                       "Mac — confira o número na janela agora."}, 403)
            return

        if not self.autorizado():
            self.json_ok({"erro": "nao pareado"}, 401)
            return

        if caminho == "/api/recarregar":
            erro = CONFIG.carregar()
            self.json_ok({"erro": erro, "config": CONFIG.para_o_ipad()})
            return

        if caminho.startswith("/api/acao/"):
            self.disparar(caminho.rsplit("/", 1)[-1], corpo)
            return

        if caminho.startswith("/api/cancelar/"):
            try:
                exe = EXECUCOES.get(int(caminho.rsplit("/", 1)[-1]))
            except ValueError:
                exe = None
            if exe and exe.processo and exe.estado == "rodando":
                exe.cancelado = True
                encerrar_processo(exe.processo)
                self.json_ok({"ok": True})
            else:
                self.json_ok({"erro": "Essa ação já terminou."}, 404)
            return

        self.json_ok({"erro": "rota que nao existe"}, 404)

    def api_get(self, caminho: str) -> None:
        if caminho == "/api/ola":                       # usado antes de parear
            self.json_ok({"deck": "JOB", "pareado": self.autorizado()})
            return
        if not self.autorizado():
            self.json_ok({"erro": "nao pareado"}, 401)
            return
        if caminho == "/api/config":
            self.json_ok(CONFIG.para_o_ipad())
            return
        if caminho == "/api/estado":
            self.json_ok(self.estado_geral())
            return
        if caminho == "/api/foto":
            # A ÚLTIMA FOTO DA CÂMERA, PARA O IPAD VER.
            #
            # Fica fora da pasta web de propósito: o que a câmera do escritório
            # capturou não é arquivo de aplicação, e ninguém sem token deve
            # conseguir pedir. Esta rota já passou pela checagem de pareamento
            # acima, e a de rede local antes dela.
            try:
                dados = ARQ_FOTO.read_bytes()
            except OSError:
                self.json_ok({"erro": "Nenhuma foto ainda. Toque em Ver a sala agora."}, 404)
                return
            self.responder(200, dados, "image/jpeg")
            return
        self.json_ok({"erro": "rota que nao existe"}, 404)

    def disparar(self, botao_id: str, corpo: dict) -> None:
        botao = CONFIG.botoes.get(botao_id)
        if not botao:
            self.json_ok({"erro": "Esse botão não existe mais no botoes.json."}, 404)
            return

        controle = botao.get("controle", "botao")
        valor = None
        acao_efetiva = dict(botao)

        if controle == "deslizante":
            try:
                valor = float(corpo.get("valor"))
            except (TypeError, ValueError):
                self.json_ok({"erro": "Valor inválido."}, 400)
                return
            valor = max(botao.get("minimo", 0), min(botao.get("maximo", 100), valor))
        elif controle == "alternar":
            ligado = botao_ligado(botao)
            acao_efetiva["acao"] = botao.get("desligar" if ligado else "ligar", {})
            CACHE_ESTADOS.pop(botao_id, None)

        with TRAVA_EXEC:
            em_curso = RODANDO_POR_BOTAO.get(botao_id)
        if em_curso and EXECUCOES.get(em_curso, Execucao("", "")).estado == "rodando":
            self.json_ok({"execucao": em_curso, "ja_rodando": True})
            return

        exe = executar_botao(acao_efetiva, valor)
        print(f"[{agora()}] {botao.get('rotulo', botao_id)}")
        self.json_ok({"execucao": exe.id})

    def estado_geral(self) -> dict:
        with TRAVA_EXEC:
            recentes = [e.resumo() for e in list(EXECUCOES.values())[-30:]]
        alternaveis = {
            bid: botao_ligado(b)
            for bid, b in CONFIG.botoes.items()
            if b.get("controle") == "alternar"
        }
        deslizantes = {}
        for bid, b in CONFIG.botoes.items():
            if b.get("controle") == "deslizante" and b.get("consulta"):
                bruto = consultar_estado(b) or ""
                try:
                    deslizantes[bid] = float(bruto)
                except ValueError:
                    pass
        return {
            "execucoes": recentes,
            "alternaveis": alternaveis,
            "deslizantes": deslizantes,
            "acessibilidade": acessibilidade_liberada(),
            "versao": CONFIG.versao,
        }

    def arquivo(self, caminho: str) -> None:
        nome = "index.html" if caminho in ("/", "") else caminho.lstrip("/")
        destino = (WEB / nome).resolve()
        if not str(destino).startswith(str(WEB.resolve())) or not destino.is_file():
            self.responder(404, b"nao encontrado", "text/plain; charset=utf-8")
            return
        tipo = TIPOS.get(destino.suffix, "application/octet-stream")
        self.responder(200, destino.read_bytes(), tipo)


def main() -> None:
    # sem isto o banner do PIN pode ficar preso no buffer quando a saida nao e um terminal
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except (AttributeError, OSError):
        pass
    if sys.platform != "darwin":
        print("Este deck foi feito para o macOS.")
    ip = ip_da_rede()
    servidor = ThreadingHTTPServer(("0.0.0.0", PORTA), Deck)
    largura = 52
    print()
    print("  " + "-" * largura)
    print("   DECK DO JOB — ligado neste MacBook")
    print("  " + "-" * largura)
    print(f"   No iPad, abra o Safari em:   http://{ip}:{PORTA}")
    print(f"   Quando ele pedir, digite o PIN:   {PAREAMENTO.pin}")
    print()
    print("   Depois toque em Compartilhar > Adicionar à Tela de Início")
    print("   para o deck virar ícone e abrir em tela cheia.")
    print()
    print(f"   Botões: {len(CONFIG.botoes)} em {len(CONFIG.paginas)} páginas")
    if CONFIG.erro:
        print(f"   ATENÇÃO: {CONFIG.erro}")
    if not acessibilidade_liberada():
        print("   Acessibilidade não liberada: teclas e colar estão desligados.")
        print("   Ajustes do Sistema > Privacidade e Segurança > Acessibilidade,")
        print("   ligue a chave do Terminal e ligue o deck de novo.")
    print()
    print("   Para desligar: feche esta janela ou aperte Control + C")
    print("  " + "-" * largura)
    print()
    registrar(f"deck ligado em {ip}:{PORTA}")
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\n  Deck desligado.\n")
        registrar("deck desligado")


if __name__ == "__main__":
    main()
