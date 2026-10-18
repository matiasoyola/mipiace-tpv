// residencia-5 · **LAS RUTAS DEL PANEL Y DE LOS RELEVOS, PARA EL ADMIN.**
//
// Siete:
//
//   1. `GET /residencia/panel`                — el panel entero, de un
//      golpe (ver `panel.ts` para por qué una y no cinco).
//   2. `GET /residencia/relevos`              — la lista, con su estado.
//   3. `GET /residencia/relevos/:id`          — un parte congelado con
//      sus confirmaciones y lo que llegó tarde.
//   4. `GET /residencia/relevos/vivo`         — el parte del turno EN
//      CURSO, calculado. No hay fila: ver la cabecera de `relevo.ts`.
//   5. `GET /residencia/indicadores`          — los seis de un mes.
//   6. `PUT /residencia/indicadores/:code`    — el umbral objetivo del
//      centro (rama de controles §10).
//   7. `DELETE /residencia/indicadores/:code` — y volver al de serie.
//
// ── QUIÉN ENTRA: DIRECCIÓN (decisión de producto 5) ─────────────────
//
// «El panel de dirección es la pantalla de inicio del admin para roles de
// categoría directiva (y para el OWNER).» Así que la puerta es doble:
// `requireOwnerOrManager` (el login del panel) **más** un rol de cuidado
// de categoría `DIRECTIVO`, salvo si es el OWNER.
//
// El OWNER entra siempre y es D-61: quien dirige el centro entra como
// OWNER del tenant, y pedirle además un rol de cuidado sería dejar al
// dueño fuera de su propio panel el día que se le caduque la asignación.
//
// Un ENCARGADO sin rol directivo **no entra**, y eso es lo que separa
// este panel de las demás pantallas de residencia: aquí se ve el estado
// clínico del centro entero de un vistazo.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { requireOwnerOrManager } from "../auth/middleware.js";
import { ensureClinicaEnabled } from "../clinica/gate.js";
import { negativaClinica } from "../clinica/contrato.js";
import { getPrisma } from "../context.js";
import {
  diaDelTurno,
  estaConfirmado,
  turnoDe,
  utcToWallDate,
  zonasSinConfirmar,
} from "@mipiacetpv/residencia-plan";

import { ensureResidenciaEnabled } from "./gate.js";
import { construirPanel, indicadoresDelMes } from "./panel.js";
import {
  construirParte,
  leerAnadidosTardios,
  leerParteCongelado,
} from "./relevo.js";


/**
 * ¿Puede esta persona abrir el panel de dirección?
 *
 * `null` = sí. Devuelve el error en vez de lanzar, igual que
 * `negativaDelPlan` en `plan-routes.ts`, para que cada ruta decida su
 * HTTP.
 */
async function negativaDeDireccion(
  tenantId: string,
  userId: string,
  esOwner: boolean,
): Promise<{ error: string; message: string } | null> {
  if (esOwner) return null;
  const ahora = new Date();
  const roles = await getPrisma().careRoleAssignment.findMany({
    where: {
      tenantId,
      userId,
      revokedAt: null,
      fromAt: { lte: ahora },
      OR: [{ toAt: null }, { toAt: { gte: ahora } }],
    },
    select: { careRole: { select: { category: true, active: true } } },
  });
  const directivo = roles
    .map((r) => r.careRole)
    .some((r) => r.active && r.category === "DIRECTIVO");
  if (!directivo) {
    return {
      error: "PANEL_ES_DE_DIRECCION",
      message:
        "El panel de dirección lo ven la dirección y quien tenga un rol de cuidado de categoría directiva. Pídeselo a la dirección en Personal.",
    };
  }
  return null;
}

