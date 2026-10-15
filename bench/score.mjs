// מדד איכות אוטומטי לפלט המנוע. שימוש:
//   node bench/score.mjs <fixtures...> [--sizes 300x250,728x90] [--out score.json] [--png dir] [--blind]
// <fixtures> = תיקייה עם *.json+*.rgba (כמו bench.mjs) או תיקיית דוגמה עם fx.json+fx.rgba.
// ציון 0-100 לכל מקרה + תתי-ציונים: legibility, sharpness, layout, dropped, fill. ראו CLAUDE.md / bench/gate.mjs.
// ללא תלות במנוע מעבר ל-SizyEngine; אפשר גם לדרג תמונה ללא סצנה (מצב "blind", למשל גרסת מעצב) ע"י scoreImage.
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';

export const DEFAULT_SIZES = '1200x200,1200x60,120x500,300x600,160x600,728x90,300x250,320x70,800x600,290x350,600x1100,895x80'.split(',').map(s => s.split('x').map(Number));
export const ROLE_WEIGHT = { headline: 10, logo: 8, button: 7, subheadline: 5, badge: 5, photo: 4, body: 3, label: 2, caption: 2, decor: 0.3, hero: 0 };
// גלאי פיקסלים משותפים עם public/qa.js (ragged / sticker_edge / smear / empty_band): מוסיפים דגלים בלבד, בלי לשנות את הציון
await import('../public/qa.js');
function pixelFlags(rgba, W, H, pl, flags, only) { const r = globalThis.SizyQA.pixelCheck({ rgba, w: W, h: H }, W, H, pl); for (const k of Object.keys(r)) if (r[k] && (!only || only.includes(k))) flags.add(k); return r; } // only: במצב עיוור (בלי סצנה) רק ragged אמין; השאר דורשים רשימת אלמנטים אמיתית
const TEXT_ROLES = new Set(['headline', 'subheadline', 'body', 'caption', 'label']);
const W_SUB = { legibility: 0.25, sharpness: 0.15, layout: 0.25, dropped: 0.20, fill: 0.15 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ramp = (v, a, b) => clamp((v - a) / (b - a), 0, 1); // 0 ב-a, 1 ב-b

// ---------------------------------------------------------------- כלי תמונה
export function gray(rgba, n) { const g = new Float32Array(n); for (let i = 0; i < n; i++) g[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]; return g; }
function relLum(r, g, b) { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); }
const wcagLog = l => Math.log(l + 0.05);
const wcag = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
function lapVar(g, W, H, x0, y0, x1, y1) { // שונות לפלסיאן (4 שכנים) בתוך מלבן
  x0 = Math.max(1, Math.floor(x0)); y0 = Math.max(1, Math.floor(y0)); x1 = Math.min(W - 1, Math.ceil(x1)); y1 = Math.min(H - 1, Math.ceil(y1));
  let s = 0, s2 = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = y * W + x, l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W]; s += l; s2 += l * l; n++; }
  return n < 4 ? null : s2 / n - (s / n) * (s / n);
}
function boxBlur(g, W, H, r) { // טשטוש ריבועי מהיר (אינטגרל)
  const I = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) { let row = 0; for (let x = 0; x < W; x++) { row += g[y * W + x]; I[(y + 1) * (W + 1) + x + 1] = I[y * (W + 1) + x + 1] + row; } }
  const o = new Float32Array(W * H);
  for (let y = 0; y < H; y++) { const ya = Math.max(0, y - r), yb = Math.min(H, y + r + 1); for (let x = 0; x < W; x++) { const xa = Math.max(0, x - r), xb = Math.min(W, x + r + 1); o[y * W + x] = (I[yb * (W + 1) + xb] - I[ya * (W + 1) + xb] - I[yb * (W + 1) + xa] + I[ya * (W + 1) + xa]) / ((xb - xa) * (yb - ya)); } }
  return o;
}
function areaResizeGray(g, sw, sh, x0, y0, x1, y1, dw, dh) { // חיתוך ושינוי גודל (ממוצע שטח / ביליניארי להגדלה)
  const o = new Float32Array(dw * dh), cw = x1 - x0, ch = y1 - y0;
  for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
    const a = x0 + x * cw / dw, b = x0 + (x + 1) * cw / dw, c = y0 + y * ch / dh, d = y0 + (y + 1) * ch / dh;
    let s = 0, wsum = 0;
    const xi0 = Math.floor(a), xi1 = Math.max(xi0 + 1, Math.ceil(b)), yi0 = Math.floor(c), yi1 = Math.max(yi0 + 1, Math.ceil(d));
    for (let yy = yi0; yy < yi1; yy++) for (let xx = xi0; xx < xi1; xx++) {
      const wx = Math.min(b, xx + 1) - Math.max(a, xx), wy = Math.min(d, yy + 1) - Math.max(c, yy), w = Math.max(wx, 1e-3) * Math.max(wy, 1e-3);
      s += g[clamp(yy, 0, sh - 1) * sw + clamp(xx, 0, sw - 1)] * w; wsum += w;
    }
    o[y * dw + x] = s / wsum;
  }
  return o;
}

