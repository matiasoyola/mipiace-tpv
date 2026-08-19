# Bloque Reservas-4 · Agenda (motor de reservas + vistas + cita→caja)

> El cuello del módulo. Construye la agenda sobre el **motor de reservas agnóstico cita/mesa (ADR-R8)**, implementando **solo el modo CITA**. Depende de B1 (CRM) + B2 (catálogo) + B3 (personal), los tres ya verdes. **No toca el camino de cobro a Holded.** Gate por `Tenant.agendaEnabled`. Rama `koibox-1-crm`, sin push.

## Contexto (leer antes)
- **`docs/design/adr-r8-motor-reservas-agnostico.md`** — LA spec del motor. Leer entera: es la fuente de verdad de este bloque (modelo de datos §3, BookingEngine §4, cita→caja §5, valla de alcance §7).
- `docs/design/reservas-modulo-kickoff.md` §3 (ADR-R1/K4/K6), §4 (Agenda), §5 (integración Holded), §6 (grafo de dependencias).
- `docs/design/agenda-belleza-spec.md` §3 (motor de disponibilidad), §4 (GiST + concurrencia), §5 (políticas), §6 (encaje TPV).
- `docs/design/agenda-ux-analisis.md` — decisiones de alta (cliente-first, multi-servicio encadenable, panel al lado, "Reservar y cobrar").
- `docs/design/mockups/agenda-reservas.html` — 3 superficies (TPV / recepción / móvil). **OJO:** el mockup es una maqueta con atajos; el alta real va según "Front · Alta" de abajo, NO copiando el drawer con scrim ni el select mono-servicio del mockup.
- `docs/blocks/B-reservas-1-done.md`, `B-reservas-2-done.md`, `B-reservas-3-done.md` — los **contratos de API reales** que este bloque consume (no reinventar).
- Memoria: `holded-services-serviceid` (líneas SERVICE → `serviceId`, nunca `sku`), `holded-pay-tolerance` (GET-back + 5 cts + `/pay` idempotente), `marco-legal-fiscal` (no lógica fiscal propia).

## Alcance
Motor de disponibilidad (modo CITA), vistas día/semana por profesional, estados, bloqueos y **cita→caja pre-poblada**, sobre el núcleo agnóstico del ADR-R8. Todo gateado por `agendaEnabled`.

### Datos (Prisma / Postgres) — migración aditiva, `btree_gist`
Crear **exactamente** lo del ADR-R8 §3, con la convención de B1/B2/B3 (`id uuid @db.Uuid`, `@map` snake_case, `tenantId` por fila + índice, `@db.Timestamptz`, backfill vacío):
- `appointments` (el visit), `appointment_items` (servicios encadenados, con **snapshot** de duración/buffers/staffRequired), `appointment_assignments` (M:N staff/recurso), `booking_blocks`, `booking_policies`.
- Enums: `ReservationMode`, `AppointmentStatus`, `ReservationSource`, `ReservableType`, `BlockScope` — **con los valores de mesa reservados** (`TABLE`, etc.) aunque no se usen aquí.
- **GiST**: `CREATE EXTENSION IF NOT EXISTS btree_gist` + los EXCLUDE parciales `no_staff_overlap` y `no_resource_overlap` (ADR-R8 §3.4). `active = status NOT IN (CANCELLED, NO_SHOW)`, mantenido en la misma tx que el estado.
- **NO crear**: columna `table_id`, `no_table_overlap`, ni `MesaMode` (son del bloque de mesa). Sí crear `mode`/`partySize` (default/nullable) para que mesa reutilice sin migrar el núcleo.

### Motor (apps/api) — `BookingEngine` + `CitaMode`
- Interfaz `BookingEngine` (`availability` / `hold` / `confirm` / `cancel` / `noShow` / `complete`) con estrategia por `ReservationMode`; **implementar solo `CitaMode`** (ADR-R8 §4). Dejar `MesaMode` como interfaz no implementada, sin ramas muertas en el núcleo.
- `availability`: rejilla de 15 min; por cada item del visit cruza `StaffSkill(serviceId)` ∩ `GET /staff/:id/availability-template` (B3) ∩ sin assignment activo solapado ∩ sin `booking_block`; recursos por `ServiceResourceNeed(kind, qty)`; `staffRequired = K` → matching de K simultáneos (fuerza bruta, K≤4). Devuelve huecos **sin nombres**; la asignación concreta se fija en `hold`/`confirm`.
- `hold`: tx `INSERT appointment(PENDING, pendingUntil) + items + assignments`; **el GiST resuelve la carrera** → si salta un EXCLUDE, hueco perdido, devolver alternativas. Job TTL (BullMQ existente) libera los PENDING vencidos.
- **Zona horaria**: componer `fecha(local) + hora de pared` (turnos B3 son "HH:MM") → Europe/Madrid → instante UTC. B4 es el dueño de la tz (B3 la dejó explícitamente aquí).

