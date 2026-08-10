"""Monta o video narrado do Dia 2 a partir dos slides do deck.

Mesmo motor do Dia 1: cada slide vira um PNG (Chrome headless com deep-link #n)
e uma faixa de audio (voz Luciana, pt-BR); o ffmpeg junta e concatena.

Os slides 14 a 17 (abertura do bloco de produtos e os tres produtos) ficam de
fora: sao molduras vazias esperando o Guilherme preencher. Quando estiverem
preenchidos, basta tirar do PULAR e escrever a narracao deles.
"""
import subprocess, pathlib, shutil, json

REPO = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path("/tmp/video-dia2")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DECK = REPO / "ONBOARDING_DIA2_APRESENTACAO.html"
TOTAL = 24
PULAR = {14, 15, 16, 17}

# Narracao por slide. Texto falado, nao texto de slide: frases curtas, sem
# simbolo, valores por extenso - a voz sintetica tropeca em "R$" e em "50%".
NARR = {
 1: "Segundo dia, Aline. Ontem você viu o que a gente faz. Hoje você vai entender como o produto funciona por dentro, e como conduzir uma conversa de verdade.",

 2: "Antes de começar, a Bianca vai te perguntar algumas coisas sobre ontem. O que você entendeu, qual o caminho que o cliente percorre, o que te pareceu mais difícil. E principalmente: se teve alguma hora em que você se perdeu e não quis perguntar. Responda com sinceridade, porque é assim que a gente ajusta o seu treinamento.",

 3: "Vamos aos conceitos. São oito, nenhum a mais, e todos com exemplo de gente de verdade.",

 4: "Primeiro: os três jeitos de contratar. Pessoa física, quando uma pessoa ou família contrata direto. Costuma ser o mais caro. Empresa, pelo CNPJ, em geral a partir de duas vidas, e costuma sair bem mais barato. Por isso a pergunta você tem empresa vale ouro. E adesão, por entidade de classe, que exige comprovar o vínculo. O mesmo casal pode ter três preços bem diferentes conforme o caminho.",

 5: "Titular é quem contrata o plano e responde por ele. Dependente é quem entra junto, como cônjuge e filhos. E vidas é quantas pessoas no total. Tem uma pergunta que você precisa fazer sempre, e cedo: quem vai usar o plano, e qual a idade de cada um? Sem isso não existe cotação.",

 6: "Carência é o tempo entre entrar no plano e poder usar cada coisa. Não é maldade da operadora: é o que impede a pessoa de contratar só quando adoece. Um exemplo: entrou hoje e amanhã quebra o braço, urgência é coberta em vinte e quatro horas. Entrou hoje e quer fazer uma cirurgia marcada, aí a espera pode chegar a cento e oitenta dias. Atenção, porque é aqui que a consultora mais erra.",

 7: "Os tetos que a ANS define são estes. Vinte e quatro horas para urgência e emergência. Cento e oitenta dias para o geral. Trezentos dias para parto. E até vinte e quatro meses para doença que a pessoa já tinha ao entrar. A operadora pode oferecer menos, e às vezes oferece, em campanha ou aproveitando o plano anterior. Nunca mais que isso.",

 8: "CPT é o que acontece quando a pessoa já tem uma doença ao entrar. A operadora pode limitar, por até vinte e quatro meses, o que for de alta complexidade ligado àquela doença. Por exemplo: um cliente com diabetes segue com consulta e exame de rotina normais depois da carência comum. O que pode ficar limitado é uma cirurgia de alta complexidade ligada à diabetes. E uma coisa séria: a pessoa tem que declarar. Omitir é fraude e pode custar o contrato dela lá na frente. Nunca oriente ninguém a esconder.",

 9: "Coparticipação é quando a pessoa paga menos por mês e paga um pouco a cada uso. Serve bem para quem usa pouco e quer o plano como proteção. Serve mal para quem vai ao médico direto, tem filho pequeno ou trata algo continuado. A pergunta que decide é simples: quantas vezes você foi ao médico no último ano?",

 10: "Acomodação é o tipo de quarto na internação. Enfermaria é dividido e mais barato. Apartamento é individual e mais caro. Isso muda o preço de forma relevante, e é uma das primeiras coisas para ajustar quando o cliente acha caro. Antes de trocar o plano inteiro, veja se dá para ajustar aqui.",

 11: "Rede credenciada é quais hospitais, laboratórios e médicos atendem aquele plano. Para muita gente, é a única coisa que importa de verdade. Então existe uma pergunta obrigatória em toda conversa: tem algum hospital ou médico que você faz questão de manter? Se a pessoa citar um hospital, isso vira o filtro da sua cotação. Vender um plano que não atende no hospital que ela queria é venda que volta como cancelamento.",

 12: "Faltam dois. Abrangência é onde o plano funciona: município, grupo de cidades, estado ou país. E reajuste é o aumento, que acontece uma vez por ano, e nos planos individuais é regulado pela ANS. Além do anual, o preço também sobe quando a pessoa muda de faixa de idade, e a última mudança acontece aos cinquenta e nove anos. Cliente que viaja pergunta abrangência. Cliente mais velho pergunta reajuste. Não fuja da pergunta: responda com o que você confirmou.",

 13: "E toda vez que você não tiver certeza, a frase continua a mesma: vou confirmar essa informação para você e já te retorno. Nenhum desses oito conceitos vale mais que essa frase. Errar carência ou rede é o tipo de erro que a pessoa descobre no pior dia da vida dela.",

 18: "Agora, a conversa. Como abrir, o que perguntar, e em que ordem.",

 19: "Os primeiros trinta segundos. Ela pediu contato, então não comece se desculpando por existir. Comece situando: seu nome, a Serenus, de onde veio o contato, e uma pergunta aberta. Por exemplo: me conta, o plano é para você ou para mais alguém da família? Pergunta aberta no fim. Se você abrir com posso te mandar uma cotação, a resposta vai ser sim, e você vai cotar no escuro.",

 20: "A qualificação tem oito perguntas, nesta ordem. Quem vai usar. A idade de cada um, que é o que faz o preço. A cidade, que define a rede disponível. Se tem CNPJ, que abre a porta do plano empresarial. Se tem plano hoje, porque pode aproveitar carência. Se tem algum hospital ou médico que faz questão. Se alguém está em tratamento ou tem alguma doença. E, por último, o que fez a pessoa procurar plano agora.",

 21: "Essa última é a pergunta que mais vale: o que te fez procurar um plano agora? A resposta dela é o que você vai usar no fechamento e em cada follow-up. Anote a frase dela, com as palavras dela, no registro do atendimento.",

 22: "Na hora de mandar a cotação, não mande preço solto. Errado é escrever: plano tal, seiscentos e vinte reais. Certo é dizer: pelo que você me contou, vocês dois, sua cidade e o hospital que você quer manter, essa é a opção que faz mais sentido, e é por isso. Preço sozinho só pode ser comparado com outro preço. Preço com motivo vira recomendação. E é recomendação que a pessoa contrata.",

 23: "Depois vem a prática. A Bianca vai fazer de cliente e você conduz do começo ao fim: abertura, as oito perguntas, e o que você recomendaria. Não precisa acertar preço nem plano. O que se avalia é se você fez as perguntas certas, na ordem certa, e se escutou a resposta. Depois vocês trocam, e você presta atenção no que ela pergunta que você não perguntou.",

 24: "E amanhã tem lead real na sua mão. Você não precisa saber tudo. Precisa saber perguntar, registrar, e dizer: vou confirmar e já te retorno. Bom trabalho, Aline.",
}


