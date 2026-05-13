-- B4 §0 · Stores y Registers: soft-delete para preservar histórico
ALTER TABLE "stores" ADD COLUMN     "deleted_at" TIMESTAMPTZ;
ALTER TABLE "registers" ADD COLUMN     "deleted_at" TIMESTAMPTZ;

-- B4 §1 · Ticket lifecycle: campos que faltaban del modelo funcional
-- (`docs/blocks/B4-prompt.md` §1.1). El schema B1 ya tenía Ticket /
-- TicketLine / TicketPayment / Refund / RefundLine; aquí añadimos lo
-- que el flujo end-to-end necesita.
ALTER TABLE "tickets"
    ADD COLUMN "notes" TEXT,
    ADD COLUMN "holded_doc_number" TEXT,
    ADD COLUMN "cash_amount" DECIMAL(10, 2),
    ADD COLUMN "gift_receipt_intent_at" TIMESTAMPTZ,
    ADD COLUMN "email_intent" TEXT,
    ADD COLUMN "print_intent" BOOLEAN NOT NULL DEFAULT true;

-- TicketLine: SKU + modificadores + snapshot del holdedProductId para
-- que el worker no dependa del catálogo local en el momento del envío.
ALTER TABLE "ticket_lines"
    ADD COLUMN "sku" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "holded_product_id" TEXT,
    ADD COLUMN "modifiers" JSONB;

-- Refund: snapshot de totales para el worker upload-refund.
ALTER TABLE "refunds"
    ADD COLUMN "total" DECIMAL(10, 2) NOT NULL DEFAULT 0,
    ADD COLUMN "total_tax" DECIMAL(10, 2) NOT NULL DEFAULT 0,
    ADD COLUMN "method" TEXT,
    ADD COLUMN "synced_at" TIMESTAMPTZ,
    ADD COLUMN "holded_doc_number" TEXT,
    ADD COLUMN "sync_error" JSONB,
    ADD COLUMN "user_id" UUID,
    ADD COLUMN "register_id" UUID,
    ADD COLUMN "shift_id" UUID;

-- RefundLine: snapshot de la línea original para el payload negativo.
ALTER TABLE "refund_lines"
    ADD COLUMN "name_snapshot" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "sku" TEXT NOT NULL DEFAULT '',
    ADD COLUMN "unit_price" DECIMAL(10, 2) NOT NULL DEFAULT 0,
    ADD COLUMN "tax_rate" DECIMAL(5, 2) NOT NULL DEFAULT 0,
    ADD COLUMN "discount_pct" DECIMAL(5, 2) NOT NULL DEFAULT 0;

-- Refund FK adicionales (todas Restrict para preservar histórico fiscal).
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_register_id_fkey"
    FOREIGN KEY ("register_id") REFERENCES "registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_shift_id_fkey"
    FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Índices nuevos para búsqueda de tickets (B4 §1.5).
CREATE INDEX "tickets_register_id_created_at_idx" ON "tickets"("register_id", "created_at");
CREATE INDEX "tickets_shift_id_idx" ON "tickets"("shift_id");
CREATE INDEX "tickets_external_id_idx" ON "tickets"("external_id");

-- Email resend log: cola interna del backend para el retry exponencial
-- del reenvío por email del PDF de Holded. Idempotente vía (ticket_id,
-- email) durante el proceso del job.
CREATE TABLE "ticket_email_jobs" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "to_email" TEXT NOT NULL,
    "requested_by_user_id" UUID NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" JSONB,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ,

    CONSTRAINT "ticket_email_jobs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ticket_email_jobs_ticket_id_idx" ON "ticket_email_jobs"("ticket_id");
CREATE INDEX "ticket_email_jobs_status_idx" ON "ticket_email_jobs"("status");

ALTER TABLE "ticket_email_jobs" ADD CONSTRAINT "ticket_email_jobs_ticket_id_fkey"
    FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ticket_email_jobs" ADD CONSTRAINT "ticket_email_jobs_user_id_fkey"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- HoldedUpload kind ya soportaba TICKET y REFUND; nada que migrar.

-- Asegura que el sku default del DEFAULT no se quede tras backfill.
ALTER TABLE "ticket_lines" ALTER COLUMN "sku" DROP DEFAULT;
ALTER TABLE "refund_lines" ALTER COLUMN "name_snapshot" DROP DEFAULT;
ALTER TABLE "refund_lines" ALTER COLUMN "sku" DROP DEFAULT;
ALTER TABLE "refund_lines" ALTER COLUMN "unit_price" DROP DEFAULT;
ALTER TABLE "refund_lines" ALTER COLUMN "tax_rate" DROP DEFAULT;
ALTER TABLE "refund_lines" ALTER COLUMN "discount_pct" DROP DEFAULT;
ALTER TABLE "refunds" ALTER COLUMN "total" DROP DEFAULT;
ALTER TABLE "refunds" ALTER COLUMN "total_tax" DROP DEFAULT;
ALTER TABLE "tickets" ALTER COLUMN "print_intent" DROP DEFAULT;
