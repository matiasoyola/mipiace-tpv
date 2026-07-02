# Diseño · Fiado (venta a crédito)

**Estado:** DECIDIDO 2026-07-02 — Matías elige **variante B** (§7): fiado local hasta el cobro, sync a Holded al saldarse. Prompt en `docs/code-prompts/bloque-v1-8-fiado.md` (lanzar tras merge de v1.6+v1.7). La reserva fiscal del CTO queda anotada en §7; el gate de subida es conmutable a variante A si el asesor lo exige a posteriori.
**Origen:** pedido de Frutos Secos Cachictos (implantación jun-2026): el cliente se lleva el género y paga otro día; la deuda queda apuntada, consultable y cobrable después (total o parcial).

## 1. Principio rector

Holded es el sistema fiscal ([[posicion-verifactu]], `docs/legal/`). El fiado NO inventa lógica fiscal propia: se apoya en que **nuestro flujo con Holded ya es de dos fases separadas e idempotentes** (verificado en `packages/holded-client/src/salesreceipt.ts`):

1. `createSalesreceiptApproved` — el documento nace aprobado con `paymentsPending == total` (sin cobro).
2. `registerPaymentWithGetBack` — el `POST .../pay` es una llamada posterior independiente, con pre-check GET-back idempotente y tolerancia 0,05 €.

**Fiado = ejecutar la fase 1 en la venta y aplazar la fase 2 hasta el cobro real.** El `paymentsPending` del documento en Holded ES la deuda, contablemente visible para el dueño en su Holded de siempre. Cero campos fiscales nuevos.

## 2. Modelo de datos (local)

- **NO tocar `TicketStatus`**: el enum modela el ciclo de sync, no el de cobro. Un fiado se sube a Holded igual que cualquier venta (PENDING_SYNC → SYNCED).
- `Ticket.creditPending Decimal(12,4)?` — NULL = venta normal; valor = deuda viva de ese ticket. Se decrementa con cada cobro; 0 = saldada (mantener 0, no volver a NULL: histórico de "fue fiado").
- Reutilizar **`TicketPayment`** (ya existe: method CASH/CARD/BIZUM/VOUCHER/OTHER + amount + meta) para los cobros de deuda, añadiendo `collectedAt DateTime` y `collectedBy` (cajero) en `meta` o como columnas si el informe lo pide. La venta fiada nace **sin** TicketPayment.
- **Contacto obligatorio**: un fiado sin deudor no existe. `contactHoldedId` ya existe en Ticket (nullable); la ruta de checkout lo exige si método = fiado. La búsqueda/asociación de contactos ya está resuelta (sync completo v1.x + permiso de asociar contacto).
- Índice `(tenant_id, contact_holded_id) WHERE credit_pending > 0` para el listado de deudas por cliente.

## 3. Flujo de venta (TPV)

1. Checkout → nuevo método **"Fiado"** junto a efectivo/tarjeta. Al elegirlo: selector de contacto obligatorio (si el ticket no lo tiene ya). Gate por flag de tenant `creditSalesEnabled` (default OFF, se activa por tenant en admin).
2. El ticket se cierra y entrega como siempre (imprime/QR/email), con leyenda "PENDIENTE DE PAGO · <contacto>" en ticket térmico y PDF.
3. Upload a Holded: **mismo worker**, misma idempotencia por `externalId`, pero el job lleva `skipPay: true` → no llama a `registerPaymentWithGetBack`. El doc queda SYNCED con `paymentsPending = total` en Holded (aparecerá "Vencido" según sus plazos — es el comportamiento deseado, no un bug).
4. **Offline**: la creación del fiado viaja por el outbox como cualquier venta. El cobro de deuda (§4) requiere online (consulta saldo server-side) — restricción aceptable v1.

## 4. Flujo de cobro de deuda

1. TPV → pantalla **"Deudas"** (acceso desde menú): lista por cliente con saldo agregado y detalle de tickets fiados; búsqueda por nombre.
2. Acción "Cobrar": total o parcial, método efectivo/tarjeta/bizum. Crea `TicketPayment`, decrementa `creditPending` (transacción, con guardia de no-sobrepago) y encola job `credit-pay` → `POST .../pay` con `amount` parcial. Validación GET-back: `paymentsPending esperado = total − Σ cobros` (tolerancia 0,05, patrón existente [[project_holded_pay_tolerance]]).
3. **El cobro entra en el arqueo del día en que se cobra**, no en el de la venta (§5).
4. Reimprimir justificante de cobro (recibo simple, no fiscal: el doc fiscal es el original).

