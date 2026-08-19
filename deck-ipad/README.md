# Deck do iPad

Transforma o iPad num painel de botões que executa coisas **no MacBook**:
rodar script, abrir tela, apertar atalho de teclado, colar texto, mudar volume.

Não é aplicativo de loja e não precisa de assinatura. O Mac serve uma página, o
iPad abre no Safari e "Adicionar à Tela de Início" faz o resto: vira ícone e
abre em tela cheia, sem barra de navegador.

## Ligar

Duplo-clique em **`Ligar deck.command`**. Abre uma janela do Terminal com o
endereço e o PIN. Fechar a janela desliga o deck.

Pelo terminal, se preferir:

```bash
python3 deck-ipad/servidor.py
```

## Parear o iPad (uma vez só)

1. No iPad, Safari, abra o endereço que apareceu na janela do Mac
   (algo como `http://192.168.68.59:8765`) — os dois no mesmo Wi-Fi.
2. Digite o PIN de quatro dígitos que está na janela do Mac.
3. Toque em Compartilhar > **Adicionar à Tela de Início**.

O pareamento fica guardado no aparelho. Reiniciar o deck não pede PIN de novo —
o PIN novo só serve para parear um aparelho novo.

## Permissão do macOS

Os botões que **apertam teclas** (captura de tela, Mission Control) e os que
**colam texto** dependem de uma autorização do sistema. Sem ela, o Mac bloqueia
e o deck avisa na tela, em vez de fingir que funcionou.

Para liberar: Ajustes do Sistema > Privacidade e Segurança > **Acessibilidade** >
ligue a chave do **Terminal** (ou do app de onde o deck foi iniciado) e ligue o
deck de novo.

Tudo o mais — rodar script, abrir app, abrir site, volume, apagar a tela —
funciona sem permissão nenhuma.

## Enviar mensagem e funil pelo iPad

A tela **WhatsApp** do deck não tem botão fixo: ela mostra a biblioteca de
mensagens e os funis que você tem hoje, e o nome de quem está na conversa aberta
no WhatsApp Web do Mac. Você toca, confere o texto no preview, confirma — e a
mensagem sai naquela conversa.

Quem envia é a **extensão do JOB**, pelo mesmo caminho do painel dentro do
WhatsApp: mesma fila, mesmo registro no CRM, mesmo intervalo anti-bloqueio. O
deck não fala com o WhatsApp; ele só pede.

Para funcionar, três coisas ao mesmo tempo:

1. o deck ligado no Mac;
2. o Chrome aberto com o **WhatsApp Web** e a extensão do JOB instalada;
3. uma **conversa aberta** lá.

Faltando qualquer uma, a tela do iPad diz qual é e o que fazer — e os cartões
ficam desligados em vez de fingir que enviam.

### O que protege contra mandar para a pessoa errada

- O comando carrega o identificador da conversa que estava aberta quando você
  tocou. Antes de enviar, a extensão confere se ainda é a mesma. Mudou? Não
  envia, e o iPad avisa.
- Comando que fica **mais de 90 segundos** sem a extensão pegar morre na fila.
  Mensagem atrasada chega fora de hora — já aconteceu neste projeto.
- Quando o servidor segura a mensagem pelo intervalo anti-bloqueio, o iPad diz
  exatamente isso ("sai sozinha em ~8s"), nunca "enviado".

### Depois de mexer na extensão

O Chrome carrega a extensão da pasta `extensao-whatsapp/` do repositório
principal. Mudança feita aqui só vale depois de:

1. sincronizar/mesclar o código;
2. `chrome://extensions` > botão de recarregar (↻) na extensão do JOB;
3. **F5 na aba do WhatsApp Web** — sem isso a aba continua rodando a versão
   velha do content script.

### Como o Chrome e o deck se acham

A extensão procura o deck **uma vez por minuto** enquanto ele está desligado —
um pedido a `127.0.0.1`, sem envolver a aba do WhatsApp. Achou, passa a
conversar a cada 2 segundos, e volta a 10 segundos quando o iPad não está com a
tela do WhatsApp aberta. Três falhas seguidas e ela dorme de novo.

