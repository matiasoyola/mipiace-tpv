# v1.5-Consistencia-B · done

**Rama:** `v1-5-consistencia-b` · un único commit, sin merge.
**Estado final:** `pnpm test` → 74 files passed, 548 tests passed, 3 skipped (pre-existentes de v1.5-A), **0 failed**. `tsc` limpio en api, tpv-web, admin, holded-client y db. `docker compose config` valida prod y prod+build. `bash -n` OK en deploy.sh y bootstrap.

---

## Lote 1 · Imágenes a GHCR + deploy por pull con rollback

- **`.github/workflows/ci.yml`**: job `publish` nuevo, `needs: ci`, condicionado a `push` en `master` (en ramas el job no corre — CI de la rama valida con `ci` y queda verde sin publicar). `permissions: packages: write`, login a ghcr.io con `GITHUB_TOKEN`, buildx + `docker/build-push-action@v6` con cache GHA. Publica:
  - `ghcr.io/matiasoyola/mipiacetpv-api:<sha-corto>` + `:latest` (target `api`; la imagen `worker` es la misma — sólo cambia el CMD, que ya lo fija el compose).
  - `ghcr.io/matiasoyola/mipiacetpv-static-publish:<sha-corto>` + `:latest` (target `static`).
  - Build-args: `VITE_BUILD_HASH=<sha-corto>` (release Sentry de frontends + SW determinista) y `VITE_SENTRY_DSN` (del secret homónimo; sin secret llega vacío y Sentry frontend queda no-op).
- **`infra/docker-compose.prod.yml`**: `api`/`worker`/`static-publish` referencian `ghcr.io/...:${IMAGE_TAG:-latest}`. Los `build:` se movieron a **`infra/docker-compose.build.yml`** (override) — el build local sigue posible con `-f prod.yml -f build.yml build` y etiqueta con el mismo nombre ghcr, así `up -d` lo usa sin pull.
- **`infra/deploy.sh`** (nuevo, ejecutable, `set -euo pipefail`): `git pull --ff-only` → `compose pull` (con fallback a imágenes locales si no hay acceso al registry) → `prisma migrate deploy` → `up -d --force-recreate --no-deps api worker static-publish` → espera healthchecks Docker de api y worker → `/health` end-to-end → resumen con imágenes desplegadas. **Rollback = `IMAGE_TAG=<sha-anterior> bash infra/deploy.sh`**.
- **`infra/bootstrap-hostinger.sh`**: paso de build sustituido por pull-con-fallback-a-build — un VPS nuevo funciona con o sin login GHCR.
- **`docs/deploy/hostinger.md` §9** reescrito: flujo nuevo, rollback, y el `docker login ghcr.io` inicial (acción manual, ver abajo).

## Lote 2 · Sentry gated por env (no-op absoluto sin DSN)

- **Backend** (`@sentry/node` en `apps/api`, compartido por api y worker): `apps/api/src/lib/sentry.ts` — `initSentry(component)` sólo llama `Sentry.init` si `SENTRY_DSN` está presente; `captureError`/`captureAlert` son no-op sin init. `tracesSampleRate: 0` (sólo errores; nada de tracing en 1 vCPU).
  - Enganchado al error handler global (`lib/error-handler.ts`, caso 5 → 500): captura con tags `tenantId` + `requestId` + method/url.
  - Worker: init en `workers/index.ts`; captura en los `failed` de ticket-upload y refund-upload (dinero sin contabilizar = alertable) y del reconciliation-worker.
  - Release = `SENTRY_RELEASE`, que el compose fija a `${IMAGE_TAG}` (el sha corto del build).
- **Frontends** (`@sentry/react` en tpv-web y admin): `src/lib/sentry.ts` por app, gated por `VITE_SENTRY_DSN` (build-time). Enganchado a los dos ganchos que dejó v1.5-A: `ErrorBoundary.componentDidCatch` (con componentStack) y `installGlobalErrorLogging` (unhandledrejection). Release = `VITE_BUILD_HASH`.
- **Env**: `SENTRY_DSN`/`SENTRY_RELEASE` en `EnvSchema` (con preprocess `""`→`undefined` — compose interpola vacío), en los `environment:` de api y worker del compose, y en `.env.production.example`.
- Dependencias nuevas: sólo `@sentry/node` y `@sentry/react` (^10.57.0), como permite el bloque.

