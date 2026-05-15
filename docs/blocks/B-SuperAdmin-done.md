# B-SuperAdmin · resumen del entregable

Estado: cerrado pendiente de revisión por Matías.

Mini-bloque acotado. Foco único: dar a Matías una consola super-admin
operativa para dar de alta los 5 pilotos sin tocar SQL ni SSH. Cubre
crear/editar tenant, ver métricas, bloquear, force-logout, resync
manual e impersonate read-only — todo con auditoría inmutable.

Fuera de B-SuperAdmin (explícito):
- Billing / Stripe / subscriptions automáticas (plan se gestiona a mano).
- Self-service signup público.
- UI para invitar otros super-admins (sólo CLI seed, decisión defensiva).
- DELETE tenant (bloquear preserva auditoría e histórico fiscal).
- Métricas avanzadas (MRR, churn).
- OAuth con Holded (queda con API key manual).
- Multi-region / backups automatizados.

## Estructura del repo tras B-SuperAdmin

```
.
├─ apps/api/src/
│  ├─ auth/
│  │  ├─ middleware.ts                       # ~ acepta JWT impersonation (read-only) en requireOwner/OrManager/OrCashier
│  │  ├─ must-change-password.ts             # + JWT temporal must-change-password (purpose distinto)
│  │  └─ routes.ts                           # ~ /auth/login devuelve mustChangePassword + endpoint /auth/change-password-initial
│  ├─ env.ts                                 # ~ SUPER_ADMIN_JWT_SECRET / TTLs / SUPER_ADMIN_FROM_EMAIL / REPLY_TO_EMAIL
│  ├─ scripts/create-super-admin.ts          # + CLI interactivo idempotente (argon2id)
│  ├─ server.ts                              # ~ registra block guard + rutas super-admin antes que el resto
│  └─ superadmin/
│     ├─ audit.ts                            # + writeAudit con shapes zod por acción + extractRequestSignals
│     ├─ auth.ts                             # + login / login-2fa / refresh / logout / TOTP / change-password
│     ├─ middleware.ts                       # + requireSuperAdmin (valida purpose=super-admin + tv match)
│     ├─ rate-limit.ts                       # + key login super-admin (email+IP)
│     ├─ routes.ts                           # + agregador + re-export del guard
│     ├─ tenant-block-guard.ts               # + preHandler global · 423 Locked cuando blockedAt != null
│     ├─ tenants.ts                          # + listado/detalle/crear/editar/status/force-logout/resync/impersonate/audit-log
│     ├─ tokens.ts                           # + sign/verify access·refresh·pending-2fa·impersonation
│     └─ welcome-email.ts                    # + plantilla email bienvenida (text + HTML)
├─ apps/admin/src/
│  ├─ AdminShell.tsx                         # ~ monta ImpersonationBanner cuando hay token activo
│  ├─ App.tsx                                # ~ /change-password-initial, /superadmin/* + ImpersonationBootstrap
│  ├─ api.ts                                 # ~ readImpersonationToken/State, evita refresh con JWT impersonation
│  ├─ components/
│  │  ├─ ImpersonationBanner.tsx             # + banner rojo persistente con countdown + botón "Salir"
│  │  └─ ImpersonationBootstrap.tsx          # + captura ?impersonationToken= y lo guarda en sessionStorage
│  └─ superadmin/
│     ├─ api.ts                              # + cliente HTTP con localStorage key propia (super_admin_*)
│     ├─ AuditLogPage.tsx                    # + listado de audits con filtro por acción
│     ├─ CreateTenantPage.tsx                # + form + pantalla post-creación con tempPassword (copy-to-clipboard)
│     ├─ SuperAdminGate.tsx                  # + redirect a /superadmin/login si no hay sesión
│     ├─ SuperAdminLoginPage.tsx             # + login con 2FA (mismo patrón que B3)
│     ├─ SuperAdminMePage.tsx                # + perfil + activar 2FA + cambiar password
│     ├─ SuperAdminShell.tsx                 # + shell propio (nada del nav per-tenant)
│     ├─ TenantDetailPage.tsx                # + detalle + acciones (block/force-logout/resync/impersonate)
│     ├─ TenantsListPage.tsx                 # + listado con métricas + filtros + badges de estado
│     └─ types.ts                            # + tipos compartidos super-admin
├─ packages/
│  ├─ db/prisma/
│  │  ├─ schema.prisma                       # ~ Tenant.blockedAt/Reason/plan · User.mustChangePasswordAt · models SuperAdminUser/Audit
│  │  └─ migrations/
│  │     └─ 20260515000000_b9_super_admin_users/  # + tabla super_admin_users + audits + columnas per-tenant
│  └─ util-validation/                       # + workspace nuevo
│     ├─ src/{spanish-tax-id,temporary-password,index}.ts
│     ├─ test/{spanish-tax-id,temporary-password}.test.ts
│     ├─ package.json · tsconfig.json
├─ apps/api/test/
│  └─ super-admin.test.ts                    # + 14 tests integradores (auth/iso/create/block/force-logout/imp/audit/must-change)
└─ docs/blocks/B-SuperAdmin-done.md          # este archivo
```

