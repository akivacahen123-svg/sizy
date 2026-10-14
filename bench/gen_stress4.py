import os, json, random
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
OUT='/tmp/ag/b4/fx'
FP='/usr/share/fonts/truetype/'
F=dict(bold=FP+'freefont/FreeSansBold.ttf',reg=FP+'freefont/FreeSans.ttf',
 black='/usr/share/fonts/opentype/inter/Inter-Black.otf' if os.path.exists('/usr/share/fonts/opentype/inter/Inter-Black.otf') else '/usr/share/fonts/opentype/inter/Inter-ExtraBold.otf',
 thin='/usr/share/fonts/opentype/inter/Inter-Thin.otf',
 script=FP+'google-fonts/Lora-Italic-Variable.ttf', pbold=FP+'google-fonts/Poppins-Bold.ttf', plight=FP+'google-fonts/Poppins-Light.ttf',
 serifi=FP+'freefont/FreeSerifBoldItalic.ttf')
def ft(k,s): return ImageFont.truetype(F[k],int(s))
def lin(W,H,c1,c2,vert=True,c3=None):
    t=np.linspace(0,1,H if vert else W)
    c1,c2=np.array(c1,float),np.array(c2,float)
    if c3 is None: ramp=c1[None]*(1-t[:,None])+c2[None]*t[:,None]
    else:
        c3=np.array(c3,float); ramp=np.where(t[:,None]<.5,c1*(1-2*t[:,None])+c2*2*t[:,None],c2*(2-2*t[:,None])+c3*(2*t[:,None]-1))
    a=np.repeat(ramp[:,None,:],W,1) if vert else np.repeat(ramp[None],H,0)
    return Image.fromarray(a.astype('uint8')).convert('RGBA')
def photo(W,H,seed):
    r=random.Random(seed); im=lin(W,H,[r.randint(150,255) for _ in range(3)],[r.randint(150,255) for _ in range(3)],False); d=ImageDraw.Draw(im)
    for _ in range(40):
        x,y=r.randint(0,W),r.randint(0,H); rr=r.randint(20,120); c=tuple(r.randint(130,255) for _ in range(3)); d.ellipse([x-rr,y-rr,x+rr,y+rr],fill=c)
    return im.filter(ImageFilter.GaussianBlur(6))
def nb(b,W,H,p=0): return [max(0,(b[0]-p)/W*1000),max(0,(b[1]-p)/H*1000),min(1000,(b[2]+p)/W*1000),min(1000,(b[3]+p)/H*1000)]
def layer(im): return Image.new('RGBA',im.size,(0,0,0,0))
def text(im,cx,y,s,f,fill=(255,255,255),stroke=0,sc=None,shadow=None,glow=None,gradfill=None,anchor='c'):
    """draw centered text; returns ink bbox incl effects"""
    d0=ImageDraw.Draw(im); w=d0.textlength(s,font=f); x=cx-w/2
    bb=d0.textbbox((x,y),s,font=f,stroke_width=stroke)
    ex=0
    if glow: gc,gr=glow; L=layer(im); ImageDraw.Draw(L).text((x,y),s,font=f,fill=gc+(255,),stroke_width=stroke+2); L=L.filter(ImageFilter.GaussianBlur(gr)); im.alpha_composite(L); ex=max(ex,gr*1.5)
    if shadow: (dx,dy),sr,scol=shadow; L=layer(im); ImageDraw.Draw(L).text((x+dx,y+dy),s,font=f,fill=scol,stroke_width=stroke); L=L.filter(ImageFilter.GaussianBlur(sr)); im.alpha_composite(L)
    if gradfill:
        mask=Image.new('L',im.size,0); ImageDraw.Draw(mask).text((x,y),s,font=f,fill=255,stroke_width=stroke)
        g=gradfill(im.size,bb); L=Image.composite(g,layer(im),mask); 
        if stroke and sc: L2=layer(im); ImageDraw.Draw(L2).text((x,y),s,font=f,fill=sc+(255,),stroke_width=stroke); L2.alpha_composite(Image.composite(g,layer(im),Image.new('L',im.size,0)));
        im.alpha_composite(L)
    else:
        ImageDraw.Draw(im).text((x,y),s,font=f,fill=fill if len(fill)==4 else fill+(255,),stroke_width=stroke,stroke_fill=(sc or fill)+(255,) if stroke else None)
    b=[bb[0]-ex,bb[1]-ex,bb[2]+ex,bb[3]+ex]
    if shadow: b=[b[0],b[1],max(b[2],bb[2]+shadow[0][0]+shadow[1]*2),max(b[3],bb[3]+shadow[0][1]+shadow[1]*2)]
    return b
