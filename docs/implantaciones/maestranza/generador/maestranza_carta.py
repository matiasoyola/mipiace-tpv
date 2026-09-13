# -*- coding: utf-8 -*-
"""
Generador de la carta del Bar La Maestranza (Santa Olalla, Toledo) — 2026-09-13.

Mantiene la estructura validada (mismos platos, mismos precios, mismos alérgenos
por plato) y corrige lo medido sobre el PDF anterior:

  · FUGA DE TRACKING. En reportlab, el setCharSpace de un beginText NO muere al
    cerrar el objeto de texto: se queda en el estado del PDF. El epígrafe lo
    ponía a 1,6 pt y a partir de ahí todo salía con las letras separadas, pero
    el script calculaba las anchuras como si no lo estuvieran. Consecuencias
    medidas: la línea del epígrafe entraba 5,7 mm sobre "7,00" y 6,3 mm sobre
    "12,00" (parecían tachados), los puntos guía se comían las últimas letras
    de cada nombre, y los precios se salían 0,9 mm del margen derecho.
    Aquí todo el texto espaciado se dibuja con ls(), que devuelve el avance real
    y deja el tracking a 0 antes de cerrar el objeto de texto.
  · Leyenda de alérgenos: 6,6 -> 9 pt, y solo los que aparecen de verdad en
    algún plato (8 de 14; cacahuetes, frutos de cáscara, apio, mostaza, sésamo
    y altramuces no los usa ningún producto).
  · Nota legal 1169/2011: 6,2 -> 7,5 pt. Pie: 7,5 -> 8 pt.
  · Cuerpo de 10 -> 11,5 pt (el interlineado ya daba de sobra: 2,0 líneas por
    cuerpo de letra).
  · Un solo interlineado para las tres caras, resuelto por el propio script:
    busca el mayor que cabe en la cara más apretada (Desayunos, 21 líneas) y lo
    aplica a las tres. El sobrante de las otras dos va a las separaciones entre
    secciones, no a la línea.
  · Reparto de secciones 21 / 19 / 19 (antes 21 / 21 / 10, con 90 mm de blanco
    en la última cara). Los bocadillos fríos pasan a una columna y se juntan con
    los calientes, que es donde el cliente los busca.
  · Tipografías embebidas (Liberation Sans, métricas de Helvetica).
  · La salida va al repo, no a /tmp.

Saca DOS archivos del mismo codigo, asi que no pueden descuadrarse entre si:
  · Cartas_La_Maestranza_ICONOS.pdf        RGB, para pantalla y para ensenarselo al bar.
  · Cartas_La_Maestranza_IMPRENTA_CMYK.pdf CMYK, el que va a la imprenta.
En el de imprenta: separacion CMYK con extraccion de negro hecha aqui (no la adivina el RIP),
todo el texto a negro 100 % K solo -- nada de texto en cuatricromia, que a estos cuerpos se
descuadra el registro --, marcas de corte en negro de registro y el emblema convertido con la
misma formula que el resto, para que el coral del sello y el de los epigrafes sean el mismo.

Uso:
    python3 generador/maestranza_carta.py [carpeta_salida] [carpeta_assets]
"""
import os, sys
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor, CMYKColor
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(HERE)
OUT    = sys.argv[1] if len(sys.argv) > 1 else BASE
ASSETS = sys.argv[2] if len(sys.argv) > 2 else BASE
EMB = os.path.join(ASSETS, "Logo_La_Maestranza_FINAL.png")

# ---------------- tipografías embebidas ----------------
FONT_DIRS = ["/usr/share/fonts/truetype/liberation",
             "/usr/share/fonts/truetype/liberation2",
             "/Library/Fonts", os.path.expanduser("~/Library/Fonts"),
             "/opt/homebrew/share/fonts", "/usr/local/share/fonts"]
def _register(alias, filename, fallback):
    for d in FONT_DIRS:
        p = os.path.join(d, filename)
        if os.path.exists(p):
            pdfmetrics.registerFont(TTFont(alias, p))
            return alias
    sys.stderr.write("AVISO: no encuentro %s; uso %s SIN EMBEBER (no vale para imprenta)\n"
                     % (filename, fallback))
    return fallback