## Lote 3 · Cabos del incidente 2026-06-11

### 3.a Sweeper vs tickets TEST (bucle infinito)

**Elección: `SKIPPED` en el enum `HoldedUploadStatus`** (migración aditiva `20260611000000_b31_holded_upload_skipped`, `ALTER TYPE ... ADD VALUE`). Motivo frente a la alternativa DONE+lastError: `DONE` significa "subido a Holded con documentId" en queries y bandeja de errores — reciclarlo para "nunca se subirá" envenena esa semántica; el coste extra es una migración de una línea.

- `upload-ticket.ts`: la rama de modo prueba marca el upload `SKIPPED` con `lastError: {skipped: "test_mode"}` (`updateMany` → no-op silencioso si la fila no existe). El sweeper sólo barre `PENDING`, así que el bucle muere sin tocarlo.
- Test nuevo en `upload-ticket.test.ts`: ticket TEST → skip + upload SKIPPED + cero requests a Holded.

**Backfill para los PENDING existentes de tickets TEST (correr una vez en prod):**

```sql
UPDATE holded_uploads hu
SET status = 'SKIPPED',
    last_error = '{"skipped": "test_mode"}'::jsonb,
    updated_at = now()
FROM tickets t
WHERE t.external_id = hu.external_id
  AND hu.kind = 'TICKET'
  AND hu.status = 'PENDING'
  AND t.status = 'TEST';
```

Vía: `docker compose --env-file infra/.env.production -f infra/docker-compose.prod.yml exec postgres psql -U mipiacetpv -d mipiacetpv` y pegar el UPDATE. Verificación: el log del worker deja de mostrar `[upload-sweeper] pasada completada {rescued: N}` cada 5 min.

### 3.b Gate de salud >48h: de bloqueo a warning

Decisión de producto (Matías, 2026-06-11): **un problema de sync nunca cierra el negocio**.

- `shift/routes.ts`: el 409 `TENANT_BLOCKED` desaparece de la **apertura** y del **cierre**. Nota de implementación: el prompt sólo pedía explícitamente desbloquear la apertura para `no_api_key`, pero mantener bloqueado el cierre habría producido el absurdo "puedes abrir turno sin API key pero no cerrarlo" (recrearía el turno colgado del incidente) — se desbloquearon ambos y queda documentado aquí. El cierre con tickets sin sincronizar sigue protegido por el flujo existente `SYNC_PENDING` + `syncFailureAccepted` + PIN si hay `SYNC_FAILED`.
- `getTenantHealthStatus` NO cambia: sigue reportando `blocked` como nivel informativo (lo consumen los banners y el super-admin).
- **TPV** (`SalePage.HealthBanner`): banner rojo persistente sin lenguaje de bloqueo. `sync_stale`: "Sin conexión con Holded desde hace X h · Los tickets se guardan y se subirán solos…". `no_api_key` (más severo): "Holded desconectado · … avisa al propietario cuanto antes".
- **Admin "en grande"**: `GET /catalog/sync-status` ahora devuelve `health` (level/reason/edad), y `AdminShell` pinta un banner rojo a ancho completo (`role="alert"`, fondo rojo sólido) cuando `level=blocked`, con copy específico para `no_api_key`.
- Tests: 4 nuevos en `shift-close.test.ts` (apertura y cierre con >48h sin sync y sin API key → 200/201; antes 409).

### 3.c Copy del cierre normal

`CloseShiftModal` alineado con la pantalla de turno colgado (v1.5-hotfix2): el error de `SYNC_PENDING` y el checkbox de aceptación ahora dicen "Puedes cerrar el turno igualmente: las ventas no se ven afectadas y los tickets pendientes se recuperarán automáticamente." / "Lo entiendo, cerrar el turno igualmente…".

## Lote 4 · Conciliación diaria TPV ↔ Holded

