-- v1.7-alias-cajeros: alias visible del cajero. Migración aditiva, sin
-- ventana de mantenimiento. Backfill: local-part del email (lo anterior
-- a la @) truncada a 40 chars, para que los usuarios existentes tengan
-- un alias razonable en tickets e informes hasta que el admin los edite.
ALTER TABLE "users" ADD COLUMN "alias" TEXT;

UPDATE "users" SET "alias" = LEFT(SPLIT_PART("email", '@', 1), 40);
