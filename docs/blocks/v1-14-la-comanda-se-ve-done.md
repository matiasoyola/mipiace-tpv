# Bloque v1.14 · La comanda se ve — DONE

Origen: **auditoría de la pantalla de venta del 2026-09-01**
(`docs/qa/2026-09-01-auditoria-pantalla-venta.md`, nota 6,5/10), levantada sobre 50 capturas del
terminal físico **AP11-1006 a 1280 × 800 CSS** (`docs/qa/2026-09-01-ap11-ronda2/`). Este bloque
cierra C1, M1, M2, M3, M4, m1 y m2.

La frase que ordena el bloque: **el panel del ticket dedicaba 225 de sus 573 px a cabecera y a
siete acciones que se usan una de cada veinte veces, y dejaba 20 px al desglose de artículos.** Al
tocar un producto el camarero no veía confirmación de nada, y en hora punta eso se paga con dobles
pulsaciones y cafés cobrados de más. Es un fallo de dinero, no de diseño.

Verde antes de empezar: **158 ficheros de test, 1377 tests** y `tsc --noEmit` en las dos apps.

---

## 1 · Panel del ticket: la jerarquía al revés (C1, crítico)

`pages/SalePage.tsx` (`TicketPanel`), `pages/CartLineItem.tsx`, `pages/SalePage.moreSheets.tsx`.

El orden nuevo, y lo que mide cada bloque a 1280 × 800 con un ticket de 12 líneas:

| Bloque | Antes (medido en el AP11) | Ahora (medido en el bucle visual) |
|---|---|---|
| Cabecera | ~90 px | **84 px** — meta en una línea, con el botón "Más" |
| Siete acciones secundarias | ~135 px | **0 px** — se van al sheet de "Más" |
| **Lista de artículos** | **20 px** | **304 px** (3,4 líneas de 90 px) |
| Totales + "Enviar comanda" + "Cobrar" | ~254 px | **187 px**, anclados al pie |

`Cobrar` termina en **y=683 de 800**, sin scroll, con el ticket de 12 líneas.

**Los dos layouts tienen ahora la misma forma.** El aside de escritorio y el bottom-sheet handheld
divergían: el sheet ya invertía el reparto por su cuenta (v1.10.3, hallazgo #3 de la simulación de
hora punta) y el aside seguía con los bloques fijos arriba. Ahora los dos son cabecera `shrink-0` +
lista `flex-1 min-h-0 overflow-y-auto` + pie `sticky bottom-0 shrink-0`. Una forma menos que
mantener, y el `layout="sheet"` queda sólo como marca de dónde se monta.

El `sticky` del pie no es decorativo: en ventanas de menos de 700 px de alto el aside vuelve al
flujo natural de la página (v1.5-hotfix4, porque los bloques fijos estrangulaban el listado a
0 px), y ahí es lo único que mantiene el Total en pantalla.

**Feedback al añadir línea** — el núcleo del bloque. La señal se emite en `SalePage`, en el mismo
gesto y sin esperar al servidor (principio §1.1). Dos detalles que no son cosméticos:

- **Un contador (`nonce`), no sólo el id.** Dos toques seguidos al mismo café agrupan en la MISMA
  línea; sin un contador que cambie siempre, el segundo toque no dispararía destaque. Y ese
  silencio es exactamente lo que produce la tercera pulsación y el café de más.
- **El destaque entra de golpe y sólo sale con transición.** Con `transition-colors` en los dos
  estados el coral se desvanecía *hacia dentro* durante 700 ms: medido en el navegador a los 150 ms
  del toque, el alfa iba por **0,004** — invisible justo en el instante en que hay que confirmar.
  Lo encontró el bucle visual, no la suite. Ahora el estado destacado va `transition-none` y es el
  apagado el que se desvanece: **66 ms hasta el coral pleno**, contra los 100 ms que pide el
  principio §1.3.

El scroll hasta la línea usa `block: "nearest"`, que no mueve nada si ya se ve — el listado no debe
dar un salto por cada café.

