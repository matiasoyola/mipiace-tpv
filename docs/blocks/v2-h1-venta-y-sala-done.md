# Bloque v2-H1 · la venta y la sala de hostelería — HECHO

Prompt: `docs/code-prompts/bloque-v2-hosteleria-venta-y-sala.md`.
Rama `v2-h1-venta-y-sala` desde `master`. PR contra `master`. **Ni merge, ni
despliegue, ni APK.**

Terminal de referencia: **Kozen D8 (AP13)**, viewport 1443 × 812. Terminal que no
se rompe: **AP11**, 1280 × 800. Handheld: 390.

---

## 0 · El resumen en seis líneas

- El nombre de un producto pasa de **16 px a 24**, y el color de su familia pinta
  **el botón entero** en vez de una raya de 4 px. Era literalmente la queja:
  «la única distinción es una pequeña línea de color, con el texto diminuto».
- **Los 31 Licores de La Maestranza caben enteros en una pantalla**, a 1443 × 812
  y a 1280 × 800. Antes se veían 25 y había que desplazar para los otros seis.
- La comanda dice **qué está en cocina y qué no**, y lo que no está se corrige
  con un `−` y un `+` de 56 × 56 sobre la propia línea.
- «Ahora» abre por defecto: los 20 más pedidos de esta franja horaria.
- La sala va en oscuro y con formas —taburetes redondos, mesas rectangulares,
  terraza redonda—, **todas del mismo tamaño**, y la **Barra la primera**.
- **Los toques no bajan: son los mismos.** Lo que cambia es que se lee. Está
  medido y explicado en §7.

---

## 1 · Lo que se midió, antes y después

Bucle visual con `playwright-core`, Chromium de `ms-playwright`, `vite` sirviendo
`apps/tpv-web` y `page.route` sobre `/api/**`. El «antes» **no está estimado**:
se capturó devolviendo `apps/tpv-web/src` y `apps/api/src` al commit base del
bloque (`4ce04e8`) y volviendo a pasar el banco. Capturas, medidas y el guion en
`docs/blocks/v2-h1-venta-y-sala-shots/`.

### Lo que el prompt pide medir

| | antes | después |
|---|---|---|
| **Nombre de producto** | 16 px | **24 px** (20 px el suelo, en una familia apretada) |
| **Línea de comanda** | 14,5 px | **21 px** enviada · **23 px** sin enviar |
| **Total a cobrar** | 32 px | **46 px** |
| **Nombre de mesa** | 19 px | **28 px** |
| **Importe de mesa** | 19 px | **22 px** |
| **Productos visibles sin desplazar · vista inicial** | 25 de 62 | **20 de 20** («Ahora») |
| **Productos visibles sin desplazar · Licores (31)** | **25 de 31** | **31 de 31** |
| **Toques para la comanda típica** | 7 | **7** |
| **Toques para cobrarla en efectivo** | 4 | **4** |

La comanda típica es la del prompt: 2 cafés con leche + 1 tostada de tomate +
2 cañas, enviar. Los siete toques incluyen el que abre la mesa desde la sala.

### La cuadrícula, medida en el navegador

| | 1443 × 812 | 1280 × 800 |
|---|---|---|
| Caja de la cuadrícula | 991 × 521 px | 828 × 509 px |
| «Ahora» (20) | 4 × 5, botón **241,8 × 97**, nombre **24 px** | 4 × 5, botón **201 × 95**, nombre **24 px** |
| Licores (31) | 5 × 7, botón **191,8 × 67**, nombre **22 px** | 5 × 7, botón **159,2 × 65**, nombre **20 px** |
| Desplazamiento de la página | 812 / 812 · ninguno | 800 / 800 · ninguno |
| Desplazamiento dentro de la rejilla | 521 / 521 · ninguno | 509 / 509 · ninguno |
| **Techo real de productos por pantalla** | **42** | **35** |

**El número que el prompt pide por su nombre**: una familia de **36 productos ya
no cabría a 1280 × 800** con el mínimo de 64 px de alto y 20 px de nombre. El
bloque lo dice aquí en vez de partirla en páginas, que es lo que §3b prohíbe. A
1443 × 812 el techo son 42. Licores, con 31, cabe en los dos con holgura.

### La comanda

| | medido |
|---|---|
| Ancho | 420 px (360 antes) |
| Línea «En cocina» | 52 px de alto, nombre 21 px, importe 20 px |
| Línea «Sin enviar» | 68 px de alto, nombre 23 px, importe 23 px, cantidad 24 px |
| `−` y `+` | **56 × 56** cada uno |
| «Cobrar» | 212 × **68** px, rótulo 22 px |
| Teclas de cantidad | 64 × 56 |
| Desborde del importe fuera de la comanda | **−21 px** (o sea, 21 px DENTRO) |

### La sala

| | antes | después |
|---|---|---|
| Tamaño de mesa | 168 × 118 en las cuatro zonas | **144 × 144 en las cuatro zonas** |
| Área | 19.824 px² | **20.736 px²** |
| Tamaños distintos en pantalla | 1 | **1** |
| Radio por zona | único | **Barra y Terraza 72 px (círculo), Salón y Reservados 20** |
| Orden de bandas | Salón · Terraza · Reservados · **Barra** | **Barra** · Salón · Terraza · Reservados |
| Cabecera | 212 px hasta la primera mesa | **80 px**, una fila |
| La Maestranza a 1443 × 812 | 812 / 812 · sin desplazar | 812 / 812 · **sin desplazar** |
| La Maestranza a 1280 × 800 | 800 / 800 · sin desplazar | 800 / 800 · **sin desplazar** |
| Sirope, los dos tamaños | sin desplazar | **sin desplazar** |

