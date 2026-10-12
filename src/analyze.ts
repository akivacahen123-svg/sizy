// זיהוי אלמנטים בבאנר באמצעות Gemini של גוגל. ה-AI רק "מסתכל": הוא מחזיר תיבות ותוכן הטקסט,
// והמנוע בדפדפן (public/engine.js) חותך ומרכיב מחדש את הפיקסלים המקוריים.
export class AnalyzeError extends Error {
  constructor(public status: number, public code: string, message: string, public detail = '') { super(message); }
}

export const PROMPT = `You are analysing an advertising banner so that it can be rebuilt at other sizes. List EVERY visual element and return ONLY JSON, no other text:
{"elements":[{"id":"e1","role":"headline","box":[ymin,xmin,ymax,xmax],"group":"g1"}]}
box = tight box around the element's visible pixels, integers 0-1000 normalised to the image, ORDER IS [ymin, xmin, ymax, xmax] (y from the top, x from the left). Make boxes tight and accurate.

TEXT ELEMENTS (add "lines"): roles headline, subheadline, body, caption (small text next to a photo or logo), label (text inside a button), bullets (a list of lines that each start with a small icon).
- "lines": the exact text, one array entry per visual line, same line breaks as in the image. Never translate, fix or reword.
- If every line starts or ends with a small icon (plus, dot, check) use role "bullets", add "bullet":"plus" (or "dot"), and make the box INCLUDE the icons.
- Text that is part of a logo, seal or badge graphic is NOT a text element; it stays inside the logo.

GRAPHIC ELEMENTS (add "shape"): roles logo, photo (a picture, e.g. a portrait or a round thumbnail), button, badge, hero (the main product or character image together with its props), decor (a bar or ribbon).
- "shape": circle, pill (fully rounded), rounded, rect, free (irregular logo/graphic), hero.
- For a button also add "style": "filled" (solid colour fill) or "outline" (transparent inside with a border). An outline button includes its own text, so give it "lines" too and no separate label.
- A full-bleed background photo or gradient is NOT an element. A filled button is a "button" element and its text is a separate "label" element in the same group.

GROUPS: give the same "group" id to elements that must keep the same arrangement: a headline with its small intro line, a row of photos together with all their captions, a logo with its address line, a button with its label, a bar with its text. Use null for hero and for standalone items.`;

const ROLES = new Set(['headline', 'subheadline', 'body', 'caption', 'label', 'bullets', 'logo', 'photo', 'button', 'badge', 'hero', 'decor', 'brand']);
const SHAPES = new Set(['circle', 'pill', 'rounded', 'rect', 'free', 'hero']);

export type El = { id: string; role: string; box: number[]; group: string | null; lines?: string[]; shape?: string; style?: string; bullet?: string };

// מנקה את תשובת ה-AI. המערך בא בסדר [ymin,xmin,ymax,xmax] והופך ל-[x1,y1,x2,y2].
export function cleanElements(raw: any): El[] {
  const out: El[] = [];
  (Array.isArray(raw) ? raw : []).forEach((e: any, i: number) => {
    if (!e || typeof e !== 'object' || !Array.isArray(e.box) || e.box.length !== 4) return;
    const v = e.box.map((n: any) => Number(n));
    if (v.some((n: number) => !Number.isFinite(n))) return;
    const [y1, x1, y2, x2] = v.map((n: number) => Math.max(0, Math.min(1000, n)));
    if (x2 - x1 < 3 || y2 - y1 < 3) return;
    const d: El = { id: String(e.id ?? 'e' + i), role: ROLES.has(e.role) ? e.role : 'decor', box: [x1, y1, x2, y2], group: e.group && e.group !== 'null' ? String(e.group) : null };
    if (Array.isArray(e.lines) && e.lines.length) d.lines = e.lines.map(String);
    if (SHAPES.has(e.shape)) d.shape = e.shape;
    if (e.style === 'filled' || e.style === 'outline') d.style = e.style;
    if (['plus', 'dot', 'check'].includes(e.bullet)) d.bullet = e.bullet;
    out.push(d);
  });
  return out.slice(0, 60);
}

function parseJson(text: string): any {
  const t = text.replace(/```json|```/g, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < 0) throw new AnalyzeError(502, 'INVALID', 'ה-AI לא החזיר ניתוח תקין. נסו שוב.');
  try { return JSON.parse(t.slice(a, b + 1)); } catch { throw new AnalyzeError(502, 'INVALID', 'ה-AI לא החזיר ניתוח תקין. נסו שוב.'); }
}

