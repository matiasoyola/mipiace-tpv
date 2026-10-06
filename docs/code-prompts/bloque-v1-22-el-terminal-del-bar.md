# Bloque v1.22 · el terminal del bar

## Contexto (leer antes)

- `docs/qa/2026-10-06-auditoria-ap13.md` — auditoría por procesos sobre el **AP13 (Kozen D8)**, el
  terminal que va a La Maestranza. **N1, N2, N3, N5, B2, B4, C2.**
- `docs/qa/2026-10-06-ap13-usabilidad.md` y las capturas de `docs/qa/2026-10-06-ap13-usabilidad/`.
- `docs/qa/2026-09-02-auditoria-por-procesos.md` — la anterior, en el AP11. Varios hallazgos de aquí
  ya estaban allí; no los re-investigues.
- `docs/normas/cierre-caja-diario.md` — la norma de cierre de caja del 06-10. **Manda sobre el §4.**
- `docs/ux-principles.md` y `docs/design/tokens.md`. Mandan sobre cualquier medida que inventes.
- Skills `sistema-visual-mipiace` y `metodologia-front-mipiace`.

## El problema, en una frase

**En el terminal del bar no se puede cobrar un mixto sin pelearse con el teclado de Android, y el
camarero no lee qué ha metido en el ticket ni encuentra los refrescos.** La Maestranza va a cobrar
con este terminal; el bloque es lo que falta para que eso no sea un problema el primer día.

## El terminal de referencia

**Kozen D8**: 1920×1080 a densidad 213 → viewport **1443 × 812**, DPR 1,33, WebView **101** (no se
actualiza: no hay Play Store). Pantalla táctil goodix, pero su WebView responde
`matchMedia("(pointer: coarse)") = false`, `(pointer: fine) = true`, `(any-pointer: coarse) = false`,
`(hover: hover) = false`, `navigator.maxTouchPoints = 5`. El AP11 (1280×800) sigue siendo terminal
soportado: **todo lo que hagas tiene que funcionar en los dos tamaños**.

## Lo ya localizado (verificado en el código el 2026-10-06 · no volver a investigarlo)

### N1 · El teclado del sistema sale solo

- `apps/tpv-web/src/pages/SalePage.tsx` ~1120-1147: el «foco permanente al input de búsqueda para el
  scanner USB-HID» se salta en táctil **sólo** con `matchMedia("(pointer: coarse)")`. En el D8 eso da
  `false`, así que el `refocus()` corre en cada `click` en el que el foco cae en `body`.
- El input al que se re-enfoca es el buscador **plegado** (`SalePage.tsx` ~1755-1790): vive en
  `absolute -left-[9999px]` precisamente para que el lector HID siga escribiendo ahí, con
  `inputMode="search"`. Android ve un input de texto enfocado y saca el QWERTY: **viewport de 812 a
  368 px**.
- Dónde salta, medido: al entrar en venta, al abrir una mesa, tras enviar comanda, **sobre «Ticket
  emitido» tapando «Nueva venta»**, y **al tocar el importe en el cobro mixto: el CashPad se abre
  debajo y sólo se ve su fila 1-2-3** (`r4-02-foco-tarjeta.png`). Es decir, no se puede cobrar un
  mixto sin bajar el teclado con ▼.

### C2 · El CashPad no escribe sobre un importe pre-rellenado

- `apps/tpv-web/src/components/CashPad.tsx`, `applyKey()` (~126-158): con el valor ya en dos
  decimales (`6,90`, `0,00`) `room = maxDecimals - decimals` es 0 y **el dígito se ignora**. Si se
  borra uno, el siguiente se pega detrás (`6,9` + `4` = `6,94`).
- Pasa en el **mixto** (la segunda forma llega pre-rellena con el resto) y en **abrir turno** (el
  fondo llega como `0,00`). La ayuda del campo dice «escribe encima si no cuadra».
- Decisión de producto ya tomada el 02-09: **(b) el primer dígito que se teclea tras abrir el pad
  sustituye al valor pre-rellenado.** Después se escribe normal.

### B4 + N3 + N5 · Los nombres