Bandas de La Maestranza, medidas: BARRA 656 × 220 en y=104, SALÓN 972 × 182 en
y=342, TERRAZA 972 × 182 en y=542. Lienzo 624 px de los 641 disponibles a 800.

---

## 2 · Las decisiones del prompt, una por una

**1 · Tema oscuro.** `docs/design/tokens.md` gana la sección §9 «Oscuro ·
hostelería» con superficies, texto, estados de mesa y la paleta de familia. Todo
sale de `lib/hospitalityTheme.ts`; **ni un hex suelto en un componente**, y hay
test que recorre los `style` de la pantalla y comprueba que todo color pintado
está en el módulo de tokens.

**2 · Escala TPV.** `tokens.md` §3.1, con su justificación. Los mínimos del
prompt se cumplen todos y la mayoría con margen (§1).

**3 · Familia primero, producto después.** Barra de familias de 76 px, nombre a
21, relleno del color de la familia en todo el botón, la activa con **aro** —no
cambiando el relleno: si la selección cambiara el color, el camarero perdería la
única pista que tiene para encontrar la familia sin leer—. Sin vista «Todos».

**3b · Nunca paginación.** La cuadrícula se adapta: 4 × 5 hasta 20, más columnas
a partir de ahí. Los números están en §1 y la aritmética en
`lib/hospitalityGrid.ts`, que devuelve `fits: false` cuando una familia no cabe
—y no ofrece partirla, porque está prohibido—.

**3c · Cantidad antes del producto.** Fila 1–6 entre las familias y la
cuadrícula. Vuelve a 1 tras cada producto, incluso si el producto abre el modal
de modificadores.

**3d · −/+ grandes.** 56 × 56 a los lados de la cantidad, sólo en «Sin enviar».
Un toque = una unidad; `−` con una unidad quita la línea. La comanda sube a
420 px y el importe nunca se recorta (medido: 21 px dentro del borde).

**4 · «Ahora» primera y por defecto.** `GET /tpv/catalog/now`, §4 de este
documento.

**5 · Comanda partida.** «EN COCINA · hh:mm» (atenuada, sin −/+) y «SIN ENVIAR»
(destacada). §3 de este documento explica cómo se sabe qué está enviado sin
tocar el esquema.

**6 · Cantidad dentro del botón.** `×N`, contando enviado y sin enviar: lo que
el camarero comprueba es cuántos lleva la mesa.

**7 · Sin «Quitar la última».** **No existía.** Se buscó en todo `apps/`
(`Quitar la última`, `Quitar últim`, `removeLast`, `quitarUltima`) y no hay nada
equivalente en la venta de hostelería: lo más parecido es la papelera por línea
del panel claro, que es otra cosa y que en la comanda oscura la sustituye el `−`.
No se ha quitado nada porque no había nada que quitar.

**8 · Sala.** §5 de este documento.

---

## 3 · Lo más difícil del bloque: saber qué está en cocina

La decisión 5 pide partir la comanda en «En cocina» y «Sin enviar». El problema
es que **`TicketLine` no tiene marca de envío ni `createdAt`** y el prompt
prohíbe cambios de esquema. La marca vive en el TICKET (`lastSentAt`,
`lastSentRevision`, que v1.4 ya escribía): el servidor sabe **cuándo** se envió,
pero no **qué**.

Lo descartado, con su motivo:

- **Añadir `sentAt` a `TicketLine`.** Es la respuesta correcta y habrá que darla
  algún día, pero lleva migración y el prompt la veta. Queda como carryover.
- **Deducirlo del orden de las líneas.** No hay orden garantizado: el `include`
  del DRAFT pide `lines: true` sin `orderBy`, así que llega el orden físico de
  Postgres. Apoyar en eso la diferencia entre «la cocina lo tiene» y «no lo
  tiene» es apoyarla en un detalle del planificador.
- **Sólo `localStorage`.** Funciona hasta que el camarero recarga, y entonces la
  comanda entera aparece «sin enviar» con sus −/+ puestos: el TPV ofreciendo
  corregir unidades de algo que ya está en la plancha.

**Lo que se hace** (`lib/kitchenSentLines.ts`): el conjunto local de ids
enviados, persistido por ticket, **sembrado con el `lastSentAt` del servidor**.
Si el ticket dice que ya se envió algo y este terminal no tiene registro local
(recarga, otro terminal), se marcan como enviadas las líneas que el DRAFT traía
al abrir.

Para que el terminal pueda leer eso, `serializeDraft` y `serializeTicket`
devuelven ahora `lastSentAt` y `lastSentRevision`. **No es un cambio de
esquema**: no hay migración, ni columna nueva, ni índice — es el mismo `include`
de siempre enseñando dos campos más.

**El caso que esto NO acierta, dicho en voz alta**: una línea que **otro
terminal** añade después del último envío y antes de que este terminal abra la
mesa se pinta como «En cocina» sin estarlo. El camarero la ve atenuada y sin
−/+, así que el fallo es por el lado prudente —no ofrece corregir lo que no
debe—, pero es un fallo. En un bar de un terminal, que es lo que v1.10 asume, no
ocurre.

