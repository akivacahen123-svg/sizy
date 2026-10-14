// סייזי · מנוע ההרכבה בדפדפן. מקבל תמונה (RGBA) ורשימת אלמנטים, ומרכיב מחדש לכל גודל.
// פורט של המנוע המקורי (פייתון). כל הפעולות על מערכים צפים, בלי תלות בספריות חיצוניות.
(function (G) {
'use strict';
const HEB = /[֐-׿]/;
const TEXT_ROLES = new Set(['headline', 'subheadline', 'body', 'caption', 'label', 'brand', 'bullets']);
const clp = (v, a, b) => Math.max(a, Math.min(b, v));
const odd = n => { n = Math.floor(n); return n % 2 ? n : n + 1; };

// ---------------------------------------------------------------- resample
// תמונה = { w, h, c, d: Float32Array } (שזורה). kind: area | linear | cubic | lanczos
function kernelWeights(sn, dn, kind) {
  const scale = sn / dn, down = scale > 1;
  const start = new Int32Array(dn), cnt = new Int32Array(dn), taps = [];
  const useArea = kind === 'area' && down;
  const k = (kind === 'area' ? 'linear' : kind);
  const cubic = x => { const a = -0.5; x = Math.abs(x); if (x < 1) return (a + 2) * x * x * x - (a + 3) * x * x + 1; if (x < 2) return a * x * x * x - 5 * a * x * x + 8 * a * x - 4 * a; return 0; };
  const lan = x => { x = Math.abs(x); if (x < 1e-6) return 1; if (x >= 3) return 0; const px = Math.PI * x; return 3 * Math.sin(px) * Math.sin(px / 3) / (px * px); };
  const tri = x => Math.max(0, 1 - Math.abs(x));
  for (let i = 0; i < dn; i++) {
    const w = [];
    let s;
    if (useArea || (down && kind !== 'area' && false)) {
      const a = i * scale, b = (i + 1) * scale;
      s = Math.floor(a);
      for (let j = s; j < Math.min(sn, Math.ceil(b)); j++) w.push(Math.min(b, j + 1) - Math.max(a, j));
    } else {
      const c = (i + 0.5) * scale - 0.5;
      const f = down ? scale : 1; // קרנל מורחב בהקטנה (אנטי-אליאסינג)
      const rad = (k === 'linear' ? 1 : k === 'cubic' ? 2 : 3) * f;
      s = Math.floor(c - rad) + 1;
      const e = Math.floor(c + rad);
      const fn = k === 'linear' ? tri : k === 'cubic' ? cubic : lan;
      for (let j = s; j <= e; j++) w.push(fn((j - c) / f));
      // גבולות: הדבקת פיקסלים חוזרת
      const idx = [];
      for (let j = s; j <= e; j++) idx.push(clp(j, 0, sn - 1));
      // איחוד אינדקסים זהים
      const m = new Map();
      idx.forEach((j, t) => m.set(j, (m.get(j) || 0) + w[t]));
      const keys = [...m.keys()].sort((p, q) => p - q);
      taps.push({ idx: keys, w: keys.map(j => m.get(j)) });
      let sum = 0; taps[taps.length - 1].w.forEach(v => sum += v);
      if (Math.abs(sum) < 1e-9) sum = 1;
      taps[taps.length - 1].w = taps[taps.length - 1].w.map(v => v / sum);
      continue;
    }
    let sum = 0; w.forEach(v => sum += v); if (sum < 1e-9) sum = 1;
    const idx = []; for (let j = 0; j < w.length; j++) idx.push(clp(s + j, 0, sn - 1));
    taps.push({ idx, w: w.map(v => v / sum) });
  }
  return taps;
}
function flatten(taps) {
  let tot = 0; for (const t of taps) tot += t.idx.length;
  const off = new Int32Array(taps.length + 1), idx = new Int32Array(tot), w = new Float32Array(tot);
  let p = 0; taps.forEach((t, i) => { off[i] = p; for (let q = 0; q < t.idx.length; q++) { idx[p] = t.idx[q]; w[p] = t.w[q]; p++; } }); off[taps.length] = p;
  return { off, idx, w };
}
function resize(src, dw, dh, kind) {
  const { w: sw, h: sh, c } = src;
  if (sw === dw && sh === dh) return { w: sw, h: sh, c, d: Float32Array.from(src.d) };
  const tx = flatten(kernelWeights(sw, dw, kind)), ty = flatten(kernelWeights(sh, dh, kind));
  const sd = src.d, tmp = new Float32Array(dw * sh * c);
  for (let y = 0; y < sh; y++) {
    const ro = y * sw * c;
    for (let x = 0; x < dw; x++) {
      const o = (y * dw + x) * c, q0 = tx.off[x], q1 = tx.off[x + 1];
      for (let ch = 0; ch < c; ch++) { let acc = 0; for (let q = q0; q < q1; q++) acc += sd[ro + tx.idx[q] * c + ch] * tx.w[q]; tmp[o + ch] = acc; }
    }
  }
  const out = new Float32Array(dw * dh * c), stride = dw * c;
  for (let y = 0; y < dh; y++) {
    const q0 = ty.off[y], q1 = ty.off[y + 1], base = y * stride;
    for (let x = 0; x < stride; x++) { let acc = 0; for (let q = q0; q < q1; q++) acc += tmp[ty.idx[q] * stride + x] * ty.w[q]; out[base + x] = acc; }
  }
  return { w: dw, h: dh, c, d: out };
}

// ---------------------------------------------------------------- blur
const refl = (i, n) => { if (n === 1) return 0; while (i < 0 || i >= n) { if (i < 0) i = -i; if (i >= n) i = 2 * n - 2 - i; } return i; };
function gaussDirect(img, s) {
  const { w, h, c } = img, src = img.d;
  const r = Math.max(1, Math.ceil(3 * s));
  const k = new Float32Array(2 * r + 1); let sum = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * s * s)); sum += k[i + r]; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(w * h * c), out = new Float32Array(w * h * c);
  const xi = new Int32Array(2 * r + 1);
  // אופקי
  for (let y = 0; y < h; y++) {
    const ro = y * w * c;
    for (let x = 0; x < w; x++) {
      const o = ro + x * c;
      if (x >= r && x < w - r) {
        for (let ch = 0; ch < c; ch++) { let a = 0, p = ro + (x - r) * c + ch; for (let t = 0; t <= 2 * r; t++, p += c) a += src[p] * k[t]; tmp[o + ch] = a; }
      } else {
        for (let t = -r; t <= r; t++) xi[t + r] = refl(x + t, w);
        for (let ch = 0; ch < c; ch++) { let a = 0; for (let t = 0; t <= 2 * r; t++) a += src[ro + xi[t] * c + ch] * k[t]; tmp[o + ch] = a; }
      }
    }
  }
  // אנכי
  const stride = w * c;
  for (let y = 0; y < h; y++) {
    const inter = y >= r && y < h - r;
    if (!inter) for (let t = -r; t <= r; t++) xi[t + r] = refl(y + t, h);
    const base = y * stride;
    for (let x = 0; x < stride; x++) {
      let a = 0;
      if (inter) { let p = (y - r) * stride + x; for (let t = 0; t <= 2 * r; t++, p += stride) a += tmp[p] * k[t]; }
      else for (let t = 0; t <= 2 * r; t++) a += tmp[xi[t] * stride + x] * k[t];
      out[base + x] = a;
    }
  }
  return { w, h, c, d: out };
}
function blur(img, s) {
  if (s <= 4) return gaussDirect(img, s);
  const k = Math.max(2, Math.floor(s / 4));
  const sw = Math.max(2, Math.floor(img.w / k)), sh = Math.max(2, Math.floor(img.h / k));
  const small = gaussDirect(resize(img, sw, sh, 'area'), s / k);
  return resize(small, img.w, img.h, 'linear');
}
const plane = (w, h, fill = 0) => ({ w, h, c: 1, d: new Float32Array(w * h).fill(fill) });

// ---------------------------------------------------------------- אפקטים מורפולוגיים
// אזור-סביב מדויק לפי מרחק אוקלידי (דילציה בצורת עיגול)
function edt1d(f, n, d, v, z, out) {
  let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s;
    while (true) { s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); if (s <= z[k] && k > 0) k--; else break; }
    if (s <= z[k]) { v[k] = q; z[k + 1] = 1e20; } else { k++; v[k] = q; z[k] = s; z[k + 1] = 1e20; }
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const dd = q - v[k]; out[q] = dd * dd + f[v[k]]; }
}
// מסכה Uint8 (w×h). מחזיר Uint8 אחרי דילציה ברדיוס r.
function dilateDisk(m, w, h, r) {
  const INF = 1e12, g = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = m[i] ? 0 : INF;
  const n = Math.max(w, h), f = new Float64Array(n), o = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; edt1d(f, h, null, v, z, o); for (let y = 0; y < h; y++) g[y * w + x] = o[y]; }
  for (let y = 0; y < h; y++) { for (let x = 0; x < w; x++) f[x] = g[y * w + x]; edt1d(f, w, null, v, z, o); for (let x = 0; x < w; x++) g[y * w + x] = o[x]; }
  const out = new Uint8Array(w * h), r2 = r * r + 1e-6;
  for (let i = 0; i < w * h; i++) out[i] = g[i] <= r2 ? 1 : 0;
  return out;
}
function boxMax(a, w, h, r) { // דילציה בריבוע (2r+1), a Uint8/Float32
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = -1e30; for (let t = Math.max(0, x - r); t <= Math.min(w - 1, x + r); t++) m = Math.max(m, a[y * w + t]); tmp[y * w + x] = m; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = -1e30; for (let t = Math.max(0, y - r); t <= Math.min(h - 1, y + r); t++) m = Math.max(m, tmp[t * w + x]); out[y * w + x] = m; }
  return out;
}
function boxMin(a, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 1e30; for (let t = Math.max(0, x - r); t <= Math.min(w - 1, x + r); t++) m = Math.min(m, a[y * w + t]); tmp[y * w + x] = m; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 1e30; for (let t = Math.max(0, y - r); t <= Math.min(h - 1, y + r); t++) m = Math.min(m, tmp[t * w + x]); out[y * w + x] = m; }
  return out;
}
// רכיבים קשירים (4-שכנים)
function labelCC(m, w, h) {
  const lab = new Int32Array(w * h); let n = 0; const st = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!m[i] || lab[i]) continue;
    n++; let sp = 0; st[sp++] = i; lab[i] = n;
    while (sp) {
      const p = st[--sp], x = p % w, y = (p - x) / w;
      if (x > 0 && m[p - 1] && !lab[p - 1]) { lab[p - 1] = n; st[sp++] = p - 1; }
      if (x < w - 1 && m[p + 1] && !lab[p + 1]) { lab[p + 1] = n; st[sp++] = p + 1; }
      if (y > 0 && m[p - w] && !lab[p - w]) { lab[p - w] = n; st[sp++] = p - w; }
      if (y < h - 1 && m[p + w] && !lab[p + w]) { lab[p + w] = n; st[sp++] = p + w; }
    }
  }
  return { lab, n };
}
function percentile(arr, p) {
  const a = Float32Array.from(arr).sort();
  if (!a.length) return 0;
  const pos = (a.length - 1) * p / 100, lo = Math.floor(pos), hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}
function median(arr) { return percentile(arr, 50); }

// ---------------------------------------------------------------- אומדן רקע
// חציון חלון k×k בכל נקודה (מדגם דליל + אינטרפולציה): מעריך את הרקע בלי הדיו
function medianBg(crop, k) {
  const { w, h } = crop;
  const step = Math.max(1, Math.floor(k / 10));
  const gw = Math.ceil(w / step), gh = Math.ceil(h / step);
  const grid = { w: gw, h: gh, c: 3, d: new Float32Array(gw * gh * 3) };
  const half = Math.floor(k / 2), sstep = Math.max(1, Math.floor(k / 5));
  const offs = []; for (let d = -half; d <= half; d += sstep) offs.push(d);
  const n = offs.length * offs.length, v = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const cx = Math.min(w - 1, Math.floor((gx + 0.5) * step)), cy = Math.min(h - 1, Math.floor((gy + 0.5) * step));
    let t = 0;
    for (const dy of offs) { const y = refl(cy + dy, h); for (const dx of offs) { const o = (y * w + refl(cx + dx, w)) * 3; v[0][t] = crop.d[o]; v[1][t] = crop.d[o + 1]; v[2][t] = crop.d[o + 2]; t++; } }
    for (let ch = 0; ch < 3; ch++) { v[ch].sort(); grid.d[(gy * gw + gx) * 3 + ch] = v[ch][n >> 1]; }
  }
  return resize(grid, w, h, 'linear');
}

