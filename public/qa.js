// סייזי · דוח איכות אוטומטי. קוד טהור (דפדפן ו-node): בודק סידור של גודל אחד לפי אותם כללים של bench/bench.mjs.
// qaCheck(sc, W, H, placement): sc = {leaves: מערך או Map של עלים מהסצנה}, placement = [[leaf,x,y,w,h], ...] (כמו autoplace).
(function (G) {
const CODES = {
  clipped: ['error', 'אלמנט נחתך בקצה הבאנר'],
  tinytext: ['error', 'כיתוב קטן מדי לקריאה'],
  tinywarn: ['warn', 'כיתוב קטן, כדאי לבדוק שהוא קריא'],
  overlap: ['error', 'אלמנטים עולים אחד על השני'],
  headline_missing: ['error', 'הכותרת חסרה בבאנר'],
  button_missing: ['warn', 'הכפתור חסר בבאנר'],
  dropped: ['warn', 'חלק גדול מהאלמנטים הושמט'],
  sparse: ['warn', 'הבאנר נראה ריק, התוכן תופס חלק קטן ממנו'],
  tight_margin: ['warn', 'שוליים צרים מדי בין התוכן לקצה'],
  ragged: ['error', 'כתמים וקצוות מרוטים סביב הכותרת (שאריות של הרקע המקורי)'],
  sticker_edge: ['error', 'מלבנים עם רקע מקורי סביב אלמנטים, נראים כמו מדבקות'],
  smear: ['warn', 'אזור גדול ברקע נראה מרוח ומתוח'],
  empty_band: ['warn', 'רווח ריק גדול באמצע הבאנר'],
};
const ovArea = (a, b) => { const ix = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]), iy = Math.min(a[2] + a[4], b[2] + b[4]) - Math.max(a[2], b[2]); return ix > 0 && iy > 0 ? ix * iy : 0; };
const leavesOf = sc => !sc || !sc.leaves ? [] : sc.leaves instanceof Map ? [...sc.leaves.values()] : sc.leaves;
const r1 = v => Math.round(v * 10) / 10;

function qaCheck(sc, W, H, placement, pix) {
  const issues = [], add = (code, extra) => issues.push({ code, severity: CODES[code][0], textHe: CODES[code][1] + (extra ? ' (' + extra + ')' : '') });
  const leaves = leavesOf(sc);
  const content = (placement || []).filter(e => e && e[0] && !e[0].isPlate && e[0].role !== 'hero' && !e.hidden && !(e[0].hidden));
  const m = { minTextPx: null, margins: null, droppedRoles: [], overlapPx: 0, clipped: false };

  for (const e of content) if (e[1] < -1 || e[2] < -1 || e[1] + e[3] > W + 1 || e[2] + e[4] > H + 1) { m.clipped = true; break; }
  if (m.clipped) add('clipped');

  const small = content.filter(e => e[0].text && e[0].role !== 'label').map(e => e[4] / Math.max(1, (e[0].lines || [1]).length));
  if (small.length) {
    m.minTextPx = r1(Math.min(...small));
    if (m.minTextPx < 6.5) add('tinytext', m.minTextPx + ' פיקסלים'); else if (m.minTextPx < 9) add('tinywarn', m.minTextPx + ' פיקסלים');
  }

  let worst = null;
  for (let i = 0; i < content.length; i++) for (let j = i + 1; j < content.length; j++) {
    const a = content[i], b = content[j], ra = a[0].role, rb = b[0].role;
    if ((ra === 'button' || ra === 'badge') && rb === 'label' || (rb === 'button' || rb === 'badge') && ra === 'label') continue;
    if (a[0].group && a[0].group === b[0].group) continue; // אותה קבוצה (למשל תגית עם תמונה בתוכה): הפריסה הפנימית נשמרת מהמקור, לא חפיפה
    const o = ovArea(a, b);
    if (o > 0.1 * Math.min(a[3] * a[4], b[3] * b[4])) { m.overlapPx += Math.round(o); worst = worst || [a, b]; }
  }
  if (worst) add('overlap');

  const ids = new Set(content.flatMap(e => [e[0].id, ...(e[0].absorbs || [])])); // לוח כותרת שנחתך יחד עם הטקסט שלו
  const orig = leaves.filter(l => l.role !== 'hero' && l.role !== 'decor');
  m.droppedRoles = orig.filter(l => !ids.has(l.id)).map(l => l.role);
  if (leaves.some(l => l.role === 'headline' && !ids.has(l.id))) add('headline_missing');
  if (leaves.some(l => l.role === 'button' && !ids.has(l.id))) add('button_missing');
  // הושמט = חסרים אלמנטים חשובים (לוגו) או רוב האלמנטים. פרטים קטנים/תגית/שורת פרטים שמוסרים בכוונה (כמו אצל מעצב) לא נחשבים אזהרה
  const lost = orig.filter(l => !ids.has(l.id)), placed = orig.length - lost.length, emblem = l => l.role === 'logo' && l.group && leaves.some(q => q !== l && q.group === l.group && (q.role === 'photo' || q.role === 'badge')), coreLost = lost.filter(l => (l.role === 'logo' && !emblem(l)) || l.role === 'subheadline'); // תגית זוכה (לוגו+תמונה באותה קבוצה) שמוסרת כשאין מקום קריא היא החלטת מעצב
  if (orig.length && (coreLost.length || placed < 0.4 * orig.length) && W * H > 20000) add('dropped', placed + ' מתוך ' + orig.length);

  if (content.length) {
    const x0 = Math.min(...content.map(e => e[1])), x1 = Math.max(...content.map(e => e[1] + e[3])), y0 = Math.min(...content.map(e => e[2])), y1 = Math.max(...content.map(e => e[2] + e[4]));
    m.margins = { left: r1(x0), top: r1(y0), right: r1(W - x1), bottom: r1(H - y1) };
    if ((x1 - x0) * (y1 - y0) / (W * H) < 0.3) add('sparse');
    if (Math.min(x0, y0, W - x1, H - y1) < 0.015 * Math.min(W, H)) add('tight_margin');
  }
  if (pix) {
    const px = pixelCheck(pix, W, H, placement); m.pixel = px;
    if (px.ragged) add('ragged');
    if (px.sticker_edge) add('sticker_edge', px.sticker_edge.leaves + ' אלמנטים');
    if (px.smear) add('smear');
    if (px.empty_band) add('empty_band');
  }
  const errors = issues.filter(i => i.severity === 'error').length;
  return { pass: errors === 0, status: errors ? 'red' : issues.length ? 'orange' : 'green', issues, metrics: m };
}


