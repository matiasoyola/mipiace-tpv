# Bloque B-reservas-1 · CRM / Ficha de cliente — DONE

**Rama:** `a3-publicacion` (sesión CRM). Prompt: `docs/code-prompts/bloque-reservas-1-crm.md`.
Contexto: `docs/design/reservas-modulo-kickoff.md` (ADR-R2, ADR-R6, §4 modelo de datos), `docs/design/agenda-belleza-spec.md` §2/§6.

Primer bloque del módulo Citas+Clientes+Bonos. **Aditivo, no toca el camino de cobro a
Holded** (ADR-010 intacto). Desbloquea agenda (B4), bonos (B5) y reserva online (B6).

## Resumen

Ficha de cliente / CRM como capa **local** (fuente de verdad propia, ADR-R2), enlazada
opcional y perezosamente a contactos de Holded sólo para lo fiscal. Se activa por capability
flag `crmEnabled` por tenant (ADR-R6): apagada → nada aparece en el TPV. Vocabulario neutro
(cliente / profesional / servicio). Búsqueda offline-first sobre Dexie, alta offline vía
outbox. Hook `useClientPicker` reutilizable (carrito hoy, agenda en B4), cableado al atajo
**F1**.

## Ficheros

**Nuevos**
- `packages/db/prisma/migrations/20260804000000_b_koibox_1_crm/migration.sql`
- `apps/api/src/crm/routes.ts` — endpoints REST del CRM.
- `apps/api/test/crm-route.test.ts` — 18 tests (Prisma en memoria).
- `apps/tpv-web/src/lib/clients.ts` — caché Dexie + capa de API + alta offline.
- `apps/tpv-web/src/pages/ClientsPage.tsx` — sección Clientes (lista A–Z + ficha + tabs).
- `apps/tpv-web/src/pages/ClientForm.tsx` — alta/edición inline reutilizable.
- `apps/tpv-web/src/hooks/useClientPicker.tsx` — picker reutilizable + F1.
- `apps/tpv-web/test/clients-cache.test.ts` — 7 tests (búsqueda local + offline).

**Tocados**
- `packages/db/prisma/schema.prisma` — enum `ClientConsentKind`; modelos `Client`,
  `ClientConsent`, `ClientTechnicalNote`; `Tenant.crmEnabled` + relación `clients`.
- `apps/api/src/server.ts` — registra `registerCrmRoutes`.
- `apps/api/src/tpv-catalog/routes.ts` — expone `crmEnabled` en la 1ª página del catálogo.
- `apps/api/src/admin/tenant-settings.ts` — `crmEnabled` en GET/POST de ajustes.
- `apps/tpv-web/src/lib/catalog.ts` — cachea `crmEnabled` (`get/setCachedCrmEnabled`).
- `apps/tpv-web/src/lib/outbox.ts` — `OutboxKind` añade `"client"` (envío genérico, sin caso especial).
- `apps/tpv-web/src/pages/SalePage.tsx` — botón "Clientes" + overlay + F1 + picker (gated).

## Entregables

| Entregable | Estado | Notas |
|-----------|--------|-------|
| Migración Prisma + índices (backfill vacío) | ✅ | `(tenantId, phone)`, `(tenantId, email)`, `(tenantId, lastName, firstName)`, `(tenantId, holdedContactId)`. |
| Endpoints REST + JSON Schema + aislamiento por tenant + tests | ✅ | 6 del prompt + 2 de alta manual (consents / ficha técnica). |
| Sección Clientes en `apps/tpv-web` (lista A–Z + buscador + ficha + alta/edición, offline Dexie) | ✅ | Overlay a pantalla completa; búsqueda <100 ms sobre caché. |
| Hook `useClientPicker` integrado con F1, listo para carrito y agenda | ✅ | Reutilizable; onSelect(client). |
| Contratos estables de `history` y `vouchers` (vacíos hoy) | ✅ | `entries[]` discriminado + `appointments[]`/`voucherMovements[]` vacíos. |
| Gate por capability flag | ✅ | `crmEnabled` por tenant; cache en TPV; tenant sin flag = sección inexistente. |

**Criterio de "funciona":** en un tenant con `crmEnabled`, el cajero da de alta un cliente,
lo busca por teléfono en <1 s (también sin red, desde Dexie), abre su ficha, ve su historial
de compras (tickets del contacto Holded enlazado) y lo asigna a un ticket con **F1**. En un
tenant sin la capability, la sección Clientes no existe.

