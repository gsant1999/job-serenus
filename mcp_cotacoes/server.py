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
    CrmEtapasListarInput,
    ImagemResposta,
    LeadBuscarInput,
    LeadCriarInput,
    LeadMoverEtapaInput,
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


# lead_id que não existe. A ficha do JOB devolve a configuração do CRM (etapas,
# campos, quadros) mesmo quando não acha o lead — é o único jeito de listar as
# etapas com a chave de API, porque /crm/etapas exige sessão de navegador.
_LEAD_INEXISTENTE = 99_999_999


@mcp.tool(annotations=LEITURA)
async def crm_etapas_listar(entrada: CrmEtapasListarInput) -> RespostaMCP:
    """Lista as etapas do funil e os campos que travam a saída de cada uma.

    Chame antes de leads_mover_etapa: os slugs são configuráveis pelo administrador
    e não devem ser adivinhados.
    """
    resultado = await job.request(
        "GET", "/api/whatsapp/lead/ficha",
        params={"lead_id": entrada.lead_id or _LEAD_INEXISTENTE},
    )
    r = resposta_mcp(resultado)
    if not r.ok:
        return r
    dados = resultado.dados if isinstance(resultado.dados, dict) else {}
    # Projeção obrigatória: a ficha crua tem ~140 KB e 82% disso é a lista dos
    # 5.571 municípios, que ninguém pediu e o agente pagaria em token.
    etapas = [
        {"slug": e.get("slug"), "nome": e.get("nome"), "tipo": e.get("tipo"), "ordem": e.get("ordem")}
        for e in (dados.get("etapas") or [])
    ]
    travas = [
        {
            "campo": c.get("chave"),
            "nome": c.get("nome"),
            "obriga_sair_de": c.get("obriga_saida_de") or None,
            "obriga_entrar_em": c.get("obriga_entrada_em") or None,
            "opcoes": c.get("opcoes") or [],
        }
        for c in (dados.get("campos_def") or [])
        if c.get("obriga_saida_de") or c.get("obriga_entrada_em")
    ]
    saida: dict = {"etapas": etapas, "campos_que_travam": travas}
    avisos = []
    if entrada.lead_id:
        saida["motivos_perda"] = dados.get("motivos_perda") or []
        if not dados.get("existe"):
            avisos.append(
                f"O lead {entrada.lead_id} não existe, então a lista de motivos de perda "
                "veio vazia por causa disso, não porque a corretora não tem motivos."
            )
    else:
        avisos.append("Chame com um lead_id real se precisar também dos motivos de perda.")
    # O JOB tem um fallback de emergência que inventa 9 etapas quando a tabela
    # de etapas falha. Agir sobre ele seria mover lead pela configuração errada.
    if len(etapas) == 9 and not any(e["slug"] == "transferencia" for e in etapas):
        avisos.insert(0, "Esta lista parece o fallback de emergência do JOB, não a configuração "
                         "real. Confirme com um administrador antes de mover lead.")
    return RespostaMCP(
        ok=True, status_http=resultado.status, dados=saida,
        proximo_passo=" ".join(avisos) or None,
    )


def _resposta_mover_etapa(resultado, etapa_pedida: str) -> RespostaMCP:
    """Envelope próprio, porque a rota do JOB mente por omissão.

    /api/whatsapp/lead/salvar responde HTTP 200 com ok:true MESMO QUANDO RECUSA
    a mudança de etapa — o motivo real fica em etapa_ok/etapa_erro. Passar isso
    pelo resposta_mcp() cru faria a tool dizer "movido" para um lead que não saiu
    do lugar, e o agente avisaria o corretor de um avanço que não houve.

    A prova de que andou é uma só: o lead que volta na resposta está na etapa
    pedida. Não dá para usar `mudou` — ele nunca lista a etapa.
    """
    r = resposta_mcp(resultado)
    if not r.ok:
        return r
    dados = resultado.dados if isinstance(resultado.dados, dict) else {}
    lead = dados.get("lead") or {}
    atual = str(lead.get("etapa") or "").strip()
    avisos = [str(a) for a in (dados.get("avisos") or []) if a]

    if dados.get("etapa_ok") is False:
        erro_etapa = str(dados.get("etapa_erro") or "")
        # `campos_faltando` vem SEMPRE, referente à etapa ATUAL do lead — inclusive
        # quando a recusa foi por slug inexistente. Quem decide o conselho é o
        # motivo, não a presença da lista: senão a tool manda preencher um campo
        # para consertar um erro de digitação no nome da etapa.
        por_campo = erro_etapa.startswith("Preencha antes") or erro_etapa.startswith("Antes de mover")
        faltando = [
            str(c.get("chave")) for c in (dados.get("campos_faltando") or []) if c.get("chave")
        ]
        if por_campo and faltando:
            proximo = ("Preencha " + ", ".join(faltando) + " no argumento campos e chame de novo. "
                       "Use crm_etapas_listar para ver os valores aceitos.")
        else:
            proximo = ("Confira o slug em crm_etapas_listar. O lead continua em "
                       f"'{atual or 'etapa desconhecida'}'.")
        return RespostaMCP(
            ok=False, status_http=resultado.status, dados=None, codigo="etapa_recusada",
            erro=str(dados.get("etapa_erro") or "O JOB recusou a mudança de etapa."),
            proximo_passo=proximo,
        )

    if atual != etapa_pedida:
        return RespostaMCP(
            ok=False, status_http=resultado.status, dados=None, codigo="etapa_nao_mudou",
            erro=(f"O JOB respondeu sucesso, mas o lead está em '{atual or 'etapa desconhecida'}' "
                  f"e não em '{etapa_pedida}'."),
            proximo_passo="Confirme o slug em crm_etapas_listar antes de tentar de novo.",
        )

    return RespostaMCP(
        ok=True, status_http=resultado.status,
        dados={"lead_id": lead.get("id"), "etapa": atual, "avisos": avisos},
        proximo_passo=("Avisos do JOB: " + "; ".join(avisos)) if avisos else None,
    )


@mcp.tool(annotations=ATUALIZACAO)
async def leads_mover_etapa(entrada: LeadMoverEtapaInput) -> RespostaMCP:
    """Move o lead para outra etapa do funil do CRM, com histórico.

    Liste as etapas com crm_etapas_listar antes: o slug não pode ser adivinhado.
    Algumas etapas de origem exigem um campo preenchido para poder sair; nesse
    caso a tool devolve ok:false dizendo qual campo mandar em `campos`.
    """
    corpo: dict = {
        "lead_id": entrada.lead_id,
        "etapa": entrada.etapa,
        "usuario_nome": entrada.usuario_nome,
    }
    if entrada.usuario_id:
        corpo["usuario_id"] = entrada.usuario_id
    if entrada.campos:
        corpo["campos"] = entrada.campos
    # Nada de 'etiquetas' aqui, nunca: a rota trata esse campo como lista FECHADA
    # e apagaria toda etiqueta do lead que não viesse junto.
    return _resposta_mover_etapa(
        await job.request("POST", "/api/whatsapp/lead/salvar", json_body=corpo),
        entrada.etapa,
    )


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
