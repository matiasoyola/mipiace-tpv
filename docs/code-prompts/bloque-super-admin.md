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

Migración `b9_super_admin_users` también incluye en el mismo SQL
(misma transacción atómica) dos cambios al modelo per-tenant:

```sql
-- Para forzar cambio de password en el primer login del OWNER
-- recién creado por super-admin.
ALTER TABLE users ADD COLUMN must_change_password_at TIMESTAMPTZ NULL;

-- Para bloquear el tenant globalmente. NULL = activo. NOT NULL = bloqueado.
ALTER TABLE tenants ADD COLUMN blocked_at TIMESTAMPTZ NULL;
ALTER TABLE tenants ADD COLUMN blocked_reason TEXT NULL;
```

Y en el schema Prisma:

```prisma
model User {
  // ...
  mustChangePasswordAt DateTime? @map("must_change_password_at") @db.Timestamptz()
}

model Tenant {
  // ...
  blockedAt     DateTime? @map("blocked_at") @db.Timestamptz()
  blockedReason String?   @map("blocked_reason")
}
```

Sin backfill (los registros existentes nacen con valores null;
todo sigue funcionando igual hasta que un super-admin bloquee o
cree).

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

**Middleware base `requireTenantNotBlocked(req)`** — gating global
del bloqueo de tenant. Razón: la comprobación tiene que estar
ANTES de cualquier middleware per-tenant (requireOwner,
requireOwnerOrManager, requireAnyRole, requireCashierSession) para
que TODOS los roles del tenant — incluido CASHIER — queden cortados
cuando un super-admin bloquea la cuenta.

- Se ejecuta como preHandler global en el plugin de auth
  per-tenant. Lee `tenantId` del JWT, hace `SELECT blocked_at FROM
  tenants WHERE id = $1`.
- Si `blocked_at != null` → responde **423 Locked** con
  `{ code: "TENANT_BLOCKED", reason: tenant.blocked_reason ?? null }`.
- Rutas exentas (no aplica el middleware): `/super-admin/*`,
  `/auth/login`, `/auth/password-reset/*`, `/health`.
- El cliente TPV al recibir 423 debe mostrar pantalla full-screen
  "Cuenta bloqueada · Contacta con soporte" sin opción de
  continuar. El admin per-tenant idem.

**Comportamiento de `mustChangePasswordAt`** en el login per-tenant
(actualización del flujo de B1/B3):

- `POST /auth/login` valida password normalmente. Si OK y
  `user.mustChangePasswordAt != null`, emite un JWT especial con
  payload `{ sub, tid, role, purpose: "must-change-password", tv }`
  y TTL 15 min — NO el JWT normal de sesión. El frontend al
  detectar `purpose: "must-change-password"` redirige
  obligatoriamente a `/change-password-initial`.
- `POST /auth/change-password-initial` requiere el JWT
  `must-change-password`, valida nueva password (mín 12 chars,
  no igual a temporal anterior), hashea, actualiza `passwordHash`,
  pone `mustChangePasswordAt = null`, incrementa `tokenVersion`
  (invalida el JWT temporal), y devuelve un par
  accessToken/refreshToken normales de sesión.
- Cualquier otro endpoint que reciba el JWT `must-change-password`
  responde **403 PASSWORD_CHANGE_REQUIRED** — sólo el endpoint de
  cambio inicial lo acepta.

**Aceptación de JWT impersonation por middlewares per-tenant.**

Los middlewares `requireOwner`, `requireOwnerOrManager` y
`requireAnyRole` se amplían para aceptar JWT con
`purpose === "impersonation"` SI:

- `role` en el payload es `OWNER` (la impersonación siempre se
  hace como OWNER del tenant impersonado).
- `tid` del payload coincide con el tenantId del recurso accedido.
- `readOnly === true` (siempre en este flujo).

Cuando un middleware acepta un JWT impersonation con
`readOnly:true`:
- Si el método HTTP es `GET` → pasa.
- Si es `POST` / `PATCH` / `PUT` / `DELETE` → responde **403
  IMPERSONATION_READONLY** con `{ code: "IMPERSONATION_READONLY",
  message: "Sesión de impersonación es sólo lectura" }`.

El JWT impersonation tiene TTL 30 min, **sin refresh**. Al
caducar el super-admin tiene que volver a abrir impersonación.

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
1. Valida `fiscalNif` con `validateSpanishTaxId` (ver helper más
   abajo). Si inválido → 400.
2. Crea `Tenant` con `fiscalProfile = { legalName, nif, address }`.
3. Genera password temporal random 16 chars
   (`generateTemporaryPassword()` helper, charset definido abajo).
4. Crea `User` con `role=OWNER`, email, password hasheado argon2id,
   `mustChangePasswordAt = now`. (La migración añade la columna —
   ver Frente 1.)
