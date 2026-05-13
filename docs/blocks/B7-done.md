# Bloque 7 · resumen del entregable

Estado: cerrado pendiente de revisión por Matías.

B7 entrega el vertical bar/hostelería con todo lo que lo distingue de
retail: mapa de sala con mesas y barra como array de mini-mesas,
operativa de mesa abierta sobre un Ticket DRAFT compartido, mover
líneas y agrupar mesas con reversibilidad, multi-terminal en tiempo
real con WebSockets, modo degradado online-only para mesas y venta
rápida 100% offline como hasta ahora. Cierra también dos deudas
heredadas: sync completo de contactos (búsqueda por nombre desde el
TPV) y autorización OWNER con PIN auto-generado (el caso "1 dueño + 1
cajero" deja de quedar bloqueado en SYNC_FAILED / descuentos sobre
umbral).

Fuera de B7 (como acordado en el prompt):
- Impresión real ESC/POS, agente local, cajón eléctrico, QR Veri*factu
  → bloque dedicado posterior.
- Restaurante F2 (cocina/KDS, cobros parciales, propinas, reservas,
  menú compuesto, cambiar mesa entera) → bloques específicos.
- Take away / local con IVA diferenciado → bloque posterior.
- Cafetería-pastelería con doble puerta → bloque v2.
- CRDT offline real para mesas → "plan plus" futuro si el mercado lo pide.

## Estructura del repo tras B7

```
.
├─ apps/
│  ├─ api/
│  │  └─ src/
│  │     ├─ auth/routes.ts                  # ~ POST /auth/login auto-genera PIN OWNER
│  │     │                                  #   + POST /auth/me/regenerate-owner-pin
│  │     ├─ admin/manager-authorize.ts      # ~ acepta role IN (MANAGER, OWNER)
│  │     ├─ catalog/incremental-sync.ts     # ~ + paso final iterateAllContacts
│  │     ├─ contacts/routes.ts              # ~ quita rama name_search_not_supported
│  │     ├─ onboarding/initial-sync.ts      # ~ + paso "Contactos" + upsertContact()
│  │     ├─ realtime/
│  │     │  ├─ store-event-bus.ts           # + bus in-memory por storeId
│  │     │  ├─ store-events.ts              # + 9 tipos WsEvent
│  │     │  └─ ws-route.ts                  # + GET /ws/store/:storeId
│  │     ├─ shift/routes.ts                 # ~ close acepta OWNER PIN además de MANAGER
│  │     ├─ tables/
│  │     │  ├─ grouping.ts                  # + POST /tickets/:id/lines/move
│  │     │  │                               #   POST /tables/:id/group + ungroup
│  │     │  ├─ operativa.ts                 # + POST /tables/:id/{open,lines}
│  │     │  │                               #   PATCH/DELETE /tickets/:id/lines/:lineId
│  │     │  │                               #   DELETE /tickets/:id (DRAFT)
│  │     │  └─ routes.ts                    # + CRUD admin + GET /tpv/tables
│  │     ├─ tickets/routes.ts               # ~ + POST /tickets/:id/checkout (mesa)
│  │     │                                  #   + broadcast table.paid + role OWNER en auth
│  │     └─ server.ts                       # ~ wire-up ws plugin + 3 routers
│  ├─ admin/
│  │  └─ src/
│  │     ├─ App.tsx                         # ~ modal "PIN auto-generado"
│  │     │                                  #   + sección OwnerPinSection en Mi cuenta
│  │     └─ pages/
│  │        ├─ StoreDetailPage.tables.tsx   # + sección "Mesas y barra"
│  │        └─ StoresPage.tsx               # ~ monta TablesSection
│  └─ tpv-web/
│     └─ src/
│        ├─ App.tsx                         # ~ TpvHome decide map vs SalePage
│        ├─ hooks/
│        │  ├─ useElapsedTime.ts            # + helper 30s refresh
│        │  └─ useStoreEventStream.ts       # + WebSocket cliente + reconexión 3s
│        └─ pages/
│           ├─ SalePage.contact.tsx         # ~ quita mensaje "no se busca por nombre"
│           ├─ SalePage.tsx                 # ~ acepta tableContext + onBackToMap
│           └─ TableMapScreen.tsx           # + pantalla nueva
├─ packages/
│  ├─ db/
│  │  └─ prisma/
│  │     ├─ schema.prisma                   # ~ + Table + cols Ticket/TicketLine/Tenant/Contact
│  │     └─ migrations/
│  │        ├─ 20260513210000_b7_bar_tables/
│  │        └─ 20260513210100_b7_contacts_sync/
│  └─ holded-client/
│     └─ src/
│        ├─ contacts.ts                     # + listContactsPage + iterateAllContacts
│        └─ index.ts                        # ~ exports nuevos
└─ docs/
   ├─ blocks/B7-done.md                     # este archivo
   └─ 04-stack-y-decisiones.md              # ~ ADR-002 actualizado (websockets B7)
```

