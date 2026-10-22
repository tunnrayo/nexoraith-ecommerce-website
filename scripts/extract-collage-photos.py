# Cuts each product photo out of the owner's category collages (docs/source-collages/*.png) and saves
# nx-001.jpg ... nx-100.jpg (square, white margin, enlarged at most 2x) into the folder given as the first argument.
# Used once on 2026-10-22; kept so the result can be reproduced. Needs Python 3 with Pillow, numpy and scipy.
#   python3 scripts/extract-collage-photos.py /tmp/out   (then review and copy into public/images/products/)
import numpy as np, json, os, sys
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
U=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','docs','source-collages')+os.sep
OUT=sys.argv[1]; os.makedirs(OUT,exist_ok=True)
SETS=[('home-and-kitchen','Home and Kitchen',1,None),('fashion-and-accessories','Fashion and Accessories',21,[215,32,133]),('beauty-and-personal-care','Beauty and Personal Care',36,[2,121,80]),
      ('everyday-gadgets-and-electronics','Everyday Gadgets and Electronics',51,[0,102,200]),('baby-and-kids','Baby and Kids',66,[10,170,178]),('sports-and-outdoor','Sports and Outdoor',76,[253,107,24]),('office-accessories','Office Accessories',86,[96,17,180])]
def labels(a,pt):
    col=np.array(pt); d=np.abs(a-col).sum(axis=2)<70; lab,n=ndimage.label(d); b=[]
    for i,s in enumerate(ndimage.find_objects(lab)):
        h=s[0].stop-s[0].start; w=s[1].stop-s[1].start
        if 25<=h<=80 and 200<=w<=320 and (lab[s]==i+1).sum()>0.6*h*w: b.append([s[0].start,s[0].stop,s[1].start,s[1].stop])
    # group rows
    b.sort(); rows=[]
    for x in b:
        if rows and abs(rows[-1][0][0]-x[0])<20: rows[-1].append(x)
        else: rows.append([x])
    return [sorted(r,key=lambda z:z[2]) for r in rows]
def tiles(a,pt,name):
    if pt is None:  # home & kitchen: borders found by scanning (tile rows/cols), name text in the bottom 42 px
        cols=[(16,301),(320,609),(624,911),(927,1216),(1231,1521)]; rows=[(128,348),(358,574),(584,787),(797,1005)]
        return [(y0+4,y1-42,x0+5,x1-5) for (y0,y1) in rows for (x0,x1) in cols]
    rows=labels(a,pt); out=[]
    pitch=rows[1][0][0]-rows[0][0][0]
    for ri,r in enumerate(rows):
        assert len(r)==5,(name,ri,len(r))
        for l in r:
            start = (rows[ri-1][0][1]+2) if ri else (l[1]-pitch-12)
            x0,x1=l[2]+2,l[3]-2
            frac=lambda y: (np.abs(a[y,x0:x1]-255).max(axis=1)>25).mean()
            top=start
            for y in range(start,start+60):   # bottom edge of the tile border / accent line (a thin, near-full-width line)
                if frac(y)>0.6 and frac(y+3)<0.35 and frac(y+5)<0.35: top=y+3
                elif frac(y)>0.97 and frac(y+3)<frac(y)-0.2 and frac(y+5)<frac(y)-0.2: top=y+2   # border line touching the product
            out.append((top,l[0]-3,x0,x1))
    return out
def crop(a,t,skipline=True,lc=None):
    y0,y1,x0,x1=t; reg=a[y0:y1,x0:x1].copy()
    bg=np.median(np.concatenate([reg[:4].reshape(-1,3),reg[-4:].reshape(-1,3),reg[:,:4].reshape(-1,3),reg[:,-4:].reshape(-1,3)]),axis=0)
    m=np.abs(reg-bg).max(axis=2)>28
    if skipline:  # rounded-corner remnants of the border: tiny pieces confined to the first 8 rows
        lab,n=ndimage.label(m,structure=np.ones((3,3)))
        for k,sl in enumerate(ndimage.find_objects(lab)):
            if sl[0].stop<=8 and (lab[sl]==k+1).sum()<150: sel=lab==k+1; reg[sel]=255; m[sel]=False
    m=ndimage.binary_opening(m,structure=np.ones((3,3)),iterations=1)
    ys,xs=np.where(m)
    if len(ys)<50: return reg,(y0,y1,x0,x1),bg
    pad=6; yy0=max(0,ys.min()-pad); yy1=min(reg.shape[0],ys.max()+pad+1); xx0=max(0,xs.min()-pad); xx1=min(reg.shape[1],xs.max()+pad+1)
    return reg[yy0:yy1,xx0:xx1],(y0+yy0,y0+yy1,x0+xx0,x0+xx1),bg
rows=[]
for f,cat,start,pt in SETS:
    a=np.asarray(Image.open(U+f+'-collage.png').convert('RGB')).astype(int)
    ts=tiles(a,pt,cat); assert len(ts)==(20 if start==1 else 10 if start in (66,76) else 15),(cat,len(ts))
    for i,t in enumerate(ts):
        n=start+i; c,box,bg=crop(a,t,pt is not None,pt); h,w=c.shape[:2]
        side=int(max(h,w)*1.10); canvas=Image.new('RGB',(side,side),(255,255,255))
        # light background tiles keep their own (near-white) background; the margin is white
        canvas.paste(Image.fromarray(c.astype('uint8')),((side-w)//2,(side-h)//2))
        target=min(800,max(side,min(side*2,800)))
        img=canvas.resize((target,target),Image.LANCZOS) if target!=side else canvas
        fn=f'nx-{n:03d}.jpg'; img.save(os.path.join(OUT,fn),'JPEG',quality=88,optimize=True,progressive=True)
        rows.append(dict(code=f'NX-{n:03d}',list_no=n,collage=f+'-collage.png',collage_category=cat,tile_box_xyxy=[t[2],t[0],t[3],t[1]],product_box_xyxy=[box[2],box[0],box[3],box[1]],source_px=[w,h],scale=round(target/side,2),file=fn,out_px=target,bytes=os.path.getsize(os.path.join(OUT,fn))))
json.dump(rows,open(os.path.join(OUT,'_extract.json'),'w'),indent=1,default=int)
print(len(rows),'extracted'); print('smallest source crops:',sorted((r['source_px'],r['code']) for r in rows)[:5])
