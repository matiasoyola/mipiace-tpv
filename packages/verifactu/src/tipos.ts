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

export interface DetalleDesglose {
  Impuesto: string;
  ClaveRegimen: string;
  CalificacionOperacion: string;
  /** Porcentaje, dos decimales. */
  TipoImpositivo: string;
  /** Base imponible, dos decimales. */
  BaseImponibleOimporteNoSujeto: string;
  /** Cuota repercutida, dos decimales. */
  CuotaRepercutida: string;
}

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
