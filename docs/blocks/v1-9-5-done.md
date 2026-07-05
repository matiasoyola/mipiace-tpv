# Bloque v1.9.5 · formación en modo prueba + feedback con nombres — DONE

**Rama:** `v1-9-5-formacion-y-feedback`
**Origen:** `docs/code-prompts/bloque-v1-9-5-formacion-y-feedback.md` + `docs/auditorias/2026-07-05-mapa-simulaciones-bar.md` (hallazgos: la devolución no se puede ensayar en formación; banners de concurrencia sin nombres; bug B3 del checkbox de cierre sin motivo).
**Estado:** cerrado. **Cero cambios de schema, cero migraciones, cero lógica fiscal (`totals.ts` intacto), cero cambios en el payload de Holded.** El gate fiscal queda reforzado: ningún documento de prueba puede llegar a Holded por ningún camino nuevo. Sin merge ni deploy (los hace Matías).

Ficheros tocados (dentro de frontera):
- API: `apps/api/src/tickets/routes.ts` (POST /refunds), `apps/api/src/tickets/upload-refund.ts`, `apps/api/src/shift/routes.ts` (Z), `apps/api/src/realtime/store-events.ts`, `apps/api/src/realtime/emit-helpers.ts`, `apps/api/src/tables/grouping.ts`.
- Front: `apps/tpv-web/src/pages/TicketsHistoryPage.tsx`, `apps/tpv-web/src/pages/SalePage.tsx`, `apps/tpv-web/src/pages/CloseShiftModal.tsx`, `apps/tpv-web/src/hooks/useStoreEventStream.ts`.
- Tests: `apps/api/test/refunds-test-mode.test.ts`, `apps/api/test/upload-refund-test-mode.test.ts`, `apps/api/test/emit-helpers-names.test.ts`, `apps/api/test/tables-e2e.test.ts` (assert añadido), `apps/tpv-web/test/refund-button-test-mode.test.tsx`, `apps/tpv-web/test/close-shift-reason.test.tsx`.

**Nada de lo prohibido se tocó:** `TableMapScreen.tsx`, `SalePage.lineSheet.tsx`, `lib/cart.ts`, `totals.ts`, `packages/ticket-pdf`, `packages/escpos-builder`, schema/migraciones.

---

## Frente 1 — Devoluciones ensayables en modo prueba

**Terminología (aclaración importante):** el mapa de simulaciones dice «tickets SKIPPED», pero en el modelo real un ticket de prueba tiene `Ticket.status = TEST`; lo que queda `SKIPPED` es su `HoldedUpload` (estado terminal de la cola de subida). El botón del historial y el gate de refund se basan en `status = TEST`.

- **Botón «Iniciar devolución» sobre tickets TEST** (`TicketsHistoryPage.tsx`): el gate pasa de `status === "SYNCED"` a `status === "SYNCED" || (status === "TEST" && isTestModeActive())`. Misma señal `isTestModeActive()` que pinta el badge PRUEBA (sessionStorage, `lib/test-mode.ts`). Fuera de modo prueba un ticket TEST no muestra el botón.
- **El refund de un ticket TEST nace con el gate fiscal heredado** (`POST /refunds` en `tickets/routes.ts`):
  - Se levanta el rechazo `TICKET_NOT_REFUNDABLE` para permitir el estado TEST (los demás estados no efectivos siguen rechazados).
  - El refund se crea con `status = TEST` (en vez de `PENDING_SYNC`).
  - Su `HoldedUpload` nace `SKIPPED` con `lastError = { skipped: "test_mode" }` (mismo patrón terminal que la venta test en `upload-ticket.ts`).
  - **NUNCA se llama a `enqueueRefundUpload`** para un refund test → no hay job contra Holded. No manda email (no se toca el path de email, que ya sólo aplica a ventas).
- **Red de seguridad en el worker** (`upload-refund.ts`): si por lo que sea un refund `status = TEST` aterriza en `uploadRefund`, se marca `HoldedUpload = SKIPPED` y retorna `{ kind: "skipped", reason: "test_mode" }` **antes** de construir el cliente Holded. Doble barrera («ante la duda, no se encola»).
- **Z del turno de prueba** (`shift/routes.ts`): las devoluciones TEST ahora computan en el Z igual que las ventas TEST. Las ventas test ya entraban al desglose porque los `ticketPayment` se agregan sin filtro de status; las devoluciones estaban excluidas por `notIn: [..., "TEST"]`. Se quita `TEST` de ese `notIn` en el `refundsCount` y en el `groupBy` del desglose. **En turnos reales no hay refunds TEST, así que el Z de producción no cambia.**
- **Purga al activar la cuenta:** no requiere código nuevo — los documentos TEST (tickets y ahora refunds) se purgan por el mismo mecanismo de activación del tenant que ya barre lo TEST. No se añade camino nuevo.

## Frente 2 — Eventos con nombres (aditivo)

