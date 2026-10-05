// clinica-1 · el registro de accesos, escrito en UN SOLO sitio.
//
// Art. 9 RGPD y Ley 41/2002: todo acceso a una historia clínica queda
// registrado. "Todo" incluye los que se niegan — un acceso denegado es
// justo el que interesa ver cuando alguien pregunta quién ha estado
// mirando la historia de su madre.
//
// Por qué un envoltorio y no una línea en cada handler: porque "cada
// handler se acuerda" es exactamente la forma de fallo que este bloque
// viene a cerrar. Hoy hay tres rutas clínicas; dentro de tres bloques
// habrá quince, y la decimosexta la escribirá alguien con prisa.
//
// La forma que toma: `conHistoria(...)`. Recibe la acción, resuelve el
// acceso con LA función (`acceso.ts`), **apunta la línea pase lo que
// pase** y sólo entonces llama al handler. Un handler envuelto no puede
// correr sin que su línea esté escrita, porque la escritura va antes.
//
// ── Lo que NUNCA entra aquí ───────────────────────────────────────────
//
// **Datos de salud.** Ni el cuerpo de la anotación, ni el motivo, ni un
// extracto. Quién, a qué paciente, cuándo, desde qué aparato, qué ruta y
// si se le dejó pasar. Tampoco van a `request.log` ni a Sentry: los
// `catch` de este fichero registran el fallo sin tocar el `body`.
//
// ── Y el orden: primero la línea, después el trabajo ─────────────────
//
// Si la línea del registro no se puede escribir, **la petición falla**.
// Es la misma decisión que el audit de impersonación
// (`auth/middleware.ts::recordImpersonationWrite`): trazabilidad por
// encima de disponibilidad puntual. Y es la decisión CONTRARIA a la de la
// venta (memoria de la casa: «cobrar siempre se puede»), a propósito —
// una invariante rota nunca tumba un cobro porque el dinero ya cambió de
// manos, pero aquí nadie ha perdido nada si la lectura no ocurre. Lo que
// no se puede perder es la prueba de que ocurrió.

import type { FastifyReply, FastifyRequest } from "fastify";

import { getPrisma } from "../context.js";
import {
  comoPrismaParaAcceso,
  resolverAccesoClinico,
  type MotivoDenegado,
  type Veredicto,
} from "./acceso.js";

export type AccionClinica = "READ" | "WRITE" | "EXPORT";

/** Quién hace la petición, resuelto desde las dos puertas de auth. */
interface Actor {
  userId: string;
  tenantId: string;
  deviceId: string | null;
}

function resolverActor(request: FastifyRequest): Actor | null {
  if (request.auth) {
    return {
      userId: request.auth.userId,
      tenantId: request.auth.tenantId,
      // El panel no tiene device. `request.cashier` sí, cuando la
      // petición viene del TPV por `requireOwnerOrCashier`.
      deviceId: request.cashier?.did ?? null,
    };
  }
  if (request.cashier) {
    return {
      userId: request.cashier.userId,
      tenantId: request.cashier.tid,
      deviceId: request.cashier.did,
    };
  }
  return null;
}

/** La ruta sin querystring. Es trazabilidad, no contenido. */
function rutaDe(request: FastifyRequest): string {
  const url = request.url.split("?")[0] ?? request.url;
  return `${request.method.toUpperCase()} ${url}`.slice(0, 200);
}

/**
 * Escribe la línea. Falla hacia arriba a propósito: quien llama decide
 * qué hacer, y en `conHistoria` lo que se hace es abortar la petición.
 */
export async function apuntarAcceso(input: {
  tenantId: string;
  userId: string;
  clientId: string;
  action: AccionClinica;
  outcome: "ALLOWED" | "DENIED";
  deviceId: string | null;
  route: string | null;
}): Promise<void> {
  const prisma = getPrisma();
  await prisma.clinicalAccessLog.create({
    data: {
      tenantId: input.tenantId,
      userId: input.userId,
      clientId: input.clientId,
      action: input.action,
      outcome: input.outcome,
      deviceId: input.deviceId,
      route: input.route,
    },
  });
}

// El HTTP de cada negativa. `CLINICA_APAGADA` no debería llegar aquí
// nunca —`ensureClinicaEnabled` corta antes— y si llega se comporta
// igual que el gate: 404, para no destapar el módulo por una ruta que se
// registrara sin su puerta.
const HTTP_DEL_MOTIVO: Record<MotivoDenegado, number> = {
  CLINICA_APAGADA: 404,
  NO_SANITARIO: 403,
  SIN_ACCESO_AL_PACIENTE: 403,
};

export interface ContextoClinico {
  tenantId: string;
  userId: string;
  clientId: string;
  deviceId: string | null;
  veredicto: Veredicto;
}

/**
 * EL punto por el que pasa toda ruta clínica.
 *
 * Resuelve el acceso, apunta la línea (permitido o denegado), y sólo si
 * el veredicto es sí ejecuta el handler. Devuelve lo que devuelva el
 * handler; si corta, ya ha respondido.
 *
 * `clientId` tiene que venir YA validado como del tenant: el aislamiento
 * por fila es de quien llama, la autorización clínica es de aquí.
 */
export async function conHistoria<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  input: { clientId: string; action: AccionClinica },
  handler: (ctx: ContextoClinico) => Promise<T>,
): Promise<T | undefined> {
  const actor = resolverActor(request);
  if (!actor) {
    reply
      .code(401)
      .send({ error: "UNAUTHENTICATED", message: "Falta token" });
    return undefined;
  }

  const prisma = getPrisma();
  const { veredicto } = await resolverAccesoClinico(
    comoPrismaParaAcceso(prisma),
    {
      tenantId: actor.tenantId,
      userId: actor.userId,
      clientId: input.clientId,
    },
  );

  // LA LÍNEA, ANTES DE TODO. Si no se puede escribir, no se pasa.
  try {
    await apuntarAcceso({
      tenantId: actor.tenantId,
      userId: actor.userId,
      clientId: input.clientId,
      action: input.action,
      outcome: veredicto.puede ? "ALLOWED" : "DENIED",
      deviceId: actor.deviceId,
      route: rutaDe(request),
    });
  } catch (err) {
    // Sin `body`, sin nombre de paciente, sin nada del contenido: el
    // error y los ids, que es lo que hace falta para arreglarlo.
    request.log.error(
      {
        event: "clinical_access_log_failed",
        clientId: input.clientId,
        action: input.action,
        err,
      },
      "no se pudo registrar el acceso a la historia clínica — se corta la petición",
    );
    reply.code(500).send({
      error: "CLINICAL_ACCESS_LOG_FAILED",
      code: "CLINICAL_ACCESS_LOG_FAILED",
      message:
        "No se pudo registrar el acceso a la historia clínica. Reintenta; si sigue, avisa a Mi Piace.",
    });
    return undefined;
  }

  if (!veredicto.puede) {
    const status = HTTP_DEL_MOTIVO[veredicto.motivo];
    if (status === 404) {
      const { respondeComoRutaInexistente } = await import("./gate.js");
      respondeComoRutaInexistente(request, reply);
      return undefined;
    }
    reply.code(status).send({
      error: veredicto.motivo,
      code: veredicto.motivo,
      message: veredicto.mensaje,
    });
    return undefined;
  }

  return handler({
    tenantId: actor.tenantId,
    userId: actor.userId,
    clientId: input.clientId,
    deviceId: actor.deviceId,
    veredicto,
  });
}