// ---------------------------------------------------------------- גלאי פיקסלים (על הקנבס הסופי, בקנה מידה מוקטן: עשרות אלפי פיקסלים)
// pix = {rgba, w, h} של התמונה הסופית (יכול להיות בקנה מידה שונה מ-W×H, התיבות במידות W×H). boxes: {text:[{x,y,w,h,lh}], leaves:[{x,y,w,h,opq}], content:[{x,y,w,h}]}
function prep(pix, W, H, maxSide) {
  const k = Math.max(1, Math.ceil(Math.max(pix.w, pix.h) / maxSide)), w = Math.floor(pix.w / k), h = Math.floor(pix.h / k), c = new Float32Array(w * h * 3), L = new Float32Array(w * h), d = pix.rgba, kk = k * k;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) { const p = ((y * k + j) * pix.w + x * k + i) * 4; r += d[p]; g += d[p + 1]; b += d[p + 2]; }
    const q = y * w + x; c[q * 3] = r / kk; c[q * 3 + 1] = g / kk; c[q * 3 + 2] = b / kk; L[q] = 0.299 * c[q * 3] + 0.587 * c[q * 3 + 1] + 0.114 * c[q * 3 + 2];
  }
  return { c, L, w, h, s: pix.w / W / k }; // s: מקדם מ-W×H לפיקסלי העבודה
}
const cdist = (c, a, b) => (Math.abs(c[a] - c[b]) + Math.abs(c[a + 1] - c[b + 1]) + Math.abs(c[a + 2] - c[b + 2])) / 3;
const rectW = (P, b, pad) => [Math.max(0, Math.floor(b.x * P.s) - pad), Math.max(0, Math.floor(b.y * P.s) - pad), Math.min(P.w, Math.ceil((b.x + b.w) * P.s) + pad), Math.min(P.h, Math.ceil((b.y + b.h) * P.s) + pad)];

