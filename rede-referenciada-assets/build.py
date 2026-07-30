import os

SC = os.path.dirname(os.path.abspath(__file__))
def rd(p):
    with open(os.path.join(SC, p), encoding='utf-8') as f:
        return f.read().strip()

tpl = rd('template.html')
data = rd('rede_data.json').replace('</script>', '<\\/script>')

subs = {
    '__DATA__': data,
    '__SERENUS_LOGO_BLACK_B64__': rd('serenus_black_b64.txt'),
    '__SERENUS_LOGO_LIGHT_B64__': rd('serenus_light_b64.txt'),
    '__SERENUS_JPG_B64__': rd('serenus_jpg_b64.txt'),
    '__SULA_JPG_B64__': rd('sula_jpg_b64.txt'),
    '__LOGO_B64__': rd('logo_b64.txt'),
    '__SER_JPG_W__': '700', '__SER_JPG_H__': '179',
    '__SUL_JPG_W__': '700', '__SUL_JPG_H__': '161',
    '__DATA_ATUALIZACAO__': '29/07/2026',
}
out = tpl
# longest keys first so __LOGO_B64__ doesn't clobber __SERENUS_LOGO_*_B64__
for k in sorted(subs, key=len, reverse=True):
    out = out.replace(k, subs[k])

leftover = [k for k in subs if k in out]
assert not leftover, "placeholders remaining: %s" % leftover

with open(os.path.join(SC, 'rede_referenciada.html'), 'w', encoding='utf-8') as f:
    f.write(out)
print('built size:', os.path.getsize(os.path.join(SC, 'rede_referenciada.html')))
