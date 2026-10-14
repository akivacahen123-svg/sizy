import fs from 'fs';
const [fxn,outd,engp]=process.argv.slice(2);
await import('/home/claude/sizy-cf/public/bgmap.js'); await import(engp||'/home/claude/sizy-cf/public/engine.js');
const E=globalThis.SizyEngine, D='/home/claude/sizy-cf/bench/exemplars/speech/';
const m=JSON.parse(fs.readFileSync(D+fxn)), buf=fs.readFileSync(D+'fx.rgba');
const sc=E.buildScene(E.fromRGBA(new Uint8ClampedArray(buf.buffer,buf.byteOffset,buf.length),m.w,m.h),m.elements,()=>{});
fs.mkdirSync(outd,{recursive:true});
for(const s of '720x250,640x640,1200x200,728x90,300x600,300x250,160x600,320x70,1200x60'.split(',')){const [W,H]=s.split('x').map(Number);
 const r=E.render(sc,W,H,1);fs.writeFileSync(`${outd}/engine_${s}.rgba`,Buffer.from(r.rgba.buffer));}