def union(bs): return [min(b[0] for b in bs),min(b[1] for b in bs),max(b[2] for b in bs),max(b[3] for b in bs)]
def vgrad_fn(c1,c2):
    def g(size,bb):
        W,H=size; t=np.clip((np.arange(H)-bb[1])/max(1,bb[3]-bb[1]),0,1)[:,None]
        a=np.array(c1)[None]*(1-t)+np.array(c2)[None]*t; a=np.repeat(a[:,None,:],W,1)
        return Image.fromarray(a.astype('uint8')).convert('RGBA')
    return g
def hgrad_fn(c1,c2):
    def g(size,bb):
        W,H=size; t=np.clip((np.arange(W)-bb[0])/max(1,bb[2]-bb[0]),0,1)[:,None]
        a=np.array(c1)[None]*(1-t)+np.array(c2)[None]*t; a=np.repeat(a[None],H,0)
        return Image.fromarray(a.astype('uint8')).convert('RGBA')
    return g
class S:
    def __init__(s,name,W,H,bg): s.name,s.W,s.H,s.im,s.els=name,W,H,bg.convert('RGBA'),[]
    def add(s,**k): s.els.append(k)
    def head(s,b,lines,role='headline',id=None,p=3,group='gh'):
        s.add(id=id or role,role=role,box=nb(b,s.W,s.H,p),lines=lines,group=group)
    def button(s,cx,cy,w,h,txt,style,fill=None,outline=None,tcol=(255,255,255),font='bold',grad=None,shape='pill',lw=4):
        L=layer(s.im); d=ImageDraw.Draw(L); r=h/2 if shape=='pill' else h*.2
        bx=[cx-w/2,cy-h/2,cx+w/2,cy+h/2]
        if grad:
            g=vgrad_fn(*grad)(s.im.size,bx); m=Image.new('L',s.im.size,0); ImageDraw.Draw(m).rounded_rectangle(bx,radius=r,fill=255); L=Image.composite(g,L,m)
        elif fill: d.rounded_rectangle(bx,radius=r,fill=fill)
        if outline: ImageDraw.Draw(L).rounded_rectangle(bx,radius=r,outline=outline,width=lw)
        s.im.alpha_composite(L)
        f=ft(font,h*.4); tb=text(s.im,cx,cy-h*.27,txt,f,tcol)
        s.add(id='btn',role='button',shape=shape,style=style,box=nb(bx,s.W,s.H,1),group=None)
        s.add(id='btnl',role='label',box=nb(tb,s.W,s.H,2),lines=[txt],group='gb')
    def logo(s,x,y,d,col=(255,255,255)):
        dr=ImageDraw.Draw(s.im); dr.ellipse([x,y,x+d,y+d],fill=col+(255,)); dr.ellipse([x+d*.25,y+d*.25,x+d*.75,y+d*.75],fill=(30,30,60,255))
        s.add(id='logo',role='logo',shape='circle',box=nb([x,y,x+d,y+d],s.W,s.H,1),group=None)
    def save(s):
        s.im.convert('RGB').save(f'{OUT}/{s.name}.png'); open(f'{OUT}/{s.name}.rgba','wb').write(s.im.tobytes())
        json.dump({'w':s.W,'h':s.H,'elements':s.els},open(f'{OUT}/{s.name}.json','w'),ensure_ascii=False)
    def hero(s,x,y,w,h,seed=1):
        p=photo(w,h,seed); m=Image.new('L',(w,h),0); ImageDraw.Draw(m).rounded_rectangle([0,0,w-1,h-1],radius=24,fill=255); s.im.paste(p,(x,y),m)
        s.add(id='hero',role='hero',shape='hero',box=nb([x,y,x+w,y+h],s.W,s.H),group=None)
    def plate(s,b,col):
        L=layer(s.im); ImageDraw.Draw(L).rounded_rectangle(b,radius=18,fill=col); s.im.alpha_composite(L)

