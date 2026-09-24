// La cabeza de la cadena de una caja, y su verificación.
//
// La cabeza es lo que el dispositivo necesita para encadenar el siguiente
// registro. El servidor la DERIVA del último `fiscal_records` de la caja: no
// hay ninguna columna «contador», porque una columna sería una segunda
// verdad que puede separarse de la cadena sin que nada lo note (ADR-019).
//
// Esto es lo que hace que cambiar de tablet continúe la cadena en vez de
// empezarla: el dispositivo nuevo pregunta por dónde iba la caja.

import type { PrismaClient } from "@mipiacetpv/db";
import { fechaCivilLocal, type CabezaDeCadena } from "@mipiacetpv/verifactu";

export type { CabezaDeCadena };

/** Formatea una `DATE` de Postgres como `YYYY-MM-DD` sin volver a
 *  interpretarla en ninguna zona horaria. Prisma devuelve la columna como
 *  un `Date` a medianoche UTC. */
function fechaDeColumnaDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Por dónde va la cadena de esta caja, o `null` si todavía no ha emitido.
 *
 * Devuelve también `huellaInput`, que es lo que permite al dispositivo hacer
 * la primera comprobación del art. 7.i —recalcular la huella del último
 * registro— sin pedirle nada más al servidor.
 */
export async function readChainHead(
  prisma: PrismaClient,
  registerId: string,
): Promise<CabezaDeCadena | null> {
  const register = await prisma.register.findUnique({
    where: { id: registerId },
    select: { fiscalSeries: true },
  });
  const ultimo = await prisma.fiscalRecord.findFirst({
    where: { registerId },
    orderBy: { chainIndex: "desc" },
    select: {
      chainIndex: true,
      numSerieFactura: true,
      fechaExpedicion: true,
      huella: true,
      huellaInput: true,
      fechaHoraHusoGen: true,
      serie: true,
      payload: true,
    },
  });
  if (!ultimo) return null;

  const ultimaAlta = await prisma.fiscalRecord.findFirst({
    where: { registerId, kind: "ALTA" },
    orderBy: { numero: "desc" },
    select: { numero: true },
  });

  return {
    chainIndex: ultimo.chainIndex,
    idEmisorFactura: emisorDelPayload(ultimo.payload),
    numSerieFactura: ultimo.numSerieFactura,
    fechaExpedicion: fechaDeColumnaDate(ultimo.fechaExpedicion),
    huella: ultimo.huella,
    fechaHoraHusoGenRegistro: ultimo.fechaHoraHusoGen,
    huellaInput: ultimo.huellaInput,
    ultimoNumero: ultimaAlta?.numero ?? 0,
    serie: register?.fiscalSeries ?? ultimo.serie,
  };
}

/** El NIF del emisor sale del payload y no de una columna: en un registro de
 *  anulación el campo se llama `IDEmisorFacturaAnulada`, y el bloque
 *  `RegistroAnterior` del siguiente registro lo quiere igual en los dos
 *  casos. */
function emisorDelPayload(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const idFactura = (payload as Record<string, unknown>)["IDFactura"];
  if (!idFactura || typeof idFactura !== "object") return "";
  const obj = idFactura as Record<string, unknown>;
  const v = obj["IDEmisorFactura"] ?? obj["IDEmisorFacturaAnulada"];
  return typeof v === "string" ? v : "";
}

export interface FilaVerificacion {
  chain_index: number;
  record_id: string;
  kind: "ALTA" | "ANULACION";
  num_serie_factura: string;
  huella_ok: boolean;
  input_ok: boolean;
  enlace_ok: boolean;
  numeracion_ok: boolean;
  chain_status: "OK" | "BROKEN";
}

export interface ResumenCadena {
  total: number;
  integra: boolean;
  primerFalloIndex: number | null;
  marcadosBroken: number;
}

/**
 * Recorre la cadena de una caja DENTRO del motor.
 *
 * `mipiacetpv_verify_fiscal_chain` recalcula cada huella con el `sha256()`
 * de Postgres: la garantía no depende de que esta aplicación se porte bien,
 * que es la misma tesis de ADR-015 §4.2 y de ADR-018.
 */
export async function verifyChain(
  prisma: PrismaClient,
  registerId: string,
): Promise<FilaVerificacion[]> {
  return prisma.$queryRaw<FilaVerificacion[]>`
    SELECT * FROM mipiacetpv_verify_fiscal_chain(${registerId}::uuid)
  `;
}

export async function chainSummary(
  prisma: PrismaClient,
  registerId: string,
): Promise<ResumenCadena> {
  const rows = await prisma.$queryRaw<
    {
      total: bigint;
      integra: boolean;
      primer_fallo_index: number | null;
      marcados_broken: bigint;
    }[]
  >`SELECT * FROM mipiacetpv_fiscal_chain_summary(${registerId}::uuid)`;
  const row = rows[0];
  if (!row) return { total: 0, integra: true, primerFalloIndex: null, marcadosBroken: 0 };
  return {
    total: Number(row.total),
    integra: row.integra,
    primerFalloIndex: row.primer_fallo_index,
    marcadosBroken: Number(row.marcados_broken),
  };
}

/** La fecha civil de hoy en el reloj del servidor. Sólo se usa para
 *  informar; la fecha de expedición de una factura la pone el terminal, que
 *  es quien la expide. */
export function hoyCivil(): string {
  return fechaCivilLocal(new Date());
}
