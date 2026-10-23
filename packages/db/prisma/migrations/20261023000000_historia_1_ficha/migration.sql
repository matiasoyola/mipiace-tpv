-- historia-1 (D-90 a D-96) · **LA FICHA CLÍNICA DEL RESIDENTE, LAS
-- AUSENCIAS, EL INGRESO GUIADO Y EL ALTA.**
--
-- Hoy lo que se sabe de cada residente está repartido entre una ficha en
-- papel, el PAI en Word y la cabeza de la DUE; las ausencias no están en
-- ningún sitio salvo en los días que alguien teclea a mano para facturar
-- las plazas concertadas; y el ingreso de alguien nuevo no tiene lista:
-- lo que falta se descubre cuando lo pide un inspector (R20).
--
-- Siete tablas nuevas, una tabla de ajustes del centro, un enum de clase
-- de alta y una columna:
--
--   1. `resident_diagnoses`        — diagnósticos y antecedentes (D-90).
--   2. `allergies`                 — alergias e intolerancias (D-90).
--   3. `allergy_reviews`           — **«sin alergias conocidas» es un
--                                     dato** (D-90), de sólo inserción.
--   4. `resident_devices`          — dispositivos y ayudas (D-90).
--   5. `diet_profiles`             — la dieta, **versionada** (D-90).
--   6. `resident_absences`         — las ausencias, que PAUSAN (D-92).
--   7. `admission_checklist_items` — el ingreso guiado (D-94).
--   8. `center_admission_settings` — los dos plazos del centro (D-94, D-96).
--   9. `resident_profiles.discharge_kind` — por qué se fue (D-96).
--
-- ── POR QUÉ ESTA MIGRACIÓN NO SE PARTE EN DOS ───────────────────────
--
-- `clinica_4`, `residencia_3`, `residencia_4` y `residencia_5` se
-- partieron en `_tipos` + la tabla porque **añadían un valor a un enum
-- que ya existía**, y Postgres prohíbe usarlo en la misma transacción
-- (`unsafe use of new value of enum type`). Aquí los cinco enums son
-- `CREATE TYPE` nuevos, y un tipo recién creado SÍ se puede usar en su
-- transacción. Partirla «porque las otras se partieron» habría sido un
-- despliegue más sin ninguna razón detrás.
--
-- ── ADITIVA ─────────────────────────────────────────────────────────
--
-- Ocho tablas nuevas vacías, cinco tipos nuevos, y **una sola columna
-- nullable** sobre `resident_profiles`, que sólo tiene filas en un centro
-- con la residencia encendida. Ni un `DROP TABLE`, ni un `DELETE`, ni un
-- `TRUNCATE`, ni un `UPDATE … SET` fuera de las funciones de los
-- triggers. Un test lo fija enumerando los `ALTER TABLE`.
--
-- ── EL `down` ───────────────────────────────────────────────────────
--
--   DROP TRIGGER "resident_diagnoses_inmutable" ON "resident_diagnoses";
--   DROP TRIGGER "allergies_inmutable" ON "allergies";
--   DROP TRIGGER "allergy_reviews_append_only" ON "allergy_reviews";
--   DROP TRIGGER "diet_profiles_inmutable" ON "diet_profiles";
--   DROP TRIGGER "resident_absences_inmutable" ON "resident_absences";
--   DROP FUNCTION mipiacetpv_resident_diagnoses_inmutable();
--   DROP FUNCTION mipiacetpv_allergies_inmutable();
--   DROP FUNCTION mipiacetpv_allergy_reviews_append_only();
--   DROP FUNCTION mipiacetpv_diet_profiles_inmutable();
--   DROP FUNCTION mipiacetpv_resident_absences_inmutable();
--   DROP TABLE "admission_checklist_items";
--   DROP TABLE "center_admission_settings";
--   DROP TABLE "resident_absences";
--   DROP TABLE "diet_profiles";
--   DROP TABLE "resident_devices";
--   DROP TABLE "allergy_reviews";
--   DROP TABLE "allergies";
--   DROP TABLE "resident_diagnoses";
--   ALTER TABLE "resident_profiles"
--       DROP CONSTRAINT "resident_profiles_alta_clase",
--       DROP COLUMN "discharge_kind";
--   DROP TYPE "ResidentAbsenceKind";
--   DROP TYPE "DietTexture";
--   DROP TYPE "AllergySeverity";
--   DROP TYPE "AllergyClass";
--   DROP TYPE "ResidentDischargeKind";
--
-- Es **completo** mientras no haya una sola fila dentro: después, el
-- `down` es tirar historia clínica que la ley obliga a conservar cinco
-- años (Ley 41/2002, D-45), y eso no lo deshace una migración. Los
-- ficheros del volumen clínico —los contratos adjuntos del ingreso— **no
-- los borra ningún `down`**: viven fuera de Postgres, como las fotos de
-- clinica-4.

-- ════════════════════════════════════════════════════════════════════
--  0 · LOS CINCO TIPOS
-- ════════════════════════════════════════════════════════════════════
--
-- Lo que es enum del motor y lo que no, con el criterio escrito:
--
--   · **Enum** lo que es un vocabulario clínico cerrado del que cuelga
--     una decisión del motor o un bloqueo clínico: la clase y la gravedad
--     de una alergia (medicación va a bloquear por ellas), la textura de
--     una dieta (la alerta de la puerta sale de ella), el tipo de una
--     ausencia (de él cuelga qué día cuenta como qué) y la clase de un
--     alta (de ella cuelga la comunicación a la administración).
--   · **Código en claro validado contra un fichero de datos** lo que es
--     un catálogo del producto que va a crecer: los dispositivos y los
--     elementos del ingreso. Es D-11 llevado aquí y lo mismo que
--     `incident_type` en residencia-4: un nebulizador en 2028 es una fila
--     de un fichero, no un `ALTER TYPE` en producción.
CREATE TYPE "ResidentDischargeKind" AS ENUM ('TRASLADO', 'VOLUNTARIA', 'FALLECIMIENTO', 'OTRA');
CREATE TYPE "AllergyClass" AS ENUM ('MEDICAMENTO', 'ALIMENTO', 'OTRA');
CREATE TYPE "AllergySeverity" AS ENUM ('LEVE', 'MODERADA', 'GRAVE');
CREATE TYPE "DietTexture" AS ENUM ('NORMAL', 'BLANDA', 'TRITURADA', 'ENTERAL');
CREATE TYPE "ResidentAbsenceKind" AS ENUM (
    'INGRESO_HOSPITALARIO',
    'URGENCIAS',
    'VACACIONES_FAMILIA',
    'CONSULTA_EXTERNA',
    'SALIDA_NO_CONTROLADA'
);