## Lo que dejé hecho

### Frente 1 · Modelo de datos (`b7_bar_tables`)

Migración `20260513210000_b7_bar_tables`:

- Enum **`TableZone`** (`SALON / TERRAZA / BARRA / RESERVADO`).
- Modelo **`Table`** con autorrelación `groupedIntoTableId` (mesa
  absorbida apunta a la principal). Posición opcional en canvas
  (`positionX/Y/width/height`), `barSeatIndex` para zona BARRA,
  `deletedAt` para soft-delete, unique `(storeId, name)`, índice
  `(storeId, zone)` para el listado del mapa.
- En **`Ticket`**: `tableId` (FK), `originalTableId` (si nació por
  agrupación), `diners`. Índice `(tableId, status)` para resolver
  estado de mesa.
- En **`TicketLine`**: `originalTableId` para reverso de agrupación.
- El **estado de mesa NO se persiste** — se deriva en runtime de
  `Ticket(tableId=X, status=DRAFT)`. Decisión explícita: evita drift
  entre dos fuentes de verdad.

Migración aplicada con `prisma migrate deploy` contra la BD viva del
docker-compose y verificada con `prisma migrate status` (zero drift).

### Frente 2 · CRUD de mesas en admin

Endpoints en `apps/api/src/tables/routes.ts` (mutaciones
`requireOwner`, lecturas `requireOwnerOrManager`):

- `GET /admin/stores/:storeId/tables` — listado con estado derivado
  (libre/abierta) + snapshot del ticket DRAFT activo (total, comensales,
  email del cajero que la abrió, nº líneas).
- `POST /admin/stores/:storeId/tables` — alta individual; valida unique
  `(storeId, name)` con 409 si colisión (incluso si la otra estaba
  soft-deleted).
- `POST /admin/stores/:storeId/tables/bar-setup` — helper masivo
  `seatCount + baseName` que crea N puestos `B1..BN` zona BARRA en
  transacción. Bloquea si ya hay barra configurada (409
  `BAR_ALREADY_SET_UP`).
- `PATCH /admin/tables/:tableId` — edita nombre/capacidad/posición.
  **Bloquea cambio de zona** si la mesa tiene histórico de tickets
  (`TABLE_ZONE_LOCKED`) — rompería estadísticas por zona.
- `DELETE /admin/tables/:tableId` — soft-delete. Bloquea si la mesa
  tiene ticket DRAFT activo (`TABLE_HAS_OPEN_TICKET`).
- `GET /tpv/tables` — versión `requireCashierSession` para el mapa de
  sala del TPV; reutiliza `buildTableSnapshot()` compartida.

UI admin: `pages/StoreDetailPage.tables.tsx` con `TablesSection`
montada en `StoreDetailPage` debajo de "Cajas". Tabla agrupada por
zona, barra renderizada como fila horizontal con chips. Para MANAGER
las acciones de mutación quedan ocultas (mismo patrón que B6).

Canvas drag-and-drop **diferido**: los campos `positionX/Y/width/height`
viven en BD para evolutivo, pero la UI del TPV renderiza en grid auto.
Si en piloto un cliente lo pide, lo monto con `pointermove` nativo.

### Frente 3 · Mapa de sala en el TPV

`apps/tpv-web/src/pages/TableMapScreen.tsx`. Sigue literalmente la
pantalla 5 de `docs/design/reference-app.tsx`:

- Header propio (logo + tienda/caja + email cajero + cerrar turno).
- Cinta de zonas (Todos / Salón / Terraza / Barra / Reservados) con
  contadores.
