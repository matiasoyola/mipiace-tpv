-- puesta-en-marcha · la foto de producción ANTES de desplegar la migración.
--
-- Sólo LEE. Se puede lanzar con el TPV vendiendo.
--
--   ssh root@76.13.142.28
--   docker compose exec -T postgres psql -U mipiacetpv -d mipiacetpv -f - < este_fichero.sql
--
-- o pegándolo dentro de `psql -U mipiacetpv -d mipiacetpv`.
--
-- Lo que sale es, cuenta a cuenta, EXACTAMENTE lo que la migración
-- `20261017000000_puesta_en_marcha` va a escribir en cada fila. La columna
-- `regla` dice por qué:
--
--   3.a  tiene registros fiscales      → factura desde su primera factura
--   3.b  tiene ventas REALES           → factura desde su primera venta
--   3.c  cuenta nuestra de pruebas     → en ensayo, y marcada
--   3.d  ni registros ni ventas reales → en ensayo
--
-- Si alguna fila sale con `regla = '¿?'`, PARA: esa cuenta no encaja en
-- ninguna regla y no se adivina. La tabla que salga va al done.md tal cual.
--
-- ── QUÉ CUENTA COMO «VENTA REAL» ──────────────────────────────────────
--
-- La primera versión de esta consulta contaba como real todo lo que no
-- fuera borrador ni ensayo, y eso metió a Cafetería Sirope en la regla 3.b
-- con 20 «ventas»: las 20 anuladas, ninguna en Holded, 16 del cajero de
-- pruebas y 4 de la demostración con la dueña. Sirope no ha vendido nunca.
--
--   venta real  =  no es DRAFT, ni TEST, ni VOIDED
--               OR  tiene holded_document_id
--
-- Lo segundo aunque esté anulada después: `holded_document_id` lo pone el
-- worker cuando Holded CREA el documento, así que existió una factura con
-- número en la contabilidad del cliente, y eso no se deshace anulando el
-- ticket aquí.
--
-- La columna `regla_vieja` queda al lado A PROPÓSITO: enseña qué cuentas
-- cambian de regla con el arreglo, que es lo único que hay que repasar.

WITH primera_factura AS (
  SELECT "tenant_id", MIN("fecha_expedicion") AS "fecha", COUNT(*) AS "registros"
    FROM "fiscal_records"
   GROUP BY "tenant_id"
),
ventas AS (
  SELECT "tenant_id",
         -- Lo que de verdad decide.
         COUNT(*) FILTER (
           WHERE "status" NOT IN ('DRAFT', 'TEST', 'VOIDED')
              OR "holded_document_id" IS NOT NULL
         )                                                          AS "reales",
         MIN(COALESCE("paid_at", "created_at")) FILTER (
           WHERE "status" NOT IN ('DRAFT', 'TEST', 'VOIDED')
              OR "holded_document_id" IS NOT NULL
         )                                                          AS "primera_real",
         -- Y el desglose, para poder mirar a los ojos a cada número.
         COUNT(*) FILTER (WHERE "status" = 'TEST')                  AS "de_ensayo",
         COUNT(*) FILTER (WHERE "status" = 'DRAFT')                 AS "borradores",
         COUNT(*) FILTER (WHERE "status" = 'VOIDED')                AS "anuladas",
         COUNT(*) FILTER (WHERE "holded_document_id" IS NOT NULL)   AS "en_holded",
         -- Lo que contaba la regla VIEJA (sin descartar las anuladas).
         COUNT(*) FILTER (WHERE "status" NOT IN ('DRAFT', 'TEST'))  AS "reales_regla_vieja"
    FROM "tickets"
   GROUP BY "tenant_id"
),
pruebas AS (
  SELECT t."id"
    FROM "tenants" t
   WHERE t."name" = 'PRUEBAS MIPIACE'
      OR EXISTS (
        SELECT 1 FROM "users" u
         WHERE u."tenant_id" = t."id"
           AND u."email" LIKE 'm.oyola+maestranza-ensayo%'
      )
)
SELECT
  t."name"                                              AS "cuenta",
  t."onboarding_state"                                  AS "onboarding",
  t."holded_enabled"                                    AS "usa_holded",
  (t."holded_api_key_ciphertext" IS NOT NULL)           AS "clave_puesta",
  COALESCE(f."registros", 0)                            AS "registros_fiscales",
  COALESCE(v."reales", 0)                               AS "ventas_reales",
  COALESCE(v."anuladas", 0)                             AS "anuladas",
  COALESCE(v."en_holded", 0)                            AS "en_holded",
  COALESCE(v."de_ensayo", 0)                            AS "tickets_test",
  COALESCE(v."borradores", 0)                           AS "borradores",
  CASE
    WHEN f."fecha" IS NOT NULL THEN '3.a'
    WHEN v."primera_real" IS NOT NULL THEN '3.b'
    WHEN p."id" IS NOT NULL THEN '3.c'
    ELSE '3.d'
  END                                                   AS "regla",
  -- Lo que habría dicho la regla vieja. Si no coincide con `regla`, esa es
  -- una cuenta a mirar: es justo el caso de Sirope.
  CASE
    WHEN f."fecha" IS NOT NULL THEN '3.a'
    WHEN COALESCE(v."reales_regla_vieja", 0) > 0 THEN '3.b'
    WHEN p."id" IS NOT NULL THEN '3.c'
    ELSE '3.d'
  END                                                   AS "regla_vieja",
  COALESCE(
    (f."fecha"::timestamp AT TIME ZONE 'Europe/Madrid'),
    v."primera_real"
  )                                                     AS "factura_desde_quedaria",
  (p."id" IS NOT NULL)                                  AS "es_de_pruebas_quedaria"
