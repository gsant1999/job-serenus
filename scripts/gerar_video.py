"""Monta o video narrado de um dia do onboarding a partir do deck HTML.

    python3 scripts/gerar_video.py 4

Cada slide vira um PNG (Chrome headless com deep-link #n) e uma faixa de audio
(voz Luciana, pt-BR); o ffmpeg junta imagem + audio por slide e concatena tudo.

A narracao mora em scripts/narracao/diaN.json - um objeto {"numero do slide":
"texto falado"}. Slide que nao esta no JSON fica de fora do video (e assim que
os slides de produto da terca, que ainda sao molduras vazias, sao pulados).

O texto e falado, nao e o texto do slide: frases curtas, sem simbolo e valores
por extenso, porque a voz sintetica tropeca em "R$" e em "50%".

Generaliza os gerar_video_dia1/2/3.py, que ficaram como estao para nao quebrar
quem ja tem o comando na mao.
"""
import subprocess, pathlib, shutil, json, sys

REPO = pathlib.Path(__file__).resolve().parent.parent
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
VOZ, VELOCIDADE = "Luciana", "172"
RESPIRO = 1.0  # segundos de silencio no fim de cada slide


def sh(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def dur(path):
    r = sh(["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(path)])
    return float(json.loads(r.stdout)["format"]["duration"])


def main(dia):
    deck = REPO / f"ONBOARDING_DIA{dia}_APRESENTACAO.html"
    narr = json.loads((REPO / "scripts" / "narracao" / f"dia{dia}.json").read_text())
    out = pathlib.Path(f"/tmp/video-dia{dia}")
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    slides = sorted(int(k) for k in narr)
    segs = []
    for k in slides:
        png, aiff, m4a, seg = out/f"s{k:02d}.png", out/f"s{k:02d}.aiff", out/f"s{k:02d}.m4a", out/f"s{k:02d}.mp4"
        sh([CHROME, "--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1.5",
            "--window-size=1280,720", f"--screenshot={png}", f"file://{deck}?full#{k}"])
        sh(["say", "-v", VOZ, "-r", VELOCIDADE, "-o", str(aiff), narr[str(k)]])
        sh(["ffmpeg", "-y", "-i", str(aiff), "-c:a", "aac", "-b:a", "160k", str(m4a)])
        d = dur(m4a) + RESPIRO
        sh(["ffmpeg", "-y", "-loop", "1", "-i", str(png), "-i", str(m4a),
            "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-tune", "stillimage",
            "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,"
                   "pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0c0d10",
            "-r", "12", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k",
            "-af", "apad", "-t", f"{d:.2f}", str(seg)])
        segs.append(seg)
        print(f"dia {dia} · slide {k:02d}  {d:5.1f}s", flush=True)

    lista = out/"lista.txt"
    lista.write_text("".join(f"file '{s}'\n" for s in segs))
    final = REPO/f"ONBOARDING_DIA{dia}_VIDEO.mp4"
    sh(["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", str(lista), "-c", "copy", str(final)])
    print(f"\nvideo: {final}  {dur(final)/60:.1f} min  {final.stat().st_size/1024/1024:.1f} MB", flush=True)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("uso: python3 scripts/gerar_video.py <dia>")
    main(sys.argv[1])
