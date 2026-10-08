// clinica-3 · las rutas de la sesión y de la exploración.
//
//   GET  /clinica/appointments/:id/sesion              — la pantalla
//   POST /clinica/appointments/:id/sesion/exploracion  — guardar exploración
//   POST /clinica/appointments/:id/sesion/cerrar       — firmar y cerrar
//
// Las tres pasan por `conHistoria` (`registro.ts`), así que las tres dejan
// su línea en el registro de accesos ANTES de hacer nada, y las tres llevan
// `ensureClinicaEnabled`, que con el módulo apagado contesta la 404 de
// Fastify carácter por carácter.
//
// Las tres exigen `SANITARIO`: aquí se leen y se escriben lesiones, dolor y
// alertas. **Ni la recepcionista ni una dueña no sanitaria entran**, y el
// intento les queda escrito — al contrario que «mandar el test» y «abrir la
// tablet» de clinica-2, que son trabajo de mostrador porque no enseñan una
// sola respuesta.
//
// ── Por qué cuelgan de la CITA y no del paciente ─────────────────────
//
// Porque la sesión se abre desde la cita del día (prompt §3) y porque de
// una cita sale UNA sesión. Con la ruta colgada del paciente
// (`/clinica/clients/:id/sesion`) habría que mandar el `appointmentId` en
// el cuerpo, y entonces nada impediría cerrar la sesión de hoy contra la
// cita de la semana que viene — o contra la cita de otra persona. En la
// URL, el aislamiento lo hace `cargarCitaDeLaSesion` una vez y para las
// tres rutas: la cita es de este tenant, y el paciente sale DE ELLA.
//
// Es la misma decisión que clinica-1 tomó con las anotaciones
// (`POST /clinica/entries/:entryId/addenda`, donde el `clientId` sale de la
// entrada y no lo dice el llamante): **dejar que quien llama diga de quién
// es algo es dejarle elegir contra qué paciente se comprueba el acceso.**
//
// ── Y nada de salud en los logs ──────────────────────────────────────
//
// Ni las marcas, ni el dolor, ni las alertas, ni la nota entran en
// `request.log` ni en Sentry. Igual que en `routes.ts` de clinica-1 y en
// `valoracion-routes.ts` de clinica-2.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  ACTOS_QUIROPODIA_V1,
  DOLOR_MAXIMO,
  DOLOR_MINIMO,
  ESTADOS_DE_HERIDA,
  EVOLUCIONES,
  GRAVEDADES,
  NIVELES_DE_QUIROPODIA,
  PENDIENTES_V1,
  PISADAS,
  PROXIMAS_CITAS,
  PULSOS,
  PULSOS_PEDIOS,
  PUNTOS_DE_LA_HERIDA,
  SENSIBILIDADES,
  SI_NO,
  TIPOS_DE_PIE,
  TIPOS_DE_PIE_BIOMECANICA,
  TIPOS_DE_VISITA,
  type PendienteCerrado,
} from "@mipiacetpv/clinica-sesion";

import { requireOwnerOrCashier } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import { ensureClinicaEnabled } from "./gate.js";
import { puedeVerImportes } from "./importes.js";
import { conHistoria } from "./registro.js";
import {
  cargarCitaDeLaSesion,
  cerrarSesion,
  guardarExploracion,
  ultimaExploracion,
  vistaDeLaSesion,
  type CitaDeLaSesion,
} from "./sesion.js";
import { serializarSesionCerrada, serializarVista } from "./sesion-view.js";

const guard = { preHandler: [requireOwnerOrCashier, ensureClinicaEnabled] };

const PARAMS_CITA = {
  type: "object",
  required: ["appointmentId"],
  additionalProperties: false,
  properties: { appointmentId: { type: "string", format: "uuid" } },
} as const;

/** La nota de la sesión. Es la ÚNICA caja de texto del bloque y tiene
 *  techo: una historia clínica no es un cuaderno. */
const NOTA_MAXIMA = 2000;

