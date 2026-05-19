// Endpoints de tickets (B4 §1).
//
//   POST /tickets             — registra ticket cobrado y encola sync a Holded.
//   GET  /tickets/:id         — devuelve ticket con líneas/pagos/sync status.
//   GET  /tickets             — búsqueda con filtros.
//   POST /tickets/:id/resend-email — encola un job para reenviar el PDF.
//   POST /tickets/:id/gift-receipt-intent — marca giftReceiptIntentAt (B5 imprime).
//
// Middleware: requireCashierSession (B3). El JWT de la sesión lleva
// tid/rid/did, así que no necesitamos un X-Device-Token extra: la
// sesión ya pasó por device + PIN.

import { randomUUID } from "node:crypto";

import { Prisma, TicketStatus } from "@mipiacetpv/db";
import type { FastifyInstance } from "fastify";

import { verifyManagerAuthorization } from "../auth/manager-authorization.js";
import { getPrisma } from "../context.js";
import { getStoreEventBus } from "../realtime/store-event-bus.js";
import { enqueueTicketUpload } from "../queues/ticket-upload.js";
import { enqueueRefundUpload } from "../queues/refund-upload.js";
import { enqueueTicketEmail } from "../queues/ticket-email.js";
import { requireCashierSession } from "../shift/cashier-session.js";
import { maybeEnqueueAutoEmail } from "./email-trigger.js";
import {
  resolveModifierSelectionsForLines,
  type ModifierSelectionInput,
  type ModifierSnapshotEntry,
  type ResolveResult,
} from "./modifier-selection.js";
import { generatePublicSlug } from "./public-slug.js";
import {
  PAYMENT_TOLERANCE_EUR,
  TOTAL_TOLERANCE_EUR,
  computeTicket,
  totalsClose,
} from "./totals.js";

const UUID_V4 =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$";

interface TicketLineBody {
  productId?: string;
  variantId?: string;
  holdedProductId?: string;
  nameSnapshot: string;
  sku: string;
  units: number;
  unitPrice: number;
  discountPct: number;
  taxRate: number;
  // Legacy: array de strings tipeados ad-hoc por el cajero ("Sin azúcar").
  // No tiene precio asociado; el cálculo de subtotal ignora estos.
  modifiers?: string[];
  // B-Bar-Modifiers · estructurado: selección del modal <ModifierSelector>.
  // El backend valida groupId/modifierId contra el catálogo del tenant,
  // suma `priceDeltaCents` al precio unitario antes de calcular subtotal,
  // y persiste el snapshot desnormalizado en TicketLine.modifiers (caso
  // que reemplaza el shape legacy string[] cuando ambos vienen).
  modifierSelections?: ModifierSelectionInput[];
}

interface TicketPaymentBody {
  method: "CASH" | "CARD" | "BIZUM" | "VOUCHER" | "OTHER";
  amount: number;
  meta?: Record<string, unknown>;
}

interface CreateTicketBody {
  externalId: string;
  registerId: string;
  shiftId: string;
  lines: TicketLineBody[];
  payments: TicketPaymentBody[];
  contactHoldedId?: string;
  notes?: string;
  cashAmount?: number;
  printIntent?: boolean;
  emailIntent?: string;
  giftReceiptIntent?: boolean;
  // B6 §2: si el descuento efectivo del ticket supera el umbral del
  // tenant, exigimos un token emitido por POST /admin/auth/manager-authorize.
  authorizationToken?: string;
}

