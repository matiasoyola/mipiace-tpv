# -*- coding: utf-8 -*-
import math
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white, black, Color
from carta import (ALG, DESAYUNOS, SUPLEMENTOS, CAFE, INFUSIONES, TEFRIO,
                   BOLLERIA, TOSTADA, CRSAND, BEBIDAS, LICORES)

BG   = HexColor("#F3EEDC")
INK  = HexColor("#3E2C19")
BROWN= HexColor("#6E4B27")
GOLD = HexColor("#A9793B")
LINE = HexColor("#C6AF82")
SOFT = HexColor("#8A6B45")
GREEN = HexColor("#4E7A3A")

BLEED=3*mm; PW,PH=148*mm,210*mm; MW,MH=PW+2*BLEED,PH+2*BLEED
ML=14*mm; MR=14*mm; X0=BLEED+ML; X1=BLEED+PW-MR
TOP=BLEED+PH-15*mm; BOT=BLEED+12*mm
CXC=BLEED+PW/2

c=canvas.Canvas("/sessions/nifty-nice-pascal/mnt/outputs/Carta_Sirope_imprenta.pdf",pagesize=(MW,MH))

def bg():
    c.setFillColor(BG); c.rect(0,0,MW,MH,fill=1,stroke=0)
def crop():
    c.setStrokeColor(black); c.setLineWidth(0.3); L=3*mm
    for x,y,dx,dy in [(BLEED,BLEED,-1,0),(BLEED,BLEED,0,-1),(BLEED+PW,BLEED,1,0),(BLEED+PW,BLEED,0,-1),
                      (BLEED,BLEED+PH,-1,0),(BLEED,BLEED+PH,0,1),(BLEED+PW,BLEED+PH,1,0),(BLEED+PW,BLEED+PH,0,1)]:
        c.line(x,y,x+dx*L,y+dy*L)

# ---------------- pictogramas alergenos ----------------
def _prep(cx,cy,r,col):
    c.setFillColor(col); c.circle(cx,cy,r,fill=1,stroke=0)
    c.setStrokeColor(white); c.setFillColor(white)
    c.setLineWidth(max(0.35,r*0.12)); c.setLineCap(1); c.setLineJoin(1)

def ic_GL(cx,cy,r,col):
    _prep(cx,cy,r,col); c.line(cx,cy-r*0.62,cx,cy+r*0.6)
    for i in range(4):
        yy=cy+r*0.5-i*r*0.34
        c.line(cx,yy,cx-r*0.42,yy+r*0.18); c.line(cx,yy,cx+r*0.42,yy+r*0.18)
def ic_CR(cx,cy,r,col):
    _prep(cx,cy,r,col)
    c.setFillColor(white); c.ellipse(cx-r*0.42,cy-r*0.34,cx+r*0.42,cy+r*0.22,fill=1,stroke=0)
    c.circle(cx-r*0.55,cy+r*0.35,r*0.16,fill=1,stroke=0); c.circle(cx+r*0.55,cy+r*0.35,r*0.16,fill=1,stroke=0)
    for s in(-1,1):
        c.line(cx+s*r*0.3,cy-r*0.2,cx+s*r*0.6,cy-r*0.5)
        c.line(cx+s*r*0.15,cy-r*0.25,cx+s*r*0.4,cy-r*0.55)
def ic_HU(cx,cy,r,col):
    _prep(cx,cy,r,col); c.setFillColor(white)
    c.ellipse(cx-r*0.5,cy-r*0.25,cx-r*0.02,cy+r*0.55,fill=1,stroke=0)
    c.ellipse(cx-r*0.05,cy-r*0.55,cx+r*0.5,cy+r*0.3,fill=1,stroke=0)
def ic_PE(cx,cy,r,col):
    _prep(cx,cy,r,col); c.setFillColor(white)
    p=c.beginPath(); p.moveTo(cx-r*0.55,cy); p.curveTo(cx-r*0.2,cy+r*0.4,cx+r*0.35,cy+r*0.35,cx+r*0.55,cy)
    p.curveTo(cx+r*0.35,cy-r*0.35,cx-r*0.2,cy-r*0.4,cx-r*0.55,cy); c.drawPath(p,fill=1,stroke=0)
    c.setFillColor(col); c.circle(cx+r*0.28,cy+r*0.1,r*0.08,fill=1,stroke=0)
    c.setFillColor(white); p=c.beginPath(); p.moveTo(cx-r*0.5,cy); p.lineTo(cx-r*0.8,cy+r*0.28); p.lineTo(cx-r*0.8,cy-r*0.28); p.close(); c.drawPath(p,fill=1,stroke=0)
