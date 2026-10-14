// kds-1-cocina · ADAPTADOR.
//
// Este fichero era el envío de comandas (v1.4-Impresoras-Fase-1 Lote 4):
// agrupaba TODAS las líneas del DRAFT por sección y mandaba la mesa
// entera a cada impresora en cada envío. El motor vive ahora en
// `kitchen/envio.ts`, que manda la DIFERENCIA y es idempotente.
//
// Lo que queda aquí es la firma que las dos URL del TPV ya usaban
// (`/send-to-kitchen` y `/send-to-kitchen/escpos`), para que el cambio de
// motor no sea además un cambio de contrato. Las dos URL siguen siendo
// alias de lo mismo.
//
// LO QUE CAMBIA EN LA RESPUESTA, dicho aquí porque el TPV lo lee:
//
//   · desaparece el **409 PRINTER_NOT_CONFIGURED_FOR_SECTION**. Una
//     sección sin destino se marca como enviada y el envío sigue
//     (decisión 2). Era el fallo que en La Maestranza —BARRA sin
//     impresora— impedía enviar una mesa con una caña.
//   · cada sección trae `destino` (`PANTALLA` | `IMPRESORA` |
//     `PANTALLA_E_IMPRESORA` | `NINGUNO`) y `units`, además del
//     `lineCount` que ya traía.
//   · aparece `nothingNew`: un «Reenviar» que no cambió nada no gasta
//     número de comanda ni inventa una tarjeta vacía en la pantalla.
//   · aparece `replayed`: esto es la respuesta guardada de un envío
//     anterior con el mismo `clientSendId`.

export {
  enviarComanda as dispatchKitchenTicket,
  notasDeModificadores,
  type Envio as DispatchResult,
  type EnvioCtx as DispatchCtx,
  type EnvioOpts as DispatchOpts,
  type CuerpoEnvio,
  type SeccionEnviada,
  type TipoDestino,
} from "../kitchen/envio.js";