export async function registerTicketRoutes(app: FastifyInstance): Promise<void> {
  // ── POST /tickets ───────────────────────────────────────────────────
  app.post(
    "/tickets",
    {
      preHandler: requireCashierSession,
      schema: {
        body: {
          type: "object",
          required: ["externalId", "registerId", "shiftId", "lines", "payments"],
          additionalProperties: false,
          properties: {
            externalId: { type: "string", pattern: UUID_V4 },
            registerId: { type: "string", format: "uuid" },
            shiftId: { type: "string", format: "uuid" },
            contactHoldedId: { type: "string", maxLength: 64 },
            notes: { type: "string", maxLength: 1000 },
            cashAmount: { type: "number", minimum: 0 },
            printIntent: { type: "boolean" },
            emailIntent: { type: "string", maxLength: 320 },
            giftReceiptIntent: { type: "boolean" },
            authorizationToken: { type: "string", minLength: 1, maxLength: 2048 },
            lines: {
              type: "array",
              minItems: 1,
              items: {
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
                },
              },
            },
            payments: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["method", "amount"],
                additionalProperties: false,
                properties: {
                  method: {
                    type: "string",
                    enum: ["CASH", "CARD", "BIZUM", "VOUCHER", "OTHER"],
                  },
                  amount: { type: "number", minimum: 0, maximum: 1_000_000 },
                  meta: { type: "object", additionalProperties: true },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const body = request.body as CreateTicketBody;
      const prisma = getPrisma();

      // 1. Idempotencia: ¿ya existe este externalId? Si sí, devolvemos
      //    el ticket existente con 200 (cliente puede reintentar tras un
      //    timeout sin generar duplicados). Spike §04.F.
      const existing = await prisma.ticket.findUnique({
        where: { externalId: body.externalId },
        include: ticketInclude(),
      });
      if (existing) {
        if (existing.tenantId !== cashier.tid) {
          // B-Hardening A · S5: respuesta genérica que no revela
          // existencia cross-tenant. El cliente legítimo nunca llega
          // aquí porque genera UUID v4 por ticket. Si alguien intentara
          // adivinar externalIds ajenos, el mensaje no le confirma
          // que el UUID existe en otro tenant.
          return reply.code(409).send({
            error: "EXTERNAL_ID_TAKEN",
            message: "externalId ya en uso. Genera uno nuevo y reintenta.",
          });
        }
        return reply.code(200).send({
          ticket: serializeTicket(existing),
          duplicate: true,
        });
      }

      // 2. Caja y turno pertenecen al tenant + cashier.rid.
      if (body.registerId !== cashier.rid) {
        return reply.code(403).send({
          error: "REGISTER_MISMATCH",
          message: "La caja del ticket no coincide con tu sesión.",
        });
      }
      const shift = await prisma.shift.findFirst({
        where: { id: body.shiftId, registerId: cashier.rid, closedAt: null },
        select: { id: true },
      });
      if (!shift) {
        return reply.code(409).send({
          error: "SHIFT_NOT_OPEN",
          message: "El turno no está abierto en esta caja.",
        });
      }

      // 3.a Resolver selecciones de modificadores (B-Bar-Modifiers) antes
      //     de calcular totales — los priceDeltas afectan al unitPrice
      //     efectivo de la línea (céntimos por unidad).
      const modifierResults = await resolveModifierSelectionsForLines(
        prisma,
        cashier.tid,
        body.lines.map((l) => ({
          productId: l.productId ?? null,
          selections: l.modifierSelections ?? [],
        })),
      );
      for (let i = 0; i < modifierResults.length; i++) {
        const result = modifierResults[i]!;
        if (!result.ok) {
          return reply
            .code(400)
            .send(buildModifierErrorReply(result, body.lines[i]!.nameSnapshot));
        }
      }
      const lineModifierResolutions = modifierResults.map((r) =>
        r.ok ? r.resolved : { unitPriceDeltaCents: 0, snapshot: [] },
      );

      // 3.b Validaciones de totales y pagos. unitPrice efectivo incluye
      //     los priceDeltas en céntimos / 100 (por unidad).
      const totals = computeTicket(
        body.lines.map((l, i) => ({
          units: l.units,
          unitPrice:
            l.unitPrice + lineModifierResolutions[i]!.unitPriceDeltaCents / 100,
          discountPct: l.discountPct,
          taxRate: l.taxRate,
        })),
      );
      const paymentsSum = body.payments.reduce((acc, p) => acc + p.amount, 0);
      // B5 §3.2: aceptamos overpayment en efectivo (la diferencia es el
      // cambio). Holded recibe siempre `total` exacto en /pay; los
      // payments[] del TPV reflejan el dinero recibido. Para
      // payment_methods != CASH no debería haber overpayment; si lo hay,
      // lo aceptamos igual y queda como descuadre de caja.
      if (paymentsSum + PAYMENT_TOLERANCE_EUR < totals.total) {
        return reply.code(400).send({
          error: "PAYMENTS_MISMATCH",
          message: `Σ payments (${paymentsSum.toFixed(2)}) menor que total (${totals.total.toFixed(2)})`,
          tolerance: PAYMENT_TOLERANCE_EUR,
        });
      }
      // El servidor confía en lo calculado por él mismo (no hay total
      // en el body — sólo líneas y pagos). El recálculo es la línea de
      // defensa: si payments no cierran, rechazamos.
      void TOTAL_TOLERANCE_EUR; // documentado, sin uso runtime aquí.

      // 4. Skus no vacíos.
      for (const l of body.lines) {
        if (!l.sku || l.sku.trim() === "") {
          return reply.code(400).send({
            error: "LINE_WITHOUT_SKU",
            message:
              "Una línea sin SKU no es vendible vía Holded. Usa el comodín TPV-OTROS-{IVA}.",
            line: l.nameSnapshot,
          });
        }
      }

      // 4.b B6 §2: descuento efectivo vs umbral del tenant. El % se
      // calcula sobre el subtotal bruto SIN IVA (antes de aplicar
      // descuentos), porque es la métrica que entiende el comercio:
      // "le estoy regalando un X% del precio de tarifa". Si supera el
      // umbral, exigimos `authorizationToken` válido del encargado.
      const tenantForDiscount = await prisma.tenant.findUniqueOrThrow({
        where: { id: cashier.tid },
        select: { discountThresholdPct: true },
      });
      const grossSubtotal = totals.subtotal + totals.discount;
      const effectiveDiscountPct =
        grossSubtotal > 0
          ? Math.round((totals.discount / grossSubtotal) * 10000) / 100
          : 0;
      const thresholdPct = Number(tenantForDiscount.discountThresholdPct);
      let discountAuthorizedBy: string | null = null;

      if (effectiveDiscountPct > thresholdPct + 1e-6) {
        if (!body.authorizationToken) {
          return reply.code(403).send({
            error: "MANAGER_AUTHORIZATION_REQUIRED",
            message: `El descuento del ${effectiveDiscountPct.toFixed(
              2,
            )}% supera el umbral del tenant (${thresholdPct.toFixed(
              2,
            )}%). Pide al encargado que autorice con su PIN.`,
            effectiveDiscountPct,
            thresholdPct,
          });
        }
        let authPayload;
        try {
          authPayload = verifyManagerAuthorization(body.authorizationToken);
        } catch {
          return reply.code(403).send({
            error: "MANAGER_AUTHORIZATION_INVALID",
            message:
              "La autorización del encargado ha caducado o no es válida. Pide al encargado que vuelva a introducir su PIN.",
          });
        }
        if (authPayload.tid !== cashier.tid) {
          return reply.code(403).send({
            error: "MANAGER_AUTHORIZATION_INVALID",
            message: "La autorización no pertenece a este tenant.",
          });
        }
        if (authPayload.purpose !== "discount-override") {
          return reply.code(403).send({
            error: "MANAGER_AUTHORIZATION_INVALID",
            message: "La autorización no aplica a descuentos.",
          });
        }
        if (effectiveDiscountPct > authPayload.context.maxDiscountPct + 1e-6) {
          return reply.code(403).send({
            error: "MANAGER_AUTHORIZATION_INSUFFICIENT",
            message: `La autorización cubre hasta ${authPayload.context.maxDiscountPct.toFixed(
              2,
            )}% pero el descuento aplicado es del ${effectiveDiscountPct.toFixed(2)}%.`,
          });
        }
        const manager = await prisma.user.findFirst({
          where: {
            id: authPayload.sub,
            tenantId: cashier.tid,
            role: { in: ["MANAGER", "OWNER"] },
          },
          select: { email: true },
        });
        if (!manager) {
          // El manager fue borrado entre la emisión del token y el cobro
          // (caso poco probable pero defendible). Rechazamos.
          return reply.code(403).send({
            error: "MANAGER_AUTHORIZATION_INVALID",
            message: "El encargado autorizante ya no está activo en el tenant.",
          });
        }
        discountAuthorizedBy = manager.email;
        request.log.info(
          {
            event: "ticket.discount_authorized",
            tenantId: cashier.tid,
            registerId: cashier.rid,
            cashierId: cashier.sub,
            managerEmail: manager.email,
            effectiveDiscountPct,
            thresholdPct,
            externalId: body.externalId,
          },
          "Ticket cobrado con descuento autorizado por encargado",
        );
      }

      // 5. Internal number atómico (incrementa register.ticketCounter).
      const next = await prisma.register.update({
        where: { id: cashier.rid },
        data: { ticketCounter: { increment: 1 } },
        select: { ticketCounter: true },
      });
      const internalNumber = String(next.ticketCounter).padStart(6, "0");

      // 6. Persiste todo en transacción.
      const ticket = await prisma.$transaction(async (tx) => {
        const t = await tx.ticket.create({
          data: {
            tenantId: cashier.tid,
            registerId: cashier.rid,
            shiftId: body.shiftId,
            userId: cashier.sub,
            internalNumber,
            externalId: body.externalId,
            publicSlug: generatePublicSlug(),
            contactHoldedId: body.contactHoldedId ?? null,
            status: TicketStatus.PENDING_SYNC,
            total: new Prisma.Decimal(totals.total),
            totalTax: new Prisma.Decimal(totals.tax),
            totalDiscount: new Prisma.Decimal(totals.discount),
            notes: body.notes ?? null,
            cashAmount:
              body.cashAmount != null ? new Prisma.Decimal(body.cashAmount) : null,
            printIntent: body.printIntent ?? true,
            emailIntent: body.emailIntent ?? null,
            giftReceiptIntentAt: body.giftReceiptIntent ? new Date() : null,
            discountAuthorizedBy,
            paidAt: new Date(),
            lines: {
              create: body.lines.map((l, i) => ({
                productId: l.productId ?? null,
                variantId: l.variantId ?? null,
                holdedProductId: l.holdedProductId ?? null,
                sku: l.sku,
                nameSnapshot: l.nameSnapshot,
                units: new Prisma.Decimal(l.units),
                // unitPrice persistido es el BASE sin deltas. El subtotal
                // ya incluye los deltas (computado arriba). Mantenemos
                // unitPrice "limpio" para que la auditoría sea legible y
                // los modifiers expliquen explícitamente el suplemento.
                unitPrice: new Prisma.Decimal(l.unitPrice),
                discountPct: new Prisma.Decimal(l.discountPct),
                taxRate: new Prisma.Decimal(l.taxRate),
                subtotal: new Prisma.Decimal(totals.lines[i]!.subtotal),
                total: new Prisma.Decimal(totals.lines[i]!.total),
                modifiers: buildModifiersSnapshot(
                  l.modifiers,
                  lineModifierResolutions[i]!.snapshot,
                ),
              })),
            },
            payments: {
              create: body.payments.map((p) => ({
                method: p.method,
                amount: new Prisma.Decimal(p.amount),
                meta: p.meta ? (p.meta as object) : Prisma.JsonNull,
              })),
            },
          },
          include: ticketInclude(),
        });
        await tx.shift.update({
          where: { id: body.shiftId },
          data: { lastActivityAt: new Date() },
        });
        await tx.holdedUpload.upsert({
          where: { externalId: body.externalId },
          create: {
            externalId: body.externalId,
            tenantId: cashier.tid,
            kind: "TICKET",
            status: "PENDING",
          },
          update: {},
        });
        return t;
      });

      // 7. Encolar upload-ticket (idempotente; jobId determinista).
      try {
        await enqueueTicketUpload(body.externalId);
      } catch (err) {
        request.log.error(
          { externalId: body.externalId },
          `enqueue ticket upload falló: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      // Encolado de email auto (B-Print fase 1). Si el cajero introdujo
      // email manual → respetar. Si no y el contacto vinculado tiene
      // email + la tienda permite emailAutoIfCustomerHasEmail → enviar
      // a esa dirección. El PDF se genera local con `ticket-pdf` —
      // no espera a Holded.
      try {
        await maybeEnqueueAutoEmail({
          prisma,
          ticketId: ticket.id,
          registerId: cashier.rid,
          contactHoldedId: body.contactHoldedId ?? null,
          manualEmailIntent: body.emailIntent ?? null,
          requestedByUserId: cashier.sub,
          logger: { warn: (msg, extra) => request.log.warn(extra ?? {}, msg) },
        });
      } catch (err) {
        request.log.warn(
          { ticketId: ticket.id },
          `auto-email enqueue falló: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return reply.code(201).send({
        ticket: serializeTicket(ticket),
        syncStatus: ticket.status,
      });
    },
  );

  // ── POST /tickets/:id/checkout ──────────────────────────────────────
  // Transición DRAFT → PENDING_SYNC para tickets de mesa (B7 §4.1). El
  // body lleva los pagos y los intents (print/email/gift). Reutiliza
  // las validaciones de descuento y la cola de Holded del POST /tickets
  // original. El internalNumber se asigna AHORA (no al crear el DRAFT)
  // para que un ticket cancelado no consuma serie fiscal.
  app.post(
    "/tickets/:ticketId/checkout",
    {
      preHandler: requireCashierSession,
      schema: {
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["payments"],
          additionalProperties: false,
          properties: {
            contactHoldedId: { type: "string", maxLength: 64 },
            notes: { type: "string", maxLength: 1000 },
            cashAmount: { type: "number", minimum: 0 },
            printIntent: { type: "boolean" },
            emailIntent: { type: "string", maxLength: 320 },
            giftReceiptIntent: { type: "boolean" },
            authorizationToken: { type: "string", minLength: 1, maxLength: 2048 },
            payments: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["method", "amount"],
                additionalProperties: false,
                properties: {
                  method: {
                    type: "string",
                    enum: ["CASH", "CARD", "BIZUM", "VOUCHER", "OTHER"],
                  },
                  amount: { type: "number", minimum: 0, maximum: 1_000_000 },
                  meta: { type: "object", additionalProperties: true },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId } = request.params as { ticketId: string };
      const body = request.body as Omit<CreateTicketBody, "externalId" | "registerId" | "shiftId" | "lines"> & {
        payments: TicketPaymentBody[];
      };
      const prisma = getPrisma();

      const draft = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId: cashier.tid },
        include: ticketInclude(),
      });
      if (!draft) {
        return reply
          .code(404)
          .send({ error: "TICKET_NOT_FOUND", message: "Ticket no encontrado" });
      }
      if (draft.registerId !== cashier.rid) {
        return reply.code(403).send({
          error: "REGISTER_MISMATCH",
          message: "El ticket no pertenece a tu caja.",
        });
      }
      if (draft.status !== "DRAFT") {
        // Si el ticket ya está PAID o SYNCED, el cobro ya pasó. F6
        // (WebSockets) ya habrá notificado a este device; pero por si
        // dos cajeros pulsaron Cobrar al mismo tiempo, último gana en
        // backend con un 409 limpio.
        return reply.code(409).send({
          error: "TICKET_ALREADY_PAID",
          message: "Este ticket ya fue cobrado por otro dispositivo.",
        });
      }
      if (draft.lines.length === 0) {
        return reply.code(400).send({
          error: "TICKET_EMPTY",
          message: "No se puede cobrar un ticket sin líneas.",
        });
      }
      for (const l of draft.lines) {
        if (!l.sku || l.sku.trim() === "") {
          return reply.code(400).send({
            error: "LINE_WITHOUT_SKU",
            message:
              "Una línea sin SKU no es vendible vía Holded. Edita la línea o usa el comodín.",
            line: l.nameSnapshot,
          });
        }
      }

      // Recalcula totales: el unitPrice persistido es el BASE; los
      // deltas estructurados de modifiers (B-Bar-Modifiers) se aplican
      // aquí para que el cobro coincida con lo que el cajero ve en
      // pantalla del TPV.
      const totals = computeTicket(
        draft.lines.map((l) => ({
          units: Number(l.units),
          unitPrice:
            Number(l.unitPrice) + readUnitPriceDeltaCents(l.modifiers) / 100,
          discountPct: Number(l.discountPct),
          taxRate: Number(l.taxRate),
        })),
      );
      const paymentsSum = body.payments.reduce((acc, p) => acc + p.amount, 0);
      if (paymentsSum + PAYMENT_TOLERANCE_EUR < totals.total) {
        return reply.code(400).send({
          error: "PAYMENTS_MISMATCH",
          message: `Σ payments (${paymentsSum.toFixed(2)}) menor que total (${totals.total.toFixed(2)})`,
          tolerance: PAYMENT_TOLERANCE_EUR,
        });
      }

      // Validación de descuento (idéntica a POST /tickets B6 §2).
      const tenantForDiscount = await prisma.tenant.findUniqueOrThrow({
        where: { id: cashier.tid },
        select: { discountThresholdPct: true },
      });
      const grossSubtotal = totals.subtotal + totals.discount;
      const effectiveDiscountPct =
        grossSubtotal > 0
          ? Math.round((totals.discount / grossSubtotal) * 10000) / 100
          : 0;
      const thresholdPct = Number(tenantForDiscount.discountThresholdPct);
      let discountAuthorizedBy: string | null = null;
      if (effectiveDiscountPct > thresholdPct + 1e-6) {
        if (!body.authorizationToken) {
          return reply.code(403).send({
            error: "MANAGER_AUTHORIZATION_REQUIRED",
            message: `El descuento del ${effectiveDiscountPct.toFixed(2)}% supera el umbral del tenant (${thresholdPct.toFixed(2)}%). Pide al encargado que autorice con su PIN.`,
            effectiveDiscountPct,
            thresholdPct,
          });
        }
        let authPayload;
        try {
          authPayload = verifyManagerAuthorization(body.authorizationToken);
        } catch {
          return reply.code(403).send({
            error: "MANAGER_AUTHORIZATION_INVALID",
            message:
              "La autorización del encargado ha caducado o no es válida.",
          });
        }
        if (
          authPayload.tid !== cashier.tid ||
          authPayload.purpose !== "discount-override"
        ) {
          return reply.code(403).send({
            error: "MANAGER_AUTHORIZATION_INVALID",
            message: "La autorización no es válida para este descuento.",
          });
        }
        if (effectiveDiscountPct > authPayload.context.maxDiscountPct + 1e-6) {
          return reply.code(403).send({
            error: "MANAGER_AUTHORIZATION_INSUFFICIENT",
            message: `La autorización cubre hasta ${authPayload.context.maxDiscountPct.toFixed(2)}% pero el descuento aplicado es del ${effectiveDiscountPct.toFixed(2)}%.`,
          });
        }
        const manager = await prisma.user.findFirst({
          where: {
            id: authPayload.sub,
            tenantId: cashier.tid,
            role: { in: ["MANAGER", "OWNER"] },
          },
          select: { email: true },
        });
        if (!manager) {
          return reply.code(403).send({
            error: "MANAGER_AUTHORIZATION_INVALID",
            message:
              "El encargado autorizante ya no está activo en el tenant.",
          });
        }
        discountAuthorizedBy = manager.email;
      }

      // internalNumber atómico — sólo al cobrar (B7 §4: los DRAFT no
      // consumen serie). Patrón idéntico al POST /tickets.
      const next = await prisma.register.update({
        where: { id: cashier.rid },
        data: { ticketCounter: { increment: 1 } },
        select: { ticketCounter: true },
      });
      const internalNumber = String(next.ticketCounter).padStart(6, "0");

      const updated = await prisma.$transaction(async (tx) => {
        const t = await tx.ticket.update({
          where: { id: draft.id },
          data: {
            status: TicketStatus.PENDING_SYNC,
            internalNumber,
            contactHoldedId: body.contactHoldedId ?? draft.contactHoldedId,
            notes: body.notes ?? draft.notes,
            cashAmount:
              body.cashAmount != null
                ? new Prisma.Decimal(body.cashAmount)
                : draft.cashAmount,
            printIntent: body.printIntent ?? draft.printIntent,
            emailIntent: body.emailIntent ?? draft.emailIntent,
            giftReceiptIntentAt: body.giftReceiptIntent
              ? new Date()
              : draft.giftReceiptIntentAt,
            discountAuthorizedBy,
            total: new Prisma.Decimal(totals.total),
            totalTax: new Prisma.Decimal(totals.tax),
            totalDiscount: new Prisma.Decimal(totals.discount),
            paidAt: new Date(),
            payments: {
              deleteMany: {},
              create: body.payments.map((p) => ({
                method: p.method,
                amount: new Prisma.Decimal(p.amount),
                meta: p.meta ? (p.meta as object) : Prisma.JsonNull,
              })),
            },
          },
          include: ticketInclude(),
        });
        // Si la mesa estaba absorbida por una principal (grupo), la
        // liberamos: el ticket principal absorbió las líneas en su día
        // y al cobrarse, las absorbidas vuelven a libre (B7 §5.4).
        if (draft.tableId) {
          await tx.table.updateMany({
            where: { groupedIntoTableId: draft.tableId },
            data: { groupedIntoTableId: null },
          });
        }
        await tx.shift.update({
          where: { id: draft.shiftId },
          data: { lastActivityAt: new Date() },
        });
        await tx.holdedUpload.upsert({
          where: { externalId: draft.externalId },
          create: {
            externalId: draft.externalId,
            tenantId: cashier.tid,
            kind: "TICKET",
            status: "PENDING",
          },
          update: {},
        });
        return t;
      });

      try {
        await enqueueTicketUpload(draft.externalId);
      } catch (err) {
        request.log.error(
          { externalId: draft.externalId },
          `enqueue ticket upload (mesa) falló: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      try {
        await maybeEnqueueAutoEmail({
          prisma,
          ticketId: updated.id,
          registerId: cashier.rid,
          contactHoldedId: body.contactHoldedId ?? draft.contactHoldedId ?? null,
          manualEmailIntent: body.emailIntent ?? null,
          requestedByUserId: cashier.sub,
          logger: { warn: (msg, extra) => request.log.warn(extra ?? {}, msg) },
        });
      } catch (err) {
        request.log.warn(
          { ticketId: updated.id },
          `auto-email enqueue falló: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (draft.tableId) {
        const storeForBroadcast = await prisma.register.findUnique({
          where: { id: cashier.rid },
          select: { storeId: true },
        });
        if (storeForBroadcast) {
          getStoreEventBus().broadcast(storeForBroadcast.storeId, {
            type: "table.paid",
            tableId: draft.tableId,
            ticketId: updated.id,
            holdedDocNumber: updated.holdedDocNumber ?? null,
            at: new Date().toISOString(),
          });
        }
      }

      request.log.info(
        {
          event: "ticket.checkout",
          tenantId: cashier.tid,
          registerId: cashier.rid,
          cashierId: cashier.sub,
          ticketId: updated.id,
          tableId: draft.tableId,
          externalId: draft.externalId,
          totalEur: totals.total,
        },
        "Mesa cobrada (DRAFT → PENDING_SYNC)",
      );

      return reply.code(200).send({
        ticket: serializeTicket(updated),
        syncStatus: updated.status,
      });
    },
  );

  // ── GET /tickets/:id ────────────────────────────────────────────────
  app.get(
    "/tickets/:ticketId",
    {
      preHandler: requireCashierSession,
      schema: {
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId } = request.params as { ticketId: string };
      const prisma = getPrisma();
      const ticket = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId: cashier.tid },
        include: ticketInclude(),
      });
      if (!ticket) {
        return reply
          .code(404)
          .send({ error: "TICKET_NOT_FOUND", message: "Ticket no encontrado" });
      }
      return { ticket: serializeTicket(ticket) };
    },
  );

  // ── GET /tickets ────────────────────────────────────────────────────
  app.get(
    "/tickets",
    {
      preHandler: requireCashierSession,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            q: { type: "string", maxLength: 64 },
            from: { type: "string", format: "date-time" },
            to: { type: "string", format: "date-time" },
            status: {
              type: "string",
              enum: [
                "DRAFT",
                "PAID",
                "PENDING_SYNC",
                "SYNCED",
                "SYNC_FAILED",
                "VOIDED",
              ],
            },
            registerId: { type: "string", format: "uuid" },
            shiftId: { type: "string", format: "uuid" },
            method: {
              type: "string",
              enum: ["CASH", "CARD", "BIZUM", "VOUCHER", "OTHER"],
            },
            cursor: { type: "string", format: "uuid" },
            limit: { type: "integer", minimum: 1, maximum: 100 },
          },
        },
      },
    },
    async (request) => {
      const cashier = request.cashier!;
      const q = request.query as {
        q?: string;
        from?: string;
        to?: string;
        status?: TicketStatus;
        registerId?: string;
        shiftId?: string;
        method?: string;
        cursor?: string;
        limit?: number;
      };
      const prisma = getPrisma();
      const limit = q.limit ?? 25;
      const where: Prisma.TicketWhereInput = {
        tenantId: cashier.tid,
      };
      if (q.status) where.status = q.status;
      if (q.registerId) where.registerId = q.registerId;
      if (q.shiftId) where.shiftId = q.shiftId;
      if (q.from || q.to) {
        where.createdAt = {};
        if (q.from) where.createdAt.gte = new Date(q.from);
        if (q.to) where.createdAt.lte = new Date(q.to);
      }
      if (q.q) {
        // Búsqueda: número interno (correlativo), externalId completo,
        // o docNumber fiscal.
        where.OR = [
          { internalNumber: q.q },
          { holdedDocNumber: q.q },
          { externalId: q.q as string },
        ];
      }
      if (q.method) {
        where.payments = { some: { method: q.method as "CASH" } };
      }
      const tickets = await prisma.ticket.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        include: ticketInclude(),
      });
      const hasMore = tickets.length > limit;
      const items = (hasMore ? tickets.slice(0, limit) : tickets).map(
        serializeTicket,
      );
      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]!.id : null,
      };
    },
  );

  // ── POST /tickets/:id/resend-email ──────────────────────────────────
  app.post(
    "/tickets/:ticketId/resend-email",
    {
      preHandler: requireCashierSession,
      schema: {
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["email"],
          additionalProperties: false,
          properties: { email: { type: "string", maxLength: 320 } },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId } = request.params as { ticketId: string };
      const { email } = request.body as { email: string };
      const prisma = getPrisma();
      const ticket = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId: cashier.tid },
        select: { id: true, status: true, holdedDocumentId: true },
      });
      if (!ticket) {
        return reply
          .code(404)
          .send({ error: "TICKET_NOT_FOUND", message: "Ticket no encontrado" });
      }
      const job = await prisma.ticketEmailJob.create({
        data: {
          id: randomUUID(),
          ticketId: ticket.id,
          toEmail: email,
          requestedByUserId: cashier.sub,
          status: "PENDING",
        },
        select: { id: true },
      });
      try {
        await enqueueTicketEmail(job.id);
      } catch (err) {
        request.log.warn(
          { ticketId, jobId: job.id },
          `enqueue ticket email falló: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return reply.code(202).send({ jobId: job.id });
    },
  );

  // ── POST /tickets/:id/gift-receipt-intent ───────────────────────────
  app.post(
    "/tickets/:ticketId/gift-receipt-intent",
    {
      preHandler: requireCashierSession,
      schema: {
        params: {
          type: "object",
          required: ["ticketId"],
          properties: { ticketId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const { ticketId } = request.params as { ticketId: string };
      const prisma = getPrisma();
      const ticket = await prisma.ticket.findFirst({
        where: { id: ticketId, tenantId: cashier.tid },
        select: { id: true, status: true },
      });
      if (!ticket) {
        return reply
          .code(404)
          .send({ error: "TICKET_NOT_FOUND", message: "Ticket no encontrado" });
      }
      // Núcleo §11: ticket regalo sólo aplica a tickets SYNCED. En B4
      // sólo guardamos intent — B5 hará la impresión real.
      await prisma.ticket.update({
        where: { id: ticketId },
        data: { giftReceiptIntentAt: new Date() },
      });
      return reply.code(200).send({ ok: true });
    },
  );

  // ── POST /refunds ───────────────────────────────────────────────────
  app.post(
    "/refunds",
    {
      preHandler: requireCashierSession,
      schema: {
        body: {
          type: "object",
          required: ["externalId", "originalTicketId", "lines"],
          additionalProperties: false,
          properties: {
            externalId: { type: "string", pattern: UUID_V4 },
            originalTicketId: { type: "string", format: "uuid" },
            method: {
              type: "string",
              enum: ["CASH", "CARD", "BIZUM", "VOUCHER", "OTHER"],
            },
            reason: { type: "string", maxLength: 500 },
            lines: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                required: ["ticketLineId", "units"],
                additionalProperties: false,
                properties: {
                  ticketLineId: { type: "string", format: "uuid" },
                  units: { type: "number", exclusiveMinimum: 0, maximum: 99999 },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const cashier = request.cashier!;
      const body = request.body as {
        externalId: string;
        originalTicketId: string;
        method?: "CASH" | "CARD" | "BIZUM" | "VOUCHER" | "OTHER";
        reason?: string;
        lines: Array<{ ticketLineId: string; units: number }>;
      };
      const prisma = getPrisma();

      // Idempotencia.
      const existing = await prisma.refund.findUnique({
        where: { externalId: body.externalId },
        include: refundInclude(),
      });
      if (existing) {
        return reply.code(200).send({ refund: serializeRefund(existing), duplicate: true });
      }

      const ticket = await prisma.ticket.findFirst({
        where: { id: body.originalTicketId, tenantId: cashier.tid },
        include: { lines: true, payments: true, refunds: { include: { lines: true } } },
      });
      if (!ticket) {
        return reply
          .code(404)
          .send({ error: "TICKET_NOT_FOUND", message: "Ticket original no encontrado" });
      }
      if (ticket.status !== TicketStatus.SYNCED && ticket.status !== TicketStatus.PAID) {
        return reply.code(409).send({
          error: "TICKET_NOT_REFUNDABLE",
          message:
            "Sólo se puede devolver un ticket cobrado y sincronizado con Holded.",
        });
      }

      // Validar unidades por línea: nunca exceder unidades originales
      // menos las ya devueltas en refunds previos.
      const alreadyRefunded = new Map<string, number>();
      for (const r of ticket.refunds) {
        for (const rl of r.lines) {
          alreadyRefunded.set(
            rl.ticketLineId,
            (alreadyRefunded.get(rl.ticketLineId) ?? 0) + Number(rl.units),
          );
        }
      }
      const refundLinesData: Array<{
        ticketLineId: string;
        units: number;
        nameSnapshot: string;
        sku: string;
        unitPrice: number;
        taxRate: number;
        discountPct: number;
        total: number;
      }> = [];
      for (const rl of body.lines) {
        const original = ticket.lines.find((l) => l.id === rl.ticketLineId);
        if (!original) {
          return reply.code(400).send({
            error: "REFUND_LINE_NOT_FOUND",
            message: `La línea ${rl.ticketLineId} no pertenece al ticket original.`,
          });
        }
        const previouslyRefunded = alreadyRefunded.get(rl.ticketLineId) ?? 0;
        const maxRefundable = Number(original.units) - previouslyRefunded;
        if (rl.units > maxRefundable + 1e-9) {
          return reply.code(400).send({
            error: "REFUND_EXCEEDS_ORIGINAL",
            message: `No puedes devolver más unidades de las vendidas (${maxRefundable} máx).`,
            ticketLineId: rl.ticketLineId,
          });
        }
        const unitPrice = Number(original.unitPrice);
        const discountPct = Number(original.discountPct);
        const taxRate = Number(original.taxRate);
        const grossPerUnit = unitPrice * (1 - discountPct / 100);
        const lineTotal = Math.round(grossPerUnit * rl.units * (1 + taxRate / 100) * 100) / 100;
        refundLinesData.push({
          ticketLineId: rl.ticketLineId,
          units: rl.units,
          nameSnapshot: original.nameSnapshot,
          sku: original.sku,
          unitPrice,
          taxRate,
          discountPct,
          total: lineTotal,
        });
      }

      const total = Math.round(refundLinesData.reduce((acc, l) => acc + l.total, 0) * 100) / 100;
      // tax aprox: total - (total / (1+max(taxRate)/100)). Mejor: línea-a-línea.
      const tax = Math.round(
        refundLinesData.reduce((acc, l) => {
          const subtotal = (l.total * 100) / (100 + Number(l.taxRate));
          return acc + (l.total - subtotal);
        }, 0) * 100,
      ) / 100;

      // Método por defecto: el del cobro original (primer payment).
      const methodFromPayment = ticket.payments[0]?.method ?? null;
      const method = body.method ?? methodFromPayment;

      // Internal number del refund: prefijo "R-" + correlativo register.
      const next = await prisma.register.update({
        where: { id: ticket.registerId },
        data: { ticketCounter: { increment: 1 } },
        select: { ticketCounter: true },
      });
      const internalNumber = `R-${String(next.ticketCounter).padStart(6, "0")}`;

      // Find an open shift on this register for the actor (refund is
      // attributed to the actor's current shift if there is one).
      const openShift = await prisma.shift.findFirst({
        where: { registerId: ticket.registerId, closedAt: null },
        select: { id: true },
      });

      const refund = await prisma.$transaction(async (tx) => {
        const r = await tx.refund.create({
          data: {
            tenantId: cashier.tid,
            originalTicketId: ticket.id,
            userId: cashier.sub,
            registerId: ticket.registerId,
            shiftId: openShift?.id ?? null,
            internalNumber,
            externalId: body.externalId,
            status: TicketStatus.PENDING_SYNC,
            reason: body.reason ?? null,
            method,
            total: new Prisma.Decimal(total),
            totalTax: new Prisma.Decimal(tax),
            lines: {
              create: refundLinesData.map((l) => ({
                ticketLineId: l.ticketLineId,
                units: new Prisma.Decimal(l.units),
                total: new Prisma.Decimal(l.total),
                nameSnapshot: l.nameSnapshot,
                sku: l.sku,
                unitPrice: new Prisma.Decimal(l.unitPrice),
                taxRate: new Prisma.Decimal(l.taxRate),
                discountPct: new Prisma.Decimal(l.discountPct),
              })),
            },
          },
          include: refundInclude(),
        });
        await tx.holdedUpload.upsert({
          where: { externalId: body.externalId },
          create: {
            externalId: body.externalId,
            tenantId: cashier.tid,
            kind: "REFUND",
            status: "PENDING",
          },
          update: {},
        });
        return r;
      });

      try {
        await enqueueRefundUpload(body.externalId);
      } catch (err) {
        request.log.error(
          { externalId: body.externalId },
          `enqueue refund upload falló: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return reply.code(201).send({ refund: serializeRefund(refund) });
    },
  );
}

