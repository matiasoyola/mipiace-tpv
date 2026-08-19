# Bloque B-reservas-3 · Personal + horarios — DONE

**Rama:** rama de trabajo del módulo Reservas, integrada en `master` el 2026-08-19 (sesión B3). Prompt: `docs/code-prompts/bloque-reservas-3-personal.md`.
Contexto: `docs/design/reservas-modulo-kickoff.md` (ADR-R1, ADR-R6, §4 modelo de datos),
`docs/design/agenda-belleza-spec.md` §2/§3, `docs/blocks/B-reservas-1-done.md`, `docs/06-modelo-datos.md`.

Base de la **agenda multi-profesional** (B4). Paralelizable con B1 y B2 —
implementado **en paralelo real** con una sesión B2 activa (ver "Nota de concurrencia").
Aditivo, **no toca el camino de cobro a Holded** (ADR-010 intacto).

## Resumen

Modela el personal y sus horarios **extendiendo el `user` existente** (ADR-R1 — NO
tabla `Staff` paralela): perfil de agenda 1:1, matriz profesional × servicio y turnos
como plantillas recurrentes `rrule` (RFC 5545, con **rrule.js**) + ventana de validez.
Todo gateado por `Tenant.agendaEnabled` (ADR-R6, columna propiedad de B-reservas-2). El
helper `GET /staff/:userId/availability-template` expande la semana tipo a franjas
concretas para un rango — el contrato que consumirá el motor de B4. Panel de gestión en
`apps/admin` (profesionales + skills + turnos), gated. Vocabulario neutro (**profesional**).

## Ficheros

**Nuevos**
- `packages/db/prisma/migrations/20260805000000_b_koibox_3_staff/migration.sql`
- `apps/api/src/staff/routes.ts` — endpoints REST de personal + expansión de rrule.
- `apps/api/test/staff-route.test.ts` — 18 tests (Prisma en memoria + rrule.js real).
- `apps/admin/src/pages/StaffPage.tsx` — panel de personal (perfil + matriz de skills + editor de turnos), gated.

**Tocados**
- `packages/db/prisma/schema.prisma` — enum `StaffShiftKind`; modelos `StaffProfile`,
  `StaffSkill`, `StaffShift`; relaciones en `User`, `Tenant`, `Product`. **Referencia**
  (no duplica) `Tenant.agendaEnabled`.
- `apps/api/src/server.ts` — registra `registerStaffRoutes`.
- `apps/api/src/admin/tenant-settings.ts` — expone/togglea `agendaEnabled` en GET/POST.
- `apps/api/package.json` — dependencia `rrule@2.8.1`.
- `apps/admin/src/App.tsx` — ruta `/admin/staff`.
- `apps/admin/src/AdminShell.tsx` — ítem de nav "Personal" (gated por capability `agenda`).
- `apps/admin/src/pages/SettingsPage.tsx` — sección "Módulos del negocio" (toggles agenda + CRM).

## Datos (migración aditiva)

- `staff_profiles` — perfil de agenda 1:1 con `user`. **PK = `user_id`** (el perfil ES el
  usuario visto como profesional). `display_name`, `active` (def true), `color?`. FKs a
  `users` y `tenants` (Cascade). Índices `(tenant_id)`, `(tenant_id, active)`.
- `staff_skills` — matriz profesional × servicio. **PK compuesta `(user_id, service_id)`**.
  `service_id` = `products.id` (kind=SERVICE) con **FK dura** (ver decisión 2). `tenant_id`
  por aislamiento. Índices `(tenant_id, service_id)` — "¿quién da el servicio X?" (contrato
  B4) — y `(tenant_id, user_id)`.
- `staff_shifts` — turno = plantilla `rrule` (RFC 5545) + `start_time`/`end_time` ("HH:MM")
  + `valid_from`/`valid_until?` (`@db.Date`) + `kind` (`StaffShiftKind`). Índices
  `(tenant_id, user_id)` y `(user_id)`.
- `Tenant.agenda_enabled` **NO se crea aquí** — es propiedad de B-reservas-2 (ver decisión 1).

## Contrato de la API (para B4 / front)

Todos: `requireOwnerOrManager` + gate `ensureAgendaEnabled` (403 `AGENDA_DISABLED` si OFF),
aislamiento por `auth.tenantId`.

- **`GET /staff`** → `{ staff: [{ userId, alias, email, role, profile|null, serviceIds[], skillCount }] }`.
  Lista los usuarios del tenant como candidatos a profesional + su perfil/skills.
- **`GET /staff/services`** → `{ services: [{ id, name }] }`. Servicios (kind=SERVICE, activos)
  para la matriz; `id` = `products.id`.
- **`PUT /staff/:userId`** → `{ profile }`. Alta/edición del perfil. Body `{ displayName, color?, active? }`.
  `404 STAFF_USER_NOT_FOUND` si el user es de otro tenant.
- **`DELETE /staff/:userId`** → `{ ok }`. Quita al profesional de la agenda (perfil + skills +
  turnos, en transacción). El `user` credencial/cajero NO se toca.
