// catalogo-local · la puerta del alta local (ADR-017).
//
// Hermana de `caja-gate.ts`, con la MISMA forma —un `preHandler` que
// corre tras la autenticación y devuelve 403 con un error nombrado— y
// con una diferencia deliberada y grande, que es la dirección del fallo.
// Ver la nota de abajo.
//
//   app.post("/catalog/products", {
//     preHandler: [requireOwnerOrManager, ensureCajaEnabled, ensureLocalCatalogWritable],
//   }, handler)
//
// ── Qué abre, y por qué ese predicado y no otro ────────────────────────
//
// El alta local se abre SI Y SÓLO SI `holdedEnabled === false`. En
// cualquier otro caso queda cerrada: el catálogo mixto —local y Holded
// conviviendo en el mismo comercio, con alta local abierta— tiene
// consecuencias de producto que no se deciden aquí. Un producto local en
// un tenant con Holded sería una línea que no se puede subir, y su
// ticket entero caería en la bandeja de errores.
//
// ADDENDUM 3 · esto CAMBIA lo que decía el §3 del prompt del bloque, que
// pedía cerrar "si el tenant tiene Holded conectado". Con el interruptor
// la regla es mejor y más estricta, y la diferencia es un tenant entero:
//
//   holdedEnabled = false               → ABIERTA. No usa Holded y no lo
//                                         va a usar: su catálogo es éste.
//   holdedEnabled = true, SIN clave aún → CERRADA. Está a mitad de su
//                                         onboarding. Dejarle crear
//                                         productos locales ahora sería
//                                         fabricarle el catálogo mixto
//                                         que este bloque existe para
//                                         impedir, justo el día antes de
//                                         conectar su ERP.
//   holdedEnabled = true, CON clave     → CERRADA. Manda Holded.
//
// Antes del addendum el predicado era `holdedApiKeyCiphertext != null`, y
// esa señal significa dos cosas a la vez ("todavía no" y "nunca"). La
// primera de las tres filas de arriba es la que se perdía.
//
// ── Por qué esta puerta falla al REVÉS que la de la caja ───────────────
//
// `caja-gate.ts` es tolerante y falla hacia "caja encendida": si no
// puede leer la fila, deja pasar. Su razón está escrita allí y es buena
// —lo peor que puede hacer ese gate es dejar sin cobrar a un cliente que
// cobra—. Aquí es al contrario y a propósito:
//
//   · Esto NO está en el camino de cobro. Nadie se queda sin vender
//     porque no pueda dar de alta un producto: lo intenta otra vez.
//   · Fallar hacia "abierto" crearía un producto local en un tenant con
//     Holded, que es exactamente el estado que el bloque entero existe
//     para impedir. Y a diferencia de un 403, ese estado PERSISTE: queda
//     una fila en la base que alguien tendrá que ir a buscar.
//
// Un error al leer deja la puerta cerrada y devuelve 503, no 403: el
// propietario tiene que poder distinguir "no puedes" de "no he podido
// comprobarlo". Decirle "tu comercio tiene Holded" cuando lo que ha
// pasado es que la base no contesta sería mentirle.

import type { FastifyReply, FastifyRequest } from "fastify";

import { getPrisma } from "../context.js";

export const LOCAL_CATALOG_DISABLED_MESSAGE =
  "El catálogo de este comercio se gestiona desde Holded, así que no se crean productos aquí. " +
  "El alta local es para los comercios que no usan Holded.";

export const LOCAL_CATALOG_UNKNOWN_MESSAGE =
  "No hemos podido comprobar si tu comercio tiene Holded conectado. Inténtalo de nuevo en un momento.";

/**
 * `true` salvo que el tenant tenga el interruptor de Holded apagado, que
 * es el único caso en el que el alta local se permite. Lanza si no puede
 * saberlo — a diferencia de `cajaIsDisabled`, que se traga el error. Ver
 * la cabecera.
 *
 * `!== false` y no `!`: la columna es `@default(true)` y sólo un `false`
 * explícito la apaga. Con `!holdedEnabled`, un tenant leído de una base
 * a la que no hubiera llegado la migración abriría el alta local a todo
 * el mundo — que es exactamente el fallo que este gate previene.
 */
export async function localCatalogIsClosed(tenantId: string): Promise<boolean> {
  const tenant = await getPrisma().tenant.findUnique({
    where: { id: tenantId },
    select: { holdedEnabled: true },
  });
  // Tenant inexistente: cerrado. No hay ningún caso legítimo en el que
  // un usuario autenticado apunte a un tenant que no existe.
  if (!tenant) return true;
  return tenant.holdedEnabled !== false;
}

export async function ensureLocalCatalogWritable(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // El alta local es del panel: sólo `request.auth`. No se cruza desde
  // el TPV ni desde un dispositivo, así que no se resuelven las tres
  // puertas como hace el gate de la caja.
  const tenantId = request.auth?.tenantId;
  // Sin tenant no ha corrido la autenticación todavía y el `preHandler`
  // que va delante ya habrá respondido 401.
  if (!tenantId) return;

  let closed: boolean;
  try {
    closed = await localCatalogIsClosed(tenantId);
  } catch (err) {
    request.log.error(
      { tenantId },
      `no se pudo comprobar la puerta del catálogo local: ${err instanceof Error ? err.message : String(err)}`,
    );
    reply.code(503).send({
      error: "LOCAL_CATALOG_GATE_UNAVAILABLE",
      message: LOCAL_CATALOG_UNKNOWN_MESSAGE,
    });
    return;
  }

  if (closed) {
    reply.code(403).send({
      error: "LOCAL_CATALOG_DISABLED",
      message: LOCAL_CATALOG_DISABLED_MESSAGE,
    });
  }
}
