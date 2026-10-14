import fs from 'fs';
const D='/home/claude/sizy-cf/bench/exemplars/tzfat/';
await import('/home/claude/sizy-cf/public/bgmap.js');
await import('/home/claude/sizy-cf/public/engine.js');
const E=globalThis.SizyEngine, inp=JSON.parse(fs.readFileSync(D+'fx.json'));
const buf=fs.readFileSync(D+'fx.rgba');
const img=E.fromRGBA(new Uint8ClampedArray(buf.buffer,buf.byteOffset,buf.length),inp.w,inp.h);
const sc=E.buildScene(img,inp.elements,()=>{});
for(const [w,h] of [[361,251],[321,71],[301,601],[728,90],[160,600],[300,250],[1200,200]]){const r=E.render(sc,w,h,1);fs.writeFileSync(`${D}out/${w}x${h}.rgba`,Buffer.from(r.rgba.buffer));if(r.plan)fs.writeFileSync(`${D}out/${w}x${h}.plan.json`,JSON.stringify(r.plan,null,1));console.log(w,h,Object.keys(r));}
