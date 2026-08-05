# Bloque B-koibox-2 · Catálogo de servicios extendido — DONE

**Rama:** `koibox-1-crm` (sesión catálogo extendido). Prompt: `docs/code-prompts/bloque-koibox-2-catalogo.md`.
Contexto: `docs/design/koibox-modulo-kickoff.md` (ADR-K1, ADR-K6, §4 modelo de datos, §7 roadmap), `docs/design/agenda-belleza-spec.md` §2/§3, `docs/blocks/B-koibox-1-done.md` (patrón capability flag), `docs/06-modelo-datos.md`, `docs/holded/endpoints/services.md`.

Segundo bloque del módulo Citas+Clientes+Bonos. **Aditivo, no toca el sync de
catálogo de Holded ni el camino de cobro** (ADR-010 intacto). **Owner de la columna
`Tenant.agendaEnabled`.** Desbloquea la agenda (B4) y la reserva online (B6).

## Resumen

Capa de **extensión local** sobre el catálogo de servicios que ya viene de Holded
(`product.kind=SERVICE`), NO una tabla `Service` paralela (ADR-K1): el precio y el IVA
siguen en Holded y aquí sólo se añaden los datos que la agenda necesita y Holded no
modela — duración, pausas/buffers, nº de profesionales, familia y flags de canal
(Caja/Ticket/Agenda/Online). Se añaden los **recursos** genéricos (cabina/sala/aparato,
vocabulario neutro ADR-K6) y qué tipos de recurso necesita cada servicio. Todo el módulo
se activa por capability flag `agendaEnabled` por tenant (ADR-K6): apagada → panel oculto
en el admin y sin duración en el TPV. Un servicio sin fila `service_scheduling` no tiene
duración ni es reservable: la agenda (B4) lo ignora.

## Ficheros

**Nuevos**
- `packages/db/prisma/migrations/20260805000000_b_koibox_2_catalog/migration.sql`
- `apps/api/src/services/routes.ts` — endpoints REST del catálogo extendido.
- `apps/api/test/services-route.test.ts` — 11 tests (Prisma en memoria).
- `apps/admin/src/pages/AgendaCatalogPage.tsx` — panel de edición (scheduling + recursos + necesidades), gated por `agendaEnabled`.

**Tocados**
- `packages/db/prisma/schema.prisma` — enum `ResourceKind`; modelos `ServiceScheduling`,
  `Resource`, `ServiceResourceNeed`; `Tenant.agendaEnabled` + relaciones; relaciones
  `Product.scheduling`/`Product.resourceNeeds`.
- `apps/api/src/server.ts` — registra `registerServicesRoutes`.
- `apps/api/src/admin/tenant-settings.ts` — `agendaEnabled` en GET/POST de ajustes
  (el toggle ya estaba stubeado por B3; aquí se cablea la columna real).
- `apps/api/src/tpv-catalog/routes.ts` — expone `agendaEnabled` y `durationMin` (por
  servicio) en la 1ª página del catálogo del TPV.
- `apps/tpv-web/src/lib/catalog.ts` — `CatalogProduct.durationMin`; cachea
  `agendaEnabled` (`get/setCachedAgendaEnabled`).
- `apps/tpv-web/src/pages/CartLineItem.tsx` — chip informativo "N min" por línea de servicio.
- `apps/tpv-web/src/pages/SalePage.tsx` — mapa `productId→durationMin` (sólo si
  `agendaEnabled`) pasado a `TicketPanel`/`CartLineItem`.
- `apps/admin/src/App.tsx` — ruta `/admin/agenda-catalog`.
- `apps/admin/src/AdminShell.tsx` — `NavItem.capability` + hook `useAgendaEnabled`;
  entrada de sidebar gated (mecanismo compartido con la entrada "Personal" de B3).

## Entregables

| Entregable | Estado | Notas |
|-----------|--------|-------|
| Migración Prisma + índices (backfill vacío) | ✅ | `service_scheduling` (pk=productId), `resources`, `service_resource_needs`; índices por `tenant_id` (+ `(tenant_id, kind)` en recursos). `Tenant.agenda_enabled` default OFF. |
| Endpoints REST + JSON Schema + aislamiento por tenant + tests | ✅ | `GET /services/scheduling`, `PUT /services/:id/scheduling`, `GET/PUT /services/:id/resource-needs`, CRUD `/resources`. 11 tests. |
| Panel de edición scheduling + recursos, gated por `agendaEnabled` | ✅ | `AgendaCatalogPage`; nav oculto sin la capability; edición sólo OWNER (MANAGER lee). |
| Duración por línea en el ticket (informativo) | ✅ | Chip `tabular-nums` sólo con `agendaEnabled`; base visual para B4. |
| Exponer `agendaEnabled` en `/tpv/catalog` y `/admin/tenant/settings` | ✅ | Paridad con `crmEnabled` de B1. |

**Criterio de "funciona":** en un tenant con `agendaEnabled`, el propietario edita
duración/pausas/nº profesionales/canales de un servicio y sus recursos; un servicio con
`onlineBookable=false` queda marcado como no ofrecible en reserva (contrato para B4/B6,
`channels.online` forzado a false); un servicio sin fila `service_scheduling` es ignorado
por la agenda. Un tenant sin `agendaEnabled` no ve el panel (nav oculto + página con
aviso) ni duraciones en el TPV.

