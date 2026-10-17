// puesta-en-marcha · probar la cuenta real, resetear el ensayo y empezar a
// facturar. ADR-021.
//
// Tres funciones que ven exactamente lo mismo, igual que en ADR-020:
//
//   previsualizarPuestaEnMarcha()  → en qué estado está la cuenta, qué se
//                                    borraría, qué se conserva, y qué impide
//                                    arrancar si algo lo impide.
//   resetearEnsayo()               → borra el ensayo. Sólo en ensayo.
//   arrancarFacturacion()          → resetea, comprueba y fija la fecha. Una
//                                    vez, y no se deshace.
//
// Que la previsualización y la ejecución salgan de las MISMAS consultas es lo
// que hace que la pantalla no sea un texto de ayuda: es el plan. Por eso las
// dos ejecuciones vuelven a previsualizar DENTRO de su transacción y no se
// fían de lo que la pantalla vio hace treinta segundos.
//
// ── La regla que sostiene todo esto ────────────────────────────────────
//
// ANTES DE ARRANCAR NO HAY NINGÚN REGISTRO FISCAL. De ahí se sigue que el
// reseteo no borra —ni puede borrar— una factura: `fiscal_records` no se toca
// en ninguna línea de este fichero, el trigger append-only sigue sin puertas,
// y la Ley Antifraude no entra en juego porque lo que se borra no es
// facturación. Lo único que se comprueba de `fiscal_records` es que esté
// VACÍA, y es una precondición de arrancar, no una excepción.
//
// Si algún día alguien hace que esto borre un registro, el test
// `puesta-en-marcha-reseteo` se pone rojo por los dos lados: por el que
// cuenta lo que se borra y por el que cuenta lo que se conserva.

import { Prisma, TicketStatus, type PrismaClient } from "@mipiacetpv/db";

// La misma clase de error que usa `dejar-holded`, importada y no duplicada:
// «este tenant no existe» es un hecho sobre el tenant, no sobre la acción, y
// dos clases con el mismo nombre en dos ficheros es exactamente cómo empiezan
// los `catch` que no atrapan.
import { TenantNoExisteError } from "../holded/dejar-holded.js";
import { purgeTestData } from "../superadmin/test-cashier.js";

import { comprobarSueloFiscal, type SueloFiscal } from "./activacion.js";
import { enEnsayo } from "./mode.js";

type Tx = Prisma.TransactionClient | PrismaClient;

/** Lo que impide arrancar, con el texto que lee quien pulsa. Misma forma que
 *  los bloqueos de ADR-020 a propósito: la pantalla los pinta igual. */
export interface Bloqueo {
  codigo: string;
  mensaje: string;
}

/** La foto del ensayo: qué hay ahora mismo de lo que el reseteo borra. */
export interface FotoDelEnsayo {
  ticketsDeEnsayo: number;
  borradores: number;
  devoluciones: number;
  turnos: number;
  turnosAbiertos: number;
  arqueos: number;
  informesZ: number;
  comandasDeCocina: number;
  emailsDeTicket: number;
  mesasUnidas: number;
  /** Por dónde va el contador de referencia interna de cada caja. El reseteo
   *  lo devuelve a cero: la primera venta de verdad es la 000001. */
  contadoresDeTicket: Array<{ cajaId: string; caja: string; contador: number }>;
}

/** Lo que el reseteo NO toca. Se cuenta y se enseña, no se describe: «se
 *  conserva el catálogo» es una promesa, «87 productos» es una comprobación. */
export interface LoQueSeConserva {
  productos: number;
  mesas: number;
  cajeros: number;
  terminales: number;
  impresoras: number;
  contactos: number;
  datosFiscales: boolean;
}

export interface CajaDeLaPuestaEnMarcha {
  id: string;
  nombre: string;
  tienda: string;
  serie: string | null;
  numeroInstalacion: string | null;
  /** Lo que tiene que ser 0 para poder arrancar. */
  registrosFiscales: number;
  terminalesEmparejados: number;
}

