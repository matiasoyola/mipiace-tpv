import type { FastifyInstance } from "fastify";

import { Prisma } from "@mipiacetpv/db";

import {
  inspect as inspectRateLimit,
  registerFailure as registerRateLimitFailure,
  reset as resetRateLimit,
} from "../auth/rate-limit.js";
import { hashPassword, verifyPassword } from "../auth/passwords.js";
import {
  consumeRecoveryCode,
  decryptTwoFactorSecret,
  encryptTwoFactorSecret,
  generateEnrollment,
  hashRecoveryCodes,
  isRecoveryCode,
  isTotpCode,
  readStoredRecoveryCodes,
  verifyTotp,
} from "../auth/two-factor.js";
import { getPrisma } from "../context.js";

import { requireSuperAdmin } from "./middleware.js";
import { superAdminLoginRateLimit } from "./rate-limit.js";
import {
  signSuperAdminAccessToken,
  signSuperAdminPending2faToken,
  signSuperAdminRefreshToken,
  verifySuperAdminPending2faToken,
  verifySuperAdminRefreshToken,
} from "./tokens.js";

const emailFormat = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";

function clientIp(headers: Record<string, unknown>, fallback: string | null): string {
  const fwd = headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0]!.trim();
  }
  return fallback ?? "unknown";
}