## Lo que dejé hecho

### Frente 1 · Migración `b9_super_admin_users` + modelos Prisma

Tablas nuevas (`super_admin_users`, `super_admin_audits`) y columnas
aditivas en modelos existentes:

- `users.must_change_password_at` (TIMESTAMPTZ NULL). NULL = sin
  obligación. Set por el super-admin al crear OWNER con password
  temporal.
- `tenants.blocked_at` + `tenants.blocked_reason` (NULL = activo).
- `tenants.plan` (string libre — `pilot | free | paid`).

Sin backfill — todas las columnas nuevas nacen NULL y el flujo per-tenant
existente se mantiene exactamente igual hasta que un super-admin actúe.

`SuperAdminAudit.metadata` lleva un JSON con shape estricto por
acción (validado con zod antes de persistir). Incluye SIEMPRE
`ipAddress` y `userAgent`. Indexado por `(super_admin_id, created_at)`,
`(tenant_id, created_at)` y `(action, created_at)`.

### Frente 2 · Auth super-admin + middlewares base

**JWT separado**: `SUPER_ADMIN_JWT_SECRET` ortogonal a los dos secrets
per-tenant. Un compromiso de uno NO permite el otro. Producción rechaza
arrancar si el secret mantiene el placeholder por defecto.

**Rutas** (todas bajo `/super-admin/auth/`):

- `POST /login` → access+refresh con `{ sub, purpose: "super-admin", tv, type }`.
  2FA: si `totpEnabledAt != null`, devuelve `{ requires2fa, pendingToken }`.
- `POST /login-2fa` → segundo paso TOTP o recovery code.
- `POST /refresh` → rota access+refresh.
- `POST /logout` → bumpea tokenVersion (sin tabla blacklist).
- `GET /me` → email, 2FA, último login, códigos restantes.
- `POST /totp/enable` + `/totp/confirm` + `/totp/disable` → patrón
  idéntico a B3 para users normales.
- `POST /change-password` → requiere actual + nueva (≥12 chars),
  incrementa tokenVersion al éxito.

**Rate limit** login 5/15 min por email+IP.

**Middleware `requireSuperAdmin`** rechaza con 401 cualquier JWT que no
sea `purpose=super-admin` `type=access` con `tv` matching BD.

**Middleware base `requireTenantNotBlocked`** registrado como `addHook`
preHandler global. Decodifica el Bearer (access token per-tenant o JWT
impersonation), consulta `blockedAt`, devuelve 423 si bloqueado.
**Cubre TODOS los roles per-tenant** (OWNER, MANAGER, CASHIER) — no
sólo `requireOwnerOrManager`. Rutas exentas: `/super-admin/*`,
`/auth/login`, `/auth/refresh`, `/auth/password-reset/*`, `/auth/signup`,
`/health`.

**Flujo `mustChangePasswordAt`**: si `/auth/login` valida password y
`user.mustChangePasswordAt != null`, devuelve `{ mustChangePassword: true,
pendingPasswordChangeToken }` en lugar de access+refresh. El JWT
temporal lleva `purpose=must-change-password` y TTL 15 min — el
middleware `verifyAccessToken` lo rechaza por el campo `type`. El
endpoint `POST /auth/change-password-initial` valida la nueva password
(≥12 chars, distinta a temporal), actualiza hash, pone
`mustChangePasswordAt=null`, incrementa `tokenVersion` y emite la
sesión normal.

**Aceptación de JWT impersonation** en `requireOwner`,
`requireOwnerOrManager`, `requireOwnerOrCashier`: cuando el Bearer
verifica con `SUPER_ADMIN_JWT_SECRET` como `purpose=impersonation`,
`readOnly=true`, `role=OWNER`:
- GET/HEAD/OPTIONS → pasa con `request.auth.isImpersonation=true` y
  `impersonatedBy=<superAdminId>`.
- POST/PATCH/PUT/DELETE → 403 `IMPERSONATION_READONLY`.

TTL del JWT impersonation 30 min, **sin refresh** — al caducar el
super-admin reabre desde la consola.

### Frente 3 · Endpoints super-admin

Todos bajo `/super-admin/` y protegidos por `requireSuperAdmin`.

- `GET /super-admin/tenants?q&status&sort&order&page&pageSize` —
  listado con métricas computadas por tenant: ticketsLast7d,
  ticketsSyncFailed, ticketsEmailFailed, `degraded.state`
  (ok/warning/blocked), storesCount, activeShifts, holdedConnected.
  Search por nombre + email del OWNER. Filtro `status=blocked|ok|warning`.
