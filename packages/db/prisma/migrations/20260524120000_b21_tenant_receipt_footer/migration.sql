-- v1.3-Thalia Lote 6 · pie de ticket personalizable por tenant.
--
-- El cliente quiere poder añadir un mensaje propio al pie del ticket
-- ("Gracias por su compra. Cambios hasta 14 días con ticket."). Hasta
-- ahora el pie era fijo en el renderer (sólo "Gracias por tu visita").
--
-- Aditivo, sin default, sin backfill: tenants existentes mantienen
-- NULL → el ticket sigue exactamente igual que antes.

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "receipt_footer" TEXT;
