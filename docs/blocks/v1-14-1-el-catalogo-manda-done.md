# Bloque v1.14.1 · El catálogo manda — DONE

Origen: `docs/code-prompts/bloque-v1-14-1-el-catalogo-manda.md`.

El antes de este bloque no es una auditoría: es una captura del terminal.
`docs/qa/2026-09-01-ap11-v1-14/07-venta-v114-mesa.png`, con v1.14 (`073fc94`) ya desplegado y
corriendo en el AP11-1006 a 1280 × 800.

La frase que ordena el bloque: **v1.14 arregló lo que se midió y no arregló lo que se ve.** La
auditoría midió el panel del ticket y el panel del ticket quedó bien. Pero quien manda en la
percepción de esta pantalla es el catálogo, que ocupa dos tercios del ancho y era un muro de diez
tazas grises idénticas.

Verde antes de empezar: **164 ficheros de test, 1444 tests** y `tsc --noEmit` en las dos apps.

---

## Lo que se midió, antes y después

Medido en el navegador a 1280 × 800 CSS, que es el viewport del AP11 a densidad 240. La columna del
catálogo mide 840 × 576 y empieza en y=128.

| | Antes (v1.14, medido en el AP11 y reproducido) | Ahora |
|---|---|---|
| Alto de la tarjeta de producto | **206 px** | **104 px** |
| De eso, icono placeholder gris | **125 px** | **0 px** |
| Filas de producto completas a 1280×800 | **2** | **4** |
| Productos visibles sin scroll | 10 | **20** |
| Alto de la fila de categorías | 104 px (dos filas) + 24 de margen | **48 px** (una fila) + 24 |
| Alto útil de la rejilla | 448 px | **504 px** |
| Hueco vacío del desglose con 1 línea | ~214 px | **90 px**, el resto con atajos |
| Reparto del pie | 50/50, las dos a 64 px | **1fr/1.6fr**, 48 contra 64 |

---

## 1 · Matar el placeholder gigante

`pages/SalePage.tsx` (`ProductTile`, nuevo), `lib/catalogGrid.ts` (nuevo).

Cada tarjeta dedicaba 125 de sus 206 px a un icono de taza **idéntico en las diez de la pantalla**.
No distinguía un café de un botellín: era, literalmente, el mismo dibujo diez veces. Y se comía la
fila de productos que el camarero necesita ver.

La tarjeta pasa a ser compacta y tipográfica: **el nombre y el precio son el producto.** Nombre a
`line-clamp-2` (13,5 px/500), precio anclado abajo (15 px/600, `tabular-nums`). El precio pesa más
que el nombre a propósito: en una barra el nombre se reconoce de memoria y lo que se comprueba de un
vistazo es el importe.

- **Sin foto** — el caso normal, porque Holded casi nunca las trae — no se pinta ningún icono. Queda
  un acento de **4 px** con el tono de la categoría. Es información gratis: bajo "Todos" la rejilla
  mezcla categorías, y la banda las separa sin robar altura.
- **Con foto**, manda la imagen: ocupa la tarjeta entera bajo un velo, con nombre y precio encima en
  blanco.
- **Las dos miden lo mismo.** No es un detalle: si la tarjeta con foto fuera más alta, un catálogo a
  medio fotografiar dejaría la rejilla con filas rotas.

**Cómo se testea "caben tres filas" sin navegador.** jsdom no hace layout: `getBoundingClientRect`
devuelve ceros. La aritmética vive en `lib/catalogGrid.ts` como función pura sobre constantes
medidas en el navegador, y **la tarjeta declara su alto con la misma constante** (por `style`, no por
una clase de Tailwind). Los dos tests cierran el circuito: uno comprueba la cuenta, el otro que la
pantalla usa el número de la cuenta. Sin el segundo, alguien podría engordar la tarjeta y dejar la
aritmética mintiendo en verde — que es exactamente el tipo de agujero que v1.14 encontró en sus
propios tests.

`catalogRowsVisible(800)` = **4**. Con el placeholder de vuelta (229 px de tarjeta) = **2**, que es
lo que enseña la captura del AP11.

---

## 2 · Categorías: una fila, y el color que signifique algo

`lib/chipRows.ts`, `lib/categoryTones.ts`, `pages/SalePage.tsx`, `pages/SalePage.moreSheets.tsx`.

