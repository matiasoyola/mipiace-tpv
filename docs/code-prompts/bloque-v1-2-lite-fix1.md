# Prompt para Claude Code — v1.2-Lite-fix1

Sub-iteración tras el deploy de v1.2-Lite (2026-05-22). Tres lotes en
una sola branch `v1-2-lite-fix1`, commits separados.

## Estado actual de master

- HEAD: `5d79354 Lote 4.B · T-5 · Modificar precio de línea con
  auditoría` (v1.2-Lite mergeado y desplegado en producción).
- Migrations aplicadas: hasta `b18_line_price_override`.
- Containers Docker en VPS reconstruidos y healthy.

## Findings del post-deploy v1.2-Lite que justifican esta sub-iteración

1. **Lote 1 (Bug-Imagenes-Holded Opción A) no rescató ni una sola
   imagen** (`pendingCount: 964` → `productsImageBackfilled: 0`,
   `productsImageBackfillFailed: 0`, todo en `stillEmpty`).
2. **Modal "Editar línea" del TPV queda con botones ocultos** en
   monitores con altura reducida — sin scroll interno, los botones
   Eliminar / Aplicar caen fuera del viewport. Bloquea uso real.
3. **Cambiar cantidad o eliminar línea cuesta 3-4 clics** (abrir
   modal, editar, aplicar). Falta interacción inline directa en la
   lista del carrito.

---

# Lote 1 · Bug-Imagenes-Holded · descarga binaria directa

## Hallazgos del spike empírico (ya hecho, no repetir)

Matías hizo el spike contra la API real de Holded desde el container
API en producción (curl autenticado con la API key cifrada
descifrada al vuelo, tenant Thalia, productId
`68d51959bec14299c701208f` que tiene foto). Resultados:

| Ruta | Status | Tipo | Conclusión |
|---|---|---|---|
| `GET /invoicing/v1/products/{id}` (detalle JSON) | 200 | JSON con 26 campos (`id, kind, name, desc, typeId, contactId, contactName, price, taxes, total, hasStock, stock, barcode, sku, cost, purchasePrice, weight, tags, categoryId, factoryCode, forSale, forPurchase, salesChannelId, expAccountId, warehouseId, translations`) | **NINGÚN campo de imagen.** Opción A muerta empíricamente. |
| `GET /invoicing/v1/products/{id}/attachments` | 200 | `text/html` (catch-all del frontend Next.js de Holded) | Ruta no existe, Opción B muerta. |
| `GET /invoicing/v1/products/{id}/files` | 200 | `text/html` (catch-all) | No existe. |
| `GET /invoicing/v1/products/{id}/images` | 200 | `text/html` (catch-all) | No existe. |
| `GET /invoicing/v1/products/{id}/mainimage` | 200 | `text/html` (catch-all) | No existe. |
| **`GET /invoicing/v1/products/{id}/image`** | **200** | **Binario JPEG** (header `JFIF`, `gd-jpeg v1.0 quality=100`) | **ESTA es la ruta correcta.** |

Notas críticas:

- **HEAD a `/image` NO es fiable**: Holded responde `text/html;
  charset=UTF-8` con `content-length: null` en HEAD, pero GET
  devuelve el binario JPEG real. Usar siempre **GET + detección por
  magic bytes**.
- Productos sin imagen en Holded: el GET seguramente devolverá HTML
  catch-all (Next.js root). El helper debe distinguir
  binario-imagen vs HTML mirando los primeros bytes del response.

## Objetivo

Para cada producto del tenant, llamar a este endpoint binario,
guardar la imagen en disco local (`/srv/product-images/<tenantId>/<productId>.<ext>`)
y poblar `imageMime` + `imageCachedAt`. El TPV ya pinta imagen
basándose en `imageMime != null` (ver `apps/api/src/tpv-catalog/routes.ts:91`),
así que el frontend no necesita tocarse.

## Implementación

### `packages/holded-client/src/products.ts` · nuevo helper

```ts
export type FetchedProductImage = {
  bytes: Buffer;
  mime: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
} | null;

/**
 * Pega GET /invoicing/v1/products/{id}/image y devuelve el binario
 * de la imagen si Holded la tiene, o null si el producto no tiene
 * foto (Holded responde con HTML catch-all del frontend Next.js).
 *
 * El response NO trae content-type fiable (Holded sirve siempre
 * 200 + text/html en HEAD aunque GET devuelva JPEG), así que la
 * detección del tipo se hace por magic bytes:
 *   - FF D8 FF                  → image/jpeg
 *   - 89 50 4E 47               → image/png
 *   - 47 49 46 38               → image/gif
 *   - 52 49 46 46 ... 57 45 42 50 (offset 8) → image/webp
 *   - 3C ('<') al principio     → HTML catch-all, no hay imagen
 *
 * Devuelve null cuando los bytes parecen HTML. Throw cuando hay
 * error de red, status no-200 o magic bytes no reconocidos
 * (cualquier otra cosa la tratamos como caso a investigar, no
 * silenciar).
 */
export async function fetchProductImage(
  client: HoldedClient,
  productId: string,
  opts?: { signal?: AbortSignal },
): Promise<FetchedProductImage>;
```

