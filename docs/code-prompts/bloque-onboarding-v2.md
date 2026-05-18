# Prompt para Claude Code — B-OnboardingV2 · alta supervisada de tenants

Bloque dedicado (~4-5 días Code). Redibuja el flujo de alta de
tenants para que:

1. **Holded sea la única fuente de verdad fiscal** (no pedir datos
   que ya están en Holded).
2. **El equipo mipiacetpv pueda probar el TPV completo del cliente**
   antes de que el cliente toque nada.
3. **El propietario no reciba email** hasta que el equipo confirme
   que el sistema funciona end-to-end con su cuenta.
4. **El propietario no vea complejidad técnica** (API key Holded,
   bandejas de errores de sync, SKU review, etc.) en el admin.

Pega esto en una sesión de Claude Code tras pushear B-Hotfixes
(commit que cierra ese mini-bloque).

---

Hola Code. B-OnboardingV2 es el rediseño del flujo de alta de
tenants. La razón es estratégica: estamos en fase piloto con 5
clientes esperando, queremos **supervisión total del equipo
mipiacetpv** antes de que el cliente vea nada. Y queremos un flujo
coherente con el principio "Holded es la fuente de verdad fiscal"
(memory `project_marco_legal_fiscal.md`).

## Contexto

El flujo actual de B-SuperAdmin (commit `34bc002`) tiene fricciones:

1. **POST `/super-admin/tenants`** pide razón social, NIF, dirección
   fiscal manualmente — pero esos datos YA están en la cuenta Holded
   del cliente. Duplicamos info y nos arriesgamos a desincronización.
2. **Manda email al OWNER inmediatamente** al crear el tenant —
   crea dependencia con el cliente antes de validar nada.
3. **El OWNER ve toda la admin per-tenant** incluyendo cosas
   técnicas: API key Holded, bandejas SYNC_FAILED, SKU review,
   settings de modo degradado. El propietario de un negocio no tiene
   por qué entender ni tocar esto.
4. **No hay forma de que el equipo mipiacetpv pruebe el TPV** del
   cliente antes de soltárselo. Sin esto, los problemas aparecen
   delante del cliente.

Lee primero:
- `docs/blocks/B-SuperAdmin-done.md` — qué hay implementado actualmente.
- `apps/api/src/superadmin/` — endpoints super-admin existentes.
- `apps/api/src/auth/middleware.ts` — `requireOwner`, `requireOwnerOrManager`, `requireAnyRole`.
- `apps/admin/src/superadmin/` — UI super-admin actual.
- `apps/admin/src/AdminShell.tsx` — shell admin per-tenant.
- `packages/db/prisma/schema.prisma` — modelos Tenant, User, Cashier, Ticket.
- `apps/api/src/workers/ticket-upload-worker.ts` — worker que sube tickets a Holded.
- `apps/api/src/workers/ticket-email-worker.ts` — worker que manda email del ticket.
- `packages/holded-client/src/` — métodos del cliente Holded.
- `apps/api/src/onboarding/initial-sync.ts` — sync inicial del catálogo.

## Concepto · estados del tenant

```
DRAFT  → tenant creado, API key conectada, sync inicial corriendo.
         Sin OWNER user todavía. El equipo opera el TPV en "modo
         prueba" (cajero técnico interno, tickets NO suben a Holded,
         emails NO se mandan). El cliente no sabe nada.

READY  → equipo ha validado la salud del onboarding (sync OK, taxes
         coherentes, productos sellable, etc.). Pendiente de activar
         el acceso al propietario.

ACTIVE → equipo introduce email + nombre del propietario. El sistema
         crea OWNER user con password temporal, manda email canónico
         de bienvenida, purga los datos de prueba. A partir de aquí
         operación productiva real (tickets a Holded, emails al
         cliente final, etc.).

BLOCKED → como en B-SuperAdmin actual, sin cambios.
```

## Alcance · 8 frentes

### Frente 1 · Modelo `Tenant.onboardingState` + migración

```prisma
enum OnboardingState {
  DRAFT
  READY
  ACTIVE
}

model Tenant {
  // ...
  onboardingState OnboardingState @default(DRAFT) @map("onboarding_state")
  // ...
}
```

Migración `b10_tenant_onboarding_state`. **Backfill defensivo**: para
los Tenants existentes (los que se hayan creado con flujo viejo o
manualmente vía SQL), poner `onboarding_state = 'ACTIVE'` para no
romper nada en producción.

