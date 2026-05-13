import type { FastifyInstance } from "fastify";

import { getPrisma } from "../context.js";
import {
  cashierLoginRateLimit,
  inspect,
  registerFailure,
  reset,
} from "../auth/rate-limit.js";
import { verifyPassword } from "../auth/passwords.js";
import { requireDeviceToken } from "../devices/auth.js";
import { signCashierSession, requireCashierSession } from "./cashier-session.js";
import { getShiftStateForLogin } from "./state.js";

// Rate-limit clave: usamos (tenantId, email) — el tenantId viene del
// device token, así que el rate-limit es por (caja-de-este-tenant, email
// que prueba). Esto evita enumeración: una clave concreta no revela si
// el email existe; basta con haber acumulado 5 intentos contra ese email.
function rateLimitKeyFor(tenantId: string, email: string) {
  return cashierLoginRateLimit(tenantId, email.toLowerCase());
}

const emailFormat = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";

export async function registerCashierAuthRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    "/shift/cashier-login",
    {
      preHandler: requireDeviceToken,
      schema: {
        body: {
          type: "object",
          required: ["email", "pin"],
          additionalProperties: false,
          properties: {
            email: { type: "string", pattern: emailFormat, maxLength: 320 },
            pin: { type: "string", minLength: 4, maxLength: 16 },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = request.device!;
      const { email, pin } = request.body as { email: string; pin: string };
      const lowerEmail = email.toLowerCase();
      const prisma = getPrisma();

      const rlKey = rateLimitKeyFor(ctx.tenantId, lowerEmail);
      const pre = await inspect(rlKey);
      if (pre.locked) {
        return reply.code(429).send({
          error: "RATE_LIMITED",
          message: `Demasiados intentos. Vuelve a probar en ${Math.ceil(
            pre.retryAfterSeconds / 60,
          )} min.`,
          retryAfterSeconds: pre.retryAfterSeconds,
        });
      }

      const GENERIC = {
        error: "INVALID_CREDENTIALS",
        message: "Email o PIN incorrectos",
      };

      const user = await prisma.user.findFirst({
        where: {
          tenantId: ctx.tenantId,
          email: lowerEmail,
          role: { in: ["MANAGER", "CASHIER"] },
        },
        select: { id: true, role: true, pinHash: true, email: true },
      });
      if (!user || !user.pinHash) {
        const state = await registerFailure(rlKey);
        return reply.code(401).send({ ...GENERIC, attemptsRemaining: state.attemptsRemaining });
      }
      const ok = await verifyPassword(user.pinHash, pin);
      if (!ok) {
        const state = await registerFailure(rlKey);
        return reply
          .code(401)
          .send({ ...GENERIC, attemptsRemaining: state.attemptsRemaining });
      }

      await reset(rlKey);
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: ctx.tenantId },
        select: { cashierAutoLogoutMinutes: true },
      });

      const sessionToken = signCashierSession(
        {
          sub: user.id,
          tid: ctx.tenantId,
          did: ctx.deviceId,
          rid: ctx.registerId,
          role: user.role as "MANAGER" | "CASHIER",
        },
        tenant.cashierAutoLogoutMinutes,
      );

      const shiftState = await getShiftStateForLogin(ctx.registerId);

      return reply.code(200).send({
        sessionToken,
        sessionTtlMinutes: tenant.cashierAutoLogoutMinutes,
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
        shiftState,
      });
    },
  );

  app.post(
    "/shift/cashier-logout",
    { preHandler: requireCashierSession },
    async () => {
      // Sin server-side blacklist: el cliente descarta el token y se
      // acabó. Si en B4 introducimos session refresh, aquí
      // incrementaremos un sessionVersion del user (similar al
      // tokenVersion del owner).
      return { ok: true };
    },
  );
}