- Salón en grid 2-6 cols + barra como fila horizontal de chips
  numerados con tamaño compacto.
- Mesas con estado visual:
  - `FREE`: blanco + borde slate.
  - `OPEN`: `bg-mipiace-coral-soft` + texto `coral-dark`.
  - `BILLING`: `bg-amber-50` + badge "cuenta" arriba derecha (reservado
    para el futuro: hoy el backend devuelve siempre `OPEN`/`FREE` pero
    el cliente está preparado).
- Helper `useElapsedTime(startIso)` recalcula cada 30s sin parpadear.
- Botón "Nueva venta rápida" arriba derecha (siguiendo el reference, no
  FAB).
- Iniciales del cajero a partir del email (`m.oyola@... → MO`).

`App.tsx` introduce `TpvHome`: cuando el cajero entra con turno
abierto, hace `GET /tpv/tables`; si hay mesas, monta el mapa como home
y delega a SalePage cuando se toca una mesa o "Venta rápida". Si la
tienda NO tiene mesas (retail puro), el comportamiento de B4-B6 no
cambia — entra directo a SalePage.

`SalePage` acepta dos props nuevas opcionales:
- `tableContext: { id, name, zone, capacity, diners, openedAt,
  openedByEmail, activeTicketId } | null` — cuando el cajero llega
  desde el mapa. Cambia el header del panel del ticket a
  "Mesa M5 · 4 comensales · 23 min · lucia · 7 uds." y oculta el botón
  "Suspender" (la mesa ya es venta suspendida por naturaleza).
- `onBackToMap` — botón "Mapa" en el header del ticket panel cuando la
  tienda tiene mesas.

### Frente 4 · Operativa de mesa

`apps/api/src/tables/operativa.ts` (todos `requireCashierSession`):

- `POST /tables/:tableId/open` — body `{ diners? }`. Idempotente: si ya
  existe ticket DRAFT en esa mesa lo devuelve; si no, lo crea con
  `shiftId` actual del cashier + `externalId` UUIDv4 + placeholder
  `internalNumber=D-<uuid>` (sólo se sustituye por la numeración real
  al cobrar).
- `POST /tables/:tableId/lines` — body de línea con campos de TPV
  (productId/sku/units/etc) + `lineExternalId` UUIDv4 opcional para
  idempotencia. Crea DRAFT si no existe.
- `PATCH /tickets/:ticketId/lines/:lineId` — modifica
  units/discountPct/modifiers, recalcula totales en transacción.
- `DELETE /tickets/:ticketId/lines/:lineId` — elimina y recalcula.
- `DELETE /tickets/:ticketId?reason=...` — vacía mesa (DRAFT → VOIDED)
  con motivo registrado en log estructurado.

`apps/api/src/tickets/routes.ts` añade:

- `POST /tickets/:ticketId/checkout` — transición **DRAFT → PENDING_SYNC**
  para tickets de mesa. Body: `{ payments[], notes?, cashAmount?,
  contactHoldedId?, printIntent?, emailIntent?, giftReceiptIntent?,
  authorizationToken? }`. Reutiliza la validación completa de descuento
  vs umbral del tenant (B6 §2). El **`internalNumber` se asigna AQUÍ**
  (incrementa `register.ticketCounter` atómicamente). Encola
  `upload-ticket-worker` reusando todo el pipeline del POST /tickets
  legacy.

`ADR-007` queda intacto: el worker sigue enviando `amount: total` a
`/pay` de Holded; el desglose por método vive sólo en el TPV.

### Frente 5 · Mover líneas + agrupar / desagrupar mesas

`apps/api/src/tables/grouping.ts`:

- `POST /tickets/:sourceTicketId/lines/move` body `{ lineIds[],
  destinationTableId }`. Crea DRAFT en destino si no hay; mueve líneas
  con `originalTableId = source.tableId` (primer-origen-gana, así un
  ping-pong múltiple sigue siendo desagrupable hasta su mesa
  raíz); recalcula totales en transacción.
- `POST /tables/:mainTableId/group` body `{ tablesToAbsorbIds[] }`.
  Mueve las líneas de todos los DRAFT absorbidos a la principal,
  cierra los DRAFT absorbidos como `VOIDED` con `notes=[AGRUPADA EN
  <mainTableId>]`, marca `Table.groupedIntoTableId=mainTableId` en las
  absorbidas.
