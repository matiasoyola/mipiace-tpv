# ADR-K8 · Motor de reservas agnóstico cita/mesa — spec de arquitectura (previo a B4)

_2026-08-05. Baja el insight `reservas-horizontal-cita-mesa.md` a una abstracción concreta, anclada en el esquema real de B1/B2/B3 (`schema.prisma`) y la spec heredada `agenda-belleza-spec.md`. Esta es la spec que precede al prompt de B4; el alta de cita queda pendiente de validar con Matías antes de fijar B4 (ver §8)._

---

## 0. Tesis en una frase

Una **reserva** ocupa **uno o más recursos** durante un **intervalo de tiempo**, bajo **políticas**, desde un **canal**, para un **cliente**. Eso es idéntico en belleza y en hostelería. Lo único que cambia entre dominios es **qué es el recurso** y **qué es la unidad que se agenda** — y eso se encapsula en un *modo* enchufable. B4 implementa el modo **cita**; el modo **mesa** cae después sobre el mismo motor, las mismas tablas y el mapa de sala que ya existe.

## 1. Lo invariante (el núcleo, lo que B4 construye una sola vez)

Igual en los dos dominios, se diseña ahora y no se repinta:

- **Anti-solape por recurso a nivel de BD** (ADR-K4): `tstzrange` + `EXCLUDE USING gist`. Un recurso no se puede doblar; la carrera la resuelve Postgres, no el código.
- **Retícula temporal**: intervalos sobre una rejilla (15 min en cita; turnos/sittings en mesa — siguen siendo intervalos).
- **Pipeline de políticas** `(slot, contexto) -> allow | deny | annotate`, funciones puras con parámetros por centro en BD (ajustable sin deploy).
- **Cliente único** (B1) compartido entre agenda, TPV y bonos.
- **Reserva online embebible marca blanca** (B6, ADR-K5): mismo `BookingEngine`, mismo widget.
- **Recordatorios** (B7) y **señal anti-no-show** (ADR-K5b).

## 2. Lo variable (el *modo*, patrón estrategia)

| Eje | Modo **cita** (belleza · B4) | Modo **mesa** (hostelería · bloque posterior) |
|---|---|---|
| `mode` | `APPOINTMENT` | `TABLE` |
| Unidad que se agenda | servicio(s) con duración | party de N comensales por franja |
| Recurso reservable | **staff** (K profesionales) + **resource** (cabina/sala/aparato) | **mesa/zona** (1..M combinables) |
| De dónde sale la duración | `service_scheduling.durationMin` (+buffers) | largo del sitting (política) |
| Pregunta de disponibilidad | ¿hay K staff compatibles (skill) + recursos libres? | ¿qué mesa(s) sientan N libres en el turno? |
| Vista | columnas por profesional (día/semana) + móvil | mapa de sala + lista por turno |
| Assignment | M:N staff+recursos, por servicio del visit | 1..M mesas |
| Cierre en caja | cita → ticket con líneas de servicio | reserva → mesa sentada en el mapa → cobro |

La **simetría de cobro** es la clave estratégica: *cita → cobro* (ticket pre-poblado) ≈ *reserva → mesa sentada → cobro*. La cadena es la misma y el recurso "mesa" ya está modelado en el TPV.

El motor consume un `ReservationMode` (interfaz TS) con dos implementaciones. **B4 implementa solo `CitaMode`.** `MesaMode` es un bloque posterior (hostelería). Las tablas, enums, el constraint GiST y el `BookingEngine` son compartidos y se diseñan ahora para que mesa no exija migrar el núcleo.

---

## 3. Modelo de datos del núcleo (B4 crea; convención del repo)

Convención heredada de B1/B2/B3: `id uuid @db.Uuid`, `@map` snake_case, **`tenantId` por fila con índice**, `@db.Timestamptz`, migración aditiva con backfill vacío, gate por `Tenant.agendaEnabled` (columna de B2). Extensión necesaria: `CREATE EXTENSION IF NOT EXISTS btree_gist` (para el `=` sobre uuid en el EXCLUDE).

### 3.1 Enums (con los valores de mesa reservados desde ya — coste cero)

- `ReservationMode { APPOINTMENT, TABLE }`
- `AppointmentStatus { PENDING, CONFIRMED, IN_SERVICE, COMPLETED, NO_SHOW, CANCELLED }` — mapea el mockup: pendiente/confirmada/en_sala(=IN_SERVICE)/finalizada(=COMPLETED)/no_show.
- `ReservationSource { PRESENCIAL, WEB, PHONE, GIFT_REDEMPTION }`
- `ReservableType { STAFF, RESOURCE, TABLE }`
- `BlockScope { CENTER, STAFF, RESOURCE, TABLE }`