// ---------------------------------------------------------------- מילוי רקע
function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function msFill(img, hole) {
  const { w, h } = img, N = w * h;
  let any = false; for (let i = 0; i < N; i++) if (hole[i]) { any = true; break; }
  if (!any) return { w, h, c: 3, d: Float32Array.from(img.d) };
  const valid = plane(w, h); for (let i = 0; i < N; i++) valid.d[i] = hole[i] ? 0 : 1;
  const fv = { w, h, c: 3, d: new Float32Array(N * 3) };
  for (let i = 0; i < N; i++) { const v = valid.d[i]; fv.d[i * 3] = img.d[i * 3] * v; fv.d[i * 3 + 1] = img.d[i * 3 + 1] * v; fv.d[i * 3 + 2] = img.d[i * 3 + 2] * v; }
  const fill = Float32Array.from(img.d), got = new Uint8Array(N);
  // רק בסביבת החורים נדרש חישוב; הטשטוש רץ על כל התמונה כי הוא כבר מוקטן
  let sig = 3;
  while (sig < Math.max(h, w) * 0.8) {
    const num = blur(fv, sig), den = blur(valid, sig);
    for (let i = 0; i < N; i++) {
      if (den.d[i] > 0.1 && !got[i]) { fill[i * 3] = num.d[i * 3] / den.d[i]; fill[i * 3 + 1] = num.d[i * 3 + 1] / den.d[i]; fill[i * 3 + 2] = num.d[i * 3 + 2] / den.d[i]; got[i] = 1; }
    }
    sig *= 2;
  }
  const hm = plane(w, h); for (let i = 0; i < N; i++) hm.d[i] = hole[i] ? 1 : 0;
  const m3 = blur(hm, 1.2);
  // גרעיניות
  const lap = []; const gray = i => 0.299 * img.d[i * 3] + 0.587 * img.d[i * 3 + 1] + 0.114 * img.d[i * 3 + 2];
  for (let y = 1; y < h - 1; y += 2) for (let x = 1; x < w - 1; x += 2) {
    const i = y * w + x; if (hole[i]) continue;
    lap.push(Math.abs(gray(i - 1) + gray(i + 1) + gray(i - w) + gray(i + w) - 4 * gray(i)));
  }
  const noise = clp(lap.length ? median(lap) * 0.6 : 1, 0.6, 3);
  const rnd = mulberry(7), out = new Float32Array(N * 3);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  for (let i = 0; i < N; i++) {
    const m = m3.d[i], nz = clp(m * 2, 0, 1);
    for (let ch = 0; ch < 3; ch++) out[i * 3 + ch] = img.d[i * 3 + ch] * (1 - m) + fill[i * 3 + ch] * m + (nz > 0 ? gauss() * noise * nz : 0);
  }
  return { w, h, c: 3, d: out };
}
function softenDenseHoles(plate, hole) {
  const { w, h } = plate, N = w * h, base = Math.min(w, h);
  const hf = plane(w, h); for (let i = 0; i < N; i++) hf.d[i] = hole[i] ? 1 : 0;
  const dens = blur(hf, Math.max(8, base * 0.04));
  const bl = blur(plate, Math.max(5, base * 0.012));
  const out = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const wl = clp((dens.d[i] - 0.14) / 0.30, 0, 0.65);
    for (let ch = 0; ch < 3; ch++) out[i * 3 + ch] = plate.d[i * 3 + ch] * (1 - wl) + bl.d[i * 3 + ch] * wl;
  }
  return { w, h, c: 3, d: out };
}

// ---------------------------------------------------------------- דיו / טקסט
function cropImg(img, x0, y0, x1, y1) {
  const w = x1 - x0, h = y1 - y0, d = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) d.set(img.d.subarray(((y0 + y) * img.w + x0) * 3, ((y0 + y) * img.w + x1) * 3), y * w * 3);
  return { w, h, c: 3, d };
}
function chanMedian(vals) { // vals: מערך של [r,g,b]
  const out = [0, 0, 0];
  for (let ch = 0; ch < 3; ch++) out[ch] = median(vals.map(v => v[ch]));
  return out;
}
function ringBg(crop) {
  const { w, h, d } = crop, k = 3;
  const px = (x, y) => [d[(y * w + x) * 3], d[(y * w + x) * 3 + 1], d[(y * w + x) * 3 + 2]];
  const T = [], B = [], L = [], R = [];
  for (let y = 0; y < Math.min(k, h); y++) for (let x = 0; x < w; x++) T.push(px(x, y));
  for (let y = Math.max(0, h - k); y < h; y++) for (let x = 0; x < w; x++) B.push(px(x, y));
  for (let x = 0; x < Math.min(k, w); x++) for (let y = 0; y < h; y++) L.push(px(x, y));
  for (let x = Math.max(0, w - k); x < w; x++) for (let y = 0; y < h; y++) R.push(px(x, y));
  const mT = chanMedian(T), mB = chanMedian(B), mL = chanMedian(L), mR = chanMedian(R);
  const bg = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const v = h > 1 ? y / (h - 1) : 0;
    for (let x = 0; x < w; x++) {
      const u = w > 1 ? x / (w - 1) : 0;
      for (let ch = 0; ch < 3; ch++) bg[(y * w + x) * 3 + ch] = ((mL[ch] * (1 - u) + mR[ch] * u) + (mT[ch] * (1 - v) + mB[ch] * v)) / 2;
    }
  }
  const errs = [];
  const chk = (x, y) => { let m = 0; for (let ch = 0; ch < 3; ch++) m = Math.max(m, Math.abs(d[(y * w + x) * 3 + ch] - bg[(y * w + x) * 3 + ch])); errs.push(m); };
  for (let x = 0; x < w; x++) { chk(x, 0); chk(x, h - 1); }
  for (let y = 0; y < h; y++) { chk(0, y); chk(w - 1, y); }
  return { bg: { w, h, c: 3, d: bg }, err: median(errs) };
}
function kmeans2(pts) { // pts: מערך [r,g,b]
  const n = pts.length, md = chanMedian(pts);
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let c0 = pts[0], best = -1; for (const p of pts) { const d = dist(p, md); if (d > best) { best = d; c0 = p; } }
  let c1 = pts[0]; best = -1; for (const p of pts) { const d = dist(p, c0); if (d > best) { best = d; c1 = p; } }
  let cen = [c0.slice(), c1.slice()], lab = new Uint8Array(n);
  for (let it = 0; it < 12; it++) {
    const sum = [[0, 0, 0], [0, 0, 0]], cnt = [0, 0];
    for (let i = 0; i < n; i++) { const a = dist(pts[i], cen[0]) <= dist(pts[i], cen[1]) ? 0 : 1; lab[i] = a; cnt[a]++; for (let ch = 0; ch < 3; ch++) sum[a][ch] += pts[i][ch]; }
    for (let a = 0; a < 2; a++) if (cnt[a]) cen[a] = sum[a].map(v => v / cnt[a]);
  }
  let c = 0; for (let i = 0; i < n; i++) c += lab[i] ? 1 : 0;
  return { cen, frac: [(n - c) / n, c / n] };
}