5. Manda email al OWNER vía `getEmailSender().send(...)` con la
   plantilla definida abajo.
6. Devuelve `{ tenant, ownerEmail, tempPassword }` — el frontend
   lo muestra UNA vez en pantalla por si el email se pierde.
7. Audit log `create_tenant` (ver shape abajo).

Validaciones: email unique global en User, nombre tenant unique.

**Helper `validateSpanishTaxId(taxId): { valid, type }`**

Vive en `packages/util-validation/src/spanish-tax-id.ts` (nuevo
workspace si no existe ya algo equivalente). Implementa los tres
formatos con checksum real, no sólo regex:

- **NIF persona física**: 8 dígitos + letra. La letra es
  `"TRWAGMYFPDXBNJZSQVHLCKE"[dni % 23]`.
- **NIE**: empieza por X/Y/Z (que se mapean a 0/1/2) + 7 dígitos +
  letra (misma tabla que NIF, sobre el número resultante).
- **CIF**: letra inicial de A/B/C/D/E/F/G/H/J/N/P/Q/R/S/U/V/W +
  7 dígitos + dígito o letra de control. El control se calcula
  sumando alternativamente pares (suma directa) e impares
  (multiplica por 2 y suma dígitos), módulo 10, complemento a 10.
  Para letras inicial J/A/B/E/H el control es dígito; para
  K/P/Q/S es letra; para el resto puede ser cualquiera de los
  dos formatos.

Devuelve `{ valid: true, type: "NIF" | "CIF" | "NIE" }` o
`{ valid: false, type: null }`. Tests con casos reales conocidos +
casos inválidos.

**Helper `generateTemporaryPassword()`**

`packages/util-validation/src/temporary-password.ts`. 16 chars
generados con `crypto.randomBytes`. Charset sin caracteres
ambiguos:

```
abcdefghjkmnpqrstuvwxyz   (sin l/i/o)
ABCDEFGHJKLMNPQRSTUVWXYZ  (sin I/O)
23456789                  (sin 0/1)
#$%*+=?@                  (sin caracteres problemáticos en
                           shells/copy-paste como /, \, ", ', `)
```

Total alfabeto = 64 caracteres (≈ 96 bits de entropía en 16 chars).
Test que verifica que el output no contiene ninguno de los
ambiguos `0OoIl1\"\`'/\\ `.

**Email al OWNER — plantilla canónica**

Subject:
```
Bienvenido a Mipiacetpv · Tu cuenta está lista
```

Body (text + HTML equivalente):
```
Hola {ownerName},

Te damos la bienvenida a Mipiacetpv. Tu cuenta de propietario ya
está lista.

Datos de acceso:
  · URL: {PUBLIC_ADMIN_URL}/login
  · Email: {ownerEmail}
  · Contraseña temporal: {tempPassword}

Por seguridad te pediremos cambiarla en el primer inicio de
sesión.

Para empezar a operar, conecta tu cuenta de Holded en
"Mi cuenta" tras el primer login. El catálogo se sincroniza
automáticamente en 2-5 minutos.

Si necesitas ayuda, responde a este email.

— El equipo de Mipiacetpv
```

Remitente: variable de entorno `SUPER_ADMIN_FROM_EMAIL` con
default `noreply@mipiacetpv.tech`. Reply-to: variable
`SUPER_ADMIN_REPLY_TO_EMAIL` con default `soporte@mipiacetpv.tech`.

**Editar tenant** — `PATCH /super-admin/tenants/:id`

Body parcial:
```json
{
  "name": "Librería Thalia SL (renombrada)",
  "fiscalProfile": { "legalName": "...", "nif": "...", "address": "..." },
  "plan": "paid"
}
```

Validaciones equivalentes a `POST` (NIF, name unique). Si
`fiscalProfile.nif` cambia, validar el nuevo con
`validateSpanishTaxId`. Audit log `update_tenant` con diff
(`{ changes: { field: { before, after } } }`).

**Bloquear / desbloquear tenant** —
`PATCH /super-admin/tenants/:id/status` con `{ blockedAt: Date | null, reason?: string }`.

Cuando se bloquea (`blockedAt != null`), persiste `blocked_at` +
`blocked_reason` en `tenants`. El middleware base
`requireTenantNotBlocked` (definido en Frente 2) rechaza con
**423 Locked** TODAS las requests per-tenant (admin + tpv), no
sólo `requireOwnerOrManager`. Cubre casos "cliente dejó de
pagar", "fraude detectado", "soporte solicitó pausa".

Desbloqueo: PATCH con `blockedAt: null` y `reason: "..."`. El
`blocked_reason` previo se preserva en el audit log
`unblock_tenant` para histórico.

