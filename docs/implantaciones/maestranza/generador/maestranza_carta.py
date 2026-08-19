# -*- coding: utf-8 -*-
import math
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white, black, Color

# ---- Paleta Mi Piace / La Maestranza ----
BG    = HexColor("#FBF7F1")
INK   = HexColor("#26221E")
CORAL = HexColor("#E97058")
CORALD= HexColor("#C75A45")
MUTED = HexColor("#8A8078")
LINE  = HexColor("#E1D6C6")

# ---- 14 alergenos (codigo -> (nombre, color)) ----
ALG = {
 "GL":("Gluten",        HexColor("#C9843F")),
 "CR":("Crustáceos",    HexColor("#4E86C6")),
 "HU":("Huevo",         HexColor("#E0A83E")),
 "PE":("Pescado",       HexColor("#3D6BA3")),
 "CA":("Cacahuetes",    HexColor("#B08968")),
 "SO":("Soja",          HexColor("#4E9B5E")),
 "LA":("Lácteos",       HexColor("#7E6551")),
 "FC":("Frutos de cáscara", HexColor("#9B5B6B")),
 "AP":("Apio",          HexColor("#7DA845")),
 "MO":("Mostaza",       HexColor("#C4A24B")),
 "SE":("Sésamo",        HexColor("#9E9284")),
 "SU":("Sulfitos",      HexColor("#8A5A7A")),
 "MC":("Moluscos",      HexColor("#6FA0C8")),
 "AL":("Altramuces",    HexColor("#D9B24A")),
}

BLEED=3*mm; PW,PH=210*mm,297*mm; MW,MH=PW+2*BLEED,PH+2*BLEED
ML=18*mm; MR=18*mm; X0=BLEED+ML; X1=BLEED+PW-MR
TOP=BLEED+PH-16*mm; CXC=BLEED+PW/2
EMB="/tmp/Logo_La_Maestranza_FINAL.png"

c=canvas.Canvas("/tmp/Cartas_La_Maestranza_ICONOS.pdf",pagesize=(MW,MH))

def bg():
    c.setFillColor(BG); c.rect(0,0,MW,MH,fill=1,stroke=0)
    c.setStrokeColor(LINE); c.setLineWidth(0.8)
    c.roundRect(BLEED+7*mm,BLEED+7*mm,PW-14*mm,PH-14*mm,3*mm,fill=0,stroke=1)
def crop():
    c.setStrokeColor(black); c.setLineWidth(0.3); L=3*mm
    for x,y,dx,dy in [(BLEED,BLEED,-1,0),(BLEED,BLEED,0,-1),(BLEED+PW,BLEED,1,0),(BLEED+PW,BLEED,0,-1),
                      (BLEED,BLEED+PH,-1,0),(BLEED,BLEED+PH,0,1),(BLEED+PW,BLEED+PH,1,0),(BLEED+PW,BLEED+PH,0,1)]:
        c.line(x,y,x+dx*L,y+dy*L)

# ---------------- pictogramas ----------------
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
    _prep(cx,cy,r,col); c.setFillColor(white)
    c.ellipse(cx-r*0.42,cy-r*0.34,cx+r*0.42,cy+r*0.22,fill=1,stroke=0)
    c.circle(cx-r*0.55,cy+r*0.35,r*0.16,fill=1,stroke=0); c.circle(cx+r*0.55,cy+r*0.35,r*0.16,fill=1,stroke=0)
    for s in(-1,1):
        c.line(cx+s*r*0.3,cy-r*0.2,cx+s*r*0.6,cy-r*0.5); c.line(cx+s*r*0.15,cy-r*0.25,cx+s*r*0.4,cy-r*0.55)
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
    c.rect(cx-r*0.2,cy-r*0.5,r*0.4,r*0.8,fill=1,stroke=0); c.rect(cx-r*0.1,cy+r*0.3,r*0.2,r*0.25,fill=1,stroke=0)
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

# ---------------- layout helpers ----------------
def header(cartatype):
    es=42*mm
    c.drawImage(EMB, CXC-es/2, TOP-es+2*mm, width=es, height=es, mask='auto')
    y=TOP-es-2*mm
    c.setFillColor(INK); c.setFont("Helvetica",13); 
    t=cartatype.upper(); 
    # letterspacing
    cs=3.2; tw=c.stringWidth(t,"Helvetica",13)+cs*(len(t)-1)
    tt=c.beginText(CXC-tw/2,y); tt.setFont("Helvetica",13); tt.setCharSpace(cs); tt.setFillColor(INK); tt.textOut(t); c.drawText(tt)
    return y-9*mm

