// סייזי · התאמת הרקע לבאנר צר: הקצוות (למשל שער אבן) נשארים בגודל טבעי והאמצע מכווץ בעדינות.
(function (G) {
  // מחזיר מערך גבולות עמודות במקור (אורך Wk+1) או null אם אין צורך
  function map(srcW, srcH, Wk, Hk) {
    const s = Hk / srcH;
    if (Wk >= srcW * s * 0.94) return null;
    const sig = 0.10 * srcW, g = new Float32Array(srcW);
    for (let x = 0; x < srcW; x++) { const d = Math.min(x + .5, srcW - x - .5) / sig; g[x] = Math.exp(-d * d); }
    const total = c => { let t = 0; for (let x = 0; x < srcW; x++) t += c + (s - c) * g[x]; return t; };
    let lo = 0.55 * s, hi = s; // מכווצים לכל היותר ל-55% מקנה המידה; מעבר לזה חותכים (cover)
    if (total(lo) > Wk) return null;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (total(m) > Wk) hi = m; else lo = m; }
    const c = lo, xs = new Float32Array(Wk + 1);
    let acc = 0, x = 0;
    for (let u = 0; u <= Wk; u++) {
      while (x < srcW) { const f = c + (s - c) * g[x]; if (acc + f >= u) { xs[u] = x + (u - acc) / f; break; } acc += f; x++; }
      if (x >= srcW) xs[u] = srcW;
    }
    xs[0] = 0; xs[Wk] = srcW;
    return xs;
  }
  // אנרגיית פרטים בכל שורה של הרקע (קצוות), כדי שחיתוך לבאנר רחב ישאיר את החלק המעניין (אופק, עננים, הרים) ולא שמיים ריקים
  function rowEnergy(d, stride, W, H) {
    const lum = (x, y) => { const o = (y * W + x) * stride; return 0.3 * d[o] + 0.59 * d[o + 1] + 0.11 * d[o + 2]; };
    const e = new Float32Array(H);
    for (let y = 0; y < H - 1; y++) { let t = 0; for (let x = 0; x < W - 1; x += 2) t += Math.abs(lum(x, y) - lum(x + 1, y)) + Math.abs(lum(x, y) - lum(x, y + 1)); e[y] = t / (W / 2); }
    return e;
  }
  // התחלת חלון חיתוך (בשורות מקור) באורך vis שמכיל הכי הרבה פרטים, בלי אזורים שנחתכו מהם אלמנטים גדולים (חורים ממולאים נראים כמריחה), עם נטייה קלה למרכז
  function pickTop(e, H, vis, holes) {
    const maxT = Math.max(0, H - vis); if (maxT <= 0) return 0;
    const pe = new Float64Array(H + 1), ph = new Float64Array(H + 1);
    for (let i = 0; i < H; i++) { pe[i + 1] = pe[i] + e[i]; ph[i + 1] = ph[i] + (holes ? holes[i] : 0); }
    const step = Math.max(1, Math.floor(H / 200)), cands = [];
    for (let t = 0; t <= maxT; t += step) {
      const a = Math.round(t), b = Math.min(H, Math.round(t + vis)), n = Math.max(1, b - a);
      cands.push({ t, hole: (ph[b] - ph[a]) / n, sc: (pe[b] - pe[a]) * (1 - 0.18 * Math.abs(t - maxT / 2) / (maxT / 2 + 1e-6)) });
    }
    const ok = cands.filter(c => c.hole < 0.12);
    const pool = ok.length ? ok : cands.sort((p, q) => p.hole - q.hole).slice(0, 3);
    return pool.reduce((p, q) => (q.sc > p.sc ? q : p)).t;
  }
  // פאנלים שטוחים בצבעים שונים (למשל גוף טורקיז ופס לבן בתחתית): מחזיר {y0,y1,c} של הפאנל השולט (לפי שטח) או null אם הרקע תמונה/אין פאנלים נפרדים
  function panels(d, stride, W, H) {
    const m = new Float32Array(H * 3), flat = new Uint8Array(H), step = Math.max(1, Math.floor(W / 64));
    for (let y = 0; y < H; y++) {
      let n = 0; for (let x = 0; x < W; x += step) { const o = (y * W + x) * stride; m[y * 3] += d[o]; m[y * 3 + 1] += d[o + 1]; m[y * 3 + 2] += d[o + 2]; n++; }
      for (let k = 0; k < 3; k++) m[y * 3 + k] /= n;
      let dev = 0; for (let x = 0; x < W; x += step) { const o = (y * W + x) * stride; dev += Math.max(Math.abs(d[o] - m[y * 3]), Math.abs(d[o + 1] - m[y * 3 + 1]), Math.abs(d[o + 2] - m[y * 3 + 2])); }
      flat[y] = dev / n < 28 ? 1 : 0;
    }
    const dist = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    const bands = []; let cur = null;
    for (let y = 0; y < H; y++) {
      const c = [m[y * 3], m[y * 3 + 1], m[y * 3 + 2]];
      if (cur && dist(c, cur.c) < 40) { cur.y1 = y + 1; cur.n++; cur.fl += flat[y]; for (let k = 0; k < 3; k++) cur.c[k] += (c[k] - cur.c[k]) / cur.n; }
      else { cur = { y0: y, y1: y + 1, n: 1, fl: flat[y], c }; bands.push(cur); }
    }
    const big = bands.filter(b => b.n >= 0.04 * H);
    if (big.length < 2) return null;
    const dom = big.reduce((p, q) => (q.n > p.n ? q : p));
    if (dom.n < 0.4 * H || dom.fl < 0.7 * dom.n) return null;
    if (big.some(b => b !== dom && b.n * 1.8 > dom.n)) return null; // שני פאנלים בגודל דומה: אין פאנל ראשי ברור
    if (!big.some(b => b !== dom && dist(b.c, dom.c) > 60)) return null;
    return { y0: dom.y0, y1: dom.y1, c: dom.c, bands: big };
  }
  // האם חלון (שורות מקור) נוגע בפאנל משני בצבע שונה בבירור
  function touchesOther(P, t, vis) {
    const a = t, b = t + vis;
    return P.bands.some(q => q.y0 !== P.y0 && Math.max(0, Math.min(b, q.y1) - Math.max(a, q.y0)) > 0.03 * vis && Math.max(Math.abs(q.c[0] - P.c[0]), Math.abs(q.c[1] - P.c[1]), Math.abs(q.c[2] - P.c[2])) > 60);
  }
  G.SizyBg = { map, rowEnergy, pickTop, panels, touchesOther };
})(globalThis);
