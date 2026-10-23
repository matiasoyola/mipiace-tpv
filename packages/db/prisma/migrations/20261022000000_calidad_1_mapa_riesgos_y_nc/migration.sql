-- calidad-1 (D-70 a D-76) · **EL MAPA ÚNICO DE PROCESOS, LOS RIESGOS Y
-- EL CICLO DE LA NO CONFORMIDAD.**
--
-- AENOR puso en 2026 una **NC 01** (apartado 4.4.1, menor) porque Jardín
-- de Gredos no presenta evidencia de «una única determinación de sus
-- procesos»: hay **8 procesos** en la pantalla de indicadores y **4** en
-- la de riesgos y oportunidades. Y porque siguen sin asociarse a proceso
-- cuatro riesgos intrínsecos de una residencia: errores en el tratamiento
-- médico, intoxicaciones alimentarias, datos confidenciales y salidas no
-- controladas.
--
-- Lo que esta migración crea es el sitio donde eso **no se puede volver a
-- repetir**:
--
--   1. `processes` — **EL MAPA, UNO POR CENTRO** (D-70). Indicadores,
--      riesgos, objetivos y no conformidades cuelgan de aquí con FK
--      `NOT NULL` y `Restrict`. No hay otra lista de procesos en ninguna
--      pantalla del producto, así que **no existe el sitio donde
--      escribir el segundo mapa**. La NC 01 queda cerrada por
--      construcción, que es distinto de cerrarla por disciplina.
--   2. `indicator_processes` — de qué proceso del centro cuelga cada
--      indicador del producto (D-72).
--   3. `risk_opportunities` — riesgos y oportunidades con probabilidad,
--      impacto, nivel y **fecha de revisión** (D-71).
--   4. `quality_objectives` — los objetivos de calidad del año, colgados
--      del proceso que los persigue.
--   5. `non_conformities` + `corrective_actions` +
--      `corrective_action_evidences` + `effectiveness_verifications` —
--      **EL EXPEDIENTE DE UNA NC** (D-73): clase, origen, causa,
--      acciones con responsable y plazo, evidencias y verificación de
--      eficacia.
--
-- ── ADITIVA DEL TODO ────────────────────────────────────────────────
--
-- Ocho tablas nuevas vacías y siete tipos nuevos. **Ni un `ALTER TABLE`
-- sobre una tabla que ya tenía filas**, ni un `DROP`, ni un `DELETE`, ni
-- un `TRUNCATE`, ni un `UPDATE … SET` fuera de las funciones de los
-- triggers. Un test enumera los `ALTER TABLE` y comprueba que sólo
-- nombran tablas de este bloque.
--
-- Es la primera migración de residencia que no toca nada de antes, y se
-- nota en el riesgo: lo único que puede fallar al aplicarla es que no
-- existan las tablas a las que apunta (`care_roles`, `incidents`,
-- `care_role_assignments`), y las tres son de residencia-1 y -4.
--
-- ── LOS SIETE TIPOS SE CREAN Y SE USAN AQUÍ MISMO ───────────────────
--
-- Sin migración de tipos aparte, al revés que residencia-3, -4 y -5.
-- Postgres sólo prohíbe usar un valor de enum **en la transacción en que
-- se AÑADE a un tipo que ya existía**; crear el tipo entero y usarlo
-- acto seguido es legal. Aquí los siete son nuevos, así que la factura
-- que aquellas tres pagaron no se paga. El test del contrato del SQL lo
-- fija, para que nadie añada mañana un valor a `IncidentOrigin` en este
-- fichero.
--
-- ── EL `down` ───────────────────────────────────────────────────────
--
--   DROP TRIGGER "non_conformities_inmutable" ON "non_conformities";
--   DROP TRIGGER "corrective_actions_append_only" ON "corrective_actions";
--   DROP TRIGGER "corrective_action_evidences_append_only" ON "corrective_action_evidences";
--   DROP TRIGGER "effectiveness_verifications_append_only" ON "effectiveness_verifications";
--   DROP TRIGGER "effectiveness_verifications_otra_persona" ON "effectiveness_verifications";
--   DROP FUNCTION mipiacetpv_non_conformities_inmutable();
--   DROP FUNCTION mipiacetpv_corrective_actions_append_only();
--   DROP FUNCTION mipiacetpv_calidad_append_only();
--   DROP FUNCTION mipiacetpv_verificacion_otra_persona();
--   DROP TABLE "effectiveness_verifications", "corrective_action_evidences",
--              "corrective_actions", "non_conformities",
--              "quality_objectives", "risk_opportunities",
--              "indicator_processes", "processes";
--   DROP TYPE "QualityObjectiveStatus", "VerificationResult",
--             "NonConformityState", "NonConformityOrigin",
--             "NonConformityKind", "RiskKind", "ProcessType";
--
-- Es **completo** mientras no haya una sola no conformidad cerrada
-- dentro: después, el `down` tira la evidencia de que la mejora se hizo
-- y se comprobó, que es justo lo que una certificadora pide conservar.
-- Lo mismo que dejó escrito residencia-5 del parte de relevo.

-- ════════════════════════════════════════════════════════════════════
--  0 · LOS SIETE TIPOS NUEVOS
-- ════════════════════════════════════════════════════════════════════

-- Las tres filas de un mapa de procesos. **Seis operativos y no uno**:
-- la observación 07 de AENOR dice que «el proceso único de PRESTACIÓN
-- DEL SERVICIO junta actividades muy diversas».
CREATE TYPE "ProcessType" AS ENUM ('STRATEGIC', 'OPERATIONAL', 'SUPPORT');

-- Riesgo y oportunidad en la misma tabla porque es el mismo trabajo y
-- porque la ISO 9001 los pide juntos en el 6.1.
CREATE TYPE "RiskKind" AS ENUM ('RISK', 'OPPORTUNITY');

CREATE TYPE "NonConformityKind" AS ENUM ('MAJOR', 'MINOR', 'OBSERVATION', 'IMPROVEMENT');

-- Enum y no texto libre: el PAC se filtra por el origen («todas las de
-- la auditoría externa de julio»), y un filtro sobre texto no encuentra
-- «AENOR» cuando alguien escribió «Aenor 2026».
CREATE TYPE "NonConformityOrigin" AS ENUM (
    'INTERNAL_AUDIT', 'EXTERNAL_AUDIT', 'INSPECTION', 'INCIDENT',
    'COMPLAINT', 'INDICATOR', 'MANAGEMENT_REVIEW', 'OTHER'
);

