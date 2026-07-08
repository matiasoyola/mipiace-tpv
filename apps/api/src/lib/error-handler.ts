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
      request.log.error(
        { err, tenantId, requestId: request.id, prismaCode },
        `error Prisma ${prismaCode} en ${request.method} ${request.url}`,
      );
      captureError(err, {
        tenantId,
        requestId: String(request.id),
        extra: { prismaCode, method: request.method, url: request.url },
      });
      return reply.code(500).send({
        error: "DB_ERROR",
        message: `Error de base de datos (${prismaCode}). Si persiste, contacta con soporte indicando el identificador.`,
        prismaCode,
        requestId: request.id,
      });
    }

    // 5. Resto → 500 con requestId. Stack SOLO en logs. Sentry (Lote 2
    // v1.5-B): captura con tenantId+requestId; no-op sin SENTRY_DSN.
    request.log.error(
      { err, tenantId, requestId: request.id },
      `error no controlado en ${request.method} ${request.url}`,
    );
    captureError(err, {
      tenantId,
      requestId: String(request.id),
      extra: { method: request.method, url: request.url },
    });
    return reply.code(500).send({
      error: "INTERNAL_ERROR",
      message:
        "Ha ocurrido un error inesperado. Si persiste, contacta con soporte indicando el identificador.",
      requestId: request.id,
    });
  });
}
