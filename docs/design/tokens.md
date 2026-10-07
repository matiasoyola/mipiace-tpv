# Design tokens · mipiacetpv v1

Tokens y reglas que Code debe respetar al implementar pantallas reales del
TPV y del admin. Equivalente al contrato funcional `07-nucleo-comun.md`,
pero para lo visual.

> Cualquier divergencia respecto a estos tokens es un bug. Si una pantalla
> nueva necesita un color, tamaño o componente fuera de esta lista,
> primero se añade aquí (con justificación) y luego se implementa.

## 1. Logo y marca

El logo de mipiacetpv es:

- **Iconmark**: 4 barras verticales (alusión a gráficas de ventas / TPV /
  datos) en `mipiace.ink` con un corazón en `mipiace.coral` sobre la
  primera barra (la traducción literal de "mi piace").
- **Wordmark**: `mipiace` en charcoal + `tpv` en coral. El split de
  colores distingue **marca** (mipiace, identidad) de **producto** (tpv).

SVG canónico inline (componente `Logo`):

```tsx
<svg width="28" height="28" viewBox="0 0 28 28" fill="none">
  <path d="M5.2 4.4c-.85 0-1.55.65-1.55 1.5 0 .65 1.55 1.95 1.55 1.95s1.55-1.3 1.55-1.95c0-.85-.7-1.5-1.55-1.5z" fill="#E97058"/>
  <rect x="4" y="9.5" width="2.4" height="14.5" rx="1.2" fill="#1F2937"/>
  <rect x="8.8" y="6" width="2.4" height="18" rx="1.2" fill="#1F2937"/>
  <rect x="13.6" y="11" width="2.4" height="13" rx="1.2" fill="#1F2937"/>
  <rect x="18.4" y="8" width="2.4" height="16" rx="1.2" fill="#1F2937"/>
</svg>
```

Acompañado de `<span>mipiace</span><span class="text-mipiace-coral">tpv</span>`
con `font-weight: 600`, `letter-spacing: -0.01em`.

## 2. Paleta

| Token | Hex | Uso |
|---|---|---|
| `mipiace.coral` | `#E97058` | Acento primario. CTAs principales, iconmark del corazón, "tpv" en wordmark, precio del producto en carrito, descuentos. |
| `mipiace.coral-dark` | `#C75A45` | Hover state del coral. Texto sobre `coral-soft`. |
| `mipiace.coral-soft` | `#FDEAE3` | Fondos suaves de elementos coral (estado activo de nav, badges, mesas ocupadas). |
| `mipiace.ink` | `#1F2937` | Texto principal. Iconmark de las barras. "mipiace" en wordmark. |
| `mipiace.ink-soft` | `#374151` | Texto secundario fuerte. |
| `mipiace.stone` | `#F8F6F3` | Fondo de superficies (canvas general, inputs, botones de quick action). Cálido, no gris frío. |
| `slate-200/300/400` | tailwind | Bordes, texto deshabilitado, placeholders. |
| `emerald-500` | tailwind | Estado "conectado / OK / caja abierta". |
| `amber-50/300/700` | tailwind | Estado "atención / pidiendo cuenta / 2FA recomendado". |

**Tonos de categoría** (en `lib/categoryTones.ts`, `TONE_STYLES`):

| Tone | Icono | Banda de tarjeta |
|---|---|---|
| `amber` | `text-amber-600` | `bg-amber-400` |
| `sky` | `text-sky-600` | `bg-sky-400` |
| `red` | `text-red-600` | `bg-red-400` |
| `green` | `text-emerald-600` | `bg-emerald-400` |
| `rose` | `text-rose-600` | `bg-rose-400` |
| `stone` | `text-stone-500` | `bg-stone-400` |

**El tono NUNCA pinta un fondo** (v1.14.1). En v1.14 el tono era el fondo
del chip de categoría, y medido sobre el terminal eso resultó ser ruido:
los tonos se reparten en orden alfabético, así que el color no dice nada
del contenido (Bollería amarillo, Café rojo, Croissantysandwich verde), y
seis fondos de color compiten con la única señal que hay que leer en esa
fila, que es cuál está seleccionado. El tono vive en **el icono** del
chip y en **la banda de 4 px** de la tarjeta de producto.

Mapping recomendado: café/cervezas → `amber`; agua/refrescos azules →
`sky`; refrescos rojos → `red`; ensaladas/vegetales → `green`; postres →
`rose`; servicios sin almacén (peluquería) → `stone`.

## 3. Tipografía

**Familia**: **DM Sans** (Google Fonts, ya cargada en `index.css`).
Geometric sans con curvas suaves. Cálida sin ser infantil, profesional
sin ser fría. Combina con la geometría del iconmark.

```css
font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
font-feature-settings: 'cv11', 'ss01';
-webkit-font-smoothing: antialiased;
```

**Escala** (sentence case siempre, nunca Title Case ni ALL CAPS):

