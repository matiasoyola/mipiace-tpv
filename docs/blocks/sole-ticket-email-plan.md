# Sole · el ticket que se manda por email — PLAN (Frente 0)

Origen: el prompt de Matías del 23-09-2026. Rama `sole-ticket-email`, worktree
`mipiacetpv-sole-email`, base `5aa0a20` (master). **Sin push, sin deploy. Cero migraciones.**

En paralelo corre otra sesión con el bloque del fichaje (rama `fichaje-1`, worktree
`mipiacetpv-fichaje-1`, misma base). Sus ficheros y su migración no se tocan.

Leído entero antes de escribir esto: `apps/api/src/tickets/routes.ts` (2255 l),
`apps/api/src/tickets/email-trigger.ts`, `apps/api/src/queues/ticket-email.ts`,
`apps/api/src/workers/ticket-email-worker.ts`, `apps/api/src/tickets/send-ticket-email.ts`,
`apps/api/src/tickets/public-pdf-route.ts`, `apps/api/src/tickets/digital-route.ts`,
`apps/api/src/tickets/build-document.ts`, `apps/api/src/lib/error-handler.ts`,
`packages/ticket-model/src/schema.ts`, `packages/ticket-pdf/src/render.ts`,
`packages/util-validation/`, `apps/tpv-web/src/pages/CheckoutPage.tsx`,
`apps/tpv-web/src/pages/CheckoutPage.successOverlay.tsx`,
`apps/tpv-web/src/pages/TicketsHistoryPage.tsx`, `apps/admin/src/AdminShell.tsx`,
`apps/admin/src/pages/TicketsErrorsPage.tsx`,
`apps/admin/src/pages/StoreDetailPage.ticketDelivery.tsx`,
`packages/db/prisma/schema.prisma` (modelos `Ticket` y `TicketEmailJob`) y la migración
`20260909000000_s1_sello_de_la_venta`.

---

## 1 · Qué pasa hoy, paso a paso · REPRODUCIDO

No está deducido de leer el código: está ejecutado. `apps/api/test-e2e/sole-ticket-email.e2e.ts`
levanta la API contra un Postgres real (`mipiacetpv_sole_email_e2e`), crea una peluquería
`SERVICES` y cobra 42,40 € con `"abc"` en el campo de email. Salida literal de la corrida:

```
REPRO1 cobro: 201 {"ticket":{"id":"e040ab93…","internalNumber":"000001","status":"PAID","total":42.4,…}}
REPRO1 jobs: [{"id":"7c09bc18…","toEmail":"abc","status":"PENDING"}]
REPRO1 encolados: 1
REPRO1 digital.emailedTo: "abc"
REPRO2 error del worker: "[\n  {\n    \"validation\": \"email\",\n    \"code\": \"invalid_string\",\n
                            \"message\": \"Invalid email\",\n    \"path\": [\n      \"customer\",\n
                            \"email\"\n    ]\n  }\n]"
REPRO2 job tras el intento: {"status":"PENDING","attempts":1,"sentAt":null}
REPRO2 emails enviados: 0
REPRO3 status del PDF: 400
REPRO3 cuerpo: {"error":"VALIDATION_ERROR","message":"Los datos enviados no son válidos.",
                "details":[{"path":"customer.email","message":"Invalid email"}]}
REPRO4 status del resend: 202 {"jobId":"2e0c3493…"}
```

El 000257 del 17-09, entero, en cuatro líneas de log.

### 1.1 El recorrido, en orden

