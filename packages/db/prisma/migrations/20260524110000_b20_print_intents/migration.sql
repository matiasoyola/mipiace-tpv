-- v1.3-Thalia Lote 3 · intent de impresión persistido.
--
-- Hasta ahora la "intención de imprimir" vivía implícita en
-- `tickets.print_intent` (BOOLEAN). Eso bastaba para la impresión
-- inicial al cobrar pero NO permitía registrar reimpresiones
-- posteriores (la cliente real pide copia cuando un cliente vuelve y
-- el primer ticket se ha extraviado).
--
-- Nueva tabla `print_intents` con `kind = NEW | REPRINT | GIFT`. El
-- bridge B5 la consumirá vía BullMQ cuando se monte; mientras tanto
-- el endpoint POST /tickets/:id/reprint sigue funcional — el intent
-- queda pendiente hasta que llegue el bridge.

-- CreateEnum
CREATE TYPE "PrintIntentKind" AS ENUM ('NEW', 'REPRINT', 'GIFT');

-- CreateTable
CREATE TABLE "print_intents" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "kind" "PrintIntentKind" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requested_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "picked_at" TIMESTAMPTZ,
    "done_at" TIMESTAMPTZ,
    "last_error" TEXT,

    CONSTRAINT "print_intents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "print_intents_status_created_at_idx"
    ON "print_intents"("status", "created_at");

-- CreateIndex
CREATE INDEX "print_intents_ticket_id_kind_created_at_idx"
    ON "print_intents"("ticket_id", "kind", "created_at");

-- AddForeignKey
ALTER TABLE "print_intents" ADD CONSTRAINT "print_intents_ticket_id_fkey"
    FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "print_intents" ADD CONSTRAINT "print_intents_requested_by_user_id_fkey"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
