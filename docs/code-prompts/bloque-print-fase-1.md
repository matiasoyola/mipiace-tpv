# Prompt para Claude Code — B-Print fase 1 · ticket digital nativo

Bloque acotado. Foco único: implementar la entrega del ticket en
formato digital (PDF + email + QR + visualización). **Sin
impresora térmica, sin hardware**. Desbloquea el lanzamiento de
los 5 pilotos esperando.

Pega esto en una sesión nueva de Claude Code tras pushear B7.5
(commit `10ba9db` ya en `origin/master`).

---

Hola Code. B-Print fase 1 es un bloque acotado con un giro
estratégico importante: tras revisar todas las arquitecturas
posibles (doc canónico en `docs/design/printing-architecture.md`),
hemos decidido que mipiacetpv es un **TPV digital**. El ticket
nativo es digital (PDF + email + QR + visualización en pantalla).
La impresión térmica queda como **complemento opcional on-demand**
que añadimos en fase 2 cuando un piloto lo pida.

Este bloque no toca hardware. Cero compras. Cero pairing. Cero
agente. Desbloquea el piloto inmediatamente.

## Contexto

B7.5 cerrado (commit `10ba9db`). Lee primero:

- `docs/design/printing-architecture.md` — diseño canónico,
  especialmente §TL;DR, §6.5 Roadmap y §Anexo ADR-006 reescrito.
- `docs/blocks/B5-done.md` §"ticket-email worker" — diseño
  original del worker de email que ahora cerramos.
- `apps/api/src/workers/ticket-email.ts` — worker actual (si
  existe) o el stub que sea.
- `apps/web-tpv/src/pages/CheckoutPage.tsx` — la pantalla de
  cobro donde se dispara la entrega de ticket.
- `apps/api/src/billing/tickets/` — rutas y modelo Ticket actual
  (B4/B5/B6).
- `packages/db/prisma/schema.prisma` — modelos Ticket, Store,
  Tenant, Customer.

## Alcance · 6 frentes

### Frente 1 · `packages/ticket-model/` (nuevo workspace)

Modelo abstracto de ticket compartido por todos los renderers
(presentes y futuros). TypeScript puro, sin dependencias externas
salvo `zod` para validación.

Tipos clave:

```ts
export interface TicketDocument {
  fiscal: {
    legalName: string;
    taxId: string;
    address: string;
    phone?: string;
  };
  store: {
    name: string;
    address: string;
    phone?: string;
  };
  ticket: {
    internalNumber: string;
    publicSlug: string;
    issuedAt: Date;
    cashierName: string;
    registerName: string;
  };
  customer?: {
    name?: string;
    taxId?: string;
    email?: string;
  };
  lines: TicketLine[];
  totals: {
    subtotal: number;
    taxBreakdown: Array<{ rate: number; base: number; tax: number }>;
    total: number;
  };
  payment: {
    method: 'CASH' | 'CARD' | 'TRANSFER' | 'OTHER';
    paid: number;
    change?: number;
  };
  refund?: {
    originalTicketNumber: string;
    reason?: string;
  };
  footer: {
    thankYouMessage: string;
    returnPolicy?: string;
    qrCaption?: string;
  };
}

export interface TicketLine {
  description: string;
  sku?: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  taxRate: number;
  subtotal: number;
}
```

Helper `buildTicketDocument(ticket, tenant, store, register, cashier)`
que toma los registros de BD y produce el `TicketDocument`. Tests
unitarios cubren cabecera fiscal, descuentos, IVA múltiple,
devoluciones, customer sin email.

### Frente 2 · `packages/ticket-pdf/` (nuevo workspace)

`TicketPdfRenderer` que toma un `TicketDocument` y produce un
`Uint8Array` con el PDF.

- **Librería:** `pdf-lib` (ESM puro, funciona en Node y en browser,
  TypeScript-friendly, soporte fuentes embebidas con `fontkit`).
- **Formato:** ancho 80mm × alto dinámico (la página crece según
  número de líneas). Font monospace embebida (Roboto Mono o
  similar) para alineación tipo térmico.
