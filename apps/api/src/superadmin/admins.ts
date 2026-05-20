// B-Multi-Vertical SB4 · gestión de super-admins (multi super-admin).
//
// Endpoints en este módulo:
//   - GET    /super-admin/admins         · lista activos (deletedAt IS NULL)
//   - POST   /super-admin/admins         · invita uno nuevo con tempPassword
//   - DELETE /super-admin/admins/:id     · soft-delete (no autoeliminarse)
//
// El usuario invitado recibe email con la temp password (si SMTP cae,
// el ConsoleEmailSender la imprime y el admin actual la entrega por
// canal seguro). `mustChangePassword=true` queda persistido pero la
// enforcement de cambio inicial en login se deja para un sub-bloque
// posterior — el invitado puede cambiarla con el endpoint existente
// `/super-admin/auth/change-password`.

import type { FastifyInstance } from "fastify";

import { Prisma } from "@mipiacetpv/db";
import { generateTemporaryPassword } from "@mipiacetpv/util-validation";

import { hashPassword } from "../auth/passwords.js";
import { getEmailSender } from "../email/sender.js";
import { getPrisma } from "../context.js";
import { loadEnv } from "../env.js";

import { extractRequestSignals, writeAudit } from "./audit.js";
import { requireRootSuperAdmin, requireSuperAdmin } from "./middleware.js";

const emailFormat = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";

interface AdminRow {
  id: string;
  email: string;
  name: string | null;
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

async function sendInviteEmail(params: {
  email: string;
  name: string;
  tempPassword: string;
}): Promise<void> {
  const env = loadEnv();
  const loginUrl = `${env.PUBLIC_ADMIN_URL}/superadmin/login`;
  const subject = "Mipiacetpv · Acceso super-admin";
  const text = [
    `Hola ${params.name},`,
    ``,
    `Te han invitado como super-admin de Mipiacetpv.`,
    ``,
    `Datos de acceso:`,
    `  · URL: ${loginUrl}`,
    `  · Email: ${params.email}`,
    `  · Contraseña temporal: ${params.tempPassword}`,
    ``,
    `Es una contraseña de un solo uso — cámbiala en cuanto entres.`,
    ``,
    `— El equipo de Mipiacetpv`,
  ].join("\n");

  const escape = (s: string): string =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const html = `<!DOCTYPE html>
<html lang="es">
<body style="font-family: -apple-system, system-ui, sans-serif; color: #1f2937; max-width: 560px; margin: 0 auto; padding: 24px;">
  <p>Hola ${escape(params.name)},</p>
  <p>Te han invitado como <strong>super-admin</strong> de Mipiacetpv.</p>
  <p><strong>Datos de acceso:</strong></p>
  <ul>
    <li>URL: <a href="${escape(loginUrl)}">${escape(loginUrl)}</a></li>
    <li>Email: <code>${escape(params.email)}</code></li>
    <li>Contraseña temporal: <code>${escape(params.tempPassword)}</code></li>
  </ul>
  <p>Es una contraseña de un solo uso — cámbiala en cuanto entres.</p>
  <p>— El equipo de Mipiacetpv</p>
</body>
</html>`;

  await getEmailSender().send({
    to: params.email,
    subject,
    text,
    html,
  });
}

function serialize(row: {
  id: string;
  email: string;
  name: string | null;
  totpEnabledAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}): AdminRow {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    twoFactorEnabled: row.totpEnabledAt != null,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function registerSuperAdminAdminsRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/super-admin/admins",
    { preHandler: requireSuperAdmin },
    async (request) => {
      const ctx = request.superAdmin!;
      const prisma = getPrisma();
      // Lote 3 v1.1 Thalia: el no-root sólo ve su propia ficha.
      // Filtramos en BD (no en memoria) para no exponer ni siquiera el
      // count del resto de super-admins.
      const rows = await prisma.superAdminUser.findMany({
        where: ctx.isRoot
          ? { deletedAt: null }
          : { deletedAt: null, id: ctx.superAdminId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          email: true,
          name: true,
          totpEnabledAt: true,
          lastLoginAt: true,
          createdAt: true,
        },
      });
      return { items: rows.map(serialize) };
    },
  );

