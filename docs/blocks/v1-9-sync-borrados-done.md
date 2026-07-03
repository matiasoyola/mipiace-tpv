# Bloque v1.9 · Propagación de borrados Holded → TPV — DONE

**Rama:** `v1-9-sync-borrados`
**Origen:** caso real Librería Thalia (2026-07-03): 6 servicios borrados en Holded seguían vendibles en el TPV + duplicado TALONARIO CAJA con 400 persistente.
**Estado:** cerrado. `pnpm test` (workspace) verde — 855 passing + 3 skipped (legacy entorno Redis), antes 839. `tsc --noEmit` limpio en todos los packages. Sin merge ni deploy (los hace Matías). Migración aditiva pendiente de aplicar en el deploy — sin ventana de mantenimiento.

---

## ⚠️ Hallazgo previo al diseño — la premisa del bloque estaba desactualizada

El bloque partía de "el sync solo propaga altas y cambios, nunca borrados". **No es cierto desde B2**: `incremental-sync.ts` ya marcaba huérfanos cada 15 min (`UPDATE products SET active=false, sellableViaTpv=false WHERE lastSyncedAt < syncStartedAt`). Es decir: los borrados SÍ se propagaban por diseño… y aun así Thalia tiene residuos. Dos hipótesis compatibles con el código, **no verificables sin producción**:

1. **El sync incremental de Thalia lleva tiempo fallando antes del paso de huérfanos** (p. ej. `/services` devolviendo algo no-array → `TypeError` → catch top-level → el paso de huérfanos nunca corre). Los upserts previos al fallo sí se persisten (no hay transacción), así que el catálogo "parece" sincronizar. Hasta este bloque el worker NO reportaba a Sentry — un fallo repetido era invisible.
2. **El listado de Holded sigue devolviendo fichas borradas** (rareza candidata, NO confirmada). Si se confirma al correr el one-shot (los fantasmas siguen activos tras conciliar), es hallazgo nuevo para `docs/spike-holded.md` y la única defensa sería el 404 de detalle (Frente 2).

**Cómo diagnostica el one-shot:** si tras ejecutarlo los 6 fantasmas quedan archivados → hipótesis 1 (y el `captureError` nuevo del worker destapará el fallo recurrente en Sentry). Si siguen activos → hipótesis 2 → hallazgo spike + bloque de seguimiento.

Consecuencia de diseño: **no se añadió un job/cola nuevo**. El paso de huérfanos existente se sustituyó por la conciliación por set vivo con protección anti-catástrofe, reutilizando el listado que el sync ya recorre cada 15 min (coste API extra: cero). La "cadencia propia 1×/día" del bloque perdía su motivo (evitar una segunda pasada de listado); correr en cada tick es estrictamente mejor. El Re-sync manual del super-admin concilia automáticamente al reusar el mismo camino.

---

## Resumen de números

- **Tests:** +16 — `catalog-reconcile.test.ts` (10, nuevo), `incremental-sync.test.ts` (+4), `auto-sku.test.ts` (+1 nuevo, +2 reforzados), `tpv-catalog-business-type.test.ts` (+1).
- **Migración:** `20260703000000_v1_9_archived_from_holded` — `ALTER TABLE products ADD COLUMN archived_from_holded_at TIMESTAMPTZ` (aditiva, sin backfill).
- **Ficheros nuevos:** `apps/api/src/catalog/reconcile.ts`, `apps/api/src/scripts/reconcile-catalog.ts`.

## Frente 1 — Conciliación por set vivo (`catalog/reconcile.ts`)

- `archiveMissingProducts(prisma, tenantId, liveIds, opts)`: soft-archiva (`active=false, sellableViaTpv=false, archivedFromHoldedAt=now()`) todo producto activo cuyo `holdedProductId` no esté en el set vivo. Nunca borra filas (histórico de tickets).
- **Protección anti-catástrofe:** aborta sin archivar NADA si el set vivo está vacío con catálogo local vivo (`empty-live-set`) o si es `< 50%` de los activos locales (`live-set-below-ratio`, `MIN_LIVE_RATIO = 0.5`). En ambos casos `captureAlert` a Sentry con conteos. Cualquier error de listado (página rota, non-array, 5xx) revienta ANTES de archivar.
- Integración en `incremental-sync.ts`: el loop de productos/servicios acumula `liveIds` (productos `forSale=0` excluidos a propósito — no se sincronizan, mismo criterio que el huérfano-por-timestamp anterior; servicios sin filtro, como siempre) y llama a `archiveMissingProducts` donde antes estaba el `updateMany` por timestamp. Stats nuevos en `lastIncrementalSyncStats`: `reconcileAborted` (motivo o null) y `reconcileArchivedSample` (≤20 archivados con nombre, visibles desde `/catalog/sync-status` sin entrar a BD). `orphansMarked` se mantiene con la misma semántica (compat UI admin).
- `runCatalogReconcile({tenantId, prisma, force?})`: pasada standalone (listado completo, sin upserts) para el one-shot. `CatalogReconcileSkippedError` si el tenant no tiene API key o sync inicial incompleto.
- **Reactivación:** el upsert del sync (incremental e inicial) ya ponía `active=true` si el id reaparece; ahora además limpia `archivedFromHoldedAt`. Cubierto por test ("huérfano que vuelve").
- Worker `catalog-incremental-worker`: `captureError` a Sentry en `failed` (antes solo console.error) — un sync que casca de forma repetida congela catálogo Y propagación de borrados; ahora es visible.

## Frente 2 — 404/400 puntuales

