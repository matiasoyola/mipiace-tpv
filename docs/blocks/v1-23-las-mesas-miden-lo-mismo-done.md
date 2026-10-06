# Bloque v1.23 · Las mesas miden lo mismo — DONE

**Rama:** `v1-23-las-mesas-miden-lo-mismo` (desde `master`) · **PR contra `master`** ·
ni merges ni despliegues.

**Origen:** `docs/qa/2026-09-02-auditoria-por-procesos.md` → **E1**, confirmado en el AP13 el
2026-10-06 (`docs/qa/2026-10-06-ap13-usabilidad/r4-08-cobrado.png`).

En un bar el cobro empieza en las mesas: el mapa es la primera pantalla del camarero. Y en esa
pantalla **la misma mesa de 4 personas medía 509 × 118 px en Salón, 124 × 118 en Terraza y un
círculo de 84 px en Barra** — 7,1× de diferencia de área para el mismo objeto. El tamaño no lo
decidía ni el número de mesas ni su uso: lo decidía un ancho fijado de antemano por zona.

---

## Lo que se midió, antes y después

Bucle visual con `playwright-core`, sala de La Maestranza (6 Salón + 6 Terraza + 4 Barra) y de
Sirope (3 Salón + 1 Terraza). Capturas y rects completos en
`docs/blocks/v1-23-las-mesas-miden-lo-mismo-shots/` (`antes-medidas.json`, `despues-medidas.json`).

### Tamaño de la tarjeta de mesa

| Vista | Tamaño | Antes | Después |
|---|---|---|---|
| Todas · 1443 × 812 | Salón / Terraza / Barra | **509 × 118 / 124 × 118 / 84 × 84** | **168 × 118 / 168 × 118 / 168 × 118** |
| Todas · 1280 × 800 | Salón / Terraza / Barra | **427 × 118 / 124 × 118 / 84 × 84** | **168 × 118** en las tres |
| Filtrada «Salón» · 1443 | la misma mesa | 668 × 118 | 168 × 118 |
| Filtrada «Terraza» · 1443 | la misma mesa | 668 × 118 | 168 × 118 |
| Filtrada «Barra» · 1443 | la misma mesa | 84 × 84 | 168 × 118 |
| Handheld 390 × 844 | Salón / Barra | 153 × 118 / 84 × 84 | 320 × 118 en las dos |

La mesa que peor salía parada era la de barra: **7.056 px² contra 59.944** de una de Salón, y
además sin PAX, sin minutos, sin cajero y sin botón de cobro. Ahora toda mesa son **19.824 px²**.
Nótese también que *filtrar* cambiaba el tamaño: la misma mesa de Salón pasaba de 509 a 668 px de
ancho sólo por tocar un chip.

### Rect de cada zona y scroll

| Sala · viewport | Zona | Antes (x, y, w × h) | Después (x, y, w × h) |
|---|---|---|---|
| Maestranza · 1443 × 812 | SALÓN | 28, 212, 1069 × 420 | 28, 212, **1116 × 156** |
| | TERRAZA | **1115, 212, 300 × 420** | 28, **386**, 1116 × 156 |
| | BARRA | 28, **650**, 1387 × 164 | 28, **560**, **752 × 198** |
| | **página** | **842 px sobre 812** → desplaza | **812 sobre 812** → entra |
| Maestranza · 1280 × 800 | SALÓN | 28, 212, 906 × 420 | 28, 212, 1116 × 156 |
| | TERRAZA | 952, 212, **300** × 420 | 28, 386, 1116 × 156 |
| | BARRA | 28, 650, 1224 × 164 | 28, 560, 752 × 198 |
| | **página** | **842 sobre 800** → desplaza | **800 sobre 800** → entra |
| Sirope · 1443 y 1280 | — | entraba (4 mesas) | entra; SALÓN 570, TERRAZA 206 de ancho |

El lienzo empieza en **y = 212** en los dos tamaños (cabecera 77 + `p-7` 28 + fila «Sala · N
abiertas…» 64 + leyenda 43) y acaba 28 px antes del borde: quedan **560 px** a 800 y **572** a 812.
El lienzo mide ahora **546**. Antes medía 602 y por eso E1 veía «BARRA» empezar fuera de pantalla.

