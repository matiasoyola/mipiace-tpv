// residencia-1 · LOS ROLES DE CUIDADO Y LAS ZONAS.
//
// El catálogo del centro, las asignaciones persona ↔ rol y el alcance por
// planta. Son las dos piezas de las que cuelga la función de acceso, así
// que son las dos que decide **el OWNER y no el encargado**: la misma
// escalera que `PATCH /staff/:userId/clinica` en clinica-1, y por la misma
// razón —esto decide quién ve datos de salud, y eso es de la misma clase
// que crear un usuario.
//
// Lo que el encargado SÍ puede es leer: necesita saber quién cubre qué
// planta para organizar el turno.
//
// ── Y LO QUE PASA AL DAR UN ROL QUE REGISTRA ─────────────────────────
//
// Queda `User.isClinician = true`, con número de colegiado **sólo si el
// rol lo exige**. Ver `asignarRol` más abajo, que es donde está escrito
// cómo encaja esto con el CHECK `users_clinician_implies_flag` de
// clinica-1 y con el requisito de colegiado de su API.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { getPrisma } from "../context.js";
import {
  requireOwner,
  requireOwnerOrManager,
} from "../auth/middleware.js";
import { ensureClinicaEnabled } from "../clinica/gate.js";
import { ensureResidenciaEnabled } from "./gate.js";

const PUERTAS_LECTURA = [
  requireOwnerOrManager,
  ensureClinicaEnabled,
  ensureResidenciaEnabled,
];
// `requireOwner` · ver la cabecera.
const PUERTAS_ESCRITURA = [
  requireOwner,
  ensureClinicaEnabled,
  ensureResidenciaEnabled,
];

const CATEGORIAS = ["OPERATIVO", "SUPERVISOR", "DIRECTIVO"] as const;

const ROL_SELECT = {
  id: true,
  code: true,
  name: true,
  category: true,
  isStandard: true,
  active: true,
  sortOrder: true,
  recordsCare: true,
  requiresLicense: true,
  fullScope: true,
} as const;

/** Vigente = sin revocar, empezada y sin caducar. */
function filtroVigente(ahora: Date) {
  return {
    revokedAt: null,
    fromAt: { lte: ahora },
    OR: [{ toAt: null }, { toAt: { gt: ahora } }],
  };
}

