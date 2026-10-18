// residencia-4 (D-35, D-38) · **EL LIBRO, DE PARTE DEL SERVIDOR.**
//
// Las rutas del admin sobre el libro único y sobre lo que cuelga de él:
//
//   · `GET  /residencia/incidencias`                  — el libro, con
//     las abiertas de hoy primero y filtro por sujeto y nivel.
//   · `GET  /residencia/incidencias/:id`              — la ficha:
//     cronología, acciones, enlaces, cierre y comunicación a familia.
//   · `POST /residencia/incidencias`                  — declarar: una
//     queja, una avería o algo de un residente desde el despacho.
//   · `POST /residencia/incidencias/:id/acciones`     — «qué se hizo».
//   · `POST /residencia/incidencias/:id/familia`      — la constancia.
//   · `POST /residencia/incidencias/:id/cerrar`       — el cierre.
//   · `POST /residencia/incidencias/:id/enlaces`      — enlazar dos.
//   · `DELETE /residencia/incidencias/:id/enlaces/:otroId`
//   · `GET  /residencia/plantilla-de-gravedad`        — la de serie, en
//     SOLO LECTURA, con su versión.
//   · `GET/POST/DELETE` de las excepciones de umbral por residente.
//   · `GET/PUT /residencia/guardia/configuracion` y
//     `GET /residencia/guardia/moviles`.
//
// ── QUIÉN ENTRA AQUÍ ────────────────────────────────────────────────
//
// Las mismas dos reglas que el plan de cuidados (residencia-2):
//
//   1. el OWNER, o un rol de cuidado vigente de categoría `SUPERVISOR` o
//      `DIRECTIVO`, o uno de alcance total (DUE, médico, calidad). El
//      libro de incidencias de un centro no es para la auxiliar del
//      pasillo: ella registra en la puerta y lo que declara acaba aquí;
//   2. y lo de un RESIDENTE pasa además por `conHistoria`, porque una
//      incidencia suya es un dato de salud.
//
// ── LA FIRMA DEL ADMIN ──────────────────────────────────────────────
//
// Todo lo que se escribe desde aquí va firmado con persona + CAPACIDAD
// (D-31), igual que lo de la puerta. La capacidad la elige quien escribe
// si tiene varias (`careRoleAssignmentId` en el cuerpo); con una sola, no
// se le pregunta. Y **sin ninguna vigente no se puede escribir**, ni
// siendo OWNER: «lo cerró Matías» no es evidencia, «lo cerró Matías, como
// dirección» sí (rama de controles §8).

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type {
  FamilyCommunicationChannel,
  FamilyCommunicationKind,
  IncidentSubject,
  SeverityLevel,
} from "@mipiacetpv/db";
import { diaDelTurno, turnoDe } from "@mipiacetpv/residencia-plan";

import { getPrisma } from "../context.js";
import { requireOwnerOrCashier } from "../auth/middleware.js";
import { dekONada } from "../clinica/claves.js";
import { negativaClinica } from "../clinica/contrato.js";
import { ensureClinicaEnabled } from "../clinica/gate.js";
import { conHistoria } from "../clinica/registro.js";
import {
  leerTexto,
  sitioContenidoAFamilia,
  sitioDescripcionDeIncidencia,
  sitioMotivoDeExcepcion,
  sitioRespuestaDeFamilia,
  sitioTextoDeAccion,
} from "../clinica/cripto-campos.js";
import { configuracionDeGuardia } from "./aviso.js";
import {
  NOMBRE_DEL_NIVEL,
  NOMBRE_DEL_TIPO,
} from "./catalogo/plantilla-de-gravedad.js";
import { derivarDeEvento } from "./derivacion.js";
import { ensureResidenciaEnabled } from "./gate.js";
import { empujarAvisos } from "./guardia-bus.js";
import {
  capacidadesVigentes,
  cerrarIncidencia,
  enlazarIncidencias,
  escribirAccion,
  escribirComunicacion,
  IncidenciaInvalida,
  pautarExcepcion,
} from "./incidencias.js";
import { plantillaVigente } from "./gravedad.js";
import { nombreDeQuienFirma } from "./registro.js";

const PUERTAS = [requireOwnerOrCashier, ensureClinicaEnabled, ensureResidenciaEnabled];

const NIVELES = ["N0", "N1", "N2", "N3", "N4"] as const;
const SUJETOS = ["RESIDENT", "COMPLAINT", "MAINTENANCE"] as const;

/**
 * ¿Puede esta persona abrir el libro? Y si puede, ¿con qué capacidad
 * firma?
 *
 * Devuelve la frase de la negativa, o las capacidades vigentes. Copia
 * deliberada de `puedeTocarElPlan` (residencia-2): mismas dos negativas
 * separadas, porque se arreglan en sitios distintos — una pidiéndole un
 * rol a dirección, la otra no pidiendo nada.
 */
async function quienEscribe(
  tenantId: string,
  userId: string,
  esOwner: boolean,
): Promise<
  | { error: string; message: string }
  | { capacidades: Array<{ assignmentId: string; code: string; category: string }> }
> {
  const capacidades = await capacidadesVigentes(
    getPrisma(),
    tenantId,
    userId,
    new Date(),
  );
  if (capacidades.length === 0) {
    return {
      error: "SIN_ROL_DE_CUIDADO",
      message:
        "No tienes ningún rol de cuidado vigente en este centro, así que no puedes firmar nada en el libro. Pídeselo a la dirección en Personal.",
    };
  }
  const puede =
    esOwner ||
    capacidades.some((c) => c.category === "SUPERVISOR" || c.category === "DIRECTIVO");
  if (!puede) {
    return {
      error: "LIBRO_ES_DE_SUPERVISION",
      message:
        "El libro de incidencias lo llevan la dirección, la DUE, el médico o calidad. Tú registras en la puerta, y lo que declares aparece aquí.",
    };
  }
  return { capacidades };
}

