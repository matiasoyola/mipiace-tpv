// Manejador de errores global de la API (v1.5-consistencia-A §4.a).
//
// Antes de esto, cualquier excepción no capturada en un handler acababa
// en el error handler por defecto de Fastify: 500 genérico con el
// `message` interno filtrado al cliente (a veces en inglés, a veces con
// detalles de infraestructura). Política: mensajes al usuario en
// español (docs/errores/README.md), stack sólo en logs, y los errores
// del holded-client mapeados a códigos propios para que los frontends
// puedan distinguir "Holded está caído" de "nuestra API ha petado".

import type { FastifyError, FastifyInstance } from "fastify";
import { ZodError } from "zod";

import {
  HoldedApiError,
  HoldedInvalidResponseError,
  HoldedSilentRejectError,
  HoldedSubscriptionSuspendedError,
} from "@mipiacetpv/holded-client";
import { Prisma } from "@mipiacetpv/db";

import { captureError } from "./sentry.js";
import { sqlStateOf } from "./sqlstate.js";

function isHoldedError(
  err: unknown,
): err is
  | HoldedApiError
  | HoldedInvalidResponseError
  | HoldedSilentRejectError
  | HoldedSubscriptionSuspendedError {
  return (
    err instanceof HoldedApiError ||
    err instanceof HoldedInvalidResponseError ||
    err instanceof HoldedSilentRejectError ||
    err instanceof HoldedSubscriptionSuspendedError
  );
}

/**
 * clinica-1 · ¿este error es el motor negándose a tocar la historia
 * clínica? Devuelve la frase que se le enseña a la persona, o `null`.
 *
 * Se reconoce por DOS vías, y hacen falta las dos:
 *
 *   · el prefijo `HISTORIA_VIOLADA` de los triggers (editar o borrar una
 *     entrada, una anotación, un acceso o una línea del registro);
 *   · el nombre de la constraint `clinical_*_fkey` del RESTRICT (borrar
 *     el paciente, el tenant o el autor que tienen historia detrás).
 *
 * Lo que NO se hace: reenviar el mensaje de Postgres al cliente. Esos
 * mensajes llevan ids de fila y nombres de tabla; son para el log, no
 * para una pantalla. Lo que se enseña es una frase escrita para quien la
 * lee.
 */
