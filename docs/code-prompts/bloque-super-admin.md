# Prompt para Claude Code — B-SuperAdmin · panel multi-tenant operativo

Mini-bloque dedicado. Foco único: dar a Matías una **consola
super-admin** desde la que crear y operar tenants sin tocar SQL ni
SSH al servidor. Desbloquea el alta de los 5 pilotos sin fricción.

Pega esto en una sesión nueva de Claude Code tras pushear B-Print
fase 1 (commit `7cb6be9` ya en `origin/master`).

---

Hola Code. B-SuperAdmin es un mini-bloque para que el equipo
mipiacetpv (de momento sólo Matías, en el futuro un par de
operadores) pueda dar de alta clientes piloto sin acceder al
servidor. Hoy el `Tenant` + `OWNER User` se crean a mano vía
`psql`. Eso era suficiente para una sandbox; para 5 pilotos no.

## Contexto

B-Print fase 1 cerrado (commit `7cb6be9`). Lee primero:

- `docs/blocks/B-Print-fase-1-done.md` — qué quedó en B-Print fase 1.
- `apps/admin/src/AdminShell.tsx` — patrón del shell admin actual.
- `apps/admin/src/api.ts` — cliente API + manejo de tokens.
- `apps/api/src/auth/middleware.ts` — `requireOwner`,
  `requireOwnerOrManager`, `decodeJwt`.
- `apps/api/src/auth/routes.ts` — patrón de login + refresh actual.
- `packages/db/prisma/schema.prisma` — modelos `Tenant`, `User`,
  `Role` (OWNER/MANAGER/CASHIER).
- `apps/api/src/onboarding/initial-sync.ts` — qué dispara cuando se
  guarda la primera API key Holded.
- `apps/api/src/scripts/run-incremental-sync.ts` — CLI `resync` de
  B7.5 que vamos a exponer también vía UI.

## Por qué ahora

Antes del despliegue productivo a Hostinger necesitamos esto. Con
5 pilotos esperando, hacer `INSERT INTO tenants ...` por cada uno
es:

1. **Operativamente frágil**: SSH + psql para cada alta = error
   humano garantizado.
2. **No escala**: cada tenant requiere generar password temporal,
   mandarlo al cliente, etc. Trabajo repetitivo que pide automatizar.
3. **Falta visibilidad**: hoy no hay forma de ver "qué tenants
   están activos, cuáles tienen Holded mal conectado, cuántos
   tickets están en SYNC_FAILED a nivel global" sin scripts.

## Alcance · 6 frentes

### Frente 1 · Modelo `SuperAdminUser` + migración

Separar identidad super-admin de la identidad per-tenant
(`User`). Razón: que no haya nunca el riesgo de que un `User`
escalable por flujo de tenant termine teniendo permisos super.
Aislamiento limpio.

```prisma
model SuperAdminUser {
  id              String    @id @default(uuid()) @db.Uuid
  email           String    @unique
  passwordHash    String    @map("password_hash")
  tokenVersion    Int       @default(0) @map("token_version")
  totpSecret      String?   @map("totp_secret")
  totpEnabledAt   DateTime? @map("totp_enabled_at") @db.Timestamptz()
  recoveryCodes   String[]  @default([]) @map("recovery_codes")
  lastLoginAt     DateTime? @map("last_login_at") @db.Timestamptz()
  createdAt       DateTime  @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt       DateTime  @updatedAt @map("updated_at") @db.Timestamptz()
  // Auditoría: qué operaciones impersonate / resync / block hizo.
  audits          SuperAdminAudit[]

  @@map("super_admin_users")
}

model SuperAdminAudit {
  id              String         @id @default(uuid()) @db.Uuid
  superAdminId    String         @map("super_admin_id") @db.Uuid
  superAdmin      SuperAdminUser @relation(fields: [superAdminId], references: [id])
  action          String         // "create_tenant" | "block_tenant" | "unblock_tenant" | "force_logout" | "resync" | "impersonate"
  tenantId        String?        @map("tenant_id") @db.Uuid
  metadata        Json?
  createdAt       DateTime       @default(now()) @map("created_at") @db.Timestamptz()

  @@index([superAdminId, createdAt])
  @@index([tenantId, createdAt])
  @@map("super_admin_audits")
}
```

Migración `b9_super_admin_users`. Sin backfill (la tabla nace
vacía; el primer super-admin se crea con el seed script del
Frente 6).

### Frente 2 · Auth super-admin

JWT propio, ortogonal al JWT per-tenant. Razón: que sean
tokens que el frontend NO pueda confundir y que un compromiso
de uno no permita el otro.

- Variable de entorno nueva: `SUPER_ADMIN_JWT_SECRET` (40+ chars,
  separada de las dos JWT secrets existentes).
