// V1-verifactu (ADR-019) · el registro de facturación, EN EL DISPOSITIVO.
//
// El registro nace aquí, en el momento de cobrar, con su serie, su número,
// su huella encadenada y su QR — y sin preguntarle nada a nadie. Eso no es
// una optimización: la FAQ de desarrolladores de la AEAT exige que el
// registro esté «íntegramente producido en el momento de generar la factura
// y el código QR y entregarla al cliente», y el TPV cobra sin red desde
// v1.5. Generarlo en el servidor sería exigir red para cobrar.
//
// Lo que este módulo guarda en local:
//
//   · La CONFIGURACIÓN fiscal de la caja (quién emite, con qué NIF, qué
//     serie, qué instalación, contra qué entorno de la AEAT). Se refresca
//     con red y se cachea: sin ella no se puede facturar, y pedirla en el
//     momento del cobro sería volver a necesitar red.
//   · La CABEZA DE LA CADENA: por dónde va la caja. Avanza en cada
//     registro generado y se resincroniza con el servidor cuando hay red
//     y la cola está vacía.

import {
  buildRegistroAlta,
  buildRegistroAnulacion,
  buildQrUrl,
  type CabezaDeCadena,
  comprobarAntesDeGenerar,
  descripcionOperacionPorVertical,
  type EntornoAeat,
  fechaAeatDeIso,
  fechaCivilLocal,
  formatNumSerieFactura,
  hasWebCrypto,
  importeAeat,
  siguienteChainIndex,
  siguienteNumero,
} from "@mipiacetpv/verifactu";
import { cuadrarDesglose } from "@mipiacetpv/ticket-model";

import { apiWithCashier } from "../api.js";
import type { CartTaxBucket } from "./cart.js";
import type { CabeceraTicketLocal } from "./ticketLocal.js";
import { newId } from "./ids.js";
import { captureError } from "./sentry.js";

const STATE_KEY = "mipiacetpv-fiscal-state";

export interface FiscalConfig {
  emite: boolean;
  /** La cabecera del papel, cacheada para poder IMPRIMIR sin red. Null en
   *  un comercio que factura con Holded. */
  cabecera: CabeceraTicketLocal | null;
  nif: string | null;
  razonSocial: string | null;
  serie: string | null;
  numeroInstalacion: string | null;
  version: string;
  entorno: EntornoAeat;
  businessType: string | null;
}

interface FiscalState {
  registerId: string;
  config: FiscalConfig;
  cabeza: CabezaDeCadena | null;
}

/** El registro tal y como viaja dentro de la venta. Espejo exacto del
 *  `FiscalRecordBody` de la API. */
export interface FiscalRecordPayload {
  externalId: string;
  kind: "ALTA" | "ANULACION";
  chainIndex: number;
  serie: string;
  numero: number;
  generatedAt: string;
  huellaInput: string;
  payload: Record<string, unknown>;
}

export interface RegistroDeVenta {
  /** Lo que se mete en el cuerpo del POST. */
  body: FiscalRecordPayload;
  /** `C1/000123` — lo que se imprime como número de factura. */
  numSerieFactura: string;
  /** La URL del QR tributario. */
  qrUrl: string;
  /** `dd-mm-yyyy`, el formato de la AEAT (QR y registro). */
  fechaExpedicion: string;
  /** `YYYY-MM-DD`, el formato con el que viaja y se guarda. */
  fechaExpedicionIso: string;
  /** Lo que se encontró mal al comprobar el art. 7.i. NUNCA impide cobrar. */
  avisos: string[];
}

// ── El estado local ────────────────────────────────────────────────────

function leerEstado(): FiscalState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as FiscalState;
  } catch {
    return null;
  }
}

function escribirEstado(state: FiscalState): void {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // Storage lleno o modo privado restrictivo. No se puede hacer nada
    // mejor que seguir: el cobro no depende de esto, y la cabeza se
    // vuelve a pedir al servidor en el siguiente arranque con red.
  }
}

export function getFiscalConfig(registerId: string): FiscalConfig | null {
  const s = leerEstado();
  return s && s.registerId === registerId ? s.config : null;
}

export function getCabezaDeCadena(registerId: string): CabezaDeCadena | null {
  const s = leerEstado();
  return s && s.registerId === registerId ? s.cabeza : null;
}

export function clearFiscalState(): void {
  localStorage.removeItem(STATE_KEY);
}

/**
 * Trae del servidor la configuración y la cabeza de la cadena.
 *
 * La regla de quién gana cuando las dos cabezas no coinciden:
 *
 *   · El servidor va POR DELANTE  → gana el servidor. Este dispositivo se
 *     reinstaló, o es una tablet nueva que releva a otra. Es exactamente
 *     el caso que hace que cambiar de tablet CONTINÚE la cadena.
 *   · El dispositivo va por delante → gana el dispositivo. Tiene registros
 *     en la cola que el servidor todavía no ha visto. Aceptar la cabeza del
 *     servidor aquí re-emitiría números ya entregados a un cliente.
 *
 * Con un solo dispositivo activo por caja las dos cabezas no pueden
 * divergir de verdad: la única fuente de registros nuevos es ésta.
 */
