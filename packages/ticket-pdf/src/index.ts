export { renderTicketPdf, type RenderTicketPdfOptions } from "./render.js";
export {
  renderKitchenTicketPdf,
  type KitchenSection,
  type KitchenLine,
  type KitchenTicketDocument,
} from "./kitchen.js";
export { renderDeclaracionResponsablePdf } from "./declaracion-responsable.js";
// clinica-4 · los dos documentos clínicos. Viven aquí y no en un paquete
// nuevo por lo mismo que la declaración responsable: aquí ya están
// `pdf-lib` y el patrón de «medir primero, pintar después», y las
// primitivas del folio A4 (`documento-a4.ts`) son las mismas para los tres.
export {
  renderConsentimientoPdf,
  type ConsentimientoParaPdf,
} from "./consentimiento.js";
export {
  renderInformeClinicoPdf,
  type InformeParaPdf,
  type SeccionParaPdf,
} from "./informe-clinico.js";
