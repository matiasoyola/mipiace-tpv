// calidad-1 (D-70 a D-75) · **LAS RUTAS DE CALIDAD.**
//
// El mapa:
//
//   1. `GET    /residencia/procesos`               — el mapa entero, con
//      lo que cuelga de cada proceso contado.
//   2. `POST   /residencia/procesos/cargar-mapa`   — el de referencia,
//      de una vez (D-70).
//   3. `POST   /residencia/procesos`               — añadir uno.
//   4. `PUT    /residencia/procesos/:id`           — renombrar, cambiar
//      tipo o responsable.
//   5. `GET    /residencia/procesos/:id`           — un proceso abierto,
//      con TODO lo que le cuelga.
//   6. `POST   /residencia/procesos/:id/reasignar` — mover lo que cuelga
//      a otro proceso.
//   7. `POST   /residencia/procesos/:id/desactivar`
//
// Riesgos y objetivos:
//
//   8. `POST   /residencia/riesgos` · 9. `PUT /residencia/riesgos/:id`
//  10. `POST   /residencia/riesgos/:id/revisar`
//  11. `POST   /residencia/objetivos` · 12. `PUT /residencia/objetivos/:id`
//
// Las no conformidades:
//
//  13. `GET    /residencia/no-conformidades`        — la lista filtrable.
//  14. `POST   /residencia/no-conformidades`        — abrir (D-73).
//  15. `GET    /residencia/no-conformidades/:id`    — el expediente.
//  16. `POST   /residencia/no-conformidades/:id/causa`
//  17. `POST   /residencia/no-conformidades/:id/estado`
//  18. `POST   /residencia/no-conformidades/:id/acciones`
//  19. `POST   /residencia/acciones/:id/cerrar`
//  20. `POST   /residencia/acciones/:id/evidencias`
//  21. `GET    /residencia/evidencias/:id/fichero`
//  22. `POST   /residencia/no-conformidades/:id/verificar`
//  23. `POST   /residencia/no-conformidades/:id/informe` (y su `GET`)
//  24. `PUT    /residencia/no-conformidades/:id/proceso` — reasignar una.
//
// ── QUIÉN ENTRA ─────────────────────────────────────────────────────
//
// Las de LEER, la misma puerta que el panel: dirección o el OWNER. Las
// de ESCRIBIR sobre una no conformidad, además, **categoría `DIRECTIVO`
// o el rol `CALIDAD`** (D-73) — y de ahí sale la capacidad con la que se
// firma cada fila, que no es un detalle: en Jardín de Gredos quien lleva
// la calidad es la terapeuta ocupacional con el rol `CALIDAD`, no la
// directora.
//
// ── Y TODAS LAS QUE LEEN TEXTO DESCIFRADO PIDEN EL CONTRATO ─────────
//
// `negativaClinica("LEER")`. Una NC puede nombrar a un residente (D-73),
// así que el expediente y el PAC están bajo el mismo 423 que la historia
// clínica cuando el contrato de encargado tiene una versión sin aceptar.
// Lo que NO lo pide es el mapa: un proceso y un riesgo van en claro y no
// nombran a nadie.

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  RouteShorthandOptions,
} from "fastify";

import { requireOwnerOrManager } from "../auth/middleware.js";
import { asegurarDek, dekONada } from "../clinica/claves.js";
import { negativaClinica } from "../clinica/contrato.js";
import { ensureClinicaEnabled } from "../clinica/gate.js";
import {
  FotoInvalida,
  decodificarEvidencia,
  guardarFichero,
  leerFichero,
  MIME_DE_PDF,
} from "../clinica/ficheros.js";
import {
  leerTexto,
  sitioCausaDeNc,
  sitioCierreDeAccionCorrectiva,
  sitioDescripcionDeNc,
  sitioNotaDeEvidencia,
  sitioNotaDeVerificacion,
  sitioTextoDeAccionCorrectiva,
} from "../clinica/cripto-campos.js";
import { getPrisma } from "../context.js";
import {
  bandaDeRiesgo,
  nivelDeRiesgo,
  revisionVencida,
  utcToWallDate,
} from "@mipiacetpv/residencia-plan";

import {
  CalidadInvalida,
  abrirNc,
  analizarCausa,
  anotarEvidencia,
  avanzarCiclo,
  capacidadDeCalidad,
  cargarMapaDeReferencia,
  cerrarAccion,
  desactivarProceso,
  escribirAccion,
  estadoDelCiclo,
  loQueCuelgaDe,
  reasignarProceso,
  verificarEficacia,
  type Firma,
} from "./calidad.js";
import { ensureResidenciaEnabled } from "./gate.js";
import { registrarPacRoutes } from "./pac-routes.js";

/** La misma de `panel-routes.ts`, y por la misma razón. */
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
    select: { careRole: { select: { category: true, code: true, active: true } } },
  });
  const puede = roles
    .map((r) => r.careRole)
    .some((r) => r.active && (r.category === "DIRECTIVO" || r.code === "CALIDAD"));
  if (!puede) {
    return {
      error: "CALIDAD_ES_DE_DIRECCION",
      message:
        "El mapa de procesos y las no conformidades los ven la dirección y quien tenga el rol de calidad. Pídeselo a la dirección en Personal.",
    };
  }
  return null;
}

