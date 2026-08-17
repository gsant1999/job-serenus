"""Servidor FastMCP HTTP para cotação, CRM e tabelas de preço do JOB."""

from __future__ import annotations

import os

from fastmcp import FastMCP
from fastmcp.server.auth import require_scopes
from mcp.types import ToolAnnotations

from .auth import FixedApiKeyVerifier
from .client import JobClient, resposta_mcp
from .models import (
    CalcularLocalInput,
    CotacaoAgravoInput,
    CotacaoAoVivoSolicitarInput,
    CotacaoEmailInput,
    CotacaoExcluirInput,
    CotacaoIdInput,
    CotacaoNovaVersaoInput,
    CotacaoSalvarAoVivoInput,
    CotacaoSalvarLocalInput,
    CotacoesListarInput,
    ImagemResposta,
    LeadBuscarInput,
    LeadCriarInput,
    OperadorasListarInput,
    PedidoFilaInput,
    PlanosListarInput,
    RespostaMCP,
    TabelaAtualizarInput,
    TabelaCriarInput,
    TabelaExcluirInput,
    TabelaIdInput,
    TabelaImportarInput,
)


LEITURA = ToolAnnotations(
    readOnlyHint=True,
    destructiveHint=False,
    idempotentHint=True,
    openWorldHint=True,
)
ESCRITA = ToolAnnotations(
    readOnlyHint=False,
    destructiveHint=False,
    idempotentHint=False,
    openWorldHint=True,
)
ATUALIZACAO = ToolAnnotations(
    readOnlyHint=False,
    destructiveHint=True,
    idempotentHint=True,
    openWorldHint=True,
)
EXCLUSAO = ToolAnnotations(
    readOnlyHint=False,
    destructiveHint=True,
    idempotentHint=True,
    openWorldHint=True,
)


mcp = FastMCP(
    name="JOB Serenus - Cotações",
    version="1.0.0",
    instructions=(
        "Use as tools de leitura antes das de escrita. Para cotação local, liste os planos, "
        "calcule e só depois salve. A cotação ao vivo é assíncrona: solicite, acompanhe o pedido "
        "até ficar pronto e então salve o resultado. Nunca invente preço, ID de plano ou lead. "
        "Exclusões e alterações de preço exigem a chave MCP administrativa e confirmação explícita."
    ),
    auth=FixedApiKeyVerifier(),
    mask_error_details=True,
    strict_input_validation=True,
)
job = JobClient()


def _json(modelo, *, excluir: set[str] | None = None) -> dict:
    return modelo.model_dump(exclude_none=True, exclude=excluir or set(), mode="json")


@mcp.tool(annotations=LEITURA)
async def cotacoes_operadoras_listar(entrada: OperadorasListarInput) -> RespostaMCP:
    """Lista operadoras que possuem tabelas ativas no JOB. Use antes de filtrar planos locais."""
    del entrada
    return resposta_mcp(await job.request("GET", "/api/v1/cotacao/planos", params={"operadoras": 1}))


@mcp.tool(annotations=LEITURA)
async def cotacoes_planos_listar(entrada: PlanosListarInput) -> RespostaMCP:
    """Lista planos e preços locais reais, com filtros de contratação, cidade e elegibilidade."""
    params = _json(entrada)
    if entrada.ids:
        params["ids"] = ",".join(str(x) for x in entrada.ids)
    if entrada.mei is not None:
        params["mei"] = "1" if entrada.mei else "0"
    return resposta_mcp(await job.request("GET", "/api/v1/cotacao/planos", params=params))


@mcp.tool(annotations=LEITURA)
async def cotacoes_calcular_local(entrada: CalcularLocalInput) -> RespostaMCP:
    """Calcula preços na base local sem salvar cotação nem alterar o CRM."""
    corpo = _json(entrada)
    corpo["recomendacoes"] = {str(k): v for k, v in entrada.recomendacoes.items()}
    return resposta_mcp(await job.request("POST", "/api/v1/cotacao/calcular", json_body={
        "idades": corpo["idades"],
        "planos": [
            {"plano_id": pid, "recomendacao": entrada.recomendacoes.get(pid)}
            for pid in entrada.planos
        ],
    }))


