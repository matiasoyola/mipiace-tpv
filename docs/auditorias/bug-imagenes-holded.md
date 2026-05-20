# Bug · Imágenes de producto no llegan al TPV (auditoría v1.2-Lite)

**Fecha:** 2026-05-20
**Branch:** `v1-2-lite`
**Tenant que disparó el reporte:** Thalia (966 productos, 0 con `imageUrl`).
**Predecesor:** `Inv-1` (v1.1) añadió defensivamente `attachment`/`attachments`
como candidatos en `extractImageUrl` y un warning de diagnóstico
(`listUnrecognizedImageKeys`). Tras deploy de v1.1 y resync de Thalia,
**siguió saliendo 0/966 productos con imagen** — el problema no era el
campo, era el endpoint.

---

## Confirmación de Inv-1: la lista NO trae imagen

En la cuenta de Thalia, `GET /invoicing/v1/products?page=1` devuelve 26
campos por producto. Verificado vía la propia respuesta de prod (logs +
inspección del `raw` JSONB en BD): **ninguno** de los 26 campos contiene
el substring `image`, `picture`, `photo`, `thumb` ni `attach`. Los chips
de Inv-1 que añadían `attachment`/`attachments` a los candidatos del
`extractImageUrl` no encontraban nada porque esos campos simplemente
no existen en la respuesta del listado.

Conclusión empírica: **el endpoint `/invoicing/v1/products` NO incluye
información de imagen**. Si las imágenes están accesibles vía API, viven
en otra ruta.

Como referencia, `apps/api/src/onboarding/initial-sync.ts` y
`apps/api/src/catalog/incremental-sync.ts` ya consumen el listado vía
`iterateAllProducts(client)`. El campo `extractImageUrl(raw)` retorna
`null` para el 100% de productos de Thalia.

---

## Endpoints candidatos

Holded no publica una doc pública pulida que liste el endpoint exacto
para imágenes. De la doc en https://developers.holded.com (sección
Products / Invoicing v1) los candidatos son:

| Candidato | Probabilidad | Notas |
|---|---|---|
| `GET /invoicing/v1/products/{id}` | **Alta** | Patrón habitual en Holded: el detalle individual a veces trae campos que el listado omite (igual que `salesreceipts` — confirmado en spike §05). |
| `GET /invoicing/v1/products/{id}/attachments` | Media | Patrón REST estándar para recursos anidados. Holded tiene endpoint análogo para `documents`. |
| `GET /invoicing/v1/products/{id}/files` | Baja | Variante menos común; no aparece referenciada en la doc pública. |
| `GET /invoicing/v1/products/{id}/image` | Baja | Endpoint dedicado al binario. El spike §13 probó este path en una cuenta sin imagen y devolvió 200+HTML (caso §01.B = endpoint inexistente). |

**Decisión: Opción A — endpoint individual `/invoicing/v1/products/{id}`.**

Razones:

1. Es el patrón ya validado en otras partes de la API de Holded (`getProduct`
   ya existe en `holded-client`; lo usa `updateProductWithGetBack` y
   `auto-sku`). Si el detalle devuelve un campo de imagen que el listado
   omite, basta con activar la llamada.
2. Si Opción A falla (detalle también devuelve los mismos 26 campos sin
   imagen), reaccionamos en un segundo commit con Opción B
   (`/attachments`) sin tocar el resto del flujo: el helper que diseñamos
   más abajo encapsula la lógica.
3. Una sola llamada extra por producto vs. dos llamadas (detalle + lista
   de attachments) — minimiza el rate-limit risk.

---

## Diseño de la solución

### Pieza nueva: `fetchProductImageDetails`

En `packages/holded-client/src/products.ts` añadimos un helper que dado
un cliente y una lista de productIds, llama al endpoint individual con
concurrencia limitada y devuelve un `Map<productId, imageUrl | null>`.

- Concurrencia fija a 5 (asumible para Holded; el image-cache-worker ya
  paraleliza a 4 sin saturar).
- Sin retry interno (el caller decide; en el sync, un fallo aislado se
  refleja como `imageUrl=null` y el siguiente incremental reintenta).
- Defensivo: usa `extractImageUrl` sobre el detalle para reutilizar el
  fallback de campos candidatos (`mainImage`, `image`, `attachment`...).
  Si Holded devuelve la imagen como `mainImageUrl` o `image_url` (un
  campo que NO hemos declarado todavía), `listUnrecognizedImageKeys`
  loguea la clave y el siguiente parche lo añade sin migración.

### Integración en `initial-sync.ts`

Tras la fase "Productos" (que ya queda con `imageUrl=NULL` para los 966
de Thalia), antes de la fase "Imágenes de producto" actual (que sólo
encola jobs de cache), se introduce un **paso nuevo
"Imágenes de producto (detalle Holded)"** que:

1. Lee de BD los productos del tenant con `imageUrl IS NULL AND
   active=true`.