export async function registerResidenciaCalidadRoutes(
  app: FastifyInstance,
): Promise<void> {
  const puerta = {
    preHandler: [requireOwnerOrManager, ensureClinicaEnabled, ensureResidenciaEnabled],
  };

  /** Comprueba la puerta y contesta ella misma si no pasa. `true` = ya
   *  contestó. Copia del idiom de `obligaciones-routes.ts`. */
  async function sinPaso(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<boolean> {
    const auth = request.auth!;
    const negativa = await negativaDeDireccion(
      auth.tenantId,
      auth.userId,
      auth.role === "OWNER",
    );
    if (negativa) {
      await reply.code(403).send(negativa);
      return true;
    }
    return false;
  }

  /** Y el contrato de encargado, para lo que descifra texto. */
  async function sinContrato(
    tenantId: string,
    reply: FastifyReply,
  ): Promise<boolean> {
    const contrato = await negativaClinica(tenantId, "LEER");
    if (contrato) {
      await reply
        .code(423)
        .send({ error: contrato.code, code: contrato.code, message: contrato.message });
      return true;
    }
    return false;
  }

  /**
   * La firma de quien escribe en calidad: persona + capacidad (D-31).
   *
   * El OWNER sin rol de cuidado **no puede firmar**, y es deliberado: lo
   * que una no conformidad guarda no es «lo hizo el dueño de la cuenta»
   * sino «lo hizo Ana Isabel como responsable de calidad», que es lo que
   * un auditor lee. Quien dirige el centro tiene su rol `DIRECCION`
   * (D-61) y firma con él.
   */
  async function firmaDeCalidad(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<Firma | null> {
    const auth = request.auth!;
    const cap = await capacidadDeCalidad(
      getPrisma(),
      auth.tenantId,
      auth.userId,
      new Date(),
    );
    if (cap == null) {
      await reply.code(403).send({
        error: "SIN_CAPACIDAD_DE_CALIDAD",
        message:
          "Para abrir y trabajar una no conformidad hace falta un rol de cuidado de categoría directiva o el rol de calidad, vigente hoy. Se asigna en Personal.",
      });
      return null;
    }
    return { userId: auth.userId, careRoleAssignmentId: cap.assignmentId };
  }

  /** Traduce el error de negocio a su HTTP. Una sola vez. */
  async function traducir(
    err: unknown,
    reply: FastifyReply,
  ): Promise<FastifyReply> {
    if (err instanceof CalidadInvalida) {
      // 409 y no 400: lo que falla no es la forma del cuerpo —de eso ya
      // se ocupa el esquema de Fastify— sino el estado del expediente.
      const esNoEncontrado = err.codigo.endsWith("_NO_ENCONTRADA") ||
        err.codigo.endsWith("_NO_ENCONTRADO");
      return reply
        .code(esNoEncontrado ? 404 : 409)
        .send({ error: err.codigo, message: err.message });
    }
    throw err;
  }

  // ════════════════════════════════════════════════════════════════
  //  1 · `GET /residencia/procesos` · EL MAPA
  // ════════════════════════════════════════════════════════════════
  //
  // Con lo que cuelga de cada proceso **contado**, no traído: el mapa es
  // una pantalla de una pasada y traer los riesgos de los once procesos
  // para pintar «3» sería mandarle al navegador el registro entero.
  app.get("/residencia/procesos", puerta, async (request, reply) => {
    if (await sinPaso(request, reply)) return;
    const auth = request.auth!;
    const prisma = getPrisma();
    const hoy = utcToWallDate(new Date());

    const [procesos, riesgos, objetivos, ncs, indicadores] = await Promise.all([
      prisma.process.findMany({
        where: { tenantId: auth.tenantId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
          purpose: true,
          referenceCode: true,
          active: true,
          sortOrder: true,
          responsibleCareRole: { select: { id: true, name: true, active: true } },
        },
      }),
      prisma.riskOpportunity.groupBy({
        by: ["processId", "kind"],
        where: { tenantId: auth.tenantId, active: true },
        _count: { _all: true },
        _max: { level: true },
      }),
      prisma.qualityObjective.groupBy({
        by: ["processId"],
        where: { tenantId: auth.tenantId, status: "OPEN" },
        _count: { _all: true },
      }),
      prisma.nonConformity.groupBy({
        by: ["processId"],
        where: { tenantId: auth.tenantId, state: { not: "CLOSED" } },
        _count: { _all: true },
      }),
      prisma.indicatorProcess.groupBy({
        by: ["processId"],
        where: { tenantId: auth.tenantId },
        _count: { _all: true },
      }),
      ]);

    const vencidas = await prisma.riskOpportunity.groupBy({
      by: ["processId"],
      where: { tenantId: auth.tenantId, active: true, reviewAt: { lt: hoy } },
      _count: { _all: true },
    });

    const cuenta = <T extends { processId: string; _count: { _all: number } }>(
      filas: T[],
    ): Map<string, number> =>
      new Map(filas.map((f) => [f.processId, f._count._all]));
    const nObjetivos = cuenta(objetivos);
    const nNc = cuenta(ncs);
    const nIndicadores = cuenta(indicadores);
    const nVencidas = cuenta(vencidas);

    return reply.code(200).send({
      procesos: procesos.map((p) => {
        const suyos = riesgos.filter((r) => r.processId === p.id);
        const nivelMaximo = suyos.reduce(
          (m, r) => Math.max(m, r._max.level ?? 0),
          0,
        );
        return {
          id: p.id,
          code: p.code,
          nombre: p.name,
          tipo: p.type,
          proposito: p.purpose,
          deReferencia: p.referenceCode != null,
          activo: p.active,
          orden: p.sortOrder,
          responsable: {
            id: p.responsibleCareRole.id,
            nombre: p.responsibleCareRole.name,
            activo: p.responsibleCareRole.active,
          },
          cuelgan: {
            riesgos: suyos
              .filter((r) => r.kind === "RISK")
              .reduce((n, r) => n + r._count._all, 0),
            oportunidades: suyos
              .filter((r) => r.kind === "OPPORTUNITY")
              .reduce((n, r) => n + r._count._all, 0),
            objetivos: nObjetivos.get(p.id) ?? 0,
            noConformidades: nNc.get(p.id) ?? 0,
            indicadores: nIndicadores.get(p.id) ?? 0,
            revisionesVencidas: nVencidas.get(p.id) ?? 0,
          },
          // La banda más alta de sus riesgos: es lo que colorea la
          // tarjeta en el mapa, y lo que hace que un auditor vea de un
          // vistazo dónde está lo gordo.
          bandaMaxima: nivelMaximo === 0 ? null : bandaDeRiesgo(nivelMaximo),
        };
      }),
      // Lo que la pantalla necesita para el desplegable de responsable
      // sin una segunda llamada.
      roles: await prisma.careRole.findMany({
        where: { tenantId: auth.tenantId, active: true },
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true, category: true },
      }),
    });
  });

  // ════════════════════════════════════════════════════════════════
  //  2 · `POST /residencia/procesos/cargar-mapa`
  // ════════════════════════════════════════════════════════════════
  app.post("/residencia/procesos/cargar-mapa", puerta, async (request, reply) => {
    if (await sinPaso(request, reply)) return;
    const auth = request.auth!;
    try {
      const r = await cargarMapaDeReferencia(
        getPrisma(),
        auth.tenantId,
        auth.userId,
        utcToWallDate(new Date()),
      );
      return reply.code(201).send(r);
    } catch (err) {
      return traducir(err, reply);
    }
  });

  // ════════════════════════════════════════════════════════════════
  //  3 y 4 · AÑADIR Y EDITAR UN PROCESO
  // ════════════════════════════════════════════════════════════════
  const CUERPO_DE_PROCESO = {
    type: "object",
    required: ["name", "type", "responsibleCareRoleId"],
    additionalProperties: false,
    properties: {
      name: { type: "string", minLength: 1, maxLength: 120 },
      type: { type: "string", enum: ["STRATEGIC", "OPERATIONAL", "SUPPORT"] },
      purpose: { type: ["string", "null"], maxLength: 500 },
      responsibleCareRoleId: { type: "string", format: "uuid" },
      sortOrder: { type: "integer", minimum: 0, maximum: 10000 },
    },
  } as const;

  app.post(
    "/residencia/procesos",
    { ...puerta, schema: { body: CUERPO_DE_PROCESO } },
    async (request, reply) => {
      if (await sinPaso(request, reply)) return;
      const auth = request.auth!;
      const cuerpo = request.body as {
        name: string;
        type: "STRATEGIC" | "OPERATIONAL" | "SUPPORT";
        purpose?: string | null;
        responsibleCareRoleId: string;
        sortOrder?: number;
      };
      const prisma = getPrisma();
      const rol = await prisma.careRole.findFirst({
        where: { id: cuerpo.responsibleCareRoleId, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (rol == null) {
        return reply.code(400).send({
          error: "ROL_NO_ENCONTRADO",
          message: "Ese rol de cuidado no existe en este centro.",
        });
      }
      // El código sale del nombre: lo que el centro escribe es el nombre,
      // y pedirle además un código sería pedirle que invente una clave
      // primaria. Si choca, se le añade un sufijo — dos procesos con el
      // mismo nombre son cosa suya, dos con el mismo código no cabrían.
      const base = normalizarCodigo(cuerpo.name);
      let code = base;
      for (let i = 2; i < 50; i++) {
        const choca = await prisma.process.findFirst({
          where: { tenantId: auth.tenantId, code },
          select: { id: true },
        });
        if (choca == null) break;
        code = `${base}_${i}`;
      }
      const creado = await prisma.process.create({
        data: {
          tenantId: auth.tenantId,
          code,
          name: cuerpo.name,
          type: cuerpo.type,
          purpose: cuerpo.purpose ?? null,
          responsibleCareRoleId: cuerpo.responsibleCareRoleId,
          sortOrder: cuerpo.sortOrder ?? 500,
          createdByUserId: auth.userId,
        },
        select: { id: true, code: true },
      });
      return reply.code(201).send({ proceso: creado });
    },
  );

  app.put(
    "/residencia/procesos/:id",
    {
      ...puerta,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: CUERPO_DE_PROCESO,
      },
    },
    async (request, reply) => {
      if (await sinPaso(request, reply)) return;
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const cuerpo = request.body as {
        name: string;
        type: "STRATEGIC" | "OPERATIONAL" | "SUPPORT";
        purpose?: string | null;
        responsibleCareRoleId: string;
        sortOrder?: number;
      };
      const prisma = getPrisma();
      const { count } = await prisma.process.updateMany({
        where: { id, tenantId: auth.tenantId },
        data: {
          // **El código NO se toca al renombrar.** Es lo que ata lo que
          // el centro ya escribió; renombrar «Atención sanitaria» a
          // «Enfermería» no lo convierte en otro proceso.
          name: cuerpo.name,
          type: cuerpo.type,
          purpose: cuerpo.purpose ?? null,
          responsibleCareRoleId: cuerpo.responsibleCareRoleId,
          ...(cuerpo.sortOrder != null ? { sortOrder: cuerpo.sortOrder } : {}),
        },
      });
      if (count === 0) {
        return reply.code(404).send({
          error: "PROCESO_NO_ENCONTRADO",
          message: "Ese proceso no existe en este centro.",
        });
      }
      return reply.code(200).send({ ok: true });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  5 · `GET /residencia/procesos/:id` · CON TODO LO QUE LE CUELGA
  // ════════════════════════════════════════════════════════════════
  app.get(
    "/residencia/procesos/:id",
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
    async (request, reply) => {
      if (await sinPaso(request, reply)) return;
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      // Lleva las NC, que llevan descripción cifrada.
      if (await sinContrato(auth.tenantId, reply)) return;

      const prisma = getPrisma();
      const hoy = utcToWallDate(new Date());
      const proceso = await prisma.process.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: {
          id: true,
          code: true,
          name: true,
          type: true,
          purpose: true,
          referenceCode: true,
          active: true,
          sortOrder: true,
          responsibleCareRole: { select: { id: true, name: true } },
        },
      });
      if (proceso == null) {
        return reply.code(404).send({
          error: "PROCESO_NO_ENCONTRADO",
          message: "Ese proceso no existe en este centro.",
        });
      }

      const dek = await dekONada(auth.tenantId, prisma);
      const [riesgos, objetivos, ncs, indicadores] = await Promise.all([
        prisma.riskOpportunity.findMany({
          where: { tenantId: auth.tenantId, processId: id },
          orderBy: [{ active: "desc" }, { level: "desc" }, { reviewAt: "asc" }],
          select: {
            id: true,
            kind: true,
            code: true,
            description: true,
            probability: true,
            impact: true,
            level: true,
            plannedAction: true,
            reviewAt: true,
            reviewedAt: true,
            isoClause: true,
            active: true,
          },
        }),
        prisma.qualityObjective.findMany({
          where: { tenantId: auth.tenantId, processId: id },
          orderBy: [{ year: "desc" }, { name: "asc" }],
          select: {
            id: true,
            year: true,
            name: true,
            target: true,
            status: true,
            indicatorCode: true,
            progressNote: true,
            isoClause: true,
          },
        }),
        prisma.nonConformity.findMany({
          where: { tenantId: auth.tenantId, processId: id },
          orderBy: [{ detectedOn: "desc" }],
          take: 50,
          select: {
            id: true,
            tenantId: true,
            reference: true,
            kind: true,
            origin: true,
            state: true,
            detectedOn: true,
            descriptionCifrado: true,
          },
        }),
        prisma.indicatorProcess.findMany({
          where: { tenantId: auth.tenantId, processId: id },
          select: { code: true },
        }),
      ]);

      return reply.code(200).send({
        proceso: {
          id: proceso.id,
          code: proceso.code,
          nombre: proceso.name,
          tipo: proceso.type,
          proposito: proceso.purpose,
          deReferencia: proceso.referenceCode != null,
          activo: proceso.active,
          orden: proceso.sortOrder,
          responsable: proceso.responsibleCareRole,
        },
        riesgos: riesgos.map((r) => ({
          id: r.id,
          tipo: r.kind,
          deSerie: r.code != null,
          descripcion: r.description,
          probabilidad: r.probability,
          impacto: r.impact,
          nivel: r.level,
          banda: bandaDeRiesgo(r.level),
          accionPrevista: r.plannedAction,
          reviewAt: r.reviewAt,
          vencida: r.active && revisionVencida(r.reviewAt, hoy),
          revisadoEn: r.reviewedAt?.toISOString() ?? null,
          isoClause: r.isoClause,
          activo: r.active,
        })),
        objetivos: objetivos.map((o) => ({
          id: o.id,
          anio: o.year,
          nombre: o.name,
          meta: o.target,
          estado: o.status,
          indicatorCode: o.indicatorCode,
          nota: o.progressNote,
          isoClause: o.isoClause,
        })),
        noConformidades: ncs.map((n) => ({
          id: n.id,
          referencia: n.reference,
          clase: n.kind,
          origen: n.origin,
          estado: n.state,
          detectedOn: n.detectedOn,
          descripcion: leerTexto(
            { cifrado: n.descriptionCifrado, claro: null },
            dek,
            sitioDescripcionDeNc(n.tenantId, n.id),
          ),
        })),
        indicadores: indicadores.map((i) => i.code),
      });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  6 y 7 · REASIGNAR Y DESACTIVAR
  // ════════════════════════════════════════════════════════════════
  app.post(
    "/residencia/procesos/:id/reasignar",
    {
      ...puerta,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["aProcesoId"],
          additionalProperties: false,
          properties: { aProcesoId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      if (await sinPaso(request, reply)) return;
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const { aProcesoId } = request.body as { aProcesoId: string };
      try {
        const movido = await reasignarProceso(
          getPrisma(),
          auth.tenantId,
          id,
          aProcesoId,
          auth.userId,
        );
        return reply.code(200).send({ movido });
      } catch (err) {
        return traducir(err, reply);
      }
    },
  );

  app.post(
    "/residencia/procesos/:id/desactivar",
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
    async (request, reply) => {
      if (await sinPaso(request, reply)) return;
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();
      const existe = await prisma.process.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (existe == null) {
        return reply.code(404).send({
          error: "PROCESO_NO_ENCONTRADO",
          message: "Ese proceso no existe en este centro.",
        });
      }
      try {
        await desactivarProceso(prisma, auth.tenantId, id);
        return reply.code(200).send({ ok: true });
      } catch (err) {
        if (err instanceof CalidadInvalida) {
          const cuelga = await loQueCuelgaDe(prisma, auth.tenantId, id);
          return reply
            .code(409)
            .send({ error: err.codigo, message: err.message, cuelga });
        }
        throw err;
      }
    },
  );

  await registrarRutasDeRiesgo(app, puerta, sinPaso);
  await registrarRutasDeNc(app, puerta, sinPaso, sinContrato, firmaDeCalidad, traducir);
  await registrarPacRoutes(app, puerta, sinPaso, sinContrato);
}

/** «Atención sanitaria» → `ATENCION_SANITARIA`. Sin tildes y sin ñ: el
 *  código se teclea en una URL y en un filtro. */
export function normalizarCodigo(nombre: string): string {
  const sinTildes = nombre
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ñ/gi, "n");
  const limpio = sinTildes
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 50);
  // Un nombre de sólo emojis dejaría el código vacío y el CHECK
  // `processes_code_no_vacio` lo rechazaría con un 500.
  return limpio === "" ? "PROCESO" : limpio;
}

type Puerta = Pick<RouteShorthandOptions, "preHandler">;
type SinPaso = (r: FastifyRequest, p: FastifyReply) => Promise<boolean>;
type SinContrato = (t: string, p: FastifyReply) => Promise<boolean>;
type FirmaDe = (r: FastifyRequest, p: FastifyReply) => Promise<Firma | null>;
type Traducir = (err: unknown, reply: FastifyReply) => Promise<FastifyReply>;

// ════════════════════════════════════════════════════════════════════
//  8 a 12 · RIESGOS, OPORTUNIDADES Y OBJETIVOS
// ════════════════════════════════════════════════════════════════════

async function registrarRutasDeRiesgo(
  app: FastifyInstance,
  puerta: Puerta,
  sinPaso: SinPaso,
): Promise<void> {
  const CUERPO_DE_RIESGO = {
    type: "object",
    required: ["processId", "kind", "description", "probability", "impact", "reviewAt"],
    additionalProperties: false,
    properties: {
      processId: { type: "string", format: "uuid" },
      kind: { type: "string", enum: ["RISK", "OPPORTUNITY"] },
      description: { type: "string", minLength: 1, maxLength: 2000 },
      probability: { type: "integer", minimum: 1, maximum: 3 },
      impact: { type: "integer", minimum: 1, maximum: 3 },
      plannedAction: { type: ["string", "null"], maxLength: 2000 },
      reviewAt: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
      isoClause: { type: ["string", "null"], maxLength: 20 },
      active: { type: "boolean" },
    },
  } as const;

  interface CuerpoDeRiesgo {
    processId: string;
    kind: "RISK" | "OPPORTUNITY";
    description: string;
    probability: number;
    impact: number;
    plannedAction?: string | null;
    reviewAt: string;
    isoClause?: string | null;
    active?: boolean;
  }

  app.post(
    "/residencia/riesgos",
    { ...puerta, schema: { body: CUERPO_DE_RIESGO } },
    async (request, reply) => {
      if (await sinPaso(request, reply)) return;
      const auth = request.auth!;
      const c = request.body as CuerpoDeRiesgo;
      const prisma = getPrisma();
      const proceso = await prisma.process.findFirst({
        where: { id: c.processId, tenantId: auth.tenantId, active: true },
        select: { id: true },
      });
      if (proceso == null) {
        return reply.code(400).send({
          error: "PROCESO_NO_ENCONTRADO",
          message:
            "Un riesgo cuelga siempre de un proceso activo del mapa de este centro.",
        });
      }
      const creado = await prisma.riskOpportunity.create({
        data: {
          tenantId: auth.tenantId,
          processId: c.processId,
          kind: c.kind,
          description: c.description,
          probability: c.probability,
          impact: c.impact,
          // El nivel lo calcula el producto y lo vuelve a comprobar el
          // CHECK de la migración. Dos redes, y la segunda es la que
          // sujeta un `UPDATE` por SQL.
          level: nivelDeRiesgo(c.probability, c.impact),
          plannedAction: c.plannedAction ?? null,
          reviewAt: c.reviewAt,
          isoClause: c.isoClause ?? null,
          createdByUserId: auth.userId,
        },
        select: { id: true, level: true },
      });
      return reply
        .code(201)
        .send({ riesgo: { ...creado, banda: bandaDeRiesgo(creado.level) } });
    },
  );

  app.put(
    "/residencia/riesgos/:id",
    {
      ...puerta,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: CUERPO_DE_RIESGO,
      },
    },
    async (request, reply) => {
      if (await sinPaso(request, reply)) return;
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const c = request.body as CuerpoDeRiesgo;
      const { count } = await getPrisma().riskOpportunity.updateMany({
        where: { id, tenantId: auth.tenantId },
        data: {
          processId: c.processId,
          kind: c.kind,
          description: c.description,
          probability: c.probability,
          impact: c.impact,
          level: nivelDeRiesgo(c.probability, c.impact),
          plannedAction: c.plannedAction ?? null,
          reviewAt: c.reviewAt,
          isoClause: c.isoClause ?? null,
          ...(c.active != null ? { active: c.active } : {}),
        },
      });
      if (count === 0) {
        return reply.code(404).send({
          error: "RIESGO_NO_ENCONTRADO",
          message: "Ese riesgo no existe en este centro.",
        });
      }
      return reply.code(200).send({ ok: true });
    },
  );

  /**
   * **REVISAR UN RIESGO ES FIRMAR, NO MOVER UNA FECHA.**
   *
   * Pone `reviewedAt` y `reviewedByUserId` a la vez que la próxima
   * fecha, y el CHECK `risk_opportunities_revision_completa` no deja
   * una sin la otra. Sin esto, «revisado» sería un botón que empuja la
   * fecha seis meses y nadie sabría quién lo pulsó.
   */
  app.post(
    "/residencia/riesgos/:id/revisar",
    {
      ...puerta,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["proximaRevision"],
          additionalProperties: false,
          properties: {
            proximaRevision: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
            probability: { type: "integer", minimum: 1, maximum: 3 },
            impact: { type: "integer", minimum: 1, maximum: 3 },
          },
        },
      },
    },
    async (request, reply) => {
      if (await sinPaso(request, reply)) return;
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const c = request.body as {
        proximaRevision: string;
        probability?: number;
        impact?: number;
      };
      const prisma = getPrisma();
      const riesgo = await prisma.riskOpportunity.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: { id: true, probability: true, impact: true },
      });
      if (riesgo == null) {
        return reply.code(404).send({
          error: "RIESGO_NO_ENCONTRADO",
          message: "Ese riesgo no existe en este centro.",
        });
      }
      const probability = c.probability ?? riesgo.probability;
      const impact = c.impact ?? riesgo.impact;
      await prisma.riskOpportunity.update({
        where: { id },
        data: {
          probability,
          impact,
          level: nivelDeRiesgo(probability, impact),
          reviewAt: c.proximaRevision,
          reviewedAt: new Date(),
          reviewedByUserId: auth.userId,
        },
      });
      return reply.code(200).send({ ok: true });
    },
  );

  // ── Los objetivos de calidad ───────────────────────────────────────
  const CUERPO_DE_OBJETIVO = {
    type: "object",
    required: ["processId", "year", "name", "target"],
    additionalProperties: false,
    properties: {
      processId: { type: "string", format: "uuid" },
      year: { type: "integer", minimum: 2000, maximum: 2100 },
      name: { type: "string", minLength: 1, maxLength: 200 },
      target: { type: "string", minLength: 1, maxLength: 500 },
      status: { type: "string", enum: ["OPEN", "MET", "NOT_MET", "CANCELLED"] },
      indicatorCode: { type: ["string", "null"], maxLength: 60 },
      progressNote: { type: ["string", "null"], maxLength: 2000 },
      isoClause: { type: ["string", "null"], maxLength: 20 },
    },
  } as const;

  interface CuerpoDeObjetivo {
    processId: string;
    year: number;
    name: string;
    target: string;
    status?: "OPEN" | "MET" | "NOT_MET" | "CANCELLED";
    indicatorCode?: string | null;
    progressNote?: string | null;
    isoClause?: string | null;
  }

  app.post(
    "/residencia/objetivos",
    { ...puerta, schema: { body: CUERPO_DE_OBJETIVO } },
    async (request, reply) => {
      if (await sinPaso(request, reply)) return;
      const auth = request.auth!;
      const c = request.body as CuerpoDeObjetivo;
      const prisma = getPrisma();
      const proceso = await prisma.process.findFirst({
        where: { id: c.processId, tenantId: auth.tenantId, active: true },
        select: { id: true },
      });
      if (proceso == null) {
        return reply.code(400).send({
          error: "PROCESO_NO_ENCONTRADO",
          message:
            "Un objetivo de calidad cuelga siempre de un proceso activo del mapa.",
        });
      }
      const creado = await prisma.qualityObjective.create({
        data: {
          tenantId: auth.tenantId,
          processId: c.processId,
          year: c.year,
          name: c.name,
          target: c.target,
          status: c.status ?? "OPEN",
          indicatorCode: c.indicatorCode ?? null,
          progressNote: c.progressNote ?? null,
          isoClause: c.isoClause ?? null,
          createdByUserId: auth.userId,
        },
        select: { id: true },
      });
      return reply.code(201).send({ objetivo: creado });
    },
  );

  app.put(
    "/residencia/objetivos/:id",
    {
      ...puerta,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: CUERPO_DE_OBJETIVO,
      },
    },
    async (request, reply) => {
      if (await sinPaso(request, reply)) return;
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const c = request.body as CuerpoDeObjetivo;
      const { count } = await getPrisma().qualityObjective.updateMany({
        where: { id, tenantId: auth.tenantId },
        data: {
          processId: c.processId,
          year: c.year,
          name: c.name,
          target: c.target,
          ...(c.status != null ? { status: c.status } : {}),
          indicatorCode: c.indicatorCode ?? null,
          progressNote: c.progressNote ?? null,
          isoClause: c.isoClause ?? null,
        },
      });
      if (count === 0) {
        return reply.code(404).send({
          error: "OBJETIVO_NO_ENCONTRADO",
          message: "Ese objetivo no existe en este centro.",
        });
      }
      return reply.code(200).send({ ok: true });
    },
  );
}