- Implementación: `await client.fetchBinary(\`/invoicing/v1/products/${productId}/image\`)` o equivalente; pasar el header `key` con la API key (ya gestionado por el client base).
- Tamaño máximo: `PRODUCT_IMAGE_MAX_BYTES` (mismo límite que el
  image-cache-worker, está en `env.ts`).
- Timeout: 15 s por request.

También helper batch:

```ts
export async function fetchProductImagesBatch(
  client: HoldedClient,
  productIds: string[],
  opts: { concurrency?: number; onWarn?: (msg: string, e?: unknown) => void },
): Promise<{
  resolved: Map<string, { bytes: Buffer; mime: string }>;
  none: string[];      // verificados sin imagen en Holded
  failed: string[];    // errores de red o magic bytes raros
}>;
```

Concurrencia por defecto 5 (alineado con `image-cache-worker`).

### `apps/api/src/onboarding/initial-sync.ts` y `incremental-sync.ts`

Renombrar `backfillImagesFromDetail` → `backfillImagesFromHolded`,
o crear nueva función al lado y deprecar la antigua (Code decide).
Lógica nueva:

```
Para cada producto con (active = true AND kind = "PRODUCT"
                        AND imageCachedAt IS NULL):
  result = await fetchProductImage(client, holdedProductId)
  if result is binary:
    ext = extFromMime(result.mime)   // ya existe en image-cache-worker
    path = `${PRODUCT_IMAGE_CACHE_DIR}/${tenantId}/${productId}.${ext}`
    escritura atómica: tmp + fsync + rename (igual que el worker)
    UPDATE products SET image_mime = result.mime,
                         image_cached_at = now()
                         WHERE id = productId
    counter productsImageHoldedFetched += 1
  else if result is null (HTML):
    UPDATE products SET image_mime = NULL,
                         image_cached_at = now()
                         WHERE id = productId
    counter productsImageHoldedNone += 1
  else (throw):
    log.warn pero no romper el sync
    counter productsImageHoldedFailed += 1
    (próximo incremental reintenta porque image_cached_at sigue NULL)
```

**Sentinel "verificado sin foto"** = `image_cached_at IS NOT NULL
AND image_mime IS NULL`. Idempotente: ese producto NO se vuelve a
pinchar en próximos syncs hasta que cambien algo en Holded.

**Invalidación cuando el cliente sube/cambia foto en Holded**: el
sync detecta el cambio mirando, para los productos con
`image_cached_at` antiguo (> 24h), reintenta una vez. Mantener
behavior simple: en el incremental cada N horas, los productos con
`image_cached_at < now() - 24h` se revalidan. Hoy no tenemos campo
de "etag Holded" — aceptable como compromiso de v1.2-Lite-fix1.

### Stats del sync

Reemplazar/ampliar los campos existentes en `IncrementalSyncStats`
e `InitialSyncStats`:

```ts
imageJobsEnqueued: number;            // legacy URL-based, se mantiene para fallback
productsImageHoldedFetched: number;   // descargadas con éxito desde /image
productsImageHoldedNone: number;      // sentinel "Holded no tiene foto"
productsImageHoldedFailed: number;    // errores de red/magic
```

Loggear el split en el log final del job para diagnóstico.

### Image-cache-worker

**No tocar.** Sigue manejando el flujo `imageUrl → fetch → cache`
para casos futuros (upload manual por el OWNER, retoma de imageUrl
externa, etc.). Aquí no se encolan nuevos jobs.

### Magic byte detector

Crear `apps/api/src/catalog/image-magic.ts` con función pura
`detectImageMime(buf: Buffer): "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "text/html" | "unknown"`.
Tests unitarios con buffers sintéticos (4 magic numbers OK + un "<"
+ buffer random).

### Verificación post-deploy

1. `git pull && build && force-recreate` (sin migrations nuevas).
2. Resync forzado de Thalia desde super-admin.
3. Esperar 2-3 min (964 productos × ~200ms/concurrencia 5 ≈ 40s).
4. SQL:
   ```sql
   SELECT
     COUNT(*) FILTER (WHERE image_mime IS NOT NULL) AS con_foto,
     COUNT(*) FILTER (WHERE image_cached_at IS NOT NULL AND image_mime IS NULL) AS sin_foto,
     COUNT(*) FILTER (WHERE image_cached_at IS NULL) AS pendientes
   FROM products
   WHERE tenant_id IN (SELECT id FROM tenants WHERE name LIKE '%Thalia%');
   ```
   Esperamos: con_foto > 0 (probablemente 700+), sin_foto + con_foto ≈ 966, pendientes = 0.
5. `docker exec mipiacetpv-caddy ls /srv/product-images/<tenantId>/ | wc -l`
   debe coincidir con `con_foto`.
6. Abrir TPV de Thalia, ver tiles con imágenes reales en lugar de
   placeholders.

### Audit doc

Actualizar `docs/auditorias/bug-imagenes-holded.md` añadiendo:

- Sección "Resultado Opción A": negativa empírica
  (0/964 backfilled, 0 failed → todo stillEmpty).
- Sección "Spike completo 2026-05-22": tabla de endpoints probados
  copiada del prompt arriba.
- Sección "Solución v1.2-Lite-fix1": descarga binaria directa,
  detección por magic bytes, sentinel.

---

# Lote 2 · F1-UX · Modal LineSheet scrollable + sticky footer

## Objetivo

Los botones Eliminar / Cancelar / Aplicar siempre visibles, sin
importar la altura del monitor. Hoy en monitores cortos quedan
empujados fuera del viewport.

## Implementación

### `apps/tpv-web/src/pages/SalePage.lineSheet.tsx`

Estructura interna del modal en flex column con tres zonas:

- **Header** (título + nombre del producto + descripción de precio
  unitario / IVA) — fijo arriba.
- **Body** (Precio unitario + Modificar, Cantidad ± stepper,
  Descuento %, Modificadores, Nota ad-hoc, Total línea) — con
  `overflow-y: auto`, ocupa el espacio restante.
- **Footer** (Eliminar a la izquierda, Cancelar + Aplicar a la
  derecha) — sticky abajo, siempre visible.

Reglas concretas:

- `max-height: min(100vh - 48px, 720px)` en el contenedor del
  modal.
- `min-height: 56px` en los tres botones del footer (touch target
  cómodo en cajero apresurado).
- Padding inferior del body `padding-bottom: 24px` para que el
  último input no quede pegado al footer.
- Botón Eliminar a la izquierda con `var(--color-danger)`. Aplicar
  a la derecha en coral primario. Cancelar entre medias en outline
  gris.

### Test visual

Validar con DevTools simulando alturas 600, 700, 800, 900 px que
los botones permanecen visibles y el body scrollea correctamente.

---

# Lote 3 · F2-UX · Controles inline en líneas del ticket

## Objetivo

Permitir cambiar cantidad y eliminar una línea sin abrir el
LineSheet. Mantener el modal para edición avanzada (precio
override, modificadores, notas).

## Implementación

### Componente de línea del carrito

Probable extracción en `apps/tpv-web/src/pages/SalePage.tsx` (panel
derecho con la lista de líneas). Si la línea no es un componente
extraído todavía, hacerlo: `apps/tpv-web/src/pages/CartLineItem.tsx`.

Layout nuevo (mockup, no literal):

```
┌─────────────────────────────────────────────────────────┐
│  [−] [2] [+]  Asterix en Lusitania        21,80 € [🗑]  │
│                10,90 € ud.                              │
└─────────────────────────────────────────────────────────┘
```

- **Stepper a la izquierda** (− cantidad +), ancho fijo ~120 px.
- **Click central** (nombre del producto, área central) sigue
  abriendo el LineSheet completo.
- **Botón papelera a la derecha**, con confirmación inline: primer
  tap arma el botón (color rojo, escala 1.05, espera 1.5s); segundo
  tap dentro de la ventana elimina; tap fuera o tras timeout
  cancela.
- Touch targets ≥ 44×44 (Apple HIG / Material).

### Comportamiento del stepper

- `−` en cantidad 1: NO convertir a 0 silenciosamente. Resaltar
  brevemente el botón papelera como hint visual ("para eliminar,
  usa la papelera"). Cantidad mínima visible = 1.
- `+` sin tope superior.
- Acción optimista: la línea actualiza inmediatamente, el cálculo
  de subtotal/IVA se recalcula en el mismo frame (igual que hace
  hoy desde el modal).

### Línea con precio override

Si `unitPriceOverride !== null` (Lote 4.B de v1.2-Lite), añadir un
badge "•" o asterisco junto al precio inline para recordar al
cajero que ese precio es manual. El modal sigue siendo el lugar
para limpiar el override (botón "Restaurar").

### El modal LineSheet no se elimina

Sigue disponible al clicar la zona central de la línea. Los nuevos
controles inline son atajos, no reemplazo.

---

# Reglas comunes a los tres lotes

- Una branch: `v1-2-lite-fix1` desde master (HEAD `5d79354`).
- Un commit por lote.
- `pnpm typecheck` limpio antes de cada commit.
- Tests existentes no deben romperse. Añadir tests nuevos para
  `fetchProductImage`, `fetchProductImagesBatch`, `detectImageMime`,
  y para los componentes UX si tienen lógica con estado
  (papelera armada, stepper con cantidad mínima).
- **Sin migraciones nuevas** — todo es código.
- Sin tocar Caddyfile, dockerfiles, env vars, o CSP.
- Si surge cualquier decisión técnica no resuelta (timeout exacto,
  rate-limit observado en Holded, etc.), documentarla en
  `docs/auditorias/bug-imagenes-holded.md` y dejar el commit con
  decisión explícita en el mensaje.

## Tras los 3 lotes

Reportar a Matías:

- Branch lista para merge ff-only.
- Diff stat por commit.
- Hallazgos / decisiones surgidas durante la implementación.
- Plan de verificación post-deploy (incluye los SQLs y curls de
  arriba).