## Contrato de la API (para B4 / B6 / front)

Lecturas `requireOwnerOrManager`, mutaciones `requireOwner`. Aislamiento por `auth.tenantId`;
scheduling y necesidades de recurso pasan siempre por `loadOwnedService` (producto validado
como SERVICE del tenant) antes de tocarse.

- **`GET /services/scheduling?query=`** → `{ items: ServiceRow[] }`. Cada item:
  `productId, holdedProductId, name, sku, basePrice, taxRate, active, scheduling|null`.
  `scheduling` = `{ durationMin, bufferBeforeMin, bufferAfterMin, staffRequired,
  onlineBookable, family, channels:{caja,ticket,agenda,online}, updatedAt }`. Filtra por
  nombre/SKU. Sólo `kind=SERVICE`.
- **`PUT /services/:productId/scheduling`** → `{ scheduling }`. Upsert. Body:
  `durationMin (req, 1–1440), bufferBeforeMin?, bufferAfterMin?, staffRequired? (1–12),
  onlineBookable?, family?, channels?`. `channels.online` se fuerza a `false` cuando
  `onlineBookable=false` (coherencia contrato B4/B6). `404 SERVICE_NOT_FOUND` si el
  producto es de otro tenant o no es servicio.
- **`GET /services/:productId/resource-needs`** → `{ needs:[{resourceKind,qty}] }`.
- **`PUT /services/:productId/resource-needs`** → `{ needs }`. Reemplazo idempotente del
  set (el body define el estado final; máx 3 = uno por tipo). Dedup por tipo (el último gana).
- **CRUD `/resources`**: `GET → {resources:[{id,name,kind}]}`, `POST → 201 {resource}`
  (`name`, `kind:CABIN|ROOM|DEVICE`), `PATCH /:id → {resource}`, `DELETE /:id → {deleted:true}`.
  `404 RESOURCE_NOT_FOUND` para recursos de otro tenant.

`agendaEnabled` viaja al TPV en la 1ª página de `GET /tpv/catalog/products` (junto a
`crmEnabled`) y a los servicios se les añade `durationMin` (null si no tienen scheduling).
Se togglea desde `GET/POST /admin/tenant/settings`.

## Decisiones tomadas sin preguntar (con justificación)

1. **`agendaEnabled` = columna booleana en `Tenant` (owner de la columna).** Sigue el
   patrón fijado en B1 (`crmEnabled`), no un jsonb `capabilities`. B3 (Personal, en
   desarrollo concurrente) ya dejaba el toggle stubeado en el schema de
   `POST /admin/tenant/settings` esperando que **B2 creara la columna** (comentario en su
   migración: "propiedad de B-koibox-2"); aquí se crea la columna y se cablea de verdad
   (GET select + POST data). B5/B6 añadirán `bonosEnabled`/`reservaOnlineEnabled` como
   columnas hermanas.
2. **Los endpoints NO enforzan la capability server-side.** Igual que B1: el flag viaja
   al front (TPV y admin) y es el front quien muestra/oculta. Los endpoints existen con
   independencia del flag. Menos fricción, mismo patrón probado, y evita duplicar el gate
   en cada handler. El panel del admin y el sidebar sí lo consultan.
3. **`service_scheduling` con PK = `product_id` (relación 1:1, sin id propio).** La
   extensión ES el producto (ADR-K1). FK `product_id → products.id`; la restricción
   `kind=SERVICE` no se exige a nivel de BD (Prisma no puede) sino en el endpoint
   (`loadOwnedService`). Igual para `service_resource_needs.service_id`.
4. **`tenantId` en `service_scheduling` y `service_resource_needs`** pese a que el boceto
   §4 no lo dibujaba en las hijas — la regla "todo lleva `tenantId`" manda, y permite
   filtrar/aislar sin join al producto. Índice por `tenant_id` en las tres tablas.
