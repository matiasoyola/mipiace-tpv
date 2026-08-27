-- v1.12 · Mesas abandonadas.
--
-- Hallazgo (BD de producción, 2026-08-20, confirmado el 26): Cafetería
-- Sirope tiene cuatro mesas ocupadas desde el 9 de julio (M1, M2 y M4 de
-- `gemmamgc72`, y T1), todas a 0,00 €. Nadie las abrió a propósito: un
-- toque en el mapa crea el ticket DRAFT con `tableId` y desde ese momento
-- la mesa está ocupada para siempre.
--
-- El barrido del corte de día anula esos DRAFT vacíos. Estas columnas son
-- su auditoría: quién, cuándo y —sobre todo— por qué.
--
-- Migración ADITIVA: tres columnas nullable sobre `tickets`. Ninguna fila
-- existente queda inconsistente.

-- `voided_by_user_id` dice QUIÉN anuló (NULL = lo anuló el sistema); esto
-- dice POR QUÉ. Mismo criterio que `shifts.close_reason` en v1.11.
CREATE TYPE "TicketVoidReason" AS ENUM ('MANUAL', 'AUTO_ABANDONED_EMPTY', 'MANAGER_VOID');

ALTER TABLE "tickets"
    ADD COLUMN "void_reason" "TicketVoidReason";

ALTER TABLE "tickets"
    ADD COLUMN "voided_at" TIMESTAMPTZ;

ALTER TABLE "tickets"
    ADD COLUMN "voided_by_user_id" UUID;

ALTER TABLE "tickets"
    ADD CONSTRAINT "tickets_voided_by_user_id_fkey"
    FOREIGN KEY ("voided_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill del pasado: hasta hoy el ÚNICO camino que anulaba un ticket era
-- `DELETE /tickets/:id` ("vaciar mesa"), siempre con un cajero delante. Esos
-- son MANUAL. `voided_at` se queda NULL a propósito: no sabemos cuándo fue, y
-- estampar `created_at` sería inventarse una fecha (mismo criterio que
-- `cashCounted = NULL` en v1.11 — lo desconocido se dice, no se rellena).
UPDATE "tickets"
   SET "void_reason" = 'MANUAL'
 WHERE "status" = 'VOIDED';

-- El barrido busca DRAFT con mesa por tenant; `(tenant_id, status)` y
-- `(table_id, status)` ya existen y cubren el acceso. Sin índice nuevo.
