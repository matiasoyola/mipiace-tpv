# -*- coding: utf-8 -*-
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib.colors import Color, HexColor, white, black
import os

# ---------- Paleta Sirope ----------
BG    = HexColor("#F4EFDF")   # crema
CARD  = HexColor("#FBF8EE")
INK   = HexColor("#43301B")   # marron oscuro texto
BROWN = HexColor("#6E4B27")   # marron titulos
GOLD  = HexColor("#A9793B")
LINE  = HexColor("#C9B48D")

# ---------- 14 alergenos (codigo -> (nombre, color)) ----------
ALG = {
 "GL":("Contiene gluten",        HexColor("#B98B5E")),
 "CR":("Crustáceos",             HexColor("#4E86C6")),
 "HU":("Huevos",                 HexColor("#D4A24E")),
 "PE":("Pescado",                HexColor("#3D6BA3")),
 "CA":("Cacahuetes",             HexColor("#A89A86")),
 "SO":("Soja",                   HexColor("#3E9B6C")),
 "LA":("Lácteos",                HexColor("#6E5140")),
 "FC":("Frutos de cáscara",      HexColor("#9B5B6B")),
 "AP":("Apio",                   HexColor("#8FBF3F")),
 "MO":("Mostaza",                HexColor("#B7A66B")),
 "SE":("Granos de sésamo",       HexColor("#9E9E9E")),
 "SU":("Dióxido de azufre y sulfitos", HexColor("#7A3F63")),
 "MC":("Moluscos",               HexColor("#7FB0DE")),
 "AL":("Altramuces",             HexColor("#E4E08A")),
}

