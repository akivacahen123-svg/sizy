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
function resize(src, dw, dh, kind, win) { // win = {x0,y0,w,h}: מחשב רק חלון מתוך התמונה המוקטנת/מוגדלת (בלי לשלם על מה שייחתך)
  const { w: sw, h: sh, c } = src;
  if (!win && sw === dw && sh === dh) return { w: sw, h: sh, c, d: Float32Array.from(src.d) };
  const wx = win ? win.x0 : 0, wy = win ? win.y0 : 0, ow = win ? win.w : dw, oh = win ? win.h : dh;
  const tx = flatten(kernelWeights(sw, dw, kind).slice(wx, wx + ow)), ty = flatten(kernelWeights(sh, dh, kind).slice(wy, wy + oh));
  let r0 = sh, r1 = -1; for (let q = 0; q < ty.idx.length; q++) { if (ty.idx[q] < r0) r0 = ty.idx[q]; if (ty.idx[q] > r1) r1 = ty.idx[q]; }
  const rows = r1 - r0 + 1;
  const sd = src.d, tmp = new Float32Array(ow * rows * c);
  for (let y = 0; y < rows; y++) {
    const ro = (y + r0) * sw * c;
    for (let x = 0; x < ow; x++) {
      const o = (y * ow + x) * c, q0 = tx.off[x], q1 = tx.off[x + 1];
      for (let ch = 0; ch < c; ch++) { let acc = 0; for (let q = q0; q < q1; q++) acc += sd[ro + tx.idx[q] * c + ch] * tx.w[q]; tmp[o + ch] = acc; }
    }
  }
  const out = new Float32Array(ow * oh * c), stride = ow * c;
  for (let y = 0; y < oh; y++) {
    const q0 = ty.off[y], q1 = ty.off[y + 1], base = y * stride;
    for (let x = 0; x < stride; x++) { let acc = 0; for (let q = q0; q < q1; q++) acc += tmp[(ty.idx[q] - r0) * stride + x] * ty.w[q]; out[base + x] = acc; }
  }
  return { w: ow, h: oh, c, d: out };
}

// ---------------------------------------------------------------- resample איכותי (Lanczos3 + הגבלת הילות + חידוד)
// כוונון: כל הערכים ניתנים לדריסה דרך globalThis.__SIZY_TUNE (לבדיקות בלבד)
const TUNE = () => Object.assign({ gamLight: 2.2, gamDark: 1.0, usmPhoto: 1, usmText: 1, upAdapt: 0.7, upAmt: 1.0, esMix: 0.85, esThr: 6, preK: 2.5, gainDn: 0.16, gainCenter: 0.45, photoUp: 'easuibpcas', puLen: 2, puNar: 1, puThr: 400, puIter: 6, puLam: 1, puSharp: 0.5 }, G.__SIZY_TUNE || {});
const S2L = new Float32Array(1024), L2S = new Float32Array(4097);
for (let i = 0; i < 1024; i++) { const v = i / 1023; S2L[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
for (let i = 0; i <= 4096; i++) { const v = i / 4096; L2S[i] = 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); }
const toLin = v => { const t = clp(v, 0, 255) * (1023 / 255), i = Math.min(1022, t | 0); return S2L[i] + (S2L[i + 1] - S2L[i]) * (t - i); };
const fromLin = v => { const t = clp(v, 0, 1) * 4096, i = Math.min(4095, t | 0); return L2S[i] + (L2S[i + 1] - L2S[i]) * (t - i); };
// Lanczos3 עם הגבלה לטווח המינימום/מקסימום של הגרעין החיובי (בלי הילות/צלצולי קצה). בהקטנה גדולה: קודם area עד פי 2 מהיעד (כמו pica)
function resizeLim(src, dw, dh) {
  const T = TUNE(), { w: sw, h: sh } = src;
  let cur = src;
  const pw = sw / dw > T.preK ? Math.round(dw * 2) : sw, ph = sh / dh > T.preK ? Math.round(dh * 2) : sh;
  if (pw !== sw || ph !== sh) cur = resize(src, pw, ph, 'area');
  const c = cur.c, iw = cur.w, ih = cur.h;
  if (iw === dw && ih === dh) return cur;
  const tx = flatten(kernelWeights(iw, dw, 'lanczos')), ty = flatten(kernelWeights(ih, dh, 'lanczos'));
  const sd = cur.d, n1 = dw * ih * c, tmp = new Float32Array(n1), tlo = new Float32Array(n1), thi = new Float32Array(n1);
  for (let y = 0; y < ih; y++) {
    const ro = y * iw * c;
    for (let x = 0; x < dw; x++) {
      const o = (y * dw + x) * c, q0 = tx.off[x], q1 = tx.off[x + 1];
      for (let ch = 0; ch < c; ch++) {
        let acc = 0, lo = 1e30, hi = -1e30;
        for (let q = q0; q < q1; q++) { const v = sd[ro + tx.idx[q] * c + ch], wq = tx.w[q]; acc += v * wq; if (wq > 0) { if (v < lo) lo = v; if (v > hi) hi = v; } }
        tmp[o + ch] = acc; tlo[o + ch] = lo; thi[o + ch] = hi;
      }
    }
  }
  const stride = dw * c;
  const out = new Float32Array(dw * dh * c);
  for (let y = 0; y < dh; y++) {
    const q0 = ty.off[y], q1 = ty.off[y + 1], base = y * stride;
    for (let x = 0; x < stride; x++) {
      let acc = 0, lo = 1e30, hi = -1e30;
      for (let q = q0; q < q1; q++) { const j = ty.idx[q] * stride + x, wq = ty.w[q]; acc += tmp[j] * wq; if (wq > 0) { if (tlo[j] < lo) lo = tlo[j]; if (thi[j] > hi) hi = thi[j]; } }
      out[base + x] = acc < lo ? lo : acc > hi ? hi : acc;
    }
  }
  return { w: dw, h: dh, c, d: out };
}
// unsharp 3×3 עם הגבלת אוברשוט לטווח השכנות (אין הילות). adapt>0: החידוד נחלש באזורים שטוחים (לא מגביר רעש)
function usmLim(img, A, chans, adapt) {
  const { w, h, c } = img, s = img.d, o = Float32Array.from(s);
  if (w < 3 || h < 3) return img;
  for (let y = 0; y < h; y++) {
    const ym = y ? y - 1 : 0, yp = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const xm = x ? x - 1 : 0, xp = x < w - 1 ? x + 1 : w - 1;
      for (const ch of chans) {
        const a = s[(ym * w + xm) * c + ch], b = s[(ym * w + x) * c + ch], cc = s[(ym * w + xp) * c + ch], d = s[(y * w + xm) * c + ch], e = s[(y * w + x) * c + ch], f = s[(y * w + xp) * c + ch], g = s[(yp * w + xm) * c + ch], hh = s[(yp * w + x) * c + ch], ii = s[(yp * w + xp) * c + ch];
        const bl = (a + cc + g + ii + 2 * (b + d + f + hh) + 4 * e) / 16;
        let lo = a, hi = a; if (b < lo) lo = b; else if (b > hi) hi = b; if (cc < lo) lo = cc; else if (cc > hi) hi = cc; if (d < lo) lo = d; else if (d > hi) hi = d; if (e < lo) lo = e; else if (e > hi) hi = e; if (f < lo) lo = f; else if (f > hi) hi = f; if (g < lo) lo = g; else if (g > hi) hi = g; if (hh < lo) lo = hh; else if (hh > hi) hi = hh; if (ii < lo) lo = ii; else if (ii > hi) hi = ii;
        let k = A; if (adapt) { const r = (hi - lo) * adapt; k = A * r / (r + 1); }
        const v = e + k * (e - bl);
        o[(y * w + x) * c + ch] = v < lo ? lo : v > hi ? hi : v;
      }
    }
  }
  return { w, h, c, d: o };
}
// כמו usmLim אבל על בהירות בלבד (פי 3 פחות עבודה): ה-delta של הבהירות מתווסף לכל הערוצים. img: c=3 או c=4 (ערוצים 0..2)
function usmLum(img, A, adapt) {
  const { w, h, c } = img, s = img.d, o = Float32Array.from(s);
  if (w < 3 || h < 3) return img;
  const N = w * h, Y = new Float32Array(N), hb = new Float32Array(N), hlo = new Float32Array(N), hhi = new Float32Array(N);
  for (let i = 0, j = 0; i < N; i++, j += c) Y[i] = 0.299 * s[j] + 0.587 * s[j + 1] + 0.114 * s[j + 2];
  for (let y = 0; y < h; y++) {
    const r0 = y * w;
    for (let x = 0; x < w; x++) {
      const m = Y[r0 + (x ? x - 1 : 0)], e = Y[r0 + x], p = Y[r0 + (x < w - 1 ? x + 1 : w - 1)];
      hb[r0 + x] = m + 2 * e + p;
      let lo = m, hi = m; if (e < lo) lo = e; else if (e > hi) hi = e; if (p < lo) lo = p; else if (p > hi) hi = p;
      hlo[r0 + x] = lo; hhi[r0 + x] = hi;
    }
  }
  for (let y = 0; y < h; y++) {
    const rm = (y ? y - 1 : 0) * w, r0 = y * w, rp = (y < h - 1 ? y + 1 : h - 1) * w;
    for (let x = 0; x < w; x++) {
      const i = r0 + x, e = Y[i], bl = (hb[rm + x] + 2 * hb[i] + hb[rp + x]) / 16;
      let lo = hlo[rm + x], hi = hhi[rm + x]; const l1 = hlo[i], h1 = hhi[i], l2 = hlo[rp + x], h2 = hhi[rp + x];
      if (l1 < lo) lo = l1; if (l2 < lo) lo = l2; if (h1 > hi) hi = h1; if (h2 > hi) hi = h2;
      let k = A; if (adapt) { const r = (hi - lo) * adapt; k = A * r / (r + 1); }
      let v = e + k * (e - bl); v = v < lo ? lo : v > hi ? hi : v;
      const dl = v - e;
      if (dl > 0.01 || dl < -0.01) { const q = i * c; o[q] = s[q] + dl; o[q + 1] = s[q + 1] + dl; o[q + 2] = s[q + 2] + dl; }
    }
  }
  return { w, h, c, d: o };
}
// החלקה מכוונת-קצה להגדלה (זול, בלי מודלים): מחליקים לאורך כיוון הקצה (ניצב לגרדיאנט) – מוחקת מדרגות/פיקסלציה – והחידוד שאחריה משפר את חדות הקצה עצמו.
// dist = מרחק הדגימה לאורך הקצה בפיקסלי פלט (≈ מקדם ההגדלה), mix = עוצמה, thr = סף חוזק קצה
function edgeSmooth(img, dist, mix, thr) {
  const { w, h, c } = img, s = img.d, N = w * h;
  if (w < 4 || h < 4) return img;
  const Y = new Float32Array(N); for (let i = 0, j = 0; i < N; i++, j += c) Y[i] = 0.299 * s[j] + 0.587 * s[j + 1] + 0.114 * s[j + 2];
  const o = Float32Array.from(s), W1 = w - 1, H1 = h - 1;
  const samp = (px, py, ch) => {
    px = px < 0 ? 0 : px > W1 ? W1 : px; py = py < 0 ? 0 : py > H1 ? H1 : py;
    const x0 = px | 0, y0 = py | 0, x1 = x0 < W1 ? x0 + 1 : x0, y1 = y0 < H1 ? y0 + 1 : y0, fx = px - x0, fy = py - y0;
    const a = s[(y0 * w + x0) * c + ch], b = s[(y0 * w + x1) * c + ch], d = s[(y1 * w + x0) * c + ch], e = s[(y1 * w + x1) * c + ch];
    return (a + (b - a) * fx) * (1 - fy) + (d + (e - d) * fx) * fy;
  };
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = (Y[i - w + 1] + 2 * Y[i + 1] + Y[i + w + 1]) - (Y[i - w - 1] + 2 * Y[i - 1] + Y[i + w - 1]);
    const gy = (Y[i + w - 1] + 2 * Y[i + w] + Y[i + w + 1]) - (Y[i - w - 1] + 2 * Y[i - w] + Y[i - w + 1]);
    const g = Math.sqrt(gx * gx + gy * gy) / 8;
    if (g < thr * 0.5) continue;
    const wgt = mix * g / (g + thr), tx = -gy / (g * 8), ty = gx / (g * 8);
    for (let ch = 0; ch < 3; ch++) {
      const a = samp(x + tx * dist, y + ty * dist, ch), b = samp(x - tx * dist, y - ty * dist, ch), v = s[i * c + ch];
      o[i * c + ch] = v + wgt * ((a + b + 2 * v) / 4 - v);
    }
  }
  return { w, h, c, d: o };
}
// ---------------------------------------------------------------- הגדלת תמונות/עיגולים נאמנה (קלאסית, בלי המצאת פרטים)
// שיטות: easu = דגימה מכוונת-קצה בסגנון AMD FSR1 EASU (גרעין מתוח לאורך הקצה וצר לרוחבו, מוגבל לטווח 2×2 השכנים),
// rcas = חידוד מותאם-ניגודיות בסגנון FSR1 RCAS/CAS (אונה שלילית שמוגבלת כך שלא יחרוג מהטווח), ibp = back-projection איטרטיבי (עקבי עם המקור).
// כולן מוגבלות לטווח השכנים, לכן אין הילות. img: c=4 (rgb מוכפל-אלפא + אלפא), ערוצים 0..2 מטופלים.
function nbRange(src, tw, th, tol) { // טווח min/max של 2×2 (או 3×3) פיקסלי מקור סביב כל פיקסל פלט
  const { w: sw, h: sh, c } = src, s = src.d, lo = new Float32Array(tw * th * 3), hi = new Float32Array(tw * th * 3);
  const sx = sw / tw, sy = sh / th, r = tol ? 1 : 0;
  for (let y = 0; y < th; y++) {
    const py = (y + 0.5) * sy - 0.5, y0 = Math.floor(py);
    for (let x = 0; x < tw; x++) {
      const px = (x + 0.5) * sx - 0.5, x0 = Math.floor(px), o = (y * tw + x) * 3;
      for (let ch = 0; ch < 3; ch++) {
        let mn = 1e30, mx = -1e30;
        for (let j = y0 - r; j <= y0 + 1 + r; j++) { const yy = j < 0 ? 0 : j >= sh ? sh - 1 : j; for (let i = x0 - r; i <= x0 + 1 + r; i++) { const xx = i < 0 ? 0 : i >= sw ? sw - 1 : i, v = s[(yy * sw + xx) * c + ch]; if (v < mn) mn = v; if (v > mx) mx = v; } }
        lo[o + ch] = mn; hi[o + ch] = mx;
      }
    }
  }
  return { lo, hi };
}
function easuUp(src, tw, th, A) { // A: {len: אורך לאורך הקצה, nar: צמצום לרוחב הקצה, thr: סף חוזק קצה}
  const { w: sw, h: sh, c } = src, s = src.d, out = new Float32Array(tw * th * c);
  const Y = new Float32Array(sw * sh); for (let i = 0; i < sw * sh; i++) Y[i] = 0.299 * s[i * c] + 0.587 * s[i * c + 1] + 0.114 * s[i * c + 2];
  const gx = new Float32Array(sw * sh), gy = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    const xm = x ? x - 1 : 0, xp = x < sw - 1 ? x + 1 : x, ym = y ? y - 1 : 0, yp = y < sh - 1 ? y + 1 : y, i = y * sw + x;
    gx[i] = (Y[y * sw + xp] - Y[y * sw + xm]) / (xp - xm || 1); gy[i] = (Y[yp * sw + x] - Y[ym * sw + x]) / (yp - ym || 1);
  }
  const sx = sw / tw, sy = sh / th, W = new Float32Array(16), I0 = new Int32Array(16), rg = nbRange(src, tw, th, 0);
  const thr2 = A.thr * A.thr;
  for (let y = 0; y < th; y++) {
    const py = (y + 0.5) * sy - 0.5, y0 = Math.floor(py), fy = py - y0;
    for (let x = 0; x < tw; x++) {
      const px = (x + 0.5) * sx - 0.5, x0 = Math.floor(px), fx = px - x0;
      // טנזור מבנה מ-4 הפיקסלים הקרובים (משקל דו-לינארי)
      let jxx = 0, jxy = 0, jyy = 0;
      for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) {
        const xx = clp(x0 + di, 0, sw - 1), yy = clp(y0 + dj, 0, sh - 1), i = yy * sw + xx, wb = (di ? fx : 1 - fx) * (dj ? fy : 1 - fy);
        jxx += wb * gx[i] * gx[i]; jxy += wb * gx[i] * gy[i]; jyy += wb * gy[i] * gy[i];
      }
      const tr = jxx + jyy, df = Math.sqrt((jxx - jyy) * (jxx - jyy) + 4 * jxy * jxy), l1 = (tr + df) / 2;
      const coh = df / (tr + 1e-6), str = l1 / (l1 + thr2), e = coh * str; // 0..1: כמה קצה חד-כיווני
      // כיוון הגרדיאנט (ניצב לקצה): וקטור עצמי של l1
      let ux = jxy, uy = l1 - jxx; const un = Math.sqrt(ux * ux + uy * uy);
      if (un < 1e-9) { ux = 1; uy = 0; } else { ux /= un; uy /= un; }
      const ka = 1 + A.len * e, kc = 1 / (1 + A.nar * e); // רוחב ליד הקצה: צר; לאורך הקצה: ארוך
      let sum = 0, t = 0;
      for (let j = -1; j <= 2; j++) for (let i = -1; i <= 2; i++) {
        const dx = x0 + i - px, dy = y0 + j - py, across = dx * ux + dy * uy, along = -dx * uy + dy * ux;
        const d = Math.sqrt((across / kc) * (across / kc) + (along / ka) * (along / ka));
        let wv = 0; if (d < 2) { if (d < 1e-6) wv = 1; else { const q = Math.PI * d; wv = 2 * Math.sin(q) * Math.sin(q / 2) / (q * q); } }
        W[t] = wv; I0[t] = clp(y0 + j, 0, sh - 1) * sw + clp(x0 + i, 0, sw - 1); sum += wv; t++;
      }
      if (Math.abs(sum) < 1e-6) sum = 1;
      const o = (y * tw + x) * c;
      for (let ch = 0; ch < c; ch++) {
        let acc = 0; for (let q = 0; q < 16; q++) acc += W[q] * s[I0[q] * c + ch];
        acc /= sum;
        if (ch < 3) { const lo = rg.lo[(y * tw + x) * 3 + ch], hi = rg.hi[(y * tw + x) * 3 + ch]; acc = acc < lo ? lo : acc > hi ? hi : acc; }
        out[o + ch] = acc;
      }
    }
  }
  return { w: tw, h: th, c, d: out };
}
// RCAS: חידוד מותאם-ניגודיות על צלב 4-שכנים. sharp = עוצמה (1 ≈ ברירת מחדל של FSR). מוגבל לטווח הצלב כך שאין אוברשוט.
function rcasSharpen(img, sharp) {
  const { w, h, c } = img, s = img.d, o = Float32Array.from(s);
  if (w < 3 || h < 3) return img;
  for (let y = 0; y < h; y++) {
    const ym = y ? y - 1 : 0, yp = y < h - 1 ? y + 1 : y;
    for (let x = 0; x < w; x++) {
      const xm = x ? x - 1 : 0, xp = x < w - 1 ? x + 1 : x, q = (y * w + x) * c;
      const pb = (ym * w + x) * c, pd = (y * w + xm) * c, pf = (y * w + xp) * c, ph = (yp * w + x) * c;
      for (let ch = 0; ch < 3; ch++) {
        const b = s[pb + ch] / 255, d = s[pd + ch] / 255, e = s[q + ch] / 255, f = s[pf + ch] / 255, hh = s[ph + ch] / 255;
        const mn = Math.min(b, d, f, hh), mx = Math.max(b, d, f, hh);
        const hitMin = mn / (4 * mx + 1e-6), hitMax = (1 - mx) / (4 * mn - 4 - 1e-6);
        let lobe = Math.max(-hitMin, hitMax); lobe = Math.max(-0.1875, Math.min(lobe, 0)) * sharp;
        let v = (lobe * (b + d + f + hh) + e) / (4 * lobe + 1);
        const lo = Math.min(mn, e), hi = Math.max(mx, e); v = v < lo ? lo : v > hi ? hi : v;
        o[q + ch] = v * 255;
      }
    }
  }
  return { w, h, c, d: o };
}
// back-projection איטרטיבי: מתקן את ההגדלה כך שהקטנה שלה תחזור למקור (עקבי עם הנתונים; לא ממציא פרטים), בהגבלת טווח
function ibpUp(src, x, iters, lam, tol) {
  const tw = x.w, th = x.h, c = x.c, rg = nbRange(src, tw, th, tol);
  let cur = x;
  for (let k = 0; k < iters; k++) {
    const dn = resize(cur, src.w, src.h, 'area'), res = { w: src.w, h: src.h, c, d: new Float32Array(src.d.length) };
    for (let i = 0; i < res.d.length; i++) res.d[i] = src.d[i] - dn.d[i];
    const up = resize(res, tw, th, 'cubic'), nd = new Float32Array(cur.d.length);
    for (let i = 0; i < nd.length; i++) nd[i] = cur.d[i] + lam * up.d[i];
    for (let i = 0; i < tw * th; i++) for (let ch = 0; ch < 3; ch++) { const v = nd[i * c + ch], lo = rg.lo[i * 3 + ch], hi = rg.hi[i * 3 + ch]; nd[i * c + ch] = v < lo ? lo : v > hi ? hi : v; }
    cur = { w: tw, h: th, c, d: nd };
  }
  return cur;
}
// נקודת כניסה: pm = מקור (c=4, מוכפל-אלפא, sRGB), r = תוצאת Lanczos מוגבל בגודל היעד. מחזיר תמונה חדשה או null (= להשאיר את הנתיב הקיים)
function photoUpscale(pm, tw, th, r, T) {
  const m = T.photoUp; if (!m || m === 'cur') return null;
  let x = r;
  if (m.indexOf('easu') >= 0) x = easuUp(pm, tw, th, { len: T.puLen, nar: T.puNar, thr: T.puThr });
  if (m.indexOf('ibp') >= 0) x = ibpUp(pm, x, T.puIter, T.puLam, 1);
  if (m.indexOf('cas') >= 0) x = rcasSharpen(x, T.puSharp);
  return x;
}
// ---------------------------------------------------------------- גרפיקה שטוחה (לוגואים): הגדלה "וקטורית"
// מזהה שכבה שהיא אמנות שטוחה (מעט צבעים דומיננטיים) ומחזיר פלטה, או null. הפלטה נלקחת מהפיקסלים המקוריים בלבד.
function flatPalette(L) {
  if (L._flat !== undefined) return L._flat;
  const n = L.lw * L.lh, S = [], step = Math.max(1, Math.floor(n / 6000));
  for (let i = 0; i < n; i += step) if (L.a[i] > 0.9) S.push(L.rgb[i * 3], L.rgb[i * 3 + 1], L.rgb[i * 3 + 2]);
  const m = S.length / 3;
  if (m < 40 || n < 100) return (L._flat = null);
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const px = i => [S[i * 3], S[i * 3 + 1], S[i * 3 + 2]];
  let res = null;
  for (let K = 1; K <= 8 && !res; K++) {
    // farthest-point init + Lloyd
    let cen = [px(0)]; { let mean = [0, 0, 0]; for (let i = 0; i < m; i++) { mean[0] += S[i * 3]; mean[1] += S[i * 3 + 1]; mean[2] += S[i * 3 + 2]; } mean = mean.map(v => v / m); let bi = 0, bd = 1e30; for (let i = 0; i < m; i++) { const d = d2(px(i), mean); if (d < bd) { bd = d; bi = i; } } cen = [px(bi)]; }
    while (cen.length < K) { let bi = 0, bd = -1; for (let i = 0; i < m; i++) { let dm = 1e30; for (const c of cen) dm = Math.min(dm, d2(px(i), c)); if (dm > bd) { bd = dm; bi = i; } } cen.push(px(bi)); }
    for (let it = 0; it < 6; it++) {
      const acc = cen.map(() => [0, 0, 0, 0]);
      for (let i = 0; i < m; i++) { let bk = 0, bd = 1e30; for (let k = 0; k < K; k++) { const d = d2(px(i), cen[k]); if (d < bd) { bd = d; bk = k; } } const q = acc[bk]; q[0] += S[i * 3]; q[1] += S[i * 3 + 1]; q[2] += S[i * 3 + 2]; q[3]++; }
      cen = cen.map((c, k) => acc[k][3] ? [acc[k][0] / acc[k][3], acc[k][1] / acc[k][3], acc[k][2] / acc[k][3]] : c);
    }
    let fc = 0, fe = 0;
    for (let i = 0; i < m; i++) {
      const c = px(i); let dm = 1e30; for (const q of cen) dm = Math.min(dm, d2(c, q));
      if (dm < 22 * 22) { fc++; fe++; continue; }
      let ok = false;
      for (let a = 0; a < K && !ok; a++) for (let b = a + 1; b < K && !ok; b++) { const r = segRes(c, cen[a], cen[b]); if (r[0] < 12) ok = true; }
      if (ok) fe++;
    }
    if (fe / m >= 0.93 && fc / m >= 0.55) res = cen;
  }
  if (res) { // מאחדים צבעים קרובים מדי
    const out = []; for (const c of res) if (!out.some(o => d2(o, c) < 14 * 14)) out.push(c); res = out;
  }
  return (L._flat = res ? { pal: res } : null);
}
// שארית (מרחק) ופרמטר t של צבע c מול הקטע a–b
function segRes(c, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], vz = b[2] - a[2], vv = vx * vx + vy * vy + vz * vz;
  let t = vv > 1e-6 ? ((c[0] - a[0]) * vx + (c[1] - a[1]) * vy + (c[2] - a[2]) * vz) / vv : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  return [Math.hypot(c[0] - a[0] - t * vx, c[1] - a[1] - t * vy, c[2] - a[2] - t * vz), t];
}
// התאמת אלפא עם קצה חד כמו וקטור: החלקה (מבטלת מדרגות) ואז שיפוע
function steepenPlane(a, sg, g, ctr) {
  if (sg > 0.2) a = blur(a, sg);
  for (let i = 0; i < a.d.length; i++) a.d[i] = clp((a.d[i] - ctr) * g + ctr, 0, 1);
  return a;
}
// הגדלה של שכבת אמנות שטוחה: Lanczos מוגבל → שיוך כל פיקסל לפלטה (חלוקה לקטעי צבע) → החלקה + חידוד של שדות השיוך.
// התוצאה: אזורים שטוחים נקיים וקצוות חדים בלי הילות (צבעי הפלטה הם צבעים מהמקור). opt: sg (מקדם החלקה), gm (חידוד), ag (חידוד אלפא)
function flatArtUp(L, tw, th, opt) {
  const o = Object.assign({ sg: 0.25, gm: 1.2, ag: 1.0, ctr: 0.5, usm: 0.5 }, opt || {}), pal = L._flat.pal, K = pal.length, n = L.lw * L.lh;
  const pm = { w: L.lw, h: L.lh, c: 4, d: new Float32Array(n * 4) };
  for (let i = 0; i < n; i++) { const al = L.a[i]; pm.d[i * 4] = L.rgb[i * 3] * al; pm.d[i * 4 + 1] = L.rgb[i * 3 + 1] * al; pm.d[i * 4 + 2] = L.rgb[i * 3 + 2] * al; pm.d[i * 4 + 3] = al; }
  const r = resizeLim(pm, tw, th), N = tw * th, up = Math.sqrt(N / n);
  const A = { w: tw, h: th, c: 1, d: new Float32Array(N) }, U = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) { const al = clp(r.d[i * 4 + 3], 0, 1); A.d[i] = al; const inv = al > 1e-4 ? 1 / al : 0; for (let k = 0; k < 3; k++) U[i * 3 + k] = clp(r.d[i * 4 + k] * inv, 0, 255); }
  const sg = clp(o.sg * up, 0.4, 1.6), g = clp((2.0 * sg + 0.9) * o.gm, 1, 6);
  // שיוך לפלטה
  const M = { w: tw, h: th, c: K + 1, d: new Float32Array(N * (K + 1)) }, wt = new Float32Array(N), c3 = [0, 0, 0];
  for (let i = 0; i < N; i++) {
    c3[0] = U[i * 3]; c3[1] = U[i * 3 + 1]; c3[2] = U[i * 3 + 2];
    let bi = 0, bj = 0, bt = 0, br = 1e30;
    if (K === 1) { br = Math.hypot(c3[0] - pal[0][0], c3[1] - pal[0][1], c3[2] - pal[0][2]); }
    else for (let a = 0; a < K; a++) for (let b = a + 1; b < K; b++) { const q = segRes(c3, pal[a], pal[b]); if (q[0] < br) { br = q[0]; bi = a; bj = b; bt = q[1]; } }
    wt[i] = clp((22 - br) / 10, 0, 1); // נאמן לפלטה כשהשארית קטנה, אחרת משאירים את הצבע המוגדל
    const al = A.d[i], q = i * (K + 1);
    M.d[q + bi] = (1 - bt) * al; if (bj !== bi) M.d[q + bj] = bt * al; M.d[q + K] = al;
  }
  const Mb = blur(M, sg), Ab = Mb, rgb = new Float32Array(N * 3);
  const gi = g;
  for (let i = 0; i < N; i++) {
    const q = i * (K + 1), den = Ab.d[q + K];
    if (den < 1e-3 || wt[i] <= 0) { for (let k = 0; k < 3; k++) rgb[i * 3 + k] = U[i * 3 + k]; continue; }
    let sum = 0; const mm = [];
    for (let k = 0; k < K; k++) { const v = Math.pow(Math.max(Mb.d[q + k] / den, 0) + 1e-6, gi); mm.push(v); sum += v; }
    let c0 = 0, c1 = 0, c2 = 0; for (let k = 0; k < K; k++) { const v = mm[k] / sum; c0 += v * pal[k][0]; c1 += v * pal[k][1]; c2 += v * pal[k][2]; }
    const w = wt[i];
    rgb[i * 3] = U[i * 3] + w * (c0 - U[i * 3]); rgb[i * 3 + 1] = U[i * 3 + 1] + w * (c1 - U[i * 3 + 1]); rgb[i * 3 + 2] = U[i * 3 + 2] + w * (c2 - U[i * 3 + 2]);
  }
  const a2 = o.ag ? steepenPlane(A, sg, clp(g * o.ag, 1, 6), o.ctr) : A;
  let out = { a: a2.d, rgb };
  if (o.usm) { const t = { w: tw, h: th, c: 3, d: rgb }; out = { a: a2.d, rgb: usmLum(t, o.usm, 0).d }; }
  return out;
}
// שכבה (rgb ישר 0..255 + אלפא) → גודל יעד. מחזיר { a: Float32Array, rgb: Float32Array (ישר, sRGB) }
function resampleLayer(L, tw, th, isText) {
  const T = TUNE(), n = L.lw * L.lh, sc = Math.sqrt(n / (tw * th)), down = sc > 1.0001, same = tw === L.lw && th === L.lh;
  const aPl = { w: L.lw, h: L.lh, c: 1, d: L.a };
  if (isText) {
    // אלפא: Lanczos מוגבל, ואז חידוד קצה (כמו וקטור): בהקטנה – שיפוע + unsharp; בהגדלה – סף רך מעל מסכת האלפא
    let a;
    if (same) a = { w: tw, h: th, c: 1, d: Float32Array.from(L.a) };
    else a = resizeLim(aPl, tw, th);
    if (down) {
      const l2 = Math.log2(sc), g = 1 + T.gainDn * Math.min(l2, 3), cc = T.gainCenter;
      for (let i = 0; i < a.d.length; i++) a.d[i] = clp((a.d[i] - cc) * g + cc, 0, 1);
      a = usmLim(a, T.usmText * Math.min(1.8, 0.7 + 0.6 * l2), [0], 0);
    } else if (sc < 0.999) {
      // הגדלה: מחליקים את הקווים (בלי מדרגות פיקסלים) ואז מחדדים את הקצה בחזרה, כמו שקווי מתאר וקטוריים נראים
      const up = 1 / sc, sg = clp(0.38 * up, 0.45, 1.5);
      if (up > 1.15) a = blur(a, sg);
      const g = clp(up > 1.15 ? 2.0 * sg + 0.9 : 0.9 / sc, 1, 5);
      for (let i = 0; i < a.d.length; i++) a.d[i] = clp((a.d[i] - 0.5) * g + 0.5, 0, 1);
    }
    // צבע: אם הטקסט חד-צבעי (המקרה הרגיל) – קבוע; אחרת ממוצע משוקלל-אלפא בשכנות 3×3 (משקלים חיוביים → תמיד בתוך טווח הצבעים)
    if (!L._uni) {
      let m0 = 0, m1 = 0, m2 = 0, ms = 0;
      for (let i = 0; i < n; i++) { const al = L.a[i]; m0 += L.rgb[i * 3] * al; m1 += L.rgb[i * 3 + 1] * al; m2 += L.rgb[i * 3 + 2] * al; ms += al; }
      if (ms < 1e-6) ms = 1; m0 /= ms; m1 /= ms; m2 /= ms;
      let dev = 0; for (let i = 0; i < n; i++) if (L.a[i] > 0.5) dev = Math.max(dev, Math.abs(L.rgb[i * 3] - m0), Math.abs(L.rgb[i * 3 + 1] - m1), Math.abs(L.rgb[i * 3 + 2] - m2));
      L._uni = { m: [m0, m1, m2], uniform: dev < 10 };
    }
    const rgb = new Float32Array(tw * th * 3), mc = L._uni.m;
    if (L._uni.uniform) { for (let i = 0; i < tw * th; i++) { rgb[i * 3] = mc[0]; rgb[i * 3 + 1] = mc[1]; rgb[i * 3 + 2] = mc[2]; } return { a: a.d, rgb }; }
    const pm = { w: L.lw, h: L.lh, c: 3, d: new Float32Array(n * 3) };
    for (let i = 0; i < n; i++) { const al = L.a[i]; pm.d[i * 3] = L.rgb[i * 3] * al; pm.d[i * 3 + 1] = L.rgb[i * 3 + 1] * al; pm.d[i * 3 + 2] = L.rgb[i * 3 + 2] * al; }
    const cp = same ? pm : resize(pm, tw, th, down ? 'area' : 'linear'), ap = same ? aPl : resize(aPl, tw, th, down ? 'area' : 'linear');
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      if (a.d[y * tw + x] < 0.002) continue;
      let s0 = 0, s1 = 0, s2 = 0, sa = 0;
      for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= th) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= tw) continue; const j = yy * tw + xx; s0 += cp.d[j * 3]; s1 += cp.d[j * 3 + 1]; s2 += cp.d[j * 3 + 2]; sa += ap.d[j]; } }
      const o = (y * tw + x) * 3;
      if (sa > 0.02) { rgb[o] = clp(s0 / sa, 0, 255); rgb[o + 1] = clp(s1 / sa, 0, 255); rgb[o + 2] = clp(s2 / sa, 0, 255); } else { rgb[o] = mc[0]; rgb[o + 1] = mc[1]; rgb[o + 2] = mc[2]; }
    }
    return { a: a.d, rgb };
  }
  if (!T.faOff && !same && sc < 0.999 && flatPalette(L)) return flatArtUp(L, tw, th, T.fa); // אמנות שטוחה (לוגו): הגדלה וקטורית
  // גרפיקה/תמונה: premult באור לינארי (gamma-correct), חידוד ב-sRGB עם הגבלת הילות
  const pm = { w: L.lw, h: L.lh, c: 4, d: new Float32Array(n * 4) };
  const lin = down;
  for (let i = 0; i < n; i++) { const al = L.a[i]; for (let k = 0; k < 3; k++) pm.d[i * 4 + k] = (lin ? toLin(L.rgb[i * 3 + k]) : L.rgb[i * 3 + k]) * al; pm.d[i * 4 + 3] = al; }
  const r0 = same ? pm : resizeLim(pm, tw, th), N = tw * th;
  const pu = (!same && !down) ? photoUpscale(pm, tw, th, r0, T) : null, r = pu || r0;
  let sp = { w: tw, h: th, c: 4, d: new Float32Array(N * 4) };
  for (let i = 0; i < N; i++) {
    const al = clp(r.d[i * 4 + 3], 0, 1); sp.d[i * 4 + 3] = al;
    const inv = al > 1e-4 ? 1 / al : 0;
    for (let k = 0; k < 3; k++) sp.d[i * 4 + k] = (lin ? fromLin(r.d[i * 4 + k] * inv) : clp(r.d[i * 4 + k] * inv, 0, 255)) * al;
  }
  if (!same && !pu) sp = down ? usmLum(sp, T.usmPhoto * Math.min(1.4, 0.45 + 0.5 * Math.log2(sc)), 0)
    : usmLum(sc < 0.8 && T.esMix ? edgeSmooth(sp, clp(0.8 / sc, 1, 3), T.esMix, T.esThr) : sp, T.usmPhoto * T.upAmt, T.upAdapt);
  const a = new Float32Array(N), rgb = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const al = sp.d[i * 4 + 3]; a[i] = al;
    const inv = al > 1e-4 ? 1 / al : 0;
    for (let k = 0; k < 3; k++) rgb[i * 3 + k] = clp(sp.d[i * 4 + k] * inv, 0, 255);
  }
  return { a, rgb };
}

