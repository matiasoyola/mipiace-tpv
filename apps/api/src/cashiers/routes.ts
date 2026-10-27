import type { FastifyInstance } from "fastify";
import type { Prisma, UserRole } from "@mipiacetpv/db";

import { getPrisma } from "../context.js";
import { requireOwner, requireOwnerOrManager } from "../auth/middleware.js";
import { hashPassword } from "../auth/passwords.js";
import { PIN_FORMAT, errorPinTrivial, motivoPinTrivial } from "../auth/pin.js";
import { escribirPinYRegistrarlo } from "../auth/pin-registro.js";
import { ensureCajaEnabled } from "../lib/caja-gate.js";
import { escribirElNombre } from "../lib/un-solo-nombre.js";

// CRUD mínimo de cajeros/encargados (B3 §1.4 ampliado). Sólo el OWNER
// crea o revoca cajeros (§15 nucleus). El alta exige un PIN inicial —
// el propietario lo comunica al cajero por canal seguro, y el cajero
// puede pedir reset al propietario si lo olvida.
//
// B6 §1: MANAGER puede listar cajeros y resetear su PIN (operativa diaria),
// pero NO crearlos ni borrarlos (eso queda en el OWNER).
//
// Roles aceptados: MANAGER, CASHIER y —clinica-1— CLINICIAN. OWNER se
// crea sólo vía /signup.
//
// ── clinica-1 · por qué el sanitario entra en ESTE CRUD ──────────────
//
// Porque es el mismo acto: dar de alta a alguien del personal con su PIN
// para que entre al TPV. Un CRUD paralelo "de sanitarios" habría
// duplicado la unicidad del alias, el centinela de revocación y el reset
// de PIN, y habría dejado dos sitios donde dar de alta a una persona.
//
// Las SEIS consultas de este fichero filtran por rol, y las seis llevan
// ahora `CLINICIAN`: listar, crear, renombrar, resetear PIN, revocar y la
// colisión de alias. Que falte en una sola significa un sanitario que
// existe pero al que no se le puede cambiar el PIN, o que no sale en la
// lista desde la que se le revoca.
//
// El alta con rol `CLINICIAN` exige que el tenant tenga la clínica
// encendida: un rol que no se puede gestionar desde ninguna pantalla no
// se debe poder crear por la API.

const emailFormat = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";
// pin-1 · el formato vive ahora en `auth/pin.ts`, junto a las reglas de
// qué PIN es demasiado fácil. Sigue siendo 4-8 cifras: el bloque no lo
// cambia. Lo que se gana es que el formato y el filtro de triviales no
// puedan separarse — las cuatro rutas que guardan un PIN importan los
// dos del mismo sitio.
const pinFormat = PIN_FORMAT;

// ── clinica-8 · QUIÉN ES PERSONAL DE LA CAJA DE ESTE COMERCIO ────────
//
// Las cuatro operaciones de esta pantalla (listar, renombrar, cambiar el
// PIN y revocar) compartían el mismo `where` escrito cuatro veces, y a las
// cuatro les faltaba lo mismo: **tres clases de usuario que no son
// personal del cliente y que salían igual en la lista, con sus botones.**
//
//   · el CAJERO TÉCNICO de «Probar TPV» (`isTestCashier`). Es un usuario
//     interno de Mi Piace, con email `mipiacetpv-test-…@internal…`. La
//     auditoría del 18-10 se lo encontró en Cajeros y le cambió el PIN
//     desde el panel de la dueña;
//   · el REVOCADO, que se queda como `revoked-1792…@revoked.local` (la
//     revocación es un soft-delete: hay FK en turnos y tickets). Salía con
//     ese email de centinela y con sus tres botones;
//   · el BORRADO, `deleted_at` puesto — que es justo lo que la activación
//     le hace al cajero técnico (`purgeTestData`).
//
// Y no es cosmética: la revocación deja `pin_hash = NULL`, así que el
// cajero no entra. Pero «Cambiar PIN» le pone uno nuevo. O sea que desde
// esta pantalla se podía **resucitar a un cajero revocado y al cajero
// técnico de Mi Piace**, que es un acceso a la caja que nadie concedió.
// Por eso el filtro va en las CUATRO y no sólo en la lista: esconder el
// botón no cierra la ruta.
//
// clinica-9 (6) · Y LA CUARTA CLASE: EL ACTOR DE SISTEMA.
//
// `clinica/actor-paciente.ts` dice, desde clinica-2: «No sale en
// `GET /cashiers`, ni en `GET /staff`, ni entre los candidatos a PIN de
// encargado, ni cuenta para la colisión de alias. Esas cuatro listas
// filtran por `isSystemActor: false`».
//
// **No lo filtraba ninguna.** La pasada en hierro del 24-10 encontró
// «Paciente (por enlace)» en Cajeros, con sus botones de Editar, Cambiar
// PIN y Revocar, y en Personal. No hay agujero —el CHECK
// `users_system_actor_no_credentials` prohíbe que tenga `pin_hash`, así
// que «Cambiar PIN» reventaba contra la base con un 500 en vez de darle
// acceso— pero es una fila de sistema ofrecida como si fuera una persona
// a la que gestionar, con un botón que contesta «error inesperado».
//
// Lo que la frase prometía se cumple ahora de verdad, y en las cuatro.
const PERSONAL_DE_LA_CAJA = {
  role: { in: ["MANAGER", "CASHIER", "CLINICIAN"] satisfies UserRole[] },
  deletedAt: null,
  isTestCashier: false,
  isSystemActor: false,
  NOT: { email: { endsWith: "@revoked.local" } },
};

