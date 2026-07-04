#!/usr/bin/env python3
"""
DEPLOY JOB SERENUS
==================
Uso: python3 deploy.py <arquivo_novo.py> "mensagem do commit"

Exemplo:
  python3 deploy.py ~/Downloads/app_r2_boto3.py "fix: corrigir upload R2"
  python3 deploy.py ~/Downloads/app_novo.py "feat: painel do corretor"
"""

import sys
import os
import shutil
import subprocess

REPO = '/Users/guilhermesantos/Desktop/job-serenus'

def run(cmd):
    result = subprocess.run(cmd, shell=True, cwd=REPO, capture_output=True, text=True)
    if result.stdout: print(result.stdout.strip())
    if result.stderr: print(result.stderr.strip())
    return result.returncode

def main():
    if len(sys.argv) < 3:
        print("USO: python3 deploy.py <arquivo.py> \"mensagem\"")
        print("EX:  python3 deploy.py ~/Downloads/app_novo.py \"feat: nova feature\"")
        sys.exit(1)

    arquivo = os.path.expanduser(sys.argv[1])
    mensagem = sys.argv[2]

    print(f"\n🚀 DEPLOY JOB SERENUS")
    print(f"   Arquivo: {arquivo}")
    print(f"   Mensagem: {mensagem}")
    print("")

    # 1. Verifica arquivo existe
    if not os.path.exists(arquivo):
        print(f"❌ Arquivo não encontrado: {arquivo}")
        sys.exit(1)
    linhas = len(open(arquivo).readlines())
    print(f"✅ Arquivo encontrado: {linhas} linhas")

    # 2. Backup do app.py atual
    shutil.copy(f"{REPO}/app.py", f"{REPO}/app.py.backup")
    print(f"✅ Backup criado: app.py.backup")

    # 3. Copia arquivo novo
    shutil.copy(arquivo, f"{REPO}/app.py")
    print(f"✅ app.py atualizado")

    # 4. Git: força envio sem conflito
    print(f"\n📤 Enviando para GitHub...")
    run("git fetch origin main")
    run("git reset --soft origin/main")
    run("git add app.py")
    code = run(f'git commit -m "{mensagem}"')
    if code != 0:
        print("⚠️  Nada novo para commitar")
    run("git push origin main")

    print(f"\n✅ DEPLOY CONCLUÍDO!")
    print(f"   Railway vai redeploy em 2-3 minutos")
    print(f"   URL: https://job-serenus-production.up.railway.app")

if __name__ == '__main__':
    main()
