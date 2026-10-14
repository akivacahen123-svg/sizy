import { session, signIn, googleSignIn, signOutCookie, loginPage } from './auth.ts';
import { analyzeImage, AnalyzeError } from './analyze.ts';
import { designPlans } from './design.ts';
import { readLessons, promptLessons, saveLessons, logNote, distillNote, consolidate } from './learn.ts';

const PUBLIC_FILES = new Set<string>(['/favicon.svg']);
const running = new Set<string>();
const json = (body: any, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const html = (body: string, status = 200) => new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

async function login(request: Request, env: any) {
  if (!env.APP_PASSWORD) return html(loginPage('האתר עדיין לא מוכן: צריך להגדיר סיסמה (APP_PASSWORD).', env), 503);
  if (request.method !== 'POST') return html(loginPage('', env));
  const form = await request.formData().catch(() => null);
  const cookie = await signIn(String(form?.get('password') ?? ''), env);
  if (!cookie) {
    await new Promise(r => setTimeout(r, 1000)); // מאט ניחושי סיסמה
    return html(loginPage('הסיסמה שגויה. נסו שוב.', env), 401);
  }
  return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': cookie } });
}

// ברירת המחדל: המפתח של בעל האתר (GEMINI_API_KEY). מי שהדביק מפתח אישי עובד איתו.
async function analyzeRoute(request: Request, env: any, user: string, fetcher: typeof fetch) {
  if (request.method !== 'POST') return json({ error: 'הבקשה אינה תקינה.' }, 405);
  if (request.headers.get('Origin') !== new URL(request.url).origin) return json({ error: 'הבקשה אינה מהאתר.' }, 403);
  if (!request.headers.get('Content-Type')?.includes('application/json')) return json({ error: 'פורמט הבקשה אינו תקין.' }, 415);
  if (running.has(user)) return json({ error: 'כבר מתבצע ניתוח. המתינו לסיום.' }, 429);
  running.add(user);
  try {
    const text = await request.text();
    if (text.length > 6_000_000) return json({ error: 'התמונה גדולה מדי.' }, 413);
    let image: unknown;
    try { image = JSON.parse(text).image; } catch { return json({ error: 'הבקשה אינה תקינה.' }, 400); }
    if (typeof image !== 'string' || image.length < 100 || !/^[A-Za-z0-9+/=]+$/.test(image)) return json({ error: 'התמונה אינה תקינה.' }, 400);
    const userKey = (request.headers.get('X-Gemini-Key') ?? '').trim();
    if (userKey && !/^[A-Za-z0-9_-]{20,120}$/.test(userKey)) return json({ error: 'המפתח לא נראה תקין. העתיקו אותו שוב במלואו.' }, 400);
    return json({ elements: await analyzeImage(env, image, fetcher, userKey) });
  } catch (e) {
    if (e instanceof AnalyzeError) return json({ error: e.message, code: e.code, detail: e.detail }, e.status);
    console.error('analyze failed', (e as any)?.message);
    return json({ error: 'הניתוח לא הושלם. נסו שוב.' }, 500);
  } finally { running.delete(user); }
}

async function designRoute(request: Request, env: any, user: string, fetcher: typeof fetch) {
  if (request.method !== 'POST') return json({ error: 'הבקשה אינה תקינה.' }, 405);
  if (request.headers.get('Origin') !== new URL(request.url).origin) return json({ error: 'הבקשה אינה מהאתר.' }, 403);
  if (running.has(user)) return json({ error: 'כבר מתבצעת בקשה. המתינו לסיום.' }, 429);
  running.add(user);
  try {
    const text = await request.text();
    if (text.length > 12_000_000) return json({ error: 'הבקשה גדולה מדי.' }, 413);
    let b: any; try { b = JSON.parse(text); } catch { return json({ error: 'הבקשה אינה תקינה.' }, 400); }
    const okImg = (s: unknown) => typeof s === 'string' && s.length > 100 && /^[A-Za-z0-9+/=]+$/.test(s);
    const sizes = (Array.isArray(b.sizes) ? b.sizes : []).map((s: any) => [Number(s?.[0]), Number(s?.[1])]).filter((s: number[]) => s[0] >= 16 && s[1] >= 16 && s[0] <= 4000 && s[1] <= 4000).slice(0, 40);
    const units = (Array.isArray(b.units) ? b.units : []).slice(0, 40).map((u: any) => ({ id: String(u?.id), role: String(u?.role ?? ''), lines: Array.isArray(u?.lines) ? u.lines.map(String).slice(0, 8) : [], kind: String(u?.kind ?? ''), x: Number(u?.x), y: Number(u?.y), w: Number(u?.w), h: Number(u?.h) })).filter((u: any) => [u.x, u.y, u.w, u.h].every(Number.isFinite));
    if (!okImg(b.image) || !sizes.length || !units.length || !(b.srcW > 0) || !(b.srcH > 0)) return json({ error: 'הבקשה אינה תקינה.' }, 400);
    const userKey = (request.headers.get('X-Gemini-Key') ?? '').trim();
    if (userKey && !/^[A-Za-z0-9_-]{20,120}$/.test(userKey)) return json({ error: 'המפתח לא נראה תקין.' }, 400);
    const renders = Array.isArray(b.renders) ? b.renders.filter((r: any) => okImg(r?.image)).map((r: any) => ({ w: Number(r.w), h: Number(r.h), image: r.image })) : undefined;
    const plans = Array.isArray(b.plans) ? b.plans : undefined;
    const note = typeof b.note === 'string' ? b.note.trim().slice(0, 600) : '';
    const lessons = promptLessons(await readLessons(env));
    const res = await designPlans(env, { image: b.image, srcW: Number(b.srcW), srcH: Number(b.srcH), units, sizes, renders, plans, lessons, note }, fetcher, userKey);
    const learned = await saveLessons(env, res.lessons, false); // הביקורת האוטומטית של ה-AI מוסיפה כללים בכל בנייה
    return json({ plans: res.plans, learned, newLessons: res.lessons.length });
  } catch (e) {
    if (e instanceof AnalyzeError) return json({ error: e.message, code: e.code, detail: e.detail }, e.status);
    console.error('design failed', (e as any)?.message);
    return json({ error: 'התכנון לא הושלם.' }, 500);
  } finally { running.delete(user); }
}

async function feedbackRoute(request: Request, env: any, user: string, fetcher: typeof fetch) {
  if (request.method !== 'POST') return json({ error: 'הבקשה אינה תקינה.' }, 405);
  if (request.headers.get('Origin') !== new URL(request.url).origin) return json({ error: 'הבקשה אינה מהאתר.' }, 403);
  const b: any = await request.json().catch(() => null);
  const note = typeof b?.note === 'string' ? b.note.trim().slice(0, 600) : '';
  if (note.length < 3) return json({ error: 'כתבו הערה קצרה.' }, 400);
  if (!env.LEARN) return json({ error: 'זיכרון הלמידה עדיין לא פעיל באתר.', code: 'NOLEARN' }, 503);
  const userKey = (request.headers.get('X-Gemini-Key') ?? '').trim();
  if (userKey && !/^[A-Za-z0-9_-]{20,120}$/.test(userKey)) return json({ error: 'המפתח לא נראה תקין.' }, 400);
  const ctx = { sizes: b.sizes, units: b.units };
  await logNote(env, { ts: Date.now(), note, sizes: b.sizes });
  let lesson: string | null = null;
  try { lesson = await distillNote(env, userKey, fetcher, note, ctx); } catch (e) { console.error('distill failed', (e as any)?.message); }
  if (lesson) { await saveLessons(env, [lesson], true); try { await consolidate(env, userKey, fetcher); } catch { /* לא קריטי */ } }
  return json({ ok: true, learned: Boolean(lesson) });
}

export default {
  async fetch(request: Request, env: any, _ctx?: any, fetcher: typeof fetch = fetch): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/login') return login(request, env);
    if (pathname === '/auth/google' && request.method === 'POST') {
      if (request.headers.get('Origin') !== new URL(request.url).origin) return json({ error: 'הבקשה אינה מהאתר.' }, 403);
      const body: any = await request.json().catch(() => ({}));
      const cookie = await googleSignIn(body.credential, env);
      return cookie ? new Response(null, { status: 204, headers: { 'Set-Cookie': cookie } }) : json({ error: 'הכניסה עם Google לא הצליחה.' }, 401);
    }
    if (pathname === '/logout') return new Response(null, { status: 303, headers: { Location: '/login', 'Set-Cookie': signOutCookie } });
    if (PUBLIC_FILES.has(pathname)) return env.ASSETS.fetch(request);

    const signedIn = await session(request, env);
    const open = env.PUBLIC_ACCESS === 'true' && !env.GOOGLE_CLIENT_ID;
    const user = signedIn?.who ?? (open ? 'ip:' + (request.headers.get('CF-Connecting-IP') ?? 'unknown') : null);
    if (!user) return pathname.startsWith('/api/') ? json({ error: 'יש להיכנס עם הסיסמה כדי להמשיך.' }, 401) : Response.redirect(new URL('/login', request.url).toString(), 303);

    if (pathname === '/api/status') return json({ ai: Boolean(env.GEMINI_API_KEY), ownKey: true, learn: Boolean(env.LEARN) });
    if (pathname === '/api/analyze') {
      if (env.LIMITER) {
        const { success } = await env.LIMITER.limit({ key: user });
        if (!success) return json({ error: 'נשלחו הרבה בקשות בזמן קצר. נסו שוב בעוד דקה.' }, 429);
      }
      return analyzeRoute(request, env, user, fetcher);
    }
    if (pathname === '/api/feedback') {
      if (env.LIMITER) { const { success } = await env.LIMITER.limit({ key: user }); if (!success) return json({ error: 'נשלחו הרבה בקשות בזמן קצר. נסו שוב בעוד דקה.' }, 429); }
      return feedbackRoute(request, env, user, fetcher);
    }
    if (pathname === '/api/design') {
      if (env.LIMITER) { const { success } = await env.LIMITER.limit({ key: user }); if (!success) return json({ error: 'נשלחו הרבה בקשות בזמן קצר. נסו שוב בעוד דקה.' }, 429); }
      return designRoute(request, env, user, fetcher);
    }
    if (pathname.startsWith('/api/')) return json({ error: 'לא נמצא.' }, 404);
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Frame-Options', 'DENY');
    return new Response(response.body, { status: response.status, headers });
  },
};