function textLayer(img, box, nlines, upMax, outline, bullets, holes, others, extBelow) {
  const W = img.w, H = img.h;
  const [x, y, w, h] = box;
  upMax = upMax || 4;
  const ex = Math.floor(0.12 * Math.max(w, h) + 4);
  const exw = Math.max(ex, Math.floor(1.1 * Math.max(6, h / Math.max(1, nlines)))); // לצדדים מרחיבים יותר: ה-AI נוטה לחתוך כיתוב קצר
  const pad = exw + Math.max(6, Math.floor(0.15 * Math.min(w, h)));
  const x0 = clp(x - pad, 0, W - 2), y0 = clp(y - pad, 0, H - 2);
  const x1 = clp(x + w + pad, x0 + 2, W), y1 = clp(y + h + pad, y0 + 2, H);
  const crop = cropImg(img, x0, y0, x1, y1), cw = crop.w, ch = crop.h, cd = crop.d, CN = cw * ch;
  const lineh = Math.max(6, h / Math.max(1, nlines));
  let { bg, err } = ringBg(crop);
  const inner = new Uint8Array(CN);
  for (let yy = Math.max(0, y - y0); yy < Math.min(ch, y + h - y0); yy++) for (let xx = Math.max(0, x - x0); xx < Math.min(cw, x + w - x0); xx++) inner[yy * cw + xx] = 1;
  let innerAny = false; for (let i = 0; i < CN; i++) if (inner[i]) { innerAny = true; break; }
  const bigBg = () => medianBg(crop, odd(clp(lineh * 1.1, 15, 101)));
  if (err > 14) bg = bigBg();
  let inMed = null;
  if (innerAny) { const v = []; for (let i = 0; i < CN; i++) if (inner[i]) v.push([cd[i * 3], cd[i * 3 + 1], cd[i * 3 + 2]]); inMed = chanMedian(v); }
  let innerMode = false;
  if (inMed && !outline) {
    let dom = 0, tot = 0;
    for (let i = 0; i < CN; i++) if (inner[i]) { tot++; if (Math.max(Math.abs(cd[i * 3] - inMed[0]), Math.abs(cd[i * 3 + 1] - inMed[1]), Math.abs(cd[i * 3 + 2] - inMed[2])) < 30) dom++; }
    dom /= Math.max(1, tot);
    const sides = [];
    for (let [sx1, sy1, sx2, sy2] of [[x, y - 5, x + w, y - 1], [x, y + h + 1, x + w, y + h + 5], [x - 5, y, x - 1, y + h], [x + w + 1, y, x + w + 5, y + h]]) {
      sx1 = clp(sx1, 0, W); sy1 = clp(sy1, 0, H); sx2 = clp(sx2, 0, W); sy2 = clp(sy2, 0, H);
      if (sx2 - sx1 >= 1 && sy2 - sy1 >= 1) {
        const mean = [0, 0, 0], sq = [0, 0, 0]; let n = 0;
        for (let yy = sy1; yy < sy2; yy++) for (let xx = sx1; xx < sx2; xx++) { n++; for (let c2 = 0; c2 < 3; c2++) { const v = img.d[(yy * W + xx) * 3 + c2]; mean[c2] += v; sq[c2] += v * v; } }
        let sd = 0; for (let c2 = 0; c2 < 3; c2++) { mean[c2] /= n; sd = Math.max(sd, Math.sqrt(Math.max(0, sq[c2] / n - mean[c2] * mean[c2]))); }
        if (sd < 18) sides.push(mean);
      }
    }
    if (dom > 0.5 && sides.some(sd => Math.max(Math.abs(sd[0] - inMed[0]), Math.abs(sd[1] - inMed[1]), Math.abs(sd[2] - inMed[2])) > 45)) {
      innerMode = true;
      const mb = bigBg();
      bg = { w: cw, h: ch, c: 3, d: new Float32Array(CN * 3) };
      for (let i = 0; i < CN; i++) for (let c2 = 0; c2 < 3; c2++) bg.d[i * 3 + c2] = inner[i] ? mb.d[i * 3 + c2] : inMed[c2];
    }
  }
  const bd = bg.d, diff = new Float32Array(CN);
  for (let i = 0; i < CN; i++) diff[i] = Math.max(Math.abs(cd[i * 3] - bd[i * 3]), Math.abs(cd[i * 3 + 1] - bd[i * 3 + 1]), Math.abs(cd[i * 3 + 2] - bd[i * 3 + 2]));
  const win = new Uint8Array(CN);
  if (innerMode) win.set(inner);
  else {
    const wx1 = Math.max(0, x - exw - x0), wy1 = Math.max(0, y - ex - y0), wx2 = Math.min(cw, x + w + exw - x0), wy2 = Math.min(ch, y + h + ex - y0);
    for (let yy = wy1; yy < wy2; yy++) for (let xx = wx1; xx < wx2; xx++) win[yy * cw + xx] = 1;
  }
  // כיתוב קצר שה-AI חתך באמצע (חסרה שורה אחרונה): מרחיבים מעט כלפי מטה, אבל לא לתוך אלמנט אחר
  const ev = extBelow && !innerMode ? Math.floor(1.1 * Math.max(6, h / Math.max(1, nlines))) : 0;
  const blocked = (xx, yy) => (others || []).some(o => xx >= o[0] && xx < o[0] + o[2] && yy >= o[1] && yy < o[1] + o[3]);
  const extRows = [];
  if (ev) for (let yy = Math.max(0, y + h - y0); yy < Math.min(ch, y + h + ev - y0); yy++) { extRows.push(yy); for (let xx = Math.max(0, x - exw - x0); xx < Math.min(cw, x + w + exw - x0); xx++) if (!blocked(x0 + xx, y0 + yy)) win[yy * cw + xx] = 1; }
  const ref = []; { const msk = innerAny ? inner : win; for (let i = 0; i < CN; i++) if (msk[i]) ref.push(diff[i]); }
  if (!ref.length) return null;
  const p98 = percentile(ref, 98), thr = Math.max(26, 0.2 * p98);
  let ink = new Uint8Array(CN), inkCount = 0;
  for (let i = 0; i < CN; i++) if (diff[i] > thr && win[i]) { ink[i] = 1; inkCount++; }
  if (inkCount < 6) return null;
  // צבעי הטקסט
  let strong = ink;
  { const vals = []; for (let i = 0; i < CN; i++) if (ink[i] && inner[i]) vals.push(diff[i]);
    if (vals.length) { const p55 = percentile(vals, 55); strong = new Uint8Array(CN); for (let i = 0; i < CN; i++) if (ink[i] && inner[i] && diff[i] >= p55) strong[i] = 1; } }
  const pts = []; for (let i = 0; i < CN; i++) if (strong[i]) pts.push([cd[i * 3], cd[i * 3 + 1], cd[i * 3 + 2]]);
  let cols = [chanMedian(pts)];
  if (pts.length > 50) {
    const km = kmeans2(pts.slice(0, 6000));
    const dd = Math.hypot(km.cen[0][0] - km.cen[1][0], km.cen[0][1] - km.cen[1][1], km.cen[0][2] - km.cen[1][2]);
    if (dd > 45 && Math.min(km.frac[0], km.frac[1]) > 0.05) cols = [km.cen[0], km.cen[1]];
  }
  const sep = cols.length > 1 ? Math.hypot(cols[0][0] - cols[1][0], cols[0][1] - cols[1][1], cols[0][2] - cols[1][2]) : 0;
  const tol = outline ? 150 : (cols.length === 1 ? 95 : 110 + 0.6 * sep);
  const okc = new Uint8Array(CN);
  for (let i = 0; i < CN; i++) {
    let m = 1e9; for (const c of cols) m = Math.min(m, Math.hypot(cd[i * 3] - c[0], cd[i * 3 + 1] - c[1], cd[i * 3 + 2] - c[2]));
    if (m < tol) okc[i] = 1;
  }
  if (bullets) {
    const ya = Math.max(0, y - y0), yb = Math.min(ch, y + h - y0);
    for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) {
      const i = yy * cw + xx;
      if (!inner[i] && yy >= ya && yy < yb) okc[i] = 1;
      const mx = Math.max(cd[i * 3], cd[i * 3 + 1], cd[i * 3 + 2]), mn = Math.min(cd[i * 3], cd[i * 3 + 1], cd[i * 3 + 2]);
      if (mx - mn > 70) okc[i] = 1;
    }
  }
  for (let i = 0; i < CN; i++) ink[i] = ink[i] && okc[i] ? 1 : 0;
  const r = clp(Math.floor(Math.min(lineh, 80) * 0.06), 2, 5);
  const dd = dilateDisk(ink, cw, ch, r);
  const { lab } = labelCC(dd, cw, ch);
  const keepIds = new Set();
  const cy1 = Math.max(0, Math.floor(y + h * 0.15 - y0)), cy2 = Math.min(ch, Math.floor(y + h * 0.85 - y0));
  const cx1 = Math.max(0, Math.floor(x - x0)), cx2 = Math.min(cw, Math.floor(x + w - x0));
  for (let yy = cy1; yy < cy2; yy++) for (let xx = cx1; xx < cx2; xx++) { const i = yy * cw + xx; if (ink[i] && lab[i] > 0) keepIds.add(lab[i]); }
  if (ev) { // רכיבים שמתחילים ממש מתחת לתיבה ומתיישרים איתה: זו השורה החסרה
    const ys = Math.max(0, y + h - y0), ye = Math.min(ch, Math.floor(y + h + 0.7 * (h / Math.max(1, nlines)) - y0));
    for (let yy = ys; yy < ye; yy++) for (let xx = cx1; xx < cx2; xx++) { const i = yy * cw + xx; if (ink[i] && lab[i] > 0) keepIds.add(lab[i]); }
  }
  if (!keepIds.size) return null;
  const keep = new Uint8Array(CN); for (let i = 0; i < CN; i++) if (lab[i] > 0 && keepIds.has(lab[i]) && dd[i]) keep[i] = 1;
  // אלפא
  const sthr = Math.max(thr * 1.8, 0.55 * p98);
  const num = { w: cw, h: ch, c: 3, d: new Float32Array(CN * 3) }, den = plane(cw, ch);
  for (let i = 0; i < CN; i++) if (diff[i] > sthr && ink[i] && keep[i]) { den.d[i] = 1; num.d[i * 3] = cd[i * 3]; num.d[i * 3 + 1] = cd[i * 3 + 1]; num.d[i * 3 + 2] = cd[i * 3 + 2]; }
  const sg = Math.max(2, lineh * 0.25);
  const bn = blur(num, sg), bdn = blur(den, sg), C0 = cols[0];
  const Cl = new Float32Array(CN * 3), alpha = new Float32Array(CN);
  for (let i = 0; i < CN; i++) {
    const dv = bdn.d[i];
    for (let c2 = 0; c2 < 3; c2++) Cl[i * 3 + c2] = dv > 1e-3 ? bn.d[i * 3 + c2] / Math.max(dv, 1e-6) : C0[c2];
    if (!keep[i]) continue;
    let dot = 0, vv = 0;
    for (let c2 = 0; c2 < 3; c2++) { const v = Cl[i * 3 + c2] - bd[i * 3 + c2]; dot += (cd[i * 3 + c2] - bd[i * 3 + c2]) * v; vv += v * v; }
    let a = clp(dot / Math.max(vv, 1), 0, 1);
    if (a < 0.05) a = 0;
    alpha[i] = a;
  }
  let bx1 = 1e9, by1 = 1e9, bx2 = -1, by2 = -1, cnt3 = 0;
  for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) if (alpha[yy * cw + xx] > 0.3) { cnt3++; bx1 = Math.min(bx1, xx); bx2 = Math.max(bx2, xx + 1); by1 = Math.min(by1, yy); by2 = Math.max(by2, yy + 1); }
  if (cnt3 < 4) return null;
  // חור לניקוי הרקע (ריבוע 5×5)
  const hm0 = new Float32Array(CN); for (let i = 0; i < CN; i++) hm0[i] = alpha[i] > 0.04 ? 1 : 0;
  const hm = boxMax(hm0, cw, ch, 2);
  for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) if (hm[yy * cw + xx] > 0) holes[(y0 + yy) * W + x0 + xx] = 1;
  const pa = 2;
  bx1 = Math.max(0, bx1 - pa); by1 = Math.max(0, by1 - pa); bx2 = Math.min(cw, bx2 + pa); by2 = Math.min(ch, by2 + pa);
  const lw = bx2 - bx1, lh = by2 - by1;
  const a0 = plane(lw, lh), rgb0 = { w: lw, h: lh, c: 3, d: new Float32Array(lw * lh * 3) };
  for (let yy = 0; yy < lh; yy++) for (let xx = 0; xx < lw; xx++) {
    const s = (by1 + yy) * cw + bx1 + xx, o = yy * lw + xx;
    a0.d[o] = alpha[s]; for (let c2 = 0; c2 < 3; c2++) rgb0.d[o * 3 + c2] = clp(Cl[s * 3 + c2], 0, 255);
  }
  const up = lw * lh * upMax * upMax < 8e6 ? upMax : 2;
  let aUp = resize(a0, lw * up, lh * up, 'cubic');
  aUp = blur(aUp, 0.33 * up);
  for (let i = 0; i < aUp.d.length; i++) aUp.d[i] = clp((aUp.d[i] - 0.42) / 0.3 + 0.5, 0, 1); // מרכז מעט נמוך מ-0.5: שומר על עובי האותיות המקורי
  const rgbUp = resize(rgb0, lw * up, lh * up, 'linear');
  if (outline) { // מנקים את כל פס המסגרת סביב הכפתור
    const bx0 = x, by0 = y, bxe = x + w, bye = y + h;
    const rx0 = Math.max(0, bx0 - 5), ry0 = Math.max(0, by0 - 5), rx1 = Math.min(W, bxe + 5), ry1 = Math.min(H, bye + 5);
    const inRim = (xx, yy) => !(xx >= bx0 + 7 && xx < bxe - 7 && yy >= by0 + 7 && yy < bye - 7);
    const v = [];
    for (let yy = ry0; yy < ry1; yy++) for (let xx = rx0; xx < rx1; xx++) if (inRim(xx, yy)) v.push([img.d[(yy * W + xx) * 3], img.d[(yy * W + xx) * 3 + 1], img.d[(yy * W + xx) * 3 + 2]]);
    if (v.length) {
      const m = chanMedian(v);
      for (let yy = ry0; yy < ry1; yy++) for (let xx = rx0; xx < rx1; xx++) if (inRim(xx, yy)) {
        const o = (yy * W + xx) * 3;
        if (Math.max(Math.abs(img.d[o] - m[0]), Math.abs(img.d[o + 1] - m[1]), Math.abs(img.d[o + 2] - m[2])) > 8) holes[yy * W + xx] = 1;
      }
    }
  }
  return { rgb: rgbUp.d, a: aUp.d, lw: aUp.w, lh: aUp.h, up, x: x0 + bx1, y: y0 + by1, w: lw, h: lh };
}

// ---------------------------------------------------------------- גרפיקה
function gradients(clean) {
  const { w, h } = clean, g = new Float32Array(w * h), gx = new Float32Array(w * h), gy = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * clean.d[i * 3] + 0.587 * clean.d[i * 3 + 1] + 0.114 * clean.d[i * 3 + 2];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const xm = refl(x - 1, w), xp = refl(x + 1, w), ym = refl(y - 1, h), yp = refl(y + 1, h);
    const a = g[ym * w + xm], b = g[ym * w + x], c = g[ym * w + xp], d = g[y * w + xm], f = g[y * w + xp], gg = g[yp * w + xm], hh = g[yp * w + x], ii = g[yp * w + xp];
    gx[y * w + x] = (c + 2 * f + ii) - (a + 2 * d + gg);
    gy[y * w + x] = (gg + 2 * hh + ii) - (a + 2 * b + c);
  }
  return { gx, gy };
}
function fitCircle(grad, W, H, box) {
  const [x, y, w, h] = box, cx0 = x + w / 2, cy0 = y + h / 2, r0 = Math.min(w, h) / 2;
  const ca = [], sa = [];
  for (let i = 0; i < 64; i++) { const a = i / 64 * 2 * Math.PI; ca.push(Math.cos(a)); sa.push(Math.sin(a)); }
  let best = [-1, cx0, cy0, r0];
  for (let dr = -0.15; dr <= 0.2501; dr += 0.03) {
    const r = r0 * (1 + dr);
    for (let dx = -0.15; dx <= 0.1501; dx += 0.03) for (let dy = -0.15; dy <= 0.1501; dy += 0.03) {
      const cx = cx0 + dx * r0 * 2, cy = cy0 + dy * r0 * 2;
      let s = 0, ok = 0;
      for (let i = 0; i < 64; i++) {
        const px = Math.round(cx + ca[i] * r), py = Math.round(cy + sa[i] * r);
        if (px > 0 && py > 0 && px < W - 1 && py < H - 1) { ok++; s += Math.abs(grad.gx[py * W + px] * ca[i] + grad.gy[py * W + px] * sa[i]); }
      }
      if (ok < 40) continue;
      s *= (1 + dr * 0.8);
      if (s > best[0]) best = [s, cx, cy, r];
    }
  }
  return [best[1], best[2], best[3]];
}
function ringDiff(clean, box, pad) {
  const W = clean.w, H = clean.h, [x, y, w, h] = box;
  const x0 = clp(x - pad, 0, W - 2), y0 = clp(y - pad, 0, H - 2), x1 = clp(x + w + pad, x0 + 2, W), y1 = clp(y + h + pad, y0 + 2, H);
  const crop = cropImg(clean, x0, y0, x1, y1), { bg } = ringBg(crop);
  const cw = crop.w, ch = crop.h, df = new Float32Array(cw * ch);
  for (let i = 0; i < cw * ch; i++) df[i] = Math.max(Math.abs(crop.d[i * 3] - bg.d[i * 3]), Math.abs(crop.d[i * 3 + 1] - bg.d[i * 3 + 1]), Math.abs(crop.d[i * 3 + 2] - bg.d[i * 3 + 2]));
  return { df, cw, ch, x0, y0 };
}
function graphicLayer(clean, e, grad) {
  const W = clean.w, H = clean.h;
  let [x, y, w, h] = e.px;
  const shape = e.shape;
  if (shape === 'circle') {
    const [cx, cy, r] = fitCircle(grad, W, H, [x, y, w, h]), rr = Math.round(r);
    x = Math.round(cx) - rr; y = Math.round(cy) - rr; w = 2 * rr; h = 2 * rr;
  } else if (shape === 'pill' || shape === 'rounded') {
    const { df, cw, ch, x0, y0 } = ringDiff(clean, [x, y, w, h], Math.max(4, Math.floor(Math.min(w, h) * 0.2)));
    let mnx = 1e9, mny = 1e9, mxx = -1, mxy = -1, n = 0;
    for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) if (df[yy * cw + xx] > 36) { n++; mnx = Math.min(mnx, xx); mxx = Math.max(mxx, xx); mny = Math.min(mny, yy); mxy = Math.max(mxy, yy); }
    if (n > 20) {
      const bx = x0 + mnx, by = y0 + mny, bw = mxx - mnx + 1, bh = mxy - mny + 1;
      if (0.8 * w < bw && bw < 1.3 * w && 0.8 * h < bh && bh < 1.3 * h) { x = bx; y = by; w = bw; h = bh; }
    }
  }
  x = clp(x, 0, W - 4); y = clp(y, 0, H - 4); w = Math.min(w, W - x); h = Math.min(h, H - y);
  if (w < 4 || h < 4) return null;
  const crop = cropImg(clean, x, y, x + w, y + h), a = new Float32Array(w * h);
  if (shape === 'circle') {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) a[j * w + i] = clp(Math.min(w, h) / 2 - Math.hypot(i + .5 - w / 2, j + .5 - h / 2) + .5, 0, 1);
  } else if (shape === 'pill' || shape === 'rounded') {
    const rad = shape === 'pill' ? Math.min(w, h) / 2 : Math.min(w, h) * 0.22;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const qx = Math.abs(i + .5 - w / 2) - (w / 2 - rad), qy = Math.abs(j + .5 - h / 2) - (h / 2 - rad);
      a[j * w + i] = clp(.5 - (Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad), 0, 1);
    }
  } else if (shape === 'free') {
    const { df, cw, x0, y0 } = ringDiff(clean, [x, y, w, h], Math.max(6, Math.floor(Math.min(w, h) * 0.2)));
    const sub = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) sub[j * w + i] = clp((df[(y - y0 + j) * cw + (x - x0 + i)] - 10) / 26, 0, 1);
    const r0 = Math.max(2, Math.round(Math.min(w, h) * 0.04));
    const cl = boxMin(boxMax(sub, w, h, r0), w, h, r0);
    for (let i = 0; i < w * h; i++) a[i] = clp(cl[i], 0, 1);
    if (e.role === 'logo' || e.role === 'badge') { // ממלאים חורים פנימיים (למשל רקע לבן בתוך הלוגו) – כל מה שלא מחובר לשפה נשאר בפנים
      const out = new Uint8Array(w * h), st = [];
      const push = (i, j) => { const k = j * w + i; if (!out[k] && a[k] < 0.5) { out[k] = 1; st.push(k); } };
      for (let i = 0; i < w; i++) { push(i, 0); push(i, h - 1); } for (let j = 0; j < h; j++) { push(0, j); push(w - 1, j); }
      while (st.length) { const k = st.pop(), i = k % w, j = (k / w) | 0; if (i > 0) push(i - 1, j); if (i < w - 1) push(i + 1, j); if (j > 0) push(i, j - 1); if (j < h - 1) push(i, j + 1); }
      for (let k = 0; k < w * h; k++) if (!out[k]) a[k] = 1;
    }
  } else {
    const f = shape === 'hero' ? Math.max(28, Math.min(w, h) * 0.1) : 3;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) a[j * w + i] = clp(Math.min(i, j, w - 1 - i, h - 1 - j) / f, 0, 1);
  }
  return { rgb: crop.d, a, lw: w, lh: h, up: 1, x, y, w, h };
}

