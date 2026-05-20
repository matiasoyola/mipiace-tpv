-- v1.2-Lite Lote 3.A · normalizar tags a lowercase.
--
-- Tras desplegar v1.1 con Thalia descubrimos que Holded entrega los
-- tags tal cual el cliente los escribió. En la cuenta de Thalia
-- aparecen "Papelería" y "papeleria" como chips distintos en el TPV
-- porque el sync los persiste preservando casing. Decisión: normalizar
-- a lowercase en BD y capitalizar al renderizar en el TPV.
--
-- Aditivo + idempotente: lowercase es no-op sobre filas ya en
-- lowercase. unnest + array_agg con DISTINCT colapsa los duplicados
-- que aparezcan tras lowercasear (caso real Thalia). Si tags está
-- vacío, ARRAY[]::text[] mantiene el valor sin tocar el default.

UPDATE "products"
SET "tags" = (
  SELECT COALESCE(array_agg(DISTINCT lower(t) ORDER BY lower(t)), ARRAY[]::text[])
  FROM unnest("tags") AS t
  WHERE length(trim(t)) > 0
)
WHERE cardinality("tags") > 0;
