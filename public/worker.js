// סייזי · עובד רקע: מריץ את המנוע מחוץ לחוט הראשי כדי שהדף לא ייתקע.
// בריכת עובדים: עובד אחד בונה את הסצנה (פעם אחת), ושולח עותק שלה לשאר העובדים דרך MessagePort,
// ואז כל העובדים מסדרים ומציירים גדלים במקביל.
importScripts('/bgmap.js', '/engine.js');
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
onmessage = e => {
  const m = e.data;
  try {
    if (m.type === 'bans') { SizyEngine.setBans(m.bans); return; }
    if (m.type === 'peer') { listenPeer(m.port); return; }
    if (m.type === 'pixels') { pixels = { rgba: new Uint8ClampedArray(m.rgba), w: m.w, h: m.h }; return; } // מגיע לפני שה-AI סיים, כדי לחסוך זמן בבנייה
    if (m.type === 'build') {
      const px = m.rgba ? { rgba: new Uint8ClampedArray(m.rgba), w: m.w, h: m.h } : pixels;
      if (!px) throw new Error('no pixels');
      const img = SizyEngine.fromRGBA(px.rgba, px.w, px.h);
      scene = SizyEngine.buildScene(img, m.elements, text => postMessage({ type: 'progress', id: m.id, text }));
      pixels = null;
      // קודם מחלקים לשאר העובדים (שיתחילו לעבוד), ורק אחר כך מכינים את הנתונים לעורך
      const bytes = sceneBytes(scene);
      (m.peers || []).forEach(p => p.postMessage({ type: 'scene', scene }));
      const ex = SizyEngine.exportScene(scene);
      const bufs = [ex.plate.buffer, ...ex.leaves.map(l => l.rgba.buffer)];
      postMessage({ type: 'built', id: m.id, boxes: scene.boxes, units: SizyEngine.describeUnits(scene), srcW: scene.W, srcH: scene.H, scene: ex, bytes }, bufs);
    } else if (m.type === 'place') {
      if (!scene) throw new Error('no scene');
      const items = SizyEngine.placements(scene, m.w, m.h, m.plan);
      postMessage({ type: 'placed', id: m.id, items }, items.filter(i => i.layer).map(i => i.layer.rgba.buffer));
    } else if (m.type === 'render') {
      if (!scene) throw new Error('no scene');
      const r = SizyEngine.render(scene, m.w, m.h, m.k, m.plan);
      postMessage({ type: 'rendered', id: m.id, w: r.w, h: r.h, rgba: r.rgba.buffer }, [r.rgba.buffer]);
    }
  } catch (err) {
    postMessage({ type: 'error', id: m.id, message: String((err && err.message) || err) });
  }
};