# 1 two-tone headline gradient text on dark
def f1():
    W,H=1200,420; s=S('c1_twotone_grad',W,H,lin(W,H,(20,20,50),(60,20,90),False))
    s.hero(40,40,360,340,3); f=ft('black',92)
    b1=text(s.im,800,40,'MEGA SALE',f,gradfill=vgrad_fn((255,230,60),(255,80,40)))
    b2=text(s.im,800,150,'ALL WEEK LONG',ft('black',62),gradfill=hgrad_fn((60,230,255),(255,90,220)))
    s.head(union([b1,b2]),['MEGA SALE','ALL WEEK LONG'])
    b=text(s.im,800,250,'Up to 70% off everything',ft('reg',34),(230,230,255)); s.head(b,['Up to 70% off everything'],'subheadline')
    s.button(800,345,250,62,'SHOP NOW','filled',fill=(255,200,40),tcol=(20,20,30)); s.logo(1090,16,80); s.save()
# 2 text similar to bg
def f2():
    W,H=800,600; s=S('c2_tonal_text',W,H,lin(W,H,(190,60,70),(170,45,60)))
    b1=text(s.im,400,70,'Warm tones',ft('pbold',96),(215,95,100)); b2=text(s.im,400,190,'low contrast',ft('pbold',96),(210,85,95))
    s.head(union([b1,b2]),['Warm tones','low contrast'])
    b=text(s.im,400,330,'subtle copy on same hue',ft('reg',44),(205,100,108)); s.head(b,['subtle copy on same hue'],'subheadline')
    s.button(400,480,300,76,'LEARN MORE','filled',fill=(185,55,68),tcol=(225,110,118)); s.logo(360,400-0,0) if False else None; s.save()
# 3 dark text on light photo
def f3():
    W,H=1000,560; im=photo(W,H,7); s=S('c3_dark_on_photo',W,H,im)
    b1=text(s.im,500,50,'Fresh Summer Picks',ft('bold',92),(25,25,40)); s.head(b1,['Fresh Summer Picks'])
    b=text(s.im,500,175,'handmade, local, seasonal',ft('reg',44),(40,40,60)); s.head(b,['handmade, local, seasonal'],'subheadline')
    s.hero(300,260,400,170,5)
    s.button(500,500,300,66,'ORDER','filled',fill=(25,25,40),tcol=(255,255,255)); s.logo(24,24,70,(30,30,60)); s.save()
# 4 white text thick colored outline
def f4():
    W,H=900,600; s=S('c4_thick_outline',W,H,lin(W,H,(255,200,50),(80,200,120),True))
    f=ft('black',120)
    b1=text(s.im,450,40,'BIG',f,(255,255,255),stroke=14,sc=(220,30,80)); b2=text(s.im,450,170,'DEALS',f,(255,255,255),stroke=14,sc=(220,30,80))
    s.head(union([b1,b2]),['BIG','DEALS'],p=2)
    b=text(s.im,450,340,'ends Sunday',ft('bold',54),(255,255,255),stroke=6,sc=(20,90,160)); s.head(b,['ends Sunday'],'subheadline')
    s.button(450,500,300,80,'GO','filled',fill=(220,30,80),tcol=(255,255,255)); s.logo(30,500,80); s.save()
# 5 shadow / glow
def f5():
    W,H=1200,500; s=S('c5_shadow_glow',W,H,lin(W,H,(15,10,40),(10,40,70),False))
    b1=text(s.im,600,50,'NEON NIGHTS',ft('black',120),(255,255,255),glow=((255,0,200),14)); b2=text(s.im,600,200,'live music downtown',ft('bold',58),(255,255,255),shadow=((6,6),4,(0,0,0,220)))
    s.head(b1,['NEON NIGHTS']); s.head(b2,['live music downtown'],'subheadline')
    b3=text(s.im,600,300,'Fri 9PM',ft('bold',50),(255,240,120),glow=((255,140,0),9)); s.head(b3,['Fri 9PM'],'body',id='when')
    s.button(600,430,280,70,'TICKETS','filled',fill=(255,0,200),tcol=(255,255,255)); s.logo(1090,24,80); s.save()