def ic_CA(cx,cy,r,col):
    _prep(cx,cy,r,col); c.setLineWidth(max(0.4,r*0.14))
    c.circle(cx,cy+r*0.28,r*0.3,fill=0,stroke=1); c.circle(cx,cy-r*0.28,r*0.34,fill=0,stroke=1)
def ic_SO(cx,cy,r,col):
    _prep(cx,cy,r,col); c.setFillColor(white)
    p=c.beginPath(); p.moveTo(cx-r*0.45,cy-r*0.45); p.curveTo(cx-r*0.6,cy+r*0.45,cx+r*0.4,cy+r*0.6,cx+r*0.5,cy-r*0.1)
    p.curveTo(cx+r*0.1,cy+r*0.1,cx-r*0.1,cy-r*0.2,cx-r*0.45,cy-r*0.45); c.drawPath(p,fill=1,stroke=0)
    c.setStrokeColor(col); c.setLineWidth(max(0.3,r*0.1)); c.line(cx-r*0.3,cy-r*0.3,cx+r*0.3,cy+r*0.35)
def ic_LA(cx,cy,r,col):
    _prep(cx,cy,r,col); c.setFillColor(white)
    p=c.beginPath(); p.moveTo(cx-r*0.34,cy+r*0.5); p.lineTo(cx+r*0.34,cy+r*0.5); p.lineTo(cx+r*0.26,cy-r*0.55)
    p.lineTo(cx-r*0.26,cy-r*0.55); p.close(); c.drawPath(p,fill=1,stroke=0)
    c.setStrokeColor(col); c.setLineWidth(max(0.3,r*0.1)); c.line(cx-r*0.3,cy+r*0.18,cx+r*0.32,cy+r*0.18)
def ic_FC(cx,cy,r,col):
    _prep(cx,cy,r,col); c.setFillColor(white)
    p=c.beginPath(); p.moveTo(cx,cy+r*0.55); p.curveTo(cx+r*0.5,cy+r*0.2,cx+r*0.45,cy-r*0.5,cx,cy-r*0.55)
    p.curveTo(cx-r*0.45,cy-r*0.5,cx-r*0.5,cy+r*0.2,cx,cy+r*0.55); c.drawPath(p,fill=1,stroke=0)
    c.setStrokeColor(col); c.setLineWidth(max(0.3,r*0.09)); c.line(cx,cy-r*0.4,cx,cy+r*0.4)
def ic_AP(cx,cy,r,col):
    _prep(cx,cy,r,col)
    for s in(-0.28,0,0.28): c.line(cx+s*r,cy-r*0.5,cx+s*r*0.4,cy+r*0.5)
    c.setFillColor(white); c.circle(cx-r*0.1,cy+r*0.5,r*0.12,fill=1,stroke=0); c.circle(cx+r*0.18,cy+r*0.52,r*0.12,fill=1,stroke=0)
def ic_MO(cx,cy,r,col):
    _prep(cx,cy,r,col); c.setFillColor(white)
    c.rect(cx-r*0.2,cy-r*0.5,r*0.4,r*0.8,fill=1,stroke=0)
    c.rect(cx-r*0.1,cy+r*0.3,r*0.2,r*0.25,fill=1,stroke=0)
def ic_SE(cx,cy,r,col):
    _prep(cx,cy,r,col); c.setFillColor(white)
    for dx,dy in [(-0.28,0.2),(0.28,0.2),(0,-0.28)]:
        c.ellipse(cx+dx*r-r*0.14,cy+dy*r-r*0.22,cx+dx*r+r*0.14,cy+dy*r+r*0.22,fill=1,stroke=0)
def ic_SU(cx,cy,r,col):
    _prep(cx,cy,r,col); c.setFillColor(white); c.setFont("Helvetica-Bold",r*0.9)
    c.drawCentredString(cx,cy-r*0.32,"E-X")
def ic_MC(cx,cy,r,col):
    _prep(cx,cy,r,col); c.setFillColor(white)
    p=c.beginPath(); p.moveTo(cx,cy-r*0.5); p.curveTo(cx-r*0.6,cy-r*0.3,cx-r*0.6,cy+r*0.4,cx,cy+r*0.5)
    p.curveTo(cx+r*0.6,cy+r*0.4,cx+r*0.6,cy-r*0.3,cx,cy-r*0.5); c.drawPath(p,fill=1,stroke=0)
    c.setStrokeColor(col); c.setLineWidth(max(0.3,r*0.09))
    for s in(-0.3,0,0.3): c.line(cx,cy-r*0.45,cx+s*r,cy+r*0.45)
