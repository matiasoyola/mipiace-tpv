-- residencia-2 · EL CATÁLOGO DE CONTROLES Y EL PLAN DE CUIDADOS.
--
-- Lo que esta migración deja en pie es **qué se registra, a quién y
-- cuándo**. No registra nada: el registro (`care_records`) es residencia-3
-- y los umbrales y eventos son residencia-4.
--
-- ── QUÉ GARANTIZA, Y LO GARANTIZA EL MOTOR ────────────────────────────
--
-- Seis cosas, y las seis aquí y no en un `if` de una ruta, porque la
-- aplicación no es la única puerta a Postgres y la segunda es el `psql` de
-- una implantación a las nueve de la noche:
--
--   1. **Un control de serie no tiene centro, y uno de centro sí.** CHECK
--      `control_types_scope_exige_tenant`. Un `STANDARD` con tenant sería
--      un control que una residencia cree del producto y que nadie
--      actualiza; un `CENTER` sin tenant lo verían los quince clientes de
--      hoy.
--   2. **Una sola versión vigente por código**, y hacen falta DOS índices
--      parciales para decirlo —`…_una_vigente_estandar_key` y
--      `…_una_vigente_centro_key`— porque en Postgres los NULL son
--      distintos entre sí y un índice sobre
--      `(scope, tenant_id, code) WHERE superseded_at IS NULL` dejaría
--      entrar dos versiones vigentes de un control de serie. Misma lección
--      exacta que `care_zone_assignments_one_live_centro_key` en
--      residencia-1, y por tercera vez en este repo.
--   3. **Una versión por (código, versión)**, otra vez en dos índices y
--      por lo mismo.
--   4. **La frecuencia es coherente con su tipo.** CHECK
--      `…_frecuencia_coherente` en las cuatro tablas que llevan
--      frecuencia. Un `EVERY_N_HOURS` sin horas es una línea de plan que
--      la puerta leería y no sabría cuándo pedir; un `MONTHLY` con día 31
--      es un control que no toca en febrero y nadie lo notaría hasta
--      marzo (de ahí el tope en 28).
--   5. **Como mucho un «como siempre» por control.** Índice parcial
--      `control_type_options_un_como_siempre_key`. Con dos, el toque de
--      «como siempre» (D-16) tendría que elegir y acabaría eligiendo el
--      orden de la lista.
--   6. **Una línea viva por (residente, control).** Índice parcial
--      `care_plan_items_one_live_key`, `WHERE to_at IS NULL`. Dos líneas
--      vivas del mismo control son dos respuestas a «¿cada cuánto se le
--      cambia de postura?». Y el histórico cabe **porque el índice es
--      parcial**: con uno total, la segunda versión de una línea no
--      entraría y el plan de marzo sería irreconstruible.
--
-- ── POR QUÉ VA EN UNA SOLA MIGRACIÓN Y NO EN DOS ──────────────────────
--
-- residencia-1 fue en dos porque añadía un VALOR (`ROOM`) a un enum que ya
-- existía (`DeviceKind`), y Postgres prohíbe usar un valor nuevo de enum
-- en la misma transacción en la que se añade. Aquí los seis tipos son
-- NUEVOS: `CREATE TYPE` y usar el tipo en la misma transacción sí se
-- puede, y los CHECK que comparan contra sus literales también. Se deja
-- dicho porque la regla se recuerda mal —«los enums van en su propia
-- migración»— y no es eso: es sólo `ALTER TYPE … ADD VALUE`.
--
-- ── MIGRACIÓN ADITIVA ─────────────────────────────────────────────────
--
-- Seis tablas nuevas vacías y seis tipos nuevos. Ni un DROP TABLE, ni un
-- DELETE, ni un TRUNCATE, ni un UPDATE, ni una columna nueva en una tabla
-- que ya tiene filas. **Ninguna tabla existente se toca**, así que no hay
-- scan, no hay bloqueo y ningún tenant de hoy cambia de comportamiento:
-- los seis tipos nacen sin una sola fila y las rutas que los leen están
-- detrás del gate de la residencia.
--
-- ── EL `down`, PENSADO ────────────────────────────────────────────────
--
-- Se revierte entero y sin pérdida mientras no haya registros de
-- residencia-3 apuntando a un `control_types.id` (hoy no existen):
--
--   DROP TABLE "care_plan_items";
--   DROP TABLE "care_plan_template_items";
--   DROP TABLE "center_moments";
--   DROP TABLE "center_control_settings";
--   DROP TABLE "control_type_options";
--   DROP TABLE "control_types";
--   DROP TYPE "CarePlanItemSource";
--   DROP TYPE "CareFrequencyKind";
--   DROP TYPE "ControlScope";
--   DROP TYPE "ControlValueDomain";
--   DROP TYPE "ControlNature";
--   DROP TYPE "ControlLayer";
--
-- A diferencia de residencia-1, aquí el `down` **es completo**: no se
-- añade ningún valor a un enum existente, y `DROP TYPE` de un tipo propio
-- sí existe en Postgres (lo que no existe es `ALTER TYPE … DROP VALUE`).

