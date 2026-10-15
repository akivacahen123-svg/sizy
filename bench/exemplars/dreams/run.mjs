import fs from 'fs';
const D=new URL('.',import.meta.url).pathname;const R=D+'../../../';
await import(R+'public/bgmap.js');await import(R+'public/inpaint.js').catch(()=>{});await import(R+'public/engine.js');
const E=globalThis.SizyEngine,inp=JSON.parse(fs.readFileSync(D+'fx.json')),buf=fs.readFileSync(D+'fx.rgba');
const sc=E.buildScene(E.fromRGBA(new Uint8ClampedArray(buf.buffer,buf.byteOffset,buf.length),inp.w,inp.h),inp.elements,()=>{});
const sizes=(process.argv[2]||'300x600,728x90,300x250,160x600,1200x300,320x320').split(',').map(s=>s.split('x').map(Number));
for(const [w,h] of sizes){const r=E.render(sc,w,h,1);fs.writeFileSync(`${D}out/${w}x${h}.rgba`,Buffer.from(r.rgba.buffer));console.log(w,h)}
