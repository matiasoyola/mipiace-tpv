# v1.22 · el terminal del bar — HECHO

Prompt: `docs/code-prompts/bloque-v1-22-el-terminal-del-bar.md`.
Rama `v1-22-el-terminal-del-bar` desde `master`. Nueve commits, pusheada, PR contra `master`.

Terminal de referencia: **Kozen D8 (AP13)**, viewport 1443 × 812, DPR 1,33, WebView 101.
Terminal soportado que no se rompe: **AP11**, 1280 × 800. Handheld: 390.

---

## 0 · El resumen en cinco líneas

- El teclado de Android ya no sale solo: el buscador plegado no lo pide y en táctil no se le roba
  el foco a nadie. El cobro mixto se puede terminar sin bajar el teclado.
- El CashPad escribe sobre el importe pre-rellenado a la primera tecla, y se ve que va a hacerlo.
- La línea del ticket enseña el nombre entero en dos líneas: **de 3 líneas visibles a 5** a 1443 y
  **a 4** a 1280, con los tres objetivos táctiles a 48 × 48.
- Las diez categorías de La Maestranza están a la vista en un rail vertical. **Y el catálogo gana
  una fila**, no la pierde.
- «Cerrar el día», «Cuadrar caja», el arqueo X y la apertura de turno enumeran las mesas abiertas
  con su importe. Avisan; no bloquean.

---

## 1 · N1 · El teclado del sistema sólo sale cuando el camarero pide escribir

### Qué quedó hecho

**Capa 1 — `inputMode` del buscador plegado.** `SalePage.tsx`: el input del buscador sigue montado
fuera de cuadro (`absolute -left-[9999px]`), que es donde aterriza el lector USB-HID y toda su razón
de existir, pero mientras está **plegado** lleva `inputMode="none"`. Al **desplegarlo** vuelve a
`search`. La condición «plegado» estaba repetida en tres sitios del JSX; ahora es un nombre,
`searchCollapsed`, porque una cuarta copia que se desincronizara volvería a abrir el teclado.

**Capa 2 — la detección de táctil, en `lib/touchDevice.ts`.** `isTouchDevice()` da táctil con
`(pointer: coarse)` **o** `(any-pointer: coarse)` **o** (`maxTouchPoints > 0` **y** `(hover: none)`).
En táctil, el refoco permanente del buscador no corre.

Las dos, no una: la primera protege aunque la detección vuelva a fallar con el WebView del próximo
fabricante; la segunda evita robar el foco sin necesidad.

### El criterio de comportamiento, comprobado

Con el entorno del D8 emulado por CDP (`pointer: fine`, `any-pointer: none`, `hover: none`,
`maxTouchPoints 5`) y el recorrido entrar en venta → añadir producto → abrir mesa → cobro mixto
tocando el importe de tarjeta:

| Punto del recorrido | Foco | `inputMode` del elemento con foco |
|---|---|---|
| Entrar en venta, tras tocar un hueco | `BODY` | — |
| Tras tocar un producto | el `<button>` del producto | — |
| Cobro mixto, pad abierto sobre el importe de tarjeta | `BODY` | — |

Ningún input con `inputMode` distinto de `none` tiene el foco en ningún punto. El pad del mixto se ve
entero (`y = 358 … 670` de 812) y «Cobrar» queda debajo, alcanzable: `c-mixto-pad-1443.png`.

### Lo que esto CUESTA, dicho en voz alta

En un terminal detectado como táctil el refoco permanente no corre, así que **el lector USB-HID
necesita que el campo tenga el foco** (un toque en la lupa). Esto pasaba ya en cualquier terminal de
puntero grueso desde v1.3; lo nuevo es que el D8 entra en ese grupo —antes mentía y por eso el
refoco corría, al precio del teclado en cada toque—. Queda un test que lo deja escrito
(`sale-buscador-ime.test.tsx`, «en táctil el buscador NO se enfoca solo»).

**Si La Maestranza va a usar lector USB-HID, hay que decirlo**: la solución sería capturar la ráfaga
a nivel de documento en vez de depender del foco, y eso es un bloque aparte — no lo he metido aquí
porque el prompt dice que el input es el mecanismo y porque añadir un listener global de teclado a la
pantalla de venta no es un cambio que se cuele en un bloque de usabilidad.

