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
  G.SizyBg = { map };
})(globalThis);