// ---------------------------------------------------------------- זיהוי טקסט "עיוור" (לתמונה בלי סצנה)
export function detectText(rgba, W, H) {
  const n = W * H, g = gray(rgba, n), r = Math.max(2, Math.round(Math.min(W, H) / 60));
  const bl = boxBlur(g, W, H, r), m = new Uint8Array(n);
  for (let i = 0; i < n; i++) m[i] = Math.abs(g[i] - bl[i]) > 40 ? 1 : 0;
  const rx = Math.max(2, Math.round(r * 1.6)), ry = Math.max(1, Math.round(r * 0.5));
  const dm = dilate(m, W, H, rx, ry), lab = cc(dm, W, H), boxes = new Map();
  for (let i = 0; i < n; i++) if (lab[i]) { const l = lab[i], x = i % W, y = (i / W) | 0; let b = boxes.get(l); if (!b) boxes.set(l, b = { x0: x, y0: y, x1: x, y1: y, ink: 0 }); b.x0 = Math.min(b.x0, x); b.y0 = Math.min(b.y0, y); b.x1 = Math.max(b.x1, x); b.y1 = Math.max(b.y1, y); if (m[i]) b.ink++; }
  const items = [];
  for (const b of boxes.values()) {
    const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1, dens = b.ink / (w * h);
    if (h < 4 || w < 8 || h > H * 0.6 || w * h > n * 0.5 || dens < 0.06 || dens > 0.65 || w < h * 0.9) continue;
    // שורות: הקרנה אנכית של המסכה
    const rows = new Float32Array(h); let mx = 0;
    for (let y = 0; y < h; y++) { let c = 0; for (let x = 0; x < w; x++) c += m[(b.y0 + y) * W + b.x0 + x]; rows[y] = c; mx = Math.max(mx, c); }
    const runs = []; let st = -1;
    for (let y = 0; y <= h; y++) { const on = y < h && rows[y] > 0.12 * mx; if (on && st < 0) st = y; if (!on && st >= 0) { if (y - st >= 3) runs.push([st, y]); st = -1; } }
    const nl = Math.max(1, runs.length), gh = runs.length ? runs.reduce((a, q) => a + (q[1] - q[0]), 0) / runs.length : h;
    // צבעוניות: טקסט = רקע שטוח + דיו שטוח (קומץ צבעים); תמונה = הרבה צבעים
    const hist = new Map(); let tot = 0;
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) { const i = (y * W + x) * 4, k = (rgba[i] >> 5) << 6 | (rgba[i + 1] >> 5) << 3 | rgba[i + 2] >> 5; hist.set(k, (hist.get(k) || 0) + 1); tot++; }
    const top = [...hist.values()].sort((p, q) => q - p).slice(0, 5).reduce((p, q) => p + q, 0) / tot;
    if (top < 0.6) continue;
    // ניגודיות: הפיקסלים השונים ביותר מחציון הרקע מול החציון
    const Ls = []; for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) { const i = (y * W + x) * 4; Ls.push(relLum(rgba[i], rgba[i + 1], rgba[i + 2])); }
    const sorted = Ls.slice().sort((p, q) => p - q), bgl = sorted[sorted.length >> 1];
    const dif = Ls.map(v => [Math.abs(wcagLog(v) - wcagLog(bgl)), v]).sort((p, q) => q[0] - p[0]), k = Math.max(3, Math.round(dif.length * 0.06));
    const inkL = dif.slice(0, k).reduce((p, q) => p + q[1], 0) / k;
    items.push({ role: 'text', text: true, box: [b.x0, b.y0, w, h], nLines: nl, glyphH: gh, contrast: wcag(inkL, bgl), ink: dens });
  }
  items.sort((a, b) => b.glyphH - a.glyphH);
  items.forEach((it, i) => { it.role = i === 0 ? 'headline' : 'body'; });
  return items;
}
function dilate(m, W, H, rx, ry) {
  const t = new Uint8Array(W * H), o = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) { let last = -1e9; for (let x = 0; x < W; x++) { if (m[y * W + x]) last = x; if (x - last <= rx) t[y * W + x] = 1; } last = 1e9; for (let x = W - 1; x >= 0; x--) { if (m[y * W + x]) last = x; if (last - x <= rx) t[y * W + x] = 1; } }
  for (let x = 0; x < W; x++) { let last = -1e9; for (let y = 0; y < H; y++) { if (t[y * W + x]) last = y; if (y - last <= ry) o[y * W + x] = 1; } last = 1e9; for (let y = H - 1; y >= 0; y--) { if (t[y * W + x]) last = y; if (last - y <= ry) o[y * W + x] = 1; } }
  return o;
}
function cc(m, W, H) {
  const lab = new Int32Array(W * H); let next = 0; const st = [];
  for (let i = 0; i < W * H; i++) if (m[i] && !lab[i]) { lab[i] = ++next; st.push(i); while (st.length) { const p = st.pop(), x = p % W, y = (p / W) | 0; for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) if (q >= 0 && m[q] && !lab[q]) { lab[q] = next; st.push(q); } } }
  return lab;
}

