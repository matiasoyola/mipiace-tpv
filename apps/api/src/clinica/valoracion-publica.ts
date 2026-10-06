// clinica-2 · la ruta pública del test. SIN SESIÓN.
//
//   GET  /valoracion/:token — qué preguntar
//   POST /valoracion/:token — lo que ha contestado
//
// Las dos puertas del test entran por aquí: el enlace del email y la
// tablet de la sala. Un solo test, una sola ruta, una sola forma de
// caducar (`enlace.ts`).
//
// ── Lo que ESTA RUTA NO DEVUELVE NUNCA ────────────────────────────────
//
// **Ni una respuesta.** Ni las que el paciente acaba de mandar, ni las de
// una valoración anterior, ni una alerta, ni el nombre del paciente
// completo, ni su teléfono, ni su email, ni el id del paciente, ni el de
// la valoración. El GET devuelve tres cosas: el nombre de la clínica, el
// NOMBRE DE PILA del paciente y el cuestionario. El POST devuelve
// `{ok:true}` y cuántos «No lo sé» quedaron, que es lo que la pantalla
// final necesita para decir «no se preocupe, las mirarán juntos».
//
// La razón es el modelo de amenaza real: la URL viaja por email y puede
// acabar en un historial compartido, en un móvil prestado o en una captura
// en un grupo de WhatsApp familiar. El que tiene la URL puede CONTESTAR
// —eso es el producto— pero no puede LEER lo que ya se contestó.
//
// Y el nombre de pila sí, porque sin él la pantalla no se puede
// identificar («¿es mi enlace o el de mi marido?») y un paciente mayor
// abandona. Es el mínimo que hace el test usable, y es lo que el mockup
// validado enseña.
//
// ── La misma 404 para todo ────────────────────────────────────────────
//
// «No existe», «caducado» y «ya usado» contestan lo mismo, carácter por
// carácter. Tres respuestas distintas le dicen a un escáner que el token
// existía, y eso ya es información sobre una persona.
//
// La pantalla del paciente, por tanto, no puede decirle «su enlace ha
// caducado» con certeza. Dice «este enlace ya no sirve» y le pide que
// llame a la clínica — que es, además, lo que tiene que hacer: en la
// clínica sí se sabe cuál es su estado, y puede contestar en la tablet.
//
// ── Rate-limit por IP, tras el proxy ──────────────────────────────────
//
// Umbrales propios en `enlace.ts`. Los intentos cuentan AUNQUE EL TOKEN NO
// EXISTA: si sólo contaran los reales, probar el espacio saldría gratis.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  cuestionarioDeVersion,
  preguntasEnJuego,
  type RespondioPor,
  type Respuesta,
} from "@mipiacetpv/clinica-valoracion";

import { inspect, registerFailure, reset } from "../auth/rate-limit.js";
import { getPrisma } from "../context.js";
import { apuntarAcceso } from "./registro.js";
import { comoPrismaParaActor, resolverActorPaciente } from "./actor-paciente.js";
import {
  PATRON_TOKEN,
  estadoDelEnlace,
  hashDeToken,
  rateLimitDelEnlace,
} from "./enlace.js";
import { responderValoracion } from "./valoracion.js";

const PARAMS_TOKEN = {
  type: "object",
  required: ["token"],
  additionalProperties: false,
  properties: { token: { type: "string", minLength: 43, maxLength: 43 } },
} as const;

/** LA respuesta de «este enlace no sirve». Una sola, para los tres casos
 *  y para las dos rutas: si se separan, se puede distinguir. */
function enlaceNoSirve(reply: FastifyReply) {
  return reply.code(404).send({
    error: "VALORACION_NOT_FOUND",
    code: "VALORACION_NOT_FOUND",
    message:
      "Este enlace ya no sirve. Llame a la clínica y se lo preparamos otra vez; también puede contestarlo allí el día de su cita.",
  });
}

interface ValoracionDelEnlace {
  id: string;
  tenantId: string;
  clientId: string;
  appointmentId: string | null;
  questionnaireVersion: number;
  channel: "EMAIL" | "TABLET";
  status: "PENDIENTE_PACIENTE" | "RESPONDIDA" | "VALIDADA";
  linkExpiresAt: Date | null;
  linkUsedAt: Date | null;
  linkTokenHash: string | null;
  cliente: { firstName: string };
  tenant: { name: string; clinicalRecordsEnabled: boolean };
}

/**
 * Resuelve el token a su valoración, con el rate-limit delante.
 *
 * Devuelve `null` cuando no hay nada que servir, y el llamante contesta
 * `enlaceNoSirve`. El motivo se queda en el log de la aplicación: lo que
 * permite ayudar a un paciente que llama diciendo «me da error» sin que la
 * respuesta HTTP se lo cuente a nadie más.
 */