-- ════════════════════════════════════════════════════════════════════
--  1 · resident_diagnoses · DIAGNÓSTICOS Y ANTECEDENTES (D-90)
-- ════════════════════════════════════════════════════════════════════
--
-- `id` CON `gen_random_uuid()` como default, al contrario que
-- `care_records`: aquí quien inserta es la API y no una tablet, y el id
-- lo genera igualmente la aplicación (`nuevoIdDeFila()`) porque el AAD lo
-- necesita. El default se queda como red de seguridad de un `INSERT` a
-- mano que no cifre nada, que los CHECK de formato rechazarían de todas
-- formas.
CREATE TABLE "resident_diagnoses" (
    "id"                                 UUID        NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"                          UUID        NOT NULL,
    "client_id"                          UUID        NOT NULL,

    -- EL DIAGNÓSTICO Y SU CÓDIGO, los dos cifrados. «E11.9» *es* la
    -- diabetes: un código CIE-10 en claro es el diagnóstico en claro.
    "text_cifrado"                       TEXT        NOT NULL,
    "icd10_cifrado"                      TEXT,

    -- Antecedente quirúrgico. Una columna y no un tipo aparte.
    "surgical"                           BOOLEAN     NOT NULL DEFAULT FALSE,

    "diagnosed_on"                       DATE        NOT NULL,
    -- NULL = activo. Es lo que miran la ficha y la franja de alertas.
    "resolved_on"                        DATE,

    -- LA MARCA DE ALERTA (D-91) y su frase accionable. Ver el CHECK.
    "alert_flag"                         BOOLEAN     NOT NULL DEFAULT FALSE,
    "alert_phrase_cifrado"               TEXT,

    -- RETIRADO POR ERROR (no borrado).
    "withdrawn_at"                       TIMESTAMPTZ,
    "withdrawn_by_user_id"               UUID,
    "withdraw_reason_cifrado"            TEXT,

    "created_at"                         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id"                 UUID        NOT NULL,
    "created_by_care_role_assignment_id" UUID        NOT NULL,
    "resolved_by_user_id"                UUID,

    CONSTRAINT "resident_diagnoses_pkey" PRIMARY KEY ("id")
);

