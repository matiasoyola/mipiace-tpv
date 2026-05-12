-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'MANAGER', 'CASHIER');

-- CreateEnum
CREATE TYPE "HoldedAuthMode" AS ENUM ('API_KEY', 'OAUTH');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('DRAFT', 'PAID', 'PENDING_SYNC', 'SYNCED', 'SYNC_FAILED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'BIZUM', 'VOUCHER', 'OTHER');

-- CreateEnum
CREATE TYPE "ProductKind" AS ENUM ('PRODUCT', 'SERVICE');

-- CreateEnum
CREATE TYPE "SyncOutboxKind" AS ENUM ('UPLOAD_TICKET', 'UPLOAD_REFUND', 'CATALOG_SYNC');

-- CreateEnum
CREATE TYPE "SyncOutboxStatus" AS ENUM ('PENDING', 'DONE', 'DEAD');

-- CreateEnum
CREATE TYPE "HoldedUploadKind" AS ENUM ('TICKET', 'REFUND');

-- CreateEnum
CREATE TYPE "HoldedUploadStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "InitialSyncStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "holded_account_id" TEXT,
    "holded_auth_mode" "HoldedAuthMode" NOT NULL DEFAULT 'API_KEY',
    "holded_api_key_ciphertext" TEXT,
    "holded_oauth_access" TEXT,
    "holded_oauth_refresh" TEXT,
    "holded_oauth_expires_at" TIMESTAMPTZ,
    "fiscal_profile" JSONB,
    "initial_sync_status" "InitialSyncStatus" NOT NULL DEFAULT 'PENDING',
    "initial_sync_started_at" TIMESTAMPTZ,
    "initial_sync_completed_at" TIMESTAMPTZ,
    "initial_sync_stats" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_taxes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "holded_tax_id" TEXT NOT NULL,
    "rate" DECIMAL(5,2),
    "name" TEXT,
    "raw" JSONB,
    "synced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_taxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "pin_hash" TEXT,
    "role" "UserRole" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_login_at" TIMESTAMPTZ,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "fiscal_address" JSONB,
    "warehouse_holded_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registers" (
    "id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "num_serie_holded" TEXT,
    "ticket_counter" INTEGER NOT NULL DEFAULT 0,
    "printer_config" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "register_id" UUID NOT NULL,
    "name" TEXT,
    "paired_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ,
    "user_agent" TEXT,
    "device_token_hash" TEXT NOT NULL,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pairing_codes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "register_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "consumed_at" TIMESTAMPTZ,
    "consumed_by_device_id" UUID,

    CONSTRAINT "pairing_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "holded_product_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    "base_price" DECIMAL(10,2) NOT NULL,
    "tax_rate" DECIMAL(5,2) NOT NULL,
    "kind" "ProductKind" NOT NULL DEFAULT 'PRODUCT',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sku_auto_assigned_at" TIMESTAMPTZ,
    "needs_sku_review" BOOLEAN NOT NULL DEFAULT false,
    "sellable_via_tpv" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw" JSONB,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "holded_variant_id" TEXT,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    "price_override" DECIMAL(10,2),
    "stock" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "warehouses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "holded_warehouse_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" UUID NOT NULL,
    "register_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "opened_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ,
    "cash_opening" DECIMAL(10,2) NOT NULL,
    "cash_counted" DECIMAL(10,2),
    "z_report_pdf_path" TEXT,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tickets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "register_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "internal_number" TEXT NOT NULL,
    "external_id" UUID NOT NULL,
    "contact_holded_id" TEXT,
    "status" "TicketStatus" NOT NULL DEFAULT 'DRAFT',
    "total" DECIMAL(10,2) NOT NULL,
    "total_tax" DECIMAL(10,2) NOT NULL,
    "total_discount" DECIMAL(10,2) NOT NULL,
    "holded_document_id" TEXT,
    "holded_pdf_url" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ,
    "synced_at" TIMESTAMPTZ,
    "sync_error" JSONB,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_lines" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "product_id" UUID,
    "variant_id" UUID,
    "name_snapshot" TEXT NOT NULL,
    "units" DECIMAL(10,3) NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "discount_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "tax_rate" DECIMAL(5,2) NOT NULL,
    "subtotal" DECIMAL(10,2) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "ticket_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_payments" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "meta" JSONB,

    CONSTRAINT "ticket_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "original_ticket_id" UUID NOT NULL,
    "internal_number" TEXT NOT NULL,
    "external_id" UUID NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "holded_document_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_lines" (
    "id" UUID NOT NULL,
    "refund_id" UUID NOT NULL,
    "ticket_line_id" UUID NOT NULL,
    "units" DECIMAL(10,3) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "refund_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_outbox" (
    "id" BIGSERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" "SyncOutboxKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" JSONB,
    "status" "SyncOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sync_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holded_uploads" (
    "external_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" "HoldedUploadKind" NOT NULL,
    "holded_document_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ,
    "status" "HoldedUploadStatus" NOT NULL DEFAULT 'PENDING',
    "last_error" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "holded_uploads_pkey" PRIMARY KEY ("external_id")
);

-- CreateIndex
CREATE INDEX "tenant_taxes_tenant_id_rate_idx" ON "tenant_taxes"("tenant_id", "rate");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_taxes_tenant_id_holded_tax_id_key" ON "tenant_taxes"("tenant_id", "holded_tax_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE INDEX "stores_tenant_id_idx" ON "stores"("tenant_id");

-- CreateIndex
CREATE INDEX "registers_store_id_idx" ON "registers"("store_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_device_token_hash_key" ON "devices"("device_token_hash");

-- CreateIndex
CREATE INDEX "devices_tenant_id_idx" ON "devices"("tenant_id");

-- CreateIndex
CREATE INDEX "devices_register_id_idx" ON "devices"("register_id");

-- CreateIndex
CREATE INDEX "pairing_codes_register_id_idx" ON "pairing_codes"("register_id");

-- CreateIndex
CREATE INDEX "pairing_codes_expires_at_idx" ON "pairing_codes"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "pairing_codes_tenant_id_code_key" ON "pairing_codes"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "products_tenant_id_barcode_idx" ON "products"("tenant_id", "barcode");

-- CreateIndex
CREATE INDEX "products_tenant_id_sku_idx" ON "products"("tenant_id", "sku");

-- CreateIndex
CREATE INDEX "products_tenant_id_needs_sku_review_idx" ON "products"("tenant_id", "needs_sku_review");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_holded_product_id_key" ON "products"("tenant_id", "holded_product_id");

-- CreateIndex
CREATE INDEX "product_variants_product_id_idx" ON "product_variants"("product_id");

-- CreateIndex
CREATE INDEX "product_variants_barcode_idx" ON "product_variants"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "warehouses_tenant_id_holded_warehouse_id_key" ON "warehouses"("tenant_id", "holded_warehouse_id");

-- CreateIndex
CREATE INDEX "shifts_register_id_opened_at_idx" ON "shifts"("register_id", "opened_at");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_external_id_key" ON "tickets"("external_id");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_status_idx" ON "tickets"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "tickets_tenant_id_created_at_idx" ON "tickets"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_register_id_internal_number_key" ON "tickets"("register_id", "internal_number");

-- CreateIndex
CREATE INDEX "ticket_lines_ticket_id_idx" ON "ticket_lines"("ticket_id");

-- CreateIndex
CREATE INDEX "ticket_payments_ticket_id_idx" ON "ticket_payments"("ticket_id");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_external_id_key" ON "refunds"("external_id");

-- CreateIndex
CREATE INDEX "refunds_original_ticket_id_idx" ON "refunds"("original_ticket_id");

-- CreateIndex
CREATE INDEX "refund_lines_refund_id_idx" ON "refund_lines"("refund_id");

-- CreateIndex
CREATE INDEX "sync_outbox_status_next_attempt_at_idx" ON "sync_outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "sync_outbox_tenant_id_status_idx" ON "sync_outbox"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "holded_uploads_tenant_id_status_idx" ON "holded_uploads"("tenant_id", "status");

-- AddForeignKey
ALTER TABLE "tenant_taxes" ADD CONSTRAINT "tenant_taxes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registers" ADD CONSTRAINT "registers_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_register_id_fkey" FOREIGN KEY ("register_id") REFERENCES "registers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_register_id_fkey" FOREIGN KEY ("register_id") REFERENCES "registers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_consumed_by_device_id_fkey" FOREIGN KEY ("consumed_by_device_id") REFERENCES "devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "warehouses" ADD CONSTRAINT "warehouses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_register_id_fkey" FOREIGN KEY ("register_id") REFERENCES "registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_register_id_fkey" FOREIGN KEY ("register_id") REFERENCES "registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_lines" ADD CONSTRAINT "ticket_lines_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_lines" ADD CONSTRAINT "ticket_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_lines" ADD CONSTRAINT "ticket_lines_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_payments" ADD CONSTRAINT "ticket_payments_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_original_ticket_id_fkey" FOREIGN KEY ("original_ticket_id") REFERENCES "tickets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_lines" ADD CONSTRAINT "refund_lines_refund_id_fkey" FOREIGN KEY ("refund_id") REFERENCES "refunds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refund_lines" ADD CONSTRAINT "refund_lines_ticket_line_id_fkey" FOREIGN KEY ("ticket_line_id") REFERENCES "ticket_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_outbox" ADD CONSTRAINT "sync_outbox_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holded_uploads" ADD CONSTRAINT "holded_uploads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
