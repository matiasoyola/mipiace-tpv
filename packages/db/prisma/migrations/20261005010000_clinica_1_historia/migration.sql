-- clinica-1 · la historia clínica no se borra, y el motor lo hace cumplir.
--
-- Ley 41/2002 (arts. 15-19) y art. 9 RGPD: la historia clínica se conserva
-- (mínimo 5 años desde el alta de cada proceso), tiene autoría y fecha por
-- línea, sólo accede quien debe, y **todo acceso queda registrado**.
--
-- Esta migración trae esas cuatro garantías DONDE TIENEN QUE ESTAR: en el
-- motor. Es la misma razón de `s1_sello_de_la_venta` (ADR-015 §1) y de
-- `fichaje_1_registro` (ADR-018): la aplicación no es la única puerta a
-- Postgres, y una historia que sólo es inalterable mientras el código se
-- porte bien no es inalterable. El día que a alguien le pidan la historia
-- de un paciente en un juzgado, lo que la defiende es el trigger.
--
-- Cinco piezas:
--
--   0. Los enums.
--   1. `clinical_access`     · quién puede ver la historia de quién, con
--                              su histórico de concesiones y revocaciones.
--   2. `clinical_access_log` · quién la ha abierto. SÓLO INSERCIONES.
--   3. `clinical_entries` + `clinical_addenda` · la historia. INMUTABLE.
--   4. Los triggers y las FKs RESTRICT que lo sostienen.
--
-- SQL a mano porque Prisma no expresa triggers, funciones ni índices
-- parciales. Mismo patrón que las dos migraciones citadas arriba.
--
-- Migración ADITIVA: crea objetos nuevos y no toca ni una fila ni una
-- columna de lo que ya existe. Un tenant de hoy tiene
-- `clinical_records_enabled = false` (migración hermana
-- `20261005000000_clinica_1_modulo`) y estas tablas se quedan vacías para
-- siempre.
--
-- ── RESTRICT y no CASCADE ─────────────────────────────────────────────
--
-- Las cuatro tablas cuelgan de `clients` y de `tenants` con **ON DELETE
-- RESTRICT**. Es la diferencia de fondo con `client_consents` y
-- `client_technical_notes`, que son CASCADE: aquello se puede perder con
-- la ficha, esto no. Consecuencia buscada y declarada: un cliente con
-- historia no se borra, y un tenant con historia no se borra. Postgres lo
-- niega con un error de FK antes de que ningún `deleteMany` llegue a
-- correr.
--
-- ── El `down`, pensado ────────────────────────────────────────────────
--
-- Reversible por completo MIENTRAS LAS TABLAS ESTÉN VACÍAS, que es el
-- único momento en que tiene sentido echarla atrás (con historia dentro,
-- el `down` ES el borrado que esta migración existe para impedir):
--
--   DROP TRIGGER "clinical_addenda_inmutable"      ON "clinical_addenda";
--   DROP TRIGGER "clinical_entries_inmutable"      ON "clinical_entries";
--   DROP TRIGGER "clinical_access_log_append_only" ON "clinical_access_log";
--   DROP TRIGGER "clinical_access_guard"           ON "clinical_access";
--   DROP FUNCTION mipiacetpv_clinical_inmutable();
--   DROP FUNCTION mipiacetpv_clinical_access_log_append_only();
--   DROP FUNCTION mipiacetpv_clinical_access_guard();
--   DROP TABLE "clinical_addenda";
--   DROP TABLE "clinical_entries";
--   DROP TABLE "clinical_access_log";
--   DROP TABLE "clinical_access";
--   ALTER TABLE "users" DROP CONSTRAINT "users_clinician_implies_flag";
--   DROP TYPE "ClinicalEntryKind";
--   DROP TYPE "ClinicalAccessOutcome";
--   DROP TYPE "ClinicalAccessAction";
--   DROP TYPE "ClinicalAccessSource";
--
-- Con filas dentro, los `DROP TABLE` pasan igual (un DROP no dispara el
-- trigger de DELETE) y eso es exactamente por lo que un `down` de esta
-- migración no es una operación de rutina: es tirar un registro legal. Se
-- hace con copia de seguridad delante y por decisión escrita, no porque
-- un script de despliegue lo encadene.