**Efecto lateral bueno**: hasta ahora `kitchenRevision` arrancaba en 0 en cada
montaje, así que tras una recarga el botón rotulaba «Enviar» con la comanda nº 2
ya impresa en cocina. Ahora dice la verdad desde el primer pintado.

---

## 4 · «Ahora» · `GET /tpv/catalog/now`

Los 20 productos más vendidos del comercio en la **franja de ±1 h** sobre la hora
actual, en los **últimos 28 días**. Sin migraciones: se lee de `ticket_lines` y
`tickets`, lo mismo que `top-sellers`.

**Por qué no vale `/tpv/catalog/top-sellers`, que ya existía**: rankea el TURNO
entero (o el último mes). A las ocho de la mañana lo que se pide son cafés y
tostadas; a las ocho de la tarde, cañas. Un ranking del turno de mañana entero le
pone las tostadas delante al camarero del aperitivo. Son dos preguntas distintas
con dos ventanas distintas.

Tres números con motivo:

- **28 días** son cuatro semanas exactas, así que la muestra tiene el mismo
  número de lunes que de sábados. Con 30, dos días de la semana pesan un 25 % más
  que los otros cinco, y en un bar el sábado no se pide lo que el martes.
- **±1 h** da tres horas de muestra. Con una sola hora un bar tranquilo entre
  semana no junta ventas suficientes para que el orden signifique algo; con ±2 se
  mezcla el desayuno con el aperitivo, que es lo que esta vista viene a separar.
- **20 productos** es el 4 × 5 de la maqueta.

Dos detalles que costaron pensarlos:

1. **La franja se calcula en SQL con `AT TIME ZONE 'Europe/Madrid'`**, no en JS.
   `created_at` es `timestamptz` y lo que se compara es la hora de PARED del
   local: a las 21:00 de Madrid le corresponden las 19:00 UTC en verano y las
   20:00 en invierno, así que extraer la hora en UTC mezclaría la franja del
   aperitivo de julio con la de la cena de enero.
2. **La comparación va en aritmética modular de 24 h** para que la franja
   envuelva la medianoche: a las 00:30 la franja es 23:00–01:00, y un `BETWEEN`
   daría vacío. Un bar de copas cierra a las tres; si la vista se quedara en
   blanco justo en su hora punta, «Ahora» no serviría para nada.

**El relleno lo hace el servidor** y reparte **por turnos** entre familias (uno
de cada una, luego el segundo de cada una…). Familia a familia, un comercio
nuevo con nueve familias vería veinte cafés y ni una caña — peor que una pantalla
vacía, porque parece que el catálogo está mal cargado.

**Offline**: `lib/ahora.ts` cae en tres peldaños — respuesta fresca (5 min en
memoria), última respuesta guardada en `localStorage`, y si no hay ninguna, el
orden de familias calculado en local con **la misma regla** que usa el servidor.
Nunca una rejilla vacía, nunca una excepción que rompa la pantalla que abre.

---

## 5 · La sala, y el conflicto que había que resolver primero

La maqueta pinta las formas de **tres tamaños distintos** (taburete 128, salón
190 × 132, terraza 168). Eso es exactamente el bug que mató v1.23 —la misma mesa
de cuatro medía 509 × 118 / 124 × 118 / 84 × 84, 7,1× de diferencia de área— y el
prompt prohíbe regresar nada de v1.23.

Lo zanja el propio prompt en su §2: «las formas se colocan por zona con el layout
que mida v1.23 (**mismo tamaño de mesa en todas las zonas**…)». Así que **la
maqueta manda en la FORMA y v1.23 manda en el TAMAÑO**: una sola caja para toda
mesa, y lo único que cambia por zona es el radio. Las posiciones absolutas de la
maqueta —colocadas a mano para la sala concreta de La Maestranza— se quedan como
ilustración: el reparto lo sigue haciendo el `flex-wrap` de v1.23, que es lo que
funciona con la sala de cualquier comercio y sin editor de posiciones.

**Por qué cuadrada y no 168 × 118**: un círculo en una caja 7:5 es una elipse. El
taburete de la barra y la mesa redonda de la terraza dejarían de ser «formas del
local» para ser óvalos.

**Por qué 144 y no 148**, que es el techo del caso real:

| lado | alto del lienzo | 1443 × 812 (653) | 1280 × 800 (641) | área |
|---|---|---|---|---|
| 144 | 624 | cabe, 29 de sobra | cabe, **17 de sobra** | 20.736 |
| 148 | 636 | cabe, 17 de sobra | cabe, **5 de sobra** | 21.904 |
| 152 | 648 | cabe, 5 de sobra | **NO cabe** | 23.104 |

v1.23 habría cogido el techo. Aquí se coge 144 a propósito: `roomCanvasHeight`
**reproduce** la regla de corte de flexbox, no la mide, y v1.23 ya dejó escrito
que el borde de `1.5px` lo cuantiza el navegador a 1 px por lado. Cinco píxeles
están dentro del error de esa reproducción; diecisiete, no. El bucle visual lo
confirmó: 812/812 y 800/800, sin desplazar.

**La cabecera** mete título, contador, filtros de zona y «Venta rápida» en UNA
fila de 80 px, y la leyenda se va al pie. La clara repartía lo mismo en tres
bloques que sumaban 212 px antes de la primera mesa. **Esos 108 px recuperados
son los que permiten que la mesa crezca** de 19.824 a 20.736 px² sin que la sala
empiece a desplazar.

