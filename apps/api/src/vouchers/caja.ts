// B-reservas-8 · EL CANJE EN CAJA: marcar una línea con un bono,
// desmarcarla y consumir al cobrar.
//
// ── Las tres pantallas que esto sostiene ───────────────────────────────
//
//   1. **Canjear con cita.** Al cerrar en caja una cita con bono, la línea
//      del servicio sale YA MARCADA, «Con bono B87 · quedan 3 → 2» y a 0 €.
//      Eso lo hace `agenda/checkout.ts` al construir el borrador.
//   2. **Desmarcar.** La cajera puede quitarlo: entonces lo apartado se
//      LIBERA y la línea se cobra normal.
//   3. **Canjear sin cita** (la peluquería de Sole, que no usa rejilla). Al
//      añadir un servicio a un ticket con ficha, si un bono suyo lo cubre
//      se propone igual. Aquí sí se aparta al marcar —y no al cobrar— para
//      que dos terminales no propongan la misma sesión.
//
// ── Y la decisión que las une ──────────────────────────────────────────
//
// **Marcar siempre APARTA.** Da igual si viene de una cita o no: el
// borrador puede estar abierto media hora y mientras lo esté, esa sesión no
// puede ofrecerse en otra pantalla. Así hay UN solo camino —`apartar()` al
// marcar, `consumir()` al cobrar, `liberar()` al desmarcar— en vez de dos
// contabilidades que hay que mantener de acuerdo.
//
// El apartado sin cita necesita un `appointmentId`, que es lo que hace
// idempotente a `consumir()`... y sin cita no hay ninguno. Por eso el canje
// sin cita va por el camino `consumirSinCita`, cuya llave de idempotencia
// es la LÍNEA DEL TICKET: el mismo cobro reintentado no gasta dos sesiones.

import { mensajeNoApartar } from "@mipiacetpv/bonos";
import { Prisma } from "@mipiacetpv/db";
import type { PrismaClient } from "@mipiacetpv/db";

import { recomputeTicketTotals } from "../tables/operativa.js";
import { estaCaducado } from "./caducidad.js";
import { importeDeLaLineaCents, type ModoCanje } from "./canje.js";
import { resolverCobertura } from "./cobertura.js";
import {
  apartar,
  bonosQueCubren,
  consumir,
  liberar,
  type BonoResumen,
} from "./gate.js";
import { serviciosACubrir } from "./servicios.js";

// ══════════════════════════════════════════════════════════════════════
// LO QUE SE PROPONE EN PANTALLA
// ══════════════════════════════════════════════════════════════════════

export interface PropuestaDeCanje {
  ticketLineId: string;
  serviceId: string;
  nameSnapshot: string;
  /** TODOS los bonos que cubren esta línea. **La puerta no elige**: si hay
   *  dos, el front pregunta. */
  bonos: BonoResumen[];
  /** El bono con el que la línea ya está marcada, si lo está. */
  marcadoCon: string | null;
}

/**
 * Qué líneas de este borrador se podrían pagar con un bono de la ficha del
 * ticket.
 *
 * Sin ficha en el ticket no hay propuesta ninguna, y eso NO es un error: es
 * el 99 % de los tickets de un bar. Devuelve `[]` sin tocar la base.
 */