# 6 gradient crossing text color
def f6():
    W,H=800,800; s=S('c6_cross_grad',W,H,lin(W,H,(0,0,0),(255,255,255),True))
    b1=text(s.im,400,100,'Half',ft('black',150),(128,128,128)); b2=text(s.im,400,300,'Way There',ft('black',110),(128,128,128)); b3=text(s.im,400,520,'mid gray text',ft('bold',60),(128,128,128))
    s.head(union([b1,b2]),['Half','Way There']); s.head(b3,['mid gray text'],'subheadline')
    s.button(400,700,300,80,'CLICK','filled',fill=(128,128,128),tcol=(128,128,128)) ; s.save()
# 7 outline buttons
def f7():
    W,H=1000,500; s=S('c7_outline_btns',W,H,lin(W,H,(30,60,120),(20,30,70),True))
    b=text(s.im,500,50,'Choose your plan',ft('bold',84),(255,255,255)); s.head(b,['Choose your plan'])
    b=text(s.im,500,160,'cancel anytime',ft('reg',40),(210,225,255)); s.head(b,['cancel anytime'],'subheadline')
    s.button(280,320,340,80,'Monthly','outline',outline=(255,255,255),tcol=(255,255,255),lw=4)
    s.button(720,320,340,80,'Yearly','outline',outline=(255,210,60),tcol=(255,210,60),lw=3,shape='rounded')
    s.button(500,440,300,64,'Compare','outline',outline=(120,230,255),tcol=(120,230,255),lw=2); s.save()
# 8 gradient buttons
def f8():
    W,H=900,600; s=S('c8_grad_btns',W,H,lin(W,H,(250,250,245),(235,235,250),True))
    b=text(s.im,450,50,'Join today',ft('pbold',96),(40,30,90)); s.head(b,['Join today'])
    b=text(s.im,450,190,'free for 30 days',ft('plight',46),(90,80,130)); s.head(b,['free for 30 days'],'subheadline')
    s.button(450,330,420,100,'GET STARTED','filled',grad=((255,90,150),(120,60,255)),tcol=(255,255,255),font='pbold')
    s.button(450,470,360,84,'Learn more','filled',grad=((255,240,150),(255,170,40)),tcol=(60,40,0),font='pbold',shape='rounded'); s.logo(40,500,70,(40,30,90)); s.save()
# 9 semi-transparent plates
def f9():
    W,H=1000,560; s=S('c9_plate_text',W,H,photo(W,H,11)); s.im=s.im.convert('RGBA')
    s.plate([80,50,920,260],(0,0,0,150)); b1=text(s.im,500,70,'Weekend Escape',ft('bold',90),(255,255,255)); b2=text(s.im,500,175,'from only $199',ft('reg',48),(255,235,150))
    s.head(b1,['Weekend Escape']); s.head(b2,['from only $199'],'subheadline')
    s.plate([250,300,750,400],(255,255,255,110)); b3=text(s.im,500,322,'Book before Friday',ft('bold',50),(20,20,50)); s.head(b3,['Book before Friday'],'body',id='note')
    s.button(500,490,300,70,'BOOK NOW','filled',fill=(240,60,60),tcol=(255,255,255)); s.logo(30,440,80); s.save()
# 10 thin script + ultra bold
def f10():
    W,H=1200,500; s=S('c10_thin_vs_black',W,H,lin(W,H,(240,225,200),(200,170,140),False))
    b1=text(s.im,600,30,'Elegance',ft('script',120),(60,35,20)); 
    b2=text(s.im,600,190,'collection',ft('thin',70),(60,35,20))
    b3=text(s.im,600,290,'NEW DROP',ft('black',110),(40,20,10))
    s.head(union([b1,b2]),['Elegance','collection']); s.head(b3,['NEW DROP'],'subheadline')
    s.button(600,445,280,64,'DISCOVER','outline',outline=(60,35,20),tcol=(60,35,20),font='thin',lw=2); s.logo(1090,20,80,(60,35,20)); s.save()
for f in [f1,f2,f3,f4,f5,f6,f7,f8,f9,f10]: f()
print('ok')
