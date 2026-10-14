// clinica-7 · las rutas del contrato de encargado del tratamiento.
//
//   GET  /clinica/contrato              — el texto, el estado y el historial
//   GET  /clinica/contrato/:version.pdf — el PDF de una versión
//   POST /clinica/contrato/aceptar      — SOLO LA DUEÑA
//   POST /clinica/contrato/revocar      — SOLO LA DUEÑA
//
// ── Estas rutas NO pasan por el gate clínico ────────────────────────
//
// Y es el punto de la pieza. `ensureClinicaEnabled` contesta 404 cuando el
// módulo está apagado, y aquí eso sería un círculo: la pantalla de
// aceptación tiene que poder abrirse **antes** de que la historia
// funcione, porque es lo que hace que funcione.
//
// Lo que sí comprueban: que la clínica esté ENCENDIDA (si no, la 404 del
// gate, igual que todo lo clínico — un bar no destapa que este módulo
// existe). La diferencia con el gate es el estado del contrato, no la
// capability.
//
// ── Y las de LEER quedan exentas del guard de cuenta bloqueada ──────
//
// Decisión 6, y es el mismo argumento que `/legal`: el bloqueo de una
// cuenta es comercial. Una clínica con una factura sin pagar sigue teniendo
// que poder leer y descargar el contrato de tratamiento de datos de salud
// que aceptó — es su prueba de cumplimiento del art. 28, y esconderlo por
// una deuda sería esconder un documento legal.
//
// **Aceptar y revocar NO están exentas**: son escrituras, y una cuenta
// bloqueada no escribe.
//
// ── Quién es «la dueña» ─────────────────────────────────────────────
//
// `requireOwner` ya exige OWNER por el rol del JWT. Se comprueba ADEMÁS el
// rol de la BASE, con la misma razón de `esSanitarioSinCaja`: cierra la
// ventana en que alguien a quien se le quitó el OWNER sigue teniendo un
// token firmado con el rol viejo. Para un contrato que vale como prueba
// jurídica, media hora de ventana es media hora de más.

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { contratoDe } from "@mipiacetpv/contrato-encargado";
import { renderContratoEncargadoPdf } from "@mipiacetpv/ticket-pdf";

import { requireOwner, requireOwnerOrCashier } from "../auth/middleware.js";
import { getPrisma } from "../context.js";
import { datosDelCentro } from "./consentimientos.js";
import {
  aceptarContrato,
  huellaDelContrato,
  revocarContrato,
  vistaDelContrato,
} from "./contrato.js";
import { ZipDemasiadoGrande, exportarElCentro } from "./exportacion.js";
import {
  clinicaIsEnabled,
  esMiPiaceMirando,
  respondeComoRutaInexistente,
} from "./gate.js";

/**
 * ¿Está la cuenta bloqueada?
 *
 * `/clinica/contrato` está en la lista de exentos de
 * `tenant-block-guard.ts`, y ese prefijo cubre también los POST. Así que
 * el 423 de cuenta bloqueada lo pone AQUÍ, en las dos escrituras y no en
 * las lecturas.
 *
 * Partir el prefijo por método en el guard global habría metido ahí una
 * lista de métodos que la siguiente ruta de este módulo olvidaría; con la
 * comprobación en la ruta, lo que está exento es lo que la ruta dice que
 * está exento.
 */
async function cuentaBloqueada(
  tenantId: string,
): Promise<{ reason: string | null } | null> {
  const fila = await getPrisma().tenant.findUnique({
    where: { id: tenantId },
    select: { blockedAt: true, blockedReason: true },
  });
  if (fila == null || fila.blockedAt == null) return null;
  return { reason: fila.blockedReason ?? null };
}

function respondeCuentaBloqueada(
  reply: FastifyReply,
  bloqueo: { reason: string | null },
): FastifyReply {
  return reply.code(423).send({
    error: "TENANT_BLOCKED",
    code: "TENANT_BLOCKED",
    message: "Cuenta bloqueada. Contacta con soporte.",
    reason: bloqueo.reason,
  });
}

/**
 * ¿Es la dueña, según la BASE y no solo según el token?
 *
 * `null` cuando el usuario ya no está o no es OWNER. Ver la cabecera.
 */
async function esLaDuena(tenantId: string, userId: string): Promise<boolean> {
  const fila = await getPrisma().user.findFirst({
    where: { id: userId, tenantId, deletedAt: null },
    select: { role: true },
  });
  return fila?.role === "OWNER";
}

