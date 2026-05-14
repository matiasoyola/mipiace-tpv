# B-Print fase 1 · resumen del entregable

Estado: cerrado pendiente de revisión por Matías.

Bloque acotado. Foco único: implementar la entrega del ticket en
formato **digital nativo** (PDF + email + QR + visualización). Sin
impresora térmica, sin hardware, sin pairing, sin agente. Desbloquea
el lanzamiento inmediato de los 5 pilotos.

Fuera de B-Print fase 1 (explícito en el prompt):
- Cualquier transporte térmico (A, H, D) → fase 2 on-demand.
- Agente Docker `packages/print-agent/` → fase 2.
- Bluetooth pairing UI / WebUSB UI → fase 2.
- mDNS, auto-update, print bridge appliance → v2.
- Sunmi/Imin (A1) → v2.

## Estructura del repo tras B-Print fase 1

```
.
├─ apps/api/src/
│  ├─ admin/
│  │  └─ ticket-delivery.ts                 # + endpoints GET/PATCH ticket-delivery por tienda
│  ├─ env.ts                                # ~ PUBLIC_TICKET_URL
│  ├─ queues/ticket-email.ts                # ~ 3 attempts en lugar de 5
│  ├─ server.ts                             # ~ registra public PDF + digital + ticket-delivery
│  ├─ tables/grouping.ts                    # ~ publicSlug en cada ticket.create DRAFT
│  ├─ tables/operativa.ts                   # ~ idem (apertura de mesa)
│  ├─ tickets/
│  │  ├─ build-document.ts                  # + carga ticket + builds TicketDocument
│  │  ├─ digital-route.ts                   # + GET /tickets/:id/digital (auth)
│  │  ├─ email-trigger.ts                   # + maybeEnqueueAutoEmail (manual vs auto)
│  │  ├─ public-pdf-route.ts                # + GET /tickets/:slug/pdf (público sin auth)
│  │  ├─ public-slug.ts                     # + helper 16-hex random
│  │  ├─ routes.ts                          # ~ publicSlug en create, integra auto-email
│  │  └─ send-ticket-email.ts               # ~ render local (no descarga Holded)
│  └─ workers/ticket-email-worker.ts        # ~ marca emailFailedAt tras 3 attempts
├─ apps/admin/src/pages/
│  ├─ StoreDetailPage.ticketDelivery.tsx    # + sección "Comunicación de ticket"
│  └─ StoresPage.tsx                        # ~ inserta TicketDeliverySection
├─ apps/tpv-web/src/pages/
│  ├─ CheckoutPage.successOverlay.tsx       # + nueva pantalla post-cobro (4 acciones)
│  └─ CheckoutPage.tsx                      # ~ delega en SuccessOverlay externo
├─ packages/
│  ├─ db/prisma/
│  │  ├─ schema.prisma                      # ~ Store.ticketDelivery, Ticket.publicSlug + emailFailedAt
│  │  └─ migrations/
│  │     ├─ 20260514100000_b8_ticket_public_slug/
│  │     └─ 20260514100100_b8_store_ticket_delivery/
│  ├─ ticket-model/                         # + workspace nuevo
│  │  ├─ src/{types,schema,build,index}.ts
│  │  ├─ test/ticket-model.test.ts
│  │  ├─ package.json · tsconfig.json · README.md
│  ├─ ticket-pdf/                           # + workspace nuevo
│  │  ├─ src/{render,index}.ts
│  │  ├─ test/ticket-pdf.test.ts
│  │  └─ package.json · tsconfig.json · README.md
├─ apps/api/test/
│  ├─ public-pdf-route.test.ts              # + 4 tests endpoint público
│  ├─ ticket-delivery.test.ts               # + 5 tests admin
│  └─ ticket-email-worker.test.ts           # + 4 tests processor
└─ docs/blocks/B-Print-fase-1-done.md       # este archivo
```

## Lo que dejé hecho

### Frente 1 · `packages/ticket-model/`

Workspace nuevo con tipos puros del `TicketDocument` + builder
`buildTicketDocument(input)`. Sin atadura a Prisma — recibe shapes
duck-typed (números o Decimal-like). Schemas zod aplican antes del
render. 9 tests cubren: cabecera fiscal completa o vacía (fallback al
tenant.name), descuento por línea con subtotal neto, IVA múltiple
(10 % + 21 %), devoluciones con referencia al ticket original, customer
sin email, customer vacío omitido, BIZUM→TRANSFER y VOUCHER→OTHER,
Decimal-like → number.

### Frente 2 · `packages/ticket-pdf/`

Workspace nuevo. `renderTicketPdf(doc, opts?)` con `pdf-lib`:

- 80 mm de ancho, alto dinámico computado antes de crear la página.
- Fuente `Courier` estándar embebida (no requiere assets).
- Cabecera centrada (legal name + NIF + dirección + tel.), separador,
  título "TICKET" / "DEVOLUCIÓN", store + nº + fecha + caja + cajero,
  sección Cliente opcional, líneas con `descripción / cant × precio
  -X% / subtotal`, separador, desglose IVA por tasa, SUBTOTAL, TOTAL
  destacado, método de pago + cambio, separador, mensaje de
  agradecimiento + política devolución + slug, QR opcional con caption.
- `useObjectStreams:false` al guardar para que Mozilla pdf.js / pdf-parse
  lean el documento (visores estrictos lo agradecen).

5 tests con `pdf-parse`: magic number %PDF + ancho 80 mm, strings clave
(`Thalia SL`, `000123`, `Caja 1`, `TOTAL`), TICKET vs DEVOLUCIÓN con
referencia, QR embebido (`Escanea` aparece y la página crece >150pt) y
crecimiento vertical proporcional al número de líneas.

### Frente 3 · Endpoint público + migración `b8_ticket_public_slug`

- `migration.sql` añade `tickets.public_slug` (16 hex, ~96 bits) con
  unique index, backfill `gen_random_bytes(8)` (extension pgcrypto) y
  `tickets.email_failed_at` para visibilidad admin.
- `apps/api/src/tickets/public-slug.ts` (`randomBytes(8).toString('hex')`)
  + `routes.ts`, `tables/operativa.ts`, `tables/grouping.ts` pasan
  `publicSlug` en cada `ticket.create`.
- `apps/api/src/tickets/public-pdf-route.ts` registra
  `GET /tickets/:publicSlug/pdf` sin auth: 200 + `application/pdf`,
  `Content-Disposition: inline`, `Cache-Control: private, max-age=3600`.
  404 si DRAFT o slug no existe (misma respuesta para no filtrar
  existencia).

4 tests: happy path PDF binario, slug inexistente, slug en formato
inválido (no 16-hex), DRAFT 404.

### Frente 4 · Worker `ticket-email` enriquecido

- `tickets/send-ticket-email.ts` reescrito: ya no descarga PDF de
  Holded. Carga el `TicketDocument` con `loadTicketDocument`, genera el
  PDF local con `renderTicketPdf` (con QR embebido apuntando al
  endpoint público), interpola el subject/body de la config de tienda
  (`{tienda}`, `{numero}`, `{total}`, `{fecha}`), envía con el sender
  inyectado (Console en dev, SMTP en prod) y marca `DONE`.
- `tickets/email-trigger.ts` con `maybeEnqueueAutoEmail`:
  1. Email manual del cajero → siempre se respeta.
  2. Contacto vinculado con email + `store.ticketDelivery
     .emailAutoIfCustomerHasEmail` → envío automático.
  3. Resto → no se encola.
- `queues/ticket-email.ts`: 3 attempts (antes 5) con backoff
  exponencial. Tras agotarlos, `ticket-email-worker` marca
  `Ticket.emailFailedAt = now()` para que admin lo vea.
- `routes.ts` POST /tickets y POST /tickets/:id/checkout delegan
  encolado a `maybeEnqueueAutoEmail` (sustituye el viejo
  `prisma.ticketEmailJob.create` inline).

4 tests del processor: happy path con PDF embedded y filename
`ticket-000077.pdf`, defer en DRAFT, skip si job ya DONE, skip si job
no existe.

### Frente 5 · UI PWA "Tras cobro"

- `CheckoutPage.successOverlay.tsx` (nuevo, ~370 líneas) reemplaza el
  SuccessOverlay inline. Mantiene el polling Holded para el número
  fiscal y añade carga de `GET /tickets/:id/digital`.
