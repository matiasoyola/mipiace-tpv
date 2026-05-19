# Prompt para Claude Code — B-Multi-Vertical (SB3 + SB5 + SB4)

Continuación de B-Multi-Vertical SB1+SB2 (commit `7474438`, ya
desplegado en producción 2026-05-19). Añade los 3 sub-bloques que
quedaron pendientes del paquete "todo lo propuesto":

- **SB3** — Lógica TPV condicional según `businessType`
- **SB5** — Selector global de cuentas en cabecera super-admin
- **SB4** — Multi super-admin CRUD

Pega esto en una sesión de Claude Code. Trabaja en una sola branch
(`b-multi-vertical-v2`) con commits separados por sub-bloque para
poder revisar incrementalmente. Si encuentras un bug del bloque
previo (SB1/SB2 desplegado), arréglalo antes de seguir, en un
commit aparte etiquetado `fix · ...`.

NO incluye **SB6 (B-Categorias)** — bloque separado, requiere spike
contra el endpoint Holded `/products/categories` que se hará en
sesión presencial con Matías.

---

Hola Code. Acabamos de cerrar B-Multi-Vertical SB1+SB2 en master:

- Renombramos "tenant" → "Cuenta" en toda la UI del super-admin
  (código sigue usando `Tenant` como término técnico interno).
- Añadimos `Tenant.businessType: BusinessType` con valores
  `HOSPITALITY | RETAIL | SERVICES` (default RETAIL).
- CreateTenantPage tiene 3 chips visuales para elegir el vertical
  en el alta. TenantDetailPage tiene un editor inline para cambiar
  el vertical de cuentas existentes.
- Migración `b13_business_type` aplicada en producción.
- Librería Thalia ya está marcada como `business_type = RETAIL`.

El campo está en BD y se puede leer/editar desde el admin pero **el
TPV todavía no lo lee** — sigue pintando Package como placeholder
para todos y mostrando el TableMapScreen siempre. Eso es lo que
arregla SB3.

## Contexto · archivos a leer antes de tocar nada

- `packages/db/prisma/schema.prisma` — modelo Tenant con
  `businessType` y enum `BusinessType` (líneas 109–135 aprox).
- `apps/api/src/tpv-catalog/routes.ts` — endpoint que el TPV usa
  para descargar el catálogo. Aquí hay que añadir `businessType` al
  payload.
- `apps/tpv-web/src/pages/SalePage.tsx` — pantalla principal del
  TPV. Hoy tiene `Package` hard-coded como placeholder. Aquí va el
  switch por businessType.
- `apps/tpv-web/src/pages/TableMapScreen.tsx` — mapa de mesas.
  Hoy se renderiza siempre si el tenant tiene tienda con mesas. Con
  SB3 sólo se renderiza si `businessType === "HOSPITALITY"`.
- `apps/tpv-web/src/App.tsx` (o equivalente) — routing del TPV.
- `apps/admin/src/superadmin/SuperAdminShell.tsx` — shell del
  super-admin donde va el selector global (SB5).
- `apps/admin/src/superadmin/TenantsListPage.tsx` — listado de
  cuentas, ya existe (referencia para reusar lógica de fetch).
- `apps/admin/src/superadmin/SuperAdminMePage.tsx` — referencia
  para el estilo de pantalla "Mi cuenta" (similar a la nueva
  AdminsListPage de SB4).
- `apps/api/src/superadmin/auth.ts` o `apps/api/src/superadmin/me.ts`
  — endpoints actuales del super-admin (referencia para crear los
  nuevos endpoints de admins).
- `packages/db/prisma/schema.prisma` — modelo `SuperAdminUser`. Si
  ya tiene `name`, perfecto; si no, hay que añadirlo (migración
  pequeña).
- `apps/admin/src/superadmin/types.ts` — añadir tipos
  `SuperAdmin*` para SB4.
- `apps/admin/src/superadmin/api.ts` — helper `superApi` usado por
  todas las pantallas super-admin.
- Memoria `[[project_dominio_canonico]]`,
  `[[project_deploy_com_2026-05-18]]` — contexto del deploy real
  productivo.
- `docs/blocks/B-Multi-Vertical-SB1-SB2-done.md` si existe —
  cierre del bloque previo. Si no existe, créalo al cerrar este
  bloque cubriendo SB1..SB5 + SB4.