- **Layout:** cabecera fiscal centrada, separador, store/fecha/hora,
  separador, tabla líneas (descripción + cantidad + precio +
  subtotal), separador, totales con desglose IVA, método pago,
  footer + QR opcional (si el caller lo pide, se dibuja el QR como
  PNG en el footer).
- **Devoluciones:** misma plantilla pero con cabecera "DEVOLUCIÓN"
  + referencia al ticket original.

Función pública:

```ts
export async function renderTicketPdf(
  doc: TicketDocument,
  opts?: { qrPngBytes?: Uint8Array; qrCaption?: string }
): Promise<Uint8Array>;
```

Funciona en ambos entornos (Node worker para email, browser para
descarga/vista). Tests con fixture PDF binario stable (hash
comparado).

### Frente 3 · Endpoint público `GET /tickets/:publicSlug/pdf`

- Migración `b8_ticket_public_slug`: añade columna
  `Ticket.publicSlug` (16 chars random, unique, índice). Backfill
  para tickets existentes con nanoid o equivalente.
- Endpoint público sin auth: resuelve `publicSlug` → carga ticket
  + relaciones → `buildTicketDocument` → `renderTicketPdf` →
  responde `Content-Type: application/pdf` con
  `Content-Disposition: inline; filename="ticket-<internalNumber>.pdf"`.
- Si el slug no existe o el ticket está en estado `DRAFT`, 404.
- Sin TTL en fase 1 (el slug random 16-char es secreto suficiente,
  ~96 bits de entropía).
- Cache HTTP `Cache-Control: private, max-age=3600`.

### Frente 4 · Worker `ticket-email` enriquecido

Si el worker no existe aún, créalo en
`apps/api/src/workers/ticket-email.ts` siguiendo el patrón de los
otros workers (BullMQ queue `ticket-email`, processor importable).

- Trigger: cuando un ticket pasa a `PAID` y tiene `customer.email`
  poblado Y la tienda tiene `ticketDelivery.emailAuto = true`.
- Encolado: `enqueueTicketEmail(ticketId)` invocado desde el
  endpoint `POST /tickets/:id/checkout` tras el commit transaccional.
- Procesamiento: carga ticket, genera PDF con `renderTicketPdf`,
  manda email vía el sender configurado (ConsoleEmailSender en dev,
  nodemailer SMTP en prod) con asunto + body desde
  `store.ticketDelivery.emailSubject/emailBody` (con interpolación
  de variables `{tienda}`, `{numero}`, `{total}`).
- Adjunto: el PDF como `attachments` con filename
  `ticket-<internalNumber>.pdf`.
- Reintentos: BullMQ default (3 con backoff exponencial). Si tras
  3 fallos sigue rojo, escribir `Ticket.emailFailedAt` para
  visibilidad admin.

Tests: unit del processor con sender mock + integration con queue
real (testcontainers Redis).

### Frente 5 · UI PWA "Tras cobro" en CheckoutPage

Tras confirmar cobro (transición DRAFT→PAID exitosa) la PWA
muestra una pantalla "Ticket emitido" con 4 acciones disponibles
según `store.ticketDelivery` y estado del ticket:

1. **"Enviado por email a <email>"** badge informativo (si
   `customer.email` y `emailAuto`). Sin acción del cajero.
2. **"Mostrar QR"** botón. Abre modal con QR generado client-side
   apuntando a `https://app.mipiacetpv.tech/tickets/<publicSlug>/pdf`
   + caption configurable. **Si el ticket aún no se ha sincronizado
   con backend** (offline o pending upload), el botón aparece
   deshabilitado con tooltip "Disponible cuando sincronice".
3. **"Descargar PDF"** botón. Genera el PDF client-side con
   `renderTicketPdf` (sin esperar al server) y lanza download via
   blob URL.
4. **"Ver ticket"** botón. Abre modal con preview del PDF (usar
   `<embed>` o renderizar el PDF en canvas).

QR generation: librería `qrcode` (`pnpm add qrcode @types/qrcode`
en `apps/web-tpv`). Genera como data URL para mostrar en
`<img>`.

