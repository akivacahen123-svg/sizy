import os, json, random, math, numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
FB='/usr/share/fonts/truetype/freefont/FreeSansBold.ttf'; FR='/usr/share/fonts/truetype/freefont/FreeSans.ttf'
OUT='/tmp/ag/b1/fx'
def F(p,s): return ImageFont.truetype(p,max(6,int(s)))
def noise(W,H,seed,amp=25,blur=0.0):
    rs=np.random.RandomState(seed); n=rs.randn(H,W,1)*amp; return n
def sky_mount(W,H,seed,hi=False):
    rs=np.random.RandomState(seed); y=np.linspace(0,1,H)[:,None,None]
    top=np.array([40,90,170]);bot=np.array([250,190,120]); a=top*(1-y)+bot*y; a=np.repeat(a,W,1)
    xs=np.arange(W)
    for k,(base,col) in enumerate([(.55,(110,120,150)),(.68,(70,85,95)),(.82,(25,40,35))]):
        h=sum(rs.rand()*np.sin(xs/W*rs.randint(3,14)*math.pi+rs.rand()*6)*(.07/(j+1)) for j in range(4))+base
        ridge=(h*H).astype(int); yy=np.arange(H)[:,None]; m=(yy>=ridge[None,:])[:,:,None]
        a=np.where(m,np.array(col)+rs.randn(H,W,1)*12,a)
    a=a+rs.randn(H,W,1)*10
    return Image.fromarray(np.clip(a,0,255).astype('uint8'))
def bokeh(W,H,seed,dark=True):
    rs=random.Random(seed); im=Image.new('RGB',(W,H),(20,25,45) if dark else (230,220,200)); 
    lay=Image.new('RGBA',(W,H),(0,0,0,0)); d=ImageDraw.Draw(lay)
    for _ in range(90):
        r=rs.randint(int(H*.04),int(H*.22)); x,y=rs.randint(0,W),rs.randint(0,H)
        c=rs.choice([(255,200,80),(255,100,150),(80,200,255),(255,255,255),(150,255,150)]); d.ellipse([x-r,y-r,x+r,y+r],fill=c+(rs.randint(60,170),),outline=c+(220,),width=2)
    im=Image.alpha_composite(im.convert('RGBA'),lay.filter(ImageFilter.GaussianBlur(1.5))).convert('RGB')
    a=np.array(im).astype(float)+np.random.RandomState(seed).randn(H,W,1)*12; return Image.fromarray(np.clip(a,0,255).astype('uint8'))
def wood(W,H,seed):
    rs=np.random.RandomState(seed); y=np.arange(H)[:,None]; x=np.arange(W)[None,:]
    v=np.sin((y+8*np.sin(x/40.+rs.rand()*5))/ (H/40.)*2)*0.5+0.5; v=v+rs.randn(H,W)*.12
    base=np.array([150,95,50]); a=base*(0.5+v[:,:,None]*0.8)
    return Image.fromarray(np.clip(a,0,255).astype('uint8'))