-- ──────────────────────────────────────────────────────────────────────
-- 1 · Los seis tipos
-- ──────────────────────────────────────────────────────────────────────
--
-- Son enums y no catálogo de datos por la frontera de siempre: es enum lo
-- que, si cambiara, cambiaría el código que lo lee. Cada valor de
-- `ControlLayer` se pinta y se valida distinto; cada valor de
-- `CareFrequencyKind` es una rama de `queToca`.
--
-- Lo que NO es enum y es a propósito: el CÓDIGO del control
-- (`HIGIENE_PERSONAL`, `TEMPERATURA`), el indicador ISO al que alimenta y
-- las opciones de una escala ordinal. Los tres son dato: el primero porque
-- un centro crea los suyos, el segundo porque los indicadores de AENOR
-- cambian con la revisión de la norma y no con un despliegue, y el tercero
-- porque el vocabulario de ánimo y cognición es editable por decisión
-- expresa (D-59).

-- Qué clase de pregunta es (rama de controles §2). `SCALE` y `EVENT` están
-- en el tipo desde ya y **no se siembran en este bloque** (Fase 2 y
-- residencia-4): el día que se siembren no tiene que haber una migración
-- de tipo, que es justamente la factura que residencia-1 pagó.
CREATE TYPE "ControlLayer" AS ENUM ('EXEC', 'OBS', 'MEASURE', 'SCALE', 'EVENT');

-- Qué significa que no esté registrado: se incumple (`SCHEDULED`), no
-- significa nada (`ON_DEMAND`, sólo se cuenta) o no lo registra una
-- persona (`DERIVED`, residencia-4). No es un booleano porque son tres.
CREATE TYPE "ControlNature" AS ENUM ('SCHEDULED', 'ON_DEMAND', 'DERIVED');

-- De qué tipo es el valor. Lo lee el teclado de la puerta y el validador
-- del registro. `ORDINAL` y `SCORE` no son lo mismo aunque los dos sean
-- «un número»: un ordinal tiene cuatro opciones con nombre y un orden; un
-- `SCORE` tiene un rango continuo y un algoritmo detrás.
CREATE TYPE "ControlValueDomain" AS ENUM ('BOOL', 'ORDINAL', 'NUMERIC', 'SCORE', 'TEXT_SHORT');

-- La frontera estándar / centro (rama de controles §10). Lo de serie es
-- global y lo mantiene Mi Piace (D-57); lo del centro no baja a ningún
-- otro centro.
CREATE TYPE "ControlScope" AS ENUM ('STANDARD', 'CENTER');

-- Cómo se reparte en el tiempo. Cada valor es una rama de `queToca`
-- (`packages/residencia-plan`), o sea código. `EVERY_N_HOURS` existe
-- porque los cambios posturales cada 2–3 h —también de noche— son la única
-- frecuencia del catálogo que no se deja describir con turnos.
CREATE TYPE "CareFrequencyKind" AS ENUM ('EVERY_SHIFT', 'DAILY', 'MOMENTS', 'EVERY_N_HOURS', 'WEEKDAYS', 'EVERY_N_DAYS', 'MONTHLY', 'ON_DEMAND');

-- De dónde salió una línea del plan. Es lo que sostiene el cambio de
-- nivel: al pasar a un nivel nuevo se cierran las de plantilla del nivel
-- anterior que no estén en la nueva y **las manuales no se tocan**.
CREATE TYPE "CarePlanItemSource" AS ENUM ('PROFILE_TEMPLATE', 'MANUAL');

-- ──────────────────────────────────────────────────────────────────────
-- 2 · El catálogo
-- ──────────────────────────────────────────────────────────────────────
--
-- Las columnas de aquí son **del producto** y el centro no las toca
-- (rama de controles §10): capa, naturaleza, dominio, unidad, rango de
-- entrada, rango de referencia, indicador ISO y la lista de frecuencias
-- permitidas. Lo que el centro decide vive en `center_control_settings` y
-- es un subconjunto de lo que aquí se permite.
--
-- `ref_min`/`ref_max` es «lo normal», para pintar en gris o en ámbar. **NO
-- es un umbral de aviso**: los umbrales son residencia-4, van en su propia
-- tabla versionada y admiten excepción por residente con prescripción
-- médica firmada (D-21, D-22). Un rango de referencia no.
--
-- Los arrays nacen `NOT NULL DEFAULT '{}'` a propósito: el CHECK de
-- coherencia de frecuencias usa `cardinality()`, y `cardinality(NULL)` es
-- NULL — un CHECK que da NULL **pasa**, así que con arrays nullables el
-- CHECK sería decorativo justo en las filas mal escritas.
CREATE TABLE "control_types" (
    "id" UUID NOT NULL,
    "scope" "ControlScope" NOT NULL,
    "tenant_id" UUID,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "layer" "ControlLayer" NOT NULL,
    "nature" "ControlNature" NOT NULL,
    "value_domain" "ControlValueDomain" NOT NULL,
    "unit" TEXT,
    "input_min" DECIMAL(10,2),
    "input_max" DECIMAL(10,2),
    "ref_min" DECIMAL(10,2),
    "ref_max" DECIMAL(10,2),
    "group_code" TEXT,
    "allowed_frequencies" "CareFrequencyKind"[] NOT NULL DEFAULT '{}',
    "allowed_care_role_codes" TEXT[] NOT NULL DEFAULT '{}',
    "default_frequency_kind" "CareFrequencyKind" NOT NULL,
    "default_every_n_hours" INTEGER,
    "default_every_n_days" INTEGER,
    "default_weekdays" INTEGER[] NOT NULL DEFAULT '{}',
    "default_month_day" INTEGER,
    "default_shift_codes" TEXT[] NOT NULL DEFAULT '{}',
    "default_moment_codes" TEXT[] NOT NULL DEFAULT '{}',
    "iso_indicator_code" TEXT,
    "family_visible_default" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "valid_from" TIMESTAMPTZ NOT NULL,
    "superseded_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "control_types_pkey" PRIMARY KEY ("id")
);

