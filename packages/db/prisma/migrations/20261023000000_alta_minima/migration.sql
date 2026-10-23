-- alta-minima · **PARA CREAR UN RESIDENTE BASTA CON EL NOMBRE.**
--
-- Tres columnas pierden el `NOT NULL`:
--
--   · `resident_profiles.admission_date`
--   · `resident_profiles.dependency_level`
--   · `resident_profiles.place_type`
--
-- ── POR QUÉ ──────────────────────────────────────────────────────────
--
-- El 23-10-2026 se encendió la primera residencia real (Jardín de Gredos)
-- y llegó su listado: 43 residentes con **nombre y tipo de plaza, y nada
-- más**. La señora ya vive allí y ya hay que atenderla: no saber la fecha
-- de ingreso ni el grado no hace que necesite menos cuidados.
--
-- Con estas tres columnas obligatorias, el centro **no puede meter a su
-- gente en el programa**: no aparecen en la puerta, no se les puede
-- apuntar «algo no va nada bien» y el relevo no las ve. El dato que falta
-- pasa a ser dato (`datosQueFaltan`, en el paquete puro) y el programa no
-- deja de recordarlo hasta que la ficha esté completa.
--
-- ── EL `down` ────────────────────────────────────────────────────────
--
--   -- 1 · Las tres columnas NO pueden volver a NOT NULL con filas a
--   --     NULL dentro. Esto FALLA a propósito y con un mensaje que dice
--   --     qué hacer, en vez de rellenar nada: inventarle una fecha de
--   --     ingreso a 43 residentes es escribir un dato falso en la ficha
--   --     de una persona, y eso luego sale en un informe a la
--   --     Consejería.
--   DO $down$
--   DECLARE n integer;
--   BEGIN
--     SELECT count(*) INTO n FROM "resident_profiles"
--      WHERE "admission_date" IS NULL
--         OR "dependency_level" IS NULL
--         OR "place_type" IS NULL;
--     IF n > 0 THEN
--       RAISE EXCEPTION
--         'No se puede bajar alta-minima: hay % ficha(s) de residente sin fecha de ingreso, sin nivel de dependencia o sin tipo de plaza. Complétalas en Residentes (la tarjeta «fichas incompletas» del panel las lleva una por una) y vuelve a intentarlo.', n;
--     END IF;
--   END
--   $down$;
--
--   -- 2 · Y entonces sí.
--   ALTER TABLE "resident_profiles"
--     ALTER COLUMN "admission_date"   SET NOT NULL,
--     ALTER COLUMN "dependency_level" SET NOT NULL,
--     ALTER COLUMN "place_type"       SET NOT NULL;
--
--   -- 3 · El CHECK vuelve a su forma de residencia-1b.
--   ALTER TABLE "resident_profiles"
--     DROP CONSTRAINT "resident_profiles_alta_coherente";
--   ALTER TABLE "resident_profiles"
--     ADD CONSTRAINT "resident_profiles_alta_coherente"
--     CHECK (
--       (("discharge_reason" IS NULL AND "discharge_reason_cifrado" IS NULL)
--           OR "discharge_date" IS NOT NULL)
--       AND ("discharge_date" IS NULL OR "discharge_date" >= "admission_date")
--     );
--
-- ── ADITIVA ──────────────────────────────────────────────────────────
--
-- Sólo nulabilidad. Ni un `DROP TABLE`, ni un `DELETE`, ni un `TRUNCATE`,
-- ni un `UPDATE … SET` sobre datos, ni una tabla nueva: historia-1
-- construye el ingreso guiado en su propia rama y **esta migración no le
-- pisa ninguna tabla**. Las filas que ya estaban se quedan exactamente
-- como estaban — quitar un `NOT NULL` no toca ni una.
--
-- Un test (`apps/api/test/alta-minima-migracion.test.ts`) enumera los
-- `ALTER TABLE` y comprueba que sólo nombran `resident_profiles`.

ALTER TABLE "resident_profiles"
  ALTER COLUMN "admission_date"   DROP NOT NULL,
  ALTER COLUMN "dependency_level" DROP NOT NULL,
  ALTER COLUMN "place_type"       DROP NOT NULL;

-- ──────────────────────────────────────────────────────────────────────
-- Y EL CHECK DE LA FECHA DE ALTA, QUE AHORA PUEDE DAR `NULL`
-- ──────────────────────────────────────────────────────────────────────
--
-- `resident_profiles_alta_coherente` llevaba desde residencia-1:
--
--     ("discharge_date" IS NULL OR "discharge_date" >= "admission_date")
--
-- Con `admission_date` a NULL esa comparación da **NULL**, y un CHECK que
-- da NULL **pasa**. O sea: la mitad «una fecha de alta anterior al
-- ingreso es un error de dedo» se apagaría sola para las fichas nuevas, y
-- no se vería porque nada se pondría rojo.
--
-- Así que la condición se escribe ENTERA, con su `IS NULL` delante. Lo
-- que queda dicho es exactamente lo que se quiere decir:
--
--   · sin fecha de ingreso, no hay nada que comparar y el alta pasa — es
--     legítimo, el residente ya estaba aquí cuando el programa llegó;
--   · con las dos, la de alta no puede ser anterior.
--
-- Se parte de la ÚLTIMA definición, la de residencia-1b (que amplió la
-- primera mitad a la columna cifrada), y no de la de residencia-1: un
-- `DROP` + `ADD` desde la primera habría borrado en silencio la mitad que
-- mira `discharge_reason_cifrado`.
ALTER TABLE "resident_profiles"
    DROP CONSTRAINT "resident_profiles_alta_coherente";

ALTER TABLE "resident_profiles"
    ADD CONSTRAINT "resident_profiles_alta_coherente"
    CHECK (
        (("discharge_reason" IS NULL AND "discharge_reason_cifrado" IS NULL)
            OR "discharge_date" IS NOT NULL)
        AND (
            "discharge_date" IS NULL
            OR "admission_date" IS NULL
            OR "discharge_date" >= "admission_date"
        )
    );
