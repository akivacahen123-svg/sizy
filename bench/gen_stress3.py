import sys, os, json, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter, features
FB='/usr/share/fonts/truetype/freefont/FreeSansBold.ttf'; FR='/usr/share/fonts/truetype/freefont/FreeSans.ttf'
def F(p,s): return ImageFont.truetype(p,int(s))
def nb(b,W,H,p=2): return [max(0,(b[0]-p)/W*1000),max(0,(b[1]-p)/H*1000),min(1000,(b[2]+p)/W*1000),min(1000,(b[3]+p)/H*1000)]
def grad(W,H,c1,c2,vert=True):
    import numpy as np
    t=np.linspace(0,1,H if vert else W); a=np.array(c1)[None]*(1-t[:,None])+np.array(c2)[None]*t[:,None]
    a=np.repeat(a[:,None,:],W,1) if vert else np.repeat(a[None],H,0)
    return Image.fromarray(a.astype('uint8'),'RGB')
def photo(W,H,seed,dark=False):
    r=random.Random(seed); im=grad(W,H,[r.randint(40,200) for _ in range(3)],[r.randint(40,230) for _ in range(3)],False); d=ImageDraw.Draw(im)
    for _ in range(40):
        x,y=r.randint(0,W),r.randint(0,H); rr=r.randint(min(W,H)//12,min(W,H)//3); d.ellipse([x-rr,y-rr,x+rr,y+rr],fill=tuple(r.randint(20,250) for _ in range(3)))
    return im.filter(ImageFilter.GaussianBlur(min(W,H)//60+2))
class B:
    def __init__(s,name,W,H,bg): s.name,s.W,s.H=name,W,H; s.im=bg.convert('RGB'); s.d=ImageDraw.Draw(s.im); s.els=[]
    def text(s,x,y,t,size,fill,bold=True,anchor='l',eid=None,role='headline',group=None,pad=2,lines=None,reg=True):
        f=F(FB if bold else FR,size); b=s.d.textbbox((0,0),t,font=f); w=b[2]-b[0]
        ox={'l':x,'c':x-w/2,'r':x-w}[anchor]; s.d.text((ox-b[0],y-b[1]),t,font=f,fill=fill); bb=[ox,y,ox+w,y+b[3]-b[1]]
        if reg: s.els.append(dict(id=eid or role+str(len(s.els)),role=role,box=nb(bb,s.W,s.H,pad),lines=lines or [t],group=group))
        return bb
    def block(s,x,y,lines,size,fill,anchor='l',role='headline',eid=None,group=None,lh=1.15,bold=True):
        bs=[];yy=y
        for l in lines: bs.append(s.text(x,yy,l,size,fill,bold,anchor,reg=False)); yy+=size*lh
        bb=[min(b[0] for b in bs),min(b[1] for b in bs),max(b[2] for b in bs),max(b[3] for b in bs)]
        s.els.append(dict(id=eid or role+str(len(s.els)),role=role,box=nb(bb,s.W,s.H,3),lines=list(lines),group=group)); return bb,yy
    def button(s,cx,cy,w,h,t,fill,tc,eid='btn'):
        s.d.rounded_rectangle([cx-w/2,cy-h/2,cx+w/2,cy+h/2],radius=h/2,fill=fill); f=F(FB,h*.4); b=s.d.textbbox((0,0),t,font=f); tw=b[2]-b[0]; th=b[3]-b[1]
        s.d.text((cx-tw/2-b[0],cy-th/2-b[1]),t,font=f,fill=tc)
        s.els.append(dict(id=eid,role='button',shape='pill',style='filled',box=nb([cx-w/2,cy-h/2,cx+w/2,cy+h/2],s.W,s.H,1),group=None))
        s.els.append(dict(id=eid+'l',role='label',box=nb([cx-tw/2,cy-th/2,cx+tw/2,cy+th/2],s.W,s.H,2),lines=[t],group='g'+eid))
    def logo(s,x,y,d,seed=3,eid='logo'):
        im=photo(d,d,seed); m=Image.new('L',(d*4,d*4),0); ImageDraw.Draw(m).ellipse([0,0,d*4-1,d*4-1],fill=255); m=m.resize((d,d),Image.LANCZOS); s.im.paste(im,(int(x),int(y)),m)
        s.d.ellipse([x,y,x+d,y+d],outline=(255,255,255),width=max(2,d//25)); s.els.append(dict(id=eid,role='logo',shape='circle',box=nb([x,y,x+d,y+d],s.W,s.H,1),group=None))
    def hero(s,x,y,w,h,kind='person',seed=5):
        r=random.Random(seed); im=Image.new('RGBA',(w,h),(0,0,0,0)); d=ImageDraw.Draw(im)
        if kind=='person':
            sk=(224,172,140); d.ellipse([w*.3,h*.02,w*.7,h*.30],fill=sk); d.rounded_rectangle([w*.12,h*.32,w*.88,h],radius=w*.15,fill=(40,70,150)); d.rectangle([w*.42,h*.26,w*.58,h*.36],fill=sk)
        else:
            d.rounded_rectangle([w*.2,h*.05,w*.8,h*.95],radius=w*.08,fill=(30,30,36)); d.rounded_rectangle([w*.25,h*.1,w*.75,h*.8],radius=w*.04,fill=(70,170,230)); d.ellipse([w*.4,h*.85,w*.6,h*.92],fill=(90,90,100))
        s.im.paste(im,(int(x),int(y)),im); s.els.append(dict(id='hero',role='hero',shape='hero',box=nb([x,y,x+w,y+h],s.W,s.H,0),group=None))
    def badge(s,cx,cy,r,t,fill,tc,eid='badge',size=None):
        s.d.ellipse([cx-r,cy-r,cx+r,cy+r],fill=fill); s.els.append(dict(id=eid,role='badge',shape='circle',box=nb([cx-r,cy-r,cx+r,cy+r],s.W,s.H,1),group=None))
        s.text(cx,cy-r*.3,t,size or r*.6,tc,True,'c',role='label',eid=eid+'t',group='g'+eid)
    def save(s,out):
        s.im.save(f'{out}/{s.name}.png'); open(f'{out}/{s.name}.rgba','wb').write(s.im.convert('RGBA').tobytes()); json.dump(dict(w=s.W,h=s.H,elements=s.els),open(f'{out}/{s.name}.json','w'),ensure_ascii=False)
WH=(255,255,255); DK=(20,20,30); GOLD=(255,200,40); RED=(230,50,70)
def scrim(b,x1,x2,a=170):
    ov=Image.new('RGBA',b.im.size,(0,0,0,0)); d=ImageDraw.Draw(ov)
    for x in range(int(x1),int(x2)): d.line([x,0,x,b.H],fill=(0,0,0,int(a*(1-(x-x1)/(x2-x1)))))
    b.im=Image.alpha_composite(b.im.convert('RGBA'),ov).convert('RGB'); b.d=ImageDraw.Draw(b.im)
def build(out):
    # 1 full-bleed photo, EN text left on scrim
    b=B('fullbleed_en',1200,628,photo(1200,628,1)); scrim(b,0,700)
    b.block(60,110,['Summer Sale','Up to 60% Off'],84,WH,eid='h',group='gh'); b.text(60,320,'Free shipping on all orders',34,WH,False,role='subheadline',eid='sub',group='gh'); b.button(190,460,260,70,'Shop Now',GOLD,DK); b.logo(1090,30,80); b.save(out)
    # 2 cutout person left, HE text right
    b=B('cutout_left_he',1000,500,grad(1000,500,(250,235,215),(240,190,150))); b.hero(40,40,330,460,'person')
    b.block(700,90,['קורס חדש','למתחילים'],74,DK,'c',eid='h',group='gh'); b.text(700,270,'הרשמה פתוחה עד סוף החודש',30,(60,40,30),False,'c',role='subheadline',eid='sub',group='gh'); b.button(700,390,250,64,'להרשמה',RED,WH); b.save(out)
    # 3 text on colored ribbon over photo
    b=B('ribbon_plate',900,450,photo(900,450,2)); b.d.rectangle([0,150,900,270],fill=(200,30,60)); b.els.append(dict(id='plate',role='decor',shape='free',box=nb([0,150,900,270],900,450,0),group=None))
    b.text(450,175,'MEGA WEEKEND DEAL',72,WH,True,'c',eid='h',group='gh'); b.text(450,310,'Everything must go - this weekend only',32,WH,True,'c',role='subheadline',eid='sub',group='gh'); b.button(450,390,240,56,'Get Offer',GOLD,DK); b.logo(20,20,70); b.save(out)
    # 4 vertical 300x600
    b=B('vert_300x600',300,600,grad(300,600,(20,40,90),(60,120,200))); b.logo(110,24,80); b.block(150,140,['הכי טוב','בעיר'],54,WH,'c',eid='h',group='gh'); b.hero(60,260,180,200,'product'); b.text(150,470,'חדש במלאי',24,GOLD,False,'c',role='subheadline',eid='sub',group='gh'); b.button(150,545,200,50,'לחצו כאן',GOLD,DK); b.save(out)
    # 5 vertical 160x600 skyscraper
    b=B('vert_160x600',160,600,grad(160,600,(120,20,60),(230,90,60))); b.block(80,40,['SALE','50%','OFF'],44,WH,'c',eid='h',group='gh'); b.hero(25,230,110,150,'product'); b.badge(80,440,40,'$29',GOLD,DK); b.text(80,500,'Limited time',18,WH,False,'c',role='subheadline',eid='sub',group='gh'); b.button(80,562,130,40,'Buy',WH,DK); b.save(out)
    # 6 square original -> 728x90
    b=B('square_en',600,600,photo(600,600,6)); scrim(b,0,600,120); b.logo(30,30,70); b.block(300,170,['Learn Design','In 30 Days'],64,WH,'c',eid='h',group='gh'); b.text(300,360,'Online course for beginners',30,WH,False,'c',role='subheadline',eid='sub',group='gh'); b.button(300,470,260,64,'Enroll',GOLD,DK); b.save(out)
    # 7 product + price badge
    b=B('product_price',800,800,grad(800,800,(245,245,250),(200,205,225),True)); b.block(400,50,['Wireless Phone Pro'],56,DK,'c',eid='h',group='gh'); b.hero(260,160,280,420,'product'); b.badge(600,230,95,'$299',RED,WH,size=52); b.text(400,610,'Was $399 - save $100',30,(70,70,90),False,'c',role='subheadline',eid='sub',group='gh'); b.button(400,710,300,70,'Order Today',DK,WH); b.save(out)
    # 8 two-column split
    b=B('twocol_split',1200,600,grad(1200,600,(250,250,245),(235,235,225),False)); ph=photo(520,520,8); b.im.paste(ph,(640,40)); b.els.append(dict(id='photo',role='photo',shape='rounded',box=nb([640,40,1160,560],1200,600,1),group=None))
    b.block(60,90,['Fresh Coffee','Delivered'],70,DK,eid='h',group='gh'); b.block(60,260,['Roasted this week and shipped','to your door in two days.'],30,(70,70,70),role='body',eid='body',group='gh',bold=False,lh=1.3); b.button(200,420,280,70,'Subscribe',(40,110,60),WH); b.logo(60,500,60); b.save(out)
    # 9 text at the very edge, fine print
    b=B('edge_text',1000,400,grad(1000,400,(15,15,40),(60,20,90),False)); b.text(8,20,'סוף העונה',110,GOLD,True,'l',eid='h',group='gh'); b.text(10,170,'כל המלאי בהנחה',44,WH,False,'l',role='subheadline',eid='sub',group='gh'); b.logo(900,6,90); b.button(880,230,200,60,'לחנות',GOLD,DK)
    b.text(10,372,'* ההנחה בכפוף לתקנון החברה, בתוקף עד 31.12',14,(190,190,210),False,'l',role='caption',eid='fine',group='gf'); b.save(out)
    # 10 mixed HE/EN, huge headline + tiny fine print
    b=B('mixed_huge_fine',800,1000,photo(800,1000,10)); scrim(b,0,800,150); b.logo(30,30,70); b.block(400,150,['SUPER','סייל 70%'],150,WH,'c',eid='h',group='gh'); b.text(400,500,'Black Friday - רק היום',40,GOLD,True,'c',role='subheadline',eid='sub',group='gh'); b.button(400,680,360,86,'Shop קנו עכשיו',RED,WH)
    b.block(400,900,['Terms apply. תנאים חלים. מוגבל ל-3 יחידות ללקוח, בכפוף לתקנון האתר.','Offer valid while stocks last.'],13,(235,235,235),'c',role='caption',eid='fine',group='gf',bold=False); b.save(out)
if __name__=='__main__':
    os.makedirs(sys.argv[1],exist_ok=True); build(sys.argv[1]); print('raqm',features.check('raqm'))
