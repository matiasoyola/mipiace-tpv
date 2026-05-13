# Prompt para Claude Code — Bloque 4

Pega esto en una sesión nueva de Claude Code una vez B3 esté
validado y mergeado en GitHub.

---

Hola Code. Arrancamos B4 — el bloque grande del flujo de venta.

## Contexto

B1 (multi-tenant + onboarding + sync inicial), B2 (sync incremental +
contactos + Mi cuenta + bandeja SKU), B3 (emparejamiento + PIN + turno
+ seguridad + password recovery) están commiteados y pusheados. Lee
primero, en este orden:

- `docs/blocks/B1-done.md`, `docs/blocks/B2-done.md`, `docs/blocks/B3-done.md`
  — memoria persistente de los bloques previos.
- `docs/07-nucleo-comun.md` §6 (venta), §7 (cobro), §8 (impresión), §10
  (devoluciones), §11 (ticket regalo), §14 (buscar tickets pasados).
- `docs/04-stack-y-decisiones.md` ADR-010 (GET-back tras escritura),
  ADR-005 (BullMQ), ADR-008 (Holded como emisor fiscal).
- `docs/03-integracion-holded.md` — payload definitivo del
  `salesreceipt` y endpoint `/pay`.
- `docs/design/tokens.md` — contrato visual.
- **`docs/design/reference-app.tsx` — las dos pantallas grandes de
  este bloque ya están diseñadas: venta rápida (pantalla 4) y cobro
  (pantalla 7). Copia patrones literales.**
- `packages/holded-client/src/salesreceipt.ts` — cliente ya
  implementado en B1 (`createSalesreceiptApproved`,
  `registerPaymentWithGetBack`, `getReceiptPdf`).

Antes de tocar código, **resume lo que entiendes** y plantéa
discrepancias o dudas. No empieces hasta que tengas luz verde.

## Bloque 4 · Flujo de venta end-to-end (retail / cafetería simple)

### Resumen del alcance

Seis frentes en orden de dependencia. **El primero es bloqueante** —
sin él el resto no se puede validar end-to-end (lo descubrimos al
intentar validar B3: no había forma de generar códigos de pairing
porque no existía ninguna caja en el sistema).

0. **Gestión de Tiendas y Cajas desde admin** — pantalla nueva
   `/admin/stores`. Crear/editar/eliminar tiendas, dar de alta cajas
   por tienda. Activa el ítem "Tiendas" del sidebar (hoy grisado).
   Sin esto los demás frentes son inútiles.
1. **Modelo de ticket en BD + worker de upload a Holded** — el
   backbone. Sin esto, las pantallas no tienen dónde escribir.
2. **PWA pantalla de venta rápida** — botonera, búsqueda, carrito,
   modificaciones.
3. **PWA pantalla de cobro** — calculadora, métodos, confirmación.
4. **PWA buscar tickets pasados + reimprimir + reenviar email**.
5. **Devoluciones** (ticket de abono) y **ticket regalo** (sólo
   cliente).

Fuera de B4 (explícito): impresión real ESC/POS (es B5), bar/mesas
(es B6), conversión ticket→factura (v2), location lock (v2).

### 0. Gestión de Tiendas y Cajas (admin)

**Por qué bloqueante:** B1+B2+B3 crearon todas las piezas técnicas
para que el TPV funcione, pero ningún flujo de usuario crea Stores ni
Registers. El propietario sólo puede vender si tiene al menos una
tienda con al menos una caja. Hasta ahora se asumía implícitamente
que esto venía con el sync inicial, pero el sync inicial sólo trae
catálogo (productos, servicios, warehouses, taxes). **Las cajas
lógicas son decisión del propietario** (cuántas, qué `numSerie`
Holded asignar a cada una, etc.), no de Holded.

#### 0.1 Modelos (ya existen en schema desde B1, refrescar)

- `Store`: `id`, `tenantId`, `name`, `fiscalAddress` (Json),
  `warehouseHoldedId`, `createdAt`. Una tienda agrupa cajas y se
  asocia a UN almacén Holded (el stock se descuenta de ahí).
