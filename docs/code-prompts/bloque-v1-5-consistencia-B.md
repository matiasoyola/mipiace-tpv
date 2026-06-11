# Bloque v1.5-Consistencia-B · Observabilidad + deploy por registry + cabos del incidente 2026-06-11

**Rama:** `v1-5-consistencia-b` (worktree limpio desde master)
**Origen:** auditoría `docs/auditorias/2026-06-10-auditoria-tecnica-completa.md` + incidente Sole 2026-06-11 (4 hotfixes: ver log de commits `52bda98..c98ce9d`)
**Objetivo:** que el sistema avise ANTES que el cliente, que el deploy tenga rollback, y cerrar los efectos secundarios detectados en el incidente.
**Estimación:** 2-3 días Code.
**Entrega:** un único commit, sin merge. `pnpm test` 0 failed, CI verde en el push de la rama, `docs/blocks/v1-5-consistencia-B-done.md`.

---

## Lote 1 · Imágenes a GHCR + deploy por pull con rollback

Hoy cada deploy son ~140s de build en el VPS (1 vCPU). Pasamos a: CI construye y publica, el VPS solo hace pull.

1. Ampliar `.github/workflows/ci.yml`: tras el job de tests, job `publish` (solo en push a master) que construye las imágenes `api` y `static-publish` con buildx y las publica en GHCR como `ghcr.io/matiasoyola/mipiacetpv-api:<sha-corto>` + `:latest` (ídem static-publish). Login con `GITHUB_TOKEN` (permissions: packages write).
2. `infra/docker-compose.prod.yml`: las imágenes pasan a referenciar `ghcr.io/...:${IMAGE_TAG:-latest}`. Mantener los `build:` como override en un `docker-compose.build.yml` aparte para no perder la vía local.
3. Crear `infra/deploy.sh` (idempotente, ejecutable en el VPS): `git pull --ff-only` (para compose/Caddyfile) → `docker compose pull` → migraciones (`run --rm ... prisma migrate deploy`) → `up -d --force-recreate --no-deps api worker static-publish` → espera healthchecks → curl /health → resumen. Acepta `IMAGE_TAG=<sha>` para deploy de una versión concreta → **el rollback es `IMAGE_TAG=<sha-anterior> ./deploy.sh`**.
4. Documentar en `docs/deploy/hostinger.md`: flujo nuevo, cómo hacer rollback, y el `docker login ghcr.io` inicial del VPS (token lo crea Matías — anotar como acción manual).

**Criterio:** workflow válido; deploy.sh con `set -euo pipefail` y mensajes claros; nada del flujo viejo roto (build local sigue posible).

## Lote 2 · Sentry en API, worker y frontends (gated por env)

- `@sentry/node` en api+worker, `@sentry/react` en tpv-web+admin. TODO condicionado a `SENTRY_DSN` presente — sin DSN, no-op absoluto (los pilotos no deben notar nada si no está configurado).
- Engancharlo al error handler global existente (`apps/api/src/lib/error-handler.ts`) y al ErrorBoundary/unhandledrejection de v1.5-A (los ganchos ya están comentados como "gancho Sentry v1.5-B").
- Contexto: tenantId y requestId en API; release = sha del build (inyectar en CI/Vite).
- `SENTRY_DSN` a los `environment:` de compose y al `.env.production.example`.

## Lote 3 · Cabos del incidente

### 3.a Sweeper vs tickets TEST (bucle infinito)
El worker saltó el upload de tickets en modo prueba pero su `HoldedUpload` queda `PENDING` para siempre → el sweeper los re-rescata cada 5 min (visto en prod: `rescued: 26` en bucle). Fix: al detectar modo prueba, marcar el upload con status terminal (añadir `SKIPPED` al enum `HoldedUploadStatus` con migración, o usar DONE con `lastError: {skipped: 'test_mode'}` — elegir lo que menos toque y documentar). Backfill: script o SQL en el done.md para los PENDING de tickets TEST existentes.

### 3.b Gate de salud >48h: de bloqueo a warning
Decisión de producto (Matías, 2026-06-11): **un problema de sync nunca cierra el negocio**. En `apps/api/src/shift/routes.ts` (apertura ~l.90 y cierre ~l.436): el nivel `blocked` por `sync_stale` pasa a comportarse como warning (se abre/cierra turno, banner persistente en TPV "Sin conexión con Holded desde hace X — los tickets se guardan y se subirán solos"). `no_api_key` también deja de bloquear apertura (los tickets quedan PENDING y el sweeper los subirá al reconectar) pero el banner debe ser más severo y el admin debe mostrarlo en grande. Actualizar tests de shift correspondientes.

### 3.c Copy del cierre normal
Alinear `CloseShiftModal` con el copy de la pantalla de turno colgado (v1.5-hotfix2): "Puedes cerrar el turno igualmente: las ventas no se ven afectadas y los tickets pendientes se recuperarán automáticamente."

## Lote 4 · Conciliación diaria TPV ↔ Holded

El detector definitivo de todo lo monetario (el bug del céntimo lo encontró una clienta a ojo; esto lo habría encontrado un cron).

- Job BullMQ repetible diario (hora configurable, default 07:00 Europe/Madrid): para cada tenant con tickets SYNCED en las últimas 48h, GET de cada documento en Holded y comparar: existe, total coincide con `tickets.total`, y está pagado (paymentsPending == 0).
- Resultado en tabla nueva `reconciliation_runs` (migración): tenantId, fecha, ticketsChecked, mismatches JSON (ticket, campo, esperado, real). 
- Si mismatches > 0: log level error (alertable por Sentry del Lote 2) + email a `SUPER_ADMIN_FROM_EMAIL` con el resumen (reutilizar el mailer existente).
- Endpoint super-admin `GET /superadmin/tenants/:id/reconciliation` con los últimos N runs (sin UI todavía — la UI va en otro bloque; dejarlo documentado).
- Respetar rate limits de Holded (throttle como el resto del holded-client).

**Tests:** mismatch de total detectado; doc inexistente detectado; run limpio no alerta.

---

## Reglas del bloque

- NO tocar: lógica de precios/decimales, SalePage (más allá del copy si hiciera falta, que no debería), CheckoutPage (el outbox offline es el bloque C).
- Dependencias nuevas: solo los SDK de Sentry. Justificar cualquier otra en done.md.
- Migraciones: solo las del 3.a (si eliges SKIPPED) y Lote 4. Aditivas.
- Acciones manuales (Matías) van listadas en el done.md: crear proyecto Sentry y DSN, token GHCR + `docker login` en VPS, configurar UptimeRobot sobre `/health` (esto no es código, solo recordatorio).

## Definición de hecho

1. `pnpm test` 0 failed (incluye nuevos de 3.b, 3.a y Lote 4).
2. CI verde en el push de la rama (incluido el job publish en dry-run o condicionado a master).
3. `docs/blocks/v1-5-consistencia-B-done.md` con resumen por lote + acciones manuales + backfill del 3.a.
4. Un único commit: `v1.5-consistencia-B · GHCR+rollback + Sentry + conciliación diaria + cabos incidente 2026-06-11`.