function ticketInclude() {
  return {
    lines: true,
    payments: true,
    refunds: { select: { id: true, externalId: true, total: true, createdAt: true, status: true } },
    register: { select: { id: true, name: true, store: { select: { name: true } } } },
  } as const;
}

// Suma de `priceDeltaCents` del snapshot estructurado de modifiers.
// Devuelve 0 si el campo es null, string[] legacy, o no es array.
function readUnitPriceDeltaCents(raw: unknown): number {
  if (!Array.isArray(raw)) return 0;
  let sum = 0;
  for (const entry of raw) {
    if (
      entry &&
      typeof entry === "object" &&
      "priceDeltaCents" in entry &&
      typeof (entry as { priceDeltaCents?: unknown }).priceDeltaCents === "number"
    ) {
      sum += (entry as { priceDeltaCents: number }).priceDeltaCents;
    }
  }
  return sum;
}

// Serializa el JSON de TicketLine.modifiers tal cual lo verá el frontend.
// El campo puede contener tres formas: null (sin modifiers), string[]
// (legacy ad-hoc) u object[] con shape ModifierSnapshotEntry (B-Bar-
// Modifiers). El renderer del TPV se basa en el tipo del primer elemento.
function serializeLineModifiers(raw: unknown): unknown[] {
  if (!Array.isArray(raw)) return [];
  return raw as unknown[];
}