- `auto-sku.ts` · 404: igual que antes (archive inmediato) + ahora estampa `archivedFromHoldedAt`.
- `auto-sku.ts` · **4xx ≠ 404/429** (caso TALONARIO CAJA, 400 persistente): antes el producto seguía siendo candidato y se reintentaba el PUT **cada 15 min para siempre**. Ahora → `needsSkuReview=true` + `sellableViaTpv=false`: sale de los candidatos (fin del reintento infinito) y entra en la bandeja de revisión del admin, donde el propietario decide (asignar SKU a mano o marcar no-vendible). El 429 (rate limit) queda en la rama transitoria y se reintenta. El 402 es clase aparte (`HoldedSubscriptionSuspendedError`) y no se ve afectado.
- `catalog/routes.ts` · `POST /catalog/sku-review/:id/assign` con 404 de Holded: antes 502 genérico dejando el producto atascado en la bandeja; ahora soft-archive (+timestamp, `needsSkuReview=false`) y **410 `HOLDED_PRODUCT_DELETED`** con mensaje claro. El admin no necesita cambios (pinta el `message` del error).
- Image-backfill: ya estaba acotado (sentinel 24h en 400 "sin foto", candidatos filtran `active=true`) — sin cambios.

## Frente 3 — TPV (verificado, sin código)

- El endpoint `/tpv/catalog/products` ya filtra `active: true AND sellableViaTpv: true AND sku NOT NULL` (`tpv-catalog/routes.ts:58-60`) — test nuevo lo fija como contrato.
- El pull del TPV es **full-replace**, no merge: `catalog.ts` acumula todas las páginas y hace `store.clear()` + `put` por transacción IndexedDB. Los archivados desaparecen del device en el siguiente refresh (arranque de app o botón "Sincronizar catálogo"). No hacen falta tombstones ni versionado.
- El service worker cachea `/api/tpv/catalog/` con **NetworkFirst** (timeout 5s) — con red, el catálogo nunca se sirve de caché vieja; offline se mantiene el último bueno (correcto).

## Frente 4 — One-shot post-deploy

Tras aplicar la migración y desplegar, en el VPS:

```bash
# Todos los tenants (recomendado):
pnpm --filter @mipiacetpv/api tsx src/scripts/reconcile-catalog.ts --all

# Un tenant concreto:
pnpm --filter @mipiacetpv/api tsx src/scripts/reconcile-catalog.ts --tenantId=<uuid>
```

- Imprime JSON por tenant (`localActiveBefore`, `liveSeen`, `archived`, `archivedSample`, `aborted`) y sale con código 1 si algún tenant abortó o falló.
- `--force` salta la protección anti-catástrofe — SOLO tras verificar a mano que un borrado masivo es legítimo (p. ej. cliente que vació su catálogo a propósito; sin `--force` ese tenant abortará en cada tick con alerta Sentry hasta intervención).
- Idempotente; re-ejecutar no cambia nada si ya está conciliado.

**Resultado esperado en Thalia:** los 6 servicios fantasma ("Fotocopia a color", "Fotocopia en blanco y negro", "Encuadernacion", "Escaner", "CORREO ELECTRONICO", "BOLSA DE PLASTICO") + duplicados TALONARIO archivados (`archived ≥ 7`, sample con sus nombres) y fuera del TPV al siguiente refresh de los dispositivos. **Si `archived` no los incluye y siguen activos → hipótesis 2 (listado devuelve borrados) → hallazgo spike.**

## Decisiones

1. **Sin job/cola/cron nuevo** — conciliación integrada en cada tick incremental reusando su listado (ver hallazgo arriba). Desviación consciente de la "cadencia 1×/día" del bloque; el motivo de esa cadencia (coste de una segunda pasada) desaparece.
2. **`archivedFromHoldedAt` en Product** (columna que el bloque dejaba opcional): distingue "borrado en Holded" de otras causas de `active=false` y alimenta el diagnóstico del one-shot. El des-archivado la limpia.
3. **Umbral 50%** tal cual sugería el bloque. Falso positivo posible (cliente que borra legítimamente >50% del catálogo): abortará con alerta Sentry en cada tick hasta correr el one-shot con `--force` — preferible a archivar por una respuesta coja.
4. **4xx≠404 de auto-SKU → bandeja de revisión** en vez de contador nuevo: reutiliza la maquinaria existente (`needsSkuReview` + bandeja admin + `mark-unsellable`), cero columnas nuevas, y de paso corta el reintento infinito que pedía el bloque.

## Carryovers

- **Diagnóstico Thalia pendiente de producción** (correr el one-shot y mirar Sentry): si el listado de Holded devuelve fichas borradas → hallazgo numerado en `docs/spike-holded.md` + evaluar sonda de detalle (GET puntual) para fantasmas persistentes. No hay helper `getService` en holded-client si hiciera falta sondear servicios.
- **Caso borde comodines TPV-OTROS:** si un propietario borra el comodín en Holded, la conciliación lo archiva y `createTpvOtrosWildcards` NO lo recrea (su check de existencia es por sku local y encuentra la fila archivada → "reused"). Rarísimo (el desc dice "No editar"), pero si pasa: borrar la fila local o re-crear a mano. Candidato a fix menor en bloque futuro (reactivar/recrear si `active=false`).
- **Tenant sin columna nueva:** la frontera con v1.8 prohíbe tocar el schema de Tenant; no hizo falta (sin cadencia propia no hay `lastReconcileAt`). Si un bloque futuro quiere histórico de conciliaciones, tabla propia `catalog_reconcile_runs` (aditiva).
