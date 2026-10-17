-- puesta-en-marcha · una cuenta se prueba entera antes de facturar. ADR-021.
--
-- El problema que resuelve, con fecha y nombre:
--
--   · 06-10, La Maestranza. La auditoría del AP13 cobró sobre la cuenta ya
--     activada. Las facturas C1 #000002 y #000003 no se pueden borrar
--     (`fiscal_records` es append-only) y hubo que montar una cuenta nueva
--     desde cero esa misma noche.
--   · 17-10, Sirope. Cuenta ACTIVE desde junio, sin una sola venta real.
--     Queríamos ver su TPV de verdad en un terminal físico —su catálogo, su
--     sala, su cobro— antes de la visita, y no había forma: «Probar TPV»
--     sólo funciona en DRAFT y sólo en el navegador, y cualquier cobro desde
--     un terminal emparejado habría sido la factura `C1/1` real de la
--     titular.
--
-- Migración ADITIVA y de CATÁLOGO, más un backfill de una tabla de pocas
-- filas. Dos columnas (una nullable sin default, una booleana con default
-- false), un CHECK y tres UPDATE sobre `tenants`. No crea ni borra tablas,
-- no toca `fiscal_records` y no cambia el comportamiento de nadie que hoy
-- factura: el backfill le pone a cada comercio con facturas emitidas la
-- fecha de su primera factura, que es exactamente «sigue facturando».
--
-- ── La regla que hace esto limpio ──────────────────────────────────────
--
-- ANTES DE LA PUESTA EN MARCHA EL TPV NO GENERA NINGÚN REGISTRO FISCAL.
-- Nunca. De ahí se sigue todo lo demás: el reseteo del ensayo borra tickets,
-- turnos y mesas, y no puede borrar una factura porque no la hay. La cadena
-- de `fiscal_records` sigue intocable, el trigger append-only no se toca y
-- este bloque no le abre ninguna puerta.

-- ── 1 · desde cuándo factura esta cuenta ───────────────────────────────
--
-- Nullable y SIN default. `null` NO es «dato que falta»: es el estado de
-- ensayo, y es el estado en el que nace una cuenta nueva. Por eso no lleva
-- `DEFAULT now()` ni `NOT NULL` — lo contrario de lo que pediría la
-- intuición de «toda cuenta tiene una fecha de alta».
--
-- `ADD COLUMN` nullable sin default es catálogo puro: no reescribe la tabla.

ALTER TABLE "tenants"
  ADD COLUMN "fiscal_go_live_at" TIMESTAMPTZ;

-- ── 2 · las cuentas nuestras de pruebas ────────────────────────────────
--
-- `@default(false)` y se lee `=== true`, nunca `!== false`: el mismo
-- criterio exacto que `fichajeEnabled` y `cajaEnabled`. Sólo el valor
-- explícito CONTRARIO al default cambia el comportamiento de alguien, así
-- que las cuentas de hoy quedan como estaban y las de mañana nacen siendo
-- de un cliente.

ALTER TABLE "tenants"
  ADD COLUMN "es_de_pruebas" BOOLEAN NOT NULL DEFAULT false;

-- ── 3 · el backfill, cuenta a cuenta ───────────────────────────────────
--
-- Tres reglas y ninguna adivinada. La tabla con los datos reales de
-- producción está en `docs/blocks/puesta-en-marcha-done.md`, sacada con
-- `docs/blocks/puesta-en-marcha-select.sql` (sólo lee) ANTES de desplegar.
--
-- 3.a · Quien tiene facturas emitidas FACTURA, desde la primera.
--
-- `min(fecha_expedicion)` y no `min(received_at)`: la fecha que cuenta es la
-- de la factura, no la del día que el registro llegó al servidor (un cobro
-- sin conexión puede llegar días después). Se castea a timestamptz al
-- principio del día en Europe/Madrid, que es el huso del comercio.

UPDATE "tenants" t
   SET "fiscal_go_live_at" = sub."desde"
  FROM (
    SELECT "tenant_id",
           MIN("fecha_expedicion")::timestamp AT TIME ZONE 'Europe/Madrid' AS "desde"
      FROM "fiscal_records"
     GROUP BY "tenant_id"
  ) sub
 WHERE t."id" = sub."tenant_id";

-- 3.b · Quien ya ha vendido de verdad factura desde su primera venta real.
--
-- Los comercios con Holded no tienen ni tendrán `fiscal_records` —el emisor
-- es Holded—, así que la regla 3.a no los ve. Y tienen que quedar como
-- FACTURANDO: Sole y Cachitos llevan meses emitiendo, y dejarlos en ensayo
-- les convertiría la próxima venta en un ticket `TEST` que no sube a su
-- contabilidad. Es el único renglón de este backfill que, si se olvida,
-- rompe producción.
--
-- NO lleva `AND holded_enabled = true`, aunque la tabla del bloque hable de
-- «con Holded». La pregunta que decide no es quién emite, es si este
-- comercio ha vendido de verdad alguna vez: un comercio sin Holded con
-- ventas reales y sin registros (una APK anterior a verifactu-1, por
-- ejemplo) también tiene que seguir facturando, y filtrar por el emisor lo
-- dejaría en ensayo. El error de este lado es que una cuenta de pruebas de
-- alguien acabe marcada como facturando —se arregla pidiendo una cuenta
-- nueva—; el del otro es que un cliente vendiendo deje de facturar sin que
-- nadie se entere.
--
-- «Venta real» = ni borrador ni ensayo. `VOIDED` cuenta: se cobró y se
-- anuló después, pero el día que esta cuenta empezó a facturar ya había
-- pasado.
--
-- `COALESCE(paid_at, created_at)`: un ticket anulado o un fiado sin saldar
-- pueden no tener `paid_at`.

