import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { cleanElements, analyzeImage } from '../src/analyze.ts';
const assets = { fetch: async (r: Request) => new Response('asset:' + new URL(r.url).pathname) };
const env: any = { APP_PASSWORD: 'correct horse', GEMINI_API_KEY: 'K', ASSETS: assets };
const gemini = (calls: any[]) => async (url: any, init: any) => {
  calls.push({ url: String(url), init });
  const els = { elements: [{ id: 'h', role: 'headline', box: [100, 200, 300, 800], lines: ['שלום'], group: null }, { id: 'x', role: 'photo', box: [0, 0, 1, 1] }] };
  return Response.json({ candidates: [{ content: { parts: [{ thought: true, text: 'hmm' }, { text: '```json\n' + JSON.stringify(els) + '\n```' }] } }] });
};
const call = (path: string, init: RequestInit = {}, e: any = env, f?: any) => worker.fetch(new Request('https://sizy.example' + path, init), e, undefined, f);

// בלי כניסה: דפים מפנים, API חסום.
let r = await call('/'); assert.equal(r.status, 303); assert.equal(r.headers.get('Location'), 'https://sizy.example/login');
assert.equal((await call('/api/status')).status, 401);
assert.equal((await call('/api/status', {}, { ...env, PUBLIC_ACCESS: 'true' })).status, 200);
assert.equal((await call('/engine.js')).status, 303);
// סיסמה שגויה / נכונה.
r = await call('/login', { method: 'POST', body: new URLSearchParams({ password: 'nope' }) }); assert.equal(r.status, 401);
r = await call('/login', { method: 'POST', body: new URLSearchParams({ password: 'correct horse' }) }); assert.equal(r.status, 303);
const cookie = r.headers.get('Set-Cookie')!.split(';')[0]; assert(cookie.startsWith('sizy_session='));
assert.equal(await (await call('/', { headers: { Cookie: cookie } })).text(), 'asset:/');
assert.deepEqual(await (await call('/api/status', { headers: { Cookie: cookie } })).json(), { ai: true, ownKey: true });
assert.deepEqual(await (await call('/api/status', { headers: { Cookie: cookie } }, { ...env, GEMINI_API_KEY: '' })).json(), { ai: false, ownKey: true });
assert.equal((await call('/api/status', { headers: { Cookie: cookie } }, { ...env, APP_PASSWORD: 'other' })).status, 401);
// ניתוח: מקור לא מהאתר נחסם; תמונה לא תקינה נדחית; תשובה תקינה מתורגמת לסדר x1,y1,x2,y2.
const img = 'A'.repeat(200), post = (body: any, extra: any = {}) => ({ method: 'POST', headers: { Cookie: cookie, Origin: 'https://sizy.example', 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
assert.equal((await call('/api/analyze', post({ image: img }, { Origin: 'https://evil.example' }))).status, 403);
assert.equal((await call('/api/analyze', post({ image: 'x' }), env, gemini([]))).status, 400);
// משתמש אנונימי (אתר פתוח) בלי מפתח אישי לא רוכב על המפתח של בעל האתר.
const open = { ...env, PUBLIC_ACCESS: 'true' }, anon = (extra: any = {}) => ({ method: 'POST', headers: { Origin: 'https://sizy.example', 'Content-Type': 'application/json', ...extra }, body: JSON.stringify({ image: img }) });
r = await call('/api/analyze', anon(), open, gemini([])); assert.equal(r.status, 401); assert.equal(((await r.json()) as any).code, 'NEED_KEY');
const own: any[] = []; r = await call('/api/analyze', anon({ 'X-Gemini-Key': 'USERKEY_12345678901234567890' }), open, gemini(own)); assert.equal(r.status, 200);
assert.equal(own[0].init.headers['x-goog-api-key'], 'USERKEY_12345678901234567890');
assert.equal((await call('/api/analyze', anon({ 'X-Gemini-Key': 'bad key!' }), open, gemini([]))).status, 400);
assert.deepEqual(await (await call('/api/status', {}, open)).json(), { ai: false, ownKey: true });
const calls: any[] = [];
r = await call('/api/analyze', post({ image: img }), env, gemini(calls)); assert.equal(r.status, 200);
const body: any = await r.json(); assert.equal(body.elements.length, 1);
assert.deepEqual(body.elements[0].box, [200, 100, 800, 300]); assert.deepEqual(body.elements[0].lines, ['שלום']);
assert.equal(calls[0].init.headers['x-goog-api-key'], 'K'); assert(calls[0].url.includes('gemini-flash-latest'));
// דגם לא קיים: עוברים לדגם הבא. מפתח שגוי: הודעה בעברית.
let n = 0; const flaky = async () => (n++ === 0 ? new Response('{}', { status: 404 }) : gemini([])('', {}));
assert.equal((await analyzeImage(env, img, flaky as any)).length, 1); assert.equal(n, 2);
await assert.rejects(() => analyzeImage(env, img, (async () => new Response('{}', { status: 403 })) as any), /מפתח/);
await assert.rejects(() => analyzeImage({}, img), /מפתח Gemini/);
assert.equal(cleanElements([{ box: [0, 0, 1, 1] }, { box: 'x' }, null, { box: [10, 20, 30, 40], role: 'weird', shape: 'circle', group: 'null' }]).length, 1);
console.log('Passed: sign-in, wrong password, cookie signature, status, cross-site block, Gemini request and parsing, model fallback, errors.');