-- ── `scope` ⇔ `tenant_id`, por CHECK y no por costumbre ───────────────
--
-- La correspondencia es una equivalencia y no una implicación: un control
-- de serie tiene `tenant_id` NULL **y** uno de centro lo tiene puesto. Las
-- dos mitades importan, y es la misma forma del CHECK
-- `devices_register_o_habitacion` de residencia-1 por la misma razón: la
-- mitad que parece sobrar es la que sostiene el índice parcial de más
-- abajo (un `CENTER` sin tenant se saldría de
-- `…_una_vigente_centro_key` —los NULL son distintos entre sí— y podría
-- haber dos vigentes).
ALTER TABLE "control_types"
    ADD CONSTRAINT "control_types_scope_exige_tenant" CHECK (
        ("scope" = 'STANDARD' AND "tenant_id" IS NULL)
     OR ("scope" = 'CENTER'   AND "tenant_id" IS NOT NULL));

-- La versión empieza en 1 y sube. Sin esto, un `version = 0` de un script
-- a mano se colaría delante de la primera versión real y «la vigente»
-- dejaría de ser la última.
ALTER TABLE "control_types"
    ADD CONSTRAINT "control_types_version_positiva" CHECK ("version" >= 1);

-- ── La frecuencia DE SERIE es coherente con su tipo ───────────────────
--
-- Qué columnas exige cada `kind`, en el motor. Es el mismo CHECK —con el
-- prefijo `default_`— que llevan las otras tres tablas con frecuencia, y
-- va escrito cuatro veces en vez de en una función porque un CHECK con una
-- función de usuario no se valida al restaurar un `pg_dump` en el orden en
-- que Postgres restaura.
--
-- Los dos topes que son decisiones y no validación:
--
--   · `every_n_hours` entre 1 y 12. Menos de una hora no es un cuidado, es
--     una vigilancia continua (y eso no es este producto); más de 12 es
--     «una vez al día», que ya tiene su `kind`.
--   · `month_day` entre 1 y **28**. No 31: un control mensual con día 31
--     no tocaría en febrero, abril, junio, septiembre ni noviembre, y
--     nadie lo notaría hasta la auditoría. Con el tope en 28, «el día 1 de
--     cada mes» y «el último» se expresan los dos y ninguno se pierde.
ALTER TABLE "control_types"
    ADD CONSTRAINT "control_types_frecuencia_coherente" CHECK (
    CASE "default_frequency_kind"
      WHEN 'EVERY_SHIFT'   THEN cardinality("default_shift_codes") > 0
                            AND cardinality("default_moment_codes") = 0
                            AND "default_every_n_hours" IS NULL
                            AND "default_every_n_days" IS NULL
                            AND cardinality("default_weekdays") = 0
                            AND "default_month_day" IS NULL
      WHEN 'DAILY'         THEN cardinality("default_shift_codes") = 1
                            AND cardinality("default_moment_codes") = 0
                            AND "default_every_n_hours" IS NULL
                            AND "default_every_n_days" IS NULL
                            AND cardinality("default_weekdays") = 0
                            AND "default_month_day" IS NULL
      WHEN 'MOMENTS'       THEN cardinality("default_moment_codes") > 0
                            AND cardinality("default_shift_codes") = 0
                            AND "default_every_n_hours" IS NULL
                            AND "default_every_n_days" IS NULL
                            AND cardinality("default_weekdays") = 0
                            AND "default_month_day" IS NULL
      WHEN 'EVERY_N_HOURS' THEN "default_every_n_hours" BETWEEN 1 AND 12
                            AND cardinality("default_shift_codes") = 0
                            AND cardinality("default_moment_codes") = 0
                            AND "default_every_n_days" IS NULL
                            AND cardinality("default_weekdays") = 0
                            AND "default_month_day" IS NULL
      WHEN 'WEEKDAYS'      THEN cardinality("default_weekdays") > 0
                            AND "default_weekdays" <@ ARRAY[1,2,3,4,5,6,7]
                            AND cardinality("default_shift_codes") = 1
                            AND cardinality("default_moment_codes") = 0
                            AND "default_every_n_hours" IS NULL
                            AND "default_every_n_days" IS NULL
                            AND "default_month_day" IS NULL
      WHEN 'EVERY_N_DAYS'  THEN "default_every_n_days" BETWEEN 1 AND 365
                            AND cardinality("default_shift_codes") = 1
                            AND cardinality("default_moment_codes") = 0
                            AND "default_every_n_hours" IS NULL
                            AND cardinality("default_weekdays") = 0
                            AND "default_month_day" IS NULL
      WHEN 'MONTHLY'       THEN "default_month_day" BETWEEN 1 AND 28
                            AND cardinality("default_shift_codes") = 1
                            AND cardinality("default_moment_codes") = 0
                            AND "default_every_n_hours" IS NULL
                            AND "default_every_n_days" IS NULL
                            AND cardinality("default_weekdays") = 0
      WHEN 'ON_DEMAND'     THEN cardinality("default_shift_codes") = 0
                            AND cardinality("default_moment_codes") = 0
                            AND "default_every_n_hours" IS NULL
                            AND "default_every_n_days" IS NULL
                            AND cardinality("default_weekdays") = 0
                            AND "default_month_day" IS NULL
    END);