**La cabecera dice «N abiertas · X €»**, como pide la decisión 8. El «M libres»
se va: con la mesa libre siendo ahora lo más claro del lienzo, contarlas es
repetir con un número lo que la sala ya dice de un vistazo. **El cálculo no se
toca** —sigue siendo `summarizeOpenTables`, el módulo que v1.22 comparte con el
aviso de mesas abiertas del cierre—, que es lo que el prompt protege.

---

## 6 · Decisiones tomadas sin preguntar

1. **Componente hermano, no una rama dentro de `SaleWorkspace`.** Thalía,
   Cachictos y Sole usan la misma `SalePage`, y un `if (isHospitality)` repartido
   por 800 líneas es la forma de que un retoque en la venta del bar le mueva la
   pantalla a una peluquería seis meses después.

2. **La barra superior se va DENTRO de la comanda.** La maqueta no tiene barra,
   pero la de hoy es la puerta de nueve destinos de un toque y el alcance exige
   el mismo número de toques o menos. Conservarla arriba costaba **68 px de alto
   del catálogo**, y con eso la cuadrícula bajaba a 6 filas, la capacidad a 30 y
   **los 31 Licores dejaban de caber a 1280 × 800**. Dentro de la comanda el
   coste sale de la lista de líneas, que es flexible y sobra. «Mapa» es la flecha
   de volver, que es un toque igual que antes.

3. **Los banners de salud van por el mismo camino y por el mismo motivo**: a
   ancho completo costaban otros ~40 px del catálogo y habrían roto el mismo
   requisito justo cuando se cae la red.

4. **El campo de búsqueda se extrae a `components/SaleSearchInput.tsx`** y lo
   montan las dos pantallas. No es cosmético: plegado vive fuera de cuadro con
   `inputMode="none"`, y eso es a la vez donde aterriza el lector USB-HID y la
   capa que impide que Android saque el teclado (N1 de v1.22).

5. **Las siete acciones secundarias salen de `buildTicketActions()`**, compartido
   con `TicketPanel`. Con la lista en dos sitios, añadir una acción a la hoja del
   bar y olvidarla en la del retail es cuestión de tiempo.

6. **Paleta de nueve tonos propia**, con su propia clave de almacén, no los seis
   de `categoryTones.ts`. Son dos paletas distintas —seis tonos de icono contra
   nueve rellenos— y mezclarlas haría que activar el tema oscuro reasignara los
   iconos del TPV claro. Nueve porque una carta de bar tiene nueve familias y con
   seis dos familias vecinas comparten color.

7. **El color de familia vuelve al FONDO del botón**, que es lo que v1.14.1
   retiró. No es una marcha atrás a ciegas: v1.14.1 lo retiró porque el reparto
   era alfabético y nueve colores competían **en la misma rejilla**. Con familia
   primero, la cuadrícula enseña UNA familia a la vez.

8. **El alto máximo del botón de producto (120 px) no está en el prompt.** Sin
   tope, una familia de cuatro productos da botones de 256 px: un cartel, no un
   botón, y rompe el reconocimiento por posición al saltar de «Cervezas» (4) a
   «Licores» (31). 120 está por encima de los 98 del caso canónico de la maqueta,
   así que no toca lo que Matías revisó.

9. **El alias del camarero sale de la forma de la mesa y se queda en el `title`.**
   En 144 px caben tres líneas y la decisión 8 pide esas tres (nombre, importe,
   minutos); una cuarta obligaba a bajar el importe de 22 px, que es el dato que
   se comprueba. Dentro de la mesa lo pinta la cabecera de la comanda.

10. **En handheld la fila de cantidad pasa a rejilla de 3 × 2.** Seis teclas de
    56 piden 376 px y a 390 hay 358 (a 320, 288). Lo encontró el bucle visual:
    las teclas 5 y 6 se salían por la derecha, que es scroll horizontal y está
    prohibido por `ux-principles` §1.8.

11. **`roomGrid.ts` se queda con UNA medida.** Se retiran `TABLE_CARD_WIDTH/
    HEIGHT`, `TABLE_CARD_SIZE_CLASS`, `ROOM_GRID_CLASS`, `handheldCardWidth` y la
    cuenta rectangular del importe. El tamaño entra por `style` con una
    constante, así que el número vive una vez: desaparece el test que vigilaba la
    copia **y desaparece el hueco por el que un `[&>*]:!w-[124px]` colado en un
    envoltorio se escapaba de jsdom** —v1.23 lo dejó anotado como un sabotaje que
    se le escapaba—. Y el `grid-cols-2` de handheld ya no hace falta: con 144 px
    el `flex-wrap` da dos columnas a 390 por la regla general.

12. **El importe de la mesa se mide contra la CUERDA del círculo**, no contra el
    lado: a la altura del importe un círculo de 144 deja 138,3 px.

---

## 7 · Los toques no bajan, y por qué está bien

El criterio de cierre del prompt pide toques antes y después. El resultado,
medido en el navegador sobre la comanda canónica:

| | antes | después |
|---|---|---|
| Comanda (2 cafés + 1 tostada + 2 cañas, enviar) | **7 toques** | **7 toques** |
| Cobro en efectivo | **4 toques** | **4 toques** |