// ---------------------------------------------------------------- (א) קריאות
// item: { text, box:[x,y,w,h], nLines, glyphH, contrast? }
function legibility(items, flags) {
  const ts = items.filter(it => it.text); if (!ts.length) return null;
  let sw = 0, ss = 0; const detail = [];
  for (const it of ts) {
    const xh = 0.5 * it.glyphH; // גובה-x משוער מגובה אות
    const sizeS = ramp(xh, 2.5, 6.5), conS = ramp(it.contrast, 1.5, 4.5);
    const s = 0.55 * sizeS + 0.45 * conS, wgt = ROLE_WEIGHT[it.role] || 3;
    if (xh < 3 && it.role !== 'label') flags.add('tinytext');
    if (it.contrast < 2.5) flags.add('lowcontrast');
    sw += wgt; ss += wgt * s; detail.push({ id: it.id || it.role, xh: +xh.toFixed(1), contrast: +it.contrast.toFixed(2), s: +s.toFixed(2) });
  }
  return { score: 100 * ss / sw, detail };
}

// ---------------------------------------------------------------- (ב) חדות
function sharpnessScene(items, g, W, H, og, OW, OH, flags) {
  let sw = 0, ss = 0; const detail = [];
  for (const it of items) {
    if (!it.text || !it.orig || it.reflowed) continue;
    const [x, y, w, h] = it.box, tw = Math.round(w), th = Math.round(h); if (tw < 6 || th < 6) continue;
    const [ox, oy, ow, oh] = it.orig;
    const ideal = areaResizeGray(og, OW, OH, ox, oy, ox + ow, oy + oh, tw, th);
    const vi = lapVar(ideal, tw, th, 1, 1, tw - 1, th - 1), vo = lapVar(g, W, H, Math.round(x), Math.round(y), Math.round(x) + tw, Math.round(y) + th);
    if (vi == null || vo == null || vi < 4) continue;
    const ratio = vo / vi, s = ramp(ratio, 0.25, 0.75), wgt = ROLE_WEIGHT[it.role] || 3;
    if (ratio < 0.35) flags.add('blurry');
    sw += wgt; ss += wgt * s; detail.push({ id: it.id, ratio: +ratio.toFixed(2) });
  }
  return sw ? { score: 100 * ss / sw, detail } : null;
}
// גרסה ללא ייחוס: קרישות קצה (שונות פלסיאן / אנרגיית גרדיאנט) באזורי טקסט מול אותו מדד בתמונת המקור
function edgeCrisp(g, W, H, boxes) {
  let lv = 0, ge = 0;
  for (const [x, y, w, h] of boxes) {
    const x0 = Math.max(1, Math.floor(x)), y0 = Math.max(1, Math.floor(y)), x1 = Math.min(W - 1, Math.ceil(x + w)), y1 = Math.min(H - 1, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = yy * W + xx, l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - W] - g[i + W], gx = g[i + 1] - g[i - 1], gy = g[i + W] - g[i - W]; lv += l * l; ge += gx * gx + gy * gy; }
  }
  return ge > 0 ? lv / ge : null;
}
function sharpnessBlind(g, W, H, items, og, OW, OH, oitems, flags) {
  if (!items.length || !oitems || !oitems.length) return null;
  const a = edgeCrisp(g, W, H, items.map(i => i.box)), b = edgeCrisp(og, OW, OH, oitems.map(i => i.box));
  if (a == null || b == null || b <= 0) return null;
  const ratio = a / b; if (ratio < 0.35) flags.add('blurry');
  return { score: 100 * ramp(ratio, 0.25, 0.75), detail: [{ ratio: +ratio.toFixed(2) }] };
}

// חפיפת דיו: בתוך חיתוך התיבות, כמה פיקסלים שבהם שתי השכבות אטומות (ביחס לשכבה הקטנה)
function inkOverlap(a, b) {
  const A = a.layer, B = b.layer; if (!A || !B) return 0;
  const x0 = Math.max(a.box[0], b.box[0]), x1 = Math.min(a.box[0] + a.box[2], b.box[0] + b.box[2]), y0 = Math.max(a.box[1], b.box[1]), y1 = Math.min(a.box[1] + a.box[3], b.box[1] + b.box[3]);
  const op = (L, bx, x, y) => { const lx = Math.floor((x - bx[0]) / bx[2] * L.lw), ly = Math.floor((y - bx[1]) / bx[3] * L.lh); return lx < 0 || ly < 0 || lx >= L.lw || ly >= L.lh ? 0 : L.a[ly * L.lw + lx] > 0.3 ? 1 : 0; };
  let c = 0; const step = Math.max(1, Math.floor(Math.sqrt((x1 - x0) * (y1 - y0) / 4000)));
  let ia = 0, ib = 0, n = 0;
  for (let y = y0; y < y1; y += step) for (let x = x0; x < x1; x += step) { n++; const oa = op(A, a.box, x, y), ob = op(B, b.box, x, y); if (oa && ob) c++; }
  const inkA = inkArea(a), inkB = inkArea(b), small = Math.min(inkA, inkB);
  return small > 0 ? c * step * step / small : 0;
}
function inkArea(it) { if (it._ink == null) { const L = it.layer; let c = 0; for (let i = 0; i < L.lw * L.lh; i++) if (L.a[i] > 0.3) c++; it._ink = c / (L.lw * L.lh) * it.box[2] * it.box[3]; } return it._ink; }

