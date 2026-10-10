// clinica-4 · las rutas de las fotos clínicas.
//
//   POST /clinica/appointments/:appointmentId/fotos      — hacer una foto
//   GET  /clinica/clients/:clientId/fotos                — todas + comparador
//   GET  /clinica/clients/:clientId/fotos/:fotoId/imagen — el JPEG
//   POST /clinica/clients/:clientId/fotos/:fotoId/retirar
//
// Las cuatro pasan por `conHistoria`, así que **ninguna foto se ve sin
// dejar línea en `ClinicalAccessLog`** (decisión 11), y las cuatro llevan
// `ensureClinicaEnabled`.
//
// ── La de hacer la foto cuelga de la CITA ────────────────────────────
//
// Decisión 9: las fotos se hacen DESDE LA SESIÓN. Así que la ruta de
// escribir cuelga de la cita, igual que la sesión de clinica-3 y por el
// mismo motivo: el paciente sale DE LA CITA, y quien llama no puede decir
// de quién es la foto que acaba de hacer.
//
// Las de leer cuelgan del PACIENTE, igual que la historia viva: una foto
// de hace un año no es de la cita de hoy, y el comparador antes/hoy es
// justo el que cruza citas distintas.
//
// ── El JPEG no se cachea y no se adivina ─────────────────────────────
//
// `no-store` y `nosniff`. Y el nombre del fichero no es una URL: el
// volumen no lo sirve Caddy, así que **esta ruta es la única forma de
// llegar a una foto** — que es lo que hace verdad la frase «cada apertura
// deja su línea».

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { MAPA_PIE_V1, clavesDelMapa } from "@mipiacetpv/clinica-sesion";

import { requireOwnerOrCashier } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import { puertaDeFotos } from "./consentimientos.js";
import { decodificarFoto, FotoInvalida, leerFichero } from "./ficheros.js";
import {
  comparadorPorZona,
  fotoParaServir,
  fotosDelPaciente,
  guardarFoto,
  retirarFoto,
} from "./fotos.js";
import { ensureClinicaEnabled } from "./gate.js";
import { conHistoria } from "./registro.js";
import { cargarCitaDeLaSesion } from "./sesion.js";

const guard = { preHandler: [requireOwnerOrCashier, ensureClinicaEnabled] };

/** El JPEG en base64. 4 MB de binario son ~5,4 MB en base64. */
const FOTO_MAXIMA_BASE64 = 6_000_000;

const PARAMS_PACIENTE = {
  type: "object",
  required: ["clientId"],
  additionalProperties: false,
  properties: { clientId: { type: "string", format: "uuid" } },
} as const;

const PARAMS_FOTO = {
  type: "object",
  required: ["clientId", "fotoId"],
  additionalProperties: false,
  properties: {
    clientId: { type: "string", format: "uuid" },
    fotoId: { type: "string", format: "uuid" },
  },
} as const;

function pacienteNoExiste(reply: FastifyReply) {
  return reply.code(404).send({
    error: "CLIENT_NOT_FOUND",
    code: "CLIENT_NOT_FOUND",
    message: "Paciente no encontrado.",
  });
}

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

