-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "last_incremental_sync_at" TIMESTAMPTZ,
ADD COLUMN     "last_incremental_sync_stats" JSONB;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "token_version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "holded_contact_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nif" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "raw" JSONB,
    "last_synced_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_tenant_id_email_idx" ON "contacts"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_nif_idx" ON "contacts"("tenant_id", "nif");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_name_idx" ON "contacts"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_tenant_id_holded_contact_id_key" ON "contacts"("tenant_id", "holded_contact_id");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
