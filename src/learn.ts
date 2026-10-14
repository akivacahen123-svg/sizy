// זיכרון הלמידה של סייזי: כללי עיצוב כלליים שנאספים מהערות של בעל האתר ומהביקורת האוטומטית של ה-AI.
// הכללים נשמרים ב-KV (חינמי) ומוזרקים להוראות של מעצב ה-AI בכל בנייה, כך שהאתר משתפר עם הזמן.
import { geminiRun, AnalyzeError } from './analyze.ts';

export type Lesson = { t: string; n: number; ts: number; owner?: boolean };
const KEY = 'lessons', NOTES = 'notes';

export async function readLessons(env: any): Promise<Lesson[]> {
  if (!env?.LEARN) return [];
  try { const v = await env.LEARN.get(KEY, 'json'); return Array.isArray(v) ? v : []; } catch { return []; }
}
const score = (l: Lesson) => (l.owner ? 1000 : 0) + l.n * 10 + l.ts / 1e11;
export const promptLessons = (ls: Lesson[]): string[] => ls.slice().sort((a, b) => score(b) - score(a)).slice(0, 40).map(l => l.t);

const words = (s: string) => new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
const sim = (a: string, b: string) => { const x = words(a), y = words(b); let i = 0; x.forEach(w => { if (y.has(w)) i++; }); return i / Math.max(1, x.size + y.size - i); };

export function mergeLessons(cur: Lesson[], add: string[], owner: boolean, now = Date.now()): Lesson[] {
  const out = cur.map(l => ({ ...l }));
  for (const raw of add) {
    const t = String(raw).replace(/\s+/g, ' ').trim().slice(0, 300);
    if (t.length < 12) continue;
    const hit = out.find(l => sim(l.t, t) > 0.55);
    if (hit) { hit.n++; hit.ts = now; if (owner) hit.owner = true; } else out.push({ t, n: 1, ts: now, owner: owner || undefined });
  }
  return out.sort((a, b) => score(b) - score(a)).slice(0, 80);
}

export async function saveLessons(env: any, add: string[], owner: boolean): Promise<number> {
  if (!env?.LEARN || !add.length) return 0;
  try {
    const cur = await readLessons(env), next = mergeLessons(cur, add, owner);
    await env.LEARN.put(KEY, JSON.stringify(next));
    return next.length - cur.length;
  } catch (e) { console.error('save lessons failed', (e as any)?.message); return 0; }
}

export async function logNote(env: any, rec: any) {
  if (!env?.LEARN) return;
  try { const cur = (await env.LEARN.get(NOTES, 'json')) as any[] | null; await env.LEARN.put(NOTES, JSON.stringify([...(Array.isArray(cur) ? cur : []), rec].slice(-150))); } catch { /* לא קריטי */ }
}

const parseObj = (reply: string) => {
  const t = reply.replace(/```json|```/g, '').trim();
  try { return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)); } catch { throw new AnalyzeError(502, 'INVALID', 'תשובה לא תקינה.', t.slice(0, 200)); }
};

// הופך הערה חופשית (בעברית) לכלל עיצוב כללי אחד, או מחזיר null אם ההערה נוגעת רק לבאנר הזה.
export async function distillNote(env: any, userKey: string, fetcher: typeof fetch, note: string, ctx: any): Promise<string | null> {
  const prompt = `The owner of a banner-resizing tool (which rebuilds one banner at many sizes) wrote this note about a result, in Hebrew or English:\n"""${note.slice(0, 600)}"""\nContext (sizes and units of the banner, JSON): ${JSON.stringify(ctx).slice(0, 1500)}\n\nTurn the note into ONE short, general design rule in English that a designer-AI should follow for ANY banner (imperative, specific, measurable when possible, max 35 words, no mention of this specific creative's text). If the note only concerns this one banner and is not a general principle, return null.\nReturn ONLY JSON: {"lesson": "..."} or {"lesson": null}`;
  return geminiRun(env, userKey, fetcher, [{ text: prompt }], reply => {
    const j = parseObj(reply);
    return typeof j.lesson === 'string' && j.lesson.trim().length >= 12 ? j.lesson.trim().slice(0, 300) : null;
  }, 600);
}

// כשיש יותר מדי כללים: ממזגים כפילויות ומשאירים את החשובים.
export async function consolidate(env: any, userKey: string, fetcher: typeof fetch): Promise<void> {
  const cur = await readLessons(env); if (cur.length <= 55) return;
  const prompt = `These are design rules learned for a banner-resizing designer-AI. Merge duplicates and near-duplicates, drop vague or contradictory ones (prefer the rules marked owner), and return at most 35 short, general, actionable rules in English.\nRULES:\n${cur.map((l, i) => `${i + 1}. ${l.owner ? '[owner] ' : ''}${l.t}`).join('\n')}\nReturn ONLY JSON: {"rules":["..."]}`;
  const rules = await geminiRun(env, userKey, fetcher, [{ text: prompt }], reply => { const j = parseObj(reply); if (!Array.isArray(j.rules) || !j.rules.length) throw new AnalyzeError(502, 'INVALID', 'x'); return j.rules.map(String); }, 3000);
  const ownerHit = (t: string) => cur.some(l => l.owner && sim(l.t, t) > 0.4);
  await env.LEARN.put(KEY, JSON.stringify(rules.slice(0, 35).map((t: string) => ({ t: t.slice(0, 300), n: 2, ts: Date.now(), owner: ownerHit(t) || undefined }))));
}