## 5. Turnos y arqueo Z

- La venta fiada **NO suma** a efectivo/tarjeta del turno (no entró dinero). Aparece en el Z como sección propia "Ventas a crédito" (nº + importe).
- El cobro de deuda **SÍ suma** al método correspondiente del turno donde ocurre, en sección "Cobros de deuda". El teórico de caja cuadra en ambos días.
- El cierre de turno NO se bloquea por deudas vivas (son multi-día por naturaleza).

## 6. Piezas que hay que auditar/ajustar (para el prompt)

- **Conciliación diaria** (v1.5-B): valida documentos subidos; hay que enseñarle que un doc con `creditPending > 0` local tiene `paymentsPending` legítimo en Holded — excluir de la alerta de mismatch (comparar contra deuda esperada, no contra 0).
- **Devolución de un fiado**: v1 solo permite refund de la parte YA cobrada; si deuda íntegra sin cobrar → "anular fiado" = anular doc en Holded (patrón remediación 000022) + `creditPending = 0` + motivo auditado. NO mezclar con el flujo de refunds normal.
- **Sweeper / uploads**: `skipPay` no debe confundir al upload-sweeper ni dejar el job en estados raros — revisar enum de HoldedUpload.
- **Suite de aislamiento v1.5-D**: añadir los endpoints nuevos (deudas por contacto, cobrar) a la tabla parametrizada multi-tenant.
- **Permisos**: cobrar deuda = cualquier cajero; anular fiado = PIN encargado (patrón discount-override existente).

## 7. ⚠️ Decisión fiscal pendiente (asesor) — BLOQUEANTE

Hay TRES mapeos posibles; la elección es del asesor, no nuestra. Las tres comparten la misma capa local (§2-§5: `creditPending`, TicketPayment, pantalla Deudas, Z desglosado); solo cambia QUÉ y CUÁNDO se sube a Holded:

- **Variante A (doc al vender, pay al cobrar)** — la de §1-§3: salesreceipt aprobado el día de la entrega con `paymentsPending = total`; el pay llega al cobrar. Devengo documentado el día de la entrega.
- **Variante A' (invoice)** — igual que A pero con factura nominativa (`/invoicing/v1/documents/invoice`, contacto con NIF) si el asesor dice que el aplazamiento no cabe en ticket simplificado. Holded-client: parametrizar path de documento.
- **Variante B (propuesta Matías: nada en Holded hasta el cobro)** — el fiado vive SOLO local (deuda apuntada, ticket sin sync); al cobrar se ejecuta el flujo normal completo (create+pay) con fecha del cobro. Analogía cheque regalo: no se fiscaliza hasta el canje. **Ingeniería: la más simple de las tres** (cero cambios en holded-client ni en conciliación; solo un gate en el encolado del upload). **Reserva del CTO**: en el cheque regalo no hay entrega de bien al venderlo — en el fiado sí, y el devengo del IVA acompaña a la entrega, no al cobro. Si el asesor la valida (p. ej. como operación asimilable o por criterio de caja del tenant), adelante; si no, A o A'.

**Preguntas para el asesor** (llevar las dos):
1. ¿Puede documentarse la venta fiada en el momento del cobro en vez de en el de la entrega (variante B), o el devengo por entrega obliga a documentar el día uno?
2. Si hay que documentar el día uno: ¿vale ticket simplificado con pago pendiente (A) o exige factura nominativa (A')?

Hasta esa respuesta, este doc NO se convierte en prompt.

## 8. Tamaño estimado

Un bloque Code grande (tipo B6/B7): migración + API (checkout fiado, deudas, cobrar, anular) + worker `skipPay`/`credit-pay` + TPV (método fiado, pantalla Deudas, leyendas ticket) + Z desglosado + conciliación + tests (incl. aislamiento). ~4-5 días Code. Divisible en 2 si hace falta: (a) backend+worker, (b) TPV+Z.
