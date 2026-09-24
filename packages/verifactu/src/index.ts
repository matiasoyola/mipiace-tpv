// @mipiacetpv/verifactu — el registro de facturación, su huella y su QR.
//
// Sin dependencias de Node ni del navegador: corre igual en la API y en la
// WebView de la tablet, y eso no es una comodidad. ADR-019 decide que el
// registro nace EN EL DISPOSITIVO al cobrar; si el servidor calculara la
// huella con otro código, la que verifica no sería la que generó la tablet
// —que es exactamente lo que la cadena existe para detectar.

export {
  fechaAeatDeIso,
  fechaCivilLocal,
  fechaHoraHusoAeat,
  formatNumSerieFactura,
  importeAeat,
  instanteDeFechaHoraHuso,
  isoDeFechaAeat,
  NUMERO_FACTURA_DIGITOS,
  porcentajeAeat,
} from "./formato.js";

export {
  buildHuellaInputAlta,
  buildHuellaInputAnulacion,
  hasWebCrypto,
  huellaCoincide,
  huellaSha256,
  TIPO_HUELLA_SHA256,
  WebCryptoNoDisponibleError,
} from "./huella.js";
export type { HuellaAltaInput, HuellaAnulacionInput } from "./huella.js";

export {
  buildQrUrl,
  LEYENDA_ENCIMA_DEL_QR,
  LEYENDA_VERIFACTU,
  LEYENDA_VERIFACTU_LARGA,
  NUM_SERIE_MAX_LENGTH,
  QR_BASE_URL,
  QR_LADO_MAX_MM,
  QR_LADO_MIN_MM,
  QR_MARGEN_BLANCO_MIN_MM,
  QR_MARGEN_BLANCO_RECOMENDADO_MM,
  QR_NIVEL_CORRECCION,
  serieEsValidaParaQr,
} from "./qr.js";
export type { EntornoAeat, QrFacturaInput } from "./qr.js";

export {
  comprobarAntesDeGenerar,
  siguienteChainIndex,
  siguienteNumero,
  TOLERANCIA_RELOJ_MS,
} from "./cadena.js";
export type {
  AnomaliaCadena,
  AnomaliaCadenaCodigo,
  CabezaDeCadena,
  ComprobacionPrevia,
} from "./cadena.js";

export {
  buildSistemaInformatico,
  ID_SISTEMA_INFORMATICO,
  INDICADOR_MULTIPLES_OT,
  LIMITES_SISTEMA_INFORMATICO,
  NOMBRE_SISTEMA_INFORMATICO,
  PRODUCTOR_NIF,
  PRODUCTOR_NOMBRE_RAZON,
  TIPO_USO_POSIBLE_MULTI_OT,
  TIPO_USO_POSIBLE_SOLO_VERIFACTU,
  validarConstantesDelProductor,
} from "./productor.js";
export type { SistemaInformatico } from "./productor.js";

export {
  buildRegistroAlta,
  buildRegistroAnulacion,
  descripcionOperacionPorVertical,
  GENERADOR_PRODUCTOR,
} from "./registro.js";
export type {
  BucketDesglose,
  RegistroAltaParams,
  RegistroAnulacionParams,
  RegistroGenerado,
} from "./registro.js";

export {
  CALIFICACION_OPERACION,
  CLAVE_REGIMEN,
  GENERADO_POR,
  ID_VERSION,
  IMPUESTO,
  LIMITES_REGISTRO,
  MAX_DETALLE_DESGLOSE,
  TIPO_FACTURA,
} from "./tipos.js";
export type {
  DetalleDesglose,
  Encadenamiento,
  IDFacturaAlta,
  IDFacturaAnulada,
  RegistroAlta,
  RegistroAnulacion,
  RegistroAnterior,
} from "./tipos.js";