## SB3 · Lógica TPV condicional según businessType (~30 min)

Hoy el TPV trata a todos los tenants igual. Como ya tenemos
`businessType` en BD, queremos comportamientos diferentes según el
vertical.

### Frente 1 · Backend expone businessType al TPV

`apps/api/src/tpv-catalog/routes.ts`. El endpoint que sirve el
catálogo (`GET /tpv/catalog` o similar) ya devuelve `tenantId` en
la response. Añadir `businessType` del tenant:

```typescript
// Antes:
return {
  items,
  nextCursor,
  tenantId: cashier.tid,
};

// Después:
const tenant = await prisma.tenant.findUnique({
  where: { id: cashier.tid },
  select: { businessType: true },
});
return {
  items,
  nextCursor,
  tenantId: cashier.tid,
  businessType: tenant!.businessType,
};
```

Si existe un endpoint separado tipo `/tpv/session` que es más
"identitario" (sesión del cajero, info del tenant), mejor ponerlo
ahí — pero verifica primero que existe antes de inventarlo. Si
sólo está catalog, ahí va bien.

### Frente 2 · TPV lee businessType y aplica placeholder

`apps/tpv-web/src/pages/SalePage.tsx`:

- Extraer `businessType` de la response del catalog y cachearlo
  similar a como se cachea `tenantId` con `getCachedTenantId()`.
  Probablemente añadir `getCachedBusinessType()` /
  `setCachedBusinessType()` en `apps/tpv-web/src/lib/cart.ts` (o
  donde esté el cache de sesión).
- Mapear `businessType` → icono lucide:

```typescript
const PLACEHOLDER_BY_TYPE: Record<BusinessType, typeof Coffee> = {
  HOSPITALITY: Coffee,
  RETAIL: Package,
  SERVICES: Briefcase,
};
```

- Reemplazar el `<Package ... />` actual (línea ~841 del
  SalePage.tsx tras SB1+SB2) por
  `<PlaceholderIcon ... />` donde `PlaceholderIcon =
  PLACEHOLDER_BY_TYPE[cachedType] ?? Package`.
- Fallback Package si no hay tipo cacheado (defensivo para sesiones
  antiguas que aún no recargaron el catálogo).

### Frente 3 · Mapa de mesas oculto si no es HOSPITALITY

`apps/tpv-web/src/pages/TableMapScreen.tsx` y rutas:

- Si `businessType !== "HOSPITALITY"`, el TPV NO debe renderizar
  TableMapScreen ni el botón "Ir a mesas" / "Cambiar mesa" del
  SalePage.
