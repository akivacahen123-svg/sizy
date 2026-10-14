// מדדי כתמים בחורים ממולאים. שימוש: node bench/blotch.mjs <publicDir> <outDir> <fixtureDir>...
// לכל מקובץ: בונה סצנה, מודד זמן, שומר plate ו-hole mask, ומדפיס מדדים:
//  tex   = סטיית תקן של תדר גבוה בתוך החור / בטבעת מסביב (1 = אותו טקסטורה, קרוב ל-0 = מריחה)
//  flat% = אחוז בלוקים 6x6 בחור ששטוחים מדי (<0.35 מהטבעת); hot% = חמים מדי (>2.5)
//  rep%  = אחוז בלוקים 12x12 בחור שיש להם כפיל כמעט זהה בחור (חזרתיות אריחים), בסוגריים: בסיס טבעי באותו גודל
//  seam  = קפיצה ממוצעת בין פיקסל בתוך החור לשכנו מחוץ לחור, ביחס לגרדיאנט הטבעי
import fs from 'fs'; import path from 'path';
const [pub, out, ...dirs] = process.argv.slice(2);
await import(path.resolve(pub, 'bgmap.js')); if (fs.existsSync(path.resolve(pub, 'inpaint.js'))) await import(path.resolve(pub, 'inpaint.js')); await import(path.resolve(pub, 'engine.js'));
const E = globalThis.SizyEngine; fs.mkdirSync(out, { recursive: true });
function lum(d, i) { return 0.299 * d[i * 3] + 0.587 * d[i * 3 + 1] + 0.114 * d[i * 3 + 2]; }
function boxBlur(a, w, h, r) { // ממוצע ריבועי מהיר (אינטגרל)
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let s = 0; for (let x = 0; x < w; x++) { s += a[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + s; } }
  const o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1), y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1); o[y * w + x] = (I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]) / ((x1 - x0) * (y1 - y0)); }
  return o;
}
function dil(m, w, h, r) { const o = new Uint8Array(w * h); const b = boxBlur(Float32Array.from(m), w, h, r); for (let i = 0; i < w * h; i++) o[i] = b[i] > 1e-6 ? 1 : 0; return o; }
function comps(m, w, h) {
  const lab = new Int32Array(w * h), res = []; const st = [];
  for (let i = 0; i < w * h; i++) {
    if (!m[i] || lab[i]) continue; const id = res.length + 1; let n = 0, x0 = w, y0 = h, x1 = 0, y1 = 0; st.length = 0; st.push(i); lab[i] = id;
    while (st.length) { const p = st.pop(), x = p % w, y = (p - x) / w; n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      if (x > 0 && m[p - 1] && !lab[p - 1]) { lab[p - 1] = id; st.push(p - 1); } if (x < w - 1 && m[p + 1] && !lab[p + 1]) { lab[p + 1] = id; st.push(p + 1); }
      if (y > 0 && m[p - w] && !lab[p - w]) { lab[p - w] = id; st.push(p - w); } if (y < h - 1 && m[p + w] && !lab[p + w]) { lab[p + w] = id; st.push(p + w); } }
    res.push({ id, n, x0, y0, x1, y1 });
  } return { lab, res };
}
const std = a => { if (a.length < 4) return 0; let s = 0, q = 0; for (const v of a) { s += v; q += v * v; } s /= a.length; return Math.sqrt(Math.max(0, q / a.length - s * s)); };
const med = a => { const b = Float32Array.from(a).sort(); return b.length ? b[b.length >> 1] : 0; };
// חזרתיות: בלוקים 12x12 עם שונות, השוואה לכל בלוק אחר במרחק >= 12 בתוך אותה קבוצה
function repeatFrac(g, w, cells, B = 12) {
  const blocks = []; for (const [bx, by] of cells) { const v = new Float32Array(B * B); let m = 0; for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) { v[y * B + x] = g[(by + y) * w + bx + x]; m += v[y * B + x]; } m /= B * B; let q = 0; for (let k = 0; k < v.length; k++) { v[k] -= m; q += v[k] * v[k]; } q = Math.sqrt(q); if (q / B > 2.5) { for (let k = 0; k < v.length; k++) v[k] /= q; blocks.push({ bx, by, v }); } }
  if (blocks.length > 220) { const st = blocks.length / 220; const nb = []; for (let i = 0; i < 220; i++) nb.push(blocks[Math.floor(i * st)]); blocks.length = 0; blocks.push(...nb); }
  if (blocks.length < 6) return { f: null, n: blocks.length };
  let rep = 0;
  for (let i = 0; i < blocks.length; i++) { let best = -1; for (let j = 0; j < blocks.length; j++) { if (i === j || Math.abs(blocks[i].bx - blocks[j].bx) < B && Math.abs(blocks[i].by - blocks[j].by) < B) continue; let d = 0; const a = blocks[i].v, b = blocks[j].v; for (let k = 0; k < a.length; k++) d += a[k] * b[k]; if (d > best) best = d; } if (best > 0.93) rep++; }
  return { f: rep / blocks.length, n: blocks.length };
}
export function measure(plate, hole, W, H) {
  const g = new Float32Array(W * H); for (let i = 0; i < W * H; i++) g[i] = lum(plate.d, i);
  const bl = boxBlur(g, W, H, 3), hp = new Float32Array(W * H); for (let i = 0; i < W * H; i++) hp[i] = g[i] - bl[i];
  const { lab, res } = comps(hole, W, H), outp = [];
  const d10 = dil(hole, W, H, 14), d3 = dil(hole, W, H, 3);
  for (const c of res) {
    if (c.n < 600) continue;
    const inn = [], ring = [];
    const rb = { x0: Math.max(0, c.x0 - 16), y0: Math.max(0, c.y0 - 16), x1: Math.min(W - 1, c.x1 + 16), y1: Math.min(H - 1, c.y1 + 16) };
    for (let y = rb.y0; y <= rb.y1; y++) for (let x = rb.x0; x <= rb.x1; x++) { const i = y * W + x; if (lab[i] === c.id) { if (!dil3(lab, W, H, x, y, c.id)) inn.push(hp[i]); } else if (d10[i] && !d3[i] && !hole[i]) ring.push(hp[i]); }
    if (inn.length < 100 || ring.length < 100) continue;
    const sIn = std(inn), sRing = std(ring);
    // בלוקים 6x6
    const bs = [], rs = []; const bk = 6;
    for (let by = rb.y0; by + bk <= rb.y1; by += bk) for (let bx = rb.x0; bx + bk <= rb.x1; bx += bk) {
      let allIn = true, allRing = true, v = [];
      for (let y = 0; y < bk; y++) for (let x = 0; x < bk; x++) { const i = (by + y) * W + bx + x; if (lab[i] !== c.id) allIn = false; if (!(d10[i] && !d3[i] && !hole[i])) allRing = false; v.push(hp[i]); }
      if (allIn) bs.push(std(v)); else if (allRing) rs.push(std(v));
    }
    const mr = Math.max(0.6, med(rs)); let flat = 0, hot = 0; for (const s of bs) { if (s < 0.35 * mr) flat++; if (s > 2.5 * mr) hot++; }
    // seam
    let sj = 0, sn = 0, gj = 0, gn = 0;
    for (let y = rb.y0 + 1; y < rb.y1; y++) for (let x = rb.x0 + 1; x < rb.x1; x++) { const i = y * W + x; if (lab[i] !== c.id) continue; for (const o of [-1, 1, -W, W]) { const j = i + o; if (!hole[j]) { sj += Math.abs(g[i] - g[j]); sn++; } } }
    for (const v of ring) { gj += Math.abs(v); gn++; }
    // repetition
    const cellsIn = [], cellsOut = []; const B = 12;
    for (let by = c.y0; by + B <= c.y1 + 1; by += 6) for (let bx = c.x0; bx + B <= c.x1 + 1; bx += 6) { let ok = true; for (let y = 0; y < B && ok; y += 3) for (let x = 0; x < B; x += 3) if (lab[(by + y) * W + bx + x] !== c.id) { ok = false; break; } if (ok) cellsIn.push([bx, by]); }
    // בסיס: אותם גדלים מאזור שאינו חור (טבעת רחבה סביב)
    for (let by = Math.max(0, c.y0 - 40); by + B <= Math.min(H, c.y1 + 40); by += 6) for (let bx = Math.max(0, c.x0 - 40); bx + B <= Math.min(W, c.x1 + 40); bx += 6) { let ok = true; for (let y = 0; y < B && ok; y += 3) for (let x = 0; x < B; x += 3) if (d3[(by + y) * W + bx + x]) { ok = false; break; } if (ok) cellsOut.push([bx, by]); }
    const rin = repeatFrac(g, W, cellsIn), rout = repeatFrac(g, W, cellsOut);
    outp.push({ box: [c.x0, c.y0, c.x1, c.y1], n: c.n, tex: +(sIn / Math.max(0.3, sRing)).toFixed(2), sRing: +sRing.toFixed(1), flat: +(100 * flat / Math.max(1, bs.length)).toFixed(0), hot: +(100 * hot / Math.max(1, bs.length)).toFixed(0), rep: rin.f == null ? null : +(100 * rin.f).toFixed(0), repBase: rout.f == null ? null : +(100 * rout.f).toFixed(0), seam: +((sj / Math.max(1, sn)) / Math.max(0.5, gj / Math.max(1, gn) * 1.2)).toFixed(2) });
  }
  return outp;
}
function dil3(lab, w, h, x, y, id) { // האם הפיקסל על שפת החור (שכן בשני פיקסלים שאינו בחור)
  for (let dy = -2; dy <= 2; dy += 2) for (let dx = -2; dx <= 2; dx += 2) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; if (lab[yy * w + xx] !== id) return true; } return false;
}
// סיכום לחורים גדולים בסביבה עם טקסטורה (טבעת עם תדר גבוה >= 2.5): ממוצע משוקלל לפי שטח
export function summarize(r) {
  const hs = r.filter(h => h.n >= 1500 && h.sRing >= 2.5), px = hs.reduce((a, h) => a + h.n, 0), wa = f => px ? hs.reduce((a, h) => a + f(h) * h.n, 0) / px : 0;
  const rs = hs.filter(h => h.rep != null), rp = rs.reduce((a, h) => a + h.n, 0);
  return { n: hs.length, px, tex: +wa(h => h.tex).toFixed(2), flat: +wa(h => h.flat).toFixed(0), hot: +wa(h => h.hot).toFixed(0), seam: +wa(h => h.seam).toFixed(2), rep: rp ? +(rs.reduce((a, h) => a + h.rep * h.n, 0) / rp).toFixed(0) : null, repBase: rp ? +(rs.reduce((a, h) => a + h.repBase * h.n, 0) / rp).toFixed(0) : null };
}
if (process.argv[1].endsWith('blotch.mjs')) {
  const all = [];
  for (const dir of dirs) for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json') && !f.includes('fx_')).sort()) {
    const n = f.slice(0, -5); if (!fs.existsSync(path.join(dir, n + '.rgba'))) continue;
    const meta = JSON.parse(fs.readFileSync(path.join(dir, f))); if (!meta.elements) continue;
    const buf = fs.readFileSync(path.join(dir, n + '.rgba'));
    const img = E.fromRGBA(new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length), meta.w, meta.h);
    const c0 = process.cpuUsage(); const sc = E.buildScene(img, meta.elements, () => {}); const cu = process.cpuUsage(c0), ms = (cu.user + cu.system) / 1000;
    const tag = path.basename(dir) === 'fx' || !fs.existsSync(path.join(dir, 'fx.json')) ? n : path.basename(dir);
    const name = fs.existsSync(path.join(dir, 'fx.json')) && n === 'fx' ? path.basename(dir) : n;
    const r = measure(sc.plate, sc.holes2, sc.W, sc.H);
    fs.writeFileSync(path.join(out, name + '.plate.rgba'), Buffer.from(Uint8ClampedArray.from({ length: sc.W * sc.H * 4 }, (_, i) => i % 4 === 3 ? 255 : Math.max(0, Math.min(255, sc.plate.d[((i / 4) | 0) * 3 + i % 4]))).buffer));
    fs.writeFileSync(path.join(out, name + '.hole.u8'), Buffer.from(sc.holes2));
    fs.writeFileSync(path.join(out, name + '.dim'), `${sc.W} ${sc.H}`);
    all.push({ name, ms: Math.round(ms), W: sc.W, H: sc.H, holes: r });
    const sm = summarize(r); all[all.length - 1].sum = sm;
    console.log(name.padEnd(30), String(Math.round(ms)).padStart(5) + 'ms', `holes>=1500px: ${sm.n} (${sm.px}px) tex ${sm.tex} flat ${sm.flat}% hot ${sm.hot}% rep ${sm.rep}% (nat ${sm.repBase}%) seam ${sm.seam}`);
  }
  fs.writeFileSync(path.join(out, 'metrics.json'), JSON.stringify(all, null, 1));
}
