// סייזי · השלמת רקע בלי מודל: PatchMatch (השלמה לפי דוגמאות, מהגס לעדין) לאזורים עם טקסטורה, מילוי הרמוני/חלק לאזורים חלקים,
// ומיזוג פואסון בשפת החור כדי שלא ייראה תפר. הכל על מערכי Float32, בלי תלות, ורץ פעם אחת לכל סצנה (buildScene).
// API: SizyFill.refine(img, hole, base, opts) -> { fill, weight, stats }
//   img  = { w, h, d: Float32Array rgb } התמונה המקורית, hole = Uint8Array (1 = חור), base = Float32Array rgb (מילוי חלק קיים)
//   fill = מילוי חדש (נבחר פר-פיקסל לפי שונות מקומית), weight = כמה מהמילוי הוא טקסטורה מסונתזת (0..1)
(function (G) {
  'use strict';
  const clp = (v, a, b) => Math.max(a, Math.min(b, v));
  function mulberry(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const PR = 2; // רדיוס טלאי (5x5)

  // ממוצע ריבועי מהיר באמצעות תמונה אינטגרלית (a: Float32Array w*h)
  function boxMean(a, w, h, r) {
    const I = new Float64Array((w + 1) * (h + 1));
    for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x < w; x++) { s += a[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + s; } }
    const o = new Float32Array(w * h);
    for (let y = 0; y < h; y++) { const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1); for (let x = 0; x < w; x++) { const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1); o[y * w + x] = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0)); } }
    return o;
  }
  function dilate(m, w, h, r) { const b = boxMean(Float32Array.from(m), w, h, r); const o = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) o[i] = b[i] > 1e-7 ? 1 : 0; return o; }
  function erode(m, w, h, r) { const inv = new Float32Array(w * h); for (let i = 0; i < w * h; i++) inv[i] = m[i] ? 0 : 1; const b = boxMean(inv, w, h, r); const o = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) o[i] = b[i] < 1e-7 ? 1 : 0; return o; }
  function comps(m, w, h) {
    const lab = new Int32Array(w * h), res = [], st = new Int32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (!m[i] || lab[i]) continue;
      const id = res.length + 1; let n = 0, x0 = w, y0 = h, x1 = 0, y1 = 0, sp = 0; st[sp++] = i; lab[i] = id;
      while (sp) {
        const p = st[--sp], x = p % w, y = (p - x) / w; n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x > 0 && m[p - 1] && !lab[p - 1]) { lab[p - 1] = id; st[sp++] = p - 1; } if (x < w - 1 && m[p + 1] && !lab[p + 1]) { lab[p + 1] = id; st[sp++] = p + 1; }
        if (y > 0 && m[p - w] && !lab[p - w]) { lab[p - w] = id; st[sp++] = p - w; } if (y < h - 1 && m[p + w] && !lab[p + w]) { lab[p + w] = id; st[sp++] = p + w; }
      }
      res.push({ id, n, x0, y0, x1, y1 });
    }
    return { lab, res };
  }

  // ---- שונות מקומית ("פעילות"): ממוצע |תדר גבוה| של פיקסלים ידועים, מורחב לתוך החורים בנרמול
  function activityMap(img, hole, w, h) {
    const N = w * h, g = new Float32Array(N);
    for (let i = 0; i < N; i++) g[i] = 0.299 * img.d[i * 3] + 0.587 * img.d[i * 3 + 1] + 0.114 * img.d[i * 3 + 2];
    const bl = boxMean(g, w, h, 2), hole3 = dilate(hole, w, h, 3);
    // תדר גבוה ברזולוציה מלאה, ואז סכימה לחצי רזולוציה (מפת שונות חלקה לא צריכה יותר)
    const cw = (w + 1) >> 1, ch = (h + 1) >> 1, C = cw * ch, num = new Float32Array(C), den = new Float32Array(C);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (hole3[i]) continue; const c = (y >> 1) * cw + (x >> 1); num[c] += Math.min(40, Math.abs(g[i] - bl[i])); den[c]++; }
    for (let c = 0; c < C; c++) if (den[c] > 0) { num[c] /= den[c]; den[c] /= 4; }
    const act = new Float32Array(C), set = new Uint8Array(C);
    for (const R of [3, 6, 12, 24, 48, 96]) {
      if (R > 2 * Math.max(cw, ch)) break;
      const A = boxMean(num, cw, ch, R), D = boxMean(den, cw, ch, R);
      // num כבר ממוצע לתא; משקלל בצפיפות הידועה
      const NW = new Float32Array(C); for (let c = 0; c < C; c++) NW[c] = num[c] * den[c];
      const A2 = boxMean(NW, cw, ch, R);
      for (let i = 0; i < C; i++) if (!set[i] && D[i] > 0.12) { act[i] = A2[i] / D[i]; set[i] = 1; }
      void A;
    }
    const out = new Float32Array(N);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = act[Math.min(ch - 1, y >> 1) * cw + Math.min(cw - 1, x >> 1)];
    return out;
  }

  // ---- פתרון לפלס על מסכה (h = ממוצע שכנים), מהגס לעדין: rhs[p] = סכום ערכי שפה (מהשכנים הידועים) לכל ערוץ
  // free: Uint8 (1 = נעלם), bnd: Float32 (3 ערוצים) הערך שנכנס מכל שכן ידוע (סכום), nk: כמה שכנים ידועים (0..4)
  function laplaceSolve(free, bnd, nk, w, h) {
    const N = w * h, out = new Float32Array(N * 3);
    // רמה גסה: תאים בגודל f
    const f = Math.max(1, Math.round(Math.max(w, h) / 90));
    if (f > 1) {
      const cw = Math.ceil(w / f), ch = Math.ceil(h / f), C = cw * ch;
      const cf = new Uint8Array(C), cb = new Float32Array(C * 3), cn = new Float32Array(C), cc = new Float32Array(C);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (!free[i]) continue; const c = ((y / f) | 0) * cw + ((x / f) | 0); cf[c] = 1; cc[c]++; cn[c] += nk[i]; for (let k = 0; k < 3; k++) cb[c * 3 + k] += bnd[i * 3 + k]; }
      const val = new Float32Array(C * 3), list = [];
      for (let c = 0; c < C; c++) if (cf[c]) list.push(c);
      for (let it = 0; it < 100; it++) for (const c of list) {
        const x = c % cw, y = (c / cw) | 0; let ns = 0, s0 = 0, s1 = 0, s2 = 0;
        if (x > 0 && cf[c - 1]) { ns++; s0 += val[(c - 1) * 3]; s1 += val[(c - 1) * 3 + 1]; s2 += val[(c - 1) * 3 + 2]; }
        if (x < cw - 1 && cf[c + 1]) { ns++; s0 += val[(c + 1) * 3]; s1 += val[(c + 1) * 3 + 1]; s2 += val[(c + 1) * 3 + 2]; }
        if (y > 0 && cf[c - cw]) { ns++; s0 += val[(c - cw) * 3]; s1 += val[(c - cw) * 3 + 1]; s2 += val[(c - cw) * 3 + 2]; }
        if (y < ch - 1 && cf[c + cw]) { ns++; s0 += val[(c + cw) * 3]; s1 += val[(c + cw) * 3 + 1]; s2 += val[(c + cw) * 3 + 2]; }
        const kn = cn[c] / cc[c], den = ns + kn; if (den <= 0) continue;
        val[c * 3] = (s0 + cb[c * 3] / cc[c]) / den; val[c * 3 + 1] = (s1 + cb[c * 3 + 1] / cc[c]) / den; val[c * 3 + 2] = (s2 + cb[c * 3 + 2] / cc[c]) / den;
      }
      for (let y = 0; y < h; y++) {
        const fy = clp((y + 0.5) / f - 0.5, 0, ch - 1), y0 = Math.floor(fy), y1 = Math.min(ch - 1, y0 + 1), ty = fy - y0;
        for (let x = 0; x < w; x++) {
          if (!free[y * w + x]) continue;
          const fx = clp((x + 0.5) / f - 0.5, 0, cw - 1), x0 = Math.floor(fx), x1 = Math.min(cw - 1, x0 + 1), tx = fx - x0;
          for (let k = 0; k < 3; k++) out[(y * w + x) * 3 + k] = (val[(y0 * cw + x0) * 3 + k] * (1 - tx) + val[(y0 * cw + x1) * 3 + k] * tx) * (1 - ty) + (val[(y1 * cw + x0) * 3 + k] * (1 - tx) + val[(y1 * cw + x1) * 3 + k] * tx) * ty;
        }
      }
    }
    const list = []; for (let i = 0; i < N; i++) if (free[i]) list.push(i);
    const iters = f > 1 ? 10 : 60;
    for (let it = 0; it < iters; it++) for (const i of list) {
      const x = i % w, y = (i - x) / w; let ns = 0, s0 = 0, s1 = 0, s2 = 0;
      if (x > 0 && free[i - 1]) { ns++; s0 += out[(i - 1) * 3]; s1 += out[(i - 1) * 3 + 1]; s2 += out[(i - 1) * 3 + 2]; }
      if (x < w - 1 && free[i + 1]) { ns++; s0 += out[(i + 1) * 3]; s1 += out[(i + 1) * 3 + 1]; s2 += out[(i + 1) * 3 + 2]; }
      if (y > 0 && free[i - w]) { ns++; s0 += out[(i - w) * 3]; s1 += out[(i - w) * 3 + 1]; s2 += out[(i - w) * 3 + 2]; }
      if (y < h - 1 && free[i + w]) { ns++; s0 += out[(i + w) * 3]; s1 += out[(i + w) * 3 + 1]; s2 += out[(i + w) * 3 + 2]; }
      const den = ns + nk[i]; if (den <= 0) continue;
      out[i * 3] = (s0 + bnd[i * 3]) / den; out[i * 3 + 1] = (s1 + bnd[i * 3 + 1]) / den; out[i * 3 + 2] = (s2 + bnd[i * 3 + 2]) / den;
    }
    return out;
  }

  // ---- PatchMatch מהגס לעדין על חלון (crop). col: Float32 rgb (מכיל מילוי חלק בחור), inv: חורים (לא מקור), tgt: מה לסנתז
  function buildLevel(col, inv, tgt, w, h) {
    // srcOK: טלאי 5x5 שכולו ידוע ובתוך התמונה
    const dh = dilate(inv, w, h, PR), bad = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) bad[i] = dh[i] ? 0 : 1; // 1 = כל השכונה ידועה
    const ok = new Uint8Array(w * h), list = [];
    for (let y = PR; y < h - PR; y++) for (let x = PR; x < w - PR; x++) { const i = y * w + x; if (bad[i]) { ok[i] = 1; list.push(i); } }
    // מדריך צבע נמוך-תדר (קבוע): בחור הוא המילוי החלק, מחוץ לחור הטשטוש של הצבע האמיתי. מונע ייבוא טקסטורה בצבע אחר (עלים, פרחים) לאזור שהמילוי החלק אומר שהוא כהה/בהיר
    const g = new Float32Array(w * h * 3), ch = new Float32Array(w * h);
    for (let k = 0; k < 3; k++) { for (let i = 0; i < w * h; i++) ch[i] = col[i * 3 + k]; const b = boxMean(ch, w, h, GR); for (let i = 0; i < w * h; i++) g[i * 3 + k] = b[i]; }
    return { w, h, col, inv, tgt, ok, g, src: Int32Array.from(list) };
  }
  function down2(L) {
    const w = L.w, h = L.h, cw = Math.max(1, w >> 1), ch = Math.max(1, h >> 1);
    const col = new Float32Array(cw * ch * 3), inv = new Uint8Array(cw * ch), tgt = new Uint8Array(cw * ch);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const c = y * cw + x; let n = 0, s0 = 0, s1 = 0, s2 = 0, iv = 0, tg = 0;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const xx = Math.min(w - 1, 2 * x + dx), yy = Math.min(h - 1, 2 * y + dy), i = yy * w + xx;
        n++; s0 += L.col[i * 3]; s1 += L.col[i * 3 + 1]; s2 += L.col[i * 3 + 2]; if (L.inv[i]) iv = 1; if (L.tgt[i]) tg = 1;
      }
      col[c * 3] = s0 / n; col[c * 3 + 1] = s1 / n; col[c * 3 + 2] = s2 / n; inv[c] = iv; tgt[c] = tg;
    }
    return buildLevel(col, inv, tgt, cw, ch);
  }
  const GR = 3, GW = 40; // רדיוס המדריך ומשקלו
  const KU = 2500; // עונש שימוש חוזר באותו מקור (נגד אריחים חוזרים)
  const PEN = 6; // עונש מרחק (SSD ליחידת פיקסל): מעדיף מקור קרוב ולא טקסטורה מרחוק
  function cost(L, px, py, qx, qy, cut) {
    const w = L.w, d = L.col; let s = 0;
    const g = L.g, gp = (py * w + px) * 3, gq = (qy * w + qx) * 3;
    const gd = GW * ((g[gp] - g[gq]) * (g[gp] - g[gq]) + (g[gp + 1] - g[gq + 1]) * (g[gp + 1] - g[gq + 1]) + (g[gp + 2] - g[gq + 2]) * (g[gp + 2] - g[gq + 2]));
    const dd = Math.sqrt((px - qx) * (px - qx) + (py - qy) * (py - qy)), pen = PEN * dd + gd, lim = cut - pen;
    if (lim <= 0) return 1e30;
    if (px >= PR && py >= PR && px < w - PR && py < L.h - PR) {
      for (let dy = -PR; dy <= PR; dy++) {
        const a = ((py + dy) * w + px - PR) * 3, b = ((qy + dy) * w + qx - PR) * 3;
        for (let k = 0; k < 15; k++) { const t = d[a + k] - d[b + k]; s += t * t; }
        if (s >= lim) return 1e30;
      }
    } else {
      for (let dy = -PR; dy <= PR; dy++) for (let dx = -PR; dx <= PR; dx++) {
        const a = (clp(py + dy, 0, L.h - 1) * w + clp(px + dx, 0, w - 1)) * 3, b = ((qy + dy) * w + qx + dx) * 3;
        for (let k = 0; k < 3; k++) { const t = d[a + k] - d[b + k]; s += t * t; }
      }
      if (s >= lim) return 1e30;
    }
    return s + pen;
  }
  function pmIter(L, F, rnd, rev, R0) {
    const { w, h } = L, T = F.t, n = T.length;
    for (let ii = 0; ii < n; ii++) {
      const t = rev ? T[n - 1 - ii] : T[ii], px = t % w, py = (t - px) / w;
      let bx = F.ox[t], by = F.oy[t], bc = F.cost[t];
      const tryq = (qx, qy) => {
        if (qx < PR || qy < PR || qx >= w - PR || qy >= h - PR || !L.ok[qy * w + qx]) return;
        const qi = qy * w + qx, u = F.use[qi]; let c = cost(L, px, py, qx, qy, bc - KU * u); if (c < 1e29) c += KU * u;
        if (c < bc) { bc = c; bx = qx; by = qy; }
      };
      const sx = rev ? 1 : -1, nbx = px + sx, nby = py + sx;
      // ox,oy = מיקום המקור (מוחלט); הפצה: ההיסט של השכן מוחל על הפיקסל הנוכחי
      if (nbx >= 0 && nbx < w && L.tgt[py * w + nbx]) { const o = py * w + nbx; tryq(F.ox[o] + (px - nbx), F.oy[o]); }
      if (nby >= 0 && nby < h && L.tgt[nby * w + px]) { const o = nby * w + px; tryq(F.ox[o], F.oy[o] + (py - nby)); }
      for (let R = R0; R >= 1; R = Math.floor(R / 2)) tryq(Math.round(bx + (rnd() * 2 - 1) * R), Math.round(by + (rnd() * 2 - 1) * R));
      if (bx !== F.ox[t] || by !== F.oy[t]) { F.use[F.oy[t] * w + F.ox[t]]--; F.use[by * w + bx]++; }
      F.ox[t] = bx; F.oy[t] = by; F.cost[t] = bc;
    }
  }
  function vote(L, F) {
    const { w, h } = L, T = F.t, acc = F.acc, wt = F.wt;
    // משקל לכל מרכז-טלאי לפי עלות; ההצבעה של פיקסל t = צבע המקור (t + היסט) ממרכזים סמוכים
    for (let k = 0; k < T.length; k++) {
      const t = T[k], x = t % w, y = (t - x) / w; let s0 = 0, s1 = 0, s2 = 0, sw = 0;
      for (let dy = -PR; dy <= PR; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -PR; dx <= PR; dx++) {
        const xx = x + dx; if (xx < 0 || xx >= w) continue; const c = yy * w + xx; if (!L.tgt[c]) continue;
        // המקור של הפיקסל t לפי מרכז c: מיקום מקור של c + (t - c)
        const sx = F.ox[c] + (x - xx), sy = F.oy[c] + (y - yy);
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
        const wgt = 1 / (1 + F.cost[c] / 75 / 60), o = (sy * w + sx) * 3;
        s0 += L.col[o] * wgt; s1 += L.col[o + 1] * wgt; s2 += L.col[o + 2] * wgt; sw += wgt;
      } }
      if (sw > 0) { acc[k * 3] = s0 / sw; acc[k * 3 + 1] = s1 / sw; acc[k * 3 + 2] = s2 / sw; } else { acc[k * 3] = L.col[t * 3]; acc[k * 3 + 1] = L.col[t * 3 + 1]; acc[k * 3 + 2] = L.col[t * 3 + 2]; }
    }
    for (let k = 0; k < T.length; k++) { const t = T[k]; L.col[t * 3] = acc[k * 3]; L.col[t * 3 + 1] = acc[k * 3 + 1]; L.col[t * 3 + 2] = acc[k * 3 + 2]; }
  }
  function newField(L) {
    const t = []; for (let i = 0; i < L.w * L.h; i++) if (L.tgt[i]) t.push(i);
    const n = L.w * L.h;
    return { t: Int32Array.from(t), ox: new Int32Array(n), oy: new Int32Array(n), cost: new Float32Array(n).fill(1e30), use: new Uint16Array(n), acc: new Float32Array(t.length * 3) };
  }
  function initField(L, F, rnd) {
    const w = L.w;
    for (const t of F.t) {
      const px = t % w, py = (t - px) / w; let bc = 1e30, bx = 0, by = 0;
      for (let k = 0; k < 10; k++) { const q = L.src[(rnd() * L.src.length) | 0], qx = q % w, qy = (q - qx) / w; const c = cost(L, px, py, qx, qy, bc); if (c < bc) { bc = c; bx = qx; by = qy; } }
      if (bc >= 1e30) { const q = L.src[(rnd() * L.src.length) | 0]; bx = q % w; by = (q - bx) / w; bc = cost(L, px, py, bx, by, 1e30); }
      F.ox[t] = bx; F.oy[t] = by; F.cost[t] = bc; F.use[by * w + bx]++;
    }
  }
  function upField(Lc, Fc, L, F, rnd) {
    const w = L.w;
    for (const t of F.t) {
      const px = t % w, py = (t - px) / w, cx = Math.min(Lc.w - 1, px >> 1), cy = Math.min(Lc.h - 1, py >> 1), c = cy * Lc.w + cx;
      let qx, qy, okq = false;
      if (Lc.tgt[c]) { qx = Fc.ox[c] * 2 + (px & 1); qy = Fc.oy[c] * 2 + (py & 1); okq = qx >= PR && qy >= PR && qx < w - PR && qy < L.h - PR && L.ok[qy * w + qx] === 1; }
      if (!okq) { const q = L.src[(rnd() * L.src.length) | 0]; qx = q % w; qy = (q - qx) / w; }
      F.ox[t] = qx; F.oy[t] = qy; F.cost[t] = cost(L, px, py, qx, qy, 1e30); F.use[qy * w + qx]++;
    }
  }

  // סינתזה לרכיב אחד: מחזיר Float32 rgb של החלון (צבעים סופיים במקום tgt)
  function synth(cropCol, cropInv, cropTgt, w, h, rnd, maxHole) {
    let L0 = buildLevel(cropCol, cropInv, cropTgt, w, h);
    const levels = [L0];
    const nlev = clp(Math.ceil(Math.log2(Math.max(8, maxHole) / 14)), 1, 5);
    for (let l = 1; l < nlev; l++) { const c = down2(levels[l - 1]); if (c.src.length < 50) break; levels.push(c); }
    let prev = null, prevF = null;
    for (let l = levels.length - 1; l >= 0; l--) {
      const L = levels[l], F = newField(L);
      if (!F.t.length) { prev = L; prevF = F; continue; }
      if (L.src.length < 20) return null;
      if (prev) upField(prev, prevF, L, F, rnd); else initField(L, F, rnd);
      if (prev) vote(L, F);
      const its = l === levels.length - 1 ? 5 : l === 0 ? 2 : 3, R0 = l === levels.length - 1 ? Math.max(L.w, L.h) : Math.min(24, Math.max(L.w, L.h));
      for (let it = 0; it < its; it++) { pmIter(L, F, rnd, it & 1, R0); vote(L, F); }
      prev = L; prevF = F;
    }
    return L0.col;
  }

  function refine(img, hole, base, opts) {
    opts = opts || {};
    const w = img.w, h = img.h, N = w * h, t0 = Date.now();
    const weight = new Float32Array(N), fill = Float32Array.from(base), stats = { regions: 0, px: 0, skipped: 0 };
    let nh = 0; for (let i = 0; i < N; i++) nh += hole[i];
    if (!nh) return { fill, weight, stats };
    const act = activityMap(img, hole, w, h);
    const lo = opts.lo == null ? 1.8 : opts.lo, hi = opts.hi == null ? 4.2 : opts.hi;
    const wmap = new Float32Array(N); // רצון לטקסטורה לפי פעילות מקומית
    for (let i = 0; i < N; i++) { const t = clp((act[i] - lo) / (hi - lo), 0, 1); wmap[i] = opts.force ? 1 : t * t * (3 - 2 * t); }
    const merged = dilate(hole, w, h, 5), { lab, res } = comps(merged, w, h);
    const order = res.map((c, i) => ({ c, i })).filter(o => o.c.n >= 30).sort((a, b) => b.c.n - a.c.n);
    const budget = opts.budget || 90000, deadline = t0 + (opts.ms || 1300); let used = 0;
    const rnd = mulberry(1234);
    for (const { c } of order) {
      // כמה חור יש ברכיב, וכמה טקסטורה רצויה בו
      const idx = []; let sw = 0;
      for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) { const i = y * w + x; if (hole[i] && lab[i] === c.id) { idx.push(i); sw += wmap[i]; } }
      if (idx.length < 20) continue;
      if (Date.now() > deadline) { stats.skipped++; continue; }
      if (sw / idx.length < 0.08) { stats.skipped++; continue; }
      if (idx.length > (opts.maxFrac || 0.3) * N || used + idx.length > budget) { stats.skipped++; continue; }
      const bw = c.x1 - c.x0 + 1, bh = c.y1 - c.y0 + 1, M = clp(Math.round(0.7 * Math.max(bw, bh)), 26, 90);
      const X0 = Math.max(0, c.x0 - M), Y0 = Math.max(0, c.y0 - M), X1 = Math.min(w, c.x1 + 1 + M), Y1 = Math.min(h, c.y1 + 1 + M), cw = X1 - X0, ch = Y1 - Y0;
      const col = new Float32Array(cw * ch * 3), inv = new Uint8Array(cw * ch), tgt = new Uint8Array(cw * ch);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const gi = (Y0 + y) * w + X0 + x, ci = y * cw + x;
        const hh = hole[gi] === 1; inv[ci] = hh || (opts.avoid && opts.avoid[gi]) ? 1 : 0;
        if (hh && lab[gi] === c.id) tgt[ci] = 1;
        for (let k = 0; k < 3; k++) col[ci * 3 + k] = hh ? base[gi * 3 + k] : img.d[gi * 3 + k];
      }
      // לא מתקרבים לשפה: פיקסלים ידועים בצמוד לחור מכילים שאריות הילה
      const inv2 = dilate(inv, cw, ch, 1); for (let i = 0; i < cw * ch; i++) inv[i] = inv2[i];
      const out = synth(col.slice(), inv, tgt, cw, ch, rnd, Math.max(bw, bh));
      if (!out) { stats.skipped++; continue; }
      // פואסון: תיקון הרמוני של הפרש הצבע בשפת החור (החלקה בלי תפר)
      const free = tgt, bnd = new Float32Array(cw * ch * 3), nk = new Float32Array(cw * ch);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const i = y * cw + x; if (!free[i]) continue;
        for (let e = 0; e < 4; e++) {
          const q = e === 0 ? (x > 0 ? i - 1 : -1) : e === 1 ? (x < cw - 1 ? i + 1 : -1) : e === 2 ? (y > 0 ? i - cw : -1) : (y < ch - 1 ? i + cw : -1);
          if (q < 0 || free[q]) continue; nk[i]++; const gq = (Y0 + ((q / cw) | 0)) * w + X0 + (q % cw); for (let k = 0; k < 3; k++) bnd[i * 3 + k] += img.d[gq * 3 + k] - out[i * 3 + k];
        }
      }
      const hc = laplaceSolve(free, bnd, nk, cw, ch);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const ci = y * cw + x; if (!tgt[ci]) continue; const gi = (Y0 + y) * w + X0 + x, wg = wmap[gi];
        weight[gi] = wg;
        for (let k = 0; k < 3; k++) { const s = out[ci * 3 + k] + hc[ci * 3 + k]; fill[gi * 3 + k] = base[gi * 3 + k] * (1 - wg) + clp(s, 0, 255) * wg; }
      }
      stats.regions++; stats.px += idx.length; used += idx.length;
    }
    stats.ms = Date.now() - t0;
    return { fill, weight, stats };
  }
  G.SizyFill = { refine, _t: { activityMap, laplaceSolve, synth, boxMean, dilate, comps } };
})(globalThis);
