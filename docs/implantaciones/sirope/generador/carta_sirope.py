# -*- coding: utf-8 -*-
"""
Generador de la carta de Sirope (Talavera) — reconstruido 2026-09-13.

Reproduce la carta validada (misma estructura, mismas secciones, mismo orden)
y corrige lo que no era legible o faltaba:
  · Leyenda de alérgenos: 5,4 pt -> 9 pt, y solo los alérgenos que aparecen
    de verdad en algún plato (7 de 14; los otros 7 no los usa ningún producto).
  · Nota legal 1169/2011: 6 pt -> 7,5 pt.
  · "Precios con IVA incluido" en el pie de las tres caras interiores.
  · Un solo interlineado para las tres caras (antes 5,2 / 4,6 / 4,8 mm).
  · Margen superior 7,3 -> 11 mm y bloque de texto centrado (antes 14 / 16,2).
  · Cuerpo de 11 a 11,5 pt (el máximo que admite la cara de bollería sin comerse
    los márgenes ni partir la estructura).
  · Tipografías embebidas (Liberation Sans/Serif, métricas de Helvetica/Times).

Salidas: Carta_Sirope_imprenta.pdf (4 caras A5 + sangre + marcas)
         Carta_Sirope_PLIEGO.pdf   (2 caras A4 apaisado, listo para plegar)
"""
import os, sys
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, white, black, Color
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import qrcode

OUT = sys.argv[1] if len(sys.argv) > 1 else "."
ASSETS = sys.argv[2] if len(sys.argv) > 2 else "."
COVER = os.path.join(ASSETS, "cover_composited.png")

# ---------------- tipografías embebidas ----------------
LIB = "/usr/share/fonts/truetype/liberation"
for alias, f in [("Sans", "LiberationSans-Regular.ttf"), ("Sans-Bold", "LiberationSans-Bold.ttf"),
                 ("Serif", "LiberationSerif-Regular.ttf"), ("Serif-Bold", "LiberationSerif-Bold.ttf"),
                 ("Serif-Italic", "LiberationSerif-Italic.ttf"),
                 ("Serif-BoldItalic", "LiberationSerif-BoldItalic.ttf")]:
    pdfmetrics.registerFont(TTFont(alias, os.path.join(LIB, f)))

# ---------------- paleta ----------------
BG    = HexColor("#F3EEDC")
INK   = HexColor("#3E2C19")
BROWN = HexColor("#6E4B27")
GOLD  = HexColor("#A9793B")
LINE  = HexColor("#C6AF82")
SOFT  = HexColor("#8A6B45")

ALG = {
 "GL": ("Gluten",             HexColor("#B98B5E")),
 "CR": ("Crustáceos",         HexColor("#4E86C6")),
 "HU": ("Huevos",             HexColor("#D4A24E")),
 "PE": ("Pescado",            HexColor("#3D6BA3")),
 "CA": ("Cacahuetes",         HexColor("#A89A86")),
 "SO": ("Soja",               HexColor("#3E9B6C")),
 "LA": ("Lácteos",            HexColor("#6E5140")),
 "FC": ("Frutos de cáscara",  HexColor("#9B5B6B")),
 "AP": ("Apio",               HexColor("#8FBF3F")),
 "MO": ("Mostaza",            HexColor("#B7A66B")),
 "SE": ("Sésamo",             HexColor("#9E9E9E")),
 "SU": ("Sulfitos",           HexColor("#7A3F63")),
 "MC": ("Moluscos",           HexColor("#7FB0DE")),
 "AL": ("Altramuces",         HexColor("#E4E08A")),
}

