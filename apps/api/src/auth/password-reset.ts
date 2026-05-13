import { randomBytes } from "node:crypto";

import * as argon2 from "argon2";
import type { FastifyInstance } from "fastify";

import { getPrisma } from "../context.js";
import { getEmailSender } from "../email/sender.js";
import { loadEnv } from "../env.js";
import { hashPassword } from "./passwords.js";
import { passwordResetThrottle } from "./rate-limit.js";

const RESET_TTL_HOURS = 1;
const TOKEN_BYTES = 32;

const emailFormat = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";

function generateResetToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export async function registerPasswordResetRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    "/auth/password-reset/request",
    {
      schema: {
        body: {
          type: "object",
          required: ["email"],
          additionalProperties: false,
          properties: {
            email: { type: "string", pattern: emailFormat, maxLength: 320 },
          },
        },
      },
    },
    async (request, reply) => {
      const { email } = request.body as { email: string };
      const lowerEmail = email.toLowerCase();
      // Respuesta SIEMPRE neutra (§17.6) — el mismo body con o sin
      // resultado real. NUNCA revelar si el email existe en BD.
      const NEUTRAL = {
        message:
          "Si el email existe en nuestra base, te hemos enviado un enlace de recuperación.",
      };

      // Rate limit por email. Si excedido, devolvemos la misma
      // respuesta neutra (no 429) — un atacante no debe saber si
      // alcanzó el techo.
      const throttle = await passwordResetThrottle(lowerEmail);
      if (throttle.exceeded) {
        return reply.code(200).send(NEUTRAL);
      }

      const prisma = getPrisma();
      const user = await prisma.user.findUnique({
        where: { email: lowerEmail },
        select: { id: true, role: true, email: true },
      });
      // Sólo el propietario tiene flujo de reset por email (§17.6 lo
      // limita a OWNER explícitamente; los cajeros piden reset al
      // propietario desde el admin → cashier PIN reset endpoint).
      if (user && user.role === "OWNER") {
        const env = loadEnv();
        const plain = generateResetToken();
        const tokenHash = await argon2.hash(plain);
        const expiresAt = new Date(Date.now() + RESET_TTL_HOURS * 60 * 60 * 1000);
        await prisma.passwordResetToken.create({
          data: {
            userId: user.id,
            tokenHash,
            expiresAt,
          },
        });
        const link = `${env.PUBLIC_ADMIN_URL}/admin/reset?token=${plain}`;
        await getEmailSender().send({
          to: user.email,
          subject: "Recuperación de tu contraseña · mipiacetpv",
          text: [
            `Hola,`,
            ``,
            `Has solicitado restablecer la contraseña de tu cuenta`,
            `de administración mipiacetpv. Para continuar, abre este enlace:`,
            ``,
            link,
            ``,
            `El enlace caduca en 1 hora y solo puede usarse una vez.`,
            ``,
            `Si no has solicitado este cambio, ignora este email. Tu`,
            `contraseña actual sigue siendo válida.`,
            ``,
            `mipiacetpv`,
          ].join("\n"),
        });
      }
      return reply.code(200).send(NEUTRAL);
    },
  );

  app.post(
    "/auth/password-reset/confirm",
    {
      schema: {
        body: {
          type: "object",
          required: ["token", "newPassword"],
          additionalProperties: false,
          properties: {
            token: { type: "string", minLength: 1, maxLength: 256 },
            newPassword: { type: "string", minLength: 8, maxLength: 256 },
          },
        },
      },
    },
    async (request, reply) => {
      const { token, newPassword } = request.body as {
        token: string;
        newPassword: string;
      };
      const prisma = getPrisma();
      const now = new Date();
      const candidates = await prisma.passwordResetToken.findMany({
        where: { usedAt: null, expiresAt: { gt: now } },
        select: { id: true, tokenHash: true, userId: true },
        // En la práctica habrá <10 vivos a la vez globalmente.
        take: 1000,
      });
      let matched: (typeof candidates)[number] | null = null;
      for (const c of candidates) {
        try {
          if (await argon2.verify(c.tokenHash, token)) {
            matched = c;
            break;
          }
        } catch {
          // entry inválido — saltar.
        }
      }
      if (!matched) {
        return reply.code(410).send({
          error: "TOKEN_EXPIRED_OR_USED",
          message: "Enlace caducado o ya usado. Solicita un nuevo enlace.",
        });
      }
      const newHash = await hashPassword(newPassword);
      await prisma.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: matched!.userId },
          data: {
            passwordHash: newHash,
            tokenVersion: { increment: 1 },
          },
        });
        await tx.passwordResetToken.update({
          where: { id: matched!.id },
          data: { usedAt: now },
        });
      });
      return reply.code(200).send({ ok: true });
    },
  );
}