- Tras login del cajero, ir directamente a SalePage en modo "venta
  libre sin mesa" (que ya existe, mira `SalePage` con `tableId =
  null`).
- Para tenants HOSPITALITY el comportamiento actual se mantiene
  (TableMapScreen como primera pantalla tras abrir turno).
- Punto de decisión: probablemente en `apps/tpv-web/src/App.tsx`
  o en `ShiftActiveScreen.tsx` donde se decide a qué pantalla ir
  tras abrir turno.

### Tests SB3

- `apps/api/test/tpv-catalog.business-type.test.ts`:
  GET /tpv/catalog devuelve `businessType` igual al del tenant.
- `apps/tpv-web/test/sale-page.placeholder.test.tsx` (si existe
  framework de test del TPV; si no, skip):
  Snapshot del tile con `businessType=RETAIL` vs `HOSPITALITY` vs
  `SERVICES` muestra el icono correcto.

---

## SB5 · Selector global de cuentas en cabecera (~45 min)

Hoy para saltar entre tenants hay que volver a `/superadmin/tenants`
(lista) y click. Para super-admins que gestionan varios pilotos a
la vez (futuro equipo Holded), queremos un dropdown siempre visible
con búsqueda.

### Frente 1 · Componente CuentaSelector

Crear `apps/admin/src/superadmin/CuentaSelector.tsx`:

- Botón en cabecera que muestra:
  - "mipiace · super-admin" cuando no hay cuenta seleccionada
    (rutas `/superadmin`, `/superadmin/tenants`, `/superadmin/me`)
  - Nombre del tenant + chip con `businessType` cuando estás en
    `/superadmin/tenants/:id`
  - Icono ChevronDown a la derecha
- Click abre dropdown con:
  - Input de búsqueda arriba (filtra por nombre del tenant,
    case-insensitive)
  - Lista scrollable de tenants (fetch a `GET /super-admin/tenants`,
    cachear la lista en localStorage por 60s para no recargar en
    cada apertura)
  - Cada item: nombre + chip `businessType` + `ownerEmail` pequeño
  - Item "→ Volver a super-admin" arriba que navega a
    `/superadmin/tenants` (la lista)
- Click en un item navega a `/superadmin/tenants/:id` y cierra el
  dropdown.
- Atajo de teclado `/` enfoca el input de búsqueda cuando el
  dropdown está abierto. `Esc` cierra. `↑↓` navega items, `Enter`
  selecciona.
- Persistencia: al seleccionar un tenant, guardar
  `lastSelectedTenantId` en localStorage para que cuando el
  super-admin abra el admin la próxima vez, el selector lo
  pre-seleccione visualmente (pero NO redirige automáticamente —
  solo lo muestra como sugerencia).

### Frente 2 · Integración en SuperAdminShell

`apps/admin/src/superadmin/SuperAdminShell.tsx`:

- Añadir un header bar arriba (entre la sidebar y el contenido)
  con:
  - Izquierda: `<CuentaSelector />`
  - Derecha: nada por ahora (espacio para notifs futuras)
- Detectar tenant actual con `useParams()` o `useLocation()` (mira
  si el path matchea `/superadmin/tenants/:id`).
- Pasar el tenant detail al selector como prop `current` (el
  selector ya lo tiene por la lista cacheada, no hace falta otra
  llamada).

### Frente 3 · Indicador "Viendo como super-admin" si impersona

Si el super-admin impersona un tenant (ya existe la acción en
TenantDetailPage), al abrir el admin per-tenant, el header del
admin debe mostrar un badge "Viendo como super-admin · Salir" que
permita volver a `/superadmin`. Esto es estrictamente opcional
para este bloque — si lleva más de 20 min implementarlo limpiamente,
posponer a un sub-bloque B-Impersonation-Badge propio.

### Tests SB5

- Snapshot del CuentaSelector cerrado / abierto / con búsqueda
  filtrada / con tenant pre-seleccionado.
- Smoke test de navegación: click en un item navega al detail.

---

## SB4 · Multi super-admin CRUD (~45 min)

Hoy sólo existe `m.oyola@mipiace.es`. Para que el equipo Holded
entre como segundos super-admins, necesitamos un panel donde el
super-admin actual pueda invitarlos.

### Frente 1 · Endpoints backend

Crear `apps/api/src/superadmin/admins.ts` con 3 endpoints:

#### `GET /super-admin/admins`

Lista todos los super-admins activos (donde `deletedAt IS NULL`).
Devuelve `id, email, name, twoFactorEnabled, lastLoginAt, createdAt`.

#### `POST /super-admin/admins`

Body schema:
```json
{ "email": "string@email", "name": "string min 1 max 100" }
```

- Validar email único entre super-admins activos. Si existe,
  devolver 409 `SUPER_ADMIN_EMAIL_TAKEN`.
- Generar password temporal aleatoria (16 chars, alphanumeric).
- Hashear con bcrypt (igual que el otro super-admin existente).
- Crear `SuperAdminUser` con `mustChangePassword=true`.
- Encolar email de bienvenida con link a `/superadmin/login` y
  password temporal (reusar `SuperAdminWelcomeEmail` si existe, si
  no, una variante simple).
- Audit log: action `create_super_admin`, metadata con
  `targetEmail`, `targetName`.
- Response 201 con `{ admin: { id, email, name, ... },
  tempPassword }` para que el admin actual la copie y la entregue
  manualmente si el email no llega.

#### `DELETE /super-admin/admins/:id`

- Si `id === ctx.superAdminId` (el propio super-admin haciendo la
  request), devolver 400 `CANNOT_DELETE_SELF`.
- Si `id` no existe, 404.
- Soft-delete: marcar `deletedAt=now`. Mantener el row para
  auditoría histórica.
- Audit log: action `delete_super_admin`.
- Response 200 vacío.

#### Modelo SuperAdminUser

Si la tabla no tiene `name`, añadir migración Prisma pequeña
`b14_super_admin_name`:

```prisma
model SuperAdminUser {
  // ... existente
  name String?  // nullable temporalmente para no romper rows existentes; backfill = email partes "@"[0]
}
```

Migración SQL:
```sql
ALTER TABLE "super_admin_users" ADD COLUMN "name" VARCHAR(100);
-- Backfill defensivo para super-admins existentes:
UPDATE "super_admin_users" SET "name" = split_part(email, '@', 1) WHERE name IS NULL;
```

Si la tabla ya tiene `name`, skip esta migración.

### Frente 2 · Pantalla /superadmin/admins

Crear `apps/admin/src/superadmin/AdminsListPage.tsx`:

- Tabla con columnas: `Nombre · Email · 2FA · Último login · Creado · Acciones`
- Botón arriba "Crear super-admin" abre modal con `email + name`.
- Tras submit POST:
  - Muestra password temporal en un panel con botón "Copiar al
    portapapeles" + nota "Entrégasela al usuario por canal seguro.
    Es de un solo uso — debe cambiarla en el primer login."
- Botón "Eliminar" en cada fila excepto la del super-admin actual
  (que reconoces por `me.id === row.id`, fetch a `GET /super-admin/me`
  que ya existe).
- Confirm modal antes de eliminar.

### Frente 3 · Sidebar + routing

`apps/admin/src/superadmin/SuperAdminShell.tsx`:

- Añadir nuevo `NAV_ITEM`:
```typescript
{ to: "/superadmin/admins", label: "Super-admins", icon: Users },
```
  entre "Auditoría" y "Mi cuenta".

`apps/admin/src/App.tsx`:

- Añadir `<Route path="/superadmin/admins" element={<SuperAdminGate><AdminsListPage /></SuperAdminGate>} />`

### Tests SB4

- `apps/api/test/super-admin-admins.test.ts`:
  - GET /super-admin/admins devuelve solo los activos.
  - POST crea + audit + email encolado.
  - POST con email duplicado → 409.
  - DELETE propio → 400.
  - DELETE de otro → 200 + soft-delete.

---

## Restricciones globales

- **NO romper SB1+SB2 desplegado** (commit `7474438`).
- **NO romper modo prueba** ni el cajero técnico. Los tests
  existentes del super-admin tienen que seguir pasando.
- TPV de Thalia (`RETAIL`) tras SB3 debe mostrar Package y NO
  mostrar TableMapScreen.
- TPV de un futuro tenant `HOSPITALITY` debe mostrar Coffee y
  TableMapScreen con normalidad.
- Multi super-admin: NO autoeliminarse (impedir suicidio
  accidental).
- Email del nuevo super-admin: si SMTP no está configurado, NO
  fallar el POST — caer al ConsoleEmailSender como hace
  `welcome-email.ts` existente. El admin puede entregar la
  password temporal manualmente.
- Typecheck `tsc --noEmit -p .` limpio en api, admin, tpv-web.

## Lo que NO entra (deferred a otras sesiones)

- B-Categorias (SB6): requiere spike Holded.
- Roles diferenciados FULL vs SUPPORT: todos los super-admins son
  iguales hoy.
- Cmd+K palette completo estilo Linear: solo dropdown con búsqueda
  texto.
- Email automático al cambiar businessType de un tenant: no es
  necesario.
- Migración del bundle TPV de sesiones activas: al re-login leerán
  el nuevo campo.

## Entregables

1. Branch `b-multi-vertical-v2` con 3 commits separados:
   - `B-Multi-Vertical SB3 · TPV condicional`
   - `B-Multi-Vertical SB5 · selector global cuentas`
   - `B-Multi-Vertical SB4 · multi super-admin CRUD`
2. (Opcional) Migración `b14_super_admin_name` si la tabla
   `SuperAdminUser` no tiene `name`.
3. `docs/blocks/B-Multi-Vertical-done.md` con resumen final que
   cubra SB1+SB2 (ya done) + SB3 + SB4 + SB5.
4. Tests verdes en api + admin + tpv-web.
5. PR (o merge directo a master si Matías así lo decide cuando
   vuelva) con el typecheck y los tests pasando en CI.

Cuando este bloque cierre:

- Thalia (RETAIL) verá el placeholder Package y entrará a SalePage
  directo, sin TableMapScreen.
- El super-admin actual tendrá selector global y podrá invitar a
  más super-admins.
- Solo queda **B-Categorias** del lote "todo lo propuesto", que
  Matías acordamos hacer en sesión presencial cuando él esté para
  decidir sobre el spike Holded.
