-- B-Categorias-via-Tags · sync de holded.product.tags[] como base
-- para los chips de categoría en el TPV. Reusa el array nativo de
-- Postgres para no crear modelo Category aparte (más rápido para v1
-- y aprovecha que el dato ya viaja en la respuesta Holded).
--
-- Aditivo + idempotente: si el sync futuro elimina tags, el array
-- queda vacío y el chip "Todos" cubre el caso. NOT NULL DEFAULT '{}'
-- para que las queries existentes (que no proyectan tags) sigan
-- funcionando sin migraciones de datos.

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "tags" TEXT[] NOT NULL DEFAULT '{}';

-- Índice GIN para `tags @> ARRAY['foo']` cuando el filtro pase a
-- server-side en multi-select. Para los volúmenes de piloto (≤500
-- productos por tenant) el filtro client-side es suficiente, pero
-- el índice es barato de mantener y nos lo dejamos preparado.
CREATE INDEX IF NOT EXISTS "products_tags_idx"
  ON "products" USING GIN ("tags");