// ---------------------------------------------------------------- (ג) פריסה
function layoutHealth(items, W, H, flags, sceneMode, pix) {
  const content = items.filter(it => it.role !== 'hero' && !it.isPlate);
  const detail = {}; let pen = 0;
  if (!content.length && !pix) return { score: 0, detail: { empty: true } };
  const ar = b => b[2] * b[3];
  // חפיפה (רק עם סצנה: בלי סצנה "אלמנטים" הם כתמים מזוהים)
  if (sceneMode) {
    let ov = 0; const pairs = [];
    for (let i = 0; i < content.length; i++) for (let j = i + 1; j < content.length; j++) {
      const a = content[i], b = content[j], ra = a.role, rb = b.role;
      if (((ra === 'button' || ra === 'badge') && rb === 'label') || ((rb === 'button' || rb === 'badge') && ra === 'label')) continue;
      const ix = Math.min(a.box[0] + a.box[2], b.box[0] + b.box[2]) - Math.max(a.box[0], b.box[0]), iy = Math.min(a.box[1] + a.box[3], b.box[1] + b.box[3]) - Math.max(a.box[1], b.box[1]);
      if (ix > 0 && iy > 0) { const f = inkOverlap(a, b); if (f > 0.05) { ov += f; pairs.push(`${a.id}/${b.id}:${f.toFixed(2)}`); } }
    }
    detail.overlap = +ov.toFixed(2); if (pairs.length) detail.overlapPairs = pairs; if (ov > 0) { pen += Math.min(40, 40 * ov); flags.add('overlap'); }
    // חיתוך מחוץ לקנבס
    let cl = 0;
    for (const it of content) { const [x, y, w, h] = it.box; const vis = Math.max(0, Math.min(x + w, W) - Math.max(x, 0)) * Math.max(0, Math.min(y + h, H) - Math.max(y, 0)); cl = Math.max(cl, 1 - vis / (w * h)); }
    detail.clipped = +cl.toFixed(2); if (cl > 0.02) { pen += Math.min(40, 80 * cl); flags.add('clipped'); }
  }
  if (!content.length) return { score: clamp(100 - 20, 0, 100), detail: { noText: true } };
  const x0 = Math.min(...content.map(e => e.box[0])), x1 = Math.max(...content.map(e => e.box[0] + e.box[2])), y0 = Math.min(...content.map(e => e.box[1])), y1 = Math.max(...content.map(e => e.box[1] + e.box[3]));
  // שוליים (מתעלמים מאלמנט ברוחב מלא שנוגע בקצה בכוונה: רק מינימום אחרי חיתוך לקנבס)
  const m = Math.min(x0, y0, W - x1, H - y1) / Math.min(W, H); detail.margin = +m.toFixed(3);
  if (m < 0.02) { pen += 15 * (1 - clamp(m / 0.02, 0, 1)); flags.add('tightmargin'); }
  // איזון: מרכז כובד משוקלל-שטח ביחס למרכז הקנבס
  let sa = 0, cx = 0, cy = 0; if (pix) { sa = pix.sa; cx = pix.cx; cy = pix.cy; } else for (const e of content) { const a = ar(e.box); sa += a; cx += a * (e.box[0] + e.box[2] / 2); cy += a * (e.box[1] + e.box[3] / 2); }
  const off = Math.hypot((cx / sa - W / 2) / (W / 2), (cy / sa - H / 2) / (H / 2)); detail.balanceOffset = +off.toFixed(2);
  if (off > 0.3) { pen += Math.min(15, 30 * (off - 0.3)); if (off > 0.5) flags.add('unbalanced'); }
  // שטח ריק: תאים ברשת 24x24 שלא נוגעים באף אלמנט
  const G = 24, occ = new Uint8Array(G * G);
  if (pix) occ.set(pix.occ); else for (const e of content) for (let gy = clamp(Math.floor(e.box[1] / H * G), 0, G - 1); gy <= clamp(Math.floor((e.box[1] + e.box[3]) / H * G - 1e-6), 0, G - 1); gy++) for (let gx = clamp(Math.floor(e.box[0] / W * G), 0, G - 1); gx <= clamp(Math.floor((e.box[0] + e.box[2]) / W * G - 1e-6), 0, G - 1); gx++) occ[gy * G + gx] = 1;
  const emptyR = 1 - occ.reduce((a, b) => a + b, 0) / (G * G); detail.emptyRatio = +emptyR.toFixed(2);
  if (emptyR > 0.6) { pen += Math.min(15, 40 * (emptyR - 0.6)); if (emptyR > 0.75) flags.add('sparse'); }
  // היררכיה: כותרת הגדולה ביותר
  const pitch = it => it.glyphH;
  const head = content.filter(e => e.role === 'headline' && e.text), others = content.filter(e => ['subheadline', 'body', 'caption'].includes(e.role) && e.text);
  if (head.length && others.length) {
    const hp = Math.max(...head.map(pitch)), op = Math.max(...others.map(pitch)), r = hp / op; detail.headlineRatio = +r.toFixed(2);
    if (r < 1) { pen += Math.min(25, 50 * (1 - r)); if (r < 0.85) flags.add('hierarchy'); }
  }
  // היררכיה מבנית (נלמד מ-14 גדלים שמעצבים עשו ידנית, ראו bench/exemplars/HIERARCHY.md)
  const U = list => list.length ? [Math.min(...list.map(e => e.box[0])), Math.min(...list.map(e => e.box[1])), Math.max(...list.map(e => e.box[0] + e.box[2])), Math.max(...list.map(e => e.box[1] + e.box[3]))] : null;
  const hb = U(head), lb = (l => l.length ? l.reduce((a, b) => (b.box[2] * b.box[3] > a.box[2] * a.box[3] ? b : a)) : null)(content.filter(e => e.role === 'logo')), lbb = lb && [lb.box[0], lb.box[1], lb.box[0] + lb.box[2], lb.box[1] + lb.box[3]], bb = U(content.filter(e => e.role === 'button'));
  if (hb) {
    const ha = (hb[2] - hb[0]) * (hb[3] - hb[1]);
    if ((W / H) < 4.2 && ha / (W * H) < 0.045) { pen += 8; flags.add('weak_headline'); }
    if (lbb && (lbb[2] - lbb[0]) * (lbb[3] - lbb[1]) > 1.1 * ha) { pen += 12; flags.add('logo_dominant'); }
    if (bb && (W / H) < 2 && (bb[1] + bb[3]) / 2 < (hb[1] + hb[3]) / 2) { pen += 8; flags.add('cta_order'); }
  }
  return { score: clamp(100 - pen, 0, 100), detail };
}

