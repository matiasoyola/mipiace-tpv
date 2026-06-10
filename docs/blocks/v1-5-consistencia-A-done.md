# v1.5-Consistencia-A · done

**Rama:** `v1-5-consistencia-a` · un único commit, sin merge.
**Estado final:** `pnpm test` → 71 files passed, 528 tests passed, 3 skipped (pre-existentes), **0 failed**. `tsc` limpio en api, tpv-web, admin y los 6 packages. `docker compose config` valida en dev y prod.

---

## Lote 1 · Suite 100% en verde

Los 16 fallos crónicos eran TODOS test-side (mocks/fixtures desfasados respecto a código de producto que evolucionó). Ningún bug de producto. Cero skips nuevos.

| Test | Causa raíz | Fix |
|---|---|---|
| `salesreceipt.test.ts` (2) | El pre-check idempotente de `registerPaymentWithGetBack` (v1.3-hotfix10) añadió un GET extra que los mocks no contemplaban | Respuesta de pre-check añadida a la cola de mocks |
| `upload-ticket.test.ts` (1) | Ídem (mismo pre-check) | Ídem |
| `pairing-route.test.ts` (3) | El claim atómico con `updateMany` (v1.3-hotfix11) no existía en el fake de Prisma; el revoke fallaba en cascada (deviceId `undefined`) | `updateMany` añadido al fake |
| `tpv-catalog-business-type.test.ts` (3) | La ruta lee `tagAlias.findMany` (v1.3-Operativa-Extra) y el fake no lo tenía | Mock `tagAlias` añadido |
| `dedupe-tags.test.ts` (2) | El fake `product.update` buscaba por clave del Map (`"p1"`) en vez de por campo `id` (UUID) | Búsqueda por campo `id` |
| `catalog-route.test.ts` (2) | `throttle()` usa `redis.incr/expire/ttl` y el fake sólo tenía `ping` | Fake Redis ampliado |
| `auto-sku.test.ts` (2) | `runAutoSku` filtra por `kind` desde v1.3-hotfix4 (pasadas PRODUCT/SERVICE separadas); el mock devolvía todo dos veces | Filtro `kind` en el mock |
| `image-cache-worker.test.ts` (1) | `opts.imageUrl ?? default` se comía el `null` explícito del test "sin imageUrl" | Distinguir `undefined` de `null` en la fixture |

Además, ~20 suites fallaban en este worktree por Prisma client sin generar (`pnpm --filter @mipiacetpv/db run generate` lo resuelve; el CI lo hace siempre).

**Skips existentes (no añadidos por este bloque):** `super-admin.test.ts` `describe.skip` del flow legacy de crear tenant (3 tests) — cobertura trasladada a `onboarding-v2.test.ts` desde B-OnboardingV2.

**Bonus:** los 3 ficheros de tests puros de `apps/tpv-web/test/` (cart-precision, contact-search-list, device-bootstrap-decision) estaban fuera del workspace de vitest y no corrían en `pnpm test`. Ahora corren (y pasan).

## Lote 2 · CI GitHub Actions

`.github/workflows/ci.yml`: push (todas las ramas) + PR. Un job secuencial:
checkout → pnpm 9.12.0 (vía `packageManager` del package.json, misma fuente que corepack en el Dockerfile) → Node 20 + cache de pnpm store → `pnpm install --frozen-lockfile` → prisma generate → typecheck api (`tsc --noEmit`) → typecheck de los 6 packages → typecheck frontends (`tsc -b`, igual que sus scripts de build) → `pnpm test` → builds Vite admin + tpv-web.

- **Sin `services:`**: la suite quedó 100% mockeada, no necesita Redis ni Postgres.
- **Sin publicación de imágenes Docker** (v1.5-B).
- Validación: YAML lint OK (`actionlint` no disponible en esta máquina); **todos los comandos del workflow ejecutados en local con éxito** exactamente como los correrá el runner.

## Lote 3 · Integridad transaccional