// רקע/תמונה בלי אלפא (RGB): הקטנה באור לינארי + Lanczos מוגבל + חידוד; הגדלה: Lanczos מוגבל + חידוד אדפטיבי
function resizePlate(img, dw, dh, win) {
  const T = TUNE(), { w: sw, h: sh } = img;
  const sc = Math.sqrt(sw * sh / (dw * dh)), down = sc > 1.0001;
  let w2 = win;
  if (win) { const m = 1, x0 = Math.max(0, win.x0 - m), y0 = Math.max(0, win.y0 - m), x1 = Math.min(dw, win.x0 + win.w + m), y1 = Math.min(dh, win.y0 + win.h + m); w2 = { x0, y0, w: x1 - x0, h: y1 - y0 }; }
  let r = (sw === dw && sh === dh && !win) ? { w: sw, h: sh, c: 3, d: Float32Array.from(img.d) } : resize(img, dw, dh, down ? 'area' : 'cubic', w2);
  if (sw !== dw || sh !== dh) r = down ? usmLum(r, T.usmPhoto * Math.min(1.4, 0.45 + 0.5 * Math.log2(sc)), 0) : usmLum(sc < 0.8 && T.esMix ? edgeSmooth(r, clp(0.8 / sc, 1, 3), T.esMix, T.esThr) : r, T.usmPhoto * T.upAmt, T.upAdapt);
  if (win && (w2.x0 !== win.x0 || w2.y0 !== win.y0 || w2.w !== win.w || w2.h !== win.h)) { // חותכים את שולי החלון
    const o = { w: win.w, h: win.h, c: 3, d: new Float32Array(win.w * win.h * 3) };
    for (let y = 0; y < win.h; y++) o.d.set(r.d.subarray(((y + win.y0 - w2.y0) * w2.w + win.x0 - w2.x0) * 3, ((y + win.y0 - w2.y0) * w2.w + win.x0 - w2.x0 + win.w) * 3), y * win.w * 3);
    r = o;
  }
  const m = r.w * r.h * 3, d = r.d; for (let i = 0; i < m; i++) d[i] = d[i] < 0 ? 0 : d[i] > 255 ? 255 : d[i];
  return r;
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
  // אופקי (סדר החיבור בכל ערוץ זהה למקור, ולכן התוצאה זהה ביט-ביט)
  for (let y = 0; y < h; y++) {
    const ro = y * w * c;
    for (let x = 0; x < w; x++) {
      const o = ro + x * c;
      if (x >= r && x < w - r) {
        if (c === 3) {
          let a0 = 0, a1 = 0, a2 = 0, p = ro + (x - r) * 3;
          for (let t = 0; t <= 2 * r; t++, p += 3) { const kt = k[t]; a0 += src[p] * kt; a1 += src[p + 1] * kt; a2 += src[p + 2] * kt; }
          tmp[o] = a0; tmp[o + 1] = a1; tmp[o + 2] = a2;
        } else for (let ch = 0; ch < c; ch++) { let a = 0, p = ro + (x - r) * c + ch; for (let t = 0; t <= 2 * r; t++, p += c) a += src[p] * k[t]; tmp[o + ch] = a; }
      } else {
        for (let t = -r; t <= r; t++) xi[t + r] = refl(x + t, w);
        for (let ch = 0; ch < c; ch++) { let a = 0; for (let t = 0; t <= 2 * r; t++) a += src[ro + xi[t] * c + ch] * k[t]; tmp[o + ch] = a; }
      }
    }
  }
  // אנכי: צוברים שורה שלמה בכל צעד כדי לקרוא זיכרון ברצף
  const stride = w * c, acc = new Float64Array(stride);
  for (let y = 0; y < h; y++) {
    const inter = y >= r && y < h - r;
    if (!inter) for (let t = -r; t <= r; t++) xi[t + r] = refl(y + t, h);
    const base = y * stride;
    acc.fill(0);
    for (let t = 0; t <= 2 * r; t++) { const kt = k[t], ro = (inter ? y - r + t : xi[t]) * stride; for (let x = 0; x < stride; x++) acc[x] += tmp[ro + x] * kt; }
    for (let x = 0; x < stride; x++) out[base + x] = acc[x];
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
// מילוי הרמוני של חורים גדולים: מקרב את הצבעים מהשוליים (פתרון משוואת לפלס ברזולוציה נמוכה), כך שמעבר צבע ברקע ממשיך בצורה חלקה בלי כתם.
function harmonicFill(img, hole, init) {
  const { w, h } = img, f = Math.max(2, Math.ceil(Math.max(w, h) / 160)), cw = Math.ceil(w / f), ch = Math.ceil(h / f), C = cw * ch;
  const val = new Float32Array(C * 3), cnt = new Float32Array(C), area = new Float32Array(C), hd = new Uint8Array(C), ini = new Float32Array(C * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, c = ((y / f) | 0) * cw + ((x / f) | 0); area[c]++;
    if (!hole[i]) { cnt[c]++; val[c * 3] += img.d[i * 3]; val[c * 3 + 1] += img.d[i * 3 + 1]; val[c * 3 + 2] += img.d[i * 3 + 2]; }
    ini[c * 3] += init[i * 3]; ini[c * 3 + 1] += init[i * 3 + 1]; ini[c * 3 + 2] += init[i * 3 + 2];
  }
  for (let c = 0; c < C; c++) {
    if (cnt[c] < 0.5 * area[c]) { hd[c] = 1; for (let k = 0; k < 3; k++) val[c * 3 + k] = ini[c * 3 + k] / area[c]; }
    else for (let k = 0; k < 3; k++) val[c * 3 + k] /= cnt[c];
  }
  const list = []; for (let c = 0; c < C; c++) if (hd[c]) list.push(c);
  for (let it = 0; it < 500; it++) for (const c of list) {
    const x = c % cw, y = (c / cw) | 0;
    const l = x > 0 ? c - 1 : c, r = x < cw - 1 ? c + 1 : c, u = y > 0 ? c - cw : c, d = y < ch - 1 ? c + cw : c;
    for (let k = 0; k < 3; k++) val[c * 3 + k] = (val[l * 3 + k] + val[r * 3 + k] + val[u * 3 + k] + val[d * 3 + k]) / 4;
  }
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(ch - 1, Math.max(0, (y + 0.5) / f - 0.5)), y0 = Math.floor(fy), y1 = Math.min(ch - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(cw - 1, Math.max(0, (x + 0.5) / f - 0.5)), x0 = Math.floor(fx), x1 = Math.min(cw - 1, x0 + 1), tx = fx - x0;
      for (let k = 0; k < 3; k++) out[(y * w + x) * 3 + k] = (val[(y0 * cw + x0) * 3 + k] * (1 - tx) + val[(y0 * cw + x1) * 3 + k] * tx) * (1 - ty) + (val[(y1 * cw + x0) * 3 + k] * (1 - tx) + val[(y1 * cw + x1) * 3 + k] * tx) * ty;
    }
  }
  return out;
}
function msFill(img, hole, opts) {
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
  { // חורים גדולים (למשל תמונה ראשית): ממלאים בצורה הרמונית כדי שלא ייווצר כתם
    let big = 0; for (let i = 0; i < N; i++) big += hole[i] ? 1 : 0;
    if (big > 0.02 * N) {
      const dens = blur(hm, Math.max(6, Math.min(w, h) * 0.03)), hf = harmonicFill(img, hole, fill);
      for (let i = 0; i < N; i++) { const wg = clp((dens.d[i] - 0.2) / 0.5, 0, 1); if (wg > 0 && hole[i]) for (let k = 0; k < 3; k++) fill[i * 3 + k] = fill[i * 3 + k] * (1 - wg) + hf[i * 3 + k] * wg; }
    }
  }
  let texW = null; // כמה מכל פיקסל מולא בטקסטורה מסונתזת (PatchMatch) ולא במילוי חלק
  if (opts && opts.tex && G.SizyFill) { const r = G.SizyFill.refine(img, hole, fill, opts.tex === true ? {} : opts.tex); fill.set(r.fill); texW = r.weight; }
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
    const m = m3.d[i], nz = clp(m * 2, 0, 1) * (texW ? 1 - texW[i] : 1);
    for (let ch = 0; ch < 3; ch++) out[i * 3 + ch] = img.d[i * 3 + ch] * (1 - m) + fill[i * 3 + ch] * m + (nz > 0 ? gauss() * noise * nz : 0);
  }
  return { w, h, c: 3, d: out, tex: texW };
}
function softenDenseHoles(plate, hole, tex) {
  const { w, h } = plate, N = w * h, base = Math.min(w, h);
  const hf = plane(w, h); for (let i = 0; i < N; i++) hf.d[i] = hole[i] ? 1 : 0;
  const dens = blur(hf, Math.max(8, base * 0.04));
  const bl = blur(plate, Math.max(5, base * 0.012));
  const out = new Float32Array(N * 3);
  // הטשטוש מוחק גם את הגרעיניות ולכן נראה כמריחה ליד רקע חד: מחזירים גרעיניות בעוצמה של הרקע הידוע (סטיית תקן של תדר גבוה מחוץ לחורים)
  const sm = blur(plate, 1.2), ea = [];
  for (let i = 0; i < N; i += 3) if (!hole[i]) ea.push(Math.abs(plate.d[i * 3 + 1] - sm.d[i * 3 + 1]));
  const gsd = ea.length ? clp(median(ea) * 1.4826 * 0.9, 0, 5) : 0, rnd = mulberry(11);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  for (let i = 0; i < N; i++) {
    const wl = clp((dens.d[i] - 0.14) / 0.30, 0, 0.65) * (tex ? 1 - tex[i] : 1), nz = wl > 0.02 ? gauss() * gsd * wl : 0;
    for (let ch = 0; ch < 3; ch++) out[i * 3 + ch] = plate.d[i * 3 + ch] * (1 - wl) + bl.d[i * 3 + ch] * wl + nz;
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

function textLayer(img, box, nlines, upMax, outline, bullets, holes, others, ext) {
  const extBelow = ext && ext.below, extSide = ext && ext.side;
  const W = img.w, H = img.h;
  const [x, y, w, h] = box;
  upMax = upMax || 4;
  const ex = Math.floor(0.12 * Math.max(w, h) + 4);
  const exw = Math.max(ex, Math.floor((extSide ? 2.4 : 1.1) * Math.max(6, h / Math.max(1, nlines)))); // לצדדים מרחיבים יותר: ה-AI נוטה לחתוך כיתוב קצר
  const pad = exw + Math.max(6, Math.floor(0.15 * Math.min(w, h)));
  const x0 = clp(x - pad, 0, W - 2), y0 = clp(y - pad, 0, H - 2);
  const x1 = clp(x + w + pad, x0 + 2, W), y1 = clp(y + h + pad, y0 + 2, H);
  const crop = cropImg(img, x0, y0, x1, y1), cw = crop.w, ch = crop.h, cd = crop.d, CN = cw * ch;
  const lineh = Math.max(6, h / Math.max(1, nlines));
  let { bg, err } = ringBg(crop);
  const inner = new Uint8Array(CN);
  for (let yy = Math.max(0, y - y0); yy < Math.min(ch, y + h - y0); yy++) for (let xx = Math.max(0, x - x0); xx < Math.min(cw, x + w - x0); xx++) inner[yy * cw + xx] = 1;
  const solidOth = (others || []).filter(o => o.solid).map(o => { const g = Math.max(3, Math.round(0.1 * Math.min(o[2], o[3]))); return [o[0] - g, o[1] - g, o[2] + 2 * g, o[3] + 2 * g]; }); // התיבה של ה-AI צמודה: מרחיבים מעט כדי שקצה התג לא ייחשב אות
  for (const o of solidOth) for (let yy = Math.max(0, o[1] - y0); yy < Math.min(ch, o[1] + o[3] - y0); yy++) for (let xx = Math.max(0, o[0] - x0); xx < Math.min(cw, o[0] + o[2] - x0); xx++) inner[yy * cw + xx] = 0;
  let innerAny = false; for (let i = 0; i < CN; i++) if (inner[i]) { innerAny = true; break; }
  const bigBg = () => medianBg(crop, odd(clp(lineh * 1.8, 15, 141)));
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
  for (const o of solidOth) for (let yy = Math.max(0, o[1] - y0); yy < Math.min(ch, o[1] + o[3] - y0); yy++) for (let xx = Math.max(0, o[0] - x0); xx < Math.min(cw, o[0] + o[2] - x0); xx++) win[yy * cw + xx] = 0;
  for (const o of (others || [])) if (o.clip) for (let yy = Math.max(0, o[1] - y0); yy < Math.min(ch, o[1] + o[3] - y0); yy++) for (let xx = Math.max(0, o[0] - x0); xx < Math.min(cw, o[0] + o[2] - x0); xx++) { const gx = x0 + xx, gy = y0 + yy; if (!(gx >= x && gx < x + w && gy >= y && gy < y + h)) win[yy * cw + xx] = 0; }
  // כיתוב קצר שה-AI חתך באמצע (חסרה שורה אחרונה): מרחיבים מעט כלפי מטה, אבל לא לתוך אלמנט אחר
  const ev = extBelow && !innerMode ? Math.floor(1.1 * Math.max(6, h / Math.max(1, nlines))) : 0;
  const blocked = (xx, yy) => (others || []).some(o => xx >= o[0] && xx < o[0] + o[2] && yy >= o[1] && yy < o[1] + o[3]);
  if (extSide) for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) { const gx = x0 + xx, gy = y0 + yy; if (win[yy * cw + xx] && !(gx >= x && gx < x + w && gy >= y && gy < y + h) && blocked(gx, gy)) win[yy * cw + xx] = 0; }
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
  const tol = outline ? 150 : (cols.length === 1 ? 75 : 95 + 0.55 * sep);
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
  if (extSide) { // מילים וסימנים שה-AI חתך בקצה השורה (כמו נקודתיים או המילה הראשונה): מצרפים רכיבים סמוכים באותו גובה
    const bb = new Map();
    for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) { const i = yy * cw + xx, id = lab[i]; if (id > 0 && ink[i]) { let b = bb.get(id); if (!b) { b = [xx, yy, xx, yy, 0]; bb.set(id, b); } b[0] = Math.min(b[0], xx); b[1] = Math.min(b[1], yy); b[2] = Math.max(b[2], xx); b[3] = Math.max(b[3], yy); b[4]++; } }
    const lh1 = Math.max(6, h / Math.max(1, nlines)), by0 = y - y0, by1 = y + h - y0;
    let changed = true, guard = 0;
    while (changed && guard++ < 6) {
      changed = false;
      let ux0 = 1e9, ux1 = -1e9; for (const id of keepIds) { const b = bb.get(id); if (b) { ux0 = Math.min(ux0, b[0]); ux1 = Math.max(ux1, b[2]); } }
      if (ux1 < ux0) break;
      for (const [id, b] of bb) {
        if (keepIds.has(id) || b[4] < 4) continue;
        const ov = Math.min(b[3] + 1, by1) - Math.max(b[1], by0); if (ov < 0.4 * (b[3] + 1 - b[1])) continue;
        const gap = Math.max(0, b[0] - ux1, ux0 - b[2]); if (gap > 0.9 * lh1) continue;
        keepIds.add(id); changed = true; ux0 = Math.min(ux0, b[0]); ux1 = Math.max(ux1, b[2]);
      }
    }
  }
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
    if (cols.length > 1) { // טקסט דו-צבעי (מילוי + קו מתאר, או מעבר צבע): הצבע האמיתי של הפיקסל, בלי ערבוב בין הצבעים
      const dfv = diff[i]; let a2 = clp((dfv - thr) / Math.max(1, sthr - thr), 0, 1); if (a2 < 0.05) a2 = 0;
      let best = cols[0], bm = 1e9; for (const c of cols) { const m = Math.hypot(cd[i * 3] - c[0], cd[i * 3 + 1] - c[1], cd[i * 3 + 2] - c[2]); if (m < bm) { bm = m; best = c; } }
      for (let c2 = 0; c2 < 3; c2++) Cl[i * 3 + c2] = dfv >= sthr ? cd[i * 3 + c2] : best[c2];
      alpha[i] = a2; continue;
    }
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
  for (let i = 0; i < aUp.d.length; i++) aUp.d[i] = clp((aUp.d[i] - 0.38) / 0.3 + 0.5, 0, 1); // מרכז מעט נמוך מ-0.5: שומר על עובי האותיות המקורי
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
  if (e.matte) { const LM = matteLayer(clean, e); if (LM) return LM; }
  let [x, y, w, h] = e.px;
  let shape = e.shape;
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
  if (shape === 'hero' && w > 24 && h > 24) { // "תמונה ראשית" שהיא בעצם גזורה (השוליים זהים לרקע): חותכים לפי הצורה כדי שלא יישאר מלבן רקע
    let nb = 0, nd = 0; const bw2 = Math.max(2, Math.floor(Math.min(w, h) * 0.03)), dd = bw2 + 4, D = clean.d;
    const cmp = (i0, j0, i1, j1) => { if (i1 < 0 || j1 < 0 || i1 >= W || j1 >= H) return; nb++; const a0 = (j0 * W + i0) * 3, a1 = (j1 * W + i1) * 3; if (Math.max(Math.abs(D[a0] - D[a1]), Math.abs(D[a0 + 1] - D[a1 + 1]), Math.abs(D[a0 + 2] - D[a1 + 2])) > 18) nd++; };
    for (let i = 0; i < w; i++) { cmp(x + i, y, x + i, y - dd); cmp(x + i, y + h - 1, x + i, y + h - 1 + dd); }
    for (let j = 0; j < h; j++) { cmp(x, y + j, x - dd, y + j); cmp(x + w - 1, y + j, x + w - 1 + dd, y + j); }
    if (nb && nd / nb < 0.2) shape = 'free';
  }
  const crop = cropImg(clean, x, y, x + w, y + h), a = new Float32Array(w * h);
  if (shape === 'circle') {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) a[j * w + i] = clp(Math.min(w, h) / 2 - Math.hypot(i + .5 - w / 2, j + .5 - h / 2) + .5, 0, 1);
  } else if (shape === 'pill' || shape === 'rounded' || shape === 'panel') {
    const rad = shape === 'pill' ? Math.min(w, h) / 2 : shape === 'panel' ? e.radius || 0 : Math.min(w, h) * 0.22;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const qx = Math.abs(i + .5 - w / 2) - (w / 2 - rad), qy = Math.abs(j + .5 - h / 2) - (h / 2 - rad);
      a[j * w + i] = clp(.5 - (Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad), 0, 1);
    }
  } else if (shape === 'free') {
    const { df, cw, x0, y0 } = ringDiff(clean, [x, y, w, h], Math.max(6, Math.floor(Math.min(w, h) * 0.2)));
    const sub = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) sub[j * w + i] = clp((df[(y - y0 + j) * cw + (x - x0 + i)] - (e.shape === "hero" ? 22 : 10)) / 26, 0, 1);
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
  const LL = { rgb: crop.d, a, lw: w, lh: h, up: 1, x, y, w, h, rectHero: shape === 'hero' };
  if (shape === 'free' && e.role !== 'hero' && e.role !== 'logo') trimBorderBg(clean, LL);
  return LL;
}