- **Core** `apps/api/src/tickets/reconciliation.ts` (inyectable para tests):
  - `reconcileTenant`: tickets `SYNCED` de las últimas 48h con `holdedDocumentId` → `GET salesreceipt/{id}` (helper nuevo `getSalesreceipt` en holded-client) y comprueba: existe (404 → `missing`), total coincide con `tickets.total` (tolerancia 0.005 € — caza drifts de 1 céntimo como b30), pagado (`paymentsPending == 0`). Errores transitorios (5xx/red/429) → mismatch `fetch_error` sin abortar la pasada (la ventana de 48h hace que mañana se reintente). Throttle 200 ms entre GETs (mismo patrón que auto-sku, ~5 req/s).
  - `runDailyReconciliation`: itera tenants con actividad SYNCED reciente (los parados no gastan rate limit), persiste un `ReconciliationRun` por tenant, y si `mismatches > 0`: log level error + `captureAlert` Sentry (Lote 2) + email a `SUPER_ADMIN_FROM_EMAIL` con el resumen (mailer existente reutilizado, best-effort). Un tenant roto no aborta el resto.
- **Tabla** `reconciliation_runs` (migración aditiva `20260611010000_b32_reconciliation_runs`): tenantId, runAt, ticketsChecked, mismatches JSONB `[{ticket, internalNumber, holdedDocumentId, field, expected, actual}]`.
- **Job BullMQ** repeatable global (`queues/reconciliation.ts` + `workers/reconciliation-worker.ts`, registrado en `workers/index.ts`): cron `0 ${RECONCILIATION_HOUR} * * *` tz `Europe/Madrid`, default 07:00, hora configurable vía env `RECONCILIATION_HOUR` (0–23). jobId determinista — sin duplicados entre reinicios.
- **Endpoint** `GET /super-admin/tenants/:id/reconciliation?limit=N` (default 14, máx 100): últimos N runs con `mismatchCount`. **Sin UI todavía** — la pantalla en la consola super-admin va en otro bloque; este endpoint es el contrato estable para ella (mientras tanto: curl/devtools).
- **Tests** (`reconciliation.test.ts`, 8): mismatch de total detectado (el caso del céntimo, 4.69 vs 4.70), doc inexistente detectado, doc sin pagar detectado, fetch_error sin abortar, run limpio sin mismatches, run con mismatches persiste+emaila, run limpio persiste y NO alerta, pasada sin tenants no-op.

---

## Acciones manuales (Matías)

1. **Sentry**: crear cuenta/organización, un proyecto backend (Node) y uno frontend (React, puede ser el mismo si se prefiere). Poner el DSN backend en `infra/.env.production` (`SENTRY_DSN=...`) y el frontend como secret `VITE_SENTRY_DSN` del repo GitHub (Settings → Secrets → Actions). Sin esto, todo sigue funcionando en no-op.
2. **GHCR**: crear un Personal Access Token (classic) con scope `read:packages` y en el VPS correr `docker login ghcr.io -u matiasoyola` (password = token). Una sola vez.
3. **UptimeRobot** (o equivalente): monitor HTTP sobre `https://api.mipiacetpv.com/health` con alerta a email/Telegram. No es código — sólo recordatorio.
4. **Backfill 3.a**: correr el UPDATE de arriba en el Postgres de producción tras el deploy.
5. Primer deploy de este bloque: al ser el primero por registry, hay que hacer el push a master (CI publica), luego en el VPS el `docker login` (punto 2) y `bash infra/deploy.sh`.

## Decisiones / desviaciones

- **3.a → SKIPPED** (no DONE+lastError): semántica limpia a cambio de una migración aditiva de una línea (permitida por las reglas del bloque).
- **3.b → el cierre también se desbloquea con `no_api_key`** (el prompt sólo lo exigía para la apertura): evitar el estado incoherente "abre pero no cierra" que reproduce el turno colgado del incidente.
- `getSalesreceipt` añadido a `packages/holded-client` (re-uso del GET-back existente) — necesario para el Lote 4, sin dependencia nueva.
- Dependencias nuevas: **sólo** `@sentry/node` + `@sentry/react`.
- Migraciones: **sólo** las dos permitidas (3.a enum, Lote 4 tabla), ambas aditivas.
- No se tocó lógica de precios/decimales, ni SalePage más allá del copy del HealthBanner, ni CheckoutPage.
