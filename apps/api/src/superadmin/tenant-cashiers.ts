// Bloque soporte-cajeros-superadmin · GET /super-admin/tenants/:id/cashiers
//
// La llamada de soporte más frecuente de un TPV es "no puedo entrar".
// Hasta ahora la única forma de ver qué cajeros tenía dados de alta un
// cliente era impersonar al OWNER — una sesión de escritura auditada de
// 30 min para una pregunta de lectura. Este endpoint contesta la
// pregunta directamente.
//
// ES DE LECTURA, Y SÓLO DE LECTURA:
//   - El PIN no sale. Ni entero, ni parcial, ni su hash. `pinHash` se
//     selecciona únicamente para derivar el booleano `canOpenTpv` y se
//     descarta en el mismo map; el objeto de respuesta se construye
//     campo a campo (nunca por spread de la fila de Prisma) para que
//     añadir una columna sensible al `select` no la filtre sola.
//   - No se resetea nada. Si el cajero perdió el PIN lo cambia el OWNER
//     desde su sesión, que es de quien es esa decisión.
//
// DOS PREMISAS DEL BLOQUE QUE NO SE CUMPLÍAN (ver done.md):
//   1. No existe una tabla `Cashier`. Un cajero es un `User` del tenant
//      con rol OWNER/MANAGER/CASHIER y `pinHash != null`. Tampoco está
//      asociado a una tienda o caja concreta: el PIN vale para
//      cualquier caja del tenant. Por eso la lista es del tenant y no
//      "por tienda y caja".
//   2. No había ningún rate-limit sobre los endpoints de lectura del
//      super-admin (el único que existía es el de login, 5/15min). Se
//      añade aquí uno propio sobre el helper `throttle` que ya existe.

import type { FastifyInstance } from "fastify";

import { getPrisma } from "../context.js";
import { throttle } from "../auth/rate-limit.js";

import { writeAudit, extractRequestSignals } from "./audit.js";
import { requireSuperAdmin } from "./middleware.js";
import { superAdminCashierReadThrottleKey } from "./rate-limit.js";

// 60 lecturas cada 5 min por super-admin. Un humano atendiendo el
// teléfono no se acerca; un script que quiera barrer la base de
// cajeros de todos los tenants sí. La ventana es por super-admin (no
// por tenant) precisamente para que barrer muchos tenants sea lo que
// tope.
const READ_LIMIT = 60;
const READ_WINDOW_SECONDS = 5 * 60;

// Sentinel que `DELETE /cashiers/:id` escribe en el email al revocar
// (`revoked-<ts>-<id>@revoked.local`). Es la marca de "este cajero ya
// no existe" en el modelo actual — no hay soft-delete propio para
// cajeros reales.
const REVOKED_EMAIL_SUFFIX = "@revoked.local";

// Estado de acceso al TPV. Es la columna que contesta la llamada:
//   ACTIVE  → puede entrar; si dice que no puede, el problema es el PIN
//             que teclea o la caja, no el alta.
//   NO_PIN  → existe pero no tiene PIN. No puede entrar. El OWNER se lo
//             pone desde su sesión.
//   REVOKED → el OWNER lo dio de baja (o es el cajero técnico purgado
//             al activar la cuenta). No puede entrar, y no debe.
type CashierAccessStatus = "ACTIVE" | "NO_PIN" | "REVOKED";

// Origen del `lastLoginAt`. El campo lo escriben DOS logins distintos:
// `POST /shift/cashier-login` (TPV, con PIN) y `POST /auth/login`
// (admin web, con password). Un CASHIER no puede entrar al admin (el
// login le devuelve 403 CASHIER_NOT_ALLOWED_IN_ADMIN), así que su
// fecha es inequívocamente del TPV. Un OWNER o un MANAGER sí puede
// entrar por los dos sitios, y el modelo no distingue cuál fue.
// Decirlo es más útil que insinuar una precisión que no tenemos.
type LastLoginSource = "TPV" | "TPV_O_ADMIN";