def ic_AL(cx,cy,r,col):
    _prep(cx,cy,r,col); c.setFillColor(white)
    for dx,dy in [(-0.26,0.2),(0.28,0.28),(0.05,-0.28)]:
        c.circle(cx+dx*r,cy+dy*r,r*0.2,fill=1,stroke=0)
ICON={"GL":ic_GL,"CR":ic_CR,"HU":ic_HU,"PE":ic_PE,"CA":ic_CA,"SO":ic_SO,"LA":ic_LA,
      "FC":ic_FC,"AP":ic_AP,"MO":ic_MO,"SE":ic_SE,"SU":ic_SU,"MC":ic_MC,"AL":ic_AL}
def icon(code,cx,cy,r): ICON[code](cx,cy,r,ALG[code][1])

# ---------------- helpers ----------------
def ls_centered(cxc,y,text,font,size,cs,color):
    tw=c.stringWidth(text,font,size)+cs*(len(text)-1)
    t=c.beginText(cxc-tw/2,y); t.setFont(font,size); t.setFillColor(color); t.setCharSpace(cs); t.textOut(text); c.drawText(t)
    tr=c.beginText(0,-50); tr.setCharSpace(0); tr.textOut(" "); c.drawText(tr)
    return tw

def ctitle(y,title,sub=None):
    cs=2.0; f="Times-Bold"; sz=12.5
    tw=ls_centered(CXC,y,title.upper(),f,sz,cs,BROWN)
    ry=y+sz*0.30
    c.setStrokeColor(LINE); c.setLineWidth(0.7)
    c.line(X0,ry,CXC-tw/2-4*mm,ry); c.line(CXC+tw/2+4*mm,ry,X1,ry)
    for xx in (CXC-tw/2-4*mm,CXC+tw/2+4*mm):
        c.setFillColor(GOLD); c.rect(xx-0.7,ry-0.7,1.4,1.4,fill=1,stroke=0)
    y-=5.6*mm
    if sub:
        c.setFillColor(SOFT); c.setFont("Times-Italic",7.8); c.drawCentredString(CXC,y,sub); y-=4.2*mm
    return y

def leaders(x0,x1,y):
    c.setFillColor(LINE); step=1.8*mm; x=x0
    c.setFont("Helvetica",6)
    while x<x1:
        c.drawString(x,y,"."); x+=step

def item(y,name,price,algs):
    c.setFont("Helvetica",8.0); c.setFillColor(INK); c.drawString(X0,y,name)
    nw=c.stringWidth(name,"Helvetica",8.0)
    ptxt=("%.2f"%price).replace(".",",")+" €"
    c.setFont("Helvetica-Bold",8.0); pw=c.stringWidth(ptxt,"Helvetica-Bold",8.0)
    c.setFillColor(BROWN); c.drawRightString(X1,y,ptxt)
    r=1.75*mm; step=4.0*mm
    n=len(algs); cluster_right=X1-pw-3*mm; xs=cluster_right-n*step
    for i,a in enumerate(algs): icon(a,xs+i*step+r,y+0.9*mm,r)
    lx0=X0+nw+2.2*mm; lx1=(xs-2*mm) if n else (X1-pw-3*mm)
    if lx1-lx0>4*mm: leaders(lx0,lx1,y)
    return y-5.35*mm

import qrcode
QR_DATA = "https://siropetalavera.com"

def draw_qr(cx,cy,size):
    q=qrcode.QRCode(border=0,box_size=1,error_correction=qrcode.constants.ERROR_CORRECT_M)
    q.add_data(QR_DATA); q.make(fit=True)
    m=q.get_matrix(); n=len(m); cell=size/n
    x0=cx-size/2; y0=cy-size/2
    c.setFillColor(black)
    for i,row in enumerate(m):
        for j,v in enumerate(row):
            if v: c.rect(x0+j*cell,y0+(n-1-i)*cell,cell+0.15,cell+0.15,fill=1,stroke=0)

def wrap_words(text,sep,font,size,maxw):
    out=[]; cur=""
    for w in text.split(sep):
        t=(cur+sep+w) if cur else w
        if c.stringWidth(t,font,size)<=maxw: cur=t
        else:
            if cur: out.append(cur)
            cur=w
    if cur: out.append(cur)
    return out

