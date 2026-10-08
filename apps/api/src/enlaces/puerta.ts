// enlaces-publicos · LA PUERTA. Un solo sitio por el que entra todo lo que
// se abre sin cuenta.
//
// Decisión S1.2 (07-10): formato antes de la base; huella; caducidad;
// usos; revocado; **la misma 404** para «no existe», «caducado»,
// «gastado» y «anulado»; y las mismas tres cabeceras para todos.
//
// ── Por qué una puerta y no una por pantalla ─────────────────────────
//
// Hoy hay un enlace público bien hecho (la valoración de clinica-2) y
// vienen cuatro: consentimiento para leer, «mi cita», la encuesta
// post-visita y el formulario del equipo. Si cada uno hace el suyo, cada
// uno elige sus cabeceras, sus topes y su forma de caducar, y el que se
// equivoque expone datos.
//
// Lo que se gana, dicho en lo que cambia:
//
//   1. Un enlace que se filtra no enseña nada que no deba, porque lo
//      decide la puerta y no cada pantalla.
//   2. El bloque siguiente que necesite un enlace declara su `purpose` en
//      `reglas.ts` y no vuelve a escribir seguridad.
//   3. Recepción puede anular cualquier enlace desde un sitio
//      (`revocarEnlace`), de cualquier `purpose`.
//
// ── El orden de las comprobaciones, que importa ──────────────────────
//
//   0. **Las tres cabeceras, antes de cualquier rama.** Así las lleva TODA
//      respuesta que pasa por la puerta: el 200, la 404, el 429 y hasta el
//      500. Si se pusieran en cada rama, la rama nueva de dentro de dos
//      bloques no las llevaría.
//   1. El candado del límite general. Una IP (o un token) bloqueada no
//      gasta ni una consulta.
//   2. **El formato, ANTES de la base.** Un token con otra forma no es de
//      nadie y no merece una consulta — pero sí cuenta como intento.
//   3. La huella contra el único de `public_links`.
//   4. El `purpose`: la fila tiene que ser del `purpose` que pregunta. Un
//      token de «mi cita» no abre la valoración ni al contrario.
//   5. Anulado, caducado, gastado.
//   6. El objetivo, con el `tenantId` del enlace, y si su estado lo
//      admite (lo pregunta el `purpose`).
//
// Entre la 3 y la 6 la respuesta es SIEMPRE la misma 404. El motivo se
// queda en el log de la aplicación: es lo que permite ayudar a quien llama
// diciendo «me da error» sin que la respuesta HTTP se lo cuente a nadie
// más.

import type { FastifyReply, FastifyRequest } from "fastify";
import type { Prisma, PrismaClient } from "@mipiacetpv/db";

import { inspect, registerFailure, reset } from "../auth/rate-limit.js";
import { getPrisma } from "../context.js";
import {
  comoPrismaParaActor,
  resolverActorPaciente,
} from "../clinica/actor-paciente.js";
import { apuntarAcceso } from "../clinica/registro.js";
import { contarTokenInexistente, limiteGeneral } from "./limites.js";
import { PATRON_TOKEN, huellaDeToken, mismaHuella, nuevoToken } from "./token.js";
import type { PrismaDeLectura, ReglasDePurpose } from "./reglas.js";

// ── Las tres cabeceras ────────────────────────────────────────────────
//
// Las mismas para todos los `purpose`, y cada una cierra un camino por el
// que la URL —que ES la credencial— se escaparía sola:
//
//   · `Cache-Control: no-store` · ni el navegador ni un proxy guardan la
//     respuesta. Sin esto, el formulario de un paciente queda en la caché
//     de la tablet de la sala para el siguiente que la coja.
//   · `X-Robots-Tag: noindex` · si una de estas URLs acaba en un sitemap,
//     en un tuit o en un correo reenviado que un buscador rastrea, no se
//     indexa. Es la diferencia entre «se filtró a una persona» y «está en
//     Google».
//   · `Referrer-Policy: no-referrer` · la URL NO viaja en el `Referer` de
//     nada que la página cargue o enlace. El token está EN la ruta: sin
//     esta cabecera, un recurso externo recibiría la credencial entera en
//     una cabecera de su propio log.
export const CABECERAS_DE_ENLACE: Readonly<Record<string, string>> =
  Object.freeze({
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex",
    "Referrer-Policy": "no-referrer",
  });

