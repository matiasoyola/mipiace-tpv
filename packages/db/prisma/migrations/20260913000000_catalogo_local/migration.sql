-- catalogo-local · el catálogo nace en la BD (escalón 2 de la
-- independencia de Holded). ADR-017.
--
-- El 05-09-2026 se decidió que Mi Piace no entra en ERP y no será SIF.
-- Holded hacía DOS trabajos a la vez: el sistema fiscal y la autoridad
-- del catálogo. Al renunciar a lo fiscal, el TPV tiene que quedarse con
-- lo otro — cualquier sustituto barato de Holded cubre la mitad fiscal,
-- no la del catálogo.
--
-- Migración ADITIVA. No reescribe `products`, no toma ningún lock que se
-- note y no cambia el comportamiento de ningún tenant de hoy: todas las
-- filas existentes quedan `source = 'HOLDED'` con su `holded_product_id`
-- intacto, que es exactamente lo que eran.
--
-- Tres piezas y un índice.

-- ── 1 · el enum de la autoridad ────────────────────────────────────────
--
-- Tipo NUEVO, no un valor añadido a uno existente: a diferencia de
-- `InitialSyncStatus.NOT_APPLICABLE` en H1, aquí `CREATE TYPE` sí puede
-- convivir en la misma transacción con las sentencias que lo leen.

CREATE TYPE "ProductSource" AS ENUM ('HOLDED', 'LOCAL');

-- ── 2 · la columna, con su backfill ────────────────────────────────────
--
-- El backfill ES el DEFAULT. Desde PG 11 un `ADD COLUMN ... NOT NULL
-- DEFAULT <constante>` NO reescribe la tabla: guarda el default en
-- `pg_attribute.attmissingval` y lo sirve a las filas antiguas al
-- leerlas. Es una operación de catálogo — `ACCESS EXCLUSIVE` de
-- milisegundos — y no un UPDATE masivo.
--
-- Esto importa aquí y no importaba en H1: `tenants` tiene decenas de
-- filas, pero `products` tiene miles por tenant. Sin la garantía del
-- DEFAULT esto sería un rewrite con la caja parada.
--
-- MEDIDO, no supuesto. Todas las cifras de esta migración salen de la
-- MISMA réplica y las tomó quien firma el done-doc, no se heredaron:
-- base `mipiacetpv_medicion2` en el contenedor `mipiacetpv-postgres`
-- (PostgreSQL 16.13), con las migraciones anteriores a ésta desplegadas,
-- cinco tenants y 200.000 productos de una fila típica del proyecto.
--
-- El tamaño absoluto depende del ancho de fila que uses para rellenar,
-- así que lo que prueba la ausencia de rewrite no es el número en sí:
-- es que ANTES y DESPUÉS coinciden al byte y que `n_tup_upd` sigue en 0.
--
--   pg_relation_size ANTES   = 31 506 432 bytes
--   pg_relation_size DESPUÉS = 31 506 432 bytes  → sin rewrite
--   ALTER TABLE ADD COLUMN   = 1,669 ms
--   pg_attribute.atthasmissing = t, attmissingval = {HOLDED}
--   pg_stat_user_tables.n_tup_upd = 0 → ni una fila actualizada
--   las 200.000 filas viejas leen 'HOLDED' sin haber sido tocadas

ALTER TABLE "products"
  ADD COLUMN "source" "ProductSource" NOT NULL DEFAULT 'HOLDED';

-- ── 3 · el enlace deja de ser la identidad ─────────────────────────────
--
-- `DROP NOT NULL` es sólo catálogo (`pg_attribute.attnotnull = false`):
-- no hay validación de filas que hacer, porque relajar una restricción
-- no puede invalidar ninguna fila existente. Instantáneo. (Lo caro es lo
-- contrario, `SET NOT NULL`, que sí escanea la tabla entera.)
-- Medido en la misma réplica de 200.000 filas: 0,946 ms, y
-- `pg_attribute.attnotnull` pasa a `f` sin tocar ninguna fila.
--
-- El `products_tenant_id_holded_product_id_key` que ya existe NO se
-- toca. En Postgres un índice único trata cada NULL como distinto de
-- todos los demás, así que N productos locales con `holded_product_id`
-- NULL conviven bajo esa constraint sin chocar. La clave del sync sigue
-- siendo la misma; lo que cambia es que deja de ser la IDENTIDAD del
-- producto y pasa a ser sólo el ENLACE con Holded.

