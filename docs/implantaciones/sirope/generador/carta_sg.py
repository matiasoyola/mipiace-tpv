# -*- coding: utf-8 -*-
import math
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white, black, Color

BG=HexColor("#F3EEDC"); INK=HexColor("#3E2C19"); BROWN=HexColor("#6E4B27")
GOLD=HexColor("#A9793B"); LINE=HexColor("#C6AF82"); SOFT=HexColor("#8A6B45")
GREEN=HexColor("#4E7A3A")
ALG={
 "GL":("Contiene gluten",HexColor("#B98B5E")),"CR":("Crustáceos",HexColor("#4E86C6")),
 "HU":("Huevos",HexColor("#D4A24E")),"PE":("Pescado",HexColor("#3D6BA3")),
 "CA":("Cacahuetes",HexColor("#A89A86")),"SO":("Soja",HexColor("#3E9B6C")),
 "LA":("Lácteos",HexColor("#6E5140")),"FC":("Frutos de cáscara",HexColor("#9B5B6B")),
 "AP":("Apio",HexColor("#8FBF3F")),"MO":("Mostaza",HexColor("#B7A66B")),
 "SE":("Granos de sésamo",HexColor("#9E9E9E")),"SU":("Dióxido de azufre y sulfitos",HexColor("#7A3F63")),
 "MC":("Moluscos",HexColor("#7FB0DE")),"AL":("Altramuces",HexColor("#E4E08A")),
}
BLEED=3*mm; PW,PH=148*mm,210*mm; MW,MH=PW+2*BLEED,PH+2*BLEED
ML=14*mm; MR=14*mm; X0=BLEED+ML; X1=BLEED+PW-MR
TOP=BLEED+PH-16*mm; BOT=BLEED+12*mm; CXC=BLEED+PW/2
c=canvas.Canvas("/sessions/nifty-nice-pascal/mnt/outputs/Carta_Sirope_SIN_GLUTEN.pdf",pagesize=(MW,MH))

# reutilizar helpers e iconos de carta2.py (sin re-render de la carta general)
src=open('carta2.py').read()
a=src.index("def bg():"); b=src.index("# ================= P1 PORTADA")
exec(src[a:b])

# ---------- portada-tarjeta ----------
bg(); crop()
c.setStrokeColor(LINE); c.setLineWidth(1.0); c.rect(BLEED+8*mm,BLEED+8*mm,PW-16*mm,PH-16*mm,fill=0,stroke=1)
y=TOP-4*mm
c.setFillColor(BROWN); c.setFont("Times-BoldItalic",40); c.drawCentredString(CXC,y,"Sirope")
c.setStrokeColor(GOLD); c.setLineWidth(1.1)
p=c.beginPath(); p.moveTo(CXC-24*mm,y-5*mm); p.curveTo(CXC-7*mm,y-2.8*mm,CXC+7*mm,y-2.8*mm,CXC+24*mm,y-5*mm); c.drawPath(p,stroke=1,fill=0)
y-=15*mm
# banner
bw=78*mm; bh=11*mm
c.setFillColor(GREEN); c.roundRect(CXC-bw/2,y-bh+3*mm,bw,bh,2.4*mm,fill=1,stroke=0)
c.setFillColor(white); c.setFont("Times-Bold",15)
t=c.beginText(CXC-c.stringWidth("CARTA SIN GLUTEN","Times-Bold",15)/2-2, y-bh+3*mm+3.4*mm); t.setFont("Times-Bold",15); t.setFillColor(white); t.setCharSpace(2); t.textOut("CARTA SIN GLUTEN"); c.drawText(t)
tr=c.beginText(0,-50); tr.setCharSpace(0); tr.textOut(" "); c.drawText(tr)
y-=bh+2*mm
c.setFillColor(SOFT); c.setFont("Times-Italic",8.6)
c.drawCentredString(CXC,y,"Elaborado con pan y mollete sin gluten · Suplemento +1€ sobre la carta general")
y-=7*mm

DES=[("1 · Café + Tostada mantequilla y mermelada",3.90,["LA"]),
     ("2 · Café + Tostada tomate y aceite",3.90,[]),
     ("6 · Cola Cao + Tostada mantequilla y mermelada",4.10,["LA"]),
     ("7 · Cola Cao + Tostada tomate y aceite",4.10,["LA"])]
TOS=[("Mermelada y mantequilla",2.90,["LA"]),("Tomate y aceite",2.90,[]),
     ("Serrano con tomate",4.10,[]),("Ibérico con tomate",5.20,[]),
     ("York y queso",4.00,["LA"]),("Atún, tomate y mahonesa",4.10,["HU","PE"]),
     ("Guacamole",4.40,[]),("Guacamole con salmón",5.60,["PE"]),
     ("Guacamole con jamón ibérico",5.60,[]),("Salmón y alioli",5.20,["HU","PE"])]
SAN=[("Sándwich mixto",4.00,["LA"]),("Sándwich vegetal",4.10,["HU"]),
     ("Sándwich vegetal con atún",4.40,["HU","PE"])]

def sec(y,title,sub=None):
    return ctitle(y,title,sub)

y=sec(y,"Desayunos sin gluten")
for n,p,alg in DES: y=item(y,n,p,alg)
y-=2.4*mm
y=sec(y,"Tostada o Mollete")
for n,p,alg in TOS: y=item(y,n,p,alg)
y-=2.4*mm
y=sec(y,"Sándwich")
for n,p,alg in SAN: y=item(y,n,p,alg)

# nota alergenos + pie
y-=3*mm
c.setStrokeColor(LINE); c.setLineWidth(0.5); c.line(X0,y,X1,y); y-=5*mm
c.setFillColor(SOFT); c.setFont("Times-Italic",7.2)
c.drawCentredString(CXC,y,"Los iconos indican otros alérgenos presentes. Leyenda completa en la carta general.")
y-=4.4*mm
c.setFillColor(SOFT); c.setFont("Times-Italic",6.4)
c.drawCentredString(CXC,y,"Información conforme al Reglamento (UE) 1169/2011. Consulte al personal para cualquier duda.")
c.showPage(); c.save()
print("SG OK")
