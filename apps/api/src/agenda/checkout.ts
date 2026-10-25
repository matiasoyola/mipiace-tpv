// Puente cita → caja (ADR-R8 §5). La métrica única del MVP: nº de citas del
// día cerradas en caja desde la agenda SIN re-teclear el ticket.
//
// "Cobrar en caja" abre/enlaza un ticket DRAFT PRE-POBLADO con las líneas de
// servicio del visit (cada `appointment_item` → `ticket_line`, resuelto por
// `serviceId` = product.id, NUNCA por sku ad-hoc). Usa el CAMINO DE COBRO
// EXISTENTE INTACTO (GET-back, tolerancia 5 cts, `/pay` idempotente,
// ADR-010): este módulo ALIMENTA ese camino, NO lo toca. `appointment.
// ticketId` enlaza ambos; el front, al cerrar el ticket por el camino
// normal, hace `PATCH /agenda/appointments/:id { status: COMPLETED }` (no se
// puede enganchar en el cobro sin tocarlo). El DRAFT que se crea aquí es
// idéntico al que abre una mesa (`tables/operativa.ts::getOrCreateDraftTicket`).
//
// ── clinica-3 · LO ÚNICO que este bloque cambia aquí ─────────────────
//
// **De dónde salen las líneas cuando la cita tiene una sesión clínica
// cerrada**: de los TRATAMIENTOS que la podóloga marcó, en vez de de los
// servicios con los que se dio la cita. Nada más. Ni el ticket, ni el
// enlace, ni la idempotencia, ni el `/pay`, ni la imputación al turno
// cambian una línea.
//
// Por qué aquí y no en un segundo camino de cobro: porque el prompt del
// bloque lo pide así («reutiliza el camino que ya existe de la cita a la
// caja: no inventes un segundo cobro») y porque es verdad que es el mismo
// acto. Lo que la paciente paga es la visita; lo que cambia es que la
// visita ya se sabe qué fue. Un endpoint propio habría duplicado el
// GET-back del DRAFT, el 409 de «ya se cobró», la elección del turno y el
// `IN_SERVICE` — cuatro cosas que B-reservas-5 pagó una vez.
//
// Y por qué los servicios de la cita NO bastan: la cita se da para
// «Quiropodia» y lo que se hizo fueron tres cosas (quiropodia, quitar un
// callo y un vendaje). Cobrar el servicio de la cita sería cobrar la
// previsión y no el trabajo, que es exactamente lo que la podóloga hace
// hoy en papel y de memoria.
//
// **Una cita que no es clínica no nota NADA.** La capability del tenant es
// lo primero que se mira, así que los catorce tenants sin clínica no pagan
// ni una consulta y recorren el mismo código con la misma lista de líneas
// que antes de este bloque. Un test lo fija.

import { randomUUID } from "node:crypto";

import { Prisma } from "@mipiacetpv/db";
import type { PrismaClient } from "@mipiacetpv/db";

import { lineasDeLaSesionCerrada } from "../clinica/lineas-de-la-sesion.js";
import { canjeParaElBorrador } from "../vouchers/caja.js";
import { generatePublicSlug } from "../tickets/public-slug.js";
import { computeTicket } from "../tickets/totals.js";
import type { AgendaStore } from "./store.js";

export type CheckoutResult =
  | {
      ok: true;
      ticket: SerializedCheckoutTicket;
      alreadyLinked: boolean;
      // clinica-8 · el borrador se abrió VACÍO porque la sesión cerrada de
      // esta cita no dejó ni una línea cobrable. No es un error: es lo que
      // pasó en la consulta, y quien cobra tiene que añadir el servicio.
      // `false` (y ausente del JSON) en todo lo demás.
      sesionSinCobro?: boolean;
    }
  | {
      ok: false;
      status: number;
      error: string;
      message: string;
      // B-reservas-5 F5 · para que el TPV pueda ofrecer "ver el ticket"
      // en vez de dejar a la cajera con un mensaje y nada que tocar.
      ticketId?: string;
    };

