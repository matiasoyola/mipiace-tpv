# AP13 (Kozen D8) · cuatro fallos de usabilidad vistos de un vistazo · 2026-10-06

Detectados por Matías al primer uso; medidos por Claude con CDP sobre el WebView del terminal
(`adb connect 192.168.5.136:5555`, `webview_devtools_remote_*`). APK 1.21.0, WebView 101.0.4951.61,
1920×1080 a densidad 213 → viewport **1443×812**, DPR 1,33. Tenant La Maestranza, mesa M4 abierta
(sólo lectura: no se cobró ni se tocó nada).

Capturas: `2026-10-06-ap13-usabilidad/00-estado.png` (con teclado) y `01-venta-sin-teclado.png`.

## 1 · El teclado se abre con cualquier toque — causa raíz encontrada

- Con el teclado fuera, el viewport baja de **812 a 368 px (−55 %)**: se ve la cabecera, una fila de
  productos y el botón Cobrar; las líneas del ticket desaparecen.
- El elemento con foco es el `<input type="search">` del buscador **plegado**, fuera de cuadro
  (`x = −9834`). Se mantiene enfocable a propósito para el lector USB-HID.
- `SalePage.tsx` ~l.1129: el refoco permanente del buscador se salta en táctil con
  `matchMedia("(pointer: coarse)")`. **En el D8 eso da `false`**: el WebView 101 reporta
  `pointer: fine`, `any-pointer: coarse = false`, `hover: none`, `maxTouchPoints = 5`, aunque la
  pantalla es una goodix táctil (`INPUT_PROP_DIRECT`). Resultado: cada clic re-enfoca el buscador
  oculto y Android saca el IME.
- No es exclusivo del D8: cualquier terminal cuyo WebView mienta sobre `pointer` lo sufre.

Arreglo propuesto (dos capas, las dos):
1. Mientras el buscador está plegado, `inputMode="none"`: el lector HID sigue escribiendo y el SO no
   saca el teclado. Al desplegarlo vuelve a `search`.
2. Detección de táctil robusta: táctil si `pointer: coarse` **o** `any-pointer: coarse` **o**
   (`maxTouchPoints > 0` y `hover: none`).

## 2 · Nombres de producto pequeños

Nombre en la tarjeta: **13,5 px peso 500** (≈18 px físicos). Tarjetas de 250×135 CSS px con el nombre
arriba, precio abajo y ~60 % de la tarjeta vacía. El nombre es lo que el camarero busca con la vista:
debe ser lo más grande de la tarjeta. En el D8 además el lienzo es 1443 de ancho (no los 1280 de
diseño), así que todo sale ~11 % más pequeño que en el AP11.

## 3 · La línea del ticket no enseña el producto

Panel del ticket de 360 px. En la línea, stepper de cantidad 116 px + importe + papelera dejan **86 px
al nombre**, en una línea con `ellipsis`: «Hamburguesa normal» se lee «Hamburgu…». En las tarjetas el
mismo nombre usa `line-clamp: 2`; en el ticket no. El nombre tiene que poder ir a dos líneas y el
stepper no puede comerse un tercio de la fila.

## 4 · Categorías escondidas en «Más (4)»

10 categorías; se ven 6 chips y 4 quedan tras un desplegable, con hueco libre a la derecha de la fila y
**media pantalla de rejilla vacía** debajo (8 productos en la categoría). Esconder categorías en un bar
obliga a dos toques y a recordar qué hay dentro. Con 10 categorías caben en dos filas de chips o en
una columna lateral.

## Lo que esto dice del método

La auditoría por procesos del 02-09 se hizo en el AP11 a 1280×800, y el bucle visual de los bloques
captura en navegador de escritorio. Ninguno de los dos habría visto el fallo 1, que depende de lo que
el WebView de cada fabricante dice de sí mismo. **Cada modelo de terminal nuevo necesita su pasada en
el hierro antes de ir a un cliente.**