| # | Paso | Dónde | Qué hace hoy |
|---|---|---|---|
| 1 | Ana teclea `abc` y pulsa Cobrar | `CheckoutPage.tsx:1013-1027` | El `<input type="email">` no valida nada: no hay `<form>` que dispare la validación nativa, y el botón Cobrar no la consulta |
| 2 | El TPV manda `emailIntent: "abc"` | `CheckoutPage.tsx:520` | `emailEnabled && emailIntent ? emailIntent : undefined` — sólo comprueba que no esté vacío |
| 3 | La API acepta el body | `routes.ts:166` (venta rápida) y `:794` (cobro de mesa) | `emailIntent: { type: "string", maxLength: 320 }`. Sin `format`, sin `pattern` |
| 4 | Se persiste en el ticket | `routes.ts:583` / `:1085` | `email_intent = 'abc'` |
| 5 | Se crea el job y se encola | `email-trigger.ts:44-47` → `persistAndEnqueue:88-98` | `ticket_email_jobs(to_email='abc', status='PENDING')` + `enqueueTicketEmail` |
| 6 | El TPV dice "Enviado" | `digital-route.ts:71` → `successOverlay.tsx:403-413` | `emailedTo` es el `to_email` del último job — **existir un job no es haberse enviado** |
| 7 | El worker lo intenta | `send-ticket-email.ts:100-137` | `loadTicketDocument` mete `customer.email = 'abc'` y `renderTicketPdf` lo valida |
| 8 | Revienta | `render.ts:197` → `schema.ts:49` | `ZodError · customer.email · Invalid email` |
| 9 | Tres veces | `queues/ticket-email.ts:24` | `attempts: 3`, backoff exponencial 60 s |
| 10 | Y se queda así | `ticket-email-worker.ts:27-51` | Marca `Ticket.email_failed_at`. **No toca `ticket_email_jobs.status`: la fila se queda en `PENDING` para siempre** |
| 11 | Nadie se entera | — | `email_failed_at` sólo se lee en `superadmin/hub.ts:127` y `superadmin/tenants.ts:164`, como contador. Ni el TPV ni el panel del propietario lo enseñan |
| 12 | Y el ticket queda roto | `public-pdf-route.ts:59` | El QR y "Descargar" dan **400** por el mismo ZodError |

### 1.2 El origen exacto del 400 del PDF

Tres saltos, ninguno opcional:

1. `public-pdf-route.ts:59` → `renderTicketPdf(doc)`.
2. `render.ts:197` → `assertTicketDocument(doc)`, que es `TicketDocumentSchema.parse(doc)`
   (`schema.ts:91`). El campo culpable es `schema.ts:49`:
   `email: z.string().email().optional()`.
3. La `ZodError` sube sin capturar hasta el manejador global,
   `lib/error-handler.ts:60-68`, que la traduce a **400 `VALIDATION_ERROR`**.

**El 400 es de la ruta pública, pero la causa no está en la petición.** El cliente que escanea
el QR no manda ningún email: manda un slug de 16 hex. Lo que invalida el documento es una
columna de la base escrita hace seis días. Por eso el código de estado miente dos veces: dice
que el problema es del que pide, y dice que hay algo mal en la petición.

El mismo ZodError rompe **la vista del ticket en el TPV**: `successOverlay.tsx` y el historial
llaman a `renderTicketPdf` en el navegador con el `document` de `/tickets/:id/digital`, que sí
responde 200 (esa ruta no renderiza). O sea: el payload llega bien y el render local peta.

### 1.3 En qué estado se queda el job tras agotar los intentos

**En `PENDING`.** Medido: `{"status":"PENDING","attempts":1,"sentAt":null}` tras el primer
intento, y nada en el camino lo cambia después.

- `send-ticket-email.ts` sólo escribe `status` en tres sitios: `SKIPPED_TEST` (:81),
  `DONE` (:170) y `FAILED` vía `markFailed` (:106) — y `markFailed` **sólo** se llama cuando
  el ticket no existe. Un fallo de render o de SMTP hace `throw` (:136, :165) para que BullMQ
  reintente, y el `throw` no toca la fila.
- `ticket-email-worker.ts:27-51`, en el evento `failed` con `attemptsMade >= 3`, escribe
  `Ticket.email_failed_at` y **nada más**.

Consecuencia doble:

- La fila de BullMQ acaba en el set `failed` de Redis con `removeOnFail: 500` — o sea,
  **se borra** pasados 500 fallos. La única huella duradera es `email_failed_at`.
