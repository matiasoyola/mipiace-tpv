-- v1.3-SuperAdmin-Hub · Lote 3
--
-- La columna `holded_account_id` existe desde la migración init (era
-- nullable y sin uso real). En este lote pasa a ser pieza central: el
-- super-admin la cumplimenta al crear el tenant para que el hub pueda
-- enlazar directamente a https://app.holded.com/accounts/<id>.
--
-- Esta migración es defensiva e idempotente:
--   1. `ADD COLUMN IF NOT EXISTS` por si el snapshot de algún entorno
--      perdió la columna en migraciones intermedias.
--   2. Índice para que el backfill (`scripts/backfill-holded-account-id.ts`)
--      y los lookups por id en el hub no escaneen tabla completa.
--
-- No la marcamos NOT NULL: los tenants existentes pueden quedar sin
-- holdedAccountId hasta que el implantador los repase. El backfill
-- es manual (cli) porque el id sólo lo conoce el equipo de mipiacetpv
-- mirando la URL del panel Holded de cada cliente.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "holded_account_id" TEXT;

CREATE INDEX IF NOT EXISTS "tenants_holded_account_id_idx" ON "tenants" ("holded_account_id");