@mcp.tool(annotations=ESCRITA, timeout=30)
async def cotacoes_ao_vivo_solicitar(entrada: CotacaoAoVivoSolicitarInput) -> RespostaMCP:
    """Enfileira cotação no Painel do Corretor. Requer a máquina trabalhadora online."""
    pedido = {
        "cidade": entrada.cidade,
        "vidas": [_json(v) for v in entrada.vidas],
        "modalidade": entrada.modalidade,
        "operadoraIds": entrada.operadora_ids,
        "exigencias": _json(entrada.exigencias),
        "maxPlanos": entrada.max_planos,
        "titulo": entrada.titulo,
        "somenteOperadoras": entrada.somente_operadoras,
    }
    envelope = {"pedido": {"type": "cotar_aqui", "pedido": pedido}}
    return resposta_mcp(await job.request(
        "POST", "/api/whatsapp/cotacao/fila", json_body=envelope, timeout=20,
    ))


@mcp.tool(annotations=LEITURA)
async def cotacoes_ao_vivo_status(entrada: PedidoFilaInput) -> RespostaMCP:
    """Consulta posição, progresso, resultado ou erro de um pedido de cotação ao vivo."""
    return resposta_mcp(await job.request("GET", f"/api/whatsapp/cotacao/fila/{entrada.pedido_id}"))


@mcp.tool(annotations=ATUALIZACAO)
async def cotacoes_ao_vivo_cancelar(entrada: PedidoFilaInput) -> RespostaMCP:
    """Cancela um pedido ao vivo pertencente ao usuário da chave do JOB."""
    return resposta_mcp(await job.request(
        "POST", f"/api/whatsapp/cotacao/fila/{entrada.pedido_id}/cancelar", json_body={},
    ))


@mcp.tool(annotations=ESCRITA)
async def cotacoes_salvar_local(entrada: CotacaoSalvarLocalInput) -> RespostaMCP:
    """Recalcula no servidor, salva a cotação local, vincula o lead e devolve o link público."""
    corpo = _json(entrada)
    corpo["recomendacoes"] = {str(k): v for k, v in entrada.recomendacoes.items()}
    return resposta_mcp(await job.request("POST", "/api/v1/cotacao", json_body=corpo))


@mcp.tool(annotations=ESCRITA)
async def cotacoes_salvar_ao_vivo(entrada: CotacaoSalvarAoVivoInput) -> RespostaMCP:
    """Salva no JOB o resultado pronto da fila ao vivo e gera um link público imutável."""
    return resposta_mcp(await job.request(
        "POST", "/api/v1/cotacao/ao-vivo/salvar", json_body=_json(entrada),
    ))


@mcp.tool(annotations=LEITURA)
async def cotacoes_listar(entrada: CotacoesListarInput) -> RespostaMCP:
    """Lista cotações salvas do usuário da chave, com filtros por lead, telefone e data."""
    return resposta_mcp(await job.request(
        "GET", "/api/v1/cotacao/salvas", params=_json(entrada),
    ))


@mcp.tool(annotations=LEITURA)
async def cotacoes_consultar(entrada: CotacaoIdInput) -> RespostaMCP:
    """Obtém todos os dados estruturados, links e engajamento de uma cotação salva."""
    return resposta_mcp(await job.request("GET", f"/api/v1/cotacao/{entrada.cotacao_id}"))


@mcp.tool(annotations=LEITURA)
async def cotacoes_imagem_obter(entrada: CotacaoIdInput) -> ImagemResposta:
    """Obtém o PNG já renderizado da cotação como Base64. Não força nova renderização."""
    return await job.imagem(entrada.cotacao_id)


@mcp.tool(annotations=LEITURA)
async def leads_buscar(entrada: LeadBuscarInput) -> RespostaMCP:
    """Busca leads por nome, telefone ou e-mail antes de criar ou salvar uma cotação."""
    return resposta_mcp(await job.request(
        "GET", "/api/v1/crm/leads/buscar", params={"q": entrada.termo},
    ))


@mcp.tool(annotations=ESCRITA)
async def leads_criar(entrada: LeadCriarInput) -> RespostaMCP:
    """Cria lead com deduplicação por telefone; devolve o existente quando já cadastrado."""
    return resposta_mcp(await job.request("POST", "/api/v1/crm/leads", json_body=_json(entrada)))


@mcp.tool(annotations=ESCRITA)
async def cotacoes_email_enviar(entrada: CotacaoEmailInput) -> RespostaMCP:
    """Envia por e-mail o link público da cotação; usa o e-mail salvo quando omitido."""
    return resposta_mcp(await job.request(
        "POST", f"/api/v1/cotacao/{entrada.cotacao_id}/enviar-email",
        json_body={"email": entrada.email},
    ))