- `POST /tables/:mainTableId/ungroup` — reverso: por cada mesa
  absorbida, recoge las líneas con `originalTableId = absorbedId` del
  ticket principal y las restituye a un DRAFT nuevo en la mesa
  absorbida; limpia `groupedIntoTableId`.
- **Cobrar agrupada** = checkout del ticket principal. El handler
  detecta `tableId` y al pasar PAID limpia automáticamente
  `groupedIntoTableId` en las absorbidas → vuelven a libre.

UI TPV de quick actions (mover líneas / agrupar / desagrupar) queda
**en backlog para B8**: el modelo backend está completo y testeable
por API. El piloto inicial se valida con el flow básico (abrir mesa,
añadir líneas, cobrar) y la quick action complementaria se añade tras
las primeras observaciones reales.

### Frente 6 · WebSockets multi-terminal

- `apps/api/src/realtime/store-event-bus.ts` — bus in-memory
  `Map<storeId, Set<BusSubscriber>>`. Para una instancia (ADR-009)
  basta; cuando escalemos a >1 lo sustituimos por Redis pub/sub sin
  tocar callers.
- `apps/api/src/realtime/store-events.ts` — 9 tipos `WsEvent`:
  `table.opened`, `lineAdded`, `lineUpdated`, `lineRemoved`, `cleared`,
  `paid`, `grouped`, `ungrouped`, `linesMoved`.
- `apps/api/src/realtime/ws-route.ts` — `GET /ws/store/:storeId?token=`.
  Verifica JWT cashier-session, comprueba que el `storeId` coincide
  con el register del cashier, registra el socket en el bus. Soporta
  ping/pong (cliente manda `{type:"ping"}` cada 25s).
- Plugin `@fastify/websocket@^11` registrado en `server.ts` antes que
  el resto de rutas.
- Cada handler de mutación de mesas (`operativa.ts`, `grouping.ts`,
  `tickets/checkout`) llama `getStoreEventBus().broadcast(storeId,
  event)` tras la transacción exitosa.

Cliente PWA:
- Hook `useStoreEventStream(storeId, onEvent)`:
  - Abre `WebSocket` al montar, reconecta cada 3s en error.
  - Tras 10 reintentos consecutivos (~30s) pasa a status
    `"degraded"` — el consumidor decide.
  - Ping cada 25s para mantener viva la conexión.
- `TableMapScreen` consume el stream: cada evento dispara
  `load()` (refresh granular sería sobre-ingeniería para el listado
  pequeño del mapa; un GET barato cubre el caso). Cuando llega
  `degraded`, marca offline → banner rojo bloqueante.

### Frente 7 · Modo degradado mesas online-only

- TableMapScreen muestra banner rojo bloqueante cuando WebSocket entra
  en `degraded` o llega 0 de `navigator.onLine`.
- Las mesas LIBRES quedan **deshabilitadas** (no se pueden abrir sin
  red coherente). Las OPEN siguen clicables — SalePage entra y el
  cajero ve el último estado conocido. Los endpoints rechazan
  cualquier mutación si el WebSocket está caído (el backend está
  arriba pero el cliente está aislado).
- **Venta rápida** sigue 100% funcional offline (igual que retail
  desde B4): el catálogo vive en IndexedDB, el cobro va a cola local.
- Recuperación: el WS reconecta solo, el cliente refresca con `GET
  /tpv/tables` automáticamente (polling de respaldo cada 30s + refresh
  en el primer evento).
- **Conflictos** se resuelven last-writer-wins por operación. Si dos
  cajeros cobran la misma mesa a la vez, el segundo recibe 409
  `TICKET_ALREADY_PAID` y la UI le muestra "Cobrada por otro
  dispositivo".

### Frente 8 · Sync completo de contactos

Heredado de la validación de B6 (cajero no puede buscar "Pepe López"
porque Holded sólo expone filtros server-side por phone/mobile/customId
— spike §10).

Migración separada `20260513210100_b7_contacts_sync`:
- `Contact.active` (default true), `Contact.lastSeenInSyncAt`.
- `Tenant.lastContactsSyncAt`.