SANS  = _register("Sans",  "LiberationSans-Regular.ttf", "Helvetica")
SANSB = _register("SansB", "LiberationSans-Bold.ttf",    "Helvetica-Bold")
SANSI = _register("SansI", "LiberationSans-Italic.ttf",  "Helvetica-Oblique")

# ---------------- paleta ----------------
HEX = {"BG":"#FBF7F1","INK":"#26221E","CORAL":"#E97058","CORALD":"#C75A45",
       "MUTED":"#8A8078","LINE":"#E1D6C6"}

def to_cmyk(hexstr):
    """Separacion con extraccion de negro, la misma para los vectores y para el emblema."""
    r,g,b=(int(hexstr[i:i+2],16)/255.0 for i in (1,3,5))
    k=1-max(r,g,b)
    if k>=1: return CMYKColor(0,0,0,1)
    return CMYKColor((1-r-k)/(1-k),(1-g-k)/(1-k),(1-b-k)/(1-k),k)

MODO="rgb"
def col(hexstr):
    return HexColor(hexstr) if MODO=="rgb" else to_cmyk(hexstr)
WHITE = HexColor("#FFFFFF")
REG   = HexColor("#000000")      # marcas de corte; en CMYK pasa a negro de registro

ALG_HEX = {
 "GL":("Gluten",            "#C9843F"),
 "CR":("Crustáceos",        "#4E86C6"),
 "HU":("Huevo",             "#E0A83E"),
 "PE":("Pescado",           "#3D6BA3"),
 "CA":("Cacahuetes",        "#B08968"),
 "SO":("Soja",              "#4E9B5E"),
 "LA":("Lácteos",           "#7E6551"),
 "FC":("Frutos de cáscara", "#9B5B6B"),
 "AP":("Apio",              "#7DA845"),
 "MO":("Mostaza",           "#C4A24B"),
 "SE":("Sésamo",            "#9E9284"),
 "SU":("Sulfitos",          "#8A5A7A"),
 "MC":("Moluscos",          "#6FA0C8"),
 "AL":("Altramuces",        "#D9B24A"),
}
ALG = {k:(v[0],None) for k,v in ALG_HEX.items()}   # el color se resuelve por modo
ALGCOL = {}

def set_modo(m):
    """Fija la paleta del modo. En CMYK el texto va a negro 100 % K solo y las
    marcas de corte a negro de registro."""
    global MODO,BG,INK,CORAL,CORALD,MUTED,LINE,WHITE,REG,ALGCOL
    MODO=m
    BG,CORAL,CORALD,LINE = (col(HEX[k]) for k in ("BG","CORAL","CORALD","LINE"))
    if m=="rgb":
        INK=HexColor(HEX["INK"]); MUTED=HexColor(HEX["MUTED"])
        WHITE=HexColor("#FFFFFF"); REG=HexColor("#000000")
    else:
        INK=CMYKColor(0,0,0,1); MUTED=CMYKColor(0,0,0,0.52)
        WHITE=CMYKColor(0,0,0,0); REG=CMYKColor(1,1,1,1)
    ALGCOL={k:col(v[1]) for k,v in ALG_HEX.items()}

_EMB_CACHE={}
def emblema():
    """RGB: el PNG tal cual. CMYK: el mismo PNG separado con to_cmyk(), para que
    el coral del sello sea exactamente el de los epigrafes y el fondo del sello
    exactamente el de la pagina."""
    if MODO=="rgb": return EMB
    if "cmyk" not in _EMB_CACHE:
        import numpy as np
        from PIL import Image
        a=np.asarray(Image.open(EMB).convert("RGB"),dtype=np.float32)/255.0
        mx=a.max(axis=2); k=1.0-mx
        den=np.where(mx<=0,1.0,mx)
        cmy=(mx[...,None]-a)/den[...,None]
        out=np.concatenate([cmy,k[...,None]],axis=2)
        _EMB_CACHE["cmyk"]=ImageReader(Image.fromarray((out*255).round().astype("uint8"),mode="CMYK"))
    return _EMB_CACHE["cmyk"]

