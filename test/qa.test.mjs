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

// גלאי פיקסלים: bad_300x600.png הוא פלט אמיתי פגום (כתמים שחורים סביב הכותרת, מלבני רקע כמו מדבקות, רקע מרוח)
{ const zlib = (await import('node:zlib')).default, fs = (await import('node:fs')).default;
  const png = fs.readFileSync(new URL('../bench/exemplars/dreams/bad_300x600.png', import.meta.url)); let p = 8, w = 0, h = 0, ct = 0; const idat = [];
  while (p < png.length) { const len = png.readUInt32BE(p), t = png.toString('latin1', p + 4, p + 8); if (t === 'IHDR') { w = png.readUInt32BE(p + 8); h = png.readUInt32BE(p + 12); ct = png[p + 17]; } if (t === 'IDAT') idat.push(png.subarray(p + 8, p + 8 + len)); p += 12 + len; }
  const bpp = ct === 6 ? 4 : 3, raw = zlib.inflateSync(Buffer.concat(idat)), st = w * bpp, cur = Buffer.alloc(h * st), rgba = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) { const f = raw[y * (st + 1)]; for (let x = 0; x < st; x++) { const v = raw[y * (st + 1) + 1 + x], a = x >= bpp ? cur[y * st + x - bpp] : 0, b = y ? cur[(y - 1) * st + x] : 0, c = x >= bpp && y ? cur[(y - 1) * st + x - bpp] : 0;
    const pr = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b >> 1) : (() => { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; })(); cur[y * st + x] = v + pr & 255; } }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < bpp; c++) rgba[(y * w + x) * 4 + c] = cur[y * st + x * bpp + c];
  assert.equal(w, 300); assert.equal(h, 600);
  const T = (id, role, lines) => ({ id, role, text: true, lines: Array(lines).fill('x') }), G = (id, role) => ({ id, role, text: false });
  const sc3 = { leaves: [T('h', 'headline', 4), G('b', 'button'), T('c', 'caption', 2), G('l', 'logo'), G('p', 'photo'), G('m', 'badge')] };
  const pl3 = [[sc3.leaves[3], 131, 15, 39, 38], [sc3.leaves[0], 55, 62, 215, 106], [sc3.leaves[1], 108, 178, 132, 57], [sc3.leaves[4], 115, 242, 70, 60], [sc3.leaves[5], 66, 310, 179, 33], [sc3.leaves[2], 95, 346, 150, 46], [G('man', 'photo'), 119, 406, 63, 177]];
  const t0 = performance.now(); const qb = qaCheck(sc3, 300, 600, pl3, { rgba, w, h }); const ms = performance.now() - t0;
  const cb = qb.issues.map(i => i.code);
  assert.equal(qb.status, 'red'); for (const c of ['ragged', 'sticker_edge', 'smear']) assert(cb.includes(c), 'bad png should flag ' + c + ': ' + cb);
  assert(qb.issues.every(i => /[א-ת]/.test(i.textHe)) && ms < 400, 'pixel QA fast: ' + ms);
  // בלי פיקסלים התוצאה כמו קודם (התאמה לאחור)
  assert(!qaCheck(sc3, 300, 600, pl3).issues.some(i => ['ragged', 'sticker_edge', 'smear', 'empty_band'].includes(i.code)));
  // רקע חלק ונקי עם טקסט וכפתור: ללא דגלי פיקסלים
  const fw = 300, fh = 250, flat = new Uint8ClampedArray(fw * fh * 4); for (let i = 0; i < fw * fh; i++) { flat[i * 4] = 30; flat[i * 4 + 1] = 60 + (i / fw | 0) / 6; flat[i * 4 + 2] = 120; flat[i * 4 + 3] = 255; }
  for (let y = 15; y < 45; y++) for (let x = 40; x < 260; x += 3) { const i = (y * fw + x) * 4; flat[i] = flat[i + 1] = flat[i + 2] = 245; }
  const qf = qaCheck(sc, fw, fh, good, { rgba: flat, w: fw, h: fh }); assert(!qf.issues.some(i => ['ragged', 'sticker_edge', 'smear', 'empty_band'].includes(i.code)), 'clean flat banner: ' + qf.issues.map(i => i.code));
  // רווח ריק גדול בין אלמנטים
  const gap = qaCheck(sc, fw, fh, [[sc.leaves[0], 40, 10, 220, 40], [sc.leaves[1], 80, 190, 140, 40]], { rgba: flat, w: fw, h: fh }); assert(gap.issues.some(i => i.code === 'empty_band'));
}
const html = qaReportHtml([{ w: 300, h: 250, thumb: 'data:image/jpeg;base64,AA', qa: qaCheck(sc, 300, 250, good) }, { w: 728, h: 90, thumb: '', qa: qaCheck(sc, 728, 90, [good[1]]) }], { title: '<x>', date: '1.1' });
assert(html.includes('dir="rtl"') && html.includes('300 × 250') && html.includes('&lt;x&gt;') && html.includes('✗'));
console.log('Passed: qaCheck flags (clipped/tiny/overlap/missing/sparse/margin) and Hebrew RTL report.');
console.log('Passed: pixel detectors (ragged/sticker_edge/smear/empty_band) flag bad_300x600.png red, clean banners stay clean.');
