-- clinica-1 · la historia clínica es un módulo, y el sanitario es un rol.
--
-- Mismo patrón exacto que `fichaje_1_modulo` (ADR-018) y que `caja_enabled`
-- (ADR-016, H1): una capability booleana por tenant, apagada por defecto, y
-- la puerta en el servidor. Lo que esta migración trae son los CIMIENTOS de
-- permisos; las tablas de la historia van en la hermana
-- `20261005010000_clinica_1_historia`.
--
-- Migración ADITIVA. No toca ni una fila existente más allá del backfill
-- del propio DEFAULT, y ese backfill deja a todos los tenants de hoy
-- EXACTAMENTE como estaban: sin clínica, nadie sanitario, y el rol nuevo
-- sin un solo usuario.
--
-- El backfill ES el DEFAULT: desde PG 11 un `ADD COLUMN ... NOT NULL
-- DEFAULT <constante>` no reescribe la tabla.
--
-- ── El `down`, pensado ────────────────────────────────────────────────
--
-- Las cuatro primeras piezas se revierten sin pérdida mientras la columna
-- esté a su default:
--
--   ALTER TABLE "users"   DROP CONSTRAINT "users_clinician_license_not_blank";
--   ALTER TABLE "users"   DROP COLUMN "clinical_scope";
--   ALTER TABLE "users"   DROP COLUMN "clinician_license";
--   ALTER TABLE "users"   DROP COLUMN "is_clinician";
--   ALTER TABLE "tenants" DROP COLUMN "clinical_records_enabled";
--   DROP TYPE "ClinicalScope";
--
-- La quinta NO: **un valor de enum no se quita en Postgres.** `ALTER TYPE
-- ... DROP VALUE` no existe. Deshacer `CLINICIAN` exige recrear el tipo
-- entero (crear "UserRole_new", migrar la columna, borrar el viejo,
-- renombrar) y eso sólo es seguro si NINGÚN usuario lo lleva puesto. Por
-- eso el valor va en su propia sentencia y al final: si hay que echar
-- atrás, se echa atrás todo lo de arriba y el valor sobra inerte en el
-- catálogo, que es gratis. El `down` de verdad es:
--
--   UPDATE "users" SET role = 'CASHIER' WHERE role = 'CLINICIAN';
--   -- y sólo entonces, si de verdad hace falta, el baile del tipo nuevo.
--
-- ── Por qué `ALTER TYPE` aquí no revienta ────────────────────────────
--
-- Prisma envuelve cada migración en una transacción, y hasta PG 11 un
-- `ALTER TYPE ... ADD VALUE` dentro de una transacción estaba prohibido.
-- Desde PG 12 se permite, con una condición: el valor nuevo NO puede
-- USARSE en la misma transacción. Aquí no se usa — ni un INSERT, ni un
-- UPDATE, ni un DEFAULT que lo mencione, **ni un CHECK**. Por eso el
-- invariante "role = CLINICIAN implica is_clinician" no está aquí abajo
-- sino en la migración hermana: un CHECK que nombra 'CLINICIAN' lo USA, y
-- habría reventado la migración con «unsafe use of new value of enum
-- type». El motor de producción y el de los e2e es `postgres:16-alpine`.

-- ── 1 · el interruptor del tenant ─────────────────────────────────────
--
-- `DEFAULT false` y no true, igual que `fichaje_enabled` y al contrario
-- que `caja_enabled`: el default de una capability es "deja a los tenants
-- de hoy como estaban". Ninguno lleva historias clínicas.
--
-- Apagado, las rutas clínicas responden 404 y no 403 (ver
-- `apps/api/src/clinica/gate.ts`): un bar no tiene por qué enterarse de
-- que existe un módulo de historia clínica.
ALTER TABLE "tenants"
    ADD COLUMN "clinical_records_enabled" BOOLEAN NOT NULL DEFAULT false;

-- ── 2 · el alcance de un sanitario ────────────────────────────────────
--
-- `SELECTION` es el default y es deliberado: lo seguro es lo restrictivo.
-- Un sanitario recién marcado ve las historias de los pacientes que
-- atiende, no las de todos. Pasar a `ALL` es un acto explícito de la
-- dueña o del encargado.
CREATE TYPE "ClinicalScope" AS ENUM ('ALL', 'SELECTION');

-- ── 3 · la marca sanitaria, separada del rol de negocio ───────────────
--
-- Decisión de producto (Matías, 05-10-2026): en pantalla se ven TRES
-- nombres —cajero, cajero-sanitario, sanitario— pero por dentro el rol de
-- negocio y la marca sanitaria viven en columnas distintas. Así mañana
-- cabe otro rol de negocio sin rehacer permisos, y una dueña o un
-- encargado pueden ser sanitarios sin dejar de ser dueña o encargado.
--
-- Las tres combinaciones visibles salen de cruzar las dos columnas:
--
--   cajero            · role = CASHIER   , is_clinician = false
--   cajero-sanitario  · role = CASHIER   , is_clinician = true
--   sanitario         · role = CLINICIAN , is_clinician = true
ALTER TABLE "users"
    ADD COLUMN "is_clinician" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users"
    ADD COLUMN "clinician_license" TEXT;
ALTER TABLE "users"
    ADD COLUMN "clinical_scope" "ClinicalScope" NOT NULL DEFAULT 'SELECTION';

-- El nº de colegiado es opcional EN LA BASE y obligatorio EN LA API al
-- marcar a alguien como sanitario de un tenant con la clínica encendida.
-- La condición cruza dos tablas (`users` y `tenants`), así que no cabe en
-- un CHECK; lo que sí cabe aquí es que no se guarde en blanco, que es el
-- fallo que convierte "tiene colegiado" en una comprobación que miente.
ALTER TABLE "users"
    ADD CONSTRAINT "users_clinician_license_not_blank"
    CHECK ("clinician_license" IS NULL OR btrim("clinician_license") <> '');

-- ── 4 · el sanitario sin caja ─────────────────────────────────────────
--
-- Un rol de negocio nuevo, y el único que este bloque añade: el
-- profesional sanitario que pasa consulta y NO toca la caja. Ve su agenda
-- y las historias de sus pacientes; ni venta, ni turno, ni cajón, ni
-- informes. La negativa al cobro vive en la API (`ensureCajaEnabled`), no
-- sólo en los botones que el TPV esconde.
ALTER TYPE "UserRole" ADD VALUE 'CLINICIAN';
