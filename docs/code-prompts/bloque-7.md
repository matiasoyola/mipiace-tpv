# Prompt para Claude Code — Bloque 7

Pega esto en una sesión nueva de Claude Code una vez B6 esté
mergeado en GitHub.

---

Hola Code. Arrancamos B7 — el vertical bar/hostelería con todo lo
que lo distingue de retail: mesas con mapa visual, barra como
array de mini-mesas, mover líneas, agrupar mesas, multi-terminal
en tiempo real con WebSockets.

## Contexto

B1 + B2 + B3 + B4 + B5 + B6 commiteados y pusheados (`5a43aad`,
`535b3e1`, `1027211`, `c616b93`, `7ff986c`, `bb9bb00`). Lee
primero:

- `docs/blocks/B1-done.md` ... `B6-done.md` — memoria persistente.
- `docs/verticals/bar.md` — el doc del vertical bar con todas las
  decisiones cerradas durante el diseño. **Lectura obligatoria
  antes de tocar código.**
- `docs/07-nucleo-comun.md` §6 (venta), §7 (cobro), §17.4 (alerta
  device).
- `docs/04-stack-y-decisiones.md` ADR-002 (websockets ahora
  obligatorios para bar), ADR-007 (TPV deposita desglose pagos),
  ADR-010 (GET-back), ADR-011 (portabilidad).
- `docs/design/tokens.md` y `reference-app.tsx` — el mapa de sala
  (pantalla 5) y la mesa abierta (pantalla 6) ya están diseñados.
  Copia patrones literales.
- `docs/ux-principles.md` §3.2 (tiempo en mesa visible), §2.6
  (saltar entre mesas con un toque).

Antes de tocar código, **resume lo que entiendes** y plantéa
discrepancias. Sin luz verde no empieces.

## Bloque 7 · Vertical bar (mesas + multi-terminal websockets)

### Resumen del alcance

Nueve frentes en orden de dependencia (frente 8 añadido durante la
revisión de B6 — sync de contactos detectado como necesario para
piloto bar/retail):

1. **Modelo de datos** — `Table` (mesa lógica), agrupación,
   reutilización de `Ticket` con `status=DRAFT` para mesa abierta.
2. **CRUD de mesas en admin** dentro del detalle de tienda (mesas
   por zona, configuración de zona barra como array de mini-mesas).
3. **Mapa de sala en el TPV** — pantalla nueva con estados
   visuales en tiempo real (libre / ocupada / cobrando).
4. **Operativa de mesa** — abrir, añadir líneas, modificar,
   suspender, cobrar. Reutiliza SalePage y CheckoutPage de B4 con
   adaptaciones.
5. **Mover líneas entre mesas y agrupar mesas** con reversibilidad
   (badge "agrupada ×3", desagrupar antes de cobrar).
6. **Multi-terminal en tiempo real con WebSockets** — el camarero
   A en la barra ve los cambios que hace el camarero B en el
   salón al instante.
7. **Modo degradado mesas online-only** — si cae la red, mesas en
   read-only, venta rápida sigue local. Sin offline-CRDT.

Fuera de B7 explícito:
- **Impresión real ESC/POS, agente local, cajón eléctrico, QR
  Veri*factu** → bloque dedicado posterior.
- **Restaurante F2**: envío a cocina/KDS, cobros parciales,
  división por comensales, propinas, reservas, menú del día
  compuesto → bloques posteriores específicos.
- **Take away vs local con IVA diferenciado** → bloque restaurante.
- **Cafetería-pastelería con doble puerta** → bloque dedicado v2.
- **CRDT offline real para mesas** → "plan plus" futuro si el
  mercado lo pide (ver `docs/verticals/bar.md` §6.2).

### 1. Modelo de datos

#### 1.1 Schema nuevo

Migración `b7_bar_tables`. Añade:

```prisma
enum TableZone {
  SALON
  TERRAZA
  BARRA
  RESERVADO
}

enum TableState {
  FREE       // disponible
  OPEN       // tiene un Ticket DRAFT activo
  BILLING    // pidiendo cuenta (estado UX, opcional)
}

model Table {
  id              String     @id @default(uuid()) @db.Uuid
  storeId         String     @map("store_id") @db.Uuid
  name            String                                    // "M1", "B3", "Reservado 2"
  capacity        Int        @default(2)
  zone            TableZone  @default(SALON)
  // Posición opcional en el canvas (admin). Si null, render en grid auto.
  positionX       Int?       @map("position_x")
  positionY       Int?       @map("position_y")
  width           Int?       // canvas tamaño relativo
  height          Int?
  // Para zona BARRA: si el padre es una "barra" lógica, este campo
  // permite ordenarlas como array (B1, B2, B3...). Si la barra tiene
  // 8 puestos, el admin crea 8 Tables con barSeatIndex 1..8.
  barSeatIndex    Int?       @map("bar_seat_index")
  deletedAt       DateTime?  @map("deleted_at") @db.Timestamptz()
  createdAt       DateTime   @default(now()) @map("created_at") @db.Timestamptz()

  store           Store      @relation(fields: [storeId], references: [id], onDelete: Cascade)
  tickets         Ticket[]
  // Agrupación: si esta mesa está absorbida por otra principal.
  groupedIntoTableId String?  @map("grouped_into_table_id") @db.Uuid
  groupedInto     Table?     @relation("TableGrouping", fields: [groupedIntoTableId], references: [id])
  absorbedTables  Table[]    @relation("TableGrouping")

  @@unique([storeId, name])
  @@index([storeId, zone])
  @@index([groupedIntoTableId])
  @@map("tables")
}
```

#### 1.2 Cambios sobre `Ticket`

```prisma
model Ticket {
  // ... (todo lo que ya tenía)
  tableId         String?  @map("table_id") @db.Uuid
  table           Table?   @relation(fields: [tableId], references: [id])
  // Cuando una línea proviene de otra mesa por mover/agrupar, queda registrado.
  originalTableId String?  @map("original_table_id") @db.Uuid

  @@index([tableId, status])
}

model TicketLine {
  // ... (todo lo que ya tenía)
  // Si esta línea fue movida desde otra mesa, queda registrado el origen.
  originalTableId String?  @map("original_table_id") @db.Uuid
}
```

El **estado de mesa se deriva** de la presencia de `Ticket` con
`status=DRAFT` y `tableId` apuntando a ella. No persistimos
`Table.state` para evitar drift entre dos fuentes de verdad.

#### 1.3 Ciclo de vida del ticket

- **Mesa abierta** = `Ticket` con `status=DRAFT, tableId=<mesa>,
  shiftId=<turno actual>`.
- **Añadir línea** = `POST /tables/:tableId/lines` (nuevo, no
  reusa `POST /tickets` que era para cobros directos).
- **Cobrar mesa** = transición `DRAFT → PAID` con flujo de cobro
  existente (CheckoutPage). El worker `upload-ticket` sube a
  Holded como hasta ahora.

### 2. CRUD mesas en admin

Dentro de `/admin/stores/:storeId` (página existente desde B4),
añade sección "Mesas y barra".

#### 2.1 Backend endpoints

Todos `requireOwner` (los managers no editan estructura de mesas):

- **`POST /admin/stores/:storeId/tables`** — body `{ name,
  capacity, zone, positionX?, positionY?, barSeatIndex? }`.
  Valida unique `(storeId, name)`.
- **`PATCH /admin/tables/:tableId`** — editar nombre, capacidad,
  posición, zona. **Bloquea cambio de zona si la mesa tiene
  histórico de tickets**.
- **`DELETE /admin/tables/:tableId`** — soft-delete. Sólo si no
  tiene `Ticket DRAFT` activo.