// (א) ragged: טקסט בהיר, ובתיבה (ובשוליה) הרבה שברי "דיו" כהה מבודדים שאינם אותיות ואינם פאנל אחיד
function detRagged(P, texts) {
  const { L, w } = P; let worst = null;
  for (const b of texts) {
    const pad = Math.max(2, Math.round(0.3 * b.lh * P.s)), [x0, y0, x1, y1] = rectW(P, b, pad), bw = x1 - x0;
    if (bw < 12 || y1 - y0 < 8) continue;
    const ring = [], ins = [];
    for (let y = Math.max(0, y0 - pad); y < Math.min(P.h, y1 + pad); y++) for (let x = Math.max(0, x0 - pad); x < Math.min(w, x1 + pad); x++) if (x < x0 || x >= x1 || y < y0 || y >= y1) ring.push(L[y * w + x]);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ins.push(L[y * w + x]);
    if (ring.length < 20) continue;
    ring.sort((a, b) => a - b); ins.sort((a, b) => a - b);
    const med = ring[ring.length >> 1], top = ins[Math.floor(ins.length * 0.95)], bot = ins[Math.floor(ins.length * 0.05)];
    if (med < 85 || top < Math.max(170, med + 40) || top - med <= med - bot) continue; // רק טקסט בהיר על רקע בינוני/בהיר
    const seen = new Uint8Array(bw * (y1 - y0)); let dark = 0, comps = 0, tot = 0, big = 0, st = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (L[y * w + x] < 40) {
      dark++; const li = (y - y0) * bw + x - x0; if (seen[li]) continue;
      let a = 0; seen[li] = 1; st.push(y * w + x);
      while (st.length) { const p = st.pop(), px = p % w, py = (p / w) | 0; a++;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = px + dx, yy = py + dy; if (xx >= x0 && xx < x1 && yy >= y0 && yy < y1 && L[yy * w + xx] < 40) { const q = (yy - y0) * bw + xx - x0; if (!seen[q]) { seen[q] = 1; st.push(yy * w + xx); } } } }
      if (a >= 4) { comps++; tot += a; big = Math.max(big, a); }
    }
    const f = dark / ins.length, bigShare = tot ? big / tot : 0;
    if (f >= 0.1 && comps >= 18 && bigShare >= 0.5 && (!worst || comps > worst.comps)) worst = { comps, dark: r1(f * 100) / 100, bigShare: r1(bigShare * 100) / 100 };
  }
  return worst;
}

// (ב) sticker_edge: תפר ישר (קפיצת צבע) לאורך שלוש צלעות לפחות של תיבת עלה תמונה/גרפיקה, בלי שהרקע שבחוץ משתנה באותה צורה
function seamSide(P, s, x0, y0, x1, y1, off) {
  const { c, w, h } = P, len = s < 2 ? x1 - x0 : y1 - y0; let n = 0, hit = 0;
  for (let t = 0; t < len; t++) {
    let x, y, dx = 0, dy = 0;
    if (s === 0) { x = x0 + t; y = y0 + off; dy = -1; } else if (s === 1) { x = x0 + t; y = y1 - 1 + off; dy = 1; } else if (s === 2) { x = x0 + off; y = y0 + t; dx = -1; } else { x = x1 - 1 + off; y = y0 + t; dx = 1; }
    const xo = x + 3 * dx, yo = y + 3 * dy, xi = x - dx, yi = y - dy;
    if (xo < 0 || yo < 0 || xo >= w || yo >= h || xi < 0 || yi < 0 || xi >= w || yi >= h || x < 0 || y < 0 || x >= w || y >= h) continue;
    n++;
    const at = k => ((y + k * dy) * w + x + k * dx) * 3;
    const dio = (cdist(c, at(0), at(3)) + cdist(c, at(-1), at(2))) / 2, dio2 = cdist(c, at(0), at(1)), doo = (cdist(c, at(1), at(2)) + cdist(c, at(2), at(3))) / 2, d = (dio + dio2) / 2;
    if (d > 20 && d > 1.8 * doo + 8) hit++;
  }
  return n < 4 ? 0 : hit / n;
}
function detSticker(P, leaves, W, H) {
  let bad = 0, total = 0, worst = 0;
  for (const l of leaves) {
    if (l.w * (P.s) < 10 || l.h * P.s < 10 || l.w < 24 || l.h < 24) continue;
    if (l.opq != null && l.opq < 0.9) continue; // לעלה עם שקיפות בקצה אין תפר מלבני
    total++;
    const [x0, y0, x1, y1] = rectW(P, l, 0); let sides = 0, mn = 1;
    for (let s = 0; s < 4; s++) { let best = 0; for (let off = -2; off <= 2; off++) best = Math.max(best, seamSide(P, s, x0, y0, x1, y1, off)); if (best >= 0.7) sides++; mn = Math.min(mn, best); }
    if (sides >= 3) bad++;
  }
  return bad >= 2 ? { leaves: bad, of: total } : null;
}

