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
// clinica-7 · el contrato de encargado del tratamiento (art. 28 RGPD).
// Aquí por lo mismo que los dos de clinica-4: el folio A4 y sus
// primitivas ya están, y el texto vive versionado en su propio paquete.
export {
  renderContratoEncargadoPdf,
  type ApartadoParaPdf,
  type ContratoEncargadoParaPdf,
} from "./contrato-encargado.js";
export {
  renderInformeClinicoPdf,
  type InformeParaPdf,
  type SeccionParaPdf,
} from "./informe-clinico.js";
// calidad-1 (D-75) · el Plan de Acciones Correctivas y el informe de no
// conformidades por periodo. Aquí por lo mismo que los tres de arriba:
// el folio A4 y sus primitivas ya están.
export {
  renderPacPdf,
  type AccionParaPac,
  type NcParaPac,
  type PacParaPdf,
  type VerificacionParaPac,
} from "./pac.js";