| Uso | Size | Weight | Tracking |
|---|---|---|---|
| Display (total cobro) | 36-64px | 600 | -0.025em |
| H1 página | 22-24px | 600 | -0.01em |
| H2 sección | 17-20px | 600 | -0.01em |
| H3 / subsección | 15px | 500 | normal |
| Body | 14-14.5px | 400 | normal |
| Label de input | 13px | 500 | normal |
| Caption / meta | 12-13px | 400 | normal |
| Eyebrow (UPPERCASE pequeña) | 10.5-11px | 500 | 0.06-0.12em |
| Tabular nums | siempre con `font-variant-numeric: tabular-nums` (clase Tailwind `tabular-nums`) para precios y conteos |

**Reglas:**

- Pesos permitidos: **400** (regular), **500** (medium), **600**
  (semibold). Nada de 700+ en interfaz — sólo en logo.
- Sin Title Case. Sin ALL CAPS salvo "eyebrows" (etiquetas pequeñas como
  "CARRITO · 3 LÍNEAS" o "SUBTOTAL").
- Letter-spacing negativo (`-0.01em` a `-0.025em`) sólo en headings
  grandes (≥ 18px). Cuanto más grande, más apretado.
- Importes siempre `tabular-nums` para alineación vertical.

### 3.1 Escala TPV · la venta de hostelería (v2-H1)

**Una escala POR ENCIMA de la general**, y sólo para la venta y la sala de
hostelería. No es una excepción de gusto: es la respuesta a una medida.

De dónde sale. El 07-10-2026 Matías aplazó la implantación de La Maestranza
después de ver la pantalla de venta en el D8: «lo tiene que leer un humano, a
toda velocidad y en pleno estrés, y la única distinción es una pequeña línea de
color, con el texto diminuto». La escala general está pensada para que un
administrativo lea una pantalla a 50 cm; ésta es para un camarero que mira una
pantalla **a un brazo de distancia, de reojo, con una bandeja en la otra mano**.
`ux-principles.md` §1.5 ya pedía 18-20 px en líneas de producto y 48 en el
total; esta tabla lo sube donde el hierro demostró que 18 no basta.

| Uso | Mínimo | Puesto en pantalla |
|---|---|---|
| Nombre de producto (botón de la cuadrícula) | **23 px** | 24 px / 600 |
| Nombre de producto (cuadrícula apretada, ≥ 25 productos) | **20 px** | 20-22 px / 600 |
| Línea de comanda · enviada | **20 px** | 21 px / 500 |
| Línea de comanda · sin enviar | **20 px** | 23 px / 600 |
| Cantidad de la línea sin enviar | — | 24 px / 600 |
| Total a cobrar | **44 px** | 46 px / 600, `-0.025em` |
| Botón «Cobrar» | **22 px** | 22 px / 600 |
| Botón «Enviar» | — | 20 px / 600 |
| Nombre de familia (barra de familias) | **21 px** | 21 px / 600 |
| Nombre de mesa (mapa de sala) | **26 px** | 28 px / 600 |
| Importe de mesa (mapa de sala) | **19 px** | 22 px / 600 `tabular-nums` |
| Eyebrow de sección («EN COCINA», «SIN ENVIAR», «BARRA») | — | 11 px / 500, `0.1em` |

**Los dos nombres de producto son el mismo token con dos peldaños**, no dos
decisiones: 23 px es el tamaño de la cuadrícula normal (hasta 20 productos, que
es 4 × 5) y 20 px es el suelo al que puede bajar una familia grande antes de
que el bloque tenga que decir «esta familia no cabe». Nunca por debajo de 20:
`v2-H1 §3b` prohíbe la paginación, no el tamaño legible.

Las medidas viven en `apps/tpv-web/src/lib/hospitalityTheme.ts` como
constantes, y las funciones puras de `hospitalityGrid.ts` las comen: un
sabotaje que baje el nombre a 17 px cambia el número que entra en la función y
el test cae. El resto del TPV (login, turno, cierre, tickets, cobro) y los
verticales RETAIL y SERVICES **siguen con la escala general de §3**.

## 4. Espaciado y radios

**Escala de radios** (consistente con `tailwind.config.reference.js`):

| Token | Valor | Uso |
|---|---|---|
| `rounded` | 4px | Atajos kbd, badges pequeños |
| `rounded-lg` | 8px | Bordes de tabla, separadores |
| `rounded-xl` | 12px | Avatares cuadrados, badges con icono |
| `rounded-2xl` | 16px | Botones, inputs, cards de producto, pills de categoría |
| `rounded-3xl` | 24px | Cards grandes (ticket panel, login card) |

**Sin esquinas tipo pill** (`rounded-full` con altura ≥ 40px) salvo en
status dots y avatares circulares. Las píldoras grandes ablandan
demasiado.

**Touch targets mínimos** (escala cerrada desde v1.12; en
`tailwind.config.js` como `h-touch` / `h-touch-pad` / `h-touch-lg`,
también disponibles como `min-h-*`):

