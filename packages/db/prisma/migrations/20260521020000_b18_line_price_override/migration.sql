-- v1.2-Lite Lote 4.B · T-5: precio modificado puntualmente por el cajero.
--
-- Cuando el cajero ajusta el precio de una línea (libro descatalogado,
-- devolución parcial, redondeo de cortesía...) guardamos el override
-- aquí. `unit_price` se mantiene como histórico del precio del
-- catálogo en el momento del cobro — la auditoría puede mostrar
-- "modificado de X€ a Y€" leyendo ambos.
--
-- NULL = sin override (camino mayoritario). Sólo se rellena cuando el
-- cajero pulsa el lápiz. Aditivo, sin default, sin backfill: las
-- líneas históricas mantienen NULL → siguen funcionando.

ALTER TABLE "ticket_lines"
  ADD COLUMN IF NOT EXISTS "unit_price_override" DECIMAL(10, 2);
