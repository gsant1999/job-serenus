"""Historico de tudo que a ferramenta gerou e quanto custou.

Um SQLite dentro do volume, mais o PDF de cada contrato em disco. Nao ha servidor de
banco: o volume do Railway ja e o ponto de persistencia, e um arquivo unico e mais
facil de copiar, versionar e restaurar do que um Postgres inteiro para o volume de
uma corretora.

ATENCAO ao caminho: DADOS_DIR precisa apontar para o volume montado. Se apontar para
o disco do container, o historico some no proximo deploy - o container e efemero.
"""
import datetime
import json
import os
import sqlite3
import uuid

DADOS_DIR = os.environ.get('DADOS_DIR', '/data')
BANCO = os.path.join(DADOS_DIR, 'historico.db')
PDFS = os.path.join(DADOS_DIR, 'contratos')

ESQUEMA = """
CREATE TABLE IF NOT EXISTS contrato (
    id           TEXT PRIMARY KEY,
    criado_em    TEXT NOT NULL,
    empresa      TEXT,
    cnpj         TEXT,
    titular      TEXT,
    plano        TEXT,
    vidas        INTEGER,
    agente       TEXT,
    arquivo      TEXT,           -- nome do PDF dentro de PDFS
    bytes        INTEGER,
    paginas      INTEGER,
    faltando     INTEGER,        -- quantos itens do contrato ficaram sem documento
    pendencias   TEXT,           -- JSON com QUAIS itens faltaram
    usuario      TEXT
);
CREATE TABLE IF NOT EXISTS leitura (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    criado_em     TEXT NOT NULL,
    arquivos      INTEGER,
    imagens       INTEGER,
    tokens_entrada INTEGER,
    tokens_saida   INTEGER,
    modelo        TEXT,
    custo_usd     REAL,
    custo_brl     REAL,
    usuario       TEXT
);
CREATE INDEX IF NOT EXISTS ix_contrato_data ON contrato(criado_em);
CREATE INDEX IF NOT EXISTS ix_leitura_data  ON leitura(criado_em);
"""


def _conectar():
    os.makedirs(PDFS, exist_ok=True)
    con = sqlite3.connect(BANCO, timeout=10)
    con.row_factory = sqlite3.Row
    return con


def iniciar():
    """Cria o banco se ainda nao existe. Devolve False se o disco nao aceita escrita -
    a ferramenta continua funcionando, so sem historico."""
    try:
        with _conectar() as con:
            con.executescript(ESQUEMA)
            # Bancos criados antes desta coluna existir continuam validos: a coluna
            # entra vazia e os contratos antigos so nao sabem dizer o que faltou.
            colunas = {l['name'] for l in con.execute('PRAGMA table_info(contrato)')}
            if 'pendencias' not in colunas:
                con.execute('ALTER TABLE contrato ADD COLUMN pendencias TEXT')
        return True
    except Exception:
        return False


def disponivel():
    return os.path.isdir(DADOS_DIR) and os.access(DADOS_DIR, os.W_OK)


def _agora():
    return datetime.datetime.now().isoformat(timespec='seconds')


def gravar_leitura(uso, usuario=''):
    """Registra o custo de uma leitura de documentos."""
    try:
        with _conectar() as con:
            con.execute(
                'INSERT INTO leitura (criado_em, arquivos, imagens, tokens_entrada, '
                'tokens_saida, modelo, custo_usd, custo_brl, usuario) '
                'VALUES (?,?,?,?,?,?,?,?,?)',
                (_agora(), uso.get('arquivos', 0), uso.get('imagens', 0),
                 uso.get('tokens_entrada', 0), uso.get('tokens_saida', 0),
                 uso.get('modelo', ''), uso.get('custo_usd', 0.0),
                 uso.get('custo_brl', 0.0), usuario))
    except Exception:
        pass          # historico nunca pode derrubar a geracao do contrato