- Rutas en `apps/api/src/superadmin/auth.ts`:
  - `POST /super-admin/auth/login` con body `{ email, password }`.
    Verifica argon2, comprueba 2FA si está habilitado, devuelve
    `accessToken` + `refreshToken` con payload
    `{ sub, purpose: "super-admin", tv }`.
  - `POST /super-admin/auth/login-2fa` con `{ pendingToken, totpCode }`
    cuando 2FA está activo (mismo patrón que B3 para users
    normales).
  - `POST /super-admin/auth/refresh`.
  - `POST /super-admin/auth/logout` (tokenVersion++).
  - `POST /super-admin/auth/totp/enable` y
    `/super-admin/auth/totp/confirm` siguiendo el patrón de B3.
- Middleware `requireSuperAdmin(req)` que valida el JWT, comprueba
  `purpose === "super-admin"` y `tv` matches DB. Rechaza con 401
  cualquier otro token (incluso un OWNER válido).
- Rate limit 5 intentos/15min por email + IP.

### Frente 3 · Endpoints super-admin

Todos bajo `/super-admin/...` y protegidos por `requireSuperAdmin`.

**Listado de tenants** — `GET /super-admin/tenants?q=...&status=...&sort=...`

Devuelve cada tenant con métricas computadas:

```ts
{
  id, name, fiscalNif, ownerEmail, ownerLastLoginAt,
  holdedConnected: boolean,           // hay holdedApiKeyCiphertext
  createdAt,
  blockedAt: Date | null,
  metrics: {
    ticketsLast7d: number,
    ticketsSyncFailed: number,        // estado SYNC_FAILED actual
    ticketsEmailFailed: number,       // emailFailedAt no null
    degraded: { state: "ok" | "warning" | "blocked", lastIncrementalSyncAt: Date | null },
    storesCount: number,
    activeShifts: number,
  }
}
```

Paginación 20 por defecto, search por nombre/NIF/email, sort
por createdAt | ticketsLast7d | name.

**Detalle de tenant** — `GET /super-admin/tenants/:id`

Lo mismo que el listado + lista de Users (email, role,
lastLoginAt, 2faEnabled), lista de Stores (nombre, dirección,
ticketDelivery resumido), última actividad de sync.

**Crear tenant** — `POST /super-admin/tenants`

Body:
```json
{
  "name": "Librería Thalia SL",
  "fiscalNif": "B12345678",
  "fiscalAddress": "Calle Mayor 10, Madrid",
  "ownerEmail": "thalia@example.com",
  "ownerName": "María Pérez",
  "plan": "pilot"
}
```

Transacción:
1. Crea `Tenant` con `fiscalProfile = { legalName, nif, address }`.
2. Genera password temporal random 16 chars
   (`generateTemporaryPassword()` helper).
3. Crea `User` con `role=OWNER`, email, password hasheado,
   `mustChangePasswordAt = now` (campo nuevo en `User` — añadir
   migración en este frente o piggyback en `b9_super_admin_users`).
4. Manda email al OWNER con el patrón existente (
   `getEmailSender().send(...)`) con el link de login y la
   password temporal. Template HTML simple, copy en español.
5. Devuelve `{ tenant, ownerEmail, tempPassword }` — el frontend
   lo muestra UNA vez en pantalla por si el email se pierde.
6. Audit log `create_tenant`.

Validaciones: NIF formato español básico, email unique en User,
nombre tenant unique.

**Bloquear / desbloquear tenant** —
`PATCH /super-admin/tenants/:id/status` con `{ blockedAt: Date | null, reason?: string }`.

Cuando un tenant está bloqueado, **el middleware
`requireOwnerOrManager` lo rechaza con 423 Locked** y mensaje
"Cuenta bloqueada. Contacta con soporte". Esto cubre casos
"cliente dejó de pagar" o "fraude detectado".

Audit log con razón.

**Force logout de un tenant** —
`POST /super-admin/tenants/:id/force-logout`

Incrementa `tokenVersion` de TODOS los users del tenant. En la
siguiente request, sus JWT serán inválidos. Audit log.

**Resync manual** — `POST /super-admin/tenants/:id/resync`

Invoca el mismo flujo que la CLI `resync` de B7.5 (encola un job
de `incremental-sync` con `force=true`). Responde 202 con
`syncJobId`. Audit log.

**Impersonate read-only** —
`POST /super-admin/tenants/:id/impersonate`

Genera un JWT efímero con payload
`{ sub: ownerUserId, role: "OWNER", tid: tenantId, purpose: "impersonation", readOnly: true, tv }`
TTL 30 min. El middleware `requireOwner` etc. acepta este JWT,
PERO si el JWT tiene `readOnly: true`, cualquier mutación
(POST/PATCH/DELETE) se rechaza con 403 "Impersonación de sólo
lectura". El frontend al detectar `readOnly: true` muestra un
banner rojo "Sesión de impersonación · sólo lectura".