// Construye el valor para TicketLine.modifiers (JSONB nullable).
// Prioriza el snapshot estructurado del modal — si está vacío, cae a
// las strings legacy ad-hoc. Si ambos están vacíos → JsonNull.
function buildModifiersSnapshot(
  legacyStrings: string[] | undefined,
  structuredSnapshot: ModifierSnapshotEntry[],
): typeof Prisma.JsonNull | object {
  if (structuredSnapshot.length > 0) {
    return structuredSnapshot as unknown as object;
  }
  if (legacyStrings && legacyStrings.length > 0) {
    return legacyStrings as unknown as object;
  }
  return Prisma.JsonNull;
}

// Mapea un error de validación de modifier a una respuesta 400 con
// shape compatible con el resto de endpoints (error + code + message).
function buildModifierErrorReply(
  result: Extract<ResolveResult, { ok: false }>,
  lineName: string,
): {
  error: string;
  code: string;
  message: string;
  line: string;
  groupId: string;
  modifierId?: string;
} {
  const err = result.error;
  switch (err.kind) {
    case "GROUP_NOT_FOUND":
      return {
        error: "MODIFIER_GROUP_NOT_FOUND",
        code: "MODIFIER_GROUP_NOT_FOUND",
        message: `El grupo de modificadores no existe o ha sido eliminado: ${err.groupId}`,
        line: lineName,
        groupId: err.groupId,
      };
    case "MODIFIER_NOT_FOUND":
      return {
        error: "MODIFIER_NOT_FOUND",
        code: "MODIFIER_NOT_FOUND",
        message: `El modificador no pertenece al grupo indicado o ha sido eliminado.`,
        line: lineName,
        groupId: err.groupId,
        modifierId: err.modifierId,
      };
    case "EXCLUSIVE_VIOLATION":
      return {
        error: "MODIFIER_EXCLUSIVE_VIOLATION",
        code: "MODIFIER_EXCLUSIVE_VIOLATION",
        message: `El grupo es exclusivo y solo admite un modificador seleccionado.`,
        line: lineName,
        groupId: err.groupId,
      };
    case "REQUIRED_VIOLATION":
      return {
        error: "MODIFIER_REQUIRED_VIOLATION",
        code: "MODIFIER_REQUIRED_VIOLATION",
        message: `El grupo es obligatorio y requiere al menos una selección.`,
        line: lineName,
        groupId: err.groupId,
      };
  }
}

