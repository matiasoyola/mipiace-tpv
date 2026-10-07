// Los tipos del registro de facturación, con los nombres EXACTOS del
// diseño de registro de la AEAT (`DsRegistroVeriFactu.xlsx`, hojas
// «2)D. Registro Facturación Alta» y «3)D. Reg. Facturación Anulación»).
//
// Nombres en PascalCase y en castellano a propósito, contra el estilo del
// resto del repo: este objeto es lo que V2 serializará a XML tal cual, y
// una capa de traducción en medio sería un sitio más donde el registro
// puede cambiar entre que se genera y que se remite — exactamente lo que
// la FAQ §5 prohíbe.

import type { SistemaInformatico } from "./productor.js";

/** Lista L15 del anexo. Versión actual del esquema. */
export const ID_VERSION = "1.0";

/** Lista L2 · tipo de factura. */
export const TIPO_FACTURA = {
  /** Factura (art. 6, 7.2 y 7.3 del RD 1619/2012). */
  COMPLETA: "F1",
  /** Factura simplificada y facturas sin identificación del destinatario
   *  art. 6.1.d) RD 1619/2012. Es la que emite el TPV. */
  SIMPLIFICADA: "F2",
} as const;

/** Lista L1 · impuesto de aplicación. */
export const IMPUESTO = {
  IVA: "01",
  IPSI: "02",
  IGIC: "03",
  OTROS: "05",
} as const;

/** Lista L8A · clave de régimen cuando el impuesto es el IVA. */
export const CLAVE_REGIMEN = {
  GENERAL: "01",
} as const;

/** Lista L9 · calificación de la operación. */
export const CALIFICACION_OPERACION = {
  /** Sujeta y no exenta, sin inversión del sujeto pasivo. */
  SUJETA_NO_EXENTA: "S1",
} as const;

/** Lista L10 · causa de exención.
 *
 *  Aquí sólo están las que este SIF puede declarar con
 *  `ClaveRegimen = "01"` (régimen general): las validaciones §15.5 dicen
 *  que «si (…) ClaveRegimen es igual a "01", no pueden marcarse los
 *  valores de OperacionExenta "E2" y "E3"». Los seis códigos de la lista
 *  y sus descripciones literales viven en
 *  `@mipiacetpv/ticket-model` (`exencion.ts`), que es de donde sale el
 *  dato; aquí está lo que el registro admite. */
export const OPERACION_EXENTA = {
  /** Exenta por el artículo 20. La de los servicios sanitarios
   *  (art. 20.Uno.3º de la Ley 37/1992). */
  ART_20: "E1",
  /** Exenta por los artículos 23 y 24. */
  ART_23_24: "E4",
  /** Exenta por el artículo 25. */
  ART_25: "E5",
  /** Exenta por otros. */
  OTROS: "E6",
} as const;

/** Las que §15.5 prohíbe con `ClaveRegimen = "01"`. */
export const OPERACION_EXENTA_PROHIBIDA_REGIMEN_GENERAL = ["E2", "E3"] as const;

/** Lista L16 · quién generó materialmente el registro de anulación. */
export const GENERADO_POR = {
  /** Expedidor: el obligado a expedir la factura anulada. */
  EXPEDIDOR: "E",
} as const;

export interface IDFacturaAlta {
  IDEmisorFactura: string;
  NumSerieFactura: string;
  /** `dd-mm-yyyy`. */
  FechaExpedicionFactura: string;
}

export interface IDFacturaAnulada {
  IDEmisorFacturaAnulada: string;
  NumSerieFacturaAnulada: string;
  /** `dd-mm-yyyy`. */
  FechaExpedicionFacturaAnulada: string;
}

export interface RegistroAnterior {
  IDEmisorFactura: string;
  NumSerieFactura: string;
  /** `dd-mm-yyyy`. */
  FechaExpedicionFactura: string;
  Huella: string;
}

export type Encadenamiento =
  | { PrimerRegistro: "S" }
  | { RegistroAnterior: RegistroAnterior };

