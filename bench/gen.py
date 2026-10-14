# מחולל באנרים סינתטיים עם סימון אלמנטים ידוע (בלי AI), לבדיקת המנוע על הרבה סוגי עיצובים.
# שימוש: python3 bench/gen.py bench/fixtures 24
import sys, os, json, random, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter
FB='/usr/share/fonts/truetype/freefont/FreeSansBold.ttf'; FR='/usr/share/fonts/truetype/freefont/FreeSans.ttf'
HE_HEAD=['שבת בראשית בצפת','מבצע הקיץ הגדול','הנחה על כל האתר','חג שמח לכולם','כנס השנה בירושלים','קולקציה חדשה הגיעה','משלוח חינם מעל 199','ערב מיוחד לכל המשפחה']
HE_SUB=['מעין עולם הבא','רק השבוע בלבד','לזמן מוגבל','הרשמה בקישור','מחכים לכם']
HE_CAP=[['סיור היסטורי','בסמטאות צפת'],['בעל המנגן','ר׳ יוסי כהן'],['המרצה','הרב אורי לוי'],['קומזיץ','ליל שישי']]
HE_BTN=['להזמנות','לחצו כאן','הרשמה עכשיו','לרכישה']
def rev(s): return s  # PIL עם raqm מסדר עברית לבד
def font(p,s): return ImageFont.truetype(p,int(s))
def grad(w,h,c1,c2,vertical=True):
    im=Image.new('RGB',(w,h)); px=im.load()
    for y in range(h):
        for x in range(w):
            t=(y/h if vertical else x/w); px[x,y]=tuple(int(c1[i]*(1-t)+c2[i]*t) for i in range(3))
    return im
