-- holded-desconectar · un comercio vivo deja Holded sin perder nada. ADR-020.
--
-- Hasta hoy `PATCH /super-admin/tenants/:id` con `holdedEnabled: false`
-- devolvía `409 HOLDED_ENABLED_HAS_KEY` a propósito (ADR-017 §4.1): apagar
-- Holded con la clave puesta dejaría ventas sin subir y documentos a medias.
-- La guarda era correcta y sigue estando; lo que faltaba era el CAMINO.
-- Este bloque lo abre, y aquí está lo que ese camino necesita de la base.
--
-- Migración ADITIVA y de CATÁLOGO. Una columna nullable sin default, un
-- CHECK sobre una tabla de decenas de filas, y un trigger BEFORE INSERT.
-- No reescribe ninguna tabla, no toca ni una fila y no cambia el
-- comportamiento de ningún comercio de hoy: `holded_disconnected_at` nace
-- NULL en los seis tenants que hay y el trigger es un no-op mientras lo sea.
--
-- MEDIDO sobre la copia real de producción del 24-09-2026 restaurada en
-- `mipiacetpv_ensayo_holded` (contenedor `mipiacetpv-postgres`, PG 16.13):
-- las tres sentencias juntas tardan milisegundos y `pg_stat_user_tables`
-- sigue con `n_tup_upd = 0` en `tenants` y en `holded_uploads`.

-- ── 1 · la fecha del corte ─────────────────────────────────────────────
--
-- Nullable y SIN default: no hay backfill que hacer porque ningún comercio
-- ha dejado Holded todavía, y la ausencia de dato es exactamente lo que
-- queremos decir. `ADD COLUMN` nullable sin default es catálogo puro — ni
-- siquiera usa `attmissingval`, simplemente no hay nada que rellenar.
--
-- Por qué una columna y no deducirlo: ver la nota larga del schema. En una
-- frase, `holded_enabled = false` lo contestan igual el comercio que nació
-- sin Holded y el que lo dejó con 270 facturas emitidas detrás, y el asesor
-- necesita distinguirlos para saber quién emitió cada abono.

ALTER TABLE "tenants"
  ADD COLUMN "holded_disconnected_at" TIMESTAMPTZ;

-- ── 2 · no se puede estar a medio dejar ────────────────────────────────
--
-- El corte son TRES cosas a la vez —interruptor apagado, clave borrada,
-- fecha puesta— y las tres van en la misma transacción. El CHECK es lo que
-- hace que no puedan separarse DESPUÉS: un `UPDATE` que reencendiera
-- `holded_enabled` o que volviera a meter una clave sin limpiar la fecha
-- rebota en la base, no en una revisión de código.
--
-- Esto es lo que sostiene el criterio 3 del bloque («Holded se calla de
-- verdad») por la vía barata: todos los caminos que llaman a Holded ya
-- comprobaban `holded_api_key_ciphertext`, y aquí queda garantizado que un
-- comercio con la fecha puesta no puede tener clave. Los guards explícitos
-- que se añaden en el código son la primera puerta y ésta la última.
--
-- Se valida en el acto (sin NOT VALID): la tabla tiene seis filas y todas
-- cumplen trivialmente con la fecha a NULL.

ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_holded_desconectado_ck" CHECK (
    "holded_disconnected_at" IS NULL
    OR ("holded_enabled" = false AND "holded_api_key_ciphertext" IS NULL)
  );

-- ── 3 · ninguna subida nace viva después del corte ─────────────────────
--
-- El gate del encolado (`tickets/holded-upload-gate.ts`) ya impide crear la
-- fila: sin destino READY no se crea nada. Esto es la SEGUNDA puerta, para
-- el día en que alguien añada un quinto camino de cobro y se olvide del
-- gate — ya pasó: `catalogo-local` encontró que mesa y devolución no
-- pasaban por él.
--
-- REESCRIBE, NO LANZA, y ésa es la decisión de este trigger.
--
-- `holded_uploads` se escribe DENTRO de la transacción que cobra
-- (`tickets/routes.ts`, checkout de mesa, devolución, saldo de fiado). Un
-- `RAISE EXCEPTION` aquí tumbaría la venta de un comercio con el cliente
-- delante para proteger una invariante NUESTRA. Eso no se paga: cobrar
-- siempre se puede. Es el mismo criterio con el que `comprobarGateFiscal`
-- DESCARTA el registro que manda el modo prueba en vez de devolver 409
-- (V1-verifactu addendum 1b).
--
-- Y `SKIPPED` no es un estado inventado para esto: existe desde
-- v1.5-consistencia-B §3.a y significa literalmente «terminal, esto NUNCA
-- debe subirse». El sweeper de huérfanos sólo mira `PENDING`, así que una
-- fila SKIPPED no se re-encola nunca — que es justo el bucle que aquel
-- bloque vino a cortar (visto en prod el 11-06-2026: `rescued: 26`
-- constante).
--
-- Sólo BEFORE INSERT. Un UPDATE de una fila anterior al corte tiene que
-- poder seguir su curso: la acción no arranca mientras queden subidas en
-- vuelo, así que lo que exista después del corte es histórico cerrado y
-- marcarlo sería reescribir el pasado.

CREATE OR REPLACE FUNCTION mipiacetpv_holded_upload_tras_el_corte()
RETURNS TRIGGER AS $$
DECLARE
  v_desconectado TIMESTAMPTZ;
BEGIN
  SELECT "holded_disconnected_at" INTO v_desconectado
  FROM "tenants" WHERE "id" = NEW."tenant_id";

  IF v_desconectado IS NULL THEN
    RETURN NEW;
  END IF;

  -- Lo que ya nace terminal se respeta tal cual: el refund de un ticket
  -- TEST nace SKIPPED con su propio motivo y no hay que pisárselo.
  IF NEW."status" IN ('DONE', 'SKIPPED') THEN
    RETURN NEW;
  END IF;

  NEW."status" := 'SKIPPED';
  NEW."last_error" := jsonb_build_object(
    'skipped', 'holded_desconectado',
    'holdedDisconnectedAt', to_char(v_desconectado, 'YYYY-MM-DD"T"HH24:MI:SS.MSOF')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "holded_uploads_no_tras_el_corte" ON "holded_uploads";
CREATE TRIGGER "holded_uploads_no_tras_el_corte"
  BEFORE INSERT ON "holded_uploads"
  FOR EACH ROW
  EXECUTE FUNCTION mipiacetpv_holded_upload_tras_el_corte();
