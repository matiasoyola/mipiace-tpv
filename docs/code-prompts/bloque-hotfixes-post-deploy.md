# Prompt para Claude Code — B-Hotfixes post-deploy

Mini-bloque autónomo (~½ día). Cierra los 5 hotfixes que tuvimos que
aplicar a mano en el VPS durante el primer despliegue productivo a
Hostinger (2026-05-18). Sin esto, cualquier despliegue nuevo desde
cero repetiría los mismos problemas.

Pega esto en una sesión de Claude Code tras commiteo (HEAD actual en
master tiene los commits B-Print fase 1, B-SuperAdmin, Infra Hostinger,
y el despliegue ya está en producción en VPS 3 Hostinger
`srv1582207.hstgr.cloud` / `76.13.142.28`).

---

Hola Code. Mini-bloque de 5 hotfixes que se aplicaron a mano en el
VPS durante el primer despliegue productivo. Hay que portarlos al
repo para que cualquier despliegue nuevo desde cero salga limpio.

## Contexto

El despliegue productivo del 2026-05-18 fue exitoso (stack arriba en
`mipiacetpv.tech`, `admin.mipiacetpv.tech`, `api.mipiacetpv.tech` con
SSL Let's Encrypt automático). Durante el proceso aparecieron 5
fricciones que se resolvieron en el VPS pero NO se commitearon al
repo. Este bloque las commitea.

Lee primero:
- `docs/deploy/hostinger.md` — manual de despliegue actual.
- `apps/api/src/env.ts` — donde están las env vars Zod.
- `apps/api/src/server.ts` línea ~163 — donde el listen está hardcoded.
- `infra/docker-compose.prod.yml` — la versión en repo.
- `infra/Caddyfile` — la versión en repo (no tiene los handle_path /api/* que sí están en el VPS).
- `infra/bootstrap-hostinger.sh` — el script de bootstrap.

## Alcance · 5 fixes

### Fix 1 · `HOST` env var para que Fastify escuche en 0.0.0.0 en prod

**Problema:** `apps/api/src/server.ts` tiene
`host: "127.0.0.1"` hardcoded. En producción Docker, el servidor
solo escucha en su loopback → Caddy no lo alcanza. En el VPS lo
parcheamos a `host: "0.0.0.0"`, pero esto rompería desarrollo local
(expondría el API en LAN).

**Fix:**

`apps/api/src/env.ts`: añadir variable `HOST` con default
`127.0.0.1`:

```ts
HOST: z.string().default("127.0.0.1"),
```

`apps/api/src/server.ts`: cambiar la línea del listen a:

```ts
await app.listen({ port: env.PORT, host: env.HOST });
```

`infra/docker-compose.prod.yml`: añadir `HOST: 0.0.0.0` a las env
del servicio `api` Y del servicio `worker` (el worker no llama
listen pero por consistencia env). El worker no abre HTTP pero
algunos jobs podrían — futuro proof.

### Fix 2 · `SMTP_PORT` acepta string vacío

**Problema:** Docker Compose pasa `${SMTP_PORT}` como string vacío
cuando la var no está definida. Zod `.coerce.number().int().positive().optional()`
recibe `""`, lo coercia a `0`, y rechaza por `.positive()` →
API no arranca. Tuvimos que poner placeholder `SMTP_PORT=587` para
desbloquear.

**Fix:**

`apps/api/src/env.ts`: envolver `SMTP_PORT` (y por simetría todos
los `SMTP_*` numéricos opcionales si los hubiera) en un preprocess
que convierte string vacío en `undefined`:

```ts
SMTP_PORT: z.preprocess(
  (v) => (v === "" || v === undefined ? undefined : v),
  z.coerce.number().int().positive().optional(),
),
```

Verificar si hay otras vars `optional()` numéricas con el mismo
patrón y aplicar el preprocess también si las hay.

### Fix 3 · Healthcheck con `127.0.0.1` en vez de `localhost`

**Problema:** En Alpine, wget resuelve `localhost` por IPv6 (`::1`)
primero. Fastify escucha solo en IPv4 (0.0.0.0). Connection refused
en IPv6 → healthcheck unhealthy → worker no arranca.

**Fix:**

`infra/docker-compose.prod.yml`: en el healthcheck del servicio
`api`, cambiar:

```yaml
test: ["CMD", "wget", "-q", "--spider", "http://localhost:3001/health"]
```

a:

```yaml
test: ["CMD", "wget", "-q", "--spider", "http://127.0.0.1:3001/health"]
```

### Fix 4 · `.gitignore` no debe ignorar `.env.production.example`

**Problema:** El `.gitignore` raíz tiene `.env.*` con negate
`!.env.example`, pero el negate solo cubre el archivo exacto
`.env.example`. Nuestro `infra/.env.production.example` está en el
patrón `.env.*` y queda ignorado → el bootstrap script no lo
encuentra al hacer `cp` y falla.

**Fix:**

`.gitignore` raíz: añadir negate explícito para todos los
`.env.*.example`:

```
.env
.env.*
!.env.example
!**/.env.example
!**/.env.*.example
```

Luego `git add -f infra/.env.production.example` (ya está creado
en el sandbox pero untracked) y commitear como parte de este bloque.

### Fix 5 · `bootstrap-hostinger.sh` libera puerto 80 si nginx system está corriendo

**Problema:** El template Ubuntu 24.04 LTS de Hostinger viene con
nginx pre-instalado y activo bindeando 0.0.0.0:80 → Caddy no
puede arrancar (`address already in use`).

**Fix:**

`infra/bootstrap-hostinger.sh`: añadir bloque al inicio (después
del check de Docker, antes del clone) que para y deshabilita
nginx system si está corriendo:

```bash
# ─── 1.5. Liberar puerto 80 si hay nginx system corriendo ────────
if systemctl is-active --quiet nginx 2>/dev/null; then
  warn "nginx system activo en puerto 80, parando para que Caddy pueda usarlo…"
  systemctl stop nginx
  systemctl disable nginx
  log "nginx system parado y deshabilitado."
fi
```

Idempotente: si no hay nginx, no pasa nada.

## Bonus · sincronizar `infra/Caddyfile` con la versión del VPS

Durante el deploy se editó el Caddyfile en el VPS para añadir
`handle_path /api/*` en los dominios `mipiacetpv.tech` y
`admin.mipiacetpv.tech` (porque las PWAs hacen fetch a paths
relativos `/api/*` y necesitan ser proxeadas al backend). Esta
config debe quedar también en el repo.

El Caddyfile final que está en el VPS es (referencia):

```
{
  email {$CADDY_ACME_EMAIL}
  log {
    output stdout
    format json
    level INFO
  }
}

mipiacetpv.tech, www.mipiacetpv.tech {
  handle_path /api/* {
    reverse_proxy api:3001
  }
  handle {
    root * /srv/tpv
    encode gzip zstd
    try_files {path} /index.html
    file_server
    @sw path /sw.js /service-worker.js /workbox-*.js
    header @sw Cache-Control "no-cache, no-store, must-revalidate"
    @assets path /assets/*
    header @assets Cache-Control "public, max-age=31536000, immutable"
    header {
      Strict-Transport-Security "max-age=31536000; includeSubDomains"
      X-Content-Type-Options "nosniff"
      X-Frame-Options "DENY"
      Referrer-Policy "strict-origin-when-cross-origin"
    }
  }
}

admin.mipiacetpv.tech {
  handle_path /api/* {
    reverse_proxy api:3001
  }
  handle {
    root * /srv/admin
    encode gzip zstd
    try_files {path} /index.html
    file_server
    @assets path /assets/*
    header @assets Cache-Control "public, max-age=31536000, immutable"
    header {
      Strict-Transport-Security "max-age=31536000; includeSubDomains"
      X-Content-Type-Options "nosniff"
      X-Frame-Options "DENY"
      Referrer-Policy "strict-origin-when-cross-origin"
    }
  }
}

api.mipiacetpv.tech {
  encode gzip zstd
  reverse_proxy api:3001
  header {
    Strict-Transport-Security "max-age=31536000; includeSubDomains"
    X-Content-Type-Options "nosniff"
  }
}
```

Aplica este Caddyfile al repo en `infra/Caddyfile`. Verifica
sintaxis con `caddy validate` si tienes la binary local (opcional).

## Tests

- `apps/api/test/env.test.ts` (si no existe, crearlo): test que
  con `SMTP_PORT=""` la API arranca y `env.SMTP_PORT === undefined`.
  Test que con `HOST` no definido el default es `127.0.0.1`.
- Type-check todos los apps. Test suite completa pasa (270/270 actual).

## Restricciones

- **NO** modificar lógica de negocio. Solo infra y env handling.
- **NO** romper desarrollo local (HOST default sigue 127.0.0.1).
- **NO** introducir migraciones nuevas (es bloque infra, no DB).
- **NO** desplegar a producción tú — el deploy lo hace Matías
  manualmente vía `git pull && bootstrap` cuando él decida.

## Entregables

1. PR único con los 5 fixes + sync Caddyfile + bonus.
2. Commit message descriptivo siguiendo el patrón del repo.
3. `docs/blocks/B-Hotfixes-done.md` con resumen breve (no hace
   falta el formato completo de los bloques grandes — basta una
   lista de los 5 fixes y la razón).
4. Tests verdes.

## Lo que NO entra

- B-OnboardingV2 (estados DRAFT/READY/ACTIVE, refactor permisos
  OWNER, etc.) → bloque dedicado posterior.
- Refactor de la auth o roles → no aplica.
- Nuevas features → no.

Cuando este bloque cierre, Matías pushea y hace `bash
infra/bootstrap-hostinger.sh` en el VPS — debería ser idempotente
y aplicar los cambios sin tocar nada de los datos. Luego empezamos
B-OnboardingV2.