**De dos filas a una.** v1.14 quitó el scroll horizontal a cambio de ~100 px de alto, y con "Más (3)"
seguían sin verse todas. El problema se había movido de eje, no se había resuelto: 100 px de alto en
una pantalla donde sólo cabían dos filas de producto es media fila de producto. Si de todas formas
hay un sheet que las tiene todas, la segunda fila se paga con espacio del catálogo y no compra nada.

`CHIP_MAX_ROWS` pasa a 1 y la fila lleva `flex-nowrap` + `overflow-hidden`. El `flex-nowrap` no es
decorativo: es la garantía dura de que, si la estimación de ancho se quedara corta con la fuente del
Chrome del AP11, no podría abrirse una segunda fila a nuestras espaldas.

**El precio declarado:** con las ocho categorías de Sirope, en la fila caben cuatro y las otras
cuatro se van al sheet. Con las once del cajero de pruebas, cuatro y "Más (7)". Es menos de lo que
se veía en dos filas, y es la decisión del bloque.

**Los tonos de v1.14 eran ruido.** Se reparten por orden alfabético, así que el color no dice nada
del contenido: en la captura del AP11 salían Bollería amarillo, Café rojo, Croissantysandwich verde e
Infusiones amarillo otra vez. Seis fondos de color compitiendo con la única señal que hay que leer en
esa fila, que es cuál está seleccionado. **El fondo del chip pasa a neutro y el tono se queda en el
icono**, donde informa sin gritar. `TONE_STYLES` ya no tiene un campo `chip`: tiene `icon` y `band`.

**El chip seleccionado va en coral, no en ink.** "Todos" salía en negro pleno — que no es un estado
del sistema visual y además es el elemento de más contraste de la pantalla, compitiendo con "Cobrar".
Se resuelve con **coral suave** (`coral-soft` + borde coral + texto `coral-dark`), que es lo que
`tokens.md` §2 reserva para "estado activo de nav". Así el chip habla el lenguaje del sistema **y**
el coral pleno se queda para "Cobrar", que es la regla que el bloque pide. El toggle
Servicios/Productos de los verticales SERVICES se alinea con lo mismo: dos formas de decir "esto está
elegido" en la misma fila y no se aprende ninguna.

---

## 3 · El desierto del desglose

`lib/topSellers.ts`, `pages/SalePage.tsx` (`TopSellersGrid`, extraído).

Con una línea, los 304 px que v1.14 recuperó son 90 de línea y ~214 de nada. El panel no parece un
ticket: parece roto.

No se toca la jerarquía de v1.14 — la lista sigue siendo el único bloque flexible, el pie sigue
anclado. Lo que se hace es colgar **debajo de la lista**, tras un borde, la misma rejilla de más
vendidos que ya existía para el estado vacío. Añadir el segundo café sin volver a buscarlo en la
rejilla de la izquierda es el gesto de la barra en hora punta.

`TicketEmptyState` y el hueco comparten componente (`TopSellersGrid`). Son lo mismo, y si divergieran
uno acabaría siendo el bueno y el otro el olvidado.

**Un cambio que el bloque no menciona y sin el cual nada de esto se pinta:** v1.14 sólo pedía el
ranking al servidor con el ticket **vacío** (`if (lines.length > 0) return`). La primera versión de
este bloque quedó verde en los tests y sin atajos en pantalla. Ahora la condición de carga y la de
pintado son **la misma función**, `topSellersSlotsFor`. Con dos reglas, un día el panel pediría
atajos que nadie ha cargado y el síntoma sería un hueco silencioso — que es el defecto que este
bloque viene a arreglar.

---

## 4 · Que "Cobrar" mande en el pie

v1.14 puso las dos acciones en fila, las dos a `touch-lg` y a mitad y mitad. Pesan casi lo mismo, y
no lo son.

La jerarquía se construye con **las tres variables a la vez**, porque con una sola no basta: dos
botones del mismo alto y el mismo ancho con distinto color se siguen leyendo como una pareja de
iguales.

| | Enviar comanda / Guardar | Cobrar |
|---|---|---|
| Ancho | `1fr` (111 px) | `1.6fr` (177 px) |
| Alto | `h-touch` (48) | `h-touch-lg` (64) |
| Relleno | borde neutro | coral pleno |