# ---------------- contenido (carta validada) ----------------
SUB_SG = "(Opción mollete sin gluten · +1 €)"

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
 ("Tarrina de mermelada", 0.30, []), ("Tarrina de mantequilla", 0.30, ["LA"]),
 ("Tarrina de tomate", 0.30, []), ("Tarrina de aceite", 0.30, []),
]
CAFE = [
 ("Solo", 1.50, []), ("Con leche", 1.50, ["LA"]), ("Cortado", 1.50, ["LA"]),
 ("Americano", 1.50, []), ("Bombón", 2.00, ["LA"]), ("Capuccino", 1.90, ["LA"]),
 ("Carajillo", 2.00, ["SU"]), ("Vaso de leche", 1.50, ["LA"]),
 ("Cola Cao / Nesquik", 1.70, ["LA"]), ("Chocolate", 2.40, ["LA"]),
]
INFUSIONES = [
 ("Manzanilla · Poleo menta · Tila · Té verde · Té rojo", 1.50, []),
 ("Infusión premium", 1.80, []),
]
TEFRIO = "Limón · Frutos del bosque · Roibos tropical · Melocotón · Piña colada · Menta · Melón · Mojito"
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
 ("Refrescos", 2.50, []), ("Zumos", 2.50, []), ("Agua mineral", 1.00, []),
 ("Tinto de verano", 2.50, ["SU"]), ("Botellín", 1.50, ["GL"]),
 ("Tercio", 2.50, ["GL"]), ("Cerveza 1906", 2.90, ["GL"]),
 ("Alhambra", 2.90, ["GL"]), ("Botellín sin gluten", 1.70, []),
 ("Batido chocolate", 2.50, ["LA"]),
 ("Batidos naturales con nata (vainilla, chocolate, oreo, fresa)", 3.90, ["LA"]),
]
VINOS = [
 ("Ribera", 2.60, ["SU"]), ("Rioja", 2.60, ["SU"]),
 ("De la Mancha", 1.50, ["SU"]), ("Vino blanco", 2.00, ["SU"]),
]
LICORES = [
 ("Martini", 3.00, ["SU"]), ("Baileys", 3.50, ["LA"]),
 ("Copa licor", 2.90, ["SU"]), ("Chupitos", 1.60, []),
 ("Combinados", 5.00, []), ("Copa Whisky", 3.60, []),
 ("Copa Soberano", 2.50, []), ("Copa Castellana", 2.50, ["SU"]),
]

P2 = [("sec","Desayunos",SUB_SG),("it",DESAYUNOS),
      ("sec","Suplementos",None),("it",SUPLEMENTOS),
      ("sec","Café",None),("it",CAFE),
      ("sec","Infusiones",None),("it",INFUSIONES),
      ("sec","Té frío",None),("combo",TEFRIO,2.40)]
P3 = [("sec","Bollería",None),("it",BOLLERIA),
      ("sec","Tostada o Mollete",SUB_SG),("it",TOSTADA),
      ("sec","Croissant y Sándwich",None),("it",CRSAND)]
P4 = [("sec","Bebidas",None),("it",BEBIDAS),
      ("sec","Vinos",None),("it",VINOS),
      ("sec","Licores",None),("it",LICORES)]

# ---------------- geometría ----------------
BLEED = 3*mm
PW, PH = 148*mm, 210*mm
MW, MH = PW+2*BLEED, PH+2*BLEED
MARGIN = 15*mm                    # igual a izquierda y derecha
X0, X1 = BLEED+MARGIN, BLEED+PW-MARGIN
CXC = BLEED+PW/2
TOP = BLEED+PH-11*mm              # primera línea base
FOOT_Y = BLEED+8*mm               # línea de "IVA incluido"
BOT = FOOT_Y+5*mm                 # suelo del contenido

SZ_ITEM, SZ_SEC, SZ_SUB = 11.5, 14.0, 8.5
SEC_BEFORE, SEC_AFTER, SUB_AFTER = 4.2*mm, 6.2*mm, 4.8*mm
LEG_LABEL, LEG_NOTE = 9.0, 7.5

USADOS = [k for k in ALG if any(k in it[2] for L in
          (DESAYUNOS,SUPLEMENTOS,CAFE,INFUSIONES,BOLLERIA,TOSTADA,CRSAND,BEBIDAS,VINOS,LICORES)
          for it in L)]

c = None

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
def ic_SU(cx,cy,r,col):
    _prep(cx,cy,r,col); c.setFillColor(white); c.setFont("Sans-Bold",r*0.86)
    c.drawCentredString(cx,cy-r*0.3,"E-X")
