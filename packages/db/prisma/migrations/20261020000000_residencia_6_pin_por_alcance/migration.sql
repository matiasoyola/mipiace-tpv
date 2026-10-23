-- residencia-6 (D-68) · **EL PIN DE CUIDADO, POR ALCANCE.**
--
-- Una columna. `care_pins.pin_length`: cuántas cifras tiene el PIN que
-- hay puesto.
--
-- ── POR QUÉ HACE FALTA GUARDARLO ────────────────────────────────────
--
-- D-68 dice 4 cifras para quien tiene alcance por zona y 6 para quien
-- tiene algún rol de alcance total (DUE, médico, calidad, dirección). Eso
-- se valida al DAR el PIN, y con eso solo no basta: el caso que la
-- decisión nombra es **a una auxiliar con PIN de 4 se le asigna el rol de
-- DUE**. Nadie le ha tocado el PIN —la dirección ha tocado los roles— y
-- desde ese momento un PIN de cuatro cifras abre todo el centro.
--
-- Para saberlo hay que saber cuántas cifras tenía, y el PIN **no se puede
-- leer**: lo que hay en la tabla es argon2id y una huella HMAC, las dos
-- irreversibles. De ahí la columna.
--
-- ── Y LO QUE ESTA COLUMNA NO ES ─────────────────────────────────────
--
-- **No es nada derivado de los dígitos.** Ni una huella de los cuatro
-- primeros, ni un índice por ellos, ni un «busca por el prefijo y después
-- verifica». Eso reduciría el ataque de 1 000 000 a 10 000 + 100
-- combinaciones y anularía la decisión entera. Lo que se guarda es un
-- entero entre 4 y 8, y no acerca a nadie al PIN: quien tiene la base ya
-- ve en claro los roles de cada persona en `care_role_assignments`, y la
-- regla rol → largo es pública (está en el paquete puro).
--
-- ── LAS FILAS QUE YA ESTABAN ────────────────────────────────────────
--
-- `DEFAULT 4`, porque se pusieron cuando el único largo era cuatro. La
-- consecuencia buscada: a una DUE que ya tuviera PIN le queda **por
-- renovar** y no entra en la puerta, la sala ni la guardia hasta que
-- dirección se lo ponga de seis. Si alguna ya era de seis, se le vuelve a
-- poner y se tarda un minuto.
--
-- Es el lado seguro a propósito. El otro —asumir que estaban bien— es
-- dejar entrar con cuatro cifras a quien lo ve todo, que es exactamente
-- lo que este bloque viene a cerrar. Y hoy no hay ningún centro en
-- producción con residencia encendida: el piloto es lo que viene después
-- de este bloque.
--
-- ── EL `down` ───────────────────────────────────────────────────────
--
--   ALTER TABLE "care_pins" DROP CONSTRAINT "care_pins_pin_length_valido";
--   ALTER TABLE "care_pins" DROP COLUMN "pin_length";
--
-- Completo: la columna no sostiene ninguna otra fila y los PIN siguen
-- funcionando sin ella (se vuelve al mundo de residencia-3, donde todos
-- valen). Lo que se pierde al bajarla es saber cuál se quedó corto.
--
-- ── ADITIVA ─────────────────────────────────────────────────────────
--
-- Una columna con DEFAULT y un CHECK nuevo sobre ella. Ni un `DROP`, ni
-- un `DELETE`, ni un `UPDATE … SET` sobre datos. Un test enumera los
-- `ALTER TABLE` y comprueba que sólo nombran `care_pins`.

ALTER TABLE "care_pins"
  ADD COLUMN "pin_length" integer NOT NULL DEFAULT 4;

-- El CHECK va sobre una columna `NOT NULL`, así que no hay forma de que
-- se evalúe a NULL y pase por la escapatoria de los `BETWEEN` (la
-- lección de `care_plan_items` en residencia-2). Aun así el `IS NOT NULL`
-- va escrito: es la forma de la casa y sobrevive a que alguien haga la
-- columna opcional en una migración futura.
ALTER TABLE "care_pins"
  ADD CONSTRAINT "care_pins_pin_length_valido" CHECK (
    "pin_length" IS NOT NULL AND "pin_length" BETWEEN 4 AND 8
  );
