# Auditoría de usabilidad por procesos · AP13 (Kozen D8) · 2026-10-06 · EJECUTADA

Repite el guion del 02-09 (`guion-auditoria-por-procesos.md`) en el terminal que va a La Maestranza.
APK **1.21.0 (12100) · build 54d3e2a**, WebView 101, 1920×1080 a densidad 213 → viewport
**1443×812**, DPR 1,33, pantalla de 157 dpi (1 px CSS ≈ 0,21 mm; los 48 px del sistema ≈ 10 mm).
Instrumentado con CDP sobre el WebView (`adb forward` + `Runtime.evaluate`): rects reales,
`elementFromPoint`, `visualViewport` para el teclado del SO y tiempo `pointerdown` → primera mutación
+ doble rAF. Toques reales por `adb input tap`. Nada estimado a ojo.

Capturas: `2026-10-06-ap13-usabilidad/` (prefijos `r1-`…`r5-` por recorrido, `x-` pantallas sueltas).
Hallazgos sueltos del primer vistazo de Matías: `2026-10-06-ap13-usabilidad.md`.

## Desviación de protocolo (decidida por Matías)

Se hizo sobre **La Maestranza real**, no sobre Sirope en modo prueba. Rastro que queda en su cuenta:

- Tickets **#000002** (2,60 €, efectivo, entregados 5,00) y **#000003** (6,90 €, mixto 4,00 tarjeta +
  2,90 efectivo) en la Caja 1.
- **Turno cerrado a las 21:27** con arqueo 5,50 € (descuadre 0,00) y **reabierto con fondo 0,00 €**.
- La mesa **M4** (11 hamburguesas, 55,00 €, abierta por Matías) **no se tocó**: sigue abierta.
- Una comanda de la M1 que falló por falta de impresora (no imprimió nada).

## Toques por recorrido

| Recorrido | 02-09 (AP11) | Hoy (AP13) | Evitables hoy | Qué sobra |
|---|---|---|---|---|
| R1 Bloquear → PIN → abrir turno | 8 | 7 + PIN | 1 | «C» para poder teclear el fondo |
| R2 Barra: 2 productos, efectivo con vuelta | 7 | 9 | 2 | bajar el teclado del SO para llegar a «Nueva venta»; descartar la confirmación |
| R3 Mesa: abrir + 3 productos + comanda | 6 (+1) | 9 | 3 | dos chips de categoría (orden A→Z); «Entendido» del error de impresora |
| R4 Cobrar mesa, mixto tecleado | 9 / 16 | 10 | 4 | dos veces bajar el teclado del SO; «C» porque el pad no escribe; «Listo» |
| R5 Cierre + arqueo (2 denominaciones) | 8 | 10 | 1 | desplazar la lista hasta 5 € y las monedas |
| R6 Vincular un terminal | imposible | **no ejecutado** | — | desvincularía el terminal del bar; en código `PairScreen` sigue con `<input inputMode="numeric">` (teclado del SO) |

## Tiempo hasta la confirmación visual (presupuesto 100 ms)

Añadir producto **28–58 ms** · categoría 33–100 ms · abrir mesa 30 ms · enviar comanda 43 ms ·
abrir cobro 48–50 ms · billete 35–39 ms · confirmar cobro 43–44 ms · pad 31–41 ms ·
**«Hecho» del cierre 154 ms** (el único fuera de presupuesto). El D8 es más rápido que el AP11: C12 desaparece por el hierro, no por el código.

---

# 🔴 Bloquea implantación

### N1 · El teclado del sistema aparece solo y tapa el 55 % de la pantalla — también encima del pad del cobro

Causa en `SalePage.tsx` ~1129: el refoco permanente del buscador plegado (para el lector USB-HID) sólo
se desactiva con `(pointer: coarse)`, y el WebView del D8 dice `pointer: fine`, `hover: none`,
`maxTouchPoints 5`. Cada vez que el foco cae en `body` se re-enfoca el `<input type=search>` que vive
en `x = −9834` y Android saca el QWERTY: el viewport pasa de **812 a 368 px**.

Medido dónde salta: al entrar en venta (`r2-01`), al abrir una mesa, tras enviar comanda (`r3-03`),
**sobre la confirmación «Ticket emitido» tapando «Nueva venta»** (`r2-06`) y, lo peor, **al tocar el
importe de tarjeta en el cobro mixto: el CashPad se abre debajo y del pad sólo se ve la fila 1-2-3**
(`r4-02`). Sin bajar el teclado con ▼ no se puede cobrar un mixto. Tocar un producto lo cierra (el
botón se queda el foco), por eso en barra pasa casi desapercibido y en el cobro bloquea.

Arreglo: `inputMode="none"` mientras el buscador está plegado (el HID sigue entrando, el SO no saca
teclado) + detección de táctil que no se fíe sólo de `pointer`.

### B2 (sigue) · Se cierra el día con una mesa abierta y nadie avisa

Cierre con **M4 abierta y 55,00 € en sala**: ni aviso en «Cerrar el día», ni en el arqueo, ni en el
Z, ni al abrir el turno siguiente (`r5-02`, `r5-07`, `r1-04`). Igual que el 02-09 con 19,60 €.

### B3 (sigue) · «Enviar comanda» falla con mensaje de administrador y no deja rastro

Sin impresora: banner «Falta configurar impresora WIFI para la sección **SALON** en este
**register**», tapando la cabecera del ticket, salida «Entendido». Tras descartarlo la mesa no marca
nada. En La Maestranza la impresora aún no existe, pero el día que falle el papel pasará esto.