**No se inventa un `h-[72px]`.** El bloque dice "64-72 px según el sistema visual" y la escala de
`tokens.md` §4 se cierra en 64, con la regla explícita de que las alturas sueltas se discuten antes
de implementarse. 64 está en el rango que pide el bloque.

"Enviar comanda" pierde también el borde coral que llevaba en el primer envío: en esta pantalla el
coral es de "Cobrar". Que la comanda esté sin enviar se dice con el rótulo, no compitiendo en color
con la caja.

---

## 5 · El punto medio que colgaba

En el AP11 la meta salía como `10 h 42 m · mipiacetpv-test-2e5c19f9 ·`: el separador colgando y sin
puntos suspensivos.

La causa es `truncate` sobre un contenedor **flex**. `text-overflow: ellipsis` sólo actúa sobre el
contenido en línea de un bloque; en un flex container los hijos son items, no texto, y el navegador
se limita a recortar por donde toque — que fue justo detrás de un separador. La meta pasa a ser un
bloque con contenido en línea y trunca de verdad, con elipsis.

Y de paso, **el alias va ahora el último**. v1.14 decidió que "lo que se corta primero es el alias de
quien abrió la mesa, que está también en el mapa", pero lo dejó *delante* de las unidades, así que en
la práctica lo primero en caer eran las unidades. En el AP11 el alias era además el campo más largo
(`mipiacetpv-test-2e5c19f9`, el slug del tenant en los cajeros de prueba) y se comía la línea entera.
El orden del texto es el orden del recorte.

---

## Sabotaje → test rojo

Los ocho sabotajes se aplicaron **de verdad sobre el código**, se corrió la suite y se revirtieron.

| Sabotaje aplicado | Tests que se pusieron en rojo |
|---|---|
| Devolver el placeholder de 125 px (bloque `aspect-[5/4]` + tarjeta a 229 px) | `catalog-grid` › **SABOTAJE placeholder de 125 px · con él sólo caben dos filas**, + segunda fila de chips y fila cortada; `sale-catalog-grid` › **sin foto: ni imagen ni placeholder** y **con foto la tarjeta no cambia de alto** (5 rojos de 9) |
| Devolver los chips a DOS filas (`CHIP_MAX_ROWS = 2` + `flex-wrap`), con 20 categorías | `chip-rows` › **el máximo es UNA fila** y **las ocho de Sirope caben en una fila**; `sale-categories` › **SABOTAJE 20 categorías** y **lo que no cabe se va al sheet** (4 rojos de 22) |
| Pintar el chip seleccionado en `ink` | `sale-categories` › **'Todos' seleccionado va en coral suave, no en ink**, + el seleccionado único y la selección desde el sheet (3 rojos de 11) |
| Devolver el tono al FONDO del chip | `category-tones` › **el tono pinta icono y banda, nunca un fondo de chip**; `sale-categories` › **el tono pinta el icono, nunca el fondo del chip**, + el seleccionado único (3 rojos de 26) |
| Ticket con 1 línea: no pintar los más vendidos | `sale-ticket-filler` › **SABOTAJE 1 línea · se pintan los más vendidos en el hueco**, + el atajo que añade; `top-sellers-slots` › **con una línea sobran 190 px**; `sale-topbar-vertical` › **mesa recién abierta** (4 rojos de 24) |
| Ticket con 8 líneas: pintarlos igualmente | `sale-ticket-filler` › **SABOTAJE 8 líneas · NO se pintan y la lista se queda el espacio**, + dos líneas y el atajo; `top-sellers-slots` › **con el ticket crecido no se pinta ninguno** (5 rojos de 12) |
| Igualar el pie (las dos a `touch-lg` y a mitades) | `sale-ticket-hierarchy` › **§4 · 'Cobrar' pesa más que 'Enviar comanda' en las tres variables** (1 rojo de 14) |
| Devolver la meta a un contenedor flex · y el alias delante de las unidades | `sale-ticket-hierarchy` › **la meta es un bloque, no un flex** · y **el alias va el último** (1 rojo cada uno, de 14) |

**Dos de los ocho no estaban en la tabla del bloque y están aquí porque el bucle visual los encontró
antes que la suite:** el tono en el fondo del chip (el bloque lo pide en prosa; sin test, un refactor
lo devuelve) y el orden del alias en la meta.