---

## 2 · C2 · El primer dígito sustituye al pre-relleno

`applyKey` acepta `opts.replace`: la primera pulsación de dígito, de `00` o de la coma escribe sobre
campo vacío en vez de sobre el valor. Dura **una tecla**, no es un modo. «C» y borrar siguen igual.

**Quién decide.** El pad recuerda el último valor que emitió él; si el que le llega es otro, viene de
fuera y la próxima tecla sustituye. No es un `pristine` que se arme al montar **a propósito**: el pad
no se desmonta al cambiar de objetivo (de una denominación del arqueo a otra, de la tarjeta al
efectivo en el mixto), y con un flag de montaje la segunda fila no se podría sustituir nunca.

**Cómo se ve.** El importe va sobre `coral-soft`, como **texto seleccionado**. Es la convención que
cualquiera ha usado mil veces en un campo de ordenador —lo seleccionado se reemplaza al teclear— y no
hay que aprenderla. Se descartó **atenuar** el importe: atenuado es exactamente como se pinta
`disabled` en el mismo componente, así que el mismo gris diría «no puedes tocar esto» y «escribe
encima» en la misma pantalla.

La marca va en **dos sitios**, y el segundo salió del bucle visual: el campo (`AmountField`, con
`data-replacing`) y el **eco del importe en la cabecera del pad**. Con el pad abierto a 812 px la
fila del importe se queda por encima del pliegue del modal y la pista no se veía justo cuando hace
falta (`c-mixto-pad-1443.png`).

Afecta a cobro simple, mixto, fondo de apertura y arqueo. El texto «Resto de la cuenta · escribe
encima si no cuadra» de `CheckoutPage` pasa a ser verdad.

Comprobado en el banco: mixto con tarjeta pre-rellena a 13,70 → pulsar `4` → **4**. Fondo de apertura
`0,00` → pulsar `1` → **1**.

---

## 3 · B4 + N3 + N5 · El nombre se lee entero

### La línea del ticket

Reparto nuevo de los **302 px** de contenido de la lista (medidos, panel de 360 px):

```
[− 48][ 2 ][+ 48]   nombre hasta 2 líneas       [🗑 48]
 122 px             112 px                       48 px
                    1,60 € ud.        5,00 €
```

Tres decisiones y su porqué:

- **El stepper pasa de vertical (88 × 66, con −/+ de 44 × 36) a horizontal con las teclas a 48 × 48.**
  El vertical ahorraba ancho, pero con teclas de 48 px de alto pedía 96 px de alto de fila y el panel
  se quedaba en tres líneas.
- **Los dos importes bajan debajo del nombre, en su misma columna.** Es lo que libera el ancho: con
  el total todavía en su propia celda, el nombre se quedaba en ~50 px y arreglar B4 a 360 px de panel
  era imposible. Hice la cuenta de ensanchar el panel y costaba una columna de catálogo a 1280.
- **El alto lo marcan los objetivos táctiles, no el padding**: `py-1` y un separador de 1 px en vez
  de los 20-24 px de aire de antes.

El corte lo decide `lib/lineName.ts`, puro y testeable: dos líneas y, si no entra, **por el medio**
(60 % cabeza, 40 % cola), porque lo que distingue la carta de un bar está al final —«especial»,
«tercio», «Etiqueta Negra»—, que es justo lo que se lleva una elipsis por el final.

**Un error que encontró el bucle visual y que vale la pena contar.** La primera versión repartía un
presupuesto plano de caracteres (ancho × líneas / ancho medio de carácter) y en la captura salió
`Tostada de jamón…rk y…`: cortado **dos veces**, por el medio en el módulo y por el final por el
`line-clamp` de CSS — o sea, perdiendo la cola, que es exactamente lo que el módulo venía a salvar. El
presupuesto plano ignora que el texto se ajusta **por palabras** y que cada salto deja una línea
corta. Ahora `wrapLines` simula el ajuste entero, con el ancho de carácter (7,5 px) calibrado contra
el DOM real de los 128 nombres de la carta: a 7,5 son **0 subestimaciones** y 13 sobrestimaciones; a
7,2 aparecen 4 subestimaciones, y una subestimación es un nombre al que CSS le quita la cola.
Verificado en el navegador a 1443 y a 1280: **0 nombres cortados dos veces**.

