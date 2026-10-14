// בדיקת "השאר קמפיין אחד בחוץ": מנבאים לכל גודל אנושי מקמפיין שהזיכרון לא ראה, ומשווים למציאות.
// הרצה: node bench/memory_test.mjs
import fs from 'fs';
import '../public/memory.js';
const M = globalThis.SizyMemory;
const lib = JSON.parse(fs.readFileSync(new URL('./exemplars/library.json', import.meta.url)));
M.load(lib);
const AREA = process.argv[2] !== 'noarea';
const camps = Object.keys(lib.campaigns);
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const f = (v, d = 1) => Number.isFinite(v) ? v.toFixed(d) : '-';

// קו בסיס: ממוצע גלובלי בלי תלות ביחס (מכל הקמפיינים האחרים)
function baseline(role, held) {
  const ls = lib.layouts.filter(L => L.campaign !== held);
  let kept = 0, tot = 0, hs = [];
  for (const L of ls) {
    const orig = lib.campaigns[L.campaign].elements.filter(e => e.role === role).length; if (!orig) continue;
    const k = L.elements.filter(e => e.role === role);
    tot += orig; kept += k.length;
    if (k.length) { const b = k[0].box; hs.push(100 * (b[3] - b[1])); }
  }
  return { keep: tot ? kept / tot : 0.85, h: mean(hs) };
}

const rows = [], hErr = [], hErrB = [], yErr = [], dec = { ok: 0, n: 0, okB: 0 }, perCamp = {};
for (const held of camps) {
  const origRoles = Array.from(new Set(lib.campaigns[held].elements.map(e => e.role)));
  for (const L of lib.layouts.filter(l => l.campaign === held)) {
    const P = M.priors(L.aspect, origRoles, { exclude: held, k: 4, area: AREA ? L.w * L.h : 0 });
    const base = {};
    // headline
    const real = L.elements.find(e => e.role === 'headline');
    const rh = 100 * (real.box[3] - real.box[1]), ry = real.box[1];
    const p = P.headline;
    const b = baseline('headline', held);
    const e = Math.abs(p.h * 100 - rh), eb = Math.abs(b.h - rh), ey = Math.abs(p.y - ry) * 100;
    hErr.push(e); hErrB.push(eb); yErr.push(ey);
    // keep/drop per original element (role-level keep prob >= .5)
    let ok = 0, n = 0, okB = 0;
    for (const el of lib.campaigns[held].elements) {
      const kept = !L.dropped.includes(el.id);
      const pk = P[el.role].keep >= 0.5, pb = baseline(el.role, held).keep >= 0.5;
      n++; ok += pk === kept; okB += pb === kept;
    }
    dec.ok += ok; dec.n += n; dec.okB += okB;
    (perCamp[held] ||= { e: [], d: [0, 0] }).e.push(e); perCamp[held].d[0] += ok; perCamp[held].d[1] += n;
    rows.push(`${L.id.padEnd(16)} aspect ${f(L.aspect, 2).padStart(5)}  headline h% real ${f(rh).padStart(5)} pred ${f(p.h * 100).padStart(5)} (err ${f(e).padStart(4)}, flat-baseline err ${f(eb).padStart(4)})  y err ${f(ey).padStart(4)}pp  keep/drop ${ok}/${n}`);
  }
}
console.log('Leave-one-campaign-out (' + lib.layouts.length + ' human sizes, ' + camps.length + ' campaigns)\n');
console.log(rows.join('\n'));
console.log('\nPer campaign (held out):');
for (const c of camps) console.log(`  ${c.padEnd(7)} headline-height mean abs err ${f(mean(perCamp[c].e))} pp   keep/drop ${perCamp[c].d[0]}/${perCamp[c].d[1]}`);
console.log('\nHEADLINE HEIGHT   memory: mean abs err ' + f(mean(hErr)) + ' pp of canvas height | flat baseline: ' + f(mean(hErrB)) + ' pp');
console.log('HEADLINE TOP (y)  memory: mean abs err ' + f(mean(yErr)) + ' pp');
console.log('KEEP/DROP         memory: ' + dec.ok + '/' + dec.n + ' = ' + f(100 * dec.ok / dec.n) + '% correct | flat baseline: ' + f(100 * dec.okB / dec.n) + '%');