// מחלק שכבת טקסט ל-n שורות (פסי גובה): לפי רווחים ריקים, ואם השורות נוגעות זו בזו חותך בעמק הדל ביותר
function lineBands(L, n) {
  const { lw: w, lh: h, a } = L;
  const rows = new Float32Array(h);
  for (let j = 0; j < h; j++) { let c = 0; for (let i = 0; i < w; i++) if (a[j * w + i] > 0.5) c++; rows[j] = c; }
  const bands = []; let st = -1;
  for (let j = 0; j <= h; j++) { const on = j < h && rows[j] > 0; if (on && st < 0) st = j; else if (!on && st >= 0) { bands.push([st, j]); st = -1; } }
  if (!bands.length) return null;
  const mx = Math.max(...bands.map(b => b[1] - b[0]), 1), merged = [];
  for (const b of bands) { const last = merged[merged.length - 1]; if (last && (b[0] - last[1] <= Math.max(2, mx * 0.12)) && (b[1] - b[0] < mx * 0.45 || last[1] - last[0] < mx * 0.45)) last[1] = b[1]; else merged.push([b[0], b[1]]); }
  if (merged.length < n) {
    const t0 = bands[0][0], t1 = bands[bands.length - 1][1], lh = (t1 - t0) / n, cuts = [t0];
    for (let k = 1; k < n; k++) { let bj = Math.round(t0 + k * lh), bv = 1e9; for (let j = Math.round(t0 + k * lh - lh * 0.28); j <= Math.round(t0 + k * lh + lh * 0.28); j++) { const v = rows[Math.max(0, Math.min(h - 1, j))]; if (v < bv) { bv = v; bj = j; } } cuts.push(bj); }
    cuts.push(t1); merged.length = 0; for (let k = 0; k < n; k++) merged.push([cuts[k], cuts[k + 1]]);
  }
  return merged.length === n ? merged : null;
}
// ממרכז שורות של כיתוב רב-שורתי בתוך השכבה (בכיתוב המקורי השורות לא תמיד באמצע)
function centerLines(L, n) {
  const { lw: w, lh: h, a, rgb } = L; if (n < 2) return;
  const merged = lineBands(L, n); if (!merged) return;
  const ext = merged.map(([y0, y1]) => { let lo = w, hi = -1; for (let j = y0; j < y1; j++) for (let i = 0; i < w; i++) if (a[j * w + i] > 0.5) { if (i < lo) lo = i; if (i > hi) hi = i; } return [lo, hi]; });
  const cx = (Math.min(...ext.map(e => e[0])) + Math.max(...ext.map(e => e[1]))) / 2;
  merged.forEach(([y0, y1], k) => {
    let d = Math.round(cx - (ext[k][0] + ext[k][1]) / 2); d = Math.max(-ext[k][0], Math.min(w - 1 - ext[k][1], d));
    if (!d) return;
    const y0b = Math.max(0, y0 - 2), y1b = Math.min(h, y1 + 2);
    for (let j = y0b; j < y1b; j++) {
      const ra = a.slice(j * w, j * w + w), rr = rgb.slice(j * w * 3, j * w * 3 + w * 3);
      for (let i = 0; i < w; i++) { const si = Math.max(0, Math.min(w - 1, i - d)); a[j * w + i] = ra[si]; rgb[(j * w + i) * 3] = rr[si * 3]; rgb[(j * w + i) * 3 + 1] = rr[si * 3 + 1]; rgb[(j * w + i) * 3 + 2] = rr[si * 3 + 2]; }
    }
  });
}

// ---------------------------------------------------------------- שבירת שורות מחדש
// כותרת שנחתכה כתמונה מפורקת למילים (לפי הרווחים בין האותיות ומספר המילים שה-AI קרא), כך שאפשר לסדר אותה
// בשורות אחרות: בבאנר צר כל מילה בשורה, ובבאנר רחב כמה מילים בשורה אחת. הפיקסלים נשארים המקוריים.
function wordsOf(e) {
  if (e._w !== undefined) return e._w;
  e._w = null;
  const L = e.layer; if (!L || !e.lines || !e.lines.length) return null;
  const per = e.lines.map(l => String(l).trim().split(/\s+/).filter(Boolean)), n = per.length, total = per.reduce((a, p) => a + p.length, 0);
  if (total < 2 || total > 30) return null;
  const bands = lineBands(L, n); if (!bands) return null;
  const { lw: w, a } = L, rtl = HEB.test(e.lines.join('')), words = [], splitGaps = [];
  for (let i = 0; i < n; i++) {
    const [y0, y1] = bands[i], bh = y1 - y0, k = per[i].length - 1;
    const ink = new Uint8Array(w);
    for (let j = y0; j < y1; j++) for (let x = 0; x < w; x++) if (a[j * w + x] > 0.5) ink[x] = 1;
    const runs = []; let st = -1;
    for (let x = 0; x <= w; x++) { if (x < w && ink[x]) { if (st < 0) st = x; } else if (st >= 0) { runs.push([st, x - 1]); st = -1; } }
    if (runs.length < k + 1) return null;
    const gaps = runs.slice(1).map((r, j) => ({ j, g: r[0] - runs[j][1] - 1 })).sort((p, q) => q.g - p.g);
    if (k > 0) {
      const lo = gaps[k - 1].g, nxt = gaps[k] ? gaps[k].g : 0;
      if (!(lo > 1.35 * nxt || lo > 0.22 * bh)) return null;
      for (let t = 0; t < k; t++) splitGaps.push(gaps[t].g);
    }
    const cut = new Set(gaps.slice(0, k).map(g => g.j)), line = []; let s0 = runs[0][0];
    for (let j = 0; j < runs.length; j++) { if (j === runs.length - 1 || cut.has(j)) { line.push([s0, runs[j][1]]); if (j < runs.length - 1) s0 = runs[j + 1][0]; } }
    if (line.length !== k + 1) return null;
    if (rtl) line.reverse();
    line.forEach(([x0, x1]) => words.push({ x0, x1, y0, y1, line: i }));
  }
  const bhs = bands.map(b => b[1] - b[0]).sort((p, q) => p - q), bandH = bhs[bhs.length >> 1];
  const gapSp = splitGaps.length ? splitGaps.sort((p, q) => p - q)[splitGaps.length >> 1] : bandH * 0.3;
  const lgs = []; for (let i = 0; i + 1 < n; i++) lgs.push(Math.max(0, bands[i + 1][0] - bands[i][1])); lgs.sort((p, q) => p - q);
  const lineGap = Math.max(bandH * 0.08, lgs.length ? lgs[lgs.length >> 1] : bandH * 0.15), pitch = bandH + lineGap;
  let ph = new Array(total).fill(0), P = 1;
  if (e.phrases && e.phrases.length > 1) {
    const cnt = e.phrases.map(t => String(t).trim().split(/\s+/).filter(Boolean).length);
    if (cnt.reduce((p, q) => p + q, 0) === total) { ph = []; cnt.forEach((c, i) => { for (let t = 0; t < c; t++) ph.push(i); }); P = cnt.length; }
  }
  const brk = new Set(); let acc = 0; per.forEach((p, i) => { acc += p.length; if (i < n - 1) brk.add(acc); });
  words.forEach((wd, i) => { wd.ph = ph[i]; });
  e._w = { words, gap: Math.max(2, gapSp), bandH, pitch, lineGap, rtl, P, brk };
  return e._w;
}
// בוחר חלוקה למילים-בשורות שנותנת את הכיתוב הגדול ביותר בתוך תיבה (bw × bh בפיקסלים של היעד), ובונה ממנה שכבה חדשה
function reflowLeaf(e, bw, bh, lineBias) {
  const W = wordsOf(e); if (!W) return null;
  const { words, gap, bandH, pitch, lineGap, rtl, P, brk } = W, n = words.length, up = e.layer.up || 1;
  const ww = words.map(x => x.x1 - x.x0 + 1);
  let best = null;
  const consider = acc => {
    {
      const k = acc.length;
      if (k >= P && P > 1) for (const [s, t] of acc) for (let i = s + 1; i < t; i++) if (words[i].ph !== words[s].ph) return;
      const lws = acc.map(([s, t]) => { let v = (t - s - 1) * gap; for (let i = s; i < t; i++) v += ww[i]; return v; }), lw = Math.max(...lws);
      let extra = 0; if (P > 1 && k > P) for (let i = 0; i < k - 1; i++) if (words[acc[i][1]].ph !== words[acc[i][1] - 1].ph) extra += bandH * 0.32;
      const lhs = acc.map(([s, t]) => { let v = 0; for (let i = s; i < t; i++) v = Math.max(v, words[i].y1 - words[i].y0); return v; });
      const lh = lhs.reduce((p, q) => p + q, 0) + (k - 1) * lineGap + extra;
      const mean = lws.reduce((p, q) => p + q, 0) / k, rag = lws.reduce((p, q) => p + Math.abs(q - mean), 0) / (k * lw);
      const cuts = new Set(acc.slice(0, -1).map(([, t]) => t)); let same = cuts.size === brk.size; if (same) for (const c of cuts) if (!brk.has(c)) same = false;
      const s = Math.min(bw / (lw / up), bh / (lh / up)) * (1 - 0.12 * rag) * (same ? 1.04 : 1) * (lineBias ? 1 - lineBias * (k - 1) : 1);
      if (!best || s > best.s * 1.01) best = { s, acc: acc.slice(), lws, lhs, lw, lh, extra };
    }
  };
  const rec = (start, acc) => {
    if (start === n) { consider(acc); return; }
    for (let end = start + 1; end <= n; end++) { acc.push([start, end]); rec(end, acc); acc.pop(); }
  };
  if (n <= 12) rec(0, []);
  else { // טקסט ארוך (פסקה): חלוקה חמדנית לשורות בערך שוות לכל מספר שורות אפשרי
    const tot = ww.reduce((p, q) => p + q, 0) + gap * (n - 1);
    for (let k = 1; k <= Math.min(n, 14); k++) {
      const acc = [], target = tot / k; let st = 0;
      for (let li = 0; li < k && st < n; li++) {
        let en = st, wsum = 0;
        while (en < n && (en === st || (li === k - 1) || wsum + ww[en] + (en > st ? gap : 0) <= target * 1.03 || Math.abs(wsum + ww[en] - target) < Math.abs(wsum - target))) { wsum += ww[en] + (en > st ? gap : 0); en++; }
        acc.push([st, en]); st = en;
      }
      if (st === n && acc.length === k) consider(acc);
    }
  }
  if (!best) return null;
  const pad = 3, W2 = Math.ceil(best.lw) + 2 * pad, H2 = Math.ceil(best.lh) + 2 * pad, src = e.layer, sw = src.lw;
  const a = new Float32Array(W2 * H2), rgb = new Float32Array(W2 * H2 * 3);
  let y = pad;
  best.acc.forEach(([s, t], li) => {
    if (li > 0 && P > 1 && best.acc.length > P && words[s].ph !== words[s - 1].ph) y += bandH * 0.32;
    let cur = rtl ? pad + (best.lw - best.lws[li]) / 2 + best.lws[li] : pad + (best.lw - best.lws[li]) / 2;
    for (let i = s; i < t; i++) {
      const wd = words[i], wwid = ww[i], x0 = Math.round(rtl ? cur - wwid : cur);
      for (let j = wd.y0 - 2; j < wd.y1 + 2; j++) {
        if (j < 0 || j >= src.lh) continue; const dy = Math.round(y + (best.lhs[li] - (wd.y1 - wd.y0)) / 2) + (j - wd.y0); if (dy < 0 || dy >= H2) continue;
        for (let x = wd.x0 - 2; x <= wd.x1 + 2; x++) {
          const dx = x0 + (x - wd.x0); if (x < 0 || x >= sw || dx < 0 || dx >= W2) continue;
          const si = j * sw + x, di = dy * W2 + dx, al = src.a[si];
          if (al > a[di]) { a[di] = al; rgb[di * 3] = src.rgb[si * 3]; rgb[di * 3 + 1] = src.rgb[si * 3 + 1]; rgb[di * 3 + 2] = src.rgb[si * 3 + 2]; }
        }
      }
      cur = rtl ? cur - wwid - gap : cur + wwid + gap;
    }
    y += best.lhs[li] + lineGap;
  });
  return { rgb, a, lw: W2, lh: H2, up, s: best.s, k: best.acc.length };
}
// יחידה (למשל כותרת + שורת פתיחה) אחרי שבירת השורות מחדש. מחזיר את היחידה המקורית אם אין מה לשנות.
function solidLayer(w, h, color) {
  const lw = Math.max(2, Math.round(w)), lh = Math.max(2, Math.round(h)), a = new Float32Array(lw * lh).fill(1), rgb = new Float32Array(lw * lh * 3);
  for (let i = 0; i < lw * lh; i++) { rgb[i * 3] = color[0]; rgb[i * 3 + 1] = color[1]; rgb[i * 3 + 2] = color[2]; }
  return { rgb, a, lw, lh, up: 1 };
}
function reflowUnit(u, W, H, box) {
  const plate = u.kids.find(k => !k.text && k.solid);
  if (plate) { // לוח צבע עם טקסט עליו: שוברים שורות מחדש ומותחים את הלוח סביב הטקסט
    const tk = u.kids.filter(k => k !== plate);
    if (!tk.length || !tk.every(k => k.text && ['headline', 'subheadline', 'body', 'label'].includes(k.role))) return u;
    const tx0 = Math.min(...tk.map(k => k.x)), tx1 = Math.max(...tk.map(k => k.x + k.w)), ty0 = Math.min(...tk.map(k => k.y)), ty1 = Math.max(...tk.map(k => k.y + k.h));
    const padX = Math.max(6, (plate.w - (tx1 - tx0)) / 2), padY = Math.max(4, (plate.h - (ty1 - ty0)) / 2);
    const inner = reflowUnit({ ...u, kids: tk }, W - 2 * padX * 0.6, H);
    const stack = inner === u || inner.kids === tk ? null : inner;
    if (!stack) return u;
    const uw = stack.w + 2 * padX, uh = stack.h + 2 * padY, rel = new Map();
    const np = { ...plate, layer: solidLayer(uw * (plate.layer.up || 1), uh * (plate.layer.up || 1), plate.solid), w: uw, h: uh, reflowed: true, isPlate: true };
    plate.isPlate = true;
    rel.set(np, [0, 0]);
    for (const k of stack.kids) { const r = stack.rel.get(k); rel.set(k, [r[0] + padX, r[1] + padY]); }
    return { ...u, kids: [np, ...stack.kids], w: uw, h: uh, rel, pin: null, reflowed: true };
  }
  if (!u.kids.every(k => k.text && ['headline', 'subheadline', 'body'].includes(k.role))) return u;
  const heads = u.kids.filter(k => (k.role === 'headline' || ((k.role === 'subheadline' || k.role === 'body') && W / H < 1.15)) && wordsOf(k)); if (!heads.length) return u;
  const m = Math.min(W, H) * 0.07, wide = box ? box[2] / box[3] >= 1.6 : W / H >= 1.6;
  const bw = box ? box[2] : wide ? W * 0.46 : W - 2 * m, bh = box ? box[3] * (u.kids.length > 1 ? 0.85 : 1) : (wide ? (H - 2 * m) * 0.8 : H * (W / H < 0.5 ? 0.55 : 0.42)) * (u.kids.length > 1 ? 0.85 : 1);
  const orig = u.kids.slice().sort((p, q) => p.y - q.y);
  const kids = orig.map(k => {
    if (!heads.includes(k)) return k;
    const L2 = reflowLeaf(k, bw, k.role === 'headline' ? bh : k.role === 'body' ? H * 0.3 : H * 0.16, wide ? 0.09 : 0); if (!L2) return k;
    return { ...k, layer: L2, w: L2.lw / L2.up, h: L2.lh / L2.up, reflowed: true };
  });
  if (kids.every((k, i) => k === orig[i])) return u;
  const uw = Math.max(...kids.map(k => k.w)), rel = new Map(); let y = 0;
  kids.forEach((k, i) => { if (i > 0) y += Math.max(0, orig[i].y - (orig[i - 1].y + orig[i - 1].h)); rel.set(k, [(uw - k.w) / 2, y]); y += k.h; });
  return { ...u, kids, w: uw, h: y, rel, pin: null, reflowed: true };
}

