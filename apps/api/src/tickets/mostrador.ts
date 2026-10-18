// auditoria-sirope (#25) · EL BORRADOR DE UNA VENTA DE MOSTRADOR.
//
//   POST /mostrador/draft — crea el DRAFT de una venta rápida, con sus
//                           líneas, y le pone su número del día.
//
// ── Por qué hace falta ────────────────────────────────────────────────
//
// Hasta este bloque, una venta rápida no existía en el servidor: el
// carrito vivía en el navegador y sólo aparecía al cobrar
// (`POST /tickets`). Eso dejaba «Enviar» sin nada que enviar —la comanda
// se manda sobre un ticket (`POST /tickets/:id/send-to-kitchen`)— y el TPV
// salía de la función en seco (`SalePage.tsx`: `if
// (!tableContext?.activeTicketId) return;`). El 18-10, en Cafetería
// Sirope, que trabaja casi todo en mostrador, eso significó que **lo que
// se pedía en la barra no llegaba nunca a la cocina** y el botón seguía
// encendido como si nada.
//
// Así que el borrador se crea al enviar. A partir de ahí la venta de
// mostrador es un DRAFT como el de una mesa: las líneas se editan por los
// endpoints de siempre y el cobro va por `POST /tickets/:id/checkout`, que
// es lo que hace que cobrar CIERRE la comanda en vez de dejarla viva
// (#22).
//
// ── El número ─────────────────────────────────────────────────────────
//
// La tarjeta de la cocina se titula «Mostrador nº 3». El número es
// correlativo POR DÍA Y POR CAJA (`Ticket.counterNumber`), y se asigna
// aquí porque aquí es donde nace la venta: si se calculara al enviar, la
// segunda comanda de la misma venta estrenaría número y el cocinero
// leería dos tarjetas distintas de un mismo cliente.
//
// Correlativo por caja y no por tienda: dos barras del mismo local cantan
// «el 3» cada una con el suyo delante, que es como se canta en una barra.

import { randomUUID } from "node:crypto";

import { Prisma } from "@mipiacetpv/db";
import type { FastifyInstance } from "fastify";

import { getPrisma } from "../context.js";
import { etiquetaDeMostrador } from "../kitchen/titulo.js";
import { inicioDelDia } from "../kitchen/vista.js";
import { ensureCajaEnabled } from "../lib/caja-gate.js";
import { requireCashierSession } from "../shift/cashier-session.js";
import {
  anadirLineaAlDraft,
  buildModifierErrorReply,
  buildModifiersSnapshotForLine,
  recomputeTicketTotalsWithModifiers,
  reloadDraft,
  serializeDraft,
} from "../tables/operativa.js";
import { resolveModifierSelectionsForLines } from "./modifier-selection.js";
import { generatePublicSlug } from "./public-slug.js";
import { computeTicket } from "./totals.js";

const UUID_V4 =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

/** Una línea del carrito, tal como la manda el TPV. Mismo shape que el
 *  cuerpo de `POST /tables/:tableId/lines`, para que el terminal no tenga
 *  que traducir nada entre una mesa y el mostrador. */
const LINE_SCHEMA = {
  type: "object",
  required: ["nameSnapshot", "sku", "units", "unitPrice", "discountPct", "taxRate"],
  additionalProperties: false,
  properties: {
    productId: { type: "string", format: "uuid" },
    variantId: { type: "string", format: "uuid" },
    holdedProductId: { type: "string", maxLength: 64 },
    nameSnapshot: { type: "string", minLength: 1, maxLength: 300 },
    sku: { type: "string", minLength: 1, maxLength: 64 },
    units: { type: "number", exclusiveMinimum: 0, maximum: 99999 },
    unitPrice: { type: "number", minimum: 0, maximum: 100000 },
    discountPct: { type: "number", minimum: 0, maximum: 100 },
    taxRate: { type: "number", minimum: 0, maximum: 100 },
    modifiers: {
      type: "array",
      items: { type: "string", maxLength: 80 },
      maxItems: 10,
    },
    modifierSelections: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        required: ["groupId", "modifierId"],
        additionalProperties: false,
        properties: {
          groupId: { type: "string", format: "uuid" },
          modifierId: { type: "string", format: "uuid" },
        },
      },
    },
    lineExternalId: { type: "string", pattern: UUID_V4 },
  },
} as const;