// תפוסה לפי פיקסלים (למצב בלי סצנה): "תוכן" = רחוק מצבע הרקע השולט
export function pixelContent(rgba, W, H) {
  const hist = new Map(), n = W * H;
  for (let i = 0; i < n; i++) { const k = (rgba[i * 4] >> 4) << 8 | (rgba[i * 4 + 1] >> 4) << 4 | rgba[i * 4 + 2] >> 4; hist.set(k, (hist.get(k) || 0) + 1); }
  let bk = 0, bc = -1; for (const [k, c] of hist) if (c > bc) { bc = c; bk = k; }
  const br = ((bk >> 8) & 15) * 16 + 8, bgc = ((bk >> 4) & 15) * 16 + 8, bb = (bk & 15) * 16 + 8, G = 24, cnt = new Float32Array(G * G);
  let sa = 0, cx = 0, cy = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; if (Math.abs(rgba[i] - br) + Math.abs(rgba[i + 1] - bgc) + Math.abs(rgba[i + 2] - bb) > 90) { cnt[Math.min(G - 1, (y * G / H) | 0) * G + Math.min(G - 1, (x * G / W) | 0)]++; sa++; cx += x; cy += y; } }
  const cell = n / (G * G), occ = new Uint8Array(G * G); for (let i = 0; i < G * G; i++) occ[i] = cnt[i] > 0.04 * cell ? 1 : 0;
  return { occ, sa: sa || 1, cx: sa ? cx : W / 2 * 1, cy: sa ? cy : H / 2 * 1 };
}

// ---------------------------------------------------------------- (ד) אלמנטים שנפלו
function droppedScore(origLeaves, placedIds, flags) {
  let tot = 0, lost = 0; const gone = [];
  for (const l of origLeaves) { const w = ROLE_WEIGHT[l.role] ?? 2; tot += w; if (!placedIds.has(l.id)) { lost += w; if (w >= 2) gone.push(l.role + ':' + l.id); } }
  if (!tot) return null;
  const fr = lost / tot; if (fr > 0.25) for (const g of gone.filter(x => /^(headline|logo|button)/.test(x))) flags.add('dropped');
  if (gone.some(x => x.startsWith('headline'))) flags.add('headline-missing');
  return { score: 100 * (1 - fr), detail: { dropped: gone } };
}