# ---------------- geometría ----------------
BLEED=3*mm; PW,PH=210*mm,297*mm; MW,MH=PW+2*BLEED,PH+2*BLEED
ML=18*mm; MR=18*mm; X0=BLEED+ML; X1=BLEED+PW-MR
TOP=BLEED+PH-16*mm; CXC=BLEED+PW/2
EMB_SIZE=36*mm
Y_FIRST = TOP-EMB_SIZE-2*mm-9*mm     # línea base del primer epígrafe
Y_LEG   = BLEED+45*mm                # filete de la leyenda de alérgenos
Y_ROOM  = Y_FIRST-Y_LEG-2*mm         # alto útil de cuerpo

# ---------------- cuerpos de letra ----------------
FS_TITLE=16; TRK_TITLE=3.4
FS_SEC=15;   TRK_SEC=1.8
FS_SECP=12.5
FS_ITEM=14
FS_SUB=10
FS_LEGT=10; FS_LEG=9.5
FS_LEGAL=7.5
FS_FOOT=8.5;  TRK_FOOT=1.4

SEC_STEP=9.4*mm     # del epígrafe a la primera línea de su sección
SUB_STEP=7.2*mm     # del subtítulo a la primera línea
GAP_MIN=5.0*mm      # separación mínima entre secciones
GAP_MAX=20.0*mm     # tope, para que el sobrante no abra un agujero
R_ITEM=2.4*mm; STEP_ITEM=5.4*mm   # pictogramas junto al plato
R_LEG=2.6*mm

# ---------------- contenido (estructura validada: no se toca) ----------------
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
COMB=[("Filete de ternera",None,["HU"]),("Filete de pollo",None,["HU"]),("Filete de lomo",None,["HU"]),
 ("Chuleta de cerdo",None,["HU"]),("Chuleta de ternera",None,["HU"])]
BOCA=[("Lomo con queso",None,["GL","LA"]),("Filete de ternera",None,["GL"]),("Tortilla de patatas",None,["GL","HU"]),
 ("Tortilla francesa",None,["GL","HU"]),("Lomo con pimientos",None,["GL"]),("Bacon con queso",None,["GL","LA"]),
 ("Anchoas con tomate",None,["GL","PE"]),("Atún con tomate",None,["GL","PE"]),("Filete de pollo",None,["GL"]),
 ("Salchichón",None,["GL"]),("Chorizo de pavo",None,["GL"]),("Queso",None,["GL","LA"]),
 ("Caballa",None,["GL","PE"]),("Calamares",None,["GL","MC"])]
HAMB=[("Hamburguesa",5.00,["GL","LA"]),("Hamburguesa especial",7.00,["GL","HU","LA"]),
 ("Sándwich mixto",2.50,["GL","LA"]),("Sándwich mixto con huevo",3.50,["GL","HU","LA"]),
 ("Sándwich vegetal",5.00,["GL","HU"])]

# ---- las tres caras: 21 / 19 / 19 ----
PAGES=[
 ("Desayunos","BUENOS DÍAS · LA MAESTRANZA · IVA INCLUIDO",
  [("sec","Cafés e infusiones",None,None),("items",DES_CAFE),("gap",),
   ("sec","Tostadas",None,None),("items",DES_TOST),("gap",),
   ("sec","Bollería",None,None),("items",DES_BOLL)]),
 ("Para compartir y platos","BUEN PROVECHO · LA MAESTRANZA · IVA INCLUIDO",
  [("sec","Raciones",None,None),("items",RAC),("gap",),
   ("sec","Platos combinados","10,00 · ternera 12,00","Todos con patatas y huevo"),("items",COMB)]),
 ("Bocadillos y hamburguesas","BUEN PROVECHO · LA MAESTRANZA · IVA INCLUIDO",
  [("sec","Bocadillos","5,00 · especial 7,00",None),("items",BOCA),("gap",),
   ("sec","Hamburguesas y sándwiches",None,None),("items",HAMB)]),
]

USADOS=[k for k in ALG if any(k in a for _,_,_,blocks in
        [(None,None,None,p[2]) for p in PAGES] for b in blocks if b[0]=="items"
        for _,_,a in b[1])]

# ---------------- interlineado único, resuelto aquí ----------------
def page_height(blocks, step, gap):
    h=0.0
    for b in blocks:
        if b[0]=="sec":
            h+=SEC_STEP
            if b[3]: h+=SUB_STEP
        elif b[0]=="items": h+=len(b[1])*step
        elif b[0]=="gap":   h+=gap
    return h

