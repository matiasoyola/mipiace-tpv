-- B-ProductImages · imágenes de producto en TPV
--
-- Añade tres columnas opcionales a `products` para que el TPV pueda
-- pintar la imagen del producto desde Holded:
--
--   image_url       URL canónica que Holded expone (campo `mainImage`
--                   o equivalente — spike §13). NULL si el producto
--                   no tiene imagen → el TPV pinta placeholder.
--   image_mime      MIME del binario una vez el worker la descargó
--                   y validó (image/jpeg|png|webp). NULL hasta que
--                   el worker confirme. Sirve como gate del front.
--   image_cached_at Momento de la última descarga válida en disco.
--                   NULL = pendiente; el worker la encola.
--
-- Sin backfill: las columnas nacen NULL. El sync incremental rellena
-- `image_url` desde Holded en la siguiente pasada y el worker
-- (BullMQ `product-image-cache`) descarga el binario en background.
--
-- Si la URL cambia en un sync posterior (Holded la rota), el sync pone
-- `image_cached_at = NULL` para que el worker re-descargue. El archivo
-- antiguo se sobrescribe atomicamente (descarga a tmp, validación, mv
-- al destino) — los clientes con el binario ya en caché lo siguen
-- viendo hasta el siguiente refresh del service worker.

ALTER TABLE "products" ADD COLUMN "image_url" TEXT;
ALTER TABLE "products" ADD COLUMN "image_mime" TEXT;
ALTER TABLE "products" ADD COLUMN "image_cached_at" TIMESTAMPTZ;
