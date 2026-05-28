import { randomInt } from "node:crypto";

import type { FastifyInstance } from "fastify";

import { getPrisma } from "../context.js";
import { requireOwnerOrManager } from "../auth/middleware.js";
import { evaluateDeviceAlert } from "./alerts.js";
import {
  generateDeviceToken,
  hashDeviceToken,
  requireDeviceToken,
} from "./auth.js";

const PAIRING_CODE_TTL_MINUTES = 60;
const PAIRING_CODE_MAX_ATTEMPTS = 8;

function newSixDigitCode(): string {
  // randomInt evita bias.  Six dígitos con leading zeros conservados.
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export async function registerDeviceRoutes(app: FastifyInstance): Promise<void> {
  // Genera código de emparejamiento (owner o manager — B6 §1 cierra el
  // TODO heredado de B3/B4: el MANAGER puede generar códigos desde la
  // pantalla de Dispositivos).
  app.post(
    "/admin/registers/:registerId/pairing-codes",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["registerId"],
          properties: { registerId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: { name: { type: "string", maxLength: 80 } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { registerId } = request.params as { registerId: string };
      const prisma = getPrisma();

      const register = await prisma.register.findFirst({
        where: { id: registerId, store: { tenantId: auth.tenantId } },
        select: { id: true },
      });
      if (!register) {
        return reply
          .code(404)
          .send({ error: "REGISTER_NOT_FOUND", message: "Caja no encontrada" });
      }

      // Generar código único por (tenant, code). Si colisiona,
      // reintenta hasta MAX_ATTEMPTS — el espacio es 1M y la ventana
      // de validez 1h, así que en la práctica nunca colisiona, pero
      // defensa cinturón.
      const expiresAt = new Date(
        Date.now() + PAIRING_CODE_TTL_MINUTES * 60 * 1000,
      );
      for (let attempt = 0; attempt < PAIRING_CODE_MAX_ATTEMPTS; attempt++) {
        const code = newSixDigitCode();
        const existing = await prisma.pairingCode.findUnique({
          where: { tenantId_code: { tenantId: auth.tenantId, code } },
          select: { consumedAt: true, expiresAt: true },
        });
        // Considerar colisión sólo si el anterior sigue vivo y no
        // consumido. Los caducados pueden reutilizarse (el unique
        // compuesto permite re-INSERT tras DELETE, no upsert).
        const alive =
          existing &&
          existing.consumedAt == null &&
          existing.expiresAt > new Date();
        if (alive) continue;
        if (existing) {
          // Caducado o consumido — lo borramos para permitir el
          // re-INSERT con el mismo `code`.
          await prisma.pairingCode.delete({
            where: { tenantId_code: { tenantId: auth.tenantId, code } },
          });
        }
        const created = await prisma.pairingCode.create({
          data: {
            tenantId: auth.tenantId,
            registerId,
            code,
            createdByUserId: auth.userId,
            expiresAt,
          },
          select: { code: true, expiresAt: true },
        });
        return reply.code(201).send({
          code: created.code,
          expiresAt: created.expiresAt.toISOString(),
        });
      }
      return reply.code(503).send({
        error: "CODE_COLLISION",
        message: "No se pudo generar un código único, reintenta",
      });
    },
  );

  // Lista de dispositivos del tenant + sus pairing codes activos.
  app.get(
    "/admin/devices",
    { preHandler: requireOwnerOrManager },
    async (request) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const devices = await prisma.device.findMany({
        where: { tenantId: auth.tenantId },
        select: {
          id: true,
          name: true,
          pairedAt: true,
          lastSeenAt: true,
          userAgent: true,
          revokedAt: true,
          lastKnownIpCountry: true,
          register: {
            select: { id: true, name: true, store: { select: { name: true } } },
          },
        },
        orderBy: [{ revokedAt: "asc" }, { lastSeenAt: "desc" }],
      });
      return {
        devices: devices.map((d) => ({
          id: d.id,
          name: d.name,
          pairedAt: d.pairedAt.toISOString(),
          lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
          userAgent: d.userAgent,
          revokedAt: d.revokedAt?.toISOString() ?? null,
          lastKnownIpCountry: d.lastKnownIpCountry,
          registerId: d.register.id,
          registerName: d.register.name,
          storeName: d.register.store.name,
        })),
      };
    },
  );

  // Pairing codes activos (no consumidos, no caducados).
  app.get(
    "/admin/pairing-codes",
    { preHandler: requireOwnerOrManager },
    async (request) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const now = new Date();
      const codes = await prisma.pairingCode.findMany({
        where: {
          tenantId: auth.tenantId,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        select: {
          id: true,
          code: true,
          expiresAt: true,
          register: { select: { id: true, name: true } },
        },
        orderBy: { expiresAt: "asc" },
      });
      return {
        codes: codes.map((c) => ({
          id: c.id,
          code: c.code,
          expiresAt: c.expiresAt.toISOString(),
          registerId: c.register.id,
          registerName: c.register.name,
        })),
      };
    },
  );

  // POST /devices/pair — sin auth, body con código.
  app.post(
    "/devices/pair",
    {
      schema: {
        body: {
          type: "object",
          required: ["code"],
          additionalProperties: false,
          properties: {
            code: { type: "string", pattern: "^[0-9]{6}$" },
            deviceName: { type: "string", maxLength: 80 },
            userAgent: { type: "string", maxLength: 512 },
          },
        },
      },
    },
    async (request, reply) => {
      const { code, deviceName, userAgent } = request.body as {
        code: string;
        deviceName?: string;
        userAgent?: string;
      };
      const prisma = getPrisma();
      const now = new Date();

      // Buscar código en cualquier tenant — el unique es por
      // (tenantId, code), así que pueden coexistir el mismo "123456"
      // en dos tenants. Aceptamos sólo el que esté vivo y no
      // consumido.
      const candidates = await prisma.pairingCode.findMany({
        where: { code, consumedAt: null, expiresAt: { gt: now } },
        select: {
          id: true,
          tenantId: true,
          registerId: true,
          register: {
            select: {
              id: true,
              name: true,
              store: { select: { name: true } },
            },
          },
        },
      });
      if (candidates.length === 0) {
        return reply.code(404).send({
          error: "INVALID_PAIRING_CODE",
          message: "Código inválido o caducado",
        });
      }
      // Si por accidente hubiera más de uno (colisión RNG entre
      // tenants), tomamos el primero. Espacio 1M × validez 1h hace
      // que sea operacionalmente imposible.
      const target = candidates[0]!;

      // v1.3-hotfix11 · pairing code de un solo uso.
      //
      // El SELECT anterior es informativo (para devolver register/store en
      // la respuesta). El claim atómico se hace AQUÍ con updateMany — si
      // dos requests llegan con el mismo code en paralelo, sólo la
      // primera obtiene count===1. La segunda devuelve count===0 →
      // tratamos como código ya consumido (404). Bug detectado
      // 2026-05-27: la transacción Prisma por defecto (READ COMMITTED)
      // permitía que ambas SELECTs viesen consumedAt=null antes del commit
      // de la primera, creando 2 devices con el mismo code.
      const claimed = await prisma.pairingCode.updateMany({
        where: {
          id: target.id,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (claimed.count === 0) {
        return reply.code(404).send({
          error: "INVALID_PAIRING_CODE",
          message: "Código inválido o caducado",
        });
      }

      const { plain, hash } = generateDeviceToken();
      const device = await prisma.$transaction(async (tx) => {
        const d = await tx.device.create({
          data: {
            tenantId: target.tenantId,
            registerId: target.registerId,
            name: deviceName ?? null,
            deviceTokenHash: hash,
            userAgent: userAgent ?? null,
          },
          select: { id: true },
        });
        // Enlazar el code al device recién creado (consumedAt ya está
        // marcado por el updateMany de arriba).
        await tx.pairingCode.update({
          where: { id: target.id },
          data: { consumedByDeviceId: d.id },
        });
        return d;
      });

      // Disparar alerta async — no bloquea la respuesta.
      void evaluateDeviceAlert({
        deviceId: device.id,
        ip: request.ip,
        now,
      }).catch((err) => request.log.error(err, "evaluateDeviceAlert falló"));

      return reply.code(201).send({
        deviceToken: plain,
        deviceId: device.id,
        tenantId: target.tenantId,
        registerId: target.registerId,
        registerName: target.register.name,
        storeName: target.register.store.name,
      });
    },
  );

  // GET /devices/me — la PWA lo llama al arrancar.
  app.get(
    "/devices/me",
    { preHandler: requireDeviceToken },
    async (request) => {
      const ctx = request.device!;
      const prisma = getPrisma();
      const now = new Date();
      const device = await prisma.device.findUniqueOrThrow({
        where: { id: ctx.deviceId },
        select: {
          id: true,
          name: true,
          pairedAt: true,
          register: {
            select: {
              id: true,
              name: true,
              store: { select: { id: true, name: true } },
              numSerieHolded: true,
            },
          },
          tenant: {
            select: {
              id: true,
              name: true,
              cashierAutoLogoutMinutes: true,
            },
          },
        },
      });
      await prisma.device.update({
        where: { id: ctx.deviceId },
        data: { lastSeenAt: now },
      });
      return {
        device: {
          id: device.id,
          name: device.name,
          pairedAt: device.pairedAt.toISOString(),
        },
        register: {
          id: device.register.id,
          name: device.register.name,
          numSerieHolded: device.register.numSerieHolded,
        },
        store: {
          id: device.register.store.id,
          name: device.register.store.name,
        },
        tenant: {
          id: device.tenant.id,
          name: device.tenant.name,
          cashierAutoLogoutMinutes: device.tenant.cashierAutoLogoutMinutes,
        },
      };
    },
  );

  // POST /admin/devices/:deviceId/revoke
  app.post(
    "/admin/devices/:deviceId/revoke",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["deviceId"],
          properties: { deviceId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { deviceId } = request.params as { deviceId: string };
      const prisma = getPrisma();
      const device = await prisma.device.findFirst({
        where: { id: deviceId, tenantId: auth.tenantId },
        select: { id: true, revokedAt: true },
      });
      if (!device) {
        return reply
          .code(404)
          .send({ error: "DEVICE_NOT_FOUND", message: "Dispositivo no encontrado" });
      }
      if (device.revokedAt) {
        return reply.code(200).send({ ok: true, alreadyRevoked: true });
      }
      await prisma.device.update({
        where: { id: deviceId },
        data: { revokedAt: new Date() },
      });
      return reply.code(200).send({ ok: true, alreadyRevoked: false });
    },
  );
}

// Re-export para que cashier-login pueda hashear tokens si lo necesita
// (no debería — sólo lo usa /devices/me, pero se documenta export).
export { hashDeviceToken };