De los 128 nombres de la carta, **8 se recortan** y **0 colisionan**.

### La tarjeta del catálogo

El nombre pasa de **13,5 px/500 a 16,5 px/500** y el precio de 15/600 a **14/600**: el nombre es lo
más grande de la tarjeta. Se invierte la jerarquía de v1.14.1 («el precio pesa más porque el nombre
se reconoce de memoria»), y el motivo es que en el AP13 ese argumento no aguanta: 13,5 px en un
lienzo de 1443 son ~18 px físicos a 157 dpi, por debajo del mínimo de 16 px de `ux-principles` §1.5,
y el camarero de La Maestranza es nuevo y tiene pares que sólo se distinguen leyendo.

**El alto de la tarjeta NO cambia**: 2 líneas de 16,5 (41 px) + precio (18) + paddings (22) son 81 de
los 104 de `PRODUCT_CARD_MIN_HEIGHT`, así que la rejilla se reparte igual.

---

## 4 · N2 · Rail vertical de categorías en tablet

`components/CategoryRail.tsx`, 144 px de ancho (medido: la etiqueta más larga de la carta pide 92 px
a 14/500, más icono, hueco y padding). En tablet —**el mismo umbral `lg` con el que el layout ya
decide panel lateral contra handheld**, sin inventar otro— todas las categorías a la vista, «Todos»
primero, sin «Más (N)», con `overflow-y-auto` y `overflow-x-hidden` por si no caben en alto.

El reparto depende del **dispositivo**, no del número de categorías: añadir la décima en Holded un
martes no puede mover de sitio lo que el camarero ya tiene aprendido.

En handheld se queda la fila con «Más (N)», pero cuando la categoría activa está dentro del sheet
**el chip dice su nombre** («Refrescos ▾»), no «Más (4)».

Orden de categorías y de productos **sin tocar**: el rail hereda el alfabético que ya había (C6,
ordenar por frecuencia, es otro bloque).

### 21st

Busqué rail de categorías en el catálogo de 21st (`search`, «vertical category rail sidebar nav icon
labels POS»). **No usé ninguno.** Los seis resultados son sidebars de aplicación con drag-and-drop
reordenable, markers animados con muelles, navegación anidada colapsable y tooltips al hover: tres de
esas cuatro cosas están prohibidas explícitamente en `ux-principles` §6, y ninguno es un selector
plano de un nivel a escala táctil fija. Normalizarlos a nuestros tokens costaba más que las 130
líneas del componente.

---

## 5 · B2 · El cierre dice que hay mesas abiertas

`lib/openTables.ts` + `components/OpenTablesNotice.tsx`. El aviso sale **antes del botón de cerrar**,
dentro de la tarjeta, en «Cerrar el día», en «Cuadrar caja», en el arqueo X y en la apertura de
turno, con la lista de mesa e importe.

Tres decisiones:

- **La regla sale de `TableMapScreen` a un módulo compartido** y la usan los tres. «Abierta» = no
  libre y no absorbida por otra mesa; «€ en sala» = la suma de los DRAFT visibles. Si la regla
  viviera en dos sitios, el aviso del cierre podría decir un número y la cabecera del mapa otro, que
  es peor que no avisar. Misma respuesta de `/tpv/tables`, sin endpoint ni cálculo nuevo.
- **El modal pregunta por sí mismo** en vez de recibirlo por prop: se monta desde cinco sitios (mapa,
  venta, menú, turno colgado y el arqueo a posteriori de la apertura) y con una prop el aviso sólo
  saldría donde alguien se acordara de pasarla.
- **Best-effort**: si el GET falla o no hay red, no se pinta nada y se cierra igual. `null` es «no se
  ha podido preguntar» y cero es «no hay ninguna»; un aviso que dijera «puede que haya mesas
  abiertas» no sirve para decidir.

**Avisa, no bloquea**: «Cerrar turno» sigue habilitado. Ninguna regla nueva de bloqueo ni de traspaso
de mesas, porque la norma de cierre va a cambiar el modelo entero.

Ámbar y no rojo: cerrar con una mesa abierta no es un error del cajero —la mesa puede seguir
cenando—, es un dato que tiene que ver antes de decidir. `tokens.md` §2 reserva el ámbar para
«atención / pidiendo cuenta».