interface LineBody {
  productId?: string;
  variantId?: string;
  holdedProductId?: string;
  nameSnapshot: string;
  sku: string;
  units: number;
  unitPrice: number;
  discountPct: number;
  taxRate: number;
  modifiers?: string[];
  modifierSelections?: Array<{ groupId: string; modifierId: string }>;
  lineExternalId?: string;
}

/**
 * El siguiente número de mostrador de ESTA caja HOY.
 *
 * «Hoy» es la medianoche local, el mismo «hoy» que la pantalla de cocina
 * (`inicioDelDia`): si la cocina no ve la tarjeta de ayer, el número de
 * ayer no puede confundirse con el de hoy.
 *
 * Un `MAX + 1` y no un `COUNT + 1`: un borrador anulado deja su número
 * gastado, y repetirlo pondría dos «Mostrador nº 3» en la misma pantalla.
 */
async function siguienteNumero(
  tx: Prisma.TransactionClient,
  registerId: string,
  ahora: Date,
): Promise<number> {
  const ultimo = await tx.ticket.aggregate({
    where: {
      registerId,
      counterNumber: { not: null },
      createdAt: { gte: inicioDelDia(ahora) },
    },
    _max: { counterNumber: true },
  });
  return (ultimo._max.counterNumber ?? 0) + 1;
}

