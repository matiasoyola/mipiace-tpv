-- B-koibox-4 · Motor de reservas agnóstico cita/mesa (ADR-K8) — modo CITA.
--
-- Migración ADITIVA: no toca datos existentes ni el camino de cobro a
-- Holded (ADR-010). Backfill vacío (las tablas nacen sin filas). Núcleo
-- compartido cita/mesa: los valores TABLE de los enums y las columnas
-- `party_size` existen ya aunque B4 no las use, para que el bloque de mesa
-- (hostelería) caiga encima SIN migrar el núcleo. La columna `table_id` y
-- el EXCLUDE `no_table_overlap` se DIFIEREN a ese bloque (ADR-K8 §7).
--
-- El anti-solape NO vive en el código: son los EXCLUDE USING gist sobre
-- `appointment_assignments.slot` (tstzrange), parciales por `active`. La
-- carrera de dos altas sobre el mismo hueco la resuelve Postgres. Requiere
-- `btree_gist` para el `=` sobre uuid dentro del EXCLUDE.
--
-- Timestamp `20260805010000`: posterior a las migraciones de B2/B3
-- (`20260805000000`), que crean `products`/`users`/`agenda_enabled` y
-- `tenants` de los que dependen los FK de aquí.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
CREATE TYPE "ReservationMode" AS ENUM ('APPOINTMENT', 'TABLE');
CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'IN_SERVICE', 'COMPLETED', 'NO_SHOW', 'CANCELLED');
CREATE TYPE "ReservationSource" AS ENUM ('PRESENCIAL', 'WEB', 'PHONE', 'GIFT_REDEMPTION');
CREATE TYPE "ReservableType" AS ENUM ('STAFF', 'RESOURCE', 'TABLE');
CREATE TYPE "BlockScope" AS ENUM ('CENTER', 'STAFF', 'RESOURCE', 'TABLE');

-- CreateTable: appointments (el visit)
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "external_id" UUID,
    "mode" "ReservationMode" NOT NULL DEFAULT 'APPOINTMENT',
    "client_id" UUID,
    "timeslot" tstzrange NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'PENDING',
    "source" "ReservationSource" NOT NULL DEFAULT 'PRESENCIAL',
    "party_size" INTEGER,
    "voucher_id" UUID,
    "deposit_cents" INTEGER,
    "pending_until" TIMESTAMPTZ,
    "ticket_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable: appointment_items (servicios encadenados, con snapshot)
CREATE TABLE "appointment_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "buffer_before_min" INTEGER NOT NULL DEFAULT 0,
    "buffer_after_min" INTEGER NOT NULL DEFAULT 0,
    "staff_required" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL,
    "start_offset_min" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable: appointment_assignments (donde vive el GiST)
CREATE TABLE "appointment_assignments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "appointment_item_id" UUID,
    "reservable_type" "ReservableType" NOT NULL,
    "staff_user_id" UUID,
    "resource_id" UUID,
    "slot" tstzrange NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "appointment_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable: booking_blocks (bloqueos estructurales)
CREATE TABLE "booking_blocks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "scope" "BlockScope" NOT NULL,
    "staff_user_id" UUID,
    "resource_id" UUID,
    "slot" tstzrange,
    "rrule" TEXT,
    "start_time" TEXT,
    "end_time" TEXT,
    "valid_from" DATE,
    "valid_until" DATE,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "booking_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable: booking_policies (la consultoría hecha código)
CREATE TABLE "booking_policies" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "booking_policies_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "appointments_external_id_key" ON "appointments"("external_id");
CREATE UNIQUE INDEX "appointments_ticket_id_key" ON "appointments"("ticket_id");
CREATE INDEX "appointments_tenant_id_status_idx" ON "appointments"("tenant_id", "status");
CREATE INDEX "appointments_tenant_id_client_id_idx" ON "appointments"("tenant_id", "client_id");
-- gist (tenant_id, timeslot) para consultas de rango del día por tenant.
CREATE INDEX "appointments_tenant_timeslot_idx" ON "appointments" USING gist ("tenant_id", "timeslot");

CREATE INDEX "appointment_items_tenant_id_appointment_id_idx" ON "appointment_items"("tenant_id", "appointment_id");

CREATE INDEX "appointment_assignments_tenant_id_appointment_id_idx" ON "appointment_assignments"("tenant_id", "appointment_id");

CREATE INDEX "booking_blocks_tenant_id_idx" ON "booking_blocks"("tenant_id");

CREATE UNIQUE INDEX "booking_policies_tenant_id_key_key" ON "booking_policies"("tenant_id", "key");

-- Anti-solape por recurso a nivel de BD (ADR-K8 §3.4). Uno por familia de
-- recurso; parciales por `active` (un hueco CANCELLED/NO_SHOW deja de
-- bloquear). `no_table_overlap` lo añadirá el bloque de mesa junto a la
-- columna table_id.
ALTER TABLE "appointment_assignments"
    ADD CONSTRAINT "no_staff_overlap"
    EXCLUDE USING gist ("tenant_id" WITH =, "staff_user_id" WITH =, "slot" WITH &&)
    WHERE ("active" AND "staff_user_id" IS NOT NULL);

ALTER TABLE "appointment_assignments"
    ADD CONSTRAINT "no_resource_overlap"
    EXCLUDE USING gist ("tenant_id" WITH =, "resource_id" WITH =, "slot" WITH &&)
    WHERE ("active" AND "resource_id" IS NOT NULL);

-- Foreign keys
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- FK dura al catálogo local (serviceId = product.id, kind=SERVICE) — sin
-- relación Prisma para no inflar back-refs en Product.
ALTER TABLE "appointment_items" ADD CONSTRAINT "appointment_items_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointment_assignments" ADD CONSTRAINT "appointment_assignments_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointment_assignments" ADD CONSTRAINT "appointment_assignments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointment_assignments" ADD CONSTRAINT "appointment_assignments_item_id_fkey" FOREIGN KEY ("appointment_item_id") REFERENCES "appointment_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- FK sólo-SQL a users/resources (sin relación Prisma).
ALTER TABLE "appointment_assignments" ADD CONSTRAINT "appointment_assignments_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointment_assignments" ADD CONSTRAINT "appointment_assignments_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "booking_blocks" ADD CONSTRAINT "booking_blocks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "booking_policies" ADD CONSTRAINT "booking_policies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
