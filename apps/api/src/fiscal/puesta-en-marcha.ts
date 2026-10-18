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

/**
 * Una venta de una cuenta en ensayo que NO es de ensayo, con el motivo por
 * el que no lo es.
 *
 * En una cuenta en ensayo no puede haber ninguna: es la invariante del
 * bloque entero. Si aparece una, es que algo la metió por un camino que no
 * debería existir —una migración a mano, un despliegue a medias, una cuenta
 * que facturó y a la que alguien le quitó la fecha— y **el reseteo se para
 * en seco**: borrarla sería borrar una venta que llegó a la contabilidad de
 * alguien.
 */
export interface VentaQueNoEsDeEnsayo {
  ticketId: string;
  internalNumber: string;
  estado: string;
  /** `HOLDED`: llegó a Holded y existe allí un documento con su número.
   *  `REGISTRO_FISCAL`: tiene factura emitida por nosotros. */
  motivo: "HOLDED" | "REGISTRO_FISCAL";
  holdedDocumentId: string | null;
  numSerieFactura: string | null;
}

/**
 * ¿Hay en esta cuenta alguna venta que no sea de ensayo?
 *
 * Dos señales, y cualquiera de las dos basta:
 *
 *   · `holded_document_id` — el worker de subida lo escribe cuando Holded
 *     CREA el documento. Si está, existió una factura con número en la
 *     contabilidad del cliente, y eso no se deshace borrando el ticket aquí.
 *     Es la misma señal con la que el backfill de la migración decide qué es
 *     una venta real (regla 3.b), y por la misma razón.
 *   · un `fiscal_record` colgando del ticket — factura emitida por nosotros.
 *     La base ya lo impediría (la FK es `RESTRICT` y el trigger
 *     `tickets_fiscal_link_guard` lanza), pero un 500 con un mensaje de
 *     clave ajena no le dice a nadie QUÉ ticket mirar.
 *
 * Lo que NO se mira: el estado. `VOIDED`, `PAID`, `SYNCED` o `TEST` dan
 * igual — la foto de producción del 18-10 enseñó por qué: Cafetería Sirope
 * tenía 20 anuladas, ninguna en Holded, y no ha vendido nunca. El estado
 * dice cómo acabó el ticket, no si fue real.
 */
export async function comprobarQueNadaEsReal(
  tx: Tx,
  tenantId: string,
): Promise<VentaQueNoEsDeEnsayo[]> {
  const conHolded = await tx.ticket.findMany({
    where: { tenantId, holdedDocumentId: { not: null } },
    orderBy: { createdAt: "asc" },
    take: 50,
    select: {
      id: true,
      internalNumber: true,
      status: true,
      holdedDocumentId: true,
    },
  });
  const conRegistro = await tx.fiscalRecord.findMany({
    where: { tenantId, ticketId: { not: null } },
    orderBy: { chainIndex: "asc" },
    take: 50,
    select: {
      ticketId: true,
      numSerieFactura: true,
      ticket: { select: { internalNumber: true, status: true } },
    },
  });

  const vistos = new Set<string>();
  const ventas: VentaQueNoEsDeEnsayo[] = [];
  for (const t of conHolded) {
    vistos.add(t.id);
    ventas.push({
      ticketId: t.id,
      internalNumber: t.internalNumber,
      estado: t.status,
      motivo: "HOLDED",
      holdedDocumentId: t.holdedDocumentId,
      numSerieFactura: null,
    });
  }
  for (const r of conRegistro) {
    if (r.ticketId == null || vistos.has(r.ticketId)) continue;
    ventas.push({
      ticketId: r.ticketId,
      internalNumber: r.ticket?.internalNumber ?? "(sin referencia)",
      estado: r.ticket?.status ?? "(desconocido)",
      motivo: "REGISTRO_FISCAL",
      holdedDocumentId: null,
      numSerieFactura: r.numSerieFactura,
    });
  }
  return ventas;
}

/** El texto de un bloqueo con las ventas que no son de ensayo dentro.
 *  Vive aquí para que la previsualización y el error de la ejecución digan
 *  LO MISMO. */