El `300 × 420` de TERRAZA es el bug en una celda: 300 px de ancho **pasara lo que pasara**, y 420 de
alto para tres filas de dos columnas. Esa columna ya no existe.

---

## 1 · El tamaño sale de un sitio, no de la zona

`apps/tpv-web/src/lib/roomGrid.ts` (nuevo) guarda el tamaño y la aritmética del lienzo, en un
módulo puro al estilo de `catalogGrid.ts`: constantes **medidas en el navegador**, el componente
pinta con ellas, y las funciones puras las comen para que un sabotaje cambie el número que entra y
el test caiga.

- `TABLE_CARD_WIDTH = 168` / `TABLE_CARD_HEIGHT = 118`.
- `TABLE_CARD_SIZE_CLASS = "h-[118px] w-full sm:w-[168px]"` — la clase literal que pinta ese
  tamaño. El JIT de Tailwind no compila `w-[${W}px]`, así que el número vive dos veces; un test
  comprueba que la clase y las constantes no se separan.
- `roomColumnsFor`, `zoneOuterWidth`, `roomCanvasHeight`, `roomFitsWithoutScroll`.

**De dónde sale el 168.** Es el mayor ancho con el que La Maestranza entra entera sin desplazar a
1280 × 800, el suelo del bucle visual. Una banda de 6 mesas pide `6·W + 5·14 + 36`; con 168 son
1114 de los 1224 útiles. Con 184 cabría por 14 px; con 200, no. No es un número bonito: es el techo
del caso real. Si mañana una sala pide más mesas por banda, lo que cede es **el número de
columnas** (las mesas bajan de fila), nunca el tamaño de la tarjeta.

El 118 de alto es el de v1.9.3 sin tocar: ya era el alto de todas las tarjetas —lo que variaba era
el ancho— y la tarjeta sigue enseñando lo mismo. Los dos números están muy por encima del mínimo
táctil de 64 px de `tokens.md`.

## 2 · Las zonas fluyen; las columnas salen del ancho

`RoomGrid` pasa de `grid grid-cols-2` —dos columnas tanto en los 1050 px de Salón como en los 300
de Terraza, que es de donde salía el ×4— a `flex flex-wrap` con tarjetas de tamaño fijo. El número
de columnas lo decide el ancho que haya dividido por el tamaño de tarjeta: **7 a 1443 px, 6 a
1280**, con 6 mesas en una sola fila en los dos.

El lienzo deja de ser `lg:grid-cols-[minmax(0,1fr)_300px]` y pasa a ser un `flex-wrap` de marcos de
zona. Cada marco mide su `max-content` —lo que piden sus mesas— y el navegador hace el resto: la
zona que no cabe en la línea en curso baja a la siguiente, y la que no cabe ni sola se encoge y sus
mesas pasan a varias filas. `roomCanvasHeight` reproduce esa regla de corte para poder afirmarla en
un test.

Resultado en La Maestranza: tres bandas (SALÓN 1116, TERRAZA 1116, BARRA 752), una debajo de otra,
546 px en total. Las bandas tienen anchos distintos **a propósito**: una zona de 4 mesas no ocupa
lo mismo que una de 6.

## 3 · Una vista, no dos

La vista filtrada por zona metía Salón, Terraza y Reservados en un único `RoomGrid` de dos
columnas: el mismo problema con otra forma, y la razón de que filtrar por Salón subiera la mesa de
509 a 668 px. Ahora **«Todas» y la filtrada son el mismo código**: el lienzo recorre
`ZONE_ORDER` (Salón → Terraza → Reservados → Barra) y pinta las zonas que tengan mesas visibles.
El camarero lee la sala en el mismo orden, esté filtrando o no.

## 4 · El sitio de barra es una mesa

Los taburetes eran círculos de 84 × 84 con el nombre y, como mucho, el importe: la mitad del área
de una mesa de Terraza, una séptima parte de una de Salón, y sin PAX, sin minutos, sin cajero y
**sin el botón «Cobrar X €»** que sí tenían las demás. La zona de más rotación de un bar era la que
peor se veía y la única desde la que no se podía cobrar.

Ahora la BARRA pinta la misma `TableCard` que el resto de la sala. La identidad visual de la zona
—el mostrador dibujado, que es lo que el prompt deja conservar— sigue ahí encima de las mesas.
`BarStool` desaparece.

