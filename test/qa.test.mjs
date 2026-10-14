// בדיקת דוח האיכות: qaCheck על סידורים טובים ורעים, ודוח ה-HTML.
import assert from 'node:assert/strict';
await import('../public/engine.js'); await import('../public/qa.js');
const { qaCheck, qaReportHtml } = globalThis.SizyQA; const E = globalThis.SizyEngine;
const L = (id, role, text = true, lines = ['x']) => ({ id, role, text, lines });
const sc = { leaves: [L('h', 'headline'), L('b', 'button', false), L('c', 'caption')] };
const good = [[sc.leaves[0], 40, 40, 220, 50], [sc.leaves[1], 80, 150, 140, 40], [sc.leaves[2], 40, 100, 200, 14]];
let q = qaCheck(sc, 300, 250, good);
assert.equal(q.pass, true); assert.equal(q.status, 'green'); assert.deepEqual(q.issues, []);
assert.equal(q.metrics.minTextPx, 14); assert.equal(q.metrics.clipped, false); assert.equal(q.metrics.margins.left, 40);
const codes = pl => qaCheck(sc, 300, 250, pl).issues.map(i => i.code);
assert(codes([[sc.leaves[0], -20, 40, 220, 50], good[1], good[2]]).includes('clipped'));
assert(codes([good[0], good[1], [sc.leaves[2], 40, 100, 200, 4]]).includes('tinytext'));
assert(codes([good[0], good[1], [sc.leaves[2], 40, 100, 200, 8]]).includes('tinywarn'));
assert(codes([good[0], [sc.leaves[1], 60, 60, 140, 40], good[2]]).includes('overlap'));
q = qaCheck(sc, 300, 250, [good[1], good[2]]);
assert(!q.pass && q.status === 'red' && q.issues.some(i => i.code === 'headline_missing')); assert.deepEqual(q.metrics.droppedRoles, ['headline']);
q = qaCheck(sc, 300, 250, [good[0], good[2]]); assert(q.pass && q.status === 'orange' && q.issues[0].code === 'button_missing');
assert(codes([[sc.leaves[0], 100, 100, 30, 20]]).includes('sparse'));
assert(codes([[sc.leaves[0], 1, 40, 220, 50], good[1], good[2]]).includes('tight_margin'));
assert(q.issues.every(i => /[א-ת]/.test(i.textHe)), 'Hebrew text');
// מנוע אמיתי: סצנה עם כותרת וכפתור
{ const W = 600, H = 400, rgba = new Uint8ClampedArray(W * H * 4).fill(90); for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  for (let y = 80; y < 140; y++) for (let x = 150; x < 450; x++) { const i = (y * W + x) * 4; rgba[i] = rgba[i + 1] = rgba[i + 2] = 255; }
  const n = (v, t) => Math.round(v / t * 1000);
  const s2 = E.buildScene(E.fromRGBA(rgba, W, H), [{ id: 'h', role: 'headline', box: [n(145, W), n(75, H), n(455, W), n(145, H)], lines: ['שלום'], group: 'g' }]);
  for (const [w, h] of [[300, 600], [728, 90], [300, 250]]) { const r = qaCheck(s2, w, h, E.autoplace(s2, w, h)); assert.equal(typeof r.pass, 'boolean'); assert(r.metrics.margins); } }
const html = qaReportHtml([{ w: 300, h: 250, thumb: 'data:image/jpeg;base64,AA', qa: qaCheck(sc, 300, 250, good) }, { w: 728, h: 90, thumb: '', qa: qaCheck(sc, 728, 90, [good[1]]) }], { title: '<x>', date: '1.1' });
assert(html.includes('dir="rtl"') && html.includes('300 × 250') && html.includes('&lt;x&gt;') && html.includes('✗'));
console.log('Passed: qaCheck flags (clipped/tiny/overlap/missing/sparse/margin) and Hebrew RTL report.');
