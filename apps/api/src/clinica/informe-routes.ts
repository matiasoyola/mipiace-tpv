// clinica-4 · las rutas del informe.
//
//   GET  /clinica/clients/:clientId/informe?tipo=…  — el papel en pantalla
//   POST /clinica/clients/:clientId/informe         — ENTREGARLO
//
// Las dos pasan por `conHistoria`, y con una diferencia que importa:
//
//   · la de ver el papel es `READ` — se está leyendo la historia;
//   · **la de entregarlo es `EXPORT`**, que es el valor que clinica-1 metió
//     en el enum sin usarlo (su decisión 11.7, escrita para hoy). Así, el
//     registro de accesos distingue «abrió la historia» de «se llevó una
//     copia», que es justo la distinción que importa cuando alguien
//     pregunta qué ha salido de aquí.
//
// Las dos exigen `SANITARIO`: un informe clínico lo saca y lo firma el
// sanitario, con su nº de colegiado.
//
// ── El POST devuelve el PDF cuando se imprime ────────────────────────
//
// `canal = PRINT` devuelve el binario, porque imprimir es abrirlo y darle
// a imprimir en la tablet. `canal = EMAIL` no lo devuelve: lo manda. Las
// dos escriben su fila de entrega ANTES de responder, así que no hay forma
// de llevarse un informe sin que quede apuntado.
//
// ── Y el PDF del informe no se guarda en disco ───────────────────────
//
// Al contrario que el consentimiento, que ES el documento firmado y tiene
// que poder reabrirse. Un informe es una FOTO de la historia en un
// momento: se arma, se entrega y lo que queda es la prueba de que se
// entregó (con la huella del PDF que se entregó). Guardar cada copia
// llenaría el volumen de versiones de lo mismo, y la versión de hoy se
// vuelve a armar igual — salvo que la historia haya cambiado, que es justo
// cuando no querrías la vieja.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { TIPOS_DE_INFORME } from "@mipiacetpv/clinica-sesion";

import { requireOwnerOrCashier } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import { getEmailSender } from "../email/sender.js";
import { datosDelCentro } from "./consentimientos.js";
import { MIME_DE_PDF } from "./ficheros.js";
import { ensureClinicaEnabled } from "./gate.js";
import {
  apuntarEntrega,
  armarInforme,
  CANALES,
  DESTINATARIOS,
  entregasDelPaciente,
  pdfDelInforme,
  type Canal,
  type Destinatario,
  type TipoDeInforme,
} from "./informe.js";
import { emailDelInforme } from "./informe-email.js";
import { conHistoria } from "./registro.js";

const guard = { preHandler: [requireOwnerOrCashier, ensureClinicaEnabled] };

/** El texto de la derivación. Breve a propósito: es el motivo, no un
 *  informe dentro del informe — ése es el resto del documento. */
const MOTIVO_MAXIMO = 1000;