| Token | Valor | ≈ mm en el AP11 | Uso |
|---|---|---|---|
| `touch` | **48 px** | 9 mm | Mínimo de cualquier control de uso diario: chips de zona, métodos de pago, atajos de billetes, casillas de la hoja de cobro, botones de modal. |
| `touch-pad` | **56 px** | 10 mm | Teclas del `CashPad` y del keypad del PIN. |
| `touch-lg` | **64 px** | 11 mm | Barra de cobro y acciones primarias de pantalla completa (Cobrar, Abrir turno). |

De dónde salen los números: pruebas físicas sobre el AP11-1006 del
2026-08-27 (`docs/qa/2026-08-27-pruebas-fisicas-ap11.md`, hallazgo H3).
Medido sobre pantalla real a 8,8 px/mm, lo que se toca cien veces al día
estaba a 5-7 mm —y las casillas de la hoja de cobro a **2,5 mm**—,
mientras que lo que se toca una vez (tarjetas de producto y de mesa)
estaba de sobra a 22-26 mm. El mínimo razonable con dedo de camarero y
prisa es 9-10 mm.

**Fuera de la escala, con nombre propio** (F1, 2026-09-23; clinica-2,
2026-10-06):

| Token | Valor | ≈ mm | Uso |
|---|---|---|---|
| `tap-fichar` | **208 px** | 24 mm | El botón de Entrar/Salir de la pantalla de fichar, y sólo ése. |
| `tap-valoracion` | **96 px** (80 px a ≤390 px) | 11 mm | El «Sí» / «No» del test de la valoración inicial que contesta el paciente, y sólo ésos. |
| `tap-cobrar-hosteleria` | **68 px** | 12 mm | El botón «Cobrar» de la venta de HOSTELERÍA (§9), y sólo ése. En RETAIL y SERVICES «Cobrar» se queda en `touch-lg` (64). |

De dónde sale: el botón de fichar no es "un control de uso diario", es
**el acto**. Se pulsa entrando por una puerta con el bolso en la otra mano,
sin mirar y a veces con guantes, una vez por jornada. Está en el orden de
la tarjeta de producto del TPV (22-26 mm, que las pruebas físicas del
27-08 dieron por sobradas) y no en el de una tecla. A 320 px de ancho —el
suelo del bucle visual— deja 56 px de margen a cada lado.

**De dónde sale `tap-valoracion`** (clinica-2): el test de la valoración lo
contesta **el paciente**, no el personal. La clínica de podología atiende a
muchas personas mayores y poco duchas en tecnología: una pregunta por
pantalla, letra grande y dos botones enormes. No es «un control de uso
diario» —se toca diez veces en la vida de ese paciente— y de lo que
conteste depende que nadie la trate sin saber que está anticoagulada.

El número no se ha elegido aquí: está en el mockup que Matías validó el
05-10-2026 (`docs/mockups/clinica-2-valoracion.html`), y el prompt del
bloque lo fija («los botones Sí/No del mockup son más grandes y así se
quedan»). El resto del test respeta el mínimo de la casa: «No lo sé» 64 px,
los botones de detalle 64 px, «Seguir» 72 px, «Atrás» 56 px.

A 320 px de ancho —el suelo del bucle visual— dos botones de 96 px con
12 px de hueco y 20 px de margen entran sin tocarse.

**De dónde sale `tap-cobrar-hosteleria`** (v2-H1): lo fija el prompt del bloque
(«Táctil: ningún objetivo < 56 px en tablet; Cobrar 68 px») y la maqueta que
Matías revisó el 07-10-2026 (`docs/mockups/v2-hosteleria/venta-oscuro.dc.html`,
`height: 68px`). Son **4 px por encima de `touch-lg`**, y no se han redondeado
a 64 porque en esta pantalla «Cobrar» comparte fila con «Enviar» y la jerarquía
entre los dos la construyen el ancho (`flex 1.3` contra `1`), el relleno (coral
pleno contra borde) **y** el alto — exactamente el reparto de tres variables que
v1.14.1 midió en el panel claro. Con los dos a 64 la fila vuelve a leerse como
una pareja de iguales, que es el fallo que v1.14.1 documenta.

Que sea un token con nombre y no un `h-[68px]` suelto es justo lo que esta
sección pide: el número vive aquí, el componente lo lee, y hay test de que
ningún componente de la venta oscura escribe una altura a mano.

Son los tres únicos controles del sistema fuera de la escala de tres
peldaños, y están aquí para que sigan siendo tres: cualquier otro se discute
antes.

**Y uno que se quedó DENTRO de la escala a propósito** (clinica-3,
2026-10-07): las **zonas táctiles del mapa del pie**. El prompt del bloque
pedía «ninguna zona por debajo de 44 px»; el mínimo de la casa es 48, así que
el mapa se dimensionó para cumplir el de la casa y no el del prompt — no hacía
falta token nuevo, hacía falta elegir bien el ancho del pie.

