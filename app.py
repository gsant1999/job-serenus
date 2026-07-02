# HOTFIX 20.06.2026 20:59 — Force rebuild (indentação OK, sintaxe verificada)
import os, sqlite3, json, hashlib, secrets, re, threading, time
from flask import Flask, render_template, request, jsonify, redirect, url_for, session, flash, send_from_directory, send_file, abort, Response
from datetime import datetime, timedelta, date
from functools import wraps
from dateutil.relativedelta import relativedelta
import pytz

TZ_SP = pytz.timezone('America/Sao_Paulo')  # Campinas, SP

# ─── SUPORTE A PostgreSQL (Railway/Supabase) ──────────────────────────────────
try:
    import psycopg2, psycopg2.extras, psycopg2.pool
    HAS_POSTGRES = True   # PostgreSQL do Railway — persiste entre deploys (definitivo)
except ImportError:
    HAS_POSTGRES = False

# ─── SUPORTE A CLOUDFLARE R2 ──────────────────────────────────────────────
try:
    import boto3
    from botocore.exceptions import ClientError
    HAS_BOTO3 = True
except ImportError:
    HAS_BOTO3 = False

app = Flask(__name__)
# ─── CHAVE SECRETA FIXA PARA SESSÕES PERSISTENTES ───────────────────────
# Se usar secrets.token_hex(32) toda vez, a session cai após restart!
# SECRET_KEY: usa a variável de ambiente. Se não houver (dev), gera uma aleatória
# por execução — assim NUNCA há uma chave fixa pública no código que permita
# forjar sessões. Em produção, defina SECRET_KEY no Railway (fixa, para as
# sessões sobreviverem a deploys).
_secret_env = os.environ.get('SECRET_KEY')
if _secret_env:
    app.secret_key = _secret_env
else:
    app.secret_key = secrets.token_hex(32)
    print("[SEGURANÇA] ⚠️ SECRET_KEY não definida — gerada aleatória (sessões caem a cada deploy). Defina SECRET_KEY no Railway.")
app.config['SESSION_COOKIE_SECURE'] = True   # HTTPS only
app.config['SESSION_COOKIE_HTTPONLY'] = True  # Sem acesso JS (protege de XSS)
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'  # Proteção CSRF
app.config['PERMANENT_SESSION_LIFETIME'] = 86400 * 7  # 7 dias (sistema financeiro)

# ─── CAPTURA GLOBAL DE ERROS (para diagnóstico de 500) ────────────────────────
# Guarda os últimos erros em memória para inspeção rápida via /admin/ultimo-erro,
# e loga o traceback completo no Railway (aparece em "View Logs").
import logging, traceback as _tb
logging.basicConfig(level=logging.INFO)
_ULTIMOS_ERROS = []

@app.errorhandler(500)
@app.errorhandler(Exception)
def _handler_erro_global(e):
    from werkzeug.exceptions import HTTPException
    # Deixa erros HTTP normais (404, 403, redirects) seguirem o fluxo padrão
    if isinstance(e, HTTPException) and e.code and e.code < 500:
        return e
    tb_str = _tb.format_exc()
    rota = request.path if request else '?'
    metodo = request.method if request else '?'
    app.logger.error(f"[ERRO-500] {metodo} {rota}\n{tb_str}")
    _ULTIMOS_ERROS.insert(0, {
        "rota": rota,
        "metodo": metodo,
        "erro": str(e)[:500],
        "traceback": tb_str[-3000:],
        "quando": datetime.now(TZ_SP).strftime('%Y-%m-%d %H:%M:%S'),
    })
    del _ULTIMOS_ERROS[10:]  # mantém só os 10 mais recentes
    # Tenta liberar conexões pendentes que possam ter ficado abertas
    return ("Internal Server Error — o erro foi registrado. "
            "Admin: acesse /admin/ultimo-erro para ver o detalhe."), 500


# ─── AUTO-INICIALIZAR BANCO DE DADOS ──────────────────────────────────────
# Garante que o banco é inicializado tanto em dev (python app.py) 
# quanto em produção (gunicorn) na primeira requisição
_db_initialized = False

@app.before_request
def _ensure_db_initialized():
    global _db_initialized
    if not _db_initialized:
        try:
            init_db()
            _db_initialized = True
            if DB_MODE == 'postgres':
                print("[DB] ✅ PostgreSQL inicializado")
            else:
                print("[DB] ✅ SQLite inicializado")
        except Exception as e:
            print(f"[DB] ⚠️ Erro ao inicializar: {e}")
            _db_initialized = True  # Evita loop infinito
        # Inicia o scheduler (backup + import de leads)
        _iniciar_scheduler_backup()


@app.before_request
def _auto_pull_leads_no_request():
    """Safety net: importa leads das planilhas em background (throttle 10 min),
    independente do APScheduler — assim os leads chegam mesmo após restarts."""
    try:
        _auto_pull_leads_throttled()
    except Exception:
        pass


# O scheduler real (backup 22:00 + import de leads) é _iniciar_scheduler_backup,
# definido mais abaixo no arquivo e chamado no _ensure_db_initialized acima.

@app.template_filter('from_json')
def _from_json(s):
    try: return json.loads(s) if s else []
    except: return []

@app.template_filter('moeda')
def _moeda(v):
    """R$ 10.104,66"""
    try:
        v = float(v or 0)
        neg = v < 0
        v = abs(v)
        cents = f"{v:.2f}".split('.')[1]
        inteiro = str(int(v))
        grupos = []
        while len(inteiro) > 3:
            grupos.insert(0, inteiro[-3:])
            inteiro = inteiro[:-3]
        grupos.insert(0, inteiro)
        return ('R$ -' if neg else 'R$ ') + '.'.join(grupos) + ',' + cents
    except:
        return 'R$ 0,00'

@app.template_filter('moeda_doc')
def _moeda_doc(v):
    """1.234,56 (sem 'R$', para documentos de cotação)."""
    try:
        v = float(v or 0)
        neg = v < 0
        v = abs(v)
        cents = f"{v:.2f}".split('.')[1]
        inteiro = str(int(v))
        grupos = []
        while len(inteiro) > 3:
            grupos.insert(0, inteiro[-3:])
            inteiro = inteiro[:-3]
        grupos.insert(0, inteiro)
        return ('-' if neg else '') + '.'.join(grupos) + ',' + cents
    except:
        return '0,00'

@app.template_filter('numero')
def _numero(v):
    """10.104"""
    try:
        v = int(float(v or 0))
        neg = v < 0
        inteiro = str(abs(v))
        grupos = []
        while len(inteiro) > 3:
            grupos.insert(0, inteiro[-3:])
            inteiro = inteiro[:-3]
        grupos.insert(0, inteiro)
        return ('-' if neg else '') + '.'.join(grupos)
    except:
        return '0'
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# ─── PERSISTÊNCIA: dados em pasta FIXA, fora das pastas de versão ───

def _eh_gravavel(caminho):
    """Testa de verdade se dá para criar pasta e escrever arquivo no caminho."""
    try:
        os.makedirs(caminho, exist_ok=True)
        teste = os.path.join(caminho, '.write_test')
        with open(teste, 'w') as f:
            f.write('ok')
        os.remove(teste)
        return True
    except Exception:
        return False

# Prioridade de diretório persistente:
# 1) JOB_DATA_DIR (se setado e gravável)  2) /data (volume Railway, se gravável)  3) ~/JOB_Serenus_Dados
_env_dir = os.environ.get("JOB_DATA_DIR")
if _env_dir and _eh_gravavel(_env_dir):
    DATA_DIR = _env_dir
elif _eh_gravavel('/data'):
    DATA_DIR = '/data'
else:
    DATA_DIR = os.path.join(os.path.expanduser("~"), "JOB_Serenus_Dados")
    os.makedirs(DATA_DIR, exist_ok=True)
    print(f"[PERSIST] ⚠️ ATENÇÃO: volume persistente indisponível! Usando pasta EFÊMERA {DATA_DIR} — anexos somem a cada deploy.")

DB = os.path.join(DATA_DIR, "job.db")

# Anexos no MESMO diretório persistente escolhido acima.
UPLOAD_FOLDER = os.path.join(DATA_DIR, "anexos")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
print(f"[PERSIST] DATA_DIR={DATA_DIR} | UPLOAD_FOLDER={UPLOAD_FOLDER} | gravável={_eh_gravavel(UPLOAD_FOLDER)}")

# ─── MODO DO BANCO: PostgreSQL (Railway) com fallback SQLite ────────────────
DB_MODE = 'postgres' if (os.environ.get('DATABASE_URL') and HAS_POSTGRES) else 'sqlite'

# Log inicial
print(f"[APP] DATABASE_URL presente: {bool(os.environ.get('DATABASE_URL'))}")
print(f"[APP] HAS_POSTGRES: {HAS_POSTGRES}")
print(f"[APP] DB_MODE: {DB_MODE}")

# ─── VARIÁVEIS GLOBAIS NECESSÁRIAS ──────────────────────────────────────────
STATUS_FLUXO = [
    'Pendente de receber',
    'Recebido e não repassado',
    'Liberado para o corretor',
    'Pago ao corretor',
    'Antecipação Solicitada à Operadora',
    'Antecipação - Aguardando ADM',
]

MODELO_NOME = {
    'sem_lead_sem_fixo': 'Sem Lead / Sem Fixo',
    'com_lead_sem_fixo': 'Com Lead / Sem Fixo',
    'com_fixo_lead': 'Com Fixo + Lead',
    'com_fixo_sem_lead': 'Com Fixo / Sem Lead',
    'gestor_vendedor': 'Gestor Vendedor (100%)',
    'n1': 'Nível 1',
    'n2': 'Nível 2',
    'n3': 'Nível 3',
}

MODELO_TEM_META = {
    'sem_lead_sem_fixo': False,
    'com_lead_sem_fixo': True,
    'com_fixo_lead': True,
    'com_fixo_sem_lead': False,
    'gestor_vendedor': False,
    'n1': False,
    'n2': False,
    'n3': False,
}

# ─── ANTECIPAÇÃO DE COMISSÃO (Affinity) ──────────────────────────────────────
# Operadoras que permitem antecipação da 1ª mensalidade, por plano.
# Fonte: regras da Affinity Corretora. Vera Cruz NÃO é contemplada.
# Comparação é feita de forma normalizada (minúsculas, sem acento/espaço extra).
ANTECIPACAO_PERMITIDA = {
    'PME': [
        'Alice', 'Allcare', 'Allcare Integral RJ', 'Allcare Unimed Leste F-RJ',
        'Amil', 'Amil Dental', 'Ana Costa', 'Assim Saúde', 'Bradesco', 'Hapvida', 'Klini Saúde',
        'Leve Saúde', 'MedSênior', 'Medsenior', 'Omint', 'Porto Seguro', 'Sami',
        'Santa Helena', 'São Cristóvão', 'Seguros Unimed', 'Sobam', 'SulAmérica',
        'Sul América', 'Trasmontano',
    ],
    'ADESAO': [
        'Allcare',
    ],
    'PF': [
        'Amil Dental', 'Assim Saúde', 'Leve Saúde', 'MedSênior', 'Medsenior', 'Hapvida',
        'Prevent Senior', 'Sobam', 'Trasmontano',
    ],
}

def _normaliza_op(txt):
    """Normaliza nome de operadora para comparação (minúsculas, sem acento/espaço extra)."""
    import unicodedata
    t = (txt or '').strip().lower()
    t = ''.join(c for c in unicodedata.normalize('NFD', t) if unicodedata.category(c) != 'Mn')
    return ' '.join(t.split())

def antecipacao_permitida(operadora, plano):
    """Retorna True se a operadora permite antecipação de comissão no plano dado."""
    lista = ANTECIPACAO_PERMITIDA.get((plano or '').upper(), [])
    alvo = _normaliza_op(operadora)
    # split_operadora pode trazer 'Nome - obs'; pega só o nome base
    alvo_base = _normaliza_op(alvo.split(' - ')[0]) if ' - ' in alvo else alvo
    # 'med senior sp/rj' → tira sufixos de praça comuns para casar com 'med senior'
    alvo_base = alvo_base.replace('/', ' ').replace('  ', ' ')
    for permitida in lista:
        p = _normaliza_op(permitida)
        # casa se um contém o outro como palavra inicial (cobre 'med senior sp rj' vs 'medsenior'/'med senior')
        p_compact = p.replace(' ', '')
        alvo_compact = alvo_base.replace(' ', '')
        if (alvo_base == p or alvo == p
                or alvo_base.startswith(p) or p.startswith(alvo_base)
                or alvo_compact.startswith(p_compact) or p_compact.startswith(alvo_compact)):
            return True
    return False

def _build_pg_url(raw_url):
    """Garante que o @ na senha seja codificado corretamente."""
    try:
        from urllib.parse import urlparse, urlunparse, quote
        p = urlparse(raw_url)
        # Re-codifica só o password (pode ter @ sem encode)
        password = p.password or ''
        user = p.username or ''
        host = p.hostname or ''
        port = p.port or 5432
        path = p.path or '/postgres'
        clean = f"postgresql://{quote(user, safe='')}:{quote(password, safe='')}@{host}:{port}{path}?sslmode=require"
        return clean
    except Exception:
        return raw_url + ('?sslmode=require' if '?' not in raw_url else '&sslmode=require')

# ════════════════════════════════════════════════════════════════════════════
# CAMADA DE COMPATIBILIDADE  SQLite ↔ PostgreSQL
# Faz o psycopg2 se comportar EXATAMENTE como o sqlite3, para que TODO o código
# escrito em sintaxe SQLite (conn.execute, placeholders "?", INSERT OR IGNORE,
# strftime) funcione no PostgreSQL sem reescrever as ~240 consultas do sistema.
#   • conn.execute(sql, params)  → devolve um cursor (igual sqlite3)
#   • cursor.execute(...)        → encadeável: .execute(...).fetchone()
#   • rows acessíveis por nome   → row['coluna']  e  dict(row)
#   • tradução automática de SQL SQLite → PostgreSQL
# SQL já em sintaxe Postgres (%s, ON CONFLICT) passa intacto pela tradução.
# ════════════════════════════════════════════════════════════════════════════

# strftime('%Y-%m', col) (SQLite) → TO_CHAR((col)::timestamp, 'YYYY-MM') (Postgres)
_STRFTIME_PG = {
    '%Y-%m-%d %H:%M:%S': 'YYYY-MM-DD HH24:MI:SS',
    '%Y-%m-%d': 'YYYY-MM-DD',
    '%Y-%m': 'YYYY-MM',
    '%Y': 'YYYY', '%m': 'MM', '%d': 'DD',
    '%H:%M:%S': 'HH24:MI:SS',
}

from decimal import Decimal as _Decimal

def _val_sqlite_like(v):
    """Converte um valor do Postgres para o que o SQLite devolveria.
    O sistema inteiro foi escrito assumindo que datas vêm como TEXTO
    (faz fromisoformat, fatia [:7] etc.) — o psycopg2 devolve datetime/Decimal."""
    if isinstance(v, datetime):
        return v.strftime('%Y-%m-%d %H:%M:%S')
    if isinstance(v, date):
        return v.strftime('%Y-%m-%d')
    if isinstance(v, _Decimal):
        return float(v)
    return v

def _row_sqlite_like(row):
    """Aplica a conversão em todas as colunas de um RealDictRow (in-place)."""
    if row is None:
        return None
    for k in list(row.keys()):
        row[k] = _val_sqlite_like(row[k])
    return row

def _traduzir_sql_pg(sql):
    """Traduz uma query em sintaxe SQLite para PostgreSQL.
    SQL já nativo de Postgres (com %s e/ou ON CONFLICT, sem '?') passa intacto."""
    s = sql
    # 1) strftime('fmt', coluna) → TO_CHAR((coluna)::timestamp, 'FMT')
    if 'strftime' in s:
        def _rep_strf(m):
            fmt = m.group(1)
            col = m.group(2).strip()
            pg = _STRFTIME_PG.get(fmt) or (fmt.replace('%Y', 'YYYY').replace('%m', 'MM')
                 .replace('%d', 'DD').replace('%H', 'HH24').replace('%M', 'MI').replace('%S', 'SS'))
            return f"TO_CHAR(({col})::timestamp, '{pg}')"
        s = re.sub(r"strftime\(\s*'([^']*)'\s*,\s*([^()]+?)\s*\)", _rep_strf, s, flags=re.I)
    # 2) INSERT OR IGNORE INTO ... → INSERT INTO ... ON CONFLICT DO NOTHING
    if re.search(r'INSERT\s+OR\s+IGNORE\s+INTO', s, re.I):
        s = re.sub(r'INSERT\s+OR\s+IGNORE\s+INTO', 'INSERT INTO', s, count=1, flags=re.I)
        s_strip = s.rstrip().rstrip(';').rstrip()
        if 'ON CONFLICT' not in s_strip.upper():
            s = s_strip + ' ON CONFLICT DO NOTHING'
    # 3) AUTOINCREMENT (DDL) → SERIAL
    if 'AUTOINCREMENT' in s.upper():
        s = re.sub(r'INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT', 'SERIAL PRIMARY KEY', s, flags=re.I)
        s = re.sub(r'\s+AUTOINCREMENT', '', s, flags=re.I)
    # 4) placeholders ? → %s  (as queries SQLite deste sistema não têm % literal)
    s = s.replace('?', '%s')
    return s

class _CursorCompat:
    """Imita sqlite3.Cursor: execute() encadeável + rows por nome (RealDictRow)."""
    def __init__(self, raw):
        self._c = raw
    def execute(self, sql, params=None):
        s = _traduzir_sql_pg(sql)
        if params is None:
            self._c.execute(s)
        else:
            # Escapa % literais (de LIKE) que não são placeholders %s.
            # psycopg2 interpreta % como placeholder; precisamos %% para % literal.
            if '%' in s:
                # Protege os %s reais, escapa o resto, restaura %s
                s = s.replace('%s', '\x00PLACEHOLDER\x00')
                s = s.replace('%', '%%')
                s = s.replace('\x00PLACEHOLDER\x00', '%s')
            self._c.execute(s, params)
        return self
    def fetchone(self):  return _row_sqlite_like(self._c.fetchone())
    def fetchall(self):  return [_row_sqlite_like(r) for r in self._c.fetchall()]
    def fetchmany(self, size=None):
        rows = self._c.fetchmany(size) if size is not None else self._c.fetchmany()
        return [_row_sqlite_like(r) for r in rows]
    @property
    def description(self): return self._c.description
    @property
    def rowcount(self):    return self._c.rowcount
    @property
    def lastrowid(self):   return None  # Postgres: ver _last_insert_id()
    def close(self):
        try: self._c.close()
        except Exception: pass
    def __iter__(self):
        for r in self._c:
            yield _row_sqlite_like(r)

class _ConnCompat:
    """Imita sqlite3.Connection sobre uma conexão psycopg2."""
    def __init__(self, raw):
        self._conn = raw
    def _novo_cursor(self):
        return _CursorCompat(self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor))
    def execute(self, sql, params=None):
        return self._novo_cursor().execute(sql, params)
    def executescript(self, script):
        cur = self._conn.cursor()
        cur.execute(_traduzir_sql_pg(script))
        cur.close()
        return self
    def cursor(self):
        return self._novo_cursor()
    def commit(self):   self._conn.commit()
    def rollback(self):
        try: self._conn.rollback()
        except Exception: pass
    def close(self):
        try: self._conn.close()
        except Exception: pass
    @property
    def raw(self): return self._conn

def db():
    """Conexão ao banco. PostgreSQL (Railway, persiste entre deploys) ou SQLite.
    Sem pool: cada chamada abre uma conexão nova e curta — robusto e sem
    'connection pool exhausted'. Em Postgres devolve o wrapper de compatibilidade."""
    if DB_MODE == 'postgres':
        try:
            url = _build_pg_url(os.environ['DATABASE_URL'])
            raw = psycopg2.connect(url)
            raw.autocommit = False
            return _ConnCompat(raw)
        except Exception as e:
            import traceback
            print(f"\n🔴🔴🔴 [DB] FALLBACK SQLITE! Postgres falhou: {e}")
            print(f"[DB] Traceback:\n{traceback.format_exc()}")
            print(f"[DB] SQLite path: {DB}")
            return _sqlite_conn()
    return _sqlite_conn()

def _sqlite_conn():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn

def close_db(conn):
    """Fecha a conexão (cada requisição abre/fecha a sua — sem pool)."""
    try:
        if hasattr(conn, '_conn'):
            conn._conn.close()
        else:
            conn.close()
    except Exception:
        pass

def _last_insert_id(cur):
    """Emula cur.lastrowid. Em Postgres usa lastval() (sequência da sessão atual)."""
    if DB_MODE == 'postgres':
        try:
            cur.execute("SELECT lastval() AS id")
            return cur.fetchone()['id']
        except Exception:
            return None
    return cur.lastrowid

def init_db():
    conn = db()
    is_pg = DB_MODE == 'postgres'
    
    if is_pg:
        # PostgreSQL: CREATE TABLE um por um
        cur = conn.cursor()
        tables_sql = [
            """CREATE TABLE IF NOT EXISTS usuarios (
                id SERIAL PRIMARY KEY,
                nome TEXT NOT NULL, email TEXT UNIQUE NOT NULL, senha_hash TEXT,
                token_setup TEXT, token_expira TIMESTAMP,
                perfil TEXT DEFAULT 'consultor',
                regime_base TEXT DEFAULT 'sem_lead_sem_fixo',
                ativo INTEGER DEFAULT 1, valor_fixo REAL DEFAULT 0, chave_pix TEXT, foto TEXT,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS supervisoras (
                id SERIAL PRIMARY KEY,
                nome TEXT NOT NULL, email TEXT, telefone TEXT,
                ativo INTEGER DEFAULT 1, criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS regimes (
                id SERIAL PRIMARY KEY,
                codigo TEXT UNIQUE NOT NULL, nome TEXT NOT NULL, descricao TEXT,
                valor_fixo REAL DEFAULT 0, num_parcelas INTEGER DEFAULT 1,
                distribuicao_parcelas TEXT DEFAULT '100',
                faixa_min REAL, faixa_max REAL,
                coluna_comissao TEXT, ordem INTEGER DEFAULT 0
            )""",
            """CREATE TABLE IF NOT EXISTS comissoes (
                id SERIAL PRIMARY KEY,
                operadora TEXT UNIQUE NOT NULL,
                perc_total REAL DEFAULT 2.0, perc_sem_leads REAL DEFAULT 0.5,
                perc_n1 REAL DEFAULT 0.9, perc_n2 REAL DEFAULT 1.1, perc_n3 REAL DEFAULT 1.3,
                perc_com_fixo REAL DEFAULT 1.3, dist_corretora TEXT DEFAULT '100', observacao TEXT
            )""",
            """CREATE TABLE IF NOT EXISTS propostas (
                id SERIAL PRIMARY KEY,
                usuario_id INTEGER NOT NULL, consultor TEXT NOT NULL, supervisora_id INTEGER,
                proposta_tem_numero TEXT, numero_proposta TEXT, vigencia TEXT NOT NULL,
                modalidade TEXT NOT NULL, tipo_pessoa TEXT,
                adm_operadora TEXT, produto TEXT, razao_social TEXT NOT NULL,
                titular_dependentes TEXT, tipo_contrato TEXT NOT NULL,
                acomodacao TEXT NOT NULL, fator_moderador TEXT NOT NULL,
                total_vidas INTEGER NOT NULL, valor REAL NOT NULL,
                dia_comissao TEXT, venda_status TEXT DEFAULT 'Sim', elegivel_campanha TEXT,
                vencimento_1 TEXT, previsao_1 TEXT,
                resp_contrato TEXT, email_resp_contrato TEXT, tel_resp_contrato TEXT,
                resp_negociacao TEXT, email_resp_negociacao TEXT, tel_resp_negociacao TEXT,
                contatos_adicionais TEXT, desc_contatos_adicionais TEXT,
                regime_aplicado TEXT, num_parcelas INTEGER DEFAULT 1,
                distribuicao_parcelas TEXT DEFAULT '100',
                comissao_total_corretora REAL, comissao_consultor REAL, comissao_corretora_liquida REAL,
                observacoes TEXT, anexos TEXT, status TEXT DEFAULT 'Ativo',
                cpf_titular TEXT, cnpj TEXT, contrato_arquivo TEXT, comprovante_boleto TEXT,
                campos_extras TEXT, quem_subiu TEXT, operadora_obs TEXT, dia_vencimento INTEGER,
                estornada INTEGER DEFAULT 0, estorno_info TEXT,
                data_nasc_titular TEXT, dependentes_json TEXT, tem_repique INTEGER DEFAULT 0,
                repique_json TEXT, fase TEXT DEFAULT 'Proposta cadastrada', produto_id INTEGER,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS parcelas (
                id SERIAL PRIMARY KEY,
                proposta_id INTEGER NOT NULL,
                numero INTEGER NOT NULL,
                percentual REAL NOT NULL DEFAULT 100,
                valor REAL NOT NULL,
                data_prevista TEXT,
                status TEXT DEFAULT 'Pendente de receber',
                comprovante_antecipacao TEXT,
                data_pagamento TEXT,
                aceite_corretor INTEGER DEFAULT 0,
                data_aceite TEXT,
                confirmado_gestor INTEGER DEFAULT 0,
                data_confirmacao_gestor TEXT,
                valor_corretora REAL DEFAULT 0,
                perc_cliente REAL DEFAULT 100,
                competencia TEXT, mensalidade_ref INTEGER, ok_entrada INTEGER DEFAULT 0,
                tipo_origem TEXT DEFAULT 'comissao',
                FOREIGN KEY(proposta_id) REFERENCES propostas(id)
            )""",
            """CREATE TABLE IF NOT EXISTS campos_custom (
                id SERIAL PRIMARY KEY,
                label TEXT NOT NULL,
                nome_tecnico TEXT UNIQUE NOT NULL,
                tipo TEXT NOT NULL DEFAULT 'text',
                opcoes TEXT,
                placeholder TEXT,
                ajuda TEXT,
                obrigatorio INTEGER DEFAULT 0,
                ativo INTEGER DEFAULT 1,
                ordem INTEGER DEFAULT 0,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS webhook_log (
                id SERIAL PRIMARY KEY,
                evento_id TEXT UNIQUE,
                evento TEXT,
                processado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS niveis (
                codigo TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                faixa_min REAL DEFAULT 0,
                faixa_max REAL,
                ordem INTEGER DEFAULT 0
            )""",
            """CREATE TABLE IF NOT EXISTS repasses (
                id SERIAL PRIMARY KEY,
                modelo TEXT NOT NULL,
                nivel TEXT DEFAULT '',
                tipo_plano TEXT NOT NULL,
                percentual REAL DEFAULT 0,
                eh_taxa_adesao INTEGER DEFAULT 0,
                UNIQUE(modelo, nivel, tipo_plano)
            )""",
            """CREATE TABLE IF NOT EXISTS lancamentos (
                id SERIAL PRIMARY KEY,
                tipo TEXT NOT NULL,
                categoria TEXT,
                descricao TEXT NOT NULL,
                valor REAL NOT NULL,
                data_competencia TEXT,
                data_lancamento TEXT,
                recorrente INTEGER DEFAULT 0,
                socio TEXT,
                usuario_id INTEGER,
                status TEXT DEFAULT 'Previsto',
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS regras_estorno (
                id SERIAL PRIMARY KEY,
                operadora TEXT UNIQUE NOT NULL,
                perc_estorno REAL DEFAULT 100,
                ate_mensalidade INTEGER DEFAULT 3,
                observacao TEXT
            )""",
            """CREATE TABLE IF NOT EXISTS config (
                chave TEXT PRIMARY KEY,
                valor TEXT
            )""",
            """CREATE TABLE IF NOT EXISTS etiquetas (
                id SERIAL PRIMARY KEY,
                nome TEXT UNIQUE NOT NULL,
                cor TEXT DEFAULT '#1fd8a4'
            )""",
            """CREATE TABLE IF NOT EXISTS proposta_etiquetas (
                proposta_id INTEGER,
                etiqueta_id INTEGER,
                UNIQUE(proposta_id, etiqueta_id)
            )""",
            """CREATE TABLE IF NOT EXISTS produtos (
                id SERIAL PRIMARY KEY,
                operadora TEXT NOT NULL,
                nome TEXT NOT NULL,
                tipo_plano TEXT,
                acomodacao TEXT,
                coparticipacao TEXT,
                observacao TEXT,
                ativo INTEGER DEFAULT 1
            )""",
            """CREATE TABLE IF NOT EXISTS historico_proposta (
                id SERIAL PRIMARY KEY,
                proposta_id INTEGER NOT NULL,
                usuario_nome TEXT,
                campo TEXT,
                valor_antes TEXT,
                valor_depois TEXT,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS solicitacoes_edicao (
                id SERIAL PRIMARY KEY,
                proposta_id INTEGER NOT NULL,
                usuario_id INTEGER NOT NULL,
                usuario_nome TEXT,
                alteracoes TEXT,
                status TEXT DEFAULT 'Pendente',
                motivo_recusa TEXT,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                resolvido_em TIMESTAMP,
                resolvido_por TEXT
            )""",
            """CREATE TABLE IF NOT EXISTS operadoras (
                id SERIAL PRIMARY KEY,
                operadora TEXT UNIQUE NOT NULL,
                obs TEXT DEFAULT '',
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS recebimento (
                id SERIAL PRIMARY KEY,
                operadora TEXT NOT NULL, obs TEXT DEFAULT '', plano TEXT NOT NULL,
                total REAL DEFAULT 0,
                UNIQUE(operadora, obs, plano)
            )""",
            """CREATE TABLE IF NOT EXISTS repasse_corretor (
                id SERIAL PRIMARY KEY,
                operadora TEXT NOT NULL, obs TEXT DEFAULT '', plano TEXT NOT NULL,
                modelo TEXT NOT NULL, nivel TEXT DEFAULT '',
                total REAL DEFAULT 0, regua TEXT DEFAULT '', taxa INTEGER DEFAULT 0,
                UNIQUE(operadora, obs, plano, modelo, nivel)
            )""",
            # ─── CRM ─────────────────────────────────────
            """CREATE TABLE IF NOT EXISTS crm_leads (
                id SERIAL PRIMARY KEY,
                nome TEXT NOT NULL,
                telefone TEXT,
                email TEXT,
                empresa TEXT,
                origem TEXT DEFAULT 'manual',
                etapa TEXT DEFAULT 'topo',
                responsavel_id INTEGER,
                proposta_id INTEGER,
                valor_estimado REAL,
                observacoes TEXT,
                dados_extras TEXT,
                perdido_motivo TEXT,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS crm_atividades (
                id SERIAL PRIMARY KEY,
                lead_id INTEGER NOT NULL,
                usuario_nome TEXT,
                tipo TEXT DEFAULT 'nota',
                descricao TEXT,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS crm_etapas (
                id SERIAL PRIMARY KEY,
                slug TEXT UNIQUE NOT NULL,
                nome TEXT NOT NULL,
                cor TEXT DEFAULT '#3b82f6',
                ordem INTEGER DEFAULT 0,
                tipo TEXT DEFAULT 'normal',
                ativo INTEGER DEFAULT 1
            )""",
            """CREATE TABLE IF NOT EXISTS cotacao_tabela (
                id SERIAL PRIMARY KEY,
                operadora TEXT NOT NULL, plano TEXT NOT NULL,
                modalidade TEXT DEFAULT 'PME', acomodacao TEXT DEFAULT 'Enfermaria',
                coparticipacao TEXT DEFAULT 'Sem', linha TEXT DEFAULT '', tipo_cnpj TEXT DEFAULT '',
                abrangencia TEXT DEFAULT '',
                vigencia TEXT DEFAULT '', ativo INTEGER DEFAULT 1,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS cotacao_preco (
                id SERIAL PRIMARY KEY,
                tabela_id INTEGER NOT NULL,
                faixa TEXT NOT NULL, preco REAL DEFAULT 0
            )""",
            """CREATE TABLE IF NOT EXISTS cotacao_salva (
                id SERIAL PRIMARY KEY,
                token TEXT, orientacao TEXT DEFAULT 'horizontal', lead_id INTEGER,
                corretor_id INTEGER, corretor_nome TEXT, corretor_email TEXT, corretor_telefone TEXT,
                cliente_nome TEXT, cliente_email TEXT, cliente_telefone TEXT,
                titulo TEXT, vidas_json TEXT, planos_json TEXT, total REAL DEFAULT 0,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS operadora_logo (
                id SERIAL PRIMARY KEY,
                operadora TEXT NOT NULL, arquivo TEXT NOT NULL,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS material_apoio (
                id SERIAL PRIMARY KEY,
                operadora TEXT, tipo TEXT, titulo TEXT NOT NULL, descricao TEXT, conteudo TEXT, arquivo TEXT,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS cotacao_legenda_modelo (
                id SERIAL PRIMARY KEY,
                nome TEXT NOT NULL,
                corpo TEXT NOT NULL,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )""",
            """CREATE TABLE IF NOT EXISTS notificacoes (
                id SERIAL PRIMARY KEY,
                usuario_id INTEGER,
                tipo TEXT,
                titulo TEXT NOT NULL,
                descricao TEXT,
                link TEXT,
                lida INTEGER DEFAULT 0,
                criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )""",
        ]
        for sql in tables_sql:
            try:
                cur.execute(sql)
            except Exception as e:
                app.logger.error(f"[INIT_DB] Erro SQL: {e}")
        conn.commit()
        
        # GARANTIR que recebimento existe
        try:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS recebimento (
                    id SERIAL PRIMARY KEY,
                    operadora TEXT NOT NULL, obs TEXT DEFAULT '', plano TEXT NOT NULL,
                    total REAL DEFAULT 0,
                    UNIQUE(operadora, obs, plano)
                )
            """)
            conn.commit()
            app.logger.info("[INIT_DB] ✅ Tabela recebimento garantida")
        except Exception as e:
            app.logger.error(f"[INIT_DB] Erro ao criar recebimento: {e}")
    else:
        # SQLite: usar executescript
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL, email TEXT UNIQUE NOT NULL, senha_hash TEXT,
            token_setup TEXT, token_expira TIMESTAMP,
            perfil TEXT DEFAULT 'consultor',
            regime_base TEXT DEFAULT 'sem_lead_sem_fixo',
            ativo INTEGER DEFAULT 1,
            valor_fixo REAL DEFAULT 0, chave_pix TEXT, foto TEXT,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS supervisoras (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL, email TEXT, telefone TEXT,
            ativo INTEGER DEFAULT 1, criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS regimes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            codigo TEXT UNIQUE NOT NULL, nome TEXT NOT NULL, descricao TEXT,
            valor_fixo REAL DEFAULT 0, num_parcelas INTEGER DEFAULT 1,
            distribuicao_parcelas TEXT DEFAULT '100',
            faixa_min REAL, faixa_max REAL,
            coluna_comissao TEXT, ordem INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS comissoes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operadora TEXT UNIQUE NOT NULL,
            perc_total REAL DEFAULT 2.0, perc_sem_leads REAL DEFAULT 0.5,
            perc_n1 REAL DEFAULT 0.9, perc_n2 REAL DEFAULT 1.1, perc_n3 REAL DEFAULT 1.3,
            perc_com_fixo REAL DEFAULT 1.3, dist_corretora TEXT DEFAULT '100', observacao TEXT
        );
        CREATE TABLE IF NOT EXISTS propostas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER NOT NULL, consultor TEXT NOT NULL, supervisora_id INTEGER,
            proposta_tem_numero TEXT, numero_proposta TEXT, vigencia TEXT NOT NULL,
            modalidade TEXT NOT NULL, tipo_pessoa TEXT,
            adm_operadora TEXT, produto TEXT, razao_social TEXT NOT NULL,
            titular_dependentes TEXT, tipo_contrato TEXT NOT NULL,
            acomodacao TEXT NOT NULL, fator_moderador TEXT NOT NULL,
            total_vidas INTEGER NOT NULL, valor REAL NOT NULL,
            dia_comissao TEXT, venda_status TEXT DEFAULT 'Sim', elegivel_campanha TEXT,
            vencimento_1 TEXT, previsao_1 TEXT,
            resp_contrato TEXT, email_resp_contrato TEXT, tel_resp_contrato TEXT,
            resp_negociacao TEXT, email_resp_negociacao TEXT, tel_resp_negociacao TEXT,
            contatos_adicionais TEXT, desc_contatos_adicionais TEXT,
            regime_aplicado TEXT, num_parcelas INTEGER DEFAULT 1,
            distribuicao_parcelas TEXT DEFAULT '100',
            comissao_total_corretora REAL, comissao_consultor REAL, comissao_corretora_liquida REAL,
            observacoes TEXT, anexos TEXT, status TEXT DEFAULT 'Ativo',
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS parcelas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            proposta_id INTEGER NOT NULL,
            numero INTEGER NOT NULL,
            percentual REAL NOT NULL DEFAULT 100,
            valor REAL NOT NULL,
            data_prevista TEXT,
            status TEXT DEFAULT 'Pendente de receber',
            comprovante_antecipacao TEXT,
            data_pagamento TEXT,
            aceite_corretor INTEGER DEFAULT 0,
            data_aceite TEXT,
            confirmado_gestor INTEGER DEFAULT 0,
            data_confirmacao_gestor TEXT,
            FOREIGN KEY(proposta_id) REFERENCES propostas(id)
        );
        CREATE TABLE IF NOT EXISTS campos_custom (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            label TEXT NOT NULL,
            nome_tecnico TEXT UNIQUE NOT NULL,
            tipo TEXT NOT NULL DEFAULT 'text',
            opcoes TEXT,
            placeholder TEXT,
            ajuda TEXT,
            obrigatorio INTEGER DEFAULT 0,
            ativo INTEGER DEFAULT 1,
            ordem INTEGER DEFAULT 0,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS niveis (
            codigo TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            faixa_min REAL DEFAULT 0,
            faixa_max REAL,
            ordem INTEGER DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS repasses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            modelo TEXT NOT NULL,
            nivel TEXT DEFAULT '',
            tipo_plano TEXT NOT NULL,
            percentual REAL DEFAULT 0,
            eh_taxa_adesao INTEGER DEFAULT 0,
            UNIQUE(modelo, nivel, tipo_plano)
        );
        CREATE TABLE IF NOT EXISTS lancamentos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tipo TEXT NOT NULL,
            categoria TEXT,
            descricao TEXT NOT NULL,
            valor REAL NOT NULL,
            data_competencia TEXT,
            data_lancamento TEXT,
            recorrente INTEGER DEFAULT 0,
            socio TEXT,
            usuario_id INTEGER,
            status TEXT DEFAULT 'Previsto',
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS regras_estorno (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operadora TEXT UNIQUE NOT NULL,
            perc_estorno REAL DEFAULT 100,
            ate_mensalidade INTEGER DEFAULT 3,
            observacao TEXT
        );
        CREATE TABLE IF NOT EXISTS config (
            chave TEXT PRIMARY KEY,
            valor TEXT
        );
        CREATE TABLE IF NOT EXISTS etiquetas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT UNIQUE NOT NULL,
            cor TEXT DEFAULT '#1fd8a4'
        );
        CREATE TABLE IF NOT EXISTS proposta_etiquetas (
            proposta_id INTEGER,
            etiqueta_id INTEGER,
            UNIQUE(proposta_id, etiqueta_id)
        );
        CREATE TABLE IF NOT EXISTS produtos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operadora TEXT NOT NULL,
            nome TEXT NOT NULL,
            tipo_plano TEXT,
            acomodacao TEXT,
            coparticipacao TEXT,
            observacao TEXT,
            ativo INTEGER DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS historico_proposta (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            proposta_id INTEGER NOT NULL,
            usuario_nome TEXT,
            campo TEXT,
            valor_antes TEXT,
            valor_depois TEXT,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS recebimento (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operadora TEXT NOT NULL, obs TEXT DEFAULT '', plano TEXT NOT NULL,
            total REAL DEFAULT 0,
            UNIQUE(operadora, obs, plano)
        );
        CREATE TABLE IF NOT EXISTS repasse_corretor (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operadora TEXT NOT NULL, obs TEXT DEFAULT '', plano TEXT NOT NULL,
            modelo TEXT NOT NULL, nivel TEXT DEFAULT '',
            total REAL DEFAULT 0, regua TEXT DEFAULT '', taxa INTEGER DEFAULT 0,
            UNIQUE(operadora, obs, plano, modelo, nivel)
        );
        CREATE TABLE IF NOT EXISTS crm_leads (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            telefone TEXT,
            email TEXT,
            empresa TEXT,
            origem TEXT DEFAULT 'manual',
            etapa TEXT DEFAULT 'topo',
            responsavel_id INTEGER,
            proposta_id INTEGER,
            valor_estimado REAL,
            observacoes TEXT,
            dados_extras TEXT,
            perdido_motivo TEXT,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            atualizado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS crm_atividades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lead_id INTEGER NOT NULL,
            usuario_nome TEXT,
            tipo TEXT DEFAULT 'nota',
            descricao TEXT,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS crm_etapas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT UNIQUE NOT NULL,
            nome TEXT NOT NULL,
            cor TEXT DEFAULT '#3b82f6',
            ordem INTEGER DEFAULT 0,
            tipo TEXT DEFAULT 'normal',
            ativo INTEGER DEFAULT 1
        );
        CREATE TABLE IF NOT EXISTS webhook_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            evento_id TEXT UNIQUE,
            evento TEXT,
            processado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS cotacao_tabela (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operadora TEXT NOT NULL, plano TEXT NOT NULL,
            modalidade TEXT DEFAULT 'PME', acomodacao TEXT DEFAULT 'Enfermaria',
            coparticipacao TEXT DEFAULT 'Sem', linha TEXT DEFAULT '', tipo_cnpj TEXT DEFAULT '',
            abrangencia TEXT DEFAULT '',
            vigencia TEXT DEFAULT '', ativo INTEGER DEFAULT 1,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS cotacao_preco (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tabela_id INTEGER NOT NULL,
            faixa TEXT NOT NULL, preco REAL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS cotacao_salva (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT, orientacao TEXT DEFAULT 'horizontal', lead_id INTEGER,
            corretor_id INTEGER, corretor_nome TEXT, corretor_email TEXT, corretor_telefone TEXT,
            cliente_nome TEXT, cliente_email TEXT, cliente_telefone TEXT,
            titulo TEXT, vidas_json TEXT, planos_json TEXT, total REAL DEFAULT 0,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS operadora_logo (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operadora TEXT NOT NULL, arquivo TEXT NOT NULL,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS material_apoio (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operadora TEXT, tipo TEXT, titulo TEXT NOT NULL, descricao TEXT, conteudo TEXT, arquivo TEXT,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS cotacao_legenda_modelo (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nome TEXT NOT NULL,
            corpo TEXT NOT NULL,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS notificacoes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER,
            tipo TEXT,
            titulo TEXT NOT NULL,
            descricao TEXT,
            link TEXT,
            lida INTEGER DEFAULT 0,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS solicitacoes_edicao (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            proposta_id INTEGER NOT NULL,
            usuario_id INTEGER NOT NULL,
            usuario_nome TEXT,
            alteracoes TEXT,
            status TEXT DEFAULT 'Pendente',
            motivo_recusa TEXT,
            criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            resolvido_em TIMESTAMP,
            resolvido_por TEXT
        );
        """)
    
    # ─── MIGRAÇÕES: adicionar colunas novas se não existirem ───
    def add_col(tabela, coluna, tipo):
        if is_pg:
            try:
                conn.cursor().execute(f"ALTER TABLE {tabela} ADD COLUMN {coluna} {tipo}")
                conn.commit()
            except: pass
        else:
            try: conn.execute(f"ALTER TABLE {tabela} ADD COLUMN {coluna} {tipo}")
            except sqlite3.OperationalError: pass
    
    # Colunas que ja estao nas tabelas acima, então não precisa add_col
    # (tudo já tá no CREATE TABLE IF NOT EXISTS)
    
    # Insert config — compatível com SQLite e Postgres
    if is_pg:
        cur = conn.cursor()
        cur.execute("INSERT INTO config (chave,valor) VALUES (%s,%s) ON CONFLICT (chave) DO NOTHING", 
            ('affinity_destinatarios', 'pamela.lima@affinitycorretora.com.br, kaique.silva@affinitycorretora.com.br, equipe.pl@affinitycorretora.com.br'))
        cur.execute("INSERT INTO config (chave,valor) VALUES (%s,%s) ON CONFLICT (chave) DO NOTHING",
            ('affinity_contato', 'Pamela'))
        cur.execute("INSERT INTO config (chave,valor) VALUES (%s,%s) ON CONFLICT (chave) DO NOTHING",
            ('affinity_remetente', 'guilherme@serenuscorretora.com.br'))
        conn.commit()
    else:
        conn.execute("INSERT OR IGNORE INTO config (chave,valor) VALUES (?,?)", 
            ('affinity_destinatarios', 'pamela.lima@affinitycorretora.com.br, kaique.silva@affinitycorretora.com.br, equipe.pl@affinitycorretora.com.br'))
        conn.execute("INSERT OR IGNORE INTO config (chave,valor) VALUES (?,?)",
            ('affinity_contato', 'Pamela'))
        conn.execute("INSERT OR IGNORE INTO config (chave,valor) VALUES (?,?)",
            ('affinity_remetente', 'guilherme@serenuscorretora.com.br'))
    
    # Etiquetas padrão
    etq_default = [('Renovação','#3b82f6'),('Reajuste','#fb923c'),('Pós-venda','#1fd8a4'),
                   ('Campanha','#8b5cf6'),('Atenção estorno','#f43f7c'),('Indicação','#facc15')]
    if is_pg:
        cur = conn.cursor()
        for nome, cor in etq_default:
            cur.execute("INSERT INTO etiquetas (nome,cor) VALUES (%s,%s) ON CONFLICT (nome) DO NOTHING", (nome, cor))
        conn.commit()
    else:
        for nome, cor in etq_default:
            conn.execute("INSERT OR IGNORE INTO etiquetas (nome,cor) VALUES (?,?)", (nome, cor))

    # Etapas do funil CRM padrão (só insere se a tabela estiver vazia — preserva customizações)
    etapas_default = [
        ('lead_novo', 'Lead Novo',      '#6366f1', 0, 'normal'),
        ('topo',    'Topo do Funil',  '#3b82f6', 1, 'normal'),
        ('meio',    'Meio do Funil',  '#f59e0b', 2, 'normal'),
        ('fim',     'Fundo do Funil', '#10b981', 3, 'normal'),
        ('ganho',   'Ganho',          '#1fd8a4', 4, 'ganho'),
        ('perdido', 'Perdido',        '#ef4444', 5, 'perdido'),
    ]
    try:
        ja_tem = conn.execute("SELECT COUNT(*) c FROM crm_etapas").fetchone()['c']
    except Exception:
        ja_tem = 0
    if not ja_tem:
        if is_pg:
            cur = conn.cursor()
            for slug, nome, cor, ordem, tipo in etapas_default:
                cur.execute("INSERT INTO crm_etapas (slug,nome,cor,ordem,tipo) VALUES (%s,%s,%s,%s,%s) ON CONFLICT (slug) DO NOTHING",
                            (slug, nome, cor, ordem, tipo))
            conn.commit()
        else:
            for slug, nome, cor, ordem, tipo in etapas_default:
                conn.execute("INSERT OR IGNORE INTO crm_etapas (slug,nome,cor,ordem,tipo) VALUES (?,?,?,?,?)",
                             (slug, nome, cor, ordem, tipo))
            conn.commit()
    else:
        # Garante que lead_novo existe mesmo em bancos já populados
        try:
            if is_pg:
                conn.execute("INSERT INTO crm_etapas (slug,nome,cor,ordem,tipo) VALUES ('lead_novo','Lead Novo','#6366f1',0,'normal') ON CONFLICT (slug) DO NOTHING")
            else:
                conn.execute("INSERT OR IGNORE INTO crm_etapas (slug,nome,cor,ordem,tipo) VALUES ('lead_novo','Lead Novo','#6366f1',0,'normal')")
            conn.commit()
        except Exception:
            pass

    
    # Regimes padrão
    regimes_default = [
        ('sem_lead_sem_fixo','Sem Lead e Sem Fixo','Corretor autônomo. Comissão variável, paga à vista.',
         0.0, 1, '100', None, None, 'perc_sem_leads', 1),
        ('lead_n1','Com Lead (Sem Fixo) — N1','Recebe leads. Produção: R$ 0 a R$ 3.000.',
         0.0, 2, '60;40', 0.0, 3000.0, 'perc_n1', 2),
        ('lead_n2','Com Lead (Sem Fixo) — N2','Recebe leads. Produção: R$ 3.001 a R$ 7.000.',
         0.0, 3, '50;30;20', 3000.01, 7000.0, 'perc_n2', 3),
        ('lead_n3','Com Lead (Sem Fixo) — N3','Recebe leads. Produção: R$ 7.001 em diante.',
         0.0, 4, '40;25;20;15', 7000.01, None, 'perc_n3', 4),
        ('com_fixo_lead','Com Fixo + Com Lead','Salário fixo R$ 1.000 + leads + comissão variável.',
         1000.0, 4, '25;25;25;25', None, None, 'perc_com_fixo', 5),
    ]
    for r in regimes_default:
        conn.execute("""INSERT OR IGNORE INTO regimes
            (codigo,nome,descricao,valor_fixo,num_parcelas,distribuicao_parcelas,faixa_min,faixa_max,coluna_comissao,ordem)
            VALUES (?,?,?,?,?,?,?,?,?,?)""", r)
    
    # Admin padrão
    admin = conn.execute("SELECT id FROM usuarios WHERE email='guilherme@serenuscorretora.com.br'").fetchone()
    if not admin:
        from werkzeug.security import generate_password_hash as _gph
        conn.execute("""INSERT INTO usuarios (nome,email,senha_hash,perfil,regime_base)
            VALUES (?,?,?,?,?)""",
            ('Guilherme Santos','guilherme@serenuscorretora.com.br',_gph("serenus2025", method='pbkdf2:sha256', salt_length=16),'admin','com_fixo_lead'))
    
    # Comissões padrão
    com_default = [
        ("SulAmérica",2.8,0.7,1.2,1.5,1.8,1.8,"100;100;80"),("Porto Seguro",2.8,0.7,1.2,1.5,1.8,1.8,"100;100;80"),
        ("Porto",2.4,0.6,1.08,1.32,1.56,1.56,"100;100;40"),("Amil",2.8,0.7,1.2,1.5,1.8,1.8,"100;100;80"),
        ("Bradesco",3.3,0.8,1.5,1.8,2.1,2.1,"100;100;80;50"),("MedSênior",1.7,0.45,0.8,1.0,1.1,1.1,"100;50;20"),
        ("Vera Cruz",1.6,0.4,0.7,0.9,1.0,1.0,"100;60"),("Hapvida",2.3,0.575,1.035,1.265,1.495,1.495,"100;80;50"),
        ("Unimed Jundiaí",3.0,0.75,1.35,1.65,1.95,1.95,"100;100;100"),("Unimed Sorocaba",2.4,0.6,1.08,1.32,1.56,1.56,"100;100;40"),
        ("Santa Helena",2.4,0.6,1.08,1.32,1.56,1.56,"100;100;40"),("Santa Tereza",1.5,0.375,0.675,0.825,0.975,0.975,"100;50"),
        ("Sobam",2.4,0.6,1.08,1.32,1.56,1.56,"100;100;40"),("Beneficência",1.0,0.25,0.45,0.55,0.65,0.65,"100"),
        ("Affix",1.5,0.375,0.675,0.825,0.975,0.975,"100;50"),("Qualicorp",3.0,0.75,1.35,1.65,1.95,1.95,"100;100;100"),
        ("Allcare",1.6,0.4,0.72,0.88,1.04,1.04,"100;60"),("Amhemed",2.0,0.5,0.9,1.1,1.3,1.3,"100;100"),
        ("Ana Costa",2.4,0.6,1.08,1.32,1.56,1.56,"100;100;40"),("Supermed",2.8,0.7,1.2,1.5,1.8,1.8,"100;100;80"),
        ("EVA",1.6,0.4,0.7,0.9,1.0,1.0,"100;60"),("Lancers",1.6,0.4,0.7,0.9,1.0,1.0,"100;60"),
    ]
    for c in com_default:
        conn.execute("""INSERT OR IGNORE INTO comissoes
            (operadora,perc_total,perc_sem_leads,perc_n1,perc_n2,perc_n3,perc_com_fixo,dist_corretora) VALUES (?,?,?,?,?,?,?,?)""", c)
    
    # Níveis padrão
    niveis_default = [
        ('n1','N1', 0.0, 3000.0, 1),
        ('n2','N2', 3000.01, 7000.0, 2),
        ('n3','N3', 7000.01, None, 3),
    ]
    for n in niveis_default:
        conn.execute("INSERT OR IGNORE INTO niveis (codigo,label,faixa_min,faixa_max,ordem) VALUES (?,?,?,?,?)", n)
    
    # Seed de comissões (se arquivo existe)
    ja_tem = conn.execute("SELECT COUNT(*) as c FROM recebimento").fetchone()
    if ja_tem and ja_tem[0] == 0 if isinstance(ja_tem, tuple) else ja_tem['c'] == 0:
        seed_path = os.path.join(BASE_DIR, "seed_comissoes.json")
        if os.path.exists(seed_path):
            seed = json.load(open(seed_path, encoding='utf-8'))
            for r in seed.get('recebimento', []):
                conn.execute("""INSERT OR IGNORE INTO recebimento (operadora,obs,plano,total)
                    VALUES (?,?,?,?)""", (r['operadora'], r.get('obs',''), r['plano'], r.get('total') or 0))
            for r in seed.get('repasse', []):
                regua = ';'.join(str(x) for x in r.get('regua', []))
                conn.execute("""INSERT OR IGNORE INTO repasse_corretor
                    (operadora,obs,plano,modelo,nivel,total,regua,taxa) VALUES (?,?,?,?,?,?,?,?)""",
                    (r['operadora'], r.get('obs',''), r['plano'], r['modelo'], r.get('nivel',''),
                     r.get('total') or 0, regua, r.get('taxa', 0)))
    
    conn.commit()
    if is_pg:
        conn.cursor().close()

    # ─── MIGRAÇÕES: adiciona colunas novas em tabelas existentes ─────────
    migracoes = [
        ("propostas", "estornada", "INTEGER DEFAULT 0"),
        ("propostas", "estorno_info", "TEXT"),
        ("propostas", "cpf_titular", "TEXT"),
        ("propostas", "cnpj", "TEXT"),
        ("propostas", "contrato_arquivo", "TEXT"),
        ("propostas", "comprovante_boleto", "TEXT"),
        ("propostas", "campos_extras", "TEXT"),
        ("propostas", "quem_subiu", "TEXT"),
        ("propostas", "operadora_obs", "TEXT"),
        ("propostas", "dia_vencimento", "INTEGER"),
        ("propostas", "data_nasc_titular", "TEXT"),
        ("propostas", "dependentes_json", "TEXT"),
        ("propostas", "tem_repique", "INTEGER DEFAULT 0"),
        ("propostas", "repique_json", "TEXT"),
        ("propostas", "fase", "TEXT DEFAULT 'Proposta cadastrada'"),
        ("propostas", "produto_id", "INTEGER"),
        ("parcelas", "competencia", "TEXT"),
        ("parcelas", "mensalidade_ref", "INTEGER"),
        ("parcelas", "ok_entrada", "INTEGER DEFAULT 0"),
        ("parcelas", "tipo_origem", "TEXT DEFAULT 'comissao'"),
        ("parcelas", "confirmado_gestor", "INTEGER DEFAULT 0"),
        ("parcelas", "data_confirmacao_gestor", "TEXT"),
        ("parcelas", "valor_corretora", "REAL DEFAULT 0"),
        ("parcelas", "perc_cliente", "REAL DEFAULT 100"),
        ("usuarios", "valor_fixo", "REAL DEFAULT 0"),
        ("usuarios", "chave_pix", "TEXT"),
        ("parcelas", "asaas_transfer_id", "TEXT"),
        ("parcelas", "asaas_status", "TEXT"),
        ("parcelas", "asaas_erro", "TEXT"),
        ("usuarios", "foto", "TEXT"),
        # Novos campos v15
        ("usuarios", "cpf", "TEXT"),
        ("usuarios", "reset_code", "TEXT"),
        ("usuarios", "reset_expira", "TEXT"),
        # ─── FASE 1: ERP Backoffice ───
        ("propostas", "status_operacional", "TEXT DEFAULT 'Aguardando Documentos'"),
        ("propostas", "mes_meta", "TEXT"),
        ("propostas", "pendencias_json", "TEXT"),
        ("propostas", "motivo_exclusao", "TEXT"),
        ("propostas", "detalhe_exclusao", "TEXT"),
        ("historico_proposta", "usuario_id", "INTEGER"),
        ("historico_proposta", "tipo", "TEXT DEFAULT 'edicao'"),
        ("historico_proposta", "descricao", "TEXT"),
        # ─── CRM: WhatsApp WaSpeed + filtros ───
        ("usuarios", "waspeed_token", "TEXT"),
        ("crm_leads", "telefone_norm", "TEXT"),
        ("crm_leads", "consultor_externo", "TEXT"),  # nome original da planilha
        # ─── Boleto de Adesão via Asaas ───
        ("propostas", "adesao_asaas_customer_id", "TEXT"),
        ("propostas", "adesao_asaas_payment_id", "TEXT"),
        ("propostas", "adesao_boleto_url", "TEXT"),
        ("propostas", "adesao_linha_digitavel", "TEXT"),
        ("propostas", "adesao_valor", "REAL"),
        ("propostas", "adesao_vencimento", "TEXT"),
        ("propostas", "adesao_status", "TEXT DEFAULT 'Não gerado'"),
        # Novas colunas do boleto
        ("propostas", "adesao_descricao", "TEXT"),         # descrição editável do boleto
        ("propostas", "adesao_boleto_pdf", "TEXT"),        # arquivo PDF do boleto salvo localmente
        # Endereço do beneficiário (para NF no Asaas)
        ("propostas", "end_logradouro", "TEXT"),
        ("propostas", "end_numero", "TEXT"),
        ("propostas", "end_complemento", "TEXT"),
        ("propostas", "end_bairro", "TEXT"),
        ("propostas", "end_cidade", "TEXT"),
        ("propostas", "end_estado", "TEXT"),
        ("propostas", "end_cep", "TEXT"),
        # Cotação: link público imutável, orientação e vínculo com lead do CRM
        ("cotacao_salva", "token", "TEXT"),
        ("cotacao_salva", "orientacao", "TEXT"),
        ("cotacao_salva", "lead_id", "INTEGER"),
        ("material_apoio", "tipo", "TEXT"),
        ("material_apoio", "conteudo", "TEXT"),
        ("cotacao_salva", "aberturas", "INTEGER"),
        ("cotacao_salva", "ultima_abertura", "TEXT"),
        ("cotacao_tabela", "linha", "TEXT"),
        ("cotacao_tabela", "tipo_cnpj", "TEXT"),
        ("cotacao_salva", "tabela_ids_json", "TEXT"),
    ]

    for tabela, coluna, tipo in migracoes:
        try:
            ddl = f"ALTER TABLE {tabela} ADD COLUMN {'IF NOT EXISTS ' if is_pg else ''}{coluna} {tipo}"
            conn.execute(ddl)
            if is_pg:
                conn.commit()
        except Exception:
            if is_pg:
                try: conn.rollback()
                except Exception: pass
            # SQLite: coluna já existe → ignora
    if not is_pg:
        conn.commit()

    # ─── ÍNDICES: aceleram as queries mais frequentes (seguro, não altera dados) ───
    indices = [
        "CREATE INDEX IF NOT EXISTS idx_propostas_usuario ON propostas(usuario_id)",
        "CREATE INDEX IF NOT EXISTS idx_propostas_status ON propostas(status)",
        "CREATE INDEX IF NOT EXISTS idx_propostas_criado ON propostas(criado_em)",
        "CREATE INDEX IF NOT EXISTS idx_parcelas_proposta ON parcelas(proposta_id)",
        "CREATE INDEX IF NOT EXISTS idx_parcelas_status ON parcelas(status)",
        "CREATE INDEX IF NOT EXISTS idx_historico_proposta ON historico_proposta(proposta_id)",
        "CREATE INDEX IF NOT EXISTS idx_solic_proposta ON solicitacoes_edicao(proposta_id)",
        "CREATE INDEX IF NOT EXISTS idx_solic_status ON solicitacoes_edicao(status)",
        "CREATE INDEX IF NOT EXISTS idx_recebimento_op ON recebimento(operadora, plano)",
        "CREATE INDEX IF NOT EXISTS idx_repasse_op ON repasse_corretor(operadora, plano, modelo, nivel)",
        "CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email)",
        "CREATE INDEX IF NOT EXISTS idx_parcelas_competencia ON parcelas(competencia)",
    ]
    for idx in indices:
        try:
            conn.execute(idx)
            if is_pg: conn.commit()
        except Exception:
            if is_pg:
                try: conn.rollback()
                except Exception: pass
    if not is_pg:
        conn.commit()

    close_db(conn)



# ─── ESTRUTURA DO FLUXO SEMANAL AUTOMÁTICO ──────────────────────────────────
FLUXO_SEMANAL = {
    'coleta': {
        'id': 'coleta',
        'nome': 'Coleta de Propostas',
        'desc': 'Período de coleta: consultores subem propostas',
        'dias_semana': 'quinta a terça',
        'acao': 'Propostas são registradas',
        'cor': 'info',
        'ordem': 1,
    },
    'analise': {
        'id': 'analise',
        'nome': 'Análise & Aprovação',
        'desc': 'Admin analisa e aprova propostas',
        'dias_semana': 'quarta-feira',
        'acao': 'Comissões são calculadas',
        'cor': 'azul',
        'ordem': 2,
    },
    'pagamento': {
        'id': 'pagamento',
        'nome': 'Pagamento & Repasse',
        'desc': 'Processamento de repasses consultores',
        'dias_semana': 'sexta-feira seguinte',
        'acao': 'Repasses realizados',
        'cor': 'verde',
        'ordem': 3,
    }
}

def detectar_fase_atual():
    """Detecta automaticamente qual fase estamos: coleta, analise ou pagamento.
    Thu→Tue = Coleta | Quarta = Análise | Sexta = Pagamento
    """
    dia = date.today().weekday()  # 0=seg,1=ter,2=qua,3=qui,4=sex,5=sab,6=dom
    if dia == 2: return 'analise'    # Quarta
    if dia == 4: return 'pagamento'  # Sexta
    return 'coleta'  # Qui, Sab, Dom, Seg, Ter

def ciclo_atual():
    """
    Ciclo semanal: começa na QUINTA-FEIRA e vai até TERÇA-FEIRA seguinte (coleta).
    Quarta = Análise. Próxima Quinta = Liberação. Próxima Sexta = Pagamento.
    """
    hoje = date.today()
    dia = hoje.weekday()  # 0=seg,1=ter,2=qua,3=qui,4=sex,5=sab,6=dom
    # Volta até a quinta mais recente (inclusive hoje se for quinta)
    dias_desde_quinta = (dia - 3) % 7
    inicio_ciclo = hoje - timedelta(days=dias_desde_quinta)
    # Fim coleta = terça (6 dias após a quinta)
    fim_ciclo = inicio_ciclo + timedelta(days=6)
    # Liberação = próxima quinta (7 dias após início)
    liberacao = inicio_ciclo + timedelta(days=7)
    # Pagamento = sexta após liberação
    pagamento = liberacao + timedelta(days=1)

    DIAS_PT = ['Segunda','Terça','Quarta','Quinta','Sexta','Sábado','Domingo']
    return {
        'inicio':      inicio_ciclo.strftime('%d/%m/%Y'),
        'fim':         fim_ciclo.strftime('%d/%m/%Y'),
        'liberacao':   liberacao.strftime('%d/%m/%Y'),
        'liberacao_dia': DIAS_PT[liberacao.weekday()],
        'pagamento':   pagamento.strftime('%d/%m/%Y'),
        'pagamento_dia': DIAS_PT[pagamento.weekday()],
        'fase_atual':  detectar_fase_atual(),
        'inicio_iso':  inicio_ciclo.isoformat(),
        'fim_iso':     fim_ciclo.isoformat(),
    }

# ─── CÁLCULO DE COMISSÃO ─────────────────────────────────────────────────────────
# ─── HELPERS DO MOTOR DE CÁLCULO ────────────────────────────────────────────────
REGIME_TO_MODELO = {
    'sem_lead_sem_fixo': 'sem_lead_sem_fixo',
    'com_fixo_sem_lead': 'sem_lead_com_fixo',   # nome no repasse_corretor
    'com_lead': 'com_lead',
    'com_lead_sem_fixo': 'com_lead',
    'n1': 'com_lead', 'n2': 'com_lead', 'n3': 'com_lead',
    'com_fixo_lead': 'com_fixo_lead',
}

def _plano_from_modalidade(modalidade, tipo_pessoa=''):
    """Mapeia a modalidade/tipo da proposta para o plano da tabela: PME / PF / ADESAO."""
    s = ((modalidade or '') + ' ' + (tipo_pessoa or '')).upper()
    if 'ADES' in s:
        return 'ADESAO'
    if ' PF' in (' ' + s) or 'PESSOA F' in s or 'INDIVID' in s or 'FAMILIAR' in s or s.strip() == 'PF':
        return 'PF'
    return 'PME'  # PME, Coletivo, Empresarial, Porte N → PME

def _split_operadora(operadora):
    """'Affix · Hapvida' -> ('Affix', 'Hapvida'). Sem separador -> (nome, '')."""
    op = (operadora or '').strip()
    for sep in (' · ', ' - ', '·', ' / '):
        if sep in op:
            a, b = op.split(sep, 1)
            return a.strip(), b.strip()
    return op, ''

def _nivel_por_producao(prod, conn):
    """Determina o nível (n1/n2/n3) pela produção acumulada, respeitando a tabela niveis."""
    try:
        niveis = conn.execute("SELECT codigo,faixa_min,faixa_max FROM niveis ORDER BY ordem").fetchall()
    except Exception:
        niveis = []
    for nv in niveis:
        mn = float(nv['faixa_min'] or 0)
        mx = nv['faixa_max']
        if prod >= mn and (mx is None or prod <= float(mx)):
            return nv['codigo']
    # fallback fixo
    if prod <= 3000: return 'n1'
    if prod <= 7000: return 'n2'
    return 'n3'


def _producao_mes(conn, usuario_id, criado_em, excluir_pid=None):
    """Soma a produção (valor) do consultor no mês de criado_em, exceto a própria proposta.
    Usa range de datas — compatível com PostgreSQL (timestamp) e SQLite (texto).
    Evita substr()/to_char() que diferem entre os bancos."""
    ma = str(criado_em or '')[:7]  # 'YYYY-MM'
    if len(ma) != 7:
        return 0
    try:
        ini = ma + '-01'
        ano, mes = int(ma[:4]), int(ma[5:7])
        fim = f"{ano+1}-01-01" if mes == 12 else f"{ano}-{mes+1:02d}-01"
        if excluir_pid is not None:
            r = conn.execute("""SELECT COALESCE(SUM(valor),0) v FROM propostas
                WHERE usuario_id=? AND criado_em>=? AND criado_em<? AND id<>?""",
                (usuario_id, ini, fim, excluir_pid)).fetchone()
        else:
            r = conn.execute("""SELECT COALESCE(SUM(valor),0) v FROM propostas
                WHERE usuario_id=? AND criado_em>=? AND criado_em<?""",
                (usuario_id, ini, fim)).fetchone()
        return r['v'] if r else 0
    except Exception:
        if DB_MODE == 'postgres':
            try: conn.rollback()
            except Exception: pass
        return 0


def calc_comissao(operadora, regime_base, prod_acumulada, valor_venda, modalidade='', tipo_pessoa=''):
    """Motor de comissão isolando a regra da Taxa de Adesão."""
    conn = db()
    valor = float(valor_venda or 0)
    op_nome, op_obs = _split_operadora(operadora)
    plano = _plano_from_modalidade(modalidade, tipo_pessoa)

    # 1) Recebimento da corretora (mensalidades / resíduo)
    receb = conn.execute(
        "SELECT total FROM recebimento WHERE operadora=? AND obs=? AND plano=?",
        (op_nome, op_obs, plano)).fetchone()
    if not receb:
        receb = conn.execute(
            "SELECT total FROM recebimento WHERE operadora=? AND plano=? ORDER BY (obs='') DESC LIMIT 1",
            (op_nome, plano)).fetchone()
    receb_mens = float(receb['total']) if receb else 0.0
    total_corretora = round(valor * receb_mens, 2)

    # GESTOR VENDEDOR: leva 100% da corretora
    if regime_base == 'gestor_vendedor':
        close_db(conn)
        regua = [receb_mens] if receb_mens else [1.0]
        return {
            'codigo': 'gestor_vendedor', 'modelo': 'gestor_vendedor', 'nivel': '', 'plano': plano,
            'num_parcelas': 1, 'dist_corretora': str(receb_mens or 1.0),
            'regua_mens': regua, 'receb_mens': receb_mens, 'rep_mens': receb_mens, 'taxa': 0,
            'valor': valor, 'total_corretora': total_corretora,
            'consultor': total_corretora, 'liquido': 0.0,
            'aviso': ''
        }

    # 2) Modelo + nível
    modelo = REGIME_TO_MODELO.get(regime_base, 'sem_lead_sem_fixo')
    nivel = ''
    if modelo == 'com_lead':
        nivel = regime_base if regime_base in ('n1', 'n2', 'n3') else _nivel_por_producao(prod_acumulada, conn)

    # 3) Repasse ao corretor
    rep = conn.execute(
        "SELECT total,regua,taxa FROM repasse_corretor WHERE operadora=? AND obs=? AND plano=? AND modelo=? AND nivel=?",
        (op_nome, op_obs, plano, modelo, nivel)).fetchone()
    if not rep:
        rep = conn.execute(
            "SELECT total,regua,taxa FROM repasse_corretor WHERE operadora=? AND plano=? AND modelo=? AND nivel=? ORDER BY (obs='') DESC LIMIT 1",
            (op_nome, plano, modelo, nivel)).fetchone()
            
    rep_mens = float(rep['total']) if rep else 0.0
    regua_str = (rep['regua'] if rep and rep['regua'] else '') or ''
    taxa = int(rep['taxa']) if rep and rep['taxa'] is not None else 0

    # ==========================================
    # --- RAMO ISOLADO: ADESÃO ---
    # ==========================================
    if plano == 'ADESAO':
        # Na Adesão, a corretora recolhe a taxa. O consultor ganha um % apenas sobre essa 1ª mensalidade.
        consultor = round(valor * rep_mens, 2)
        # O líquido da corretora = Total de recebíveis da operadora - O que foi pago de taxa pro consultor
        liquido = round(total_corretora - consultor, 2)
        close_db(conn)
        
        avisos = []
        if receb_mens == 0: avisos.append(f"Falta RECEBIMENTO: {op_nome} / ADESAO")
        if rep_mens == 0: avisos.append(f"Falta REPASSE: {op_nome} / ADESAO / {MODELO_NOME.get(modelo, modelo)}")
        
        return {
            'codigo': nivel or modelo, 'modelo': modelo, 'nivel': nivel, 'plano': plano,
            'num_parcelas': 1, 'dist_corretora': '100',
            'regua_mens': [rep_mens] if rep_mens else [0.0], 'receb_mens': receb_mens, 'rep_mens': rep_mens, 'taxa': 1,
            'valor': valor, 'total_corretora': total_corretora,
            'consultor': consultor, 'liquido': liquido,
            'aviso': ' · '.join(avisos),
        }

    # ==========================================
    # --- RAMO PADRÃO: PME / PF ---
    # ==========================================
    consultor = round(valor * rep_mens, 2)
    liquido = round(total_corretora - consultor, 2)

    regua = [float(x) for x in regua_str.split(';') if x.strip()]
    if not regua:
        regua = [rep_mens] if rep_mens else [0.0]

    close_db(conn)
    avisos = []
    if receb_mens == 0:
        avisos.append(f"Falta RECEBIMENTO: {op_nome} / {plano}")
    if rep_mens == 0:
        avisos.append(f"Falta REPASSE: {op_nome} / {plano} / {MODELO_NOME.get(modelo, modelo)}{(' / ' + nivel.upper()) if nivel else ''}")

    return {
        'codigo': nivel or modelo, 'modelo': modelo, 'nivel': nivel, 'plano': plano,
        'num_parcelas': len(regua), 'dist_corretora': regua_str or ';'.join(str(x) for x in regua),
        'regua_mens': regua, 'receb_mens': receb_mens, 'rep_mens': rep_mens, 'taxa': taxa,
        'valor': valor, 'total_corretora': total_corretora,
        'consultor': consultor, 'liquido': liquido,
        'aviso': ' · '.join(avisos),
    }


def gerar_parcelas(proposta_id, vigencia, c, dia_vencimento=None, status_override=None):
    """Gera parcelas usando a régua REAL (mensalidades por parcela).
    Parcela consultor i = valor × regua[i]. Corretora distribuída proporcional à régua.
    status_override: força um status fixo em todas as parcelas (ex: 'Bloqueado - Falta Comprovante')."""
    from dateutil.relativedelta import relativedelta
    try:
        base = datetime.strptime(vigencia[:7], '%Y-%m') if (vigencia and len(vigencia) >= 7) else datetime.now(TZ_SP).replace(day=1)
    except Exception:
        base = datetime.now(TZ_SP).replace(day=1)

    dia = int(dia_vencimento) if dia_vencimento else base.day
    regua = c.get('regua_mens') or [float(x) for x in (c.get('dist_corretora','') or '').split(';') if x.strip()] or [1.0]
    valor = float(c.get('valor', 0))
    total_cor = float(c.get('total_corretora', 0))
    soma_regua = sum(regua) or 1.0

    parcelas = []
    for i, mens in enumerate(regua):
        mes_ref = base + relativedelta(months=i)
        try:
            data = mes_ref.replace(day=min(dia, 28)).strftime('%Y-%m-%d')
        except Exception:
            data = mes_ref.strftime('%Y-%m-01')
        val_c = round(valor * mens, 2)
        val_cor = round(total_cor * (mens / soma_regua), 2)
        perc = round((mens / soma_regua) * 100, 2)
        parcelas.append({
            'proposta_id': proposta_id, 'numero': i + 1, 'percentual': perc,
            'valor': val_c, 'valor_corretora': val_cor, 'perc_cliente': perc,
            'data_prevista': data,
            'status': status_override if status_override else 'Pendente de receber',
            'competencia': mes_ref.strftime('%Y-%m'), 'mensalidade_ref': i + 1,
        })
    return parcelas



# ─── AUTH ────────────────────────────────────────────────────────────────────────
# Hash de senha: PBKDF2-SHA256 com salt (via Werkzeug). Mantém retrocompatibilidade
# com senhas antigas em SHA-256 puro — essas são migradas no próximo login.
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename

def _sanitizar_filename(nome):
    """Remove espaços, acentos e caracteres especiais do nome do arquivo.
    Mantém extensão. Ex: 'WhatsApp Image 2026.jpeg' → 'WhatsApp_Image_2026.jpeg'"""
    import unicodedata, re as _re
    # Normaliza unicode (remove acentos)
    nome = unicodedata.normalize('NFD', nome)
    nome = ''.join(c for c in nome if unicodedata.category(c) != 'Mn')
    # Substitui espaços e caracteres problemáticos por _
    nome = _re.sub(r'[\s\(\)\[\]]+', '_', nome)
    nome = _re.sub(r'[^\w\.\-]', '', nome)
    nome = _re.sub(r'_+', '_', nome).strip('_')
    return nome or 'arquivo'

def hash_senha(s):
    """Gera hash seguro PBKDF2 (com salt automático) para uma senha nova."""
    return generate_password_hash(s or '', method='pbkdf2:sha256', salt_length=16)

def _parse_dt_seguro(valor):
    """Converte um valor de data/hora para datetime, aceitando:
    - datetime já pronto (PostgreSQL retorna assim)
    - string ISO (SQLite retorna assim)
    Retorna None se vazio ou inválido."""
    if not valor:
        return None
    if isinstance(valor, datetime):
        return valor
    try:
        return datetime.fromisoformat(str(valor))
    except Exception:
        try:
            return datetime.strptime(str(valor)[:19], '%Y-%m-%d %H:%M:%S')
        except Exception:
            return None

def _data_expirada(valor):
    """True se a data/hora informada já passou. Trata datetime (PG) e string (SQLite),
    e lida com timezone de forma segura (sem erro de naive vs aware)."""
    expira = _parse_dt_seguro(valor)
    if not expira:
        return False
    agora = datetime.now(TZ_SP)
    try:
        if expira.tzinfo is None:
            agora = agora.replace(tzinfo=None)
        return expira < agora
    except Exception:
        return False

def _eh_sha256_legado(h):
    """Detecta o formato antigo: SHA-256 puro = 64 caracteres hexadecimais."""
    return isinstance(h, str) and len(h) == 64 and all(c in '0123456789abcdef' for c in h.lower())

def verifica_senha(senha_digitada, hash_armazenado):
    """Verifica senha aceitando tanto o formato novo (PBKDF2) quanto o antigo (SHA-256).
    Retorna (ok: bool, precisa_migrar: bool)."""
    if not hash_armazenado:
        return False, False
    if _eh_sha256_legado(hash_armazenado):
        # Formato antigo — compara SHA-256 puro
        ok = hashlib.sha256((senha_digitada or '').encode()).hexdigest() == hash_armazenado
        return ok, ok  # se acertou, sinaliza para migrar
    # Formato novo — PBKDF2
    try:
        return check_password_hash(hash_armazenado, senha_digitada or ''), False
    except Exception:
        return False, False


# ════════════════════════════════════════════════════════════════════════════
# SEGURANÇA: Decorators robusto + Sanitização + Logging
# ════════════════════════════════════════════════════════════════════════════

def require_auth(f):
    """Valida autenticação. Retorna JSON 401 (não redirect)."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        user_id = session.get('user_id')
        perfil = session.get('perfil')
        if not user_id or perfil not in ('admin', 'consultor', 'supervisor'):
            app.logger.warning(f"[AUTH] Acesso não autenticado a {request.endpoint}")
            return jsonify({'erro': 'Não autenticado', 'codigo': 'AUTH_REQUIRED'}), 401
        return f(*args, **kwargs)
    return wrapper

def require_admin(f):
    """Permite apenas admin. Retorna 403 se não autorizado."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        user_id = session.get('user_id')
        perfil = session.get('perfil')
        if not user_id or perfil != 'admin':
            app.logger.warning(f"[AUTH] Negado (não-admin) em {request.endpoint} por user_id={user_id}")
            return jsonify({'erro': 'Acesso negado', 'codigo': 'FORBIDDEN'}), 403
        return f(*args, **kwargs)
    return wrapper

def sanitize_string(s, max_length=255):
    """Valida entrada: deve ser string, não vazia, tamanho <= max_length."""
    if not isinstance(s, str):
        return None
    s = s.strip()
    return s if len(s) > 0 and len(s) <= max_length else None

def error_json(mensagem, codigo=None, status=400):
    """Retorna erro padronizado (nunca expõe detalhes internos)."""
    return jsonify({
        'erro': mensagem,
        'codigo': codigo or 'ERRO_DESCONHECIDO'
    }), status


def login_required(f):
    @wraps(f)
    def w(*a, **kw):
        if 'user_id' not in session: return redirect(url_for('login'))
        return f(*a, **kw)
    return w

def admin_required(f):
    @wraps(f)
    def w(*a, **kw):
        if session.get('perfil') != 'admin': return redirect(url_for('dashboard'))
        return f(*a, **kw)
    return w

# ─── INTEGRAÇÃO ASAAS (pagamentos PIX para consultores) ──────────────────────────
import requests as _requests

# CORREÇÃO 21.06.2026: o cifrão ($) FAZ PARTE da chave do Asaas (formato $aact_prod_...).
# Removê-lo invalida a chave (erro invalid_access_token / 401). Confirmado via teste ao vivo:
# COM $ → 200 OK; SEM $ → 401. Então só limpamos espaços e aspas, NUNCA o cifrão.
ASAAS_API_KEY = (os.environ.get('ASAAS_API_KEY', '') or '').strip().strip('"').strip("'")
# Detecta sandbox vs produção pelo prefixo (com ou sem o cifrão na frente)
if 'aact_prod' in ASAAS_API_KEY[:15]:
    ASAAS_BASE_URL = 'https://api.asaas.com/v3'
else:
    ASAAS_BASE_URL = os.environ.get('ASAAS_BASE_URL', 'https://api-sandbox.asaas.com/v3')

# Token de autenticação do webhook Asaas (opcional, configurado na interface do Asaas)
ASAAS_WEBHOOK_TOKEN = os.environ.get('ASAAS_WEBHOOK_TOKEN', '')

def asaas_configurado():
    return bool(ASAAS_API_KEY)

def asaas_request(method, path, payload=None):
    """Wrapper para chamadas à API do Asaas. Nunca loga a chave."""
    if not asaas_configurado():
        return {"_erro": "ASAAS_API_KEY não configurada no ambiente"}, 0
    url = f"{ASAAS_BASE_URL}{path}"
    headers = {
        "Content-Type": "application/json",
        "access_token": ASAAS_API_KEY,
        "User-Agent": "JOB-Serenus/1.0",
    }
    try:
        r = _requests.request(method, url, headers=headers, json=payload, timeout=20)
        try:
            data = r.json()
        except Exception:
            data = {"_erro": "Resposta inválida do Asaas", "_raw": r.text[:300]}
        return data, r.status_code
    except _requests.exceptions.RequestException as e:
        return {"_erro": f"Falha de conexão: {e}"}, 0


def asaas_detectar_tipo_chave(chave):
    """Detecta o tipo da chave PIX pelo formato (RFC 3986)."""
    chave = (chave or '').strip()
    if not chave:
        return None
    apenas_digitos = re.sub(r'\D', '', chave)
    
    # EMAIL: contém @
    if '@' in chave:
        return 'EMAIL'
    # CPF: exatamente 11 dígitos
    if len(apenas_digitos) == 11:
        return 'CPF'
    # CNPJ: exatamente 14 dígitos
    if len(apenas_digitos) == 14:
        return 'CNPJ'
    # PHONE: começa com +55 ou +, com 10-11 dígitos
    if chave.startswith('+55') or (len(apenas_digitos) in (10, 11) and chave.startswith('+')):
        return 'PHONE'
    # EVP: UUID format (36 chars: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
    if len(chave) == 36 and re.match(r'^[a-f0-9\-]+$', chave, re.IGNORECASE):
        return 'EVP'
    # fallback: assume EVP (chave aleatória) se não bate com nenhum padrão
    return 'EVP'


# ─── CLOUDFLARE R2 — UPLOAD/DOWNLOAD DE ARQUIVOS ──────────────────────────────────

def upload_arquivo_r2(file_obj, chave_arquivo):
    """
    Upload arquivo com PRIORIDADE LOCAL (volume persistente Railway).
    Salva em /data/anexos PRIMEIRO (nunca perde).
    Depois tenta R2 como redundância/backup (opcional).
    Retorna {'ok': True, 'chave': ..., 'storage': 'local'|'r2'} sempre.
    """
    import io

    # Lê todos os bytes UMA vez
    if hasattr(file_obj, 'read'):
        try:
            file_obj.seek(0)
        except Exception:
            pass
        dados = file_obj.read()
    else:
        dados = file_obj

    # PRIORIDADE 1: SALVA LOCAL (/data/anexos — volume persistente)
    try:
        destino = os.path.join(UPLOAD_FOLDER, os.path.basename(chave_arquivo))
        os.makedirs(os.path.dirname(destino), exist_ok=True)
        with open(destino, 'wb') as fp:
            fp.write(dados)
        app.logger.info(f"[LOCAL] ✅ {destino} (volume persistente)")
        
        # PRIORIDADE 2: Tenta R2 como REDUNDÂNCIA (não é crítico se falhar)
        if os.environ.get('R2_ENABLED') == 'true':
            try:
                import boto3
                account_id = os.environ.get('R2_ACCOUNT_ID', '').strip()
                access_key = os.environ.get('R2_ACCESS_KEY', '').strip()
                secret_key = os.environ.get('R2_SECRET_KEY', '').strip()
                bucket     = os.environ.get('R2_BUCKET_NAME', '').strip()

                if account_id and access_key and secret_key and bucket:
                    s3 = boto3.client(
                        's3',
                        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
                        aws_access_key_id=access_key,
                        aws_secret_access_key=secret_key,
                        region_name='auto'
                    )
                    s3.upload_fileobj(io.BytesIO(dados), bucket, chave_arquivo)
                    app.logger.info(f"[R2] ✅ Backup: {chave_arquivo}")
            except Exception as e:
                app.logger.warning(f"[R2] ⚠️ Backup falhou (não é crítico): {type(e).__name__}: {e}")
        
        return {'ok': True, 'chave': chave_arquivo, 'storage': 'local'}
    except Exception as e:
        app.logger.error(f"[LOCAL] ❌ Erro crítico ao salvar: {e}")
        return {'ok': False, 'erro': str(e), 'storage': 'none'}

def gerar_url_r2(chave_arquivo, expiracao_segundos=86400):
    """Gera URL pré-assinada para download do R2 (válida por 24h). Fallback local."""
    if os.environ.get('R2_ENABLED') == 'true':
        try:
            import boto3
            account_id = os.environ.get('R2_ACCOUNT_ID', '').strip()
            access_key = os.environ.get('R2_ACCESS_KEY', '').strip()
            secret_key = os.environ.get('R2_SECRET_KEY', '').strip()
            bucket     = os.environ.get('R2_BUCKET_NAME', '').strip()
            
            if account_id and access_key and secret_key and bucket:
                s3 = boto3.client(
                    's3',
                    endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
                    aws_access_key_id=access_key,
                    aws_secret_access_key=secret_key,
                    region_name='auto'
                )
                url = s3.generate_presigned_url(
                    'get_object',
                    Params={'Bucket': bucket, 'Key': chave_arquivo},
                    ExpiresIn=expiracao_segundos
                )
                return url
        except Exception as e:
            app.logger.warning(f"[R2] Erro gerar URL: {e}")
    
    # Fallback local
    return f"/download/{os.path.basename(chave_arquivo)}"


@app.route('/admin/asaas/teste')
@login_required
@admin_required
def asaas_teste():
    """Testa a conexão com o Asaas (somente leitura - consulta saldo)."""
    if not asaas_configurado():
        return jsonify({"ok": False, "erro": "ASAAS_API_KEY não está configurada nas variáveis de ambiente do Railway."}), 400
    data, status = asaas_request('GET', '/finance/balance')
    if status == 200:
        return jsonify({"ok": True, "saldo": data.get('balance'), "ambiente": "produção" if "api.asaas.com" in ASAAS_BASE_URL else "sandbox"})
    return jsonify({"ok": False, "erro": data.get('_erro') or data.get('errors') or data, "status": status}), 400


@app.route('/admin/db/corrigir-operadoras', methods=['GET', 'POST'])
@login_required
@admin_required
def corrigir_operadoras():
    """Corrige propostas com adm_operadora NULL extraindo a operadora da modalidade.
    GET = simula (mostra o que faria). POST = aplica e recalcula a comissão."""
    aplicar = request.method == 'POST'
    conn = db()

    # Operadoras conhecidas (do recebimento) para casar com o texto da modalidade
    ops_rows = conn.execute("SELECT DISTINCT operadora FROM recebimento").fetchall()
    operadoras = [r['operadora'] for r in ops_rows]

    # Propostas com operadora vazia mas com modalidade preenchida
    alvo = conn.execute("""SELECT * FROM propostas
        WHERE (adm_operadora IS NULL OR adm_operadora='')
        AND modalidade IS NOT NULL AND modalidade<>''
        AND status NOT IN ('Excluída')""").fetchall()

    plano_de = []
    nao_resolvidas = []
    for p in alvo:
        modalidade = p['modalidade'] or ''
        # Tenta achar uma operadora conhecida dentro do texto da modalidade
        achou = None
        modal_norm = _normaliza_op(modalidade)
        for op in operadoras:
            op_norm = _normaliza_op(op)
            if op_norm and (op_norm in modal_norm or modal_norm.startswith(op_norm)):
                # pega o match mais longo (mais específico)
                if not achou or len(op_norm) > len(_normaliza_op(achou)):
                    achou = op
        if achou:
            plano_de.append({'id': p['id'], 'cliente': p['razao_social'],
                             'modalidade_atual': modalidade, 'operadora_detectada': achou})
        else:
            nao_resolvidas.append({'id': p['id'], 'cliente': p['razao_social'], 'modalidade': modalidade})

    resultado = {
        "modo": "APLICADO" if aplicar else "SIMULAÇÃO (nada alterado)",
        "vao_corrigir": plano_de,
        "nao_resolvidas": nao_resolvidas,
        "total_corrigir": len(plano_de),
    }

    if aplicar and plano_de:
        corrigidas = []
        for item in plano_de:
            pid = item['id']
            nova_op = item['operadora_detectada']
            try:
                # Atualiza a operadora
                conn.execute("UPDATE propostas SET adm_operadora=? WHERE id=?", (nova_op, pid))
                # Recalcula a comissão com a operadora correta
                p = conn.execute("SELECT * FROM propostas WHERE id=?", (pid,)).fetchone()
                u = conn.execute("SELECT regime_base FROM usuarios WHERE id=?", (p['usuario_id'],)).fetchone()
                regime = (u['regime_base'] if u else None) or 'sem_lead_sem_fixo'
                tp = p['tipo_pessoa'] if 'tipo_pessoa' in p.keys() else ''
                # Produção acumulada do mês (igual ao recálculo oficial) para nível correto
                prod_antes = _producao_mes(conn, p['usuario_id'], p['criado_em'], excluir_pid=pid)
                prod_acum = prod_antes + (p['valor'] or 0)
                c = calc_comissao(nova_op, regime, prod_acum, p['valor'] or 0, p['modalidade'], tp)
                conn.execute("""UPDATE propostas SET comissao_total_corretora=?, comissao_consultor=?,
                    comissao_corretora_liquida=?, regime_aplicado=?, num_parcelas=?, distribuicao_parcelas=? WHERE id=?""",
                    (c['total_corretora'], c['consultor'], c['liquido'], c['codigo'],
                     c['num_parcelas'], c['dist_corretora'], pid))
                conn.execute("""INSERT INTO historico_proposta (proposta_id,usuario_id,usuario_nome,campo,valor_antes,valor_depois,criado_em)
                    VALUES (?,?,?,?,?,?,?)""", (pid, session['user_id'], session.get('nome','admin'),
                    'Operadora corrigida', 'NULL', nova_op, datetime.now(TZ_SP)))
                conn.commit()
                corrigidas.append({'id': pid, 'operadora': nova_op,
                                   'comissao_corretora': c['total_corretora'], 'comissao_consultor': c['consultor']})
            except Exception as e:
                if DB_MODE == 'postgres':
                    try: conn.rollback()
                    except Exception: pass
                corrigidas.append({'id': pid, 'erro': str(e)[:100]})
        resultado["corrigidas"] = corrigidas

    close_db(conn)
    return jsonify(resultado)


@app.route('/admin/db/detalhes')
@login_required
@admin_required
def db_detalhes():
    """Mostra QUAIS registros geraram os avisos da validação (sem expor senhas)."""
    conn = db()
    out = {}

    # Usuários ativos sem senha (quem não consegue logar)
    try:
        rows = conn.execute("SELECT id, nome, email, perfil, token_setup IS NOT NULL as tem_token_setup FROM usuarios WHERE (senha_hash IS NULL OR senha_hash='') AND ativo=1").fetchall()
        out["usuarios_sem_senha"] = [dict(r) for r in rows]
    except Exception as e:
        if DB_MODE == 'postgres':
            try: conn.rollback()
            except Exception: pass
        out["usuarios_sem_senha_erro"] = str(e)[:100]

    # Propostas com comissão zerada (operadora/plano sem recebimento)
    try:
        rows = conn.execute("""SELECT id, razao_social, adm_operadora, modalidade, tipo_pessoa, valor, status
            FROM propostas WHERE status NOT IN ('Excluída')
            AND (comissao_total_corretora IS NULL OR comissao_total_corretora=0)
            ORDER BY id""").fetchall()
        out["propostas_comissao_zerada"] = [dict(r) for r in rows]
    except Exception as e:
        if DB_MODE == 'postgres':
            try: conn.rollback()
            except Exception: pass
        out["propostas_comissao_zerada_erro"] = str(e)[:100]

    # Operadoras distintas que existem em recebimento (já que a tabela operadoras está vazia)
    try:
        rows = conn.execute("SELECT DISTINCT operadora FROM recebimento ORDER BY operadora").fetchall()
        out["operadoras_em_recebimento"] = [r['operadora'] for r in rows]
    except Exception as e:
        if DB_MODE == 'postgres':
            try: conn.rollback()
            except Exception: pass
        out["operadoras_erro"] = str(e)[:100]

    close_db(conn)
    return jsonify(out)


@app.route('/admin/db/validar')
@login_required
@admin_required
def db_validar():
    """Validação completa do banco: tabelas, colunas críticas e integridade referencial."""
    TABELAS_ESPERADAS = [
        'usuarios','propostas','parcelas','operadoras','recebimento','repasse_corretor',
        'historico_proposta','solicitacoes_edicao','comissoes','config','crm_leads',
        'crm_atividades','etiquetas','lancamentos','niveis','produtos','proposta_etiquetas',
        'regimes','regras_estorno','repasses','supervisoras','webhook_log','campos_custom',
    ]
    COLUNAS_CRITICAS = {
        'propostas': ['id','usuario_id','razao_social','valor','adm_operadora','status',
                      'comissao_total_corretora','comissao_consultor','comissao_corretora_liquida',
                      'contrato_arquivo','comprovante_boleto','anexos'],
        'usuarios': ['id','email','senha_hash','perfil','ativo'],
        'parcelas': ['id','proposta_id','valor','status'],
        'recebimento': ['operadora','plano','total'],
        'repasse_corretor': ['operadora','plano','modelo','nivel','total','regua','taxa'],
        'solicitacoes_edicao': ['id','proposta_id','usuario_id','alteracoes','status'],
    }

    relatorio = {"modo": DB_MODE, "ok": True, "problemas": [], "avisos": [], "tabelas": {}, "integridade": {}}
    conn = db()

    def _rollback_seguro():
        """Após erro no Postgres, limpa a transação abortada para os próximos checks."""
        if DB_MODE == 'postgres':
            try: conn.rollback()
            except Exception: pass

    # 1) Tabelas existem? + contagem de linhas
    for t in TABELAS_ESPERADAS:
        try:
            n = conn.execute(f"SELECT COUNT(*) c FROM {t}").fetchone()['c']
            relatorio["tabelas"][t] = n
        except Exception:
            _rollback_seguro()
            relatorio["tabelas"][t] = "AUSENTE"
            relatorio["problemas"].append(f"Tabela ausente ou inacessível: {t}")
            relatorio["ok"] = False

    # 2) Colunas críticas presentes?
    for tabela, cols in COLUNAS_CRITICAS.items():
        if relatorio["tabelas"].get(tabela) == "AUSENTE":
            continue
        try:
            if DB_MODE == 'postgres':
                rows = conn.execute(
                    "SELECT column_name FROM information_schema.columns WHERE table_name=%s", (tabela,)).fetchall()
                existentes = {r['column_name'] for r in rows}
            else:
                rows = conn.execute(f"PRAGMA table_info({tabela})").fetchall()
                existentes = {r['name'] for r in rows}
            faltando = [c for c in cols if c not in existentes]
            if faltando:
                relatorio["problemas"].append(f"{tabela}: colunas faltando → {', '.join(faltando)}")
                relatorio["ok"] = False
        except Exception as e:
            _rollback_seguro()
            relatorio["avisos"].append(f"Não foi possível checar colunas de {tabela}: {str(e)[:80]}")

    # 3) Integridade referencial
    try:
        orfas = conn.execute("""SELECT COUNT(*) c FROM parcelas pa
            LEFT JOIN propostas p ON p.id=pa.proposta_id WHERE p.id IS NULL""").fetchone()['c']
        relatorio["integridade"]["parcelas_orfas"] = orfas
        if orfas > 0:
            relatorio["avisos"].append(f"{orfas} parcela(s) apontam para proposta inexistente")
    except Exception as e:
        _rollback_seguro()
        relatorio["avisos"].append(f"Check parcelas órfãs falhou: {str(e)[:80]}")

    try:
        sem_user = conn.execute("""SELECT COUNT(*) c FROM propostas p
            LEFT JOIN usuarios u ON u.id=p.usuario_id WHERE u.id IS NULL""").fetchone()['c']
        relatorio["integridade"]["propostas_sem_usuario"] = sem_user
        if sem_user > 0:
            relatorio["avisos"].append(f"{sem_user} proposta(s) sem usuário válido")
    except Exception as e:
        _rollback_seguro()
        relatorio["avisos"].append(f"Check propostas sem usuário falhou: {str(e)[:80]}")

    # 4) Usuários sem senha (não conseguem logar)
    try:
        sem_senha = conn.execute("SELECT COUNT(*) c FROM usuarios WHERE (senha_hash IS NULL OR senha_hash='') AND ativo=1").fetchone()['c']
        relatorio["integridade"]["usuarios_ativos_sem_senha"] = sem_senha
        if sem_senha > 0:
            relatorio["avisos"].append(f"{sem_senha} usuário(s) ativo(s) sem senha definida")
    except Exception as e:
        _rollback_seguro()
        relatorio["avisos"].append(f"Check usuários sem senha falhou: {str(e)[:80]}")

    # 5) Propostas com comissão zerada (possível erro de cálculo)
    try:
        com_zero = conn.execute("""SELECT COUNT(*) c FROM propostas
            WHERE status NOT IN ('Excluída') AND (comissao_total_corretora IS NULL OR comissao_total_corretora=0)""").fetchone()['c']
        relatorio["integridade"]["propostas_comissao_zerada"] = com_zero
        if com_zero > 0:
            relatorio["avisos"].append(f"{com_zero} proposta(s) ativa(s) com comissão da corretora zerada (verificar cadastro de recebimento)")
    except Exception as e:
        _rollback_seguro()
        relatorio["avisos"].append(f"Check comissão zerada falhou: {str(e)[:80]}")

    close_db(conn)
    relatorio["resumo"] = (
        "Banco íntegro." if relatorio["ok"] and not relatorio["avisos"]
        else ("Estrutura OK, com avisos." if relatorio["ok"] else "PROBLEMAS ESTRUTURAIS encontrados.")
    )
    return jsonify(relatorio)


@app.route('/admin/asaas/diag')
@login_required
@admin_required
def asaas_diag():
    """Diagnóstico do Asaas — mostra o estado da chave SEM expô-la, e o erro real."""
    raw = os.environ.get('ASAAS_API_KEY', '')
    info = {
        "variavel_existe": bool(raw),
        "comprimento": len(raw),
        "comeca_com_cifrao": raw.startswith('$') if raw else False,
        "comeca_com_aspas": (raw.startswith('"') or raw.startswith("'")) if raw else False,
        "prefixo_visivel": (raw[:10] + '...') if len(raw) > 10 else raw,
        "sufixo_visivel": ('...' + raw[-6:]) if len(raw) > 16 else '',
        "tem_espacos_nas_bordas": raw != raw.strip() if raw else False,
        "tem_quebra_de_linha": ('\n' in raw or '\r' in raw) if raw else False,
        "tem_char_nao_ascii": any(ord(c) > 127 for c in raw) if raw else False,
        "chave_processada_prefixo": (ASAAS_API_KEY[:10] + '...') if len(ASAAS_API_KEY) > 10 else ASAAS_API_KEY,
        "chave_processada_sufixo": ('...' + ASAAS_API_KEY[-6:]) if len(ASAAS_API_KEY) > 16 else '',
        "chave_processada_comprimento": len(ASAAS_API_KEY),
        "ambiente_detectado": "produção" if "api.asaas.com" in ASAAS_BASE_URL else "sandbox",
        "base_url": ASAAS_BASE_URL,
    }
    # Testa a conexão de fato
    if asaas_configurado():
        data, status = asaas_request('GET', '/finance/balance')
        info["conexao_status_http"] = status
        if status == 200:
            info["conexao"] = "OK"
            info["saldo"] = data.get('balance')
        else:
            info["conexao"] = "FALHOU"
            info["erro_asaas"] = data.get('_erro') or data.get('errors') or str(data)[:300]
    else:
        info["conexao"] = "chave vazia após processamento"
    return jsonify(info)


@app.route('/admin/asaas/testar-chave', methods=['GET', 'POST'])
@login_required
@admin_required
def asaas_testar_chave():
    """Testa QUALQUER chave Asaas ao vivo, sem precisar salvar variável/deploy.
    Uso: cole a chave no campo e veja na hora se funciona.
    GET mostra o formulário; POST testa a chave enviada."""
    if request.method == 'GET':
        return """
        <html><head><meta charset="utf-8"><title>Testar Chave Asaas</title>
        <style>
            body{font-family:system-ui;max-width:760px;margin:40px auto;padding:0 20px;background:#0f1117;color:#e6e6e6}
            h2{color:#1fd8a4}
            textarea{width:100%;height:120px;padding:12px;font-family:monospace;font-size:13px;
                     border:1px solid #333;border-radius:8px;background:#1a1d27;color:#fff;box-sizing:border-box}
            button{margin-top:12px;padding:12px 28px;background:#1fd8a4;color:#000;border:none;
                   border-radius:8px;font-weight:700;font-size:15px;cursor:pointer}
            button:hover{opacity:.9}
            #resultado{margin-top:24px;padding:16px;border-radius:8px;white-space:pre-wrap;
                       font-family:monospace;font-size:13px;background:#1a1d27;border:1px solid #333;display:none}
            .ok{border-color:#1fd8a4 !important;color:#1fd8a4}
            .erro{border-color:#ff5470 !important;color:#ff5470}
            label{font-size:14px;color:#aaa}
        </style></head><body>
        <h2>Testar Chave Asaas (ao vivo)</h2>
        <p style="color:#aaa">Cole a chave da API do Asaas abaixo (com ou sem o $ na frente) e clique em testar.
        Isto testa direto contra o Asaas <b>sem salvar nada</b> — só pra confirmar se a chave é válida.</p>
        <label>Chave da API:</label>
        <textarea id="chave" placeholder="aact_prod_..."></textarea>
        <button onclick="testar()">Testar agora</button>
        <div id="resultado"></div>
        <script>
        async function testar(){
            const chave = document.getElementById('chave').value.trim();
            const box = document.getElementById('resultado');
            box.style.display='block'; box.className=''; box.textContent='Testando contra o Asaas...';
            try {
                const r = await fetch('/admin/asaas/testar-chave', {
                    method:'POST',
                    headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({chave: chave})
                });
                const d = await r.json();
                box.className = d.valida ? 'ok' : 'erro';
                box.textContent = JSON.stringify(d, null, 2);
            } catch(e){ box.className='erro'; box.textContent='Erro: '+e; }
        }
        </script>
        </body></html>
        """

    # POST: testa a chave enviada — TESTA COM E SEM o cifrão, para descobrir qual o Asaas aceita
    d = request.get_json(silent=True) or {}
    chave_original = (d.get('chave') or '').strip().strip('"').strip("'")

    if not chave_original:
        return jsonify({"valida": False, "erro": "Nenhuma chave informada"})

    def _testa(chave):
        """Testa uma variação da chave contra o Asaas."""
        if not chave:
            return {"valida": False, "erro": "vazia"}
        base = 'https://api.asaas.com/v3' if 'aact_prod' in chave else 'https://api-sandbox.asaas.com/v3'
        headers = {
            "Content-Type": "application/json",
            "access_token": chave,
            "User-Agent": "JOB-Serenus/1.0",
        }
        r_out = {
            "comprimento": len(chave),
            "prefixo": chave[:18] + '...',
            "comeca_com_cifrao": chave.startswith('$'),
        }
        try:
            r = _requests.get(f"{base}/finance/balance", headers=headers, timeout=20)
            r_out["status_http"] = r.status_code
            try:
                body = r.json()
            except Exception:
                body = {"_raw": r.text[:200]}
            if r.status_code == 200:
                r_out["valida"] = True
                r_out["saldo"] = body.get('balance')
            else:
                r_out["valida"] = False
                r_out["erro_asaas"] = body.get('errors') or body
        except Exception as e:
            r_out["valida"] = False
            r_out["erro"] = str(e)[:150]
        return r_out

    # Prepara as duas variações
    chave_sem = chave_original[1:] if chave_original.startswith('$') else chave_original
    chave_com = chave_original if chave_original.startswith('$') else ('$' + chave_original)

    res_sem = _testa(chave_sem)
    res_com = _testa(chave_com)

    valida_geral = res_sem.get('valida') or res_com.get('valida')
    if res_sem.get('valida'):
        msg = "CHAVE VÁLIDA — use ela SEM o cifrão ($) no Railway."
    elif res_com.get('valida'):
        msg = "CHAVE VÁLIDA — use ela COM o cifrão ($) no Railway! (o $ faz parte da chave)"
    else:
        msg = "Ambas as variações falharam. A chave foi revogada/expirada no Asaas, OU a conta tem restrição de IP/segurança ativa."

    return jsonify({
        "valida": valida_geral,
        "mensagem": msg,
        "teste_SEM_cifrao": res_sem,
        "teste_COM_cifrao": res_com,
    })




@app.route('/api/caixa-empresa')
@login_required
@admin_required
def api_caixa_empresa():
    """Consolida dados financeiros da conta Asaas: saldo, extrato e resumo de cobranças.
    Somente leitura. Usado pelo Caixa da Empresa no fluxo de caixa."""
    if not asaas_configurado():
        return jsonify({"ok": False, "erro": "Asaas não configurado. No Railway, a variável ASAAS_API_KEY precisa conter a chave que começa com 'aact_prod_' SEM o cifrão ($) na frente. Edite a variável no painel do serviço e remova o $ inicial."}), 400

    resultado = {"ok": True, "ambiente": "produção" if "api.asaas.com" in ASAAS_BASE_URL else "sandbox"}

    # 1) Saldo atual da conta
    saldo_data, st = asaas_request('GET', '/finance/balance')
    resultado['saldo'] = saldo_data.get('balance', 0) if st == 200 else None
    if st != 200:
        resultado['saldo_erro'] = saldo_data.get('_erro') or saldo_data.get('errors')

    # 2) Extrato financeiro (entradas e saídas) — últimos lançamentos
    #    Filtro opcional por período via query string (?inicio=YYYY-MM-DD&fim=YYYY-MM-DD)
    inicio = request.args.get('inicio', '')
    fim = request.args.get('fim', '')
    q_ext = '/financialTransactions?limit=50&order=desc'
    if inicio: q_ext += f'&startDate={inicio}'
    if fim:    q_ext += f'&finishDate={fim}'
    ext_data, st_ext = asaas_request('GET', q_ext)
    extrato = []
    if st_ext == 200 and isinstance(ext_data.get('data'), list):
        for t in ext_data['data']:
            extrato.append({
                'data': t.get('date', ''),
                'valor': t.get('value', 0),
                'saldo': t.get('balance', 0),
                'tipo': t.get('type', ''),
                'descricao': t.get('description', '') or _traduz_tipo_asaas(t.get('type', '')),
            })
    else:
        resultado['extrato_erro'] = ext_data.get('_erro') or ext_data.get('errors')
    resultado['extrato'] = extrato

    # 3) Resumo de cobranças: total recebido, pendente, vencido
    hoje = datetime.now(TZ_SP).strftime('%Y-%m-%d')
    recebidas, st1 = asaas_request('GET', '/payments?status=RECEIVED&limit=1')
    confirmadas, st2 = asaas_request('GET', '/payments?status=CONFIRMED&limit=1')
    pendentes, st3 = asaas_request('GET', '/payments?status=PENDING&limit=1')
    vencidas, st4 = asaas_request('GET', '/payments?status=OVERDUE&limit=1')
    resultado['cobrancas'] = {
        'recebidas_qtd': recebidas.get('totalCount', 0) if st1 == 200 else 0,
        'confirmadas_qtd': confirmadas.get('totalCount', 0) if st2 == 200 else 0,
        'pendentes_qtd': pendentes.get('totalCount', 0) if st3 == 200 else 0,
        'vencidas_qtd': vencidas.get('totalCount', 0) if st4 == 200 else 0,
    }

    return jsonify(resultado)


def _traduz_tipo_asaas(tipo):
    """Traduz o tipo de transação financeira do Asaas para português."""
    mapa = {
        'PAYMENT_RECEIVED': 'Cobrança recebida',
        'PAYMENT_CONFIRMED': 'Cobrança confirmada',
        'TRANSFER': 'Transferência enviada',
        'PIX_TRANSACTION_DEBIT': 'PIX enviado',
        'PIX_TRANSACTION_CREDIT': 'PIX recebido',
        'BANK_SLIP_FEE': 'Taxa de boleto',
        'TRANSFER_FEE': 'Taxa de transferência',
        'PAYMENT_FEE': 'Taxa de cobrança',
        'REFUND': 'Estorno',
        'CHARGEBACK': 'Chargeback',
        'CREDIT': 'Crédito',
        'DEBIT': 'Débito',
    }
    return mapa.get(tipo, tipo.replace('_', ' ').title() if tipo else 'Lançamento')


@app.route('/admin/emergency/fix-recebimento', methods=['GET', 'POST'])
@login_required
@admin_required
def fix_recebimento():
    """Emergência: recriar tabela recebimento se deletada."""
    try:
        conn = db()
        conn.execute("""CREATE TABLE IF NOT EXISTS recebimento (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operadora TEXT NOT NULL, obs TEXT DEFAULT '', plano TEXT NOT NULL,
            total REAL DEFAULT 0,
            UNIQUE(operadora, obs, plano)
        )""")
        # Inserir dados padrão
        dados = [
            ('SulAmérica', '', 'PME', 3580),
            ('SulAmérica', '', 'Executivo', 4500),
            ('Amil', '', 'PME', 2800),
            ('Amil', '', 'Executivo', 3500),
            ('Med Senior SP/RJ', '', 'PF', 1200),
            ('Vera Cruz', '', 'PME', 2500),
            ('Vera Cruz', '', 'Executivo', 3200),
            ('Bradesco Saúde', '', 'PME', 3000),
            ('UNIMED', '', 'PME', 2900),
        ]
        for op, obs, plano, total in dados:
            conn.execute("""INSERT OR IGNORE INTO recebimento (operadora,obs,plano,total) 
                           VALUES (?,?,?,?)""", (op, obs, plano, total))
        conn.commit()
        close_db(conn)
        return jsonify({'ok': True, 'msg': 'Tabela recebimento recriada com sucesso'}), 200
    except Exception as e:
        return jsonify({'ok': False, 'erro': str(e)}), 500

@app.route('/admin/emergency/limpar-duplicatas', methods=['GET', 'POST'])
@login_required
@admin_required
def limpar_duplicatas():
    """Emergência: remover propostas duplicadas."""
    try:
        conn = db()
        # Manter apenas a primeira de cada cliente
        conn.execute("""DELETE FROM propostas WHERE id NOT IN (
            SELECT MIN(id) FROM propostas GROUP BY razao_social
        )""")
        conn.commit()
        count = conn.total_changes
        close_db(conn)
        return jsonify({'ok': True, 'msg': f'Removidas {count} duplicatas'}), 200
    except Exception as e:
        return jsonify({'ok': False, 'erro': str(e)}), 500

@app.route('/admin/emergency/restaurar-dados', methods=['GET', 'POST'])
@login_required
@admin_required
def restaurar_dados():
    """Emergência: restaurar as 5 propostas perdidas."""
    try:
        conn = db()
        # Usuários
        conn.execute("""INSERT OR IGNORE INTO usuarios (id, nome, email, perfil, regime_base, ativo) 
                       VALUES (?, ?, ?, ?, ?, ?)""",
                     (1, 'Guilherme Santos', 'guilherme@serenuscorretora.com.br', 'admin', '', 1))
        conn.execute("""INSERT OR IGNORE INTO usuarios (id, nome, email, perfil, regime_base, ativo) 
                       VALUES (?, ?, ?, ?, ?, ?)""",
                     (2, 'Bianca Sampaio', 'bianca@serenuscorretora.com.br', 'consultor', 'com_fixo_lead', 1))
        # Propostas
        propostas = [
            (1, 'Guilherme Santos', 'GC CALDEIRARIA & SERVICOS LTDA', 'PJ', 'SulAmérica PME', 'PME PORTE 1', 'Enfermaria', 'Sem', 1, 3580, '2026-06-18'),
            (2, 'Bianca Sampaio', 'MAURO JUAREZ TULESKI', 'PF', 'Med Senior SP/RJ', 'Saúde', 'Enfermaria', 'Sem', 1, 767.95, '2026-06-18'),
            (2, 'Bianca Sampaio', 'ARLETE KAZUE MORI TULESKI', 'PF', 'Med Senior SP/RJ', 'Saúde', 'Enfermaria', 'Sem', 1, 767.95, '2026-06-18'),
            (1, 'Guilherme Santos', 'WILLAMI HANDERSON DE OLIVEIRA', 'PJ', 'Amil PME', 'PME PORTE 1', 'Enfermaria', 'Sem', 1, 2800, '2026-06-18'),
            (1, 'Guilherme Santos', 'RANIELLY VICTORIA SILVA DE PAIVA', 'PJ', 'Vera Cruz PME', 'PME PORTE 1', 'Enfermaria', 'Sem', 1, 2500, '2026-06-18'),
        ]
        for u, c, r, t, m, tc, a, f, v, val, vig in propostas:
            conn.execute("""INSERT INTO propostas (usuario_id, consultor, razao_social, tipo_pessoa, modalidade, 
                           tipo_contrato, acomodacao, fator_moderador, total_vidas, valor, vigencia, status, criado_em)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Ativo', CURRENT_TIMESTAMP)""",
                         (u, c, r, t, m, tc, a, f, v, val, vig))
        conn.commit()
        close_db(conn)
        return jsonify({'ok': True, 'msg': '5 propostas restauradas com sucesso'}), 200
    except Exception as e:
        return jsonify({'ok': False, 'erro': str(e)}), 500

@app.route('/admin/backup/exportar-json', methods=['GET', 'POST'])
@login_required
@admin_required
def backup_exportar_json():
    """Exporta banco inteiro como JSON para backup/restauração."""
    try:
        conn = db()
        
        # Exportar todas as tabelas críticas
        propostas = conn.execute("SELECT * FROM propostas ORDER BY id").fetchall()
        parcelas = conn.execute("SELECT * FROM parcelas ORDER BY id").fetchall()
        usuarios = conn.execute("SELECT * FROM usuarios ORDER BY id").fetchall()
        operadoras = conn.execute("SELECT * FROM operadoras ORDER BY id").fetchall()
        recebimento = conn.execute("SELECT * FROM recebimento ORDER BY id").fetchall()
        repasse_corretor = conn.execute("SELECT * FROM repasse_corretor ORDER BY id").fetchall()
        
        backup = {
            'versao': 'v14',
            'data_backup': datetime.now(TZ_SP).isoformat(),
            'total_propostas': len(propostas),
            'total_parcelas': len(parcelas),
            'total_usuarios': len(usuarios),
            'propostas': [dict(p) for p in propostas],
            'parcelas': [dict(p) for p in parcelas],
            'usuarios': [dict(u) for u in usuarios],
            'operadoras': [dict(o) for o in operadoras],
            'recebimento': [dict(r) for r in recebimento],
            'repasse_corretor': [dict(r) for r in repasse_corretor],
        }
        
        close_db(conn)
        
        # Salvar arquivo com timestamp
        os.makedirs('/data/backups', exist_ok=True)
        timestamp = datetime.now(TZ_SP).strftime('%Y%m%d-%H%M%S')
        backup_file = f"/data/backups/backup-{timestamp}.json"
        
        with open(backup_file, 'w', encoding='utf-8') as f:
            json.dump(backup, f, indent=2, default=str, ensure_ascii=False)
        
        print(f"[BACKUP] ✅ Exportado: {backup_file} ({len(propostas)} propostas)")
        
        return send_file(
            backup_file,
            as_attachment=True,
            download_name=f"JOB-Serenus-Backup-{timestamp}.json"
        )
    except Exception as e:
        print(f"[BACKUP] ❌ Erro: {e}")
        return jsonify({'ok': False, 'erro': str(e)}), 500

@app.route('/admin/backup/listar', methods=['GET'])
@login_required
@admin_required
def backup_listar():
    """Lista todos os backups disponíveis em /data/backups."""
    try:
        backup_dir = '/data/backups'
        os.makedirs(backup_dir, exist_ok=True)
        
        backups = []
        for arquivo in sorted(os.listdir(backup_dir), reverse=True):
            if arquivo.endswith('.json'):
                caminho = os.path.join(backup_dir, arquivo)
                tamanho = os.path.getsize(caminho) / (1024*1024)  # MB
                data_mod = datetime.fromtimestamp(os.path.getmtime(caminho), TZ_SP)
                backups.append({
                    'arquivo': arquivo,
                    'tamanho_mb': f"{tamanho:.2f}",
                    'data': data_mod.isoformat(),
                })
        
        return jsonify({'ok': True, 'backups': backups})
    except Exception as e:
        return jsonify({'ok': False, 'erro': str(e)}), 500

@app.route('/admin/backup/restaurar/<arquivo>', methods=['POST'])
@login_required
@admin_required
def backup_restaurar(arquivo):
    """Restaura banco a partir de backup JSON."""
    try:
        if '..' in arquivo or '/' in arquivo:
            return jsonify({'ok': False, 'erro': 'Arquivo inválido'}), 400
        
        backup_file = f"/data/backups/{arquivo}"
        if not os.path.exists(backup_file):
            return jsonify({'ok': False, 'erro': 'Arquivo não encontrado'}), 404
        
        with open(backup_file, 'r', encoding='utf-8') as f:
            backup = json.load(f)
        
        conn = db()
        
        # Limpar tabelas existentes
        tabelas = ['propostas', 'parcelas', 'usuarios', 'operadoras', 'recebimento', 'repasse_corretor']
        for tabela in tabelas:
            conn.execute(f"DELETE FROM {tabela}")
        
        # Restaurar dados
        for usuario in backup.get('usuarios', []):
            cols = ', '.join(usuario.keys())
            vals = ', '.join(['?' for _ in usuario.values()])
            conn.execute(f"INSERT INTO usuarios ({cols}) VALUES ({vals})", tuple(usuario.values()))
        
        for operadora in backup.get('operadoras', []):
            cols = ', '.join(operadora.keys())
            vals = ', '.join(['?' for _ in operadora.values()])
            conn.execute(f"INSERT INTO operadoras ({cols}) VALUES ({vals})", tuple(operadora.values()))
        
        for proposta in backup.get('propostas', []):
            cols = ', '.join(proposta.keys())
            vals = ', '.join(['?' for _ in proposta.values()])
            conn.execute(f"INSERT INTO propostas ({cols}) VALUES ({vals})", tuple(proposta.values()))
        
        for parcela in backup.get('parcelas', []):
            cols = ', '.join(parcela.keys())
            vals = ', '.join(['?' for _ in parcela.values()])
            conn.execute(f"INSERT INTO parcelas ({cols}) VALUES ({vals})", tuple(parcela.values()))
        
        for receb in backup.get('recebimento', []):
            cols = ', '.join(receb.keys())
            vals = ', '.join(['?' for _ in receb.values()])
            conn.execute(f"INSERT INTO recebimento ({cols}) VALUES ({vals})", tuple(receb.values()))
        
        for repasse in backup.get('repasse_corretor', []):
            cols = ', '.join(repasse.keys())
            vals = ', '.join(['?' for _ in repasse.values()])
            conn.execute(f"INSERT INTO repasse_corretor ({cols}) VALUES ({vals})", tuple(repasse.values()))
        
        conn.commit()
        close_db(conn)
        
        print(f"[BACKUP] ✅ Restaurado: {arquivo}")
        return jsonify({'ok': True, 'msg': f"Restaurado {backup['total_propostas']} propostas"})
    except Exception as e:
        print(f"[BACKUP] ❌ Erro na restauração: {e}")
        return jsonify({'ok': False, 'erro': str(e)}), 500

@app.route('/admin/backup/auto-agendar', methods=['POST'])
@login_required
@admin_required
def backup_agendar():
    """Agenda backup automático diariamente às 22:00 (SP)."""
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        
        def fazer_backup():
            """Função que roda no agendador."""
            try:
                conn = db()
                propostas = conn.execute("SELECT * FROM propostas").fetchall()
                parcelas = conn.execute("SELECT * FROM parcelas").fetchall()
                usuarios = conn.execute("SELECT * FROM usuarios").fetchall()
                operadoras = conn.execute("SELECT * FROM operadoras").fetchall()
                recebimento = conn.execute("SELECT * FROM recebimento").fetchall()
                repasse_corretor = conn.execute("SELECT * FROM repasse_corretor").fetchall()
                
                backup = {
                    'versao': 'v14',
                    'data_backup': datetime.now(TZ_SP).isoformat(),
                    'total_propostas': len(propostas),
                    'propostas': [dict(p) for p in propostas],
                    'parcelas': [dict(p) for p in parcelas],
                    'usuarios': [dict(u) for u in usuarios],
                    'operadoras': [dict(o) for o in operadoras],
                    'recebimento': [dict(r) for r in recebimento],
                    'repasse_corretor': [dict(r) for r in repasse_corretor],
                }
                
                close_db(conn)
                
                os.makedirs('/data/backups', exist_ok=True)
                timestamp = datetime.now(TZ_SP).strftime('%Y%m%d-%H%M%S')
                backup_file = f"/data/backups/backup-{timestamp}.json"
                
                with open(backup_file, 'w', encoding='utf-8') as f:
                    json.dump(backup, f, indent=2, default=str, ensure_ascii=False)
                
                print(f"[BACKUP AUTO] ✅ {backup_file}")
            except Exception as e:
                print(f"[BACKUP AUTO] ❌ {e}")
        
        # Agendar
        if not hasattr(app, 'scheduler'):
            app.scheduler = BackgroundScheduler(timezone=TZ_SP)
            app.scheduler.add_job(fazer_backup, 'cron', hour=22, minute=0)  # 22:00 SP
            app.scheduler.start()
            print("[SCHEDULER] ✅ Backup automático agendado para 22:00 (São Paulo)")
        
        return jsonify({'ok': True, 'msg': 'Backup automático agendado para 22:00 diariamente'})
    except Exception as e:
        return jsonify({'ok': False, 'erro': str(e)}), 500

@app.route('/admin/emergency/init-db', methods=['GET', 'POST'])
@login_required
@admin_required
def emergency_init_db():
    """Inicializa banco de dados (cria todas as tabelas)."""
    try:
        print(f"\n[INIT-DB] DB_MODE: {DB_MODE}")
        print(f"[INIT-DB] DATABASE_URL: {os.environ.get('DATABASE_URL', 'não setada')[:50]}...")
        
        init_db()
        
        print(f"[INIT-DB] ✅ Sucesso!")
        return jsonify({
            'ok': True, 
            'msg': 'Banco inicializado com sucesso!',
            'db_mode': DB_MODE,
            'database_url_presente': bool(os.environ.get('DATABASE_URL'))
        })
    except Exception as e:
        print(f"[INIT-DB] ❌ Erro: {e}")
        return jsonify({'ok': False, 'erro': str(e)}), 500

@app.route('/download/<path:chave_arquivo>')
def download_arquivo(chave_arquivo):
    """Serve arquivos armazenados localmente."""
    try:
        caminho = f"/data/uploads/{chave_arquivo}".replace('//', '/')
        
        # Validar que o caminho está dentro de /data/uploads
        if not os.path.abspath(caminho).startswith('/data/uploads'):
            return jsonify({'erro': 'Acesso negado'}), 403
        
        if not os.path.exists(caminho):
            return jsonify({'erro': 'Arquivo não encontrado'}), 404
        
        from flask import send_file
        return send_file(caminho, as_attachment=True)
    except Exception as e:
        return jsonify({'erro': str(e)}), 500
@login_required
@admin_required
def testar_r2():
    """Testa e mostra status de R2 + fallback local."""
    try:
        import io
        
        # Testar upload
        arquivo_teste = io.BytesIO(b"Teste - " + str(datetime.now(TZ_SP)).encode())
        resultado = upload_arquivo_r2(arquivo_teste, "teste/test.txt")
        
        return jsonify({
            'ok': True,
            'msg': 'Upload funcionando!',
            'storage_usado': resultado.get('storage', 'desconhecido'),
            'config_r2': {
                'enabled': os.environ.get('R2_ENABLED') == 'true',
                'endpoint': os.environ.get('R2_ENDPOINT', '')[:40] + '...' if os.environ.get('R2_ENDPOINT') else 'não configurado',
                'bucket': os.environ.get('R2_BUCKET_NAME', 'não configurado')
            },
            'fallback_local': 'ativado automaticamente',
            'nota': 'Se R2 falhar, uploads vão para /data/uploads (local)'
        })
    except Exception as e:
        return jsonify({'ok': False, 'erro': str(e)}), 500

@app.route('/admin/testar-smtp')
@login_required
@admin_required
def testar_smtp():
    """Testa envio de email via API do Brevo."""
    import urllib.request, json as _json
    api_key  = os.environ.get('BREVO_API_KEY','')
    remetente = os.environ.get('SMTP_USER','noreply@serenuscorretora.com.br')
    destinatario = session.get('email') or remetente
    resultado = {'api': 'Brevo HTTP API', 'remetente': remetente, 'etapas': []}
    if not api_key:
        resultado['erro'] = 'BREVO_API_KEY não configurada no Railway.'
        return jsonify(resultado)
    try:
        resultado['etapas'].append('Chamando API Brevo...')
        payload = _json.dumps({
            "sender":  {"name": "JOB Serenus", "email": remetente},
            "to":      [{"email": remetente}],
            "subject": "JOB · Teste de email",
            "htmlContent": "<p>Email de teste do JOB Serenus funcionando!</p>"
        }).encode('utf-8')
        req = urllib.request.Request(
            "https://api.brevo.com/v3/smtp/email",
            data=payload,
            headers={"Content-Type":"application/json","api-key":api_key},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read().decode()
            resultado['etapas'].append(f'HTTP {resp.status} — Email enviado para {remetente}')
            resultado['ok'] = True
            resultado['resposta'] = body
    except Exception as e:
        resultado['etapas'].append(f'Erro: {e}')
        resultado['erro'] = str(e)
    return jsonify(resultado)

@app.route('/admin/emergency/diag-anexos')
@login_required
@admin_required
def diag_anexos():
    """Diagnóstico: mostra o que está no disco vs o que o banco espera."""
    import os
    # Lista arquivos físicos no UPLOAD_FOLDER
    arquivos_disco = []
    try:
        arquivos_disco = sorted(os.listdir(UPLOAD_FOLDER))
    except Exception as e:
        arquivos_disco = [f"ERRO ao listar: {e}"]

    # Cruza com o que o banco aponta
    conn = db()
    props = conn.execute("SELECT id, razao_social, comprovante_boleto, contrato_arquivo, anexos FROM propostas ORDER BY id").fetchall()
    close_db(conn)

    detalhe = []
    for p in props:
        itens = []
        for campo in ('comprovante_boleto', 'contrato_arquivo'):
            nome = p[campo]
            if nome:
                caminho = os.path.join(UPLOAD_FOLDER, os.path.basename(nome))
                itens.append({"campo": campo, "nome": nome, "existe_no_disco": os.path.exists(caminho)})
        try:
            _raw = json.loads(p['anexos']) if p['anexos'] else []
            extras = [x['nome'] if isinstance(x, dict) else x for x in _raw]
        except Exception:
            extras = []
        for nome in extras:
            if nome:
                caminho = os.path.join(UPLOAD_FOLDER, os.path.basename(nome))
                itens.append({"campo": "anexo_extra", "nome": nome, "existe_no_disco": os.path.exists(caminho)})
        if itens:
            detalhe.append({"proposta_id": p['id'], "cliente": p['razao_social'], "anexos": itens})

    return jsonify({
        "upload_folder": UPLOAD_FOLDER,
        "upload_folder_existe": os.path.isdir(UPLOAD_FOLDER),
        "total_arquivos_no_disco": len([a for a in arquivos_disco if not a.startswith('ERRO')]),
        "arquivos_no_disco": arquivos_disco,
        "propostas_com_anexos": detalhe,
    })

@app.route('/admin/emergency/reenviar-anexo', methods=['POST'])
@login_required
@admin_required
def emergency_reenviar_anexo():
    """
    Recebe um arquivo e o salva em UPLOAD_FOLDER com o nome exato informado.
    Usado para recuperar anexos perdidos.
    Payload multipart: file=<arquivo>, nome_original=<nome exato do banco>
    """
    nome_original = (request.form.get('nome_original') or '').strip()
    f = request.files.get('file')

    if not f or not f.filename:
        return jsonify({'ok': False, 'erro': 'Nenhum arquivo enviado'}), 400
    if not nome_original:
        return jsonify({'ok': False, 'erro': 'Nome original não informado'}), 400

    # Salva com o nome EXATO que está no banco
    caminho = os.path.join(UPLOAD_FOLDER, nome_original)
    try:
        f.save(caminho)
        return jsonify({
            'ok': True,
            'msg': f'Arquivo salvo: {nome_original}',
            'caminho': caminho,
            'tamanho': os.path.getsize(caminho)
        })
    except Exception as e:
        return jsonify({'ok': False, 'erro': str(e)}), 500


@app.route('/admin/emergency/buscar-anexos', methods=['GET','POST'])
@login_required
@admin_required
def emergency_buscar_anexos():
    """
    Varre o filesystem em busca de arquivos de anexos que existem
    no banco mas não estão em UPLOAD_FOLDER. Lista onde foram encontrados.
    GET = diagnóstico / POST = copia para /data/anexos
    """
    import shutil

    # Coleta todos os nomes de arquivo referenciados no banco
    conn = db()
    rows = conn.execute("""
        SELECT id, comprovante_boleto, contrato_arquivo, anexos
        FROM propostas
        WHERE comprovante_boleto IS NOT NULL
           OR contrato_arquivo IS NOT NULL
           OR (anexos IS NOT NULL AND anexos != '[]')
    """).fetchall()
    close_db(conn)

    nomes_banco = set()
    for r in rows:
        def _add(v):
            if v: nomes_banco.add(os.path.basename(v))
        _add(r['comprovante_boleto'] if hasattr(r,'keys') else r[1])
        _add(r['contrato_arquivo']   if hasattr(r,'keys') else r[2])
        try:
            extras = json.loads((r['anexos'] if hasattr(r,'keys') else r[3]) or '[]')
            for a in extras: _add(a)
        except: pass

    # Lugares para procurar
    lugares = [
        UPLOAD_FOLDER,
        '/data/anexos',
        '/data',
        os.path.join(os.path.expanduser('~'), 'JOB_Serenus_Dados', 'anexos'),
        os.path.join(os.path.expanduser('~'), 'JOB_Serenus_Dados'),
        '/app/uploads',
        '/app/anexos',
        '/tmp/anexos',
    ]

    encontrados = {}   # nome → caminho_completo
    nao_encontrados = []

    # Varre todos os lugares
    for lugar in lugares:
        if not os.path.isdir(lugar): continue
        try:
            for arq in os.listdir(lugar):
                caminho = os.path.join(lugar, arq)
                if os.path.isfile(caminho) and arq in nomes_banco:
                    if arq not in encontrados:
                        encontrados[arq] = caminho
        except: pass

    for nome in sorted(nomes_banco):
        if nome not in encontrados:
            nao_encontrados.append(nome)

    if request.method == 'POST':
        # Copia arquivos encontrados para UPLOAD_FOLDER
        copiados = 0
        erros = []
        for nome, origem in encontrados.items():
            destino = os.path.join(UPLOAD_FOLDER, nome)
            if os.path.exists(destino):
                copiados += 1
                continue
            try:
                shutil.copy2(origem, destino)
                copiados += 1
            except Exception as e:
                erros.append(f"{nome}: {e}")
        return jsonify({
            'ok': True,
            'copiados': copiados,
            'erros': erros,
            'ainda_faltando': nao_encontrados
        })

    return jsonify({
        'ok': True,
        'upload_folder': UPLOAD_FOLDER,
        'total_no_banco': len(nomes_banco),
        'encontrados_fora': {k: v for k, v in encontrados.items() if not v.startswith(UPLOAD_FOLDER)},
        'nao_encontrados': nao_encontrados,
        'lugares_verificados': [l for l in lugares if os.path.isdir(l)],
    })


@app.route('/admin/emergency/status')
@login_required
@admin_required
def emergency_status():
    """Diagnóstico de emergência — mostra qual banco está sendo usado e dados dentro dele."""
    import os
    conn = db()
    n_props = conn.execute("SELECT COUNT(*) c FROM propostas").fetchone()['c']
    n_parcelas = conn.execute("SELECT COUNT(*) c FROM parcelas").fetchone()['c']
    props = conn.execute("SELECT id, razao_social, adm_operadora, valor FROM propostas ORDER BY id").fetchall()
    close_db(conn)
    
    db_path = os.path.join(DATA_DIR, 'job.db')
    return jsonify({
        "data_dir": DATA_DIR,
        "db_path": db_path,
        "db_exists": os.path.exists(db_path),
        "db_size_kb": round(os.path.getsize(db_path) / 1024, 1) if os.path.exists(db_path) else 0,
        "propostas_count": n_props,
        "parcelas_count": n_parcelas,
        "propostas": [dict(p) for p in props[:10]],
    })

@app.route('/admin/emergency/carregar-backup-master', methods=['POST'])
@login_required
@admin_required
def emergency_carregar_backup():
    """Carrega o backup master com 5 propostas."""
    import os
    import shutil
    
    backup_master = os.path.join(os.path.expanduser("~"), "JOB_Serenus_Dados", "backups", "job_backup_20260616_212404.db")
    db_path = os.path.join(DATA_DIR, 'job.db')
    
    if not os.path.exists(backup_master):
        return jsonify({"ok": False, "erro": "Backup master não encontrado"}), 500
    
    try:
        shutil.copy2(backup_master, db_path)
        
        conn = sqlite3.connect(db_path)
        n_props = conn.execute("SELECT COUNT(*) c FROM propostas").fetchone()['c']
        n_parcs = conn.execute("SELECT COUNT(*) c FROM parcelas").fetchone()['c']
        close_db(conn)
        
        return jsonify({
            "ok": True, 
            "msg": f"Backup carregado: {n_props} propostas, {n_parcs} parcelas",
            "propostas": n_props,
            "parcelas": n_parcs,
        })
    except Exception as e:
        return jsonify({"ok": False, "erro": str(e)}), 500


    """Diagnóstico de emergência — mostra qual banco está sendo usado e dados dentro dele."""
    import os
    conn = db()
    n_props = conn.execute("SELECT COUNT(*) c FROM propostas").fetchone()['c']
    n_parcelas = conn.execute("SELECT COUNT(*) c FROM parcelas").fetchone()['c']
    props = conn.execute("SELECT id, razao_social, adm_operadora, valor FROM propostas ORDER BY id").fetchall()
    close_db(conn)
    
    db_path = os.path.join(DATA_DIR, 'job.db')
    return jsonify({
        "data_dir": DATA_DIR,
        "db_path": db_path,
        "db_exists": os.path.exists(db_path),
        "db_size_kb": round(os.path.getsize(db_path) / 1024, 1) if os.path.exists(db_path) else 0,
        "propostas_count": n_props,
        "parcelas_count": n_parcelas,
        "propostas": [dict(p) for p in props[:10]],
    })

@app.route('/admin/emergency/exportar-json')
@login_required
@admin_required
def emergency_exportar():
    """Exporta TODAS as propostas e parcelas em JSON para backup emergencial."""
    conn = db()
    props = conn.execute("SELECT * FROM propostas ORDER BY id").fetchall()
    parc = conn.execute("SELECT * FROM parcelas ORDER BY proposta_id, numero").fetchall()
    close_db(conn)
    
    data = {
        "timestamp": datetime.now(TZ_SP).isoformat(),
        "propostas": [dict(p) for p in props],
        "parcelas": [dict(p) for p in parc],
    }
    resp = jsonify(data)
    resp.headers['Content-Disposition'] = f'attachment; filename="job_emergencia_{datetime.now(TZ_SP).strftime("%Y%m%d_%H%M%S")}.json"'
    return resp


@login_required
@admin_required
def parcela_pagar_asaas(pid):
    """Cria uma transferência PIX real via Asaas para pagar a comissão do consultor."""
    if not asaas_configurado():
        return jsonify({"ok": False, "erro": "Asaas não configurado. Adicione ASAAS_API_KEY no Railway."}), 400

    conn = db()
    parc = conn.execute("""SELECT pa.*, p.consultor, p.usuario_id, p.razao_social
        FROM parcelas pa JOIN propostas p ON p.id=pa.proposta_id WHERE pa.id=?""", (pid,)).fetchone()
    if not parc:
        close_db(conn); return jsonify({"ok": False, "erro": "Parcela não encontrada"}), 404
    if parc['status'] != 'Liberado para o corretor':
        close_db(conn); return jsonify({"ok": False, "erro": "Só é possível pagar parcelas liberadas para o corretor"}), 400
    if parc['asaas_transfer_id']:
        close_db(conn); return jsonify({"ok": False, "erro": "Esta parcela já tem um pagamento Asaas iniciado"}), 400

    consultor = conn.execute("SELECT chave_pix, nome FROM usuarios WHERE id=?", (parc['usuario_id'],)).fetchone()
    chave_pix = (consultor['chave_pix'] if consultor else '') or ''
    if not chave_pix.strip():
        close_db(conn); return jsonify({"ok": False, "erro": f"{parc['consultor']} não tem chave PIX cadastrada. Cadastre em Usuários."}), 400

    tipo_chave = asaas_detectar_tipo_chave(chave_pix)
    valor = round(float(parc['valor']), 2)

    payload = {
        "value": valor,
        "pixAddressKey": chave_pix.strip(),
        "pixAddressKeyType": tipo_chave,
        "description": f"Comissão {parc['razao_social']} - Parcela {parc['numero']}"[:140],
        "externalReference": f"parcela_{pid}",
    }
    data, status = asaas_request('POST', '/transfers', payload)

    if status in (200, 201) and data.get('id'):
        conn.execute("""UPDATE parcelas SET asaas_transfer_id=?, asaas_status=?, asaas_erro=NULL WHERE id=?""",
                     (data['id'], data.get('status', 'PENDING'), pid))
        conn.execute("""INSERT INTO historico_proposta (proposta_id, usuario_nome, campo, valor_antes, valor_depois)
                        VALUES (?,?,?,?,?)""",
                     (parc['proposta_id'] if 'proposta_id' in parc.keys() else None, session.get('nome'),
                      'Pagamento PIX (Asaas)', '', f"R$ {valor:.2f} para {parc['consultor']} — transfer {data['id']}"))
        conn.commit(); close_db(conn)
        return jsonify({"ok": True, "transfer_id": data['id'], "status": data.get('status')})
    else:
        erro_msg = data.get('_erro')
        if not erro_msg and data.get('errors'):
            erro_msg = '; '.join([e.get('description', str(e)) for e in data['errors']])
        conn.execute("UPDATE parcelas SET asaas_erro=? WHERE id=?", (str(erro_msg)[:300], pid))
        conn.commit(); close_db(conn)
        return jsonify({"ok": False, "erro": erro_msg or "Erro desconhecido do Asaas", "status": status}), 400


@app.route('/webhook/asaas', methods=['POST'])
def webhook_asaas():
    """Recebe e processa eventos do Asaas (transferências, cobranças).
    
    Segurança:
    - Valida token asaas-access-token se configurado
    - Implementa idempotência via webhook_log
    - Loga cada etapa para diagnóstico
    
    Retorna sempre 200 para não gerar fila de retentativas infinita.
    """
    try:
        # 1. VALIDAÇÃO DO TOKEN (se configurado)
        if ASAAS_WEBHOOK_TOKEN:
            token_recebido = request.headers.get('asaas-access-token', '')
            if token_recebido != ASAAS_WEBHOOK_TOKEN:
                app.logger.warning(f"[WEBHOOK] ❌ Token inválido ou faltante (recebido: '{token_recebido[:20] if token_recebido else 'VAZIO'}'...)")
                return jsonify({"ok": False, "erro": "Token inválido"}), 200
            app.logger.info("[WEBHOOK] ✅ Token validado com sucesso")
        
        # 2. PARSE DO JSON
        data = request.get_json(force=True) or {}
        evento_id = data.get('id', '')
        evento = data.get('event', '')
        
        app.logger.info(f"[WEBHOOK] Evento recebido: id={evento_id[:30] if evento_id else 'VAZIO'}, event={evento}")
        
        if not evento_id:
            app.logger.warning("[WEBHOOK] ⚠️ evento_id vazio, ignorando")
            return jsonify({"ok": True, "msg": "evento_id vazio, ignorado"}), 200
        
        # 3. VERIFICAR IDEMPOTÊNCIA (já processado?)
        conn = db()
        já_proc = conn.execute("SELECT 1 FROM webhook_log WHERE evento_id=?", (evento_id,)).fetchone()
        if já_proc:
            app.logger.info(f"[WEBHOOK] ⏭️  Evento duplicado (id={evento_id[:30]}), ignorando")
            close_db(conn)
            return jsonify({"ok": True, "msg": "duplicado, ignorado"}), 200
        
        # 4. PROCESSAR EVENTOS DE TRANSFERÊNCIA
        if evento.startswith('TRANSFER_'):
            app.logger.info(f"[WEBHOOK] 🔄 Processando transferência: evento={evento}")
            transfer = data.get('transfer', {})
            transfer_id = transfer.get('id', '')
            novo_status = transfer.get('status', '')
            
            if transfer_id:
                parc = conn.execute(
                    "SELECT id, proposta_id FROM parcelas WHERE asaas_transfer_id=?",
                    (transfer_id,)
                ).fetchone()
                
                if parc:
                    app.logger.info(f"[WEBHOOK] ✅ Parcela encontrada: id={parc['id']}, proposta_id={parc['proposta_id']}")
                    
                    # Atualizar status
                    conn.execute("UPDATE parcelas SET asaas_status=? WHERE id=?", (novo_status, parc['id']))
                    
                    if evento == 'TRANSFER_DONE':
                        data_efetiva = transfer.get('effectiveDate') or datetime.now(TZ_SP).strftime('%Y-%m-%d')
                        conn.execute(
                            "UPDATE parcelas SET status='Pago ao corretor', data_pagamento=? WHERE id=?",
                            (data_efetiva, parc['id'])
                        )
                        conn.execute(
                            "INSERT INTO historico_proposta (proposta_id, usuario_nome, campo, valor_antes, valor_depois) VALUES (?,?,?,?,?)",
                            (parc['proposta_id'], 'Asaas (webhook)', 'Status do pagamento', 'Pendente', 'Pago ao corretor (PIX confirmado)')
                        )
                        app.logger.info(f"[WEBHOOK] 💰 Transferência concluída: parcela {parc['id']} marcada como 'Pago ao corretor'")
                    
                    elif evento in ('TRANSFER_FAILED', 'TRANSFER_CANCELLED'):
                        motivo = transfer.get('failReason') or 'Transferência falhou ou foi cancelada'
                        conn.execute("UPDATE parcelas SET asaas_erro=? WHERE id=?", (str(motivo)[:300], parc['id']))
                        app.logger.warning(f"[WEBHOOK] ❌ Transferência falhou: parcela {parc['id']}, motivo={motivo[:50]}")
                    
                    conn.commit()
                else:
                    app.logger.warning(f"[WEBHOOK] ⚠️  Transferência não encontrada: asaas_transfer_id={transfer_id}")
            else:
                app.logger.warning(f"[WEBHOOK] ⚠️  transfer.id vazio no payload")
        
        elif evento.startswith('PAYMENT_'):
            app.logger.info(f"[WEBHOOK] 💳 Evento de cobrança: {evento} (implementação futura)")
        
        # 5. REGISTRAR WEBHOOK PROCESSADO
        conn.execute("INSERT INTO webhook_log (evento_id, evento) VALUES (?,?)", (evento_id, evento))
        conn.commit()
        close_db(conn)
        
        app.logger.info(f"[WEBHOOK] ✅ Webhook processado com sucesso: {evento_id[:30]}")
        return jsonify({"ok": True, "msg": "processado"}), 200
    
    except Exception as e:
        app.logger.error(f"[WEBHOOK] 🔴 ERRO: {str(e)}", exc_info=True)
        return jsonify({"ok": False, "erro": str(e)[:100]}), 200


@app.route('/admin/webhook-diagnostico', methods=['GET'])
@login_required
@admin_required
def webhook_diagnostico():
    """Mostra os últimos webhooks do Asaas recebidos, para diagnóstico."""
    conn = db()
    try:
        # Últimos 20 webhooks
        webhooks = conn.execute(
            "SELECT id, evento_id, evento, processado_em FROM webhook_log ORDER BY processado_em DESC LIMIT 20"
        ).fetchall()

        total = conn.execute("SELECT COUNT(*) AS cnt FROM webhook_log").fetchone()
        total_webhooks = total['cnt'] if total else 0
    except Exception as e:
        app.logger.error(f"[WEBHOOK-DIAG] Erro ao consultar webhook_log: {e}")
        webhooks = []
        total_webhooks = 0
    finally:
        close_db(conn)

    resultado = {
        "config": {
            "asaas_configurado": asaas_configurado(),
            "asaas_webhook_token_configurado": bool(ASAAS_WEBHOOK_TOKEN),
            "asaas_base_url": ASAAS_BASE_URL,
            "ambiente": "produção" if "api.asaas.com" in ASAAS_BASE_URL else "sandbox",
        },
        "ultimos_webhooks": [
            {
                "id": w['id'],
                "evento_id": w['evento_id'],
                "evento": w['evento'],
                "processado_em": str(w['processado_em']),
            }
            for w in webhooks
        ],
        "total_webhooks": total_webhooks,
    }

    return jsonify(resultado), 200


@app.route('/admin/observabilidade')
@login_required
@admin_required
def admin_observabilidade():
    """Dashboard centralizado de observabilidade — logs, status, saúde do sistema."""
    conn = db()

    # === STATUS DO SCHEDULER ===
    scheduler_status = {
        'backup_agendado': 'Sim (22:00 SP)',
        'lead_import_agendado': 'Sim (a cada 30 min)',
        'app_scheduler': app.scheduler is not None if hasattr(app, 'scheduler') else False
    }

    # === SAÚDE DO BANCO ===
    try:
        stats = conn.execute("SELECT COUNT(*) as propostas FROM propostas").fetchone()
        propostas_count = stats['propostas'] if stats else 0
        leads_count = conn.execute("SELECT COUNT(*) as n FROM crm_leads").fetchone()['n']
        usuarios_count = conn.execute("SELECT COUNT(*) as n FROM usuarios").fetchone()['n']
        db_status = {'status': 'OK', 'propostas': propostas_count, 'leads': leads_count, 'usuarios': usuarios_count}
    except Exception as e:
        db_status = {'status': 'ERRO', 'msg': str(e)[:100]}

    # === SAÚDE DO R2 ===
    r2_status = {
        'enabled': os.environ.get('R2_ENABLED') == 'true',
        'configurado': all([os.environ.get(k) for k in ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY', 'R2_SECRET_KEY', 'R2_BUCKET_NAME']]),
        'endpoint': (os.environ.get('R2_ENDPOINT', '')[:50] + '...') if os.environ.get('R2_ENDPOINT') else 'não configurado'
    }

    # === ÚLTIMOS ERROS ===
    erros_recentes = _ULTIMOS_ERROS[:5] if '_ULTIMOS_ERROS' in globals() else []

    # === LOGS DO SCHEDULER ===
    logs_lead_auto = [e for e in _ULTIMOS_ERROS if 'LEAD_AUTO' in e.get('erro', '') or 'LEAD_AUTO' in e.get('traceback', '')]

    close_db(conn)

    html = f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>Observabilidade — JOB Serenus</title><style>
body {{font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; padding: 20px; background: #f5f5f5;}}
.container {{max-width: 1200px; margin: 0 auto;}}
h1 {{color: #333; border-bottom: 3px solid #6366f1; padding-bottom: 10px;}}
.card {{background: white; padding: 20px; margin: 15px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);}}
.card h2 {{margin-top: 0; color: #333; font-size: 18px;}}
.status-ok {{color: #10b981; font-weight: bold;}}
.status-erro {{color: #ef4444; font-weight: bold;}}
.status-info {{color: #6366f1; font-weight: bold;}}
table {{width: 100%; border-collapse: collapse; font-size: 14px;}}
th, td {{padding: 10px; text-align: left; border-bottom: 1px solid #eee;}}
th {{background: #f9fafb; font-weight: 600;}}
.mono {{font-family: monospace; background: #f5f5f5; padding: 5px; border-radius: 3px;}}
.metric-value {{font-size: 24px; font-weight: bold; color: #6366f1;}}
.btn {{display: inline-block; padding: 10px 20px; background: #6366f1; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px;}}
.btn:hover {{background: #4f46e5;}}
    </style></head><body><div class="container">
    <h1>Observabilidade do Sistema</h1>
    <p style="color: #666; font-size: 14px;">Atualizado: {datetime.now(TZ_SP).strftime('%d/%m/%Y %H:%M:%S')}</p>

    <div class="card"><h2>Banco de Dados</h2>
    <div class="status-{'ok' if db_status['status'] == 'OK' else 'erro'}">Status: {db_status['status']}</div>
    <table><tr><td><strong>Propostas:</strong></td><td style="font-size: 20px; color: #6366f1;"><b>{db_status.get('propostas', '?')}</b></td></tr>
    <tr><td><strong>Leads CRM:</strong></td><td style="font-size: 20px; color: #6366f1;"><b>{db_status.get('leads', '?')}</b></td></tr>
    <tr><td><strong>Usuários:</strong></td><td style="font-size: 20px; color: #6366f1;"><b>{db_status.get('usuarios', '?')}</b></td></tr></table></div>

    <div class="card"><h2>⚙️ Scheduler (Tarefas Automáticas)</h2>
    <table><tr><td><strong>APScheduler:</strong></td><td class="status-{'ok' if scheduler_status['app_scheduler'] else 'erro'}">{scheduler_status['app_scheduler']}</td></tr>
    <tr><td><strong>Backup Diário:</strong></td><td class="status-info">{scheduler_status['backup_agendado']}</td></tr>
    <tr><td><strong>Import Leads:</strong></td><td class="status-info">{scheduler_status['lead_import_agendado']}</td></tr></table></div>

    <div class="card"><h2>Cloudflare R2 (Storage)</h2>
    <table><tr><td><strong>Enabled:</strong></td><td class="status-{'ok' if r2_status['enabled'] else 'erro'}">{r2_status['enabled']}</td></tr>
    <tr><td><strong>Configurado:</strong></td><td class="status-{'ok' if r2_status['configurado'] else 'erro'}">{r2_status['configurado']}</td></tr>
    <tr><td><strong>Endpoint:</strong></td><td class="mono">{r2_status['endpoint']}</td></tr></table></div>

    <div class="card"><h2>Últimos Erros ({len(erros_recentes)})</h2>
    {"<table><tr><th>Quando</th><th>Rota</th><th>Erro</th></tr>" + "".join(f"<tr><td>{e['quando']}</td><td class='mono'>{e['rota']}</td><td>{e['erro'][:60]}</td></tr>" for e in erros_recentes) + "</table>" if erros_recentes else "<p style='color: #10b981;'>Sem erros recentes</p>"}</div>

    <div class="card"><h2>Importação de Leads</h2>
    {"<p class='status-erro'>" + str(len(logs_lead_auto)) + " erros na importação</p>" if logs_lead_auto else "<p style='color: #10b981;'>Funcionando normalmente</p>"}</div>

    <a href="/admin" class="btn">← Voltar</a></div></body></html>"""
    return html


@app.route('/admin/ultimo-erro', methods=['GET'])
@login_required
@admin_required
def admin_ultimo_erro():
    """Mostra os últimos erros 500 capturados, com traceback. Para diagnóstico."""
    return jsonify({
        "total": len(_ULTIMOS_ERROS),
        "erros": _ULTIMOS_ERROS,
    }), 200


# ─── SERVIR ARQUIVOS (contratos, comprovantes) ──────────────────────────────────
@app.route('/anexos/<path:nome>')
@login_required
def servir_anexo(nome):
    """Serve arquivo LOCAL primeiro (volume persistente), depois tenta R2 como fallback."""
    from urllib.parse import unquote
    import io
    nome = os.path.basename(unquote(nome))

    # PRIORIDADE 1: LOCAL (/data/anexos — volume persistente)
    caminho = os.path.join(UPLOAD_FOLDER, nome)
    if os.path.exists(caminho):
        app.logger.info(f"[SERVE] ✅ LOCAL: {nome}")
        return send_from_directory(UPLOAD_FOLDER, nome)
    
    # Tenta com nome sanitizado
    nome_limpo = _sanitizar_filename(nome)
    caminho_limpo = os.path.join(UPLOAD_FOLDER, nome_limpo)
    if os.path.exists(caminho_limpo):
        app.logger.info(f"[SERVE] ✅ LOCAL (sanitizado): {nome_limpo}")
        return send_from_directory(UPLOAD_FOLDER, nome_limpo)

    # PRIORIDADE 2: R2 (fallback se local não tem)
    if os.environ.get('R2_ENABLED') == 'true':
        try:
            import boto3
            account_id = os.environ.get('R2_ACCOUNT_ID', '').strip()
            access_key = os.environ.get('R2_ACCESS_KEY', '').strip()
            secret_key = os.environ.get('R2_SECRET_KEY', '').strip()
            bucket     = os.environ.get('R2_BUCKET_NAME', '').strip()
            if account_id and access_key and secret_key and bucket:
                s3 = boto3.client(
                    's3',
                    endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
                    aws_access_key_id=access_key,
                    aws_secret_access_key=secret_key,
                    region_name='auto'
                )

                # Lista de chaves R2 a tentar, em ordem
                chaves_tentar = [nome, _sanitizar_filename(nome)]

                # Os arquivos no R2 ficam dentro de pastas (ex: propostas/20/contrato/ARQ.pdf),
                # mas a URL traz só o nome do arquivo. Então varremos o bucket procurando
                # qualquer chave que TERMINE com esse nome de arquivo.
                achou_key = None
                for k in chaves_tentar:
                    try:
                        s3.head_object(Bucket=bucket, Key=k)
                        achou_key = k
                        break
                    except Exception:
                        pass

                if not achou_key:
                    try:
                        paginator = s3.get_paginator('list_objects_v2')
                        alvo = nome.lower()
                        alvo_limpo = _sanitizar_filename(nome).lower()
                        for page in paginator.paginate(Bucket=bucket):
                            for obj in page.get('Contents', []):
                                key = obj['Key']
                                base = key.split('/')[-1].lower()
                                if base == alvo or base == alvo_limpo:
                                    achou_key = key
                                    break
                            if achou_key:
                                break
                    except Exception as e:
                        app.logger.warning(f"[SERVE] ⚠️ R2 listagem falhou: {type(e).__name__}: {e}")

                if achou_key:
                    resp = s3.get_object(Bucket=bucket, Key=achou_key)
                    content = resp['Body'].read()
                    ctype = resp.get('ContentType', 'application/octet-stream')
                    app.logger.info(f"[SERVE] ✅ R2 (fallback): {achou_key}")
                    return Response(content, mimetype=ctype,
                                    headers={'Content-Disposition': f'inline; filename="{nome}"'})
        except Exception as e:
            app.logger.warning(f"[SERVE] ⚠️ R2 falhou ({nome}): {type(e).__name__}: {e}")

    # Não encontrou em lugar nenhum
    app.logger.error(f"[SERVE] ❌ Arquivo não encontrado: {nome}")
    abort(404)

@app.route('/proposta/<int:pid>/anexo/excluir', methods=['POST'])
@login_required
@admin_required
def excluir_anexo(pid):
    """Exclui um anexo de uma proposta. Apenas admin.
    tipo: 'contrato' | 'comprovante' | 'doc' (com 'nome' do arquivo no array anexos)."""
    d = request.json or {}
    tipo = (d.get('tipo') or '').strip()
    nome = os.path.basename((d.get('nome') or '').strip())
    conn = db()
    p = conn.execute("SELECT * FROM propostas WHERE id=?", (pid,)).fetchone()
    if not p:
        close_db(conn); return jsonify({"ok": False, "msg": "Proposta não encontrada"}), 404

    arquivo_remover = None
    if tipo == 'contrato':
        arquivo_remover = p['contrato_arquivo']
        conn.execute("UPDATE propostas SET contrato_arquivo=NULL WHERE id=?", (pid,))
    elif tipo == 'comprovante':
        arquivo_remover = p['comprovante_boleto']
        conn.execute("UPDATE propostas SET comprovante_boleto=NULL WHERE id=?", (pid,))
    elif tipo == 'doc':
        try:
            lista = json.loads(p['anexos']) if p['anexos'] else []
        except Exception:
            lista = []
        if nome in lista:
            lista.remove(nome)
            arquivo_remover = nome
            conn.execute("UPDATE propostas SET anexos=? WHERE id=?", (json.dumps(lista), pid))
    else:
        close_db(conn); return jsonify({"ok": False, "msg": "Tipo inválido"}), 400

    conn.commit(); close_db(conn)

    # Remove o arquivo físico (best-effort; não falha se já sumiu)
    if arquivo_remover:
        try:
            os.remove(os.path.join(UPLOAD_FOLDER, os.path.basename(arquivo_remover)))
        except Exception:
            pass
    return jsonify({"ok": True})

# ─── EMAIL UTILITÁRIO ────────────────────────────────────────────────────────
def _enviar_email(destinatario, assunto, corpo_html, cc=None, anexos=None):
    """Envia email via API do Brevo (HTTPS porta 443 — nunca bloqueada pelo Railway).
    Configure BREVO_API_KEY no Railway. SMTP_USER define o remetente.
    destinatario: string (1 email) ou lista de emails.
    cc: string ou lista de emails para cópia (opcional).
    anexos: lista de nomes de arquivo (em UPLOAD_FOLDER) a anexar (opcional)."""
    api_key = os.environ.get('BREVO_API_KEY','')
    remetente = os.environ.get('SMTP_USER','noreply@serenuscorretora.com.br')

    # Normaliza destinatários e cópia para listas
    if isinstance(destinatario, str):
        to_list = [e.strip() for e in destinatario.replace(';', ',').split(',') if e.strip()]
    else:
        to_list = [e.strip() for e in destinatario if e and e.strip()]

    cc_list = []
    if cc:
        if isinstance(cc, str):
            cc_list = [e.strip() for e in cc.replace(';', ',').split(',') if e.strip()]
        else:
            cc_list = [e.strip() for e in cc if e and e.strip()]

    # Monta lista de anexos em base64 (Brevo: attachment=[{content, name}])
    attach_payload = []
    if anexos:
        import base64, re as _re
        total_bytes = 0
        LIMITE_BYTES = 9 * 1024 * 1024  # ~9MB de arquivos brutos (Brevo aceita até ~10MB no payload)
        for nome in anexos:
            if not nome:
                continue
            caminho = os.path.join(UPLOAD_FOLDER, os.path.basename(nome))
            if not os.path.exists(caminho):
                print(f"[EMAIL] ⚠️ Anexo não encontrado, ignorando: {caminho}")
                continue
            try:
                tam = os.path.getsize(caminho)
                if total_bytes + tam > LIMITE_BYTES:
                    print(f"[EMAIL] ⚠️ Limite de anexos atingido (~9MB). Pulando: {caminho} ({tam} bytes)")
                    continue
                with open(caminho, 'rb') as fh:
                    conteudo_b64 = base64.b64encode(fh.read()).decode('ascii')
                total_bytes += tam
                # Nome amigável: remove prefixo timestamp/categoria
                nome_limpo = os.path.basename(nome)
                partes = nome_limpo.split('_', 3)
                nome_exibe = partes[-1] if len(partes) >= 2 else nome_limpo
                # SANITIZA: Brevo rejeita nomes com espaços/acentos/caracteres especiais.
                base_nome, ext = os.path.splitext(nome_exibe)
                base_nome = _re.sub(r'[^A-Za-z0-9._-]', '_', base_nome)   # troca espaço/acento por _
                base_nome = _re.sub(r'_+', '_', base_nome).strip('_')      # colapsa __ e remove bordas
                if not base_nome:
                    base_nome = 'documento'
                nome_seguro = (base_nome + ext.lower())[:120]
                attach_payload.append({"content": conteudo_b64, "name": nome_seguro})
                print(f"[EMAIL] 📎 Anexo preparado: {nome_seguro} ({tam} bytes)")
            except Exception as e:
                print(f"[EMAIL] ⚠️ Falha ao ler anexo {caminho}: {e}")

    if not api_key:
        print(f"[EMAIL] ⚠️ BREVO_API_KEY não configurada. Assunto: {assunto} → {to_list} (cc: {cc_list})")
        return False

    def _construir_e_enviar():
        import urllib.request, urllib.error, json as _json
        corpo_payload = {
            "sender":  {"name": "JOB Serenus", "email": remetente},
            "to":      [{"email": e} for e in to_list],
            "subject": assunto,
            "htmlContent": corpo_html
        }
        if cc_list:
            corpo_payload["cc"] = [{"email": e} for e in cc_list]
        if attach_payload:
            corpo_payload["attachment"] = attach_payload
        payload = _json.dumps(corpo_payload).encode('utf-8')
        req = urllib.request.Request(
            "https://api.brevo.com/v3/smtp/email",
            data=payload,
            headers={"Content-Type": "application/json", "api-key": api_key},
            method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                print(f"[EMAIL] ✅ Enviado via Brevo (HTTP {resp.status}): {assunto} → {to_list} (cc: {cc_list}, {len(attach_payload)} anexos)")
            return True, None
        except urllib.error.HTTPError as e:
            erro_corpo = ''
            try: erro_corpo = e.read().decode()
            except Exception: pass
            print(f"[EMAIL] ❌ Brevo HTTP {e.code}: {erro_corpo}")
            return False, f"Brevo HTTP {e.code}: {erro_corpo}"
        except Exception as e:
            print(f"[EMAIL] ❌ Erro ao enviar para {to_list}: {e}")
            return False, str(e)

    # Com anexos: envia SÍNCRONO para capturar e reportar erros reais do Brevo.
    # Sem anexos: mantém envio em background (rápido para o usuário).
    if attach_payload:
        ok, _erro = _construir_e_enviar()
        _enviar_email.ultimo_erro = _erro
        return ok
    else:
        import threading
        threading.Thread(target=lambda: _construir_e_enviar(), daemon=True).start()
        _enviar_email.ultimo_erro = None
        return True

# ─── RECUPERAÇÃO DE SENHA (usuário) ─────────────────────────────────────────
@app.route('/esqueci-senha', methods=['GET','POST'])
def esqueci_senha():
    """Passo 1: usuário informa o e-mail → recebe código de 6 dígitos."""
    if request.method == 'GET':
        return render_template('esqueci_senha.html')
    email = request.form.get('email','').strip().lower()
    conn = db()
    u = conn.execute("SELECT id,nome,ativo FROM usuarios WHERE email=?", (email,)).fetchone()
    if not u or not u['ativo']:
        close_db(conn)
        # Mensagem genérica por segurança (não revela se e-mail existe)
        return render_template('esqueci_senha.html', enviado=True)
    import random
    codigo = f"{random.randint(0,999999):06d}"
    expira = (datetime.now(TZ_SP) + timedelta(minutes=15)).isoformat()
    conn.execute("UPDATE usuarios SET reset_code=?, reset_expira=? WHERE id=?", (codigo, expira, u['id']))
    conn.commit(); close_db(conn)
    corpo = f"""
    <div style="font-family:sans-serif; max-width:420px; margin:auto; padding:30px;">
      <h2 style="color:#1fd8a4;">JOB · Corretora Serenus</h2>
      <p>Olá, <strong>{u['nome']}</strong>.</p>
      <p>Recebemos uma solicitação de redefinição de senha. Use o código abaixo:</p>
      <div style="font-size:36px; font-weight:700; letter-spacing:10px; text-align:center;
                  background:#f3f4f6; padding:20px; border-radius:8px; margin:24px 0; color:#111;">
        {codigo}
      </div>
      <p style="color:#666;">O código expira em <strong>15 minutos</strong>.</p>
      <p style="color:#666;">Se não foi você, ignore este e-mail.</p>
    </div>"""
    _enviar_email(email, "JOB · Código de redefinição de senha", corpo)
    return render_template('esqueci_senha.html', enviado=True, email=email)

@app.route('/redefinir-senha', methods=['GET','POST'])
def redefinir_senha():
    """Passo 2: usuário informa código + nova senha."""
    email = request.args.get('email','') or request.form.get('email','')
    if request.method == 'GET':
        return render_template('redefinir_senha.html', email=email)
    email  = request.form.get('email','').strip().lower()
    codigo = request.form.get('codigo','').strip()
    s1 = request.form.get('senha','')
    s2 = request.form.get('senha2','')
    conn = db()
    u = conn.execute("SELECT id,reset_code,reset_expira FROM usuarios WHERE email=? AND ativo=1", (email,)).fetchone()
    erro = None
    if not u or u['reset_code'] != codigo:
        erro = 'Código inválido ou e-mail não encontrado.'
    elif _data_expirada(u['reset_expira']):
        erro = 'Código expirado. Solicite um novo.'
    elif len(s1) < 6:
        erro = 'Senha deve ter pelo menos 6 caracteres.'
    elif s1 != s2:
        erro = 'Senhas não conferem.'
    if erro:
        close_db(conn)
        return render_template('redefinir_senha.html', email=email, erro=erro)
    conn.execute("UPDATE usuarios SET senha_hash=?, reset_code=NULL, reset_expira=NULL WHERE id=?",
                 (hash_senha(s1), u['id']))
    conn.commit(); close_db(conn)
    return render_template('redefinir_senha.html', sucesso=True)

# ─── RESET DE SENHA PELO GESTOR (admin define senha nova direto) ─────────────
@app.route('/usuario/reset-senha/<int:uid>', methods=['POST'])
@login_required
@admin_required
def usuario_reset_senha(uid):
    nova = request.form.get('nova_senha','').strip()
    if len(nova) < 6:
        flash('Senha deve ter pelo menos 6 caracteres.', 'error')
        return redirect(url_for('usuarios'))
    conn = db()
    conn.execute("UPDATE usuarios SET senha_hash=?, token_setup=NULL, reset_code=NULL WHERE id=?",
                 (hash_senha(nova), uid))
    conn.commit(); close_db(conn)
    flash('Senha redefinida com sucesso.', 'success')
    return redirect(url_for('usuarios'))

# ─── EXCLUIR USUÁRIO ─────────────────────────────────────────────────────────
@app.route('/usuario/excluir/<int:uid>', methods=['POST'])
@login_required
@admin_required
def usuario_excluir(uid):
    if uid == session.get('user_id'):
        flash('Você não pode excluir seu próprio usuário.', 'error')
        return redirect(url_for('usuarios'))
    conn = db()
    # Reatribui propostas ao admin antes de excluir
    conn.execute("UPDATE propostas SET usuario_id=? WHERE usuario_id=?", (session['user_id'], uid))
    conn.execute("DELETE FROM usuarios WHERE id=?", (uid,))
    conn.commit(); close_db(conn)
    flash('Usuário excluído.', 'success')
    return redirect(url_for('usuarios'))

@app.route('/login', methods=['GET','POST'])
def login():
    if request.method == 'POST':
        email = request.form.get('email','').strip().lower()
        senha_digitada = request.form.get('senha','')
        conn = db()
        u = conn.execute("SELECT * FROM usuarios WHERE email=? AND ativo=1",(email,)).fetchone()
        if u:
            ok, precisa_migrar = verifica_senha(senha_digitada, u['senha_hash'])
            if ok:
                # Migra senha antiga (SHA-256) para o formato seguro (PBKDF2) silenciosamente
                if precisa_migrar:
                    try:
                        conn.execute("UPDATE usuarios SET senha_hash=? WHERE id=?", (hash_senha(senha_digitada), u['id']))
                        conn.commit()
                    except Exception:
                        pass
                close_db(conn)
                session.update({'user_id':u['id'],'nome':u['nome'],'perfil':u['perfil'],'regime_base':u['regime_base'],'foto':u['foto'] or ''})
                return redirect(url_for('dashboard'))
        close_db(conn)
        flash('E-mail ou senha incorretos.')
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear(); return redirect(url_for('login'))

@app.route('/setup/<token>', methods=['GET','POST'])
def setup_senha(token):
    conn = db()
    u = conn.execute("SELECT * FROM usuarios WHERE token_setup=? AND ativo=1",(token,)).fetchone()
    if not u: close_db(conn); return render_template('setup_senha.html', erro='Link inválido ou já utilizado.')
    # token_expira pode vir como datetime (Postgres) ou string (SQLite). Comparação segura.
    if _data_expirada(u['token_expira']):
        close_db(conn); return render_template('setup_senha.html', erro='Link expirado.')
    if request.method == 'POST':
        s1=request.form.get('senha',''); s2=request.form.get('senha2','')
        if len(s1)<6: close_db(conn); return render_template('setup_senha.html',usuario=u,erro='Mínimo 6 caracteres.')
        if s1!=s2: close_db(conn); return render_template('setup_senha.html',usuario=u,erro='Senhas não conferem.')
        conn.execute("UPDATE usuarios SET senha_hash=?,token_setup=NULL,token_expira=NULL WHERE id=?",(hash_senha(s1),u['id']))
        conn.commit(); close_db(conn); flash('Senha criada! Faça login.'); return redirect(url_for('login'))
    close_db(conn)
    return render_template('setup_senha.html', usuario=u)

# ─── DASHBOARD ───────────────────────────────────────────────────────────────────
@app.route('/')
@login_required
def dashboard():
    conn = db(); uid = session['user_id']
    if session['perfil'] == 'admin':
        m = {}
        m['propostas'] = conn.execute("SELECT COUNT(*) c FROM propostas WHERE status != 'Excluída'").fetchone()['c']
        m['vidas'] = conn.execute("SELECT COALESCE(SUM(total_vidas),0) v FROM propostas WHERE status != 'Excluída'").fetchone()['v']
        m['producao'] = conn.execute("SELECT COALESCE(SUM(valor),0) v FROM propostas WHERE status != 'Excluída'").fetchone()['v']
        m['com_bruta'] = conn.execute("SELECT COALESCE(SUM(comissao_total_corretora),0) v FROM propostas WHERE status != 'Excluída'").fetchone()['v']
        m['com_repasse'] = conn.execute("SELECT COALESCE(SUM(comissao_consultor),0) v FROM propostas WHERE status != 'Excluída'").fetchone()['v']
        m['com_liquido'] = conn.execute("SELECT COALESCE(SUM(comissao_corretora_liquida),0) v FROM propostas WHERE status != 'Excluída'").fetchone()['v']
        # Fluxo de caixa: apenas propostas Emitida/Ativa (trava financeira)
        m['fc_pendente'] = conn.execute("""SELECT COALESCE(SUM(pa.valor),0) v FROM parcelas pa
            JOIN propostas p ON p.id=pa.proposta_id
            WHERE pa.status='Pendente de receber' AND p.status_operacional='Emitida/Ativa'""").fetchone()['v']
        m['fc_caixa'] = conn.execute("""SELECT COALESCE(SUM(pa.valor),0) v FROM parcelas pa
            JOIN propostas p ON p.id=pa.proposta_id
            WHERE pa.status='Recebido e não repassado' AND p.status_operacional='Emitida/Ativa'""").fetchone()['v']
        m['fc_liberado'] = conn.execute("""SELECT COALESCE(SUM(pa.valor),0) v FROM parcelas pa
            JOIN propostas p ON p.id=pa.proposta_id
            WHERE pa.status='Liberado para o corretor' AND p.status_operacional='Emitida/Ativa'""").fetchone()['v']
        m['fc_pago'] = conn.execute("""SELECT COALESCE(SUM(pa.valor),0) v FROM parcelas pa
            JOIN propostas p ON p.id=pa.proposta_id
            WHERE pa.status='Pago ao corretor' AND p.status_operacional='Emitida/Ativa'""").fetchone()['v']
        m['fc_antecip'] = conn.execute("SELECT COUNT(*) c FROM parcelas WHERE status='Antecipação - Aguardando ADM'").fetchone()['c']
        # Alerta auditoria: propostas que precisam evoluir o status operacional
        m['auditoria_pendente'] = conn.execute("""SELECT COUNT(*) c FROM propostas
            WHERE status != 'Excluída' AND status_operacional NOT IN ('Emitida/Ativa')
            AND status_operacional IS NOT NULL""").fetchone()['c']
        ultimas = conn.execute("SELECT * FROM propostas WHERE status != 'Excluída' ORDER BY id DESC LIMIT 5").fetchall()
        por_operadora = conn.execute("""SELECT adm_operadora,COUNT(*) qtd,COALESCE(SUM(valor),0) valor
            FROM propostas WHERE status != 'Excluída' GROUP BY adm_operadora ORDER BY valor DESC LIMIT 8""").fetchall()
        por_consultor = conn.execute("""SELECT consultor,COUNT(*) qtd,COALESCE(SUM(valor),0) valor,COALESCE(SUM(comissao_consultor),0) com
            FROM propostas WHERE status != 'Excluída' GROUP BY consultor ORDER BY valor DESC""").fetchall()
        close_db(conn)
        return render_template('dashboard_admin.html', m=m, ultimas=ultimas,
                               por_operadora=por_operadora, por_consultor=por_consultor,
                               ciclo=ciclo_atual())
    else:
        m = {}
        ma = datetime.now(TZ_SP).strftime('%Y-%m')
        m['propostas'] = conn.execute("SELECT COUNT(*) c FROM propostas WHERE usuario_id=? AND status != 'Excluída'",(uid,)).fetchone()['c']
        m['vidas'] = conn.execute("SELECT COALESCE(SUM(total_vidas),0) v FROM propostas WHERE usuario_id=? AND status != 'Excluída'",(uid,)).fetchone()['v']
        m['producao'] = conn.execute("SELECT COALESCE(SUM(valor),0) v FROM propostas WHERE usuario_id=? AND status != 'Excluída'",(uid,)).fetchone()['v']
        m['minha_comissao'] = conn.execute("SELECT COALESCE(SUM(comissao_consultor),0) v FROM propostas WHERE usuario_id=? AND status != 'Excluída'",(uid,)).fetchone()['v']
        # mes_meta para metas comerciais (usa coluna mes_meta, não criado_em)
        m['mes_propostas'] = conn.execute("SELECT COUNT(*) c FROM propostas WHERE usuario_id=? AND status != 'Excluída' AND mes_meta=?",(uid,ma)).fetchone()['c']
        m['mes_producao'] = conn.execute("SELECT COALESCE(SUM(valor),0) v FROM propostas WHERE usuario_id=? AND status != 'Excluída' AND mes_meta=?",(uid,ma)).fetchone()['v']
        m['mes_comissao'] = conn.execute("SELECT COALESCE(SUM(comissao_consultor),0) v FROM propostas WHERE usuario_id=? AND status != 'Excluída' AND mes_meta=?",(uid,ma)).fetchone()['v']
        # Saldo do consultor por status de parcelas (apenas Emitida/Ativa)
        m['a_receber'] = conn.execute("""SELECT COALESCE(SUM(pa.valor),0) v FROM parcelas pa
            JOIN propostas p ON p.id=pa.proposta_id
            WHERE p.usuario_id=? AND pa.status='Liberado para o corretor' AND p.status_operacional='Emitida/Ativa'""",(uid,)).fetchone()['v']
        m['pago_total'] = conn.execute("""SELECT COALESCE(SUM(pa.valor),0) v FROM parcelas pa
            JOIN propostas p ON p.id=pa.proposta_id WHERE p.usuario_id=? AND pa.status='Pago ao corretor'""",(uid,)).fetchone()['v']
        m['antecip_solicitadas'] = conn.execute("""SELECT COUNT(*) c FROM parcelas pa
            JOIN propostas p ON p.id=pa.proposta_id WHERE p.usuario_id=? AND pa.comprovante_antecipacao IS NOT NULL""",(uid,)).fetchone()['c']
        # Pendências: parcelas bloqueadas por falta de comprovante
        m['bloqueadas'] = conn.execute("""SELECT COUNT(*) c FROM parcelas pa
            JOIN propostas p ON p.id=pa.proposta_id
            WHERE p.usuario_id=? AND pa.status='Bloqueado - Falta Comprovante'""",(uid,)).fetchone()['c']
        pendencias_comprovante = conn.execute("""SELECT p.id, p.razao_social, p.adm_operadora, COUNT(pa.id) qtd_bloq
            FROM propostas p JOIN parcelas pa ON pa.proposta_id=p.id
            WHERE p.usuario_id=? AND pa.status='Bloqueado - Falta Comprovante'
            GROUP BY p.id ORDER BY p.id DESC""",(uid,)).fetchall()
        rb = session.get('regime_base')
        if rb == 'com_lead':
            if m['mes_producao'] <= 3000: m['regime_label'] = 'Com Lead — N1 (até R$ 3.000)'
            elif m['mes_producao'] <= 7000: m['regime_label'] = 'Com Lead — N2 (até R$ 7.000)'
            else: m['regime_label'] = 'Com Lead — N3 (acima de R$ 7.000)'
        elif rb == 'com_fixo_lead': m['regime_label'] = 'Com Fixo + Com Lead'
        else: m['regime_label'] = 'Sem Lead e Sem Fixo'
        m['valor_fixo'] = 0
        if rb == 'com_fixo_lead':
            r = conn.execute("SELECT valor_fixo FROM regimes WHERE codigo='com_fixo_lead'").fetchone()
            m['valor_fixo'] = r['valor_fixo'] if r else 0
        pendentes_aceite = conn.execute("""SELECT pa.*, p.razao_social, p.adm_operadora FROM parcelas pa
            JOIN propostas p ON p.id=pa.proposta_id
            WHERE p.usuario_id=? AND pa.status='Liberado para o corretor' AND pa.aceite_corretor=0
            ORDER BY pa.id""",(uid,)).fetchall()
        ultimas = conn.execute("SELECT * FROM propostas WHERE usuario_id=? AND status != 'Excluída' ORDER BY id DESC LIMIT 5",(uid,)).fetchall()
        por_operadora = conn.execute("""SELECT adm_operadora,COUNT(*) qtd,COALESCE(SUM(valor),0) valor
            FROM propostas WHERE usuario_id=? AND status != 'Excluída' GROUP BY adm_operadora ORDER BY valor DESC LIMIT 6""",(uid,)).fetchall()
        close_db(conn)
        return render_template('dashboard_consultor.html', m=m, ultimas=ultimas,
                               por_operadora=por_operadora, pendentes_aceite=pendentes_aceite,
                               pendencias_comprovante=pendencias_comprovante)

# ─── PROPOSTAS ───────────────────────────────────────────────────────────────────
@app.route('/nova-proposta')
@login_required
def nova_proposta():
    conn = db()
    sups = conn.execute("SELECT * FROM supervisoras WHERE ativo=1 ORDER BY nome").fetchall()
    ops = conn.execute("SELECT DISTINCT operadora FROM recebimento ORDER BY operadora").fetchall()
    close_db(conn)
    return render_template('form.html', supervisoras=sups, operadoras=[o['operadora'] for o in ops])

@app.route('/salvar-proposta', methods=['POST'])
@login_required
def salvar_proposta():
    try:
        d = request.form

        def salvar_arquivo(file_field, prefixo):
            """Salva um único arquivo localmente e retorna o nome ou None."""
            f = request.files.get(file_field)
            if f and f.filename:
                nome_limpo = _sanitizar_filename(f.filename)
                n = f"{datetime.now(TZ_SP).strftime('%Y%m%d%H%M%S')}_{prefixo}_{nome_limpo}"
                caminho = os.path.join(UPLOAD_FOLDER, n)
                f.save(caminho)
                return n
            return None

        # Anexos genéricos (múltiplos)
        nomes = []
        for f in request.files.getlist('anexos'):
            if f and f.filename:
                nome_limpo = _sanitizar_filename(f.filename)
                n = f"{datetime.now(TZ_SP).strftime('%Y%m%d%H%M%S')}_doc_{nome_limpo}"
                caminho = os.path.join(UPLOAD_FOLDER, n)
                f.save(caminho)
                nomes.append(n)

        # Uploads dedicados
        contrato_arq = salvar_arquivo('contrato_arquivo', 'CONTRATO')
        comprovante_arq = salvar_arquivo('comprovante_boleto', 'BOLETO1')

        # Campos personalizados (form builder)
        conn0 = db()
        campos_def = conn0.execute("SELECT nome_tecnico FROM campos_custom WHERE ativo=1").fetchall()
        conn0.close()
        extras = {}
        for c in campos_def:
            chave = f"custom__{c['nome_tecnico']}"
            if chave in d:
                extras[c['nome_tecnico']] = d.get(chave)

        valor = float((d.get('valor','0') or '0').replace('.','').replace(',','.'))
        operadora = d.get('adm_operadora','')
        modalidade = d.get('modalidade','')
        regime_base = session.get('regime_base','sem_lead_sem_fixo')
        conn = db(); cur = conn.cursor()
        ma = datetime.now(TZ_SP).strftime('%Y-%m')
        # Produção do mês ANTES desta venda + esta venda = produção que define o nível.
        # (Regra: o nível é o da produção do dia em que a venda subiu, incluindo ela.)
        prod_antes = cur.execute("SELECT COALESCE(SUM(valor),0) v FROM propostas WHERE usuario_id=? AND strftime('%Y-%m',criado_em)=?",(session['user_id'],ma)).fetchone()['v']
        prod_acumulada = prod_antes + valor
        c = calc_comissao(operadora, regime_base, prod_acumulada, valor, modalidade, d.get('tipo_pessoa',''))
        # mes_meta = mês do fechamento (data_fechamento do form, ou mês atual)
        data_fechamento = d.get('data_fechamento','').strip()
        mes_meta = data_fechamento[:7] if (data_fechamento and len(data_fechamento) >= 7) else datetime.now(TZ_SP).strftime('%Y-%m')

        # status parcelas: bloqueado se sem comprovante
        status_parcela_inicial = 'Bloqueado - Falta Comprovante' if not comprovante_arq else 'Pendente de receber'

        cur.execute("""INSERT INTO propostas (
            usuario_id,consultor,supervisora_id,proposta_tem_numero,numero_proposta,
            vigencia,modalidade,tipo_pessoa,adm_operadora,produto,razao_social,
            cpf_titular,cnpj,titular_dependentes,tipo_contrato,acomodacao,fator_moderador,
            total_vidas,valor,venda_status,
            vencimento_1,previsao_1,resp_contrato,email_resp_contrato,tel_resp_contrato,
            resp_negociacao,email_resp_negociacao,tel_resp_negociacao,
            contatos_adicionais,desc_contatos_adicionais,
            regime_aplicado,num_parcelas,distribuicao_parcelas,
            comissao_total_corretora,comissao_consultor,comissao_corretora_liquida,
            observacoes,anexos,contrato_arquivo,comprovante_boleto,campos_extras,quem_subiu,
            mes_meta,status_operacional
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
            session['user_id'],d.get('consultor'),d.get('supervisora_id') or None,
            d.get('proposta_tem_numero'),d.get('numero_proposta'),
            d.get('vigencia'),d.get('modalidade'),d.get('tipo_pessoa'),
            operadora,d.get('produto'),d.get('razao_social'),
            d.get('cpf_titular'),d.get('cnpj'),d.get('titular_dependentes'),
            d.get('tipo_contrato'),d.get('acomodacao'),d.get('fator_moderador'),
            int(d.get('total_vidas') or 0),valor,
            d.get('venda_status','Sim'),
            d.get('vencimento_1'),d.get('previsao_1'),
            d.get('resp_contrato'),d.get('email_resp_contrato'),d.get('tel_resp_contrato'),
            d.get('resp_negociacao'),d.get('email_resp_negociacao'),d.get('tel_resp_negociacao'),
            d.get('contatos_adicionais'),d.get('desc_contatos_adicionais'),
            c['codigo'],c['num_parcelas'],c['dist_corretora'],
            c['total_corretora'],c['consultor'],c['liquido'],
            d.get('observacoes'),json.dumps(nomes),contrato_arq,comprovante_arq,
            json.dumps(extras, ensure_ascii=False),d.get('quem_subiu','Consultor'),
            mes_meta,'Aguardando Documentos'
        ))
        proposta_id = _last_insert_id(cur)
        dia_venc = d.get('dia_vencimento') or None
        if dia_venc:
            try: cur.execute("UPDATE propostas SET dia_vencimento=? WHERE id=?", (int(dia_venc), proposta_id))
            except: pass
        # Repique, datas de nascimento e dependentes
        try: deps = json.loads(d.get('dependentes_json') or '[]')
        except: deps = []
        repique = None
        if d.get('tem_repique'):
            rv = (d.get('repique_valor','') or '').replace('.','').replace(',','.')
            try: rv = float(rv) if rv else 0
            except: rv = 0
            repique = {'nome': d.get('repique_nome',''), 'tipo': d.get('repique_tipo',''), 'valor': rv}
        cur.execute("""UPDATE propostas SET data_nasc_titular=?, dependentes_json=?, tem_repique=?, repique_json=? WHERE id=?""",
            (d.get('data_nasc_titular',''), json.dumps(deps, ensure_ascii=False),
             1 if d.get('tem_repique') else 0, json.dumps(repique, ensure_ascii=False) if repique else None, proposta_id))
        for parc in gerar_parcelas(proposta_id, d.get('vigencia',''), c, dia_venc, status_override=status_parcela_inicial):
            cur.execute("""INSERT INTO parcelas (proposta_id,numero,percentual,valor,valor_corretora,perc_cliente,data_prevista,status,competencia,mensalidade_ref,tipo_origem)
                VALUES (?,?,?,?,?,?,?,?,?,?,'comissao')""", (parc['proposta_id'],parc['numero'],parc['percentual'],
                                          parc['valor'],parc['valor_corretora'],parc['perc_cliente'],
                                          parc['data_prevista'],parc['status'],parc['competencia'],parc['mensalidade_ref']))
        conn.commit(); close_db(conn)
        try:
            quem = session.get('nome') or c.get('consultor') or 'Consultor'
            cliente_prop = d.get('razao_social') or d.get('resp_contrato') or 'novo cliente'
            _notificar_admins('proposta', 'Nova proposta',
                              f"{quem} cadastrou proposta de {cliente_prop} ({operadora})",
                              '/proposta/' + str(proposta_id))
        except Exception:
            pass
        return jsonify({"ok": True})
    except Exception as e:
        import traceback
        tb = traceback.format_exc()
        app.logger.error(f"[SALVAR-PROPOSTA] ❌ Erro: {e}")
        app.logger.error(f"[SALVAR-PROPOSTA] Traceback:\n{tb}")
        print(f"[SALVAR-PROPOSTA] ❌ Erro: {e}")
        print(f"[SALVAR-PROPOSTA] Traceback:\n{tb}")
        return jsonify({"ok": False, "msg": str(e), "db_mode": DB_MODE}), 500

@app.route('/propostas')
@login_required
def listar_propostas():
    conn = db(); uid = session['user_id']
    if session['perfil'] == 'admin':
        rows = conn.execute("""SELECT p.*,s.nome as supervisora_nome FROM propostas p
            LEFT JOIN supervisoras s ON s.id=p.supervisora_id
            WHERE p.status != 'Excluída'
            ORDER BY p.id DESC""").fetchall()
    else:
        rows = conn.execute("""SELECT p.*,s.nome as supervisora_nome FROM propostas p
            LEFT JOIN supervisoras s ON s.id=p.supervisora_id
            WHERE p.usuario_id=? AND p.status != 'Excluída'
            ORDER BY p.id DESC""",(uid,)).fetchall()
    close_db(conn)
    return render_template('propostas.html', propostas=rows, modo_teste=session.get('modo_teste', False))

@app.route('/admin/modo-teste/toggle', methods=['POST'])
@login_required
@admin_required
def toggle_modo_teste():
    """Liga/desliga o Modo Teste (só admin, vive na sessão — some ao deslogar)."""
    novo = not session.get('modo_teste', False)
    session['modo_teste'] = novo
    return jsonify({"ok": True, "modo_teste": novo})

@app.route('/proposta/<int:pid>')
@login_required
def ver_proposta(pid):
    conn = db()
    p = conn.execute("""SELECT p.*,s.nome as supervisora_nome FROM propostas p
        LEFT JOIN supervisoras s ON s.id=p.supervisora_id WHERE p.id=?""",(pid,)).fetchone()
    if not p: return "Não encontrada", 404
    if session['perfil'] != 'admin' and p['usuario_id'] != session['user_id']: return "Acesso negado", 403
    parcelas = conn.execute("SELECT * FROM parcelas WHERE proposta_id=? ORDER BY numero ASC",(pid,)).fetchall()
    campos_def = conn.execute("SELECT * FROM campos_custom ORDER BY ordem,id").fetchall()
    close_db(conn)
    # Nome legível do modelo/regime aplicado
    cod = p['regime_aplicado'] or ''
    nome_regime = MODELO_NOME.get(cod, cod or '—')
    regime = {'nome': nome_regime}
    # Decodifica valores dos campos custom
    try:
        extras = json.loads(p['campos_extras']) if p['campos_extras'] else {}
    except: extras = {}
    extras_view = []
    for c in campos_def:
        if c['nome_tecnico'] in extras and extras[c['nome_tecnico']]:
            extras_view.append({'label': c['label'], 'valor': extras[c['nome_tecnico']]})
    # Valores atuais dos campos editáveis (para preencher o formulário de edição)
    valores_edit = {}
    for campo in CAMPOS_EDITAVEIS.keys():
        valores_edit[campo] = (p[campo] if campo in p.keys() else '') or ''

    # Solicitação de edição pendente (para o admin ver e aprovar/recusar)
    solic_pendente = None
    if session.get('perfil') == 'admin':
        sp = conn2 = db()
        row = conn2.execute("SELECT * FROM solicitacoes_edicao WHERE proposta_id=? AND status='Pendente' ORDER BY criado_em DESC LIMIT 1", (pid,)).fetchone()
        close_db(conn2)
        if row:
            solic_pendente = dict(row)
            try: solic_pendente['alteracoes_parsed'] = json.loads(row['alteracoes']) if row['alteracoes'] else {}
            except Exception: solic_pendente['alteracoes_parsed'] = {}

    return render_template('detalhe.html', p=p, parcelas=parcelas, regime=regime, extras=extras_view,
                           campos_secoes=CAMPOS_EDIT_SECOES, valores_edit=valores_edit,
                           solic_pendente=solic_pendente)

@app.route('/proposta/<int:pid>/consultor', methods=['POST'])
@login_required
@admin_required
def editar_consultor(pid):
    """Remaneja a proposta para outro consultor e RECALCULA a comissão pelo regime dele.
    Só regenera as parcelas que ainda NÃO entraram no fluxo (Pendente de receber)."""
    novo_uid = request.form.get('usuario_id')
    conn = db()
    u = conn.execute("SELECT * FROM usuarios WHERE id=?", (novo_uid,)).fetchone()
    p = conn.execute("SELECT * FROM propostas WHERE id=?", (pid,)).fetchone()
    if not u or not p:
        close_db(conn); return jsonify({"ok": False, "msg": "Consultor ou proposta inválidos"}), 400

    # Produção do mês do NOVO consultor (exceto esta proposta) + esta venda
    prod_antes = _producao_mes(conn, novo_uid, p['criado_em'], excluir_pid=pid)
    prod_acumulada = prod_antes + (p['valor'] or 0)
    c = calc_comissao(p['adm_operadora'], u['regime_base'], prod_acumulada, p['valor'] or 0, p['modalidade'], p['tipo_pessoa'] if 'tipo_pessoa' in p.keys() else '')

    conn.execute("""UPDATE propostas SET usuario_id=?, consultor=?, regime_aplicado=?,
        num_parcelas=?, distribuicao_parcelas=?, comissao_total_corretora=?, comissao_consultor=?,
        comissao_corretora_liquida=? WHERE id=?""",
        (novo_uid, u['nome'], c['codigo'], c['num_parcelas'], c['dist_corretora'],
         c['total_corretora'], c['consultor'], c['liquido'], pid))

    # Regenera apenas parcelas ainda "Pendente de receber"
    pagas = conn.execute("""SELECT COUNT(*) n FROM parcelas WHERE proposta_id=? AND status<>'Pendente de receber'""", (pid,)).fetchone()['n']
    if pagas == 0:
        conn.execute("DELETE FROM parcelas WHERE proposta_id=?", (pid,))
        for parc in gerar_parcelas(pid, p['vigencia'] or '', c, p['dia_vencimento'] if 'dia_vencimento' in p.keys() else None):
            conn.execute("""INSERT INTO parcelas (proposta_id,numero,percentual,valor,valor_corretora,perc_cliente,data_prevista,status,competencia,mensalidade_ref,tipo_origem)
                VALUES (?,?,?,?,?,?,?,?,?,?,'comissao')""", (parc['proposta_id'],parc['numero'],parc['percentual'],
                    parc['valor'],parc['valor_corretora'],parc['perc_cliente'],parc['data_prevista'],parc['status'],
                    parc['competencia'],parc['mensalidade_ref']))
        msg = "Consultor remanejado e comissão recalculada."
    else:
        msg = "Consultor trocado. Parcelas já em fluxo foram mantidas; só novas seguem o novo regime."
    conn.commit(); close_db(conn)
    return jsonify({"ok": True, "msg": msg})

@app.route('/propostas/recalcular-todas', methods=['POST'])
@login_required
@admin_required
def recalcular_todas():
    """Recalcula a comissão de TODAS as propostas com o motor atual.
    Só regenera parcelas que ainda não entraram no fluxo. Retorna relatório de avisos."""
    conn = db()
    props = conn.execute("""SELECT p.*, u.regime_base FROM propostas p
        LEFT JOIN usuarios u ON u.id=p.usuario_id WHERE COALESCE(p.estornada,0)=0""").fetchall()
    recalc, avisos = 0, []
    for p in props:
        regime = p['regime_base'] or 'sem_lead_sem_fixo'
        prod_antes = _producao_mes(conn, p['usuario_id'], p['criado_em'], excluir_pid=p['id'])
        prod_acum = prod_antes + (p['valor'] or 0)
        tp = p['tipo_pessoa'] if 'tipo_pessoa' in p.keys() else ''
        c = calc_comissao(p['adm_operadora'], regime, prod_acum, p['valor'] or 0, p['modalidade'], tp)
        conn.execute("""UPDATE propostas SET regime_aplicado=?, num_parcelas=?, distribuicao_parcelas=?,
            comissao_total_corretora=?, comissao_consultor=?, comissao_corretora_liquida=? WHERE id=?""",
            (c['codigo'], c['num_parcelas'], c['dist_corretora'],
             c['total_corretora'], c['consultor'], c['liquido'], p['id']))
        # Regenera só parcelas ainda pendentes de receber
        pagas = conn.execute("""SELECT COUNT(*) n FROM parcelas
            WHERE proposta_id=? AND status<>'Pendente de receber'""", (p['id'],)).fetchone()['n']
        if pagas == 0:
            conn.execute("DELETE FROM parcelas WHERE proposta_id=?", (p['id'],))
            for parc in gerar_parcelas(p['id'], p['vigencia'] or '', c,
                                       p['dia_vencimento'] if 'dia_vencimento' in p.keys() else None):
                conn.execute("""INSERT INTO parcelas (proposta_id,numero,percentual,valor,valor_corretora,perc_cliente,data_prevista,status,competencia,mensalidade_ref,tipo_origem)
                    VALUES (?,?,?,?,?,?,?,?,?,?,'comissao')""",
                    (parc['proposta_id'],parc['numero'],parc['percentual'],parc['valor'],
                     parc['valor_corretora'],parc['perc_cliente'],parc['data_prevista'],
                     parc['status'],parc['competencia'],parc['mensalidade_ref']))
        recalc += 1
        if c.get('aviso'):
            avisos.append({'id': p['id'], 'cliente': p['razao_social'],
                           'operadora': p['adm_operadora'], 'aviso': c['aviso']})
    conn.commit(); close_db(conn)
    return jsonify({"ok": True, "recalculadas": recalc, "avisos": avisos})

@app.route('/api/consultores')
@login_required
@admin_required
def api_consultores():
    conn = db()
    rows = conn.execute("SELECT id,nome,regime_base FROM usuarios WHERE ativo=1 AND perfil='consultor' ORDER BY nome").fetchall()
    close_db(conn)
    return jsonify([{'id': r['id'], 'nome': r['nome'],
                     'regime': MODELO_NOME.get(r['regime_base'], r['regime_base'] or '—')} for r in rows])

def get_cfg(chave, default=''):
    conn = db()
    r = conn.execute("SELECT valor FROM config WHERE chave=?", (chave,)).fetchone()
    close_db(conn)
    return r['valor'] if r else default

@app.route('/proposta/<int:pid>/email-affinity')
@login_required
def email_affinity(pid):
    """Monta o e-mail completo no padrão Serenus para a Affinity."""
    conn = db()
    p = conn.execute("SELECT * FROM propostas WHERE id=?", (pid,)).fetchone()
    close_db(conn)
    if not p: return jsonify({"ok": False}), 404

    # Dados base
    tipo_pessoa = (p['tipo_pessoa'] or '').upper()
    eh_empresa = bool(p['cnpj'])
    nome = p['razao_social'] or p['cpf_titular'] or 'Cliente'
    operadora = p['adm_operadora'] or '—'
    plano = p['produto'] or '—'
    valor_fmt = f"R$ {(p['valor'] or 0):,.2f}".replace(',','X').replace('.',',').replace('X','.')
    vidas = p['total_vidas'] or 1

    # Dependentes
    deps = []
    try: deps = json.loads(p['dependentes_json'] or '[]')
    except: pass

    # Monta linha de identificação
    if eh_empresa:
        ident = f"a empresa {nome} - CNPJ: {p['cnpj']}"
        linha_intro = f"ao contrato do plano de saúde {operadora} para {ident}"
    else:
        ident = nome
        if p['cpf_titular']:
            ident += f" (CPF: {p['cpf_titular']})"
        linha_intro = f"à proposta do plano de saúde {operadora} para o grupo familiar de {ident}"

    # Monta composição do grupo
    composicao = []
    titular_linha = f"Titular: {nome}"
    if p['cpf_titular']: titular_linha += f" (CPF: {p['cpf_titular']})"
    if p['data_nasc_titular']: titular_linha += f" - Nasc.: {p['data_nasc_titular']}"
    composicao.append(titular_linha)
    for dep in deps:
        dep_nome = dep.get('nome','')
        dep_tipo = dep.get('parentesco') or dep.get('tipo','Dependente')
        dep_cpf  = dep.get('cpf','')
        dep_linha = f"Dependente ({dep_tipo}): {dep_nome}"
        if dep_cpf: dep_linha += f" (CPF: {dep_cpf})"
        composicao.append(dep_linha)

    # Dados de contato
    email_contato = p['email_resp_contrato'] or p['email_resp_negociacao'] or ''
    tel_contato   = p['tel_resp_contrato'] or p['tel_resp_negociacao'] or ''

    # Endereço
    campos_extras = {}
    try: campos_extras = json.loads(p['campos_extras'] or '{}')
    except: pass
    endereco_parts = [
        campos_extras.get('endereco',''),
        campos_extras.get('numero',''),
        campos_extras.get('complemento',''),
        campos_extras.get('bairro',''),
        campos_extras.get('cidade',''),
        campos_extras.get('estado',''),
        campos_extras.get('cep',''),
    ]
    endereco = '\n'.join(x for x in endereco_parts if x)

    # Assunto
    tipo_label = 'Empresa' if eh_empresa else 'PF'
    assunto = f"Solicitação de Protocolo - Venda {operadora} - {tipo_label} - {nome}"

    # Corpo em texto puro (editável no modal)
    comp_str = '\n'.join(composicao)
    end_str  = endereco or '(não informado)'

    corpo = f"""Olá, Pamela, tudo bem?

Gostaria de solicitar o protocolo de venda referente {linha_intro}.

Seguem os detalhes da proposta para conferência:
Plano: {plano}

Condição: {p['fator_moderador'] or '—'}

Valor do grupo: {valor_fmt}

Composição do Grupo ({vidas} {'vida' if int(vidas)==1 else 'vidas'}):
{comp_str}

DADOS DE CONTATO:
E-MAIL: {email_contato}
TELEFONE: {tel_contato}

DADOS DO ENDEREÇO:
{end_str}

SOLICITO VIGÊNCIA: {p['vigencia'] or '—'}
VENCIMENTO DIA: {p['dia_vencimento'] or '—'} de cada mês.

{p['observacoes'] or ''}

Seguem em anexo todos os documentos necessários para a formalização.
Poderia me enviar o protocolo para darmos prosseguimento ao processo junto ao cliente?

Fico no aguardo e agradeço desde já.

Atenciosamente,
{session.get('nome','Guilherme Augusto Santos')}
Serenus Corretora de Saúde"""

    tem_comprovante = bool(p['comprovante_boleto'])
    tem_contrato    = bool(p['contrato_arquivo'])

    return jsonify({
        "ok": True,
        "assunto": assunto,
        "corpo": corpo,
        "tem_comprovante": tem_comprovante,
        "tem_contrato": tem_contrato,
        "aviso_anexo": not (tem_comprovante or tem_contrato),
    })

def _montar_email_html_profissional(corpo_texto, particularidades='', eh_teste=False, pid=None):
    """Monta HTML profissional e elegante para o e-mail de protocolo."""
    logo_url = "https://job-serenus-production.up.railway.app/static/logo_arcos.png"
    
    # Converte corpo texto em HTML preservando quebras de linha e formatação
    linhas_html = []
    for linha in corpo_texto.split('\n'):
        linha_limpa = linha.strip()
        if not linha_limpa:
            linhas_html.append('</p><p style="margin:12px 0;">')
        elif ':' in linha_limpa and any(x in linha_limpa.upper() for x in ['PLANO:', 'OPERADORA:', 'TITULAR:', 'DADOS', 'VIGÊNCIA', 'VENCIMENTO', 'VALOR']):
            # Linhas com dados
            partes = linha_limpa.split(':', 1)
            label = partes[0].strip()
            valor = partes[1].strip() if len(partes) > 1 else ''
            linhas_html.append(f'<strong style="color:#0f1f33;">{label}:</strong> <span style="color:#666;">{valor}</span><br>')
        else:
            linhas_html.append(f'{linha_limpa}<br>')
    
    corpo_html_body = ''.join(linhas_html).replace('<br></p>', '</p>').replace('<p style="margin:12px 0;"><br>', '<p style="margin:12px 0;">')
    
    if particularidades:
        corpo_html_body += f'<p style="margin-top:20px; padding:14px; background:#f8f9fb; border-left:3px solid #1fd8a4;"><strong style="color:#0f1f33;">Observações importantes:</strong><br>{particularidades.replace(chr(10),"<br>")}</p>'
    
    html = f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {{ margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f7fa; color: #333; }}
    .wrapper {{ background: #f5f7fa; padding: 24px; }}
    .container {{ max-width: 640px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }}
    .header {{ background: linear-gradient(135deg, #0f1f33 0%, #1a2f4a 100%); padding: 32px; text-align: center; }}
    .logo {{ height: 40px; margin-bottom: 16px; display: block; margin-left: auto; margin-right: auto; }}
    .header-title {{ color: white; font-size: 24px; font-weight: 700; margin: 0; letter-spacing: -0.5px; }}
    .header-subtitle {{ color: #1fd8a4; font-size: 12px; font-weight: 600; margin: 10px 0 0; letter-spacing: 0.8px; text-transform: uppercase; }}
    .stripe {{ background: #1fd8a4; height: 4px; }}
    .content {{ padding: 40px 36px; }}
    .content p {{ margin: 16px 0; line-height: 1.7; font-size: 14px; }}
    .content p:first-child {{ margin-top: 0; }}
    .section-title {{ font-size: 13px; font-weight: 700; color: #0f1f33; text-transform: uppercase; letter-spacing: 0.8px; margin: 28px 0 16px; padding-bottom: 10px; border-bottom: 2px solid #1fd8a4; }}
    .footer {{ background: #f0f2f5; border-top: 1px solid #e5e9f0; padding: 24px 36px; font-size: 12px; color: #666; line-height: 1.8; }}
    .footer-brand {{ font-weight: 700; color: #0f1f33; margin-bottom: 4px; }}
    .footer-small {{ font-size: 11px; color: #999; margin-top: 12px; padding-top: 12px; border-top: 1px solid #d1d5db; }}
    .test-banner {{ background: #f43f7c; color: white; padding: 14px 36px; text-align: center; font-size: 13px; font-weight: 700; letter-spacing: 0.5px; }}
    .cta {{ background: #f8f9fb; border-left: 4px solid #1fd8a4; padding: 16px; margin: 24px 0; font-size: 13px; color: #333; }}
    .cta strong {{ color: #0f1f33; }}
    br {{ display: block; line-height: 1.2; }}
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      {"<div class='test-banner'>MODO TESTE — Este e-mail foi enviado apenas para você. A Affinity não recebeu.</div>" if eh_teste else ""}
      
      <div class="header">
        <img src="{logo_url}" alt="Serenus" class="logo">
        <h1 class="header-title">Solicitação de Protocolo</h1>
        <p class="header-subtitle">Implantação de Proposta · Sistema JOB</p>
      </div>
      
      <div class="stripe"></div>
      
      <div class="content">
        <p>{corpo_html_body}</p>
        
        <div class="cta">
          <strong style="color: #0f1f33;">Próximos passos:</strong><br>
          Por favor, analise a proposta e nos envie o protocolo de implantação para prosseguirmos junto ao cliente.
        </div>
      </div>
      
      <div class="footer">
        <div class="footer-brand">Serenus Corretora de Saúde</div>
        <div>guilherme@serenuscorretora.com.br</div>
        <div class="footer-small">
          Sistema JOB{f' • Proposta #{pid}' if pid else ''} • {datetime.now(TZ_SP).strftime('%d/%m/%Y às %H:%M')}
        </div>
      </div>
    </div>
  </div>
</body>
</html>"""
    
    return html


@app.route('/proposta/<int:pid>/enviar-teste', methods=['POST'])
@login_required
@admin_required
def enviar_email_teste(pid):
    """Envia o e-mail de protocolo APENAS para guilherme@serenuscorretora.com.br (modo teste)."""
    DEST_TESTE = "guilherme@serenuscorretora.com.br"

    d = request.json or {}
    assunto      = d.get('assunto', '').strip()
    corpo_texto  = d.get('corpo', '').strip()
    particularidades = d.get('particularidades', '').strip()

    if not assunto or not corpo_texto:
        return jsonify({"ok": False, "msg": "Assunto e corpo são obrigatórios."}), 400

    # Busca a proposta — anexa SÓ os documentos iniciais (extras), igual ao envio real.
    # Comprovante e proposta assinada NÃO vão no protocolo (são da antecipação).
    lista_anexos = []
    conn = db()
    p = conn.execute("SELECT anexos FROM propostas WHERE id=?", (pid,)).fetchone()
    close_db(conn)
    if p:
        try:
            _raw = json.loads(p['anexos']) if p['anexos'] else []
            extras = [x['nome'] if isinstance(x, dict) else x for x in _raw]
            lista_anexos.extend([a for a in extras if a])
        except Exception:
            pass
    print(f"[TESTE PROTOCOLO pid={pid}] anexos iniciais ({len(lista_anexos)}): {lista_anexos} | UPLOAD_FOLDER={UPLOAD_FOLDER}")

    corpo_html = _montar_email_html_profissional(corpo_texto, particularidades, eh_teste=True, pid=pid)
    enviado = _enviar_email(DEST_TESTE, f"[TESTE] {assunto}", corpo_html, anexos=lista_anexos)

    if enviado:
        return jsonify({"ok": True, "msg": f"E-mail de teste enviado para {DEST_TESTE} com {len(lista_anexos)} documento(s) inicial(is). Verifique sua caixa de entrada."})
    else:
        erro = getattr(_enviar_email, 'ultimo_erro', None) or "BREVO_API_KEY não configurada no Railway."
        return jsonify({"ok": False, "msg": f"Falha no envio: {erro}"}), 500

@app.route('/proposta/<int:pid>/enviar-plataforma', methods=['POST'])
@login_required
@admin_required
def enviar_plataforma(pid):
    """Envia o e-mail de protocolo para a Affinity via Brevo com HTML profissional."""
    DEST_AFFINITY = "pamela.lima@affinitycorretora.com.br, kaique.silva@affinitycorretora.com.br, equipe.pl@affinitycorretora.com.br"
    CC_SERENUS = "guilherme@serenuscorretora.com.br"

    d = request.json or {}
    assunto      = d.get('assunto', '').strip()
    corpo_texto  = d.get('corpo', '').strip()
    particularidades = d.get('particularidades', '').strip()

    conn = db()
    p = conn.execute("SELECT * FROM propostas WHERE id=?", (pid,)).fetchone()
    if not p:
        close_db(conn)
        return jsonify({"ok": False, "msg": "Proposta não encontrada"}), 404

    # Coleta SÓ os documentos iniciais (extras): Contrato Social, RG, CNPJ, etc.
    # O comprovante de pagamento e a proposta assinada NÃO vão no protocolo —
    # são documentos finais, usados apenas na antecipação de comissão.
    lista_anexos = []
    try:
        _raw = json.loads(p['anexos']) if p['anexos'] else []
        extras = [x['nome'] if isinstance(x, dict) else x for x in _raw]
        lista_anexos.extend([a for a in extras if a])
    except Exception:
        pass

    # Trava: exige ao menos um documento inicial anexado
    if not lista_anexos:
        close_db(conn)
        return jsonify({"ok": False, "msg": "Anexe ao menos um documento inicial (Contrato Social, RG, CNPJ, etc.) antes de enviar o protocolo à Affinity."}), 400

    if not assunto or not corpo_texto:
        close_db(conn)
        return jsonify({"ok": False, "msg": "Assunto e corpo do e-mail são obrigatórios."}), 400

    corpo_html = _montar_email_html_profissional(corpo_texto, particularidades, eh_teste=False, pid=pid)

    enviado = _enviar_email(DEST_AFFINITY, assunto, corpo_html, cc=CC_SERENUS, anexos=lista_anexos)

    if enviado:
        conn.execute("UPDATE propostas SET status_operacional='Em Análise Operadora' WHERE id=?", (pid,))
        conn.execute("""INSERT INTO historico_proposta (proposta_id,usuario_id,usuario_nome,tipo,descricao,criado_em)
            VALUES (?,?,?,?,?,?)""", (pid, session['user_id'], session.get('nome','admin'),
            'plataforma', f"E-mail de protocolo enviado à Affinity. Assunto: {assunto}", datetime.now(TZ_SP)))
        conn.commit(); close_db(conn)
        return jsonify({"ok": True, "msg": "E-mail enviado. Status atualizado para 'Em Análise Operadora'."})
    else:
        close_db(conn)
        return jsonify({"ok": False, "msg": "BREVO_API_KEY não configurada no Railway. E-mail não enviado."}), 500


# ─── ANTECIPAÇÃO DE COMISSÃO (Affinity) ──────────────────────────────────────
@app.route('/proposta/<int:pid>/antecipacao/preview')
@login_required
@admin_required
def antecipacao_preview(pid):
    """Verifica elegibilidade e monta o rascunho do e-mail de antecipação."""
    conn = db()
    p = conn.execute("SELECT * FROM propostas WHERE id=?", (pid,)).fetchone()
    close_db(conn)
    if not p:
        return jsonify({"ok": False, "msg": "Proposta não encontrada"}), 404

    operadora = p['adm_operadora'] or ''
    tp = p['tipo_pessoa'] if 'tipo_pessoa' in p.keys() else ''
    plano = _plano_from_modalidade(p['modalidade'], tp)
    op_nome, _ = _split_operadora(operadora)
    permitido = antecipacao_permitida(op_nome, plano)

    # Documentos disponíveis
    tem_contrato = bool(p['contrato_arquivo'])
    tem_comprovante = bool(p['comprovante_boleto'])

    cliente = p['razao_social'] or ''
    # Documento do titular (CPF formatado se PF, CNPJ se PME)
    doc = (p['cpf_titular'] if 'cpf_titular' in p.keys() and p['cpf_titular'] else
           (p['cnpj'] if 'cnpj' in p.keys() and p['cnpj'] else ''))

    return jsonify({
        "ok": True,
        "permitido": permitido,
        "operadora": op_nome,
        "plano": plano,
        "cliente": cliente,
        "documento": doc,
        "tem_contrato": tem_contrato,
        "tem_comprovante": tem_comprovante,
        "motivo_bloqueio": "" if permitido else f"A operadora {op_nome} não permite antecipação de comissão no plano {plano} (regra Affinity).",
    })


@app.route('/proposta/<int:pid>/antecipacao/enviar', methods=['POST'])
@login_required
@admin_required
def antecipacao_enviar(pid):
    """Envia o e-mail de solicitação de antecipação de comissão à Affinity, com anexos.
    Registra no histórico da proposta."""
    DEST_AFFINITY = "pamela.lima@affinitycorretora.com.br, kaique.silva@affinitycorretora.com.br, equipe.pl@affinitycorretora.com.br"
    CC_SERENUS = "guilherme@serenuscorretora.com.br"

    d = request.json or {}
    numero_contrato = (d.get('numero_contrato') or '').strip()
    eh_teste = bool(d.get('teste'))

    conn = db()
    p = conn.execute("SELECT * FROM propostas WHERE id=?", (pid,)).fetchone()
    if not p:
        close_db(conn)
        return jsonify({"ok": False, "msg": "Proposta não encontrada"}), 404

    operadora = p['adm_operadora'] or ''
    tp = p['tipo_pessoa'] if 'tipo_pessoa' in p.keys() else ''
    plano = _plano_from_modalidade(p['modalidade'], tp)
    op_nome, _ = _split_operadora(operadora)

    # Trava 1: operadora precisa permitir antecipação
    if not antecipacao_permitida(op_nome, plano):
        close_db(conn)
        return jsonify({"ok": False, "msg": f"A operadora {op_nome} não permite antecipação de comissão no plano {plano} (regra Affinity)."}), 400

    # Trava 2: precisa do contrato E do comprovante anexados
    if not p['contrato_arquivo'] or not p['comprovante_boleto']:
        close_db(conn)
        faltam = []
        if not p['contrato_arquivo']: faltam.append("contrato assinado")
        if not p['comprovante_boleto']: faltam.append("comprovante de pagamento")
        return jsonify({"ok": False, "msg": f"Para solicitar antecipação é necessário anexar: {' e '.join(faltam)}."}), 400

    # Trava 3: número do contrato é obrigatório
    if not numero_contrato:
        close_db(conn)
        return jsonify({"ok": False, "msg": "Informe o número do contrato."}), 400

    cliente = p['razao_social'] or ''
    doc = (p['cpf_titular'] if 'cpf_titular' in p.keys() and p['cpf_titular'] else
           (p['cnpj'] if 'cnpj' in p.keys() and p['cnpj'] else ''))
    linha_cliente = f"{doc} {cliente}".strip() if doc else cliente
    linha_cliente = f"{linha_cliente} (Contrato Nº {numero_contrato})"

    assunto = "Solicitação de Antecipação de Comissão - Contratos"
    corpo_html = _montar_email_antecipacao_html([linha_cliente], eh_teste=eh_teste, pid=pid)

    # Anexos da ANTECIPAÇÃO: SOMENTE comprovante de pagamento + contrato/proposta assinada
    # (documentos finais). Os documentos iniciais/extras NÃO entram aqui.
    lista_anexos = [p['comprovante_boleto'], p['contrato_arquivo']]
    lista_anexos = [a for a in lista_anexos if a]

    destino = CC_SERENUS if eh_teste else DEST_AFFINITY
    assunto_final = f"[TESTE] {assunto}" if eh_teste else assunto
    cc = None if eh_teste else CC_SERENUS
    enviado = _enviar_email(destino, assunto_final, corpo_html, cc=cc, anexos=lista_anexos)

    if enviado:
        if not eh_teste:
            conn.execute("""INSERT INTO historico_proposta (proposta_id,usuario_id,usuario_nome,tipo,descricao,criado_em)
                VALUES (?,?,?,?,?,?)""", (pid, session['user_id'], session.get('nome','admin'),
                'antecipacao', f"Solicitação de antecipação de comissão enviada à Affinity. Contrato Nº {numero_contrato} · {op_nome}/{plano}.", datetime.now(TZ_SP)))
            conn.commit()
        close_db(conn)
        destino_msg = "para você (teste)" if eh_teste else "à Affinity"
        return jsonify({"ok": True, "msg": f"Solicitação de antecipação enviada {destino_msg} com {len(lista_anexos)} anexo(s)."})
    else:
        close_db(conn)
        erro = getattr(_enviar_email, 'ultimo_erro', None) or "BREVO_API_KEY não configurada no Railway."
        return jsonify({"ok": False, "msg": f"Falha no envio: {erro}"}), 500


def _montar_email_antecipacao_html(linhas_clientes, eh_teste=False, pid=None):
    """Monta o HTML do e-mail de antecipação no MESMO padrão visual do e-mail de proposta.
    linhas_clientes: lista de strings (ex: '63 299 486 WILLAMI ... (Contrato Nº 97106295)')."""
    logo_url = "https://job-serenus-production.up.railway.app/static/logo_arcos.png"
    plural = len(linhas_clientes) > 1
    termo_contrato = "aos contratos recém-implantados" if plural else "ao contrato recém-implantado"
    termo_dados = "os dados dos clientes" if plural else "os dados do cliente"
    termo_anexo = ("Os contratos assinados e os respectivos comprovantes de pagamento já estão anexados a este e-mail."
                   if plural else
                   "O contrato assinado e o respectivo comprovante de pagamento já estão anexados a este e-mail.")
    itens = ''.join(
        f'<div style="padding:10px 14px; background:#f8f9fb; border-left:3px solid #1fd8a4; margin:8px 0; font-size:14px; color:#0f1f33; font-weight:600;">{l}</div>'
        for l in linhas_clientes
    )

    html = f"""<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {{ margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f7fa; color: #333; }}
    .wrapper {{ background: #f5f7fa; padding: 24px; }}
    .container {{ max-width: 640px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }}
    .header {{ background: linear-gradient(135deg, #0f1f33 0%, #1a2f4a 100%); padding: 32px; text-align: center; }}
    .logo {{ height: 40px; margin-bottom: 16px; display: block; margin-left: auto; margin-right: auto; }}
    .header-title {{ color: white; font-size: 24px; font-weight: 700; margin: 0; letter-spacing: -0.5px; }}
    .header-subtitle {{ color: #1fd8a4; font-size: 12px; font-weight: 600; margin: 10px 0 0; letter-spacing: 0.8px; text-transform: uppercase; }}
    .stripe {{ background: #1fd8a4; height: 4px; }}
    .content {{ padding: 40px 36px; }}
    .content p {{ margin: 16px 0; line-height: 1.7; font-size: 14px; }}
    .content p:first-child {{ margin-top: 0; }}
    .section-title {{ font-size: 13px; font-weight: 700; color: #0f1f33; text-transform: uppercase; letter-spacing: 0.8px; margin: 28px 0 14px; padding-bottom: 10px; border-bottom: 2px solid #1fd8a4; }}
    .footer {{ background: #f0f2f5; border-top: 1px solid #e5e9f0; padding: 24px 36px; font-size: 12px; color: #666; line-height: 1.8; }}
    .footer-brand {{ font-weight: 700; color: #0f1f33; margin-bottom: 4px; }}
    .footer-small {{ font-size: 11px; color: #999; margin-top: 12px; padding-top: 12px; border-top: 1px solid #d1d5db; }}
    .test-banner {{ background: #f43f7c; color: white; padding: 14px 36px; text-align: center; font-size: 13px; font-weight: 700; letter-spacing: 0.5px; }}
    .cta {{ background: #f8f9fb; border-left: 4px solid #1fd8a4; padding: 16px; margin: 24px 0; font-size: 13px; color: #333; }}
    .cta strong {{ color: #0f1f33; }}
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      {"<div class='test-banner'>MODO TESTE — Este e-mail foi enviado apenas para você. A Affinity não recebeu.</div>" if eh_teste else ""}

      <div class="header">
        <img src="{logo_url}" alt="Serenus" class="logo">
        <h1 class="header-title">Antecipação de Comissão</h1>
        <p class="header-subtitle">Solicitação de Antecipação · Sistema JOB</p>
      </div>

      <div class="stripe"></div>

      <div class="content">
        <p>Prezada Pamela,</p>
        <p>Gostaria de solicitar a antecipação do pagamento da comissão referente {termo_contrato}. Seguem abaixo {termo_dados} para conferência:</p>

        <div class="section-title">Dados para Conferência</div>
        {itens}

        <p>{termo_anexo}</p>
        <p>Poderiam me confirmar o recebimento e o prazo para a liberação da antecipação?</p>

        <div class="cta">
          <strong>À disposição:</strong><br>
          Fico à disposição caso precisem de mais alguma informação ou documentação adicional.
        </div>

        <p style="margin-top:24px;">Atenciosamente,</p>
      </div>

      <div class="footer">
        <div class="footer-brand">Serenus Corretora de Saúde</div>
        <div>guilherme@serenuscorretora.com.br</div>
        <div class="footer-small">
          Sistema JOB{f' • Proposta #{pid}' if pid else ''} • {datetime.now(TZ_SP).strftime('%d/%m/%Y às %H:%M')}
        </div>
      </div>
    </div>
  </div>
</body>
</html>"""
    return html


@app.route('/api/etiquetas')
@login_required
def api_etiquetas():
    conn = db()
    todas = conn.execute("SELECT * FROM etiquetas ORDER BY nome").fetchall()
    pid = request.args.get('proposta_id')
    marcadas = []
    if pid:
        marcadas = [r['etiqueta_id'] for r in conn.execute("SELECT etiqueta_id FROM proposta_etiquetas WHERE proposta_id=?", (pid,)).fetchall()]
    close_db(conn)
    return jsonify({'todas': [dict(e) for e in todas], 'marcadas': marcadas})

@app.route('/etiqueta/criar', methods=['POST'])
@login_required
@admin_required
def etiqueta_criar():
    d = request.json or {}
    conn = db()
    try:
        conn.execute("INSERT INTO etiquetas (nome,cor) VALUES (?,?)", (d['nome'], d.get('cor','#1fd8a4')))
        conn.commit()
    except sqlite3.IntegrityError: pass
    close_db(conn)
    return jsonify({"ok": True})

@app.route('/proposta/<int:pid>/etiquetas', methods=['POST'])
@login_required
def proposta_etiquetas(pid):
    ids = (request.json or {}).get('etiquetas', [])
    conn = db()
    conn.execute("DELETE FROM proposta_etiquetas WHERE proposta_id=?", (pid,))
    for eid in ids:
        conn.execute("INSERT OR IGNORE INTO proposta_etiquetas (proposta_id,etiqueta_id) VALUES (?,?)", (pid, eid))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})

# ─── DIAGNÓSTICO DO DRIVE ─────────────────────────────────────────────────────────
# ─── PRODUTOS / PLANOS POR OPERADORA ──────────────────────────────────────────────
@app.route('/produtos')
@login_required
@admin_required
def produtos():
    conn = db()
    rows = conn.execute("SELECT * FROM produtos WHERE ativo=1 ORDER BY operadora, nome").fetchall()
    ops = conn.execute("SELECT DISTINCT operadora FROM recebimento ORDER BY operadora").fetchall()
    close_db(conn)
    return render_template('produtos.html', produtos=rows, operadoras=[o['operadora'] for o in ops])

@app.route('/produto/salvar', methods=['POST'])
@login_required
@admin_required
def produto_salvar():
    d = request.json or {}
    conn = db()
    if d.get('id'):
        conn.execute("""UPDATE produtos SET operadora=?,nome=?,tipo_plano=?,acomodacao=?,coparticipacao=?,observacao=? WHERE id=?""",
            (d['operadora'],d['nome'],d.get('tipo_plano',''),d.get('acomodacao',''),d.get('coparticipacao',''),d.get('observacao',''),d['id']))
    else:
        conn.execute("""INSERT INTO produtos (operadora,nome,tipo_plano,acomodacao,coparticipacao,observacao) VALUES (?,?,?,?,?,?)""",
            (d['operadora'],d['nome'],d.get('tipo_plano',''),d.get('acomodacao',''),d.get('coparticipacao',''),d.get('observacao','')))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})

@app.route('/produto/excluir/<int:prid>', methods=['POST'])
@login_required
@admin_required
def produto_excluir(prid):
    conn = db(); conn.execute("UPDATE produtos SET ativo=0 WHERE id=?", (prid,))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})

@app.route('/api/produtos')
@login_required
def api_produtos():
    op = request.args.get('operadora','')
    conn = db()
    if op:
        rows = conn.execute("SELECT * FROM produtos WHERE ativo=1 AND operadora=? ORDER BY nome", (op,)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM produtos WHERE ativo=1 ORDER BY operadora,nome").fetchall()
    close_db(conn)
    return jsonify([dict(r) for r in rows])

# ─── EDITAR PROPOSTA + TIMELINE ───────────────────────────────────────────────────
# Campos editáveis organizados por seção (usado no modal de edição completa).
# 'tipo' define o input no front: text, number, date, money, select, textarea.
CAMPOS_EDIT_SECOES = [
    {'secao': 'Cliente', 'campos': [
        {'k': 'razao_social',       'label': 'Razão social / Nome',   'tipo': 'text'},
        {'k': 'cnpj',               'label': 'CNPJ',                   'tipo': 'text'},
        {'k': 'cpf_titular',        'label': 'CPF do titular',        'tipo': 'text'},
        {'k': 'data_nasc_titular',  'label': 'Nascimento do titular', 'tipo': 'date'},
        {'k': 'total_vidas',        'label': 'Total de vidas',        'tipo': 'number'},
        {'k': 'titular_dependentes','label': 'Titular + dependentes', 'tipo': 'text'},
    ]},
    {'secao': 'Plano', 'campos': [
        {'k': 'adm_operadora',  'label': 'Operadora',        'tipo': 'text'},
        {'k': 'produto',        'label': 'Produto / Plano',  'tipo': 'text'},
        {'k': 'modalidade',     'label': 'Modalidade',       'tipo': 'text'},
        {'k': 'tipo_pessoa',    'label': 'Tipo de pessoa',   'tipo': 'select', 'opcoes': ['PF','PJ']},
        {'k': 'tipo_contrato',  'label': 'Tipo de contrato', 'tipo': 'text'},
        {'k': 'acomodacao',     'label': 'Acomodação',       'tipo': 'text'},
        {'k': 'fator_moderador','label': 'Coparticipação',   'tipo': 'text'},
    ]},
    {'secao': 'Valores e Datas', 'campos': [
        {'k': 'valor',          'label': 'Valor (mensalidade)', 'tipo': 'money'},
        {'k': 'vigencia',       'label': 'Vigência',            'tipo': 'date'},
        {'k': 'dia_vencimento', 'label': 'Dia de vencimento',   'tipo': 'number'},
        {'k': 'numero_proposta','label': 'Número da proposta',  'tipo': 'text'},
    ]},
    {'secao': 'Responsável pelo contrato', 'campos': [
        {'k': 'resp_contrato',       'label': 'Nome',     'tipo': 'text'},
        {'k': 'email_resp_contrato', 'label': 'E-mail',   'tipo': 'text'},
        {'k': 'tel_resp_contrato',   'label': 'Telefone', 'tipo': 'text'},
    ]},
    {'secao': 'Responsável pela negociação', 'campos': [
        {'k': 'resp_negociacao',       'label': 'Nome',     'tipo': 'text'},
        {'k': 'email_resp_negociacao', 'label': 'E-mail',   'tipo': 'text'},
        {'k': 'tel_resp_negociacao',   'label': 'Telefone', 'tipo': 'text'},
    ]},
    {'secao': 'Observações', 'campos': [
        {'k': 'observacoes', 'label': 'Observações', 'tipo': 'textarea'},
    ]},
]
# Mapa plano {campo: label} derivado das seções (compatível com código existente).
CAMPOS_EDITAVEIS = {c['k']: c['label'] for s in CAMPOS_EDIT_SECOES for c in s['campos']}

@app.route('/proposta/<int:pid>/editar', methods=['POST'])
@login_required
@admin_required
def proposta_editar(pid):
    """Edição completa de propostas — todos os campos (admin)."""
    d = request.json or {}
    conn = db()
    p = conn.execute("SELECT * FROM propostas WHERE id=?", (pid,)).fetchone()
    if not p: close_db(conn); return jsonify({"ok": False}), 404
    
    nome_user = session.get('nome','admin')
    user_id = session.get('user_id')
    
    # Campos numéricos para conversão
    NUMERICOS = {'valor','total_vidas','dia_vencimento','num_parcelas','comissao_total_corretora','comissao_consultor','comissao_corretora_liquida'}
    
    def conv(campo, v):
        if campo in NUMERICOS:
            s = str(v or '').replace('.','').replace(',','.') if campo in ('valor','comissao_total_corretora','comissao_consultor','comissao_corretora_liquida') else str(v or '')
            try: return float(s) if campo in ('valor','comissao_total_corretora','comissao_consultor','comissao_corretora_liquida') else int(s or 0)
            except: return 0
        return v
    
    mudou = []
    
    # Edição restrita a CAMPOS_EDITAVEIS (mantém compatibilidade)
    for campo, label in CAMPOS_EDITAVEIS.items():
        if campo in d:
            antes = p[campo] if campo in p.keys() else ''
            depois = conv(campo, d[campo])
            if str(antes or '') != str(depois or ''):
                conn.execute(f"UPDATE propostas SET {campo}=? WHERE id=?", (depois, pid))
                conn.execute("""INSERT INTO historico_proposta (proposta_id,usuario_id,usuario_nome,campo,valor_antes,valor_depois,criado_em)
                    VALUES (?,?,?,?,?,?,?)""", (pid, user_id, nome_user, label, str(antes or '—'), str(depois or '—'), datetime.now(TZ_SP)))
                mudou.append(label)
    
    # Edição expandida: campos adicionais fora de CAMPOS_EDITAVEIS
    CAMPOS_ADICIONAIS = {
        'razao_social': 'Razão Social',
        'cpf_titular': 'CPF Titular',
        'cnpj': 'CNPJ',
        'valor': 'Valor da Venda',
        'vigencia': 'Vigência',
        'modalidade': 'Modalidade',
        'tipo_pessoa': 'Tipo Pessoa',
        'adm_operadora': 'Operadora',
        'produto': 'Produto',
        'total_vidas': 'Total de Vidas',
        'regime_aplicado': 'Regime Aplicado',
        'observacoes': 'Observações',
        'campos_extras': 'Campos Extras (JSON)',
    }
    
    for campo, label in CAMPOS_ADICIONAIS.items():
        if campo in d and campo not in CAMPOS_EDITAVEIS:
            antes = p[campo] if campo in p.keys() else ''
            depois = conv(campo, d[campo])
            if str(antes or '') != str(depois or ''):
                conn.execute(f"UPDATE propostas SET {campo}=? WHERE id=?", (depois, pid))
                conn.execute("""INSERT INTO historico_proposta (proposta_id,usuario_id,usuario_nome,campo,valor_antes,valor_depois,criado_em)
                    VALUES (?,?,?,?,?,?,?)""", (pid, user_id, nome_user, label, str(antes or '—'), str(depois or '—'), datetime.now(TZ_SP)))
                mudou.append(label)
    
    # Se valor foi alterado, recalcular e regenerar parcelas se necessário
    if 'valor' in d:
        novo_valor = float(str(d['valor'] or 0).replace('.','').replace(',','.'))
        operadora = p['adm_operadora']
        regime = p['regime_aplicado']
        mod = p['modalidade']
        tipo_p = p['tipo_pessoa']
        prod_acum = 0  # Simplificado
        
        # Recalcular comissão
        calc = calc_comissao(operadora, regime, prod_acum, novo_valor, mod, tipo_p)
        
        # Atualizar comissões na proposta
        conn.execute("""
            UPDATE propostas 
            SET comissao_total_corretora=?, comissao_consultor=?, comissao_corretora_liquida=?,
                num_parcelas=?, distribuicao_parcelas=?
            WHERE id=?
        """, (calc['total_corretora'], calc['consultor'], calc['liquido'], 
              calc['num_parcelas'], calc['dist_corretora'], pid))
        
        # Regenerar parcelas pendentes
        gerar_parcelas(pid, p['vigencia'], 'c', p.get('dia_vencimento'))
        mudou.append("Parcelas recalculadas")
    
    conn.commit(); close_db(conn)
    return jsonify({"ok": True, "mudou": mudou})


# ─── SOLICITAÇÃO DE EDIÇÃO (consultor pede, admin aprova) ─────────────────────────
@app.route('/proposta/<int:pid>/solicitar-edicao', methods=['POST'])
@login_required
def solicitar_edicao(pid):
    """Consultor envia pedido de alteração; fica Pendente até o admin decidir."""
    d = request.json or {}
    alteracoes = d.get('alteracoes') or {}   # {campo: novo_valor}
    if not alteracoes:
        return jsonify({"ok": False, "msg": "Nenhuma alteração informada."}), 400

    conn = db()
    p = conn.execute("SELECT * FROM propostas WHERE id=?", (pid,)).fetchone()
    if not p:
        close_db(conn); return jsonify({"ok": False, "msg": "Proposta não encontrada"}), 404

    # Consultor só solicita nas próprias propostas; admin pode editar direto (não usa isto)
    if session['perfil'] != 'admin' and p['usuario_id'] != session['user_id']:
        close_db(conn); return jsonify({"ok": False, "msg": "Sem permissão"}), 403

    # Monta diff legível: só campos que realmente mudam
    diff = {}
    for campo, novo in alteracoes.items():
        if campo not in CAMPOS_EDITAVEIS:
            continue
        atual = p[campo] if campo in p.keys() else ''
        if str(atual or '') != str(novo or ''):
            diff[campo] = {'label': CAMPOS_EDITAVEIS[campo], 'de': str(atual or '—'), 'para': str(novo or '—'), 'valor': novo}
    if not diff:
        close_db(conn); return jsonify({"ok": False, "msg": "Os valores enviados são iguais aos atuais."}), 400

    # Evita duplicar pedido pendente para a mesma proposta
    ja = conn.execute("SELECT id FROM solicitacoes_edicao WHERE proposta_id=? AND status='Pendente'", (pid,)).fetchone()
    if ja:
        close_db(conn); return jsonify({"ok": False, "msg": "Já existe uma solicitação pendente para esta proposta. Aguarde o admin avaliar."}), 400

    conn.execute("""INSERT INTO solicitacoes_edicao (proposta_id,usuario_id,usuario_nome,alteracoes,status,criado_em)
        VALUES (?,?,?,?,?,?)""", (pid, session['user_id'], session.get('nome','consultor'),
        json.dumps(diff, ensure_ascii=False), 'Pendente', datetime.now(TZ_SP)))
    # Registra no histórico da proposta
    conn.execute("""INSERT INTO historico_proposta (proposta_id,usuario_id,usuario_nome,campo,valor_antes,valor_depois,criado_em)
        VALUES (?,?,?,?,?,?,?)""", (pid, session['user_id'], session.get('nome','consultor'),
        'solicitacao_edicao', '', f"{len(diff)} campo(s) solicitado(s) para alteração", datetime.now(TZ_SP)))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True, "msg": f"Solicitação enviada ({len(diff)} alteração(ões)). O administrador vai avaliar."})


@app.route('/admin/solicitacoes-edicao')
@login_required
@admin_required
def listar_solicitacoes():
    """Lista solicitações de edição pendentes (admin)."""
    conn = db()
    rows = conn.execute("""SELECT se.*, p.razao_social
        FROM solicitacoes_edicao se JOIN propostas p ON p.id=se.proposta_id
        WHERE se.status='Pendente' ORDER BY se.criado_em DESC""").fetchall()
    close_db(conn)
    out = []
    for r in rows:
        d = dict(r)
        try: d['alteracoes_parsed'] = json.loads(r['alteracoes']) if r['alteracoes'] else {}
        except Exception: d['alteracoes_parsed'] = {}
        out.append(d)
    return jsonify({"ok": True, "solicitacoes": out, "total": len(out)})


@app.route('/admin/solicitacao-edicao/<int:sid>/resolver', methods=['POST'])
@login_required
@admin_required
def resolver_solicitacao(sid):
    """Admin aprova (aplica as mudanças) ou recusa uma solicitação."""
    d = request.json or {}
    acao = d.get('acao')  # 'aprovar' | 'recusar'
    motivo = (d.get('motivo') or '').strip()

    conn = db()
    s = conn.execute("SELECT * FROM solicitacoes_edicao WHERE id=?", (sid,)).fetchone()
    if not s:
        close_db(conn); return jsonify({"ok": False, "msg": "Solicitação não encontrada"}), 404
    if s['status'] != 'Pendente':
        close_db(conn); return jsonify({"ok": False, "msg": "Esta solicitação já foi resolvida."}), 400

    pid = s['proposta_id']
    try: alteracoes = json.loads(s['alteracoes']) if s['alteracoes'] else {}
    except Exception: alteracoes = {}

    if acao == 'aprovar':
        p = conn.execute("SELECT * FROM propostas WHERE id=?", (pid,)).fetchone()
        NUMERICOS = {'valor','total_vidas','dia_vencimento'}
        aplicados = []
        for campo, info in alteracoes.items():
            if campo not in CAMPOS_EDITAVEIS:
                continue
            novo = info.get('valor') if isinstance(info, dict) else info
            if campo in NUMERICOS:
                s_val = str(novo or '').replace('.','').replace(',','.') if campo == 'valor' else str(novo or '')
                try: novo = float(s_val) if campo == 'valor' else int(s_val or 0)
                except: novo = 0
            antes = p[campo] if campo in p.keys() else ''
            conn.execute(f"UPDATE propostas SET {campo}=? WHERE id=?", (novo, pid))
            conn.execute("""INSERT INTO historico_proposta (proposta_id,usuario_id,usuario_nome,campo,valor_antes,valor_depois,criado_em)
                VALUES (?,?,?,?,?,?,?)""", (pid, session['user_id'], session.get('nome','admin'),
                CAMPOS_EDITAVEIS[campo], str(antes or '—'), str(novo or '—'), datetime.now(TZ_SP)))
            aplicados.append(CAMPOS_EDITAVEIS[campo])
        conn.execute("""UPDATE solicitacoes_edicao SET status='Aprovada', resolvido_em=?, resolvido_por=? WHERE id=?""",
            (datetime.now(TZ_SP), session.get('nome','admin'), sid))
        conn.commit(); close_db(conn)
        return jsonify({"ok": True, "msg": f"Aprovada. {len(aplicados)} campo(s) atualizado(s): {', '.join(aplicados)}."})

    elif acao == 'recusar':
        conn.execute("""UPDATE solicitacoes_edicao SET status='Recusada', motivo_recusa=?, resolvido_em=?, resolvido_por=? WHERE id=?""",
            (motivo or 'Sem motivo informado', datetime.now(TZ_SP), session.get('nome','admin'), sid))
        conn.execute("""INSERT INTO historico_proposta (proposta_id,usuario_id,usuario_nome,campo,valor_antes,valor_depois,criado_em)
            VALUES (?,?,?,?,?,?,?)""", (pid, session['user_id'], session.get('nome','admin'),
            'solicitacao_recusada', '', f"Solicitação de edição recusada. {('Motivo: '+motivo) if motivo else ''}", datetime.now(TZ_SP)))
        conn.commit(); close_db(conn)
        return jsonify({"ok": True, "msg": "Solicitação recusada."})

    close_db(conn)
    return jsonify({"ok": False, "msg": "Ação inválida."}), 400


@app.route('/proposta/<int:pid>/historico')
@login_required
def proposta_historico(pid):
    conn = db()
    h = conn.execute("""SELECT * FROM historico_proposta WHERE proposta_id=? ORDER BY id DESC""", (pid,)).fetchall()
    close_db(conn)
    return jsonify([dict(x) for x in h])

# ─── FASES DA PROPOSTA (fluxo com avisos lógicos) ─────────────────────────────────
FASES = [
    {'id':'Proposta cadastrada','desc':'Venda registrada pelo consultor. Próximo: enviar à operadora para análise.','falta':'comprovante'},
    {'id':'Em análise na operadora','desc':'Aguardando a operadora analisar. Pode subir sem o comprovante ainda. Próximo: anexar o comprovante quando a operadora aprovar.','falta':'comprovante'},
    {'id':'Aprovada / aguardando comprovante','desc':'Operadora aprovou. Falta anexar o comprovante de pagamento da 1ª mensalidade.','falta':'comprovante'},
    {'id':'Comprovante anexado','desc':'Comprovante recebido. Próximo: gestor confirmar a entrada do pagamento.','falta':None},
    {'id':'Entrada confirmada','desc':'Pagamento confirmado pelo gestor. Comissão liberada para o fluxo.','falta':None},
    {'id':'Finalizada','desc':'Processo concluído.','falta':None},
]
@app.route('/proposta/<int:pid>/fase', methods=['POST'])
@login_required
@admin_required
def proposta_fase(pid):
    nova = (request.json or {}).get('fase')
    conn = db()
    p = conn.execute("SELECT fase,contrato_arquivo,comprovante_boleto FROM propostas WHERE id=?", (pid,)).fetchone()
    if not p: close_db(conn); return jsonify({"ok": False}), 404
    fase_info = next((f for f in FASES if f['id']==nova), None)
    aviso = ''
    if fase_info and fase_info['falta']=='comprovante' and not p['comprovante_boleto']:
        aviso = 'Atenção: esta proposta ainda está sem comprovante anexado. Você pode prosseguir, mas lembre de anexar quando a operadora aprovar.'
    conn.execute("UPDATE propostas SET fase=? WHERE id=?", (nova, pid))
    conn.execute("""INSERT INTO historico_proposta (proposta_id,usuario_nome,campo,valor_antes,valor_depois)
        VALUES (?,?,?,?,?)""", (pid, session.get('nome','admin'), 'Fase', p['fase'] or '—', nova))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True, "aviso": aviso})

# ─── ROTAS DE PARCELAS (FLUXO DE CAIXA) ─────────────────────────────────────────
@app.route('/parcela/<int:pid>/status', methods=['POST'])
@login_required
@admin_required
def parcela_status(pid):
    """Mudança manual de status (select do admin)."""
    novo = request.form.get('status')
    conn = db()
    extra = ""
    if novo == 'Liberado para o corretor':
        conn.execute("UPDATE parcelas SET status=?,confirmado_gestor=1,data_confirmacao_gestor=? WHERE id=?",
                     (novo, datetime.now(TZ_SP).isoformat(), pid))
    elif novo == 'Pago ao corretor':
        conn.execute("UPDATE parcelas SET status=?,data_pagamento=? WHERE id=?",
                     (novo, datetime.now(TZ_SP).isoformat(), pid))
    else:
        conn.execute("UPDATE parcelas SET status=? WHERE id=?", (novo, pid))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})

@app.route('/parcela/<int:pid>/acao', methods=['POST'])
@login_required
@admin_required
def parcela_acao(pid):
    """Avança a parcela um passo no fluxo, com confirmação do gestor."""
    acao = request.form.get('acao')
    conn = db()
    agora = datetime.now(TZ_SP).isoformat()
    if acao == 'receber':
        conn.execute("UPDATE parcelas SET status='Recebido e não repassado' WHERE id=?", (pid,))
    elif acao == 'liberar':  # confirmação do gestor
        conn.execute("UPDATE parcelas SET status='Liberado para o corretor',confirmado_gestor=1,data_confirmacao_gestor=? WHERE id=?",
                     (agora, pid))
    elif acao == 'pagar':
        conn.execute("UPDATE parcelas SET status='Pago ao corretor',data_pagamento=? WHERE id=?", (agora, pid))
    elif acao == 'voltar':
        conn.execute("UPDATE parcelas SET status='Pendente de receber',confirmado_gestor=0,aceite_corretor=0 WHERE id=?", (pid,))
    else:
        close_db(conn); return jsonify({"ok": False, "msg": "Ação inválida"}), 400
    conn.commit()
    # Notifica o consultor quando a comissão é liberada ou paga
    try:
        if acao in ('liberar', 'pagar'):
            row = conn.execute("""SELECT pr.usuario_id, pr.razao_social, pa.numero, pa.valor_corretora
                                  FROM parcelas pa JOIN propostas pr ON pr.id = pa.proposta_id
                                  WHERE pa.id=?""", (pid,)).fetchone()
            if row:
                rd = dict(row)
                if rd.get('usuario_id'):
                    verbo = 'liberada' if acao == 'liberar' else 'paga'
                    _notificar(rd['usuario_id'], 'comissao', f'Comissão {verbo}',
                               f"Parcela {rd.get('numero')} de {rd.get('razao_social') or 'proposta'} "
                               f"({_moeda(rd.get('valor_corretora'))})",
                               '/fluxo-caixa')
    except Exception:
        pass
    close_db(conn)
    return jsonify({"ok": True})

@app.route('/parcela/<int:pid>/antecipar', methods=['POST'])
@login_required
def parcela_antecipar(pid):
    """Corretor sobe comprovante de pagamento do cliente (somente parcela 1)."""
    if 'comprovante' not in request.files:
        return jsonify({"ok": False, "msg": "Nenhum arquivo enviado"}), 400
    
    f = request.files['comprovante']
    nome = f"{datetime.now(TZ_SP).strftime('%Y%m%d%H%M%S')}_antecip_{_sanitizar_filename(f.filename)}"
    caminho = os.path.join(UPLOAD_FOLDER, nome)
    f.save(caminho)
    
    conn = db()
    # Valida que é parcela 1 e pertence ao consultor
    parc = conn.execute("""SELECT pa.*, p.usuario_id FROM parcelas pa
        JOIN propostas p ON p.id=pa.proposta_id WHERE pa.id=?""",(pid,)).fetchone()
        
    if not parc or parc['numero'] != 1:
        close_db(conn)
        return jsonify({"ok": False, "msg": "Antecipação só disponível para a 1ª parcela"}), 400
        
    if session['perfil'] != 'admin' and parc['usuario_id'] != session['user_id']:
        close_db(conn)
        return jsonify({"ok": False, "msg": "Acesso negado"}), 403
        
    conn.execute("UPDATE parcelas SET comprovante_antecipacao=?,status='Antecipação - Aguardando ADM' WHERE id=?",
                 (nome, pid))
    conn.commit()
    close_db(conn)
    return jsonify({"ok": True})

@app.route('/parcela/<int:pid>/aprovar-antecipacao', methods=['POST'])
@login_required
@admin_required
def parcela_aprovar_antecip(pid):
    """ADM aprova o comprovante e solicita os 48h à operadora."""
    conn = db()
    conn.execute("UPDATE parcelas SET status='Antecipação Solicitada à Operadora' WHERE id=?", (pid,))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})

@app.route('/parcela/<int:pid>/aceite', methods=['POST'])
@login_required
def parcela_aceite(pid):
    """Consultor confirma 'Conferido e De Acordo' quando parcela está liberada."""
    conn = db()
    parc = conn.execute("""SELECT pa.*, p.usuario_id FROM parcelas pa
        JOIN propostas p ON p.id=pa.proposta_id WHERE pa.id=?""",(pid,)).fetchone()
    if not parc: close_db(conn); return jsonify({"ok": False, "msg": "Parcela não encontrada"}), 404
    if session['perfil'] != 'admin' and parc['usuario_id'] != session['user_id']:
        close_db(conn); return jsonify({"ok": False, "msg": "Acesso negado"}), 403
    conn.execute("UPDATE parcelas SET aceite_corretor=1,data_aceite=? WHERE id=?",
                 (datetime.now(TZ_SP).isoformat(), pid))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})

# ─── FLUXO DE CAIXA ──────────────────────────────────────────────────────────────
@app.route('/fluxo-caixa')
@login_required
def fluxo_caixa():
    conn = db(); uid = session['user_id']
    ciclo = ciclo_atual()
    eh_admin = session['perfil'] == 'admin'

    if eh_admin:
        # Totais por status
        totais = {}
        for s in ["Pendente de receber","Recebido e não repassado","Liberado para o corretor","Pago ao corretor"]:
            totais[s] = conn.execute("SELECT COALESCE(SUM(valor),0) v FROM parcelas WHERE status=?", (s,)).fetchone()['v']
        totais['antecipacoes'] = conn.execute(
            "SELECT COALESCE(SUM(valor),0) v FROM parcelas WHERE status IN ('Antecipação - Aguardando ADM','Antecipação Solicitada à Operadora')").fetchone()['v']
        totais['total_em_aberto'] = sum(totais[s] for s in ["Pendente de receber","Recebido e não repassado","Liberado para o corretor"])

        # Antecipações aguardando aprovação ADM
        antecipacoes = conn.execute("""
            SELECT pa.*, p.razao_social, p.consultor, p.adm_operadora, p.valor as val_proposta
            FROM parcelas pa JOIN propostas p ON p.id=pa.proposta_id
            WHERE pa.status='Antecipação - Aguardando ADM' ORDER BY pa.id DESC
        """).fetchall()

        # Lote do ciclo atual (liberados para o corretor)
        lote = conn.execute("""
            SELECT pa.*, p.razao_social, p.consultor, p.adm_operadora, p.id as proposta_id,
                   u.chave_pix
            FROM parcelas pa
            JOIN propostas p ON p.id=pa.proposta_id
            LEFT JOIN usuarios u ON u.id=p.usuario_id
            WHERE pa.status='Liberado para o corretor' ORDER BY p.consultor, pa.id
        """).fetchall()

        # Todos os recebidos aguardando repasse
        recebidos = conn.execute("""
            SELECT pa.*, p.razao_social, p.consultor, p.adm_operadora, p.id as proposta_id
            FROM parcelas pa JOIN propostas p ON p.id=pa.proposta_id
            WHERE pa.status='Recebido e não repassado' ORDER BY pa.id DESC
        """).fetchall()

        # Histórico de pagos (últimos 30)
        pagos = conn.execute("""
            SELECT pa.*, p.razao_social, p.consultor, p.adm_operadora
            FROM parcelas pa JOIN propostas p ON p.id=pa.proposta_id
            WHERE pa.status='Pago ao corretor' ORDER BY pa.id DESC LIMIT 30
        """).fetchall()

        close_db(conn)
        return render_template('fluxo_caixa.html', ciclo=ciclo, totais=totais,
                               antecipacoes=antecipacoes, lote=lote,
                               recebidos=recebidos, pagos=pagos,
                               status_fluxo=STATUS_FLUXO)
    else:
        # Visão do consultor
        a_receber = conn.execute("""SELECT pa.*, p.razao_social, p.adm_operadora, p.id as proposta_id
            FROM parcelas pa JOIN propostas p ON p.id=pa.proposta_id
            WHERE p.usuario_id=? AND pa.status='Liberado para o corretor' ORDER BY pa.id""",(uid,)).fetchall()
        em_analise = conn.execute("""SELECT pa.*, p.razao_social, p.adm_operadora, p.id as proposta_id
            FROM parcelas pa JOIN propostas p ON p.id=pa.proposta_id
            WHERE p.usuario_id=? AND pa.status NOT IN ('Liberado para o corretor','Pago ao corretor')
            ORDER BY pa.id DESC""",(uid,)).fetchall()
        pagos_consul = conn.execute("""SELECT pa.*, p.razao_social, p.adm_operadora
            FROM parcelas pa JOIN propostas p ON p.id=pa.proposta_id
            WHERE p.usuario_id=? AND pa.status='Pago ao corretor' ORDER BY pa.id DESC LIMIT 30""",(uid,)).fetchall()
        total_a_receber = sum(p['valor'] for p in a_receber)
        total_pago = sum(p['valor'] for p in pagos_consul)
        # Fixo do mês do consultor (se houver)
        mes = competencia_atual()
        fixo_mes = conn.execute("""SELECT COALESCE(SUM(valor),0) v FROM lancamentos
            WHERE tipo='fixo' AND usuario_id=? AND data_competencia=?""", (uid, mes)).fetchone()['v']
        fixo_parcelas = conn.execute("""SELECT descricao,valor,data_lancamento,status FROM lancamentos
            WHERE tipo='fixo' AND usuario_id=? AND data_competencia=? ORDER BY data_lancamento""", (uid, mes)).fetchall()
        close_db(conn)
        return render_template('fluxo_caixa_consultor.html', ciclo=ciclo,
                               a_receber=a_receber, em_analise=em_analise,
                               pagos=pagos_consul, total_a_receber=total_a_receber,
                               total_pago=total_pago, fixo_mes=fixo_mes, fixo_parcelas=fixo_parcelas)

# ─── BI ──────────────────────────────────────────────────────────────────────────
@app.route('/bi')
@login_required
def bi():
    conn = db(); uid = session['user_id']; ea = session['perfil'] == 'admin'
    if ea:
        por_mes = conn.execute("""SELECT strftime('%Y-%m',criado_em) mes,COUNT(*) qtd,
            COALESCE(SUM(valor),0) valor,COALESCE(SUM(comissao_total_corretora),0) com_total,
            COALESCE(SUM(comissao_consultor),0) com_consultor,COALESCE(SUM(comissao_corretora_liquida),0) com_liquido
            FROM propostas GROUP BY mes ORDER BY mes""").fetchall()
        por_operadora = conn.execute("""SELECT adm_operadora op,COUNT(*) qtd,COALESCE(SUM(valor),0) valor,
            COALESCE(SUM(comissao_total_corretora),0) com,COALESCE(SUM(total_vidas),0) vidas
            FROM propostas GROUP BY adm_operadora ORDER BY valor DESC""").fetchall()
        por_modalidade = conn.execute("""SELECT modalidade,COUNT(*) qtd,COALESCE(SUM(valor),0) valor
            FROM propostas GROUP BY modalidade ORDER BY valor DESC""").fetchall()
        por_consultor = conn.execute("""SELECT consultor,COUNT(*) qtd,COALESCE(SUM(valor),0) valor,
            COALESCE(SUM(comissao_consultor),0) com,COALESCE(SUM(total_vidas),0) vidas
            FROM propostas GROUP BY consultor ORDER BY valor DESC""").fetchall()
    else:
        por_mes = conn.execute("""SELECT strftime('%Y-%m',criado_em) mes,COUNT(*) qtd,
            COALESCE(SUM(valor),0) valor,COALESCE(SUM(comissao_consultor),0) com_consultor
            FROM propostas WHERE usuario_id=? GROUP BY mes ORDER BY mes""",(uid,)).fetchall()
        por_operadora = conn.execute("""SELECT adm_operadora op,COUNT(*) qtd,COALESCE(SUM(valor),0) valor,
            COALESCE(SUM(comissao_consultor),0) com,COALESCE(SUM(total_vidas),0) vidas
            FROM propostas WHERE usuario_id=? GROUP BY adm_operadora ORDER BY valor DESC""",(uid,)).fetchall()
        por_modalidade = conn.execute("""SELECT modalidade,COUNT(*) qtd,COALESCE(SUM(valor),0) valor
            FROM propostas WHERE usuario_id=? GROUP BY modalidade ORDER BY valor DESC""",(uid,)).fetchall()
        por_consultor = []
    close_db(conn)
    return render_template('bi.html', por_mes=por_mes, por_operadora=por_operadora,
                           por_modalidade=por_modalidade, por_consultor=por_consultor)

# ─── USUÁRIOS ────────────────────────────────────────────────────────────────────
@app.route('/usuarios')
@login_required
@admin_required
def usuarios():
    conn = db()
    rows = conn.execute("SELECT * FROM usuarios ORDER BY id").fetchall()
    close_db(conn)
    # dict simples: Row do SQLite não é serializável pelo |tojson do template,
    # e o hash de senha não deve ir para o HTML
    usuarios_l = []
    for r in rows:
        d = dict(r)
        d['senha_hash'] = bool(d.get('senha_hash'))
        d.pop('reset_token', None)
        usuarios_l.append(d)
    return render_template('usuarios.html', usuarios=usuarios_l, host=request.host_url.rstrip('/'))

@app.route('/usuario/novo', methods=['POST'])
@login_required
@admin_required
def usuario_novo():
    d = request.form
    nome=d.get('nome','').strip(); email=d.get('email','').strip().lower()
    if not nome or not email:
        flash('Nome e e-mail obrigatórios.'); return redirect(url_for('usuarios'))
    token=secrets.token_urlsafe(32); expira=(datetime.now(TZ_SP)+timedelta(days=7)).isoformat()
    cpf = d.get('cpf','').strip()
    conn = db()
    try:
        conn.execute("""INSERT INTO usuarios (nome,email,perfil,regime_base,token_setup,token_expira,cpf)
            VALUES (?,?,?,?,?,?,?)""",(nome,email,d.get('perfil','consultor'),
            (d.get('regime_base','sem_lead_sem_fixo') if d.get('perfil','consultor')=='consultor' else ''),token,expira,cpf or None))
        conn.commit()
    except sqlite3.IntegrityError:
        flash('E-mail já cadastrado.'); close_db(conn); return redirect(url_for('usuarios'))
    close_db(conn)
    return redirect(url_for('usuarios', link_token=token))

@app.route('/usuario/foto/upload', methods=['POST'])
@login_required
def usuario_foto_upload():
    """Upload de foto de perfil via AJAX. Salva em R2 com fallback local."""
    fimg = request.files.get('foto')
    if not fimg or not fimg.filename:
        return jsonify({"ok": False, "erro": "Arquivo não enviado"}), 400

    ext = os.path.splitext(fimg.filename)[1].lower()
    if ext not in ('.png', '.jpg', '.jpeg', '.webp'):
        return jsonify({"ok": False, "erro": "Formato inválido. Use PNG, JPG ou WebP"}), 400

    fimg.seek(0, os.SEEK_END)
    if fimg.tell() > 2 * 1024 * 1024:
        return jsonify({"ok": False, "erro": "Arquivo muito grande (máx 2MB)"}), 400
    fimg.seek(0)

    # Admin pode alterar foto de outro usuário
    uid_logado = session.get('user_id')
    uid_alvo = request.form.get('uid', uid_logado)
    if str(uid_alvo) != str(uid_logado) and session.get('perfil') != 'admin':
        return jsonify({"ok": False, "erro": "Sem permissão"}), 403
    uid_alvo = int(uid_alvo)

    conn = db()
    foto_antiga = conn.execute("SELECT foto FROM usuarios WHERE id=?", (uid_alvo,)).fetchone()

    foto_nome = f"perfil_{uid_alvo}_{datetime.now(TZ_SP).strftime('%Y%m%d%H%M%S')}{ext}"
    
    # Upload para R2 + fallback local
    try:
        upload_arquivo_r2(fimg, foto_nome)
    except Exception as e:
        app.logger.warning(f"[FOTO] R2 falhou, usando local: {e}")
        fimg.seek(0)
        fimg.save(os.path.join(UPLOAD_FOLDER, foto_nome))

    conn.execute("UPDATE usuarios SET foto=? WHERE id=?", (foto_nome, uid_alvo))
    conn.commit(); close_db(conn)

    # Se é a própria foto, atualiza a sessão para aparecer na sidebar
    if uid_alvo == uid_logado:
        session['foto'] = foto_nome

    return jsonify({"ok": True, "foto": foto_nome})

@app.route('/usuario/editar/<int:uid>', methods=['POST'])
@login_required
@admin_required
def usuario_editar(uid):
    d = request.form; conn = db()
    ativo = 1 if d.get('ativo') else 0   # checkbox: ausente = inativo
    def fnum(k):
        v = (d.get(k,'') or '').replace('.','').replace(',','.')
        try: return float(v) if v else 0
        except: return 0
    # Foto de perfil (upload opcional)
    foto_atual = conn.execute("SELECT foto FROM usuarios WHERE id=?", (uid,)).fetchone()
    foto_nome = foto_atual['foto'] if foto_atual else None
    fimg = request.files.get('foto')
    if fimg and fimg.filename:
        ext = os.path.splitext(fimg.filename)[1].lower()
        if ext in ('.png','.jpg','.jpeg','.webp'):
            foto_nome = f"perfil_{uid}_{datetime.now(TZ_SP).strftime('%Y%m%d%H%M%S')}{ext}"
            fimg.save(os.path.join(UPLOAD_FOLDER, foto_nome))
    conn.execute("""UPDATE usuarios SET nome=?,email=?,perfil=?,regime_base=?,ativo=?,valor_fixo=?,chave_pix=?,foto=?,cpf=? WHERE id=?""",
        (d['nome'],d['email'].lower(),d['perfil'],
         (d['regime_base'] if d['perfil']=='consultor' else ''),ativo,fnum('valor_fixo'),d.get('chave_pix',''),foto_nome,d.get('cpf','') or None,uid))
    conn.commit(); close_db(conn)
    return redirect(url_for('usuarios'))

@app.route('/usuario/regenerar-link/<int:uid>')
@require_auth
@require_admin
def usuario_regenerar(uid):
    """Regenera link de setup pra usuário."""
    try:
        if not uid or uid <= 0:
            app.logger.warning(f"[usuarios] ID inválido pra regenerar-link: {uid}")
            flash('ID de usuário inválido', 'error')
            return redirect(url_for('usuarios')), 400
        
        conn = db()
        cur = conn.cursor()
        cur.execute("SELECT id FROM usuarios WHERE id=?", (uid,))
        user = cur.fetchone()
        
        if not user:
            app.logger.warning(f"[usuarios] Usuário não encontrado: {uid}")
            flash('Usuário não encontrado', 'error')
            return redirect(url_for('usuarios')), 404
        
        token = secrets.token_urlsafe(32)
        expira = (datetime.now(TZ_SP) + timedelta(days=7)).isoformat()
        cur.execute("UPDATE usuarios SET token_setup=?, token_expira=?, senha_hash=NULL WHERE id=?", 
                    (token, expira, uid))
        conn.commit()
        close_db(conn)
        
        app.logger.info(f"[usuarios] Link regenerado pra user_id={uid}")
        flash('Link enviado com sucesso', 'success')
        return redirect(url_for('usuarios', link_token=token))
    except Exception as e:
        app.logger.error(f"[usuarios] Erro ao regenerar link: {type(e).__name__}")
        flash('Erro ao gerar link', 'error')
        return redirect(url_for('usuarios')), 500

# ─── SUPERVISORAS ────────────────────────────────────────────────────────────────
@app.route('/supervisoras')
@login_required
@admin_required
def supervisoras():
    conn = db()
    rows = conn.execute("SELECT * FROM supervisoras ORDER BY ativo DESC,nome").fetchall()
    close_db(conn)
    return render_template('supervisoras.html', supervisoras=rows)

@app.route('/supervisora/salvar', methods=['POST'])
@login_required
@admin_required
def supervisora_salvar():
    d = request.form; conn = db()
    if d.get('id'):
        conn.execute("UPDATE supervisoras SET nome=?,email=?,telefone=?,ativo=? WHERE id=?",
            (d['nome'],d.get('email'),d.get('telefone'),int(d.get('ativo',1) or 0),d['id']))
    else:
        conn.execute("INSERT INTO supervisoras (nome,email,telefone) VALUES (?,?,?)",
            (d['nome'],d.get('email'),d.get('telefone')))
    conn.commit(); close_db(conn)
    return redirect(url_for('supervisoras'))

# ─── REGIMES ─────────────────────────────────────────────────────────────────────
@app.route('/regimes')
@login_required
@admin_required
def regimes():
    conn = db()
    rows = conn.execute("SELECT * FROM regimes ORDER BY ordem").fetchall()
    close_db(conn)
    return render_template('regimes.html', regimes=rows)

@app.route('/regime/salvar', methods=['POST'])
@login_required
@admin_required
def regime_salvar():
    d = request.form
    def f(k,default=0):
        v=(d.get(k,'') or '').replace(',','.')
        try: return float(v) if v else default
        except: return default
    conn = db()
    fmin = f('faixa_min', None) if d.get('faixa_min') else None
    fmax = f('faixa_max', None) if d.get('faixa_max') else None
    if d.get('id'):
        conn.execute("""UPDATE regimes SET nome=?,descricao=?,valor_fixo=?,num_parcelas=?,
            distribuicao_parcelas=?,faixa_min=?,faixa_max=?,coluna_comissao=? WHERE id=?""",
            (d['nome'],d.get('descricao'),f('valor_fixo'),int(d.get('num_parcelas',1) or 1),
             d.get('distribuicao_parcelas','100'),fmin,fmax,d.get('coluna_comissao'),d['id']))
    conn.commit(); close_db(conn)
    return redirect(url_for('regimes'))

# ─── COMISSÕES ───────────────────────────────────────────────────────────────────
@app.route('/comissoes')
@login_required
@admin_required
def comissoes():
    conn = db()
    rows = conn.execute("SELECT * FROM comissoes ORDER BY operadora").fetchall()
    close_db(conn)
    return render_template('comissoes.html', comissoes=rows)

@app.route('/comissao/salvar', methods=['POST'])
@login_required
@admin_required
def comissao_salvar():
    d = request.form
    def num(k):
        v=(d.get(k,'0') or '0').replace(',','.')
        try: return float(v)
        except: return 0.0
    conn = db()
    if d.get('id'):
        conn.execute("""UPDATE comissoes SET operadora=?,perc_total=?,perc_sem_leads=?,
            perc_n1=?,perc_n2=?,perc_n3=?,perc_com_fixo=?,observacao=? WHERE id=?""",
            (d['operadora'],num('perc_total'),num('perc_sem_leads'),num('perc_n1'),
             num('perc_n2'),num('perc_n3'),num('perc_com_fixo'),d.get('observacao'),d['id']))
    else:
        conn.execute("""INSERT INTO comissoes (operadora,perc_total,perc_sem_leads,
            perc_n1,perc_n2,perc_n3,perc_com_fixo,observacao) VALUES (?,?,?,?,?,?,?,?)""",
            (d['operadora'],num('perc_total'),num('perc_sem_leads'),num('perc_n1'),
             num('perc_n2'),num('perc_n3'),num('perc_com_fixo'),d.get('observacao')))
    conn.commit(); close_db(conn)
    return redirect(url_for('comissoes'))

# ─── CAMPOS PERSONALIZADOS (FORM BUILDER) ────────────────────────────────────────
@app.route('/campos')
@login_required
@admin_required
def campos():
    conn = db()
    rows = conn.execute("SELECT * FROM campos_custom ORDER BY ordem,id").fetchall()
    close_db(conn)
    return render_template('campos.html', campos=rows)

@app.route('/campo/salvar', methods=['POST'])
@login_required
@admin_required
def campo_salvar():
    import re
    d = request.form
    label = (d.get('label') or '').strip()
    if not label:
        return jsonify({"ok": False, "msg": "Informe o nome do campo"}), 400
    tipo = d.get('tipo', 'text')
    # opções (para select/radio/checkbox) — uma por linha
    opcoes_raw = (d.get('opcoes') or '').strip()
    opcoes = [o.strip() for o in opcoes_raw.split('\n') if o.strip()] if opcoes_raw else []
    obrig = 1 if d.get('obrigatorio') else 0
    ativo = 1 if d.get('ativo') else 0
    placeholder = d.get('placeholder', '')
    ajuda = d.get('ajuda', '')
    conn = db()
    if d.get('id'):
        conn.execute("""UPDATE campos_custom SET label=?,tipo=?,opcoes=?,placeholder=?,ajuda=?,
            obrigatorio=?,ativo=? WHERE id=?""",
            (label, tipo, json.dumps(opcoes, ensure_ascii=False), placeholder, ajuda, obrig, ativo, d['id']))
    else:
        # gera nome técnico único a partir do label
        base = re.sub(r'[^a-z0-9]+', '_', label.lower()).strip('_') or 'campo'
        nome = base; i = 1
        while conn.execute("SELECT 1 FROM campos_custom WHERE nome_tecnico=?", (nome,)).fetchone():
            i += 1; nome = f"{base}_{i}"
        ordem = (conn.execute("SELECT COALESCE(MAX(ordem),0) m FROM campos_custom").fetchone()['m'] or 0) + 1
        conn.execute("""INSERT INTO campos_custom (label,nome_tecnico,tipo,opcoes,placeholder,ajuda,obrigatorio,ativo,ordem)
            VALUES (?,?,?,?,?,?,?,?,?)""",
            (label, nome, tipo, json.dumps(opcoes, ensure_ascii=False), placeholder, ajuda, obrig, ativo, ordem))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})

@app.route('/campo/excluir/<int:cid>', methods=['POST'])
@login_required
@admin_required
def campo_excluir(cid):
    conn = db()
    conn.execute("DELETE FROM campos_custom WHERE id=?", (cid,))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})

@app.route('/campo/ordem', methods=['POST'])
@login_required
@admin_required
def campo_ordem():
    """Recebe lista de IDs na nova ordem."""
    ids = request.json.get('ids', [])
    conn = db()
    for i, cid in enumerate(ids):
        conn.execute("UPDATE campos_custom SET ordem=? WHERE id=?", (i+1, cid))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})

@app.route('/api/campos-ativos')
@login_required
def api_campos_ativos():
    conn = db()
    rows = conn.execute("SELECT * FROM campos_custom WHERE ativo=1 ORDER BY ordem,id").fetchall()
    close_db(conn)
    out = []
    for r in rows:
        try: opc = json.loads(r['opcoes']) if r['opcoes'] else []
        except: opc = []
        out.append({'label': r['label'], 'nome': r['nome_tecnico'], 'tipo': r['tipo'],
                    'opcoes': opc, 'placeholder': r['placeholder'] or '',
                    'ajuda': r['ajuda'] or '', 'obrigatorio': r['obrigatorio']})
    return jsonify(out)

# ─── OPERADORAS (régua de recebimento) ───────────────────────────────────────────
@app.route('/operadoras')
@login_required
@admin_required
def operadoras():
    conn = db()
    rows = conn.execute("SELECT * FROM recebimento ORDER BY operadora,plano").fetchall()
    close_db(conn)
    # agrupa por operadora+obs, com colunas por plano
    grupos = {}
    for r in rows:
        key = (r['operadora'], r['obs'] or '')
        grupos.setdefault(key, {'operadora': r['operadora'], 'obs': r['obs'] or '', 'PME': None, 'PF': None, 'ADESAO': None, 'ids': {}})
        grupos[key][r['plano']] = r['total']
        grupos[key]['ids'][r['plano']] = r['id']
    return render_template('operadoras.html', grupos=list(grupos.values()))

@app.route('/operadora/salvar', methods=['POST'])
@login_required
@admin_required
def operadora_salvar():
    """Salva o recebimento (mensalidades) de uma operadora por plano."""
    d = request.json or {}
    nome = (d.get('operadora') or '').strip()
    obs = (d.get('obs') or '').strip()
    if not nome:
        return jsonify({"ok": False, "msg": "Informe o nome"}), 400
    conn = db()
    for plano in ['PME', 'PF', 'ADESAO']:
        val = d.get(plano)
        if val in (None, ''): continue
        try: total = float(val)
        except: continue
        conn.execute("""INSERT INTO recebimento (operadora,obs,plano,total) VALUES (?,?,?,?)
            ON CONFLICT(operadora,obs,plano) DO UPDATE SET total=excluded.total""",
            (nome, obs, plano, total))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})

@app.route('/operadora/excluir', methods=['POST'])
@login_required
@admin_required
def operadora_excluir():
    d = request.json or {}
    conn = db()
    conn.execute("DELETE FROM recebimento WHERE operadora=? AND obs=?", (d.get('operadora'), d.get('obs','')))
    conn.execute("DELETE FROM repasse_corretor WHERE operadora=? AND obs=?", (d.get('operadora'), d.get('obs','')))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})

# ─── REPASSES AO CORRETOR (mensalidades por operadora × plano × modelo × nível) ────
@app.route('/repasses')
@login_required
@admin_required
def repasses():
    conn = db()
    ops = conn.execute("SELECT DISTINCT operadora,obs FROM recebimento ORDER BY operadora").fetchall()
    reps = conn.execute("SELECT * FROM repasse_corretor").fetchall()
    niveis = conn.execute("SELECT * FROM niveis ORDER BY ordem").fetchall()
    close_db(conn)
    rep_map = {f"{r['operadora']}|{r['obs'] or ''}|{r['plano']}|{r['modelo']}|{r['nivel']}": dict(r) for r in reps}
    return render_template('repasses.html',
                           operadoras=[{'operadora': o['operadora'], 'obs': o['obs'] or ''} for o in ops],
                           rep_map=rep_map, niveis=[dict(n) for n in niveis],
                           modelo_nome=MODELO_NOME, modelo_tem_meta=MODELO_TEM_META)

@app.route('/repasse/salvar', methods=['POST'])
@login_required
@admin_required
def repasse_salvar():
    """Salva os repasses (total + régua em mensalidades, ou taxa)."""
    dados = (request.json or {}).get('repasses', [])
    conn = db()
    for r in dados:
        op, obs, plano = r['operadora'], r.get('obs',''), r['plano']
        modelo, nivel = r['modelo'], r.get('nivel','')
        taxa = 1 if r.get('taxa') else 0
        total = float(r.get('total') or 0)
        regua = (r.get('regua') or '').strip()
        conn.execute("""INSERT INTO repasse_corretor (operadora,obs,plano,modelo,nivel,total,regua,taxa)
            VALUES (?,?,?,?,?,?,?,?)
            ON CONFLICT(operadora,obs,plano,modelo,nivel) DO UPDATE SET
            total=excluded.total, regua=excluded.regua, taxa=excluded.taxa""",
            (op, obs, plano, modelo, nivel, total, regua, taxa))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})

# ─── NÍVEIS (faixas de produção) ──────────────────────────────────────────────────
@app.route('/producao')
@login_required
@admin_required
def producao():
    """Dashboard de Nível de Produção com fluxo temporal, timeline e configuração de níveis."""
    conn = db()
    ciclo = ciclo_atual()
    
    # Consultores com produção do ciclo atual
    consultores = conn.execute("""
        SELECT u.id, u.nome, u.valor_fixo, u.regime_base,
               COUNT(DISTINCT p.id) qtd_propostas,
               COUNT(DISTINCT CASE WHEN p.venda_status IN ('Entrada confirmada','Proposta aprovada') THEN p.id END) qtd_aprovadas,
               COALESCE(SUM(CASE WHEN par.status='Pago ao corretor' THEN par.valor ELSE 0 END), 0) comissao_paga,
               COALESCE(SUM(CASE WHEN par.status!='Pago ao corretor' THEN par.valor ELSE 0 END), 0) comissao_pendente
        FROM usuarios u
        LEFT JOIN propostas p ON p.usuario_id=u.id
        LEFT JOIN parcelas par ON par.proposta_id=p.id
        WHERE u.ativo=1 AND u.perfil='consultor'
        GROUP BY u.id, u.nome, u.valor_fixo, u.regime_base
        ORDER BY qtd_propostas DESC
    """).fetchall()
    
    # Estatísticas gerais do ciclo
    stats = conn.execute("""
        SELECT 
            COUNT(DISTINCT id) qtd_propostas,
            COUNT(DISTINCT CASE WHEN venda_status IN ('Entrada confirmada','Proposta aprovada') THEN id END) qtd_aprovadas,
            COUNT(DISTINCT CASE WHEN venda_status IN ('Entrada confirmada','Proposta aprovada') THEN id END) entrada_confirmada,
            COUNT(DISTINCT CASE WHEN venda_status='Em análise na operadora' THEN id END) em_analise,
            COUNT(DISTINCT CASE WHEN venda_status='Proposta cadastrada' THEN id END) cadastradas
        FROM propostas
    """).fetchone()
    
    # Comissões por fase
    comissoes_fase = conn.execute("""
        SELECT 
            CASE WHEN par.status='Pendente de receber' THEN 'Pendente Operadora'
                 WHEN par.status='Recebido e não repassado' THEN 'Recebido'
                 WHEN par.status='Liberado para o corretor' THEN 'Liberado'
                 WHEN par.status='Pago ao corretor' THEN 'Pago'
                 ELSE par.status END as fase,
            COUNT(*) qtd,
            COALESCE(SUM(par.valor_corretora), 0) valor,
            COALESCE(SUM(par.valor), 0) valor_consultor
        FROM parcelas par
        GROUP BY par.status
    """).fetchall()
    
    # Níveis de produção (N1, N2, N3)
    niveis = conn.execute("SELECT * FROM niveis ORDER BY ordem").fetchall()
    
    close_db(conn)
    
    return render_template('producao.html',
        ciclo=ciclo,
        consultores=consultores,
        stats=stats,
        comissoes_fase=comissoes_fase,
        niveis=niveis,
        fluxo_semanal=FLUXO_SEMANAL,
        fase_atual=ciclo['fase_atual'])

@app.route('/producao/fase', methods=['POST'])
@login_required
@admin_required
def producao_mudar_fase():
    """Admin pode forçar mudança de fase manualmente."""
    nova_fase = (request.json or {}).get('fase')
    if nova_fase not in FLUXO_SEMANAL:
        return jsonify({"ok": False, "erro": "Fase inválida"}), 400
    
    conn = db()
    conn.execute("""INSERT INTO historico_proposta (proposta_id, usuario_nome, campo, valor_antes, valor_depois)
        VALUES (NULL, ?, 'Fluxo Semanal', ?, ?)""", 
        (session.get('nome','admin'), detectar_fase_atual(), nova_fase))
    conn.commit(); close_db(conn)
    
    return jsonify({"ok": True, "nova_fase": nova_fase})

@app.route('/niveis')
@login_required
@admin_required
def niveis():
    conn = db()
    rows = conn.execute("SELECT * FROM niveis ORDER BY ordem").fetchall()
    close_db(conn)
    return render_template('niveis.html', niveis=rows)

@app.route('/nivel/salvar', methods=['POST'])
@login_required
@admin_required
def nivel_salvar():
    """Sincroniza a lista completa de níveis: cria, atualiza e remove."""
    dados = request.json.get('niveis', [])
    conn = db()
    codigos = []
    for i, n in enumerate(dados):
        cod = (n.get('codigo') or '').strip().lower() or f"n{i+1}"
        label = (n.get('label') or cod.upper()).strip()
        fmin = float(n['faixa_min']) if n.get('faixa_min') not in (None,'') else 0
        fmax = float(n['faixa_max']) if n.get('faixa_max') not in (None,'') else None
        codigos.append(cod)
        conn.execute("""INSERT INTO niveis (codigo,label,faixa_min,faixa_max,ordem) VALUES (?,?,?,?,?)
            ON CONFLICT(codigo) DO UPDATE SET label=excluded.label, faixa_min=excluded.faixa_min,
            faixa_max=excluded.faixa_max, ordem=excluded.ordem""", (cod, label, fmin, fmax, i+1))
    if codigos:
        ph = ','.join('?'*len(codigos))
        conn.execute(f"DELETE FROM niveis WHERE codigo NOT IN ({ph})", codigos)
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})

# ─── FINANCEIRO: fixo, custos, aporte, comissões futuras, estorno ─────────────────
def competencia_atual():
    return date.today().strftime('%Y-%m')

def gerar_fixo_mes(ano_mes):
    """Gera os lançamentos de FIXO do mês para cada consultor com fixo.
    Pago em 2 fluxos: dia 15 e dia 30 (metade em cada), conforme o calendário."""
    conn = db()
    consultores = conn.execute("""SELECT id,nome,valor_fixo FROM usuarios
        WHERE ativo=1 AND regime_base='com_fixo_lead' AND COALESCE(valor_fixo,0)>0""").fetchall()
    criados = 0
    for u in consultores:
        metade = round((u['valor_fixo'] or 0)/2, 2)
        for dia in (15, 30):
            ja = conn.execute("""SELECT id FROM lancamentos WHERE tipo='fixo' AND usuario_id=?
                AND data_competencia=? AND descricao LIKE ?""",
                (u['id'], ano_mes, f"%dia {dia}%")).fetchone()
            if not ja:
                conn.execute("""INSERT INTO lancamentos (tipo,categoria,descricao,valor,data_competencia,data_lancamento,usuario_id,status)
                    VALUES ('fixo','Fixo consultor',?,?,?,?,?,'Previsto')""",
                    (f"Fixo {u['nome']} — dia {dia}", metade, ano_mes, f"{ano_mes}-{dia:02d}", u['id']))
                criados += 1
    conn.commit(); close_db(conn)
    return criados

@app.route('/financeiro')
@login_required
@admin_required
def financeiro():
    mes = request.args.get('mes', competencia_atual())
    conn = db()
    # Comissões a receber (futuras) agrupadas por competência
    futuras = conn.execute("""SELECT competencia,
            COALESCE(SUM(valor),0) consultor, COALESCE(SUM(valor_corretora),0) corretora, COUNT(*) qtd
        FROM parcelas WHERE status NOT IN ('Pago ao corretor') AND competencia IS NOT NULL
        GROUP BY competencia ORDER BY competencia""").fetchall()
    # Lançamentos do mês
    custos = conn.execute("SELECT * FROM lancamentos WHERE tipo='custo' AND data_competencia=? ORDER BY id DESC", (mes,)).fetchall()
    aportes = conn.execute("SELECT * FROM lancamentos WHERE tipo='aporte' AND data_competencia=? ORDER BY id DESC", (mes,)).fetchall()
    fixos = conn.execute("""SELECT l.*, u.nome consultor_nome FROM lancamentos l
        LEFT JOIN usuarios u ON u.id=l.usuario_id WHERE l.tipo='fixo' AND l.data_competencia=? ORDER BY l.data_lancamento""", (mes,)).fetchall()
    # Totais do mês
    receber_mes = conn.execute("""SELECT COALESCE(SUM(valor_corretora),0) v FROM parcelas
        WHERE competencia=? AND status NOT IN ('Pago ao corretor')""", (mes,)).fetchone()['v']
    pagar_consultor = conn.execute("""SELECT COALESCE(SUM(valor),0) v FROM parcelas
        WHERE competencia=? AND status NOT IN ('Pago ao corretor')""", (mes,)).fetchone()['v']
    total_custos = sum(c['valor'] for c in custos) + sum(f['valor'] for f in fixos)
    total_aportes = sum(a['valor'] for a in aportes)
    saldo = receber_mes - pagar_consultor - sum(c['valor'] for c in custos) - sum(f['valor'] for f in fixos) + total_aportes
    # ─── DRE do mês ───
    comissao_recebida = conn.execute("""SELECT COALESCE(SUM(valor_corretora),0) v FROM parcelas
        WHERE competencia=? AND status='Pago ao corretor'""", (mes,)).fetchone()['v']
    dre = {
        'receita_bruta': receber_mes,                          # comissões a receber das operadoras
        'repasse_consultores': pagar_consultor,                # (-) repasses
        'custos_operacionais': sum(c['valor'] for c in custos),# (-) custos lançados
        'fixos': sum(f['valor'] for f in fixos),               # (-) fixos
        'aportes': total_aportes,                              # (+) aportes
    }
    dre['margem_bruta'] = dre['receita_bruta'] - dre['repasse_consultores']
    dre['resultado'] = dre['margem_bruta'] - dre['custos_operacionais'] - dre['fixos'] + dre['aportes']
    close_db(conn)
    return render_template('financeiro.html', mes=mes, futuras=futuras,
        custos=custos, aportes=aportes, fixos=fixos,
        receber_mes=receber_mes, pagar_consultor=pagar_consultor,
        total_custos=total_custos, total_aportes=total_aportes, saldo=saldo, dre=dre)

@app.route('/lancamento/salvar', methods=['POST'])
@login_required
@admin_required
def lancamento_salvar():
    d = request.json or {}
    conn = db()
    conn.execute("""INSERT INTO lancamentos (tipo,categoria,descricao,valor,data_competencia,data_lancamento,socio,recorrente,status)
        VALUES (?,?,?,?,?,?,?,?,?)""",
        (d.get('tipo'), d.get('categoria',''), d.get('descricao'), float(d.get('valor') or 0),
         d.get('data_competencia') or competencia_atual(), d.get('data_lancamento',''),
         d.get('socio',''), 1 if d.get('recorrente') else 0, 'Previsto'))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})

@app.route('/lancamento/excluir/<int:lid>', methods=['POST'])
@login_required
@admin_required
def lancamento_excluir(lid):
    conn = db(); conn.execute("DELETE FROM lancamentos WHERE id=?", (lid,))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})

@app.route('/fixo/gerar', methods=['POST'])
@login_required
@admin_required
def fixo_gerar():
    mes = (request.json or {}).get('mes', competencia_atual())
    n = gerar_fixo_mes(mes)
    return jsonify({"ok": True, "criados": n})

# ─── ESTORNO ──────────────────────────────────────────────────────────────────────
@app.route('/estornos')
@login_required
@admin_required
def estornos():
    conn = db()
    regras = conn.execute("""SELECT r.*, COALESCE((SELECT 1 FROM recebimento WHERE operadora=r.operadora LIMIT 1),0) tem_op
        FROM regras_estorno r ORDER BY operadora""").fetchall()
    ops = conn.execute("SELECT DISTINCT operadora FROM recebimento ORDER BY operadora").fetchall()
    estornadas = conn.execute("SELECT * FROM propostas WHERE estornada=1 ORDER BY id DESC LIMIT 30").fetchall()
    close_db(conn)
    return render_template('estornos.html', regras=regras,
        operadoras=[o['operadora'] for o in ops], estornadas=estornadas)

@app.route('/regra-estorno/salvar', methods=['POST'])
@login_required
@admin_required
def regra_estorno_salvar():
    d = request.json or {}
    conn = db()
    conn.execute("""INSERT INTO regras_estorno (operadora,perc_estorno,ate_mensalidade,observacao)
        VALUES (?,?,?,?)
        ON CONFLICT(operadora) DO UPDATE SET perc_estorno=excluded.perc_estorno,
        ate_mensalidade=excluded.ate_mensalidade, observacao=excluded.observacao""",
        (d.get('operadora'), float(d.get('perc_estorno') or 100), int(d.get('ate_mensalidade') or 3), d.get('observacao','')))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})

@app.route('/proposta/<int:pid>/excluir', methods=['POST'])
@login_required
@admin_required
def excluir_proposta_logica(pid):
    """Soft Delete: marca proposta como Excluída, cancela parcelas e registra motivo + detalhe."""
    d = request.json or {}
    motivo = (d.get('motivo_exclusao') or 'Outro').strip()
    detalhe = (d.get('detalhe_exclusao') or '').strip()
    nome_user = session.get('nome', 'admin')

    conn = db()
    p = conn.execute("SELECT * FROM propostas WHERE id=?", (pid,)).fetchone()
    if not p:
        close_db(conn)
        return jsonify({"ok": False, "msg": "Proposta não encontrada"}), 404

    # Atualizar status da proposta (exclusão lógica)
    conn.execute("""
        UPDATE propostas
        SET status='Excluída', motivo_exclusao=?, detalhe_exclusao=?
        WHERE id=?
    """, (motivo, detalhe, pid))

    # Estornar/cancelar todas as parcelas pendentes de receber
    conn.execute("""
        UPDATE parcelas
        SET status='Cancelada / Estornada'
        WHERE proposta_id=? AND status='Pendente de receber'
    """, (pid,))

    # Registrar no histórico
    desc = f"Proposta excluída. Motivo: {motivo}" + (f" — {detalhe}" if detalhe else "")
    conn.execute("""
        INSERT INTO historico_proposta (proposta_id, usuario_id, usuario_nome, tipo, descricao, criado_em)
        VALUES (?, ?, ?, 'exclusao', ?, ?)
    """, (pid, session['user_id'], nome_user, desc, datetime.now(TZ_SP)))

    conn.commit()
    close_db(conn)
    return jsonify({"ok": True, "msg": "Proposta excluída. Parcelas pendentes canceladas/estornadas."})

@app.route('/admin/propostas-excluidas')
@login_required
@admin_required
def propostas_excluidas():
    """Dashboard de propostas excluídas para auditoria."""
    conn = db()
    
    # Métricas
    total_excluidas = conn.execute("SELECT COUNT(*) c FROM propostas WHERE status='Excluída'").fetchone()['c']
    valor_excluido = conn.execute("SELECT COALESCE(SUM(valor),0) v FROM propostas WHERE status='Excluída'").fetchone()['v']
    com_bruta_excluida = conn.execute("SELECT COALESCE(SUM(comissao_total_corretora),0) v FROM propostas WHERE status='Excluída'").fetchone()['v']
    
    # Motivos mais frequentes
    motivos = conn.execute("""
        SELECT motivo_exclusao, COUNT(*) qtd
        FROM propostas 
        WHERE status='Excluída' AND motivo_exclusao IS NOT NULL
        GROUP BY motivo_exclusao
        ORDER BY qtd DESC
    """).fetchall()
    
    # Lista completa
    excluidas = conn.execute("""
        SELECT id, razao_social, consultor, valor, motivo_exclusao, quem_subiu
        FROM propostas 
        WHERE status='Excluída'
        ORDER BY id DESC
    """).fetchall()
    
    close_db(conn)
    return render_template('propostas_excluidas.html', 
                          total=total_excluidas, 
                          valor=valor_excluido,
                          com_bruta=com_bruta_excluida,
                          motivos=motivos,
                          excluidas=excluidas)

@app.route('/admin/recovery-anexos')
@login_required
@admin_required
def recovery_anexos():
    """Página para reenviar anexos perdidos, organizado por proposta."""
    conn = db()
    rows = conn.execute("""
        SELECT id, razao_social, comprovante_boleto, contrato_arquivo, anexos
        FROM propostas
        WHERE status != 'Excluído'
        AND (comprovante_boleto IS NOT NULL
             OR contrato_arquivo IS NOT NULL
             OR (anexos IS NOT NULL AND anexos != '[]'))
        ORDER BY id
    """).fetchall()
    close_db(conn)

    propostas_faltando = []
    for r in rows:
        pid        = r['id'] if hasattr(r,'keys') else r[0]
        razao      = r['razao_social'] if hasattr(r,'keys') else r[1]
        comp       = r['comprovante_boleto'] if hasattr(r,'keys') else r[2]
        cont       = r['contrato_arquivo']   if hasattr(r,'keys') else r[3]
        anexos_raw = r['anexos'] if hasattr(r,'keys') else r[4]

        faltando = []
        for campo, nome in [('comprovante_boleto', comp), ('contrato_arquivo', cont)]:
            if nome:
                basename = os.path.basename(nome)
                if not os.path.exists(os.path.join(UPLOAD_FOLDER, basename)):
                    faltando.append({'campo': campo, 'nome': basename})

        try:
            extras = json.loads(anexos_raw or '[]')
            for a in extras:
                basename = os.path.basename(a)
                if not os.path.exists(os.path.join(UPLOAD_FOLDER, basename)):
                    faltando.append({'campo': 'anexo_extra', 'nome': basename})
        except: pass

        if faltando:
            propostas_faltando.append({
                'id': pid,
                'razao_social': razao,
                'faltando': faltando
            })

    return render_template('recovery_anexos.html',
        propostas=propostas_faltando,
        total_faltando=sum(len(p['faltando']) for p in propostas_faltando)
    )


@app.route('/admin/auditoria')
@login_required
@admin_required
def admin_auditoria():
    """Esteira operacional: propostas que ainda não chegaram em Emitida/Ativa."""
    conn = db()
    em_espera = conn.execute("""
        SELECT p.*, u.nome as nome_consultor
        FROM propostas p
        LEFT JOIN usuarios u ON u.id = p.usuario_id
        WHERE p.status != 'Excluída'
          AND (p.status_operacional IS NULL OR p.status_operacional != 'Emitida/Ativa')
        ORDER BY p.id DESC
    """).fetchall()
    total = len(em_espera)
    close_db(conn)
    return render_template('auditoria.html', propostas=em_espera, total=total)

@app.route('/proposta/<int:pid>/status-operacional', methods=['POST'])
@login_required
@admin_required
def atualizar_status_operacional(pid):
    """Atualiza o status operacional de uma proposta e libera parcelas se Emitida/Ativa."""
    d = request.json or {}
    novo_status = d.get('status_operacional','').strip()
    VALIDOS = ['Aguardando Documentos','Em Análise Operadora','Emitida/Ativa','Suspensa','Cancelada']
    if novo_status not in VALIDOS:
        return jsonify({"ok": False, "msg": f"Status inválido. Use: {VALIDOS}"}), 400

    conn = db()
    p = conn.execute("SELECT status_operacional, comprovante_boleto FROM propostas WHERE id=?", (pid,)).fetchone()
    if not p:
        close_db(conn); return jsonify({"ok": False}), 404

    conn.execute("UPDATE propostas SET status_operacional=? WHERE id=?", (novo_status, pid))

    # Se chegou em Emitida/Ativa: libera parcelas bloqueadas por falta de comprovante
    if novo_status == 'Emitida/Ativa':
        conn.execute("""UPDATE parcelas SET status='Pendente de receber'
            WHERE proposta_id=? AND status='Bloqueado - Falta Comprovante'""", (pid,))

    # Histórico
    conn.execute("""INSERT INTO historico_proposta (proposta_id,usuario_id,usuario_nome,tipo,descricao,criado_em)
        VALUES (?,?,?,?,?,?)""", (pid, session['user_id'], session.get('nome','admin'),
        'status_operacional', f"Status operacional: {p['status_operacional'] or '—'} → {novo_status}", datetime.now(TZ_SP)))

    # Atualizar pendencias_json se enviado
    if 'pendencias_json' in d:
        conn.execute("UPDATE propostas SET pendencias_json=? WHERE id=?",
                     (json.dumps(d['pendencias_json'], ensure_ascii=False), pid))

    conn.commit(); close_db(conn)
    return jsonify({"ok": True, "msg": f"Status atualizado para '{novo_status}'"})


# ─── BOLETO DE ADESÃO ──────────────────────────────────────────────────────────

@app.route('/proposta/<int:pid>/gerar-boleto-adesao', methods=['POST'])
@login_required
def gerar_boleto_adesao(pid):
    """
    Gera boleto de taxa de adesão via Asaas.
    Payload: {valor: 150.00, vencimento: '2026-07-01'}
    """
    if not asaas_configurado():
        return jsonify({'ok': False, 'erro': 'Asaas não configurado. Verifique ASAAS_API_KEY no Railway.'}), 500

    conn = db()
    p = conn.execute("""
        SELECT id, razao_social, tipo_pessoa, cpf_titular, cnpj,
               email_resp_contrato, tel_resp_contrato, produto,
               resp_contrato, adesao_asaas_customer_id,
               end_logradouro, end_numero, end_complemento,
               end_bairro, end_cidade, end_estado, end_cep
        FROM propostas WHERE id=?
    """, (pid,)).fetchone()
    if not p:
        close_db(conn)
        return jsonify({'ok': False, 'erro': 'Proposta não encontrada'}), 404

    d = request.get_json(force=True) or {}
    valor_raw  = d.get('valor', '')
    vencimento = (d.get('vencimento') or '').strip()
    descricao  = (d.get('descricao') or '').strip()
    # Endereço — pode vir do payload (usuário digitou) ou já estar na proposta
    end_log    = (d.get('end_logradouro')  or p['end_logradouro']  or '').strip() if hasattr(p,'keys') else (d.get('end_logradouro') or p[10] or '').strip()
    end_num    = (d.get('end_numero')      or p['end_numero']      or '').strip() if hasattr(p,'keys') else (d.get('end_numero')     or p[11] or '').strip()
    end_comp   = (d.get('end_complemento') or p['end_complemento'] or '').strip() if hasattr(p,'keys') else (d.get('end_complemento')or p[12] or '').strip()
    end_bairro = (d.get('end_bairro')      or p['end_bairro']      or '').strip() if hasattr(p,'keys') else (d.get('end_bairro')     or p[13] or '').strip()
    end_cidade = (d.get('end_cidade')      or p['end_cidade']      or '').strip() if hasattr(p,'keys') else (d.get('end_cidade')     or p[14] or '').strip()
    end_estado = (d.get('end_estado')      or p['end_estado']      or '').strip() if hasattr(p,'keys') else (d.get('end_estado')     or p[15] or '').strip()
    end_cep    = (d.get('end_cep')         or p['end_cep']         or '').strip() if hasattr(p,'keys') else (d.get('end_cep')        or p[16] or '').strip()
    end_cep_dig = ''.join(c for c in end_cep if c.isdigit())

    # Valida valor
    try:
        valor = float(str(valor_raw).replace(',', '.'))
        if valor <= 0: raise ValueError()
    except Exception:
        close_db(conn)
        return jsonify({'ok': False, 'erro': 'Valor inválido.'}), 400

    if not vencimento:
        close_db(conn)
        return jsonify({'ok': False, 'erro': 'Informe a data de vencimento.'}), 400

    # CPF ou CNPJ
    tipo_pessoa = (p['tipo_pessoa'] if hasattr(p,'keys') else 'PF') or 'PF'
    tipo_pessoa = tipo_pessoa.upper()
    if 'J' in tipo_pessoa or 'JURIDICA' in tipo_pessoa or 'EMPRESA' in tipo_pessoa:
        doc = ''.join(c for c in (p['cnpj'] if hasattr(p,'keys') else p[4] or '') if c.isdigit())
        tipo_doc = 'CNPJ'
    else:
        doc = ''.join(c for c in (p['cpf_titular'] if hasattr(p,'keys') else p[3] or '') if c.isdigit())
        tipo_doc = 'CPF'

    if not doc or len(doc) < 11:
        close_db(conn)
        return jsonify({'ok': False, 'erro': f'{tipo_doc} do cliente não preenchido. Edite a proposta.'}), 400

    razao_social      = p['razao_social']         if hasattr(p,'keys') else p[1]
    email             = p['email_resp_contrato']  if hasattr(p,'keys') else p[5] or ''
    telefone          = p['tel_resp_contrato']    if hasattr(p,'keys') else p[6] or ''
    produto           = p['produto']              if hasattr(p,'keys') else p[7] or ''
    asaas_customer_id = p['adesao_asaas_customer_id'] if hasattr(p,'keys') else p[9]

    # Descrição padrão se não veio do payload
    if not descricao:
        descricao = f"Taxa de Adesão — {produto or 'Plano de Saúde'} (Proposta #{pid})"

    # ── 1. Salva endereço na proposta (para próxima vez auto-preencher) ──
    if end_log or end_cidade or end_cep:
        conn.execute("""UPDATE propostas SET
            end_logradouro=?, end_numero=?, end_complemento=?,
            end_bairro=?, end_cidade=?, end_estado=?, end_cep=?
            WHERE id=?""",
            (end_log, end_num, end_comp, end_bairro, end_cidade, end_estado, end_cep, pid))

    # ── 2. Criar/atualizar cliente no Asaas (com endereço para NF) ──
    payload_cliente = {
        "name": razao_social,
        "cpfCnpj": doc,
        "email": email or None,
        "mobilePhone": _normalizar_telefone(telefone) if telefone else None,
        "notificationDisabled": False,
    }
    # Adiciona endereço se disponível
    if end_cep_dig:
        payload_cliente["postalCode"]   = end_cep_dig
        payload_cliente["address"]      = end_log or None
        payload_cliente["addressNumber"]= end_num or None
        payload_cliente["complement"]   = end_comp or None
        payload_cliente["province"]     = end_bairro or None
    payload_cliente = {k: v for k, v in payload_cliente.items() if v}

    if not asaas_customer_id:
        cliente_data, sc = asaas_request("POST", "/customers", payload_cliente)
        if sc not in (200, 201) or 'id' not in cliente_data:
            close_db(conn)
            erro = cliente_data.get('errors',[{}])[0].get('description', str(cliente_data)) if 'errors' in cliente_data else str(cliente_data)
            return jsonify({'ok': False, 'erro': f'Erro ao criar cliente no Asaas: {erro}'}), 500
        asaas_customer_id = cliente_data['id']
        conn.execute("UPDATE propostas SET adesao_asaas_customer_id=? WHERE id=?", (asaas_customer_id, pid))
    else:
        # Atualiza endereço no cliente existente
        asaas_request("PUT", f"/customers/{asaas_customer_id}", payload_cliente)

    # ── 3. Criar cobrança BOLETO ──
    payload_cobranca = {
        "customer":          asaas_customer_id,
        "billingType":       "BOLETO",
        "value":             valor,
        "dueDate":           vencimento,
        "description":       descricao,
        "externalReference": f"proposta_{pid}",
    }
    cobranca_data, sc = asaas_request("POST", "/payments", payload_cobranca)
    if sc not in (200, 201) or 'id' not in cobranca_data:
        close_db(conn)
        erro = cobranca_data.get('errors',[{}])[0].get('description', str(cobranca_data)) if 'errors' in cobranca_data else str(cobranca_data)
        return jsonify({'ok': False, 'erro': f'Erro ao criar boleto no Asaas: {erro}'}), 500

    payment_id = cobranca_data.get('id', '')
    boleto_url = cobranca_data.get('bankSlipUrl', '')
    linha_dig  = cobranca_data.get('identificationField', '')

    # ── 4. Baixa o PDF do boleto e salva localmente ──
    boleto_pdf_nome = None
    if boleto_url:
        try:
            import urllib.request as _ur
            boleto_pdf_nome = f"BOLETO_ADESAO_{pid}_{datetime.now(TZ_SP).strftime('%Y%m%d%H%M%S')}.pdf"
            _ur.urlretrieve(boleto_url, os.path.join(UPLOAD_FOLDER, boleto_pdf_nome))
        except Exception as e:
            app.logger.warning(f"[GERAR_BOLETO] Não baixou PDF: {e}")
            boleto_pdf_nome = None

    # ── 5. Salva tudo na proposta ──
    conn.execute("""
        UPDATE propostas SET
            adesao_asaas_payment_id = ?,
            adesao_boleto_url       = ?,
            adesao_linha_digitavel  = ?,
            adesao_valor            = ?,
            adesao_vencimento       = ?,
            adesao_status           = 'Aguardando Pagamento',
            adesao_descricao        = ?,
            adesao_boleto_pdf       = COALESCE(?, adesao_boleto_pdf)
        WHERE id = ?
    """, (payment_id, boleto_url, linha_dig, valor, vencimento,
          descricao, boleto_pdf_nome, pid))

    conn.execute("""
        INSERT INTO historico_proposta (proposta_id, usuario_id, usuario_nome, tipo, descricao, criado_em)
        VALUES (?, ?, ?, 'boleto_adesao', ?, ?)
    """, (pid, session['user_id'], session.get('nome',''),
          f'Boleto de adesão gerado — R$ {valor:.2f} — venc. {vencimento} — "{descricao}"',
          datetime.now(TZ_SP)))

    conn.commit()
    close_db(conn)
    return jsonify({
        'ok':             True,
        'payment_id':     payment_id,
        'boleto_url':     boleto_url,
        'linha_digitavel': linha_dig,
        'valor':          valor,
        'vencimento':     vencimento,
        'descricao':      descricao,
        'boleto_pdf':     boleto_pdf_nome,
        'msg':            f'Boleto gerado! Venc. {vencimento}'
    })


@app.route('/proposta/<int:pid>/boleto-adesao')
@login_required
def ver_boleto_adesao(pid):
    """Redireciona para o boleto de adesão gerado no Asaas (download/visualização)."""
    conn = db()
    p = conn.execute(
        "SELECT adesao_boleto_url, adesao_status, razao_social FROM propostas WHERE id=?",
        (pid,)
    ).fetchone()
    close_db(conn)

    if not p:
        flash('Proposta não encontrada.', 'error')
        return redirect(url_for('listar_propostas'))

    boleto_url = p['adesao_boleto_url'] if hasattr(p, 'keys') else p[0]
    if not boleto_url:
        flash('Boleto não gerado ainda. Gere o boleto primeiro.', 'warning')
        return redirect(url_for('detalhe_proposta', pid=pid))

    return redirect(boleto_url)


@app.route('/proposta/<int:pid>/boleto-adesao/cancelar', methods=['POST'])
@login_required
def cancelar_boleto_adesao(pid):
    """Cancela o boleto de adesão no Asaas e limpa os dados na proposta."""
    if session.get('perfil') != 'admin':
        return jsonify({'ok': False, 'erro': 'Apenas administradores podem cancelar boletos.'}), 403

    conn = db()
    p = conn.execute(
        "SELECT adesao_asaas_payment_id, adesao_status, razao_social FROM propostas WHERE id=?",
        (pid,)
    ).fetchone()

    if not p:
        close_db(conn)
        return jsonify({'ok': False, 'erro': 'Proposta não encontrada'}), 404

    payment_id  = p['adesao_asaas_payment_id'] if hasattr(p, 'keys') else p[0]
    status_atual = p['adesao_status'] if hasattr(p, 'keys') else p[1]

    if not payment_id:
        close_db(conn)
        return jsonify({'ok': False, 'erro': 'Nenhum boleto gerado para cancelar'}), 400

    if status_atual == 'Pago':
        close_db(conn)
        return jsonify({'ok': False, 'erro': 'Boleto já foi pago — não pode ser cancelado'}), 400

    # Cancela no Asaas (DELETE /payments/{id})
    data, sc = asaas_request('DELETE', f'/payments/{payment_id}')

    # Asaas retorna 200 com {"deleted": true} ou {"id": ..., "status": "CANCELLED"}
    cancelado_asaas = sc in (200, 204) or data.get('deleted') or data.get('status') == 'CANCELLED'

    if not cancelado_asaas:
        close_db(conn)
        erro = data.get('errors', [{}])[0].get('description', str(data)) if 'errors' in data else str(data)
        return jsonify({'ok': False, 'erro': f'Erro ao cancelar no Asaas: {erro}'}), 500

    # Limpa os dados do boleto na proposta
    conn.execute("""
        UPDATE propostas SET
            adesao_asaas_payment_id = NULL,
            adesao_boleto_url       = NULL,
            adesao_linha_digitavel  = NULL,
            adesao_valor            = NULL,
            adesao_vencimento       = NULL,
            adesao_status           = 'Cancelado'
        WHERE id = ?
    """, (pid,))

    conn.execute("""
        INSERT INTO historico_proposta (proposta_id, usuario_id, usuario_nome, tipo, descricao, criado_em)
        VALUES (?, ?, ?, 'boleto_adesao', ?, ?)
    """, (pid, session['user_id'], session.get('nome', ''),
          f'Boleto de adesão cancelado (Asaas ID: {payment_id})',
          datetime.now(TZ_SP)))

    conn.commit()
    close_db(conn)
    return jsonify({'ok': True, 'msg': 'Boleto cancelado com sucesso.'})



@app.route('/proposta/<int:pid>/boleto-adesao/status')
@login_required
def status_boleto_adesao(pid):
    """Consulta status do boleto de adesão no Asaas e atualiza no banco.
    Se pago: baixa o PDF do boleto e salva o comprovante automaticamente."""
    conn = db()
    p = conn.execute(
        "SELECT adesao_asaas_payment_id, adesao_status, adesao_boleto_url FROM propostas WHERE id=?",
        (pid,)
    ).fetchone()

    if not p:
        close_db(conn)
        return jsonify({'ok': False, 'erro': 'Proposta não encontrada'}), 404

    payment_id   = p['adesao_asaas_payment_id'] if hasattr(p, 'keys') else p[0]
    status_banco = p['adesao_status']            if hasattr(p, 'keys') else p[1]
    boleto_url   = p['adesao_boleto_url']        if hasattr(p, 'keys') else p[2]

    if not payment_id:
        close_db(conn)
        return jsonify({'ok': False, 'erro': 'Boleto não gerado ainda'}), 404

    # Consulta no Asaas
    data, sc = asaas_request("GET", f"/payments/{payment_id}")

    if sc != 200 or 'status' not in data:
        close_db(conn)
        return jsonify({'ok': False, 'erro': f'Erro ao consultar Asaas: {data}'}), 500

    status_asaas = data['status']
    STATUS_MAP = {
        'PENDING':   'Aguardando Pagamento',
        'RECEIVED':  'Pago',
        'CONFIRMED': 'Pago',
        'OVERDUE':   'Vencido',
        'REFUNDED':  'Estornado',
        'CANCELED':  'Cancelado',
    }
    status_legivel = STATUS_MAP.get(status_asaas, status_asaas)
    pago = status_asaas in ('RECEIVED', 'CONFIRMED')

    # Atualiza status no banco
    conn.execute("UPDATE propostas SET adesao_status=? WHERE id=?", (status_legivel, pid))

    # Se foi pago agora (antes estava pendente): salva o boleto PDF como comprovante
    comprovante_gerado = None
    if pago and status_banco not in ('Pago',):
        try:
            import urllib.request as _ur
            # Baixa o PDF do boleto do Asaas
            boleto_pdf_url = data.get('bankSlipUrl') or boleto_url
            if boleto_pdf_url:
                nome_pdf = f"BOLETO_ADESAO_{pid}_{datetime.now(TZ_SP).strftime('%Y%m%d%H%M%S')}.pdf"
                caminho_pdf = os.path.join(UPLOAD_FOLDER, nome_pdf)
                _ur.urlretrieve(boleto_pdf_url, caminho_pdf)
                # Salva como comprovante_boleto se ainda não tiver
                p2 = conn.execute("SELECT comprovante_boleto FROM propostas WHERE id=?", (pid,)).fetchone()
                comprovante_atual = p2['comprovante_boleto'] if hasattr(p2,'keys') else p2[0]
                if not comprovante_atual:
                    conn.execute("UPDATE propostas SET comprovante_boleto=? WHERE id=?", (nome_pdf, pid))
                    conn.execute("""UPDATE parcelas SET status='Pendente de receber'
                        WHERE proposta_id=? AND status='Bloqueado - Falta Comprovante'""", (pid,))
                # Salva também como adesao_boleto_pdf (histórico do boleto emitido)
                conn.execute("UPDATE propostas SET adesao_boleto_pdf=? WHERE id=?", (nome_pdf, pid))
                conn.execute("""
                    INSERT INTO historico_proposta (proposta_id, usuario_id, usuario_nome, tipo, descricao, criado_em)
                    VALUES (?, ?, ?, 'boleto_adesao', ?, ?)
                """, (pid, session['user_id'], session.get('nome','Sistema'),
                      f'Boleto de adesão PAGO — comprovante salvo automaticamente: {nome_pdf}',
                      datetime.now(TZ_SP)))
                comprovante_gerado = nome_pdf
        except Exception as e:
            app.logger.warning(f"[BOLETO_STATUS] Não foi possível baixar PDF: {e}")

    conn.commit()
    close_db(conn)
    return jsonify({
        'ok':                True,
        'status_asaas':      status_asaas,
        'status':            status_legivel,
        'pago':              pago,
        'comprovante_gerado': comprovante_gerado,
    })


@app.route('/proposta/<int:pid>/comprovante-upload', methods=['POST'])
@login_required
def upload_comprovante(pid):
    conn = db()
    p = conn.execute("SELECT usuario_id FROM propostas WHERE id=?", (pid,)).fetchone()
    if not p: close_db(conn); return jsonify({"ok": False}), 404
    if session['perfil'] != 'admin' and p['usuario_id'] != session['user_id']:
        close_db(conn); return jsonify({"ok": False}), 403

    f = request.files.get('comprovante_boleto')
    if not f or not f.filename:
        close_db(conn); return jsonify({"ok": False, "msg": "Arquivo não enviado"}), 400

    # Gerar nome único
    nome = f"COMPROVANTE_{pid}_{datetime.now(TZ_SP).strftime('%Y%m%d%H%M%S')}_{_sanitizar_filename(f.filename)}"
    
    # UPLOAD COM R2 + FALLBACK AUTOMÁTICO
    chave_r2 = f"propostas/{pid}/comprovante/{nome}"
    resultado = upload_arquivo_r2(f.stream, chave_r2)
    
    if not resultado.get('ok'):
        close_db(conn)
        app.logger.error(f"[UPLOAD] ❌ Erro upload comprovante {pid}: {resultado.get('erro', 'desconhecido')}")
        return jsonify({"ok": False, "msg": f"Erro ao salvar arquivo: {resultado.get('erro', 'desconhecido')}"}), 500
    
    storage_tipo = resultado.get('storage', 'local')
    app.logger.info(f"[UPLOAD] ✅ Comprovante {pid} salvo em {storage_tipo}")
    
    # Atualizar banco de dados
    conn.execute("UPDATE propostas SET comprovante_boleto=? WHERE id=?", (nome, pid))
    conn.execute("""UPDATE parcelas SET status='Pendente de receber'
        WHERE proposta_id=? AND status='Bloqueado - Falta Comprovante'""", (pid,))
    conn.execute("""INSERT INTO historico_proposta (proposta_id,usuario_id,usuario_nome,tipo,descricao,criado_em)
        VALUES (?,?,?,?,?,?)""", (pid, session['user_id'], session.get('nome','admin'),
        'comprovante', f"Comprovante anexado: {nome} ({storage_tipo})", datetime.now(TZ_SP)))
    
    conn.commit(); close_db(conn)
    return jsonify({
        "ok": True, 
        "msg": f"Comprovante salvo em {storage_tipo}. Parcelas desbloqueadas.", 
        "nome": nome,
        "storage": storage_tipo
    })

@app.route('/proposta/<int:pid>/contrato-upload', methods=['POST'])
@login_required
def upload_contrato(pid):
    """Upload do contrato / proposta assinada (com R2 + fallback)."""
    conn = db()
    p = conn.execute("SELECT usuario_id FROM propostas WHERE id=?", (pid,)).fetchone()
    if not p: close_db(conn); return jsonify({"ok": False}), 404
    if session['perfil'] != 'admin' and p['usuario_id'] != session['user_id']:
        close_db(conn); return jsonify({"ok": False}), 403

    f = request.files.get('contrato_arquivo')
    if not f or not f.filename:
        close_db(conn); return jsonify({"ok": False, "msg": "Arquivo não enviado"}), 400

    # Gerar nome único
    nome = f"CONTRATO_{pid}_{datetime.now(TZ_SP).strftime('%Y%m%d%H%M%S')}_{_sanitizar_filename(f.filename)}"
    
    # UPLOAD COM R2 + FALLBACK AUTOMÁTICO
    chave_r2 = f"propostas/{pid}/contrato/{nome}"
    resultado = upload_arquivo_r2(f.stream, chave_r2)
    
    if not resultado.get('ok'):
        close_db(conn)
        app.logger.error(f"[UPLOAD] ❌ Erro upload contrato {pid}: {resultado.get('erro', 'desconhecido')}")
        return jsonify({"ok": False, "msg": f"Erro ao salvar arquivo: {resultado.get('erro', 'desconhecido')}"}), 500
    
    storage_tipo = resultado.get('storage', 'local')
    app.logger.info(f"[UPLOAD] ✅ Contrato {pid} salvo em {storage_tipo}")
    
    # Atualizar banco de dados
    conn.execute("UPDATE propostas SET contrato_arquivo=? WHERE id=?", (nome, pid))
    conn.execute("""INSERT INTO historico_proposta (proposta_id,usuario_id,usuario_nome,tipo,descricao,criado_em)
        VALUES (?,?,?,?,?,?)""", (pid, session['user_id'], session.get('nome','admin'),
        'contrato', f"Contrato anexado: {nome} ({storage_tipo})", datetime.now(TZ_SP)))
    
    conn.commit(); close_db(conn)
    return jsonify({
        "ok": True, 
        "msg": f"Contrato salvo em {storage_tipo}.", 
        "nome": nome,
        "storage": storage_tipo
    })

@app.route('/proposta/<int:pid>/doc-upload', methods=['POST'])
@login_required
def upload_doc_extra(pid):
    """Upload de documento extra (bordo). Adiciona ao array de anexos (com R2 + fallback)."""
    conn = db()
    p = conn.execute("SELECT usuario_id, anexos FROM propostas WHERE id=?", (pid,)).fetchone()
    if not p: close_db(conn); return jsonify({"ok": False}), 404
    if session['perfil'] != 'admin' and p['usuario_id'] != session['user_id']:
        close_db(conn); return jsonify({"ok": False}), 403

    f = request.files.get('documento')
    tipo = (request.form.get('tipo') or 'Documento').strip()
    if not f or not f.filename:
        close_db(conn); return jsonify({"ok": False, "msg": "Arquivo não enviado"}), 400

    prefixo = tipo.upper().replace(' ', '_').replace('/', '_')[:20]
    nome = f"{prefixo}_{pid}_{datetime.now(TZ_SP).strftime('%Y%m%d%H%M%S')}_{_sanitizar_filename(f.filename)}"
    
    # UPLOAD COM R2 + FALLBACK AUTOMÁTICO
    chave_r2 = f"propostas/{pid}/documentos/{nome}"
    resultado = upload_arquivo_r2(f.stream, chave_r2)
    
    if not resultado.get('ok'):
        close_db(conn)
        app.logger.error(f"[UPLOAD] ❌ Erro upload documento {pid}: {resultado.get('erro', 'desconhecido')}")
        return jsonify({"ok": False, "msg": f"Erro ao salvar arquivo: {resultado.get('erro', 'desconhecido')}"}), 500
    
    storage_tipo = resultado.get('storage', 'local')
    app.logger.info(f"[UPLOAD] ✅ Documento {pid} ({tipo}) salvo em {storage_tipo}")

    # Atualizar array de anexos
    try: 
        anexos = json.loads(p['anexos'] or '[]')
    except: 
        anexos = []
    
    anexos.append(nome)
    
    conn.execute("UPDATE propostas SET anexos=? WHERE id=?", (json.dumps(anexos), pid))
    conn.execute("""INSERT INTO historico_proposta (proposta_id,usuario_id,usuario_nome,tipo,descricao,criado_em)
        VALUES (?,?,?,?,?,?)""", (pid, session['user_id'], session.get('nome','admin'),
        'documento', f"Documento anexado ({tipo}): {nome} ({storage_tipo})", datetime.now(TZ_SP)))
    conn.commit(); close_db(conn)
    return jsonify({
        "ok": True, 
        "msg": f"{tipo} salvo em {storage_tipo}.", 
        "nome": nome,
        "storage": storage_tipo,
        "tipo": tipo
    })




@app.route('/proposta/<int:pid>/estornar', methods=['POST'])
@login_required
@admin_required
def estornar_proposta(pid):
    """Estorno simplificado: cancela parcelas pendentes e marca proposta como estornada."""
    conn = db()
    p = conn.execute("SELECT * FROM propostas WHERE id=?", (pid,)).fetchone()
    if not p:
        close_db(conn); return jsonify({"ok": False, "msg": "Proposta não encontrada"}), 404

    # Cancela todas as parcelas pendentes
    canceladas = conn.execute("""UPDATE parcelas SET status='Cancelada / Estornada'
        WHERE proposta_id=? AND status IN ('Pendente de receber','Bloqueado - Falta Comprovante')""", (pid,)).rowcount

    # Marca proposta como estornada
    info = f"Estorno confirmado por {session.get('nome','admin')} em {datetime.now(TZ_SP).strftime('%d/%m/%Y %H:%M')}. {canceladas} parcela(s) cancelada(s)."
    conn.execute("UPDATE propostas SET estornada=1, estorno_info=? WHERE id=?", (info, pid))

    # Histórico
    conn.execute("""INSERT INTO historico_proposta (proposta_id,usuario_id,usuario_nome,tipo,descricao,criado_em)
        VALUES (?,?,?,?,?,?)""", (pid, session['user_id'], session.get('nome','admin'),
        'estorno', info, datetime.now(TZ_SP)))

    conn.commit(); close_db(conn)
    return jsonify({"ok": True, "msg": info})

# ─── APIs ────────────────────────────────────────────────────────────────────────
@app.route('/api/comissoes-publicas')
@login_required
def api_com_pub():
    eh_admin = session.get('perfil') == 'admin'
    conn = db()
    rec = conn.execute("SELECT * FROM recebimento").fetchall()
    reps = conn.execute("SELECT * FROM repasse_corretor").fetchall()
    niveis = conn.execute("SELECT * FROM niveis ORDER BY ordem").fetchall()
    close_db(conn)
    # repasse: o que o consultor recebe (pode ver). Removemos nada aqui.
    rep_map = {f"{r['operadora']}|{r['plano']}|{r['modelo']}|{r['nivel']}": dict(r) for r in reps}
    operadoras = sorted({r['operadora'] for r in rec})

    if eh_admin:
        # Admin enxerga o recebimento da corretora (para o preview completo).
        rec_map = {}
        for r in rec:
            k = f"{r['operadora']}|{r['plano']}"
            if k not in rec_map or not r['obs']:
                rec_map[k] = r['total']
    else:
        # CONSULTOR: NÃO recebe o recebimento da corretora (sigilo de margem).
        # Enviamos um placeholder só para o preview saber que a operadora existe,
        # sem revelar o multiplicador real (valor neutro 1 — não usado no cálculo da comissão dele).
        rec_map = {}
        for r in rec:
            k = f"{r['operadora']}|{r['plano']}"
            rec_map[k] = 1  # presença da chave habilita o preview; não revela margem

    return jsonify({
        'recebimento': rec_map,
        'repasses': rep_map,
        'operadoras': operadoras,
        'niveis': [dict(n) for n in niveis],
    })

@app.route('/api/propostas')
@login_required
def api_propostas():
    conn = db(); uid = session['user_id']
    eh_admin = session['perfil'] == 'admin'
    if eh_admin:
        rows = conn.execute("SELECT * FROM propostas ORDER BY id DESC").fetchall()
    else:
        rows = conn.execute("SELECT * FROM propostas WHERE usuario_id=? ORDER BY id DESC",(uid,)).fetchall()
    close_db(conn)
    # Colunas sensíveis de margem da corretora — nunca expor ao consultor.
    SENSIVEIS = {'comissao_total_corretora', 'comissao_corretora_liquida'}
    saida = []
    for r in rows:
        d = dict(r)
        if not eh_admin:
            for col in SENSIVEIS:
                d.pop(col, None)
        saida.append(d)
    return jsonify(saida)


@app.route('/api/bi/propostas')
def api_bi_propostas():
    """Power BI endpoint — propostas com filtros, sem login. Requer API_KEY no header."""
    api_key = request.headers.get('X-API-Key', '').strip()
    expected_key = os.environ.get('API_KEY_BI', '')
    if not api_key or not expected_key or api_key != expected_key:
        return jsonify({"erro": "API_KEY inválida ou não configurada"}), 401

    # Filtros opcionais
    data_inicio = request.args.get('data_inicio', '').strip()  # YYYY-MM-DD
    data_fim = request.args.get('data_fim', '').strip()
    status = request.args.get('status', '').strip()
    operadora = request.args.get('operadora', '').strip()
    pagina = int(request.args.get('pagina', 1))
    limit = min(int(request.args.get('limit', 100)), 500)  # max 500
    offset = (pagina - 1) * limit

    conn = db()
    query = "SELECT * FROM propostas WHERE 1=1"
    params = []

    if data_inicio:
        query += " AND data_proposta >= ?"
        params.append(data_inicio)
    if data_fim:
        query += " AND data_proposta <= ?"
        params.append(data_fim)
    if status:
        query += " AND status = ?"
        params.append(status)
    if operadora:
        query += " AND operadora LIKE ?"
        params.append(f"%{operadora}%")

    # Total com filtros
    total = conn.execute(query.replace("SELECT *", "SELECT COUNT(*) as cnt"), params).fetchone()['cnt']

    # Dados com paginação
    query += " ORDER BY id DESC LIMIT ? OFFSET ?"
    params.extend([limit, offset])
    rows = conn.execute(query, params).fetchall()
    close_db(conn)

    # Campos úteis para BI
    CAMPOS_BI = {'id', 'status', 'data_proposta', 'operadora', 'plano', 'valor_mensal',
                 'numero_proposta', 'beneficiario', 'consultor', 'comissao_total_corretora'}

    saida = []
    for r in rows:
        d = dict(r)
        d_filtrado = {k: v for k, v in d.items() if k in CAMPOS_BI}
        saida.append(d_filtrado)

    return jsonify({
        'total': total,
        'pagina': pagina,
        'limit': limit,
        'dados': saida
    })


@app.route('/api/bi/comissoes')
def api_bi_comissoes():
    """
    Power BI / Google Sheets — comissões (parcelas) detalhadas + resumo por consultor/competência.
    Requer header X-API-Key (env var API_KEY_BI). Filtros opcionais: competencia, consultor, status.
    """
    api_key = request.headers.get('X-API-Key', '').strip()
    expected_key = os.environ.get('API_KEY_BI', '')
    if not api_key or not expected_key or api_key != expected_key:
        return jsonify({"erro": "API_KEY inválida ou não configurada"}), 401

    f_competencia = request.args.get('competencia', '').strip()
    f_consultor = request.args.get('consultor', '').strip()
    f_status = request.args.get('status', '').strip()

    conn = db()
    # JOIN parcelas + propostas (dados do negócio)
    rows = conn.execute("""
        SELECT p.id AS parcela_id, p.proposta_id, p.numero, p.valor, p.valor_corretora,
               p.perc_cliente, p.competencia, p.status, p.data_prevista, p.data_pagamento,
               p.tipo_origem,
               pr.consultor, pr.razao_social, pr.adm_operadora, pr.produto,
               pr.numero_proposta, pr.modalidade, pr.tipo_pessoa
        FROM parcelas p
        JOIN propostas pr ON pr.id = p.proposta_id
        WHERE pr.estornada = 0
        ORDER BY p.proposta_id DESC, p.numero ASC
    """).fetchall()
    close_db(conn)

    detalhado = []
    resumo = {}  # chave: consultor|competencia
    for r in rows:
        d = dict(r)
        # Filtros opcionais (em memória — compatível PG/SQLite)
        if f_competencia and (d.get('competencia') or '') != f_competencia:
            continue
        if f_consultor and (d.get('consultor') or '').lower() != f_consultor.lower():
            continue
        if f_status and (d.get('status') or '') != f_status:
            continue

        linha = {
            'proposta_id': d.get('proposta_id'),
            'numero_proposta': d.get('numero_proposta') or '',
            'parcela': d.get('numero'),
            'cliente': d.get('razao_social') or '',
            'consultor': d.get('consultor') or '',
            'operadora': d.get('adm_operadora') or '',
            'produto': d.get('produto') or '',
            'modalidade': d.get('modalidade') or '',
            'tipo_pessoa': d.get('tipo_pessoa') or '',
            'valor_comissao': round(float(d.get('valor') or 0), 2),
            'valor_corretora': round(float(d.get('valor_corretora') or 0), 2),
            'competencia': d.get('competencia') or '',
            'status': d.get('status') or '',
            'data_prevista': d.get('data_prevista') or '',
            'data_pagamento': d.get('data_pagamento') or '',
            'tipo_origem': d.get('tipo_origem') or '',
        }
        detalhado.append(linha)

        # Resumo por consultor + competência
        chave = f"{linha['consultor']}|{linha['competencia']}"
        if chave not in resumo:
            resumo[chave] = {
                'consultor': linha['consultor'],
                'competencia': linha['competencia'],
                'total_comissao': 0.0,
                'total_recebido': 0.0,
                'total_pendente': 0.0,
                'qtd_parcelas': 0,
            }
        rs = resumo[chave]
        rs['total_comissao'] = round(rs['total_comissao'] + linha['valor_comissao'], 2)
        rs['qtd_parcelas'] += 1
        status_lower = linha['status'].lower()
        if 'pago' in status_lower or 'recebido' in status_lower:
            rs['total_recebido'] = round(rs['total_recebido'] + linha['valor_comissao'], 2)
        else:
            rs['total_pendente'] = round(rs['total_pendente'] + linha['valor_comissao'], 2)

    return jsonify({
        'gerado_em': datetime.now(TZ_SP).strftime('%d/%m/%Y %H:%M:%S'),
        'total_parcelas': len(detalhado),
        'detalhado': detalhado,
        'resumo': sorted(resumo.values(), key=lambda x: (x['consultor'], x['competencia'])),
    })


@app.route('/api/bi/regras')
def api_bi_regras():
    """
    Power BI / Google Sheets — REGRAS de comissão (configuração):
    - recebimento: quanto a corretora recebe por operadora/plano (PME, PF, Adesão)
    - repasse: quanto o corretor recebe por operadora/plano/modelo/nível
    Retorna colunas + linhas já pivotadas e com cabeçalhos legíveis.
    Requer header X-API-Key (env API_KEY_BI).
    """
    api_key = request.headers.get('X-API-Key', '').strip()
    expected_key = os.environ.get('API_KEY_BI', '')
    if not api_key or not expected_key or api_key != expected_key:
        return jsonify({"erro": "API_KEY inválida ou não configurada"}), 401

    def g(r, k):
        return (r[k] if hasattr(r, 'keys') else None)

    LABEL_PLANO = {'PME': 'PME (%)', 'PF': 'PF (%)', 'ADESAO': 'Adesão (%)'}
    LABEL_MODELO = {
        'sem_lead_sem_fixo': 'Sem Lead / Sem Fixo',
        'com_lead': 'Com Lead / Sem Fixo',
        'com_lead|n1': 'Nível 1', 'com_lead|n2': 'Nível 2', 'com_lead|n3': 'Nível 3',
        'com_fixo_lead': 'Com Fixo + Lead',
        'sem_lead_com_fixo': 'Com Fixo / Sem Lead', 'com_fixo_sem_lead': 'Com Fixo / Sem Lead',
        'gestor_vendedor': 'Gestor Vendedor',
    }
    ORDEM_PLANO = ['PME', 'PF', 'ADESAO']
    ORDEM_MODELO = ['sem_lead_sem_fixo', 'com_lead', 'com_lead|n1', 'com_lead|n2',
                    'com_lead|n3', 'com_fixo_lead', 'sem_lead_com_fixo', 'com_fixo_sem_lead', 'gestor_vendedor']

    conn = db()
    rec = conn.execute("SELECT operadora, obs, plano, total FROM recebimento").fetchall()
    reps = conn.execute("SELECT operadora, obs, plano, modelo, nivel, total FROM repasse_corretor").fetchall()
    close_db(conn)

    # ── RECEBIMENTO pivot por (operadora, obs) ──
    rec_planos, rec_map = [], {}
    for r in rec:
        op, ob, pl, tot = g(r, 'operadora'), g(r, 'obs') or '', g(r, 'plano'), g(r, 'total')
        if pl not in rec_planos:
            rec_planos.append(pl)
        rec_map.setdefault((op, ob), {})[pl] = tot
    ordem_pl = [p for p in ORDEM_PLANO if p in rec_planos] + [p for p in rec_planos if p not in ORDEM_PLANO]
    rec_colunas = ['Operadora', 'Obs'] + [LABEL_PLANO.get(p, p) for p in ordem_pl]
    rec_linhas = sorted(
        [[op, ob] + [vals.get(p, '') for p in ordem_pl] for (op, ob), vals in rec_map.items()],
        key=lambda x: (x[0] or '', x[1] or '')
    )

    # ── REPASSE pivot por (operadora, obs, plano) ──
    rep_cols_raw, rep_map = [], {}
    for r in reps:
        op, ob, pl = g(r, 'operadora'), g(r, 'obs') or '', g(r, 'plano')
        mod, niv, tot = g(r, 'modelo'), g(r, 'nivel') or '', g(r, 'total')
        col = mod if not niv else f"{mod}|{niv}"
        if col not in rep_cols_raw:
            rep_cols_raw.append(col)
        rep_map.setdefault((op, ob, pl), {})[col] = tot
    ordem_mod = [m for m in ORDEM_MODELO if m in rep_cols_raw] + [m for m in rep_cols_raw if m not in ORDEM_MODELO]
    rep_colunas = ['Operadora', 'Obs', 'Plano'] + [LABEL_MODELO.get(m, m) for m in ordem_mod]
    rep_linhas = sorted(
        [[op, ob, pl] + [vals.get(m, '') for m in ordem_mod] for (op, ob, pl), vals in rep_map.items()],
        key=lambda x: (x[0] or '', x[1] or '', x[2] or '')
    )

    return jsonify({
        'gerado_em': datetime.now(TZ_SP).strftime('%d/%m/%Y %H:%M:%S'),
        'recebimento': {'colunas': rec_colunas, 'linhas': rec_linhas},
        'repasse': {'colunas': rep_colunas, 'linhas': rep_linhas},
    })


# ─── CRM ─────────────────────────────────────────────────────────────────────────
def carregar_etapas_crm(conn=None):
    """Lê as etapas do funil do banco, ordenadas. Cria conexão própria se não receber uma."""
    fechar = False
    if conn is None:
        conn = db(); fechar = True
    try:
        rows = conn.execute(
            "SELECT slug, nome, cor, ordem, tipo FROM crm_etapas WHERE ativo=1 ORDER BY ordem, id"
        ).fetchall()
        etapas = [{'id': r['slug'], 'slug': r['slug'], 'nome': r['nome'],
                   'cor': r['cor'], 'ordem': r['ordem'], 'tipo': r['tipo']} for r in rows]
    except Exception:
        etapas = []
    finally:
        if fechar:
            close_db(conn)
    # Fallback: se a tabela ainda não existir/estiver vazia, usa as etapas padrão
    if not etapas:
        etapas = [
            {'id': 'topo', 'slug': 'topo', 'nome': 'Topo do Funil', 'cor': '#3b82f6', 'ordem': 1, 'tipo': 'normal'},
            {'id': 'meio', 'slug': 'meio', 'nome': 'Meio do Funil', 'cor': '#f59e0b', 'ordem': 2, 'tipo': 'normal'},
            {'id': 'fim', 'slug': 'fim', 'nome': 'Fundo do Funil', 'cor': '#10b981', 'ordem': 3, 'tipo': 'normal'},
            {'id': 'ganho', 'slug': 'ganho', 'nome': 'Ganho', 'cor': '#1fd8a4', 'ordem': 4, 'tipo': 'ganho'},
            {'id': 'perdido', 'slug': 'perdido', 'nome': 'Perdido', 'cor': '#ef4444', 'ordem': 5, 'tipo': 'perdido'},
        ]
    return etapas

@app.route('/crm')
@login_required
def crm():
    conn = db()
    uid = session['user_id']
    eh_admin = session.get('perfil') == 'admin'

    # ── Filtros ──
    f_etapa     = request.args.get('etapa', '').strip()
    f_consultor = request.args.get('consultor', '').strip()  # id do responsável
    f_origem    = request.args.get('origem', '').strip()
    f_data_de   = request.args.get('data_de', '').strip()     # YYYY-MM-DD
    f_data_ate  = request.args.get('data_ate', '').strip()    # YYYY-MM-DD
    f_busca     = request.args.get('q', '').strip()
    f_externo   = request.args.get('externo', '').strip()  # consultor externo (não cadastrado)

    # Lista de consultores para o filtro (admin vê todos os usuários ativos)
    responsaveis = []
    consultores_externos = []
    if eh_admin:
        responsaveis = conn.execute(
            "SELECT id, nome, perfil FROM usuarios WHERE ativo=1 ORDER BY nome"
        ).fetchall()
        # Consultores externos que aparecem na planilha mas não são usuários
        try:
            ext = conn.execute("""
                SELECT DISTINCT consultor_externo FROM crm_leads
                WHERE consultor_externo IS NOT NULL AND consultor_externo != ''
                ORDER BY consultor_externo
            """).fetchall()
            consultores_externos = [r['consultor_externo'] if hasattr(r,'keys') else r[0] for r in ext]
        except Exception:
            pass

    # Monta query
    q = """SELECT l.*, u.nome as responsavel_nome
           FROM crm_leads l
           LEFT JOIN usuarios u ON u.id = l.responsavel_id
           WHERE 1=1 """
    params = []

    # Consultor só vê os próprios; admin pode filtrar por consultor
    if not eh_admin:
        q += " AND l.responsavel_id=?"
        params.append(uid)
    elif f_consultor:
        if f_consultor == 'sem':
            q += " AND l.responsavel_id IS NULL AND (l.consultor_externo IS NULL OR l.consultor_externo='')"
        elif f_consultor == 'externo':
            q += " AND l.consultor_externo IS NOT NULL AND l.consultor_externo != ''"
        else:
            q += " AND l.responsavel_id=?"
            params.append(int(f_consultor))

    # Filtro por consultor externo específico
    if f_externo:
        q += " AND LOWER(l.consultor_externo) LIKE LOWER(?)"
        params.append(f'%{f_externo}%')

    if f_etapa:
        q += " AND l.etapa=?"
        params.append(f_etapa)

    if f_origem:
        q += " AND l.origem LIKE ?"
        params.append(f'%{f_origem}%')

    # Filtro de data sobre criado_em (data do lead)
    if f_data_de:
        q += " AND DATE(l.criado_em) >= ?"
        params.append(f_data_de)
    if f_data_ate:
        q += " AND DATE(l.criado_em) <= ?"
        params.append(f_data_ate)

    if f_busca:
        q += " AND (LOWER(l.nome) LIKE ? OR l.telefone LIKE ? OR LOWER(l.email) LIKE ? OR LOWER(COALESCE(l.consultor_externo,'')) LIKE ?)"
        like = f'%{f_busca.lower()}%'
        params.extend([like, f'%{f_busca}%', like, like])

    q += " ORDER BY l.atualizado_em DESC"
    leads = conn.execute(q, params).fetchall()

    # Etapas dinâmicas do banco
    etapas = carregar_etapas_crm(conn)

    # Agrupa por etapa
    kanban = {e['id']: [] for e in etapas}
    primeira = etapas[0]['id'] if etapas else 'topo'
    for lead in leads:
        etapa = lead['etapa'] or primeira
        if etapa in kanban:
            kanban[etapa].append(lead)
        else:
            kanban[primeira].append(lead)

    total = len(leads)

    # Filtros ativos para repassar ao template
    filtros_ativos = {
        'etapa': f_etapa, 'consultor': f_consultor, 'origem': f_origem,
        'data_de': f_data_de, 'data_ate': f_data_ate, 'q': f_busca,
        'externo': f_externo
    }

    close_db(conn)
    return render_template('crm.html', kanban=kanban, etapas=etapas,
                           total=total, responsaveis=responsaveis, eh_admin=eh_admin,
                           filtros=filtros_ativos, consultores_externos=consultores_externos)


@app.route('/crm/lead/novo', methods=['POST'])
@login_required
def crm_lead_novo():
    d = request.json or request.form
    uid = session['user_id']
    eh_admin = session.get('perfil') == 'admin'
    resp_id = int(d.get('responsavel_id') or uid) if eh_admin else uid
    conn = db()
    conn.execute("""INSERT INTO crm_leads (nome, telefone, email, empresa, origem,
                    etapa, responsavel_id, valor_estimado, observacoes)
                    VALUES (?,?,?,?,?,?,?,?,?)""",
        (d.get('nome'), d.get('telefone'), d.get('email'), d.get('empresa'),
         d.get('origem', 'manual'), d.get('etapa', 'topo'), resp_id,
         float(d.get('valor_estimado') or 0) or None, d.get('observacoes')))
    lead_id = (conn.execute("SELECT lastval() AS id").fetchone()['id'] if DB_MODE=="postgres" else conn.execute("SELECT last_insert_rowid() id").fetchone()['id'])
    conn.execute("INSERT INTO crm_atividades (lead_id, usuario_nome, tipo, descricao) VALUES (?,?,?,?)",
                 (lead_id, session.get('nome'), 'criacao', 'Lead criado'))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True, "id": lead_id})


@app.route('/crm/lead/<int:lid>')
@login_required
def crm_lead_detalhe(lid):
    conn = db()
    lead = conn.execute("""SELECT l.*, u.nome as responsavel_nome
        FROM crm_leads l LEFT JOIN usuarios u ON u.id=l.responsavel_id
        WHERE l.id=?""", (lid,)).fetchone()
    if not lead:
        close_db(conn); return jsonify({"ok": False}), 404
    if session.get('perfil') != 'admin' and lead['responsavel_id'] != session['user_id']:
        close_db(conn); return jsonify({"ok": False, "erro": "Acesso negado"}), 403
    atividades = conn.execute(
        "SELECT * FROM crm_atividades WHERE lead_id=? ORDER BY id DESC", (lid,)).fetchall()
    # Usuários disponíveis para atribuição (admin vê todos)
    usuarios = []
    if session.get('perfil') == 'admin':
        usuarios = [dict(u) for u in conn.execute(
            "SELECT id, nome, perfil FROM usuarios WHERE ativo=1 ORDER BY nome").fetchall()]
    etapas = [dict(e) for e in carregar_etapas_crm(conn)]
    close_db(conn)
    return jsonify({
        "lead": dict(lead),
        "atividades": [dict(a) for a in atividades],
        "usuarios": usuarios,
        "etapas": etapas
    })


@app.route('/crm/lead/<int:lid>/mover', methods=['POST'])
@login_required
def crm_lead_mover(lid):
    nova_etapa = (request.json or {}).get('etapa')
    etapas_validas = [e['id'] for e in carregar_etapas_crm()]
    if nova_etapa not in etapas_validas:
        return jsonify({"ok": False, "erro": "Etapa inválida"}), 400
    conn = db()
    lead = conn.execute("SELECT * FROM crm_leads WHERE id=?", (lid,)).fetchone()
    if not lead:
        close_db(conn); return jsonify({"ok": False}), 404
    if session.get('perfil') != 'admin' and lead['responsavel_id'] != session['user_id']:
        close_db(conn); return jsonify({"ok": False}), 403
    etapa_ant = lead['etapa']
    conn.execute("UPDATE crm_leads SET etapa=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?",
                 (nova_etapa, lid))
    conn.execute("INSERT INTO crm_atividades (lead_id, usuario_nome, tipo, descricao) VALUES (?,?,?,?)",
                 (lid, session.get('nome'), 'movimentacao',
                  f'Movido de "{etapa_ant}" para "{nova_etapa}"'))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})


@app.route('/crm/lead/<int:lid>/atividade', methods=['POST'])
@login_required
def crm_lead_atividade(lid):
    d = request.json or {}
    conn = db()
    conn.execute("INSERT INTO crm_atividades (lead_id, usuario_nome, tipo, descricao) VALUES (?,?,?,?)",
                 (lid, session.get('nome'), d.get('tipo', 'nota'), d.get('descricao', '')))
    conn.execute("UPDATE crm_leads SET atualizado_em=CURRENT_TIMESTAMP WHERE id=?", (lid,))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})


@app.route('/crm/lead/<int:lid>/editar', methods=['POST'])
@login_required
def crm_lead_editar(lid):
    d = request.json or {}
    conn = db()
    lead = conn.execute("SELECT * FROM crm_leads WHERE id=?", (lid,)).fetchone()
    if not lead:
        close_db(conn); return jsonify({"ok": False, "erro": "Lead não encontrado"}), 404
    if session.get('perfil') != 'admin' and lead['responsavel_id'] != session['user_id']:
        close_db(conn); return jsonify({"ok": False, "erro": "Sem permissão"}), 403

    eh_admin = session.get('perfil') == 'admin'

    # Campos que qualquer um pode editar
    nome       = d.get('nome', lead['nome'])
    telefone   = d.get('telefone', lead['telefone'])
    email      = d.get('email', lead['email'])
    empresa    = d.get('empresa', lead['empresa'])
    observacoes= d.get('observacoes', lead['observacoes'])
    valor      = float(d.get('valor_estimado') or 0) or None
    origem     = d.get('origem', lead['origem'])

    # Campos que só admin pode alterar
    responsavel_id = int(d['responsavel_id']) if eh_admin and d.get('responsavel_id') else lead['responsavel_id']
    etapa          = d.get('etapa', lead['etapa']) if eh_admin else lead['etapa']

    # Detectar mudanças para timeline
    changes = []
    if nome != lead['nome']: changes.append(f'Nome: "{lead["nome"]}" → "{nome}"')
    if telefone != lead['telefone']: changes.append(f'Telefone atualizado')
    if email != lead['email']: changes.append(f'Email atualizado')
    if etapa != lead['etapa']: changes.append(f'Etapa: "{lead["etapa"]}" → "{etapa}"')
    if str(responsavel_id) != str(lead['responsavel_id']): changes.append(f'Responsável alterado')

    conn.execute("""UPDATE crm_leads SET nome=?, telefone=?, email=?, empresa=?,
                    valor_estimado=?, observacoes=?, origem=?,
                    responsavel_id=?, etapa=?, atualizado_em=CURRENT_TIMESTAMP
                    WHERE id=?""",
        (nome, telefone, email, empresa, valor, observacoes, origem,
         responsavel_id, etapa, lid))

    if changes:
        conn.execute("INSERT INTO crm_atividades (lead_id, usuario_nome, tipo, descricao) VALUES (?,?,?,?)",
                     (lid, session.get('nome'), 'edicao', '; '.join(changes)))

    conn.commit(); close_db(conn)
    return jsonify({"ok": True})


@app.route('/crm/lead/<int:lid>/anexo', methods=['POST'])
@login_required
def crm_lead_anexo(lid):
    """Upload de anexo (conversa, documento) para um lead."""
    conn = db()
    lead = conn.execute("SELECT * FROM crm_leads WHERE id=?", (lid,)).fetchone()
    if not lead:
        close_db(conn); return jsonify({"ok": False, "erro": "Lead não encontrado"}), 404
    if session.get('perfil') != 'admin' and lead['responsavel_id'] != session['user_id']:
        close_db(conn); return jsonify({"ok": False, "erro": "Sem permissão"}), 403

    arquivo = request.files.get('arquivo')
    if not arquivo or not arquivo.filename:
        close_db(conn); return jsonify({"ok": False, "erro": "Arquivo não enviado"}), 400

    ext = os.path.splitext(arquivo.filename)[1].lower()
    exts_ok = ('.pdf', '.png', '.jpg', '.jpeg', '.webp', '.doc', '.docx', '.txt', '.mp3', '.mp4', '.ogg')
    if ext not in exts_ok:
        close_db(conn); return jsonify({"ok": False, "erro": "Formato não permitido"}), 400

    arquivo.seek(0, os.SEEK_END)
    if arquivo.tell() > 20 * 1024 * 1024:
        close_db(conn); return jsonify({"ok": False, "erro": "Máximo 20MB"}), 400
    arquivo.seek(0)

    import re as _re
    nome_safe = _re.sub(r'[^\w\-.]', '_', arquivo.filename)
    ts = int(datetime.now(TZ_SP).timestamp())
    nome_final = f"lead_{lid}_{ts}_{nome_safe}"
    caminho = os.path.join(UPLOAD_FOLDER, nome_final)
    arquivo.save(caminho)

    # Registra na timeline
    descricao_tipo = request.form.get('tipo_anexo', 'Documento')
    conn.execute("INSERT INTO crm_atividades (lead_id, usuario_nome, tipo, descricao) VALUES (?,?,?,?)",
                 (lid, session.get('nome'), 'anexo',
                  f'{descricao_tipo}: [{nome_safe}](/uploads/{nome_final})'))
    conn.execute("UPDATE crm_leads SET atualizado_em=CURRENT_TIMESTAMP WHERE id=?", (lid,))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True, "arquivo": nome_final})


@app.route('/crm/lead/<int:lid>/excluir', methods=['POST'])
@login_required
def crm_lead_excluir(lid):
    conn = db()
    lead = conn.execute("SELECT * FROM crm_leads WHERE id=?", (lid,)).fetchone()
    if not lead:
        close_db(conn); return jsonify({"ok": False, "erro": "Lead não encontrado"}), 404
    # Admin pode excluir qualquer lead; consultor só os seus próprios
    if session.get('perfil') != 'admin' and lead['responsavel_id'] != session['user_id']:
        close_db(conn); return jsonify({"ok": False, "erro": "Sem permissão"}), 403
    conn.execute("DELETE FROM crm_atividades WHERE lead_id=?", (lid,))
    conn.execute("DELETE FROM crm_leads WHERE id=?", (lid,))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})


@app.route('/crm/stats')
@login_required
def crm_stats():
    conn = db()
    uid = session['user_id']; eh_admin = session.get('perfil') == 'admin'
    q_filter = "" if eh_admin else f" AND responsavel_id={uid}"
    stats = {}
    for e in carregar_etapas_crm(conn):
        row = conn.execute(f"SELECT COUNT(*) c, COALESCE(SUM(valor_estimado),0) v FROM crm_leads WHERE etapa=?{q_filter}", (e['id'],)).fetchone()
        stats[e['id']] = {'qtd': row['c'], 'valor': row['v']}
    close_db(conn)
    return jsonify(stats)


def _normalizar_origem_label(origem):
    """Agrupa as variações de origem em rótulos limpos para métricas."""
    o = (origem or '').strip().lower()
    if not o:
        return 'Manual'
    if 'face' in o or o == 'fb' or 'meta' in o:
        return 'Meta'
    if 'google' in o:
        return 'Google'
    if 'meds' in o:
        return 'MedSênior'
    if 'manual' in o:
        return 'Manual'
    return (origem or 'Outros').strip().split('(')[0].strip().title()


@app.route('/crm/painel')
@login_required
def crm_painel():
    """Painel RevOps do CRM: conversão, funil, origem, performance por consultor, SLA de contato."""
    conn = db()
    eh_admin = session.get('perfil') == 'admin'
    uid = session['user_id']

    f_de = request.args.get('data_de', '').strip()
    f_ate = request.args.get('data_ate', '').strip()

    etapas = conn.execute(
        "SELECT slug, nome, tipo, ordem, cor FROM crm_etapas WHERE ativo=1 ORDER BY ordem, id"
    ).fetchall()
    etapa_tipo = {e['slug']: (e['tipo'] or 'normal') for e in etapas}
    etapa_nome = {e['slug']: e['nome'] for e in etapas}
    etapa_cor = {e['slug']: (e['cor'] or '#3b82f6') for e in etapas}
    etapa_ordem = [e['slug'] for e in etapas]

    q = "SELECT id, etapa, responsavel_id, origem, criado_em, valor_estimado, perdido_motivo FROM crm_leads WHERE 1=1"
    params = []
    if not eh_admin:
        q += " AND responsavel_id=?"; params.append(uid)
    if f_de:
        q += " AND DATE(criado_em) >= ?"; params.append(f_de)
    if f_ate:
        q += " AND DATE(criado_em) <= ?"; params.append(f_ate)
    leads = conn.execute(q, params).fetchall()

    usuarios = {u['id']: u['nome'] for u in conn.execute("SELECT id, nome FROM usuarios").fetchall()}

    # Leads que tiveram algum contato real (não só criação/movimentação automática)
    contato_ids = set()
    try:
        rows = conn.execute(
            "SELECT DISTINCT lead_id FROM crm_atividades WHERE tipo IN ('whatsapp','atividade','nota','email','ligacao')"
        ).fetchall()
        contato_ids = {(r['lead_id'] if hasattr(r, 'keys') else r[0]) for r in rows}
    except Exception:
        pass
    close_db(conn)

    total = len(leads)
    ganhos = perdidos = aberto = sem_contato = 0
    pipeline_valor = 0.0
    por_etapa = {s: 0 for s in etapa_ordem}
    por_origem = {}
    por_consultor = {}
    motivos_perda = {}

    for l in leads:
        et = l['etapa'] or (etapa_ordem[0] if etapa_ordem else '')
        tipo = etapa_tipo.get(et, 'normal')
        por_etapa[et] = por_etapa.get(et, 0) + 1

        if tipo == 'ganho':
            ganhos += 1
        elif tipo == 'perdido':
            perdidos += 1
            mot = (l['perdido_motivo'] or '').strip() or 'Não informado'
            motivos_perda[mot] = motivos_perda.get(mot, 0) + 1
        else:
            aberto += 1
            pipeline_valor += float(l['valor_estimado'] or 0)
            if l['id'] not in contato_ids:
                sem_contato += 1

        org = _normalizar_origem_label(l['origem'])
        do = por_origem.setdefault(org, {'total': 0, 'ganhos': 0})
        do['total'] += 1
        if tipo == 'ganho':
            do['ganhos'] += 1

        nome = usuarios.get(l['responsavel_id'], 'Sem responsável')
        c = por_consultor.setdefault(nome, {'total': 0, 'ganhos': 0, 'perdidos': 0, 'aberto': 0})
        c['total'] += 1
        if tipo == 'ganho':
            c['ganhos'] += 1
        elif tipo == 'perdido':
            c['perdidos'] += 1
        else:
            c['aberto'] += 1

    decididos = ganhos + perdidos
    taxa_conv = round(ganhos / decididos * 100, 1) if decididos else 0.0
    taxa_contato = round((aberto - sem_contato) / aberto * 100, 1) if aberto else 0.0

    # Monta estruturas ordenadas para o template
    funil = [{'nome': etapa_nome.get(s, s), 'cor': etapa_cor.get(s, '#3b82f6'),
              'qtd': por_etapa.get(s, 0),
              'pct': round(por_etapa.get(s, 0) / total * 100, 1) if total else 0}
             for s in etapa_ordem]
    origens = sorted(
        [{'nome': k, 'total': v['total'], 'ganhos': v['ganhos'],
          'conv': round(v['ganhos'] / v['total'] * 100, 1) if v['total'] else 0,
          'pct': round(v['total'] / total * 100, 1) if total else 0}
         for k, v in por_origem.items()],
        key=lambda x: -x['total'])
    consultores = sorted(
        [{'nome': k, **v,
          'conv': round(v['ganhos'] / (v['ganhos'] + v['perdidos']) * 100, 1) if (v['ganhos'] + v['perdidos']) else 0}
         for k, v in por_consultor.items()],
        key=lambda x: -x['total'])
    perdas = sorted([{'motivo': k, 'qtd': v} for k, v in motivos_perda.items()], key=lambda x: -x['qtd'])

    cards = {
        'total': total, 'ganhos': ganhos, 'perdidos': perdidos, 'aberto': aberto,
        'taxa_conv': taxa_conv, 'pipeline_valor': pipeline_valor,
        'sem_contato': sem_contato, 'taxa_contato': taxa_contato,
    }

    return render_template('crm_painel.html', cards=cards, funil=funil, origens=origens,
                           consultores=consultores, perdas=perdas, eh_admin=eh_admin,
                           filtros={'data_de': f_de, 'data_ate': f_ate})


# ─── COTAÇÃO / MULTICÁLCULO ──────────────────────────────────────────────────
# Faixas etárias padrão ANS (10 faixas).
FAIXAS_ETARIAS = ['00-18', '19-23', '24-28', '29-33', '34-38', '39-43', '44-48', '49-53', '54-58', '59+']
COTACAO_MODALIDADES = ['PME', 'PF', 'Adesão']
COTACAO_ACOMODACOES = ['Enfermaria', 'Apartamento']
COTACAO_COPART = ['Sem', 'Parcial', 'Total']


def _faixa_da_idade(idade):
    """Retorna a faixa etária ANS para uma idade inteira."""
    try:
        i = int(idade)
    except Exception:
        return None
    limites = [(18, '00-18'), (23, '19-23'), (28, '24-28'), (33, '29-33'), (38, '34-38'),
               (43, '39-43'), (48, '44-48'), (53, '49-53'), (58, '54-58')]
    for lim, faixa in limites:
        if i <= lim:
            return faixa
    return '59+'


def _parse_idades(texto):
    """Extrai idades de um texto livre. Aceita idade (ex: 25) OU data de nascimento
    (ex: 15/03/1990) — converte a data em idade. Ex: '25, 30 e 15/03/1990'."""
    if not texto:
        return []
    hoje = datetime.now(TZ_SP).date()
    idades = []
    for parte in re.split(r'[,;\n]| e ', str(texto)):
        p = parte.strip()
        if not p:
            continue
        m = re.match(r'^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$', p)
        if m:
            d, mo, a = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if a < 100:
                a += 2000 if a <= 30 else 1900
            try:
                nasc = date(a, mo, d)
                idade = hoje.year - nasc.year - ((hoje.month, hoje.day) < (nasc.month, nasc.day))
                if 0 <= idade <= 120:
                    idades.append(idade)
                continue
            except Exception:
                pass
        nums = re.findall(r'\d+', p)
        if nums:
            idades.append(int(nums[0]))
    return idades[:50]


@app.route('/cotacao')
@login_required
def cotacao():
    """Tela de cotação (multicálculo): idades + filtros -> comparativo de planos."""
    conn = db()
    try:
        operadoras = [r['operadora'] for r in conn.execute(
            "SELECT DISTINCT operadora FROM cotacao_tabela WHERE ativo=1 ORDER BY operadora").fetchall()]
    except Exception:
        operadoras = []
    operadoras_cards = [{'nome': op, 'logo': _logo_operadora_url(conn, op)} for op in operadoras]

    idades_txt = request.args.get('idades', '').strip()
    f_modalidade = request.args.get('modalidade', '').strip()
    f_acomodacao = request.args.get('acomodacao', '').strip()
    f_copart = request.args.get('coparticipacao', '').strip()
    f_ops = [x.strip() for x in request.args.getlist('op') if x.strip()]
    f_mei = request.args.get('mei', '').strip()

    resultados = []
    idades = _parse_idades(idades_txt)
    # Também aceita distribuição por faixa etária (qtd por faixa) — converte em idades representativas
    _REP_IDADE = [5, 20, 25, 30, 35, 40, 45, 50, 55, 60]
    extra_idades = []
    for i, fx in enumerate(FAIXAS_ETARIAS):
        try:
            n = int(request.args.get('fx_%d' % i, '') or 0)
        except Exception:
            n = 0
        if n > 0:
            extra_idades += [_REP_IDADE[i]] * n
    if extra_idades:
        idades = idades + extra_idades
        idades_txt = ', '.join(str(x) for x in idades)
    cont_faixa = {}
    for idade in idades:
        fx = _faixa_da_idade(idade)
        if fx:
            cont_faixa[fx] = cont_faixa.get(fx, 0) + 1

    if idades:
        q = "SELECT * FROM cotacao_tabela WHERE ativo=1"
        params = []
        if f_modalidade:
            q += " AND modalidade=?"; params.append(f_modalidade)
        if f_acomodacao:
            q += " AND acomodacao=?"; params.append(f_acomodacao)
        if f_copart:
            q += " AND coparticipacao=?"; params.append(f_copart)
        if f_ops:
            q += " AND operadora IN (" + ",".join(["?"] * len(f_ops)) + ")"; params.extend(f_ops)
        if f_mei:
            q += " AND (COALESCE(tipo_cnpj,'')='' OR LOWER(tipo_cnpj) IN ('todos','todos os portes','todos os tipos') OR tipo_cnpj=?)"; params.append(f_mei)
        tabelas = conn.execute(q, params).fetchall()

        for t in tabelas:
            td = dict(t)
            precos = conn.execute("SELECT faixa, preco FROM cotacao_preco WHERE tabela_id=?", (td['id'],)).fetchall()
            pmap = {p['faixa']: float(p['preco'] or 0) for p in precos}
            total = 0.0
            faltam = False
            detalhe = []
            for fx, qtd in cont_faixa.items():
                preco = pmap.get(fx, 0)
                if preco <= 0:
                    faltam = True
                total += preco * qtd
                detalhe.append({'faixa': fx, 'qtd': qtd, 'preco_unit': preco, 'subtotal': preco * qtd})
            resultados.append({
                'tabela_id': td['id'],
                'operadora': td['operadora'], 'plano': td['plano'],
                'modalidade': td['modalidade'], 'acomodacao': td['acomodacao'],
                'coparticipacao': td['coparticipacao'], 'abrangencia': td.get('abrangencia'),
                'linha': td.get('linha') or '', 'tipo_cnpj': td.get('tipo_cnpj') or '',
                'vigencia': td.get('vigencia'), 'total': round(total, 2),
                'incompleta': faltam, 'detalhe': sorted(detalhe, key=lambda x: x['faixa']),
            })
        resultados.sort(key=lambda x: (_norm_txt(x['operadora']), x['total']))  # operadora A-Z, depois menor preco
        completas = [r for r in resultados if not r['incompleta']]
        if completas:
            min(completas, key=lambda x: x['total'])['melhor'] = True

    close_db(conn)
    prefill = {
        'lead_id': (request.args.get('lead_id') or '').strip(),
        'nome': (request.args.get('cliente_nome') or '').strip(),
        'telefone': (request.args.get('cliente_telefone') or '').strip(),
        'email': (request.args.get('cliente_email') or '').strip(),
    }
    return render_template('cotacao.html', operadoras=operadoras, operadoras_cards=operadoras_cards,
                           resultados=resultados, idades_txt=idades_txt, total_vidas=len(idades),
                           modalidades=COTACAO_MODALIDADES, acomodacoes=COTACAO_ACOMODACOES,
                           coparts=COTACAO_COPART, faixas=FAIXAS_ETARIAS,
                           tipos_cnpj=['MEI', 'ME', 'LTDA', 'Demais portes', 'Todos os portes'],
                           eh_admin=(session.get('perfil') == 'admin'), prefill=prefill,
                           filtros={'modalidade': f_modalidade, 'acomodacao': f_acomodacao,
                                    'coparticipacao': f_copart, 'ops': f_ops, 'mei': f_mei})


@app.route('/cotacao/tabelas')
@login_required
@admin_required
def cotacao_tabelas():
    """Lista as tabelas de preço cadastradas (admin)."""
    conn = db()
    tabelas = conn.execute("""
        SELECT t.*, (SELECT COUNT(*) FROM cotacao_preco p WHERE p.tabela_id=t.id AND p.preco>0) AS precos_ok
        FROM cotacao_tabela t ORDER BY t.operadora, t.plano
    """).fetchall()
    close_db(conn)
    return render_template('cotacao_tabelas.html', tabelas=tabelas)


@app.route('/cotacao/tabelas/nova', methods=['GET', 'POST'])
@login_required
@admin_required
def cotacao_tabela_nova():
    """Cadastra uma tabela de preço com os valores por faixa etária."""
    if request.method == 'GET':
        return render_template('cotacao_tabela_form.html', faixas=FAIXAS_ETARIAS,
                               modalidades=COTACAO_MODALIDADES, acomodacoes=COTACAO_ACOMODACOES,
                               coparts=COTACAO_COPART)
    d = request.form
    operadora = (d.get('operadora') or '').strip()
    plano = (d.get('plano') or '').strip()
    if not operadora or not plano:
        return redirect('/cotacao/tabelas/nova')

    conn = db()
    conn.execute("""INSERT INTO cotacao_tabela
        (operadora, plano, modalidade, acomodacao, coparticipacao, linha, tipo_cnpj, abrangencia, vigencia, ativo)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)""",
        (operadora, plano, (d.get('modalidade') or 'PME').strip(),
         (d.get('acomodacao') or 'Enfermaria').strip(), (d.get('coparticipacao') or 'Sem').strip(),
         (d.get('linha') or '').strip(), (d.get('tipo_cnpj') or '').strip(),
         (d.get('abrangencia') or '').strip(), (d.get('vigencia') or '').strip()))
    tid = (conn.execute("SELECT lastval() AS id").fetchone()['id'] if DB_MODE == 'postgres'
           else conn.execute("SELECT last_insert_rowid() id").fetchone()['id'])
    for fx in FAIXAS_ETARIAS:
        try:
            preco = float((d.get('preco_' + fx) or '0').replace('.', '').replace(',', '.')) if d.get('preco_' + fx) else 0
        except Exception:
            preco = 0
        conn.execute("INSERT INTO cotacao_preco (tabela_id, faixa, preco) VALUES (?, ?, ?)", (tid, fx, preco))
    conn.commit()
    close_db(conn)
    return redirect('/cotacao/tabelas')


@app.route('/cotacao/tabelas/<int:tid>/editar', methods=['GET', 'POST'])
@login_required
@admin_required
def cotacao_tabela_editar(tid):
    conn = db()
    t = conn.execute("SELECT * FROM cotacao_tabela WHERE id=?", (tid,)).fetchone()
    if not t:
        close_db(conn); abort(404)
    if request.method == 'GET':
        pr = {p['faixa']: p['preco'] for p in conn.execute(
            "SELECT faixa, preco FROM cotacao_preco WHERE tabela_id=?", (tid,)).fetchall()}
        close_db(conn)
        precos = {fx: (f"{float(pr[fx]):.2f}".replace('.', ',') if pr.get(fx) else '') for fx in FAIXAS_ETARIAS}
        return render_template('cotacao_tabela_form.html', faixas=FAIXAS_ETARIAS,
                               modalidades=COTACAO_MODALIDADES, acomodacoes=COTACAO_ACOMODACOES,
                               coparts=COTACAO_COPART, tab=dict(t), precos=precos,
                               form_action='/cotacao/tabelas/%d/editar' % tid)
    d = request.form
    conn.execute("""UPDATE cotacao_tabela SET operadora=?, plano=?, modalidade=?, acomodacao=?,
        coparticipacao=?, linha=?, tipo_cnpj=?, abrangencia=?, vigencia=? WHERE id=?""",
        ((d.get('operadora') or '').strip(), (d.get('plano') or '').strip(),
         (d.get('modalidade') or 'PME').strip(), (d.get('acomodacao') or 'Enfermaria').strip(),
         (d.get('coparticipacao') or 'Sem').strip(), (d.get('linha') or '').strip(),
         (d.get('tipo_cnpj') or '').strip(), (d.get('abrangencia') or '').strip(),
         (d.get('vigencia') or '').strip(), tid))
    for fx in FAIXAS_ETARIAS:
        try:
            preco = float((d.get('preco_' + fx) or '0').replace('.', '').replace(',', '.')) if d.get('preco_' + fx) else 0
        except Exception:
            preco = 0
        ex = conn.execute("SELECT id FROM cotacao_preco WHERE tabela_id=? AND faixa=?", (tid, fx)).fetchone()
        if ex:
            conn.execute("UPDATE cotacao_preco SET preco=? WHERE id=?", (preco, ex['id'] if hasattr(ex, 'keys') else ex[0]))
        else:
            conn.execute("INSERT INTO cotacao_preco (tabela_id, faixa, preco) VALUES (?, ?, ?)", (tid, fx, preco))
    conn.commit(); close_db(conn)
    return redirect('/cotacao/tabelas')


@app.route('/cotacao/tabelas/<int:tid>/excluir', methods=['POST'])
@login_required
@admin_required
def cotacao_tabela_excluir(tid):
    conn = db()
    conn.execute("DELETE FROM cotacao_preco WHERE tabela_id=?", (tid,))
    conn.execute("DELETE FROM cotacao_tabela WHERE id=?", (tid,))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})


def _faixa_label(fx):
    """'24-28' -> '24 a 28'; '59+' -> '59 ou mais'; '00-18' -> '00 a 18'."""
    if fx == '59+':
        return '59 ou mais'
    if '-' in fx:
        a, b = fx.split('-')
        return f'{a} a {b}'
    return fx


# ── Import de tabelas de preço (CSV / Excel) ──
def _norm_txt(s):
    import unicodedata
    s = unicodedata.normalize('NFKD', str(s or '')).encode('ascii', 'ignore').decode('ascii')
    return s.strip().lower()


# Mapeia o 1º número do cabeçalho da faixa -> faixa canônica (limite inferior de cada faixa ANS)
_FAIXA_POR_NUM = {0: '00-18', 19: '19-23', 24: '24-28', 29: '29-33', 34: '34-38',
                  39: '39-43', 44: '44-48', 49: '49-53', 54: '54-58', 59: '59+'}
_COLMAP_META = {
    'operadora': 'operadora', 'plano': 'plano', 'produto': 'plano',
    'modalidade': 'modalidade', 'acomodacao': 'acomodacao',
    'coparticipacao': 'coparticipacao', 'copart': 'coparticipacao',
    'linha': 'linha', 'tipo_cnpj': 'tipo_cnpj', 'tipocnpj': 'tipo_cnpj', 'cnpj': 'tipo_cnpj', 'mei': 'tipo_cnpj',
    'abrangencia': 'abrangencia', 'regiao': 'abrangencia', 'cidade': 'abrangencia',
    'vigencia': 'vigencia', 'competencia': 'vigencia',
}


def _match_faixa_header(h):
    nums = re.findall(r'\d+', str(h))
    if not nums:
        return None
    return _FAIXA_POR_NUM.get(int(nums[0]))


def _parse_preco_br(s):
    s = str(s or '').strip().replace('R$', '').replace(' ', '')
    if not s:
        return 0.0
    if '.' in s and ',' in s:
        s = s.replace('.', '').replace(',', '.')
    elif ',' in s:
        s = s.replace(',', '.')
    try:
        return float(s)
    except Exception:
        return 0.0


@app.route('/cotacao/tabelas/modelo.csv')
@login_required
@admin_required
def cotacao_modelo_csv():
    """Baixa um CSV modelo (delimitador ';') para preencher tabelas de preço."""
    cab = ['operadora', 'plano', 'modalidade', 'acomodacao', 'coparticipacao', 'linha', 'tipo_cnpj', 'abrangencia', 'vigencia'] + FAIXAS_ETARIAS
    exemplo = ['Vera Cruz', 'Vera Prata', 'PME', 'Enfermaria', 'Completa', 'Linha Vera Cruz', 'Não MEI', 'Campinas', '07/2026',
               '153,00', '180,00', '202,00', '218,00', '235,00', '271,00', '365,00', '417,00', '612,00', '870,00']
    conteudo = '﻿' + ';'.join(cab) + '\r\n' + ';'.join(exemplo) + '\r\n'
    return Response(conteudo, mimetype='text/csv',
                    headers={'Content-Disposition': 'attachment; filename=modelo_tabelas_cotacao.csv'})


@app.route('/cotacao/tabelas/importar', methods=['GET', 'POST'])
@login_required
@admin_required
def cotacao_import():
    if request.method == 'GET':
        return render_template('cotacao_import.html', faixas=FAIXAS_ETARIAS)

    f = request.files.get('arquivo')
    if not f or not f.filename:
        return render_template('cotacao_import.html', faixas=FAIXAS_ETARIAS, erro='Selecione um arquivo.')

    nome = f.filename.lower()
    rows = []
    try:
        if nome.endswith('.xlsx'):
            import openpyxl
            wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
            ws = wb.active
            for r in ws.iter_rows(values_only=True):
                rows.append(['' if c is None else str(c) for c in r])
        else:
            import csv, io
            raw = f.read().decode('utf-8-sig', errors='replace')
            primeira = raw.split('\n', 1)[0]
            delim = ';' if primeira.count(';') >= primeira.count(',') else ','
            rows = [list(r) for r in csv.reader(io.StringIO(raw), delimiter=delim)]
    except Exception as e:
        return render_template('cotacao_import.html', faixas=FAIXAS_ETARIAS, erro='Erro ao ler o arquivo: ' + str(e)[:200])

    rows = [r for r in rows if any((str(c) or '').strip() for c in r)]
    if len(rows) < 2:
        return render_template('cotacao_import.html', faixas=FAIXAS_ETARIAS, erro='O arquivo não tem linhas de dados.')

    header = rows[0]
    meta_idx, faixa_idx = {}, {}
    for i, h in enumerate(header):
        nh = _norm_txt(h)
        if nh in _COLMAP_META:
            meta_idx[_COLMAP_META[nh]] = i
        else:
            fx = _match_faixa_header(h)
            if fx and fx not in faixa_idx:
                faixa_idx[fx] = i
    if 'operadora' not in meta_idx or 'plano' not in meta_idx:
        return render_template('cotacao_import.html', faixas=FAIXAS_ETARIAS,
                               erro='Faltam as colunas obrigatórias "operadora" e "plano" no cabeçalho.')

    conn = db()
    importadas, ignoradas = 0, 0
    for r in rows[1:]:
        def cell(key, default=''):
            i = meta_idx.get(key)
            return (str(r[i]).strip() if (i is not None and i < len(r) and r[i] is not None) else default)
        operadora, plano = cell('operadora'), cell('plano')
        if not operadora or not plano:
            ignoradas += 1
            continue
        try:
            conn.execute("""INSERT INTO cotacao_tabela
                (operadora, plano, modalidade, acomodacao, coparticipacao, linha, tipo_cnpj, abrangencia, vigencia, ativo)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)""",
                (operadora, plano, cell('modalidade', 'PME') or 'PME',
                 cell('acomodacao', 'Enfermaria') or 'Enfermaria', cell('coparticipacao', 'Sem') or 'Sem',
                 cell('linha'), cell('tipo_cnpj'), cell('abrangencia'), cell('vigencia')))
            tid = (conn.execute("SELECT lastval() AS id").fetchone()['id'] if DB_MODE == 'postgres'
                   else conn.execute("SELECT last_insert_rowid() id").fetchone()['id'])
            for fx, i in faixa_idx.items():
                preco = _parse_preco_br(r[i]) if i < len(r) else 0
                conn.execute("INSERT INTO cotacao_preco (tabela_id, faixa, preco) VALUES (?, ?, ?)", (tid, fx, preco))
            conn.commit()
            importadas += 1
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            ignoradas += 1
    close_db(conn)
    return render_template('cotacao_import.html', faixas=FAIXAS_ETARIAS,
                           resultado={'importadas': importadas, 'ignoradas': ignoradas,
                                      'faixas_detectadas': sorted(faixa_idx.keys())})


# ── Import de PDF do Painel do Corretor (parser por posição de coluna) ──
def _norm_modalidade(s):
    n = _norm_txt(s)
    if 'pme' in n: return 'PME'
    if 'adesao' in n: return 'Adesão'
    if 'individual' in n or 'pessoa fisica' in n or n.strip() == 'pf' or n.endswith(' pf'): return 'PF'
    return (s or '').strip() or 'PME'

def _norm_acomod(s):
    n = _norm_txt(s)
    if 'apart' in n: return 'Apartamento'
    if 'enferm' in n: return 'Enfermaria'
    return (s or '').strip()

def _norm_copart(s):
    n = _norm_txt(s)
    if 'sem' in n: return 'Sem'
    if 'parcial' in n: return 'Parcial'
    if 'complet' in n or 'total' in n: return 'Completa'
    return (s or '').strip()


def _parse_pdc_pdf(file_obj):
    """Lê uma cotação PDF do Painel do Corretor e devolve a lista de planos (por coluna)."""
    import pdfplumber
    _price_re = re.compile(r'^\d{1,3}(?:\.\d{3})*,\d{2}$')
    planos = []
    with pdfplumber.open(file_obj) as pdf:
        for page in pdf.pages:
            words = page.extract_words()
            if not words:
                continue
            lines = {}
            for w in words:
                lines.setdefault(round(w['top'] / 4) * 4, []).append(w)
            ordered = [sorted(ws, key=lambda x: x['x0']) for _, ws in sorted(lines.items())]

            band_rows = [(ws, [w for w in ws if _price_re.match(w['text'])]) for ws in ordered]
            band_rows = [(ws, p) for ws, p in band_rows if len(p) >= 2]
            if not band_rows:
                continue

            xs = sorted(w['x0'] for _, ps in band_rows for w in ps)
            cols, cur = [], [xs[0]]
            for x in xs[1:]:
                if x - cur[-1] > 30:
                    cols.append(sum(cur) / len(cur)); cur = [x]
                else:
                    cur.append(x)
            cols.append(sum(cur) / len(cur))
            N = len(cols)

            def col_de(x0):
                d = [abs(x0 - c) for c in cols]
                i = d.index(min(d))
                return i if d[i] < 55 else None

            def label_de(ws):
                return ' '.join(w['text'] for w in ws if w['x0'] < 140)

            top_mod = min((w['top'] for ws in ordered for w in ws
                           if _norm_txt(label_de(ws)).startswith('modalidade')), default=10 ** 9)

            meta = {'modalidade': {}, 'acomodacao': {}, 'coparticipacao': {}}
            for ws in ordered:
                nl = _norm_txt(label_de(ws)).strip()
                destino = ('modalidade' if nl.startswith('modalidade')
                           else 'acomodacao' if nl.startswith('acomod')
                           else 'coparticipacao' if nl.startswith('coparticip') else None)
                if not destino:
                    continue
                buckets = {}
                for w in ws:
                    if w['x0'] < 140:
                        continue
                    c = col_de(w['x0'])
                    if c is not None:
                        buckets.setdefault(c, []).append(w['text'])
                for c, vs in buckets.items():
                    meta[destino][c] = ' '.join(vs)

            precos = {i: {} for i in range(N)}
            for ws, ps in band_rows:
                lbl = ' '.join(w['text'] for w in ws
                               if w['x0'] < 140 and not _price_re.match(w['text']) and w['text'].lower() != 'x')
                fx = _match_faixa_header(lbl)
                if not fx:
                    continue
                for w in ps:
                    c = col_de(w['x0'])
                    if c is not None:
                        precos[c][fx] = _parse_preco_br(w['text'])

            head_words = [w for ws in ordered for w in ws if w['top'] < top_mod - 2 and w['x0'] >= 140]
            col_head = {i: {} for i in range(N)}
            for w in head_words:
                c = col_de(w['x0'])
                if c is not None:
                    col_head[c].setdefault(round(w['top'] / 4) * 4, []).append(w)

            for c in range(N):
                linhas_h = [' '.join(x['text'] for x in sorted(ws, key=lambda z: z['x0']))
                            for _, ws in sorted(col_head[c].items())]
                operadora = linhas_h[-1] if linhas_h else ''
                plano = ' '.join(linhas_h[:-1]) if len(linhas_h) > 1 else (linhas_h[0] if linhas_h else '')
                planos.append({
                    'operadora': operadora.strip(), 'plano': plano.strip(),
                    'modalidade': _norm_modalidade(meta['modalidade'].get(c, '')),
                    'acomodacao': _norm_acomod(meta['acomodacao'].get(c, '')),
                    'coparticipacao': _norm_copart(meta['coparticipacao'].get(c, '')),
                    'precos': precos[c],
                })
            break  # usa a primeira página com tabela de planos
    return planos


@app.route('/cotacao/tabelas/importar-pdf', methods=['GET', 'POST'])
@login_required
@admin_required
def cotacao_import_pdf():
    if request.method == 'GET':
        return render_template('cotacao_import_pdf.html', faixas=FAIXAS_ETARIAS)
    f = request.files.get('arquivo')
    if not f or not f.filename:
        return render_template('cotacao_import_pdf.html', faixas=FAIXAS_ETARIAS, erro='Selecione um arquivo PDF.')
    try:
        planos = _parse_pdc_pdf(f)
    except Exception as e:
        return render_template('cotacao_import_pdf.html', faixas=FAIXAS_ETARIAS,
                               erro='Erro ao ler o PDF: ' + str(e)[:200])
    if not planos:
        return render_template('cotacao_import_pdf.html', faixas=FAIXAS_ETARIAS,
                               erro='Não identifiquei a tabela de planos neste PDF. Confirme que é uma cotação do Painel do Corretor.')
    # Pré-preenche os preços de cada plano por faixa (todas as 10 faixas, vazio onde faltar)
    for p in planos:
        p['precos_lista'] = [{'faixa': fx, 'label': _faixa_label(fx),
                              'valor': (f"{p['precos'][fx]:.2f}".replace('.', ',') if fx in p['precos'] else '')}
                             for fx in FAIXAS_ETARIAS]
    return render_template('cotacao_import_pdf.html', faixas=FAIXAS_ETARIAS, planos=planos)


@app.route('/cotacao/tabelas/importar-pdf/salvar', methods=['POST'])
@login_required
@admin_required
def cotacao_import_pdf_salvar():
    d = request.form
    n = int(d.get('num_planos', '0') or 0)
    conn = db()
    salvas = 0
    for j in range(n):
        if not d.get(f'incluir_{j}'):
            continue
        operadora = (d.get(f'operadora_{j}') or '').strip()
        plano = (d.get(f'plano_{j}') or '').strip()
        if not operadora or not plano:
            continue
        conn.execute("""INSERT INTO cotacao_tabela
            (operadora, plano, modalidade, acomodacao, coparticipacao, linha, tipo_cnpj, abrangencia, vigencia, ativo)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)""",
            (operadora, plano, (d.get(f'modalidade_{j}') or 'PME').strip(),
             (d.get(f'acomodacao_{j}') or 'Enfermaria').strip(), (d.get(f'coparticipacao_{j}') or 'Sem').strip(),
             (d.get('linha_global') or '').strip(), (d.get('tipo_cnpj_global') or '').strip(),
             (d.get(f'abrangencia_{j}') or '').strip(), (d.get(f'vigencia_{j}') or '').strip()))
        tid = (conn.execute("SELECT lastval() AS id").fetchone()['id'] if DB_MODE == 'postgres'
               else conn.execute("SELECT last_insert_rowid() id").fetchone()['id'])
        for k, fx in enumerate(FAIXAS_ETARIAS):
            preco = _parse_preco_br(d.get(f'preco_{j}_{k}') or '0')
            conn.execute("INSERT INTO cotacao_preco (tabela_id, faixa, preco) VALUES (?, ?, ?)", (tid, fx, preco))
        conn.commit()
        salvas += 1
    close_db(conn)
    return redirect('/cotacao/tabelas')


# ── Logos das operadoras ──
_LOGOS_BUNDLE = [
    (('amil',), 'amil-saude.svg'),
    (('go care', 'gocare', 'go-care'), 'go-care.svg'),
    (('beneficencia',), 'saude_beneficencia.svg'),
    (('vera cruz', 'veracruz'), 'vera-cruz.png'),
    (('bradesco',), 'bradesco-saude.svg'),
    (('sulamerica', 'sul america'), 'sulamerica-saude.svg'),
    (('hapvida', 'notre', 'gndi', 'notredame'), 'Hapvida_notre.svg'),
    (('medsenior', 'med senior'), 'medsenior.svg'),
    (('porto',), 'porto-saude.svg'),
    (('unica',), 'unica-saude.svg'),
    (('santa tereza',), 'santa-tereza.png'),
]


def _logo_operadora_url(conn, nome):
    """Resolve a URL do logo de uma operadora: 1) upload do usuário; 2) logo embutido."""
    if not nome:
        return None
    n = _norm_txt(nome)
    try:
        rows = conn.execute("SELECT operadora, arquivo FROM operadora_logo ORDER BY id DESC").fetchall()
    except Exception:
        rows = []
    for r in rows:
        on = _norm_txt(r['operadora'] if hasattr(r, 'keys') else r[0])
        arq = r['arquivo'] if hasattr(r, 'keys') else r[1]
        if on and (on == n or on in n or n in on):
            # Uploads antigos (pré-volume 27/06) podem ter sumido do disco:
            # só usa o upload se o arquivo ainda existir, senão cai pro embutido
            if os.path.exists(os.path.join(UPLOAD_FOLDER, os.path.basename(arq))):
                return '/logo-operadora/' + arq
    for keys, arq in _LOGOS_BUNDLE:
        if any(k in n for k in keys):
            return '/static/operadoras/' + arq
    return None


@app.route('/logo-operadora/<path:nome>')
def servir_logo_operadora(nome):
    """Serve o logo de operadora (público, para a cotação aparecer com ou sem login)."""
    nome = os.path.basename(nome)
    if os.path.exists(os.path.join(UPLOAD_FOLDER, nome)):
        return send_from_directory(UPLOAD_FOLDER, nome)
    # Fallback: upload sumiu (pré-volume) mas o nome bate com um logo embutido
    static_dir = os.path.join(BASE_DIR, 'static', 'operadoras')
    if os.path.exists(os.path.join(static_dir, nome)):
        return send_from_directory(static_dir, nome)
    abort(404)


@app.route('/cotacao/operadoras-logos', methods=['GET', 'POST'])
@login_required
@admin_required
def cotacao_operadoras_logos():
    conn = db()
    if request.method == 'POST':
        operadora = (request.form.get('operadora') or '').strip()
        f = request.files.get('logo')
        if operadora and f and f.filename:
            ext = os.path.splitext(f.filename)[1].lower() or '.png'
            nome = _sanitizar_filename(f'logo_op_{_slugify(operadora)}_{secrets.token_hex(3)}{ext}')
            try:
                upload_arquivo_r2(f.stream, f'operadoras/{nome}')
                conn.execute("DELETE FROM operadora_logo WHERE LOWER(operadora)=LOWER(?)", (operadora,))
                conn.execute("INSERT INTO operadora_logo (operadora, arquivo) VALUES (?, ?)", (operadora, nome))
                conn.commit()
            except Exception as e:
                app.logger.error(f"[LOGO_OP] {e}")
        close_db(conn)
        return redirect('/cotacao/operadoras-logos')

    # GET: operadoras das tabelas + logos atuais
    try:
        operadoras = [r['operadora'] for r in conn.execute(
            "SELECT DISTINCT operadora FROM cotacao_tabela ORDER BY operadora").fetchall()]
    except Exception:
        operadoras = []
    itens = [{'operadora': op, 'logo': _logo_operadora_url(conn, op)} for op in operadoras]
    close_db(conn)
    return render_template('cotacao_logos.html', itens=itens)


@app.route('/material-apoio')
@login_required
def material_apoio():
    """Regras comerciais e tabelas de venda por operadora (apoio ao corretor)."""
    conn = db()
    q = (request.args.get('q') or '').strip()
    if q:
        like = f"%{q.lower()}%"
        rows = conn.execute("""SELECT * FROM material_apoio
            WHERE LOWER(COALESCE(operadora,'')) LIKE ? OR LOWER(titulo) LIKE ?
               OR LOWER(COALESCE(tipo,'')) LIKE ? OR LOWER(COALESCE(descricao,'')) LIKE ?
               OR LOWER(COALESCE(conteudo,'')) LIKE ?
            ORDER BY operadora, id DESC""", (like, like, like, like, like)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM material_apoio ORDER BY operadora, id DESC").fetchall()
    grupos = {}
    for r in rows:
        d = dict(r)
        op = d.get('operadora') or 'Geral'
        tp = (d.get('tipo') or '').strip() or 'Geral'
        if op not in grupos:
            grupos[op] = {'operadora': op, 'logo': _logo_operadora_url(conn, op), 'tipos': {}}
        grupos[op]['tipos'].setdefault(tp, []).append(d)
    grupos_l = []
    for g in grupos.values():
        g['caixas'] = [{'tipo': t, 'itens': it} for t, it in g['tipos'].items()]
        grupos_l.append(g)
    try:
        operadoras = [r['operadora'] for r in conn.execute(
            "SELECT DISTINCT operadora FROM cotacao_tabela ORDER BY operadora").fetchall()]
    except Exception:
        operadoras = []
    close_db(conn)
    return render_template('material_apoio.html', grupos=grupos_l, q=q,
                           operadoras=operadoras, eh_admin=(session.get('perfil') == 'admin'))


def _extrair_texto_pdf(file_obj):
    """Lê e limpa o texto de um PDF (regras/fichas de operadora)."""
    import pdfplumber, io as _io
    partes = []
    try:
        with pdfplumber.open(file_obj) as pdf:
            for pg in pdf.pages:
                t = pg.extract_text() or ''
                if t.strip():
                    partes.append(t)
    except Exception:
        return ''
    txt = '\n'.join(partes)
    txt = txt.replace('(cid:127)', '• ').replace('', '• ')
    txt = re.sub(r'\(cid:\d+\)', '', txt)
    txt = re.sub(r'[ \t]{2,}', ' ', txt)
    txt = re.sub(r'\n{3,}', '\n\n', txt)
    return txt.strip()


@app.route('/material-apoio/novo', methods=['POST'])
@login_required
@admin_required
def material_apoio_novo():
    import io as _io
    d = request.form
    titulo = (d.get('titulo') or '').strip()
    if not titulo:
        return redirect('/material-apoio')
    arquivo = None
    conteudo = ''
    f = request.files.get('arquivo')
    if f and f.filename:
        data = f.read()
        ext = os.path.splitext(f.filename)[1].lower()
        arquivo = _sanitizar_filename(f'material_{secrets.token_hex(4)}{ext}')
        try:
            upload_arquivo_r2(_io.BytesIO(data), f'material/{arquivo}')
        except Exception as e:
            app.logger.error(f"[MATERIAL] upload falhou: {e}"); arquivo = None
        if ext == '.pdf':
            try:
                conteudo = _extrair_texto_pdf(_io.BytesIO(data))
            except Exception as e:
                app.logger.error(f"[MATERIAL] extracao de texto falhou: {e}"); conteudo = ''
    conn = db()
    conn.execute("INSERT INTO material_apoio (operadora, tipo, titulo, descricao, conteudo, arquivo) VALUES (?, ?, ?, ?, ?, ?)",
                 ((d.get('operadora') or '').strip(), (d.get('tipo') or '').strip(),
                  titulo, (d.get('descricao') or '').strip(), conteudo, arquivo))
    conn.commit(); close_db(conn)
    return redirect('/material-apoio')


@app.route('/material-apoio/<int:mid>/excluir', methods=['POST'])
@login_required
@admin_required
def material_apoio_excluir(mid):
    conn = db(); conn.execute("DELETE FROM material_apoio WHERE id=?", (mid,)); conn.commit(); close_db(conn)
    return jsonify({"ok": True})


@app.route('/cotacao/salvar', methods=['POST'])
@login_required
def cotacao_salvar():
    """Recalcula os planos selecionados (server-side), salva a cotação e abre o documento."""
    d = request.form
    idades = _parse_idades(d.get('idades', ''))
    tabela_ids = [int(x) for x in request.form.getlist('tabela_id') if str(x).isdigit()]
    if not idades or not tabela_ids:
        return redirect('/cotacao?idades=' + (d.get('idades', '') or ''))

    cont_faixa = {}
    for idade in idades:
        fx = _faixa_da_idade(idade)
        if fx:
            cont_faixa[fx] = cont_faixa.get(fx, 0) + 1

    conn = db()
    planos = []
    total_geral = 0.0
    for tid in tabela_ids:
        t = conn.execute("SELECT * FROM cotacao_tabela WHERE id=?", (tid,)).fetchone()
        if not t:
            continue
        precos = conn.execute("SELECT faixa, preco FROM cotacao_preco WHERE tabela_id=?", (tid,)).fetchall()
        pmap = {p['faixa']: float(p['preco'] or 0) for p in precos}
        linhas = []
        total = 0.0
        for fx in FAIXAS_ETARIAS:
            qtd = cont_faixa.get(fx, 0)
            if qtd <= 0:
                continue
            preco = pmap.get(fx, 0)
            sub = preco * qtd
            total += sub
            linhas.append({'faixa': fx, 'label': _faixa_label(fx), 'qtd': qtd, 'preco': preco, 'subtotal': round(sub, 2)})
        total_geral += total
        rec_map = {'1a': '1ª opção', '2a': '2ª opção', '3a': '3ª opção'}
        rec_raw = (d.get(f'rec_{tid}') or '').strip()
        planos.append({
            'operadora': t['operadora'], 'plano': t['plano'], 'modalidade': t['modalidade'],
            'acomodacao': t['acomodacao'], 'coparticipacao': t['coparticipacao'],
            'abrangencia': t['abrangencia'], 'vigencia': t['vigencia'],
            'linhas': linhas, 'total': round(total, 2),
            'recomendacao': rec_map.get(rec_raw, ''),
        })

    # Dados do corretor (logado) — busca do banco para garantir nome/email
    urow = conn.execute("SELECT nome, email FROM usuarios WHERE id=?", (session.get('user_id'),)).fetchone()
    corretor_nome = (urow['nome'] if urow else None) or session.get('nome') or ''
    corretor_email = (urow['email'] if urow else '') or ''
    token = secrets.token_urlsafe(9)
    orientacao = (d.get('orientacao') or 'horizontal').strip()
    try:
        lead_id = int(d.get('lead_id')) if (d.get('lead_id') or '').strip().isdigit() else None
    except Exception:
        lead_id = None
    # Vínculo automático com o lead do CRM por telefone/e-mail (se não veio escolhido)
    if not lead_id:
        tel_norm = _normalizar_telefone(d.get('cliente_telefone') or '')
        email_cli = (d.get('cliente_email') or '').strip()
        lead_row = None
        if tel_norm:
            lead_row = conn.execute("SELECT id FROM crm_leads WHERE telefone_norm=?", (tel_norm,)).fetchone()
        if not lead_row and email_cli:
            lead_row = conn.execute("SELECT id FROM crm_leads WHERE LOWER(email)=LOWER(?)", (email_cli,)).fetchone()
        if lead_row:
            lead_id = lead_row['id'] if hasattr(lead_row, 'keys') else lead_row[0]
    tabela_ids_json = json.dumps(tabela_ids)
    # Edição (reabrir) sempre gera uma cotação NOVA, com link próprio — nunca sobrescreve
    # a cotação original, que continua acessível com o link já enviado ao cliente.
    # Ambas ficam agrupadas pelo mesmo lead_id na ficha do CRM.
    conn.execute("""INSERT INTO cotacao_salva
        (token, orientacao, lead_id, corretor_id, corretor_nome, corretor_email, corretor_telefone,
         cliente_nome, cliente_email, cliente_telefone, titulo, vidas_json, planos_json, total, tabela_ids_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (token, orientacao, lead_id, session.get('user_id'), corretor_nome, corretor_email,
         (d.get('corretor_telefone') or '').strip(),
         (d.get('cliente_nome') or '').strip(), (d.get('cliente_email') or '').strip(),
         (d.get('cliente_telefone') or '').strip(), (d.get('titulo') or 'Cotação').strip(),
         json.dumps(cont_faixa), json.dumps(planos), round(total_geral, 2), tabela_ids_json))
    cid = (conn.execute("SELECT lastval() AS id").fetchone()['id'] if DB_MODE == 'postgres'
           else conn.execute("SELECT last_insert_rowid() id").fetchone()['id'])
    conn.commit(); close_db(conn)
    return redirect('/cotacao/documento/' + str(cid))


@app.route('/cotacao/documento/<int:cid>')
@login_required
def cotacao_documento(cid):
    """Documento da cotação (layout do cliente), pronto para PDF/imagem."""
    conn = db()
    c = conn.execute("SELECT * FROM cotacao_salva WHERE id=?", (cid,)).fetchone()
    if not c:
        close_db(conn); abort(404)
    # Consultor só vê as próprias
    if session.get('perfil') != 'admin' and c['corretor_id'] != session.get('user_id'):
        close_db(conn); abort(403)
    cot = _build_cot(conn, c)
    # Garante token (link público imutável) para cotações antigas
    if not cot.get('token'):
        novo = secrets.token_urlsafe(9)
        try:
            conn.execute("UPDATE cotacao_salva SET token=? WHERE id=?", (novo, cid)); conn.commit()
            cot['token'] = novo
        except Exception:
            pass
    close_db(conn)
    return render_template('cotacao_documento.html', cot=cot)


@app.route('/cotacao/<int:cid>/reabrir')
@login_required
def cotacao_reabrir(cid):
    """Reabre a cotação no construtor pré-preenchida (mantém o mesmo link ao salvar)."""
    conn = db()
    c = conn.execute("SELECT * FROM cotacao_salva WHERE id=?", (cid,)).fetchone()
    if not c:
        close_db(conn); abort(404)
    if session.get('perfil') != 'admin' and c['corretor_id'] != session.get('user_id'):
        close_db(conn); abort(403)

    # Reconstrói idades a partir de vidas_json (faixa→qtd) usando idades representativas
    _REP = {'00-18': 5, '19-23': 20, '24-28': 25, '29-33': 30, '34-38': 35,
            '39-43': 40, '44-48': 45, '49-53': 50, '54-58': 55, '59+': 60}
    try:
        vidas = json.loads(c['vidas_json'] or '{}')
    except Exception:
        vidas = {}
    idades_list = []
    for fx, qtd in vidas.items():
        rep = _REP.get(fx)
        if rep and qtd:
            idades_list += [str(rep)] * int(qtd)
    idades_txt = ', '.join(idades_list)

    # Tabelas previamente selecionadas
    try:
        tabela_ids = json.loads(c['tabela_ids_json'] or '[]')
    except Exception:
        tabela_ids = []
    # Fallback: tenta casar por operadora+plano+modalidade+acomodacao+copart
    if not tabela_ids:
        try:
            planos = json.loads(c['planos_json'] or '[]')
        except Exception:
            planos = []
        for p in planos:
            row = conn.execute(
                "SELECT id FROM cotacao_tabela WHERE operadora=? AND plano=? AND modalidade=? AND acomodacao=? AND coparticipacao=?",
                (p.get('operadora'), p.get('plano'), p.get('modalidade'), p.get('acomodacao'), p.get('coparticipacao'))
            ).fetchone()
            if row:
                tabela_ids.append(row['id'])

    # Operadoras para os cards
    operadoras = [r['operadora'] for r in conn.execute(
        "SELECT DISTINCT operadora FROM cotacao_tabela WHERE ativo=1 ORDER BY operadora").fetchall()]
    operadoras_cards = [{'nome': op, 'logo': _logo_operadora_url(conn, op)} for op in operadoras]

    # Monta resultados com os planos já selecionados (baseado nas tabelas pré-selecionadas)
    cont_faixa = {}
    for s in idades_list:
        fx = _faixa_da_idade(int(s))
        if fx:
            cont_faixa[fx] = cont_faixa.get(fx, 0) + 1

    resultados = []
    if cont_faixa:
        tabelas = conn.execute("SELECT * FROM cotacao_tabela WHERE ativo=1").fetchall()
        for t in tabelas:
            td = dict(t)
            precos = conn.execute("SELECT faixa, preco FROM cotacao_preco WHERE tabela_id=?", (td['id'],)).fetchall()
            pmap = {p['faixa']: float(p['preco'] or 0) for p in precos}
            total = 0.0; faltam = False; detalhe = []
            for fx, qtd in cont_faixa.items():
                preco = pmap.get(fx, 0)
                if preco <= 0: faltam = True
                total += preco * qtd
                detalhe.append({'faixa': fx, 'qtd': qtd, 'preco_unit': preco, 'subtotal': preco * qtd})
            resultados.append({
                'tabela_id': td['id'], 'operadora': td['operadora'], 'plano': td['plano'],
                'modalidade': td['modalidade'], 'acomodacao': td['acomodacao'],
                'coparticipacao': td['coparticipacao'], 'abrangencia': td.get('abrangencia'),
                'linha': td.get('linha') or '', 'tipo_cnpj': td.get('tipo_cnpj') or '',
                'vigencia': td.get('vigencia'), 'total': round(total, 2),
                'incompleta': faltam, 'detalhe': sorted(detalhe, key=lambda x: x['faixa']),
            })
        resultados.sort(key=lambda x: (_norm_txt(x['operadora']), x['total']))  # operadora A-Z, depois menor preco
        completas = [r for r in resultados if not r['incompleta']]
        if completas:
            min(completas, key=lambda x: x['total'])['melhor'] = True

    close_db(conn)
    cd = dict(c)
    prefill = {
        'lead_id': str(cd.get('lead_id') or ''),
        'nome': cd.get('cliente_nome') or '',
        'telefone': cd.get('cliente_telefone') or '',
        'email': cd.get('cliente_email') or '',
    }
    return render_template('cotacao.html',
        operadoras=operadoras, operadoras_cards=operadoras_cards,
        resultados=resultados, idades_txt=idades_txt, total_vidas=len(idades_list),
        modalidades=COTACAO_MODALIDADES, acomodacoes=COTACAO_ACOMODACOES,
        coparts=COTACAO_COPART, faixas=FAIXAS_ETARIAS,
        tipos_cnpj=['MEI', 'ME', 'LTDA', 'Demais portes', 'Todos os portes'],
        eh_admin=(session.get('perfil') == 'admin'), prefill=prefill,
        filtros={'modalidade': '', 'acomodacao': '', 'coparticipacao': '', 'ops': [], 'mei': ''},
        editar_id=cid, presel_tabelas=tabela_ids,
        editar_titulo=cd.get('titulo') or '', editar_orientacao=cd.get('orientacao') or 'horizontal',
        editar_corretor_telefone=cd.get('corretor_telefone') or '')


def _build_cot(conn, c):
    """Monta o dicionário da cotação para o documento (planos, faixas, logos)."""
    cot = dict(c)
    try:
        planos = json.loads(cot.get('planos_json') or '[]')
    except Exception:
        planos = []
    cot['planos'] = planos
    faixas_usadas = []
    if planos:
        faixas_usadas = [{'faixa': l['faixa'], 'label': l.get('label') or _faixa_label(l['faixa']),
                          'qtd': l['qtd']} for l in planos[0]['linhas']]
    for p in planos:
        p['precos'] = {l['faixa']: l['subtotal'] for l in p['linhas']}
        p['logo'] = _logo_operadora_url(conn, p.get('operadora'))
    cot['faixas_usadas'] = faixas_usadas
    cot['orientacao'] = cot.get('orientacao') or 'horizontal'
    # Cores automáticas por plano (para destaque opcional) + legenda pronta p/ copiar
    PALETA = [('VERDE', '#1fb88a'), ('LARANJA', '#fb923c'), ('AZUL', '#3b82f6'),
              ('ROXO', '#8b5cf6'), ('ROSA', '#f43f7c'), ('CIANO', '#06b6d4')]
    for i, p in enumerate(planos):
        nome_cor, cor = PALETA[i % len(PALETA)]
        p['cor'] = cor
        p['cor_nome'] = nome_cor
    try:
        vidas = json.loads(cot.get('vidas_json') or '{}')
        total_vidas = sum(int(v) for v in vidas.values())
    except Exception:
        total_vidas = 0
    leg = ['*' + (cot.get('titulo') or 'Cotação') + '*']
    if total_vidas:
        leg.append(str(total_vidas) + ' vida(s)')
    for p in planos:
        leg.append('Em ' + p['cor_nome'] + ': ' + (p.get('operadora') or '') + ' ' + (p.get('plano') or '')
                   + ' - copart. ' + (p.get('coparticipacao') or '') + ' - R$ ' + _moeda_doc(p.get('total')) + '/mês')
    cot['legenda'] = '\n'.join(leg)
    return cot


@app.route('/c/<token>')
def cotacao_publica(token):
    """Página pública e imutável da cotação (para enviar link ao cliente)."""
    conn = db()
    c = conn.execute("SELECT * FROM cotacao_salva WHERE token=?", (token,)).fetchone()
    if not c:
        close_db(conn); abort(404)
    cd = dict(c)
    # Rastreia abertura: conta + registra no pipeline do lead no CRM
    # Guarda: notifica o corretor no máximo 1x a cada 5 min por cotação (evita spam de refresh)
    notificar_abertura = False
    try:
        ult = cd.get('ultima_abertura')
        ult_dt = _parse_dt_seguro(ult) if ult else None
        if not ult_dt:
            notificar_abertura = True
        else:
            if ult_dt.tzinfo is None:
                ult_dt = TZ_SP.localize(ult_dt)
            if (datetime.now(TZ_SP) - ult_dt).total_seconds() > 300:
                notificar_abertura = True
    except Exception:
        notificar_abertura = True
    try:
        conn.execute("UPDATE cotacao_salva SET aberturas=COALESCE(aberturas,0)+1, ultima_abertura=? WHERE id=?",
                     (datetime.now(TZ_SP).strftime('%Y-%m-%d %H:%M:%S'), cd['id']))
        if cd.get('lead_id'):
            conn.execute("INSERT INTO crm_atividades (lead_id, usuario_nome, tipo, descricao) VALUES (?, ?, ?, ?)",
                         (cd['lead_id'], 'Sistema', 'abertura',
                          'Cliente ABRIU a cotação "' + (cd.get('titulo') or 'Cotação') + '" pelo link'))
        conn.commit()
    except Exception:
        pass
    cot = _build_cot(conn, c)
    close_db(conn)
    if notificar_abertura:
        try:
            cliente = cd.get('cliente_nome') or 'O cliente'
            _notificar(cd.get('corretor_id'), 'cotacao', 'Cotação visualizada',
                       f"{cliente} abriu a cotação \"{cd.get('titulo') or 'Cotação'}\"",
                       '/cotacao/documento/' + str(cd['id']))
        except Exception:
            pass
    return render_template('cotacao_documento.html', cot=cot, publico=True)


@app.route('/cotacao/<int:cid>/enviar-email', methods=['POST'])
@login_required
def cotacao_enviar_email(cid):
    conn = db()
    c = conn.execute("SELECT * FROM cotacao_salva WHERE id=?", (cid,)).fetchone()
    if not c:
        close_db(conn); return jsonify({"ok": False, "erro": "Cotação não encontrada"}), 404
    if session.get('perfil') != 'admin' and c['corretor_id'] != session.get('user_id'):
        close_db(conn); return jsonify({"ok": False, "erro": "Sem permissão"}), 403
    cot = dict(c)
    destino = ((request.json or {}).get('email') or cot.get('cliente_email') or '').strip()
    if not destino:
        close_db(conn); return jsonify({"ok": False, "erro": "Informe o e-mail do cliente"}), 400
    token = cot.get('token')
    if not token:
        token = secrets.token_urlsafe(9)
        conn.execute("UPDATE cotacao_salva SET token=? WHERE id=?", (token, cid)); conn.commit()
    close_db(conn)
    base = request.host_url.rstrip('/')
    link = base + '/c/' + token
    logo = base + '/static/logo_arcos.png'
    nome = cot.get('cliente_nome') or ''
    corretor = cot.get('corretor_nome') or 'Serenus Corretora'
    tel_corretor = cot.get('corretor_telefone') or ''
    corpo = (
        "<div style='font-family:Arial,Helvetica,sans-serif;background:#f4f5f7;padding:26px 12px;'>"
        "<div style='max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e7e9ee;'>"
        "<div style='padding:24px 30px;border-bottom:1px solid #eef0f3;'>"
        "<table role='presentation' cellpadding='0' cellspacing='0'><tr>"
        "<td style='padding-right:12px;'><img src='" + logo + "' alt='Serenus' width='42' height='42' style='display:block;'></td>"
        "<td><div style='font-size:21px;font-weight:800;color:#1c1c24;line-height:1;'>Serenus</div>"
        "<div style='font-size:9px;letter-spacing:3px;color:#9aa0b0;text-transform:uppercase;margin-top:3px;'>Corretora</div></td>"
        "</tr></table></div>"
        "<div style='padding:30px;'>"
        "<p style='font-size:15px;color:#2b2b33;margin:0 0 14px;'>Olá " + nome + ",</p>"
        "<p style='font-size:15px;color:#2b2b33;line-height:1.65;margin:0 0 24px;'>Preparei uma cotação de plano de saúde personalizada para você. "
        "Clique no botão abaixo para visualizar os planos, coberturas e valores:</p>"
        "<div style='text-align:center;margin:28px 0;'>"
        "<a href='" + link + "' style='background:#3b82f6;color:#ffffff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;display:inline-block;'>Ver minha cotação</a></div>"
        "<p style='font-size:13px;color:#8a8a96;margin:0 0 4px;'>Se o botão não funcionar, copie e cole este link no navegador:</p>"
        "<p style='font-size:13px;margin:0 0 24px;'><a href='" + link + "' style='color:#3b82f6;word-break:break-all;'>" + link + "</a></p>"
        "<p style='font-size:14px;color:#2b2b33;margin:0;line-height:1.6;'>Qualquer dúvida, estou à disposição.<br>"
        "Atenciosamente,<br><b>" + corretor + "</b>" + (("<br>" + tel_corretor) if tel_corretor else "") + "<br>Serenus Corretora</p>"
        "</div>"
        "<div style='padding:16px 30px;background:#fafbfc;border-top:1px solid #eef0f3;font-size:11px;color:#9aa0b0;line-height:1.5;'>"
        "Informativo referencial: valores e demais condições são determinados pelas operadoras e podem ser alterados a qualquer momento. "
        "Esta mensagem tem caráter informativo e não constitui contrato.</div>"
        "</div></div>")
    try:
        _enviar_email.ultimo_erro = None
    except Exception:
        pass
    try:
        _enviar_email(destino, "Sua cotação - " + (cot.get('titulo') or 'Serenus'), corpo)
    except Exception as e:
        return jsonify({"ok": False, "erro": str(e)[:200]}), 200
    err = getattr(_enviar_email, 'ultimo_erro', None)
    if err:
        return jsonify({"ok": False, "erro": str(err)[:200]}), 200
    return jsonify({"ok": True, "email": destino})


@app.route('/cotacao/<int:cid>/ajustar', methods=['POST'])
@login_required
def cotacao_ajustar(cid):
    """Agravo: ajusta os valores por faixa SÓ desta cotação (não mexe na tabela base)."""
    conn = db()
    c = conn.execute("SELECT * FROM cotacao_salva WHERE id=?", (cid,)).fetchone()
    if not c:
        close_db(conn); return jsonify({"ok": False, "erro": "Não encontrada"}), 404
    if session.get('perfil') != 'admin' and c['corretor_id'] != session.get('user_id'):
        close_db(conn); return jsonify({"ok": False, "erro": "Sem permissão"}), 403
    cd = dict(c)
    try:
        planos = json.loads(cd.get('planos_json') or '[]')
    except Exception:
        planos = []
    ajustes = (request.json or {}).get('ajustes') or {}
    total_geral = 0.0
    for i, p in enumerate(planos):
        aj = ajustes.get(str(i)) or {}
        tot = 0.0
        for ln in p.get('linhas', []):
            fx = ln.get('faixa')
            if fx in aj:
                try:
                    ln['subtotal'] = round(float(aj[fx]), 2)
                except Exception:
                    pass
            tot += float(ln.get('subtotal') or 0)
        p['total'] = round(tot, 2)
        total_geral += tot
    conn.execute("UPDATE cotacao_salva SET planos_json=?, total=? WHERE id=?",
                 (json.dumps(planos), round(total_geral, 2), cid))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})


# ── Legendas: gerenciamento de modelos ──────────────────────────────────────

@app.route('/cotacao/legendas')
@login_required
@admin_required
def cotacao_legendas():
    conn = db()
    modelos = conn.execute("SELECT * FROM cotacao_legenda_modelo ORDER BY id DESC").fetchall()
    close_db(conn)
    return render_template('cotacao_legendas.html', modelos=modelos)


@app.route('/cotacao/legendas/salvar', methods=['POST'])
@login_required
@admin_required
def cotacao_legendas_salvar():
    d = request.form
    mid = (d.get('id') or '').strip()
    nome = (d.get('nome') or '').strip()
    corpo = (d.get('corpo') or '').strip()
    if not nome or not corpo:
        return redirect('/cotacao/legendas')
    conn = db()
    if mid.isdigit():
        conn.execute("UPDATE cotacao_legenda_modelo SET nome=?, corpo=? WHERE id=?", (nome, corpo, int(mid)))
    else:
        conn.execute("INSERT INTO cotacao_legenda_modelo (nome, corpo) VALUES (?, ?)", (nome, corpo))
    conn.commit(); close_db(conn)
    return redirect('/cotacao/legendas')


@app.route('/cotacao/legendas/<int:mid>/excluir', methods=['POST'])
@login_required
@admin_required
def cotacao_legendas_excluir(mid):
    conn = db()
    conn.execute("DELETE FROM cotacao_legenda_modelo WHERE id=?", (mid,))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})


@app.route('/cotacao/legendas/api')
@login_required
def cotacao_legendas_api():
    """Retorna lista de modelos de legenda em JSON para uso no documento."""
    conn = db()
    modelos = [dict(r) for r in conn.execute("SELECT id, nome, corpo FROM cotacao_legenda_modelo ORDER BY id").fetchall()]
    close_db(conn)
    return jsonify(modelos)


# ── NOTIFICAÇÕES (sininho) ──────────────────────────────────────────────────

def _notificar(usuario_id, tipo, titulo, descricao='', link=''):
    """Cria uma notificação. usuario_id=None → broadcast para todos os admins.
    Nunca propaga erro (não pode derrubar o fluxo que a chamou)."""
    try:
        conn = db()
        conn.execute(
            "INSERT INTO notificacoes (usuario_id, tipo, titulo, descricao, link) VALUES (?, ?, ?, ?, ?)",
            (usuario_id, tipo, titulo, descricao, link))
        conn.commit()
        close_db(conn)
    except Exception as e:
        try: app.logger.warning(f"[NOTIF] falha ao criar: {e}")
        except Exception: pass


def _notificar_admins(tipo, titulo, descricao='', link=''):
    """Notifica todos os admins (broadcast: usuario_id NULL)."""
    _notificar(None, tipo, titulo, descricao, link)


@app.route('/api/notificacoes')
@login_required
def api_notificacoes():
    """Lista as notificações do usuário logado (próprias + broadcast p/ admin)."""
    uid = session.get('user_id')
    eh_admin = session.get('perfil') == 'admin'
    conn = db()
    if eh_admin:
        rows = conn.execute(
            "SELECT * FROM notificacoes WHERE usuario_id=? OR usuario_id IS NULL ORDER BY id DESC LIMIT 30",
            (uid,)).fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM notificacoes WHERE usuario_id=? ORDER BY id DESC LIMIT 30",
            (uid,)).fetchall()
    close_db(conn)
    itens = []
    nao_lidas = 0
    for r in rows:
        d = dict(r)
        if not d.get('lida'):
            nao_lidas += 1
        itens.append({
            'id': d['id'], 'tipo': d.get('tipo') or '', 'titulo': d.get('titulo') or '',
            'descricao': d.get('descricao') or '', 'link': d.get('link') or '',
            'lida': bool(d.get('lida')), 'quando': _tempo_relativo(d.get('criado_em')),
        })
    return jsonify({'nao_lidas': nao_lidas, 'itens': itens})


@app.route('/api/notificacoes/marcar-lidas', methods=['POST'])
@login_required
def api_notificacoes_marcar_lidas():
    """Marca como lidas as notificações do usuário (todas ou uma específica)."""
    uid = session.get('user_id')
    eh_admin = session.get('perfil') == 'admin'
    nid = (request.json or {}).get('id') if request.is_json else None
    conn = db()
    if nid:
        conn.execute("UPDATE notificacoes SET lida=1 WHERE id=? AND (usuario_id=? OR usuario_id IS NULL)",
                     (nid, uid))
    elif eh_admin:
        conn.execute("UPDATE notificacoes SET lida=1 WHERE usuario_id=? OR usuario_id IS NULL", (uid,))
    else:
        conn.execute("UPDATE notificacoes SET lida=1 WHERE usuario_id=?", (uid,))
    conn.commit()
    close_db(conn)
    return jsonify({'ok': True})


def _tempo_relativo(quando):
    """'há 5 min', 'há 2 h', 'há 3 d' a partir de um timestamp (str ou datetime)."""
    try:
        dt = _parse_dt_seguro(quando) if quando else None
        if not dt:
            return ''
        if dt.tzinfo is None:
            dt = TZ_SP.localize(dt)
        delta = datetime.now(TZ_SP) - dt
        seg = int(delta.total_seconds())
        if seg < 60: return 'agora'
        if seg < 3600: return f'há {seg // 60} min'
        if seg < 86400: return f'há {seg // 3600} h'
        return f'há {seg // 86400} d'
    except Exception:
        return ''


@app.route('/crm/importar-agora', methods=['POST'])
@login_required
@admin_required
def crm_importar_agora():
    """Dispara a importação de leads das planilhas imediatamente (botão no CRM).
    Substitui a necessidade de abrir o Apps Script do Google manualmente."""
    importados, duplicados = _importar_leads_automatico()
    return jsonify({'ok': True, 'importados': importados, 'duplicados': duplicados})


@app.route('/cotacao/salvas')
@login_required
def cotacao_salvas():
    """Lista de cotações salvas (histórico), por cliente e corretor, com busca."""
    conn = db()
    eh_admin = session.get('perfil') == 'admin'
    q = (request.args.get('q') or '').strip()
    base = "SELECT * FROM cotacao_salva WHERE 1=1"
    params = []
    if not eh_admin:
        base += " AND corretor_id=?"; params.append(session.get('user_id'))
    if q:
        base += " AND (LOWER(cliente_nome) LIKE ? OR LOWER(titulo) LIKE ? OR cliente_telefone LIKE ?)"
        like = f"%{q.lower()}%"
        params.extend([like, like, f"%{q}%"])
    base += " ORDER BY id DESC"
    rows = conn.execute(base, params).fetchall()
    total = conn.execute(
        "SELECT COUNT(*) c FROM cotacao_salva" + ("" if eh_admin else " WHERE corretor_id=?"),
        ([] if eh_admin else [session.get('user_id')])).fetchone()['c']
    close_db(conn)
    return render_template('cotacao_salvas.html', cotacoes=rows, eh_admin=eh_admin, q=q, total=total)


@app.route('/cotacao/salvas/<int:cid>/excluir', methods=['POST'])
@login_required
def cotacao_salva_excluir(cid):
    conn = db()
    c = conn.execute("SELECT corretor_id FROM cotacao_salva WHERE id=?", (cid,)).fetchone()
    if not c:
        close_db(conn); return jsonify({"ok": False}), 404
    if session.get('perfil') != 'admin' and c['corretor_id'] != session.get('user_id'):
        close_db(conn); return jsonify({"ok": False}), 403
    conn.execute("DELETE FROM cotacao_salva WHERE id=?", (cid,))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})


@app.route('/crm/lead/<int:lid>/cotacoes')
@login_required
def crm_lead_cotacoes(lid):
    """Cotações vinculadas a um lead (por lead_id OU por telefone/e-mail do cliente)."""
    conn = db()
    lead = conn.execute("SELECT id, nome, telefone, telefone_norm, email FROM crm_leads WHERE id=?", (lid,)).fetchone()
    if not lead:
        close_db(conn); return jsonify({"ok": False, "cotacoes": []}), 404
    tel = (lead['telefone_norm'] if hasattr(lead, 'keys') else None) or _normalizar_telefone(lead['telefone'] or '')
    email = (lead['email'] or '').strip().lower()
    rows = conn.execute("""SELECT id, token, titulo, total, criado_em, cliente_telefone, cliente_email, lead_id
                           FROM cotacao_salva ORDER BY id DESC""").fetchall()
    close_db(conn)
    out = []
    for r in rows:
        d = dict(r)
        casa = (d.get('lead_id') == lid)
        if not casa and tel and len(tel) >= 8:
            casa = tel[-8:] in re.sub(r'\D', '', d.get('cliente_telefone') or '')
        if not casa and email:
            casa = (d.get('cliente_email') or '').strip().lower() == email
        if casa:
            out.append({'id': d['id'], 'token': d.get('token'), 'titulo': d.get('titulo'),
                        'total': float(d.get('total') or 0), 'data': str(d.get('criado_em'))[:10]})
    return jsonify({"ok": True, "cotacoes": out})


# ─── GESTÃO DE ETAPAS DO FUNIL (admin) ───────────────────────────────────────
import unicodedata as _unicodedata

def _slugify(texto):
    """Gera um slug seguro a partir do nome da etapa."""
    txt = _unicodedata.normalize('NFKD', texto or '').encode('ascii', 'ignore').decode('ascii')
    txt = re.sub(r'[^a-zA-Z0-9]+', '_', txt).strip('_').lower()
    return txt[:40] or ('etapa_' + secrets.token_hex(3))


@app.route('/crm/etapas')
@login_required
def crm_etapas_listar():
    """Retorna as etapas do funil (para o gerenciador)."""
    return jsonify({"etapas": carregar_etapas_crm()})


@app.route('/crm/etapas/nova', methods=['POST'])
@login_required
@admin_required
def crm_etapa_nova():
    d = request.json or {}
    nome = (d.get('nome') or '').strip()
    if not nome:
        return jsonify({"ok": False, "erro": "Nome obrigatório"}), 400
    cor = (d.get('cor') or '#3b82f6').strip()
    conn = db()
    # slug único
    base = _slugify(nome)
    slug = base
    tent = 1
    while conn.execute("SELECT 1 FROM crm_etapas WHERE slug=?", (slug,)).fetchone():
        tent += 1
        slug = f"{base}_{tent}"
    # ordem: vai pro fim (antes de ganho/perdido se existirem)
    maxord = conn.execute("SELECT COALESCE(MAX(ordem),0) m FROM crm_etapas").fetchone()['m']
    conn.execute("INSERT INTO crm_etapas (slug,nome,cor,ordem,tipo) VALUES (?,?,?,?,?)",
                 (slug, nome, cor, maxord + 1, 'normal'))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True, "slug": slug})


@app.route('/crm/etapas/<slug>/editar', methods=['POST'])
@login_required
@admin_required
def crm_etapa_editar(slug):
    d = request.json or {}
    nome = (d.get('nome') or '').strip()
    cor = (d.get('cor') or '').strip()
    conn = db()
    et = conn.execute("SELECT * FROM crm_etapas WHERE slug=?", (slug,)).fetchone()
    if not et:
        close_db(conn); return jsonify({"ok": False, "erro": "Etapa não encontrada"}), 404
    novo_nome = nome or et['nome']
    nova_cor = cor or et['cor']
    conn.execute("UPDATE crm_etapas SET nome=?, cor=? WHERE slug=?", (novo_nome, nova_cor, slug))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})


@app.route('/crm/etapas/<slug>/excluir', methods=['POST'])
@login_required
@admin_required
def crm_etapa_excluir(slug):
    conn = db()
    et = conn.execute("SELECT * FROM crm_etapas WHERE slug=?", (slug,)).fetchone()
    if not et:
        close_db(conn); return jsonify({"ok": False, "erro": "Etapa não encontrada"}), 404
    # Não deixa excluir se for a última etapa normal
    total = conn.execute("SELECT COUNT(*) c FROM crm_etapas WHERE ativo=1").fetchone()['c']
    if total <= 1:
        close_db(conn); return jsonify({"ok": False, "erro": "Não é possível excluir a última etapa"}), 400
    # Move leads dessa etapa para a primeira etapa restante
    restante = conn.execute(
        "SELECT slug FROM crm_etapas WHERE ativo=1 AND slug<>? ORDER BY ordem, id LIMIT 1", (slug,)
    ).fetchone()
    destino = restante['slug'] if restante else 'topo'
    conn.execute("UPDATE crm_leads SET etapa=? WHERE etapa=?", (destino, slug))
    conn.execute("DELETE FROM crm_etapas WHERE slug=?", (slug,))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True, "leads_movidos_para": destino})


@app.route('/crm/etapas/reordenar', methods=['POST'])
@login_required
@admin_required
def crm_etapas_reordenar():
    """Recebe lista de slugs na nova ordem."""
    ordem = (request.json or {}).get('ordem', [])
    if not isinstance(ordem, list) or not ordem:
        return jsonify({"ok": False, "erro": "Ordem inválida"}), 400
    conn = db()
    for i, slug in enumerate(ordem, start=1):
        conn.execute("UPDATE crm_etapas SET ordem=? WHERE slug=?", (i, slug))
    conn.commit(); close_db(conn)
    return jsonify({"ok": True})


# ─── WEBHOOK META / GOOGLE LEADS ─────────────────────────────────────────────────
@app.route('/webhook/meta', methods=['GET', 'POST'])
def webhook_meta():
    """Recebe leads do Meta (Facebook/Instagram) Lead Ads."""
    if request.method == 'GET':
        # Verificação do webhook
        verify_token = request.args.get('hub.verify_token', '')
        challenge = request.args.get('hub.challenge', '')
        cfg_token = get_cfg('meta_verify_token', 'serenus_meta_2025')
        if verify_token == cfg_token:
            return challenge, 200
        return 'Unauthorized', 403

    try:
        data = request.get_json(force=True) or {}
        conn = db()
        for entry in data.get('entry', []):
            for change in entry.get('changes', []):
                if change.get('field') == 'leadgen':
                    valor = change.get('value', {})
                    field_data = {f['name']: f.get('values', [''])[0]
                                  for f in valor.get('field_data', [])}
                    nome = field_data.get('full_name') or field_data.get('name', 'Lead Meta')
                    telefone = field_data.get('phone_number') or field_data.get('phone', '')
                    email = field_data.get('email', '')
                    empresa = field_data.get('company_name', '')
                    conn.execute("""INSERT INTO crm_leads
                        (nome, telefone, email, empresa, origem, etapa, dados_extras)
                        VALUES (?,?,?,?,?,?,?)""",
                        (nome, telefone, email, empresa, 'meta', 'lead_novo',
                         json.dumps(valor, ensure_ascii=False)))
                    lead_id = (conn.execute("SELECT lastval() AS id").fetchone()['id'] if DB_MODE=="postgres" else conn.execute("SELECT last_insert_rowid() id").fetchone()['id'])
                    conn.execute("INSERT INTO crm_atividades (lead_id, usuario_nome, tipo, descricao) VALUES (?,?,?,?)",
                                 (lead_id, 'Meta Ads', 'criacao', f'Lead capturado via Meta Ads'))
        conn.commit(); close_db(conn)
        return jsonify({"ok": True}), 200
    except Exception as e:
        return jsonify({"ok": False, "erro": str(e)}), 200  # Sempre 200 pro Meta


@app.route('/webhook/google', methods=['POST'])
def webhook_google():
    """Recebe leads do Google Lead Form Extensions."""
    try:
        data = request.get_json(force=True) or {}
        user_column_data = {c.get('column_id', ''): c.get('string_value', '')
                            for c in data.get('user_column_data', [])}
        nome = (user_column_data.get('FULL_NAME') or
                data.get('lead_id', 'Lead Google'))
        telefone = user_column_data.get('PHONE_NUMBER', '')
        email = user_column_data.get('EMAIL', '')
        empresa = user_column_data.get('COMPANY_NAME', '')
        conn = db()
        conn.execute("""INSERT INTO crm_leads
            (nome, telefone, email, empresa, origem, etapa, dados_extras)
            VALUES (?,?,?,?,?,?,?)""",
            (nome, telefone, email, empresa, 'google', 'lead_novo',
             json.dumps(data, ensure_ascii=False)))
        lead_id = (conn.execute("SELECT lastval() AS id").fetchone()['id'] if DB_MODE=="postgres" else conn.execute("SELECT last_insert_rowid() id").fetchone()['id'])
        conn.execute("INSERT INTO crm_atividades (lead_id, usuario_nome, tipo, descricao) VALUES (?,?,?,?)",
                     (lead_id, 'Google Ads', 'criacao', 'Lead capturado via Google Lead Form'))
        conn.commit(); close_db(conn)
        return jsonify({"ok": True}), 200
    except Exception as e:
        return jsonify({"ok": False, "erro": str(e)}), 200


@app.route('/webhook/sheets/diagnostico', methods=['GET'])
def webhook_sheets_diagnostico():
    """Diagnóstico para AppScript validar conexão e token."""
    token_env = os.environ.get('SHEETS_WEBHOOK_TOKEN', 'serenus_sheets_2026')
    return jsonify({
        "ok": True,
        "webhook_url": "https://job-serenus-production.up.railway.app/webhook/sheets",
        "token_esperado_prefixo": token_env[:10] + "...",
        "status": "webhook pronto para receber dados",
        "teste": "POST com token serenus_sheets_2026 para começar"
    })


@app.route('/webhook/sheets', methods=['POST'])
def webhook_sheets():
    """
    Recebe leads do Google Sheets via Apps Script.
    Payload esperado:
    {
      "token": "SEU_TOKEN_AQUI",
      "origem": "Facebook" | "Google" | "MedSenior",
      "leads": [
        {
          "data_hora": "28/05/2026 10:35",
          "consultor": "DANILO",
          "nome": "Fulano",
          "telefone": "19999999999",
          "email": "fulano@gmail.com",
          "cidade": "Campinas",
          "tipo": "PF",
          "num_pessoas": "1"
        }, ...
      ]
    }
    """
    try:
        data = request.get_json(force=True) or {}

        # Validar token
        token_esperado = os.environ.get('SHEETS_WEBHOOK_TOKEN', 'serenus_sheets_2026')
        token_recebido = data.get('token', '')
        if token_recebido != token_esperado:
            app.logger.warning(f"[WEBHOOK_SHEETS] Token inválido: '{token_recebido}'")
            return jsonify({"ok": False, "erro": "Token inválido"}), 401

        origem = data.get('origem', 'Sheets')
        leads_raw = data.get('leads', [])
        modo = data.get('modo', 'normal')  # 'normal' reativa leads; 'historico' não reativa

        if not leads_raw:
            app.logger.info(f"[WEBHOOK_SHEETS] {origem}: nenhum lead enviado")
            return jsonify({"ok": True, "importados": 0, "msg": "Nenhum lead enviado"}), 200

        app.logger.info(f"[WEBHOOK_SHEETS] {origem}: recebidos {len(leads_raw)} leads brutos")

        conn = db()
        importados = 0
        duplicados = 0
        ignorados = 0

        for lead in leads_raw:
            nome     = (lead.get('nome') or '').strip()
            telefone_raw = (lead.get('telefone') or '').strip()
            email    = (lead.get('email') or '').strip()
            cidade   = (lead.get('cidade') or '').strip()
            tipo     = (lead.get('tipo') or 'PF').strip()
            num_pess = (lead.get('num_pessoas') or '').strip()
            # Consultor: tenta campo 'consultor', se vazio tenta 'consultor_2'
            cons_raw = (lead.get('consultor') or lead.get('consultor_2') or '').strip()
            # Data: aceita 'data_hora' ou 'data'
            data_hora_raw = (lead.get('data_hora') or lead.get('data') or '').strip()

            # DEBUG: primeiros 3 leads de cada origem, log a data
            if importados + duplicados + ignorados < 3:
                app.logger.info(f"[WEBHOOK_SHEETS] DEBUG {origem} lead {importados+duplicados+ignorados}: data_hora_raw='{data_hora_raw}' | nome='{nome[:30]}'")

            # Telefone: formata bonito p/ exibição + normaliza p/ dedup
            telefone = _formatar_telefone(telefone_raw)   # (19) 99104-6030
            telefone_norm = _normalizar_telefone(telefone_raw)  # 19991046030

            # Filtro: "teste" no nome ou email
            if nome and 'teste' in nome.lower():
                ignorados += 1; continue
            if email and 'teste' in email.lower():
                ignorados += 1; continue
            if not nome:
                app.logger.warning(f"[WEBHOOK_SHEETS] {origem}: lead ignorado (nome vazio) | telefone={telefone_raw} email={email}")
                ignorados += 1; continue

            # Normalizar consultor + busca FLEXÍVEL do responsável
            consultor = _normalizar_consultor(cons_raw) or 'Guilherme'
            responsavel_id = _buscar_responsavel_id(conn, consultor)
            # Se não achou no banco, guarda o nome original como externo
            consultor_externo = cons_raw if (cons_raw and not responsavel_id) else None

            # Data do lead (vinda da planilha)
            data_lead = _parse_data_lead(data_hora_raw)
            data_str = data_lead.strftime('%d/%m/%Y') if data_lead else _fmt_data_br(datetime.now(TZ_SP))

            # DEBUG: log para diagnosticar parsing de datas
            if not data_lead:
                app.logger.warning(f"[WEBHOOK_SHEETS] Data não parseada: '{data_hora_raw}' | nome={nome} | origem={origem}")

            obs = f"Tipo: {tipo}"
            if num_pess:
                obs += f" | Pessoas: {num_pess}"

            # ── Verificar se lead já existe (por telefone OU email) ──
            # Usa telefone_norm (só dígitos) comparado contra telefone_norm do banco
            lead_existente = None
            if telefone_norm:
                lead_existente = conn.execute(
                    "SELECT id, etapa, nome, criado_em FROM crm_leads WHERE telefone_norm = ?",
                    (telefone_norm,)
                ).fetchone()
            # Fallback: compara só dígitos do telefone bruto armazenado
            if not lead_existente and telefone_norm and len(telefone_norm) >= 8:
                lead_existente = conn.execute(
                    "SELECT id, etapa, nome, criado_em FROM crm_leads WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(telefone,'-',''),' ',''),'(',''),')',''),'+','') LIKE ?",
                    (f'%{telefone_norm[-8:]}',)
                ).fetchone()
            if not lead_existente and email:
                lead_existente = conn.execute(
                    "SELECT id, etapa, nome, criado_em FROM crm_leads WHERE LOWER(email) = LOWER(?)",
                    (email,)
                ).fetchone()

            if lead_existente:
                lid = lead_existente['id'] if hasattr(lead_existente, 'keys') else lead_existente[0]
                etapa_anterior = lead_existente['etapa'] if hasattr(lead_existente, 'keys') else lead_existente[1]
                criado_existente = lead_existente['criado_em'] if hasattr(lead_existente, 'keys') else lead_existente[3]

                # Converte criado_existente para date para comparar
                data_criacao_banco = _parse_data_lead(str(criado_existente)) if criado_existente else None

                # ── DECISÃO: reativar ou apenas atualizar? ──
                # Reativa SOMENTE se a nova solicitação for MAIS RECENTE que a criação
                # do lead E o modo não for 'historico'. Isso evita que reimportação
                # de histórico mova todos os leads para "lead_novo".
                eh_nova_solicitacao = (
                    modo != 'historico'
                    and data_lead is not None
                    and data_criacao_banco is not None
                    and data_lead > data_criacao_banco
                    and etapa_anterior != 'lead_novo'
                )

                if eh_nova_solicitacao:
                    # Lead voltou a solicitar de verdade → move para lead_novo
                    conn.execute("""
                        UPDATE crm_leads SET
                            nome = COALESCE(NULLIF(?, ''), nome),
                            email = COALESCE(NULLIF(?, ''), email),
                            empresa = COALESCE(NULLIF(?, ''), empresa),
                            origem = ?,
                            etapa = 'lead_novo',
                            atualizado_em = CURRENT_TIMESTAMP
                        WHERE id = ?
                    """, (nome, email, cidade, origem, lid))
                    conn.execute("""
                        INSERT INTO crm_atividades (lead_id, usuario_nome, tipo, descricao)
                        VALUES (?, ?, 'movimentacao', ?)
                    """, (lid, consultor,
                          f'Nova solicitação em {data_str} via {origem} — retornou de "{etapa_anterior}" para Lead Novo'))
                    importados += 1
                else:
                    # É reimportação OU registro antigo/duplicado.
                    # Apenas corrige a data de criação se a do banco estiver errada
                    # (importada com data do dia) e tivermos uma data real da planilha.
                    if data_lead and criado_existente:
                        criado_str = str(criado_existente)
                        if ('2026-06-22' in criado_str or '2026-06-23' in criado_str or '2026-06-24' in criado_str):
                            conn.execute(
                                "UPDATE crm_leads SET criado_em=? WHERE id=?",
                                (data_lead.strftime('%Y-%m-%d 12:00:00'), lid)
                            )
                    duplicados += 1
                continue

            # ── NOVO LEAD: não existe no banco ──
            # SEMPRE usa data_lead se disponível, senão usa hoje
            data_criacao = data_lead.strftime('%Y-%m-%d 12:00:00') if data_lead else datetime.now(TZ_SP).strftime('%Y-%m-%d %H:%M:%S')

            conn.execute("""
                INSERT INTO crm_leads
                    (nome, telefone, telefone_norm, email, empresa, origem, etapa, responsavel_id, observacoes, criado_em, consultor_externo)
                    VALUES (?, ?, ?, ?, ?, ?, 'lead_novo', ?, ?, ?, ?)
            """, (nome, telefone, telefone_norm, email, cidade, origem, responsavel_id, obs,
                  data_criacao, consultor_externo))

            lead_id = (conn.execute("SELECT lastval() AS id").fetchone()['id'] if DB_MODE=="postgres" else conn.execute("SELECT last_insert_rowid() id").fetchone()['id'])
            conn.execute("""
                INSERT INTO crm_atividades (lead_id, usuario_nome, tipo, descricao)
                VALUES (?, ?, 'criacao', ?)
            """, (lead_id, consultor, f'Lead importado via {origem} em {data_str}'))

            importados += 1

        try:
            conn.commit()
        except Exception as ec:
            app.logger.error(f"[WEBHOOK_SHEETS] Erro ao fazer commit: {ec}")
            try:
                conn.rollback()
            except:
                pass
        finally:
            close_db(conn)

        app.logger.info(f"[WEBHOOK_SHEETS] {origem}: importados={importados} duplicados={duplicados} ignorados={ignorados}")
        return jsonify({
            "ok": True,
            "importados": importados,
            "duplicados": duplicados,
            "ignorados": ignorados
        }), 200

    except Exception as e:
        import traceback as _tb2
        tb = _tb2.format_exc()
        app.logger.error(f"[WEBHOOK_SHEETS] Erro crítico: {e}\n{tb}")
        return jsonify({"ok": False, "erro": str(e)[:200]}), 500


# ─── INTEGRAÇÃO WHATSAPP (WaSpeed / Wascript) ────────────────────────────────────
# Doc: https://api-whatsapp.wascript.com.br/api-docs/
# Cada gestor pode ter seu próprio token (coluna usuarios.waspeed_token).
# Fallback: variável de ambiente WASPEED_TOKEN.
WASPEED_BASE = 'https://api-whatsapp.wascript.com.br'

def _waspeed_token_do_usuario(conn, uid):
    """Retorna o token WaSpeed do usuário, ou o global (env), ou None."""
    try:
        row = conn.execute("SELECT waspeed_token FROM usuarios WHERE id=?", (uid,)).fetchone()
        if row:
            tk = row['waspeed_token'] if hasattr(row, 'keys') else row[0]
            if tk:
                return tk
    except Exception:
        pass
    return os.environ.get('WASPEED_TOKEN', '') or None

def _waspeed_normaliza_fone(telefone):
    """Garante formato 55DDDNUMERO (só dígitos)."""
    import re as _re
    n = _re.sub(r'\D', '', telefone or '')
    if not n:
        return ''
    # Se não começa com 55 e tem 10-11 dígitos (DDD+numero), prefixa 55
    if not n.startswith('55') and len(n) in (10, 11):
        n = '55' + n
    return n

@app.route('/crm/lead/<int:lid>/whatsapp', methods=['POST'])
@login_required
def crm_lead_whatsapp(lid):
    """Envia mensagem de texto via WaSpeed e registra na timeline do lead."""
    import requests as _rq
    conn = db()
    lead = conn.execute("SELECT * FROM crm_leads WHERE id=?", (lid,)).fetchone()
    if not lead:
        close_db(conn); return jsonify({"ok": False, "erro": "Lead não encontrado"}), 404
    if session.get('perfil') != 'admin' and lead['responsavel_id'] != session['user_id']:
        close_db(conn); return jsonify({"ok": False, "erro": "Sem permissão"}), 403

    d = request.json or {}
    mensagem = (d.get('mensagem') or '').strip()
    if not mensagem:
        close_db(conn); return jsonify({"ok": False, "erro": "Mensagem vazia"}), 400

    token = _waspeed_token_do_usuario(conn, session['user_id'])
    if not token:
        close_db(conn)
        return jsonify({"ok": False, "erro": "Token WaSpeed não configurado. Configure em Usuários ou na variável WASPEED_TOKEN."}), 400

    fone = _waspeed_normaliza_fone(lead['telefone'])
    if not fone:
        close_db(conn); return jsonify({"ok": False, "erro": "Lead sem telefone válido"}), 400

    try:
        url = f"{WASPEED_BASE}/api/enviar-texto/{token}"
        resp = _rq.post(url, json={"phone": fone, "message": mensagem}, timeout=20)
        ok_envio = False
        try:
            j = resp.json()
            ok_envio = bool(j.get('success'))
            msg_api = j.get('message', '')
        except Exception:
            msg_api = resp.text[:200]

        if ok_envio:
            conn.execute("""INSERT INTO crm_atividades (lead_id, usuario_nome, tipo, descricao)
                            VALUES (?,?,?,?)""",
                         (lid, session.get('nome'), 'whatsapp', f'WhatsApp enviado: {mensagem}'))
            conn.execute("UPDATE crm_leads SET atualizado_em=CURRENT_TIMESTAMP WHERE id=?", (lid,))
            conn.commit(); close_db(conn)
            return jsonify({"ok": True, "msg": "Mensagem enviada"})
        else:
            close_db(conn)
            return jsonify({"ok": False, "erro": f"WaSpeed: {msg_api}"}), 400
    except Exception as e:
        close_db(conn)
        app.logger.error(f"[WASPEED] Erro lead {lid}: {e}")
        return jsonify({"ok": False, "erro": f"Falha ao enviar: {e}"}), 500



# ─── CRM CONFIG ───────────────────────────────────────────────────
@app.route('/admin/crm/analise-quantitativos')
@login_required
def admin_crm_analise_quantitativos():
    """Análise completa de quantitativos do CRM para debug de divergências."""
    if session.get('perfil') != 'admin':
        return jsonify({'ok': False, 'erro': 'Acesso negado'}), 403

    conn = db()
    try:
        # Total de leads
        total = conn.execute("SELECT COUNT(*) c FROM crm_leads").fetchone()['c']

        # Por etapa
        por_etapa = conn.execute("""
            SELECT etapa, COUNT(*) c FROM crm_leads GROUP BY etapa ORDER BY c DESC
        """).fetchall()

        # Por origem
        por_origem = conn.execute("""
            SELECT origem, COUNT(*) c FROM crm_leads GROUP BY origem ORDER BY c DESC
        """).fetchall()

        # Por responsável
        por_resp = conn.execute("""
            SELECT COALESCE(u.nome, 'SEM RESPONSÁVEL') as resp, COUNT(*) c
            FROM crm_leads l
            LEFT JOIN usuarios u ON u.id = l.responsavel_id
            GROUP BY resp ORDER BY c DESC
        """).fetchall()

        # Leads com "teste" no nome (que foram ignorados na importação)
        # Verifica se há no banco (não deveria ter)
        com_teste = conn.execute("""
            SELECT COUNT(*) c FROM crm_leads WHERE LOWER(nome) LIKE '%teste%'
        """).fetchone()['c']

        # Leads sem telefone E sem email (impossível deduplicar futuramente)
        sem_contato = conn.execute("""
            SELECT COUNT(*) c FROM crm_leads
            WHERE (telefone IS NULL OR telefone = '')
            AND (email IS NULL OR email = '')
        """).fetchone()['c']

        # Leads duplicados por telefone (mesmo tel, IDs diferentes)
        dup_tel = conn.execute("""
            SELECT telefone, COUNT(*) as cnt FROM crm_leads
            WHERE telefone IS NOT NULL AND telefone != ''
            GROUP BY telefone HAVING COUNT(*) > 1
        """).fetchall()

        # Leads duplicados por email
        dup_email = conn.execute("""
            SELECT email, COUNT(*) as cnt FROM crm_leads
            WHERE email IS NOT NULL AND email != ''
            GROUP BY email HAVING COUNT(*) > 1
        """).fetchall()

        close_db(conn)

        def rows(rs): return [dict(r) if hasattr(r,'keys') else {'k':r[0],'c':r[1]} for r in rs]

        return jsonify({
            'ok': True,
            'total_leads': total,
            'por_etapa': rows(por_etapa),
            'por_origem': rows(por_origem),
            'por_responsavel': rows(por_resp),
            'com_teste_no_nome': com_teste,
            'sem_telefone_e_email': sem_contato,
            'duplicados_tel': {'count': len(dup_tel), 'exemplos': rows(dup_tel[:10])},
            'duplicados_email': {'count': len(dup_email), 'exemplos': rows(dup_email[:10])},
        })
    except Exception as e:
        close_db(conn)
        return jsonify({'ok': False, 'erro': str(e)}), 500


@app.route('/admin/crm/diagnostico-leads', methods=['POST'])
@login_required
def admin_crm_diagnostico_leads():
    """
    Analisa divergências de quantitativo entre planilha e banco.
    Recebe JSON: {leads: [...]} (mesmo formato do webhook)
    Retorna breakdown detalhado de por que cada lead foi ignorado/duplicado.
    """
    if session.get('perfil') != 'admin':
        return jsonify({'ok': False, 'erro': 'Acesso negado'}), 403

    d = request.get_json(force=True) or {}
    leads_raw = d.get('leads', [])
    if not leads_raw:
        return jsonify({'ok': False, 'erro': 'Envie {leads:[...]}'}), 400

    conn = db()
    resultado = {
        'total_enviados': len(leads_raw),
        'importaria': 0,
        'ignorados_teste_nome': [],
        'ignorados_teste_email': [],
        'ignorados_sem_nome': [],
        'duplicados_telefone': [],
        'duplicados_email': [],
        'importaveis': [],
    }

    for lead in leads_raw:
        nome     = (lead.get('nome') or '').strip()
        telefone = (lead.get('telefone') or '').strip()
        email    = (lead.get('email') or '').strip()

        if not nome:
            resultado['ignorados_sem_nome'].append({'tel': telefone, 'email': email})
            continue
        if 'teste' in nome.lower():
            resultado['ignorados_teste_nome'].append({'nome': nome})
            continue
        if email and 'teste' in email.lower():
            resultado['ignorados_teste_email'].append({'nome': nome, 'email': email})
            continue

        dup_tel = False
        dup_email = False
        if telefone:
            r = conn.execute("SELECT id FROM crm_leads WHERE telefone=?", (telefone,)).fetchone()
            if r:
                dup_tel = True
                resultado['duplicados_telefone'].append({'nome': nome, 'tel': telefone})
                continue
        if email:
            r = conn.execute("SELECT id FROM crm_leads WHERE email=?", (email,)).fetchone()
            if r:
                dup_email = True
                resultado['duplicados_email'].append({'nome': nome, 'email': email})
                continue

        resultado['importaveis'].append({'nome': nome, 'tel': telefone, 'email': email})
        resultado['importaria'] += 1

    close_db(conn)

    # Resumo
    resultado['resumo'] = {
        'total': resultado['total_enviados'],
        'sem_nome': len(resultado['ignorados_sem_nome']),
        'teste_nome': len(resultado['ignorados_teste_nome']),
        'teste_email': len(resultado['ignorados_teste_email']),
        'dup_tel': len(resultado['duplicados_telefone']),
        'dup_email': len(resultado['duplicados_email']),
        'importaria': resultado['importaria'],
    }
    # Limita listas para não estourar resposta
    for k in ['ignorados_teste_nome','ignorados_teste_email','ignorados_sem_nome',
              'duplicados_telefone','duplicados_email','importaveis']:
        resultado[k] = resultado[k][:20]  # máximo 20 exemplos de cada

    return jsonify(resultado)



@app.route('/admin/crm/restaurar-etapas', methods=['POST'])
@login_required
def admin_crm_restaurar_etapas():
    """
    Restaura leads que foram movidos incorretamente para 'lead_novo' durante
    a reimportação de histórico. Identifica pela atividade 'movimentacao' de hoje
    com texto 'Nova solicitação' e devolve o lead para a etapa anterior.
    """
    if session.get('perfil') != 'admin':
        return jsonify({'ok': False, 'erro': 'Acesso negado'}), 403

    conn = db()
    try:
        # ESTRATÉGIA: Os leads importados do histórico foram movidos para 'lead_novo'
        # por engano. Um lead REALMENTE novo tem criado_em de hoje/ontem.
        # Os movidos por engano têm criado_em antigo OU foram criados em massa.
        #
        # Identifica leads em 'lead_novo' que têm atividade de 'criacao' (import)
        # e os move para 'topo' (onde leads importados devem ficar).
        # Leads genuinamente novos (criados manualmente hoje) permanecem.

        # Busca todos os leads em lead_novo que vieram de importação
        leads_importados = conn.execute("""
            SELECT DISTINCT l.id AS id
            FROM crm_leads l
            JOIN crm_atividades a ON a.lead_id = l.id
            WHERE l.etapa = 'lead_novo'
            AND a.tipo = 'criacao'
            AND a.descricao LIKE '%importado%'
        """).fetchall()

        ids = []
        for r in leads_importados:
            ids.append(r['id'] if hasattr(r, 'keys') else r[0])

        restaurados = 0
        if ids:
            # Move em lote para 'topo' usando IN com placeholders
            placeholders = ','.join(['?'] * len(ids))
            conn.execute(
                f"UPDATE crm_leads SET etapa='topo' WHERE id IN ({placeholders}) AND etapa='lead_novo'",
                ids
            )
            restaurados = len(ids)

            # Remove as atividades falsas de movimentação (reativação)
            # Faz em lote, sem LIKE+param (evita bug de %)
            conn.execute(
                f"DELETE FROM crm_atividades WHERE lead_id IN ({placeholders}) AND tipo='movimentacao'",
                ids
            )

        conn.commit()
        close_db(conn)
        return jsonify({
            'ok': True,
            'restaurados': restaurados,
            'msg': f'{restaurados} leads movidos de Lead Novo para Topo do Funil'
        })
    except Exception as e:
        close_db(conn)
        app.logger.error(f"[RESTAURAR_ETAPAS] {e}")
        return jsonify({'ok': False, 'erro': str(e)}), 500


@app.route('/admin/crm/formatar-telefones', methods=['POST'])
@login_required
def admin_crm_formatar_telefones():
    """
    Formata todos os telefones existentes para (XX) XXXXX-XXXX e
    preenche a coluna telefone_norm (só dígitos) para dedup futura.
    """
    if session.get('perfil') != 'admin':
        return jsonify({'ok': False, 'erro': 'Acesso negado'}), 403

    conn = db()
    try:
        leads = conn.execute("SELECT id, telefone FROM crm_leads WHERE telefone IS NOT NULL AND telefone != ''").fetchall()
        formatados = 0
        for lead in leads:
            lid = lead['id'] if hasattr(lead, 'keys') else lead[0]
            tel = lead['telefone'] if hasattr(lead, 'keys') else lead[1]

            tel_bonito = _formatar_telefone(tel)
            tel_norm = _normalizar_telefone(tel)

            conn.execute(
                "UPDATE crm_leads SET telefone=?, telefone_norm=? WHERE id=?",
                (tel_bonito, tel_norm, lid)
            )
            formatados += 1

        conn.commit()
        close_db(conn)
        return jsonify({'ok': True, 'formatados': formatados, 'msg': f'{formatados} telefones formatados'})
    except Exception as e:
        close_db(conn)
        app.logger.error(f"[FORMATAR_TEL] {e}")
        return jsonify({'ok': False, 'erro': str(e)}), 500


@app.route('/admin/crm/debug-datas')
@login_required
def admin_crm_debug_datas():
    """Mostra amostra de telefones e datas no banco para debug."""
    if session.get('perfil') != 'admin':
        return jsonify({'ok': False, 'erro': 'Acesso negado'}), 403
    conn = db()
    try:
        # Amostra de 10 leads do Facebook
        amostra = conn.execute("""
            SELECT id, nome, telefone, email, criado_em, origem
            FROM crm_leads
            WHERE origem = 'Facebook'
            ORDER BY id LIMIT 10
        """).fetchall()

        # Distribuição de datas
        datas = conn.execute("""
            SELECT SUBSTR(CAST(criado_em AS TEXT), 1, 10) AS dia, COUNT(*) AS qtd
            FROM crm_leads
            GROUP BY dia ORDER BY qtd DESC LIMIT 15
        """).fetchall()

        def rows(rs): return [dict(r) if hasattr(r,'keys') else {} for r in rs]
        close_db(conn)
        return jsonify({
            'ok': True,
            'amostra_facebook': rows(amostra),
            'distribuicao_datas': rows(datas)
        })
    except Exception as e:
        close_db(conn)
        return jsonify({'ok': False, 'erro': str(e)}), 500


@app.route('/webhook/diag-datas', methods=['GET'])
def webhook_diag_datas():
    """Diagnóstico das datas e telefones dos leads. Protegido por token na query."""
    if request.args.get('token') != os.environ.get('SHEETS_WEBHOOK_TOKEN', 'serenus_sheets_2026'):
        return jsonify({"erro": "token invalido"}), 401
    conn = db()

    # Teste de match: ?tel=XXXX testa as 3 estrategias de busca
    tel_teste = request.args.get('tel', '').strip()
    if tel_teste:
        try:
            tn = _normalizar_telefone(tel_teste)
            r1 = conn.execute("SELECT id, nome, telefone_norm, CAST(criado_em AS TEXT) c FROM crm_leads WHERE telefone_norm=?", (tn,)).fetchone()
            r2 = None
            if tn and len(tn) >= 8:
                r2 = conn.execute("SELECT id, nome, telefone_norm, CAST(criado_em AS TEXT) c FROM crm_leads WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(telefone,'-',''),' ',''),'(',''),')',''),'+','') LIKE ?", (f'%{tn[-8:]}',)).fetchone()
            r3 = conn.execute("SELECT id, nome, telefone_norm, CAST(criado_em AS TEXT) c FROM crm_leads WHERE telefone_norm LIKE ?", (f'%{tn[-8:]}',)).fetchone() if len(tn) >= 8 else None
            close_db(conn)
            return jsonify({
                "tel_input": tel_teste, "tel_normalizado": tn, "ultimos8": tn[-8:] if len(tn)>=8 else tn,
                "match_exato": dict(r1) if r1 else None,
                "match_ultimos8_telefone": dict(r2) if r2 else None,
                "match_ultimos8_telefonenorm": dict(r3) if r3 else None,
            })
        except Exception as e:
            close_db(conn); return jsonify({"erro": str(e)}), 500
    try:
        total = conn.execute("SELECT COUNT(*) c FROM crm_leads").fetchone()['c']
        com_tel_norm = conn.execute("SELECT COUNT(*) c FROM crm_leads WHERE telefone_norm IS NOT NULL AND telefone_norm != ''").fetchone()['c']
        # Distribuicao por data de criacao (substring nao funciona igual; usa range simples)
        dist = conn.execute("""
            SELECT substr(CAST(criado_em AS TEXT),1,10) dia, COUNT(*) n
            FROM crm_leads GROUP BY substr(CAST(criado_em AS TEXT),1,10)
            ORDER BY n DESC LIMIT 15
        """).fetchall()
        amostra = conn.execute("SELECT id, nome, telefone, telefone_norm, CAST(criado_em AS TEXT) criado_em, origem FROM crm_leads ORDER BY id DESC LIMIT 8").fetchall()
        close_db(conn)
        return jsonify({
            "total_leads": total,
            "com_telefone_norm": com_tel_norm,
            "sem_telefone_norm": total - com_tel_norm,
            "distribuicao_datas": [dict(r) for r in dist],
            "amostra": [dict(r) for r in amostra],
        })
    except Exception as e:
        close_db(conn)
        return jsonify({"erro": str(e)}), 500


@app.route('/admin/crm/corrigir-datas-servidor', methods=['GET', 'POST'])
def admin_corrigir_datas_servidor():
    """
    SOLUÇÃO DEFINITIVA: lê as 4 planilhas (Meta + Google P1/P2/MEDSENIOR) direto
    no servidor via CSV, faz match em memória (telefone/email) e corrige criado_em
    de cada lead com a data REAL da planilha. Tudo numa requisição.
    Protegido por token (?token=) ou login admin.
    """
    token_ok = request.args.get('token') == os.environ.get('SHEETS_WEBHOOK_TOKEN', 'serenus_sheets_2026')
    if not token_ok and session.get('perfil') != 'admin':
        return jsonify({"erro": "acesso negado"}), 403

    import csv, urllib.request, urllib.parse
    from io import StringIO

    # (sheet_id, aba, col_data, col_telefone, col_email)
    FONTES = [
        ('1VOChFfTkuVO4eO0FCAkBjrP9qDFnvWZnk5rLdUrNm64', 'LEADS GERAIS', 0, 8, 9),
        ('1QT8y8rfbMaHb5POrYFZKjdccpgMLLY3WRjBjxFmold8', 'Página1', 0, 3, 4),
        ('1QT8y8rfbMaHb5POrYFZKjdccpgMLLY3WRjBjxFmold8', 'Página2', 0, 2, 3),
        ('1QT8y8rfbMaHb5POrYFZKjdccpgMLLY3WRjBjxFmold8', 'MEDSENIOR', 0, 3, 4),
    ]

    conn = db()
    try:
        # 1. Carrega TODOS os leads em memória (1 query) e monta índices de match
        leads = conn.execute("SELECT id, telefone_norm, email, CAST(criado_em AS TEXT) criado_em FROM crm_leads").fetchall()
        por_tel, por_8, por_email, criado_de = {}, {}, {}, {}
        for l in leads:
            lid = l['id'] if hasattr(l, 'keys') else l[0]
            tn = (l['telefone_norm'] if hasattr(l, 'keys') else l[1]) or ''
            em = ((l['email'] if hasattr(l, 'keys') else l[2]) or '').strip().lower()
            criado_de[lid] = (l['criado_em'] if hasattr(l, 'keys') else l[3]) or ''
            if tn:
                por_tel.setdefault(tn, lid)
                if len(tn) >= 8:
                    por_8.setdefault(tn[-8:], lid)
            if em:
                por_email.setdefault(em, lid)

        updates = {}  # lid -> data_str (mantém a MAIS ANTIGA = data de criação real)
        lidos = 0
        nao_encontrados = 0
        erros = []

        for sheet_id, aba, ci_data, ci_tel, ci_email in FONTES:
            try:
                url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv&sheet={urllib.parse.quote(aba)}"
                req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                texto = urllib.request.urlopen(req, timeout=30).read().decode('utf-8-sig')
                linhas = list(csv.reader(StringIO(texto)))
                mx = max(ci_data, ci_tel, ci_email)
                for r in linhas[1:]:
                    if len(r) <= mx:
                        continue
                    data_obj = _parse_data_lead(r[ci_data])
                    if not data_obj:
                        continue
                    tel_raw = (r[ci_tel] or '').strip()
                    email = (r[ci_email] or '').strip().lower()
                    if not tel_raw and not email:
                        continue
                    lidos += 1
                    tn = _normalizar_telefone(tel_raw)
                    lid = None
                    if tn and tn in por_tel:
                        lid = por_tel[tn]
                    elif tn and len(tn) >= 8 and tn[-8:] in por_8:
                        lid = por_8[tn[-8:]]
                    elif email and email in por_email:
                        lid = por_email[email]
                    if lid is None:
                        nao_encontrados += 1
                        continue
                    data_str = data_obj.strftime('%Y-%m-%d 12:00:00')
                    # Mantém a menor data (primeira solicitação = criação real)
                    if lid not in updates or data_str < updates[lid]:
                        updates[lid] = data_str
            except Exception as e:
                erros.append(f"{aba}: {str(e)[:120]}")

        # 2. Aplica updates (só quando a data muda de fato)
        aplicados = 0
        for lid, nova in updates.items():
            if criado_de.get(lid, '')[:10] != nova[:10]:
                conn.execute("UPDATE crm_leads SET criado_em=? WHERE id=?", (nova, lid))
                aplicados += 1

        conn.commit()
        close_db(conn)
        return jsonify({
            "ok": True,
            "leads_no_banco": len(leads),
            "linhas_lidas_planilhas": lidos,
            "datas_corrigidas": aplicados,
            "nao_encontrados": nao_encontrados,
            "erros": erros,
        })
    except Exception as e:
        try:
            conn.rollback(); close_db(conn)
        except Exception:
            pass
        return jsonify({"ok": False, "erro": str(e)}), 500


@app.route('/webhook/corrigir-datas', methods=['POST'])
def webhook_corrigir_datas():
    """
    Recebe lote de {telefone, email, data_hora} e corrige criado_em dos leads.
    Usado pelo Apps Script para corrigir datas historicas.
    """
    try:
        data = request.get_json(force=True) or {}
        token_esperado = os.environ.get('SHEETS_WEBHOOK_TOKEN', 'serenus_sheets_2026')
        if data.get('token') != token_esperado:
            return jsonify({"ok": False, "erro": "Token invalido"}), 401

        registros = data.get('registros', [])
        if not registros:
            return jsonify({"ok": True, "corrigidos": 0, "nao_encontrados": 0})

        conn = db()
        corrigidos = 0
        nao_encontrados = 0

        import re as _re
        def _so_digitos(s):
            return _re.sub(r'\D', '', s or '')

        for reg in registros:
            telefone  = (reg.get('telefone') or '').strip()
            email     = (reg.get('email') or '').strip()
            data_hora = (reg.get('data_hora') or '').strip()

            if not data_hora:
                nao_encontrados += 1; continue

            data_obj = _parse_data_lead(data_hora)
            if not data_obj:
                nao_encontrados += 1; continue

            data_iso = data_obj.strftime('%Y-%m-%d 12:00:00')

            lead = None

            # Normaliza o telefone recebido
            tel_norm = _normalizar_telefone(telefone)

            # 1) Busca por telefone_norm (campo dedicado)
            if tel_norm:
                lead = conn.execute("SELECT id, criado_em FROM crm_leads WHERE telefone_norm=?", (tel_norm,)).fetchone()

            # 2) Busca por últimos 8 dígitos no telefone formatado
            if not lead and tel_norm and len(tel_norm) >= 8:
                lead = conn.execute(
                    "SELECT id, criado_em FROM crm_leads WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(telefone,'-',''),' ',''),'(',''),')',''),'+','') LIKE ?",
                    (f'%{tel_norm[-8:]}',)
                ).fetchone()

            # 3) Busca por email (case-insensitive)
            if not lead and email:
                lead = conn.execute("SELECT id, criado_em FROM crm_leads WHERE LOWER(email)=LOWER(?)", (email,)).fetchone()

            if not lead:
                nao_encontrados += 1; continue

            lid = lead['id'] if hasattr(lead, 'keys') else lead[0]
            criado_atual = str(lead['criado_em'] if hasattr(lead, 'keys') else lead[1] or '')

            # Atualiza se: (a) data atual é do dia do import (errada), OU
            # (b) a data da planilha é diferente da data atual registrada.
            # Compara apenas a parte da data (YYYY-MM-DD).
            data_planilha_ymd = data_obj.strftime('%Y-%m-%d')
            data_atual_ymd = criado_atual[:10] if len(criado_atual) >= 10 else ''

            eh_data_import = ('2026-06-22' in criado_atual or '2026-06-23' in criado_atual or '2026-06-24' in criado_atual)
            datas_diferentes = (data_atual_ymd and data_atual_ymd != data_planilha_ymd)

            if eh_data_import or datas_diferentes:
                conn.execute("UPDATE crm_leads SET criado_em=? WHERE id=?", (data_iso, lid))
                corrigidos += 1

        conn.commit()
        close_db(conn)
        return jsonify({"ok": True, "corrigidos": corrigidos, "nao_encontrados": nao_encontrados})
    except Exception as e:
        app.logger.error(f"[CORRIGIR_DATAS] {e}")
        return jsonify({"ok": False, "erro": str(e)}), 500



@app.route('/admin/crm/corrigir-leads', methods=['POST'])
@login_required
def admin_crm_corrigir_leads():
    """
    Corrige retroativamente leads importados:
    1. Atribui responsavel_id com base no texto da atividade de criação
    2. Corrige criado_em com base na atividade de criação (que tem a data real)
    Roda apenas para leads com responsavel_id IS NULL ou criado_em = data de hoje
    """
    if session.get('perfil') != 'admin':
        return jsonify({'ok': False, 'erro': 'Acesso negado'}), 403

    conn = db()
    try:
        # Busca todos os usuários para o mapeamento
        usuarios = conn.execute("SELECT id, nome FROM usuarios WHERE ativo=1").fetchall()
        # Monta mapa: primeiro nome lower → id
        mapa_usuarios = {}
        for u in usuarios:
            nome_completo = u['nome'] if hasattr(u, 'keys') else u[1]
            uid = u['id'] if hasattr(u, 'keys') else u[0]
            primeiro = nome_completo.strip().lower().split()[0]
            mapa_usuarios[primeiro] = uid
            mapa_usuarios[nome_completo.lower()] = uid

        # Busca leads sem responsável ou com data suspeita (criados hoje mas atividade mais antiga)
        leads = conn.execute("""
            SELECT id, nome, responsavel_id, criado_em FROM crm_leads
            WHERE responsavel_id IS NULL
            ORDER BY id
        """).fetchall()

        corrigidos_resp = 0
        corrigidos_data = 0

        for lead in leads:
            lid = lead['id'] if hasattr(lead, 'keys') else lead[0]

            # Busca atividade de criação para extrair consultor e data
            ativ = conn.execute("""
                SELECT usuario_nome, descricao, criado_em FROM crm_atividades
                WHERE lead_id=? AND tipo='criacao'
                ORDER BY id LIMIT 1
            """, (lid,)).fetchone()

            if not ativ:
                continue

            usuario_nome = (ativ['usuario_nome'] if hasattr(ativ, 'keys') else ativ[0]) or ''
            criado_em_ativ = ativ['criado_em'] if hasattr(ativ, 'keys') else ativ[2]

            # Corrigir responsável
            resp_id = None
            if usuario_nome:
                primeiro = usuario_nome.strip().lower().split()[0]
                resp_id = mapa_usuarios.get(primeiro)
                if not resp_id:
                    resp_id = mapa_usuarios.get(usuario_nome.strip().lower())

            if resp_id:
                conn.execute("UPDATE crm_leads SET responsavel_id=? WHERE id=?", (resp_id, lid))
                corrigidos_resp += 1

        # Agora corrigir datas: leads onde criado_em difere da atividade de criação
        # Para os leads importados da planilha, a data real está na descrição da atividade
        # ou podemos usar a data da atividade como proxy
        leads_data = conn.execute("""
            SELECT l.id, l.criado_em, a.criado_em as ativ_criado_em
            FROM crm_leads l
            JOIN crm_atividades a ON a.lead_id = l.id AND a.tipo = 'criacao'
            WHERE DATE(l.criado_em) = DATE(CURRENT_TIMESTAMP)
            ORDER BY l.id
        """).fetchall()

        for lead in leads_data:
            lid = lead['id'] if hasattr(lead, 'keys') else lead[0]
            ativ_dt = lead['ativ_criado_em'] if hasattr(lead, 'keys') else lead[2]
            if ativ_dt:
                conn.execute("UPDATE crm_leads SET criado_em=? WHERE id=?", (ativ_dt, lid))
                corrigidos_data += 1

        conn.commit()
        close_db(conn)
        return jsonify({
            'ok': True,
            'corrigidos_responsavel': corrigidos_resp,
            'corrigidos_data': corrigidos_data,
            'msg': f'Corrigidos: {corrigidos_resp} responsáveis, {corrigidos_data} datas'
        })
    except Exception as e:
        close_db(conn)
        app.logger.error(f"[CORRIGIR_LEADS] {e}")
        return jsonify({'ok': False, 'erro': str(e)}), 500


# ─── CRM CONFIG ───────────────────────────────────────────────────
@app.route('/crm/config')
@login_required
def crm_config():
    """Pgágina de configuração do CRM — gerenciar etapas do funil."""
    conn = db()
    etapas = carregar_etapas_crm(conn)
    close_db(conn)
    is_admin = session.get('perfil') == 'admin'
    usuario = session.get('usuario')
    # Renderiza inline (sem template separado)
    etapas_html = ''.join([
        f'<div class="etapa-item" style="display:flex;align-items:center;gap:12px;padding:12px;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:8px;">'
        f'<span style="width:12px;height:12px;border-radius:50%;background:{e["cor"]};flex-shrink:0;"></span>'
        f'<strong style="flex:1">{e["nome"]}</strong>'
        f'<span style="color:#9ca3af;font-size:12px">{e["tipo"]}</span>'
        f'</div>' for e in etapas
    ])
    html = f"""<!DOCTYPE html><html><head><title>Config CRM</title>
    <style>body{{font-family:Arial;background:#f4f6f9;padding:40px;}}
    .container{{max-width:700px;margin:0 auto;background:white;padding:30px;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.1);}}
    h1{{color:#333;}} a{{color:#3b82f6;text-decoration:none;}}
    .btn{{background:#3b82f6;color:white;padding:10px 18px;border:none;border-radius:4px;cursor:pointer;font-size:14px;text-decoration:none;}}
    </style></head><body>
    <div class='container'>
    <p><a href='/crm'>← Voltar ao CRM</a></p>
    <h1>⚙️ Configurações do CRM</h1>
    <h2 style='font-size:16px;margin-top:30px;'>Etapas do Funil</h2>
    {etapas_html}
    {'<p style="margin-top:20px;"><a class="btn" href="/crm/etapas">Gerenciar Etapas</a></p>' if is_admin else ''}
    <h2 style='font-size:16px;margin-top:30px;'>Importação de Leads</h2>
    <p>Leads do Facebook e Google chegam automaticamente via Apps Script.</p>
    {'<p><a class="btn" href="/crm/importar">Importar Leads Manualmente</a></p>' if is_admin else ''}
    </div></body></html>"""
    return html

# ─── UPLOAD DE FOTO (próprio usuário, sem ser admin) ─────────────────────────────
@app.route('/minha-foto', methods=['POST'])
@login_required
def minha_foto():
    """Qualquer usuário pode atualizar sua própria foto."""
    fimg = request.files.get('foto')
    if not fimg or not fimg.filename:
        return jsonify({"ok": False, "erro": "Arquivo não enviado"}), 400
    ext = os.path.splitext(fimg.filename)[1].lower()
    if ext not in ('.png', '.jpg', '.jpeg', '.webp'):
        return jsonify({"ok": False, "erro": "Formato inválido"}), 400
    fimg.seek(0, os.SEEK_END)
    if fimg.tell() > 2 * 1024 * 1024:
        return jsonify({"ok": False, "erro": "Máximo 2MB"}), 400
    fimg.seek(0)
    
    # Sanitiza nome de arquivo (apenas alfanumérico e underscore)
    uid = session['user_id']
    foto_nome = f"perfil_{uid}_{int(datetime.now(TZ_SP).timestamp())}{ext}"
    
    conn = db()
    foto_antiga = conn.execute("SELECT foto FROM usuarios WHERE id=?", (uid,)).fetchone()
    if foto_antiga and foto_antiga['foto']:
        try: os.remove(os.path.join(UPLOAD_FOLDER, foto_antiga['foto']))
        except: pass
    fimg.save(os.path.join(UPLOAD_FOLDER, foto_nome))
    conn.execute("UPDATE usuarios SET foto=? WHERE id=?", (foto_nome, uid))
    conn.commit(); close_db(conn)
    session['foto'] = foto_nome
    return jsonify({"ok": True, "foto": foto_nome})




def log_operacao(usuario_id, operacao, detalhes='', nivel='info'):
    """Log seguro: nunca expõe senhas/dados sensíveis."""
    msg = f"[{operacao}] user={usuario_id} {detalhes}".replace('senha', '***').replace('token', '***')
    if nivel == 'error':
        app.logger.error(msg[:200])
    elif nivel == 'warning':
        app.logger.warning(msg[:200])
    else:
        app.logger.info(msg[:200])

# ════════════════════════════════════════════════════════════════════════════
# DATA RESILIENCE: Sincronização + Backup + Recuperação automática
# ════════════════════════════════════════════════════════════════════════════

_RESILIENCE_BACKUP_DIR = os.path.join(os.path.expanduser("~"), "JOB_Serenus_Dados", "backups", "resilience")

def _garantir_dir_backup():
    """Garante que o diretório de backup existe."""
    os.makedirs(_RESILIENCE_BACKUP_DIR, exist_ok=True)

def _fazer_snapshot_emergencia():
    """Faz snapshot de TODAS as tabelas pra arquivo JSON local (fallback extremo)."""
    try:
        _garantir_dir_backup()
        conn = db()
        snapshot = {'timestamp': datetime.utcnow().isoformat(), 'tabelas': {}}
        
        tabelas = ['usuarios', 'propostas', 'parcelas', 'comissoes', 'recebimento', 
                   'repasse_corretor', 'supervisoras', 'regimes', 'niveis', 'produtos']
        
        for tabela in tabelas:
            cur = conn.cursor()
            try:
                cur.execute(f"SELECT * FROM {tabela}")
                # RealDictRow (Postgres) e sqlite3.Row (SQLite) convertem direto para dict
                snapshot['tabelas'][tabela] = [dict(row) for row in cur.fetchall()]
            except Exception as e:
                app.logger.warning(f"[resilience] Erro ao ler {tabela}: {e}")
                snapshot['tabelas'][tabela] = []
        
        close_db(conn)
        
        # Salvar
        arquivo = os.path.join(_RESILIENCE_BACKUP_DIR, f"snapshot_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json")
        with open(arquivo, 'w') as f:
            json.dump(snapshot, f, default=str)
        
        # Manter apenas últimos 10
        backups = sorted(os.listdir(_RESILIENCE_BACKUP_DIR))
        if len(backups) > 10:
            for old in backups[:-10]:
                try: os.remove(os.path.join(_RESILIENCE_BACKUP_DIR, old))
                except: pass
        
        app.logger.info(f"[resilience] Snapshot salvo: {arquivo}")
    except Exception as e:
        app.logger.error(f"[resilience] Erro ao fazer snapshot: {e}")

def _restaurar_de_snapshot(arquivo=None):
    """Restaura banco do snapshot JSON mais recente."""
    try:
        _garantir_dir_backup()
        if not arquivo:
            backups = sorted(os.listdir(_RESILIENCE_BACKUP_DIR), reverse=True)
            if not backups:
                app.logger.warning("[resilience] Nenhum snapshot encontrado")
                return False
            arquivo = os.path.join(_RESILIENCE_BACKUP_DIR, backups[0])
        
        with open(arquivo, 'r') as f:
            snapshot = json.load(f)
        
        conn = db()
        restaurado = 0
        
        for tabela, linhas in snapshot.get('tabelas', {}).items():
            try:
                conn.execute(f"DELETE FROM {tabela}")
                if linhas:
                    # Pega as colunas do primeiro registro
                    cols = list(linhas[0].keys())
                    for linha in linhas:
                        placeholders = ", ".join(["?"] * len(cols))
                        vals = [linha.get(c) for c in cols]
                        conn.execute(f"INSERT INTO {tabela} ({', '.join(cols)}) VALUES ({placeholders})", vals)
                    restaurado += len(linhas)
            except Exception as e:
                app.logger.warning(f"[resilience] Erro ao restaurar {tabela}: {e}")
        
        conn.commit()
        close_db(conn)
        app.logger.info(f"[resilience] ✅ Restaurado de {arquivo}: {restaurado} registros")
        return True
    except Exception as e:
        app.logger.error(f"[resilience] Erro ao restaurar: {e}")
        return False

def _verificar_banco_vazio():
    """Se banco está vazio, restaura do snapshot mais recente."""
    try:
        conn = db()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) c FROM propostas")
        count = cur.fetchone()[0] if DB_MODE == 'sqlite' else cur.fetchone()['c']
        close_db(conn)
        
        if count == 0:
            app.logger.warning("[resilience] Banco vazio! Tentando restaurar...")
            if _restaurar_de_snapshot():
                return True
            else:
                app.logger.warning("[resilience] Falha ao restaurar. Banco permanece vazio.")
                return False
        return True
    except Exception as e:
        app.logger.error(f"[resilience] Erro ao verificar banco: {e}")
        return False

# ─── INICIALIZAÇÃO DO SCHEMA (no import — Railway roda `python app.py`) ───────
# Cria/atualiza as tabelas ANTES de qualquer verificação ou requisição.
# Funciona tanto em PostgreSQL (persiste) quanto em SQLite (fallback local).
try:
    init_db()
    _db_initialized = True
    print(f"[STARTUP] ✅ Schema pronto ({DB_MODE.upper()})")
except Exception as _e:
    print(f"[STARTUP] ⚠️ init_db falhou no import ({_e}); será tentado por requisição")

# Executar ao iniciar
_verificar_banco_vazio()

# Agendador de backup
_SCHEDULER_INICIADO = False

def _importar_leads_automatico():
    """
    Importa leads novos das planilhas automaticamente (sem filtro de data).
    Usa a MESMA lógica do webhook /webhook/sheets: dedup por telefone_norm/email,
    grava telefone_norm + criado_em + etapa 'lead_novo' + consultor_externo e
    registra atividade. Commit por lead (um lead com erro não derruba os outros).
    Retorna (importados, duplicados). Seguro para rodar concorrente.
    """
    importados = 0
    duplicados = 0
    ignorados = 0
    MAX_POR_RODADA = 50  # teto por execução: se houver backlog, drena aos poucos
    try:
        conn = db()
        leads_raw = _listar_leads_do_sheets()
        for row in leads_raw:
            if importados >= MAX_POR_RODADA:
                break
            try:
                sucesso, msg, dados = _processar_lead(row, conn)
                if not sucesso:
                    duplicados += 1
                    continue
                telefone = _formatar_telefone(dados['telefone'])
                telefone_norm = _normalizar_telefone(dados['telefone'])
                email = (dados.get('email') or '').strip()
                # ANTI-FLOOD: sem telefone E sem email não há como deduplicar →
                # nunca importa automaticamente (senão reinseriria a cada rodada).
                if not telefone_norm and not email:
                    ignorados += 1
                    continue
                # RECÊNCIA: pula apenas leads DATADOS e claramente antigos (>30 dias),
                # para não re-despejar o histórico já trabalhado. Leads sem data
                # (ex.: planilha Página1) passam — o dedup abaixo evita duplicar.
                data_lead_str = dados.get('data_lead')
                dt_lead = _parse_dt_seguro(data_lead_str) if data_lead_str else None
                if dt_lead is not None:
                    if dt_lead.tzinfo is None:
                        dt_lead = TZ_SP.localize(dt_lead)
                    if (datetime.now(TZ_SP) - dt_lead).days > 30:
                        ignorados += 1
                        continue
                # Dedup por telefone_norm (alinhado ao webhook) + email
                existe = None
                if telefone_norm:
                    existe = conn.execute(
                        "SELECT id FROM crm_leads WHERE telefone_norm = ?", (telefone_norm,)
                    ).fetchone()
                if not existe and email:
                    existe = conn.execute(
                        "SELECT id FROM crm_leads WHERE LOWER(email) = LOWER(?)", (email,)
                    ).fetchone()
                if existe:
                    duplicados += 1
                    continue
                criado_em = dados.get('data_lead') or datetime.now(TZ_SP).strftime('%Y-%m-%d %H:%M:%S')
                consultor = dados.get('consultor_nome') or 'Guilherme'
                resp_id = dados.get('responsavel_id')
                consultor_externo = consultor if not resp_id else None
                conn.execute("""
                    INSERT INTO crm_leads
                        (nome, telefone, telefone_norm, email, empresa, origem, etapa,
                         responsavel_id, observacoes, criado_em, consultor_externo)
                    VALUES (?, ?, ?, ?, ?, ?, 'lead_novo', ?, ?, ?, ?)
                """, (dados['nome'], telefone, telefone_norm, email, dados.get('empresa') or '',
                      dados.get('origem') or 'Planilha', resp_id, dados.get('observacoes') or '',
                      criado_em, consultor_externo))
                lead_id = (conn.execute("SELECT lastval() AS id").fetchone()['id'] if DB_MODE == "postgres"
                           else conn.execute("SELECT last_insert_rowid() id").fetchone()['id'])
                conn.execute("""
                    INSERT INTO crm_atividades (lead_id, usuario_nome, tipo, descricao)
                    VALUES (?, ?, 'criacao', ?)
                """, (lead_id, consultor, f"Lead importado automaticamente via {dados.get('origem') or 'planilha'}"))
                conn.commit()
                importados += 1
            except Exception:
                try: conn.rollback()
                except Exception: pass
        close_db(conn)
        if importados:
            app.logger.info(f"[LEAD_AUTO] ✅ {importados} leads novos importados (dup={duplicados}, ign={ignorados})")
            # Uma única notificação-resumo (nunca uma por lead, p/ não floodar o sino)
            try:
                _notificar_admins('lead', f'{importados} novo(s) lead(s)',
                                  'Importados das planilhas automaticamente', '/crm')
            except Exception:
                pass
    except Exception as e:
        app.logger.error(f"[LEAD_AUTO] ❌ {e}")
    return importados, duplicados


# ── Auto-pull de leads disparado por requisição (independe do APScheduler) ──
# Garante que os leads cheguem "a todo momento" mesmo que o agendador em
# background morra após restart/deploy no Railway. Throttle: no máximo 1x a
# cada 10 min por processo. Roda em thread daemon: nunca bloqueia/derruba a página.
_ULTIMO_AUTO_PULL = 0.0
_AUTO_PULL_LOCK = threading.Lock()
_AUTO_PULL_INTERVALO = 600  # segundos

def _auto_pull_leads_throttled():
    global _ULTIMO_AUTO_PULL
    try:
        agora = time.time()
        if agora - _ULTIMO_AUTO_PULL < _AUTO_PULL_INTERVALO:
            return
        if not _AUTO_PULL_LOCK.acquire(blocking=False):
            return
        _ULTIMO_AUTO_PULL = agora
        def _run():
            try:
                _importar_leads_automatico()
            except Exception:
                pass
            finally:
                try: _AUTO_PULL_LOCK.release()
                except Exception: pass
        threading.Thread(target=_run, daemon=True).start()
    except Exception:
        pass


def _iniciar_scheduler_backup():
    """Liga agendador de backup automático JSON (22:00 SP todo dia)."""
    global _SCHEDULER_INICIADO
    if _SCHEDULER_INICIADO:
        return
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        
        def fazer_backup_agendado():
            """Função que roda automaticamente às 22:00 SP."""
            try:
                conn = db()
                propostas = conn.execute("SELECT * FROM propostas").fetchall()
                parcelas = conn.execute("SELECT * FROM parcelas").fetchall()
                usuarios = conn.execute("SELECT * FROM usuarios").fetchall()
                operadoras = conn.execute("SELECT * FROM operadoras").fetchall()
                recebimento = conn.execute("SELECT * FROM recebimento").fetchall()
                repasse_corretor = conn.execute("SELECT * FROM repasse_corretor").fetchall()
                
                backup = {
                    'versao': 'v14',
                    'data_backup': datetime.now(TZ_SP).isoformat(),
                    'total_propostas': len(propostas),
                    'propostas': [dict(p) for p in propostas],
                    'parcelas': [dict(p) for p in parcelas],
                    'usuarios': [dict(u) for u in usuarios],
                    'operadoras': [dict(o) for o in operadoras],
                    'recebimento': [dict(r) for r in recebimento],
                    'repasse_corretor': [dict(r) for r in repasse_corretor],
                }
                
                close_db(conn)
                
                os.makedirs('/data/backups', exist_ok=True)
                timestamp = datetime.now(TZ_SP).strftime('%Y%m%d-%H%M%S')
                backup_file = f"/data/backups/backup-{timestamp}.json"
                
                with open(backup_file, 'w', encoding='utf-8') as f:
                    json.dump(backup, f, indent=2, default=str, ensure_ascii=False)
                
                app.logger.info(f"[BACKUP AUTO] ✅ {backup_file} ({len(propostas)} propostas)")
            except Exception as e:
                app.logger.error(f"[BACKUP AUTO] ❌ {e}")
        
        # Agendar para 22:00 (SP) todos os dias
        sched = BackgroundScheduler(daemon=True, timezone=TZ_SP)
        sched.add_job(fazer_backup_agendado, 'cron', hour=22, minute=0, max_instances=1)
        # Importação automática de leads das planilhas: roda LOGO ao subir e depois
        # a cada 15 minutos (antes só rodava 30 min após o boot).
        sched.add_job(_importar_leads_automatico, 'interval', minutes=15, max_instances=1,
                      next_run_time=datetime.now(TZ_SP) + timedelta(seconds=20))
        sched.start()
        _SCHEDULER_INICIADO = True
        app.logger.info("[SCHEDULER] ✅ Backup (22:00 SP) + Importação de leads (boot + a cada 15 min) agendados")
    except Exception as e:
        app.logger.warning(f"[SCHEDULER] ❌ Falha ao iniciar: {e}")

try:
    _iniciar_scheduler_backup()
except Exception as e:
    app.logger.warning(f"[SCHEDULER] Falha final: {e}")


# ──── IMPORTAÇÃO DE LEADS DO GOOGLE SHEETS ─────────────────────────────────
# Mapeamento de apelidos de consultores → nomes reais
CONSULTOR_ALIASES = {
    # Guilherme
    'guilherme': 'Guilherme',
    'guilherme santos': 'Guilherme',
    'gui': 'Guilherme',
    'gui santos': 'Guilherme',
    'gui2': 'Guilherme',
    'guilherme2': 'Guilherme',
    # Danilo
    'danilo': 'Danilo',
    'danilo sampaio': 'Danilo',
    'danilo2': 'Danilo',
    'danilo 2': 'Danilo',
    # Bianca
    'bianca': 'Bianca',
    'bianca sampaio': 'Bianca',
    'bianca2': 'Bianca',
    'bianca 2': 'Bianca',
    # Gabriel
    'gabriel': 'Gabriel',
    'gabriel maggiotto': 'Gabriel',
    'gabriel humberto maggiotto': 'Gabriel',
    'gabriel2': 'Gabriel',
    'gabriel 2': 'Gabriel',
    # Juliana (supervisora)
    'juliana': 'Juliana',
    # Jack / JACK
    'jack': 'Jack',
    'jack2': 'Jack',
}

def _normalizar_telefone(tel_raw):
    """
    Extrai só os dígitos do telefone e normaliza para o padrão brasileiro.
    Retorna apenas dígitos: '5519991046030' ou '19991046030'.
    Usado para comparação/dedup.
    """
    if not tel_raw:
        return ''
    import re
    dig = re.sub(r'\D', '', str(tel_raw))
    # Remove código do país 55 se tiver 12-13 dígitos (55 + DDD + número)
    if len(dig) >= 12 and dig.startswith('55'):
        dig = dig[2:]
    return dig

def _formatar_telefone(tel_raw):
    """
    Formata telefone para exibição bonita: (19) 99104-6030 ou (19) 3104-6030.
    Aceita qualquer formato de entrada (com 55, com traços, espaços, etc.).
    """
    if not tel_raw:
        return ''
    dig = _normalizar_telefone(tel_raw)
    if not dig:
        return str(tel_raw).strip()
    # Celular com DDD: 11 dígitos → (XX) XXXXX-XXXX
    if len(dig) == 11:
        return f'({dig[0:2]}) {dig[2:7]}-{dig[7:11]}'
    # Fixo com DDD: 10 dígitos → (XX) XXXX-XXXX
    if len(dig) == 10:
        return f'({dig[0:2]}) {dig[2:6]}-{dig[6:10]}'
    # Celular sem DDD: 9 dígitos → XXXXX-XXXX
    if len(dig) == 9:
        return f'{dig[0:5]}-{dig[5:9]}'
    # Fixo sem DDD: 8 dígitos → XXXX-XXXX
    if len(dig) == 8:
        return f'{dig[0:4]}-{dig[4:8]}'
    # Outros tamanhos: retorna os dígitos como estão
    return dig

def _normalizar_consultor(nome_raw):
    """Normaliza apelido/nome para o primeiro nome real. Retorna None se vazio."""
    if not nome_raw:
        return None
    nome_lower = nome_raw.strip().lower()
    # Tenta match exato no alias
    if nome_lower in CONSULTOR_ALIASES:
        return CONSULTOR_ALIASES[nome_lower]
    # Tenta pelo primeiro nome
    primeiro = nome_lower.split()[0] if nome_lower else ''
    if primeiro in CONSULTOR_ALIASES:
        return CONSULTOR_ALIASES[primeiro]
    # Se não achou alias, retorna o nome capitalizado (pode ser consultor novo)
    return nome_raw.strip().title() if nome_raw.strip() else None

def _buscar_responsavel_id(conn, consultor_nome):
    """
    Busca o ID do usuário responsável de forma FLEXÍVEL.
    Tenta: nome exato → primeiro nome (LIKE) → None.
    Funciona mesmo que o banco tenha 'Guilherme Santos' e a planilha diga 'GUILHERME'.
    """
    if not consultor_nome:
        return None
    nome = consultor_nome.strip()
    # 1) Match exato
    resp = conn.execute(
        "SELECT id FROM usuarios WHERE LOWER(nome) = LOWER(?) AND ativo=1 ORDER BY id LIMIT 1",
        (nome,)
    ).fetchone()
    if resp:
        return resp['id'] if hasattr(resp, 'keys') else resp[0]
    # 2) Primeiro nome via LIKE (ex.: 'Guilherme' casa com 'Guilherme Santos')
    primeiro = nome.split()[0] if nome else ''
    if primeiro:
        resp = conn.execute(
            "SELECT id FROM usuarios WHERE LOWER(nome) LIKE LOWER(?) AND ativo=1 ORDER BY id LIMIT 1",
            (primeiro + '%',)
        ).fetchone()
        if resp:
            return resp['id'] if hasattr(resp, 'keys') else resp[0]
    return None

# ─── DATAS: parsing flexível e formatação dd/mm/aaaa ─────────────────────────────
def _parse_data_lead(data_str):
    """
    Converte string de data da planilha em objeto date.
    Aceita múltiplos formatos: ISO, DD/MM/YYYY, YYYY-MM-DD, etc.
    Retorna None se não conseguir.
    """
    if not data_str:
        return None
    s = str(data_str).strip()
    if not s:
        return None

    # 1. ISO com T: 2026-04-19T02:09:58.778-03:00
    try:
        if 'T' in s:
            # Remove timezone e milissegundos
            parte_iso = s.split('T')[0]  # pega 2026-04-19
            a, m, d = parte_iso.split('-')
            return date(int(a), int(m), int(d))
    except Exception:
        pass

    # 2. DD/MM/YYYY [HH:MM:SS]
    try:
        parte_data = s.split()[0]  # remove hora se houver
        if '/' in parte_data and parte_data.count('/') == 2:
            partes = parte_data.split('/')
            if len(partes[2]) == 4:  # YYYY tem 4 dígitos
                d, m, a = partes
                return date(int(a), int(m), int(d))
    except Exception:
        pass

    # 3. YYYY-MM-DD [HH:MM:SS]
    try:
        parte_data = s.split()[0]  # remove hora se houver
        if '-' in parte_data and parte_data.count('-') == 2:
            a, m, d = parte_data.split('-')
            return date(int(a), int(m), int(d))
    except Exception:
        pass

    # Se chegou aqui e tem números, tenta extrair ano/mês/dia da forma que conseguir
    try:
        import re as _re
        nums = _re.findall(r'\d+', s)
        if len(nums) >= 3:
            # Tenta várias combinações
            # 1. DD MM YYYY
            if len(nums[2]) == 4:
                return date(int(nums[2]), int(nums[1]), int(nums[0]))
            # 2. YYYY MM DD
            elif len(nums[0]) == 4:
                return date(int(nums[0]), int(nums[1]), int(nums[2]))
    except Exception:
        pass

    return None

def _fmt_data_br(valor):
    """Formata qualquer data/datetime/string para dd/mm/aaaa. Vazio se não der."""
    if not valor:
        return ''
    # Se já é date/datetime
    if isinstance(valor, (datetime, date)):
        return valor.strftime('%d/%m/%Y')
    # String
    d = _parse_data_lead(str(valor))
    return d.strftime('%d/%m/%Y') if d else str(valor)[:10]

def _fmt_datahora_br(valor):
    """Formata para dd/mm/aaaa HH:MM."""
    if not valor:
        return ''
    if isinstance(valor, (datetime, date)):
        try:
            return valor.strftime('%d/%m/%Y %H:%M')
        except Exception:
            return valor.strftime('%d/%m/%Y')
    s = str(valor).replace('T', ' ')
    d = _parse_data_lead(s)
    if d:
        # tenta extrair hora
        hora = ''
        try:
            if ' ' in s and ':' in s:
                hora = ' ' + s.split()[1][:5]
        except Exception:
            pass
        return d.strftime('%d/%m/%Y') + hora
    return str(valor)[:16]

# Registra filtros Jinja para uso nos templates
try:
    app.jinja_env.filters['data_br'] = _fmt_data_br
    app.jinja_env.filters['datahora_br'] = _fmt_datahora_br
except Exception:
    pass

def _ler_google_sheets(sheet_id, aba):
    """Lê Google Sheets público como CSV. Retorna lista de dicts.
    IMPORTANTE: o nome da aba precisa ser URL-encoded — nomes com espaço
    ('LEADS GERAIS') ou acento ('Página1') quebram a urlopen sem o quote."""
    import csv
    from io import StringIO
    import urllib.request, urllib.parse
    try:
        aba_q = urllib.parse.quote(aba)
        url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv&sheet={aba_q}"
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (JOB Serenus)'})
        response = urllib.request.urlopen(req, timeout=15)
        csv_text = response.read().decode('utf-8-sig')
        reader = csv.DictReader(StringIO(csv_text))
        return list(reader) if reader else []
    except Exception as e:
        app.logger.error(f"[LEAD_IMPORT] Erro ao ler sheets {sheet_id}/{aba}: {e}")
        return []

def _listar_leads_do_sheets():
    """Lê ambas as planilhas (Facebook e Google) e retorna lista de leads brutos."""
    leads = []
    
    # Facebook: "LEADS GERAIS"
    facebook_id = '1VOChFfTkuVO4eO0FCAkBjrP9qDFnvWZnk5rLdUrNm64'
    facebook_leads = _ler_google_sheets(facebook_id, 'LEADS GERAIS')
    for row in facebook_leads:
        row['_origem'] = 'Facebook'
        leads.append(row)
    
    # Google: "Página1", "Página2" e "MEDSENIOR"
    google_id = '1QT8y8rfbMaHb5POrYFZKjdccpgMLLY3WRjBjxFmold8'
    for aba in ['Página1', 'Página2', 'MEDSENIOR']:
        google_leads = _ler_google_sheets(google_id, aba)
        for row in google_leads:
            row['_origem'] = f'Google ({aba})'
            leads.append(row)
    
    return leads

def _col(row, *names):
    """Primeiro valor não-vazio entre várias colunas possíveis (case-insensitive).
    As planilhas usam nomes diferentes: 'Celular' vs 'Whatsapp', 'Email' vs 'email',
    'CONSULTOR' vs 'Consultor', 'DATA e HORA' vs 'Data', etc."""
    low = {}
    for k, v in row.items():
        if k is not None:
            low[str(k).strip().lower()] = v
    for n in names:
        v = low.get(str(n).strip().lower())
        if v and str(v).strip():
            return str(v).strip()
    return ''


def _processar_lead(row, conn):
    """
    Processa um lead bruto da planilha:
    - Normaliza consultor
    - Filtra "teste"
    - Detecta duplicados
    - Retorna (sucesso, msg, dados_processados)
    """
    # Mapeamento FLEXÍVEL de colunas (cada planilha nomeia diferente)
    nome = _col(row, 'Nome', 'nome')
    telefone = _col(row, 'Celular', 'Whatsapp', 'WhatsApp', 'Telefone', 'Tel', 'Fone', 'Contato')
    email = _col(row, 'Email', 'email', 'E-mail', 'e-mail')
    cidade = _col(row, 'Cidade', 'Qual sua Cidade?', 'Qual sua cidade?', 'cidade')
    tipo = _col(row, 'Tipo', 'tipo') or 'PF'
    num_pessoas = _col(row, 'numero de pessoas', 'número de pessoas', 'Idades que tem interesse em cotar?', 'IDADE', 'Idade')
    consultor_raw = _col(row, 'CONSULTOR', 'Consultor', 'Consultor 2', 'consultor')
    data_hora_raw = _col(row, 'DATA e HORA', 'Data', 'data', 'Data e Hora')
    origem = row.get('_origem', 'Google Sheets')
    
    # Filtro 1: "teste" em nome ou email
    if nome and 'teste' in nome.lower():
        return (False, 'Ignorado (teste no nome)', None)
    if email and 'teste' in email.lower():
        return (False, 'Ignorado (teste no email)', None)
    
    # Normalizar consultor + busca FLEXÍVEL
    consultor = _normalizar_consultor(consultor_raw) or 'Guilherme'
    responsavel_id = _buscar_responsavel_id(conn, consultor)
    
    # Data do lead
    data_lead = _parse_data_lead(data_hora_raw)
    
    # Filtro 2: Duplicado (telefone ou email)
    if telefone:
        dup = conn.execute(
            "SELECT id FROM crm_leads WHERE telefone = ?",
            (telefone,)
        ).fetchone()
        if dup:
            return (False, f'Duplicado (tel {telefone})', None)
    
    if email:
        dup = conn.execute(
            "SELECT id FROM crm_leads WHERE email = ?",
            (email,)
        ).fetchone()
        if dup:
            return (False, f'Duplicado (email {email})', None)
    
    # Validação mínima
    if not nome:
        return (False, 'Nome vazio', None)
    
    return (True, 'OK', {
        'nome': nome,
        'telefone': telefone,
        'email': email,
        'empresa': cidade,
        'origem': origem,
        'etapa': 'topo',
        'responsavel_id': responsavel_id,
        'valor_estimado': None,
        'consultor_nome': consultor,
        'data_lead': data_lead.strftime('%Y-%m-%d 12:00:00') if data_lead else None,
        'observacoes': f"Tipo: {tipo}, Pessoas: {num_pessoas}".strip('Tipo: , Pessoas: ')
    })

@app.route('/crm/importar', methods=['GET', 'POST'])
@login_required
def crm_importar():
    """GET: mostra form com seletor de datas. POST: processa importação."""
    usuario = session.get('usuario')
    if session.get('perfil') != 'admin':
        return jsonify({'erro': 'Acesso negado'}), 403
    
    conn = db()
    
    if request.method == 'GET':
        # Buscar min/max datas nas planilhas
        leads_raw = _listar_leads_do_sheets()
        datas = []
        for row in leads_raw:
            data_str = row.get('DATA e HORA', '') or row.get('28/05/2026', '')
            if data_str:
                datas.append(data_str[:10])  # YYYY-MM-DD ou DD/MM/YYYY
        
        min_data = min(datas) if datas else '2026-01-01'
        max_data = max(datas) if datas else date.today().isoformat()
        
        html = f"""
        <html><head><title>Importar Leads</title>
        <style>
            body {{ font-family: Arial; background: #f4f6f9; padding: 40px; }}
            .container {{ max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }}
            h1 {{ color: #333; }}
            .form-group {{ margin: 20px 0; }}
            label {{ display: block; font-weight: bold; margin-bottom: 8px; color: #555; }}
            input, select {{ width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; }}
            button {{ background: #3b82f6; color: white; padding: 12px 20px; border: none; border-radius: 4px; cursor: pointer; font-size: 16px; }}
            button:hover {{ background: #2563eb; }}
            .info {{ background: #e3f2fd; padding: 15px; border-radius: 4px; margin: 20px 0; color: #1976d2; }}
        </style>
        </head><body>
        <div class="container">
            <h1>Importar Leads das Planilhas</h1>
            <form method="POST">
                <div class="info">
                    ✓ Facebook (aba "LEADS GERAIS")<br>
                    ✓ Google (abas "Página1" + "MEDSENIOR")<br><br>
                    <strong>Filtros automáticos:</strong> remove "teste" + duplicados (tel/email)
                </div>
                
                <div class="form-group">
                    <label>Data Inicial:</label>
                    <input type="date" name="data_inicio" required value="{min_data}">
                </div>
                
                <div class="form-group">
                    <label>Data Final:</label>
                    <input type="date" name="data_fim" required value="{max_data}">
                </div>
                
                <div class="form-group">
                    <button type="submit">Importar Leads</button>
                </div>
            </form>
            <p style="margin-top: 30px; text-align: center;">
                <a href="/crm" style="color: #3b82f6; text-decoration: none;">← Voltar ao CRM</a>
            </p>
        </div>
        </body></html>
        """
        close_db(conn)
        return html
    
    # POST: processar importação
    data_inicio = request.form.get('data_inicio', '')
    data_fim = request.form.get('data_fim', '')
    
    if not data_inicio or not data_fim:
        close_db(conn)
        return jsonify({'erro': 'Datas obrigatórias'}), 400
    
    # Parse datas (YYYY-MM-DD)
    try:
        di = datetime.strptime(data_inicio, '%Y-%m-%d').date()
        df = datetime.strptime(data_fim, '%Y-%m-%d').date()
    except:
        close_db(conn)
        return jsonify({'erro': 'Formato de data inválido'}), 400
    
    # Ler planilhas
    leads_raw = _listar_leads_do_sheets()
    
    total = 0
    importados = 0
    ignorados = []
    
    for row in leads_raw:
        # Parse data da linha
        data_str = row.get('DATA e HORA', '')
        if not data_str:
            continue
        
        # Tentar vários formatos
        data_lead = None
        for fmt in ['%Y-%m-%dT%H:%M:%S.%f%z', '%d/%m/%Y %H:%M', '%d/%m/%Y']:
            try:
                data_lead = datetime.strptime(data_str[:19], fmt.split('T')[0] if 'T' in fmt else fmt).date()
                break
            except:
                pass
        
        if not data_lead:
            continue
        
        # Filtrar por intervalo de datas
        if not (di <= data_lead <= df):
            continue
        
        total += 1
        sucesso, msg, dados = _processar_lead(row, conn)
        
        if sucesso:
            try:
                conn.execute(
                    """INSERT INTO crm_leads 
                       (nome, telefone, email, empresa, origem, etapa, responsavel_id, valor_estimado, observacoes)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (dados['nome'], dados['telefone'], dados['email'], dados['empresa'],
                     dados['origem'], dados['etapa'], dados['responsavel_id'],
                     dados['valor_estimado'], dados['observacoes'])
                )
                importados += 1
            except Exception as e:
                ignorados.append(f"{dados['nome']}: {str(e)}")
        else:
            ignorados.append(f"{row.get('Nome', 'SEM NOME')}: {msg}")
    
    conn.commit()
    close_db(conn)
    
    html = f"""
    <html><head><title>Resultado da Importação</title>
    <style>
        body {{ font-family: Arial; background: #f4f6f9; padding: 40px; }}
        .container {{ max-width: 700px; margin: 0 auto; background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }}
        h1 {{ color: #333; }}
        .stats {{ display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 30px 0; }}
        .stat {{ background: #f0f4f8; padding: 20px; border-radius: 6px; text-align: center; }}
        .stat-num {{ font-size: 32px; font-weight: bold; color: #3b82f6; }}
        .stat-label {{ color: #666; margin-top: 8px; }}
        .ignorados {{ background: #fff3cd; padding: 15px; border-radius: 6px; max-height: 300px; overflow-y: auto; }}
        .ignorados p {{ margin: 5px 0; font-size: 13px; color: #856404; }}
        a {{ color: #3b82f6; text-decoration: none; }}
        a:hover {{ text-decoration: underline; }}
    </style>
    </head><body>
    <div class="container">
        <h1>Importação Concluída</h1>
        <div class="stats">
            <div class="stat">
                <div class="stat-num">{importados}</div>
                <div class="stat-label">Leads Importados</div>
            </div>
            <div class="stat">
                <div class="stat-num">{len(ignorados)}</div>
                <div class="stat-label">Ignorados/Duplicados</div>
            </div>
        </div>
        
        <p><strong>Período:</strong> {data_inicio} até {data_fim}</p>
        <p><strong>Total analisado:</strong> {total}</p>
        
        {f'<div class="ignorados"><strong>Ignorados:</strong>' + ''.join(f'<p>• {ig}</p>' for ig in ignorados[:20]) + (f'<p><em>... e mais {len(ignorados)-20}</em></p>' if len(ignorados) > 20 else '') + '</div>' if ignorados else ''}
        
        <p style="margin-top: 30px; text-align: center;">
            <a href="/crm">← Voltar ao CRM</a>
        </p>
    </div>
    </body></html>
    """
    
    return html

if __name__ == '__main__':
    import os
    # init_db() já roda no import acima
    print("\n" + "="*52)
    print("  JOB · Serenus Corretora · v14")
    print("="*52)
    port = int(os.environ.get('PORT', 8080))
    print(f"  Rodando na porta {port}")
    print("  Admin:  guilherme@serenuscorretora.com.br / serenus2025")
    print("="*52 + "\n")
    app.run(debug=False, host='0.0.0.0', port=port)

# ─── DEBUG INFO PARA PRODUÇÃO ────────────────────────────────────────────
print(f"\n[STARTUP] DATABASE_URL: {os.environ.get('DATABASE_URL', 'NÃO ENCONTRADA')[:80]}")
print(f"[STARTUP] HAS_POSTGRES: {HAS_POSTGRES}")
print(f"[STARTUP] Modo BD selecionado: {DB_MODE.upper()}")
if DB_MODE == 'postgres':
    db_url = os.environ.get('DATABASE_URL', '')
    print(f"[STARTUP] PostgreSQL: {db_url[:60]}..." if db_url else "[STARTUP] PostgreSQL: NÃO CONFIGURADO")
else:
    print(f"[STARTUP] SQLite: {DB}")
