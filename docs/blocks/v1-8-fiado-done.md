# v1.8 · Fiado (venta a crédito) — variante B · DONE

**Rama:** `v1-8-fiado`. Diseño: `docs/design/fiado.md`. Prompt: `docs/code-prompts/bloque-v1-8-fiado.md`.

**Variante B** (decisión Matías 2026-07-02): el fiado vive SOLO en nuestro TPV como
"ticket pendiente" (`ON_CREDIT`) y NO se sincroniza con Holded hasta que se salda. Al
saldarse pasa a `PAID` y se ejecuta el flujo normal completo (create + pay por el total,
fecha = día del saldo). Conmutable a variante A por un único punto (ver §"Punto de
conmutación").

## Estado por frente

| Frente | Estado | Notas |
|--------|--------|-------|
| 1 · Modelo | ✅ | `ON_CREDIT`, `Ticket.creditPending`, `Tenant.creditSalesEnabled`, `TicketPayment.externalId`/`collectedInShiftId`, índice parcial. Migración `20260703010000_v1_8_fiado`. |
| 2 · API | ✅ | checkout fiado (`POST /tickets` `creditSale`), `GET /credits`, `POST /tickets/:id/credit-payments`, `POST /tickets/:id/credit-void`. |
| 4 · Gate | ✅ | `shouldEnqueueHoldedUpload(status)` cableado en los 3 sitios de encolado. |
| 5 · Z / arqueo | ✅ | secciones "Ventas a crédito (no cobradas)" y "Cobros de deuda"; teórico multi-día. |
| 6 · Impresión/PDF | ✅ | leyenda **PENDIENTE DE PAGO** + deudor + importe en térmico y PDF. |
| Admin flag | ✅ | `creditSalesEnabled` en `GET/POST /admin/tenant/settings` + toggle en SettingsPage. |
| 3 · TPV (React) | ✅ | botón Fiado en checkout, pantalla Deudas, badge historial. Flag cacheado vía `/tpv/catalog`. |
| Justificante de cobro | ✅ | `buildCreditPaymentReceipt` + endpoint `POST /tickets/:id/credit-receipt/escpos` + botón "Imprimir recibo" en Deudas. |

### Añadidos de esta sesión (fuera del prompt original)
1. **Migración renombrada** `20260702010000` → `20260703010000_v1_8_fiado`, POSTERIOR a
   `20260703000000_v1_9_archived_from_holded` (v1.9 ya aplicada en producción; el orden
   de migraciones debe respetarse).
2. **Precio unitario neto en ticket** — `build-document.ts` (PDF) ahora imprime
   `unitPriceOverride ?? unitPrice`. Antes imprimía "1 x 5,12 → 4,13" con override
   (unit del catálogo, total con override). El térmico (`tickets/print.ts`) ya lo hacía
   bien; test de regresión cubre ambos (`ticket-net-unit-price.test.ts`).

## Contrato de la API (para Frente 3)

- **Checkout fiado**: `POST /tickets` con `creditSale: true`, `contactHoldedId` obligatorio,
  `payments: []` (un fiado nace sin pago). Errores humanos: `CREDIT_SALES_DISABLED` (flag
  off), `CREDIT_SALE_REQUIRES_CONTACT`, `CREDIT_SALE_WITH_PAYMENTS`. Resultado: ticket
  `ON_CREDIT`, `creditPending = total`. Funciona **offline** vía outbox como cualquier venta.
- **`GET /credits?search=&page=&pageSize=`**: `{ contacts: [{ contactHoldedId, name, balance,
  ticketCount, tickets: [{ id, internalNumber, total, creditPending, createdAt }] }],
  page, pageSize, totalContacts }`. Búsqueda por nombre (BD local). **Online-only** en el TPV.
- **`POST /tickets/:id/credit-payments`**: body `{ externalId (uuid), shiftId, amount, method,
  cashAmount? }`. Idempotente por `externalId` (reintento → 200 `duplicate`). `409 CREDIT_OVERPAY`
  si supera la deuda. Al saldar → `settled:true`, ticket `PAID`, encola upload una sola vez.
- **`POST /tickets/:id/credit-void`**: body `{ authorizationToken, reason }`. Token de
  encargado con `purpose: "credit-void"` (emitido por `POST /admin/auth/manager-authorize`
  con `reason: "credit_void"`). `409 CREDIT_HAS_PAYMENTS` si ya hay cobros parciales.

## Veredicto por consumidor de `TicketStatus` frente a `ON_CREDIT`

| Sitio | Qué hace con `ON_CREDIT` | Correcto |
|-------|--------------------------|----------|
| `tickets/holded-upload-gate.ts` | Devuelve `false` → NO encola. | ✅ el corazón de variante B. |
| `tickets/upload-ticket.ts` | `skipped: on_credit` (blindaje: aunque exista un job, no sube). | ✅ |
| `workers/upload-sweeper.ts` | Busca filas `HoldedUpload` PENDING; un fiado NO tiene fila → nada que rescatar. | ✅ imposible por construcción. |
| `tickets/credit-routes.ts` | Único sitio que consume/transiciona `ON_CREDIT` (cobro/anulación). | ✅ |
| `shift/routes.ts` · `ticketIssues` | Filtra `in [PENDING_SYNC, SYNC_FAILED]` → excluye `ON_CREDIT`. | ✅ un fiado no es incidencia de sync. |
| `shift/routes.ts` · `ticketsCount` | `notIn [DRAFT, VOIDED]` → **incluye** `ON_CREDIT`. | ✅ un fiado ES ticket emitido (entregado). |
| `shift/routes.ts` · desglose Z | `ON_CREDIT` sin `TicketPayment` → 0 a caja; sección propia. | ✅ Frente 5. |
| `admin/tickets-errors.ts` (bandeja) | Opera sobre `SYNC_FAILED`/`SYNCED` → ignora `ON_CREDIT`. | ✅ nunca falló sync (no lo intentó). |
| `admin/gift-receipts.ts` | `in [PAID, PENDING_SYNC, SYNCED]` → excluye `ON_CREDIT`. | ✅ ticket regalo sólo sobre venta cobrada. |
| `tpv-catalog/routes.ts` (purga TEST activación) | Cuenta/borra `TEST`; `ON_CREDIT` no es `TEST`. | ✅ no se purga. |
| `stores/routes.ts` · resumen | `in [PAID, PENDING_SYNC, SYNCED]` → excluye `ON_CREDIT`. | ✅ deuda viva no es venta consolidada. |
| `superadmin/onboarding-health.ts`, `hub.ts`, `tenants.ts` | Cuentan `TEST`/`SYNC_FAILED` → no tocan `ON_CREDIT`. | ✅ |
| `tickets/upload-refund.ts` | Opera sobre refunds `SYNCED`; ajeno a `ON_CREDIT`. | ✅ |

## Punto de conmutación a variante A

Si el asesor obliga a documentar el día de la venta (variante A / A'), el ÚNICO cambio de
lógica es `apps/api/src/tickets/holded-upload-gate.ts`: hacer que
`shouldEnqueueHoldedUpload` devuelva `true` también para `ON_CREDIT`, y que
`upload-ticket.ts` suba con `skipPay` mientras `creditPending > 0` (el `/pay` llegaría al
cobrar, desde `credit-payments`). Ningún otro sitio decide esto. Detalle en la cabecera de
`holded-upload-gate.ts` y en `docs/design/fiado.md §7`.

## Tests (todos verdes)

- `credit-flow.test.ts` (13): checkout fiado (flag/contacto/pagos), `GET /credits`
  (agregado + búsqueda), cobro parcial/total, idempotencia, no-sobrepago, void + 409 parciales + 403 token equivocado.
- `z-breakdown.test.ts` (+4): escenario multi-día día1 fiado / día2 parcial efectivo / día3 resto tarjeta; cobro mixto.
- `ticket-net-unit-price.test.ts` (3): precio neto en térmico y PDF.
- `tenant-isolation.test.ts` (+3): A no cobra/anula/ve la deuda de B.
- `builder.test.ts` (+4, escpos: leyenda + justificante) y `ticket-model.test.ts` (+2).
- `credit-tpv.test.tsx` (5, jsdom): botón Fiado (POST creditSale + guard sin contacto),
  DebtsScreen (lista + cobro), badge del historial.
- Suite completa (API + paquetes + admin + tpv-web): **verde** (889 pass / 3 skip · 101 files).

## Frente 3 · TPV (React) — implementado

- **CheckoutPage** (`CheckoutOverlay`): botón "Fiado" visible sólo con el flag cacheado
  (`getCachedCreditSalesEnabled`) y sólo en venta rápida (no mesa). Sin contacto → error +
  `onRequestAssignContact` (selector existente). POST `/tickets` con `creditSale:true`,
  `payments:[]`. Va por el outbox como cualquier venta (funciona offline).
- **Pantalla "Deudas"** (`DebtsScreen`, overlay desde el header, gated por el flag): lista
  `GET /credits` por cliente, expandible a tickets; Cobrar (importe prellenado editable,
  método CASH/CARD/BIZUM) → `POST /credit-payments`. **Online-only** (banner si `!navigator.onLine`).
  Tras cobrar: panel con saldo + "Imprimir recibo".
- **Historial** (`TicketsHistoryPage`): badge "Fiado" + "pendiente X €" para `ON_CREDIT`
  (`serializeTicket` ahora incluye `creditPending`).
- **Flag al TPV**: `/tpv/catalog` (primera página) devuelve `creditSalesEnabled`; se cachea
  en localStorage (`catalog.ts`).
- **Justificante de cobro**: `buildCreditPaymentReceipt` (escpos-builder) + endpoint
  `POST /tickets/:id/credit-receipt/escpos` (bytes ESC/POS server-side, mismo patrón que
  `/print/escpos`; el TPV lo imprime con `fetchCreditReceiptEscpos` + `printEscposUsb`).
- **Validación visual pendiente**: en modo prueba tras el deploy (no bloqueante). Los tests
  jsdom cubren el contrato; el render físico (impresora, 390px handheld) lo revisa el equipo.

## Carryovers

- **Checkout de mesa fiado**: `POST /tickets/:id/checkout` (B7) NO soporta `creditSale` aún
  (sólo la venta rápida `POST /tickets`). Si Cachictos vende fiado desde mesa, cablear el mismo
  patrón (gate ya sirve; el body de checkout necesita `creditSale` + relajar `payments.minItems`).
- **Void con cobros parciales**: v1 devuelve 409 (hay que reembolsar a mano primero); no
  automatiza la devolución del dinero ya cobrado.
- **Cobros parciales y Holded**: no suben nada a Holded (consecuencia aceptada de variante B,
  diseño §7). Sólo el saldo total dispara la subida.
- **Migración `20260703010000_v1_8_fiado`**: aditiva, sin ventana de mantenimiento. Pendiente
  de aplicar a piloto/producción (la aplica Matías; NO se ha desplegado).
- **Auditoría de anulación**: se guarda en `Ticket.syncError.creditVoid` (sink JSON a nivel
  ticket; un `VOIDED` nunca sincroniza, no colisiona con la bandeja de errores).