export interface SerializedCheckoutTicket {
  id: string;
  externalId: string;
  status: string;
  total: string;
  totalTax: string;
  totalDiscount: string;
  lines: Array<{
    id: string;
    productId: string | null;
    holdedProductId: string | null;
    sku: string;
    nameSnapshot: string;
    units: string;
    unitPrice: string;
    discountPct: string;
    taxRate: string;
    // bloque iva-exento-sanitario · la causa de exención de la línea del
    // borrador. El TPV no la usa para pintar, pero viaja en el contrato
    // para que un cliente que lea este ticket sepa que la línea es exenta
    // sin tener que deducirlo de un `taxRate = 0` (que también lo tiene un
    // 0 % sujeto, que es otra operación).
    exemptionCause: string | null;
    subtotal: string;
    total: string;
    // B-reservas-8 · con qué bono se paga esta línea, si se paga con uno.
    // El TPV pinta el chip «Con bono B87» con esto; **nunca lo calcula**.
    voucherId: string | null;
  }>;
  // B-reservas-8 · el canje que el servidor YA aplicó al abrir el cobro de
  // una cita con bono. `null` en todo lo demás —que es casi todo—, y
  // también cuando la cita tenía bono pero lo que se hizo no lo cubre: ahí
  // se cobra normal y lo apartado se libera al cobrar.
  bono: {
    voucherId: string;
    code: string;
    ticketLineId: string;
    sesionesLibres: number;
    sesionesApartadas: number;
  } | null;
}

export interface CheckoutContext {
  tenantId: string;
  registerId: string;
  cashierUserId: string;
}

