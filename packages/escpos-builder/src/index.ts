// v1.4-Impresoras-Fase-1 Lote 2 · entrada pública del builder ESC/POS.
//
// Tras el spike 2026-06-02 (POS-80 V6.16F + RawBT) confirmamos que
// rasterizar PDF satura el buffer interno de la impresora. La
// solución es generar ESC/POS plano directamente desde el backend:
//
//   - buildTicketReceipt: ticket de cobro fiscal para el cliente.
//   - buildKitchenComanda: comanda para BARRA/COCINA/SALON.
//   - buildTestPrint: print mínimo del botón "Probar" del admin.
//
// El binary devuelto va directamente a la impresora — USB con WebUSB
// API desde el TPV (Lote 3) o WIFI con sendOverTcp() desde el backend
// (Lote 4).

export {
  buildTicketReceipt,
  buildTestPrint,
  type TicketLineEscpos,
  type TicketPaymentEscpos,
  type TicketReceiptInput,
} from "./ticket.js";

export {
  buildKitchenComanda,
  type KitchenComandaInput,
  type KitchenLineEscpos,
  type KitchenSection,
} from "./kitchen.js";

export {
  buildCreditPaymentReceipt,
  type CreditReceiptInput,
} from "./credit-receipt.js";

export { sendOverTcp, type SendOverTcpOptions } from "./tcp.js";

export {
  concatBytes,
  encodePc850,
  escAlign,
  escBold,
  escCodePagePc850,
  escCut,
  escFeed,
  escInit,
  escQrCode,
  escResetSize,
  escSeparator,
  escSize,
  escText,
} from "./helpers.js";