ICON={"GL":ic_GL,"HU":ic_HU,"PE":ic_PE,"SO":ic_SO,"LA":ic_LA,"FC":ic_FC,"SU":ic_SU}
def icon(code,cx,cy,r): ICON[code](cx,cy,r,ALG[code][1])

# ---------------- helpers ----------------
def ls_centered(cxc,y,text,font,size,cs,color):
    tw=c.stringWidth(text,font,size)+cs*(len(text)-1)
    t=c.beginText(cxc-tw/2,y); t.setFont(font,size); t.setFillColor(color)
    t.setCharSpace(cs); t.textOut(text); c.drawText(t)
    r=c.beginText(0,0); r.setCharSpace(0); c.drawText(r)   # el tracking no debe escaparse a las lineas siguientes
    return tw

def sec_title(y,title):
    tw=ls_centered(CXC,y,title.upper(),"Serif-Bold",SZ_SEC,2.0,BROWN)
    ry=y+SZ_SEC*0.30
    c.setStrokeColor(LINE); c.setLineWidth(0.7)
    c.line(X0,ry,CXC-tw/2-4*mm,ry); c.line(CXC+tw/2+4*mm,ry,X1,ry)
    for xx in (CXC-tw/2-4*mm, CXC+tw/2+4*mm):
        c.setFillColor(GOLD); c.rect(xx-0.7,ry-0.7,1.4,1.4,fill=1,stroke=0)

def leaders(x0,x1,y):
    c.setFillColor(LINE); c.setFont("Sans",6); step=1.8*mm; x=x0
    while x<x1: c.drawString(x,y,"."); x+=step

def draw_item(y,name,price,algs):
    ptxt=("%.2f"%price).replace(".",",")+" €"
    c.setFont("Sans-Bold",SZ_ITEM); pw=c.stringWidth(ptxt,"Sans-Bold",SZ_ITEM)
    r=1.85*mm; step=4.2*mm; n=len(algs)
    cluster_right=X1-pw-3*mm; xs=cluster_right-n*step
    # el nombre se encoge solo si no cabe (suelo 10 pt)
    sz=SZ_ITEM; avail=(xs if n else X1-pw-3*mm)-X0-3*mm
    while sz>10.5 and c.stringWidth(name,"Sans",sz)>avail: sz-=0.1
    c.setFillColor(INK); c.setFont("Sans",sz); c.drawString(X0,y,name)
    nw=c.stringWidth(name,"Sans",sz)
    c.setFillColor(BROWN); c.setFont("Sans-Bold",SZ_ITEM); c.drawRightString(X1,y,ptxt)
    for i,a in enumerate(algs): icon(a,xs+i*step+r,y+0.95*mm,r)
    lx0=X0+nw+2.2*mm; lx1=(xs-2*mm) if n else (X1-pw-3*mm)
    if lx1-lx0>4*mm: leaders(lx0,lx1,y)

def wrap(text,sep,font,size,maxw):
    out=[]; cur=""
    for w in text.split(sep):
        t=(cur+sep+w) if cur else w
        if c.stringWidth(t,font,size)<=maxw: cur=t
        else:
            if cur: out.append(cur)
            cur=w
    if cur: out.append(cur)
    return out

# ---------------- motor de maquetación ----------------
def layout(blocks, L, draw=False, extra=0.0):
    """Recorre la cara. Devuelve la última línea base. Si draw=False solo mide."""
    y=TOP; first=True
    for b in blocks:
        if b[0]=="sec":
            if not first: y-=SEC_BEFORE+extra
            if draw: sec_title(y,b[1])
            y-=SEC_AFTER
            if b[2]:
                if draw:
                    c.setFillColor(SOFT); c.setFont("Serif-BoldItalic",SZ_SUB)
                    c.drawCentredString(CXC,y,b[2])
                y-=SUB_AFTER
            first=False
        elif b[0]=="it":
            for n,p,a in b[1]:
                if draw: draw_item(y,n,p,a)
                y-=L
        elif b[0]=="combo":
            ptxt=("%.2f"%b[2]).replace(".",",")+" €"
            pw=c.stringWidth(ptxt,"Sans-Bold",SZ_ITEM)
            lines=wrap(b[1]," · ","Sans",SZ_ITEM,(X1-X0)-pw-6*mm)
            if draw:
                c.setFillColor(BROWN); c.setFont("Sans-Bold",SZ_ITEM); c.drawRightString(X1,y,ptxt)
                c.setFillColor(INK); c.setFont("Sans",SZ_ITEM)
                for k,ln in enumerate(lines): c.drawString(X0,y-k*L,ln)
            y-=L*len(lines)
    return y+L  # última línea base usada