# ---------- Contenido (nombre, precio, [alergenos]) ----------
DESAYUNOS = [
 ("1 · Café + Tostada mantequilla y mermelada", 2.90, ["GL","LA"]),
 ("2 · Café + Tostada tomate y aceite", 2.90, ["GL"]),
 ("3 · Café + Croissant", 2.80, ["GL","LA","HU"]),
 ("4 · Café + Croissant a la plancha", 3.00, ["GL","LA","HU"]),
 ("5 · Café + Croissant o sándwich mixto", 3.90, ["GL","LA","HU"]),
 ("6 · Cola Cao + Tostada mantequilla y mermelada", 3.10, ["GL","LA"]),
 ("7 · Cola Cao + Tostada tomate y aceite", 3.10, ["GL","LA"]),
 ("8 · Cola Cao + Croissant", 2.90, ["GL","LA","HU"]),
 ("9 · Cola Cao + Croissant a la plancha", 3.20, ["GL","LA","HU"]),
 ("10 · Cola Cao + Croissant o sándwich mixto", 4.20, ["GL","LA","HU"]),
]
SUPLEMENTOS = [
 ("Tarrina de mermelada", 0.30, []),
 ("Tarrina de mantequilla", 0.30, ["LA"]),
 ("Tarrina de tomate", 0.30, []),
 ("Tarrina de aceite", 0.30, []),
]
CAFE = [
 ("Solo", 1.50, []),("Con leche", 1.50, ["LA"]),("Cortado", 1.50, ["LA"]),
 ("Americano", 1.50, []),("Bombón", 2.00, ["LA"]),("Capuccino", 1.90, ["LA"]),
 ("Carajillo", 2.00, ["SU"]),("Vaso de leche", 1.50, ["LA"]),
 ("Cola Cao / Nesquik", 1.70, ["LA"]),("Chocolate", 2.40, ["LA"]),
]
INFUSIONES = [
 ("Manzanilla · Poleo menta · Tila · Té verde · Té rojo", 1.50, []),
]
TEFRIO = [
 ("Limón · Frutos del bosque · Roibos tropical · Melocotón", 2.40, []),
 ("Piña colada · Menta · Melón · Mojito", 2.40, []),
]
BOLLERIA = [
 ("Croissant", 1.70, ["GL","LA","HU"]),
 ("Croissant nutella", 2.50, ["GL","LA","HU","FC","SO"]),
 ("Tortitas con sirope o nutella", 2.70, ["GL","LA","HU","FC","SO"]),
 ("Tortitas con nata", 2.70, ["GL","LA","HU"]),
 ("Tortitas con sirope y nata", 3.00, ["GL","LA","HU"]),
 ("Tortitas con sirope y helado", 3.00, ["GL","LA","HU"]),
 ("Tortitas con sirope, nata y helado", 3.50, ["GL","LA","HU"]),
 ("Goffre con sirope o nutella", 3.70, ["GL","LA","HU","FC","SO"]),
 ("Goffre con nata", 3.70, ["GL","LA","HU"]),
 ("Goffre con sirope y nata", 4.00, ["GL","LA","HU"]),
 ("Goffre con sirope y helado", 4.00, ["GL","LA","HU"]),
 ("Goffre con sirope, nata y helado", 4.50, ["GL","LA","HU"]),
 ("Donut Glace", 1.50, ["GL","LA","HU","SO"]),
 ("Donut Chocolate", 1.60, ["GL","LA","HU","SO"]),
 ("Napolitana", 1.90, ["GL","LA","HU"]),
 ("Porción bizcocho", 2.90, ["GL","LA","HU"]),
 ("Porción Tarta", 3.60, ["GL","LA","HU","FC"]),
 ("Palmera chocolate pequeña", 1.40, ["GL","LA","HU","SO"]),
 ("Palmera grande", 2.80, ["GL","LA","HU","SO"]),
]
TOSTADA = [
 ("Mermelada y mantequilla", 1.90, ["GL","LA"]),
 ("Tomate y aceite", 1.90, ["GL"]),
 ("Serrano con tomate", 3.10, ["GL"]),
 ("Ibérico con tomate", 4.20, ["GL"]),
 ("York y queso", 3.00, ["GL","LA"]),
 ("Atún, tomate y mahonesa", 3.10, ["GL","HU","PE"]),
 ("Guacamole", 3.40, ["GL"]),
 ("Guacamole con salmón", 4.60, ["GL","PE"]),
 ("Guacamole con jamón ibérico", 4.60, ["GL"]),
 ("Salmón y alioli", 4.20, ["GL","HU","PE"]),
]
CRSAND = [
 ("Croissant plancha", 1.90, ["GL","LA","HU"]),
 ("Croissant mixto", 3.00, ["GL","LA","HU"]),
 ("Sándwich mixto", 3.00, ["GL","LA"]),
 ("Sándwich vegetal", 3.10, ["GL","HU"]),
 ("Sándwich vegetal con atún", 3.40, ["GL","HU","PE"]),
]
BEBIDAS = [
 ("Refrescos", 2.50, []),("Zumos", 2.50, []),("Agua mineral", 1.00, []),
 ("Tinto de verano", 2.50, ["SU"]),("Botellín", 1.50, ["GL"]),
 ("Tercio", 2.50, ["GL"]),("Cerveza 1906", 2.90, ["GL"]),
 ("Alhambra", 2.90, ["GL"]),("Botellín sin gluten", 1.70, []),
 ("Batido chocolate", 2.50, ["LA"]),
]
LICORES = [
 ("Martini", 3.00, ["SU"]),("Baileys", 3.50, ["LA"]),
 ("Copa licor", 2.90, ["SU"]),("Chupitos", 1.60, []),
 ("Combinados", 5.00, []),("Copa Whisky", 3.60, []),
 ("Copa Soberano", 2.50, []),("Copa Castellana", 2.50, ["SU"]),
]

# ---------- Geometria ----------
BLEED = 3*mm
PW, PH = 148*mm, 210*mm
MW, MH = PW + 2*BLEED, PH + 2*BLEED     # media (con sangre)
ML = 12*mm            # margen interno izq
MR = 12*mm
X0 = BLEED + ML
X1 = BLEED + PW - MR
TOP = BLEED + PH - 13*mm
BOT = BLEED + 12*mm

c = canvas.Canvas("/sessions/nifty-nice-pascal/mnt/outputs/Carta_Sirope_imprenta.pdf", pagesize=(MW, MH))