export async function propuestasParaElTicket(
  prisma: PrismaClient,
  input: { tenantId: string; ticketId: string; ahora: Date },
): Promise<PropuestaDeCanje[]> {
  const ticket = await prisma.ticket.findFirst({
    where: { id: input.ticketId, tenantId: input.tenantId },
    select: {
      clientId: true,
      lines: {
        select: {
          id: true,
          productId: true,
          nameSnapshot: true,
          voucherId: true,
        },
      },
    },
  });
  if (!ticket?.clientId) return [];
  const lineasDeServicio = ticket.lines.filter(
    (l): l is typeof l & { productId: string } => l.productId != null,
  );
  if (lineasDeServicio.length === 0) return [];

  const servicios = await serviciosACubrir(
    prisma,
    input.tenantId,
    lineasDeServicio.map((l) => l.productId),
  );
  const porId = new Map(servicios.map((s) => [s.id, s]));
  const out: PropuestaDeCanje[] = [];
  for (const linea of lineasDeServicio) {
    const servicio = porId.get(linea.productId);
    if (!servicio) continue;
    const bonos = await bonosQueCubren(prisma, {
      tenantId: input.tenantId,
      clientId: ticket.clientId,
      servicios: [servicio],
      ahora: input.ahora,
    });
    // Una línea YA MARCADA se devuelve aunque su bono ya no tenga libres
    // (la sesión está apartada para ella, así que `bonosQueCubren` no lo
    // ve): si no, el chip «Con bono B87» desaparecería de la pantalla en
    // cuanto fuera la última sesión.
    if (bonos.length === 0 && linea.voucherId == null) continue;
    out.push({
      ticketLineId: linea.id,
      serviceId: linea.productId,
      nameSnapshot: linea.nameSnapshot,
      bonos,
      marcadoCon: linea.voucherId,
    });
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════
// MARCAR Y DESMARCAR
// ══════════════════════════════════════════════════════════════════════

export type ResultadoMarcar =
  | { ok: true; bono: BonoResumen; importeCents: number }
  | {
      ok: false;
      status: number;
      error: string;
      message: string;
    };

/**
 * Marca una línea de un BORRADOR para pagarse con un bono.
 *
 * El importe de la línea lo pone el SERVIDOR desde el ajuste del centro
 * (`bonoModoCanje`, el frente P5): del navegador sólo llega el id del bono.
 */
export async function marcarLineaConBono(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    ticketId: string;
    ticketLineId: string;
    voucherId: string;
    userId: string | null;
    canal: "tpv" | "panel";
    ahora: Date;
  },
): Promise<ResultadoMarcar> {
  return prisma.$transaction(async (tx) => {
    const ctx = await contextoDeLinea(tx, input);
    if ("error" in ctx) return ctx;
    const { linea, ticket, bonoFila, modo } = ctx;
    if (linea.voucherId != null) {
      return {
        ok: false as const,
        status: 409,
        error: "LINEA_YA_MARCADA",
        message:
          "Esta línea ya se está pagando con un bono. Quítalo antes de poner otro.",
      };
    }
    const servicios = await serviciosACubrir(tx, input.tenantId, [
      linea.productId!,
    ]);

    // Marcar APARTA. Con cita, la sesión puede estar apartada ya desde el
    // alta: `apartar()` contesta `ya_aplicado` y eso aquí NO es un error —
    // es justo el caso normal del canje con cita.
    let bono: BonoResumen | null = null;
    if (ticket.appointmentId != null) {
      const res = await apartar(tx, {
        tenantId: input.tenantId,
        voucherId: input.voucherId,
        appointmentId: ticket.appointmentId,
        clientId: ticket.clientId,
        servicios,
        detalle: "Apartada al marcar el canje en caja.",
        canal: input.canal,
        userId: input.userId,
        actor: input.userId == null ? "Web" : null,
        ahora: input.ahora,
      });
      if (!res.ok && res.motivo !== "ya_aplicado") {
        return {
          ok: false as const,
          status: 409,
          error: `BONO_${res.motivo.toUpperCase()}`,
          message: mensajeNoApartar(res.motivo),
        };
      }
      bono = res.ok ? res.bono : (res.bono ?? null);
    } else {
      // Sin cita: no hay nada que apartar (`consumir()` descontará al
      // cobrar, con la línea del ticket como llave de idempotencia), pero
      // sí hay que comprobar que el bono sigue sirviendo. Se comprueba
      // sobre la fila ya leída con `FOR UPDATE` en `contextoDeLinea`.
      if (bonoFila.sessionsLeft <= 0) {
        return {
          ok: false as const,
          status: 409,
          error: "BONO_AGOTADO",
          message: "Ese bono no tiene sesiones libres.",
        };
      }
      bono = bonoFila.resumen;
    }

    const importeCents = importeDeLaLineaCents(modo, {
      valorCartaCents: bonoFila.valorCartaCents,
      sesionesTotal: bonoFila.sessionsTotal,
    });
    await tx.ticketLine.update({
      where: { id: input.ticketLineId },
      data: {
        voucherId: input.voucherId,
        unitPrice: new Prisma.Decimal(importeCents / 100),
        subtotal: new Prisma.Decimal((importeCents / 100) * Number(linea.units)),
        total: new Prisma.Decimal((importeCents / 100) * Number(linea.units)),
      },
    });
    await recalcularTotales(tx, input.ticketId);
    return { ok: true as const, bono: bono!, importeCents };
  });
}

/**
 * Quita el bono de una línea: lo apartado se LIBERA y la línea vuelve a su
 * precio.
 *
 * El precio se recupera DEL PRODUCTO, no de ningún sitio donde lo
 * guardáramos antes: «el precio lo pone el servidor, desde el producto».
 */
export async function desmarcarLinea(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    ticketId: string;
    ticketLineId: string;
    userId: string | null;
    canal: "tpv" | "panel";
    ahora: Date;
  },
): Promise<{ ok: true } | { ok: false; status: number; error: string; message: string }> {
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findFirst({
      where: { id: input.ticketId, tenantId: input.tenantId, status: "DRAFT" },
      select: { id: true, appointment: { select: { id: true } } },
    });
    if (!ticket) {
      return {
        ok: false as const,
        status: 404,
        error: "TICKET_NOT_FOUND_OR_NOT_DRAFT",
        message: "Sólo se puede quitar el bono de un ticket en borrador.",
      };
    }
    const linea = await tx.ticketLine.findFirst({
      where: { id: input.ticketLineId, ticketId: input.ticketId },
      select: { id: true, productId: true, units: true, voucherId: true },
    });
    if (!linea) {
      return {
        ok: false as const,
        status: 404,
        error: "LINE_NOT_FOUND",
        message: "Línea no encontrada.",
      };
    }
    if (linea.voucherId == null) {
      // Idempotencia: quitar lo que no está puesto no es un error.
      return { ok: true as const };
    }
    if (ticket.appointment) {
      await liberar(tx, {
        tenantId: input.tenantId,
        appointmentId: ticket.appointment.id,
        detalle: "Liberada: en caja se quitó el bono de la línea.",
        canal: input.canal,
        userId: input.userId,
        actor: input.userId == null ? "Web" : null,
        ahora: input.ahora,
      });
    }
    const precio = linea.productId
      ? await tx.product.findFirst({
          where: { id: linea.productId, tenantId: input.tenantId },
          select: { basePrice: true },
        })
      : null;
    const unitPrice = Number(precio?.basePrice ?? 0);
    await tx.ticketLine.update({
      where: { id: linea.id },
      data: {
        voucherId: null,
        unitPrice: new Prisma.Decimal(unitPrice),
        subtotal: new Prisma.Decimal(unitPrice * Number(linea.units)),
        total: new Prisma.Decimal(unitPrice * Number(linea.units)),
      },
    });
    await recalcularTotales(tx, input.ticketId);
    return { ok: true as const };
  });
}