- Como `ticket_email_jobs.status` sigue en `PENDING`, cualquier lectura que pregunte "¿cómo va
  este envío?" responde "pendiente" eternamente. `@@index([status])` sobre una columna que
  nunca llega a su estado terminal.

### 1.4 Por qué "Enviado por email a abc" es inevitable hoy

`digital-route.ts:48-52` coge `emailJobs` ordenados por `createdAt desc`, `take: 1`, y expone
su `toEmail` como `emailedTo`. El overlay pinta el badge verde con `Check` en cuanto ese campo
no es null (`successOverlay.tsx:403`). **No hay ningún punto del recorrido en el que el TPV
sepa si el envío salió**: el badge se pinta ~200 ms después del cobro y el worker no ha
corrido todavía. El texto es falso por construcción, no por un bug.

### 1.5 El otro texto falso

`TicketsHistoryPage.tsx:666`:

> "Enviado a la cola. Llegará al cliente en cuanto Holded confirme el ticket."

Falso desde B-Print fase 1. `send-ticket-email.ts:1-12` lo documenta: el PDF se genera local
con `@mipiacetpv/ticket-pdf` y **no espera a Holded**. El worker ni siquiera lee
`holdedDocumentId` — `routes.ts:1461` lo selecciona y no lo usa.

### 1.6 Lo que SÍ está bien y no se toca

- `Ticket.email_failed_at` y `Ticket.email_intent` están en la lista de columnas que el
  guardián del sello **deja escribir** sobre una venta sellada
  (`sello-de-la-venta.e2e.ts:302-315` lo fija). Marcar un fallo de email no viola el sello.
- `TicketEmailJob.status` es `String @default("PENDING")` sin enum de Postgres
  (`schema.prisma:1744-1746`), con el comentario que lo explica. **Añadir estados terminales
  no necesita migración.**
- `@mipiacetpv/util-validation` ya existe como paquete compartido tipo-puro.

---

## 2 · Qué cambio y dónde

Cinco frentes, un commit por frente cerrado.

### Frente 1 · Validar el email antes de cobrar y antes de encolar

**El paquete compartido.** `packages/util-validation/src/email.ts`, nuevo:
`normalizeEmail(raw)` (trim) y `isValidEmail(raw)`. Una sola regla, tres consumidores.

Se exporta por subpath (`"./email"` en el `exports` de `package.json`) además de por el
índice. Motivo medido: `util-validation/src/index.ts:3` reexporta `temporary-password.ts`,
que hace `import { randomBytes } from "node:crypto"`. El índice entero no puede entrar en el
bundle del TPV. `apps/tpv-web` importará `@mipiacetpv/util-validation/email`.

**En el TPV** (`CheckoutPage.tsx`): el campo sólo deja confirmar con un email válido, con el
aviso **al lado del campo**, y **sin bloquear el cobro**. Si el email no vale al pulsar
Cobrar, se cobra **sin** `emailIntent` — el dinero manda.

**En la API**, tres sitios, la misma función:

| Ruta | Campo | Qué pasa con `"abc"` |
|---|---|---|
| `POST /tickets` | `emailIntent` | La venta entra (201). Se descarta el intent, no se persiste, no se encola, y la respuesta lo dice |
| `POST /tickets/:id/checkout` | `emailIntent` | Igual |
| `POST /tickets/:id/resend-email` | `email` | **400** `INVALID_EMAIL` con mensaje claro |

**Decisión tomada sin preguntar · `format: email` de ajv vs. la función compartida.** El
prompt pide "se validan con `format: email`". Aplicarlo como palabra clave de ajv en el schema
del body **rechazaría la venta entera con un 400**, que es justo lo que el mismo párrafo
prohíbe ("el dinero ya ha cambiado de manos"). Así que la validación vive en el handler con
la función compartida, no en el `schema` de Fastify. Se lee "validar con formato de email",
no "usar el keyword de ajv". Lo contrario haría irreconciliables las dos frases del prompt.

