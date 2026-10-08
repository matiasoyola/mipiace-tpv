// Catálogo de servicios extendido (B-reservas-2).
//
//   GET   /services/scheduling?query=          — servicios (product,
//                                                kind=SERVICE) con sus
//                                                campos de agenda (join
//                                                con service_scheduling).
//   PUT   /services/:productId/scheduling      — upsert de los campos de
//                                                agenda de un servicio.
//   GET   /services/:productId/resource-needs  — necesidades de recurso
//                                                de un servicio.
//   PUT   /services/:productId/resource-needs  — reemplaza el set de
//                                                necesidades de recurso.
//   GET   /resources                           — lista de recursos.
//   POST  /resources                           — alta de recurso.
//   PATCH /resources/:id                       — edición de recurso.
//   DELETE /resources/:id                      — baja de recurso.
//
// ADR-R1: es una capa de EXTENSIÓN local sobre el `product` espejo de
// Holded, NO una tabla `Service` paralela. Precio/IVA/alta viven en
// Holded y aquí NUNCA se tocan — sólo se añade el overlay de agenda.
// Un servicio sin fila en `service_scheduling` no tiene duración ni es
// reservable: la agenda (B4) lo ignora.
//
// Aislamiento por fila: toda query filtra por `auth.tenantId`. El
// scheduling y las necesidades de recurso se acceden SIEMPRE tras validar
// que el producto es un SERVICE del tenant (`loadOwnedService`).
//
// Gate por capability: el flag `agendaEnabled` viaja al front (TPV y
// admin), que muestra/oculta el módulo (ADR-R6). Los endpoints siguen la
// convención de B1 (CRM): existen con independencia del flag, el front es
// quien lo esconde. No se enforce el flag server-side.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ResourceKind, type Prisma } from "@mipiacetpv/db";
import {
  PLANTILLAS_DE_SERVICIO,
  PLANTILLA_DE_FOTOS,
  plantillaVigente,
} from "@mipiacetpv/consentimientos";
import {
  NIVELES_DE_QUIROPODIA,
  tipoDelServicio,
  type NivelDeQuiropodia,
  type TipoDeVisita,
} from "@mipiacetpv/clinica-sesion";

import {
  requireOwner,
  requireOwnerOrManager,
} from "../auth/middleware.js";
import {
  resolverTipoDelServicio,
  tipoPorEtiqueta,
} from "../clinica/tipos-de-visita.js";
import { getPrisma } from "../context.js";

// Forma estable de los flags de canal. El front la lee tal cual; `online`
// debe ir de la mano de `onlineBookable`.
interface Channels {
  caja: boolean;
  ticket: boolean;
  agenda: boolean;
  online: boolean;
}

const DEFAULT_CHANNELS: Channels = {
  caja: true,
  ticket: true,
  agenda: true,
  online: false,
};

// Normaliza el jsonb `channels` a la forma estable (defensivo: filas
// viejas o payloads parciales caen a los defaults por clave).
function toChannels(raw: unknown): Channels {
  const c = (raw ?? {}) as Partial<Record<keyof Channels, unknown>>;
  return {
    caja: c.caja === undefined ? DEFAULT_CHANNELS.caja : Boolean(c.caja),
    ticket: c.ticket === undefined ? DEFAULT_CHANNELS.ticket : Boolean(c.ticket),
    agenda: c.agenda === undefined ? DEFAULT_CHANNELS.agenda : Boolean(c.agenda),
    online: c.online === undefined ? DEFAULT_CHANNELS.online : Boolean(c.online),
  };
}