@mcp.tool(annotations=ESCRITA)
async def cotacoes_nova_versao(entrada: CotacaoNovaVersaoInput) -> RespostaMCP:
    """Cria uma nova cotação e um novo token, preservando integralmente a versão original."""
    corpo = _json(entrada, excluir={"cotacao_id"})
    corpo["recomendacoes"] = {str(k): v for k, v in entrada.recomendacoes.items()}
    return resposta_mcp(await job.request(
        "POST", f"/api/v1/cotacao/{entrada.cotacao_id}/nova-versao", json_body=corpo,
    ))


@mcp.tool(annotations=ATUALIZACAO, auth=require_scopes("admin"))
async def cotacoes_agravo_aplicar(entrada: CotacaoAgravoInput) -> RespostaMCP:
    """Altera preços unitários somente nesta cotação, com controle otimista de versão."""
    return resposta_mcp(await job.request(
        "POST", f"/api/v1/cotacao/{entrada.cotacao_id}/agravo",
        json_body={"versao": entrada.versao, "ajustes": entrada.ajustes}, admin=True,
    ))


@mcp.tool(annotations=LEITURA)
async def tabelas_consultar(entrada: TabelaIdInput) -> RespostaMCP:
    """Obtém cadastro, preços por faixa e rede vinculada de uma tabela local."""
    return resposta_mcp(await job.request("GET", f"/api/v1/cotacao/tabelas/{entrada.tabela_id}"))


@mcp.tool(annotations=ESCRITA, auth=require_scopes("admin"))
async def tabelas_criar(entrada: TabelaCriarInput) -> RespostaMCP:
    """Cria uma tabela de preços. Exige chave MCP administrativa e usuário JOB administrador."""
    return resposta_mcp(await job.request(
        "POST", "/api/v1/cotacao/tabelas", json_body=_json(entrada), admin=True,
    ))


@mcp.tool(annotations=ATUALIZACAO, auth=require_scopes("admin"))
async def tabelas_atualizar(entrada: TabelaAtualizarInput) -> RespostaMCP:
    """Atualiza metadados e preços de uma tabela existente. Sobrescreve os campos informados."""
    return resposta_mcp(await job.request(
        "PUT", f"/api/v1/cotacao/tabelas/{entrada.tabela_id}",
        json_body=_json(entrada, excluir={"tabela_id"}), admin=True,
    ))


@mcp.tool(annotations=ATUALIZACAO, auth=require_scopes("admin"), timeout=120)
async def tabelas_importar(entrada: TabelaImportarInput) -> RespostaMCP:
    """Importa ou atualiza em lote tabelas da mesma operadora; não aceita exclusão total."""
    return resposta_mcp(await job.request(
        "POST", "/api/v1/cotacao/tabelas/importar", json_body=_json(entrada), timeout=110,
        admin=True,
    ))


@mcp.tool(annotations=EXCLUSAO, auth=require_scopes("admin"))
async def tabelas_excluir(entrada: TabelaExcluirInput) -> RespostaMCP:
    """Exclui uma tabela individual e seus preços. Exige confirmação textual exata."""
    return resposta_mcp(await job.request(
        "POST", f"/api/v1/cotacao/tabelas/{entrada.tabela_id}/excluir",
        json_body={"confirmacao": entrada.confirmacao}, admin=True,
    ))


@mcp.tool(annotations=EXCLUSAO, auth=require_scopes("admin"))
async def cotacoes_excluir(entrada: CotacaoExcluirInput) -> RespostaMCP:
    """Exclui uma cotação individual. Exige chave administrativa e confirmação textual exata."""
    return resposta_mcp(await job.request(
        "POST", f"/api/v1/cotacao/{entrada.cotacao_id}/excluir",
        json_body={"confirmacao": entrada.confirmacao}, admin=True,
    ))


def main() -> None:
    host = os.environ.get("MCP_HOST", "0.0.0.0").strip() or "0.0.0.0"
    try:
        port = int(os.environ.get("PORT", os.environ.get("MCP_PORT", "8000")))
    except ValueError as exc:
        raise RuntimeError("PORT ou MCP_PORT deve ser inteiro.") from exc
    mcp.run(transport="http", host=host, port=port)


if __name__ == "__main__":
    main()