### Frente 2 · Crear tenant solo con API key Holded

Reescribir `POST /super-admin/tenants`:

**Body nuevo:**
```json
{ "holdedApiKey": "abc...123" }
```

**Flujo transaccional:**

1. Validar la API key contra Holded: hacer GET a `/account/me` (o el
   endpoint canónico que devuelva los datos del owner de la cuenta —
   ejecutar mini-spike §12 si no está claro qué endpoint Holded
   expone para "información de la cuenta del propietario").
2. Extraer de la respuesta:
   - `legalName` (razón social).
   - `taxId` (NIF/CIF/NIE).
   - `address` (calle, ciudad, código postal, país).
   - `phone` (opcional).
3. Validar con `validateSpanishTaxId(taxId)`. Si inválido → error
   400 `INVALID_HOLDED_FISCAL_PROFILE` con detalle.
4. Crear `Tenant` con `fiscalProfile = { legalName, taxId, address, phone }`,
   `holdedApiKeyCiphertext = encrypt(apiKey)`, `onboardingState = 'DRAFT'`,
   `name = legalName` (mismo valor por defecto, el equipo puede
   cambiarlo después).
5. Encolar `initial-sync` para ese tenant.
6. **NO crear User OWNER todavía.** Esto es la diferencia clave.
7. Audit log `create_tenant_draft` con metadata `{ tenantId, fiscalNif, ipAddress, userAgent }`.

**Respuesta:**
```json
{ "tenant": { ...fiscalProfile, id, name, onboardingState: "DRAFT" }, "syncJobId": "..." }
```

Si la API key falla la validación de Holded (401/404) → error 400
`HOLDED_API_KEY_INVALID` con detalle.

### Frente 3 · Panel de validación del onboarding

Ampliar `GET /super-admin/tenants/:id` para que el detalle muestre
**métricas de salud del onboarding** que el equipo usa para decidir
cuándo está READY:

```json
{
  "tenant": { id, name, fiscalProfile, onboardingState, createdAt, ... },
  "onboardingHealth": {
    "initialSync": { "status": "RUNNING" | "DONE" | "FAILED", "lastRunAt": "...", "errorMessage": null },
    "taxes": { "total": 108, "withValidRate": 98, "withoutRate": 10 },
    "products": { "total": 77, "sellable": 74, "withSku": 60, "withoutSku": 17 },
    "services": { "total": 24, "sellable": 0 },
    "contacts": { "total": 313 },
    "ticketsTest": { "total": 0, "lastAt": null },
    "readinessChecks": [
      { "id": "sync-done", "label": "Sync inicial completado", "ok": true },
      { "id": "taxes-ratio", "label": "≥80% de taxes con rate", "ok": true, "value": "98/108 (91%)" },
      { "id": "products-sellable", "label": "≥50% de productos sellable", "ok": true, "value": "74/77 (96%)" },
      { "id": "no-sync-failures", "label": "Sin tickets SYNC_FAILED", "ok": true }
    ],
    "ready": true
  }
}
```

`onboardingHealth.ready` es la AND lógica de los `readinessChecks`.
Los thresholds (80% taxes, 50% sellable, etc.) son arbitrarios —
documentar en código que son ajustables.

El frontend usa `ready` para habilitar/deshabilitar el botón
"Activar tenant".

### Frente 4 · Cajero técnico interno + modo test

Cuando el sync inicial completa OK (worker `initial-sync` termina
exitoso) y el tenant está en `DRAFT`, **auto-crear** un `Cashier`
con:

```prisma
model Cashier {
  // ...
  isTestCashier Boolean @default(false) @map("is_test_cashier")
  // ...
}
```

Migración `b10_cashier_is_test`. Backfill `false` para todos los
cajeros existentes.

Cuando se crea el cajero test:
- `email = "mipiacetpv-test-${tenantId.slice(0,8)}@internal.mipiacetpv.tech"` (interno, no enviado).
- `name = "Equipo mipiacetpv (modo prueba)"`.
- `pin = generateNumericPin(6)` random, hash con argon2 (mismo patrón).
- `isTestCashier = true`.
- Asociado al primer `Store` del tenant (si no existe Store, crearlo también con un placeholder "Tienda principal" — la admin permite renombrar/eliminar después).
- Asociado al primer `Register` (idem).

Workers que detectan `isTestCashier`:

- **`ticket-upload-worker`**: si `ticket.cashier.isTestCashier === true`,
  marca el ticket como `status = "TEST"` (nuevo enum value) y **NO**
  hace upload a Holded. Skip silencioso, log info.
- **`ticket-email-worker`**: si el ticket asociado tiene
  `cashier.isTestCashier === true`, skip y marcar el job como
  `status = "SKIPPED_TEST"`.

Añadir a `TicketStatus`:
```prisma
enum TicketStatus {
  DRAFT
  PENDING_SYNC
  SYNCED
  SYNC_FAILED
  REFUND
  TEST  // ← nuevo
}
```

Migración `b10_ticket_status_test`. Sin backfill, valor nuevo.

### Frente 5 · "Probar TPV" desde super-admin

**Endpoint** `POST /super-admin/tenants/:id/test-cashier-token`:

- Requiere `requireSuperAdmin`.
- Valida que `tenant.onboardingState === 'DRAFT'`.
- Localiza el `Cashier` con `isTestCashier=true` para ese tenant.
- Genera un JWT con payload
  `{ sub: cashierId, tid: tenantId, purpose: "test-cashier", exp: now + 24h }`
  firmado con `JWT_ACCESS_SECRET` (mismo del per-tenant). Sin refresh.
- Devuelve `{ token, expiresAt }`.
- Audit log `test_cashier_session` con `{ expiresAt, ipAddress, userAgent }`.

**Aceptación del JWT en middlewares per-tenant del TPV:**

El middleware `requireCashierSession` (que protege rutas TPV) acepta
JWT con `purpose === "test-cashier"` además del normal con
`purpose === "cashier"`. Si es test-cashier:
- Se inyecta `req.cashier.isTest = true` para que los handlers de
  ticket lo persistan en `Ticket.cashierIsTest` (cache, no
  imprescindible).
- El check de "tenant blocked" sigue aplicando.
- Mutaciones permitidas (a diferencia de impersonation read-only).

**UI super-admin (Frente 8 lo describe completo)**: botón "Probar
TPV" en detalle de tenant DRAFT. Hace POST al endpoint, recibe
token, abre `${PUBLIC_TPV_URL}/?testCashierToken=<jwt>` en pestaña
nueva (`window.open`, `noopener`).

**UI PWA TPV** (cambios mínimos):
- Al cargar, si query param `?testCashierToken=` presente, guardar
  token en `sessionStorage` (key `cashier_access_token`, NO
  localStorage — no contamina sesión real), limpiar query param.
- Si el token actual tiene `purpose: "test-cashier"`, mostrar
  **banner amarillo persistente arriba**:
  > Modo prueba · ventas no se suben a Holded · cliente:
  > **[tenant.name]** · caduca en NN min/h (countdown).
- Botón "Salir de modo prueba" en el banner → limpia sessionStorage
  y `window.close()`.

### Frente 6 · Activar tenant (crear OWNER + email)

Nuevo endpoint `POST /super-admin/tenants/:id/activate`:

**Validaciones (rechazo con 4xx claro si falla):**
- `requireSuperAdmin`.
- Tenant existe.
- `tenant.onboardingState === 'DRAFT'` (no se puede reactivar
  ACTIVE, ese flujo es distinto).
- `onboardingHealth.ready === true` (la heurística del Frente 3 está
  verde).
- Email del OWNER único en la tabla `User` global.

**Body:**
```json
{ "ownerEmail": "thalia@example.com", "ownerName": "María Pérez" }
```

**Transacción:**

1. Generar `tempPassword = generateTemporaryPassword()`.
2. Crear `User` con `role: OWNER`, `tenantId`, `email: ownerEmail`,
   `name: ownerName`, `passwordHash: argon2(tempPassword)`,
   `mustChangePasswordAt: now()`.
3. **Purgar datos de prueba** del tenant:
   - `DELETE FROM tickets WHERE tenant_id = $1 AND status = 'TEST'`.
   - `DELETE FROM ticket_email_jobs` asociados a esos tickets.
   - Marcar el `Cashier` test como `deleted_at = now()` (soft-delete,
     queda histórico).
4. Transicionar `tenant.onboardingState = 'ACTIVE'`.
5. Mandar email al OWNER con la plantilla canónica de B-SuperAdmin
   (subject "Bienvenido a Mipiacetpv · Tu cuenta está lista", etc.).
   Si SMTP no configurado, el sender cae a Console y la
   `tempPassword` se devuelve en la response para que el super-admin
   se la pase al cliente offline.
