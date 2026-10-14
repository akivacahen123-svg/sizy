# המרת plate.rgba ל-PNG וחיתוך מוגדל של החור הגדול: python3 bench/topng.py <dir> [dir2 ...] ; יוצר <name>.plate.png ו-<name>.hole.png (ירוק = חור)
import sys, os, numpy as np
from PIL import Image
for d in sys.argv[1:]:
    for f in sorted(os.listdir(d)):
        if not f.endswith('.plate.rgba'): continue
        n = f[:-11]; W, H = map(int, open(f'{d}/{n}.dim').read().split())
        a = np.frombuffer(open(f'{d}/{f}', 'rb').read(), np.uint8).reshape(H, W, 4)
        Image.fromarray(a[:, :, :3]).save(f'{d}/{n}.plate.png')