def combo_item(y,text,price):
    ptxt=("%.2f"%price).replace(".",",")+" €"
    c.setFont("Helvetica-Bold",8.0); pw=c.stringWidth(ptxt,"Helvetica-Bold",8.0)
    lines=wrap_words(text," · ","Helvetica",8.0,(X1-X0)-pw-6*mm)
    c.setFillColor(BROWN); c.drawRightString(X1,y,ptxt)
    c.setFillColor(INK); c.setFont("Helvetica",8.0)
    for k,ln in enumerate(lines): c.drawString(X0,y-k*4.55*mm,ln)
    return y-(len(lines)-1)*4.55*mm-5.35*mm

# ================= CARAS (funciones) =================
from reportlab.lib.colors import Color

def face_cover(marks=True):
    IMGP="/sessions/nifty-nice-pascal/mnt/Holded/Sirope/portadacartasirope.png"
    _asp=1055/1491.0; _W=MW; _H=MW/_asp; _yimg=(MH-_H)/2.0
    c.drawImage(IMGP,0,_yimg,width=_W,height=_H,preserveAspectRatio=False,mask=None)
    c.setFillColor(Color(0.96,0.93,0.85,alpha=0.35))
    c.ellipse(CXC-52*mm,BLEED+PH-70*mm,CXC+52*mm,BLEED+PH-20*mm,fill=1,stroke=0)
    c.setFillColor(BROWN); c.setFont("Times-BoldItalic",66); c.drawCentredString(CXC,BLEED+PH-42*mm,"Sirope")
    c.setStrokeColor(GOLD); c.setLineWidth(1.3)
    p=c.beginPath(); p.moveTo(CXC-34*mm,BLEED+PH-48*mm); p.curveTo(CXC-10*mm,BLEED+PH-44.5*mm,CXC+10*mm,BLEED+PH-44.5*mm,CXC+34*mm,BLEED+PH-48*mm); c.drawPath(p,stroke=1,fill=0)
    ls_centered(CXC,BLEED+PH-57*mm,"CAFETERÍA","Times-Roman",11.5,4.0,INK)
    c.setFillColor(SOFT); c.setFont("Times-Italic",10); c.drawCentredString(CXC,BLEED+PH-64*mm,"Desayunos · Bollería · Meriendas")
    qs=17*mm; qx=BLEED+ML+2*mm+qs/2; qy=BLEED+23*mm
    c.setFillColor(Color(0,0,0,alpha=0.16)); c.roundRect(qx-qs/2-3*mm+0.8*mm,qy-qs/2-3*mm-0.8*mm,qs+6*mm,qs+9*mm,2.2*mm,fill=1,stroke=0)
    c.setFillColor(white); c.roundRect(qx-qs/2-3*mm,qy-qs/2-3*mm,qs+6*mm,qs+9*mm,2.2*mm,fill=1,stroke=0)
    draw_qr(qx,qy,qs)
    c.setFillColor(BROWN); c.setFont("Helvetica-Bold",6.0); c.drawCentredString(qx,qy-qs/2-2.4*mm,"siropetalavera.com")

def page(blocks, marks=True):
    bg()
    if marks: crop()
    y=TOP
    for b in blocks:
        if b[0]=="sec": y=ctitle(y,b[1],b[2] if len(b)>2 else None)
        elif b[0]=="gap": y-=b[1]
        elif b[0]=="combo": y=combo_item(y,b[1],b[2])
        else:
            for n,p,a in b[1]: y=item(y,n,p,a)
    return y

TEFRIO_STR="Limón · Frutos del bosque · Roibos tropical · Melocotón · Piña colada · Menta · Melón · Mojito"
BL_P2=[("sec","Desayunos","(Opción pan/mollete sin gluten · +1 €)"),("it",DESAYUNOS),("gap",2.6*mm),
       ("sec","Suplementos"),("it",SUPLEMENTOS),("gap",2.6*mm),
       ("sec","Café"),("it",CAFE),("gap",2.6*mm),
       ("sec","Infusiones"),("it",INFUSIONES),("gap",2.6*mm),
       ("sec","Té frío"),("combo",TEFRIO_STR,2.40)]
BL_P3=[("sec","Bollería"),("it",BOLLERIA),("gap",2.6*mm),
       ("sec","Croissant y Sándwich"),("it",CRSAND)]
BL_P4=[("sec","Tostada o Mollete","(Opción pan/mollete sin gluten · +1 €)"),("it",TOSTADA),("gap",2.4*mm),
       ("sec","Bebidas"),("it",BEBIDAS),("gap",2.4*mm),
       ("sec","Licores"),("it",LICORES)]