/** Las tres, de una vez. Las pone la puerta antes de cualquier rama. */
export function cabecerasDeEnlace(reply: FastifyReply): FastifyReply {
  for (const [k, v] of Object.entries(CABECERAS_DE_ENLACE)) {
    reply.header(k, v);
  }
  return reply;
}

/**
 * LA respuesta de «este enlace no sirve». Una sola por `purpose`, para los
 * cuatro casos y para todas sus rutas: si se separan, se pueden
 * distinguir.
 */
export function enlaceNoSirve(
  reply: FastifyReply,
  reglas: ReglasDePurpose<never>,
): FastifyReply {
  return cabecerasDeEnlace(reply).code(404).send({
    error: reglas.mensajes.code,
    code: reglas.mensajes.code,
    message: reglas.mensajes.noSirve,
  });
}

// ── Crear ─────────────────────────────────────────────────────────────

export interface EnlaceCreado {
  /** El id de la fila, para `consumirEnlace` y `revocarEnlace`. */
  enlaceId: string;
  /** EL TOKEN EN CLARO, y existe SÓLO aquí. Va al email o a la URL que se
   *  le pinta a la persona, y a ningún otro sitio: ni a la base, ni a un
   *  log, ni a Sentry. Quien lo pierde no lo recupera — se crea otro, y
   *  éste se revoca. */
  token: string;
  expiraEn: Date;
}

/**
 * Un enlace nuevo para un objetivo.
 *
 * No revoca nada por su cuenta: quien quiera rotar llama antes a
 * `revocarEnlacesDe`. Y si no lo hace, **el INSERT falla** con el único
 * parcial `public_links_uno_vivo_key` — que es como la decisión S1.5
 * («reenviar rota el token: fila nueva, la anterior revocada») deja de ser
 * una costumbre y pasa a ser una invariante.
 *
 * `ahora` entra como parámetro para que el test pueda fijar la caducidad
 * sin tocar el reloj del proceso.
 */
export async function crearEnlace<T>(
  prisma: PrismaClient | Prisma.TransactionClient,
  reglas: ReglasDePurpose<T>,
  input: {
    tenantId: string;
    targetId: string;
    /** El canal, cuando el `purpose` tiene dos vidas (email / tablet). */
    canal?: string;
    /** Quién lo crea. `null` cuando lo crea el sistema (el alta de una
     *  cita no la pide una persona). */
    creadoPorUserId?: string | null;
    ahora?: Date;
  },
): Promise<EnlaceCreado> {
  const ahora = input.ahora ?? new Date();
  const token = nuevoToken();
  const expiraEn = new Date(ahora.getTime() + reglas.vidaMs(input.canal));
  const fila = await prisma.publicLink.create({
    data: {
      tenantId: input.tenantId,
      purpose: reglas.purpose,
      targetType: reglas.targetType,
      targetId: input.targetId,
      tokenHash: huellaDeToken(token),
      expiresAt: expiraEn,
      maxUses: reglas.maxUsos,
      createdByUserId: input.creadoPorUserId ?? null,
    },
    select: { id: true },
  });
  return { enlaceId: fila.id, token, expiraEn };
}

// ── Resolver ──────────────────────────────────────────────────────────

/** Los motivos se distinguen PARA EL LOG, no para el cliente: la puerta
 *  contesta la misma 404 en los cinco. Distinguirlos aquí es lo que
 *  permite que el log diga «caducó» en vez de «no existe», que es la
 *  diferencia entre poder ayudar a quien llama y no poder. */
export type MotivoDelRechazo =
  | "FORMATO"
  | "NO_EXISTE"
  | "OTRO_PURPOSE"
  | "ANULADO"
  | "CADUCADO"
  | "GASTADO"
  | "SIN_OBJETIVO"
  | "ESTADO_NO_ADMITE";

export interface EnlaceResuelto<T> {
  enlaceId: string;
  tenantId: string;
  /** Lo que queda por gastar. La valoración lo usa para nada: gasta en la
   *  transacción de la respuesta. Lo lee «mi cita», que es de varios usos. */
  usosRestantes: number;
  expiraEn: Date;
  /** El objeto al que apunta, cargado por el `purpose` con el `tenantId`
   *  del enlace. */
  objetivo: T;
}