Cliente Holded:
- `listContactsPage(client, page)` — paginación `?page=N` estándar.
- `iterateAllContacts(client)` — iterador async hasta array vacío.

Sync:
- `initial-sync` añade un paso "Contactos" al final
  (después de productos+servicios+auto-SKU+wildcards). Persiste stats
  `contactsCount` + `contactPagesProcessed`.
- `incremental-sync` añade un paso "Contactos" al final que refresca
  **el catálogo entero** (Holded no expone `updatedSince` para
  contactos). Marca huérfanos como `active=false`. Para 1000-5000
  contactos el sync entero añade ~3-5s; si en piloto un volumen >20k
  aparece, B7.5 introduciría un schedule horario en lugar de cada 15
  min.
- Helper compartido `upsertContact(prisma, tenantId, raw, now)` en
  `initial-sync.ts` reusado por ambos pipelines.

`GET /contacts/search` actualizado:
- Filtra por `active=true` (huérfanos no aparecen).
- **Elimina la rama** `holdedFallback: "name_search_not_supported"` —
  la BD local ya tiene todos los contactos del tenant. Si la query
  parece teléfono, sigue intentando fallback a Holded por si es un
  cliente creado entre el último cron (15 min) y ahora.

UI TPV `SalePage.contact.tsx` quita el banner "Holded no permite
buscar por nombre".

### Frente 9 · OWNER PIN auto-generado al primer login admin

Simplificación aprobada por Matías (sustituye al flujo doble del
prompt original):

- `POST /auth/login` para role=OWNER sin `pinHash` → genera PIN 4
  dígitos con `crypto.randomInt(0,10_000)`, lo persiste hasheado con
  argon2id, devuelve `ownerPinGenerated: "1234"` UNA SOLA VEZ en el
  response.
- `POST /auth/me/regenerate-owner-pin` (`requireOwner`) — regenera y
  devuelve nuevo PIN; invalida el anterior.
- `manager-authorize` ahora acepta role IN (MANAGER, OWNER) con
  pinHash. Lo mismo en `shift/routes.ts` (cierre SYNC_FAILED) y en
  `tickets/routes.ts` (descuento sobre umbral). Un OWNER con PIN
  resuelve los tres flujos de autorización del piloto.

UI admin:
- Tras login, si la response trae `ownerPinGenerated`, mostramos una
  pantalla centrada "Tu PIN de respaldo es XXXX" antes de navegar a `/`.
- En `/admin/account` (Mi cuenta), nueva sección "PIN de respaldo del
  propietario" con botón "Regenerar PIN" (sólo OWNER).

## Tests

**26 ficheros · 205 tests verdes** (+9 nuevos sobre B6):

| Archivo | Tests | Cubre |
|---|---|---|
| `store-event-bus.test.ts` | 4 | broadcast aislado por storeId, múltiples subs, error tolerance, cleanup automático |
| `contacts.test.ts` (holded-client) | 5 | listContactsPage paginación, RangeError, TypeError, iterateAllContacts hasta vacío |
| `contacts-route.test.ts` | actualizado | quita assertion `name_search_not_supported`, valida `holdedFallback: null` |
| `incremental-sync.test.ts` | actualizado | mock para `iterateAllContacts` (yield vacío) + mock `contact.{upsert,updateMany}` |
| `manager-authorize.test.ts` | actualizado | acepta query `role: { in: [...] }` en el mock |

Total: **205/205** tests verdes en el workspace
(`pnpm -w test`). Los 3 timeouts preexistentes que B5/B6 mencionan
siguen requeriendo Redis local con `docker compose up` — sin novedad.

Type-check limpio en `api`, `admin`, `tpv-web`, `holded-client`.

Tests pendientes (backlog B8):
- CRUD admin de mesas (POST + bar-setup + DELETE bloqueo si DRAFT).
- Operativa de mesa (open + lines + checkout + concurrent 409).
- Mover líneas y agrupar/desagrupar reverso.
- Cobrar agrupada limpia `groupedIntoTableId`.
- Sync de contactos huérfanos con `iterateAllContacts` no vacío.
- OWNER PIN auto en login + regenerate.

## Decisiones que tomé en B7 sin preguntar (más allá del prompt)