// ---------------------------------------------------------------- סצנה
function buildScene(img, elements, onProgress) {
  const W = img.w, H = img.h, tell = m => onProgress && onProgress(m);
  const els = [];
  (elements || []).slice(0, 60).forEach((e, i) => {
    const b = e.box; if (!Array.isArray(b) || b.length !== 4) return;
    const bb = b.map(Number); if (bb.some(v => !isFinite(v))) return;
    let x1 = Math.round(bb[0] / 1000 * W), y1 = Math.round(bb[1] / 1000 * H), x2 = Math.round(bb[2] / 1000 * W), y2 = Math.round(bb[3] / 1000 * H);
    x1 = clp(x1, 0, W - 4); y1 = clp(y1, 0, H - 4); x2 = clp(x2, x1 + 4, W); y2 = clp(y2, y1 + 4, H);
    const role = e.role || 'decor', lines = (e.lines || []).map(String);
    let isText = TEXT_ROLES.has(role) || (lines.length > 0 && role !== 'button');
    const shape = e.shape || { photo: 'circle', button: 'pill', hero: 'hero', logo: 'free' }[role] || 'free';
    if (role === 'button' && e.style === 'outline') isText = true;
    els.push({ id: e.id || 'e' + i, role, lines, text: isText, shape, group: role === 'hero' ? null : (e.group || null), px: [x1, y1, x2 - x1, y2 - y1], z: i, bullet: e.bullet || null, phrases: e.phrases || null });
  });
  // תיבות טקסט שחופפות (הזיהוי חתך אותו כיתוב לשני חלקים): מאחדים לתיבה אחת
  for (let i = 0; i < els.length; i++) for (let j = els.length - 1; j > i; j--) {
    const a = els[i], b = els[j];
    if (!a.text || !b.text || a.role === 'button' || b.role === 'button' || a.role === 'headline' || b.role === 'headline') continue;
    const ix = Math.min(a.px[0] + a.px[2], b.px[0] + b.px[2]) - Math.max(a.px[0], b.px[0]), iy = Math.min(a.px[1] + a.px[3], b.px[1] + b.px[3]) - Math.max(a.px[1], b.px[1]);
    const lh = Math.min(a.px[3], b.px[3]), gapY = Math.max(a.px[1], b.px[1]) - Math.min(a.px[1] + a.px[3], b.px[1] + b.px[3]);
    const stacked = ix > 0.5 * Math.min(a.px[2], b.px[2]) && gapY > -1 && gapY < 0.6 * lh && a.role === b.role && ['caption', 'body', 'subheadline'].includes(a.role); // שתי שורות של אותו כיתוב
    if (!stacked) {
      if (ix <= 0 || iy <= 0) continue;
      if (ix * iy < 0.3 * Math.min(a.px[2] * a.px[3], b.px[2] * b.px[3])) continue;
    }
    const x1 = Math.min(a.px[0], b.px[0]), y1 = Math.min(a.px[1], b.px[1]), x2 = Math.max(a.px[0] + a.px[2], b.px[0] + b.px[2]), y2 = Math.max(a.px[1] + a.px[3], b.px[1] + b.px[3]);
    const up = a.px[1] <= b.px[1];
    a.px = [x1, y1, x2 - x1, y2 - y1];
    const ov = ix > 0 && iy > 0;
    const big = ov ? (a.lines.join('').length >= b.lines.join('').length ? a.lines : b.lines) : (up ? a.lines.concat(b.lines) : b.lines.concat(a.lines));
    a.lines = big; a.phrases = null; els.splice(j, 1);
  }
  const leaves = [], holes = new Uint8Array(W * H);
  tell('חותך את הטקסטים…');
  for (const e of els) {
    if (!e.text) continue;
    const others = els.filter(o => o !== e).map(o => o.px);
    const L = textLayer(img, e.px, e.role === 'button' ? 2 : Math.max(1, e.lines.length), 4, e.role === 'button', !!e.bullet, holes, others, ['caption', 'body', 'subheadline'].includes(e.role) && e.lines.length > 1);
    if (!L) continue;
    if (['caption', 'body', 'label'].includes(e.role)) { // פס רקע שנחתך במקום אותיות: שורה שכמעט כולה אטומה
      let rm = 0; for (let j = 0; j < L.lh; j++) { let r = 0; for (let i = 0; i < L.lw; i++) { if (L.a[j * L.lw + i] > 0.5) { r++; if (r > rm) rm = r; } else r = 0; } }
      if (rm > 0.4 * L.lw && L.lw > 6 * L.lh) continue;
    }
    e.layer = L; if (['caption', 'subheadline', 'body'].includes(e.role)) centerLines(L, e.lines.length); leaves.push(e);
  }
  tell('מנקה את הרקע…');
  const clean = msFill(img, holes);
  clean.d.forEach((v, i, a) => { a[i] = clp(v, 0, 255); });
  const holes2 = Uint8Array.from(holes);
  let grad = null;
  tell('חותך תמונות ולוגו…');
  for (const e of els) {
    if (e.text) continue;
    if (e.shape === 'circle' && !grad) grad = gradients(clean);
    const L = graphicLayer(clean, e, grad);
    if (!L) continue;
    e.layer = L;
    if (['decor', 'badge'].includes(e.role) && L.w * L.h > 900) { // לוח צבע אחיד מאחורי טקסט: אפשר למתוח אותו מחדש לפי הטקסט
      let r0 = 0, g0 = 0, b0 = 0, n0 = 0, q = 0;
      const mx = Math.max(2, Math.floor(Math.min(L.w, L.h) * 0.08));
      for (let j = mx; j < L.h - mx; j += 2) for (let i = mx; i < L.w - mx; i += 2) if (L.a[j * L.w + i] > 0.95) { const o = (j * L.w + i) * 3; r0 += L.rgb[o]; g0 += L.rgb[o + 1]; b0 += L.rgb[o + 2]; n0++; }
      if (n0 > 50) {
        r0 /= n0; g0 /= n0; b0 /= n0;
        for (let j = mx; j < L.h - mx; j += 2) for (let i = mx; i < L.w - mx; i += 2) if (L.a[j * L.w + i] > 0.95) { const o = (j * L.w + i) * 3; q += Math.abs(L.rgb[o] - r0) + Math.abs(L.rgb[o + 1] - g0) + Math.abs(L.rgb[o + 2] - b0); }
        if (q / n0 / 3 < 9) e.solid = [Math.round(r0), Math.round(g0), Math.round(b0)];
      }
    }
    let r = 5; if (['pill', 'rounded', 'rect'].includes(e.shape)) r = Math.floor(Math.min(L.w, L.h) * 0.3); else if (e.shape === 'hero') r = 8;
    const pad = r + 1, mw = L.w + 2 * pad, mh = L.h + 2 * pad, m = new Uint8Array(mw * mh);
    for (let j = 0; j < L.h; j++) for (let i = 0; i < L.w; i++) if (L.a[j * L.w + i] * 255 > 10) m[(j + pad) * mw + i + pad] = 1;
    const dm = dilateDisk(m, mw, mh, r);
    for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {
      if (!dm[j * mw + i]) continue;
      const gx = L.x - pad + i, gy = L.y - pad + j;
      if (gx >= 0 && gy >= 0 && gx < W && gy < H) holes2[gy * W + gx] = 1;
    }
    leaves.push(e);
  }
  tell('משלים את הרקע…');
  let plate = msFill(clean, holes2);
  plate = softenDenseHoles(plate, holes2);
  for (let i = 0; i < plate.d.length; i++) plate.d[i] = clp(plate.d[i], 0, 255);
  for (const e of leaves) { const L = e.layer; e.x = L.x; e.y = L.y; e.w = L.w; e.h = L.h; }
  for (const t of leaves) {
    if (!t.text || t.group) continue;
    const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
    for (const r of leaves) {
      if (r.text || !['decor', 'badge', 'button'].includes(r.role)) continue;
      if (r.x < cx && cx < r.x + r.w && r.y < cy && cy < r.y + r.h && r.w * r.h > t.w * t.h) { r.group = r.group || 'auto_' + r.id; t.group = r.group; break; }
    }
  }
  // גלריה בלי תלות בקבוצות של ה-AI: תמונות עגולות/ריבועיות דומות בשורה אחת + הכיתובים שמתחתיהן
  {
    const ph = leaves.filter(e => !e.text && e.role === 'photo');
    if (ph.length >= 3) {
      const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
      const mw = med(ph.map(p => p.w)), mcy = med(ph.map(p => p.y + p.h / 2)), mh = med(ph.map(p => p.h));
      const row = ph.filter(p => Math.abs(p.w - mw) < 0.35 * mw && Math.abs(p.y + p.h / 2 - mcy) < 0.5 * mh);
      if (row.length >= 3) {
        for (const p of row) p.group = 'gal_auto';
        for (const t of leaves) {
          if (!t.text || !['caption', 'body', 'label', 'subheadline'].includes(t.role)) continue;
          const cx = t.x + t.w / 2; let best = null, bd = 1e9;
          for (const p of row) { const d = Math.abs(cx - (p.x + p.w / 2)); if (d < bd) { bd = d; best = p; } }
          if (best && bd < best.w * 1.1 && t.y >= best.y + best.h * 0.5 && t.y - (best.y + best.h) < best.h * 1.6) t.group = 'gal_auto';
        }
      }
    }
  }
  for (const lb of leaves) { // כיתוב שיושב בתוך כפתור: תמיד מצמידים אותו אליו, גם אם ה-AI לא קבץ אותם
    if (lb.role !== 'label') continue;
    const bt = leaves.find(b => b.role === 'button' && !b.text && lb.x + lb.w / 2 > b.x && lb.x + lb.w / 2 < b.x + b.w && lb.y + lb.h / 2 > b.y && lb.y + lb.h / 2 < b.y + b.h);
    if (bt) { const g = bt.group || lb.group || 'btn_' + bt.id; bt.group = g; lb.group = g; }
  }
  const groups = new Map();
  for (const e of leaves) if (e.group) { if (!groups.has(e.group)) groups.set(e.group, []); groups.get(e.group).push(e); }
  const units = [];
  for (const e of leaves) if (!e.group || groups.get(e.group).length < 2) units.push({ role: e.role, kids: [e], x: e.x, y: e.y, w: e.w, h: e.h, lines: e.lines });
  for (const [, ks0] of groups) {
    if (ks0.length < 2) continue;
    const ks = ks0.slice().sort((a, b) => a.z - b.z);
    const x1 = Math.min(...ks.map(k => k.x)), y1 = Math.min(...ks.map(k => k.y));
    const x2 = Math.max(...ks.map(k => k.x + k.w)), y2 = Math.max(...ks.map(k => k.y + k.h));
    units.push({ role: 'unit', kids: ks, x: x1, y: y1, w: x2 - x1, h: y2 - y1, lines: ks.flatMap(k => k.lines) });
  }
  // מרכוז: טקסטים שכמעט במרכז היחידה מיושרים בדיוק למרכז שלה (תיבות ה-AI אינן מדויקות לפיקסל)
  for (const u of units) {
    if (u.kids.length < 2) continue;
    const ucx = u.x + u.w / 2;
    for (const k of u.kids) { if (!k.text) continue; const d = ucx - (k.x + k.w / 2); if (Math.abs(d) < 0.05 * u.w) k.x += d; }
  }
  // גלריה: שורת תמונות עם כיתובים (כרטיסים) שאפשר לסדר מחדש בשורות, כדי שיהיו גדולות יותר בבאנר צר וגבוה
  for (const u of units) { const c = u.role === 'unit' ? makeCards(u) : null; if (c) u.cards = c; }
  for (const u of units) {
    u.pin = null;
    if (u.role === 'hero' || u.w < W * 0.85) continue;
    if (u.y + u.h >= H * 0.9) u.pin = 'bottom'; else if (u.y + u.h <= H * 0.12) u.pin = 'top';
  }
  const holeRows = new Float32Array(H);
  for (let y = 0; y < H; y++) { let c = 0; for (let x = 0; x < W; x++) c += holes2[y * W + x]; holeRows[y] = c / W; }
  return { W, H, plate, units, leaves, holeRows, boxes: leaves.map(e => ({ id: e.id, role: e.role, x: e.x / W, y: e.y / H, w: e.w / W, h: e.h / H })) };
}

