-- hotfix-fichaje-medianoche · «salida olvidada» se decide por DURACIÓN, no
-- por calendario.
--
-- Hasta hoy un tramo abierto era una salida olvidada cuando el día local de
-- la entrada no era el día local de ahora. Quien entra a las 20:00 y sale a
-- la 01:00 no podía fichar la salida: se le trataba como si se le hubiera
-- olvidado ayer y tenía que corregirla con motivo. En una residencia es
-- CADA turno de noche; en un bar, cada cierre pasada la medianoche.
--
-- A partir de aquí lo decide el tiempo que lleva abierto: por encima del
-- máximo del tenant es una salida olvidada, y por debajo se ficha con un
-- toque normal, sea el día que sea.
--
-- 16 de serie: cubre un turno de noche de 10 h, una jornada partida larga y
-- un cierre de bar, y deja fuera «entré ayer a las 9 y no salí» (que a las
-- 10 de la mañana siguiente lleva 25 h). Un tenant que no toque la columna
-- se comporta como el default, que es lo que se despliega.
--
-- El rango va en un CHECK de la BASE y no sólo en el schema de la ruta: es
-- la última línea contra un 0 (que convertiría cada fichaje en olvidado en
-- cuanto pasara un segundo) o un 200 (que no cerraría nunca una olvidada).
ALTER TABLE "tenants"
    ADD COLUMN "fichaje_max_open_hours" INTEGER NOT NULL DEFAULT 16;

-- El `IS NOT NULL` delante va aunque la columna sea NOT NULL: un CHECK que
-- evalúa a NULL PASA, y si mañana alguien la hiciera nullable este CHECK
-- dejaría de proteger nada sin que lo dijera ningún error.
ALTER TABLE "tenants"
    ADD CONSTRAINT "tenants_fichaje_max_open_hours_check"
    CHECK (
        "fichaje_max_open_hours" IS NOT NULL
        AND "fichaje_max_open_hours" BETWEEN 8 AND 24
    );
