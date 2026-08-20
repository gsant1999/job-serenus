"""Schemas Pydantic de entrada e saída das tools do MCP."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class Entrada(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class RespostaMCP(BaseModel):
    ok: bool
    status_http: int = 200
    dados: Any | None = None
    codigo: str | None = None
    erro: str | None = None
    proximo_passo: str | None = None


class ImagemResposta(BaseModel):
    ok: bool
    status_http: int = 200
    cotacao_id: int
    mime_type: str | None = None
    imagem_base64: str | None = None
    erro: str | None = None


class OperadorasListarInput(Entrada):
    pass


class PlanosListarInput(Entrada):
    operadora: str | None = Field(default=None, max_length=120)
    cidade: str | None = Field(default=None, max_length=120)
    abrangencia: str | None = Field(default=None, max_length=120)
    modalidade: str | None = Field(default=None, max_length=40)
    acomodacao: str | None = Field(default=None, max_length=40)
    coparticipacao: str | None = Field(default=None, max_length=40)
    mei: bool | None = None
    ativo: Literal["1", "0", "todos"] = "1"
    ids: list[int] = Field(default_factory=list, max_length=100)
    limite: int = Field(default=200, ge=1, le=500)


class CalcularLocalInput(Entrada):
    idades: list[int] = Field(min_length=1, max_length=60)
    planos: list[int] = Field(min_length=1, max_length=30)
    recomendacoes: dict[int, Literal["1a", "2a", "3a"]] = Field(default_factory=dict)


class VidaFaixa(Entrada):
    faixa: Literal[
        "00-18", "19-23", "24-28", "29-33", "34-38",
        "39-43", "44-48", "49-53", "54-58", "59+", "59-199",
    ]
    quantidade: int = Field(ge=1, le=60)


class ExigenciasAoVivo(Entrada):
    coparticipacao: bool | None = None
    mei: bool | None = None
    acomodacao: int | None = Field(default=None, ge=0, le=1)


class CotacaoAoVivoSolicitarInput(Entrada):
    cidade: str = Field(min_length=2, max_length=120)
    vidas: list[VidaFaixa] = Field(min_length=1, max_length=10)
    modalidade: int = Field(default=2, ge=1)
    operadora_ids: list[int] = Field(default_factory=list, max_length=100)
    exigencias: ExigenciasAoVivo = Field(default_factory=ExigenciasAoVivo)
    max_planos: int = Field(default=20, ge=1, le=30)
    titulo: str | None = Field(default=None, max_length=200)
    somente_operadoras: bool = False


class PedidoFilaInput(Entrada):
    pedido_id: int = Field(gt=0)


class CotacaoSalvarLocalInput(Entrada):
    lead_id: int = Field(gt=0)
    idades: list[int] = Field(min_length=1, max_length=60)
    planos: list[int] = Field(min_length=1, max_length=30)
    recomendacoes: dict[int, Literal["1a", "2a", "3a"]] = Field(default_factory=dict)
    cliente_nome: str | None = Field(default=None, max_length=200)
    cliente_email: str | None = Field(default=None, max_length=200)
    cliente_telefone: str | None = Field(default=None, max_length=40)
    corretor_telefone: str | None = Field(default=None, max_length=40)
    titulo: str = Field(default="Cotação", max_length=200)
    orientacao: Literal["horizontal", "vertical"] = "horizontal"
    cidade: str | None = Field(default=None, max_length=120)


class CotacaoSalvarAoVivoInput(Entrada):
    lead_id: int = Field(gt=0)
    resultado: dict[str, Any]
    cliente_nome: str | None = Field(default=None, max_length=200)
    cliente_email: str | None = Field(default=None, max_length=200)
    cliente_telefone: str | None = Field(default=None, max_length=40)
    titulo: str | None = Field(default=None, max_length=200)


class CotacoesListarInput(Entrada):
    lead_id: int | None = Field(default=None, gt=0)
    telefone: str | None = Field(default=None, max_length=40)
    desde: str | None = Field(default=None, max_length=32)
    limite: int = Field(default=50, ge=1, le=200)


class CotacaoIdInput(Entrada):
    cotacao_id: int = Field(gt=0)


class LeadBuscarInput(Entrada):
    termo: str = Field(min_length=2, max_length=200)


class CrmEtapasListarInput(Entrada):
    lead_id: int | None = Field(
        default=None, gt=0,
        description="Opcional. Com um lead real, a resposta também traz os motivos de perda "
                    "cadastrados. Sem ele, vem só a configuração de etapas e de campos.",
    )


class LeadMoverEtapaInput(Entrada):
    lead_id: int = Field(gt=0)
    etapa: str = Field(
        min_length=1, max_length=60,
        description="Slug da etapa de destino, exatamente como vem em crm_etapas_listar. "
                    "Não invente o slug: as etapas são configuráveis pelo administrador.",
    )
    campos: dict[str, str] = Field(
        default_factory=dict,
        description="Só quando a etapa de ORIGEM exige campo preenchido (ex.: motivo_perda para "
                    "sair de negociacao_perdida). ATENÇÃO: o JOB grava estes campos ANTES de "
                    "avaliar a etapa, então eles ficam salvos mesmo se a mudança for recusada.",
    )
    usuario_id: int | None = Field(
        default=None, gt=0,
        description="Consultor em nome de quem a mudança é feita. Enviado, o JOB recusa mover "
                    "lead de outro consultor. Omitido, essa trava não existe.",
    )
    usuario_nome: str = Field(
        default="Agente MCP", max_length=80,
        description="Autor que aparece no histórico do lead. O padrão diz a verdade: sem isso "
                    "o CRM assina a movimentação como 'Extensão'.",
    )


class LeadCriarInput(Entrada):
    nome: str = Field(min_length=1, max_length=200)
    telefone: str = Field(min_length=10, max_length=40)
    origem: Literal["Indicação", "Google", "Facebook", "Instagram", "MEDSENIOR", "Site", "manual"]
    email: str | None = Field(default=None, max_length=200)
    empresa: str | None = Field(default=None, max_length=200)
    observacoes: str | None = Field(default=None, max_length=2000)


class CotacaoEmailInput(Entrada):
    cotacao_id: int = Field(gt=0)
    email: str | None = Field(default=None, max_length=200)


class CotacaoNovaVersaoInput(Entrada):
    cotacao_id: int = Field(gt=0)
    idades: list[int] | None = Field(default=None, min_length=1, max_length=60)
    planos: list[int] | None = Field(default=None, min_length=1, max_length=30)
    recomendacoes: dict[int, Literal["1a", "2a", "3a"]] = Field(default_factory=dict)
    cliente_nome: str | None = Field(default=None, max_length=200)
    cliente_email: str | None = Field(default=None, max_length=200)
    cliente_telefone: str | None = Field(default=None, max_length=40)
    corretor_telefone: str | None = Field(default=None, max_length=40)
    titulo: str | None = Field(default=None, max_length=200)
    orientacao: Literal["horizontal", "vertical"] | None = None
    cidade: str | None = Field(default=None, max_length=120)


class CotacaoAgravoInput(Entrada):
    cotacao_id: int = Field(gt=0)
    versao: int = Field(ge=0)
    ajustes: dict[str, dict[str, float]] = Field(
        min_length=1,
        description='Mapa índice_do_plano -> faixa_etária -> novo_preço_unitário.',
    )


class TabelaDados(Entrada):
    operadora: str = Field(min_length=1, max_length=120)
    plano: str = Field(min_length=1, max_length=160)
    precos: dict[str, float] = Field(min_length=1)
    modalidade: str = Field(default="PME", max_length=40)
    acomodacao: str = Field(default="Enfermaria", max_length=40)
    coparticipacao: str = Field(default="Sem", max_length=40)
    linha: str = Field(default="", max_length=160)
    tipo_cnpj: str = Field(default="", max_length=80)
    abrangencia: str = Field(default="", max_length=120)
    administradora: str = Field(default="", max_length=120)
    cidade: str = Field(default="", max_length=120)
    entidade: str = Field(default="", max_length=120)
    vigencia: str = Field(default="", max_length=40)
    vidas_min: int | None = Field(default=None, ge=0)
    vidas_max: int | None = Field(default=None, ge=0)
    mei: bool = False
    codigo: str = Field(default="", max_length=60)
    fonte: str = Field(default="mcp", max_length=20)
    vigencia_pdf: str = Field(default="", max_length=40)
    ativo: bool = True


class TabelaIdInput(Entrada):
    tabela_id: int = Field(gt=0)


class TabelaCriarInput(TabelaDados):
    pass


class TabelaAtualizarInput(Entrada):
    tabela_id: int = Field(gt=0)
    operadora: str | None = Field(default=None, min_length=1, max_length=120)
    plano: str | None = Field(default=None, min_length=1, max_length=160)
    precos: dict[str, float] | None = Field(default=None, min_length=1)
    modalidade: str | None = Field(default=None, max_length=40)
    acomodacao: str | None = Field(default=None, max_length=40)
    coparticipacao: str | None = Field(default=None, max_length=40)
    linha: str | None = Field(default=None, max_length=160)
    tipo_cnpj: str | None = Field(default=None, max_length=80)
    abrangencia: str | None = Field(default=None, max_length=120)
    administradora: str | None = Field(default=None, max_length=120)
    cidade: str | None = Field(default=None, max_length=120)
    entidade: str | None = Field(default=None, max_length=120)
    vigencia: str | None = Field(default=None, max_length=40)
    vidas_min: int | None = Field(default=None, ge=0)
    vidas_max: int | None = Field(default=None, ge=0)
    mei: bool | None = None
    codigo: str | None = Field(default=None, max_length=60)
    fonte: str | None = Field(default=None, max_length=20)
    vigencia_pdf: str | None = Field(default=None, max_length=40)
    ativo: bool | None = None


class TabelaImportarInput(Entrada):
    operadora: str = Field(min_length=1, max_length=120)
    tabelas: list[TabelaDados] = Field(min_length=1, max_length=500)
    fonte: str = Field(default="mcp", max_length=20)
    vigencia_pdf: str = Field(default="", max_length=40)


class TabelaExcluirInput(Entrada):
    tabela_id: int = Field(gt=0)
    confirmacao: str = Field(description='Use exatamente "EXCLUIR TABELA <id>".')


class CotacaoExcluirInput(Entrada):
    cotacao_id: int = Field(gt=0)
    confirmacao: str = Field(description='Use exatamente "EXCLUIR COTACAO <id>".')