---

## Sabotaje → test rojo

Cada sabotaje se aplicó sobre el árbol limpio y se devolvió con `git checkout --`. Dos redes: la
suite de jsdom (estructura) y el comprobador de rects del bucle visual (navegador real).

| Sabotaje | Test que cae | Mensaje real |
|---|---|---|
| Volver a `lg:grid-cols-[minmax(0,1fr)_300px]` | `table-map-tamano-unico` › «el lienzo no reserva una columna fija de 300 px para Terraza» | `AssertionError: expected [ <div …(1)>…(4)</div> ] to have a length of +0 but got 1` |
| ” | rects › sin desplazar | `× [1443x812] la sala no cabe: la página mide 1272 px sobre 812 visibles`<br>`× [1280x800] la sala no cabe: la página mide 1272 px sobre 800 visibles` |
| Volver `RoomGrid` a `grid-cols-2` fijo | `table-map-tamano-unico` › «ninguna zona se pinta con dos columnas fijas» | `AssertionError: expected [ <div …(1)>…(4)</div>, …(3) ] to have a length of +0 but got 4` |
| ” | rects › más de dos columnas | `× [1443x812] la zona de Salón pinta 2 columnas con 6 mesas (se esperaban más de 2)`<br>`× [1280x800] la zona de Salón pinta 2 columnas con 6 mesas (se esperaban más de 2)` |
| Volver los taburetes a 84 × 84 | `table-map-tamano-unico` › «la barra ya no pinta círculos de 84 px: mide como una mesa» | `AssertionError: expected '<div class="min-h-screen bg-mipiace-s…' not to contain 'w-[84px]'` |
| ” | rects › área del taburete ≥ área de la mesa | `× [1443x812] la mesa de barra mide 84x84 = 7056 px² y la de salón 168x118 = 19824 px²`<br>`× [1443x812] las mesas NO miden lo mismo: 168x118 / 84x84 (… B1 84x84, B2 84x84, B3 84x84, B4 84x84)` |
| Romper el tamaño compartido: Terraza con su propia clase (`!w-[124px]` en la tarjeta) | `table-map-tamano-unico` › «ninguna mesa lleva una medida ADEMÁS de la compartida» | `AssertionError: expected [ '!w-[124px]' ] to deeply equal []` |
| ” | rects › todas las mesas miden lo mismo | `× [1443x812] una mesa de Salón mide 168x118 y una de Terraza 124x118`<br>`× [1443x812] las mesas NO miden lo mismo: 168x118 / 124x118 (M1 168x118, …, T1 124x118, …)` |

### Lo que el sabotaje enseñó y no esperaba

**El test de rects del tamaño NO cae al revertir sólo el lienzo**, y es correcto que no caiga: con
la tarjeta de tamaño fijo, poner otra vez la columna de 300 px ya no encoge la mesa — la saca de la
caja. El tamaño **dejó de depender del lienzo**, que es justamente lo que pedía el bloque. Lo que sí
cae es el test de estructura (la columna de 300 vuelve a existir) y el de scroll (el lienzo se va a
1272 px). La prueba de que el lienzo entero de v1.9.3 sí daba tamaños distintos está medida en
`antes-medidas.json`: 509 / 124 / 84.

**Una variante del cuarto sabotaje se escapa de jsdom.** Si el override va en un envoltorio
(`<div className="contents [&>*]:!w-[124px]">`) en vez de en la tarjeta, el test de clases pasa
—la tarjeta sigue llevando sólo las suyas— y el único que lo caza es el de rects:
`× [1443x812] una mesa de Salón mide 168x118 y una de Terraza 124x118`. Queda declarado abajo.

---

## Lo que la suite NO cubre

**jsdom no hace layout**: `getBoundingClientRect()` devuelve ceros, no resuelve `flex-wrap`, no
reparte líneas y no sabe qué es `sm:`. Por tanto la suite del repo **no comprueba ni un solo píxel
real**. Lo que comprueba es:

- que el tamaño sale de una constante compartida y que la clase y el número no se han separado;
- que ninguna tarjeta lleva una medida propia además de la compartida;
- que el lienzo no contiene la columna de 300 px ni ningún `grid-cols-2`;
- que la barra no contiene `w-[84px]` / `h-[84px]`;
- la aritmética (`roomColumnsFor`, `zoneOuterWidth`, `roomCanvasHeight`, `roomFitsWithoutScroll`)
  alimentada por las constantes que el componente pinta.

Queda **fuera de la suite** y sólo lo ve el bucle visual:

1. Que el navegador reparta las zonas como dice `roomCanvasHeight` (la regla de corte de flexbox
   está *reproducida* en una función pura, no leída del navegador).
2. Que dos mesas de zonas distintas acaben con el mismo rect en pantalla.
3. Que la sala entre sin desplazar en un viewport concreto.
4. Un override de tamaño colado en un envoltorio con variantes arbitrarias de Tailwind
   (`[&>*]:!w-[…]`), que jsdom no puede resolver porque es CSS.
5. Nada de esto corre en CI: el comprobador de rects vive en el scratchpad de la sesión, no en el
   repo (el repo no tiene Playwright como dependencia y este bloque no se la añade).

---

## Bucle visual

`playwright-core` instalado en el scratchpad de la sesión, Chromium de `ms-playwright`, banco
servido con `npx vite --port 5277 --strictPort` desde `apps/tpv-web` y `page.route` sobre
`**/api/**`. Entrada por **modo prueba** (JWT sin firmar con `purpose: "test-cashier"` en
`sessionStorage`), con el banner ámbar de modo prueba **retirado del DOM antes de medir**: no
existe para un camarero real y falsearía el reparto vertical.

- **24 capturas** en `docs/blocks/v1-23-las-mesas-miden-lo-mismo-shots/`, `antes-*` y `despues-*`.
- **Salas:** La Maestranza (16 mesas, con una ocupada a 55,00 €, una pidiendo cuenta a 12,50 € y
  una de barra abierta) y Sirope (4 mesas).
- **Tamaños:** 1443 × 812 (AP13), 1280 × 800 (AP11/AP12) y 390 × 844 (handheld).
- **Vistas:** Todas y filtrada por Salón, Terraza y Barra.
- **Medidas** en `antes-medidas.json` / `despues-medidas.json`: rect de cada mesa, rect de cada
  zona, rect del lienzo y `scrollHeight` / `clientHeight` del documento.

Los cuatro criterios se comprueban a máquina (`comprobar.mjs`, en el scratchpad): mismo tamaño para
toda mesa, más de dos columnas con 6 mesas, área de barra ≥ área de salón, y sala sin desplazar.
En verde: `rects verdes: 4 comprobaciones x 2 tamaños`.

---

## Decisiones tomadas sin preguntar

1. **168 px de ancho, no un número redondo.** Sale de la restricción dura (entrar sin desplazar a
   1280 × 800) y no del gusto. Documentado en `roomGrid.ts` y en `tokens.md`.
2. **Las bandas no se estiran.** Una zona ocupa el ancho que piden sus mesas y deja el resto de la
   línea vacío (BARRA mide 752 de los 1387 disponibles). La alternativa —estirar el marco a toda la
   línea con las tarjetas a la izquierda— se ve más "ordenada" pero miente sobre el tamaño de la
   zona, y el prompt pide lo contrario.
3. **Una zona por línea en La Maestranza.** Salón (1114) y Terraza (1114) no caben juntas en 1387,
   así que van una debajo de otra. Se descartó repartir columnas entre zonas para meterlas en la
   misma línea: habría hecho que el número de columnas de una zona dependiera de **las otras
   zonas**, que es la clase de acoplamiento que este bloque viene a quitar.
4. **La barra reutiliza `TableCard` en vez de un taburete agrandado.** Un taburete de 168 × 118
   habría sido código nuevo midiendo lo mismo por casualidad; reutilizar la tarjeta lo hace cierto
   por construcción. Efecto lateral deliberado: una mesa de barra en BILLING **ahora se puede
   cobrar desde el mapa** como cualquier otra, y enseña PAX, minutos y cajero.
5. **Una sola vista.** Al desaparecer la columna fija, la rama «filtrada» del render dejó de tener
   razón de ser. Se borró, y con ella la segunda forma del mismo bug.