## Contrato de la API (para B4 / B5 / front)

Todos los endpoints: `requireOwnerOrCashier`, aislamiento por `auth.tenantId`.

- **`GET /clients?query=&sort=az&cursor=&limit=`** → `{ items: ClientView[], nextCursor }`.
  Búsqueda por nombre/teléfono/email (insensible), orden A–Z (apellido, nombre, id), cursor.
- **`POST /clients`** → `201 { client, phoneWarning? }` o `200 { client, duplicate:true }`
  si `externalId` ya existe (idempotencia del outbox). `phoneWarning` = clientes con el
  mismo teléfono (aviso **no bloqueante**). Body: `externalId?, firstName, lastName, phone?,
  email?, birthdate? (YYYY-MM-DD), holdedContactId?, marketingOptIn?, notes?`.
- **`GET /clients/:id`** → `{ client, consents[], technicalNotes[] }`. `404 CLIENT_NOT_FOUND`
  si es de otro tenant.
- **`PATCH /clients/:id`** → `{ client }`. Campos nullable admiten `null` para limpiar.
- **`GET /clients/:id/history`** → `{ entries[], appointments[], voucherMovements[] }`.
  `entries` hoy sólo `kind:"PURCHASE"` (ticket del `holdedContactId`: `at, ticketId,
  internalNumber, holdedDocNumber, status, total`). **B4** añade `kind:"APPOINTMENT"`,
  **B5** `kind:"VOUCHER_MOVEMENT"` — el front ya itera `entries`, no rompe.
- **`GET /clients/:id/vouchers`** → `{ balance:{sessionsLeft,amountLeftCents}, vouchers[] }`
  (vacío hasta B5).
- **`POST /clients/:id/consents`** → `201 { consent }`. Body `{ kind: DATA|TREATMENT, docRef?, grantedAt? }`.
- **`POST /clients/:id/technical-notes`** → `201 { technicalNote }`. Body `{ serviceId?, body }`.
  `createdByUserId` = actor autenticado.

`crmEnabled` viaja al TPV en la 1ª página de `GET /tpv/catalog/products` y se togglea desde
`GET/POST /admin/tenant/settings`.

## Decisiones tomadas sin preguntar (con justificación)

1. **Capability flag = columna booleana `crmEnabled`, no un JSON `capabilities`.** ADR-R6
   bosqueja `capabilities:{agenda,bonos,reservaOnline}`, pero el repo modela cada flag como
   columna propia (`creditSalesEnabled`, `cashierSearchableContacts`…). Seguí esa convención;
   los flags de B5/B6 (bonos, reservaOnline) serán columnas hermanas. Menos fricción, mismo
   patrón probado. El prompt admitía `agenda` **o** `crm` — elegí `crm` por ser el nombre del
   dato que se activa aquí.
2. **El flag se togglea desde el admin del OWNER** (`POST /admin/tenant/settings`), en paridad
   con `creditSalesEnabled`, no sólo super-admin. La UI del toggle en `apps/admin` queda como
   carryover (la API ya lo acepta; el alcance de front del prompt era `apps/tpv-web`).
3. **`Client.externalId` (uuid, unique) añadido** — no estaba en la lista de campos del prompt,
   pero el alta offline "entra en la cola outbox como el resto" y el repo exige idempotencia
   por `externalId` (patrón `Ticket.externalId`). Un reintento del `POST /clients` con el
   mismo `externalId` devuelve el cliente ya creado en vez de duplicar.
4. **`tenantId` en las tablas hijas** (`ClientConsent`, `ClientTechnicalNote`) pese a que el
   boceto §4 no lo dibujaba — la restricción "todo lleva `tenantId`" manda. Además, los
   handlers validan SIEMPRE la propiedad del cliente padre (`loadOwnedClient`) antes de tocar
   hijas (doble puerta de aislamiento).
5. **`ClientTechnicalNote.createdByUserId` como Uuid plano, sin FK dura a `User`** — coherente
   con `serviceId` ("no FK dura") y con evitar tocar las relaciones de `User`. Es un campo de
   auditoría, no de integridad referencial.
6. **Teléfono NO único; duplicado = aviso `phoneWarning` no bloqueante.** El prompt ofrecía
   "único por tenant si se decide, o warning": elegí warning (familias comparten número; un
   único constraint bloquearía altas legítimas).
7. **Dos endpoints extra** (`POST /consents`, `POST /technical-notes`) más allá de los 6
   listados: son la "alta manual" que el prompt pide explícitamente para consentimientos y
   ficha técnica. Dentro de alcance.