La cuenta vive en el paquete compartido, junto a la geometría que escala
(`packages/clinica-sesion/src/mapa.ts`): el radio mínimo de una zona son **22
unidades** de un `viewBox` de 240, y el pie se pinta a **264 px**
(`ANCHO_DEL_PIE_PX`). O sea 2 × 22 × 264/240 = **48,4 px** de dedo. El ancho es
un `max-width` y no un fijo, y por eso en móvil los pies **bajan a una fila
cada uno**: una fila de 320 px menos márgenes da 288, que es más que 264, así
que el pie nunca se pinta por debajo de su ancho nominal y el mínimo se cumple
a 1024, a 390 y a 320.

Se mide EN LA CAPTURA (`docs/qa/2026-10-07-clinica-3/`) y además lo cuenta un
test zona por zona, sobre la geometría que el DOM lleva puesta y no sobre una
constante.

**Regla:** no se suben alturas con `h-[52px]` sueltos. Si un control no
entra en la escala, primero se discute el token; luego se implementa.

Nota sobre radios en controles de 48 px: las píldoras (`rounded-full`)
dejan de usarse al llegar a esa altura — los chips de zona pasaron a
`rounded-2xl` en v1.12, siguiendo la regla de "sin esquinas tipo pill
con altura ≥ 40 px" de la sección anterior.

**Padding interno de cards:** 16-28px según tamaño. Cards grandes
(ticket panel) 28px horizontal, 20-24px vertical.

## 5. Componentes base (inventario)

Todos los componentes implementados en `reference-app.tsx`. Lista
canónica para reutilizar:

### Botón primario
- Background `mipiace.coral`, hover `mipiace.coral-dark`.
- Texto blanco, weight 500, size 14-15px.
- Alto 48 / 56 / 64px según contexto.
- `rounded-2xl`.

### Botón secundario / outline
- Border `mipiace.coral/30`, texto `mipiace.coral-dark`.
- Hover bg `mipiace.coral-soft`.
- Mismas alturas que primario.

### Botón fantasma (quick actions)
- Background `mipiace.stone`, hover `slate-100`.
- Texto `mipiace.ink`, weight 500.
- Sin borde.

### Input
- Alto 48 / 56px.
- Background `mipiace.stone`, border transparente.
- Focus: ring 2px `coral/40`, border `coral/30`, bg blanco.
- `rounded-2xl` para inputs grandes, `rounded-xl` para inputs en
  formularios.

### Card
- Background blanco, border `slate-200` 0.5-1px, `rounded-3xl` para
  cards principales, `rounded-2xl` para cards medianos.
- Padding 24-28px.
- Sin sombras pesadas (máximo `shadow-sm` en hover).

### Badge / chip
- `rounded-xl` (no full).
- Padding 4-6px vertical, 10-12px horizontal.
- Tamaños: 11-12px texto, weight 500.
- Variantes: `coral-soft` con texto `coral-dark`, `stone` con `ink`,
  `emerald-100` con `emerald-700` (success).

### Sidebar item
- Alto 44-48px.
- Padding horizontal 16px (xl) / centered (md).
- Activo: bg `mipiace.coral-soft`, texto `coral-dark`, icon `coral`.
- Inactivo: hover `slate-50`, texto `slate-600`.

### Producto card (TPV) · v1.14.1
Compacta y **tipográfica**: el nombre y el precio SON el producto.

- Alto **104 px** (`PRODUCT_CARD_MIN_HEIGHT` en `lib/catalogGrid.ts`), el
  mismo con foto y sin ella. `rounded-2xl`, borde `slate-200`, hover
  border `coral/50` y sombra suave.
- **Sin foto** (el caso normal: Holded casi nunca las trae): nada de
  icono. Sólo una **banda de 4 px** arriba con el tono de la categoría.
- **Con foto**: la imagen ocupa la tarjeta entera bajo un velo
  (`from-black/75` a `to-black/5`) con nombre y precio encima en blanco.
- Nombre `line-clamp-2` a 13,5 px/500; precio 15 px/600 `tabular-nums`
  anclado abajo. **El precio pesa más que el nombre**: en una barra el
  nombre se reconoce de memoria y lo que se comprueba es el importe.

De dónde sale el 104: a 1280 × 800 con el panel del ticket abierto, la
columna del catálogo deja 504 px útiles con una fila de chips. Cuatro
tarjetas de 104 más tres huecos de 14 son 458, y la quinta fila asoma
32 px como pista de scroll. **Se ven cuatro filas completas.** Con el
placeholder de v1.14 (206 px de tarjeta, 125 de ellos icono genérico
idéntico en todas) se veían dos.

El alto no puede depender de si hay foto: si la tarjeta con foto midiera
más, un catálogo a medio fotografiar dejaría la rejilla con filas rotas.

