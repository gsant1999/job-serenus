"""A proposta como coisa viva: guarda os dados, os anexos, o historico e as versoes.

Antes a ferramenta gerava e esquecia. So sobrava o PDF montado - e PDF montado nao se
desmonta: nao da para trocar so a declaracao de uniao estavel nem preencher a data da
entrevista que faltou. Por isso aqui ficam guardados os DADOS e cada anexo separado.

Regra que atravessa o arquivo: **correcao nao sobrescreve**. Cada geracao vira uma
versao nova, numerada. A operadora pode ja ter recebido a anterior, e apagar o que foi
enviado e perder a unica prova do que foi enviado.

Situacoes, na ordem em que a proposta anda:

    rascunho     o consultor esta montando
    em_analise   mandou para o gestor conferir
    correcao     o gestor devolveu apontando o que falta
    aprovado     o gestor liberou
    enviado      foi para a operadora
"""
import datetime
import json
import os
import sqlite3
import uuid

DADOS_DIR = os.environ.get('DADOS_DIR', '/data')
BANCO = os.path.join(DADOS_DIR, 'historico.db')
ANEXOS = os.path.join(DADOS_DIR, 'anexos')
VERSOES = os.path.join(DADOS_DIR, 'contratos')

SITUACOES = {
    'rascunho':   'Rascunho',
    'em_analise': 'Em análise',
    'correcao':   'Correção',
    'aprovado':   'Aprovado',
    'enviado':    'Enviado à operadora',
}
# Quem pode levar a proposta para cada situacao. O consultor monta e devolve corrigido;
# julgar se esta bom e liberar para a operadora e do gestor.
SO_GESTOR = {'correcao', 'aprovado', 'enviado'}

ESQUEMA = """
CREATE TABLE IF NOT EXISTS proposta (
    id           TEXT PRIMARY KEY,
    criado_em    TEXT NOT NULL,
    atualizado_em TEXT NOT NULL,
    consultor_id INTEGER,
    situacao     TEXT NOT NULL DEFAULT 'rascunho',
    empresa      TEXT,
    cnpj         TEXT,
    titular      TEXT,
    vidas        INTEGER,
    dados_json   TEXT,
    pendencia    TEXT              -- o que o gestor apontou, em aberto
);
CREATE TABLE IF NOT EXISTS anexo (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    proposta_id TEXT NOT NULL,
    chave       TEXT NOT NULL,     -- cartao_cnpj, doc_titular, parentesco_conjuge...
    nome        TEXT NOT NULL,     -- nome original do arquivo
    arquivo     TEXT NOT NULL,     -- nome em disco, dentro de ANEXOS
    bytes       INTEGER,
    criado_em   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evento (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    proposta_id  TEXT NOT NULL,
    quando       TEXT NOT NULL,
    usuario_id   INTEGER,
    usuario_nome TEXT,
    tipo         TEXT NOT NULL,
    texto        TEXT
);
CREATE TABLE IF NOT EXISTS versao (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    proposta_id TEXT NOT NULL,
    numero      INTEGER NOT NULL,
    arquivo     TEXT NOT NULL,
    bytes       INTEGER,
    paginas     INTEGER,
    pendencias  TEXT,
    criado_em   TEXT NOT NULL,
    usuario_nome TEXT
);
CREATE INDEX IF NOT EXISTS ix_anexo_prop  ON anexo(proposta_id);
CREATE INDEX IF NOT EXISTS ix_evento_prop ON evento(proposta_id);
CREATE INDEX IF NOT EXISTS ix_versao_prop ON versao(proposta_id);
CREATE INDEX IF NOT EXISTS ix_prop_sit    ON proposta(situacao);
"""


def _conectar():
    os.makedirs(ANEXOS, exist_ok=True)
    os.makedirs(VERSOES, exist_ok=True)
    con = sqlite3.connect(BANCO, timeout=10)
    con.row_factory = sqlite3.Row
    return con


def _agora():
    return datetime.datetime.now().isoformat(timespec='seconds')


def iniciar():
    try:
        with _conectar() as con:
            con.executescript(ESQUEMA)
        return True
    except Exception:
        return False


def _resumo_dos_dados(dados):
    """Puxa para colunas proprias o que a lista de gestao precisa mostrar, para nao
    ter que abrir e interpretar o JSON de cada proposta a cada carregamento."""
    empresa = dados.get('empresa') or {}
    grupos = dados.get('titulares') or []
    titular = ((grupos[0] or {}).get('titular') or {}).get('nome', '') if grupos else ''
    vidas = sum(1 + len(g.get('dependentes') or []) for g in grupos)
    return empresa.get('razao_social', ''), empresa.get('cnpj', ''), titular, vidas


def registrar_evento(pid, usuario, tipo, texto=''):
    try:
        with _conectar() as con:
            con.execute(
                'INSERT INTO evento (proposta_id, quando, usuario_id, usuario_nome, '
                'tipo, texto) VALUES (?,?,?,?,?,?)',
                (pid, _agora(), (usuario or {}).get('id'),
                 (usuario or {}).get('nome', 'sistema'), tipo, texto))
    except Exception:
        pass          # historico nunca derruba a operacao que o corretor pediu


