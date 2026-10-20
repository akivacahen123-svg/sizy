// סייזי · מט (matte) לדמות/תמונה ראשית שלא נוגעת בקצה: חיתוך לפי הצורה במקום מלבן עם הרקע המקורי.
// המודול לא תלוי במודל: מקבל פונקציית הרצה runModel(Float32Array NCHW 1x3x320x320) -> Float32Array 320x320
// (U^2-Net / u2netp, רישיון Apache-2.0; ב-Node: bench/neural/matte_node.mjs, בדפדפן: onnxruntime-web).
// attach() מוסיף לכל אלמנט hero את e.matte = {x0,y0,w,h,a:Uint8Array} (בפיקסלי התמונה) ש-graphicLayer במנוע משתמש בו.
(function (G) {
'use strict';
const N = 320, MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
const clp = (v, a, b) => Math.max(a, Math.min(b, v));

function bilinear(src, sw, sh, ch, dw, dh) { // src: מערך שזור ch ערוצים
  const out = new Float32Array(dw * dh * ch);
  for (let y = 0; y < dh; y++) {
    const fy = clp((y + 0.5) * sh / dh - 0.5, 0, sh - 1), y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = clp((x + 0.5) * sw / dw - 0.5, 0, sw - 1), x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      for (let c = 0; c < ch; c++) {
        const a = src[(y0 * sw + x0) * ch + c], b = src[(y0 * sw + x1) * ch + c], d = src[(y1 * sw + x0) * ch + c], e = src[(y1 * sw + x1) * ch + c];
        out[(y * dw + x) * ch + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (d * (1 - tx) + e * tx) * ty;
      }
    }
  }
  return out;
}

// קדם-עיבוד ל-U2Net: חיתוך (x0,y0,w,h) מתמונה {w,h,d:Float32 RGB 0..255}
function preprocess(img, x0, y0, w, h) {
  const crop = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) crop.set(img.d.subarray(((y0 + y) * img.w + x0) * 3, ((y0 + y) * img.w + x0 + w) * 3), y * w * 3);
  const r = bilinear(crop, w, h, 3, N, N), t = new Float32Array(3 * N * N);
  for (let i = 0; i < N * N; i++) for (let c = 0; c < 3; c++) t[c * N * N + i] = (r[i * 3 + c] / 255 - MEAN[c]) / STD[c];
  return t;
}

// פלט המודל -> אלפא Uint8 בגודל החיתוך: נרמול min-max, עקומה שמחדדת את השוליים, מרכיב קשור גדול + מילוי חורים קטנים
function postprocess(p, w, h) {
  let mn = 1e9, mx = -1e9; for (let i = 0; i < p.length; i++) { if (p[i] < mn) mn = p[i]; if (p[i] > mx) mx = p[i]; }
  const nrm = new Float32Array(p.length); for (let i = 0; i < p.length; i++) nrm[i] = (p[i] - mn) / Math.max(1e-6, mx - mn);
  const a = bilinear(nrm, N, N, 1, w, h), out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) { const v = clp((a[i] - 0.25) / 0.5, 0, 1); out[i] = Math.round(v * v * (3 - 2 * v) * 255); }
  return out;
}

// כל אלמנט גרפי צף (לוגו, תגית, חותמת, מדבקה, תמונה קטנה) מקבל חיתוך עצבי כמו שירות הסרת רקע, בלי קשר לתפקיד שג'מיני נתן לו.
// לא נחתכים: טקסט, כפתור/כמוסה, לוח שמכיל אלמנטים אחרים (כותרת/רצועת פרס), רצועה רחבה מאוד, ואלמנט שיושב בתוך לוח כזה.
const inside = (a, b) => { const cx = (a[0] + a[2]) / 2, cy = (a[1] + a[3]) / 2; return cx > b[0] && cx < b[2] && cy > b[1] && cy < b[3]; };
const isCutout = (e, all) => {
  if (!e || e.role === 'hero' || e.role === 'button' || e.role === 'decor' || e.shape === 'pill' || e.shape === 'panel' || (e.lines && e.lines.length) || !Array.isArray(e.box)) return false;
  if (!['logo', 'badge', 'photo', 'brand', 'sticker', 'icon'].includes(e.role)) return false;
  const b = e.box.map(Number), w = b[2] - b[0], h = b[3] - b[1]; if (!(w > 0 && h > 0) || w > 2.4 * h || h > 2.4 * w) return false;
  for (const o of all || []) { if (o === e || !Array.isArray(o.box)) continue; const ob = o.box.map(Number); if (o.role !== 'hero' && inside(ob, b)) return false; if (o.role !== 'hero' && !(o.lines && o.lines.length) && o.role !== 'logo' && inside(b, ob)) return false; }
  return true;
};
async function attach(img, elements, runModel, opts) {
  const o = Object.assign({ pad: 0.06, minArea: 0.004 }, opts), W = img.w, H = img.h;
  for (const e of elements || []) {
    if (!(e.role === 'hero' || isCutout(e, elements)) || e.matte) continue;
    const b = (e.box || []).map(Number); if (b.length !== 4 || b.some(v => !isFinite(v))) continue;
    let x1 = Math.round(b[0] / 1000 * W), y1 = Math.round(b[1] / 1000 * H), x2 = Math.round(b[2] / 1000 * W), y2 = Math.round(b[3] / 1000 * H);
    if ((x2 - x1) * (y2 - y1) < (e.role === 'hero' ? o.minArea : 0.0004) * W * H) continue;
    // תמונה שנוגעת בקצה הבאנר נשארת מלבן (תיגרר לקצה בלי הילה); רק אלמנט צף מקבל מט
    if (e.role === 'hero' && (x1 <= 2 || y1 <= 2 || x2 >= W - 2 || y2 >= H - 2)) continue;
    const pp = e.role === 'hero' ? o.pad : 0.12, px = Math.round((x2 - x1) * pp), py = Math.round((y2 - y1) * pp);
    const X0 = clp(x1 - px, 0, W - 8), Y0 = clp(y1 - py, 0, H - 8), X1 = clp(x2 + px, X0 + 8, W), Y1 = clp(y2 + py, Y0 + 8, H), w = X1 - X0, h = Y1 - Y0;
    let p; try { p = await runModel(preprocess(img, X0, Y0, w, h)); } catch (err) { if (opts && opts.debug) console.error(err); continue; }
    if (!p || p.length !== N * N) continue;
    const a = postprocess(p, w, h);
    let n = 0; for (let i = 0; i < a.length; i++) if (a[i] > 127) n++;
    const frac = n / a.length; if (frac < 0.12 || frac > 0.92) continue; // המודל לא מצא דמות סבירה: נשארים עם הנתיב הרגיל
    e.matte = { x0: X0, y0: Y0, w, h, a };
  }
  return elements;
}

G.SizyMatte = { isCutout, attach, preprocess, postprocess, N };
})(typeof self !== 'undefined' ? self : globalThis);