### Mesa card (mapa de sala) · v1.23
- **168 × 118 px**, `rounded-[18px]`, border 2px. El tamaño sale de
  `TABLE_CARD_WIDTH` / `TABLE_CARD_HEIGHT` en `lib/roomGrid.ts`, y la
  clase que lo pinta es `TABLE_CARD_SIZE_CLASS`. **Un solo tamaño para
  toda mesa**, en las cuatro zonas (Salón, Terraza, Reservados, Barra) y
  en las dos vistas del mapa (Todas y filtrada por zona).
- Estados: free (white + slate-200), open (coral-soft + coral/40),
  billing (amber-50 + amber-300/60).
- Layout interno: ID arriba izquierda, capacidad arriba derecha, info
  (tiempo, comensales, camarero, total) abajo.
- Por debajo de `sm` la rejilla de cada zona son **dos columnas**
  (`ROOM_GRID_CLASS`) y la tarjeta ocupa el ancho de su celda: **153 ×
  118** a 390 px. Sigue midiendo lo mismo que sus vecinas en todas las
  zonas; lo que cambia con la pantalla es cuánto vale ese "lo mismo". El
  alto no cambia nunca: una mesa no es más baja en un móvil.
  Con una sola columna la tarjeta subía a 320 px y el mapa de 16 mesas a
  2.614 px de largo; con dos son 1.481 y se ve el doble de sala por
  pantallazo. Tres columnas dejarían la tarjeta en 98 px.

De dónde sale el 168: es el mayor ancho con el que la sala del AP13
(6 Salón + 6 Terraza + 4 Barra) entra entera **sin desplazar** a
1280 × 800. Una banda de 6 mesas pide `6·W + 5·14 + 36`; con 168 son
1114 de los 1224 útiles, y las tres bandas suman 546 px de alto sobre
los 560 disponibles.

Hasta v1.22 el tamaño lo fijaba la **zona**, no la mesa: el lienzo daba a
Salón todo el ancho sobrante y encerraba Terraza en 300 px, y dentro de
cada marco había un `grid-cols-2`. Medido en el AP13 a 1443 × 812, la
misma mesa de 4 personas era 509 × 118 en Salón, 124 × 118 en Terraza y
un círculo de 84 × 84 en Barra: **7,1× de diferencia de área para el
mismo objeto** (E1 de la auditoría del 2026-09-02). El sitio de barra ya
no es un taburete: es la misma tarjeta, y la identidad de la zona la da
el mostrador dibujado encima.

**Regla:** si una zona necesitara su propio tamaño de mesa, se discute
aquí primero. No se añaden anchos sueltos en el componente.

### CashPad (teclado numérico propio) · v1.12
- Grid de 3 columnas, mismas medidas que el keypad del PIN.
- Teclas `h-touch-pad` (56px), `rounded-2xl`, fondo `mipiace.stone`,
  hover `slate-100`, texto 22px `tabular-nums`.
- Fila inferior aparte con `C` (limpiar) y `⌫` (borrar último).
- Sin coma en modo conteo (`maxDecimals = 0`); ahí el `0` ocupa el hueco
  de la coma en vez de dejar una tecla muerta bajo el pulgar.
- Una sola instancia por hoja, siempre en el borde inferior. Nunca tapa
  ni desplaza el botón primario: la hoja se reparte cabecera → campo
  activo → pad → botón. A partir de `sm`, en el arqueo y en la apertura
  de turno, el pad se va a su propia columna.

### AmountField (campo de importe) · v1.12
- `h-touch` (48px) normal, `h-touch-lg` (64px) en pantalla completa.
- Blanco con borde `slate-200`; activo: borde coral + ring `coral/30`.
- `tabular-nums`, alineado a la derecha, sufijo `€` en gris.
- **Nunca** editable a mano: `readOnly` + `inputMode="none"` + blur al
  foco + `user-select: none` + `-webkit-touch-callout: none`. El teclado
  del sistema no debe aparecer en ninguna pantalla de caja.

### ConfirmSheet (acciones destructivas) · v1.12
- Card `rounded-3xl` centrada (abajo en móvil), título H2 y cuerpo body.
- Dos botones `h-touch`: destructivo en coral, salida neutra con borde.
- Verbos explícitos y **distintos**: "Vaciar mesa" / "Volver",
  "Cancelar la venta" / "Seguir con la venta". Nunca "Aceptar/Cancelar",
  nunca dos botones que empiecen por la misma palabra.
- Sustituye a `window.confirm()`, que en el terminal sale con la marca
  del navegador y botones azules de Chrome.

### Línea de carrito
- Avatar cuadrado (`rounded-xl`) con cantidad en stone.
- Nombre + meta (precio unitario o modificador) en columna.
- Total línea a la derecha, weight 500, tabular-nums.
- Botón eliminar `opacity-0 group-hover:opacity-100`.
- **Destaque al añadir** (v1.14): la línea recién tocada se pinta en
  `coral-soft`. Entra **sin transición** y sale con `transition-colors
  duration-700`. El orden importa: con transición también al encender,
  el coral se desvanecía *hacia dentro* y a los 150 ms del toque el alfa
  iba por 0,004 — invisible justo cuando hay que confirmar. El principio
  §1.3 pide feedback claro en menos de 100 ms (medido: 66 ms).