- `Register`: `id`, `storeId`, `name`, `numSerieHolded` (nullable),
  `ticketCounter` (Int, default 0), `printerConfig` (Json, nullable).
  Una caja lógica dentro de la tienda. Es lo que se empareja a
  dispositivos físicos.

No requiere migración nueva — el schema ya las tiene.

#### 0.2 Backend endpoints

Todos `requireOwner` (los managers operan, no configuran):

- **`GET /admin/stores`** — lista las tiendas del tenant con conteo
  de cajas, devices emparejados activos y ventas del último mes
  (mock 0 si todavía no hay tickets).
- **`POST /admin/stores`** — body `{ name, warehouseHoldedId,
  fiscalAddress? }`. Valida que `warehouseHoldedId` existe en
  `Warehouse` del tenant.
- **`PATCH /admin/stores/:id`** — edita `name`, `warehouseHoldedId`,
  `fiscalAddress`. **No permite cambiar `warehouseHoldedId` si la
  tienda tiene tickets** (rompería el histórico de stock).
- **`DELETE /admin/stores/:id`** — sólo si la tienda no tiene cajas
  activas. Soft-delete: marca `deletedAt`, preserva FKs históricos.
- **`POST /admin/stores/:storeId/registers`** — body `{ name,
  numSerieHolded? }`. Crea una caja lógica. `numSerieHolded` es
  opcional en MVP; sin él, Holded asignará la serie por defecto.
- **`PATCH /admin/registers/:id`** — edita `name`, `numSerieHolded`,
  `printerConfig`.
- **`DELETE /admin/registers/:id`** — sólo si no tiene devices
  emparejados activos ni tickets. Soft-delete.

#### 0.3 UI admin

Pantalla `/admin/stores` con dos vistas:

**Vista lista de tiendas** (entrada por defecto):
- Tabla con columnas: Nombre, Almacén Holded (mostrar nombre del
  warehouse), Nº cajas, Nº dispositivos activos, Acciones.
- Botón "+ Nueva tienda" arriba derecha → modal con form:
  - Nombre (text).
  - Almacén Holded (select alimentado por `GET /admin/warehouses` —
    endpoint nuevo que devuelve la tabla `Warehouse` del tenant).
  - Dirección fiscal (opcional, form con calle/cp/ciudad/provincia/
    país; en MVP esto puede heredar de `tenant.fiscalProfile`).
- Click en una fila → entra a "Vista detalle de tienda".

**Vista detalle de tienda**:
- Header con nombre + breadcrumb (← Tiendas).
- Sección "Cajas": tabla con Nombre, NumSerie Holded, Nº devices
  emparejados, Última venta. Botón "+ Nueva caja".
- Sección "Datos fiscales de la tienda" si difieren del tenant
  (editable inline).
- Botón "Eliminar tienda" abajo (con confirmación si no tiene cajas).

**Modal "Nueva caja"**:
- Nombre (default sugerido: "Caja N+1" según `ticketCounter` del
  store).
- NumSerie Holded (opcional, dropdown con las series que Holded
  tenga, vacío permitido).

#### 0.4 Integración con DevicesPage (B3)

`/admin/devices` hoy mira el listado de devices para inferir
registers. **Cambiar para que use el listado real**: al pulsar
"Generar código", el dropdown de cajas se alimenta vía
`GET /admin/stores` → expandir registers de cada tienda. Si todavía
no hay ninguna tienda, mostrar mensaje y link directo a
`/admin/stores/new`.

#### 0.5 Validación E2E (la que no pudimos hacer en B3)

Cuando este frente esté hecho, debería ser posible:

1. `/admin/stores` → "+ Nueva tienda" → "Tienda principal" con el
   almacén default.
2. Dentro de "Tienda principal" → "+ Nueva caja" → "Caja 1".
3. `/admin/devices` → "Generar código" → seleccionar "Caja 1" del
   dropdown → código de 6 dígitos.
4. PWA `localhost:5174` → pegar código → emparejado.
5. PIN cajero → entrar.
6. Apertura de turno con fondo inicial.
7. Pantalla de venta (frente 2 de B4) y resto del flujo.

### 1. Modelo de ticket end-to-end