---

## Lo que la suite NO cubre

1. **El render real en el AP11.** Es lo primero. Todo lo medido en este bloque sale de Chromium de
   escritorio a 1280 × 800 CSS, que es el viewport del terminal pero no el terminal. **Y este bloque
   nace precisamente de que la réplica y el terminal no dicen lo mismo**: v1.14 cerró con nueve
   capturas verdes y la pantalla del AP11 seguía siendo un muro de tazas.
2. **Que quepan cuatro filas con la fuente del AP11.** `catalogRowsVisible` calcula sobre constantes
   medidas en Chromium de escritorio. DM Sans puede renderizar distinto allí; el margen es de 46 px
   sobre los 504 disponibles, así que aguanta bastante, pero el número que vale es el del terminal.
3. **El reparto de chips con las fuentes reales.** Hereda el punto 4 de v1.14. Si allí los chips
   salen más anchos, se verá **un chip menos**, no una segunda fila: `flex-nowrap` lo impide. Lo que
   sí puede pasar es que el último chip salga **cortado por la derecha**, y eso hay que mirarlo.
4. **Los píxeles, en general.** jsdom no hace layout. Los tests fijan estructura, clases y
   aritmética; que "el hueco no se corta" o "Cobrar termina en y=683" sólo lo dice el bucle visual.
5. **La tarjeta con foto de verdad.** El banco visual no sirve `/product-images/...`; la captura
   `venta-mesa-fotos-1280.png` rellena los `src` con un data-URI desde Playwright. Lo que se
   comprueba es lo que el bloque exige —que la tarjeta con foto y la tarjeta sin foto midan lo
   mismo—, y eso no depende de qué imagen sea. **No se ha visto una foto real de Holded en la
   rejilla.**
6. **Que el acento de 4 px se distinga en el terminal.** Es el único portador del tono en la tarjeta,
   y 4 px a 240 dpi con brillo de barra es justo el tipo de cosa que se ve bien en el Mac y no en el
   AP11. Hay que mirarlo con la pantalla al brillo del local.
7. **El velo de la tarjeta con foto contra fotos reales.** El degradado está calibrado a ojo sobre un
   relleno sintético; una foto muy clara podría dejar el nombre justo.

---

## Bucle visual

Playwright a **1280 × 800**, capturas en `docs/blocks/v1-14-1-catalogo-shots/`. Pantallas nuevas del
banco: `venta-mesa-1`, `venta-mesa-2`, `venta-mesa-8`, `venta-mesa-fotos`.

`00-comparativa-antes-despues.png` es la comparación lado a lado que pedía el bloque: la captura del
AP11 a la izquierda, `venta-mesa-1` a la derecha.

| Captura | Qué enseña |
|---|---|
| `00-comparativa-antes-despues.png` | **El listón del bloque.** 10 productos visibles contra 20; dos filas de chips contra una; el desierto del desglose contra el hueco lleno; el pie igualado contra "Cobrar" mandando. |
| `venta-mesa-1-1280.png` | El caso de la captura del AP11: una línea. Cuatro filas de producto, atajos en el hueco. |
| `venta-mesa-1280.png` | Seis líneas: sin atajos, la lista se queda el espacio. |
| `venta-mesa-8-1280.png` | Ocho líneas: el sabotaje de §3 en pantalla. |
| `venta-mesa-12-1280.png` | El caso de v1.14 sigue en pie: pie anclado con el ticket largo. |
| `venta-mesa-vacia-1280.png` | Estado vacío con los cinco más vendidos, intacto. |
| `venta-20-categorias-1280.png` | 20 categorías en **una** fila con "Más (16)". |
| `venta-mesa-fotos-1280.png` | Catálogo mixto: tarjetas con foto y sin foto en la misma rejilla, **con el mismo alto**. |
| `venta-retail-1280.png` | `businessType=RETAIL`: búsqueda ancha, sin "Mapa". |

**Lo que el bucle cambió sobre lo primero que se escribió.** Los dos salieron de mirar y medir, no de
los tests, que estaban verdes:

