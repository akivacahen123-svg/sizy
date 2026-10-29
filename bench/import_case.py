#!/usr/bin/env python3
"""ייבוא מקרה בדיקה שנשמר מהאתר ("שמור מקרה בדיקה") לסט הבדיקות הקבוע.
שימוש: python3 bench/import_case.py <קובץ zip או תיקייה> [שם]   → bench/exemplars/<שם>/fx.json + fx.rgba
אחר כך: node bench/gate.mjs --update"""
import sys, os, json, zipfile, io, re
from PIL import Image
src = sys.argv[1]
if os.path.isdir(src):
    meta = json.load(open(os.path.join(src, 'case.json'), encoding='utf-8')); img = Image.open(os.path.join(src, 'source.png'))
else:
    z = zipfile.ZipFile(src); meta = json.loads(z.read('case.json').decode('utf-8')); img = Image.open(io.BytesIO(z.read('source.png')))
base = sys.argv[2] if len(sys.argv) > 2 else re.sub(r'[^a-z0-9]+', '_', os.path.splitext(meta.get('name', 'case'))[0].lower()).strip('_') or 'case'
d = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'exemplars', 'case_' + base)
os.makedirs(d, exist_ok=True)
img = img.convert('RGBA'); w, h = img.size
open(os.path.join(d, 'fx.rgba'), 'wb').write(img.tobytes())
els = [{k: e[k] for k in ('id', 'role', 'box', 'lines', 'shape', 'group') if k in e and e[k] is not None} for e in meta['elements']]
for e in els: e.setdefault('group', None)
json.dump({'w': w, 'h': h, 'elements': els}, open(os.path.join(d, 'fx.json'), 'w', encoding='utf-8'), ensure_ascii=False)
print('נוצר', d, w, h, len(els), 'אלמנטים; גדלים שהמשתמש ביקש:', ' '.join(meta.get('sizes', [])))
