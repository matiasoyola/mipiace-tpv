// v1.4-Impresoras-Fase-1 Lote 1 · CRUD de impresoras térmicas.
//
// El implantador da de alta una impresora por register desde el panel
// admin (/admin/printers). El backend la guarda; el TPV la consume en
// runtime (Lote 2 + Lote 3). Endpoints:
//
//   GET    /admin/printer-configs?registerId=...       → lista (sólo del tenant).
//   POST   /admin/printer-configs                      → crea.
//   PATCH  /admin/printer-configs/:id                  → edita.
//   DELETE /admin/printer-configs/:id                  → soft delete (active=false).
//   POST   /admin/printer-configs/:id/test             → manda un print de prueba.
//
// Auth: requireOwnerOrManager (no es sólo super-admin). El MANAGER
// gestiona la operativa del local — cambiar IP de la impresora de
// cocina es operativa, no infraestructura.
//
// Aislamiento por tenant: el register en cuestión tiene que pertenecer
// al tenant del JWT. Lo validamos en cada handler.

import { KitchenSection, PrinterMode } from "@mipiacetpv/db";
import { buildTestPrint, sendOverTcp } from "@mipiacetpv/escpos-builder";
import type { FastifyInstance } from "fastify";

import { requireOwnerOrManager } from "../auth/middleware.js";
import { getPrisma } from "../context.js";

const SECTIONS = ["BARRA", "COCINA", "SALON"] as const;
const MODES = ["USB", "WIFI"] as const;

// IPv4 strict-ish: 0–255 por octeto. No aceptamos IPv6 — los pilotos
// piden a la impresora una IP fija manual al router, siempre IPv4.
const IPV4_RE = /^(25[0-5]|2[0-4]\d|[01]?\d?\d)(\.(25[0-5]|2[0-4]\d|[01]?\d?\d)){3}$/;

export async function registerAdminPrinterConfigsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/admin/printer-configs",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        querystring: {
          type: "object",
          properties: { registerId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { registerId } = request.query as { registerId?: string };
      const prisma = getPrisma();

      if (registerId) {
        const ok = await assertRegisterBelongsToTenant(
          prisma,
          registerId,
          auth.tenantId,
        );
        if (!ok) {
          return reply.code(404).send({
            error: "REGISTER_NOT_FOUND",
            message: "Caja no encontrada.",
          });
        }
      }

      const items = await prisma.printerConfig.findMany({
        where: {
          register: { store: { tenantId: auth.tenantId } },
          ...(registerId ? { registerId } : {}),
        },
        orderBy: [{ section: "asc" }, { name: "asc" }],
        select: {
          id: true,
          registerId: true,
          name: true,
          mode: true,
          ipAddress: true,
          port: true,
          timeoutMs: true,
          section: true,
          active: true,
          lastPrintOkAt: true,
          lastErrorAt: true,
          lastErrorMsg: true,
          createdAt: true,
        },
      });
      return { items };
    },
  );

  app.post(
    "/admin/printer-configs",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        body: {
          type: "object",
          required: ["registerId", "name", "mode"],
          additionalProperties: false,
          properties: {
            registerId: { type: "string", format: "uuid" },
            name: { type: "string", minLength: 1, maxLength: 80 },
            mode: { type: "string", enum: MODES as unknown as string[] },
            ipAddress: { type: "string" },
            port: { type: "integer", minimum: 1, maximum: 65535 },
            timeoutMs: { type: "integer", minimum: 500, maximum: 30000 },
            section: {
              type: ["string", "null"],
              enum: [...SECTIONS, null] as unknown as string[],
            },
            active: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const body = request.body as CreateBody;
      const prisma = getPrisma();

      const ok = await assertRegisterBelongsToTenant(
        prisma,
        body.registerId,
        auth.tenantId,
      );
      if (!ok) {
        return reply.code(404).send({
          error: "REGISTER_NOT_FOUND",
          message: "Caja no encontrada.",
        });
      }

      const validation = validateNetworkFields(body.mode, body.ipAddress, body.port);
      if (validation) {
        return reply.code(400).send(validation);
      }

      const row = await prisma.printerConfig.create({
        data: {
          registerId: body.registerId,
          name: body.name.trim(),
          mode: body.mode as PrinterMode,
          ipAddress: body.mode === "WIFI" ? body.ipAddress! : null,
          port: body.mode === "WIFI" ? (body.port ?? 9100) : null,
          timeoutMs: body.timeoutMs ?? 5000,
          section: (body.section ?? null) as KitchenSection | null,
          active: body.active ?? true,
        },
        select: PRINTER_SELECT,
      });
      return reply.code(201).send({ printerConfig: row });
    },
  );

  app.patch(
    "/admin/printer-configs/:id",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 80 },
            mode: { type: "string", enum: MODES as unknown as string[] },
            ipAddress: { type: "string" },
            port: { type: "integer", minimum: 1, maximum: 65535 },
            timeoutMs: { type: "integer", minimum: 500, maximum: 30000 },
            section: {
              type: ["string", "null"],
              enum: [...SECTIONS, null] as unknown as string[],
            },
            active: { type: "boolean" },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const body = request.body as PatchBody;
      const prisma = getPrisma();

      const existing = await prisma.printerConfig.findFirst({
        where: { id, register: { store: { tenantId: auth.tenantId } } },
        select: { id: true, mode: true, ipAddress: true, port: true },
      });
      if (!existing) {
        return reply.code(404).send({
          error: "PRINTER_NOT_FOUND",
          message: "Impresora no encontrada.",
        });
      }

      const effectiveMode = (body.mode ?? existing.mode) as PrinterMode;
      const effectiveIp =
        body.ipAddress !== undefined ? body.ipAddress : existing.ipAddress;
      const effectivePort = body.port !== undefined ? body.port : existing.port;
      const validation = validateNetworkFields(
        effectiveMode,
        effectiveIp,
        effectivePort,
      );
      if (validation) {
        return reply.code(400).send(validation);
      }

      const row = await prisma.printerConfig.update({
        where: { id },
        data: {
          name: body.name?.trim(),
          mode: body.mode as PrinterMode | undefined,
          ipAddress:
            effectiveMode === "WIFI" ? (effectiveIp ?? null) : null,
          port: effectiveMode === "WIFI" ? (effectivePort ?? 9100) : null,
          timeoutMs: body.timeoutMs,
          section:
            body.section === undefined
              ? undefined
              : ((body.section ?? null) as KitchenSection | null),
          active: body.active,
        },
        select: PRINTER_SELECT,
      });
      return { printerConfig: row };
    },
  );

  app.delete(
    "/admin/printer-configs/:id",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();
      const r = await prisma.printerConfig.updateMany({
        where: { id, register: { store: { tenantId: auth.tenantId } } },
        data: { active: false },
      });
      if (r.count === 0) {
        return reply.code(404).send({
          error: "PRINTER_NOT_FOUND",
          message: "Impresora no encontrada.",
        });
      }
      return { ok: true };
    },
  );

  app.post(
    "/admin/printer-configs/:id/test",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();
      const cfg = await prisma.printerConfig.findFirst({
        where: { id, register: { store: { tenantId: auth.tenantId } } },
        select: {
          id: true,
          mode: true,
          ipAddress: true,
          port: true,
          timeoutMs: true,
          active: true,
        },
      });
      if (!cfg) {
        return reply.code(404).send({
          error: "PRINTER_NOT_FOUND",
          message: "Impresora no encontrada.",
        });
      }
      if (!cfg.active) {
        return reply.code(409).send({
          error: "PRINTER_INACTIVE",
          message: "La impresora está desactivada.",
        });
      }

      const bytes = buildTestPrint();
      if (cfg.mode === "USB") {
        // El backend no puede tocar el USB del tablet: devolvemos el
        // binary para que el admin lo descargue manualmente o, más
        // común, redirija al TPV. En Fase 1 el OWNER/MANAGER prueba
        // desde el TPV abriendo la página de cobro y usando la opción
        // "imprimir test". Aquí devolvemos OK + binary base64 para que
        // un test runner pueda comprobar la construcción del binary.
        await prisma.printerConfig.update({
          where: { id: cfg.id },
          data: {
            lastPrintOkAt: new Date(),
            lastErrorAt: null,
            lastErrorMsg: null,
          },
        });
        return reply.code(200).send({
          ok: true,
          mode: "USB",
          binaryBase64: Buffer.from(bytes).toString("base64"),
          note: "Para impresoras USB el binario lo manda el TPV con WebUSB. Esta llamada sólo confirma que el ESC/POS se genera bien.",
        });
      }

      // WIFI: abrimos TCP al ip:port, mandamos el binario y cerramos.
      try {
        await sendOverTcp({
          host: cfg.ipAddress!,
          port: cfg.port ?? 9100,
          timeoutMs: cfg.timeoutMs,
          payload: bytes,
        });
        await prisma.printerConfig.update({
          where: { id: cfg.id },
          data: {
            lastPrintOkAt: new Date(),
            lastErrorAt: null,
            lastErrorMsg: null,
          },
        });
        request.log.info(
          {
            tenantId: auth.tenantId,
            printerConfigId: cfg.id,
            ok: true,
          },
          "printer test OK",
        );
        return { ok: true, mode: "WIFI", printedAt: new Date().toISOString() };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Error desconocido";
        await prisma.printerConfig.update({
          where: { id: cfg.id },
          data: {
            lastErrorAt: new Date(),
            lastErrorMsg: message.slice(0, 500),
          },
        });
        request.log.warn(
          {
            tenantId: auth.tenantId,
            printerConfigId: cfg.id,
            ok: false,
            error: message,
          },
          "printer test FAILED",
        );
        return reply.code(502).send({
          ok: false,
          mode: "WIFI",
          error: "PRINT_FAILED",
          message,
        });
      }
    },
  );
}

