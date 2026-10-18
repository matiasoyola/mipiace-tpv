# Bloque n1-hosteleria · que el N1 sirva para un bar

## Por qué existe este bloque

`n1-vertical` (PR #35) consiguió que el N1 venda en vertical: ventana de **360×720 px CSS**
(360×449 con el teclado del sistema abierto). La pasada del 18-10 con **Cafetería Sirope · Caja 1**
en ensayo (`docs/qa/2026-10-18-n1-sirope.md`, capturas en `docs/qa/2026-10-18-n1-sirope/`)
demostró que el circuito de bar funciona de punta a punta —la comanda llega al AP11, los tres
cobros salen `TEST`—, pero que **un camarero no puede trabajar así**:

- **🔴 El mapa de mesas no se puede usar** (hallazgo 1): «Salón» y «Terraza» quedan fuera de la
  pantalla y no se alcanzan, se ven 3 de las 23 mesas y la Terraza está a casi cuatro pantallas.
- **🟡 La búsqueda con teclado no enseña ningún resultado** (2) y **al elegir familia los productos
  quedan bajo el pliegue** (7): parece que tocar no ha servido de nada.
- **🟡 La comanda en estrecho**: los nombres se cortan hasta «Caf…» (3), el «Espera» de la última
  línea queda tapado por «⚡ Urgente» (9) y la hoja sigue abierta debajo al navegar (8).

¿Y qué? Un TPV de mano en un bar sirve para **ir a la mesa, marcar y mandar a cocina sin volver a
la barra**. Hoy encontrar la mesa ya es imposible. Con este bloque el camarero encuentra cualquier
mesa en un gesto, ve lo que busca y comprueba la comanda antes de enviarla. Los terminales de 10" y
15" se quedan **exactamente** como están.

## Leer antes

1. `docs/qa/2026-10-18-n1-sirope.md` entero, sobre todo los hallazgos 1, 2, 3, 7, 8 y 9, con sus
   medidas y capturas.
2. `docs/blocks/n1-vertical-done.md`: §1.2–1.3 (barra del ticket, `visualViewport`,
   `UMBRAL_TECLADO_PX`), §4.2 (lo que los bancos jsdom **no** pueden medir) y §6 (cómo se midió a
   360×640 contra la stack del banco).
3. `apps/tpv-web/src/pages/TableMapScreen.tsx` y `apps/tpv-web/src/lib/roomGrid.ts` (el tamaño
   único de mesa, `TABLE_SHAPE_SIZE` = 144, y la aritmética del lienzo).
4. `apps/tpv-web/src/pages/SalePage.hospitality.tsx`, `SalePage.tsx` (búsqueda y rejilla de
   familias), `lib/hospitalityGrid.ts`, `lib/catalogGrid.ts` y `kitchen/tpv/ComandaCocina.tsx`.
5. Del proyecto: `principio-venta-bajo-estres` y `project_principio_cobro_en_mesa` (el cobro nace
   en la mesa; el camarero ejecuta, no piensa).

## Base de rama

**Requisito previo: el PR #35 (`n1-vertical`) mergeado en `master`.** Compruébalo con
`gh pr view 35 --json state,mergedAt`. Si no está mergeado, **para y avisa**: no se ramifica desde
`n1-vertical` ni se mergea nada por tu cuenta.

Worktree `~/Developer/Claude/Projects/mipiacetpv-n1-hosteleria`, rama `n1-hosteleria`, **desde
`master`** actualizado. PR contra `master`.

## La restricción del bloque (va primero)

**Los terminales grandes no cambian ni un píxel.** AP11 (1280×800 como cocina, 1280×728 como caja),
AP12, AP13 (1443×812) y D8 de Sirope (≈1442×811). Todo lo de este bloque se aplica **por debajo de
un único umbral de ancho**, definido **una sola vez** (constante o hook) y reutilizado en las tres
pantallas; nada de criterios distintos en cada fichero. Elige el umbral y justifícalo en el `-done`
(el N1 mide 360; la tablet más estrecha que tenemos, más de 1000).

Prueba de la restricción: capturas **antes/después** del mapa, la venta con familia elegida y la
comanda abierta a **1280×800** y **1442×811** en el bucle visual, con su diff. Si el diff no es
cero, se explica uno a uno o se corrige.

## Alcance

### 1 · El mapa de mesas a 360 (hallazgo 1, 🔴)

Causa probable, **a confirmar midiendo**: la cabecera es una sola fila sin salto (menú, título a
28 px, `ZoneChips`, «Tickets», cajero y «Venta rápida», casi todo `shrink-0`). Mide ~845 px y
arrastra el viewport de maquetación a 845×1690 **sólo en esta pantalla**. Con 845 de ancho, las
mesas de 144 px y el `flex-wrap` se reparten mal, y el resto ya se descoloca.

Lo que tiene que quedar, medido en navegador a 360×720 con los datos de Sirope:

- `innerWidth` = **360** en el mapa, igual que en el resto del TPV. Nada más ancho que la ventana.
- **Las cuatro zonas alcanzables** (Todas, Barra, Salón, Terraza): o caben, o van en una fila que
  desplaza en horizontal **ella sola**, sin mover la página.
- «Venta rápida», «Tickets pasados», «Bloquear» y el menú siguen a mano, con **44 px** como mínimo.
  La cabecera en estrecho puede ir en dos filas; decide tú el reparto.
- **Mesas a tamaño de mano**: el objetivo es **tres por fila** a 360 (328 px útiles). Las
  constantes viven en `roomGrid.ts`, junto a las de ahora, y las funciones puras
  (`roomColumnsFor`, etc.) devuelven 3 a 360 y lo de siempre a 1280. Hay que seguir distinguiendo de
  un vistazo **libre / ocupada / cuenta / olvidada (>45 min)**, el número de mesa y su importe, y
  **el cobro desde la tarjeta** (estado cuenta) sigue existiendo con su objetivo de 44 px. Si en
  la forma pequeña no cabe todo, decide qué se va (y si «Cobrar» se mueve a un toque largo o a la
  ficha) y anótalo como decisión.
- Con «Todas» y las 23 mesas de Sirope, **al menos 9 a la vista sin desplazar**. Con el chip de
  una zona, **toda esa zona** de Sirope en la primera pantalla.
- La Barra mantiene el mostrador dibujado, pero compacto.

### 2 · Búsqueda y productos bajo el pliegue (hallazgos 2 y 7, 🟡)

Es el mismo problema: la rejilla de familias no cede el sitio. Decisión tomada:

- **Mientras hay texto en el buscador, la rejilla de familias no se pinta** en estrecho. Los
  resultados van justo debajo del buscador. Con «tost» y el teclado abierto (360×449), **el primer
  resultado se ve entero por encima del teclado** y, si es posible, tres.
- **Con una familia elegida, las familias se pliegan** a una tira: la familia elegida, bien marcada,
  y un toque para volver a abrir la rejilla («Cambiar familia» o similar, de 44 px). **El primer
  producto queda a la vista sin desplazar** y por encima de la barra del ticket.
- Al borrar la búsqueda o quitar la familia, todo vuelve a como está hoy.
- No toques el rótulo de familia ni el «Más»: ya los arregló `n1-vertical`.

### 3 · La comanda en estrecho (hallazgos 3, 9 y 8, 🟡)

- **El nombre del producto se lee entero.** Reparte la línea en estrecho: el nombre en su renglón
  (hasta dos líneas, sin cortar a mitad de palabra) y la cantidad, el precio y los chips («→ Silla
  N», «Espera») en el de abajo. Con «Café Americano» y «Café Solo» en la misma comanda se tienen que
  distinguir sin abrir nada.
- **Ningún control queda tapado por la fila fija de «⚡ Urgente / ⚠ Alergias»**. Con seis líneas
  en la comanda, `elementFromPoint` sobre el centro del «Espera» **de la última** devuelve el propio
  «Espera». La lista reserva por abajo lo que mide esa fila.
- **La hoja de la comanda se cierra al salir de la venta** («Tickets pasados», ficha de un ticket,
  menú, mapa) y al volver no está. No vuelve a bloquear toques de la búsqueda ni de las familias.

## Fuera de alcance (no se toca aunque se vea)

- **Cambio a devolver más visible** (4): decisión de producto que afecta también al D8 →
  auditoría de Sirope.
- **Fechas en la hora de la tienda** (5): bloque propio.
- Objetivos táctiles de 32–36 px sueltos (11), filtros de Tickets (12), «Reenviar por email» en un
  ticket de PRUEBA (13) y el aviso de devolución en ensayo (14).
- La impresora integrada IPOS del N1 y el «process is bad» del WebView del N1 (app en blanco desde la
  2.ª apertura tras reiniciar). Si en la pasada aparece, es el aparato: se reabre la app como en la
  pasada del 18-10 y se anota; **no se diagnostica aquí**.
- La orientación, el PIN, el cajón y la barra del ticket: son de `n1-vertical` y funcionan.

## Verificación

Los bancos jsdom no miden maquetación (`n1-vertical-done` §4.2). Así que va en dos partes:

1. **Bancos** para todo lo que es lógica: la aritmética del mapa (columnas y alto a 360 y a 1280),
   el umbral único, «buscando → sin familias», «familia elegida → plegada», «salir de la venta →
   hoja cerrada».
2. **Medida real** en navegador contra la stack del banco, sembrada **como Sirope**: 23 mesas en
   Barra/Salón/Terraza y 13 familias con los nombres reales (incluidos «Croissantysandwich» y
   «Suplemento»). A **360×720**, **360×449** (teclado) y **1280×800 / 1442×811** (la restricción).
   Tabla de números en el `-done`, en el mismo formato que la pasada: `innerWidth`, mesas visibles,
   alto total, `y` del primer resultado y del primer producto, `elementFromPoint` del «Espera».

### Sabotajes

Cada fila: se rompe el código, se ve el rojo, el mensaje real va al `-done` y se restaura. Si algo
sólo se puede ver en el navegador, el sabotaje se mide en el navegador y se dice.

| Sabotaje | Debe caer |
|---|---|
| La mesa en estrecho vuelve a 144 px | columnas a 360 ≠ 3 |
| El umbral de estrecho se aplica a 1280 | el banco del AP11 (tamaño y columnas de siempre) |
| La cabecera del mapa vuelve a `shrink-0` sin salto | `innerWidth` 360 en el mapa (navegador) |
| Con texto en el buscador se pintan las familias | el banco de búsqueda |
| Con familia elegida no se pliega la rejilla | el banco de familia elegida |
| La lista de la comanda sin la reserva inferior | «Espera» de la última línea tapado (navegador) |
| La hoja de la comanda no se cierra al ir a Tickets | el banco de navegación |

### La pasada en el hierro (criterio de cierre)

- **N1** vinculado a **Sirope · Caja 1** (en ensayo), cajero `soporte+sirope@mipiace.es`, por adb
  inalámbrico (192.168.5.143; **el puerto cambia en cada reinicio** y la depuración se corta si se
  bloquea la pantalla). Medida con DevTools sobre el WebView, como el 18-10: mapa → filtro Terraza →
  mesa de terraza → búsqueda con teclado → familia → 3–6 líneas con dos cafés distintos → comanda
  revisada → **enviada a cocina y vista en el AP11** → «Tickets pasados» y volver (hoja cerrada) →
  cobro en efectivo. Capturas numeradas en `docs/qa/2026-10-XX-n1-hosteleria/`.
- **D8 y AP11**: la venta y el mapa del D8 y la cocina del AP11, iguales que antes. Capturas antes y
  después, lado a lado.
- **Todo en ensayo**: no se cierra turno ni se toca «Cerrar el día». Apunta los números de ticket
  `TEST` creados; los borra Matías con «Resetear ensayo».

## Entregables

- Rama `n1-hosteleria`, commits pequeños en español.
- APK **1.28.0** con `build-release-apk.sh` (árbol limpio, `ANDROID_HOME` del Mac), **sin publicar**:
  mientras el «process is bad» del N1 siga abierto, la publicación la decide Matías.
- `docs/blocks/n1-hosteleria-done.md` con la estructura de siempre: lo que hay ahora, **las
  decisiones tomadas sin preguntar una a una** (umbral, reparto de la cabecera, qué se fue de la mesa
  pequeña, cómo se pliega la familia), la tabla de medidas, los sabotajes con su rojo, las capturas
  del N1 y del antes/después del D8 y el AP11, y lo que quede pendiente con su captura.
- **El push y el PR los hace Matías**: deja al final el comando completo, con el `cd` incluido y
  todo encadenado.