1. **Los atajos del hueco se cortaban por abajo.** La primera versión pintaba cuatro con una línea.
   Medido: piden 201 px y caben 190. Es **el mismo error que v1.14 cometió con el quinto atajo del
   estado vacío**, y por eso duele: la cuenta se había hecho sobre el papel (rótulo 30 + dos filas de
   64) en vez de medir el alto real del atajo, que es 71 cuando el nombre va a dos líneas. Ahora son
   **dos**, con 68 px de aire de sobra. Y con dos líneas de ticket no se pinta ninguno: la fila pide
   114 px sobre 100 disponibles. No se aprietan los márgenes para que entren por tres píxeles.
2. **"Enviar comanda" partía en dos líneas.** `1fr` de la rejilla del pie son 111 px en un panel de
   360, y a 13,5 px la etiqueta no entra. Baja a 12,5 con `px-1.5` y `whitespace-nowrap`.

---

## Decisiones tomadas sin preguntar

1. **Banda de 4 px, no icono junto al nombre.** El bloque ofrecía las dos ("como mucho una banda o el
   icono a tamaño de texto"). Un icono de 16 px más su hueco roba 22 px de los ~131 de ancho de
   texto en una tarjeta de 157 — un 17 % del nombre, en una rejilla donde nombres como "Café cortado
   con leche de avena" ya truncan. La banda cuesta 4 px de alto y cero de ancho, y además se lee como
   código de color a lo largo de toda la rejilla.

2. **El coral del chip seleccionado es SUAVE, no pleno.** El bloque pide las dos cosas a la vez: que
   el seleccionado vaya en coral y que "Cobrar" sea el único con coral pleno. `coral-soft` con borde
   coral las cumple las dos, y es lo que `tokens.md` §2 ya define para "estado activo de nav".

3. **`h-touch-lg` (64) para "Cobrar", no 72.** Ver §4.

4. **El tono de la tarjeta sale de la PRIMERA categoría del producto** con tono asignado, en el orden
   en que Holded devuelve los tags (estable). Sin tags cae a `stone`, nunca a "sin banda": si no,
   la rejilla tendría tarjetas de dos alturas ópticas distintas.

5. **`topSellersSlotsFor` es una función y no dos condiciones.** Ver §3.

6. **Con dos líneas no se pinta el hueco, aunque el bloque diga "una o dos".** El bloque lo condiciona
   a "y sobra sitio", y medido no sobra: la fila de atajos pide 114 px y quedan 100. Pintarla
   significaría cortarla. **Es la única desviación del alcance literal y va declarada aquí.**

7. **La regla del hueco va por número de líneas, no por medida del DOM.** Medir obligaría a un efecto
   tras el layout, y el bloque entraría y saldría con cada pulsación, que es peor que no tenerlo.

8. **El alto de la tarjeta entra por `style`, no por una clase de Tailwind.** Es lo que ata el número
   que pinta la pantalla al número que calcula el test. Con una clase suelta podrían separarse sin
   que nada se pusiera rojo.

9. **`placeholderIconFor` y sus dos mapas se borran.** Eran el icono por vertical y por subvertical
   (`Tenant.tpvIconPreset`) que llenaba los 125 px. El icono **era** el placeholder. Ver carryovers.

10. **"Línea libre" mide lo mismo que una tarjeta.** Con `min-h-[180px]` estiraba su fila entera y
    volvía a romper el reparto que §1 acaba de arreglar.

11. **El invariante del coral pleno se acota al área de trabajo** (catálogo + panel del ticket), no a
    la pantalla entera. Ver carryover 2.

12. **21st MCP y context7 no se usaron**, por lo mismo que en v1.14 y v1.12: los patrones ya estaban
    en casa y no se usa ninguna API que no estuviera ya en el fichero.

---

## Tests

Nuevos:

| Fichero | Qué fija |
|---|---|
| `test/catalog-grid.test.ts` (5) | La aritmética pura: cuatro filas a 800 de alto, dos con el placeholder de vuelta, tres si vuelve la segunda fila de chips; ventana baja sin filas negativas; monotonía; y que la quinta fila que asoma 32 px no cuenta como completa. |
| `test/sale-catalog-grid.test.tsx` (4) | La tarjeta declara el mismo alto que usa la aritmética (el circuito que hace que el sabotaje muerda); sin foto no hay media y sí banda de tono; con foto la imagen es absoluta y la tarjeta **no cambia de alto**; nombre a dos líneas y precio con más peso. |
| `test/top-sellers-slots.test.ts` (7) | La regla del hueco: 5/2/0/0, que no se fuerzan dos filas por tres píxeles, monotonía decreciente y recuento absurdo. |
| `test/sale-ticket-filler.test.tsx` (5) | Con 1 línea el hueco se pinta **debajo** de la lista con los que caben; el atajo añade de verdad y al hacerlo el hueco desaparece solo; con 8 líneas no se pinta y la lista conserva `flex-1 min-h-0 overflow-y-auto`; con 2 tampoco; con 0 es el estado vacío de v1.14, no el hueco. |

Tocados (comportamiento cambiado a propósito):

| Fichero | Por qué |
|---|---|
| `test/chip-rows.test.ts` | Una fila en vez de dos. **Test nuevo**: `CHIP_MAX_ROWS === 1`, que es el sabotaje. Las ocho de Sirope ya no caben todas y lo que se pinta cabe en una fila con "Más (N)". |
| `test/category-tones.test.ts` | `TONE_STYLES` pasa de `{chip}` a `{icon, band}`. **Test nuevo**: el tono nunca es un fondo, y la forma del objeto se comprueba entera para que no vuelva a colarse un `chip`. |
| `test/sale-categories.test.tsx` | `flex-nowrap` en vez de `flex-wrap`; el seleccionado en coral suave y no en ink; el tono en el icono y no en el fondo. **Tests nuevos**: el seleccionado es exactamente uno, y en catálogo + panel del ticket el único coral pleno es "Cobrar". |
| `test/sale-ticket-hierarchy.test.tsx` | La CTA ya no comparte alto con la secundaria. **Tests nuevos**: §4 con las tres variables, y §5 (meta como bloque, sin separador colgando, alias el último). |
| `test/sale-topbar-vertical.test.tsx` | Al añadir la primera línea los atajos ya **no** desaparecen: se quedan llenando el hueco. |

```
pnpm exec vitest run   → 168 ficheros, 1473 tests, 3 skipped · verde
pnpm -r exec tsc --noEmit → verde
```

(Baseline del bloque: 164 ficheros, 1444 tests.)

---

## Ficheros

```
NUEVO  apps/tpv-web/src/lib/catalogGrid.ts          aritmética de la rejilla (función pura + constantes medidas)
NUEVO  apps/tpv-web/test/catalog-grid.test.ts
NUEVO  apps/tpv-web/test/sale-catalog-grid.test.tsx
NUEVO  apps/tpv-web/test/top-sellers-slots.test.ts
NUEVO  apps/tpv-web/test/sale-ticket-filler.test.tsx
NUEVO  docs/blocks/v1-14-1-catalogo-shots/*.png     9 capturas a 1280×800, con la comparativa

       apps/tpv-web/src/pages/SalePage.tsx          ProductTile nuevo; placeholder por vertical eliminado;
                                                    chips en una fila con fondo neutro y selección coral;
                                                    hueco del desglose; pie con jerarquía; meta que trunca
       apps/tpv-web/src/pages/SalePage.moreSheets.tsx  el sheet de categorías, con el mismo lenguaje
       apps/tpv-web/src/lib/categoryTones.ts        TONE_STYLES: {chip} → {icon, band}
       apps/tpv-web/src/lib/chipRows.ts             CHIP_MAX_ROWS 2 → 1
       apps/tpv-web/src/lib/topSellers.ts           topSellersSlotsFor: la regla del hueco
       apps/tpv-web/visual/main.tsx                 venta-mesa-1 / -2 / -8 / -fotos
       docs/design/tokens.md                        tarjeta de producto, chips, pie del ticket, hueco, tonos
```

---

## Criterios de aceptación

| # | Criterio | Estado |
|---|---|---|
| 1 | §1 · placeholder a 0 px, tarjeta compacta y tipográfica | Hecho. 125 → **0**, tarjeta 206 → **104**. |
| 2 | §1 · **3 filas completas** a 1280×800 con el ticket abierto | Hecho, y con margen: **4**. Medido en el navegador. **Falta la pasada en el AP11.** |
| 3 | §1 · el componente soporta foto y no-foto sin cambiar de altura | Hecho, con test. **No se ha visto una foto real de Holded.** |
| 4 | §2 · una sola fila de chips + `Más (N)` | Hecho. `flex-nowrap` lo garantiza aunque falle la estimación. |
| 5 | §2 · fondo del chip neutro, tono sólo en el icono | Hecho |
| 6 | §2 · el seleccionado en coral, no en ink | Hecho, en coral **suave**; el pleno se queda para "Cobrar" (decisión 2). |
| 7 | §3 · el hueco del desglose ocupado con algo útil | Hecho con 1 línea. **Con 2 no: no cabe** (decisión 6). |
| 8 | §3 · se oculta en cuanto el ticket crece | Hecho, con los dos sabotajes en verde. |
| 9 | §4 · "Cobrar" manda en el pie | Hecho, por ancho, alto y relleno. **64 px, no 72** (decisión 3). |
| 10 | §5 · la meta ya no termina en un `·` colgando | Hecho, y el alias pasa a cortarse antes que las unidades. |
| 11 | Tabla sabotaje → test rojo | Hecho: **ocho** sabotajes aplicados y revertidos. |
| 12 | Suite y typecheck en verde | Hecho en local; CI al abrir el PR. |
| 13 | Bucle visual a 1280×800 comparado con la captura del AP11 | Hecho: 9 capturas y la comparativa lado a lado. |

Los "falta" son todos del terminal. **Este bloque existe porque v1.14 cerró con nueve capturas verdes
y la pantalla real seguía mal**, así que el criterio de cierre de verdad es la siguiente sesión
física con el AP11.

---

## Hallazgos nuevos (fuera de alcance, para el siguiente bloque)

1. **`Tenant.tpvIconPreset` se queda sin consumidor.** El campo lo configura super-admin (peluquería
   ve tijeras, clínica estetoscopio…) y su único uso en el TPV era el icono placeholder de 125 px que
   este bloque borra. Sigue viajando del backend a `lib/catalog.ts` y sigue cacheado, pero **ya no lo
   pinta nadie**. O se le busca un sitio donde informe —el candidato natural es el icono de las
   categorías que la heurística de `iconNameForTag` no sabe clasificar, que hoy caen a un genérico
   por tono— o se retira del formulario de super-admin. Un ajuste que el cliente configura y que no
   cambia nada en pantalla es peor que no tenerlo.

2. **Hay un segundo coral pleno en la pantalla: el botón "+" de nueva venta**, en la barra superior en
   modo venta rápida (`h-12 md:h-14 w-12 md:w-14 rounded-2xl bg-mipiace-coral`). Lo destapó el test
   del invariante del coral, que por eso está acotado al área de trabajo. No lo audita este bloque y
   no se ha tocado. En modo mesa —que es la captura del AP11— no se pinta.

3. **En una fila caben cuatro de las ocho categorías de Sirope**, y el reparto se corta en el primer
   chip que no entra: "Croissantysandwich" (200 px, el tope de `max-w`) bloquea todo lo que va detrás
   aunque lo siguiente fuera estrecho. Saltárselo enseñaría más categorías a cambio de que "Más (N)"
   contuviera un elemento del medio, que es más difícil de explicar. **Merece mirarse con el catálogo
   real de un cliente**: si el caso común es una categoría larga bloqueando tres cortas, el criterio
   de prefijo no es el bueno.

4. **El fondo de los atajos (`mipiace.stone`) es casi blanco y el texto va en `slate-500`.** Viene de
   v1.14 y en el Mac se lee justo. En el AP11, con brillo de barra, hay que comprobar que el atajo se
   distingue del fondo del panel — es un botón, y ahora aparece también bajo las líneas del ticket,
   donde tiene más riesgo de leerse como decoración.

5. **Sigue sin haber señal de que la lista del ticket tiene más líneas debajo** (hallazgo 3 del done
   de v1.14, no resuelto aquí). Con 8 líneas se ven 3,4 y nada lo dice.

6. **`CartLineItem` sigue con targets por debajo de la escala táctil** (`h-9 w-11` en el stepper,
   36 × 44 contra el mínimo de 48). Es el hallazgo 2 del done de v1.14 y sigue pendiente. Ahora hay
   un argumento más para tocarlo: con la línea a 90 px, dos líneas ya consumen el hueco entero del
   desglose y dejan sin sitio a los atajos de §3.
