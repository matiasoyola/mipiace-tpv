-- pin-1 · MI PIN LO ELIJO YO.
--
-- Dos cosas, y las dos aditivas:
--
--   1. `users.pin_provisional_at` — la marca de «este PIN no es suyo
--      todavía»;
--   2. `pin_changes` — el registro de quién le cambió el PIN a quién, sin
--      el PIN.
--
-- ── LO QUE PASA CON LOS PIN QUE YA EXISTEN ──────────────────────────
--
-- Nada. La columna es NULLABLE y **sin DEFAULT**, y `NULL` significa «PIN
-- propio». Las quince cajas en producción, los PIN de la propietaria de
-- Sirope y los de la clínica de Sole siguen entrando al TPV el minuto
-- siguiente al despliegue, sin tocarlos.
--
-- Ésa es la dirección correcta del default y no la contraria: marcar los
-- PIN de hoy como provisionales habría obligado a 21 personas de una
-- residencia y a toda la barra de un bar a elegir PIN nuevo el día del
-- despliegue, delante de la cola. El bloque existe para que cada uno
-- pueda elegir el suyo, no para forzarlo.
--
-- ── EL CHECK, Y POR QUÉ ESTÁ ESCRITO ASÍ ────────────────────────────
--
-- `pin_provisional_at IS NOT NULL` sin `pin_hash` es una fila sin
-- sentido: una marca de «tiene un PIN prestado» sobre alguien que no
-- tiene PIN. Se cierra en el motor.
--
-- Escrito con `IS NULL` / `IS NOT NULL` a propósito: **un CHECK que
-- evalúa a NULL PASA**, así que cualquier comparación con `=` sobre una
-- columna nullable no cierra nada. Las dos ramas de este CHECK dan
-- siempre TRUE o FALSE.
--
-- El CHECK tiene una consecuencia en el código, y está puesta: revocar a
-- un cajero (`DELETE /cashiers/:id`) y purgar el cajero técnico
-- (`purgeTestData`) ponen `pin_hash = NULL`, así que los dos limpian
-- `pin_provisional_at` en la misma escritura. Sin eso, revocar a alguien
-- con PIN provisional reventaría contra la base.

ALTER TABLE "users" ADD COLUMN "pin_provisional_at" TIMESTAMPTZ;

ALTER TABLE "users"
  ADD CONSTRAINT "users_pin_provisional_exige_pin"
  CHECK ("pin_provisional_at" IS NULL OR "pin_hash" IS NOT NULL);

-- ── EL REGISTRO ─────────────────────────────────────────────────────
--
-- `kind` dice qué quedó puesto (propio o prestado) y `source` por dónde
-- se hizo. `SOPORTE` es el que hay que poder mirar: es Mi Piace entrando
-- con «Configurar como OWNER».
--
-- Ni el PIN ni su hash están aquí, y no caben: no hay columna donde
-- ponerlos.

CREATE TYPE "PinChangeKind" AS ENUM ('PROPIO', 'PROVISIONAL');
CREATE TYPE "PinChangeSource" AS ENUM ('PANEL', 'TPV', 'PERSONAL', 'SOPORTE');

CREATE TABLE "pin_changes" (
  "id"             UUID NOT NULL,
  "tenant_id"      UUID NOT NULL,
  "target_user_id" UUID NOT NULL,
  -- NULL sólo si esa persona se borra en duro DESPUÉS (ver el ON DELETE
  -- SET NULL de abajo). Al escribir la fila siempre hay alguien.
  "actor_user_id"  UUID,
  "kind"           "PinChangeKind" NOT NULL,
  "source"         "PinChangeSource" NOT NULL,
  "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT "pin_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pin_changes_tenant_id_created_at_idx"
  ON "pin_changes" ("tenant_id", "created_at");
CREATE INDEX "pin_changes_target_user_id_created_at_idx"
  ON "pin_changes" ("target_user_id", "created_at");

ALTER TABLE "pin_changes"
  ADD CONSTRAINT "pin_changes_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- CASCADE al usuario: esto es el historial de una CREDENCIAL, el mismo
-- criterio que `care_pins`. Lo que no se va con la persona es lo que
-- firmó, y eso lo impiden los RESTRICT de autoría (`clinical_entries`,
-- `care_records`, `incidents`…).
ALTER TABLE "pin_changes"
  ADD CONSTRAINT "pin_changes_target_user_id_fkey"
  FOREIGN KEY ("target_user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- SET NULL al actor: dar de baja a la encargada que puso un PIN
-- provisional no puede borrar que se puso.
ALTER TABLE "pin_changes"
  ADD CONSTRAINT "pin_changes_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
