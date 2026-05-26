# Bloque v1.3-Operativa-Extra · 3 lotes

Estás trabajando en `mipiacetpv`, monorepo pnpm + Turbo. Ya estamos en master tras los hotfix1–6 de v1.3 (cuentas SERVICES activas, icono per-vertical, audit inputMode). Este bloque añade tres mejoras que el OWNER va a pedir en cuanto opere su tenant: editar tags sin tocar Holded, refrescar Holded sin pasar por super-admin y limpiar tags duplicados con tilde.

Crea una rama `v1-3-operativa-extra` desde `master`, un commit por lote, sin merge.

---

## Lote 1 · Alias de tags editable desde admin

**Motivo**: los clientes usan prefijo numérico para ordenar tags en Holded (`01cortesypeinados`, `02depilc`). El TPV ya limpia el prefijo (hotfix5) pero deja `Cortesypeinados`. Necesitamos que el OWNER pueda mapear `01cortesypeinados` → `Cortes y peinados` sin tocar Holded.

**Schema** · añadir modelo `TagAlias` en `packages/db/prisma/schema.prisma`:

```prisma
model TagAlias {
  id         String   @id @default(uuid()) @db.Uuid
  tenantId   String   @map("tenant_id") @db.Uuid
  slug       String   @db.VarChar(60)  // tag tal como llega de Holded (lowercase)
  label      String   @db.VarChar(80)  // texto a mostrar en el TPV
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz()
  updatedAt  DateTime @updatedAt @map("updated_at") @db.Timestamptz()

  tenant     Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  @@unique([tenantId, slug])
  @@map("tag_aliases")
}
```

Y en `Tenant`: `tagAliases TagAlias[]`. Migración `b24_tag_aliases`.

**API admin** (no super-admin, el OWNER y MANAGER pueden gestionar):

- `GET  /admin/tag-aliases` → lista de aliases del tenant.
- `POST /admin/tag-aliases` body `{ slug, label }` → upsert (idempotente sobre slug).
- `DELETE /admin/tag-aliases/:id` → quitar alias.

Preserver `requireOwnerOrManager`.

**TPV**: el endpoint `/tpv/catalog/products` ya devuelve `tpvIconPreset` en la primera página. Añade también `tagAliases: Array<{slug, label}>` en esa misma respuesta. En `apps/tpv-web/src/lib/catalog.ts` cachea el map en localStorage y exporta `getCachedTagAliases(): Record<string,string>`. En `SalePage.tsx`, reemplaza la llamada actual a `capitalizeTag(tag)` por una versión que primero mira el alias y, si no existe, cae a `capitalizeTag` (el comportamiento actual del hotfix5).

**Admin UI**: nueva página/sección en admin → un editor sencillo con tabla `(slug, label)` y botón añadir/eliminar. Usa los componentes ya existentes en `apps/admin/src/ui.tsx`. Test con vitest del endpoint POST.

**Why**: hoy `01cortesypeinados` se pinta como `Cortesypeinados` (lectura mejorable) y el cliente no tiene forma de renombrarlo sin entrar en Holded a editar todos los productos asociados. Con esto es 1 input en admin.

---

## Lote 2 · Re-sync de Holded para el OWNER

**Motivo**: cuando el cliente edita algo en Holded (precio, nuevo producto, modificador) el sync incremental tarda varios minutos. Hoy sólo el super-admin puede forzar un sync; el OWNER nos llama por Slack. Queremos que el OWNER pueda dispararlo él mismo.

**API**: `POST /catalog/sync-now` probablemente ya existe (`apps/api/src/catalog/routes.ts`). Si existe, sólo añadir rate-limit "máximo 1 sync por minuto por tenant" para que el OWNER no se vuelva loco pulsando. Si no existe, crearlo con el mismo `enqueueManualSync` que usa super-admin.

Devolver `{ syncJobId, queuedAt }` y exponer `GET /catalog/sync-status` (que ya existe) con la última run.

**Admin UI**: en `apps/admin/src/` añade una página `/admin/holded` (o sección en Ajustes) con:
- Estado del último sync (fecha + counts).
- Botón **"Forzar sync ahora"** que dispara `POST /catalog/sync-now`.
- Polling cada 5s a `/catalog/sync-status` durante 90s tras pulsar el botón para mostrar progreso.

**Why**: Thalía actualizó precios en Holded ayer y nos pidió por Slack que forzáramos sync. Quitamos esa fricción.

---

## Lote 3 · Limpieza de tags duplicados con/sin tilde

**Motivo**: cierra #60 del backlog. Thalía tiene en Holded chips duplicados tipo `papelería` / `papeleria`, `bolígrafos` / `boligrafos`. El TPV ya capitaliza pero los muestra como dos chips distintos. Queremos detectar duplicados por `unaccent(LOWER(t))` y unificar al canónico (lowercase sin tilde) en BD.

**Endpoint super-admin**:

```
POST /super-admin/tenants/:id/dedupe-tags
```

Acción:
1. Lee todos los `products.tags` del tenant (que es jsonb `string[]`).
2. Para cada producto, calcula `dedupedTags = unique(tags.map(t => removeAccents(t.toLowerCase())))`.
3. Si `dedupedTags !== tags`, actualiza el producto.
4. Devuelve `{ productsScanned, productsUpdated, duplicatesRemoved }`.

`removeAccents` con `String.prototype.normalize("NFD").replace(/[̀-ͯ]/g, "")`.

**Admin UI**: en `TenantDetailPage` del super-admin, añadir un botón pequeño **"Limpiar tags duplicados"** debajo del bloque de sync. Confirm dialog ("Esto modifica products.tags del tenant. ¿Continuar?") y al confirmar muestra el resultado en un toast.

**Audit log**: anotar en `SuperAdminAuditLog` la acción `dedupe_tags` con counts.

**Why**: visibilidad para Thalía. También es el primer paso para que el TPV tenga UI razonable cuando haya muchos clientes con catálogos sucios.

---

## Constraints generales

- TypeScript estricto, `pnpm -r build` debe pasar.
- Vitest para los endpoints nuevos (al menos happy path).
- No deshabilitar lint.
- Migraciones en `packages/db/prisma/migrations/` con timestamp `20260525130000_b24_tag_aliases/`. Para el dedupe NO hay migración (es script).
- Conservar el patrón de los Lotes 4-6 anteriores (panel inline en TenantDetailPage, comentarios "// v1.3-Operativa-Extra · Lote N" en cabecera de funciones).
- No tocar `auth/`, `tickets/`, `shift/` salvo lo estrictamente necesario.

## Orden si tienes que cortar

1 > 2 > 3. El 1 es el de mayor impacto en piloto (Peluquería Sole va a renombrar tags hoy). El 3 cierra un ticket viejo.

Commits separados por lote. Branch `v1-3-operativa-extra` desde master. No hagas merge — yo reviso y hago `git merge --ff-only`.