export interface PrevisualizacionPuestaEnMarcha {
  tenant: {
    id: string;
    name: string;
    onboardingState: string;
    esDePruebas: boolean;
  };
  estado: "ensayo" | "facturando";
  /** ISO, o null si está en ensayo. */
  facturaDesde: string | null;
  ensayo: FotoDelEnsayo;
  conserva: LoQueSeConserva;
  cajas: CajaDeLaPuestaEnMarcha[];
  suelo: SueloFiscal;
  puedeResetear: boolean;
  puedeArrancar: boolean;
  bloqueos: Bloqueo[];
}

/**
 * Todo lo que la pantalla enseña, sacado de consultas reales sobre ESA
 * cuenta. Nada estimado y nada de ejemplo.
 *
 * Acepta una `Tx` para que las dos ejecuciones puedan llamarla DENTRO de su
 * transacción y decidir sobre el estado real del momento.
 */
export async function previsualizarPuestaEnMarcha(
  tx: Tx,
  tenantId: string,
): Promise<PrevisualizacionPuestaEnMarcha> {
  const tenant = await tx.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      onboardingState: true,
      esDePruebas: true,
      facturaDesde: true,
    },
  });
  if (!tenant) throw new TenantNoExisteError(tenantId);
  const ensayo = enEnsayo(tenant);

  const registers = await tx.register.findMany({
    where: { deletedAt: null, store: { tenantId, deletedAt: null } },
    orderBy: [{ store: { name: "asc" } }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      ticketCounter: true,
      fiscalSeries: true,
      fiscalInstallationId: true,
      store: { select: { name: true } },
    },
  });
  const registerIds = registers.map((r) => r.id);

  const [
    ticketsDeEnsayo,
    borradores,
    devoluciones,
    turnos,
    turnosAbiertos,
    arqueos,
    informesZ,
    comandasDeCocina,
    emailsDeTicket,
    mesasUnidas,
    productos,
    mesas,
    cajeros,
    terminales,
    impresoras,
    contactos,
  ] = await Promise.all([
    tx.ticket.count({ where: { tenantId, status: TicketStatus.TEST } }),
    tx.ticket.count({ where: { tenantId, status: TicketStatus.DRAFT } }),
    tx.refund.count({ where: { tenantId } }),
    tx.shift.count({ where: { registerId: { in: registerIds } } }),
    tx.shift.count({ where: { registerId: { in: registerIds }, closedAt: null } }),
    tx.shiftCashCount.count({
      where: { shift: { registerId: { in: registerIds } } },
    }),
    tx.shiftZReport.count({
      where: { shift: { registerId: { in: registerIds } } },
    }),
    tx.kitchenOrder.count({ where: { ticket: { tenantId } } }),
    tx.ticketEmailJob.count({ where: { ticket: { tenantId } } }),
    tx.table.count({
      where: {
        deletedAt: null,
        store: { tenantId, deletedAt: null },
        groupedIntoTableId: { not: null },
      },
    }),
    tx.product.count({ where: { tenantId, archivedFromHoldedAt: null } }),
    tx.table.count({ where: { deletedAt: null, store: { tenantId, deletedAt: null } } }),
    // Cajeros de verdad: el técnico del modo prueba no cuenta como cajero
    // del comercio (mismo criterio que la ficha del tenant).
    tx.user.count({ where: { tenantId, deletedAt: null, isTestCashier: false } }),
    tx.device.count({ where: { tenantId, kind: "TERMINAL", revokedAt: null } }),
    tx.printerConfig.count({ where: { registerId: { in: registerIds } } }),
    tx.contact.count({ where: { tenantId } }),
  ]);

  const registrosPorCaja = await tx.fiscalRecord.groupBy({
    by: ["registerId"],
    where: { tenantId },
    _count: { _all: true },
  });
  const terminalesPorCaja = await tx.device.groupBy({
    by: ["registerId"],
    where: { tenantId, kind: "TERMINAL", revokedAt: null },
    _count: { _all: true },
  });
  const registrosDe = new Map(
    registrosPorCaja.map((r) => [r.registerId, r._count._all]),
  );
  const terminalesDe = new Map(
    terminalesPorCaja
      .filter((r): r is typeof r & { registerId: string } => r.registerId != null)
      .map((r) => [r.registerId, r._count._all]),
  );

  const cajas: CajaDeLaPuestaEnMarcha[] = registers.map((r) => ({
    id: r.id,
    nombre: r.name,
    tienda: r.store.name,
    serie: r.fiscalSeries,
    numeroInstalacion: r.fiscalInstallationId,
    registrosFiscales: registrosDe.get(r.id) ?? 0,
    terminalesEmparejados: terminalesDe.get(r.id) ?? 0,
  }));

  const suelo = await comprobarSueloFiscal(tx, tenantId);

  // ── Lo que impide arrancar ────────────────────────────────────────────
  //
  // Todos los bloqueos, no el primero: quien está delante del cliente tiene
  // que poder resolverlos de una pasada y no descubrirlos de uno en uno.
  const bloqueos: Bloqueo[] = [];
  if (!ensayo) {
    bloqueos.push({
      codigo: "YA_FACTURA",
      mensaje: `Esta cuenta ya factura desde el ${formatearFecha(tenant.facturaDesde!)}. Arrancar es una sola vez.`,
    });
  }
  if (tenant.esDePruebas) {
    bloqueos.push({
      codigo: "TENANT_DE_PRUEBAS",
      mensaje:
        "Es una cuenta de pruebas del equipo: se queda en ensayo para siempre. Si hay que facturar de verdad, se da de alta una cuenta nueva.",
    });
  }
  if (cajas.length === 0) {
    bloqueos.push({
      codigo: "SIN_CAJA",
      mensaje:
        "Esta cuenta no tiene ninguna caja. Sin caja no hay serie de facturación.",
    });
  }
  // Una caja con registros es la señal de que esta cuenta YA facturó alguna
  // vez (o de que algo metió un registro que no debía). Las dos cosas se
  // arreglan igual: no con un botón, sino mirando qué pasó. Es la lección del
  // 06-10 en La Maestranza, donde la cuenta se tuvo que tirar entera.
  for (const c of cajas) {
    if (c.registrosFiscales > 0) {
      bloqueos.push({
        codigo: "CAJA_CON_REGISTROS",
        mensaje: `La caja «${c.nombre}» (${c.tienda}) ya tiene ${c.registrosFiscales} registro(s) de facturación. Una cuenta no arranca dos veces: mira de dónde salieron antes de seguir.`,
      });
    }
  }
  for (const p of suelo.problemas) {
    bloqueos.push({ codigo: "DATOS_FISCALES", mensaje: p });
  }
  // Al menos un terminal emparejado. No es burocracia: el registro de
  // facturación LO GENERA EL TERMINAL (ADR-019), así que arrancar una cuenta
  // sin ninguno es dejarla facturando sin nadie que pueda emitir.
  if (cajas.length > 0 && cajas.every((c) => c.terminalesEmparejados === 0)) {
    bloqueos.push({
      codigo: "SIN_TERMINAL",
      mensaje:
        "Ninguna caja tiene un terminal emparejado. El registro de facturación lo genera el terminal: sin uno, la cuenta no puede emitir.",
    });
  }

  return {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      onboardingState: tenant.onboardingState,
      esDePruebas: tenant.esDePruebas,
    },
    estado: ensayo ? "ensayo" : "facturando",
    facturaDesde: tenant.facturaDesde?.toISOString() ?? null,
    ensayo: {
      ticketsDeEnsayo,
      borradores,
      devoluciones,
      turnos,
      turnosAbiertos,
      arqueos,
      informesZ,
      comandasDeCocina,
      emailsDeTicket,
      mesasUnidas,
      contadoresDeTicket: registers
        .filter((r) => r.ticketCounter > 0)
        .map((r) => ({ cajaId: r.id, caja: r.name, contador: r.ticketCounter })),
    },
    conserva: {
      productos,
      mesas,
      cajeros,
      terminales,
      impresoras,
      contactos,
      datosFiscales: suelo.ok,
    },
    cajas,
    suelo,
    puedeResetear: ensayo,
    puedeArrancar: bloqueos.length === 0,
    bloqueos,
  };
}