- **3.a** `ticketCounter` movido DENTRO de `prisma.$transaction` (`tx.register.update`) en los 3 sitios: POST /tickets, POST /tickets/:id/checkout y POST /refunds. Sin cambios de formato ni del unique `[registerId, internalNumber]`. Tests: fallo simulado dentro de la tx → el contador no avanza y el siguiente cobro usa el número no quemado (tickets y refunds).
- **3.b** Sweeper de `HoldedUpload` huérfanos (`apps/api/src/workers/upload-sweeper.ts`): `setInterval` de 5 min en el proceso de workers (opción "más simple y robusta" del prompt). Busca PENDING con `createdAt < now()-10min`, re-encola con el **mismo jobId determinista** del encolado normal (dedupe BullMQ); si encuentra un job zombi en estado terminal con la fila aún PENDING, lo elimina y re-encola. Cubre TICKET y REFUND (misma tabla, colas distintas). Log estructurado con `scanned/rescued/errors` cuando rescata algo (alertable en v1.5-B). 6 tests con fakes inyectables.
- **3.c** `alreadyRefunded` filtra por status. Criterio documentado en comentario en código (el enum es `TicketStatus`, compartido con Ticket):
  - **Cuentan**: `PENDING_SYNC`, `SYNCED`, `PAID` (el dinero salió de caja; la sync es asíncrona).
  - **No cuentan**: `SYNC_FAILED` (procedimiento operativo: anular y repetir la devolución — era lo que bloqueaba devoluciones legítimas), `VOIDED`, `DRAFT`, `TEST`.
  - Tests: SYNC_FAILED previo no bloquea; doble refund efectivo sigue rechazado; PENDING_SYNC parcial descuenta cupo.

## Lote 4 · Manejo de errores global

- **4.a** `apps/api/src/lib/error-handler.ts` + registro en `server.ts` (antes de todo plugin/ruta):
  - Validación ajv de Fastify y `ZodError` → 400 `VALIDATION_ERROR` con detalle por campo.
  - holded-client → 502 con código propio y mensaje en español: `HOLDED_RATE_LIMITED` (429), `HOLDED_SUBSCRIPTION_SUSPENDED` (402), `HOLDED_SYNC_ERROR` (silent reject), `HOLDED_UNAVAILABLE` (resto). Log con `tenantId`, URL de Holded y status.
  - 4xx ya tipados por plugins → se respetan.
  - Resto → 500 `INTERNAL_ERROR` con `requestId` en la respuesta; stack y mensaje interno SOLO en logs. 7 tests.
- **4.b** `ErrorBoundary` raíz en tpv-web y admin (pantalla en español + botón "Recargar") + `unhandledrejection` → consola estructurada en ambos (gancho Sentry para v1.5-B, sin integrar).
  - **El carrito NO sobrevivía a un remount** (era `useState` puro en SalePage). Añadido `usePersistedCartLines` (sessionStorage, clave por contexto mesa/venta-rápida para no filtrar líneas entre mesas). El cambio en `SalePage.tsx` es quirúrgico: 1 import + sustitución del `useState` de `lines` — ver "Tensiones con las reglas" abajo.
  - Tests de render con componente que lanza (tpv-web y admin) + persistencia/recuperación + storage corrupto.

## Lote 5 · Infra endurecida

1. **Rotación de logs**: anchor `x-logging` (json-file, 10m × 3) aplicado a todos los servicios de `docker-compose.prod.yml` y `docker-compose.yml`.
2. **Redis AOF**: prod ya lo tenía (`--appendonly yes` + volumen). Añadido a dev para paridad. BullMQ no necesita config extra (los datos de cola son estructuras Redis normales que AOF cubre).
3. **Healthcheck del worker**: `workers/heartbeat.ts` escribe `SET worker:heartbeat <ts> EX 120` cada 30 s; healthcheck del contenedor ejecuta `scripts/check-worker-heartbeat.ts` (tsx, conexión efímera, exit 1 si la key no existe). `start_period: 60s`.
4. **backup-postgres.sh**: `gzip -t` del dump (corrupto → borrar + exit 1 con mensaje), `sha256sum` junto al archivo (y se sube a B2 también), retry ×3 con sleep incremental (30/60/90 s) en la subida B2 (falla → exit 1). Retención intacta (+ purga de los `.sha256`).
5. **Dockerfile**: `USER node` en el stage `api` (worker hereda). `/var/cache/mipiacetpv/product-images` se crea en la imagen con ownership `node` para que el named volume lo herede al crearse.

