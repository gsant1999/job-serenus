"""Monta o video narrado do Dia 3 a partir dos slides do deck.

Mesmo motor do Dia 1 e do Dia 2: cada slide vira um PNG (Chrome headless com
deep-link #n) e uma faixa de audio (voz Luciana, pt-BR); o ffmpeg junta e
concatena. Aqui todos os 23 slides entram - nenhum e moldura vazia.
"""
import subprocess, pathlib, shutil, json

REPO = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path("/tmp/video-dia3")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DECK = REPO / "ONBOARDING_DIA3_APRESENTACAO.html"

# Narracao por slide. Texto falado, nao texto de slide: frases curtas, sem
# simbolo, valores por extenso - a voz sintetica tropeca em "R$" e em "50%".
NARR = [
 "Terceiro dia, Aline. Hoje é com você. Lead real, na sua mão, com a Bianca do lado.",

 "O que muda hoje: você para de assistir. Segunda você viu a empresa, terça você entendeu o produto, e hoje você conversa com gente de verdade. Você atende, a Bianca acompanha e corrige na hora. E ninguém vai te cobrar venda hoje. Hoje se mede atividade.",

 "Vamos começar pelo primeiro contato. E antes de escrever qualquer coisa, você lê.",

 "São trinta segundos que mudam a conversa. Abra o lead no JOB e confira o nome, porque errar o nome já começa mal. Veja a origem, ou seja, de qual anúncio a pessoa veio, porque isso diz o que ela procurava. Leia o histórico, para saber se alguém já falou com ela. E veja a data de entrada, porque muda o tom da abertura. Mandar mensagem sem ler o lead é como atender o telefone sem saber quem está ligando.",

 "A primeira mensagem é curta, tem nome e termina com pergunta. Por exemplo: Oi, Marina, aqui é a Aline, da Serenus Corretora, vi que você pediu informação sobre plano de saúde. E na sequência: pra eu te ajudar direito, o plano seria só pra você ou pra mais alguém da família? O nome dela, o seu nome, a corretora, de onde veio o contato, e uma pergunta aberta no fim. Sempre.",

 "E o que não fazer na primeira mensagem. Não mande preço, porque você ainda não sabe a idade, a cidade nem quantas pessoas: preço sem qualificação é chute. Não mande áudio longo, porque quem não te conhece não ouve dois minutos de áudio. Não mande textão, porque ninguém lê. E não pergunte só tudo bem e pare, porque sem pergunta de verdade a conversa morre no oi.",

 "Uma coisa sobre velocidade: lead novo é o mais quente que ele vai ficar. A pessoa preencheu o formulário e naquele momento está pensando no assunto. Uma hora depois ela está trabalhando, com o filho, no trânsito, e provavelmente já falou com outro corretor. A regra de hoje é simples: lead que chegou é lead que você fala. Não deixe para depois do almoço.",

 "Agora, o que fazer quando ela responde. E também quando ela não responde, que é o caso mais comum.",

 "Se ela respondeu, volte para as oito perguntas: quem vai usar, a idade de cada um, a cidade, se tem CNPJ, se tem plano hoje, se tem hospital ou médico que faz questão, se alguém está em tratamento, e por que ela está procurando agora. Mas faça uma pergunta por vez. Interrogatório de oito perguntas de uma vez espanta. Pergunta, escuta, comenta, e pergunta de novo.",

 "Se ela não respondeu, entenda uma coisa: o silêncio é o normal, não é fracasso. No mesmo dia, algumas horas depois, mande uma segunda mensagem curta com assunto novo, nunca só um oi com interrogação. No dia seguinte, tente em outro horário: quem não responde às dez da manhã pode responder às sete da noite. Se continuar em silêncio, ligue, porque muita gente não lê WhatsApp de desconhecido mas atende o telefone. E, em qualquer caso, registre no JOB, marque a etiqueta Silêncio e deixe uma tarefa de follow-up.",

 "Sobre follow-up: volte com assunto, não com cobrança. Não funciona mandar oi tudo bem, conseguiu ver, bom dia, e aí o que achou. Funciona mandar algo como: Marina, lembrei do seu caso, consegui uma opção que atende no hospital que você falou, te mando? Toda vez que você voltar, leve alguma coisa nova: uma opção, uma informação, um prazo que vai mudar. Cobrança sem novidade vira chateação.",

 "Agora as quatro frases que você vai ouvir. Nenhuma delas é rejeição: são dúvida com outro nome.",

 "A primeira: está caro. Quase nunca significa não quero. Significa não entendi por que custa isso, ou está fora do que eu imaginava. Então pergunte: caro em relação a quê? Ou: que valor você tinha em mente? E aí ajuste o que dá, como acomodação, coparticipação ou tipo de contratação. Atenção: não baixe o preço na hora nem prometa desconto. Ajuste o plano, não o número.",

 "A segunda: vou pensar, ou vou falar com meu marido. Quase sempre falta uma informação, ou falta alguém na conversa. Responda algo como: claro, só pra eu te ajudar, ficou alguma dúvida sobre o que o plano cobre ou é mais a questão do valor? E combine o retorno: te chamo quinta de manhã, pode ser? Vou pensar sem data marcada é lead perdido. Sempre saia da conversa com dia e hora combinados.",

 "A terceira: já tenho plano. Isso é boa notícia, porque ela já entende o produto e já paga por ele. A pergunta certa não é se ela quer trocar. É: como tem sido? Tem algo que te incomoda hoje, preço, rede, atendimento? Se ela reclamar de alguma coisa, você tem uma conversa. E lembre da portabilidade: em certas condições ela troca de plano aproveitando a carência já cumprida.",

 "A quarta: achei mais barato, ou vou pesquisar. Preço só se compara quando as duas coisas são iguais, e quase nunca são. Então diga: me manda o que te passaram que eu comparo com você. E aí você olha rede, acomodação, coparticipação e abrangência. Muitas vezes o mais barato é enfermaria, com coparticipação e rede menor. Mostre a diferença, não brigue pelo número.",

 "E isso vale para todas: objeção não é não. É a pessoa te dizendo o que falta pra ela decidir. Quem desliga na primeira objeção nunca vende. Quem pergunta mais uma vez, vende.",

 "Falta a última parte, e ela é metade do trabalho: registrar. A conversa some. O registro fica.",

 "O que é um bom registro? Registro inútil é escrever: falei com a cliente, mandei mensagem, sem resposta. Registro útil é: Marina, trinta e quatro anos, marido de trinta e seis, Campinas, quer manter o Vera Cruz, saiu do plano da empresa em julho, pediu opção sem coparticipação, retorno quinta às dez. Escreva pensando em quem vai ler amanhã, que pode ser você mesma, sem lembrar de nada.",

 "No fim de cada atendimento são três cliques que não se pula. Primeiro, a etapa: arraste o card para onde a conversa realmente parou. Segundo, o motivo, se travou: achou caro, silêncio, não é o momento, ou aguardando resposta. E terceiro, a tarefa de follow-up, com data. Sem isso o lead some, e a comissão vai junto.",

 "O que a Bianca vai olhar hoje é a sua atividade. Quantos leads você abriu, em quanto tempo você falou com cada um, quantas conversas de verdade você teve, quantas qualificações completas, quantos follow-ups marcados, e se o registro está em dia. Repare que venda não está nessa lista. Você pode fazer tudo certo hoje e não vender, e isso é normal.",

 "E a regra que vale mais que todas: vou confirmar essa informação para você e já te retorno. Na dúvida sobre carência, cobertura, rede ou preço, é essa frase. Hoje você vai receber perguntas que não sabe responder, e isso é esperado. Errar a resposta é que não pode.",

 "No fim do dia, anote o que te travou. Toda pergunta que você não soube responder e toda conversa que morreu viram o treinamento de amanhã. É assim que se aprende rápido aqui. Bom trabalho, Aline.",
]