### Panel del ticket · v1.14
Orden fijo, de arriba abajo. Es el reparto que arregla el hallazgo C1 de
la auditoría del 2026-09-01 (antes: 20 px visibles de desglose):

1. **Cabecera compacta** `shrink-0`: nombre de mesa + meta en UNA línea
   (`truncate`) + botón "Más" (`h-touch`). El botón "Mapa" **no** vive
   aquí: está en la barra superior.
2. **Lista de artículos** `flex-1 min-h-0 overflow-y-auto`. Es el único
   bloque flexible del panel y el único que scrollea.
3. **Pie anclado** `sticky bottom-0 shrink-0` con fondo sólido y borde
   superior: Subtotal + IVA en una fila, Total en display, y las dos
   acciones **en fila** — pero NO a mitades (v1.14.1). "Cobrar" es la
   acción de la pantalla y "Enviar comanda" es de trámite, así que la
   jerarquía se construye con las tres variables a la vez:
   `grid-cols-[1fr_1.6fr]` (dos tercios del ancho), `h-touch-lg` contra
   `h-touch` (64 contra 48) y coral pleno contra borde neutro. Con una
   sola variable no basta: dos botones del mismo alto y ancho con
   distinto color se siguen leyendo como una pareja de iguales.
   La escala táctil se cierra en 64 (§4): no se sube "Cobrar" a 72 con un
   `h-[72px]` suelto.

Medido a 1280×800 con 12 líneas: cabecera 84 px, lista 304 px (3,4
líneas), pie 187 px; "Cobrar" termina en y=683 de 800.

Las siete acciones secundarias (Cliente, Descuento, Observaciones, Mover
mesa, Partir cuenta, Agrupar, Vaciar mesa) van en el sheet de "Más". La
destructiva se aparta a su propia zona bajo un borde, con la
consecuencia escrita al lado.

### Chips de categoría · v1.14.1
- `h-touch`, `rounded-2xl`, borde 1px, icono Lucide `strokeWidth 2.25`,
  etiqueta `truncate` con `max-w-[200px]`.
- **Fondo neutro** (`bg-white`, borde `slate-200`). El tono de §2 pinta
  **sólo el icono**. El reparto de tonos lo hace `lib/categoryTones.ts` y
  se **persiste por tenant**: el color de una categoría no puede cambiar
  entre lunes y martes.
- **UNA sola fila** (`flex-nowrap` + `overflow-hidden`, sin
  `overflow-x`). Lo que no cabe se va a un chip `Más (N)` que abre un
  sheet con todas. El scroll horizontal está prohibido por
  `ux-principles.md` §1.8 y un gradiente no lo arregla; y dos filas
  tampoco lo arreglaban — costaban ~100 px de alto en una pantalla donde
  sólo cabían dos filas de producto y, con "Más (3)", seguían sin verse
  todas las categorías. El problema se había movido de eje.
- **El seleccionado va en coral SUAVE**: `bg-coral-soft` + borde coral +
  texto `coral-dark`, que es lo que §2 reserva para "estado activo de
  nav". Un chip en reposo nunca lleva coral.
- **El coral PLENO no es de los chips.** En el área de trabajo —catálogo
  y panel del ticket— sólo lo lleva "Cobrar". "Todos" iba en `ink` pleno
  hasta v1.14 y era el elemento de más contraste de la pantalla,
  compitiendo con la caja.

### Estado vacío del ticket, y el hueco del desglose · v1.14.1
- Nunca en blanco: rejilla de **2 columnas** con los productos más
  vendidos del turno (o del mes), `min-h-touch-lg`, nombre arriba y
  precio debajo.
- Rejilla y no lista: apilados en una columna se leen como líneas ya
  añadidas, que es lo contrario de lo que son.
- Sin ranking (offline, sin histórico) cae a la frase de siempre.
- **La misma rejilla llena el hueco que queda bajo una sola línea**
  (v1.14.1). Con un ticket de una línea el desglose son 90 px de línea y
  ~214 de nada, y el panel no parece un ticket: parece roto. Cuelga
  DEBAJO de la lista, tras un borde, y **desaparece en cuanto compite con
  las líneas**, que son el contenido.
- Cuántos caben lo decide `topSellersSlotsFor(lineCount)`, una sola regla
  compartida por la carga del ranking y el pintado: 5 con el ticket
  vacío, 2 con una línea, ninguno a partir de dos. Los números están
  medidos, no sumados sobre el papel — dos filas de atajos con una línea
  piden 193 px sobre 190 disponibles, y **no se aprietan los márgenes
  para que entren por tres píxeles**: v1.14 ya cortó por abajo el quinto
  atajo del estado vacío haciendo eso, y un atajo cortado es peor que un
  atajo que no está.