// ════════════════════════════════════════════════════════════════════
//  13 a 24 · LAS NO CONFORMIDADES
// ════════════════════════════════════════════════════════════════════

async function registrarRutasDeNc(
  app: FastifyInstance,
  puerta: Puerta,
  sinPaso: SinPaso,
  sinContrato: SinContrato,
  firmaDeCalidad: FirmaDe,
  traducir: Traducir,
): Promise<void> {
  const ORIGENES = [
    "INTERNAL_AUDIT",
    "EXTERNAL_AUDIT",
    "INSPECTION",
    "INCIDENT",
    "COMPLAINT",
    "INDICATOR",
    "MANAGEMENT_REVIEW",
    "OTHER",
  ] as const;

  // ── 13 · La lista ─────────────────────────────────────────────────
  app.get(
    "/residencia/no-conformidades",
    {
      ...puerta,
      schema: {
        querystring: {
          type: "object",
          properties: {
            estado: { type: "string" },
            clase: { type: "string" },
            origen: { type: "string" },
            procesoId: { type: "string", format: "uuid" },
            desde: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
            hasta: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
            abiertas: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      if (await sinPaso(request, reply)) return;
      const auth = request.auth!;
      if (await sinContrato(auth.tenantId, reply)) return;
      const q = request.query as Record<string, string | undefined>;
      const prisma = getPrisma();
      const dek = await dekONada(auth.tenantId, prisma);
      const hoy = utcToWallDate(new Date());

      const filas = await prisma.nonConformity.findMany({
        where: {
          tenantId: auth.tenantId,
          ...(q.estado ? { state: q.estado as never } : {}),
          ...(q.clase ? { kind: q.clase as never } : {}),
          ...(q.origen ? { origin: q.origen as never } : {}),
          ...(q.procesoId ? { processId: q.procesoId } : {}),
          ...(q.abiertas === "1" ? { state: { not: "CLOSED" } } : {}),
          ...(q.desde || q.hasta
            ? {
                detectedOn: {
                  ...(q.desde ? { gte: q.desde } : {}),
                  ...(q.hasta ? { lte: q.hasta } : {}),
                },
              }
            : {}),
        },
        orderBy: [{ detectedOn: "desc" }, { reference: "desc" }],
        take: 300,
        select: {
          id: true,
          tenantId: true,
          reference: true,
          kind: true,
          origin: true,
          state: true,
          detectedOn: true,
          isoClause: true,
          descriptionCifrado: true,
          closedAt: true,
          process: { select: { id: true, name: true } },
          _count: { select: { actions: true, verifications: true } },
        },
      });

      // Las acciones vencidas de cada una, en una sola consulta: pedirlas
      // por NC habría sido trescientas idas a la base para pintar un
      // punto rojo.
      const vencidas = await prisma.correctiveAction.groupBy({
        by: ["nonConformityId"],
        where: {
          tenantId: auth.tenantId,
          closedAt: null,
          dueOn: { lt: hoy },
          nonConformityId: { in: filas.map((f) => f.id) },
        },
        _count: { _all: true },
      });
      const nVencidas = new Map(
        vencidas.map((v) => [v.nonConformityId, v._count._all]),
      );

      return reply.code(200).send({
        noConformidades: filas.map((n) => ({
          id: n.id,
          referencia: n.reference,
          clase: n.kind,
          origen: n.origin,
          estado: n.state,
          detectedOn: n.detectedOn,
          isoClause: n.isoClause,
          proceso: n.process,
          cerradaEn: n.closedAt?.toISOString() ?? null,
          acciones: n._count.actions,
          verificaciones: n._count.verifications,
          accionesVencidas: nVencidas.get(n.id) ?? 0,
          descripcion: leerTexto(
            { cifrado: n.descriptionCifrado, claro: null },
            dek,
            sitioDescripcionDeNc(n.tenantId, n.id),
          ),
        })),
      });
    },
  );

  // ── 14 · Abrir ────────────────────────────────────────────────────
  app.post(
    "/residencia/no-conformidades",
    {
      ...puerta,
      schema: {
        body: {
          type: "object",
          required: ["processId", "kind", "origin", "detectedOn", "descripcion"],
          additionalProperties: false,
          properties: {
            processId: { type: "string", format: "uuid" },
            kind: {
              type: "string",
              enum: ["MAJOR", "MINOR", "OBSERVATION", "IMPROVEMENT"],
            },
            origin: { type: "string", enum: ORIGENES },
            detectedOn: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
            descripcion: { type: "string", minLength: 1, maxLength: 4000 },
            isoClause: { type: ["string", "null"], maxLength: 20 },
            sourceIncidentId: { type: ["string", "null"], format: "uuid" },
            sourceIndicatorCode: { type: ["string", "null"], maxLength: 60 },
            sourceIndicatorMonth: {
              type: ["string", "null"],
              pattern: "^[0-9]{4}-[0-9]{2}$",
            },
            sourceNote: { type: ["string", "null"], maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      if (await sinPaso(request, reply)) return;
      const auth = request.auth!;
      const firma = await firmaDeCalidad(request, reply);
      if (firma == null) return;
      try {
        const nc = await abrirNc(
          getPrisma(),
          auth.tenantId,
          request.body as never,
          firma,
          new Date(),
        );
        return reply.code(201).send({ noConformidad: nc });
      } catch (err) {
        return traducir(err, reply);
      }
    },
  );

  // ── 15 · El expediente ────────────────────────────────────────────
  const soloId = {
    params: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string", format: "uuid" } },
    },
  } as const;

  app.get(
    "/residencia/no-conformidades/:id",
    { ...puerta, schema: soloId },
    async (request, reply) => {
      if (await sinPaso(request, reply)) return;
      const auth = request.auth!;
      if (await sinContrato(auth.tenantId, reply)) return;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();
      const dek = await dekONada(auth.tenantId, prisma);

      const n = await prisma.nonConformity.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: {
          id: true,
          tenantId: true,
          reference: true,
          kind: true,
          origin: true,
          state: true,
          isoClause: true,
          detectedOn: true,
          descriptionCifrado: true,
          causeCifrado: true,
          sourceIncidentId: true,
          sourceIndicatorCode: true,
          sourceIndicatorMonth: true,
          sourceNote: true,
          reportFileName: true,
          reportBytes: true,
          openedAt: true,
          closedAt: true,
          process: { select: { id: true, name: true, type: true } },
          openedBy: { select: { alias: true, email: true } },
          openedWith: { select: { careRole: { select: { name: true } } } },
          closedBy: { select: { alias: true, email: true } },
          sourceIncident: {
            select: { id: true, incidentType: true, subject: true, openedAt: true },
          },
        },
      });
      if (n == null) {
        return reply.code(404).send({
          error: "NC_NO_ENCONTRADA",
          message: "Esa no conformidad no existe en este centro.",
        });
      }

      const [acciones, verificaciones, ciclo] = await Promise.all([
        prisma.correctiveAction.findMany({
          where: { tenantId: auth.tenantId, nonConformityId: id },
          orderBy: { openedAt: "asc" },
          select: {
            id: true,
            tenantId: true,
            whatCifrado: true,
            closingNoteCifrado: true,
            dueOn: true,
            openedAt: true,
            closedAt: true,
            responsibleCareRole: { select: { name: true } },
            responsibleUser: { select: { alias: true, email: true } },
            responsibleLabel: true,
            closedBy: { select: { alias: true, email: true } },
            evidences: {
              orderBy: { at: "asc" },
              select: {
                id: true,
                tenantId: true,
                fileName: true,
                bytes: true,
                noteCifrado: true,
                at: true,
                by: { select: { alias: true, email: true } },
              },
            },
          },
        }),
        prisma.effectivenessVerification.findMany({
          where: { tenantId: auth.tenantId, nonConformityId: id },
          orderBy: { at: "asc" },
          select: {
            id: true,
            tenantId: true,
            result: true,
            noteCifrado: true,
            at: true,
            by: { select: { alias: true, email: true } },
            byWith: { select: { careRole: { select: { name: true } } } },
          },
        }),
        estadoDelCiclo(prisma, auth.tenantId, id),
      ]);

      const hoy = utcToWallDate(new Date());
      const quien = (u: { alias: string | null; email: string } | null): string =>
        u == null ? "—" : (u.alias ?? u.email.split("@")[0]!);

      return reply.code(200).send({
        noConformidad: {
          id: n.id,
          referencia: n.reference,
          clase: n.kind,
          origen: n.origin,
          estado: n.state,
          isoClause: n.isoClause,
          detectedOn: n.detectedOn,
          proceso: n.process,
          descripcion: leerTexto(
            { cifrado: n.descriptionCifrado, claro: null },
            dek,
            sitioDescripcionDeNc(n.tenantId, n.id),
          ),
          causa: leerTexto(
            { cifrado: n.causeCifrado, claro: null },
            dek,
            sitioCausaDeNc(n.tenantId, n.id),
          ),
          origenDetalle: {
            incidencia: n.sourceIncident,
            indicador: n.sourceIndicatorCode,
            mes: n.sourceIndicatorMonth,
            nota: n.sourceNote,
          },
          informe:
            n.reportFileName == null
              ? null
              : { bytes: n.reportBytes },
          abiertaEn: n.openedAt.toISOString(),
          abiertaPor: quien(n.openedBy),
          abiertaComo: n.openedWith.careRole.name,
          cerradaEn: n.closedAt?.toISOString() ?? null,
          cerradaPor: n.closedBy == null ? null : quien(n.closedBy),
        },
        acciones: acciones.map((a) => ({
          id: a.id,
          que: leerTexto(
            { cifrado: a.whatCifrado, claro: null },
            dek,
            sitioTextoDeAccionCorrectiva(a.tenantId, a.id),
          ),
          responsable:
            a.responsibleCareRole?.name ??
            (a.responsibleUser != null ? quien(a.responsibleUser) : null) ??
            a.responsibleLabel ??
            "—",
          dueOn: a.dueOn,
          vencida: a.closedAt == null && a.dueOn < hoy,
          abiertaEn: a.openedAt.toISOString(),
          cerradaEn: a.closedAt?.toISOString() ?? null,
          cerradaPor: a.closedBy == null ? null : quien(a.closedBy),
          notaDeCierre: leerTexto(
            { cifrado: a.closingNoteCifrado, claro: null },
            dek,
            sitioCierreDeAccionCorrectiva(a.tenantId, a.id),
          ),
          evidencias: a.evidences.map((e) => ({
            id: e.id,
            tieneFichero: e.fileName != null,
            bytes: e.bytes,
            nota: leerTexto(
              { cifrado: e.noteCifrado, claro: null },
              dek,
              sitioNotaDeEvidencia(e.tenantId, e.id),
            ),
            at: e.at.toISOString(),
            por: quien(e.by),
          })),
        })),
        verificaciones: verificaciones.map((v) => ({
          id: v.id,
          resultado: v.result,
          nota: leerTexto(
            { cifrado: v.noteCifrado, claro: null },
            dek,
            sitioNotaDeVerificacion(v.tenantId, v.id),
          ),
          at: v.at.toISOString(),
          por: quien(v.by),
          como: v.byWith.careRole.name,
        })),
        ciclo,
      });
    },
  );

  // ── 16 · La causa ─────────────────────────────────────────────────
  app.post(
    "/residencia/no-conformidades/:id/causa",
    {
      ...puerta,
      schema: {
        ...soloId,
        body: {
          type: "object",
          required: ["causa"],
          additionalProperties: false,
          properties: { causa: { type: "string", minLength: 1, maxLength: 4000 } },
        },
      },
    },
    async (request, reply) => {
      if (await sinPaso(request, reply)) return;
      const auth = request.auth!;
      const firma = await firmaDeCalidad(request, reply);
      if (firma == null) return;
      const { id } = request.params as { id: string };
      const { causa } = request.body as { causa: string };
      try {
        await analizarCausa(getPrisma(), auth.tenantId, id, causa);
        return reply.code(200).send({ ok: true });
      } catch (err) {
        return traducir(err, reply);
      }
    },
  );

  // ── 17 · Avanzar el ciclo ─────────────────────────────────────────
  app.post(
    "/residencia/no-conformidades/:id/estado",
    {
      ...puerta,
      schema: {
        ...soloId,
        body: {
          type: "object",
          required: ["estado"],
          additionalProperties: false,
          properties: {
            estado: {
              type: "string",
              enum: ["CAUSE_ANALYSED", "ACTIONS", "ACTIONS_CLOSED", "CLOSED"],
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (await sinPaso(request, reply)) return;
      const auth = request.auth!;
      const firma = await firmaDeCalidad(request, reply);
      if (firma == null) return;
      const { id } = request.params as { id: string };
      const { estado } = request.body as { estado: never };
      try {
        await avanzarCiclo(getPrisma(), auth.tenantId, id, estado);
        return reply.code(200).send({ ok: true });
      } catch (err) {
        return traducir(err, reply);
      }
    },
  );

  // ── 18 y 19 · Las acciones ────────────────────────────────────────
  app.post(
    "/residencia/no-conformidades/:id/acciones",
    {
      ...puerta,
      schema: {
        ...soloId,
        body: {
          type: "object",
          required: ["que", "dueOn"],
          additionalProperties: false,
          properties: {
            que: { type: "string", minLength: 1, maxLength: 4000 },
            dueOn: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
            responsibleCareRoleId: { type: ["string", "null"], format: "uuid" },
            responsibleUserId: { type: ["string", "null"], format: "uuid" },
            responsibleLabel: { type: ["string", "null"], maxLength: 80 },
          },
        },
      },
    },
    async (request, reply) => {
      if (await sinPaso(request, reply)) return;
      const auth = request.auth!;
      const firma = await firmaDeCalidad(request, reply);
      if (firma == null) return;
      const { id } = request.params as { id: string };
      try {
        const accionId = await escribirAccion(
          getPrisma(),
          auth.tenantId,
          id,
          request.body as never,
          firma,
          new Date(),
        );
        return reply.code(201).send({ accion: { id: accionId } });
      } catch (err) {
        return traducir(err, reply);
      }
    },
  );

  app.post(
    "/residencia/acciones/:id/cerrar",
    {
      ...puerta,
      schema: {
        ...soloId,
        body: {
          type: "object",
          additionalProperties: false,
          properties: { nota: { type: ["string", "null"], maxLength: 4000 } },
        },
      },
    },
    async (request, reply) => {
      if (await sinPaso(request, reply)) return;
      const auth = request.auth!;
      const firma = await firmaDeCalidad(request, reply);
      if (firma == null) return;
      const { id } = request.params as { id: string };
      const { nota } = (request.body ?? {}) as { nota?: string | null };
      try {
        await cerrarAccion(
          getPrisma(),
          auth.tenantId,
          id,
          nota ?? null,
          firma,
          new Date(),
        );
        return reply.code(200).send({ ok: true });
      } catch (err) {
        return traducir(err, reply);
      }
    },
  );

  // ── 20 y 21 · Las evidencias ──────────────────────────────────────
  //
  // **Primero el fichero, después la fila**, el orden de clinica-4: al
  // revés, un fallo al escribir el disco dejaría una fila que dice que
  // hay un PDF que no existe.
  app.post(
    "/residencia/acciones/:id/evidencias",
    {
      ...puerta,
      schema: {
        ...soloId,
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            nota: { type: ["string", "null"], maxLength: 2000 },
            pdfBase64: { type: ["string", "null"] },
          },
        },
      },
    },
    async (request, reply) => {
      if (await sinPaso(request, reply)) return;
      const auth = request.auth!;
      const firma = await firmaDeCalidad(request, reply);
      if (firma == null) return;
      const { id } = request.params as { id: string };
      const cuerpo = (request.body ?? {}) as {
        nota?: string | null;
        pdfBase64?: string | null;
      };
      const prisma = getPrisma();
      const accion = await prisma.correctiveAction.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (accion == null) {
        return reply.code(404).send({
          error: "ACCION_NO_ENCONTRADA",
          message: "Esa acción no existe en este centro.",
        });
      }

      let fichero = null as
        | { fileName: string; sha256: string; bytes: number; mimeType: string }
        | null;
      if (cuerpo.pdfBase64) {
        let pdf: Buffer;
        try {
          pdf = decodificarEvidencia({ pdfBase64: cuerpo.pdfBase64 });
        } catch (err) {
          if (err instanceof FotoInvalida) {
            return reply
              .code(400)
              .send({ error: "EVIDENCIA_INVALIDA", message: err.message });
          }
          throw err;
        }
        const dek = await asegurarDek(auth.tenantId, prisma);
        const guardado = await guardarFichero("EVIDENCIA", pdf, {
          tenantId: auth.tenantId,
          dek,
        });
        fichero = { ...guardado, mimeType: MIME_DE_PDF };
      }

      try {
        const evidenciaId = await anotarEvidencia(
          prisma,
          auth.tenantId,
          id,
          { nota: cuerpo.nota ?? null, fichero },
          firma,
          new Date(),
        );
        return reply.code(201).send({ evidencia: { id: evidenciaId } });
      } catch (err) {
        return traducir(err, reply);
      }
    },
  );

  app.get(
    "/residencia/evidencias/:id/fichero",
    { ...puerta, schema: soloId },
    async (request, reply) => {
      if (await sinPaso(request, reply)) return;
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();
      const fila = await prisma.correctiveActionEvidence.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: { fileName: true, sha256: true, mimeType: true },
      });
      if (fila?.fileName == null || fila.sha256 == null) {
        return reply.code(404).send({
          error: "SIN_FICHERO",
          message: "Esa evidencia no tiene documento adjunto.",
        });
      }
      const dek = await asegurarDek(auth.tenantId, prisma);
      const leido = await leerFichero("EVIDENCIA", fila.fileName, fila.sha256, {
        tenantId: auth.tenantId,
        dek,
      });
      if (leido == null) {
        return reply.code(404).send({
          error: "FICHERO_NO_ESTA",
          message:
            "El documento no está en el volumen. La fila lo nombra: avisa a Mi Piace.",
        });
      }
      // Huella que no cuadra: **se sirve igual con el aviso**, como el
      // consentimiento de clinica-4. Esconderlo sería borrar la pista.
      reply.header("content-type", fila.mimeType ?? MIME_DE_PDF);
      reply.header("x-huella-cuadra", leido.huellaCuadra ? "1" : "0");
      return reply.send(leido.contenido);
    },
  );

  // ── 22 · La verificación de eficacia ──────────────────────────────
  app.post(
    "/residencia/no-conformidades/:id/verificar",
    {
      ...puerta,
      schema: {
        ...soloId,
        body: {
          type: "object",
          required: ["resultado", "nota"],
          additionalProperties: false,
          properties: {
            resultado: { type: "string", enum: ["EFFECTIVE", "NOT_EFFECTIVE"] },
            nota: { type: "string", minLength: 1, maxLength: 4000 },
          },
        },
      },
    },
    async (request, reply) => {
      if (await sinPaso(request, reply)) return;
      const auth = request.auth!;
      const firma = await firmaDeCalidad(request, reply);
      if (firma == null) return;
      const { id } = request.params as { id: string };
      try {
        const r = await verificarEficacia(
          getPrisma(),
          auth.tenantId,
          id,
          request.body as never,
          firma,
          new Date(),
        );
        return reply.code(201).send(r);
      } catch (err) {
        return traducir(err, reply);
      }
    },
  );

  // ── 23 · El informe adjunto de la auditoría o la inspección ───────
  app.post(
    "/residencia/no-conformidades/:id/informe",
    {
      ...puerta,
      schema: {
        ...soloId,
        body: {
          type: "object",
          required: ["pdfBase64"],
          additionalProperties: false,
          properties: { pdfBase64: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      if (await sinPaso(request, reply)) return;
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();
      const nc = await prisma.nonConformity.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (nc == null) {
        return reply.code(404).send({
          error: "NC_NO_ENCONTRADA",
          message: "Esa no conformidad no existe en este centro.",
        });
      }
      let pdf: Buffer;
      try {
        pdf = decodificarEvidencia(request.body);
      } catch (err) {
        if (err instanceof FotoInvalida) {
          return reply
            .code(400)
            .send({ error: "INFORME_INVALIDO", message: err.message });
        }
        throw err;
      }
      const dek = await asegurarDek(auth.tenantId, prisma);
      const guardado = await guardarFichero("EVIDENCIA", pdf, {
        tenantId: auth.tenantId,
        dek,
      });
      await prisma.nonConformity.update({
        where: { id },
        data: {
          reportFileName: guardado.fileName,
          reportSha256: guardado.sha256,
          reportBytes: guardado.bytes,
          reportMimeType: MIME_DE_PDF,
        },
      });
      return reply.code(201).send({ bytes: guardado.bytes });
    },
  );

  app.get(
    "/residencia/no-conformidades/:id/informe",
    { ...puerta, schema: soloId },
    async (request, reply) => {
      if (await sinPaso(request, reply)) return;
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const prisma = getPrisma();
      const n = await prisma.nonConformity.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: { reportFileName: true, reportSha256: true, reportMimeType: true },
      });
      if (n?.reportFileName == null || n.reportSha256 == null) {
        return reply.code(404).send({
          error: "SIN_INFORME",
          message: "Esa no conformidad no tiene informe adjunto.",
        });
      }
      const dek = await asegurarDek(auth.tenantId, prisma);
      const leido = await leerFichero(
        "EVIDENCIA",
        n.reportFileName,
        n.reportSha256,
        { tenantId: auth.tenantId, dek },
      );
      if (leido == null) {
        return reply.code(404).send({
          error: "INFORME_NO_ESTA",
          message:
            "El informe no está en el volumen. La fila lo nombra: avisa a Mi Piace.",
        });
      }
      reply.header("content-type", n.reportMimeType ?? MIME_DE_PDF);
      reply.header("x-huella-cuadra", leido.huellaCuadra ? "1" : "0");
      return reply.send(leido.contenido);
    },
  );

  // ── 24 · Reasignar UNA no conformidad de proceso ──────────────────
  //
  // El proceso es de lo poco que una NC deja cambiar (el trigger lo
  // permite a propósito): reasignar es lo que hace posible desactivar un
  // proceso sin perder nada, y colgar un hallazgo del proceso equivocado
  // es un error de dedo que no debería obligar a abrir otra NC.
  app.put(
    "/residencia/no-conformidades/:id/proceso",
    {
      ...puerta,
      schema: {
        ...soloId,
        body: {
          type: "object",
          required: ["processId"],
          additionalProperties: false,
          properties: { processId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      if (await sinPaso(request, reply)) return;
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const { processId } = request.body as { processId: string };
      const prisma = getPrisma();
      const destino = await prisma.process.findFirst({
        where: { id: processId, tenantId: auth.tenantId, active: true },
        select: { id: true },
      });
      if (destino == null) {
        return reply.code(400).send({
          error: "PROCESO_NO_ENCONTRADO",
          message: "Ese proceso no existe o está desactivado.",
        });
      }
      const { count } = await prisma.nonConformity.updateMany({
        where: { id, tenantId: auth.tenantId },
        data: { processId },
      });
      if (count === 0) {
        return reply.code(404).send({
          error: "NC_NO_ENCONTRADA",
          message: "Esa no conformidad no existe en este centro.",
        });
      }
      return reply.code(200).send({ ok: true });
    },
  );
}
