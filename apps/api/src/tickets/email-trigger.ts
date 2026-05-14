// Decide qué email auto-enviar tras un cobro (B-Print fase 1).
//
// Política:
//   1. Si el cajero introdujo email manualmente en el checkout, se
//      respeta — ese fue el deseo explícito de la mesa.
//   2. Si la tienda tiene `ticketDelivery.emailAutoIfCustomerHasEmail`
//      activo y el ticket lleva contacto vinculado con email, se
//      envía automático a esa dirección.
//   3. En cualquier otro caso, no se encola — el ticket digital
//      queda disponible vía QR / botones "Ver" y "Descargar" del TPV.

import { randomUUID } from "node:crypto";

import { type PrismaClient } from "@mipiacetpv/db";

import { enqueueTicketEmail } from "../queues/ticket-email.js";

const DEFAULT_DELIVERY = {
  emailAutoIfCustomerHasEmail: true,
};

interface TicketDeliverySettings {
  emailAutoIfCustomerHasEmail?: boolean;
}

export interface MaybeAutoEmailOptions {
  prisma: PrismaClient;
  ticketId: string;
  registerId: string;
  contactHoldedId: string | null;
  manualEmailIntent: string | null;
  requestedByUserId: string;
  logger?: {
    warn: (msg: string, extra?: unknown) => void;
  };
}

export async function maybeEnqueueAutoEmail(
  opts: MaybeAutoEmailOptions,
): Promise<{ enqueued: boolean; toEmail?: string }> {
  const log = opts.logger ?? { warn: () => undefined };

  // 1. Email manual — vía cajero.
  if (opts.manualEmailIntent) {
    await persistAndEnqueue(opts, opts.manualEmailIntent);
    return { enqueued: true, toEmail: opts.manualEmailIntent };
  }

  // 2. Email auto si el contacto del ticket lo tiene + la tienda lo permite.
  if (!opts.contactHoldedId) return { enqueued: false };

  const register = await opts.prisma.register.findUnique({
    where: { id: opts.registerId },
    select: { store: { select: { id: true, ticketDelivery: true } } },
  });
  if (!register) return { enqueued: false };
  const delivery =
    (register.store.ticketDelivery as TicketDeliverySettings | null) ??
    DEFAULT_DELIVERY;
  if (delivery.emailAutoIfCustomerHasEmail === false) {
    return { enqueued: false };
  }

  const contact = await opts.prisma.contact.findFirst({
    where: {
      holdedContactId: opts.contactHoldedId,
      tenant: { stores: { some: { id: register.store.id } } },
    },
    select: { email: true },
  });
  if (!contact?.email) return { enqueued: false };

  try {
    await persistAndEnqueue(opts, contact.email);
    return { enqueued: true, toEmail: contact.email };
  } catch (err) {
    log.warn(
      `auto-email falló: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { enqueued: false };
  }
}

async function persistAndEnqueue(
  opts: MaybeAutoEmailOptions,
  toEmail: string,
): Promise<void> {
  const jobId = randomUUID();
  await opts.prisma.ticketEmailJob.create({
    data: {
      id: jobId,
      ticketId: opts.ticketId,
      toEmail,
      requestedByUserId: opts.requestedByUserId,
      status: "PENDING",
    },
  });
  await enqueueTicketEmail(jobId);
}
