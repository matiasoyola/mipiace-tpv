# B-Multi-Vertical · Sub-bloques SB1+SB2 (master) y SB3+SB4+SB5

Estado: SB1+SB2 desplegado en producción 2026-05-19 (commit `7474438`).
SB3+SB4+SB5 en branch `b-multi-vertical-v2` pendiente de revisión por
Matías.

Cubre el primer paso del soporte multi-vertical real: el TPV ahora
sabe que un tenant es HOSPITALITY / RETAIL / SERVICES y se comporta
distinto en consecuencia, el super-admin puede saltar entre tenants y
puede invitar a más super-admins.

Fuera de este bloque (explícito):
- **SB6 / B-Categorias**: requiere spike contra el endpoint Holded
  `/products/categories` que Matías acordó hacer en sesión presencial.
- **Roles diferenciados FULL vs SUPPORT**: todos los super-admins son
  iguales hoy.
- **Cmd+K palette completo estilo Linear**: el selector global tiene
  búsqueda de texto + atajos pero no es un palette de acciones.
- **Email automático al cambiar businessType de un tenant**.
- **Badge "Viendo como super-admin · Salir"** (Frente 3 SB5 opcional)
  → diferido a B-Impersonation-Badge si Matías lo pide.
- **Enforcement del cambio-password-inicial** del super-admin invitado.
  El campo `mustChangePassword=true` queda persistido; mientras tanto
  el invitado usa `/super-admin/auth/change-password`.

## SB1+SB2 (ya en master, recap)

- Rename "tenant" → "Cuenta" en toda la UI del super-admin (código
  sigue usando `Tenant` como término técnico interno).
- `Tenant.businessType: BusinessType` con valores `HOSPITALITY |
  RETAIL | SERVICES` (default RETAIL).
- CreateTenantPage tiene 3 chips visuales para elegir vertical en el
  alta; TenantDetailPage tiene editor inline.
- Migración `b13_business_type` aplicada en producción; Librería
  Thalia marcada como `RETAIL`.

## SB3 · TPV condicional según businessType

### Backend
- `GET /tpv/catalog/products` añade `businessType` en la response.
  Sólo en la primera página (cursor vacío) — el TPV lo cachea al
  primer pull. Si el tenant cambia de vertical desde super-admin,
  basta con que el cajero refresque para que la cache se actualice.

### TPV
- `lib/catalog.ts`: `getCachedBusinessType()` / `setCachedBusinessType()`
  + tipo `BusinessType`. `refreshCatalog()` persiste el valor que el
  backend devuelve.
- `pages/SalePage.tsx`: mapa `PLACEHOLDER_ICON_BY_TYPE` → Coffee
  (HOSPITALITY), Package (RETAIL), Briefcase (SERVICES). Fallback
  Package si la sesión aún no tiene el valor cacheado.
- `App.tsx` (TpvHome): si `businessType !== "HOSPITALITY"` no
  consultamos `/tpv/tables` ni renderizamos TableMapScreen — vamos
  directos a SalePage en venta libre. Tenants `HOSPITALITY` mantienen
  el flujo existente (mapa de mesas si la tienda tiene mesas).

### Tests
- `tpv-catalog-business-type.test.ts`: 5 tests (HOSPITALITY, RETAIL,
  SERVICES, omisión en páginas con cursor, 401 sin auth).

## SB5 · Selector global de cuentas

- `superadmin/CuentaSelector.tsx`: dropdown global en la cabecera del
  super-admin. Trigger muestra:
  - "mipiace · super-admin" cuando estás en rutas no-tenant.
  - Nombre del tenant + chip `businessType` cuando estás en
    `/superadmin/tenants/:id`.
- Buscador con filtrado por nombre y email del owner (case-insensitive).
- Lista de tenants cacheada 60 s en localStorage
  (`super_admin_cuenta_selector_cache`); refresca al abrir si caducó.
- `lastSelectedTenantId` persiste el último seleccionado para que
  futuras aperturas lo pre-resalten visualmente — no redirige
  automáticamente.
- Atajos de teclado:
  - `/` enfoca el input (no se activa con foco en otro input).
  - `↑↓` navega entre items, `Enter` abre el resaltado.
  - `Esc` cierra el dropdown.