Audit log obligatorio con tenant + super-admin + IP.

### Frente 4 · UI super-admin

Nueva ruta `/superadmin` en `apps/admin` con shell propio
(NO comparte navegación con el shell per-tenant — evita confusión).

- `apps/admin/src/superadmin/SuperAdminShell.tsx` con sidebar
  propio (Tenants, Auditoría, Mi cuenta).
- `apps/admin/src/superadmin/SuperAdminLoginPage.tsx` — login
  propio con flujo 2FA.
- `apps/admin/src/superadmin/TenantsListPage.tsx` — listado con
  filtros, search, sort. Cards o tabla. Las métricas se muestran
  con badges de color (verde/ámbar/rojo según degraded state +
  SYNC_FAILED count).
- `apps/admin/src/superadmin/TenantDetailPage.tsx` — detalle
  con acciones (Bloquear, Force Logout, Resync, Impersonar) +
  audit log local.
- `apps/admin/src/superadmin/CreateTenantPage.tsx` — form de
  alta + pantalla post-creación con la password temporal
  (con copy-to-clipboard).
- `apps/admin/src/superadmin/AuditLogPage.tsx` — historial
  global de acciones super-admin con filtros (acción,
  superAdmin, tenant, rango fechas).

Routing: `/superadmin/login`, `/superadmin/tenants`,
`/superadmin/tenants/new`, `/superadmin/tenants/:id`,
`/superadmin/audit`, `/superadmin/me`. Si no hay sesión
super-admin, redirige a `/superadmin/login`.

Storage del token super-admin en localStorage con key
`super_admin_access_token` (distinta de la del admin per-tenant
para que ambas sesiones puedan coexistir en el mismo navegador
sin pisarse).

### Frente 5 · CLI seed del primer super-admin

`apps/api/src/scripts/create-super-admin.ts` — CLI interactivo:

```bash
pnpm --filter @mipiacetpv/api super-admin:create
```

Pide email + password (con confirmación), valida formato + fuerza
mínima 12 chars, hashea con argon2id, INSERT en `super_admin_users`.
Idempotente (si el email ya existe, error con mensaje claro).

Documentar en `apps/api/README.md` como paso post-deploy.

### Frente 6 · Tests

- `super-admin-auth.test.ts`: login OK, login con password mala,
  rate limit, 2FA flow, refresh, logout.
- `super-admin-isolation.test.ts`: un OWNER no puede llamar a
  `/super-admin/*` (401). Un SUPERADMIN no puede llamar a
  `/admin/stores/...` sin impersonate (401). Tokens cruzados
  fallan.
- `super-admin-tenants.test.ts`: crear tenant + OWNER en una
  transacción, email se manda (sender mock), password temporal
  devuelta, idempotencia (mismo email = 409).
- `super-admin-block.test.ts`: bloquear tenant → OWNER recibe 423
  en su próxima request. Desbloquear → vuelve a funcionar.
- `super-admin-impersonate.test.ts`: JWT con `readOnly:true`
  permite GET pero rechaza POST/PATCH/DELETE con 403.
- `super-admin-audit.test.ts`: cada acción registra un audit log.

## Restricciones

- **NO** tocar el flujo per-tenant (OWNER/MANAGER/CASHIER) existente.
  El middleware super-admin es ortogonal.
- **NO** incluir billing/Stripe ni subscriptions automáticas. El
  plan se guarda como string libre (`"pilot" | "free" | "paid"`)
  por ahora; lo gestionamos manualmente.
- **NO** incluir self-service signup público. Eso es post-v1.
- **NO** romper sesiones existentes de OWNER/MANAGER al desplegar.
  Las migraciones deben ser idempotentes y no afectar User
  existentes.
- Mantener ADR-007 (offline-friendly per-tenant) — el super-admin
  no necesita offline, sólo se usa desde la oficina.

## Entregables

1. PR único con B-SuperAdmin.
2. Commit message descriptivo siguiendo el patrón de B-Print
   fase 1.
3. `docs/blocks/B-SuperAdmin-done.md` con resumen estructurado.
4. Migración `b9_super_admin_users`.
5. README breve para crear el primer super-admin tras deploy
   (`apps/api/README.md` sección "Post-deploy setup").

## Lo que NO entra

- Billing/Stripe.
- Self-service signup público.
- Multi-region / multi-AZ.
- Backup automatizado (eso lo gestionamos a nivel infra, no app).
- OAuth con Holded (B1 actual usa API key manual, lo refinaremos
  post-piloto).
- Métricas avanzadas tipo MRR, churn (post-v1).

Cuando B-SuperAdmin cierre, despliegue a Hostinger + alta de
Thalia en cuanto la cuenta Holded esté conectada.