function refundInclude() {
  return {
    lines: true,
  } as const;
}

type DbTicket = Awaited<ReturnType<ReturnType<typeof getPrisma>["ticket"]["findUniqueOrThrow"]>> & {
  lines: Array<unknown>;
  payments: Array<unknown>;
  refunds: Array<unknown>;
  register?: { id: string; name: string; store: { name: string } };
};

function serializeTicket(t: DbTicket): Record<string, unknown> {
  const ticket = t as unknown as {
    id: string;
    internalNumber: string;
    externalId: string;
    status: TicketStatus;
    total: { toString(): string };
    totalTax: { toString(): string };
    totalDiscount: { toString(): string };
    cashAmount: { toString(): string } | null;
    notes: string | null;
    contactHoldedId: string | null;
    registerId: string;
    shiftId: string;
    userId: string;
    holdedDocumentId: string | null;
    holdedDocNumber: string | null;
    holdedPdfUrl: string | null;
    printIntent: boolean;
    emailIntent: string | null;
    giftReceiptIntentAt: Date | null;
    syncError: unknown;
    createdAt: Date;
    paidAt: Date | null;
    syncedAt: Date | null;
    lines: Array<{
      id: string;
      productId: string | null;
      variantId: string | null;
      holdedProductId: string | null;
      sku: string;
      nameSnapshot: string;
      units: { toString(): string };
      unitPrice: { toString(): string };
      discountPct: { toString(): string };
      taxRate: { toString(): string };
      subtotal: { toString(): string };
      total: { toString(): string };
      modifiers: unknown;
    }>;
    payments: Array<{
      id: string;
      method: string;
      amount: { toString(): string };
      meta: unknown;
    }>;
    refunds: Array<{
      id: string;
      externalId: string;
      total: { toString(): string };
      createdAt: Date;
      status: string;
    }>;
    register?: { id: string; name: string; store: { name: string } };
  };
  return {
    id: ticket.id,
    internalNumber: ticket.internalNumber,
    externalId: ticket.externalId,
    status: ticket.status,
    total: Number(ticket.total.toString()),
    totalTax: Number(ticket.totalTax.toString()),
    totalDiscount: Number(ticket.totalDiscount.toString()),
    cashAmount: ticket.cashAmount ? Number(ticket.cashAmount.toString()) : null,
    notes: ticket.notes,
    contactHoldedId: ticket.contactHoldedId,
    registerId: ticket.registerId,
    shiftId: ticket.shiftId,
    userId: ticket.userId,
    holdedDocumentId: ticket.holdedDocumentId,
    holdedDocNumber: ticket.holdedDocNumber,
    holdedPdfUrl: ticket.holdedPdfUrl,
    printIntent: ticket.printIntent,
    emailIntent: ticket.emailIntent,
    giftReceiptIntentAt: ticket.giftReceiptIntentAt?.toISOString() ?? null,
    syncError: ticket.syncError,
    createdAt: ticket.createdAt.toISOString(),
    paidAt: ticket.paidAt?.toISOString() ?? null,
    syncedAt: ticket.syncedAt?.toISOString() ?? null,
    register: ticket.register
      ? {
          id: ticket.register.id,
          name: ticket.register.name,
          storeName: ticket.register.store.name,
        }
      : undefined,
    lines: ticket.lines.map((l) => ({
      id: l.id,
      productId: l.productId,
      variantId: l.variantId,
      holdedProductId: l.holdedProductId,
      sku: l.sku,
      nameSnapshot: l.nameSnapshot,
      units: Number(l.units.toString()),
      unitPrice: Number(l.unitPrice.toString()),
      discountPct: Number(l.discountPct.toString()),
      taxRate: Number(l.taxRate.toString()),
      subtotal: Number(l.subtotal.toString()),
      total: Number(l.total.toString()),
      modifiers: serializeLineModifiers(l.modifiers),
    })),
    payments: ticket.payments.map((p) => ({
      id: p.id,
      method: p.method,
      amount: Number(p.amount.toString()),
      meta: p.meta,
    })),
    refunds: ticket.refunds.map((r) => ({
      id: r.id,
      externalId: r.externalId,
      total: Number(r.total.toString()),
      createdAt: r.createdAt.toISOString(),
      status: r.status,
    })),
  };
}

