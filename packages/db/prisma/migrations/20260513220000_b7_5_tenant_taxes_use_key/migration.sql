-- B7.5 · Repoblar tenant_taxes.holded_tax_id desde raw->>'key' y
-- tenant_taxes.rate desde raw->>'amount'.
--
-- Motivación (spike §11): el sync de B5 leía `t.id` y `t.rate` del
-- payload de `/invoicing/v1/taxes`. Empíricamente Holded devuelve:
--   - `id` vacío (`""`) para taxes del catálogo estándar
--     (`s_iva_*`, `s_rec_*`). Como resultado, todos los rows del
--     catálogo estándar colisionaban en el unique (tenant_id, "") y
--     sólo sobrevivía uno (REC 0% en la cuenta piloto).
--   - `rate` no existe en la respuesta — el porcentaje viene en
--     `amount` como string ("21", "5.2", "0").
-- Ambos bugs hacían que tenant_taxes.rate quedara NULL y los productos
-- pasaran a sellable_via_tpv=false (silent reject defensivo de B5
-- §1.1).
--
-- Fix: el identificador estable que `Product.taxes[]` referencia es
-- `key`. Lo persistimos como `holded_tax_id`. El `id` UUID original
-- queda guardado en `raw` (sólo se puebla en taxes custom del dueño).
--
-- No añadimos columna nueva: `holded_tax_id` cambia de "id UUID
-- inestable" a "key estable que matchea Product.taxes[]". El nombre
-- queda algo engañoso pero rename es invasivo para una semántica
-- interna; documentado en el código.

-- 1) Repoblar holded_tax_id desde raw.key (cuando raw.key esté y
-- difiera del valor actual). Si la clave nueva ya existe para el
-- tenant (colisión con un row pre-existente, p.ej. tras un sync
-- intermedio), borramos los rows antiguos: la siguiente ejecución
-- del sync los recreará con el shape correcto.
WITH targets AS (
    SELECT
        t.id            AS row_id,
        t.tenant_id     AS tenant_id,
        t.raw->>'key'   AS new_key,
        t.holded_tax_id AS old_key
    FROM "tenant_taxes" t
    WHERE t.raw IS NOT NULL
      AND COALESCE(t.raw->>'key', '') <> ''
      AND t.raw->>'key' IS DISTINCT FROM t.holded_tax_id
),
losers AS (
    SELECT row_id
    FROM targets tg
    WHERE EXISTS (
        SELECT 1 FROM "tenant_taxes" e
        WHERE e.tenant_id = tg.tenant_id
          AND e.holded_tax_id = tg.new_key
          AND e.id <> tg.row_id
    )
)
DELETE FROM "tenant_taxes" WHERE id IN (SELECT row_id FROM losers);

UPDATE "tenant_taxes" t
   SET holded_tax_id = t.raw->>'key',
       synced_at     = now()
 WHERE t.raw IS NOT NULL
   AND COALESCE(t.raw->>'key', '') <> ''
   AND t.raw->>'key' IS DISTINCT FROM t.holded_tax_id;

-- 2) Repoblar rate desde raw.amount (string parseable a numeric).
-- NULL si amount está vacío o no es numérico (el resolver caerá al
-- regex `s_iva_<rate>` en runtime).
UPDATE "tenant_taxes" t
   SET rate      = (t.raw->>'amount')::numeric,
       synced_at = now()
 WHERE t.raw IS NOT NULL
   AND COALESCE(t.raw->>'amount', '') ~ '^[0-9]+(\.[0-9]+)?$'
   AND t.rate IS DISTINCT FROM (t.raw->>'amount')::numeric;