// bloque iva-exento-sanitario · UN TRAMO ES SUJETO **O** EXENTO, Y EL
// TIPO LO HACE IMPOSIBLE DE MEZCLAR.
//
// `DetalleDesglose` deja de ser una interfaz y pasa a ser una UNIÓN de dos
// formas que no comparten ni un campo opcional. No es gusto por los tipos:
// es la única manera de que «declarar un E1 con TipoImpositivo» no compile.
//
// Las tres fuentes de la AEAT que lo dicen, y las tres dicen lo mismo:
//
//   1. **Diseño de registro** (`DsRegistroVeriFactu.xlsx`, hoja
//      `2)D. Registro Facturación Alta`): `CalificacionOperacion¹` y
//      `OperacionExenta¹` van con el fondo coloreado que la hoja
//      `7)Leyenda` define como «Campo de selección (alternativo)», y los
//      dos con el superíndice 1 de «Campo obligatorio» — exactamente uno.
//   2. **`SuministroInformacion.xsd`**, `DetalleType`: un `<choice>` entre
//      los dos elementos, sin `minOccurs`, o sea obligatorio elegir.
//   3. **Validaciones v1.2.2 §15.5**: «Si el campo OperacionExenta está
//      cumplimentado no se pueden informar ninguno de estos campos:
//      TipoImpositivo, CuotaRepercutida, TipoRecargoEquivalencia y
//      CuotaRecargoEquivalencia.»
//
// Con una sola interfaz de campos opcionales, un `E1` con
// `TipoImpositivo: "0.00"` compilaría, pasaría los tests que miran
// importes —porque los importes cuadran— y lo rechazaría la AEAT meses
// después, con las facturas ya entregadas.

/** La parte común: el impuesto, el régimen y el importe. */
interface DetalleDesgloseBase {
  Impuesto: string;
  ClaveRegimen: string;
  /** Base imponible del tramo sujeto, o IMPORTE de la operación exenta.
   *  Es el mismo campo del registro para las dos cosas: «Magnitud
   *  dineraria sobre la que se aplica el tipo impositivo / Importe no
   *  sujeto» (diseño de registro). Dos decimales. */
  BaseImponibleOimporteNoSujeto: string;
}

/** Tramo SUJETO y no exento. */
export interface DetalleDesgloseSujeta extends DetalleDesgloseBase {
  CalificacionOperacion: string;
  /** Porcentaje, dos decimales. Obligatorio con `S1` (§15.7). */
  TipoImpositivo: string;
  /** Cuota repercutida, dos decimales. Obligatoria con `S1` (§15.7). */
  CuotaRepercutida: string;
  OperacionExenta?: never;
}

/** Tramo EXENTO. Sin calificación, sin tipo y sin cuota. */
export interface DetalleDesgloseExenta extends DetalleDesgloseBase {
  /** Causa de la lista L10. */
  OperacionExenta: string;
  CalificacionOperacion?: never;
  TipoImpositivo?: never;
  CuotaRepercutida?: never;
}

export type DetalleDesglose = DetalleDesgloseSujeta | DetalleDesgloseExenta;

/** Máximo del diseño de registro: `DetalleDesglose (1-12)`.
 *
 *  Doce tipos impositivos distintos en un ticket de peluquería no pasan;
 *  el límite está aquí para que, si pasara, se vea al generar y no al
 *  remitir seis meses después. */
export const MAX_DETALLE_DESGLOSE = 12;

export interface RegistroAlta {
  IDVersion: string;
  IDFactura: IDFacturaAlta;
  NombreRazonEmisor: string;
  TipoFactura: string;
  DescripcionOperacion: string;
  Desglose: { DetalleDesglose: DetalleDesglose[] };
  CuotaTotal: string;
  ImporteTotal: string;
  Encadenamiento: Encadenamiento;
  SistemaInformatico: SistemaInformatico;
  /** `YYYY-MM-DDThh:mm:ss±hh:mm`. */
  FechaHoraHusoGenRegistro: string;
  TipoHuella: string;
  Huella: string;
}

export interface RegistroAnulacion {
  IDVersion: string;
  IDFactura: IDFacturaAnulada;
  /** `S` cuando se anula un alta que nunca llegó a existir para la AEAT.
   *  Se omite en la anulación normal. */
  SinRegistroPrevio?: "S";
  GeneradoPor: string;
  Generador: { NombreRazon: string; NIF: string };
  Encadenamiento: Encadenamiento;
  SistemaInformatico: SistemaInformatico;
  FechaHoraHusoGenRegistro: string;
  TipoHuella: string;
  Huella: string;
}

/** Longitudes del diseño de registro que sí se pueden desbordar con datos
 *  reales (una razón social larga, un ticket con muchas líneas). */
export const LIMITES_REGISTRO = {
  NumSerieFactura: 60,
  NombreRazonEmisor: 120,
  DescripcionOperacion: 500,
} as const;
