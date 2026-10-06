-- clinica-2 · el valor del enum, el actor de sistema y la marca del
-- servicio. Las tres piezas que la migración hermana NECESITA ya creadas.
--
-- ── Por qué son DOS migraciones y no una ──────────────────────────────
--
-- Misma razón exacta que en clinica-1 (`clinica_1_modulo` +
-- `clinica_1_historia`, §14 de su done): **Postgres prohíbe USAR un valor
-- de enum en la misma transacción en la que se añade.** Prisma corre cada
-- migración en una transacción, así que un `ALTER TYPE … ADD VALUE
-- 'INITIAL_ASSESSMENT'` y un trigger que nombre ese valor no caben juntos:
-- la migración aborta con «unsafe use of new value of enum type».
--
-- El trigger `clinical_assessments_entry_kind` de la hermana nombra
-- 'INITIAL_ASSESSMENT'. Por eso el valor entra aquí y la tabla allí.
--
-- ── Migración ADITIVA ─────────────────────────────────────────────────
--
-- Ni un DROP, ni un TRUNCATE, ni un DELETE, ni un UPDATE masivo. Las dos
-- columnas nuevas nacen con `DEFAULT false`, y desde PG 11 un default
-- constante NO reescribe la tabla. Los quince tenants de hoy no cambian de
-- comportamiento: `primera_valoracion = false` en cada servicio (ninguna
-- cita dispara nada) e `is_system_actor = false` en cada usuario.
--
-- ── El `down`, pensado ────────────────────────────────────────────────
--
--   ALTER TABLE "users" DROP CONSTRAINT "users_system_actor_no_credentials";
--   ALTER TABLE "users" DROP COLUMN "is_system_actor";
--   ALTER TABLE "service_scheduling" DROP COLUMN "primera_valoracion";
--   -- y el valor del enum NO se quita: `ALTER TYPE … DROP VALUE` no
--   -- existe en Postgres. Hay que recrear el tipo entero, y sólo es
--   -- seguro si ninguna fila de `clinical_entries` lo lleva puesto. Igual
--   -- que el 'CLINICIAN' de clinica-1.
--
-- Antes del DROP COLUMN de `is_system_actor` habría que borrar el actor
-- «paciente por enlace» de cada tenant — y eso NO se puede, porque es
-- autor de entradas de historia con FK RESTRICT. Lo cual es correcto: si
-- hay valoraciones contestadas, esta migración no se echa atrás, se
-- conserva.

-- ── 1 · el valor del enum ──────────────────────────────────────────────
--
-- Lo que contestó el paciente es una pieza de historia como cualquier
-- otra, y por eso vive en `clinical_entries`: ahí la inmutabilidad ya la
-- hace cumplir el motor (trigger `clinical_entries_inmutable`). El estado
-- de la valoración —que sí cambia— vive en su propia tabla.
ALTER TYPE "ClinicalEntryKind" ADD VALUE 'INITIAL_ASSESSMENT';

-- ── 2 · el actor de sistema ────────────────────────────────────────────
--
-- EL PACIENTE NO ES UN `User`, PERO SÍ ESCRIBE EN SU HISTORIA.
--
-- `clinical_entries.author_user_id` y `clinical_access_log.user_id` son
-- NOT NULL con RESTRICT, y eso es la garantía de clinica-1 de que ninguna
-- línea de historia es anónima. Cuando el paciente contesta el test por el
-- enlace, hay que escribir una entrada y una línea de registro con autor.
--
-- Dos salidas posibles:
--
--   a) Relajar los NOT NULL y añadir una columna «qué clase de actor fue».
--      Se descarta: convierte «ninguna línea sin autor» en «ninguna línea
--      sin autor, salvo estas», que es perder la invariante entera para
--      ahorrar una fila.
--   b) Darle una fila. La autoría sigue siendo NOT NULL, el registro no
--      necesita casos especiales, y la pantalla lee su `alias` como el de
--      cualquier autor («Paciente (por enlace)»).
--
-- Se elige (b). Es un actor, no una persona a la que dar de alta: no sale
-- en `GET /cashiers`, ni en `GET /staff`, ni entre los candidatos a PIN de
-- encargado, ni cuenta para la colisión de alias. Esas cuatro listas lo
-- excluyen por esta columna.
--
-- La fila la crea la aplicación la primera vez que hace falta
-- (`clinica/actor-paciente.ts`), una por tenant y dentro de la misma
-- transacción que la escritura. No se siembra aquí a propósito: hoy no hay
-- ningún tenant con la clínica encendida, y sembrar usuarios en una
-- migración es sembrar filas que nadie ha pedido en quince bases.
ALTER TABLE "users"
    ADD COLUMN "is_system_actor" BOOLEAN NOT NULL DEFAULT false;

-- Y NO PUEDE AUTENTICARSE. NUNCA.
--
-- No «no le ponemos PIN»: el motor lo prohíbe. Sin `password_hash` no hay
-- login de panel (lo exige) y sin `pin_hash` no hay login de TPV
-- (`/shift/cashier-login` rechaza al usuario sin PIN antes de comparar
-- nada). Las dos puertas quedan cerradas por una constraint y no por la
-- confianza en que a nadie se le ocurra darle credenciales.
--
-- Está escrito en los dos sentidos a propósito: también prohíbe marcar
-- como actor de sistema a un usuario que YA tiene credenciales, que es el
-- camino por el que esto se rompería de verdad (un UPDATE sobre la fila
-- de la propietaria).
ALTER TABLE "users"
    ADD CONSTRAINT "users_system_actor_no_credentials"
    CHECK (
        NOT "is_system_actor"
        OR ("password_hash" IS NULL AND "pin_hash" IS NULL)
    );

-- ── 3 · la marca del servicio de primera valoración ────────────────────
--
-- La que convierte «dar la cita» en «el paciente recibe el test», sin que
-- nadie tenga que acordarse. Vive en la extensión de agenda y no en el
-- producto de Holded (ADR-R1): Holded no modela esto, y el precio y el IVA
-- del servicio siguen siendo suyos.
ALTER TABLE "service_scheduling"
    ADD COLUMN "primera_valoracion" BOOLEAN NOT NULL DEFAULT false;
