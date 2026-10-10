// clinica-4 · las rutas del consentimiento informado.
//
//   GET  /clinica/clients/:clientId/consentimientos         — la pantalla
//   POST /clinica/clients/:clientId/consentimientos         — FIRMAR
//   POST /clinica/clients/:clientId/consentimientos/:id/revocar
//   GET  /clinica/clients/:clientId/consentimientos/:id/pdf — el documento
//
// Las cuatro pasan por `conHistoria` (`registro.ts`), así que **cada una
// deja su línea en `ClinicalAccessLog` antes de hacer nada**, y las cuatro
// llevan `ensureClinicaEnabled`, que con el módulo apagado contesta la 404
// de Fastify carácter por carácter.
//
// Las cuatro exigen `SANITARIO`. No hay un `PERSONAL_DEL_CENTRO` aquí,
// al contrario que «mandar el test» de clinica-2: **lo clínico se firma en
// consulta, con el sanitario delante** (S3, decidido), así que la
// recepcionista no firma un consentimiento clínico ni abre su PDF, y el
// intento le queda escrito.
//
// ── Y el alta manual del spa sigue donde estaba ──────────────────────
//
// `POST /clients/:id/consents` (B1, `crm/routes.ts`) **no se toca**. La
// dueña de un spa sigue dando de alta su consentimiento desde la ficha del
// cliente, sin plantilla y sin PDF, como hasta hoy. Lo que este bloque
// añade es el camino clínico, no un sustituto del de nadie.
//
// ── EL PDF no se cachea, y lo dice la cabecera ───────────────────────
//
// `no-store` y `nosniff`, igual que las capturas de A5: un documento con
// datos de salud no se queda en la caché de un navegador compartido.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { PLANTILLAS_IDS } from "@mipiacetpv/consentimientos";

import { requireOwnerOrCashier } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import {
  consentimientoParaPdf,
  firmarConsentimiento,
  revocarConsentimiento,
  vistaDeConsentimientos,
} from "./consentimientos.js";
import { leerFichero, MIME_DE_PDF } from "./ficheros.js";
import { ensureClinicaEnabled } from "./gate.js";
import { conHistoria } from "./registro.js";

const guard = { preHandler: [requireOwnerOrCashier, ensureClinicaEnabled] };

const PARAMS_PACIENTE = {
  type: "object",
  required: ["clientId"],
  additionalProperties: false,
  properties: { clientId: { type: "string", format: "uuid" } },
} as const;

const PARAMS_CONSENTIMIENTO = {
  type: "object",
  required: ["clientId", "consentimientoId"],
  additionalProperties: false,
  properties: {
    clientId: { type: "string", format: "uuid" },
    consentimientoId: { type: "string", format: "uuid" },
  },
} as const;

/** El PNG de la firma del dedo. Un trazo de 700×180 ronda los 10 KB; el
 *  tope es la red de seguridad, no el objetivo. */
const FIRMA_MAXIMA_BASE64 = 2_000_000;

function pacienteNoExiste(reply: FastifyReply) {
  return reply.code(404).send({
    error: "CLIENT_NOT_FOUND",
    code: "CLIENT_NOT_FOUND",
    message: "Paciente no encontrado.",
  });
}

/**
 * ¿Existe este paciente en este tenant?
 *
 * La puerta de AISLAMIENTO, antes de la de autorización clínica: un id de
 * otro tenant tiene que ser 404 antes de que nadie pregunte si este
 * sanitario podría verlo. Mismo orden que el resto de lo clínico.
 */
async function existePaciente(
  tenantId: string,
  clientId: string,
): Promise<boolean> {
  const fila = await getPrisma().client.findFirst({
    where: { id: clientId, tenantId },
    select: { id: true },
  });
  return fila != null;
}

/** ¿Lleva este usuario la marca sanitaria? La exige la plantilla clínica. */
async function esSanitario(tenantId: string, userId: string): Promise<boolean> {
  const u = await getPrisma().user.findFirst({
    where: { id: userId, tenantId },
    select: { isClinician: true },
  });
  return u?.isClinician === true;
}

/**
 * La firma, decodificada. `null` si no llega o no es un PNG.
 *
 * Se comprueba la firma del fichero y no lo que diga la pantalla, igual
 * que con las fotos: el PNG se va a incrustar en un PDF que se entrega.
 */