**Los mismos.** Y tiene sentido: el prompt exige explícitamente que todo llegue
«con el mismo número de toques o menos», y la cuenta de toques de marcar tres
productos era ya mínima. Lo que el bloque arregla no es el número de toques: es
**cuánta atención cuesta cada uno**, que es literalmente lo que Matías dijo
(«tienes que poner demasiada atención para marcar las cosas»). Eso se ve en las
medidas de §1: el nombre pasa de 16 a 24 px, el color deja de ser una raya de
4 px, y la familia entera cabe en una pantalla en vez de obligar a desplazar.

**Sobre los tiempos**: el banco dio 2,39 s antes y 1,74 s después para la
comanda. **No se reporta como una mejora de producto** y no debería usarse como
tal: es tiempo de una máquina pulsando sobre una API mockeada, no de un camarero.
La diferencia mide la latencia de la UI, no la del humano. El tiempo de verdad
sale de la pasada en el hierro, que la hace Dirección.

**Lo que sí es una medida honesta de velocidad**: en «Ahora» los tres productos
de la comanda típica están a la vista sin tocar ninguna familia, porque son los
primeros de la suya. Antes, con «Todos» en orden alfabético y 25 de 62 visibles,
eso dependía de la letra.

---

## 8 · Tabla de sabotajes

Los **dieciséis** se aplicaron **de verdad** sobre el árbol limpio, se corrió su
test y se revirtieron con `git checkout --`. El árbol quedó limpio al terminar.

| # | Sabotaje | Test que cae | Mensaje real |
|---|---|---|---|
| 1 | Volver la vista «Todos» y abrirla por defecto | `v2-h1-sabotajes` › *la vista inicial es «Ahora», no «Todos»* | `expected 'Todos' to be 'Ahora'` · `expected [ Array(11) ] to not include 'Todos'` · `expected [ … ] to have a length of 20 but got 52` |
| 2 | Paginar Licores a 20 por página | › *los 31 Licores están en el DOM* | `expected [ … ] to have a length of 31 but got 20` |
| 3 | Que la cantidad no vuelva a 1 | › *«3» + Café + Caña → 3 cafés y 1 caña* | `expected [ …(2) ] to deeply equal [ …(2) ]` · `expected 'false' to be 'true'` |
| 4 | Un `−` que deje la línea a 0 | › *1 caña + «−» → la línea DESAPARECE* | `expected [ { nombre: 'Caña', qty: '0' } ] to have a length of +0 but got 1` |
| 5 | −/+ en una línea ya enviada | › *«En cocina» no lleva −/+* | `expected [] to have a length of 1 but got +0` (4 tests) |
| 6 | Bajar el objetivo táctil a 44 px | › *los −/+ miden 56 × 56* | `expected 44 to be greater than or equal to 56` |
| 7 | Pintar el color de familia sólo en un borde | › *el fondo del botón es el color de su familia* | `expected 'rgb(28, 32, 38)' to be 'rgb(225, 196, 135)'` |
| 8 | Bajar el nombre de producto a 17 px | › *la escala TPV no baja del suelo* | `expected 17 to be greater than or equal to 20` (3 tests) |
| 9 | Quitar la cantidad del botón | › *tras añadir dos cañas, su botón dice «×2»* | `expected null not to be null` · `expected undefined to be '×1'` |
| 10 | Un `−` que borre la línea entera | › *2 cañas + «−» → 1 caña* | `expected [] to deeply equal [ { nombre: 'Caña', qty: '1' } ]` |
| 11 | Aplicar el tema oscuro a RETAIL | › *RETAIL se sigue pintando con el TPV claro* | `expected <div …(4)>…(2)</div> to be null` (RETAIL y SERVICES) |
| 12 | «Ahora» sin ventas devuelve vacío | `catalog-ahora-route` › *un comercio SIN ventas ve 20 productos* | `expected [] to have a length of 20 but got +0` (4 tests) |
| 13 | La Barra deja de ser la primera | `table-map-tamano-unico` › *la BARRA es la primera banda* | `expected 'SALÓN' to be 'BARRA'` |
| 14 | Quitarle el círculo a la Barra | `room-grid` › *la forma cambia por zona* | `expected 20 to be 72` |
| 15 | Una zona con su propio tamaño (el bug de v1.23) | `table-map-tamano-unico` › *TODA mesa mide exactamente lo mismo* | `expected [ '144pxx144px', '124pxx124px' ] to deeply equal [ '144pxx144px' ]` |
| 16 | Encoger la mesa a 118 px | `room-grid-importe` › *el importe cabe en la forma* | `expected false to be true` · `expected -8.82… to be greater than or equal to 5` |

### Un sabotaje que NO cayó, y qué significa

Cambiar el `useState` de la vista inicial a una familia concreta
(`{ kind: "family", tag: "cafes" }`) **no pone nada en rojo**. No es un hueco en
el test: es que el efecto que recupera de una familia desconocida la devuelve a
«Ahora» mientras el catálogo carga, así que el comportamiento sigue siendo
correcto por dos caminos a la vez. El sabotaje que sí describe lo que el prompt
teme —**reintroducir una vista «Todos» y abrirla por defecto**— cae con tres
tests. Queda anotado para que nadie lo lea como una red más fuerte de lo que es:
lo que está atado es **que la vista inicial sea «Ahora» y que no exista
«Todos»**, no la línea concreta del `useState`.

---

## 9 · Lo que el bucle visual encontró y cambió el código

