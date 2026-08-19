# Bloque Reservas-3 · Personal + horarios

> Modela el personal y sus horarios como base de la agenda multi-profesional. Paralelizable con B1 y B2. Desbloquea la agenda (B4). Depende de `Tenant.agendaEnabled` (owner: B2).

## Contexto (leer antes)
- `docs/design/reservas-modulo-kickoff.md` §3 ADR-R6, §4 (Personal), §2 (`Staff` RT → extender `user`).
- `docs/design/agenda-belleza-spec.md` §2 (`Staff`, `StaffSkill`, `Shift` con `rrule` y `kind`) y §3 (el motor cruza skill ∩ turno ∩ sin-solape).
- `docs/blocks/B-reservas-1-done.md` (patrón capability flag) · `docs/06-modelo-datos.md` (`user` con role/PIN) · `docs/02-arquitectura.md`.

## Alcance
Modelar profesionales y horarios **extendiendo el `user` existente** (no una tabla `Staff` paralela), como base de la agenda multi-profesional. Gate por `agendaEnabled`.

### Datos (Prisma / Postgres) — migración aditiva
- `staff_profile`: `userId` (pk, fk → `user`), `tenantId`, `displayName`, `active` (def true), `color?` (para pintar en la agenda). Extiende `user`, no lo reemplaza.
- `staff_skill`: pk compuesta `(userId, serviceId)` — matriz **profesional × servicio** (qué servicios puede dar cada uno). `serviceId` = `product` Holded (`kind=SERVICE`).
- `staff_shift`: `id`, `userId`, `tenantId`, `rrule` (RFC 5545, p.ej. `FREQ=WEEKLY;BYDAY=MO,TU`), `startTime` ("09:30"), `endTime` ("14:30"), `validFrom`, `validUntil?`, `kind` (`REGULAR|REINFORCEMENT|SWAP`). Turnos como **plantillas recurrentes + validez temporal**.
- **Dependencia**: `Tenant.agendaEnabled` la crea B2. Si B3 se implementa antes o en solitario, crear esa columna con la misma definición (`Boolean @default(false)`); si ya existe, referenciarla.

### API (Fastify), aislamiento por tenant
- CRUD `/staff` (perfil + `active`) sobre los `user` existentes del tenant.
- `PUT /staff/:userId/skills` — set de servicios que da.
- CRUD `/staff/:userId/shifts` (`rrule` + validez + `kind`).
- `GET /staff/:userId/availability-template?from=&to=` — expande la `rrule` a franjas concretas para un rango (lo consumirá el motor de B4; puede ser interno).

### Front
- Panel en `apps/admin` (o gestión): fichas de profesional (alta desde `user`, `displayName`, `color`, `active`), **matriz de skills** (servicio × profesional) y **editor de turnos** (semana tipo con `rrule` + rango de validez). Gate `agendaEnabled`.
- Vocabulario neutro: **profesional** (peluquero, esteticista, médico, fisio…).

## Restricciones
- Extender `user`, **NO** tabla `Staff` paralela (coherente con ADR-R1: no duplicar entidades existentes).
- **ADR-R6**: columna booleana `Tenant.agendaEnabled`. Cero `if(businessType)`. Vocabulario neutro.
- `rrule` **estándar RFC 5545** con librería probada (p.ej. `rrule.js`) — no inventar un formato de recurrencia propio.
- Multi-tenant por fila. Migración aditiva.
- **No** implementar aquí el cruce completo de disponibilidad (solape con citas): eso es B4. Aquí solo la expansión del turno a franjas.

## Entregables
- Migración Prisma (`staff_profile`, `staff_skill`, `staff_shift`; `Tenant.agendaEnabled` si no existe) + índices por tenant.
- Endpoints CRUD + expansión de `rrule` a franjas + tests + aislamiento por tenant.
- Panel de personal + skills + turnos, gated por `agendaEnabled`.
- **Criterio de "funciona"**: dar de alta un profesional, marcar qué servicios da, definir su semana tipo (`rrule`) con validez, y que el helper devuelva sus franjas para un rango de fechas. Un profesional sin skill de un servicio no debe salir como candidato para ese servicio (contrato para B4).

## Fuera de alcance (explícito)
- Motor de disponibilidad y agenda (B4): cruce skill ∩ turno ∩ sin-solape ∩ recursos + matching multi-profesional.
- Bloqueos/ausencias puntuales de profesional (B4, `booking_block` scope `STAFF:<id>`).
- Fichaje / control horario de asistencia (fase 2).
- Comisiones por profesional (fase 2).
- Tarifas variables por nivel del profesional (fase posterior; serían variantes en Holded).