FROM "tenants" t
LEFT JOIN primera_factura f ON f."tenant_id" = t."id"
LEFT JOIN ventas          v ON v."tenant_id" = t."id"
LEFT JOIN pruebas         p ON p."id"        = t."id"
ORDER BY t."name";

-- ── Las cuentas que CAMBIAN de regla con el arreglo ───────────────────
--
-- Tiene que salir Sirope (3.b → 3.d) y nadie más. Si sale alguien más, hay
-- que mirarlo una por una antes de desplegar: una cuenta que pase de 3.b a
-- 3.d es una cuenta que DEJA de arrancar sola, y eso es lo que queremos —
-- pero sólo si de verdad no ha vendido.

SELECT t."name",
       COUNT(*) FILTER (WHERE tk."status" NOT IN ('DRAFT','TEST'))   AS "no_borrador_ni_ensayo",
       COUNT(*) FILTER (WHERE tk."status" = 'VOIDED')                AS "anuladas",
       COUNT(*) FILTER (WHERE tk."holded_document_id" IS NOT NULL)   AS "en_holded",
       COUNT(*) FILTER (
         WHERE tk."status" NOT IN ('DRAFT','TEST','VOIDED')
            OR tk."holded_document_id" IS NOT NULL
       )                                                             AS "reales_de_verdad"
  FROM "tenants" t
  JOIN "tickets" tk ON tk."tenant_id" = t."id"
  LEFT JOIN "fiscal_records" fr ON fr."tenant_id" = t."id"
 WHERE fr."id" IS NULL          -- las de la regla 3.a no las toca este cambio
 GROUP BY t."id", t."name"
HAVING COUNT(*) FILTER (WHERE tk."status" NOT IN ('DRAFT','TEST')) > 0
   AND COUNT(*) FILTER (
         WHERE tk."status" NOT IN ('DRAFT','TEST','VOIDED')
            OR tk."holded_document_id" IS NOT NULL
       ) = 0
 ORDER BY 1;

-- ── Y la comprobación que hace parar la migración ─────────────────────
--
-- Ninguna cuenta puede ser a la vez «nuestra de pruebas» y tener facturas o
-- ventas reales. Si devuelve filas, la migración ABORTA con el nombre
-- dentro: hay que decidir qué se hace con esa cuenta ANTES de desplegar.

SELECT t."name",
       COALESCE(f."registros", 0) AS "registros",
       COALESCE(v."reales", 0)    AS "ventas_reales"
  FROM "tenants" t
  LEFT JOIN (SELECT "tenant_id", COUNT(*) AS "registros" FROM "fiscal_records" GROUP BY 1) f
         ON f."tenant_id" = t."id"
  LEFT JOIN (SELECT "tenant_id", COUNT(*) AS "reales" FROM "tickets"
              WHERE "status" NOT IN ('DRAFT', 'TEST', 'VOIDED')
                 OR "holded_document_id" IS NOT NULL
              GROUP BY 1) v
         ON v."tenant_id" = t."id"
 WHERE (t."name" = 'PRUEBAS MIPIACE'
        OR EXISTS (SELECT 1 FROM "users" u
                    WHERE u."tenant_id" = t."id"
                      AND u."email" LIKE 'm.oyola+maestranza-ensayo%'))
   AND (f."registros" > 0 OR v."reales" > 0);