def salvar(dados, usuario, pid=None):
    """Cria ou atualiza a proposta. Devolve o id."""
    empresa, cnpj, titular, vidas = _resumo_dos_dados(dados)
    agora = _agora()
    texto = json.dumps(dados, ensure_ascii=False)
    with _conectar() as con:
        if pid:
            con.execute(
                'UPDATE proposta SET atualizado_em=?, empresa=?, cnpj=?, titular=?, '
                'vidas=?, dados_json=? WHERE id=?',
                (agora, empresa, cnpj, titular, vidas, texto, pid))
            return pid
        pid = uuid.uuid4().hex[:12]
        con.execute(
            'INSERT INTO proposta (id, criado_em, atualizado_em, consultor_id, situacao, '
            'empresa, cnpj, titular, vidas, dados_json) VALUES (?,?,?,?,?,?,?,?,?,?)',
            (pid, agora, agora, (usuario or {}).get('id'), 'rascunho',
             empresa, cnpj, titular, vidas, texto))
    registrar_evento(pid, usuario, 'criou', f'{empresa} · {titular}')
    return pid


def obter(pid):
    try:
        with _conectar() as con:
            p = con.execute('SELECT * FROM proposta WHERE id=?', (pid,)).fetchone()
            if not p:
                return None
            d = dict(p)
            try:
                d['dados'] = json.loads(d.get('dados_json') or '{}')
            except Exception:
                d['dados'] = {}
            d['anexos'] = [dict(a) for a in con.execute(
                'SELECT * FROM anexo WHERE proposta_id=? ORDER BY chave, id', (pid,))]
            d['eventos'] = [dict(e) for e in con.execute(
                'SELECT * FROM evento WHERE proposta_id=? ORDER BY id DESC', (pid,))]
            versoes = []
            for v in con.execute(
                    'SELECT * FROM versao WHERE proposta_id=? ORDER BY numero DESC', (pid,)):
                x = dict(v)
                try:
                    x['pendencias'] = json.loads(x.get('pendencias') or '[]')
                except Exception:
                    x['pendencias'] = []
                versoes.append(x)
            d['versoes'] = versoes
        return d
    except Exception:
        return None


def listar(situacao=None, consultor_id=None, limite=300):
    """Lista para a tela de gestao. consultor_id filtra para o consultor ver so as
    dele; o gestor chama sem filtro."""
    sql = ('SELECT p.*, (SELECT COUNT(*) FROM versao v WHERE v.proposta_id=p.id) versoes '
           'FROM proposta p WHERE 1=1')
    args = []
    if situacao:
        sql += ' AND p.situacao = ?'
        args.append(situacao)
    if consultor_id:
        sql += ' AND p.consultor_id = ?'
        args.append(consultor_id)
    sql += ' ORDER BY p.atualizado_em DESC LIMIT ?'
    args.append(limite)
    try:
        with _conectar() as con:
            return [dict(l) for l in con.execute(sql, args)]
    except Exception:
        return []


def contar_por_situacao():
    try:
        with _conectar() as con:
            linhas = con.execute(
                'SELECT situacao, COUNT(*) n FROM proposta GROUP BY situacao').fetchall()
        return {l['situacao']: l['n'] for l in linhas}
    except Exception:
        return {}


def mudar_situacao(pid, nova, usuario, texto=''):
    """Move a proposta. Devolve mensagem de erro, ou None se deu certo."""
    if nova not in SITUACOES:
        return 'Situação inválida.'
    if nova in SO_GESTOR and (usuario or {}).get('papel') != 'gestor':
        return 'Só um gestor pode fazer isso.'
    if nova == 'correcao' and not (texto or '').strip():
        return 'Escreva o que precisa ser corrigido — é isso que o consultor vai ler.'
    try:
        with _conectar() as con:
            atual = con.execute('SELECT situacao FROM proposta WHERE id=?', (pid,)).fetchone()
            if not atual:
                return 'Proposta não encontrada.'
            con.execute(
                'UPDATE proposta SET situacao=?, atualizado_em=?, pendencia=? WHERE id=?',
                (nova, _agora(), texto if nova == 'correcao' else '', pid))
    except Exception as e:
        return f'Não foi possível mudar a situação: {e}'
    registrar_evento(pid, usuario, nova, texto or f'passou para {SITUACOES[nova]}')
    return None


# ──────────────────────────── anexos ────────────────────────────