def bg():
    c.setFillColor(BG); c.rect(0,0,MW,MH,fill=1,stroke=0)

def crop_marks():
    c.setStrokeColor(black); c.setLineWidth(0.3)
    m=BLEED; L=3*mm
    for (x,y,dx,dy) in [(BLEED,BLEED,-1,0),(BLEED,BLEED,0,-1),
                        (BLEED+PW,BLEED,1,0),(BLEED+PW,BLEED,0,-1),
                        (BLEED,BLEED+PH,-1,0),(BLEED,BLEED+PH,0,1),
                        (BLEED+PW,BLEED+PH,1,0),(BLEED+PW,BLEED+PH,0,1)]:
        c.line(x,y,x+dx*L,y+dy*L)

def dot(x,y,code,d=3.3*mm):
    name,col=ALG[code]
    c.setFillColor(col); c.circle(x+d/2,y+d/2,d/2,fill=1,stroke=0)
    c.setFillColor(white); c.setFont("Helvetica-Bold",4.1)
    c.drawCentredString(x+d/2, y+d/2-1.45, code)
    return d

def section(y, title, sub=None):
    c.setFillColor(BROWN); c.setFont("Times-Bold",13.5)
    c.drawString(X0,y,title.upper())
    # filete
    c.setStrokeColor(LINE); c.setLineWidth(0.6)
    tw=c.stringWidth(title.upper(),"Times-Bold",13.5)
    c.line(X0,y-2.2,X1,y-2.2)
    y-=5.2*mm
    if sub:
        c.setFillColor(GOLD); c.setFont("Times-Italic",7.6)
        c.drawString(X0,y,sub); y-=4.0*mm
    return y

def item(y, name, price, algs):
    c.setFillColor(INK); c.setFont("Helvetica",7.8)
    c.drawString(X0,y,name)
    nw=c.stringWidth(name,"Helvetica",7.8)
    # precio derecha
    ptxt=("%.2f" % price).replace(".",",")+" €"
    c.setFont("Helvetica-Bold",7.8); c.setFillColor(BROWN)
    c.drawRightString(X1,y,ptxt)
    pw=c.stringWidth(ptxt,"Helvetica-Bold",7.8)
    # alergenos entre nombre y precio
    dx=X0+nw+2.5*mm
    yy=y-0.9*mm
    for a in algs:
        if dx+3.3*mm > X1-pw-2*mm: break
        dot(dx,yy,a); dx+=3.7*mm
    return y-5.15*mm

def cup(cx,cy,s):
    c.setStrokeColor(BROWN); c.setLineWidth(1.6); c.setFillColor(BG)
    c.ellipse(cx-6*s,cy-2*s,cx+6*s,cy+2.4*s,fill=0,stroke=1)     # taza (borde)
    c.rect(cx-5*s,cy-4.5*s,10*s,3.2*s,fill=0,stroke=1)
    c.arc(cx+4*s,cy-4.6*s,cx+8.5*s,cy-1.0*s,startAng=-90,extent=180) # asa
    # vapor
    c.setLineWidth(1.2)
    for off in (-2.2,0.4,3.0):
        c.bezier(cx+off*s,cy+3.2*s, cx+(off-1.4)*s,cy+5.2*s, cx+(off+1.4)*s,cy+6.4*s, cx+off*s,cy+8.4*s)

def qr(cx,cy,s=15*mm):
    import random; random.seed(7)
    n=9; cell=s/n
    c.setFillColor(INK)
    c.rect(cx-s/2,cy-s/2,s,s,fill=0,stroke=1)
    for i in range(n):
        for j in range(n):
            if (i<3 and j<3) or (i<3 and j>n-4) or (i>n-4 and j<3) or random.random()<0.5:
                c.rect(cx-s/2+i*cell, cy-s/2+j*cell, cell, cell, fill=1, stroke=0)