export async function registerSuperAdminAuthRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    "/super-admin/auth/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          additionalProperties: false,
          properties: {
            email: { type: "string", pattern: emailFormat, maxLength: 320 },
            password: { type: "string", minLength: 1, maxLength: 256 },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body as {
        email: string;
        password: string;
      };
      const lowerEmail = email.toLowerCase();
      const ip = clientIp(request.headers, request.ip);
      const rlKey = superAdminLoginRateLimit(lowerEmail, ip);

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
      const sa = await prisma.superAdminUser.findUnique({
        where: { email: lowerEmail },
      });

      const GENERIC = {
        error: "INVALID_CREDENTIALS",
        message: "Email o contraseña incorrectos",
      };

      if (!sa) {
        await registerRateLimitFailure(rlKey);
        return reply.code(401).send(GENERIC);
      }
      const ok = await verifyPassword(sa.passwordHash, password);
      if (!ok) {
        await registerRateLimitFailure(rlKey);
        return reply.code(401).send(GENERIC);
      }

      await resetRateLimit(rlKey);

      // 2FA: si está habilitado, devolvemos pendingToken sin emitir
      // tokens reales. El front pasa al segundo paso.
      if (sa.totpEnabledAt != null) {
        const pendingToken = signSuperAdminPending2faToken(sa.id);
        return reply.code(200).send({ requires2fa: true, pendingToken });
      }

      await prisma.superAdminUser.update({
        where: { id: sa.id },
        data: { lastLoginAt: new Date() },
      });

      return {
        accessToken: signSuperAdminAccessToken({ sub: sa.id, tv: sa.tokenVersion }),
        refreshToken: signSuperAdminRefreshToken({ sub: sa.id, tv: sa.tokenVersion }),
      };
    },
  );

  app.post(
    "/super-admin/auth/login-2fa",
    {
      schema: {
        body: {
          type: "object",
          required: ["pendingToken", "code"],
          additionalProperties: false,
          properties: {
            pendingToken: { type: "string", minLength: 1 },
            code: { type: "string", minLength: 6, maxLength: 16 },
          },
        },
      },
    },
    async (request, reply) => {
      const { pendingToken, code } = request.body as {
        pendingToken: string;
        code: string;
      };
      let payload;
      try {
        payload = verifySuperAdminPending2faToken(pendingToken);
      } catch {
        return reply.code(401).send({
          error: "INVALID_PENDING_TOKEN",
          message: "Sesión de 2FA caducada. Vuelve a iniciar sesión.",
        });
      }
      const prisma = getPrisma();
      const sa = await prisma.superAdminUser.findUnique({
        where: { id: payload.sub },
      });
      if (!sa || !sa.totpEnabledAt || !sa.totpSecret) {
        return reply
          .code(401)
          .send({ error: "INVALID_PENDING_TOKEN", message: "Sesión 2FA inválida." });
      }
      let authorized = false;
      let usedRecovery = false;
      if (isTotpCode(code)) {
        const secret = decryptTwoFactorSecret(sa.totpSecret);
        authorized = verifyTotp(secret, code);
      }
      if (!authorized && isRecoveryCode(code)) {
        const stored = readStoredRecoveryCodes(sa.recoveryCodes);
        const consumed = await consumeRecoveryCode(stored, code);
        if (consumed) {
          await prisma.superAdminUser.update({
            where: { id: sa.id },
            data: {
              recoveryCodes: consumed as unknown as Prisma.InputJsonValue,
            },
          });
          authorized = true;
          usedRecovery = true;
        }
      }
      if (!authorized) {
        return reply
          .code(401)
          .send({ error: "INVALID_2FA_CODE", message: "Código incorrecto" });
      }
      await prisma.superAdminUser.update({
        where: { id: sa.id },
        data: { lastLoginAt: new Date() },
      });
      return {
        accessToken: signSuperAdminAccessToken({ sub: sa.id, tv: sa.tokenVersion }),
        refreshToken: signSuperAdminRefreshToken({ sub: sa.id, tv: sa.tokenVersion }),
        usedRecoveryCode: usedRecovery,
      };
    },
  );

  app.post(
    "/super-admin/auth/refresh",
    {
      schema: {
        body: {
          type: "object",
          required: ["refreshToken"],
          additionalProperties: false,
          properties: { refreshToken: { type: "string", minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const { refreshToken } = request.body as { refreshToken: string };
      try {
        const payload = verifySuperAdminRefreshToken(refreshToken);
        const prisma = getPrisma();
        const sa = await prisma.superAdminUser.findUnique({
          where: { id: payload.sub },
          select: { id: true, tokenVersion: true },
        });
        if (!sa) {
          return reply
            .code(401)
            .send({ error: "INVALID_REFRESH", message: "Sesión inválida" });
        }
        if (payload.tv !== sa.tokenVersion) {
          return reply
            .code(401)
            .send({ error: "INVALID_REFRESH", message: "Sesión revocada" });
        }
        return {
          accessToken: signSuperAdminAccessToken({ sub: sa.id, tv: sa.tokenVersion }),
          refreshToken: signSuperAdminRefreshToken({
            sub: sa.id,
            tv: sa.tokenVersion,
          }),
        };
      } catch {
        return reply
          .code(401)
          .send({ error: "INVALID_REFRESH", message: "Refresh inválido" });
      }
    },
  );

  app.post(
    "/super-admin/auth/logout",
    {
      preHandler: requireSuperAdmin,
      schema: { body: { type: "object", additionalProperties: false, properties: {} } },
    },
    async (request, reply) => {
      const ctx = request.superAdmin!;
      const prisma = getPrisma();
      const updated = await prisma.superAdminUser.update({
        where: { id: ctx.superAdminId },
        data: { tokenVersion: { increment: 1 } },
        select: { tokenVersion: true },
      });
      return reply.code(200).send({ tokenVersion: updated.tokenVersion });
    },
  );

  app.get(
    "/super-admin/auth/me",
    { preHandler: requireSuperAdmin },
    async (request) => {
      const ctx = request.superAdmin!;
      const prisma = getPrisma();
      const sa = await prisma.superAdminUser.findUniqueOrThrow({
        where: { id: ctx.superAdminId },
      });
      const recovery = readStoredRecoveryCodes(sa.recoveryCodes);
      return {
        id: sa.id,
        email: sa.email,
        twoFactorEnabled: sa.totpEnabledAt != null,
        recoveryCodesRemaining: recovery.filter((c) => c.usedAt == null).length,
        lastLoginAt: sa.lastLoginAt?.toISOString() ?? null,
      };
    },
  );

  // ── 2FA TOTP super-admin ─────────────────────────────────────────────

  app.post(
    "/super-admin/auth/totp/enable",
    {
      preHandler: requireSuperAdmin,
      schema: { body: { type: "object", additionalProperties: false, properties: {} } },
    },
    async (request, reply) => {
      const ctx = request.superAdmin!;
      const prisma = getPrisma();
      const sa = await prisma.superAdminUser.findUniqueOrThrow({
        where: { id: ctx.superAdminId },
        select: { email: true, totpEnabledAt: true },
      });
      if (sa.totpEnabledAt) {
        return reply.code(409).send({
          error: "TWO_FACTOR_ALREADY_ENABLED",
          message: "El 2FA ya está activado.",
        });
      }
      const enrollment = await generateEnrollment(sa.email);
      const recoveryHashed = await hashRecoveryCodes(enrollment.recoveryCodes);
      await prisma.superAdminUser.update({
        where: { id: ctx.superAdminId },
        data: {
          totpSecret: encryptTwoFactorSecret(enrollment.secret),
          recoveryCodes: recoveryHashed as unknown as Prisma.InputJsonValue,
          totpEnabledAt: null,
        },
      });
      return reply.code(200).send({
        qrDataUrl: enrollment.qrDataUrl,
        secret: enrollment.secret,
        recoveryCodes: enrollment.recoveryCodes,
      });
    },
  );

  app.post(
    "/super-admin/auth/totp/confirm",
    {
      preHandler: requireSuperAdmin,
      schema: {
        body: {
          type: "object",
          required: ["code"],
          additionalProperties: false,
          properties: { code: { type: "string", pattern: "^[0-9]{6}$" } },
        },
      },
    },
    async (request, reply) => {
      const ctx = request.superAdmin!;
      const { code } = request.body as { code: string };
      const prisma = getPrisma();
      const sa = await prisma.superAdminUser.findUniqueOrThrow({
        where: { id: ctx.superAdminId },
        select: { totpSecret: true, totpEnabledAt: true },
      });
      if (!sa.totpSecret) {
        return reply.code(409).send({
          error: "TWO_FACTOR_NOT_ENROLLING",
          message: "No has iniciado el alta de 2FA.",
        });
      }
      if (sa.totpEnabledAt) {
        return reply.code(409).send({
          error: "TWO_FACTOR_ALREADY_ENABLED",
          message: "El 2FA ya está activo.",
        });
      }
      const secret = decryptTwoFactorSecret(sa.totpSecret);
      if (!verifyTotp(secret, code)) {
        return reply
          .code(401)
          .send({ error: "INVALID_TOTP", message: "Código incorrecto" });
      }
      await prisma.superAdminUser.update({
        where: { id: ctx.superAdminId },
        data: { totpEnabledAt: new Date() },
      });
      return reply.code(200).send({ ok: true });
    },
  );

  app.post(
    "/super-admin/auth/totp/disable",
    {
      preHandler: requireSuperAdmin,
      schema: {
        body: {
          type: "object",
          required: ["password", "code"],
          additionalProperties: false,
          properties: {
            password: { type: "string", minLength: 1 },
            code: { type: "string", minLength: 6, maxLength: 16 },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = request.superAdmin!;
      const { password, code } = request.body as {
        password: string;
        code: string;
      };
      const prisma = getPrisma();
      const sa = await prisma.superAdminUser.findUniqueOrThrow({
        where: { id: ctx.superAdminId },
      });
      if (!sa.totpEnabledAt || !sa.totpSecret) {
        return reply.code(409).send({
          error: "TWO_FACTOR_NOT_ENABLED",
          message: "El 2FA no está activo.",
        });
      }
      if (!(await verifyPassword(sa.passwordHash, password))) {
        return reply
          .code(401)
          .send({ error: "INVALID_PASSWORD", message: "Contraseña incorrecta" });
      }
      const secret = decryptTwoFactorSecret(sa.totpSecret);
      let authorized = false;
      if (isTotpCode(code) && verifyTotp(secret, code)) authorized = true;
      if (!authorized && isRecoveryCode(code)) {
        const stored = readStoredRecoveryCodes(sa.recoveryCodes);
        const consumed = await consumeRecoveryCode(stored, code);
        if (consumed) authorized = true;
      }
      if (!authorized) {
        return reply
          .code(401)
          .send({ error: "INVALID_2FA_CODE", message: "Código incorrecto" });
      }
      await prisma.superAdminUser.update({
        where: { id: ctx.superAdminId },
        data: {
          totpSecret: null,
          totpEnabledAt: null,
          recoveryCodes: Prisma.JsonNull,
        },
      });
      return reply.code(200).send({ ok: true });
    },
  );

  // Cambio de password del propio super-admin desde la consola. No
  // hay flujo de "reset por email" — si pierde la password, se rota
  // vía CLI con acceso al servidor.
  app.post(
    "/super-admin/auth/change-password",
    {
      preHandler: requireSuperAdmin,
      schema: {
        body: {
          type: "object",
          required: ["currentPassword", "newPassword"],
          additionalProperties: false,
          properties: {
            currentPassword: { type: "string", minLength: 1, maxLength: 256 },
            newPassword: { type: "string", minLength: 12, maxLength: 256 },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = request.superAdmin!;
      const { currentPassword, newPassword } = request.body as {
        currentPassword: string;
        newPassword: string;
      };
      if (currentPassword === newPassword) {
        return reply.code(400).send({
          error: "PASSWORD_NOT_CHANGED",
          message: "La nueva contraseña debe ser distinta de la actual.",
        });
      }
      const prisma = getPrisma();
      const sa = await prisma.superAdminUser.findUniqueOrThrow({
        where: { id: ctx.superAdminId },
      });
      if (!(await verifyPassword(sa.passwordHash, currentPassword))) {
        return reply
          .code(401)
          .send({ error: "INVALID_PASSWORD", message: "Contraseña actual incorrecta" });
      }
      const newHash = await hashPassword(newPassword);
      await prisma.superAdminUser.update({
        where: { id: sa.id },
        data: {
          passwordHash: newHash,
          tokenVersion: { increment: 1 },
        },
      });
      return reply.code(200).send({ ok: true });
    },
  );
}
