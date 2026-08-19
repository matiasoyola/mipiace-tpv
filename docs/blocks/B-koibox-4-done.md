# Bloque B-koibox-4 · Agenda (motor de reservas + vistas + cita→caja) — DONE

**Rama:** `koibox-1-crm` (sesión B4). Prompt: `docs/code-prompts/bloque-koibox-4-agenda.md`.
Contexto: `docs/design/adr-k8-motor-reservas-agnostico.md` (LA spec del motor),
`docs/design/koibox-modulo-kickoff.md`, `docs/design/agenda-belleza-spec.md`,
`docs/design/agenda-ux-analisis.md`, `docs/blocks/B-koibox-1/2/3-done.md` (contratos consumidos).

El cuello del módulo. Motor de disponibilidad (modo **CITA**), vistas día/semana por
profesional, estados, bloqueos y **cita→caja pre-poblada**, sobre el núcleo **agnóstico
cita/mesa** del ADR-K8. Gate `Tenant.agendaEnabled`. **No toca el camino de cobro a Holded**
(ADR-010 intacto): el checkout de cita **alimenta** ese camino, no lo modifica. **No commit / no push.**

## Resumen

Se construyó el núcleo compartido cita/mesa (tablas, enums con valores de mesa reservados,
GiST) UNA sola vez y sólo se implementó `CitaMode`; `MesaMode` queda como interfaz no
implementada (sin ramas muertas). El anti-solape NO vive en el código: son los `EXCLUDE USING
gist` sobre `appointment_assignments.slot` (tstzrange), parciales por `active` — la carrera de
dos altas sobre el mismo hueco la resuelve Postgres. B4 es el **dueño de la zona horaria**
(compone `fecha local + hora de pared` en Europe/Madrid → instante UTC). El puente cita→caja
abre un ticket DRAFT pre-poblado con las líneas de servicio (resueltas por `serviceId` =
`product.id`, nunca sku ad-hoc) y lo cobra por el camino existente. Todo gateado por
`agendaEnabled` a nivel de ruta (`ensureAgendaEnabled`, 403 `AGENDA_DISABLED`) **y** de UI.

## Ficheros

**Nuevos (API)**
- `packages/db/prisma/migrations/20260805010000_b_koibox_4_agenda/migration.sql` — tablas +
  enums + `btree_gist` + 2 EXCLUDE parciales + índice gist de rango.
- `apps/api/src/agenda/types.ts` — tipos del motor (vocabulario neutro).
- `apps/api/src/agenda/time.ts` — helpers de tz (Europe/Madrid ↔ UTC) + rejilla de 15 min.
- `apps/api/src/agenda/store.ts` — **único** sitio con SQL crudo de `tstzrange`, detrás de la
  interfaz `AgendaStore` (mockable en tests). Detecta el EXCLUDE (23P01) → `ExclusionError`.
- `apps/api/src/agenda/engine.ts` — `BookingEngine` + `CitaMode` (availability / hold / confirm
  / cancel / noShow / complete / setInService / reschedule).
- `apps/api/src/agenda/checkout.ts` — puente cita→caja (ticket DRAFT pre-poblado).
- `apps/api/src/agenda/routes.ts` — API Fastify + gate + inyección de store/prisma para tests.
- `apps/api/src/queues/agenda-hold-ttl.ts` + `apps/api/src/workers/agenda-hold-ttl-worker.ts` —
  job TTL (BullMQ, repeatable cada minuto) que libera los PENDING vencidos.
- `apps/api/test/agenda-time.test.ts` (5), `agenda-engine.test.ts` (11), `agenda-checkout.test.ts` (3).

**Nuevos (Front)**
- `apps/tpv-web/src/lib/agenda.ts` — API + caché offline del día (IndexedDB) + alta por outbox.
- `apps/tpv-web/src/pages/AgendaPage.tsx` — 3 superficies + alta (panel sin scrim, multi-servicio,
  "Reservar y cobrar") + detalle + estados + cita→caja.
- `apps/tpv-web/test/agenda-cache.test.ts` — caché del día + alta offline.

**Tocados**
- `packages/db/prisma/schema.prisma` — 5 enums (`ReservationMode`, `AppointmentStatus`,
  `ReservationSource`, `ReservableType`, `BlockScope`); modelos `Appointment`, `AppointmentItem`,
  `AppointmentAssignment`, `BookingBlock`, `BookingPolicy`; relaciones en `Tenant`/`Client`/`Ticket`.