// ---- שוליים רכים / מט לתמונה צפה (לא נוגעת בקצה הקנבס)
const softEdge = v => { v = clp(v, 0, 1); return v * v * (3 - 2 * v); };
// צבע השוליים (אלפא חלקית) מוחלף בצבע הקרוב מבפנים כדי שלא תישאר הילה מהרקע המקורי
function decontaminate(rgb, a, w, h, thr = 0.95, iters = 4) {
  const known = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) known[i] = a[i] >= thr ? 1 : 0;
  for (let it = 0; it < iters; it++) {
    const nk = known.slice(), upd = [];
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const k = j * w + i; if (known[k]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const x = i + di, y = j + dj; if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const q = y * w + x; if (!known[q]) continue; r += rgb[q * 3]; g += rgb[q * 3 + 1]; b += rgb[q * 3 + 2]; n++;
      }
      if (n) upd.push(k, r / n, g / n, b / n);
    }
    for (let t = 0; t < upd.length; t += 4) { const k = upd[t]; rgb[k * 3] = upd[t + 1]; rgb[k * 3 + 1] = upd[t + 2]; rgb[k * 3 + 2] = upd[t + 3]; nk[k] = 1; }
    known.set(nk);
  }
}
// תג/סרט/פס פרסים בצורה חופשית: מוחקים מהשוליים כל מה שדומה (בצבע) לרקע שמסביב ומחובר לשפה, בעומק מוגבל,
// כדי שלא יישארו פסי רקע מקוריים (פס סגול, שיחים) סביב התג. הצורה הפנימית לא נוגעים בה.
function trimBorderBg(clean, L, tol = 16) {
  const W = clean.w, H = clean.h, { lw: w, lh: h, x, y } = L, a = L.a, D = clean.d;
  if (w < 24 || h < 16) return;
  const m = 3, step = Math.max(1, Math.floor((w + h) / 40)), side = [[], [], [], []]; // l, r, t, b: דגימות הרקע שמחוץ לכל צלע בנפרד
  const take = (k, px, py) => { if (px < 0 || py < 0 || px >= W || py >= H) return; const o = (py * W + px) * 3; side[k].push(D[o], D[o + 1], D[o + 2]); };
  for (let i = 0; i < w; i += step) { take(2, x + i, y - m); take(3, x + i, y + h + m - 1); }
  for (let j = 0; j < h; j += step) { take(0, x - m, y + j); take(1, x + w + m - 1, y + j); }
  const inn = [], ix0 = Math.floor(w * 0.25), ix1 = Math.ceil(w * 0.75), iy0 = Math.floor(h * 0.25), iy1 = Math.ceil(h * 0.75);
  for (let j = iy0; j < iy1; j += 2) for (let i = ix0; i < ix1; i += 2) { const o = (j * w + i) * 3; inn.push(L.rgb[o], L.rgb[o + 1], L.rgb[o + 2]); }
  const dist = (o, arr) => { let bd = 1e9; for (let t = 0; t < arr.length; t += 3) { const d = Math.max(Math.abs(L.rgb[o] - arr[t]), Math.abs(L.rgb[o + 1] - arr[t + 1]), Math.abs(L.rgb[o + 2] - arr[t + 2])); if (d < bd) bd = d; } return bd; };
  const like = new Uint8Array(w * h), cap = Math.max(3, Math.round(Math.min(w, h) * 0.22));
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const dl = i, dr = w - 1 - i, dt = j, db = h - 1 - j, dm = Math.min(dl, dr, dt, db); if (dm > cap) continue;
    const k = dm === dl ? 0 : dm === dr ? 1 : dm === dt ? 2 : 3, sm = side[k]; if (sm.length < 12) continue;
    const o = (j * w + i) * 3, db0 = dist(o, sm);
    if (db0 < tol && db0 + 6 < dist(o, inn)) like[j * w + i] = 1; // דומה לרקע שבצד הזה, ורחוק יותר מתוכן התג עצמו
  }
  const out = new Uint8Array(w * h), st = [];
  const push = (i, j) => { const k = j * w + i; if (like[k] && !out[k]) { out[k] = 1; st.push(k); } };
  for (let i = 0; i < w; i++) { push(i, 0); push(i, h - 1); } for (let j = 0; j < h; j++) { push(0, j); push(w - 1, j); }
  while (st.length) { const k = st.pop(), i = k % w, j = (k / w) | 0; if (i > 0) push(i - 1, j); if (i < w - 1) push(i + 1, j); if (j > 0) push(i, j - 1); if (j < h - 1) push(i, j + 1); }
  let n = 0; for (let k = 0; k < w * h; k++) n += out[k];
  if (n > 0.4 * w * h || n < 6) return;
  const f = new Float32Array(w * h); for (let k = 0; k < w * h; k++) f[k] = out[k];
  const sm = new Float32Array(w * h); // מרככים את המסכה (קצה אנטי-אליאס); בלי הרחבה כדי לא לאכול את התג
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { let t = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const xx = clp(i + di, 0, w - 1), yy = clp(j + dj, 0, h - 1); t += f[yy * w + xx]; } sm[j * w + i] = t / 9; }
  for (let k = 0; k < w * h; k++) a[k] *= 1 - sm[k];
}
// שכבה מתוך מט מוכן (e.matte, ראה public/matte.js): חיתוך הדוק לצורה, בלי מלבן הרקע
function matteLayer(clean, e) {
  const m = e.matte, W = clean.w, H = clean.h; if (!m || !m.a || m.a.length !== m.w * m.h) return null;
  let x0 = m.w, y0 = m.h, x1 = -1, y1 = -1;
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) if (m.a[j * m.w + i] > 40) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
  if (x1 - x0 < 8 || y1 - y0 < 8) return null;
  const X = clp(m.x0 + x0 - 1, 0, W - 4), Y = clp(m.y0 + y0 - 1, 0, H - 4), w = Math.min(x1 - x0 + 3, W - X), h = Math.min(y1 - y0 + 3, H - Y);
  const crop = cropImg(clean, X, Y, X + w, Y + h), a = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const mx = X + i - m.x0, my = Y + j - m.y0;
    a[j * w + i] = mx >= 0 && my >= 0 && mx < m.w && my < m.h ? m.a[my * m.w + mx] / 255 : 0;
  }
  decontaminate(crop.d, a, w, h);
  return { rgb: crop.d, a, lw: w, lh: h, up: 1, x: X, y: Y, w, h, rectHero: false, matted: true };
}

// ---- תמונה ראשית (hero): חיתוך "cover" לחלון עם הכי הרבה פרטים, והצמדה לקצה הקנבס בלי הילה רכה
// אנרגיית קצוות (אינטגרל) של השכבה, נשמרת על השכבה
function heroEnergy(L) {
  if (L._en) return L._en;
  const w = L.lw, h = L.lh, lum = new Float32Array(w * h), I = new Float64Array((w + 1) * (h + 1));
  for (let i = 0; i < w * h; i++) lum[i] = 0.299 * L.rgb[i * 3] + 0.587 * L.rgb[i * 3 + 1] + 0.114 * L.rgb[i * 3 + 2];
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const e = (i < w - 1 ? Math.abs(lum[j * w + i + 1] - lum[j * w + i]) : 0) + (j < h - 1 ? Math.abs(lum[(j + 1) * w + i] - lum[j * w + i]) : 0);
    I[(j + 1) * (w + 1) + i + 1] = e + I[j * (w + 1) + i + 1] + I[(j + 1) * (w + 1) + i] - I[j * (w + 1) + i];
  }
  return (L._en = { I, w, h });
}
// החלון [x,y,w,h] (בפיקסלי השכבה) בעל יחס tw:th שמכיל הכי הרבה אנרגיית קצוות; מחזיר גם איזה חלק מהשטח נשאר
function heroWindow(L, tw, th) {
  const a = tw / th, cw = Math.min(L.lw, Math.floor(L.lh * a)), ch = Math.min(L.lh, Math.floor(cw / a)), { I, w } = heroEnergy(L);
  const sum = (x, y) => I[(y + ch) * (w + 1) + x + cw] - I[y * (w + 1) + x + cw] - I[(y + ch) * (w + 1) + x] + I[y * (w + 1) + x];
  let best = null; const sx = Math.max(1, Math.floor((L.lw - cw) / 40)), sy = Math.max(1, Math.floor((L.lh - ch) / 40));
  for (let y = 0; y <= L.lh - ch; y += sy) for (let x = 0; x <= L.lw - cw; x += sx) { const v = sum(x, y); if (!best || v > best.v) best = { v, x, y }; }
  return { x: best.x, y: best.y, w: cw, h: ch, kept: (cw * ch) / (L.lw * L.lh) };
}
// שכבת hero חדשה מחלון חיתוך. bleed = הצדדים שנוגעים בקצה הקנבס (אלפא מלא); בשאר הצדדים שוליים חדים (פיזור קטן)
function heroVariant(hero, win, bleed) {
  const kid = hero.kids[0], L = kid.layer, { x: wx, y: wy, w, h } = win, rgb = new Float32Array(w * h * 3), a = new Float32Array(w * h), f = Math.max(4, 0.08 * Math.min(w, h)); // צדדים שלא נוגעים בקצה: שוליים רכים ~8% מהצלע הקצרה (smoothstep), לא קו חד
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const si = (wy + j) * L.lw + wx + i, di = j * w + i;
    rgb[di * 3] = L.rgb[si * 3]; rgb[di * 3 + 1] = L.rgb[si * 3 + 1]; rgb[di * 3 + 2] = L.rgb[si * 3 + 2];
    let v = 1;
    if (!bleed.l) v = Math.min(v, (i + 0.5) / f); if (!bleed.r) v = Math.min(v, (w - i - 0.5) / f);
    if (!bleed.t) v = Math.min(v, (j + 0.5) / f); if (!bleed.b) v = Math.min(v, (h - j - 0.5) / f);
    a[di] = softEdge(v);
  }
  return { ...hero, kids: [{ ...kid, layer: { ...L, rgb, a, lw: w, lh: h, w, h, x: 0, y: 0, _en: null, _uni: null }, x: 0, y: 0, w, h }], x: 0, y: 0, w, h, rel: null };
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
  const lineGap = Math.min(bandH * 0.22, Math.max(bandH * 0.08, lgs.length ? lgs[lgs.length >> 1] : bandH * 0.15)), pitch = bandH + lineGap;
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
      let extra = 0; if (P > 1 && k > P) for (let i = 0; i < k - 1; i++) if (words[acc[i][1]].ph !== words[acc[i][1] - 1].ph) extra += bandH * 0.1;
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
    if (li > 0 && P > 1 && best.acc.length > P && words[s].ph !== words[s - 1].ph) y += bandH * 0.1;
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
  const FLOW = ['headline', 'subheadline', 'body'];
  const extras = u.kids.filter(k => !(k.text && FLOW.includes(k.role)) && ['badge', 'button', 'logo', 'caption'].includes(k.role));
  if (extras.length + u.kids.filter(k => k.text && FLOW.includes(k.role)).length !== u.kids.length) return u; // סוג אלמנט לא מוכר: משאירים כמו שהוא
  const heads = u.kids.filter(k => (k.role === 'headline' || ((k.role === 'subheadline' || k.role === 'body') && W / H < 1.15)) && wordsOf(k)); if (!heads.length) return u;
  const m = Math.min(W, H) * 0.07, wide = box ? box[2] / box[3] >= 1.6 : W / H >= 1.6;
  const bw = box ? box[2] : wide ? W * 0.46 : W - 2 * m, bh0 = box ? box[3] * (u.kids.length > 1 ? 0.85 : 1) : (wide ? (H - 2 * m) * 0.8 : H * (W / H < 0.5 ? 0.4 : 0.42)) * (u.kids.length > 1 ? 0.85 : 1);
  if (extras.length && !u.kids.some(k => k.role === 'headline')) return u; // רק יחידות עם כותרת (גוף טקסט עם כיתוב קטן נשאר כמו שהיה)
  if (extras.length && wide) return u; // יחידה עם תג/כפתור בבאנר רחב: הסידור המקורי (שתי שורות כותרת) טוב יותר משורה אחת ארוכה
  const orig = u.kids.slice().sort((p, q) => p.y - q.y);
  const exH = extras.reduce((a, k) => a + k.h, 0);
  let kids = orig, sHead = 0;
  for (let pass = 0; pass < (extras.length ? 2 : 1); pass++) { // תג/כפתור/לוגו נשארים במחסנית: מורידים את גובהם (בקנה המידה של הכותרת) מתקציב הכותרת
    const bh = Math.max(bh0 * 0.35, bh0 - exH * sHead);
    kids = orig.map(k => {
      if (!heads.includes(k)) return k;
      const L2 = reflowLeaf(k, bw, k.role === 'headline' ? bh : k.role === 'body' ? H * 0.3 : H * 0.16, wide ? 0.09 : W / H < 0.5 ? 0.07 : 0); if (!L2) return k;
      if (k.role === 'headline') sHead = L2.s;
      return { ...k, layer: L2, w: L2.lw / L2.up, h: L2.lh / L2.up, reflowed: true };
    });
  }
  if (kids.every((k, i) => k === orig[i])) return u;
  const uw = Math.max(...kids.map(k => k.w)), rel = new Map(); let y = 0;
  kids.forEach((k, i) => { if (i > 0) { const mh = Math.min(k.h, kids[i - 1].h), og = Math.max(0, orig[i].y - (orig[i - 1].y + orig[i - 1].h)); y += Math.max(0.2 * mh, Math.min(og, 0.35 * mh)); } rel.set(k, [(uw - k.w) / 2, y]); y += k.h; });
  return { ...u, kids, w: uw, h: y, rel, pin: null, reflowed: true };
}