export async function registerMostradorRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    "/mostrador/draft",
    {
      preHandler: [requireCashierSession, ensureCajaEnabled],
      schema: {
        body: {
          type: "object",
          required: ["lines"],
          additionalProperties: false,
          properties: {
            lines: { type: "array", minItems: 1, maxItems: 200, items: LINE_SCHEMA },
            notes: { type: "string", maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const body = request.body as { lines: LineBody[]; notes?: string };
      const prisma = getPrisma();

      const register = await prisma.register.findFirst({
        where: { id: cashier.rid, deletedAt: null, store: { tenantId: cashier.tid } },
        select: { id: true, storeId: true },
      });
      if (!register) {
        return reply.code(404).send({
          error: "REGISTER_NOT_FOUND",
          message: "Esta caja ya no existe.",
        });
      }
      const shift = await prisma.shift.findFirst({
        where: { registerId: cashier.rid, closedAt: null },
        select: { id: true },
        orderBy: { openedAt: "desc" },
      });
      if (!shift) {
        return reply.code(409).send({
          error: "SHIFT_NOT_OPEN",
          message: "No hay turno abierto en esta caja.",
        });
      }

      // Los modificadores se resuelven ANTES de abrir la transacción: es
      // una consulta por su cuenta y un 400 aquí no tiene que dejar medio
      // borrador escrito.
      const resueltos = await resolveModifierSelectionsForLines(
        prisma,
        cashier.tid,
        body.lines.map((l) => ({
          productId: l.productId ?? null,
          selections: l.modifierSelections ?? [],
        })),
      );
      for (let i = 0; i < resueltos.length; i++) {
        const r = resueltos[i]!;
        if (!r.ok) {
          return reply
            .code(400)
            .send(buildModifierErrorReply(r, body.lines[i]!.nameSnapshot));
        }
      }

      const ahora = new Date();
      const ticket = await prisma.$transaction(async (tx) => {
        const counterNumber = await siguienteNumero(tx, register.id, ahora);
        const creado = await tx.ticket.create({
          data: {
            tenantId: cashier.tid,
            registerId: register.id,
            shiftId: shift.id,
            userId: cashier.sub,
            // Igual que el DRAFT de una mesa: la serie fiscal se asigna
            // al cobrar, así que en DRAFT va un placeholder único (la
            // columna es `@@unique([registerId, internalNumber])`).
            internalNumber: `D-${randomUUID()}`,
            externalId: randomUUID(),
            publicSlug: generatePublicSlug(),
            status: "DRAFT",
            total: new Prisma.Decimal(0),
            totalTax: new Prisma.Decimal(0),
            totalDiscount: new Prisma.Decimal(0),
            // Sin mesa: ESTO es lo que lo convierte en mostrador.
            tableId: null,
            counterNumber,
            notes: body.notes ?? null,
            printIntent: true,
          },
          select: { id: true },
        });
        for (let i = 0; i < body.lines.length; i++) {
          const l = body.lines[i]!;
          const r = resueltos[i]!;
          const snapshot = r.ok ? r.resolved.snapshot : [];
          const deltaCents = r.ok ? r.resolved.unitPriceDeltaCents : 0;
          const calculada = computeTicket([
            {
              units: l.units,
              unitPrice: l.unitPrice + deltaCents / 100,
              discountPct: l.discountPct,
              taxRate: l.taxRate,
            },
          ]).lines[0]!;
          await tx.ticketLine.create({
            data: {
              id: l.lineExternalId ?? randomUUID(),
              ticketId: creado.id,
              productId: l.productId ?? null,
              variantId: l.variantId ?? null,
              holdedProductId: l.holdedProductId ?? null,
              sku: l.sku,
              nameSnapshot: l.nameSnapshot,
              units: new Prisma.Decimal(l.units),
              // Igual que en la mesa: el precio BASE se persiste limpio y
              // el delta del modificador vive en `modifiers` y en los
              // totales.
              unitPrice: new Prisma.Decimal(l.unitPrice),
              discountPct: new Prisma.Decimal(l.discountPct),
              taxRate: new Prisma.Decimal(l.taxRate),
              subtotal: new Prisma.Decimal(calculada.subtotal),
              total: new Prisma.Decimal(calculada.total),
              modifiers: buildModifiersSnapshotForLine(l.modifiers, snapshot),
            },
          });
        }
        return recomputeTicketTotalsWithModifiers(tx, creado.id);
      });

      const conNumero = await prisma.ticket.findUniqueOrThrow({
        where: { id: ticket.id },
        select: { counterNumber: true },
      });
      return reply.code(201).send({
        ticket: serializeDraft(ticket),
        counterNumber: conNumero.counterNumber,
        counterLabel: etiquetaDeMostrador(conNumero.counterNumber ?? 0),
      });
    },
  );

  // ── AÑADIR UNA LÍNEA A LA VENTA DE MOSTRADOR ───────────────────────
  //
  // Lo que el TPV necesita desde que la venta tiene borrador: todo lo que
  // se marque a partir de ahí va al servidor, igual que en una mesa. Sin
  // esto, la línea existiría sólo en la pantalla y la comanda siguiente
  // saldría sin ella — y el cobro cobraría de menos.
  //
  // Es una ruta propia y no `/tables/:id/lines` por lo obvio: no hay
  // mesa. El cuerpo es el mismo y el trabajo lo hace la misma función
  // (`anadirLineaAlDraft`), así que una mesa y un mostrador no pueden
  // calcular distinto.
  app.post(
    "/mostrador/:ticketId/lines",
    {
      preHandler: [requireCashierSession, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", format: "uuid" } },
        },
        body: LINE_SCHEMA,
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId } = request.params as { ticketId: string };
      const body = request.body as LineBody;
      const prisma = getPrisma();
      const draft = await prisma.ticket.findFirst({
        where: {
          id: ticketId,
          tenantId: cashier.tid,
          status: "DRAFT",
          // Sólo un borrador de MOSTRADOR: una mesa tiene su ruta, con su
          // evento para el mapa de las demás cajas.
          tableId: null,
        },
        select: { id: true },
      });
      if (!draft) {
        return reply.code(404).send({
          error: "DRAFT_NOT_FOUND",
          message: "Esta venta ya no está abierta.",
        });
      }
      // Idempotencia por `lineExternalId`, igual que en la mesa: el
      // reintento de un toque que se perdió por el camino no duplica.
      if (body.lineExternalId) {
        const existe = await prisma.ticketLine.findFirst({
          where: { ticketId: draft.id, id: body.lineExternalId },
          select: { id: true },
        });
        if (existe) {
          const refrescado = await reloadDraft(prisma, draft.id);
          return reply
            .code(200)
            .send({ ticket: serializeDraft(refrescado), duplicate: true });
        }
      }
      const añadida = await anadirLineaAlDraft(prisma, {
        draftId: draft.id,
        tenantId: cashier.tid,
        body,
      });
      if ("error" in añadida) {
        return reply.code(añadida.status).send(añadida.error);
      }
      return reply
        .code(201)
        .send({ ticket: serializeDraft(añadida.updated) });
    },
  );
}
