# Bloque v1.8 · Fiado (venta a crédito) — variante B: local hasta el cobro

**Rama:** `v1-8-fiado` (worktree nuevo, NO sobre master directo)
**⚠️ NO lanzar hasta que v1-6-precio-sobre-total y v1-7-alias-cajeros estén MERGEADOS en master** — este bloque toca checkout, SalePage y arqueo Z, y chocaría con ambos.
**Origen:** pedido de Frutos Secos Cachictos. Diseño completo en `docs/design/fiado.md` — léelo ENTERO antes de empezar. Decisión de producto (Matías, 2026-07-02): **variante B** — el fiado vive solo en nuestro TPV como "ticket pendiente" y **no se sincroniza con Holded hasta que se salda**; al saldarse se ejecuta el flujo normal completo (create + pay). Analogía operativa: cheque regalo (no se fiscaliza hasta el canje). La reserva fiscal del CTO y las preguntas al asesor quedan documentadas en el doc de diseño §7 — NO son asunto de este bloque, pero el gate de subida debe quedar **aislado y conmutable** por si el asesor obliga a pasar a la variante A (doc al vender): un único punto del código debe decidir "¿este ticket se encola a Holded ya o no?".

---

## Frontera de archivos

- `packages/db/prisma/schema.prisma` + **una** migración aditiva (`v1_8_fiado`).
- `apps/api/src/tickets/**` (checkout fiado, endpoints deuda, upload gate), `apps/api/src/shifts/**` (arqueo Z), `apps/api/src/workers/**` y `apps/api/src/queues/**` (solo el gate de encolado — el worker de upload NO cambia de lógica interna).
- `apps/tpv-web/src/**` (checkout, nueva pantalla Deudas, leyendas).
- `packages/escpos-builder/src/ticket.ts` + `packages/ticket-pdf/src/render.ts` (leyenda PENDIENTE DE PAGO).
- `apps/admin/src/**` (flag `creditSalesEnabled` en SettingsPage).
- Tests de todo lo anterior + `docs/blocks/v1-8-fiado-done.md`.

**NO toques:** `packages/holded-client/**` (la gracia de la variante B es que NO necesita cambios ahí), `apps/tpv-android/**`, `infra/**`, conciliación diaria (tampoco necesita cambios: el doc solo existe en Holded una vez pagado).

---

## Frente 1 — Modelo

- `TicketStatus`: nuevo valor **`ON_CREDIT`** (entregado, deuda viva, NO sincronizable). Transiciones: `DRAFT → ON_CREDIT` (checkout fiado) y `ON_CREDIT → PAID → PENDING_SYNC → SYNCED` (al saldarse; desde ahí el ciclo existente intacto). Audita TODOS los sitios que hagan switch/filtro por status (worker upload, sweeper, refunds, informes, historial, bandeja errores, purga TEST de activación) y decide explícitamente qué hace cada uno con `ON_CREDIT` — lista el veredicto por sitio en el done.md.
- `Ticket.creditPending Decimal(12,4)?` — NULL = venta normal; >0 = deuda viva; 0 = fiado saldado (histórico). `Ticket.creditContactRequired`: NO — se usa `contactHoldedId` existente, **obligatorio** para fiado (validación en ruta).
- Cobros de deuda = **`TicketPayment`** existente (method CASH/CARD/BIZUM/VOUCHER/OTHER), añadiendo en `meta` `{ collectedAt, collectedBy }`. La venta fiada nace sin TicketPayment.
- `Tenant.creditSalesEnabled Boolean @default(false)`.
- Índice parcial `(tenant_id, contact_holded_id) WHERE credit_pending > 0`.

## Frente 2 — API

