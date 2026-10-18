// בדיקת רעש: Gemini לא מחזיר אותן תיבות פעמיים. מריץ כל דוגמה עם N וריאציות מציאותיות של התיבות ומדווח על כל מה שנשבר.
//   node bench/noise_sweep.mjs [--seeds 6] [--only name,name] [--sizes 300x600,...]
// וריאציות: הזזת צלעות (עד 10%), הוספת "תגית" מאחורי כותרת (לוח כתגית), הפרדת קבוצות, השמטת תוויות כפתור, החלפת תמונה בתגית.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { loadEngine, loadFixtures, scoreFixture, parseSizes } from './score.mjs';
const here = path.dirname(fileURLToPath(import.meta.url)), args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SEEDS = +arg('--seeds', 6), ONLY = arg('--only', '') ? arg('--only').split(',') : null, SIZES = parseSizes(arg('--sizes', '300x600,1200x300,728x90,300x250,160x600,320x70,800x600,1200x200'));
const BAD = new Set(['dropped', 'headline-missing', 'ragged', 'sticker_edge', 'smear', 'blotchy', 'overlap', 'clipped', 'tinytext']);
const rng = s => () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const cl = v => Math.max(0, Math.min(1000, v));
function perturb(els, seed) {
  const r = rng(seed * 9973 + 17), out = [];
  const jit = e => { const [a, b, c, d] = e.box, w = c - a, h = d - b, m = () => (r() * 2 - 0.4) * 0.05; return { ...e, box: [cl(a - w * Math.abs(m()) * (r() < .5 ? 1 : -.4)), cl(b - h * m()), cl(c + w * m() * 1.2), cl(d + h * m())] }; };
  const heads = els.filter(e => e.role === 'headline');
  for (const e of els) {
    if (e.role === 'label' && r() < 0.35) continue; // רק הכפתור, בלי טקסטו
    let x = jit(e);
    if (x.role === 'photo' && r() < 0.3) x = { ...x, role: 'badge' };
    if (x.group && r() < 0.25) x = { ...x, group: null };
    out.push(x);
  }
  if (r() < 0.6) for (const h of heads) { const [a, b, c, d] = h.box, p = 0.04; out.push({ id: 'pn_' + h.id, role: 'badge', shape: 'rounded', box: [cl(a - (c - a) * p), cl(b - (d - b) * p), cl(c + (c - a) * p), cl(d + (d - b) * p)], group: h.group || 'gp' }); }
  return out;
}
const fxs = loadFixtures(fs.readdirSync(path.join(here, 'exemplars')).map(d => path.join(here, 'exemplars', d)).filter(d => fs.existsSync(path.join(d, 'fx.json')))).filter(f => !ONLY || ONLY.includes(f.name));
if (args.includes('--child')) {
  const name = arg('--child'), E = await loadEngine(), fx = fxs.find(f => f.name === name), base = {};
  for (const r of scoreFixture(E, fx, SIZES)) base[r.size] = r;
  const rows = [];
  for (let s = 1; s <= SEEDS; s++) {
    const f2 = { ...fx, meta: { ...fx.meta, elements: perturb(fx.meta.elements, s) } };
    for (const r of scoreFixture(E, f2, SIZES)) rows.push({ fixture: name, seed: s, size: r.size, score: r.score, base: base[r.size].score, flags: (r.flags || []).filter(x => BAD.has(String(x).split(':')[0]) && !(base[r.size].flags || []).includes(x)), crash: (r.flags || []).find(x => String(x).startsWith('crash')) });
  }
  process.stdout.write(JSON.stringify(rows)); process.exit(0);
}
const { spawn } = await import('child_process'), all = [];
await Promise.all(fxs.map(fx => new Promise(res => {
  const ch = spawn(process.execPath, [fileURLToPath(import.meta.url), '--child', fx.name, '--seeds', String(SEEDS), '--sizes', SIZES.map(s => s.join('x')).join(',')], { stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 28 }); let o = '';
  ch.stdout.on('data', d => o += d); ch.on('close', () => { try { all.push(...JSON.parse(o)); } catch { console.log('child failed', fx.name); } res(); });
})));
const issues = all.filter(r => r.crash || r.flags.length || r.score < r.base - 8);
const by = {}; for (const r of issues) { const k = r.fixture + '@' + r.size; (by[k] = by[k] || []).push(r); }
for (const [k, v] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)) console.log(k.padEnd(28), v.length + '/' + SEEDS, 'seeds', 'min', Math.min(...v.map(r => r.score)).toFixed(0), 'base', v[0].base.toFixed(0), [...new Set(v.flatMap(r => r.flags.concat(r.crash ? [r.crash] : [])))].join(','));
const n = all.length, avgd = all.reduce((a, r) => a + (r.score - r.base), 0) / n;
console.log(`\n${n} runs, ${issues.length} problematic (${(100 * issues.length / n).toFixed(0)}%), avg delta vs clean ${avgd.toFixed(1)}`);
fs.writeFileSync('/tmp/sc/noise_last.json', JSON.stringify(all));
