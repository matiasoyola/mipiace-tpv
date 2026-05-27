-- v1.3-Operativa-Extra Lote 1 · alias editable de tags.
--
-- El OWNER/MANAGER mapea slugs Holded ("01cortesypeinados") a un label
-- legible para el TPV ("Cortes y peinados") sin tener que renombrar
-- todos los productos en Holded. El TPV cachea el map en localStorage
-- y lo aplica al pintar los chips de categoría; fallback a la lógica
-- de capitalización del hotfix5 cuando no hay alias.

CREATE TABLE "tag_aliases" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "tag_aliases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tag_aliases_tenant_id_slug_key" ON "tag_aliases"("tenant_id", "slug");

ALTER TABLE "tag_aliases"
    ADD CONSTRAINT "tag_aliases_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