def noise_photo(d,seed):
    r=random.Random(seed); im=grad(d,d,[r.randint(30,230) for _ in range(3)],[r.randint(30,230) for _ in range(3)],False)
    dr=ImageDraw.Draw(im)
    for _ in range(14):
        x,y=r.randint(0,d),r.randint(0,d); rr=r.randint(d//10,d//3); dr.ellipse([x-rr,y-rr,x+rr,y+rr],fill=tuple(r.randint(20,240) for _ in range(3)))
    return im.filter(ImageFilter.GaussianBlur(1.2))
def circle_paste(base,im,x,y):
    d=im.size[0]; m=Image.new('L',(d*4,d*4),0); ImageDraw.Draw(m).ellipse([0,0,d*4-1,d*4-1],fill=255); m=m.resize((d,d),Image.LANCZOS); base.paste(im,(x,y),m)
def text_c(dr,cx,y,s,f,fill):
    s=rev(s); w=dr.textlength(s,font=f); dr.text((cx-w/2,y),s,font=f,fill=fill); b=f.getbbox(s); return [cx-w/2,y+b[1],cx+w/2,y+b[3]]
def box(b,W,H,pad=0):
    return [max(0,(b[0]-pad)/W*1000),max(0,(b[1]-pad)/H*1000),min(1000,(b[2]+pad)/W*1000),min(1000,(b[3]+pad)/H*1000)]
def contrast(bg):
    l=0.299*bg[0]+0.587*bg[1]+0.114*bg[2]; return (255,255,255) if l<140 else (25,25,40)
def make(kind,seed,out):
    r=random.Random(seed)
    W,H={'wide_hero':(1200,420),'tall_gallery':(700,1000),'promo_badge':(800,600),'square_logo':(800,800),'row_photos':(1000,560),'split_photo':(1200,500),'tall_text':(600,1000),'leader':(1500,300)}[kind]
    c1=[r.randint(10,200) for _ in range(3)]; c2=[r.randint(10,200) for _ in range(3)]
    bg=grad(W,H,c1,c2,r.random()<.6); dr=ImageDraw.Draw(bg); fg=contrast([(c1[i]+c2[i])//2 for i in range(3)])
    accent=tuple(r.choice([(255,200,40),(255,80,120),(60,200,255),(120,230,120)]))
    els=[]; add=lambda **k: els.append(k)
    head=r.choice(HE_HEAD); sub=r.choice(HE_SUB); btn=r.choice(HE_BTN)
    def headline(cx,y,maxw,size,lines=None):
        words=head.split(); lines=lines or ([head] if len(words)<3 else [' '.join(words[:2]),' '.join(words[2:])]); f=font(FB,size); ys=y; bs=[]
        for ln in lines:
            bs.append(text_c(dr,cx,ys,ln,f,fg)); ys+=size*1.15
        b=[min(x[0] for x in bs),min(x[1] for x in bs),max(x[2] for x in bs),max(x[3] for x in bs)]
        add(id='h',role='headline',box=box(b,W,H,3),lines=lines,group='gh'); return ys
    def button(cx,cy,w,h,txt):
        dr.rounded_rectangle([cx-w/2,cy-h/2,cx+w/2,cy+h/2],radius=h/2,fill=accent); f=font(FB,h*.42); s=rev(txt); tw=dr.textlength(s,font=f)
        dr.text((cx-tw/2,cy-h*.28),s,font=f,fill=(20,20,30)); add(id='btn',role='button',shape='pill',style='filled',box=box([cx-w/2,cy-h/2,cx+w/2,cy+h/2],W,H,1),group=None)
        add(id='btnl',role='label',box=box([cx-tw/2,cy-h*.28,cx+tw/2,cy+h*.2],W,H,2),lines=[txt],group='gb')
    def logo(x,y,d):
        im=noise_photo(d,seed+7); circle_paste(bg,im,x,y); dr.ellipse([x,y,x+d,y+d],outline=fg,width=max(2,d//30)); add(id='logo',role='logo',shape='circle',box=box([x,y,x+d,y+d],W,H,1),group=None)
    def photos(n,cy,d,gap,cap=True):
        total=n*d+(n-1)*gap; x=(W-total)/2
        for i in range(n):
            circle_paste(bg,noise_photo(d,seed*13+i),int(x),int(cy)); add(id=f'p{i}',role='photo',shape='circle',box=box([x,cy,x+d,cy+d],W,H,1),group='gp')
            if cap:
                f=font(FB,d*.17); ls=HE_CAP[i%4]; yy=cy+d+d*.12; bs=[]
                for ln in ls: bs.append(text_c(dr,x+d/2,yy,ln,f,fg)); yy+=d*.2
                b=[min(q[0] for q in bs),min(q[1] for q in bs),max(q[2] for q in bs),max(q[3] for q in bs)]
                add(id=f'c{i}',role='caption',box=box(b,W,H,2),lines=ls,group='gp')
            x+=d+gap
    def hero(x,y,w,h):
        im=Image.new('RGBA',(w,h),(0,0,0,0)); d2=ImageDraw.Draw(im)
        for _ in range(7):
            cx,cy=r.randint(w//5,w*4//5),r.randint(h//4,h*4//5); rr=r.randint(h//8,h//3); col=tuple(r.randint(30,250) for _ in range(3))+(255,); d2.ellipse([cx-rr,cy-rr,cx+rr,cy+rr],fill=col)
        im=im.filter(ImageFilter.GaussianBlur(1)); bg.paste(im,(x,y),im); add(id='hero',role='hero',shape='hero',box=box([x,y,x+w,y+h],W,H,0),group=None)
    if kind=='wide_hero':
        hero(40,50,380,330); headline(820,70,620,92); text_c(dr,820,250,sub,font(FR,44),fg); add(id='sub',role='subheadline',box=box([640,245,1000,300],W,H),lines=[sub],group='gh'); button(820,350,260,64,btn); logo(1080,24,90)
    elif kind=='tall_gallery':
        logo(300,40,100); y=headline(350,190,560,84); photos(4,y+60,120,24); button(350,880,360,90,btn)
    elif kind=='promo_badge':
        headline(400,60,700,100); dr.ellipse([300,250,500,450],fill=accent); text_c(dr,400,310,'10%',font(FB,70),(20,20,30)); add(id='badge',role='badge',shape='circle',box=box([300,250,500,450],W,H,1),group=None); button(400,520,300,70,btn)
    elif kind=='square_logo':
        logo(350,640,100); headline(400,120,640,96); text_c(dr,400,420,sub,font(FR,50),fg); add(id='sub',role='subheadline',box=box([200,415,600,480],W,H),lines=[sub],group='gh')
    elif kind=='row_photos':
        y=headline(500,50,900,100,[head]); photos(5,y+40,140,30); button(500,470,300,70,btn)
    elif kind=='split_photo':
        hero(700,30,460,440); headline(330,100,500,86); button(330,360,280,70,btn); logo(30,24,80)
    elif kind=='tall_text':
        y=headline(300,160,500,90); text_c(dr,300,y+30,sub,font(FR,46),fg); add(id='sub',role='subheadline',box=box([100,y+25,500,y+90],W,H),lines=[sub],group='gh'); button(300,720,340,86,btn); logo(250,860,100)
    elif kind=='leader':
        logo(30,60,170); headline(750,70,800,110,[head]); button(1330,150,260,80,btn)
    bg.save(os.path.join(out,f'{kind}_{seed}.png')); open(os.path.join(out,f'{kind}_{seed}.rgba'),'wb').write(bg.convert('RGBA').tobytes()); json.dump({'w':W,'h':H,'elements':els},open(os.path.join(out,f'{kind}_{seed}.json'),'w'),ensure_ascii=False)
if __name__=='__main__':
    out=sys.argv[1]; n=int(sys.argv[2]); os.makedirs(out,exist_ok=True)
    kinds=['wide_hero','tall_gallery','promo_badge','square_logo','row_photos','split_photo','tall_text','leader']
    for i in range(n): make(kinds[i%len(kinds)],100+i,out)
    print('fixtures',n)