// Abre (o devuelve si ya existe) el ticket pre-poblado de una cita.
export async function checkoutAppointment(
  prisma: PrismaClient,
  store: AgendaStore,
  ctx: CheckoutContext,
  appointmentId: string,
): Promise<CheckoutResult> {
  const appt = await store.getAppointmentView(ctx.tenantId, appointmentId);
  if (!appt) {
    return {
      ok: false,
      status: 404,
      error: "APPOINTMENT_NOT_FOUND",
      message: "Cita no encontrada.",
    };
  }
  if (appt.status === "CANCELLED" || appt.status === "NO_SHOW") {
    return {
      ok: false,
      status: 409,
      error: "APPOINTMENT_NOT_CHECKOUTABLE",
      message: "La cita está cancelada o marcada como no-show.",
    };
  }

  // Idempotencia: si ya hay ticket enlazado, devolverlo (GET-back del DRAFT).
  //
  // B-reservas-5 F5 · pero SÓLO si sigue siendo un borrador. Antes de
  // este bloque daba igual: el ticket enlazado no se cobraba nunca (el
  // cobro abría otro por su cuenta), así que devolverlo era inofensivo.
  // Ahora el ticket enlazado ES la venta. Devolverlo cobrado mandaría a
  // la cajera a un contexto de cobro sobre un ticket ya sellado, y el
  // `POST /tickets/:id/checkout` respondería 409 TICKET_ALREADY_PAID
  // después de haberla paseado por todo el modal. Se corta aquí y se le
  // dice qué pasó, con el número de ticket para poder mirarlo.
  if (appt.ticketId) {
    const existing = await loadTicket(prisma, appt.ticketId);
    if (existing && existing.status === "DRAFT") {
      return { ok: true, ticket: existing, alreadyLinked: true };
    }
    if (existing) {
      return {
        ok: false,
        status: 409,
        error: "APPOINTMENT_ALREADY_PAID",
        message: "Esta cita ya se cobró.",
        ticketId: existing.id,
      };
    }
    // El ticket enlazado ya no existe (borrado del tenant, limpieza de
    // implantación): la cita se quedó apuntando al vacío. `ticket_id` es
    // `ON DELETE SET NULL`, así que esto sólo pasa con una lectura
    // vieja; seguir adelante abre un borrador nuevo, que es lo correcto.
  }

  // clinica-3 · ¿hay una sesión clínica cerrada de esta cita? Si la hay,
  // LO QUE SE COBRA ES LO QUE SE HIZO, no lo que se reservó.
  //
  // `null` en los catorce tenants sin clínica y en cualquier cita sin
  // sesión, y entonces todo lo de abajo es exactamente lo de antes.
  const tratamientosDeLaSesion = await lineasDeLaSesionCerrada(prisma, {
    tenantId: ctx.tenantId,
    appointmentId,
  });
  // clinica-8 · UNA SOLA VERDAD. Con sesión cerrada manda la sesión, haya
  // dejado líneas o no. Lo que ya no pasa es caer a los servicios
  // RESERVADOS cuando la sesión no dejó nada: eso cobraba la previsión en
  // vez del trabajo, con los importes cuadrando y nadie enterándose.
  const sesionSinCobro = tratamientosDeLaSesion?.sinNadaQueCobrar === true;
  // `appt.items` conserva los DUPLICADOS a propósito: dos veces el mismo
  // servicio en una visita son dos líneas, y mapear por `serviceId` único
  // se habría comido una. Por eso la lista es de items y no un `Set`.
  const itemsACobrar: Array<{ serviceId: string }> = sesionSinCobro
    ? []
    : (tratamientosDeLaSesion?.lineas ?? appt.items);

  // Y el borrador VACÍO sólo es legítimo por ese camino. Una cita sin
  // servicios y sin sesión sigue siendo lo que era: nada que cobrar.
  if (itemsACobrar.length === 0 && !sesionSinCobro) {
    return {
      ok: false,
      status: 409,
      error: "APPOINTMENT_EMPTY",
      message: "La cita no tiene servicios que cobrar.",
    };
  }

  // Cargar los productos-servicio del visit (serviceId = product.id).
  const serviceIds = [...new Set(itemsACobrar.map((i) => i.serviceId))];
  const products = await prisma.product.findMany({
    where: { tenantId: ctx.tenantId, id: { in: serviceIds }, kind: "SERVICE" },
    select: {
      id: true,
      holdedProductId: true,
      sku: true,
      name: true,
      basePrice: true,
      taxRate: true,
      // bloque iva-exento-sanitario · la causa de exención del servicio.
      // ÉSTE es el camino por el que la quiropodia exenta de Rosario llega
      // a la caja: la sesión cerrada dice QUÉ tratamientos se hicieron
      // (clinica-3) y de aquí sale con qué fiscalidad se cobran. Sin esta
      // columna en el `select`, el cobro de una sesión saldría como 0 %
      // SUJETO y el registro declararía `S1` con `TipoImpositivo = 0` en
      // vez de `OperacionExenta = "E1"`.
      exemptionCause: true,
    },
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  // Turno abierto de la caja del cajero (mismo criterio que abrir mesa).
  const shift = await prisma.shift.findFirst({
    where: { registerId: ctx.registerId, closedAt: null },
    select: { id: true },
    orderBy: { openedAt: "desc" },
  });
  if (!shift) {
    return {
      ok: false,
      status: 409,
      error: "SHIFT_NOT_OPEN",
      message: "No hay turno abierto en esta caja.",
    };
  }

  // Construir las líneas (una por item, en orden). units=1, sin descuento.
  // catalogo-local · `holdedProductId` pasa a nullable, y aquí NO se
  // silencia con un `!`.
  //
  // Lo que se copia a la línea es un SNAPSHOT del enlace en el momento
  // del cobro (ver `TicketLine.holdedProductId` en el schema), y esa
  // columna ya era nullable desde las líneas libres `TPV-OTROS-*`. O
  // sea: el destino admitía NULL desde siempre y el único que lo tipaba
  // duro era este intermedio. Un servicio LOCAL se cobra igual que
  // cualquier otro y su línea viaja sin enlace, que es la verdad.
  //
  // Quién impide que esa línea acabe en Holded no es este fichero: es la
  // puerta de `upload-ticket.ts`. Aquí sólo se cobra.
  const lineInputs: Array<{
    productId: string;
    holdedProductId: string | null;
    sku: string;
    nameSnapshot: string;
    unitPrice: number;
    taxRate: number;
    exemptionCause: string | null;
    // B-reservas-8 · con qué bono se paga esta línea. Lo rellena el canje
    // de abajo; en toda cita sin bono se queda `null`.
    voucherId: string | null;
  }> = [];
  for (const item of itemsACobrar) {
    const p = byId.get(item.serviceId);
    if (!p) {
      return {
        ok: false,
        status: 409,
        error: "SERVICE_NOT_FOUND",
        message: "Un servicio de la cita ya no existe en el catálogo.",
      };
    }
    if (!p.sku || p.sku.trim() === "") {
      // El camino de cobro exige sku no vacío en la línea (Product
      // sellableViaTpv). Un servicio sin sku no es cobrable.
      return {
        ok: false,
        status: 409,
        error: "SERVICE_NOT_SELLABLE",
        message: `El servicio "${p.name}" no tiene SKU y no se puede cobrar.`,
      };
    }
    lineInputs.push({
      productId: p.id,
      holdedProductId: p.holdedProductId,
      sku: p.sku,
      nameSnapshot: p.name,
      unitPrice: Number(p.basePrice),
      taxRate: Number(p.taxRate),
      // El snapshot, igual que el nombre y el precio: lo que se cobró no
      // cambia si mañana se edita el servicio.
      exemptionCause: p.exemptionCause,
      voucherId: null,
    });
  }

  // ── B-reservas-8 · la línea del bono sale YA MARCADA y a 0 € ───────
  //
  // Lo decide el SERVIDOR al abrir el cobro, así que la cajera no ve nunca
  // un precio que luego cambia. `null` en toda cita sin bono (y entonces
  // esto no cuesta ni una consulta) y también cuando la cita TENÍA bono
  // pero lo que se hizo no lo cubre: entonces se cobra normal y lo apartado
  // se libera al cobrar (`canjearAlCobrar`). **Nunca se consume un bono
  // contra un servicio que no cubre.**
  const canje = appt.voucherId
    ? await canjeParaElBorrador(prisma, {
        tenantId: ctx.tenantId,
        voucherId: appt.voucherId,
        productIds: lineInputs.map((l) => l.productId),
        ahora: new Date(),
      })
    : null;
  if (canje) {
    lineInputs[canje.indice]!.unitPrice = canje.importeCents / 100;
    lineInputs[canje.indice]!.voucherId = canje.voucherId;
  }

  const totals = computeTicket(
    lineInputs.map((l) => ({
      units: 1,
      unitPrice: l.unitPrice,
      discountPct: 0,
      taxRate: l.taxRate,
      exemptionCause: l.exemptionCause,
    })),
  );

  const ticketId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.ticket.create({
      data: {
        id: ticketId,
        tenantId: ctx.tenantId,
        registerId: ctx.registerId,
        shiftId: shift.id,
        userId: ctx.cashierUserId,
        // internalNumber se asigna al cobrar (PAID); en DRAFT, placeholder
        // único (mismo patrón que abrir mesa).
        internalNumber: `D-${randomUUID()}`,
        externalId: randomUUID(),
        publicSlug: generatePublicSlug(),
        // B-reservas-8 · LA FICHA DE LA CITA VIAJA AL TICKET.
        //
        // Lo pilló la pasada en el navegador: el borrador de una cita de
        // bono salía con su línea a 0 € —eso lo pone `canjeParaElBorrador`
        // de aquí abajo— pero SIN el chip «Con bono B1», porque
        // `GET /tickets/:id/bonos` no puede proponer nada sin saber de
        // quién es el ticket. La cajera veía un cero sin explicación.
        //
        // Y no es sólo el chip: sin esto, el canje SIN CITA tampoco se
        // puede ofrecer sobre el borrador de una cita, y la ficha de la
        // clienta no sale en la venta que le corresponde.
        //
        // `null` en una cita anónima (walk-in, reserva de teléfono sin
        // ficha), que es exactamente lo que `Ticket.clientId` admite.
        clientId: appt.clientId,
        status: "DRAFT",
        total: new Prisma.Decimal(totals.total),
        totalTax: new Prisma.Decimal(totals.tax),
        totalDiscount: new Prisma.Decimal(totals.discount),
        printIntent: true,
        lines: {
          create: lineInputs.map((l, i) => {
            const cl = totals.lines[i]!;
            return {
              productId: l.productId,
              holdedProductId: l.holdedProductId,
              sku: l.sku,
              nameSnapshot: l.nameSnapshot,
              units: new Prisma.Decimal(1),
              unitPrice: new Prisma.Decimal(l.unitPrice),
              discountPct: new Prisma.Decimal(0),
              taxRate: new Prisma.Decimal(l.taxRate),
              exemptionCause: l.exemptionCause,
              voucherId: l.voucherId,
              subtotal: new Prisma.Decimal(cl.subtotal),
              total: new Prisma.Decimal(cl.total),
            };
          }),
        },
      },
    });
  });

  await store.linkTicket(ctx.tenantId, appointmentId, ticketId);
  // Marcar la cita "en sala" al abrir el cobro (si aún no lo está). El paso a
  // COMPLETED lo hace el front al confirmarse el pago por el camino normal.
  if (appt.status === "PENDING" || appt.status === "CONFIRMED") {
    await store.setStatus(ctx.tenantId, appointmentId, "IN_SERVICE");
  }

  const ticket = await loadTicket(prisma, ticketId);
  if (!ticket) throw new Error("ticket vanished after create");
  return {
    ok: true,
    ticket,
    alreadyLinked: false,
    ...(sesionSinCobro ? { sesionSinCobro: true } : {}),
  };
}