function formatearFecha(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

// ══════════════════════════════════════════════════════════════════════
// LOS ERRORES
// ══════════════════════════════════════════════════════════════════════

/** La cuenta ya factura. Es el 409 que cierra la puerta del reseteo, y no
 *  hay flag de entorno que lo abra: con una factura emitida detrás, borrar
 *  tickets es borrar facturación. */
export class TenantFacturandoError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly facturaDesde: Date,
  ) {
    super(`tenant ${tenantId} factura desde ${facturaDesde.toISOString()}`);
    this.name = "TenantFacturandoError";
  }
}

export class ArranqueBloqueadoError extends Error {
  constructor(public readonly bloqueos: Bloqueo[]) {
    super(`arranque bloqueado: ${bloqueos.map((b) => b.codigo).join(", ")}`);
    this.name = "ArranqueBloqueadoError";
  }
}

// ══════════════════════════════════════════════════════════════════════
// RESETEAR EL ENSAYO
// ══════════════════════════════════════════════════════════════════════

export interface ResultadoReseteo {
  ticketsBorrados: number;
  borradoresBorrados: number;
  devolucionesBorradas: number;
  emailsBorrados: number;
  turnosBorrados: number;
  mesasDesagrupadas: number;
  contadoresAZero: number;
  subidasBorradas: number;
}