# ===================== PAGINA 1 · PORTADA =====================
bg(); crop_marks()
c.setStrokeColor(LINE); c.setLineWidth(0.8)
c.rect(BLEED+8*mm, BLEED+8*mm, PW-16*mm, PH-16*mm, fill=0, stroke=1)
cup(BLEED+PW/2, BLEED+PH-46*mm, 2.4)
c.setFillColor(BROWN); c.setFont("Times-BoldItalic",62)
c.drawCentredString(BLEED+PW/2, BLEED+PH-92*mm, "Sirope")
c.setStrokeColor(GOLD); c.setLineWidth(1); c.line(BLEED+PW/2-30*mm,BLEED+PH-98*mm,BLEED+PW/2+30*mm,BLEED+PH-98*mm)
c.setFillColor(INK); c.setFont("Times-Roman",12)
c.drawCentredString(BLEED+PW/2, BLEED+PH-108*mm, "C A F É T E R Í A")
c.setFont("Times-Italic",10.5)
c.drawCentredString(BLEED+PW/2, BLEED+PH-116*mm, "Desayunos · Bollería · Meriendas")
qr(BLEED+PW/2, BLEED+40*mm, 22*mm)
c.setFillColor(GOLD); c.setFont("Times-Italic",8.5)
c.drawCentredString(BLEED+PW/2, BLEED+24*mm, "Escanea nuestra carta")
c.showPage()

# ===================== PAGINA 2 · INTERIOR IZQ =====================
bg(); crop_marks()
y=TOP
y=section(y,"Desayunos","(Opción Mollete sin gluten)")
for n,p,a in DESAYUNOS: y=item(y,n,p,a)
y-=2.4*mm
y=section(y,"Suplementos")
for n,p,a in SUPLEMENTOS: y=item(y,n,p,a)
y-=2.4*mm
y=section(y,"Café")
for n,p,a in CAFE: y=item(y,n,p,a)
y-=2.4*mm
y=section(y,"Infusiones")
for n,p,a in INFUSIONES: y=item(y,n,p,a)
y-=2.4*mm
y=section(y,"Té frío")
for n,p,a in TEFRIO: y=item(y,n,p,a)
c.showPage()

# ===================== PAGINA 3 · INTERIOR DER =====================
bg(); crop_marks()
y=TOP
y=section(y,"Bollería")
for n,p,a in BOLLERIA: y=item(y,n,p,a)
y-=2.6*mm
y=section(y,"Tostada o Mollete","(Opción Mollete sin gluten)")
for n,p,a in TOSTADA: y=item(y,n,p,a)
c.showPage()

# ===================== PAGINA 4 · CONTRA =====================
bg(); crop_marks()
y=TOP
y=section(y,"Croissant y Sándwich")
for n,p,a in CRSAND: y=item(y,n,p,a)
y-=2.4*mm
y=section(y,"Bebidas")
for n,p,a in BEBIDAS: y=item(y,n,p,a)
y-=2.4*mm
y=section(y,"Licores")
for n,p,a in LICORES: y=item(y,n,p,a)

# ---- Leyenda alergenos ----
y-=3*mm
c.setStrokeColor(LINE); c.setLineWidth(0.6); c.line(X0,y,X1,y); y-=5*mm
c.setFillColor(BROWN); c.setFont("Times-Bold",10); c.drawString(X0,y,"ALÉRGENOS"); y-=5.2*mm
codes=list(ALG.keys())
colw=(X1-X0)/2
for i,code in enumerate(codes):
    col=i%2; row=i//2
    xx=X0+col*colw
    yy=y-row*4.9*mm
    dot(xx,yy-1.2*mm,code,d=3.3*mm)
    c.setFillColor(INK); c.setFont("Helvetica",6.6)
    c.drawString(xx+4.4*mm, yy-0.4*mm, ALG[code][0])
y=y-7*4.9*mm-3*mm
c.setFillColor(GOLD); c.setFont("Times-Italic",6.2)
c.drawString(X0,y,"Información de alérgenos conforme al Reglamento (UE) 1169/2011. Consulte al personal cualquier duda.")
c.showPage()
c.save()
print("PDF OK ->", os.path.getsize("/sessions/nifty-nice-pascal/mnt/outputs/Carta_Sirope_imprenta.pdf"), "bytes")
