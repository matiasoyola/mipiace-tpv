-- v1.9-sync-borrados: timestamp de soft-archive por borrado en Holded.
-- Migración aditiva, sin ventana de mantenimiento. Sin backfill: los
-- productos ya inactivos por huérfanos previos quedan con NULL — el
-- one-shot de conciliación post-deploy los re-marca si siguen fuera
-- del listado de Holded.
ALTER TABLE "products" ADD COLUMN "archived_from_holded_at" TIMESTAMPTZ;