- **`PUT /staff/:userId/skills`** → `{ serviceIds }`. Set completo de servicios que da.
  `409 NO_STAFF_PROFILE` si no hay perfil; `400 INVALID_SERVICE_ID` si algún id no es servicio del tenant.
- **`GET /staff/:userId/shifts`** → `{ shifts[] }`.
- **`POST /staff/:userId/shifts`** → `201 { shift }`. Body `{ rrule, startTime, endTime, validFrom, validUntil?, kind? }`.
  `400 INVALID_SHIFT` (rrule inválida / hora fin ≤ inicio / horas mal / validFrom>validUntil); `409 NO_STAFF_PROFILE`.
- **`PATCH /staff/:userId/shifts/:shiftId`** → `{ shift }`. Parcial; revalida el resultado. `404 SHIFT_NOT_FOUND`.
- **`DELETE /staff/:userId/shifts/:shiftId`** → `{ ok }`. `404 SHIFT_NOT_FOUND`.
- **`GET /staff/:userId/availability-template?from=&to=`** →
  `{ userId, from, to, slots: [{ date, startTime, endTime, shiftId, kind }] }`. Expande cada
  turno cuya validez solapa el rango a franjas concretas (retícula por día), ordenadas por
  fecha+hora. Cota `MAX_RANGE_DAYS=366` (`400 RANGE_TOO_LARGE`). **Contrato para B4:** un
  profesional sin skill de un servicio no aparece como candidato para ese servicio
  (la matriz `staff_skills` es la fuente).

## Criterio de "funciona"

Con `agendaEnabled` ON: dar de alta un profesional (`PUT /staff/:id`), marcar qué servicios
da (`PUT /skills`), definir su semana tipo con `rrule` + validez (`POST /shifts`), y que
`GET /availability-template?from=&to=` devuelva sus franjas para el rango. Verificado en
`staff-route.test.ts` con rrule.js real: `FREQ=WEEKLY;BYDAY=MO` sobre agosto 2026 → los 5
lunes; con `validUntil=2026-08-17` → sólo 3, 10, 17.

## Decisiones tomadas sin preguntar (con justificación)

1. **`Tenant.agendaEnabled` referenciada, NO duplicada.** El prompt lo pedía explícitamente:
   "su dueño es B2 — si ya existe, refiérela". Cuando arranqué la columna aún no estaba; a
   mitad de sesión la sesión B2 la añadió al schema. La **referencio** en `StaffProfile`/
   gate y **excluyo el `ALTER TABLE ... ADD agenda_enabled` de mi migración** (lo aporta la
   migración de B2). Si B3 se hubiera corrido en solitario, la habría creado con
   `Boolean @default(false)`.
2. **`StaffSkill.serviceId` = `products.id` (uuid) con FK dura**, alineado con la convención
   que B-reservas-2 fijó (`ServiceScheduling.productId` y `ServiceResourceNeed.serviceId` son
   ambos `products.id` uuid con FK). Diverge de la de `ClientTechnicalNote` de B1 (serviceId =
   id Holded string, sin FK). Elegí la de B2 porque el **cluster de agenda** (skill ∩ servicio
   ∩ scheduling ∩ recurso) necesita integridad referencial para el join del motor de B4; y el
   prompt dice "serviceId = product Holded (kind=SERVICE)" sin fijar qué identificador. Es la
   misma entidad, keyed por el id local del espejo.
3. **Rol OWNER/MANAGER en todos los endpoints** (`requireOwnerOrManager`). La configuración de
   personal, skills y horarios es **operativa de negocio del admin**, no del cajero. El helper
   `availability-template` (interno, para B4) también OWNER/MANAGER; B4 decidirá su exposición
   al TPV cuando cuelgue la agenda del bus.
4. **Gate por `ensureAgendaEnabled` como preHandler compartido** que lee `Tenant.agendaEnabled`
   y corta con `403 AGENDA_DISABLED`. Mismo patrón de gate que el `crmEnabled` de B1, aplicado
   a nivel de ruta (no de UI sólo).
5. **Skills y turnos exigen perfil previo** (`409 NO_STAFF_PROFILE`). El flujo del panel es
   "activa al profesional → marca servicios → define turnos"; enforzar el perfil evita
   configuración huérfana sobre usuarios que no son profesionales y mantiene coherente la
   matriz para B4.
6. **`serviceIds` validado estricto** (400 si alguno no existe o no es kind=SERVICE del tenant),
   no filtrado en silencio: un id inválido es un error del cliente, no algo a esconder.
7. **`rrule` estándar RFC 5545 con rrule.js** (`RRule.parseString` + `new RRule`, sin formato
   propio). Se almacena el string crudo (`FREQ=WEEKLY;BYDAY=MO,TU`) **sin `DTSTART`**; el
   `dtstart` se inyecta en la expansión desde `validFrom`. El editor del front construye el
   `BYDAY` desde un multiselector de días (formato estándar, no inventado).
8. **`validFrom`/`validUntil` como `@db.Date`** (validez a nivel de día) y horas como `"HH:MM"`
   de pared. `availability-template` devuelve franjas `{date, startTime, endTime}` **sin
   conversión de zona horaria** — la tz la maneja B4 (aquí sólo la expansión de la plantilla,
   como manda "fuera de alcance"). Cota de rango 366 días.
