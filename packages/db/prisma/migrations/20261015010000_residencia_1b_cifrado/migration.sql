-- residencia-1b · LO QUE ES DE UN RESIDENTE, CIFRADO EN REPOSO.
--
-- D-62 y D-63. `clinica-7` construyó la maquinaria —una DEK por tenant
-- envuelta por la KEK, AAD `tenant|tabla|columna|fila`, CHECK de formato en
-- el motor— y cifró nueve columnas, las nueve de la clínica. Las tablas que
-- trajeron `residencia-1` y `residencia-2` se quedaron enteras en claro
-- porque no existían cuando se hizo el inventario (§18.3 de
-- `clinica-7-done.md`). Esta migración cierra esa deuda para lo que ya
-- existe.
--
-- ── Las SEIS columnas, y por qué cada una ────────────────────────────
--
--   `resident_profiles.dni`              identificador; D-62
--   `resident_profiles.nss`              identificador, el que abre la
--                                        historia en el SESCAM; D-62
--   `resident_profiles.discharge_reason` texto libre: «fallecimiento»,
--                                        «traslado por ictus»
--   `care_plan_items.reason`             texto libre: «úlcera sacra II»
--   `care_plan_items.close_reason`       texto libre: «se le retiró la sonda»
--   `bed_assignments.reason`             texto libre: «aislamiento por GEA»
--
-- ── Y lo que se queda EN CLARO, con su motivo ────────────────────────
--
--   · `care_plan_items.control_code` y las siete columnas de frecuencia:
--     sostienen `care_plan_items_one_live_key` —UNIQUE (client_id,
--     control_code) WHERE to_at IS NULL, «una línea viva por residente y
--     control»— y el cifrado de clinica-7 es NO DETERMINISTA (el nonce va
--     dentro del ciphertext). Una columna cifrada no puede sostener un
--     índice único. Renunciar a esa garantía o montar un cifrado
--     determinista para esto no se hace de pasada.
--   · `resident_profiles.dependency_level` y `dependency_grade`: los usan
--     las plantillas del plan y la lista de residentes.
--   · Fechas de ingreso y alta, tipo de plaza y familiar responsable:
--     identidad y estancia, no salud — igual que `clients.first_name` en
--     la clínica.
--   · Los nombres de plantas, habitaciones y camas: son del centro, no de
--     nadie, y una DEK por tenant atada a una fila no los cubriría.
--   · `clinical_access_log` entero: es la prueba de quién miró.
--
-- ── EXPAND, igual que clinica-7 §3 ──────────────────────────────────
--
-- La columna cifrada se añade AL LADO de la clara y vacía. Las filas
-- nuevas nacen cifradas (la clara a NULL); las que ya estaban las pasa
-- `src/scripts/cifrar-lo-existente.ts`, que verifica cada fila antes de
-- seguir y no vacía nada hasta que alguien pasa `--vaciar`.
--
-- Hoy no hay NINGÚN centro con la residencia encendida en producción, así
-- que en la práctica no hay nada que pasar. La maquinaria está igual: un
-- entorno de desarrollo o de ensayo sí tiene filas, y el `done` dice qué
-- hacer con ellas.
--
-- ── EL CHECK DE FORMATO ES LA PIEZA ─────────────────────────────────
--
--     CHECK (col IS NULL OR col ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$')
--
-- «Texto en claro NO CABE en una columna cifrada.» Si mañana una ruta
-- nueva escribiera el DNI sin pasar por `cifrarTexto`, lo rechaza el
-- motor — no hace falta que nadie se acuerde.
--
-- ── Y los CHECK de residencia que MIRAN estas columnas ──────────────
--
-- Dos, y los dos se re-enseñan aquí (misma lección que
-- `clinical_photos_retirada_completa` en clinica-7 §2 §3, que exigía el
-- motivo EN CLARO y por eso una retirada ya cifrada no cabía):
--
--   · `resident_profiles_alta_coherente` exigía «motivo ⇒ fecha». Con el
--     claro vaciado el motivo vive en la cifrada, así que ahora mira LAS
--     DOS: un motivo de alta, en claro o cifrado, sigue exigiendo fecha.
--   · `resident_profiles_identificacion_not_blank` exigía «lo que no se
--     sabe va NULL, no en blanco». Se extiende a las cifradas por lo
--     mismo: un `dni_cifrado` en blanco haría que «tiene DNI» mintiera.
--
-- Los de `care_plan_items` (`frecuencia_coherente`, `origen_coherente`,
-- `vigencia_ordenada`, `cierre_con_autor`) y el de `bed_assignments`
-- (`vigencia`) **no miran ninguna columna de texto**: se repasaron uno por
-- uno y no hace falta tocarlos. `cierre_con_autor` mira `to_at` y
-- `closed_by_user_id`, no el motivo del cierre.
--
-- ── El `down`, pensado ──────────────────────────────────────────────
--
-- Reversible del todo mientras no haya corrido el script de cifrado con
-- `--vaciar`. Después NO: las columnas en claro estarían vacías y el
-- `down` sería la pérdida del dato que esta migración existe para
-- proteger.
--
--   ALTER TABLE "resident_profiles"
--       DROP COLUMN "dni_cifrado",
--       DROP COLUMN "nss_cifrado",
--       DROP COLUMN "discharge_reason_cifrado",
--       DROP CONSTRAINT "resident_profiles_alta_coherente",
--       ADD CONSTRAINT "resident_profiles_alta_coherente" CHECK (
--           ("discharge_reason" IS NULL OR "discharge_date" IS NOT NULL)
--           AND ("discharge_date" IS NULL
--                OR "discharge_date" >= "admission_date")),
--       DROP CONSTRAINT "resident_profiles_identificacion_not_blank",
--       ADD CONSTRAINT "resident_profiles_identificacion_not_blank" CHECK (
--           ("dni" IS NULL OR btrim("dni") <> '')
--           AND ("nss" IS NULL OR btrim("nss") <> ''));
--   ALTER TABLE "care_plan_items"
--       DROP COLUMN "reason_cifrado",
--       DROP COLUMN "close_reason_cifrado";
--   ALTER TABLE "bed_assignments"
--       DROP COLUMN "reason_cifrado";

-- ──────────────────────────────────────────────────────────────────────
-- 1 · `resident_profiles` · el DNI, el NSS y el motivo del alta
-- ──────────────────────────────────────────────────────────────────────

ALTER TABLE "resident_profiles"
    ADD COLUMN "dni_cifrado"              TEXT,
    ADD COLUMN "nss_cifrado"              TEXT,
    ADD COLUMN "discharge_reason_cifrado" TEXT,
    ADD CONSTRAINT "resident_profiles_dni_cifrado_formato"
        CHECK ("dni_cifrado" IS NULL
               OR "dni_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$'),
    ADD CONSTRAINT "resident_profiles_nss_cifrado_formato"
        CHECK ("nss_cifrado" IS NULL
               OR "nss_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$'),
    ADD CONSTRAINT "resident_profiles_discharge_reason_cifrado_formato"
        CHECK ("discharge_reason_cifrado" IS NULL
               OR "discharge_reason_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

-- El motivo del alta, en claro O CIFRADO, sigue exigiendo fecha de alta.
-- Una ficha que dice que alguien se fue sin decir cuándo es lo que este
-- CHECK existe para impedir, y con el claro vaciado lo diría la cifrada.
--
-- Ninguna de las comparaciones puede dar NULL: las cuatro son `IS NULL` /
-- `IS NOT NULL`, y la de las fechas ya venía con su `IS NULL` delante. Un
-- CHECK que da NULL pasa, y esa es la forma en que esto se rompería sin
-- que se viera.
ALTER TABLE "resident_profiles"
    DROP CONSTRAINT "resident_profiles_alta_coherente";

ALTER TABLE "resident_profiles"
    ADD CONSTRAINT "resident_profiles_alta_coherente"
    CHECK (
        (("discharge_reason" IS NULL AND "discharge_reason_cifrado" IS NULL)
            OR "discharge_date" IS NOT NULL)
        AND ("discharge_date" IS NULL OR "discharge_date" >= "admission_date")
    );

-- Y «lo que no se sabe va NULL, no en blanco», extendido a las cifradas.
ALTER TABLE "resident_profiles"
    DROP CONSTRAINT "resident_profiles_identificacion_not_blank";

ALTER TABLE "resident_profiles"
    ADD CONSTRAINT "resident_profiles_identificacion_not_blank"
    CHECK (
        ("dni" IS NULL OR btrim("dni") <> '')
        AND ("nss" IS NULL OR btrim("nss") <> '')
        AND ("dni_cifrado" IS NULL OR btrim("dni_cifrado") <> '')
        AND ("nss_cifrado" IS NULL OR btrim("nss_cifrado") <> '')
    );

-- ──────────────────────────────────────────────────────────────────────
-- 2 · `care_plan_items` · por qué se abrió y por qué se cerró
-- ──────────────────────────────────────────────────────────────────────
--
-- Los DOS textos libres de la tabla que más pesa del inventario. El código
-- del control y la frecuencia se quedan en claro (ver la cabecera): ahí
-- está el índice único que sostiene «una línea viva por residente y
-- control».
--
-- Nótese lo que eso significa y conviene no esconder: `control_code` en
-- claro ya dice QUÉ se le controla a un residente. Lo que este bloque
-- cifra de esta tabla es el texto que una persona escribió a mano, que es
-- donde cabe el diagnóstico con todas las letras.

ALTER TABLE "care_plan_items"
    ADD COLUMN "reason_cifrado"       TEXT,
    ADD COLUMN "close_reason_cifrado" TEXT,
    ADD CONSTRAINT "care_plan_items_reason_cifrado_formato"
        CHECK ("reason_cifrado" IS NULL
               OR "reason_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$'),
    ADD CONSTRAINT "care_plan_items_close_reason_cifrado_formato"
        CHECK ("close_reason_cifrado" IS NULL
               OR "close_reason_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');

-- ──────────────────────────────────────────────────────────────────────
-- 3 · `bed_assignments` · por qué cambió de habitación
-- ──────────────────────────────────────────────────────────────────────
--
-- «Se cae de la cama», «aislamiento por GEA», «conflicto con la
-- compañera». La ubicación en sí sigue en claro —`floors.name` es del
-- centro— y eso está declarado en el `done`: una planta que se llame
-- «Unidad de Alzhéimer» es un diagnóstico para todos los que duermen en
-- ella, y eso no lo arregla una DEK por tenant atada a una fila.

ALTER TABLE "bed_assignments"
    ADD COLUMN "reason_cifrado" TEXT,
    ADD CONSTRAINT "bed_assignments_reason_cifrado_formato"
        CHECK ("reason_cifrado" IS NULL
               OR "reason_cifrado" ~ '^c[0-9]+:[A-Za-z0-9+/]+={0,2}$');