---

## 6 · Las medidas pedidas

Todas tomadas en el navegador con la **carta real de La Maestranza** (128 productos, 9 categorías) y
el entorno del D8 emulado por CDP. El «antes» no está estimado: se capturó devolviendo
`apps/tpv-web/src` al commit base del bloque y volviendo a pasar el banco.

### Panel del ticket · 6 líneas, con los pares normal/especial

| | 1443 × 812 (D8) | | 1280 × 800 (AP11) | |
|---|---|---|---|---|
| | antes | después | antes | después |
| Alto de línea | 90 px | **62 px** | 90 px | **62 px** |
| Alto de la lista | 316 px | 316 px | 304 px | 304 px |
| **Líneas visibles enteras** | **3** | **5** | **3** | **4** |
| Caja del nombre | 95–102 px, 1 línea | **112 px, 2 líneas** | 95–102 px, 1 línea | **112 px, 2 líneas** |
| Nombres cortados (de 6) | **6** | 2, por el medio | **6** | 2, por el medio |
| `−` / `+` | 44 × 36 | **48 × 48** | 44 × 36 | **48 × 48** |
| Papelera | 44 × 44 | **48 × 48** | 44 × 44 | **48 × 48** |

Lo que se lee en las 6 líneas después: `Hamburguesa normal` · `Hamburguesa especial` ·
`Bocadillo especial` · `Montado especial` · `Estrella Gali…botellín` · `Tostada de jam…k y queso`.
Antes: `Hamburgu…` dos veces, `Montado es…`, `Estrella Galici…`, `Tostada de j…`.

### Catálogo · columnas y filas

| | 1443 × 812 (D8) | | 1280 × 800 (AP11) | |
|---|---|---|---|---|
| | antes | después | antes | después |
| Columnas | 5 | **5** | 5 | **5** |
| Ancho de tarjeta | 189 px | 157 px | 157 px | 125 px |
| **Filas completas visibles** | **4** | **5** | **4** | **5** |
| Alto de tarjeta | 104 px | 104 px | 104 px | 104 px |
| Tamaño del nombre | 13,5 px | **16,5 px** | 13,5 px | **16,5 px** |
| Categorías a la vista | 5 + «Más (4)» | **9 + Todos** | 4 + «Más (5)» | **9 + Todos** |

**El rail no cuesta una columna.** Cuesta **32 px de ancho de tarjeta** en los dos terminales y
**devuelve una fila**, porque el bloque de chips deja de gastar sus 72 px de alto. La aritmética está
en `catalogGrid.ts` (`CATEGORY_RAIL_BLOCK_HEIGHT = 0`) con su test.

Lo que sí cuesta: a 1280 las tarjetas de 125 px recortan más nombres largos con `line-clamp-2`
(«Croissant york y…», «Tostada de jamón Yor…»). Los pares del bloque (hamburguesa, bocadillo,
montado) siguen cabiendo enteros. No he llevado el corte por el medio a la tarjeta: ahí el criterio
del bloque es el tamaño, no la desambiguación, y la categoría ya da contexto. Queda dicho por si
Dirección lo quiere en otro bloque.

### Handheld · 390

Con «Refrescos» elegida desde el sheet, la fila dice `Todos` · **`Refrescos`** (en coral suave,
`aria-pressed="true"`), no `Más (4)`. El rail está en el árbol pero con ancho 0: lo oculta el `lg:`.

---

## 7 · Tabla de sabotajes

Los diez sabotajes se aplicaron **de verdad** sobre el árbol limpio, se corrió su test y se
revirtieron. Mensaje real de cada rojo:

| Sabotaje | Test que cae | Mensaje |
|---|---|---|
| Volver el buscador plegado a `inputMode="search"` | `sale-buscador-ime` · *plegado: el input existe, es enfocable y lleva inputMode none* | `expected 'search' to be 'none'` |
| Volver la detección de táctil a sólo `(pointer: coarse)` | `touch-device-d8` · *el Kozen D8 es táctil aunque diga que su puntero es fino* | `expected false to be true` |
| Quitar el refoco del input del buscador | `sale-buscador-ime` · *en escritorio con ratón el refoco permanente SIGUE vivo* | `expected <body>…</body> to be <input inputmode="none" …></input>` |
| Volver `applyKey` a ignorar el dígito con dos decimales | `cash-pad-sustituye` · *6,90 + 4 → 4* | `expected '6,90' to be '4'` |
| Que la sustitución dure más de una tecla | `cash-pad-sustituye-componente` · *pulsar 4 y 5 da 45, no 5* | `expected '5' to be '45'` |
| Volver la línea del ticket a `truncate` | `cart-line-objetivos` · *se pinta hasta en DOS líneas* | `expected 'truncate' not to contain 'truncate'` |
| Devolver −/+ a 44 × 36 | `cart-line-objetivos` · *− y + llegan a 48 × 48* | `expected [ 'h-9', 'w-11', … ] to include 'h-touch'` |
| Volver al chip «Más (N)» en tablet | `sale-rail-categorias` · *el rail lleva TODAS las categorías* | `expected [ Array(5) ] to include 'Refrescos'` |
| Que el chip diga «Más (N)» con la activa en el sheet | `sale-rail-categorias` · *el chip de desbordamiento lleva SU nombre* | `chip "Categoria 12" no encontrado` |
| Quitar el aviso de mesas abiertas del cierre | `cierre-mesas-abiertas` · *enumera la mesa con su importe* | `expected null not to be null` |

El árbol quedó limpio al terminar la pasada (`git status --porcelain -- apps` vacío).

### El caso canónico

Carta de La Maestranza, mesa M1 con Hamburguesa normal + Hamburguesa especial + Caña mediana, cobro
mixto tocando el importe de tarjeta y tecleando `4` sobre el pre-relleno, con la M4 abierta
(55,00 €), y cierre del día. Está en el banco visual de principio a fin (escenas a–e) y repartido
por la suite: `sale-buscador-ime` (el recorrido con el foco), `cash-pad-sustituye-componente` (el 4
sobre 6,90), `cart-line-maestranza` (los pares de la carta), `cierre-mesas-abiertas` (la M4 con sus
55,00 €).

### Qué NO cubre la suite

- **Que Android no saque el teclado.** El IME del sistema no existe ni en jsdom ni en Playwright. Lo
  que se prueba es el **foco** y el **`inputMode`**, que son las dos cosas que lo disparan. La
  confirmación es la pasada en el hierro.
- **Las medidas en píxeles.** jsdom no hace layout (`getBoundingClientRect` devuelve ceros), así que
  la suite pregunta por los **tokens** (`h-touch`, `w-touch`, `line-clamp`) y por la **aritmética
  pura** (`catalogRowsVisible`, `wrapLines`). Los píxeles salen del bucle visual y están en §6.
- **Que el rail se vea a la izquierda.** jsdom no aplica media queries: el rail y la fila de chips
  están los dos en el árbol y lo que se comprueba es la clase (`hidden lg:flex` contra `lg:hidden`).
  El reparto real lo dicen las capturas.
- **El lector USB-HID físico.** Se prueba la ráfaga de teclas + Enter sobre el input, no un lector.
- **La carta de La Maestranza tiene 9 categorías en el CSV**, no las 10 que contó la auditoría en el
  terminal; la décima no está en la exportación. El rail las enseña todas sea cual sea el número (hay
  test con 20 y con 30).

---

## 8 · Bucle visual

`docs/blocks/v1-22-el-terminal-del-bar-shots/`. Playwright con `hasTouch` y la emulación de medios
del D8 por CDP (`pointer: fine`, `any-pointer: none`, `hover: none`, `maxTouchPoints 5`).