/**
 * Deja la cuenta como estaba antes del ensayo, sin tocar nada de lo que se
 * configuró.
 *
 * SE BORRA: los tickets de ensayo (`TEST`) y lo que cuelga de ellos (líneas,
 * pagos, devoluciones, trabajos de email, comandas de cocina), los
 * borradores —que son las mesas abiertas—, los turnos con sus arqueos y sus
 * informes Z, las agrupaciones de mesas y el contador de referencia interna
 * de cada caja.
 *
 * SE CONSERVA: el catálogo, la sala, los cajeros, los terminales, las
 * impresoras, los datos fiscales y los contactos. Todo lo que cuesta una
 * tarde de implantación se queda.
 *
 * Y no se toca `fiscal_records`, porque en una cuenta en ensayo está vacía.
 *
 * El ORDEN de los borrados no es cosmético, lo imponen las FK y los
 * triggers del sello (S1):
 *
 *   1. Devoluciones y trabajos de email (los hace `purgeTestData`).
 *      `Refund.originalTicket` es RESTRICT: con un abono vivo, borrar su
 *      ticket LANZA.
 *   2. Tickets. Al borrar el PADRE, la cascada de líneas y pagos pasa el
 *      guardián del sello —comprueba si el ticket sigue existiendo y ya no
 *      existe—, que es la puerta que S1 dejó abierta a propósito.
 *   3. Turnos. `Ticket.shift` es RESTRICT, así que van después. Al borrar el
 *      turno, sus arqueos y sus Z caen por cascada (y el guardián del Z
 *      también comprueba que el turno ya no está).
 */
export async function resetearEnsayo(params: {
  prisma: PrismaClient;
  tenantId: string;
}): Promise<ResultadoReseteo> {
  const { prisma, tenantId } = params;
  return prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, facturaDesde: true },
    });
    if (!tenant) throw new TenantNoExisteError(tenantId);
    // La puerta, DENTRO de la transacción. Si alguien pulsó «Empezar a
    // facturar» entre la previsualización y este botón, aquí se para.
    if (!enEnsayo(tenant)) {
      throw new TenantFacturandoError(tenantId, tenant.facturaDesde!);
    }
    return borrarElEnsayo(tx, tenantId);
  });
}

/** El borrado, para que lo compartan el reseteo y el arranque. Asume que la
 *  cuenta está en ensayo: lo comprueba el llamante, dentro de su
 *  transacción. */
