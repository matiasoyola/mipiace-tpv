-- v1.8-Fiado (variante B) · venta a crédito local hasta el cobro.
--
-- El fiado vive SOLO en nuestro TPV como "ticket pendiente" y NO se
-- sincroniza con Holded hasta que se salda. Migración aditiva: sin
-- ventana de mantenimiento, no toca datos existentes.
--
--   * TicketStatus.ON_CREDIT — deuda viva, entregada, no sincronizable.
--   * tickets.credit_pending — importe adeudado (NULL = venta normal).
--   * tenants.credit_sales_enabled — flag por tenant (default OFF).
--   * ticket_payments.external_id — idempotencia del cobro de deuda.
--   * ticket_payments.collected_in_shift_id — turno del cobro (arqueo Z
--     multi-día: el ingreso se imputa al turno en que se cobra).
--   * índice PARCIAL para el listado de deudas por cliente.

-- No usamos el nuevo valor en el DDL de esta misma migración, así que
-- el ADD VALUE convive con el resto de sentencias (PG 12+).
ALTER TYPE "TicketStatus" ADD VALUE 'ON_CREDIT';

ALTER TABLE "tickets" ADD COLUMN "credit_pending" DECIMAL(12, 4);

ALTER TABLE "tenants"
    ADD COLUMN "credit_sales_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ticket_payments" ADD COLUMN "external_id" UUID;
ALTER TABLE "ticket_payments" ADD COLUMN "collected_in_shift_id" UUID;

CREATE UNIQUE INDEX "ticket_payments_external_id_key"
    ON "ticket_payments"("external_id");

CREATE INDEX "ticket_payments_collected_in_shift_id_idx"
    ON "ticket_payments"("collected_in_shift_id");

-- Índice parcial: sólo indexa deudas vivas. El listado GET /credits
-- agrega por (tenant, contacto) filtrando credit_pending > 0.
CREATE INDEX "tickets_tenant_id_contact_holded_id_credit_pending_idx"
    ON "tickets"("tenant_id", "contact_holded_id")
    WHERE "credit_pending" > 0;
