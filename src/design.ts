// "מעצב ה-AI": מסתכל על הבאנר המקורי ועל רשימת היחידות שנחתכו ממנו, ומחליט לכל גודל איפה כל יחידה
// יושבת (תיבה). המנוע בדפדפן מסדר כל יחידה בתוך התיבה שלה ובודק שהתכנית הגיונית; אם לא, חוזר לכללים.
import { AnalyzeError, geminiRun } from './analyze.ts';

export type Unit = { id: string; role: string; lines: string[]; kind: string; x: number; y: number; w: number; h: number };
export type Plan = { w: number; h: number; units: { id: string; x: number; y: number; w: number; h: number }[]; why?: string };

export const DESIGN_PROMPT = `You are a senior advertising art director and banner designer. A banner was already cut into UNITS (text groups, photo galleries, logos, buttons, a hero image). The background is handled separately and is always filled for you. Your job: for each requested size, decide where every unit sits, exactly as a trained human designer would resize this creative by hand.

Return ONLY JSON:
{"sizes":[{"w":300,"h":600,"why":"one short sentence","units":[{"id":"u0","x":100,"y":80,"w":800,"h":200}]}]}
x,y,w,h = the unit's BOX on the new canvas (x = left edge, y = top edge, w = box width, h = box height; this is NOT the [ymin,xmin,ymax,xmax] format),  integers 0-1000 normalised to the new canvas (x,w to its width, y,h to its height). The engine fits the unit inside its box keeping its proportions, centred, re-breaking text lines and re-arranging photo galleries (one row or a grid) as needed, so make each box the area the unit should visibly fill and give it roughly the unit's own proportions. A unit you leave out is removed from that size; only drop low-value items (fine print, address, secondary line) when the canvas is too small to keep them readable.

Each unit is given with its position in the ORIGINAL (0-1000 of the original image, "ar" = width/height aspect of the unit as cut). Look at the picture to understand the creative: what dominates, what is the reading order, what belongs together.

DESIGN RULES (apply with judgement - the creative decides):
1. Hierarchy: the headline is the biggest and most readable thing; then the key offer/price/number; then supporting photos; then button; small text is smallest. Keep the original's relative importance.
2. Never overlap units. Keep a safe margin of about 6% of the shorter side from every edge, and consistent gaps between units (about 3-5% of the height in tall banners).
3. Use the canvas: fill the available space with the most important content as large as it can be while respecting margins. Avoid big empty bands unless the original design is airy. Do not leave the content crowded at one end.
4. Tall / skyscraper (height much more than width): stack units top to bottom, centred on the vertical axis, headline widest (near full width), a gallery of photos in ONE row if the circles stay readable (else 2 columns), and logo and button side by side in a footer row when both fit, otherwise button then logo. Keep the original reading order.
5. Wide / leaderboard (width much more than height): lay units out left to right in one row, vertically centred: logo at the far edge, headline as the big central block, supporting photos, button at the opposite edge. In very short banners (height under about 100 px) keep only logo, headline, offer and button; drop everything small.
6. Near-square / medium rectangle: choose between a stacked column and a two-column layout, whichever fills the canvas better and keeps the headline dominant.
7. Logo: whole, never cropped, readable, usually in a corner or the footer; not larger than the headline. Button: clearly clickable, text inside readable, at the bottom or end of the reading flow.
8. Text must stay readable: its on-screen cap height should not go below about 7 px; if a text unit would be smaller, enlarge its box or drop it.
9. A hero image (product or character) keeps its proportions; in wide banners put it at one side, in tall banners under the headline.
10. Keep groups that belong together adjacent (photos with their captions, logo with its address).
11. Keep the same visual language across all sizes of this creative: same order of importance, same alignment logic.`;