// ══════════════════════════════════════════════════════════════════════
// CONSUMIR AL COBRAR
// ══════════════════════════════════════════════════════════════════════

export interface CanjeAlCobrar {
  voucherId: string;
  ticketLineId: string;
  code: string;
  /** `true` si la sesión se consumió; `false` si se liberó porque lo que se
   *  hizo no lo cubría y la línea se cobra normal. */
  consumida: boolean;
}

/**
 * Lo apartado pasa a consumido, **dentro de la transacción del cobro**.
 *
 * Y la otra mitad: si la cita tenía una sesión apartada y NINGUNA línea del
 * ticket se paga con ese bono —porque lo que se hizo acabó siendo otra cosa
 * (clinica-3: se cobra lo que se hizo, no lo que se reservó)— **lo apartado
 * se libera**. Nunca se consume un bono contra un servicio que no cubre, y
 * tampoco se queda una sesión apartada para siempre en una cita ya cobrada.
 */
export async function canjearAlCobrar(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    ticketId: string;
    userId: string | null;
    canal: "tpv" | "panel";
    ahora: Date;
  },
): Promise<CanjeAlCobrar[]> {
  const lineas = await tx.$queryRaw<
    Array<{ id: string; voucher_id: string; product_id: string | null }>
  >`
    SELECT "id", "voucher_id", "product_id"
      FROM "ticket_lines"
     WHERE "ticket_id" = ${input.ticketId}::uuid
       AND "voucher_id" IS NOT NULL`;
  const cita = await tx.$queryRaw<Array<{ id: string; voucher_id: string | null }>>`
    SELECT "id", "voucher_id"
      FROM "appointments"
     WHERE "ticket_id" = ${input.ticketId}::uuid
       AND "tenant_id" = ${input.tenantId}::uuid
     LIMIT 1`;
  const appointmentId = cita[0]?.id ?? null;
  const bonoDeLaCita = cita[0]?.voucher_id ?? null;

  const out: CanjeAlCobrar[] = [];
  for (const linea of lineas) {
    const servicios = await serviciosACubrir(
      tx,
      input.tenantId,
      linea.product_id ? [linea.product_id] : [],
    );
    // Con cita y con el bono de la cita → el camino de la cita (lo apartado
    // pasa a consumido). En cualquier otro caso → el camino sin cita, cuya
    // llave de idempotencia es esta línea.
    const deLaCita = appointmentId != null && bonoDeLaCita === linea.voucher_id;
    const res = await consumir(tx, {
      tenantId: input.tenantId,
      appointmentId: deLaCita ? appointmentId : null,
      voucherId: deLaCita ? null : linea.voucher_id,
      ticketLineId: linea.id,
      servicio: servicios[0] ?? { id: "", tags: [] },
      detalle: "Consumida al cobrar.",
      detalleSiNoCubre:
        "Liberada al cobrar: lo que se hizo no lo cubre este bono, así que la línea se cobra normal.",
      canal: input.canal,
      userId: input.userId,
      actor: input.userId == null ? "Web" : null,
      ahora: input.ahora,
    });
    out.push({
      voucherId: linea.voucher_id,
      ticketLineId: linea.id,
      code: res.bono?.code ?? "",
      consumida: res.ok,
    });
  }

  // La cita tenía sesión apartada y ninguna línea la gastó: se libera.
  if (
    appointmentId != null &&
    bonoDeLaCita != null &&
    !lineas.some((l) => l.voucher_id === bonoDeLaCita)
  ) {
    const res = await liberar(tx, {
      tenantId: input.tenantId,
      appointmentId,
      detalle:
        "Liberada al cobrar: lo que se hizo no lo cubre este bono, así que se cobró normal.",
      canal: input.canal,
      userId: input.userId,
      actor: input.userId == null ? "Web" : null,
      ahora: input.ahora,
    });
    if (!res.yaEstaba) {
      out.push({
        voucherId: bonoDeLaCita,
        ticketLineId: "",
        code: res.bono?.code ?? "",
        consumida: false,
      });
    }
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════
// PIEZAS COMPARTIDAS
// ══════════════════════════════════════════════════════════════════════

interface ContextoDeLinea {
  linea: {
    id: string;
    productId: string | null;
    units: Prisma.Decimal;
    voucherId: string | null;
  };
  ticket: { appointmentId: string | null; clientId: string | null };
  bonoFila: {
    resumen: BonoResumen;
    sessionsLeft: number;
    sessionsTotal: number;
    valorCartaCents: number;
  };
  modo: ModoCanje;
}

/** Lee y valida todo lo que hace falta para marcar, con la fila del bono ya
 *  bloqueada. Devuelve el rechazo tal cual para que la ruta lo reenvíe. */
async function contextoDeLinea(
  tx: Prisma.TransactionClient,
  input: {
    tenantId: string;
    ticketId: string;
    ticketLineId: string;
    voucherId: string;
  },
): Promise<ContextoDeLinea | { ok: false; status: number; error: string; message: string }> {
  const ticket = await tx.ticket.findFirst({
    where: { id: input.ticketId, tenantId: input.tenantId, status: "DRAFT" },
    select: {
      id: true,
      clientId: true,
      appointment: { select: { id: true } },
    },
  });
  if (!ticket) {
    return {
      ok: false,
      status: 404,
      error: "TICKET_NOT_FOUND_OR_NOT_DRAFT",
      message: "Sólo se puede canjear un bono sobre un ticket en borrador.",
    };
  }
  if (!ticket.clientId) {
    return {
      ok: false,
      status: 409,
      error: "TICKET_SIN_CLIENTE",
      message:
        "Para canjear un bono hace falta la ficha de la clienta en el ticket: el bono es de una ficha.",
    };
  }
  const linea = await tx.ticketLine.findFirst({
    where: { id: input.ticketLineId, ticketId: input.ticketId },
    select: { id: true, productId: true, units: true, voucherId: true },
  });
  if (!linea || linea.productId == null) {
    return {
      ok: false,
      status: 404,
      error: "LINE_NOT_FOUND",
      message:
        "Línea no encontrada, o es una línea libre: un bono se canjea contra un servicio del catálogo.",
    };
  }
  const filas = await tx.$queryRaw<
    Array<{
      id: string;
      code: string;
      client_id: string;
      name_snapshot: string;
      sessions_total: number;
      sessions_left: number;
      sessions_reserved: number;
      valor_carta_cents: number;
      expires_at: Date | null;
      status: string;
      es_prueba: boolean;
    }>
  >`
    SELECT "id", "code", "client_id", "name_snapshot", "sessions_total",
           "sessions_left", "sessions_reserved", "valor_carta_cents",
           "expires_at", "status", "es_prueba"
      FROM "vouchers"
     WHERE "id" = ${input.voucherId}::uuid
       AND "tenant_id" = ${input.tenantId}::uuid
     FOR UPDATE`;
  const b = filas[0];
  if (!b) {
    return {
      ok: false,
      status: 404,
      error: "BONO_NOEXISTE",
      message: "No existe ese bono en este negocio.",
    };
  }
  if (b.client_id !== ticket.clientId) {
    return {
      ok: false,
      status: 409,
      error: "BONO_OTRO_CLIENTE",
      message:
        "Ese bono es de otra ficha. Comprueba el número, o busca la ficha a la que pertenece.",
    };
  }
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: input.tenantId },
    select: { bonoModoCanje: true },
  });
  return {
    linea,
    ticket: {
      appointmentId: ticket.appointment?.id ?? null,
      clientId: ticket.clientId,
    },
    bonoFila: {
      resumen: {
        id: b.id,
        code: b.code,
        clientId: b.client_id,
        nombre: b.name_snapshot,
        sesionesTotal: Number(b.sessions_total),
        sesionesLibres: Number(b.sessions_left),
        sesionesApartadas: Number(b.sessions_reserved),
        caducaAt: b.expires_at,
        status: b.status,
        esPrueba: b.es_prueba,
      },
      sessionsLeft: Number(b.sessions_left),
      sessionsTotal: Number(b.sessions_total),
      valorCartaCents: Number(b.valor_carta_cents),
    },
    modo: tenant.bonoModoCanje as ModoCanje,
  };
}

