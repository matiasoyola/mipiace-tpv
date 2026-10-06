// clinica-2 · las rutas de la valoración inicial.
//
//   GET  /clinica/clients/:clientId/valoracion            — la pantalla
//   POST /clinica/clients/:clientId/valoracion/correcciones — corregir
//   POST /clinica/clients/:clientId/valoracion/validar    — firmar
//   POST /clinica/clients/:clientId/valoracion/enviar     — mandar el test
//   POST /clinica/clients/:clientId/valoracion/tablet     — abrir la tablet
//
// Las cinco pasan por `conHistoria` (`registro.ts`), así que las cinco
// dejan su línea en el registro de accesos antes de hacer nada. Lo que
// cambia entre ellas es QUÉ permiso exigen, y ahí está la decisión de
// producto 6:
//
//   · Las TRES primeras son de sanitario con acceso a ESE paciente. Leen
//     o escriben respuestas de salud.
//   · Las DOS últimas son de **personal del centro**: la recepcionista
//     puede mandar el test y abrir la tablet, porque ninguna de las dos
//     cosas enseña una respuesta. Lo que sí hacen es ESCRIBIR en la
//     historia (crean la valoración), así que las dos dejan línea con su
//     nombre.
//
// ── El token del enlace, y las dos únicas formas de tenerlo ──────────
//
// `enviar` **no lo devuelve**: lo manda por email y contesta «mandado, y
// caduca el día X». `tablet` **sí**, porque quien recibe la respuesta es
// la persona que está poniendo la tablet en las manos del paciente y
// necesita la URL para abrirla. La vista del sanitario no lo devuelve
// nunca — sólo si hay uno vivo y hasta cuándo.
//
// La diferencia no es cosmética: si `enviar` lo devolviera, cualquiera con
// la consola del navegador abierta tendría la URL del formulario de salud
// de cualquier paciente sin dejar más rastro que un GET. El de `tablet`
// vive cuatro horas, es de un solo paciente y su petición queda escrita en
// el registro con el nombre de quien la hizo.
//
// ── Y nada de salud en los logs ──────────────────────────────────────
//
// Ni las respuestas, ni las alertas, ni el motivo de una negativa clínica
// entran en `request.log` ni en Sentry. Igual que en `routes.ts` de
// clinica-1.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  TEXTO_CONFIRMACION,
  type CanalValoracion,
  type Confirmaciones,
  type Respuesta,
} from "@mipiacetpv/clinica-valoracion";

import { requireOwnerOrCashier } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import { loadEnv } from "../env.js";
import { ensureClinicaEnabled } from "./gate.js";
import { conHistoria } from "./registro.js";
import { resolverPrimerTratamiento } from "./primer-tratamiento.js";
import { mandarElTest } from "./valoracion-envio.js";
import {
  asegurarValoracionAbierta,
  corregirValoracion,
  validarValoracion,
  vistaDeLaValoracion,
} from "./valoracion.js";

const guard = { preHandler: [requireOwnerOrCashier, ensureClinicaEnabled] };

const PARAMS_CLIENTE = {
  type: "object",
  required: ["clientId"],
  additionalProperties: false,
  properties: { clientId: { type: "string", format: "uuid" } },
} as const;

async function cargarPacienteDelTenant(
  tenantId: string,
  clientId: string,
): Promise<{ id: string; firstName: string } | null> {
  const prisma = getPrisma();
  return prisma.client.findFirst({
    where: { id: clientId, tenantId },
    select: { id: true, firstName: true },
  });
}

function pacienteNoExiste(reply: FastifyReply) {
  return reply.code(404).send({
    error: "CLIENT_NOT_FOUND",
    code: "CLIENT_NOT_FOUND",
    message: "Paciente no encontrado.",
  });
}

/**
 * LA respuesta de la pantalla del sanitario, y la misma para las tres
 * rutas que la pintan (verla, corregir, validar).
 *
 * Un solo sitio la arma porque las tres acaban en la MISMA pantalla:
 * corregir cambia las alertas y puede desbloquear «Validar», y validar
 * enciende el aviso verde con la autora y el «ya puedes registrar el
 * primer tratamiento». Si cada ruta devolviera su propia forma, el front
 * tendría tres maneras de leer lo mismo — y la primera vez que una se
 * quedara sin un campo (pasó aquí mismo: `validar` no traía
 * `primerTratamiento` y el aviso verde no podía pintarse) el fallo sería
 * una pantalla a medias después de firmar.
 */
async function respuestaDeLaPantalla(input: {
  tenantId: string;
  clientId: string;
}) {
  const prisma = getPrisma();
  const [vista, primerTratamiento] = await Promise.all([
    vistaDeLaValoracion(prisma, input),
    resolverPrimerTratamiento(prisma, input),
  ]);
  return {
    ...vista,
    primerTratamiento,
    // Los textos de las tres casillas viajan con la respuesta en vez de
    // estar escritos en la pantalla: son parte de lo que se confirma, y el
    // done del bloque los cita. Si la pantalla los llevara, cambiarlos
    // sería cambiar lo que alguien firmó sin que se note en ningún sitio.
    textosConfirmacion: TEXTO_CONFIRMACION,
  };
}

