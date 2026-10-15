// מדד אובייקטיבי להגדלת תמונות: חותכים תמונה אמיתית, מקטינים (area) ב-1.3/1.6/2.0, מגדילים חזרה בכל שיטה ומשווים לחיתוך האמיתי.
// שימוש: node bench/upscale_bench.mjs [שיטות מופרדות בפסיק] [--png outdir]
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url'; import { createRequire } from 'module';
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, '..'), require = createRequire(import.meta.url);
const sharp = require('sharp');
await import(path.join(root, 'public/bgmap.js')); await import(path.join(root, 'public/engine.js'));
const E = globalThis.SizyEngine, { resampleLayer } = E._t;
const args = process.argv.slice(2), pngDir = args.includes('--png') ? args[args.indexOf('--png') + 1] : null;
const modes = (args[0] && !args[0].startsWith('--') ? args[0] : 'cur,lan,cas,easu,easucas,ibp,ibpcas').split(',');
const EX = path.join(here, 'exemplars');
// חיתוכים: [שם, קובץ, x,y,w,h] בפיקסלי המקור. עיגולים (tzfat), גיבור (yachin), טקסטורות צילום (tzfat רקע, yachin מוצרים)
const CROPS = [
  ['circle0', 'tzfat/orig_700x500.png', 348, 388, 48, 48], ['circle2', 'tzfat/orig_700x500.png', 536, 388, 48, 48],
  ['circle3', 'tzfat/orig_700x500.png', 616, 388, 48, 48],
  ['hero', 'yachin/orig_1200x300.jpg', 640, 0, 560, 300], ['pans', 'yachin/orig_1200x300.jpg', 700, 180, 320, 120],
  ['bottles', 'yachin/orig_1200x300.jpg', 640, 20, 300, 180], ['mountain', 'tzfat/orig_700x500.png', 80, 230, 300, 120],
  ['arch', 'tzfat/orig_700x500.png', 580, 20, 120, 300],
];
const SCALES = [1.3, 1.6, 2.0];
async function load(f, x, y, w, h) { const { data, info } = await sharp(path.join(EX, f)).removeAlpha().extract({ left: x, top: y, width: w, height: h }).raw().toBuffer({ resolveWithObject: true }); return { w: info.width, h: info.height, d: Float32Array.from(data) }; }
const luma = im => { const n = im.w * im.h, Y = new Float32Array(n); for (let i = 0; i < n; i++) Y[i] = 0.299 * im.d[i * 3] + 0.587 * im.d[i * 3 + 1] + 0.114 * im.d[i * 3 + 2]; return Y; };
function metrics(ref, tst) {
  const w = ref.w, h = ref.h, n = w * h; let se = 0;
  for (let i = 0; i < n * 3; i++) { const d = ref.d[i] - Math.min(255, Math.max(0, Math.round(tst.d[i]))); se += d * d; }
  const psnr = 10 * Math.log10(255 * 255 / (se / (n * 3) + 1e-9));
  const A = luma(ref), B = luma(tst);
  // SSIM: ממוצע על חלונות 7×7 (אחידים)
  const C1 = 6.5025, C2 = 58.5225, r = 3; let ss = 0, cnt = 0;
  for (let y = r; y < h - r; y += 2) for (let x = r; x < w - r; x += 2) {
    let ma = 0, mb = 0, k = 0; for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { ma += A[(y + j) * w + x + i]; mb += B[(y + j) * w + x + i]; k++; }
    ma /= k; mb /= k; let va = 0, vb = 0, cv = 0;
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) { const a = A[(y + j) * w + x + i] - ma, b = B[(y + j) * w + x + i] - mb; va += a * a; vb += b * b; cv += a * b; }
    va /= k - 1; vb /= k - 1; cv /= k - 1; ss += ((2 * ma * mb + C1) * (2 * cv + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2)); cnt++;
  }
  // חדות: ממוצע עוצמת גרדיאנט (סובל) באחוזון העליון 25% של הקצוות במקור, מול אותם פיקסלים בבדיקה
  const grad = Y => { const g = new Float32Array(n); for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; const gx = (Y[i - w + 1] + 2 * Y[i + 1] + Y[i + w + 1]) - (Y[i - w - 1] + 2 * Y[i - 1] + Y[i + w - 1]), gy = (Y[i + w - 1] + 2 * Y[i + w] + Y[i + w + 1]) - (Y[i - w - 1] + 2 * Y[i - w] + Y[i - w + 1]); g[i] = Math.hypot(gx, gy) / 8; } return g; };
  const ga = grad(A), gb = grad(B), idx = []; for (let i = 0; i < n; i++) if (ga[i] > 0) idx.push(i);
  idx.sort((p, q) => ga[q] - ga[p]); const top = idx.slice(0, Math.max(1, idx.length >> 2));
  let sa = 0, sb = 0; for (const i of top) { sa += ga[i]; sb += gb[i]; }
  const sharp = sb / sa;
  // אוברשוט/צלצול: ממוצע חריגה מעל/מתחת לטווח 3×3 של האמת (ביחידות רמות אפור), פלוס אחוז הפיקסלים שחרגו ביותר מ-3 רמות
  let ov = 0, ovc = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    let lo = 1e9, hi = -1e9; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const v = A[(y + j) * w + x + i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const v = B[y * w + x], ex = v > hi ? v - hi : v < lo ? lo - v : 0; ov += ex; if (ex > 3) ovc++;
  }
  const m = (w - 2) * (h - 2);
  return { psnr, ssim: ss / cnt, sharp, ring: ov / m, ringPct: 100 * ovc / m };
}
const toImg = r => { const n = r.a.length, d = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) d[i] = r.rgb[i]; return d; };
const rows = {}; const png = [];
for (const [name, f, x, y, w, h] of CROPS) {
  const truth = await load(f, x, y, w, h);
  for (const s of SCALES) {
    const sw = Math.round(w / s), sh = Math.round(h / s);
    const small = E.resize({ w, h, c: 3, d: truth.d }, sw, sh, 'area');
    const L = { lw: sw, lh: sh, a: new Float32Array(sw * sh).fill(1), rgb: small.d };
    for (const m of modes) {
      let outD;
      if (m === 'lan') { globalThis.__SIZY_TUNE = { photoUp: 'cur', upAmt: 0, esMix: 0 }; outD = toImg(resampleLayer(L, w, h, false)); }
      else { globalThis.__SIZY_TUNE = { photoUp: m, ...JSON.parse(process.env.TUNE || '{}') }; outD = toImg(resampleLayer(L, w, h, false)); }
      const mt = metrics(truth, { w, h, d: outD }); const k = m + '@' + s; (rows[k] ||= []).push(mt);
      if (pngDir && (name === 'hero' || name === 'circle0' || name === 'bottles') && s === 1.6) png.push([name, m, w, h, outD]);
    }
    if (pngDir && (name === 'hero' || name === 'circle0' || name === 'bottles') && s === 1.6) png.push([name, 'true', w, h, truth.d]);
  }
}
const avg = (a, k) => a.reduce((t, v) => t + v[k], 0) / a.length;
console.log('method@scale      PSNR    SSIM   sharp  ring  ring>3%');
for (const s of [...SCALES, 'all']) for (const m of modes) {
  const a = s === 'all' ? SCALES.flatMap(q => rows[m + '@' + q]) : rows[m + '@' + s];
  console.log((m + '@' + s).padEnd(16), avg(a, 'psnr').toFixed(2).padStart(7), avg(a, 'ssim').toFixed(4).padStart(7), avg(a, 'sharp').toFixed(3).padStart(7), avg(a, 'ring').toFixed(3).padStart(6), avg(a, 'ringPct').toFixed(2).padStart(7));
}
if (pngDir) { fs.mkdirSync(pngDir, { recursive: true }); for (const [n, m, w, h, d] of png) { const b = Buffer.alloc(w * h * 3); for (let i = 0; i < b.length; i++) b[i] = Math.max(0, Math.min(255, Math.round(d[i]))); await sharp(b, { raw: { width: w, height: h, channels: 3 } }).png().toFile(path.join(pngDir, `${n}_${m}.png`)); } }