**Las siete secundarias y el "Mapa" se van del panel.** Cliente, Descuento, Observaciones, Mover
mesa, Partir cuenta, Agrupar/Desagrupar y Vaciar mesa viven en el sheet de "Más". "Vaciar mesa" se
aparta a su propia zona bajo un borde, en rojo suave y con la consecuencia escrita al lado
(hallazgo m1: la acción más destructiva estaba en coral, arriba a la derecha, compitiendo con
"Cobrar"). El botón "Mapa" sube a la barra superior (§3).

**m2 · la CTA primaria pasa de 56 px a `h-touch-lg` (64).** También "Enviar comanda". El propio
sistema visual mandaba 64-72 y la pantalla iba a 56.

---

## 2 · Categorías: se acabó el scroll horizontal (M1, M2, m2)

`lib/chipRows.ts` (nuevo), `lib/categoryTones.ts` (nuevo), `pages/SalePage.tsx`,
`pages/SalePage.moreSheets.tsx`.

**M1 · dos filas y "Más (N)".** La fila deja de llevar `overflow-x-auto`. Los chips envuelven a un
máximo de dos filas y lo que no cabe va a un chip `Más (N)` que abre un sheet. No se ha puesto un
gradiente: `docs/ux-principles.md` §1.8 prohíbe el scroll horizontal en táctil, y una pista visual
sobre una función ilegible sigue siendo una función ilegible.

El reparto es una **función pura** del ancho disponible y de las etiquetas (`layoutChips`). Medir
cada chip en el DOM obligaría a un render de dos pasadas que parpadea y que en un `flex-wrap` puede
oscilar: quitas un chip, cambia el reparto, vuelve a caber, lo metes otra vez. Lo que sí se mide es
**el ancho del contenedor**, un solo número, con un `ResizeObserver` que ignora cambios menores de
1 px para no realimentarse con el cambio de alto que él mismo provoca.

**M2 · color e icono.** Los seis tonos de `docs/design/tokens.md` §2 (`amber`, `sky`, `red`,
`green`, `rose`, `stone`) estaban definidos y sin usar. Ahora los reparte `categoryTones.ts` con
heurística por nombre (café/cerveza → amber, agua/refresco → sky…) y **el reparto se persiste por
tenant**: el color de "Cafés" tiene que ser el mismo el lunes que el martes, porque lo que se
aprende es el color y la posición, no el nombre. Lo ya asignado no se reasigna nunca, y lo nuevo se
asigna en orden alfabético, no en el orden en que Holded devuelva los productos ese día.

Los iconos son Lucide a `strokeWidth 2.25`. `categoryTones.ts` decide el **nombre** del icono y
`SalePage` lo resuelve contra su import: así el módulo de tonos sigue siendo puro y se testea sin
montar React.

**m2 · el coral es de la selección.** Un chip en reposo nunca es coral. "Todos" seleccionado va en
`mipiace.ink`. Cuando el coral lo llevaba "Todos" de forma fija, le robaba la señal a la selección
real y el ojo no encontraba en qué categoría estaba.

---

## 3 · La barra superior según el vertical (M3, M4)

`pages/SalePage.tsx`, leyendo `businessType` del tenant, que ya existía y ya se usa en `App.tsx`.

**HOSPITALITY** · "Mapa" es la CTA grande de la izquierda, `h-touch-lg`, con icono y texto — y se
pinta **también en modo mesa**, que es justo cuando hace falta. Antes era un chip de 9 px de alto
enterrado dentro del panel del ticket, compitiendo con el nombre de la mesa, siendo la navegación
más frecuente del turno (M4). La búsqueda se pliega tras una lupa y se despliega al pulsarla: medía
**768 × 56 px sobre 1280** —el 60 % de la franja más valiosa— en una pantalla donde casi no se usa.

**RETAIL / SERVICES** · la búsqueda se queda ancha (ahí sí es la acción primaria) y "Mapa" no se
pinta: esos verticales no tienen mesas y `App.tsx` ya se salta la pantalla de mapa para ellos.

