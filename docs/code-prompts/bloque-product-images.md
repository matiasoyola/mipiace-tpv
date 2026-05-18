# Prompt para Claude Code — B-ProductImages · imágenes de producto en TPV

Mini-bloque autónomo (~1 día). Pinta la imagen del producto desde
Holded en la PWA del TPV, con cache local en el VPS para
rendimiento (decisión Matías: "el TPV tiene que ir como un tiro").

Pega esto en una sesión de Claude Code tras pushear B-OnboardingV2
(commit que cierre ese bloque). Si Matías lanza en paralelo a
B-OnboardingV2 vía git worktree, este bloque se rebasea/mergea al
final.

---

Hola Code. B-ProductImages añade imagen de producto al TPV. Hoy
los tiles del catálogo en la PWA muestran solo nombre + precio +
SKU; visualmente plano y lento para identificar productos. Holded
sí expone la imagen del producto en su API (campo `mainImage` o
similar — confirmar en spike §13).

## Contexto

Lee primero:
- `apps/api/src/onboarding/initial-sync.ts` — cómo persistimos
  productos desde Holded.
- `apps/api/src/catalog/incremental-sync.ts` — idem para sync
  incremental.
- `packages/holded-client/src/products.ts` — tipo Product que
  recibimos de Holded.
- `apps/tpv-web/src/pages/SalePage.tsx` (y archivos hermanos
  `SalePage.products.tsx` etc.) — grid de productos actual.
- `packages/db/prisma/schema.prisma` — modelo Product.
- `infra/docker-compose.prod.yml` — para añadir el volume del cache.
- `infra/Caddyfile` — para servir el cache de imágenes con caché HTTP.

## Mini-spike §13 (primer paso si necesario)

Confirmar campo de imagen en la respuesta de Holded para productos.
Crear `spike/holded/src/13-product-image.ts`:

1. `GET /invoicing/v1/products?page=1` para una muestra.
2. Inspeccionar los campos candidatos: `mainImage`, `image`,
   `thumbnail`, `pictures[]`, `images[]`.
3. Identificar cuál devuelve URL pública, requiere auth, qué
   formato (JPG/PNG), tamaños disponibles.
4. Probar `curl -I` la URL para ver si responde sin auth, qué
   `Content-Type`, qué `Cache-Control` envía Holded.
5. Documentar findings en `docs/spike-holded.md` §13.

Si la imagen requiere auth (header `key:` del cliente), el cache
worker tiene que enviar la API key al descargar (la tenemos
cifrada en `Tenant.holdedApiKeyCiphertext`).

## Alcance · 5 frentes

### Frente 1 · Schema Product.imageUrl + migración

```prisma
model Product {
  // ...
  // B-ProductImages: URL canónica de la imagen desde Holded.
  // null si el producto no tiene imagen en Holded. El worker
  // `image-cache-worker` descarga la imagen y la sirve desde
  // /static/product-images/<productId>.<ext>. Si la imagen cambia
  // en Holded (sync incremental detecta nuevo URL), invalidamos
  // el cache local y re-descargamos.
  imageUrl     String? @map("image_url")
  imageMime    String? @map("image_mime")          // "image/jpeg", "image/png"
  imageCachedAt DateTime? @map("image_cached_at") @db.Timestamptz()
}
```

Migración `b11_product_image_url`. Sin backfill (null = sin imagen).
Defensivo: si Holded devuelve URL pero falta extraerlo, lo dejamos
null y el TPV cae al placeholder.

### Frente 2 · Persistir imageUrl en sync

`apps/api/src/onboarding/initial-sync.ts` y
`apps/api/src/catalog/incremental-sync.ts`:

- Al upsert de cada producto, extraer el campo identificado por el
  spike §13 y persistir en `Product.imageUrl`.
- Si la URL cambia respecto a la persistida, invalidar
  `imageCachedAt = null` para forzar re-descarga (el worker la
  detecta como pendiente).
- Si el campo no viene en la respuesta, `imageUrl = null`.

`packages/holded-client/src/products.ts`: añadir el campo al tipo
`HoldedProduct` (campo opcional).

### Frente 3 · Worker `image-cache-worker`

Nuevo worker BullMQ `apps/api/src/workers/image-cache-worker.ts`:

- Cola `product-image-cache` con priority normal.
- Trigger:
  - Después del sync inicial (después de persistir todos los
    productos), encolar un job por cada producto con
    `imageUrl != null && imageCachedAt == null`.
  - Después del sync incremental, idem para productos que el sync
    detectó como nuevos o con URL cambiada.
- Job processing:
  1. Lookup producto + tenant (para API key Holded si necesaria).
  2. `fetch(product.imageUrl)` con el `key:` header si el spike §13
     confirmó que Holded requiere auth.
  3. Validar tamaño (máx 5 MB por imagen — Holded raramente devuelve
     más, pero defensivo) y Content-Type (`image/jpeg|png|webp`).
  4. Guardar en filesystem `/var/cache/mipiacetpv/product-images/<tenantId>/<productId>.<ext>`
     (volumen Docker compartido con Caddy).
  5. `UPDATE products SET image_mime = ?, image_cached_at = now() WHERE id = ?`.
  6. Si descarga falla (404, timeout, content-type inválido),
     log warn y `image_cached_at = null` queda → reintento en el
     próximo sync.