/** Los totales del ticket, recalculados por el camino de siempre
 *  (`tables/operativa.ts`). Aquí no se reimplementa ninguna aritmética de
 *  totales: dos reglas para recalcular un total es como la sala dice 43,40 €
 *  y la cuenta cobra 33,40 €. */
async function recalcularTotales(
  tx: Prisma.TransactionClient,
  ticketId: string,
): Promise<void> {
  await recomputeTicketTotals(tx, ticketId);
}

// ══════════════════════════════════════════════════════════════════════
// EL BORRADOR DE UNA CITA CON BONO
// ══════════════════════════════════════════════════════════════════════

export interface CanjeDelBorrador {
  /** Índice de la línea que se paga con el bono. La PRIMERA que el bono
   *  cubre: una cita gasta UNA sesión, no una por línea. */
  indice: number;
  voucherId: string;
  code: string;
  importeCents: number;
  /** Para el chip «Con bono B87 · quedan 3 → 2». */
  sesionesLibres: number;
  sesionesApartadas: number;
}

/**
 * Qué línea del borrador de una cita sale YA MARCADA con su bono.
 *
 * Se llama desde `agenda/checkout.ts` al construir el borrador, así que lo
 * que la cajera ve al abrir el cobro ya está decidido por el servidor: la
 * línea del servicio a 0 € y el chip con el bono. No hay ningún momento en
 * que la pantalla enseñe un precio que luego cambia.
 *
 * `null` cuando el bono no cubre NINGUNA de las líneas. Eso pasa de verdad
 * y es el caso de clinica-3: la cita se dio para «Quiropodia» con un bono
 * de quiropodia y la podóloga acabó haciendo un vendaje. Entonces no se
 * marca nada, se cobra normal, y lo apartado se libera al cobrar
 * (`canjearAlCobrar`).
 */
