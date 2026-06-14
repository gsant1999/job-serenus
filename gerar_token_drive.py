#!/usr/bin/env python3
"""
GERAR TOKEN DO GOOGLE DRIVE (OAuth) — rode UMA vez.

Isso resolve de vez o erro de "os arquivos não sobem": com OAuth, o sistema
sobe os contratos COMO VOCÊ (usando seus 15GB do Drive), em vez da conta de
serviço (que não tem cota e por isso só criava as pastas vazias).

──────────────────────────────────────────────────────────────────────────────
PASSO A PASSO (só na primeira vez):

1) No Google Cloud Console (mesmo projeto da conta de serviço):
   APIs e Serviços → Credenciais → Criar credenciais → ID do cliente OAuth
   → Tipo: "App para computador" (Desktop app) → Criar.
   Baixe o JSON e salve nesta pasta com o nome:  client_oauth.json

2) Em "APIs e Serviços → Tela de consentimento OAuth", adicione seu e-mail
   em "Usuários de teste" (se o app estiver em modo Teste).

3) No Terminal, dentro da pasta do sistema, rode:
       pip3 install google-auth-oauthlib
       python3 gerar_token_drive.py

4) Vai abrir o navegador. Faça login com a conta dona da pasta CONTRATO SERENUS
   e autorize. Pronto: cria o token_drive.json e os uploads passam a funcionar.
──────────────────────────────────────────────────────────────────────────────
"""
import os, sys

SCOPES = ["https://www.googleapis.com/auth/drive"]
AQUI = os.path.dirname(os.path.abspath(__file__))
CLIENT = os.path.join(AQUI, "client_oauth.json")
TOKEN = os.path.join(AQUI, "token_drive.json")

def main():
    if not os.path.exists(CLIENT):
        print("\n❌ Falta o arquivo 'client_oauth.json' nesta pasta.")
        print("   Crie o ID do cliente OAuth (App para computador) no Google Cloud")
        print("   Console, baixe o JSON e salve aqui como client_oauth.json.\n")
        sys.exit(1)
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        print("\n❌ Falta a biblioteca. Rode antes:")
        print("     pip3 install google-auth-oauthlib\n")
        sys.exit(1)

    flow = InstalledAppFlow.from_client_secrets_file(CLIENT, SCOPES)
    creds = flow.run_local_server(port=0)
    with open(TOKEN, "w") as f:
        f.write(creds.to_json())
    print(f"\n✅ Token salvo em token_drive.json")
    print("   Agora os contratos vão subir no Drive normalmente. Reinicie o sistema.\n")

if __name__ == "__main__":
    main()