export function mensajeDeVentasQueNoSonDeEnsayo(
  ventas: VentaQueNoEsDeEnsayo[],
): string {
  const detalle = ventas
    .slice(0, 10)
    .map((v) =>
      v.motivo === "HOLDED"
        ? `${v.internalNumber} (${v.estado}) · documento de Holded ${v.holdedDocumentId}`
        : `${v.internalNumber} (${v.estado}) · factura ${v.numSerieFactura}`,
    )
    .join("; ");
  const mas = ventas.length > 10 ? ` …y ${ventas.length - 10} más` : "";
  return (
    `Esta cuenta está en ensayo y tiene ${ventas.length} venta(s) que NO son de ensayo: ${detalle}${mas}. ` +
    "No se borra nada hasta saber de dónde salieron: una venta que llegó a Holded o que tiene factura emitida " +
    "existe en la contabilidad de alguien, y borrarla aquí no la deshace."
  );
}

/** La foto del ensayo: qué hay ahora mismo de lo que el reseteo borra. */
export interface FotoDelEnsayo {
  ticketsDeEnsayo: number;
  borradores: number;
  /** puesta-en-marcha (ADR-021) · TODOS los tickets de la cuenta, uno por
   *  estado. El reseteo se los lleva todos —en una cuenta en ensayo nada es
   *  real—, así que la pantalla tiene que enseñarlos todos: «20 anuladas» no
   *  se lee igual que «3 de ensayo», y con el desglose delante nadie pulsa
   *  sin saber qué se va. */
  ticketsPorEstado: Array<{ estado: string; cuantos: number }>;
  /** La suma. Es el número que de verdad se borra. */
  ticketsTotales: number;
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
  /** puesta-en-marcha (ADR-021) · lo que no puede estar aquí. Vacío siempre,
   *  salvo que algo haya metido una venta real en una cuenta en ensayo. */
  ventasQueNoSonDeEnsayo: VentaQueNoEsDeEnsayo[];
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

  // puesta-en-marcha (ADR-021) · TODOS los tickets, por estado. El reseteo
  // se los lleva todos, así que la pantalla no puede enseñar sólo los `TEST`:
  // en Sirope eso habría dicho «3 tickets de ensayo» y se habrían borrado 23.
  const porEstado = await tx.ticket.groupBy({
    by: ["status"],
    where: { tenantId },
    _count: { _all: true },
  });
  const ticketsPorEstado = porEstado
    .map((p) => ({ estado: String(p.status), cuantos: p._count._all }))
    .sort((a, b) => a.estado.localeCompare(b.estado));
  const ticketsTotales = ticketsPorEstado.reduce((n, p) => n + p.cuantos, 0);