8. **Historial = array único discriminado** (`entries[]` con `kind`) + arrays vacíos estables
   `appointments[]`/`voucherMovements[]`. Así B4/B5 rellenan sin que el front (que ya itera
   `entries` ordenado por fecha) cambie.
9. **F1 estaba documentado pero NO implementado** (`docs/02-arquitectura.md` §2.1 lo listaba
   como atajo previsto). Lo cableé ahora para abrir el picker del CRM. Al elegir un cliente
   **con** `holdedContactId`, se asigna al ticket por el camino fiscal existente (`setContact`
   → `contactHoldedId`, sin tocar checkout). **Sin** enlace fiscal, aviso transitorio: el
   enlace lo hará el cobro cuando haga falta factura (ADR-R2). El camino de cobro **no se
   toca**.
10. **Sección Clientes = overlay a pantalla completa** lanzado desde un botón del header de
    `SalePage` (gated por `crmEnabled`), como `TicketsHistoryPage`/`DebtsScreen`. El TPV no
    tiene router — es una máquina de estados con overlays.
11. **Base Dexie separada `mipiacetpv-clients`** (no extender el store del catálogo), para
    sobrevivir a los version-check que limpian el catálogo (mismo criterio que el outbox).
12. **Alta offline optimista con id = `externalId`**; online el server asigna su propio id.
    El siguiente `refreshClients` reconcilia por `externalId` (conserva pendientes que el
    server aún no conoce).
13. **Timestamp de migración `20260804000000`** (fecha kickoff), posterior a la última
    existente (`20260703010000_v1_8_fiado`).

## Fuera de alcance (respetado)

- **Firma digital** de consentimientos (fase 2) — sólo campos + alta manual.
- **Saldo/movimientos de bonos reales** (B5) — sólo contrato vacío.
- **Historial de citas real** (B4) — sólo contrato vacío.
- **Segmentación / campañas / recuperación** (fase 2).
- **Crear contactos en Holded desde el CRM** — sólo se persiste `holdedContactId`.
- **Duración de servicios / agenda / personal** (B2/B3/B4).
- **Migración de datos desde Koibox**.
- **Camino de cobro a Holded** (GET-back / tolerancia / `/pay`, ADR-010) — intacto.

## Verificación

- `packages/db`: `prisma format` + `prisma generate` OK (cliente v5.22.0).
- `apps/api`: `tsc --noEmit` limpio. **Suite completa: 79 files, 579 passed / 3 skipped**
  (los 3 skipped son de super-admin, preexistentes). `crm-route.test.ts`: 18/18.
- `apps/tpv-web`: `tsc --noEmit` limpio. `vite build` (tsc -b + vite) OK. `clients-cache.test.ts`: 7/7.
- Los ~76 fallos del resto de la suite front son **preexistentes** (tests `.tsx`/DOM que
  requieren jsdom; no hay `vitest.config` con `environment: jsdom`). Verificado con baseline
  (git stash): mismo estado sin mis cambios; `outbox.test.ts` falla en `window.setInterval`
  igual con y sin la rama (mi edit a `outbox.ts` es sólo de tipos). Cero regresiones.

## Carryovers para el siguiente bloque

1. **`apps/admin` · toggle UI de `crmEnabled`** en SettingsPage (la API ya lo acepta; hoy se
   activa por `POST /admin/tenant/settings` o super-admin/DB). Sin bloqueo para el TPV.
2. **Migración `20260804000000_b_koibox_1_crm` no aplicada al piloto** — `prisma migrate
   deploy` en el deploy (sólo se corrió `generate` en dev).
3. **Enlace `Client.holdedContactId` desde el cobro**: hoy el cobro fija `ticket.contactHoldedId`;
   falta el hook que, al crear/enlazar el contacto Holded en el cobro, persista también el
   `holdedContactId` del `Client` asignado. Punto de integración para el trabajo de cobro/B4.
4. **Reconciliación inmediata del alta offline**: al confirmar el outbox (`sent`), la fila
   optimista conserva su id temporal hasta el próximo `refreshClients`. Un `subscribeOutbox`
   que reemplace id temp→server al instante queda diferido (hoy basta el refresh).
5. **Tests React del front (jsdom)** siguen diferidos por la limitación de infra preexistente;
   la lógica nueva se cubre con test node-env (`clients-cache.test.ts`).
6. **`useClientPicker` listo para B4** (asignar cliente a cita) — mismo `open(onSelect)`.