Cinco cosas que jsdom no podía ver. Ninguna es un retoque estético.

1. **La última fila de la cuadrícula salía cortada por el borde de la pantalla.**
   `gridAutoRows: minmax(Npx, 1fr)` tiene un suelo, así que en cuanto la caja
   medida y la caja real discrepaban por unos píxeles la rejilla crecía por
   encima de su contenedor. Medido a 1443 × 812: «Agua» y «Rioja» partidas a la
   altura del viewport. Ahora las filas son explícitas y acotadas.
2. **Con pocos productos los botones se volvían carteles de 540 px de alto.** El
   tope de `PRODUCT_MAX_HEIGHT` dejó de aplicarse al pasar a filas fraccionarias.
3. **En handheld las teclas 5 y 6 de la fila de cantidad se salían de la
   pantalla**: scroll horizontal, prohibido por `ux-principles` §1.8. Medido
   después del arreglo: `scrollWidth` 390 de 390.
4. **En una mesa redonda el botón «Cobrar X €» salía por los dos lados del
   círculo** colgando como una etiqueta, y encima se pisaba con la meta «cuenta».
5. **«1 abiertas»** en la cabecera de la sala. Lo caza Sirope, que tiene una sola
   mesa ocupada.

Y dos del banco, no del producto, que vale la pena dejar escritos porque costaron
media hora cada uno: el **service worker** del plugin PWA secuestraba parte de la
API —hay que bloquearlo en el contexto de Playwright o parte de las peticiones se
van al proxy de vite y vuelven con un 500— y el recorte del **banner de modo
prueba** se llevaba la app entera por delante (buscaba el div más alto que
contuviera el texto).

---

## 10 · Diferencias respecto a la maqueta, declaradas

| Diferencia | A propósito o pendiente |
|---|---|
| Hay una fila de chrome (menú, lupa, cámara, refrescar, Tickets, Más…) dentro de la comanda, que la maqueta no tiene | **A propósito** · §6.2: sin ella se perdían nueve destinos de un toque, y arriba costaba los 31 Licores |
| Las mesas son todas del mismo tamaño; la maqueta pinta tres | **A propósito** · §5, lo zanja el propio prompt |
| Las mesas se reparten con el `flex-wrap` de v1.23, no en las posiciones absolutas de la maqueta | **A propósito** · el prompt excluye el editor de posiciones; las absolutas sólo valen para la sala de La Maestranza |
| La leyenda de la sala va al pie, no intercalada | **A propósito** · §5, son 43 px que el lienzo necesita |
| El botón «Cobrar X €» de una mesa en cuenta tapa la meta | **A propósito** · §9.4 |
| Los sheets (modificadores, línea, mover, partir, cobro) siguen en **claro** | **Pendiente, declarado** · el prompt acota el oscuro a «la venta y la sala»; un sheet claro sobre pantalla oscura es una costura visible. Candidato a v2-H2 |
| El drawer del menú de caja sigue en **claro** | **Pendiente, declarado** · mismo motivo; es un menú compartido con el resto del TPV |
| El orden de las familias es alfabético | **Pendiente** · la maqueta las ordena por lógica de carta (Cafés, Desayunos, Cervezas…). Hoy sale del orden de los tags; ordenarlo a mano pide el editor de v2-H2 |

---

## 11 · Tests

| Suite | Resultado |
|---|---|
| `npx vitest run` (workspace entero) | **317 ficheros, 3729 tests verdes**, 3 saltados (antes del bloque: 315 / 3674) |
| `npx vitest run --project tpv-web` | **101 ficheros, 1109 tests verdes** |
| `tsc --noEmit` de `tpv-web` y de `api` | limpio |

**Ficheros nuevos**: `v2-h1-sabotajes.test.tsx` (35), `catalog-ahora-route.test.ts`
(11, en `api`).

**Un test del banco de guardias cambió a propósito**: `h1-caja-gate` cuenta las
rutas de `tpv-catalog/routes.ts` que llevan `ensureCajaEnabled` y sube de 4 a 5
con `GET /tpv/catalog/now`. El guardia hace justo su trabajo — añadir una ruta de
caja sin la puerta lo pone rojo, y añadirla con la puerta obliga a tocar el
número a mano.

**Trece ficheros existentes afirmaban justo lo que este bloque cambia.** Ninguno
era una regresión de RETAIL: los trece renderizan HOSPITALITY. Dos tratos:

- **Siete se re-apuntan a RETAIL, no se borran** (`sale-rail-categorias`,
  `sale-categories`, `sale-ticket-hierarchy`, `sale-ticket-filler`,
  `sale-catalog-grid`, `cart-line-undo-remove`, `sale-search-empty-state`). El
  rail, los chips, la jerarquía del panel, los atajos del hueco y el stepper
  siguen existiendo y siguen teniendo que funcionar — pero en la pantalla de
  Thalía, Cachictos y Sole, que es la que el bloque se compromete a no tocar.
  Borrarlos habría dejado esos componentes sin red en el mismo bloque que los
  deja de usar en un vertical.
- **Seis se reescriben contra la pantalla nueva** (`table-sale-flow`,
  `mesas-concurrencia`, `table-exit-release`, `sale-topbar-vertical`,
  `sale-buscador-ime`, `handheld-layout`), más los cuatro de la sala
  (`table-map-tamano-unico`, `table-map-visual`, `room-grid`,
  `room-grid-importe`, `table-card-importe-linea-propia`,
  `cashier-alias-display`, `table-map-offline`). Se afirma el fondo —un toque,
  `onBackToMap`, 56 px, `lineExternalId`, un solo tamaño de mesa— y no el rótulo.

