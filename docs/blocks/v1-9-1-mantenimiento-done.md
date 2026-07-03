# Bloque v1.9.1 · Mantenimiento (4 micro-fixes) — DONE

**Rama:** `v1-9-1-mantenimiento`
**Origen:** hallazgos operativos de las sesiones 2026-07-02/03 (deploys v1.6-v1.9, restore drill, diagnóstico Thalia).
**Estado:** cerrado. `pnpm test` (workspace) verde — 866 passing + 3 skipped (legacy entorno Redis), antes 855. `tsc` limpio en api, admin y tpv-web. Sin migraciones, sin tocar la frontera de `v1-8-fiado`. Sin merge ni deploy (los hace Matías).

---

## Frente 1 — Corepack sin prompt en deploys

`ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0` en `infra/Dockerfile`, stages `deps` y `api` (las dos que hacen `corepack enable`; `build` hereda de `deps`, `worker` de `api`, `static` es alpine sin pnpm). Se usa ENV y no ARG a propósito: tiene que persistir en la imagen final porque el prompt también salta en los `docker compose run api pnpm …` de migraciones (`deploy.sh:63`, `bootstrap-hostinger.sh:125`). Fuera del contenedor ningún script de infra ejecuta pnpm/corepack — no hace falta tocar nada más.

## Frente 2 — Cron de backup en bootstrap

`infra/bootstrap-hostinger.sh` · sección nueva 7.5 (antes del health check): instala idempotentemente en el crontab de root

```
0 4 * * * $REPO_DIR/infra/backup-postgres.sh >> /var/log/mipiacetpv-backup.log 2>&1
```

Guard con `grep -qF "infra/backup-postgres.sh"` sobre `crontab -l` — no duplica si ya existe (el VPS actual ya la tiene instalada a mano desde el drill del 2026-07-02; correr el bootstrap ahí será no-op). `docs/deploy/hostinger.md` §7 actualizado: el camino normal es re-correr el bootstrap; la instalación manual queda como fallback documentado.

**Validación en deploy:** correr el bootstrap y `crontab -l | grep backup-postgres` (una sola entrada).

## Frente 3 — Badge "Suscripción suspendida" en super-admin

Caso Thalia: Holded suspendido por impago (HTTP 402) tiempo indeterminado y el super-admin pintaba "Conectado" — la columna HOLDED era `holdedApiKeyCiphertext != null`, un check de presencia de key.

- **`apps/api/src/holded/connection-status.ts` (nuevo):** `holdedConnectionStatus(tenant)` → `NOT_CONNECTED | CONNECTED | SUSPENDED | ERROR`, derivado de `tenant.lastIncrementalSyncStats` (Json). **Cero llamadas nuevas a Holded** (probar la key en el listado sería N requests por render). Sólo cuenta el error top-level (`step: "<top>"`); los fallos de sub-pasos (contacts, image-backfill) no abortan el sync y no degradan el badge.
- **Detección del 402 en dos capas:** `incremental-sync.ts` estampa `code: "HOLDED_SUSPENDED"` en el error top-level desde este bloque; para los stats YA persistidos en producción (Thalia, pre-código) se matchea el mensaje literal de `HoldedSubscriptionSuspendedError` (`/suspended \(HTTP 402\)/i`). Sin migración — `lastIncrementalSyncStats` es Json.
- **API:** `GET /super-admin/tenants` y `GET /super-admin/tenants/:id` devuelven `holdedStatus` (se mantiene `holdedConnected` boolean por compat). El hub NO se tocó (fuera de alcance del bloque; su card sigue con el boolean).
- **UI admin:** columna HOLDED del listado con badge rojo "Suscripción suspendida" (SUSPENDED), ámbar "Error de sync" (ERROR); detalle con el mismo estado en la ficha + copy accionable ("El cliente debe regularizar el pago en Holded — el sync está parado") y en la CardMetric (accent `danger` nuevo).
- **Semántica de recuperación:** cuando el cliente paga y el siguiente tick del sync (15 min) termina limpio, los stats se sobreescriben y el badge vuelve solo a "Conectado".
- **Tests:** `apps/api/test/holded-connection-status.test.ts` (8, nuevo) — incluye el caso legacy con el mensaje literal persistido pre-v1.9.1 y stats con forma corrupta.

**Nota ERROR:** un fallo transitorio del sync (Holded 5xx en un tick) pinta "Error de sync" hasta el siguiente tick que termine limpio. Aceptado — es información real de que el último sync no acabó.

## Frente 4 — Empty-state de búsqueda del TPV

Bug: `SaleWorkspace` recibe `products` YA filtrado por la búsqueda (`filtered` en `SalePage`), así que búsqueda sin coincidencias caía en el empty state de catálogo vacío ("Aún no has cargado productos…" — alarmante y falso con catálogo poblado). El bloque de "no coincide" existente sólo cubría el filtro por kind/tag (`products.length > 0`).

- `SaleWorkspace` recibe prop nueva `searchQuery` (el `query` del buscador).
- Catálogo vacío de verdad (`products.length === 0` sin búsqueda) → mensaje actual, sin cambios (incluida la variante SERVICES).
- Búsqueda sin coincidencias → nuevo: `Sin resultados para «<query>». Prueba con otro nombre o escanea el código.` (copy único, vertical-neutral).
- No se tocó `SalePage.lineSheet.tsx` ni `lib/cart.ts` (frontera del bloque).
- **Tests:** `apps/tpv-web/test/sale-search-empty-state.test.tsx` (3, nuevo) — mismo harness sin testing-library que `table-sale-flow.test.tsx`; primera cobertura de empty states del grid.

---

## Resumen de números

- **Tests:** +11 — `holded-connection-status.test.ts` (8, nuevo), `sale-search-empty-state.test.tsx` (3, nuevo).
- **Migraciones:** ninguna (el estado Holded viaja en el Json `lastIncrementalSyncStats` existente).
- **Ficheros nuevos:** `apps/api/src/holded/connection-status.ts`, `apps/api/test/holded-connection-status.test.ts`, `apps/tpv-web/test/sale-search-empty-state.test.tsx`.

## Carryovers

- **Hub super-admin sin `holdedStatus`:** la card del hub sigue usando `holdedConnected` boolean. Si se quiere el badge de suspensión también ahí, es un cambio pequeño (mismo helper, ya exportado).
- **Verificación con Thalia en producción:** tras el deploy, el listado debe pintar "Suscripción suspendida" en Thalia vía el match legacy del mensaje — si no aparece, revisar qué quedó persistido exactamente en su `lastIncrementalSyncStats`.