async function loadTicket(
  prisma: PrismaClient,
  ticketId: string,
): Promise<SerializedCheckoutTicket | null> {
  const t = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      externalId: true,
      status: true,
      total: true,
      totalTax: true,
      totalDiscount: true,
      lines: {
        select: {
          id: true,
          productId: true,
          holdedProductId: true,
          sku: true,
          nameSnapshot: true,
          units: true,
          unitPrice: true,
          discountPct: true,
          taxRate: true,
          exemptionCause: true,
          subtotal: true,
          total: true,
          // B-reservas-8 · con qué bono se paga la línea.
          voucherId: true,
        },
      },
    },
  });
  if (!t) return null;
  return {
    id: t.id,
    externalId: t.externalId,
    status: t.status,
    total: t.total.toString(),
    totalTax: t.totalTax.toString(),
    totalDiscount: t.totalDiscount.toString(),
    lines: t.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      holdedProductId: l.holdedProductId,
      sku: l.sku,
      nameSnapshot: l.nameSnapshot,
      units: l.units.toString(),
      unitPrice: l.unitPrice.toString(),
      discountPct: l.discountPct.toString(),
      taxRate: l.taxRate.toString(),
      exemptionCause: l.exemptionCause,
      subtotal: l.subtotal.toString(),
      total: l.total.toString(),
      voucherId: l.voucherId,
    })),
    bono: await bonoDelTicket(prisma, t.lines),
  };
}