/** Elige la capacidad con la que se firma: la pedida, o la de más
 *  categoría. Nunca «la primera de la lista». */
function capacidadElegida(
  capacidades: Array<{ assignmentId: string; code: string; category: string }>,
  pedida: string | undefined,
): { assignmentId: string; code: string; category: string } | null {
  if (pedida) {
    return capacidades.find((c) => c.assignmentId === pedida) ?? null;
  }
  const orden = { DIRECTIVO: 3, SUPERVISOR: 2, OPERATIVO: 1 } as Record<string, number>;
  return (
    [...capacidades].sort(
      (a, b) => (orden[b.category] ?? 0) - (orden[a.category] ?? 0),
    )[0] ?? null
  );
}

function errorDeIncidencia(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof IncidenciaInvalida) {
    // 409 y no 400: lo que falla no es la forma del cuerpo —eso lo caza
    // el esquema— sino el estado de la incidencia o la capacidad de quien
    // escribe. La pantalla lo pinta como una frase, no como «error de
    // validación».
    return reply.code(409).send({ error: err.codigo, message: err.message });
  }
  throw err;
}

export async function registerResidenciaIncidenciasRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ════════════════════════════════════════════════════════════════
  //  EL LIBRO
  // ════════════════════════════════════════════════════════════════
  //
  // **Las abiertas primero**, que es literalmente la métrica de éxito de
  // dirección (rama §6.3): «una sola pantalla de qué hay abierto hoy en
  // la residencia».
  app.get(
    "/residencia/incidencias",
    {
      preHandler: PUERTAS,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            sujeto: { type: "string", enum: SUJETOS as unknown as string[] },
            nivel: { type: "string", enum: NIVELES as unknown as string[] },
            abiertas: { type: "string", enum: ["si", "no", "todas"] },
            clientId: { type: "string", format: "uuid" },
            limite: { type: "integer", minimum: 1, maximum: 200 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const quien = await quienEscribe(
        auth.tenantId,
        auth.userId,
        auth.role === "OWNER",
      );
      if ("error" in quien) return reply.code(403).send(quien);

      const q = request.query as {
        sujeto?: IncidentSubject;
        nivel?: SeverityLevel;
        abiertas?: "si" | "no" | "todas";
        clientId?: string;
        limite?: number;
      };
      const prisma = getPrisma();
      const filas = await prisma.incident.findMany({
        where: {
          tenantId: auth.tenantId,
          ...(q.sujeto ? { subject: q.sujeto } : {}),
          ...(q.nivel ? { severity: q.nivel } : {}),
          ...(q.clientId ? { clientId: q.clientId } : {}),
          ...(q.abiertas === "no"
            ? { open: false }
            : q.abiertas === "todas"
              ? {}
              : // Por defecto, **las abiertas**. Es la lista que dirección
                // mira cada mañana, y pedir un filtro para verla sería
                // esconderla detrás de un clic.
                { open: true }),
        },
        // Abiertas primero y, dentro, las más graves y las más antiguas:
        // un N4 de hace una hora va por delante de un N1 de hace cinco
        // minutos, y un N1 que lleva tres días abierto va por delante de
        // uno de esta mañana.
        orderBy: [{ open: "desc" }, { severity: "desc" }, { openedAt: "asc" }],
        take: q.limite ?? 100,
        select: {
          id: true,
          subject: true,
          clientId: true,
          origin: true,
          incidentType: true,
          severity: true,
          open: true,
          openedAt: true,
          closedAt: true,
          selfClosed: true,
          alertedAt: true,
          careDay: true,
          client: { select: { firstName: true, lastName: true } },
          room: { select: { number: true } },
          openedBy: { select: { alias: true, email: true } },
          openedWith: { select: { careRole: { select: { name: true } } } },
          _count: { select: { actions: true, familyCommunications: true } },
          alerts: {
            select: {
              channel: true,
              state: true,
              ackedAt: true,
              ackedBy: { select: { alias: true, email: true } },
            },
          },
        },
      });

      return reply.code(200).send({
        incidencias: filas.map((i) => ({
          id: i.id,
          sujeto: i.subject,
          origen: i.origin,
          tipo: i.incidentType,
          nombreDelTipo: NOMBRE_DEL_TIPO[i.incidentType] ?? i.incidentType,
          nivel: i.severity,
          nombreDelNivel: NOMBRE_DEL_NIVEL[i.severity],
          abierta: i.open,
          abiertaEn: i.openedAt.toISOString(),
          cerradaEn: i.closedAt?.toISOString() ?? null,
          autocierre: i.selfClosed,
          avisadoEn: i.alertedAt?.toISOString() ?? null,
          careDay: i.careDay,
          // **Sin descripción.** La lista no descifra nada: son cien
          // filas y la descripción es salud. Se pide al abrir la ficha,
          // que es cuando alguien la está mirando de verdad.
          residente: i.client
            ? {
                id: i.clientId,
                nombre: `${i.client.firstName} ${i.client.lastName}`.trim(),
              }
            : null,
          habitacion: i.room?.number ?? null,
          abiertaPor: nombreDeQuienFirma(i.openedBy),
          abiertaComo: i.openedWith.careRole.name,
          acciones: i._count.actions,
          constanciasDeFamilia: i._count.familyCommunications,
          avisos: i.alerts.map((a) => ({
            canal: a.channel,
            estado: a.state,
            acusadoPor: a.ackedBy ? nombreDeQuienFirma(a.ackedBy) : null,
            acusadoEn: a.ackedAt?.toISOString() ?? null,
          })),
        })),
        /** Con qué capacidades puede firmar quien está mirando. */
        capacidades: quien.capacidades,
      });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  LA FICHA
  // ════════════════════════════════════════════════════════════════
  app.get(
    "/residencia/incidencias/:id",
    {
      preHandler: PUERTAS,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const quien = await quienEscribe(
        auth.tenantId,
        auth.userId,
        auth.role === "OWNER",
      );
      if ("error" in quien) return reply.code(403).send(quien);

      const { id } = request.params as { id: string };
      const prisma = getPrisma();
      const negativa = await negativaClinica(auth.tenantId, "LEER");
      if (negativa) {
        return reply
          .code(423)
          .send({ error: negativa.code, code: negativa.code, message: negativa.message });
      }

      const inc = await prisma.incident.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: {
          id: true,
          tenantId: true,
          subject: true,
          clientId: true,
          origin: true,
          incidentType: true,
          severity: true,
          templateVersion: true,
          open: true,
          descriptionCifrado: true,
          openedAt: true,
          closedAt: true,
          selfClosed: true,
          alertedAt: true,
          careDay: true,
          client: { select: { firstName: true, lastName: true } },
          room: { select: { number: true, name: true } },
          centerShift: { select: { code: true, name: true } },
          openedBy: { select: { alias: true, email: true } },
          openedWith: { select: { careRole: { select: { name: true } } } },
          closedBy: { select: { alias: true, email: true } },
          closedWith: { select: { careRole: { select: { name: true } } } },
          sourceRecord: { select: { id: true, controlCode: true, recordedAt: true } },
          actions: {
            orderBy: { at: "asc" },
            select: {
              id: true,
              kind: true,
              textCifrado: true,
              severityFrom: true,
              severityTo: true,
              careRecordId: true,
              called: true,
              at: true,
              by: { select: { alias: true, email: true } },
              byWith: { select: { careRole: { select: { name: true } } } },
            },
          },
          familyCommunications: {
            orderBy: { at: "asc" },
            select: {
              id: true,
              kind: true,
              channel: true,
              contactName: true,
              contactRelation: true,
              contentCifrado: true,
              responseCifrado: true,
              at: true,
              by: { select: { alias: true, email: true } },
              byWith: { select: { careRole: { select: { name: true } } } },
            },
          },
          alerts: {
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              channel: true,
              state: true,
              severity: true,
              queuedAt: true,
              createdAt: true,
              deliveredAt: true,
              ackedAt: true,
              escalatedFromId: true,
              ackedBy: { select: { alias: true, email: true } },
              ackedWith: { select: { careRole: { select: { name: true } } } },
            },
          },
          linksFrom: {
            select: {
              id: true,
              b: {
                select: {
                  id: true,
                  subject: true,
                  incidentType: true,
                  severity: true,
                  open: true,
                },
              },
            },
          },
          linksTo: {
            select: {
              id: true,
              a: {
                select: {
                  id: true,
                  subject: true,
                  incidentType: true,
                  severity: true,
                  open: true,
                },
              },
            },
          },
        },
      });
      if (!inc) {
        return reply.code(404).send({
          error: "INCIDENCIA_NO_ENCONTRADA",
          message: "Esa incidencia no es de este centro.",
        });
      }

      const dek = await dekONada(auth.tenantId, prisma);
      const enlaces = [
        ...inc.linksFrom.map((l) => ({ enlaceId: l.id, otra: l.b })),
        ...inc.linksTo.map((l) => ({ enlaceId: l.id, otra: l.a })),
      ];

      return reply.code(200).send({
        id: inc.id,
        sujeto: inc.subject,
        origen: inc.origin,
        tipo: inc.incidentType,
        nombreDelTipo: NOMBRE_DEL_TIPO[inc.incidentType] ?? inc.incidentType,
        nivel: inc.severity,
        nombreDelNivel: NOMBRE_DEL_NIVEL[inc.severity],
        versionDeLaPlantilla: inc.templateVersion,
        abierta: inc.open,
        descripcion: leerTexto(
          { cifrado: inc.descriptionCifrado, claro: null },
          dek,
          sitioDescripcionDeIncidencia(inc.tenantId, inc.id),
        ),
        residente: inc.client
          ? {
              id: inc.clientId,
              nombre: `${inc.client.firstName} ${inc.client.lastName}`.trim(),
            }
          : null,
        habitacion: inc.room
          ? { numero: inc.room.number, nombre: inc.room.name }
          : null,
        turno: inc.centerShift?.name ?? null,
        careDay: inc.careDay,
        abiertaEn: inc.openedAt.toISOString(),
        abiertaPor: nombreDeQuienFirma(inc.openedBy),
        abiertaComo: inc.openedWith.careRole.name,
        cerradaEn: inc.closedAt?.toISOString() ?? null,
        cerradaPor: inc.closedBy ? nombreDeQuienFirma(inc.closedBy) : null,
        cerradaComo: inc.closedWith?.careRole.name ?? null,
        autocierre: inc.selfClosed,
        avisadoEn: inc.alertedAt?.toISOString() ?? null,
        medida: inc.sourceRecord
          ? {
              id: inc.sourceRecord.id,
              control: inc.sourceRecord.controlCode,
              en: inc.sourceRecord.recordedAt.toISOString(),
            }
          : null,
        // La CRONOLOGÍA, que es lo que se lee de arriba abajo.
        acciones: inc.actions.map((a) => ({
          id: a.id,
          clase: a.kind,
          texto: leerTexto(
            { cifrado: a.textCifrado, claro: null },
            dek,
            sitioTextoDeAccion(inc.tenantId, a.id),
          ),
          nivelDesde: a.severityFrom,
          nivelHasta: a.severityTo,
          registroId: a.careRecordId,
          llamado: a.called,
          en: a.at.toISOString(),
          por: nombreDeQuienFirma(a.by),
          como: a.byWith.careRole.name,
        })),
        familia: inc.familyCommunications.map((c) => ({
          id: c.id,
          clase: c.kind,
          via: c.channel,
          contacto: c.contactName,
          parentesco: c.contactRelation,
          contenido: leerTexto(
            { cifrado: c.contentCifrado, claro: null },
            dek,
            sitioContenidoAFamilia(inc.tenantId, c.id),
          ),
          respuesta: leerTexto(
            { cifrado: c.responseCifrado, claro: null },
            dek,
            sitioRespuestaDeFamilia(inc.tenantId, c.id),
          ),
          en: c.at.toISOString(),
          por: nombreDeQuienFirma(c.by),
          como: c.byWith.careRole.name,
        })),
        avisos: inc.alerts.map((a) => ({
          id: a.id,
          canal: a.channel,
          nivel: a.severity,
          estado: a.state,
          apuntadoEn: a.queuedAt.toISOString(),
          salidoEn: a.createdAt.toISOString(),
          entregadoEn: a.deliveredAt?.toISOString() ?? null,
          acusadoEn: a.ackedAt?.toISOString() ?? null,
          acusadoPor: a.ackedBy ? nombreDeQuienFirma(a.ackedBy) : null,
          acusadoComo: a.ackedWith?.careRole.name ?? null,
          escalado: a.escalatedFromId != null,
        })),
        enlaces: enlaces.map((e) => ({
          enlaceId: e.enlaceId,
          id: e.otra.id,
          sujeto: e.otra.subject,
          tipo: e.otra.incidentType,
          nombreDelTipo:
            NOMBRE_DEL_TIPO[e.otra.incidentType] ?? e.otra.incidentType,
          nivel: e.otra.severity,
          abierta: e.otra.open,
        })),
        capacidades: quien.capacidades,
        // Lo que la pantalla necesita para no ofrecer un botón que va a
        // fallar: si falta la constancia de familia, el de cerrar se
        // pinta deshabilitado con la frase al lado.
        puedeCerrarse:
          inc.open &&
          (inc.subject !== "RESIDENT" || inc.familyCommunications.length > 0),
      });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  DECLARAR desde el despacho
  // ════════════════════════════════════════════════════════════════
  //
  // Una queja de una familia, una avería del ascensor, o algo de un
  // residente que no se declaró en la puerta. Gradúa con la MISMA
  // plantilla y abre el MISMO libro: es el argumento entero de D-35.
  app.post(
    "/residencia/incidencias",
    {
      preHandler: PUERTAS,
      schema: {
        body: {
          type: "object",
          required: ["sujeto"],
          additionalProperties: false,
          properties: {
            sujeto: { type: "string", enum: SUJETOS as unknown as string[] },
            clientId: { type: ["string", "null"], format: "uuid" },
            /** `CAIDA`, `AVERIA`, `QUEJA`… Vacío = «algo no va bien». */
            evento: { type: ["string", "null"], maxLength: 40 },
            /** `PELIGROSA`, `SIN_RIESGO`, `CON_GOLPE`… */
            matiz: { type: ["string", "null"], maxLength: 40 },
            descripcion: { type: ["string", "null"], maxLength: 2000 },
            careRoleAssignmentId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const quien = await quienEscribe(
        auth.tenantId,
        auth.userId,
        auth.role === "OWNER",
      );
      if ("error" in quien) return reply.code(403).send(quien);

      const body = request.body as {
        sujeto: IncidentSubject;
        clientId?: string | null;
        evento?: string | null;
        matiz?: string | null;
        descripcion?: string | null;
        careRoleAssignmentId?: string;
      };
      const capacidad = capacidadElegida(
        quien.capacidades,
        body.careRoleAssignmentId,
      );
      if (!capacidad) {
        return reply.code(400).send({
          error: "CAPACIDAD_NO_VIGENTE",
          message: "Esa capacidad ya no está vigente. Vuelve a entrar.",
        });
      }
      if (body.sujeto === "RESIDENT" && !body.clientId) {
        return reply.code(400).send({
          error: "FALTA_EL_RESIDENTE",
          message: "Una incidencia de residente tiene que decir de quién es.",
        });
      }
      if (body.sujeto === "MAINTENANCE" && body.clientId) {
        return reply.code(400).send({
          error: "AVERIA_SIN_RESIDENTE",
          message:
            "Una avería no es de nadie: es del edificio. Si se cayó alguien por ella, enlaza las dos incidencias.",
        });
      }

      const prisma = getPrisma();
      const negativa = await negativaClinica(auth.tenantId, "ESCRIBIR");
      if (negativa) {
        return reply
          .code(423)
          .send({ error: negativa.code, code: negativa.code, message: negativa.message });
      }

      const ahora = new Date();
      const turnos = await prisma.centerShift.findMany({
        where: { tenantId: auth.tenantId },
        orderBy: [{ sortOrder: "asc" }],
        select: { id: true, code: true, name: true, startsAt: true, endsAt: true },
      });
      const turno = turnoDe(ahora, turnos);

      try {
        const res = await derivarDeEvento(prisma, {
          tenantId: auth.tenantId,
          subject: body.sujeto,
          clientId: body.clientId ?? null,
          evento: body.evento ?? null,
          matiz: body.matiz ?? null,
          descripcion: body.descripcion ?? null,
          occurridoEn: ahora,
          centerShiftId: turno?.id ?? null,
          careDay: diaDelTurno(ahora, turno),
          firma: {
            userId: auth.userId,
            careRoleAssignmentId: capacidad.assignmentId,
          },
          ahora,
        });
        empujarAvisos(auth.tenantId, res.avisos, ahora);
        return reply.code(201).send({
          id: res.incidentId,
          creada: res.creada,
          nivel: res.nivel,
          subioNivel: res.subioNivel,
          avisadoEn: res.avisos.map((a) => a.canal),
        });
      } catch (err) {
        return errorDeIncidencia(reply, err);
      }
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  «QUÉ SE HIZO» · append-only
  // ════════════════════════════════════════════════════════════════
  app.post(
    "/residencia/incidencias/:id/acciones",
    {
      preHandler: PUERTAS,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["texto"],
          additionalProperties: false,
          properties: {
            texto: { type: "string", minLength: 1, maxLength: 2000 },
            careRoleAssignmentId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const quien = await quienEscribe(
        auth.tenantId,
        auth.userId,
        auth.role === "OWNER",
      );
      if ("error" in quien) return reply.code(403).send(quien);
      const { id } = request.params as { id: string };
      const body = request.body as {
        texto: string;
        careRoleAssignmentId?: string;
      };
      const capacidad = capacidadElegida(quien.capacidades, body.careRoleAssignmentId);
      if (!capacidad) {
        return reply.code(400).send({
          error: "CAPACIDAD_NO_VIGENTE",
          message: "Esa capacidad ya no está vigente. Vuelve a entrar.",
        });
      }
      const prisma = getPrisma();
      const negativa = await negativaClinica(auth.tenantId, "ESCRIBIR");
      if (negativa) {
        return reply
          .code(423)
          .send({ error: negativa.code, code: negativa.code, message: negativa.message });
      }
      const inc = await prisma.incident.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: { id: true },
      });
      if (!inc) {
        return reply.code(404).send({
          error: "INCIDENCIA_NO_ENCONTRADA",
          message: "Esa incidencia no es de este centro.",
        });
      }
      // **También en una cerrada.** Una acción es lo que se hizo, y lo que
      // se hizo puede saberse después: «se habló con la familia el
      // viernes» se apunta el viernes aunque la incidencia se cerrara el
      // jueves. Lo que no se puede es reabrirla ni cambiarle el nivel, y
      // eso lo corta el trigger.
      const accionId = await escribirAccion(prisma, {
        tenantId: auth.tenantId,
        incidentId: inc.id,
        kind: "NOTE",
        texto: body.texto,
        firma: {
          userId: auth.userId,
          careRoleAssignmentId: capacidad.assignmentId,
        },
      });
      return reply.code(201).send({ id: accionId });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  LA CONSTANCIA DE FAMILIA (D-32 a D-34)
  // ════════════════════════════════════════════════════════════════
  app.post(
    "/residencia/incidencias/:id/familia",
    {
      preHandler: PUERTAS,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["clase", "contenido"],
          additionalProperties: false,
          properties: {
            clase: { type: "string", enum: ["COMUNICADO", "NO_COMUNICADO"] },
            via: {
              type: ["string", "null"],
              enum: ["TELEFONO", "PRESENCIAL", "EMAIL", "OTRA", null],
            },
            contacto: { type: ["string", "null"], maxLength: 120 },
            parentesco: { type: ["string", "null"], maxLength: 60 },
            /** Qué se dijo. En un «no comunicado», POR QUÉ no. */
            contenido: { type: "string", minLength: 1, maxLength: 2000 },
            respuesta: { type: ["string", "null"], maxLength: 2000 },
            careRoleAssignmentId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const quien = await quienEscribe(
        auth.tenantId,
        auth.userId,
        auth.role === "OWNER",
      );
      if ("error" in quien) return reply.code(403).send(quien);
      const { id } = request.params as { id: string };
      const body = request.body as {
        clase: FamilyCommunicationKind;
        via?: FamilyCommunicationChannel | null;
        contacto?: string | null;
        parentesco?: string | null;
        contenido: string;
        respuesta?: string | null;
        careRoleAssignmentId?: string;
      };
      const capacidad = capacidadElegida(quien.capacidades, body.careRoleAssignmentId);
      if (!capacidad) {
        return reply.code(400).send({
          error: "CAPACIDAD_NO_VIGENTE",
          message: "Esa capacidad ya no está vigente. Vuelve a entrar.",
        });
      }
      const prisma = getPrisma();
      const negativa = await negativaClinica(auth.tenantId, "ESCRIBIR");
      if (negativa) {
        return reply
          .code(423)
          .send({ error: negativa.code, code: negativa.code, message: negativa.message });
      }
      const inc = await prisma.incident.findFirst({
        where: { id, tenantId: auth.tenantId },
        select: { id: true, subject: true },
      });
      if (!inc) {
        return reply.code(404).send({
          error: "INCIDENCIA_NO_ENCONTRADA",
          message: "Esa incidencia no es de este centro.",
        });
      }
      try {
        const comunicacionId = await escribirComunicacion(prisma, {
          tenantId: auth.tenantId,
          incidentId: inc.id,
          kind: body.clase,
          channel: body.via ?? null,
          contactName: body.contacto ?? null,
          contactRelation: body.parentesco ?? null,
          contenido: body.contenido,
          respuesta: body.respuesta ?? null,
          at: new Date(),
          firma: {
            userId: auth.userId,
            careRoleAssignmentId: capacidad.assignmentId,
          },
        });
        return reply.code(201).send({ id: comunicacionId });
      } catch (err) {
        return errorDeIncidencia(reply, err);
      }
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  CERRAR (D-27, D-28)
  // ════════════════════════════════════════════════════════════════
  app.post(
    "/residencia/incidencias/:id/cerrar",
    {
      preHandler: PUERTAS,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            nota: { type: ["string", "null"], maxLength: 2000 },
            careRoleAssignmentId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const quien = await quienEscribe(
        auth.tenantId,
        auth.userId,
        auth.role === "OWNER",
      );
      if ("error" in quien) return reply.code(403).send(quien);
      const { id } = request.params as { id: string };
      const body = (request.body ?? {}) as {
        nota?: string | null;
        careRoleAssignmentId?: string;
      };
      const capacidad = capacidadElegida(quien.capacidades, body.careRoleAssignmentId);
      if (!capacidad) {
        return reply.code(400).send({
          error: "CAPACIDAD_NO_VIGENTE",
          message: "Esa capacidad ya no está vigente. Vuelve a entrar.",
        });
      }
      const prisma = getPrisma();
      const negativa = await negativaClinica(auth.tenantId, "ESCRIBIR");
      if (negativa) {
        return reply
          .code(423)
          .send({ error: negativa.code, code: negativa.code, message: negativa.message });
      }
      try {
        const res = await cerrarIncidencia(prisma, {
          tenantId: auth.tenantId,
          incidentId: id,
          quien: {
            firma: {
              userId: auth.userId,
              careRoleAssignmentId: capacidad.assignmentId,
            },
            // **La categoría es la de LA capacidad con la que se firma**,
            // no la de todas las suyas. Quien es TO y además dirección
            // cierra como dirección, y entonces eso es lo que queda
            // escrito; cerrar «como TO» no cerraría nada.
            categorias: [capacidad.category],
          },
          nota: body.nota ?? null,
          ahora: new Date(),
        });
        return reply.code(200).send(res);
      } catch (err) {
        return errorDeIncidencia(reply, err);
      }
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  ENLAZAR DOS (D-35)
  // ════════════════════════════════════════════════════════════════
  app.post(
    "/residencia/incidencias/:id/enlaces",
    {
      preHandler: PUERTAS,
      schema: {
        params: {
          type: "object",
          required: ["id"],
          additionalProperties: false,
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["otraId"],
          additionalProperties: false,
          properties: { otraId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const quien = await quienEscribe(
        auth.tenantId,
        auth.userId,
        auth.role === "OWNER",
      );
      if ("error" in quien) return reply.code(403).send(quien);
      const { id } = request.params as { id: string };
      const { otraId } = request.body as { otraId: string };
      try {
        const res = await enlazarIncidencias(getPrisma(), {
          tenantId: auth.tenantId,
          unaId: id,
          otraId,
          userId: auth.userId,
        });
        return reply.code(res.yaEstaba ? 200 : 201).send(res);
      } catch (err) {
        return errorDeIncidencia(reply, err);
      }
    },
  );

  // Deshacer un enlace **sí se puede**, al revés que todo lo demás de
  // este bloque: enlazar mal dos incidencias es un error de dedo y
  // deshacerlo no borra ninguna evidencia — las dos siguen enteras.
  app.delete(
    "/residencia/incidencias/:id/enlaces/:otraId",
    {
      preHandler: PUERTAS,
      schema: {
        params: {
          type: "object",
          required: ["id", "otraId"],
          additionalProperties: false,
          properties: {
            id: { type: "string", format: "uuid" },
            otraId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const quien = await quienEscribe(
        auth.tenantId,
        auth.userId,
        auth.role === "OWNER",
      );
      if ("error" in quien) return reply.code(403).send(quien);
      const { id, otraId } = request.params as { id: string; otraId: string };
      const [aId, bId] = id < otraId ? [id, otraId] : [otraId, id];
      const { count } = await getPrisma().incidentLink.deleteMany({
        where: { tenantId: auth.tenantId, aId, bId },
      });
      return reply.code(200).send({ borrados: count });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  LA PLANTILLA DE SERIE, EN SOLO LECTURA (D-65)
  // ════════════════════════════════════════════════════════════════
  //
  // **Solo lectura, y es la pantalla entera.** No hay botón de editar y
  // no es un olvido: un centro no toca umbrales ni niveles (D-21, rama
  // §10). Lo que la pantalla enseña es qué gradúa cada cosa y con qué
  // versión, para que la dirección pueda explicárselo a la médica — y
  // para que cuando alguien pregunte «¿por qué sonó?», la respuesta esté
  // escrita.
  app.get(
    "/residencia/plantilla-de-gravedad",
    { preHandler: PUERTAS },
    async (request: FastifyRequest) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const [plantilla, filas] = await Promise.all([
        plantillaVigente(prisma),
        prisma.severityRule.findMany({
          where: { scope: "STANDARD", supersededAt: null },
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            kind: true,
            controlCode: true,
            comparator: true,
            value: true,
            eventType: true,
            qualifier: true,
            severity: true,
            incidentType: true,
            validFrom: true,
          },
        }),
      ]);
      const guardia = await configuracionDeGuardia(prisma, auth.tenantId);
      return {
        version: plantilla.version,
        vigenteDesde: filas[0]?.validFrom.toISOString() ?? null,
        reglas: filas.map((f) => ({
          id: f.id,
          clase: f.kind,
          control: f.controlCode,
          comparador: f.comparator,
          valor: f.value == null ? null : Number(f.value),
          evento: f.eventType,
          matiz: f.qualifier,
          nivel: f.severity,
          nombreDelNivel: NOMBRE_DEL_NIVEL[f.severity],
          tipo: f.incidentType,
          nombreDelTipo: NOMBRE_DEL_TIPO[f.incidentType] ?? f.incidentType,
        })),
        niveles: NIVELES.map((n) => ({ nivel: n, nombre: NOMBRE_DEL_NIVEL[n] })),
        // Y a quién le suena cada nivel en ESTE centro, que es la mitad
        // configurable (§10). Se pinta junto a la plantilla porque
        // leerlas por separado deja la pregunta a medias.
        destinatarios: guardia.porNivel,
        minutosDeEscalado: guardia.minutosDeEscalado,
      };
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  LAS EXCEPCIONES DE UMBRAL POR RESIDENTE (D-22)
  // ════════════════════════════════════════════════════════════════
  app.get(
    "/residencia/residentes/:clientId/umbrales",
    {
      preHandler: PUERTAS,
      schema: {
        params: {
          type: "object",
          required: ["clientId"],
          additionalProperties: false,
          properties: { clientId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const quien = await quienEscribe(
        auth.tenantId,
        auth.userId,
        auth.role === "OWNER",
      );
      if ("error" in quien) return reply.code(403).send(quien);
      const { clientId } = request.params as { clientId: string };
      return conHistoria(request, reply, { clientId, action: "READ" }, async () => {
        const prisma = getPrisma();
        const dek = await dekONada(auth.tenantId, prisma);
        const filas = await prisma.residentThresholdOverride.findMany({
          where: { tenantId: auth.tenantId, clientId },
          orderBy: { fromAt: "desc" },
          select: {
            id: true,
            tenantId: true,
            controlCode: true,
            reasonCifrado: true,
            fromAt: true,
            toAt: true,
            revokedAt: true,
            signedAt: true,
            signedBy: { select: { alias: true, email: true } },
            signedWith: { select: { careRole: { select: { name: true } } } },
            rules: {
              orderBy: { sortOrder: "asc" },
              select: {
                comparator: true,
                value: true,
                severity: true,
                incidentType: true,
              },
            },
          },
        });
        return {
          excepciones: filas.map((f) => ({
            id: f.id,
            control: f.controlCode,
            motivo: leerTexto(
              { cifrado: f.reasonCifrado, claro: null },
              dek,
              sitioMotivoDeExcepcion(f.tenantId, f.id),
            ),
            desde: f.fromAt.toISOString(),
            hasta: f.toAt?.toISOString() ?? null,
            revocadaEn: f.revokedAt?.toISOString() ?? null,
            firmadaEn: f.signedAt.toISOString(),
            firmadaPor: nombreDeQuienFirma(f.signedBy),
            firmadaComo: f.signedWith.careRole.name,
            reglas: f.rules.map((r) => ({
              comparador: r.comparator,
              valor: Number(r.value),
              nivel: r.severity,
              tipo: r.incidentType,
            })),
          })),
          capacidades: quien.capacidades,
        };
      });
    },
  );

  app.post(
    "/residencia/residentes/:clientId/umbrales",
    {
      preHandler: PUERTAS,
      schema: {
        params: {
          type: "object",
          required: ["clientId"],
          additionalProperties: false,
          properties: { clientId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["control", "motivo", "reglas"],
          additionalProperties: false,
          properties: {
            control: { type: "string", maxLength: 60 },
            motivo: { type: "string", minLength: 1, maxLength: 1000 },
            desde: { type: "string" },
            hasta: { type: ["string", "null"] },
            reglas: {
              type: "array",
              maxItems: 8,
              items: {
                type: "object",
                required: ["comparador", "valor", "nivel", "tipo"],
                additionalProperties: false,
                properties: {
                  comparador: { type: "string", enum: ["GTE", "GT", "LTE", "LT"] },
                  valor: { type: "number", minimum: -10000, maximum: 10000 },
                  nivel: { type: "string", enum: NIVELES as unknown as string[] },
                  tipo: { type: "string", maxLength: 40 },
                },
              },
            },
            careRoleAssignmentId: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const quien = await quienEscribe(
        auth.tenantId,
        auth.userId,
        auth.role === "OWNER",
      );
      if ("error" in quien) return reply.code(403).send(quien);
      const { clientId } = request.params as { clientId: string };
      const body = request.body as {
        control: string;
        motivo: string;
        desde?: string;
        hasta?: string | null;
        reglas: Array<{
          comparador: "GTE" | "GT" | "LTE" | "LT";
          valor: number;
          nivel: SeverityLevel;
          tipo: string;
        }>;
        careRoleAssignmentId?: string;
      };
      const capacidad = capacidadElegida(quien.capacidades, body.careRoleAssignmentId);
      if (!capacidad) {
        return reply.code(400).send({
          error: "CAPACIDAD_NO_VIGENTE",
          message: "Esa capacidad ya no está vigente. Vuelve a entrar.",
        });
      }
      return conHistoria(request, reply, { clientId, action: "WRITE" }, async () => {
        try {
          const id = await pautarExcepcion(getPrisma(), {
            tenantId: auth.tenantId,
            clientId,
            controlCode: body.control.trim().toUpperCase(),
            motivo: body.motivo,
            desde: body.desde ? new Date(body.desde) : new Date(),
            hasta: body.hasta ? new Date(body.hasta) : null,
            reglas: body.reglas.map((r) => ({
              comparador: r.comparador,
              valor: r.valor,
              nivel: r.nivel,
              tipo: r.tipo.trim().toUpperCase(),
            })),
            firma: {
              userId: auth.userId,
              careRoleAssignmentId: capacidad.assignmentId,
            },
            rolCode: capacidad.code,
          });
          reply.code(201);
          return { id };
        } catch (err) {
          if (err instanceof IncidenciaInvalida) {
            reply.code(409);
            return { error: err.codigo, message: err.message };
          }
          throw err;
        }
      });
    },
  );

  app.delete(
    "/residencia/residentes/:clientId/umbrales/:id",
    {
      preHandler: PUERTAS,
      schema: {
        params: {
          type: "object",
          required: ["clientId", "id"],
          additionalProperties: false,
          properties: {
            clientId: { type: "string", format: "uuid" },
            id: { type: "string", format: "uuid" },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const quien = await quienEscribe(
        auth.tenantId,
        auth.userId,
        auth.role === "OWNER",
      );
      if ("error" in quien) return reply.code(403).send(quien);
      const { clientId, id } = request.params as { clientId: string; id: string };
      const capacidad = capacidadElegida(quien.capacidades, undefined);
      if (capacidad?.code !== "MEDICO") {
        return reply.code(409).send({
          error: "EXCEPCION_ES_DEL_MEDICO",
          message:
            "Retirar una excepción de umbral es una decisión médica: sólo la retira quien entra con el rol de médico.",
        });
      }
      // **Revocar, no borrar**: la pauta existió y la incidencia que no se
      // abrió por ella se explica con ella. Mismo criterio que
      // `CareRoleAssignment`.
      const { count } = await getPrisma().residentThresholdOverride.updateMany({
        where: { id, clientId, tenantId: auth.tenantId, revokedAt: null },
        data: { revokedAt: new Date(), revokedByUserId: auth.userId },
      });
      if (count === 0) {
        return reply.code(404).send({
          error: "EXCEPCION_NO_ENCONTRADA",
          message: "Esa excepción no existe o ya estaba retirada.",
        });
      }
      return reply.code(200).send({ revocadas: count });
    },
  );

  // ════════════════════════════════════════════════════════════════
  //  LA CONFIGURACIÓN DE GUARDIA DEL CENTRO (§10)
  // ════════════════════════════════════════════════════════════════
  app.get(
    "/residencia/guardia/configuracion",
    { preHandler: PUERTAS },
    async (request: FastifyRequest) => {
      const auth = request.auth!;
      const prisma = getPrisma();
      const [config, moviles, deGuardia] = await Promise.all([
        configuracionDeGuardia(prisma, auth.tenantId),
        prisma.device.findMany({
          where: { tenantId: auth.tenantId, kind: "GUARD" },
          orderBy: [{ guardChannel: "asc" }, { pairedAt: "asc" }],
          select: {
            id: true,
            name: true,
            guardChannel: true,
            pairedAt: true,
            lastSeenAt: true,
            revokedAt: true,
          },
        }),
        prisma.guardShiftSession.findMany({
          where: { tenantId: auth.tenantId, endedAt: null },
          select: {
            deviceId: true,
            channel: true,
            startedAt: true,
            user: { select: { alias: true, email: true } },
          },
        }),
      ]);
      const porDispositivo = new Map(deGuardia.map((g) => [g.deviceId, g]));
      return {
        minutosDeEscalado: config.minutosDeEscalado,
        destinatarios: {
          N2: config.porNivel.N2 ?? ["ENFERMERIA"],
          N3: config.porNivel.N3 ?? ["ENFERMERIA", "RESPONSABLE"],
          N4: config.porNivel.N4 ?? ["ENFERMERIA", "RESPONSABLE"],
        },
        servicio: config.servicio,
        moviles: moviles.map((d) => {
          const g = porDispositivo.get(d.id);
          return {
            id: d.id,
            nombre: d.name,
            canal: d.guardChannel,
            emparejadoEn: d.pairedAt.toISOString(),
            vistoEn: d.lastSeenAt?.toISOString() ?? null,
            revocado: d.revokedAt != null,
            deGuardia: g
              ? { nombre: nombreDeQuienFirma(g.user), desde: g.startedAt.toISOString() }
              : null,
          };
        }),
      };
    },
  );

  app.put(
    "/residencia/guardia/configuracion",
    {
      preHandler: PUERTAS,
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            minutosDeEscalado: { type: "integer", minimum: 1, maximum: 60 },
            destinatarios: {
              type: "object",
              additionalProperties: false,
              properties: {
                N2: {
                  type: "array",
                  maxItems: 2,
                  uniqueItems: true,
                  items: { type: "string", enum: ["ENFERMERIA", "RESPONSABLE"] },
                },
                N3: {
                  type: "array",
                  maxItems: 2,
                  uniqueItems: true,
                  items: { type: "string", enum: ["ENFERMERIA", "RESPONSABLE"] },
                },
                N4: {
                  type: "array",
                  maxItems: 2,
                  uniqueItems: true,
                  items: { type: "string", enum: ["ENFERMERIA", "RESPONSABLE"] },
                },
              },
            },
            servicio: {
              type: ["object", "null"],
              required: ["nombre", "telefono"],
              additionalProperties: false,
              properties: {
                nombre: { type: "string", minLength: 1, maxLength: 120 },
                telefono: { type: "string", minLength: 3, maxLength: 30 },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const quien = await quienEscribe(
        auth.tenantId,
        auth.userId,
        auth.role === "OWNER",
      );
      if ("error" in quien) return reply.code(403).send(quien);
      const body = (request.body ?? {}) as {
        minutosDeEscalado?: number;
        destinatarios?: {
          N2?: Array<"ENFERMERIA" | "RESPONSABLE">;
          N3?: Array<"ENFERMERIA" | "RESPONSABLE">;
          N4?: Array<"ENFERMERIA" | "RESPONSABLE">;
        };
        servicio?: { nombre: string; telefono: string } | null;
      };
      const actual = await configuracionDeGuardia(getPrisma(), auth.tenantId);
      const datos = {
        escalationMinutes: body.minutosDeEscalado ?? actual.minutosDeEscalado,
        levelN2Channels: body.destinatarios?.N2 ?? actual.porNivel.N2 ?? ["ENFERMERIA"],
        levelN3Channels:
          body.destinatarios?.N3 ?? actual.porNivel.N3 ?? ["ENFERMERIA", "RESPONSABLE"],
        levelN4Channels:
          body.destinatarios?.N4 ?? actual.porNivel.N4 ?? ["ENFERMERIA", "RESPONSABLE"],
        healthServiceName:
          body.servicio === undefined
            ? (actual.servicio?.nombre ?? null)
            : (body.servicio?.nombre ?? null),
        healthServicePhone:
          body.servicio === undefined
            ? (actual.servicio?.telefono ?? null)
            : (body.servicio?.telefono ?? null),
      };
      await getPrisma().centerGuardSetting.upsert({
        where: { tenantId: auth.tenantId },
        create: { tenantId: auth.tenantId, ...datos },
        update: datos,
      });
      return reply.code(200).send({ ok: true });
    },
  );
}