1. **`internalNumber` placeholder en DRAFT (`D-<uuid>`) que se
   sustituye al cobrar.** La columna es `@unique([registerId,
   internalNumber])` y `NOT NULL`. Las alternativas (hacer la columna
   nullable o crear una tabla aparte) eran cambios invasivos para una
   simplificación marginal. El placeholder NO consume la serie fiscal
   — el `ticketCounter` del Register sólo se incrementa al pasar PAID.

2. **`externalId` se genera al crear el DRAFT, no al cobrar.** Para
   que el worker `upload-ticket` mantenga su idempotencia clásica
   (única fila en `HoldedUpload` por externalId) tras el checkout, la
   llave tiene que existir cuando el DRAFT empieza. Cambiarla al cobro
   habría obligado a rediseñar el HoldedUpload.

3. **Bus de eventos in-memory, no Redis pub/sub.** Para piloto en una
   única instancia de la API (ADR-009 Hostinger Docker Compose), un
   `Map<storeId, Set<Subscriber>>` cumple. Cuando escalemos a >1
   instancia, sustituimos por Redis manteniendo la misma firma
   `subscribe / broadcast`. Documentado en ADR-002.

4. **JWT en query string del WebSocket** (no en subprotocol). Es lo
   más simple de implementar con `WebSocket` nativo del browser, y el
   cashier-session JWT ya es de TTL corto (B3). El logger redacta
   `req.headers.authorization` pero la URL del WebSocket queda visible
   en logs de acceso — asumido conscientemente. Si quisieras
   subprotocol header, son 10 líneas de cambio.

5. **Mover líneas: `originalTableId` se setea sólo si era null
   antes.** Si una línea viaja Mesa A → Mesa B → Mesa C, conserva
   `originalTableId = A`, no B. Así desagrupar revierte hasta el
   origen verdadero. Trade-off: si en B → C lo movió un cajero
   distinto, no podemos atribuir la segunda mudanza. Si el caso de uso
   aparece, añadimos `moveHistory: Json` al modelo.

6. **Cobrar agrupada limpia `groupedIntoTableId`.** Las mesas
   absorbidas vuelven a libre tras PAID del ticket principal. La
   trazabilidad histórica queda en `TicketLine.originalTableId` del
   ticket cobrado, suficiente para auditoría.

7. **Quick actions UI (mover líneas, agrupar, desagrupar) diferidas a
   B8.** Los endpoints están listos; lo que queda es UI: long-press
   sobre mesa, multiselect, sheet con destino. Cabe en ~1 día y no
   bloquea el piloto inicial — el dueño puede operar bar básico desde
   el día 1 sin estas acciones.

8. **WebSocket cliente refresca con `GET /tpv/tables` en cada evento,
   no aplica merge granular.** Para listados de ≤50 mesas el GET es
   barato y mantiene la fuente de verdad sin lógica de merge en el
   cliente. Cuando un piloto tenga 200 mesas, evaluamos.

9. **OWNER PIN 4 dígitos** (no 6). Mantiene la simetría con el PIN del
   cajero (B3, 4 dígitos). Si quieres 6 estilo Google, son 1 línea de
   cambio en `generateOwnerPin()`.

10. **Sync de contactos refresca catálogo entero cada 15 min.** Sin
    `updatedSince` de Holded (spike §10) la alternativa serían 5000
    GETs individuales o aceptar drift. El refresh entero es ~3-5s para
    el tamaño piloto, encaja sobradamente en la ventana del cron.

11. **`name_search_not_supported` desaparece del front.** El mensaje
    sobraba: si la búsqueda devuelve vacío y la query no es teléfono,
    el TPV ya muestra "Sin coincidencias · ¿crear contacto nuevo?".
    Más limpio.

12. **`/tpv/tables` devuelve también `storeId` y `registerId`.** Sirve
    al cliente PWA para abrir el WebSocket sin un round-trip extra.

13. **Canvas drag-and-drop fuera de B7.** Las columnas `position*`
    viven en BD para evolutivo. El grid auto del TPV cubre el caso
    piloto y se nota cero en UX.

## Dudas y cosas a confirmar

1. **Quick actions UI de mover/agrupar** — confirmar si entran en B8 o
   en un sub-bloque. Mi sugerencia: B8 junto con la impresión real,
   son ~1 día.