/**
 * Resuelve el token a su objeto, con los dos límites delante y la misma
 * 404 detrás.
 *
 * Devuelve `null` cuando no hay nada que servir **y la respuesta ya está
 * enviada** (la 404 o el 429): el llamante hace `return reply`. Es la
 * misma forma que `resolverToken` tenía en `valoracion-publica.ts`, para
 * que la ruta no pueda olvidarse de contestar.
 */
export async function resolverEnlace<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  reglas: ReglasDePurpose<T>,
  opciones: { ahora?: Date } = {},
): Promise<EnlaceResuelto<T> | null> {
  // 0 · las tres cabeceras, antes de cualquier rama.
  cabecerasDeEnlace(reply);

  const asReglas = reglas as unknown as ReglasDePurpose<never>;
  const { token } = request.params as { token: string };
  const ahora = opciones.ahora ?? new Date();
  const huella = PATRON_TOKEN.test(token) ? huellaDeToken(token) : null;

  // El cubo general: por IP, o por la HUELLA del token en los `purpose`
  // del equipo (todo el centro sale por el mismo wifi). Si el token no
  // tiene ni forma de token no hay huella contra la que contar, y se cae
  // a la IP.
  const quien =
    reglas.limitePor === "TOKEN" ? (huella ?? request.ip) : request.ip;
  const rl = limiteGeneral(asReglas, quien);

  const estado = await inspect(rl);
  if (estado.locked) return demasiados(reply, asReglas, estado.retryAfterSeconds);

  // 2 · el formato, ANTES de la base.
  if (huella == null) {
    return rechazar(request, reply, asReglas, rl, "FORMATO", ahora);
  }

  const prisma = getPrisma();
  const fila = await prisma.publicLink.findUnique({
    where: { tokenHash: huella },
    select: {
      id: true,
      tenantId: true,
      purpose: true,
      targetId: true,
      tokenHash: true,
      expiresAt: true,
      maxUses: true,
      usedCount: true,
      revokedAt: true,
    },
  });

  // 3 · no existe. O existe con una huella que no es ésta, que no puede
  // pasar (la búsqueda es por el único) y se comprueba igual en tiempo
  // constante: es barato y quita de encima la pregunta.
  if (!fila || !mismaHuella(fila.tokenHash, huella)) {
    return rechazar(request, reply, asReglas, rl, "NO_EXISTE", ahora);
  }

  // 4 · el `purpose`. El de la fila tiene que ser el que pregunta: un
  // token de «mi cita» no abre la valoración ni al contrario.
  //
  // Y de aquí sale, sin comprobar nada más, que **una fila con un
  // `purpose` que nadie declara no abre nada**: para preguntar por un
  // `purpose` hay que traer sus REGLAS, y las reglas sólo existen en
  // `reglas.ts`. Es lo que hace que la columna sea TEXT sin ser un
  // agujero — la autorización la da el registro de código, no el valor de
  // la columna, y una fila con `purpose = 'LO_QUE_SEA'` no tiene ninguna
  // ruta que la pregunte.
  if (fila.purpose !== reglas.purpose) {
    return rechazar(request, reply, asReglas, rl, "OTRO_PURPOSE", ahora);
  }

  // 5 · anulado, caducado, gastado. En este orden porque es el orden en
  // que importan: lo que recepción anuló no sirve aunque siga en fecha.
  if (fila.revokedAt != null) {
    return rechazar(request, reply, asReglas, rl, "ANULADO", ahora);
  }
  if (fila.expiresAt.getTime() <= ahora.getTime()) {
    return rechazar(request, reply, asReglas, rl, "CADUCADO", ahora);
  }
  if (fila.usedCount >= fila.maxUses) {
    return rechazar(request, reply, asReglas, rl, "GASTADO", ahora);
  }

  // 6 · el objetivo, con el `tenantId` DEL ENLACE. Nunca uno que venga de
  // la petición: el enlace es la única cosa que sabe de qué negocio es.
  const objetivo = await reglas.cargarObjetivo(prisma, {
    tenantId: fila.tenantId,
    targetId: fila.targetId,
  });
  if (objetivo == null) {
    return rechazar(request, reply, asReglas, rl, "SIN_OBJETIVO", ahora);
  }
  if (!reglas.admiteEnlace(objetivo)) {
    return rechazar(request, reply, asReglas, rl, "ESTADO_NO_ADMITE", ahora);
  }

  // El enlace bueno no gasta intentos: si no se limpiara, quien recarga
  // treinta veces se bloquearía a sí mismo.
  await reset(rl);

  return {
    enlaceId: fila.id,
    tenantId: fila.tenantId,
    usosRestantes: fila.maxUses - fila.usedCount,
    expiraEn: fila.expiresAt,
    objetivo,
  };
}

