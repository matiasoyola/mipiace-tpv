-- B-Print fase 1 · tickets digitales nativos
--
-- `public_slug` es un identificador secreto (~96 bits de entropía,
-- 16 caracteres hex sobre 8 bytes random) que sirve como capability
-- URL para acceder al PDF del ticket sin auth. Lo usan:
--   - el QR que el cliente escanea desde el TPV,
--   - el link del email auto-enviado tras el cobro,
--   - el botón "Ver ticket" de la PWA.
-- Si el slug es válido, el endpoint público renderiza el PDF al vuelo
-- desde el TicketDocument (sin tocar Holded). Si el ticket está
-- DRAFT o el slug no existe, devolvemos 404 — el "ticket aún no se ha
-- emitido" cae en la misma respuesta para no filtrar existencia.

ALTER TABLE "tickets" ADD COLUMN "public_slug" TEXT;

-- Backfill: para los tickets ya creados (entornos de dev y eventuales
-- pilotos) generamos un slug 16-char hex on-the-fly. Postgres'
-- gen_random_bytes vive en pgcrypto; activamos por idempotencia.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
UPDATE "tickets"
SET "public_slug" = encode(gen_random_bytes(8), 'hex')
WHERE "public_slug" IS NULL;

ALTER TABLE "tickets" ALTER COLUMN "public_slug" SET NOT NULL;
CREATE UNIQUE INDEX "tickets_public_slug_key" ON "tickets"("public_slug");

-- `email_failed_at` permite a la bandeja admin distinguir un email
-- que reventó (3 attempts agotados) sin tener que consultar BullMQ.
ALTER TABLE "tickets" ADD COLUMN "email_failed_at" TIMESTAMPTZ;