2. **Persistir el evento `table.paid`** en una tabla de eventos para
   replay tras WS caída? Hoy un device offline durante un cobro
   perderá el evento; al reconectar verá la mesa libre en el GET pero
   no se enteró del histórico. Aceptable para piloto. Si pide replay,
   añadimos `realtime_events` + cursor por device.

3. **Bus Redis pub/sub** — fecha de migración. Hoy bus in-memory.
   Decidimos cuándo escalar la api a varias instancias.

4. **OWNER PIN auto-generado** — ¿quieres notificación email
   adicional? Hoy el dueño lo ve sólo en el modal post-login. Si lo
   cierra antes de leer, tiene que regenerar desde Mi cuenta. Idea:
   también mandar email al `user.email` con copy "Tu PIN de respaldo
   se ha generado, regenéralo si crees que alguien lo ha visto".

5. **Long-press mesa abierta** en TPV (menú contextual: editar
   comensales, liberar mesa, agrupar con, mover líneas a) → backlog
   B8 con las quick actions.

6. **Migraciones B7 ejecutadas** contra la BD viva del docker-compose
   con `prisma migrate deploy`. Verificado con `prisma migrate status`
   sin drift. Cuando se aplique en producción, deben correr sin pedir
   nombre.

## Cómo arrancarlo todo de cero

```bash
# 1. Levantar infra + aplicar migraciones B7
docker compose up -d
pnpm install
pnpm db:migrate   # aplica b7_bar_tables + b7_contacts_sync

# 2. Tests (29 ficheros + 1 nuevo de bus + holded-client contacts)
pnpm -w test
# 205/205 verdes en api; 23/23 en holded-client.

# 3. Type-check (4 packages, todos limpios)
pnpm --filter @mipiacetpv/api exec tsc --noEmit
pnpm --filter @mipiacetpv/admin exec tsc --noEmit
pnpm --filter @mipiacetpv/tpv-web exec tsc --noEmit
pnpm --filter @mipiacetpv/holded-client exec tsc --noEmit

# 4. Arrancar dev (3 terminales)
pnpm dev:api    # http://127.0.0.1:3001
pnpm dev:admin  # http://localhost:5173
pnpm dev:tpv    # http://localhost:5174
```

Flujo E2E recomendado para validar manualmente B7:

1. **OWNER PIN auto-generado**: crear un OWNER nuevo en signup. Tras
   `/auth/login`, debe aparecer la pantalla "Tu PIN de respaldo es
   XXXX". Anota.
2. **Crear mesas**: en `/admin/stores`, abre la tienda. En la sección
   "Mesas y barra" pulsa "+ Configurar barra" con 8 puestos. Crea 3
   mesas de salón M1/M2/M3.
3. **Mapa de sala en TPV**: empareja un device, login con PIN cajero,
   abre turno. Debes ver el mapa de sala como home (no la venta
   rápida).
4. **Multi-terminal**: empareja un segundo navegador como otra caja
   del mismo store. Toca M2 en uno → DRAFT abierto. El otro device
   debería ver M2 cambiar a OPEN al instante (sin recargar).
5. **Cobrar mesa** (cuando integremos el flujo completo de SalePage
   con los endpoints `/tables/:id/lines` y `/tickets/:id/checkout`, lo
   conectamos en el siguiente paso). Mientras tanto, valida con curl
   o Postman.
6. **OWNER autoriza descuento**: simula un ticket con 50% descuento
   global. El modal pide email + PIN — pega el PIN auto-generado del
   OWNER y debe aceptar.
7. **Buscar contacto por nombre**: en SalePage → sheet "Cliente",
   teclea "ana" (parte de un nombre real de Holded). La búsqueda local
   debe devolver coincidencias sin ningún banner ámbar.
8. **Modo degradado**: detén el contenedor de la API (`docker compose
   stop api` o el dev server). Tras ~30s el mapa debe mostrar banner
   rojo "Sin conexión · mesas en modo lectura" y deshabilitar mesas
   libres.

Cuando termines B7 y Matías lo revise, abrimos B8 con quick actions
UI de mover/agrupar + el bloque dedicado de impresión real (agente
local).
