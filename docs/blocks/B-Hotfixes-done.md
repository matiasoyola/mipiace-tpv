# B-Hotfixes post-deploy · resumen

Estado: cerrado pendiente de revisión por Matías.

Mini-bloque autónomo (~½ día) que cierra los 5 hotfixes aplicados a
mano en el VPS Hostinger durante el primer despliegue productivo
(2026-05-18). Sin esto, cualquier despliegue nuevo desde cero
repetiría los mismos problemas.

Restricciones respetadas:
- No se ha modificado lógica de negocio. Sólo infra y env handling.
- No se rompe desarrollo local (HOST default sigue siendo `127.0.0.1`).
- No se introducen migraciones nuevas.
- No se ha desplegado nada — el deploy lo hace Matías manualmente.

## Los 5 fixes

### Fix 1 · `HOST` env var para Fastify

`apps/api/src/server.ts` tenía `host: "127.0.0.1"` hardcoded. En Docker
producción el servidor sólo escuchaba en su loopback → Caddy no le
llegaba. En el VPS se parcheó a `0.0.0.0`, pero eso rompería dev local
(expondría el API en la LAN).

Solución:
- `apps/api/src/env.ts` añade `HOST: z.string().default("127.0.0.1")`.
- `apps/api/src/server.ts` usa `env.HOST` en el listen.
- `infra/docker-compose.prod.yml` setea `HOST: 0.0.0.0` en el servicio
  `api` y, por simetría, en `worker`.

### Fix 2 · `SMTP_PORT` acepta string vacío

Docker Compose interpola `${SMTP_PORT}` como string vacío cuando la
var no está definida. Zod `.coerce.number().int().positive().optional()`
recibía `""`, lo coercia a `0`, y rechazaba por `.positive()` → API no
arrancaba. En el VPS se desbloqueó con un placeholder `SMTP_PORT=587`.

Solución:
- `apps/api/src/env.ts` envuelve `SMTP_PORT` en un `z.preprocess` que
  convierte `""` (o `undefined`) en `undefined` antes de la coerción.
  Es el único var numeric `optional()` actual; si aparecen más se
  aplica el mismo patrón.

### Fix 3 · Healthcheck `127.0.0.1` en vez de `localhost`

En Alpine, `wget` resolvía `localhost` por IPv6 (`::1`) primero.
Fastify escucha sólo en IPv4 (`0.0.0.0`). Connection refused en IPv6
→ healthcheck unhealthy → el worker no arrancaba (depends_on api
healthy).

Solución:
- `infra/docker-compose.prod.yml` cambia el healthcheck del servicio
  `api` para usar `http://127.0.0.1:3001/health`.

### Fix 4 · `.gitignore` no debe ignorar `.env.*.example`

El `.gitignore` raíz tenía `.env.*` con negate sólo para el archivo
exacto `.env.example`. `infra/.env.production.example` quedaba
ignorado → el bootstrap fallaba al hacer `cp` desde un repo recién
clonado.

Solución:
- `.gitignore` añade `!**/.env.example` y `!**/.env.*.example`.
- `infra/.env.production.example` se commitea (estaba untracked).

### Fix 5 · `bootstrap-hostinger.sh` libera puerto 80

El template Ubuntu 24.04 LTS de Hostinger viene con `nginx` system
pre-instalado y activo bindeando `0.0.0.0:80` → Caddy no arrancaba
(`address already in use`).

Solución:
- `infra/bootstrap-hostinger.sh` añade un bloque `1.5` después del
  check de Docker que para y deshabilita nginx system si está activo.
  Idempotente: si no hay nginx, no pasa nada.

## Bonus · `infra/Caddyfile` sincronizado con el VPS

Durante el deploy se editó el Caddyfile en el VPS para añadir
`handle_path /api/*` en `mipiacetpv.tech` y `admin.mipiacetpv.tech`
(las PWAs hacen fetch a paths relativos `/api/*` y necesitan ser
proxeadas al backend). Esta config queda ahora también en el repo.

## Tests

- `apps/api/test/env.test.ts` (nuevo): 6 tests cubriendo SMTP_PORT
  con `""`, `undefined`, valor numérico válido, valor `0` rechazado,
  HOST default `127.0.0.1`, HOST `0.0.0.0` respetado.
- Suite completa: **276/276 passing** (270 previos + 6 nuevos).
- Type-check de `apps/api` limpio.

## Próximo paso

Matías pushea y corre `bash infra/bootstrap-hostinger.sh` en el VPS.
Es idempotente y aplica los cambios sin tocar datos. Luego empezamos
B-OnboardingV2.
