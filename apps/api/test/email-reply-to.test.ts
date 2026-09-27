// El From de todos nuestros emails es un no-reply. El email de
// bienvenida le dice al propietario "responde a este email" y el de
// ticket va al cliente final del bar: sin cabecera Reply-To esas
// respuestas caen en un buzón que nadie lee.
//
// SUPER_ADMIN_REPLY_TO_EMAIL llevaba configurado en el VPS desde el
// principio y el código no lo leía en ningún sitio. Estos tests son la
// guarda de que eso no vuelva a pasar.
//
// Sabotaje → test rojo:
//   - quitar `replyTo` de sendMail()            → "pone el Reply-To del sender"
//   - ignorar el replyTo por email               → "el del email manda"
//   - poner un valor fijo en vez de undefined    → "sin Reply-To configurado no inventa uno"

import { randomBytes } from "node:crypto";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.JWT_ACCESS_SECRET = "a".repeat(40);
process.env.JWT_REFRESH_SECRET = "b".repeat(40);
process.env.HOLDED_KEY_ENCRYPTION_SECRET = randomBytes(32).toString("base64");

import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn(async (_mail: Record<string, unknown>) => ({ messageId: "x" }));

vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail }) },
  createTransport: () => ({ sendMail }),
}));

const { SmtpEmailSender } = await import("../src/email/sender.js");

const OPTS = {
  host: "smtp.hostinger.com",
  port: 465,
  user: "no-reply@mipiacetpv.com",
  pass: "secreto",
  from: "Mipiacetpv <no-reply@mipiacetpv.com>",
};

describe("Reply-To del remitente", () => {
  beforeEach(() => sendMail.mockClear());

  it("pone el Reply-To del sender cuando el email no trae uno", async () => {
    const sender = new SmtpEmailSender({
      ...OPTS,
      replyTo: "soporte@mipiacetpv.com",
    });

    await sender.send({ to: "duenyo@bar.es", subject: "Hola", text: "cuerpo" });

    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(sendMail.mock.calls[0]![0]).toMatchObject({
      from: "Mipiacetpv <no-reply@mipiacetpv.com>",
      replyTo: "soporte@mipiacetpv.com",
    });
  });

  it("el Reply-To del email manda sobre el del sender", async () => {
    const sender = new SmtpEmailSender({
      ...OPTS,
      replyTo: "soporte@mipiacetpv.com",
    });

    await sender.send({
      to: "cliente@gmail.com",
      subject: "Tu ticket",
      text: "cuerpo",
      replyTo: "bar@sudominio.es",
    });

    expect(sendMail.mock.calls[0]![0]).toMatchObject({
      replyTo: "bar@sudominio.es",
    });
  });

  it("sin Reply-To configurado no se inventa uno", async () => {
    const sender = new SmtpEmailSender(OPTS);

    await sender.send({ to: "duenyo@bar.es", subject: "Hola", text: "cuerpo" });

    expect(sendMail.mock.calls[0]![0].replyTo).toBeUndefined();
  });
});
