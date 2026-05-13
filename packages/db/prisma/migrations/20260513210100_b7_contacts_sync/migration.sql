-- B7 §8 · Sync completo de contactos.
--
-- Holded sólo expone filtros server-side por phone/mobile/customId
-- (spike §10). La búsqueda por nombre desde el TPV obliga a tener
-- todos los contactos del tenant en la tabla local. Esta migración
-- alinea Contact con la semántica de productos:
--
--   - `active` (default true): los huérfanos del último sync quedan
--     en false; los conservamos por trazabilidad de tickets pasados.
--   - `last_seen_in_sync_at`: timestamp del último sync que vio el
--     contacto en Holded. El cron incremental usa este campo para
--     marcar huérfanos al final de cada ronda.
--
-- En Tenant añadimos `last_contacts_sync_at` para que el admin pueda
-- mostrar "última actualización de contactos: hace X min" — separado
-- del `lastIncrementalSyncAt` general.

ALTER TABLE "contacts"
    ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "last_seen_in_sync_at" TIMESTAMPTZ;

ALTER TABLE "tenants"
    ADD COLUMN "last_contacts_sync_at" TIMESTAMPTZ;