async function borrarElEnsayo(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<ResultadoReseteo> {
  const purga = await purgeTestData(tx, tenantId, {
    incluirBorradores: true,
    // Resetear CONSERVA los cajeros, y el técnico es uno. Ver la nota de
    // `PurgeTestDataOptions`.
    incluirCajeroTecnico: false,
  });

  const registers = await tx.register.findMany({
    where: { store: { tenantId } },
    select: { id: true, ticketCounter: true },
  });
  const registerIds = registers.map((r) => r.id);

  const turnos = await tx.shift.deleteMany({
    where: { registerId: { in: registerIds } },
  });

  const mesas = await tx.table.updateMany({
    where: { store: { tenantId }, groupedIntoTableId: { not: null } },
    data: { groupedIntoTableId: null },
  });

  // El contador de la referencia interna. No es el número de la factura —ése
  // lo da la cadena de la caja, que está vacía—, pero sí lo que el cliente
  // ve impreso: arrancar con «TICKET 000014» después de un ensayo de trece
  // ventas es contarle al cliente que ya había vendido.
  const contadores = await tx.register.updateMany({
    where: { id: { in: registerIds }, ticketCounter: { not: 0 } },
    data: { ticketCounter: 0 },
  });

  // Las subidas a Holded que hubieran quedado en cola. En ensayo no se
  // encola ninguna (el gate no las crea para un ticket `TEST`), así que esto
  // es la escoba de lo que dejaran versiones anteriores — y lo que impide
  // que un job viejo suba a Holded un documento de una venta que ya no
  // existe.
  const subidas = await tx.holdedUpload.deleteMany({ where: { tenantId } });

  return {
    ticketsBorrados: purga.ticketsTestPurged,
    borradoresBorrados: purga.borradoresPurged,
    devolucionesBorradas: purga.refundsPurged,
    emailsBorrados: purga.emailJobsPurged,
    turnosBorrados: turnos.count,
    mesasDesagrupadas: mesas.count,
    contadoresAZero: contadores.count,
    subidasBorradas: subidas.count,
  };
}

// ══════════════════════════════════════════════════════════════════════
// EMPEZAR A FACTURAR
// ══════════════════════════════════════════════════════════════════════

export interface ResultadoArranque {
  facturaDesde: string;
  reseteo: ResultadoReseteo;
  /** La foto de la cuenta en el momento de arrancar, para el audit. */
  previa: PrevisualizacionPuestaEnMarcha;
}

/**
 * La cuenta empieza a facturar. Una vez, y no se deshace.
 *
 * Todo dentro de UNA transacción, y en este orden:
 *
 *   1. Se vuelve a previsualizar. Si algo cambió desde la pantalla —alguien
 *      cobró, alguien revocó el terminal— se para con los MISMOS bloqueos
 *      que enseñó la previsualización.
 *   2. Se resetea el ensayo. Antes de fijar la fecha y no después: lo que
 *      quede sin borrar pasaría a ser histórico de un comercio que factura,
 *      y entonces ya no se puede borrar sin tocar su contabilidad.
 *   3. Se fija `facturaDesde = now()`.
 *
 * Desde el commit, la siguiente venta de ese comercio es su factura `C1/1`:
 * la cadena de cada caja está vacía y `ingestFiscalRecord` numera desde el
 * principio.
 *
 * No hay botón de deshacer, y no lo hay por construcción: quitar la fecha
 * dejaría a un comercio con facturas emitidas y en ensayo, que es el estado
 * en el que el reseteo borraría facturación. El CHECK de la base y el 409 de
 * `resetearEnsayo` son las dos cerraduras de esa puerta.
 */
export async function arrancarFacturacion(params: {
  prisma: PrismaClient;
  tenantId: string;
  /** Inyectable SÓLO para los tests. En producción es `new Date()`. */
  ahora?: Date;
}): Promise<ResultadoArranque> {
  const { prisma, tenantId } = params;
  return prisma.$transaction(async (tx) => {
    const previa = await previsualizarPuestaEnMarcha(tx, tenantId);
    if (!previa.puedeArrancar) {
      throw new ArranqueBloqueadoError(previa.bloqueos);
    }
    const reseteo = await borrarElEnsayo(tx, tenantId);
    const ahora = params.ahora ?? new Date();
    await tx.tenant.update({
      where: { id: tenantId },
      data: { facturaDesde: ahora },
    });
    return {
      facturaDesde: ahora.toISOString(),
      reseteo,
      previa,
    };
  });
}