// ---------------------------------------------------------------- גלריה
function makeCards(u) {
  const photos = u.kids.filter(k => !k.text && k.role === 'photo');
  if (photos.length < 3) return null;
  const cards = photos.map(p => ({ kids: [p] }));
  for (const t of u.kids) {
    if (t.text) {
      const cx = t.x + t.w / 2; let best = null, bd = 1e9;
      for (const c of cards) { const p = c.kids[0], d = Math.abs(cx - (p.x + p.w / 2)); if (d < bd) { bd = d; best = c; } }
      if (!best || bd > best.kids[0].w * 1.3 || t.y < best.kids[0].y) return null;
      best.kids.push(t);
    } else if (t.role !== 'photo') return null;
  }
  for (const c of cards) { const p = c.kids[0], pc = p.x + p.w / 2; for (const t of c.kids) if (t.text) { const d = pc - (t.x + t.w / 2); if (Math.abs(d) < 0.7 * p.w) t.x += d; const g = t.y - (p.y + p.h), tg = p.h * 0.14; if (g > tg) t.y -= g - tg; } }
  for (const c of cards) {
    c.x = Math.min(...c.kids.map(k => k.x)); c.y = Math.min(...c.kids.map(k => k.y));
    c.w = Math.max(...c.kids.map(k => k.x + k.w)) - c.x; c.h = Math.max(...c.kids.map(k => k.y + k.h)) - c.y;
  }
  const ys = cards.map(c => c.y), hs = cards.map(c => c.h);
  if (Math.max(...ys) - Math.min(...ys) > 0.5 * Math.max(...hs)) return null; // לא שורה אחת
  return cards;
}
// מסדר את הכרטיסים ברשת עם cols עמודות. סדר הקריאה: מימין לשמאל בעברית.
function arrange(u, cols, rtl) {
  const cards = u.cards.slice().sort((a, b) => rtl ? (b.x + b.w / 2) - (a.x + a.w / 2) : (a.x + a.w / 2) - (b.x + b.w / 2));
  const n = cards.length, rows = Math.ceil(n / cols);
  const cw = Math.max(...cards.map(c => c.w)), ch = Math.max(...cards.map(c => c.h)), gx = cw * 0.22, gy = ch * 0.2;
  const W = cols * cw + (cols - 1) * gx, H = rows * ch + (rows - 1) * gy, rel = new Map();
  cards.forEach((c, i) => {
    const r = Math.floor(i / cols), inRow = Math.min(cols, n - r * cols), idx = i % cols;
    const rowW = inRow * cw + (inRow - 1) * gx, off = (W - rowW) / 2;
    const col = rtl ? inRow - 1 - idx : idx; // בעברית העמודה הראשונה בצד ימין
    const cx = off + col * (cw + gx) + (cw - c.w) / 2, cy = r * (ch + gy);
    for (const k of c.kids) rel.set(k, [cx + (k.x - c.x), cy + (k.y - c.y)]);
  });
  return { ...u, w: W, h: H, rel, cols, boost: 1 };
}