- `apps/api/src/server.ts` — registra `registerAgendaRoutes` + arranca el worker/repeatable embebido.
- `apps/api/src/workers/index.ts` — worker TTL en el proceso de workers separado.
- `apps/api/src/crm/routes.ts` — rellena `GET /clients/:id/history` con `kind:"APPOINTMENT"`.
- `apps/api/test/crm-route.test.ts` — el fake-prisma stubbea `$queryRawUnsafe` (nueva consulta de citas).
- `apps/tpv-web/src/lib/outbox.ts` — `OutboxKind` añade `"appointment"` (envío genérico).
- `apps/tpv-web/src/pages/SalePage.tsx` — botón "Agenda" + overlay (gated por `agendaEnabled`);
  "Cobrar en caja" carga las líneas pre-pobladas en el carrito.

## Contrato de la API (para B5 / B6 / front)

Todas: `requireOwnerOrCashier` (owner **o** sesión de cajero del TPV) + gate
`ensureAgendaEnabled` (403 `AGENDA_DISABLED`), aislamiento por `auth.tenantId`.

- **`GET /agenda?date=` | `?from=&to=`** → `{ from, to, staff:[{userId,displayName,color,active}],
  appointments: AppointmentView[] }`. `AppointmentView` = `{ id, clientId, status, source, start,
  end (ISO UTC), ticketId, notes, items:[{id,serviceId,durationMin,sortOrder,startOffsetMin}],
  assignments:[{reservableType,staffUserId,resourceId}] }`.
- **`POST /agenda/availability`** `{ items:[{serviceId, staffUserId?}], staffUserId?, from, to }`
  → `{ slots:[{start,end,options}] }`. Huecos **sin nombres**; la asignación se fija en hold.
- **`POST /agenda/appointments`** `{ externalId?, clientId?, items:[{serviceId,staffUserId?}],
  start (ISO), source?, notes? }` → `201 { appointment }` · `200 { appointment, duplicate:true }`
  (idempotencia del alta offline por `externalId`) · `409 { error:"NO_SLOT"|"TAKEN", alternatives }`
  · `400 NO_REQUIREMENTS` (servicio sin scheduling). **Presencial = confirmada directa**; el resto
  entra como hold PENDING con TTL.
- **`PATCH /agenda/appointments/:id`** `{ status? }` (CONFIRMED/IN_SERVICE/COMPLETED/NO_SHOW/
  CANCELLED) **o** `{ start }` (reprogramar/mover → recalcula asignación, `409` con alternativas si
  choca). `404 APPOINTMENT_NOT_FOUND`.
- **`POST /agenda/appointments/:id/checkout`** → `201|200 { ticket }` (ticket DRAFT pre-poblado con
  las líneas de servicio; idempotente por enlace `ticketId`). Requiere sesión de caja abierta
  (`409 NO_CASHIER_SESSION` / `SHIFT_NOT_OPEN`). Marca la cita `IN_SERVICE`.
- **`GET /agenda/blocks?from=&to=`**, **`POST /agenda/blocks`** `{ scope:CENTER|STAFF|RESOURCE,
  staffUserId?, resourceId?, date, startTime, endTime, reason? }`, **`DELETE /agenda/blocks/:id`** —
  bloqueos **puntuales** (el recurrente `rrule` se **lee** vía el expander de B3; su alta es fast-follow).
- **`GET /clients/:id/history`** ahora incluye entradas `kind:"APPOINTMENT"` en `entries[]` y un
  array `appointments[]` estable (el front ya itera `entries`).

## Criterio de "funciona" (verificado en tests)

En un tenant con `agendaEnabled` y datos tipo Sole: el cajero busca hueco para **corte+tinte** con
Sole (`POST /availability`), crea la cita (cliente de B1), la ve en la columna de Sole, la marca
"en sala", y con **"Cobrar en caja"** abre el ticket **pre-poblado con las dos líneas de servicio**
(`agenda-checkout.test.ts`: dos líneas por `serviceId`→`sku` de servicio, total con IVA correcto,
enlace `ticketId` + `IN_SERVICE`) y lo cierra por el camino de cobro existente **sin re-teclear**.
Dos altas simultáneas sobre el mismo hueco: una gana, la otra recibe alternativas
(`agenda-engine.test.ts`: carrera secuencial + carrera real con `staleReads` → `TAKEN`). Un tenant
sin `agendaEnabled` no ve agenda (nav gated + rutas 403).