-- La frecuencia de serie tiene que estar entre las permitidas. Esta SÍ
-- cabe en un CHECK porque las dos columnas son de la misma fila; la
-- versión del centro no cabe (cruza dos tablas) y vive en la ruta, igual
-- que el requisito de colegiado de residencia-1.
ALTER TABLE "control_types"
    ADD CONSTRAINT "control_types_default_entre_permitidas" CHECK (
        "default_frequency_kind" = ANY ("allowed_frequencies"));

-- Un rango de entrada o de referencia al revés («de 40 a 36 °C») es un
-- rango que nunca se cumple, y la pantalla no dejaría teclear nada.
ALTER TABLE "control_types"
    ADD CONSTRAINT "control_types_rangos_ordenados" CHECK (
        ("input_min" IS NULL OR "input_max" IS NULL OR "input_min" <= "input_max")
    AND ("ref_min"   IS NULL OR "ref_max"   IS NULL OR "ref_min"   <= "ref_max"));

CREATE INDEX "control_types_scope_code_idx" ON "control_types"("scope", "code");
CREATE INDEX "control_types_tenant_id_idx" ON "control_types"("tenant_id");
CREATE INDEX "control_types_layer_sort_order_idx" ON "control_types"("layer", "sort_order");

-- ── UNA SOLA VERSIÓN VIGENTE POR CÓDIGO · y por qué son DOS índices ───
--
-- Lo que se quiere decir es `UNIQUE (scope, tenant_id, code)
-- WHERE superseded_at IS NULL`. Escrito así **no dice eso**: en Postgres
-- los NULL son distintos entre sí, y `tenant_id` es NULL en todos los
-- controles de serie — las dos versiones vigentes de `TEMPERATURA` serían
-- dos claves distintas y las dos entrarían. Nadie lo notaría hasta que la
-- puerta pidiera la temperatura con dos rangos de referencia.
--
-- Es la tercera vez que esta lección se paga en este repo
-- (`ticket_allergies_mesa_key` en kds-1,
-- `care_zone_assignments_one_live_centro_key` en residencia-1), así que
-- aquí está pagada de entrada y tiene su sabotaje con nombre en el e2e.
CREATE UNIQUE INDEX "control_types_una_vigente_estandar_key"
    ON "control_types"("code")
    WHERE "superseded_at" IS NULL AND "scope" = 'STANDARD';
CREATE UNIQUE INDEX "control_types_una_vigente_centro_key"
    ON "control_types"("tenant_id", "code")
    WHERE "superseded_at" IS NULL AND "scope" = 'CENTER';

-- Y la misma partición para «una fila por (código, versión)», por lo
-- mismo: un único `UNIQUE (scope, tenant_id, code, version)` dejaría
-- entrar dos veces la versión 2 de un control de serie.
CREATE UNIQUE INDEX "control_types_codigo_version_estandar_key"
    ON "control_types"("code", "version")
    WHERE "scope" = 'STANDARD';
CREATE UNIQUE INDEX "control_types_codigo_version_centro_key"
    ON "control_types"("tenant_id", "code", "version")
    WHERE "scope" = 'CENTER';

-- `Cascade`, y sólo alcanza a los `CENTER`: los `STANDARD` no tienen
-- tenant. Un control propio de un centro que se da de baja se va con él,
-- igual que sus plantas.
ALTER TABLE "control_types"
    ADD CONSTRAINT "control_types_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────────