-- ── 0 · los enums ──────────────────────────────────────────────────────

-- De dónde vino el acceso. `APPOINTMENT` lo crea la agenda sola al
-- asignarle una cita al sanitario; `MANUAL` lo da la dueña o el encargado
-- a mano. Se guarda porque la pantalla de personal tiene que poder decir
-- "este paciente entró por la agenda" y "este lo metiste tú".
CREATE TYPE "ClinicalAccessSource" AS ENUM ('APPOINTMENT', 'MANUAL');

-- Qué se hizo con la historia. `EXPORT` todavía no lo usa ninguna ruta
-- (el informe PDF es un bloque posterior) y entra ya para que el registro
-- no cambie de forma cuando llegue.
CREATE TYPE "ClinicalAccessAction" AS ENUM ('READ', 'WRITE', 'EXPORT');

-- Y cómo acabó. **Los intentos denegados también se apuntan**: un acceso
-- que se niega es justo el que interesa ver en el registro, y un registro
-- que sólo guarda los éxitos no contesta la pregunta por la que existe.
CREATE TYPE "ClinicalAccessOutcome" AS ENUM ('ALLOWED', 'DENIED');

-- Qué clase de pieza de historia es. Hoy sólo la anotación; la valoración
-- inicial, la exploración, la sesión y las fotos son bloques siguientes y
-- entrarán como valores nuevos de este enum.
CREATE TYPE "ClinicalEntryKind" AS ENUM ('NOTE');

-- ── 1 · quién puede ver la historia de quién ───────────────────────────
--
-- NO SE BORRA NUNCA. Revocar rellena `revoked_at`; volver a dar acceso
-- crea OTRA FILA. Así el histórico contesta siempre "quién pudo ver qué y
-- cuándo", que es lo que se le enseña a un inspector o a un paciente.
CREATE TABLE "clinical_access" (
    "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"          UUID NOT NULL,
    "clinician_user_id"  UUID NOT NULL,
    "client_id"          UUID NOT NULL,
    "source"             "ClinicalAccessSource" NOT NULL,
    "granted_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- NULL cuando el acceso nace de la agenda: ahí no lo concede una
    -- persona, lo concede el hecho de que le asignaron la cita.
    "granted_by_user_id" UUID,
    "revoked_at"         TIMESTAMPTZ,
    "revoked_by_user_id" UUID,

    CONSTRAINT "clinical_access_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "clinical_access_client_id_fkey"
        FOREIGN KEY ("client_id") REFERENCES "clients"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "clinical_access_clinician_user_id_fkey"
        FOREIGN KEY ("clinician_user_id") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    -- SET NULL en los dos "por quién": si el usuario que concedió o
    -- revocó desapareciera, el acceso sigue siendo un hecho. Hoy no
    -- desaparece ninguno (la baja de un cajero es soft-delete), y aun así
    -- la fila no puede depender de eso para existir.
    CONSTRAINT "clinical_access_granted_by_user_id_fkey"
        FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "clinical_access_revoked_by_user_id_fkey"
        FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,

    -- Un acceso a mano lo da ALGUIEN y queda su nombre. Uno de la agenda
    -- no lo da nadie. Sin este CHECK, "lo metió la dueña" y "lo puso la
    -- cita" serían indistinguibles en cuanto alguien olvidara el campo.
    CONSTRAINT "clinical_access_source_grantor"
        CHECK (
            ("source" = 'MANUAL'      AND "granted_by_user_id" IS NOT NULL)
         OR ("source" = 'APPOINTMENT' AND "granted_by_user_id" IS NULL)
        ),
    -- Revocar es un acto de una persona: si hay fecha, hay firma.
    CONSTRAINT "clinical_access_revocation_signed"
        CHECK (("revoked_at" IS NULL) = ("revoked_by_user_id" IS NULL)),
    CONSTRAINT "clinical_access_revoked_after_granted"
        CHECK ("revoked_at" IS NULL OR "revoked_at" >= "granted_at")
);

