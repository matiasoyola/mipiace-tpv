# Bloque 4 · resumen del entregable

Estado: cerrado pendiente de revisión por Matías.

## Estructura del repo tras B4

```
.
├─ apps/
│  ├─ api/                     # + stores/, tickets/, tpv-catalog/
│  │                           # + tickets/{routes,totals,upload-ticket,upload-refund,send-ticket-email}
│  │                           # + queues/{ticket-upload,refund-upload,ticket-email}
│  │                           # + workers/{ticket-upload-worker,refund-upload-worker,ticket-email-worker}
│  │                           # auth/middleware ampliado con requireOwnerOrCashier
│  │                           # shift/routes calcula teóricos desde ticket_payments
│  ├─ admin/                   # + pages/StoresPage (lista + detalle)
│  │                           # sidebar activa Tiendas; DevicesPage usa /admin/registers real
│  ├─ tpv-web/                 # + pages/{SalePage,CheckoutPage,TicketsHistoryPage,RefundPage}
│  │                           # + pages/{CloseShiftModal,SalePage.lineSheet,SalePage.contact}
│  │                           # + lib/{catalog,cart} (IndexedDB + carrito)
│  └─ tpv-web-spike/           # sin cambios
├─ packages/
│  ├─ db/                      # + 1 migración: b4_stores_and_tickets
│  └─ holded-client/           # sin cambios
└─ docs/blocks/B4-done.md      # este archivo
```

## Lo que dejé hecho

### Prisma schema + migración

`20260513150000_b4_stores_and_tickets` (SQL escrito a mano siguiendo
el patrón de B2/B3 — Docker no estaba arriba para `prisma migrate dev`,
Prisma lo aplicará tal cual cuando lances `pnpm db:migrate`).

Cambios sobre el schema heredado de B1+B2+B3:

- `Store.deletedAt`, `Register.deletedAt` — soft-delete. FKs a Refund/
  Ticket/Shift son Restrict; borrar duro rompería histórico fiscal.
- `Ticket.notes`, `Ticket.holdedDocNumber`, `Ticket.cashAmount`,
  `Ticket.printIntent`, `Ticket.emailIntent`, `Ticket.giftReceiptIntentAt` —
  campos que faltaban del modelo funcional del prompt.
- `TicketLine.sku`, `TicketLine.holdedProductId`, `TicketLine.modifiers` —
  snapshot suficiente para que el worker construya el payload sin
  depender de `Product` y para que los modificadores se imprimen pero
  no se envíen a Holded.
- `Refund` ampliado: `userId`, `registerId`, `shiftId`, `total`,
  `totalTax`, `method`, `holdedDocNumber`, `syncedAt`, `syncError`.
  Las nuevas FK son Restrict.
- `RefundLine` con snapshot de la línea original.
- Nuevo modelo `TicketEmailJob`: cola interna para reenvíos de PDF por
  email (no se confunde con la cola BullMQ; cada job BullMQ apunta a
  un `TicketEmailJob.id`).
- Índices: `tickets(registerId, createdAt)`, `tickets(shiftId)`,
  `tickets(externalId)`.

`prisma format` valida y el cliente está regenerado.

### Backend (`apps/api/`)

#### B4 §0 — Stores/Registers desde admin

`stores/routes.ts` con CRUD completo:
- `GET /admin/warehouses` — para alimentar select del modal nueva tienda.
- `GET /admin/stores` — listado con conteo de cajas, devices activos y
  ventas de los últimos 30 días.
- `POST /admin/stores` — valida que `warehouseHoldedId` existe.
- `GET /admin/stores/:id` — detalle con sus registers, conteo de
  devices y `lastSaleAt` por register.
- `PATCH /admin/stores/:id` — bloquea cambiar `warehouseHoldedId` si la
  tienda tiene tickets emitidos (rompería histórico de stock).
- `DELETE /admin/stores/:id` — soft-delete si no quedan registers activas.
- `GET /admin/registers` — listado plano para alimentar el modal
  "Generar código" de DevicesPage.
- `POST /admin/stores/:id/registers` — alta de caja.
- `PATCH /admin/registers/:id` — edita name / numSerieHolded / printerConfig.
- `DELETE /admin/registers/:id` — soft-delete sólo si no hay devices
  emparejados ni tickets emitidos.

#### B4 §1 — Modelo de ticket + worker

`tickets/totals.ts` — cálculo línea-a-línea con redondeo y tolerancias.
Tests unitarios separados (`totals.test.ts`).

