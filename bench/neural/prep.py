# Prepare low-res inputs: crop -> downscale by s (Lanczos) -> raw RGB for the node runner.
import json,sys,glob,os
from PIL import Image
OUT=sys.argv[1]; CROPS=sys.argv[2]
man=[]
extra=[]
hero=Image.open(f'{CROPS}/yachin_ph_hero.png'); hero.crop((150,0,430,200)).save(f'{CROPS}/yachin_products_280x200.png')
for f in sorted(glob.glob(f'{CROPS}/*.png')):
    n=os.path.basename(f)[:-4]
    if n in('yachin_ph_hero','tzfat_p1_photo','tzfat_p2_photo','tzfat_p3_photo'):continue
    im=Image.open(f).convert('RGB')
    for s in (1.5,2.0):
        lw,lh=round(im.width/s),round(im.height/s)
        lo=im.resize((lw,lh),Image.LANCZOS)
        key=f'{n}__{s}'
        open(f'{OUT}/{key}.raw','wb').write(lo.tobytes())
        lo.save(f'{OUT}/{key}_lo.png')
        man.append(dict(key=key,w=lw,h=lh,name=n,s=s,ow=im.width,oh=im.height))
json.dump(man,open(f'{OUT}/manifest.json','w'))
print(len(man))