function schedulingView(s: {
  productId: string;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  staffRequired: number;
  onlineBookable: boolean;
  family: string | null;
  channels: unknown;
  primeraValoracion: boolean;
  tratamientoSesion: boolean;
  nivelQuiropodia: number | null;
  consentimientos: string[];
  updatedAt: Date;
}) {
  return {
    durationMin: s.durationMin,
    bufferBeforeMin: s.bufferBeforeMin,
    bufferAfterMin: s.bufferAfterMin,
    staffRequired: s.staffRequired,
    onlineBookable: s.onlineBookable,
    family: s.family,
    channels: toChannels(s.channels),
    // clinica-2 · dar una cita de este servicio a un paciente sin
    // valoración le manda el test. Viaja siempre (no sólo en tenants
    // clínicos): un campo que aparece y desaparece según la capability
    // obliga a cada lector a distinguir «false» de «no me lo han dicho».
    primeraValoracion: s.primeraValoracion,
    // clinica-3 · este servicio sale como botón en la sesión, y su precio
    // y su IVA son los que se cobran. Viaja siempre, por la misma razón
    // que `primeraValoracion`: un campo que aparece y desaparece según la
    // capability obliga a cada lector a distinguir «false» de «no me lo
    // han dicho».
    tratamientoSesion: s.tratamientoSesion,
    // clinica-5 · «este servicio ES el nivel N de la quiropodia» (1
    // básica, 2 completa, 3 extra). `null` = ninguno, que es lo normal.
    // Viaja siempre, por la misma razón que las dos de arriba: un campo
    // que aparece y desaparece según la capability obliga a cada lector a
    // distinguir «null» de «no me lo han dicho».
    nivelQuiropodia: s.nivelQuiropodia,
    // clinica-4 · qué consentimientos pide este servicio (decisión 4). Una
    // cita de este servicio no empieza sin ellos firmados y vigentes.
    // Viaja siempre, por la misma razón que los tres de arriba.
    consentimientos: s.consentimientos,
    updatedAt: s.updatedAt.toISOString(),
  };
}

// Carga un producto validando que es un SERVICE del tenant del actor.
// Devuelve null (→ 404) si no existe, es de otro tenant o no es servicio.
// Es la puerta de aislamiento para scheduling y necesidades de recurso.
async function loadOwnedService(tenantId: string, productId: string) {
  const prisma = getPrisma();
  return prisma.product.findFirst({
    where: { id: productId, tenantId, kind: "SERVICE" },
    select: { id: true },
  });
}

function serviceNotFound(reply: FastifyReply) {
  return reply.code(404).send({
    error: "SERVICE_NOT_FOUND",
    message: "Servicio no encontrado.",
  });
}

// clinica-5 · el tipo de visita que el servicio HEREDA de sus categorías,
// en la forma en la que viaja al panel.
//
// Dos claves y no una: `tipoDeVisita` (el tipo, o `null`) y
// `tipoDeVisitaMotivo` (por qué no hay tipo, cuando el motivo es que dos
// categorías se pelean). La segunda existe porque «sin tipo» y «con dos
// tipos» se pintan distinto: lo primero es un servicio normal, lo segundo
// es algo que hay que arreglar y que va a impedir guardarlo si se marca
// como tratamiento de sesión.
//
// El motivo lo redacta la función pura del paquete, la misma que usa el
// PUT para rechazar. Dos redacciones del mismo problema acabarían
// discrepando, y una de las dos es la que la dueña lee para arreglarlo.
function tipoDeVisitaDelProducto(
  etiquetas: readonly string[],
  tipoPorTag: Readonly<Record<string, TipoDeVisita>>,
): { tipoDeVisita: TipoDeVisita | null; tipoDeVisitaMotivo: string | null } {
  const r = tipoDelServicio({
    etiquetas,
    tipoPorTag,
    // `false` las dos: aquí sólo se pregunta «qué tipo tiene», no «se
    // puede guardar». La negativa de «servicio de sesión sin tipo» la
    // aplica el PUT con el valor que se va a guardar, que es el único que
    // importa.
    esCentroClinico: false,
    tratamientoSesion: false,
  });
  if (r.ok) return { tipoDeVisita: r.tipo, tipoDeVisitaMotivo: null };
  return { tipoDeVisita: null, tipoDeVisitaMotivo: r.mensaje };
}

/** El 23505 del índice «un servicio por nivel», y sólo ése. Cualquier
 *  otro error sube: un fallo de base no se puede confundir con una
 *  configuración duplicada. Misma forma que `esChoqueDeSesionUnica` de
 *  clinica-3. */
function esChoqueDeNivel(err: unknown): boolean {
  const e = err as { code?: string; meta?: { target?: unknown } } | null;
  if (e?.code !== "P2002") return false;
  const target = JSON.stringify(e.meta?.target ?? "");
  return (
    target.includes("service_scheduling_un_servicio_por_nivel") ||
    target.includes("nivel_quiropodia")
  );
}

const RESOURCE_KINDS = ["CABIN", "ROOM", "DEVICE"] as const;

