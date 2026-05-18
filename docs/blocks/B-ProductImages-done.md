# Bloque B-ProductImages · resumen del entregable

Estado: cerrado pendiente de revisión por Matías.

Mini-bloque acotado (~1 día) que añade imagen de producto al TPV. Hasta
B-OnboardingV2 los tiles del catálogo en `SalePage` mostraban sólo
nombre + precio + SKU; visualmente plano y lento para identificar
productos en bar/retail. Ahora el TPV pinta la imagen que Holded
expone en su API, cacheada localmente en el VPS para velocidad
("el TPV tiene que ir como un tiro" — Matías).

Fuera de B-ProductImages (como acordado en el prompt):
- Editar imagen de producto desde el TPV (Holded sigue siendo la fuente).
- Compresión / optimización agresiva (sharp / imagemin) — posterior si
  el storage pesa.
- Soporte de múltiples imágenes por producto (galerías Holded). Usamos
  `mainImage` por ahora; el helper `extractImageUrl` está preparado
  para añadir variantes sin migración.
- CDN externo (Cloudflare R2, etc.). Cache local en VPS basta para los
  5 primeros pilotos.

## Estructura del repo tras B-ProductImages

```
.
├─ apps/api/src/
│  ├─ catalog/incremental-sync.ts          # ~ persiste imageUrl, detecta cambio, encola worker
│  ├─ env.ts                                # + PRODUCT_IMAGE_CACHE_DIR + PRODUCT_IMAGE_MAX_BYTES
│  ├─ onboarding/initial-sync.ts           # ~ persiste imageUrl + encola tras sync
│  ├─ queues/product-image-cache.ts        # + cola BullMQ + enqueueProductImageCache helper
│  ├─ tpv-catalog/routes.ts                # ~ devuelve imageMime + tenantId al TPV
│  └─ workers/
│     ├─ image-cache-worker.ts             # + worker BullMQ + processImageCacheJob pure
│     └─ index.ts                          # ~ arranca el nuevo worker
├─ apps/tpv-web/
│  ├─ src/lib/catalog.ts                   # ~ CatalogProduct con imageMime + helpers URL
│  ├─ src/pages/SalePage.tsx               # ~ tile renderiza <img> o placeholder
│  └─ vite.config.ts                       # ~ workbox StaleWhileRevalidate /product-images/*
├─ infra/
│  ├─ Caddyfile                            # ~ handle_path /product-images/* (TPV + admin)
│  └─ docker-compose.prod.yml              # ~ volumen product_images compartido api/worker/caddy
├─ packages/
│  ├─ db/prisma/
│  │  ├─ schema.prisma                     # ~ Product.imageUrl + imageMime + imageCachedAt
│  │  └─ migrations/
│  │     └─ 20260518100000_b11_product_image_url/   # + 3 columnas TEXT/TIMESTAMPTZ nullable
│  └─ holded-client/src/
│     ├─ index.ts                          # ~ re-exporta extractImageUrl
│     └─ products.ts                       # ~ HoldedProduct con campos imagen + extractImageUrl
├─ spike/holded/src/
│  └─ 13-product-image.ts                  # + script spike §13
└─ docs/
   ├─ blocks/B-ProductImages-done.md       # este archivo
   └─ spike-holded.md                      # ~ + §13 (plan + reglas defensivas)
```

## Lo que dejé hecho

### Mini-spike §13 — investigación del campo de imagen

`spike/holded/src/13-product-image.ts` (script idempotente, no-destructivo):

1. `GET /invoicing/v1/products?page=1`, escanea 8 productos buscando
   los campos candidatos (`mainImage`, `mainImageUrl`, `image`,
   `imageUrl`, `thumbnail`, `thumbnailUrl`, `photo`, `photoUrl`,
   `pictures[]`, `images[]`, `media`). El primero con URL extraíble
   gana.
2. Si el listado omite URL (Holded recorta campos pesados en
   colecciones), reintenta sobre `GET /invoicing/v1/products/<id>`.
3. Sondea la URL con y sin header `key:` para decidir si exige auth.
4. Sondea `GET /invoicing/v1/products/<id>/image` por si Holded
   expone endpoint dedicado.
5. Persiste `fixtures/13-products-sample.json`, `13-image-headers.json`
   y `13-summary.json` con recomendación final.

Documentado en `docs/spike-holded.md` §13 con plan (§13.A) y reglas
defensivas (§13.B). §13.C queda **pendiente de poblar tras correr el
sondeo contra la cuenta sandbox del primer piloto** — el script está
listo, la integración asume el campo `mainImage` (más estándar en la
doc de Holded) y `extractImageUrl` lo extrae con fallback a `image`,
`thumbnail`, `pictures[]`, `images[]` en ese orden.

### Frente 1 · Schema Product.imageUrl + migración

`packages/db/prisma/schema.prisma`:

- Tres columnas nullable en `Product`:
  - `imageUrl` — URL canónica desde Holded.
  - `imageMime` — `image/jpeg|png|webp` una vez el worker descargó
    válidamente. Es el gate del TPV.
  - `imageCachedAt` — momento de la última descarga válida. NULL =
    pendiente.

Migración `20260518100000_b11_product_image_url`: tres `ALTER TABLE`
aditivos, **sin backfill**. Las columnas nacen NULL; el siguiente sync
rellena `imageUrl`, el worker rellena `imageMime` + `imageCachedAt`.

### Frente 2 · Persistir imageUrl en sync

`packages/holded-client/src/products.ts`:

- `HoldedProduct` declara campos opcionales (`mainImage`, `image`,
  `thumbnail`, `pictures[]`, `images[]`).
- `extractImageUrl(raw)`: prioridad fija, normaliza a `string | null`.
  Acepta strings http(s) directas, objetos `{url}` y arrays anidados.
  Rechaza paths relativos (`/uploads/foo.jpg`) por defensivo.
- Tests: 8 escenarios cubiertos en `packages/holded-client/test/products.test.ts`.

`apps/api/src/onboarding/initial-sync.ts`:

- `upsertCatalogEntry` extrae `imageUrl` y lo persiste.
- Tras el paso de productos+servicios, nuevo paso "Imágenes de producto"
  que llama a `enqueueAllProductImages` (recorre los productos con
  `imageUrl != null && imageCachedAt == null` y los encola).
- `SyncStats.imageJobsEnqueued` expuesto al admin (visible en
  `initialSyncStats`).

`apps/api/src/catalog/incremental-sync.ts`:

- `upsertCatalogEntry` lee el estado previo (`findUnique` extra de 1ms
  por producto, asumible) y compara `imageUrl` viejo vs. nuevo:
  - Producto nuevo con imagen → encola.
  - URL cambiada → invalida `imageMime` + `imageCachedAt`, encola.
  - URL igual + cachedAt poblado → no-op (idempotente).
  - URL igual + cachedAt null (intento previo falló) → reencola para
    reintentar.
- El enqueue real se hace al final del sync, fuera del loop, para que
  Redis caído no aborte el sync.
- `IncrementalSyncStats.imageJobsEnqueued` registra cuántos productos
  pasaron por el encolado.

### Frente 3 · `image-cache-worker`

`apps/api/src/queues/product-image-cache.ts`:

- Cola BullMQ `product-image-cache`, 3 reintentos con backoff
  exponencial (30s base). `jobId` determinista `imgcache-<productId>`
  → BullMQ deduplica si llegan dos jobs en paralelo.

`apps/api/src/workers/image-cache-worker.ts`:

- `processImageCacheJob(productId, deps)` — núcleo del job extraído
  para tests; `startImageCacheWorker()` envuelve con BullMQ.
- Flujo:
  1. Carga `Product` + `Tenant` (`holdedApiKeyCiphertext`).
  2. Si `imageCachedAt` ya está poblado → skip (`already-cached`).
  3. `fetch(imageUrl)` con header `key:` **sólo si** la URL es
     `*.holded.com|*.holded.es` (heurística defensiva — para CDNs
     externos firmados no tiene sentido y minimiza exposición de la
     API key).
  4. Validaciones: `Content-Type ∈ {image/jpeg, image/png, image/webp}`,
     tamaño ≤ `PRODUCT_IMAGE_MAX_BYTES` (default 5 MB).
  5. Escritura atómica: tmp file en mismo dir → `fsync` → `rename`.
     POSIX garantiza atomicidad dentro del filesystem — ningún cliente
     de Caddy ve un archivo a medio escribir.
  6. Si el MIME cambia (`.jpg` → `.png`), borra el archivo antiguo.
  7. `UPDATE products SET image_mime = ?, image_cached_at = now()`.
- Concurrency 4: paraleliza pero no satura a Holded ni IO del VPS.
- HTTP 404/410 → `skipped` sin reintento. HTTP 5xx → throw, BullMQ
  reintenta. Content-Type inválido (200+HTML del §01.B) → skipped sin
  reintento + log.
- Tests: 8 escenarios cubren happy path, content-type inválido,
  tamaño > límite, 404, 500, sin imageUrl, idempotencia, header `key`
  selectivo. `apps/api/test/image-cache-worker.test.ts`.

`apps/api/src/workers/index.ts`: registra el worker en el bootstrap.

### Frente 4 · Servir imágenes (Docker + Caddy)

`infra/docker-compose.prod.yml`:

- Nuevo volumen `product_images` montado en:
  - `api`: RW (`/var/cache/mipiacetpv/product-images`) — el API podría
    escribir desde endpoints admin futuros.
  - `worker`: RW (mismo path) — escritura primaria del cache worker.
  - `caddy`: RO (`/srv/product-images`) — sólo sirve.
- `PRODUCT_IMAGE_CACHE_DIR` exportado a api + worker.

`infra/Caddyfile`:

- Bloque `handle_path /product-images/* { root /srv/product-images;
  file_server; encode gzip zstd; Cache-Control "public, max-age=2592000,
  immutable" }` añadido a `mipiacetpv.tech` (PWA TPV) y
  `admin.mipiacetpv.tech`.
- URL final pública:
  `https://mipiacetpv.tech/product-images/<tenantId>/<productId>.<ext>`.

**Decisión de seguridad:** sirve directo desde Caddy sin auth. El
`<productId>` es UUID v4 (≈122 bits de entropía); adivinar otro
producto es computacionalmente inviable. El segmento `<tenantId>` añade
aislamiento por curiosidad — un tenant que sniffe URLs no obtendría
acceso a las de otro tenant aunque conozca el productId, porque el
path completo es necesario. Si en algún piloto se descubre filtración
real (improbable), se puede mover atrás a un endpoint API con auth sin
romper el schema ni el worker.

### Frente 5 · UI SalePage con imagen

`apps/tpv-web/src/lib/catalog.ts`:

- `CatalogProduct.imageMime: string | null` — el TPV usa este flag
  como gate (presente → `<img>`, null → placeholder).
- `extFromImageMime(mime)` y `productImageUrl(p, tenantId)` —
  helpers puros. `extFromImageMime` está alineado con `extFromMime`
  del worker para que los paths coincidan exactamente.
- `getCachedTenantId()` lee `localStorage` (poblado por `refreshCatalog`
  desde el backend en cada sync).
- `IndexedDB VERSION` bumpeada a 2 por el campo nuevo.

`apps/api/src/tpv-catalog/routes.ts`:

- `/tpv/catalog/products` ahora devuelve `imageMime` por ítem y
  `tenantId` a nivel respuesta (el front lo cachea para construir las
  URLs).

`apps/tpv-web/src/pages/SalePage.tsx`:

- Tile del grid: si `productImageUrl(p, tenantId)` resuelve, pinta
  `<img loading="lazy" decoding="async" class="w-full h-full object-cover">`;
  si no, cae al `Coffee` icon existente (placeholder coherente con el
  diseño de bar). Dimensiones fijas (aspect-[5/4]) evitan reflows si
  la imagen no es cuadrada.

`apps/tpv-web/vite.config.ts`:

- Workbox `runtimeCaching` con `StaleWhileRevalidate` sobre
  `/product-images/*`, expiración 7d, hasta 1000 entradas. Cumple
  ADR-007 offline-friendly: la primera vez que el cajero ve un
  producto, la imagen queda en cache local.

## Tests

| Test                                     | Cobertura |
|------------------------------------------|-----------|
| `image-cache-worker.test.ts`             | happy + 7 error paths (8 casos)|
| `incremental-sync.test.ts` (nuevo describe) | 5 casos: persistencia, no-image, URL cambiada, idempotencia, retry |
| `products.test.ts` (extractImageUrl)     | 8 casos: prioridad, anidación, vacío, no-http |

**Pendiente / out-of-scope:** la PWA TPV (`apps/tpv-web`) **no tiene
infra de tests React** (ni vitest config ni jsdom ni testing-library).
La verificación visual de `SalePage` con `<img>` vs. placeholder se
hace **manualmente** sobre la propia PWA en `vite dev`. Añadir test
infra de React es un bloque dedicado posterior (~ 1 día), no parte
de B-ProductImages. Si en el primer piloto detectamos regresión de
render, levantamos el bloque "test-infra-tpv-web".

## Lo que NO entra (recordatorio)

- Edición de imagen desde TPV.
- Compresión sharp/imagemin.
- Galería multi-imagen.
- CDN externo.
- Test infra de React para tpv-web.
- Refresh del campo `mainImage` vía webhooks (Holded no expone
  webhooks útiles — spike §09). El cron incremental de 15 min ya
  detecta cambios.

## Operaciones

- Aplicar la migración tras deploy: `pnpm --filter @mipiacetpv/db
  exec prisma migrate deploy`.
- Antes de habilitar imágenes para un piloto:
  1. Correr `pnpm --filter @mipiacetpv/holded-spike exec tsx
     src/13-product-image.ts` contra la cuenta sandbox del piloto.
  2. Actualizar `docs/spike-holded.md` §13.C con los hallazgos.
  3. Si el campo canónico observado **no** es `mainImage`, ajustar
     `extractImageUrl` para usarlo (tests cubren la prioridad).
- Disparar un sync incremental (`pnpm --filter @mipiacetpv/api run
  resync <tenantId>`) para poblar `imageUrl` y encolar el worker.
- El admin verá `initialSyncStats.imageJobsEnqueued` /
  `lastIncrementalSyncStats.imageJobsEnqueued`. Si crece y no baja
  monitorizar Redis/queue.

Tras B-ProductImages, primer piloto (Thalia) verá su catálogo con
fotos en el TPV. Diferenciador visual frente a TPV heredados.
