# Bloque v1.9 · Propagación de borrados Holded → TPV (conciliación de catálogo)

**Rama:** `v1-9-sync-borrados` (worktree nuevo, NO sobre master directo)
**Origen:** caso real detectado el 2026-07-03 validando a Librería Thalia: su Holded ya NO tiene las fichas "Fotocopia a color", "Fotocopia en blanco y negro", "Encuadernacion", "Escaner", "CORREO ELECTRONICO", "BOLSA DE PLASTICO" (borradas por la clienta), pero el TPV las sigue ofreciendo como vendibles — son residuos del sync, que solo propaga altas y cambios, nunca borrados. Además hay fichas TALONARIO duplicadas donde una copia ya devuelve 400 en Holded (`TALONARIO CAJA` 68d66b3386a8efc7260acf3a, ya marcada `active=false` a mano por el flujo auto-SKU). Vender un producto residual = silent_reject en la subida. Hay que cerrar el gap ANTES de activar a Thalía.

---

## ⚠️ Bloque paralelo en vuelo — frontera de coexistencia

`v1-8-fiado` corre en paralelo. **NO toques**: `apps/api/src/tickets/**`, `apps/api/src/shift/**`, `apps/tpv-web/src/pages/**`, `packages/escpos-builder/**`, `packages/ticket-pdf/**`, `apps/admin/src/pages/SettingsPage*`, schema de Ticket/TicketPayment/Tenant. Si necesitas algo de ahí, carryover al done.md.

## Frontera de archivos

- `apps/api/src/catalog/**` (incremental-sync, routes) y/o `apps/api/src/queues/**` + `apps/api/src/workers/**` (job nuevo de conciliación de catálogo).
- `packages/holded-client/src/products.ts` — solo si falta algún helper de listado (la paginación `listProductsPage`/iterator ya existe).
- `packages/db/prisma/schema.prisma` + migración aditiva SOLO si hace falta columna (p. ej. `archivedFromHoldedAt`) — probablemente basta con `active`/`sellableViaTpv` existentes.
- `apps/tpv-web/src/lib/catalog.ts` / IndexedDB — solo si el pull del catálogo no expulsa ya los inactivos (verificar primero; probablemente ya filtra por sellable).
- Tests + `docs/blocks/v1-9-sync-borrados-done.md`.

---

## Diseño

### Frente 1 — Pasada de conciliación de catálogo (el corazón)

Job `catalog-reconcile` por tenant: recorre TODO el listado de productos de Holded con el iterator de paginación existente, construye el set de `holded_product_id` vivos, y todo producto local con `holded_product_id` que NO esté en el set → **soft-archive**: `active=false, sellableViaTpv=false` (+ timestamp si añades columna). **NUNCA borrar filas**: el histórico de tickets las referencia.

- Protección anti-catástrofe: si el listado de Holded devuelve sospechosamente poco (p. ej. <50% de los productos locales vivos, o 0 páginas con API sana), **ABORTA sin archivar nada** y reporta a Sentry — una respuesta coja de la API no puede archivar un catálogo entero.
- Servicios (`services.ts` de holded-client): mismo tratamiento si el TPV los sincroniza como products — verifica cómo entran hoy y cubre ambos orígenes.
- Programación: dentro del ciclo incremental existente pero con cadencia propia (p. ej. 1×/día por tenant, no en cada incremental) + **endpoint/acción manual** desde super-admin (puede colgar del Re-sync existente: que el resync completo también concilie).
- Reactivación: si un id reaparece en Holded (des-archivado), el sync normal debe poder revivirlo (`active=true` + recalcular sellable).

### Frente 2 — 404/400 puntuales

El manejo existente (auto-SKU marca inactive en 404) se generaliza: cualquier GET de detalle de producto que devuelva 404 → soft-archive inmediato + log. Un 400 persistente (caso TALONARIO CAJA) → log claro y contador, no reintentos infinitos del image-backfill/detalle.

### Frente 3 — TPV

Verificar que el pull de catálogo del TPV excluye inactivos Y que el IndexedDB local los purga al refrescar (no basta con no-enviarlos: los devices con catálogo viejo deben eliminarlos — revisar cómo se aplica el delta en `catalog.ts`). Si el delta es merge-only, añade tombstones o full-replace por versión.

### Frente 4 — One-shot post-deploy

CLI o flag del job para ejecutar la conciliación sobre todos los tenants tras el deploy (documentar comando exacto en el done.md). Resultado esperado en Thalía: los 6 servicios fantasma + duplicados TALONARIO archivados y fuera del TPV.

---

## Cierre

- Tests: diff con set vivo, protección anti-catástrofe (payload vacío NO archiva), reactivación, 404 puntual, TPV purga inactivos. Suite completa verde + tsc limpio.
- `docs/blocks/v1-9-sync-borrados-done.md` con: decisiones, comando one-shot, y conteo esperado en Thalía.
- NO mergees ni despliegues — lo hace Matías (después de v1.8 o antes, según qué termine primero; sin dependencia entre ambos).