/** clinica-5 · la nota de un pendiente «Otro». Corta a propósito: es un
 *  recordatorio de una línea («pedirle la analítica»), no una nota
 *  clínica — esa es la de arriba. */
const NOTA_PENDIENTE = 200;

/** Cuántos pendientes caben en una visita. Cinco clases por los dos pies
 *  y las zonas de cada uno dan de sobra con diez; más que eso no es una
 *  visita, es alguien probando el endpoint. */
const TECHO_DE_PENDIENTES = 10;

/** Los servicios tocados de un tipo. El mismo techo que tenía
 *  `tratamientos` en la v1 (clinica-3), ahora por bloque. */
const SERVICIOS = {
  type: "array",
  maxItems: 20,
  items: { type: "string", format: "uuid" },
} as const;

function citaNoExiste(reply: FastifyReply) {
  return reply.code(404).send({
    error: "APPOINTMENT_NOT_FOUND",
    code: "APPOINTMENT_NOT_FOUND",
    message: "Cita no encontrada.",
  });
}

/**
 * Carga la cita y comprueba que es de este tenant y que tiene paciente.
 *
 * Se llama ANTES de `conHistoria` porque `conHistoria` necesita el
 * `clientId` para resolver el acceso y apuntar la línea — y el `clientId`
 * sale de la cita. El orden es: ¿existe esta cita en mi tenant? → ¿puedo
 * abrir la historia de SU paciente? → trabajo.
 */
async function conLaCita(
  request: FastifyRequest,
  reply: FastifyReply,
  cb: (cita: CitaDeLaSesion) => Promise<unknown>,
): Promise<unknown> {
  const auth = request.auth!;
  const { appointmentId } = request.params as { appointmentId: string };
  const cita = await cargarCitaDeLaSesion(getPrisma(), {
    tenantId: auth.tenantId,
    appointmentId,
  });
  if (!cita) return citaNoExiste(reply);
  return cb(cita);
}