- Línea del ticket: `apps/tpv-web/src/pages/CartLineItem.tsx:161`, `truncate` de una línea. En el
  D8 le quedan **86–100 px**: «Hamburgu…», «Café con lec…», «Estrella Galic…». En la carta de La
  Maestranza hay pares Hamburguesa normal / especial, Bocadillo / especial, Montado / especial: **se
  leen igual después de pulsarlos**.
- La línea mide ~91 px de alto (stepper de 116 × 88 + nombre + importe + papelera): en 812 px
  **caben 3 líneas** en el panel.
- Tarjeta del catálogo: `ProductTile` (`SalePage.tsx` ~2690-2730), nombre a **13,5 px** con
  `line-clamp-2`, alto por `PRODUCT_CARD_MIN_HEIGHT` (`lib/catalogGrid.ts`), que es la misma
  constante con la que `catalogRowsVisible` calcula cuántas filas caben. **Si tocas el alto, mide y
  escribe filas antes/después en los dos tamaños.**

### N2 · Categorías escondidas

- `apps/tpv-web/src/lib/chipRows.ts`: `CHIP_MAX_ROWS = 1` (decisión de v1.14.1) y lo que no cabe va a
  «Más (N)». En La Maestranza son 10 categorías: se ven 6 y **Platos, Raciones, Refrescos y Vinos**
  quedan en el sheet. Refrescos (22 productos) y Vinos son de lo que más sale en un bar.
- Al elegir una categoría del sheet, la fila sigue diciendo «Más (4)» resaltado: **no se ve en qué
  categoría estás**.
- Decisión de producto ya tomada el 02-09 (guion de la auditoría): **rail vertical fijo a la
  izquierda en tablet**; fila horizontal **sólo** en handheld. **El layout depende del dispositivo,
  nunca de un dato que el cliente cambia sin saber lo que provoca** — por eso no se conmuta según el
  número de categorías.

### B2 · Se cierra el día con mesas abiertas y nadie avisa

- Cierre con la M4 abierta y 55,00 € en sala: ni aviso en «Cerrar el día» (`CloseShiftModal.tsx`),
  ni en el arqueo, ni en el Z, ni al abrir el turno siguiente.
- El dato ya existe: `TableMapScreen.tsx` ~270-285 calcula «N abiertas · X € en sala» desde la
  respuesta de `/tpv/tables`, sin cálculo nuevo en servidor.

## Alcance

### 1 · N1 · El teclado del sistema sólo sale cuando el camarero pide escribir

- Mientras el buscador está **plegado**, su input lleva `inputMode="none"`: el lector HID sigue
  escribiendo ahí y Android no saca teclado. Al **desplegarlo**, vuelve a `search` y el teclado sale,
  que es lo que el camarero acaba de pedir.
- La decisión «¿esto es táctil?» deja de depender sólo de `pointer`. Una función, en un solo sitio
  y testeable, que dé táctil con `(pointer: coarse)` **o** `(any-pointer: coarse)` **o**
  (`maxTouchPoints > 0` **y** `(hover: none)`). En táctil, el refoco permanente no corre.
- Las dos capas, no una: la primera protege aunque la detección vuelva a fallar en el próximo
  fabricante; la segunda evita robar el foco sin necesidad.
- **Criterio de comportamiento**: con el entorno del D8 simulado, ningún toque fuera de un campo de
  texto visible deja el foco en un input que abra teclado. Recorrido: entrar en venta → añadir
  producto → cobrar efectivo → «Ticket emitido» → nueva venta → abrir mesa → mixto tocando el importe
  de tarjeta. En ningún punto un input con `inputMode` distinto de `none` tiene el foco salvo que el
  usuario lo haya tocado.
- **No rompas el lector USB-HID**: con el buscador plegado, una ráfaga de teclas terminada en Enter
  sigue añadiendo el producto por código de barras. Es el motivo de que el input exista.

### 2 · C2 · El primer dígito sustituye al pre-relleno

- En `CashPad`, al abrirse sobre un valor pre-rellenado, la primera pulsación de dígito (o `00`, o
  `,`) **sustituye** el valor; las siguientes escriben normal. «C» y borrar siguen como hoy.
- Se tiene que **ver** que el valor está «para sustituir» (p. ej. seleccionado o atenuado hasta la
  primera tecla): elige y justifica en el `-done`.
