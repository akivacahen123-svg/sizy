// בנצ'מרק לוגואים וטקסט קטן: חותכים מהמקור, מקטינים (area) פי 1.3/1.6/2, מגדילים חזרה בכל שיטה, משווים לחיתוך האמיתי.
// הרצה: node bench/logo_bench.mjs [--png outdir]
import fs from 'fs';
import { fileURLToPath } from 'url';
const R = fileURLToPath(new URL('..', import.meta.url));
await import(R + 'public/bgmap.js'); await import(R + 'public/engine.js');
const E = globalThis.SizyEngine, T = E._t;
const png = process.argv.includes('--png') ? process.argv[process.argv.indexOf('--png') + 1] : null;
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : null;
const SCALES = [1.3, 1.6, 2.0];
const clp = (v, a, b) => v < a ? a : v > b ? b : v;

// ---------- מדדים (על בהירות, ערוצי RGB ל-PSNR)
const lum = (d, n) => { const y = new Float32Array(n); for (let i = 0; i < n; i++) y[i] = 0.299 * d[i * 3] + 0.587 * d[i * 3 + 1] + 0.114 * d[i * 3 + 2]; return y; };
function psnr(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; s /= a.length; return s < 1e-9 ? 99 : 10 * Math.log10(255 * 255 / s); }
function ssim(a, b, w, h) { // חלון אחיד 7x7
  const r = 3, C1 = 6.5025, C2 = 58.5225; let tot = 0, cnt = 0;
  const ia = new Float64Array((w + 1) * (h + 1)), ib = new Float64Array((w + 1) * (h + 1)), iaa = new Float64Array((w + 1) * (h + 1)), ibb = new Float64Array((w + 1) * (h + 1)), iab = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) { let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0; for (let x = 0; x < w; x++) { const p = a[y * w + x], q = b[y * w + x]; sa += p; sb += q; saa += p * p; sbb += q * q; sab += p * q; const k = (y + 1) * (w + 1) + x + 1, u = y * (w + 1) + x + 1; ia[k] = ia[u] + sa; ib[k] = ib[u] + sb; iaa[k] = iaa[u] + saa; ibb[k] = ibb[u] + sbb; iab[k] = iab[u] + sab; } }
  const S = (I, x0, y0, x1, y1) => I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.max(0, x - r), y0 = Math.max(0, y - r), x1 = Math.min(w, x + r + 1), y1 = Math.min(h, y + r + 1), m = (x1 - x0) * (y1 - y0);
    const ma = S(ia, x0, y0, x1, y1) / m, mb = S(ib, x0, y0, x1, y1) / m, va = S(iaa, x0, y0, x1, y1) / m - ma * ma, vb = S(ibb, x0, y0, x1, y1) / m - mb * mb, cv = S(iab, x0, y0, x1, y1) / m - ma * mb;
    tot += ((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); cnt++;
  }
  return tot / cnt;
}
const grad = (y, w, h) => { const g = new Float32Array(w * h); for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) { const k = j * w + i, gx = (y[k + 1] - y[k - 1]) / 2, gy = (y[k + w] - y[k - w]) / 2; g[k] = Math.hypot(gx, gy); } return g; };
function sharp(y, ty, w, h) { // יחס חדות קצה: ממוצע גרדיאנט בטופ-5% פיקסלים של האמת, בתוצאה מול באמת
  const gt = grad(ty, w, h), gr = grad(y, w, h), idx = [...gt.keys()].sort((a, b) => gt[b] - gt[a]).slice(0, Math.max(10, (w * h * 0.05) | 0));
  let s1 = 0, s2 = 0; for (const k of idx) { s1 += gr[k]; s2 += gt[k]; } return s1 / s2;
}
function ring(y, ty, w, h) { // צלצול: חריגה מעבר לטווח [min,max] של האמת בשכנות 5x5, ממוצע על כל התמונה
  let s = 0; for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { let lo = 1e9, hi = -1e9; for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const jj = clp(j + dj, 0, h - 1), ii = clp(i + di, 0, w - 1), v = ty[jj * w + ii]; if (v < lo) lo = v; if (v > hi) hi = v; } const v = y[j * w + i]; s += v > hi ? v - hi : v < lo ? lo - v : 0; }
  return s / (w * h);
}
function edgeStats(y, w, h, lo, hi) { // מדדי טקסט: שבר מידות-בינוניים בקצה (פחות = תלול יותר) ויחס היקף בינארי (גבוה מ-1 = משוננות)
  const mid = (lo + hi) / 2, rng = hi - lo; let midc = 0, ink = 0, per = 0;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const v = (y[j * w + i] - lo) / rng; if (v > 0.2 && v < 0.8) midc++; if (v > 0.2) ink++; const b = y[j * w + i] > mid; if (i + 1 < w && (y[j * w + i + 1] > mid) !== b) per++; if (j + 1 < h && (y[(j + 1) * w + i] > mid) !== b) per++; }
  return { mid: midc / Math.max(1, ink), per };
}
function measure(res, truth, w, h, text) {
  const n = w * h, y = lum(res, n), ty = lum(truth, n);
  const o = { psnr: psnr(res, truth), ssim: ssim(y, ty, w, h), sharp: sharp(y, ty, w, h), ring: ring(y, ty, w, h) };
  if (text) { let lo = 1e9, hi = -1e9; for (const v of ty) { if (v < lo) lo = v; if (v > hi) hi = v; } const e = edgeStats(y, w, h, lo, hi), t = edgeStats(ty, w, h, lo, hi); o.mid = e.mid / Math.max(1e-6, t.mid); o.per = e.per / Math.max(1, t.per); }
  return o;
}

