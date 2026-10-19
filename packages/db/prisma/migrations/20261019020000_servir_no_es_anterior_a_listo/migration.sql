-- hierro-sirope (A) · LA MITAD QUE FALTABA DEL CHECK DE CRONOLOGÍA.
--
-- `kitchen_orders_cronologia` (kds-1) dice dos cosas:
--
--     ready_at  IS NULL OR ready_at >= sent_at
--     served_at IS NULL OR ready_at IS NOT NULL
--
-- O sea: no se puede estar listo antes de enviado, y no se puede estar
-- servido sin estar listo. Lo que NO dice —y el comentario del bloque
-- daba por hecho que sí— es que **servido no pueda ser anterior a
-- listo**. Hoy `served_at = ready_at − 1 ms` entra en la tabla sin que
-- nada se queje, y el tiempo en el pase del informe del dueño sale
-- negativo.
--
-- Importa ahora porque la regla de la comanda huérfana escribe
-- `served_at` a partir de `ready_at` en tres sitios
-- (`marcarListaYServirSiHuerfana`, el barrido del corte de día y el
-- script de limpieza). Que el motor lo haga cumplir es lo que convierte
-- «se usa el mismo instante» en una invariante en vez de en una
-- costumbre: el sabotaje «`servedAt` un ms antes que `readyAt`» tiene que
-- poder ponerse rojo.
--
-- `CREATE OR REPLACE` no existe para un CHECK: se borra y se vuelve a
-- crear, partiendo de la ÚLTIMA definición (la de kds-1, que es la única)
-- y añadiéndole la tercera condición. Las dos de antes se conservan tal
-- cual.
--
-- Antes de añadirla se cierran las filas que ya la violan, si las hay:
-- una reparación mínima (servir no puede ser anterior a estar listo, así
-- que se iguala a `ready_at`) en vez de un `NOT VALID` que dejaría la
-- invariante a medias para siempre.
UPDATE "kitchen_orders"
   SET "served_at" = "ready_at"
 WHERE "served_at" IS NOT NULL
   AND "ready_at" IS NOT NULL
   AND "served_at" < "ready_at";

ALTER TABLE "kitchen_orders"
    DROP CONSTRAINT "kitchen_orders_cronologia";

ALTER TABLE "kitchen_orders"
    ADD CONSTRAINT "kitchen_orders_cronologia"
    CHECK (
        ("ready_at"  IS NULL OR "ready_at"  >= "sent_at")
        AND ("served_at" IS NULL OR "ready_at" IS NOT NULL)
        AND ("served_at" IS NULL OR "ready_at" IS NULL OR "served_at" >= "ready_at")
    );
