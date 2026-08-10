"""Monta o video narrado do Dia 1 a partir dos slides do deck.

Cada slide vira um PNG (Chrome headless com deep-link #n) e uma faixa de audio
(voz Luciana, pt-BR). ffmpeg junta imagem + audio por slide e concatena tudo.
"""
import subprocess, pathlib, shutil, json

REPO = pathlib.Path("/Users/guilhermesantos/Desktop/job-serenus/.claude/worktrees/consultoras-rotatividade-analise-8c5e06")
OUT = pathlib.Path("/private/tmp/claude-501/-Users-guilhermesantos-Desktop-job-serenus--claude-worktrees-consultoras-rotatividade-analise-8c5e06/e399b2a1-6233-4ab5-bc6d-7a019bd19b65/scratchpad/video")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DECK = REPO / "ONBOARDING_DIA1_APRESENTACAO.html"

# Narracao por slide. Texto falado, nao texto de slide: frases curtas, sem simbolo.
NARR = [
 "Bem-vinda, Aline. Hoje é o seu primeiro dia na Serenus. Este vídeo é um resumo do que você viu com a Bianca, para você rever quando quiser.",

 "Uma coisa antes de tudo: hoje você não vai aprender plano de saúde. Hoje você vai entender em que mercado entrou, pegar os seus acessos, aprender o sistema e ver venda de verdade acontecendo.",

 "O que a Serenus faz. A pessoa chega até nós porque preencheu um formulário ou pediu informação. Quase nunca porque já sabe o que quer. O nosso trabalho é entender a situação dela, mostrar a opção que faz sentido e conduzir até a contratação.",

 "E tem uma coisa importante: aqui ninguém liga para lista fria. Todo lead que chega para você é uma pessoa que pediu contato. Ela levantou a mão. Isso muda tudo na forma de abordar.",

 "Quem é quem. Guilherme é sócio e cuida de produto, regra de operadora e caso complexo. Danilo é sócio e cuida das ferramentas e dos acessos. Gabriel é sócio e cuida do marketing: é de onde vêm os seus leads. Karen cuida dos materiais. Bianca é a gestora comercial e é a sua chefe direta. E a Juliana é a consultora que é a nossa referência prática.",

 "Agora o mercado. Operadora é quem vende e opera o plano. A corretora, que somos nós, representa o cliente na escolha e é remunerada pela operadora. Guarde essa frase, porque você vai ouvir essa dúvida na primeira semana: o cliente não paga mais caro por comprar com a gente.",

 "Por que as pessoas compram plano de saúde? Quase nunca é preço. É quase sempre medo de precisar e não ter. É filho pequeno, é um diagnóstico na família, é ter saído do plano da empresa, é a fila do sistema público para um exame. A sua primeira tarefa em qualquer conversa é descobrir qual desses é o motivo dela.",

 "Existem três jeitos de contratar. Pessoa física, quando uma pessoa ou uma família contrata direto. Empresa, pelo CNPJ, em geral a partir de duas vidas. E adesão, por uma entidade de classe, como profissão ou sindicato. O preço muda muito entre eles para a mesma pessoa.",

 "A ANS é a Agência Nacional de Saúde Suplementar. É o órgão do governo que regula os planos de saúde. Operadora sem registro na ANS não é plano de saúde. Existe uma lista mínima que todo plano é obrigado a cobrir. E existe um limite de carência que nenhuma operadora pode ultrapassar.",

 "Esses limites são: vinte e quatro horas para urgência e emergência. Cento e oitenta dias para o geral, ou seja, consultas, exames e internação. Trezentos dias para parto. E até vinte e quatro meses para uma doença que a pessoa já tinha ao entrar. A operadora pode exigir menos que isso. Nunca mais.",

 "Uma coisa que ajuda muito na conversa: as regras não são invenção da operadora nem da Serenus. Boa parte do não pode que você vai ter que dizer ao cliente vem da ANS. Isso é um argumento, não é uma desculpa.",

 "Agora o funil da Serenus. São nove etapas. Novo Lead é quando ninguém falou com a pessoa ainda. Primeiro Contato é quando você já mandou mensagem ou ligou. Qualificação é quando ela respondeu e está conversando. Cotação Enviada é quando você já mandou opção e preço. Depois vem Venda Fechada, Emissão de Proposta e Status da Proposta. E existem duas saídas: Negociação Perdida e Nutrição, que é quando a pessoa tem interesse, mas não agora.",

 "E aqui está o que separa quem vende de quem não vende: quase ninguém compra na primeira conversa. A venda mora no follow-up. É voltar na pessoa que sumiu, no dia certo, com assunto novo. Um card parado em Cotação Enviada, sem tarefa marcada, é um lead perdido em câmara lenta.",

 "Quando o lead trava, marque sempre o motivo. São quatro: achou caro, silêncio, não é o momento, e aguardando resposta. O motivo não é para julgar você. Ele é o que diz qual conversa ter da próxima vez.",

 "Agora, como você ganha. São mil reais de ajuda de custo por mês, mais cinquenta por cento da mensalidade do primeiro mês de cada venda. Na prática: um plano de oitocentos reais por mês fechado são quatrocentos reais para você. Três vendas assim no mês são mil e duzentos reais em cima da ajuda de custo.",

 "E uma frase para você levar: você não está aqui para estudar plano de saúde. Você está aqui para aprender a vender plano de saúde. O estudo existe para melhorar a venda.",

 "Nas duas primeiras semanas, a sua nota não é venda. É atividade. Quantos leads você atendeu, quantas conversas de verdade você teve, quantas cotações você enviou, quantos follow-ups você fez, e se está tudo registrado no sistema. Venda é consequência e pode levar algumas semanas. Isso é normal.",

 "Regra número um, e é a mais importante de todas. Quando você não souber, a frase é: vou confirmar essa informação para você e já te retorno. Cliente aceita não saber. Cliente não perdoa informação errada. E informação errada sobre carência ou cobertura vira problema real depois, na hora em que a pessoa precisa usar o plano.",

 "Regra número dois: a quem perguntar. Primeiro você mesma, no material ou vendo como você fez da última vez. Depois a Bianca, para processo, sistema e como conduzir. Depois a Juliana, para saber como ela faria naquela conversa. E por último o Guilherme, para produto, regra e exceção, sempre pela Bianca. Perguntar não é problema. Perguntar a mesma coisa cinco vezes sem anotar é.",

 "E uma última: se não está no JOB, não aconteceu. Nada de caderno nem bloco de notas do celular. O que está fora do sistema ninguém consegue ajudar, cobrar nem defender. Inclusive a comissão, que é sua.",

 "Na quarta-feira você atende lead real. Você não precisa saber tudo. Precisa saber perguntar, registrar, e dizer: vou confirmar e já te retorno. Boa sorte, Aline.",
]