Audit log obligatorio con razón.

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
`{ sub: ownerUserId, role: "OWNER", tid: tenantId, purpose: "impersonation", readOnly: true, tv, exp: now + 30min }`.
**Sin refresh token** — al caducar hay que reabrir.

Aceptación en middlewares per-tenant + comportamiento read-only:
ver Frente 2 "Aceptación de JWT impersonation por middlewares
per-tenant".

Audit log obligatorio con `{ expiresAt, ipAddress, userAgent }` —
ver shape completo en sub-sección "metadata del audit" abajo.

**Cómo abrir impersonación desde la UI super-admin (Frente 4):**

1. Super-admin pulsa botón "Impersonar (sólo lectura)" en
   `/superadmin/tenants/:id`.
2. La UI hace `POST /super-admin/tenants/:id/impersonate`,
   recibe el JWT efímero.
3. Abre `${PUBLIC_ADMIN_URL}/?impersonationToken=<jwt>` en
   **pestaña nueva** (`window.open` con `noopener`).
4. La nueva pestaña, al detectar `?impersonationToken=` en la URL,
   guarda el token en **sessionStorage** (key
   `admin_access_token` — la misma que usa el flujo normal pero
   en sessionStorage, no localStorage; NO contamina la sesión del
   super-admin en el resto de pestañas) y limpia el query param.
5. El AdminShell al cargar, si detecta que el token tiene
   `purpose: "impersonation"` y `readOnly: true`, monta un banner
   rojo persistente arriba con:
   - Texto: "Impersonando a [tenant.name] · sólo lectura · caduca
     en NN min" (countdown).
   - Botón "Salir de impersonación" que limpia sessionStorage y
     cierra la pestaña (`window.close()`).
6. La pestaña impersonation es independiente: no puede acceder al
   localStorage del super-admin (sessionStorage es por pestaña).
   La sesión real del super-admin en otras pestañas sigue intacta.

**Contrato del `SuperAdminAudit.metadata` por acción**

Cada acción super-admin escribe una fila de audit con un shape
estricto. Todos los shapes incluyen `ipAddress: string | null` y
`userAgent: string | null` (extraídos de la request del super-admin).

| `action` | `metadata` (además de IP/UA) |
|---|---|
| `create_tenant` | `{ tenantName, ownerEmail, plan, fiscalNif }` |
| `update_tenant` | `{ changes: Record<string, { before: unknown, after: unknown }> }` |
| `block_tenant` | `{ reason: string, blockedAt: ISO8601 }` |
| `unblock_tenant` | `{ previousReason: string \| null }` |
| `force_logout` | `{ usersAffected: number }` |
| `resync` | `{ syncJobId: string }` |
| `impersonate` | `{ expiresAt: ISO8601, asUserId: uuid }` |

El backend valida estos shapes con `zod` antes de persistir.
Si la metadata no encaja, el audit se rechaza (preferimos perder
una operación con metadata defectuosa que persistir basura).

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

- **NO** tocar el flujo per-tenant (OWNER/MANAGER/CASHIER) existente
  más allá de los puntos explícitos en Frente 2 (aceptación de JWT
  impersonation + `must-change-password` + `requireTenantNotBlocked`
  base).
- **NO** incluir billing/Stripe ni subscriptions automáticas. El
  plan se guarda como string libre (`"pilot" | "free" | "paid"`)
  por ahora; lo gestionamos manualmente.
- **NO** incluir self-service signup público. Eso es post-v1.
- **NO** romper sesiones existentes de OWNER/MANAGER al desplegar.
  Las migraciones deben ser idempotentes — las columnas nuevas
  nacen con NULL y todo el flujo existente sigue igual hasta que
  un super-admin haga algo que las cambie.
- **NO** incluir UI para invitar/crear nuevos super-admins. El
  alta de super-admins adicionales se hace exclusivamente vía CLI
  seed (Frente 5). Decisión defensiva: que la creación de cuentas
  con privilegios totales requiera acceso al servidor.
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
- **DELETE tenant.** Block (`PATCH .../status` con `blockedAt: now`)
  es la operación correcta — preserva auditoría, histórico fiscal,
  registros en Holded, y permite reactivación. La eliminación
  física no entra y probablemente nunca lo haga (legalmente
  conviene retención mínima de varios años de registros fiscales).
- UI para invitar otros super-admins (sólo CLI seed, ver
  Restricciones).
- Multi-region / multi-AZ.
- Backup automatizado (eso lo gestionamos a nivel infra, no app).
- OAuth con Holded (B1 actual usa API key manual, lo refinaremos
  post-piloto).
- Métricas avanzadas tipo MRR, churn (post-v1).

Cuando B-SuperAdmin cierre, despliegue a Hostinger + alta de
Thalia en cuanto la cuenta Holded esté conectada.
