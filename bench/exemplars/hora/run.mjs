import fs from 'fs';
const R='/home/claude/sizy-cf/';
await import(R+'public/bgmap.js'); await import(R+'public/engine.js');
const E=globalThis.SizyEngine, D=R+'bench/exemplars/hora/';
const inp=JSON.parse(fs.readFileSync(D+'fx.json')), buf=fs.readFileSync(D+'fx.rgba');
const img=E.fromRGBA(new Uint8ClampedArray(buf.buffer,buf.byteOffset,buf.length),inp.w,inp.h);
const sc=E.buildScene(img,inp.elements,()=>{});
fs.mkdirSync(D+'out',{recursive:true});
for(const [w,h] of [[290,350],[320,70],[360,125],[1200,200],[728,90],[160,600],[300,250],[120,500],[1200,60],[300,600]]){const r=E.render(sc,w,h,1);fs.writeFileSync(D+`out/r_${w}x${h}.rgba`,Buffer.from(r.rgba.buffer));console.log(w,h,r.plan?JSON.stringify(r.plan).slice(0,300):Object.keys(r));}
