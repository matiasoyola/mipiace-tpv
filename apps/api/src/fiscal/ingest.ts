// El espejo del servidor: recibir un registro de facturación generado en el
// terminal, VERIFICARLO y guardarlo.
//
// Tres reglas que gobiernan todo este fichero, y las tres salen de la misma
// FAQ de desarrolladores de la AEAT (§5):
//
//   1. El servidor NO recompone el registro. «No sería acorde a la
//      normativa (…) la producción de los registros de facturación por
//      parte de la TPV y un reproceso posterior de los mismos (que los
//      altere) desde el servidor Back Office central». El `payload` se
//      guarda byte a byte como llegó.
//   2. El servidor NO descarta en silencio. Un registro que no encadena se
//      guarda igual, marcado como BROKEN y con el motivo, y sale en el
//      super-admin. Tirarlo sería perder la prueba de que algo pasó.
//   3. El servidor NO deja de facturar por esto. Un registro que no cuadra
//      no tumba la venta que lo acompaña.
//
// Y una cuarta, de ADR-019: el servidor verifica con EL MISMO código que
// generó el terminal (`@mipiacetpv/verifactu`). Si usara otro, estaría
// comparando dos implementaciones en vez de comprobando una huella.

import {
  type FiscalChainStatus,
  type FiscalRecordKind,
  Prisma,
  type PrismaClient,
} from "@mipiacetpv/db";
import {
  buildHuellaInputAlta,
  buildHuellaInputAnulacion,
  huellaSha256,
  isoDeFechaAeat,
} from "@mipiacetpv/verifactu";

import type { FiscalRecordBody } from "./payload.js";

type Tx = Prisma.TransactionClient | PrismaClient;

/** Los campos que el servidor DERIVA del payload para indexarlo. Ninguno se
 *  inventa: todos salen del registro que generó el terminal. */
interface ColumnasDerivadas {
  numSerieFactura: string;
  fechaExpedicionIso: string;
  tipoFactura: string;
  cuotaTotal: string;
  importeTotal: string;
  huella: string;
  huellaAnterior: string | null;
  primerRegistro: boolean;
  fechaHoraHusoGen: string;
  huellaInputEsperada: string;
  idEmisorFactura: string;
}

export class PayloadFiscalIlegibleError extends Error {
  constructor(motivo: string) {
    super(`El registro de facturación no se puede leer: ${motivo}`);
    this.name = "PayloadFiscalIlegibleError";
  }
}

function texto(obj: unknown, clave: string): string | null {
  if (!obj || typeof obj !== "object") return null;
  const v = (obj as Record<string, unknown>)[clave];
  return typeof v === "string" ? v : null;
}

function objeto(obj: unknown, clave: string): unknown {
  if (!obj || typeof obj !== "object") return null;
  return (obj as Record<string, unknown>)[clave] ?? null;
}

/**
 * Lee del payload lo que hace falta para indexarlo y para reconstruir su
 * cadena de entrada.
 *
 * Si falta algo, lanza: un registro al que no se le puede leer el número de
 * factura no es un registro, y guardarlo «por si acaso» dejaría una fila
 * que nadie sabría interpretar después.
 */