### B4 (sigue, y peor) · El nombre no se puede leer en la línea del ticket

El nombre de la línea tiene **86–100 px** y una sola línea: «Hamburgu…», «Café con lec…», «Estrella
Galic…» (`r2-03`, `r3-02`). Con la carta del bar (Hamburguesa normal / especial, Bocadillo /
especial, Montado / especial) **dos productos de distinto precio se leen igual** después de pulsarlos.

### B5 (sigue en código) · Vincular abre el teclado del SO

No se ejecutó (desvincularía el terminal del bar). `PairScreen.tsx:142` mantiene el input numérico
nativo; con lo medido en N1, en el D8 tapará el botón igual que en el AP11.

---

# 🟠 Cuesta dinero en hora punta

### C2 (sigue) · El pad no escribe sobre un importe pre-rellenado — ni en el cobro ni al abrir turno

Mixto: tarjeta pre-rellena 6,90; pulsar **4** no cambia nada; borrar deja 6,9 y el 4 se pega (6,94).
Sólo funciona tras **C**. Lo mismo en el fondo de apertura (`0,00` → pulsar 1 no hace nada, `r1-03`).
La ayuda sigue diciendo «escribe encima si no cuadra».

### N2 · Refrescos y Vinos escondidos, y la categoría elegida no dice cuál es

Diez categorías; se ven seis y **Platos, Raciones, Refrescos y Vinos** quedan tras «Más (4)» (`x-03`).
Refrescos tiene 22 productos y en un bar es de lo que más sale. Al elegirla, la fila sigue diciendo
«Más (4)» resaltado: **el camarero no ve en qué categoría está** (`x-05`). Orden A→Z (C6): Bocadillos
va antes que Cafés y Cervezas. El rail vertical decidido el 02-09 sigue sin construirse.

### N3 · En el panel del ticket caben tres líneas

Cada línea mide ~91 px de alto (stepper de 116×88 + nombre + importe + papelera). En los 812 px del
D8 se ven **3 líneas**; una mesa de seis cosas ya pide desplazar para comprobarla antes de cobrar.

### C8 (sigue) · −/+ de 44 × 36 px; papelera de 44 × 44 sin deshacer

### C5 (sigue) · «Imprimir ticket» y «Más opciones» quedan bajo el pie fijo del cobro (`r2-05`, `r4-01`)

### C10 (sigue) · El arqueo empieza en 500 €; 5 € y las monedas exigen desplazar

Siete filas visibles. Un deslizamiento corto se pasa de largo (`r5-04`). El layout lista + pad sí
funciona y no saca el teclado del SO.

### N4 · El TPV habla de Holded en una cuenta sin Holded

«**Sincronizando con Holded…**» girando en la confirmación de cobro más de 7 s sin resolverse
(`r2-07`); filtros «Sincronizados / Pendientes / Fallidos» y botón «Sincronizar» en Tickets;
«Sincronizar catálogo» en el menú. La Maestranza va sin Holded (decidido el 04-10): el camarero ve un
proceso que no existe y que no acaba nunca.

---

# 🟡 Estética

- **N5 · Nombre de producto a 13,5 px** y tarjetas con ~50 % de aire (E2 sigue). En la rejilla de
  1000 px caben 5 columnas.
- **E4 (sigue)** «Enviar comanda» es el botón débil al lado de «Cobrar» en una mesa.
- **C11 (sigue)** «Cancelar» de «Cerrar el día» se dibuja fuera del modal (`r5-02`).
- **N6 · Inglés en pantalla**: «CASH / CARD» en el detalle del ticket, «DRAFT», «register», «SALON»,
  «externalId» en el buscador de tickets (E6 sigue).
- **E8 (sigue)** la mesa abierta aparece en Tickets como `#D-0b624e13-dd43-…` sin nombre de mesa.
- **E10 (sigue)** «Mostrar PIN» 32 × 32.
- Chips de zona del mapa y de estado de tickets a 40–48 px de alto; textos del mapa a 9,5–11 px
  («4 PAX», «LA», nombres de zona).

---

## Lo que ya está bien (resuelto desde el 02-09)

- **B1/C1 · la vuelta**: el cierre suma lo cobrado (9,50 € = 2,60 + 6,90; efectivo 5,50 €) y la
  confirmación enseña el cambio en grande (2,40 €, `r2-07`).
- **C7 · el hueco del panel**: con el ticket vacío enseña «Lo que más sale este mes».
- **E11 · versión**: el menú enseña `1.21.0 (12100) · build 54d3e2a`.
- **C12 · latencia**: todo bajo 100 ms salvo «Hecho» (154 ms).
- **C9 a medias**: en el arqueo «Cerrar turno» ya no está pegado al pad.
- El aviso de impresora en la venta es una nota tranquila, no un bloqueo.
- Cero errores de cálculo en los dos cobros y el arqueo.

## Lectura para Dirección

Del backlog del 02-09 se construyó **v1.15** y nada más: los prompts de v1.16 (producto y comanda)
están escritos desde el 02-09 sin arrancar, y v1.17–v1.21 (cierre honesto, el cobro no miente,
vincular, catálogo y densidad, repaso estético) ni eso. Los huecos se los llevaron agenda, Verifactu,
H1, fichaje y clínicas. Hoy siguen vivos **15 hallazgos del 02-09** (B2, B3, B4, B5, C2, C5, C6, C8, C10, C11, E2, E4, E6, E8, E10) y **6 nuevos**, de los que N1 es
propio de este terminal y bloquea el cobro mixto.

**Nada se construye hasta que Matías ordene el reparto** (regla del guion).
