// Envía el PDF del ticket por email (B-Print fase 1).
//
// Antes (B5) descargábamos el PDF de Holded vía `getReceiptPdf` y lo
// adjuntábamos al email. Eso obligaba a esperar a que el ticket
// estuviera SYNCED (sin holdedDocumentId no había PDF que descargar).
// Ahora generamos el PDF localmente con `@mipiacetpv/ticket-pdf`:
//   - Funciona en cuanto el ticket transiciona a PAID/PENDING_SYNC (sin
//     esperar a Holded — el ticket digital es el documento del cliente).
//   - Funciona offline desde el TPV (la PWA renderiza con el mismo
//     código).
//   - El holdedDocNumber, si está, aparece en notes/footer; si no,
//     usamos sólo internalNumber.

import { type PrismaClient } from "@mipiacetpv/db";
import { renderTicketPdf } from "@mipiacetpv/ticket-pdf";
import QRCode from "qrcode";

import { getEmailSender } from "../email/sender.js";
import { loadEnv } from "../env.js";
import { loadTicketDocument } from "./build-document.js";

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

interface StoreDeliveryShape {
  emailSubject?: string;
  emailBody?: string;
  qrCaption?: string;
  showQrButton?: boolean;
}

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

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
          tenant: { select: { name: true } },
          register: {
            select: {
              storeId: true,
              store: { select: { ticketDelivery: true, name: true } },
            },
          },
          user: { select: { isTestCashier: true } },
        },
      },
    },
  });
  if (!job) return { kind: "skipped", reason: "job_not_found" };
  if (job.status !== "PENDING") return { kind: "skipped", reason: "not_pending" };

  // B-OnboardingV2: en modo prueba no enviamos emails — el ticket es
  // un fantasma del equipo mipiacetpv, no un cliente real. Marcamos el
  // job como SKIPPED_TEST para que el panel super-admin pueda contar
  // los tickets fantasma y la bandeja de errores no se contamine.
  if (job.ticket.status === "TEST" || job.ticket.user?.isTestCashier === true) {
    await prisma.ticketEmailJob.update({
      where: { id: emailJobId },
      data: { status: "SKIPPED_TEST", sentAt: new Date() },
    });
    return { kind: "skipped", reason: "test_cashier" };
  }

  // Ticket en DRAFT → no hay nada que mandar todavía (aún no cobrado).
  // Diferimos: cuando pase a PAID, el endpoint de checkout encolará
  // de nuevo. Si está SYNC_FAILED u otro estado, también enviamos —
  // el PDF lo generamos nosotros, no depende de Holded.
  if (job.ticket.status === "DRAFT") {
    log.info("ticket en DRAFT, defer", { emailJobId, ticketId: job.ticketId });
    return { kind: "deferred", reason: "ticket_draft" };
  }

  await prisma.ticketEmailJob.update({
    where: { id: emailJobId },
    data: { attempts: { increment: 1 } },
  });

  const doc = await loadTicketDocument({
    prisma,
    ticketId: job.ticketId,
    overrideCustomerEmail: job.toEmail,
  });
  if (!doc) {
    await markFailed(prisma, emailJobId, "ticket_not_found");
    return { kind: "failed", reason: "ticket_not_found" };
  }

  const env = loadEnv();
  const storeDelivery =
    (job.ticket.register.store.ticketDelivery as StoreDeliveryShape | null) ?? {};
  const qrCaption = storeDelivery.qrCaption ?? "Escanea para descargar tu ticket";
  const subjectTpl = storeDelivery.emailSubject ?? "Tu ticket de {tienda} · {numero}";
  const bodyTpl =
    storeDelivery.emailBody ??
    "Hola,\n\nAdjuntamos tu ticket en PDF. ¡Gracias por tu visita!\n\n— {tienda}";

  const publicUrl = `${env.PUBLIC_TICKET_URL}/tickets/${doc.ticket.publicSlug}/pdf`;
  let qrPng: Buffer | undefined;
  try {
    qrPng = await QRCode.toBuffer(publicUrl, { type: "png", width: 256 });
  } catch (err) {
    // QR es decorativo — si la lib falla, mandamos el PDF sin QR.
    log.warn("QR generation falló (sigo sin QR)", { emailJobId, err });
  }

  let pdfBytes: Uint8Array;
  try {
    pdfBytes = await renderTicketPdf(doc, {
      qrPngBytes: qrPng ? new Uint8Array(qrPng.buffer, qrPng.byteOffset, qrPng.byteLength) : undefined,
      qrCaption,
    });
  } catch (err) {
    log.warn("renderTicketPdf falló", { emailJobId, err });
    throw err;
  }

  const vars = {
    tienda: doc.store.name,
    numero: doc.ticket.internalNumber,
    total: doc.totals.total.toFixed(2).replace(".", ",") + " €",
    fecha: doc.ticket.issuedAt.toLocaleDateString("es-ES"),
  };
  const subject = interpolate(subjectTpl, vars);
  const text = interpolate(bodyTpl, vars);

  const sender = getEmailSender();
  try {
    await sender.send({
      to: job.toEmail,
      subject,
      text,
      html: `<p>${text.replace(/\n/g, "<br/>")}</p>`,
      attachments: [
        {
          filename: `ticket-${doc.ticket.internalNumber}.pdf`,
          content: Buffer.from(pdfBytes),
          contentType: "application/pdf",
        },
      ],
    });
  } catch (err) {
    log.warn("email send falló", { emailJobId, err });
    throw err; // backoff BullMQ
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