def sh(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def dur(path):
    r = sh(["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(path)])
    return float(json.loads(r.stdout)["format"]["duration"])


if OUT.exists():
    shutil.rmtree(OUT)
OUT.mkdir(parents=True)

segs = []
for k in range(1, TOTAL + 1):
    if k in PULAR:
        continue
    png, aiff, m4a, seg = OUT/f"s{k:02d}.png", OUT/f"s{k:02d}.aiff", OUT/f"s{k:02d}.m4a", OUT/f"s{k:02d}.mp4"
    sh([CHROME, "--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1.5",
        "--window-size=1280,720", f"--screenshot={png}", f"file://{DECK}?full#{k}"])
    sh(["say", "-v", "Luciana", "-r", "172", "-o", str(aiff), NARR[k]])
    sh(["ffmpeg", "-y", "-i", str(aiff), "-c:a", "aac", "-b:a", "160k", str(m4a)])
    d = dur(m4a) + 1.0  # respiro no fim de cada slide
    sh(["ffmpeg", "-y", "-loop", "1", "-i", str(png), "-i", str(m4a),
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-tune", "stillimage",
        "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0c0d10",
        "-r", "12", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-af", "apad", "-t", f"{d:.2f}", str(seg)])
    segs.append(seg)
    print(f"slide {k:02d}/{TOTAL}  {d:5.1f}s")

lista = OUT/"lista.txt"
lista.write_text("".join(f"file '{s}'\n" for s in segs))
final = REPO/"ONBOARDING_DIA2_VIDEO.mp4"
sh(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lista), "-c", "copy", str(final)])
print("\nvideo:", final, f"{dur(final)/60:.1f} min", f"{final.stat().st_size/1024/1024:.1f} MB")
