// בדיקת עמידות: תיבות רחבות מהמציאות (Gemini) לא אמורות לכבות את REFRAME ולא לשבור את לוח הכותרת. הרצה: node bench/loose_check.mjs
import fs from 'fs'; import path from 'path'; import { fileURLToPath, pathToFileURL } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url)), P = path.resolve(here, '../public') + '/', D = here + '/exemplars/dreams/';
for (const f of ['bgmap.js', 'inpaint.js', 'engine.js']) await import(pathToFileURL(P + f).href).catch(() => {});
const E = globalThis.SizyEngine, inp = JSON.parse(fs.readFileSync(D + 'fx.json')), buf = fs.readFileSync(D + 'fx.rgba');
const clamp = v => Math.max(0, Math.min(1000, v));
let bad = 0;
for (const pad of [0, 10, 20, 30]) { // אחוז הרחבה לכל צד מגודל האלמנט עצמו: pad/2 %
  const els = inp.elements.map(e => { const [a, b, c, d] = e.box, px = (c - a) * pad / 200, py = (d - b) * pad / 200; return { ...e, box: [clamp(a - px), clamp(b - py), clamp(c + px), clamp(d + py)] }; });
  const sc = E.buildScene(E.fromRGBA(new Uint8ClampedArray(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)), inp.w, inp.h), els, () => {});
  const why = E.reframeWhy(sc), r = E.reframeFor(sc, 300, 600), panel = r && r.A && r.A.panels && r.A.panels.filter(p => !p.btn).length;
  const ok = /פעיל/.test(why) && panel === 1; if (!ok) bad++;
  console.log(ok ? 'OK  ' : 'FAIL', 'הרחבה', pad / 2 + '%', '|', why, '| לוחות:', panel);
}
process.exit(bad ? 1 : 0);