`tickets/routes.ts`:
- `POST /tickets` (`requireCashierSession`) — idempotencia por
  `externalId` UUIDv4 (200 con `duplicate:true` si ya existe), valida
  `Σ payments == total ± 0.01`, valida `sku no vacío`, persiste ticket
  + lines + payments en transacción, encola job upload-ticket.
- `GET /tickets/:id` — para polling tras cobrar.
- `GET /tickets` — búsqueda con `q` (interno/fiscal/external),
  `from/to`, `status`, `registerId`, `shiftId`, `method`, paginación
  cursor.
- `POST /tickets/:id/resend-email` — crea fila en `ticket_email_jobs`
  y encola el job BullMQ.
- `POST /tickets/:id/gift-receipt-intent` — marca
  `giftReceiptIntentAt = now()` (B5 imprimirá).
- `POST /refunds` — idempotencia, validación de unidades vs original
  (incluye refunds previos), encola upload-refund.

`tickets/upload-ticket.ts` — la implementación nuclear del worker (B4 §1.3):
1. Skip si ya `SYNCED` o si no hay API Key.
2. Bumpa `attempts` en HoldedUpload.
3. POST salesreceipt + GET-back (`createSalesreceiptApproved`).
   Silent reject → SYNC_FAILED. 4xx no-429 → SYNC_FAILED. 5xx /
   network → propaga (BullMQ reintenta exponencial, 5 attempts, base 30s).
4. POST `/pay` con suma total + GET-back paymentsPending == 0.
5. Si éxito: ticket → SYNCED, HoldedUpload → DONE, dispara email job
   pendiente.

`tickets/upload-refund.ts` — mismo patrón con `units` en negativo y
`notes` referenciando el original. **Decisión:** signos negativos vía
unidades en lugar de precio; el spike no probó refunds, lo confirmamos
con el primer caso real en sandbox.

`tickets/send-ticket-email.ts` — descarga PDF de Holded con
`getReceiptPdf`, lo manda como adjunto. Si el ticket no está SYNCED,
devuelve `deferred` — el upload-ticket-worker dispara el email tras
SYNCED.

`workers/{ticket-upload,refund-upload,ticket-email}-worker.ts` con
concurrency configurable. Arrancan embedded en dev (`server.ts`) y como
proceso separado en prod (`workers/index.ts`).

#### B4 §2-3 soporte backend

`tpv-catalog/routes.ts` (todos `requireCashierSession`):
- `GET /tpv/catalog/products` — paginación cursor 500/req. Sólo
  productos `active` con `sellableViaTpv` y `sku` no vacío. Devuelve
  `priceGross` (con IVA) para que el TPV no haga el cálculo.
- `GET /tpv/catalog/wildcards` — comodines TPV-OTROS-{IVA}.
- `GET /tpv/health/holded` — banner ámbar / rojo del TPV.

`auth/middleware.ts` ampliado con `requireOwnerOrCashier` (acepta JWT
de owner o de cashier-session). Contacts y catálogo TPV usan este
guard — el cajero puede crear contactos on-the-fly desde la pantalla
de venta.

`shift/routes.ts` ahora calcula `cashTheoretical` y método-por-método
desde `ticket_payments` (B3 los dejaba en 0). También añade
`GET /shift/current` para que la PWA conozca el `shiftId` real tras
abrir.

### Admin (`apps/admin/`)

- `AdminShell.tsx` activa el ítem "Tiendas". Sólo "Holded" sigue grisado.
- `pages/StoresPage.tsx` con dos componentes:
  - `StoresPage` (lista) — entrada por defecto, tabla con conteos.
  - `StoreDetailPage` (`/admin/stores/:storeId`) — header con
    breadcrumb ← Tiendas, sección "Almacén Holded" con form editable,
    sección "Cajas" con tabla y modal "+ Nueva caja", botón "Eliminar
    tienda" con confirmación.
- `App.tsx` registra ambas rutas.
- `DevicesPage.tsx` ahora usa `/admin/registers` real (B3 derivaba del
  listado de devices). El mensaje vacío del modal apunta a Tiendas.

### TPV-web (`apps/tpv-web/`)

`lib/catalog.ts` — cache IndexedDB + fallback localStorage:
`loadCatalogFromCache`, `refreshCatalog` (paginado completo), helpers
`findByBarcode`, `findBySku`, `fuzzySearch`.