def gravar_contrato(pdf, dados, roteiro, usuario=''):
    """Guarda o PDF do contrato e o registro. Devolve o id, ou None se nao deu."""
    try:
        ident = uuid.uuid4().hex[:12]
        nome = f'{ident}.pdf'
        with open(os.path.join(PDFS, nome), 'wb') as f:
            f.write(pdf)

        empresa = (dados.get('empresa') or {})
        grupos = dados.get('titulares') or []
        titular = ((grupos[0] or {}).get('titular') or {}).get('nome', '') if grupos else ''
        vidas = sum(1 + len(g.get('dependentes') or []) for g in grupos)
        # Guarda o nome comercial, nao a chave interna: quem le a tela de gestao quer
        # "Selection CE 200 Standard", nao "selection_200".
        chave = (dados.get('plano') or {}).get('produto', '')
        import motor
        plano = (motor.PLANOS.get(chave) or {}).get('nome_folha', chave)
        acomod = (dados.get('plano') or {}).get('acomodacao', '')
        if acomod:
            plano = f'{plano} · {acomod}'

        # Guarda QUAIS itens faltaram, nao so quantos: "2 pendencias" sem dizer quais
        # obriga o corretor a abrir o PDF e conferir pagina por pagina.
        faltantes = [r.get('etapa', '?') for r in roteiro if not r.get('ok')]

        with _conectar() as con:
            con.execute(
                'INSERT INTO contrato (id, criado_em, empresa, cnpj, titular, plano, '
                'vidas, agente, arquivo, bytes, paginas, faltando, pendencias, usuario) '
                'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (ident, _agora(), empresa.get('razao_social', ''), empresa.get('cnpj', ''),
                 titular, plano, vidas, (dados.get('agente') or {}).get('nome', ''),
                 nome, len(pdf), sum(r.get('paginas', 0) for r in roteiro if r.get('ok')),
                 len(faltantes), json.dumps(faltantes, ensure_ascii=False), usuario))
        return ident
    except Exception:
        return None


def caminho_pdf(ident):
    """Caminho do PDF de um contrato, ou None se nao existe."""
    try:
        with _conectar() as con:
            linha = con.execute('SELECT arquivo FROM contrato WHERE id=?', (ident,)).fetchone()
        if not linha:
            return None
        caminho = os.path.join(PDFS, linha['arquivo'])
        return caminho if os.path.exists(caminho) else None
    except Exception:
        return None


def _soma(con, tabela, desde):
    campo = 'custo_brl' if tabela == 'leitura' else None
    if campo:
        linha = con.execute(
            f'SELECT COUNT(*) n, COALESCE(SUM(custo_brl),0) brl, '
            f'COALESCE(SUM(custo_usd),0) usd FROM leitura WHERE criado_em >= ?',
            (desde,)).fetchone()
        return {'leituras': linha['n'], 'brl': linha['brl'], 'usd': linha['usd']}
    linha = con.execute('SELECT COUNT(*) n FROM contrato WHERE criado_em >= ?',
                        (desde,)).fetchone()
    return {'contratos': linha['n']}


def resumo():
    """Custo e volume por periodo, para a tela de gestao."""
    hoje = datetime.date.today()
    inicios = {
        'dia': hoje.isoformat(),
        'semana': (hoje - datetime.timedelta(days=hoje.weekday())).isoformat(),
        'mes': hoje.replace(day=1).isoformat(),
        'geral': '0000-01-01',
    }
    saida = {}
    try:
        with _conectar() as con:
            for chave, desde in inicios.items():
                saida[chave] = {**_soma(con, 'leitura', desde),
                                **_soma(con, 'contrato', desde)}
            linha = con.execute(
                'SELECT COALESCE(AVG(custo_brl),0) m FROM leitura').fetchone()
            saida['media_leitura_brl'] = linha['m']
            linha = con.execute(
                'SELECT COALESCE(SUM(bytes),0) b FROM contrato').fetchone()
            saida['bytes_guardados'] = linha['b']
    except Exception:
        return None
    return saida


def listar(limite=200):
    """Contratos gerados, do mais novo para o mais velho."""
    try:
        with _conectar() as con:
            linhas = con.execute(
                'SELECT * FROM contrato ORDER BY criado_em DESC LIMIT ?',
                (limite,)).fetchall()
        saida = []
        for l in linhas:
            d = dict(l)
            try:
                d['pendencias'] = json.loads(d.get('pendencias') or '[]')
            except Exception:
                d['pendencias'] = []
            saida.append(d)
        return saida
    except Exception:
        return []