**El campo plegado NO se desmonta.** Sigue montado fuera de cuadro (`-left-[9999px]`, no `hidden`,
que impediría el foco) porque es donde aterriza el lector de códigos **USB-HID**: el refoco de
`SalePage` escribe en `searchRef`. Desmontarlo dejaría sin escáner a los tenants con lector USB,
que es peor que el problema que el pliegue arregla. Fuera de cuadro no es tocable, así que en
táctil tampoco abre el teclado del sistema.

---

## 4 · Estado vacío del ticket con inteligencia

`apps/api/src/tpv-catalog/routes.ts` (endpoint nuevo), `lib/topSellers.ts` (nuevo),
`pages/SalePage.tsx` (`TicketEmptyState`).

`GET /tpv/catalog/top-sellers` agrega `TicketLine` por producto. Tres decisiones que es donde un
ranking se estropea sin que nadie lo note:

- **Sólo ventas de verdad.** Un `DRAFT` es una mesa abierta (todavía no se ha vendido nada), un
  `VOIDED` es una mesa vaciada y un `TEST` es el cajero técnico del onboarding. Cuentan `PAID`,
  `PENDING_SYNC`, `SYNCED`, `SYNC_FAILED` y `ON_CREDIT`.
- **El corte es por unidades, no por importe.** Lo que acelera la comanda es lo que más veces se
  pulsa, no lo que más factura: dos vinos de 18 € no deben adelantar a veinte cafés.
