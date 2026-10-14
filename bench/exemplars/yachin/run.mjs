import fs from 'fs';
const D='/home/claude/sizy-cf/bench/exemplars/yachin/';
await import('/home/claude/sizy-cf/public/bgmap.js');
await import('/home/claude/sizy-cf/public/engine.js');
const E=globalThis.SizyEngine, inp=JSON.parse(fs.readFileSync(D+'fx.json'));
const buf=fs.readFileSync(D+'fx.rgba');
const img=E.fromRGBA(new Uint8ClampedArray(buf.buffer,buf.byteOffset,buf.length),inp.w,inp.h);
const sc=E.buildScene(img,inp.elements,()=>{});
for(const [w,h] of [[1200,200],[1200,60],[120,500],[320,320],[300,250],[300,600],[728,90],[160,600]]){const r=E.render(sc,w,h,1);fs.writeFileSync(`${D}out/${w}x${h}.rgba`,Buffer.from(r.rgba.buffer));
const pl=E.autoplace(sc,w,h);fs.writeFileSync(`${D}out/${w}x${h}.plan.json`,JSON.stringify(pl.map(e=>[e[0].id,e[0].role,e[0].isPlate||false,...e.slice(1,5).map(v=>Math.round(v*10)/10)])));console.log(w,h);}