def draw_legend(y):
    short={"GL":"Gluten","CR":"Crustáceos","HU":"Huevos","PE":"Pescado","CA":"Cacahuetes","SO":"Soja","LA":"Lácteos","FC":"Frutos cáscara","AP":"Apio","MO":"Mostaza","SE":"Sésamo","SU":"Sulfitos","MC":"Moluscos","AL":"Altramuces"}
    y-=1*mm; y=ctitle(y,"Alérgenos")
    codes=list(ALG.keys()); ncol=7; cw=(X1-X0)/ncol; r=1.7*mm
    for k,code in enumerate(codes):
        col=k%ncol; rowi=k//ncol; xx=X0+col*cw; yy=y-rowi*6.0*mm
        icon(code,xx+r,yy-0.4*mm,r)
        c.setFillColor(INK); c.setFont("Helvetica",5.4); c.drawString(xx+2*r+0.8*mm,yy-1.2*mm,short[code])
    y=y-2*6.0*mm-1*mm
    c.setStrokeColor(LINE); c.setLineWidth(0.5); c.line(X0,y,X1,y); y-=3.6*mm
    c.setFillColor(SOFT); c.setFont("Times-Italic",6.0)
    c.drawCentredString(CXC,y,"Información de alérgenos conforme al Reglamento (UE) 1169/2011. Consulte al personal para cualquier duda.")

def draw_sg_banner():
    msg="Opción de pan y mollete sin gluten  ·  +1 €"
    c.setFont("Times-Bold",8.5); tw=c.stringWidth(msg,"Times-Bold",8.5); pad=5*mm
    yb=BLEED+15*mm
    c.setFillColor(GREEN); c.roundRect(CXC-tw/2-pad,yb-3*mm,tw+2*pad,7*mm,2.2*mm,fill=1,stroke=0)
    c.setFillColor(white); c.setFont("Times-Bold",8.5); c.drawCentredString(CXC,yb-0.6*mm,msg)

def face_p2(marks=True):
    page(BL_P2, marks); draw_sg_banner()
def face_p3(marks=True):
    y=page(BL_P3, marks); draw_legend(y)
def face_p4(marks=True): page(BL_P4, marks)

# ---------- SALIDA 1: caras A5 sueltas (trim + sangre + marcas) ----------
face_cover(); crop(); c.showPage()
face_p2(); c.showPage()
face_p3(); c.showPage()
face_p4(); c.showPage()
c.save()

# ---------- SALIDA 2: PLIEGO A4 impuesto (2 caras, doble cara + plegado) ----------
SMW,SMH = 2*PW+2*BLEED, PH+2*BLEED      # media hoja = 302 x 216 mm
FOLD = BLEED+PW                          # linea de pliegue
c = canvas.Canvas("/sessions/nifty-nice-pascal/mnt/outputs/Carta_Sirope_PLIEGO.pdf", pagesize=(SMW,SMH))

def place(face_fn, left):
    c.saveState()
    cp=c.beginPath()
    if left: cp.rect(0,0,FOLD,SMH)
    else:    cp.rect(FOLD,0,SMW-FOLD,SMH)
    c.clipPath(cp,stroke=0,fill=0)
    if not left: c.translate(PW,0)
    face_fn(marks=False)
    c.restoreState()

def sheet_marks():
    c.setStrokeColor(black); c.setLineWidth(0.3); L=3*mm
    for x,y,dx,dy in [(BLEED,BLEED,-1,0),(BLEED,BLEED,0,-1),(SMW-BLEED,BLEED,1,0),(SMW-BLEED,BLEED,0,-1),
                      (BLEED,SMH-BLEED,-1,0),(BLEED,SMH-BLEED,0,1),(SMW-BLEED,SMH-BLEED,1,0),(SMW-BLEED,SMH-BLEED,0,1)]:
        c.line(x,y,x+dx*L,y+dy*L)
    c.setDash(1,2); c.setLineWidth(0.4)
    c.line(FOLD,SMH-BLEED,FOLD,SMH); c.line(FOLD,0,FOLD,BLEED); c.setDash()

# Exterior: [Contra | Portada]
place(face_p4, True); place(face_cover, False); sheet_marks(); c.showPage()
# Interior: [Interior izq | Interior der]
place(face_p2, True); place(face_p3, False); sheet_marks(); c.showPage()
c.save()
print("OK A5 + PLIEGO")
