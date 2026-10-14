# השוואת חיתוך מוגדל לפני/אחרי: python3 bench/cmpcrop.py <name> <x0> <y0> <x1> <y1> <scale> <out.png> <dirA> <dirB> [dirC...]
import sys, numpy as np
from PIL import Image, ImageDraw
n, x0, y0, x1, y1, sc, out = sys.argv[1], *map(int, sys.argv[2:7]), sys.argv[7]
ims = []
for d in sys.argv[8:]:
    im = Image.open(f'{d}/{n}.plate.png').convert('RGB').crop((x0, y0, x1, y1)); im = im.resize(((x1 - x0) * sc, (y1 - y0) * sc), Image.LANCZOS); ims.append((d.rstrip('/').split('/')[-1], im))
W = sum(i.width for _, i in ims) + 6 * (len(ims) - 1); H = ims[0][1].height + 16
c = Image.new('RGB', (W, H), (255, 255, 255)); x = 0; dr = ImageDraw.Draw(c)
for nm, i in ims: c.paste(i, (x, 16)); dr.text((x + 2, 2), nm, fill=(0, 0, 0)); x += i.width + 6
c.save(out)
