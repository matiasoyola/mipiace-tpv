// clinica-4 · el paquete de los consentimientos. PURO: ni Prisma, ni
// Fastify, ni React, ni reloj, ni `node:crypto`.
//
// Lo de crypto merece la línea: la huella SHA-256 la calcula quien tiene
// el fichero delante (la API, con `node:crypto`), no este paquete. Lo que
// este paquete garantiza es que **el texto que se hashea es uno solo**
// (`textoCanonico`), que es la mitad que de verdad hace falta.

export {
  PLANTILLAS_DE_SERVICIO,
  PLANTILLAS_IDS,
  PLANTILLAS_VIGENTES,
  PLANTILLA_DE_FOTOS,
  plantillaDe,
  plantillaVigente,
  textoCanonico,
  type DisparadorDePlantilla,
  type PlantillaDeConsentimiento,
  type PlantillaId,
} from "./plantillas.js";

export {
  consentimientoVigente,
  consentimientosQueFaltan,
  estaRevocada,
  estadoDeUnaPlantilla,
  type EstadoDeUnaPlantilla,
  type FilaFirmada,
} from "./vigencia.js";

export {
  CLASES_DE_FIRMANTE,
  firmanteCompleto,
  informantePuedeInformar,
  type ClaseDeFirmante,
  type Firmante,
  type MotivoFirmanteInvalido,
  type MotivoInformanteInvalido,
  type Veredicto,
} from "./firmante.js";
