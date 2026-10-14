-- residencia-1 · LOS CIMIENTOS: el residente, el edificio, los roles de
-- cuidado, los turnos y la puerta.
--
-- ── QUÉ GARANTIZA ESTA MIGRACIÓN ──────────────────────────────────────
--
-- Cinco cosas, y las cinco en el MOTOR y no en un `if` de una ruta, porque
-- la aplicación no es la única puerta a Postgres:
--
--   1. **Un residente no se borra.** `resident_profiles` y
--      `bed_assignments` cuelgan de `clients` y de `tenants` con
--      `ON DELETE RESTRICT`. Se le da de alta (`discharge_date`), no se
--      elimina. Misma decisión y misma ley que clinica-1 (Ley 41/2002).
--   2. **Una cama, un residente; un residente, una cama.** Dos índices
--      PARCIALES sobre `bed_assignments` (`WHERE to_at IS NULL`). Cambiar
--      de habitación cierra una ocupación y abre otra; no edita ninguna.
--   3. **Una asignación de rol no se borra.** Revocar rellena
--      `revoked_at`; volver a dar crea otra fila. El índice parcial
--      `WHERE revoked_at IS NULL` es lo único que permite ese histórico —
--      con un índice total, Postgres ni lo admitiría (lección de
--      clinica-1 §10).
--   4. **Un rol de serie no cambia de categoría.** Trigger
--      `care_roles_de_serie_son_fijos`. Si «dirección» pudiera pasar a
--      OPERATIVO, el cierre de incidencias N3/N4 de residencia-4 dejaría
--      de significar lo que la norma dice.
--   5. **La puerta no es una caja.** CHECK
--      `devices_register_o_habitacion`: un `ROOM` tiene habitación y NO
--      caja, y todo lo demás tiene caja y NO habitación.
--
-- ── MIGRACIÓN ADITIVA ─────────────────────────────────────────────────
--
-- Nueve tablas nuevas vacías, dos columnas nuevas nullable, dos columnas
-- que PIERDEN el `NOT NULL`, y la función del trigger de dispositivos
-- reemplazada. Ni un DROP TABLE, ni un DELETE, ni un UPDATE masivo.
--
-- `DROP NOT NULL` sobre `devices.register_id` y `pairing_codes.register_id`
-- es la única pieza que toca una tabla que ya tiene filas, y **no reescribe
-- nada**: quitar un `NOT NULL` es sólo catálogo (`pg_attribute.attnotnull`),
-- no hay reescritura ni validación de filas. Todas las filas de hoy siguen
-- siendo válidas porque todas son `TERMINAL`, `TEST` o `KITCHEN` y todas
-- tienen caja — lo que el CHECK nuevo exige de ellas.
--
-- El CHECK sí valida la tabla entera al crearse (`ADD CONSTRAINT … CHECK`
-- hace un scan con `ACCESS EXCLUSIVE`). Con ~30 dispositivos en producción
-- es instantáneo; se deja dicho porque la tabla crece con los clientes y
-- no con el tiempo.
--
-- ── EL `down`, PENSADO ────────────────────────────────────────────────
--
--   -- la función del trigger, a su forma de verifactu-1:
--   --   (copiar el cuerpo de 20260924000000_verifactu_1_registro, §1)
--   DROP INDEX "devices_one_active_per_room_key";
--   ALTER TABLE "pairing_codes" DROP CONSTRAINT "pairing_codes_register_o_habitacion",
--                               DROP CONSTRAINT "pairing_codes_room_id_fkey",
--                               DROP COLUMN "room_id";
--   ALTER TABLE "devices"       DROP CONSTRAINT "devices_register_o_habitacion",
--                               DROP CONSTRAINT "devices_room_id_fkey",
--                               DROP COLUMN "room_id";
--   -- y el NOT NULL vuelve SÓLO si no queda ninguna puerta:
--   DELETE FROM "devices" WHERE "kind" = 'ROOM';
--   DELETE FROM "pairing_codes" WHERE "kind" = 'ROOM';
--   ALTER TABLE "devices"       ALTER COLUMN "register_id" SET NOT NULL;
--   ALTER TABLE "pairing_codes" ALTER COLUMN "register_id" SET NOT NULL;
--   DROP TABLE "center_shifts", "care_zone_assignments", "care_role_assignments",
--              "care_roles", "bed_assignments", "beds", "rooms", "floors",
--              "resident_profiles";
--
-- Lo irreversible lo dejó la migración anterior (`ALTER TYPE … ADD VALUE`).
-- Aquí todo se puede tirar, con la condición de arriba.
--
-- ── COPIA DE LA BASE ANTES DE APLICARLA EN PRODUCCIÓN ─────────────────
-- Toca `devices` y `pairing_codes`, que son la identidad de los terminales
-- que facturan. Se aplica primero en una copia (`CREATE DATABASE …
-- TEMPLATE mipiacetpv`).