export async function registerServicesRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── Servicios + campos de agenda ────────────────────────────────────
  app.get(
    "/services/scheduling",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: { type: "string", maxLength: 120 },
          },
        },
      },
    },
    async (request: FastifyRequest) => {
      const auth = request.auth!;
      const q = request.query as { query?: string };
      const prisma = getPrisma();
      const trimmed = (q.query ?? "").trim();

      const where: Prisma.ProductWhereInput = {
        tenantId: auth.tenantId,
        kind: "SERVICE",
      };
      if (trimmed.length > 0) {
        where.OR = [
          { name: { contains: trimmed, mode: "insensitive" } },
          { sku: { contains: trimmed, mode: "insensitive" } },
        ];
      }

      const services = await prisma.product.findMany({
        where,
        orderBy: { name: "asc" },
        take: 500,
        select: {
          id: true,
          holdedProductId: true,
          name: true,
          sku: true,
          basePrice: true,
          taxRate: true,
          active: true,
          // clinica-5 · las categorías del producto. De ellas sale el
          // tipo de visita (S5), y vienen en la MISMA consulta: una por
          // servicio habría sido quinientas.
          tags: true,
          scheduling: {
            select: {
              productId: true,
              durationMin: true,
              bufferBeforeMin: true,
              bufferAfterMin: true,
              staffRequired: true,
              onlineBookable: true,
              family: true,
              channels: true,
              primeraValoracion: true,
              tratamientoSesion: true,
              nivelQuiropodia: true,
              consentimientos: true,
              updatedAt: true,
            },
          },
        },
      });

      // clinica-5 · el mapa `categoría → tipo de visita` del centro, UNA
      // vez para los quinientos servicios. Vacío en los catorce tenants
      // sin clínica, y entonces todos los `tipoDeVisita` salen `null`.
      const tipoPorTag = await tipoPorEtiqueta(prisma, auth.tenantId);

      return {
        items: services.map((s) => ({
          productId: s.id,
          holdedProductId: s.holdedProductId,
          name: s.name,
          sku: s.sku,
          // Precio/IVA vienen de Holded; se muestran informativos, NO se
          // editan aquí (ADR-R1).
          basePrice: Number(s.basePrice),
          taxRate: Number(s.taxRate),
          active: s.active,
          // null → el servicio aún no tiene overlay de agenda: no es
          // reservable ni tiene duración. El panel ofrece "añadir".
          scheduling: s.scheduling ? schedulingView(s.scheduling) : null,
          // clinica-5 · el tipo HEREDADO de sus categorías, de sólo
          // lectura: no se edita aquí, se edita en el mapa de categorías.
          // El panel lo enseña para que la dueña vea qué va a pasar antes
          // de marcar «es un tratamiento de la sesión», y el motivo si hay
          // dos categorías que se pelean.
          ...tipoDeVisitaDelProducto(s.tags, tipoPorTag),
        })),
      };
    },
  );

  // ── Upsert de los campos de agenda de un servicio ───────────────────
  app.put(
    "/services/:productId/scheduling",
    {
      preHandler: requireOwner,
      schema: {
        params: {
          type: "object",
          required: ["productId"],
          properties: { productId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["durationMin"],
          additionalProperties: false,
          properties: {
            durationMin: { type: "integer", minimum: 1, maximum: 1440 },
            bufferBeforeMin: { type: "integer", minimum: 0, maximum: 480 },
            bufferAfterMin: { type: "integer", minimum: 0, maximum: 480 },
            staffRequired: { type: "integer", minimum: 1, maximum: 12 },
            onlineBookable: { type: "boolean" },
            // clinica-2 · la marca de «primera valoración».
            primeraValoracion: { type: "boolean" },
            // clinica-3 · la marca de «es un tratamiento de la sesión».
            tratamientoSesion: { type: "boolean" },
            // clinica-5 · «este servicio ES el nivel N de la quiropodia».
            // `null` para quitarlo. El CHECK de la base dice lo mismo, y
            // el índice único por (tenant, nivel) es lo que impide que dos
            // servicios digan ser el mismo nivel.
            nivelQuiropodia: {
              type: ["integer", "null"],
              enum: [...NIVELES_DE_QUIROPODIA, null],
            },
            // clinica-4 · los consentimientos que pide el servicio. Sólo
            // los ATABLES: «fotos clínicas» no se puede marcar aquí (la
            // pide la primera foto, no un servicio), y el `enum` lo
            // rechaza antes de que nadie lo guarde. El tope de 5 lo
            // garantiza además el CHECK de la migración.
            consentimientos: {
              type: "array",
              maxItems: 5,
              items: { type: "string", enum: [...PLANTILLAS_DE_SERVICIO] },
            },
            family: { type: ["string", "null"], maxLength: 120 },
            channels: {
              type: "object",
              additionalProperties: false,
              properties: {
                caja: { type: "boolean" },
                ticket: { type: "boolean" },
                agenda: { type: "boolean" },
                online: { type: "boolean" },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { productId } = request.params as { productId: string };
      const body = request.body as {
        durationMin: number;
        bufferBeforeMin?: number;
        bufferAfterMin?: number;
        staffRequired?: number;
        onlineBookable?: boolean;
        primeraValoracion?: boolean;
        tratamientoSesion?: boolean;
        nivelQuiropodia?: number | null;
        consentimientos?: string[];
        family?: string | null;
        channels?: Partial<Channels>;
      };
      const service = await loadOwnedService(auth.tenantId, productId);
      if (!service) return serviceNotFound(reply);
      const prisma = getPrisma();

      const channels: Channels = {
        ...DEFAULT_CHANNELS,
        ...(body.channels ?? {}),
      };
      // Coherencia: si el servicio no es reservable online, el canal
      // online no puede estar activo (contrato para B4/B6).
      const onlineBookable = body.onlineBookable ?? false;
      if (!onlineBookable) channels.online = false;

      const family = body.family?.trim() || null;
      const bufferBeforeMin = body.bufferBeforeMin ?? 0;
      const bufferAfterMin = body.bufferAfterMin ?? 0;
      const staffRequired = body.staffRequired ?? 1;
      // clinica-2 · ausente = false. Un PUT que no lo mande DESMARCA el
      // servicio, igual que hace con `onlineBookable` y con los canales:
      // esta ruta es un upsert del juego completo, no un parche. El panel
      // manda siempre el valor actual.
      const primeraValoracion = body.primeraValoracion ?? false;
      // clinica-3 · ausente = false, igual que la de arriba y por la misma
      // razón: esta ruta es un upsert del juego completo, no un parche. El
      // panel manda siempre el valor actual.
      const tratamientoSesion = body.tratamientoSesion ?? false;
      // clinica-5 · ausente = null, igual que las dos de arriba: esta ruta
      // es un upsert del juego completo y el panel manda siempre el valor
      // actual.
      const nivelQuiropodia =
        body.nivelQuiropodia == null
          ? null
          : (body.nivelQuiropodia as NivelDeQuiropodia);
      // clinica-4 · ausente = ninguno, igual que las tres marcas de
      // arriba: esta ruta es un upsert del juego completo y el panel manda
      // siempre el valor actual. Sin repetidos: marcar dos veces el mismo
      // consentimiento lo pide una vez.
      const consentimientos = [...new Set(body.consentimientos ?? [])];

      // ── LAS DOS NEGATIVAS DE S5 ─────────────────────────────────────
      //
      // Se comprueban AQUÍ porque aquí nace la mezcla: es el único sitio
      // desde el que la dueña puede marcar un servicio como tratamiento de
      // sesión. Y con el valor QUE SE VA A GUARDAR, no con el que hay en
      // la fila: si no, marcar la casilla por primera vez pasaría.
      //
      // 409 y no 400: la petición está bien formada: es el sistema
      // diciendo que esa combinación no se puede guardar. Misma elección
      // que el cierre de sesión de clinica-3 hace con sus negativas.
      const tipo = await resolverTipoDelServicio(prisma, {
        tenantId: auth.tenantId,
        productId,
        tratamientoSesion,
      });
      if (!tipo.ok) {
        return reply
          .code(409)
          .send({ error: tipo.motivo, code: tipo.motivo, message: tipo.mensaje });
      }

      // Y la tercera, que es de este bloque y no de S5: un nivel de
      // quiropodia en un servicio que no es de quiropodia. «Quiropodia
      // extra» marcado sobre una exploración biomecánica sería una línea
      // de ticket que el nivel de la quiropodia elige y que no es una
      // quiropodia.
      if (nivelQuiropodia != null && tipo.tipo !== "QUIROPODIA") {
        return reply.code(409).send({
          error: "NIVEL_SIN_QUIROPODIA",
          code: "NIVEL_SIN_QUIROPODIA",
          message:
            "El nivel (básica, completa, extra) sólo vale en un servicio de la categoría de quiropodia.",
        });
      }

      // Y la cuarta negativa, de este bloque: «fotos clínicas» no se ata
      // a un servicio. El `enum` del schema ya lo rechaza; esto cubre el
      // camino que el schema no cubre —un psql de una implantación— y,
      // sobre todo, deja la frase escrita donde se lee.
      if (consentimientos.includes(PLANTILLA_DE_FOTOS)) {
        return reply.code(409).send({
          error: "FOTOS_NO_SE_ATA",
          code: "FOTOS_NO_SE_ATA",
          message:
            "El consentimiento de fotos no se ata a un servicio: lo pide la primera foto del paciente, en cualquier visita.",
        });
      }
      // Y una plantilla que este despliegue no conoce no se guarda: sería
      // un servicio que pide un consentimiento que nadie puede firmar, o
      // sea una sesión que no empieza nunca.
      const desconocida = consentimientos.find((id) => !plantillaVigente(id));
      if (desconocida) {
        return reply.code(409).send({
          error: "CONSENTIMIENTO_DESCONOCIDO",
          code: "CONSENTIMIENTO_DESCONOCIDO",
          message: `«${desconocida}» no es un consentimiento de esta versión del programa.`,
        });
      }

      // El upsert envuelto, y el `catch` NO es defensivo: es la mitad
      // legible de la garantía «un servicio por nivel». El índice único
      // parcial de la migración es la garantía de verdad (cubre también el
      // psql de una implantación), y aquí se traduce su 23505 a una frase
      // que la dueña puede usar. Sin esto, marcar «extra» en un segundo
      // servicio contestaría un 500.
      let saved;
      try {
        saved = await prisma.serviceScheduling.upsert({
        where: { productId },
        create: {
          productId,
          tenantId: auth.tenantId,
          durationMin: body.durationMin,
          bufferBeforeMin,
          bufferAfterMin,
          staffRequired,
          onlineBookable,
          primeraValoracion,
          tratamientoSesion,
          nivelQuiropodia,
          consentimientos,
          family,
          channels: channels as unknown as Prisma.InputJsonValue,
        },
        update: {
          durationMin: body.durationMin,
          bufferBeforeMin,
          bufferAfterMin,
          staffRequired,
          onlineBookable,
          primeraValoracion,
          tratamientoSesion,
          nivelQuiropodia,
          consentimientos,
          family,
          channels: channels as unknown as Prisma.InputJsonValue,
        },
        select: {
          productId: true,
          durationMin: true,
          bufferBeforeMin: true,
          bufferAfterMin: true,
          staffRequired: true,
          onlineBookable: true,
          family: true,
          channels: true,
          primeraValoracion: true,
          tratamientoSesion: true,
          nivelQuiropodia: true,
          consentimientos: true,
          updatedAt: true,
        },
        });
      } catch (err) {
        if (esChoqueDeNivel(err)) {
          return reply.code(409).send({
            error: "NIVEL_YA_ASIGNADO",
            code: "NIVEL_YA_ASIGNADO",
            message:
              "Otro servicio ya es ese nivel de quiropodia. Quítaselo a ése antes de ponérselo a éste.",
          });
        }
        throw err;
      }
      return { scheduling: schedulingView(saved) };
    },
  );

  // ── Necesidades de recurso de un servicio ───────────────────────────
  app.get(
    "/services/:productId/resource-needs",
    {
      preHandler: requireOwnerOrManager,
      schema: {
        params: {
          type: "object",
          required: ["productId"],
          properties: { productId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { productId } = request.params as { productId: string };
      const service = await loadOwnedService(auth.tenantId, productId);
      if (!service) return serviceNotFound(reply);
      const prisma = getPrisma();
      const needs = await prisma.serviceResourceNeed.findMany({
        where: { serviceId: productId, tenantId: auth.tenantId },
        orderBy: { resourceKind: "asc" },
        select: { resourceKind: true, qty: true },
      });
      return { needs };
    },
  );

  // ── Reemplaza el set de necesidades de recurso de un servicio ───────
  // PUT = idempotente: el body define el estado final. Una necesidad por
  // tipo de recurso (pk compuesta serviceId+resourceKind).
  app.put(
    "/services/:productId/resource-needs",
    {
      preHandler: requireOwner,
      schema: {
        params: {
          type: "object",
          required: ["productId"],
          properties: { productId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["needs"],
          additionalProperties: false,
          properties: {
            needs: {
              type: "array",
              maxItems: 3,
              items: {
                type: "object",
                required: ["resourceKind"],
                additionalProperties: false,
                properties: {
                  resourceKind: { type: "string", enum: RESOURCE_KINDS },
                  qty: { type: "integer", minimum: 1, maximum: 20 },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { productId } = request.params as { productId: string };
      const body = request.body as {
        needs: Array<{ resourceKind: (typeof RESOURCE_KINDS)[number]; qty?: number }>;
      };
      const service = await loadOwnedService(auth.tenantId, productId);
      if (!service) return serviceNotFound(reply);
      const prisma = getPrisma();

      // Dedup por tipo (el último gana): la pk no admite duplicados.
      const byKind = new Map<
        (typeof RESOURCE_KINDS)[number],
        number
      >();
      for (const n of body.needs) byKind.set(n.resourceKind, n.qty ?? 1);

      await prisma.$transaction([
        prisma.serviceResourceNeed.deleteMany({
          where: { serviceId: productId, tenantId: auth.tenantId },
        }),
        ...(byKind.size > 0
          ? [
              prisma.serviceResourceNeed.createMany({
                data: [...byKind.entries()].map(([resourceKind, qty]) => ({
                  serviceId: productId,
                  tenantId: auth.tenantId,
                  resourceKind: ResourceKind[resourceKind],
                  qty,
                })),
              }),
            ]
          : []),
      ]);

      const needs = await prisma.serviceResourceNeed.findMany({
        where: { serviceId: productId, tenantId: auth.tenantId },
        orderBy: { resourceKind: "asc" },
        select: { resourceKind: true, qty: true },
      });
      return { needs };
    },
  );

  // ── Recursos (CRUD) ─────────────────────────────────────────────────
  app.get(
    "/resources",
    { preHandler: requireOwnerOrManager },
    async (request: FastifyRequest) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const resources = await prisma.resource.findMany({
        where: { tenantId: auth.tenantId },
        orderBy: [{ kind: "asc" }, { name: "asc" }],
        select: { id: true, name: true, kind: true },
      });
      return { resources };
    },
  );

  app.post(
    "/resources",
    {
      preHandler: requireOwner,
      schema: {
        body: {
          type: "object",
          required: ["name", "kind"],
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 1, maxLength: 120 },
            kind: { type: "string", enum: RESOURCE_KINDS },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const body = request.body as {
        name: string;
        kind: (typeof RESOURCE_KINDS)[number];
      };
      const prisma = getPrisma();
      const resource = await prisma.resource.create({
        data: {
          tenantId: auth.tenantId,
          name: body.name.trim(),
          kind: ResourceKind[body.kind],
        },
        select: { id: true, name: true, kind: true },
      });
      return reply.code(201).send({ resource });
    },
  );

  app.patch(
    "/resources/:id",
    {
      preHandler: requireOwner,
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
            name: { type: "string", minLength: 1, maxLength: 120 },
            kind: { type: "string", enum: RESOURCE_KINDS },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { id } = request.params as { id: string };
      const body = request.body as {
        name?: string;
        kind?: (typeof RESOURCE_KINDS)[number];
      };
      const prisma = getPrisma();
      // Aislamiento: validar propiedad antes de mutar.
      const existing = await prisma.resource.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (!existing) {
        return reply.code(404).send({
          error: "RESOURCE_NOT_FOUND",
          message: "Recurso no encontrado.",
        });
      }
      const data: Prisma.ResourceUpdateInput = {};
      if (body.name !== undefined) data.name = body.name.trim();
      if (body.kind !== undefined) data.kind = ResourceKind[body.kind];
      const resource = await prisma.resource.update({
        where: { id },
        data,
        select: { id: true, name: true, kind: true },
      });
      return { resource };
    },
  );

  app.delete(
    "/resources/:id",
    {
      preHandler: requireOwner,
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
      const prisma = getPrisma();
      const existing = await prisma.resource.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (!existing) {
        return reply.code(404).send({
          error: "RESOURCE_NOT_FOUND",
          message: "Recurso no encontrado.",
        });
      }
      await prisma.resource.delete({ where: { id } });
      return reply.code(200).send({ deleted: true });
    },
  );
}