// ---------------------------------------------------------------- (ה) ארטיפקטים של מילוי הרקע
function bgMask(boxes, W, H, pad) { const m = new Uint8Array(W * H); for (const [x, y, w, h] of boxes) for (let yy = Math.max(0, Math.floor(y - pad)); yy < Math.min(H, Math.ceil(y + h + pad)); yy++) for (let xx = Math.max(0, Math.floor(x - pad)); xx < Math.min(W, Math.ceil(x + w + pad)); xx++) m[yy * W + xx] = 1; return m; }
function blockStats(g, mask, W, H) {
  const b = Math.max(6, Math.round(Math.min(W, H) / 24)), sd = [];
  for (let by = 0; by + b <= H; by += b) for (let bx = 0; bx + b <= W; bx += b) {
    let s = 0, s2 = 0, c = 0, mk = 0;
    for (let y = by; y < by + b; y++) for (let x = bx; x < bx + b; x++) { const i = y * W + x; mk += mask[i]; const v = g[i]; s += v; s2 += v * v; c++; }
    if (mk > 0.1 * c) continue;
    sd.push(Math.sqrt(Math.max(0, s2 / c - (s / c) * (s / c))));
  }
  return sd;
}
function spikeFrac(sd) {
  if (sd.length < 6) return null;
  const s = sd.slice().sort((a, b) => a - b), med = s[s.length >> 1];
  return { med, spike: sd.filter(v => v > Math.max(10, 3 * med)).length / sd.length, flat: sd.filter(v => v < 0.8).length / sd.length };
}
function tilePeak(g, mask, W, H) { // שיא מתאם-עצמי אופקי של הרקע אחרי הסרת תדר נמוך
  if (W < 48) return 0;
  const hp = new Float32Array(W * H), bl = boxBlur(g, W, H, 4); for (let i = 0; i < W * H; i++) hp[i] = mask[i] || (i % W) < 5 || (i % W) > W - 6 || ((i / W) | 0) < 5 || ((i / W) | 0) > H - 6 ? 0 : g[i] - bl[i]; // בלי שוליים (מסגרות תמונה)
  const rows = []; const step = Math.max(1, Math.floor(H / 40)); for (let y = 0; y < H; y += step) rows.push(y);
  const cm = new Float32Array(W); for (let x = 0; x < W; x++) { let t = 0; for (let y = 0; y < H; y++) t += hp[y * W + x]; cm[x] = t / H; } // בלי פסים אנכיים (עמודה קבועה אינה אריח)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!mask[y * W + x]) hp[y * W + x] -= cm[x];
  const corr = lag => { let s = 0, d = 0; for (const y of rows) for (let x = 0; x + lag < W; x++) { const a = hp[y * W + x], b = hp[y * W + x + lag]; s += a * b; d += a * a + b * b; } return d > 0 ? 2 * s / d : 0; };
  const lag0 = Math.max(8, Math.round(W / 40)), lag1 = Math.floor(W / 3); let best = 0;
  let e0 = 0; for (const y of rows) for (let x = 0; x < W; x++) e0 += hp[y * W + x] ** 2;
  if (e0 / (rows.length * W) < 4) return 0; // רקע כמעט חלק
  for (let lag = lag0; lag <= lag1; lag += Math.max(1, lag >> 6)) { const c = corr(lag); if (c > 0.5 && c > best && corr(2 * lag) > 0.6 * c) best = c; } // אריח אמיתי חוזר גם במחזור כפול
  return best;
}
function fillArtifacts(g, W, H, outBoxes, og, OW, OH, origBoxes, flags) {
  const mo = bgMask(outBoxes, W, H, 3), mi = bgMask(origBoxes, OW, OH, 3);
  const a = spikeFrac(blockStats(g, mo, W, H)), b = spikeFrac(blockStats(og, mi, OW, OH));
  if (!a) return { score: 100, detail: { note: 'no-bg-blocks' } };
  const spikeEx = Math.max(0, a.spike - (b ? b.spike : 0)), flatEx = b && b.med > 4 ? Math.max(0, a.flat - b.flat - 0.15) : 0;
  const tp = tilePeak(g, mo, W, H), tpo = tilePeak(og, mi, OW, OH), tileEx = Math.max(0, tp - Math.max(0.5, tpo + 0.15));
  if (spikeEx > 0.08) flags.add('blotchy'); if (flatEx > 0.2) flags.add('smeared'); if (tileEx > 0.05) flags.add('tiled');
  const pen = 100 * (clamp(spikeEx * 3, 0, 0.5) + clamp(flatEx * 1.5, 0, 0.3) + clamp(tileEx * 3, 0, 0.5));
  return { score: clamp(100 - pen, 0, 100), detail: { spikeExcess: +spikeEx.toFixed(3), flatExcess: +flatEx.toFixed(3), tilePeak: +tp.toFixed(2), origTilePeak: +tpo.toFixed(2) } };
}

// ---------------------------------------------------------------- איחוד
function combine(sub) {
  let w = 0, s = 0; for (const [k, v] of Object.entries(sub)) if (v) { w += W_SUB[k]; s += W_SUB[k] * v.score; }
  return w ? s / w : 0;
}
/** דירוג תמונה ללא סצנה. orig = {rgba,w,h} (חובה לקרישות/מילוי), עובד גם על גרסאות מעצב. */
export function scoreImage(rgba, W, H, orig) {
  const flags = new Set(), n = W * H, g = gray(rgba, n);
  const items = detectText(rgba, W, H);
  const og = orig ? gray(orig.rgba, orig.w * orig.h) : null, oitems = orig ? detectText(orig.rgba, orig.w, orig.h) : null;
  const sub = {
    legibility: legibility(items, flags),
    sharpness: orig ? sharpnessBlind(g, W, H, items, og, orig.w, orig.h, oitems, flags) : null,
    layout: layoutHealth(items, W, H, flags, false, pixelContent(rgba, W, H)),
    dropped: null,
    fill: orig ? fillArtifacts(g, W, H, items.map(i => i.box), og, orig.w, orig.h, oitems.map(i => i.box), flags) : null,
  };
  pixelFlags(rgba, W, H, items.map(i => [{ id: 'd', role: i.role, text: true, lines: Array(i.nLines).fill('x') }, i.box[0], i.box[1], i.box[2], i.box[3]]), flags, ['ragged']);
  return finish(sub, flags, 'blind');
}
function finish(sub, flags, mode) {
  const out = { mode, score: +combine(sub).toFixed(1), sub: {}, detail: {}, flags: [...flags].sort() };
  for (const [k, v] of Object.entries(sub)) { out.sub[k] = v ? +v.score.toFixed(1) : null; out.detail[k] = v ? v.detail : null; }
  return out;
}