| Captura | Qué enseña |
|---|---|
| `antes-venta-1443.png` / `antes-venta-1280.png` | el estado previo: fila de chips con «Más (4)» |
| `antes-panel-6-lineas-1443.png` / `-1280.png` | 3 líneas visibles, nombres cortados por el final |
| `a-venta-rail-1443.png` / `-1280.png` | (a) venta con el rail y la carta de La Maestranza |
| `a-venta-rail-refrescos-1443.png` / `-1280.png` | la categoría activa visible en el rail |
| `b-panel-6-lineas-1443.png` / `-1280.png` | (b) panel con 6 líneas, pares normal/especial |
| `c-mixto-pad-1443.png` / `-1280.png` | (c) cobro mixto con el pad abierto y el importe «para sustituir» |
| `c-mixto-pad-tras-4-1443.png` / `-1280.png` | el mismo, tras teclear `4`: 13,70 → 4 |
| `d-cerrar-dia-1443.png` | (d) «Cerrar el día» con la M4 abierta |
| `d-cuadrar-caja-1443.png` | el mismo aviso en el arqueo |
| `e-abrir-turno-1443.png` | (e) abrir turno con mesas heredadas |
| `e-abrir-turno-pad-1443.png` | el pad sobre el fondo `0,00`, marcado para sustituir |
| `f-handheld-390-chips.png` / `-sheet.png` / `-activa-en-sheet.png` | (f) handheld con la activa dentro del sheet |

Lo que el bucle encontró y cambió el código: el doble recorte del nombre (§3) y que la marca de
«para sustituir» quedaba fuera de cuadro con el pad abierto (§2).

Revisión contra `ux-principles` y `tokens.md`:

- Escala táctil cerrada: todo lo nuevo en 48 / 56 / 64. Ni un `h-[NNpx]` suelto (hay test).
- Un solo coral pleno por área de trabajo: sigue siendo «Cobrar» (el test de v1.14.1 sigue verde con
  el rail dentro de la misma `<section>`).
- `tabular-nums` en los dos importes de la línea, en el aviso de mesas y en el eco del pad.
- Sin modales nuevos en el flujo de venta: el rail y el aviso son bloques en su sitio.
- Sin scroll horizontal en ningún eje nuevo.

**Hallazgos que el bucle ve y que NO son de este bloque** (quedan declarados, no tocados): «Cancelar»
de «Cerrar el día» se sigue dibujando fuera del modal (C11) y el pie del cobro sigue tapando
«Imprimir ticket» y «Más opciones» (C5).

---

## 9 · Verde

| Suite | Resultado |
|---|---|
| `pnpm test` (workspace entero) | **291 ficheros, 3227 tests verdes**, 3 saltados |
| `npx vitest run --project tpv-web` | **92 ficheros, 988 tests verdes** (antes del bloque: 84 / 909) |
| `pnpm test:e2e` (ciclo de caja contra Postgres) | **25 ficheros, 393 tests verdes** |
| `tsc -b` de `tpv-web` | limpio |

El e2e se corrió sobre una base propia de la sesión (`mipiacetpv_v122_e2e`), no sobre la compartida.

Ficheros de test nuevos: `touch-device-d8`, `sale-buscador-ime`, `cash-pad-sustituye`,
`cash-pad-sustituye-componente`, `cart-line-maestranza`, `cart-line-objetivos`,
`sale-rail-categorias`, `cierre-mesas-abiertas`. Ampliado: `catalog-grid`.

Dos tests existentes **cambiaron a propósito**, porque afirmaban justo lo que el bloque cambia:

- `cart-line-undo-remove`: la papelera era de 44 px (`h-11`/`w-11`); ahora `h-touch`/`w-touch`.
- `sale-categories`: tras elegir del sheet el chip decía «Más (N)»; ahora dice el nombre.

---

## 10 · Decisiones tomadas sin preguntar

1. **La marca de «para sustituir» es una selección, no una atenuación** (§2). Atenuar colisiona con
   `disabled` en el mismo componente.
2. **La marca va también en el eco del pad**, no sólo en el campo (§2). Lo pidió la captura.
3. **Los importes de la línea bajan debajo del nombre** (§3). Era eso o ensanchar el panel, y
   ensanchar costaba una columna de catálogo a 1280.
4. **El stepper pasa a horizontal** (§3). Vertical con teclas de 48 px pedía 96 px de alto de fila.
5. **La papelera se queda en la línea**, al extremo opuesto del `−` (§3). El prompt pedía que no
   estuviera «a un dedo»; quitarla era pasarse de alcance.
6. **El corte del nombre simula el ajuste por palabras** en vez de contar caracteres (§3), con el
   ancho de carácter calibrado contra el DOM real. Un presupuesto plano cortaba dos veces.
