-- B-Bar-Modifiers · modificadores de producto para el TPV.
--
-- Spike §14 confirmó que Holded no expone modificadores nativamente
-- (ni campo en el producto ni endpoint dedicado). Caso B: CRUD admin
-- propio per-tenant. Tres tablas nuevas y soft-delete; la columna
-- `ticket_lines.modifiers` ya existía como JSON libre y se reutiliza
-- como snapshot inmutable (acepta dos shapes — string[] legacy y
-- object[] B-Bar-Modifiers — el renderer decide por tipo).

-- ── modifier_groups ────────────────────────────────────────────────
CREATE TABLE "modifier_groups" (
    "id"          UUID         NOT NULL,
    "tenant_id"   UUID         NOT NULL,
    "name"        TEXT         NOT NULL,
    "exclusive"   BOOLEAN      NOT NULL DEFAULT TRUE,
    "required"    BOOLEAN      NOT NULL DEFAULT FALSE,
    "sort_order"  INTEGER      NOT NULL DEFAULT 0,
    "created_at"  TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at"  TIMESTAMPTZ,

    CONSTRAINT "modifier_groups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "modifier_groups_tenant_id_deleted_at_idx"
    ON "modifier_groups"("tenant_id", "deleted_at");

ALTER TABLE "modifier_groups"
    ADD CONSTRAINT "modifier_groups_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── modifiers ──────────────────────────────────────────────────────
CREATE TABLE "modifiers" (
    "id"                 UUID         NOT NULL,
    "modifier_group_id"  UUID         NOT NULL,
    "label"              TEXT         NOT NULL,
    "price_delta_cents"  INTEGER      NOT NULL DEFAULT 0,
    "sort_order"         INTEGER      NOT NULL DEFAULT 0,
    "is_default"         BOOLEAN      NOT NULL DEFAULT FALSE,
    "created_at"         TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at"         TIMESTAMPTZ,

    CONSTRAINT "modifiers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "modifiers_modifier_group_id_deleted_at_idx"
    ON "modifiers"("modifier_group_id", "deleted_at");

ALTER TABLE "modifiers"
    ADD CONSTRAINT "modifiers_modifier_group_id_fkey"
    FOREIGN KEY ("modifier_group_id") REFERENCES "modifier_groups"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ── product_modifier_groups (N:N) ──────────────────────────────────
-- PK compuesta producto+grupo. Borrar el producto o el grupo elimina
-- la fila puente sin tocar al otro lado.
CREATE TABLE "product_modifier_groups" (
    "product_id"         UUID    NOT NULL,
    "modifier_group_id"  UUID    NOT NULL,
    "sort_order"         INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_modifier_groups_pkey"
        PRIMARY KEY ("product_id", "modifier_group_id")
);

CREATE INDEX "product_modifier_groups_modifier_group_id_idx"
    ON "product_modifier_groups"("modifier_group_id");

ALTER TABLE "product_modifier_groups"
    ADD CONSTRAINT "product_modifier_groups_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "product_modifier_groups"
    ADD CONSTRAINT "product_modifier_groups_modifier_group_id_fkey"
    FOREIGN KEY ("modifier_group_id") REFERENCES "modifier_groups"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- No tocamos `ticket_lines.modifiers`: ya existía como JSONB nullable.
-- Las filas históricas (string[] legacy) siguen siendo válidas; las
-- nuevas filas pueden poblarlo con el shape estructurado.
