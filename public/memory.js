// סייזי · זיכרון פריסות. לומד מגדלים שמעצב אנושי עשה: איפה כל תפקיד (כותרת, לוגו, כפתור...) ישב, ומה נמחק.
// קוד טהור, בלי תלויות. רץ בדפדפן, ב-worker וב-node. הפלט הוא רמזים רכים בלבד, לא קואורדינטות סופיות.
(function (G) {
'use strict';
const ROLES = ['headline', 'subheadline', 'logo', 'button', 'badge', 'photo', 'caption', 'body', 'legal'];
const TEXT = { headline: 1, subheadline: 1, caption: 1, body: 1, legal: 1, button: 1 };
const ASPECT_W = 1, ROLE_W = 0.6, AREA_W = 0.12, TEMP = 0.35, PSEUDO = 0.25, DEFAULT_KEEP = 0.85;

let LIB = null;
function load(lib) { LIB = prep(lib); return LIB; }

// מוסיף לכל פריסה את תפקידי המקור (מה היה זמין), כדי להשוות חפיפת תפקידים.
function prep(lib) {
  if (!lib || !Array.isArray(lib.layouts)) throw new Error('memory: bad library');
  const layouts = lib.layouts.map(L => {
    const camp = lib.campaigns && lib.campaigns[L.campaign];
    const origEls = camp ? camp.elements : L.elements;
    const origRoles = Array.from(new Set(origEls.map(e => e.role)));
    const els = L.elements.map(e => Object.assign({}, e));
    const dropped = (L.dropped || []).map(id => (origEls.find(e => e.id === id) || {}).role).filter(Boolean);
    return Object.assign({}, L, { elements: els, origRoles, droppedRoles: dropped, origEls });
  });
  return { layouts };
}

const jaccard = (a, b) => {
  const A = new Set(a), B = new Set(b); let i = 0;
  A.forEach(x => { if (B.has(x)) i++; });
  const u = A.size + B.size - i; return u ? i / u : 1;
};
const dist = (aspect, roles, L, area) => ASPECT_W * Math.abs(Math.log(aspect / L.aspect)) + ROLE_W * (1 - jaccard(roles, L.origRoles)) + (area ? AREA_W * Math.abs(Math.log(area / (L.w * L.h))) : 0);

// area (optional, in pixels, via opts.area): small canvases drop more, so it nudges the distance.
// opts: {k=4, area, lib, exclude(campaign)->bool | string | string[]}
function nearest(aspect, roles, opts) {
  opts = opts || {};
  const lib = opts.lib ? (opts.lib.layouts && opts.lib.layouts[0] && opts.lib.layouts[0].origRoles ? opts.lib : prep(opts.lib)) : LIB;
  if (!lib) throw new Error('memory: call load(library) first');
  const ex = opts.exclude, k = opts.k || 4;
  const skip = c => !ex ? false : typeof ex === 'function' ? ex(c) : Array.isArray(ex) ? ex.includes(c) : ex === c;
  const out = lib.layouts.filter(L => !skip(L.campaign)).map(L => {
    const d = dist(aspect, roles || [], L, opts.area);
    return { layout: L, distance: d, weight: Math.exp(-d / TEMP) };
  }).sort((a, b) => a.distance - b.distance).slice(0, k);
  return out;
}

// לכל תפקיד: מיקום וגובה מצופים (שבר 0-1 מהקנבס), הסתברות לשמור, וגובה שורת טקסט באחוזים.
function priors(aspect, roles, opts) {
  roles = roles || [];
  const nb = nearest(aspect, roles, opts);
  const res = {};
  for (const role of roles) {
    let wAvail = 0, wKept = 0, sy = 0, sh = 0, sx = 0, sw = 0, sl = 0, n = 0;
    for (const { layout: L, weight: w } of nb) {
      if (!L.origRoles.includes(role)) continue; // המקור הזה לא היה לו התפקיד: אין מידע
      const kept = L.elements.filter(e => e.role === role);
      const lostN = L.droppedRoles.filter(r => r === role).length;
      const total = kept.length + lostN;
      wAvail += w; wKept += w * (kept.length / total); n++;
      if (kept.length) {
        // התיבה הגדולה ביותר מייצגת את התפקיד
        const e = kept.slice().sort((a, b) => area(b.box) - area(a.box))[0], b = e.box;
        sy += w * b[1]; sh += w * (b[3] - b[1]); sx += w * b[0]; sw += w * (b[2] - b[0]);
        sl += w * (b[3] - b[1]) / Math.max(1, e.lines || 1);
        res[role] = res[role] || { _w: 0 }; res[role]._w += w;
      }
    }
    const keep = wAvail ? (wKept + PSEUDO * DEFAULT_KEEP) / (wAvail + PSEUDO) : DEFAULT_KEEP;
    const W = (res[role] && res[role]._w) || 0;
    res[role] = {
      keep: round(keep), n,
      y: W ? round(sy / W) : null, h: W ? round(sh / W) : null,
      x: W ? round(sx / W) : null, w: W ? round(sw / W) : null,
      textHeightPct: TEXT[role] && W ? round(100 * sl / W) : null, // גובה שורה אחת באחוזי גובה הקנבס
    };
  }
  return res;
}
const area = b => (b[2] - b[0]) * (b[3] - b[1]);
const round = v => Math.round(v * 1000) / 1000;

const API = { ROLES, load, nearest, priors, _dist: dist };
G.SizyMemory = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(globalThis);