### 3.2 `appointment` (tabla `appointments`) — la reserva/el visit

Un registro = una visita del cliente (puede contener varios servicios encadenados). Se llama `appointment` para alinear con el contrato ya publicado de B1 (`GET /clients/:id/history` reserva `kind:"APPOINTMENT"`), la spec heredada §2 y el kickoff §4.

- `id`, `tenantId`
- `externalId uuid? @unique` — idempotencia del alta offline/online por outbox (mismo patrón que `Client.externalId` / `Ticket.externalId`).
- `mode ReservationMode @default(APPOINTMENT)`
- `clientId uuid?` → FK `Client` (nullable: walk-in / reserva anónima de teléfono).
- `timeslot` `Unsupported("tstzrange")` — span [inicio, fin) de la visita (client-facing). El anti-solape real vive en el assignment (incluye buffers).
- `status AppointmentStatus @default(PENDING)`
- `source ReservationSource @default(PRESENCIAL)`
- `partySize Int?` — **solo modo mesa** (comensales). Nullable en cita.
- `voucherId uuid?` — canje de bono (B5).
- `depositCents Int?` — señal cobrada (ADR-K5b; Redsys/Bizum, **no** Stripe).
- `pendingUntil DateTime? @db.Timestamptz` — TTL del hold PENDING (carrera de reserva online).
- `ticketId` — enlace al ticket cuando se cobra (nullable; el puente cita→caja). Tipo alineado con el `id` de `Ticket` del repo.
- `notes String?`
- `createdAt`, `updatedAt`
- Índices: `(tenantId, timeslot)` (gist para consultas de rango), `(tenantId, status)`, `(tenantId, clientId)`.

### 3.3 `appointment_item` (tabla `appointment_items`) — un servicio dentro del visit

Habilita **multi-servicio encadenable** (corte+tinte en una visita, cada uno con su profesional). Solo modo cita.

- `id`, `tenantId`, `appointmentId` → FK.
- `serviceId uuid` → FK `Product` (kind=SERVICE), misma convención que `StaffSkill.serviceId`.
- `durationMin`, `bufferBeforeMin`, `bufferAfterMin`, `staffRequired` — **snapshot** de `service_scheduling` al crear (para que editar el catálogo luego no mueva el histórico).
- `sortOrder Int` — orden de encadenado.
- `startOffsetMin Int @default(0)` — offset desde el inicio del visit (encadenado secuencial). El span del item = `[start+offset, start+offset+duration)`.
- Índice `(tenantId, appointmentId)`.

> **Nota de alcance:** el modelo soporta N items desde el día 1. Que el **alta** de B4 salga con mono-servicio o con encadenado es decisión de producto (ligada a validar el mockup, §8) — se puede ampliar el UI sin migración.

### 3.4 `appointment_assignment` (tabla `appointment_assignments`) — dónde vive el GiST

Ata la reserva a un recurso concreto. **La pieza que Koibox no modela bien** (Sinfonía a 8 manos = 1 cita con 4 assignments de staff + 1 cabina).

- `id`, `tenantId`, `appointmentId` → FK.
- `appointmentItemId uuid?` → a qué servicio corresponde este staff (nullable: un recurso/cabina puede ser del visit entero; y modo mesa no usa items).
- `reservableType ReservableType`
- `staffUserId uuid?` (cuando STAFF) · `resourceId uuid?` (cuando RESOURCE) · `tableId uuid?` (cuando TABLE — **columna diferida al bloque de mesa**, ver §7).
- `slot` `Unsupported("tstzrange")` — intervalo ocupado por ESTE recurso (span del item + buffers para staff; visita entera para una cabina; ventana del turno para una mesa).
- `active Boolean @default(true)` — se mantiene en sync con `appointment.status` en la misma transacción: `active = status NOT IN (CANCELLED, NO_SHOW)`. Es la columna del `WHERE` del EXCLUDE.

**Anti-solape (tres EXCLUDE parciales, uno por familia de recurso):**

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE appointment_assignments
  ADD CONSTRAINT no_staff_overlap
  EXCLUDE USING gist (staff_user_id WITH =, slot WITH &&)
  WHERE (active AND staff_user_id IS NOT NULL);
ALTER TABLE appointment_assignments
  ADD CONSTRAINT no_resource_overlap
  EXCLUDE USING gist (resource_id WITH =, slot WITH &&)
  WHERE (active AND resource_id IS NOT NULL);
