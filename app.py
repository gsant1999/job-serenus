import os, sqlite3, json, hashlib, secrets, re
from flask import Flask, render_template, request, jsonify, redirect, url_for, session, flash, send_from_directory, abort
from datetime import datetime, timedelta, date
from functools import wraps
from dateutil.relativedelta import relativedelta

# ─── SUPORTE A PostgreSQL (Railway/Supabase) ──────────────────────────────────
try:
    import psycopg2, psycopg2.extras, psycopg2.pool
    HAS_POSTGRES = True
except ImportError:
    HAS_POSTGRES = False

# ─── GOOGLE DRIVE ─────────────────────────────────────────────────────────────
# Suporta DOIS modos:
#  1) OAuth (RECOMENDADO p/ Gmail comum): usa token_drive.json (gerado por gerar_token_drive.py).
#     Sobe os arquivos COMO VOCÊ, usando seus 15GB. Resolve o erro de cota da conta de serviço.
#  2) Service Account: só funciona com Drive Compartilhado (Workspace pago).
try:
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaFileUpload
    from google.oauth2.service_account import Credentials as SACredentials
    from google.oauth2.credentials import Credentials as UserCredentials
    from google.auth.transport.requests import Request as GoogleRequest
    _GDIR = os.path.dirname(os.path.abspath(__file__))
    DRIVE_TOKEN_FILE = os.path.join(_GDIR, "token_drive.json")          # OAuth (preferido)
    DRIVE_CREDENTIALS_FILE = os.path.join(_GDIR, "serenus-job-5ed98225e711.json")  # Service Account
    DRIVE_FOLDER_ID = "1Hb0prM75_L-t2SOfN_KMS_W5r_D3dLsl"
    DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive"]
    DRIVE_OAUTH = os.path.exists(DRIVE_TOKEN_FILE)
    DRIVE_ENABLED = DRIVE_OAUTH or os.path.exists(DRIVE_CREDENTIALS_FILE)
except ImportError:
    DRIVE_ENABLED = False; DRIVE_OAUTH = False

def _drive_service():
    """Retorna o serviço do Drive. Prefere OAuth (cota do usuário); cai p/ service account."""
    if DRIVE_OAUTH:
        creds = UserCredentials.from_authorized_user_file(DRIVE_TOKEN_FILE, DRIVE_SCOPES)
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(GoogleRequest())
            with open(DRIVE_TOKEN_FILE, 'w') as f: f.write(creds.to_json())
        return build("drive", "v3", credentials=creds)
    creds = SACredentials.from_service_account_file(DRIVE_CREDENTIALS_FILE, scopes=DRIVE_SCOPES)
    return build("drive", "v3", credentials=creds)

def upload_drive(caminho_local, nome_arquivo, subpasta_nome=None):
    """Upload p/ o Drive. Cria subpasta (cliente) se necessário.
    Retorna {'ok':bool,'id'|'erro':...}."""
    if not DRIVE_ENABLED:
        return {'ok': False, 'erro': 'Drive não configurado'}
    if not os.path.exists(caminho_local):
        return {'ok': False, 'erro': f'Arquivo local não encontrado: {caminho_local}'}
    try:
        service = _drive_service()
        pasta_destino = DRIVE_FOLDER_ID
        if subpasta_nome:
            safe = subpasta_nome.replace("'", " ")
            query = (f"name='{safe}' and mimeType='application/vnd.google-apps.folder' "
                     f"and '{DRIVE_FOLDER_ID}' in parents and trashed=false")
            res = service.files().list(q=query, fields="files(id)",
                                       supportsAllDrives=True, includeItemsFromAllDrives=True).execute()
            if res.get('files'):
                pasta_destino = res['files'][0]['id']
            else:
                meta = {"name": safe, "mimeType": "application/vnd.google-apps.folder", "parents": [DRIVE_FOLDER_ID]}
                pasta = service.files().create(body=meta, fields="id", supportsAllDrives=True).execute()
                pasta_destino = pasta['id']
        file_meta = {"name": nome_arquivo, "parents": [pasta_destino]}
        media = MediaFileUpload(caminho_local, resumable=True)
        f = service.files().create(body=file_meta, media_body=media, fields="id",
                                   supportsAllDrives=True).execute()
        print(f"[Drive] OK ({'OAuth' if DRIVE_OAUTH else 'SA'}): {nome_arquivo} → {f.get('id')}")
        return {'ok': True, 'id': f.get("id")}
    except Exception as e:
        msg = str(e)
        if ('storageQuotaExceeded' in msg or 'quota' in msg.lower()) and not DRIVE_OAUTH:
            print("[Drive] ERRO DE COTA: a conta de serviço não tem armazenamento. "
                  "Gere o token OAuth com 'python3 gerar_token_drive.py' para subir como você (15GB).")
        else:
            print(f"[Drive] Erro: {msg}")
        return {'ok': False, 'erro': msg}

app = Flask(__name__)
# ─── CHAVE SECRETA FIXA PARA SESSÕES PERSISTENTES ───────────────────────
# Se usar secrets.token_hex(32) toda vez, a session cai após restart!
app.secret_key = os.environ.get('SECRET_KEY') or 'serenus-job-secret-key-2025-fixo-para-sessoes'
app.config['SESSION_COOKIE_SECURE'] = True  # HTTPS only
app.config['SESSION_COOKIE_HTTPONLY'] = True  # Sem acesso JS
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'  # CSRF protection
app.config['PERMANENT_SESSION_LIFETIME'] = 86400 * 30  # 30 dias

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

@app.template_filter('from_json')
def _from_json(s):
    try: return json.loads(s) if s else []
    except: return []
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# ─── PERSISTÊNCIA: dados em pasta FIXA no computador, fora das pastas de versão ───
# Assim os dados NUNCA somem ao trocar de versão. Pode sobrescrever via variável de ambiente.
DATA_DIR = os.environ.get("JOB_DATA_DIR") or os.path.join(os.path.expanduser("~"), "JOB_Serenus_Dados")
# Se /data/job.db existe e tem dados, usa /data. Senão volta pro home.
if not os.path.exists(os.path.join(DATA_DIR, 'job.db')):
    alt_data = '/data'
    if os.path.exists(os.path.join(alt_data, 'job.db')):
        DATA_DIR = alt_data
os.makedirs(DATA_DIR, exist_ok=True)
DB = os.path.join(DATA_DIR, "job.db")
UPLOAD_FOLDER = os.path.join(DATA_DIR, "anexos")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# ─── MODO DO BANCO: PostgreSQL (Railway) ou SQLite (local) ──────────────────
DB_MODE = 'postgres' if (os.environ.get('DATABASE_URL') and HAS_POSTGRES) else 'sqlite'
_pg_pool = None

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

def db():
    """Retorna conexão ao banco. PostgreSQL na nuvem, SQLite localmente."""
    global _pg_pool
    if DB_MODE == 'postgres':
        if _pg_pool is None:
            try:
                url = _build_pg_url(os.environ['DATABASE_URL'])
                _pg_pool = psycopg2.pool.SimpleConnectionPool(1, 5, url)
                print("[DB] ✅ PostgreSQL conectado!")
            except Exception as e:
                print(f"[DB] ⚠️ Postgres falhou ({e}), usando SQLite como fallback")
                return _sqlite_conn()
        try:
            conn = _pg_pool.getconn()
            conn.autocommit = False
            return conn
        except Exception as e:
            print(f"[DB] ⚠️ Pool falhou ({e}), usando SQLite")
            return _sqlite_conn()
    return _sqlite_conn()

def _sqlite_conn():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    return conn

