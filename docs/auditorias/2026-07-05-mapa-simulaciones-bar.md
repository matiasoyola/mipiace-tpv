# Mapa de simulaciones · vertical bar multi-caja

Fecha: 2026-07-05 (víspera implantación Sirope). Objetivo: enumerar sistemáticamente los escenarios donde el TPV puede fallar en un bar real, clasificados por cómo se pueden simular y por riesgo. Origen: la simulación 2-cajas destapó que (a) el interior de una mesa abierta no se refresca con líneas remotas y (b) un cobro rechazado por `PAYMENTS_MISMATCH` no muestra ningún error.

Convención de estados: ✅ probado OK · 🐛 bug encontrado · ⏳ pendiente (simulable esta noche) · 📱 requiere dispositivo real (mañana in situ) · 🧪 cubierto por tests de la suite (no repetir a mano).

## Dimensiones del mapa

Los fallos de esta familia nacen de cruzar **dos actores** sobre **un recurso compartido**. Actores: caja A, caja B, servidor (deploy/reinicio), Holded (sync), el tiempo (turnos, expiración de sesión), la red (offline). Recursos: DRAFT de mesa, grupo de mesas, ticket emitido, turno/arqueo, catálogo, serie de numeración.

## A · Dos cajas sobre la misma mesa (simulable con 2 pestañas)

| # | Escenario | Esperado | Estado |
|---|-----------|----------|--------|
| A1 | B añade líneas, A tiene la mesa abierta | A ve las líneas llegar (WS) | 🐛 interior congelado; solo el mapa se actualiza |
| A2 | B cobra con total desactualizado | Rechazo CON feedback | 🐛 server rechaza bien (400) pero modal mudo |
| A3 | Doble cobro simultáneo (ambos en modal, ambos Cobrar) | Uno gana; el otro 409 con mensaje claro | 🐛 CONFIRMADO: server perfecto (1 solo ticket #000008, claim funciona) pero el perdedor se queda con el modal abierto SIN NINGÚN AVISO → riesgo de doble cobro FÍSICO (B acepta el billete del cliente creyendo que cobró) |
| A4 | Dos cajas abren la MISMA mesa libre a la vez | Un solo DRAFT (no duplicado) | ✅ un solo DRAFT; el segundo toque retoma el del primero |
| A5 | A agrupa M1→M4 mientras B está dentro de M1 | B es expulsado/avisado; no puede seguir añadiendo a un DRAFT absorbido | 🐛 server ✅ (línea de B preservada en el grupo, total 2,20 exacto, sin limbo) pero B sigue "dentro" de la mesa absorbida sin aviso y sus nuevas líneas se rechazan EN SILENCIO → bebida servida sin comandar |
| A6 | A cobra el grupo mientras B añade a la mesa absorbida | Línea de B no se pierde en silencio (o rechazo claro) | ✅ parcial (cubierto por A5: el add-line a mesa muerta se rechaza; falta solo el aviso) |
| A7 | Mover línea a una mesa que justo se cobró/liberó | Error claro o re-apertura limpia | ⏳ P1 |
| A8 | "Mover mesa" (cambiar mesa física) mientras B la tiene abierta | B sigue el movimiento o recibe aviso | ⏳ P1 |
| A9 | Partir cuenta en A mientras B añade líneas | Totales coherentes | ⏳ P2 (flujo aún no probado ni en solitario) |
| A10 | Desagrupar desde la caja que NO agrupó | Reversión limpia (originalTableId) | ⏳ P2 |

## B · Turnos y arqueos (simulable: 2 pestañas + cierre)

| # | Escenario | Esperado | Estado |
|---|-----------|----------|--------|
| B1 | Mesa abierta con consumo sobrevive a cierre+apertura de turno | DRAFT persiste y es cobrable en el turno nuevo | ✅ el DRAFT de M3 nació en el turno anterior, sobrevivió al cierre y se cobró limpio en el nuevo (#000008) |
| B2 | A cierra turno mientras B está en medio de un cobro de mesa | Cobro completa o rechazo claro; nunca ticket huérfano de turno | ⏳ P1 |
| B3 | Cierre con checkbox "cerrar igualmente" | El copy explica QUÉ hay pendiente | 🐛 menor: aparece sin explicar el motivo |
| B4 | ¿A qué turno computa un cobro hecho por B segundos después del cierre de A? | Al turno del cobro, con Z coherente | ⏳ P2 |

## C · Red y offline (📱 mayormente device real, modo avión)

| # | Escenario | Esperado | Estado |
|---|-----------|----------|--------|
| C1 | Venta rápida offline → reconexión | Outbox reenvía; chip pendientes visible | 🧪 (v1.5-C) + 📱 verificar en AP12 |
| C2 | Mesas en offline | Bloqueadas con aviso; venta rápida viva | ✅ banner visto en mapa |
| C3 | Cierre de turno con cobros en outbox | Aviso y recuperación automática | 🧪 + 📱 |
| C4 | WS caído (no offline total): mapa desactualizado | Reconexión 3s; sin estados fantasma | 📱 |

## D · Sesión y auth (simulable con javascript_tool / localStorage)

| # | Escenario | Esperado | Estado |
|---|-----------|----------|--------|
| D1 | Sesión expira a mitad de cobro (#18) | Modal re-login PIN in situ, carrito intacto | 🧪 (v1.0) — ⏳ P2 en vivo borrando token |
| D2 | Bloquear TPV y re-login con PIN | Vuelve al estado anterior | ⏳ P2 |

## E · Catálogo y Holded (simulable con SQL/API + sync)

| # | Escenario | Esperado | Estado |
|---|-----------|----------|--------|
| E1 | Precio cambia en Holded; caja con catálogo viejo en IDB vende | Definir fuente de verdad del precio en el POST (¿cliente o server?) — riesgo de vender a precio viejo | ⏳ P1 — revisar primero en código |
| E2 | Producto borrado en Holded estando en un carrito abierto (v1.9 reconcile) | Venta falla con mensaje o pasa como snapshot | ⏳ P2 |
| E3 | Sync incremental corriendo durante venta | Sin bloqueo del TPV | 🧪 |

## F · Ya validado esta noche (no repetir)

Venta rápida barra/mesa, mapa tiempo real entre cajas, retomar mesa de otra caja, agrupar+cobrar grupo (liberación automática), cobro efectivo/tarjeta, PDF fiscal, arqueo X, Z con descuadre, apertura de turno con fondo, viewport 1280×800, badge PRUEBA.

## Orden de ejecución esta noche (P0 → P1)

1. **A3** doble cobro simultáneo (el más probable mañana con 2 cajas).
2. **A4** doble apertura de mesa libre.
3. **B1** DRAFT sobrevive cambio de turno (estado ya montado con M3).
4. **A5** agrupar con la otra caja dentro.
5. E1 revisión en código (fuente de verdad del precio) + A6/A7/A8 si da tiempo.

Los fixes se agrupan en un único bloque `v1-9-2-mesas-concurrencia` con TODO lo encontrado (ya incluye: refresco de líneas por WS en mesa abierta, banner ante PAYMENTS_MISMATCH, autocierre del modal Ticket emitido).
