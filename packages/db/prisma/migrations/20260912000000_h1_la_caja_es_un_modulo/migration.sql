-- H1 · la caja es un módulo (ADR-016).
--
-- Mi Piace abre un producto que se vende sin caja (el control horario del
-- personal). Para que eso exista hace falta, antes que nada, que un tenant
-- pueda existir, activarse y entrar en su panel SIN caja y SIN Holded.
-- Esta migración es lo único que ese nivel 1 necesita de la base de datos.
--
-- Migración ADITIVA. No toca ni una fila existente más allá del backfill
-- del propio DEFAULT, y ese backfill deja a todos los tenants de hoy
-- EXACTAMENTE como estaban: con caja.
--
-- Dos piezas:
--
--   1. `tenants.caja_enabled` — la capability. Hermana en forma de
--      `crm_enabled` y `agenda_enabled` (ADR-R6: columna booleana por
--      tenant, no jsonb ni un `business_type` nuevo), pero de gobierno
--      distinto: la mueve el super-admin, no el panel del cliente.
--   2. `InitialSyncStatus.NOT_APPLICABLE` — el estado del sync del tenant
--      que NUNCA va a sincronizar porque no tiene Holded.
--
-- Por qué NOT_APPLICABLE y no reutilizar DONE ni dejar PENDING:
--   · DONE mentiría, y además es el filtro literal del cron incremental
--     (`workers/catalog-incremental-worker.ts:72`) y del script de
--     reconciliación: un tenant sin Holded marcado DONE entraría en la
--     barredera cada 15 minutos.
--   · PENDING parece un sync a medias: el panel del super-admin lo pinta
--     como "esperando" y el implantador se queda esperando algo que no ha
--     empezado nunca.
-- Con NOT_APPLICABLE ningún cron ni worker necesita cambio: los dos que
-- barren tenants ya filtran por `initial_sync_status = 'DONE'` y por
-- `holded_api_key_ciphertext IS NOT NULL`, y este valor no entra por
-- ninguna de las dos puertas.

-- ── 1 · el valor nuevo del enum ────────────────────────────────────────
--
-- Va primero y en su propio statement: `ALTER TYPE ... ADD VALUE` no
-- puede convivir en la misma transacción con una sentencia que LEA el
-- valor nuevo (PG < 12 ni siquiera lo permite dentro de un bloque). Aquí
-- no hay ningún UPDATE que lo use, así que el orden basta.

ALTER TYPE "InitialSyncStatus" ADD VALUE IF NOT EXISTS 'NOT_APPLICABLE';

-- ── 2 · la capability, con su backfill ─────────────────────────────────
--
-- El backfill ES el DEFAULT: desde PG 11 un `ADD COLUMN ... NOT NULL
-- DEFAULT <constante>` no reescribe la tabla, guarda el default en el
-- catálogo y lo sirve a las filas antiguas. Sin bloqueo largo y sin
-- UPDATE masivo. `tenants` tiene decenas de filas, no millones, pero el
-- criterio es el mismo.

ALTER TABLE "tenants" ADD COLUMN "caja_enabled" BOOLEAN NOT NULL DEFAULT true;