// ---------------------------------------------------------------- פריסה
function splits(n, k) {
  const res = [];
  (function rec(s, left, acc) {
    if (s === n) { res.push(acc); return; }
    if (!left) return;
    for (let e = s + 1; e <= n; e++) rec(e, left - 1, acc.concat([Array.from({ length: e - s }, (_, i) => s + i)]));
  })(0, k, []);
  return res;
}
function layout(W, H, units, sw, sh, forceWide) {
  const out = [];
  const heroes = units.filter(u => u.role === 'hero');
  const hero = heroes.length ? heroes.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a)) : null;
  const wideMode = forceWide || W / H >= 1.6;
  let tx = units.filter(u => u !== hero && u.role !== 'hero').sort(wideMode ? ((a, b) => rankOf(a, sh, true) - rankOf(b, sh, true) || a.y - b.y) : ((a, b) => a.y - b.y));
  if (wideMode && tx.length > 2) { // בבאנר רחב וצר מאוד: מוותרים על מה שהיה נהיה קטן מדי לקריאה (הערות שוליים, כיתובים), ומשאירים כותרת, כפתור ולוגו
    const m0 = Math.max(5, H * 0.05), heroW = hero ? hero.w * Math.min((H - m0) / hero.h, W * 0.32 / hero.w, 1.2) + m0 : 0;
    const essential = u => u.kids.some(k => ['headline', 'button', 'logo', 'brand'].includes(k.role));
    const minTextH = u => { const hs = u.kids.filter(k => k.text).map(k => k.h / Math.max(1, (k.lines || []).length || 1)); return hs.length ? Math.min(...hs) : Infinity; };
    const solveS = list => {
      let best = 0;
      for (const sp of splits(Math.min(list.length, 9), W / H >= 5 ? 9 : 4)) {
        const cols = sp.map(g => ({ w: Math.max(...g.map(i => list[i].w)), h: g.reduce((a, i) => a + list[i].h, 0) }));
        const sv = Math.min((W - 3 * m0 - heroW - (cols.length - 1) * m0 * 1.6) / cols.reduce((a, c) => a + c.w, 0), ...cols.map(c => (H - 2 * m0) / c.h), 1.15);
        if (sv > best) best = sv;
      }
      return best;
    };
    for (let it = 0; it < 6 && tx.length > 2; it++) {
      const sv = solveS(tx), bad = tx.filter(u => !essential(u) && minTextH(u) * sv < 5.5).sort((a, b) => minTextH(a) - minTextH(b));
      if (!bad.length) break;
      tx = tx.filter(u => u !== bad[0]);
    }
  }
  let n = tx.length; if (n > 14) { tx = tx.slice(0, 14); n = 14; }
  const gp = tx.map((t, i) => i >= n - 1 ? 0 : Math.min(Math.max(0, tx[i + 1].y - (t.y + t.h)), sh * 0.1));
  const gh = g => g.reduce((s, i) => s + tx[i].h, 0) + g.slice(0, -1).reduce((s, i) => s + gp[i], 0);
  const rtl = units.some(u => HEB.test(u.lines.join('')));
  let gm = 1;
  const put = (g, s, x0, slot, y) => { for (const i of g) { const it = tx[i], b = it.boost || 1, w = it.w * s * b, h = it.h * s * b; out.push([it, x0 + (slot - w) / 2, y, w, h]); y += h + gp[i] * s * gm; } };
  if (wideMode) {
    const m = Math.max(5, H * 0.05);
    let ax0 = m * 1.5, ax1 = W - m * 1.5;
    if (hero) {
      const right = hero.x + hero.w / 2 > sw / 2;
      const s = Math.min((H - m) / hero.h, W * 0.32 / hero.w, 1.2), hw = hero.w * s, hh = hero.h * s;
      const hx = right ? W - hw - m * 0.3 : m * 0.3;
      out.push([hero, hx, (H - hh) / 2, hw, hh]);
      if (right) ax1 = hx - m; else ax0 = hx + hw + m;
    }
    const aw = ax1 - ax0, cg = Math.max(m * 1.6, H * 0.1);
    let best = null;
    if (n) for (const sp of splits(n, W / H >= 5 ? n : 4)) {
      const cols = sp.map(g => ({ g, w: Math.max(...g.map(i => tx[i].w)), h: gh(g) }));
      const s = Math.min((aw - (cols.length - 1) * cg) / cols.reduce((a, c) => a + c.w, 0), ...cols.map(c => (H - 2 * m) / c.h), 1.15);
      const score = s * (1 - 0.03 * cols.length);
      if (!best || score > best.score) best = { cols, s, score };
    }
    if (best) {
      const { cols, s } = best, k = cols.length, ss = new Array(k).fill(s);
      const tw = () => ss.reduce((a, v, i) => a + v * cols[i].w, 0) + (k - 1) * cg;
      for (let it = 0; it < 400; it++) {
        let bi = -1, bf = 0.97;
        cols.forEach((c, i) => { const f = ss[i] * c.h / (H - 2 * m); if (f < bf && ss[i] < s * 1.6) { bf = f; bi = i; } });
        if (bi < 0) break;
        const o = ss[bi]; ss[bi] *= 1.03; if (tw() > aw) { ss[bi] = o; break; }
      }
      const extra = (aw - tw()) / k;
      let cur = rtl ? ax1 : ax0;
      cols.forEach((c, i) => {
        const slot = ss[i] * c.w + extra, x0 = rtl ? cur - slot : cur;
        put(c.g, ss[i], x0, slot, (H - ss[i] * c.h) / 2);
        cur = rtl ? cur - slot - cg : cur + slot + cg;
      });
    }
  } else {
    const m = Math.min(W, H) * 0.05, vg = H * 0.03, aw = W - 2 * m, allg = tx.map((_, i) => i);
    const eff = u => u.boost || 1;
    const plan = () => {
      const mw = tx.length ? Math.max(...tx.map(u => u.w)) : 1, tH = n ? gh(allg) : 1;
      let best = null;
      for (const fr of (hero ? [0.42, 0.34, 0.26] : [0])) {
        const hs = hero ? Math.min(fr * H / hero.h, aw / hero.w, 1.2) : 0, hh = hero ? hero.h * hs : 0;
        const th = H - 2 * m - hh - (hero ? vg * 2 : 0), s = Math.min(aw / mw, th / tH, 1.15);
        const score = hero ? Math.min(s, hs) : s;
        if (!best || score > best[0]) best = [score, hs, hh, s, th];
      }
      return best;
    };
    // גלריות: בוחרים כמה עמודות ואיזו הגדלה נותנות תמונות גדולות ככל האפשר בלי לחרוג מהבאנר
    for (const gi of tx.map((u, i) => (u.cards ? i : -1)).filter(i => i >= 0)) {
      const orig = tx[gi], total = orig.cards.length;
      let pick = null;
      for (const cols of [...new Set([total, Math.ceil(total / 2), 2])].filter(c => c >= 1 && c <= total)) {
        tx[gi] = arrange(orig, cols, rtl);
        const [, , , s, th] = plan(), u2 = tx[gi];
        const left = th - s * gh(allg);
        const b = Math.max(1, Math.min(1.6, aw / (u2.w * s), 1 + 0.85 * left / (u2.h * s), 1.5 / s));
        const score = s * b;
        if (!pick || score > pick.score * 1.04) pick = { u2, b, score };
      }
      tx[gi] = pick.u2; tx[gi].boost = pick.b;
    }
    const [, hs, hh, s, th] = plan();
    const tg = gp.slice(0, -1).reduce((a, b) => a + b, 0);
    const tHb = tx.reduce((a, u) => a + u.h * eff(u), 0) + tg;
    let used = s * tHb;
    if (tg > 0) { gm = Math.max(1, Math.min(2.2, 1 + (th - used) / (tg * s))); used = s * (tHb - tg) + s * tg * gm; }
    const bottom = !hero || (hero.y + hero.h / 2) / sh > 0.35;
    const y0 = bottom ? m + (th - used) / 2 : m + hh + vg * 2 + (th - used) / 2;
    put(allg, s, 0, W, y0);
    if (hero) out.push([hero, (W - hero.w * hs) / 2, bottom ? H - m - hh : m, hero.w * hs, hh]);
  }
  return out;
}
// פריסה לבאנר צר וגבוה: כל יחידה מתאימה את עצמה לרוחב הבאנר (כותרת הכי גדולה, תמונות קטנות יותר), הסדר מלמעלה:
// כותרת, תמונות, לוגו עם כתובת, ובסוף כפתור. המרווח שנשאר מתחלק בין היחידות כך שהבאנר מתמלא.
const finePrint = (u, sh) => u.kids.every(k => k.text && ['caption', 'body', 'label'].includes(k.role)) && u.h < 0.06 * sh && u.y + u.h / 2 > 0.88 * sh;
// סדר קריאה של יחידות: כותרת, תמונות, שאר התוכן, כפתור ולוגו. בבאנר רחב הלוגו והכפתור בקצה האחרון, בגבוה לוגו עליון נשאר למעלה.
function rankOf(u, sh, wide) {
  const r = u.kids.map(k => k.role);
  if (finePrint(u, sh)) return 9;
  if ((r.includes('logo') || r.includes('brand')) && !r.includes('headline')) { if (wide) return 5; if (u.y + u.h / 2 < 0.22 * sh) return -1; }
  if (r.includes('headline')) return 0;
  if (r.includes('button')) return 3;
  if (r.includes('logo') || r.includes('badge') || r.includes('brand')) return wide ? 5 : 2;
  if (u.cards || r.includes('photo')) return 1;
  return 1.5;
}
function layoutTall(W, H, units, sw, sh) {
  const m = Math.min(W, H) * 0.07, aw = W - 2 * m, rtl = units.some(u => HEB.test((u.lines || []).join('')));
  const rank = u => rankOf(u, sh, false);
  const fine = units.filter(u => finePrint(u, sh)), out0 = [];
  let yb = H - m * 0.7;
  for (const u of fine) { const f0 = Math.min(aw / u.w, 1.5), w0 = u.w * f0, h0 = u.h * f0; if (h0 < 5) continue; yb -= h0; out0.push([u, (W - w0) / 2, yb, w0, h0]); yb -= m * 0.5; }
  // שורת תחתית: לוגו ליד כפתור, כמו שמעצבים עושים בבאנר גבוה
  let foot = null;
  { const lg = units.find(u => u.kids.some(k => k.role === 'logo') && !u.cards && !fine.includes(u) && rankOf(u, sh, false) >= 0), bt = units.find(u => u.role === 'button');
    if (lg && bt && lg !== bt && H / W > 1.3) {
      const gx = m * 0.8, fr = Math.min((aw - gx) / (lg.w + bt.w), 0.2 * H / Math.max(lg.h, bt.h), 2);
      if (fr * Math.min(lg.w, bt.w) > 0.12 * W) {
        const rh = Math.max(lg.h, bt.h) * fr, rw = (lg.w + bt.w) * fr + gx, x0 = (W - rw) / 2, ordL = lg.x <= bt.x;
        const a = ordL ? lg : bt, b = ordL ? bt : lg; yb -= rh;
        out0.push([a, x0, yb + (rh - a.h * fr) / 2, a.w * fr, a.h * fr], [b, x0 + a.w * fr + gx, yb + (rh - b.h * fr) / 2, b.w * fr, b.h * fr]);
        foot = [lg, bt]; yb -= m * 0.8;
      }
    } }
  const ah = yb - m;
  let list = units.filter(u => u.role !== 'hero' && !fine.includes(u) && !(foot && foot.includes(u))).sort((p, q) => rank(p) - rank(q) || p.y - q.y).slice(0, 14);
  list = list.map(u => {
    if (!u.cards) return { u, cap: rank(u) === 0 ? 3.2 : 2.2 };
    let pick = null; const total = u.cards.length;
    for (const cols of [...new Set([total, Math.ceil(total / 2), 2, 1])].filter(c => c >= 1 && c <= total)) {
      const a = arrange(u, cols, rtl), f = Math.min(aw / a.w, 1.8, (0.34 * H) / a.h);
      const dia = f * Math.min(...u.cards.map(c => c.kids[0].w)); // קוטר העיגול הקטן ביותר אחרי ההגדלה
      if (cols === total && total >= 3 && dia >= 0.17 * W) { pick = { a, f }; break; } // שורה אחת, כמו שמעצבים עושים - רק אם העיגולים נשארים גדולים וקריאים
      if (!pick || f > pick.f * 1.04) pick = { a, f };
    }
    return { u: pick.a, cap: Math.min(2.0, pick.f) };
  });
  let f = list.map(({ u, cap }) => { const lg = u.kids.some(k => k.role === 'logo') && u.kids.length === 1 && u.w / u.h > 2.2; return Math.min(aw / u.w, cap, lg ? 0.6 * W / u.w : u.kids.some(k => k.role === 'logo') ? Math.min(0.5 * W / u.w, 0.22 * H / u.h) : 9); });
  const gmin = Math.max(5, H * 0.025), nGap = Math.max(0, list.length - 1);
  const tot = () => list.reduce((a, { u }, i) => a + u.h * f[i], 0);
  if (tot() + gmin * nGap > ah) { // חוסר מקום: מכווצים הכול, אבל תמונות קטנות מתכווצות פחות כדי שלא ייעלמו
    const f0 = f.slice(), small = list.map(({ u }) => !!u.cards);
    let lo = 0.05, hi = 1;
    for (let it = 0; it < 30; it++) { const g = (lo + hi) / 2; f = f0.map((v, i) => v * (small[i] ? Math.pow(g, 0.6) : g)); if (tot() + gmin * nGap > ah) hi = g; else lo = g; }
    f = f0.map((v, i) => v * (small[i] ? Math.pow(lo, 0.6) : lo));
  }
  const gap = nGap ? Math.min(H * (W / H < 0.5 ? 0.14 : 0.09), (ah - tot()) / nGap) : 0, used = tot() + gap * nGap;
  let y = m + Math.max(0, (ah - used) / 2);
  const out = out0;
  list.forEach(({ u }, i) => { const w = u.w * f[i], h = u.h * f[i]; out.push([u, (W - w) / 2, y, w, h]); y += h + gap; });
  return out;
}
// ---- תכנון של AI: לכל יחידה ה-AI קובע תיבה (x,y,w,h בפיקסלים של הגודל החדש) והמנוע מסדר בתוכה
function describeUnits(sc) {
  return sc.units.map((u, i) => ({ id: 'u' + i, role: u.role, lines: (u.lines || []).filter(Boolean), kind: u.cards ? 'gallery of ' + u.cards.length + ' photos with captions' : u.kids.length > 1 ? 'group' : u.kids[0].role, x: Math.round(u.x), y: Math.round(u.y), w: Math.round(u.w), h: Math.round(u.h) }));
}
function placeInBox(u, box, W, H) {
  const [bx, by, bw, bh] = box, rtl = (u.lines || []).some(l => HEB.test(l));
  let v = u;
  if (u.cards) {
    let best = null; const total = u.cards.length;
    for (const cols of [...new Set([total, Math.ceil(total / 2), 2, 1])].filter(c => c >= 1 && c <= total)) { const a = arrange(u, cols, rtl), f = Math.min(bw / a.w, bh / a.h); if (!best || f > best.f * 1.04) best = { a, f }; }
    v = best.a;
  } else v = reflowUnit(u, W, H, box);
  const f = Math.min(bw / v.w, bh / v.h, v.role === 'hero' ? 9 : 2.6), w = v.w * f, h = v.h * f;
  return [v, bx + (bw - w) / 2, by + (bh - h) / 2, w, h];
}
function planValid(plan, sc, W, H) {
  if (!plan || !Array.isArray(plan.units)) return false;
  const boxes = [];
  for (const p of plan.units) {
    const i = parseInt(String(p.id).replace(/^u/, ''), 10), u = sc.units[i];
    if (!u || ![p.x, p.y, p.w, p.h].every(Number.isFinite) || p.w < 4 || p.h < 4) return false;
    boxes.push([p.x, p.y, p.w, p.h]);
  }
  if (!boxes.length) return false;
  for (const b of boxes) if (b[0] < -2 || b[1] < -2 || b[0] + b[2] > W + 2 || b[1] + b[3] > H + 2) return false;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j], ix = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]), iy = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]);
    if (ix > 0 && iy > 0 && ix * iy > 0.12 * Math.min(a[2] * a[3], b[2] * b[3])) return false;
  }
  return true;
}
function autoplaceRules(sc, W, H) {
  const pl = [];
  const add = (u, x, y, w, h) => { const s = w / u.w; for (const k of u.kids) { const [dx, dy] = u.rel ? u.rel.get(k) : [k.x - u.x, k.y - u.y]; pl.push([k, x + dx * s, y + dy * s, k.w * s, k.h * s]); } };
  const units = sc.units.map(u => reflowUnit(u, W, H));
  const noHero = !units.some(u => u.role === 'hero'), asp = W / H;
  let useTall = noHero && asp < 0.9, mid = null;
  if (noHero && asp >= 0.9 && asp < 1.8) { // יחס בינוני: מנסים גם סידור לגובה וגם לרוחב, ובוחרים את זה שממלא יותר מהבאנר
    const cover = o => o.reduce((a, e) => a + e[3] * e[4], 0);
    const t = layoutTall(W, H, units, sc.W, sc.H), w2 = layout(W, H, units.filter(u => !u.pin || true), sc.W, sc.H, true);
    useTall = cover(t) >= cover(w2); mid = useTall ? t : w2;
  }
  if (mid && !useTall) { for (const [u, x, y, w, h] of mid) add(u, x, y, w, h); pl.sort((a, b) => (a[0].isPlate ? 0 : 1) - (b[0].isPlate ? 0 : 1) || a[0].z - b[0].z); return pl; }
  if (useTall) {
    for (const [u, x, y, w, h] of (mid || layoutTall(W, H, units, sc.W, sc.H))) add(u, x, y, w, h);
    pl.sort((a, b) => (a[0].isPlate ? 0 : 1) - (b[0].isPlate ? 0 : 1) || a[0].z - b[0].z);
    return pl;
  }
  const pins = [], rest = [], mg = Math.min(W, H) * 0.06;
  for (const u of units) { if (u.pin) { const k = Math.min((W - 2 * mg) / u.w, 1.4); pins.push([u, k, u.h * k, u.w * k]); } else rest.push(u); }
  const hasTop = pins.some(p => p[0].pin === 'top'), hasBot = pins.some(p => p[0].pin === 'bottom');
  const topH = pins.filter(p => p[0].pin === 'top').reduce((a, p) => a + p[2], 0) + (hasTop ? mg : 0);
  const botH = pins.filter(p => p[0].pin === 'bottom').reduce((a, p) => a + p[2], 0) + (hasBot ? mg : 0);
  const avail = Math.max(20, H - topH - botH);
  for (const [u, x, y0, w, h] of layout(W, avail, rest, sc.W, sc.H)) add(u, x, Math.max(0, Math.min(avail - h, y0)) + topH, w, h);
  let yt = mg, yb = H - mg;
  for (const [u, , h, w] of pins) { let y; if (u.pin === 'top') { y = yt; yt += h; } else { y = yb - h; yb -= h; } add(u, (W - w) / 2, y, w, h); }
  pl.sort((a, b) => (a[0].role === 'hero' ? 0 : 1) - (b[0].role === 'hero' ? 0 : 1) || (a[0].isPlate ? 0 : 1) - (b[0].isPlate ? 0 : 1) || a[0].z - b[0].z);
  return pl;
}