**Y reescribirlos encontró cuatro regresiones de verdad**, que es el motivo de
reescribirlos en vez de darlos por obsoletos:

1. La lupa de hostelería no plegaba (`setSearchOpen(true)` en vez de un toggle).
   Plegar es lo que devuelve `inputMode` a `none`, o sea lo que vuelve a cerrarle
   la puerta al teclado de Android.
2. En handheld la comanda es una hoja que arranca cerrada, y dentro quedaban
   encerrados **el campo donde aterriza el lector USB-HID**, la lupa y la flecha
   de volver a la sala.
3. La venta de hostelería se apilaba en handheld y **perdía la barra inferior de
   v1.0-handheld**: había que bajar a la rejilla para marcar y volver a subir
   para ver el total.
4. jsdom no implementa `matchMedia`, así que el layout de handheld no existía en
   el árbol de los tests. Se declara con un doble (`declaraPantalla`).

### Qué NO cubre la suite

- **Los píxeles.** jsdom no hace layout. Los dos sabotajes de «tamaño (computed
  style)» del prompt se comprueban sobre el `style` que el componente deja
  PUESTO —la misma constante que lee el test— y no sobre el tamaño renderizado.
  Por eso los componentes pintan las medidas por `style` con la constante y no
  con una clase de Tailwind. Los píxeles de verdad están en §1.
- **Que el navegador reparta las bandas como dice `roomCanvasHeight`.** La regla
  de corte de flexbox está *reproducida* en una función pura, no leída del
  navegador.
- **La franja horaria y la ventana de 28 días de «Ahora»** viven en el
  `$queryRaw`: el test comprueba que la consulta las pide (zona, `% 24`,
  intervalo), no que Postgres las resuelva. El `% 24` sólo se demuestra de verdad
  contra una base.
- **Que Android no saque el teclado.** Como en v1.22: se prueba el foco y el
  `inputMode`, que son las dos cosas que lo disparan.

---

## 12 · Lo que NO se ha tocado

- **RETAIL y SERVICES**: ni un píxel. Hay tres tests que lo afirman (sabotaje 11)
  y siete ficheros re-apuntados que vigilan el panel claro entero.
- **Sin cambios de esquema**, sin migraciones. Las dos columnas nuevas en la
  respuesta del DRAFT ya existían en la base desde v1.4.
- **Nada de v1.22**: el teclado del sistema (N1, con test propio y arreglado dos
  veces en este bloque), el CashPad y el aviso de mesas abiertas del cierre.
- **Nada de v1.23**: toda mesa sigue midiendo lo mismo, y de hecho más área.
- **La cabecera de sala que reutiliza el aviso de mesas abiertas**:
  `summarizeOpenTables` intacto.
- Panel del propietario, super-admin, «Empezar de cero», nombre corto de botón,
  posición fija editable, editor de sala → fuera de alcance.

**C11 queda anotado y sin tocar**, como pide el prompt: «Cancelar» de «Cerrar el
día» se sigue dibujando fuera del modal.

---

## 13 · Dudas abiertas y carryover

1. **`sentAt` por línea de `TicketLine`.** Es la respuesta correcta a §3 y lleva
   migración. Hasta entonces, el caso de dos terminales escribiendo en la misma
   mesa entre dos envíos se pinta por el lado prudente pero mal.
2. **Los sheets y el drawer siguen en claro** (§10). Es la costura más visible
   que deja el bloque.
3. **El orden de las familias es alfabético** (§10). Lo natural sería el orden de
   la carta, y eso pide el editor de v2-H2.
4. **Una familia de más de 35 productos no cabe a 1280 × 800** (§1). Hoy ninguna
   carta real lo pide —Licores, la mayor, tiene 31— pero el día que pase, lo que
   hay que discutir es si el AP11 sigue siendo un terminal soportado para esa
   carta, no si se pagina.
5. **`HealthBannerDark` duplica la decisión de QUÉ enseñar** con `HealthBanner`.
   Lo correcto sería un módulo puro `healthNotice(health)` y dos pintores; no se
   hizo porque tocar `HealthBanner` es tocar la pantalla de RETAIL.
6. **Las skills `sistema-visual-mipiace` y `metodologia-front-mipiace` siguen sin
   existir en disco**, ni en el repo ni en `~/.claude/skills/`. Es el tercer
   bloque que lo dice (v1.22 §11 y v1.23). El bloque se guió por
   `docs/ux-principles.md` y `docs/design/tokens.md`.
7. **El bucle visual corre contra una API mockeada**, no contra la cuenta de
   pruebas: el banco vive en el scratchpad de la sesión y el repo no tiene
   Playwright como dependencia (este bloque tampoco se la añade). Los datos son
   la carta y la sala reales de La Maestranza reconstruidas en el guion
   (`shots/comun.mjs`), no un volcado de su base.

8. **`GET /tpv/catalog/now` no filtra por tienda.** La consulta lleva
   `t.tenant_id` y nada más, así que un tenant con dos locales mezcla las ventas
   de los dos en una vista que el propio bloque describe como «los más pedidos en
   ESE comercio». El filtro es posible —la sesión de cajero trae `rid` y
   `Register` tiene `storeId`—. Es el mismo hueco que ya tenía `top-sellers`, no
   una regresión de este bloque. Hoy no afecta a ningún comercio en producción,
   que tienen una tienda.