`docker compose -f infra/docker-compose.prod.yml config` y el de dev validan sin errores. `bash -n` del backup OK.

## Acciones manuales en el VPS al deployar

1. **Volumen `product_images` existente**: se creó con ownership root. Con `USER node` el worker ya no podrá escribir. Tras el deploy:
   ```bash
   docker compose -f infra/docker-compose.prod.yml run --rm --user root worker chown -R node:node /var/cache/mipiacetpv/product-images
   ```
   (o `chown -R 1000:1000` sobre el mountpoint del volumen en el host).
2. **Redis AOF en prod**: ya estaba activo con volumen — sin acción.
3. **Backups**: el cron actual sirve tal cual; aparecerán ficheros `.sha256` junto a los dumps. Si `b2` CLI no está configurado, el comportamiento sigue siendo "solo local" salvo que ahora una subida fallida con bucket configurado devuelve exit 1 (visible en el log del cron).
4. **Worker healthcheck**: nada que hacer; tras `docker compose up -d` el worker pasará a `healthy` ~60 s después de arrancar.

## Tensiones con las reglas del bloque (decisiones tomadas)

- **`SalePage.tsx` ("no tocar") vs §4.b ("persistir el carrito como parte de este lote")**: mandato específico gana. Cambio mínimo (1 import + 1 sustitución de línea); toda la lógica vive en `lib/persistedCart.ts`. Cero cambios en el flujo de cobro.
- **`pnpm-lock.yaml` regenerado**: el lockfile de master estaba **desincronizado** con `apps/tpv-android/package.json` (faltaba el importer) → `pnpm install --frozen-lockfile` (paso 1 del CI) fallaba. Regenerado con `pnpm install`. No se tocó código de tpv-android.

## Dependencias nuevas (justificación)

- `jsdom@25` (devDep raíz): necesario para el test de render del ErrorBoundary que exige el §4.b (no había entorno DOM en la suite). Pinneado a 25 porque jsdom 27 es ESM-only e incompatible con vitest 2. `ioredis-mock` (preautorizado) al final **no hizo falta** — todo quedó mockeado con fakes inyectables.
- `@types/node@^20` (devDep de `ticket-model`): su tsconfig declara `types: ["node"]` pero la dependencia faltaba — `tsc --noEmit` standalone fallaba (nadie lo había typecheckeado fuera del contexto del api). Necesario para el paso de typecheck del CI.

## Hallazgos fuera de alcance (no arreglados)

1. **Lockfile de master roto para CI** (ya corregido aquí, pero el proceso que lo dejó así — añadir tpv-android sin `pnpm install` — puede repetirse; el CI nuevo lo cazará).
2. **Refund SYNC_FAILED y doble devolución**: con el criterio §3.c, si un refund SYNC_FAILED se reintentara más tarde con éxito (en vez de anularse), podría coexistir con una segunda devolución de las mismas líneas. Hoy no hay flujo de reintento de refunds fallidos en UI, así que el riesgo es teórico — pero si v1.5-B añade "reintentar refund", debe validar cupo otra vez en ese momento.
3. **`docker-compose.prod.yml` line 31 del backup**: `pg_dump -U mipiacetpv -d mipiacetpv` hardcodea usuario/BD en vez de leer `$POSTGRES_USER/$POSTGRES_DB` del env-file (funciona porque coinciden, pero es frágil).
4. **`tpv-android` sigue fuera del CI** (sin typecheck ni build) — consistente con la regla de no tocarlo.
5. **El healthcheck del worker arranca un proceso tsx cada 30 s** (~300 ms de CPU en el VPS). Aceptable hoy; si molesta, v1.5-B puede sustituirlo por un fichero-heartbeat local + `test -f` (más barato pero no verifica Redis).
6. **`registerAllExistingRepeatables` corre en server.ts Y en workers/index.ts** — en dev embedded se registra dos veces (idempotente por jobId, pero ruido).

## Tests skipeados por este bloque

Ninguno.
