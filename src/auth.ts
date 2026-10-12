// Sign-in. Visitors sign in with Google (when GOOGLE_CLIENT_ID is set) or with APP_PASSWORD. The session cookie is "<expiry>.<who>.<signature>",
// where <who> is "owner" or the visitor's email (base64url), signed with APP_PASSWORD, so changing the
// password signs everyone out.
const COOKIE = 'sizy_session';
const MAX_AGE = 60 * 60 * 24 * 30;
const encoder = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

async function sign(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode('sizy:' + value))));
}

// Compares by HMAC so timing does not reveal how much of the guess matched.
async function same(secret: string, a: string, b: string) {
  const [x, y] = await Promise.all([sign(secret, 'cmp:' + a), sign(secret, 'cmp:' + b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function readCookie(request: Request) {
  const match = (request.headers.get('Cookie') ?? '').match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]+)'));
  return match ? match[1] : null;
}

export type Session = { who: string; owner: boolean };

// Returns who is signed in, or null.
export async function session(request: Request, env: any): Promise<Session | null> {
  const token = readCookie(request);
  if (!env.APP_PASSWORD || !token) return null;
  const parts = token.split('.');
  // Two parts: a password session from before Google sign-in existed.
  const [expiry, who, signature] = parts.length === 2 ? [parts[0], 'owner', parts[1]] : parts;
  if (!expiry || !who || !signature || !(Number(expiry) > Date.now() / 1000)) return null;
  const signed = parts.length === 2 ? expiry : expiry + '.' + who;
  if (!(await same(env.APP_PASSWORD, signature, await sign(env.APP_PASSWORD, signed)))) return null;
  return who === 'owner' ? { who: 'owner', owner: true } : { who: 'google:' + new TextDecoder().decode(fromB64url(who)), owner: false };
}

async function cookieFor(who: string, env: any) {
  const expiry = String(Math.floor(Date.now() / 1000) + MAX_AGE);
  return `${COOKIE}=${expiry}.${who}.${await sign(env.APP_PASSWORD, expiry + '.' + who)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}

export async function signIn(password: string, env: any): Promise<string | null> {
  if (!env.APP_PASSWORD || !(await same(env.APP_PASSWORD, password, env.APP_PASSWORD))) return null;
  return cookieFor('owner', env);
}

// Verifies a "Sign in with Google" ID token against Google's published keys and returns a session cookie.
let googleKeys: { at: number; keys: any[] } | null = null;
export async function googleSignIn(credential: string, env: any, fetcher: typeof fetch = fetch): Promise<string | null> {
  if (!env.GOOGLE_CLIENT_ID || !env.APP_PASSWORD || typeof credential !== 'string') return null;
  const [h, p, sig] = credential.split('.');
  if (!h || !p || !sig) return null;
  try {
    const header = JSON.parse(new TextDecoder().decode(fromB64url(h)));
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(p)));
    if (header.alg !== 'RS256') return null;
    if (!googleKeys || Date.now() - googleKeys.at > 3600_000) {
      const r = await fetcher('https://www.googleapis.com/oauth2/v3/certs');
      googleKeys = { at: Date.now(), keys: ((await r.json()) as any).keys ?? [] };
    }
    const jwk = googleKeys.keys.find(k => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, fromB64url(sig), encoder.encode(h + '.' + p));
    const now = Date.now() / 1000;
    if (!ok || !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) || claims.aud !== env.GOOGLE_CLIENT_ID
      || !(claims.exp > now) || claims.email_verified !== true || typeof claims.email !== 'string') return null;
    return cookieFor(b64url(encoder.encode(claims.email.toLowerCase())), env);
  } catch { return null; }
}

export const signOutCookie = `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export function loginPage(message = '', env: any = {}) {
  const google = env.GOOGLE_CLIENT_ID ? `<p class="lead">כניסה עם חשבון Google</p>
<div id="g_id_onload" data-client_id="${esc(env.GOOGLE_CLIENT_ID)}" data-callback="sizyGoogle" data-auto_prompt="false"></div>
<div class="g_id_signin" data-type="standard" data-size="large" data-text="signin_with" data-shape="pill" data-locale="he" data-width="300"></div>
<script>function sizyGoogle(r){fetch('/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({credential:r.credential})}).then(x=>{if(x.ok)location.href='/';else document.getElementById('login-error').textContent='הכניסה עם Google לא הצליחה. נסו שוב.';});}</script>
<script src="https://accounts.google.com/gsi/client" async></script>
<details><summary>כניסה עם סיסמה</summary>` : '';
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>כניסה · סייזי</title>
<style>:root{--bg:#eef3fb;--card:rgba(255,255,255,.8);--ink:#14213d;--mut:#5b6b84;--line:rgba(120,140,180,.28);--acc:#1f6feb}
@media (prefers-color-scheme:dark){:root{--bg:#0a1020;--card:rgba(22,32,58,.78);--ink:#e8eefc;--mut:#9fb0cc;--line:rgba(140,165,215,.22);--acc:#5a97ff}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);background-image:radial-gradient(900px 560px at 88% -8%,rgba(76,141,255,.38),transparent 62%),radial-gradient(760px 520px at 4% 14%,rgba(140,110,255,.24),transparent 60%);color:var(--ink);font-family:Heebo,system-ui,Segoe UI,Arial,sans-serif}
.card{width:min(92vw,360px);background:var(--card);border:1px solid var(--line);border-radius:18px;padding:26px;box-shadow:0 8px 30px rgba(20,40,90,.1);backdrop-filter:blur(16px)}
.brand{display:flex;align-items:center;gap:11px;margin-bottom:18px}.logo{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,var(--acc),#8a63ff);display:grid;place-items:center}
b{font-size:26px;font-weight:800}i{font-style:normal;color:var(--mut);letter-spacing:.16em;font-size:13px;direction:ltr}
label{display:block;margin:12px 0 6px;color:var(--mut)}input{width:100%;box-sizing:border-box;padding:11px 14px;font:inherit;font-size:16px;border:1px solid var(--line);border-radius:12px;background:transparent;color:var(--ink)}
button{margin-top:14px;width:100%;background:linear-gradient(100deg,var(--acc),#6a5cff);color:#fff;border:0;border-radius:12px;padding:12px;font:inherit;font-weight:700;cursor:pointer}
.error{color:#d63a3a;min-height:20px;margin:12px 0 0}.lead{margin:0 0 10px;color:var(--mut)}summary{cursor:pointer;color:var(--mut);margin-top:14px}</style></head>
<body><main class="card"><div class="brand"><span class="logo"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9V4h5M20 15v5h-5M4 4l7 7M20 20l-7-7"/></svg></span><b>סייזי</b><i>Sizes</i></div>
${google}<form method="post" action="/login"><label for="password">סיסמה</label><input id="password" name="password" type="password" autocomplete="current-password" required${env.GOOGLE_CLIENT_ID ? '' : ' autofocus'}>
<button type="submit">כניסה</button></form>${env.GOOGLE_CLIENT_ID ? '</details>' : ''}<p class="error" id="login-error" role="alert">${message ? esc(message) : ''}</p></main></body></html>`;
}