// ---------------------------------------------------------------- סצנה
// ---------------------------------------------------------------- לוח מאחורי טקסט (כרטיס)
// טקסט שיושב על לוח מובחן (אזור חלק/מבריק בצבע דומיננטי אחד, עם שפה או מסגרת, גדול מתיבת הטקסט) נחשב יחד עם הלוח ליחידה גרפית אחת:
// מוסיפים אלמנט shape:'panel' שנחתך מהרקע הנקי (אחרי הוצאת הטקסט) ומקבצים אליו את הטקסטים - הכרטיס כולו מסודר ומוגדל כאחד.
// בכל ספק (טקסט על תמונה, רקע אחיד לכל הקנבס, אין שפה ברורה בכל ארבע הצלעות) לא מחזיר כלום.
function detectPanels(img, els) {
  const W = img.w, H = img.h, D = img.d, out = [];
  const tx = els.filter(e => e.text && e.role !== 'button' && ['headline', 'subheadline', 'body', 'caption', 'label'].includes(e.role));
  const solids = els.filter(e => !e.text && ['button', 'badge', 'logo', 'photo', 'decor'].includes(e.role));
  const inside = (e, o) => { const cx = e.px[0] + e.px[2] / 2, cy = e.px[1] + e.px[3] / 2; return cx > o.px[0] && cx < o.px[0] + o.px[2] && cy > o.px[1] && cy < o.px[1] + o.px[3]; };
  const cand = tx.filter(e => !solids.some(o => inside(e, o) && o.px[2] * o.px[3] >= 0.8 * e.px[2] * e.px[3]));
  const par = cand.map((_, i) => i), find = i => par[i] === i ? i : (par[i] = find(par[i]));
  for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) { // תיבות צמודות = אותה כותרת
    const a = cand[i].px, b = cand[j].px;
    const ix = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]), gy = Math.max(a[1], b[1]) - Math.min(a[1] + a[3], b[1] + b[3]);
    if (ix > 0.3 * Math.min(a[2], b[2]) && gy < 0.8 * Math.min(a[3], b[3])) par[find(i)] = find(j);
  }
  const clusters = new Map(); cand.forEach((e, i) => { const r = find(i); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(e); });
  const taken = new Set(), dist = (o, c) => Math.max(Math.abs(D[o] - c[0]), Math.abs(D[o + 1] - c[1]), Math.abs(D[o + 2] - c[2]));
  const qk = o => (D[o] >> 5) * 64 + (D[o + 1] >> 5) * 8 + (D[o + 2] >> 5);
  for (const ms of [...clusters.values()].sort((a, b) => b.length - a.length)) {
    if (ms.every(m => taken.has(m))) continue;
    const big = ms.slice().sort((a, b) => b.px[2] * b.px[3] - a.px[2] * a.px[3])[0];
    const ub = [Math.min(...ms.map(m => m.px[0])), Math.min(...ms.map(m => m.px[1])), Math.max(...ms.map(m => m.px[0] + m.px[2])), Math.max(...ms.map(m => m.px[1] + m.px[3]))];
    const uw = ub[2] - ub[0], uh = ub[3] - ub[1];
    if (uw < 24 || uh < 12) continue;
    const [bx, by, bw, bh] = big.px, hist = new Map();
    const ring = []; // היקף התיבה (2 פיקסלים משני צדי הקו): הלוח, ולא האותיות שבפנים
    for (let x = bx; x < bx + bw; x++) for (const y of [by - 2, by - 1, by, by + 1, by + bh - 2, by + bh - 1, by + bh, by + bh + 1]) ring.push([x, y]);
    for (let y = by; y < by + bh; y++) for (const x of [bx - 2, bx - 1, bx, bx + 1, bx + bw - 2, bx + bw - 1, bx + bw, bx + bw + 1]) ring.push([x, y]);
    const rg = ring.filter(([x, y]) => x >= 0 && y >= 0 && x < W && y < H);
    for (const [x, y] of rg) { const k = qk((y * W + x) * 3); hist.set(k, (hist.get(k) || 0) + 1); }
    let bk = -1, bn = 0, tot = 0; for (const [k, n] of hist) { tot += n; if (n > bn) { bn = n; bk = k; } }
    if (bn < 0.45 * tot) continue; // אין צבע דומיננטי: טקסט על תמונה
    const P = [0, 0, 0]; let np = 0; const T = 46;
    for (const [x, y] of rg) { const o = (y * W + x) * 3; if (qk(o) === bk) { P[0] += D[o]; P[1] += D[o + 1]; P[2] += D[o + 2]; np++; } }
    for (let c = 0; c < 3; c++) P[c] /= np;
    const neutral = new Uint8Array(W * H); // בתוך תיבות הטקסט: לא נספר (אותיות, וגם סרט שבולט מהלוח)
    for (const m of ms) { // תיבות ה-AI לא מדויקות לפיקסל: מרחיבים קצת
      const dm = Math.max(3, Math.round(0.04 * Math.max(m.px[2], m.px[3]))), nx1 = Math.max(0, m.px[0] - dm), nx2 = Math.min(W, m.px[0] + m.px[2] + dm);
      for (let y = Math.max(0, m.px[1] - dm); y < Math.min(H, m.px[1] + m.px[3] + dm); y++) neutral.fill(1, y * W + nx1, y * W + nx2);
    }
    const r = [bx, by, bx + bw, by + bh], cap = Math.max(60, Math.round(0.5 * Math.max(uw, uh))), stop = [0, 0, 0, 0];
    // פס באורך הצלע במרחק k החוצה: n פיקסלים נספרים, g מהם בצבע הלוח, mean = ממוצע הצבע של כולם
    const stripe = (s, k) => {
      const horiz = s === 0 || s === 2, a0 = horiz ? r[0] : r[1], a1 = horiz ? r[2] : r[3];
      const fixed = s === 0 ? r[1] - 1 - k : s === 1 ? r[0] - 1 - k : s === 2 ? r[3] + k : r[2] + k;
      if (fixed < 0 || fixed >= (horiz ? H : W)) return null;
      let n = 0, g = 0; const m = [0, 0, 0];
      for (let t = Math.max(0, a0); t < Math.min(horiz ? W : H, a1); t++) {
        const x = horiz ? t : fixed, y = horiz ? fixed : t; if (neutral[y * W + x]) continue;
        const p = (y * W + x) * 3; n++; if (dist(p, P) < T) g++; m[0] += D[p]; m[1] += D[p + 1]; m[2] += D[p + 2];
      }
      return { n, g, mean: n ? m.map(v => v / n) : P };
    };
    const good = st => !st || st.n < 6 || st.g >= 0.6 * st.n, step = (s, d) => { if (s === 0) r[1] -= d; else if (s === 1) r[0] -= d; else if (s === 2) r[3] += d; else r[2] += d; };
    const grown = [0, 0, 0, 0]; // 1=נמצאה שפה, 2=קצה קנבס, 3=לא נמצאה שפה בטווח
    for (let pass = 0; pass < 3; pass++) {
      for (let s = 0; s < 4; s++) {
        let cnt = 0; stop[s] = 0;
        for (;;) {
          if (cnt > cap) { stop[s] = 3; break; }
          const s0 = stripe(s, 0); if (!s0) { stop[s] = 2; break; }
          if (!good(s0)) { const s1 = stripe(s, 1); if (!s1) { stop[s] = 2; break; } if (!good(s1)) { stop[s] = 1; break; } step(s, 1); cnt++; grown[s]++; }
          step(s, 1); cnt++; grown[s]++;
        }
      }
      if (stop.every(v => v === 1)) break;
    }
    if (!stop.every(v => v === 1)) continue;
    if (grown.filter(v => v >= 3).length < 2) continue;
    // שפה/מסגרת: פסים דקים אחידים בצבע אחר, ואחריהם צבע שונה. אם "השפה" לא נגמרת מהר היא בעצם הרקע
    const bmax = Math.max(4, Math.round(0.035 * Math.min(r[2] - r[0], r[3] - r[1]))), thick = [0, 0, 0, 0], bcol = [];
    for (let s = 0; s < 4; s++) {
      const a = stripe(s, 0), b = stripe(s, 1); if (!a || !b) continue;
      const B = [0, 1, 2].map(c => (a.mean[c] + b.mean[c]) / 2); let k = 0;
      for (; k < bmax + 2; k++) {
        const st = stripe(s, k); if (!st) break;
        const h2 = (() => { // אחוז הפסים הקרוב לצבע השפה (לא נספר נייטרלי)
          const horiz = s === 0 || s === 2, a0 = horiz ? r[0] : r[1], a1 = horiz ? r[2] : r[3], fixed = s === 0 ? r[1] - 1 - k : s === 1 ? r[0] - 1 - k : s === 2 ? r[3] + k : r[2] + k;
          let n = 0, g = 0; for (let t = Math.max(0, a0); t < Math.min(horiz ? W : H, a1); t++) { const x = horiz ? t : fixed, y = horiz ? fixed : t; if (neutral[y * W + x]) continue; n++; if (dist((y * W + x) * 3, B) < 60) g++; }
          return n ? g / n : 0;
        })();
        if (h2 < 0.55) break;
      }
      thick[s] = k <= bmax ? k : 0; if (thick[s] > 0) bcol.push(B);
    }
    const R = [r[0] - thick[1], r[1] - thick[0], r[2] + thick[3], r[3] + thick[2]];
    if (R[0] < 0 || R[1] < 0 || R[2] > W || R[3] > H) continue;
    const rw = R[2] - R[0], rh = R[3] - R[1];
    if (rw * rh < 1.08 * uw * uh || rw * rh > 0.65 * W * H || rw > 0.97 * W && rh > 0.5 * H) continue;
    // הלוח חלק: רוב הפיקסלים (בלי תיבות הטקסט) בצבע הלוח
    let n = 0, g = 0; for (let y = r[1]; y < r[3]; y += 2) for (let x = r[0]; x < r[2]; x += 2) { if (neutral[y * W + x]) continue; n++; if (dist((y * W + x) * 3, P) < T) g++; }
    if (!n || g < 0.6 * n) continue;
    // ניגוד לרקע שמחוץ ללוח: הצבע שמעבר לשפה שונה מצבע הלוח לפחות בשלוש צלעות
    let far = 0; for (let s = 0; s < 4; s++) { const sv = [...r]; for (let q = 0; q < 4; q++) sv[q] = R[q]; const keep = r.slice(); for (let q = 0; q < 4; q++) r[q] = R[q]; const st = stripe(s, 2); for (let q = 0; q < 4; q++) r[q] = keep[q]; if (st && Math.max(Math.abs(st.mean[0] - P[0]), Math.abs(st.mean[1] - P[1]), Math.abs(st.mean[2] - P[2])) > 30) far++; }
    if (far < 3) continue;
    // רדיוס פינות: סריקה באלכסון מכל פינה עד הפיקסל הראשון שהוא לוח/שפה; offset ≈ 0.293·r
    const inP = (x, y) => { const o = (y * W + x) * 3; return dist(o, P) < T + 10 || bcol.some(B => dist(o, B) < 60); };
    const offs = [[R[0], R[1], 1, 1], [R[2] - 1, R[1], -1, 1], [R[0], R[3] - 1, 1, -1], [R[2] - 1, R[3] - 1, -1, -1]].map(([cx, cy, dx, dy]) => { let k = 0; while (k < 0.35 * Math.min(rw, rh) && !inP(cx + dx * k, cy + dy * k)) k++; return k; }).sort((a, b) => a - b);
    const radius = clp(Math.round(((offs[1] + offs[2]) / 2) / 0.293), 0, Math.floor(0.3 * Math.min(rw, rh)));
    const members = cand.filter(e => !taken.has(e) && inside(e, { px: [R[0], R[1], rw, rh] }));
    if (!members.length) continue;
    members.forEach(m => taken.add(m));
    out.push({ rect: [R[0], R[1], rw, rh], inner: r.slice(), radius, members, P });
  }
  return out;
}
// מוסיף אלמנט לוח לכל לוח שזוהה ומקבץ אליו את הטקסטים (לפני חיתוך הטקסט)
function addPanels(img, els) {
  let ps = []; try { ps = detectPanels(img, els); } catch (err) { ps = []; }
  ps.forEach((p, i) => {
    const gid = 'panel_' + i, z = Math.min(...p.members.map(m => m.z)) - 0.5;
    els.push({ id: gid, role: 'decor', lines: [], text: false, shape: 'panel', radius: p.radius, group: gid, px: p.rect, z, bullet: null, phrases: null, panel: true });
    p.members.forEach(m => { // חותכים את תיבת הטקסט לתוך הלוח (בלי השפה), כדי שהחיתוך לא ייקח חתיכות מסגרת כאילו הן אותיות. תיבה שחוצה את הקצה (סרט שבולט) לא נחתכת בצד הזה
      m.group = gid; const [x, y, w, h] = m.px, [ix1, iy1, ix2, iy2] = p.inner.map((v, k) => v + (k < 2 ? 2 : -2));
      const nx1 = x >= p.inner[0] ? Math.max(x, ix1) : x, ny1 = y >= p.inner[1] ? Math.max(y, iy1) : y, nx2 = x + w <= p.inner[2] ? Math.min(x + w, ix2) : x + w, ny2 = y + h <= p.inner[3] ? Math.min(y + h, iy2) : y + h;
      if (nx2 - nx1 >= 4 && ny2 - ny1 >= 4) m.px = [nx1, ny1, nx2 - nx1, ny2 - ny1];
      const g = Math.round(0.12 * Math.max(w, h) + 6); m.panelAllow = [[Math.max(ix1, x - g), Math.max(iy1, y - g), Math.min(ix2, x + w + g), Math.min(iy2, y + h + g)], [x - 3, y - 3, x + w + 3, y + h + 3]]; // מותר: פנים הלוח + התיבה המקורית (סרט שבולט)
    });
  });
  return ps.length;
}

