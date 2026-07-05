# Bloque v1.9.2 · mesas-concurrencia + navegación de bar — DONE

**Rama:** `v1-9-2-mesas-concurrencia`
**Origen:** `docs/auditorias/2026-07-05-mapa-simulaciones-bar.md` (4 bugs UX confirmados EN PRODUCCIÓN, modo prueba, tenant Sirope, víspera de implantación): A1 (interior de mesa congelado ante líneas remotas), A2 (cobro rechazado sin feedback), A3 (doble cobro simultáneo: el perdedor sin aviso → doble cobro físico), A5 (mesa absorbida sin aviso → bebida servida sin comandar).
**Estado:** cerrado. Suite tpv-web verde: **224 passing (19 files)**, antes 214. `tsc -b` limpio en tpv-web. **Cero cambios de schema, cero migraciones, cero lógica fiscal, cero cambios de API/eventos** — solo `apps/tpv-web/**`. Sin merge ni deploy (los hace Matías).

Diagnóstico de los 4 bugs (verificado por SQL en el mapa de simulaciones): **el estado del servidor es sano en todos los casos**. Lo roto era que la SalePage en contexto mesa no escuchaba los eventos de SU mesa y silenciaba los errores HTTP. Este bloque es frontend + copy.

---

## Frente 1 — La mesa abierta escucha su propia realidad

`SalePage.tsx`: el `useStoreEventStream` (ya conectado para el contador cross-caja) ahora también atiende los eventos de **la mesa actual** cuando hay `tableContext`:

- **`table.lineAdded` / `table.lineRemoved` / `table.lineUpdated` / `table.linesMoved`** de MI mesa → `reloadTableDraft()` (refetch de la proyección del DRAFT). El panel (líneas + totales) refleja la verdad sin modal ni toast — el dato ya llegó por WS, latencia percibida cero. **(cierra A1)**
- **`ticket.paid` de MI mesa cobrada por OTRA caja** (`ev.tableId === tableContext.id && ev.registerId !== registerId`) → salida automática al mapa con banner inline «Mesa {name} cobrada desde otra caja». Se filtra por `registerId` para no auto-expulsarse en el propio cobro. **(cierra A3 lado perdedor)**
- **`table.grouped` con MI mesa en `absorbedTableIds`** → salida al mapa con banner «Mesa {name} se ha unido a otra mesa». El que agrupa (mainTableId propio) no se expulsa. **(cierra A5 lado expulsado)**
- **Reconexión WS**: al pasar `wsStatus` a `open` tras un corte, refetch de la proyección si hay mesa abierta (pudimos perder eventos).
- **Modal de cobro abierto y la cuenta CAMBIÓ** (Frente 1.4): el refetch actualiza `props.totals` del `CheckoutOverlay`; el modal detecta la diferencia y pinta el aviso in situ (ver Frente 2).

## Frente 2 — Los errores del servidor se ven

`CheckoutPage.tsx` (`CheckoutOverlay`) — nuevas props `onRefetchTable`, `onTableClosedElsewhere`, `onTablePaidExit`:

- **`PAYMENTS_MISMATCH` (400)** → aviso inline bajo el total (zona ámbar): «La cuenta ha cambiado desde otra caja. Total actual: X €» + botón **Actualizar** que refetchea (`onRefetchTable`) y recalcula el modal. No cierra el modal. «Cobrar» queda bloqueado mientras `accountChanged`. El mismo mecanismo (`ackTotal` vs `props.totals.total`) cubre Frente 1.4. **(cierra A2)**
- **`TICKET_ALREADY_PAID` (409)** → cierra el modal y sale al mapa con banner «Esta mesa ya fue cobrada desde otra caja». Nunca queda mudo (escenario de doble cobro físico). Borra el item del outbox. **(cierra A3)**
- **Add-line sobre DRAFT muerto** (`TICKET_NOT_FOUND_OR_NOT_DRAFT` 404 / `TABLE_GROUPED` 409, helper `isDeadDraftError` en `lib/tableDraft.ts`) → banner persistente sobre el panel «Esta mesa ya no está abierta (cobrada o unida a otra). Vuelve al mapa.» + CTA **Ir al mapa**. No es un toast efímero: el cajero debe SABER que no puede seguir. **(cierra A5 add-line en silencio)**
- Los demás rechazos tipificados siguen pintando el `message` del server inline (comportamiento previo).

