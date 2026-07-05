# Bloque v1.9.5 · formación en modo prueba + feedback con nombres

## Contexto (leer antes)

- `docs/auditorias/2026-07-05-mapa-simulaciones-bar.md` — hallazgo: la devolución solo se ofrece en tickets SYNCED; los de modo prueba quedan SKIPPED → **no se puede ensayar una devolución en la formación de un cliente nuevo** (hoy: Sirope).
- `docs/blocks/v1-9-2-done.md` carryover 1: los banners de concurrencia dicen «otra caja»/«otra mesa» porque `ticket.paid` y `table.grouped` no cargan nombres display.
- Gate actual del botón: `TicketsHistoryPage.tsx` → `ticket.status === "SYNCED"`. Flujo refund: `RefundPage.tsx`, `apps/api/src/refunds/`, worker `refund-upload`.

## Alcance

### Frente 1 · Devoluciones ensayables en modo prueba
1. El botón «Iniciar devolución» se ofrece también para tickets `SKIPPED` **solo cuando la sesión es de cajero técnico/modo prueba** (misma señal que pinta el badge PRUEBA).
2. El refund de un ticket TEST/SKIPPED nace marcado igual que sus ventas: NO se sube a Holded (mismo gate que el upload de venta test; el worker debe marcarlo SKIPPED, jamás encolarlo contra Holded), no manda email, y se purga con el resto al activar la cuenta.
3. En el Z del turno de prueba, esas devoluciones computan como hasta ahora computan las ventas test (coherencia: si las ventas test entran al Z de prueba, sus devoluciones también).
4. Tests API: refund sobre ticket SKIPPED en tenant DRAFT crea refund SKIPPED sin job de Holded; refund sobre SYNCED intacto. Test front: botón visible en SKIPPED solo en modo prueba.

### Frente 2 · Eventos con nombres (API pequeña y aditiva)
1. `ticket.paid`: añadir `registerName` (y `tableName` si hay mesa) al payload del bus WS. `table.grouped`: añadir `mainTableName`.
2. Front: banners pasan a «Mesa M3 cobrada desde Caja 2» y «M1 se ha unido a M4», con fallback al copy actual si el campo no llega (compatibilidad con eventos en vuelo).
3. Tests de bus/eventos actualizados. Cambio ADITIVO: ningún consumidor existente puede romperse.

### Frente 3 · Copy del cierre de turno
El checkbox «Lo entiendo, cerrar el turno igualmente…» solo aparece si hay motivo; cuando aparezca, el texto dice CUÁL es (n uploads pendientes / outbox con m cobros). Si no hay nada pendiente, no hay checkbox. Micro-frente de copy + condición, sin tocar la lógica de cierre.

## Restricciones

- PROHIBIDO tocar: `TableMapScreen.tsx` (v1.9.3 en vuelo), `SalePage.lineSheet.tsx`, `lib/cart.ts`, `totals.ts`, `packages/ticket-pdf`/`escpos-builder` (v1.9.4 en vuelo), schema/migraciones.
- El gate fiscal es sagrado: ningún documento de prueba puede llegar a Holded por ningún camino nuevo. Ante la duda, el refund test NO se encola.
- Front solo: `TicketsHistoryPage.tsx`, `RefundPage.tsx`, `CloseShiftModal`/cierre, `SalePage.tsx` únicamente en el copy de banners.

## Entregables

API (eventos + gate refund test) + front (botón, banners, checkbox) + tests. Criterio de «funciona»: en modo prueba de un tenant DRAFT se puede vender, devolver esa venta y cerrar turno viendo la devolución en el Z, sin que NADA toque Holded; y los banners de concurrencia nombran caja y mesa reales.

## Fuera de alcance (explícito)

Devoluciones parciales nuevas (el flujo de refund existente no se rediseña); deep-link al detalle de ticket; expulsión pasiva same-register (decisión de producto pendiente); todo lo listado en restricciones.
