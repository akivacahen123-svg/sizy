import fs from 'fs';
const R='/home/claude/sizy-cf/';
await import(R+'public/bgmap.js'); await import(R+'public/engine.js');
const E=globalThis.SizyEngine, D=R+'bench/exemplars/hora/';
const inp=JSON.parse(fs.readFileSync(D+'fx.json')), buf=fs.readFileSync(D+'fx.rgba');
const img=E.fromRGBA(new Uint8ClampedArray(buf.buffer,buf.byteOffset,buf.length),inp.w,inp.h);
const sc=E.buildScene(img,inp.elements,()=>{});
console.log(sc.units.map((u,i)=>i+':'+u.role+' '+(u.kids.map(k=>k.role+(k.id||'')).join('+'))+` ${Math.round(u.x)},${Math.round(u.y)} ${Math.round(u.w)}x${Math.round(u.h)}`).join('\n'));
for(const [w,h] of [[290,350],[320,70],[360,125],[1200,200],[728,90],[160,600],[300,250],[120,500],[1200,60],[300,600]]){
 const p=E.autoplace(sc,w,h);
 console.log(`\n${w}x${h} kept ${p.length}`);
 for(const [k,x,y,ww,hh] of p) console.log(' ',(k.role||'?'),(k.lines||[]).join('|').slice(0,22),[x,y,ww,hh].map(v=>Math.round(v)).join(','),k.text?('perLineH='+(hh/Math.max(1,(k.lines||[1]).length)).toFixed(1)):'');
}
