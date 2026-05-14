-- B-Print fase 1 · Comunicación de ticket por tienda
--
-- `ticket_delivery` es un jsonb por tienda con la config de cómo se
-- entrega el ticket digital al cliente:
--
--   {
--     emailAutoIfCustomerHasEmail: boolean,
--     showQrButton: boolean,
--     showDownloadButton: boolean,
--     showViewButton: boolean,
--     emailSubject: string,
--     emailBody: string,
--     qrCaption: string
--   }
--
-- Defaults sensatos al crear store (todo true, plantillas en español).
-- El admin lo edita vía `PATCH /admin/stores/:id/ticket-delivery`
-- (requireOwner). El TPV lo lee al cobrar para mostrar los botones
-- correctos en la pantalla post-cobro.

ALTER TABLE "stores" ADD COLUMN "ticket_delivery" JSONB;

-- Seed para tiendas existentes — preservamos el comportamiento default
-- ("todo activo") aunque el OWNER aún no haya tocado la sección.
UPDATE "stores"
SET "ticket_delivery" = jsonb_build_object(
  'emailAutoIfCustomerHasEmail', true,
  'showQrButton', true,
  'showDownloadButton', true,
  'showViewButton', true,
  'emailSubject', 'Tu ticket de {tienda} · {numero}',
  'emailBody', E'Hola,\n\nAdjuntamos tu ticket en PDF. ¡Gracias por tu visita!\n\n— {tienda}',
  'qrCaption', 'Escanea para descargar tu ticket'
)
WHERE "ticket_delivery" IS NULL;
