#!/usr/bin/env python3
"""Fotografa a Biblioteca de Conteudo sem escrever nada no banco.

Existe para responder uma pergunta so: "a reorganizacao perdeu alguma coisa?".
Roda antes da mudanca, roda depois, e compara. Conta itens por canal, por dono e
por pasta, e confere se cada referencia de Fluxo (`fluxo_passos.template` no
formato `upload_<id>`) e cada passo de Funil ainda encontram o conteudo original.

Somente leitura por construcao: no SQLite abre com `mode=ro` (o driver recusa
qualquer escrita) e no Postgres abre a transacao como READ ONLY. Nao importa o
`app.py` de proposito — importar o app roda o `init_db`, que cria tabela e
coluna que faltarem, e isso ja seria uma escrita.

Uso:
    python3 scripts/inspecionar_biblioteca.py
    python3 scripts/inspecionar_biblioteca.py --salvar /tmp/antes.json
    python3 scripts/inspecionar_biblioteca.py --comparar /tmp/antes.json

Banco: usa DATABASE_URL se existir; senao o SQLite de JOB_DATA_DIR (ou /data,
ou ~/JOB_Serenus_Dados), a mesma ordem do app.
"""
import argparse
import hashlib
import json
import os
import sqlite3
import sys


def _caminho_sqlite():
    env_dir = os.environ.get('JOB_DATA_DIR')
    if env_dir and os.path.isdir(env_dir):
        return os.path.join(env_dir, 'job.db')
    if os.path.isdir('/data'):
        return os.path.join('/data', 'job.db')
    return os.path.join(os.path.expanduser('~'), 'JOB_Serenus_Dados', 'job.db')


class Leitor:
    """Fachada minima sobre sqlite3/psycopg2 com placeholder unico (?)."""

    def __init__(self):
        self.url = os.environ.get('DATABASE_URL')
        if self.url:
            import psycopg2
            import psycopg2.extras
            self.modo = 'postgres'
            self.conn = psycopg2.connect(self.url)
            self.conn.set_session(readonly=True, autocommit=True)
            self._cur = self.conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        else:
            caminho = _caminho_sqlite()
            if not os.path.exists(caminho):
                raise SystemExit('Banco nao encontrado em %s. Defina JOB_DATA_DIR '
                                 'ou DATABASE_URL.' % caminho)
            self.modo = 'sqlite'
            self.origem = caminho
            self.conn = sqlite3.connect('file:%s?mode=ro' % caminho, uri=True)
            self.conn.row_factory = sqlite3.Row
        if self.url:
            self.origem = 'postgres'

    def linhas(self, sql, params=()):
        if self.modo == 'postgres':
            self._cur.execute(sql.replace('?', '%s'), params)
            return [dict(r) for r in self._cur.fetchall()]
        return [dict(r) for r in self.conn.execute(sql, params).fetchall()]

    def um(self, sql, params=()):
        r = self.linhas(sql, params)
        return r[0] if r else {}

    def tem_tabela(self, nome):
        if self.modo == 'postgres':
            return bool(self.linhas(
                "SELECT 1 FROM information_schema.tables WHERE table_name=?", (nome,)))
        return bool(self.linhas(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (nome,)))

    def fechar(self):
        try:
            self.conn.close()
        except Exception:
            pass


def _impressao(linhas):
    """Assinatura estavel de um conjunto de linhas: muda se qualquer campo mudar."""
    texto = '\n'.join('|'.join('' if v is None else str(v) for v in sorted(l.items()))
                      for l in linhas)
    return hashlib.sha256(texto.encode('utf-8')).hexdigest()[:16]