def section(y,title,price=None):
    c.setFillColor(CORALD); c.setFont("Helvetica-Bold",11.5)
    t=title.upper(); cs=1.6
    tt=c.beginText(X0,y); tt.setFont("Helvetica-Bold",11.5); tt.setCharSpace(cs); tt.setFillColor(CORALD); tt.textOut(t); c.drawText(tt)
    tw=c.stringWidth(t,"Helvetica-Bold",11.5)+cs*(len(t)-1)
    px=X0+tw+4*mm
    if price:
        c.setFont("Helvetica-Bold",9.5); c.setFillColor(CORALD); c.drawString(px,y,price)
        px+=c.stringWidth(price,"Helvetica-Bold",9.5)+5*mm
    c.setStrokeColor(LINE); c.setLineWidth(0.8); c.line(px,y+1.2*mm,X1,y+1.2*mm)
    return y-7.2*mm

def leaders(x0,x1,y):
    if x1-x0<5*mm: return
    c.setFillColor(LINE); c.setFont("Helvetica",6.5); x=x0; step=1.9*mm
    while x<x1: c.drawString(x,y,"."); x+=step

def item(y,name,price,algs,x0=X0,x1=X1,fs=10):
    c.setFont("Helvetica",fs); c.setFillColor(INK); c.drawString(x0,y,name)
    nw=c.stringWidth(name,"Helvetica",fs)
    pw=0
    if price is not None:
        ptxt=("%.2f"%price).replace(".",",")+" €"
        c.setFont("Helvetica-Bold",fs); pw=c.stringWidth(ptxt,"Helvetica-Bold",fs)
        c.setFillColor(CORALD); c.drawRightString(x1,y,ptxt)
    r=1.7*mm; step=4.0*mm; n=len(algs)
    cluster_right=x1-pw-(3*mm if price is not None else 0)
    xs=cluster_right-n*step
    for i,a in enumerate(algs): icon(a,xs+i*step+r,y+1.0*mm,r)
    lx0=x0+nw+2.2*mm; lx1=(xs-1.5*mm) if n else cluster_right
    leaders(lx0,lx1,y)
    return y-7.0*mm

def legend(y):
    c.setStrokeColor(LINE); c.setLineWidth(0.7); c.line(X0,y,X1,y); y-=5*mm
    c.setFillColor(CORALD); c.setFont("Helvetica-Bold",9); 
    tt=c.beginText(X0,y); tt.setFont("Helvetica-Bold",9); tt.setCharSpace(1.2); tt.setFillColor(CORALD); tt.textOut("ALÉRGENOS"); c.drawText(tt)
    y-=5.6*mm
    codes=list(ALG.keys()); ncol=5; cw=(X1-X0)/ncol; r=1.7*mm
    for k,code in enumerate(codes):
        col=k%ncol; row=k//ncol; xx=X0+col*cw; yy=y-row*5.6*mm
        icon(code,xx+r,yy,r)
        c.setFillColor(INK); c.setFont("Helvetica",6.6); c.drawString(xx+2*r+1.2*mm,yy-1.0*mm,ALG[code][0])
    y=y-3*5.6*mm
    c.setFillColor(MUTED); c.setFont("Helvetica-Oblique",6.2)
    c.drawString(X0,y,"Información de alérgenos conforme al Reglamento (UE) 1169/2011. Consulta al personal cualquier duda.")
    return y

def footer(txt):
    c.setFillColor(MUTED); c.setFont("Helvetica",7.5)
    cs=1.4; tw=c.stringWidth(txt,"Helvetica",7.5)+cs*(len(txt)-1)
    tt=c.beginText(CXC-tw/2,BLEED+9.5*mm); tt.setFont("Helvetica",7.5); tt.setCharSpace(cs); tt.setFillColor(MUTED); tt.textOut(txt); c.drawText(tt)

# ---------------- CONTENIDO ----------------
DES_CAFE=[("Café con leche",1.60,["LA"]),("Café solo",1.60,[]),("Cortado",1.60,["LA"]),
 ("Café bombón",2.00,["LA"]),("Carajillo",3.00,["SU"]),("Café para llevar",1.90,["LA"]),
 ("Cola Cao",2.00,["LA"]),("Infusión (manzanilla, poleo, tila…)",1.60,[]),("Vaso de leche",2.00,["LA"])]
DES_TOST=[("Tomate y aceite",2.50,["GL"]),("Mermelada y mantequilla",1.50,["GL","LA"]),
 ("Jamón curado y tomate",2.50,["GL"]),("York y queso",2.50,["GL","LA"]),("Jamón ibérico",7.00,["GL"])]
