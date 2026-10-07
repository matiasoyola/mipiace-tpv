// clinica-2 · la ruta pública del test. SIN SESIÓN.
//
//   GET  /valoracion/:token — qué preguntar
//   POST /valoracion/:token — lo que ha contestado
//
// Las dos puertas del test entran por aquí: el enlace del email y la
// tablet de la sala. Un solo test, una sola ruta, una sola forma de
// caducar.
//
// ── Desde `enlaces-publicos`, la seguridad NO está en este fichero ───
//
// El formato, la huella, la caducidad, los usos, la revocación, el estado
// admitido, los dos límites de peticiones, las tres cabeceras y la 404
// común los decide **la puerta** (`apps/api/src/enlaces/puerta.ts`) con
// las reglas del `purpose` VALORACION (`enlaces/reglas.ts`). Lo que queda
// aquí es la pantalla: qué se pregunta y qué se guarda.
//
// Eso es el punto del bloque. Vienen cuatro enlaces más (consentimiento,
// «mi cita», la encuesta, el formulario del equipo) y ninguno vuelve a
// escribir esta parte: si cada uno eligiera sus cabeceras y sus topes, el
// que se equivocara expondría datos.
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
// Es el perfil `SOLO_ESCRIBIR` del `purpose`, y la razón es el modelo de
// amenaza real: la URL viaja por email y puede acabar en un historial
// compartido, en un móvil prestado o en una captura en un grupo de
// WhatsApp familiar. El que tiene la URL puede CONTESTAR —eso es el
// producto— pero no puede LEER lo que ya se contestó.
//
// Y el nombre de pila sí, porque sin él la pantalla no se puede
// identificar («¿es mi enlace o el de mi marido?») y un paciente mayor
// abandona. Es el mínimo que hace el test usable, y es lo que el mockup
// validado enseña.
//
// ── La misma 404 para todo ────────────────────────────────────────────
//
// «No existe», «caducado», «gastado» y «anulado» contestan lo mismo,
// carácter por carácter, y el texto vive en las reglas del `purpose` para
// que no se pueda ajustar una ruta y no la otra. Respuestas distintas le
// dicen a un escáner que el token existía, y eso ya es información sobre
// una persona.
//
// La pantalla del paciente, por tanto, no puede decirle «su enlace ha
// caducado» con certeza. Dice «este enlace ya no sirve» y le pide que
// llame a la clínica — que es, además, lo que tiene que hacer: en la
// clínica sí se sabe cuál es su estado, y puede contestar en la tablet.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  cuestionarioDeVersion,
  preguntasEnJuego,
  type RespondioPor,
  type Respuesta,
} from "@mipiacetpv/clinica-valoracion";

import { getPrisma } from "../context.js";
import {
  enlaceNoSirve,
  registrarAccesoDelEnlace,
  resolverEnlace,
} from "../enlaces/puerta.js";
import { REGLAS_VALORACION } from "../enlaces/reglas.js";
import { responderValoracion } from "./valoracion.js";

const PARAMS_TOKEN = {
  type: "object",
  required: ["token"],
  additionalProperties: false,
  properties: { token: { type: "string", minLength: 43, maxLength: 43 } },
} as const;

/** La 404 del `purpose`. Un renglón para no repetir las reglas en cada
 *  rama de este fichero. */
function noSirve(reply: FastifyReply) {
  return enlaceNoSirve(reply, REGLAS_VALORACION as never);
}

export async function registerValoracionPublicaRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── Qué preguntar ───────────────────────────────────────────────────
  app.get(
    "/valoracion/:token",
    { schema: { params: PARAMS_TOKEN } },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const enlace = await resolverEnlace(request, reply, REGLAS_VALORACION);
      if (!enlace) return reply;
      const v = enlace.objetivo;

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
        return noSirve(reply);
      }

      // LAS TRES COSAS. Nada más sale por aquí. Y NO se gasta el enlace:
      // el paciente puede recargar las veces que quiera (y lo hace). El
      // uso se gasta al CONTESTAR.
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
      const enlace = await resolverEnlace(request, reply, REGLAS_VALORACION);
      if (!enlace) return reply;
      const v = enlace.objetivo;

      const body = request.body as {
        respondioPor: RespondioPor;
        respuestas: Record<string, Respuesta>;
        detalles?: Record<string, string[]>;
      };
      const cuestionario = cuestionarioDeVersion(v.questionnaireVersion);
      if (!cuestionario) return noSirve(reply);

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
      // como cualquier otro camino de escritura. **Quién la deja y con qué
      // acción lo declara el `purpose`** (`registraAccesoClinico`), no esta
      // ruta: «cada ruta se acuerda» es la forma de fallo que clinica-1
      // cerró con `conHistoria` y que una puerta común volvería a abrir si
      // cada pantalla lo decidiera.
      //
      // El autor es el actor «paciente por enlace» (`actor-paciente.ts`),
      // que es lo que resuelve el `userId` NOT NULL del registro. Y va
      // ANTES y FUERA de la transacción de la respuesta, igual que en
      // `conHistoria`: la línea tiene que estar escrita antes de que el
      // trabajo ocurra.
      try {
        await registrarAccesoDelEnlace(prisma, REGLAS_VALORACION, {
          tenantId: enlace.tenantId,
          objetivo: v,
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
        tenantId: enlace.tenantId,
        clientId: v.clientId,
        valoracionId: v.id,
        appointmentId: v.appointmentId,
        version: v.questionnaireVersion,
        canal: v.channel,
        respondioPor: body.respondioPor,
        respuestas,
        detalles,
        // Se entró por un enlace (las dos puertas lo son), así que se
        // gasta: de aquí sale el «de un solo uso». El incremento va DENTRO
        // de la transacción de la respuesta — si la respuesta se deshace,
        // el uso se deshace con ella.
        enlaceId: enlace.enlaceId,
      });
      if (!r.ok) {
        // Alguien contestó entre el `resolverEnlace` y el UPDATE, o el
        // enlace se gastó en esa carrera. La misma 404 que todo lo demás.
        return noSirve(reply);
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