// ---------- נתונים
const ex = ['tzfat', 'yachin', 'hora', 'speech'].filter(e => !only || only.split(',').includes(e));
const logos = [], texts = [];
for (const name of ex) {
  const D = R + 'bench/exemplars/' + name + '/';
  const inp = JSON.parse(fs.readFileSync(D + 'fx.json')), buf = fs.readFileSync(D + 'fx.rgba');
  const img = E.fromRGBA(new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length), inp.w, inp.h);
  const sc = E.buildScene(img, inp.elements, () => {});
  for (const u of sc.units) for (const k of u.kids) {
    const el = inp.elements.find(e => e.id === k.id); if (!el) continue;
    if (el.role === 'logo' && !k.text) logos.push({ id: name + ':' + k.id, L: k.layer });
    if (el.role === 'caption' && k.text) {
      const [x1, y1, x2, y2] = el.box, X1 = Math.max(0, Math.floor(x1 * inp.w / 1000) - 2), Y1 = Math.max(0, Math.floor(y1 * inp.h / 1000) - 2), X2 = Math.min(inp.w, Math.ceil(x2 * inp.w / 1000) + 2), Y2 = Math.min(inp.h, Math.ceil(y2 * inp.h / 1000) + 2);
      const w = X2 - X1, h = Y2 - Y1, d = new Float32Array(w * h * 3);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) d[(y * w + x) * 3 + c] = img.d[((Y1 + y) * inp.w + X1 + x) * 3 + c];
      texts.push({ id: name + ':' + k.id, img: { w, h, c: 3, d }, lineh: (y2 - y1) * inp.h / 1000 / (el.lines ? el.lines.length : 1) });
    }
  }
}

// ---------- עזרי הקטנה/הרכבה
function downLayer(L, s) {
  const dw = Math.max(4, Math.round(L.lw / s)), dh = Math.max(4, Math.round(L.lh / s)), n = L.lw * L.lh;
  const pm = { w: L.lw, h: L.lh, c: 4, d: new Float32Array(n * 4) };
  for (let i = 0; i < n; i++) { const a = L.a[i]; for (let k = 0; k < 3; k++) pm.d[i * 4 + k] = L.rgb[i * 3 + k] * a; pm.d[i * 4 + 3] = a; }
  const r = E.resize(pm, dw, dh, 'area'), m = dw * dh, rgb = new Float32Array(m * 3), a = new Float32Array(m);
  for (let i = 0; i < m; i++) { const al = r.d[i * 4 + 3]; a[i] = al; for (let k = 0; k < 3; k++) rgb[i * 3 + k] = al > 1e-4 ? r.d[i * 4 + k] / al : 0; }
  return { rgb, a, lw: dw, lh: dh, w: dw, h: dh, up: 1 };
}
const comp = (rgb, a, n, bg) => { const o = new Float32Array(n * 3); for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) o[i * 3 + k] = bg * (1 - a[i]) + rgb[i * 3 + k] * a[i]; return o; };
const withTune = (t, f) => { const o = globalThis.__SIZY_TUNE; globalThis.__SIZY_TUNE = t; try { return f(); } finally { globalThis.__SIZY_TUNE = o; } };

