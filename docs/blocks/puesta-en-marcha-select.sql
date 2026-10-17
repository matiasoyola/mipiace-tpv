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
--   3.b  tiene ventas reales           → factura desde su primera venta
--   3.c  cuenta nuestra de pruebas     → en ensayo, y marcada
--   3.d  ni registros ni ventas reales → en ensayo
--
-- Si alguna fila sale con `regla = '¿?'`, PARA: esa cuenta no encaja en
-- ninguna regla y no se adivina. La tabla que salga va al done.md tal cual.

WITH primera_factura AS (
  SELECT "tenant_id", MIN("fecha_expedicion") AS "fecha", COUNT(*) AS "registros"
    FROM "fiscal_records"
   GROUP BY "tenant_id"
),
ventas AS (
  SELECT "tenant_id",
         COUNT(*) FILTER (WHERE "status" NOT IN ('DRAFT', 'TEST'))  AS "reales",
         COUNT(*) FILTER (WHERE "status" = 'TEST')                  AS "de_ensayo",
         COUNT(*) FILTER (WHERE "status" = 'DRAFT')                 AS "borradores",
         MIN(COALESCE("paid_at", "created_at"))
           FILTER (WHERE "status" NOT IN ('DRAFT', 'TEST'))         AS "primera_real"
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
  COALESCE(v."de_ensayo", 0)                            AS "tickets_test",
  COALESCE(v."borradores", 0)                           AS "borradores",
  CASE
    WHEN f."fecha" IS NOT NULL THEN '3.a'
    WHEN v."primera_real" IS NOT NULL THEN '3.b'
    WHEN p."id" IS NOT NULL THEN '3.c'
    WHEN f."fecha" IS NULL AND v."primera_real" IS NULL THEN '3.d'
    ELSE '¿?'
  END                                                   AS "regla",
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

-- Y la comprobación que hace parar la migración: ninguna cuenta puede ser a
-- la vez «nuestra de pruebas» y tener facturas o ventas reales.

SELECT t."name", COALESCE(f."registros", 0) AS "registros", COALESCE(v."reales", 0) AS "ventas_reales"
  FROM "tenants" t
  LEFT JOIN (SELECT "tenant_id", COUNT(*) AS "registros" FROM "fiscal_records" GROUP BY 1) f
         ON f."tenant_id" = t."id"
  LEFT JOIN (SELECT "tenant_id", COUNT(*) AS "reales" FROM "tickets"
              WHERE "status" NOT IN ('DRAFT', 'TEST') GROUP BY 1) v
         ON v."tenant_id" = t."id"
 WHERE (t."name" = 'PRUEBAS MIPIACE'
        OR EXISTS (SELECT 1 FROM "users" u
                    WHERE u."tenant_id" = t."id"
                      AND u."email" LIKE 'm.oyola+maestranza-ensayo%'))
   AND (f."registros" > 0 OR v."reales" > 0);