export function cleanPlans(raw: any, sizes: number[][], unitIds: Set<string>): Plan[] {
  const out: Plan[] = [];
  const list = Array.isArray(raw?.sizes) ? raw.sizes : [];
  for (const [W, H] of sizes) {
    const s = list.find((p: any) => Number(p?.w) === W && Number(p?.h) === H);
    if (!s || !Array.isArray(s.units)) continue;
    const seen = new Set<string>(), units: Plan['units'] = [];
    for (const u of s.units) {
      const id = String(u?.id ?? ''); if (!unitIds.has(id) || seen.has(id)) continue;
      const v = [u.x, u.y, u.w, u.h].map(Number); if (v.some(n => !Number.isFinite(n))) continue;
      const [x, y, w, h] = v.map(n => Math.max(0, Math.min(1000, n)));
      if (w < 8 || h < 8) continue;
      seen.add(id);
      units.push({ id, x: Math.round(x / 1000 * W * 10) / 10, y: Math.round(y / 1000 * H * 10) / 10, w: Math.round(Math.min(w, 1000 - x) / 1000 * W * 10) / 10, h: Math.round(Math.min(h, 1000 - y) / 1000 * H * 10) / 10 });
    }
    if (units.length) out.push({ w: W, h: H, units, why: typeof s.why === 'string' ? s.why.slice(0, 200) : undefined });
  }
  return out;
}

const norm = (u: Unit, sw: number, sh: number) => ({ id: u.id, kind: u.kind, text: u.lines.join(' / ').slice(0, 80) || undefined, x: Math.round(u.x / sw * 1000), y: Math.round(u.y / sh * 1000), w: Math.round(u.w / sw * 1000), h: Math.round(u.h / sh * 1000), ar: Math.round(u.w / Math.max(1, u.h) * 100) / 100 });

export async function designPlans(env: any, body: { image: string; srcW: number; srcH: number; units: Unit[]; sizes: number[][]; renders?: { w: number; h: number; image: string }[]; plans?: Plan[] }, fetcher: typeof fetch = fetch, userKey = ''): Promise<Plan[]> {
  const { image, srcW, srcH, units, sizes } = body;
  const ids = new Set(units.map(u => u.id));
  const parts: any[] = [{ inline_data: { mime_type: 'image/jpeg', data: image } }];
  const info = `ORIGINAL banner ${srcW}x${srcH} (aspect ${(srcW / srcH).toFixed(2)}). UNITS: ${JSON.stringify(units.map(u => norm(u, srcW, srcH)))}\nREQUESTED SIZES (w,h in px): ${JSON.stringify(sizes)}`;
  if (body.renders?.length && body.plans?.length) {
    parts.push({ text: `${DESIGN_PROMPT}\n\n${info}\n\nREVIEW MODE: below are the current results rendered from your previous plan, one image per size in the order of the sizes, with the plan used. Judge each as a strict art director: overlaps, unreadably small text, content crammed or floating, wrong hierarchy, cropped or tiny logo, big empty areas, misalignment, anything a client would reject. Return the COMPLETE corrected JSON for every size (same schema); keep what already works unchanged. PREVIOUS PLAN (boxes as 0-1000 of each canvas):\n${JSON.stringify(body.plans.map(p => ({ w: p.w, h: p.h, units: p.units.map(u => ({ id: u.id, x: Math.round(u.x / p.w * 1000), y: Math.round(u.y / p.h * 1000), w: Math.round(u.w / p.w * 1000), h: Math.round(u.h / p.h * 1000) })) })))}` });
    for (const r of body.renders.slice(0, 12)) { parts.push({ text: `Result for size ${r.w}x${r.h}:` }); parts.push({ inline_data: { mime_type: 'image/jpeg', data: r.image } }); }
  } else parts.push({ text: `${DESIGN_PROMPT}\n\n${info}` });
  return geminiRun(env, userKey, fetcher, parts, reply => {
    const t = reply.replace(/```json|```/g, '').trim();
    let j: any; try { j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { throw new AnalyzeError(502, 'INVALID', 'ה-AI לא החזיר תכנון תקין.', t.slice(0, 200)); }
    const plans = cleanPlans(j, sizes, ids);
    if (!plans.length) throw new AnalyzeError(502, 'INVALID', 'ה-AI לא החזיר תכנון תקין.', t.slice(0, 200));
    return plans;
  }, 24000);
}