// v1.7-alias-cajeros: unicidad del alias por tenant entre cajeros
// activos (case-insensitive), validada aquí y no como constraint de
// BD — "María" puede existir en dos tenants. Los revocados (email
// sentinel @revoked.local) no bloquean el alias para nuevos cajeros.
async function findAliasCollision(
  prisma: ReturnType<typeof getPrisma>,
  tenantId: string,
  alias: string,
  excludeUserId?: string,
): Promise<{ id: string } | null> {
  return prisma.user.findFirst({
    where: {
      tenantId,
      role: { in: ["MANAGER", "CASHIER", "CLINICIAN"] },
      // clinica-9 (6) · el actor de sistema tampoco cuenta para la
      // colisión: «Paciente (por enlace)» no es una persona, y que su
      // nombre bloqueara el de alguien sería absurdo.
      isSystemActor: false,
      alias: { equals: alias, mode: "insensitive" },
      NOT: [
        { email: { endsWith: "@revoked.local" } },
        ...(excludeUserId ? [{ id: excludeUserId }] : []),
      ],
    },
    select: { id: true },
  });
}

export async function registerCashiersRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/cashiers",
    { preHandler: [requireOwnerOrManager, ensureCajaEnabled] },
    async (request) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const users = await prisma.user.findMany({
        where: { tenantId: auth.tenantId, ...PERSONAL_DE_LA_CAJA },
        select: {
          id: true,
          email: true,
          alias: true,
          role: true,
          lastLoginAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      });
      return {
        cashiers: users.map((u) => ({
          id: u.id,
          email: u.email,
          alias: u.alias,
          role: u.role,
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
        })),
      };
    },
  );

  app.post(
    "/cashiers",
    {
      preHandler: [requireOwner, ensureCajaEnabled],
      schema: {
        body: {
          type: "object",
          required: ["email", "alias", "role", "pin"],
          additionalProperties: false,
          properties: {
            email: { type: "string", pattern: emailFormat, maxLength: 320 },
            alias: { type: "string", minLength: 1, maxLength: 40 },
            // clinica-1 · `CLINICIAN` sólo se acepta si el tenant tiene
            // la clínica encendida — la comprobación va en el handler,
            // porque el schema no puede leer la fila del tenant.
            role: { type: "string", enum: ["MANAGER", "CASHIER", "CLINICIAN"] },
            pin: { type: "string", pattern: pinFormat },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { email, alias, role, pin } = request.body as {
        email: string;
        alias: string;
        role: "MANAGER" | "CASHIER" | "CLINICIAN";
        pin: string;
      };
      const lowerEmail = email.toLowerCase();
      // El schema garantiza 1..40 chars pero no impide sólo-espacios.
      const trimmedAlias = alias.trim();
      if (trimmedAlias.length === 0) {
        return reply.code(400).send({
          error: "INVALID_ALIAS",
          message: "El alias no puede estar vacío",
        });
      }
      const prisma = getPrisma();

      // clinica-1 · el rol del sanitario sólo existe donde hay clínica.
      // Sin esta puerta, la API dejaría crear un `CLINICIAN` en un bar: un
      // usuario que no puede cobrar, que no sale en ninguna pantalla donde
      // se le pueda poner alcance, y al que nadie sabría por qué no le
      // funciona el TPV.
      if (role === "CLINICIAN") {
        const tenant = await prisma.tenant.findUnique({
          where: { id: auth.tenantId },
          select: { clinicalRecordsEnabled: true },
        });
        if (tenant?.clinicalRecordsEnabled !== true) {
          return reply.code(409).send({
            error: "CLINICAL_RECORDS_DISABLED",
            code: "CLINICAL_RECORDS_DISABLED",
            message:
              "Esta empresa no tiene el módulo de historia clínica activado, así que no puede tener personal sanitario.",
          });
        }
      }

      const collision = await prisma.user.findUnique({
        where: { email: lowerEmail },
        select: { id: true },
      });
      if (collision) {
        return reply.code(409).send({
          error: "EMAIL_TAKEN",
          message: "Ya existe un usuario con ese email",
        });
      }

      const aliasCollision = await findAliasCollision(
        prisma,
        auth.tenantId,
        trimmedAlias,
      );
      if (aliasCollision) {
        return reply.code(409).send({
          error: "ALIAS_TAKEN",
          message: `Ya hay un cajero llamado ${trimmedAlias}`,
        });
      }

      // pin-1 (puntos 1 y 4) · el PIN del alta es PROVISIONAL.
      //
      // El propietario teclea uno y se lo dice a la persona por teléfono.
      // Eso sigue igual — lo que cambia es que ese PIN sólo sirve para
      // entrar UNA vez: en el primer login del TPV, la pantalla le obliga
      // a elegir el suyo antes de pasar. Es el «primer acceso» del punto
      // 4 para el personal, y es lo que hace que un PIN dicho por
      // teléfono deje de valer en cuanto llega su dueña.
      //
      // Y pasa por el filtro de triviales igual que los demás: entre el
      // alta y el primer turno pueden pasar días, y durante esos días
      // «1234» es un PIN que entra al TPV.
      const motivo = motivoPinTrivial(pin);
      if (motivo) return reply.code(400).send(errorPinTrivial(motivo));
      const pinHash = await hashPassword(pin);
      // El alta y su fila de registro, en una transacción. Mismo criterio
      // que `escribirPinYRegistrarlo` (que no sirve aquí porque esto es
      // un `create` y no un `update`): o se crea la persona CON el
      // registro de quién le puso el PIN, o no se crea.
      const created = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const nuevo = await tx.user.create({
          data: {
            tenantId: auth.tenantId,
            email: lowerEmail,
            alias: trimmedAlias,
            pinHash,
            pinProvisionalAt: new Date(),
            role,
          },
          select: { id: true, email: true, alias: true, role: true, createdAt: true },
        });
        await tx.pinChange.create({
          data: {
            tenantId: auth.tenantId,
            targetUserId: nuevo.id,
            actorUserId: auth.userId,
            kind: "PROVISIONAL",
            source: "PERSONAL",
          },
        });
        return nuevo;
      });
      return reply.code(201).send({
        cashier: {
          id: created.id,
          email: created.email,
          alias: created.alias,
          role: created.role,
          createdAt: created.createdAt.toISOString(),
        },
      });
    },
  );

  // v1.7-alias-cajeros: edición del alias. Sólo OWNER (misma política
  // que alta/revocación). El email no se edita — es la credencial.
  app.patch(
    "/cashiers/:cashierId",
    {
      preHandler: [requireOwner, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["cashierId"],
          properties: { cashierId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["alias"],
          additionalProperties: false,
          properties: {
            alias: { type: "string", minLength: 1, maxLength: 40 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { cashierId } = request.params as { cashierId: string };
      const { alias } = request.body as { alias: string };
      const trimmedAlias = alias.trim();
      if (trimmedAlias.length === 0) {
        return reply.code(400).send({
          error: "INVALID_ALIAS",
          message: "El alias no puede estar vacío",
        });
      }
      const prisma = getPrisma();
      const target = await prisma.user.findFirst({
        where: { id: cashierId, tenantId: auth.tenantId, ...PERSONAL_DE_LA_CAJA },
        select: { id: true },
      });
      if (!target) {
        return reply
          .code(404)
          .send({ error: "CASHIER_NOT_FOUND", message: "Cajero no encontrado" });
      }
      const aliasCollision = await findAliasCollision(
        prisma,
        auth.tenantId,
        trimmedAlias,
        target.id,
      );
      if (aliasCollision) {
        return reply.code(409).send({
          error: "ALIAS_TAKEN",
          message: `Ya hay un cajero llamado ${trimmedAlias}`,
        });
      }
      // clinica-9 (5) · Y EL MISMO NOMBRE EN LA AGENDA. Renombrar aquí
      // dejaba a quien tuviera perfil de profesional con dos nombres
      // distintos —uno en el TPV y otro en la agenda— y entonces «un
      // solo nombre manda» deja de ser verdad según por dónde se entre.
      // Sólo a quien YA tiene perfil: un cajero de barra no se convierte
      // en profesional de la agenda por renombrarse.
      const updated = await escribirElNombre(prisma, {
        tenantId: auth.tenantId,
        userId: target.id,
        nombre: trimmedAlias,
        crearPerfil: false,
      });
      return reply.code(200).send({
        cashier: {
          id: updated.id,
          email: updated.email,
          alias: updated.alias,
          role: updated.role,
        },
      });
    },
  );

  app.patch(
    "/cashiers/:cashierId/pin",
    {
      preHandler: [requireOwnerOrManager, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["cashierId"],
          properties: { cashierId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["pin"],
          additionalProperties: false,
          properties: { pin: { type: "string", pattern: pinFormat } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { cashierId } = request.params as { cashierId: string };
      const { pin } = request.body as { pin: string };
      const prisma = getPrisma();
      const target = await prisma.user.findFirst({
        where: { id: cashierId, tenantId: auth.tenantId, ...PERSONAL_DE_LA_CAJA },
        select: { id: true },
      });
      if (!target) {
        return reply
          .code(404)
          .send({ error: "CASHIER_NOT_FOUND", message: "Cajero no encontrado" });
      }
      // pin-1 (punto 3) · OLVIDÉ MI PIN, EL PERSONAL.
      //
      // Esta pantalla sigue siendo la de siempre y el gesto no cambia: la
      // propietaria (o el encargado) le pone un PIN a quien lo ha
      // olvidado. Lo que cambia es QUÉ queda puesto — uno PROVISIONAL,
      // que sólo sirve para que esa persona entre al TPV y elija el suyo.
      //
      // Es lo que convierte «te pongo 5050, cámbialo luego» en algo que
      // se cumple: hasta hoy, el PIN que ponía la dueña se quedaba de por
      // vida, y la dueña lo sabía.
      const motivo = motivoPinTrivial(pin);
      if (motivo) return reply.code(400).send(errorPinTrivial(motivo));
      await escribirPinYRegistrarlo({
        targetUserId: target.id,
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        pinHash: await hashPassword(pin),
        kind: "PROVISIONAL",
        source: "PERSONAL",
      });
      return reply.code(200).send({ ok: true, provisional: true });
    },
  );

  app.delete(
    "/cashiers/:cashierId",
    {
      preHandler: [requireOwner, ensureCajaEnabled],
      schema: {
        params: {
          type: "object",
          required: ["cashierId"],
          properties: { cashierId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const auth = request.auth!;
      const { cashierId } = request.params as { cashierId: string };
      const prisma = getPrisma();
      const target = await prisma.user.findFirst({
        where: { id: cashierId, tenantId: auth.tenantId, ...PERSONAL_DE_LA_CAJA },
        select: { id: true, _count: { select: { shifts: true, tickets: true } } },
      });
      if (!target) {
        return reply
          .code(404)
          .send({ error: "CASHIER_NOT_FOUND", message: "Cajero no encontrado" });
      }
      // No borramos: hay FKs en shifts y tickets. Soft-delete vía PIN
      // nuked + email prefijado para que el propietario lo distinga.
      // Esto preserva el histórico operativo.
      const sentinel = `revoked-${Date.now()}-${target.id}@revoked.local`;
      await prisma.user.update({
        where: { id: target.id },
        data: {
          pinHash: null,
          // pin-1 · y la marca de provisional se va con el PIN. No es
          // cosmética: el CHECK `users_pin_provisional_exige_pin` prohíbe
          // la marca sin PIN, así que sin esta línea revocar a alguien
          // con PIN provisional —que es TODO el personal recién dado de
          // alta— reventaría contra la base.
          pinProvisionalAt: null,
          email: sentinel,
          tokenVersion: { increment: 1 },
        },
      });
      return reply.code(200).send({
        ok: true,
        softDeleted: true,
        preservedShifts: target._count.shifts,
        preservedTickets: target._count.tickets,
      });
    },
  );
}
