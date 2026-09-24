// Construcción del registro de facturación completo: de alta y de
// anulación.
//
// La salida de este módulo es lo que se guarda en `fiscal_records.payload`
// y lo que V2 remitirá a la AEAT **sin volver a tocarlo**. La FAQ de
// desarrolladores (§5) es explícita: «no sería acorde a la normativa (…) la
// producción de los registros de facturación por parte de la TPV y un
// reproceso posterior de los mismos (que los altere) desde el servidor Back
// Office central».
//
// Por eso esta función devuelve las tres cosas juntas —el registro, la
// cadena de entrada de la huella y la huella— y no un registro que alguien
// tenga que volver a firmar más tarde.

import type { CabezaDeCadena } from "./cadena.js";
import {
  fechaAeatDeIso,
  importeAeat,
  porcentajeAeat,
} from "./formato.js";
import {
  buildHuellaInputAlta,
  buildHuellaInputAnulacion,
  huellaSha256,
  TIPO_HUELLA_SHA256,
} from "./huella.js";
import {
  buildSistemaInformatico,
  PRODUCTOR_NIF,
  PRODUCTOR_NOMBRE_RAZON,
} from "./productor.js";
import {
  CALIFICACION_OPERACION,
  CLAVE_REGIMEN,
  type DetalleDesglose,
  type Encadenamiento,
  GENERADO_POR,
  ID_VERSION,
  IMPUESTO,
  LIMITES_REGISTRO,
  MAX_DETALLE_DESGLOSE,
  type RegistroAlta,
  type RegistroAnulacion,
  TIPO_FACTURA,
} from "./tipos.js";

/** Un tramo del desglose por tipo impositivo. Sale de `computeTicket` del
 *  TPV: una entrada por cada IVA presente en el ticket. */
export interface BucketDesglose {
  /** Porcentaje: 21, 10, 4, 0. */
  tipoImpositivo: number;
  /** Base imponible del tramo. */
  baseImponible: number;
  /** Cuota repercutida del tramo. */
  cuotaRepercutida: number;
}

/** Lo que devuelve cualquiera de los dos constructores.
 *
 *  `huellaInput` se guarda junto al registro a propósito, aunque sea
 *  derivable: es lo que permite al servidor —y a Postgres, §9.2 del
 *  plan— recalcular la huella sin volver a formatear ni un importe. */
export interface RegistroGenerado<T> {
  registro: T;
  huellaInput: string;
  huella: string;
}

function recortar(valor: string, limite: number): string {
  const v = valor.trim();
  return v.length <= limite ? v : v.slice(0, limite);
}

function encadenar(cabeza: CabezaDeCadena | null): Encadenamiento {
  if (!cabeza) return { PrimerRegistro: "S" };
  return {
    RegistroAnterior: {
      IDEmisorFactura: cabeza.idEmisorFactura,
      NumSerieFactura: cabeza.numSerieFactura,
      FechaExpedicionFactura: fechaAeatDeIso(cabeza.fechaExpedicion),
      Huella: cabeza.huella,
    },
  };
}

function buildDesglose(buckets: BucketDesglose[]): DetalleDesglose[] {
  if (buckets.length === 0) {
    throw new RangeError(
      "Desglose vacío: un registro de alta necesita al menos un DetalleDesglose",
    );
  }
  if (buckets.length > MAX_DETALLE_DESGLOSE) {
    throw new RangeError(
      `Desglose de ${buckets.length} tramos: el diseño de registro admite como mucho ${MAX_DETALLE_DESGLOSE}`,
    );
  }
  return buckets.map((b) => ({
    Impuesto: IMPUESTO.IVA,
    ClaveRegimen: CLAVE_REGIMEN.GENERAL,
    CalificacionOperacion: CALIFICACION_OPERACION.SUJETA_NO_EXENTA,
    TipoImpositivo: porcentajeAeat(b.tipoImpositivo),
    BaseImponibleOimporteNoSujeto: importeAeat(b.baseImponible),
    CuotaRepercutida: importeAeat(b.cuotaRepercutida),
  }));
}