// (ג) smear: אזור שטוח גדול בלי תוכן, צבעוני ולא אחיד (טשטוש/מתיחה), שמשאיר מעט מאוד פירוט חד ברקע, ועדיין עם גרעיניות של צילום (שיפוע גרפי נקי הוא לא מריחה)
function detSmear(P, content) {
  const { c, w, h } = P, B = 6, bw = Math.floor(w / B), bh = Math.floor(h / B);
  if (bw < 4 || bh < 4) return null;
  const m = new Float32Array(bw * bh), mc = new Float32Array(bw * bh * 3), ex = new Uint8Array(bw * bh);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    let s = 0, r = 0, g = 0, b = 0;
    for (let y = 0; y < B; y++) for (let x = 0; x < B; x++) {
      const i = ((by * B + y) * w + bx * B + x) * 3; r += c[i]; g += c[i + 1]; b += c[i + 2];
      if (x < B - 1 && y < B - 1) s += cdist(c, i, i + 3) + cdist(c, i, i + 3 * w);
    }
    const q = by * bw + bx; m[q] = s / (B * B); mc[q * 3] = r / (B * B); mc[q * 3 + 1] = g / (B * B); mc[q * 3 + 2] = b / (B * B);
  }
  for (const b of content) {
    const [x0, y0, x1, y1] = rectW(P, b, 0);
    for (let by = Math.max(0, Math.floor(y0 / B) - 2); by <= Math.min(bh - 1, Math.floor(y1 / B) + 2); by++) for (let bx = Math.max(0, Math.floor(x0 / B) - 2); bx <= Math.min(bw - 1, Math.floor(x1 / B) + 2); bx++) ex[by * bw + bx] = 1;
  }
  let avail = 0, tex = 0; const fl = new Uint8Array(bw * bh);
  for (let i = 0; i < fl.length; i++) if (!ex[i]) { avail++; if (m[i] > 14) tex++; fl[i] = m[i] < 6 ? 1 : 0; }
  const lab = new Int32Array(bw * bh); let best = 0, bestId = 0, n = 0, st = [];
  for (let i = 0; i < fl.length; i++) if (fl[i] && !lab[i]) {
    n++; let a = 0; lab[i] = n; st.push(i);
    while (st.length) { const p = st.pop(), x = p % bw, y = (p / bw) | 0; a++; for (const q of [x > 0 ? p - 1 : -1, x < bw - 1 ? p + 1 : -1, y > 0 ? p - bw : -1, y < bh - 1 ? p + bw : -1]) if (q >= 0 && fl[q] && !lab[q]) { lab[q] = n; st.push(q); } }
    if (a > best) { best = a; bestId = n; }
  }
  if (!bestId) return null;
  const sm = [0, 0, 0], sq = [0, 0, 0];
  for (let i = 0; i < lab.length; i++) if (lab[i] === bestId) for (let j = 0; j < 3; j++) { sm[j] += mc[i * 3 + j]; sq[j] += mc[i * 3 + j] ** 2; }
  let mm = 0; for (let i = 0; i < lab.length; i++) if (lab[i] === bestId) mm += m[i]; mm /= best;
  const sd = (sq.map((v, j) => Math.sqrt(Math.max(0, v / best - (sm[j] / best) ** 2))).reduce((a, b) => a + b, 0)) / 3, area = best / (bw * bh), texShare = tex / (bw * bh);
  return area >= 0.08 && sd >= 30 && texShare >= 0.03 && texShare <= 0.15 && mm >= 1.2 ? { area: r1(area * 100) / 100, colStd: r1(sd), tex: r1(texShare * 100) / 100, meanG: r1(mm) } : null;
}

// (ד) empty_band: רווח ריק גדול בין אלמנטים (אנכי, ובבאנר רחב גם אופקי)
function detGap(content, W, H) {
  if (content.length < 2) return null;
  const gap = (lo, hi, span) => { const iv = content.map(b => [b[lo], b[lo] + b[hi]]).sort((a, b) => a[0] - b[0]); let end = iv[0][1], g = 0; for (let i = 1; i < iv.length; i++) { if (iv[i][0] > end) g = Math.max(g, iv[i][0] - end); end = Math.max(end, iv[i][1]); } return g / span; };
  const v = gap('y', 'h', H), hz = W / H >= 2 ? gap('x', 'w', W) : 0;
  return v >= 0.28 || hz >= 0.33 ? { vertical: r1(v * 100) / 100, horizontal: r1(hz * 100) / 100 } : null;
}