/**
 * clinica-7 · decisión 24 · **MI PIACE NO ACEPTA EL CONTRATO.**
 *
 * Estas rutas no llevan `ensureClinicaEnabled` (no pueden: la pantalla de
 * aceptación tiene que abrirse antes de que la historia funcione), así que
 * el corte va aquí.
 *
 * Y aquí importa más que en ninguna otra ruta clínica. El token de
 * impersonación lleva `sub: owner.id`, así que una aceptación hecha desde
 * una sesión de Mi Piace escribiría una fila que dice **«Rosario aceptó el
 * contrato el 14 de octubre»** — y esa fila es la prueba jurídica de que
 * la clínica autorizó a Mi Piace a tratar datos de salud. Una prueba que
 * Mi Piace se puede firmar a sí misma no es una prueba.
 *
 * Las de LEER también se cortan, por consistencia con el resto de lo
 * clínico: el superadmin no necesita leer el contrato de una clínica desde
 * dentro de su sesión — lo tiene en el repo, versionado.
 */
function respondeSiEsMiPiace(
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  if (!esMiPiaceMirando(request)) return false;
  request.log.warn(
    { event: "clinica_contrato_impersonacion_rechazada", route: request.url },
    "una sesión de impersonación ha intentado tocar el contrato de encargado",
  );
  respondeComoRutaInexistente(request, reply);
  return true;
}

/** La IP, con el proxy delante. Fastify ya la resuelve con `trustProxy`
 *  cuando está configurado; aquí solo se recorta. */
function ipDe(request: FastifyRequest): string | null {
  return request.ip?.slice(0, 45) ?? null;
}

function userAgentDe(request: FastifyRequest): string | null {
  const ua = request.headers["user-agent"];
  return typeof ua === "string" ? ua.slice(0, 300) : null;
}

/** El aparato, cuando la petición viene del TPV. El panel no tiene. */
function deviceDe(request: FastifyRequest): string | null {
  return request.cashier?.did ?? null;
}

