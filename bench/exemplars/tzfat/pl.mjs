import fs from 'fs';
const D='/home/claude/sizy-cf/bench/exemplars/tzfat/';
await import('/home/claude/sizy-cf/public/bgmap.js');await import('/home/claude/sizy-cf/public/engine.js');
const E=globalThis.SizyEngine, inp=JSON.parse(fs.readFileSync(D+'fx.json'));
const buf=fs.readFileSync(D+'fx.rgba');
const sc=E.buildScene(E.fromRGBA(new Uint8ClampedArray(buf.buffer,buf.byteOffset,buf.length),inp.w,inp.h),inp.elements,()=>{});
console.log(JSON.stringify(E.describeUnits(sc)).slice(0,1500));
for(const [w,h] of [[361,251],[321,71],[301,601],[728,90],[160,600],[300,250],[1200,200]]){
 console.log('== ',w,h);
 for(const [k,x,y,wd,ht] of E.autoplace(sc,w,h)) console.log((k.role||'')+' '+(k.kids?k.kids.map(q=>q.id||q.role).join('+'):(k.id||'')),[x,y,wd,ht].map(v=>Math.round(v)).join(','));}