Isso não é capricho: em 14/08/2026 um laço de 2 segundos em segundo plano levou
o Chrome a 4,4 GB e travou o navegador. A regra virou verificação no
`scripts/checar_extensao.sh` e vale para este laço também.

Se você acabou de ligar o deck e não quer esperar o minuto, clique uma vez na
aba do WhatsApp Web: ela avisa a extensão na hora.

## Mudar os botões

Tudo mora em [`botoes.json`](botoes.json). Salvou o arquivo, toque em
**Recarregar botões** no iPad: não precisa reiniciar nada.

Cada botão:

```json
{
  "id": "identificador_unico",
  "rotulo": "O que o botão faz",
  "dica": "A condição ou a consequência, em uma linha",
  "icone": "raio",
  "cuidado": true,
  "confirmar": "Texto da folha de confirmação, quando a ação é cara ou difícil de desfazer",
  "acao": { "tipo": "shell", "comando": "..." }
}
```

### Tipos de ação

| tipo | o que faz | campos |
|---|---|---|
| `shell` | roda um comando na pasta do repositório | `comando`, `tempo_max` |
| `applescript` | roda AppleScript | `script` |
| `abrir` | abre app, arquivo ou site | `alvo`, `aplicativo` (false para caminho) |
| `atalho` | roda um atalho do app Atalhos | `nome` |
| `teclas` | aperta uma combinação | `combinacao` (`"cmd+shift+4"`) |
| `texto` | copia e cola no app da frente | `texto`, `colar` |
| `url` | chama um endereço HTTP | `endereco`, `metodo`, `corpo`, `cabecalhos` |
| `sequencia` | executa passos em ordem, para no primeiro erro | `passos` |

### Tipos de controle

- **botão** (padrão): toca e roda.
- **`alternar`**: liga/desliga e mostra o estado atual. Precisa de `consulta`
  (comando que responde `1` ou `0`), `ligar` e `desligar`.
- **`deslizante`**: barra de 0 a 100. Precisa de `minimo`, `maximo`, `passo` e
  uma ação com `{valor}` no meio do comando. `consulta` (opcional) faz a barra
  nascer no valor de verdade.

### Ícones

`raio` `link` `conversa` `banco` `olho` `lupa` `engrenagem` `tela` `nuvem`
`microfone` `microfone-mudo` `volume` `cadeado` `camera` `janela` `terminal`
`pasta` `texto`

## O que o deck faz para não te enganar

- **Toda ação tem reação.** O botão trava enquanto roda, mostra a barra de
  andamento, e diz `pronto` com o tempo que levou ou `falhou`.
- **Falha não some.** O botão que falhou fica vermelho até você tocar nele e ler
  a saída de verdade do comando — a mesma que sairia no terminal.
- **Ação cara pede confirmação**, numa folha em que o "não fazer" fica longe do
  botão que executa.
- **Toda condição está escrita na tela**: permissão que falta, o que cada botão
  vai fazer, e se o Mac parou de responder.

## Segurança

- Só aceita comando de aparelho na **rede local** (10.x, 172.16–31.x, 192.168.x).
- A ponte da extensão (`/api/extensao/*`) só atende o **próprio Mac** e exige um
  cabeçalho que página nenhuma da internet manda sem pedir licença antes.
- O iPad precisa do **PIN** para parear; depois usa um token guardado em
  `deck-ipad/.token` (fora do Git). Cinco PINs errados travam o pareamento até
  religar o deck.
- Todo disparo fica em `deck-ipad/registro.log` (fora do Git).
- O iPad nunca recebe o comando que será executado — só o rótulo e o feitio do
  botão.

Isso protege contra o vizinho de Wi-Fi, não contra quem já está dentro da sua
rede com má intenção. Não exponha a porta 8765 na internet.

## Limites conhecidos

- Um deck por Mac: o servidor precisa estar ligado para o iPad funcionar.
- Comando que passa de `tempo_max` (padrão 300s) é encerrado.
- O deck para de perguntar o estado quando a tela do iPad apaga, e volta a
  perguntar assim que ela acende — é economia de bateria, não travamento.
