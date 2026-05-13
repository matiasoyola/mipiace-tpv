// Reenvía el PDF de Holded por email. Descarga el PDF del salesreceipt
// con `getReceiptPdf` (spike §06.B) y lo manda como adjunto vía el
// EmailSender configurado (nodemailer en prod, console en dev).

import { type PrismaClient } from "@mipiacetpv/db";
import { getReceiptPdf } from "@mipiacetpv/holded-client";

import { decryptSecret } from "../crypto.js";
import { getEmailSender } from "../email/sender.js";
import { loadEnv } from "../env.js";

export interface SendTicketEmailOptions {
  emailJobId: string;
  prisma: PrismaClient;
  logger?: {
    info: (msg: string, extra?: unknown) => void;
    warn: (msg: string, extra?: unknown) => void;
    error: (msg: string, extra?: unknown) => void;
  };
}

export type SendTicketEmailResult =
  | { kind: "skipped"; reason: string }
  | { kind: "deferred"; reason: string }
  | { kind: "sent" }
  | { kind: "failed"; reason: string };

export async function sendTicketEmail(
  options: SendTicketEmailOptions,
): Promise<SendTicketEmailResult> {
  const { emailJobId, prisma } = options;
  const log = options.logger ?? consoleLogger();
  const job = await prisma.ticketEmailJob.findUnique({
    where: { id: emailJobId },
    include: {
      ticket: {
        include: {
          tenant: { select: { holdedApiKeyCiphertext: true, fiscalProfile: true, name: true } },
        },
      },
    },
  });
  if (!job) return { kind: "skipped", reason: "job_not_found" };
  if (job.status !== "PENDING") return { kind: "skipped", reason: "not_pending" };

  // Si el ticket todavía no está SYNCED, no hay PDF que descargar.
  // Diferimos hasta que el ticket-upload-worker lo encole de vuelta.
  if (job.ticket.status !== "SYNCED" || !job.ticket.holdedDocumentId) {
    log.info("ticket no SYNCED, defer", { emailJobId, ticketId: job.ticketId });
    return { kind: "deferred", reason: "ticket_not_synced" };
  }
  if (!job.ticket.tenant.holdedApiKeyCiphertext) {
    await markFailed(prisma, emailJobId, "no_holded_key");
    return { kind: "failed", reason: "no_holded_key" };
  }

  await prisma.ticketEmailJob.update({
    where: { id: emailJobId },
    data: { attempts: { increment: 1 } },
  });

  const env = loadEnv();
  const apiKey = decryptSecret(
    job.ticket.tenant.holdedApiKeyCiphertext,
    env.HOLDED_KEY_ENCRYPTION_SECRET,
  );

  let pdf: Buffer;
  try {
    pdf = await getReceiptPdf(apiKey, job.ticket.holdedDocumentId, {
      baseUrl: env.HOLDED_BASE_URL,
    });
  } catch (err) {
    // Reintentamos con backoff exponencial — el worker BullMQ lo
    // gestiona al re-lanzar.
    log.warn("getReceiptPdf falló", { emailJobId, err });
    throw err;
  }

  const sender = getEmailSender();
  try {
    await sender.send({
      to: job.toEmail,
      subject: `Tu ticket de ${job.ticket.tenant.name}${
        job.ticket.holdedDocNumber ? ` · ${job.ticket.holdedDocNumber}` : ""
      }`,
      text: `Adjuntamos tu ticket en PDF.\n\nGracias por tu compra.`,
      html: `<p>Adjuntamos tu ticket en PDF.</p><p>Gracias por tu compra.</p>`,
      attachments: [
        {
          filename: `ticket-${job.ticket.holdedDocNumber ?? job.ticket.internalNumber}.pdf`,
          content: pdf,
          contentType: "application/pdf",
        },
      ],
    });
  } catch (err) {
    log.warn("email send falló", { emailJobId, err });
    throw err; // Backoff de BullMQ se encarga.
  }

  await prisma.ticketEmailJob.update({
    where: { id: emailJobId },
    data: { status: "DONE", sentAt: new Date() },
  });
  return { kind: "sent" };
}

async function markFailed(
  prisma: PrismaClient,
  emailJobId: string,
  reason: string,
): Promise<void> {
  await prisma.ticketEmailJob.update({
    where: { id: emailJobId },
    data: { status: "FAILED", lastError: { reason } as object },
  });
}

function consoleLogger() {
  return {
    info: (msg: string, extra?: unknown) =>
      console.log(`[ticket-email] ${msg}`, extra ?? ""),
    warn: (msg: string, extra?: unknown) =>
      console.warn(`[ticket-email] ${msg}`, extra ?? ""),
    error: (msg: string, extra?: unknown) =>
      console.error(`[ticket-email] ${msg}`, extra ?? ""),
  };
}