2. Llama a `fetchProductImageDetails(client, ids, { concurrency: 5 })`.
3. UPDATE selectivo: sólo los que el detalle devolvió URL no-null.
4. Persiste un contador en `stats.productsImageBackfilled` para que el
   admin vea cuántos se rescataron desde el detalle.

La fase existente "Imágenes de producto" (`enqueueAllProductImages`)
queda intacta: opera tras el backfill y encola los jobs de cache para
todos los productos con `imageUrl != null`.

### Integración en `incremental-sync.ts`

Mismo helper, ejecutado tras el upsert de productos y servicios:

- Sólo procesa productos donde `imageUrl IS NULL` en BD (los que ya
  tienen URL no se re-pinchan — el detalle sería caro y la lista no
  ofrece info nueva).
- Si el detalle devuelve URL nueva, hace UPDATE y encola el cache job
  vía `enqueueProductImageCache`.

Resultado: cada tick del cron incremental sólo paga el coste del detalle
para los productos que faltan, no para los 966 cada vez.

### Coste estimado

Thalia tras deploy v1.2:

- 966 productos con `imageUrl=NULL` en BD.
- 5 concurrentes × ~200ms por detalle ≈ 40s de backfill en el primer sync.
- Tras ese sync, los que tengan imagen quedan con URL persistida; el
  cron incremental no los vuelve a tocar.
- Total sync inicial pasa de ~30s a ~70s. **~2.3× lo actual.** Roza el
  criterio "< 2×" pero es aceptable porque sólo ocurre una vez por tenant
  (y antes no se ejecutaba el endpoint correcto en absoluto).

Para tenants con catálogo más grande (>2000 productos) la penalización
crece linealmente — si vemos un piloto donde el sync inicial pasa de 1
min a 5 min, evaluamos:

1. Subir concurrencia a 10 (validar antes que Holded no devuelve 429).
2. Persistir `holdedHasImage` como flag para no reintentar productos que
   ya sabemos sin foto.

Ninguno de los dos hace falta hoy.

### Invalidación de cache cuando cambia la foto en Holded

El sync incremental compara `existing.imageUrl !== newImageUrl` y, si
difiere, hace `imageMime: null, imageCachedAt: null` para forzar la
redescarga del worker (lógica ya implementada antes de este lote).

Con el nuevo backfill, el flujo cuando un cliente sube una foto en
Holded:

1. La foto queda asociada al producto en Holded.
2. Próximo tick del cron incremental (cada 15min).
3. `incremental-sync` hace upsert con `imageUrl` desde la lista (vacío).
4. **Paso nuevo**: detecta productos con `imageUrl=NULL`, llama al
   detalle, descubre la URL, hace UPDATE.
5. La URL cambió (de NULL a algo), así que el sync invalida
   `imageCachedAt` y encola cache job.
6. El worker descarga la foto y la guarda en disco.
7. El TPV pinta la imagen en el siguiente refresh del catálogo IDB.

Tiempo desde subida en Holded → visible en TPV: hasta 15 min (latencia
del cron) + 1 min (descarga + cache TTL del IDB del TPV).

---

## Plan de verificación post-deploy

Matias ejecuta tras merge a master:

1. Forzar resync de Thalia desde el admin (`POST /catalog/sync-now`).
2. Mirar `tenant.lastIncrementalSyncStats.productsImageBackfilled` —
   debería ser cercano al número de productos que tienen foto en Holded.
3. SQL: `SELECT COUNT(*) FROM products WHERE tenant_id=$THALIA AND
   image_url IS NOT NULL;` — debe pasar de 0 a algo cercano al 80%+ de
   productos con foto en Holded.
4. Esperar 5-10 min a que el worker descargue y poblar
   `image_cached_at`. Mirar conteo de archivos en
   `/var/lib/mipiacetpv/product-images/<tenantId>/`.
5. Abrir TPV de Thalia y validar visualmente que los tiles del grid
   ahora pintan imágenes en lugar de placeholders.

Si `productsImageBackfilled` sigue siendo 0 tras el resync, eso confirma
que la Opción A no es la correcta para esta cuenta: pasar a Opción B
(añadir `listProductAttachments` y consumir desde ahí). El helper actual
quedaría intacto y el commit nuevo añade la segunda capa de fallback.

---

## Decisiones explícitas

1. **Endpoint elegido**: `GET /invoicing/v1/products/{id}` (individual).
2. **Estrategia**: backfill selectivo en lugar de fetch agresivo. El
   listado sigue siendo la fuente principal; el detalle complementa.
3. **Concurrencia**: 5 simultáneas (vía Promise pool sencillo, sin
   librería externa).
4. **Trigger de fallback**: `imageUrl=NULL` en BD tras el upsert desde
   listado. Idempotente — re-correr el sync no duplica trabajo.
5. **Rate-limit**: no añadimos token-bucket explícito. La concurrencia 5
   con latencia ~200ms por request da ~25 req/s, dentro del umbral típico
   de APIs SaaS (Holded no publica límites exactos).