UPDATE "tenants" t
   SET "fiscal_go_live_at" = sub."desde"
  FROM (
    SELECT "tenant_id", MIN(COALESCE("paid_at", "created_at")) AS "desde"
      FROM "tickets"
     WHERE "status" NOT IN ('DRAFT', 'TEST')
     GROUP BY "tenant_id"
  ) sub
 WHERE t."id" = sub."tenant_id"
   AND t."fiscal_go_live_at" IS NULL;

-- 3.c · Las cuentas NUESTRAS de pruebas.
--
-- PRUEBAS MIPIACE y la cuenta de ensayo de La Maestranza. Se identifican por
-- lo que las identifica de verdad: el nombre de la primera y el email del
-- propietario de la segunda (`m.oyola+maestranza-ensayo`), que es el que se
-- tecleó al crearla.
--
-- Y se COMPRUEBA antes de marcar. Si una de las dos tuviera fecha de
-- arranque después de 3.a/3.b, significaría que ha emitido facturas o que ha
-- vendido de verdad, y entonces no es una cuenta de pruebas: es un cliente
-- que alguien llamó así. La migración PARA con un mensaje en vez de marcarla
-- —el CHECK de abajo la rechazaría igual, pero diciendo «viola una
-- restricción» en lugar de qué ha pasado y qué hay que mirar.

DO $$
DECLARE
  v_conflicto TEXT;
BEGIN
  SELECT string_agg(t."name" || ' (' || t."id" || ')', ', ')
    INTO v_conflicto
    FROM "tenants" t
   WHERE t."fiscal_go_live_at" IS NOT NULL
     AND (
       t."name" = 'PRUEBAS MIPIACE'
       OR EXISTS (
         SELECT 1 FROM "users" u
          WHERE u."tenant_id" = t."id"
            AND u."email" LIKE 'm.oyola+maestranza-ensayo%'
       )
     );
  IF v_conflicto IS NOT NULL THEN
    RAISE EXCEPTION
      'PUESTA_EN_MARCHA: estas cuentas iban a marcarse como de pruebas y tienen facturas o ventas reales: %. No se adivina: comprueba la tabla del done.md antes de desplegar.',
      v_conflicto;
  END IF;
END $$;

UPDATE "tenants" t
   SET "es_de_pruebas" = true
 WHERE t."name" = 'PRUEBAS MIPIACE'
    OR EXISTS (
      SELECT 1 FROM "users" u
       WHERE u."tenant_id" = t."id"
         AND u."email" LIKE 'm.oyola+maestranza-ensayo%'
    );

-- 3.d · El resto se queda en ensayo, que es `null`, que es lo que ya tienen.
--
-- Sirope, Fouzia, La Maestranza (la real), Rosario y Thalía: cuentas sin un
-- solo registro fiscal y sin una sola venta real. No hay nada que escribir y
-- ésa es la gracia: el estado que queríamos para ellas es el que la columna
-- tiene al nacer.

-- ── 4 · una cuenta de pruebas no factura ───────────────────────────────
--
-- Las dos columnas dicen cosas distintas y hay una combinación que no
-- significa nada: una cuenta nuestra de pruebas con fecha de arranque. El
-- código la impide en `arrancarFacturacion`; esto es lo que la impide
-- DESPUÉS, el día que alguien escriba un UPDATE a mano.
--
-- El `IS NOT NULL` delante NO es decorativo. Un CHECK que evalúa a NULL
-- PASA, así que `NOT ("es_de_pruebas" AND ...)` con la fecha a NULL se
-- quedaría en NULL y la restricción no comprobaría nada. Se escribe en
-- positivo y con el `IS NOT NULL` explícito para que las tres
-- combinaciones den true o false, nunca NULL.
--
-- Se valida en el acto (sin NOT VALID): la tabla tiene una decena de filas y
-- el backfill de arriba acaba de dejarlas todas conformes.

ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_pruebas_no_facturan_ck" CHECK (
    "es_de_pruebas" = false OR "fiscal_go_live_at" IS NULL
  );

-- ── 5 · el índice que no hace falta ────────────────────────────────────
--
-- Ninguno. `fiscal_go_live_at` se lee SIEMPRE por `id` del tenant (el camino
-- de cobro ya trae la fila) y `es_de_pruebas` sólo lo mira el super-admin
-- sobre una tabla de diez filas. Un índice aquí sería ruido que hay que
-- mantener.