- **`ticket.paid`** (`store-events.ts` + `emit-helpers.ts`): se añaden `registerName` y `tableName` (nullable). `emitTicketPaid` ya cargaba el `register` para el `storeId`; ahora selecciona también `name` y, si hay `tableId`, hace un `table.findUnique({ select: { name } })`. Sin mesa no consulta la tabla.
- **`table.grouped`** (`store-events.ts` + `grouping.ts`): se añade `mainTableName` (nullable). El `findMany` de mesas del endpoint ya cargaba las filas; se añade `name` al `select` y se resuelve el nombre de la principal en memoria (sin query extra).
- **Front** (`useStoreEventStream.ts` mirror + `SalePage.tsx`):
  - Banner de expulsión por cobro remoto → «Mesa {mesa} cobrada desde {Caja N}» (fallback a «…desde otra caja» si el evento en vuelo no trae `registerName`).
  - Banner de expulsión por absorción → «{mesa} se ha unido a {mesa destino}» (fallback a «…se ha unido a otra mesa»).
  - Toast cross-caja del contador → «{Caja N} cobró un ticket (X €)» (fallback al copy genérico).
- **100 % aditivo:** todos los campos nuevos son nullable/opcionales, con fallback al copy anterior. Ningún consumidor existente se rompe y los eventos ya emitidos (en vuelo durante el deploy) siguen válidos.

## Frente 3 — Copy del cierre de turno (micro-frente)

`CloseShiftModal.tsx`: el checkbox «Lo entiendo, cerrar el turno igualmente…» antes se renderizaba SIEMPRE en modo Z (bug B3: aparecía sin explicar el motivo). Ahora:
- Sólo aparece si hay **motivo real**, y el copy dice **cuál**:
  - `n documentos pendientes de subir a Holded` — del 409 `SYNC_PENDING` (`pendingSync + failed` que ya devuelve el backend; ahora se leen esos contadores del `err.data`).
  - `m cobros en la cola local del dispositivo` — de `outboxCounts()` (`pending + rejected`), consultado al abrir el modal.
- Si no hay ninguno de los dos motivos, **no hay checkbox** ni casilla que marcar.
- Sin tocar la lógica de cierre: `syncFailureAccepted` se sigue enviando igual y el gate real vive en el backend (`hasSyncIssues && !syncFailureAccepted`). Es copy + condición de render.

---

## Decisiones tomadas sin preguntar

1. **`Ticket.status = TEST` es la señal, no un `SKIPPED` de ticket.** El prompt/auditoría hablan de tickets «SKIPPED»; en el modelo el ticket es `TEST` y sólo el `HoldedUpload` es `SKIPPED`. Se implementó sobre `status = TEST` (que es lo que ve el historial y el gate de refund). Sin cambios de schema.
2. **Doble barrera fiscal** (no-encolar en el POST **y** skip defensivo en el worker) en lugar de confiar en un solo punto. «Ante la duda, el refund test NO se encola» → la vía del worker sólo existe como red de seguridad.
3. **El Z incluye refunds TEST quitando `TEST` del `notIn`** (coherencia con las ventas test, cuyos pagos ya se cuentan sin filtro). Alternativa descartada: filtrar por «turno de prueba» — no hay flag de turno-prueba y el resultado sería idéntico (en turnos reales no existen refunds TEST).
4. **Campos de nombres nullable con fallback de copy** en vez de romper el contrato. Prioridad: compatibilidad con eventos en vuelo y consumidores viejos.
5. **El toast cross-caja del contador** («otra caja cobró un ticket») también pasa a nombrar la caja, aunque el prompt sólo pedía los dos banners de expulsión. Es aditivo, mismo dato ya disponible, cero riesgo.
6. **Frente 3 lee dos fuentes de «pendiente»** (sync servidor + outbox local) porque el prompt menciona ambas («n uploads pendientes / outbox con m cobros»). El outbox se consulta best-effort: un fallo de IndexedDB no bloquea el modal.
7. **`TicketDetailDrawer` se exporta** (antes privado) sólo para poder testear la visibilidad del botón de forma aislada. Cambio aditivo dentro del fichero en frontera; no altera el uso interno.
8. **No se tocó `RefundPage.tsx`**: no tenía gate por status, así que con el gate de API abierto a TEST y el botón visible, el flujo de refund existente funciona sin cambios. Menos superficie tocada.

## Notas / carryovers

- **`tables-e2e.test.ts` y otros tests con DB** requieren Postgres/Redis; se ejecutan en CI/entorno con infra. La assert de `mainTableName` añadida corre cuando ese e2e corre. Los tests nuevos sin DB (`refunds-test-mode`, `upload-refund-test-mode`, `emit-helpers-names`) usan fakes y pasan en local.
- **Prisma client:** el entorno local tenía el client desincronizado (faltaban `alias`, `cashierSessionTtlMinutes`, `ContactType`, `archivedFromHoldedAt`, etc. — carryover conocido). Tras `prisma generate` el `tsc --noEmit` de la API queda limpio salvo `@sentry/node` (no instalado, pre-existente). El `@sentry/react` de tpv-web tampoco está instalado localmente (dependencia declarada) → los tests de front que arrastran ese grafo mockean `lib/sentry.js`.
- **Validación visual real** (banners con nombres, botón de refund en modo prueba, checkbox de cierre con motivo) pendiente contra tenant Sirope en modo prueba, como el resto de la familia de bloques de bar.