def solve_step():
    s=8.0*mm
    while s>4.0*mm:
        if all(page_height(p[2],s,GAP_MIN)<=Y_ROOM for p in PAGES): return s
        s-=0.05*mm
    raise SystemExit("no cabe")
STEP=solve_step()

def page_gap(blocks):
    n=sum(1 for b in blocks if b[0]=="gap")
    if not n: return GAP_MIN
    sobra=Y_ROOM-page_height(blocks,STEP,GAP_MIN)
    return min(GAP_MAX, GAP_MIN+max(0.0,sobra)/n)

# ---------------- lienzo ----------------
c=None
AVISOS=[]

def ls(x,y,txt,font,size,color,trk=0.0,center=False):
    """Texto con tracking que NO deja el estado sucio. Devuelve el avance real."""
    adv=pdfmetrics.stringWidth(txt,font,size)+trk*len(txt)
    ink=pdfmetrics.stringWidth(txt,font,size)+trk*max(0,len(txt)-1)
    xx=x-ink/2 if center else x
    t=c.beginText(xx,y); t.setFont(font,size); t.setFillColor(color)
    if trk: t.setCharSpace(trk)
    t.textOut(txt)
    t.setCharSpace(0)          # <- el estado queda limpio para lo siguiente
    c.drawText(t)
    return ink if not trk else adv

def bg():
    c.setFillColor(BG); c.rect(0,0,MW,MH,fill=1,stroke=0)
    c.setStrokeColor(LINE); c.setLineWidth(0.8)
    c.roundRect(BLEED+7*mm,BLEED+7*mm,PW-14*mm,PH-14*mm,3*mm,fill=0,stroke=1)

def crop():
    c.setStrokeColor(REG); c.setLineWidth(0.3); L=3*mm
    for x,y,dx,dy in [(BLEED,BLEED,-1,0),(BLEED,BLEED,0,-1),(BLEED+PW,BLEED,1,0),(BLEED+PW,BLEED,0,-1),
                      (BLEED,BLEED+PH,-1,0),(BLEED,BLEED+PH,0,1),(BLEED+PW,BLEED+PH,1,0),(BLEED+PW,BLEED+PH,0,1)]:
        c.line(x,y,x+dx*L,y+dy*L)

# ---------------- pictogramas ----------------
def _prep(cx,cy,r,col):
    c.setFillColor(col); c.circle(cx,cy,r,fill=1,stroke=0)
    c.setStrokeColor(WHITE); c.setFillColor(WHITE)
    c.setLineWidth(max(0.35,r*0.12)); c.setLineCap(1); c.setLineJoin(1)
def ic_GL(cx,cy,r,col):
    _prep(cx,cy,r,col); c.line(cx,cy-r*0.62,cx,cy+r*0.6)
    for i in range(4):
        yy=cy+r*0.5-i*r*0.34
        c.line(cx,yy,cx-r*0.42,yy+r*0.18); c.line(cx,yy,cx+r*0.42,yy+r*0.18)
def ic_CR(cx,cy,r,col):
    _prep(cx,cy,r,col); c.setFillColor(WHITE)
    c.ellipse(cx-r*0.42,cy-r*0.34,cx+r*0.42,cy+r*0.22,fill=1,stroke=0)
    c.circle(cx-r*0.55,cy+r*0.35,r*0.16,fill=1,stroke=0); c.circle(cx+r*0.55,cy+r*0.35,r*0.16,fill=1,stroke=0)
    for s in(-1,1):
        c.line(cx+s*r*0.3,cy-r*0.2,cx+s*r*0.6,cy-r*0.5); c.line(cx+s*r*0.15,cy-r*0.25,cx+s*r*0.4,cy-r*0.55)
def ic_HU(cx,cy,r,col):
    _prep(cx,cy,r,col); c.setFillColor(WHITE)
    c.ellipse(cx-r*0.5,cy-r*0.25,cx-r*0.02,cy+r*0.55,fill=1,stroke=0)
    c.ellipse(cx-r*0.05,cy-r*0.55,cx+r*0.5,cy+r*0.3,fill=1,stroke=0)
