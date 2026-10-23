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
// auditoria-sirope (#25) + hierro-sirope (E) · el título de una comanda,
// entero para el papel y el aviso, corto para la pantalla de cocina.
export * from "./comanda-titulo.js";
// hierro-sirope (G) · «C2·000001»: de qué caja es este número, cuando la
// tienda tiene más de una.
export * from "./caja-en-el-numero.js";
export {
  TicketDocumentSchema,
  TicketLineSchema,
  assertTicketDocument,
} from "./schema.js";
