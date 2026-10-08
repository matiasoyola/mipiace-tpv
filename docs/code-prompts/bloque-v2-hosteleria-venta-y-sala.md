# Bloque v2-H1 · la venta y la sala de hostelería, para usarlas con prisa

## Por qué existe este bloque

El 07-10-2026 Matías aplazó la implantación de La Maestranza después de verla en el D8 (AP13):
«veo poca usabilidad en todo, muy poca, tienes que poner demasiada atención para marcar las cosas».
«Lo tiene que leer un humano, a toda velocidad y en pleno estrés, y la única distinción es una pequeña
línea de color, con el texto diminuto». **Sirope y La Maestranza esperan a este bloque.** El listón no
es «mejor que antes»: es mejor que Toast, que Matías tiene como referencia de «limpio y claro».

## Leer antes

- `docs/mockups/v2-hosteleria/venta-oscuro.dc.html` y `mesas-oscuro.dc.html` — **la referencia
  visual revisada con Matías**. Son maquetas (HTML con una plantilla `{{…}}` y datos en
  `renderVals()`), no código a copiar: léelas como especificación de layout, tamaños, colores y
  jerarquía. Tamaño de referencia 1443 × 812 (viewport CSS del D8).
- Proyecto: `principio-venta-bajo-estres` (copiado en `docs/design/principio-venta-bajo-estres.md`).
- `docs/design/tokens.md`, `docs/ux-principles.md`, skills `sistema-visual-mipiace` y
  `metodologia-front-mipiace`.
- `docs/blocks/v1-22-el-terminal-del-bar-done.md` y `docs/blocks/v1-23-las-mesas-miden-lo-mismo-done.md`
  (lo último que se tocó en estas pantallas; no deshacerlo).
- Principio de producto: en un bar el cobro empieza siempre en las mesas.

## Decisiones ya tomadas (no reabrir)

1. **Tema oscuro para la venta y la sala de HOSTELERÍA.** Fondo casi negro, superficies carbón,
   texto claro. Coral (`#E97058`) solo para «Cobrar», la familia/vista activa especial y estados de
   mesa ocupada. DM Sans, pesos 400/500/600. El resto del TPV (login, turno, cierre, tickets) y los
   negocios RETAIL y SERVICES **no cambian** en este bloque. El tema sale de tokens (`tokens.md`
   gana una sección «oscuro · hostelería»), nunca de hex sueltos.
2. **Escala de texto TPV**, por encima de la escala general del sistema visual (justificación: uso con
   prisa, a un brazo de distancia). Nombre de producto ≥ 23 px, línea de comanda 20–22 px, total ≥ 44
   px, botón Cobrar ≥ 22 px, nombre de mesa ≥ 26 px, importe de mesa ≥ 19 px. Va a `tokens.md` como
   escala TPV con su justificación.
3. **Familia primero, producto después.** Barra de familias arriba: botones de 76 px de alto, nombre a
   21 px, cada uno relleno del color de su familia; la activa se marca con un aro. Al tocar una, el
   centro muestra SOLO esa familia, botones planos con el color de la familia en todo el botón y texto
   blanco. Sin vista «Todos».
3b. **Nunca paginación** (Matías: «olvídate de paginación, eso nunca»). Una familia se ve ENTERA en una
   pantalla: nada de páginas, flechas, «Más (N)» ni desplazamiento dentro de la cuadrícula. La
   cuadrícula se adapta al número de productos (4×5 hasta 20; más columnas y filas a partir de ahí),
   con un mínimo de 64 px de alto y nombre ≥ 20 px por botón. Caso real a medir: Licores de La
   Maestranza (31 productos) en 1443×812. Si una familia no cabe con ese mínimo, el bloque lo dice en
   el `-done` con su número, no lo resuelve partiendo la familia en páginas.
3c. **Cantidad antes del producto**: fila «Cantidad 1–6» **entre la barra de familias y la cuadrícula**
   de productos (Matías); tocar «3» y luego «Café» añade 3; vuelve a 1 tras cada producto.
3d. **−/+ grandes en cada línea «Sin enviar»** (Matías: «editar las cantidades sobre la lista de
   seleccionados… con un − y + grande para un pulso de dedo»): botones de 56×56 a los lados de la
   cantidad, un toque = una unidad; «−» con 1 unidad quita la línea. Las líneas «En cocina» no llevan
   −/+ (quitar algo ya enviado sigue siendo la anulación que existe hoy). La comanda pasa a 420 px de
   ancho para que quepan sin recortar el importe; el nombre se recorta con ellipsis, el importe nunca.
4. **«Ahora» es la primera pestaña y la que abre por defecto**: los productos más pedidos en ese
   comercio en esta franja horaria (ver §3). Es la única vista que se reordena sola.
5. **Comanda a la izquierda**, partida en «En cocina · hh:mm» (líneas ya enviadas, atenuadas) y
   «Sin enviar» (destacadas). La última línea añadida queda marcada.
6. **Cantidad dentro del botón** del producto («×2») mientras esté en la comanda sin enviar o enviada
   de esta mesa.
7. **Sin «Quitar la última»** (Matías: «quítalo, me sobra»): lo cubren los − de cada línea «Sin enviar». Si hoy existe un botón equivalente en la venta de hostelería, desaparece.
8. **Sala**: mesas como formas (barra = taburetes redondos sobre una franja de barra; salón = mesas
   rectangulares; terraza = redondas, según el tipo de zona que ya exista o, si no existe, por el
   nombre de zona Barra/Terraza y rectangular el resto). Libre = solo contorno; ocupada = relleno coral
   con importe grande y minutos; pide la cuenta = ámbar; +45 min sin atender = aro ámbar. **Barra la
   primera.** Cabecera «N abiertas · X €», filtros por zona, «Venta rápida».