def ic_PE(cx,cy,r,col):
    _prep(cx,cy,r,col); c.setFillColor(WHITE)
    p=c.beginPath(); p.moveTo(cx-r*0.55,cy); p.curveTo(cx-r*0.2,cy+r*0.4,cx+r*0.35,cy+r*0.35,cx+r*0.55,cy)
    p.curveTo(cx+r*0.35,cy-r*0.35,cx-r*0.2,cy-r*0.4,cx-r*0.55,cy); c.drawPath(p,fill=1,stroke=0)
    c.setFillColor(col); c.circle(cx+r*0.28,cy+r*0.1,r*0.08,fill=1,stroke=0)
    c.setFillColor(WHITE); p=c.beginPath(); p.moveTo(cx-r*0.5,cy); p.lineTo(cx-r*0.8,cy+r*0.28); p.lineTo(cx-r*0.8,cy-r*0.28); p.close(); c.drawPath(p,fill=1,stroke=0)
def ic_CA(cx,cy,r,col):
    _prep(cx,cy,r,col); c.setLineWidth(max(0.4,r*0.14))
    c.circle(cx,cy+r*0.28,r*0.3,fill=0,stroke=1); c.circle(cx,cy-r*0.28,r*0.34,fill=0,stroke=1)
def ic_SO(cx,cy,r,col):
    _prep(cx,cy,r,col); c.setFillColor(WHITE)
    p=c.beginPath(); p.moveTo(cx-r*0.45,cy-r*0.45); p.curveTo(cx-r*0.6,cy+r*0.45,cx+r*0.4,cy+r*0.6,cx+r*0.5,cy-r*0.1)
    p.curveTo(cx+r*0.1,cy+r*0.1,cx-r*0.1,cy-r*0.2,cx-r*0.45,cy-r*0.45); c.drawPath(p,fill=1,stroke=0)
    c.setStrokeColor(col); c.setLineWidth(max(0.3,r*0.1)); c.line(cx-r*0.3,cy-r*0.3,cx+r*0.3,cy+r*0.35)
def ic_LA(cx,cy,r,col):
    _prep(cx,cy,r,col); c.setFillColor(WHITE)
    p=c.beginPath(); p.moveTo(cx-r*0.34,cy+r*0.5); p.lineTo(cx+r*0.34,cy+r*0.5); p.lineTo(cx+r*0.26,cy-r*0.55)
    p.lineTo(cx-r*0.26,cy-r*0.55); p.close(); c.drawPath(p,fill=1,stroke=0)
    c.setStrokeColor(col); c.setLineWidth(max(0.3,r*0.1)); c.line(cx-r*0.3,cy+r*0.18,cx+r*0.32,cy+r*0.18)
def ic_FC(cx,cy,r,col):
    _prep(cx,cy,r,col); c.setFillColor(WHITE)
    p=c.beginPath(); p.moveTo(cx,cy+r*0.55); p.curveTo(cx+r*0.5,cy+r*0.2,cx+r*0.45,cy-r*0.5,cx,cy-r*0.55)
    p.curveTo(cx-r*0.45,cy-r*0.5,cx-r*0.5,cy+r*0.2,cx,cy+r*0.55); c.drawPath(p,fill=1,stroke=0)
    c.setStrokeColor(col); c.setLineWidth(max(0.3,r*0.09)); c.line(cx,cy-r*0.4,cx,cy+r*0.4)
def ic_AP(cx,cy,r,col):
    _prep(cx,cy,r,col)
    for s in(-0.28,0,0.28): c.line(cx+s*r,cy-r*0.5,cx+s*r*0.4,cy+r*0.5)
    c.setFillColor(WHITE); c.circle(cx-r*0.1,cy+r*0.5,r*0.12,fill=1,stroke=0); c.circle(cx+r*0.18,cy+r*0.52,r*0.12,fill=1,stroke=0)
def ic_MO(cx,cy,r,col):
    _prep(cx,cy,r,col); c.setFillColor(WHITE)
    c.rect(cx-r*0.2,cy-r*0.5,r*0.4,r*0.8,fill=1,stroke=0); c.rect(cx-r*0.1,cy+r*0.3,r*0.2,r*0.25,fill=1,stroke=0)