export async function registerSesionRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── La pantalla ─────────────────────────────────────────────────────
  //
  // UNA llamada trae todo lo que el mockup pinta: la cabecera con sus
  // fichas y la franja roja, la puerta de la valoración, los botones de
  // tratamiento del catálogo, lo de la visita anterior, la gráfica del
  // dolor, de qué exploración parte la siguiente, las listas con las que
  // se pinta, y la sesión ya cerrada si lo está.
  //
  // Una sola y no seis porque es UNA pantalla: seis peticiones se pintan
  // en seis momentos distintos, y la franja roja de alertas pintándose un
  // instante después del mapa es exactamente el modo de fallo que una
  // señal de seguridad no puede tener.
  app.get(
    "/clinica/appointments/:appointmentId/sesion",
    { ...guard, schema: { params: PARAMS_CITA } },
    async (request: FastifyRequest, reply: FastifyReply) =>
      conLaCita(request, reply, (cita) =>
        conHistoria(
          request,
          reply,
          { clientId: cita.clientId, action: "READ" },
          async (ctx) => {
            const verImportes = await puedeVerImportes(request);
            const vista = await vistaDeLaSesion(getPrisma(), {
              tenantId: ctx.tenantId,
              cita,
              verImportes,
            });
            return serializarVista(vista, verImportes);
          },
        ),
      ),
  );

  // ── Guardar la exploración ──────────────────────────────────────────
  //
  // **NO pasa por la puerta de la valoración** (prompt §2): la exploración
  // es parte de la primera visita, que es justo la que puede no tener la
  // valoración validada todavía. Una exploración que exigiera la
  // valoración no se podría registrar el día que más falta hace.
  //
  // Guarda una exploración NUEVA y completa. La anterior no se toca: es
  // historia, y la siguiente partió de ella pero no la sustituye (decisión
  // de producto 5).
  //
  // Y tiene botón propio en su pestaña, que es la única divergencia de
  // forma con el mockup: el mockup no pinta CTA en la pestaña de
  // exploración —su pie de página sólo existe en la de sesión— pero una
  // pestaña cuyo estado no se puede guardar es una pestaña que miente. Va
  // dicho en el done.
  app.post(
    "/clinica/appointments/:appointmentId/sesion/exploracion",
    {
      ...guard,
      schema: {
        params: PARAMS_CITA,
        body: {
          type: "object",
          required: ["pulsos", "tipoDePie"],
          additionalProperties: false,
          properties: {
            pulsos: {
              type: "object",
              required: ["L", "R"],
              additionalProperties: false,
              properties: {
                L: { type: "string", enum: [...PULSOS] },
                R: { type: "string", enum: [...PULSOS] },
              },
            },
            // Las claves del mapa donde NO siente el filamento. El techo
            // es las 22 zonas del mapa: más que eso no es una exploración,
            // es alguien probando el endpoint.
            sinSensibilidad: {
              type: "array",
              maxItems: 22,
              items: { type: "string", maxLength: 40 },
            },
            tipoDePie: { type: "string", enum: [...TIPOS_DE_PIE] },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) =>
      conLaCita(request, reply, (cita) =>
        conHistoria(
          request,
          reply,
          { clientId: cita.clientId, action: "WRITE" },
          async (ctx) => {
            const body = request.body as {
              pulsos: Record<string, string>;
              sinSensibilidad?: string[];
              tipoDePie: string;
            };
            const prisma = getPrisma();
            await guardarExploracion(prisma, {
              tenantId: ctx.tenantId,
              clientId: cita.clientId,
              appointmentId: cita.id,
              autorUserId: ctx.userId,
              pulsos: body.pulsos,
              sinSensibilidad: body.sinSensibilidad ?? [],
              tipoDePie: body.tipoDePie,
            });
            // Se devuelve la exploración VIGENTE releída de la base y no
            // un `{ok:true}`: lo que se guardó pasó por `normalizar`, así
            // que puede no ser idéntico a lo que se mandó (una zona de
            // más se tira en silencio). La pantalla tiene que repintar lo
            // que dice el SERVIDOR — la misma razón por la que corregir
            // una valoración devuelve la pantalla entera en clinica-2.
            const guardada = await ultimaExploracion(prisma, {
              tenantId: ctx.tenantId,
              clientId: cita.clientId,
            });
            return reply.code(201).send({
              exploracion: guardada?.exploracion ?? null,
              ultima: guardada
                ? { fecha: guardada.fecha, autor: guardada.autor }
                : null,
            });
          },
        ),
      ),
  );

  // ── Cerrar la sesión = FIRMARLA ─────────────────────────────────────
  //
  // Escribe la sesión UNA SOLA VEZ y a partir de ahí el trigger
  // `clinical_entries_inmutable` de clinica-1 la deja congelada: no hay
  // PATCH ni DELETE en este fichero, y si alguien los escribiera el motor
  // los rechazaría igual.
  //
  // **No crea el ticket**, y la razón larga está en la cabecera de
  // `cerrarSesion`: el ticket necesita una caja con turno abierto y el
  // sanitario sin caja no tiene ninguna. El cobro lo hace el endpoint que
  // ya existía (`POST /agenda/appointments/:id/checkout`), que es el mismo
  // botón de siempre; lo único que cambia en ese camino es de dónde salen
  // las líneas cuando hay sesión cerrada.
  //
  // Cerrar dos veces devuelve **200 con la misma sesión** y no un error:
  // un doble toque no es un error, y el índice único de la base es lo que
  // garantiza que no haya dos.
  app.post(
    "/clinica/appointments/:appointmentId/sesion/cerrar",
    {
      ...guard,
      schema: {
        params: PARAMS_CITA,
        body: {
          type: "object",
          required: ["tipos", "dolor"],
          additionalProperties: false,
          properties: {
            // `"L:h"` → qué tiene. Techo de 22: las zonas del mapa por los
            // dos pies.
            marcas: {
              type: "object",
              maxProperties: 22,
              additionalProperties: {
                type: "object",
                required: ["lesion"],
                additionalProperties: false,
                properties: {
                  lesion: { type: "string", maxLength: 40 },
                  gravedad: {
                    type: ["string", "null"],
                    enum: [...GRAVEDADES, null],
                  },
                },
              },
            },
            // clinica-5 · LOS TIPOS. Como mínimo uno (decisión 1) y como
            // máximo los cinco que hay: una visita con el mismo tipo
            // repetido seis veces no es una visita, es alguien probando el
            // endpoint. El orden que llegue da igual —el servidor los
            // guarda en el de la lista— y los repetidos los quita
            // `normalizarSesionV2`.
            tipos: {
              type: "array",
              minItems: 1,
              maxItems: TIPOS_DE_VISITA.length,
              items: { type: "string", enum: [...TIPOS_DE_VISITA] },
            },
            // Y sus bloques. `additionalProperties: false` en todos: lo
            // que la pantalla manda de más no se guarda en silencio, se
            // rechaza — al contrario que las marcas de una zona
            // inexistente, que sí se tiran calladas. La diferencia es que
            // una zona de más puede venir de una versión del mapa vieja y
            // una clave de más sólo puede venir de un cliente que no es el
            // nuestro.
            bloques: {
              type: "object",
              additionalProperties: false,
              properties: {
                QUIROPODIA: {
                  type: ["object", "null"],
                  additionalProperties: false,
                  properties: {
                    actos: {
                      type: "array",
                      maxItems: ACTOS_QUIROPODIA_V1.actos.length,
                      items: { type: "string", maxLength: 40 },
                    },
                    nivelElegido: {
                      type: ["integer", "null"],
                      enum: [...NIVELES_DE_QUIROPODIA, null],
                    },
                    servicios: SERVICIOS,
                  },
                },
                PIE_RIESGO: {
                  type: ["object", "null"],
                  additionalProperties: false,
                  properties: {
                    sensibilidad: {
                      type: ["string", "null"],
                      enum: [...SENSIBILIDADES, null],
                    },
                    pulsos: {
                      type: ["object", "null"],
                      additionalProperties: false,
                      properties: {
                        L: { type: ["string", "null"], enum: [...PULSOS_PEDIOS, null] },
                        R: { type: ["string", "null"], enum: [...PULSOS_PEDIOS, null] },
                      },
                    },
                    ulcera: { type: ["string", "null"], enum: [...SI_NO, null] },
                    deformidad: { type: ["string", "null"], enum: [...SI_NO, null] },
                    servicios: SERVICIOS,
                  },
                },
                CIRUGIA: {
                  type: ["object", "null"],
                  additionalProperties: false,
                  properties: {
                    herida: {
                      type: ["string", "null"],
                      enum: [...ESTADOS_DE_HERIDA.opciones.map((o) => o.id), null],
                    },
                    puntos: {
                      type: ["string", "null"],
                      enum: [...PUNTOS_DE_LA_HERIDA.opciones.map((o) => o.id), null],
                    },
                    servicios: SERVICIOS,
                  },
                },
                BIOMECANICA: {
                  type: ["object", "null"],
                  additionalProperties: false,
                  properties: {
                    tipoDePie: {
                      type: ["string", "null"],
                      enum: [
                        ...TIPOS_DE_PIE_BIOMECANICA.opciones.map((o) => o.id),
                        null,
                      ],
                    },
                    pisada: {
                      type: ["string", "null"],
                      enum: [...PISADAS.opciones.map((o) => o.id), null],
                    },
                    plantillas: { type: "boolean" },
                    servicios: SERVICIOS,
                  },
                },
                GENERAL: {
                  type: ["object", "null"],
                  additionalProperties: false,
                  properties: { servicios: SERVICIOS },
                },
              },
            },
            // OBLIGATORIO, y 0 es una respuesta («ya no me duele»).
            dolor: {
              type: "integer",
              minimum: DOLOR_MINIMO,
              maximum: DOLOR_MAXIMO,
            },
            evolucion: { type: ["string", "null"], enum: [...EVOLUCIONES, null] },
            consejos: {
              type: "array",
              maxItems: 20,
              items: { type: "string", maxLength: 40 },
            },
            proximaCita: {
              type: ["string", "null"],
              enum: [...PROXIMAS_CITAS, null],
            },
            nota: { type: ["string", "null"], maxLength: NOTA_MAXIMA },
            // clinica-5 · los pendientes que la podóloga cierra a mano
            // (tocando la banda) o contestando el diálogo del cierre.
            // El cierre AUTOMÁTICO no viaja: lo recalcula el servidor con
            // lo que de verdad se ha marcado.
            pendientesCerrados: {
              type: "array",
              maxItems: TECHO_DE_PENDIENTES,
              items: {
                type: "object",
                required: ["id", "como"],
                additionalProperties: false,
                properties: {
                  id: {
                    type: "string",
                    enum: PENDIENTES_V1.clases.map((c) => c.id),
                  },
                  zona: { type: ["string", "null"], maxLength: 40 },
                  como: { type: "string", enum: ["MANO", "PREGUNTA"] },
                },
              },
            },
            // Y lo que apunta PARA LA PRÓXIMA VISITA.
            pendientesNuevos: {
              type: "array",
              maxItems: TECHO_DE_PENDIENTES,
              items: {
                type: "object",
                required: ["id"],
                additionalProperties: false,
                properties: {
                  id: {
                    type: "string",
                    enum: PENDIENTES_V1.clases.map((c) => c.id),
                  },
                  zona: { type: ["string", "null"], maxLength: 40 },
                  nota: { type: ["string", "null"], maxLength: NOTA_PENDIENTE },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) =>
      conLaCita(request, reply, (cita) =>
        conHistoria(
          request,
          reply,
          { clientId: cita.clientId, action: "WRITE" },
          async (ctx) => {
            const body = request.body as {
              tipos: string[];
              bloques?: Record<string, unknown>;
              marcas?: Record<string, unknown>;
              dolor: number;
              evolucion?: string | null;
              consejos?: string[];
              proximaCita?: string | null;
              nota?: string | null;
              pendientesCerrados?: PendienteCerrado[];
              pendientesNuevos?: Array<{
                id: string;
                zona?: string | null;
                nota?: string | null;
              }>;
            };
            const verImportes = await puedeVerImportes(request);
            const r = await cerrarSesion(getPrisma(), {
              tenantId: ctx.tenantId,
              cita,
              autorUserId: ctx.userId,
              verImportes,
              tipos: body.tipos,
              bloques: (body.bloques ?? {}) as never,
              marcas: body.marcas ?? {},
              dolor: body.dolor,
              evolucion: body.evolucion ?? null,
              consejos: body.consejos ?? [],
              proximaCita: body.proximaCita ?? null,
              nota: body.nota ?? null,
              pendientesCerrados: body.pendientesCerrados ?? [],
              pendientesNuevos: (body.pendientesNuevos ?? []).map((p) => ({
                id: p.id,
                zona: p.zona ?? null,
                nota: p.nota ?? null,
              })),
            });
            if (!r.ok) {
              // 409 y no 400: no es una petición mal formada, es el
              // sistema diciendo que todavía no. Y sin `captureError`,
              // porque una negativa esperada no es una alarma de Sentry
              // (clinica-1 §9).
              return reply
                .code(409)
                .send({ error: r.motivo, code: r.motivo, message: r.mensaje });
            }
            // 200 si ya estaba (el doble toque), 201 si se acaba de
            // firmar. Las dos llevan la MISMA forma: la pantalla de
            // «Sesión cerrada» no tiene que saber cuál de las dos fue.
            return reply.code(r.yaEstaba ? 200 : 201).send({
              yaEstaba: r.yaEstaba,
              cerrada: serializarSesionCerrada(r.cerrada, verImportes),
            });
          },
        ),
      ),
  );
}
