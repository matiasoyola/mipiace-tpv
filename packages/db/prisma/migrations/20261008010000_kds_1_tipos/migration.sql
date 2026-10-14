-- kds-1-cocina · LOS TIPOS, y nada más.
--
-- Por qué va sola: Postgres prohíbe USAR un valor de enum en la misma
-- transacción en la que se añade, y Prisma corre cada migración en una
-- transacción. `KITCHEN` hace falta escrito dentro del CHECK
-- `devices_kitchen_sections` de la migración siguiente, así que o se
-- parten en dos o la segunda revienta. clinica-1, -2 y -3 pagaron esta
-- factura tres veces; aquí está pagada una.
--
-- Los tres tipos nuevos son listas CERRADAS, y de ahí que sean enums y no
-- `VARCHAR` con CHECK como `products.exemption_cause`:
--
--   · `Allergen` — los catorce del anexo II del Reglamento (UE) 1169/2011.
--     Los fija una norma de 2011, no el producto.
--   · `KitchenCourseMode`, `KitchenSeatMode` — dos valores cada uno, que
--     son las dos formas que la decisión 3 cerró.
--
-- El `down`, dicho en voz alta: **no es reversible**. `ALTER TYPE … DROP
-- VALUE` no existe en Postgres, así que `KITCHEN` se queda en `DeviceKind`
-- para siempre. Los tres tipos nuevos sí se pueden tirar (`DROP TYPE`)
-- mientras nadie los use, o sea sólo antes de la migración siguiente.

-- Los 14 alérgenos de declaración obligatoria. El comentario de cada uno
-- es el código corto del generador de cartas de La Maestranza, para que
-- importarlos sea una tabla de equivalencias y no una traducción a ojo.
CREATE TYPE "Allergen" AS ENUM (
    'GLUTEN',         -- GL
    'CRUSTACEOS',     -- CR
    'HUEVOS',         -- HU
    'PESCADO',        -- PE
    'CACAHUETES',     -- CA
    'SOJA',           -- SO
    'LACTEOS',        -- LA
    'FRUTOS_CASCARA', -- FC
    'APIO',           -- AP
    'MOSTAZA',        -- MO
    'SESAMO',         -- SE
    'SULFITOS',       -- SU
    'ALTRAMUCES',     -- AL
    'MOLUSCOS'        -- MC
);

-- Cómo enseña el TPV los tiempos de salida. Las dos son la MISMA
-- estructura por debajo (`ticket_lines.course` + `ticket_courses`), así
-- que cambiar de modo no migra nada.
CREATE TYPE "KitchenCourseMode" AS ENUM ('ESPERA', 'TIEMPOS');

-- Cuándo se ve el botón «→ Silla n» en la línea de la comanda.
CREATE TYPE "KitchenSeatMode" AS ENUM ('ALERGIA', 'SIEMPRE');

-- La tablet de la cocina: la MISMA APK en «modo cocina».
--
-- NO releva al terminal de la caja, y eso no hay que programarlo: el
-- trigger `devices_revoke_previous` y el índice parcial
-- `devices_one_active_per_register_key` de `verifactu-1` filtran los dos
-- `kind = 'TERMINAL'`. Un valor nuevo cae fuera por construcción. Lo que
-- SÍ hay que hacer es probarlo y no suponerlo: ese es el sabotaje
-- «Emparejar KITCHEN revoca el terminal» de la tabla del bloque.
ALTER TYPE "DeviceKind" ADD VALUE 'KITCHEN';