/** El resumen del bono de este borrador, para el chip de la pantalla
 *  («Con bono B87 · quedan 3 → 2»). Una consulta, y sólo cuando alguna
 *  línea lleva bono: un ticket de bar no paga nada por esto. */
async function bonoDelTicket(
  prisma: PrismaClient,
  lines: Array<{ id: string; voucherId: string | null }>,
): Promise<SerializedCheckoutTicket["bono"]> {
  const conBono = lines.find((l) => l.voucherId != null);
  if (!conBono) return null;
  // Defensiva con la FORMA del cliente: la suite de `agenda-checkout`
  // inyecta un prisma falso que no expone `voucher`, y un borrador sin
  // bono —que es el caso de ese banco— no tiene por qué necesitarlo.
  const modelo = prisma.voucher as { findUnique?: (a: unknown) => Promise<unknown> } | undefined;
  if (typeof modelo?.findUnique !== "function") return null;
  const b = await prisma.voucher.findUnique({
    where: { id: conBono.voucherId! },
    select: { id: true, code: true, sessionsLeft: true, sessionsReserved: true },
  });
  if (!b) return null;
  return {
    voucherId: b.id,
    code: b.code,
    ticketLineId: conBono.id,
    sesionesLibres: b.sessionsLeft,
    sesionesApartadas: b.sessionsReserved,
  };
}