6. **`ZONE_ORDER` fijo** (Salón → Terraza → Reservados → Barra) en vez del orden de llegada de la
   API. El mapa tiene que leerse igual todos los días.
7. **En handheld, una columna literal.** El prompt dice que handheld sigue apilando en una columna;
   antes eran dos columnas de 153 px. Ver «Efectos colaterales».
8. **`tokens.md` actualizado.** La ficha «Mesa card» decía `aspect 7/6, rounded-2xl` y llevaba
   obsoleta desde v1.9.3. El token manda: si una zona quisiera su propio tamaño, se discute ahí.

---

## Efectos colaterales, declarados

- **El mapa en handheld es más largo que antes.** A 390 × 844, La Maestranza pasa de 1488 px de
  página a **2614**: una mesa por fila en vez de dos de 153 px. Es lo que pide «handheld sigue
  apilando en una columna», y a cambio la mesa del móvil mide 320 × 118 en vez de 153 × 118 (y la
  de barra, 320 × 118 en vez de 84 × 84). Si en un piloto con teléfono eso molesta, el arreglo es
  una línea en `TABLE_CARD_SIZE_CLASS` — pero es una decisión de producto, no de este bloque.
- **La barra ofrece cobro directo.** No es un cambio de flujo de dinero: es el mismo botón, el
  mismo `GET /tickets/:id` y el mismo `CheckoutOverlay` que ya tenían las demás mesas. Simplemente
  dejó de haber mesas de segunda.
- **Un test existente cambió de expectativa.** `table-map-visual` › «barra: taburetes ordenados por
  barSeatIndex» comparaba el texto exacto del botón (`"B2"`); ahora la tarjeta de barra trae
  también el PAX. El test comprueba el mismo orden leyendo el prefijo.

## Lo que NO se tocó

- Datos, endpoints, lógica de estados, `groupedIntoTableId` y bloqueo por outbox: intactos.
- **La cabecera «N abiertas · M libres · X € en sala»**: no se movió ni una línea. El bloque
  **v1.22**, en curso en otra rama, la reutiliza para el aviso de mesas abiertas del cierre.
- Editor de sala, posiciones libres, arrastrar mesas: no existen y no se han creado.
- Zonas, PAX y nombres de mesa: igual.
- La pantalla de venta: no se ha abierto.

---

## Dudas abiertas

1. **Las skills `sistema-visual-mipiace` y `metodologia-front-mipiace` no existen en disco** — ni
   en el repo ni en `~/.claude/skills/` (que sólo tiene `caveman`, `humanizer` y `napkin`). El
   bloque se guió por `docs/ux-principles.md` y `docs/design/tokens.md`. Si esas skills existen en
   otra máquina, conviene revisar el resultado contra ellas.
2. **Reservados nunca se midió con mesas de verdad**: ni La Maestranza ni Sirope tienen esa zona.
   El código la trata como una banda más, pero no hay captura que lo demuestre.
3. **Salas grandes sin medir.** `roomCanvasHeight` dice que 20 mesas en una zona a 1280 piden 4
   filas y 528 px, pero no hay ningún tenant con esa sala para fotografiarlo. El criterio del
   prompt (si no caben, scroll vertical y la Barra no queda la última fuera de pantalla) se cumple
   por construcción —la Barra es una banda más del `flex-wrap`, no un bloque anclado abajo— pero
   eso es un argumento, no una medida.

---

## Tests

Nuevos:

- `apps/tpv-web/test/room-grid.test.ts` (12) — la clase y las constantes dicen lo mismo; mínimo
  táctil; área de barra ≥ área de mesa; más de dos columnas con 6 mesas a 1443 y a 1280; la zona
  pide el ancho de sus mesas y no 300 px; La Maestranza y Sirope caben en los dos tamaños; con la
  tarjeta de 508 px **no** cabían; alto del lienzo = 546; una sala de 20 mesas pasa a varias filas.
- `apps/tpv-web/test/table-map-tamano-unico.test.tsx` (7) — las nueve mesas del lienzo llevan la
  misma clase de tamaño; ninguna lleva una medida además de la compartida; la barra no pinta
  círculos de 84 px; no hay columna de 300 px; no hay `grid-cols-2`; la vista filtrada usa el mismo
  tamaño que «Todas»; filtrando por Barra se sigue viendo el mostrador.

