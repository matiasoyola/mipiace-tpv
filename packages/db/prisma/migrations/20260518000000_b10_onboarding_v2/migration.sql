-- B-OnboardingV2 · alta supervisada de tenants
--
-- Tres cambios aditivos coordinados:
--   1. tenants.onboarding_state (DRAFT|ACTIVE) — ciclo de vida del
--      onboarding supervisado. Backfill ACTIVE para no romper tenants
--      pre-existentes del flujo viejo.
--   2. users.is_test_cashier (BOOL, default false) + users.deleted_at —
--      cajero técnico interno auto-creado al cerrar el sync inicial.
--      Se soft-deletea al activar el tenant.
--   3. tickets.status += TEST — los tickets generados por el cajero
--      técnico llevan este status. El worker `ticket-upload` lo skipea
--      sin subir a Holded; el worker de email también.

-- ── Enum OnboardingState ───────────────────────────────────────────
CREATE TYPE "OnboardingState" AS ENUM ('DRAFT', 'ACTIVE');

-- ── tenants.onboarding_state con backfill ACTIVE ───────────────────
-- Default DRAFT para nuevos tenants. Backfill explícito a ACTIVE en
-- los existentes — el flujo legacy ya creaba OWNER + tenant juntos.
ALTER TABLE "tenants"
    ADD COLUMN "onboarding_state" "OnboardingState" NOT NULL DEFAULT 'DRAFT';
UPDATE "tenants" SET "onboarding_state" = 'ACTIVE';

-- ── users.is_test_cashier + users.deleted_at ───────────────────────
ALTER TABLE "users" ADD COLUMN "is_test_cashier" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "users" ADD COLUMN "deleted_at" TIMESTAMPTZ;

-- ── tickets.status += TEST ─────────────────────────────────────────
-- Nota: PG no permite ALTER TYPE ... ADD VALUE dentro de transacción
-- en muchas versiones — Prisma migrate ejecuta cada sentencia en su
-- propia transacción implícita. Esto funciona en PG 12+. Si la
-- migración se replica manualmente con `psql -1`, se desactivará el
-- BEGIN/COMMIT envoltorio.
ALTER TYPE "TicketStatus" ADD VALUE IF NOT EXISTS 'TEST';
