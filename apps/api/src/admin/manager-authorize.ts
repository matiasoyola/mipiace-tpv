// Endpoint POST /admin/auth/manager-authorize (B6 §2.3).
//
// Lo invoca el TPV cuando el cajero intenta aplicar un descuento por
// encima del umbral del tenant. El encargado teclea su email + PIN en
// el modal; el backend valida y emite un JWT corto (5 min) con claim
// `purpose: "discount-override"`. La PWA adjunta el token al `POST
// /tickets` y el handler de tickets lo verifica.
//
// El endpoint requiere `requireCashierSession`: la petición sale desde
// un device emparejado con una sesión activa, NO desde el admin. Esto
// limita la superficie a "TPV ya autenticado pide autorización", y
// permite rate-limitar por email-de-manager sin filtrar contra brute-force
// desde fuera.

import type { FastifyInstance } from "fastify";

import { verifyPassword } from "../auth/passwords.js";
import {
  inspect as inspectRateLimit,
  registerFailure as registerRateLimitFailure,
  reset as resetRateLimit,
  type RateLimitConfig,
} from "../auth/rate-limit.js";
import { signManagerAuthorization } from "../auth/manager-authorization.js";
import { getPrisma } from "../context.js";
import { requireCashierSession } from "../shift/cashier-session.js";

const emailFormat = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";

// Rate-limit independiente del de login. Clave por (tenantId,
// managerEmail) — 5 intentos en 5 min, candado 15 min. El TPV traduce
// el 429 a "Pide al encargado que reintente en X min".
function rateLimitKey(tenantId: string, managerEmail: string): RateLimitConfig {
  const slug = managerEmail.toLowerCase();
  return {
    attemptsKey: `manager-auth-attempts:${tenantId}:${slug}`,
    lockKey: `manager-auth-locked:${tenantId}:${slug}`,
  };
}

export async function registerManagerAuthorizationRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    "/admin/auth/manager-authorize",
    {
      preHandler: requireCashierSession,
      schema: {
        body: {
          type: "object",
          required: ["managerEmail", "managerPin", "reason"],
          additionalProperties: false,
          properties: {
            managerEmail: { type: "string", pattern: emailFormat, maxLength: 320 },
            managerPin: { type: "string", minLength: 4, maxLength: 16 },
            reason: {
              type: "string",
              // Hoy sólo aceptamos un motivo; el enum se ampliará cuando
              // (force-close, refund-over) reusen el flujo.
              enum: ["discount_over_threshold"],
            },
            // Contexto libre — la PWA manda lo que tenga sobre el ticket
            // para que quede en el log estructurado del backend. No es
            // confiable (viene del cliente) pero ayuda a forenses.
            ticketContext: {
              type: "object",
              additionalProperties: true,
              properties: {
                discountPct: { type: "number" },
                total: { type: "number" },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const session = request.cashier!;
      const { managerEmail, managerPin, reason } = request.body as {
        managerEmail: string;
        managerPin: string;
        reason: "discount_over_threshold";
        ticketContext?: Record<string, unknown>;
      };
      const lowerEmail = managerEmail.toLowerCase();
      const rlKey = rateLimitKey(session.tid, lowerEmail);

      const pre = await inspectRateLimit(rlKey);
      if (pre.locked) {
        return reply.code(429).send({
          error: "RATE_LIMITED",
          message: `Demasiados intentos. Vuelve a probar en ${Math.ceil(
            pre.retryAfterSeconds / 60,
          )} min.`,
          retryAfterSeconds: pre.retryAfterSeconds,
        });
      }

      const prisma = getPrisma();
      const manager = await prisma.user.findFirst({
        where: {
          tenantId: session.tid,
          email: lowerEmail,
          role: "MANAGER",
        },
        select: { id: true, email: true, pinHash: true },
      });
      // Mensaje genérico — no revelamos si el email existe ni si el rol
      // es el correcto. El cajero pide al encargado que reintroduzca.
      const GENERIC = {
        error: "INVALID_MANAGER_CREDENTIALS",
        message: "Email o PIN del encargado incorrectos.",
      };
      if (!manager || !manager.pinHash) {
        const state = await registerRateLimitFailure(rlKey);
        return reply
          .code(401)
          .send({ ...GENERIC, attemptsRemaining: state.attemptsRemaining });
      }
      const ok = await verifyPassword(manager.pinHash, managerPin);
      if (!ok) {
        const state = await registerRateLimitFailure(rlKey);
        return reply
          .code(401)
          .send({ ...GENERIC, attemptsRemaining: state.attemptsRemaining });
      }

      await resetRateLimit(rlKey);

      const authorizationToken = signManagerAuthorization({
        sub: manager.id,
        tid: session.tid,
        purpose: "discount-override",
        reason,
        // Sin condiciones sobre el descuento: el encargado validó con
        // PIN, así que el ticket puede llevar cualquier %. Si se
        // refinara, se calcularía aquí en función del `reason`.
        context: { maxDiscountPct: 100 },
      });

      request.log.info(
        {
          event: "manager_authorize.granted",
          tenantId: session.tid,
          managerId: manager.id,
          managerEmail: manager.email,
          cashierId: session.sub,
          reason,
        },
        "Autorización de encargado emitida",
      );

      return reply.code(200).send({
        authorizationToken,
        managerEmail: manager.email,
        // Útil al frontend para mostrar el countdown del token.
        expiresInSeconds: 5 * 60,
      });
    },
  );
}
