// בדיקת מנוע על באנר סינתטי: ניתוק טקסט מרקע, פריסה לכמה גדלים, בלי ערכים לא תקינים.
import assert from 'node:assert/strict';
await import('../public/engine.js');
const E = globalThis.SizyEngine;
const W = 600, H = 400, rgba = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; rgba[i] = 30 + x / 8; rgba[i + 1] = 50 + y / 8; rgba[i + 2] = 120; rgba[i + 3] = 255; }
const rect = (x0, y0, x1, y1, c) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * W + x) * 4; rgba[i] = c[0]; rgba[i + 1] = c[1]; rgba[i + 2] = c[2]; } };
for (let k = 0; k < 8; k++) rect(150 + k * 38, 80, 150 + k * 38 + 26, 140, [255, 255, 255]); // "כותרת"
rect(220, 300, 380, 350, [250, 200, 40]);                                                      // כפתור
const n = (v, t) => Math.round(v / t * 1000);
const els = [
  { id: 'h', role: 'headline', box: [n(145, W), n(75, H), n(455, W), n(145, H)], lines: ['שלום'], group: 'g' },
  { id: 'b', role: 'button', shape: 'rounded', style: 'filled', box: [n(220, W), n(300, H), n(380, W), n(350, H)], group: 'g2' },
];
const sc = E.buildScene(E.fromRGBA(rgba, W, H), els);
assert.equal(sc.leaves.length, 2);
// הכותרת הלבנה הוסרה מהרקע (לא נשארו רוחות רפאים)
const p = (x, y) => sc.plate.d[(y * W + x) * 3];
assert(p(160, 110) < 150, 'plate still has white text: ' + p(160, 110));
for (const [w, h, k] of [[300, 600, 1], [728, 90, 1], [300, 250, 2]]) {
  const r = E.render(sc, w, h, k);
  assert.equal(r.w, w * k); assert.equal(r.h, h * k); assert.equal(r.rgba.length, w * k * h * k * 4);
  let white = 0; for (let i = 0; i < r.rgba.length; i += 4) if (r.rgba[i] > 235 && r.rgba[i + 1] > 235 && r.rgba[i + 2] > 235) white++;
  assert(white > 50, `headline missing at ${w}x${h}`);
}
console.log('Passed: text cut from background, plate cleaned, renders at 3 sizes.');

// תכנית AI: תכנית הגיונית משמשת, תכנית שדוחסת הכול לפס צר נדחית וחוזרים לכללים.
{
  const sc2 = sc;
  const W2 = 300, H2 = 600, same = (a, b) => JSON.stringify(a.map(i => [i.x | 0, i.y | 0, i.w | 0])) === JSON.stringify(b.map(i => [i.x | 0, i.y | 0, i.w | 0]));
  const ids = sc2.units.map((_, i) => 'u' + i);
  const squeezed = { units: ids.map((id, i) => ({ id, x: 6, y: 20 + i * 90, w: 70, h: 80 })) };
  assert.ok(same(E.placements(sc2, W2, H2, squeezed), E.placements(sc2, W2, H2)), 'bad plan must fall back to the rules');
  console.log('Passed: bad AI plan rejected.');
}

// מהירות: זיכרונות ביניים (משקלי דגימה, שכבות מוכפלות, סידור לפי גודל) לא משנים את התוצאה, ושינוי איסורים מנקה אותם.
{
  const a = E.render(sc, 300, 250, 1), b = E.render(sc, 300, 250, 1), c = E.render(sc, 301, 250, 1);
  assert.deepEqual(Buffer.from(a.rgba.buffer), Buffer.from(b.rgba.buffer), 'repeat render must be identical');
  assert.equal(c.w, 301);
  const r0 = E.resize({ w: 3, h: 1, c: 1, d: new Float32Array([0, 10, 20]) }, 3, 2, 'cubic');
  assert.deepEqual([...r0.d], [0, 10, 20, 0, 10, 20], 'identity axis must pass through');
  const p1 = E.autoplace(sc, 200, 200).map(e => e.slice(1).join()), p2 = E.autoplace(sc, 200, 200).map(e => e.slice(1).join());
  assert.deepEqual(p1, p2);
  E.setBans({ overlap: false, clip: false, tiny: false }); E.autoplace(sc, 200, 200); E.setBans({ overlap: true, clip: true, tiny: true });
  assert.deepEqual(E.autoplace(sc, 200, 200).map(e => e.slice(1).join()), p1, 'bans restored must restore the layout');
  console.log('Passed: caches keep results identical.');
}