-- 3 · Las opciones de un control ordinal
-- ──────────────────────────────────────────────────────────────────────
--
-- «Todo / la mitad / poco / nada» para una comida; «bien / apagado /
-- triste / inquieto / agresivo» para el ánimo (D-59). Ordenadas de mejor a
-- peor, que es como se pintan y como las lee un indicador.
--
-- Tabla y no un `Json` en `control_types` por una sola razón, y es la de
-- abajo: la unicidad del «como siempre» es un invariante del motor, y un
-- JSON no lleva índice parcial.
CREATE TABLE "control_type_options" (
    "id" UUID NOT NULL,
    "control_type_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_as_usual" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "control_type_options_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "control_type_options_control_type_id_code_key"
    ON "control_type_options"("control_type_id", "code");
CREATE INDEX "control_type_options_control_type_id_sort_order_idx"
    ON "control_type_options"("control_type_id", "sort_order");

-- ── COMO MUCHO UN «COMO SIEMPRE» POR CONTROL ──────────────────────────
--
-- D-16 es la mitad del producto: el coste de registrar es proporcional a
-- la anomalía, y la observación diaria se pregunta POR RESIDENTE y no por
-- dimensión — un solo toque en «como siempre» da por buenas todas las
-- dimensiones `OBS` activas. Para que ese toque sepa qué guardar en cada
-- dimensión, cada dimensión declara cuál es su valor «como siempre».
--
-- Con DOS marcadas, el toque tendría que elegir, y «algo» acabaría siendo
-- el orden de la lista. Con NINGUNA, la dimensión simplemente no entra en
-- el atajo y se pregunta siempre — que es lo correcto para una comida:
-- «todo» no es «como siempre», es «hoy se lo comió todo».
CREATE UNIQUE INDEX "control_type_options_un_como_siempre_key"
    ON "control_type_options"("control_type_id")
    WHERE "is_as_usual";

-- `Cascade`: las opciones son parte de la versión del control, no una
-- entidad propia. Una versión nueva del control trae sus opciones.
ALTER TABLE "control_type_options"
    ADD CONSTRAINT "control_type_options_control_type_id_fkey"
    FOREIGN KEY ("control_type_id") REFERENCES "control_types"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────────
-- 4 · Lo que el centro decide de cada control
-- ──────────────────────────────────────────────────────────────────────
--
-- La otra mitad de la frontera. Aquí vive **todo** lo que un centro puede
-- tocar y nada más: si lo activa, cómo lo llama en su glosario, cada
-- cuánto lo quiere de serie, quién lo registra y si lo ve la familia
-- (D-60, interno por defecto).
--
-- ── La clave es el CÓDIGO, no el id de la versión ─────────────────────
--
-- `(tenant_id, control_code)`, y es la decisión de la tabla: una versión
-- nueva de un control de serie **conserva** el ajuste del centro. Con
-- `control_type_id`, cada actualización del catálogo clínico (D-21, D-57)
-- dejaría a los cinco centros con sus ajustes huérfanos y la DUE tendría
-- que volver a decir que la medicación la da ella.
--
-- Por eso no hay FK: apunta a la IDENTIDAD del control, no a una de sus
-- versiones. Y de ahí sale una regla que la ruta tiene que vigilar —**un
-- control propio no puede llevar el código de uno de serie**, porque
-- entonces `(tenant_id, code)` no sabría de cuál de los dos es el ajuste—
-- que contesta 409 y tiene su test.
CREATE TABLE "center_control_settings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "control_code" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "alias" TEXT,
    "frequency_kind" "CareFrequencyKind" NOT NULL,
    "every_n_hours" INTEGER,
    "every_n_days" INTEGER,
    "weekdays" INTEGER[] NOT NULL DEFAULT '{}',
    "month_day" INTEGER,
    "shift_codes" TEXT[] NOT NULL DEFAULT '{}',
    "moment_codes" TEXT[] NOT NULL DEFAULT '{}',
    "care_role_codes" TEXT[] NOT NULL DEFAULT '{}',
    "family_visible" BOOLEAN NOT NULL DEFAULT false,
    "reconducted_at" TIMESTAMPTZ,
    "reconducted_from_version" INTEGER,
    "reconducted_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "center_control_settings_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "center_control_settings"
    ADD CONSTRAINT "center_control_settings_frecuencia_coherente" CHECK (
    CASE "frequency_kind"
      WHEN 'EVERY_SHIFT'   THEN cardinality("shift_codes") > 0 AND cardinality("moment_codes") = 0 AND "every_n_hours" IS NULL AND "every_n_days" IS NULL AND cardinality("weekdays") = 0 AND "month_day" IS NULL
      WHEN 'DAILY'         THEN cardinality("shift_codes") = 1 AND cardinality("moment_codes") = 0 AND "every_n_hours" IS NULL AND "every_n_days" IS NULL AND cardinality("weekdays") = 0 AND "month_day" IS NULL
      WHEN 'MOMENTS'       THEN cardinality("moment_codes") > 0 AND cardinality("shift_codes") = 0 AND "every_n_hours" IS NULL AND "every_n_days" IS NULL AND cardinality("weekdays") = 0 AND "month_day" IS NULL
      WHEN 'EVERY_N_HOURS' THEN "every_n_hours" BETWEEN 1 AND 12 AND cardinality("shift_codes") = 0 AND cardinality("moment_codes") = 0 AND "every_n_days" IS NULL AND cardinality("weekdays") = 0 AND "month_day" IS NULL
      WHEN 'WEEKDAYS'      THEN cardinality("weekdays") > 0 AND "weekdays" <@ ARRAY[1,2,3,4,5,6,7] AND cardinality("shift_codes") = 1 AND cardinality("moment_codes") = 0 AND "every_n_hours" IS NULL AND "every_n_days" IS NULL AND "month_day" IS NULL
      WHEN 'EVERY_N_DAYS'  THEN "every_n_days" BETWEEN 1 AND 365 AND cardinality("shift_codes") = 1 AND cardinality("moment_codes") = 0 AND "every_n_hours" IS NULL AND cardinality("weekdays") = 0 AND "month_day" IS NULL
      WHEN 'MONTHLY'       THEN "month_day" BETWEEN 1 AND 28 AND cardinality("shift_codes") = 1 AND cardinality("moment_codes") = 0 AND "every_n_hours" IS NULL AND "every_n_days" IS NULL AND cardinality("weekdays") = 0
      WHEN 'ON_DEMAND'     THEN cardinality("shift_codes") = 0 AND cardinality("moment_codes") = 0 AND "every_n_hours" IS NULL AND "every_n_days" IS NULL AND cardinality("weekdays") = 0 AND "month_day" IS NULL
    END);

CREATE UNIQUE INDEX "center_control_settings_tenant_id_control_code_key"
    ON "center_control_settings"("tenant_id", "control_code");
CREATE INDEX "center_control_settings_tenant_id_idx" ON "center_control_settings"("tenant_id");
CREATE INDEX "center_control_settings_tenant_id_active_idx" ON "center_control_settings"("tenant_id", "active");

ALTER TABLE "center_control_settings"
    ADD CONSTRAINT "center_control_settings_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────────
-- 5 · Los momentos del día del centro
-- ──────────────────────────────────────────────────────────────────────
--
-- Desayuno, comida, merienda, cena y noche, **con su hora**. El desayuno
-- de Jardín de Gredos es a las nueve y el de otro centro a las ocho y
-- media, y eso cambia a qué hora «toca» la medicación del desayuno.
--
-- `at_time` es hora de PARED «HH:MM» y no un timestamp, igual que
-- `center_shifts.starts_at` y por lo mismo: «el desayuno es a las nueve»
-- no cambia el día del cambio de hora, y guardarlo como instante
-- obligaría a reescribir filas dos veces al año.
--
-- CHECK de formato idéntico al de `center_shifts` — y hace falta porque
-- `queToca` parte la cadena por los dos puntos: un «9:00» sin cero
-- delante, o un «25:00», darían una hora que no existe y una ocurrencia
-- que la puerta pediría a una hora imposible.
CREATE TABLE "center_moments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "at_time" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "center_moments_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "center_moments"
    ADD CONSTRAINT "center_moments_hora_valida"
    CHECK ("at_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

CREATE UNIQUE INDEX "center_moments_tenant_id_code_key" ON "center_moments"("tenant_id", "code");
CREATE INDEX "center_moments_tenant_id_idx" ON "center_moments"("tenant_id");

ALTER TABLE "center_moments"
    ADD CONSTRAINT "center_moments_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────────
-- 6 · Las plantillas por nivel de dependencia
-- ──────────────────────────────────────────────────────────────────────
--
-- Qué lleva un válido, un semiasistido y un dependiente (D-53). Una fila =
-- un control dentro de la plantilla de un nivel, con la frecuencia que ese
-- nivel le pone: el dependiente lleva cambios posturales cada 3 h y el
-- válido no los lleva en absoluto.
--
-- Esta tabla es **la copia del centro**, editable. La plantilla de serie
-- vive en un fichero de datos del repo y de ahí se copia al encender el
-- módulo: los únicos dos que la leen son la semilla y el botón de «volver
-- a la de serie», y los dos leen el fichero. Meterla también en la base
-- habría costado un `scope`/`tenant_id?` con sus dos índices parciales
-- —la factura que paga `control_types`— para una tabla que nadie consulta
-- en caliente.
--
-- Sin tabla padre: la plantilla ES su lista de filas. Un nivel sin
-- ninguna fila es un nivel sin plan por defecto, que es un estado legítimo
-- (el válido lleva poco) y no hace falta una fila para decirlo.
CREATE TABLE "care_plan_template_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "dependency_level" "DependencyLevel" NOT NULL,
    "control_code" TEXT NOT NULL,
    "frequency_kind" "CareFrequencyKind" NOT NULL,
    "every_n_hours" INTEGER,
    "every_n_days" INTEGER,
    "weekdays" INTEGER[] NOT NULL DEFAULT '{}',
    "month_day" INTEGER,
    "shift_codes" TEXT[] NOT NULL DEFAULT '{}',
    "moment_codes" TEXT[] NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "care_plan_template_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "care_plan_template_items"
    ADD CONSTRAINT "care_plan_template_items_frecuencia_coherente" CHECK (
    CASE "frequency_kind"
      WHEN 'EVERY_SHIFT'   THEN cardinality("shift_codes") > 0 AND cardinality("moment_codes") = 0 AND "every_n_hours" IS NULL AND "every_n_days" IS NULL AND cardinality("weekdays") = 0 AND "month_day" IS NULL
      WHEN 'DAILY'         THEN cardinality("shift_codes") = 1 AND cardinality("moment_codes") = 0 AND "every_n_hours" IS NULL AND "every_n_days" IS NULL AND cardinality("weekdays") = 0 AND "month_day" IS NULL
      WHEN 'MOMENTS'       THEN cardinality("moment_codes") > 0 AND cardinality("shift_codes") = 0 AND "every_n_hours" IS NULL AND "every_n_days" IS NULL AND cardinality("weekdays") = 0 AND "month_day" IS NULL
      WHEN 'EVERY_N_HOURS' THEN "every_n_hours" BETWEEN 1 AND 12 AND cardinality("shift_codes") = 0 AND cardinality("moment_codes") = 0 AND "every_n_days" IS NULL AND cardinality("weekdays") = 0 AND "month_day" IS NULL
      WHEN 'WEEKDAYS'      THEN cardinality("weekdays") > 0 AND "weekdays" <@ ARRAY[1,2,3,4,5,6,7] AND cardinality("shift_codes") = 1 AND cardinality("moment_codes") = 0 AND "every_n_hours" IS NULL AND "every_n_days" IS NULL AND "month_day" IS NULL
      WHEN 'EVERY_N_DAYS'  THEN "every_n_days" BETWEEN 1 AND 365 AND cardinality("shift_codes") = 1 AND cardinality("moment_codes") = 0 AND "every_n_hours" IS NULL AND cardinality("weekdays") = 0 AND "month_day" IS NULL
      WHEN 'MONTHLY'       THEN "month_day" BETWEEN 1 AND 28 AND cardinality("shift_codes") = 1 AND cardinality("moment_codes") = 0 AND "every_n_hours" IS NULL AND "every_n_days" IS NULL AND cardinality("weekdays") = 0
      WHEN 'ON_DEMAND'     THEN cardinality("shift_codes") = 0 AND cardinality("moment_codes") = 0 AND "every_n_hours" IS NULL AND "every_n_days" IS NULL AND cardinality("weekdays") = 0 AND "month_day" IS NULL
    END);

CREATE UNIQUE INDEX "care_plan_template_items_tenant_id_dependency_level_control_key"
    ON "care_plan_template_items"("tenant_id", "dependency_level", "control_code");
CREATE INDEX "care_plan_template_items_tenant_id_dependency_level_idx"
    ON "care_plan_template_items"("tenant_id", "dependency_level");

ALTER TABLE "care_plan_template_items"
    ADD CONSTRAINT "care_plan_template_items_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────────
-- 7 · El plan de cuidados de un residente
-- ──────────────────────────────────────────────────────────────────────
--
-- Una fila = «a esta persona le toca este control con esta frecuencia,
-- desde este día». Es lo que `queToca` lee y lo que la puerta pedirá en
-- residencia-3. Nada se lee del PAI en prosa (D-53).
--
-- ── UNA LÍNEA NO SE BORRA NI SE EDITA: SE CIERRA ──────────────────────
--
-- `to_at` con fecha, y la fila se queda. Dos razones, y la segunda manda:
--
--   1. «¿Qué le tocaba a doña Carmen el 3 de marzo?» es una pregunta que
--      una residencia tiene que poder contestar a una familia, a la
--      Consejería o a un juzgado. Con líneas editables, la respuesta
--      sería siempre la de hoy.
--   2. Por eso la frecuencia está MATERIALIZADA en esta tabla y no se
--      hereda del ajuste del centro: si se heredara, cambiar hoy el
--      defecto del centro reescribiría el plan de los últimos tres años.
--      La línea se crea copiando la frecuencia que el centro tenía en ese
--      momento, y cambiarle la frecuencia es **cerrar una y abrir otra**,
--      en la misma transacción y en ese orden — exactamente como cambiar
--      de habitación en `bed_assignments`.
--
-- `Restrict` al tenant y al residente, igual que `bed_assignments`: el
-- plan de una persona es parte de lo que se conserva cinco años (Ley
-- 41/2002, D-45), y un residente con plan no se borra. `SetNull` en las
-- dos personas: dar de baja a la DUE que ajustó el plan no puede borrar el
-- hecho de que lo ajustó.
CREATE TABLE "care_plan_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "control_code" TEXT NOT NULL,
    "frequency_kind" "CareFrequencyKind" NOT NULL,
    "every_n_hours" INTEGER,
    "every_n_days" INTEGER,
    "weekdays" INTEGER[] NOT NULL DEFAULT '{}',
    "month_day" INTEGER,
    "shift_codes" TEXT[] NOT NULL DEFAULT '{}',
    "moment_codes" TEXT[] NOT NULL DEFAULT '{}',
    "from_at" TIMESTAMPTZ NOT NULL,
    "to_at" TIMESTAMPTZ,
    "source" "CarePlanItemSource" NOT NULL,
    "source_level" "DependencyLevel",
    "reason" TEXT,
    "close_reason" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "closed_by_user_id" UUID,

    CONSTRAINT "care_plan_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "care_plan_items"
    ADD CONSTRAINT "care_plan_items_frecuencia_coherente" CHECK (
    CASE "frequency_kind"
      WHEN 'EVERY_SHIFT'   THEN cardinality("shift_codes") > 0 AND cardinality("moment_codes") = 0 AND "every_n_hours" IS NULL AND "every_n_days" IS NULL AND cardinality("weekdays") = 0 AND "month_day" IS NULL
      WHEN 'DAILY'         THEN cardinality("shift_codes") = 1 AND cardinality("moment_codes") = 0 AND "every_n_hours" IS NULL AND "every_n_days" IS NULL AND cardinality("weekdays") = 0 AND "month_day" IS NULL
      WHEN 'MOMENTS'       THEN cardinality("moment_codes") > 0 AND cardinality("shift_codes") = 0 AND "every_n_hours" IS NULL AND "every_n_days" IS NULL AND cardinality("weekdays") = 0 AND "month_day" IS NULL
      WHEN 'EVERY_N_HOURS' THEN "every_n_hours" BETWEEN 1 AND 12 AND cardinality("shift_codes") = 0 AND cardinality("moment_codes") = 0 AND "every_n_days" IS NULL AND cardinality("weekdays") = 0 AND "month_day" IS NULL
      WHEN 'WEEKDAYS'      THEN cardinality("weekdays") > 0 AND "weekdays" <@ ARRAY[1,2,3,4,5,6,7] AND cardinality("shift_codes") = 1 AND cardinality("moment_codes") = 0 AND "every_n_hours" IS NULL AND "every_n_days" IS NULL AND "month_day" IS NULL
      WHEN 'EVERY_N_DAYS'  THEN "every_n_days" BETWEEN 1 AND 365 AND cardinality("shift_codes") = 1 AND cardinality("moment_codes") = 0 AND "every_n_hours" IS NULL AND cardinality("weekdays") = 0 AND "month_day" IS NULL
      WHEN 'MONTHLY'       THEN "month_day" BETWEEN 1 AND 28 AND cardinality("shift_codes") = 1 AND cardinality("moment_codes") = 0 AND "every_n_hours" IS NULL AND "every_n_days" IS NULL AND cardinality("weekdays") = 0
      WHEN 'ON_DEMAND'     THEN cardinality("shift_codes") = 0 AND cardinality("moment_codes") = 0 AND "every_n_hours" IS NULL AND "every_n_days" IS NULL AND cardinality("weekdays") = 0 AND "month_day" IS NULL
    END);

-- `source_level` tiene valor si y sólo si la línea la puso una plantilla.
-- Sin esta mitad, una línea MANUAL con nivel puesto a mano la cerraría el
-- recálculo del cambio de nivel — y lo que el cambio de nivel promete es
-- justo que las manuales no se tocan.
ALTER TABLE "care_plan_items"
    ADD CONSTRAINT "care_plan_items_origen_coherente" CHECK (
        ("source" = 'PROFILE_TEMPLATE' AND "source_level" IS NOT NULL)
     OR ("source" = 'MANUAL'           AND "source_level" IS NULL));

-- Una línea cerrada antes de abrirse no es una línea: es un error de
-- cálculo de fechas que luego saldría como una ocurrencia fantasma.
ALTER TABLE "care_plan_items"
    ADD CONSTRAINT "care_plan_items_vigencia_ordenada" CHECK (
        "to_at" IS NULL OR "to_at" >= "from_at");

-- Quien cierra se apunta: `to_at` y `closed_by_user_id` van juntos o no
-- van. Una línea cerrada sin nadie detrás es un cierre que nadie decidió,
-- y el plan de un residente es lo que la Consejería mira.
--
-- Nótese la dirección: `closed_by` exige `to_at`, y no al revés. Un cierre
-- automático —el del cambio de nivel, que lo dispara una persona pero lo
-- escribe el sistema en una transacción— se apunta con el usuario que lo
-- disparó; uno disparado por un script no tiene usuario, y eso sigue
-- siendo legítimo.
ALTER TABLE "care_plan_items"
    ADD CONSTRAINT "care_plan_items_cierre_con_autor" CHECK (
        "closed_by_user_id" IS NULL OR "to_at" IS NOT NULL);

CREATE INDEX "care_plan_items_tenant_id_idx" ON "care_plan_items"("tenant_id");
CREATE INDEX "care_plan_items_tenant_id_client_id_idx" ON "care_plan_items"("tenant_id", "client_id");
CREATE INDEX "care_plan_items_client_id_control_code_idx" ON "care_plan_items"("client_id", "control_code");

-- ── UNA LÍNEA VIVA POR (RESIDENTE, CONTROL) ───────────────────────────
--
-- Dos líneas vivas del mismo control con frecuencias distintas son dos
-- respuestas a «¿cada cuánto se le cambia de postura?», y la puerta
-- tendría que elegir — y elegiría el orden de la lista.
--
-- **Parcial**, y es lo que permite el histórico: doña Carmen puede tener
-- cinco filas cerradas del cambio postural (cada 4 h, luego cada 3, luego
-- cada 2) y una viva, porque ninguna cerrada entra en el índice. Con un
-- índice total eso no sería «menos correcto»: sería imposible, y el plan
-- de marzo sería irreconstruible. Misma lección exacta que
-- `bed_assignments_one_live_per_client_key`.
CREATE UNIQUE INDEX "care_plan_items_one_live_key"
    ON "care_plan_items"("client_id", "control_code")
    WHERE "to_at" IS NULL;

ALTER TABLE "care_plan_items"
    ADD CONSTRAINT "care_plan_items_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "care_plan_items"
    ADD CONSTRAINT "care_plan_items_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "care_plan_items"
    ADD CONSTRAINT "care_plan_items_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "care_plan_items"
    ADD CONSTRAINT "care_plan_items_closed_by_user_id_fkey"
    FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
