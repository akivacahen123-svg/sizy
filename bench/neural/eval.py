# Compare model upscales vs Lanczos/bicubic against the original crop. usage: eval.py workdir cropsdir outdir
import json,sys,numpy as np
from PIL import Image
from skimage.metrics import structural_similarity as ssim, peak_signal_noise_ratio as psnr
from scipy.ndimage import laplace
WD,CR,OUT=sys.argv[1:4]
man=json.load(open(f'{WD}/manifest.json')); models=['cunet','upconv7photo','swinart','resrx4v3','swinphoto4x']
def lapv(a): return float(np.mean([laplace(a[...,c].astype(float)).var() for c in range(3)]))
def gcorr(a,b):
    ga=np.hypot(*np.gradient(a.mean(2)));gb=np.hypot(*np.gradient(b.mean(2)))
    return float(np.corrcoef(ga.ravel(),gb.ravel())[0,1])
rows=[];agg={}
for it in man:
    orig=Image.open(f"{CR}/{it['name']}.png").convert('RGB');O=np.array(orig)
    lo=Image.open(f"{WD}/{it['key']}_lo.png").convert('RGB')
    outs={'lanczos':lo.resize(orig.size,Image.LANCZOS),'bicubic':lo.resize(orig.size,Image.BICUBIC)}
    for m in models:
        S=2 if m in('cunet','upconv7photo','swinart') else 4
        a=np.frombuffer(open(f"{WD}/{it['key']}.{m}.raw",'rb').read(),np.uint8).reshape(it['h']*S,it['w']*S,3)
        outs[m]=Image.fromarray(a).resize(orig.size,Image.LANCZOS)
    for k,im in outs.items():
        A=np.array(im);r=dict(img=it['name'],s=it['s'],m=k,psnr=psnr(O,A),ssim=ssim(O,A,channel_axis=2,data_range=255,win_size=min(7,min(O.shape[:2])//2*2-1)),sharp=lapv(A)/lapv(O),gc=gcorr(O,A))
        rows.append(r);agg.setdefault((it['s'],k),[]).append(r)
    # zoom sheet: orig | lanczos | cunet | resr | swinart  (nearest x4)
    cols=['orig','lanczos','cunet','upconv7photo','swinart','resrx4v3']
    Z=4 if orig.width<200 else 2
    tiles=[orig]+[outs[c] for c in cols[1:]]
    sh=Image.new('RGB',(sum(t.width*Z+6 for t in tiles),orig.height*Z),'white');x=0
    for t in tiles: sh.paste(t.resize((t.width*Z,t.height*Z),Image.NEAREST),(x,0));x+=t.width*Z+6
    sh.save(f"{OUT}/zoom_{it['name']}_{it['s']}.png")
print('| scale | method | PSNR dB | SSIM | sharpness x orig | edge corr |\n|---|---|---|---|---|---|')
for (s,k),L in sorted(agg.items()):
    print(f"| {s} | {k} | {np.mean([r['psnr'] for r in L]):.2f} | {np.mean([r['ssim'] for r in L]):.4f} | {np.mean([r['sharp'] for r in L]):.2f} | {np.mean([r['gc'] for r in L]):.3f} |")
json.dump(rows,open(f'{OUT}/metrics.json','w'),indent=1)