export function derivarColumnas(
  kind: FiscalRecordKind,
  payload: Record<string, unknown>,
): ColumnasDerivadas {
  const encadenamiento = objeto(payload, "Encadenamiento");
  const registroAnterior = objeto(encadenamiento, "RegistroAnterior");
  const primerRegistro = texto(encadenamiento, "PrimerRegistro") === "S";
  const huellaAnterior = registroAnterior
    ? texto(registroAnterior, "Huella")
    : null;

  const huella = texto(payload, "Huella");
  const fechaHoraHusoGen = texto(payload, "FechaHoraHusoGenRegistro");
  const idFactura = objeto(payload, "IDFactura");
  if (!huella || !fechaHoraHusoGen || !idFactura) {
    throw new PayloadFiscalIlegibleError(
      "faltan Huella, FechaHoraHusoGenRegistro o IDFactura",
    );
  }
  if (primerRegistro === (huellaAnterior !== null)) {
    throw new PayloadFiscalIlegibleError(
      "el encadenamiento dice a la vez que es y que no es el primer registro",
    );
  }

  if (kind === "ALTA") {
    const idEmisorFactura = texto(idFactura, "IDEmisorFactura");
    const numSerieFactura = texto(idFactura, "NumSerieFactura");
    const fechaExpedicion = texto(idFactura, "FechaExpedicionFactura");
    const tipoFactura = texto(payload, "TipoFactura");
    const cuotaTotal = texto(payload, "CuotaTotal");
    const importeTotal = texto(payload, "ImporteTotal");
    if (
      !idEmisorFactura ||
      !numSerieFactura ||
      !fechaExpedicion ||
      !tipoFactura ||
      cuotaTotal === null ||
      importeTotal === null
    ) {
      throw new PayloadFiscalIlegibleError(
        "un RegistroAlta necesita IDEmisorFactura, NumSerieFactura, FechaExpedicionFactura, TipoFactura, CuotaTotal e ImporteTotal",
      );
    }
    return {
      idEmisorFactura,
      numSerieFactura,
      fechaExpedicionIso: isoDeFechaAeat(fechaExpedicion),
      tipoFactura,
      cuotaTotal,
      importeTotal,
      huella,
      huellaAnterior,
      primerRegistro,
      fechaHoraHusoGen,
      huellaInputEsperada: buildHuellaInputAlta({
        idEmisorFactura,
        numSerieFactura,
        fechaExpedicionFactura: fechaExpedicion,
        tipoFactura,
        cuotaTotal,
        importeTotal,
        huellaAnterior,
        fechaHoraHusoGenRegistro: fechaHoraHusoGen,
      }),
    };
  }

  const idEmisorFactura = texto(idFactura, "IDEmisorFacturaAnulada");
  const numSerieFactura = texto(idFactura, "NumSerieFacturaAnulada");
  const fechaExpedicion = texto(idFactura, "FechaExpedicionFacturaAnulada");
  if (!idEmisorFactura || !numSerieFactura || !fechaExpedicion) {
    throw new PayloadFiscalIlegibleError(
      "un RegistroAnulacion necesita IDEmisorFacturaAnulada, NumSerieFacturaAnulada y FechaExpedicionFacturaAnulada",
    );
  }
  return {
    idEmisorFactura,
    numSerieFactura,
    fechaExpedicionIso: isoDeFechaAeat(fechaExpedicion),
    // Una anulación no lleva TipoFactura ni importes: no es una factura en
    // negativo, es la anotación de que aquella queda anulada. Las columnas
    // existen porque la tabla es una sola; se rellenan con lo que la
    // anulación SÍ dice de la factura anulada, y con cero en los importes.
    tipoFactura: "",
    cuotaTotal: "0.00",
    importeTotal: "0.00",
    huella,
    huellaAnterior,
    primerRegistro,
    fechaHoraHusoGen,
    huellaInputEsperada: buildHuellaInputAnulacion({
      idEmisorFacturaAnulada: idEmisorFactura,
      numSerieFacturaAnulada: numSerieFactura,
      fechaExpedicionFacturaAnulada: fechaExpedicion,
      huellaAnterior,
      fechaHoraHusoGenRegistro: fechaHoraHusoGen,
    }),
  };
}

export interface VeredictoCadena {
  status: FiscalChainStatus;
  error: string | null;
}

/**
 * Las cuatro preguntas, en orden, y la primera que falla es la que se
 * cuenta. Devolver una lista de todos los fallos sonaría más completo y
 * sería peor: cuando la huella no cuadra, que además el enlace no cuadre no
 * es otro problema, es el mismo.
 */
export async function verificarRegistro(params: {
  tx: Tx;
  registerId: string;
  chainIndex: number;
  numero: number;
  serie: string;
  kind: FiscalRecordKind;
  huellaInputRecibida: string;
  columnas: ColumnasDerivadas;
}): Promise<VeredictoCadena> {
  const { columnas } = params;

  // 1 · ¿la cadena de entrada que manda el terminal es la que se deriva de
  //     su propio registro? Detecta que alguien toque una sin la otra.
  if (params.huellaInputRecibida !== columnas.huellaInputEsperada) {
    return {
      status: "BROKEN",
      error:
        "ENTRADA_NO_DERIVA_DEL_REGISTRO: la cadena sobre la que se calculó la huella no es la que corresponde a los campos del registro.",
    };
  }

  // 2 · ¿la huella es la de esa cadena?
  if ((await huellaSha256(params.huellaInputRecibida)) !== columnas.huella) {
    return {
      status: "BROKEN",
      error:
        "HUELLA_NO_CUADRA: la huella declarada no es el SHA-256 de su cadena de entrada.",
    };
  }

  // 3 · ¿encadena con el registro que ocupa la posición anterior EN ESTA
  //     CAJA? La cadena es por caja (ADR-019): encadenar con la huella de
  //     otra caja es tan roto como no encadenar.
  const anterior =
    params.chainIndex === 1
      ? null
      : await params.tx.fiscalRecord.findUnique({
          where: {
            registerId_chainIndex: {
              registerId: params.registerId,
              chainIndex: params.chainIndex - 1,
            },
          },
          select: { huella: true },
        });

  if (params.chainIndex === 1) {
    if (!columnas.primerRegistro) {
      return {
        status: "BROKEN",
        error:
          "PRIMERO_SIN_DECIRLO: ocupa la primera posición de la cadena pero no declara PrimerRegistro.",
      };
    }
  } else if (!anterior) {
    return {
      status: "BROKEN",
      error: `SIN_ANTERIOR: no hay ningún registro en la posición ${params.chainIndex - 1} de esta caja.`,
    };
  } else if (columnas.huellaAnterior !== anterior.huella) {
    return {
      status: "BROKEN",
      error:
        "ENLACE_ROTO: la huella anterior que declara no es la del registro que ocupa la posición de antes en esta caja.",
    };
  }

  // 4 · ¿el número de la factura es el siguiente de la serie? Sólo las
  //     altas gastan número.
  if (params.kind === "ALTA") {
    const ultima = await params.tx.fiscalRecord.findFirst({
      where: { registerId: params.registerId, kind: "ALTA" },
      orderBy: { numero: "desc" },
      select: { numero: true, serie: true },
    });
    const esperado = (ultima?.numero ?? 0) + 1;
    if (params.numero !== esperado) {
      return {
        status: "BROKEN",
        error: `NUMERACION_CON_HUECO: le tocaba el número ${esperado} de la serie y trae el ${params.numero}.`,
      };
    }
    if (ultima && ultima.serie !== params.serie) {
      return {
        status: "BROKEN",
        error: `SERIE_CAMBIADA: esta caja venía emitiendo en la serie "${ultima.serie}" y este registro dice "${params.serie}".`,
      };
    }
  }

  return { status: "OK", error: null };
}