- `GET /super-admin/tenants/:id` — detalle + usuarios (con flag
  `mustChangePassword` y `twoFactorEnabled`) + stores resumidos +
  fiscalProfile completo.
- `POST /super-admin/tenants` — crea tenant + OWNER en transacción
  atómica. Valida NIF/CIF/NIE con `validateSpanishTaxId` (checksum
  real, no regex). Genera password temporal 16 chars con charset sin
  ambiguos. Crea OWNER con `mustChangePasswordAt = now()`. Envía email
  vía `getEmailSender()`. Devuelve `{ tenant, ownerEmail, tempPassword }`
  una sola vez. Audit `create_tenant`.
- `PATCH /super-admin/tenants/:id` — edita name/plan/fiscalProfile.
  Valida unicidad name + NIF si cambia. Audit `update_tenant` con
  diff `{ field: { before, after } }`.
- `PATCH /super-admin/tenants/:id/status` `{ blocked, reason? }` —
  bloquea (reason obligatoria) o desbloquea. El guard base hace el
  resto. Audit `block_tenant` / `unblock_tenant` (con `previousReason`).
- `POST /super-admin/tenants/:id/force-logout` — incrementa
  `tokenVersion` de TODOS los users del tenant en una sola query.
  Audit `force_logout` con `usersAffected`.
- `POST /super-admin/tenants/:id/resync` — encola un `enqueueManualSync`
  (mismo flujo que el CLI `resync` de B7.5). 409 si el tenant no
  tiene Holded conectado. Audit `resync` con `syncJobId`.
- `POST /super-admin/tenants/:id/impersonate` — emite JWT efímero
  apuntando al primer OWNER del tenant. Audit `impersonate` con
  `expiresAt` y `asUserId`.
- `GET /super-admin/audit?action&superAdminId&tenantId&from&to&page&pageSize`
  — listado del audit log con filtros.

### Frente 4 · Helpers `packages/util-validation/`

Workspace nuevo.

- `validateSpanishTaxId(raw): { valid, type? }` — implementa NIF
  (8 dígitos + letra `TRWAGMYFPDXBNJZSQVHLCKE[n%23]`), NIE (X/Y/Z
  mapeado a 0/1/2 + algoritmo NIF), CIF (suma de pares directos +
  impares doblados con suma de dígitos, complemento a 10, control
  forzado a dígito para iniciales `ABEH`, forzado a letra para `KPQS`,
  flexible para el resto). Tests con casos válidos e inválidos para los
  tres formatos.