`lib/cart.ts` — modelo del carrito + cálculo de totales (espejo del
`totals.ts` del backend para que el preview de cobro coincida con lo
que el servidor recalcula). `getSuspendedCarts/saveSuspendedCart/
removeSuspendedCart` en localStorage.

`pages/SalePage.tsx` — pantalla principal. Sidebar 240/88, topbar con
búsqueda permanente (scanner USB-HID: Enter dispara fuzzySearch o
barcode lookup), categorías (placeholder "Todos"), grid de productos,
quick actions (Descuento global, Nota, Cliente, Cancelar), línea
libre, ticket panel a la derecha, botón "Cobrar". Banners ámbar/rojo
por health Holded. Sheets: línea (cantidad, descuento, modificadores
con chips, eliminar), línea libre (contra wildcards TPV-OTROS), notas,
cliente, suspendidos.

`pages/CheckoutPage.tsx` — overlay literal pantalla 7 del reference.
Métodos con `PaymentRowEditor` (acepta múltiples filas para mixto,
input de referencia opcional en CARD/BIZUM), calculadora atajos
efectivo (+5/+10/+20/+50/Justo/100/C), checkboxes imprimir/email/
ticket regalo. Atajos `Enter` confirma si total cuadra, `Esc` cierra.
Tras POST `/tickets`: modal éxito con polling cada 1s al `GET
/tickets/:id` hasta SYNCED o SYNC_FAILED.

`pages/TicketsHistoryPage.tsx` — overlay full con filtros (q,
status), badges por estado (`SYNCED` verde, `PENDING_SYNC` ámbar,
`SYNC_FAILED` rojo). Drawer lateral con detalle: líneas, pagos,
botones reimprimir (B5 todavía), reenviar por email, iniciar
devolución (sólo SYNCED), abrir en Holded.

`pages/RefundPage.tsx` (RefundOverlay) — stepper de unidades por
línea, selector de método (default = del cobro original), motivo
opcional, total calculado en cliente, POST `/refunds`.

`pages/CloseShiftModal.tsx` — extraído de `ShiftActiveScreen` para
poder cerrar turno desde SalePage.

`App.tsx` — al "active" usa `SalePage` directamente con el `shift.id`
real (ahora que `/shift/open` lo devuelve).

### Tests

Total **151/151 verdes** (+26 nuevos sobre B3):

| Archivo | Tests | Cubre |
|---|---|---|
| `totals.test.ts` | 8 | computeLine, computeTicket, tolerancias |
| `stores-route.test.ts` | 7 | CRUD stores/registers + guardrails (warehouse FK, store con tickets, register con devices/tickets) |
| `tickets-route.test.ts` | 6 | happy path, idempotencia, PAYMENTS_MISMATCH, LINE_WITHOUT_SKU, REGISTER_MISMATCH, SHIFT_NOT_OPEN |
| `upload-ticket.test.ts` | 5 | happy path, silent reject, 4xx permanente, 5xx transitorio, skip si ya SYNCED |

## Lo que dejé fuera (por diseño · bloques siguientes)

- **Impresión real ESC/POS** y el print agent — **B5**.
- **Bar/mesas/websockets/multi-terminal** — **B6**.
- **Conversión ticket → factura vía API** — v2.
- **Customer-facing display** — v2.
- **Categorías del catálogo desde Holded en la pantalla de venta** —
  el endpoint `/tpv/catalog/products` ya está, pero la SalePage sólo
  muestra "Todos" como chip activo. Cuando llegue B5 con catálogo
  categorizado, conectamos los chips. El catálogo bruto se carga vía
  IndexedDB y el cajero ya puede buscar/escanear sin problemas.
- **Configurar "favoritos" por tenant** — B5 si el cliente lo pide.
- **Bandeja de errores `SYNC_FAILED`** en admin — B5 con detalle del
  payload original, botón "Reintentar", deep link a Holded.
- **`location lock`** §17.5 — diferido a v2.
- **Customer-facing display, dataphone integrado, WhatsApp** — Fase 2.

## Decisiones que tomé en B4 sin preguntar

1. **`/pay` único con suma total agregada** en lugar de varios `/pay`
   por método. ADR-007: Holded sólo ve el total; el desglose por
   método vive en el TPV. Para un ticket mixto efectivo+tarjeta,
   Holded recibe un único `/pay` con `desc: "TPV mixto · CASH: 5€ ·
   CARD: 7.10€"`.
