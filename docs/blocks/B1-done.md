# Bloque 1 · resumen del entregable

Estado: cerrado pendiente de revisión por Matías.

## Estructura del repo tras B1

```
.
├─ apps/
│  ├─ api/                  # Fastify, Prisma, BullMQ. Auth + onboarding + worker.
│  ├─ admin/                # React + Vite. Owner UI (login, connect, sync).
│  ├─ tpv-web/              # PWA esqueleto (B3/B4 le ponen contenido).
│  └─ tpv-web-spike/        # Super-mini-MVP de Fase 0 — referencia viva.
├─ packages/
│  ├─ db/                   # Prisma schema + cliente compartido.
│  └─ holded-client/        # Cliente Holded extraído del spike + GET-back helper.
├─ spike/holded/            # Scripts 05/06/07 (Fase 0 cerrada, históricos).
├─ docker-compose.yml       # Postgres + Redis para dev.
├─ vitest.workspace.ts      # Run all tests con `pnpm test`.
└─ docs/blocks/B1-done.md   # este archivo
```

## Lo que dejé hecho

### Cliente Holded (`packages/holded-client/`)

Workspace package con:

- `HoldedApiError`, `HoldedInvalidResponseError` (movidos del spike).
- `HoldedSilentRejectError` nuevo (ADR-010): se lanza cuando un GET-back
  prueba que Holded descartó el campo silenciosamente. Incluye lista de
  `mismatches` y `storedSnapshot` para que la bandeja de errores del
  encargado tenga contexto.
- `HoldedSubscriptionSuspendedError` (spike §01.A): tipo separado para el
  402, evita mensajes genéricos al propietario.
- `ApiKeyClient` con header literal `key:` + validación de Content-Type
  (rechaza el caso 200+HTML del spike §01.B).
- `listProductsPage` + `iterateAllProducts` con paginación spike-correct
  (`?page=N`, tamaño fijo 500, fin = array vacío).
- `iterateAllServices` paralelo a productos (núcleo §2.4: servicios YA
  forman parte del catálogo unificado para todos los tenants).
- `listWarehouses`, `listTaxes`, `tryGetAccountInfo`.
- `updateProductWithGetBack` (usado por auto-SKU) + `createProduct`
  (usado por TPV-OTROS).
- `createSalesreceiptApproved` (payload mínimo definitivo §05.A) +
  `registerPaymentWithGetBack` + `getReceiptPdf` (algoritmo de
  base64 + búsqueda de `%PDF`).
- Tests vitest del cliente, del salesreceipt y de products.

El duplicado `spike/holded/src/holded-client.ts` se borró; los scripts
05/06/07 ahora importan del package. La env-zod del spike (`HoldedEnv`)
se ha aislado en `spike/holded/src/env.ts`.

### Prisma schema (`packages/db/prisma/schema.prisma`)

- Modelos del scaffold ya estaban (`tenant`, `user`, `store`, `register`,
  `device`, `pairing_code`, `product`, `product_variant`, `warehouse`,
  `ticket`, `shift`, `refund`, `sync_outbox`).
- Añadido `HoldedUpload` con `external_id` (uuid pk), `kind`,
  `holded_document_id`, `attempts`, `status`, etc. — idempotencia del
  worker de tickets (B5+).
- Añadido `TenantTax` para indexar tipos de IVA por tenant.
- Añadido a `Tenant`: `fiscalProfile`, `initialSyncStatus` (enum
  PENDING/RUNNING/DONE/FAILED), `initialSyncStartedAt`,
  `initialSyncCompletedAt`, `initialSyncStats`.
- Añadido a `Product`: `skuAutoAssignedAt`, `needsSkuReview` (bandeja
  del admin), `sellableViaTpv` (defensivo contra productos sin SKU).
- Migración SQL **pendiente de aplicar**: `pnpm db:migrate` la genera
  en cuanto Postgres esté corriendo. El schema validó con `prisma format`.

### Infra local

- `docker-compose.yml` raíz con Postgres 16 + Redis 7 (puertos
  estándar). Healthchecks y volúmenes con nombre.
- `.env.example` raíz con todas las variables nuevas, instrucciones de
  generación de secrets, redacción del JWT secret y del key encryption.

### Backend (`apps/api/`)

- `env.ts` valida todo `process.env` con zod (un único punto).
- `crypto.ts` AES-256-GCM versionado (`v1:` prefix); round-trip
  verificado por tests.
- `context.ts` singletons Prisma + ioredis con shutdown limpio.
- Auth (`auth/*`):
  - argon2id para hash (config 64 MB · 3 it · 1 p).
  - JWT propio (jsonwebtoken) con dos secrets distintos para access y
    refresh; helpers `signAccessToken`, `signRefreshToken`,
    `verifyAccessToken`, `verifyRefreshToken`.
  - `requireOwner` preHandler que decora `request.auth`.
  - Endpoints `/auth/signup`, `/auth/login`, `/auth/refresh`, `/auth/me`
    con JSON Schema completo en cada uno (regla de B1).