// מאפס אלפא של שכבה מחוץ לאזורים המותרים וחותך אותה לתיבה הצמודה. מחזיר null אם לא נשאר כלום
function clipLayerTo(L, allow) {
  const { lw, lh, up } = L, a = L.a; let i0 = lw, i1 = -1, j0 = lh, j1 = -1;
  for (let j = 0; j < lh; j++) {
    const Y = L.y + (j + 0.5) / up;
    for (let i = 0; i < lw; i++) {
      const X = L.x + (i + 0.5) / up, k = j * lw + i; if (a[k] <= 0) continue;
      if (!allow.some(r => X >= r[0] && X < r[2] && Y >= r[1] && Y < r[3])) { a[k] = 0; continue; }
      if (a[k] > 0.02) { if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j; }
    }
  }
  if (i1 < 0) return null;
  i0 = Math.floor(i0 / up) * up; j0 = Math.floor(j0 / up) * up; i1 = Math.min(lw, Math.ceil((i1 + 1) / up) * up); j1 = Math.min(lh, Math.ceil((j1 + 1) / up) * up);
  const nw = i1 - i0, nh = j1 - j0, rgb = new Float32Array(nw * nh * 3), na = new Float32Array(nw * nh);
  for (let j = 0; j < nh; j++) for (let i = 0; i < nw; i++) { const s = (j + j0) * lw + i + i0, d = j * nw + i; na[d] = a[s]; rgb[d * 3] = L.rgb[s * 3]; rgb[d * 3 + 1] = L.rgb[s * 3 + 1]; rgb[d * 3 + 2] = L.rgb[s * 3 + 2]; }
  return { ...L, rgb, a: na, lw: nw, lh: nh, x: L.x + i0 / up, y: L.y + j0 / up, w: nw / up, h: nh / up };
}
// רקע נקי לשכבת הלוח: ממלאים את חורי הטקסט רק מתוך פנים הלוח (לא מהתמונה שמחוצה לו), כדי שהסרט שחוצה את השפה לא ישאיר שם צבעי רקע
function panelClean(clean, img, holes, e, inner) {
  const [x0, y0, x1, y1] = e.px[0] === undefined ? inner : [e.px[0], e.px[1], e.px[0] + e.px[2], e.px[1] + e.px[3]];
  const W = img.w, cw = x1 - x0, ch = y1 - y0, crop = cropImg(img, x0, y0, x1, y1), hc = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (holes[(y + y0) * W + x + x0]) hc[y * cw + x] = 1;
  const f = msFill(crop, hc), out = { w: clean.w, h: clean.h, c: 3, d: clean.d.slice() };
  for (let y = 0; y < ch; y++) out.d.set(f.d.subarray(y * cw * 3, (y + 1) * cw * 3), ((y + y0) * W + x0) * 3);
  for (let i = 0; i < out.d.length; i++) out.d[i] = clp(out.d[i], 0, 255);
  return out;
}

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
    els.push({ id: e.id || 'e' + i, role, lines, text: isText, shape, group: role === 'hero' ? null : (e.group || null), px: [x1, y1, x2 - x1, y2 - y1], z: i, bullet: e.bullet || null, phrases: e.phrases || null, matte: e.matte || null });
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
  { // תיבת כיתוב שנכנסת לתוך לוגו/תמונה/תג (למשל כתובת שה-AI תפס יחד עם שולי הלוגו): חותכים את החלק החופף כדי שלא ייגרר חלק מהלוגו
    const solid = els.filter(p => !p.text && ['logo', 'photo', 'badge'].includes(p.role));
    for (const c of els) {
      if (!c.text || !['caption', 'body', 'label', 'subheadline'].includes(c.role)) continue;
      for (const p of solid) {
        const [cx, cy, cw, ch] = c.px, [px, py, pw, ph] = p.px;
        const ix = Math.min(cx + cw, px + pw) - Math.max(cx, px), iy = Math.min(cy + ch, py + ph) - Math.max(cy, py);
        if (ix <= 0 || iy <= 0 || ix * iy < 0.12 * cw * ch || ix < 0.5 * Math.min(cw, pw)) continue;
        if (py <= cy + 0.25 * ch && py + ph < cy + ch && ch - (py + ph - cy) >= 0.3 * ch) { c.px = [cx, py + ph, cw, cy + ch - (py + ph)]; } // החפיפה בחלק העליון
        else if (py + ph >= cy + ch - 0.25 * ch && py > cy && py - cy >= 0.3 * ch) { c.px = [cx, cy, cw, py - cy]; } // בחלק התחתון
      }
    }
  }
  { // כיתוב מתחת לתמונה שה-AI תפס רק בחלקו: מרחיבים את התיבה לכל רוחב העמודה של התמונה ומטה, כדי שלא יחתכו מילים וישארו שאריות
    const photos = els.filter(p => !p.text && (p.role === 'photo' || (p.shape === 'circle' && p.role !== 'logo' && p.role !== 'badge')));
    for (const c of els) {
      if (c.role !== 'caption' || !c.text || !photos.length || c.group === 'none') continue;
      const cx = c.px[0] + c.px[2] / 2; let best = null, bd = 1e9;
      for (const p of photos) {
        const pcx = p.px[0] + p.px[2] / 2, pb = p.px[1] + p.px[3];
        if (c.px[1] + c.px[3] < pb - 2) continue;
        const dx = Math.abs(cx - pcx), dy = c.px[1] - pb;
        if (dx > 1.3 * Math.max(p.px[2], 40) || dy > 3.5 * p.px[2]) continue;
        const d = dx + Math.max(0, dy); if (d < bd) { bd = d; best = p; }
      }
      if (!best) continue;
      const bcx = best.px[0] + best.px[2] / 2, bcy = best.px[1] + best.px[3] / 2, pb = best.px[1] + best.px[3];
      let pitch = 2.4 * best.px[2];
      for (const p of photos) if (p !== best && Math.abs(p.px[1] + p.px[3] / 2 - bcy) < 0.6 * best.px[3]) pitch = Math.min(pitch, Math.abs(p.px[0] + p.px[2] / 2 - bcx));
      const half = Math.max(c.px[2] / 2, 0.6 * pitch - 2);
      let y1 = Math.min(c.px[1], pb + 1), y2 = Math.max(c.px[1] + c.px[3], pb + 1 + 0.7 * best.px[2]);
      let nx1 = Math.max(0, Math.round(bcx - half)), nx2 = Math.min(W, Math.round(bcx + half));
      for (const o of els) { if (o === c || o === best || photos.includes(o)) continue; const ox1 = o.px[0], ox2 = o.px[0] + o.px[2]; if (ox2 > nx1 && ox1 < nx2 && o.px[1] > pb && o.px[1] < y2 && o.px[1] > c.px[1]) y2 = Math.max(c.px[1] + c.px[3], o.px[1] - 1); }
      for (const o of els) { // אלמנט אחר שחופף לתיבה המורחבת: מצמצמים לצד של הכיתוב המקורי
        if (o === c || o === best || photos.includes(o) || o.role === 'caption') continue;
        const ox1 = o.px[0], ox2 = o.px[0] + o.px[2], oy1 = o.px[1], oy2 = o.px[1] + o.px[3];
        if (ox2 <= nx1 || ox1 >= nx2 || oy2 <= y1 || oy1 >= y2) continue;
        if ((ox1 + ox2) / 2 < cx) nx1 = Math.max(nx1, ox2 + 1); else nx2 = Math.min(nx2, ox1 - 1);
      }
      if (nx2 - nx1 < 8) continue;
      y1 = clp(Math.round(y1), 0, H - 4); y2 = clp(Math.round(y2), y1 + 4, H);
      c._col = { photo: best, nx1, nx2, y1, y2, pitch };
      c.px = [nx1, y1, Math.max(4, nx2 - nx1), y2 - y1];
      if (c.lines.length < 2) c.lines = c.lines.length ? c.lines : ['x'];
    }
  }
  { // מחלקים את שורת הכיתובים לפי רווחים אמיתיים בין כיתובים (ולא לפי עמודות התמונות): כיתוב רחב מהעמודה שלו לא נחתך ולא נגרר לשכן
    const cs = els.filter(c => c._col);
    const rows = [];
    for (const c of cs) { const r = rows.find(r => Math.abs(r.y1 - c._col.y1) < 0.5 * c._col.photo.px[2]); if (r) r.cs.push(c); else rows.push({ y1: c._col.y1, cs: [c] }); }
    for (const r of rows) {
      if (r.cs.length < 2) continue;
      const pw = Math.min(...r.cs.map(c => c._col.photo.px[2])), pitch = Math.min(...r.cs.map(c => c._col.pitch));
      const X1 = clp(Math.min(...r.cs.map(c => c._col.photo.px[0])) - Math.round(0.5 * pitch), 0, W - 8), X2 = clp(Math.max(...r.cs.map(c => c._col.photo.px[0] + c._col.photo.px[2])) + Math.round(0.5 * pitch), X1 + 8, W);
      const Y1 = Math.min(...r.cs.map(c => c._col.y1)), Y2 = Math.max(...r.cs.map(c => c._col.y2));
      if (Y2 - Y1 < 6) continue;
      const crop = cropImg(img, X1, Y1, X2, Y2), cw = crop.w, ch = crop.h, bgm = medianBg(crop, 15), df = new Float32Array(cw * ch);
      for (let i = 0; i < cw * ch; i++) df[i] = Math.max(Math.abs(crop.d[i * 3] - bgm.d[i * 3]), Math.abs(crop.d[i * 3 + 1] - bgm.d[i * 3 + 1]), Math.abs(crop.d[i * 3 + 2] - bgm.d[i * 3 + 2]));
      for (const o of els) { // אלמנטים אחרים (כפתור, לוגו…) לא שייכים לכיתובים
        if (o.role === 'caption' || o.role === 'photo' || (!o.text && o.shape === 'circle' && o.role !== 'logo' && o.role !== 'badge')) continue;
        for (let yy = Math.max(0, o.px[1] - Y1 - 1); yy < Math.min(ch, o.px[1] + o.px[3] - Y1 + 1); yy++) for (let xx = Math.max(0, o.px[0] - X1 - 1); xx < Math.min(cw, o.px[0] + o.px[2] - X1 + 1); xx++) df[yy * cw + xx] = 0;
      }
      const p98 = percentile(Array.from(df), 98), thr = Math.max(30, 0.3 * p98), colInk = new Int32Array(cw), rowInk = new Int32Array(ch);
      for (let yy = 0; yy < ch; yy++) for (let xx = 0; xx < cw; xx++) if (df[yy * cw + xx] > thr) { colInk[xx]++; rowInk[yy]++; }
      const gmin = Math.max(4, Math.round(0.17 * pw)), segs = []; let st = -1, last = -1;
      for (let xx = 0; xx < cw; xx++) if (colInk[xx] > 0) { if (st < 0) st = xx; else if (xx - last > gmin) { segs.push([st, last]); st = xx; } last = xx; }
      if (st >= 0) segs.push([st, last]);
      const asg = new Map();
      for (const sg of segs) {
        if (sg[1] - sg[0] < 3) continue;
        const mid = X1 + (sg[0] + sg[1]) / 2; let bc = null, bd = 1e9;
        for (const c of r.cs) { const d = Math.abs(c._col.photo.px[0] + c._col.photo.px[2] / 2 - mid); if (d < bd) { bd = d; bc = c; } }
        const a0 = asg.get(bc); if (a0) { a0[0] = Math.min(a0[0], sg[0]); a0[1] = Math.max(a0[1], sg[1]); } else asg.set(bc, [sg[0], sg[1]]);
      }
      for (const [c, [sx1, sx2]] of asg) {
        let ry1 = -1, ry2 = -1; for (let yy = 0; yy < ch; yy++) { let n = 0; for (let xx = sx1; xx <= sx2; xx++) if (df[yy * cw + xx] > thr) n++; if (n > 0) { if (ry1 < 0) ry1 = yy; ry2 = yy; } }
        if (ry1 < 0) continue;
        const bx1 = clp(X1 + sx1 - 2, 0, W - 4), bx2 = clp(X1 + sx2 + 3, bx1 + 4, W), by1 = clp(Y1 + ry1 - 2, 0, H - 4), by2 = clp(Y1 + ry2 + 3, by1 + 4, H);
        c.px = [bx1, by1, bx2 - bx1, by2 - by1];
      }
    }
  }
  addPanels(img, els); // טקסט על לוח מובחן: הלוח + הטקסט = כרטיס אחד
  const leaves = [], holes = new Uint8Array(W * H);
  tell('חותך את הטקסטים…');
  for (const e of els) {
    if (!e.text) continue;
    const others = els.filter(o => o !== e).map(o => {
      if (o.text && e.role === 'headline' && o.role === 'headline') return Object.assign(o.px.slice(), { clip: true }); // כותרת שנחתכה לשתי תיבות: החלון של כל אחת לא נכנס לשכנה
      if (o.text || !['badge', 'logo', 'photo', 'button'].includes(o.role)) return o.px;
      const [ox, oy, ow, oh] = o.px, [ex0, ey0, ew, eh] = e.px; // תג/לוגו שיושב בתוך תיבת הטקסט: לא לקחת את הפיקסלים שלו כאותיות
      const ix = Math.min(ox + ow, ex0 + ew) - Math.max(ox, ex0), iy = Math.min(oy + oh, ey0 + eh) - Math.max(oy, ey0);
      return ix > 0 && iy > 0 && ix * iy > 0.6 * ow * oh && ow * oh < 0.5 * ew * eh ? Object.assign(o.px.slice(), { solid: true }) : o.px;
    });
    let L = textLayer(img, e.px, e.role === 'button' ? 2 : Math.max(1, e.lines.length), 4, e.role === 'button', !!e.bullet, holes, others, { side: ['caption', 'body', 'subheadline'].includes(e.role), below: ['caption', 'body', 'subheadline'].includes(e.role) && e.lines.length > 1 });
    if (!L) continue;
    if (e.panelAllow) { L = clipLayerTo(L, e.panelAllow); if (!L) continue; }
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
    const L = graphicLayer(e.panel ? panelClean(clean, img, holes, e) : clean, e, grad);
    if (!L) continue;
    e.layer = L;
    if (['decor', 'badge'].includes(e.role) && !e.panel && L.w * L.h > 900) { // לוח צבע אחיד מאחורי טקסט: אפשר למתוח אותו מחדש לפי הטקסט
      let r0 = 0, g0 = 0, b0 = 0, n0 = 0, q = 0;
      const mx = Math.max(2, Math.floor(Math.min(L.w, L.h) * 0.08));
      for (let j = mx; j < L.h - mx; j += 2) for (let i = mx; i < L.w - mx; i += 2) if (L.a[j * L.w + i] > 0.95) { const o = (j * L.w + i) * 3; r0 += L.rgb[o]; g0 += L.rgb[o + 1]; b0 += L.rgb[o + 2]; n0++; }
      if (n0 > 50) {
        r0 /= n0; g0 /= n0; b0 /= n0;
        for (let j = mx; j < L.h - mx; j += 2) for (let i = mx; i < L.w - mx; i += 2) if (L.a[j * L.w + i] > 0.95) { const o = (j * L.w + i) * 3; q += Math.abs(L.rgb[o] - r0) + Math.abs(L.rgb[o + 1] - g0) + Math.abs(L.rgb[o + 2] - b0); }
        if (q / n0 / 3 < 9) e.solid = [Math.round(r0), Math.round(g0), Math.round(b0)];
      }
    }
    let r = 5; if (['pill', 'rounded', 'rect'].includes(e.shape)) r = Math.floor(Math.min(L.w, L.h) * 0.3); else if (e.shape === 'hero') r = 8; else if (e.panel) r = Math.max(8, Math.round(0.05 * Math.min(L.w, L.h))); // הילה/צל של הלוח מחוץ לשפה: חור הרקע גדול יותר
    const pad = r + 1, mw = L.w + 2 * pad, mh = L.h + 2 * pad, m = new Uint8Array(mw * mh);
    for (let j = 0; j < L.h; j++) for (let i = 0; i < L.w; i++) if (L.a[j * L.w + i] * 255 > 10) m[(j + pad) * mw + i + pad] = 1;
    const dm = dilateDisk(m, mw, mh, r);
    e._hm = { x0: L.x - pad, y0: L.y - pad, mw, mh, dm }; // REFRAME: מסכת החור של היחידה (כדי לבנות רקע בלי חור לגיבור)
    for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) {
      if (!dm[j * mw + i]) continue;
      const gx = L.x - pad + i, gy = L.y - pad + j;
      if (gx >= 0 && gy >= 0 && gx < W && gy < H) holes2[gy * W + gx] = 1;
    }
    leaves.push(e);
  }
  tell('משלים את הרקע…');
  let plate = msFill(clean, holes2, { tex: true });
  plate = softenDenseHoles(plate, holes2, plate.tex);
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
    if (!(lb.role === 'label' || (['caption', 'body', 'subheadline', 'headline'].includes(lb.role) && lb.text))) continue;
    const bt = leaves.find(b => (b.role === 'button' || b.role === 'badge' || (b.role === 'decor' && b.w * b.h < 0.4 * W * H && (lb.role === 'headline' || lb.role === 'subheadline'))) && !b.text && lb.x + lb.w / 2 > b.x && lb.x + lb.w / 2 < b.x + b.w && lb.y + lb.h / 2 > b.y && lb.y + lb.h / 2 < b.y + b.h);
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
  return { W, H, plate, units, leaves, holeRows, holes2, _img: img, _holesT: holes, boxes: leaves.map(e => ({ id: e.id, role: e.role, x: e.x / W, y: e.y / H, w: e.w / W, h: e.h / H })) };
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
  { // כל התמונות בגלריה באותו גודל (הזיהוי נותן לכל עיגול תיבה קצת שונה): מביאים כל כרטיס (תמונה + כיתוב) לקוטר החציוני
    const pw = cards.map(c => c.kids[0].w).sort((a, b) => a - b), tgt = pw[pw.length >> 1];
    for (const c of cards) {
      const p = c.kids[0], f = tgt / p.w; if (Math.abs(f - 1) < 0.01 || f < 0.7 || f > 1.45) continue;
      const ox = p.x + p.w / 2, oy = p.y;
      for (const k of c.kids) { k.x = ox + (k.x - ox) * f; k.y = oy + (k.y - oy) * f; k.w *= f; k.h *= f; }
    }
  }
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
function layoutBase(W, H, units, sw, sh, forceWide) {
  const out = [];
  const heroes = units.filter(u => u.role === 'hero');
  const hero = heroes.length ? heroes.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a)) : null;
  const wideMode = forceWide || W / H >= 1.6;
  let tx = units.filter(u => u !== hero && u.role !== 'hero').sort(wideMode ? ((a, b) => rankOf(a, sh, W / H > 4.2 ? 'strip' : true) - rankOf(b, sh, W / H > 4.2 ? 'strip' : true) || a.y - b.y) : ((a, b) => a.y - b.y));
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
  if (wideMode) { // גלריה בבאנר רחב: אם שורה אחת הופכת את התמונות לעיגולים זעירים, מנסים 2×2 (או חצי-חצי) ובוחרים את מה שנותן תמונות גדולות יותר
    const rtl0 = units.some(u => HEB.test((u.lines || []).join('')));
    const m0 = Math.max(5, H * 0.05), heroW = hero ? hero.w * Math.min((H - m0) / hero.h, W * 0.32 / hero.w, 1.2) + m0 : 0;
    const evalS = list => {
      let best = 0;
      for (const sp of splits(Math.min(list.length, 9), W / H >= 5 ? 9 : 4)) {
        const cols = sp.map(g => ({ w: Math.max(...g.map(i => list[i].w)), h: g.reduce((a, i) => a + list[i].h, 0) }));
        const sv = Math.min((W - 3 * m0 - heroW - (cols.length - 1) * m0 * 1.6) / cols.reduce((a, c) => a + c.w, 0), ...cols.map(c => (H - 2 * m0) / c.h), 1.15);
        if (sv > best) best = sv;
      }
      return best;
    };
    for (const gi of tx.map((u, i) => (u.cards && u.cards.length >= 3 ? i : -1)).filter(i => i >= 0)) {
      const orig = tx[gi], total = orig.cards.length;
      const rowS = evalS(tx), cwMax = Math.max(...orig.cards.map(c => c.w)), small = rowS * cwMax < 0.3 * H; // עיגולים קטנים מ-30% מגובה הבאנר: עדיף 2×2 גדולים
      let pick = { u2: orig, score: rowS * (small ? 0.85 : 1.08) }; // אחרת: שורה, אלא אם 2×2 גדול ב-8% לפחות
      for (const cols of [...new Set([2, Math.ceil(total / 2)])].filter(c => c >= 2 && c < total)) {
        tx[gi] = arrange(orig, cols, rtl0);
        const sc2 = evalS(tx); if (sc2 > pick.score) pick = { u2: tx[gi], score: sc2 };
      }
      tx[gi] = pick.u2;
    }
  }
  let n = tx.length; if (n > 14) { tx = tx.slice(0, 14); n = 14; }
  const gp = tx.map((t, i) => i >= n - 1 ? 0 : Math.min(Math.max(0, tx[i + 1].y - (t.y + t.h)), sh * 0.1));
  const gh = g => g.reduce((s, i) => s + tx[i].h, 0) + g.slice(0, -1).reduce((s, i) => s + gp[i], 0);
  const rtl = units.some(u => HEB.test(u.lines.join('')));
  let gm = 1;
  const put = (g, s, x0, slot, y) => { for (const i of g) { const it = tx[i], bc = !wideMode && (it.role === 'button' || (it.kids.some(k => k.role === 'button') && !it.kids.some(k => k.role === 'headline'))) ? Math.min(1, 0.6 * W / (it.w * s), Math.max(0.1 * H, 28) / (it.h * s)) : 1, b = (it.boost || 1) * bc, w = it.w * s * b, h = it.h * s * b; out.push([it, x0 + (slot - w) / 2, y, w, h]); y += h + gp[i] * s * gm; } };
  if (wideMode) {
    const m = Math.max(5, H * 0.05);
    let ax0 = m * 1.5, ax1 = W - m * 1.5;
    if (hero) {
      const right = hero.x + hero.w / 2 > sw / 2;
      const rect = hero.kids.length === 1 && hero.kids[0].layer && hero.kids[0].layer.rectHero;
      // תמונה שבמקור נוגעת בקצה הבאנר נשארת נוגעת בו (בלי שוליים והילה); אחרת נשארת צפה
      const bSide = rect && (right ? hero.x + hero.w >= sw - 2 : hero.x <= 2), bV = rect && hero.y <= 2 && hero.y + hero.h >= sh - 2;
      const s = Math.min((bV ? H : H - m) / hero.h, W * 0.32 / hero.w, 1.2), hw = hero.w * s, hh = hero.h * s;
      const hx = bSide ? (right ? W - hw : 0) : right ? W - hw - m * 0.3 : m * 0.3, hy = bV ? 0 : (H - hh) / 2;
      const hl = rect ? heroVariant(hero, { x: 0, y: 0, w: hero.kids[0].layer.lw, h: hero.kids[0].layer.lh }, { l: bSide && !right, r: bSide && right, t: bV, b: bV }) : hero;
      out.push([hl, hx, hy, hw, hh]);
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
      let best = null; const cands = [];
      for (const fr of (hero ? (H / W > 1.5 ? [0.36, 0.3, 0.24] : [0.42, 0.34, 0.26]) : [0])) {
        let hs = hero ? Math.min(fr * H / hero.h, aw / hero.w, 1.2) : 0, hh = hero ? hero.h * hs : 0, hb = null;
        if (hero && hero.kids.length === 1 && hero.kids[0].layer && hero.kids[0].layer.rectHero) { // cover + bleed: רוחב מלא, גובה fr*H, חלון עם הכי הרבה פרטים; אם חותך יותר מדי מהתמונה – נשארים עם contain
          const tH = fr * H, win = heroWindow(hero.kids[0].layer, W, tH), sc = W / win.w;
          if (win.kept >= 0.45 && sc <= 1.6 && sc >= 0.2) { hb = { win, sc }; hh = tH; hs = Math.max(sc, hs); }
        }
        const th = H - (hb ? m : 2 * m) - hh - (hero ? vg * 2 : 0), s = Math.min(aw / mw, th / tH, 1.15);
        const score = hero ? Math.min(s, hs) : s;
        cands.push([score, hs, hh, s, th, hb]);
        if (!best || score > best[0]) best = [score, hs, hh, s, th, hb];
      }
      // תמונה גדולה מועדפת: הגדולה ביותר שהטקסט מפסיד ממנה עד 20% בלבד
      if (best && hero) for (const c of cands) if (c[5] && c[0] >= 0.8 * best[0] && (!best[5] || c[2] > best[2])) best = c;
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
    const [, hs, hh, s, th, hb] = plan();
    const tg = gp.slice(0, -1).reduce((a, b) => a + b, 0);
    const tHb = tx.reduce((a, u) => a + u.h * eff(u), 0) + tg;
    let used = s * tHb;
    if (tg > 0) { gm = Math.max(1, Math.min(2.2, 1 + (th - used) / (tg * s))); used = s * (tHb - tg) + s * tg * gm; }
    const bottom = !hero || (hero.y + hero.h / 2) / sh > 0.35;
    const y0 = bottom ? m + (th - used) / 2 : (hb ? 0 : m) + hh + vg * 2 + (th - used) / 2;
    put(allg, s, 0, W, y0);
    if (hero && hb) out.push([heroVariant(hero, hb.win, { l: true, r: true, t: !bottom, b: bottom }), 0, bottom ? H - hh : 0, W, hh]);
    else if (hero) out.push([hero, (W - hero.w * hs) / 2, bottom ? H - m - hh : m, hero.w * hs, hh]);
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
  if ((r.includes('logo') || r.includes('brand')) && !r.includes('headline')) { if (wide) return wide === 'strip' ? 5 : 2.5; if (u.y + u.h / 2 < 0.22 * sh) return -1; }
  if (wide === true && u.cards && !r.includes('headline')) return -0.5; // באנר רחב רגיל: הגלריה בקצה (ימין בעברית), הכותרת במרכז, לוגו וכפתור בקצה השני, כמו שמעצבים עושים
  if (r.includes('headline')) return 0;
  if (r.includes('button')) return 3;
  if (r.includes('logo') || r.includes('badge') || r.includes('brand')) return wide ? (wide === 'strip' ? 5 : 2.5) : 2;
  if (u.cards || r.includes('photo')) return 1;
  return 1.5;
}
function layoutTallBase(W, H, units, sw, sh) {
  const m = Math.min(W, H) * 0.07, aw = W - 2 * m, rtl = units.some(u => HEB.test((u.lines || []).join('')));
  const rank = u => rankOf(u, sh, false);
  const fine = units.filter(u => finePrint(u, sh)), out0 = [];
  let yb = H - m * 0.7;
  const s0 = Math.max(0.05, ...units.filter(q => !finePrint(q, sh) && q.role !== 'hero').map(q => aw / q.w));
  for (const u of fine) { const f0 = Math.min(aw / u.w, 1.5, 0.8 * s0), w0 = u.w * f0, h0 = u.h * f0; if (h0 < 5) continue; yb -= h0; out0.push([u, (W - w0) / 2, yb, w0, h0]); yb -= m * 0.5; }
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
    if (!u.cards) return { u, cap: (u.role === 'button' || (u.kids.some(k => k.role === 'button') && !u.kids.some(k => k.role === 'headline'))) ? Math.min(2.6, 0.85 * W / u.w, Math.max(0.1 * H, 28) / u.h) : rank(u) === 0 ? 3.2 : 2.2 };
    let pick = null; const total = u.cards.length;
    for (const cols of [...new Set([total, Math.ceil(total / 2), 2, 1])].filter(c => c >= 1 && c <= total)) {
      const a = arrange(u, cols, rtl), f = Math.min(aw / a.w, 2.6, (0.4 * H) / a.h);
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
// ---- היררכיה, פסים וסימני פינה
// סימן קטן (קישוט) ליד הקצה של הבאנר נשאר בפינה שלו ולא נכנס לזרימת התוכן
const isMark = (u, sw, sh) => {
  if (u.role !== 'decor' || u.kids.length !== 1 || u.kids[0].text || u.cards || u.kids[0].isPlate || u.w * u.h >= 0.05 * sw * sh) return false;
  const cx = (u.x + u.w / 2) / sw, cy = (u.y + u.h / 2) / sh;
  return cx < 0.22 || cx > 0.78 || cy < 0.22 || cy > 0.78;
};
function markBox(u, W, H, sw, sh) {
  const k = Math.min(W / sw, H / sh), w = u.w * k, h = u.h * k, cx = (u.x + u.w / 2) / sw, cy = (u.y + u.h / 2) / sh;
  const x = cx < 0.3 ? u.x * k : cx > 0.7 ? W - (sw - u.x - u.w) * k - w : cx * W - w / 2;
  const y = cy < 0.3 ? u.y * k : cy > 0.7 ? H - (sh - u.y - u.h) * k - h : cy * H - h / 2;
  const mg = 0.025 * Math.min(W, H);
  return [clp(x, mg, Math.max(mg, W - w - mg)), clp(y, mg, Math.max(mg, H - h - mg)), w, h];
}
// לוגו (או לוגו עם כתובת) לעולם לא גדול מהכותרת: כשהמקום צפוף הוא מצטמק והכותרת והתמונות גדלות
const isLogoU = u => !u.cards && u.kids.some(k => k.role === 'logo' || k.role === 'brand') && u.kids.every(k => k.role === 'logo' || k.role === 'brand' || (k.text && ['caption', 'label', 'body'].includes(k.role)));
function shrinkUnit(u, f) {
  const rel = new Map(u.kids.map(k => { const [dx, dy] = u.rel ? u.rel.get(k) : [k.x - u.x, k.y - u.y]; return [k, [dx * f, dy * f]]; }));
  return { ...u, w: u.w * f, h: u.h * f, rel, kf: (u.kf || 1) * f };
}
const headArea = res => { let a = 0; for (const [u, , , w] of res) { const s = w / u.w * (u.kf || 1); for (const k of u.kids) if (k.text && k.role === 'headline') a += k.w * k.h * s * s; } return a; };
function capLogos(run, units) {
  let res = run(units);
  if (!units.some(isLogoU)) return res;
  let f = 1;
  for (let it = 0; it < 5; it++) {
    const hd = headArea(res); let lg = 0;
    for (const [u, , , w, h] of res) if (isLogoU(u)) lg += w * h;
    if (!hd || lg <= 0.55 * hd || f <= 0.4) break;
    f *= Math.max(0.4 / f, Math.sqrt(0.5 * hd / lg));
    res = run(units.map(u => isLogoU(u) ? shrinkUnit(u, f) : u));
  }
  return res;
}
const headLineH = res => { let best = 0; for (const [u, , , w] of res) { const s = w / u.w * (u.kf || 1); for (const k of u.kids) if (k.text && k.role === 'headline') best = Math.max(best, k.h * s / Math.max(1, (k.layer && k.layer.k) || (k.lines || []).length || 1)); } return best; };
// פס צר מאוד (728×90, 1200×60...): שורה אחת, הכול באמצע האנכי. הכותרת בשורה אחת כשזה מגדיל את האותיות. stacked: כותרת משנה מעל הכותרת במקום לידה.
function stripRow(W, H, units, sw, sh, ctx, stacked) {
  const heroes = units.filter(u => u.role === 'hero'), hero = heroes.length ? heroes.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a)) : null;
  const rtl = units.some(u => HEB.test((u.lines || []).join('')));
  const m = Math.max(4, H * 0.06), rh = H - 2 * m, gap = Math.max(6, H * 0.12);
  const oneLine = (k, mh) => { const ok = (ctx && ctx.byId.get(k.id)) || k, L2 = reflowLeaf(ok, 1e5, mh, 0); return L2 ? { ...ok, layer: L2, w: L2.lw / L2.up, h: L2.lh / L2.up, reflowed: true } : k; };
  let atoms = [];
  for (const u of units) {
    if (u === hero || u.role === 'hero') continue;
    const hk = u.kids.find(k => k.text && k.role === 'headline');
    if (!hk || u.cards || u.kids.some(k => k.isPlate || k.solid)) { atoms.push(u); continue; }
    const H1 = oneLine(hk, rh * 0.6), subs = u.kids.filter(k => k.text && k.role === 'subheadline').map(k => oneLine(k, rh * 0.4));
    const g1 = Math.max(3, H1.h * 0.3), rel = new Map(), kids = [...subs, H1];
    let uw, uh;
    if (stacked) {
      uw = Math.max(H1.w, ...subs.map(k => k.w)); uh = H1.h + subs.reduce((a, k) => a + k.h + Math.min(k.h, H1.h) * 0.2, 0);
      let y = 0; for (const k of subs) { rel.set(k, [(uw - k.w) / 2, y]); y += k.h + Math.min(k.h, H1.h) * 0.2; }
      rel.set(H1, [(uw - H1.w) / 2, y]);
    } else {
      uw = H1.w + subs.reduce((a, k) => a + k.w + g1, 0); uh = Math.max(H1.h, ...subs.map(k => k.h));
      let x = 0; for (const k of (rtl ? [H1, ...subs] : [...subs, H1])) { rel.set(k, [x, (uh - k.h) / 2]); x += k.w + g1; }
    }
    atoms.push({ role: 'unit', kids, x: hk.x, y: hk.y, w: uw, h: uh, lines: u.lines, rel, head: H1 });
    for (const k of u.kids) if (k !== hk && !(k.text && k.role === 'subheadline')) atoms.push({ role: k.role, kids: [k], x: k.x, y: k.y, w: k.w, h: k.h, lines: k.lines });
  }
  if (!atoms.some(a => a.head)) return null;
  atoms.sort((a, b) => rankOf(a, sh, 'strip') - rankOf(b, sh, 'strip') || (rtl ? (b.x + b.w / 2) - (a.x + a.w / 2) : (a.x + a.w / 2) - (b.x + b.w / 2)));
  let ax0 = m, ax1 = W - m; const out = [];
  if (hero) {
    const right = hero.x + hero.w / 2 > sw / 2, s = Math.min((H - m) / hero.h, W * 0.32 / hero.w, 1.2), hw = hero.w * s, hh = hero.h * s, hx = right ? W - hw - m * 0.3 : m * 0.3;
    out.push([hero, hx, (H - hh) / 2, hw, hh]);
    if (right) ax1 = hx - gap * 0.8; else ax0 = hx + hw + gap * 0.8;
  }
  const aw = ax1 - ax0, ess = a => a.kids.some(k => ['headline', 'button', 'logo', 'brand'].includes(k.role)), isBtn = a => a.kids.every(k => k.role === 'button');
  const minTextH = a => { const hs = a.kids.filter(k => k.text).map(k => k.h / Math.max(1, (k.layer && k.layer.k) || (k.lines || []).length || 1)); return hs.length ? Math.min(...hs) : Infinity; };
  let sc = [], s = 0;
  const solve = () => {
    const Ah = atoms.reduce((t, a) => t + (a.head ? a.head.w * a.head.h : 0), 0);
    const rat = (pred, lim) => { const A = atoms.filter(pred).reduce((t, a) => t + a.w * a.h, 0); return A > 0 ? Math.min(1, Math.sqrt(lim * Ah / A)) : 1; };
    const rl = rat(isLogoU, 0.5), rb = rat(isBtn, 0.45);
    const hk = atoms.find(a => a.head).head;
    const fac = a => isLogoU(a) ? rl : isBtn(a) ? rb : 1;
    const sc1 = (a, v) => Math.min(v * fac(a), rh / a.h, a.head ? 0.68 * H / hk.h : 1e9);
    const tot = v => atoms.reduce((t, a) => t + a.w * sc1(a, v), 0) + (atoms.length - 1) * gap;
    let lo = 0, hi = 1.5; for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (tot(mid) <= aw) lo = mid; else hi = mid; }
    s = lo; sc = atoms.map(a => sc1(a, s));
  };
  for (let it = 0; it < 7; it++) {
    solve();
    const bad = atoms.map((a, i) => [a, i]).filter(([a, i]) => !ess(a) && a.kids.every(k => k.text) && minTextH(a) * sc[i] < 5.5).sort((p, q) => minTextH(p[0]) * sc[p[1]] - minTextH(q[0]) * sc[q[1]]);
    if (!bad.length || atoms.length < 3) break;
    atoms = atoms.filter(a => a !== bad[0][0]);
  }
  solve();
  if (s < 0.05) return null;
  const ws = atoms.map((a, i) => a.w * sc[i]), T = ws.reduce((p, q) => p + q, 0), n = atoms.length;
  const sp = n > 1 ? Math.min(gap * 4, gap + Math.max(0, aw - T - (n - 1) * gap) / (n - 1)) : 0, used = T + (n - 1) * sp;
  let cur = rtl ? ax1 - Math.max(0, aw - used) / 2 : ax0 + Math.max(0, aw - used) / 2;
  atoms.forEach((a, i) => {
    const w = ws[i], h = a.h * sc[i];
    out.push([a, Math.round(rtl ? cur - w : cur), Math.round((H - h) / 2), w, h]);
    cur = rtl ? cur - w - sp : cur + w + sp;
  });
  return out;
}
function layout(W, H, units, sw, sh, forceWide, ctx) {
  const base = capLogos(us => layoutBase(W, H, us, sw, sh, forceWide), units);
  if (W / H <= 4.2 || units.length < 2) return base;
  let best = base, bl = headLineH(base) * 1.08;
  for (const stacked of [false, true]) {
    const row = stripRow(W, H, units, sw, sh, ctx, stacked), l = row ? headLineH(row) : 0;
    if (l > bl) { best = row; bl = l; }
  }
  return best;
}
const layoutTall = (W, H, units, sw, sh) => capLogos(us => layoutTallBase(W, H, us, sw, sh), units);
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
// שורות קטנות מדי לקריאה (פחות מכ-6.5 פיקסלים) בכיתובים מוסרות, כדי שלא יישארו כתמים לא קריאים
function dropTiny(pl) {
  if (!BANS.tiny) return pl;
  return pl.filter(e => !(e[0].text && ['caption', 'body', 'subheadline'].includes(e[0].role) && e[4] / Math.max(1, (e[0].lines || [1]).length) < 7.5));
}
// ---- שורת פריטים קטנים (תגים, תמונה, כיתוב) וכיתוב קטן: כשהם יוצאים קטנים מדי לקריאה בבאנר צר/גבוה
// מסדרים את השורה ל-2 שורות, מגדילים את היחידה על חשבון הכותרת (לא יותר מ-12%), ואם עדיין לא קריא מוותרים על הכיתוב הקטן (הכי פחות חשוב).
const TAG_GLYPH = 9, FINE_GLYPH = 7.5, HEAD_KEEP = 0.88;
const nLinesOf = k => Math.max(1, (k.layer && k.layer.k) || (k.lines || []).length || (k.role === 'badge' ? 2 : 1)); // תג בלי שורות מוכרות: מניחים 2 שורות
// גובה אות משוער של פריט: בתג (תיבה עם ריפוד) כחצי מגובה השורה, בכיתוב חופשי כ-70% מגובה השורה
const glyphOf = (k, s) => k.h / nLinesOf(k) * s * (k.text ? 0.7 : 0.5);
const unitScale = e => e[3] / e[0].w * (e[0].kf || 1);
const isRowGroup = u => {
  if (u.cards || u.role === 'hero') return false;
  const ks = u.kids.filter(k => !k.isPlate);
  if (ks.length < 3 || ks.length !== u.kids.length || !ks.every(k => ['badge', 'photo', 'caption', 'label', 'decor', 'body'].includes(k.role))) return false;
  const s = ks.slice().sort((a, b) => a.x - b.x);
  for (let i = 1; i < s.length; i++) if (s[i - 1].x + s[i - 1].w - s[i].x > 0.3 * Math.min(s[i - 1].w, s[i].w)) return false; // לא שורה: פריטים חופפים
  return u.w > 1.6 * u.h;
};
// כל פריטי היחידה בשתי שורות (חלוקה רציפה לפי סדר x). rtl נשמר כי הסדר בתוך השורה הוא הסדר המקורי.
function restackUnit(u, cut) {
  const ks = u.kids.slice().sort((a, b) => a.x - b.x), rows = [ks.slice(0, cut), ks.slice(cut)];
  const gx = Math.max(2, 0.12 * Math.max(...ks.map(k => k.h))), gy = 0.16 * Math.max(...ks.map(k => k.h));
  const rw = rows.map(r => r.reduce((a, k) => a + k.w, 0) + (r.length - 1) * gx), rh = rows.map(r => Math.max(...r.map(k => k.h)));
  const w = Math.max(...rw), h = rh[0] + rh[1] + gy, rel = new Map();
  let y = 0;
  rows.forEach((r, i) => { let x = (w - rw[i]) / 2; for (const k of r) { rel.set(k, [x, y + (rh[i] - k.h) / 2]); x += k.w + gx; } y += rh[i] + gy; });
  return { ...u, w, h, rel, kf: 1, restacked: true };
}
function readableRows(units, W, H, sc, ctx) {
  if (W / H >= 1.6 || units.length < 3) return units;
  const noHero = !units.some(u => u.role === 'hero'), m = Math.min(W, H) * 0.05, aw = W - 2 * m;
  const run = us => (noHero && W / H < 0.9 ? layoutTall(W, H, us, sc.W, sc.H) : layout(W, H, us, sc.W, sc.H, false, ctx));
  const at = (res, u) => res.find(e => e[0].kids[0] === u.kids[0]);
  const base = run(units), h0 = headLineH(base);
  if (!h0) return units;
  const ok = res => headLineH(res) >= HEAD_KEEP * h0;
  const minGlyph = (res, u) => { const e = at(res, u); if (!e) return 0; const s = unitScale(e); return Math.min(...u.kids.filter(k => k.text || k.role === 'badge').map(k => glyphOf(k, s)).concat(1e9)); };
  const scaled = (u, f) => (f === 1 ? u : shrinkUnit(u, f));
  let cur = units.slice();
  const swap = (a, b) => { cur = b ? cur.map(x => (x === a ? b : x)) : cur.filter(x => x !== a); };
  // מגדילים את היחידה עד שהאותיות קריאות, או עד שהכותרת מפסידה יותר מדי, או עד רוחב הבאנר. מחזיר את הגרסה הטובה ביותר והגודל שהושג.
  const boost = (u, target, fmax) => {
    let r = run(cur), g = minGlyph(r, u);
    for (let f = 1.1; f <= fmax && g < target; f += 0.1) {
      const v = shrinkUnit(u, f / (u.kf || 1)); swap(u, v); r = run(cur); const e = at(r, v);
      if (!ok(r) || !e || e[3] > aw + 0.5) { swap(v, u); break; }
      u = v; g = minGlyph(r, u);
    }
    return { u, g };
  };
  // 1) שורות של פריטים קטנים: מנסים את השורה כמו שהיא ואת כל חלוקה ל-2 שורות, ובוחרים את מה שנותן את האותיות הגדולות ביותר
  for (const u0 of units.filter(isRowGroup)) {
    const res = run(cur); if (!at(res, u0) || minGlyph(res, u0) >= TAG_GLYPH) continue;
    const cands = [u0, ...Array.from({ length: u0.kids.length - 1 }, (_, i) => restackUnit(u0, i + 1))];
    let best = null;
    for (const c of cands) {
      swap(cur.find(x => x.kids[0] === u0.kids[0]), c);
      const b = boost(c, TAG_GLYPH * 1.1, 2.4);
      if (!best || b.g > best.g * 1.08 || (b.g >= TAG_GLYPH * 1.1 && best.g < TAG_GLYPH * 1.1)) best = { ...b, c };
      swap(cur.find(x => x.kids[0] === u0.kids[0]), u0);
    }
    swap(cur.find(x => x.kids[0] === u0.kids[0]), best.u);
  }
  // 2) כיתוב קטן (הערות שוליים): שבירת שורות צרה (reflowUnit) מקטינה את האותיות, אז מנסים קודם את היחידה המקורית (שורות ארוכות),
  // מגדילים עד קריאות; אם אי אפשר, מוותרים (הכי פחות חשוב)
  const isFine = u => u.kids.every(k => k.text && ['caption', 'body', 'label'].includes(k.role)) && u.h < 0.2 * sc.H && u.y + u.h / 2 > 0.85 * sc.H;
  for (const u0 of units.filter(isFine)) {
    { const r0 = run(cur), e0 = at(r0, u0); if (e0 && minGlyph(r0, u0) >= 0.73 * FINE_GLYPH) continue; } // כבר קריא כמו שהוא: לא נוגעים
    const ids = new Set(u0.kids.map(k => k.id)), orig = sc.units.find(q => q.kids.some(k => ids.has(k.id)));
    let done = false;
    for (const start of orig && orig !== u0 ? [orig, u0] : [u0]) {
      let u = start; swap(cur.includes(u0) ? u0 : cur.find(x => x.kids.some(k => ids.has(k.id))), u);
      const res = run(cur), e = at(res, u); if (!e) { done = true; break; }
      if (minGlyph(res, u) >= FINE_GLYPH) { done = true; break; }
      for (let f = 1.1; f <= 2.51; f += 0.1) {
        const v = shrinkUnit(u, f / (u.kf || 1)); swap(u, v); const r = run(cur), ev = at(r, v);
        if (!ok(r) || !ev || ev[3] > aw + 0.5) { swap(v, u); break; }
        u = v; if (minGlyph(r, u) >= FINE_GLYPH) { done = true; break; }
      }
      if (done) break;
    }
    if (!done) cur = cur.filter(x => !x.kids.some(k => ids.has(k.id)));
    else { // מרווח קטן מעל הכיתוב כדי שלא ייגע ביחידה שמעליו
      const fu = cur.find(x => x.kids.some(k => ids.has(k.id))), pad = 0.35 * fu.h / Math.max(1, ...fu.kids.map(nLinesOf)), rel = new Map();
      for (const k of fu.kids) { const [dx, dy] = fu.rel ? fu.rel.get(k) : [k.x - fu.x, k.y - fu.y]; rel.set(k, [dx, dy + pad]); }
      swap(fu, { ...fu, h: fu.h + pad, rel });
    }
  }
  return cur;
}
function autoplaceRules(sc, W, H) {
  return dropTiny(autoplaceRules0(sc, W, H));
}
function autoplaceRules0(sc, W, H) {
  const pl = [];
  const add = (u, x, y, w, h) => { const s = w / u.w, kf = u.kf || 1; for (const k of u.kids) { const [dx, dy] = u.rel ? u.rel.get(k) : [k.x - u.x, k.y - u.y]; pl.push([k, x + dx * s, y + dy * s, k.w * s * kf, k.h * s * kf]); } };
  const units0 = sc.units.map(u => reflowUnit(u, W, H));
  const marks = units0.length > 1 ? units0.filter(u => isMark(u, sc.W, sc.H)) : [];
  const ctx = { byId: new Map(sc.leaves.map(l => [l.id, l])) };
  const units = readableRows(marks.length ? units0.filter(u => !marks.includes(u)) : units0, W, H, sc, ctx);
  const addMarks = () => { for (const u of marks) { const [x, y, w, h] = markBox(u, W, H, sc.W, sc.H); add(u, x, y, w, h); } };
  const noHero = !units.some(u => u.role === 'hero'), asp = W / H;
  let useTall = noHero && asp < 0.9, mid = null;
  if (noHero && asp >= 0.9 && asp < 1.8) { // יחס בינוני: מנסים גם סידור לגובה וגם לרוחב, ובוחרים את זה שממלא יותר מהבאנר
    const cover = o => o.reduce((a, e) => a + e[3] * e[4], 0);
    const t = layoutTall(W, H, units, sc.W, sc.H), w2 = layout(W, H, units.filter(u => !u.pin || true), sc.W, sc.H, true, ctx);
    useTall = cover(t) >= cover(w2); mid = useTall ? t : w2;
  }
  if (mid && !useTall) { for (const [u, x, y, w, h] of mid) add(u, x, y, w, h); addMarks(); pl.sort((a, b) => (a[0].isPlate ? 0 : 1) - (b[0].isPlate ? 0 : 1) || a[0].z - b[0].z); return pl; }
  if (useTall) {
    for (const [u, x, y, w, h] of (mid || layoutTall(W, H, units, sc.W, sc.H))) add(u, x, y, w, h);
    addMarks();
    pl.sort((a, b) => (a[0].isPlate ? 0 : 1) - (b[0].isPlate ? 0 : 1) || a[0].z - b[0].z);
    return pl;
  }
  const pins = [], rest = [], mg = Math.min(W, H) * 0.06;
  const strip = W / H > 4.2;
  for (const u of units) { if (u.pin && !strip) { const k = Math.min((W - 2 * mg) / u.w, 1.4); pins.push([u, k, u.h * k, u.w * k]); } else rest.push(u); }
  const hasTop = pins.some(p => p[0].pin === 'top'), hasBot = pins.some(p => p[0].pin === 'bottom');
  const topH = pins.filter(p => p[0].pin === 'top').reduce((a, p) => a + p[2], 0) + (hasTop ? mg : 0);
  const botH = pins.filter(p => p[0].pin === 'bottom').reduce((a, p) => a + p[2], 0) + (hasBot ? mg : 0);
  const avail = Math.max(20, H - topH - botH);
  for (const [u, x, y0, w, h] of layout(W, avail, rest, sc.W, sc.H, false, ctx)) add(u, x, Math.max(0, Math.min(avail - h, y0)) + topH, w, h);
  addMarks();
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
// רשימת איסורים: כללים שהמנוע לא מרשה לעצמו לשבור. כל איסור אפשר לכבות בהגדרות.
const BANS = { overlap: true, clip: true, tiny: true };
function setBans(b) { APGEN++; if (b && typeof b === 'object') for (const k of Object.keys(BANS)) if (k in b) BANS[k] = !!b[k]; }
function enforceBans(sc, W, H, pl) {
  if (!BANS.overlap && !BANS.clip) return pl;
  const uOf = new Map(), uOfId = new Map(); sc.units.forEach((u, i) => u.kids.forEach(k => { uOf.set(k, i); uOfId.set(k.id, i); })); // גם עותקים שנוצרו בשבירת שורות שייכים ליחידה שלהם
  const ov = (a, b) => Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > 0.5 && Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > 0.5;
  const build = () => {
    const m = new Map();
    for (const e of pl) {
      const lf = e[0]; if (lf.isPlate || lf.role === 'hero' || lf.role === 'decor') continue;
      const id = uOf.has(lf) ? uOf.get(lf) : uOfId.has(lf.id) ? uOfId.get(lf.id) : 'l' + lf.id; let u = m.get(id);
      if (!u) { u = { id, es: [], x1: 1e9, y1: 1e9, x2: -1e9, y2: -1e9 }; m.set(id, u); }
      u.es.push(e); u.x1 = Math.min(u.x1, e[1]); u.y1 = Math.min(u.y1, e[2]); u.x2 = Math.max(u.x2, e[1] + e[3]); u.y2 = Math.max(u.y2, e[2] + e[4]);
    }
    return [...m.values()];
  };
  let us = build(); if (us.length < 2 && !BANS.clip) return pl;
  const bad = () => { for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) { const a = us[i], b = us[j], ix = Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1), iy = Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1); if (ix > 1 && iy > 1 && ix * iy > 0.06 * Math.min((a.x2 - a.x1) * (a.y2 - a.y1), (b.x2 - b.x1) * (b.y2 - b.y1))) return true; } return false; };
  const out = pl.map(e => e.slice());
  const idx = new Map(pl.map((e, i) => [e, i]));
  const move = (u, dx, dy) => { for (const e of u.es) { const o = out[idx.get(e)]; o[1] += dx; o[2] += dy; } u.x1 += dx; u.x2 += dx; u.y1 += dy; u.y2 += dy; };
  const scaleAll = (k, cx, cy) => { for (const u of us) { for (const e of u.es) { const o = out[idx.get(e)]; o[1] = cx + (o[1] - cx) * k; o[2] = cy + (o[2] - cy) * k; o[3] *= k; o[4] *= k; } u.x1 = cx + (u.x1 - cx) * k; u.x2 = cx + (u.x2 - cx) * k; u.y1 = cy + (u.y1 - cy) * k; u.y2 = cy + (u.y2 - cy) * k; } };
  if (BANS.overlap && bad()) {
    const wide = W / H >= 1.8, gap = 0.012 * Math.min(W, H);
    for (let pass = 0; pass < 6 && bad(); pass++) {
      us.sort(wide ? (p, q) => p.x1 - q.x1 : (p, q) => p.y1 - q.y1);
      for (let j = 1; j < us.length; j++) for (let i = 0; i < j; i++) {
        const a = us[i], b = us[j]; if (!ov(a, b)) continue;
        if (wide) move(b, a.x2 - b.x1 + gap, 0); else move(b, 0, a.y2 - b.y1 + gap);
      }
    }
    if (bad()) { /* נשאר חפיפה: ממשיכים לכיווץ */ }
  }
  if (BANS.clip || BANS.overlap) {
    const m = 0.02 * Math.min(W, H);
    const x1 = Math.min(...us.map(u => u.x1)), x2 = Math.max(...us.map(u => u.x2)), y1 = Math.min(...us.map(u => u.y1)), y2 = Math.max(...us.map(u => u.y2));
    const k = Math.min(1, (W - 2 * m) / Math.max(1, x2 - x1), (H - 2 * m) / Math.max(1, y2 - y1));
    if (k < 1) scaleAll(k, (x1 + x2) / 2, (y1 + y2) / 2);
    const nx1 = Math.min(...us.map(u => u.x1)), nx2 = Math.max(...us.map(u => u.x2)), ny1 = Math.min(...us.map(u => u.y1)), ny2 = Math.max(...us.map(u => u.y2));
    const dx = nx1 < m ? m - nx1 : nx2 > W - m ? W - m - nx2 : 0, dy = ny1 < m ? m - ny1 : ny2 > H - m ? H - m - ny2 : 0;
    if (dx || dy) for (const u of us) move(u, dx, dy);
  }
  return out;
}
let APGEN = 0; // מספר הגרסה עולה כשמשתנים האיסורים, ואז הזיכרון נמחק
// ---------------------------------------------------------------- רשת ביטחון (כמו במערכות מסחריות: אף פעם לא שבור)
// אם הסידור שנבנה נכשל בבדיקות גיאומטריה (חפיפה, חיתוך, כותרת חסרה), מחליפים אותו בבאנר המקורי השלם: הקטנה אחת בלי חיתוך, על רקע מטושטש מאותה תמונה.
// זה אולי פשוט, אבל תמיד נקי ושלם (בגודל המקורי זה בדיוק המקור). לא פועל כשיש תכנון מפורש (plan).
const SAFE_CODES = new Set(['clipped', 'overlap', 'headline_missing']);
function containPlace(sc, W, H) {
  const img = sc._img; if (!img) return null;
  const sw = sc.W, sh = sc.H; let s = Math.min(W / sw, H / sh);
  if (s * s * sw * sh < 0.35 * W * H && Math.abs(W / H - sw / sh) > 0.03) return null; // רצועה קטנה באמצע קנבס גדול: לא טוב יותר מהסידור הקיים
  if (Math.abs(W / H - sw / sh) < 0.03) s = Math.max(W / sw, H / sh);
  const w = sw * s, h = sh * s, a = new Float32Array(sw * sh).fill(1);
  const ids = (sc.leaves instanceof Map ? [...sc.leaves.values()] : sc.leaves).map(l => l.id);
  const leaf = { id: 'whole', role: 'photo', text: false, shape: 'rect', group: null, z: 0, x: 0, y: 0, w: sw, h: sh, reflowed: true, absorbs: ids, layer: { rgb: img.d, a, lw: sw, lh: sh, up: 1, x: 0, y: 0, w: sw, h: sh } };
  return [[leaf, (W - w) / 2, (H - h) / 2, w, h]];
}
function rfSafe(sc, W, H, plan, pl) {
  const c = sc._cont || (sc._cont = new Map()), key = W + 'x' + H;
  if (plan || !G.SizyQA || !sc._img) { c.set(key, false); return pl; }
  let bad = false; try { bad = G.SizyQA.qaCheck(sc, W, H, pl).issues.some(i => SAFE_CODES.has(i.code)); } catch (e) { bad = false; }
  const cp = bad ? containPlace(sc, W, H) : null; c.set(key, !!cp);
  return cp || pl;
}
function containFor(sc, W, H) { autoplace(sc, W, H); return !!(sc._cont && sc._cont.get(W + 'x' + H)); }
function containBg(sc, Wk, Hk) {
  const img = sc._img, s = Math.max(Wk / sc.W, Hk / sc.H), nw = Math.max(Wk, Math.round(sc.W * s)), nh = Math.max(Hk, Math.round(sc.H * s));
  const big = resize(img, nw, nh, s < 1 ? 'area' : 'cubic'), x0 = Math.floor((nw - Wk) / 2), y0 = Math.floor((nh - Hk) / 2);
  return blur(cropImg(big, x0, y0, x0 + Wk, y0 + Hk), 0.035 * Math.max(Wk, Hk));
}
function autoplace(sc, W, H, plan) {
  const ck = W + 'x' + H + '|' + APGEN + '|' + (plan ? JSON.stringify(plan) : ''), mc = sc._ap || (sc._ap = new Map()), hit = mc.get(ck);
  if (hit) return hit.map(e => e.slice());
  const res = rfSafe(sc, W, H, plan, autoplace0(sc, W, H, plan));
  if (mc.size > 64) mc.delete(mc.keys().next().value);
  mc.set(ck, res.map(e => e.slice()));
  return res;
}
function autoplace0(sc, W, H, plan) {
  const rf = reframeFor(sc, W, H, plan); if (rf) return rf.place.map(e => e.slice()); // REFRAME: רקע צילומי עם גיבור – חלון חיתוך מהמקור ויחידות מעליו
  const base = autoplaceRules(sc, W, H);
  let res = base;
  if (plan && planValid(plan, sc, W, H)) { const pp = planned(sc, W, H, plan); if (planOk(pp, base, W, H)) res = pp; }
  return enforceBans(sc, W, H, res);
}

