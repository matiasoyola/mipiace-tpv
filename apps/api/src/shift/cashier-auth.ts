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
          // v1.3-piloto-feedback · Lote 1: aceptamos OWNER. El activate
          // ya le coloca pinHash; sin esto, el dueño no podía abrir
          // turno en el TPV con su propio email.
          role: { in: ["OWNER", "MANAGER", "CASHIER"] },
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

      // v1.0-pilotos · Lote 4 (#18): el JWT vive el turno entero
      // (cashierSessionTtlMinutes, default 720 = 12 h). El auto-logout
      // por inactividad sigue siendo cashierAutoLogoutMinutes y lo
      // aplica la PWA en cliente — antes el JWT se firmaba con ese TTL
      // corto (10 min) y el cajero re-logueaba varias veces al día
      // aunque estuviera trabajando.
      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: ctx.tenantId },
        select: { cashierSessionTtlMinutes: true },
      });

      const sessionToken = signCashierSession(
        {
          sub: user.id,
          tid: ctx.tenantId,
          did: ctx.deviceId,
          rid: ctx.registerId,
          role: user.role as "OWNER" | "MANAGER" | "CASHIER",
        },
        tenant.cashierSessionTtlMinutes,
      );

      const shiftState = await getShiftStateForLogin(ctx.registerId);

      return reply.code(200).send({
        sessionToken,
        sessionTtlMinutes: tenant.cashierSessionTtlMinutes,
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

  // B-OnboardingV2: bootstrap del TPV en modo prueba. El super-admin
  // emite el JWT cashier-session (purpose=test-cashier) desde su
  // consola; el TPV lo guarda en sessionStorage y llama a este
  // endpoint para obtener el perfil del cajero, el shift abierto y
  // los datos de tenant/register/store sin pasar por PinScreen.
  app.get(
    "/shift/cashier-bootstrap",
    { preHandler: requireCashierSession },
    async (request, reply) => {
      const ctx = request.cashier!;
      if (!ctx.isTest) {
        return reply.code(403).send({
          error: "TEST_CASHIER_ONLY",
          message: "Este endpoint sólo acepta JWTs test-cashier.",
        });
      }
      const prisma = getPrisma();
      const [user, register, tenant, shift] = await Promise.all([
        prisma.user.findUnique({
          where: { id: ctx.sub },
          select: { id: true, email: true, role: true },
        }),
        prisma.register.findUnique({
          where: { id: ctx.rid },
          select: {
            id: true,
            name: true,
            numSerieHolded: true,
            store: { select: { id: true, name: true } },
          },
        }),
        prisma.tenant.findUnique({
          where: { id: ctx.tid },
          select: { id: true, name: true, cashierAutoLogoutMinutes: true },
        }),
        prisma.shift.findFirst({
          where: { registerId: ctx.rid, userId: ctx.sub, closedAt: null },
          orderBy: { openedAt: "desc" },
          select: { id: true, openedAt: true, cashOpening: true },
        }),
      ]);
      if (!user || !register || !tenant) {
        return reply.code(404).send({
          error: "TEST_CASHIER_RESOURCES_MISSING",
          message: "Faltan recursos para el modo prueba (re-provision necesaria).",
        });
      }
      return reply.code(200).send({
        user: { id: user.id, email: user.email, role: user.role },
        tenant: {
          id: tenant.id,
          name: tenant.name,
          cashierAutoLogoutMinutes: tenant.cashierAutoLogoutMinutes,
        },
        register: {
          id: register.id,
          name: register.name,
          numSerieHolded: register.numSerieHolded,
        },
        store: { id: register.store.id, name: register.store.name },
        shift: shift
          ? {
              id: shift.id,
              openedAt: shift.openedAt.toISOString(),
              cashOpening: shift.cashOpening.toString(),
            }
          : null,
      });
    },
  );
}
