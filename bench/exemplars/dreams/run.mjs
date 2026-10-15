import fs from 'fs'; import path from 'path'; import { fileURLToPath, pathToFileURL } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url)), D = here + '/', P = path.resolve(here, '../../../public') + '/';
for (const f of ['bgmap.js', 'inpaint.js', 'engine.js']) await import(pathToFileURL(P + f).href).catch(() => {});
const E = globalThis.SizyEngine, inp = JSON.parse(fs.readFileSync(D + 'fx.json')), buf = fs.readFileSync(D + 'fx.rgba');
const sc = E.buildScene(E.fromRGBA(new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.length), inp.w, inp.h), inp.elements, () => {});
const sizes = (process.argv[2] || '300x600,728x90,300x250,160x600,1200x300,320x320').split(',').map(s => s.split('x').map(Number));
fs.mkdirSync(D + 'out', { recursive: true });
for (const [w, h] of sizes) { const r = E.render(sc, w, h, 1); fs.writeFileSync(`${D}out/${w}x${h}.rgba`, Buffer.from(r.rgba.buffer)); console.log(w, h); }