- Afecta a todos los usos del pad: cobro (todas las formas), mixto, fondo de apertura, arqueo. El
  texto «escribe encima si no cuadra» pasa a ser verdad.

### 3 · B4 + N3 + N5 · El nombre se lee entero, en la tarjeta y en el ticket

- **Línea del ticket**: el nombre deja de ser `truncate`: hasta dos líneas y sin perder la parte que
  distingue (si hace falta cortar, por el medio, no por el final). **Criterio**: con la carta real de
  La Maestranza (`docs/implantaciones/maestranza/catalogo-tpv.csv`) ningún par de productos se lee
  igual en la línea.
- **Y caben más líneas, no menos**: el stepper −/+ deja de comerse un tercio de la fila. Objetivo
  medido: **≥ 5 líneas visibles** en el panel a 1443 × 812 y ≥ 4 a 1280 × 800, sin bajar de 48 px
  ningún objetivo táctil (C8: hoy −/+ miden 44 × 36). La papelera no queda a un dedo del «−».
- **Tarjeta del catálogo**: el nombre es **lo más grande de la tarjeta**, ≥ 16 px. Si eso pide más
  alto, mide y escribe en el `-done` filas visibles antes/después a 1443 × 812 y 1280 × 800 con la
  carta de La Maestranza.

### 4 · N2 · Rail vertical de categorías en tablet

- En tablet (el criterio de «tablet» es el mismo que ya usa el layout para decidir panel lateral vs
  handheld; no inventes otro), las categorías van en un **rail vertical fijo a la izquierda del
  catálogo**: todas visibles, «Todos» primero, sin «Más (N)». Si no caben en alto, el rail hace
  scroll **vertical** (nunca horizontal, `ux-principles` §1.8).
- La categoría activa **se ve** en el rail en todo momento.
- En handheld se queda la fila con «Más (N)» de hoy, pero cuando la activa está en el sheet **el
  chip dice su nombre** (p. ej. «Refrescos ▾»), no «Más (4)».
- Mide y escribe en el `-done`: columnas de producto antes/después a 1443 y 1280 de ancho. Si el rail
  cuesta una columna, dilo con el número.
- **No cambies el orden de las categorías ni de los productos** (C6, orden por frecuencia, es otro
  bloque).

### 5 · B2 · El cierre dice que hay mesas abiertas

- «Cerrar el día» y «Cuadrar caja» enseñan, **antes** del botón de cerrar, cuántas mesas siguen
  abiertas y cuánto suman, con la lista (mesa e importe). Mismo dato que la cabecera del mapa:
  `/tpv/tables`, sin cálculo nuevo.
- **Avisa, no bloquea**: la norma `docs/normas/cierre-caja-diario.md` está a punto de cambiar el
  modelo de cierre (día de negocio, cierre automático); no metas reglas nuevas de bloqueo ni de
  traspaso de mesas que luego haya que deshacer. Un aviso visible y nada más.
- Al **abrir turno** con mesas heredadas, la pantalla de apertura también lo dice.

## Restricciones

- `docs/design/tokens.md` manda: escala táctil cerrada (48 / 56 / 64), un solo coral pleno por
  pantalla, `tabular-nums` en importes. Nada de `h-[72px]` ni medidas sueltas.
- Sin modales nuevos en el flujo de venta (`ux-principles`).
- Puedes usar el MCP de 21st para buscar componentes (rail de categorías); normalízalos a los tokens
  del proyecto antes de cerrar el bloque y lístalos en el `-done`.
- Sin migraciones. Sin endpoints nuevos salvo que el §5 lo exija de verdad (no debería).
- `chipRows.ts` documenta por qué se estima el ancho en vez de medirlo: si tocas el reparto de
  handheld, respeta esa razón.

## Verificación

Tabla **sabotaje → test rojo**, con los sabotajes aplicados de verdad y revertidos:

