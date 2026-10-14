import sys,glob,os
from PIL import Image
for f in glob.glob(sys.argv[1]+'/engine_*.rgba'):
    s=f.split('engine_')[1][:-5];w,h=map(int,s.split('x'))
    Image.frombytes('RGBA',(w,h),open(f,'rb').read()).convert('RGB').save(f[:-5]+'.png');os.remove(f)