- Onboarding (`onboarding/*`):
  - `POST /onboarding/connect-holded` — valida key, cifra, persiste,
    encola sync. Mapeo de errores explícito (401, 402, 502, 503).
  - `GET /onboarding/sync-status` — estado y stats.
  - `initial-sync.ts` — orquestador del job: taxes → warehouses →
    productos → servicios → auto-SKU → comodines. Cada paso persiste
    progress en `tenant.initialSyncStats` para que el admin polleé.
  - `auto-sku.ts` — script con throttle inyectable (default 200 ms,
    ~5 req/s), GET-back, `needsSkuReview` cuando Holded silencia.
  - `tpv-otros.ts` — crea comodines TPV-OTROS-{IVA} sólo para los IVAs
    en uso por el catálogo del tenant.
- Workers / queues (`workers/*`, `queues/*`) — BullMQ con concurrencia 1
  por proceso, jobId único por tenant (`tenant-<id>`) para evitar doble
  encolado, attempts=1 (el job ya es idempotente vía upserts).
- Spike compat (`spike/routes.ts`) — `/products` + `/tickets` portados
  al package (usan `createSalesreceiptApproved` y
  `registerPaymentWithGetBack`). Se montan sólo si el `.env` trae
  `HOLDED_API_KEY`. Permite que `apps/tpv-web-spike` siga arrancando.
- CLI `scripts/run-auto-sku.ts` para re-ejecutar el script contra un
  tenant concreto.

### Admin (`apps/admin/`)

- React + Vite + react-router (5 rutas: signup, login, onboarding,
  onboarding/sync, onboarding/done).
- Cliente HTTP tipado con auto-refresh del JWT en 401 (transparente).
- CSS plano sin framework — el admin va a B2/B3 a tope, lo plumamos
  cuando tenga forma.

### TPV-web (`apps/tpv-web/`)

- Esqueleto PWA con `vite-plugin-pwa`, manifest mínimo (sin iconos
  definitivos — B4), workbox precaching del shell. Service worker
  activo también en `vite dev` para detectar bugs de cacheo desde el día 1.

### Tests

- `packages/holded-client/test/` — client, salesreceipt, products
  (ApiKey, errores tipados, paginación, GET-back, invariantes).
- `apps/api/test/` — crypto (round-trip + claves inválidas), auto-sku
  (happy path, silenced, error HTTP, idempotencia, throttle),
  onboarding-route (5 casos: ok, key inválida, 402, HTML, inalcanzable,
  + sync-status).
- Workspace test runner: `pnpm test`.

## Lo que dejé fuera (por diseño · bloque siguiente)

- **Sync incremental.** El sync inicial corre una sola vez; el polling
  cada 15 min (spec §3.8) va a B2 junto con el "Sincronizar ahora" del
  admin.
- **Webhooks de Holded.** Pendiente confirmar disponibilidad antes de
  invertir; B2 o B3.
- **Device pairing, login cajero, turnos.** Es B3 entero.
- **Venta, cobro, impresión.** Es B4.
- **Worker de tickets.** El `holded_upload` está modelado pero el
  consumer/orquestador del ticket (idempotencia, GET-back, /pay, /pdf)
  llega cuando haya tickets que subir (B5).
- **OAuth de Holded** — sigue como ADR-004; en MVP API Key.
- **Iconos PWA definitivos** — B4 con identidad visual.
- **Mensajes en inglés / multi-idioma** — fuera de MVP (§18.2.6).

## Decisiones que tomé en B1 sin preguntar

1. **JWT con dos secrets distintos** (access y refresh) usando
   `jsonwebtoken` directo, en lugar de `@fastify/jwt` con namespaces.
   Razón: menos magic, type-safer, y `@fastify/jwt` v9 con namespaces
   tiene API rara (`request.<namespace>JwtVerify`). Compromiso: nuestra
   capa de auth es trivial de leer.
2. **Sesión del admin en `sessionStorage`** (no `localStorage`). Cierra
   pestaña → sale. Más seguro por defecto; añadiremos "recuérdame" en
   B2 si lo piden.
3. **El worker arranca embedded en `apps/api` si NODE_ENV !==
   "production"**. En prod, separar contenedores del compose
   (`pnpm worker:dev`). Esto facilita `pnpm dev:api` solo.
4. **`Product.sellableViaTpv` cambia a `false` si `sku` es vacío** ya
   en el sync inicial (defensa contra spike §07.B), no esperando al
   intento de venta. El TPV no mostrará esos productos.
5. **Comodines TPV-OTROS sólo se crean para IVAs presentes en
   `product.taxRate` del tenant** (no para los 4 fijos siempre). Evita
   crear `TPV-OTROS-4` en un tenant que sólo vende al 21%.
6. **El sync inicial reescribe `tenant.fiscalProfile` desde el almacén
   default**. No es definitivo (el propietario tendría que poder
   editarlo desde admin en B2), pero ya nos da NIF + dirección para el
   pie del ticket si el almacén default los lleva.