export async function registerResidenciaRolesRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── EL CATÁLOGO ────────────────────────────────────────────────────
  app.get(
    "/residencia/roles-de-cuidado",
    { preHandler: PUERTAS_LECTURA },
    async (request: FastifyRequest) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const roles = await prisma.careRole.findMany({
        where: { tenantId: auth.tenantId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: ROL_SELECT,
      });
      return { roles };
    },
  );

  // Añadir uno PROPIO. `isStandard` se fuerza a `false` y no se lee del
  // cuerpo: un rol que se declarara «de serie» heredaría la protección del
  // trigger `care_roles_de_serie_son_fijos` y ya no se podría corregir.
  app.post(
    "/residencia/roles-de-cuidado",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        body: {
          type: "object",
          required: ["code", "name", "category"],
          additionalProperties: false,
          properties: {
            code: { type: "string", minLength: 1, maxLength: 40 },
            name: { type: "string", minLength: 1, maxLength: 80 },
            category: { type: "string", enum: CATEGORIAS as unknown as string[] },
            recordsCare: { type: "boolean" },
            requiresLicense: { type: "boolean" },
            fullScope: { type: "boolean" },
            sortOrder: { type: "integer", minimum: 0, maximum: 999 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const body = request.body as {
        code: string;
        name: string;
        category: (typeof CATEGORIAS)[number];
        recordsCare?: boolean;
        requiresLicense?: boolean;
        fullScope?: boolean;
        sortOrder?: number;
      };
      const prisma = getPrisma();
      // Normalizado aquí y no en la base: el personal escribe «fisio de
      // tarde» y el código es `FISIO_DE_TARDE`. Que la unicidad sea del
      // código y no del nombre es lo que permite dos roles que se llaman
      // parecido.
      const code = body.code
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
      if (!code) {
        return reply.code(400).send({
          error: "CODIGO_INVALIDO",
          message: "El código del rol tiene que llevar alguna letra o número.",
        });
      }
      const repetido = await prisma.careRole.findFirst({
        where: { tenantId: auth.tenantId, code },
        select: { id: true, name: true },
      });
      if (repetido) {
        return reply.code(409).send({
          error: "ROL_REPETIDO",
          message: `Ya hay un rol con ese código en este centro («${repetido.name}»).`,
        });
      }
      const rol = await prisma.careRole.create({
        data: {
          tenantId: auth.tenantId,
          code,
          name: body.name.trim(),
          category: body.category,
          isStandard: false,
          recordsCare: body.recordsCare ?? true,
          requiresLicense: body.requiresLicense ?? false,
          fullScope: body.fullScope ?? false,
          sortOrder: body.sortOrder ?? 50,
        },
        select: ROL_SELECT,
      });
      return reply.code(201).send({ rol });
    },
  );

  // Editar. De uno DE SERIE sólo se puede cambiar el nombre, el orden y si
  // está activo; la categoría y los tres flags los fija el producto. Se
  // comprueba aquí para dar una frase, y lo garantiza el trigger
  // `care_roles_de_serie_son_fijos` del motor — que es el que aguanta un
  // `psql` a las nueve de la noche.
  app.patch(
    "/residencia/roles-de-cuidado/:careRoleId",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: {
          type: "object",
          required: ["careRoleId"],
          additionalProperties: false,
          properties: { careRoleId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 80 },
            category: { type: "string", enum: CATEGORIAS as unknown as string[] },
            recordsCare: { type: "boolean" },
            requiresLicense: { type: "boolean" },
            fullScope: { type: "boolean" },
            active: { type: "boolean" },
            sortOrder: { type: "integer", minimum: 0, maximum: 999 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { careRoleId } = request.params as { careRoleId: string };
      const body = request.body as Record<string, unknown>;
      const prisma = getPrisma();

      const rol = await prisma.careRole.findFirst({
        where: { id: careRoleId, tenantId: auth.tenantId },
        select: ROL_SELECT,
      });
      if (!rol) {
        return reply.code(404).send({
          error: "ROL_NO_ENCONTRADO",
          message: "Ese rol de cuidado no es de este centro.",
        });
      }

      const prohibidos = ["category", "recordsCare", "requiresLicense", "fullScope"];
      if (rol.isStandard) {
        const intento = prohibidos.filter(
          (c) => body[c] !== undefined && body[c] !== (rol as Record<string, unknown>)[c],
        );
        if (intento.length > 0) {
          return reply.code(409).send({
            error: "ROL_DE_SERIE_FIJO",
            message:
              "De un rol de serie puedes cambiar el nombre, el orden y si está activo. " +
              "La categoría y el alcance los fija el producto: de ellos depende quién puede cerrar una incidencia y quién ve a todos los residentes. " +
              "Si necesitas otro comportamiento, crea un rol propio.",
            campos: intento,
          });
        }
      }

      const data: Record<string, unknown> = {};
      if (body.name !== undefined) data.name = (body.name as string).trim();
      if (body.active !== undefined) data.active = body.active;
      if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
      if (!rol.isStandard) {
        for (const c of prohibidos) {
          if (body[c] !== undefined) data[c] = body[c];
        }
      }

      const actualizado = await prisma.careRole.update({
        where: { id: careRoleId },
        data,
        select: ROL_SELECT,
      });
      return { rol: actualizado };
    },
  );

  // ── LOS ROLES Y LA ZONA DE UNA PERSONA ─────────────────────────────
  app.get(
    "/residencia/staff/:userId/cuidado",
    {
      preHandler: PUERTAS_LECTURA,
      schema: {
        params: {
          type: "object",
          required: ["userId"],
          additionalProperties: false,
          properties: { userId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { userId } = request.params as { userId: string };
      const prisma = getPrisma();
      const ahora = new Date();

      const usuario = await prisma.user.findFirst({
        where: { id: userId, tenantId: auth.tenantId, deletedAt: null },
        select: { id: true, isClinician: true, clinicianLicense: true },
      });
      if (!usuario) {
        return reply.code(404).send({
          error: "USUARIO_NO_ENCONTRADO",
          message: "Esa persona no es de este centro.",
        });
      }

      const [roles, zonas, pin] = await Promise.all([
        // **Todas**, vigentes y revocadas: la pantalla enseña el histórico
        // con la frase «revocar no borra nada», igual que la lista de
        // pacientes de un sanitario en clinica-1.
        prisma.careRoleAssignment.findMany({
          where: { tenantId: auth.tenantId, userId },
          orderBy: [{ revokedAt: "asc" }, { fromAt: "desc" }],
          select: {
            id: true,
            fromAt: true,
            toAt: true,
            revokedAt: true,
            careRole: { select: ROL_SELECT },
          },
        }),
        prisma.careZoneAssignment.findMany({
          where: { tenantId: auth.tenantId, userId },
          orderBy: [{ toAt: "asc" }, { fromAt: "desc" }],
          select: {
            id: true,
            fromAt: true,
            toAt: true,
            floorId: true,
            floor: { select: { id: true, name: true } },
          },
        }),
        // residencia-3 · ¿tiene PIN de puerta? **El PIN no sale**: ni
        // entero, ni parcial, ni su hash, ni su huella. Lo único que la
        // pantalla puede saber es si hay uno y desde cuándo, que es lo que
        // la dirección necesita para decidir si ponerlo o quitarlo.
        prisma.carePin.findFirst({
          where: { userId, tenantId: auth.tenantId },
          select: { setAt: true },
        }),
      ]);

      const vigentes = roles.filter(
        (r) =>
          r.revokedAt == null &&
          r.fromAt <= ahora &&
          (r.toAt == null || r.toAt > ahora),
      );

      return {
        esSanitario: usuario.isClinician,
        colegiado: usuario.clinicianLicense,
        roles: roles.map((r) => ({
          id: r.id,
          rol: r.careRole,
          desde: r.fromAt.toISOString(),
          hasta: r.toAt?.toISOString() ?? null,
          revocado: r.revokedAt?.toISOString() ?? null,
          vigente: vigentes.some((v) => v.id === r.id),
        })),
        zonas: zonas.map((z) => ({
          id: z.id,
          // `null` = todo el centro.
          floorId: z.floorId,
          floorName: z.floor?.name ?? null,
          desde: z.fromAt.toISOString(),
          hasta: z.toAt?.toISOString() ?? null,
          vigente: z.fromAt <= ahora && (z.toAt == null || z.toAt > ahora),
        })),
        // Lo que la función de acceso contestaría hoy para esta persona,
        // resumido. La pantalla lo pinta como una frase («ve todo el
        // centro», «ve la planta 1»): es lo que la dirección quiere saber
        // después de tocar algo, y deducirlo en el front habría sido una
        // segunda copia de la regla.
        alcance: vigentes.length === 0
          ? "SIN_ROL"
          : vigentes.some((v) => v.careRole.fullScope) ||
              zonas.some(
                (z) =>
                  z.floorId == null &&
                  z.fromAt <= ahora &&
                  (z.toAt == null || z.toAt > ahora),
              )
            ? "CENTRO"
            : "ZONA",
        // residencia-3 · con qué entra en la tablet de una habitación.
        pinDePuerta: pin ? { desde: pin.setAt.toISOString() } : null,
      };
    },
  );

  // ── DAR UN ROL DE CUIDADO ──────────────────────────────────────────
  app.post(
    "/residencia/staff/:userId/roles-de-cuidado",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: {
          type: "object",
          required: ["userId"],
          additionalProperties: false,
          properties: { userId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["careRoleId"],
          additionalProperties: false,
          properties: {
            careRoleId: { type: "string", format: "uuid" },
            // Por defecto, ahora. Se acepta una fecha para dar de alta a
            // alguien que empieza el lunes.
            desde: { type: "string", format: "date-time" },
            hasta: { type: "string", format: "date-time" },
            // El nº de colegiado, cuando el rol lo exige y la persona
            // todavía no lo tiene guardado.
            colegiado: { type: "string", maxLength: 40 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { userId } = request.params as { userId: string };
      const body = request.body as {
        careRoleId: string;
        desde?: string;
        hasta?: string;
        colegiado?: string;
      };
      const prisma = getPrisma();

      const [usuario, rol] = await Promise.all([
        prisma.user.findFirst({
          where: { id: userId, tenantId: auth.tenantId, deletedAt: null },
          select: {
            id: true,
            role: true,
            isClinician: true,
            clinicianLicense: true,
          },
        }),
        prisma.careRole.findFirst({
          where: { id: body.careRoleId, tenantId: auth.tenantId },
          select: ROL_SELECT,
        }),
      ]);
      if (!usuario) {
        return reply.code(404).send({
          error: "USUARIO_NO_ENCONTRADO",
          message: "Esa persona no es de este centro.",
        });
      }
      if (!rol) {
        return reply.code(404).send({
          error: "ROL_NO_ENCONTRADO",
          message: "Ese rol de cuidado no es de este centro.",
        });
      }
      if (!rol.active) {
        return reply.code(409).send({
          error: "ROL_INACTIVO",
          message:
            "Ese rol está desactivado en este centro. Actívalo antes de asignarlo.",
        });
      }

      const colegiadoFinal =
        body.colegiado?.trim() || usuario.clinicianLicense || null;

      // ── EL COLEGIADO, Y SÓLO SI EL ROL LO EXIGE ──────────────────
      //
      // DUE, médico, fisio y TO (`requiresLicense`). La auxiliar y la
      // limpiadora registran y no tienen colegio profesional: pedírselo
      // habría dejado a media plantilla sin poder entrar en la puerta, que
      // es justamente para quien se construye.
      //
      // La regla cruza `care_roles` y `users`, así que no cabe en un CHECK
      // y vive aquí, igual que el requisito de colegiado de clinica-1
      // cruzaba `users` y `tenants`.
      if (rol.requiresLicense && !colegiadoFinal) {
        return reply.code(400).send({
          error: "COLEGIADO_REQUERIDO",
          message: `«${rol.name}» es una profesión con colegio profesional: necesita su nº de colegiado, que va en la historia y en lo que firme.`,
        });
      }

      const ahora = new Date();
      const desde = body.desde ? new Date(body.desde) : ahora;
      const hasta = body.hasta ? new Date(body.hasta) : null;
      if (hasta && hasta <= desde) {
        return reply.code(400).send({
          error: "VIGENCIA_INVALIDA",
          message: "La fecha de fin tiene que ser posterior a la de inicio.",
        });
      }

      // Idempotente: si ya tiene ESE rol vigente, 200 y `created: false`.
      // Un doble toque en una tablet no es un error, y el índice parcial
      // `care_role_assignments_one_live_key` lo rechazaría con un 500.
      const yaLoTiene = await prisma.careRoleAssignment.findFirst({
        where: {
          tenantId: auth.tenantId,
          userId,
          careRoleId: body.careRoleId,
          revokedAt: null,
        },
        select: { id: true },
      });
      if (yaLoTiene) {
        return reply
          .code(200)
          .send({ asignacionId: yaLoTiene.id, created: false });
      }

      const asignacion = await prisma.$transaction(async (tx) => {
        const a = await tx.careRoleAssignment.create({
          data: {
            tenantId: auth.tenantId,
            userId,
            careRoleId: body.careRoleId,
            fromAt: desde,
            toAt: hasta,
            grantedByUserId: auth.userId,
          },
          select: { id: true },
        });

        // ── Y AQUÍ ENCAJA `isClinician` (D-51) ────────────────────
        //
        // Quien tiene un rol de cuidado que REGISTRA es sanitario a
        // efectos de acceso: en una residencia, la auxiliar que apunta que
        // doña Carmen no ha comido está escribiendo en su historia. Sin la
        // marca, la función de acceso contesta «no es sanitario» antes de
        // mirar el rol de cuidado — y la plantilla entera se quedaría
        // fuera.
        //
        // Se escribe la MARCA y no el ROL DE NEGOCIO: `User.role` no se
        // toca, ni aquí ni en ningún sitio de este bloque. Una auxiliar
        // puede ser `CASHIER` (si el centro tiene caja para la cafetería) o
        // `CLINICIAN`, y esta ruta no opina.
        //
        // Lo que eso significa para el CHECK `users_clinician_implies_flag`
        // de clinica-1 («role = CLINICIAN ⇒ is_clinician»): se cumple sin
        // tocarlo, porque esto sólo ENCIENDE la marca. El CHECK prohíbe el
        // estado «rol de sanitario con la marca apagada», y poner la marca
        // nunca lleva a ese estado. Quitar el rol de cuidado tampoco la
        // apaga — ver la ruta de revocar y su nota.
        //
        // `clinicalScope` se queda como esté (`SELECTION` por defecto) y da
        // igual: en un tenant de residencia la función de acceso no lo
        // mira. Se deja intacto a propósito, para que un centro MIXTO
        // —residencia con una consulta de podología dentro, que es el caso
        // que Jardín de Gredos ya tiene— conserve el alcance clínico de su
        // podóloga.
        if (rol.recordsCare) {
          await tx.user.update({
            where: { id: userId },
            data: {
              isClinician: true,
              ...(colegiadoFinal ? { clinicianLicense: colegiadoFinal } : {}),
            },
          });
        } else if (colegiadoFinal && colegiadoFinal !== usuario.clinicianLicense) {
          await tx.user.update({
            where: { id: userId },
            data: { clinicianLicense: colegiadoFinal },
          });
        }
        return a;
      });

      return reply
        .code(201)
        .send({ asignacionId: asignacion.id, created: true });
    },
  );

  // ── REVOCAR UN ROL · no borra, rellena `revokedAt` ─────────────────
  app.delete(
    "/residencia/staff/:userId/roles-de-cuidado/:asignacionId",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: {
          type: "object",
          required: ["userId", "asignacionId"],
          additionalProperties: false,
          properties: {
            userId: { type: "string", format: "uuid" },
            asignacionId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { userId, asignacionId } = request.params as {
        userId: string;
        asignacionId: string;
      };
      const prisma = getPrisma();

      const asignacion = await prisma.careRoleAssignment.findFirst({
        where: { id: asignacionId, tenantId: auth.tenantId, userId },
        select: { id: true, revokedAt: true },
      });
      if (!asignacion) {
        return reply.code(404).send({
          error: "ASIGNACION_NO_ENCONTRADA",
          message: "Esa asignación no es de este centro.",
        });
      }
      // Revocar lo ya revocado es un doble toque, no un error.
      if (asignacion.revokedAt) {
        return reply.code(200).send({ revocado: false });
      }

      await prisma.careRoleAssignment.update({
        where: { id: asignacionId },
        data: { revokedAt: new Date(), revokedByUserId: auth.userId },
      });

      // ── LA MARCA SANITARIA NO SE QUITA AQUÍ ────────────────────────
      //
      // Y es deliberado. Quitarle el último rol de cuidado a alguien NO le
      // apaga `isClinician`, por tres razones:
      //
      //   1. **No haría falta.** La función de acceso exige rol de cuidado
      //      VIGENTE en un tenant de residencia, así que sin rol no ve a
      //      nadie — la marca encendida no le abre nada.
      //   2. **Rompería la clínica del centro mixto.** Si la DUE es además
      //      la podóloga que pasa consulta los viernes, apagarle la marca
      //      al quitarle el rol de cuidado le quitaría sus pacientes de la
      //      clínica, que es otra vertical.
      //   3. **Chocaría con el CHECK de clinica-1.** `role = CLINICIAN`
      //      implica `is_clinician` por `users_clinician_implies_flag`:
      //      apagar la marca a un `CLINICIAN` sería un 500 de constraint en
      //      una ruta de revocar un rol. Y poner un `if` por el rol de
      //      negocio aquí sería meter `UserRole` en la residencia, que es
      //      exactamente lo que D-50 saca.
      //
      // Dicho en una línea: el rol de cuidado ENCIENDE la marca y no la
      // apaga. Quien quiera apagarla lo hace donde se decide quién ve datos
      // de salud, que es `PATCH /staff/:userId/clinica`.
      return reply.code(200).send({ revocado: true });
    },
  );

  // ── LA ZONA ────────────────────────────────────────────────────────
  //
  // Se manda la lista COMPLETA de plantas vigentes y esta ruta la cuadra:
  // cierra las que ya no están y abre las que faltan. Un PUT y no un
  // POST/DELETE por planta porque es como se usa —la dirección mira la
  // pantalla, marca dos casillas y guarda— y porque con rutas por planta
  // el estado intermedio (ninguna planta marcada) es un momento en el que
  // esa persona no ve a nadie.
  app.put(
    "/residencia/staff/:userId/zona",
    {
      preHandler: PUERTAS_ESCRITURA,
      schema: {
        params: {
          type: "object",
          required: ["userId"],
          additionalProperties: false,
          properties: { userId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["alcance"],
          additionalProperties: false,
          properties: {
            // `CENTRO` = una fila con `floorId = null`. `PLANTAS` = una
            // fila por planta. `NINGUNA` = cerrar todas (la persona se
            // queda sin zona; si su rol no tiene `fullScope`, no ve a
            // nadie, y eso es lo que la dirección acaba de pedir).
            alcance: { type: "string", enum: ["CENTRO", "PLANTAS", "NINGUNA"] },
            floorIds: {
              type: "array",
              maxItems: 50,
              uniqueItems: true,
              items: { type: "string", format: "uuid" },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { userId } = request.params as { userId: string };
      const body = request.body as {
        alcance: "CENTRO" | "PLANTAS" | "NINGUNA";
        floorIds?: string[];
      };
      const prisma = getPrisma();

      const usuario = await prisma.user.findFirst({
        where: { id: userId, tenantId: auth.tenantId, deletedAt: null },
        select: { id: true },
      });
      if (!usuario) {
        return reply.code(404).send({
          error: "USUARIO_NO_ENCONTRADO",
          message: "Esa persona no es de este centro.",
        });
      }

      const pedidas = body.alcance === "PLANTAS" ? (body.floorIds ?? []) : [];
      if (body.alcance === "PLANTAS" && pedidas.length === 0) {
        return reply.code(400).send({
          error: "FALTAN_PLANTAS",
          message:
            "Dime qué plantas cubre, o elige «todo el centro» o «ninguna».",
        });
      }
      if (pedidas.length > 0) {
        const existen = await prisma.floor.count({
          where: { tenantId: auth.tenantId, id: { in: pedidas } },
        });
        if (existen !== pedidas.length) {
          return reply.code(404).send({
            error: "PLANTA_NO_ENCONTRADA",
            message: "Alguna de esas plantas no es de este centro.",
          });
        }
      }

      const ahora = new Date();
      await prisma.$transaction(async (tx) => {
        const vigentes = await tx.careZoneAssignment.findMany({
          where: {
            tenantId: auth.tenantId,
            userId,
            toAt: null,
          },
          select: { id: true, floorId: true },
        });

        const quiere: Array<string | null> =
          body.alcance === "CENTRO" ? [null] : pedidas;

        // Cerrar lo que ya no está. No se borra: la zona de marzo explica
        // por qué una auxiliar firmó un registro de la primera planta.
        const sobran = vigentes.filter(
          (v) => !quiere.some((q) => q === v.floorId),
        );
        if (sobran.length > 0) {
          await tx.careZoneAssignment.updateMany({
            where: { id: { in: sobran.map((s) => s.id) } },
            data: { toAt: ahora },
          });
        }

        // Abrir lo que falta.
        const faltan = quiere.filter(
          (q) => !vigentes.some((v) => v.floorId === q),
        );
        if (faltan.length > 0) {
          await tx.careZoneAssignment.createMany({
            data: faltan.map((floorId) => ({
              tenantId: auth.tenantId,
              userId,
              floorId,
              fromAt: ahora,
              grantedByUserId: auth.userId,
            })),
          });
        }
      });

      const zonas = await prisma.careZoneAssignment.findMany({
        where: { tenantId: auth.tenantId, userId, ...{ toAt: null } },
        select: { id: true, floorId: true, floor: { select: { name: true } } },
      });
      return {
        zonas: zonas.map((z) => ({
          id: z.id,
          floorId: z.floorId,
          floorName: z.floor?.name ?? null,
        })),
      };
    },
  );

  // ── EL CUADRANTE · quién cubre qué, hoy ────────────────────────────
  //
  // Lo que la pantalla de Personal necesita para pintar la columna de
  // residencia sin una petición por persona. Igual que `GET /staff` trae
  // el set de skills de cada profesional de una vez.
  app.get(
    "/residencia/staff/cuidado",
    { preHandler: PUERTAS_LECTURA },
    async (request: FastifyRequest) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const ahora = new Date();

      const [roles, zonas] = await Promise.all([
        prisma.careRoleAssignment.findMany({
          where: { tenantId: auth.tenantId, ...filtroVigente(ahora) },
          select: {
            userId: true,
            careRole: {
              select: { id: true, code: true, name: true, category: true, fullScope: true, active: true },
            },
          },
        }),
        prisma.careZoneAssignment.findMany({
          where: {
            tenantId: auth.tenantId,
            fromAt: { lte: ahora },
            OR: [{ toAt: null }, { toAt: { gt: ahora } }],
          },
          select: {
            userId: true,
            floorId: true,
            floor: { select: { id: true, name: true } },
          },
        }),
      ]);

      const porPersona = new Map<
        string,
        {
          userId: string;
          roles: Array<{ id: string; code: string; name: string; category: string }>;
          plantas: Array<{ id: string; name: string }>;
          centro: boolean;
        }
      >();
      function fila(userId: string) {
        let f = porPersona.get(userId);
        if (!f) {
          f = { userId, roles: [], plantas: [], centro: false };
          porPersona.set(userId, f);
        }
        return f;
      }
      for (const r of roles) {
        // Un rol desactivado no cuenta, igual que en la función de acceso:
        // si contara aquí, la pantalla diría que la fisio ve a su gente y
        // la ficha le diría que no.
        if (!r.careRole.active) continue;
        const f = fila(r.userId);
        f.roles.push({
          id: r.careRole.id,
          code: r.careRole.code,
          name: r.careRole.name,
          category: r.careRole.category,
        });
        if (r.careRole.fullScope) f.centro = true;
      }
      for (const z of zonas) {
        const f = fila(z.userId);
        if (z.floorId == null || z.floor == null) f.centro = true;
        else f.plantas.push({ id: z.floor.id, name: z.floor.name });
      }

      return { cuidado: [...porPersona.values()] };
    },
  );
}