export async function analyzeImage(env: any, imageBase64: string, fetcher: typeof fetch = fetch, userKey = ''): Promise<El[]> {
  const key = userKey || env.GEMINI_API_KEY;
  if (!key) throw new AnalyzeError(401, 'NEED_KEY', 'כדי להשתמש באתר צריך להדביק מפתח Gemini אישי (בחינם). ראו את שלב 1 בצד.');
  // כשדגם עמוס (503) עוברים לדגם הבא, ואם כולם עמוסים מנסים שוב אחרי רגע.
  const models = [...new Set([env.GEMINI_MODEL, 'gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'].filter(Boolean))] as string[];
  // חשיבה מינימלית: הזיהוי הוא משימת ראייה פשוטה, וחשיבה ארוכה רק מאריכה את ההמתנה בלי לשפר.
  const thinking = (model: string) => (/gemini-2/.test(model) ? { thinkingBudget: 0 } : { thinkingLevel: 'low' });
  const bodyFor = (model: string, withThinking: boolean) => JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: imageBase64 } }, { text: PROMPT }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 8000, responseMimeType: 'application/json', ...(withThinking ? { thinkingConfig: thinking(model) } : {}) },
  });
  let lastStatus = 0, lastDetail = '';
  for (let round = 0; round < 2; round++) {
  if (round) await new Promise(res => setTimeout(res, env.GEMINI_RETRY_MS ?? 2000));
  for (const model of models) {
    let r: Response | undefined;
    for (const withThinking of [true, false]) {
      try {
        r = await fetcher(`${env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com'}/v1beta/models/${model}:generateContent`, {
          method: 'POST', body: bodyFor(model, withThinking), signal: AbortSignal.timeout(75_000),
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        });
      } catch (e: any) {
        console.error('gemini fetch failed', model, e?.name, e?.message);
        if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new AnalyzeError(504, 'TIMEOUT', 'ה-AI לא ענה בזמן. נסו שוב בעוד רגע.', model);
        throw new AnalyzeError(502, 'NETWORK', 'לא הצלחתי להתחבר לגוגל. נסו שוב בעוד רגע.', `${model}: ${e?.name ?? ''} ${String(e?.message ?? '').slice(0, 160)}`);
      }
      if (r.status !== 400) break; // 400: הדגם לא תומך בהגדרת החשיבה, מנסים בלי
    }
    if (!r) continue;
    if (r.status === 401 || r.status === 403) console.error('gemini auth', model, r.status, (await r.clone().text().catch(() => '')).slice(0, 200));
    if (r.status === 401 || r.status === 403) throw new AnalyzeError(userKey ? 401 : 503, 'AUTH', 'מפתח ה-API של גוגל לא תקין או חסרות לו הרשאות. בדקו שהעתקתם אותו במלואו.');
    if (r.status === 429) throw new AnalyzeError(429, 'LIMIT', 'חרגתם ממכסת הבקשות של גוגל כרגע. נסו שוב בעוד דקה.');
    if ([500, 502, 503, 504].includes(r.status)) { lastStatus = r.status; lastDetail = `${model}: ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`; console.error('gemini busy', lastDetail); continue; }
    if (r.status === 404 || r.status === 400) { lastStatus = r.status; lastDetail = `${model}: ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`; continue; } // דגם לא קיים: מנסים את הבא
    if (!r.ok) {
      const t = (await r.text().catch(() => '')).slice(0, 220);
      console.error('gemini upstream', model, r.status, t);
      throw new AnalyzeError(502, 'UPSTREAM', 'לא הצלחתי לדבר עם גוגל. נסו שוב בעוד רגע.', `${model}: ${r.status} ${t}`);
    }
    const data: any = await r.json().catch(() => null);
    const parts = data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) throw new AnalyzeError(422, 'EMPTY', 'גוגל לא החזיר תשובה לבאנר הזה. נסו תמונה אחרת.');
    const els = cleanElements(parseJson(parts.filter((p: any) => !p.thought).map((p: any) => p.text ?? '').join('')).elements);
    if (!els.length) throw new AnalyzeError(422, 'NONE', 'ה-AI לא זיהה אלמנטים בבאנר. נסו תמונה אחרת.');
    return els;
  }
  }
  throw new AnalyzeError(lastStatus >= 500 ? 503 : 502, lastStatus >= 500 ? 'BUSY' : 'MODEL', lastStatus >= 500 ? 'גוגל עמוסה כרגע ולא הצליחה לענות. נסו שוב בעוד דקה.' : lastStatus === 404 ? 'דגם ה-AI שהוגדר לא קיים. בדקו את GEMINI_MODEL.' : 'לא הצלחתי לדבר עם גוגל. נסו שוב בעוד רגע.', lastDetail);
}