def ic_SE(cx,cy,r,col):
    _prep(cx,cy,r,col); c.setFillColor(WHITE)
    for dx,dy in [(-0.28,0.2),(0.28,0.2),(0,-0.28)]:
        c.ellipse(cx+dx*r-r*0.14,cy+dy*r-r*0.22,cx+dx*r+r*0.14,cy+dy*r+r*0.22,fill=1,stroke=0)
def ic_SU(cx,cy,r,col):
    _prep(cx,cy,r,col); c.setFillColor(WHITE)
    ls(cx,cy-r*0.32,"E-X",SANSB,r*0.85,WHITE,center=True)
def ic_MC(cx,cy,r,col):
    _prep(cx,cy,r,col); c.setFillColor(WHITE)
    p=c.beginPath(); p.moveTo(cx,cy-r*0.5); p.curveTo(cx-r*0.6,cy-r*0.3,cx-r*0.6,cy+r*0.4,cx,cy+r*0.5)
    p.curveTo(cx+r*0.6,cy+r*0.4,cx+r*0.6,cy-r*0.3,cx,cy-r*0.5); c.drawPath(p,fill=1,stroke=0)
    c.setStrokeColor(col); c.setLineWidth(max(0.3,r*0.09))
    for s in(-0.3,0,0.3): c.line(cx,cy-r*0.45,cx+s*r,cy+r*0.45)
def ic_AL(cx,cy,r,col):
    _prep(cx,cy,r,col); c.setFillColor(WHITE)
    for dx,dy in [(-0.26,0.2),(0.28,0.28),(0.05,-0.28)]:
        c.circle(cx+dx*r,cy+dy*r,r*0.2,fill=1,stroke=0)
ICON={"GL":ic_GL,"CR":ic_CR,"HU":ic_HU,"PE":ic_PE,"CA":ic_CA,"SO":ic_SO,"LA":ic_LA,
      "FC":ic_FC,"AP":ic_AP,"MO":ic_MO,"SE":ic_SE,"SU":ic_SU,"MC":ic_MC,"AL":ic_AL}
def icon(code,cx,cy,r): ICON[code](cx,cy,r,ALGCOL[code])

# ---------------- bloques ----------------
def header(titulo):
    c.drawImage(emblema(), CXC-EMB_SIZE/2, TOP-EMB_SIZE+2*mm, width=EMB_SIZE, height=EMB_SIZE, mask='auto')
    ls(CXC,TOP-EMB_SIZE-2*mm,titulo.upper(),SANS,FS_TITLE,INK,TRK_TITLE,center=True)

def section(y,title,price):
    w=ls(X0,y,title.upper(),SANSB,FS_SEC,CORALD,TRK_SEC)
    px=X0+w+4*mm
    if price:
        c.setFont(SANSB,FS_SECP); c.setFillColor(CORALD); c.drawString(px,y,price)
        px+=pdfmetrics.stringWidth(price,SANSB,FS_SECP)+5*mm
    if px<X1-3*mm:
        c.setStrokeColor(LINE); c.setLineWidth(0.8); c.line(px,y+1.4*mm,X1,y+1.4*mm)
    else:
        AVISOS.append("epígrafe sin sitio para el filete: %s" % title)

def leaders(x0,x1,y):
    if x1-x0<5*mm: return
    c.setFillColor(LINE); c.setFont(SANS,7.5); x=x0; step=2.6*mm
    while x<x1: c.drawString(x,y,"."); x+=step

def item(y,name,price,algs):
    """Con precio: nombre · puntos guía · pictogramas · precio a la derecha.
    Sin precio (el precio va en el epígrafe): los pictogramas van pegados al
    nombre y no se ponen puntos guía, porque no conducen a ningún sitio."""
    c.setFont(SANS,FS_ITEM); c.setFillColor(INK); c.drawString(X0,y,name)
    nw=pdfmetrics.stringWidth(name,SANS,FS_ITEM)
    n=len(algs)
    if price is None:
        xs=X0+nw+3*mm
        for i,a in enumerate(algs): icon(a,xs+i*STEP_ITEM+R_ITEM,y+1.2*mm,R_ITEM)
        if xs+n*STEP_ITEM>X1: AVISOS.append("no cabe en una línea: %s" % name)
        return
    ptxt=("%.2f"%price).replace(".",",")+" €"
    pw=pdfmetrics.stringWidth(ptxt,SANSB,FS_ITEM)
    c.setFont(SANSB,FS_ITEM); c.setFillColor(CORALD); c.drawRightString(X1,y,ptxt)
    cluster_right=X1-pw-4*mm
    xs=cluster_right-n*STEP_ITEM
    for i,a in enumerate(algs): icon(a,xs+i*STEP_ITEM+R_ITEM,y+1.2*mm,R_ITEM)
    lx0=X0+nw+2.5*mm; lx1=(xs-2*mm) if n else cluster_right
    if lx0>lx1+0.5: AVISOS.append("no cabe en una línea: %s" % name)
    leaders(lx0,lx1,y)