6. Audit log `activate_tenant` con metadata `{ ownerEmail, ownerName, ticketsTestPurged: <count>, ipAddress, userAgent }`.

**Respuesta:**
```json
{
  "tenant": { ...onboardingState: "ACTIVE" },
  "owner": { id, email, name },
  "tempPassword": "..."   ← devuelta una sola vez, el frontend la muestra
}
```

### Frente 7 · Refactor permisos OWNER

Mover de OWNER (per-tenant admin) a SUPER_ADMIN exclusivo los
siguientes endpoints/secciones:

| Endpoint / sección                                           | Antes        | Después                |
|---|---|---|
| `PATCH /tenants/:id/holded-api-key`                          | OWNER        | SUPER_ADMIN            |
| `GET/PATCH /tenants/:id/holded-config` (modo degradado etc.) | OWNER        | SUPER_ADMIN            |
| `/admin/tickets-errors/*` (bandeja SYNC_FAILED)              | OWNER/MANAGER| SUPER_ADMIN            |
| `/admin/sku-review/*` (bandeja productos sin SKU)            | OWNER/MANAGER| SUPER_ADMIN            |
| `/admin/devices/*` (gestión de dispositivos críticos)        | OWNER        | SUPER_ADMIN            |
| `/admin/tenant-settings/*` (config técnica)                  | OWNER        | SUPER_ADMIN            |

Mantener en OWNER:
- `/admin/stores/*` (tiendas y cajas).
- `/admin/cashiers/*` (alta, PIN, baja de cajeros).
- `/admin/ticket-delivery/*` (comunicación de ticket — esto es de
  negocio).
- `/auth/me`, `/auth/password-reset`, `/auth/totp/*` (su propia
  cuenta).
- Datos fiscales en `Mi cuenta` → **read-only** (los datos vienen
  de Holded vía sync, no se editan en mipiacetpv; mostrar como
  info con caption "Estos datos se gestionan en tu cuenta de Holded").

Los super-admin que necesiten operar como un OWNER (no solo read)
ya tienen el flujo de **impersonation con readOnly:true** de
B-SuperAdmin. Para tareas de configuración técnica (cambiar API
key, gestionar SYNC_FAILED, etc.) acceden directamente desde
`/superadmin/tenants/:id/*` con su rol nativo (sin impersonation,
sin readOnly).

### Frente 8 · UI super-admin con estados + UI admin OWNER reducido

**UI super-admin:**

- **Listado de tenants** (`/superadmin/tenants`): badge de estado
  visible:
  - DRAFT (gris) · "En configuración"
  - READY (ámbar) · "Listo para activar" (no usado todavía si
    READY se calcula on-the-fly desde health; se puede omitir o
    mostrarlo cuando `ready=true` aunque siga en DRAFT).
  - ACTIVE (verde) · "Operativo"
  - BLOCKED (rojo) · "Bloqueado"
- **Crear tenant** (`/superadmin/tenants/new`):
  - Form simplificado: solo `holdedApiKey` (input password masked).
  - Botón "Crear conexión" → POST, muestra spinner mientras valida
    API key.
  - Tras éxito: redirige a `/superadmin/tenants/:id`.
- **Detalle tenant DRAFT** (`/superadmin/tenants/:id`):
  - Panel "Datos fiscales" (read-only, traídos de Holded).
  - Panel "Validación de onboarding": tabla de `readinessChecks` con
    verde/rojo, métricas, botón "Re-sync" si algo falla.
  - Panel "Modo prueba": botón "Probar TPV" → genera token, abre
    pestaña nueva. Lista de tickets test creados (count + último).
  - Panel "Activar": botón "Activar tenant" disabled hasta que
    `ready=true`. Al pulsar, modal con:
    - Form `ownerEmail` + `ownerName`.
    - Banner de confirmación: "Al confirmar, se creará la cuenta
      del propietario y se le enviará email con sus credenciales.
      Los tickets de prueba se borrarán."
    - Botón "Confirmar activación".
    - Tras éxito: pantalla post-activación con `tempPassword`
      copyable + "Ir al tenant".

**UI admin OWNER (subset reducido):**