- Item "→ Volver a super-admin" arriba para volver a la lista.
- Integrado en `SuperAdminShell.tsx` como nueva barra sticky por
  encima del header con el title de cada página.

## SB4 · Multi super-admin CRUD

### Migración
`b14_super_admin_name`:
- `super_admin_users.name VARCHAR(100)` (backfill: `split_part(email,
  '@', 1)`).
- `super_admin_users.deleted_at TIMESTAMPTZ` (soft-delete).
- `super_admin_users.must_change_password BOOLEAN DEFAULT false`.

### Backend
- `GET    /super-admin/admins`         · lista activos (`deletedAt IS NULL`).
- `POST   /super-admin/admins`         · invita uno nuevo. Body
  `{ email, name }`. Genera temp password (16 chars, charset sin
  caracteres ambiguos), hashea, audit `create_super_admin`, encola
  email de bienvenida. Si SMTP falla → log warn + response 201 igual
  con `tempPassword` (el admin actual la entrega manualmente). 409
  `SUPER_ADMIN_EMAIL_TAKEN` si el email ya está activo.
- `DELETE /super-admin/admins/:id`     · soft-delete + bump
  `tokenVersion` (invalida refresh tokens vivos). 400
  `CANNOT_DELETE_SELF`, 404 si no existe o ya borrado. Audit
  `delete_super_admin`.
- `requireSuperAdmin` y `/super-admin/auth/login` rechazan rows con
  `deletedAt != null` (defensa por si se restaura un row).
- Nuevos schemas zod en `audit.ts`: `create_super_admin`,
  `delete_super_admin` con metadata
  `{ targetEmail, targetName?, targetSuperAdminId, ipAddress, userAgent }`.

### Frontend
- `superadmin/AdminsListPage.tsx` en `/superadmin/admins`:
  - Tabla con Nombre · Email · 2FA · Último login · Creado · Acciones.
  - Botón "Crear super-admin" abre modal email+nombre.
  - Tras POST, modal con la temp password + botón "Copiar al
    portapapeles". Disclaimer "es de un solo uso · cámbiala en el
    primer login".
  - Botón Eliminar oculto en la fila del propio admin
    (`me.id === row.id`). Confirm modal antes de eliminar.
- Sidebar: nuevo item "Super-admins" entre "Auditoría" y "Mi cuenta".
- `types.ts`: `SuperAdminItem`, `SuperAdminsListResponse`,
  `CreateSuperAdminResponse`.

### Tests
- `super-admin-admins.test.ts`: 11 tests.
  - GET: lista sólo activos, 401 sin auth.
  - POST: happy path + audit + email + tempPassword 16 chars,
    normalización email lower-case, 409 duplicado, 201 con SMTP
    caído.
  - DELETE: soft-delete OK + bump `tokenVersion` + audit, 400
    `CANNOT_DELETE_SELF`, 404 inexistente, 404 ya borrado, 401 sin
    auth.

## Estado de la branch

`b-multi-vertical-v2`:

```
762c9ce  B-Multi-Vertical SB3 · TPV condicional por businessType
27f2a85  B-Multi-Vertical SB5 · selector global cuentas
c5ff887  B-Multi-Vertical SB4 · multi super-admin CRUD
```

Typecheck `tsc --noEmit -p .` limpio en `apps/api`, `apps/admin`,
`apps/tpv-web`. Tests pasan en `apps/api` salvo el ya-roto
`image-cache-worker.test.ts > producto sin imageUrl → no-image rápido`
(pre-existente, no tocado por este bloque).

## Restricciones honradas

- No se ha roto SB1+SB2 desplegado (commit `7474438`).
- No se ha tocado el modo prueba ni el cajero técnico.
- TPV de Thalia (`RETAIL`) muestra Package y NO renderiza
  TableMapScreen tras este bloque.
- Tenants `HOSPITALITY` mantienen el flujo de mapa de mesas.
- Multi super-admin: imposible auto-eliminarse (400 en el endpoint +
  botón oculto en la UI).
- Email de invitación: caída SMTP no bloquea el POST — la temp
  password va en la response y en el log del ConsoleEmailSender.

## Próximo paso

Sólo queda **B-Categorias** del lote "todo lo propuesto" para llegar
al MVP multi-vertical. Requiere spike contra `/products/categories`
de Holded (incógnitas: scope, formatos, errores) que Matías acordó
hacer en sesión presencial.