// ---------- מועמדים ללוגו. כל אחד: (Lsmall, tw, th) → {a, rgb}
const lanczos = (L, tw, th) => { const n = L.lw * L.lh, pm = { w: L.lw, h: L.lh, c: 4, d: new Float32Array(n * 4) }; for (let i = 0; i < n; i++) { const a = L.a[i]; for (let k = 0; k < 3; k++) pm.d[i * 4 + k] = L.rgb[i * 3 + k] * a; pm.d[i * 4 + 3] = a; } const r = T.resizeLim(pm, tw, th), N = tw * th, a = new Float32Array(N), rgb = new Float32Array(N * 3); for (let i = 0; i < N; i++) { const al = clp(r.d[i * 4 + 3], 0, 1); a[i] = al; for (let k = 0; k < 3; k++) rgb[i * 3 + k] = al > 1e-4 ? clp(r.d[i * 4 + k] / al, 0, 255) : 0; } return { a, rgb }; };
// RCAS (FSR) על בהירות: חידוד מסתגל-ניגודיות שמגביל את עצמו לטווח השכנות
function rcas(res, tw, th, sharpness) {
  const rgb = Float32Array.from(res.rgb), Y = lum(res.rgb, tw * th), o = Float32Array.from(rgb);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const i = y * tw + x, c = Y[i], n = Y[Math.max(0, y - 1) * tw + x], s = Y[Math.min(th - 1, y + 1) * tw + x], w = Y[y * tw + Math.max(0, x - 1)], e = Y[y * tw + Math.min(tw - 1, x + 1)];
    const mn = Math.min(n, s, w, e, c), mx = Math.max(n, s, w, e, c);
    const hitMin = Math.min(mn, c) / (4 * mx + 1e-3), hitMax = (255 - mx) / (4 * mn - 4 * 255 - 1e-3);
    const lobe = Math.max(-hitMin, hitMax) * -1; // lobe<=0
    const L2 = clp(Math.max(-0.1875, Math.min(0, -Math.max(hitMin, -hitMax))) , -0.1875, 0) * sharpness; // שלילי
    const lb = clp(L2, -0.1875, 0), dv = (lb * (n + s + w + e) + c) / (4 * lb + 1) - c;
    for (let k = 0; k < 3; k++) o[i * 3 + k] = clp(rgb[i * 3 + k] + dv, 0, 255);
  }
  return { a: res.a, rgb: o };
}
// bilateral על RGB (לפני חידוד)
function bilateral(res, tw, th, rad, ss, sr) {
  const rgb = res.rgb, o = Float32Array.from(rgb);
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const i = y * tw + x; let s0 = 0, s1 = 0, s2 = 0, ws = 0;
    for (let dy = -rad; dy <= rad; dy++) { const yy = clp(y + dy, 0, th - 1); for (let dx = -rad; dx <= rad; dx++) { const xx = clp(x + dx, 0, tw - 1), j = yy * tw + xx; const dc = (rgb[j * 3] - rgb[i * 3]) ** 2 + (rgb[j * 3 + 1] - rgb[i * 3 + 1]) ** 2 + (rgb[j * 3 + 2] - rgb[i * 3 + 2]) ** 2; const w = Math.exp(-(dx * dx + dy * dy) / (2 * ss * ss) - dc / (2 * sr * sr)); s0 += rgb[j * 3] * w; s1 += rgb[j * 3 + 1] * w; s2 += rgb[j * 3 + 2] * w; ws += w; } }
    o[i * 3] = s0 / ws; o[i * 3 + 1] = s1 / ws; o[i * 3 + 2] = s2 / ws;
  }
  return { a: res.a, rgb: o };
}
const withUsm = (r, tw, th, A) => ({ a: r.a, rgb: T.usmLum({ w: tw, h: th, c: 3, d: r.rgb }, A, 0).d });
const engine = (tune) => (L, tw, th) => { const L2 = { ...L, _flat: undefined, _uni: undefined }; return withTune(tune, () => T.resampleLayer(L2, tw, th, false)); };
const LOGO = {
  'engine-old': engine({ faOff: 1 }),
  lanczos,
  'lanczos+rcas': (L, tw, th) => rcas(lanczos(L, tw, th), tw, th, 1),
  'lanczos+usm.6': (L, tw, th) => withUsm(lanczos(L, tw, th), tw, th, 0.6),
  'bilat+usm': (L, tw, th) => { const r = lanczos(L, tw, th); return withUsm(bilateral(r, tw, th, 2, 1.2, 25), tw, th, 1.0); },
  'snap(engine)': engine({}),
  'snap gm.7': engine({ fa: { gm: 0.7 } }),
  'snap gm1.4': engine({ fa: { gm: 1.4 } }),
  'snap sg.25': engine({ fa: { sg: 0.25 } }),
  'snap ctr.45': engine({ fa: { ctr: 0.45 } }),
  'snap ag0': engine({ fa: { ag: 0 } }),
  'snap+usm.5': engine({ fa: { usm: 0.5 } }),
  'A sg.25 gm1.2 u.5': engine({ fa: { sg: 0.25, gm: 1.2, usm: 0.5 } }),
  'B sg.25 gm1.4 u.5': engine({ fa: { sg: 0.25, gm: 1.4, usm: 0.5 } }),
  'C sg.2 gm1.2 u.8': engine({ fa: { sg: 0.2, gm: 1.2, usm: 0.8 } }),
  'D sg.3 gm1.6 u.5': engine({ fa: { sg: 0.3, gm: 1.6, usm: 0.5 } }),
  'E sg.25 gm1.2 ag1.3 u.5': engine({ fa: { sg: 0.25, gm: 1.2, ag: 1.3, usm: 0.5 } }),
  'F sg.25 gm1.2 ag.8 u.5': engine({ fa: { sg: 0.25, gm: 1.2, ag: 0.8, usm: 0.5 } }),
};
const only2 = process.argv.includes('--cands') ? process.argv[process.argv.indexOf('--cands') + 1].split(',') : null;