/** Las zonas con contenido y las confirmaciones de un parte, para pintar. */
async function detalleDeConfirmacion(tenantId: string, handoverId: string) {
  const prisma = getPrisma();
  const [zonas, acuses] = await Promise.all([
    prisma.handoverZone.findMany({
      where: { tenantId, handoverId },
      select: { floorId: true, lineas: true, floor: { select: { name: true } } },
    }),
    prisma.handoverAck.findMany({
      where: { tenantId, handoverId },
      orderBy: { at: "asc" },
      select: {
        at: true,
        receivedAt: true,
        alcanceTotal: true,
        user: { select: { alias: true, email: true } },
        careRoleAssignment: { select: { careRole: { select: { name: true } } } },
        device: { select: { name: true } },
        zones: { select: { floor: { select: { id: true, name: true } } } },
      },
    }),
  ]);
  const alcances = acuses.map((a) => ({
    alcanceTotal: a.alcanceTotal,
    floorIds: a.zones.map((z) => z.floor.id),
  }));
  return {
    zonas: zonas.map((z) => ({
      floorId: z.floorId,
      nombre: z.floor?.name ?? "Del centro",
      lineas: z.lineas,
    })),
    confirmado: estaConfirmado(zonas, alcances),
    zonasPorConfirmar: zonasSinConfirmar(zonas, alcances).map((z) => z.floorId),
    acuses: acuses.map((a) => ({
      nombre: a.user.alias ?? a.user.email.split("@")[0]!,
      rol: a.careRoleAssignment.careRole.name,
      at: a.at.toISOString(),
      // **Las dos horas**, y es lo que hace visible una confirmación que
      // se encoló sin red: «la firmó a las 15:04, llegó a las 15:51».
      llegoEn: a.receivedAt.toISOString(),
      alcanceTotal: a.alcanceTotal,
      tablet: a.device.name,
      zonas: a.zones.map((z) => z.floor.name),
    })),
  };
}