export async function refreshFiscalHead(registerId: string): Promise<FiscalConfig | null> {
  let res: {
    emite: boolean;
    nif?: string | null;
    razonSocial?: string | null;
    serie?: string | null;
    numeroInstalacion?: string | null;
    version?: string;
    entorno?: EntornoAeat;
    businessType?: string | null;
    cabeza?: CabezaDeCadena | null;
    cabecera?: CabeceraTicketLocal | null;
  };
  try {
    res = await apiWithCashier("/tpv/fiscal/head");
  } catch {
    // Sin red. Se sigue con lo cacheado, que es justo para lo que está.
    return getFiscalConfig(registerId);
  }

  const config: FiscalConfig = {
    emite: res.emite,
    cabecera: res.cabecera ?? null,
    nif: res.nif ?? null,
    razonSocial: res.razonSocial ?? null,
    serie: res.serie ?? null,
    numeroInstalacion: res.numeroInstalacion ?? null,
    version: res.version ?? "unknown",
    entorno: res.entorno ?? "PRUEBAS",
    businessType: res.businessType ?? null,
  };

  const local = leerEstado();
  const cabezaLocal = local?.registerId === registerId ? local.cabeza : null;
  const cabezaServidor = res.cabeza ?? null;
  const cabeza =
    (cabezaLocal?.chainIndex ?? 0) > (cabezaServidor?.chainIndex ?? 0)
      ? cabezaLocal
      : cabezaServidor;

  escribirEstado({ registerId, config, cabeza });
  return config;
}

// ── Generar el registro de una venta ───────────────────────────────────

export class FiscalNoConfiguradoError extends Error {
  constructor(public readonly motivo: string) {
    super(motivo);
    this.name = "FiscalNoConfiguradoError";
  }
}

export interface DatosDeLaVenta {
  registerId: string;
  /** Los tramos de IVA del carrito (`computeCartTaxBuckets`). */
  buckets: CartTaxBucket[];
  /** Neto del carrito. */
  subtotal: number;
  /** Total cobrado. Es autoritativo: no se recalcula. */
  total: number;
}

/**
 * Genera el registro de ALTA de una venta y lo deja listo para viajar
 * dentro del POST.
 *
 * Avanza la cabeza de la cadena ANTES de devolver: a partir de aquí el
 * número está gastado, pase lo que pase con el envío. Reutilizarlo sería
 * entregar dos facturas con el mismo número, que es peor que un hueco —
 * y un hueco tiene arreglo (el registro de anulación).
 */
export async function generarRegistroDeVenta(
  datos: DatosDeLaVenta,
): Promise<RegistroDeVenta> {
  const estado = leerEstado();
  if (!estado || estado.registerId !== datos.registerId) {
    throw new FiscalNoConfiguradoError(
      "esta caja no tiene configuración fiscal cacheada",
    );
  }
  const { config } = estado;
  if (!config.emite) {
    throw new FiscalNoConfiguradoError("este comercio no emite sus facturas");
  }
  if (!config.nif || !config.razonSocial || !config.serie || !config.numeroInstalacion) {
    throw new FiscalNoConfiguradoError(
      "faltan datos fiscales de la caja (NIF, razón social, serie o instalación)",
    );
  }
  if (!hasWebCrypto()) {
    throw new FiscalNoConfiguradoError(
      "este dispositivo no puede calcular la huella (sin crypto.subtle)",
    );
  }

  const ahora = new Date();
  const previa = await comprobarAntesDeGenerar({
    cabeza: estado.cabeza,
    ahora,
  });

  const numero = siguienteNumero(estado.cabeza);
  const chainIndex = siguienteChainIndex(estado.cabeza);
  const numSerieFactura = formatNumSerieFactura(config.serie, numero);
  const fechaExpedicionIso = fechaCivilLocal(ahora);

  // El desglose y la cuota total salen del MISMO cuadre que imprime el
  // papel. Si no, el `CuotaTotal` que entra en la huella no sería el que
  // el cliente ve en su ticket.
  const cuadrado = cuadrarDesglose({
    subtotal: datos.subtotal,
    buckets: datos.buckets,
    total: datos.total,
  });

  const { registro, huellaInput } = await buildRegistroAlta({
    version: config.version,
    numeroInstalacion: config.numeroInstalacion,
    idEmisorFactura: config.nif,
    nombreRazonEmisor: config.razonSocial,
    numSerieFactura,
    fechaExpedicion: fechaExpedicionIso,
    descripcionOperacion: descripcionOperacionPorVertical(config.businessType),
    desglose: cuadrado.buckets.map((b) => ({
      tipoImpositivo: b.rate,
      baseImponible: b.base,
      cuotaRepercutida: b.tax,
    })),
    cuotaTotal: cuadrado.cuotaTotal,
    importeTotal: datos.total,
    cabeza: estado.cabeza,
    fechaHoraHusoGenRegistro: previa.fechaHoraHusoGenRegistro,
  });

  const fechaExpedicionAeat = fechaAeatDeIso(fechaExpedicionIso);
  const qrUrl = buildQrUrl({
    entorno: config.entorno,
    nif: config.nif,
    numSerieFactura,
    fechaExpedicion: fechaExpedicionAeat,
    importeTotal: importeAeat(datos.total),
  });

  avanzarCabeza(datos.registerId, {
    chainIndex,
    idEmisorFactura: config.nif,
    numSerieFactura,
    fechaExpedicion: fechaExpedicionIso,
    huella: registro.Huella,
    fechaHoraHusoGenRegistro: registro.FechaHoraHusoGenRegistro,
    huellaInput,
    ultimoNumero: numero,
    serie: config.serie,
  });

  if (previa.anomalias.length > 0) {
    // Se ha facturado igual —la FAQ §15.2 lo exige— pero esto no puede
    // quedarse sólo en la pantalla del cajero, que no sabe qué hacer con
    // ello.
    captureError(
      new Error(
        `verifactu: anomalías en la cadena antes de generar · ${previa.anomalias
          .map((a) => a.codigo)
          .join(", ")}`,
      ),
      { registerId: datos.registerId, numSerieFactura },
    );
  }

  return {
    body: {
      externalId: newId(),
      kind: "ALTA",
      chainIndex,
      serie: config.serie,
      numero,
      generatedAt: ahora.toISOString(),
      huellaInput,
      payload: registro as unknown as Record<string, unknown>,
    },
    numSerieFactura,
    qrUrl,
    fechaExpedicion: fechaExpedicionAeat,
    fechaExpedicionIso,
    avisos: previa.anomalias.map((a) => a.mensaje),
  };
}