9. **La franja y la vuelta de medianoche no tienen test contra Postgres, y el
   relleno tapa el fallo.** `catalog-ahora-route.test.ts` corre contra un prisma
   falso: comprueba que la plantilla SQL lleva `AT TIME ZONE`, el `% 24` y los
   parámetros, no que la base los resuelva. Y si la franja devolviera vacío a las
   00:30, «Ahora» **no se vería rota**: el relleno del servidor la completa con
   los primeros de cada familia y la pantalla parece correcta, mientras un bar de
   copas tiene la vista muerta en su hora punta. **Es el primero de esta lista a
   cerrar**, con un e2e que fije la hora a las 00:30 y compruebe que la franja
   23:00–01:00 devuelve las ventas de esas horas.

10. **`lib/ahora.ts` no tiene tests propios de los peldaños 2 y 3.** Ningún test
    importa el módulo: lo que se prueba es la pantalla con la API mockeada
    (sabotaje 1), o sea el peldaño bueno. La última respuesta guardada en
    `localStorage` y el orden de familias calculado en local —los dos que
    sostienen el «nunca una rejilla vacía» cuando se cae la red— van sin prueba.

---

## 14 · Ficheros

| Fichero | Qué |
|---|---|
| `apps/tpv-web/src/lib/hospitalityTheme.ts` | **nuevo** · el tema oscuro, la escala TPV y la paleta de nueve |
| `apps/tpv-web/src/lib/hospitalityGrid.ts` | **nuevo** · la aritmética de la cuadrícula sin paginación |
| `apps/tpv-web/src/lib/kitchenSentLines.ts` | **nuevo** · qué está en cocina y qué no |
| `apps/tpv-web/src/lib/ahora.ts` | **nuevo** · «Ahora» con sus tres caídas |
| `apps/tpv-web/src/pages/SalePage.hospitality.tsx` | **nuevo** · la venta oscura |
| `apps/tpv-web/src/components/SaleSearchInput.tsx` | **nuevo** · el buscador, extraído (N1) |
| `apps/tpv-web/src/pages/SalePage.tsx` | bifurcación por vertical, estado de envío, «Ahora», chrome |
| `apps/tpv-web/src/pages/SalePage.moreSheets.tsx` | `buildTicketActions` compartido |
| `apps/tpv-web/src/pages/TableMapScreen.tsx` | la sala oscura, formas por zona, Barra primera |
| `apps/tpv-web/src/lib/roomGrid.ts` | una sola medida; formas; la cuerda del círculo |
| `apps/tpv-web/src/App.tsx` | `initialKitchen` desde el endpoint que abre el borrador |
| `apps/api/src/tpv-catalog/routes.ts` | `GET /tpv/catalog/now` |
| `apps/api/src/tables/operativa.ts`, `apps/api/src/tickets/routes.ts` | `lastSentAt` / `lastSentRevision` en la lectura |
| `docs/design/tokens.md` | §3.1 escala TPV, §9 oscuro · hostelería, `tap-cobrar-hosteleria` |
| `docs/blocks/v2-h1-venta-y-sala-shots/` | 18 capturas, medidas antes/después y el guion del banco |

---

## 15 · Criterios de aceptación

| Criterio | Estado |
|---|---|
| Tema oscuro en venta y sala de hostelería, desde tokens | ✅ §2.1, test de que no hay hex sueltos |
| Escala TPV en `tokens.md` con justificación | ✅ §3.1 de `tokens.md` |
| Familia primero, sin «Todos», relleno en todo el botón, activa con aro | ✅ §2.3, sabotajes 1 y 7 |
| Nunca paginación; una familia entera en una pantalla | ✅ 31 de 31 Licores a 1443 y a 1280, medido |
| Cantidad 1–6 entre familias y productos, vuelve a 1 | ✅ sabotaje 3 |
| −/+ de 56 px sólo en «Sin enviar»; `−` con 1 quita la línea | ✅ sabotajes 4, 5, 6, 10 |
| «Ahora» primera y por defecto | ✅ sabotaje 1 |
| Comanda partida en «En cocina · hh:mm» y «Sin enviar» | ✅ §3 |
| Cantidad dentro del botón | ✅ sabotaje 9 |
| Sin «Quitar la última» | ✅ no existía (§2.7) |
| Sala: formas por zona, mismo tamaño, Barra primera, sin scroll | ✅ §1 y §5, sabotajes 13, 14, 15 |
| `GET /tpv/catalog/now`, sin migraciones, con offline | ✅ §4, sabotaje 12 |
| RETAIL y SERVICES no cambian, con test de las dos variantes | ✅ sabotaje 11 |
| Sin cambios de esquema | ✅ §12 |
| Ningún objetivo < 56 px; «Cobrar» 68 | ✅ sabotaje 6, token propio en `tokens.md` §4 |
| Sin animaciones salvo el feedback de pulsado | ✅ `PRESS_FEEDBACK_CLASS`, 120 ms |
| Medidas antes/después en el `-done` | ✅ §1 |
| Tabla de sabotajes con el mensaje real | ✅ §8, los dieciséis aplicados de verdad |
| Bucle visual a 1443, 1280 y 390, con diferencias anotadas | ✅ §9 y §10 |
