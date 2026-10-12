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
- For a headline or subheadline that is split over several lines, also add "phrases": the same text cut into its natural meaning units (e.g. a three-line title about a trip split as ["Weekend in the north","with the family"]), words in the original order, nothing added or removed.
- If every line starts or ends with a small icon (plus, dot, check) use role "bullets", add "bullet":"plus" (or "dot"), and make the box INCLUDE the icons.
- Text that is part of a logo, seal or badge graphic is NOT a text element; it stays inside the logo.

GRAPHIC ELEMENTS (add "shape"): roles logo, photo (a picture, e.g. a portrait or a round thumbnail), button, badge, hero (the main product or character image together with its props), decor (a bar or ribbon).
- "shape": circle, pill (fully rounded), rounded, rect, free (irregular logo/graphic), hero.
- For a button also add "style": "filled" (solid colour fill) or "outline" (transparent inside with a border). An outline button includes its own text, so give it "lines" too and no separate label.
- A full-bleed background photo or gradient is NOT an element. A filled button is a "button" element and its text is a separate "label" element in the same group.

GROUPS: give the same "group" id to elements that must keep the same arrangement: a headline with its small intro line, a row of photos together with all their captions, a logo with its address line, a button with its label, a bar with its text. Use null for hero and for standalone items.`;

const ROLES = new Set(['headline', 'subheadline', 'body', 'caption', 'label', 'bullets', 'logo', 'photo', 'button', 'badge', 'hero', 'decor', 'brand']);
const SHAPES = new Set(['circle', 'pill', 'rounded', 'rect', 'free', 'hero']);

// גוגל מוציאה דגמים ישנים משימוש למפתחות חדשים, לכן שואלים את המפתח עצמו אילו דגמים זמינים:
// יציבים לפני ניסיוניים, גרסה חדשה לפני ישנה, ודגם מלא לפני Lite.
let discovered: string[] | null = null;
export function rankGeminiModels(models: any[]): string[] {
  const version = (n: string) => parseFloat(n.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? '0');
  return models
    .filter(m => (m?.supportedGenerationMethods ?? []).includes('generateContent'))
    .map(m => String(m.name ?? '').replace(/^models\//, ''))
    .filter(n => /^gemini-/.test(n) && /flash/.test(n) && !/image|tts|audio|live|embed|exp|thinking/.test(n))
    .sort((x, y) => Number(/preview/.test(x)) - Number(/preview/.test(y)) || version(y) - version(x) || Number(/lite/.test(x)) - Number(/lite/.test(y)) || Number(/latest/.test(y)) - Number(/latest/.test(x)))
    .slice(0, 4);
}
async function discoverModels(env: any, key: string, fetcher: typeof fetch): Promise<string[]> {
  if (discovered && !env.GEMINI_NO_CACHE) return discovered;
  try {
    const r = await fetcher(`${env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com'}/v1beta/models?pageSize=200`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) return [];
    const found = rankGeminiModels(((await r.json()) as any).models ?? []);
    if (found.length) discovered = found;
    return found;
  } catch { return []; }
}

export type El = { id: string; role: string; box: number[]; group: string | null; lines?: string[]; phrases?: string[]; shape?: string; style?: string; bullet?: string };

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
    if (Array.isArray(e.phrases) && e.phrases.length > 1 && e.phrases.length <= 6) d.phrases = e.phrases.map(String);
    if (SHAPES.has(e.shape)) d.shape = e.shape;
    if (e.style === 'filled' || e.style === 'outline') d.style = e.style;
    if (['plus', 'dot', 'check'].includes(e.bullet)) d.bullet = e.bullet;
    out.push(d);
  });
  return out.slice(0, 60);
}

// קורא את תשובת ה-AI גם כשהיא חתוכה או עטופה בטקסט: אוסף את כל האובייקטים השלמים שבמערך elements.
function parseJson(text: string): any {
  const t = text.replace(/```json|```/g, '').trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* ממשיכים לשחזור חלקי */ } }
  const k = t.indexOf('"elements"');
  const start = k >= 0 ? t.indexOf('[', k) : t.indexOf('[');
  const out: any[] = [];
  if (start >= 0) {
    let depth = 0, inStr = false, esc = false, from = -1;
    for (let i = start + 1; i < t.length; i++) {
      const c = t[i];
      if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === '{') { if (depth++ === 0) from = i; }
      else if (c === '}' && --depth === 0 && from >= 0) { try { out.push(JSON.parse(t.slice(from, i + 1))); } catch { /* מדלגים */ } from = -1; }
    }
  }
  if (out.length) return { elements: out };
  throw new AnalyzeError(502, 'INVALID', 'ה-AI לא החזיר ניתוח תקין. נסו שוב.', 'תשובה: ' + t.slice(0, 200));
}