#### 1.1 Schema (migración `b4_ticket_lifecycle`)

Refresca el schema de B1 que ya tenía `Ticket`, `TicketLine`,
`TicketPayment`, `HoldedUpload`. Si falta alguna columna del modelo
funcional, añádela. Esperado tras la migración:

```prisma
model Ticket {
  id                String        @id @default(uuid()) @db.Uuid
  tenantId          String        @map("tenant_id") @db.Uuid
  registerId        String        @map("register_id") @db.Uuid
  shiftId           String        @map("shift_id") @db.Uuid
  userId            String        @map("user_id") @db.Uuid          // cajero
  internalNumber    String        @map("internal_number")           // correlativo del TPV
  externalId        String        @unique @map("external_id") @db.Uuid // idempotency key
  contactHoldedId   String?       @map("contact_holded_id")
  status            TicketStatus  @default(PAID)
  total             Decimal       @db.Decimal(10, 2)
  totalTax          Decimal       @map("total_tax") @db.Decimal(10, 2)
  totalDiscount     Decimal       @map("total_discount") @db.Decimal(10, 2)
  holdedDocumentId  String?       @map("holded_document_id")
  holdedDocNumber   String?       @map("holded_doc_number")          // numeración fiscal
  holdedPdfUrl      String?       @map("holded_pdf_url")
  syncError         Json?         @map("sync_error")
  notes             String?
  createdAt         DateTime      @default(now()) @map("created_at") @db.Timestamptz()
  paidAt            DateTime?     @map("paid_at") @db.Timestamptz()
  syncedAt          DateTime?     @map("synced_at") @db.Timestamptz()

  tenant   Tenant         @relation(...)
  register Register       @relation(...)
  shift    Shift          @relation(...)
  user     User           @relation(...)
  lines    TicketLine[]
  payments TicketPayment[]
  refunds  Refund[]

  @@index([tenantId, status])
  @@index([tenantId, registerId, createdAt])
  @@map("tickets")
}

enum TicketStatus {
  DRAFT
  PAID
  PENDING_SYNC
  SYNCED
  SYNC_FAILED
  VOIDED
}
```

Más TicketLine, TicketPayment, Refund, RefundLine según
`docs/06-modelo-datos.md` (ya estaba bocetado en B1).

#### 1.2 Endpoint `POST /tickets`

`requireCashier` middleware (extensión del `requireDeviceSession` que
B3 montó para el cajero). Body:

```ts
{
  externalId: string,            // UUID v4 generado por la PWA AL COBRAR
  registerId: string,
  shiftId: string,
  lines: Array<{
    productId?: string,          // null si es línea libre
    variantId?: string,
    nameSnapshot: string,        // copia del nombre en este momento
    units: number,
    unitPrice: number,
    discountPct: number,
    taxRate: number,
    sku: string,                 // canónico para Holded
    modifiers?: string[]         // sólo cliente, NO se envía a Holded
  }>,
  payments: Array<{
    method: "CASH" | "CARD" | "BIZUM" | "VOUCHER" | "OTHER",
    amount: number,
    meta?: Record<string, unknown>
  }>,
  contactHoldedId?: string,
  notes?: string,
  cashAmount?: number              // efectivo recibido (para cálculo de cambio en histórico)
}
```

Validaciones:

- `externalId` debe ser UUID v4 nuevo. Si ya existe en
  `holded_uploads` o `tickets`, devuelve **409 con el ticket
  existente** (idempotencia client-side).
- `Σ payments.amount === total` con tolerancia 0.01 €.
- `total === Σ(unitPrice × units × (1 - discountPct/100) × (1 + taxRate/100))`
  con tolerancia 0.05 €. Servidor recalcula y rechaza si discrepa
  con el ticket enviado.
- Todas las líneas con `sku` no vacío (validado contra catálogo local
  o producto comodín `TPV-OTROS-{IVA}`).

Acción al recibir:

1. Persiste `Ticket`, `TicketLine[]`, `TicketPayment[]` con
   `status = PENDING_SYNC`.
2. Inserta fila en `HoldedUpload` con
   `(externalId, tenantId, kind: 'TICKET', status: 'PENDING')`.