-- no_table_overlap: lo añade el bloque de mesa junto a la columna table_id.
```

### 3.5 `booking_block` (tabla `booking_blocks`) — bloqueos estructurales

Cierre VIP, formación, vacaciones, "sábado tarde solo X".

- `id`, `tenantId`, `scope BlockScope`, target (`staffUserId?`/`resourceId?`/`tableId?`).
- Puntual: `slot Unsupported("tstzrange")`. Recurrente: `rrule String?` + `startTime`/`endTime` + `validFrom`/`validUntil` (reutiliza el expander rrule.js de B3). `reason String?`.
- **B4:** implementa bloqueos puntuales; el recurrente reutiliza el expander de B3 (puede ser fast-follow si aprieta).

### 3.6 `booking_policy` (tabla `booking_policies`) — la consultoría hecha código

- `id`, `tenantId`, `key String`, `value Json`. `@@unique([tenantId, key])`.
- Claves cita: `MIN_LEAD_MINUTES`, `MAX_LEAD_DAYS`, `CANCEL_WINDOW_HOURS`, `NOSHOW_SURCHARGE`, `MIN_COVERAGE_PER_SLOT`, `MAX_LONG_RITUALS_PER_SLOT`. Claves mesa (futuras): `SITTING_LENGTH_MIN`, `TURN_BUFFER_MIN`, `MAX_PARTY_ONLINE`.
- Cada política = función pura registrada en código; el `value` la parametriza por centro. **B4:** subset (min/max lead, ventana de cancelación); el catálogo completo puede ser fast-follow.

---

## 4. El servicio `BookingEngine` (núcleo + estrategia)

Firma server-side idéntica a la que expone `KoiboxAdapter` (spec §3/§7) para que el front de B6 no distinga motor:

```
availability(mode, params, dateRange) -> Slot[]     // Slot = { start, end, options[] } (sin nombres al público)
hold(request)      -> Appointment(PENDING, pendingUntil)   // INSERT visit+items+assignments; el GiST resuelve la carrera
confirm(id)        -> Appointment(CONFIRMED)
cancel/noShow(id)  -> libera el hueco (active=false)
complete(id)       -> abre/enlaza ticket pre-poblado (cita→caja)
```

El `ReservationMode` aporta tres piezas:

1. **`deriveRequirements(params)`** — cita: de `items[]` (servicios) saca por item `{durationMin, buffers, staffRequired K, resourceNeeds[]}`; span del visit = suma secuencial. Mesa: de `partySize` saca el requisito de asiento.
2. **`candidateReservables(requirement, interval)`** — cita/staff: `StaffSkill(serviceId)` ∩ `availability-template` de B3 ∩ sin assignment activo solapado ∩ sin `booking_block`. Si `staffRequired = K`, matching de K simultáneos (fuerza bruta, K≤4). Cita/recursos: por cada `ServiceResourceNeed(kind, qty)`, un `Resource` libre de ese tipo en `[interval+buffers]`. Mesa: mesas cuya capacidad (simple o combinada) ≥ `partySize`, libres en la ventana del turno.
3. **`assignmentsFor(chosen)`** — construye las filas `appointment_assignment` con su `slot`.

**Algoritmo de disponibilidad (cita), por slot de rejilla de 15 min en el rango:**
1. Para cada item: intervalo = inicio del slot + offset acumulado; ocupación = duración (+buffers).
2. Candidatos de staff del item = skill ∩ availability-template(B3) ∩ libre ∩ no bloqueado; hacen falta K.
3. Candidatos de recurso por need = recurso libre del tipo.
4. Slot factible ⇔ cada item tiene asignación completa sin conflicto cruzado de staff (el mismo profesional puede encadenar items secuenciales; dos items que lo requieran a la vez chocan).
5. Se devuelven huecos sin nombres; la asignación concreta se fija en `hold`/`confirm`.
6. Coste trivial (~44 slots/día × pocos profesionales). Cachear el día, invalidar en escritura/webhook.

**Concurrencia (spec §4):** `hold()` = tx `INSERT appointment(PENDING, pendingUntil=now+X) + items + assignments`; si salta cualquier EXCLUDE → hueco perdido, se devuelven alternativas (la BD gana la carrera). Job TTL (BullMQ existente) libera los PENDING vencidos.

**Zona horaria:** las reservas se guardan en `tstzrange` UTC; la tz del centro (Europe/Madrid) se aplica en los bordes. Los turnos de B3 son hora de pared "HH:MM" por día (B3 dejó la tz explícitamente a B4). El motor compone `fecha(local) + hora de pared → tz → instante UTC`. **B4 es el dueño de la zona horaria.**

## 5. Puente cita → caja (la métrica de éxito del MVP)

La métrica única del MVP: *nº de citas del día cerradas en caja desde la agenda sin re-teclear el ticket.*

`complete()` (acción "Cobrar en caja" del mockup) **abre/enlaza un ticket pre-poblado** con las líneas de servicio del visit (cada `appointment_item` → `ticket_line` con `serviceId`, nunca `sku` — ver memoria `holded-services-serviceid`). Usa el **camino de cobro existente intacto** (GET-back, tolerancia 5 cts, `/pay` idempotente, ADR-010): el motor **alimenta** ese camino, **no lo toca**. `appointment.ticketId` enlaza ambos; al cerrar el ticket, `appointment → COMPLETED`. El enlace `Client.holdedContactId` se resuelve por el hook de cobro (carryover #3 de B1).

## 6. Encaje con B1/B2/B3 (lo que ya está y se consume)

- **B1 (CRM):** `Client` es el cliente de la cita (`useClientPicker` ya listo para B4). B4 rellena `GET /clients/:id/history` con `kind:"APPOINTMENT"` (contrato ya reservado, el front itera `entries` sin romper).
- **B2 (catálogo):** `ServiceScheduling` (durationMin, buffers, staffRequired), `ServiceResourceNeed` (por tipo) y `Resource` son la entrada del motor. Servicio sin fila `service_scheduling` → la agenda lo ignora. `onlineBookable`/`channels.online` gatea B6.
- **B3 (personal):** `StaffSkill` = fuente de candidatos; `GET /staff/:id/availability-template?from=&to=` = las franjas que el motor cruza. `StaffProfile.color` pinta la columna del profesional.
- **Gate:** `Tenant.agendaEnabled` (columna de B2). Todo el módulo apagado por defecto.

## 7. Qué crea B4 vs qué se difiere (valla de alcance)

**B4 (belleza, cliente 0 = Sole) construye:**
- Migración: `appointments`, `appointment_items`, `appointment_assignments`, `booking_blocks`, `booking_policies` + enums (con valores de mesa reservados) + GiST (`btree_gist`).
- `BookingEngine` + **solo `CitaMode`**. availability / hold / confirm / cancel / noShow / complete.
- API: día/semana por profesional, alta (cliente + servicio(s) + profesional + hora), "buscar hueco" (availability), transiciones de estado, cita→caja.
- Front: 3 superficies del mockup (TPV columnas por profesional / recepción ensanchada / móvil "mi día"), drawer de alta (según flujo validado, §8), detalle+estado, "Cobrar en caja".
- Bloqueos puntuales; políticas subset (min/max lead, cancelación).

**Se difiere (NO es B4):**
- **`MesaMode` / hostelería** (bloque propio): columna `table_id` + FK al mapa de mesas existente, `no_table_overlap`, algoritmo de asiento por party/turno, vista sala+turnos. El núcleo (tablas, enums, GiST, engine) ya lo soporta → cae barato.
- Reserva online embebible (B6), señal (K5b), recordatorios (B7), canje de bono como source (B5).
- Lista de espera avanzada; persistencia de drag-move más allá del MVP.

## 8. Pendiente antes de fijar B4 — validar el alta con Matías

El prompt de B4 congela el flujo de alta, así que se valida **antes**. El mockup v2 (`docs/design/mockups/agenda-koibox.html`) **no cumple del todo** las decisiones de `agenda-ux-analisis.md`:

| Decisión del análisis UX | Mockup v2 actual | ¿Gap? |
|---|---|---|
| Cliente primero (buscar + crear inline) | El campo Cliente abre primero | OK |
| Servicios **encadenables** (duración total + hora fin, bloque que crece) | Un **único** `select` de servicio | **Sí** |
| Panel **al lado, nunca tapa** el calendario | Drawer lateral derecho **con scrim que oscurece** | Parcial |
| Primario **"Reservar y cobrar"** (cita→caja en el sitio) | Solo "Reservar cita"; el cobro vive en el detalle | **Sí** |
| Dos entradas de alta (slot-first y cliente-first/buscar-hueco) | Ambas presentes | OK |

Decisión de producto de Matías: (a) ¿el alta de B4 sale ya con **multi-servicio encadenable** o mono-servicio y se amplía luego? (b) ¿el panel es columna in-app sin scrim o se acepta el drawer? (c) ¿"Reservar y cobrar" como primario del alta? El modelo (`appointment_item`) soporta las tres sin migración; es decisión de UI/alcance del primer corte.

---

*Mi Piace Internet Solutions · ADR-K8 motor de reservas agnóstico · 2026-08-05. Integrar en `docs/04-stack-y-decisiones.md` una vez aprobado.*