## Decisiones tomadas sin preguntar (con justificación)

1. **Capa `AgendaStore` como única frontera de SQL crudo (`tstzrange`).** El harness de tests del
   repo es fake-prisma (no hay Postgres real), y el GiST es comportamiento de la BD. El motor y las
   rutas dependen de la **interfaz** `AgendaStore`; los tests inyectan un store en memoria que simula
   el EXCLUDE — se ejercita la misma lógica de producción sin BD. `store.insertHold`/`reschedule`
   detectan el error `23P01`/nombre del constraint → `ExclusionError` → hold devuelve `TAKEN` +
   alternativas.
2. **`timeslot`/`slot` como `Unsupported("tstzrange")`, escritos/leídos SOLO por SQL crudo** (Prisma
   no puede). Se escriben en el mismo `$transaction` que los items (createMany normal) y se leen con
   `lower()/upper()`. No se añadió `startsAt/endsAt` redundante para no divergir del ADR §3.2.
3. **`AppointmentItem.serviceId` y `AppointmentAssignment.staffUserId/resourceId` con FK sólo en SQL,
   sin relación Prisma** — evita inflar back-refs en `Product`/`User`/`Resource` (precedente:
   `ClientTechnicalNote.createdByUserId`). El aislamiento y la integridad los da el FK de la migración.
4. **Auth `requireOwnerOrCashier` (no OWNER/MANAGER como B3).** La agenda la usa el **cajero del TPV**
   (buscar hueco, alta, "en sala", cobrar), no sólo el admin. El checkout exige además una sesión de
   caja con `register` abierto (sin ella no hay dónde abrir el ticket).
5. **cita→caja = crear ticket DRAFT pre-poblado (como abrir mesa) + enlazar `ticketId` + `IN_SERVICE`.**
   Idéntico patrón a `tables/operativa.ts::getOrCreateDraftTicket`. Líneas construidas desde el
   `product` (kind=SERVICE): `productId`, `holdedProductId`, `sku`, `nameSnapshot`, `basePrice`,
   `taxRate` — exactamente lo que hace el carrito normal, así el camino de cobro y el worker de subida
   a Holded no cambian. Un servicio sin `sku` no es cobrable (`409 SERVICE_NOT_SELLABLE`).
6. **El paso a `COMPLETED` lo dispara el front tras el cobro** (`PATCH { status:"COMPLETED" }`), no un
   hook en el cobro: no se puede enganchar en el camino de cobro sin tocarlo (restricción dura). En el
   detalle hay botón "Finalizar". Ver carryover #2.
7. **Alta presencial = confirmada directa; WEB/PHONE = hold PENDING con TTL 10 min.** El job repeatable
   (BullMQ, cada minuto) cancela los PENDING vencidos e inactiva sus assignments (libera el hueco).
8. **Recursos por tipo (no por recurso concreto):** el motor elige uno libre del `resourceKind`; el
   slot del recurso = span del item + buffers (igual que staff). Documentado; una cabina "del visit
   entero" (ADR) se puede afinar en fast-follow.
9. **Multi-servicio encadenado secuencial** (offset = suma de duraciones previas, sin gap por defecto).
   El span del visit (client-facing `timeslot`) = suma de duraciones; los buffers viven en el slot del
   assignment (staff), no en el timeslot.
10. **Migración `20260805010000`** (posterior a B2/B3 `20260805000000`): sus FK dependen de
    `products`/`users`/`tenants`/`agenda_enabled` que crean B2/B3.
11. **EXCLUDE con `tenant_id` en la clave** (`(tenant_id =, staff_user_id =, slot &&)`): el anti-solape
    es **por tenant** — verificado en el test de aislamiento (dos tenants reservan el mismo hueco con el
    "mismo" userId sin chocar).
12. **Front "Cobrar en caja" carga las líneas pre-pobladas en el carrito rápido del TPV** y cierra la
    agenda; el cajero cobra por el camino existente. Ver carryover #1 (unificar para que el cobro pague
    el DRAFT enlazado en vez de abrir un ticket nuevo — como mesa).