- **El turno manda, pero un turno recién abierto con una venta no es señal.** Por debajo de la
  mitad de los huecos se cae al último mes, y el rótulo lo dice ("Lo que más sale este turno" / "…
  este mes"). Lo que ya no está en el catálogo se filtra en el servidor.

En el TPV se cachea 2 minutos y se resuelve contra el catálogo local. Un fallo de red no rompe
nada: el estado vacío cae a la frase de siempre. Nunca a un hueco.

---

## Sabotaje → test rojo

**El criterio del bloque no es "suite verde".** Cada sabotaje se aplicó de verdad sobre el código,
se corrió la suite y se revirtió. Esto es lo que cayó:

| Sabotaje aplicado | Tests que se pusieron en rojo |
|---|---|
| Quitar `flex-1` del contenedor de líneas | `sale-ticket-hierarchy` › **SABOTAJE `flex-1` · la lista de artículos ocupa el espacio flexible** (1 rojo de 10) |
| Devolver 20 categorías y volver a `overflow-x-auto` sin chip "Más (N)" | `sale-categories` › **SABOTAJE 20 categorías**, + el sheet y la selección desde el sheet (3 rojos de 9) |
| Pintar "Mapa" sin mirar `businessType` (con `businessType=RETAIL`) | `sale-topbar-vertical` › **SABOTAJE businessType=RETAIL · el botón Mapa NO se pinta**, + el caso SERVICES (2 rojos de 12) |
| Ticket de 12 líneas con totales DENTRO del área que scrollea | `sale-ticket-hierarchy` › **SABOTAJE 12 líneas · Total y Cobrar quedan FUERA de lo que scrollea**, + orden de bloques y `flex-1` (3 rojos de 10) |
| Quitar las 5 llamadas a `touchLine` al añadir línea | `sale-ticket-hierarchy` › **SABOTAJE añadir producto**, + apagado, doble pulsación y "no espera al servidor" (4 rojos de 10) |

**El sabotaje del ticket de 12 líneas encontró un agujero en mi propio test, y por eso está aquí.**
La primera versión sólo comprobaba que el pie no colgaba del contenedor de líneas. Envolver líneas
y pie en un scroll común rompe el invariante igual —el Total se va de la vista al bajar— y esa
versión del test lo daba por bueno. Ahora se recorre la cadena de ancestros del pie hasta el aside
comprobando que ninguno scrollea.

Lo mismo con los chips: `chip-rows.test.ts` comparaba la estimación consigo misma a los dos lados,
así que no podía detectar una estimación mal calibrada. Se añadió una tabla de **anchos reales
medidos en el navegador** y el test de que la estimación nunca se queda corta. Es lo que faltaba
cuando el reparto abrió una tercera fila (ver "Bucle visual").

---

## Lo que la suite NO cubre

Declarado explícitamente, porque una suite verde aquí no significa que la pantalla esté bien:

1. **El render real en el AP11.** Es lo primero y lo más importante. Todo lo medido en este bloque
   sale de Chromium de escritorio a 1280 × 800 CSS, que es el viewport del terminal pero no el
   terminal: ni su Chrome, ni su densidad de 240, ni su GPU, ni el dedo de un camarero. La
   auditoría entera nació de que la réplica y el terminal no dicen lo mismo.
2. **Los píxeles.** jsdom no hace layout: `getBoundingClientRect` devuelve ceros. Los tests fijan
   estructura (quién es flexible, qué cuelga de qué, en qué orden) y las clases de la escala
   táctil; que "Cobrar termina en y=683 de 800" sólo lo dice el bucle visual.
3. **Que el destaque se VEA.** Los tests comprueban el atributo y las clases. Que el coral entre en
   66 ms y no en 700 lo dijo el navegador — y de hecho la suite estaba verde mientras el destaque
   era invisible.
4. **El reparto de chips con las fuentes reales.** `layoutChips` se testea con anchos estimados y
   con una tabla de anchos medidos, pero DM Sans puede renderizar distinto en el Chrome del AP11.
   Si allí los chips salen más anchos, el reparto podría abrir una tercera fila. **Hay que mirarlo
   en el terminal.**
5. **El lector USB-HID con la búsqueda plegada.** Se ha verificado que el input sigue montado,
   enfocable y fuera de cuadro; no se ha probado con un lector físico.
6. **`adb shell dumpsys input_method | grep mInputShown`.** El bloque no introduce ningún campo de
   importe nuevo, así que no hay teclado que pueda subir, pero la comprobación es del terminal.
7. **Los tests del endpoint usan un doble de Prisma**, no Postgres: réplica del `groupBy` que usa
   la ruta. Fijan las reglas (qué estados cuentan, unidades vs importe, ventana de un mes,
   aislamiento por tenant), no que la consulta real sea eficiente ni que use el índice correcto.

---

## Bucle visual

Banco visual ampliado (`apps/tpv-web/visual/main.tsx`, sólo desarrollo, fuera del bundle):
`?screen=venta-mesa | venta-mesa-12 | venta-mesa-vacia | venta-20-categorias | venta-retail`.
Capturas con Playwright a **1280 × 800** en `docs/blocks/v1-14-comanda-shots/`.

| Captura | Qué enseña |
|---|---|
| `ticket-12-lineas-1280.png` | **El caso que la ronda 2 no llegó a probar.** 12 líneas: la lista ocupa 304 px con scroll propio, Total y "Cobrar" anclados y visibles (y=683 de 800). |
| `panel-ticket-1280.png` | El panel con 6 líneas: cabecera compacta con "Más", lista, pie anclado. |
| `linea-destacada-1280.png` | Coca-Cola recién añadida, en `coral-soft`, con la lista scrolleada hasta ella. *(Para poder fotografiarlo se estiró la permanencia de 1 s a 15 s; los píxeles son los reales, sólo se alargó la espera. El valor está en 1000 ms.)* |
| `estado-vacio-mas-vendidos-1280.png` | Mesa recién abierta: los cinco más vendidos del turno, en rejilla y sin scroll. |
| `20-categorias-1280.png` | El sabotaje: 20 categorías en **dos filas** con "Más (11)". Sin scroll horizontal. |
| `sheet-mas-categorias-1280.png` | Las 11 que no caben, con su tono y su icono. |
| `sheet-mas-acciones-1280.png` | Las seis secundarias en rejilla y "Vaciar mesa" apartada bajo un borde. |
| `barra-retail-1280.png` | `businessType=RETAIL`: búsqueda ancha, sin botón "Mapa". |
| `busqueda-desplegada-1280.png` | HOSPITALITY con la lupa abierta: 420 px, no 768, y "Mapa" sigue siendo el ancla. |

**Lo que el bucle cambió sobre lo primero que se escribió.** Todo esto salió de mirar y de medir en
el navegador, no de los tests — la suite estaba verde en los cinco casos:

1. **El destaque era invisible.** `transition-colors` en los dos estados hacía que el coral se
   desvaneciera hacia dentro: alfa 0,004 a los 150 ms del toque. Es el núcleo del bloque y estaba
   roto con la suite en verde. Ahora entra sin transición (66 ms) y sólo sale con ella.
2. **"Más (N)" caía a una TERCERA fila** con 20 categorías. La estimación de ancho de chip sumaba
   58 + 7,6 px por carácter y se quedaba un 10 % corta. Recalibrada contra 12 medidas reales del
   navegador (60 + 9,2·n, con tope de 200 px), y sesgada a pasarse: pasarse enseña un chip menos,
   quedarse corto rompe el invariante.
3. **El pie se comía el panel: 289 px de 576.** Las dos acciones apiladas son 136 px. Se pusieron
   en fila (64 px) con el rótulo y el importe apilados dentro de "Cobrar" —en fila,
   "Cobrar 1.240,50 €" no entra en media columna de un panel de 360 px—, y Subtotal e IVA pasaron a
   una sola fila. La lista subió de 183 a 285 px.
4. **La meta del ticket envolvía a dos filas** ("2 comensales · 22 min · Gemma · 24 uds.") y se
   comía 20 px más del desglose. Ahora trunca a una línea. La lista subió a 304 px.
5. **El quinto atajo del estado vacío quedaba cortado.** Cinco filas de 48 px no caben en los
   ~280 px útiles del panel, y apilados en una columna además se leían como líneas ya añadidas al
   ticket. Pasaron a rejilla de dos columnas: caben los cinco sin scroll y se parecen a las
   tarjetas del catálogo, que es lo que son.

---

## Decisiones tomadas sin preguntar

1. **El ancho de los chips se ESTIMA, no se mide chip a chip.** Medir cada uno obliga a un render
   de dos pasadas que parpadea y que en un `flex-wrap` puede oscilar (quitas un chip, vuelve a
   caber, lo metes otra vez). Se mide sólo el ancho del contenedor. Sin medida —primer render, o
   jsdom— se usa el ancho de la columna del catálogo a 1280 × 800: sin dato, el reparto es el del
   viewport de diseño, que es el que hay que defender.

2. **Las dos acciones del pie van EN FILA, no apiladas**, y "Cobrar" lleva el rótulo y el importe
   apilados dentro. Apiladas son 136 px de pie y en un panel de 576 px eso se lo come el desglose,
   que es lo que el bloque viene a recuperar. Las dos siguen a `touch-lg`.

3. **Subtotal e IVA en una sola fila.** El descuento sí baja a su propia fila cuando lo hay: de las
   tres, es la única que el cajero necesita comprobar.

4. **La meta del ticket trunca a una línea.** Lo que se corta primero es el alias de quien abrió la
   mesa, que está también en el mapa.

5. **"Cancelar" se rotula "Vaciar mesa" dentro del sheet** cuando hay mesa. Fuera de la fila de
   chips ya no compite con nada, así que puede decir lo que hace en vez de un verbo genérico. Se
   mantiene la regla de v1.9.7: en modo mesa NUNCA se deshabilita (una mesa con un DRAFT vacío
   figura ocupada y si el botón está gris no hay forma de liberarla — implantación de Sirope,
   2026-07-08).

6. **"Mapa" se pinta sólo en HOSPITALITY**, también en modo mesa. El bloque dice "no se pinta si el
   tenant no tiene mesas"; `App.tsx` ya trata "tiene mesas" como equivalente a HOSPITALITY
   (`skipTables = businessType !== null && businessType !== "HOSPITALITY"`), y se ha seguido ese
   criterio en vez de inventar uno nuevo.

7. **La búsqueda plegada se esconde fuera de cuadro, no se desmonta.** Es donde aterriza el lector
   USB-HID. Desmontarla habría sido más limpio y habría roto el escáner de los tenants que lo usan.

8. **Al plegar la lupa se limpia la búsqueda.** Dejar un filtro activo detrás de una lupa cerrada es
   exactamente cómo se llega a "no me salen los productos".

9. **El ranking del turno cae al mes por debajo de la mitad de los huecos** (`< ceil(limit/2)`). Un
   turno recién abierto con una venta no es una señal, es ruido, y un atajo equivocado en la mesa
   recién abierta es peor que no tener atajo.

10. **El corte del ranking es por unidades, no por importe.** Lo que acelera la comanda es lo que
    más veces se pulsa.

11. **`pushProductLine` busca la línea existente FUERA del updater de estado**, igual que ya hacía
    la rama de mesa. No es estética: el panel necesita saber qué línea destacar, y calcularlo
    dentro del updater sería un efecto colateral en una función que React puede invocar dos veces
    en StrictMode — el destaque saldría a veces sí y a veces no.

12. **El aside y el bottom-sheet comparten reparto.** Divergían y el sheet ya tenía su propia
    versión invertida desde v1.10.3; unificarlos era el resultado natural de aplicar C1, y deja una
    forma menos que mantener.

13. **El estado vacío usa rejilla de dos columnas.** Ver punto 5 del bucle visual.

14. **21st MCP no se usó.** El bloque lo ofrece para buscar el patrón de bottom sheet y de chips.
    Los dos patrones ya estaban en casa —`ConfirmSheet` y `SheetWrap` para la hoja, la fila de
    chips existente para los chips— y el propio bloque exige normalizar cualquier cosa de fuera a
    los tokens del proyecto antes de cerrar. Traer estructura ajena para reescribirla entera habría
    sido trabajo de más para llegar al mismo sitio. Es la misma decisión (y el mismo motivo) que en
    v1.12.

15. **context7 tampoco hizo falta.** No se usa ninguna API de React o Tailwind que no estuviera ya
    en el fichero: hooks estándar, `ResizeObserver` del navegador y utilidades de Tailwind 3.4 ya
    presentes en el proyecto.

---

## Tests

Nuevos:

| Fichero | Qué fija |
|---|---|
| `apps/tpv-web/test/sale-ticket-hierarchy.test.tsx` (10) | El sabotaje de `flex-1` y que **sólo** la lista es flexible; el orden cabecera → líneas → pie; el ticket de 12 líneas con el pie fuera de TODO lo que scrollea (ancestros incluidos); `touch-lg` en las CTA; destaque al añadir con scroll hasta la línea, apagado a ~1 s, **el segundo toque al mismo café**, destaque sin esperar al servidor; y que las siete secundarias no ocupan sitio en el panel pero están todas en el sheet, con "Vaciar mesa" apartada. |
| `apps/tpv-web/test/sale-categories.test.tsx` (9) | 20 categorías sin `overflow-x` ni en la fila ni en sus ancestros, con "Más (N)" cuadrando; el sheet con todas las que no caben y sus targets de 48 px; elegir desde el sheet filtra y marca el chip "Más"; las ocho de Sirope caben; tono e icono por chip con más de un tono en uso; **el reparto persiste entre sesiones**; y el coral sólo en la selección real. |
| `apps/tpv-web/test/sale-topbar-vertical.test.tsx` (12) | "Mapa" a `touch-lg` a la izquierda y también en modo mesa (y ya no en el panel); **RETAIL no pinta "Mapa"**; retail y services con la búsqueda ancha; hostelería con la lupa que despliega; el plegado limpia la búsqueda; y el estado vacío: turno vs mes, tocables, producto muerto del ranking, sin ranking, y fallo de red. |
| `apps/tpv-web/test/chip-rows.test.ts` (10) | Reparto en dos filas: las ocho de Sirope caben, 20 se recortan con "Más (N)" cabiendo de verdad, el toggle SERVICES come sitio, etiquetas larguísimas, sin medida cae al ancho de diseño, monotonía por ancho — y la **calibración contra anchos reales medidos en el navegador**, que es el test que faltaba. |
| `apps/tpv-web/test/category-tones.test.ts` (14) | Estabilidad del reparto (misma sesión, sesión nueva, tag nuevo que no reasigna, orden de llegada irrelevante), aislamiento por tenant, persistencia, localStorage corrupto o con tonos inventados; heurística de `tokens.md`, sin pintar el catálogo entero de un tono, reparto equilibrado con 18 categorías, el coral fuera de la paleta, las clases exactas de §2; iconos con los nombres sucios de Holded (`Croissantysandwich`, `Bolleria`, `Cañas`). |
| `apps/api/test/top-sellers-route.test.ts` (11) | Orden por unidades del turno; unidades y no importe; `DRAFT`/`VOIDED`/`TEST` ignorados y los cinco estados de venta contados; caída al mes con turno recién abierto; nada de hace más de un mes; sin `shiftId` va al mes; producto borrado del catálogo fuera; sin cruce entre tenants; 401 sin sesión; y `limit` acotado por schema. |

Tocados (comportamiento cambiado a propósito):

| Fichero | Por qué |
|---|---|
| `test/handheld-layout.test.tsx` | Las guardas anti-overflow del header se comprueban con la búsqueda desplegada, que es cuando puede desbordar. **Test nuevo**: el campo plegado sigue montado, fuera de cuadro y enfocable (el lector USB-HID). |
| `test/mesas-concurrencia.test.tsx` | El botón del header se llama "Mapa" (antes "Mesas") y se verifica que es `touch-lg`. |
| `test/table-sale-flow.test.tsx` | "Agrupar" vive ahora tras el botón "Más": el test abre el sheet antes. |

```
pnpm test        → 164 ficheros, 1444 tests, 3 skipped · verde
tsc --noEmit     → verde en apps/tpv-web y apps/api
```

(Baseline del bloque: 158 ficheros, 1377 tests.)

---

## Ficheros

```
NUEVO  apps/tpv-web/src/lib/categoryTones.ts        seis tonos + iconos, reparto persistido por tenant
NUEVO  apps/tpv-web/src/lib/chipRows.ts             reparto de chips en dos filas (función pura)
NUEVO  apps/tpv-web/src/lib/topSellers.ts           ranking + cache 2 min + cruce con el catálogo local
NUEVO  apps/tpv-web/src/pages/SalePage.moreSheets.tsx  sheet de "Más acciones" y de "Más categorías"
NUEVO  apps/tpv-web/test/sale-ticket-hierarchy.test.tsx
NUEVO  apps/tpv-web/test/sale-categories.test.tsx
NUEVO  apps/tpv-web/test/sale-topbar-vertical.test.tsx
NUEVO  apps/tpv-web/test/chip-rows.test.ts
NUEVO  apps/tpv-web/test/category-tones.test.ts
NUEVO  apps/api/test/top-sellers-route.test.ts
NUEVO  docs/blocks/v1-14-comanda-shots/*.png        9 capturas a 1280×800

       apps/tpv-web/src/pages/SalePage.tsx          TicketPanel invertido, chips con tono, barra por vertical,
                                                    señal de línea tocada, estado vacío con los más vendidos
       apps/tpv-web/src/pages/CartLineItem.tsx      destaque `coral-soft` y asa `data-line-id` para el scroll
       apps/api/src/tpv-catalog/routes.ts           GET /tpv/catalog/top-sellers
       apps/tpv-web/visual/main.tsx                 5 pantallas nuevas + eco del DRAFT de mesa
       docs/design/tokens.md                        panel del ticket, chips de categoría, estado vacío,
                                                    destaque de línea
       apps/tpv-web/test/handheld-layout.test.tsx   búsqueda plegable (M3)
       apps/tpv-web/test/mesas-concurrencia.test.tsx  "Mesas" → "Mapa" (M4)
       apps/tpv-web/test/table-sale-flow.test.tsx   "Agrupar" tras el botón "Más" (C1)
```

---

## Criterios de aceptación

| # | Criterio | Estado |
|---|---|---|
| 1 | C1 · lista de artículos en el espacio flexible, totales y "Cobrar" anclados | Hecho. 20 px → **304 px** con 12 líneas, medido a 1280×800. **Falta la pasada en el AP11.** |
| 2 | C1 · confirmación visual al añadir línea, < 100 ms y sin esperar al servidor | Hecho. **66 ms** medidos en navegador. **Falta verlo con el dedo en el terminal.** |
| 3 | M1 · sin scroll horizontal, máximo dos filas, "Más (N)" | Hecho. **Falta comprobar el reparto con la fuente del Chrome del AP11** (ver "Lo que la suite NO cubre", punto 4). |
| 4 | M2 · color e icono por categoría, persistidos por tenant | Hecho |
| 5 | M3+M4 · barra por `businessType`, "Mapa" primario en hostelería | Hecho |
| 6 | m1 · "Cancelar" fuera de la zona premium · m2 · CTA a 64-72 px | Hecho |
| 7 | §4 · estado vacío con los cinco más vendidos | Hecho, con endpoint nuevo |
| 8 | Tabla sabotaje → test rojo | Hecho: los cinco sabotajes aplicados y revertidos, con los tests que cayeron |
| 9 | Suite completa y typecheck en verde | Hecho en local; CI al abrir el PR |
| 10 | Bucle visual a 1280×800 con captura del ticket de 12 líneas | Hecho: 9 capturas, cinco arreglos que salieron de mirar |

Los "falta" son todos del terminal, no del código. **Es lo mismo que pasó en v1.12 y es exactamente
de donde salió esta auditoría**: la nota de 6,5 se puso mirando el AP11, no una réplica. Este
bloque se cierra en la siguiente sesión física.

---

## Hallazgos nuevos (fuera de alcance, para el siguiente bloque)

1. **La suite estaba verde con el núcleo del bloque roto.** El destaque de línea era invisible
   (alfa 0,004 a los 150 ms) y ningún test lo veía, porque jsdom no calcula transiciones. Vale la
   pena una nota en la metodología: **lo que se pinta se comprueba mirando**, y el bucle visual no
   es un extra de documentación sino parte del criterio de "funciona".

2. **`CartLineItem` tiene targets por debajo de la escala táctil.** Los botones `−` y `+` del
   stepper son `h-9 w-11` (36 × 44 px) y el comentario de cabecera del fichero dice "targets
   táctiles de 44 px". El mínimo del sistema desde v1.12 es **48**. No se ha tocado aquí porque
   subirlos engorda la línea (hoy 90 px) y le quita al desglose el espacio que este bloque acaba de
   recuperar: es un cambio con un compromiso real detrás y merece su propia decisión. **Entra en el
   siguiente bloque, junto con la densidad de la línea.**

3. **Con 12 líneas se ven 3,4 y no hay señal de que haya más.** El scroll vertical es legítimo
   (§1.8 lo permite y sólo prohíbe el horizontal), y la cabecera dice "24 uds.", pero no dice
   cuántas LÍNEAS. Es el mismo tipo de duda que M1 en otro eje. Relacionado con el punto 2: si la
   línea adelgaza, se ven más y el problema se encoge solo.

4. **La duración del destaque no se puede fotografiar sin tocar el código.** Para la captura hubo
   que estirar `LINE_HIGHLIGHT_MS` de 1 s a 15 s a mano. Si el banco visual va a seguir creciendo,
   merece un parámetro de URL para congelar estados efímeros (destaques, toasts, el "Deshacer" de
   4 s) en vez de editar constantes.
