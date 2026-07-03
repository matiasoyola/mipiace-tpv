# Bloque v1.9.1 · Mantenimiento (4 micro-fixes de la semana)

**Rama:** `v1-9-1-mantenimiento` (worktree nuevo, NO sobre master directo)
**Origen:** hallazgos operativos de las sesiones 2026-07-02/03 (deploys v1.6-v1.9, restore drill, diagnóstico Thalía). Cuatro arreglos pequeños e independientes entre sí.

## ⚠️ Bloque paralelo en vuelo — frontera de coexistencia

`v1-8-fiado` corre en paralelo. **NO toques**: `apps/api/src/tickets/**`, `apps/api/src/shift/**`, `packages/escpos-builder/**`, `packages/ticket-pdf/**`, `apps/tpv-web/src/pages/CheckoutPage*`, schema de Ticket/TicketPayment/Tenant, ni crees migraciones. Si un fix parece necesitar algo de ahí, carryover al done.md.

## Frente 1 — Corepack sin prompt en deploys (infra)

Cada `docker compose run` con migraciones pregunta "Corepack is about to download… [Y/n]" y bloquea el deploy hasta un humano. Fix conocido: `ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0` en `infra/Dockerfile` (todas las stages que ejecuten pnpm). Verifica que no haya otro punto (deploy.sh) que lo necesite.

## Frente 2 — Cron de backup en bootstrap (infra)

El restore drill del 2026-07-02 destapó que `infra/backup-postgres.sh` existía pero el cron NUNCA se instaló en el VPS (se instaló a mano ese día). Fix permanente, mismo patrón que el `systemctl disable nginx`: `infra/bootstrap-hostinger.sh` debe instalar idempotentemente el crontab `0 4 * * * /opt/mipiacetpv/infra/backup-postgres.sh >> /var/log/mipiacetpv-backup.log 2>&1` (no duplicar la entrada si ya existe). Documenta en `docs/deploy/hostinger.md`.

## Frente 3 — Badge "Suscripción suspendida" en super-admin

Caso real: el Holded de Librería Thalia lleva suspendido (HTTP 402) un tiempo indeterminado y el super-admin mostraba "Holded: Conectado" — el health check valida credenciales pero no distingue 402. El cliente `HoldedSubscriptionSuspendedError` ya existe (v1.9 lo trata como clase aparte).

- El check de conexión del tenant (el que alimenta la columna HOLDED del listado y el detalle) debe distinguir tres estados: `CONNECTED` / `SUSPENDED` (402) / `ERROR`.
- UI super-admin: badge rojo "Suscripción suspendida" en listado y detalle, con copy accionable ("El cliente debe regularizar el pago en Holded — el sync está parado").
- Si el dato del último sync ya registra el 402 (stats/lastError), reúsalo en vez de añadir llamadas nuevas a Holded.

## Frente 4 — Copy del empty-state de búsqueda del TPV

Con búsqueda activa sin resultados, el TPV muestra "Aún no has cargado productos. Configúralos en Holded o sincroniza para verlos aquí" — mensaje de catálogo vacío, alarmante y falso. Distinguir: catálogo vacío de verdad → mensaje actual; búsqueda sin coincidencias → "Sin resultados para «<query>». Prueba con otro nombre o escanea el código." Archivo: donde viva ese empty state en `apps/tpv-web/src` (búscalo; probablemente SalePage o el grid de catálogo). NO toques `SalePage.lineSheet.tsx` ni `lib/cart.ts`.

## Cierre

- Tests de los frentes 3 y 4 (los de infra se validan en deploy). Suite verde + tsc limpio.
- `docs/blocks/v1-9-1-mantenimiento-done.md` breve.
- NO mergees ni despliegues — lo hace Matías.
