-- v1.4-Bar-Operativa-MVP Lote 4 · split bill (Modo A · partir importe).
--
-- Cobros parciales sobre un ticket DRAFT: el cliente paga 30 € de un
-- total de 80 €, queda 50 € pendiente. Cada cobro parcial se registra
-- aquí; el /checkout posterior recibe los partials acumulados y los
-- usa al construir el TicketPayment final que sube a Holded.
--
-- Estructura espejo de ticket_payments + campos extra (cashier,
-- cashAmount, paidAt) porque a diferencia de ticket_payments estos
-- viven durante la fase DRAFT y necesitamos auditoría operativa
-- (quién cobró qué, cuándo).

CREATE TABLE "ticket_partial_payments" (
    "id"          UUID NOT NULL,
    "ticket_id"   UUID NOT NULL,
    "amount"      DECIMAL(10, 2) NOT NULL,
    "method"      "PaymentMethod" NOT NULL,
    "cashier_id"  UUID,
    "cash_amount" DECIMAL(10, 2),
    "meta"        JSONB,
    "paid_at"     TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_partial_payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ticket_partial_payments_ticket_id_idx"
    ON "ticket_partial_payments"("ticket_id");

ALTER TABLE "ticket_partial_payments"
    ADD CONSTRAINT "ticket_partial_payments_ticket_id_fkey"
    FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
