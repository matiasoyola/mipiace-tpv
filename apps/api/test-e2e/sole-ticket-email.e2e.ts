// Sole · el ticket que se manda por email — contra Postgres DE VERDAD.
//
// Nació como REPRODUCCIÓN del incidente del 17-09-2026 (ticket 000257,
// 42,40 €, "abc" en el campo de email) y es, frente a frente, el banco
// que lo cierra. Cada `it` de aquí abajo era rojo antes del bloque.
//
// Por qué e2e y no un prisma falso: el incidente atraviesa cuatro capas
// que sólo se tocan de verdad contra una base real — el cobro escribe
// `email_intent`, el trigger crea un `ticket_email_jobs`, el worker lee
// ese job y construye el TicketDocument desde las tablas, y la ruta
// pública del PDF vuelve a construirlo. El fallo del 000257 vivía en la
// cuarta capa por culpa de lo escrito en la primera.

import { randomBytes, randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { E2E_DATABASE_URL, e2eEnabled, SKIP_MESSAGE } from "./e2e-env.js";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL =
  E2E_DATABASE_URL || "postgresql://e2e:e2e@127.0.0.1:5432/e2e";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_ACCESS_SECRET = "e".repeat(40);
process.env.JWT_REFRESH_SECRET = "f".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");
process.env.PUBLIC_TICKET_URL = "https://tickets.example.test";

vi.mock("../src/queues/ticket-upload.js", () => ({
  enqueueTicketUpload: async () => {},
}));
vi.mock("../src/queues/refund-upload.js", () => ({
  enqueueRefundUpload: async () => {},
}));

// La cola no es el objeto de este fichero: lo que importa es QUÉ se
// encola y qué NO. Guardamos las llamadas y ejecutamos el envío a mano
// con `sendTicketEmail`, que es lo que corre dentro del worker.
const encolados: string[] = [];
vi.mock("../src/queues/ticket-email.js", () => ({
  TICKET_EMAIL_QUEUE_NAME: "ticket-email",
  enqueueTicketEmail: async (emailJobId: string) => {
    encolados.push(emailJobId);
  },
  getTicketEmailQueue: () => {
    throw new Error("no se usa en e2e");
  },
}));

const enviados: Array<{ to: string; subject: string }> = [];
vi.mock("../src/email/sender.js", () => ({
  getEmailSender: () => ({
    send: async (msg: { to: string; subject: string }) => {
      enviados.push({ to: msg.to, subject: msg.subject });
    },
  }),
}));

const { getPrisma, shutdown } = await import("../src/context.js");
const { registerShiftRoutes } = await import("../src/shift/routes.js");
const { registerTicketRoutes } = await import("../src/tickets/routes.js");
const { registerTicketDigitalRoute } = await import(
  "../src/tickets/digital-route.js"
);
const { registerPublicTicketPdfRoute } = await import(
  "../src/tickets/public-pdf-route.js"
);
const { registerErrorHandler } = await import("../src/lib/error-handler.js");
const { registerLenientJsonParser } = await import("../src/lib/lenient-json.js");
const { signCashierSession } = await import("../src/shift/cashier-session.js");
const { sendTicketEmail } = await import("../src/tickets/send-ticket-email.js");
const { registerAdminTicketDeliveryRoutes } = await import(
  "../src/admin/ticket-delivery.js"
);
const { signAccessToken } = await import("../src/auth/tokens.js");

describe.skipIf(!e2eEnabled)("e2e · Sole · el ticket por email", () => {
  if (!e2eEnabled) console.warn(`\n${SKIP_MESSAGE}\n`);

  const prisma = getPrisma();
  let app: FastifyInstance;

  let tenantId = "";
  let storeId = "";
  let registerId = "";
  let cashierId = "";
  let token = "";
  let ownerToken = "";
  let shiftId = "";

  const auth = () => ({ authorization: `Bearer ${token}` });
  // La propietaria, para el resumen del panel.
  const ownerAuth = () => ({ authorization: `Bearer ${ownerToken}` });

  /** Un cobro de peluquería, como lo manda el AP12 de Sole. `base` es el
   *  precio SIN IVA de la línea; el pago va por el total con IVA, que es
   *  lo que la clienta pasa por el datáfono. */
  async function cobrar(args: {
    base: number;
    emailIntent?: string;
  }): Promise<{ id: string; total: number; status: number; body: any }> {
    const total = Math.round(args.base * 1.21 * 100) / 100;
    const res = await app.inject({
      method: "POST",
      url: "/tickets",
      headers: auth(),
      payload: {
        externalId: randomUUID(),
        registerId,
        shiftId,
        lines: [
          {
            nameSnapshot: "Corte + color",
            sku: "SRV-COLOR",
            units: 1,
            unitPrice: args.base,
            discountPct: 0,
            taxRate: 21,
          },
        ],
        payments: [{ method: "CARD", amount: total }],
        ...(args.emailIntent != null ? { emailIntent: args.emailIntent } : {}),
      },
    });
    const body = res.json();
    return { id: body?.ticket?.id, total, status: res.statusCode, body };
  }

  /** Los 42,40 € del 000257, en base imponible. */
  const BASE_000257 = 35.04;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    registerErrorHandler(app);
    registerLenientJsonParser(app);
    await registerShiftRoutes(app);
    await registerTicketRoutes(app);
    await registerTicketDigitalRoute(app);
    await registerPublicTicketPdfRoute(app);
    await registerAdminTicketDeliveryRoutes(app);
    await app.ready();

    const tenant = await prisma.tenant.create({
      data: {
        name: "Peluquería Sole",
        businessType: "SERVICES",
        dayCutHour: 5,
        requireCashCountOnClose: false,
      },
      select: { id: true },
    });
    tenantId = tenant.id;
    const store = await prisma.store.create({
      data: { tenantId, name: "Sole" },
      select: { id: true },
    });
    storeId = store.id;
    const register = await prisma.register.create({
      data: { storeId: store.id, name: "Caja Sole" },
      select: { id: true },
    });
    registerId = register.id;
    const cashier = await prisma.user.create({
      data: {
        tenantId,
        email: `sole+${randomUUID()}@e2e.local`,
        alias: "Ana",
        role: "CASHIER",
      },
      select: { id: true },
    });
    cashierId = cashier.id;
    token = signCashierSession(
      {
        sub: cashierId,
        tid: tenantId,
        did: randomUUID(),
        rid: registerId,
        role: "CASHIER",
      },
      720,
    );

    const owner = await prisma.user.create({
      data: {
        tenantId,
        email: `sole-owner+${randomUUID()}@e2e.local`,
        role: "OWNER",
      },
      select: { id: true },
    });
    ownerToken = signAccessToken({ sub: owner.id, tid: tenantId, role: "OWNER" });

    const opened = await app.inject({
      method: "POST",
      url: "/shift/open",
      headers: auth(),
      payload: { cashOpening: 50 },
    });
    expect(opened.statusCode).toBe(201);
    shiftId = opened.json().shift.id as string;
  });

  afterAll(async () => {
    await app?.close();
    await shutdown();
  });

  // ────────────────────────────────────────────────────────────────────
  // FRENTE 1 · el email se valida antes de cobrar y antes de encolar
  // ────────────────────────────────────────────────────────────────────

  it("F1 · cobrar con 'abc': la venta entra, el email se descarta y NO se encola nada", async () => {
    encolados.length = 0;
    const venta = await cobrar({ base: BASE_000257, emailIntent: "abc" });

    // 1. El dinero manda: la venta entra igual. Es el 42,40 € del 000257.
    expect(venta.status).toBe(201);
    expect(venta.body.ticket.total).toBe(42.4);

    // 2. Y la respuesta lo DICE, para que el TPV pueda enseñarlo en vez
    //    de callárselo. Con el valor tecleado, que es lo que Ana tiene
    //    que corregir desde el histórico.
    expect(venta.body.emailIntentRejected).toEqual({
      reason: "INVALID_EMAIL",
      value: "abc",
    });

    // 3. No se persiste. `email_intent` es lo que alimenta el reenvío y
    //    la sección Cliente del documento: guardar basura ahí es lo que
    //    rompía el PDF del 000257.
    const guardado = await prisma.ticket.findUniqueOrThrow({
      where: { id: venta.id },
      select: { emailIntent: true },
    });
    expect(guardado.emailIntent).toBeNull();

    // 4. Y no se encola NADA. Ni job en la tabla ni entrada en la cola:
    //    el worker no llega ni a despertarse para fallar tres veces.
    const jobs = await prisma.ticketEmailJob.findMany({
      where: { ticketId: venta.id },
    });
    expect(jobs).toHaveLength(0);
    expect(encolados).toHaveLength(0);
  });

  it("F1 · cobrar con un email bueno sigue funcionando exactamente igual", async () => {
    encolados.length = 0;
    const venta = await cobrar({
      base: BASE_000257,
      emailIntent: "  ana@ejemplo.com  ",
    });
    expect(venta.status).toBe(201);
    expect(venta.body.emailIntentRejected).toBeNull();

    // Recortado antes de guardar: " ana@ejemplo.com " es un email bueno
    // escrito por un dedo gordo en una pantalla de 10 pulgadas.
    const guardado = await prisma.ticket.findUniqueOrThrow({
      where: { id: venta.id },
      select: { emailIntent: true },
    });
    expect(guardado.emailIntent).toBe("ana@ejemplo.com");

    const jobs = await prisma.ticketEmailJob.findMany({
      where: { ticketId: venta.id },
      select: { toEmail: true, status: true },
    });
    expect(jobs).toEqual([{ toEmail: "ana@ejemplo.com", status: "PENDING" }]);
    expect(encolados).toHaveLength(1);
  });

  it("F1 · un cobro sin email no avisa de nada", async () => {
    const venta = await cobrar({ base: 12 });
    expect(venta.status).toBe(201);
    // Un campo vacío no es un rechazo: es una venta sin email. Avisar
    // aquí enseñaría a ignorar el aviso.
    expect(venta.body.emailIntentRejected).toBeNull();
  });

  it("F1 · resend-email con 'abc': 400 con un mensaje que se puede leer", async () => {
    encolados.length = 0;
    const venta = await cobrar({ base: 12 });
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${venta.id}/resend-email`,
      headers: auth(),
      payload: { email: "abc" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("INVALID_EMAIL");
    // En castellano y con un ejemplo, no "VALIDATION_ERROR".
    expect(body.message).toMatch(/no es válido/i);
    expect(body.message).toMatch(/ana@ejemplo\.com/);

    // Y no ha dejado rastro: ni job ni encolado.
    const jobs = await prisma.ticketEmailJob.findMany({
      where: { ticketId: venta.id },
    });
    expect(jobs).toHaveLength(0);
    expect(encolados).toHaveLength(0);
  });

  it("F1 · resend-email con un email bueno: 202, se encola y queda pendiente", async () => {
    encolados.length = 0;
    const venta = await cobrar({ base: 12 });
    const res = await app.inject({
      method: "POST",
      url: `/tickets/${venta.id}/resend-email`,
      headers: auth(),
      payload: { email: " ana@ejemplo.com " },
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().toEmail).toBe("ana@ejemplo.com");

    const jobs = await prisma.ticketEmailJob.findMany({
      where: { ticketId: venta.id },
      select: { id: true, toEmail: true, status: true },
    });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.toEmail).toBe("ana@ejemplo.com");
    expect(jobs[0]!.status).toBe("PENDING");
    expect(encolados).toEqual([jobs[0]!.id]);
  });

  // ────────────────────────────────────────────────────────────────────
  // FRENTE 2 · un email malo no rompe el documento
  // ────────────────────────────────────────────────────────────────────

  /**
   * El 000257 tal y como está HOY en la base de producción: cobrado y
   * sellado, con "abc" en `email_intent`. Se escribe por SQL directo
   * porque desde el Frente 1 la API ya no deja crearlo — y ése es
   * justamente el punto: los tickets de antes siguen ahí y no se migran.
   */
  async function ticketComoEl000257(): Promise<{
    id: string;
    publicSlug: string;
  }> {
    const venta = await cobrar({ base: BASE_000257 });
    await prisma.$executeRawUnsafe(
      `UPDATE tickets SET email_intent = 'abc' WHERE id = '${venta.id}'`,
    );
    const t = await prisma.ticket.findUniqueOrThrow({
      where: { id: venta.id },
      select: { publicSlug: true, emailIntent: true },
    });
    expect(t.emailIntent).toBe("abc");
    return { id: venta.id, publicSlug: t.publicSlug };
  }

  it("F2 · CANÓNICO · el PDF público del 000257 sale con 200, no con 400", async () => {
    const t = await ticketComoEl000257();

    const res = await app.inject({
      method: "GET",
      url: `/tickets/${t.publicSlug}/pdf`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    // Y es un PDF de verdad, no un cuerpo vacío con la cabecera puesta.
    expect(res.rawPayload.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(res.rawPayload.length).toBeGreaterThan(1000);
  });

  it("F2 · y su vista en el TPV también · el documento sale sin el email basura", async () => {
    const t = await ticketComoEl000257();

    const res = await app.inject({
      method: "GET",
      url: `/tickets/${t.id}/digital`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);

    // El documento que el TPV va a renderizar en el navegador con
    // `renderTicketPdf` (mismo `assertTicketDocument` que el servidor):
    // si "abc" siguiera ahí, la vista y "Descargar PDF" petarían en el
    // AP12 igual que petaba el QR.
    const doc = res.json().document;
    expect(doc.customer?.email).toBeUndefined();

    // Y la columna NO se ha tocado: el arreglo es al leer, no al
    // escribir. Un ticket emitido no se reescribe.
    const guardado = await prisma.ticket.findUniqueOrThrow({
      where: { id: t.id },
      select: { emailIntent: true },
    });
    expect(guardado.emailIntent).toBe("abc");
  });

  it("F2 · un ticket con email bueno sigue enseñándolo en el documento", async () => {
    const venta = await cobrar({
      base: BASE_000257,
      emailIntent: "ana@ejemplo.com",
    });
    const res = await app.inject({
      method: "GET",
      url: `/tickets/${venta.id}/digital`,
      headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().document.customer?.email).toBe("ana@ejemplo.com");
  });

  it("F2 · al worker no se le insiste con una dirección imposible", async () => {
    // Un job de los que quedaron encolados en producción el 17-09: se
    // crea por SQL porque la API ya no lo permite.
    const t = await ticketComoEl000257();
    const job = await prisma.ticketEmailJob.create({
      data: {
        id: randomUUID(),
        ticketId: t.id,
        toEmail: "abc",
        requestedByUserId: cashierId,
        status: "PENDING",
      },
      select: { id: true },
    });

    enviados.length = 0;
    // No lanza: antes reventaba con ZodError para que BullMQ reintentara
    // tres veces contra una dirección que nunca iba a existir.
    const res = await sendTicketEmail({ emailJobId: job.id, prisma });
    expect(res).toEqual({ kind: "failed", reason: "invalid_email" });
    expect(enviados).toHaveLength(0);

    // Y queda en estado TERMINAL, con el motivo escrito y las dos
    // marcas puestas — la del job, que lee el TPV, y la del ticket, que
    // leen el panel y los contadores del super-admin.
    const after = await prisma.ticketEmailJob.findUniqueOrThrow({
      where: { id: job.id },
      select: { status: true, lastError: true },
    });
    expect(after.status).toBe("FAILED");
    expect(after.lastError).toMatchObject({ reason: "invalid_email" });

    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: t.id },
      select: { emailFailedAt: true },
    });
    expect(ticket.emailFailedAt).not.toBeNull();
  });

  // ────────────────────────────────────────────────────────────────────
  // FRENTES 3 y 4 · "enviado" sólo cuando se ha enviado, y el fallo se ve
  // ────────────────────────────────────────────────────────────────────

  it("F3 · recién cobrado el email está PENDIENTE, no enviado", async () => {
    const venta = await cobrar({
      base: BASE_000257,
      emailIntent: "ana@ejemplo.com",
    });

    // Lo que lee la pantalla de "Ticket emitido". Antes decía "Enviado
    // por email a …" porque existía la fila; el worker ni había
    // arrancado. El badge se pinta ~200 ms después del cobro.
    const digital = await app.inject({
      method: "GET",
      url: `/tickets/${venta.id}/digital`,
      headers: auth(),
    });
    expect(digital.statusCode).toBe(200);
    expect(digital.json().email).toMatchObject({
      to: "ana@ejemplo.com",
      status: "PENDING",
      reason: null,
    });

    // Y lo que lee el histórico del TPV, por la misma derivación.
    const hist = await app.inject({
      method: "GET",
      url: `/tickets/${venta.id}`,
      headers: auth(),
    });
    expect(hist.json().ticket.email.status).toBe("PENDING");
  });

  it("F3 · cuando el worker confirma, y sólo entonces, pasa a ENVIADO", async () => {
    const venta = await cobrar({
      base: BASE_000257,
      emailIntent: "ana@ejemplo.com",
    });
    const job = await prisma.ticketEmailJob.findFirstOrThrow({
      where: { ticketId: venta.id },
      select: { id: true },
    });

    enviados.length = 0;
    const res = await sendTicketEmail({ emailJobId: job.id, prisma });
    expect(res).toEqual({ kind: "sent" });
    expect(enviados).toEqual([
      expect.objectContaining({ to: "ana@ejemplo.com" }),
    ]);

    const hist = await app.inject({
      method: "GET",
      url: `/tickets/${venta.id}`,
      headers: auth(),
    });
    expect(hist.json().ticket.email).toMatchObject({
      to: "ana@ejemplo.com",
      status: "SENT",
    });
  });

  it("F4 · CANÓNICO · el recorrido entero de Sole: falla, se ve, se corrige y llega", async () => {
    // 1. Un ticket del 17-09: cobrado con "abc" y con el envío muerto.
    const t = await ticketComoEl000257();
    const jobMalo = await prisma.ticketEmailJob.create({
      data: {
        id: randomUUID(),
        ticketId: t.id,
        toEmail: "abc",
        requestedByUserId: cashierId,
        status: "PENDING",
      },
      select: { id: true },
    });
    await sendTicketEmail({ emailJobId: jobMalo.id, prisma });

    // 2. El TPV lo enseña como fallido, con el motivo en castellano.
    //    Antes de este bloque esto decía "pendiente" para siempre.
    const conFallo = await app.inject({
      method: "GET",
      url: `/tickets/${t.id}`,
      headers: auth(),
    });
    expect(conFallo.json().ticket.email).toMatchObject({
      to: "abc",
      status: "FAILED",
      reason: "La dirección no es válida",
    });

    // 3. Y el resumen del panel también, en la tienda de Sole.
    const panel = await app.inject({
      method: "GET",
      url: `/admin/stores/${storeId}/email-failures`,
      headers: ownerAuth(),
    });
    expect(panel.statusCode).toBe(200);
    const fila = panel
      .json()
      .items.find((i: { internalNumber: string }) =>
        i.internalNumber === conFallo.json().ticket.internalNumber,
      );
    expect(fila).toMatchObject({
      email: { to: "abc", status: "FAILED", reason: "La dirección no es válida" },
    });

    // 4. Ana corrige el email desde el histórico y reenvía.
    const reenvio = await app.inject({
      method: "POST",
      url: `/tickets/${t.id}/resend-email`,
      headers: auth(),
      payload: { email: "ana@ejemplo.com" },
    });
    expect(reenvio.statusCode).toBe(202);

    // 5. Queda pendiente...
    const pendiente = await app.inject({
      method: "GET",
      url: `/tickets/${t.id}`,
      headers: auth(),
    });
    expect(pendiente.json().ticket.email).toMatchObject({
      to: "ana@ejemplo.com",
      status: "PENDING",
    });

    // 6. ...el worker lo manda...
    enviados.length = 0;
    const res = await sendTicketEmail({
      emailJobId: reenvio.json().jobId,
      prisma,
    });
    expect(res).toEqual({ kind: "sent" });
    expect(enviados).toEqual([
      expect.objectContaining({ to: "ana@ejemplo.com" }),
    ]);

    // 7. ...y el ticket dice ENVIADO. El fallo de antes queda tapado por
    //    el reenvío bueno, igual que pasó el 18-09 a mano.
    const enviado = await app.inject({
      method: "GET",
      url: `/tickets/${t.id}`,
      headers: auth(),
    });
    expect(enviado.json().ticket.email).toMatchObject({
      to: "ana@ejemplo.com",
      status: "SENT",
    });

    // 8. Y desaparece del resumen del propietario: ya no hay nada que
    //    perseguir. La marca vieja del ticket sigue ahí (es la huella de
    //    lo que pasó), pero el último envío salió bien.
    const panelDespues = await app.inject({
      method: "GET",
      url: `/admin/stores/${storeId}/email-failures`,
      headers: ownerAuth(),
    });
    expect(
      panelDespues
        .json()
        .items.some((i: { id: string }) => i.id === t.id),
    ).toBe(false);
  });
});