3. Encola job BullMQ `upload-ticket-{externalId}` (idempotente, jobId
   determinista).
4. Devuelve `201` con el ticket persistido y `syncStatus: PENDING_SYNC`.

#### 1.3 Worker `upload-ticket-worker.ts`

Concurrency 2-4 por proceso. Por cada job:

1. Lee el `Ticket` por `externalId`.
2. Carga API Key descifrada del tenant.
3. Construye payload `salesreceipt` (§3.5 del doc Holded):
   - `approveDoc: true`
   - `notes: "TPV-uuid: <externalId>"`
   - `items[]` con `name`, `units`, `price`, `tax`, `discount`, `sku`
   - `date`, `contactId` si hay
4. POST a `/invoicing/v1/documents/salesreceipt` vía
   `createSalesreceiptApproved` del cliente Holded.
5. **GET-back** (ADR-010): valida `docNumber != null`,
   `total ≈ esperado`, `notes` contiene `externalId`, `draft != true`.
   Si falla: `HoldedSilentRejectError` → `Ticket.status = SYNC_FAILED`,
   `HoldedUpload.status = FAILED` con last_error.
6. Si éxito, POST `/pay` con los métodos (un único `/pay` con suma
   total — Holded no acepta varios pagos en MVP sin más
   complejidad). GET-back valida `paymentsPending == 0`. Si falla,
   marca SYNC_FAILED.
7. Si todo OK: `Ticket.status = SYNCED`, guarda `holdedDocumentId`,
   `holdedDocNumber`, `syncedAt`, marca `HoldedUpload.status = DONE`.
8. Errores transitorios (5xx, ECONNRESET) → reintento exponencial
   (BullMQ `attempts: 5, backoff: { type: 'exponential', delay: 30000 }`).

Logging exhaustivo pero sin secretos.

#### 1.4 Endpoint `GET /tickets/:id`

Devuelve ticket con líneas, pagos, estado de sync. Sólo el cajero del
mismo tenant. Polling desde la PWA tras cobrar para ver cuándo pasa a
`SYNCED`.

#### 1.5 Endpoint `GET /tickets` (búsqueda)

Query: `q` (número interno o externo), `from`, `to`, `status`,
`registerId`, `shiftId`. Paginación cursor-based o offset simple.
Usado por la pantalla §4.

### 2. PWA pantalla de venta rápida

Aplica `apps/tpv-web/src/pages/SalePage.tsx` siguiendo literal el
mockup pantalla 4 de `docs/design/reference-app.tsx`. Tokens
`mipiace.*` (B3 ya instaló Tailwind en `apps/tpv-web`).

#### 2.1 Estructura

- **Sidebar 240px (xl) / 88px (md) / oculto (sm)** — los 6 ítems
  (Venta activo, Productos, Clientes, Informes, Caja, Ajustes; resto
  según permisos).
- **Topbar** con búsqueda centrada (Cmd+K), botón Mesa 7 (oculto en
  retail, sólo aparece si tenant tiene bar habilitado — feature flag
  por ahora siempre off en B4), botón "+", bell, avatar.
- **Workspace 2-col**: izquierda categorías + grid productos
  + quick actions, derecha ticket panel.
- **Status bar** abajo con caja abierta + turno + datetime + wifi.

#### 2.2 Funcionalidad de la pantalla

Datos:

- **Catálogo** servido desde IndexedDB (B3 ya cacheó? si no, B4 hace
  el primer cacheo al login del cajero — GET /products del tenant).