function serializeRefund(r: Record<string, unknown>): Record<string, unknown> {
  const refund = r as unknown as {
    id: string;
    internalNumber: string;
    externalId: string;
    status: TicketStatus;
    method: string | null;
    total: { toString(): string };
    totalTax: { toString(): string };
    holdedDocumentId: string | null;
    holdedDocNumber: string | null;
    reason: string | null;
    createdAt: Date;
    syncedAt: Date | null;
    lines: Array<{
      id: string;
      ticketLineId: string;
      nameSnapshot: string;
      sku: string;
      units: { toString(): string };
      unitPrice: { toString(): string };
      taxRate: { toString(): string };
      discountPct: { toString(): string };
      total: { toString(): string };
    }>;
  };
  return {
    id: refund.id,
    internalNumber: refund.internalNumber,
    externalId: refund.externalId,
    status: refund.status,
    method: refund.method,
    total: Number(refund.total.toString()),
    totalTax: Number(refund.totalTax.toString()),
    reason: refund.reason,
    holdedDocumentId: refund.holdedDocumentId,
    holdedDocNumber: refund.holdedDocNumber,
    createdAt: refund.createdAt.toISOString(),
    syncedAt: refund.syncedAt?.toISOString() ?? null,
    lines: refund.lines.map((l) => ({
      id: l.id,
      ticketLineId: l.ticketLineId,
      nameSnapshot: l.nameSnapshot,
      sku: l.sku,
      units: Number(l.units.toString()),
      unitPrice: Number(l.unitPrice.toString()),
      discountPct: Number(l.discountPct.toString()),
      taxRate: Number(l.taxRate.toString()),
      total: Number(l.total.toString()),
    })),
  };
}