## 6. Breakpoints

Tailwind estándar:

| Breakpoint | Min-width | Uso típico |
|---|---|---|
| `sm` | 640px | móvil grande, tablet portrait pequeña |
| `md` | 768px | tablet portrait, mostrar sidebar compacto en TPV |
| `lg` | 1024px | tablet landscape, desktop pequeño, mostrar ticket panel |
| `xl` | 1280px | desktop, sidebar TPV expandido |
| `2xl` | 1536px | desktop grande |

**Reglas por pantalla:**

- **TPV venta / mesa / mapa**: prioritario tablet landscape (≥ 1024px).
  En tablet portrait (768-1023) el ticket panel se apila debajo de los
  productos. En móvil (< 768) sidebar oculto, productos en grid 2 col,
  ticket apilado.
- **TPV emparejamiento / PIN / apertura turno / cobro**: mobile-first,
  centered, max-w-md o max-w-lg.
- **Admin**: prioritario desktop. Sidebar oculto < md, completo ≥ md.

## 7. Iconografía

**Librería**: [Lucide React](https://lucide.dev) (`lucide-react@0.383+`).
Coherente, líneas finas, geometric. Combina con DM Sans.

**Reglas de uso:**

- Stroke width `2.25` en iconos de interfaz general (botones, tabs).
- Stroke width `1.4` en iconos grandes decorativos (productos en grid).
- Tamaños: 16px (inline texto), 18px (botones), 20px (acciones
  destacadas), 48px (iconos de producto).
- Iconos de status (`Wifi`, `Bell`, dots) en colores semánticos
  (`emerald-500`, `coral`).

**No usar emojis** en interfaz. Sólo iconos vectoriales.

## 8. Animación

- Transiciones suaves de 150-200ms en hover (`transition-colors`,
  `transition-all`).
- Sin animaciones de entrada de página complejas.
- Sin parallax, sin scroll-driven animations, sin lottie.
- El feedback de "deshacer" del carrito es la única animación
  permitida con timing visible (banner desliza 200ms in, 200ms out,
  4000ms visible).

## 9. Oscuro · hostelería (v2-H1)

Llegó lo que §9 dejaba pendiente, y llegó **acotado**: el tema oscuro es de
**la venta y la sala de HOSTELERÍA**, dos pantallas. No es un toggle, no es
`prefers-color-scheme` y no es de todo el TPV. El login, la apertura y el
cierre de turno, el cobro, los tickets, el arqueo y los verticales **RETAIL y
SERVICES siguen claros** — Thalía, Cachictos y Sole usan la misma `SalePage` y
no deben notar nada (hay test de render de las dos variantes).

Por qué sólo esas dos: son las dos pantallas que un camarero mira ocho horas
seguidas en un local con poca luz, y las dos donde el contenido es **color
plano sobre fondo** (el color de la familia, el estado de la mesa). Sobre fondo
claro, nueve rellenos pastel compiten con el papel; sobre fondo carbón
resaltan. El resto del TPV se mira de pasada y vive mejor en claro.

Las constantes están en `apps/tpv-web/src/lib/hospitalityTheme.ts`. **Ningún
hex suelto en un componente**: hay test que lo prohíbe.

### 9.1 Superficies y texto

| Token | Hex | Uso |
|---|---|---|
| `dark.canvas` | `#0E1013` | Fondo de la pantalla. Casi negro, no negro: el negro puro con texto claro produce halo en el WebView del D8. |
| `dark.panel` | `#171A1F` | La comanda (panel izquierdo de la venta). Un peldaño por encima del fondo. |
| `dark.surface` | `#1C2026` | Botones en reposo (cantidad no elegida, chip de zona no elegido). |
| `dark.surface-raised` | `#23272E` | Separadores, botón de volver, franja de la barra en el mapa. |
| `dark.surface-key` | `#2C313A` | Las teclas `−` / `+` de la línea sin enviar. Suben otro peldaño porque son lo único que se pulsa DENTRO de una lista. |
| `dark.ink` | `#15171B` | Texto sobre un relleno claro (nombre de producto sobre el color de su familia, mesa libre). |
| `dark.text` | `#F1F3F5` | Texto principal. |
| `dark.text-soft` | `#E4E7EB` | Texto de botón en reposo. |
| `dark.text-muted` | `#8B93A1` | Eyebrows, meta, líneas ya enviadas. **Nunca** para un importe ni para un nombre de producto (§4 del principio: nada de gris claro para información que se usa). |
| `dark.link` | `#F2A08F` | Enlaces. Coral aclarado: el `#E97058` sobre `#0E1013` no llega a 4,5:1 en texto pequeño. |

El **coral se mantiene** (`mipiace.coral` `#E97058`) y luce sobre carbón, como
anticipaba el §9 viejo. Lo que cambia es la **regla de uso**: en estas dos
pantallas el coral pleno es de **«Cobrar»**, de la **vista/familia activa
especial** («Ahora») y del **estado «ocupada»** de una mesa. Tres sitios, y
ninguno más — la regla de «un solo coral pleno por área de trabajo» de v1.14.1
se amplía a tres porque son tres áreas distintas (el pie de la comanda, la
barra de familias y el lienzo de la sala), no tres cosas en la misma.

### 9.2 Estados de mesa

| Estado | Relleno | Texto | Extra |
|---|---|---|---|
| Libre | `#E9ECEF` | `#0E1013` | sólo contorno si la zona lo pide |
| Ocupada | `#E97058` | `#FFFFFF` | importe grande + minutos |
| Pide la cuenta | `#E2B23A` | `#1B1500` | — |
| +45 min sin atender | `#E97058` | `#FFFFFF` | aro `#E2B23A` de 4 px |

El ámbar es `#E2B23A` y no el `amber-*` de Tailwind: sobre carbón los ámbar de
la escala clara se van a marrón. Sigue siendo el ámbar de «atención / pidiendo
cuenta» de §2, con el valor que ese fondo necesita.

**La mesa libre es la más clara de la sala, a propósito.** Es el inverso de la
pantalla clara, donde la libre era blanca con borde fino y desaparecía. En un
bar lo que se busca de un vistazo es «dónde puedo sentar a estos cuatro», y eso
tiene que ser lo que más salta.

### 9.3 Paleta de familia · 9 tonos

El color de la familia **pinta el botón entero**, no una banda de 4 px. Es la
rectificación medida de v1.14.1: allí el tono se retiró del fondo porque el
reparto era alfabético y el color no decía nada del contenido, y porque seis
fondos competían con la señal de «cuál está seleccionado». En hostelería, con
**familia primero y producto después**, la cuadrícula enseña UNA familia a la
vez: ya no hay nueve colores compitiendo en la misma rejilla, y el color pasa
de ruido a ser lo que te lleva a la familia correcta sin leer.

| Tono | Hex | Pista de categoría |
|---|---|---|
| `hosp.cafes` | `#F3B992` | café, infusión, desayuno caliente |
| `hosp.desayunos` | `#CACD8C` | tostada, bollería, pincho |
| `hosp.cervezas` | `#E1C487` | cerveza, caña, tercio |
| `hosp.refrescos` | `#86D5EE` | agua, refresco, zumo |
| `hosp.vinos` | `#D8B8F1` | vino, copa |
| `hosp.licores` | `#A7C9FF` | licor, destilado, combinado |
| `hosp.raciones` | `#96D9B4` | ración, tapa, entrante |
| `hosp.bocadillos` | `#F3B1CF` | bocadillo, montado, sándwich |
| `hosp.platos` | `#B0D49D` | plato, menú, carne, pescado |

Nueve y no seis porque una carta de bar tiene nueve familias (La Maestranza
tiene nueve exactas) y con seis tonos dos familias vecinas comparten color, que
es lo contrario de lo que el color viene a hacer aquí. Son pastel claro con
texto `dark.ink` porque es lo que da contraste de texto sobre un relleno
saturado sin pedir blanco (el blanco sobre pastel no llega a 4,5:1).

**El reparto es estable por categoría y se persiste por tenant**, con la misma
regla y el mismo almacén que `categoryTones.ts`: el color de «Cafés» es el
mismo el lunes y el martes, porque lo que se aprende es el color y la posición,
no el nombre. Si una categoría no cae en ninguna pista, se le asigna el tono
menos usado y queda escrito.

El coral **no está** en esta paleta, por la misma razón que no estaba en la de
seis: lo lleva «Ahora», que es la vista especial.

### 9.4 Lo que NO cambia

- La escala táctil de §4 (48 / 56 / 64) sigue siendo el suelo. Esta pantalla usa
  **56 como mínimo real** (`ux-principles` §1.2 pedía 64 en la pantalla
  principal de venta; el prompt de v2-H1 fija 56 en tablet y 68 para «Cobrar»,
  que es `touch-lg` + 4 — ver la nota de §4).
- Los radios de §4.
- La animación: sólo el feedback de pulsado (`scale(0.97)`, 120 ms).
- DM Sans con los pesos 400/500/600. Nada de 700 — y por eso la tarjeta de mesa
  del mapa oscuro baja de `font-bold` a 600, que es lo que §3 permite.

## 10. Referencias

- `docs/design/reference-app.tsx` — código fuente de las 9 pantallas v1.
  Code lo lee para copiar patrones literales al implementar B3/B4.
- `docs/design/tailwind.config.reference.js` — configuración Tailwind
  con los tokens `mipiace.*`. Copiar a `apps/admin/` y `apps/tpv-web/`.
- `docs/design/index.reference.css` — CSS variables + import de DM Sans.
- `docs/design/mockups/tpv-v1-pantallas.html` — bundle navegable con las
  9 pantallas para revisión visual.
- `docs/ux-principles.md` — principios transversales (densidad,
  latencia percibida, anti-patrones).
