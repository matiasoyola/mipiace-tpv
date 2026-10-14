// clinica-7 · `@mipiacetpv/contrato-encargado`
//
// El contrato de encargado del tratamiento (art. 28 RGPD) y el estado del
// módulo clínico que de él se deriva. **Puro**: sin Prisma, sin Fastify,
// sin React y sin `node:crypto`.
//
// Paquete propio y no una carpeta de `clinica-sesion` por la misma razón
// que `consentimientos` salió del paquete de la sesión: lo usan las dos
// orillas. La API decide con él si una ruta contesta, el TPV pinta con él
// la pantalla de aceptación y la banda, y el panel del propietario enseña
// con él la versión vigente. Una copia por lado sería una pantalla
// diciendo que se puede escribir sobre algo que el servidor considera
// revocado.
//
// La huella del texto la calcula quien tiene el fichero delante (la API),
// igual que en `consentimientos`: lo que el paquete garantiza es que **el
// texto que se hashea es uno solo**.

export {
  CONTRATO_VIGENTE,
  VERSION_VIGENTE,
  contratoDe,
  textoCanonico,
  versionesConocidas,
  type ApartadoDelContrato,
  type VersionDelContrato,
} from "./contrato.js";

export {
  AVISO_SOLO_LA_DUENA,
  BANDA_SOLO_LECTURA,
  CODIGO_CONTRATO_NO_VIGENTE,
  CODIGO_SOLO_LA_DUENA,
  MENSAJE_CONTRATO_NO_VIGENTE,
  admiteNotasEnCita,
  enseñaBandaDeSoloLectura,
  estadoDelModuloClinico,
  permiteEscribirHistoria,
  permiteLeerHistoria,
  type EntradaDelEstado,
  type EstadoDelModuloClinico,
  type FilaDelContrato,
  type NombreDelEstado,
} from "./estado.js";
