# מרכיב דפי תמונות מהתוצאות: שורה לכל באנר מקור, עם כל הגדלים. שימוש: python3 bench/sheet.py <out> <fixtures>
import sys, json, os
from PIL import Image, ImageDraw
out, fx = sys.argv[1], sys.argv[2]; R = json.load(open(os.path.join(out, 'results.json'))); sizes = R['sizes']
names = sorted({r['fixture'] for r in R['rows']})
bad = {(r['fixture'], r['size']): r['flags'] for r in R['rows']}
for n in names:
    tiles = []
    src = Image.open(os.path.join(fx, n + '.png')).convert('RGB'); k = 220 / max(src.size); tiles.append(('original', src.resize((max(1, int(src.width * k)), max(1, int(src.height * k))))))
    for w, h in sizes:
        im = Image.frombytes('RGBA', (w, h), open(os.path.join(out, f'{n}_{w}x{h}.rgba'), 'rb').read()).convert('RGB'); k = min(1, 220 / max(w, h), 1.6)
        k = 220 / max(w, h) if max(w, h) > 220 else min(1.5, 220 / max(w, h)); tiles.append((f'{w}x{h}' + (' !' if bad[(n, f'{w}x{h}')] else ''), im.resize((max(1, int(w * k)), max(1, int(h * k))))))
    rowsH = []; x = 8; y = 8; lineH = 0; W = 1500; pos = []
    for lab, im in tiles:
        if x + im.width + 8 > W: x = 8; y += lineH + 24; lineH = 0
        pos.append((lab, im, x, y)); x += im.width + 8; lineH = max(lineH, im.height)
    O = Image.new('RGB', (W, y + lineH + 24), (235, 235, 240)); d = ImageDraw.Draw(O)
    for lab, im, x, y in pos: O.paste(im, (x, y + 14)); d.text((x, y), lab, fill=(180, 0, 0) if '!' in lab else (0, 0, 0))
    O.save(os.path.join(out, 'sheet_' + n + '.png'))
print('sheets', len(names))