-- ── Los CHECK de formato de lo cifrado · EL CLARO NO CABE ────────────
--
-- Misma forma y misma razón que las veinticuatro columnas de clinica-7,
-- residencia-1b, -3, -4 y -5: si mañana una ruta nueva escribiera el
-- texto de un diagnóstico sin pasar por `cifrarTexto`, **lo rechaza el
-- motor**. No hace falta que nadie se acuerde.
ALTER TABLE "resident_diagnoses"
    ADD CONSTRAINT "resident_diagnoses_text_cifrado_formato"
    CHECK ("text_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

ALTER TABLE "resident_diagnoses"
    ADD CONSTRAINT "resident_diagnoses_icd10_cifrado_formato"
    CHECK ("icd10_cifrado" IS NULL
           OR "icd10_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

ALTER TABLE "resident_diagnoses"
    ADD CONSTRAINT "resident_diagnoses_alert_phrase_cifrado_formato"
    CHECK ("alert_phrase_cifrado" IS NULL
           OR "alert_phrase_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

ALTER TABLE "resident_diagnoses"
    ADD CONSTRAINT "resident_diagnoses_withdraw_reason_cifrado_formato"
    CHECK ("withdraw_reason_cifrado" IS NULL
           OR "withdraw_reason_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

-- ── La alerta exige su FRASE (D-91) ─────────────────────────────────
--
-- Marcar un diagnóstico como alerta sin escribir qué hay que hacer
-- dejaría a la puerta con una banda vacía o —mucho peor— empujaría a
-- alguien a poner el diagnóstico dentro, que es justo lo que D-91
-- prohíbe. La frase es obligatoria con la marca, y está prohibida sin
-- ella: una frase accionable de un diagnóstico que no alerta es una
-- frase que nadie va a ver y que puede quedarse vieja.
ALTER TABLE "resident_diagnoses"
    ADD CONSTRAINT "resident_diagnoses_alerta_completa"
    CHECK (("alert_flag" = TRUE  AND "alert_phrase_cifrado" IS NOT NULL)
        OR ("alert_flag" = FALSE AND "alert_phrase_cifrado" IS NULL));

-- ── La retirada va completa, o no va ────────────────────────────────
ALTER TABLE "resident_diagnoses"
    ADD CONSTRAINT "resident_diagnoses_retirada_completa"
    CHECK (("withdrawn_at" IS NULL
            AND "withdrawn_by_user_id" IS NULL
            AND "withdraw_reason_cifrado" IS NULL)
        OR ("withdrawn_at" IS NOT NULL
            AND "withdrawn_by_user_id" IS NOT NULL
            AND "withdraw_reason_cifrado" IS NOT NULL));

-- ── Resolver también lleva firma ────────────────────────────────────
ALTER TABLE "resident_diagnoses"
    ADD CONSTRAINT "resident_diagnoses_resuelto_completo"
    CHECK (("resolved_on" IS NULL     AND "resolved_by_user_id" IS NULL)
        OR ("resolved_on" IS NOT NULL AND "resolved_by_user_id" IS NOT NULL));

-- ── Y no se resuelve antes de diagnosticarse ────────────────────────
--
-- **El `IS NOT NULL` va DELANTE**, aunque la comparación con NULL daría
-- NULL y el CHECK pasaría igual: es la forma de la casa desde
-- `care_plan_items` (un CHECK que da NULL *pasa*, y a ojo no se ve).
ALTER TABLE "resident_diagnoses"
    ADD CONSTRAINT "resident_diagnoses_fechas_coherentes"
    CHECK ("resolved_on" IS NULL OR "resolved_on" >= "diagnosed_on");

CREATE INDEX "resident_diagnoses_tenant_id_idx" ON "resident_diagnoses" ("tenant_id");
CREATE INDEX "resident_diagnoses_tenant_id_client_id_resolved_on_idx"
    ON "resident_diagnoses" ("tenant_id", "client_id", "resolved_on");

-- «Los que alertan de este residente», que es lo que la puerta pide 49
-- veces por turno. Parcial: los retirados y los resueltos no alertan.
CREATE INDEX "resident_diagnoses_alertas_idx"
    ON "resident_diagnoses" ("tenant_id", "client_id")
    WHERE "alert_flag" = TRUE AND "resolved_on" IS NULL AND "withdrawn_at" IS NULL;

ALTER TABLE "resident_diagnoses"
    ADD CONSTRAINT "resident_diagnoses_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resident_diagnoses"
    ADD CONSTRAINT "resident_diagnoses_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resident_diagnoses"
    ADD CONSTRAINT "resident_diagnoses_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resident_diagnoses"
    ADD CONSTRAINT "resident_diagnoses_created_by_care_role_assignment_id_fkey"
    FOREIGN KEY ("created_by_care_role_assignment_id") REFERENCES "care_role_assignments" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resident_diagnoses"
    ADD CONSTRAINT "resident_diagnoses_resolved_by_user_id_fkey"
    FOREIGN KEY ("resolved_by_user_id") REFERENCES "users" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resident_diagnoses"
    ADD CONSTRAINT "resident_diagnoses_withdrawn_by_user_id_fkey"
    FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "users" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── EL TRIGGER DE INMUTABILIDAD ─────────────────────────────────────
--
-- Un diagnóstico **no se edita y no se borra**. Dos transiciones pasan y
-- nada más:
--
--   · **resolverlo**: `resolved_on` de NULL a puesto, con su firma;
--   · **retirarlo por error**: `withdrawn_at` de NULL a puesto, con su
--     firma y su motivo.
--
-- Corregir el texto es una fila nueva, igual que corregir un
-- `CareRecord`. Las columnas se comparan **una por una y por su nombre**,
-- no con `row(NEW.*) IS DISTINCT FROM row(OLD.*)`: el día que la tabla
-- gane una columna, el test del contrato del SQL se pone rojo y recuerda
-- por qué.
CREATE FUNCTION mipiacetpv_resident_diagnoses_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: un diagnóstico no se borra (resident_diagnoses.%). Se resuelve, o se retira con su motivo.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    IF NEW.id                                 IS DISTINCT FROM OLD.id
       OR NEW.tenant_id                          IS DISTINCT FROM OLD.tenant_id
       OR NEW.client_id                          IS DISTINCT FROM OLD.client_id
       OR NEW.text_cifrado                       IS DISTINCT FROM OLD.text_cifrado
       OR NEW.icd10_cifrado                      IS DISTINCT FROM OLD.icd10_cifrado
       OR NEW.surgical                           IS DISTINCT FROM OLD.surgical
       OR NEW.diagnosed_on                       IS DISTINCT FROM OLD.diagnosed_on
       OR NEW.alert_flag                         IS DISTINCT FROM OLD.alert_flag
       OR NEW.alert_phrase_cifrado               IS DISTINCT FROM OLD.alert_phrase_cifrado
       OR NEW.created_at                         IS DISTINCT FROM OLD.created_at
       OR NEW.created_by_user_id                 IS DISTINCT FROM OLD.created_by_user_id
       OR NEW.created_by_care_role_assignment_id IS DISTINCT FROM OLD.created_by_care_role_assignment_id THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: un diagnóstico no se edita (resident_diagnoses.%). Corregirlo es escribir otro y retirar éste.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    -- Y las dos transiciones sólo van en un sentido: lo resuelto no
    -- vuelve a activo y lo retirado no vuelve. Reabrir un diagnóstico es
    -- escribir uno nuevo con la fecha de hoy, que es lo que de verdad
    -- pasó.
    IF OLD.resolved_on IS NOT NULL AND NEW.resolved_on IS DISTINCT FROM OLD.resolved_on THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: el diagnóstico % ya estaba resuelto. Si ha vuelto, se escribe uno nuevo.',
            OLD.id USING ERRCODE = '23514';
    END IF;
    IF OLD.withdrawn_at IS NOT NULL AND NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: el diagnóstico % ya estaba retirado y una retirada no se deshace.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "resident_diagnoses_inmutable"
    BEFORE UPDATE OR DELETE ON "resident_diagnoses"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_resident_diagnoses_inmutable();

-- ════════════════════════════════════════════════════════════════════
--  2 · allergies · LO QUE BLOQUEA EN MEDICACIÓN (D-90)
-- ════════════════════════════════════════════════════════════════════
--
-- La clase y la gravedad **en claro**, y es la mitad de la decisión: de
-- la clase cuelga el bloqueo de medicación (Fase 2) y el filtro de la
-- hoja de cocina (cocina-1), y de la gravedad cuelga la franja de alertas
-- (D-91). Cifrarlas obligaría a descifrar todas las alergias del centro
-- para preparar una comida.
--
-- El AGENTE y la REACCIÓN, cifrados. Un `SELECT` sigue diciendo que doña
-- Carmen tiene una alergia grave a un medicamento; lo que no dice es a
-- cuál ni qué le pasa.
CREATE TABLE "allergies" (
    "id"                                 UUID              NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"                          UUID              NOT NULL,
    "client_id"                          UUID              NOT NULL,

    "class"                              "AllergyClass"    NOT NULL,
    "severity"                           "AllergySeverity" NOT NULL,

    "agent_cifrado"                      TEXT              NOT NULL,
    "reaction_cifrado"                   TEXT,

    "withdrawn_at"                       TIMESTAMPTZ,
    "withdrawn_by_user_id"               UUID,
    "withdraw_reason_cifrado"            TEXT,

    "created_at"                         TIMESTAMPTZ       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id"                 UUID              NOT NULL,
    "created_by_care_role_assignment_id" UUID              NOT NULL,

    CONSTRAINT "allergies_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "allergies"
    ADD CONSTRAINT "allergies_agent_cifrado_formato"
    CHECK ("agent_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

ALTER TABLE "allergies"
    ADD CONSTRAINT "allergies_reaction_cifrado_formato"
    CHECK ("reaction_cifrado" IS NULL
           OR "reaction_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

ALTER TABLE "allergies"
    ADD CONSTRAINT "allergies_withdraw_reason_cifrado_formato"
    CHECK ("withdraw_reason_cifrado" IS NULL
           OR "withdraw_reason_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

ALTER TABLE "allergies"
    ADD CONSTRAINT "allergies_retirada_completa"
    CHECK (("withdrawn_at" IS NULL
            AND "withdrawn_by_user_id" IS NULL
            AND "withdraw_reason_cifrado" IS NULL)
        OR ("withdrawn_at" IS NOT NULL
            AND "withdrawn_by_user_id" IS NOT NULL
            AND "withdraw_reason_cifrado" IS NOT NULL));

CREATE INDEX "allergies_tenant_id_idx" ON "allergies" ("tenant_id");
CREATE INDEX "allergies_tenant_id_client_id_withdrawn_at_idx"
    ON "allergies" ("tenant_id", "client_id", "withdrawn_at");

-- «Las vigentes de este residente», que es lo que mira medicación, la
-- cocina y la franja. Parcial: una retirada no bloquea nada.
CREATE INDEX "allergies_vigentes_idx"
    ON "allergies" ("tenant_id", "client_id")
    WHERE "withdrawn_at" IS NULL;

ALTER TABLE "allergies"
    ADD CONSTRAINT "allergies_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "allergies"
    ADD CONSTRAINT "allergies_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "allergies"
    ADD CONSTRAINT "allergies_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "allergies"
    ADD CONSTRAINT "allergies_created_by_care_role_assignment_id_fkey"
    FOREIGN KEY ("created_by_care_role_assignment_id") REFERENCES "care_role_assignments" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "allergies"
    ADD CONSTRAINT "allergies_withdrawn_by_user_id_fkey"
    FOREIGN KEY ("withdrawn_by_user_id") REFERENCES "users" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── EL TRIGGER DE INMUTABILIDAD ─────────────────────────────────────
--
-- **El sabotaje número uno de este bloque es `UPDATE allergies SET
-- agent_cifrado = …` por SQL**, y lo para esto. Una alergia escrita mal
-- se RETIRA y se escribe la buena: las dos filas quedan, y el que
-- prescribe ve que alguien se equivocó y cuándo. Un `UPDATE` dejaría una
-- historia que dice que siempre fue «paracetamol».
--
-- La única transición que pasa es la retirada, con firma y motivo.
CREATE FUNCTION mipiacetpv_allergies_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: una alergia no se borra (allergies.%). Se retira con su motivo, y la fila se queda.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    IF NEW.id                                 IS DISTINCT FROM OLD.id
       OR NEW.tenant_id                          IS DISTINCT FROM OLD.tenant_id
       OR NEW.client_id                          IS DISTINCT FROM OLD.client_id
       OR NEW.class                              IS DISTINCT FROM OLD.class
       OR NEW.severity                           IS DISTINCT FROM OLD.severity
       OR NEW.agent_cifrado                      IS DISTINCT FROM OLD.agent_cifrado
       OR NEW.reaction_cifrado                   IS DISTINCT FROM OLD.reaction_cifrado
       OR NEW.created_at                         IS DISTINCT FROM OLD.created_at
       OR NEW.created_by_user_id                 IS DISTINCT FROM OLD.created_by_user_id
       OR NEW.created_by_care_role_assignment_id IS DISTINCT FROM OLD.created_by_care_role_assignment_id THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: una alergia no se edita (allergies.%). Retírala con su motivo y escribe la correcta.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    IF OLD.withdrawn_at IS NOT NULL AND NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: la alergia % ya estaba retirada y una retirada no se deshace.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "allergies_inmutable"
    BEFORE UPDATE OR DELETE ON "allergies"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_allergies_inmutable();

-- ════════════════════════════════════════════════════════════════════
--  3 · allergy_reviews · **«SIN ALERGIAS CONOCIDAS» ES UN DATO** (D-90)
-- ════════════════════════════════════════════════════════════════════
--
-- La mitad de la decisión que no cabe en `allergies`: *no tener filas no
-- es lo mismo que no tener alergias.* Sin esta tabla, «a don Luis nadie
-- le ha preguntado» y «a don Luis se le preguntó y no tiene» son el mismo
-- `COUNT(*) = 0`.
--
-- **De sólo inserción**, como `client_consents`: cada revisión es una
-- fila con su autor, su capacidad y su fecha. La vigente es la última.
CREATE TABLE "allergy_reviews" (
    "id"                                  UUID        NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"                           UUID        NOT NULL,
    "client_id"                           UUID        NOT NULL,

    -- TRUE = «sin alergias conocidas». En claro: es la columna sobre la
    -- que medicación va a bloquear y la que el ingreso guiado marca.
    "none_known"                          BOOLEAN     NOT NULL,
    "source_cifrado"                      TEXT,

    "reviewed_at"                         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by_user_id"                 UUID        NOT NULL,
    "reviewed_by_care_role_assignment_id" UUID        NOT NULL,

    CONSTRAINT "allergy_reviews_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "allergy_reviews"
    ADD CONSTRAINT "allergy_reviews_source_cifrado_formato"
    CHECK ("source_cifrado" IS NULL
           OR "source_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

CREATE INDEX "allergy_reviews_tenant_id_idx" ON "allergy_reviews" ("tenant_id");
CREATE INDEX "allergy_reviews_tenant_id_client_id_reviewed_at_idx"
    ON "allergy_reviews" ("tenant_id", "client_id", "reviewed_at");

ALTER TABLE "allergy_reviews"
    ADD CONSTRAINT "allergy_reviews_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "allergy_reviews"
    ADD CONSTRAINT "allergy_reviews_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "allergy_reviews"
    ADD CONSTRAINT "allergy_reviews_reviewed_by_user_id_fkey"
    FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "allergy_reviews"
    ADD CONSTRAINT "allergy_reviews_reviewed_by_care_role_assignment_id_fkey"
    FOREIGN KEY ("reviewed_by_care_role_assignment_id") REFERENCES "care_role_assignments" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION mipiacetpv_allergy_reviews_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    RAISE EXCEPTION
        'RESIDENCIA_VIOLADA: una revisión de alergias no se edita ni se borra (allergy_reviews.%). Se escribe otra.',
        OLD.id USING ERRCODE = '23514';
END;
$fn$;

CREATE TRIGGER "allergy_reviews_append_only"
    BEFORE UPDATE OR DELETE ON "allergy_reviews"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_allergy_reviews_append_only();

-- ════════════════════════════════════════════════════════════════════
--  4 · resident_devices · DISPOSITIVOS Y AYUDAS (D-90)
-- ════════════════════════════════════════════════════════════════════
--
-- `code` es TEXT en claro y se valida contra `DISPOSITIVOS_DE_SERIE`
-- (`packages/residencia-plan/src/ficha.ts`): ver el §0 para el criterio.
-- Del mismo fichero sale qué dispositivos son **de riesgo**, que es lo
-- que la franja de alertas mira (D-91) — una sola lista para las dos
-- cosas.
--
-- No se borra: se cierra con `to_on`, igual que una línea del plan y por
-- lo mismo («¿llevaba sonda en marzo?» es una pregunta legítima).
CREATE TABLE "resident_devices" (
    "id"                                 UUID        NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"                          UUID        NOT NULL,
    "client_id"                          UUID        NOT NULL,

    "code"                               TEXT        NOT NULL,
    "detail_cifrado"                     TEXT,

    "from_on"                            DATE        NOT NULL,
    "to_on"                              DATE,

    "created_at"                         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id"                 UUID        NOT NULL,
    "created_by_care_role_assignment_id" UUID        NOT NULL,
    "closed_by_user_id"                  UUID,

    CONSTRAINT "resident_devices_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "resident_devices"
    ADD CONSTRAINT "resident_devices_detail_cifrado_formato"
    CHECK ("detail_cifrado" IS NULL
           OR "detail_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

-- ── `OTRO` exige detalle ────────────────────────────────────────────
--
-- Un «otro» sin decir qué es no sirve de nada en un parte ni en una
-- franja de alertas. El resto de códigos ya se explican solos.
ALTER TABLE "resident_devices"
    ADD CONSTRAINT "resident_devices_otro_con_detalle"
    CHECK ("code" <> 'OTRO' OR "detail_cifrado" IS NOT NULL);

ALTER TABLE "resident_devices"
    ADD CONSTRAINT "resident_devices_fechas_coherentes"
    CHECK ("to_on" IS NULL OR "to_on" >= "from_on");

ALTER TABLE "resident_devices"
    ADD CONSTRAINT "resident_devices_cierre_completo"
    CHECK (("to_on" IS NULL     AND "closed_by_user_id" IS NULL)
        OR ("to_on" IS NOT NULL AND "closed_by_user_id" IS NOT NULL));

CREATE INDEX "resident_devices_tenant_id_idx" ON "resident_devices" ("tenant_id");
CREATE INDEX "resident_devices_tenant_id_client_id_to_on_idx"
    ON "resident_devices" ("tenant_id", "client_id", "to_on");

ALTER TABLE "resident_devices"
    ADD CONSTRAINT "resident_devices_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resident_devices"
    ADD CONSTRAINT "resident_devices_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resident_devices"
    ADD CONSTRAINT "resident_devices_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resident_devices"
    ADD CONSTRAINT "resident_devices_created_by_care_role_assignment_id_fkey"
    FOREIGN KEY ("created_by_care_role_assignment_id") REFERENCES "care_role_assignments" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resident_devices"
    ADD CONSTRAINT "resident_devices_closed_by_user_id_fkey"
    FOREIGN KEY ("closed_by_user_id") REFERENCES "users" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Y aquí NO hay trigger de inmutabilidad, a propósito ─────────────
--
-- Un dispositivo no es un diagnóstico ni una alergia: cerrar uno
-- («dejó el andador en mayo») es la operación normal y no hay nada que
-- un `UPDATE` pueda falsificar que importe clínicamente. Poner un
-- trigger aquí habría sido simetría por simetría, y cada trigger es una
-- escapatoria más que mantener. Lo que sí hay es la firma del cierre,
-- que es lo que la auditoría pregunta.

-- ════════════════════════════════════════════════════════════════════
--  5 · diet_profiles · **LA DIETA, VERSIONADA** (D-90)
-- ════════════════════════════════════════════════════════════════════
--
-- Cada cambio es una versión nueva; la anterior se queda intacta con su
-- `superseded_at`. «¿Qué textura tenía doña Carmen el día que se
-- atragantó?» es la pregunta que se hace después, y un `UPDATE` la deja
-- sin respuesta.
CREATE TABLE "diet_profiles" (
    "id"                                 UUID          NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"                          UUID          NOT NULL,
    "client_id"                          UUID          NOT NULL,

    "version"                            INTEGER       NOT NULL,

    "texture"                            "DietTexture" NOT NULL,
    "thickener"                          BOOLEAN       NOT NULL DEFAULT FALSE,
    "thickener_level"                    INTEGER,

    -- `DIABETICA`, `SIN_SAL`, `SIN_GLUTEN`, `OTRAS`. En claro: de aquí
    -- sale la hoja de emplatado de cocina-1, que es un `GROUP BY`.
    "restrictions"                       TEXT[]        NOT NULL DEFAULT ARRAY[]::TEXT[],
    "notes_cifrado"                      TEXT,

    "superseded_at"                      TIMESTAMPTZ,

    "created_at"                         TIMESTAMPTZ   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id"                 UUID          NOT NULL,
    "created_by_care_role_assignment_id" UUID          NOT NULL,

    CONSTRAINT "diet_profiles_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "diet_profiles"
    ADD CONSTRAINT "diet_profiles_notes_cifrado_formato"
    CHECK ("notes_cifrado" IS NULL
           OR "notes_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

-- ── El espesante y su nivel van juntos ──────────────────────────────
--
-- Un espesante sin nivel no se puede preparar («¿cuánto le echo?») y un
-- nivel sin espesante es una fila a medias. **Y el `IS NOT NULL` va
-- delante del `BETWEEN`**: un CHECK que da NULL pasa, y a ojo no se ve.
ALTER TABLE "diet_profiles"
    ADD CONSTRAINT "diet_profiles_espesante_coherente"
    CHECK (("thickener" = FALSE AND "thickener_level" IS NULL)
        OR ("thickener" = TRUE
            AND "thickener_level" IS NOT NULL
            AND "thickener_level" BETWEEN 1 AND 3));

ALTER TABLE "diet_profiles"
    ADD CONSTRAINT "diet_profiles_version_positiva"
    CHECK ("version" >= 1);

CREATE UNIQUE INDEX "diet_profiles_client_id_version_key"
    ON "diet_profiles" ("client_id", "version");

-- ── UNA VIVA POR RESIDENTE, y lo garantiza el motor ─────────────────
--
-- Índice PARCIAL, igual que `care_plan_items_one_live_key` y
-- `bed_assignments_one_live_per_client_key` y por lo mismo: dos dietas
-- vigentes dejarían a la cocina eligiendo, y la que elija va a ser la
-- que devuelva Postgres ese día.
CREATE UNIQUE INDEX "diet_profiles_una_viva_key"
    ON "diet_profiles" ("client_id")
    WHERE "superseded_at" IS NULL;

CREATE INDEX "diet_profiles_tenant_id_idx" ON "diet_profiles" ("tenant_id");
CREATE INDEX "diet_profiles_tenant_id_client_id_superseded_at_idx"
    ON "diet_profiles" ("tenant_id", "client_id", "superseded_at");

ALTER TABLE "diet_profiles"
    ADD CONSTRAINT "diet_profiles_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "diet_profiles"
    ADD CONSTRAINT "diet_profiles_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "diet_profiles"
    ADD CONSTRAINT "diet_profiles_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "diet_profiles"
    ADD CONSTRAINT "diet_profiles_created_by_care_role_assignment_id_fkey"
    FOREIGN KEY ("created_by_care_role_assignment_id") REFERENCES "care_role_assignments" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── EL TRIGGER: sólo se puede JUBILAR ───────────────────────────────
CREATE FUNCTION mipiacetpv_diet_profiles_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: una versión de dieta no se borra (diet_profiles.%). Se jubila con una versión nueva.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    IF NEW.id                                 IS DISTINCT FROM OLD.id
       OR NEW.tenant_id                          IS DISTINCT FROM OLD.tenant_id
       OR NEW.client_id                          IS DISTINCT FROM OLD.client_id
       OR NEW.version                            IS DISTINCT FROM OLD.version
       OR NEW.texture                            IS DISTINCT FROM OLD.texture
       OR NEW.thickener                          IS DISTINCT FROM OLD.thickener
       OR NEW.thickener_level                    IS DISTINCT FROM OLD.thickener_level
       OR NEW.restrictions                       IS DISTINCT FROM OLD.restrictions
       OR NEW.notes_cifrado                      IS DISTINCT FROM OLD.notes_cifrado
       OR NEW.created_at                         IS DISTINCT FROM OLD.created_at
       OR NEW.created_by_user_id                 IS DISTINCT FROM OLD.created_by_user_id
       OR NEW.created_by_care_role_assignment_id IS DISTINCT FROM OLD.created_by_care_role_assignment_id THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: una dieta no se edita (diet_profiles.%). Cambiarla es escribir la versión siguiente.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    IF OLD.superseded_at IS NOT NULL AND NEW.superseded_at IS DISTINCT FROM OLD.superseded_at THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: la dieta % ya estaba jubilada y no vuelve a vigente.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "diet_profiles_inmutable"
    BEFORE UPDATE OR DELETE ON "diet_profiles"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_diet_profiles_inmutable();

-- ════════════════════════════════════════════════════════════════════
--  6 · resident_absences · **LAS AUSENCIAS, QUE PAUSAN** (D-92)
-- ════════════════════════════════════════════════════════════════════
--
-- El tipo y los tres instantes **en claro**: de ellos salen los días de
-- la factura de la Junta (D-93), «¿quién está fuera hoy?» para `queToca`
-- y el denominador de los indicadores. El destino y el motivo, cifrados.
CREATE TABLE "resident_absences" (
    "id"                                  UUID                  NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"                           UUID                  NOT NULL,
    "client_id"                           UUID                  NOT NULL,

    "kind"                                "ResidentAbsenceKind" NOT NULL,

    -- TIMESTAMPTZ y no DATE, al contrario que `admission_date`: la hora
    -- decide qué ocurrencias se pausan. Una señora que sale a las 15:00
    -- tenía su higiene de la mañana.
    "started_at"                          TIMESTAMPTZ           NOT NULL,
    "expected_end_at"                     TIMESTAMPTZ,
    "ended_at"                            TIMESTAMPTZ,

    "destination_cifrado"                 TEXT,
    "reason_cifrado"                      TEXT,

    -- LA REVISIÓN AL VOLVER (D-92).
    "review_required"                     BOOLEAN               NOT NULL DEFAULT FALSE,
    "reviewed_at"                         TIMESTAMPTZ,
    "reviewed_by_user_id"                 UUID,
    "reviewed_by_care_role_assignment_id" UUID,

    -- La incidencia N4 de una salida no controlada.
    "incident_id"                         UUID,

    -- LA CORRECCIÓN FIRMADA de las fechas: la única forma de cambiarlas.
    "corrected_at"                        TIMESTAMPTZ,
    "corrected_by_user_id"                UUID,
    "correction_reason"                   TEXT,

    "created_at"                          TIMESTAMPTZ           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id"                  UUID                  NOT NULL,
    "created_by_care_role_assignment_id"  UUID                  NOT NULL,
    "closed_by_user_id"                   UUID,

    CONSTRAINT "resident_absences_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "resident_absences"
    ADD CONSTRAINT "resident_absences_destination_cifrado_formato"
    CHECK ("destination_cifrado" IS NULL
           OR "destination_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

ALTER TABLE "resident_absences"
    ADD CONSTRAINT "resident_absences_reason_cifrado_formato"
    CHECK ("reason_cifrado" IS NULL
           OR "reason_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

-- ── No se vuelve antes de irse ──────────────────────────────────────
ALTER TABLE "resident_absences"
    ADD CONSTRAINT "resident_absences_instantes_coherentes"
    CHECK ("ended_at" IS NULL OR "ended_at" >= "started_at");

-- ── La vuelta lleva firma ───────────────────────────────────────────
ALTER TABLE "resident_absences"
    ADD CONSTRAINT "resident_absences_cierre_completo"
    CHECK (("ended_at" IS NULL     AND "closed_by_user_id" IS NULL)
        OR ("ended_at" IS NOT NULL AND "closed_by_user_id" IS NOT NULL));

-- ── La revisión va completa, o no va ────────────────────────────────
--
-- Y sólo se puede revisar lo que YA VOLVIÓ: confirmar «revisada tras el
-- ingreso» de alguien que sigue en el hospital es firmar una revisión
-- que no ha pasado.
ALTER TABLE "resident_absences"
    ADD CONSTRAINT "resident_absences_revision_completa"
    CHECK (("reviewed_at" IS NULL
            AND "reviewed_by_user_id" IS NULL
            AND "reviewed_by_care_role_assignment_id" IS NULL)
        OR ("reviewed_at" IS NOT NULL
            AND "reviewed_by_user_id" IS NOT NULL
            AND "reviewed_by_care_role_assignment_id" IS NOT NULL
            AND "ended_at" IS NOT NULL));

ALTER TABLE "resident_absences"
    ADD CONSTRAINT "resident_absences_correccion_completa"
    CHECK (("corrected_at" IS NULL
            AND "corrected_by_user_id" IS NULL
            AND "correction_reason" IS NULL)
        OR ("corrected_at" IS NOT NULL
            AND "corrected_by_user_id" IS NOT NULL
            AND "correction_reason" IS NOT NULL));

-- ── Y la incidencia es SÓLO de la salida no controlada ──────────────
--
-- Una ausencia planificada no abre nada en el libro; atarle una
-- incidencia sería decir que unas vacaciones con la hija son un evento.
ALTER TABLE "resident_absences"
    ADD CONSTRAINT "resident_absences_incidencia_solo_si_no_controlada"
    CHECK ("incident_id" IS NULL OR "kind" = 'SALIDA_NO_CONTROLADA');

-- ── UNA VIVA POR RESIDENTE ──────────────────────────────────────────
--
-- Nadie está en el hospital y de vacaciones a la vez, y dos ausencias
-- abiertas dejarían «¿desde cuándo está fuera?» sin respuesta única. La
-- garantía es del motor, como las dos de `bed_assignments`.
CREATE UNIQUE INDEX "resident_absences_una_viva_key"
    ON "resident_absences" ("client_id")
    WHERE "ended_at" IS NULL;

CREATE INDEX "resident_absences_tenant_id_idx" ON "resident_absences" ("tenant_id");
CREATE INDEX "resident_absences_tenant_id_client_id_started_at_idx"
    ON "resident_absences" ("tenant_id", "client_id", "started_at");

-- «¿Quién está fuera ahora?», que es lo que `queToca`, el parte y la
-- puerta preguntan en cada pasada.
CREATE INDEX "resident_absences_abiertas_idx"
    ON "resident_absences" ("tenant_id")
    WHERE "ended_at" IS NULL;

-- «¿Qué vueltas están pendientes de revisar?», que es la fila del panel.
CREATE INDEX "resident_absences_por_revisar_idx"
    ON "resident_absences" ("tenant_id", "ended_at")
    WHERE "review_required" = TRUE AND "reviewed_at" IS NULL;

ALTER TABLE "resident_absences"
    ADD CONSTRAINT "resident_absences_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resident_absences"
    ADD CONSTRAINT "resident_absences_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resident_absences"
    ADD CONSTRAINT "resident_absences_incident_id_fkey"
    FOREIGN KEY ("incident_id") REFERENCES "incidents" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resident_absences"
    ADD CONSTRAINT "resident_absences_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resident_absences"
    ADD CONSTRAINT "resident_absences_created_by_care_role_assignment_id_fkey"
    FOREIGN KEY ("created_by_care_role_assignment_id") REFERENCES "care_role_assignments" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resident_absences"
    ADD CONSTRAINT "resident_absences_closed_by_user_id_fkey"
    FOREIGN KEY ("closed_by_user_id") REFERENCES "users" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resident_absences"
    ADD CONSTRAINT "resident_absences_reviewed_by_user_id_fkey"
    FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resident_absences"
    ADD CONSTRAINT "resident_absences_reviewed_by_care_role_assignment_id_fkey"
    FOREIGN KEY ("reviewed_by_care_role_assignment_id") REFERENCES "care_role_assignments" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "resident_absences"
    ADD CONSTRAINT "resident_absences_corrected_by_user_id_fkey"
    FOREIGN KEY ("corrected_by_user_id") REFERENCES "users" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── EL TRIGGER · **BORRAR UNA AUSENCIA ES BORRAR DÍAS DE FACTURA** ──
--
-- Es el sabotaje número dos del bloque. Lo que pasa y nada más:
--
--   · **cerrarla** (poner `ended_at` y su firma);
--   · **marcar y hacer la revisión** al volver;
--   · **corregir las fechas**, y sólo si la fila trae a la vez la
--     corrección firmada (`corrected_at`, quién y por qué). Mismo patrón
--     que `duty_occurrences_hecha_no_vuelve`: un «se me fue el dedo» se
--     arregla diciendo quién lo arregla.
--
-- El tipo, el residente y el centro no cambian nunca: convertir un
-- ingreso hospitalario en unas vacaciones cambia tres días de la factura
-- de la Junta y no deja rastro.
CREATE FUNCTION mipiacetpv_resident_absences_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: una ausencia no se borra (resident_absences.%). Son días de la factura de la administración.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    IF NEW.id                                 IS DISTINCT FROM OLD.id
       OR NEW.tenant_id                          IS DISTINCT FROM OLD.tenant_id
       OR NEW.client_id                          IS DISTINCT FROM OLD.client_id
       OR NEW.kind                               IS DISTINCT FROM OLD.kind
       OR NEW.created_at                         IS DISTINCT FROM OLD.created_at
       OR NEW.created_by_user_id                 IS DISTINCT FROM OLD.created_by_user_id
       OR NEW.created_by_care_role_assignment_id IS DISTINCT FROM OLD.created_by_care_role_assignment_id THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: de una ausencia no se cambian el tipo ni el residente (resident_absences.%).',
            OLD.id USING ERRCODE = '23514';
    END IF;

    -- Las fechas, sólo con la corrección firmada EN LA MISMA fila.
    IF (NEW.started_at IS DISTINCT FROM OLD.started_at
        OR (OLD.ended_at IS NOT NULL AND NEW.ended_at IS DISTINCT FROM OLD.ended_at))
       AND (NEW.corrected_at IS NULL
            OR NEW.corrected_by_user_id IS NULL
            OR NEW.correction_reason IS NULL
            OR NEW.corrected_at IS NOT DISTINCT FROM OLD.corrected_at) THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: las fechas de la ausencia % sólo se corrigen con quién y por qué, en la misma operación.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    -- Y una revisión firmada no se retira: que la DUE revisó la vuelta a
    -- las 09:40 es un hecho.
    IF OLD.reviewed_at IS NOT NULL AND NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at THEN
        RAISE EXCEPTION
            'RESIDENCIA_VIOLADA: la vuelta de la ausencia % ya estaba revisada y una revisión no se deshace.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "resident_absences_inmutable"
    BEFORE UPDATE OR DELETE ON "resident_absences"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_resident_absences_inmutable();

-- ════════════════════════════════════════════════════════════════════
--  7 · admission_checklist_items · EL INGRESO GUIADO (D-94)
-- ════════════════════════════════════════════════════════════════════
--
-- Un elemento por fila, y **sin tabla padre**: la lista es el conjunto de
-- sus filas (ver la cabecera del modelo). Las doce de serie se insertan
-- con el residente, en la misma transacción que su alta.
CREATE TABLE "admission_checklist_items" (
    "id"                                UUID        NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"                         UUID        NOT NULL,
    "client_id"                         UUID        NOT NULL,

    "code"                              TEXT        NOT NULL,
    -- TRUE = se COMPRUEBA, no se marca. Ver el CHECK de abajo.
    "auto"                              BOOLEAN     NOT NULL DEFAULT FALSE,
    "due_on"                            VARCHAR(10),

    "done_at"                           TIMESTAMPTZ,
    "done_by_user_id"                   UUID,
    "done_by_care_role_assignment_id"   UUID,
    "done_note_cifrado"                 TEXT,

    "file_name"                         VARCHAR(100),
    "file_sha256"                       CHAR(64),
    "file_bytes"                        INTEGER,
    "file_mime_type"                    VARCHAR(80),

    "created_at"                        TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admission_checklist_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "admission_checklist_items"
    ADD CONSTRAINT "admission_checklist_items_done_note_cifrado_formato"
    CHECK ("done_note_cifrado" IS NULL
           OR "done_note_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

-- ── LO MARCADO A MANO VA COMPLETO, Y LOS `auto` NO SE MARCAN ────────
--
-- Las dos mitades en un solo CHECK porque son la misma regla: marcar a
-- mano un elemento que el sistema comprueba (la cama, la dieta, el plan)
-- es justo la forma de que la lista mienta — alguien marca «cama
-- asignada» y la cama no está.
ALTER TABLE "admission_checklist_items"
    ADD CONSTRAINT "admission_checklist_items_hecho_completo"
    CHECK (("done_at" IS NULL
            AND "done_by_user_id" IS NULL
            AND "done_by_care_role_assignment_id" IS NULL)
        OR ("auto" = FALSE
            AND "done_at" IS NOT NULL
            AND "done_by_user_id" IS NOT NULL
            AND "done_by_care_role_assignment_id" IS NOT NULL));

ALTER TABLE "admission_checklist_items"
    ADD CONSTRAINT "admission_checklist_items_adjunto_completo"
    CHECK (("file_name" IS NULL
            AND "file_sha256" IS NULL
            AND "file_bytes" IS NULL
            AND "file_mime_type" IS NULL)
        OR ("file_name" IS NOT NULL
            AND "file_sha256" IS NOT NULL
            AND "file_bytes" IS NOT NULL
            AND "file_mime_type" IS NOT NULL));

-- Un elemento por residente: es lo que hace **idempotente** la inserción
-- de la lista al ingresar.
CREATE UNIQUE INDEX "admission_checklist_items_client_id_code_key"
    ON "admission_checklist_items" ("client_id", "code");

CREATE INDEX "admission_checklist_items_tenant_id_idx"
    ON "admission_checklist_items" ("tenant_id");

-- «¿Qué se marcó y cuándo?», el orden de la pantalla del ingreso.
CREATE INDEX "admission_checklist_items_tenant_id_done_at_idx"
    ON "admission_checklist_items" ("tenant_id", "done_at");

-- «¿Qué ingresos tienen pendientes?», que es la fila del panel de
-- dirección. Parcial: lo hecho no se mira.
CREATE INDEX "admission_checklist_items_pendientes_idx"
    ON "admission_checklist_items" ("tenant_id", "client_id")
    WHERE "done_at" IS NULL;

ALTER TABLE "admission_checklist_items"
    ADD CONSTRAINT "admission_checklist_items_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "admission_checklist_items"
    ADD CONSTRAINT "admission_checklist_items_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "admission_checklist_items"
    ADD CONSTRAINT "admission_checklist_items_done_by_user_id_fkey"
    FOREIGN KEY ("done_by_user_id") REFERENCES "users" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "admission_checklist_items"
    ADD CONSTRAINT "admission_checklist_items_done_by_care_role_assignment_id_fkey"
    FOREIGN KEY ("done_by_care_role_assignment_id") REFERENCES "care_role_assignments" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════
--  8 · center_admission_settings · LOS DOS PLAZOS DEL CENTRO
-- ════════════════════════════════════════════════════════════════════
--
-- `discharge_notice_days` nace **NULL a propósito** (D-96): el plazo de
-- comunicación de una baja es normativa autonómica, y escribir «15 días»
-- porque suena bien es prometer un plazo que puede no ser el de la Junta.
CREATE TABLE "center_admission_settings" (
    "tenant_id"                UUID        NOT NULL,
    "initial_care_plan_days"   INTEGER     NOT NULL DEFAULT 30,
    "discharge_notice_days"    INTEGER,
    "created_at"               TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"               TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_user_id"       UUID,

    CONSTRAINT "center_admission_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- **El `IS NOT NULL` delante del `BETWEEN`** en el segundo, que sí es
-- nullable. En el primero no hace falta —es NOT NULL— y se escribe igual:
-- es la forma de la casa, y lo que hace que el CHECK siga siendo verdad
-- el día que alguien haga la columna opcional.
ALTER TABLE "center_admission_settings"
    ADD CONSTRAINT "center_admission_settings_pai_valido"
    CHECK ("initial_care_plan_days" IS NOT NULL
           AND "initial_care_plan_days" BETWEEN 1 AND 365);

ALTER TABLE "center_admission_settings"
    ADD CONSTRAINT "center_admission_settings_baja_valida"
    CHECK ("discharge_notice_days" IS NULL
           OR "discharge_notice_days" BETWEEN 1 AND 180);

ALTER TABLE "center_admission_settings"
    ADD CONSTRAINT "center_admission_settings_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "center_admission_settings"
    ADD CONSTRAINT "center_admission_settings_updated_by_user_id_fkey"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ════════════════════════════════════════════════════════════════════
--  9 · resident_profiles.discharge_kind · POR QUÉ SE FUE (D-96)
-- ════════════════════════════════════════════════════════════════════
--
-- **Nullable, y no es una concesión**: las filas dadas de alta ANTES de
-- este bloque tienen fecha y motivo libre y no se les inventa una clase.
-- Un `UPDATE … SET discharge_kind = 'OTRA'` aquí sería alguien decidiendo
-- a mano por qué se fue una persona de la que no sabe nada.
ALTER TABLE "resident_profiles"
    ADD COLUMN "discharge_kind" "ResidentDischargeKind";

-- La única coherencia que se puede exigir: una clase sin fecha de alta no
-- significa nada. El revés —fecha sin clase— es exactamente lo que las
-- filas viejas tienen, así que no se exige.
ALTER TABLE "resident_profiles"
    ADD CONSTRAINT "resident_profiles_alta_clase"
    CHECK ("discharge_kind" IS NULL OR "discharge_date" IS NOT NULL);