// שקיפות קצה של עלה (0..1): עלה עם קצה אטום לגמרי הוא "חיתוך מלבני". null אם אין נתונים (סצנה בלי שכבות)
function opaqueBorder(l) {
  if (l._opq !== undefined) return l._opq;
  let v = null;
  try {
    const A = l.layer && l.layer.a, lw = l.lw || (l.layer && l.layer.lw), lh = l.lh || (l.layer && l.layer.lh);
    let al = null;
    if (A && lw && lh) al = (x, y) => A[y * lw + x] > 0.9;
    else if (l.rgba && lw && lh) al = (x, y) => l.rgba[(y * lw + x) * 4 + 3] > 230;
    else if (l.canvas && l.canvas.getContext) {
      const cx = l.canvas.getContext('2d'), cw = l.canvas.width, ch = l.canvas.height, top = cx.getImageData(0, 0, cw, 1).data, bot = cx.getImageData(0, ch - 1, cw, 1).data, lef = cx.getImageData(0, 0, 1, ch).data, rig = cx.getImageData(cw - 1, 0, 1, ch).data;
      let n = 0, o = 0; for (const d of [top, bot, lef, rig]) for (let i = 3; i < d.length; i += 4) { n++; if (d[i] > 230) o++; }
      v = n ? o / n : null;
    }
    if (al) { let n = 0, o = 0; for (let i = 0; i < lw; i++) for (const j of [0, lh - 1]) { n++; if (al(i, j)) o++; } for (let j = 1; j < lh - 1; j++) for (const i of [0, lw - 1]) { n++; if (al(i, j)) o++; } v = n ? o / n : null; }
  } catch (e) { v = null; }
  try { l._opq = v; } catch (e) { /* עלה קפוא */ }
  return v;
}

/** בדיקות פיקסלים. pix={rgba,w,h}; pl = placement ([leaf,x,y,w,h]) או boxes מוכנים. מחזיר {ragged,sticker_edge,smear,empty_band} (null = תקין) */
function pixelCheck(pix, W, H, pl) {
  const out = { ragged: null, sticker_edge: null, smear: null, empty_band: null };
  if (!pix || !pix.rgba || pix.w < 40 || pix.h < 20) return out;
  const items = (pl || []).filter(e => e && e[0] && !e[0].isPlate && e[0].role !== 'hero' && !e[0].hidden && !e.hidden && e[3] > 1 && e[4] > 1);
  const box = e => ({ x: e[1], y: e[2], w: e[3], h: e[4] });
  const texts = items.filter(e => e[0].text && e[0].role !== 'label').map(e => ({ ...box(e), lh: e[4] / Math.max(1, (e[0].lines || [1]).length) }));
  const leaves = items.filter(e => !e[0].text && e[0].role !== 'decor').map(e => ({ ...box(e), opq: opaqueBorder(e[0]) }));
  const P = prep(pix, W, H, 480);
  out.empty_band = detGap(items.filter(e => e[0].role !== 'decor').map(box), W, H);
  out.ragged = detRagged(P, texts); out.sticker_edge = detSticker(P, leaves, W, H); out.smear = detSmear(P, items.map(box));
  return out;
}