def guardar_anexo(pid, chave, nome_arquivo, conteudo, usuario=None):
    """Guarda um documento. Substitui o que ja existia nessa chave - trocar o contrato
    social e justamente o que o corretor quer poder fazer sem refazer a proposta."""
    try:
        with _conectar() as con:
            antigos = con.execute('SELECT arquivo FROM anexo WHERE proposta_id=? AND chave=?',
                                  (pid, chave)).fetchall()
            for a in antigos:
                try:
                    os.remove(os.path.join(ANEXOS, a['arquivo']))
                except OSError:
                    pass
            con.execute('DELETE FROM anexo WHERE proposta_id=? AND chave=?', (pid, chave))

            interno = f'{pid}_{chave}_{uuid.uuid4().hex[:8]}'
            with open(os.path.join(ANEXOS, interno), 'wb') as f:
                f.write(conteudo)
            con.execute(
                'INSERT INTO anexo (proposta_id, chave, nome, arquivo, bytes, criado_em) '
                'VALUES (?,?,?,?,?,?)',
                (pid, chave, nome_arquivo, interno, len(conteudo), _agora()))
        return True
    except Exception:
        return False


def anexos_para_montagem(pid):
    """Devolve {chave: [(nome, bytes)]}, no formato que montagem.montar() espera."""
    saida = {}
    try:
        with _conectar() as con:
            linhas = con.execute('SELECT * FROM anexo WHERE proposta_id=? ORDER BY chave, id',
                                 (pid,)).fetchall()
        for a in linhas:
            caminho = os.path.join(ANEXOS, a['arquivo'])
            if not os.path.exists(caminho):
                continue
            with open(caminho, 'rb') as f:
                saida.setdefault(a['chave'], []).append((a['nome'], f.read()))
    except Exception:
        return saida
    return saida


def remover_anexo(pid, chave):
    try:
        with _conectar() as con:
            for a in con.execute('SELECT arquivo FROM anexo WHERE proposta_id=? AND chave=?',
                                 (pid, chave)).fetchall():
                try:
                    os.remove(os.path.join(ANEXOS, a['arquivo']))
                except OSError:
                    pass
            con.execute('DELETE FROM anexo WHERE proposta_id=? AND chave=?', (pid, chave))
        return True
    except Exception:
        return False


# ──────────────────────────── versoes ────────────────────────────

def guardar_versao(pid, pdf, roteiro, usuario=None):
    """Grava mais uma versao do contrato. Nunca substitui a anterior."""
    try:
        faltantes = [r.get('etapa', '?') for r in roteiro if not r.get('ok')]
        with _conectar() as con:
            n = con.execute('SELECT COALESCE(MAX(numero),0) m FROM versao WHERE proposta_id=?',
                            (pid,)).fetchone()['m'] + 1
            interno = f'{pid}_v{n}.pdf'
            with open(os.path.join(VERSOES, interno), 'wb') as f:
                f.write(pdf)
            con.execute(
                'INSERT INTO versao (proposta_id, numero, arquivo, bytes, paginas, '
                'pendencias, criado_em, usuario_nome) VALUES (?,?,?,?,?,?,?,?)',
                (pid, n, interno, len(pdf),
                 sum(r.get('paginas', 0) for r in roteiro if r.get('ok')),
                 json.dumps(faltantes, ensure_ascii=False), _agora(),
                 (usuario or {}).get('nome', '')))
        registrar_evento(pid, usuario, 'gerou',
                         f'versão {n}' + (f' · {len(faltantes)} pendência(s)' if faltantes else ' · completo'))
        return n
    except Exception:
        return None


def excluir(pid):
    """Apaga a proposta, os anexos, as versoes e o historico dela.

    Existe para limpar duplicata - nao para desfazer trabalho. Por isso a tela so
    oferece em rascunho: proposta que ja foi para analise ou para a operadora tem
    historico que alguem pode precisar."""
    try:
        with _conectar() as con:
            arquivos = [a['arquivo'] for a in con.execute(
                'SELECT arquivo FROM anexo WHERE proposta_id=?', (pid,))]
            versoes = [v['arquivo'] for v in con.execute(
                'SELECT arquivo FROM versao WHERE proposta_id=?', (pid,))]
            for nome in arquivos:
                try:
                    os.remove(os.path.join(ANEXOS, nome))
                except OSError:
                    pass
            for nome in versoes:
                try:
                    os.remove(os.path.join(VERSOES, nome))
                except OSError:
                    pass
            for tabela in ('anexo', 'evento', 'versao'):
                con.execute(f'DELETE FROM {tabela} WHERE proposta_id=?', (pid,))
            con.execute('DELETE FROM proposta WHERE id=?', (pid,))
        return True
    except Exception:
        return False


def caminho_versao(pid, numero=None):
    """Caminho do PDF de uma versao (a ultima, se numero for None)."""
    try:
        with _conectar() as con:
            if numero:
                v = con.execute('SELECT arquivo FROM versao WHERE proposta_id=? AND numero=?',
                                (pid, numero)).fetchone()
            else:
                v = con.execute('SELECT arquivo FROM versao WHERE proposta_id=? '
                                'ORDER BY numero DESC LIMIT 1', (pid,)).fetchone()
        if not v:
            return None
        caminho = os.path.join(VERSOES, v['arquivo'])
        return caminho if os.path.exists(caminho) else None
    except Exception:
        return None