## Frente 3 — Navegación de bar (el mapa siempre a un toque)

- **3.1 · Tras cobrar una MESA**: se elimina el modal «Ticket emitido» en contexto mesa. `CheckoutOverlay` (con `onTablePaidExit`) sale directo al mapa con **banner de éxito** «Mesa cobrada · Ticket #N» (4 s, autocerrable) + «Ver ticket» que abre el detalle en Tickets (prefiltrado por número interno). En **venta rápida** el modal se mantiene pero con **autocierre a los 4 s** (`SuccessOverlay`, pausado si hay QR/preview/impresión en curso); QR/PDF/email siguen en Tickets.
- **3.2 · Botón «Mesas» fijo** en el header de SalePage (venta rápida) y en el header de `TicketsHistoryPage` (prop `onGoToMap`). Icono `LayoutGrid` + texto, mismo peso que «Tickets». El chip «Mapa» del panel de mesa se mantiene.
- **3.3 · Header del mapa completo** (`TableMapScreen`): añadidos «Tickets» (overlay `TicketsHistoryPage`) y menú hamburguesa con **Sincronizar catálogo, Arqueo X, Cerrar turno, Bloquear** — espejo del drawer de SalePage. El arqueo ya no exige pasar por venta rápida. Requiere nuevas props `shiftId` y `cashierRole` (cableadas desde `App.tsx`).
- **3.4 · Copy**: «Turno · #N» → «Ticket N del turno» en el panel del ticket (es un contador de tickets, no el nº de turno).

## Orquestación (App.tsx)

`TpvHome` mantiene `mapNotice: MapNotice | null`. Nuevo prop de SalePage `onExitToMap(notice)` (expulsión o éxito con `tone`/`ticketQuery`); `onBackToMap`, `pickTable` y `onQuickSale` limpian el notice. `TableMapScreen` recibe `notice` y lo autocierra a 4 s localmente (cerrable a mano). Todo el feedback nuevo es **banner/aviso inline** — sin modales nuevos en el flujo crítico.

## Tests

`apps/tpv-web/test/mesas-concurrencia.test.tsx` (nuevo, 8 casos) — WS mockeado capturando el `onEvent`:
1. `table.lineAdded` remoto refresca la proyección · 2. `ticket.paid` remoto expulsa al mapa con banner · (extra) `table.grouped` expulsa · 3. checkout 400 `PAYMENTS_MISMATCH` pinta aviso y «Actualizar» recalcula (1,65 → 4,40 €) · 4. checkout 409 `TICKET_ALREADY_PAID` cierra modal + banner · 5. add-line a mesa muerta (`TABLE_GROUPED`) pinta banner con CTA · 7. «Mesas» en venta rápida; hamburguesa + «Tickets» + Arqueo X/Cerrar turno en el mapa.

`apps/tpv-web/test/success-overlay-autoclose.test.tsx` (nuevo, 1 caso, fake timers) — 6. el modal de éxito de venta rápida llama `onDone` a los 4 s.

`apps/tpv-web/test/table-sale-flow.test.tsx` (actualizado) — el test «cobrar mesa» ahora asegura que en mesa NO hay modal «Ticket emitido» y que `onExitToMap` se llama con `{ tone: "success", ticketQuery }` (Frente 3.1).