interface CashierRow {
  id: string;
  alias: string | null;
  email: string;
  role: "OWNER" | "MANAGER" | "CASHIER";
  status: CashierAccessStatus;
  canOpenTpv: boolean;
  isTestCashier: boolean;
  lastLoginAt: string | null;
  lastLoginSource: LastLoginSource;
  createdAt: string;
}

// Orden de la tabla: primero quien puede entrar (que es por quien
// pregunta el cliente), luego quien no, y al final los revocados.
const STATUS_ORDER: Record<CashierAccessStatus, number> = {
  ACTIVE: 0,
  NO_PIN: 1,
  REVOKED: 2,
};

export async function registerSuperAdminTenantCashiersRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get(
    "/super-admin/tenants/:id/cashiers",
    {
      preHandler: requireSuperAdmin,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const superAdminId = request.superAdmin!.superAdminId;

      const rl = await throttle(
        superAdminCashierReadThrottleKey(superAdminId),
        READ_LIMIT,
        READ_WINDOW_SECONDS,
      );
      if (rl.exceeded) {
        return reply.code(429).send({
          error: "RATE_LIMITED",
          message: `Demasiadas consultas de cajeros. Vuelve a probar en ${Math.ceil(
            rl.retryAfterSeconds / 60,
          )} min.`,
          retryAfterSeconds: rl.retryAfterSeconds,
        });
      }

      const prisma = getPrisma();
      const tenant = await prisma.tenant.findUnique({
        where: { id },
        select: { id: true, name: true },
      });
      if (!tenant) {
        return reply.code(404).send({
          error: "TENANT_NOT_FOUND",
          message: "Tenant no existe",
        });
      }

      const rows = await prisma.user.findMany({
        where: {
          tenantId: tenant.id,
          // Quien puede abrir turno en una caja del tenant. El OWNER
          // entra en la lista porque `activate` le pone pinHash y usa
          // el TPV como uno más.
          role: { in: ["OWNER", "MANAGER", "CASHIER"] },
        },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          alias: true,
          email: true,
          role: true,
          // Sólo para derivar `canOpenTpv`. NO se devuelve — ver el
          // map de abajo y el test "el PIN no viaja en la respuesta".
          pinHash: true,
          lastLoginAt: true,
          createdAt: true,
          isTestCashier: true,
          deletedAt: true,
        },
      });

      const cashiers: CashierRow[] = rows
        .map((u): CashierRow => {
          const revoked =
            u.deletedAt != null || u.email.endsWith(REVOKED_EMAIL_SUFFIX);
          const hasPin = u.pinHash != null;
          const status: CashierAccessStatus = revoked
            ? "REVOKED"
            : hasPin
              ? "ACTIVE"
              : "NO_PIN";
          return {
            id: u.id,
            alias: u.alias,
            email: u.email,
            role: u.role as "OWNER" | "MANAGER" | "CASHIER",
            status,
            canOpenTpv: hasPin && !revoked,
            isTestCashier: u.isTestCashier,
            lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
            lastLoginSource: u.role === "CASHIER" ? "TPV" : "TPV_O_ADMIN",
            createdAt: u.createdAt.toISOString(),
          };
        })
        .sort((a, b) => {
          const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
          if (byStatus !== 0) return byStatus;
          return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
        });

      // Ver los cajeros de un cliente ES un acceso a datos de un
      // cliente: se audita como cualquier otra acción del super-admin.
      // Va después de la query y antes de responder — si el audit
      // falla, la lectura no se entrega.
      await writeAudit({
        prisma,
        superAdminId,
        action: "view_tenant_cashiers",
        tenantId: tenant.id,
        metadata: {
          ...extractRequestSignals(request),
          cashiersReturned: cashiers.length,
        },
      });

      return reply.code(200).send({
        tenantId: tenant.id,
        tenantName: tenant.name,
        cashiers,
      });
    },
  );
}
