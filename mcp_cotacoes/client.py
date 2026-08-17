"""Cliente HTTP do JOB; o MCP não acessa o banco nem replica o cálculo."""

from __future__ import annotations

import base64
import hmac
import os
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

import httpx

from .models import ImagemResposta, RespostaMCP


@dataclass(slots=True)
class ResultadoHTTP:
    status: int
    dados: Any


class JobClient:
    def __init__(self) -> None:
        self.base_url = os.environ.get("JOB_BASE_URL", "").strip().rstrip("/")
        self.api_key = os.environ.get("JOB_API_KEY", "").strip()
        self.admin_api_key = os.environ.get("JOB_ADMIN_API_KEY", "").strip()
        if not self.base_url:
            raise RuntimeError("A variável JOB_BASE_URL é obrigatória.")
        if not self.api_key:
            raise RuntimeError("A variável JOB_API_KEY é obrigatória.")
        if not self.admin_api_key:
            raise RuntimeError("A variável JOB_ADMIN_API_KEY é obrigatória.")
        if hmac.compare_digest(self.api_key, self.admin_api_key):
            raise RuntimeError("JOB_API_KEY e JOB_ADMIN_API_KEY devem ser diferentes.")
        parsed = urlparse(self.base_url)
        if parsed.username or parsed.password:
            raise RuntimeError("JOB_BASE_URL não pode conter credenciais.")
        local = parsed.hostname in ("localhost", "127.0.0.1", "::1")
        libera_http = os.environ.get("MCP_ALLOW_INSECURE_HTTP", "").strip() == "1"
        if parsed.scheme != "https" and not local and not libera_http:
            raise RuntimeError("JOB_BASE_URL deve usar HTTPS fora do ambiente local.")
        try:
            self.timeout = float(os.environ.get("JOB_API_TIMEOUT", "30"))
        except ValueError as exc:
            raise RuntimeError("JOB_API_TIMEOUT deve ser numérico.") from exc
        if self.timeout <= 0:
            raise RuntimeError("JOB_API_TIMEOUT deve ser maior que zero.")

    def _headers(self, admin: bool = False) -> dict[str, str]:
        chave = self.admin_api_key if admin else self.api_key
        return {
            "Authorization": f"Bearer {chave}",
            "Accept": "application/json",
            "User-Agent": "job-serenus-mcp/1.0",
        }

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        timeout: float | None = None,
        admin: bool = False,
    ) -> ResultadoHTTP:
        query = {k: v for k, v in (params or {}).items() if v is not None and v != ""}
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                headers=self._headers(admin),
                timeout=timeout or self.timeout,
                follow_redirects=False,
            ) as client:
                resposta = await client.request(method, path, params=query, json=json_body)
        except httpx.TimeoutException:
            return ResultadoHTTP(504, {
                "ok": False,
                "codigo": "job_timeout",
                "erro": "O JOB não respondeu dentro do tempo configurado.",
                "proximo_passo": "Tente novamente; se persistir, verifique a disponibilidade do JOB.",
            })
        except httpx.HTTPError:
            return ResultadoHTTP(502, {
                "ok": False,
                "codigo": "job_indisponivel",
                "erro": "Não foi possível conectar ao JOB.",
                "proximo_passo": "Verifique JOB_BASE_URL, rede e certificado TLS.",
            })

        content_type = resposta.headers.get("content-type", "")
        if "json" in content_type:
            try:
                dados = resposta.json()
            except ValueError:
                dados = {"ok": False, "codigo": "resposta_invalida", "erro": "O JOB devolveu JSON inválido."}
        else:
            dados = {
                "ok": False,
                "codigo": "resposta_inesperada",
                "erro": "O JOB devolveu uma resposta que não é JSON.",
            }
        if isinstance(dados, dict) and "ok" not in dados:
            dados["ok"] = resposta.is_success
        return ResultadoHTTP(resposta.status_code, dados)

    async def imagem(self, cotacao_id: int) -> ImagemResposta:
        try:
            async with httpx.AsyncClient(
                base_url=self.base_url,
                headers=self._headers(False),
                timeout=self.timeout,
                follow_redirects=False,
            ) as client:
                resposta = await client.get(f"/api/v1/cotacao/{cotacao_id}/imagem")
        except httpx.TimeoutException:
            return ImagemResposta(ok=False, status_http=504, cotacao_id=cotacao_id,
                                  erro="O JOB não respondeu dentro do tempo configurado.")
        except httpx.HTTPError:
            return ImagemResposta(ok=False, status_http=502, cotacao_id=cotacao_id,
                                  erro="Não foi possível conectar ao JOB.")
        if not resposta.is_success:
            try:
                corpo = resposta.json()
                erro = corpo.get("mensagem") or corpo.get("erro")
            except ValueError:
                erro = "Não foi possível obter a imagem."
            return ImagemResposta(ok=False, status_http=resposta.status_code,
                                  cotacao_id=cotacao_id, erro=str(erro))
        return ImagemResposta(
            ok=True,
            status_http=resposta.status_code,
            cotacao_id=cotacao_id,
            mime_type=resposta.headers.get("content-type", "image/png").split(";", 1)[0],
            imagem_base64=base64.b64encode(resposta.content).decode("ascii"),
        )


def resposta_mcp(resultado: ResultadoHTTP) -> RespostaMCP:
    dados = resultado.dados
    if not isinstance(dados, dict):
        return RespostaMCP(ok=200 <= resultado.status < 300, status_http=resultado.status, dados=dados)
    ok = bool(dados.get("ok", 200 <= resultado.status < 300)) and 200 <= resultado.status < 300
    motivo = dados.get("motivo")
    codigo = dados.get("codigo") or motivo
    erro = dados.get("mensagem") or dados.get("erro") or motivo
    if not ok and not erro:
        erro = "O JOB recusou a operação sem informar um motivo."
    proximo = dados.get("proximo_passo")
    if motivo == "sem_trabalhador":
        erro = "Nenhuma máquina trabalhadora de cotação está online."
        proximo = "Abra a extensão na máquina marcada, autentique o Painel do Corretor e tente novamente."
    return RespostaMCP(
        ok=ok,
        status_http=resultado.status,
        dados=dados if ok else None,
        codigo=str(codigo) if codigo else None,
        erro=str(erro) if erro else None,
        proximo_passo=str(proximo) if proximo else None,
    )