def legend():
    c.setStrokeColor(LINE); c.setLineWidth(0.7); c.line(X0,Y_LEG,X1,Y_LEG)
    y=Y_LEG-5.5*mm
    ls(X0,y,"ALÉRGENOS",SANSB,FS_LEGT,CORALD,1.2)
    y-=7.4*mm
    ncol=4; cw=(X1-X0)/ncol
    for k,code in enumerate(USADOS):
        col=k%ncol; row=k//ncol
        xx=X0+col*cw; yy=y-row*7.6*mm
        icon(code,xx+R_LEG,yy+1.0*mm,R_LEG)
        c.setFillColor(INK); c.setFont(SANS,FS_LEG)
        c.drawString(xx+2*R_LEG+1.6*mm,yy,ALG_HEX[code][0])
    nrow=(len(USADOS)+ncol-1)//ncol
    y=y-(nrow-1)*7.6*mm-6.6*mm
    c.setFillColor(MUTED); c.setFont(SANSI,FS_LEGAL)
    c.drawString(X0,y,"Información de alérgenos conforme al Reglamento (UE) 1169/2011.")
    c.drawString(X0,y-4.2*mm,"Consulta al personal cualquier duda sobre trazas o preparación.")

def footer(txt):
    ls(CXC,BLEED+8*mm,txt,SANS,FS_FOOT,MUTED,TRK_FOOT,center=True)

# ---------------- render ----------------
def build(modo,fichero):
    global c
    set_modo(modo)
    c=canvas.Canvas(os.path.join(OUT,fichero),pagesize=(MW,MH),
                    initialFontName=SANS,initialFontSize=FS_ITEM)
    c.setTitle("Carta · Bar La Maestranza")
    for titulo,pie,blocks in PAGES:
        bg(); crop(); header(titulo)
        gap=page_gap(blocks)
        y=Y_FIRST
        for b in blocks:
            if b[0]=="sec":
                section(y,b[1],b[2]); y-=SEC_STEP
                if b[3]:
                    c.setFillColor(MUTED); c.setFont(SANSI,FS_SUB); c.drawString(X0,y,b[3]); y-=SUB_STEP
            elif b[0]=="items":
                for n,p,a in b[1]:
                    item(y,n,p,a); y-=STEP
            elif b[0]=="gap":
                y-=gap
        if y<Y_LEG+1*mm: AVISOS.append("la cara '%s' se come la leyenda" % titulo)
        legend(); footer(pie)
        c.showPage()
    c.save()
    print("  %-40s %s" % (fichero, modo.upper()))

print("interlineado unico: %.2f mm  ·  cuerpo %.1f pt  ·  ratio %.2f"
      % (STEP/mm, FS_ITEM, (STEP/mm)/(FS_ITEM*25.4/72)))
print("alergenos en leyenda: %s" % ", ".join(USADOS))
build("rgb","Cartas_La_Maestranza_ICONOS.pdf")
build("cmyk","Cartas_La_Maestranza_IMPRENTA_CMYK.pdf")
set_modo("cmyk")
for n in ("CORAL","CORALD","LINE","BG"):
    v=col(HEX[n]); print("  %-7s %-8s -> C%.0f M%.0f Y%.0f K%.0f" %
        (n,HEX[n],v.cyan*100,v.magenta*100,v.yellow*100,v.black*100))
print("  TEXTO   %-8s -> K100 (solo negro)" % HEX["INK"])
for a in sorted(set(AVISOS)): print("AVISO:", a)
