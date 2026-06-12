-- v1.5-consistencia-B §3.a · estado terminal SKIPPED para HoldedUpload.
--
-- Los tickets en modo prueba (cajero técnico) no se suben a Holded,
-- pero su fila HoldedUpload quedaba PENDING para siempre → el sweeper
-- los re-encolaba cada 5 min en bucle infinito (incidente 2026-06-11,
-- `rescued: 26` constante en prod). El worker ahora los marca SKIPPED.
--
-- Aditiva. El backfill de los PENDING existentes de tickets TEST va
-- como SQL manual en docs/blocks/v1-5-consistencia-B-done.md (no en
-- migración: toca datos, no esquema, y conviene revisarlo en prod).

ALTER TYPE "HoldedUploadStatus" ADD VALUE 'SKIPPED';
