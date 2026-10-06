# Bucle visual · clinica-3 · la sesión y el mapa del pie

Capturas del **07-10-2026**, contra la stack de verdad (API + Postgres + la
PWA del TPV) y sobre la clínica del banco (`seed/clinica-demo.ts`), con
Carmen y su valoración ya validada. No son maquetas: es la pantalla.

Los tres anchos del bucle: **1024 px apaisado** (el iPad, que es el que
manda), **390** y **320**.

| Fichero | Qué se mira |
| ------- | ----------- |
| `sesion-vacia-*` | La pantalla al abrirse: fichas con título, la franja roja, las dos pestañas y el mapa con lo de la visita anterior en naranja suave. |
| `sesion-gravedad-desactivada-*` | Tocada una zona y **sin lesión elegida**: los tres chips de gravedad apagados y «elige antes la lesión» al lado. |
| `sesion-con-marcas-*` | Con la lesión, su gravedad, dos tratamientos, el dolor, la evolución, el consejo y la próxima cita. El pie de la sesión con su total. |
| `exploracion-*` | La otra pestaña: el mismo mapa con otro significado (los puntos donde NO siente el filamento), los pulsos y el tipo de pie. |
| `cerrada-duena-*` | **Sesión cerrada, variante DUEÑA**: «Pasa a caja», las líneas con importe, el total con su IVA y «Cobrar ahora». |
| `cerrada-sanitario-*` | **Sesión cerrada, variante SANITARIO SIN CAJA**: «Enviada a recepción para cobrar», las líneas con ✓ y **ni un importe**. |
| `sesion-sin-importes-*` | La misma pantalla de sesión vista por la sanitaria sin caja: ni total, ni IVA, y el botón dice «Cerrar sesión». |
| `cobros-pendientes-1024` | La lista de la recepción: la cita, el paciente y las líneas con precio. Y nada de la historia. |
| `medidas-del-mapa.json` | **Los objetivos táctiles medidos sobre la página**, zona por zona y a los tres anchos. |

## Los objetivos táctiles del mapa, medidos

El prompt pide «ninguna zona táctil por debajo de 44 px, y se mide en la
captura, no en el CSS». Se mide, y además se mide contra el mínimo de la
casa, que es **48** (`docs/design/tokens.md` §4):

| Ancho | Pestaña | Zona más pequeña |
| ----- | ------- | ---------------- |
| 1024 | sesión y exploración | **48,4 px** |
| 390 | sesión y exploración | **48,4 px** |
| 320 | sesión | **48,0 px** |
| 320 | exploración | **48,4 px** |

Las 22 zonas (once por pie) pasan en los tres anchos. La más justa es
siempre el **2.º dedo**, que es la de radio mínimo.

## Lo que el bucle encontró, y que ningún test veía

Cuatro cosas, y las cuatro son de píxeles — ninguna suite las mira.

### 1 · La barra de cobro de la venta se pintaba ENCIMA de la sesión

A 390 y a 320, la hoja de la sesión salía con la barra «0 líneas · 0,00 €»
de la pantalla de venta tapándole el pie — justo donde está el botón de
cerrar.

`AgendaPage` es un `fixed inset-0 z-40`, y un z-index sobre un elemento
posicionado **crea un contexto de apilado**: la hoja clínica pedía `z-50` y
ese 50 sólo valía dentro del peldaño 40. La barra inferior de `SalePage`
(`lg:hidden`, de v1.0-handheld) también está en `z-40`, pero más abajo en el
DOM: empata y gana ella.

**No era sólo de este bloque**: la hoja de la valoración de clinica-2 tenía
el mismo problema desde que nació. Se arregla sacando las tres hojas del
contexto con un portal a `document.body` (`AlFrente` en `AgendaPage.tsx`),
que cambia SÓLO esas tres y no el apilado de una agenda que usan quince
clientes.

### 2 · A 1024 los dos pies no cabían en una fila

El mockup los pone al lado. La rejilla estaba en `xl:` (1280), así que a
1024 —el iPad, que es el que manda— salía en una columna y sólo se veía el
pie izquierdo. Y aun pasándola a `lg:`, con 520 px de columna los dos pies
de 264 se partían en dos filas.

La cuenta es: 264 + 8 de hueco + 264 + 20+20 de tarjeta = **576**. La
columna pasa a `minmax(0,584px)`.

### 3 · A 320, la zona más pequeña se quedaba en 45,1 px

Pasaba el 44 del prompt y **no** el 48 de la casa. La cuenta que fallaba: a
320 px de pantalla, con 16 de página y 20 de tarjeta a cada lado quedan 248
para un pie que es de 264. Con `px-3` en la tarjeta (12 a cada lado) quedan
exactamente 264.

Esto lo cazó la MEDICIÓN y no el test del mapa: el test calcula sobre el
ancho nominal, y el ancho nominal estaba bien.

### 4 · Las once teclas del dolor se quedaban en 30 px de ancho

Con `grid-cols-11`, cada tecla mide la columna partida en once. En el panel
estrecho de 1024 salían de 30 px — menos que en un móvil de 320. Pasan a
`flex-wrap` con `min-w-touch`: ninguna baja del peldaño y la fila se parte
en dos cuando no caben.

## Lo que SÍ estaba bien y conviene que quede dicho

- **La franja roja se lee.** Rojo pleno, «Cuidado» con su icono, y las
  alertas en cajas blancas a 16 px. A 320 envuelve en tres líneas y sigue
  siendo lo primero que se ve.
- **Ni un euro en la pantalla de la sanitaria sin caja**, ni en la sesión ni
  al cerrar. Se ve en `sesion-sin-importes-*` y `cerrada-sanitario-*`.
- **Nunca dice «exento»**: el total lleva «IVA 0 %», que es lo que dice el
  catálogo. El IVA exento en Verifactu es un bloque aparte y `registro.ts`
  sigue declarando S1.
- **Sin scroll horizontal** a 320 en ninguna de las pantallas.

## Cómo se repiten

El script del bucle vive en el scratchpad de la sesión, no en el repo (es
una herramienta de una tarde). Con la stack del banco levantada:

```bash
pnpm --filter @mipiacetpv/e2e-ui run stack     # siembra la clínica
# ... y el script de capturas contra TPV_URL, con DATABASE_URL del banco
```

Lo que sí está en el repo y vigila lo mismo todos los días es
`apps/tpv-web/test/clinica-sesion-pantalla.test.tsx`, que mide las 22 zonas
sobre la geometría que el DOM lleva puesta.