-- ──────────────────────────────────────────────────────────────────────
-- 1 · EL RESIDENTE · ampliación 1:1 de `clients` (D-49)
-- ──────────────────────────────────────────────────────────────────────
--
-- La PK es el propio `client_id`: el perfil ES el cliente visto como
-- residente. Mismo patrón que `staff_profiles` sobre `users`, y por la
-- misma razón (ADR-R1): no hay una tabla `residents` paralela que duplique
-- nombre, teléfono, historia y consentimientos.
--
-- Y la diferencia con `staff_profiles`, que es la que importa: allí las dos
-- FKs son CASCADE, aquí las dos son **RESTRICT**. Un residente que ha
-- vivido en el centro tiene historia clínica detrás y la historia se
-- conserva cinco años.
CREATE TABLE "resident_profiles" (
    "client_id"            UUID PRIMARY KEY,
    "tenant_id"            UUID NOT NULL,
    "admission_date"       DATE NOT NULL,
    "discharge_date"       DATE,
    "discharge_reason"     TEXT,
    "dependency_level"     "DependencyLevel" NOT NULL,
    "dependency_grade"     "DependencyGrade",
    "place_type"           "PlaceType" NOT NULL,
    "responsible_name"     TEXT,
    "responsible_phone"    TEXT,
    "responsible_relation" TEXT,
    -- Identificación. **Nunca en logs, ni en Sentry, ni en un mensaje de
    -- error**: misma regla que los datos de salud, y la misma razón.
    "dni"                  TEXT,
    "nss"                  TEXT,
    "created_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- RESTRICT las dos. Ver arriba. Hoy no hay NINGUNA ruta que borre un
    -- cliente ni un tenant (se repasó uno por uno en clinica-1 §9), así
    -- que esto protege el camino que todavía no existe.
    CONSTRAINT "resident_profiles_client_id_fkey"
        FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT,
    CONSTRAINT "resident_profiles_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT
);

CREATE INDEX "resident_profiles_tenant_id_idx"
    ON "resident_profiles"("tenant_id");
-- «Los que viven aquí hoy», que es la lista por defecto de la pantalla de
-- Residentes: `discharge_date IS NULL`.
CREATE INDEX "resident_profiles_tenant_id_discharge_date_idx"
    ON "resident_profiles"("tenant_id", "discharge_date");

-- Un motivo de alta SIN fecha de alta es una ficha que dice que alguien se
-- fue sin decir cuándo. Y una fecha de alta anterior al ingreso es un
-- error de dedo que luego sale en un informe a la Consejería.
ALTER TABLE "resident_profiles"
    ADD CONSTRAINT "resident_profiles_alta_coherente"
    CHECK (
        ("discharge_reason" IS NULL OR "discharge_date" IS NOT NULL)
        AND ("discharge_date" IS NULL OR "discharge_date" >= "admission_date")
    );

-- Lo mismo que `users_clinician_license_not_blank`: lo que no se sabe va
-- NULL, no en blanco. Un DNI vacío hace que «tiene DNI» sea una
-- comprobación que miente.
ALTER TABLE "resident_profiles"
    ADD CONSTRAINT "resident_profiles_identificacion_not_blank"
    CHECK (
        ("dni" IS NULL OR btrim("dni") <> '')
        AND ("nss" IS NULL OR btrim("nss") <> '')
    );