9. **`DELETE /staff/:userId`** borra perfil + skills + turnos en transacción (baja total de la
   agenda). Alternativa (sólo `active=false`) también soportada vía `PUT`.
10. **`StaffProfile` sin id propio, PK = `user_id`** (1:1): el perfil ES el `user` como
    profesional. Coherente con `ServiceScheduling` de B2 (PK = `product_id`).
11. **Timestamp de migración `20260805000000`** (hoy), posterior a `20260804000000_b_koibox_1_crm`.
    El orden frente a la migración de B2 (mismo día) es irrelevante: el FK de `staff_skills`
    apunta a `products`, que preexiste a ambos bloques.
12. **`agendaEnabled` cableado en `/admin/tenant/settings`** (GET/POST) + sección "Módulos del
    negocio" en `SettingsPage` con toggles de **agenda y CRM**. La columna sigue siendo de B2;
    aquí sólo se cablea el toggle que consumen el panel (B3) y la agenda (B4). De paso resuelve
    el carryover pendiente de B1 (toggle UI de `crmEnabled`).
13. **Nav "Personal" gated por la capability `agenda`** (mecanismo que introdujo B2 en
    `AdminShell`), además del auto-gate de la página.
14. **`GET /staff` devuelve `serviceIds` por profesional** para prellenar la matriz del panel
    sin una llamada por profesional; `GET /staff/services` da el catálogo de servicios.

## Nota de concurrencia (B2 en paralelo)

Durante la sesión hubo una sesión **B-reservas-2 activa** editando ficheros compartidos
(`schema.prisma`, `server.ts`, `admin/tenant-settings.ts`, `AdminShell.tsx`, `App.tsx`).
Los merges coexistieron limpios: B2 aportó `ServiceScheduling`/`Resource`/`ServiceResourceNeed`,
`agendaEnabled`, `registerServicesRoutes`, la página `AgendaCatalogPage` y el mecanismo
`capability: "agenda"` en la nav; B3 aportó lo suyo sin pisar nada. `prisma validate` sobre el
schema combinado: **válido**.

## Fuera de alcance (respetado)

- **Motor de disponibilidad / agenda (B4)**: cruce skill ∩ turno ∩ sin-solape ∩ recursos +
  matching multi-profesional. Aquí sólo la expansión del turno a franjas.
- **Bloqueos/ausencias puntuales** (`booking_block`, B4).
- **Fichaje / control horario de asistencia** (fase 2).
- **Comisiones por profesional** (fase 2).
- **Tarifas variables por nivel** (fase posterior; variantes Holded).
- **Camino de cobro a Holded** — intacto.

## Verificación

- `packages/db`: `prisma validate` **válido**; `prisma format` OK; `prisma generate` OK
  (cliente v5.22.0, con `StaffProfile`/`StaffSkill`/`StaffShift`/`StaffShiftKind`).
- `apps/api`: `tsc --noEmit` **limpio (0 errores)**. `staff-route.test.ts`: **18/18**
  (gate, aislamiento por tenant, matriz de skills, CRUD de turnos con validación de rrule,
  y expansión de la semana tipo con **rrule.js real**). Sin regresión: `crm-route.test.ts`
  18/18, `tenant-settings.test.ts` 7/7.
- `apps/admin`: `tsc --noEmit` **limpio (0 errores)**.
- **Incidencia de entorno (no de código):** `prisma generate` falló al principio con
  `(0 , import_fetch_engine.download) is not a function` — corrupción intermitente de
  `node_modules/@prisma` por el sincronizador de `~/Documents` (aparecen copias-conflicto
  tipo `default 2.js`). Se resolvió tras un `pnpm add` que reasentó el store; documentado por
  si reaparece.

## Carryovers para el siguiente bloque

1. **Migración `20260805000000_b_koibox_3_staff` no aplicada al piloto** — `prisma migrate deploy`
   en el deploy (en dev sólo `generate`). La columna `agenda_enabled` la aporta la migración de
   B-reservas-2; verificar que ambas migraciones se despliegan juntas.
2. **`availability-template` devuelve franjas por día sin tz** — B4 es el dueño de la zona
   horaria y del cruce completo (citas, bloqueos, recursos, multi-profesional).
3. **Editor de turnos del front cubre `FREQ=WEEKLY;BYDAY=...`** (el caso principal del spec).
   La API acepta cualquier rrule válida (mensual, `INTERVAL`, alternancia quincenal tipo Alba),
   pero el editor visual sólo construye semanal — UI de recurrencia avanzada diferida.
4. **`PATCH /staff/:userId/shifts/:shiftId` existe en la API** pero el front hace crear+borrar
   (editar = borrar y recrear); edición inline del turno diferida.
5. **Sin test React/jsdom de `StaffPage`** — misma limitación de infra que B1; la lógica se
   cubre en node-env (`staff-route.test.ts`).
6. **`useClientPicker` (B1) sigue listo para B4** (asignar cliente a cita); el panel de personal
   deja `staff_skills` como fuente de candidatos para el matching de B4.