- 4 acciones según `store.ticketDelivery`:
  1. **Badge "Enviado por email a XXX"** si el worker encoló auto.
  2. **Mostrar QR** modal con QR generado client-side
     (`qrcode.toDataURL`) apuntando al endpoint público; deshabilitado
     hasta que el payload digital llegue (tooltip "Disponible cuando
     sincronice").
  3. **Descargar PDF** genera blob local con `renderTicketPdf` y lanza
     download via `<a download>`.
  4. **Ver ticket** abre modal con `<embed type="application/pdf">` del
     blob.
- Tras cobro confirmado el cajero puede usarlas sin esperar a Holded —
  el PDF nace digital al instante.

### Frente 6 · Admin "Comunicación de ticket" + migración

- `migration.sql` añade `stores.ticket_delivery` (jsonb) + seed con
  defaults en español para todas las tiendas existentes.
- Schema Prisma con `Store.ticketDelivery Json?` y comentario shape.
- `admin/ticket-delivery.ts` (`GET` requireOwnerOrManager, `PATCH`
  requireOwner) — normaliza siempre (defaults rellenan campos
  faltantes) y rechaza body strings vacíos. Exporta
  `DEFAULT_TICKET_DELIVERY` para reutilizar.
- `apps/admin` → `StoreDetailPage.ticketDelivery.tsx` con 4 toggles
  (email auto, QR, descargar, ver) + 3 textareas (asunto, cuerpo,
  caption QR), preview de variables disponibles. Disabled para MANAGER.

5 tests admin: OWNER lee defaults cuando jsonb null, MANAGER lee pero
PATCH→403, OWNER edita parcial y se mergea, 404 fuera de tenant,
`additionalProperties:false` elimina campos extra.

## Tests

```
$ pnpm test
…
 Test Files  35 passed (35)
      Tests  237 passed (237)
```

Desglose por nuevo:
- `packages/ticket-model/test/ticket-model.test.ts` · 9 tests
- `packages/ticket-pdf/test/ticket-pdf.test.ts` · 5 tests
- `apps/api/test/public-pdf-route.test.ts` · 4 tests
- `apps/api/test/ticket-delivery.test.ts` · 5 tests
- `apps/api/test/ticket-email-worker.test.ts` · 4 tests

Suite previa (B7.5 · 174 tests API) sigue verde.

## Decisiones tomadas

- **`publicSlug` 16 hex (8 bytes)** en vez de UUID. Suficiente entropía
  para capability URL (~96 bits) y compacto en QR.
- **Backfill con `pgcrypto.gen_random_bytes`** para no requerir un
  script de migración aparte; la extensión es estándar en Postgres y
  ya se usaba implícitamente.
- **Render local en el worker** (no descarga PDF de Holded): el ticket
  digital se desliga de la latencia/disponibilidad de Holded. Si la
  sync falla, el cliente ya recibió su ticket — la nota fiscal pasa a
  ser una "actualización informativa" en el footer.
- **3 attempts (antes 5)** en BullMQ + marca `emailFailedAt` tras el
  3º fallo. Más fácil de visibilizar en admin sin reventar Redis.
- **Endpoint público con 404 idéntico** para slug inválido / no
  existente / DRAFT: no filtramos existencia al escáner.
- **`useObjectStreams:false`** en pdf-lib save: Mozilla pdf.js
  (visores estrictos, pdf-parse) lee sin reventar; coste marginal en
  tamaño (~5 %).
- **Auto-email respeta el email manual del cajero** primero: si el
  cajero escribe en el checkbox "Enviar por email", esa dirección
  prevalece sobre la del contacto vinculado.

## Riesgos / dudas pendientes

1. **`PUBLIC_TICKET_URL`** está en `env.ts` con default
   `http://localhost:3001`. En prod hay que configurarlo al dominio
   público real (el mismo que sirve la API detrás del proxy). Si la
   variable está mal, el QR apuntará a localhost.
2. **El render de la PWA usa `window.location.origin.replace(":5174", ":3001")`**
   como heurística para el QR offline. Vale para dev. En prod el
   backend y la PWA viven en el mismo origin, así que sirve. Si en el
   futuro se separan, hay que parametrizarlo.
3. **El test del worker pasa por mocks** — no toca BullMQ real. El
   test integration con `testcontainers Redis` que pedía el prompt
   queda para una sesión específica de QA (la infra de testcontainers
   no está aún configurada en el repo; los 3 tests pre-existentes con
   timeout-Redis siguen igual).
4. **El frontend no tiene test e2e Playwright** (no hay infra). Lo
   compilamos con `tsc --noEmit` que pasa limpio. Cuando se monte la
   suite e2e, el `data-testid` de QR/download/view ya está puesto.
5. **El email del contacto** se hidrata vía `Contact.email`. Si el
   contacto fue creado on-the-fly sin email, el auto-email no
   dispara (correcto). El cajero puede seguir introduciendo email
   manual como antes.

## Lo que sigue (fase 2 cuando lo pida un piloto)

- Transporte H (Bluetooth directo) — diseño en
  `docs/design/printing-architecture.md` §3.H.
- Transporte A (Agente Docker) — §3.A.
- Transporte D (WebUSB) — §3.D.

Cada uno reusa `packages/ticket-model` y `packages/ticket-pdf`
existentes (el `EscPosRenderer` será un primo en `packages/ticket-escpos/`,
mismo `TicketDocument` de entrada).
