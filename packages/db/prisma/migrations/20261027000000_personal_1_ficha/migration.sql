-- personal-1 · LA FICHA DE PERSONAL, Y LO QUE EL CUADRANTE NECESITA DEBAJO.
--
-- El 23-10-2026 se encendió el fichaje en la primera empresa real: una
-- residencia de 24 horas, 21 personas. Y se vio que el registro de jornada
-- por sí solo no informa de nada:
--
--   · el fichaje sabe que un tramo lleva abierto más de 16 h (#45), pero no
--     sabe que la auxiliar de noche sale a las 08:00;
--   · «quién no ha fichado hoy» no significa nada sin jornada teórica;
--   · el cuadrante vive en un Excel y nadie comprueba la ratio, los
--     descansos ni la jornada contratada hasta que alguien se queja.
--
-- Esta migración trae el DATO que hace falta para las tres cosas. La
-- hermana (`20261027010000_personal_1_cuadrante`) trae el cuadrante.
--
-- ── LA FICHA ES `employees`, NO UNA CUARTA PERSONA ───────────────────
--
-- Hoy hay tres «personas» que no se hablan: `employees` (fichaje, sin
-- usuario), `staff_profiles` + `staff_shifts` (agenda, colgada de `users`)
-- y `care_role_assignments` (residencia, ídem). La que se amplía es
-- `employees`, y por dos razones medidas:
--
--   1. es la ÚNICA que existe sin usuario, y la mayoría de una plantilla no
--      entra nunca al panel (21 personas en la residencia, 3 con cuenta);
--   2. es la que ya tiene colgando el registro inalterable de ADR-018, que
--      es lo que no se puede mover de sitio.
--
-- Cuando la persona además es `users`, `employees.user_id` la vincula —la
-- columna y su único ya existen desde F1— y la ficha ENSEÑA sus roles de
-- cuidado y su perfil de agenda. No los mueve. Nada se fusiona aquí.
--
-- ── LOS DOS DATOS QUE VAN CIFRADOS ───────────────────────────────────
--
-- DNI/NIE y nº de afiliación a la Seguridad Social, con la maquinaria de
-- clinica-7 tal cual (`cripto-campos.ts`, prefijo `c1:`, AAD
-- `tenant|tabla|columna|fila`, DEK por tenant envuelta por la
-- `CLINICAL_KEK`). Ni un segundo esquema de cifrado.
--
-- Son los dos datos de la ficha con los que se puede hacer daño a la
-- persona fuera de la empresa: un DNI y un número de afiliación son lo que
-- hace falta para suplantarla ante la Administración. La categoría, la
-- jornada y las fechas no — y dejarlas en claro es lo que permite que el
-- cuadrante las consulte y las cuente sin tocar una clave.
--
-- El id de fila del AAD es el `employees.id`, que ya existe cuando se
-- escribe el DNI (la ficha se crea antes de completarse), así que aquí no
-- hace falta `nuevoIdDeFila()`.
--
-- ── EL `down` ────────────────────────────────────────────────────────
--
--   -- 1 · Las columnas cifradas se van con dato dentro, y eso es
--   --     IRREVERSIBLE: el DNI no está en ninguna otra parte. Falla y lo
--   --     dice, en vez de borrarlo en silencio.
--   DO $down$
--   DECLARE n integer;
--   BEGIN
--     SELECT count(*) INTO n FROM "employees"
--      WHERE "dni_cifrado" IS NOT NULL OR "nss_cifrado" IS NOT NULL;
--     IF n > 0 THEN
--       RAISE EXCEPTION
--         'No se puede bajar personal-1: hay % ficha(s) de personal con DNI o nº de afiliación guardados, y esas dos columnas son el único sitio donde viven. Expórtalos antes (Empleados → Exportar) y vuelve a intentarlo.', n;
--     END IF;
--   END
--   $down$;
--
--   -- 2 · Y entonces sí. En orden inverso al de arriba.
--   ALTER TABLE "staff_rule_settings" DROP CONSTRAINT IF EXISTS "staff_rule_settings_tenant_id_fkey";
--   DROP TABLE "staff_rule_settings";
--
--   ALTER TABLE "center_shifts"
--     DROP CONSTRAINT "center_shifts_min_coverage_check",
--     DROP COLUMN "min_coverage";
--
--   ALTER TABLE "tenants"
--     DROP CONSTRAINT "tenants_fichaje_shift_margin_hours_check",
--     DROP COLUMN "fichaje_shift_margin_hours";
--
--   ALTER TABLE "employees"
--     DROP CONSTRAINT "employees_fin_solo_temporales",
--     DROP CONSTRAINT "employees_fin_despues_del_alta",
--     DROP CONSTRAINT "employees_weekly_minutes_check",
--     DROP CONSTRAINT "employees_dni_cifrado_formato",
--     DROP CONSTRAINT "employees_nss_cifrado_formato",
--     DROP CONSTRAINT "employees_cifrados_not_blank",
--     DROP CONSTRAINT "employees_category_id_fkey",
--     DROP COLUMN "last_name",
--     DROP COLUMN "dni_cifrado",
--     DROP COLUMN "nss_cifrado",
--     DROP COLUMN "category_id",
--     DROP COLUMN "weekly_minutes",
--     DROP COLUMN "contract_kind",
--     DROP COLUMN "hired_on",
--     DROP COLUMN "contract_ends_on",
--     DROP COLUMN "schedule_seen_at";
--
--   DROP TABLE "employee_categories";
--   DROP TYPE "EmployeeContractKind";
--
-- Migración ADITIVA: crea objetos nuevos y añade columnas nullable (o con
-- default) a tres tablas. No reescribe ni una fila. Las fichas de hoy
-- quedan exactamente como estaban, con todo lo nuevo a NULL — que es
-- precisamente lo que `datosQueFaltanDePersonal` va a cantar.

-- ── 0 · el enum ────────────────────────────────────────────────────────
--
-- Cerrado a propósito, como `TimeEntryCorrectionReason`: de esto cuelga
-- «un temporal a 15 días de su fecha de fin sale como aviso», y un valor
-- inventado por un centro no tendría esa semántica. Fijo y de dos
-- opciones, que son las dos que hay en el Estatuto.
CREATE TYPE "EmployeeContractKind" AS ENUM ('INDEFINIDO', 'TEMPORAL');

-- ── 1 · el catálogo de categorías profesionales ────────────────────────
--
-- DATO, no código, y POR TENANT con semilla de serie: mismo criterio
-- exacto que `care_roles` en residencia-1. Una residencia que invente
-- «fisio de tarde» no puede costar un despliegue.
--
-- La columna que importa es `counts_as_direct_care`: es lo que mira la
-- ratio del Decreto 2/2022 y lo que mira la cobertura mínima de un turno.
-- Y es EDITABLE —a diferencia de la categoría de un rol de cuidado, que un
-- trigger congela—, porque qué cuenta como atención directa lo dice la
-- acreditación de cada centro y no nosotros.
CREATE TABLE "employee_categories" (
    "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "tenant_id"             UUID NOT NULL,
    "code"                  TEXT NOT NULL,
    "name"                  TEXT NOT NULL,
    -- `false` de serie: una categoría nueva no cuenta como atención
    -- directa hasta que alguien lo diga. Al revés, una categoría recién
    -- inventada inflaría la ratio sin que nadie la hubiera marcado.
    "counts_as_direct_care" BOOLEAN NOT NULL DEFAULT false,
    "is_standard"           BOOLEAN NOT NULL DEFAULT false,
    "active"                BOOLEAN NOT NULL DEFAULT true,
    "sort_order"            INTEGER NOT NULL DEFAULT 0,
    "created_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"            TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "employee_categories_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    -- «Lo que no se sabe va NULL, no en blanco» — aquí ni una cosa ni la
    -- otra: las dos son NOT NULL y además no pueden ser espacios.
    CONSTRAINT "employee_categories_not_blank"
        CHECK (btrim("code") <> '' AND btrim("name") <> '')
);

CREATE UNIQUE INDEX "employee_categories_tenant_id_code_key"
    ON "employee_categories"("tenant_id", "code");
CREATE INDEX "employee_categories_tenant_id_active_idx"
    ON "employee_categories"("tenant_id", "active");

-- ── 2 · la ficha ───────────────────────────────────────────────────────
--
-- Ocho columnas, TODAS nullable salvo las que ya estaban. Es la lección de
-- alta-minima aplicada al personal: la auxiliar ya trabaja aquí, y no
-- saber su nº de afiliación no hace que fiche menos. Lo que falta pasa a
-- ser dato (`datosQueFaltanDePersonal`) y el programa no deja de
-- recordarlo.
--
-- `name` sigue siendo el nombre y no se parte: las 21 fichas de Jardín de
-- Gredos se crearon con el nombre completo dentro, y partirlas a ciegas no
-- es fiable («María del Carmen Fernández-Escalona»). La importación CSV
-- casa por nombre completo normalizado y al completar separa — eso es
-- trabajo de la ruta, no de un backfill.
ALTER TABLE "employees"
    ADD COLUMN "last_name"        TEXT,
    -- clinica-7 · cifradas. La columna en CLARO no existe y no ha
    -- existido nunca: estas dos nacen cifradas, así que aquí no hay
    -- EXPAND/CONTRACT ni columna de respaldo que vaciar.
    ADD COLUMN "dni_cifrado"      TEXT,
    ADD COLUMN "nss_cifrado"      TEXT,
    ADD COLUMN "category_id"      UUID,
    -- MINUTOS y no horas decimales: 37,5 h a la semana son 2 250 minutos y
    -- no un `numeric(5,2)` que cada capa redondea a su manera. Todo lo que
    -- compara jornadas en esta casa cuenta minutos (`minutesWorked`,
    -- `totalMinutes`), y el paquete puro del cuadrante compara enteros sin
    -- convertir nada. El panel sigue pidiendo y enseñando horas.
    ADD COLUMN "weekly_minutes"   INTEGER,
    ADD COLUMN "contract_kind"    "EmployeeContractKind",
    ADD COLUMN "hired_on"         DATE,
    ADD COLUMN "contract_ends_on" DATE,
    -- Hasta cuándo ha visto su cuadrante. La mueve SÓLO el acuse explícito
    -- del móvil: si la moviera la propia lectura, los cambios marcados
    -- desaparecerían al recargar la pantalla — justo cuando la persona los
    -- está mirando.
    ADD COLUMN "schedule_seen_at" TIMESTAMPTZ,

    -- Los CHECK, todos con su `IS NULL` delante. Un CHECK que evalúa a
    -- NULL PASA, y con ocho columnas nullable eso es la forma exacta en
    -- que esto se rompería sin que lo dijera ningún error.
    ADD CONSTRAINT "employees_dni_cifrado_formato"
        CHECK ("dni_cifrado" IS NULL
               OR "dni_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$'),
    ADD CONSTRAINT "employees_nss_cifrado_formato"
        CHECK ("nss_cifrado" IS NULL
               OR "nss_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$'),
    ADD CONSTRAINT "employees_cifrados_not_blank"
        CHECK (("dni_cifrado" IS NULL OR btrim("dni_cifrado") <> '')
               AND ("nss_cifrado" IS NULL OR btrim("nss_cifrado") <> '')),
    -- De 1 minuto a 60 horas. El tope no es un capricho: por encima de 60
    -- h semanales lo que hay es un dedo que se ha ido, y una jornada
    -- contratada falsa hace que «horas de más» deje de avisar de nada.
    ADD CONSTRAINT "employees_weekly_minutes_check"
        CHECK ("weekly_minutes" IS NULL
               OR ("weekly_minutes" >= 1 AND "weekly_minutes" <= 3600)),
    -- Fecha de fin SÓLO en los temporales. Un indefinido con fecha de fin
    -- es una contradicción que acabaría saliendo como aviso en el panel
    -- («se le acaba el contrato en 15 días») a quien no se le acaba.
    ADD CONSTRAINT "employees_fin_solo_temporales"
        CHECK ("contract_ends_on" IS NULL OR "contract_kind" = 'TEMPORAL'),
    ADD CONSTRAINT "employees_fin_despues_del_alta"
        CHECK ("contract_ends_on" IS NULL
               OR "hired_on" IS NULL
               OR "contract_ends_on" >= "hired_on"),
    -- `RESTRICT`: una categoría con gente dentro no se borra. Se
    -- desactiva, y entonces deja de ofrecerse sin que las fichas que ya la
    -- llevan se queden apuntando a nada.
    ADD CONSTRAINT "employees_category_id_fkey"
        FOREIGN KEY ("category_id") REFERENCES "employee_categories"("id")
        ON DELETE RESTRICT;

CREATE INDEX "employees_category_id_idx" ON "employees"("category_id");
-- «¿A quién se le acaba el contrato este mes?» es la pregunta del aviso
-- del panel, y es la única consulta nueva de la ficha que recorre la tabla.
CREATE INDEX "employees_tenant_id_contract_ends_on_idx"
    ON "employees"("tenant_id", "contract_ends_on");

-- ── 3 · la cobertura mínima de un turno ────────────────────────────────
--
-- LA TABLA DE TURNOS SE REUTILIZA Y NO SE MUEVE. `center_shifts` no tiene
-- nada de residencia dentro (tenant, código, dos horas de pared y un
-- orden); lo que la ataba a la residencia eran sus RUTAS, y esas se dejan
-- como están. Seis modelos le apuntan con `RESTRICT` —`care_records`,
-- `incidents`, `guard_shift_sessions`, `handovers`…—, así que moverla
-- sería renombrar una tabla con histórico firmado colgando para no ganar
-- nada.
--
-- Lo que gana es una columna: cuántas personas de ATENCIÓN DIRECTA tiene
-- que haber en ese turno. Es la primera de las ocho reglas que
-- `comprobarCuadrante` mira.
--
-- NULLABLE a propósito, y el NULL significa algo: «este centro no ha
-- declarado un mínimo para este turno». Los tres turnos que residencia-1
-- sembró en Jardín de Gredos no lo tienen, y ponerles un 0 haría que la
-- regla de cobertura dijera «cumple» de todos ellos — que es peor que no
-- decir nada. Con NULL, la regla no se evalúa y la pantalla lo pide.
ALTER TABLE "center_shifts"
    ADD COLUMN "min_coverage" INTEGER,
    ADD CONSTRAINT "center_shifts_min_coverage_check"
        CHECK ("min_coverage" IS NULL
               OR ("min_coverage" >= 0 AND "min_coverage" <= 200));

-- ── 4 · el margen del turno planificado ────────────────────────────────
--
-- #45 dejó la salida olvidada decidida por DURACIÓN, con el máximo del
-- tenant en `fichaje_max_open_hours` (16 de serie). Lo que personal-1
-- añade es que, CUANDO hay turno planificado, el límite sea además «el fin
-- de su turno más este margen»: la auxiliar de noche sale a las 08:00, y
-- si a las 13:00 sigue dentro nadie tenía por qué esperar a las 16 h para
-- enterarse.
--
-- Hermana de `fichaje_max_open_hours` en todo: entero por tenant, default
-- que no cambia a nadie, rango en un CHECK de la base Y en el schema de la
-- ruta, y la mueve SÓLO el super-admin porque no hay pantalla para esto.
--
-- 4 h de serie: cubre quedarse a acabar un relevo o cubrir media hora a
-- quien llega tarde, y deja fuera «se fue a comer y no volvió a tocar el
-- móvil». El rango 1–12 porque un 0 convertiría en olvidado a quien sale
-- un minuto tarde, y un 24 no avisaría nunca antes del máximo.
ALTER TABLE "tenants"
    ADD COLUMN "fichaje_shift_margin_hours" INTEGER NOT NULL DEFAULT 4;

ALTER TABLE "tenants"
    ADD CONSTRAINT "tenants_fichaje_shift_margin_hours_check"
    CHECK (
        "fichaje_shift_margin_hours" IS NOT NULL
        AND "fichaje_shift_margin_hours" BETWEEN 1 AND 12
    );

-- ── 5 · los parámetros de las reglas ───────────────────────────────────
--
-- PARÁMETROS DEL TENANT, NO CONSTANTES EN EL CÓDIGO. Es lo que el prompt
-- exige y lo que la realidad obliga: la ratio de atención directa cambia
-- por comunidad autónoma y por acreditación (0,20 es el Decreto 2/2022 de
-- Castilla-La Mancha), y el cómputo del descanso semanal lo permite el art.
-- 37.1 del ET hasta 14 días.
--
-- Una fila por tenant, creada la primera vez que alguien abre el
-- cuadrante. Si no existe, se leen los defaults: mismo criterio de
-- `maxOpenHoursFor`, que falla hacia el default. Un centro sin fila se
-- comporta como todos los demás.
--
-- ESTA tabla sí la toca el cliente (Ajustes), a diferencia de
-- `fichaje_max_open_hours` y del margen de arriba: la ratio de su
-- acreditación la sabe la dirección del centro, no nosotros.
--
-- La ratio va en MILÉSIMAS y no en `numeric`. 0,20 → 200. Dos razones: el
-- paquete puro compara enteros sin que Prisma le meta un `Decimal` dentro,
-- y el rango del CHECK se lee («entre 0 y 2 000 milésimas») en vez de
-- depender de una escala decimal que hay que ir a buscar.
CREATE TABLE "staff_rule_settings" (
    "tenant_id"                  UUID PRIMARY KEY,
    "ratio_direct_care_per_mil"  INTEGER NOT NULL DEFAULT 200,
    "min_rest_hours"             INTEGER NOT NULL DEFAULT 12,
    "weekly_rest_hours"          INTEGER NOT NULL DEFAULT 36,
    "weekly_rest_window_days"    INTEGER NOT NULL DEFAULT 7,
    "no_show_tolerance_minutes"  INTEGER NOT NULL DEFAULT 15,
    -- Qué es «una jornada completa» a efectos de la RATIO. La ratio se
    -- mide en jornadas completas equivalentes, no en personas: tres
    -- auxiliares de cuatro horas no son tres jornadas. 480 minutos (8 h)
    -- de serie, y parámetro porque una jornada completa de convenio no es
    -- la misma en todas partes.
    "full_day_minutes"           INTEGER NOT NULL DEFAULT 480,
    "updated_at"                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_by_user_id"         UUID,

    CONSTRAINT "staff_rule_settings_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
    CONSTRAINT "staff_rule_settings_updated_by_user_id_fkey"
        FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL,

    -- Los cinco rangos, con su `IS NOT NULL` delante aunque las cinco
    -- columnas sean NOT NULL: si mañana alguna se hiciera nullable, el
    -- CHECK dejaría de proteger nada en silencio.
    CONSTRAINT "staff_rule_settings_rangos_check"
        CHECK (
            "ratio_direct_care_per_mil" IS NOT NULL
            AND "ratio_direct_care_per_mil" BETWEEN 0 AND 2000
            AND "min_rest_hours" IS NOT NULL
            AND "min_rest_hours" BETWEEN 0 AND 24
            AND "weekly_rest_hours" IS NOT NULL
            AND "weekly_rest_hours" BETWEEN 0 AND 96
            -- 7 a 14 días: el art. 37.1 del ET permite computar el día y
            -- medio «por períodos de hasta catorce días».
            AND "weekly_rest_window_days" IS NOT NULL
            AND "weekly_rest_window_days" BETWEEN 7 AND 14
            AND "no_show_tolerance_minutes" IS NOT NULL
            AND "no_show_tolerance_minutes" BETWEEN 0 AND 240
            -- De 1 h a 12 h. Un 0 haría que la ratio dividiera por cero.
            AND "full_day_minutes" IS NOT NULL
            AND "full_day_minutes" BETWEEN 60 AND 720
        )
);