export async function registerValoracionRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── La pantalla del sanitario ───────────────────────────────────────
  //
  // Una sola llamada trae todo lo que el mockup pinta: el estado, las
  // alertas (calculadas con la función pura), las respuestas del paciente,
  // las correcciones con su autor, las tres confirmaciones y el motivo por
  // el que «Validar» está desactivado.
  //
  // Y de paso la puerta del primer tratamiento, porque es la misma
  // pregunta que el aviso verde de abajo («ya puedes registrar el primer
  // tratamiento») y pedirla por separado sería dos peticiones para pintar
  // una pantalla.
  app.get(
    "/clinica/clients/:clientId/valoracion",
    { ...guard, schema: { params: PARAMS_CLIENTE } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      if (!(await cargarPacienteDelTenant(auth.tenantId, clientId))) {
        return pacienteNoExiste(reply);
      }
      return conHistoria(
        request,
        reply,
        { clientId, action: "READ" },
        async (ctx) =>
          respuestaDeLaPantalla({ tenantId: ctx.tenantId, clientId }),
      );
    },
  );

  // ── Corregir una respuesta ──────────────────────────────────────────
  //
  // NO sobrescribe lo que contestó el paciente: añade una corrección con
  // su autor y su hora. La pantalla sigue enseñando las dos.
  app.post(
    "/clinica/clients/:clientId/valoracion/correcciones",
    {
      ...guard,
      schema: {
        params: PARAMS_CLIENTE,
        body: {
          type: "object",
          required: ["preguntaId", "valor"],
          additionalProperties: false,
          properties: {
            preguntaId: { type: "string", minLength: 1, maxLength: 64 },
            valor: { type: "string", enum: ["SI", "NO", "NO_SE"] },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      const body = request.body as { preguntaId: string; valor: Respuesta };
      if (!(await cargarPacienteDelTenant(auth.tenantId, clientId))) {
        return pacienteNoExiste(reply);
      }
      return conHistoria(
        request,
        reply,
        { clientId, action: "WRITE" },
        async (ctx) => {
          const prisma = getPrisma();
          const vista = await vistaDeLaValoracion(prisma, {
            tenantId: ctx.tenantId,
            clientId,
          });
          if (!vista.valoracion) {
            return reply.code(409).send({
              error: "SIN_VALORACION",
              code: "SIN_VALORACION",
              message: "Este paciente no tiene valoración inicial todavía.",
            });
          }
          const r = await corregirValoracion(prisma, {
            tenantId: ctx.tenantId,
            valoracionId: vista.valoracion.id,
            preguntaId: body.preguntaId,
            valor: body.valor,
            autorUserId: ctx.userId,
          });
          if (!r.ok) {
            return reply
              .code(409)
              .send({ error: r.motivo, code: r.motivo, message: r.mensaje });
          }
          // Se devuelve la pantalla entera y no un `{ok:true}`: corregir
          // cambia las alertas y puede desbloquear «Validar», y la
          // pantalla tiene que repintarse con lo que diga el SERVIDOR. Con
          // un `{ok:true}` el front recalcularía por su cuenta y, el día
          // que las dos cuentas se separen, el botón se activaría para una
          // validación que la API va a rechazar.
          return reply
            .code(201)
            .send(await respuestaDeLaPantalla({ tenantId: ctx.tenantId, clientId }));
        },
      );
    },
  );

  // ── Validar ─────────────────────────────────────────────────────────
  //
  // Las tres confirmaciones llegan EN ESTE acto, no una a una. La pantalla
  // las marca en memoria y las manda con la firma: media validación
  // guardada (dos casillas y nadie que firme) no significa nada, y tres
  // toques de casilla no son tres escrituras sobre una historia clínica.
  app.post(
    "/clinica/clients/:clientId/valoracion/validar",
    {
      ...guard,
      schema: {
        params: PARAMS_CLIENTE,
        body: {
          type: "object",
          required: ["confirmaciones"],
          additionalProperties: false,
          properties: {
            confirmaciones: {
              type: "object",
              required: ["alergias", "medicacion", "alertas"],
              additionalProperties: false,
              properties: {
                alergias: { type: "boolean" },
                medicacion: { type: "boolean" },
                alertas: { type: "boolean" },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      const body = request.body as { confirmaciones: Confirmaciones };
      if (!(await cargarPacienteDelTenant(auth.tenantId, clientId))) {
        return pacienteNoExiste(reply);
      }
      return conHistoria(
        request,
        reply,
        { clientId, action: "WRITE" },
        async (ctx) => {
          const prisma = getPrisma();
          const vista = await vistaDeLaValoracion(prisma, {
            tenantId: ctx.tenantId,
            clientId,
          });
          if (!vista.valoracion) {
            return reply.code(409).send({
              error: "SIN_VALORACION",
              code: "SIN_VALORACION",
              message: "Este paciente no tiene valoración inicial todavía.",
            });
          }
          const r = await validarValoracion(prisma, {
            tenantId: ctx.tenantId,
            clientId,
            valoracionId: vista.valoracion.id,
            confirmaciones: body.confirmaciones,
            validadaPorUserId: ctx.userId,
          });
          if (!r.ok) {
            return reply
              .code(409)
              .send({ error: r.motivo, code: r.motivo, message: r.mensaje });
          }
          return reply
            .code(200)
            .send(await respuestaDeLaPantalla({ tenantId: ctx.tenantId, clientId }));
        },
      );
    },
  );

  // ── Mandar el test por email ────────────────────────────────────────
  //
  // `PERSONAL_DEL_CENTRO`: la recepcionista puede. No devuelve ni el token
  // ni una sola respuesta — sólo si se mandó y hasta cuándo vale.
  app.post(
    "/clinica/clients/:clientId/valoracion/enviar",
    { ...guard, schema: { params: PARAMS_CLIENTE } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      if (!(await cargarPacienteDelTenant(auth.tenantId, clientId))) {
        return pacienteNoExiste(reply);
      }
      return conHistoria(
        request,
        reply,
        { clientId, action: "WRITE", permiso: "PERSONAL_DEL_CENTRO" },
        async (ctx) => {
          const r = await mandarElTest(getPrisma(), {
            tenantId: ctx.tenantId,
            clientId,
            origen: "MANUAL",
            pedidaPorUserId: ctx.userId,
            baseTpvUrl: loadEnv().PUBLIC_TPV_URL,
            log: request.log,
          });
          if (!r.ok) {
            return reply
              .code(409)
              .send({ error: r.motivo, code: r.motivo, message: r.mensaje });
          }
          return reply.code(r.creada ? 201 : 200).send({
            enviado: r.enviado,
            estado: r.estado,
            caducaEn: r.caducaEn?.toISOString() ?? null,
            // Cuando el email no sale (sin SMTP, sin dirección, error del
            // servidor de correo) se dice, y se dice POR QUÉ: la pantalla
            // ofrece la tablet en vez de dejar al paciente esperando un
            // correo que no va a llegar.
            motivoNoEnviado: r.motivoNoEnviado,
          });
        },
      );
    },
  );

  // ── Abrir la tablet en modo paciente ────────────────────────────────
  //
  // Devuelve un token de enlace de cuatro horas para ESA valoración, y la
  // pantalla entra con él por la misma ruta pública que el email. La
  // tablet NO lleva la sesión del personal al modo paciente: si la
  // llevara, un paciente con el test delante tendría en el navegador el
  // token de la podóloga, y «sin forma de salir» sería una pantalla y no
  // una puerta. Para volver hace falta el PIN de alguien del personal, que
  // es el login del TPV de siempre.
  //
  // `PERSONAL_DEL_CENTRO`: cualquiera que vea la agenda puede abrirlo,
  // porque abrirlo no enseña nada (decisión de producto 6).
  app.post(
    "/clinica/clients/:clientId/valoracion/tablet",
    { ...guard, schema: { params: PARAMS_CLIENTE } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = request.auth!;
      const { clientId } = request.params as { clientId: string };
      const paciente = await cargarPacienteDelTenant(auth.tenantId, clientId);
      if (!paciente) return pacienteNoExiste(reply);
      return conHistoria(
        request,
        reply,
        { clientId, action: "WRITE", permiso: "PERSONAL_DEL_CENTRO" },
        async (ctx) => {
          const prisma = getPrisma();
          const abierta = await asegurarValoracionAbierta(prisma, {
            tenantId: ctx.tenantId,
            clientId,
            canal: "TABLET" satisfies CanalValoracion,
            origen: "MANUAL",
            pedidaPorUserId: ctx.userId,
          });
          if (abierta.estado !== "PENDIENTE_PACIENTE") {
            return reply.code(409).send({
              error: "YA_RESPONDIDA",
              code: "YA_RESPONDIDA",
              message:
                "Este paciente ya contestó el test. Revísalo y válidalo; si hay que volver a preguntarle, válidalo primero y mándale una valoración nueva.",
            });
          }
          return reply.code(200).send({
            valoracionId: abierta.valoracionId,
            // EL MISMO token que viajaría en un email, con cuatro horas de
            // vida en vez de treinta días. Se devuelve aquí —y sólo aquí—
            // porque quien lo recibe es la persona que está poniendo la
            // tablet en las manos del paciente; la pantalla navega a
            // `/valoracion/<token>` y entra por la misma puerta pública
            // que el enlace. Un solo test, dos puertas.
            //
            // Y de paso: esto ha ROTADO el token, así que el enlace que se
            // le mandó por email deja de abrir en este instante.
            token: abierta.token,
            nombrePila: paciente.firstName,
          });
        },
      );
    },
  );
}