def close_db(conn):
    """Fecha conexão respeitando o modo."""
    global _pg_pool
    if DB_MODE == 'postgres' and _pg_pool:
        _pg_pool.putconn(conn)
    else:
        conn.close()

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
        ]
        for sql in tables_sql:
            try: cur.execute(sql)
            except: pass
        conn.commit()
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
        CREATE TABLE IF NOT EXISTS webhook_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            evento_id TEXT UNIQUE,
            evento TEXT,
            processado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
    
    conn.execute("INSERT OR IGNORE INTO config (chave,valor) VALUES (?,?)", 
        ('affinity_destinatarios', 'pamela.lima@affinitycorretora.com.br, kaique.silva@affinitycorretora.com.br, equipe.pl@affinitycorretora.com.br'))
    conn.execute("INSERT OR IGNORE INTO config (chave,valor) VALUES (?,?)",
        ('affinity_contato', 'Pamela'))
    conn.execute("INSERT OR IGNORE INTO config (chave,valor) VALUES (?,?)",
        ('affinity_remetente', 'guilherme@serenuscorretora.com.br'))
    
    # Etiquetas padrão
    etq_default = [('Renovação','#3b82f6'),('Reajuste','#fb923c'),('Pós-venda','#1fd8a4'),
                   ('Campanha','#8b5cf6'),('Atenção estorno','#f43f7c'),('Indicação','#facc15')]
    for nome, cor in etq_default:
        conn.execute("INSERT OR IGNORE INTO etiquetas (nome,cor) VALUES (?,?)", (nome, cor))
    
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
        conn.execute("""INSERT INTO usuarios (nome,email,senha_hash,perfil,regime_base)
            VALUES (?,?,?,?,?)""",
            ('Guilherme Santos','guilherme@serenuscorretora.com.br',hashlib.sha256("serenus2025".encode()).hexdigest(),'admin','com_fixo_lead'))
    
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
    ]

    if not is_pg:
        for tabela, coluna, tipo in migracoes:
            try:
                conn.execute(f"ALTER TABLE {tabela} ADD COLUMN {coluna} {tipo}")
            except Exception:
                pass  # Coluna já existe
        conn.commit()

    conn.close()



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


def calc_comissao(operadora, regime_base, prod_acumulada, valor_venda, modalidade='', tipo_pessoa=''):
    """Motor de comissão — lê de recebimento (corretora) + repasse_corretor (consultor).
    Tudo em NÚMERO DE MENSALIDADES (1.8 = 1,8 mensalidade = 180%). Sem dividir por 100."""
    conn = _sqlite_conn()
    valor = float(valor_venda or 0)
    op_nome, op_obs = _split_operadora(operadora)
    plano = _plano_from_modalidade(modalidade, tipo_pessoa)

    # ─── 1) Recebimento da corretora (mensalidades) ───
    receb = conn.execute(
        "SELECT total FROM recebimento WHERE operadora=? AND obs=? AND plano=?",
        (op_nome, op_obs, plano)).fetchone()
    if not receb:
        receb = conn.execute(
            "SELECT total FROM recebimento WHERE operadora=? AND plano=? ORDER BY (obs='') DESC LIMIT 1",
            (op_nome, plano)).fetchone()
    receb_mens = float(receb['total']) if receb else 0.0
    total_corretora = round(valor * receb_mens, 2)

    # ─── GESTOR VENDEDOR: leva 100% da corretora ───
    if regime_base == 'gestor_vendedor':
        conn.close()
        regua = [receb_mens] if receb_mens else [1.0]
        return {
            'codigo': 'gestor_vendedor', 'modelo': 'gestor_vendedor', 'nivel': '', 'plano': plano,
            'num_parcelas': 1, 'dist_corretora': str(receb_mens or 1.0),
            'regua_mens': regua, 'receb_mens': receb_mens, 'rep_mens': receb_mens, 'taxa': 0,
            'valor': valor, 'total_corretora': total_corretora,
            'consultor': total_corretora, 'liquido': 0.0,
        }

    # ─── 2) Modelo + nível ───
    modelo = REGIME_TO_MODELO.get(regime_base, 'sem_lead_sem_fixo')
    nivel = ''
    if modelo == 'com_lead':
        nivel = regime_base if regime_base in ('n1', 'n2', 'n3') else _nivel_por_producao(prod_acumulada, conn)

    # ─── 3) Repasse ao corretor (mensalidades + régua) ───
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
    consultor = round(valor * rep_mens, 2)
    liquido = round(total_corretora - consultor, 2)

    # ─── 4) Régua de parcelas (mensalidades por parcela) ───
    regua = [float(x) for x in regua_str.split(';') if x.strip()]
    if not regua:
        regua = [rep_mens] if rep_mens else [0.0]

    conn.close()
    avisos = []
    if receb_mens == 0:
        avisos.append(f"Falta cadastrar o RECEBIMENTO da corretora para {op_nome} / {plano}")
    if rep_mens == 0:
        avisos.append(f"Falta cadastrar o REPASSE ao corretor para {op_nome} / {plano} / {MODELO_NOME.get(modelo, modelo)}{(' / ' + nivel.upper()) if nivel else ''}")

    return {
        'codigo': nivel or modelo, 'modelo': modelo, 'nivel': nivel, 'plano': plano,
        'num_parcelas': len(regua), 'dist_corretora': regua_str or ';'.join(str(x) for x in regua),
        'regua_mens': regua, 'receb_mens': receb_mens, 'rep_mens': rep_mens, 'taxa': taxa,
        'valor': valor, 'total_corretora': total_corretora,
        'consultor': consultor, 'liquido': liquido,
        'aviso': ' · '.join(avisos),
    }


def gerar_parcelas(proposta_id, vigencia, c, dia_vencimento=None):
    """Gera parcelas usando a régua REAL (mensalidades por parcela).
    Parcela consultor i = valor × regua[i]. Corretora distribuída proporcional à régua."""
    from dateutil.relativedelta import relativedelta
    try:
        base = datetime.strptime(vigencia[:7], '%Y-%m') if (vigencia and len(vigencia) >= 7) else datetime.now().replace(day=1)
    except Exception:
        base = datetime.now().replace(day=1)

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
        val_c = round(valor * mens, 2)                          # consultor nesta parcela
        val_cor = round(total_cor * (mens / soma_regua), 2)     # corretora proporcional
        perc = round((mens / soma_regua) * 100, 2)
        parcelas.append({
            'proposta_id': proposta_id, 'numero': i + 1, 'percentual': perc,
            'valor': val_c, 'valor_corretora': val_cor, 'perc_cliente': perc,
            'data_prevista': data, 'status': 'Pendente de receber',
            'competencia': mes_ref.strftime('%Y-%m'), 'mensalidade_ref': i + 1,
        })
    return parcelas



# ─── AUTH ────────────────────────────────────────────────────────────────────────
def hash_senha(s): return hashlib.sha256(s.encode()).hexdigest()

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

ASAAS_API_KEY = os.environ.get('ASAAS_API_KEY', '')
# Detecta automaticamente sandbox vs produção pelo prefixo da chave
if ASAAS_API_KEY.startswith('$aact_prod') or ASAAS_API_KEY.startswith('aact_prod'):
    ASAAS_BASE_URL = 'https://api.asaas.com/v3'