export async function registerFotosRoutes(app: FastifyInstance): Promise<void> {
  // ── Hacer una foto ──────────────────────────────────────────────────
  app.post(
    "/clinica/appointments/:appointmentId/fotos",
    {
      ...guard,
      schema: {
        params: {
          type: "object",
          required: ["appointmentId"],
          additionalProperties: false,
          properties: { appointmentId: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["zona", "jpegBase64"],
          additionalProperties: false,
          properties: {
            // La zona, de la lista CERRADA del mapa vigente: se elige
            // antes de disparar (decisión 9 y el mockup). El `enum` la
            // rechaza antes de que nadie toque el disco.
            zona: { type: "string", enum: [...clavesDelMapa(MAPA_PIE_V1.version)] },
            jpegBase64: {
              type: "string",
              minLength: 1,
              maxLength: FOTO_MAXIMA_BASE64,
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { appointmentId } = request.params as { appointmentId: string };
      const cita = await cargarCitaDeLaSesion(getPrisma(), {
        tenantId: auth.tenantId,
        appointmentId,
      });
      if (!cita) {
        return reply.code(404).send({
          error: "APPOINTMENT_NOT_FOUND",
          code: "APPOINTMENT_NOT_FOUND",
          message: "Cita no encontrada.",
        });
      }
      return conHistoria(
        request,
        reply,
        { clientId: cita.clientId, action: "WRITE" },
        async (ctx) => {
          const prisma = getPrisma();
          let jpeg: Buffer;
          try {
            jpeg = decodificarFoto(request.body);
          } catch (err) {
            if (err instanceof FotoInvalida) {
              return reply.code(400).send({
                error: "FOTO_INVALIDA",
                code: "FOTO_INVALIDA",
                message: err.message,
              });
            }
            throw err;
          }
          // LA PUERTA DEL CONSENTIMIENTO DE FOTOS (decisión 10). Se
          // comprueba en el camino de ESCRITURA y no sólo en la pantalla:
          // una pantalla que lo enseñe es una ayuda, una ruta que lo
          // exige es la garantía.
          const puerta = await puertaDeFotos(prisma, {
            tenantId: ctx.tenantId,
            clientId: cita.clientId,
          });
          const r = await guardarFoto(prisma, {
            tenantId: ctx.tenantId,
            clientId: cita.clientId,
            appointmentId: cita.id,
            autorUserId: ctx.userId,
            zona: (request.body as { zona: string }).zona,
            jpeg,
            hayConsentimiento: puerta.puede,
          });
          if (!r.ok) {
            return reply.code(409).send({
              error: r.motivo,
              code: r.motivo,
              message: r.mensaje,
              // Y el camino para arreglarlo, como la puerta de la
              // valoración de clinica-2: la pantalla lleva a firmarlo en
              // vez de dejar a la podóloga adivinando.
              plantillaId:
                r.motivo === "SIN_CONSENTIMIENTO_DE_FOTOS"
                  ? puerta.plantillaId
                  : undefined,
            });
          }
          return reply.code(201).send({ foto: r.foto });
        },
      );
    },
  );

  // ── Todas las fotos de un paciente, y el comparador por zona ────────
  app.get(
    "/clinica/clients/:clientId/fotos",
    { ...guard, schema: { params: PARAMS_PACIENTE } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      if (!(await existePaciente(auth.tenantId, clientId))) {
        return pacienteNoExiste(reply);
      }
      return conHistoria(
        request,
        reply,
        { clientId, action: "READ" },
        async (ctx) => {
          const prisma = getPrisma();
          const [fotos, consentimiento] = await Promise.all([
            fotosDelPaciente(prisma, { tenantId: ctx.tenantId, clientId }),
            puertaDeFotos(prisma, { tenantId: ctx.tenantId, clientId }),
          ]);
          return {
            fotos,
            // El comparador se calcula AQUÍ y no en la pantalla, igual que
            // el estado de las zonas en clinica-6: «la primera y la
            // última» es una regla de la historia, no una de pintar.
            comparador: comparadorPorZona(fotos),
            // Y si no hay consentimiento, la pantalla lleva a firmarlo en
            // vez de ofrecer una cámara que va a dar un 409.
            consentimiento: {
              puede: consentimiento.puede,
              plantillaId: consentimiento.plantillaId,
              mensaje: consentimiento.mensaje,
            },
            mapaVersion: MAPA_PIE_V1.version,
          };
        },
      );
    },
  );

  // ── El JPEG ─────────────────────────────────────────────────────────
  app.get(
    "/clinica/clients/:clientId/fotos/:fotoId/imagen",
    { ...guard, schema: { params: PARAMS_FOTO } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId, fotoId } = request.params as {
        clientId: string;
        fotoId: string;
      };
      if (!(await existePaciente(auth.tenantId, clientId))) {
        return pacienteNoExiste(reply);
      }
      return conHistoria(
        request,
        reply,
        { clientId, action: "READ" },
        async (ctx) => {
          const fila = await fotoParaServir(getPrisma(), {
            tenantId: ctx.tenantId,
            clientId,
            fotoId,
          });
          if (!fila) {
            return reply.code(404).send({
              error: "PHOTO_NOT_FOUND",
              code: "PHOTO_NOT_FOUND",
              message: "Esa foto no está en la historia de este paciente.",
            });
          }
          const leido = await leerFichero("FOTO", fila.fileName, fila.sha256);
          if (!leido) {
            request.log.error(
              { event: "foto_sin_fichero", fotoId },
              "la fila de una foto apunta a un fichero que no está en el volumen",
            );
            return reply.code(410).send({
              error: "PHOTO_FILE_MISSING",
              code: "PHOTO_FILE_MISSING",
              message:
                "Esa foto no está en el servidor. Avisa a Mi Piace: la historia dice que existe.",
            });
          }
          return reply
            .header("Content-Type", fila.mimeType)
            .header("Content-Length", leido.bytes)
            .header("Cache-Control", "no-store")
            .header("X-Content-Type-Options", "nosniff")
            .header("X-Huella-Cuadra", leido.huellaCuadra ? "si" : "NO")
            .header("X-Foto-Retirada", fila.retirada ? "si" : "no")
            .send(leido.contenido);
        },
      );
    },
  );

  // ── RETIRAR una foto. No borrarla ───────────────────────────────────
  app.post(
    "/clinica/clients/:clientId/fotos/:fotoId/retirar",
    {
      ...guard,
      schema: {
        params: PARAMS_FOTO,
        body: {
          type: "object",
          required: ["motivo"],
          additionalProperties: false,
          properties: {
            motivo: { type: "string", minLength: 3, maxLength: 200 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId, fotoId } = request.params as {
        clientId: string;
        fotoId: string;
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
          const r = await retirarFoto(getPrisma(), {
            tenantId: ctx.tenantId,
            clientId,
            fotoId,
            userId: ctx.userId,
            motivo,
            ahora: new Date(),
          });
          if (!r.ok) {
            const codigo = r.motivo === "NO_EXISTE" ? 404 : 409;
            return reply
              .code(codigo)
              .send({ error: r.motivo, code: r.motivo, message: r.mensaje });
          }
          return { foto: r.foto };
        },
      );
    },
  );
}