**Cómo ejecutar:** `pnpm exec vitest run --project tpv-web` desde la raíz (el entorno jsdom vive en `vitest.workspace.ts`; ejecutar vitest desde `apps/tpv-web` NO carga el jsdom y falla en masa — no es un fallo de código).

---

## Archivos tocados (solo apps/tpv-web/**)

- `src/App.tsx` — `mapNotice` + `onExitToMap`; pasa `shiftId`/`cashierRole`/`notice` al mapa.
- `src/pages/SalePage.tsx` — handler WS de mesa, reconexión, `exitToMap`, banner mesa muerta, botón «Mesas», copy «Ticket N del turno», cableado de nuevas props del checkout y `onGoToMap` del historial.
- `src/pages/TableMapScreen.tsx` — `MapNotice`, banner inline, hamburguesa (drawer), «Tickets», overlays CloseShift/Arqueo X/History.
- `src/pages/TicketsHistoryPage.tsx` — props `onGoToMap` + `initialQuery`, botón «Mesas».
- `src/pages/CheckoutPage.tsx` — aviso «cuenta cambiada» + Actualizar, manejo 400/409, salida directa mesa.
- `src/pages/CheckoutPage.successOverlay.tsx` — autocierre 4 s (pausado en sub-acción).
- `src/lib/tableDraft.ts` — helper `isDeadDraftError`.
- `test/mesas-concurrencia.test.tsx` (nuevo), `test/success-overlay-autoclose.test.tsx` (nuevo), `test/table-sale-flow.test.tsx` (actualizado).

## Decisiones / dudas abiertas (carryovers)

1. **Copy sin nombre de la otra caja/mesa.** El banner de cobro dice «cobrada desde otra caja» (no «Caja N») y el de absorción «se ha unido a otra mesa» (no «M4»): los eventos `ticket.paid`/`table.grouped` existen y se consumen, pero **no cargan** el nombre display del register ni de la mesa destino (solo `registerId`/`byEmail` y `mainTableId`). Resolver requeriría ampliar el payload en el server (fuera de alcance de este bloque). Enriquecer el copy es un follow-up de una línea en la API si producto lo pide.
2. **Cobro de mesa en tránsito (offline / 5xx).** El caso `pendingLocal` (outbox) conserva el `PendingSaleOverlay` existente → `onConfirmed` → mapa plano (sin banner de éxito). Solo el cobro **synced** de mesa usa el banner nuevo con «Ver ticket». Aceptado: es un borde y el ticket aún no tiene número. Si se quiere banner también en pendingLocal, es trivial pero se dejó fuera para minimizar riesgo.
3. **«Ver ticket» abre el historial prefiltrado por número interno** (`initialQuery`), no un deep-link al detalle. Muestra el ticket arriba en la lista; suficiente para «abrir el detalle en Tickets» sin tocar la ruta de `RefundPage`/detalle.
4. **Refetch en eco de la propia línea.** `table.lineAdded` no trae `registerId`, así que un add-line propio dispara también un `reloadTableDraft` (GET idempotente que devuelve el mismo estado). Inocuo; si en producción se ve tráfico de más, filtrar por origen exigiría ampliar el evento (server).
5. **Verificación en vivo pendiente.** Criterio de «funciona»: re-ejecutar **A1, A2, A3, A5** con dos pestañas contra Sirope en modo prueba y confirmar que el camarero perdedor SIEMPRE sabe qué pasó sin tocar nada. No hecho aquí (requiere las dos cajas); queda para la validación de Matías antes del live.

## Fuera de alcance respetado

Sin tocar: rediseño visual del mapa (`docs/mockups/mapa-sala-visual.html`), desglose de IVA al céntimo (`ticket-pdf`/`escpos-builder`), gate de devoluciones en modo prueba, partir cuenta / mover línea / fiado, autofocus del buscador, `SalePage.lineSheet.tsx` (precios), `lib/cart.ts` (aritmética), API/eventos del servidor, schema/migraciones.