// ---------- הרצה ללוגו
const keys = Object.keys(LOGO).filter(k => !only2 || only2.includes(k) || k === 'engine-old');
const acc = {}; const detect = [];
for (const lg of logos) {
  const L0 = lg.L, n0 = L0.lw * L0.lh;
  const flat = !!T.flatPalette({ ...L0, _flat: undefined });
  detect.push(lg.id + ' ' + L0.lw + 'x' + L0.lh + ' flat=' + flat);
  for (const s of SCALES) {
    const Ls = downLayer(L0, s);
    for (const k of keys) {
      const r = LOGO[k](Ls, L0.lw, L0.lh);
      let m = null;
      for (const bg of [255, 0]) { const mm = measure(comp(r.rgb, r.a, n0, bg), comp(L0.rgb, L0.a, n0, bg), L0.lw, L0.lh, false); if (!m) m = mm; else for (const q in mm) m[q] = (m[q] + mm[q]) / 2; }
      const key = k + '|' + s; (acc[key] = acc[key] || []).push(m);
      if (png && s === 1.6) { fs.mkdirSync(png, { recursive: true }); fs.writeFileSync(`${png}/logo_${lg.id.replace(':', '_')}_${k.replace(/[^\w.+-]/g, '_')}.rgb`, Buffer.from(Uint8Array.from(comp(r.rgb, r.a, n0, 255).map(v => clp(Math.round(v), 0, 255))))); fs.writeFileSync(`${png}/logo_${lg.id.replace(':', '_')}.dim`, `${L0.lw} ${L0.lh}`); if (k === keys[0]) fs.writeFileSync(`${png}/logo_${lg.id.replace(':', '_')}_TRUE.rgb`, Buffer.from(Uint8Array.from(comp(L0.rgb, L0.a, n0, 255).map(v => clp(Math.round(v), 0, 255))))); }
    }
  }
}
const avg = arr => { const o = {}; for (const m of arr) for (const q in m) o[q] = (o[q] || 0) + m[q] / arr.length; return o; };
function table(title, keys, acc, text) {
  console.log('\n== ' + title);
  console.log('cand'.padEnd(16) + 'scale  PSNR   SSIM   sharp  ring' + (text ? '   mid   perim' : ''));
  for (const k of keys) for (const s of SCALES) { const m = avg(acc[k + '|' + s] || [{}]); console.log(k.padEnd(16) + s.toFixed(1).padEnd(5) + ' ' + [m.psnr, m.ssim, m.sharp, m.ring].map((v, i) => v.toFixed(i === 1 ? 4 : 2).padStart(i === 1 ? 7 : 6)).join(' ') + (text ? '  ' + m.mid.toFixed(2).padStart(5) + ' ' + m.per.toFixed(2).padStart(6) : '')); }
}
console.log(detect.join('\n'));
table('LOGOS (' + logos.length + ' crops, avg over white/black bg)', keys, acc, false);

