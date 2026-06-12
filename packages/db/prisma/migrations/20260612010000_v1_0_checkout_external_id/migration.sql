-- v1.0-mesas-frontend · Lote 2 · idempotencia del checkout de mesa.
--
-- Nueva columna en tickets: UUID v4 que el TPV genera al abrir el
-- overlay de cobro de una mesa. Un reintento de red del
-- POST /tickets/:id/checkout con el mismo valor devuelve el ticket ya
-- cobrado (GET-back) en vez de 409. Aditiva y nullable: venta rápida y
-- clientes con JS viejo no la mandan.

ALTER TABLE "tickets"
  ADD COLUMN "checkout_external_id" UUID;

CREATE UNIQUE INDEX "tickets_checkout_external_id_key"
  ON "tickets" ("checkout_external_id");
