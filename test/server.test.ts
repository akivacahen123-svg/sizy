import assert from 'node:assert/strict';
import worker from '../src/index.ts';
import { cleanElements, analyzeImage, rankGeminiModels } from '../src/analyze.ts';
const assets = { fetch: async (r: Request) => new Response('asset:' + new URL(r.url).pathname) };
const env: any = { APP_PASSWORD: 'correct horse', GEMINI_API_KEY: 'K', ASSETS: assets };
const gemini = (calls: any[]) => async (url: any, init: any) => {
  if (String(url).includes('?pageSize')) return Response.json({ models: [] });
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
assert.deepEqual(await (await call('/api/status', { headers: { Cookie: cookie } })).json(), { ai: true, ownKey: true, learn: false });
assert.deepEqual(await (await call('/api/status', { headers: { Cookie: cookie } }, { ...env, GEMINI_API_KEY: '' })).json(), { ai: false, ownKey: true, learn: false });
assert.equal((await call('/api/status', { headers: { Cookie: cookie } }, { ...env, APP_PASSWORD: 'other' })).status, 401);
// ניתוח: מקור לא מהאתר נחסם; תמונה לא תקינה נדחית; תשובה תקינה מתורגמת לסדר x1,y1,x2,y2.
const img = 'A'.repeat(200), post = (body: any, extra: any = {}) => ({ method: 'POST', headers: { Cookie: cookie, Origin: 'https://sizy.example', 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
assert.equal((await call('/api/analyze', post({ image: img }, { Origin: 'https://evil.example' }))).status, 403);
assert.equal((await call('/api/analyze', post({ image: 'x' }), env, gemini([]))).status, 400);
// מעצב ה-AI: תכנית תקינה מומרת מ-0-1000 לפיקסלים, ויחידה לא מוכרת נזרקת.
const designReply = async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ sizes: [{ w: 300, h: 600, why: 'x', units: [{ id: 'u0', x: 100, y: 500, w: 500, h: 100 }, { id: 'zz', x: 0, y: 0, w: 100, h: 100 }] }] }) }] } }] });
const dbody = { image: img, srcW: 700, srcH: 500, sizes: [[300, 600]], units: [{ id: 'u0', role: 'button', lines: ['x'], kind: 'button', x: 1, y: 2, w: 30, h: 10 }] };
r = await call('/api/design', post(dbody), env, designReply as any); assert.equal(r.status, 200);
const dj: any = await r.json(); assert.deepEqual(dj.plans[0].units, [{ id: 'u0', x: 30, y: 300, w: 150, h: 60 }]);
assert.equal((await call('/api/design', post({ ...dbody, units: [] }), env, designReply as any)).status, 400);
assert.equal((await call('/api/design', post(dbody, { Origin: 'https://evil.example' }), env, designReply as any)).status, 403);
// אתר פתוח: מבקר אנונימי משתמש במפתח של בעל האתר; בלי מפתח בשרת ובלי מפתח אישי מקבלים בקשה להדביק מפתח.
const open = { ...env, PUBLIC_ACCESS: 'true' }, anon = (extra: any = {}) => ({ method: 'POST', headers: { Origin: 'https://sizy.example', 'Content-Type': 'application/json', ...extra }, body: JSON.stringify({ image: img }) });
r = await call('/api/analyze', anon(), { ...open, GEMINI_API_KEY: '' }, gemini([])); assert.equal(r.status, 401); assert.equal(((await r.json()) as any).code, 'NEED_KEY');
const shared: any[] = []; r = await call('/api/analyze', anon(), open, gemini(shared)); assert.equal(r.status, 200); assert.equal(shared[0].init.headers['x-goog-api-key'], 'K');
const own: any[] = []; r = await call('/api/analyze', anon({ 'X-Gemini-Key': 'USERKEY_12345678901234567890' }), open, gemini(own)); assert.equal(r.status, 200);
assert.equal(own[0].init.headers['x-goog-api-key'], 'USERKEY_12345678901234567890');
assert.equal((await call('/api/analyze', anon({ 'X-Gemini-Key': 'bad key!' }), open, gemini([]))).status, 400);
assert.deepEqual(await (await call('/api/status', {}, open)).json(), { ai: true, ownKey: true, learn: false });
const calls: any[] = [];
r = await call('/api/analyze', post({ image: img }), env, gemini(calls)); assert.equal(r.status, 200);
const body: any = await r.json(); assert.equal(body.elements.length, 1);
assert.deepEqual(body.elements[0].box, [200, 100, 800, 300]); assert.deepEqual(body.elements[0].lines, ['שלום']);
assert.equal(calls[0].init.headers['x-goog-api-key'], 'K'); assert(calls[0].url.includes('gemini-flash-latest'));
// דגם לא קיים: עוברים לדגם הבא. מפתח שגוי: הודעה בעברית.
let n = 0; const flaky = async () => (n++ === 0 ? new Response('{}', { status: 404 }) : gemini([])('', {}));
assert.equal((await analyzeImage(env, img, flaky as any)).length, 1); assert.equal(n, 2);
// דגם שלא תומך בהגדרת החשיבה (400): מנסים שוב באותו דגם בלי ההגדרה.
const bodies: any[] = []; let k = 0;
const noThink = async (_u: any, init: any) => { bodies.push(JSON.parse(init.body)); return k++ === 0 ? new Response('{}', { status: 400 }) : gemini([])('', {}); };
assert.equal((await analyzeImage(env, img, noThink as any)).length, 1);
assert(bodies[0].generationConfig.thinkingConfig && !bodies[1].generationConfig.thinkingConfig);
// בחירת דגמים: יציב לפני ניסיוני, חדש לפני ישן, מלא לפני Lite, בלי דגמי תמונה/שמע.
const listed = ['gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-flash', 'gemini-3.6-flash-preview', 'gemini-2.5-flash-image', 'gemini-2.5-pro', 'gemini-flash-latest'].map(name => ({ name: 'models/' + name, supportedGenerationMethods: ['generateContent'] }));
assert.equal(rankGeminiModels(listed)[0], 'gemini-3.5-flash'); assert(!rankGeminiModels(listed).some(n => /image|pro/.test(n)));
// גוגל עמוסה (503): עוברים לדגם הבא ומצליחים; אם הכול עמוס, הודעה ברורה.
const seen503: string[] = []; let c503 = 0;
const busy = async (u: any) => { if (String(u).includes('?pageSize')) return Response.json({ models: [] }); seen503.push(String(u).split('/models/')[1].split(':')[0]); return c503++ < 2 ? new Response('{"error":{"code":503}}', { status: 503 }) : gemini([])('', {}); };
assert.equal((await analyzeImage({ ...env, GEMINI_RETRY_MS: 0 }, img, busy as any)).length, 1); assert.deepEqual(seen503, ['gemini-flash-latest', 'gemini-3.5-flash-lite', 'gemini-flash-latest']);
await assert.rejects(() => analyzeImage({ ...env, GEMINI_RETRY_MS: 0 }, img, (async () => new Response('{}', { status: 503 })) as any), /עמוסה/);
// תשובה חתוכה באמצע (MAX_TOKENS): נקראים האלמנטים השלמים בלבד.
const cut = async (u: any) => String(u).includes('?pageSize') ? Response.json({ models: [] }) : Response.json({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"elements":[{"id":"a","role":"headline","box":[10,20,30,40],"lines":["שלום"]},{"id":"b","role":"photo","box":[50,60,70,80],"shape":"circle"},{"id":"c","role":"logo","box":[1,2' }] } }] });
const partial = await analyzeImage(env, img, cut as any); assert.equal(partial.length, 2); assert.deepEqual(partial[0].box, [20, 10, 40, 30]);
// דגם איטי (timeout): עוברים לדגם הבא ולא נכשלים.
let slow = 0; const slowFirst = async (u: any, init: any) => { if (String(u).includes('?pageSize')) return Response.json({ models: [] }); if (slow++ === 0) { const e: any = new Error('timed out'); e.name = 'TimeoutError'; throw e; } return gemini([])(u, init); };
assert.equal((await analyzeImage(env, img, slowFirst as any)).length, 1); assert.equal(slow, 2);
await assert.rejects(() => analyzeImage(env, img, (async () => new Response('{}', { status: 403 })) as any), /מפתח/);
await assert.rejects(() => analyzeImage({}, img), /מפתח Gemini/);
assert.equal(cleanElements([{ box: [0, 0, 1, 1] }, { box: 'x' }, null, { box: [10, 20, 30, 40], role: 'weird', shape: 'circle', group: 'null' }]).length, 1);
console.log('Passed: sign-in, wrong password, cookie signature, status, cross-site block, Gemini request and parsing, model fallback, errors.');

// למידה: הערה הופכת לכלל כללי ונשמרת; הכללים נכנסים להוראות המעצב; כפילויות מתאחדות.
{
  const { mergeLessons, promptLessons } = await import('../src/learn.ts');
  let m = mergeLessons([], ['Keep logo and button side by side in tall banners', 'short'], false);
  assert.equal(m.length, 1);
  m = mergeLessons(m, ['Keep the logo and the button side by side in tall banners.'], false); assert.equal(m.length, 1); assert.equal(m[0].n, 2);
  m = mergeLessons(m, ['Never shrink the headline below 8% of height'], true); assert.equal(promptLessons(m)[0], 'Never shrink the headline below 8% of height');
  const store = new Map<string, string>();
  const kv = { get: async (k: string) => (store.has(k) ? JSON.parse(store.get(k)!) : null), put: async (k: string, v: string) => { store.set(k, v); } };
  const lenv = { ...env, LEARN: kv };
  const seen: string[] = [];
  const g = async (url: any, init: any) => {
    if (String(url).includes('?pageSize')) return Response.json({ models: [] });
    const text = JSON.parse(init.body).contents[0].parts.map((p: any) => p.text ?? '').join('');
    seen.push(text);
    const out = text.includes('Turn the note into ONE') ? { lesson: 'Keep photo circles at least 16% of the banner width in tall banners.' } : { sizes: [{ w: 300, h: 600, units: [{ id: 'u0', x: 100, y: 500, w: 500, h: 100 }] }], lessons: ['Keep the headline at the full width in tall banners.'] };
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] });
  };
  const fb = await call('/api/feedback', post({ note: 'העיגולים קטנים מדי', sizes: [[300, 600]], units: [] }), lenv, g as any); assert.equal(fb.status, 200); assert.equal(((await fb.json()) as any).learned, true);
  assert.equal((await call('/api/feedback', post({ note: 'x' }), lenv, g as any)).status, 400);
  assert.equal((await call('/api/feedback', post({ note: 'העיגולים קטנים מדי' }), env, g as any)).status, 503);
  const body = { image: img, srcW: 700, srcH: 500, sizes: [[300, 600]], units: [{ id: 'u0', role: 'button', lines: ['x'], kind: 'button', x: 1, y: 2, w: 30, h: 10 }], renders: [{ w: 300, h: 600, image: img }], plans: [{ w: 300, h: 600, units: [] }], note: 'הגדל את הכותרת' };
  const dr = await call('/api/design', post(body), lenv, g as any); assert.equal(dr.status, 200); assert.equal(((await dr.json()) as any).newLessons, 1);
  const last = seen[seen.length - 1]; assert.ok(last.includes('Keep photo circles at least 16%') && last.includes("OWNER'S NOTE"), 'lessons and note must reach the designer prompt');
  assert.equal(JSON.parse(store.get('lessons')!).length, 2);
}
