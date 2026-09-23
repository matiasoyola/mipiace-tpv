# -*- coding: utf-8 -*-
"""
Carta SIN GLUTEN de Sirope — reconstruida 2026-09-22 a partir de carta_sg.py (19-08).

Misma estructura y mismo contenido que la versión validada (cabecera, banda verde,
tres secciones, mismos platos, precios y alérgenos). Cambios pedidos por la imprenta
(Trébol, 22-09) y alineación con las correcciones del 13-09 de la carta general:
  · DORSO: la carta pasa de 1 a 2 caras; el reverso lleva el logo de Sirope sobre
    el fondo crema en lugar de quedar en blanco (mismo criterio que el dorso-tapa
    de la carta de desayunos de La Maestranza).
  · Leyenda de alérgenos propia (antes remitía a la carta general): solo los que
    aparecen en esta carta, con los mismos iconos y tamaño (9 pt) que la general.
  · "Precios con IVA incluido" en el pie.
  · Nota legal 6,4 -> 7,5 pt; cuerpo de plato al de la carta general.
  · Tipografías Liberation embebidas (en el CMYK se entregan trazadas).

Reutiliza paleta, iconos y helpers de carta_sirope.py (sin volver a generar la general).

Uso:  cd docs/implantaciones/sirope && python3 generador/carta_sirope_sg.py . .
Sale: Carta_Sirope_SIN_GLUTEN.pdf (2 caras A5 + 3 mm de sangre + marcas, RGB)
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "carta_sirope.py"), encoding="utf-8").read()
exec(src[:src.index("# ================= SALIDA 1")])   # paleta, fuentes, iconos, helpers

LOGO = os.path.join(ASSETS, "logo_sirope.png")
GREEN = HexColor("#4E7A3A")

# ---------------- contenido (carta sin gluten validada, sin cambios) ----------------
DES_SG = [("1 · Café + Tostada mantequilla y mermelada", 3.90, ["LA"]),
          ("2 · Café + Tostada tomate y aceite", 3.90, []),
          ("6 · Cola Cao + Tostada mantequilla y mermelada", 4.10, ["LA"]),
          ("7 · Cola Cao + Tostada tomate y aceite", 4.10, ["LA"])]
TOS_SG = [("Mermelada y mantequilla", 2.90, ["LA"]), ("Tomate y aceite", 2.90, []),
          ("Serrano con tomate", 4.10, []), ("Ibérico con tomate", 5.20, []),
          ("York y queso", 4.00, ["LA"]), ("Atún, tomate y mahonesa", 4.10, ["HU","PE"]),
          ("Guacamole", 4.40, []), ("Guacamole con salmón", 5.60, ["PE"]),
          ("Guacamole con jamón ibérico", 5.60, []), ("Salmón y alioli", 5.20, ["HU","PE"])]
SAN_SG = [("Sándwich mixto", 4.00, ["LA"]), ("Sándwich vegetal", 4.10, ["HU"]),
          ("Sándwich vegetal con atún", 4.40, ["HU","PE"])]
SG = [("sec","Desayunos sin gluten",None),("it",DES_SG),
      ("sec","Tostada o Mollete",None),("it",TOS_SG),
      ("sec","Sándwich",None),("it",SAN_SG)]

USADOS = [k for k in ALG if any(k in it[2] for L_ in (DES_SG,TOS_SG,SAN_SG) for it in L_)]
NOTA_SG = ["Los iconos indican otros alérgenos presentes en cada producto.",
           "Información de alérgenos conforme al Reglamento (UE) 1169/2011.",
           "Consulte al personal para cualquier duda."]

# ---------------- geometría propia (marco interior a 8 mm) ----------------
FRAME = 8*mm
FOOT_Y = BLEED+FRAME+4.5*mm          # "IVA incluido" dentro del marco
LEG_ROW, NOTE_STEP = 6.8*mm, 4.2*mm

def header():
    """Cabecera igual que la validada: wordmark, curva dorada, banda verde, subtítulo."""
    y = BLEED+PH-16*mm-4*mm
    c.setFillColor(BROWN); c.setFont("Serif-BoldItalic",40); c.drawCentredString(CXC,y,"Sirope")
    c.setStrokeColor(GOLD); c.setLineWidth(1.1)
    p=c.beginPath(); p.moveTo(CXC-24*mm,y-5*mm)
    p.curveTo(CXC-7*mm,y-2.8*mm,CXC+7*mm,y-2.8*mm,CXC+24*mm,y-5*mm); c.drawPath(p,stroke=1,fill=0)
    y -= 15*mm
    bw, bh = 78*mm, 11*mm
    c.setFillColor(GREEN); c.roundRect(CXC-bw/2,y-bh+3*mm,bw,bh,2.4*mm,fill=1,stroke=0)
    ls_centered(CXC,y-bh+3*mm+3.4*mm,"CARTA SIN GLUTEN","Serif-Bold",15,2.0,white)
    y -= bh+2*mm
    c.setFillColor(SOFT); c.setFont("Serif-Italic",8.6)
    c.drawCentredString(CXC,y,"Elaborado con pan y mollete sin gluten · Suplemento +1 € sobre la carta general")
    return y-9*mm                    # primera línea base de contenido

def legend_h():
    rows = -(-len(USADOS)//LEG_COLS)
    return 7*mm+SEC_AFTER+rows*LEG_ROW+3.2*mm+len(NOTA_SG)*NOTE_STEP

def draw_legend_sg(ytop):
    y = ytop-7*mm; sec_title(y,"Alérgenos"); y -= SEC_AFTER
    cw = (X1-X0)/LEG_COLS; r = 2.2*mm
    for k,code in enumerate(USADOS):
        xx = X0+(k%LEG_COLS)*cw; yy = y-(k//LEG_COLS)*LEG_ROW
        icon(code,xx+r,yy+0.9*mm,r)
        c.setFillColor(INK); c.setFont("Sans",LEG_LABEL); c.drawString(xx+2*r+1.6*mm,yy,ALG[code][0])
    y -= (-(-len(USADOS)//LEG_COLS))*LEG_ROW
    c.setStrokeColor(LINE); c.setLineWidth(0.5); c.line(X0,y+2.5*mm,X1,y+2.5*mm)
    c.setFillColor(SOFT); c.setFont("Serif-Italic",LEG_NOTE)
    for k,ln in enumerate(NOTA_SG): c.drawCentredString(CXC,y-2.4*mm-k*NOTE_STEP,ln)

def frame():
    c.setStrokeColor(LINE); c.setLineWidth(1.0)
    c.rect(BLEED+FRAME,BLEED+FRAME,PW-2*FRAME,PH-2*FRAME,fill=0,stroke=1)

def face_sg():
    global TOP, BOT
    bg(); frame()
    TOP = header()
    BOT = FOOT_Y+4.5*mm+legend_h()   # suelo de los platos: encima de la leyenda
    # interlineado: el de la carta general (4,67 mm) si cabe; si no, el mayor que quepa
    L = min(max_leading(SG), 4.67*mm)
    ex = air(SG,L,2)
    last = layout(SG,L,draw=True,extra=ex)
    draw_legend_sg(BOT)
    footer_iva()
    return L, last

def face_dorso():
    """Reverso: fondo crema, marco y logo de Sirope. Sin datos que caduquen."""
    bg(); frame()
    from reportlab.lib.utils import ImageReader
    img = ImageReader(LOGO); iw, ih = img.getSize()
    w = 96*mm; h = w*ih/iw
    y0 = BLEED+PH/2-h/2+10*mm
    c.drawImage(img,CXC-w/2,y0,width=w,height=h,mask="auto")
    ls_centered(CXC,y0-12*mm,"CAFETERÍA","Serif",11.0,4.0,INK)
    c.setFillColor(SOFT); c.setFont("Serif-Italic",9.5)
    c.drawCentredString(CXC,y0-18*mm,"Desayunos · Bollería · Meriendas")

c = canvas.Canvas(os.path.join(OUT,"Carta_Sirope_SIN_GLUTEN.pdf"), pagesize=(MW,MH))
c.setTitle("Carta Sirope · sin gluten")
L, last = face_sg(); crop(); c.showPage()
face_dorso(); crop(); c.showPage()
c.save()
print("interlineado %.2f mm · última línea de platos %.1f mm sobre el suelo" % (L/mm, (last-BOT)/mm))
print("SG OK")