5. **`channels` como jsonb con forma estable `{caja,ticket,agenda,online}`** y default
   `{true,true,true,false}` en BD. **`channels.online` se coerce a `false` si
   `onlineBookable=false`** en el `PUT`: los dos conceptos ("el canal online" y "es
   reservable online") se mantienen coherentes para no dar a B4/B6 un estado imposible
   (online activo sin ser reservable). En el panel se colapsan en un único control.
6. **`resource-needs` vía `GET` + `PUT` (reemplazo del set), no POST/DELETE granular.**
   La pk compuesta `(serviceId, resourceKind)` admite como mucho una fila por tipo, así
   que el estado final cabe en un array pequeño (máx 3) — un `PUT` idempotente es más
   simple de consumir y evita estados intermedios. Se guarda en el mismo gesto que el
   scheduling en el panel.
7. **Lecturas `requireOwnerOrManager`, mutaciones `requireOwner`** — paridad con
   `POST /admin/tenant/settings` (config del negocio la fija el propietario; el encargado
   consulta). El panel gatea los controles de edición con `readEffectiveAuth().canEdit`.
8. **`durationMin` viaja al TPV por `/tpv/catalog` (join `scheduling`)** y se pinta como
   chip informativo por línea de servicio **sólo si `agendaEnabled`**. NO se bumpea la
   versión de IndexedDB del catálogo (campo aditivo): la duración aparece tras el primer
   refresh completo post-activación (banner "Sincronizando"), mismo criterio que el campo
   `tags` de B-Categorias. Base visual para B4, sin tocar el modelo del carrito.
9. **Panel gated por doble puerta:** la página consulta `agendaEnabled` y muestra un aviso
   si está OFF; la entrada del sidebar se oculta con `NavItem.capability` + hook
   `useAgendaEnabled` (mismo mecanismo que la entrada "Personal" de B3, coincidencia de
   diseño con el trabajo concurrente).
10. **Timestamp de migración `20260805000000`** (fecha de hoy). Coincide con B3
    (`_b_koibox_3_staff`); el nombre de carpeta `_b_koibox_2_catalog` **ordena antes**
    (`2 < 3`), así que Prisma aplica B2 primero (crea `agenda_enabled`) y B3 después (la
    consume). Sin conflicto de `ALTER` — B3 no toca la columna.

## Fuera de alcance (respetado)

- **Packs / experiencias / ofertas** (agrupar servicios) — fase posterior.
- **Descuentos y cupones** — fase 2.
- **Motor de disponibilidad y vistas de agenda** (B4) — sólo el contrato de datos.
- **Turnos y matriz de skills de empleado** (B3) — bloque hermano concurrente.
- **Precio / IVA** — son de Holded; aquí sólo se muestran informativos, nunca se editan.
- **Venta / reserva online** (B6) — sólo `onlineBookable`/`channels.online` como contrato.
- **Sync de catálogo de Holded** — intacto; sólo se añade el overlay local.
- **Camino de cobro a Holded** (ADR-010) — intacto.

## Verificación

- **Entorno reparado antes de verificar.** El `node_modules` estaba corrupto a nivel de
  filesystem (el `.d.ts` del cliente Prisma generado sin newlines, `@prisma/fetch-engine`
  con `download` exportado como `undefined`, artefactos duplicados `file 2.js`/`file 3.js`,
  esbuild con interop ESM roto que impedía arrancar vitest). Se reparó con
  `pnpm install --force` (re-descargó ~100 paquetes desde el store) — no es un cambio de
  código, sólo restaura el árbol de dependencias. Tras eso, `prisma generate` y `vitest`
  vuelven a funcionar.
- `packages/db`: `prisma format` + `prisma generate` OK (cliente v5.22.0; incluye
  `ServiceScheduling`, `Resource`, `ServiceResourceNeed`, `Tenant.agendaEnabled`).
- `apps/api`: `tsc --noEmit` limpio. **Suite completa: 81 files, 608 passed / 3 skipped**
  (los 3 skipped son de super-admin, preexistentes). `services-route.test.ts`: 11/11.
  Incluye la suite de B3 (`staff-route.test.ts`) sin regresiones.
- `apps/admin`: `tsc --noEmit` limpio.
- `apps/tpv-web`: `tsc --noEmit` limpio. `vite build` (tsc -b + vite + PWA) OK.

## Carryovers para el siguiente bloque

1. **Migración `20260805000000_b_koibox_2_catalog` no aplicada al piloto** — `prisma
   migrate deploy` en el deploy (en dev sólo se corrió `generate`). Va antes que la de B3
   (misma fecha, orden por nombre de carpeta).
2. **Toggle UI de `agendaEnabled`**: hoy se activa por `POST /admin/tenant/settings` (el
   flag ya está en el schema del endpoint) o super-admin/DB. No hay un switch dedicado en
   `SettingsPage` — mismo carryover que `crmEnabled` en B1 (la API ya lo acepta).
3. **Validación visual real** del panel admin (`AgendaCatalogPage`) y del chip de duración
   en el TPV pendiente. Los tests React (jsdom) siguen diferidos por la limitación de
   infra preexistente; la lógica de API se cubre con tests node-env.
4. **Duración en el TPV tras el primer refresh completo**: la IndexedDB del catálogo no se
   invalida al activar `agendaEnabled`; los servicios muestran `durationMin` tras el
   siguiente pull completo (banner "Sincronizando"). Aceptable; bumpear la versión forzaría
   un re-fetch innecesario del catálogo entero.
5. **Contrato de datos listo para B4/B6**: `service_scheduling` (duración + buffers +
   `staffRequired`), `resource`/`service_resource_need` (por tipo, no por recurso concreto)
   y `channels.online`/`onlineBookable` son la entrada del motor de disponibilidad (B4) y
   del gate de reserva online (B6). El motor decidirá si un servicio con un need de un tipo
   sin recursos dados de alta es no-reservable (la API acepta cualquier `resourceKind`; el
   panel sólo ofrece tipos con recursos existentes).
6. **Sin validación cruzada resource-need ↔ existencia de recursos** a nivel API: es una
   decisión de agenda (B4), no del catálogo.