-- UN ACCESO VIGENTE POR (SANITARIO, PACIENTE), garantizado POR LA BASE.
--
-- Es el índice que convierte "se crea el acceso si no hay uno vigente" en
-- algo que no depende de un `if`. El enganche de la agenda inserta con
-- `ON CONFLICT ... DO NOTHING` contra este índice, así que:
--
--   · mover una cita conservando a su profesional NO crea filas nuevas;
--   · dos citas a la vez desde dos terminales no crean dos accesos;
--   · y una fila REVOCADA no bloquea nada, porque el índice es parcial:
--     tras una revocación, una cita nueva con ese paciente inserta otra
--     fila y el sanitario recupera el acceso. La revocación se queda en
--     el histórico, que es donde tiene que quedarse.
CREATE UNIQUE INDEX "clinical_access_one_live_key"
    ON "clinical_access"("clinician_user_id", "client_id")
    WHERE "revoked_at" IS NULL;

CREATE INDEX "clinical_access_tenant_id_client_id_idx"
    ON "clinical_access"("tenant_id", "client_id");
CREATE INDEX "clinical_access_clinician_user_id_revoked_at_idx"
    ON "clinical_access"("clinician_user_id", "revoked_at");

-- ── 2 · el registro de accesos ─────────────────────────────────────────
--
-- SÓLO INSERCIONES. Ni UPDATE ni DELETE, desde la aplicación ni desde
-- psql. Si se pudiera editar o borrar, valdría lo mismo que no tenerlo.
--
-- Y lo que NO lleva, a propósito: **nada de salud**. Ni el cuerpo de la
-- anotación, ni el diagnóstico, ni el motivo. Quién, a qué paciente,
-- cuándo, desde qué aparato y si se le dejó. Un registro de accesos que
-- guardara el contenido sería una segunda copia de la historia sin
-- ninguna de sus protecciones.
CREATE TABLE "clinical_access_log" (
    "id"        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "user_id"   UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "action"    "ClinicalAccessAction" NOT NULL,
    "outcome"   "ClinicalAccessOutcome" NOT NULL,
    "at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- El terminal desde el que se abrió, cuando la petición viene del TPV.
    -- NULL desde el panel (ahí no hay device).
    "device_id" UUID,
    -- La ruta, sin querystring. Es trazabilidad, no contenido: dice si se
    -- listó la historia o se creó una anotación. Lo rellena el envoltorio
    -- del punto 4 de la aplicación, no cada handler.
    "route"     TEXT,

    CONSTRAINT "clinical_access_log_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "clinical_access_log_client_id_fkey"
        FOREIGN KEY ("client_id") REFERENCES "clients"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "clinical_access_log_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "clinical_access_log_device_id_fkey"
        FOREIGN KEY ("device_id") REFERENCES "devices"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

-- El orden de la ruta "quién ha abierto la historia de este paciente":
-- por paciente y lo más reciente primero.
CREATE INDEX "clinical_access_log_tenant_id_client_id_at_idx"
    ON "clinical_access_log"("tenant_id", "client_id", "at" DESC);
-- Y el de la pregunta simétrica: "qué ha abierto esta persona".
CREATE INDEX "clinical_access_log_tenant_id_user_id_at_idx"
    ON "clinical_access_log"("tenant_id", "user_id", "at" DESC);

-- ── 3 · la historia ────────────────────────────────────────────────────
--
-- INMUTABLE: una entrada no se edita y no se borra. Se le añaden
-- anotaciones (`clinical_addenda`), cada una con su autor y su fecha. Es
-- el mismo principio del sello de la venta (ADR-015) y del registro de
-- jornada (ADR-018), aplicado a lo que la ley protege con más fuerza.
CREATE TABLE "clinical_entries" (
    "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"      UUID NOT NULL,
    "client_id"      UUID NOT NULL,
    -- LA AUTORÍA. NOT NULL y RESTRICT: una línea de historia sin autor no
    -- es historia clínica, es una nota anónima.
    "author_user_id" UUID NOT NULL,
    -- De qué cita salió, si salió de una. Opcional: una anotación puede
    -- escribirse sin cita delante (una llamada del paciente).
    "appointment_id" UUID,
    "kind"           "ClinicalEntryKind" NOT NULL DEFAULT 'NOTE',
    -- JSON y no texto: lo que viene (valoración, exploración con el mapa
    -- del pie, sesión) es estructurado, y cambiar la forma del cuerpo
    -- dentro de un JSON no exige migrar una tabla append-only.
    "body"           JSONB NOT NULL,
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "clinical_entries_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "clinical_entries_client_id_fkey"
        FOREIGN KEY ("client_id") REFERENCES "clients"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "clinical_entries_author_user_id_fkey"
        FOREIGN KEY ("author_user_id") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    -- SET NULL: si una cita desapareciera, la anotación que se escribió
    -- en ella sigue siendo parte de la historia. Pierde el enlace, no el
    -- contenido.
    CONSTRAINT "clinical_entries_appointment_id_fkey"
        FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    -- Un cuerpo vacío no es una anotación. `'{}'::jsonb` y `'null'::jsonb`
    -- pasarían el NOT NULL y dejarían una línea muda en la historia.
    CONSTRAINT "clinical_entries_body_object"
        CHECK (jsonb_typeof("body") = 'object' AND "body" <> '{}'::jsonb)
);

CREATE INDEX "clinical_entries_tenant_id_client_id_created_at_idx"
    ON "clinical_entries"("tenant_id", "client_id", "created_at" DESC);
CREATE INDEX "clinical_entries_appointment_id_idx"
    ON "clinical_entries"("appointment_id");

-- La anotación a una entrada. Lo ÚNICO que se puede añadir a algo ya
-- escrito. También inmutable: corregir una corrección es otra anotación.
CREATE TABLE "clinical_addenda" (
    "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"      UUID NOT NULL,
    "entry_id"       UUID NOT NULL,
    "author_user_id" UUID NOT NULL,
    "body"           JSONB NOT NULL,
    "created_at"     TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "clinical_addenda_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    -- RESTRICT y no CASCADE, aunque la entrada padre no se pueda borrar:
    -- si mañana alguien le abriera una puerta a la entrada, esta FK
    -- impediría que la puerta se llevara también las anotaciones.
    CONSTRAINT "clinical_addenda_entry_id_fkey"
        FOREIGN KEY ("entry_id") REFERENCES "clinical_entries"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "clinical_addenda_author_user_id_fkey"
        FOREIGN KEY ("author_user_id") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "clinical_addenda_body_object"
        CHECK (jsonb_typeof("body") = 'object' AND "body" <> '{}'::jsonb)
);

CREATE INDEX "clinical_addenda_entry_id_created_at_idx"
    ON "clinical_addenda"("entry_id", "created_at");
CREATE INDEX "clinical_addenda_tenant_id_idx"
    ON "clinical_addenda"("tenant_id");

-- ── 4 · los triggers ───────────────────────────────────────────────────

-- El invariante del rol, aquí y no en la migración hermana: un CHECK que
-- nombra 'CLINICIAN' USA el valor del enum, y usarlo en la misma
-- transacción en que se añade está prohibido en Postgres. Esta migración
-- es otra transacción, así que aquí ya se puede.
--
-- Lo que garantiza: un `CLINICIAN` es sanitario SIEMPRE. No hay forma de
-- dejar un usuario con el rol del sanitario y la marca apagada, que es el
-- estado desde el que la función de acceso diría "no es sanitario" para
-- alguien que la pantalla pinta como sanitario.
ALTER TABLE "users"
    ADD CONSTRAINT "users_clinician_implies_flag"
    CHECK ("role" <> 'CLINICIAN' OR "is_clinician");

-- `clinical_access` no se borra y su identidad no se reescribe. Lo único
-- que puede cambiar en una fila existente es la revocación, y en un solo
-- sentido: de NULL a un valor. Des-revocar sería reescribir el histórico;
-- lo que hay que hacer para devolver el acceso es insertar otra fila.
CREATE FUNCTION mipiacetpv_clinical_access_guard() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: un acceso a la historia clínica no se borra (acceso %). Se revoca, y la revocación se queda en el histórico.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    IF NEW.id                IS DISTINCT FROM OLD.id
       OR NEW.tenant_id         IS DISTINCT FROM OLD.tenant_id
       OR NEW.clinician_user_id IS DISTINCT FROM OLD.clinician_user_id
       OR NEW.client_id         IS DISTINCT FROM OLD.client_id
       OR NEW.source            IS DISTINCT FROM OLD.source
       OR NEW.granted_at        IS DISTINCT FROM OLD.granted_at
       OR NEW.granted_by_user_id IS DISTINCT FROM OLD.granted_by_user_id THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: la concesión del acceso % no se reescribe. Dice quién pudo ver qué y desde cuándo.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    IF OLD.revoked_at IS NOT NULL
       AND (NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
            OR NEW.revoked_by_user_id IS DISTINCT FROM OLD.revoked_by_user_id) THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: el acceso % ya está revocado y la revocación no se deshace ni se mueve. Para devolver el acceso se concede otro.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "clinical_access_guard"
    BEFORE UPDATE OR DELETE ON "clinical_access"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_clinical_access_guard();

-- El registro de accesos es SÓLO INSERCIONES.
--
-- Sin la escapatoria "el padre ya no existe" que llevan los triggers de
-- S1 y de F1, y no es un olvido: aquí las FKs a `tenants` y a `clients`
-- son RESTRICT, así que la cascada que esa escapatoria cubría no puede
-- ocurrir. Si existiera la escapatoria sin la cascada, sería una puerta
-- abierta sin nadie que la usara.
CREATE FUNCTION mipiacetpv_clinical_access_log_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    RAISE EXCEPTION
        'HISTORIA_VIOLADA: clinical_access_log es sólo inserciones (intento de % sobre la línea %). El registro de accesos es la prueba de quién abrió la historia.',
        TG_OP, OLD.id
        USING ERRCODE = '23514';
END;
$fn$;

CREATE TRIGGER "clinical_access_log_append_only"
    BEFORE UPDATE OR DELETE ON "clinical_access_log"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_clinical_access_log_append_only();

-- La historia es inmutable. Una entrada no se edita, no se borra y no se
-- mueve de paciente. Una anotación tampoco. La misma función sirve para
-- las dos tablas: la regla es idéntica y `TG_TABLE_NAME` da el nombre
-- para el mensaje.
CREATE FUNCTION mipiacetpv_clinical_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'HISTORIA_VIOLADA: la historia clínica no se borra (%.%). Se conserva y se le añaden anotaciones.',
            TG_TABLE_NAME, OLD.id USING ERRCODE = '23514';
    END IF;
    RAISE EXCEPTION
        'HISTORIA_VIOLADA: la historia clínica no se edita (%.%). Lo escrito queda; para corregirlo se añade una anotación con su autor y su fecha.',
        TG_TABLE_NAME, OLD.id USING ERRCODE = '23514';
END;
$fn$;

CREATE TRIGGER "clinical_entries_inmutable"
    BEFORE UPDATE OR DELETE ON "clinical_entries"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_clinical_inmutable();

CREATE TRIGGER "clinical_addenda_inmutable"
    BEFORE UPDATE OR DELETE ON "clinical_addenda"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_clinical_inmutable();