export async function analyzeImage(env: any, imageBase64: string, fetcher: typeof fetch = fetch, userKey = ''): Promise<El[]> {
  const key = userKey || env.GEMINI_API_KEY;
  if (!key) throw new AnalyzeError(401, 'NEED_KEY', 'כדי להשתמש באתר צריך להדביק מפתח Gemini אישי (בחינם). ראו את שלב 1 בצד.');
  // כשדגם עמוס (503) או לא זמין (404) עוברים לדגם הבא, ואם כולם עמוסים מנסים שוב אחרי רגע.
  const found = await discoverModels(env, key, fetcher);
  const models = [...new Set([env.GEMINI_MODEL, ...found, 'gemini-flash-latest', 'gemini-3.5-flash-lite'].filter(Boolean))] as string[];
  // חשיבה מינימלית: הזיהוי הוא משימת ראייה פשוטה, וחשיבה ארוכה רק מאריכה את ההמתנה בלי לשפר.
  const thinking = (model: string) => (parseFloat(model.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] ?? '0') >= 3 ? { thinkingLevel: 'minimal' } : { thinkingBudget: 0 });
  const bodyFor = (model: string, withThinking: boolean) => JSON.stringify({
    contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: imageBase64 } }, { text: PROMPT }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 16000, responseMimeType: 'application/json', ...(withThinking ? { thinkingConfig: thinking(model) } : {}) },
  });
  let lastStatus = 0, lastDetail = '', sawBusy = false, sawInvalid = false, sawLimit = false;
  // Cloudflare מנתקת בקשה שלא נענתה כ-100 שניות, לכן מגבילים את כל הניסיונות ל-85 שניות.
  const t0 = Date.now();
  for (let round = 0; round < 2; round++) {
  if (round) await new Promise(res => setTimeout(res, env.GEMINI_RETRY_MS ?? 2000));
  for (const model of models) {
    const left = 85_000 - (Date.now() - t0);
    if (left < 8_000) break;
    let r: Response | undefined;
    for (const withThinking of [true, false]) {
      try {
        r = await fetcher(`${env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com'}/v1beta/models/${model}:generateContent`, {
          method: 'POST', body: bodyFor(model, withThinking), signal: AbortSignal.timeout(Math.min(Number(env.GEMINI_ATTEMPT_MS) || 30_000, left)),
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        });
      } catch (e: any) {
        console.error('gemini fetch failed', model, e?.name, e?.message);
        // דגם איטי או שהחיבור אליו נכשל: לא נתקעים עליו, עוברים לדגם הבא.
        sawBusy = true; lastDetail = `${model}: ${e?.name ?? ''} ${String(e?.message ?? '').slice(0, 160)}`; r = undefined; break;
      }
      if (r.status !== 400) break; // 400: הדגם לא תומך בהגדרת החשיבה, מנסים בלי
    }
    if (!r) continue;
    console.log('gemini', model, r.status);
    if (r.status === 401 || r.status === 403) console.error('gemini auth', model, r.status, (await r.clone().text().catch(() => '')).slice(0, 200));
    if (r.status === 401 || r.status === 403) throw new AnalyzeError(userKey ? 401 : 503, 'AUTH', 'מפתח ה-API של גוגל לא תקין או חסרות לו הרשאות. בדקו שהעתקתם אותו במלואו.');
    if (r.status === 429) { sawLimit = true; lastDetail = `${model}: 429 ${(await r.text().catch(() => '')).slice(0, 200)}`; console.error('gemini limit', lastDetail); continue; } // למכסה יש גבול נפרד לכל דגם: עוברים לדגם הבא
    if ([500, 502, 503, 504].includes(r.status)) { sawBusy = true; lastStatus = r.status; lastDetail = `${model}: ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`; console.error('gemini busy', lastDetail); continue; }
    if (r.status === 404 || r.status === 400) { lastStatus = r.status; lastDetail = `${model}: ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`; continue; } // דגם לא קיים: מנסים את הבא
    if (!r.ok) {
      const t = (await r.text().catch(() => '')).slice(0, 220);
      console.error('gemini upstream', model, r.status, t);
      throw new AnalyzeError(502, 'UPSTREAM', 'לא הצלחתי לדבר עם גוגל. נסו שוב בעוד רגע.', `${model}: ${r.status} ${t}`);
    }
    const data: any = await r.json().catch(() => null);
    const parts = data?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) throw new AnalyzeError(422, 'EMPTY', 'גוגל לא החזיר תשובה לבאנר הזה. נסו תמונה אחרת.');
    const reply = parts.filter((p: any) => !p.thought).map((p: any) => p.text ?? '').join('');
    console.log('gemini reply', model, data?.candidates?.[0]?.finishReason, reply.length);
    let els: El[];
    try { els = cleanElements(parseJson(reply).elements); } catch (e: any) { if (e instanceof AnalyzeError) { e.detail = `${model} ${data?.candidates?.[0]?.finishReason ?? ''}: ${e.detail}`; sawInvalid = true; lastDetail = e.detail; continue; } throw e; }
    if (!els.length) throw new AnalyzeError(422, 'NONE', 'ה-AI לא זיהה אלמנטים בבאנר. נסו תמונה אחרת.');
    return els;
  }
  }
  if (sawLimit && !sawInvalid) throw new AnalyzeError(429, 'LIMIT', 'מכסת הבקשות החינמית של גוגל התמלאה כרגע. נסו שוב בעוד דקה.', lastDetail);
  if (sawInvalid && !sawBusy) throw new AnalyzeError(502, 'INVALID', 'ה-AI לא החזיר ניתוח תקין. נסו שוב.', lastDetail);
  throw new AnalyzeError(sawBusy ? 503 : 502, sawBusy ? 'BUSY' : 'MODEL', sawBusy ? 'גוגל עמוסה או איטית כרגע ולא הצליחה לענות. נסו שוב בעוד דקה.' : lastStatus === 404 ? 'דגם ה-AI שהוגדר לא קיים. בדקו את GEMINI_MODEL.' : 'לא הצלחתי לדבר עם גוגל. נסו שוב בעוד רגע.', lastDetail);
}