const MSG = { green: 'תקין', orange: 'כדאי לבדוק', red: 'דורש תיקון' };
const statusText = qa => MSG[qa.status] + (qa.issues.length ? ': ' + qa.issues[0].textHe + (qa.issues.length > 1 ? ' ועוד ' + (qa.issues.length - 1) : '') : '');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// דוח HTML בעברית (RTL) להדפסה ולשליחה ללקוח. entries: [{w,h,name,thumb(data URI),qa}]
function qaReportHtml(entries, opts) {
  opts = opts || {};
  const ok = entries.filter(e => e.qa.status === 'green').length, chk = entries.filter(e => e.qa.status === 'orange').length, bad = entries.length - ok - chk;
  const rule = (okk, t) => `<li class="${okk ? 'y' : 'n'}"><b>${okk ? '✓' : '✗'}</b> ${esc(t)}</li>`;
  const has = (q, c) => q.issues.some(i => i.code === c || (c === 'tiny' && (i.code === 'tinytext')));
  const cards = entries.map(e => {
    const q = e.qa, m = q.metrics, extra = q.issues.map(i => `<li class="${i.severity === 'error' ? 'n' : 'w'}"><b>${i.severity === 'error' ? '✗' : '!'}</b> ${esc(i.textHe)}</li>`).join('');
    return `<section class="sz ${q.status}"><div class="th">${e.thumb ? `<img src="${esc(e.thumb)}" alt="${esc(e.w + '×' + e.h)}">` : ''}</div>
<div class="tx"><h2>${e.w} × ${e.h} <span class="pill">${MSG[q.status]}</span></h2>
<ul>${rule(!m.clipped, 'לא נחתך בקצה')}${rule(!has(q, 'tiny'), 'כיתוב קריא' + (m.minTextPx != null ? ' (' + m.minTextPx + ' פיקסלים לשורה)' : ''))}${rule(!has(q, 'overlap'), 'אין אלמנטים שעולים אחד על השני')}${rule(!has(q, 'headline_missing'), 'הכותרת נמצאת')}${rule(!has(q, 'tight_margin'), 'שוליים נוחים')}${rule(!has(q, 'dropped') && !has(q, 'sparse'), 'התוכן נשמר ומאוזן')}${m.pixel ? rule(!has(q, 'ragged') && !has(q, 'sticker_edge'), 'קצוות נקיים, בלי כתמים ובלי מלבני רקע') + rule(!has(q, 'smear') && !has(q, 'empty_band'), 'רקע חלק ללא מריחות ורווחים ריקים') : ''}</ul>
${extra ? `<p class="h">הערות:</p><ul>${extra}</ul>` : ''}</div></section>`;
  }).join('\n');
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>דוח איכות באנרים</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f4f6fb;color:#16203a;font:16px/1.5 Heebo,Arial,sans-serif}main{max-width:900px;margin:0 auto;padding:24px 16px}
h1{margin:0 0 4px;font-size:26px}.sub{color:#5b6785;margin:0 0 16px}.sum{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 20px}.sum span{background:#fff;border:1px solid #dbe3f3;border-radius:12px;padding:8px 14px;font-weight:700}
.sz{display:flex;gap:16px;background:#fff;border:1px solid #dbe3f3;border-right:6px solid #2e9e5b;border-radius:14px;padding:14px;margin:0 0 14px;break-inside:avoid}.sz.orange{border-right-color:#e8890c}.sz.red{border-right-color:#d33}
.th{flex:0 0 300px;display:flex;align-items:center;justify-content:center;background:#eef1f8;border-radius:10px;padding:8px}.th img{max-width:100%;max-height:260px;display:block}.tx{flex:1;min-width:0}h2{margin:0 0 8px;font-size:19px}
.pill{font-size:13px;font-weight:700;border-radius:99px;padding:2px 10px;margin-inline-start:6px;background:#dff3e6;color:#17683a}.orange .pill{background:#fdebd0;color:#8a4b00}.red .pill{background:#fbdcdc;color:#9b1c1c}
ul{list-style:none;margin:0;padding:0}li{margin:2px 0}li.y b{color:#2e9e5b}li.n b{color:#d33}li.w b{color:#e8890c}.h{margin:10px 0 2px;font-weight:700}.ft{color:#5b6785;font-size:13px;margin-top:20px}
@media(max-width:640px){.sz{flex-direction:column}.th{flex-basis:auto}}@media print{body{background:#fff}main{padding:0}.sz{border:1px solid #bbb;border-right-width:6px}}</style></head><body><main>
<h1>דוח איכות באנרים</h1><p class="sub">${esc(opts.title || 'נבדק אוטומטית על ידי סייזי')} · ${esc(opts.date || '')} · ${entries.length} גדלים</p>
<div class="sum"><span>✓ תקינים: ${ok}</span><span>! לבדיקה: ${chk}</span><span>✗ דורשים תיקון: ${bad}</span></div>
${cards}
<p class="ft">הבדיקה אוטומטית: חיתוך בקצה, גודל כיתוב, חפיפה בין אלמנטים, נוכחות הכותרת והכפתור, שוליים, ובדיקת פיקסלים לכתמים, מלבני רקע, מריחות ורווחים ריקים. מומלץ גם מבט אנושי אחרון. להדפסה: Ctrl+P.</p></main></body></html>`;
}

const API = { qaCheck, qaReportHtml, statusText, pixelCheck };
G.SizyQA = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(globalThis);
