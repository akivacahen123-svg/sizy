// סייזי · עובד רקע: מריץ את המנוע מחוץ לחוט הראשי כדי שהדף לא ייתקע.
importScripts('/engine.js');
let scene = null;
onmessage = e => {
  const m = e.data;
  try {
    if (m.type === 'build') {
      const img = SizyEngine.fromRGBA(new Uint8ClampedArray(m.rgba), m.w, m.h);
      scene = SizyEngine.buildScene(img, m.elements, text => postMessage({ type: 'progress', id: m.id, text }));
      postMessage({ type: 'built', id: m.id, boxes: scene.boxes });
    } else if (m.type === 'render') {
      if (!scene) throw new Error('no scene');
      const r = SizyEngine.render(scene, m.w, m.h, m.k);
      postMessage({ type: 'rendered', id: m.id, w: r.w, h: r.h, rgba: r.rgba.buffer }, [r.rgba.buffer]);
    }
  } catch (err) {
    postMessage({ type: 'error', id: m.id, message: String((err && err.message) || err) });
  }
};