function demasiados(
  reply: FastifyReply,
  reglas: ReglasDePurpose<never>,
  retryAfterSeconds: number,
): null {
  cabecerasDeEnlace(reply).code(429).send({
    error: "TOO_MANY_REQUESTS",
    code: "TOO_MANY_REQUESTS",
    message: reglas.mensajes.demasiados,
    retryAfterSeconds,
  });
  return null;
}

/**
 * La negativa, igual para los ocho motivos: cuenta el intento, apunta el
 * motivo en el LOG y contesta la 404 del `purpose`.
 *
 * El segundo límite —tokens inexistentes por IP, 10/min— se cuenta SÓLO
 * cuando el token no es de nadie (`FORMATO`, `NO_EXISTE`, `OTRO_PURPOSE`).
 * Un enlace caducado, gastado o anulado **no cuenta aquí**: quien recarga
 * quince veces la pantalla de «este enlace ya no sirve» no es un escáner,
 * y bloquearle sería castigar al único que de verdad quería contestar.
 */
async function rechazar(
  request: FastifyRequest,
  reply: FastifyReply,
  reglas: ReglasDePurpose<never>,
  rl: ReturnType<typeof limiteGeneral>,
  motivo: MotivoDelRechazo,
  _ahora: Date,
): Promise<null> {
  await registerFailure(rl);

  if (motivo === "FORMATO" || motivo === "NO_EXISTE" || motivo === "OTRO_PURPOSE") {
    const burst = await contarTokenInexistente(request.ip);
    if (burst.exceeded) {
      request.log.info(
        { event: "enlace_publico_rafaga", purpose: reglas.purpose },
        "demasiados tokens inexistentes desde la misma IP",
      );
      return demasiados(reply, reglas, burst.retryAfterSeconds);
    }
  }

  // NI EL TOKEN NI LA HUELLA van al log: el motivo y el `purpose`, que es
  // lo que hace falta para ayudar a quien llama.
  request.log.info(
    { event: "enlace_publico_rechazado", purpose: reglas.purpose, motivo },
    "enlace público rechazado",
  );
  enlaceNoSirve(reply, reglas);
  return null;
}

// ── Gastar ────────────────────────────────────────────────────────────

/**
 * Suma un uso, DENTRO DE LA TRANSACCIÓN DEL ACTO QUE LO GASTA.
 *
 * Por eso recibe el ejecutor (`tx`) y no abre transacción propia: si el
 * acto se deshace, el uso se deshace con él. El enlace de la valoración se
 * gasta al CONTESTAR —no al abrir—, así que el incremento va en la misma
 * transacción que la entrada de historia y el cambio de estado.
 *
 * `updateMany` con el tope en el WHERE es el cierre de la carrera: dos
 * envíos simultáneos se convierten en un `UPDATE ... WHERE used_count < N`
 * cada uno, el segundo mueve cero filas y su transacción entera se
 * deshace. No hace falta un bloqueo — y el CHECK
 * `public_links_usos_dentro_del_tope` y el trigger lo respaldan desde el
 * motor, que es lo que impide dejarlo usar una vez más con un UPDATE a
 * mano.
 *
 * Devuelve `false` cuando no quedaba uso (o ya estaba anulado), y el
 * llamante contesta la misma 404.
 */
export async function consumirEnlace(
  tx: PrismaClient | Prisma.TransactionClient,
  input: { enlaceId: string; maxUsos: number },
): Promise<boolean> {
  const movidas = await tx.publicLink.updateMany({
    where: {
      id: input.enlaceId,
      revokedAt: null,
      usedCount: { lt: input.maxUsos },
    },
    data: { usedCount: { increment: 1 } },
  });
  return movidas.count === 1;
}

// ── Anular ────────────────────────────────────────────────────────────

/**
 * Anula un enlace. Idempotente: si ya estaba anulado, el WHERE no lo
 * encuentra y no se toca (des-anularlo o re-anularlo con otra fecha lo
 * rechazaría el trigger `public_links_guard`).
 */
export async function revocarEnlace(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: { enlaceId: string; ahora?: Date },
): Promise<void> {
  await prisma.publicLink.updateMany({
    where: { id: input.enlaceId, revokedAt: null },
    data: { revokedAt: input.ahora ?? new Date() },
  });
}

