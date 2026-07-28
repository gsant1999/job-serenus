"""Usuarios e papeis.

Cada consultor entra com o proprio login. Isso existe para o historico ter nome: sem
saber quem gerou, quem apontou a pendencia e quem corrigiu, o acompanhamento vira uma
lista de eventos anonimos e nao serve para cobrar ninguem.

Dois papeis:
    consultor  monta a proposta, corrige o que voltou
    gestor     tudo do consultor, mais: apontar pendencia, aprovar, marcar enviado,
               e cadastrar/desativar usuarios

A senha nunca e guardada - so o hash (pbkdf2 do werkzeug). Quem tiver o arquivo do
banco na mao nao consegue entrar como ninguem.
"""
import datetime
import os
import sqlite3

from werkzeug.security import check_password_hash
from werkzeug.security import generate_password_hash as _gerar_hash

# pbkdf2 explicito: o padrao novo do werkzeug e scrypt, que depende de suporte no
# OpenSSL - o Python 3.9 do macOS nao tem e a criacao de usuario morria com
# "module 'hashlib' has no attribute 'scrypt'". pbkdf2:sha256 roda em qualquer lugar.
ITERACOES = 260000


def gerar_hash(senha):
    return _gerar_hash(senha, method='pbkdf2:sha256', salt_length=16)

DADOS_DIR = os.environ.get('DADOS_DIR', '/data')
BANCO = os.path.join(DADOS_DIR, 'historico.db')

ESQUEMA = """
CREATE TABLE IF NOT EXISTS usuario (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    login     TEXT NOT NULL UNIQUE COLLATE NOCASE,
    nome      TEXT NOT NULL,
    senha     TEXT NOT NULL,
    papel     TEXT NOT NULL DEFAULT 'consultor',   -- consultor | gestor
    cpf       TEXT,
    telefone  TEXT,
    ativo     INTEGER NOT NULL DEFAULT 1,
    trocar_senha INTEGER NOT NULL DEFAULT 0,
    criado_em TEXT NOT NULL
);
"""


def _conectar():
    os.makedirs(DADOS_DIR, exist_ok=True)
    con = sqlite3.connect(BANCO, timeout=10)
    con.row_factory = sqlite3.Row
    return con


def _agora():
    return datetime.datetime.now().isoformat(timespec='seconds')


def iniciar():
    """Cria a tabela e, se nao houver ninguem, o primeiro gestor.

    O primeiro acesso usa a SENHA_ACESSO que ja esta configurada, para nao inventar
    mais uma variavel de ambiente - e marca trocar_senha, porque essa senha ja circulou
    em print de tela e nao deve continuar valendo como senha de gestor."""
    try:
        with _conectar() as con:
            con.executescript(ESQUEMA)
            n = con.execute('SELECT COUNT(*) c FROM usuario').fetchone()['c']
            if not n:
                senha = os.environ.get('SENHA_ACESSO') or 'admin'
                con.execute(
                    'INSERT INTO usuario (login, nome, senha, papel, ativo, trocar_senha, '
                    'criado_em) VALUES (?,?,?,?,1,1,?)',
                    ('admin', 'Administrador', gerar_hash(senha),
                     'gestor', _agora()))
        return True
    except Exception:
        return False


def autenticar(login, senha):
    """Devolve o dict do usuario, ou None. Usuario desativado nao entra."""
    try:
        with _conectar() as con:
            u = con.execute('SELECT * FROM usuario WHERE login = ? AND ativo = 1',
                            ((login or '').strip(),)).fetchone()
    except Exception:
        return None
    if not u or not check_password_hash(u['senha'], senha or ''):
        return None
    d = dict(u)
    d.pop('senha', None)
    return d


def por_id(uid):
    try:
        with _conectar() as con:
            u = con.execute('SELECT * FROM usuario WHERE id = ? AND ativo = 1',
                            (uid,)).fetchone()
        if not u:
            return None
        d = dict(u)
        d.pop('senha', None)
        return d
    except Exception:
        return None


def listar():
    try:
        with _conectar() as con:
            linhas = con.execute(
                'SELECT id, login, nome, papel, cpf, telefone, ativo, criado_em '
                'FROM usuario ORDER BY ativo DESC, nome').fetchall()
        return [dict(l) for l in linhas]
    except Exception:
        return []


def criar(login, nome, senha, papel='consultor', cpf='', telefone=''):
    """Devolve (id, None) ou (None, mensagem de erro)."""
    login = (login or '').strip()
    nome = (nome or '').strip()
    if not login or not nome:
        return None, 'Login e nome são obrigatórios.'
    if len(senha or '') < 6:
        return None, 'A senha precisa ter ao menos 6 caracteres.'
    if papel not in ('consultor', 'gestor'):
        return None, 'Papel inválido.'
    try:
        with _conectar() as con:
            cur = con.execute(
                'INSERT INTO usuario (login, nome, senha, papel, cpf, telefone, ativo, '
                'trocar_senha, criado_em) VALUES (?,?,?,?,?,?,1,1,?)',
                (login, nome, gerar_hash(senha), papel, cpf, telefone, _agora()))
        return cur.lastrowid, None
    except sqlite3.IntegrityError:
        return None, 'Já existe alguém com esse login.'
    except Exception as e:
        return None, f'Não foi possível criar: {e}'


def trocar_senha(uid, nova):
    if len(nova or '') < 6:
        return 'A senha precisa ter ao menos 6 caracteres.'
    try:
        with _conectar() as con:
            con.execute('UPDATE usuario SET senha = ?, trocar_senha = 0 WHERE id = ?',
                        (gerar_hash(nova), uid))
        return None
    except Exception as e:
        return f'Não foi possível trocar a senha: {e}'


def definir_ativo(uid, ativo):
    """Desativa em vez de apagar: o historico aponta para o usuario, e apagar deixaria
    eventos orfaos sem dono."""
    try:
        with _conectar() as con:
            # Nao deixa desativar o ultimo gestor ativo - o sistema ficaria sem
            # ninguem capaz de aprovar proposta ou recadastrar usuario.
            if not ativo:
                u = con.execute('SELECT papel FROM usuario WHERE id = ?', (uid,)).fetchone()
                if u and u['papel'] == 'gestor':
                    n = con.execute("SELECT COUNT(*) c FROM usuario WHERE papel='gestor' "
                                    'AND ativo=1 AND id <> ?', (uid,)).fetchone()['c']
                    if not n:
                        return 'Este é o único gestor ativo — promova outro antes.'
            con.execute('UPDATE usuario SET ativo = ? WHERE id = ?', (1 if ativo else 0, uid))
        return None
    except Exception as e:
        return f'Não foi possível alterar: {e}'


def definir_papel(uid, papel):
    if papel not in ('consultor', 'gestor'):
        return 'Papel inválido.'
    try:
        with _conectar() as con:
            if papel == 'consultor':
                n = con.execute("SELECT COUNT(*) c FROM usuario WHERE papel='gestor' "
                                'AND ativo=1 AND id <> ?', (uid,)).fetchone()['c']
                if not n:
                    return 'Este é o único gestor ativo — promova outro antes.'
            con.execute('UPDATE usuario SET papel = ? WHERE id = ?', (papel, uid))
        return None
    except Exception as e:
        return f'Não foi possível alterar: {e}'