export async function canjeParaElBorrador(
  prisma: PrismaClient,
  input: {
    tenantId: string;
    voucherId: string;
    /** Los productos de las líneas del borrador, EN ORDEN. */
    productIds: string[];
    ahora: Date;
  },
): Promise<CanjeDelBorrador | null> {
  const filas = await prisma.$queryRaw<
    Array<{
      id: string;
      code: string;
      sessions_total: number;
      sessions_left: number;
      sessions_reserved: number;
      valor_carta_cents: number;
      covers_service_ids: string[];
      covers_tag_slugs: string[];
      expires_at: Date | null;
      status: string;
    }>
  >`
    SELECT "id", "code", "sessions_total", "sessions_left", "sessions_reserved",
           "valor_carta_cents", "covers_service_ids", "covers_tag_slugs",
           "expires_at", "status"
      FROM "vouchers"
     WHERE "id" = ${input.voucherId}::uuid
       AND "tenant_id" = ${input.tenantId}::uuid
     LIMIT 1`;
  const b = filas[0];
  if (!b || b.status === "ANULADO") return null;
  if (estaCaducado(b.expires_at, input.ahora)) return null;

  const servicios = await serviciosACubrir(
    prisma,
    input.tenantId,
    input.productIds,
  );
  const porId = new Map(servicios.map((s) => [s.id, s]));
  const cobertura = {
    coversServiceIds: b.covers_service_ids,
    coversTagSlugs: b.covers_tag_slugs,
  };
  const indice = input.productIds.findIndex((pid) => {
    const s = porId.get(pid);
    return s != null && resolverCobertura(cobertura, s).cubre;
  });
  if (indice < 0) return null;

  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: input.tenantId },
    select: { bonoModoCanje: true },
  });
  return {
    indice,
    voucherId: b.id,
    code: b.code,
    importeCents: importeDeLaLineaCents(tenant.bonoModoCanje as ModoCanje, {
      valorCartaCents: Number(b.valor_carta_cents),
      sesionesTotal: Number(b.sessions_total),
    }),
    sesionesLibres: Number(b.sessions_left),
    sesionesApartadas: Number(b.sessions_reserved),
  };
}