def stone(W,H,seed):
    rs=np.random.RandomState(seed); g=rs.rand(H//8+2,W//8+2); im=Image.fromarray((g*255).astype('uint8')).resize((W,H),Image.BICUBIC)
    g2=Image.fromarray((rs.rand(H//3+2,W//3+2)*255).astype('uint8')).resize((W,H),Image.BICUBIC)
    a=np.array(im).astype(float)*.6+np.array(g2).astype(float)*.4; a=60+a*.7+rs.randn(H,W)*14
    return Image.fromarray(np.clip(np.stack([a,a*.97,a*.92],-1),0,255).astype('uint8'))
def stripes(W,H,c1,c2,wd=18):
    y,x=np.mgrid[0:H,0:W]; m=(((x+y)//wd)%2)[:,:,None]; a=np.where(m,np.array(c1),np.array(c2)); return Image.fromarray(a.astype('uint8'))
def vignette(im,p=2.2,s=.95):
    W,H=im.size; y,x=np.mgrid[0:H,0:W]; r=np.sqrt(((x-W/2)/(W/2))**2+((y-H/2)/(H/2))**2)/1.41; v=np.clip(1-s*r**p*2,0.05,1)[:,:,None]
    return Image.fromarray(np.clip(np.array(im)*v,0,255).astype('uint8'))
def checker(W,H,seed):
    rs=np.random.RandomState(seed); g=rs.rand(H//14+1,W//14+1)>.5; a=np.kron(g,np.ones((14,14)))[:H,:W]
    c=np.where(a[:,:,None]>0,np.array([240,60,60]),np.array([30,30,160]))+rs.randn(H,W,1)*20; return Image.fromarray(np.clip(c,0,255).astype('uint8'))
def blobs(d,seed):
    r=random.Random(seed); im=Image.new('RGB',(d,d),tuple(r.randint(30,230) for _ in range(3))); dr=ImageDraw.Draw(im)
    for _ in range(12):
        x,y=r.randint(0,d),r.randint(0,d); rr=r.randint(d//8,d//3); dr.ellipse([x-rr,y-rr,x+rr,y+rr],fill=tuple(r.randint(20,240) for _ in range(3)))
    return im.filter(ImageFilter.GaussianBlur(1.2))
def nb(b,W,H,pad=3): return [max(0,(b[0]-pad)/W*1000),max(0,(b[1]-pad)/H*1000),min(1000,(b[2]+pad)/W*1000),min(1000,(b[3]+pad)/H*1000)]
class C:
    def __init__(s,name,bg,fg=(255,255,255),style='plain'):
        s.name=name;s.bg=bg.convert('RGB');s.W,s.H=s.bg.size;s.d=ImageDraw.Draw(s.bg);s.fg=fg;s.style=style;s.els=[]
    def text(s,cx,y,txt,font,fill=None,style=None):
        fill=fill or s.fg; style=style or s.style; w=s.d.textlength(txt,font=font)
        x=cx-w/2
        if style=='shadow': s.d.text((x+3,y+3),txt,font=font,fill=(0,0,0))
        if style=='outline': s.d.text((x,y),txt,font=font,fill=fill,stroke_width=max(2,int(font.size/14)),stroke_fill=(10,10,10))
        else: s.d.text((x,y),txt,font=font,fill=fill)
        b=s.d.textbbox((x,y),txt,font=font,stroke_width=(max(2,int(font.size/14)) if style=='outline' else 0)); return list(b)
    def block(s,id,role,cx,y,lines,size,fontp=FB,fill=None,style=None,lh=1.18,group='gh'):
        f=F(fontp,size); bs=[];yy=y
        for ln in lines: bs.append(s.text(cx,yy,ln,f,fill,style)); yy+=size*lh
        b=[min(q[0] for q in bs),min(q[1] for q in bs),max(q[2] for q in bs),max(q[3] for q in bs)]
        s.els.append(dict(id=id,role=role,box=nb(b,s.W,s.H),lines=lines,group=group)); return yy
    def button(s,cx,cy,w,h,txt,col=(255,190,30)):
        s.d.rounded_rectangle([cx-w/2,cy-h/2,cx+w/2,cy+h/2],radius=h/2,fill=col); f=F(FB,h*.42); tw=s.d.textlength(txt,font=f)
        s.d.text((cx-tw/2,cy-h*.3),txt,font=f,fill=(20,20,30))
        s.els.append(dict(id='btn',role='button',shape='pill',style='filled',box=nb([cx-w/2,cy-h/2,cx+w/2,cy+h/2],s.W,s.H,1),group=None))
        s.els.append(dict(id='btnl',role='label',box=nb([cx-tw/2,cy-h*.3,cx+tw/2,cy+h*.22],s.W,s.H,2),lines=[txt],group='gb'))
    def logo(s,x,y,d,seed=5):
        im=blobs(d,seed); m=Image.new('L',(d*4,d*4),0); ImageDraw.Draw(m).ellipse([0,0,d*4-1,d*4-1],fill=255); m=m.resize((d,d),Image.LANCZOS); s.bg.paste(im,(x,y),m)
        s.d.ellipse([x,y,x+d,y+d],outline=(255,255,255),width=max(2,d//25)); s.els.append(dict(id='logo',role='logo',shape='circle',box=nb([x,y,x+d,y+d],s.W,s.H,1),group=None))
    def photos(s,n,cy,d,gap,cap=None):
        x=(s.W-(n*d+(n-1)*gap))/2
        for i in range(n):
            im=blobs(d,40+i); m=Image.new('L',(d*4,d*4),0); ImageDraw.Draw(m).ellipse([0,0,d*4-1,d*4-1],fill=255); m=m.resize((d,d),Image.LANCZOS); s.bg.paste(im,(int(x),int(cy)),m)
            s.els.append(dict(id=f'p{i}',role='photo',shape='circle',box=nb([x,cy,x+d,cy+d],s.W,s.H,1),group='gp'))
            if cap: 
                f=F(FB,d*.17);b=s.text(x+d/2,cy+d*1.08,cap[i%len(cap)],f); s.els.append(dict(id=f'c{i}',role='caption',box=nb(b,s.W,s.H,2),lines=[cap[i%len(cap)]],group='gp'))
            x+=d+gap
    def save(s):
        s.bg.save(f'{OUT}/{s.name}.png'); open(f'{OUT}/{s.name}.rgba','wb').write(s.bg.convert('RGBA').tobytes()); json.dump(dict(w=s.W,h=s.H,elements=s.els),open(f'{OUT}/{s.name}.json','w'),ensure_ascii=False)
H1='מבצע הקיץ הגדול'; H2='הנחה על כל האתר'; H3='קולקציה חדשה הגיעה'
# 1 landscape 1200x500 white + shadow
c=C('f01_landscape_1200x500',sky_mount(1200,500,1),style='shadow'); y=c.block('h','headline',420,70,['מבצע הקיץ','הגדול של השנה'],84); c.block('sub','subheadline',420,y+10,['רק השבוע בלבד'],40,FR); c.button(420,400,280,70,'לרכישה'); c.logo(1070,24,90); c.save()
# 2 bokeh 970x250 no outline
c=C('f02_bokeh_970x250',bokeh(970,250,2)); y=c.block('h','headline',400,35,[H1],62); c.block('sub','subheadline',400,y+8,['לזמן מוגבל מאוד'],32,FR); c.button(820,125,230,64,'לחצו כאן'); c.logo(24,70,110); c.save()
# 3 wood 600x600 outline
c=C('f03_wood_600x600',wood(600,600,3),style='outline'); y=c.block('h','headline',300,70,['הנחה על','כל האתר'],96); c.block('sub','subheadline',300,y+16,['הרשמה בקישור'],44,FR); c.button(300,500,300,76,'הרשמה עכשיו'); c.save()
# 4 stone 300x600 no outline, light text
c=C('f04_stone_300x600',stone(300,600,4)); c.logo(100,30,100); y=c.block('h','headline',150,170,['חג שמח','לכולם'],62); c.block('sub','subheadline',150,y+14,['מחכים לכם','בצפת'],30,FR,lh=1.25); c.button(150,500,220,64,'להזמנות'); c.save()
# 5 stripes 728x90 high-contrast
c=C('f05_stripes_728x90',stripes(728,90,(230,230,40),(20,20,20),16),style='outline'); c.block('h','headline',260,18,[H3],54,group='gh'); c.button(640,45,190,56,'לרכישה',(240,60,60)); c.logo(12,10,70); c.save()
# 6 vignette 1200x500 w/ photo-ish
c=C('f06_vignette_1200x500',vignette(sky_mount(1200,500,6)),style='shadow'); y=c.block('h','headline',600,110,['ערב מיוחד','לכל המשפחה'],90); c.block('sub','subheadline',600,y+8,['הרשמה בקישור'],40,FR); c.button(600,430,280,66,'הרשמה עכשיו'); c.logo(40,30,90); c.save()
# 7 checker busy 600x600 outline 2 photos+captions
c=C('f07_checker_600x600',checker(600,600,7),style='outline'); y=c.block('h','headline',300,30,[H2],58); c.photos(2,y+30,170,50,['סיור היסטורי','קומזיץ ליל שישי']); c.button(300,540,280,70,'לחצו כאן',(255,255,255)); c.save()
# 8 tall landscape 300x600 shadow
c=C('f08_tallscape_300x600',sky_mount(300,600,8),style='shadow'); c.logo(110,24,80); y=c.block('h','headline',150,130,['שבת','בראשית','בצפת'],56); c.block('sub','subheadline',150,y+10,['מעין עולם הבא'],28,FR); c.button(150,520,230,64,'לרכישה'); c.save()
# 9 light busy bg, dark text, 970x250 (no outline)
bgm=stripes(970,250,(235,225,200),(250,245,230),22).filter(ImageFilter.GaussianBlur(1)); a=np.array(bgm).astype(float)+np.random.RandomState(9).randn(250,970,1)*28
c=C('f09_lightnoise_970x250',Image.fromarray(np.clip(a,0,255).astype('uint8')),fg=(30,30,50)); y=c.block('h','headline',560,30,['משלוח חינם מעל 199'],64); c.block('sub','subheadline',560,y+6,['רק השבוע בלבד'],34,FR); c.button(180,125,230,66,'לרכישה'); c.logo(840,70,110); c.save()
# 10 bokeh 1200x500 many elements
c=C('f10_bokehmany_1200x500',bokeh(1200,500,10),style='shadow'); y=c.block('h','headline',600,24,[H3],70); c.photos(3,y+20,150,60,['סיור בצפת','בעל המנגן','המרצה']); c.button(1010,420,260,66,'להזמנות'); c.logo(40,24,90); c.block('sub','subheadline',210,300,['מחכים','לכם'],36,FR,lh=1.2,group='gs'); c.save()
