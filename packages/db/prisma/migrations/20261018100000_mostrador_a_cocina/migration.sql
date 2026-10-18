-- auditoria-sirope (#25) · el número de la venta de mostrador.
--
-- Sirope trabaja casi todo en mostrador y hasta hoy «Enviar» no mandaba
-- nada a cocina: sin mesa, el TPV salía de la función en seco. Cuando una
-- venta de mostrador sí llega a la pantalla de cocina hace falta
-- titularla con algo, y «mesa NULL» se pintaba como «#1», que es el nº de
-- comanda de ESE ticket y se repite en cada venta de la mañana.
--
-- `counter_number` es ese título: correlativo por día y por caja. No
-- sirve `internal_number` —serie fiscal, se asigna al cobrar y llega a
-- cinco cifras— ni `last_sent_revision` —la 1ª/2ª comanda del mismo
-- ticket—.
--
-- NULL en todo lo demás, que es el 100 % de lo que ya existe: una
-- columna nueva anulable no toca ninguna fila.
--
-- ── down ──────────────────────────────────────────────────────────────
--
--   ALTER TABLE "tickets" DROP COLUMN "counter_number";
--
-- Se pierde el título de las comandas de mostrador del día (la tarjeta
-- vuelve a decir «#1»), y nada más: no hay dinero, ni serie, ni registro
-- fiscal colgando de esta columna. El índice se va con ella.

ALTER TABLE "tickets" ADD COLUMN "counter_number" INTEGER;

-- El correlativo se calcula con un MAX por caja y día sobre los tickets
-- de mostrador, que son pocos pero se consulta en cada envío. El índice
-- parcial deja fuera el 100 % de los tickets normales.
CREATE INDEX "tickets_counter_number_idx"
  ON "tickets" ("register_id", "created_at")
  WHERE "counter_number" IS NOT NULL;
