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
};
const ovArea = (a, b) => { const ix = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]), iy = Math.min(a[2] + a[4], b[2] + b[4]) - Math.max(a[2], b[2]); return ix > 0 && iy > 0 ? ix * iy : 0; };
const leavesOf = sc => !sc || !sc.leaves ? [] : sc.leaves instanceof Map ? [...sc.leaves.values()] : sc.leaves;
const r1 = v => Math.round(v * 10) / 10;

function qaCheck(sc, W, H, placement) {
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
    const o = ovArea(a, b);
    if (o > 0.1 * Math.min(a[3] * a[4], b[3] * b[4])) { m.overlapPx += Math.round(o); worst = worst || [a, b]; }
  }
  if (worst) add('overlap');

  const ids = new Set(content.map(e => e[0].id));
  const orig = leaves.filter(l => l.role !== 'hero' && l.role !== 'decor');
  m.droppedRoles = orig.filter(l => !ids.has(l.id)).map(l => l.role);
  if (leaves.some(l => l.role === 'headline' && !ids.has(l.id))) add('headline_missing');
  if (leaves.some(l => l.role === 'button' && !ids.has(l.id))) add('button_missing');
  const placed = content.filter(e => e[0].role !== 'decor').length;
  if (orig.length && placed < 0.6 * orig.length && W * H > 20000) add('dropped', placed + ' מתוך ' + orig.length);

  if (content.length) {
    const x0 = Math.min(...content.map(e => e[1])), x1 = Math.max(...content.map(e => e[1] + e[3])), y0 = Math.min(...content.map(e => e[2])), y1 = Math.max(...content.map(e => e[2] + e[4]));
    m.margins = { left: r1(x0), top: r1(y0), right: r1(W - x1), bottom: r1(H - y1) };
    if ((x1 - x0) * (y1 - y0) / (W * H) < 0.3) add('sparse');
    if (Math.min(x0, y0, W - x1, H - y1) < 0.015 * Math.min(W, H)) add('tight_margin');
  }
  const errors = issues.filter(i => i.severity === 'error').length;
  return { pass: errors === 0, status: errors ? 'red' : issues.length ? 'orange' : 'green', issues, metrics: m };
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
<ul>${rule(!m.clipped, 'לא נחתך בקצה')}${rule(!has(q, 'tiny'), 'כיתוב קריא' + (m.minTextPx != null ? ' (' + m.minTextPx + ' פיקסלים לשורה)' : ''))}${rule(!has(q, 'overlap'), 'אין אלמנטים שעולים אחד על השני')}${rule(!has(q, 'headline_missing'), 'הכותרת נמצאת')}${rule(!has(q, 'tight_margin'), 'שוליים נוחים')}${rule(!has(q, 'dropped') && !has(q, 'sparse'), 'התוכן נשמר ומאוזן')}</ul>
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
<p class="ft">הבדיקה אוטומטית: חיתוך בקצה, גודל כיתוב, חפיפה בין אלמנטים, נוכחות הכותרת והכפתור, ושוליים. מומלץ גם מבט אנושי אחרון. להדפסה: Ctrl+P.</p></main></body></html>`;
}

const API = { qaCheck, qaReportHtml, statusText };
G.SizyQA = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(globalThis);