interface CreateBody {
  registerId: string;
  name: string;
  mode: "USB" | "WIFI";
  ipAddress?: string;
  port?: number;
  timeoutMs?: number;
  section?: (typeof SECTIONS)[number] | null;
  active?: boolean;
}

interface PatchBody {
  name?: string;
  mode?: "USB" | "WIFI";
  ipAddress?: string;
  port?: number;
  timeoutMs?: number;
  section?: (typeof SECTIONS)[number] | null;
  active?: boolean;
}

const PRINTER_SELECT = {
  id: true,
  registerId: true,
  name: true,
  mode: true,
  ipAddress: true,
  port: true,
  timeoutMs: true,
  section: true,
  active: true,
  lastPrintOkAt: true,
  lastErrorAt: true,
  lastErrorMsg: true,
  createdAt: true,
} as const;

function validateNetworkFields(
  mode: PrinterMode | "USB" | "WIFI",
  ip: string | null | undefined,
  port: number | null | undefined,
): { error: string; message: string } | null {
  if (mode !== "WIFI") return null;
  if (!ip || !IPV4_RE.test(ip)) {
    return {
      error: "INVALID_IP",
      message: "Falta una IP IPv4 válida para impresora WIFI.",
    };
  }
  if (port != null && (port < 1 || port > 65535)) {
    return { error: "INVALID_PORT", message: "Puerto fuera de rango." };
  }
  return null;
}

async function assertRegisterBelongsToTenant(
  prisma: ReturnType<typeof getPrisma>,
  registerId: string,
  tenantId: string,
): Promise<boolean> {
  const r = await prisma.register.findFirst({
    where: { id: registerId, store: { tenantId } },
    select: { id: true },
  });
  return r != null;
}

