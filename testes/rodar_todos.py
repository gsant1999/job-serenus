"""Roda toda a bateria da entrega Affinity/Financeiro/Gestor, em ordem.

Cada arquivo de teste roda em processo separado, com JOB_DATA_DIR proprio. E de
proposito: os testes mexem nas mesmas tabelas e, no mesmo banco, um limparia o
cenario do outro — e o teste que quebrasse acusaria o arquivo errado.

No fim, esta bateria roda as REGRESSOES que a regra do projeto exige depois de
toda mudanca: uma rota antiga de proposta, a previa de antecipacao e a abertura
de um anexo. Feature nova que funciona e quebra o que ja existia nao esta pronta.

    JOB_MODO_TESTE=1 JOB_DATA_DIR=/tmp/jobtest python3 testes/rodar_todos.py
"""
import os
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
sys.path.insert(0, RAIZ)

ARQUIVOS = [
    ('Fase 1 — pré-conferência do extrato', 'testar_extrato_previa.py'),
    ('Fase 2 — importação e conciliação', 'testar_conciliacao_affinity.py'),
    ('Fase 3 — regra do gestor', 'testar_regra_gestor.py'),
    ('Fase 4 — histórico e financeiro integrado', 'testar_financeiro_integrado.py'),
]


def rodar_arquivo(rotulo, arquivo):
    print('\n' + '=' * 70)
    print(rotulo)
    print('=' * 70)
    env = dict(os.environ)
    env['JOB_MODO_TESTE'] = '1'
    env['JOB_DATA_DIR'] = tempfile.mkdtemp(prefix='jobtest-bateria-')
    r = subprocess.run([sys.executable, os.path.join(AQUI, arquivo)],
                       env=env, cwd=RAIZ, capture_output=True, text=True)
    saida = r.stdout + r.stderr
    # Só o essencial: as linhas de falha e o veredito. A saída completa de quatro
    # arquivos junta some com o resultado no meio do rolo.
    for linha in saida.splitlines():
        if linha.startswith('  FALHA') or linha.startswith('  - ') \
                or linha.startswith('FALHAS') or linha.startswith('PULADOS') \
                or linha.startswith('Tudo passou') or linha.startswith('    '):
            print(linha)
    ok = r.returncode == 0
    print(('OK — ' if ok else 'FALHOU — ') + arquivo)
    return ok


def regressoes():
    """As tres regressoes obrigatorias, num processo so."""
    print('\n' + '=' * 70)
    print('Regressão — rota antiga de proposta, prévia de antecipação e anexo')
    print('=' * 70)
    env = dict(os.environ)
    env['JOB_MODO_TESTE'] = '1'
    env['JOB_DATA_DIR'] = tempfile.mkdtemp(prefix='jobtest-regressao-')
    r = subprocess.run([sys.executable, os.path.join(AQUI, 'testar_regressao_basica.py')],
                       env=env, cwd=RAIZ, capture_output=True, text=True)
    for linha in (r.stdout + r.stderr).splitlines():
        if linha.strip().startswith(('ok', 'FALHA', '-', 'Tudo', 'FALHAS')):
            print(linha)
    ok = r.returncode == 0
    print('OK — regressão' if ok else 'FALHOU — regressão')
    return ok


if __name__ == '__main__':
    resultados = [(rot, rodar_arquivo(rot, arq)) for rot, arq in ARQUIVOS]
    resultados.append(('Regressão básica', regressoes()))
    print('\n' + '=' * 70)
    print('RESUMO')
    print('=' * 70)
    for rotulo, ok in resultados:
        print(('  OK     ' if ok else '  FALHOU ') + rotulo)
    if not all(ok for _r, ok in resultados):
        sys.exit(1)
    print('\nBateria completa passou.')
