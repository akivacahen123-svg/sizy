// בדיקת עומס על המנוע: כל באנר סינתטי × הרבה גדלים. מחשב מדדים (חפיפה, חיתוך, טקסט קטן, מילוי) ושומר תמונות.
// שימוש: node bench/bench.mjs <fixtures> <out> [sizes]
import fs from 'fs'; import path from 'path';
await import('../public/bgmap.js'); await import('../public/engine.js');
const E = globalThis.SizyEngine;
const [fx, out, sizesArg] = process.argv.slice(2);
const SIZES = (sizesArg || '1200x200,1200x60,120x500,300x600,160x600,728x90,300x250,320x70,800x600,290x350,600x1100,895x80').split(',').map(s => s.split('x').map(Number));
fs.mkdirSync(out, { recursive: true });
const names = fs.readdirSync(fx).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort();
const rows = [], flagCount = {};
const ov = (a, b) => { const ix = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]), iy = Math.min(a[2] + a[4], b[2] + b[4]) - Math.max(a[2], b[2]); return ix > 0 && iy > 0 ? ix * iy : 0; };
for (const n of names) {
  const meta = JSON.parse(fs.readFileSync(path.join(fx, n + '.json')));
  const buf = fs.readFileSync(path.join(fx, n + '.rgba'));
  const sc = E.buildScene(E.fromRGBA(new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length), meta.w, meta.h), meta.elements, () => {});
  const origLeaves = sc.leaves.filter(l => l.role !== 'hero' && l.role !== 'decor').length;
  for (const [W, H] of SIZES) {
    const pl = E.autoplace(sc, W, H), flags = [];
    const items = pl.filter(e => !e[0].isPlate);
    const content = items.filter(e => e[0].role !== 'hero');
    for (const e of content) if (e[1] < -1 || e[2] < -1 || e[1] + e[3] > W + 1 || e[2] + e[4] > H + 1) { flags.push('clipped:' + e[0].id); break; }
    const small = content.filter(e => e[0].text && e[0].role !== 'label').map(e => e[4] / Math.max(1, (e[0].lines || [1]).length));
    if (small.length && Math.min(...small) < 6.5) flags.push('tinytext:' + Math.min(...small).toFixed(1));
    for (let i = 0; i < content.length; i++) for (let j = i + 1; j < content.length; j++) {
      const a = content[i], b = content[j]; const ra = a[0].role, rb = b[0].role;
      if ((ra === 'button' || ra === 'badge') && rb === 'label' || (rb === 'button' || rb === 'badge') && ra === 'label') continue;
      const o = ov(a, b); if (o > 0.1 * Math.min(a[3] * a[4], b[3] * b[4])) { flags.push(`overlap:${a[0].id}/${b[0].id}`); i = 1e9; break; }
    }
    const heads = sc.leaves.filter(l => l.role === 'headline');
    for (const h of heads) if (!content.some(e => e[0].id === h.id)) flags.push('headline-missing');
    const placedLeaves = content.filter(e => e[0].role !== 'decor').length;
    if (placedLeaves < 0.6 * origLeaves && W * H > 20000) flags.push(`dropped:${placedLeaves}/${origLeaves}`);
    if (content.length) {
      const x0 = Math.min(...content.map(e => e[1])), x1 = Math.max(...content.map(e => e[1] + e[3])), y0 = Math.min(...content.map(e => e[2])), y1 = Math.max(...content.map(e => e[2] + e[4]));
      const cov = (x1 - x0) * (y1 - y0) / (W * H); if (cov < 0.3) flags.push('sparse:' + cov.toFixed(2));
      const m = Math.min(x0, y0, W - x1, H - y1); if (m < 0.015 * Math.min(W, H)) flags.push('tight-margin');
    }
    const r = E.render(sc, W, H, 1);
    fs.writeFileSync(path.join(out, `${n}_${W}x${H}.rgba`), Buffer.from(r.rgba.buffer));
    for (const f of flags) { const k = f.split(':')[0]; flagCount[k] = (flagCount[k] || 0) + 1; }
    rows.push({ fixture: n, size: `${W}x${H}`, flags, score: Math.max(0, 100 - flags.length * 18) });
  }
}
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ sizes: SIZES, rows, flagCount }, null, 1));
const avg = rows.reduce((a, r) => a + r.score, 0) / rows.length;
console.log('cases', rows.length, 'avg score', avg.toFixed(1)); console.log('flags', JSON.stringify(flagCount));
const bad = rows.filter(r => r.flags.length).sort((a, b) => a.score - b.score).slice(0, 25);
for (const r of bad) console.log(r.fixture, r.size, r.flags.join(' '));
