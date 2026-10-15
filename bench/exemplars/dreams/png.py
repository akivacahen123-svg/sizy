import sys,os
from PIL import Image
D=os.path.dirname(os.path.abspath(__file__))+'/'
sizes=(sys.argv[1] if len(sys.argv)>1 else '300x600,728x90,300x250,160x600,1200x300,320x320').split(',')
for s in sizes:
    w,h=map(int,s.split('x'));Image.frombytes('RGBA',(w,h),open(f'{D}out/{w}x{h}.rgba','rb').read()).convert('RGB').save(f'{D}out/{w}x{h}.png')
