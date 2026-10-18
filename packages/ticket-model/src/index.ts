export * from "./types.js";
export * from "./build.js";
export * from "./payments.js";
export * from "./precios.js";
export * from "./rounding.js";
export * from "./desglose.js";
export * from "./exencion.js";
// kds-1-cocina · los 14 alérgenos del anexo II, compartidos por el TPV, el
// panel, la pantalla de cocina y el papel de la comanda.
export * from "./alergenos.js";
export * from "./lineas.js";
// auditoria-sirope (#17) · la regla de «¿es devolvible?», compartida por el
// TPV, el servidor y el panel.
export * from "./devolucion.js";
export {
  TicketDocumentSchema,
  TicketLineSchema,
  assertTicketDocument,
} from "./schema.js";