export async function registerContratoRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ── Leerlo ──────────────────────────────────────────────────────────
  //
  // `requireOwnerOrCashier` y no `requireOwner`: el encargado, los cajeros
  // y los sanitarios ENTRAN a esta ruta. Lo que ven es el estado y el
  // aviso de la decisión 2 («la dueña tiene que aceptarlo»); lo que no
  // pueden es aceptar. Negarles la lectura habría sido una pantalla que
  // dice «falta algo» sin poder decir qué.
  app.get(
    "/clinica/contrato",
    { preHandler: [requireOwnerOrCashier] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (respondeSiEsMiPiace(request, reply)) return reply;
      const tenantId = request.auth?.tenantId ?? request.cashier?.tid;
      if (tenantId == null) {
        return reply
          .code(401)
          .send({ error: "UNAUTHENTICATED", message: "Falta token" });
      }
      // La capability sí: un bar no destapa que este módulo existe.
      if (!(await clinicaIsEnabled(tenantId))) {
        return respondeComoRutaInexistente(request, reply);
      }
      const vista = await vistaDelContrato(tenantId);
      const userId = request.auth?.userId ?? request.cashier?.userId ?? "";
      return reply.send({
        ...vista,
        // Lo que la PANTALLA necesita para decidir si pinta el botón o el
        // aviso. Lo decide el servidor y no el rol del token: es la misma
        // regla que decide quién puede aceptar, y así las dos no pueden
        // discrepar.
        puedeAceptar: await esLaDuena(tenantId, userId),
      });
    },
  );

  // ── El PDF de una versión ───────────────────────────────────────────
  //
  // «El PDF de cada versión aceptada, para descargar siempre» (decisión
  // 6). Siempre incluye con el contrato revocado: lo que se aceptó se
  // aceptó, y la prueba no caduca.
  app.get(
    "/clinica/contrato/:version.pdf",
    {
      preHandler: [requireOwnerOrCashier],
      schema: {
        params: {
          type: "object",
          required: ["version"],
          additionalProperties: false,
          properties: { version: { type: "integer", minimum: 1 } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (respondeSiEsMiPiace(request, reply)) return reply;
      const tenantId = request.auth?.tenantId ?? request.cashier?.tid;
      if (tenantId == null) {
        return reply
          .code(401)
          .send({ error: "UNAUTHENTICATED", message: "Falta token" });
      }
      if (!(await clinicaIsEnabled(tenantId))) {
        return respondeComoRutaInexistente(request, reply);
      }
      const { version } = request.params as { version: number };
      const contrato = contratoDe(version);
      if (contrato == null) {
        // Una versión que este despliegue no sabe enseñar. NO se cae a la
        // vigente: eso sería afirmar que la dueña aceptó un texto que no
        // existía.
        return reply.code(404).send({
          error: "VERSION_DESCONOCIDA",
          code: "VERSION_DESCONOCIDA",
          message:
            "Este programa no tiene el texto de esa versión del contrato. En la pantalla queda su huella y su fecha, que es lo que demuestra qué se aceptó.",
        });
      }

      const prisma = getPrisma();
      const [centro, aceptacion] = await Promise.all([
        datosDelCentro(prisma, tenantId),
        prisma.clinicalProcessorAgreement.findFirst({
          where: { tenantId, version, revokesAgreementId: null },
          orderBy: { at: "desc" },
          select: { at: true, user: { select: { alias: true, email: true } } },
        }),
      ]);

      const pdf = await renderContratoEncargadoPdf({
        centro,
        titulo: contrato.titulo,
        apartados: contrato.apartados,
        version: contrato.version,
        textoSha256: huellaDelContrato(version)!,
        // `null` cuando la versión no se ha aceptado todavía: entonces el
        // PDF es el texto que se va a aceptar, y el pie lo dice.
        aceptacion:
          aceptacion == null
            ? null
            : {
                cuando: aceptacion.at.toISOString(),
                quien:
                  aceptacion.user.alias?.trim() || aceptacion.user.email,
              },
        avisoDePlantilla: contrato.pendienteDeValidar
          ? "Texto de ejemplo del programa, pendiente de revisar por un abogado."
          : null,
      });

      return reply
        .header("Content-Type", "application/pdf")
        .header("Content-Length", pdf.byteLength)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header(
          "Content-Disposition",
          `inline; filename="contrato-tratamiento-datos-v${version}.pdf"`,
        )
        .send(Buffer.from(pdf));
    },
  );

  // ── Aceptarlo ───────────────────────────────────────────────────────
  app.post(
    "/clinica/contrato/aceptar",
    {
      preHandler: [requireOwnerOrCashier],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: { version: { type: "integer", minimum: 1 } },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (respondeSiEsMiPiace(request, reply)) return reply;
      const tenantId = request.auth?.tenantId ?? request.cashier?.tid;
      const userId = request.auth?.userId ?? request.cashier?.userId;
      if (tenantId == null || userId == null) {
        return reply
          .code(401)
          .send({ error: "UNAUTHENTICATED", message: "Falta token" });
      }
      if (!(await clinicaIsEnabled(tenantId))) {
        return respondeComoRutaInexistente(request, reply);
      }
      // Escritura: la cuenta bloqueada no escribe. Ver `cuentaBloqueada`.
      const bloqueo = await cuentaBloqueada(tenantId);
      if (bloqueo) return respondeCuentaBloqueada(reply, bloqueo);

      const body = (request.body ?? {}) as { version?: number };

      const r = await aceptarContrato(getPrisma(), {
        tenantId,
        userId,
        // La BASE, no el token. Ver la cabecera.
        esDuena: await esLaDuena(tenantId, userId),
        deviceId: deviceDe(request),
        ip: ipDe(request),
        userAgent: userAgentDe(request),
        version: body.version,
      });
      if (!r.ok) {
        // 403 para «no eres la dueña» y 409 para los otros dos: el primero
        // es de permisos y los otros dos son de estado.
        const status = r.motivo === "SOLO_LA_DUENA" ? 403 : 409;
        return reply
          .code(status)
          .send({ error: r.motivo, code: r.motivo, message: r.mensaje });
      }
      return reply.code(201).send(r);
    },
  );

  // ── clinica-7 · LA DEVOLUCIÓN DE DATOS (art. 28.3.g) ───────────────
  //
  // Decisión 7: «exportar el centro entero (solo OWNER, queda
  // registrado)». Un ZIP con la historia completa de cada paciente en PDF,
  // sus fotos y consentimientos descifrados, y un JSON con todo.
  //
  // ── Vive en este fichero y no en `routes.ts` ──────────────────────
  //
  // Porque es del CONTRATO y no de la historia: es lo que la clínica pide
  // cuando se va, y **funciona con el contrato revocado** — que es justo
  // cuando hace falta. Ponerla entre las rutas de la historia la habría
  // dejado detrás del gate de la sesión clínica, que no es su puerta.
  //
  // ── Solo la dueña, y comprobado contra la BASE ────────────────────
  //
  // Esto saca del sistema la historia clínica de TODOS los pacientes del
  // centro en un fichero. No es una lectura: es la copia entera. El
  // encargado no la saca, ni los sanitarios, ni los cajeros.
  //
  // ── Y se sirve en trozos ──────────────────────────────────────────
  //
  // `exportarElCentro` suelta cada entrada en cuanto la tiene, así que un
  // centro con mil fotos no pasa por memoria dos veces. `reply.raw` y no
  // `reply.send`: Fastify serializaría el cuerpo entero.
  app.get(
    "/clinica/exportacion",
    { preHandler: [requireOwner] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (respondeSiEsMiPiace(request, reply)) return reply;
      const auth = request.auth!;
      if (!(await clinicaIsEnabled(auth.tenantId))) {
        return respondeComoRutaInexistente(request, reply);
      }
      if (!(await esLaDuena(auth.tenantId, auth.userId))) {
        return reply.code(403).send({
          error: "SOLO_LA_DUENA",
          code: "SOLO_LA_DUENA",
          message:
            "La devolución de los datos del centro la saca la dueña: es una copia de la historia de todos los pacientes.",
        });
      }

      const ahora = new Date();
      const nombre = `historias-${ahora.toISOString().slice(0, 10)}.zip`;
      reply.raw.setHeader("Content-Type", "application/zip");
      reply.raw.setHeader("Cache-Control", "no-store");
      reply.raw.setHeader("X-Content-Type-Options", "nosniff");
      reply.raw.setHeader(
        "Content-Disposition",
        `attachment; filename="${nombre}"`,
      );

      try {
        const resumen = await exportarElCentro(
          getPrisma(),
          {
            tenantId: auth.tenantId,
            userId: auth.userId,
            deviceId: deviceDe(request),
            ahora,
          },
          (trozo) => {
            reply.raw.write(trozo);
          },
        );
        // El resumen al LOG y no a la respuesta: la respuesta es el ZIP, y
        // ya se ha empezado a escribir. Sin nada de salud dentro —cuántos
        // pacientes y cuántos ficheros— como todos los logs de este
        // módulo.
        request.log.info(
          { event: "clinica_exportacion", ...resumen, incidencias: resumen.incidencias.length },
          "exportación del centro servida",
        );
        reply.raw.end();
        return reply;
      } catch (err) {
        if (err instanceof ZipDemasiadoGrande) {
          // Ya se han escrito bytes, así que no hay forma honesta de
          // cambiar el código de estado: lo que se puede hacer es cortar y
          // dejarlo dicho en el log. El fichero a medias NO abrirá —le
          // falta el directorio final— y eso es correcto: un ZIP que abre
          // y está incompleto sería peor.
          request.log.error(
            { event: "clinica_exportacion_demasiado_grande", err },
            "la exportación del centro pasa de 4 GiB: hay que exportar por paciente (ver el -done de clinica-7)",
          );
        } else {
          request.log.error(
            { event: "clinica_exportacion_fallida", err },
            "la exportación del centro falló a medias",
          );
        }
        reply.raw.destroy();
        return reply;
      }
    },
  );

  // ── Revocarlo ───────────────────────────────────────────────────────
  //
  // `requireOwner` aquí, y no `requireOwnerOrCashier`: revocar no se hace
  // desde el TPV de recepción. La pantalla del TPV que la decisión 6 pide
  // vive en el panel del propietario, y el propietario entra con `auth`.
  app.post(
    "/clinica/contrato/revocar",
    { preHandler: [requireOwner] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (respondeSiEsMiPiace(request, reply)) return reply;
      const auth = request.auth!;
      if (!(await clinicaIsEnabled(auth.tenantId))) {
        return respondeComoRutaInexistente(request, reply);
      }
      const bloqueo = await cuentaBloqueada(auth.tenantId);
      if (bloqueo) return respondeCuentaBloqueada(reply, bloqueo);

      const r = await revocarContrato(getPrisma(), {
        tenantId: auth.tenantId,
        userId: auth.userId,
        esDuena: await esLaDuena(auth.tenantId, auth.userId),
        deviceId: deviceDe(request),
        ip: ipDe(request),
        userAgent: userAgentDe(request),
      });
      if (!r.ok) {
        const status = r.motivo === "SOLO_LA_DUENA" ? 403 : 409;
        return reply
          .code(status)
          .send({ error: r.motivo, code: r.motivo, message: r.mensaje });
      }
      return reply.code(201).send({
        ...r,
        // Lo que la pantalla escribe en la confirmación de después, para
        // que nadie se quede pensando qué acaba de pasar con sus datos.
        consecuencias: [
          "La historia clínica pasa a SOLO LECTURA: se puede leer, imprimir y exportar todo lo que ya hay.",
          "No se puede escribir nada clínico nuevo: ni sesiones, ni fotos, ni valoraciones, ni consentimientos.",
          "Las citas nuevas no admiten notas escritas a mano: solo hora, paciente y servicio.",
          "La agenda y la caja siguen funcionando igual.",
        ],
      });
    },
  );
}