- Concurrency 4 (no saturamos Holded, pero paralelizamos lo que
  podemos).
- BullMQ retries: 3 con backoff exponencial. Tras 3 fallos, log
  permanente y skip hasta próximo sync.

`apps/api/src/queues/product-image-cache.ts`: queue + enqueue helper.

### Frente 4 · Servir imágenes cacheadas

**Volumen Docker:** añadir a `infra/docker-compose.prod.yml`:

```yaml
volumes:
  # ... existentes
  product_images:

services:
  api:
    volumes:
      - product_images:/var/cache/mipiacetpv/product-images
  worker:
    volumes:
      - product_images:/var/cache/mipiacetpv/product-images
  caddy:
    volumes:
      # ... existentes
      - product_images:/srv/product-images:ro
```

**Caddyfile**: añadir block en `mipiacetpv.tech` (PWA TPV) y
`admin.mipiacetpv.tech`:

```caddyfile
handle_path /product-images/* {
  root * /srv/product-images
  file_server
  encode gzip
  header Cache-Control "public, max-age=2592000, immutable"
  # 30 días de cache. Si la imagen cambia, el worker borra el
  # archivo viejo y guarda con el mismo nombre — el cliente lo
  # recibirá tras un service worker update.
}
```

URL final: `https://mipiacetpv.tech/product-images/<tenantId>/<productId>.jpg`.

**Endpoint API alternativo** si la imagen requiere auth para
servirla (multi-tenant — un tenant no debería ver imágenes de
otro): `GET /api/products/:id/image` que valida tenant del cashier
session y hace `sendFile(path)`. Decidir si servir directo desde
Caddy (rápido, sin auth) o vía API (más lento, con auth).

Mi voto: **directo desde Caddy con UUID en path**, porque el
`productId` es UUID v4 ≈ 122 bits de entropía — adivinarlo es
inviable. Si quieres mayor isolation, hacer `<tenantId>/<productId>`
ya añade dos capas.

### Frente 5 · UI SalePage renderiza imagen

`apps/tpv-web/src/pages/SalePage.tsx` (o el componente de tile de
producto):

- En el grid de productos, cada tile recibe `product.imageMime`
  como prop.
- Si `product.imageMime` está set → `<img src="/product-images/${tenantId}/${product.id}.${extFromMime(product.imageMime)}" loading="lazy" />`.
- Si null → placeholder SVG embebido (icono de paquete, fondo
  pastel) — no descarga de red, no salta.
- Dimensiones fijas (ej. 80x80 px) con object-fit cover para que
  imágenes no cuadradas no rompan el grid.

El `tenantId` lo obtiene la PWA de su contexto de sesión (ya está
disponible vía el JWT del cajero).

**Service worker**: la PWA actual cachea offline el shell. Las
imágenes de producto se cachean **on-demand** vía workbox
`StaleWhileRevalidate` con expiración de 7 días para que offline
funcione sin descargar el catálogo completo.

## Tests

- `image-cache-worker.test.ts`: descarga imagen mock, guarda en
  filesystem, actualiza Product.imageMime + imageCachedAt. Falla
  Content-Type inválido → no guarda + log. Falla tamaño > 5 MB →
  no guarda.
- `initial-sync.image.test.ts`: producto con imagen en payload
  Holded → persiste imageUrl + encola job. Sin imagen → imageUrl
  null + no encola.
- `e2e-product-images.test.tsx`: SalePage muestra `<img>` cuando
  product.imageMime presente, placeholder cuando null.

## Restricciones

- **NO** descargar las imágenes en el primer login del cajero (el
  catálogo puede tener 500+ productos × 100 KB = 50 MB → flat). El
  worker las descarga en background tras sync.
- **NO** servir imágenes desde la API en runtime de cobro
  (latencia). Caddy con cache largo.
- **NO** sobrescribir imagen cacheada antes de validar que la
  descarga nueva es válida (atomic write: descarga a tmp, valida,
  mv al destino).
- Mantener ADR-007 offline-friendly: la PWA con service worker
  cachea las imágenes que ya descargó al menos una vez.

## Entregables

1. PR único con los 5 frentes + spike §13.
2. Commit message descriptivo.
3. `docs/blocks/B-ProductImages-done.md` con resumen.
4. Migración `b11_product_image_url`.
5. Tests verdes.

## Lo que NO entra

- Editar imagen de producto desde el TPV (Holded es la fuente).
- Compresión / optimización agresiva de imágenes (sharp / imagemin
  posterior si pesa el storage).
- Soporte de múltiples imágenes por producto (Holded permite
  galerías pero usamos `mainImage` por ahora).
- CDN externo (Cloudflare R2, etc.) — local cache en VPS basta
  para 5 pilotos.

Cuando este bloque cierre, primer piloto (Thalia) verá su
catálogo con fotos en el TPV. Diferenciador visual frente a TPV
heredados.