// ---------------------------------------------------------------- REFRAME
// רקע צילומי עם גיבור (אדם) שהוא חלק מהתמונה: במקום "רקע + אלמנטים שאפשר להסיר" בוחרים חלון חיתוך (cover) מפיקסלי המקור
// שמשאיר את הגיבור שלם כפיקסלים רגילים (לא מסירים אותו), ומסדרים מחדש את שאר היחידות (פאנל כותרת, כפתור, תגים, אותיות קטנות) מעליו ומחוץ למלבן הגיבור.
// כלל ההכרעה (מדיד, ראה rfPrep): רקע צילומי = חלק הבלוקים 8×8 עם סטיית תקן >2.5 ≥ 0.40 וחלק הבלוקים השטוחים (<0.8) ≤ 0.10, יש גיבור-מלבן (תמונה שנחתכה מהמקור),
// ויש חלון/סידור שבו הריפוד המלאכותי (שמיים/רצפה מתוחים) ≤ 42% מהחלון, הפנים לא נחתכות, והכותרת לא מתכווצת. אחרת נשארים עם שיטת הרקע הקיימת.
const RF = { minTex: 0.40, maxFlat: 0.10, maxPad: 0.42 };
function rfLum(img) { const n = img.w * img.h, L = new Float32Array(n), d = img.d; for (let i = 0; i < n; i++) L[i] = 0.299 * d[i * 3] + 0.587 * d[i * 3 + 1] + 0.114 * d[i * 3 + 2]; return L; }
// מדד "צילומיות" של הרקע: חלק הבלוקים 8×8 עם טקסטורה וחלק השטוחים
function rfPhoto(plate) {
  const { w, h } = plate, L = rfLum(plate); let tex = 0, flat = 0, nb = 0;
  for (let by = 0; by + 8 <= h; by += 8) for (let bx = 0; bx + 8 <= w; bx += 8) {
    let s = 0, s2 = 0; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const v = L[(by + y) * w + bx + x]; s += v; s2 += v * v; }
    const sd = Math.sqrt(Math.max(0, s2 / 64 - (s / 64) * (s / 64))); nb++; if (sd > 2.5) tex++; if (sd < 0.8) flat++;
  }
  return { tex: nb ? tex / nb : 0, flat: nb ? flat / nb : 1 };
}
// צילומיות הרקע נמדדת על פיקסלי המקור מחוץ לחורים (לא על הרקע המולא): תיבות רחבות מדי מגדילות את החורים והמילוי חלק, וזה לא אומר שהמקור לא צילומי
function rfPhotoSrc(sc) {
  const img = sc._img, hole = sc._holesT; if (!img || !hole) return rfPhoto(sc.plate);
  const { w, h } = img, L = rfLum(img); let tex = 0, flat = 0, nb = 0;
  for (let by = 0; by + 8 <= h; by += 8) for (let bx = 0; bx + 8 <= w; bx += 8) {
    let hh = 0, s = 0, s2 = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const i = (by + y) * w + bx + x; hh += hole[i]; const v = L[i]; s += v; s2 += v * v; }
    if (hh) continue;
    const sd = Math.sqrt(Math.max(0, s2 / 64 - (s / 64) * (s / 64))); nb++; if (sd > 2.5) tex++; if (sd < 0.8) flat++;
  }
  if (nb < 0.06 * (w >> 3) * (h >> 3)) return rfPhoto(sc.plate); // כמעט הכל חור: אין ממה למדוד
  return { tex: tex / nb, flat: flat / nb };
}
function rfPrep(sc) {
  if (sc._rf !== undefined) return sc._rf;
  sc._rf = false;
  if (G.__SIZY_NO_REFRAME || !sc._img) return false;
  const hs = sc.leaves.filter(l => l.role === 'hero' && !l.text && l.layer && l.layer.rectHero);
  if (!hs.length) return false;
  const hero = hs.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a));
  if (hero.w * hero.h < 0.03 * sc.W * sc.H) return false;
  const ph = rfPhotoSrc(sc);
  if (ph.tex < RF.minTex || ph.flat > RF.maxFlat) return false;
  return (sc._rf = { hero, ph });
}
// פאנל כהה מאחורי כותרת (למשל לוח שחור עם מסגרת זהב): רכיבי הקשירות הכהים שחופפים לתיבת הטקסט, ומלבן התוחם שלהם. null אם אין לוח כהה סביר
function rfPanelRect(img, lum, box) {
  const W = img.w, H = img.h, bw0 = box[2] - box[0], bh0 = box[3] - box[1];
  const x0 = clp(Math.round(box[0] + 0.25 * bw0), 0, W - 1), y0 = clp(Math.round(box[1] + 0.25 * bh0), 0, H - 1), x1 = clp(Math.round(box[2] - 0.25 * bw0), x0 + 1, W), y1 = clp(Math.round(box[3] - 0.25 * bh0), y0 + 1, H) // מרכז התיבה בלבד: תיבות רחבות של Gemini כוללות רקע צילומי בשוליים; // ליבת התיבה (תיבות הטקסט מדויקות רק בערך)
  const vals = []; for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) vals.push(lum[y * W + x]);
  const p25 = percentile(vals, 25); if (p25 > 70) return null;
  const T = Math.min(70, p25 + 25), ex = Math.round(1.2 * (x1 - x0)), ey = Math.round(1.2 * (y1 - y0));
  const wx0 = Math.max(0, x0 - ex), wy0 = Math.max(0, y0 - ey), wx1 = Math.min(W, x1 + ex), wy1 = Math.min(H, y1 + ey), cw = wx1 - wx0, ch = wy1 - wy0;
  const m = new Uint8Array(cw * ch); for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (lum[(wy0 + y) * W + wx0 + x] < T) m[y * cw + x] = 1;
  const { lab, n } = labelCC(m, cw, ch), inside = new Int32Array(n + 1);
  for (let y = y0 - wy0; y < y1 - wy0; y++) for (let x = x0 - wx0; x < x1 - wx0; x++) { const l = lab[y * cw + x]; if (l) inside[l]++; }
  const need = Math.max(40, 0.004 * (x1 - x0) * (y1 - y0)), keep = new Uint8Array(n + 1); let any = false;
  for (let l = 1; l <= n; l++) if (inside[l] >= need) { keep[l] = 1; any = true; }
  if (!any) return null;
  let bx0 = cw, by0 = ch, bx1 = -1, by1 = -1, cnt = 0;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) if (keep[lab[y * cw + x]]) { cnt++; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  const bw = bx1 - bx0 + 1, bh = by1 - by0 + 1;
  if (bx0 + wx0 > x0 || by0 + wy0 > y0 || bx1 + wx0 + 1 < x1 || by1 + wy0 + 1 < y1) return null; // חייב להכיל את ליבת הטקסט
  if (bw * bh > 3.5 * bw0 * bh0 || cnt < 0.35 * bw * bh) return null; // דלף לאזורים כהים אחרים / לא מלבני
  const g = Math.round(0.03 * Math.min(bw, bh)) + 3, rx0 = clp(wx0 + bx0 - g, 0, W), ry0 = clp(wy0 + by0 - g, 0, H), rx1 = clp(wx0 + bx1 + 1 + g, 0, W), ry1 = clp(wy0 + by1 + 1 + g, 0, H);
  return { x: rx0, y: ry0, w: rx1 - rx0, h: ry1 - ry0 };
}
function rfRound(w, h, r, soft) { // אלפא של מלבן עם פינות מעוגלות (קצה רך של פיקסל אחד)
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const cx = clp(x + 0.5, r, w - r), cy = clp(y + 0.5, r, h - r), d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    a[y * w + x] = clp(r - d + 0.5 + soft, 0, 1);
  }
  return a;
}
// כל מה שה-REFRAME צריך לחשב פעם אחת: יחידות (פאנלים כגרפיקה אחת), רקע בלי חורים ליחידות שזזות (הגיבור נשאר), אנרגיית פרטים וטווחי ריפוד
function rfAssets(sc, P) {
  if (P.A) return P.A;
  const img = sc._img, W = sc.W, H = sc.H, lum = rfLum(img), hero = P.hero, units = [], hole = Uint8Array.from(sc._holesT || new Uint8Array(W * H));
  const heroU = sc.units.find(u => u.kids.includes(hero));
  const textU = u => u.kids.every(k => k.text || k.panel || (k.role === 'badge' && u.kids.some(q => q.role === 'headline'))), cand = sc.units.filter(u => u !== heroU && textU(u) && u.kids.some(k => k.role === 'headline')); // יחידת כותרת על לוח: הלוח והטקסט נחתכים יחד מהמקור (אלפא של טקסט זהב עם צללים כהים על לוח כהה מוחק חלקי אותיות)
  const panels = [];
  for (const u of cand) {
    const r = rfPanelRect(img, lum, [u.x, u.y, u.x + u.w, u.y + u.h]); if (!r) continue;
    const o = panels.find(p => Math.min(p.x + p.w, r.x + r.w) - Math.max(p.x, r.x) > 0.5 * Math.min(p.w, r.w) && Math.min(p.y + p.h, r.y + r.h) - Math.max(p.y, r.y) > 0.5 * Math.min(p.h, r.h));
    if (o) { const x1 = Math.max(o.x + o.w, r.x + r.w), y1 = Math.max(o.y + o.h, r.y + r.h); o.x = Math.min(o.x, r.x); o.y = Math.min(o.y, r.y); o.w = x1 - o.x; o.h = y1 - o.y; } else panels.push({ ...r });
  }
  const btnU = u => u.kids.some(k => k.role === 'button') && u.kids.every(k => k.role === 'button' || k.text || k.panel);
  for (const u of sc.units) { // כפתור (עם הטקסט שבתוכו) נחתך כתמונה אחת עם פינות מעוגלות: הוצאת אלפא מזהב על מג'נטה שוחקת את הספרות ומשאירה קצוות מנוקדים
    if (u === heroU || !btnU(u)) continue;
    const b = u.kids.filter(k => k.role === 'button'), x0 = Math.max(0, Math.floor(Math.min(...b.map(k => k.x)))), y0 = Math.max(0, Math.floor(Math.min(...b.map(k => k.y)))), x1 = Math.min(W, Math.ceil(Math.max(...b.map(k => k.x + k.w)))), y1 = Math.min(H, Math.ceil(Math.max(...b.map(k => k.y + k.h))));
    if (x1 - x0 >= 20 && y1 - y0 >= 12 && !panels.some(q => Math.min(q.x + q.w, x1) - Math.max(q.x, x0) > 0 && Math.min(q.y + q.h, y1) - Math.max(q.y, y0) > 0)) panels.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, btn: true });
  }
  const absorbed = new Set();
  panels.forEach((p, i) => {
    const kids = sc.units.filter(u => u !== heroU && (p.btn ? btnU(u) : textU(u)) && u.x + u.w / 2 > p.x && u.x + u.w / 2 < p.x + p.w && u.y + u.h / 2 > p.y && u.y + u.h / 2 < p.y + p.h);
    kids.forEach(u => absorbed.add(u));
    const lw = p.w, lh = p.h, rgb = new Float32Array(lw * lh * 3), rr = p.btn ? 0.3 : 0.07, a = rfRound(lw, lh, rr * Math.min(lw, lh), p.btn ? -1.2 : 0);
    for (let y = 0; y < lh; y++) for (let x = 0; x < lw; x++) { const si = ((p.y + y) * W + p.x + x) * 3, di = (y * lw + x) * 3; rgb[di] = img.d[si]; rgb[di + 1] = img.d[si + 1]; rgb[di + 2] = img.d[si + 2]; }
    const hm = rfRound(lw + 8, lh + 8, rr * Math.min(lw, lh) + 4, 0);
    for (let y = 0; y < lh + 8; y++) for (let x = 0; x < lw + 8; x++) if (hm[y * (lw + 8) + x] > 0.02) { const gx = p.x - 4 + x, gy = p.y - 4 + y; if (gx >= 0 && gy >= 0 && gx < W && gy < H) hole[gy * W + gx] = 1; }
    const hz = kids.flatMap(u => u.kids.filter(k => k.role === (p.btn ? 'button' : 'headline')).map(k => k.z)), z = Math.min(...(hz.length ? hz : kids.flatMap(u => u.kids.map(k => k.z))), 1e9); // z של עלה כותרת: העורך וה-QA מזהים את הלוח ככותרת
    const leaf = { id: 'panel' + i, role: p.btn ? 'button' : 'headline', lines: kids.flatMap(u => u.lines || []), text: false, shape: 'rect', group: null, z, layer: { rgb, a, lw, lh, up: 1, x: p.x, y: p.y, w: lw, h: lh }, x: p.x, y: p.y, w: lw, h: lh, panelCrop: true, reflowed: true, absorbs: kids.flatMap(u => u.kids.map(k => k.id)) }; // reflowed: העורך מקבל את השכבה המורכבת
    units.push({ role: p.btn ? 'button' : 'headline', kids: [leaf], x: p.x, y: p.y, w: lw, h: lh, lines: leaf.lines, pin: null });
  });
  for (const u of sc.units) if (u !== heroU && !absorbed.has(u)) units.push(u);
  for (const e of sc.leaves) { // חורים ליחידות שזזות (לא לגיבור): המסכה המורחבת של היחידה + מלבן התיבה שלה (שאריות הילה/עיטורים מחוץ לאלפא)
    if (e === hero || e.text || !e._hm) continue;
    const { x0, y0, mw, mh, dm } = e._hm;
    for (let j = 0; j < mh; j++) for (let i = 0; i < mw; i++) { const gx = x0 + i, gy = y0 + j; if (dm[j * mw + i] && gx >= 0 && gy >= 0 && gx < W && gy < H) hole[gy * W + gx] = 1; }
    if (e.role === 'badge' || e.role === 'logo' || e.role === 'photo') for (let gy = Math.max(0, e.y - 2); gy < Math.min(H, e.y + e.h + 2); gy++) for (let gx = Math.max(0, e.x - 2); gx < Math.min(W, e.x + e.w + 2); gx++) hole[gy * W + gx] = 1;
  }
  const avoid = new Uint8Array(W * H); if (hero) for (let y = Math.max(0, hero.y - 6); y < Math.min(H, hero.y + hero.h + 6); y++) for (let x = Math.max(0, hero.x - 6); x < Math.min(W, hero.x + hero.w + 6); x++) avoid[y * W + x] = 1; // הגיבור אינו רקע: לא לוקחים ממנו טקסטורה
  let plate = msFill(img, hole, { tex: { budget: 500000, ms: 20000, lo: 0.8, hi: 2.5, maxFrac: 0.65, force: true, avoid } }); // חורים גדולים (פאנל, כפתור): גם הם מסונתזים מטקסטורת התמונה עצמה ולא רק מילוי חלק
  plate = softenDenseHoles(plate, hole, plate.tex);
  for (let i = 0; i < plate.d.length; i++) plate.d[i] = clp(plate.d[i], 0, 255);
  // אנרגיית קצוות (אינטגרל) לבחירת חלון
  const pl = rfLum(plate), I = new Float64Array((W + 1) * (H + 1)), rowE = new Float32Array(H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const e = (i < W - 1 ? Math.abs(pl[j * W + i + 1] - pl[j * W + i]) : 0) + (j < H - 1 ? Math.abs(pl[(j + 1) * W + i] - pl[j * W + i]) : 0);
    I[(j + 1) * (W + 1) + i + 1] = e + I[j * (W + 1) + i + 1] + I[(j + 1) * (W + 1) + i] - I[j * (W + 1) + i]; rowE[j] += e / W;
  }
  // כמה שורות בקצה העליון/התחתון שקטות (שמיים/רצפה חלקים) כדי למתוח אותן לריפוד
  const band = (from, dir) => {
    const lim = Math.round(0.2 * H), at = k => from + dir * k, m = (a, b) => { let s = 0; for (let k = a; k < b; k++) s += rowE[at(k)]; return s / (b - a); };
    const e0 = m(0, 8), thr = Math.max(1.5 * e0, e0 + 2.5); let K = 24;
    for (let k = 16; k <= lim; k += 2) if (m(k - 8, k) <= thr) K = k; else break;
    return K;
  };
  const hb = { x0: W, x1: 0 }; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (hole[y * W + x]) { if (x < hb.x0) hb.x0 = x; if (x > hb.x1) hb.x1 = x; }
  return (P.A = { plate, units, I, hole, hb, orig: img, KT: band(0, 1), KB: band(H - 1, -1), ext: new Map(), panels });
}
// הרחבת הרקע למעלה/למטה (ריפוד): מותחים את פס הקצה השקט (שמיים/רצפה) ומטשטשים אופקית כדי שלא יישארו פסים אנכיים
function rfExtend(A, W, H, padT, padB, orig) {
  const key = padT + '|' + padB + (orig ? 'o' : ''); if (A.ext.has(key)) return A.ext.get(key);
  const h2 = H + padT + padB, out = { w: W, h: h2, c: 3, d: new Float32Array(W * h2 * 3) }, src = orig ? A.orig.d : A.plate.d, KT = A.KT, KB = A.KB, stretch = [];
  for (let ye = 0; ye < h2; ye++) {
    let ys, st = 1;
    if (ye < padT + KT && padT > 0) { ys = ye * KT / (padT + KT); st = (padT + KT) / KT; }
    else if (ye >= padT + H - KB && padB > 0) { ys = H - KB + (ye - (padT + H - KB)) * KB / (KB + padB); st = (KB + padB) / KB; }
    else ys = ye - padT;
    ys = clp(ys, 0, H - 1); const y0 = Math.floor(ys), y1 = Math.min(H - 1, y0 + 1), t = ys - y0;
    for (let x = 0; x < W * 3; x++) out.d[ye * W * 3 + x] = src[y0 * W * 3 + x] * (1 - t) + src[y1 * W * 3 + x] * t;
    stretch.push(st);
  }
  for (let ye = 0; ye < h2; ye++) { // טשטוש אופקי פרופורציונלי למתיחה, חלש ליד התפר
    const st = stretch[ye]; if (st <= 1.2) continue;
    const seam = ye < padT + KT ? (padT + KT - ye) / (padT + KT) : (ye - (padT + H - KB)) / (padB + KB), r = Math.round(Math.min(10, 0.8 * st) * clp(seam * 1.6, 0, 1)); if (r < 1) continue;
    const row = Float32Array.from(out.d.subarray(ye * W * 3, (ye + 1) * W * 3));
    for (let x = 0; x < W; x++) for (let c = 0; c < 3; c++) { let s = 0, n = 0; for (let k = -r; k <= r; k++) { const xx = clp(x + k, 0, W - 1); s += row[xx * 3 + c]; n++; } out.d[(ye * W + x) * 3 + c] = s / n; }
  }
  if (A.ext.size > 8) A.ext.delete(A.ext.keys().next().value);
  A.ext.set(key, out); return out;
}
function reframeBg(sc, rf, Wk, Hk, K) {
  const A = rf.A, ext = rfExtend(A, sc.W, sc.H, rf.padT, rf.padB, rf.native);
  const wx0 = clp(Math.round(rf.x0), 0, ext.w - 4), wy0 = clp(Math.round(rf.y0 + rf.padT), 0, ext.h - 4), ww = clp(Math.round(rf.ww), 4, ext.w - wx0), wh = clp(Math.round(rf.wh), 4, ext.h - wy0);
  return resizePlate(cropImg(ext, wx0, wy0, wx0 + ww, wy0 + wh), Wk, Hk);
}
const rfArea = r => Math.max(0, r.w) * Math.max(0, r.h);
const rfInter = (a, b) => { const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h); return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) }; };
// מסדר קבוצת יחידות בתוך אזור ומחזיר מיקומים בקואורדינטות הבאנר (או null אם אין מקום)
function rfZone(sc, units, zx, zy, zw, zh) {
  if (!units.length) return [];
  if (zw < 24 || zh < 24) return null;
  const sc2 = { W: sc.W, H: sc.H, units, leaves: sc.leaves };
  return autoplaceRules(sc2, zw, zh).map(e => [e[0], e[1] + zx, e[2] + zy, e[3], e[4]]);
}
// חלק הבאנר שבו נראה חור ממולא (מריחה) ואף יחידה לא מכסה אותו
function rfSmear(A, SW, SH, f, x0, y0, W, H, place) {
  const step = Math.max(2, Math.round(Math.min(W, H) / 70)), hole = A.hole; let bad = 0, n = 0;
  for (let y = step / 2; y < H; y += step) for (let x = step / 2; x < W; x += step) {
    n++; const sx = Math.round(x0 + x / f), sy = Math.round(y0 + y / f);
    if (sx < 8 || sy < 8 || sx >= SW - 8 || sy >= SH - 8) continue;
    let c = 0; for (let dy = -8; dy <= 8; dy += 4) for (let dx = -8; dx <= 8; dx += 4) c += hole[(sy + dy) * SW + sx + dx];
    if (c < 23) continue; // רק פנים של חור (ליד הקצה המילוי מתמזג עם הסביבה)
    let cov = false; for (const e of place) if (x >= e[1] - 1 && x <= e[1] + e[3] + 1 && y >= e[2] - 1 && y <= e[2] + e[4] + 1) { cov = true; break; }
    if (!cov) bad++;
  }
  return bad / Math.max(1, n);
}
function rfScore(place, W, H, Rv, hv, nUnits, pad) {
  let head = 0, other = 0, btn = 0, kept = new Set();
  for (const e of place) { const a = e[3] * e[4]; if (e[0].role === 'headline') head += a; else if (e[0].role === 'button' && !e[0].panelCrop) btn += a; else other += a; kept.add(e[0].id); }
  return 1.0 * Math.sqrt(btn / (W * H)) + 3.2 * Math.sqrt(head / (W * H)) + 0.5 * Math.sqrt(rfArea(Rv) / (W * H)) + 0.5 * Math.sqrt(other / (W * H)) - 1.0 * pad - 1.5 * (1 - hv) - (W / H < 3 ? 2.4 * Math.max(0, 0.6 - Math.min(Rv.h, H) / H) : 0) - 2.4 * Math.max(0, Math.min(Rv.h, H) / H - 0.82); // מעצב: הדמות תופסת לפחות ~60% מהגובה (לא קטנה ברקע מרופד)
}
// כללי מעצב (נמדדו ב-19 גדלים של קמפיין צילומי אחד): מה מורידים לפי גודל הבאנר, לפי תפקיד ולא לפי טקסט
function rfKeepUnits(units, W, H) {
  const ar = W / H, area = W * H, tiny = area < 60000 && ar > 1.4 || H <= 70;
  return units.filter(u => {
    const kid = u.kids[0], role = u.role === 'unit' && u.kids.every(k => k.role === 'badge' || k.role === 'photo') ? 'prize' : u.role;
    if (role === 'body' || role === 'legal') return area >= 200000 || (W >= 700 && H >= 190 && ar >= 2.4); // שורת פרטים קטנה: רק כשיש מקום
    if (role === 'badge') return area >= 200000; // עיגול זוכה/חותם קטן: רק כשיש מקום
    if (role === 'prize') return !(tiny || (H <= 90 && W < 1000));
    if (role === 'logo') return !(H <= 70 && W < 500);
    return true;
  });
}

