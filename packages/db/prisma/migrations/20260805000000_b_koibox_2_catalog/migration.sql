-- B-koibox-2 · Catálogo de servicios extendido.
--
-- Capa de EXTENSIÓN local sobre el catálogo de Holded (ADR-K1): NO crea
-- una tabla `Service` paralela. Precio/IVA/alta siguen en Holded
-- (product.kind=SERVICE). Migración ADITIVA: no toca datos existentes ni
-- el sync de catálogo ni el camino de cobro. Backfill vacío (las tablas
-- nacen sin filas; se rellenan por servicio desde el panel de admin).
--
--   * tenants.agenda_enabled — capability flag por tenant (ADR-K6, este
--     bloque es el OWNER de la columna; default OFF).
--   * service_scheduling — datos de agenda por servicio (duración,
--     buffers, nº de profesionales, familia, flags de canal). PK = FK al
--     producto: la extensión ES el producto (relación 1:1).
--   * resources — cabinas/salas/aparatos reservables (vocabulario neutro).
--   * service_resource_needs — un servicio requiere N recursos de un tipo.

-- CreateEnum
CREATE TYPE "ResourceKind" AS ENUM ('CABIN', 'ROOM', 'DEVICE');

-- AlterTable
ALTER TABLE "tenants"
    ADD COLUMN "agenda_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "service_scheduling" (
    "product_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "duration_min" INTEGER NOT NULL,
    "buffer_before_min" INTEGER NOT NULL DEFAULT 0,
    "buffer_after_min" INTEGER NOT NULL DEFAULT 0,
    "staff_required" INTEGER NOT NULL DEFAULT 1,
    "online_bookable" BOOLEAN NOT NULL DEFAULT false,
    "family" TEXT,
    "channels" JSONB NOT NULL DEFAULT '{"caja": true, "ticket": true, "agenda": true, "online": false}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "service_scheduling_pkey" PRIMARY KEY ("product_id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "ResourceKind" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_resource_needs" (
    "service_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "resource_kind" "ResourceKind" NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "service_resource_needs_pkey" PRIMARY KEY ("service_id", "resource_kind")
);

-- CreateIndex
CREATE INDEX "service_scheduling_tenant_id_idx" ON "service_scheduling"("tenant_id");

-- CreateIndex
CREATE INDEX "resources_tenant_id_idx" ON "resources"("tenant_id");

-- CreateIndex
CREATE INDEX "resources_tenant_id_kind_idx" ON "resources"("tenant_id", "kind");

-- CreateIndex
CREATE INDEX "service_resource_needs_tenant_id_idx" ON "service_resource_needs"("tenant_id");

-- AddForeignKey
ALTER TABLE "service_scheduling" ADD CONSTRAINT "service_scheduling_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_scheduling" ADD CONSTRAINT "service_scheduling_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_resource_needs" ADD CONSTRAINT "service_resource_needs_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
