-- v1.4-Buscador-Contactos · clasifica los contactos del tenant por
-- tipo de Holded para que el TPV sólo muestre clientes.
--
-- Antes del cambio el buscador del TPV listaba CUALQUIER contacto
-- sincronizado, incluyendo proveedores, leads, autónomos y deudores.
-- Operativamente confundía a la cajera (vio al distribuidor de tintes
-- al buscar una clienta) y exponía datos personales innecesarios.
--
-- Holded distingue `type` (`client | supplier | lead | debtor |
-- creditor`) en cada contacto. Persistimos esa clasificación localmente
-- para poder filtrarla en search sin pegar al `raw` JSON cada vez.
--
-- Nullable porque los contactos preexistentes no tienen el dato hasta
-- que corra el backfill `apps/api/src/scripts/backfill-contact-type.ts`.
-- Tras el backfill todos quedan poblados (UNKNOWN si el raw no traía
-- type) y el filtro por defecto `type IN (CLIENT, UNKNOWN)` es seguro.

CREATE TYPE "ContactType" AS ENUM (
    'CLIENT',
    'SUPPLIER',
    'LEAD',
    'DEBTOR',
    'CREDITOR',
    'UNKNOWN'
);

ALTER TABLE "contacts"
    ADD COLUMN "type" "ContactType";

CREATE INDEX "contacts_tenant_id_type_idx" ON "contacts"("tenant_id", "type");