// ---------- טקסט קטן: סימולציה של צינור הטקסט (מסכת אלפא → x4 cubic+טשטוש+סף → resampleLayer) מול חיתוך האמת
function textSim(C, s, up, cand) {
  const W = C.w, H = C.h, n = W * H;
  const small = s === 1 ? C : E.resize(C, Math.max(4, Math.round(W / s)), Math.max(4, Math.round(H / s)), 'area');
  const w = small.w, h = small.h, d = small.d;
  const bgs = [[], [], []]; for (let x = 0; x < w; x++) for (const y of [0, h - 1]) for (let c = 0; c < 3; c++) bgs[c].push(d[(y * w + x) * 3 + c]); for (let y = 0; y < h; y++) for (const x of [0, w - 1]) for (let c = 0; c < 3; c++) bgs[c].push(d[(y * w + x) * 3 + c]);
  const bg = bgs.map(a => a.sort((p, q) => p - q)[a.length >> 1]);
  const dist = new Float32Array(w * h); for (let i = 0; i < w * h; i++) dist[i] = Math.hypot(d[i * 3] - bg[0], d[i * 3 + 1] - bg[1], d[i * 3 + 2] - bg[2]);
  const srt = Float32Array.from(dist).sort(); const thr = srt[Math.floor(srt.length * 0.97)];
  const fg = [0, 0, 0]; let cn = 0; for (let i = 0; i < w * h; i++) if (dist[i] >= thr) { for (let c = 0; c < 3; c++) fg[c] += d[i * 3 + c]; cn++; } for (let c = 0; c < 3; c++) fg[c] /= cn;
  const v = fg.map((f, c) => f - bg[c]), vv = v[0] ** 2 + v[1] ** 2 + v[2] ** 2;
  const a0 = { w, h, c: 1, d: new Float32Array(w * h) }; for (let i = 0; i < w * h; i++) a0.d[i] = clp(((d[i * 3] - bg[0]) * v[0] + (d[i * 3 + 1] - bg[1]) * v[1] + (d[i * 3 + 2] - bg[2]) * v[2]) / vv, 0, 1);
  let aUp = E.resize(a0, w * up, h * up, 'cubic'); aUp = E.blur(aUp, 0.33 * up);
  for (let i = 0; i < aUp.d.length; i++) aUp.d[i] = clp((aUp.d[i] - 0.38) / 0.3 + 0.5, 0, 1);
  const rgb = new Float32Array(aUp.d.length * 3); for (let i = 0; i < aUp.d.length; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = fg[c];
  const L = { rgb, a: aUp.d, lw: aUp.w, lh: aUp.h, w, h, up };
  const r = cand(L, W, H);
  const out = new Float32Array(n * 3); for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = bg[c] + (fg[c] - bg[c]) * r.a[i];
  return out;
}
const textEngine = (tune) => (L, tw, th) => withTune(tune, () => T.resampleLayer({ ...L, _uni: undefined }, tw, th, true));
globalThis.__TEXT_CANDS = {};
const TEXT = await (async () => { try { return (await import('./logo_text_cands.mjs')).default(T, E, textEngine, clp); } catch (e) { return { 'engine-old': textEngine({ txOff: 1 }) }; } })();
const tkeys = Object.keys(TEXT).filter(k => !only2 || only2.includes(k) || k === 'engine-old');
const tacc = {}; const TS = [1.0, ...SCALES];
for (const t of texts) {
  for (const s of TS) for (const k of tkeys) {
    const out = textSim(t.img, s, 4, TEXT[k]);
    const m = measure(out, t.img.d, t.img.w, t.img.h, true); (tacc[k + '|' + s] = tacc[k + '|' + s] || []).push(m);
    if (png && s === 1.6) { fs.writeFileSync(`${png}/text_${t.id.replace(':', '_')}_${k.replace(/[^\w.+-]/g, '_')}.rgb`, Buffer.from(Uint8Array.from(out.map(v => clp(Math.round(v), 0, 255))))); fs.writeFileSync(`${png}/text_${t.id.replace(':', '_')}.dim`, `${t.img.w} ${t.img.h}`); if (k === tkeys[0]) fs.writeFileSync(`${png}/text_${t.id.replace(':', '_')}_TRUE.rgb`, Buffer.from(Uint8Array.from(t.img.d.map(v => clp(Math.round(v), 0, 255))))); }
  }
}
SCALES.unshift(1.0);
table('SMALL TEXT (' + texts.length + ' crops; scale 1.0 = 1:1, mid/perim: <1 steeper / 1 = same jaggedness as true)', tkeys, tacc, true);