7. **No llevo el corte por el medio a la tarjeta del catálogo** (§3). Ahí el criterio es el tamaño.
8. **El rail mide 144 px y es ancho fijo**, no un porcentaje (§4). Medido sobre la etiqueta más larga
   de la carta.
9. **El toggle Servicios/Productos de los verticales SERVICES se va dentro del rail**, arriba y
   separado por un divisor (§4). Es navegación fija, no una categoría.
10. **El aviso de mesas lo pide el propio modal**, no se pasa por prop (§5). Cinco puntos de montaje.
11. **`summarizeOpenTables` sale de `TableMapScreen`** y la comparte con el cierre (§5), para que el
    aviso y la cabecera del mapa no puedan divergir.
12. **El aviso es ámbar y va dentro de la tarjeta**, antes del botón (§5).
13. **No uso ningún componente de 21st** (§4), con el motivo escrito.

---

## 11 · Fuera de alcance · lo que NO se ha tocado

Tal y como lo declara el prompt: la comanda (B3, v1.16) y `kitchen-dispatch.ts`; el modelo de cierre
de `docs/normas/cierre-caja-diario.md`; el resto del modal de cobro (C3, C4, C5, «Partir cuenta»); el
arqueo (C9, C10, C11); el orden del catálogo por frecuencia (C6) y la densidad del mapa (E1); los
textos de Holded (N4) y el inglés en pantalla (N6); `PairScreen` (B5); y nada de v1.15.

**Un apunte de higiene**: `docs/normas/cierre-caja-diario.md` **no existe en el repo**. La regla
operativa que el prompt cita de él («avisa, no bloquea») sí se ha respetado, pero el documento no
está donde dice el prompt — si existe en otro sitio, conviene traerlo antes del bloque del cierre.
Lo mismo con las skills `sistema-visual-mipiace` y `metodologia-front-mipiace`: no están instaladas
en este árbol, así que el bloque se ha hecho contra `ux-principles.md` y `design/tokens.md`
directamente, que son los que mandan según el propio prompt.

---

## 12 · Cómo sacar la APK de la rama

Para la pasada en el hierro que hace Dirección sobre el AP13, antes del merge:

```bash
git fetch origin && git checkout v1-22-el-terminal-del-bar
pnpm install && pnpm --filter @mipiacetpv/db run generate

# keystore.properties está gitignored: NO viaja con la rama ni con un
# worktree nuevo. Se copia del árbol principal.
cp <arbol-principal>/apps/tpv-android/android/keystore.properties \
   apps/tpv-android/android/keystore.properties

# El primer argumento es el versionName; el versionCode sale de él.
apps/tpv-android/scripts/build-release-apk.sh 1.22.0
```

Requisitos del script, todos con mensaje propio si faltan: `keystore.properties` relleno,
`JAVA_HOME` con openjdk@17 y `ANDROID_HOME` con los commandline-tools. Aborta también si el APK no
queda firmado o si el backend de producción no quedó embebido, y exige el árbol limpio —
`ALLOW_DIRTY=1` lo permite, pero marca el build `-dirty` para siempre.

La APK firmada sale en `apps/tpv-android/build-releases/mipiacetpv-1.22.0-12200.apk` (fuera de
`app/build/outputs`, que `gradlew clean` borra y donde todos los builds se pisan). Para instalarla
sobre la 1.21.0 del terminal, con el D8 conectado (`adb connect 192.168.5.136:5555`):

```bash
adb install -r apps/tpv-android/build-releases/mipiacetpv-1.22.0-12200.apk
```

Qué mirar en el hierro, por orden:

1. Entrar en venta, abrir mesa, enviar comanda, cobrar en efectivo, «Ticket emitido», nueva venta.
   **El teclado de Android no debe salir en ningún punto.**
2. Cobro mixto: tocar el importe de tarjeta. El pad tiene que verse entero y el importe tiene que
   salir resaltado; teclear `4` lo sustituye.
3. Abrir turno: pulsar `1` sobre el fondo `0,00` sin pasar por «C».
4. Mirar el panel del ticket con seis cosas y comprobar que se leen las dos hamburguesas.
5. Las diez categorías en el rail, y Refrescos a un toque.
6. Cerrar el día con la M4 abierta: tiene que enumerarla con sus 55,00 €.
7. Si hay lector USB-HID en el local: comprobar el punto que queda abierto en §1.