| Sabotaje | Debe caer |
|---|---|
| Volver el buscador plegado a `inputMode="search"` | test de que, plegado, el input no pide teclado |
| Volver la detección de táctil a sólo `(pointer: coarse)` | test con el entorno del D8 (`pointer: fine`, `hover: none`, `maxTouchPoints 5`) que dice táctil |
| Quitar el refoco del input del buscador | test del lector HID: ráfaga + Enter con el buscador plegado añade el producto |
| Volver `applyKey` a ignorar el dígito con dos decimales | test: pre-relleno `6,90`, pulsar `4` → `4` |
| Que la sustitución dure más de una tecla | test: `6,90`, pulsar `4` y `5` → `45` |
| Volver la línea del ticket a `truncate` | test con la carta de La Maestranza: ningún par de productos con el mismo texto visible en la línea |
| Devolver −/+ a 44 × 36 | test de tamaño mínimo de objetivos de la línea |
| Volver al chip «Más (N)» en tablet | test de que en tablet todas las categorías están en el rail |
| Elegir una categoría del sheet en handheld y que el chip diga «Más (N)» | test de que el chip nombra la categoría activa |
| Quitar el aviso de mesas abiertas del cierre | test con un DRAFT de mesa vivo: el cierre lo enumera con su importe |

**El caso canónico de la suite**: carta de La Maestranza, mesa M1 con Hamburguesa normal +
Hamburguesa especial + Caña mediana, cobro mixto tocando el importe de tarjeta y tecleando 4 sobre el
pre-relleno, mientras la M4 sigue abierta, y cierre del día.

Declara **qué NO cubre la suite** (el teclado real de Android no se ve en jsdom ni en Playwright: lo
que se prueba es el foco y el `inputMode`; la confirmación es la pasada en el hierro).

**Bucle visual**: Playwright a **1443 × 812** y **1280 × 800**, con `hasTouch` y la emulación de
media del D8, para (a) la pantalla de venta con el rail y la carta de La Maestranza, (b) el panel con
6 líneas incluidos los pares normal/especial, (c) el cobro mixto con el pad abierto, (d) «Cerrar el
día» con una mesa abierta, (e) abrir turno con mesas heredadas, (f) handheld 390 px con la categoría
activa en el sheet. Revisa cada captura contra `ux-principles` y tokens, e itera.

**Pasada en el hierro**: la hace Dirección en el AP13 con la APK de la rama antes del merge.
No hace falta que la hagas tú; deja en el `-done` cómo sacar la APK de la rama.

## Entregables

- Código en una rama `v1-22-el-terminal-del-bar` desde `master`, commits pequeños en español, push
  y **PR contra `master`**. Ni merges ni despliegues: eso lo hace Dirección.
- `docs/blocks/v1-22-el-terminal-del-bar-done.md` con la estructura de la metodología: qué quedó
  hecho punto por punto, **decisiones tomadas sin preguntar una a una**, las medidas pedidas (filas,
  columnas y líneas visibles antes/después en los dos tamaños), la tabla de sabotajes con el mensaje
  real de cada test rojo, las capturas, y si la rama está pusheada y con PR.
- CI verde (`ci`, `smoke`, `e2e`). Ojo con el mock literal de `catalog.js` en los tests.

## Fuera de alcance (explícito)

- **La comanda** (B3: estado enviada/reenviar, copy «SALON»/«register», jerarquía del pie E4) es el
  bloque **v1.16**, escrito y sin arrancar. Aquí no se toca `kitchen-dispatch.ts` ni el pie.
- **El modelo de cierre** de `docs/normas/cierre-caja-diario.md` (día de negocio, cierre automático,
  recuento a ciegas, salidas de caja): bloque propio. Aquí sólo el aviso del §5.
- **El resto del modal de cobro**: exceso en verde (C3), «últ. 4» con teclado del sistema (C4), «Más
  opciones» bajo el pie (C5), «Partir cuenta». Del cobro sólo se toca el CashPad (§2).
- **El arqueo** (C9, C10, C11): orden de denominaciones, «Cancelar» fuera del modal.
- **Orden del catálogo** por frecuencia (C6) y el resto de densidad del mapa (E1).
- **Los textos de Holded en cuentas sin Holded** (N4: «Sincronizando con Holded…», filtros de
  Tickets) y el inglés en pantalla (N6: CASH/CARD/DRAFT): bloque de copy aparte.
- **Vincular el terminal sin segundo dispositivo** (B5, `PairScreen`).
- Nada de v1.15 (`z-breakdown.ts`, `payments.ts`).