async function resolverToken(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<ValoracionDelEnlace | null> {
  const { token } = request.params as { token: string };
  const rl = rateLimitDelEnlace(request.ip);
  const estado = await inspect(rl);
  if (estado.locked) {
    reply.code(429).send({
      error: "TOO_MANY_REQUESTS",
      code: "TOO_MANY_REQUESTS",
      message:
        "Demasiados intentos. Espere un rato y vuelva a abrir el enlace, o llame a la clínica.",
      retryAfterSeconds: estado.retryAfterSeconds,
    });
    return null;
  }

  // El formato ANTES de la base. Un token con otra forma no es de nadie y
  // no merece una consulta — pero sí cuenta como intento.
  if (!PATRON_TOKEN.test(token)) {
    await registerFailure(rl);
    enlaceNoSirve(reply);
    return null;
  }

  const prisma = getPrisma();
  const fila = await prisma.clinicalAssessment.findUnique({
    where: { linkTokenHash: hashDeToken(token) },
    select: {
      id: true,
      tenantId: true,
      clientId: true,
      appointmentId: true,
      questionnaireVersion: true,
      channel: true,
      status: true,
      linkExpiresAt: true,
      linkUsedAt: true,
      linkTokenHash: true,
      client: { select: { firstName: true } },
      tenant: { select: { name: true, clinicalRecordsEnabled: true } },
    },
  });

  const vivo = estadoDelEnlace(fila);
  if (!vivo.vivo) {
    await registerFailure(rl);
    request.log.info(
      { event: "clinica_valoracion_enlace_rechazado", motivo: vivo.motivo },
      "enlace del test rechazado",
    );
    enlaceNoSirve(reply);
    return null;
  }

  // CON EL MÓDULO APAGADO, NO EXISTE. La misma 404, no una distinta: un
  // tenant al que se le apagó la clínica no destapa que la tuvo. Es la
  // misma decisión que `gate.ts`, aplicada a una ruta que no puede usar
  // ese gate porque no tiene sesión de la que sacar el tenant.
  if (!fila!.tenant.clinicalRecordsEnabled) {
    await registerFailure(rl);
    enlaceNoSirve(reply);
    return null;
  }

  // El enlace bueno no gasta intentos: si no se limpiara, un paciente que
  // recarga treinta veces se bloquearía a sí mismo.
  await reset(rl);
  const f = fila!;
  return {
    id: f.id,
    tenantId: f.tenantId,
    clientId: f.clientId,
    appointmentId: f.appointmentId,
    questionnaireVersion: f.questionnaireVersion,
    channel: f.channel as "EMAIL" | "TABLET",
    status: f.status as ValoracionDelEnlace["status"],
    linkExpiresAt: f.linkExpiresAt,
    linkUsedAt: f.linkUsedAt,
    linkTokenHash: f.linkTokenHash,
    cliente: f.client,
    tenant: f.tenant,
  };
}

export async function registerValoracionPublicaRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── Qué preguntar ───────────────────────────────────────────────────
  app.get(
    "/valoracion/:token",
    { schema: { params: PARAMS_TOKEN } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const v = await resolverToken(request, reply);
      if (!v) return reply;

      const cuestionario = cuestionarioDeVersion(v.questionnaireVersion);
      if (!cuestionario) {
        // Una versión que este binario no sabe leer. No se sirve «la de
        // hoy»: sería preguntarle otra cosa de la que se le mandó.
        request.log.error(
          {
            event: "clinica_valoracion_version_desconocida",
            version: v.questionnaireVersion,
          },
          "el enlace apunta a una versión del cuestionario que no se conoce",
        );
        return enlaceNoSirve(reply);
      }

      // LAS TRES COSAS. Nada más sale por aquí.
      return {
        clinica: v.tenant.name,
        nombrePila: v.cliente.firstName,
        canal: v.channel,
        cuestionario,
      };
    },
  );

  // ── Lo que ha contestado ────────────────────────────────────────────
  app.post(
    "/valoracion/:token",
    {
      schema: {
        params: PARAMS_TOKEN,
        body: {
          type: "object",
          required: ["respuestas", "respondioPor"],
          additionalProperties: false,
          properties: {
            respondioPor: { type: "string", enum: ["PACIENTE", "FAMILIAR"] },
            respuestas: {
              type: "object",
              // Las claves son ids del cuestionario y se validan contra la
              // versión de ESTA valoración, no por patrón: un id que no
              // existe no se guarda en una tabla que no se puede editar.
              additionalProperties: {
                type: "string",
                enum: ["SI", "NO", "NO_SE"],
              },
            },
            detalles: {
              type: "object",
              additionalProperties: {
                type: "array",
                maxItems: 20,
                items: { type: "string", minLength: 1, maxLength: 120 },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const v = await resolverToken(request, reply);
      if (!v) return reply;

      const body = request.body as {
        respondioPor: RespondioPor;
        respuestas: Record<string, Respuesta>;
        detalles?: Record<string, string[]>;
      };
      const cuestionario = cuestionarioDeVersion(v.questionnaireVersion);
      if (!cuestionario) return enlaceNoSirve(reply);

      // Se queda SÓLO lo que es del cuestionario de esta valoración, y
      // sólo las preguntas que de verdad están en juego con lo que ha
      // contestado. Lo que llegue de más se tira en silencio: el paciente
      // no tiene nada que arreglar, y una respuesta a una pregunta que no
      // se le hizo no entra en su historia.
      const valorDe = (id: string) => body.respuestas[id];
      const enJuego = preguntasEnJuego(cuestionario, valorDe);
      const respuestas: Record<string, Respuesta> = {};
      const faltan: string[] = [];
      for (const p of enJuego) {
        const r = body.respuestas[p.id];
        if (r) respuestas[p.id] = r;
        else faltan.push(p.id);
      }

      // Un test a medias no se guarda. La pantalla no deja llegar aquí sin
      // contestar las diez (una pregunta por pantalla, y «No lo sé»
      // siempre disponible), así que esto es la red de seguridad de un
      // POST a mano — y la respuesta dice QUÉ falta para que, si algún día
      // la pantalla se equivoca, se vea.
      if (faltan.length > 0) {
        return reply.code(400).send({
          error: "FALTAN_RESPUESTAS",
          code: "FALTAN_RESPUESTAS",
          message:
            "Faltan preguntas por contestar. Si no sabe alguna, toque «No lo sé».",
          faltan,
        });
      }

      // Los detalles, sólo de las preguntas que tienen opciones y sólo
      // opciones de la lista. Un texto libre que llegara aquí acabaría en
      // la franja de alertas de la podóloga, y lo que esa franja enseña
      // tiene que venir del cuestionario y no del teclado de un
      // desconocido.
      const detalles: Record<string, string[]> = {};
      for (const p of enJuego) {
        if (!p.opciones || respuestas[p.id] !== "SI") continue;
        const pedidas = body.detalles?.[p.id] ?? [];
        const limpias = pedidas.filter((d) => p.opciones!.includes(d));
        if (limpias.length > 0) detalles[p.id] = limpias;
      }

      const prisma = getPrisma();

      // ── LA LÍNEA DEL REGISTRO, ANTES DEL TRABAJO ──────────────────
      //
      // El paciente escribe en su historia, así que deja línea `WRITE`
      // como cualquier otro camino de escritura. El autor es el actor
      // «paciente por enlace» (`actor-paciente.ts`), que es lo que resuelve
      // el `userId` NOT NULL del registro.
      //
      // Se resuelve el actor fuera de la transacción de la respuesta
      // porque la línea tiene que estar escrita ANTES de que el trabajo
      // ocurra, igual que en `conHistoria`. Esta ruta no puede usar
      // `conHistoria` —no hay sesión, y la función de acceso contestaría
      // «no eres sanitario»— y por eso es el único sitio del módulo que
      // llama a `apuntarAcceso` directamente. La alternativa era un tercer
      // valor de `PermisoClinico` para «el paciente por su enlace», y eso
      // habría metido en la función de autorización del personal un caso
      // que no es del personal.
      const actorUserId = await resolverActorPaciente(
        comoPrismaParaActor(prisma),
        v.tenantId,
      );
      try {
        await apuntarAcceso({
          tenantId: v.tenantId,
          userId: actorUserId,
          clientId: v.clientId,
          action: "WRITE",
          outcome: "ALLOWED",
          // No hay device: el paciente entra desde su móvil o desde la
          // tablet sin sesión de terminal.
          deviceId: null,
          route: "POST /valoracion/:token",
        });
      } catch (err) {
        request.log.error(
          { event: "clinical_access_log_failed", valoracionId: v.id, err },
          "no se pudo registrar la escritura del paciente — se corta la petición",
        );
        return reply.code(500).send({
          error: "CLINICAL_ACCESS_LOG_FAILED",
          code: "CLINICAL_ACCESS_LOG_FAILED",
          message:
            "No hemos podido guardar sus respuestas. Inténtelo otra vez; si sigue, llame a la clínica.",
        });
      }

      const r = await responderValoracion(prisma, {
        tenantId: v.tenantId,
        clientId: v.clientId,
        valoracionId: v.id,
        appointmentId: v.appointmentId,
        version: v.questionnaireVersion,
        canal: v.channel,
        respondioPor: body.respondioPor,
        respuestas,
        detalles,
        // Se entró por un enlace (las dos puertas lo son), así que se
        // sella: de aquí sale el «de un solo uso».
        sellarEnlace: true,
      });
      if (!r.ok) {
        // Alguien contestó entre el `resolverToken` y el UPDATE. La misma
        // 404 que todo lo demás.
        return enlaceNoSirve(reply);
      }

      // Lo único que sale: que se guardó, y cuántos «No lo sé» quedaron —
      // el mockup los cuenta en la pantalla final («Hay 2 preguntas que ha
      // marcado como "No lo sé": no se preocupe, las mirarán juntos»).
      const sinSaber = Object.values(respuestas).filter(
        (x) => x === "NO_SE",
      ).length;
      return reply.code(201).send({
        ok: true,
        sinSaber,
        canal: v.channel,
      });
    },
  );
}
