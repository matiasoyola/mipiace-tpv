import type { FastifyInstance } from "fastify";

import { Prisma } from "@mipiacetpv/db";

import { getPrisma } from "../context.js";
import { hashPassword, verifyPassword } from "./passwords.js";
import { requireOwner } from "./middleware.js";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "./tokens.js";

const emailFormat = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";

// JSON Schema centralizado en las rutas (regla de B1).
export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/auth/signup",
    {
      schema: {
        body: {
          type: "object",
          required: ["businessName", "email", "password"],
          additionalProperties: false,
          properties: {
            businessName: { type: "string", minLength: 1, maxLength: 200 },
            email: { type: "string", pattern: emailFormat, maxLength: 320 },
            password: { type: "string", minLength: 10, maxLength: 256 },
          },
        },
      },
    },
    async (request, reply) => {
      const { businessName, email, password } = request.body as {
        businessName: string;
        email: string;
        password: string;
      };
      const prisma = getPrisma();
      const lowerEmail = email.toLowerCase();
      const existing = await prisma.user.findUnique({ where: { email: lowerEmail } });
      if (existing) {
        return reply.code(409).send({
          error: "EMAIL_TAKEN",
          message: "Ya existe una cuenta con ese email",
        });
      }
      const hash = await hashPassword(password);
      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const tenant = await tx.tenant.create({
          data: { name: businessName, holdedAuthMode: "API_KEY" },
        });
        const user = await tx.user.create({
          data: {
            tenantId: tenant.id,
            email: lowerEmail,
            passwordHash: hash,
            role: "OWNER",
          },
        });
        return { tenant, user };
      });
      const accessToken = signAccessToken({
        sub: result.user.id,
        tid: result.tenant.id,
        role: "OWNER",
      });
      const refreshToken = signRefreshToken({
        sub: result.user.id,
        tid: result.tenant.id,
      });
      return reply.code(201).send({ accessToken, refreshToken });
    },
  );

  app.post(
    "/auth/login",
    {
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          additionalProperties: false,
          properties: {
            email: { type: "string", pattern: emailFormat },
            password: { type: "string", minLength: 1, maxLength: 256 },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body as { email: string; password: string };
      const prisma = getPrisma();
      const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      // Mensaje genérico — no filtramos si el email existe.
      const GENERIC = { error: "INVALID_CREDENTIALS", message: "Email o contraseña incorrectos" };
      if (!user || !user.passwordHash) return reply.code(401).send(GENERIC);
      const ok = await verifyPassword(user.passwordHash, password);
      if (!ok) return reply.code(401).send(GENERIC);
      if (user.role !== "OWNER") {
        return reply.code(403).send({
          error: "NOT_OWNER",
          message: "Sólo el propietario entra al admin",
        });
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
      const accessToken = signAccessToken({
        sub: user.id,
        tid: user.tenantId,
        role: user.role,
      });
      const refreshToken = signRefreshToken({
        sub: user.id,
        tid: user.tenantId,
      });
      return { accessToken, refreshToken };
    },
  );

  app.post(
    "/auth/refresh",
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
        const payload = verifyRefreshToken(refreshToken);
        const prisma = getPrisma();
        const user = await prisma.user.findUnique({ where: { id: payload.sub } });
        if (!user || user.tenantId !== payload.tid) {
          return reply.code(401).send({ error: "INVALID_REFRESH", message: "Sesión inválida" });
        }
        return {
          accessToken: signAccessToken({
            sub: user.id,
            tid: user.tenantId,
            role: user.role,
          }),
          refreshToken: signRefreshToken({ sub: user.id, tid: user.tenantId }),
        };
      } catch {
        return reply.code(401).send({ error: "INVALID_REFRESH", message: "Refresh inválido" });
      }
    },
  );

  app.get(
    "/auth/me",
    {
      preHandler: requireOwner,
    },
    async (request) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const [user, tenant] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: auth.userId } }),
        prisma.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } }),
      ]);
      return {
        user: { id: user.id, email: user.email, role: user.role },
        tenant: {
          id: tenant.id,
          name: tenant.name,
          hasHoldedKey: tenant.holdedApiKeyCiphertext != null,
          initialSyncStatus: tenant.initialSyncStatus,
        },
      };
    },
  );
}
