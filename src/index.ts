import { session, signIn, googleSignIn, signOutCookie, loginPage } from './auth.ts';
import { analyzeImage, AnalyzeError } from './analyze.ts';

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
    if (e instanceof AnalyzeError) return json({ error: e.message, code: e.code }, e.status);
    return json({ error: 'הניתוח לא הושלם. נסו שוב.' }, 500);
  } finally { running.delete(user); }
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

    if (pathname === '/api/status') return json({ ai: Boolean(env.GEMINI_API_KEY), ownKey: true });
    if (pathname === '/api/analyze') {
      if (env.LIMITER) {
        const { success } = await env.LIMITER.limit({ key: user });
        if (!success) return json({ error: 'נשלחו הרבה בקשות בזמן קצר. נסו שוב בעוד דקה.' }, 429);
      }
      return analyzeRoute(request, env, user, fetcher);
    }
    if (pathname.startsWith('/api/')) return json({ error: 'לא נמצא.' }, 404);
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('X-Frame-Options', 'DENY');
    return new Response(response.body, { status: response.status, headers });
  },
};