function decodificarFirma(base64: string | undefined): Buffer | null {
  if (!base64) return null;
  const buf = Buffer.from(base64, "base64");
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length <= PNG.length || !buf.subarray(0, 8).equals(PNG)) return null;
  return buf;
}

export async function registerConsentimientosRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── La pantalla ─────────────────────────────────────────────────────
  //
  // Las tres plantillas con su estado para este paciente, lo firmado (con
  // lo revocado marcado) y, si se abre desde una cita, qué pide esa cita.
  app.get(
    "/clinica/clients/:clientId/consentimientos",
    {
      ...guard,
      schema: {
        params: PARAMS_PACIENTE,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { appointmentId: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      const { appointmentId } = request.query as { appointmentId?: string };
      if (!(await existePaciente(auth.tenantId, clientId))) {
        return pacienteNoExiste(reply);
      }
      return conHistoria(
        request,
        reply,
        { clientId, action: "READ" },
        async (ctx) => {
          const prisma = getPrisma();
          // Los servicios de la cita, si viene una. El `clientId` de la
          // cita se comprueba contra el de la ruta: una cita de otra
          // persona no puede decidir qué consentimientos pide ESTA
          // pantalla (la lección de las anotaciones de clinica-1).
          let servicioIds: string[] = [];
          if (appointmentId) {
            const cita = await prisma.appointment.findFirst({
              where: {
                id: appointmentId,
                tenantId: ctx.tenantId,
                clientId,
              },
              select: { items: { select: { serviceId: true } } },
            });
            servicioIds = [
              ...new Set((cita?.items ?? []).map((i) => i.serviceId)),
            ];
          }
          return vistaDeConsentimientos(prisma, {
            tenantId: ctx.tenantId,
            clientId,
            servicioIds,
          });
        },
      );
    },
  );

  // ── FIRMAR ──────────────────────────────────────────────────────────
  //
  // Escribe la fila UNA vez; a partir de ahí el trigger
  // `client_consents_append_only` la deja congelada. No hay PATCH ni
  // DELETE en este fichero, y si alguien los escribiera el motor los
  // rechazaría igual.
  app.post(
    "/clinica/clients/:clientId/consentimientos",
    {
      ...guard,
      schema: {
        params: PARAMS_PACIENTE,
        body: {
          type: "object",
          required: ["plantillaId", "firmante", "firmaPngBase64"],
          additionalProperties: false,
          properties: {
            plantillaId: { type: "string", enum: [...PLANTILLAS_IDS] },
            firmante: {
              type: "object",
              required: ["clase"],
              additionalProperties: false,
              properties: {
                clase: { type: "string", enum: ["PACIENTE", "REPRESENTANTE"] },
                nombre: { type: ["string", "null"], maxLength: 120 },
                relacion: { type: ["string", "null"], maxLength: 60 },
              },
            },
            firmaPngBase64: {
              type: "string",
              minLength: 1,
              maxLength: FIRMA_MAXIMA_BASE64,
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      if (!(await existePaciente(auth.tenantId, clientId))) {
        return pacienteNoExiste(reply);
      }
      return conHistoria(
        request,
        reply,
        { clientId, action: "WRITE" },
        async (ctx) => {
          const body = request.body as {
            plantillaId: string;
            firmante: {
              clase: "PACIENTE" | "REPRESENTANTE";
              nombre?: string | null;
              relacion?: string | null;
            };
            firmaPngBase64: string;
          };
          const firmaPng = decodificarFirma(body.firmaPngBase64);
          if (!firmaPng) {
            return reply.code(400).send({
              error: "FIRMA_INVALIDA",
              code: "FIRMA_INVALIDA",
              message:
                "La firma no llegó bien. Que el paciente vuelva a firmar con el dedo.",
            });
          }
          const r = await firmarConsentimiento(getPrisma(), {
            tenantId: ctx.tenantId,
            clientId,
            userId: ctx.userId,
            usuarioEsSanitario: await esSanitario(ctx.tenantId, ctx.userId),
            plantillaId: body.plantillaId,
            firmante: {
              clase: body.firmante.clase,
              nombre: body.firmante.nombre ?? null,
              relacion: body.firmante.relacion ?? null,
            },
            firmaPng,
            ahora: new Date(),
          });
          if (!r.ok) {
            // 409 y no 400: la petición está bien formada, es el sistema
            // diciendo que así no. Y sin `captureError`, porque una
            // negativa esperada no es una alarma de Sentry (clinica-1 §9).
            return reply
              .code(409)
              .send({ error: r.motivo, code: r.motivo, message: r.mensaje });
          }
          return reply.code(201).send({ consentimiento: r.consentimiento });
        },
      );
    },
  );

  // ── REVOCAR: una fila nueva, nunca un UPDATE ────────────────────────
  app.post(
    "/clinica/clients/:clientId/consentimientos/:consentimientoId/revocar",
    {
      ...guard,
      schema: {
        params: PARAMS_CONSENTIMIENTO,
        body: {
          type: "object",
          required: ["motivo"],
          additionalProperties: false,
          properties: {
            // Obligatorio y corto: lo que alguien va a preguntar dentro de
            // dos años es POR QUÉ, y «lo revocó Lucía» no lo contesta.
            motivo: { type: "string", minLength: 3, maxLength: 200 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId, consentimientoId } = request.params as {
        clientId: string;
        consentimientoId: string;
      };
      if (!(await existePaciente(auth.tenantId, clientId))) {
        return pacienteNoExiste(reply);
      }
      return conHistoria(
        request,
        reply,
        { clientId, action: "WRITE" },
        async (ctx) => {
          const { motivo } = request.body as { motivo: string };
          const r = await revocarConsentimiento(getPrisma(), {
            tenantId: ctx.tenantId,
            clientId,
            userId: ctx.userId,
            consentimientoId,
            motivo,
            ahora: new Date(),
          });
          if (!r.ok) {
            const codigo = r.motivo === "NO_EXISTE" ? 404 : 409;
            return reply
              .code(codigo)
              .send({ error: r.motivo, code: r.motivo, message: r.mensaje });
          }
          return reply.code(201).send({ revocacionId: r.revocacionId });
        },
      );
    },
  );

  // ── El PDF ──────────────────────────────────────────────────────────
  //
  // Decisión 8: un PDF de plantilla clínica se abre por `conHistoria` y
  // deja su línea en el registro. Lo que hace que eso sea verdad es que
  // **esta ruta es la única forma de llegar al fichero**: el volumen no lo
  // sirve Caddy y el nombre del fichero no es una URL.
  app.get(
    "/clinica/clients/:clientId/consentimientos/:consentimientoId/pdf",
    { ...guard, schema: { params: PARAMS_CONSENTIMIENTO } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId, consentimientoId } = request.params as {
        clientId: string;
        consentimientoId: string;
      };
      if (!(await existePaciente(auth.tenantId, clientId))) {
        return pacienteNoExiste(reply);
      }
      return conHistoria(
        request,
        reply,
        { clientId, action: "READ" },
        async (ctx) => {
          const fila = await consentimientoParaPdf(getPrisma(), {
            tenantId: ctx.tenantId,
            clientId,
            consentimientoId,
          });
          if (!fila) {
            return reply.code(404).send({
              error: "CONSENT_NOT_FOUND",
              code: "CONSENT_NOT_FOUND",
              message: "Ese consentimiento no tiene documento guardado.",
            });
          }
          const leido = await leerFichero(
            "CONSENTIMIENTO",
            fila.pdfFileName,
            fila.pdfSha256,
          );
          if (!leido) {
            // El fichero no está. Se dice, y no se calla con un 404
            // genérico: en una historia clínica, «el documento que esta
            // fila promete no está en el disco» es un incidente que
            // alguien tiene que atender, no una página que falta.
            request.log.error(
              { event: "consentimiento_sin_fichero", consentimientoId },
              "la fila de un consentimiento apunta a un PDF que no está en el volumen",
            );
            return reply.code(410).send({
              error: "CONSENT_FILE_MISSING",
              code: "CONSENT_FILE_MISSING",
              message:
                "El documento firmado no está en el servidor. Avisa a Mi Piace: la historia dice que existe.",
            });
          }
          return reply
            .header("Content-Type", MIME_DE_PDF)
            .header("Content-Length", leido.bytes)
            // Un documento con datos de salud no se queda en la caché de
            // una tablet compartida.
            .header("Cache-Control", "no-store")
            .header("X-Content-Type-Options", "nosniff")
            // Y si la huella no cuadra, se dice en una cabecera en vez de
            // esconder el documento: un PDF que no cuadra es justo el que
            // alguien tiene que mirar, y esconderlo borra la única pista.
            .header("X-Huella-Cuadra", leido.huellaCuadra ? "si" : "NO")
            .send(leido.contenido);
        },
      );
    },
  );
}