  app.post(
    "/super-admin/admins",
    {
      // Lote 3 v1.1 Thalia: invitar nuevos super-admins requiere root.
      preHandler: requireRootSuperAdmin,
      schema: {
        body: {
          type: "object",
          required: ["email", "name"],
          additionalProperties: false,
          properties: {
            email: { type: "string", pattern: emailFormat, maxLength: 320 },
            name: { type: "string", minLength: 1, maxLength: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      const ctx = request.superAdmin!;
      const body = request.body as { email: string; name: string };
      const lowerEmail = body.email.toLowerCase();
      const trimmedName = body.name.trim();
      if (trimmedName.length === 0) {
        return reply.code(400).send({
          error: "INVALID_NAME",
          message: "El nombre no puede estar vacío.",
        });
      }
      const prisma = getPrisma();
      // 409 sólo si el row existe ACTIVO (no soft-deleted).
      const existingActive = await prisma.superAdminUser.findFirst({
        where: { email: lowerEmail, deletedAt: null },
        select: { id: true },
      });
      if (existingActive) {
        return reply.code(409).send({
          error: "SUPER_ADMIN_EMAIL_TAKEN",
          message: "Ya existe un super-admin con ese email.",
        });
      }
      // Bug-RehidratarSuperAdmin: si el email pertenece a un row
      // soft-deleted (deletedAt no nulo), el UNIQUE constraint de la
      // columna `email` impediría crear uno nuevo con prisma.create.
      // El bloque SB4 dejó este caso como diferido; lo resolvemos
      // rehidratando: deletedAt=null, nueva tempPassword, name
      // actualizado, mustChangePassword=true, tokenVersion+1 (para
      // invalidar cualquier refresh token previo al borrado). Audit:
      // queda el "delete_super_admin" previo + "create_super_admin"
      // nuevo sobre el mismo id — historia trazable.
      const existingDeleted = await prisma.superAdminUser.findUnique({
        where: { email: lowerEmail },
        select: { id: true, deletedAt: true },
      });
      const tempPassword = generateTemporaryPassword();
      const passwordHash = await hashPassword(tempPassword);
      const created =
        existingDeleted && existingDeleted.deletedAt != null
          ? await prisma.superAdminUser.update({
              where: { id: existingDeleted.id },
              data: {
                deletedAt: null,
                name: trimmedName,
                passwordHash,
                mustChangePassword: true,
                tokenVersion: { increment: 1 },
                totpEnabledAt: null,
                totpSecret: null,
                recoveryCodes: Prisma.JsonNull,
                lastLoginAt: null,
              },
              select: {
                id: true,
                email: true,
                name: true,
                totpEnabledAt: true,
                lastLoginAt: true,
                createdAt: true,
              },
            })
          : await prisma.superAdminUser.create({
              data: {
                email: lowerEmail,
                name: trimmedName,
                passwordHash,
                mustChangePassword: true,
              },
              select: {
                id: true,
                email: true,
                name: true,
                totpEnabledAt: true,
                lastLoginAt: true,
                createdAt: true,
              },
            });
      await writeAudit({
        prisma,
        superAdminId: ctx.superAdminId,
        action: "create_super_admin",
        tenantId: null,
        metadata: {
          ...extractRequestSignals(request),
          targetEmail: lowerEmail,
          targetName: trimmedName,
          targetSuperAdminId: created.id,
        },
      });
      // Enviar email. Si SMTP no está configurado, el ConsoleEmailSender
      // imprime la temp password al log — el admin actual la copia y la
      // entrega manualmente. No bloqueamos el POST por un fallo de
      // envío: el response devuelve la temp password en plano.
      try {
        await sendInviteEmail({
          email: lowerEmail,
          name: trimmedName,
          tempPassword,
        });
      } catch (err) {
        app.log.warn(
          { err, targetEmail: lowerEmail },
          "super-admin invite email failed; password sólo en response",
        );
      }
      return reply.code(201).send({
        admin: serialize(created),
        tempPassword,
      });
    },
  );

  app.delete(
    "/super-admin/admins/:id",
    {
      // Lote 3 v1.1 Thalia: eliminar super-admins requiere root.
      preHandler: requireRootSuperAdmin,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const ctx = request.superAdmin!;
      const params = request.params as { id: string };
      if (params.id === ctx.superAdminId) {
        return reply.code(400).send({
          error: "CANNOT_DELETE_SELF",
          message: "No puedes eliminarte a ti mismo.",
        });
      }
      const prisma = getPrisma();
      const target = await prisma.superAdminUser.findUnique({
        where: { id: params.id },
        select: { id: true, email: true, deletedAt: true },
      });
      if (!target || target.deletedAt != null) {
        return reply.code(404).send({
          error: "SUPER_ADMIN_NOT_FOUND",
          message: "Super-admin no encontrado.",
        });
      }
      await prisma.superAdminUser.update({
        where: { id: target.id },
        data: {
          deletedAt: new Date(),
          // Bumpeamos tokenVersion para invalidar refresh tokens emitidos
          // antes del soft-delete; sin esto, el invitado podría seguir
          // refrescando hasta que su access token caduque.
          tokenVersion: { increment: 1 },
        },
      });
      await writeAudit({
        prisma,
        superAdminId: ctx.superAdminId,
        action: "delete_super_admin",
        tenantId: null,
        metadata: {
          ...extractRequestSignals(request),
          targetEmail: target.email,
          targetSuperAdminId: target.id,
        },
      });
      return reply.code(200).send({ ok: true });
    },
  );
}