function planned(sc, W, H, plan) {
  const pl = [];
  const add = (u, x, y, w, h) => { const s = w / u.w; for (const k of u.kids) { const [dx, dy] = u.rel ? u.rel.get(k) : [k.x - u.x, k.y - u.y]; pl.push([k, x + dx * s, y + dy * s, k.w * s, k.h * s]); } };
  for (const p of plan.units) {
    const u = sc.units[parseInt(String(p.id).replace(/^u/, ''), 10)];
    const [v, x, y, w, h] = placeInBox(u, [p.x, p.y, p.w, p.h], W, H); add(v, x, y, w, h);
  }
  pl.sort((a, b) => (a[0].role === 'hero' ? 0 : 1) - (b[0].role === 'hero' ? 0 : 1) || (a[0].isPlate ? 0 : 1) - (b[0].isPlate ? 0 : 1) || a[0].z - b[0].z);
  return pl;
}
// בודקים את תכנית ה-AI מול הכללים: אם משהו חשוב התכווץ או נעלם, או שהכול נדחס לפינה, לא משתמשים בה.
function planOk(pp, base, W, H) {
  const area = l => l.filter(e => !e[0].isPlate && e[0].role !== 'hero').reduce((a, e) => a + e[3] * e[4], 0);
  if (area(pp) < 0.75 * area(base)) return false;
  const bm = new Map(base.map(e => [e[0].id, e]));
  for (const e of pp) {
    const b = bm.get(e[0].id); if (!b || e[0].isPlate) continue;
    if (['headline', 'subheadline', 'button', 'logo'].includes(e[0].role) && e[4] < 0.6 * b[4] && e[3] < 0.6 * b[3]) return false;
  }
  const have = new Set(pp.map(e => e[0].id));
  if (base.filter(e => e[0].role === 'headline').some(e => !have.has(e[0].id))) return false;
  const x0 = Math.min(...pp.map(e => e[1])), x1 = Math.max(...pp.map(e => e[1] + e[3])), y0 = Math.min(...pp.map(e => e[2])), y1 = Math.max(...pp.map(e => e[2] + e[4]));
  if ((x1 - x0) < 0.5 * W && (y1 - y0) < 0.5 * H) return false; // כל התוכן בפינה קטנה
  if (H / W > 1.3 && (x1 - x0) < 0.6 * W) return false;       // באנר גבוה: התוכן צריך למלא את הרוחב
  if (W / H > 1.3 && (y1 - y0) < 0.45 * H) return false;      // באנר רחב: התוכן צריך למלא את הגובה
  return true;
}
function autoplace(sc, W, H, plan) {
  const base = autoplaceRules(sc, W, H);
  if (!plan || !planValid(plan, sc, W, H)) return base;
  const pp = planned(sc, W, H, plan);
  return planOk(pp, base, W, H) ? pp : base;
}

// ---------------------------------------------------------------- רינדור
// מחזיר { w, h, rgba: Uint8ClampedArray }
function render(sc, W, H, K, plan) {
  K = K || 1;
  const Wk = Math.floor(W * K), Hk = Math.floor(H * K);
  const s = Math.max(Wk / sc.W, Hk / sc.H);
  let nw = Math.max(Wk, Math.round(sc.W * s)), nh = Math.max(Hk, Math.round(sc.H * s));
  const xs = G.SizyBg ? G.SizyBg.map(sc.W, sc.H, Wk, Hk) : null;
  let bg, ox, oy;
  if (xs) {
    const tall = resize(sc.plate, sc.W, Hk, Hk < sc.H ? 'area' : 'cubic'); bg = { w: Wk, h: Hk, c: 3, d: new Float32Array(Wk * Hk * 3) }; ox = 0; oy = 0; nw = Wk; nh = Hk;
    for (let u = 0; u < Wk; u++) {
      const a = xs[u], b = Math.max(xs[u + 1], a + 0.001), i0 = Math.floor(a), i1 = Math.min(sc.W, Math.ceil(b));
      for (let y = 0; y < Hk; y++) {
        let r = 0, g = 0, bl = 0, ws = 0;
        for (let i = i0; i < i1; i++) { const w = Math.min(b, i + 1) - Math.max(a, i); if (w <= 0) continue; const o = (y * sc.W + i) * 3; r += tall.d[o] * w; g += tall.d[o + 1] * w; bl += tall.d[o + 2] * w; ws += w; }
        const o2 = (y * Wk + u) * 3; ws = ws || 1; bg.d[o2] = r / ws; bg.d[o2 + 1] = g / ws; bg.d[o2 + 2] = bl / ws;
      }
    }
  } else {
    bg = resize(sc.plate, nw, nh, s < 1 ? 'area' : 'cubic'); ox = Math.floor((nw - Wk) / 2); oy = Math.floor((nh - Hk) / 2);
    if (G.SizyBg && nh > Hk + 2) { // חיתוך אנכי: שומרים את החלק העשיר בפרטים
      if (!sc.energy) sc.energy = G.SizyBg.rowEnergy(sc.plate.d, 3, sc.W, sc.H);
      oy = Math.max(0, Math.min(nh - Hk, Math.round(G.SizyBg.pickTop(sc.energy, sc.H, Hk / s, sc.holeRows) * s)));
    }
  }
  const out = new Float32Array(Wk * Hk * 3);
  for (let y = 0; y < Hk; y++) out.set(bg.d.subarray(((y + oy) * nw + ox) * 3, ((y + oy) * nw + ox + Wk) * 3), y * Wk * 3);
  for (const [leaf, x, y, w, h] of autoplace(sc, W, H, plan)) {
    if (w < 1 || h < 1) continue;
    const L = leaf.layer, n = L.lw * L.lh;
    const pm = { w: L.lw, h: L.lh, c: 4, d: new Float32Array(n * 4) };
    for (let i = 0; i < n; i++) { const a = L.up === 1 ? L.a[i] : L.a[i]; pm.d[i * 4] = L.rgb[i * 3] * a; pm.d[i * 4 + 1] = L.rgb[i * 3 + 1] * a; pm.d[i * 4 + 2] = L.rgb[i * 3 + 2] * a; pm.d[i * 4 + 3] = a; }
    const tw = Math.max(1, Math.round(w * K)), th = Math.max(1, Math.round(h * K));
    const r = resize(pm, tw, th, tw < pm.w ? 'area' : 'lanczos');
    const x0 = Math.round(x * K), y0 = Math.round(y * K);
    const xa = Math.max(0, x0), ya = Math.max(0, y0), xb = Math.min(Wk, x0 + tw), yb = Math.min(Hk, y0 + th);
    for (let yy = ya; yy < yb; yy++) for (let xx = xa; xx < xb; xx++) {
      const si = ((yy - y0) * tw + (xx - x0)) * 4, di = (yy * Wk + xx) * 3, al = clp(r.d[si + 3], 0, 1);
      out[di] = out[di] * (1 - al) + r.d[si]; out[di + 1] = out[di + 1] * (1 - al) + r.d[si + 1]; out[di + 2] = out[di + 2] * (1 - al) + r.d[si + 2];
    }
  }
  const rgba = new Uint8ClampedArray(Wk * Hk * 4);
  for (let i = 0; i < Wk * Hk; i++) { rgba[i * 4] = out[i * 3]; rgba[i * 4 + 1] = out[i * 3 + 1]; rgba[i * 4 + 2] = out[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
  return { w: Wk, h: Hk, rgba };
}

// קלט: Uint8ClampedArray RGBA → תמונת RGB צפה
function fromRGBA(rgba, w, h) {
  const d = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) { d[i * 3] = rgba[i * 4]; d[i * 3 + 1] = rgba[i * 4 + 1]; d[i * 3 + 2] = rgba[i * 4 + 2]; }
  return { w, h, c: 3, d };
}



// נתוני הסצנה לעורך: הרקע, כל שכבה כ-RGBA, וצבע הטקסט המשוער
// כפתור עם מסגרת: מזהים את המסגרת (צבע, עובי, פינות), מוחקים אותה מהפיקסלים ומחזירים את נתוניה כדי לצייר אותה כקו חד
function extractFrame(L, rgba) {
  const w = L.lw, h = L.lh, a = L.a;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (a[j * w + i] > 0.5) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
  if (x1 - x0 < 20 || y1 - y0 < 12) return null;
  const my = (y0 + y1) >> 1, mx = (x0 + x1) >> 1;
  let lw = 0; while (x0 + lw <= x1 && a[my * w + x0 + lw] > 0.35) lw++;
  let lt = 0; while (y0 + lt <= y1 && a[(y0 + lt) * w + mx] > 0.35) lt++;
  lw = Math.round((lw + lt) / 2); if (lw < 1 || lw > Math.min(x1 - x0, y1 - y0) * 0.2) return null;
  // המסגרת חייבת להיות טבעת רציפה: בודקים שהאמצע של כל צלע דלוק
  const edge = (i, j) => a[j * w + i] > 0.35;
  if (!(edge(mx, y0) && edge(mx, y1) && edge(x0, my) && edge(x1, my))) return null;
  let r = 0; while (x0 + r < mx && a[y0 * w + x0 + r] < 0.35) r++;
  r = Math.min(r + lw, (y1 - y0 + 1) / 2);
  let cr = 0, cg = 0, cb = 0, n = 0;
  for (let i = x0; i <= x1; i++) for (let k = 0; k < lw; k++) for (const j of [y0 + k, y1 - k]) if (a[j * w + i] > 0.8) { cr += L.rgb[(j * w + i) * 3]; cg += L.rgb[(j * w + i) * 3 + 1]; cb += L.rgb[(j * w + i) * 3 + 2]; n++; }
  if (!n) return null;
  const t = lw + 2;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (i < x0 + t || i > x1 - t || j < y0 + t || j > y1 - t) rgba[(j * w + i) * 4 + 3] = 0;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, lw, r, color: [cr / n, cg / n, cb / n].map(Math.round) };
}
function exportScene(sc) {
  const plate = new Uint8ClampedArray(sc.W * sc.H * 4);
  for (let i = 0; i < sc.W * sc.H; i++) { plate[i * 4] = sc.plate.d[i * 3]; plate[i * 4 + 1] = sc.plate.d[i * 3 + 1]; plate[i * 4 + 2] = sc.plate.d[i * 3 + 2]; plate[i * 4 + 3] = 255; }
  const leaves = sc.leaves.map(e => {
    const L = e.layer, n = L.lw * L.lh, rgba = new Uint8ClampedArray(n * 4);
    let r = 0, g = 0, b = 0, wsum = 0;
    for (let i = 0; i < n; i++) {
      rgba[i * 4] = L.rgb[i * 3]; rgba[i * 4 + 1] = L.rgb[i * 3 + 1]; rgba[i * 4 + 2] = L.rgb[i * 3 + 2]; rgba[i * 4 + 3] = L.a[i] * 255;
      if (L.a[i] > 0.8) { r += L.rgb[i * 3]; g += L.rgb[i * 3 + 1]; b += L.rgb[i * 3 + 2]; wsum++; }
    }
    const frame = e.role === 'button' ? extractFrame(L, rgba) : null;
    return { z: e.z, frame, id: e.id, role: e.role, text: e.text, lines: e.lines, lw: L.lw, lh: L.lh, w: e.w, h: e.h, rgba, color: wsum ? [r / wsum, g / wsum, b / wsum].map(Math.round) : [255, 255, 255] };
  });
  return { W: sc.W, H: sc.H, plate, leaves, holeRows: sc.holeRows };
}
function placements(sc, W, H, plan) {
  return autoplace(sc, W, H, plan).map(([k, x, y, w, h]) => {
    const o = { z: k.z, x, y, w, h };
    if (k.reflowed) { const L = k.layer, n = L.lw * L.lh, rgba = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) { rgba[i * 4] = L.rgb[i * 3]; rgba[i * 4 + 1] = L.rgb[i * 3 + 1]; rgba[i * 4 + 2] = L.rgb[i * 3 + 2]; rgba[i * 4 + 3] = L.a[i] * 255; } o.layer = { lw: L.lw, lh: L.lh, rgba }; }
    return o;
  });
}

G.SizyEngine = { describeUnits, planValid, buildScene, render, fromRGBA, layout, autoplace, exportScene, placements, resize, blur, _t: { wordsOf, reflowLeaf, textLayer, msFill, dilateDisk, medianBg, kmeans2, labelCC, percentile } };
})(globalThis);
