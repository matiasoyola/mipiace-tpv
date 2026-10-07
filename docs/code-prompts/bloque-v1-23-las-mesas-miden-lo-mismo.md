# Bloque v1.23 · las mesas miden lo mismo

## Contexto (leer antes)

- `docs/qa/2026-10-06-auditoria-ap13.md` y la captura `docs/qa/2026-10-06-ap13-usabilidad/r4-08-cobrado.png`
  (el mapa de La Maestranza en el AP13).
- `docs/qa/2026-09-02-auditoria-por-procesos.md` → **E1** (mapa de sala, AP11).
- `docs/mockups/mapa-sala-visual.html` — el mockup de v1.9.3 del que sale el layout actual.
- `docs/ux-principles.md`, `docs/design/tokens.md`, skills `sistema-visual-mipiace` y `metodologia-front-mipiace`.
- Principio de producto de Matías: **en un bar el cobro empieza siempre en las mesas**. El mapa es la
  primera pantalla del camarero.

## El problema, en una frase

**La misma mesa de 4 personas mide 508 × 118 px en Salón, 124 × 118 en Terraza y es un círculo de 84 px
en Barra.** El tamaño no lo decide ni el número de mesas ni su uso: lo decide un ancho fijo por zona.

## Lo ya localizado (verificado el 2026-10-06 · no volver a investigarlo)

- `apps/tpv-web/src/pages/TableMapScreen.tsx` ~556-590, vista «Todas»: «lienzo espacial» con
  `lg:grid-cols-[minmax(0,1fr)_300px]`. **Salón se lleva todo el ancho sobrante; Terraza y Reservados
  van en una columna fija de 300 px**; Barra a lo ancho abajo.
- `RoomGrid` (~877): `grid grid-cols-2` para **todas** las zonas. Dos columnas en 1050 px y dos en
  300 px: de ahí el ×4 de ancho.
- `TableCard` (~990): `min-h-[118px]`, ancho = el de la columna. `BarZone` (~1104) pinta taburetes de
  `w-[84px] h-[84px] rounded-full` (~1182).
- La vista filtrada por zona (~547) ya mete todo en un `RoomGrid` de 2 columnas: mismo problema, otra forma.
- Medido en el AP13 (1443 × 812): Salón 6 mesas a 508 × 118, Terraza 6 a 124 × 118, Barra 4 taburetes
  de 84 × 84. Media pantalla de Salón son tarjetas casi vacías.

## Alcance

### 1 · Una mesa mide lo mismo esté en la zona que esté

- **Mismo tamaño de tarjeta para toda mesa**, en todas las zonas y en las dos vistas (Todas y filtrada).
  Los taburetes de Barra pueden conservar la identidad visual de la barra (la franja), pero su
  objetivo táctil y su área no pueden ser menores que los de una mesa.
- **Cada zona ocupa el sitio que piden sus mesas**, no un ancho fijado de antemano: las zonas fluyen y
  el número de columnas sale del ancho disponible y del tamaño de tarjeta, no de `grid-cols-2`.
- El tamaño de tarjeta sale de un único sitio (token o constante compartida), no de clases sueltas.
- La tarjeta sigue enseñando lo de hoy (nombre, PAX, minutos, cajero, importe, estados de color) sin
  recortar el importe.

### 2 · Toda la sala se ve sin desplazar en el caso real

- **Criterio**: La Maestranza (6 Salón + 6 Terraza + 4 Barra) y Sirope caben enteras **sin scroll** a
  1443 × 812 y a 1280 × 800. Si con un número grande de mesas no caben, el scroll es vertical y la
  Barra no queda la última fuera de pantalla (E1: en el AP11 «BARRA» empezaba en y = 841 de 800).
- Mide y escribe en el `-done` el tamaño de tarjeta resultante y el rect de cada zona en los dos tamaños.

## Restricciones

- Escala táctil y radios de `tokens.md`. Tarjeta ≥ 64 px de alto y de ancho como mínimo.
- Sin cambios en datos, endpoints ni en la lógica de estados, agrupación (`groupedIntoTableId`) o bloqueo.
- **No toques el cálculo de la cabecera** «N abiertas · M libres · X € en sala» (~270-285): el bloque
  **v1.22**, en curso en otra rama, lo reutiliza para el aviso de mesas abiertas del cierre. Si te
  hace falta moverlo, no lo hagas: anótalo en dudas abiertas.
- Handheld sigue apilando en una columna.

## Verificación

| Sabotaje | Debe caer |
|---|---|
| Volver a `lg:grid-cols-[minmax(0,1fr)_300px]` | test de que una mesa de Salón y una de Terraza tienen el mismo ancho y alto |
| Volver `RoomGrid` a `grid-cols-2` fijo | test de que con 6 mesas en 1443 px la zona usa más de 2 columnas |
| Volver los taburetes a 84 × 84 | test de que el área de un taburete ≥ la de una mesa |
| Romper el tamaño compartido (una zona con su propia clase) | test que compara rects de todas las mesas del mapa |

Con jsdom no hay layout: los tests de rects van con Playwright. Declara qué no cubre la suite.

**Bucle visual**: Playwright a 1443 × 812 y 1280 × 800 con la sala de La Maestranza y la de Sirope,
vista Todas y vista filtrada por zona, mesas libres y ocupadas; y handheld 390 px.

## Entregables

- Rama `v1-23-las-mesas-miden-lo-mismo` desde `master`, commits pequeños en español, push y **PR contra
  `master`**. Ni merges ni despliegues.
- `docs/blocks/v1-23-las-mesas-miden-lo-mismo-done.md` con la estructura de la metodología, decisiones
  tomadas sin preguntar una a una, medidas antes/después y la tabla de sabotajes con el mensaje real de
  cada test rojo.

## Fuera de alcance (explícito)

- Todo lo del v1.22 (teclado, CashPad, nombres, rail de categorías, aviso de mesas en el cierre).
- Editor de sala, posiciones libres o arrastrar mesas: no existe y no se crea.
- Cambiar zonas, PAX o nombres de mesas.
- La pantalla de venta.
