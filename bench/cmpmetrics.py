import json,sys
S=sys.argv[1]; names=sys.argv[2:]
ds=[{r['name']:r for r in json.load(open(f'{S}/{n}/metrics.json'))} for n in names]
print('%-26s'%'fixture', *['%-34s'%n for n in names])
tot=[[0,0,0,0,0] for _ in names]
for k in ds[0]:
    row=[]
    for i,d in enumerate(ds):
        r=d.get(k); s=r['sum']; row.append('%5dms n%-2d tex %.2f flat %3d%% seam %.2f'%(r['ms'],s['n'],s['tex'],s['flat'],s['seam']))
        if s['n']: tot[i][0]+=s['tex']; tot[i][1]+=s['flat']; tot[i][2]+=s['seam']; tot[i][3]+=1
        tot[i][4]+=r['ms']
    print('%-26s'%k[:26], *['%-34s'%x for x in row])
print('MEAN over fixtures with textured holes:')
for n,t in zip(names,tot): print(n,'tex %.2f flat %.0f%% seam %.2f  (n=%d) total build %.1fs'%(t[0]/t[3],t[1]/t[3],t[2]/t[3],t[3],t[4]/1000))