-- ──────────────────────────────────────────────────────────────────────
-- 2 · EL EDIFICIO · plantas, habitaciones y camas
-- ──────────────────────────────────────────────────────────────────────
--
-- CASCADE al tenant, al revés que el residente: el edificio es
-- configuración, no un registro que la ley obligue a conservar. Lo que no
-- se puede perder con el tenant son los residentes y su ocupación, y eso
-- ya lo impiden `resident_profiles` y `bed_assignments`.
CREATE TABLE "floors" (
    "id"         UUID PRIMARY KEY,
    "tenant_id"  UUID NOT NULL,
    "name"       TEXT NOT NULL,
    -- En qué orden se pinta. No se deduce del nombre: «Baja» va antes que
    -- «Primera» y alfabéticamente no.
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "floors_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "floors_tenant_id_name_key" ON "floors"("tenant_id", "name");
CREATE INDEX "floors_tenant_id_idx" ON "floors"("tenant_id");

-- La habitación es lo que tiene PUERTA, y por tanto lo que tiene tablet
-- (D-52). `number` es TEXTO y no entero: en Jardín de Gredos hay «112» y
-- hay «112 bis».
--
-- RESTRICT a la planta: retirar una planta con habitaciones dentro sería
-- dejar habitaciones sin zona, y la zona es lo que decide quién ve a quién.
CREATE TABLE "rooms" (
    "id"         UUID PRIMARY KEY,
    "tenant_id"  UUID NOT NULL,
    "floor_id"   UUID NOT NULL,
    "number"     TEXT NOT NULL,
    "name"       TEXT,
    "active"     BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "rooms_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "rooms_floor_id_fkey"
        FOREIGN KEY ("floor_id") REFERENCES "floors"("id") ON DELETE RESTRICT
);

-- Único por CENTRO y no por planta: el personal dice «la 112», no «la 112
-- de la primera».
CREATE UNIQUE INDEX "rooms_tenant_id_number_key" ON "rooms"("tenant_id", "number");
CREATE INDEX "rooms_tenant_id_idx" ON "rooms"("tenant_id");
CREATE INDEX "rooms_tenant_id_floor_id_idx" ON "rooms"("tenant_id", "floor_id");

ALTER TABLE "rooms"
    ADD CONSTRAINT "rooms_number_not_blank"
    CHECK (btrim("number") <> '');

-- La CAMA: la plaza física dentro de la habitación. 49 en Jardín de
-- Gredos, repartidas entre individuales y dobles.
--
-- `tenant_id` es redundante con el de la habitación y está por la regla de
-- aislamiento por fila de la casa (misma decisión que `staff_skills`).
CREATE TABLE "beds" (
    "id"         UUID PRIMARY KEY,
    "tenant_id"  UUID NOT NULL,
    "room_id"    UUID NOT NULL,
    "label"      TEXT NOT NULL,
    "active"     BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "beds_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "beds_room_id_fkey"
        FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "beds_room_id_label_key" ON "beds"("room_id", "label");
CREATE INDEX "beds_tenant_id_idx" ON "beds"("tenant_id");

ALTER TABLE "beds"
    ADD CONSTRAINT "beds_label_not_blank"
    CHECK (btrim("label") <> '');

-- ──────────────────────────────────────────────────────────────────────
-- 3 · LA OCUPACIÓN · quién duerme en qué cama, con vigencia
-- ──────────────────────────────────────────────────────────────────────
--
-- Es la tabla de la que depende la mitad de la función de acceso: un
-- residente está «en mi zona» si tiene una cama VIGENTE en una planta de mi
-- zona vigente.
--
-- RESTRICT a las tres: al tenant, a la cama y al residente. «¿Dónde dormía
-- doña Carmen en marzo?» es una pregunta que una residencia tiene que
-- poder contestar, y un borrado en cascada se la lleva.
CREATE TABLE "bed_assignments" (
    "id"                 UUID PRIMARY KEY,
    "tenant_id"          UUID NOT NULL,
    "bed_id"             UUID NOT NULL,
    "client_id"          UUID NOT NULL,
    -- `from_at` / `to_at` y no `from` / `to`: las dos palabras son
    -- reservadas en SQL y quedarían entre comillas en cada consulta a mano.
    "from_at"            TIMESTAMPTZ NOT NULL,
    "to_at"              TIMESTAMPTZ,
    "reason"             TEXT,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
    "created_by_user_id" UUID,

    CONSTRAINT "bed_assignments_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT,
    CONSTRAINT "bed_assignments_bed_id_fkey"
        FOREIGN KEY ("bed_id") REFERENCES "beds"("id") ON DELETE RESTRICT,
    CONSTRAINT "bed_assignments_client_id_fkey"
        FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT,
    -- SET NULL: dar de baja a la encargada que movió de habitación a doña
    -- Carmen no puede borrar el hecho de que se movió.
    CONSTRAINT "bed_assignments_created_by_user_id_fkey"
        FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX "bed_assignments_tenant_id_idx" ON "bed_assignments"("tenant_id");
CREATE INDEX "bed_assignments_bed_id_idx" ON "bed_assignments"("bed_id");
CREATE INDEX "bed_assignments_client_id_idx" ON "bed_assignments"("client_id");

-- ── LA REGLA 6, EN DOS ÍNDICES PARCIALES ──────────────────────────────
--
-- `WHERE to_at IS NULL` = «las ocupaciones VIGENTES». Con eso salen las dos
-- mitades sin un solo `if`:
--
--   · una cama tiene como mucho UN residente vigente;
--   · un residente ocupa como mucho UNA cama vigente.
--
-- Y el histórico cabe: doña Carmen puede tener cinco filas cerradas en
-- cinco camas distintas, porque ninguna está en el índice. Con un índice
-- TOTAL, el segundo traslado sería imposible — es la misma lección que
-- `clinical_access_one_live_key` en clinica-1, donde Postgres se negó a
-- crear la versión no parcial.
--
-- Mover de habitación es: `UPDATE … SET to_at = now()` + `INSERT`, en LA
-- MISMA transacción. Si el UPDATE no corriera, el INSERT revienta aquí en
-- vez de dejar a la señora en dos camas.
CREATE UNIQUE INDEX "bed_assignments_one_live_per_bed_key"
    ON "bed_assignments"("bed_id")
    WHERE "to_at" IS NULL;

CREATE UNIQUE INDEX "bed_assignments_one_live_per_client_key"
    ON "bed_assignments"("client_id")
    WHERE "to_at" IS NULL;

-- Una ocupación que acaba antes de empezar no es una ocupación.
ALTER TABLE "bed_assignments"
    ADD CONSTRAINT "bed_assignments_vigencia"
    CHECK ("to_at" IS NULL OR "to_at" >= "from_at");

-- ──────────────────────────────────────────────────────────────────────
-- 4 · LOS ROLES DE CUIDADO · catálogo de DATOS (D-50)
-- ──────────────────────────────────────────────────────────────────────
--
-- `UserRole` no gana ni un valor en este bloque, y eso es el 80 % del
-- porqué de esta tabla: hay ~60 rutas de caja que comparan `UserRole`, y
-- añadirle un valor obliga a repasarlas una por una (clinica-1 §3 lo hizo,
-- veinte sitios). Una residencia que invente «fisio de tarde» no puede
-- costar eso.
--
-- `tenant_id` es NOT NULL: al encender el interruptor se le siembran al
-- centro los diez roles de serie. Así «desactivar un rol de serie» y
-- «añadir uno propio» son la misma operación sobre la misma tabla, en vez
-- de un catálogo global más una tabla de excepciones por centro.
CREATE TABLE "care_roles" (
    "id"               UUID PRIMARY KEY,
    "tenant_id"        UUID NOT NULL,
    "code"             TEXT NOT NULL,
    "name"             TEXT NOT NULL,
    "category"         "CareRoleCategory" NOT NULL,
    "is_standard"      BOOLEAN NOT NULL DEFAULT false,
    "active"           BOOLEAN NOT NULL DEFAULT true,
    "sort_order"       INTEGER NOT NULL DEFAULT 0,
    -- Los tres flags de los que cuelga el acceso. Ver `CareRole` en el
    -- schema: «registra cuidados», «exige colegiado», «ve todo el centro».
    "records_care"     BOOLEAN NOT NULL DEFAULT true,
    "requires_license" BOOLEAN NOT NULL DEFAULT false,
    "full_scope"       BOOLEAN NOT NULL DEFAULT false,
    "created_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "care_roles_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "care_roles_tenant_id_code_key" ON "care_roles"("tenant_id", "code");
CREATE INDEX "care_roles_tenant_id_idx" ON "care_roles"("tenant_id");
CREATE INDEX "care_roles_tenant_id_active_idx" ON "care_roles"("tenant_id", "active");

ALTER TABLE "care_roles"
    ADD CONSTRAINT "care_roles_code_not_blank"
    CHECK (btrim("code") <> '' AND btrim("name") <> '');

-- ── Un rol de serie NO cambia de categoría, y lo dice el motor ────────
--
-- Qué se puede tocar en uno de serie: el NOMBRE (que un centro llame
-- «gerocultora» a la auxiliar es suyo), el ORDEN y el interruptor ACTIVE.
--
-- Qué no: la categoría, el código, los tres flags de acceso y la propia
-- marca de «de serie». De la categoría cuelga quién cierra una incidencia
-- en residencia-4 (D-27: el cierre es de categoría directiva); de
-- `full_scope` cuelga quién ve a todos los residentes. Si un centro pudiera
-- bajar «dirección» a OPERATIVO, el cierre dejaría de significar lo que la
-- norma dice que significa y nadie lo notaría hasta la auditoría.
--
-- Y tampoco se borra: un rol de serie es el vocabulario con el que está
-- firmado el histórico (D-31, «toda acción firmada con persona +
-- capacidad»). Lo que se hace con el que no se usa es desactivarlo.
--
-- En el motor y no en la ruta por lo mismo que el resto: hay más de una
-- puerta de escritura, y la segunda es un `psql`.
CREATE FUNCTION mipiacetpv_care_roles_de_serie() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.is_standard THEN
            RAISE EXCEPTION
                'RESIDENCIA_VIOLADA: un rol de cuidado de serie no se borra (care_roles.%). Se desactiva, porque el histórico está firmado con él.',
                OLD.id;
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.is_standard THEN
        IF NEW.category <> OLD.category
           OR NEW.code <> OLD.code
           OR NEW.is_standard <> OLD.is_standard
           OR NEW.records_care <> OLD.records_care
           OR NEW.requires_license <> OLD.requires_license
           OR NEW.full_scope <> OLD.full_scope THEN
            RAISE EXCEPTION
                'RESIDENCIA_VIOLADA: de un rol de cuidado de serie (care_roles.%) sólo se puede cambiar el nombre, el orden y si está activo. La categoría y el alcance los fija el producto.',
                OLD.id;
        END IF;
    END IF;
    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "care_roles_de_serie_son_fijos"
    BEFORE UPDATE OR DELETE ON "care_roles"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_care_roles_de_serie();

-- ──────────────────────────────────────────────────────────────────────
-- 5 · PERSONA ↔ ROL DE CUIDADO · muchos a muchos con vigencia
-- ──────────────────────────────────────────────────────────────────────
--
-- Muchos a muchos porque una persona puede ser TO y Calidad a la vez
-- (decisión de producto 3), y las dos cosas significan cosas distintas: con
-- la de Calidad ve todo el centro, con la de TO firma una sesión de
-- terapia.
--
-- RESTRICT al usuario y al rol: la asignación es la CAPACIDAD con la que
-- esa persona firmó lo que firmó (D-31). No se queda huérfana.
CREATE TABLE "care_role_assignments" (
    "id"                  UUID PRIMARY KEY,
    "tenant_id"           UUID NOT NULL,
    "user_id"             UUID NOT NULL,
    "care_role_id"        UUID NOT NULL,
    "from_at"             TIMESTAMPTZ NOT NULL,
    "to_at"               TIMESTAMPTZ,
    "granted_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
    "granted_by_user_id"  UUID,
    "revoked_at"          TIMESTAMPTZ,
    "revoked_by_user_id"  UUID,

    CONSTRAINT "care_role_assignments_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT,
    CONSTRAINT "care_role_assignments_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT,
    CONSTRAINT "care_role_assignments_care_role_id_fkey"
        FOREIGN KEY ("care_role_id") REFERENCES "care_roles"("id") ON DELETE RESTRICT,
    CONSTRAINT "care_role_assignments_granted_by_user_id_fkey"
        FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL,
    CONSTRAINT "care_role_assignments_revoked_by_user_id_fkey"
        FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX "care_role_assignments_tenant_id_idx"
    ON "care_role_assignments"("tenant_id");
CREATE INDEX "care_role_assignments_tenant_id_user_id_idx"
    ON "care_role_assignments"("tenant_id", "user_id");
CREATE INDEX "care_role_assignments_care_role_id_idx"
    ON "care_role_assignments"("care_role_id");

-- ── EL ÍNDICE PARCIAL, copia literal de clinica-1 ─────────────────────
--
-- Un rol vivo por (persona, rol). Revocar rellena `revoked_at` y la fila
-- sale del índice, así que volver a darle el rol en junio INSERTA otra
-- fila y la revocación de marzo se queda en el histórico. Es, literal, la
-- decisión de producto 4.
--
-- Con un índice total esto no es «menos correcto»: es IMPOSIBLE. Postgres
-- se niega a crearlo en cuanto hay una revocación y una vuelta en la tabla.
CREATE UNIQUE INDEX "care_role_assignments_one_live_key"
    ON "care_role_assignments"("user_id", "care_role_id")
    WHERE "revoked_at" IS NULL;

-- `revoked_by` sin `revoked_at` es una revocación sin fecha, y `to_at`
-- antes de `from_at` es una vigencia que no existe.
ALTER TABLE "care_role_assignments"
    ADD CONSTRAINT "care_role_assignments_coherente"
    CHECK (
        ("revoked_by_user_id" IS NULL OR "revoked_at" IS NOT NULL)
        AND ("to_at" IS NULL OR "to_at" > "from_at")
    );

-- ──────────────────────────────────────────────────────────────────────
-- 6 · LA ZONA · el alcance por planta (D-51)
-- ──────────────────────────────────────────────────────────────────────
--
-- En una residencia no hay citas: hay zonas y turnos. La selección por
-- paciente de la clínica (`clinical_access`, que se llena sola al asignar
-- una cita) no tiene de dónde llenarse aquí, y por eso el alcance de la
-- residencia es éste y no aquél.
--
-- `floor_id` NULL = **todo el centro**. Es para quien cubre el edificio sin
-- llevar un rol de alcance total; los roles que ya ven todo (DUE, médico,
-- calidad, dirección) no necesitan ni una fila aquí porque lo deciden por
-- `care_roles.full_scope`.
--
-- CASCADE al usuario y al tenant, al revés que el rol: la zona es
-- ORGANIZACIÓN del trabajo, no la capacidad con la que se firmó nada.
CREATE TABLE "care_zone_assignments" (
    "id"                 UUID PRIMARY KEY,
    "tenant_id"          UUID NOT NULL,
    "user_id"            UUID NOT NULL,
    "floor_id"           UUID,
    "from_at"            TIMESTAMPTZ NOT NULL,
    "to_at"              TIMESTAMPTZ,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
    "granted_by_user_id" UUID,

    CONSTRAINT "care_zone_assignments_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "care_zone_assignments_user_id_fkey"
        FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
    -- RESTRICT a la planta: retirar una planta mientras alguien la tiene
    -- asignada le cambiaría el alcance en silencio.
    CONSTRAINT "care_zone_assignments_floor_id_fkey"
        FOREIGN KEY ("floor_id") REFERENCES "floors"("id") ON DELETE RESTRICT,
    CONSTRAINT "care_zone_assignments_granted_by_user_id_fkey"
        FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX "care_zone_assignments_tenant_id_idx"
    ON "care_zone_assignments"("tenant_id");
CREATE INDEX "care_zone_assignments_tenant_id_user_id_idx"
    ON "care_zone_assignments"("tenant_id", "user_id");
CREATE INDEX "care_zone_assignments_floor_id_idx"
    ON "care_zone_assignments"("floor_id");

-- ── Y aquí hacen falta DOS índices, no uno ────────────────────────────
--
-- El primero cubre «esta persona, esta planta». El segundo cubre «esta
-- persona, todo el centro», y hace falta porque **en Postgres los NULL son
-- distintos entre sí**: con sólo el primero, cinco filas de «todo el
-- centro» para la misma persona serían cinco claves distintas y las cinco
-- entrarían. Mismo caso exacto que `ticket_allergies_mesa_key` en kds-1.
CREATE UNIQUE INDEX "care_zone_assignments_one_live_per_floor_key"
    ON "care_zone_assignments"("user_id", "floor_id")
    WHERE "to_at" IS NULL;

CREATE UNIQUE INDEX "care_zone_assignments_one_live_centro_key"
    ON "care_zone_assignments"("user_id")
    WHERE "to_at" IS NULL AND "floor_id" IS NULL;

ALTER TABLE "care_zone_assignments"
    ADD CONSTRAINT "care_zone_assignments_vigencia"
    CHECK ("to_at" IS NULL OR "to_at" > "from_at");

-- ──────────────────────────────────────────────────────────────────────
-- 7 · LOS TURNOS DEL CENTRO (D-54)
-- ──────────────────────────────────────────────────────────────────────
--
-- `starts_at` / `ends_at` son HORAS DE PARED «HH:MM» y no timestamps,
-- igual que `staff_shifts.start_time`: «la noche empieza a las diez» no
-- cambia el día del cambio de hora, y guardarlo como instante obligaría a
-- reescribir filas dos veces al año.
--
-- La noche CRUZA MEDIANOCHE (22→08), así que **no hay CHECK de orden**:
-- `ends_at <= starts_at` es justo lo que distingue un turno de noche. Lo
-- que sí se prohíbe es `starts_at = ends_at`, que no se sabe si son cero
-- horas o veinticuatro.
CREATE TABLE "center_shifts" (
    "id"         UUID PRIMARY KEY,
    "tenant_id"  UUID NOT NULL,
    "code"       TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "starts_at"  TEXT NOT NULL,
    "ends_at"    TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "center_shifts_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "center_shifts_tenant_id_code_key"
    ON "center_shifts"("tenant_id", "code");
CREATE INDEX "center_shifts_tenant_id_idx" ON "center_shifts"("tenant_id");

-- El formato, en el motor. Una hora como «8:00» o «25:00» haría que la
-- función «¿en qué turno cae este instante?» contestara `null` para un
-- instante que sí cae en un turno, y el registro de la puerta se quedaría
-- sin turno sin que nadie viera un error.
ALTER TABLE "center_shifts"
    ADD CONSTRAINT "center_shifts_horas_validas"
    CHECK (
        "starts_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND "ends_at" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
        AND "starts_at" <> "ends_at"
    );

ALTER TABLE "center_shifts"
    ADD CONSTRAINT "center_shifts_code_not_blank"
    CHECK (btrim("code") <> '' AND btrim("name") <> '');

-- ──────────────────────────────────────────────────────────────────────
-- 8 · LA PUERTA · el primer dispositivo que no cuelga de una caja
-- ──────────────────────────────────────────────────────────────────────
--
-- `DROP NOT NULL` es sólo catálogo: no hay reescritura de tabla ni
-- validación de filas. Todas las filas de hoy siguen siendo válidas porque
-- todas tienen caja, que es lo que el CHECK de abajo les exige.
ALTER TABLE "devices"
    ALTER COLUMN "register_id" DROP NOT NULL;
ALTER TABLE "devices"
    ADD COLUMN "room_id" UUID;

-- RESTRICT: borrar una habitación con su tablet emparejada dejaría un
-- aparato autenticado apuntando a nada. Primero se revoca la tablet,
-- después se retira la habitación.
ALTER TABLE "devices"
    ADD CONSTRAINT "devices_room_id_fkey"
    FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE RESTRICT;

CREATE INDEX "devices_room_id_idx" ON "devices"("room_id");

-- ── EL CHECK QUE SOSTIENE TODO ESTO ───────────────────────────────────
--
-- Un `ROOM` tiene habitación y NO caja. Todo lo demás tiene caja y NO
-- habitación. Las dos mitades hacen falta:
--
--   · sin la primera, un `ROOM` con `register_id` entraría en la cadena de
--     una caja y el índice `devices_one_active_per_register_key` dejaría de
--     significar «un terminal por caja» (no: ese índice filtra TERMINAL, así
--     que lo que pasaría es peor y más silencioso — una puerta contaría como
--     dispositivo de una caja en los listados de soporte);
--   · sin la segunda, un TERMINAL con `register_id` NULL se saldría del
--     índice único —los NULL son distintos entre sí— y una caja podría
--     tener dos terminales vivos facturando en la misma cadena. Eso es
--     exactamente lo que `verifactu-1` vino a cerrar, y hacer la columna
--     nullable lo reabriría si no fuera por esta mitad del CHECK.
ALTER TABLE "devices"
    ADD CONSTRAINT "devices_register_o_habitacion"
    CHECK (
        ("kind" = 'ROOM' AND "room_id" IS NOT NULL AND "register_id" IS NULL)
        OR ("kind" <> 'ROOM' AND "room_id" IS NULL AND "register_id" IS NOT NULL)
    );

-- Una habitación tiene UNA puerta viva. Hermano de
-- `devices_one_active_per_register_key` y por la misma razón: emparejar una
-- tablet nueva en la 112 revoca la anterior de la 112 (lo hace el trigger
-- de abajo), y si ese UPDATE no corriera el INSERT revienta aquí en vez de
-- dejar dos tablets vivas en la misma puerta — que es un registro firmado
-- dos veces desde dos aparatos.
CREATE UNIQUE INDEX "devices_one_active_per_room_key"
    ON "devices"("room_id")
    WHERE "revoked_at" IS NULL AND "kind" = 'ROOM';

-- ── Y quien releva es la BASE, no la ruta ─────────────────────────────
--
-- Se REEMPLAZA la función de `verifactu-1` en vez de añadir un segundo
-- trigger, y es deliberado: dos triggers `BEFORE INSERT` sobre la misma
-- tabla corren en orden alfabético de nombre y el día que uno de los dos
-- cambie, el orden deja de ser obvio. Una función, tres ramas, y el `down`
-- es volver a pegar el cuerpo de verifactu-1.
--
-- Lo que NO cambia: la rama del TERMINAL es idéntica, letra por letra. Un
-- `ROOM` sale por su propia rama ANTES de llegar a ella, así que no releva
-- al terminal de nadie — y como no tiene `register_id`, tampoco podría.
CREATE OR REPLACE FUNCTION mipiacetpv_devices_revoke_previous() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF NEW.revoked_at IS NOT NULL THEN
        RETURN NEW;   -- alta de un device ya revocado: no releva a nadie
    END IF;
    -- residencia-1 · la puerta de una habitación releva a la puerta
    -- ANTERIOR DE SU HABITACIÓN, y a nadie más. Ni al terminal de la caja
    -- (no tiene caja), ni a la puerta de la habitación de al lado.
    IF NEW.kind = 'ROOM' THEN
        UPDATE devices
           SET revoked_at           = now(),
               revoked_reason       = 'PAIRED_NEW',
               revoked_by_device_id = NEW.id
         WHERE room_id = NEW.room_id
           AND revoked_at IS NULL
           AND kind = 'ROOM';
        RETURN NEW;
    END IF;
    IF NEW.kind <> 'TERMINAL' THEN
        RETURN NEW;   -- el modo prueba y la pantalla de cocina no relevan
    END IF;
    UPDATE devices
       SET revoked_at           = now(),
           revoked_reason       = 'PAIRED_NEW',
           revoked_by_device_id = NEW.id
     WHERE register_id = NEW.register_id
       AND revoked_at IS NULL
       -- Y tampoco se releva a nadie que no sea un terminal: emparejar una
       -- tablet nueva no puede apagar el modo prueba del super-admin.
       AND kind = 'TERMINAL';
    RETURN NEW;
END;
$fn$;

-- ── El código de emparejamiento dice QUÉ habitación ───────────────────
--
-- Y lo dice el código, no el aparato — exactamente por lo mismo que `kind`
-- y `kitchenSections` en kds-1. Si `POST /devices/pair` aceptase la
-- habitación del cuerpo, cualquiera con un código se emparejaría como la
-- puerta de la 112 y vería quién duerme ahí.
ALTER TABLE "pairing_codes"
    ALTER COLUMN "register_id" DROP NOT NULL;
ALTER TABLE "pairing_codes"
    ADD COLUMN "room_id" UUID;

-- CASCADE y no RESTRICT, al revés que en `devices`: un código de
-- emparejamiento caduca en una hora y no es traza de nada.
ALTER TABLE "pairing_codes"
    ADD CONSTRAINT "pairing_codes_room_id_fkey"
    FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE;

CREATE INDEX "pairing_codes_room_id_idx" ON "pairing_codes"("room_id");

ALTER TABLE "pairing_codes"
    ADD CONSTRAINT "pairing_codes_register_o_habitacion"
    CHECK (
        ("kind" = 'ROOM' AND "room_id" IS NOT NULL AND "register_id" IS NULL)
        OR ("kind" <> 'ROOM' AND "room_id" IS NULL AND "register_id" IS NOT NULL)
    );