DES_BOLL=[("Croissant",2.50,["GL","HU","LA"]),("Croissant mermelada y mantequilla",2.50,["GL","HU","LA"]),
 ("Croissant york y queso",3.00,["GL","HU","LA"]),("Napolitana de chocolate",2.50,["GL","HU","LA","SO"]),
 ("Napolitana de crema",2.50,["GL","HU","LA"]),("Dónut",1.50,["GL","HU","LA","SO"]),("Pincho de tortilla",3.00,["GL","HU"])]

RAC=[("Ensaladilla rusa",7.00,["HU","PE"]),("Patatas alioli",8.00,["HU"]),("Croquetas",10.00,["GL","HU","LA"]),
 ("Patatas bravas",10.00,["GL"]),("Alitas de pollo",10.00,["GL"]),("Fingers de pollo",10.00,["GL","HU"]),
 ("Magro con tomate",10.00,[]),("Torrezno",10.00,[]),("Torrezno especial",15.00,[]),
 ("Calamares",12.00,["GL","MC"]),("Chopitos",12.00,["GL","MC"]),("Queso curado",12.00,["LA"]),
 ("Jamón serrano",12.00,[]),("Gambas al ajillo",14.00,["CR"])]
BOCA=[("Lomo con queso",["GL","LA"]),("Filete de ternera",["GL"]),("Tortilla de patatas",["GL","HU"]),
 ("Tortilla francesa",["GL","HU"]),("Lomo con pimientos",["GL"]),("Bacon con queso",["GL","LA"]),
 ("Anchoas con tomate",["GL","PE"]),("Atún con tomate",["GL","PE"]),("Filete de pollo",["GL"]),
 ("Salchichón",["GL"]),("Chorizo de pavo",["GL"]),("Queso",["GL","LA"]),("Caballa",["GL","PE"]),("Calamares",["GL","MC"])]
HAMB=[("Hamburguesa",5.00,["GL","LA"]),("Hamburguesa especial",7.00,["GL","HU","LA"]),
 ("Sándwich mixto",2.50,["GL","LA"]),("Sándwich mixto con huevo",3.50,["GL","HU","LA"]),("Sándwich vegetal",5.00,["GL","HU"])]
COMB=[("Filete de ternera",["HU"]),("Filete de pollo",["HU"]),("Filete de lomo",["HU"]),("Chuleta de cerdo",["HU"]),("Chuleta de ternera",["HU"])]

# ===== P1 Desayunos =====
bg(); crop()
y=header("Desayunos")
y=section(y,"Cafés e infusiones")
for n,p,a in DES_CAFE: y=item(y,n,p,a)
y-=4*mm; y=section(y,"Tostadas")
for n,p,a in DES_TOST: y=item(y,n,p,a)
y-=4*mm; y=section(y,"Bollería")
for n,p,a in DES_BOLL: y=item(y,n,p,a)
legend(BLEED+50*mm); footer("BUENOS DÍAS · LA MAESTRANZA · IVA INCLUIDO")
c.showPage()

# ===== P2 Para compartir (Raciones + Bocadillos 2 col) =====
bg(); crop()
y=header("Para compartir")
y=section(y,"Raciones")
for n,p,a in RAC: y=item(y,n,p,a)
y-=4*mm; y=section(y,"Bocadillos","5,00 · especial 7,00")
# 2 columnas de nombres con iconos (sin precio)
half=(len(BOCA)+1)//2
midgap=8*mm; colw=(X1-X0-midgap)/2
xL0,xL1=X0,X0+colw; xR0,xR1=X0+colw+midgap,X1
yy=y
for n,a in BOCA[:half]: yy=item(yy,n,None,a,x0=xL0,x1=xL1)
yy2=y
for n,a in BOCA[half:]: yy2=item(yy2,n,None,a,x0=xR0,x1=xR1)
legend(BLEED+50*mm); footer("BUEN PROVECHO · LA MAESTRANZA · IVA INCLUIDO")
c.showPage()

# ===== P3 Comida dorso =====
bg(); crop()
y=header("Bocadillos calientes y platos")
y=section(y,"Hamburguesas y sándwiches")
for n,p,a in HAMB: y=item(y,n,p,a)
y-=4*mm; y=section(y,"Platos combinados","10,00 · ternera 12,00")
c.setFillColor(MUTED); c.setFont("Helvetica-Oblique",8.5); c.drawString(X0,y,"Todos con patatas y huevo"); y-=6*mm
for n,a in COMB: y=item(y,n,None,a)
legend(BLEED+50*mm); footer("BUEN PROVECHO · LA MAESTRANZA · IVA INCLUIDO")
c.showPage()
c.save()
print("PDF OK")
