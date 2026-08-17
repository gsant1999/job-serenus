"""Autenticação do transporte MCP com chaves fixas vindas do ambiente."""

from __future__ import annotations

import hmac
import os

from fastmcp.server.auth import AccessToken, TokenVerifier


def _segredo_obrigatorio(nome: str) -> str:
    valor = os.environ.get(nome, "").strip()
    if not valor:
        raise RuntimeError(f"A variável de ambiente {nome} é obrigatória.")
    if len(valor) < 24:
        raise RuntimeError(f"A variável {nome} deve ter pelo menos 24 caracteres.")
    return valor


class FixedApiKeyVerifier(TokenVerifier):
    """Valida a chave comum e a chave administrativa sem registrar seus valores."""

    def __init__(self) -> None:
        self._api_key = _segredo_obrigatorio("MCP_API_KEY")
        self._admin_api_key = _segredo_obrigatorio("MCP_ADMIN_API_KEY")
        if hmac.compare_digest(self._api_key, self._admin_api_key):
            raise RuntimeError("MCP_API_KEY e MCP_ADMIN_API_KEY devem ser diferentes.")
        public_url = os.environ.get("MCP_PUBLIC_URL", "").strip() or None
        super().__init__(base_url=public_url, required_scopes=["mcp:use"])

    async def verify_token(self, token: str) -> AccessToken | None:
        if hmac.compare_digest(token, self._admin_api_key):
            return AccessToken(
                token=token,
                client_id="job-mcp-admin",
                scopes=["mcp:use", "admin"],
            )
        if hmac.compare_digest(token, self._api_key):
            return AccessToken(
                token=token,
                client_id="job-mcp",
                scopes=["mcp:use"],
            )
        return None