## Alcance

### 1 · Venta (SalePage) en hostelería
Las decisiones 1–7 (incluidas 3b, 3c y 3d). Todo lo que hoy existe en la pantalla (salvo lo que quita la decisión 7) (modificadores, línea con sheet, mover,
dividir, enviar, cobrar, más acciones) sigue existiendo y llegando con el mismo número de toques o
menos. Los colores de familia salen de la categoría; si una categoría no tiene color, se asigna de una
paleta fija de 9 tonos del token, estable por categoría (mismo color siempre para la misma).

### 2 · Sala (TableMapScreen) en hostelería
La decisión 8, sin editor de posiciones: las formas se colocan por zona con el layout que mida v1.23
(mismo tamaño de mesa en todas las zonas, toda la sala sin scroll en La Maestranza y Sirope a
1443×812 y 1280×800). No toques el cálculo de cabecera que reutiliza el aviso de mesas abiertas.

### 3 · «Ahora» — endpoint de solo lectura
`GET /tpv/catalog/now` (o el nombre que encaje con las rutas que ya hay): los 20 productos más
vendidos del comercio en la franja horaria actual (±1 h) de los últimos 28 días; si hay menos de 20
con ventas, se completa con los primeros de cada familia en su orden. Sin migraciones. Cacheable por
el front unos minutos; offline (v1.10, un terminal) usa la última respuesta guardada y, si no hay,
cae al orden de familias. Un comercio nuevo sin ventas ve «Ahora» = primeros de cada familia.

## Restricciones

- **RETAIL y SERVICES no cambian.** Thalía, Cachictos y Sole usan la misma SalePage. Test que lo
  demuestre (render de las dos variantes).
- Sin cambios de esquema. «Nombre corto de botón» y «posición fija del producto dentro de su familia»
  quedan para v2-H2 (llevan migración y editor en el panel): en este bloque, el botón usa el nombre
  actual con un máximo de 2 líneas y ellipsis, y el orden de la familia es el orden actual del catálogo.
- Táctil: ningún objetivo < 56 px en tablet; Cobrar 68 px.
- Sin animaciones salvo el feedback de pulsado del sistema visual (`scale(0.97)`, 120 ms).
- WebView 101 del D8: nada que necesite más (lo midió v1.22).
- No regresar nada de v1.22 (teclado del sistema, CashPad, aviso de mesas en el cierre) ni de v1.23.

## Verificación

Criterio de cierre (de `principio-venta-bajo-estres`, §7): **medido en el hierro**, no en jsdom.
Con Playwright a 1443×812 sobre la cuenta de pruebas, antes y después, y escrito en el `-done`:
- Toques y tiempo para una comanda típica: 2 cafés con leche + 1 tostada de tomate + 2 cañas, enviar.
- Toques para cobrarla en efectivo.
- Productos visibles sin desplazar en «Ahora» y en una familia.
- Tamaño en px del nombre de producto, de la línea de comanda y del importe de mesa.

| Sabotaje | Debe caer |
|---|---|
| Volver a la vista «Todos» por defecto | test de que la vista inicial en hostelería es «Ahora» |
| Paginar una familia de 31 productos | test de que los 31 botones están en el DOM y dentro del viewport sin scroll |
| La cantidad no vuelve a 1 | test: «3» + Café + Caña → 3 cafés y 1 caña |
| «−» que deje una línea a 0 | test: 1 caña + «−» → la línea desaparece |
| −/+ en una línea ya enviada | test de que «En cocina» no renderiza −/+ |
| Botón −/+ de menos de 56 px | test de tamaño (computed style) |
| Pintar el color de familia solo en un borde | test de que el fondo del botón es el color de su familia |
| Bajar el nombre de producto a 17 px | test de la escala TPV (computed style) |
| Quitar la cantidad del botón | test de «×2» tras añadir dos |
| «−» que borre la línea entera en vez de una unidad | test con 2 cañas + «−» → 1 caña |
| Aplicar el tema oscuro a RETAIL | test de render RETAIL con el tema claro |
| «Ahora» sin ventas devuelve vacío | test de API: comercio sin tickets → 20 productos |
| Barra no primera en la sala | test de orden de zonas |

**Bucle visual**: capturas a 1443×812 y 1280×800 de venta («Ahora», Cervezas, con comanda enviada y sin
enviar) y sala (La Maestranza y Sirope, libres/ocupadas/cuenta/+45), y handheld 390 px; compáralas con
las maquetas y anota cada diferencia en el `-done` (hecha a propósito o pendiente).

## Entregables

- Rama `v2-h1-venta-y-sala` desde `master`, commits pequeños en español, push y PR contra `master`.
  Ni merge ni despliegue ni APK.
- `docs/blocks/v2-h1-venta-y-sala-done.md`: estructura de la metodología, decisiones tomadas sin
  preguntar una a una, medidas antes/después, tabla de sabotajes con el mensaje real de cada rojo.

## Fuera de alcance (explícito)

- Nombre corto de botón, posición fija editable, editor de sala con posiciones libres → v2-H2.
- RETAIL y SERVICES, panel del propietario, super-admin, «Empezar de cero».
- C11 («Cancelar» fuera del modal en «Cerrar el día») — anótalo si lo ves, no lo arregles aquí.