- **Checkout fiado**: en el endpoint de cobro existente, método `CREDIT` → exige `creditSalesEnabled` + `contactHoldedId` en el ticket (400 humano si falta). Ticket queda `ON_CREDIT`, `creditPending = total`, `internalNumber` asignado como en cualquier cobro. **NO se encola HoldedUpload** (el gate del Frente 4).
- **`GET /credits`** (sesión cajero): deudas agregadas por contacto (nombre, saldo, nº tickets) + detalle por ticket. Paginado, búsqueda por nombre de contacto (datos locales, sin llamar a Holded).
- **`POST /tickets/:id/credit-payments`**: body `{ amount, method, cashAmount? }`. Transacción: crea TicketPayment, decrementa `creditPending` con guardia de no-sobrepago (409) e **idempotencia por `externalId`** del cobro (patrón outbox existente). Si `creditPending` llega a 0 → status `PAID` + encolar upload Holded normal (create + pay por el total, fecha = día del saldo). Los cobros parciales NO suben nada a Holded (consecuencia aceptada de la variante B, documentada en diseño §7).
- **`POST /tickets/:id/credit-void`**: anular fiado no saldado — PIN encargado (patrón manager-auth discount-override), motivo obligatorio, `creditPending = 0`, status `VOIDED`. Sin acción Holded (nunca se subió). Si tiene cobros parciales → 409 (primero devolver el dinero cobrado: v1 no automatiza ese caso, mensaje claro).
- **Suite de aislamiento multi-tenant (v1.5-D)**: añade los 3 endpoints nuevos a la tabla parametrizada.

## Frente 3 — TPV

- CheckoutPage: botón "Fiado" (visible solo con flag). Si el ticket no tiene contacto → selector de contacto inline (búsqueda local existente) antes de confirmar. Confirmación con nombre del deudor bien visible.
- Pantalla **"Deudas"** (ruta nueva, acceso desde menú): lista por cliente con saldo, expandible a tickets; acción Cobrar (total prellenado, editable para parcial) con selector de método; feedback de saldo restante. **Online-only**: sin red, la pantalla muestra aviso y no permite cobrar (el checkout fiado SÍ funciona offline vía outbox como cualquier venta).
- Historial: los `ON_CREDIT` visibles con badge "FIADO · pendiente X €".

## Frente 4 — Gate de subida (el corazón conmutable)

Un único helper (p. ej. `shouldEnqueueHoldedUpload(ticket)`) usado por checkout y por cualquier camino que encole uploads: `ON_CREDIT` → no encolar; `PAID` (incluido el que viene de saldar un fiado) → encolar normal. El sweeper NO debe rescatar `ON_CREDIT` (no hay HoldedUpload que rescatar, pero blindalo con test). Documenta en el done.md el punto exacto donde se cambiaría a variante A si el asesor lo exige.

## Frente 5 — Turnos y arqueo Z

- Venta fiada: NO suma a efectivo/tarjeta del turno. Sección propia en el Z: "Ventas a crédito (no cobradas)" con nº e importe.
- Cobro de deuda: SÍ suma al método correspondiente del turno en que ocurre, en sección "Cobros de deuda". El teórico de caja debe cuadrar en ambos días — tests con el escenario completo (día 1 fiado, día 2 cobro parcial efectivo, día 3 resto tarjeta).
- Cierre de turno NO se bloquea por deudas vivas.

## Frente 6 — Impresión y PDF

Ticket térmico y PDF del fiado: leyenda destacada **"PENDIENTE DE PAGO"** + nombre del deudor + importe adeudado. NO es documento fiscal (no lleva numeración Holded — no puede, no existe aún); que el layout no engañe. Al saldarse, el reimprimir del historial saca el ticket normal ya con numeración Holded cuando llegue. Justificante de cobro de deuda: recibo simple no fiscal (fecha, deudor, importe, saldo restante).

---

## Cierre

- Suite completa verde + `tsc` limpio. Tests clave: transiciones de status, no-sobrepago, idempotencia del cobro, gate de upload (ON_CREDIT jamás encola; saldado encola una sola vez), Z multi-día, aislamiento multi-tenant, flag OFF oculta todo.
- `docs/blocks/v1-8-fiado-done.md` con: tabla de veredictos por consumidor de TicketStatus, punto de conmutación a variante A, carryovers.
- Migración aditiva; sin ventana de mantenimiento. NO mergees ni despliegues — lo hace Matías.