// פס דק (למשל 728x90, 1200x60): הכותרת הופכת לשורה אחת. שורות הלוח נחתכות מהמקור (כולל הרקע שלהן) ומוצמדות זו לזו; כפתור/פרס/לוגו בשורה לידו
function rfStrip(sc, W, H, P, A, AU) {
  const pu = AU.find(u => u.kids.some(k => k.panelCrop && k.role === 'headline')); if (!pu) return null;
  const pk = pu.kids.find(k => k.panelCrop), p = A.panels && A.panels[0]; if (!p) return null;
  const ab = new Set(pk.absorbs || []), tl = sc.leaves.filter(l => l.text && l.role === 'headline' && ab.has(l.id) && l.layer);
  if (!tl.length) return null;
  // מסכת דיו מאוחדת של כל טקסט הכותרת, בקואורדינטות המקור, ושורות לפי רצועות אנכיות
  const pw = p.w, ph = p.h, M = new Uint8Array(pw * ph), dd0 = A.orig.d, SW0 = sc.W, ins = Math.max(6, Math.round(0.03 * pw));
  for (let y = 0; y < ph; y++) for (let x = ins; x < pw - ins; x++) { const q = ((p.y + y) * SW0 + p.x + x) * 3; if (0.299 * dd0[q] + 0.587 * dd0[q + 1] + 0.114 * dd0[q + 2] > 125) M[y * pw + x] = 1; } // אותיות בהירות על לוח כהה
  const rs = new Int32Array(ph); for (let y = 0; y < ph; y++) { let c = 0; for (let x = 0; x < pw; x++) c += M[y * pw + x]; rs[y] = c; }
  let bands = [], st0 = -1; for (let y = 0; y <= ph; y++) { const on = y < ph && rs[y] > 0.035 * pw; if (on && st0 < 0) st0 = y; else if (!on && st0 >= 0) { bands.push([st0, y]); st0 = -1; } }
  const mxb = Math.max(1, ...bands.map(b => b[1] - b[0])), mb = [];
  for (const b of bands) { const l = mb[mb.length - 1]; if (l && b[0] - l[1] <= Math.max(2, 0.1 * mxb)) l[1] = b[1]; else mb.push(b.slice()); }
  const rows = mb.filter(b => b[1] - b[0] >= 0.25 * mxb).map(([b0, b1]) => { let x0 = pw, x1 = 0; for (let y = b0; y < b1; y++) for (let x = 0; x < pw; x++) if (M[y * pw + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; } return { x0: p.x + x0, x1: p.x + x1 + 1, y0: p.y + b0, y1: p.y + b1 }; });
  if (rows.length < 2) return null;
  const hs = rows.map(r => r.y1 - r.y0).sort((a, b) => a - b), medH = hs[hs.length >> 1], d = A.orig.d, SW = sc.W;
  const px = (x, y) => (y * SW + x) * 3;
  const tiles = rows.map((r, i) => { // כל שורה עם הרקע שסביבה, בתוך הלוח; לא חודרים לשורה השכנה, ומשווים גובה אותיות
    const rh = r.y1 - r.y0, padY = Math.round(0.1 * medH), padX = Math.round(0.22 * rh);
    const up = i > 0 ? Math.max(0, (r.y0 - rows[i - 1].y1) / 2) : 1e9, dn = i < rows.length - 1 ? Math.max(0, (rows[i + 1].y0 - r.y1) / 2) : 1e9;
    const x0 = clp(Math.round(r.x0 - padX), p.x + 3, p.x + p.w - 4), x1 = clp(Math.round(r.x1 + padX), x0 + 4, p.x + p.w - 3), y0 = clp(Math.round(r.y0 - Math.min(padY, up)), p.y + 3, p.y + p.h - 4), y1 = clp(Math.round(r.y1 + Math.min(padY, dn)), y0 + 4, p.y + p.h - 3);
    const k = clp((i === 0 && rows.length >= 4 ? 0.7 * medH : medH) / rh, 0.6, 1.4), tw = Math.max(4, Math.round((x1 - x0) * k)), th = Math.max(4, Math.round((y1 - y0) * k));
    const img = k === 1 ? cropImg({ w: SW, h: sc.H, c: 3, d }, x0, y0, x1, y1) : resize(cropImg({ w: SW, h: sc.H, c: 3, d }, x0, y0, x1, y1), tw, th, k < 1 ? 'area' : 'cubic');
    return { img, w: img.w, h: img.h, x0, y0, x1, y1 };
  });
  const bh = Math.max(...tiles.map(t => t.h)), fr = Math.max(2, Math.round(0.05 * bh)), bw = tiles.reduce((a, t) => a + t.w, 0) + 2 * fr, bhh = bh + 2 * fr;
  // רקע בסיס: חציון הלוח הכהה
  const med = [0, 1, 2].map(c => { const v = []; for (let y = p.y + 4; y < p.y + p.h - 4; y += 3) for (let x = p.x + 4; x < p.x + p.w - 4; x += 3) { const q = px(x, y); if (d[q] + d[q + 1] + d[q + 2] < 240) v.push(d[q + c]); } v.sort((a, b) => a - b); return v.length ? v[v.length >> 1] : 12; });
  const rgb = new Float32Array(bw * bhh * 3); for (let i = 0; i < bw * bhh; i++) { rgb[i * 3] = med[0]; rgb[i * 3 + 1] = med[1]; rgb[i * 3 + 2] = med[2]; }
  let cx = bw - fr; // מימין לשמאל לפי סדר הקריאה (עברית)
  for (const t of tiles) {
    cx -= t.w; const oy = fr + ((bh - t.h) >> 1);
    for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
      const e = Math.min(1, (x + 1) / 5, (t.w - x) / 5), si = (y * t.w + x) * 3, di = ((oy + y) * bw + cx + x) * 3;
      for (let c = 0; c < 3; c++) rgb[di + c] = rgb[di + c] * (1 - e) + t.img.d[si + c] * e;
    }
  }
  // מסגרת זהב: צבע מהתגית (הפיקסלים הבהירים והחמים)
  let gr = 0, gg = 0, gb = 0, gn = 0; { const t = tiles[0]; for (let y = t.y0; y < t.y1; y++) for (let x = t.x0; x < t.x1; x++) { const q = px(x, y), r = d[q], g = d[q + 1], b = d[q + 2]; if (r > 170 && r > b + 60 && g > 100) { gr += r; gg += g; gb += b; gn++; } } }
  const gold = gn > 20 ? [gr / gn, gg / gn, gb / gn] : [214, 168, 70];
  const rad = Math.max(3, 0.14 * bhh), a = rfRound(bw, bhh, rad, 0), ring = Math.max(1.4, 0.04 * bhh);
  for (let y = 0; y < bhh; y++) for (let x = 0; x < bw; x++) {
    const dx = Math.min(x + 0.5, bw - x - 0.5), dy = Math.min(y + 0.5, bhh - y - 0.5);
    let dd = Math.min(dx, dy); if (dx < rad && dy < rad) dd = rad - Math.hypot(rad - dx, rad - dy); // מרחק מהקצה, כולל פינות
    if (dd < ring) { const k = clp(ring - dd, 0, 1) * 0.95 + (dd < 0.6 ? 0.05 : 0); const i = (y * bw + x) * 3; rgb[i] = rgb[i] * (1 - k) + gold[0] * k; rgb[i + 1] = rgb[i + 1] * (1 - k) + gold[1] * k; rgb[i + 2] = rgb[i + 2] * (1 - k) + gold[2] * k; }
  }
  const barLeaf = { ...pk, id: 'panel_strip', layer: { rgb, a, lw: bw, lh: bhh, up: 1, x: p.x, y: p.y, w: bw, h: bhh }, x: p.x, y: p.y, w: bw, h: bhh };
  // סידור אופקי
  const mg = Math.max(2, 0.05 * H), barF = W >= 700 && AU.some(u => u.role === 'logo') ? 0.6 : 0.68, hb = Math.min(0.92 * H, barF * W * bhh / bw), wb = bw * hb / bhh;
  const barX = W - mg - wb, barY = (H - hb) / 2, place = [[barLeaf, barX, barY, wb, hb]];
  const isPrize = u => u.kids.length > 0 && u.kids.every(k => k.role === 'badge' || k.role === 'photo') && u.role !== 'badge';
  const btnU = AU.find(u => u.role === 'button'), logoU = AU.find(u => u.role === 'logo'), prizeU = AU.find(isPrize);
  if (!btnU) return null;
  const gap = 0.02 * W, items = []; let left = barX - gap - mg;
  const add = (u, hr, must) => { const h0 = hr * H, w0 = u.w / u.h * h0; let w1 = w0, h1 = h0; if (w0 > left) { if (!must) return; w1 = left; h1 = w1 * u.h / u.w; if (h1 < 0.4 * H) return; } items.push({ u, w: w1, h: h1 }); left -= w1 + gap; };
  add(btnU, logoU && W >= 700 ? 0.56 : 0.7, true); if (items.length !== 1) return null;
  if (prizeU && (W >= 1000 || H >= 80)) add(prizeU, 0.8, false);
  if (logoU && W >= 700) add(logoU, 0.62, false);
  // מימין לשמאל: כפתור, פרס, לוגו; המרווח שנשאר מתחלק בין הפריטים
  const tot = items.reduce((a, i) => a + i.w, 0), spare = barX - mg - tot, g = Math.min(spare / items.length, 0.06 * W);
  let xr = barX - Math.max(g, gap);
  for (const it of items) { const x = xr - it.w, y = (H - it.h) / 2, z = rfZone(sc, [it.u], x, y, it.w, it.h); if (!z) { if (it.u === btnU) return null; continue; } place.push(...z); xr = x - Math.max(g, gap); }
  // חלון הרקע: פס מהתמונה עם הכי מעט חורים מולאו
  const f = W / SW, wh = H / f; if (wh > sc.H) return null;
  const rowHole = new Float32Array(sc.H); for (let y = 0; y < sc.H; y++) { let c = 0; for (let x = 0; x < SW; x++) c += A.hole[y * SW + x]; rowHole[y] = c / SW; }
  let by = 0, bs = 1e9; for (let y0 = 0; y0 <= sc.H - wh; y0 += 2) { let h = 0; for (let y = Math.floor(y0); y < Math.ceil(y0 + wh); y++) h += rowHole[y]; const sc2 = h / wh; if (sc2 < bs) { bs = sc2; by = y0; } }
  return { J: 1, f, x0: 0, y0: by, ww: SW, wh, padT: 0, padB: 0, place, strategy: 'strip', native: false, R: { x: 0, y: 0, w: 0, h: 0 }, Rv: { x: 0, y: 0, w: 0, h: 0 }, A };
}
function rfBuild(sc, W, H) {
  const P = rfPrep(sc); if (!P) return null;
  const A = rfAssets(sc, P), SW = sc.W, SH = sc.H, hero = P.hero, km = Math.max(4, 0.03 * hero.w);
  const keep = { x: Math.max(0, hero.x - km), y: Math.max(0, hero.y - km), w: 0, h: 0 }; keep.w = Math.min(SW, hero.x + hero.w + km) - keep.x; keep.h = Math.min(SH, hero.y + hero.h + km) - keep.y;
  const face = { x: keep.x, y: keep.y, w: keep.w, h: 0.2 * keep.h }, heroC = hero.y + hero.h / 2, left = hero.x + hero.w / 2 < SW / 2;
  const fcov = Math.max(W / SW, H / SH), fmin = Math.max(W / SW, H / (SH * (1 + RF.maxPad))), fs = [];
  for (const z of [1.7, 1.45, 1.25, 1.12]) fs.push(fcov * z); // הגדלה: חלון קטן יותר שמוציא מהפריים את אזור היחידות שהוסרו (שם הרקע ממולא)
  for (let i = 0; i < 9; i++) fs.push(fcov * Math.pow(Math.min(1, fmin / fcov), i / 8));
  const gap = 0.012 * Math.min(W, H), mg = 0.03 * Math.min(W, H), rfp = u => u.y + u.h / 2 < heroC;
  const AU = rfKeepUnits(A.units, W, H), topU = AU.filter(rfp), botU = AU.filter(u => !rfp(u));
  if (W / H >= 7 && H <= 100) { let st = null; try { st = rfStrip(sc, W, H, P, A, AU); } catch (e) { if (G.__SIZY_DEBUG) throw e; } if (st) return st; }
  let best = null;
  const consider = (f, x0, y0, strategy, groups) => {
    const ww = W / f, wh = H / f; if (ww > SW + 0.5 || x0 < -0.5 || x0 + ww > SW + 0.5) return;
    const padT = Math.ceil(Math.max(0, -y0 - 0.01)), padB = Math.ceil(Math.max(0, y0 + wh - SH - 0.01)), pad = (padT + padB) / wh; if (pad > RF.maxPad) return;
    const R = { x: (keep.x - x0) * f, y: (keep.y - y0) * f, w: keep.w * f, h: keep.h * f }, Rv = rfInter(R, { x: 0, y: 0, w: W, h: H }), hv = rfArea(Rv) / rfArea(R);
    const fcy = (face.y - y0) * f, fch = face.h * f, fcx = (face.x - x0) * f; if (fcy < -1 || fcy + fch > H + 1 || fcx < -1 || fcx + face.w * f > W + 1) return; // הפנים חייבות להיות שלמות
    if (strategy === 'stack' && hv < 0.98) return; if (hv < (W / H > 4 ? 0.2 : 0.45)) return;
    let place = [];
    for (const g of groups) {
      const zr = g.zone(R, Rv); if (!zr) { if (g.units.length) return; continue; }
      const z = rfZone(sc, g.units, zr[0], zr[1], zr[2], zr[3]); if (!z) return; place = place.concat(z);
    }
    if (!place.length) return;
    const ids = new Set(place.map(e => e[0].id));
    for (const u of A.units) if (u.kids.some(k => k.role === 'button' || k.role === 'headline') && !u.kids.every(k => ids.has(k.id))) return; // כותרת וכפתור חייבים להישאר
    const sm = rfSmear(A, SW, SH, f, x0, y0, W, H, place), J = rfScore(place, W, H, Rv, hv, A.units.length, pad) - 6 * sm;
    if (G.__SIZY_RFLOG) G.__SIZY_RFLOG.push({ J, f, strategy, pad, hv, sm, head: place.filter(e => e[0].role === 'headline').reduce((a, e) => a + e[3], 0) });
    if (!best || J > best.J) best = { J, f, x0, y0, ww, wh, padT, padB, place, strategy, R, Rv, A };
  };
  const xRange = (f, ww) => [Math.max(0, keep.x + keep.w - ww), Math.min(SW - ww, keep.x)];
  const bestX = (x0lo, x0hi, ww, y0, wh) => { // החלון האופקי עם הכי הרבה פרטים
    if (x0hi < x0lo) return null; let bx = x0lo, bv = -1;
    const ya = clp(Math.round(y0), 0, SH), yb = clp(Math.round(y0 + wh), 0, SH), n = 24;
    for (let i = 0; i <= n; i++) {
      const x = Math.round(x0lo + (x0hi - x0lo) * i / n), xb = Math.min(SW, Math.round(x + ww)), I = A.I, w1 = SW + 1;
      const v = I[yb * w1 + xb] - I[ya * w1 + xb] - I[yb * w1 + x] + I[ya * w1 + x];
      if (v > bv) { bv = v; bx = x; }
    }
    return bx;
  };
  for (const f of fs) {
    const ww = W / f, wh = H / f; if (ww > SW + 0.5) continue;
    const [lo, hi] = xRange(f, ww);
    // מחסנית: הגיבור באמצע, יחידות מעליו ומתחתיו
    for (const ry of [0.14, 0.2, 0.26, 0.32, 0.38, 0.44, 0.5, 0.58]) {
      const R_h = keep.h * f, R_y = ry * H; if (R_y + R_h > H + 0.5) continue;
      const y0 = keep.y - R_y / f, x0 = bestX(lo, hi, ww, y0, wh); if (x0 === null) continue;
      for (const split of [[topU, botU], [AU, []], [[], AU]]) {
        if (split[0] === AU && !(split[0].length)) continue;
        const gs = [
          { units: split[0], zone: (R, Rv) => { const h = Rv.y - gap; return split[0].length ? (h >= 0.1 * H ? [0, 0, W, h] : null) : [0, 0, W, 0]; } },
          { units: split[1], zone: (R, Rv) => { const y = Rv.y + Rv.h + gap; return split[1].length ? (H - y >= 0.1 * H ? [0, y, W, H - y] : null) : [0, y, W, 0]; } }];
        consider(f, x0, y0, 'stack', gs);
      }
    }
    // לצד: הגיבור בקצה (בצד המקורי) והיחידות בעמודה לידו
    for (const al of ['bottom', 'center', 'top']) {
      const R_h = keep.h * f, R_y = al === 'bottom' ? H - mg - R_h : al === 'top' ? mg : (H - R_h) / 2, y0 = keep.y - R_y / f;
      const [lo2, hi2] = xRange(f, ww); let x0 = left ? keep.x - mg / f : keep.x + keep.w + mg / f - ww; x0 = clp(x0, lo2, hi2); if (hi2 < lo2) continue;
      for (const aligned of [false, true]) {
        const gs = [{ units: AU, zone: (R, Rv) => {
          let x1 = left ? Rv.x + Rv.w + gap : 0, x2 = left ? W : Rv.x - gap;
          if (aligned) { // העמודה מתחילה במקום שבו היו היחידות במקור (שם הרקע ממילא ממולא), ולא על נוף שלם
            const hx0 = (A.hb.x0 - x0) * f, hx1 = (A.hb.x1 - x0) * f; if (left) x1 = Math.max(x1, hx0 - gap); else x2 = Math.min(x2, hx1 + gap);
          }
          return x2 - x1 >= 0.25 * W ? [x1, 0, x2 - x1, H] : null;
        } }];
        consider(f, x0, y0, 'side', gs);
      }
    }
    // כמו מעצב: רצועת הפרס ברוחב מלא בתחתית, והגיבור והעמודה (כותרת, כפתור, לוגו) מעליה
    const isPrize = u => u.kids.length > 0 && u.kids.every(k => k.role === 'badge' || k.role === 'photo') && u.role !== 'badge';
    const prizeU = AU.filter(isPrize), restU = AU.filter(u => !isPrize(u));
    if (prizeU.length && restU.length && W / H < 1.6) for (const bhr of [0.15, 0.19, 0.24]) {
      const bh = bhr * H, R_h = keep.h * f, R_y = H - bh - gap - R_h, y0 = keep.y - R_y / f;
      const [lo2, hi2] = xRange(f, ww); if (hi2 < lo2 || R_y < 0) continue;
      const x0 = clp(left ? keep.x - mg / f : keep.x + keep.w + mg / f - ww, lo2, hi2);
      const gs = [
        { units: restU, zone: (R, Rv) => { const x1 = left ? Rv.x + Rv.w * 0.72 : 0, x2 = left ? W : Rv.x + Rv.w * 0.28; return x2 - x1 >= 0.3 * W && H - bh - gap >= 0.3 * H ? [x1, 0, x2 - x1, H - bh - gap] : null; } },
        { units: prizeU, zone: () => [mg * 0.5, H - bh, W - mg, bh - mg * 0.5] }];
      consider(f, x0, y0, 'sideband', gs);
    }
  }
  // native: כל היחידות והגיבור נשארים בפיקסלים של המקור (בלי חורים ובלי סידור מחדש); חלון אחד שמכיל את כולם, בריפוד אם צריך. מתאים ליחס קרוב למקור
  { const us0 = sc.units.filter(u => !u.kids.includes(hero)), us = rfKeepUnits(us0, W, H), bx0 = Math.min(keep.x, ...us.map(u => u.x)), bx1 = Math.max(keep.x + keep.w, ...us.map(u => u.x + u.w)), by0 = Math.min(keep.y, ...us.map(u => u.y)), by1 = Math.max(keep.y + keep.h, ...us.map(u => u.y + u.h));
    if (us.length === us0.length) for (const f of fs) { // מוריד יחידות => הרקע המקורי (עם היחידות אפויות בו) לא מתאים
      const ww = W / f, wh = H / f; if (ww > SW + 0.5 || ww < bx1 - bx0 || wh < by1 - by0) continue;
      const x0 = clp((bx0 + bx1) / 2 - ww / 2, 0, SW - ww), y0 = (by0 + by1) / 2 - wh / 2, padT = Math.ceil(Math.max(0, -y0 - 0.01)), padB = Math.ceil(Math.max(0, y0 + wh - SH - 0.01)), pad = (padT + padB) / wh; if (pad > RF.maxPad) continue;
      const place = []; for (const u of us) for (const k of u.kids) place.push([k, (k.x - x0) * f, (k.y - y0) * f, k.w * f, k.h * f]);
      const R = { x: (keep.x - x0) * f, y: (keep.y - y0) * f, w: keep.w * f, h: keep.h * f };
      let tiny = 0; for (const e of place) if (e[0].text && e[4] / Math.max(1, (e[0].lines || [1]).length) < 6.5) tiny++;
      const J = rfScore(place, W, H, R, 1, A.units.length, pad) - 0.35 * Math.min(1, tiny / 2);
      if (G.__SIZY_RFLOG) G.__SIZY_RFLOG.push({ J, f, strategy: 'native', pad, hv: 1, sm: 0, head: 0 });
      if (!best || J > best.J) best = { J, f, x0, y0, ww, wh, padT, padB, place, strategy: 'native', native: true, R, Rv: R, A };
    }
  }
  return best;
}
// אבחון: למה REFRAME פועל או לא פועל בבאנר הזה (מוצג למנהל בלבד)
function reframeWhy(sc) {
  if (G.__SIZY_NO_REFRAME) return 'REFRAME כבוי';
  if (!sc._img) return 'אין תמונת מקור בסצנה';
  const roles = [...new Set(sc.leaves.map(l => l.role))].join(','), heroes = sc.leaves.filter(l => l.role === 'hero');
  if (!heroes.length) return 'אין אלמנט hero. תפקידים שזוהו: ' + roles;
  const hs = heroes.filter(l => !l.text && l.layer && l.layer.rectHero);
  if (!hs.length) return 'ה-hero לא נחתך כמלבן (matted=' + heroes.map(l => !!(l.layer && l.layer.matted)).join(',') + ', rectHero=' + heroes.map(l => !!(l.layer && l.layer.rectHero)).join(',') + ')';
  const hero = hs.reduce((a, b) => (b.w * b.h > a.w * a.h ? b : a)), frac = hero.w * hero.h / (sc.W * sc.H);
  if (frac < 0.03) return 'ה-hero קטן מדי: ' + (frac * 100).toFixed(1) + '% מהבאנר';
  const ph = rfPhotoSrc(sc); if (ph.tex < RF.minTex || ph.flat > RF.maxFlat) return 'הרקע לא צילומי מספיק (tex ' + ph.tex.toFixed(2) + ', flat ' + ph.flat.toFixed(2) + ')';
  return 'REFRAME פעיל (hero ' + (frac * 100).toFixed(0) + '%, tex ' + ph.tex.toFixed(2) + ', flat ' + ph.flat.toFixed(2) + ')';
}
function reframeFor(sc, W, H, plan) {
  if (plan || !sc._img) return null;
  const P = rfPrep(sc); if (!P) return null;
  const c = sc._rfc || (sc._rfc = new Map()), key = W + 'x' + H; if (c.has(key)) return c.get(key);
  let r = null; try { r = rfBuild(sc, W, H); } catch (e) { if (G.__SIZY_DEBUG) throw e; r = null; }
  c.set(key, r); return r;
}