/** דירוג פלט מנוע עם הסצנה: sc, placements (autoplace), rgba (render). */
export function scoreScene(sc, pl, rgba, W, H, orig) {
  const flags = new Set(), g = gray(rgba, W * H), og = gray(orig.rgba, orig.w * orig.h);
  const items = [];
  for (const [leaf, x, y, w, h] of pl) {
    if (w < 1 || h < 1) continue;
    const nl = Math.max(1, (leaf.lines || [1]).length), pitch = h / nl;
    const it = { id: leaf.id, role: leaf.role, text: !!leaf.text, isPlate: !!leaf.isPlate, box: [x, y, w, h], nLines: nl, glyphH: 0.82 * pitch, reflowed: !!leaf.reflowed, orig: [leaf.x, leaf.y, leaf.w, leaf.h], layer: leaf.layer };
    if (it.text) { // ניגודיות: צבע הטקסט מול הרקע בפלט בפיקסלים שאינם אות
      const L = leaf.layer; let tr = 0, tg = 0, tb = 0, tc = 0;
      for (let i = 0; i < L.lw * L.lh; i++) if (L.a[i] > 0.8) { tr += L.rgb[i * 3]; tg += L.rgb[i * 3 + 1]; tb += L.rgb[i * 3 + 2]; tc++; }
      const bgl = [], X0 = Math.max(0, Math.round(x)), Y0 = Math.max(0, Math.round(y)), X1 = Math.min(W, Math.round(x + w)), Y1 = Math.min(H, Math.round(y + h));
      for (let yy = Y0; yy < Y1; yy++) for (let xx = X0; xx < X1; xx++) {
        const lx = clamp(Math.floor((xx - x) / w * L.lw), 0, L.lw - 1), ly = clamp(Math.floor((yy - y) / h * L.lh), 0, L.lh - 1);
        let near = false; for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) { const qx = clamp(lx + dx * Math.max(1, Math.round(L.lw / w)), 0, L.lw - 1), qy = clamp(ly + dy * Math.max(1, Math.round(L.lh / h)), 0, L.lh - 1); if (L.a[qy * L.lw + qx] > 0.05) { near = true; break; } }
        if (!near) { const i = (yy * W + xx) * 4; bgl.push(relLum(rgba[i], rgba[i + 1], rgba[i + 2])); }
      }
      if (tc && bgl.length >= 4) { bgl.sort((p, q) => p - q); it.contrast = wcag(relLum(tr / tc, tg / tc, tb / tc), bgl[bgl.length >> 1]); } else it.contrast = 21; // אין מספיק רקע למדידה: לא מענישים
    }
    items.push(it);
  }
  const content = items.filter(i => i.role !== 'hero' && !i.isPlate);
  const placedIds = new Set(content.map(i => i.id));
  // תוויות על כפתור/תג מוחלפות לעיתים ב"יחידה": מזהים לפי מזהה העלה בלבד
  const orphan = sc.leaves.filter(l => l.role !== 'hero');
  const sub = {
    legibility: legibility(content, flags),
    sharpness: sharpnessScene(content, g, W, H, og, orig.w, orig.h, flags),
    layout: layoutHealth(items, W, H, flags, true),
    dropped: droppedScore(orphan, placedIds, flags),
    fill: fillArtifacts(g, W, H, items.filter(i => !i.isPlate && i.role !== 'hero').map(i => i.box), og, orig.w, orig.h, sc.leaves.filter(l => l.role !== 'hero').map(l => [l.x, l.y, l.w, l.h]), flags),
  };
  pixelFlags(rgba, W, H, pl.filter(e => e[3] >= 1 && e[4] >= 1), flags);
  const r = finish(sub, flags, 'scene');
  r.legDetail = undefined; return r;
}

// ---------------------------------------------------------------- טעינת פיקסצ'רים והרצה
export function loadFixtures(paths) {
  const out = [];
  const add = (dir, base, name) => { const j = path.join(dir, base + '.json'), r = path.join(dir, base + '.rgba'); if (!fs.existsSync(j) || !fs.existsSync(r)) return; const meta = JSON.parse(fs.readFileSync(j)); if (!meta.elements) return; const buf = fs.readFileSync(r); out.push({ name, dir, meta, rgba: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length) }); };
  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    if (fs.existsSync(path.join(p, 'fx.json'))) { add(p, 'fx', path.basename(path.resolve(p))); continue; }
    for (const f of fs.readdirSync(p).sort()) if (f.endsWith('.json') && f !== 'results.json' && f !== 'baseline.json') add(p, f.slice(0, -5), f.slice(0, -5));
  }
  return out;
}
export async function loadEngine() { await import('../public/bgmap.js'); await import('../public/engine.js'); return globalThis.SizyEngine; }
/** מריץ את המנוע ומדרג כל גודל. מחזיר שורות {fixture,size,score,sub,flags,...} */
export function scoreFixture(E, fx, sizes, opts = {}) {
  const sc = E.buildScene(E.fromRGBA(fx.rgba, fx.meta.w, fx.meta.h), fx.meta.elements, () => {});
  const orig = { rgba: fx.rgba, w: fx.meta.w, h: fx.meta.h }, rows = [];
  for (const [W, H] of sizes) {
    try {
      const pl = E.autoplace(sc, W, H), r = E.render(sc, W, H, 1), res = scoreScene(sc, pl, r.rgba, W, H, orig);
      if (opts.blind) res.blind = scoreImage(r.rgba, W, H, orig);
      if (opts.onRender) opts.onRender(fx, W, H, r);
      rows.push({ fixture: fx.name, size: `${W}x${H}`, ...res });
    } catch (e) { rows.push({ fixture: fx.name, size: `${W}x${H}`, score: 0, sub: {}, flags: ['crash:' + String(e.message).slice(0, 60)] }); }
  }
  return rows;
}
export const parseSizes = s => s.split(',').map(x => x.trim().replace(/[a-z]$/, '').split('x').map(Number)).filter(a => a.length === 2 && a[0] > 0 && a[1] > 0);