La respuesta del cobro gana un campo para que el TPV pueda enseñarlo:
`emailIntentRejected: { reason: "INVALID_EMAIL", value: "abc" } | null`.

### Frente 2 · Un email malo no rompe el documento

Dos cambios, en dos capas distintas, por razones distintas:

1. **`packages/ticket-model/src/schema.ts:49`** — `customer.email` pasa de
   `z.string().email().optional()` a `z.string().optional()`. Precedente literal en el mismo
   fichero: el comentario de `schema.ts:18-23` ya aflojó la cabecera fiscal por esto mismo
   ("antes el ticket entero no se generaba"). **El documento no depende del email.**
2. **`apps/api/src/tickets/build-document.ts`** — al **leer**, un email que no valida no entra
   en el documento: `customer.email` queda `undefined` y el PDF sale sin la línea de email.
   Esto arregla el 000257 y a cualquier ticket viejo igual **sin migración de datos**, que es
   lo que pide el prompt: al leer, no al escribir. La columna `email_intent` se queda como
   está — es lo que Ana tecleó y es la prueba de qué pasó.

Sin (1), un camino que no pase por `build-document` volvería a invalidar el documento. Sin
(2), el PDF del 000257 saldría con `abc` impreso en la sección Cliente. Hacen falta las dos.

Y el worker deja de estrellarse contra una dirección imposible: si `to_email` no valida,
`send-ticket-email.ts` **no lo intenta** — marca el job como fallido terminal con motivo
`invalid_email` y devuelve `{kind:"failed"}` en vez de `throw`. Reintentar tres veces con
backoff de 60 s una dirección que nunca va a existir es quemar cuatro minutos para llegar al
mismo sitio.

### Frente 3 · "Enviado" sólo cuando se ha enviado

**El estado real, en un sitio.** `serializeTicket` (`routes.ts:2121`) gana `email`:

```ts
email: { to: string | null; status: "SENT" | "PENDING" | "FAILED" | "SKIPPED_TEST" | null;
         reason: string | null; at: string | null }
```

Derivado del último `TicketEmailJob` + `Ticket.emailFailedAt`. Requiere añadir `emailJobs`
(último, `take: 1`) a `ticketInclude()` (`routes.ts:1942`). Ningún campo nuevo en la base.

**En el cobro** (`successOverlay.tsx:403-413`): el badge deja de ser verde y afirmativo.
Encolado → **"Se enviará a `<email>`"**. Si el cobro descartó el email → aviso ámbar
"No se enviará: la dirección no es válida".

**En el histórico** (`TicketsHistoryPage.tsx`): cada ticket con email enseña su estado real —
enviado / pendiente / no se pudo enviar. Y `:666` deja de mentir: el texto de Holded se
sustituye por "Se enviará a `<email>`. Aparecerá como enviado en cuanto salga." Holded no
pinta nada aquí.

### Frente 4 · El fallo se ve

**El job llega a un estado terminal.** `ticket-email-worker.ts:27-51`, en el `failed` con
`attemptsMade >= MAX_ATTEMPTS`, además de `Ticket.email_failed_at` escribe
`ticket_email_jobs.status = 'FAILED'` con `last_error` poblado. Sin migración: la columna es
`String` libre y ya se usa con ese valor en `markFailed`.

**El motivo, en lenguaje de persona.** Un mapa de `last_error` → frase:

| Causa | Lo que ve Ana |
|---|---|
| `invalid_email` | "La dirección no es válida" |
| Rechazo del servidor de correo | "El servidor de correo la rechazó" |
| Timeout / conexión | "No hubo respuesta del servidor de correo" |
| Lo demás | "No se pudo enviar" |

**En el TPV** (sitio principal — Sole trabaja aquí, no en el panel): marca visible
"No se pudo enviar" con el motivo, y el campo de reenvío prellenado con el email guardado para
corregirlo y reenviar. Ya existe el input (`TicketsHistoryPage.tsx:750-765`); gana la
validación del Frente 1 y el estado del Frente 3.