/** El mensaje del error, venga como `Error` o como lo que venga. */
function textoDeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function negativaClinica(err: unknown): string | null {
  const texto = textoDeError(err);
  if (texto.includes("HISTORIA_VIOLADA")) {
    // El trigger ya distingue los casos en su propio mensaje; aquí se
    // reparte en las dos frases que una persona necesita.
    if (texto.includes("no se edita")) {
      return (
        "La historia clínica no se edita: lo escrito queda. Para corregirlo, " +
        "añade una anotación — se guarda con tu nombre y la fecha."
      );
    }
    return (
      "La historia clínica no se borra. La ley obliga a conservarla y a poder " +
      "enseñársela al paciente; para dejarla sin efecto se revoca el acceso, que " +
      "también queda escrito."
    );
  }
  if (sqlStateOf(err) === "23503" && /clinical_\w+_fkey/.test(texto)) {
    return (
      "No se puede borrar: hay historia clínica colgando de esto. La ley obliga a " +
      "conservarla cinco años, así que decide qué se hace con lo escrito antes de " +
      "quitar la ficha."
    );
  }
  return null;
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: FastifyError | Error, request, reply) => {
    const tenantId =
      request.auth?.tenantId ?? request.cashier?.tid ?? null;

    // 1. Validación de schema Fastify (ajv). Fastify ya marca estos con
    // `validation`; respetamos el 400 pero normalizamos el cuerpo.
    const fastifyErr = err as FastifyError;
    if (fastifyErr.validation) {
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        message: "Los datos enviados no son válidos.",
        details: fastifyErr.validation.map((v) => ({
          path: v.instancePath || (v.params?.missingProperty as string) || "",
          message: v.message ?? "",
        })),
      });
    }

    // 2. Validación zod (env, payloads parseados a mano).
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: "VALIDATION_ERROR",
        message: "Los datos enviados no son válidos.",
        details: err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
    }

    // 3. Errores del holded-client → 502 con código propio, nunca 500
    // genérico. Log con contexto para poder rastrear el tenant y el
    // endpoint de Holded sin exponerlos al cliente.
    if (isHoldedError(err)) {
      const holdedStatus = err instanceof HoldedApiError ? err.status : null;
      request.log.error(
        {
          err,
          tenantId,
          holdedUrl: err.url,
          holdedStatus,
          requestId: request.id,
        },
        `error de Holded en ${request.method} ${request.url}`,
      );
      if (err instanceof HoldedSubscriptionSuspendedError) {
        return reply.code(502).send({
          error: "HOLDED_SUBSCRIPTION_SUSPENDED",
          message:
            "La cuenta de Holded está suspendida por impago. Regularízala en holded.com para reanudar la sincronización.",
        });
      }
      if (err instanceof HoldedApiError && err.status === 429) {
        return reply.code(502).send({
          error: "HOLDED_RATE_LIMITED",
          message:
            "Holded está limitando las peticiones. Reintenta en unos segundos.",
        });
      }
      if (err instanceof HoldedSilentRejectError) {
        return reply.code(502).send({
          error: "HOLDED_SYNC_ERROR",
          message:
            "Holded no aplicó el cambio que enviamos. El documento queda pendiente de revisión.",
        });
      }
      return reply.code(502).send({
        error: "HOLDED_UNAVAILABLE",
        message: "No se ha podido contactar con Holded. Reintenta en unos minutos.",
      });
    }

    // 4. Errores con statusCode 4xx puestos por plugins o handlers
    // (p.ej. CORS, body too large). Respetamos el código; mensaje tal
    // cual — son errores ya pensados para el cliente.
    const statusCode = (fastifyErr.statusCode ?? 500) as number;
    if (statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({
        error: fastifyErr.code ?? "REQUEST_ERROR",
        message: err.message,
      });
    }

    // 4.a-bis clinica-1 · LO CLÍNICO NO SE BORRA, y la negativa se
    // explica.
    //
    // Las cuatro tablas clínicas cuelgan de `tenants` y de `clients` con
    // `ON DELETE RESTRICT`, y llevan triggers que rechazan el UPDATE y el
    // DELETE. Eso significa que el motor dice NO, y hasta aquí ese NO
    // llegaba como un 500 «Error de base de datos (P2010)» — verdad, y
    // completamente inútil para quien intentaba borrar una ficha.
    //
    // Hoy no hay ninguna ruta que borre un cliente ni un tenant (se
    // buscaron todas; están en el done del bloque), así que este mapeo no
    // se dispara desde ninguna pantalla. Está aquí precisamente por eso:
    // el día que alguien escriba `DELETE /clients/:id` —y lo escribirá,
    // porque el RGPD tiene un derecho de supresión— lo que se encuentre
    // es un 409 que dice por qué, y no un 500 que parece una avería.
    //
    // 409 y no 500: no es un fallo del sistema, es el sistema
    // funcionando. Y sin `captureError`: una negativa esperada no es una
    // alarma de Sentry.
    const mensajeClinico = negativaClinica(err);
    if (mensajeClinico) {
      request.log.warn(
        { tenantId, requestId: request.id, sqlState: sqlStateOf(err) },
        `negativa de la historia clínica en ${request.method} ${request.url}`,
      );
      return reply.code(409).send({
        error: "CLINICAL_RECORD_PROTECTED",
        code: "CLINICAL_RECORD_PROTECTED",
        message: mensajeClinico,
        requestId: request.id,
      });
    }

    // 4.a-ter enlaces-publicos · UN ENLACE PÚBLICO NO SE REVIVE.
    //
    // El trigger `public_links_guard` rechaza borrar un enlace,
    // des-anularlo, estirarle la caducidad, bajarle los usos o pasárselos
    // del tope. Ninguna de esas escrituras la hace la puerta —hace dos: un
    // `revoked_at` y un `used_count + 1`—, así que si este mapeo se
    // dispara es un camino nuevo que se equivocó.
    //
    // Está aquí por lo mismo que el de arriba: para que ese día lo que
    // llegue sea un 409 que dice por qué y no «Error de base de datos
    // (P2010)», que es lo que el cliente recibía. Mismo 409 y misma
    // ausencia de `captureError`: el motor negándose no es una avería.
    if (textoDeError(err).includes("ENLACE_VIOLADO")) {
      request.log.warn(
        { tenantId, requestId: request.id, sqlState: sqlStateOf(err) },
        `negativa del enlace público en ${request.method} ${request.url}`,
      );
      return reply.code(409).send({
        error: "PUBLIC_LINK_PROTECTED",
        code: "PUBLIC_LINK_PROTECTED",
        message:
          "Ese enlace ya no se puede cambiar: un enlace público no se borra, " +
          "no se des-anula y no se le alarga la caducidad. Si hace falta uno, " +
          "se crea uno nuevo y el anterior queda anulado.",
        requestId: request.id,
      });
    }

    // 4.b Errores conocidos de Prisma → mensaje legible con código, nunca
    // un 500 opaco. Antes cualquier P2002 (unique), P2003 (FK), P2011
    // (null), P2022 (columna inexistente), etc. caía al genérico "Ha
    // ocurrido un error inesperado" y las implantaciones se quedaban a
    // ciegas (fallo de activación de Sirope, 2026-07-08). El `code` de
    // Prisma viaja al cliente para poder diagnosticar sin abrir el VPS.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError ||
      err instanceof Prisma.PrismaClientValidationError
    ) {
      const prismaCode =
        err instanceof Prisma.PrismaClientKnownRequestError ? err.code : "VALIDATION";
      // Y el SQLSTATE, que es el que dice algo. `prismaCode` solo no basta:
      // todo el SQL crudo de la agenda llega aquí como `P2010` («raw query
      // failed»), que vale para un deadlock, una FK y una columna que no
      // existe. El frente carrera-409 se comió eso: el done de B-7a pudo
      // escribir "sale por el manejador genérico" sin poder decir cuál era
      // el error, y costó una sonda entera averiguarlo. No otra vez.
      const sqlState = sqlStateOf(err);
      request.log.error(
        { err, tenantId, requestId: request.id, prismaCode, sqlState },
        `error Prisma ${prismaCode}${sqlState ? ` (SQLSTATE ${sqlState})` : ""} en ${request.method} ${request.url}`,
      );
      captureError(err, {
        tenantId,
        requestId: String(request.id),
        extra: { prismaCode, sqlState, method: request.method, url: request.url },
      });
      return reply.code(500).send({
        error: "DB_ERROR",
        message: `Error de base de datos (${prismaCode}). Si persiste, contacta con soporte indicando el identificador.`,
        prismaCode,
        ...(sqlState ? { sqlState } : {}),
        requestId: request.id,
      });
    }

    // 5. Resto → 500 con requestId. Stack SOLO en logs. Sentry (Lote 2
    // v1.5-B): captura con tenantId+requestId; no-op sin SENTRY_DSN.
    //
    // Aquí también se busca el SQLSTATE: un error de base de datos no
    // siempre llega envuelto por Prisma (el driver `pg` a pelo, un error
    // reenvuelto por una capa de arriba), y el que caiga por esta rama es
    // justo el que nadie sabe qué es. Si lo trae, se registra.
    const sqlStateSuelto = sqlStateOf(err);
    request.log.error(
      { err, tenantId, requestId: request.id, sqlState: sqlStateSuelto },
      `error no controlado${sqlStateSuelto ? ` (SQLSTATE ${sqlStateSuelto})` : ""} en ${request.method} ${request.url}`,
    );
    captureError(err, {
      tenantId,
      requestId: String(request.id),
      extra: { sqlState: sqlStateSuelto, method: request.method, url: request.url },
    });
    return reply.code(500).send({
      error: "INTERNAL_ERROR",
      message:
        "Ha ocurrido un error inesperado. Si persiste, contacta con soporte indicando el identificador.",
      requestId: request.id,
    });
  });
}