def sh(cmd, **kw):
    return subprocess.run(cmd, check=True, capture_output=True, text=True, **kw)


def dur(path):
    r = sh(["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(path)])
    return float(json.loads(r.stdout)["format"]["duration"])


if OUT.exists():
    shutil.rmtree(OUT)
OUT.mkdir(parents=True)

segs = []
for k in range(1, len(NARR) + 1):
    png, aiff, m4a, seg = OUT/f"s{k:02d}.png", OUT/f"s{k:02d}.aiff", OUT/f"s{k:02d}.m4a", OUT/f"s{k:02d}.mp4"
    sh([CHROME, "--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1.5",
        "--window-size=1280,720", f"--screenshot={png}", f"file://{DECK}?full#{k}"])
    sh(["say", "-v", "Luciana", "-r", "172", "-o", str(aiff), NARR[k-1]])
    sh(["ffmpeg", "-y", "-i", str(aiff), "-c:a", "aac", "-b:a", "160k", str(m4a)])
    d = dur(m4a) + 1.0  # respiro no fim de cada slide
    sh(["ffmpeg", "-y", "-loop", "1", "-i", str(png), "-i", str(m4a),
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-tune", "stillimage",
        "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0c0d10",
        "-r", "12", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-af", "apad", "-t", f"{d:.2f}", str(seg)])
    segs.append(seg)
    print(f"slide {k:02d}/{len(NARR)}  {d:5.1f}s", flush=True)

lista = OUT/"lista.txt"
lista.write_text("".join(f"file '{s}'\n" for s in segs))
final = REPO/"ONBOARDING_DIA3_VIDEO.mp4"
sh(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lista), "-c", "copy", str(final)])
print("\nvideo:", final, f"{dur(final)/60:.1f} min", f"{final.stat().st_size/1024/1024:.1f} MB", flush=True)