export interface IngestResult {
  id: string;
  chainStatus: FiscalChainStatus;
  chainError: string | null;
  /** `true` si ya estaba: el mismo cobro reenviado por el outbox. */
  duplicado: boolean;
}

/**
 * Verifica y guarda. Va DENTRO de la transacción que persiste la venta: si
 * la venta se cae, el registro se cae con ella, y al revés. Es lo que hace
 * que no pueda quedar una factura sin su registro ni un registro sin su
 * factura.
 */
export async function ingestFiscalRecord(params: {
  tx: Tx;
  tenantId: string;
  registerId: string;
  deviceId: string | null;
  ticketId: string | null;
  anulaRecordId?: string | null;
  body: FiscalRecordBody;
}): Promise<IngestResult> {
  const { tx, body } = params;

  const existente = await tx.fiscalRecord.findUnique({
    where: { externalId: body.externalId },
    select: { id: true, chainStatus: true, chainError: true, tenantId: true },
  });
  if (existente) {
    // Mismo criterio que la idempotencia del ticket: no se confirma la
    // existencia de un externalId de otro tenant.
    if (existente.tenantId !== params.tenantId) {
      throw new PayloadFiscalIlegibleError("externalId ya en uso");
    }
    return { ...existente, duplicado: true };
  }

  const columnas = derivarColumnas(body.kind, body.payload);
  const veredicto = await verificarRegistro({
    tx,
    registerId: params.registerId,
    chainIndex: body.chainIndex,
    numero: body.numero,
    serie: body.serie,
    kind: body.kind,
    huellaInputRecibida: body.huellaInput,
    columnas,
  });

  // La posición de la cadena puede estar ocupada: dos dispositivos en la
  // misma caja (que el índice único de `devices` ya impide), o una cabeza
  // de cadena desincronizada. El registro NO se pierde: entra en la
  // siguiente posición libre, marcado, y sale en el super-admin.
  const ocupada = await tx.fiscalRecord.findUnique({
    where: {
      registerId_chainIndex: {
        registerId: params.registerId,
        chainIndex: body.chainIndex,
      },
    },
    select: { id: true },
  });
  let chainIndex = body.chainIndex;
  let status = veredicto.status;
  let error = veredicto.error;
  if (ocupada) {
    const ultimo = await tx.fiscalRecord.findFirst({
      where: { registerId: params.registerId },
      orderBy: { chainIndex: "desc" },
      select: { chainIndex: true },
    });
    chainIndex = (ultimo?.chainIndex ?? 0) + 1;
    status = "BROKEN";
    error = `POSICION_OCUPADA: la posición ${body.chainIndex} de la cadena de esta caja ya estaba ocupada; el registro se guarda en la ${chainIndex}.`;
  }

  const creado = await tx.fiscalRecord.create({
    data: {
      tenantId: params.tenantId,
      registerId: params.registerId,
      externalId: body.externalId,
      kind: body.kind,
      chainIndex,
      serie: body.serie,
      numero: body.numero,
      numSerieFactura: columnas.numSerieFactura,
      fechaExpedicion: new Date(`${columnas.fechaExpedicionIso}T00:00:00.000Z`),
      tipoFactura: columnas.tipoFactura,
      cuotaTotal: new Prisma.Decimal(columnas.cuotaTotal),
      importeTotal: new Prisma.Decimal(columnas.importeTotal),
      huella: columnas.huella,
      huellaAnterior: columnas.huellaAnterior,
      primerRegistro: columnas.primerRegistro,
      fechaHoraHusoGen: columnas.fechaHoraHusoGen,
      huellaInput: body.huellaInput,
      // Tal cual llegó. Éste es el objeto que V2 remitirá.
      payload: body.payload as Prisma.InputJsonValue,
      ticketId: params.ticketId,
      anulaRecordId: params.anulaRecordId ?? null,
      deviceId: params.deviceId,
      generatedAt: new Date(body.generatedAt),
      chainStatus: status,
      chainError: error,
    },
    select: { id: true, chainStatus: true, chainError: true },
  });

  return { ...creado, duplicado: false };
}