/** משווה פלט מנוע לגרסאות המעצב (h_WxH.*) שבתיקיית דוגמה. שני הצדדים מדורגים באותו מדד "עיוור" (scoreImage) כדי שיהיו ברי-השוואה. */
export async function compareHumans(E, dir, fx) {
  const sharp = (await import('sharp')).default, rows = [];
  const sc = E.buildScene(E.fromRGBA(fx.rgba, fx.meta.w, fx.meta.h), fx.meta.elements, () => {});
  const orig = { rgba: fx.rgba, w: fx.meta.w, h: fx.meta.h };
  for (const f of fs.readdirSync(dir).sort()) {
    const m = /^h_(\d+)x(\d+)[a-z]?\.(png|jpe?g|gif)$/i.exec(f); if (!m) continue;
    const W = +m[1], H = +m[2];
    const { data, info } = await sharp(path.join(dir, f), { animated: false }).removeAlpha().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const hum = scoreImage(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height, orig);
    const pl = E.autoplace(sc, W, H), r = E.render(sc, W, H, 1);
    const eng = scoreScene(sc, pl, r.rgba, W, H, orig), engBlind = scoreImage(r.rgba, W, H, orig);
    rows.push({ fixture: fx.name, size: `${W}x${H}`, file: f, engine: eng, engineBlind: engBlind, human: hum });
  }
  return rows;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2), paths = [], o = {};
  for (let i = 0; i < args.length; i++) { if (args[i] === '--sizes') o.sizes = args[++i]; else if (args[i] === '--out') o.out = args[++i]; else if (args[i] === '--humans') o.humans = true; else if (args[i] === '--blind') o.blind = true; else paths.push(args[i]); }
  if (!paths.length) { console.error('usage: node bench/score.mjs <fixtures...> [--sizes WxH,..] [--out score.json] [--blind]'); process.exit(2); }
  const E = await loadEngine(), sizes = o.sizes ? parseSizes(o.sizes) : DEFAULT_SIZES, rows = [];
  if (o.humans) {
    const hr = [];
    for (const p of paths) for (const fx of loadFixtures([p])) hr.push(...await compareHumans(E, p, fx));
    for (const r of hr) console.log(r.fixture.padEnd(8), r.size.padEnd(9), `engine=${r.engine.score} engineBlind=${r.engineBlind.score} human=${r.human.score}`, r.engineBlind.score < r.human.score ? 'OK(engine<human)' : 'ENGINE>=HUMAN', '| eng:', r.engine.flags.join(','), '| blind eng:', r.engineBlind.flags.join(','), '| hum:', r.human.flags.join(','));
    if (o.out) fs.writeFileSync(o.out, JSON.stringify({ humans: hr }, null, 1));
    const kb = new Set(JSON.parse(fs.readFileSync(new URL('./exemplars/known_bad.json', import.meta.url))).cases);
    const bad = hr.filter(r => kb.has(`${r.fixture}@${r.size}`) && !(r.engine.score < r.human.score && r.engineBlind.score < r.human.score));
    const wins = hr.filter(r => r.engine.score < r.human.score).length;
    console.log(`engine below human in ${wins}/${hr.length} cases; known-bad violations: ${bad.length}`); for (const r of bad) console.log('  VIOLATION', r.fixture, r.size);
    process.exit(bad.length ? 1 : 0);
  }
  for (const fx of loadFixtures(paths)) rows.push(...scoreFixture(E, fx, sizes, { blind: o.blind }));
  const avg = rows.reduce((a, r) => a + r.score, 0) / (rows.length || 1);
  for (const r of rows.slice().sort((a, b) => a.score - b.score).slice(0, 30)) console.log(r.fixture.padEnd(16), r.size.padEnd(9), String(r.score).padStart(5), Object.entries(r.sub).map(([k, v]) => k.slice(0, 3) + '=' + (v == null ? '-' : Math.round(v))).join(' '), r.flags.join(','));
  console.log('cases', rows.length, 'avg', avg.toFixed(1));
  if (o.out) fs.writeFileSync(o.out, JSON.stringify({ sizes, avg, rows }, null, 1));
}