export interface RegistroAltaParams {
  /** Versión del SIF en ejecución. */
  version: string;
  /** `NumeroInstalacion`: el de la CAJA (ADR-019). */
  numeroInstalacion: string;
  /** NIF del comercio que expide. */
  idEmisorFactura: string;
  /** Razón social del comercio. */
  nombreRazonEmisor: string;
  /** `C1/000123`. */
  numSerieFactura: string;
  /** `YYYY-MM-DD`. */
  fechaExpedicion: string;
  /** Descripción del objeto de la factura. Obligatoria en el anexo. */
  descripcionOperacion: string;
  desglose: BucketDesglose[];
  /** Suma de las cuotas. Se pasa en vez de sumarse aquí porque tiene que
   *  ser EXACTAMENTE la que imprime el papel: el reparto del céntimo de
   *  redondeo ya lo resolvió `allocateRoundingRemainder`, y volver a
   *  sumar aquí podría dar un céntimo distinto del que ve el cliente. */
  cuotaTotal: number;
  importeTotal: number;
  cabeza: CabezaDeCadena | null;
  /** `YYYY-MM-DDThh:mm:ss±hh:mm`, el que decidió `comprobarAntesDeGenerar`. */
  fechaHoraHusoGenRegistro: string;
}

/**
 * Registro de facturación de ALTA de una factura simplificada (`F2`).
 *
 * Lo que NO se informa, y por qué:
 *
 *   · `FacturaSimplificadaArt7273` — sólo aplica a las facturas COMPLETAS
 *     expedidas por los supuestos 7.2/7.3. Ésta es una simplificada de
 *     verdad. Si no se informa, se entiende `N`.
 *   · `Destinatarios` — una factura simplificada no identifica al
 *     destinatario. Ése es el caso del art. 6.1.d), que comparte el tipo
 *     `F2`.
 *   · `Macrodato` — sólo para base o importe superiores a 100 millones.
 *   · `EmitidaPorTerceroODestinatario` / `Tercero` — la expide el propio
 *     obligado desde su caja.
 *   · `Signature` — la firma XAdES es obligatoria «para conservación y para
 *     requerimiento, pero no para remisión» (diseño de registro). Este SIF
 *     es SOLO VERI*FACTU: remite, no conserva en modalidad firmada.
 */
export async function buildRegistroAlta(
  params: RegistroAltaParams,
): Promise<RegistroGenerado<RegistroAlta>> {
  const fechaExpedicionAeat = fechaAeatDeIso(params.fechaExpedicion);
  const numSerieFactura = recortar(
    params.numSerieFactura,
    LIMITES_REGISTRO.NumSerieFactura,
  );
  const cuotaTotal = importeAeat(params.cuotaTotal);
  const importeTotal = importeAeat(params.importeTotal);

  const huellaInput = buildHuellaInputAlta({
    idEmisorFactura: params.idEmisorFactura,
    numSerieFactura,
    fechaExpedicionFactura: fechaExpedicionAeat,
    tipoFactura: TIPO_FACTURA.SIMPLIFICADA,
    cuotaTotal,
    importeTotal,
    huellaAnterior: params.cabeza?.huella ?? null,
    fechaHoraHusoGenRegistro: params.fechaHoraHusoGenRegistro,
  });
  const huella = await huellaSha256(huellaInput);

  const registro: RegistroAlta = {
    IDVersion: ID_VERSION,
    IDFactura: {
      IDEmisorFactura: params.idEmisorFactura.trim(),
      NumSerieFactura: numSerieFactura,
      FechaExpedicionFactura: fechaExpedicionAeat,
    },
    NombreRazonEmisor: recortar(
      params.nombreRazonEmisor,
      LIMITES_REGISTRO.NombreRazonEmisor,
    ),
    TipoFactura: TIPO_FACTURA.SIMPLIFICADA,
    DescripcionOperacion: recortar(
      params.descripcionOperacion,
      LIMITES_REGISTRO.DescripcionOperacion,
    ),
    Desglose: { DetalleDesglose: buildDesglose(params.desglose) },
    CuotaTotal: cuotaTotal,
    ImporteTotal: importeTotal,
    Encadenamiento: encadenar(params.cabeza),
    SistemaInformatico: buildSistemaInformatico({
      version: params.version,
      numeroInstalacion: params.numeroInstalacion,
    }),
    FechaHoraHusoGenRegistro: params.fechaHoraHusoGenRegistro,
    TipoHuella: TIPO_HUELLA_SHA256,
    Huella: huella,
  };

  return { registro, huellaInput, huella };
}

