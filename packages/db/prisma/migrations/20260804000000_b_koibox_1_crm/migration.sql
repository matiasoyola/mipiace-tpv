-- B-koibox-1 · CRM / ficha de cliente.
--
-- Capa LOCAL, fuente de verdad propia (ADR-K2). Migración ADITIVA: no
-- toca datos existentes ni el camino de cobro a Holded. Backfill vacío
-- (las tablas nacen sin filas; se rellenan desde el TPV).
--
--   * tenants.crm_enabled — capability flag por tenant (ADR-K6, default OFF).
--   * clients — ficha del cliente (nombre, contacto, RGPD opt-in, notas),
--     enlace fiscal perezoso `holded_contact_id` (nullable).
--   * client_consents — consentimientos RGPD (campos + alta manual).
--   * client_technical_notes — ficha técnica por servicio (serviceId de
--     Holded, sin FK dura).

-- CreateEnum
CREATE TYPE "ClientConsentKind" AS ENUM ('DATA', 'TREATMENT');

-- AlterTable
ALTER TABLE "tenants"
    ADD COLUMN "crm_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "external_id" UUID,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "birthdate" DATE,
    "holded_contact_id" TEXT,
    "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_consents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "kind" "ClientConsentKind" NOT NULL,
    "granted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doc_ref" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_technical_notes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "service_id" TEXT,
    "body" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "client_technical_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clients_external_id_key" ON "clients"("external_id");

-- CreateIndex
CREATE INDEX "clients_tenant_id_phone_idx" ON "clients"("tenant_id", "phone");

-- CreateIndex
CREATE INDEX "clients_tenant_id_email_idx" ON "clients"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "clients_tenant_id_last_name_first_name_idx" ON "clients"("tenant_id", "last_name", "first_name");

-- CreateIndex
CREATE INDEX "clients_tenant_id_holded_contact_id_idx" ON "clients"("tenant_id", "holded_contact_id");

-- CreateIndex
CREATE INDEX "client_consents_tenant_id_client_id_idx" ON "client_consents"("tenant_id", "client_id");

-- CreateIndex
CREATE INDEX "client_technical_notes_tenant_id_client_id_idx" ON "client_technical_notes"("tenant_id", "client_id");

-- CreateIndex
CREATE INDEX "client_technical_notes_client_id_service_id_idx" ON "client_technical_notes"("client_id", "service_id");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_consents" ADD CONSTRAINT "client_consents_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_technical_notes" ADD CONSTRAINT "client_technical_notes_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
