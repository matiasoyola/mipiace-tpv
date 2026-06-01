-- v1.4-Bar-Operativa-MVP Lote 2 · comanderas por sección.
--
-- Cuando el camarero pulsa "Enviar comanda" en una mesa abierta, el
-- backend agrupa las líneas por sección (BARRA, COCINA, SALON) y
-- genera un PDF por sección. El cruce se hace contra el mapa de tags
-- de producto. Esta migración crea:
--
--   - enum KitchenSection (BARRA | COCINA | SALON)
--   - tabla tag_sections (tenantId, slug, section) con unique
--   - tickets.last_sent_at + tickets.last_sent_revision para detectar
--     si ya se ha enviado y mostrar "Reenviar" en gris en el TPV.

CREATE TYPE "KitchenSection" AS ENUM ('BARRA', 'COCINA', 'SALON');

CREATE TABLE "tag_sections" (
    "id"         UUID NOT NULL,
    "tenant_id"  UUID NOT NULL,
    "slug"       VARCHAR(60) NOT NULL,
    "section"    "KitchenSection" NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tag_sections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tag_sections_tenant_id_slug_key"
    ON "tag_sections"("tenant_id", "slug");

ALTER TABLE "tag_sections"
    ADD CONSTRAINT "tag_sections_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "tickets"
    ADD COLUMN "last_sent_at"       TIMESTAMPTZ,
    ADD COLUMN "last_sent_revision" INTEGER NOT NULL DEFAULT 0;
