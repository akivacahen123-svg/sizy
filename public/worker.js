// סייזי · עובד רקע: מריץ את המנוע מחוץ לחוט הראשי כדי שהדף לא ייתקע.
// בריכת עובדים: עובד אחד בונה את הסצנה (פעם אחת), ושולח עותק שלה לשאר העובדים דרך MessagePort,
// ואז כל העובדים מסדרים ומציירים גדלים במקביל.
const V = self.location.search; // גרסת בנייה בכתובת: מונעת מהדפדפן להריץ קבצי מנוע ישנים מהמטמון
importScripts('/bgmap.js' + V, '/inpaint.js' + V, '/qa.js' + V, '/engine.js' + V);
let scene = null, pixels = null;
function sceneBytes(sc) {
  let n = sc.W * sc.H * 12;
  for (const l of sc.leaves) n += l.layer.lw * l.layer.lh * 16;
  return n;
}
function listenPeer(port) {
  port.onmessage = e => {
    if (e.data.type === 'scene') { scene = e.data.scene; postMessage({ type: 'ready' }); }
  };
}
// חיתוך דמות (matte) עם מודל קטן (u2netp, Apache-2.0) שרץ בדפדפן דרך onnxruntime-web. נטען רק כשיש תמונה ראשית צפה, ובכל כשל חוזרים בשקט למלבן עם שוליים רכים.
let matteRunner = null;
function loadMatte() {
  if (!matteRunner) matteRunner = (async () => {
    importScripts('/ort/ort.wasm.min.js', '/matte.js');
    ort.env.wasm.wasmPaths = '/ort/'; ort.env.wasm.numThreads = 1; ort.env.wasm.proxy = false;
    const sess = await ort.InferenceSession.create('/models/u2netp.onnx', { executionProviders: ['wasm'] });
    return async t => { const r = await sess.run({ [sess.inputNames[0]]: new ort.Tensor('float32', t, [1, 3, 320, 320]) }); return r[sess.outputNames[0]].data; };
  })();
  return matteRunner;
}
const mInside = (a, b) => { const cx = (a[0] + a[2]) / 2, cy = (a[1] + a[3]) / 2; return cx > b[0] && cx < b[2] && cy > b[1] && cy < b[3]; };
const needsMatte = (els, W, H) => (els || []).some(e => { // אותו תנאי כמו isCutout ב-matte.js (כאן כדי לא לטעון את המודל לחינם)
  if (e.matte || !Array.isArray(e.box)) return false;
  const [a, b, c, d] = e.box.map(Number), x1 = a / 1000 * W, y1 = b / 1000 * H, x2 = c / 1000 * W, y2 = d / 1000 * H;
  if (e.role === 'hero') return (x2 - x1) * (y2 - y1) >= 0.004 * W * H && x1 > 2 && y1 > 2 && x2 < W - 2 && y2 < H - 2;
  if (e.role === 'button' || e.role === 'decor' || e.shape === 'pill' || e.shape === 'panel' || (e.lines && e.lines.length) || !['logo', 'badge', 'photo', 'brand', 'sticker', 'icon'].includes(e.role)) return false;
  const w = c - a, h = d - b; if (!(w > 0 && h > 0) || w > 2.4 * h || h > 2.4 * w || (x2 - x1) * (y2 - y1) < 0.0004 * W * H) return false;
  return !els.some(o => o !== e && Array.isArray(o.box) && o.role !== 'hero' && (mInside(o.box.map(Number), [a, b, c, d]) || (!(o.lines && o.lines.length) && o.role !== 'logo' && mInside([a, b, c, d], o.box.map(Number)))));
});
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('matte timeout')), ms))]);
async function tryMatte(img, elements, id) {
  if (!needsMatte(elements, img.w, img.h)) return;
  try {
    postMessage({ type: 'progress', id, text: 'חותך את הדמות מהרקע…' });
    await withTimeout((async () => { const run = await loadMatte(); await SizyMatte.attach(img, elements, run); })(), 20000);
  } catch (err) { matteRunner = null; /* בלי חיתוך דמות: הנתיב הרגיל */ }
}
onmessage = async e => {
  const m = e.data;
  try {
    if (m.type === 'bans') { SizyEngine.setBans(m.bans); return; }
    if (m.type === 'peer') { listenPeer(m.port); return; }
    if (m.type === 'pixels') { pixels = { rgba: new Uint8ClampedArray(m.rgba), w: m.w, h: m.h }; return; } // מגיע לפני שה-AI סיים, כדי לחסוך זמן בבנייה
    if (m.type === 'build') {
      const px = m.rgba ? { rgba: new Uint8ClampedArray(m.rgba), w: m.w, h: m.h } : pixels;
      if (!px) throw new Error('no pixels');
      const img = SizyEngine.fromRGBA(px.rgba, px.w, px.h);
      const prog = text => postMessage({ type: 'progress', id: m.id, text });
      scene = SizyEngine.buildScene(img, m.elements, prog);
      // בבאנר צילומי ההרכבה-מחדש שומרת את הדמות כמות שהיא; חיתוך דמות נחוץ רק כשהיא לא פועלת (ואז בונים שוב עם המט)
      if (needsMatte(m.elements, img.w, img.h) && !SizyEngine.willReframe(scene)) {
        await tryMatte(img, m.elements, m.id);
        if (m.elements.some(e => e.matte)) scene = SizyEngine.buildScene(img, m.elements, prog);
      }
      pixels = null;
      scene._rf = undefined; // המטמון מצביע על עלה מסוים; אחרי העתקה לעובדים אחרים הוא לא תואם, כל עובד יחשב מחדש
      // קודם מחלקים לשאר העובדים (שיתחילו לעבוד), ורק אחר כך מכינים את הנתונים לעורך
      const bytes = sceneBytes(scene);
      (m.peers || []).forEach(p => p.postMessage({ type: 'scene', scene }));
      const ex = SizyEngine.exportScene(scene);
      const bufs = [ex.plate.buffer, ...ex.leaves.map(l => l.rgba.buffer)];
      postMessage({ type: 'built', id: m.id, eng: SizyEngine.BUILD, rf: (() => { try { return SizyEngine.willReframe(scene); } catch (e) { return false; } })(), why: (() => { try { return SizyEngine.reframeWhy(scene); } catch (e) { return 'שגיאת אבחון: ' + e.message; } })(), mattes: (m.elements || []).filter(e => e.matte).length, boxes: scene.boxes, units: SizyEngine.describeUnits(scene), srcW: scene.W, srcH: scene.H, scene: ex, bytes }, bufs);
    } else if (m.type === 'place') {
      if (!scene) throw new Error('no scene');
      const items = SizyEngine.placements(scene, m.w, m.h, m.plan);
      // REFRAME: הרקע הוא חלון חיתוך מהמקור, לא הרקע הרגיל של הסצנה; העורך צריך אותו כדי לצייר נכון
      let bg = null, dbg = {}; const bufs = items.filter(i => i.layer).map(i => i.layer.rgba.buffer);
      try {
        const cn = !m.plan && SizyEngine.containFor(scene, m.w, m.h), rf = cn ? null : SizyEngine.reframeFor(scene, m.w, m.h, m.plan); dbg.rf = cn ? 'contain' : rf ? rf.strategy : null;
        if (cn) {
          const K = Math.max(1, Math.min(2, 1600 / Math.max(m.w, m.h))), b = SizyEngine.containBg(scene, Math.floor(m.w * K), Math.floor(m.h * K)), n = b.w * b.h, rgba = new Uint8ClampedArray(n * 4);
          for (let i = 0; i < n; i++) { rgba[i * 4] = b.d[i * 3]; rgba[i * 4 + 1] = b.d[i * 3 + 1]; rgba[i * 4 + 2] = b.d[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
          bg = { w: b.w, h: b.h, rgba: rgba.buffer }; bufs.push(rgba.buffer);
        } else if (rf) {
          const K = Math.max(1, Math.min(2, 1600 / Math.max(m.w, m.h)));
          const b = SizyEngine.reframeBg(scene, rf, Math.floor(m.w * K), Math.floor(m.h * K), K), n = b.w * b.h, rgba = new Uint8ClampedArray(n * 4);
          for (let i = 0; i < n; i++) { rgba[i * 4] = b.d[i * 3]; rgba[i * 4 + 1] = b.d[i * 3 + 1]; rgba[i * 4 + 2] = b.d[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
          bg = { w: b.w, h: b.h, rgba: rgba.buffer }; bufs.push(rgba.buffer);
        }
      } catch (e) { bg = null; dbg.err = String((e && e.message) || e); }
      postMessage({ type: 'placed', id: m.id, items, bg, dbg }, bufs);
    } else if (m.type === 'render') {
      if (!scene) throw new Error('no scene');
      const r = SizyEngine.render(scene, m.w, m.h, m.k, m.plan);
      postMessage({ type: 'rendered', id: m.id, w: r.w, h: r.h, rgba: r.rgba.buffer }, [r.rgba.buffer]);
    }
  } catch (err) {
    postMessage({ type: 'error', id: m.id, message: String((err && err.message) || err) });
  }
};
