# Bloque n1-vertical · que la app se pueda usar en un TPV portátil tipo móvil

## Por qué existe este bloque

La pasada del 16-10 en el N1 (`docs/qa/2026-10-16-pasada-n1-movil.md`, capturas en `docs/qa/2026-10-16-n1/`)
lo deja claro: la APK está fijada en horizontal (`android:screenOrientation="sensorLandscape"`) y en un
aparato de 720×1440 eso da un **viewport de 720×360 CSS px**. Con esa altura, la hoja del ticket deja
24 px para las líneas, el cobro deja una franja de 70 px y la búsqueda con el teclado abierto no enseña
ni un resultado. Emulado en vertical (360×640), la hoja del ticket mide 390 px y las líneas caben enteras.

¿Y qué? Un TPV portátil (camarero que cobra en la mesa, peluquera que cobra en el sillón, repartidor) es
un aparato que hoy no podemos vender. Con este bloque, el N1 vende en vertical y los terminales de 10"
(AP11, AP12, AP13, D8) siguen exactamente igual.

## Leer antes

1. `docs/qa/2026-10-16-pasada-n1-movil.md` entero, sobre todo los puntos 1, 4, 5, 7 y 8.
2. `apps/tpv-android/android/app/src/main/java/es/mipiace/tpv/MainActivity.java`: el rescate de A4 va
   **primero** en `onCreate` y no se toca su orden.
3. `apps/tpv-android/android/app/src/main/AndroidManifest.xml`, la actividad principal.
4. `reference_dos_sesiones_mismo_terminal` y el incidente A5 del 04-09: **nada de laboratorio en la APK
   de un cliente**.
5. `principio-venta-bajo-estres` (proyecto): la pantalla de venta la usa alguien con prisa; cada toque cuenta.

## Base de rama

Rama `n1-vertical` **desde `master`**. PR contra `master`.

## Decisiones ya tomadas (no reabrir)

- **El criterio es el tamaño del aparato, no la marca ni el modelo.** `smallestScreenWidthDp < 600`
  → móvil → **vertical** (`SCREEN_ORIENTATION_SENSOR_PORTRAIT`). Con 600 o más → tablet → **horizontal**
  (`SCREEN_ORIENTATION_SENSOR_LANDSCAPE`, lo de hoy).
- **Una sola fuente de verdad**: se quita `android:screenOrientation` del manifiesto y la orientación se
  fija en código, en `onCreate`, **después** del rescate de A4 y **antes** de `super.onCreate`.
- **Si la decisión falla** (excepción, configuración rara), se cae a horizontal: lo conocido.
- **El horizontal en móvil no se arregla en este bloque**: con la app fija en vertical, no se da.

## Alcance

### 1 · Orientación por tamaño

- Una función pura (`OrientacionPorTamano` o similar) que, dado `smallestScreenWidthDp`, devuelve la
  orientación. Es la que se prueba.
- `MainActivity` la llama y aplica `setRequestedOrientation`.
- `configChanges` se queda como está: el WebView no se recrea al girar.

### 2 · La barra flotante del ticket, solo donde tiene sentido

La barra (`lg:hidden fixed inset-x-0 …` en `SalePage.tsx`) hoy sale también en la Agenda y tapa el botón
«Reservar» de «Nueva cita» (captura `22-nueva-cita`).

- Solo se ve en la pantalla de venta.
- **Mientras el teclado del sistema está abierto**, se oculta (captura `27-busqueda-teclado`: con
  teclado, la barra ocupa el único hueco de resultados). Detectarlo con `visualViewport`, que sí funciona
  en el WebView.

### 3 · El menú lateral hace scroll

El cajón (`w-[280px] … flex flex-col`) no desplaza y deja «Declaración responsable» fuera de pantalla
(capturas `23-menu`, `24-menu-scroll`). Su lista tiene que desplazarse sola, sin mover la página de detrás.

### 4 · La pantalla de PIN cabe

En 360×640 y en 720×360, el teclado de PIN y el botón «Entrar» tienen que verse sin desplazar, y **el
aviso de PIN incorrecto tiene que verse** donde el cajero está mirando (en la pasada no se veía).

### 5 · Repaso en vertical de las pantallas de la pasada

Con la APK ya en vertical, pasar por venta, hoja del ticket, cobro, Agenda y «Nueva cita», menú,
«Cerrar el día» y Tickets a **360×640**. Lo que no quepa o se salga por la derecha (en la emulación,
el chip «Más (8)» ya se salía) se arregla aquí **si es de una línea**. Si es más, va al `-done` como
pendiente, con su captura.

## Restricciones

- **Los terminales de 10" no cambian.** El AP11 tiene que verse **idéntico** a antes: misma orientación
  y mismo layout `lg`.
- No tocar el rescate de A4 ni el orden de registro de plugins.
- Nada de laboratorio en la build de producción.
- Ni la impresora integrada IPOS ni la zona horaria entran aquí: son bloques propios (puntos 6 y 9 de la
  pasada).

## Verificación

Cada fila: se rompe el código, se ve el rojo, el mensaje real va al `-done`, y se restaura.

| Sabotaje | Debe caer |
|---|---|
| La función devuelve horizontal para 360 dp | el test de móvil |
| La función devuelve vertical para 800 dp | el test de tablet (el AP11 se pondría en vertical) |
| Umbral en 720 en vez de 600 | el test de 600 dp, que es tablet |
| La barra del ticket sale en la Agenda | el test/e2e de Agenda |
| La barra no se oculta con el teclado | el test de `visualViewport` reducido |
| El cajón sin `overflow-y-auto` | el test de que «Declaración responsable» es alcanzable |

### La pasada en el hierro (criterio de cierre)

- **N1** (móvil, 192.168.5.144, emparejado por adb inalámbrico), cuenta PRUEBAS MIPIACE, cajero de
  pruebas. Arranca en vertical sin parpadeo raro; venta → hoja del ticket con las líneas a la vista →
  cobro con los métodos de pago enteros; búsqueda con teclado mostrando resultados; «Nueva cita» con
  «Reservar» visible; menú hasta «Declaración responsable»; PIN mal → aviso visible.
- **AP11**: arranca en horizontal y la venta se ve como antes. Captura de antes y después, lado a lado.
- **No se cierra ninguna venta** si no es en modo prueba.

## Entregables

- Rama `n1-vertical`, commits pequeños en español.
- APK **1.27.0** compilada con `build-release-apk.sh` (árbol limpio, `ANDROID_HOME` del Mac), **sin
  publicar**: la publica Matías tras la pasada.
- `docs/blocks/n1-vertical-done.md` con:
  - la estructura de siempre;
  - las decisiones tomadas sin preguntar, una a una;
  - los sabotajes con su rojo;
  - las capturas de la pasada en el N1 y del AP11 antes/después.
- **El push y el PR los hace Matías**: deja los comandos exactos al final.

## Fuera de alcance

- La impresora integrada del N1 (plugin IPOS por AIDL): bloque propio.
- Las horas en la zona de la tienda en vez de la del aparato: bloque propio.
- La defensa para alturas cortas en horizontal (`max-height: 500px`) en la hoja del ticket y el cobro.
- El panel del propietario en la app y la impresión del ticket.