PDF client-side reutiliza `packages/ticket-pdf/` que también usa el
worker — mismo código en ambos lados.

### Frente 6 · Admin "Comunicación de ticket" por tienda

Nueva sección en la página de edición de tienda (Admin):

- `Store.ticketDelivery` jsonb nuevo con shape:
  ```
  {
    emailAutoIfCustomerHasEmail: boolean,
    showQrButton: boolean,
    showDownloadButton: boolean,
    showViewButton: boolean,
    emailSubject: string,
    emailBody: string,
    qrCaption: string
  }
  ```
- Defaults sensatos al crear tienda (todos true, plantillas en
  español).
- UI admin con form: 4 toggles + 3 textareas con preview de las
  variables disponibles (`{tienda}`, `{numero}`, `{total}`,
  `{fecha}`).
- Endpoint `PATCH /admin/stores/:id/ticket-delivery` requireOwner
  (settings son OWNER-only, alineado con matriz B6).
- Migración `b8_store_ticket_delivery`.

## Tests

- `ticket-model.test.ts`: builder con todos los casos (fiscal,
  descuentos, IVA múltiple, devolución, customer sin email).
- `ticket-pdf.test.ts`: PDF generado tiene texto correcto
  (extracción con `pdf-parse`), tamaño de página, número de
  páginas. Snapshot hash de fixture.
- `ticket-pdf-endpoint.test.ts`: GET con slug válido devuelve PDF
  válido, slug inválido 404, ticket DRAFT 404.
- `ticket-email.worker.test.ts`: encola+procesa con sender mock,
  el adjunto coincide con el PDF generado en el momento.
- `checkout-page.test.tsx`: 4 acciones visibles según
  `ticketDelivery`, QR deshabilitado offline, descarga lanza blob.
- `admin-ticket-delivery.test.ts`: PATCH actualiza, sólo OWNER.

Workspace completo debe pasar todos los tests existentes (210 de
B7.5) + los nuevos.

## Restricciones

- **NO** tocar hardware térmico, ESC/POS, BluetoothTransport,
  WebUSB, agente Docker. Todo eso es fase 2 on-demand.
- **NO** añadir endpoint admin global de "transports" o "print
  agents" — no aplica en fase 1.
- **NO** romper el flujo offline: la generación de PDF
  client-side debe funcionar sin red. El email queda en cola hasta
  sync. El QR aparece deshabilitado offline.
- Mantener ADR-007 (offline-friendly), ADR-011 (PWA pura, sin SDK
  propietario).
- Si descubres que el modelo Ticket actual no tiene algún campo
  necesario para el `TicketDocument`, primero documenta el gap en
  el PR y decide si ampliar el modelo o derivarlo.

## Entregables

1. PR único con B-Print fase 1.
2. Commit message descriptivo siguiendo el patrón de B7.5.
3. `docs/blocks/B-Print-fase-1-done.md` con resumen estructurado
   (frentes hechos, decisiones tomadas, métricas, dudas
   pendientes).
4. 2 migraciones (`b8_ticket_public_slug`, `b8_store_ticket_delivery`).
5. 2 workspaces nuevos (`packages/ticket-model/`,
   `packages/ticket-pdf/`).
6. Worker `ticket-email` cerrado.
7. UI PWA "Tras cobro" + Admin "Comunicación de ticket".
8. README breve en cada nuevo workspace.

## Lo que NO entra en B-Print fase 1

- Cualquier transporte térmico (A, H, D) — fase 2 on-demand.
- Agente Docker `packages/print-agent/` — fase 2.
- Bluetooth pairing UI — fase 2.
- WebUSB UI — fase 2.
- mDNS, auto-update, print bridge appliance — v2.
- Sunmi/Imin agente Android empotrado (A1) — v2.
- Conversión ticket→factura A4 — v2.

Cuando B-Print fase 1 cierre, podemos desplegar a Thalia
inmediatamente. Tras 2-3 semanas observando los 5 pilotos en
digital, decidimos qué transporte térmico añadir en fase 2 según
demanda real.