LEG_COLS = 3
NOTA = ["Información de alérgenos conforme al Reglamento (UE) 1169/2011.",
        "Consulte al personal para cualquier duda."]

def legend_height():
    rows=-(-len(USADOS)//LEG_COLS)
    return 9*mm+SEC_AFTER + rows*6.8*mm + 4.0*mm + 2*4.6*mm  # 9 mm de aire sobre la leyenda

def draw_legend(y):
    y-=9*mm; sec_title(y,"Alérgenos"); y-=SEC_AFTER
    cw=(X1-X0)/LEG_COLS; r=2.2*mm
    for k,code in enumerate(USADOS):
        col=k%LEG_COLS; row=k//LEG_COLS; xx=X0+col*cw; yy=y-row*6.8*mm
        icon(code,xx+r,yy+0.9*mm,r)
        c.setFillColor(INK); c.setFont("Sans",LEG_LABEL); c.drawString(xx+2*r+1.6*mm,yy,ALG[code][0])
    y-= (-(-len(USADOS)//LEG_COLS))*6.8*mm
    c.setStrokeColor(LINE); c.setLineWidth(0.5); c.line(X0,y+2.5*mm,X1,y+2.5*mm)
    c.setFillColor(SOFT); c.setFont("Serif-Italic",LEG_NOTE)
    for k,ln in enumerate(NOTA):
        c.drawCentredString(CXC,y-2.4*mm-k*4.6*mm,ln)
    return y

def footer_iva():
    c.setFillColor(SOFT); c.setFont("Serif-Italic",7.5)
    c.drawCentredString(CXC,FOOT_Y,"Precios con IVA incluido")

def bg():
    c.setFillColor(BG); c.rect(0,0,MW,MH,fill=1,stroke=0)
def crop(w=MW,h=MH):
    c.setStrokeColor(black); c.setLineWidth(0.3); L=3*mm
    for x,y,dx,dy in [(BLEED,BLEED,-1,0),(BLEED,BLEED,0,-1),(w-BLEED,BLEED,1,0),(w-BLEED,BLEED,0,-1),
                      (BLEED,h-BLEED,-1,0),(BLEED,h-BLEED,0,1),(w-BLEED,h-BLEED,1,0),(w-BLEED,h-BLEED,0,1)]:
        c.line(x,y,x+dx*L,y+dy*L)

def draw_qr(cx,cy,size,data="https://siropetalavera.com"):
    q=qrcode.QRCode(border=0,box_size=1,error_correction=qrcode.constants.ERROR_CORRECT_M)
    q.add_data(data); q.make(fit=True)
    m=q.get_matrix(); n=len(m); cell=size/n; x0=cx-size/2; y0=cy-size/2
    c.setFillColor(black)
    for i,row in enumerate(m):
        for j,v in enumerate(row):
            if v: c.rect(x0+j*cell,y0+(n-1-i)*cell,cell+0.15,cell+0.15,fill=1,stroke=0)

# ---------------- interlineado común a las tres caras ----------------
def max_leading(blocks, legend=False):
    lo,hi=3.0*mm,8.0*mm
    for _ in range(44):
        mid=(lo+hi)/2
        y=layout(blocks,mid)
        if legend: y-=legend_height()
        if y>=BOT: lo=mid
        else: hi=mid
    return lo

def solve_leading():
    """Un solo ritmo de linea para las tres caras: el que admite la mas apretada."""
    return min(max_leading(P2), max_leading(P3), max_leading(P4,legend=True))

def air(blocks, L, ngaps, legend=False):
    """Reparte el espacio sobrante de la cara entre sus separaciones de seccion."""
    y=layout(blocks,L)
    if legend: y-=legend_height()
    sobra=y-BOT
    if ngaps<=0 or sobra<=0: return 0.0
    return min(4.5*mm, sobra/ngaps)

# ---------------- caras ----------------
def face_cover(marks=True):
    c.drawImage(COVER,0,0,width=MW,height=MH,preserveAspectRatio=False,mask=None)
    ls_centered(CXC,BLEED+134.5*mm,"CAFETERÍA","Serif",11.0,4.0,INK)
    c.setFillColor(SOFT); c.setFont("Serif-Italic",9.5)
    c.drawCentredString(CXC,BLEED+128.6*mm,"Desayunos · Bollería · Meriendas")
    qs=17*mm; qx=BLEED+24.5*mm; qy=BLEED+23*mm
    c.setFillColor(Color(0,0,0,alpha=0.16))
    c.roundRect(qx-qs/2-3*mm+0.8*mm,qy-qs/2-3*mm-0.8*mm,qs+6*mm,qs+9*mm,2.2*mm,fill=1,stroke=0)
    c.setFillColor(white); c.roundRect(qx-qs/2-3*mm,qy-qs/2-3*mm,qs+6*mm,qs+9*mm,2.2*mm,fill=1,stroke=0)
    draw_qr(qx,qy,qs)
    c.setFillColor(BROWN); c.setFont("Sans-Bold",6.0)
    c.drawCentredString(qx,qy-qs/2-2.4*mm,"siropetalavera.com")

def face_p2(L,marks=True):
    bg(); layout(P2,L,draw=True,extra=air(P2,L,4)); footer_iva()
def face_p3(L,marks=True):
    bg(); layout(P3,L,draw=True,extra=air(P3,L,2)); footer_iva()
def face_p4(L,marks=True):
    bg(); layout(P4,L,draw=True,extra=air(P4,L,2,legend=True))
    draw_legend(BOT+legend_height())   # leyenda anclada al pie
    footer_iva()

# ================= SALIDA 1: caras A5 sueltas =================
c = canvas.Canvas(os.path.join(OUT,"Carta_Sirope_imprenta.pdf"), pagesize=(MW,MH))
c.setTitle("Carta Sirope")
L = solve_leading()
print("interlineado resuelto: %.2f mm (%.1f pt)" % (L/mm, L/mm*72/25.4))
face_cover(); crop(); c.showPage()
for f in (face_p2,face_p3,face_p4):
    f(L); crop(); c.showPage()
c.save()

# ================= SALIDA 2: pliego A4 =================
SMW,SMH = 2*PW+2*BLEED, PH+2*BLEED
FOLD = BLEED+PW
c = canvas.Canvas(os.path.join(OUT,"Carta_Sirope_PLIEGO.pdf"), pagesize=(SMW,SMH))
c.setTitle("Carta Sirope · pliego")

def place(fn,left,*a):
    c.saveState()
    p=c.beginPath()
    if left: p.rect(0,0,FOLD,SMH)
    else:    p.rect(FOLD,0,SMW-FOLD,SMH)
    c.clipPath(p,stroke=0,fill=0)
    if not left: c.translate(PW,0)
    fn(*a)
    c.restoreState()

def sheet_marks():
    c.setStrokeColor(black); c.setLineWidth(0.3); Lm=3*mm
    for x,y,dx,dy in [(BLEED,BLEED,-1,0),(BLEED,BLEED,0,-1),(SMW-BLEED,BLEED,1,0),(SMW-BLEED,BLEED,0,-1),
                      (BLEED,SMH-BLEED,-1,0),(BLEED,SMH-BLEED,0,1),(SMW-BLEED,SMH-BLEED,1,0),(SMW-BLEED,SMH-BLEED,0,1)]:
        c.line(x,y,x+dx*Lm,y+dy*Lm)
    c.setDash(1,2); c.setLineWidth(0.4)
    c.line(FOLD,SMH-BLEED,FOLD,SMH); c.line(FOLD,0,FOLD,BLEED); c.setDash()

place(face_p4,True,L); place(face_cover,False); sheet_marks(); c.showPage()
place(face_p2,True,L); place(face_p3,False,L); sheet_marks(); c.showPage()
c.save()
print("OK")