export interface RegistroAnulacionParams {
  version: string;
  numeroInstalacion: string;
  /** NIF del comercio que expidió la factura que se anula. */
  idEmisorFacturaAnulada: string;
  /** Razón social del comercio — va en `Generador`. */
  nombreRazonEmisor: string;
  numSerieFacturaAnulada: string;
  /** `YYYY-MM-DD`. */
  fechaExpedicionFacturaAnulada: string;
  /**
   * `true` cuando el alta que se anula **nunca llegó a existir** para la
   * AEAT: el registro se generó en el terminal pero la venta no llegó a
   * cerrarse (el caso `TICKET_ALREADY_PAID` del §5.4 del plan).
   *
   * Es el caso «ANULACIÓN SIN REGISTRO PREVIO» del cuadro operativo del
   * anexo. Informarlo mal tiene consecuencias en los dos sentidos: con `S`
   * cuando el alta sí existe, la AEAT responde ERROR(10); sin `S` cuando no
   * existe, ERROR(6).
   */
  sinRegistroPrevio?: boolean;
  cabeza: CabezaDeCadena | null;
  fechaHoraHusoGenRegistro: string;
}

/** Registro de facturación de ANULACIÓN.
 *
 *  No lleva importes ni desglose: no es una factura en negativo, es la
 *  anotación de que aquella factura queda anulada. Lo que devuelve dinero
 *  es una devolución, y una devolución es una rectificativa — V3. */
export async function buildRegistroAnulacion(
  params: RegistroAnulacionParams,
): Promise<RegistroGenerado<RegistroAnulacion>> {
  const fechaAnuladaAeat = fechaAeatDeIso(params.fechaExpedicionFacturaAnulada);
  const numSerieFacturaAnulada = recortar(
    params.numSerieFacturaAnulada,
    LIMITES_REGISTRO.NumSerieFactura,
  );

  const huellaInput = buildHuellaInputAnulacion({
    idEmisorFacturaAnulada: params.idEmisorFacturaAnulada,
    numSerieFacturaAnulada,
    fechaExpedicionFacturaAnulada: fechaAnuladaAeat,
    huellaAnterior: params.cabeza?.huella ?? null,
    fechaHoraHusoGenRegistro: params.fechaHoraHusoGenRegistro,
  });
  const huella = await huellaSha256(huellaInput);

  const registro: RegistroAnulacion = {
    IDVersion: ID_VERSION,
    IDFactura: {
      IDEmisorFacturaAnulada: params.idEmisorFacturaAnulada.trim(),
      NumSerieFacturaAnulada: numSerieFacturaAnulada,
      FechaExpedicionFacturaAnulada: fechaAnuladaAeat,
    },
    ...(params.sinRegistroPrevio ? { SinRegistroPrevio: "S" as const } : {}),
    GeneradoPor: GENERADO_POR.EXPEDIDOR,
    Generador: {
      NombreRazon: recortar(
        params.nombreRazonEmisor,
        LIMITES_REGISTRO.NombreRazonEmisor,
      ),
      NIF: params.idEmisorFacturaAnulada.trim(),
    },
    Encadenamiento: encadenar(params.cabeza),
    SistemaInformatico: buildSistemaInformatico({
      version: params.version,
      numeroInstalacion: params.numeroInstalacion,
    }),
    FechaHoraHusoGenRegistro: params.fechaHoraHusoGenRegistro,
    TipoHuella: TIPO_HUELLA_SHA256,
    Huella: huella,
  };

  return { registro, huellaInput, huella };
}

/** La descripción de la operación, obligatoria en el anexo.
 *
 *  No se pone la lista de líneas: `DescripcionOperacion` es «descripción
 *  del objeto de la factura», una frase, y las líneas ya van en el papel.
 *  Meter ahí 500 caracteres de artículos recortados no describe nada mejor
 *  y hace que dos ventas del mismo comercio se lean distinto sin motivo. */
export function descripcionOperacionPorVertical(
  businessType: string | null | undefined,
): string {
  switch (businessType) {
    case "HOSPITALITY":
      return "Servicios de hostelería y restauración";
    case "SERVICES":
      return "Prestación de servicios";
    case "RETAIL":
    default:
      return "Venta al por menor";
  }
}

/** Los datos del productor que van en `Generador`, para quien los necesite
 *  fuera de este módulo. */
export const GENERADOR_PRODUCTOR = {
  NombreRazon: PRODUCTOR_NOMBRE_RAZON,
  NIF: PRODUCTOR_NIF,
} as const;
