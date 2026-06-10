-- v1.4-Precio-Decimales · b30 · ampliar precisión decimal de campos
-- monetarios a Decimal(12, 4).
--
-- Motivación: 2026-06-04 con Peluquería Sole detectamos que el servicio
-- "CORTAR UÑAS SOLO" se muestra en el TPV como 4,69 € pero Holded factura
-- 4,70 €. La causa raíz es que Holded almacena el precio NET con 4
-- decimales (`3.8843`) y nuestro `Decimal(10, 2)` lo trunca a `3.88` al
-- sincronizar. El gross calculado por el TPV (3.88 × 1.21 = 4.6948 → 4.69)
-- difiere del gross calculado por Holded (3.8843 × 1.21 = 4.70003 → 4.70)
-- en 1 céntimo por línea. Con cantidad ≥ 2 unidades, el drift se
-- multiplica y el ticket emitido por Holded no coincide con el cobrado
-- en el TPV → bug fiscal.
--
-- La solución a largo plazo es persistir los precios NET con la misma
-- precisión que Holded (4 decimales) y redondear sólo en el último paso
-- del cálculo del gross. Todos los campos €: pasan a `Decimal(12, 4)`.
-- Quedan fuera porcentajes (tax_rate, discount_pct) y unidades (units),
-- que mantienen su precisión actual.
--
-- ALTER TYPE no destruye datos: amplía la precisión preservando los
-- valores existentes; los céntimos antiguos quedan como `X.YZ00`. El
-- backfill posterior (script resync-catalog) repoblará `base_price` con
-- los 4 decimales reales de Holded.

ALTER TABLE "products"
    ALTER COLUMN "base_price"          TYPE DECIMAL(12, 4);

ALTER TABLE "product_variants"
    ALTER COLUMN "price_override"      TYPE DECIMAL(12, 4);

ALTER TABLE "shifts"
    ALTER COLUMN "cash_opening"        TYPE DECIMAL(12, 4),
    ALTER COLUMN "cash_counted"        TYPE DECIMAL(12, 4);

ALTER TABLE "shift_cash_counts"
    ALTER COLUMN "cash_total"          TYPE DECIMAL(12, 4);

ALTER TABLE "tickets"
    ALTER COLUMN "total"               TYPE DECIMAL(12, 4),
    ALTER COLUMN "total_tax"           TYPE DECIMAL(12, 4),
    ALTER COLUMN "total_discount"      TYPE DECIMAL(12, 4),
    ALTER COLUMN "cash_amount"         TYPE DECIMAL(12, 4);

ALTER TABLE "ticket_lines"
    ALTER COLUMN "unit_price"          TYPE DECIMAL(12, 4),
    ALTER COLUMN "unit_price_override" TYPE DECIMAL(12, 4),
    ALTER COLUMN "subtotal"            TYPE DECIMAL(12, 4),
    ALTER COLUMN "total"               TYPE DECIMAL(12, 4);

ALTER TABLE "ticket_payments"
    ALTER COLUMN "amount"              TYPE DECIMAL(12, 4);

ALTER TABLE "ticket_partial_payments"
    ALTER COLUMN "amount"              TYPE DECIMAL(12, 4),
    ALTER COLUMN "cash_amount"         TYPE DECIMAL(12, 4);

ALTER TABLE "refunds"
    ALTER COLUMN "total"               TYPE DECIMAL(12, 4),
    ALTER COLUMN "total_tax"           TYPE DECIMAL(12, 4);

ALTER TABLE "refund_lines"
    ALTER COLUMN "unit_price"          TYPE DECIMAL(12, 4),
    ALTER COLUMN "total"               TYPE DECIMAL(12, 4);