def sh(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)

def dur(path):
    r = sh(["ffprobe","-v","quiet","-print_format","json","-show_format",str(path)])
    return float(json.loads(r.stdout)["format"]["duration"])

if OUT.exists(): shutil.rmtree(OUT)
OUT.mkdir(parents=True)

n = len(NARR)
segs = []
for k in range(1, n+1):
    png, aiff, m4a, seg = OUT/f"s{k:02d}.png", OUT/f"s{k:02d}.aiff", OUT/f"s{k:02d}.m4a", OUT/f"s{k:02d}.mp4"
    sh([CHROME,"--headless","--disable-gpu","--hide-scrollbars","--force-device-scale-factor=1.5",
        "--window-size=1280,720",f"--screenshot={png}",f"file://{DECK}?full#{k}"])
    sh(["say","-v","Luciana","-r","172","-o",str(aiff),NARR[k-1]])
    sh(["ffmpeg","-y","-i",str(aiff),"-c:a","aac","-b:a","160k",str(m4a)])
    d = dur(m4a) + 1.0  # respiro no fim de cada slide
    sh(["ffmpeg","-y","-loop","1","-i",str(png),"-i",str(m4a),
        "-c:v","libx264","-preset","medium","-crf","20","-tune","stillimage",
        "-vf","scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0c0d10",
        "-r","12","-pix_fmt","yuv420p","-c:a","aac","-b:a","160k","-af","apad","-t",f"{d:.2f}",str(seg)])
    segs.append(seg); print(f"slide {k:02d}/{n}  {d:5.1f}s")

lista = OUT/"lista.txt"
lista.write_text("".join(f"file '{s}'\n" for s in segs))
final = REPO/"ONBOARDING_DIA1_VIDEO.mp4"
sh(["ffmpeg","-y","-f","concat","-safe","0","-i",str(lista),"-c","copy",str(final)])
print("\nvideo:", final, f"{dur(final)/60:.1f} min", f"{final.stat().st_size/1024/1024:.1f} MB")