export interface DatosDeLaAnulacion {
  registerId: string;
  /** La factura que se anula. */
  numSerieFactura: string;
  /** `YYYY-MM-DD` de la factura anulada. */
  fechaExpedicion: string;
  /** `true` si el alta nunca llegó a existir para la AEAT. */
  sinRegistroPrevio?: boolean;
}

/** El registro de ANULACIÓN. Ocupa posición en la cadena y NO gasta número:
 *  la factura anulada ya gastó el suyo, y el siguiente número sigue siendo
 *  el siguiente. */
export async function generarRegistroDeAnulacion(
  datos: DatosDeLaAnulacion,
): Promise<{ body: FiscalRecordPayload; avisos: string[] }> {
  const estado = leerEstado();
  if (!estado || estado.registerId !== datos.registerId) {
    throw new FiscalNoConfiguradoError(
      "esta caja no tiene configuración fiscal cacheada",
    );
  }
  const { config } = estado;
  if (!config.emite || !config.nif || !config.razonSocial || !config.serie || !config.numeroInstalacion) {
    throw new FiscalNoConfiguradoError("faltan datos fiscales de la caja");
  }

  const ahora = new Date();
  const previa = await comprobarAntesDeGenerar({ cabeza: estado.cabeza, ahora });
  const chainIndex = siguienteChainIndex(estado.cabeza);

  const { registro, huellaInput } = await buildRegistroAnulacion({
    version: config.version,
    numeroInstalacion: config.numeroInstalacion,
    idEmisorFacturaAnulada: config.nif,
    nombreRazonEmisor: config.razonSocial,
    numSerieFacturaAnulada: datos.numSerieFactura,
    fechaExpedicionFacturaAnulada: datos.fechaExpedicion,
    sinRegistroPrevio: datos.sinRegistroPrevio,
    cabeza: estado.cabeza,
    fechaHoraHusoGenRegistro: previa.fechaHoraHusoGenRegistro,
  });

  avanzarCabeza(datos.registerId, {
    chainIndex,
    idEmisorFactura: config.nif,
    numSerieFactura: datos.numSerieFactura,
    fechaExpedicion: datos.fechaExpedicion,
    huella: registro.Huella,
    fechaHoraHusoGenRegistro: registro.FechaHoraHusoGenRegistro,
    huellaInput,
    ultimoNumero: estado.cabeza?.ultimoNumero ?? 0,
    serie: config.serie,
  });

  return {
    body: {
      externalId: newId(),
      kind: "ANULACION",
      chainIndex,
      serie: config.serie,
      // El número de la factura ANULADA. La anulación no gasta uno nuevo.
      numero: estado.cabeza?.ultimoNumero ?? 1,
      generatedAt: ahora.toISOString(),
      huellaInput,
      payload: registro as unknown as Record<string, unknown>,
    },
    avisos: previa.anomalias.map((a) => a.mensaje),
  };
}

function avanzarCabeza(registerId: string, cabeza: CabezaDeCadena): void {
  const estado = leerEstado();
  if (!estado || estado.registerId !== registerId) return;
  escribirEstado({ ...estado, cabeza });
}