CREATE TYPE "NonConformityState" AS ENUM (
    'OPEN', 'CAUSE_ANALYSED', 'ACTIONS', 'ACTIONS_CLOSED', 'CLOSED'
);

CREATE TYPE "VerificationResult" AS ENUM ('EFFECTIVE', 'NOT_EFFECTIVE');

CREATE TYPE "QualityObjectiveStatus" AS ENUM ('OPEN', 'MET', 'NOT_MET', 'CANCELLED');

-- ════════════════════════════════════════════════════════════════════
--  1 · processes · EL MAPA, UNO POR CENTRO (D-70)
-- ════════════════════════════════════════════════════════════════════
--
-- El producto trae un mapa de referencia de once procesos
-- (`catalogo/procesos-de-serie.ts`) y el centro lo **carga una vez y lo
-- adapta**: renombra, añade los suyos y desactiva los que no usa.
--
-- `reference_code` guarda de qué proceso de referencia salió cada uno
-- aunque le cambien el nombre. Es lo que ata cada indicador del producto
-- a su proceso (D-72) y lo que hace que **cargar el mapa dos veces no lo
-- duplique**: el índice único de abajo lo impide.
--
-- El responsable es un **ROL de cuidado, no una persona** (D-29, D-50):
-- el dueño de un proceso es «la DUE» o «calidad», y quien ocupa ese rol
-- cambia en agosto.
CREATE TABLE "processes" (
    "id"                       UUID         NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"                UUID         NOT NULL,
    "code"                     TEXT         NOT NULL,
    "name"                     TEXT         NOT NULL,
    "type"                     "ProcessType" NOT NULL,
    "purpose"                  TEXT,
    "reference_code"           TEXT,
    "responsible_care_role_id" UUID         NOT NULL,
    "active"                   BOOLEAN      NOT NULL DEFAULT true,
    "sort_order"               INTEGER      NOT NULL DEFAULT 0,
    "created_at"               TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"               TIMESTAMPTZ  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id"       UUID,

    CONSTRAINT "processes_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "processes"
    ADD CONSTRAINT "processes_code_no_vacio"
    CHECK ("code" <> '' AND "name" <> '');

ALTER TABLE "processes"
    ADD CONSTRAINT "processes_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- `Restrict`: un rol que es responsable de un proceso del mapa es
-- vocabulario vivo del centro. Primero se le pasa el proceso a otro rol,
-- después se retira el rol. Misma regla que `management_duties`.
ALTER TABLE "processes"
    ADD CONSTRAINT "processes_responsible_care_role_id_fkey"
    FOREIGN KEY ("responsible_care_role_id") REFERENCES "care_roles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "processes"
    ADD CONSTRAINT "processes_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "processes_tenant_id_code_key"
    ON "processes"("tenant_id", "code");
-- **Y el de referencia, una sola vez por centro.** Postgres admite
-- NULLs repetidos, así que los procesos que añade el centro —que no
-- vienen de ninguno de referencia— no chocan entre sí. Es lo que hace
-- idempotente «cargar el mapa de referencia».
CREATE UNIQUE INDEX "processes_tenant_id_reference_code_key"
    ON "processes"("tenant_id", "reference_code");
CREATE INDEX "processes_tenant_id_idx" ON "processes"("tenant_id");
CREATE INDEX "processes_tenant_id_active_sort_order_idx"
    ON "processes"("tenant_id", "active", "sort_order");

-- ════════════════════════════════════════════════════════════════════
--  2 · indicator_processes · DE QUÉ PROCESO CUELGA UN INDICADOR (D-72)
-- ════════════════════════════════════════════════════════════════════
--
-- Una fila por indicador del producto, creada al cargar el mapa y
-- apuntando al proceso que salió del `procesoDeReferencia` de ese
-- indicador. Después el centro puede colgarlo de otro proceso suyo.
--
-- **No es una columna de `indicator_targets`** y la razón es que son dos
-- cosas con dos vidas: aquélla existe sólo cuando el centro cambia el
-- umbral (residencia-5 decidió a propósito no sembrarla, para que «un
-- umbral sembrado y nunca revisado» no se confunda con uno que la
-- dirección eligió), y el proceso tiene que estar **siempre**. Juntas,
-- colgar un proceso habría obligado a sembrar un umbral.
--
-- `code` en claro y sin FK, igual que en `indicator_targets` y por lo
-- mismo (D-11 llevado al panel): un indicador nuevo en 2028 es una fila
-- del fichero del producto, no una migración.
CREATE TABLE "indicator_processes" (
    "id"                 UUID        NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"          UUID        NOT NULL,
    "code"               TEXT        NOT NULL,
    "process_id"         UUID        NOT NULL,
    "created_at"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_user_id" UUID,

    CONSTRAINT "indicator_processes_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "indicator_processes"
    ADD CONSTRAINT "indicator_processes_code_no_vacio"
    CHECK ("code" <> '');

ALTER TABLE "indicator_processes"
    ADD CONSTRAINT "indicator_processes_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- `Restrict`, como los otros tres hijos del mapa: un proceso con
-- indicadores colgando no se borra, y desactivarlo obliga a reasignarlos
-- primero.
ALTER TABLE "indicator_processes"
    ADD CONSTRAINT "indicator_processes_process_id_fkey"
    FOREIGN KEY ("process_id") REFERENCES "processes"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "indicator_processes"
    ADD CONSTRAINT "indicator_processes_updated_by_user_id_fkey"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "indicator_processes_tenant_id_code_key"
    ON "indicator_processes"("tenant_id", "code");
CREATE INDEX "indicator_processes_tenant_id_idx"
    ON "indicator_processes"("tenant_id");
CREATE INDEX "indicator_processes_process_id_idx"
    ON "indicator_processes"("process_id");

-- ════════════════════════════════════════════════════════════════════
--  3 · risk_opportunities · LOS RIESGOS Y LAS OPORTUNIDADES (D-71)
-- ════════════════════════════════════════════════════════════════════
--
-- Los cuatro que la NC 01 nombra uno por uno vienen de serie y **ya
-- colgados de su proceso**. El resto los añade el centro.
--
-- `level = probability * impact`, con su CHECK. Columna y no cálculo
-- porque el panel ordena por ella, y CHECK y no `GENERATED` porque
-- Prisma no sabe leer columnas generadas sin ignorarlas — y una columna
-- que el cliente ignora es una columna que nadie comprueba.
--
-- Las bandas (bajo 1-2 · medio 3-4 · alto 6-9) son del producto y viven
-- en `packages/residencia-plan/src/calidad.ts`.
--
-- **La descripción va EN CLARO, y está declarado.** Al revés que la de
-- una NC: un riesgo describe algo que puede pasar en el centro, no algo
-- que le pasó a doña Carmen. En claro es consultable, que es lo que
-- permite pintar y exportar el mapa de riesgos sin descifrar nada.
CREATE TABLE "risk_opportunities" (
    "id"                   UUID        NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"            UUID        NOT NULL,
    "process_id"           UUID        NOT NULL,
    "kind"                 "RiskKind"  NOT NULL,
    "code"                 TEXT,
    "description"          TEXT        NOT NULL,
    "probability"          INTEGER     NOT NULL,
    "impact"               INTEGER     NOT NULL,
    "level"                INTEGER     NOT NULL,
    "planned_action"       TEXT,
    "review_at"            VARCHAR(10) NOT NULL,
    "reviewed_at"          TIMESTAMPTZ,
    "reviewed_by_user_id"  UUID,
    "iso_clause"           TEXT,
    "active"               BOOLEAN     NOT NULL DEFAULT true,
    "created_at"           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id"   UUID,

    CONSTRAINT "risk_opportunities_pkey" PRIMARY KEY ("id")
);

-- El `IS NOT NULL` delante del rango aunque la columna sea `NOT NULL`:
-- es la regla de la casa desde residencia-5 («un CHECK que da NULL
-- PASA»), y el día que alguien relaje el `NOT NULL` el rango sigue
-- sujetando.
ALTER TABLE "risk_opportunities"
    ADD CONSTRAINT "risk_opportunities_probabilidad_1_3"
    CHECK ("probability" IS NOT NULL AND "probability" BETWEEN 1 AND 3);

ALTER TABLE "risk_opportunities"
    ADD CONSTRAINT "risk_opportunities_impacto_1_3"
    CHECK ("impact" IS NOT NULL AND "impact" BETWEEN 1 AND 3);

-- El nivel NO se puede escribir a mano con otro número.
ALTER TABLE "risk_opportunities"
    ADD CONSTRAINT "risk_opportunities_nivel_coherente"
    CHECK ("level" IS NOT NULL AND "probability" IS NOT NULL AND "impact" IS NOT NULL
           AND "level" = "probability" * "impact");

ALTER TABLE "risk_opportunities"
    ADD CONSTRAINT "risk_opportunities_descripcion_no_vacia"
    CHECK ("description" <> '');

-- La fecha de pared, con su forma. Mismo CHECK y mismas razones que
-- `care_records_dia_formato`.
ALTER TABLE "risk_opportunities"
    ADD CONSTRAINT "risk_opportunities_revision_formato"
    CHECK ("review_at" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

-- Revisado es quién y cuándo, las dos o ninguna: «revisado» sin firma es
-- haber movido una fecha.
ALTER TABLE "risk_opportunities"
    ADD CONSTRAINT "risk_opportunities_revision_completa"
    CHECK (("reviewed_at" IS NULL AND "reviewed_by_user_id" IS NULL)
        OR ("reviewed_at" IS NOT NULL AND "reviewed_by_user_id" IS NOT NULL));

ALTER TABLE "risk_opportunities"
    ADD CONSTRAINT "risk_opportunities_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "risk_opportunities"
    ADD CONSTRAINT "risk_opportunities_process_id_fkey"
    FOREIGN KEY ("process_id") REFERENCES "processes"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "risk_opportunities"
    ADD CONSTRAINT "risk_opportunities_reviewed_by_user_id_fkey"
    FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "risk_opportunities"
    ADD CONSTRAINT "risk_opportunities_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Los de serie, una vez por centro. Los del centro llevan `code` NULL y
-- no chocan.
CREATE UNIQUE INDEX "risk_opportunities_tenant_id_code_key"
    ON "risk_opportunities"("tenant_id", "code");
CREATE INDEX "risk_opportunities_tenant_id_idx"
    ON "risk_opportunities"("tenant_id");
CREATE INDEX "risk_opportunities_process_id_idx"
    ON "risk_opportunities"("process_id");
-- «¿Qué revisión de riesgo está vencida?», que es la pregunta del panel.
-- **Entero y no parcial `WHERE active`**, al revés que el de las
-- incidencias abiertas: el registro de riesgos de un centro son
-- veinte filas y lo seguirá siendo, así que el parcial no ahorra nada y
-- Prisma no sabe declararlo — serían dos índices para la misma consulta
-- y una deriva permanente en `migrate diff`.
CREATE INDEX "risk_opportunities_tenant_id_review_at_idx"
    ON "risk_opportunities"("tenant_id", "review_at");

-- ════════════════════════════════════════════════════════════════════
--  4 · quality_objectives · LOS OBJETIVOS DEL AÑO
-- ════════════════════════════════════════════════════════════════════
--
-- Los cuatro de 2026 de Jardín de Gredos (informe de AENOR §6) son de
-- ésta. Entran en este bloque porque **caben sin pantalla nueva**: son
-- una sección más de la ficha del proceso, igual que sus riesgos. El
-- seguimiento anual con su borrador de revisión por la dirección es
-- calidad-2.
CREATE TABLE "quality_objectives" (
    "id"                 UUID                     NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"          UUID                     NOT NULL,
    "process_id"         UUID                     NOT NULL,
    "year"               INTEGER                  NOT NULL,
    "name"               TEXT                     NOT NULL,
    "target"             TEXT                     NOT NULL,
    "status"             "QualityObjectiveStatus" NOT NULL DEFAULT 'OPEN',
    "indicator_code"     TEXT,
    "progress_note"      TEXT,
    "iso_clause"         TEXT,
    "created_at"         TIMESTAMPTZ              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMPTZ              NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,

    CONSTRAINT "quality_objectives_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "quality_objectives"
    ADD CONSTRAINT "quality_objectives_dice_algo"
    CHECK ("name" <> '' AND "target" <> '');

-- Un objetivo de calidad de 1998 o de 2200 es un dedo mal puesto.
ALTER TABLE "quality_objectives"
    ADD CONSTRAINT "quality_objectives_anio_razonable"
    CHECK ("year" IS NOT NULL AND "year" BETWEEN 2000 AND 2100);

ALTER TABLE "quality_objectives"
    ADD CONSTRAINT "quality_objectives_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "quality_objectives"
    ADD CONSTRAINT "quality_objectives_process_id_fkey"
    FOREIGN KEY ("process_id") REFERENCES "processes"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "quality_objectives"
    ADD CONSTRAINT "quality_objectives_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "quality_objectives_tenant_id_idx"
    ON "quality_objectives"("tenant_id");
CREATE INDEX "quality_objectives_process_id_idx"
    ON "quality_objectives"("process_id");
CREATE INDEX "quality_objectives_tenant_id_year_idx"
    ON "quality_objectives"("tenant_id", "year");

-- ════════════════════════════════════════════════════════════════════
--  5 · non_conformities · EL EXPEDIENTE (D-73)
-- ════════════════════════════════════════════════════════════════════
--
-- Entidad propia y **no una fila más de `incidents`** (que es lo que
-- D-38 dejó abierto «para cuando se acerque la auditoría»). La razón es
-- la forma: una incidencia del libro es un hecho con nivel, cierre y
-- comunicación a la familia; una NC es un **expediente** con causa,
-- acciones con responsable y plazo, evidencias y verificación de
-- eficacia. Metida en `incidents` habrían hecho falta seis columnas que
-- están NULL en el 99 % de las filas y un trigger que las exigiera según
-- el tipo.
--
-- Lo que SÍ comparte con el libro es el régimen: append-only, y la
-- clase, el origen y quién la abrió no se cambian ni por SQL.
--
-- `id` SIN `DEFAULT`: el AAD de `description_cifrado` ata el valor a
-- `tenant|non_conformities|description|<id>` y el id hay que saberlo
-- antes de insertar. Misma decisión exacta que `care_records.id` y
-- `handovers.id`.
CREATE TABLE "non_conformities" (
    "id"         UUID                  NOT NULL,
    "tenant_id"  UUID                  NOT NULL,
    "process_id" UUID                  NOT NULL,

    "reference"  TEXT                  NOT NULL,
    "kind"       "NonConformityKind"   NOT NULL,
    "origin"     "NonConformityOrigin" NOT NULL,
    "state"      "NonConformityState"  NOT NULL DEFAULT 'OPEN',
    "iso_clause" TEXT,

    -- Qué día se detectó: la fecha del informe o del acta, que es la que
    -- cuenta para el plazo del PAC. No es `created_at`: una NC de julio
    -- se puede meter en agosto.
    "detected_on" VARCHAR(10) NOT NULL,

    -- Los dos textos libres, CIFRADOS AL NACER (D-63). Una NC puede
    -- nombrar a un residente: «falta la hoja de cambios posturales de la
    -- 112 del martes» es salud con todas las letras.
    "description_cifrado" TEXT NOT NULL,
    "cause_cifrado"       TEXT,

    -- DE DÓNDE SALIÓ.
    "source_incident_id"      UUID,
    "source_indicator_code"   TEXT,
    "source_indicator_month"  VARCHAR(7),
    "source_note"             TEXT,

    -- EL INFORME ADJUNTO: fichero del volumen con cabecera `MPC1`, clase
    -- `EVIDENCIA`, igual que el certificado de una obligación.
    "report_file_name" VARCHAR(100),
    "report_sha256"    CHAR(64),
    "report_bytes"     INTEGER,
    "report_mime_type" VARCHAR(80),

    -- QUIÉN LA ABRIÓ (D-31): persona + capacidad.
    "opened_at"                         TIMESTAMPTZ NOT NULL,
    "opened_by_user_id"                 UUID        NOT NULL,
    "opened_by_care_role_assignment_id" UUID        NOT NULL,

    -- EL CIERRE.
    "closed_at"                         TIMESTAMPTZ,
    "closed_by_user_id"                 UUID,
    "closed_by_care_role_assignment_id" UUID,

    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "non_conformities_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "non_conformities"
    ADD CONSTRAINT "non_conformities_referencia_no_vacia"
    CHECK ("reference" <> '');

ALTER TABLE "non_conformities"
    ADD CONSTRAINT "non_conformities_description_cifrado_formato"
    CHECK ("description_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

ALTER TABLE "non_conformities"
    ADD CONSTRAINT "non_conformities_cause_cifrado_formato"
    CHECK ("cause_cifrado" IS NULL
           OR "cause_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

ALTER TABLE "non_conformities"
    ADD CONSTRAINT "non_conformities_deteccion_formato"
    CHECK ("detected_on" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

-- **LA PRIMERA PUERTA DEL CICLO, EN EL MOTOR.** Una NC mayor o menor no
-- sale de `OPEN` sin causa analizada; una observación o una oportunidad
-- de mejora sí (D-73). Es una regla de la propia fila, así que es un
-- CHECK y no un trigger: más barato y más difícil de rodear.
ALTER TABLE "non_conformities"
    ADD CONSTRAINT "non_conformities_causa_antes_de_acciones"
    CHECK ("state" = 'OPEN'
        OR "kind" IN ('OBSERVATION', 'IMPROVEMENT')
        OR "cause_cifrado" IS NOT NULL);

-- Una NC cerrada sin saber quién la cerró es media evidencia. Las tres
-- juntas o ninguna.
ALTER TABLE "non_conformities"
    ADD CONSTRAINT "non_conformities_cierre_completo"
    CHECK (("closed_at" IS NULL AND "closed_by_user_id" IS NULL
                AND "closed_by_care_role_assignment_id" IS NULL)
        OR ("closed_at" IS NOT NULL AND "closed_by_user_id" IS NOT NULL
                AND "closed_by_care_role_assignment_id" IS NOT NULL));

-- Y el estado y el cierre dicen lo mismo. Son dos columnas para la misma
-- verdad —la segunda existe por el índice— y que no se puedan
-- contradecir lo dice el motor, no la ruta.
ALTER TABLE "non_conformities"
    ADD CONSTRAINT "non_conformities_cerrada_coherente"
    CHECK (("state" = 'CLOSED' AND "closed_at" IS NOT NULL)
        OR ("state" <> 'CLOSED' AND "closed_at" IS NULL));

-- Elevar una incidencia (D-38) es el origen `INCIDENT` o `COMPLAINT`, y
-- sin la incidencia detrás el enlace no existe: «salió de una queja» sin
-- decir de cuál no se puede volver a mirar.
ALTER TABLE "non_conformities"
    ADD CONSTRAINT "non_conformities_origen_incidencia"
    CHECK ("origin" NOT IN ('INCIDENT', 'COMPLAINT')
        OR "source_incident_id" IS NOT NULL);

-- Y el indicador va con su mes, los dos o ninguno: un indicador sin mes
-- tampoco se puede volver a mirar.
ALTER TABLE "non_conformities"
    ADD CONSTRAINT "non_conformities_origen_indicador"
    CHECK (("source_indicator_code" IS NULL AND "source_indicator_month" IS NULL)
        OR ("source_indicator_code" IS NOT NULL AND "source_indicator_month" IS NOT NULL));

ALTER TABLE "non_conformities"
    ADD CONSTRAINT "non_conformities_origen_indicador_exige_dato"
    CHECK ("origin" <> 'INDICATOR' OR "source_indicator_code" IS NOT NULL);

ALTER TABLE "non_conformities"
    ADD CONSTRAINT "non_conformities_mes_formato"
    CHECK ("source_indicator_month" IS NULL
           OR "source_indicator_month" ~ '^[0-9]{4}-[0-9]{2}$');

-- Las cuatro del informe adjunto, juntas o ninguna: media evidencia es
-- una fila que dice que hay un PDF que no se puede servir.
ALTER TABLE "non_conformities"
    ADD CONSTRAINT "non_conformities_informe_completo"
    CHECK (("report_file_name" IS NULL AND "report_sha256" IS NULL
                AND "report_bytes" IS NULL AND "report_mime_type" IS NULL)
        OR ("report_file_name" IS NOT NULL AND "report_sha256" IS NOT NULL
                AND "report_bytes" IS NOT NULL AND "report_mime_type" IS NOT NULL));

-- ── Las FKs · RESTRICT en todo lo que dice QUÉ y QUIÉN ──────────────
ALTER TABLE "non_conformities"
    ADD CONSTRAINT "non_conformities_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- **LA FK QUE CIERRA LA NC 01.** `NOT NULL` y `RESTRICT`: no hay NC sin
-- proceso, y un proceso con NC no se borra.
ALTER TABLE "non_conformities"
    ADD CONSTRAINT "non_conformities_process_id_fkey"
    FOREIGN KEY ("process_id") REFERENCES "processes"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- La incidencia que originó una NC no se borra. En el libro ya no se
-- borraba nada; esto lo vuelve a decir desde este lado.
ALTER TABLE "non_conformities"
    ADD CONSTRAINT "non_conformities_source_incident_id_fkey"
    FOREIGN KEY ("source_incident_id") REFERENCES "incidents"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "non_conformities"
    ADD CONSTRAINT "non_conformities_opened_by_user_id_fkey"
    FOREIGN KEY ("opened_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "non_conformities"
    ADD CONSTRAINT "non_conformities_opened_by_care_role_assignment_id_fkey"
    FOREIGN KEY ("opened_by_care_role_assignment_id") REFERENCES "care_role_assignments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "non_conformities"
    ADD CONSTRAINT "non_conformities_closed_by_user_id_fkey"
    FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "non_conformities"
    ADD CONSTRAINT "non_conformities_closed_by_care_role_assignment_id_fkey"
    FOREIGN KEY ("closed_by_care_role_assignment_id") REFERENCES "care_role_assignments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "non_conformities_tenant_id_reference_key"
    ON "non_conformities"("tenant_id", "reference");
CREATE INDEX "non_conformities_tenant_id_idx"
    ON "non_conformities"("tenant_id");
CREATE INDEX "non_conformities_process_id_idx"
    ON "non_conformities"("process_id");
CREATE INDEX "non_conformities_tenant_id_state_idx"
    ON "non_conformities"("tenant_id", "state");
-- «¿Qué NC siguen abiertas?» es la pregunta del panel y de la pantalla.
-- Parcial, como `incidents_abiertas_key` y por lo mismo: la lista es
-- corta y el registro crece para siempre. Éste SÍ se queda parcial
-- —al revés que los dos de arriba— porque indexa una pareja de columnas
-- que ningún índice declarado en Prisma cubre, así que no duplica nada.
CREATE INDEX "non_conformities_abiertas_key"
    ON "non_conformities"("tenant_id", "detected_on")
    WHERE "state" <> 'CLOSED';
-- Y el filtro del PAC: por origen y periodo.
CREATE INDEX "non_conformities_tenant_id_origin_detected_on_idx"
    ON "non_conformities"("tenant_id", "origin", "detected_on");
CREATE INDEX "non_conformities_source_incident_id_idx"
    ON "non_conformities"("source_incident_id");

-- ════════════════════════════════════════════════════════════════════
--  6 · corrective_actions · QUÉ, QUIÉN Y PARA CUÁNDO (D-73)
-- ════════════════════════════════════════════════════════════════════
--
-- Es la fila que el PAC a AENOR enseña, y la que hace que «se resolvió
-- de palabra» deje de ser posible: con responsable y plazo, una acción
-- vencida sale en el panel de dirección con su nombre.
--
-- `id` sin `DEFAULT` por el AAD de `what_cifrado`, como la NC.
CREATE TABLE "corrective_actions" (
    "id"                 UUID NOT NULL,
    "tenant_id"          UUID NOT NULL,
    "non_conformity_id"  UUID NOT NULL,

    "what_cifrado" TEXT NOT NULL,

    -- El responsable: un rol, una persona o una etiqueta libre
    -- («Gestoría», «CINSA»). Exactamente una.
    "responsible_care_role_id" UUID,
    "responsible_user_id"      UUID,
    "responsible_label"        TEXT,

    "due_on" VARCHAR(10) NOT NULL,

    "opened_at"                         TIMESTAMPTZ NOT NULL,
    "opened_by_user_id"                 UUID        NOT NULL,
    "opened_by_care_role_assignment_id" UUID        NOT NULL,

    "closed_at"                         TIMESTAMPTZ,
    "closed_by_user_id"                 UUID,
    "closed_by_care_role_assignment_id" UUID,
    "closing_note_cifrado"              TEXT,

    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "corrective_actions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "corrective_actions"
    ADD CONSTRAINT "corrective_actions_what_cifrado_formato"
    CHECK ("what_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

ALTER TABLE "corrective_actions"
    ADD CONSTRAINT "corrective_actions_closing_note_cifrado_formato"
    CHECK ("closing_note_cifrado" IS NULL
           OR "closing_note_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

ALTER TABLE "corrective_actions"
    ADD CONSTRAINT "corrective_actions_plazo_formato"
    CHECK ("due_on" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');

-- EXACTAMENTE UN responsable. Copia literal del CHECK de
-- `management_duties`, y por lo mismo: una acción sin responsable es una
-- acción que nadie hace, y dos responsables son ninguno.
ALTER TABLE "corrective_actions"
    ADD CONSTRAINT "corrective_actions_responsable"
    CHECK (
        (CASE WHEN "responsible_care_role_id" IS NOT NULL THEN 1 ELSE 0 END)
      + (CASE WHEN "responsible_user_id"      IS NOT NULL THEN 1 ELSE 0 END)
      + (CASE WHEN "responsible_label"        IS NOT NULL THEN 1 ELSE 0 END) = 1
    );

ALTER TABLE "corrective_actions"
    ADD CONSTRAINT "corrective_actions_cierre_completo"
    CHECK (("closed_at" IS NULL AND "closed_by_user_id" IS NULL
                AND "closed_by_care_role_assignment_id" IS NULL)
        OR ("closed_at" IS NOT NULL AND "closed_by_user_id" IS NOT NULL
                AND "closed_by_care_role_assignment_id" IS NOT NULL));

-- Y la nota de cierre es de una acción cerrada: sin cierre no hay qué
-- contar.
ALTER TABLE "corrective_actions"
    ADD CONSTRAINT "corrective_actions_nota_exige_cierre"
    CHECK ("closing_note_cifrado" IS NULL OR "closed_at" IS NOT NULL);

ALTER TABLE "corrective_actions"
    ADD CONSTRAINT "corrective_actions_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "corrective_actions"
    ADD CONSTRAINT "corrective_actions_non_conformity_id_fkey"
    FOREIGN KEY ("non_conformity_id") REFERENCES "non_conformities"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- `RESTRICT` en el responsable y no `SET NULL`, por la lección de
-- `clinical_processor_agreements` que `management_duties` dejó escrita:
-- un `SET NULL` dejaría la fila sin ningún responsable y el CHECK de
-- arriba —que exige exactamente uno— la rechazaría al ejecutarse. La
-- pantalla obliga a reasignar antes de dar de baja a nadie.
ALTER TABLE "corrective_actions"
    ADD CONSTRAINT "corrective_actions_responsible_care_role_id_fkey"
    FOREIGN KEY ("responsible_care_role_id") REFERENCES "care_roles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "corrective_actions"
    ADD CONSTRAINT "corrective_actions_responsible_user_id_fkey"
    FOREIGN KEY ("responsible_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "corrective_actions"
    ADD CONSTRAINT "corrective_actions_opened_by_user_id_fkey"
    FOREIGN KEY ("opened_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "corrective_actions"
    ADD CONSTRAINT "corrective_actions_opened_by_care_role_assignment_id_fkey"
    FOREIGN KEY ("opened_by_care_role_assignment_id") REFERENCES "care_role_assignments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "corrective_actions"
    ADD CONSTRAINT "corrective_actions_closed_by_user_id_fkey"
    FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "corrective_actions"
    ADD CONSTRAINT "corrective_actions_closed_by_care_role_assignment_id_fkey"
    FOREIGN KEY ("closed_by_care_role_assignment_id") REFERENCES "care_role_assignments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "corrective_actions_tenant_id_idx"
    ON "corrective_actions"("tenant_id");
CREATE INDEX "corrective_actions_non_conformity_id_idx"
    ON "corrective_actions"("non_conformity_id");
-- «¿Qué acción está vencida?», que es la pregunta del panel. Entero y no
-- parcial `WHERE closed_at IS NULL`, por lo mismo que el de los riesgos.
CREATE INDEX "corrective_actions_tenant_id_due_on_idx"
    ON "corrective_actions"("tenant_id", "due_on");

-- ════════════════════════════════════════════════════════════════════
--  7 · corrective_action_evidences · LA PRUEBA DE QUE SE HIZO
-- ════════════════════════════════════════════════════════════════════
--
-- Un fichero, una nota, o las dos. Sin esto el PAC dice que se hizo algo
-- y no lo demuestra, que es la mitad de lo que AENOR mira.
--
-- El fichero va al volumen de siempre con la clase `EVIDENCIA`, la misma
-- que la de una obligación de dirección: no se inventa una carpeta. Y
-- por eso el **barrido de huérfanos** de residencia-6 tiene que contar
-- también estas filas — si no, borraría los adjuntos del PAC por no
-- encontrarlos referenciados.
CREATE TABLE "corrective_action_evidences" (
    "id"        UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "action_id" UUID NOT NULL,

    "file_name" VARCHAR(100),
    "sha256"    CHAR(64),
    "bytes"     INTEGER,
    "mime_type" VARCHAR(80),

    "note_cifrado" TEXT,

    "at"                         TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "by_user_id"                 UUID        NOT NULL,
    "by_care_role_assignment_id" UUID        NOT NULL,

    CONSTRAINT "corrective_action_evidences_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "corrective_action_evidences"
    ADD CONSTRAINT "corrective_action_evidences_note_cifrado_formato"
    CHECK ("note_cifrado" IS NULL
           OR "note_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

-- Las cuatro del fichero, juntas o ninguna.
ALTER TABLE "corrective_action_evidences"
    ADD CONSTRAINT "corrective_action_evidences_fichero_completo"
    CHECK (("file_name" IS NULL AND "sha256" IS NULL
                AND "bytes" IS NULL AND "mime_type" IS NULL)
        OR ("file_name" IS NOT NULL AND "sha256" IS NOT NULL
                AND "bytes" IS NOT NULL AND "mime_type" IS NOT NULL));

-- Y una evidencia vacía no es una evidencia: o hay fichero, o hay nota.
ALTER TABLE "corrective_action_evidences"
    ADD CONSTRAINT "corrective_action_evidences_dice_algo"
    CHECK ("file_name" IS NOT NULL OR "note_cifrado" IS NOT NULL);

ALTER TABLE "corrective_action_evidences"
    ADD CONSTRAINT "corrective_action_evidences_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "corrective_action_evidences"
    ADD CONSTRAINT "corrective_action_evidences_action_id_fkey"
    FOREIGN KEY ("action_id") REFERENCES "corrective_actions"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "corrective_action_evidences"
    ADD CONSTRAINT "corrective_action_evidences_by_user_id_fkey"
    FOREIGN KEY ("by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "corrective_action_evidences"
    ADD CONSTRAINT "corrective_action_evidences_by_care_role_assignment_id_fkey"
    FOREIGN KEY ("by_care_role_assignment_id") REFERENCES "care_role_assignments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "corrective_action_evidences_tenant_id_idx"
    ON "corrective_action_evidences"("tenant_id");
CREATE INDEX "corrective_action_evidences_action_id_at_idx"
    ON "corrective_action_evidences"("action_id", "at");

-- ════════════════════════════════════════════════════════════════════
--  8 · effectiveness_verifications · ¿FUNCIONÓ? (D-73)
-- ════════════════════════════════════════════════════════════════════
--
-- La pieza que separa un sistema de calidad de una carpeta de buenas
-- intenciones. «Se formó al personal» no es que el problema esté
-- resuelto: lo es que tres meses después el registro ya no tenga huecos.
CREATE TABLE "effectiveness_verifications" (
    "id"                UUID                 NOT NULL,
    "tenant_id"         UUID                 NOT NULL,
    "non_conformity_id" UUID                 NOT NULL,
    "result"            "VerificationResult" NOT NULL,
    -- Cifrada y OBLIGATORIA: una verificación que sólo dice «sí» no
    -- verifica nada.
    "note_cifrado"      TEXT                 NOT NULL,

    "at"                         TIMESTAMPTZ NOT NULL,
    "by_user_id"                 UUID        NOT NULL,
    "by_care_role_assignment_id" UUID        NOT NULL,
    "created_at"                 TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "effectiveness_verifications_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "effectiveness_verifications"
    ADD CONSTRAINT "effectiveness_verifications_note_cifrado_formato"
    CHECK ("note_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

ALTER TABLE "effectiveness_verifications"
    ADD CONSTRAINT "effectiveness_verifications_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "effectiveness_verifications"
    ADD CONSTRAINT "effectiveness_verifications_non_conformity_id_fkey"
    FOREIGN KEY ("non_conformity_id") REFERENCES "non_conformities"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "effectiveness_verifications"
    ADD CONSTRAINT "effectiveness_verifications_by_user_id_fkey"
    FOREIGN KEY ("by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "effectiveness_verifications"
    ADD CONSTRAINT "effectiveness_verifications_by_care_role_assignment_id_fkey"
    FOREIGN KEY ("by_care_role_assignment_id") REFERENCES "care_role_assignments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "effectiveness_verifications_tenant_id_idx"
    ON "effectiveness_verifications"("tenant_id");
CREATE INDEX "effectiveness_verifications_non_conformity_id_at_idx"
    ON "effectiveness_verifications"("non_conformity_id", "at");

-- ════════════════════════════════════════════════════════════════════
--  9 · LOS TRIGGERS · lo que no se puede hacer NI POR SQL
-- ════════════════════════════════════════════════════════════════════
--
-- La tabla de sabotajes del bloque se contesta aquí y no en las rutas.
-- Las cuatro preguntas que había que cerrar:
--
--   · `UPDATE` de la clase o el origen de una NC por SQL  → el motor;
--   · borrar un proceso con una NC colgando               → el motor (FK);
--   · texto en claro en la descripción de una NC          → el motor (CHECK);
--   · cerrar por SQL una NC sin verificación de eficacia  → **el motor**,
--     y es la que costaba: es una regla que mira OTRA tabla, así que no
--     cabe en un CHECK y hay que bajarla a un trigger. Se baja, porque
--     dejarla sólo en la ruta sería dejar la evidencia de la mejora a
--     merced de un `UPDATE`.

-- ── 9.1 · La NC es inmutable, con cuatro transiciones legítimas ─────
--
-- Lo que pasó no se edita; lo que cambia es lo que se DECIDE después:
--
--   1. **el estado** (`state`), que es el ciclo;
--   2. **la causa** (`cause_cifrado`), que se escribe una vez — y
--      después ya no se reescribe: el trigger deja ponerla pero no
--      cambiarla, porque una causa que se reescribe es una causa que se
--      acomoda al resultado;
--   3. **el proceso** (`process_id`), porque reasignar es lo que permite
--      desactivar un proceso sin perder nada;
--   4. **el cierre** y **el informe adjunto**, que llega cuando llega.
--
-- Las trece columnas inmutables se comparan **una por una y por su
-- nombre**. Un `row(NEW.*) IS DISTINCT FROM row(OLD.*)` habría sido más
-- corto y habría dejado pasar en silencio cualquier columna añadida
-- después; con esto, el día que la tabla gane una, el test del contrato
-- del SQL se pone rojo y recuerda por qué.
CREATE FUNCTION mipiacetpv_non_conformities_inmutable() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
    eficaz BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'CALIDAD_VIOLADA: una no conformidad no se borra (non_conformities.%). Se cierra, con causa, acciones y verificación de eficacia, y se queda en el registro.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    IF NEW.id                                 IS DISTINCT FROM OLD.id
       OR NEW.tenant_id                          IS DISTINCT FROM OLD.tenant_id
       OR NEW.reference                          IS DISTINCT FROM OLD.reference
       OR NEW.kind                               IS DISTINCT FROM OLD.kind
       OR NEW.origin                             IS DISTINCT FROM OLD.origin
       OR NEW.detected_on                        IS DISTINCT FROM OLD.detected_on
       OR NEW.description_cifrado                IS DISTINCT FROM OLD.description_cifrado
       OR NEW.source_incident_id                 IS DISTINCT FROM OLD.source_incident_id
       OR NEW.source_indicator_code              IS DISTINCT FROM OLD.source_indicator_code
       OR NEW.source_indicator_month             IS DISTINCT FROM OLD.source_indicator_month
       OR NEW.opened_at                          IS DISTINCT FROM OLD.opened_at
       OR NEW.opened_by_user_id                  IS DISTINCT FROM OLD.opened_by_user_id
       OR NEW.opened_by_care_role_assignment_id  IS DISTINCT FROM OLD.opened_by_care_role_assignment_id
       OR NEW.created_at                         IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION
            'CALIDAD_VIOLADA: la clase, el origen, la descripción y quién abrió la no conformidad % no se cambian. Lo que se decide después se escribe como ACCIÓN o como VERIFICACIÓN, con su autor y su hora.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    -- La causa se escribe UNA vez.
    IF OLD.cause_cifrado IS NOT NULL
       AND NEW.cause_cifrado IS DISTINCT FROM OLD.cause_cifrado THEN
        RAISE EXCEPTION
            'CALIDAD_VIOLADA: la causa de la no conformidad % ya está analizada y no se reescribe. Una causa que se reescribe es una causa que se acomoda al resultado.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    -- Una cerrada no se reabre. Si el problema vuelve, se abre otra NC —
    -- misma regla que una incidencia del libro, y por lo mismo: dos
    -- apariciones del mismo fallo son dos hechos, no uno.
    IF OLD.state = 'CLOSED' THEN
        RAISE EXCEPTION
            'CALIDAD_VIOLADA: la no conformidad % está cerrada y una cerrada no se reabre. Si el problema vuelve, se abre otra.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    -- **Y NO SE CIERRA SIN VERIFICACIÓN DE EFICACIA.** Es la fila de la
    -- tabla de sabotajes que había que contestar: lo para el motor, no
    -- la ruta.
    IF NEW.state = 'CLOSED' AND OLD.state <> 'CLOSED' THEN
        SELECT EXISTS (
            SELECT 1 FROM "effectiveness_verifications" v
             WHERE v."non_conformity_id" = NEW.id
               AND v."result" = 'EFFECTIVE'
        ) INTO eficaz;
        IF NOT eficaz THEN
            RAISE EXCEPTION
                'CALIDAD_VIOLADA: la no conformidad % no se cierra sin una verificación de eficacia con resultado EFFECTIVE. Cerrar sin comprobar que la acción funcionó es exactamente lo que un auditor busca.',
                OLD.id USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "non_conformities_inmutable"
    BEFORE UPDATE OR DELETE ON "non_conformities"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_non_conformities_inmutable();

-- ── 9.2 · Una acción se escribe y se cierra. Nada más ───────────────
--
-- Append-only con UNA transición: cerrarla. Y una vez cerrada ya no se
-- toca — ni se reabre ni se le cambia la nota. Una acción mal escrita se
-- corrige escribiendo otra que lo diga, que es lo mismo que hace una
-- `IncidentAction`.
CREATE FUNCTION mipiacetpv_corrective_actions_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION
            'CALIDAD_VIOLADA: una acción correctiva no se borra (corrective_actions.%). Es lo que el PAC enseña.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    IF NEW.id                                 IS DISTINCT FROM OLD.id
       OR NEW.tenant_id                          IS DISTINCT FROM OLD.tenant_id
       OR NEW.non_conformity_id                  IS DISTINCT FROM OLD.non_conformity_id
       OR NEW.what_cifrado                       IS DISTINCT FROM OLD.what_cifrado
       OR NEW.responsible_care_role_id           IS DISTINCT FROM OLD.responsible_care_role_id
       OR NEW.responsible_user_id                IS DISTINCT FROM OLD.responsible_user_id
       OR NEW.responsible_label                  IS DISTINCT FROM OLD.responsible_label
       OR NEW.due_on                             IS DISTINCT FROM OLD.due_on
       OR NEW.opened_at                          IS DISTINCT FROM OLD.opened_at
       OR NEW.opened_by_user_id                  IS DISTINCT FROM OLD.opened_by_user_id
       OR NEW.opened_by_care_role_assignment_id  IS DISTINCT FROM OLD.opened_by_care_role_assignment_id
       OR NEW.created_at                         IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION
            'CALIDAD_VIOLADA: una acción correctiva no se edita (corrective_actions.%). Lo único que se le hace después es cerrarla; si estaba mal, se escribe otra.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    IF OLD.closed_at IS NOT NULL THEN
        RAISE EXCEPTION
            'CALIDAD_VIOLADA: la acción % ya está cerrada y una acción cerrada no se reabre.',
            OLD.id USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "corrective_actions_append_only"
    BEFORE UPDATE OR DELETE ON "corrective_actions"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_corrective_actions_append_only();

-- ── 9.3 · Evidencias y verificaciones: append-only SIN escapatoria ──
--
-- Ni `UPDATE` ni `DELETE`, ninguno. Una función para las dos porque la
-- regla es literalmente la misma y el mensaje se arma con `TG_TABLE_NAME`:
-- dos funciones idénticas son dos sitios donde arreglar el mismo fallo.
CREATE FUNCTION mipiacetpv_calidad_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
    RAISE EXCEPTION
        'CALIDAD_VIOLADA: %.% es append-only: se añade, no se edita ni se borra. Un intento que no funcionó se corrige añadiendo otro que lo diga, y ese rastro es la evidencia.',
        TG_TABLE_NAME, OLD.id USING ERRCODE = '23514';
END;
$fn$;

CREATE TRIGGER "corrective_action_evidences_append_only"
    BEFORE UPDATE OR DELETE ON "corrective_action_evidences"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_calidad_append_only();

CREATE TRIGGER "effectiveness_verifications_append_only"
    BEFORE UPDATE OR DELETE ON "effectiveness_verifications"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_calidad_append_only();

-- ── 9.4 · La eficacia NO la firma quien cerró la última acción ──────
--
-- Misma idea que D-27/D-28 para las incidencias N3 y N4: quien hizo la
-- cosa no es quien certifica que la cosa funcionó. Y aquí sí se
-- **prohíbe** en vez de marcarse, al revés que el autocierre de una N1:
-- una incidencia de madrugada la cierra quien está sola en el centro,
-- pero una verificación de eficacia se firma con semanas de margen y no
-- hay ninguna razón para que la firme la misma persona.
--
-- Va antes del INSERT y mira otra tabla, así que es un trigger y no un
-- CHECK. Y exige además que **haya al menos una acción cerrada**: no se
-- verifica la eficacia de lo que no se ha hecho.
CREATE FUNCTION mipiacetpv_verificacion_otra_persona() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
    ultimo_cierre UUID;
BEGIN
    SELECT a."closed_by_user_id"
      INTO ultimo_cierre
      FROM "corrective_actions" a
     WHERE a."non_conformity_id" = NEW.non_conformity_id
       AND a."closed_at" IS NOT NULL
     ORDER BY a."closed_at" DESC
     LIMIT 1;

    IF ultimo_cierre IS NULL THEN
        RAISE EXCEPTION
            'CALIDAD_VIOLADA: la no conformidad % no tiene ninguna acción cerrada. No se verifica la eficacia de lo que no se ha hecho.',
            NEW.non_conformity_id USING ERRCODE = '23514';
    END IF;

    IF ultimo_cierre = NEW.by_user_id THEN
        RAISE EXCEPTION
            'CALIDAD_VIOLADA: la eficacia la verifica una persona DISTINTA de quien cerró la última acción de la no conformidad %. Quien hizo la cosa no certifica que la cosa funcionó.',
            NEW.non_conformity_id USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$fn$;

CREATE TRIGGER "effectiveness_verifications_otra_persona"
    BEFORE INSERT ON "effectiveness_verifications"
    FOR EACH ROW EXECUTE FUNCTION mipiacetpv_verificacion_otra_persona();