  // Y lo que NO puede estar aquí.
  const ventasQueNoSonDeEnsayo = ensayo
    ? await comprobarQueNadaEsReal(tx, tenantId)
    : [];

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
  // puesta-en-marcha (ADR-021) · bloquea las DOS acciones, y por motivos
  // distintos: resetear borraría una venta que existe en la contabilidad de
  // alguien, y arrancar resetea antes de fijar la fecha, así que haría lo
  // mismo. La lista entera va en el mensaje: lo que hay que mirar es de
  // dónde salió cada una.
  if (ventasQueNoSonDeEnsayo.length > 0) {
    bloqueos.push({
      codigo: "VENTA_REAL_EN_ENSAYO",
      mensaje: mensajeDeVentasQueNoSonDeEnsayo(ventasQueNoSonDeEnsayo),
    });
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
      ticketsPorEstado,
      ticketsTotales,
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
    ventasQueNoSonDeEnsayo,
    // Resetear se puede mientras la cuenta esté en ensayo Y no haya nada
    // real dentro. Lo segundo es la puerta nueva del 18-10.
    puedeResetear: ensayo && ventasQueNoSonDeEnsayo.length === 0,
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

/** El reseteo se para: hay dentro una venta que no es de ensayo. Lleva la
 *  lista para que la pantalla diga CUÁL, no «no se puede». */
export class EnsayoConVentaRealError extends Error {
  constructor(public readonly ventas: VentaQueNoEsDeEnsayo[]) {
    super(mensajeDeVentasQueNoSonDeEnsayo(ventas));
    this.name = "EnsayoConVentaRealError";
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
  /** Todos los tickets, cualquiera que fuera su estado. */
  ticketsBorrados: number;
  /** Cuántos de cada estado. Después de borrarlos no se puede volver a
   *  contar, así que es lo que va al audit. */
  ticketsPorEstado: Array<{ estado: string; cuantos: number }>;
  /** Los `TEST`, aparte, porque es lo que el audit de la activación lee. */
  ticketsDeEnsayoBorrados: number;
  borradoresBorrados: number;
  devolucionesBorradas: number;
  emailsBorrados: number;
  turnosBorrados: number;
  mesasDesagrupadas: number;
  contadoresAZero: number;
  subidasBorradas: number;
  /** B-reservas-8 · los bonos de prueba que NO colgaban de un ticket (las
   *  altas iniciales del ensayo). Los vendidos se van con su ticket por la
   *  cascada y ya están contados en `ticketsBorrados`. */
  bonosDePruebaBorrados: number;
}

/**
 * Deja la cuenta como estaba antes del ensayo, sin tocar nada de lo que se
 * configuró.
 *
 * SE BORRA: los tickets de ensayo (`TEST`) y lo que cuelga de ellos (líneas,
 * pagos, devoluciones, trabajos de email, comandas de cocina, **y los bonos
 * que se vendieron en ellos**), los borradores —que son las mesas
 * abiertas—, los turnos con sus arqueos y sus informes Z, las agrupaciones
 * de mesas, el contador de referencia interna de cada caja y los bonos de
 * prueba que no colgaban de ningún ticket (las altas iniciales del
 * ensayo).
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
  // Más de los 5 s por defecto de Prisma: un ensayo largo (una semana de
  // demostración en un bar) son miles de tickets con sus líneas, y quedarse
  // en P2028 a mitad dejaría al implantador sin saber si borró o no. No
  // borra nada —la transacción se deshace— pero el susto es gratis.
  return prisma.$transaction(
    async (tx) => {
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
    },
    { timeout: 2 * 60_000, maxWait: 15_000 },
  );
}

/** El borrado, para que lo compartan el reseteo y el arranque. Asume que la
 *  cuenta está en ensayo: lo comprueba el llamante, dentro de su
 *  transacción. */
async function borrarElEnsayo(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<ResultadoReseteo> {
  // LA PUERTA, y va LO PRIMERO: antes de borrar una sola fila.
  //
  // En una cuenta en ensayo nada es real —esa es la invariante del bloque—,
  // así que el reseteo se lleva TODOS los tickets y no sólo los `TEST`. Lo
  // enseñó la foto de producción del 18-10: Cafetería Sirope tenía 20
  // anuladas de la demostración y de las pruebas, y un reseteo que sólo mira
  // los `TEST` se las habría dejado dentro — en el arqueo del cliente el día
  // que empieza.
  //
  // Y si la invariante estuviera rota (una venta que llegó a Holded, una con
  // factura emitida), no se borra NADA y se dice cuál. Es un 409, no un 500:
  // la base lo pararía igual por la FK, pero hablando de una clave ajena.
  const ventas = await comprobarQueNadaEsReal(tx, tenantId);
  if (ventas.length > 0) throw new EnsayoConVentaRealError(ventas);

  const purga = await purgeTestData(tx, tenantId, {
    // TODOS los estados. Ver la nota de arriba y la de
    // `PurgeTestDataOptions`.
    estados: "todos",
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

  // B-reservas-8 · los BONOS DE PRUEBA.
  //
  // Los vendidos en un ticket ya se han ido por la cascada de
  // `vouchers.sold_ticket_id` al borrar sus tickets, unas líneas más
  // arriba. Esto se lleva los que NO cuelgan de ningún ticket: las ALTAS
  // INICIALES: el bono de papel que el implantador dio de alta durante el
  // ensayo para enseñar la pantalla. Nacen `es_prueba` porque la cuenta
  // está en ensayo, y sin esta línea se quedarían dentro —con sus líneas
  // del libro— el día que el cliente empieza.
  //
  // El trigger `voucher_movements_append_only` deja pasar el borrado de
  // una línea marcada `es_prueba`: es su escapatoria de ADR-021 §5.1, y
  // esta cascada es el único sitio que la usa.
  const bonos = await tx.voucher.deleteMany({
    where: { tenantId, esPrueba: true },
  });

  return {
    ticketsBorrados: purga.ticketsPurgedTotal,
    ticketsPorEstado: purga.ticketsPorEstado,
    ticketsDeEnsayoBorrados: purga.ticketsTestPurged,
    borradoresBorrados: purga.borradoresPurged,
    devolucionesBorradas: purga.refundsPurged,
    emailsBorrados: purga.emailJobsPurged,
    turnosBorrados: turnos.count,
    mesasDesagrupadas: mesas.count,
    contadoresAZero: contadores.count,
    subidasBorradas: subidas.count,
    bonosDePruebaBorrados: bonos.count,
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
  // Mismo motivo que en `resetearEnsayo`: resetea antes de fijar la fecha, y
  // eso es todo el ensayo del comercio dentro de una sola transacción.
  return prisma.$transaction(
    async (tx) => {
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
    },
    { timeout: 2 * 60_000, maxWait: 15_000 },
  );
}