13. **Bloqueos: sólo puntuales en el alta (`slot`); el recurrente se lee** (expander rrule.js de B3).
    Coincide con la valla de alcance del prompt ("recurrencia de bloqueos más allá de reutilizar el
    expander: fast-follow").

## Fuera de alcance (respetado)

- **`MesaMode` / hostelería**: `table_id`, `no_table_overlap`, asiento por party/turno, vista sala. El
  núcleo (tablas, enums con valores TABLE reservados, GiST, engine) ya lo soporta → cae barato.
- **Reserva online embebible** (B6), **señal/deposit** (ADR-K5b; sólo la columna `depositCents`),
  **recordatorios** (B7), **canje de bono como `source`** (B5; sólo la columna `voucherId` y el valor
  `GIFT_REDEMPTION`).
- **Lista de espera avanzada**; catálogo completo de políticas (sólo el subset de columnas).
- **Camino de cobro a Holded** (GET-back / tolerancia 5 cts / `/pay` idempotente, ADR-010) — intacto.
- **Lógica fiscal propia** (`marco-legal-fiscal`) — las líneas de servicio van por `serviceId`.

## Verificación

- `packages/db`: `prisma format` + `prisma validate` **válido** + `prisma generate` OK (cliente
  v5.22.0; incluye los 5 modelos y enums nuevos).
- `apps/api`: `tsc --noEmit` **limpio**. Tests nuevos: `agenda-time` 5/5, `agenda-engine` 11/11,
  `agenda-checkout` 3/3. Sin regresiones: suite completa **625 passed / 3 skipped** (los 3 skipped son
  de super-admin, preexistentes; `crm-route` 18/18 tras stubbear `$queryRawUnsafe`).
- `apps/tpv-web`: `tsc --noEmit` **limpio**. `agenda-cache.test.ts` (caché del día + alta offline +
  error de negocio no-outbox).
- **No commit / no push.** Entorno reparado con `pnpm install --force` al arrancar (corrupción de
  `node_modules` por el sync de `~/Documents`, mismo carryover que B2/B3).

## Carryovers para el siguiente bloque

1. **Unificar cita→caja con el patrón mesa:** hoy el front carga las líneas del DRAFT pre-poblado en el
   carrito rápido y cobra un ticket nuevo; el DRAFT enlazado queda como enlace/auditoría. Fast-follow:
   que el cobro **pague el DRAFT enlazado** (`POST /tickets/:id/checkout`, como una mesa) para no dejar
   DRAFTs huérfanos y cerrar el ciclo `ticketId` → `COMPLETED` automáticamente.
2. **`COMPLETED` automático al cobrar:** hoy lo marca el cajero ("Finalizar") o habría que cablearlo tras
   el éxito del cobro sin tocar ADR-010. Con el carryover #1 (pagar el DRAFT) sale gratis.
3. **Migración `20260805010000_b_koibox_4_agenda` NO aplicada al piloto** — `prisma migrate deploy` en
   el deploy (en dev sólo `generate`). Requiere `CREATE EXTENSION btree_gist` (incluido en la migración;
   el rol de BD del piloto debe poder crear extensiones, o pre-crearla el DBA).
4. **Tz en el borde DST:** `wallTimeToUtc` refina una pasada (suficiente para agenda). Las horas
   "imposibles/dobles" del cambio de hora (2 domingos/año, 02:00–03:00) no se tratan especialmente.
5. **Tests React/jsdom de `AgendaPage`** diferidos por la limitación de infra preexistente; la lógica se
   cubre en node-env (`agenda-cache.test.ts`) y en los tests del motor (API).
6. **Recurso "del visit entero"** (una cabina para toda la cita en vez de por-item) y **catálogo completo
   de políticas** (cobertura mínima, rituales largos simultáneos): el modelo ya lo soporta; afinado
   fast-follow.
7. **Alta recurrente de bloqueos** (`rrule`): hoy sólo se **leen**; el alta puntual está. Fast-follow.
8. **Drag-to-create/mover como acelerador táctil**: el alta funciona por tap en el hueco (slot-first) y
   por buscar-hueco (cliente-first); el arrastre visual queda como mejora (el `PATCH { start }` de mover
   ya existe en la API).