- `generateTemporaryPassword()` — 16 chars random (`crypto.randomBytes`)
  sobre alfabeto 64 caracteres sin ambiguos (`0/O/o`, `1/l/I`, `\`, `"`,
  `'`, ``` ` ```, espacio). ~96 bits de entropía. Test que verifica
  que ningún output contiene ambiguos en 200 iteraciones.

### Frente 5 · UI super-admin

Ruta `/superadmin/*` con shell propio (oscuro, sin nav per-tenant
para evitar confusión). Sesión separada en `localStorage` con keys
`super_admin_access_token` / `super_admin_refresh_token` — coexiste
con la sesión per-tenant en el mismo navegador sin pisarse.

Páginas:
- `SuperAdminLoginPage` — login con flujo 2FA (idéntico patrón a B3).
- `TenantsListPage` — tabla con search, filtro de estado, badges de
  color verde/ámbar/rojo según degraded state, link a detalle, botón
  "Crear tenant".
- `CreateTenantPage` — formulario + pantalla post-creación con la
  `tempPassword` en `<code>` grande + botón copy-to-clipboard.
  Advertencia clara: "Esta es la única vez que se muestra".
- `TenantDetailPage` — métricas en cards, datos fiscales, lista de
  usuarios, banner rojo si bloqueado, botones de acción (Bloquear /
  Desbloquear con modal de razón / Force logout con confirm /
  Resync / Impersonar).
- `AuditLogPage` — listado con filtro por acción + metadata JSON.
- `SuperAdminMePage` — perfil + activar 2FA (QR + recovery codes) +
  cambiar password.

**Handshake de impersonación**:
1. Super-admin pulsa "Impersonar" → `POST .../impersonate` devuelve JWT.
2. UI abre `${ORIGIN}/?impersonationToken=<jwt>` en pestaña nueva.
3. `<ImpersonationBootstrap />` (mount-once en App.tsx) detecta el query
   param, guarda en `sessionStorage.mipiacetpv-admin-impersonation-access`
   y limpia la URL.
4. `readTokens()` prioriza ese key sobre las sesiones normales —
   `sessionStorage` no se comparte entre pestañas, así que la sesión
   real del super-admin u OWNER en otras pestañas queda intacta.
5. `AdminShell` detecta `readImpersonationState()` y monta
   `<ImpersonationBanner />`: banner rojo persistente con countdown
   en `mm:ss` y botón "Salir" que limpia sessionStorage + cierra la
   pestaña.
6. Si la API devuelve 401 (TTL del JWT impersonation expirado), el
   cliente borra el token automáticamente; el banner pasa al estado
   "expirada" y la próxima request limpia el sessionStorage.

### Frente 6 · CLI seed del primer super-admin

`apps/api/src/scripts/create-super-admin.ts`. Script interactivo
(`pnpm --filter @mipiacetpv/api super-admin:create`):

- Pide email + password (con confirmación, oculta el input con `*` via
  raw mode).
- Valida formato email + longitud ≥12.
- Idempotente: si el email ya existe, error con mensaje claro.
- Hashea con argon2id (mismas opciones que el resto del repo).
- Imprime al final el id + email + createdAt + recordatorio de activar
  2FA inmediatamente.

Documentado en `apps/api/README.md` sección "Post-deploy setup".

### Frente 7 · Tests

`apps/api/test/super-admin.test.ts` — 14 tests integradores con
fakePrisma + fakeRedis + mock del email sender:

- Auth: login OK / password mala (401 genérico) / logout invalida
  refresh.
- Aislamiento: OWNER no puede llamar `/super-admin/*` (401);
  super-admin sin Bearer recibe 401.
- Crear tenant: NIF inválido 400, atomicidad tenant+OWNER, email
  enviado con tempPassword, email duplicado 409.
- Block/unblock: razón requerida 400, bloqueo → 423 en `/auth/me`,
  desbloqueo → vuelve a 200, audit log block/unblock grabado.
- Force-logout: bumpea tokenVersion + audit.
- Impersonation: GET pasa, POST devuelve 403 `IMPERSONATION_READONLY`,
  audit grabado.
- Auditoría: listado + filtro por acción.
- must-change-password: tras crear tenant, login con temp devuelve
  pendingPasswordChangeToken, `/auth/change-password-initial` emite la
  sesión, login posterior con la nueva password es normal.

Más los tests del helper en `packages/util-validation/`: 14 casos para
`validateSpanishTaxId` (válidos + inválidos para los tres formatos +
formatos basura) y 5 casos para `generateTemporaryPassword`
(longitud, sin ambiguos en 200 iteraciones, alfabeto único, no
colisión, etc.).

**Total: 270 tests pasando en el workspace completo** (29 archivos
de test API + util-validation + ticket-model + ticket-pdf + holded-client).

## Decisiones explícitas

1. **JWT secret separado** (`SUPER_ADMIN_JWT_SECRET`) — un compromiso
   de uno no permite el otro.
2. **No DELETE tenant** — block preserva auditoría e histórico fiscal.
3. **Sin UI para invitar super-admins** — sólo CLI seed con acceso al
   servidor (decisión defensiva).
4. **Sin refresh para JWT impersonation** — TTL 30 min y reabrir.
5. **`requireTenantNotBlocked` cubre TODOS los roles** del tenant
   (incluye CASHIER del TPV) — el bloqueo no deja huecos.
6. **Audit metadata con shape zod** — la operación falla antes que
   persistir audit basura. Cada acción tiene su contrato.
7. **`mustChangePasswordAt`** es un JWT distinto (`purpose` propio) —
   ningún otro endpoint lo acepta. Sólo `/auth/change-password-initial`.
8. **Charset de la temporal sin ambiguos** — OWNER teclea la password
   desde el email sin confundir `0/O` ni `1/l`.

## Cómo probarlo de cabo a rabo

1. `pnpm install` + `pnpm db:migrate` (aplica `b9_super_admin_users`).
2. Generar `SUPER_ADMIN_JWT_SECRET` con `openssl rand -base64 48` y
   añadirlo al `.env`.
3. `pnpm --filter @mipiacetpv/api super-admin:create` para crear el
   primer super-admin.
4. `pnpm dev:api` y `pnpm dev:admin`.
5. Abrir `http://localhost:5173/superadmin/login`, entrar con el
   super-admin, activar 2FA.
6. "Crear tenant" → introducir NIF válido, OWNER email, plan pilot →
   crear. Apuntar la `tempPassword` mostrada.
7. Abrir otra pestaña en `http://localhost:5173/login`, entrar con
   el OWNER → te redirige a `/change-password-initial`. Cambiar.
8. Conectar Holded → desde la consola super-admin, pulsar "Impersonar
   (sólo lectura)" → se abre pestaña nueva con banner rojo, navegar
   por `/admin/stores` (GET pasa), intentar cualquier mutación → 403.
9. Bloquear el tenant → el OWNER intenta cualquier request → 423.
10. Desbloquear → vuelve a 200.
