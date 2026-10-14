import sys, os, json, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter
FB='/usr/share/fonts/truetype/freefont/FreeSansBold.ttf'; FR='/usr/share/fonts/truetype/freefont/FreeSans.ttf'
def font(p,s): return ImageFont.truetype(p,max(6,int(s)))
def grad(w,h,c1,c2,vert):
    im=Image.new('RGB',(w,h)); d=ImageDraw.Draw(im)
    n=h if vert else w
    for i in range(n):
        t=i/n; c=tuple(int(c1[k]*(1-t)+c2[k]*t) for k in range(3))
        d.line([(0,i),(w,i)] if vert else [(i,0),(i,h)],fill=c)
    return im
def photo(d,seed,rounded=False):
    r=random.Random(seed); im=grad(d,d,[r.randint(40,230) for _ in range(3)],[r.randint(40,230) for _ in range(3)],False); dr=ImageDraw.Draw(im)
    for _ in range(12):
        x,y=r.randint(0,d),r.randint(0,d); rr=r.randint(max(2,d//10),max(3,d//3)); dr.ellipse([x-rr,y-rr,x+rr,y+rr],fill=tuple(r.randint(20,240) for _ in range(3)))
    return im.filter(ImageFilter.GaussianBlur(1))
class B:
    def __init__(s,name,W,H,c1,c2=None,vert=True,fg=(255,255,255),accent=(255,200,40),seed=1):
        s.name,s.W,s.H,s.fg,s.acc,s.seed=name,W,H,fg,accent,seed
        s.im=grad(W,H,c1,c2 or c1,vert); s.d=ImageDraw.Draw(s.im); s.els=[]; s.n=0
    def box(s,b,pad=1):
        W,H=s.W,s.H; return [max(0,(b[0]-pad)/W*1000),max(0,(b[1]-pad)/H*1000),min(1000,(b[2]+pad)/W*1000),min(1000,(b[3]+pad)/H*1000)]
    def add(s,role,b,**k):
        s.n+=1; e=dict(id=f'{role}{s.n}',role=role,box=s.box(b,k.pop('pad',1))); e.update(k); s.els.append(e); return e
    def fit(s,txt,maxw,size,bold=True):
        f=font(FB if bold else FR,size)
        while s.d.textlength(txt,font=f)>maxw and size>7: size-=1; f=font(FB if bold else FR,size)
        return f,size
    def text(s,role,lines,cx,y,size,maxw,fill=None,bold=True,align='c',group=None,lh=1.2,x=None,**k):
        """align c: centered at cx; r: right edge at x (RTL); l: left edge at x"""
        fill=fill or s.fg; f,size=s.fit(max(lines,key=len),maxw,size,bold); bs=[]; yy=y
        for ln in lines:
            w=s.d.textlength(ln,font=f); bb=f.getbbox(ln)
            x0=cx-w/2 if align=='c' else (x-w if align=='r' else x)
            s.d.text((x0,yy),ln,font=f,fill=fill); bs.append([x0,yy+bb[1],x0+w,yy+bb[3]]); yy+=size*lh
        b=[min(q[0] for q in bs),min(q[1] for q in bs),max(q[2] for q in bs),max(q[3] for q in bs)]
        s.add(role,b,lines=lines,group=group,pad=2,**k); return yy,b
    def button(s,cx,cy,w,h,txt,fill=None,outline=False):
        fill=fill or s.acc; b=[cx-w/2,cy-h/2,cx+w/2,cy+h/2]
        if outline: s.d.rounded_rectangle(b,radius=h/2,outline=s.fg,width=max(1,int(h/14)))
        else: s.d.rounded_rectangle(b,radius=h/2,fill=fill)
        s.add('button',b,shape='pill',style='outline' if outline else 'filled',group=None)
        f,sz=s.fit(txt,w*.8,h*.42); tw=s.d.textlength(txt,font=f); bb=f.getbbox(txt); ty=cy-(bb[1]+bb[3])/2
        s.d.text((cx-tw/2,ty),txt,font=f,fill=s.fg if outline else (20,20,30))
        s.add('label',[cx-tw/2,ty+bb[1],cx+tw/2,ty+bb[3]],lines=[txt],group='b%d'%s.n,pad=1)
    def photo(s,x,y,d,cap=None,rounded=False,capsize=None,group='g'):
        sd=s.seed*31+s.n; im=photo(int(d),sd); m=Image.new('L',(int(d)*4,)*2,0); md=ImageDraw.Draw(m)
        if rounded: md.rounded_rectangle([0,0,int(d)*4-1,int(d)*4-1],radius=int(d)*4//6,fill=255)
        else: md.ellipse([0,0,int(d)*4-1,int(d)*4-1],fill=255)
        m=m.resize((int(d),int(d)),Image.LANCZOS); s.im.paste(im,(int(x),int(y)),m)
        s.add('photo',[x,y,x+d,y+d],shape='rounded' if rounded else 'circle',group=group)
        if cap: s.text('caption',cap,x+d/2,y+d+d*.08,capsize or d*.17,d*1.25,group=group,lh=1.15)
    def logo(s,x,y,w,h,letter,kind=0):
        r=random.Random(hash(letter)%1000); col=tuple(r.randint(30,240) for _ in range(3))
        if kind==0: s.d.rounded_rectangle([x,y,x+w,y+h],radius=h//4,fill=col)
        elif kind==1: s.d.ellipse([x,y,x+w,y+h],fill=col)
        else: s.d.polygon([(x,y+h),(x+w/2,y),(x+w,y+h)],fill=col)
        f=font(FB,h*.55); tw=s.d.textlength(letter,font=f); s.d.text((x+w/2-tw/2,y+h*.18),letter,font=f,fill=(255,255,255) if sum(col)<450 else (20,20,20))
        s.add('logo',[x,y,x+w,y+h],shape='free',group=None)
    def badge(s,cx,cy,r,txt,fill=None,tc=(20,20,30)):
        s.d.ellipse([cx-r,cy-r,cx+r,cy+r],fill=fill or s.acc); f,sz=s.fit(txt,r*1.5,r*.8); tw=s.d.textlength(txt,font=f); bb=f.getbbox(txt)
        s.d.text((cx-tw/2,cy-(bb[1]+bb[3])/2),txt,font=f,fill=tc); s.add('badge',[cx-r,cy-r,cx+r,cy+r],shape='circle',group=None)
    def bullets(s,lines,x_right,y,size,maxw,group='bl'):
        # RTL bullets: dot on the right, text to its left
        f,sz=s.fit(max(lines,key=len),maxw,size); yy=y; bs=[]
        for ln in lines:
            w=s.d.textlength(ln,font=f); bb=f.getbbox(ln); r=sz*.18
            s.d.ellipse([x_right-2*r,yy+(bb[1]+bb[3])/2-r,x_right,yy+(bb[1]+bb[3])/2+r],fill=s.acc)
            xr=x_right-3.5*r; s.d.text((xr-w,yy),ln,font=f,fill=s.fg); bs.append([xr-w,yy+bb[1],x_right,yy+bb[3]]); yy+=sz*1.45
        b=[min(q[0] for q in bs),min(q[1] for q in bs),max(q[2] for q in bs),max(q[3] for q in bs)]
        s.add('bullets',b,lines=lines,bullet=True,group=group,pad=2); return yy
    def save(s,out):
        s.im.save(f'{out}/{s.name}.png'); open(f'{out}/{s.name}.rgba','wb').write(s.im.convert('RGBA').tobytes())
        json.dump({'w':s.W,'h':s.H,'elements':s.els},open(f'{out}/{s.name}.json','w'),ensure_ascii=False)
CAP=[['סיור בצפת','העתיקה'],['בעל המנגן','ר׳ יוסי'],['המרצה','הרב אורי'],['קומזיץ','ליל שישי'],['סדנת נגינה','למתחילים'],['הרצאת פתיחה','ד״ר לוי'],['ארוחת גאלה','חגיגית'],['מופע לילה','בכיכר']]
FINE=['* התנאים באתר. בכפוף לתקנון המבצע, אין כפל הנחות']
def build(out):
    # 1 conference 1200x500
    b=B('x01_conf_1200x500',1200,500,(20,30,90),(60,20,110),False,seed=1)
    b.logo(1090,16,90,50,'A',0); b.logo(980,16,90,50,'B',1); b.logo(870,16,90,50,'C',2)
    b.text('headline',['כנס השנה','בירושלים'],820,40,76,330,group='h'); b.text('subheadline',['שלושה ימים של השראה'],820,215,34,330,bold=False,group='h')
    b.text('body',['י״ד-ט״ז באלול | מרכז הכנסים'],820,265,24,330,bold=False,group='d')
    b.badge(1130,200,40,'10%')
    for i in range(6): b.photo(30+(i%3)*190,30+(i//3)*230,130,CAP[i],group='g')
    b.button(720,380,230,56,'להרשמה'); b.button(960,380,200,56,'לתוכנית',outline=True)
    b.text('body',['מחיר מוקדם 249 ש״ח במקום 349'],820,438,24,330,fill=b.acc,group='p')
    b.text('body',FINE,600,470,13,560,bold=False,group='f'); b.save(out)
    # 2 billboard 970x250
    b=B('x02_bill_970x250',970,250,(240,240,245),(200,215,235),True,fg=(20,25,50),accent=(230,60,70),seed=2)
    b.logo(880,12,80,40,'S',0)
    b.text('headline',['מבצע הקיץ הגדול'],700,14,46,430,group='h'); b.text('subheadline',['הנחות על כל האתר'],700,72,24,430,bold=False,group='h')
    for i in range(4): b.photo(30+i*140,20,95,CAP[i],group='g')
    b.badge(560,80,44,'10%',tc=(255,255,255))
    b.text('body',['החל מ-99 ש״ח בלבד'],700,125,24,300,group='p')
    b.button(700,185,220,44,'לרכישה'); b.button(450,185,180,44,'לקטלוג',outline=True)
    b.text('body',['* בתוקף עד 30.9 בכפוף לתקנון'],700,230,11,400,bold=False,group='f'); b.save(out)
    # 3 sale 600x600
    b=B('x03_sale_600x600',600,600,(250,235,200),(250,180,150),True,fg=(60,20,30),accent=(200,30,60),seed=3)
    b.logo(500,16,80,40,'K',0); b.logo(20,16,50,50,'M',1)
    b.text('headline',['הנחה על','כל האתר'],300,60,66,420,group='h'); b.text('subheadline',['רק השבוע, לזמן מוגבל'],300,200,28,420,bold=False,group='h')
    b.badge(500,210,50,'10%',tc=(255,255,255))
    for i in range(4): b.photo(60+i*125,260,100,CAP[i],rounded=True,group='g')
    b.bullets(['משלוח חינם מעל 199','החזרה תוך 30 יום','תשלום ב-12 תשלומים'],560,400,22,360)
    b.text('body',['₪149 במקום ₪199'],150,420,28,230,fill=b.acc,group='p')
    b.button(160,520,230,52,'לרכישה',fill=b.acc); b.button(420,520,230,52,'לפרטים',outline=True)
    b.text('body',FINE,300,575,11,520,bold=False,group='f'); b.save(out)
    # 4 tall 300x600
    b=B('x04_tall_300x600',300,600,(15,60,70),(10,20,40),True,seed=4)
    b.logo(110,12,80,36,'Z',0)
    b.text('headline',['ערב מיוחד','לכל המשפחה'],150,60,36,260,group='h'); b.text('subheadline',['מחכים לכם בקיבוץ'],150,150,20,260,bold=False,group='h')
    for i in range(3): b.photo(30+i*90,190,80,CAP[i],group='g')
    b.bullets(['כניסה חופשית','קפה ועוגה','הפעלות לילדים'],270,310,17,200)
    b.text('body',['יום חמישי 12.10, 19:30'],150,400,20,250,fill=b.acc,group='d')
    b.badge(60,470,32,'10%')
    b.text('body',['₪25 לכרטיס'],190,460,22,170,group='p')
    b.button(150,530,220,44,'להזמנות'); b.text('body',['* מספר המקומות מוגבל, בכפוף לתקנון'],150,575,10,270,bold=False,group='f'); b.save(out)
    # 5 skyscraper 160x600
    b=B('x05_sky_160x600',160,600,(250,250,250),(255,225,160),True,fg=(30,30,50),accent=(30,100,200),seed=5)
    b.logo(40,10,80,36,'D',0)
    b.text('headline',['מבצע','הקיץ','הגדול'],80,60,34,140,group='h'); b.text('subheadline',['לזמן מוגבל'],80,200,18,140,bold=False,group='h')
    b.badge(80,270,36,'10%',tc=(255,255,255))
    for i in range(3): b.photo(35,330+i*85-0,60,None,group='g') if False else None
    for i in range(3): b.photo(18+i*46,330,42,None,group='g')
    b.text('caption',['סיור','ליל שישי','קומזיץ'],80,382,13,140,group='g')
    b.bullets(['משלוח חינם','החזרה חינם'],145,440,13,110)
    b.text('body',['₪99 בלבד'],80,490,20,140,group='p')
    b.button(80,540,130,36,'לרכישה'); b.text('body',['* בכפוף לתקנון'],80,580,9,140,bold=False,group='f'); b.save(out)
    # 6 leaderboard 728x90
    b=B('x06_leader_728x90',728,90,(30,30,40),(90,30,60),False,seed=6)
    b.logo(670,12,50,30,'L',0)
    b.text('headline',['קולקציה חדשה הגיעה'],520,8,28,300,group='h'); b.text('subheadline',['הנחות עד 50% לחברי מועדון'],520,44,15,300,bold=False,group='h')
    for i in range(3): b.photo(215+i*0,0,0) if False else None
    for i in range(3): b.photo(140+i*60,12,46,None,group='g')
    b.badge(95,45,30,'10%'); b.button(670,64,100,22,'לרכישה')
    b.text('body',['* בכפוף לתקנון המבצע'],520,72,9,300,bold=False,group='f')
    b.text('body',['מ-₪49'],300,70,14,60,fill=b.acc,group='p'); b.save(out)
    # 7 gallery 1200x500 gradient
    b=B('x07_gallery_1200x500',1200,500,(10,90,100),(120,40,120),True,seed=7)
    b.text('headline',['קולקציה חדשה','הגיעה'],980,24,64,380,group='h'); b.text('subheadline',['תערוכת אמנים מובילים'],980,170,28,380,bold=False,group='h')
    b.logo(40,20,70,40,'N',0); b.logo(120,20,70,40,'O',1); b.logo(200,20,70,40,'P',2)
    for i in range(8): b.photo(40+(i%4)*135,90+(i//4)*190,100,CAP[i],group='g')
    b.button(980,300,260,56,'לכל הקולקציה'); b.button(980,370,260,56,'לקבוע תור',outline=True)
    b.text('body',['פתוח א׳-ה׳ 10:00-20:00'],980,430,22,360,bold=False,group='d')
    b.text('body',FINE,600,475,12,700,bold=False,group='f'); b.save(out)
    # 8 prices 600x600 solid
    b=B('x08_prices_600x600',600,600,(25,25,35),None,seed=8,accent=(120,230,120))
    b.text('headline',['מבצע סוף עונה'],300,18,54,520,group='h'); b.text('subheadline',['שלוש חבילות, מחיר אחד'],300,82,26,520,bold=False,group='h')
    b.text('subheadline',['בחרו את המתאימה לכם'],300,118,20,400,bold=False,group='h2')
    for i,(t,p) in enumerate([('בסיסית','₪49'),('מורחבת','₪89'),('פרימיום','₪129')]):
        x=40+i*180; b.d.rounded_rectangle([x,170,x+160,330],radius=14,outline=b.fg,width=2)
        b.text('caption',[t],x+80,185,22,130,group=f'c{i}'); b.text('subheadline',[p],x+80,235,36,130,fill=b.acc,group=f'c{i}')
        b.badge(x+130,180,22,'10%') if i==1 else None
    b.bullets(['אחריות לשנתיים','התקנה חינם','שירות 24/7','ללא התחייבות'],560,360,22,330)
    b.text('body',['תאריך אחרון: 31.10.2026'],150,400,20,240,fill=b.acc,group='d')
    b.badge(90,500,40,'10%')
    b.button(250,500,200,50,'להצטרפות'); b.button(450,500,200,50,'התקשרו',outline=True)
    b.logo(520,550,60,30,'Q',0); b.text('body',['* לפי תקנון החברה, ט.ל.ח'],200,570,11,300,bold=False,group='f'); b.save(out)
    # 9 sponsors 970x250 gradient
    b=B('x09_sponsor_970x250',970,250,(255,120,60),(200,40,90),False,seed=9)
    b.text('headline',['משלוח חינם מעל 199'],750,12,48,360,group='h'); b.text('subheadline',['חג שמח לכל הלקוחות'],750,70,24,360,bold=False,group='h')
    b.text('body',['10-14 באוקטובר 2026'],750,108,20,360,bold=False,group='d')
    for i in range(6): b.photo(20+i*80,20,65,None,group='g')
    b.text('caption',['סיור','בעל המנגן','המרצה','קומזיץ','סדנה','מופע'],0,0,1,1) if False else None
    for i in range(3): b.logo(20+i*100,110,85,45,'ABC'[i],i)
    b.button(750,170,240,46,'לחצו כאן',fill=(255,255,255)); b.badge(900,95,38,'10%',fill=(255,255,255))
    b.logo(20,175,85,45,'D',0); b.logo(120,175,85,45,'E',1)
    b.text('body',['* בכפוף לתקנון. תמונות להמחשה'],750,228,11,400,bold=False,group='f'); b.save(out)
    # 10 mega 300x600 gradient
    b=B('x10_mega_300x600',300,600,(30,60,150),(120,30,100),True,seed=10)
    b.logo(20,10,70,32,'R',0); b.logo(210,10,70,32,'T',1)
    b.text('headline',['כנס השנה'],150,52,40,260,group='h'); b.text('headline',['בצפת'],150,100,36,260,group='h2')
    b.text('subheadline',['מעין עולם הבא'],150,150,20,260,bold=False,group='h')
    b.badge(250,215,30,'10%')
    for i in range(4): b.photo(18+(i%2)*60+0,190+(i//2)*0,0) if False else None
    for i in range(4): b.photo(20+(i%2)*70,185+(i//2)*100,56,CAP[i],group='g')
    b.bullets(['אירוח מלא','תוכנית עשירה','הסעות','פרסים'],280,400,15,115)
    b.text('body',['יום שלישי 3.11'],150,380,17,120,fill=b.acc,group='d') if False else None
    b.text('body',['₪349 בלבד'],210,395,22,120,fill=b.acc,group='p') if False else None
    b.text('body',['₪349 בלבד'],80,480,22,120,fill=b.acc,group='p')
    b.text('body',['3.11, 19:30'],80,510,16,120,group='d')
    b.button(210,490,130,40,'להזמנות'); b.button(210,540,130,34,'עוד פרטים',outline=True)
    b.text('body',['* בכפוף לתקנון. ט.ל.ח'],150,583,9,270,bold=False,group='f'); b.save(out)
if __name__=='__main__':
    os.makedirs(sys.argv[1],exist_ok=True); build(sys.argv[1]); print('ok')