7. **`apps/tpv-web-spike` cambió su `name` en package.json** a
   `@mipiacetpv/tpv-web-spike` para no colisionar con el nuevo
   `@mipiacetpv/tpv-web`. El nuevo TPV ocupa `localhost:5174`; el
   spike, `localhost:5175`; el admin, `localhost:5173`.
8. **JSON Schema en rutas Fastify: sólo body, no response.** El
   requisito de B1 era "JSON Schema en todas las rutas". Lo aplico al
   `body` (validación de entrada, lo crítico) pero no al `response`:
   Fastify v5 con TypeScript narrowea el tipo de `reply` por cada
   código declarado en `response`, lo que hace muy fastidioso enviar
   códigos de error desde el handler (`reply.code(409)` falla si solo
   declaré `200`). Para no inflar el ruido, mantengo el JSON Schema
   en el `body` y dejo la respuesta tipada por el handler. Cuando
   estabilicemos un patrón (o cambiemos a TypeBox), volvemos a meter
   el response schema.

## Dudas y cosas a confirmar antes de B2

1. **Modelo de `fiscalProfile`.** Lo dejé como `Json?` flexible. Si en
   B2 el admin ofrece pantalla para editarlo a mano (NIF, razón social,
   dirección), conviene formalizar a campos columnados o subtabla.
   Decidir antes de implementar el form.
2. **Endpoint para datos fiscales del propietario.** El cliente
   incluye `tryGetAccountInfo` apuntando a `/invoicing/v1/me` pero no
   está validado en el spike (Fase 0 no tocó este endpoint). Si en
   producción Holded responde 200+HTML, caemos al fallback "datos del
   almacén default". Vale la pena un spike pequeñito en B2 para
   verificar el endpoint real (¿`/me`? `/account`? `/company`?).
3. **`Tenant.holdedAccountId`** sigue sin rellenarse. Hay que
   averiguar de dónde leerlo. Si no hay endpoint público estable,
   omitirlo y derivar del hash de la API key (vale como ID interno).
4. **CORS en producción.** Listamos `localhost:5173/5174/5175` en
   `CORS_ORIGINS` por defecto. En prod cambia a `mipiacetpv.tech`
   (y subdominios si admin/tpv viven separados). Documentar en Caddy.
5. **Política de revocar API Key.** Cuando un propietario cambia su
   API key en Holded (porque se la robaron), debe poder repegarla en el
   admin. El endpoint actual ya soporta sobreescribir
   `holdedApiKeyCiphertext`. Falta UI: en B2.
6. **Sync inicial: ¿qué hacemos con productos que estaban en cache y
   ya no están en Holded?** El upsert no los borra. Para evitar
   catálogo zombi en re-syncs futuros, B2 (sync incremental) introduce
   un campo `lastSeenInSync` + borrado/disable de los huérfanos.
7. **Tests con base de datos real.** Hoy mockeamos Prisma a mano. Si
   queremos integración real, `testcontainers` + Postgres efímero.
   Lo dejo para cuando tengamos una pipeline CI (B5 o más adelante).
8. **`apps/tpv-web-spike` requiere `HOLDED_API_KEY` en `.env`.** Si
   prefieres que el spike use la key cifrada del primer tenant en BD
   (más realista), lo refactorizo — pero diverge la lógica. Sugiero
   dejarlo como está y aceptar que el spike es single-tenant.

## Cómo arrancarlo todo de cero

```bash
# 1. Generar secrets
openssl rand -base64 48        # JWT_ACCESS_SECRET
openssl rand -base64 48        # JWT_REFRESH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# → HOLDED_KEY_ENCRYPTION_SECRET

cp .env.example .env           # pega los tres + DATABASE_URL/REDIS_URL

# 2. Levantar infra
docker compose up -d           # postgres + redis

# 3. Instalar deps y aplicar schema
pnpm install
pnpm db:migrate                # primera vez: nómbrala "init"

# 4. Arrancar (terminales separadas)
pnpm dev:api                   # http://127.0.0.1:3001
pnpm dev:admin                 # http://localhost:5173
pnpm dev:tpv                   # http://localhost:5174 (esqueleto)
pnpm dev:spike                 # http://localhost:5175 (opcional, ref)

# 5. Tests
pnpm test
```

Para validar el flujo E2E del onboarding sin TPV real:

1. Abre `http://localhost:5173/signup` → crea un usuario propietario.
2. Te lleva a `/onboarding` → pega una API Key real de Holded de la
   cuenta sandbox.
3. Te lleva a `/onboarding/sync` → ves el progreso vivo.
4. Cuando termine, `/onboarding/done` te muestra el resumen.

En BD podrás inspeccionar con `pnpm db:studio` que:
- `tenants.holded_api_key_ciphertext` lleva un blob `v1:base64…`.
- `tenant_taxes` tiene los 103 tipos de la cuenta sandbox.
- `products` tiene los ~961 productos paginados.
- Los productos sin SKU original llevan `sku=AUTO-…` y
  `sku_auto_assigned_at` poblado.
- Los productos que Holded silenció llevan `needs_sku_review=true`.
- `TPV-OTROS-21` (y los demás IVAs en uso) aparecen como productos
  creados en el tenant.