### API (Fastify) — aislamiento por tenant + gate `ensureAgendaEnabled` (como B3, 403 `AGENDA_DISABLED`)
- `GET /agenda?date=` / `?from=&to=` — citas por profesional para pintar las columnas.
- `POST /agenda/availability` — buscar hueco: `{ items:[{serviceId}], staffUserId?, range }` → `slots[]`.
- `POST /agenda/appointments` — alta: `{ externalId?, clientId?, items:[{serviceId, staffUserId?}], start, source }`. Presencial = confirmada directa. `externalId` para idempotencia del alta offline (patrón `Client`/`Ticket`).
- `PATCH /agenda/appointments/:id` — transición de estado (confirmar / en sala / no-show / cancelar) y reprogramar (mover `slot`).
- `POST /agenda/appointments/:id/checkout` — `complete()`: abre/enlaza **ticket pre-poblado** con las líneas de servicio del visit (`serviceId`, **nunca `sku`**), por el **camino de cobro existente**; enlaza `ticketId`; al cerrar el ticket → `COMPLETED`.
- CRUD `/agenda/blocks` (puntuales; el recurrente reutiliza el expander rrule.js de B3).
- Rellenar `GET /clients/:id/history` con `kind:"APPOINTMENT"` (contrato de B1 ya reservado; el front ya itera `entries`).

### Front (apps/tpv-web) — 3 superficies del mockup
- **Vista día** con **columnas por profesional** (color de `StaffProfile`), línea "ahora" + auto-scroll, estados por color (mapeo del mockup: pendiente/confirmada/en sala/finalizada/no-show). Recepción = ensanchada + tira de semana + panel "en sala / próximas". Móvil = "mi día" en 1 columna + filtro por profesional.
- **Alta (flujo validado — NO copiar el atajo del mockup):**
  - Dos entradas: **slot-first** (toco el hueco → profesional+hora fijados) y **cliente-first / buscar-hueco** (elijo servicio → la agenda resalta huecos válidos).
  - **Cliente primero**: `useClientPicker` de B1 + crear inline (nombre+tel).
  - **Multi-servicio encadenable**: lista de servicios, duración total + hora fin calculadas, **bloque provisional que crece** en el calendario según añades servicios.
  - **Panel al lado sin scrim**: columna in-app que **no tapa** el calendario (TPV/recepción); bottom-sheet en móvil. El drawer+scrim del mockup es atajo de maqueta.
  - Acción primaria **"Reservar y cobrar"** (→ checkout, abre el ticket pre-poblado) + secundaria **"Reservar"** (citas futuras).
- **Detalle de cita**: meta + cambio de estado + "Cobrar en caja".
- **Drag-to-create / mover** como acelerador, no como única vía (principio táctil).
- **Offline**: lectura del día desde caché; alta por outbox (`OutboxKind` `"appointment"`) con `externalId`, mismo patrón que el alta de cliente de B1.

## Restricciones
- **NO tocar el camino de cobro a Holded** (GET-back, tolerancia 5 cts, `/pay` idempotente, ADR-010). El checkout de cita **alimenta** ese camino, no lo modifica.
- **No inventar lógica fiscal** (`marco-legal-fiscal`). Líneas de servicio → `serviceId`.
- **Anti-solape solo por BD** (GiST), nunca "en el código".
- **Motor agnóstico**: lo específico de cita vive en `CitaMode`; el núcleo (`appointments`/`assignments`/engine) no se clava a "profesional" para que `MesaMode` caiga encima. **Cero `if(businessType)`**, vocabulario neutro (cliente/profesional/servicio/recurso).
- Gate `agendaEnabled` a nivel de ruta (`ensureAgendaEnabled`) **y** de UI.
- Multi-tenant por fila. Migración aditiva. **No commit / no push.**

## Entregables
- Migración Prisma + GiST + enums + índices por tenant.
- `BookingEngine` + `CitaMode` + job TTL + **tests** (disponibilidad, K-matching, carrera GiST resuelta por BD, tz, checkout pre-poblado, aislamiento por tenant).
- API completa + tests.
- Front 3 superficies + alta validada (multi-servicio, panel sin scrim, "Reservar y cobrar") + cita→caja.
- **Criterio de "funciona"**: en un tenant con `agendaEnabled` y datos de Sole, el cajero busca un hueco para **corte+tinte** con Sole, crea la cita (cliente de B1), la ve en la columna de Sole, la marca "en sala", y con **"Cobrar en caja"** abre el ticket **pre-poblado con las dos líneas de servicio** y lo cierra por el camino de cobro existente — **sin re-teclear**. Dos altas simultáneas sobre el mismo hueco: una gana, la otra recibe alternativas (GiST). Un tenant sin `agendaEnabled` no ve agenda (nav + rutas).
- Escribir `docs/blocks/B-reservas-4-done.md` con la plantilla (ficheros, contrato de API para B5/B6, decisiones tomadas sin preguntar con justificación, fuera de alcance respetado, verificación, carryovers).

## Fuera de alcance (explícito)
- **`MesaMode` / hostelería** (bloque propio): `table_id` + FK al mapa de mesas existente, `no_table_overlap`, asiento por party/turno, vista sala+turnos. El núcleo ya lo soporta.
- **Reserva online embebible** (B6), **señal/deposit** (ADR-R5b), **recordatorios** (B7), **canje de bono como `source`** (B5).
- **Lista de espera avanzada**; recurrencia de bloqueos más allá de reutilizar el expander de B3 (si aprieta, fast-follow).
- Comisiones e informes de agenda (fase 2).

---

*Lanzar como los bloques previos: implementar respetando alcance/restricciones/fuera-de-alcance, escribir el `-done.md`, no commit/push. Commit selectivo después (stage → revisar → commit), NUNCA `git add -A`.*