// ---------------------------------------------------------------- רינדור
// מחזיר { w, h, rgba: Uint8ClampedArray }
const PM = new WeakMap(); // שכבה בצבע מוכפל באלפא: מחושבת פעם אחת לכל שכבה ולא בכל גודל
function premul(L) {
  let pm = PM.get(L); if (pm) return pm;
  const n = L.lw * L.lh; pm = { w: L.lw, h: L.lh, c: 4, d: new Float32Array(n * 4) };
  for (let i = 0; i < n; i++) { const a = L.a[i]; pm.d[i * 4] = L.rgb[i * 3] * a; pm.d[i * 4 + 1] = L.rgb[i * 3 + 1] * a; pm.d[i * 4 + 2] = L.rgb[i * 3 + 2] * a; pm.d[i * 4 + 3] = a; }
  PM.set(L, pm); return pm;
}
function render(sc, W, H, K, plan) {
  K = K || 1;
  const Wk = Math.floor(W * K), Hk = Math.floor(H * K);
  const s = Math.max(Wk / sc.W, Hk / sc.H);
  let nw = Math.max(Wk, Math.round(sc.W * s)), nh = Math.max(Hk, Math.round(sc.H * s));
  const xs = G.SizyBg ? G.SizyBg.map(sc.W, sc.H, Wk, Hk) : null;
  let bg, ox, oy, panelBg = false;
  const cn = !plan && containFor(sc, W, H), rf = cn ? null : reframeFor(sc, W, H, plan);
  if (cn) { bg = containBg(sc, Wk, Hk); ox = 0; oy = 0; nw = Wk; nh = Hk; }
  else if (rf) { bg = reframeBg(sc, rf, Wk, Hk, K); ox = 0; oy = 0; nw = Wk; nh = Hk; }
  else if (xs) {
    const tall = resizePlate(sc.plate, sc.W, Hk); bg = { w: Wk, h: Hk, c: 3, d: new Float32Array(Wk * Hk * 3) }; ox = 0; oy = 0; nw = Wk; nh = Hk;
    for (let u = 0; u < Wk; u++) {
      const a = xs[u], b = Math.max(xs[u + 1], a + 0.001), i0 = Math.floor(a), i1 = Math.min(sc.W, Math.ceil(b));
      for (let y = 0; y < Hk; y++) {
        let r = 0, g = 0, bl = 0, ws = 0;
        for (let i = i0; i < i1; i++) { const w = Math.min(b, i + 1) - Math.max(a, i); if (w <= 0) continue; const o = (y * sc.W + i) * 3; r += tall.d[o] * w; g += tall.d[o + 1] * w; bl += tall.d[o + 2] * w; ws += w; }
        const o2 = (y * Wk + u) * 3; ws = ws || 1; bg.d[o2] = r / ws; bg.d[o2 + 1] = g / ws; bg.d[o2 + 2] = bl / ws;
      }
    }
  } else {
    ox = Math.floor((nw - Wk) / 2); oy = Math.floor((nh - Hk) / 2);
    if (G.SizyBg && nh > Hk + 2) { // חיתוך אנכי: שומרים את החלק העשיר בפרטים
      if (!sc.energy) sc.energy = G.SizyBg.rowEnergy(sc.plate.d, 3, sc.W, sc.H);
      const vis = Hk / s; let t0 = G.SizyBg.pickTop(sc.energy, sc.H, vis, sc.holeRows);
      if (sc.panels === undefined) sc.panels = G.SizyBg.panels(sc.plate.d, 3, sc.W, sc.H);
      const P = sc.panels; // פאנל ראשי + פס משני בצבע אחר: הרקע נלקח מהפאנל הראשי ולא מחיתוך שנוחת על הפס
      if (P && Wk / Hk >= 2 * sc.W / sc.H && G.SizyBg.touchesOther(P, t0, vis)) { // רק כשהבאנר החדש רחב בהרבה מהמקור
        const y0 = P.y0, n = P.y1 - P.y0;
        const es = sc.energy.subarray(y0, P.y1), mx = es.reduce((a, b) => Math.max(a, b), 0), calm = es.map(v => mx - v); // פאנל שטוח: בוחרים את הקטע השקט ביותר (בלי כתמים)
        t0 = y0 + G.SizyBg.pickTop(calm, n, Math.min(vis, n), sc.holeRows ? sc.holeRows.subarray(y0, P.y1) : null);
        t0 = Math.max(y0, Math.min(t0, Math.max(y0, P.y1 - vis))); panelBg = true;
      }
      oy = Math.max(0, Math.min(nh - Hk, Math.round(t0 * s)));
    }
    bg = resizePlate(sc.plate, nw, nh, { x0: ox, y0: oy, w: Wk, h: Hk }); nw = Wk; ox = 0; oy = 0;
  }
  const out = new Float32Array(Wk * Hk * 3);
  for (let y = 0; y < Hk; y++) out.set(bg.d.subarray(((y + oy) * nw + ox) * 3, ((y + oy) * nw + ox + Wk) * 3), y * Wk * 3);
  for (const [leaf, x, y, w, h] of (rf && rf.native ? [] : autoplace(sc, W, H, plan))) { // REFRAME native: היחידות כבר בפיקסלי הרקע
    if (w < 1 || h < 1) continue;
    const L = leaf.layer, tw = Math.max(1, Math.round(w * K)), th = Math.max(1, Math.round(h * K));
    const x0 = Math.round(x * K), y0 = Math.round(y * K);
    if (x0 >= Wk || y0 >= Hk || x0 + tw <= 0 || y0 + th <= 0) continue; // מחוץ לקנבס: אין מה לצייר
    let r = resampleLayer(L, tw, th, !!(leaf.text && tw > 3 && th > 3));
    const xa = Math.max(0, x0), ya = Math.max(0, y0), xb = Math.min(Wk, x0 + tw), yb = Math.min(Hk, y0 + th);
    // מצב מיזוג: טקסט בהיר על רקע כהה – מיזוג באור לינארי (קווים דקים לא נעשים אפורים); כהה על בהיר – sRGB רגיל
    let gam = 1;
    if (leaf.text) {
      let lt = 0, nt = 0, lb = 0, nb = 0;
      for (let yy = ya; yy < yb; yy += 2) for (let xx = xa; xx < xb; xx += 2) {
        const si = (yy - y0) * tw + (xx - x0), di = (yy * Wk + xx) * 3;
        if (r.a[si] > 0.6) { lt += 0.299 * r.rgb[si * 3] + 0.587 * r.rgb[si * 3 + 1] + 0.114 * r.rgb[si * 3 + 2]; nt++; } else if (r.a[si] < 0.05) { lb += 0.299 * out[di] + 0.587 * out[di + 1] + 0.114 * out[di + 2]; nb++; }
      }
      if (nt && nb) gam = lt / nt > lb / nb ? TUNE().gamLight : TUNE().gamDark;
      if (panelBg && nt && nb && lb / nb < 128 && (Math.max(lt / nt, lb / nb) + 13) / (Math.min(lt / nt, lb / nb) + 13) < 3) { r = { a: r.a, rgb: new Float32Array(r.rgb.length).fill(255) }; gam = TUNE().gamLight; } // רקע הפאנל הכהה החליף רקע בהיר: טקסט כהה (למשל כפתור) הופך ללבן כדי לא להיעלם
    }
    for (let yy = ya; yy < yb; yy++) for (let xx = xa; xx < xb; xx++) {
      const si = (yy - y0) * tw + (xx - x0), di = (yy * Wk + xx) * 3, al = r.a[si];
      if (al < 0.002) continue;
      if (al > 0.998 || gam === 1) { for (let k = 0; k < 3; k++) out[di + k] = out[di + k] * (1 - al) + r.rgb[si * 3 + k] * al; }
      else { const ig = 1 / gam; for (let k = 0; k < 3; k++) out[di + k] = 255 * Math.pow(Math.pow(Math.max(out[di + k], 0) / 255, gam) * (1 - al) + Math.pow(r.rgb[si * 3 + k] / 255, gam) * al, ig); }
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
    const o = { z: k.z, x, y, w, h }; if (k.absorbs) o.absorbs = k.absorbs;
    if (k.reflowed) { const L = k.layer, n = L.lw * L.lh, rgba = new Uint8ClampedArray(n * 4); for (let i = 0; i < n; i++) { rgba[i * 4] = L.rgb[i * 3]; rgba[i * 4 + 1] = L.rgb[i * 3 + 1]; rgba[i * 4 + 2] = L.rgb[i * 3 + 2]; rgba[i * 4 + 3] = L.a[i] * 255; } o.layer = { lw: L.lw, lh: L.lh, rgba }; }
    return o;
  });
}

G.SizyEngine = { BUILD: '15.15-א', reframeWhy, willReframe: sc => !!rfPrep(sc), reframeFor, reframeBg, containFor, containBg, setBans, describeUnits, planValid, buildScene, render, fromRGBA, layout, autoplace, exportScene, placements, resize, blur, _t: { resampleLayer, flatPalette, flatArtUp, resizeLim, usmLum, usmLim, edgeSmooth, wordsOf, reflowLeaf, textLayer, msFill, dilateDisk, medianBg, kmeans2, labelCC, percentile } };
})(globalThis);