def fotografar(leitor):
    foto = {'origem': leitor.origem}

    foto['modelos_por_canal'] = {
        r['tipo'] or '(sem tipo)': r['n'] for r in leitor.linhas(
            "SELECT tipo, COUNT(*) AS n FROM modelos_conteudo GROUP BY tipo ORDER BY tipo")}
    foto['modelos_total'] = leitor.um("SELECT COUNT(*) AS n FROM modelos_conteudo").get('n', 0)
    foto['modelos_ativos'] = leitor.um(
        "SELECT COUNT(*) AS n FROM modelos_conteudo WHERE COALESCE(ativo,1)=1").get('n', 0)
    foto['modelos_por_midia'] = {
        (r['midia_tipo'] or 'texto'): r['n'] for r in leitor.linhas(
            "SELECT midia_tipo, COUNT(*) AS n FROM modelos_conteudo GROUP BY midia_tipo")}
    foto['modelos_com_midia'] = leitor.um(
        "SELECT COUNT(*) AS n FROM modelos_conteudo "
        "WHERE midia_arquivo IS NOT NULL AND midia_arquivo <> ''").get('n', 0)
    foto['modelos_sem_pasta'] = leitor.um(
        "SELECT COUNT(*) AS n FROM modelos_conteudo WHERE pasta_id IS NULL").get('n', 0)
    foto['modelos_sem_dono'] = leitor.um(
        "SELECT COUNT(*) AS n FROM modelos_conteudo WHERE dono_consultor_id IS NULL").get('n', 0)
    foto['modelos_por_dono'] = {
        str(r['dono_consultor_id'] or 'compartilhado'): r['n'] for r in leitor.linhas(
            "SELECT dono_consultor_id, COUNT(*) AS n FROM modelos_conteudo "
            "GROUP BY dono_consultor_id")}

    foto['funis_total'] = leitor.um("SELECT COUNT(*) AS n FROM whatsapp_funis").get('n', 0)
    foto['funis_ativos'] = leitor.um(
        "SELECT COUNT(*) AS n FROM whatsapp_funis WHERE COALESCE(ativo,1)=1").get('n', 0)
    foto['funil_passos_total'] = leitor.um(
        "SELECT COUNT(*) AS n FROM whatsapp_funil_passos").get('n', 0)
    foto['funil_passos_orfaos'] = leitor.um(
        "SELECT COUNT(*) AS n FROM whatsapp_funil_passos p "
        "WHERE NOT EXISTS (SELECT 1 FROM modelos_conteudo m WHERE m.id=p.modelo_id)").get('n', 0)

    foto['pastas_total'] = leitor.um("SELECT COUNT(*) AS n FROM pastas").get('n', 0)
    foto['pastas_raiz'] = leitor.um(
        "SELECT COUNT(*) AS n FROM pastas WHERE parent_id IS NULL").get('n', 0)

    if leitor.tem_tabela('fluxo_passos'):
        refs = leitor.linhas(
            "SELECT id, fluxo_id, ordem, canal, template FROM fluxo_passos "
            "WHERE template LIKE 'upload_%' ORDER BY fluxo_id, ordem, id")
    else:
        refs = []
    foto['fluxo_refs_total'] = len(refs)
    quebradas = []
    for r in refs:
        try:
            mid = int(str(r['template']).split('_', 1)[1])
        except (ValueError, IndexError):
            quebradas.append({'passo': r['id'], 'template': r['template'], 'motivo': 'formato'})
            continue
        alvo = leitor.um("SELECT id, tipo, COALESCE(ativo,1) AS ativo "
                         "FROM modelos_conteudo WHERE id=?", (mid,))
        if not alvo:
            quebradas.append({'passo': r['id'], 'template': r['template'], 'motivo': 'sumiu'})
        elif not alvo.get('ativo'):
            quebradas.append({'passo': r['id'], 'template': r['template'], 'motivo': 'desativado'})
    foto['fluxo_refs_quebradas'] = quebradas
    foto['fluxo_refs_por_canal'] = {}
    for r in refs:
        canal = r['canal'] or '(sem canal)'
        foto['fluxo_refs_por_canal'][canal] = foto['fluxo_refs_por_canal'].get(canal, 0) + 1

    # Assinaturas: qualquer troca de ID, de vinculo ou de midia muda o hash.
    foto['assinatura_ids_modelos'] = _impressao(
        leitor.linhas("SELECT id, tipo FROM modelos_conteudo ORDER BY id"))
    foto['assinatura_midias'] = _impressao(leitor.linhas(
        "SELECT id, midia_arquivo, midia_tipo FROM modelos_conteudo "
        "WHERE midia_arquivo IS NOT NULL AND midia_arquivo <> '' ORDER BY id"))
    foto['assinatura_passos_funil'] = _impressao(leitor.linhas(
        "SELECT funil_id, ordem, modelo_id, delay_segundos FROM whatsapp_funil_passos "
        "ORDER BY funil_id, ordem, id"))
    foto['assinatura_refs_fluxo'] = _impressao(refs)
    foto['assinatura_conteudo'] = _impressao(leitor.linhas(
        "SELECT id, nome, assunto, corpo_html, corpo_texto FROM modelos_conteudo ORDER BY id"))
    return foto


