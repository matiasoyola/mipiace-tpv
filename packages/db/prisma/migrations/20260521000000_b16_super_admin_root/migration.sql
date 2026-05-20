-- Lote 3 (v1.1 Thalia) · flag `is_root` en super_admin_users
--
-- Distinción dentro del conjunto de super-admins: el "root" es el
-- super-admin que puede invitar/eliminar a otros super-admins. El
-- resto sólo opera tenants (la mayoría del trabajo diario) — útil
-- cuando invitemos al equipo de Holded como super-admins sin que
-- puedan modificar el grupo.
--
-- Backfill: el super-admin más antiguo (createdAt mínimo) que NO
-- esté soft-deleted se marca como root. En este deployment hay un
-- único super-admin operativo (Matías, m.oyola@mipiace.es). Si el
-- run lo aplica sobre una BD donde ya hay varios super-admins activos
-- y no podemos decidir cuál es root, ambos se quedarán en false y
-- habrá que promover manualmente con SQL — mejor pecar de conservador
-- que dar root accidental.

ALTER TABLE "super_admin_users"
  ADD COLUMN "is_root" BOOLEAN NOT NULL DEFAULT false;

-- Promoción del super-admin original. Limitado a 1 con LIMIT 1 +
-- ORDER BY created_at ASC; si hubiera empate por timestamp (insert
-- simultáneo en seed legacy), el id desempata estable.
UPDATE "super_admin_users"
SET "is_root" = true
WHERE "id" = (
  SELECT "id" FROM "super_admin_users"
  WHERE "deleted_at" IS NULL
  ORDER BY "created_at" ASC, "id" ASC
  LIMIT 1
);