- `AdminShell` detecta `role === "OWNER"` y oculta del sidebar:
  - "Integraciones" → completo.
  - "Bandejas" → completo (errores sync, SKU review).
  - "Settings técnicos" → completo.
  - Deja visible: Tiendas, Cajeros, Comunicación ticket, Mi cuenta.
- "Mi cuenta" del OWNER: muestra datos fiscales con caption
  "Sincronizado desde Holded" + button-link a Holded para editar.
  Los inputs son `readOnly`.
- Mismo subset aplica a MANAGER (que ya tiene matriz de B6 con
  bastantes restricciones).

## Mini-spike previo si necesario

Si el endpoint Holded para "datos de la cuenta del propietario" no
está claro, ejecutar mini-spike §12:

`spike/holded/src/12-account-info.ts`:
- Probar `GET /invoicing/v1/account`.
- Probar `GET /users/me`.
- Probar `GET /companies/current` o equivalente.
- Documentar en `docs/spike-holded.md` §12 cuál devuelve los datos
  fiscales del owner (legalName, taxId, address).

Si encuentras 2 endpoints que sirven, usar el que devuelva el
formato más limpio. Si ninguno, fallback: pedir taxId al super-admin
como input minimal y derivar el resto haciendo `GET
/contacts?taxId=<x>` (estrategia b).

## Tests

- `super-admin-tenants-onboarding.test.ts`: crear tenant solo con
  API key → fiscalProfile poblado desde Holded mock, estado DRAFT,
  sin User OWNER.
- `tenant-state-machine.test.ts`: transiciones válidas e inválidas
  (DRAFT→ACTIVE OK, ACTIVE→DRAFT bloqueado, etc.).
- `test-cashier.test.ts`: cajero test auto-creado al cerrar sync
  inicial. Ticket creado por test cashier → no sube a Holded → no
  manda email.
- `test-cashier-token.test.ts`: endpoint genera JWT con purpose
  test-cashier, TTL 24h, no refresh.
- `activate-tenant.test.ts`: estado DRAFT con health=ready → activa
  OK, crea OWNER user, manda email, purga tickets test, transiciona
  a ACTIVE. Estado DRAFT con health=not-ready → 400. Estado ACTIVE
  → 409 conflict.
- `permissions-owner-reduced.test.ts`: OWNER recibe 403 en endpoints
  técnicos (`/tenants/:id/holded-api-key`, `/admin/tickets-errors`,
  etc.). SUPER_ADMIN recibe 200.

## Restricciones

- **NO** romper sesiones existentes ni datos de los Tenants que
  ya existan (el backfill DRAFT→ACTIVE garantiza esto).
- **NO** tocar el flujo de B-SuperAdmin para el resto de operaciones
  (block, force-logout, resync, impersonate). Solo redefinir create
  y añadir activate + test-cashier.
- **NO** incluir self-service signup público (sigue siendo defensivo).
- **NO** incluir billing.
- ADR-007 (offline-friendly per-tenant) se mantiene para el TPV
  productivo. El modo test puede asumir online (es operación de
  equipo).

## Entregables

1. PR único con los 8 frentes.
2. Commit message descriptivo.
3. `docs/blocks/B-OnboardingV2-done.md` con resumen estructurado
   (frentes hechos, decisiones tomadas, dudas pendientes).
4. 3 migraciones: `b10_tenant_onboarding_state`, `b10_cashier_is_test`,
   `b10_ticket_status_test`.
5. Documentación actualizada: `docs/blocks/B-SuperAdmin-done.md`
   con nota "superado por B-OnboardingV2 en los frentes de create
   y permisos OWNER".

## Lo que NO entra

- Self-service signup público.
- Billing / Stripe.
- DELETE tenant (sigue siendo NO, block es la operación correcta).
- OAuth con Holded (sigue API key manual; refinaremos post-piloto).
- Auto-detección de "READY" basada en heurística externa más
  sofisticada (por ejemplo, análisis de productos). El criterio
  actual de readinessChecks basta.
- Webhooks Holded para sync continuo — sigue siendo polling cron.
- Multi-fabricante TPV all-in-one (sigue planeado para v2 con A1).

Cuando este bloque cierre, Matías pushea, hace `git pull && bash
infra/bootstrap-hostinger.sh` en VPS, valida con un tenant DRAFT
de prueba (sin email a Thalia todavía), y cuando salud=ready y haya
operado el TPV en modo prueba sin sorpresas → activa Thalia con
su email real. Primer piloto productivo lanzado con supervisión
total del equipo.