const PARAMS_PACIENTE = {
  type: "object",
  required: ["clientId"],
  additionalProperties: false,
  properties: { clientId: { type: "string", format: "uuid" } },
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

export async function registerInformeRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── El papel, para verlo antes de entregarlo ────────────────────────
  //
  // Devuelve el informe YA ARMADO (las mismas secciones que van a ir al
  // PDF) y la lista de entregas anteriores. La pantalla no arma nada: lo
  // que se ve es lo que se imprime.
  app.get(
    "/clinica/clients/:clientId/informe",
    {
      ...guard,
      schema: {
        params: PARAMS_PACIENTE,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            tipo: { type: "string", enum: [...TIPOS_DE_INFORME] },
            motivo: { type: "string", maxLength: MOTIVO_MAXIMO },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      const { tipo, motivo } = request.query as {
        tipo?: TipoDeInforme;
        motivo?: string;
      };
      if (!(await existePaciente(auth.tenantId, clientId))) {
        return pacienteNoExiste(reply);
      }
      return conHistoria(
        request,
        reply,
        { clientId, action: "READ" },
        async (ctx) => {
          const prisma = getPrisma();
          const [armado, entregas] = await Promise.all([
            armarInforme(prisma, {
              tenantId: ctx.tenantId,
              clientId,
              tipo: tipo ?? "RESUMEN",
              userId: ctx.userId,
              motivoDeDerivacion: motivo ?? null,
              ahora: new Date(),
            }),
            entregasDelPaciente(prisma, {
              tenantId: ctx.tenantId,
              clientId,
            }),
          ]);
          return {
            informe: armado.informe,
            centro: armado.centro,
            profesional: armado.profesional,
            paciente: armado.paciente,
            fecha: armado.fecha,
            entregas,
          };
        },
      );
    },
  );

  // ── ENTREGARLO: imprimir o mandar por email ─────────────────────────
  app.post(
    "/clinica/clients/:clientId/informe",
    {
      ...guard,
      schema: {
        params: PARAMS_PACIENTE,
        body: {
          type: "object",
          required: ["tipo", "canal", "destinatario"],
          additionalProperties: false,
          properties: {
            tipo: { type: "string", enum: [...TIPOS_DE_INFORME] },
            canal: { type: "string", enum: [...CANALES] },
            destinatario: { type: "string", enum: [...DESTINATARIOS] },
            // El email al que se manda cuando el destinatario es otro
            // profesional. Al paciente se le manda AL SUYO, el de su
            // ficha: dejar teclear el email del paciente sería dejar
            // mandar su historia a cualquier dirección.
            email: { type: "string", format: "email", maxLength: 200 },
            motivo: { type: "string", maxLength: MOTIVO_MAXIMO },
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
        // EXPORT y no WRITE: lo que pasa aquí es que una copia de la
        // historia sale del sistema. Ver la cabecera.
        { clientId, action: "EXPORT" },
        async (ctx) => {
          const body = request.body as {
            tipo: TipoDeInforme;
            canal: Canal;
            destinatario: Destinatario;
            email?: string;
            motivo?: string;
          };
          const prisma = getPrisma();
          const ahora = new Date();

          const armado = await armarInforme(prisma, {
            tenantId: ctx.tenantId,
            clientId,
            tipo: body.tipo,
            userId: ctx.userId,
            motivoDeDerivacion: body.motivo ?? null,
            ahora,
          });

          // La derivación sin motivo no se entrega: es el único texto que
          // escribe el sanitario y es lo primero que lee quien recibe el
          // informe. Un informe de derivación con el motivo en blanco no
          // deriva nada.
          if (body.tipo === "DERIVACION" && !body.motivo?.trim()) {
            return reply.code(409).send({
              error: "FALTA_EL_MOTIVO",
              code: "FALTA_EL_MOTIVO",
              message:
                "Escribe el motivo de la derivación: es lo primero que lee quien recibe el informe.",
            });
          }

          // A DÓNDE va el email, y la regla que lo decide.
          let destino: string | null = null;
          if (body.canal === "EMAIL") {
            destino =
              body.destinatario === "PACIENTE"
                ? (armado.paciente.email ?? null)
                : (body.email ?? null);
            if (!destino) {
              return reply.code(409).send({
                error: "SIN_EMAIL",
                code: "SIN_EMAIL",
                message:
                  body.destinatario === "PACIENTE"
                    ? "Este paciente no tiene email en su ficha. Ponlo en la ficha o imprímelo."
                    : "Escribe el email del profesional al que se lo mandas.",
              });
            }
          }

          const { pdf, sha256, nombreDeFichero } = await pdfDelInforme(armado);

          if (body.canal === "EMAIL" && destino) {
            const centro = await datosDelCentro(prisma, ctx.tenantId);
            const correo = emailDelInforme({
              clinica: centro.nombre,
              // Sólo el nombre de pila, y sólo si va al paciente. Al
              // profesional no se le manda el nombre del paciente en el
              // cuerpo: ya sabe de quién es, y el cuerpo de un correo se
              // lee en una pantalla de bloqueo.
              nombrePila:
                body.destinatario === "PACIENTE"
                  ? (armado.paciente.nombre.split(" ")[0] ?? null)
                  : null,
              telefono: centro.telefono,
            });
            await getEmailSender().send({
              to: destino,
              subject: correo.subject,
              text: correo.text,
              html: correo.html,
              attachments: [
                {
                  filename: nombreDeFichero,
                  content: Buffer.from(pdf),
                  contentType: MIME_DE_PDF,
                },
              ],
            });
          }

          // LA FILA, antes de responder. Así no hay forma de llevarse un
          // informe sin que quede apuntado.
          const entrega = await apuntarEntrega(prisma, {
            tenantId: ctx.tenantId,
            clientId,
            userId: ctx.userId,
            tipo: body.tipo,
            canal: body.canal,
            destinatario: body.destinatario,
            email: destino,
            pdfSha256: sha256,
            ahora,
          });

          if (body.canal === "PRINT") {
            // El binario, para que la tablet lo abra y lo imprima.
            return reply
              .header("Content-Type", MIME_DE_PDF)
              .header("Content-Length", pdf.byteLength)
              .header("Cache-Control", "no-store")
              .header("X-Content-Type-Options", "nosniff")
              .header("X-Entrega-Id", entrega.id)
              .send(Buffer.from(pdf));
          }

          return reply.code(201).send({
            entregaId: entrega.id,
            // Lo que la pantalla escribe en el aviso verde. El email NO
            // se devuelve recortado ni escondido: la podóloga tiene que
            // poder comprobar a dónde ha ido.
            enviadoA: destino,
          });
        },
      );
    },
  );
}
