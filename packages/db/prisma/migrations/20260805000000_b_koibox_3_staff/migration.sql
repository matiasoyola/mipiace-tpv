-- B-koibox-3 · Personal + horarios.
--
-- Base de la agenda multi-profesional (B4). Extiende el `user` existente
-- (ADR-K1: NO hay tabla `Staff` paralela); estas tablas cuelgan del user.
-- Migración ADITIVA: no toca datos existentes ni el camino de cobro a
-- Holded. Backfill vacío (las tablas nacen sin filas; se rellenan desde
-- el panel de personal). Multi-tenant por fila (ADR multi-tenant).
--
--   * staff_profiles — perfil de agenda 1:1 con user (displayName, color,
--     active). PK = user_id.
--   * staff_skills — matriz profesional × servicio. `service_id` = FK a
--     products(id) (kind=SERVICE), alineado con B-koibox-2. PK compuesta
--     (user_id, service_id).
--   * staff_shifts — turnos como plantilla recurrente (rrule RFC 5545) +
--     ventana de validez + kind.
--
-- La columna `tenants.agenda_enabled` (gate ADR-K6) es propiedad de
-- B-koibox-2 y se crea en su migración: aquí NO se toca para no duplicar
-- el ALTER.

-- CreateEnum
CREATE TYPE "StaffShiftKind" AS ENUM ('REGULAR', 'REINFORCEMENT', 'SWAP');

-- CreateTable
CREATE TABLE "staff_profiles" (
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "display_name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "color" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "staff_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "staff_skills" (
    "user_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_skills_pkey" PRIMARY KEY ("user_id", "service_id")
);

-- CreateTable
CREATE TABLE "staff_shifts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "rrule" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "valid_from" DATE NOT NULL,
    "valid_until" DATE,
    "kind" "StaffShiftKind" NOT NULL DEFAULT 'REGULAR',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "staff_shifts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_profiles_tenant_id_idx" ON "staff_profiles"("tenant_id");

-- CreateIndex
CREATE INDEX "staff_profiles_tenant_id_active_idx" ON "staff_profiles"("tenant_id", "active");

-- CreateIndex
CREATE INDEX "staff_skills_tenant_id_service_id_idx" ON "staff_skills"("tenant_id", "service_id");

-- CreateIndex
CREATE INDEX "staff_skills_tenant_id_user_id_idx" ON "staff_skills"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "staff_shifts_tenant_id_user_id_idx" ON "staff_shifts"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "staff_shifts_user_id_idx" ON "staff_shifts"("user_id");

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_skills" ADD CONSTRAINT "staff_skills_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_skills" ADD CONSTRAINT "staff_skills_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_skills" ADD CONSTRAINT "staff_skills_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_shifts" ADD CONSTRAINT "staff_shifts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