ALTER TABLE "products"
  ALTER COLUMN "holded_product_id" DROP NOT NULL;

-- ── 4 · la unicidad del SKU local ──────────────────────────────────────
--
-- Índice único PARCIAL: un SKU local no se repite dentro del tenant.
--
-- Por qué parcial y no un `@@unique([tenantId, sku])` a secas: los SKU
-- que vienen de Holded llegan como llegan. Duplicarlos allí es problema
-- del cliente en su ERP, y una constraint global haría que el sync
-- reventara al traerlos. Sólo gobernamos lo que nace aquí.
--
-- Prisma 5 no sabe declarar un índice parcial, así que esta línea vive
-- SÓLO aquí y `schema.prisma` la documenta en su lugar. `migrate dev`
-- la verá como deriva y ofrecerá borrarla: NO aceptar.
--
-- Sin CONCURRENTLY a propósito: `migrate deploy` corre cada migración
-- dentro de una transacción y `CREATE INDEX CONCURRENTLY` no puede vivir
-- en una. El índice se crea sobre el subconjunto `source = 'LOCAL'`, que
-- el día del despliegue está VACÍO en las cinco bases de producción — el
-- lock es sobre cero filas. Medido en la misma réplica de 200.000:
-- 32,754 ms y 8 192 bytes de índice (una sola página, porque el
-- subconjunto `source = 'LOCAL'` está vacío).
--
-- Lo que este índice NO gobierna, y por eso el SKU se valida además en
-- el handler: un `sku` NULL. Los NULL son distintos entre sí también en
-- un índice parcial, así que N productos locales sin SKU pasarían. El
-- SKU obligatorio es una regla de producto y vive en la ruta de alta.

CREATE UNIQUE INDEX "products_tenant_id_sku_local_key"
  ON "products" ("tenant_id", "sku")
  WHERE "source" = 'LOCAL';

-- ── 5 · el interruptor de Holded (addendum 3) ──────────────────────────
--
-- `holded_enabled` responde a "¿está PREVISTO que esta empresa use
-- Holded?". `holded_api_key_ciphertext IS NOT NULL` responde a otra
-- distinta: "¿lo tiene conectado YA?". Hasta aquí la segunda se usaba
-- para contestar las dos, y por eso un tenant con caja y sin Holded caía
-- en /onboarding y no salía (`apps/admin/src/App.tsx`).
--
-- Va en ESTA migración y no en una aparte a propósito: el bloque
-- despliega una vez, y el criterio 1 del prompt —un tenant sin Holded da
-- de alta productos y cobra— es imposible de cumplir sin esta columna.
-- Separarlas sería fingir que el catálogo local funciona sin ella.
--
-- Mismo patrón que `caja_enabled` en H1 y que `source` aquí arriba: NOT
-- NULL DEFAULT true, así que todas las filas de hoy nacen encendidas y
-- nada cambia de comportamiento. Sólo un `false` explícito lo apaga, y
-- sólo lo escribe el super-admin.
--
-- MEDIDO en la misma réplica que el resto de esta migración, con cinco
-- tenants dentro (producción tiene cinco):
--   pg_relation_size ANTES     = 8 192 bytes
--   pg_relation_size DESPUÉS   = 8 192 bytes  → sin rewrite
--   ALTER TABLE ADD COLUMN     = 2,507 ms
--   pg_attribute.atthasmissing = t, attmissingval = {t}
--   pg_stat_user_tables.n_tup_upd = 0 → ni una fila actualizada
--   los 5 tenants leen holded_enabled = true sin haber sido tocados
--
-- El DEFAULT booleano es constante, así que aplica la misma garantía de
-- PG ≥ 11 que la columna `source`: metadatos, no UPDATE masivo. Con cinco
-- filas daría igual; se deja escrito porque el criterio del proyecto es
-- que una migración diga lo que bloquea, no que se confíe en el tamaño.

ALTER TABLE "tenants"
  ADD COLUMN "holded_enabled" BOOLEAN NOT NULL DEFAULT true;