- **`POST /admin/stores/:storeId/tables/bar-setup`** — body
  `{ seatCount, baseName?: "B" }`. Helper para crear N mesas
  zona=BARRA con `barSeatIndex=1..N` de un golpe ("Barra con 8
  puestos" → genera B1..B8).
- **`GET /admin/stores/:storeId/tables`** — lista todas las
  mesas activas + agrupadas. MANAGER puede leer (solo lectura
  desde su rol).

#### 2.2 UI admin

`StoreDetailPage` (existe desde B4) añade sección "Mesas" debajo
de "Cajas":

- **Tabla de mesas** con nombre / zona / capacidad / estado
  derivado (libre/ocupada) / acciones.
- **Botón "+ Nueva mesa"** → modal: nombre, capacidad,
  selector de zona (SALON/TERRAZA/BARRA/RESERVADO).
- **Botón "+ Configurar barra"** (sólo si no hay barra ya con
  seats) → modal con `seatCount`. Genera B1..BN.
- **Botón "Distribuir mesas (opcional)"** → canvas básico
  drag-and-drop sobre un fondo gris. Persiste positionX/Y/width/
  height. Si no se distribuyen, render en grid auto.

El canvas es opcional. MVP funcional sin él. Implementación
mínima: usa `pointermove` nativo, sin librería. Si Code prefiere
omitirlo en B7 y dejarlo en backlog, está OK — el grid auto
cubre el caso.

### 3. Mapa de sala en el TPV

Pantalla nueva `apps/tpv-web/src/pages/TableMapScreen.tsx`. Mockup
referencia: pantalla 5 de `docs/design/reference-app.tsx`.

#### 3.1 Estructura visual

- **Header** (existente): logo + búsqueda + Mesa N + bell + avatar.
- **Botones zona** en cinta superior: Salón / Terraza / Barra /
  Reservados / Todos. Filtran la vista.
- **Cuadrícula de mesas** del salón si filtro = Salón/Todos:
  - Cada mesa renderiza con su nombre grande, capacidad, **tiempo
    desde apertura si OPEN** (ej. "23 min", calculado client-side
    del `Ticket.createdAt`), **importe acumulado** del ticket
    DRAFT, **comensales** (opcional, si se introduce al abrir).
  - Estados visuales:
    - LIBRE: blanco con borde slate.
    - OPEN: `bg-mipiace-coral-soft` con border `coral/40`, texto
      coral-dark.
    - BILLING: `bg-amber-50` border amber. Badge "cuenta" arriba
      derecha.
  - Tamaño según `width/height` del canvas si configurado, si no
    `aspect-[7/6]` default.
- **Barra como fila horizontal** de N celdas pequeñas numeradas
  (B1, B2, ...). Mismos estados con visualización compacta.
- **Botón "Venta rápida"** en bottom-right (FAB) — sigue
  permitiendo el flujo del café para llevar sin mesa.

#### 3.2 Interacción

- **Tap mesa libre** → diálogo rápido "Comensales: (input) ·
  Abrir". Crea `Ticket DRAFT` con `tableId=<mesa>` y redirige a
  SalePage con `?tableId=<mesa>`.
- **Tap mesa ocupada** → redirige directo a SalePage cargando ese
  ticket DRAFT.
- **Tap mesa agrupada** → redirige al ticket DRAFT de la mesa
  principal del grupo.
- **Long press / right-click mesa** → menú contextual: Editar
  comensales, Liberar mesa (si no tiene líneas), Agrupar con...,
  Mover líneas a...

#### 3.3 Tiempo en mesa visible (UX §3.2)

Helper `useElapsedTime(startTimestamp)` que recalcula cada 30s.
Muestra "12 min", "1 h 04 m", etc. Sin parpadear.

### 4. Operativa de mesa (reutiliza SalePage + CheckoutPage de B4)

#### 4.1 SalePage adaptado

`apps/tpv-web/src/pages/SalePage.tsx` cuando recibe `?tableId=`
en la URL o el ticket cargado tiene `tableId != null`:

- **Header del ticket panel** cambia: "Ticket de venta" → "Mesa
  N · 4 comensales · 23 min · Lucía". Datos de la mesa visibles
  arriba.
- **Quick actions** incluyen acción nueva "Mover líneas" y
  "Agrupar con..." (ver §5).
- **Botón "Cobrar"** funciona igual: lleva a CheckoutPage. Tras
  cobrar exitoso, la mesa vuelve a estado libre automáticamente
  (porque ya no hay Ticket DRAFT).

#### 4.2 Endpoints nuevos

- **`POST /tables/:tableId/lines`** (`requireCashierSession`):
  body de la línea (productId/sku/units/etc.). Crea `Ticket
  DRAFT` si no existe para esa mesa en el turno actual, añade
  línea. Devuelve el ticket actualizado.
- **`PATCH /tickets/:ticketId/lines/:lineId`**: modificar
  cantidad, descuento, modificadores.
- **`DELETE /tickets/:ticketId/lines/:lineId`**: eliminar línea.
- **`DELETE /tickets/:ticketId`** (sólo si `DRAFT`, no PAID):
  vaciar mesa con motivo registrado. Audit log.

#### 4.3 Suspender no aplica en mesa

`Suspender venta` (parking) era para retail. En bar, la mesa
abierta YA es "venta suspendida" por naturaleza. Oculta el
botón Suspender cuando hay `tableId`.

### 5. Mover líneas entre mesas + agrupar mesas

#### 5.1 Mover líneas

Endpoint **`POST /tickets/:sourceTicketId/lines/move`** body:

```ts
{
  lineIds: string[],          // líneas a mover
  destinationTableId: string,
  cashier: { ... }            // del session JWT
}
```

Backend:
1. Carga `sourceTicket` (debe ser DRAFT).
2. Encuentra o crea `Ticket DRAFT` en `destinationTableId`
   (mismo turno y store).
3. Mueve cada línea: actualiza `ticketId`, persiste
   `originalTableId` en la línea para reverso.
4. Recalcula totales de ambos tickets.
5. **Broadcast WebSocket** a los devices de la tienda (ver §6).

UI TPV: desde Quick Actions → "Mover líneas" → seleccionar
líneas con checkbox → seleccionar mesa destino → confirmar.

#### 5.2 Agrupar mesas

Endpoint **`POST /tables/:mainTableId/group`** body:

```ts
{ tablesToAbsorbIds: string[] }
```

Backend:
1. Verifica que `mainTableId` y todos los `tablesToAbsorbIds`
   tienen `DRAFT` tickets en el mismo turno y store.
2. Mueve todas las líneas de los tickets absorbidos al ticket
   principal (con `originalTableId` poblado).
3. Cierra los tickets absorbidos como `VOIDED` con motivo
   `grouped_into_<mainTableId>`.
4. Marca `Table.groupedIntoTableId = mainTableId` en las
   absorbidas.
5. **Broadcast WebSocket**.

UI TPV: pulsa una mesa libre o con DRAFT → menú contextual →
"Agrupar..." → multiselección de mesas a absorber → confirmar.

#### 5.3 Desagrupar

Endpoint **`POST /tables/:mainTableId/ungroup`**:
- Sólo si el ticket principal no ha sido cobrado.
- Revierte cada línea a su `originalTableId` si existe.
- Re-crea tickets DRAFT en las mesas absorbidas con sus líneas
  originales.
- Limpia `Table.groupedIntoTableId`.
- Broadcast WebSocket.

UI TPV: en mesa principal con badge "agrupada ×3" → menú →
"Desagrupar". Confirmar.

#### 5.4 Cobrar agrupada

Cobrar el ticket principal cierra todo de una vez. Las mesas
absorbidas vuelven a estado libre automáticamente al pasar el
ticket a PAID.

### 6. Multi-terminal con WebSockets

Lo imprescindible del bar (ADR-002, núcleo §6.6 implícito).

#### 6.1 Stack

`fastify-websocket` plugin. Endpoint `/ws/store/:storeId` que
requiere `cashier-session` JWT (pasado vía query param
`?token=...` o subprotocol header — JWT en query es lo más simple
para WS).

Cliente PWA usa `WebSocket` nativo + reconexión con backoff.

#### 6.2 Eventos broadcast

Cuando algo cambia en una mesa, el backend hace broadcast a todos
los devices con WS abierto suscritos a esa store:

```ts
type WsEvent =
  | { type: 'table.opened', tableId, ticketId, by: cashierEmail }
  | { type: 'table.lineAdded', tableId, ticketId, line }
  | { type: 'table.lineUpdated', tableId, ticketId, line }
  | { type: 'table.lineRemoved', tableId, ticketId, lineId }
  | { type: 'table.cleared', tableId, ticketId, reason }
  | { type: 'table.paid', tableId, ticketId, holdedDocNumber? }
  | { type: 'table.grouped', mainTableId, absorbedIds[] }
  | { type: 'table.ungrouped', mainTableId }
  | { type: 'table.linesMoved', sourceTableId, destinationTableId, lineIds }
```

#### 6.3 Conflictos

**Last-writer-wins por operación** (lo más simple):

- Si dos camareros añaden línea a la vez → ambas se aceptan (son
  operaciones aditivas distintas).
- Si uno modifica cantidad y otro elimina la misma línea a la
  vez → la última operación que llega al backend gana. Si la
  eliminación llega después, la línea queda eliminada.
- Si un cobro llega mientras otro está editando líneas → el cobro
  bloquea el ticket (transición DRAFT → PAID). Modificaciones
  posteriores rechazadas con 409 `TICKET_ALREADY_PAID`.

#### 6.4 Cliente PWA

Hook nuevo `useStoreEventStream(storeId)`:
- Abre WebSocket al montar.
- Reconecta cada 3s en error.
- Despacha eventos a un store global (Zustand opcional, o
  contexto React) que TableMapScreen y SalePage consumen.
- Cuando llega un evento que afecta a la mesa abierta del
  cajero, el ticket se refresca silenciosamente.

### 7. Modo degradado mesas online-only

#### 7.1 Detección

El cliente PWA detecta offline cuando:
- La WebSocket se cae y no reconecta en 30s.
- O `navigator.onLine === false`.

#### 7.2 Comportamiento

Cuando offline:
- **Mapa de sala** → read-only con banner rojo "Sin conexión ·
  mesas en modo lectura". Los datos quedan congelados al último
  estado conocido.
- **Apertura de mesa** → deshabilitada (necesita backend para
  reservar la mesa coherentemente).
- **Modificación de mesa abierta en el device propio** → cae a
  modo "edición local pesimista": los cambios se guardan en
  IndexedDB y la PWA pide al cajero **continuar SOLO en este
  device** (el resto de cajeros no verán los cambios). Banner
  amarillo persistente.
- **Cobrar mesa** → sí permitido (es la operación crítica). Va
  a cola local igual que la venta rápida offline. Cuando vuelva
  la red, sync con Holded.
- **Venta rápida** → 100% funcional offline (igual que retail).

#### 7.3 Recuperación

Cuando la WebSocket vuelve a conectar:
- La PWA hace `GET /tables/state?storeId=...` para refrescar
  todas las mesas desde fuente de verdad.
- Si había ediciones locales pesimistas, las concilia: si la
  mesa sigue en el mismo `DRAFT` sin cobros posteriores,
  reenvía las operaciones. Si la mesa ha cambiado sustancialmente
  (cobrada por otro device, agrupada, etc.), pierde las
  ediciones locales con notificación clara al cajero.

### 8. Sync completo de contactos + búsqueda por nombre

Heredado de B2 como deuda y detectado al validar B6: el cajero no
puede buscar clientes por nombre porque Holded sólo expone filtros
server-side `phone`/`mobile`/`customId`. Lo arreglamos sincronizando
todo el catálogo de contactos a la tabla local `Contact` que ya
existe desde B2.

#### 8.1 Cliente Holded

`packages/holded-client/src/contacts.ts` añadir:

- `listContactsPage(client, page: number)`: paginación estándar
  `?page=N`, igual que productos (spike §02.B mismo patrón).
- `iterateAllContacts(client)`: async iterator yield por página
  hasta array vacío.

#### 8.2 Sync inicial

`apps/api/src/onboarding/initial-sync.ts` añade un paso nuevo
**después de productos+servicios+auto-SKU+wildcards**:

- Itera `iterateAllContacts`.
- Upsert en `Contact` por `(tenantId, holdedContactId)`.
- Persiste stats `contactsCount` en `tenant.initialSyncStats`.

#### 8.3 Sync incremental

`apps/api/src/catalog/incremental-sync.ts` añade un paso nuevo
**al final**:

- Itera `iterateAllContacts` igual que el inicial (sin diff
  incremental porque Holded no expone `updatedSince`).
- Upsert por `(tenantId, holdedContactId)`.
- Marca huérfanos como inactivos (mismo patrón que productos
  con `lastSeenInSyncAt` + `active=false` al final).
- Persiste stats.

Esto significa que en cada cron de 15 min se refresca el catálogo
completo de contactos. Para 1000-5000 contactos por tenant es
trivial (~3-5s adicionales). Si en algún piloto el volumen sube
mucho (>20000), B7.5 introduciría `lastContactsRefreshAt` con
política horaria en lugar de cada 15 min.

#### 8.4 Schema mínimo

Añadir a `Contact` (si no estaba ya desde B2):

```prisma
active             Boolean   @default(true)
lastSeenInSyncAt   DateTime? @map("last_seen_in_sync_at") @db.Timestamptz()
```

Misma semántica que productos.

Añadir a `Tenant`:

```prisma
lastContactsSyncAt DateTime? @map("last_contacts_sync_at") @db.Timestamptz()
```

Migración: incluida en `b7_bar_tables` o `b7_contacts_sync`
separada según prefieras (sugerencia: la separada es más limpia,
permite rollback aislado).

#### 8.5 Eliminar fallback `name_search_not_supported`

`apps/api/src/contacts/routes.ts` `GET /contacts/search`:

- La búsqueda local ya cubre name/email/nif/phone con `LIKE`
  case-insensitive (desde B2).
- **Quitar la rama** que devolvía `holdedFallback:
  "name_search_not_supported"` cuando query es texto. Ahora todos
  los contactos están en local.
- Mantener el fallback de teléfono → consulta Holded → upsert si
  un cliente nuevo se asocia in-fly (caso de cliente que nunca ha
  estado en local pero el cajero tiene su teléfono).

#### 8.6 UI TPV

Cuando el cajero teclea "Pepe" en el sheet de cliente, la
búsqueda devuelve resultados locales reales. **Quitar el mensaje
"Holded no permite buscar por nombre"**. Si la búsqueda no
devuelve nada → "Sin coincidencias · ¿crear contacto nuevo?".

#### 8.7 UI admin (opcional, ahorrable)

Si te apetece, añade botón **"Refrescar contactos ahora"** en
`/admin/settings` o en `Mi cuenta` que dispare el sync incremental
manual (`POST /catalog/sync-now` ya existe pero hoy sólo trae
catálogo de productos — extenderlo o crear endpoint paralelo
`POST /contacts/sync-now`).

### 9. Edge case heredado · tenant sin MANAGER

B6 dejó pendiente que si un tenant no tiene MANAGER con PIN, el
cajero queda bloqueado al cerrar con SYNC_FAILED y al aplicar
descuentos sobre umbral. En B7:

- **`POST /admin/auth/owner-authorize`** (nuevo, `requireOwner`):
  el OWNER autoriza desde admin con su password (no PIN). Mismo
  formato de respuesta que `manager-authorize`: JWT corto con
  `purpose=discount-override` o `sync-failed-close`.
- UI admin: en la bandeja SYNC_FAILED y en la pantalla del PIN
  encargado del TPV (cuando el TPV detecta que el tenant no tiene
  MANAGER), aparece un botón "Solicitar autorización del
  propietario" que muestra un PIN de 6 dígitos generado en el TPV
  y un endpoint server-side al que el OWNER llama desde admin con
  ese PIN + su password. Cierra el flujo cuando OWNER firma.

Mejorable. Si Code lo simplifica con OWNER teniendo siempre PIN
automático tras login admin, también vale — siempre que el caso
"1 dueño + 1 cajero" no quede bloqueado.

### 9. Tests

- Modelo mesas: CRUD, validación zona, agrupación.
- Mapa de sala: estado derivado de tickets DRAFT.
- Operativa: abrir, añadir línea, modificar, eliminar, cobrar
  pasa a PAID.
- Mover líneas: source y destination tickets se actualizan,
  originalTableId persiste.
- Agrupar/desagrupar: ticket principal absorbe, mesas absorbidas
  quedan VOIDED, ungroup revierte. Cobrar agrupada cierra todo.
- WebSocket: subscripción por storeId, broadcast en eventos,
  reconexión cliente. Tests con `WebSocket` mock.
- Modo degradado: WS caída, mapa read-only, venta rápida sigue,
  recuperación conciliada.
- Edge case OWNER-authorize.

### 10. Restricciones

- No regresiones en B1-B6.
- NO impresión real ni cajón eléctrico — bloque posterior.
- NO restaurante (cocina/KDS/cobros parciales/reservas) — bloques
  posteriores.
- NO take away/local con IVA diferenciado — bloque posterior.
- TypeScript estricto, JSON Schema en body.
- WebSocket auth con JWT cashier-session sólido.

### 11. Entregables

1. PR único con todo B7.
2. Commit messages descriptivos.
3. `.env.example` si hay variables nuevas (WS_PORT o similar).
4. `docs/blocks/B7-done.md` con mismo formato.
5. ADR-002 actualizado en `docs/04-stack-y-decisiones.md`:
   "WebSockets pasan de opcional a obligatorios para vertical
   bar (B7). Implementación con fastify-websocket. Last-writer-wins."

### 12. Lo que NO entra en B7

- **Impresión real ESC/POS, agente local, cajón eléctrico, QR
  Veri*factu** → bloque dedicado posterior.
- **Restaurante F2** (cocina/KDS, cobros parciales, propinas,
  reservas, menú compuesto, cambiar de mesa entera) → bloques
  posteriores específicos.
- **Take away/local IVA diferenciado** → bloque posterior.
- **Cafetería-pastelería con doble puerta** → bloque v2.
- **CRDT offline real de mesas** → "plan plus" futuro.
- **Customer-facing display, WhatsApp, datáfono** → v2.

Cuando termines B7 y Matías lo revise, abrimos el bloque de
impresión real (con diseño del agente local en red del cliente).
