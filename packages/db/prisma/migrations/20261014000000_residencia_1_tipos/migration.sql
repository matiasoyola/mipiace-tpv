-- residencia-1 · LOS TIPOS Y EL INTERRUPTOR, y nada más.
--
-- Por qué va sola, por cuarta vez en este repo: Postgres prohíbe USAR un
-- valor de enum en la misma transacción en la que se añade, y Prisma corre
-- cada migración en una transacción. `ROOM` hace falta escrito dentro del
-- CHECK `devices_register_o_habitacion` y del índice parcial
-- `devices_one_active_per_room_key` de la migración siguiente, así que o se
-- parten en dos o la segunda revienta con «unsafe use of new value of enum
-- type». clinica-1, -2 y -3 lo pagaron tres veces y kds-1 lo pagó una vez
-- ya pagado; aquí está pagado de entrada.
--
-- Los cuatro tipos nuevos son listas CERRADAS, y de ahí que sean enums y
-- no catálogo de datos:
--
--   · `DependencyLevel`  — válido / semiasistido / dependiente. Es el
--     vocabulario con el que una residencia organiza el trabajo, y el que
--     usa el PAI de Jardín de Gredos desde 2012.
--   · `DependencyGrade`  — I, II, III de la Ley 39/2006. Los fija la ley.
--   · `PlaceType`        — privada, concertada, temporal. Lo fija el
--     concierto con la JCCM.
--   · `CareRoleCategory` — operativo / supervisor / directivo (D-29 a
--     D-31). Tres niveles, y de ellos cuelga quién cierra una incidencia.
--
-- Lo que **no** es un enum y es a propósito: los ROLES de cuidado
-- (auxiliar, DUE, médico, TO…). Esos son `CareRole`, una tabla, porque un
-- centro puede añadir los suyos y desactivar los que no usa — y eso no
-- puede ser un despliegue (D-50).
--
-- ── MIGRACIÓN ADITIVA ─────────────────────────────────────────────────
--
-- Una columna nueva con default constante y cinco tipos. Ni un DROP, ni un
-- DELETE, ni un UPDATE masivo: el backfill ES el DEFAULT, y desde PG 11 un
-- `ADD COLUMN … NOT NULL DEFAULT <constante>` no reescribe la tabla.
-- Ningún tenant de hoy cambia de comportamiento — ninguno es una
-- residencia.
--
-- ── EL `down`, PENSADO ────────────────────────────────────────────────
--
-- Todo menos el valor del enum se revierte sin pérdida mientras la columna
-- esté a su default:
--
--   ALTER TABLE "tenants" DROP CONSTRAINT "tenants_residencia_exige_clinica";
--   ALTER TABLE "tenants" DROP COLUMN "residencia_enabled";
--   DROP TYPE "CareRoleCategory";
--   DROP TYPE "PlaceType";
--   DROP TYPE "DependencyGrade";
--   DROP TYPE "DependencyLevel";
--
-- El valor del enum NO: `ALTER TYPE … DROP VALUE` no existe en Postgres.
-- `ROOM` se queda en `DeviceKind` para siempre. Deshacerlo de verdad exige
-- recrear el tipo entero y sólo es seguro si ningún dispositivo lo lleva
-- puesto:
--
--   DELETE FROM "devices" WHERE "kind" = 'ROOM';   -- y sólo entonces,
--   -- el baile del tipo nuevo (crear "DeviceKind_new", migrar las dos
--   -- columnas que lo usan —devices.kind y pairing_codes.kind—, borrar el
--   -- viejo, renombrar).
--
-- Por eso el `ALTER TYPE` va en su propia sentencia y al final: si hay que
-- echar atrás, se echa atrás todo lo de arriba y el valor sobra inerte en
-- el catálogo, que es gratis.

-- ──────────────────────────────────────────────────────────────────────
-- 1 · El interruptor de la residencia
-- ──────────────────────────────────────────────────────────────────────
--
-- Mismo patrón exacto que `clinical_records_enabled` (clinica-1),
-- `fichaje_enabled` (ADR-018) y `kitchen_display_enabled` (kds-1): una
-- capability booleana por tenant, apagada por defecto, y la puerta en el
-- servidor. Lo mueve SÓLO el super-admin, así que no aparece en el POST de
-- `/admin/tenant/settings` — un propietario que lo intente recibe un 400
-- por `additionalProperties: false`.
--
-- Apagado, las rutas de residencia responden **404 y no 403**, igual que
-- las clínicas y por la misma razón: un bar no tiene por qué enterarse de
-- que este módulo existe ni de que alguien guarda datos de salud aquí.
ALTER TABLE "tenants"
    ADD COLUMN "residencia_enabled" BOOLEAN NOT NULL DEFAULT false;

