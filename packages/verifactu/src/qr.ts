// El código QR tributario y la URL del servicio de cotejo.
//
// Fuente: «Detalle de las especificaciones técnicas del código QR de la
// factura y de la URL del servicio de cotejo o remisión de información por
// parte del receptor de la factura», AEAT, v0.5.0 del 10-12-2025,
// desarrollo de los arts. 20 y 21 de la Orden HAC/1177/2024.

/** Entorno del servicio de cotejo.
 *
 *  Mientras V2 no remita los registros, el comercio está en PRUEBAS: un QR
 *  que apuntase a producción prometería al cliente un cotejo que no puede
 *  salir bien, porque la factura no está allí. */
export type EntornoAeat = "PRUEBAS" | "PRODUCCION";

/** URL base del servicio de cotejo para SIF que emiten facturas
 *  VERIFICABLES (VERI*FACTU). §5.1 del documento. */
export const QR_BASE_URL: Record<EntornoAeat, string> = {
  PRUEBAS: "https://prewww2.aeat.es/wlpl/TIKE-CONT/ValidarQR",
  PRODUCCION: "https://www2.agenciatributaria.gob.es/wlpl/TIKE-CONT/ValidarQR",
};

/** Texto que SIEMPRE precede al código QR, encima de él (§3).
 *
 *  Sirve para distinguirlo de cualquier otro QR de la factura — en nuestro
 *  ticket hay un segundo QR, el del ticket digital. */
export const LEYENDA_ENCIMA_DEL_QR = "QR tributario:";

/** Frase que va JUSTO DEBAJO del QR en las facturas expedidas por sistemas
 *  que emiten facturas verificables (art. 20.1.b de la Orden).
 *
 *  La Orden admite «Factura verificable en la sede electrónica de la AEAT»
 *  o «VERI*FACTU». En 42 columnas de papel térmico cabe la corta, y la
 *  Orden no las jerarquiza. */
export const LEYENDA_VERIFACTU = "VERI*FACTU";
export const LEYENDA_VERIFACTU_LARGA =
  "Factura verificable en la sede electrónica de la AEAT";

/** Tamaño físico exigido por el art. 21.1: entre 30×30 y 40×40 mm, con un
 *  mínimo de 2 mm de blanco alrededor (6 recomendados) y nivel M de
 *  corrección de errores. Las cifras viven aquí para que el renderer del
 *  papel y el del PDF no las copien cada uno por su cuenta. */
export const QR_LADO_MIN_MM = 30;
export const QR_LADO_MAX_MM = 40;
export const QR_MARGEN_BLANCO_MIN_MM = 2;
export const QR_MARGEN_BLANCO_RECOMENDADO_MM = 6;
/** Nivel de corrección de errores exigido: M (medio). */
export const QR_NIVEL_CORRECCION = "M" as const;

export interface QrFacturaInput {
  entorno: EntornoAeat;
  /** NIF del obligado a expedir la factura. */
  nif: string;
  /** Nº Serie + Nº Factura, el literal completo. */
  numSerieFactura: string;
  /** `dd-mm-yyyy`. */
  fechaExpedicion: string;
  /** Importe total, ya formateado con `importeAeat`. */
  importeTotal: string;
}

/**
 * La URL que va DENTRO del código QR.
 *
 * Cuatro parámetros obligatorios y sólo cuatro (§6). El quinto parámetro
 * opcional del servicio, `formato=json`, «nunca podrá incorporarse en la
 * URL que va en el código QR de la factura» (§7), así que esta función no
 * lo admite: no hay manera de colarlo por descuido.
 *
 * Los valores van con «URL encoding» en UTF-8 (§4). El ejemplo del propio
 * documento es una serie que contiene `&`: sin codificar, parte la URL y
 * el cotejo falla.
 */
export function buildQrUrl(input: QrFacturaInput): string {
  const base = QR_BASE_URL[input.entorno];
  const params = [
    `nif=${encodeURIComponent(input.nif.trim())}`,
    `numserie=${encodeURIComponent(input.numSerieFactura.trim())}`,
    `fecha=${encodeURIComponent(input.fechaExpedicion.trim())}`,
    `importe=${encodeURIComponent(input.importeTotal.trim())}`,
  ];
  return `${base}?${params.join("&")}`;
}

/** Longitud máxima del `numserie` en el QR (§6). La misma que la del campo
 *  `NumSerieFactura` del diseño de registro. */
export const NUM_SERIE_MAX_LENGTH = 60;

/** Los textos de la URL «solo pueden contener caracteres ASCII con códigos
 *  del 32 al 126» (§4, último párrafo). Lo comprueba quien construye la
 *  serie, no el QR: una serie con una «ñ» hay que rechazarla al
 *  configurarla, no al cobrar. */
export function serieEsValidaParaQr(serie: string): boolean {
  const s = serie.trim();
  if (s.length === 0 || s.length > NUM_SERIE_MAX_LENGTH) return false;
  return [...s].every((c) => {
    const code = c.codePointAt(0)!;
    return code >= 32 && code <= 126;
  });
}