**En el panel** (resumen para el propietario): sección nueva dentro de
`Tiendas › <tienda> › Comunicación de ticket`
(`StoreDetailPage.ticketDelivery.tsx`), debajo de la configuración que la gobierna.

**Decisión de producto · preguntada y resuelta con Matías (23-09).** No hay ningún listado de
tickets en el panel que vea el propietario. El único que existe, `/admin/tickets-errors`, se
llama "Sincronización con Holded", filtra `SYNC_FAILED` y está marcado `superAdminOnly`
(`AdminShell.tsx:161`), así que sólo aparece impersonando: **Sole nunca lo vería**, y es una
pantalla de Holded para una cosa que este bloque quiere sin Holded. Respuesta de Matías: la
sección de tienda **sí, pero no como único sitio** — el TPV es el sitio principal porque es
donde Sole trabaja; el panel queda como resumen para el propietario. Es lo que hace el plan.

Endpoint nuevo: `GET /admin/stores/:storeId/email-failures`, `requireOwnerOrManager`, al lado
de `/ticket-delivery` que ya existe.

### Frente 5 · La pantalla de "Ticket emitido" en la peluquería

`successOverlay.tsx:160-165`. Con `businessType === "SERVICES"` no se arma el `setTimeout`:
la pantalla se cierra con el botón "Nuevo servicio", que ya existe (`:467-468`).

Hostelería y tiendas, **idénticas**: 4 s, 8 s con vuelta, y las mismas pausas de hoy
(sub-modal abierto, imprimiendo, error de impresión, sin impresora).

Motivo: `autoClosePaused` (`:150-156`) ya cubre "el cajero está a mitad de algo", pero no
cubre "Ana está enseñándole el QR a la clienta mientras le cobra". En un bar el ticket se
imprime y se acabó; en una peluquería esta pantalla **es** la entrega.

---

## 3 · Lo que este plan NO toca

El `Reply-To` del sender (`apps/api/src/email/sender.ts` y `test/email-reply-to.test.ts` —
hay cambios sin commitear de otra conversación en el worktree principal: ni se tocan ni se
copian), la plantilla del email, el envío por Holded, la agenda, el fichaje, el camino de
cobro más allá del `emailIntent`, los triggers de S1 y Caddy.

**Cero migraciones.** Los tres campos que hacen falta —`Ticket.email_failed_at`,
`TicketEmailJob.status`, `TicketEmailJob.last_error`— ya existen y `status` es texto libre.

---

## 4 · Tabla de sabotaje (se rellena con los tests al cerrar cada frente)

| Sabotaje | Test que se pone rojo |
|---|---|
| Quitar la validación de la API en `resend-email` | `sole-ticket-email.e2e.ts` · resend con `"abc"` |
| Quitarla en el cobro | `sole-ticket-email.e2e.ts` · cobro con `"abc"` no encola |
| Volver a exigir el email en el esquema del documento | `ticket-model` · documento con email basura |
| Dejar el job en `PENDING` tras agotar intentos | `ticket-email-worker.test.ts` |
| Volver a poner "Enviado" al encolar | `tpv-web` · badge del overlay |
| Que `SERVICES` se autocierre | `tpv-web` · overlay sin autocierre |
| Que `HOSPITALITY` deje de autocerrarse | `success-overlay-autoclose.test.tsx` (ya existe, mockea `HOSPITALITY`) |

---

## 5 · Orden de trabajo

1. **F1** validación compartida + las tres rutas + el campo del TPV.
2. **F2** el documento deja de depender del email (schema + lectura) + el worker no insiste.
3. **F3** el estado real en el contrato y los dos textos falsos fuera.
4. **F4** estado terminal del job, motivo en castellano, TPV y panel.
5. **F5** el autocierre de la peluquería.
6. Bucle visual (390 / 1280×800 / AP12), e2e contra `mipiacetpv_sole_email_e2e`, `pnpm test`
   desde la raíz con `pnpm db:generate` antes, cruce de `git log HEAD..master`, y el done-doc.