else:
    ASAAS_BASE_URL = os.environ.get('ASAAS_BASE_URL', 'https://api-sandbox.asaas.com/v3')

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
    conn.close()
    
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
        conn.close()
        
        return jsonify({
            "ok": True, 
            "msg": f"✅ Backup carregado: {n_props} propostas, {n_parcs} parcelas",
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
    conn.close()
    
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
    conn.close()
    
    data = {
        "timestamp": datetime.now().isoformat(),
        "propostas": [dict(p) for p in props],
        "parcelas": [dict(p) for p in parc],
    }
    resp = jsonify(data)
    resp.headers['Content-Disposition'] = f'attachment; filename="job_emergencia_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json"'
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
        conn.close(); return jsonify({"ok": False, "erro": "Parcela não encontrada"}), 404
    if parc['status'] != 'Liberado para o corretor':
        conn.close(); return jsonify({"ok": False, "erro": "Só é possível pagar parcelas liberadas para o corretor"}), 400
    if parc['asaas_transfer_id']:
        conn.close(); return jsonify({"ok": False, "erro": "Esta parcela já tem um pagamento Asaas iniciado"}), 400

    consultor = conn.execute("SELECT chave_pix, nome FROM usuarios WHERE id=?", (parc['usuario_id'],)).fetchone()
    chave_pix = (consultor['chave_pix'] if consultor else '') or ''
    if not chave_pix.strip():
        conn.close(); return jsonify({"ok": False, "erro": f"{parc['consultor']} não tem chave PIX cadastrada. Cadastre em Usuários."}), 400

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
        conn.commit(); conn.close()
        return jsonify({"ok": True, "transfer_id": data['id'], "status": data.get('status')})
    else:
        erro_msg = data.get('_erro')
        if not erro_msg and data.get('errors'):
            erro_msg = '; '.join([e.get('description', str(e)) for e in data['errors']])
        conn.execute("UPDATE parcelas SET asaas_erro=? WHERE id=?", (str(erro_msg)[:300], pid))
        conn.commit(); conn.close()
        return jsonify({"ok": False, "erro": erro_msg or "Erro desconhecido do Asaas", "status": status}), 400


@app.route('/webhook/asaas', methods=['POST'])
def webhook_asaas():
    """Recebe eventos do Asaas (status de transferências e cobranças)."""
    try:
        data = request.get_json(force=True) or {}
        evento_id = data.get('id')  # ID único do evento do Asaas
        evento = data.get('event', '')
        
        if not evento_id:
            return jsonify({"ok": True}), 200  # Ignora webhooks sem ID
        
        conn = db()
        
        # Idempotência: verifica se já processou este webhook
        já_proc = conn.execute("SELECT 1 FROM webhook_log WHERE evento_id=?", (evento_id,)).fetchone()
        if já_proc:
            conn.close()
            return jsonify({"ok": True, "duplicado": True}), 200  # Webhook duplicado, ignora

        if evento.startswith('TRANSFER_'):
            transfer = data.get('transfer', {})
            transfer_id = transfer.get('id')
            novo_status = transfer.get('status')
            if transfer_id:
                parc = conn.execute("SELECT id, proposta_id FROM parcelas WHERE asaas_transfer_id=?", (transfer_id,)).fetchone()
                if parc:
                    conn.execute("UPDATE parcelas SET asaas_status=? WHERE id=?", (novo_status, parc['id']))
                    if evento == 'TRANSFER_DONE':
                        conn.execute("""UPDATE parcelas SET status='Pago ao corretor', data_pagamento=? WHERE id=?""",
                                     (transfer.get('effectiveDate') or datetime.now().strftime('%Y-%m-%d'), parc['id']))
                        conn.execute("""INSERT INTO historico_proposta (proposta_id, usuario_nome, campo, valor_antes, valor_depois)
                                        VALUES (?,?,?,?,?)""",
                                     (parc['proposta_id'], 'Asaas (webhook)', 'Status do pagamento', 'Pendente', 'Pago ao corretor (PIX confirmado)'))
                    elif evento in ('TRANSFER_FAILED', 'TRANSFER_CANCELLED'):
                        motivo = transfer.get('failReason') or 'Transferência falhou ou foi cancelada'
                        conn.execute("UPDATE parcelas SET asaas_erro=? WHERE id=?", (str(motivo)[:300], parc['id']))
                    conn.commit()

        elif evento.startswith('PAYMENT_'):
            # Reservado para uso futuro (cobranças recebidas de clientes)
            pass

        # Registra webhook processado
        conn.execute("INSERT INTO webhook_log (evento_id, evento) VALUES (?,?)", (evento_id, evento))
        conn.commit()
        conn.close()
        return jsonify({"ok": True}), 200
    except Exception as e:
        return jsonify({"ok": False, "erro": str(e)}), 200  # 200 para o Asaas não reenviar em loop



# ─── SERVIR ARQUIVOS (contratos, comprovantes) ──────────────────────────────────
@app.route('/anexos/<path:nome>')
@login_required
def servir_anexo(nome):
    nome = os.path.basename(nome)
    if not os.path.exists(os.path.join(UPLOAD_FOLDER, nome)):
        abort(404)
    return send_from_directory(UPLOAD_FOLDER, nome)

@app.route('/login', methods=['GET','POST'])
def login():
    if request.method == 'POST':
        email = request.form.get('email','').strip().lower()
        senha = hash_senha(request.form.get('senha',''))
        conn = db()
        u = conn.execute("SELECT * FROM usuarios WHERE email=? AND senha_hash=? AND ativo=1",(email,senha)).fetchone()
        conn.close()
        if u:
            session.update({'user_id':u['id'],'nome':u['nome'],'perfil':u['perfil'],'regime_base':u['regime_base'],'foto':u['foto'] or ''})
            return redirect(url_for('dashboard'))
        flash('E-mail ou senha incorretos.')
    return render_template('login.html')

@app.route('/logout')
def logout():
    session.clear(); return redirect(url_for('login'))

@app.route('/setup/<token>', methods=['GET','POST'])
def setup_senha(token):
    conn = db()
    u = conn.execute("SELECT * FROM usuarios WHERE token_setup=? AND ativo=1",(token,)).fetchone()
    if not u: conn.close(); return render_template('setup_senha.html', erro='Link inválido ou já utilizado.')
    expira = datetime.fromisoformat(u['token_expira']) if u['token_expira'] else None
    if expira and expira < datetime.now(): conn.close(); return render_template('setup_senha.html', erro='Link expirado.')
    if request.method == 'POST':
        s1=request.form.get('senha',''); s2=request.form.get('senha2','')
        if len(s1)<6: conn.close(); return render_template('setup_senha.html',usuario=u,erro='Mínimo 6 caracteres.')
        if s1!=s2: conn.close(); return render_template('setup_senha.html',usuario=u,erro='Senhas não conferem.')
        conn.execute("UPDATE usuarios SET senha_hash=?,token_setup=NULL,token_expira=NULL WHERE id=?",(hash_senha(s1),u['id']))
        conn.commit(); conn.close(); flash('Senha criada! Faça login.'); return redirect(url_for('login'))
    conn.close()
    return render_template('setup_senha.html', usuario=u)

# ─── DASHBOARD ───────────────────────────────────────────────────────────────────
@app.route('/')
@login_required
def dashboard():
    conn = db(); uid = session['user_id']
    if session['perfil'] == 'admin':
        m = {}
        m['propostas'] = conn.execute("SELECT COUNT(*) c FROM propostas").fetchone()['c']
        m['vidas'] = conn.execute("SELECT COALESCE(SUM(total_vidas),0) v FROM propostas").fetchone()['v']
        m['producao'] = conn.execute("SELECT COALESCE(SUM(valor),0) v FROM propostas").fetchone()['v']
        m['com_bruta'] = conn.execute("SELECT COALESCE(SUM(comissao_total_corretora),0) v FROM propostas").fetchone()['v']
        m['com_repasse'] = conn.execute("SELECT COALESCE(SUM(comissao_consultor),0) v FROM propostas").fetchone()['v']
        m['com_liquido'] = conn.execute("SELECT COALESCE(SUM(comissao_corretora_liquida),0) v FROM propostas").fetchone()['v']
        # Fluxo de caixa (parcelas)
        m['fc_pendente'] = conn.execute("SELECT COALESCE(SUM(valor),0) v FROM parcelas WHERE status='Pendente de receber'").fetchone()['v']
        m['fc_caixa'] = conn.execute("SELECT COALESCE(SUM(valor),0) v FROM parcelas WHERE status='Recebido e não repassado'").fetchone()['v']
        m['fc_liberado'] = conn.execute("SELECT COALESCE(SUM(valor),0) v FROM parcelas WHERE status='Liberado para o corretor'").fetchone()['v']
        m['fc_pago'] = conn.execute("SELECT COALESCE(SUM(valor),0) v FROM parcelas WHERE status='Pago ao corretor'").fetchone()['v']
        m['fc_antecip'] = conn.execute("SELECT COUNT(*) c FROM parcelas WHERE status='Antecipação - Aguardando ADM'").fetchone()['c']
        ultimas = conn.execute("SELECT * FROM propostas ORDER BY id DESC LIMIT 5").fetchall()
        por_operadora = conn.execute("""SELECT adm_operadora,COUNT(*) qtd,COALESCE(SUM(valor),0) valor
            FROM propostas GROUP BY adm_operadora ORDER BY valor DESC LIMIT 8""").fetchall()
        por_consultor = conn.execute("""SELECT consultor,COUNT(*) qtd,COALESCE(SUM(valor),0) valor,COALESCE(SUM(comissao_consultor),0) com
            FROM propostas GROUP BY consultor ORDER BY valor DESC""").fetchall()
        conn.close()
        return render_template('dashboard_admin.html', m=m, ultimas=ultimas,
                               por_operadora=por_operadora, por_consultor=por_consultor,
                               ciclo=ciclo_atual())
    else:
        m = {}
        m['propostas'] = conn.execute("SELECT COUNT(*) c FROM propostas WHERE usuario_id=?",(uid,)).fetchone()['c']
        m['vidas'] = conn.execute("SELECT COALESCE(SUM(total_vidas),0) v FROM propostas WHERE usuario_id=?",(uid,)).fetchone()['v']
        m['producao'] = conn.execute("SELECT COALESCE(SUM(valor),0) v FROM propostas WHERE usuario_id=?",(uid,)).fetchone()['v']
        m['minha_comissao'] = conn.execute("SELECT COALESCE(SUM(comissao_consultor),0) v FROM propostas WHERE usuario_id=?",(uid,)).fetchone()['v']
        ma = datetime.now().strftime('%Y-%m')
        m['mes_propostas'] = conn.execute("SELECT COUNT(*) c FROM propostas WHERE usuario_id=? AND strftime('%Y-%m',criado_em)=?",(uid,ma)).fetchone()['c']
        m['mes_producao'] = conn.execute("SELECT COALESCE(SUM(valor),0) v FROM propostas WHERE usuario_id=? AND strftime('%Y-%m',criado_em)=?",(uid,ma)).fetchone()['v']
        m['mes_comissao'] = conn.execute("SELECT COALESCE(SUM(comissao_consultor),0) v FROM propostas WHERE usuario_id=? AND strftime('%Y-%m',criado_em)=?",(uid,ma)).fetchone()['v']
        # Saldo do consultor por status de parcelas
        m['a_receber'] = conn.execute("""SELECT COALESCE(SUM(pa.valor),0) v FROM parcelas pa
            JOIN propostas p ON p.id=pa.proposta_id WHERE p.usuario_id=? AND pa.status='Liberado para o corretor'""",(uid,)).fetchone()['v']
        m['pago_total'] = conn.execute("""SELECT COALESCE(SUM(pa.valor),0) v FROM parcelas pa
            JOIN propostas p ON p.id=pa.proposta_id WHERE p.usuario_id=? AND pa.status='Pago ao corretor'""",(uid,)).fetchone()['v']
        m['antecip_solicitadas'] = conn.execute("""SELECT COUNT(*) c FROM parcelas pa
            JOIN propostas p ON p.id=pa.proposta_id WHERE p.usuario_id=? AND pa.comprovante_antecipacao IS NOT NULL""",(uid,)).fetchone()['c']
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
        # Parcelas liberadas aguardando aceite
        pendentes_aceite = conn.execute("""SELECT pa.*, p.razao_social, p.adm_operadora FROM parcelas pa
            JOIN propostas p ON p.id=pa.proposta_id
            WHERE p.usuario_id=? AND pa.status='Liberado para o corretor' AND pa.aceite_corretor=0
            ORDER BY pa.id""",(uid,)).fetchall()
        ultimas = conn.execute("SELECT * FROM propostas WHERE usuario_id=? ORDER BY id DESC LIMIT 5",(uid,)).fetchall()
        por_operadora = conn.execute("""SELECT adm_operadora,COUNT(*) qtd,COALESCE(SUM(valor),0) valor
            FROM propostas WHERE usuario_id=? GROUP BY adm_operadora ORDER BY valor DESC LIMIT 6""",(uid,)).fetchall()
        conn.close()
        return render_template('dashboard_consultor.html', m=m, ultimas=ultimas,
                               por_operadora=por_operadora, pendentes_aceite=pendentes_aceite)

# ─── PROPOSTAS ───────────────────────────────────────────────────────────────────
@app.route('/nova-proposta')
@login_required
def nova_proposta():
    conn = db()
    sups = conn.execute("SELECT * FROM supervisoras WHERE ativo=1 ORDER BY nome").fetchall()
    ops = conn.execute("SELECT DISTINCT operadora FROM recebimento ORDER BY operadora").fetchall()
    conn.close()
    return render_template('form.html', supervisoras=sups, operadoras=[o['operadora'] for o in ops])

@app.route('/salvar-proposta', methods=['POST'])
@login_required
def salvar_proposta():
    try:
        d = request.form
        razao_pasta = (d.get('razao_social') or 'sem_nome')[:40].strip().replace('/', '-')

        def salvar_arquivo(file_field, prefixo):
            """Salva um único arquivo e sobe pro Drive. Retorna o nome ou None."""
            f = request.files.get(file_field)
            if f and f.filename:
                n = f"{datetime.now().strftime('%Y%m%d%H%M%S')}_{prefixo}_{f.filename}"
                caminho = os.path.join(UPLOAD_FOLDER, n)
                f.save(caminho)
                upload_drive(caminho, n, subpasta_nome=razao_pasta)
                return n
            return None

        # Anexos genéricos (múltiplos)
        nomes = []
        for f in request.files.getlist('anexos'):
            if f and f.filename:
                n = f"{datetime.now().strftime('%Y%m%d%H%M%S')}_doc_{f.filename}"
                caminho = os.path.join(UPLOAD_FOLDER, n)
                f.save(caminho); nomes.append(n)
                upload_drive(caminho, n, subpasta_nome=razao_pasta)

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
        ma = datetime.now().strftime('%Y-%m')
        # Produção do mês ANTES desta venda + esta venda = produção que define o nível.
        # (Regra: o nível é o da produção do dia em que a venda subiu, incluindo ela.)
        prod_antes = cur.execute("SELECT COALESCE(SUM(valor),0) v FROM propostas WHERE usuario_id=? AND strftime('%Y-%m',criado_em)=?",(session['user_id'],ma)).fetchone()['v']
        prod_acumulada = prod_antes + valor
        c = calc_comissao(operadora, regime_base, prod_acumulada, valor, modalidade, d.get('tipo_pessoa',''))
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
            observacoes,anexos,contrato_arquivo,comprovante_boleto,campos_extras,quem_subiu
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""", (
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
            json.dumps(extras, ensure_ascii=False),d.get('quem_subiu','Consultor')
        ))
        proposta_id = cur.lastrowid
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
        for parc in gerar_parcelas(proposta_id, d.get('vigencia',''), c, dia_venc):
            cur.execute("""INSERT INTO parcelas (proposta_id,numero,percentual,valor,valor_corretora,perc_cliente,data_prevista,status,competencia,mensalidade_ref,tipo_origem)
                VALUES (?,?,?,?,?,?,?,?,?,?,'comissao')""", (parc['proposta_id'],parc['numero'],parc['percentual'],
                                          parc['valor'],parc['valor_corretora'],parc['perc_cliente'],
                                          parc['data_prevista'],parc['status'],parc['competencia'],parc['mensalidade_ref']))
        conn.commit(); conn.close()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "msg": str(e)}), 500

@app.route('/propostas')
@login_required
def listar_propostas():
    conn = db(); uid = session['user_id']
    if session['perfil'] == 'admin':
        rows = conn.execute("""SELECT p.*,s.nome as supervisora_nome FROM propostas p
            LEFT JOIN supervisoras s ON s.id=p.supervisora_id ORDER BY p.id DESC""").fetchall()
    else:
        rows = conn.execute("""SELECT p.*,s.nome as supervisora_nome FROM propostas p
            LEFT JOIN supervisoras s ON s.id=p.supervisora_id WHERE p.usuario_id=? ORDER BY p.id DESC""",(uid,)).fetchall()
    conn.close()
    return render_template('propostas.html', propostas=rows)

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
    conn.close()
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
    return render_template('detalhe.html', p=p, parcelas=parcelas, regime=regime, extras=extras_view)

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
        conn.close(); return jsonify({"ok": False, "msg": "Consultor ou proposta inválidos"}), 400

    # Produção do mês do NOVO consultor (exceto esta proposta) + esta venda
    ma = (p['criado_em'] or '')[:7]
    prod_antes = conn.execute("""SELECT COALESCE(SUM(valor),0) v FROM propostas
        WHERE usuario_id=? AND substr(criado_em,1,7)=? AND id<>?""", (novo_uid, ma, pid)).fetchone()['v']
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
    conn.commit(); conn.close()
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
        ma = (p['criado_em'] or '')[:7]
        prod_antes = conn.execute("""SELECT COALESCE(SUM(valor),0) v FROM propostas
            WHERE usuario_id=? AND substr(criado_em,1,7)=? AND id<>?""",
            (p['usuario_id'], ma, p['id'])).fetchone()['v']
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
    conn.commit(); conn.close()
    return jsonify({"ok": True, "recalculadas": recalc, "avisos": avisos})

@app.route('/api/consultores')
@login_required
@admin_required
def api_consultores():
    conn = db()
    rows = conn.execute("SELECT id,nome,regime_base FROM usuarios WHERE ativo=1 AND perfil='consultor' ORDER BY nome").fetchall()
    conn.close()
    return jsonify([{'id': r['id'], 'nome': r['nome'],
                     'regime': MODELO_NOME.get(r['regime_base'], r['regime_base'] or '—')} for r in rows])

def get_cfg(chave, default=''):
    conn = db()
    r = conn.execute("SELECT valor FROM config WHERE chave=?", (chave,)).fetchone()
    conn.close()
    return r['valor'] if r else default

@app.route('/proposta/<int:pid>/email-affinity')
@login_required
def email_affinity(pid):
    """Monta o e-mail-padrão de solicitação de protocolo para a Affinity."""
    conn = db()
    p = conn.execute("SELECT * FROM propostas WHERE id=?", (pid,)).fetchone()
    conn.close()
    if not p: return jsonify({"ok": False}), 404
    contato = get_cfg('affinity_contato', 'equipe')
    dest = get_cfg('affinity_destinatarios', '')
    rem = get_cfg('affinity_remetente', '')
    tipo = (p['tipo_pessoa'] or '').upper()
    doc = (f"CNPJ: {p['cnpj']}" if p['cnpj'] else (f"CPF: {p['cpf_titular']}" if p['cpf_titular'] else ''))
    alvo = p['razao_social'] or p['cpf_titular'] or 'cliente'
    vidas = p['total_vidas'] or '—'
    valor_fmt = f"{(p['valor'] or 0):,.2f}".replace(',','X').replace('.',',').replace('X','.')
    dia_v = p['dia_vencimento'] or '—'
    corpo = f"""Olá, {contato}, tudo bem?

Gostaria de solicitar o protocolo de venda referente ao contrato do plano de saúde {p['adm_operadora'] or ''} para {('a empresa ' + alvo) if p['cnpj'] else alvo}{(' - ' + doc) if doc else ''}.

Seguem os detalhes da proposta para conferência:
Plano: {p['produto'] or '—'}

Condição: {p['fator_moderador'] or '—'}

Valor do grupo: R$ {valor_fmt}

Titular: {p['cpf_titular'] or alvo}
Total de pessoas: {vidas} vidas

DADOS DE CONTATO:
EMAIL: {p['email_resp_contrato'] or ''}
TELEFONE: {p['tel_resp_contrato'] or ''}

SOLICITO VIGÊNCIA: {p['vigencia'] or '—'}
VENCIMENTO DIA: {dia_v} de cada mês.

{p['observacoes'] or ''}

Seguem em anexo todos os documentos necessários para a formalização.
Poderia me enviar o protocolo para darmos prosseguimento ao processo junto ao cliente?

Fico no aguardo e agradeço desde já.

Atenciosamente,
{session.get('nome','')}"""
    assunto = f"Solicitação de Protocolo - Venda {p['produto'] or p['adm_operadora'] or ''} - {alvo}"
    return jsonify({"ok": True, "destinatarios": dest, "remetente": rem, "assunto": assunto, "corpo": corpo})

@app.route('/config/affinity', methods=['POST'])
@login_required
@admin_required
def config_affinity():
    d = request.json or {}
    conn = db()
    for k in ['affinity_destinatarios','affinity_contato','affinity_remetente']:
        if k in d:
            conn.execute("INSERT INTO config (chave,valor) VALUES (?,?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor", (k, d[k]))
    conn.commit(); conn.close()
    return jsonify({"ok": True})

@app.route('/api/etiquetas')
@login_required
def api_etiquetas():
    conn = db()
    todas = conn.execute("SELECT * FROM etiquetas ORDER BY nome").fetchall()
    pid = request.args.get('proposta_id')
    marcadas = []
    if pid:
        marcadas = [r['etiqueta_id'] for r in conn.execute("SELECT etiqueta_id FROM proposta_etiquetas WHERE proposta_id=?", (pid,)).fetchall()]
    conn.close()
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
    conn.close()
    return jsonify({"ok": True})

@app.route('/proposta/<int:pid>/etiquetas', methods=['POST'])
@login_required
def proposta_etiquetas(pid):
    ids = (request.json or {}).get('etiquetas', [])
    conn = db()
    conn.execute("DELETE FROM proposta_etiquetas WHERE proposta_id=?", (pid,))
    for eid in ids:
        conn.execute("INSERT OR IGNORE INTO proposta_etiquetas (proposta_id,etiqueta_id) VALUES (?,?)", (pid, eid))
    conn.commit(); conn.close()
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
    conn.close()
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
    conn.commit(); conn.close()
    return jsonify({"ok": True})

@app.route('/produto/excluir/<int:prid>', methods=['POST'])
@login_required
@admin_required
def produto_excluir(prid):
    conn = db(); conn.execute("UPDATE produtos SET ativo=0 WHERE id=?", (prid,))
    conn.commit(); conn.close()
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
    conn.close()
    return jsonify([dict(r) for r in rows])

# ─── EDITAR PROPOSTA + TIMELINE (só admin) ────────────────────────────────────────
CAMPOS_EDITAVEIS = {
    'razao_social':'Razão social','cnpj':'CNPJ','cpf_titular':'CPF do titular','produto':'Produto',
    'adm_operadora':'Operadora','valor':'Valor','vigencia':'Vigência','dia_vencimento':'Dia vencimento',
    'fator_moderador':'Coparticipação','acomodacao':'Acomodação','total_vidas':'Vidas',
    'data_nasc_titular':'Nascimento do titular','observacoes':'Observações','fase':'Fase',
    'email_resp_contrato':'E-mail contato','tel_resp_contrato':'Telefone contato',
    'tem_repique':'Repique','repique_json':'Dados do repique',
}
@app.route('/proposta/<int:pid>/editar', methods=['POST'])
@login_required
@admin_required
def proposta_editar(pid):
    d = request.json or {}
    conn = db()
    p = conn.execute("SELECT * FROM propostas WHERE id=?", (pid,)).fetchone()
    if not p: conn.close(); return jsonify({"ok": False}), 404
    nome_user = session.get('nome','admin')
    NUMERICOS = {'valor','total_vidas','dia_vencimento'}
    def conv(campo, v):
        if campo in NUMERICOS:
            s = str(v or '').replace('.','').replace(',','.') if campo=='valor' else str(v or '')
            try: return float(s) if campo=='valor' else int(s or 0)
            except: return 0
        return v
    mudou = []
    for campo, label in CAMPOS_EDITAVEIS.items():
        if campo in d:
            antes = p[campo] if campo in p.keys() else ''
            depois = conv(campo, d[campo])
            if str(antes or '') != str(depois or ''):
                conn.execute(f"UPDATE propostas SET {campo}=? WHERE id=?", (depois, pid))
                conn.execute("""INSERT INTO historico_proposta (proposta_id,usuario_nome,campo,valor_antes,valor_depois)
                    VALUES (?,?,?,?,?)""", (pid, nome_user, label, str(antes or '—'), str(depois or '—')))
                mudou.append(label)
    conn.commit(); conn.close()
    return jsonify({"ok": True, "mudou": mudou})

@app.route('/proposta/<int:pid>/historico')
@login_required
def proposta_historico(pid):
    conn = db()
    h = conn.execute("""SELECT * FROM historico_proposta WHERE proposta_id=? ORDER BY id DESC""", (pid,)).fetchall()
    conn.close()
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
    if not p: conn.close(); return jsonify({"ok": False}), 404
    fase_info = next((f for f in FASES if f['id']==nova), None)
    aviso = ''
    if fase_info and fase_info['falta']=='comprovante' and not p['comprovante_boleto']:
        aviso = 'Atenção: esta proposta ainda está sem comprovante anexado. Você pode prosseguir, mas lembre de anexar quando a operadora aprovar.'
    conn.execute("UPDATE propostas SET fase=? WHERE id=?", (nova, pid))
    conn.execute("""INSERT INTO historico_proposta (proposta_id,usuario_nome,campo,valor_antes,valor_depois)
        VALUES (?,?,?,?,?)""", (pid, session.get('nome','admin'), 'Fase', p['fase'] or '—', nova))
    conn.commit(); conn.close()
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
                     (novo, datetime.now().isoformat(), pid))
    elif novo == 'Pago ao corretor':
        conn.execute("UPDATE parcelas SET status=?,data_pagamento=? WHERE id=?",
                     (novo, datetime.now().isoformat(), pid))
    else:
        conn.execute("UPDATE parcelas SET status=? WHERE id=?", (novo, pid))
    conn.commit(); conn.close()
    return jsonify({"ok": True})

@app.route('/parcela/<int:pid>/acao', methods=['POST'])
@login_required
@admin_required
def parcela_acao(pid):
    """Avança a parcela um passo no fluxo, com confirmação do gestor."""
    acao = request.form.get('acao')
    conn = db()
    agora = datetime.now().isoformat()
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
        conn.close(); return jsonify({"ok": False, "msg": "Ação inválida"}), 400
    conn.commit(); conn.close()
    return jsonify({"ok": True})

@app.route('/parcela/<int:pid>/antecipar', methods=['POST'])
@login_required
def parcela_antecipar(pid):
    """Corretor sobe comprovante de pagamento do cliente (somente parcela 1)."""
    if 'comprovante' not in request.files:
        return jsonify({"ok": False, "msg": "Nenhum arquivo enviado"}), 400
    f = request.files['comprovante']
    nome = f"{datetime.now().strftime('%Y%m%d%H%M%S')}_antecip_{f.filename}"
    caminho = os.path.join(UPLOAD_FOLDER, nome)
    f.save(caminho)
    conn = db()
    # Valida que é parcela 1 e pertence ao consultor
    parc = conn.execute("""SELECT pa.*, p.usuario_id, p.razao_social FROM parcelas pa
        JOIN propostas p ON p.id=pa.proposta_id WHERE pa.id=?""",(pid,)).fetchone()
    if not parc or parc['numero'] != 1:
        conn.close(); return jsonify({"ok": False, "msg": "Antecipação só disponível para a 1ª parcela"}), 400
    if session['perfil'] != 'admin' and parc['usuario_id'] != session['user_id']:
        conn.close(); return jsonify({"ok": False, "msg": "Acesso negado"}), 403
    # Upload para Drive na subpasta do cliente
    razao_pasta = (parc['razao_social'] or 'sem_nome')[:40].strip().replace('/', '-')
    upload_drive(caminho, nome, subpasta_nome=razao_pasta)
    conn.execute("UPDATE parcelas SET comprovante_antecipacao=?,status='Antecipação - Aguardando ADM' WHERE id=?",
                 (nome, pid))
    conn.commit(); conn.close()
    return jsonify({"ok": True})

@app.route('/parcela/<int:pid>/aprovar-antecipacao', methods=['POST'])
@login_required
@admin_required
def parcela_aprovar_antecip(pid):
    """ADM aprova o comprovante e solicita os 48h à operadora."""
    conn = db()
    conn.execute("UPDATE parcelas SET status='Antecipação Solicitada à Operadora' WHERE id=?", (pid,))
    conn.commit(); conn.close()
    return jsonify({"ok": True})

@app.route('/parcela/<int:pid>/aceite', methods=['POST'])
@login_required
def parcela_aceite(pid):
    """Consultor confirma 'Conferido e De Acordo' quando parcela está liberada."""
    conn = db()
    parc = conn.execute("""SELECT pa.*, p.usuario_id FROM parcelas pa
        JOIN propostas p ON p.id=pa.proposta_id WHERE pa.id=?""",(pid,)).fetchone()
    if not parc: conn.close(); return jsonify({"ok": False, "msg": "Parcela não encontrada"}), 404
    if session['perfil'] != 'admin' and parc['usuario_id'] != session['user_id']:
        conn.close(); return jsonify({"ok": False, "msg": "Acesso negado"}), 403
    conn.execute("UPDATE parcelas SET aceite_corretor=1,data_aceite=? WHERE id=?",
                 (datetime.now().isoformat(), pid))
    conn.commit(); conn.close()
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

        conn.close()
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
        conn.close()
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
    conn.close()
    return render_template('bi.html', por_mes=por_mes, por_operadora=por_operadora,
                           por_modalidade=por_modalidade, por_consultor=por_consultor)

# ─── USUÁRIOS ────────────────────────────────────────────────────────────────────
@app.route('/usuarios')
@login_required
@admin_required
def usuarios():
    conn = db()
    rows = conn.execute("SELECT * FROM usuarios ORDER BY id").fetchall()
    conn.close()
    return render_template('usuarios.html', usuarios=rows, host=request.host_url.rstrip('/'))

@app.route('/usuario/novo', methods=['POST'])
@login_required
@admin_required
def usuario_novo():
    d = request.form
    nome=d.get('nome','').strip(); email=d.get('email','').strip().lower()
    if not nome or not email:
        flash('Nome e e-mail obrigatórios.'); return redirect(url_for('usuarios'))
    token=secrets.token_urlsafe(32); expira=(datetime.now()+timedelta(days=7)).isoformat()
    conn = db()
    try:
        conn.execute("""INSERT INTO usuarios (nome,email,perfil,regime_base,token_setup,token_expira)
            VALUES (?,?,?,?,?,?)""",(nome,email,d.get('perfil','consultor'),
            (d.get('regime_base','sem_lead_sem_fixo') if d.get('perfil','consultor')=='consultor' else ''),token,expira))
        conn.commit()
    except sqlite3.IntegrityError:
        flash('E-mail já cadastrado.'); conn.close(); return redirect(url_for('usuarios'))
    conn.close()
    return redirect(url_for('usuarios', link_token=token))

@app.route('/usuario/foto/upload', methods=['POST'])
@login_required
def usuario_foto_upload():
    """Upload de foto de perfil via AJAX.
    Admin pode enviar ?uid=X para alterar foto de outro usuário.
    """
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
    if foto_antiga and foto_antiga['foto']:
        try: os.remove(os.path.join(UPLOAD_FOLDER, foto_antiga['foto']))
        except: pass

    foto_nome = f"perfil_{uid_alvo}_{datetime.now().strftime('%Y%m%d%H%M%S')}{ext}"
    fimg.save(os.path.join(UPLOAD_FOLDER, foto_nome))

    conn.execute("UPDATE usuarios SET foto=? WHERE id=?", (foto_nome, uid_alvo))
    conn.commit(); conn.close()

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
            foto_nome = f"perfil_{uid}_{datetime.now().strftime('%Y%m%d%H%M%S')}{ext}"
            fimg.save(os.path.join(UPLOAD_FOLDER, foto_nome))
    conn.execute("""UPDATE usuarios SET nome=?,email=?,perfil=?,regime_base=?,ativo=?,valor_fixo=?,chave_pix=?,foto=? WHERE id=?""",
        (d['nome'],d['email'].lower(),d['perfil'],
         (d['regime_base'] if d['perfil']=='consultor' else ''),ativo,fnum('valor_fixo'),d.get('chave_pix',''),foto_nome,uid))
    conn.commit(); conn.close()
    return redirect(url_for('usuarios'))

@app.route('/usuario/regenerar-link/<int:uid>')
@login_required
@admin_required
def usuario_regenerar(uid):
    token=secrets.token_urlsafe(32); expira=(datetime.now()+timedelta(days=7)).isoformat()
    conn = db()
    conn.execute("UPDATE usuarios SET token_setup=?,token_expira=?,senha_hash=NULL WHERE id=?",(token,expira,uid))
    conn.commit(); conn.close()
    return redirect(url_for('usuarios', link_token=token))

# ─── SUPERVISORAS ────────────────────────────────────────────────────────────────
@app.route('/supervisoras')
@login_required
@admin_required
def supervisoras():
    conn = db()
    rows = conn.execute("SELECT * FROM supervisoras ORDER BY ativo DESC,nome").fetchall()
    conn.close()
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
    conn.commit(); conn.close()
    return redirect(url_for('supervisoras'))

# ─── REGIMES ─────────────────────────────────────────────────────────────────────
@app.route('/regimes')
@login_required
@admin_required
def regimes():
    conn = db()
    rows = conn.execute("SELECT * FROM regimes ORDER BY ordem").fetchall()
    conn.close()
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
    conn.commit(); conn.close()
    return redirect(url_for('regimes'))

# ─── COMISSÕES ───────────────────────────────────────────────────────────────────
@app.route('/comissoes')
@login_required
@admin_required
def comissoes():
    conn = db()
    rows = conn.execute("SELECT * FROM comissoes ORDER BY operadora").fetchall()
    conn.close()
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
    conn.commit(); conn.close()
    return redirect(url_for('comissoes'))

# ─── CAMPOS PERSONALIZADOS (FORM BUILDER) ────────────────────────────────────────
@app.route('/campos')
@login_required
@admin_required
def campos():
    conn = db()
    rows = conn.execute("SELECT * FROM campos_custom ORDER BY ordem,id").fetchall()
    conn.close()
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
    conn.commit(); conn.close()
    return jsonify({"ok": True})

@app.route('/campo/excluir/<int:cid>', methods=['POST'])
@login_required
@admin_required
def campo_excluir(cid):
    conn = db()
    conn.execute("DELETE FROM campos_custom WHERE id=?", (cid,))
    conn.commit(); conn.close()
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
    conn.commit(); conn.close()
    return jsonify({"ok": True})

@app.route('/api/campos-ativos')
@login_required
def api_campos_ativos():
    conn = db()
    rows = conn.execute("SELECT * FROM campos_custom WHERE ativo=1 ORDER BY ordem,id").fetchall()
    conn.close()
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
    conn.close()
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
    conn.commit(); conn.close()
    return jsonify({"ok": True})

@app.route('/operadora/excluir', methods=['POST'])
@login_required
@admin_required
def operadora_excluir():
    d = request.json or {}
    conn = db()
    conn.execute("DELETE FROM recebimento WHERE operadora=? AND obs=?", (d.get('operadora'), d.get('obs','')))
    conn.execute("DELETE FROM repasse_corretor WHERE operadora=? AND obs=?", (d.get('operadora'), d.get('obs','')))
    conn.commit(); conn.close()
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
    conn.close()
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
    conn.commit(); conn.close()
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
    
    conn.close()
    
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
    conn.commit(); conn.close()
    
    return jsonify({"ok": True, "nova_fase": nova_fase})

@app.route('/niveis')
@login_required
@admin_required
def niveis():
    conn = db()
    rows = conn.execute("SELECT * FROM niveis ORDER BY ordem").fetchall()
    conn.close()
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
    conn.commit(); conn.close()
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
    conn.commit(); conn.close()
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
    conn.close()
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
    conn.commit(); conn.close()
    return jsonify({"ok": True})

@app.route('/lancamento/excluir/<int:lid>', methods=['POST'])
@login_required
@admin_required
def lancamento_excluir(lid):
    conn = db(); conn.execute("DELETE FROM lancamentos WHERE id=?", (lid,))
    conn.commit(); conn.close()
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
    conn.close()
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
    conn.commit(); conn.close()
    return jsonify({"ok": True})

@app.route('/proposta/<int:pid>/estornar', methods=['POST'])
@login_required
@admin_required
def estornar_proposta(pid):
    """Estorna a comissão conforme a regra da operadora: % e até qual mensalidade.
    mensalidade_cancelou = em qual mensalidade o cliente parou de pagar."""
    mens_cancelou = int((request.json or {}).get('mensalidade_cancelou') or 1)
    conn = db()
    p = conn.execute("SELECT * FROM propostas WHERE id=?", (pid,)).fetchone()
    if not p:
        conn.close(); return jsonify({"ok": False, "msg": "Proposta não encontrada"}), 404
    regra = conn.execute("SELECT * FROM regras_estorno WHERE operadora=?", (p['adm_operadora'],)).fetchone()
    perc = (regra['perc_estorno'] if regra else 100)
    ate = (regra['ate_mensalidade'] if regra else 3)
    # Estorna se o cliente cancelou DENTRO da janela de estorno
    estorna = mens_cancelou <= ate
    valor_estorno = 0.0
    if estorna:
        # estorna o % das parcelas já pagas/liberadas
        pagas = conn.execute("""SELECT COALESCE(SUM(valor),0) v FROM parcelas
            WHERE proposta_id=? AND status IN ('Pago ao corretor','Liberado para o corretor')""", (pid,)).fetchone()['v']
        valor_estorno = round(pagas * perc/100, 2)
        # parcelas futuras são canceladas
        conn.execute("""UPDATE parcelas SET status='Estornada' WHERE proposta_id=? AND status='Pendente de receber'""", (pid,))
    info = f"Cliente parou na {mens_cancelou}ª mensalidade. Regra {p['adm_operadora']}: estorna {perc:.0f}% até a {ate}ª. " + \
           (f"Estorno de R$ {valor_estorno:.2f}." if estorna else "Fora da janela — sem estorno.")
    conn.execute("UPDATE propostas SET estornada=?, estorno_info=? WHERE id=?", (1 if estorna else 0, info, pid))
    conn.commit(); conn.close()
    return jsonify({"ok": True, "estorna": estorna, "valor": valor_estorno, "info": info})

# ─── APIs ────────────────────────────────────────────────────────────────────────
@login_required
def api_com_pub():
    conn = db()
    rec = conn.execute("SELECT * FROM recebimento").fetchall()
    reps = conn.execute("SELECT * FROM repasse_corretor").fetchall()
    niveis = conn.execute("SELECT * FROM niveis ORDER BY ordem").fetchall()
    conn.close()
    # recebimento indexado por "operadora|plano" (pega entrada sem obs preferencialmente)
    rec_map = {}
    for r in rec:
        k = f"{r['operadora']}|{r['plano']}"
        if k not in rec_map or not r['obs']:
            rec_map[k] = r['total']
    rep_map = {f"{r['operadora']}|{r['plano']}|{r['modelo']}|{r['nivel']}": dict(r) for r in reps}
    operadoras = sorted({r['operadora'] for r in rec})
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
    if session['perfil'] == 'admin':
        rows = conn.execute("SELECT * FROM propostas ORDER BY id DESC").fetchall()
    else:
        rows = conn.execute("SELECT * FROM propostas WHERE usuario_id=? ORDER BY id DESC",(uid,)).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


# ─── CRM ─────────────────────────────────────────────────────────────────────────
CRM_ETAPAS = [
    {'id': 'topo',     'nome': 'Topo do Funil',   'cor': '#3b82f6', 'desc': 'Leads novos, primeiro contato'},
    {'id': 'meio',     'nome': 'Meio do Funil',    'cor': '#f59e0b', 'desc': 'Em negociação, proposta enviada'},
    {'id': 'fim',      'nome': 'Fundo do Funil',   'cor': '#10b981', 'desc': 'Pronto para fechar'},
    {'id': 'ganho',    'nome': 'Ganho ✓',          'cor': '#1fd8a4', 'desc': 'Convertido em proposta'},
    {'id': 'perdido',  'nome': 'Perdido',           'cor': '#ef4444', 'desc': 'Lead perdido'},
]

@app.route('/crm')
@login_required
def crm():
    conn = db()
    uid = session['user_id']
    eh_admin = session.get('perfil') == 'admin'
    filtro = request.args.get('etapa', '')
    responsaveis = conn.execute(
        "SELECT id, nome FROM usuarios WHERE ativo=1 AND perfil='consultor' ORDER BY nome"
    ).fetchall() if eh_admin else []

    # Carrega todos os leads com responsável
    q = """SELECT l.*, u.nome as responsavel_nome
           FROM crm_leads l
           LEFT JOIN usuarios u ON u.id = l.responsavel_id
           WHERE 1=1 """
    params = []
    if not eh_admin:
        q += " AND l.responsavel_id=?"
        params.append(uid)
    if filtro:
        q += " AND l.etapa=?"
        params.append(filtro)
    q += " ORDER BY l.atualizado_em DESC"
    leads = conn.execute(q, params).fetchall()

    # Agrupa por etapa
    kanban = {e['id']: [] for e in CRM_ETAPAS}
    for lead in leads:
        etapa = lead['etapa'] or 'topo'
        if etapa in kanban:
            kanban[etapa].append(lead)

    # Stats
    total = len(leads)
    conn.close()
    return render_template('crm.html', kanban=kanban, etapas=CRM_ETAPAS,
                           total=total, responsaveis=responsaveis, eh_admin=eh_admin)


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
    lead_id = conn.execute("SELECT last_insert_rowid() id").fetchone()['id']
    conn.execute("INSERT INTO crm_atividades (lead_id, usuario_nome, tipo, descricao) VALUES (?,?,?,?)",
                 (lead_id, session.get('nome'), 'criacao', 'Lead criado'))
    conn.commit(); conn.close()
    return jsonify({"ok": True, "id": lead_id})


@app.route('/crm/lead/<int:lid>')
@login_required
def crm_lead_detalhe(lid):
    conn = db()
    lead = conn.execute("""SELECT l.*, u.nome as responsavel_nome
        FROM crm_leads l LEFT JOIN usuarios u ON u.id=l.responsavel_id
        WHERE l.id=?""", (lid,)).fetchone()
    if not lead:
        conn.close(); return jsonify({"ok": False}), 404
    if session.get('perfil') != 'admin' and lead['responsavel_id'] != session['user_id']:
        conn.close(); return jsonify({"ok": False, "erro": "Acesso negado"}), 403
    atividades = conn.execute(
        "SELECT * FROM crm_atividades WHERE lead_id=? ORDER BY id DESC", (lid,)).fetchall()
    conn.close()
    return jsonify({
        "lead": dict(lead),
        "atividades": [dict(a) for a in atividades]
    })


@app.route('/crm/lead/<int:lid>/mover', methods=['POST'])
@login_required
def crm_lead_mover(lid):
    nova_etapa = (request.json or {}).get('etapa')
    if nova_etapa not in [e['id'] for e in CRM_ETAPAS]:
        return jsonify({"ok": False, "erro": "Etapa inválida"}), 400
    conn = db()
    lead = conn.execute("SELECT * FROM crm_leads WHERE id=?", (lid,)).fetchone()
    if not lead:
        conn.close(); return jsonify({"ok": False}), 404
    if session.get('perfil') != 'admin' and lead['responsavel_id'] != session['user_id']:
        conn.close(); return jsonify({"ok": False}), 403
    etapa_ant = lead['etapa']
    conn.execute("UPDATE crm_leads SET etapa=?, atualizado_em=CURRENT_TIMESTAMP WHERE id=?",
                 (nova_etapa, lid))
    conn.execute("INSERT INTO crm_atividades (lead_id, usuario_nome, tipo, descricao) VALUES (?,?,?,?)",
                 (lid, session.get('nome'), 'movimentacao',
                  f'Movido de "{etapa_ant}" para "{nova_etapa}"'))
    conn.commit(); conn.close()
    return jsonify({"ok": True})


@app.route('/crm/lead/<int:lid>/atividade', methods=['POST'])
@login_required
def crm_lead_atividade(lid):
    d = request.json or {}
    conn = db()
    conn.execute("INSERT INTO crm_atividades (lead_id, usuario_nome, tipo, descricao) VALUES (?,?,?,?)",
                 (lid, session.get('nome'), d.get('tipo', 'nota'), d.get('descricao', '')))
    conn.execute("UPDATE crm_leads SET atualizado_em=CURRENT_TIMESTAMP WHERE id=?", (lid,))
    conn.commit(); conn.close()
    return jsonify({"ok": True})


@app.route('/crm/lead/<int:lid>/editar', methods=['POST'])
@login_required
def crm_lead_editar(lid):
    d = request.json or {}
    conn = db()
    conn.execute("""UPDATE crm_leads SET nome=?, telefone=?, email=?, empresa=?,
                    valor_estimado=?, observacoes=?, atualizado_em=CURRENT_TIMESTAMP
                    WHERE id=?""",
        (d.get('nome'), d.get('telefone'), d.get('email'), d.get('empresa'),
         float(d.get('valor_estimado') or 0) or None, d.get('observacoes'), lid))
    conn.commit(); conn.close()
    return jsonify({"ok": True})


@app.route('/crm/lead/<int:lid>/excluir', methods=['POST'])
@login_required
def crm_lead_excluir(lid):
    conn = db()
    lead = conn.execute("SELECT * FROM crm_leads WHERE id=?", (lid,)).fetchone()
    if not lead:
        conn.close(); return jsonify({"ok": False, "erro": "Lead não encontrado"}), 404
    # Admin pode excluir qualquer lead; consultor só os seus próprios
    if session.get('perfil') != 'admin' and lead['responsavel_id'] != session['user_id']:
        conn.close(); return jsonify({"ok": False, "erro": "Sem permissão"}), 403
    conn.execute("DELETE FROM crm_atividades WHERE lead_id=?", (lid,))
    conn.execute("DELETE FROM crm_leads WHERE id=?", (lid,))
    conn.commit(); conn.close()
    return jsonify({"ok": True})


@app.route('/crm/stats')
@login_required
def crm_stats():
    conn = db()
    uid = session['user_id']; eh_admin = session.get('perfil') == 'admin'
    q_filter = "" if eh_admin else f" AND responsavel_id={uid}"
    stats = {}
    for e in CRM_ETAPAS:
        row = conn.execute(f"SELECT COUNT(*) c, COALESCE(SUM(valor_estimado),0) v FROM crm_leads WHERE etapa=?{q_filter}", (e['id'],)).fetchone()
        stats[e['id']] = {'qtd': row['c'], 'valor': row['v']}
    conn.close()
    return jsonify(stats)


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
                        (nome, telefone, email, empresa, 'meta', 'topo',
                         json.dumps(valor, ensure_ascii=False)))
                    lead_id = conn.execute("SELECT last_insert_rowid() id").fetchone()['id']
                    conn.execute("INSERT INTO crm_atividades (lead_id, usuario_nome, tipo, descricao) VALUES (?,?,?,?)",
                                 (lead_id, 'Meta Ads', 'criacao', f'Lead capturado via Meta Ads'))
        conn.commit(); conn.close()
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
            (nome, telefone, email, empresa, 'google', 'topo',
             json.dumps(data, ensure_ascii=False)))
        lead_id = conn.execute("SELECT last_insert_rowid() id").fetchone()['id']
        conn.execute("INSERT INTO crm_atividades (lead_id, usuario_nome, tipo, descricao) VALUES (?,?,?,?)",
                     (lead_id, 'Google Ads', 'criacao', 'Lead capturado via Google Lead Form'))
        conn.commit(); conn.close()
        return jsonify({"ok": True}), 200
    except Exception as e:
        return jsonify({"ok": False, "erro": str(e)}), 200


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
    foto_nome = f"perfil_{uid}_{int(datetime.now().timestamp())}{ext}"
    
    conn = db()
    foto_antiga = conn.execute("SELECT foto FROM usuarios WHERE id=?", (uid,)).fetchone()
    if foto_antiga and foto_antiga['foto']:
        try: os.remove(os.path.join(UPLOAD_FOLDER, foto_antiga['foto']))
        except: pass
    fimg.save(os.path.join(UPLOAD_FOLDER, foto_nome))
    conn.execute("UPDATE usuarios SET foto=? WHERE id=?", (foto_nome, uid))
    conn.commit(); conn.close()
    session['foto'] = foto_nome
    return jsonify({"ok": True, "foto": foto_nome})




# Auto-import SQLite → PostgreSQL na primeira requisição
@app.before_request
def auto_import_sqlite():
    if not hasattr(auto_import_sqlite, '_done'):
        try:
            import os, sqlite3
            sqlite_db = os.path.expanduser("~/JOB_Serenus_Dados/job.db")
            if os.path.exists(sqlite_db) and DB_MODE == 'postgres':
                conn = db()
                sqlite_conn = sqlite3.connect(sqlite_db)
                for row in sqlite_conn.execute("SELECT * FROM propostas"):
                    cols = ", ".join([k for k in dict(row).keys()])
                    vals = ", ".join([f"'{str(v).replace(chr(39), chr(39)*2)}'" if v else "NULL" for v in dict(row).values()])
                    conn.execute(f"INSERT INTO propostas ({cols}) VALUES ({vals})")
                conn.commit()
                close_db(conn)
                sqlite_conn.close()
                print("✅ Dados SQLite importados!")
        except: pass
        auto_import_sqlite._done = True


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
                if DB_MODE == 'postgres':
                    cols = [d[0] for d in cur.description or []]
                    snapshot['tabelas'][tabela] = [dict(zip(cols, row)) for row in cur.fetchall()]
                else:
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

# Executar ao iniciar
_verificar_banco_vazio()

# Agendador de backup
_SCHEDULER_INICIADO = False

def _iniciar_scheduler_backup():
    """Liga agendador de backup automático (1x por dia, 3h BRT)."""
    global _SCHEDULER_INICIADO
    if _SCHEDULER_INICIADO or DB_MODE != 'postgres':
        return
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        sched = BackgroundScheduler(daemon=True, timezone='America/Sao_Paulo')
        sched.add_job(_fazer_snapshot_emergencia, 'cron', hour=3, minute=0, max_instances=1)
        sched.start()
        _SCHEDULER_INICIADO = True
        app.logger.info("[resilience] ✅ Scheduler iniciado — backup diário 3h BRT")
    except Exception as e:
        app.logger.warning(f"[resilience] Scheduler não iniciado: {e}")

try:
    _iniciar_scheduler_backup()
except Exception as e:
    app.logger.warning(f"[resilience] Falha ao iniciar scheduler: {e}")


if __name__ == '__main__':
    import os
    init_db()
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