- **Top productos** configurables por tienda (B4 sólo lee el orden
  del catálogo Holded por defecto; la edición de "favoritos
  configurables por tenant" llega en B5 si el cliente lo pide).
- **Categorías**: derivadas de `product.categoryId` de Holded
  (cachea las etiquetas).

Acciones:

- **Añadir línea** por click en producto, por barcode (input
  enfocado de fondo, lector USB-HID dispara `Enter`), o por búsqueda
  fuzzy en input central.
- **Modificar línea**: tap línea → bottom sheet con cantidad ±,
  descuento % o importe, eliminar.
- **Variantes obligatorias**: si producto tiene variantes, al añadirlo
  abre selector inline (modal o sheet) antes de meterlo al carrito.
- **Modificadores** (definidos en `product.modifiers[]`, schema mini
  en B4): aparecen como chips clickables justo bajo la línea recién
  añadida durante 3 segundos (visual feedback opcional). Se guardan
  en `ticket_line.modifiers` jsonb. **NO se envían a Holded.**
- **Descuento global**: bottom sheet con % o importe. Con permiso
  según `umbral`.
- **Suspender venta** (parking): guarda el carrito local con
  etiqueta libre, libera la pantalla para otro cliente, recuperable
  desde un dropdown "Ventas suspendidas".
- **Cancelar venta**: confirmación + motivo, vacía el carrito.
- **Notas de venta**: input para añadir texto al ticket (imprime en
  el ticket y va a `notes` de Holded después del `TPV-uuid:`).

#### 2.3 Cliente asociado

Hereda B2 (`/contacts/search` y `/contacts` para crear). Botón
"Cliente" en quick actions abre sheet con:
- Buscador (que tira del endpoint local + Holded fallback).
- Botón "+ Crear contacto" abre form mini (nombre, NIF, email,
  teléfono) → POST /contacts.
- El contacto se asocia al ticket en `ticket.contactHoldedId`.

#### 2.4 Estados visuales

- Banner ámbar **"Sincronizando…"** si hay tickets `PENDING_SYNC`.
- Banner rojo **"Sin conexión"** si la PWA detecta offline (Network
  Information API).
- Tras cobrar, modal con icono check verde + número fiscal Holded
  cuando llegue (polling al endpoint `GET /tickets/:id`).

### 3. PWA pantalla de cobro

`apps/tpv-web/src/pages/CheckoutPage.tsx` siguiendo literal pantalla
7 del reference.

#### 3.1 Flujo

1. Cajero pulsa "Cobrar 7,50 €" en pantalla de venta.
2. Se abre la pantalla de cobro como overlay full-screen con fondo
   `bg-mipiace-ink/95`.
3. Total grande arriba a la izquierda.
4. Selector de método de pago (4 opciones: efectivo, tarjeta, Bizum,
   vale). Activo en coral, resto en blanco con borde.
5. Si **efectivo**: muestra calculadora — input grande con importe
   recibido + quick keys (+5, +10, +20, +50, justo, 100, otro, C),
   cambio destacado a la derecha en 52px coral.
6. Si **tarjeta / Bizum / vale**: confirmación directa con campo
   opcional para referencia (últimos 4 de tarjeta, ID Bizum, etc.).
7. **Mixto**: botón "Añadir otro método" añade una segunda fila de
   pago. El total se distribuye entre filas.
8. Resumen a la derecha con subtotal, descuento, IVA, total a cobrar,
   recibido, cambio.
9. Checkboxes:
   - ☑ Imprimir ticket (default ON, pero en B4 sólo guarda intent —
     B5 hará la impresión real).
   - ☐ Enviar por email (si el contacto tiene email, lo prerellena).
   - ☐ Ticket regalo (genera segundo ticket ESC/POS sin precios —
     pendiente B5).
10. Botón "Confirmar cobro" → POST /tickets → modal éxito con
    número interno + spinner "Sincronizando con Holded…" → al cambiar
    a SYNCED muestra número fiscal.

#### 3.2 Persistencia local antes del POST

La PWA escribe el ticket en IndexedDB **antes** del POST. Si el POST
falla (red caída, 5xx), retiene el ticket en cola local y reintenta
en background. Si red OK pero servidor devuelve 4xx (validación),
muestra error al cajero (raro porque la PWA valida también).

#### 3.3 Atajos teclado

- `Enter` confirma cobro si el importe recibido cubre el total.
- `Esc` cancela y vuelve a venta.
- Teclado numérico controla el importe recibido.

### 4. PWA buscar tickets pasados

`apps/tpv-web/src/pages/TicketsHistoryPage.tsx`.

Filtros: número interno, número fiscal, importe, rango de fechas,
estado de sync, cajero, método de pago. Lista paginada con badges
de estado (`SYNCED` verde, `PENDING_SYNC` ámbar, `SYNC_FAILED` rojo
con tooltip de error).

Acciones por ticket:
- **Reimprimir** (en B4 sólo muestra modal con preview; impresión
  real en B5).
- **Reenviar por email** (POST /tickets/:id/resend-email — endpoint
  nuevo, encola job que descarga PDF de Holded si está SYNCED, lo
  manda al email del contacto o al que escriba el cajero).
- **Iniciar devolución** → §5.
- **Ver detalle** (drawer lateral o página propia).
- **Abrir en Holded** (deep link si `holdedDocumentId` está poblado).

### 5. Devoluciones y ticket regalo

#### 5.1 Devolución

Pantalla `RefundPage.tsx` al pulsar "Iniciar devolución" desde un
ticket SYNCED:

1. Lista las líneas del ticket original con stepper de cantidad
   (max = cantidad original).
2. Selector de método de reembolso (mismo del original por defecto,
   pero el cajero puede cambiar — efectivo o vale).
3. Botón "Confirmar devolución" → crea `Refund` en BD con líneas
   negativas, encola job `upload-refund-worker` que crea un
   `salesreceipt` en Holded **con importes en negativo** y `notes`
   referenciando el original. Mismo flujo GET-back que tickets.
4. Stock se repone (informativo, lo dicta Holded al procesar).

#### 5.2 Ticket regalo

Sólo aplica a tickets `SYNCED`. Botón "Imprimir ticket regalo" en la
vista de detalle de un ticket. En B4 sólo guarda intent en BD
(`ticket.giftReceiptIntent: boolean` o un campo timestamp). B5 hará
la impresión real ESC/POS — un segundo ticket con líneas sin precios,
texto "Ticket regalo · válido N días", mismo número que el original.

**No se envía a Holded** (decisión núcleo §11).

### 6. Restricciones

- **No regresiones en B1+B2+B3.** Todos los tests previos siguen
  verdes.
- **No tocar impresión real ni hardware ESC/POS.** Eso es B5.
- **No tocar bar/mesas/websockets.** Eso es B6.
- **TypeScript estricto, JSON Schema en body, NUNCA loguear precios
  de tarjeta, NIFs ni datos sensibles del contacto.**
- **Tickets ya `PAID` localmente nunca se borran**, ni siquiera si
  la sync a Holded falla — quedan en `SYNC_FAILED` y se gestionan
  desde la bandeja de errores del encargado (UI mínima en B4, full
  bandeja en B5+).
- **Migraciones Prisma versionadas.**

### 7. Tests

- **Modelo de ticket**: creación con validación de totales, rechazo
  por `externalId` duplicado, idempotencia.
- **Worker upload-ticket**: happy path (POST + GET-back + /pay + GET-back),
  silent reject (mismatches en GET-back → SYNC_FAILED), error
  transitorio (reintento), error permanente (4xx → SYNC_FAILED sin
  reintento).
- **PWA venta**: añadir línea, modificar, eliminar, descuento, suspender,
  cancelar. Tests con `vitest` + `@testing-library/react`.
- **PWA cobro**: cálculo de cambio, métodos múltiples, validación
  total = Σ payments.
- **Búsqueda tickets**: filtros, paginación, deep link a Holded.
- **Devolución**: refund parcial, refund total, validación de
  cantidades.

### 8. Entregables

1. PR único con todo B4.
2. Commit messages descriptivos.
3. `.env.example` actualizado si hay variables nuevas.
4. `docs/blocks/B4-done.md` con mismo formato que B1/B2/B3-done:
   estructura, hecho, fuera, decisiones tomadas sin preguntar, dudas
   para B5.

### 9. Lo que NO entra en B4

- **Impresión real ESC/POS** (print agent, instalador) → **B5**.
- **Bar: mesas, mapa de sala, agrupar mesas, multi-terminal con
  websockets, barra como array de mini-mesas** → **B6**.
- **Conversión ticket → factura** vía API Holded → v2 (decisión
  núcleo §12).
- **Customer-facing display** (pantalla compañera al cliente) → v2.

Cuando termines B4 y Matías lo revise, te paso el prompt de B5
(impresión ESC/POS).
