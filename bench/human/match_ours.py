import cv2, json, glob, os, numpy as np
D='/home/claude/sizy-cf/bench/exemplars/dreams/'
o=cv2.imread(D+'orig_800x600.jpg'); H0,W0=o.shape[:2]
fx=json.load(open(D+'fx.json'))['elements']; E={e['id']:e['box'] for e in fx}
def crop(b): return o[int(b[1]*H0/1000):int(b[3]*H0/1000), int(b[0]*W0/1000):int(b[2]*W0/1000)]
# headline panel = union h1,h2,h3 expanded slightly (panel is larger than text)
def union(ids,pad=0):
    bs=[E[i] for i in ids]; return [min(b[0] for b in bs)-pad,min(b[1] for b in bs)-pad,max(b[2] for b in bs)+pad,max(b[3] for b in bs)+pad]
T={'logo':E['lg'],'man':E['man'],'headline':union(['h1','h2','h3']),'button':E['btn'],'winner':E['win'],'cash':union(['cash','money']),'bonus':E['bonus'],'fine':E['fine'],'prize':union(['cash','money','bonus'])}
res={}
for f in sorted(glob.glob("/tmp/sc/an/ours/*.png"),key=lambda p:int(os.path.basename(p).split('x')[1].split('.')[0])*10000+int(os.path.basename(p).split('x')[0])):
    nm=os.path.basename(f)[:-4]; im=cv2.imread(f); H,W=im.shape[:2]; g=cv2.cvtColor(im,cv2.COLOR_BGR2GRAY); r={}
    for k,b in T.items():
        t=cv2.cvtColor(crop(b),cv2.COLOR_BGR2GRAY); best=(-1,None)
        for s in np.concatenate([np.arange(0.12,1.0,0.03),np.arange(1.0,2.2,0.06)]):
            for sy in [s]:
                tw,th=int(t.shape[1]*s),int(t.shape[0]*s)
                if tw<10 or th<6 or tw>=W or th>=H: continue
                tt=cv2.resize(t,(tw,th),interpolation=cv2.INTER_AREA)
                m=cv2.matchTemplate(g,tt,cv2.TM_CCOEFF_NORMED); _,mx,_,loc=cv2.minMaxLoc(m)
                if mx>best[0]: best=(mx,(loc[0],loc[1],tw,th,s))
        sc,bx=best; 
        if bx and sc>0.5: r[k]={'x':round(bx[0]/W,3),'y':round(bx[1]/H,3),'w':round(bx[2]/W,3),'h':round(bx[3]/H,3),'sc':round(sc,2),'scale':round(bx[4],2)}
    res[nm]=r; print(nm,{k:(v['x'],v['y'],v['w'],v['h'],v['sc']) for k,v in r.items()})
json.dump(res,open('/tmp/sc/an/ours.json','w'),indent=1)
