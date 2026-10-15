// Node prototype: run ONNX super-resolution models (onnxruntime-node, CPU) on pre-downscaled crops.
// usage: node run.mjs <workdir> <models.json>   (models: [{id,path,scale}])
import * as ort from 'onnxruntime-node';
import fs from 'fs';
const [,, WD, MODELS] = process.argv;
const man = JSON.parse(fs.readFileSync(`${WD}/manifest.json`));
const models = JSON.parse(fs.readFileSync(MODELS));
const PAD = 8;
const refl = (i, n) => { if (i < 0) i = -i; if (i >= n) i = 2 * n - 2 - i; return Math.max(0, Math.min(n - 1, i)); };
const timing = {};
for (const m of models) {
  const sess = await ort.InferenceSession.create(m.path);
  for (const it of man) {
    const raw = fs.readFileSync(`${WD}/${it.key}.raw`); const { w, h } = it;
    const pw = Math.ceil((w + 2 * PAD) / 8) * 8, ph = Math.ceil((h + 2 * PAD) / 8) * 8, f = new Float32Array(3 * pw * ph);
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const sy = refl(y - PAD, h), sx = refl(x - PAD, w);
      for (let c = 0; c < 3; c++) f[c * pw * ph + y * pw + x] = raw[(sy * w + sx) * 3 + c] / 255;
    }
    const run = () => sess.run({ input: new ort.Tensor('float32', f, [1, 3, ph, pw]) });
    let r = await run(); const t0 = performance.now(); r = await run(); const ms = performance.now() - t0;
    const o = r.output; const [, , oh, ow] = o.dims; const S = m.scale;
    const out = Buffer.alloc(w * S * h * S * 3);
    for (let y = 0; y < h * S; y++) for (let x = 0; x < w * S; x++) for (let c = 0; c < 3; c++) {
      const v = o.data[c * oh * ow + (y + PAD * S) * ow + (x + PAD * S)];
      out[(y * w * S + x) * 3 + c] = Math.max(0, Math.min(255, Math.round(v * 255)));
    }
    fs.writeFileSync(`${WD}/${it.key}.${m.id}.raw`, out);
    (timing[m.id] ??= {})[`${it.key} ${w}x${h}`] = Math.round(ms);
  }
  console.error('done', m.id);
}
fs.writeFileSync(`${WD}/timing.json`, JSON.stringify(timing, null, 1));
