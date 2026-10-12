// סייזי · התאמת הרקע לבאנר צר: הקצוות (למשל שער אבן) נשארים בגודל טבעי והאמצע מכווץ בעדינות.
(function (G) {
  // מחזיר מערך גבולות עמודות במקור (אורך Wk+1) או null אם אין צורך
  function map(srcW, srcH, Wk, Hk) {
    const s = Hk / srcH;
    if (Wk >= srcW * s * 0.94) return null;
    const sig = 0.10 * srcW, g = new Float32Array(srcW);
    for (let x = 0; x < srcW; x++) { const d = Math.min(x + .5, srcW - x - .5) / sig; g[x] = Math.exp(-d * d); }
    const total = c => { let t = 0; for (let x = 0; x < srcW; x++) t += c + (s - c) * g[x]; return t; };
    let lo = 0.05 * s, hi = s;
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
  G.SizyBg = { map, rowEnergy, pickTop };
})(globalThis);