-- ── Y no se puede encender sin la clínica ─────────────────────────────
--
-- El residente es un `Client` CON HISTORIA (D-49): la ficha del residente
-- pasa por la misma función de acceso que la historia clínica, y el
-- registro de la puerta (residencia-3) será historia clínica. Un tenant
-- con `residencia_enabled` y `clinical_records_enabled = false` sería un
-- módulo cuyo dato central no se puede ni leer, y además escribiría
-- registros de salud en un centro que no ha aceptado el marco legal.
--
-- En el MOTOR y no sólo en el 409 de la ruta del super-admin, por lo mismo
-- que el semáforo de cocina: hay más de una puerta de escritura, y la
-- segunda es el `psql` de una implantación a las nueve de la noche.
--
-- Nótese el sentido de la implicación: la clínica SÍ puede estar encendida
-- sola (la podóloga de clinica-1 no es una residencia).
ALTER TABLE "tenants"
    ADD CONSTRAINT "tenants_residencia_exige_clinica"
    CHECK ("residencia_enabled" = false OR "clinical_records_enabled" = true);

-- ──────────────────────────────────────────────────────────────────────
-- 2 · Los cuatro tipos de la residencia
-- ──────────────────────────────────────────────────────────────────────

-- Cuánta ayuda necesita un residente. Lo decide el CENTRO para organizar
-- el trabajo, y de aquí sale el plan de cuidados por defecto de
-- residencia-2 (D-53).
CREATE TYPE "DependencyLevel" AS ENUM ('VALIDO', 'SEMIASISTIDO', 'DEPENDIENTE');

-- El grado RECONOCIDO de la Ley 39/2006. Opcional en la tabla: hay
-- residentes privados sin valoración, y un grado que no se tiene no se
-- inventa. No es lo mismo que el nivel de arriba —aquél lo pone el centro,
-- éste la administración— y por eso son dos columnas.
CREATE TYPE "DependencyGrade" AS ENUM ('I', 'II', 'III');

-- Qué clase de plaza ocupa. Los pagadores, el copago y la vigencia de la
-- plaza son Fase 3; aquí sólo de qué tipo es, que es lo que la dirección
-- necesita ver en la lista.
CREATE TYPE "PlaceType" AS ENUM ('PRIVADA', 'CONCERTADA', 'TEMPORAL');

-- La categoría de un rol de cuidado (D-29 a D-31). De ella cuelga quién
-- cierra una incidencia en residencia-4: el cierre es de categoría
-- directiva y los N3/N4 exigen además una persona distinta de quien
-- registró (D-27, D-28). Por eso un centro NO puede cambiarle la categoría
-- a un rol de serie, y lo impide un trigger en la migración siguiente.
CREATE TYPE "CareRoleCategory" AS ENUM ('OPERATIVO', 'SUPERVISOR', 'DIRECTIVO');

-- ──────────────────────────────────────────────────────────────────────
-- 3 · La puerta de la habitación, como tipo de dispositivo
-- ──────────────────────────────────────────────────────────────────────
--
-- La MISMA APK en «modo puerta» (D-52), igual que la tablet de cocina es
-- la misma APK en «modo cocina». Lo que cambia es la pantalla que pinta al
-- arrancar y la puerta de auth que le abre el servidor.
--
-- NO releva al terminal de ninguna caja, y eso no hay que programarlo: el
-- trigger `devices_revoke_previous` y el índice parcial
-- `devices_one_active_per_register_key` de `verifactu-1` filtran los dos
-- `kind = 'TERMINAL'`, así que un valor nuevo cae fuera por construcción.
-- Lo que SÍ hay que hacer es probarlo y no suponerlo: es su fila en la
-- tabla de sabotajes del bloque.
ALTER TYPE "DeviceKind" ADD VALUE 'ROOM';