2. **Signo negativo en refunds vía `units` negativas** (no `price`).
   El prompt no especificó; el spike no probó refunds. Cuando llegue
   el primer refund real en sandbox confirmamos y, si Holded prefiere
   `price` negativo, cambiamos.
3. **`internalNumber` y refunds con prefijo "R-"**. Comparten el
   `register.ticketCounter` atómico — el incremento por refund evita
   confundirlos en el listado pero usan la misma serie interna. Es
   coherente con núcleo §13 (refund = un documento más de la caja).
4. **Modificadores como `Json` jsonb** en `TicketLine`, NO enviados a
   Holded (núcleo §6.2). Si una línea se devuelve, los modificadores
   se snapshot-ean del original.
5. **Soft-delete de Store/Register**. La FK a tickets/shifts es
   Restrict, así que borrar duro rompería el histórico. Soft-delete
   con `deletedAt` filtra del listado y mantiene el join histórico.
6. **`requireOwnerOrCashier`** nuevo guard que acepta access token de
   owner o cashier-session JWT. Usado por contacts/* y catálogo TPV.
   Antes contacts/* era sólo `requireOwner` (B2) — el cajero no
   habría podido crear contactos on-the-fly.
7. **No envío múltiple a Holded para mixtos** (idem decisión 1). El
   spike §06.A confirmó que `/pay` admite varias llamadas, pero ADR-007
   define que el TPV es el único depositario del desglose. Si Holded
   en algún momento expone un endpoint que acepte el desglose
   simultáneo, lo revaluamos.
8. **`paidAt = now()` al persistir**, no del payload. El payload del
   front no lleva timestamp (no es trustworthy); el servidor decide
   `paidAt = paid_at = createdAt`. El worker usa este timestamp para
   `date` de Holded.
9. **`GET /shift/current` añadido en B4 §1** (era duda de B3). Sin
   esto, tras abrir turno el TPV no conocía el `shiftId` real y
   pintaba pantalla "pending-refresh". B4 cambió `ShiftOpenScreen` para
   pasar el shift completo a `App.tsx`, lo que evita una llamada
   extra; el endpoint `/shift/current` queda como respaldo para futuros
   flujos (e.g. la PWA reconecta con un cashier-session válido).
10. **Catálogo cacheado en IndexedDB sin Dexie**, con fallback a
    localStorage cuando IDB no está disponible. ~200 líneas, suficiente
    para B4 (paginación 500/req, refresh manual con botón). Dexie/
    React Query lo evaluamos si llega complejidad real.
11. **Polling cada 1s tras el cobro** (hasta 60 intentos) buscando el
    `holdedDocNumber`. Sí, son hasta 60 GETs por cobro; al ser una
    pantalla efímera (cliente esperando ticket) y el worker con
    concurrency 2, el doc Holded suele llegar en ≤5s. Si esto se
    convierte en cuello de botella en piloto, migramos a SSE/websocket
    o aumentamos el delay.
12. **Concurrency del ticket-upload-worker = 2 por defecto** via
    `TICKET_UPLOAD_CONCURRENCY` env. Suficiente para piloto; si el
    rate limit del tenant lo soporta, se sube a 4-8.
13. **`shift/routes.ts` close ahora calcula teórico real**. B3 los
    dejaba en 0; B4 lee los `ticket_payments` del shift y agrega por
    método. Mejora el Z report sin migración nueva.
14. **TicketsHistoryPage cabe dentro de SalePage** como overlay full.
    No es ruta propia. Mantiene la PWA en una sola navegación stack —
    la sale/checkout/history/refund son todas overlays que se cierran
    al carrito vacío.
15. **Banner ámbar de "Sincronizando" en SalePage** no bloquea ventas.
    Banner rojo "Holded no conectado" tampoco — la venta sigue
    funcionando offline; lo que se bloquea es el cierre (B5 hará el
    bloqueo real con bandeja completa).
16. **Tests con mocks Prisma in-memory** (deuda heredada de B1-B3).
    Sin testcontainers todavía. Cuando tengamos CI lo introducimos
    correctamente.

## Dudas y cosas a confirmar antes de B5

1. **Signo del refund en Holded.** Confirmar en sandbox que
   `units < 0` con `price > 0` produce un salesreceipt con `total
   < 0`. Si Holded exige `price < 0`, cambiar `upload-refund.ts`.
   Hasta que se valide, dejamos lo que tenemos.
2. **¿Refund con `approveDoc: true`?** Asumido que sí (el "ticket de
   abono" debe nacer aprobado igual que el original). Confirmar
   contra docs.
3. **Política de stock en refunds.** El núcleo §10 dice "stock se
   repone informativo, lo dicta Holded al procesar". En sandbox:
   ¿Holded incrementa stock del SKU al recibir el salesreceipt
   negativo? Si no lo hace y queremos que lo haga, tendremos que usar
   `waybill` o llamada explícita. Difiere a B5+.
4. **PDF de refund vía `getReceiptPdf`**: ¿Holded genera PDF para
   salesreceipts negativos? Si no, el reenvío por email del ticket de
   abono no funcionará. Diferir a la pantalla "Reenviar PDF" de B5.
5. **Numeración del refund** — hoy usa `ticketCounter` con prefijo
   "R-". ¿Quieres una serie separada por tipo? Si sí, otra migración
   con `Register.refundCounter`.
6. **Polling 1s tras cobro**. ¿Aceptable? Alternativa: cliente espera
   3-5s y refresca manual. Lo dejamos así hasta que en piloto un
   cliente real se queje.
7. **Bandera "Modo degradado"** §5 del núcleo. Hoy el banner ámbar /
   rojo informa pero no bloquea cierre. El bloqueo real a 24h/48h
   queda para B5 con la bandeja de errores del encargado.
8. **Roles del Cajero vs Encargado** en SalePage. Hoy ambos hacen lo
   mismo (no hay umbral de descuento que pida PIN encargado). El
   prompt B4 §6.3 lo permite "configurable"; en B4 cualquier cajero
   aplica cualquier descuento. Si introducimos el umbral (default 10%
   del núcleo §6.3), añadimos una pantalla de PIN.
9. **MANAGER en admin**. Hoy todas las rutas admin son `requireOwner`.
   Cuando el MANAGER pueda hacer login admin (B5+), añadimos un
   `requireOwnerOrManager` y exponemos: DevicesPage (sí), CashiersPage
   (sólo reset PIN), StoresPage (sólo ver), pero no SecurityPage ni
   Holded.
10. **`gift-receipt-intent` se persiste pero no hay UI de "vale lo
    quiero reimprimir"** — sólo el checkbox al cobrar. En B5 con
    impresión real, el botón "Imprimir ticket regalo" desde la vista
    de detalle ya tiene endpoint listo.
11. **Tests integración con BD real** — sigue pendiente. Tras B5 será
    útil para validar las migraciones cascada/restrict en serio.

## Cómo arrancarlo todo de cero

```bash
# 1. Levantar infra y aplicar la migración nueva
docker compose up -d
pnpm install
pnpm db:migrate   # aplica b4_stores_and_tickets

# 2. Tests (22 ficheros, 151 casos)
pnpm test

# 3. Type-check
pnpm --filter @mipiacetpv/api exec tsc --noEmit
pnpm --filter @mipiacetpv/admin exec tsc --noEmit
pnpm --filter @mipiacetpv/tpv-web exec tsc --noEmit

# 4. Arrancar dev (3 terminales separadas)
pnpm dev:api    # http://127.0.0.1:3001
pnpm dev:admin  # http://localhost:5173
pnpm dev:tpv    # http://localhost:5174
```

Flujo E2E recomendado tras arrancar:

1. Admin: `/admin/stores` → "+ Nueva tienda" → asocia el almacén
   default → "Tienda principal".
2. Dentro de la tienda → "+ Nueva caja" → "Caja 1".
3. `/admin/devices` → "Generar código" → seleccionar "Caja 1" del
   dropdown (ahora alimentado por `/admin/registers`).
4. TPV `localhost:5174` → pegar código → emparejado.
5. PIN cajero → entrar → abrir turno con fondo 100€.
6. Pantalla de venta:
   - Añadir productos clicando en la grid o pegando un barcode.
   - Aplicar descuento global desde quick actions.
   - Asociar un contacto (search → crear si no existe).
   - "Cobrar" → pantalla 7 con calculadora.
7. Confirmar cobro en efectivo → modal éxito → polling muestra
   número fiscal en cuanto Holded responde.
8. Botón "Tickets" → buscar el ticket recién creado → ver detalle →
   "Iniciar devolución" → seleccionar 1 unidad → confirmar →
   refund encolado, sync visible en lista.
9. Logout cajero / cerrar turno desde sidebar → ver Z report en
   `storage/z-reports/<shiftId>.pdf`.

Cuando termines B4 y Matías lo revise, te paso el prompt de B5
(impresión ESC/POS).