export async function registerResidenciaPanelRoutes(
  app: FastifyInstance,
): Promise<void> {
  const puerta = {
    preHandler: [requireOwnerOrManager, ensureClinicaEnabled, ensureResidenciaEnabled],
  };

  // ════════════════════════════════════════════════════════════════
  //  1 · `GET /residencia/panel`
  // ════════════════════════════════════════════════════════════════
  app.get(
    "/residencia/panel",
    puerta,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const negativa = await negativaDeDireccion(
        auth.tenantId,
        auth.userId,
        auth.role === "OWNER",
      );
      if (negativa) return reply.code(403).send(negativa);

      // clinica-7 · el contrato de encargado, para LEER. El panel lleva
      // recuentos de salud (cuántas N3 abiertas hay) y una lista de
      // nombres en cuanto se abre una cifra.
      const contrato = await negativaClinica(auth.tenantId, "LEER");
      if (contrato) {
        return reply
          .code(423)
          .send({ error: contrato.code, code: contrato.code, message: contrato.message });
      }

      const panel = await construirPanel(getPrisma(), {
        tenantId: auth.tenantId,
        ahora: new Date(),
      });
      return reply.code(200).send(panel);
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  2 · `GET /residencia/relevos` · LA LISTA
  // ════════════════════════════════════════════════════════════════
  app.get(
    "/residencia/relevos",
    {
      ...puerta,
      schema: {
        querystring: {
          type: "object",
          properties: {
            desde: { type: "string" },
            hasta: { type: "string" },
            soloSinConfirmar: { type: "string" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const negativa = await negativaDeDireccion(
        auth.tenantId,
        auth.userId,
        auth.role === "OWNER",
      );
      if (negativa) return reply.code(403).send(negativa);

      const { desde, hasta, soloSinConfirmar } = request.query as {
        desde?: string;
        hasta?: string;
        soloSinConfirmar?: string;
      };
      const prisma = getPrisma();
      const partes = await prisma.handover.findMany({
        where: {
          tenantId: auth.tenantId,
          ...(desde || hasta
            ? { careDay: { ...(desde ? { gte: desde } : {}), ...(hasta ? { lte: hasta } : {}) } }
            : {}),
          ...(soloSinConfirmar === "1" ? { confirmedAt: null } : {}),
        },
        orderBy: [{ careDay: "desc" }, { frozenAt: "desc" }],
        take: 120,
        select: {
          id: true,
          careDay: true,
          lineas: true,
          sinNovedades: true,
          frozenAt: true,
          confirmedAt: true,
          centerShift: { select: { id: true, code: true, name: true } },
          _count: { select: { acks: true, zones: true, lateAdditions: true } },
        },
      });
      return reply.code(200).send({
        relevos: partes.map((p) => ({
          id: p.id,
          careDay: p.careDay,
          turno: p.centerShift,
          lineas: p.lineas,
          sinNovedades: p.sinNovedades,
          congeladoEn: p.frozenAt.toISOString(),
          confirmadoEn: p.confirmedAt?.toISOString() ?? null,
          confirmaciones: p._count.acks,
          zonas: p._count.zones,
          tardios: p._count.lateAdditions,
        })),
      });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  3 · `GET /residencia/relevos/vivo` · EL DEL TURNO EN CURSO
  // ════════════════════════════════════════════════════════════════
  //
  // **Va ANTES de `/:id`** en el orden de registro: con `/:id` delante,
  // Fastify intentaría leer `vivo` como un uuid y contestaría 400. Es la
  // trampa clásica de las rutas con parámetro y se paga una vez.
  app.get(
    "/residencia/relevos/vivo",
    puerta,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const negativa = await negativaDeDireccion(
        auth.tenantId,
        auth.userId,
        auth.role === "OWNER",
      );
      if (negativa) return reply.code(403).send(negativa);
      const contrato = await negativaClinica(auth.tenantId, "LEER");
      if (contrato) {
        return reply
          .code(423)
          .send({ error: contrato.code, code: contrato.code, message: contrato.message });
      }

      const prisma = getPrisma();
      const ahora = new Date();
      const turnos = await prisma.centerShift.findMany({
        where: { tenantId: auth.tenantId },
        orderBy: [{ sortOrder: "asc" }],
        select: { id: true, code: true, name: true, startsAt: true, endsAt: true },
      });
      const turno = turnoDe(ahora, turnos);
      if (turno == null) {
        // Los turnos del centro no cubren esta hora. No es un error: es
        // lo que residencia-1 §11.5 dejó escrito y lo que la pantalla
        // dice («hay un hueco en el cuadrante»).
        return reply.code(200).send({ parte: null, sinTurno: true });
      }
      const parte = await construirParte(prisma, {
        tenantId: auth.tenantId,
        turno,
        careDay: diaDelTurno(ahora, turno),
        // **En vivo el corte es AHORA.** Lo que no ha pasado todavía no
        // sale, y una franja abierta no cuenta como no hecha.
        corte: ahora,
        ahora,
      });
      return reply.code(200).send({ parte, sinTurno: false, enVivo: true });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  4 · `GET /residencia/relevos/:id` · UN PARTE CONGELADO
  // ════════════════════════════════════════════════════════════════
  app.get(
    "/residencia/relevos/:id",
    {
      ...puerta,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const negativa = await negativaDeDireccion(
        auth.tenantId,
        auth.userId,
        auth.role === "OWNER",
      );
      if (negativa) return reply.code(403).send(negativa);
      const contrato = await negativaClinica(auth.tenantId, "LEER");
      if (contrato) {
        return reply
          .code(423)
          .send({ error: contrato.code, code: contrato.code, message: contrato.message });
      }

      const prisma = getPrisma();
      const fila = await prisma.handover.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: {
          id: true,
          careDay: true,
          lineas: true,
          sinNovedades: true,
          generatedAt: true,
          frozenAt: true,
          confirmedAt: true,
          centerShift: { select: { id: true, code: true, name: true } },
        },
      });
      if (fila == null) {
        return reply.code(404).send({
          error: "RELEVO_NO_ENCONTRADO",
          message: "Ese parte de relevo no existe en este centro.",
        });
      }

      const [parte, detalle, tardios] = await Promise.all([
        leerParteCongelado(prisma, auth.tenantId, id),
        detalleDeConfirmacion(auth.tenantId, id),
        leerAnadidosTardios(prisma, auth.tenantId, id),
      ]);

      return reply.code(200).send({
        relevo: {
          id: fila.id,
          careDay: fila.careDay,
          turno: fila.centerShift,
          lineas: fila.lineas,
          sinNovedades: fila.sinNovedades,
          generadoEn: fila.generatedAt.toISOString(),
          congeladoEn: fila.frozenAt.toISOString(),
          confirmadoEn: fila.confirmedAt?.toISOString() ?? null,
          ...detalle,
          tardios,
          parte,
          /** El parte existe y no se descifra: se pinta el hueco marcado
           *  en vez de esconderlo (clinica-7). */
          ilegible: parte == null,
        },
      });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  5 · `GET /residencia/indicadores` · LOS SEIS DE UN MES
  // ════════════════════════════════════════════════════════════════
  app.get(
    "/residencia/indicadores",
    {
      ...puerta,
      schema: {
        querystring: {
          type: "object",
          properties: { mes: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}$" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const negativa = await negativaDeDireccion(
        auth.tenantId,
        auth.userId,
        auth.role === "OWNER",
      );
      if (negativa) return reply.code(403).send(negativa);

      const ahora = new Date();
      const { mes } = request.query as { mes?: string };
      const elMes = mes ?? utcToWallDate(ahora).slice(0, 7);
      const { INDICADORES_SIN_DATO } = await import("@mipiacetpv/residencia-plan");
      const indicadores = await indicadoresDelMes(
        getPrisma(),
        auth.tenantId,
        elMes,
        ahora,
      );
      return reply.code(200).send({
        mes: elMes,
        indicadores,
        // **Los que NO se pintan, nombrados.** Un indicador que falta y no
        // se nombra es un indicador que alguien da por calculado.
        sinDato: INDICADORES_SIN_DATO,
      });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  6 y 7 · El UMBRAL OBJETIVO, que es del centro
  // ════════════════════════════════════════════════════════════════
  //
  // La frontera estándar/centro de la rama §10: la fórmula es del
  // producto y no se toca desde aquí; el umbral sí.
  app.put(
    "/residencia/indicadores/:code",
    {
      ...puerta,
      schema: {
        params: {
          type: "object",
          required: ["code"],
          properties: { code: { type: "string", maxLength: 60 } },
        },
        body: {
          type: "object",
          required: ["target", "comparison"],
          additionalProperties: false,
          properties: {
            target: { type: "number", minimum: 0 },
            comparison: { type: "string", enum: ["AT_LEAST", "AT_MOST"] },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { code } = request.params as { code: string };
      const { target, comparison } = request.body as {
        target: number;
        comparison: "AT_LEAST" | "AT_MOST";
      };
      const negativa = await negativaDeDireccion(
        auth.tenantId,
        auth.userId,
        auth.role === "OWNER",
      );
      if (negativa) return reply.code(403).send(negativa);

      const { INDICADORES } = await import("@mipiacetpv/residencia-plan");
      if (!INDICADORES.some((i) => i.code === code)) {
        // Un umbral de un indicador que no existe no se guarda: sería una
        // fila que nadie lee y que parece configurada.
        return reply.code(400).send({
          error: "INDICADOR_DESCONOCIDO",
          message: `«${code}» no es uno de los indicadores que este sistema calcula.`,
        });
      }

      const fila = await getPrisma().indicatorTarget.upsert({
        where: { tenantId_code: { tenantId: auth.tenantId, code } },
        create: {
          tenantId: auth.tenantId,
          code,
          target,
          comparison,
          updatedByUserId: auth.userId,
        },
        update: { target, comparison, updatedByUserId: auth.userId },
        select: { code: true, target: true, comparison: true },
      });
      return reply.code(200).send({ umbral: fila });
    },
  );

  app.delete(
    "/residencia/indicadores/:code",
    {
      ...puerta,
      schema: {
        params: {
          type: "object",
          required: ["code"],
          properties: { code: { type: "string", maxLength: 60 } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { code } = request.params as { code: string };
      const negativa = await negativaDeDireccion(
        auth.tenantId,
        auth.userId,
        auth.role === "OWNER",
      );
      if (negativa) return reply.code(403).send(negativa);
      // Borrar la fila **vuelve al umbral de serie**, no deja el
      // indicador sin umbral: la fórmula y el umbral de serie son del
      // producto y están siempre.
      const { count } = await getPrisma().indicatorTarget.deleteMany({
        where: { tenantId: auth.tenantId, code },
      });
      return reply.code(200).send({ borrado: count > 0 });
    },
  );
}