/**
 * Anula TODOS los enlaces vivos de un objetivo.
 *
 * Es lo que llama quien rota («reenviar el test», abrir la tablet) ANTES
 * de crear el nuevo, y lo que llamará «mi cita» al mover o anular una cita
 * — en la misma transacción, decisión S1.5.
 *
 * Con `purpose` anula sólo los de ese `purpose`; sin él, los de todos. La
 * diferencia importa: anular una cita tiene que llevarse su enlace de «mi
 * cita» y **no** el de la valoración que salió de ella (precisión de
 * clínica en el S1 — la valoración sirve igual para la siguiente cita del
 * paciente). Como apuntan a objetivos distintos, el caso no se da hoy; el
 * parámetro existe para que el día que dos `purpose` compartan objetivo la
 * elección sea explícita.
 */
export async function revocarEnlacesDe(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: {
    tenantId: string;
    targetType: string;
    targetId: string;
    purpose?: string;
    ahora?: Date;
  },
): Promise<number> {
  const { count } = await prisma.publicLink.updateMany({
    where: {
      tenantId: input.tenantId,
      targetType: input.targetType,
      targetId: input.targetId,
      ...(input.purpose ? { purpose: input.purpose } : {}),
      revokedAt: null,
    },
    data: { revokedAt: input.ahora ?? new Date() },
  });
  return count;
}

// ── El rastro de los enlaces clínicos ─────────────────────────────────

/**
 * Deja la línea de `ClinicalAccessLog` que el `purpose` declara.
 *
 * Decisión S1.6: cada uso de un `purpose` clínico queda en el registro,
 * con el actor «paciente por enlace» que clinica-2 ya creó
 * (`actor-paciente.ts`). **Lo declara el `purpose` y no la ruta**, porque
 * «cada ruta se acuerda» es la forma de fallo que clinica-1 cerró con
 * `conHistoria` y que una puerta nueva volvería a abrir.
 *
 * No hace nada cuando el `purpose` no es clínico, y entonces no hay nada
 * que apuntar: un enlace de «mi cita» no toca la historia.
 *
 * ── Y el orden: PRIMERO LA LÍNEA, DESPUÉS EL TRABAJO ────────────────
 *
 * Se llama ANTES del acto y FUERA de su transacción, igual que
 * `conHistoria`. Si la línea no se puede escribir, la petición falla:
 * trazabilidad por encima de disponibilidad. Es la decisión CONTRARIA a la
 * de la venta («cobrar siempre se puede»), a propósito — nadie pierde nada
 * si la respuesta no se guarda; lo que no se puede perder es la prueba de
 * que ocurrió.
 *
 * Esta ruta no puede usar `conHistoria` —no hay sesión, y la función de
 * acceso contestaría «no eres sanitario»—, y por eso es el único sitio que
 * llama a `apuntarAcceso` directamente. La alternativa era un tercer valor
 * de `PermisoClinico` para «el paciente por su enlace», y eso habría
 * metido en la autorización del personal un caso que no es del personal.
 *
 * Levanta el error hacia arriba a propósito: quien llama decide qué
 * contestar.
 */
export async function registrarAccesoDelEnlace<T>(
  prisma: PrismaDeLectura,
  reglas: ReglasDePurpose<T>,
  input: { tenantId: string; objetivo: T; route: string },
): Promise<void> {
  if (!reglas.registraAccesoClinico) return;
  if (reglas.pacienteDe == null || reglas.accionClinica == null) {
    // Un `purpose` que dice dejar rastro clínico y no dice de quién no se
    // puede apuntar, y dejarlo pasar en silencio sería exactamente el
    // agujero que la decisión 6 cierra.
    throw new Error(
      `el purpose ${reglas.purpose} declara rastro clínico sin paciente ni acción`,
    );
  }
  const actorUserId = await resolverActorPaciente(
    comoPrismaParaActor(prisma as PrismaClient),
    input.tenantId,
  );
  await apuntarAcceso({
    tenantId: input.tenantId,
    userId: actorUserId,
    clientId: reglas.pacienteDe(input.objetivo),
    action: reglas.accionClinica,
    outcome: "ALLOWED",
    // No hay device: se entra desde el móvil de la persona o desde la
    // tablet sin sesión de terminal.
    deviceId: null,
    route: input.route,
  });
}