CAMPOS_CRITICOS = [
    ('modelos_total', 'total de conteudos'),
    ('modelos_ativos', 'conteudos ativos'),
    ('modelos_com_midia', 'conteudos com midia'),
    ('funis_total', 'funis'),
    ('funil_passos_total', 'passos de funil'),
    ('fluxo_refs_total', 'referencias de Fluxo'),
    ('assinatura_ids_modelos', 'assinatura dos IDs'),
    ('assinatura_midias', 'assinatura das midias'),
    ('assinatura_passos_funil', 'assinatura dos passos de funil'),
    ('assinatura_refs_fluxo', 'assinatura das referencias de Fluxo'),
    ('assinatura_conteudo', 'assinatura do conteudo (nome, assunto, HTML, texto)'),
]


def imprimir(foto):
    print('Biblioteca de Conteudo — inspecao somente leitura (%s)' % foto['origem'])
    print('')
    print('Conteudos por canal:')
    for canal, n in sorted(foto['modelos_por_canal'].items()):
        print('   %-12s %d' % (canal, n))
    print('   %-12s %d (ativos: %d)' % ('TOTAL', foto['modelos_total'], foto['modelos_ativos']))
    print('')
    print('Conteudos por tipo de midia:')
    for tipo, n in sorted(foto['modelos_por_midia'].items()):
        print('   %-12s %d' % (tipo, n))
    print('')
    print('Organizacao:')
    print('   sem pasta (Sem localizacao): %d' % foto['modelos_sem_pasta'])
    print('   sem dono (Compartilhado):    %d' % foto['modelos_sem_dono'])
    print('   pastas: %d (raizes: %d)' % (foto['pastas_total'], foto['pastas_raiz']))
    print('')
    print('Funis: %d (ativos: %d) — passos: %d, apontando para conteudo inexistente: %d'
          % (foto['funis_total'], foto['funis_ativos'], foto['funil_passos_total'],
             foto['funil_passos_orfaos']))
    print('Referencias de Fluxo (upload_<id>): %d' % foto['fluxo_refs_total'])
    for canal, n in sorted(foto['fluxo_refs_por_canal'].items()):
        print('   %-12s %d' % (canal, n))
    if foto['fluxo_refs_quebradas']:
        print('   ATENCAO: %d referencia(s) sem alvo valido:' % len(foto['fluxo_refs_quebradas']))
        for q in foto['fluxo_refs_quebradas'][:20]:
            print('      passo %s -> %s (%s)' % (q['passo'], q['template'], q['motivo']))
    print('')
    print('Assinaturas (mudam se algum ID, vinculo ou conteudo mudar):')
    for chave in ('assinatura_ids_modelos', 'assinatura_midias', 'assinatura_passos_funil',
                  'assinatura_refs_fluxo', 'assinatura_conteudo'):
        print('   %-28s %s' % (chave.replace('assinatura_', ''), foto[chave]))


def comparar(antes, agora):
    print('')
    print('Comparacao com a foto anterior (%s -> %s):' % (antes.get('origem'), agora.get('origem')))
    problemas = []
    for chave, rotulo in CAMPOS_CRITICOS:
        a, b = antes.get(chave), agora.get(chave)
        if a == b:
            print('   igual    %-46s %s' % (rotulo, b))
        else:
            print('   MUDOU    %-46s %s -> %s' % (rotulo, a, b))
            problemas.append(rotulo)
    if problemas:
        print('')
        print('Mudou o que nao devia mudar numa reorganizacao: %s.' % ', '.join(problemas))
        print('Mover e transferir preservam ID, midia, conteudo e vinculo. '
              'Copiar e duplicar criam item novo — nesse caso o total sobe de proposito.')
        return 1
    print('')
    print('Nada se perdeu: contagens, IDs, midias, passos de funil e referencias de Fluxo iguais.')
    return 0


def main():
    p = argparse.ArgumentParser(description='Inspeciona a Biblioteca de Conteudo (somente leitura).')
    p.add_argument('--salvar', metavar='ARQUIVO', help='grava a foto em JSON')
    p.add_argument('--comparar', metavar='ARQUIVO', help='compara com uma foto salva antes')
    args = p.parse_args()

    leitor = Leitor()
    try:
        foto = fotografar(leitor)
    finally:
        leitor.fechar()

    imprimir(foto)
    if args.salvar:
        with open(args.salvar, 'w', encoding='utf-8') as fh:
            json.dump(foto, fh, ensure_ascii=False, indent=2)
        print('')
        print('Foto salva em %s' % args.salvar)
    if args.comparar:
        with open(args.comparar, encoding='utf-8') as fh:
            antes = json.load(fh)
        return comparar(antes, foto)
    return 0


if __name__ == '__main__':
    sys.exit(main())