Tocado: `apps/tpv-web/test/table-map-visual.test.tsx` (el orden de la barra, ver arriba).

Verde: `npx vitest run` desde la raíz → **285 ficheros, 3167 tests, 3 skipped**. (En un worktree
recién creado hay que correr `pnpm db:generate` antes, o los 68 ficheros de `api` fallan con
`Cannot find module '.prisma/client/default'` y parece que el bloque ha roto el backend.)

## Ficheros

| Fichero | Qué |
|---|---|
| `apps/tpv-web/src/lib/roomGrid.ts` | **nuevo** · tamaño único y aritmética del lienzo |
| `apps/tpv-web/src/pages/TableMapScreen.tsx` | `RoomGrid` a `flex-wrap`, lienzo único, `BarZone` con `TableCard`, `BarStool` borrado |
| `apps/tpv-web/test/room-grid.test.ts` | **nuevo** |
| `apps/tpv-web/test/table-map-tamano-unico.test.tsx` | **nuevo** |
| `apps/tpv-web/test/table-map-visual.test.tsx` | orden de la barra |
| `docs/design/tokens.md` | ficha «Mesa card» al día |
| `docs/blocks/v1-23-las-mesas-miden-lo-mismo-shots/` | 24 capturas + rects antes/después |

## Criterios de aceptación

| Criterio | Estado |
|---|---|
| Mismo tamaño de tarjeta para toda mesa, en todas las zonas y en las dos vistas | ✅ 168 × 118 medido en 1443 y 1280, vista Todas y las tres filtradas |
| Los taburetes conservan la franja pero no un objetivo táctil menor | ✅ mostrador intacto; área 7.056 → 19.824 px² |
| Cada zona ocupa el sitio que piden sus mesas | ✅ SALÓN 1116, TERRAZA 1116, BARRA 752 (antes: 1069 / **300** / 1387) |
| Las columnas salen del ancho y del tamaño de tarjeta, no de `grid-cols-2` | ✅ 7 a 1443, 6 a 1280; `grid-cols-2` borrado |
| El tamaño sale de un único sitio | ✅ `roomGrid.ts`; test que prohíbe medidas sueltas |
| La tarjeta sigue enseñando lo de hoy sin recortar el importe | ✅ nombre, PAX, minutos, cajero, importe y estados; el importe lleva `shrink-0` + `whitespace-nowrap` |
| La Maestranza y Sirope sin scroll a 1443 × 812 y 1280 × 800 | ✅ 812/812 y 800/800 (antes 842/812 y 842/800) |
| La Barra no queda la última fuera de pantalla | ✅ empieza en y = 560 y termina en 758 de 812 (antes: 650 → 814) |
| Handheld sigue apilando en una columna | ✅ a 390, zonas apiladas y una mesa por fila |
| Escala táctil y radios de `tokens.md`; tarjeta ≥ 64 × 64 | ✅ 168 × 118, `rounded-[18px]` |
| Sin cambios en datos, endpoints, estados, agrupación ni bloqueo | ✅ |
| La cabecera de sala sin tocar (la usa v1.22) | ✅ |
| Medidas y tabla de sabotajes en el `-done` | ✅ |

## Hallazgos nuevos (fuera de alcance, para el siguiente bloque)

- **La mesa libre sigue siendo 118 px de alto con 24 de contenido.** Ahora que todas miden igual se
  ve mejor: una mesa libre enseña el nombre y el PAX, y deja ~70 px en blanco. La tarjeta está
  dimensionada para el peor caso (ocupada, con cajero e importe) y el caso común paga el hueco —
  es el mismo patrón que E2 señaló en la tarjeta de producto.
- **En una tarjeta de 168 px, el pie de una mesa en BILLING se queda sin sitio para el alias**: el
  botón «Cobrar 12,50 €» ocupa la línea y del camarero sólo queda el avatar de 2 letras. El nombre
  sigue en el `title`. Era igual de estrecho en la Terraza de 124 px de antes, pero ahora afecta a
  todas las zonas por igual.
- **El chip «Reservados» no aparece en ninguna sala real.** O hay tenants que lo usan y no están en
  el muestreo, o la zona está muerta y conviene saberlo antes de seguir manteniéndola.
