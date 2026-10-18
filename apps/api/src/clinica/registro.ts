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
import { negativaClinica } from "./contrato.js";
import { esMiPiaceMirando, respondeComoRutaInexistente } from "./gate.js";
import {
  comoPrismaParaAcceso,
  resolverAccesoClinico,
  type MotivoDenegado,
  type Veredicto,
} from "./acceso.js";

export type AccionClinica = "READ" | "WRITE" | "EXPORT";

// ── clinica-7 · Y ANTES DE ESCRIBIR, EL CONTRATO ─────────────────────
//
// Decisión 4: con el contrato de encargado no vigente, la historia pasa a
// SOLO LECTURA. Se puede leer y exportar todo, y no se puede escribir nada
// clínico — las rutas de escritura contestan **423** con su código propio.
//
// ── Por qué el guard va AQUÍ y no en cada ruta ──────────────────────
//
// Por la razón por la que `conHistoria` existe: «cada handler se acuerda»
// es la forma de fallo que clinica-1 cerró. Hoy hay nueve rutas que
// escriben historia; dentro de dos bloques habrá quince, y la decimosexta
// la escribirá alguien con prisa. Con el guard en el envoltorio, **una
// ruta de escritura nueva nace respetando el contrato sin que su autor lo
// sepa.**
//
// ── Por qué 423 y no 403 ni 409 ─────────────────────────────────────
//
// 423 Locked dice exactamente lo que pasa: el recurso existe, tienes
// permiso, y está bloqueado por un estado que se puede cambiar. Un 403
// diría «no tienes permiso» —y la podóloga lo tiene— y un 409 diría que
// hay un conflicto con lo que mandó, y no lo hay: lo que mandó está bien.
//
// ── Y el orden: LA LÍNEA DEL REGISTRO PRIMERO ───────────────────────
//
// El 423 se comprueba DESPUÉS de apuntar el acceso, no antes. Un intento
// de escribir con el contrato revocado es justo uno de los que interesa
// ver en el registro — igual que los denegados por falta de acceso, que
// clinica-1 decidió apuntar por lo mismo. Se apunta con el `outcome` que
// le corresponde: `DENIED`, porque el acto no ocurrió.
//
// ── Lo que el 423 NO toca ───────────────────────────────────────────
//
// `READ` y `EXPORT`. Leer y exportar siguen funcionando con el contrato
// revocado, y es deliberado: lo que hay en la historia se escribió con el
// contrato aceptado, y además la Ley 41/2002 obliga a la clínica a
// conservarla cinco años y a dársela al paciente que la pida. Apagar la
// lectura al revocar convertiría una revocación administrativa en una
// infracción sanitaria.

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
  // residencia-3 · LA TERCERA PUERTA: la tablet de una habitación con
  // alguien dentro.
  //
  // Va aquí y no en un segundo envoltorio, y es la decisión de esta
  // línea: `conHistoria` es **el** punto por el que pasa toda ruta
  // clínica de la casa, y la puerta es la pantalla que de verdad abre
  // historias — quince tablets a la vez, 49 residentes, cada turno. Un
  // `conHistoriaDeLaPuerta` paralelo habría sido un segundo sitio donde
  // decidir qué se apunta, y el registro de accesos sólo sirve si lo
  // escribe uno.
  //
  // `GET /residencia/puerta/me` (residencia-1) NO pasa por aquí y sigue
  // sin pasar: su identidad es el DISPOSITIVO y no una persona, y una
  // línea sin persona no contesta «¿quién ha abierto la historia de mi
  // madre?» (decisión 3 de residencia-1). Lo que pasa por aquí es lo que
  // hay DETRÁS del PIN, que es la pantalla que sí identifica a alguien.
  if (request.puertaSesion) {
    return {
      userId: request.puertaSesion.userId,
      tenantId: request.puertaSesion.tid,
      deviceId: request.puertaSesion.did,
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
  // residencia-1 · 403 las dos, como `SIN_ACCESO_AL_PACIENTE`: el
  // residente existe y es de este centro, lo que falta es el permiso. No
  // son 404 —esconder el residente no protege nada que el gate del módulo
  // no esconda ya— y el mensaje dice dónde se arregla.
  //
  // `Record` exhaustivo y no un `?? 403`: el typecheck obligó a venir
  // aquí al añadir los motivos, que es exactamente lo que se quiere. Un
  // motivo nuevo sin HTTP pensado no compila.
  SIN_ROL_DE_CUIDADO: 403,
  RESIDENTE_FUERA_DE_TU_ZONA: 403,
};

export interface ContextoClinico {
  tenantId: string;
  userId: string;
  clientId: string;
  deviceId: string | null;
  veredicto: Veredicto;
}

/**
 * QUÉ hace falta para pasar. Dos predicados, UN solo punto de registro.
 *
 * `SANITARIO` es lo de clinica-1 y el caso normal: la función de acceso
 * decide (clínica encendida, es sanitario, alcanza a este paciente).
 *
 * `PERSONAL_DEL_CENTRO` lo añade clinica-2 para los dos actos que **la
 * recepcionista sí puede hacer** (decisión de producto 6): mandarle el
 * test al paciente y abrirle la tablet. Ninguno de los dos enseña una
 * respuesta, así que exigir acceso clínico sería negar un trabajo de
 * mostrador; pero los dos ESCRIBEN en la historia (crean la valoración),
 * así que los dos tienen que dejar línea.
 *
 * Y de ahí la forma que tiene esto: **el predicado cambia, la escritura
 * de la línea no.** La alternativa era llamar a `apuntarAcceso` desde la
 * ruta de enviar, y eso habría roto lo único que hace que el registro sea
 * de fiar — que lo escribe un solo sitio. Con tres rutas se nota poco;
 * con quince, el día que alguien añada la decimosexta sin acordarse, la
 * historia se escribe sin dejar rastro.
 */
export type PermisoClinico = "SANITARIO" | "PERSONAL_DEL_CENTRO";

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
  input: {
    clientId: string;
    action: AccionClinica;
    /** Por defecto `SANITARIO`: quien no lo diga, pasa por la función de
     *  acceso. Un olvido cae del lado restrictivo. */
    permiso?: PermisoClinico;
  },
  handler: (ctx: ContextoClinico) => Promise<T>,
): Promise<T | undefined> {
  // clinica-7 · decisión 24 · MI PIACE NO MIRA, y aquí otra vez.
  //
  // `ensureClinicaEnabled` ya lo corta en las rutas que lo llevan de
  // `preHandler`. Esto es defensa en profundidad en el ÚNICO punto por el
  // que pasa toda ruta clínica: una ruta nueva que se registrara sin el
  // gate (como pasó con las del contrato, que no pueden llevarlo) seguiría
  // sin dejar que Mi Piace abra una historia.
  //
  // Y NO se apunta en el registro de accesos, a propósito. El registro
  // contesta «¿quién ha abierto la historia de este paciente?» y su
  // `user_id` es NOT NULL: una línea aquí tendría que decir «la dueña» —
  // porque el token de impersonación lleva el id de la dueña— y eso sería
  // una línea FALSA en el registro que existe para no tener líneas falsas.
  // Lo que queda es el `super_admin_audit`, que es donde una acción del
  // superadmin tiene que constar.
  if (esMiPiaceMirando(request)) {
    request.log.warn(
      { event: "clinica_impersonacion_rechazada", route: rutaDe(request) },
      "una sesión de impersonación ha intentado abrir una historia clínica",
    );
    respondeComoRutaInexistente(request, reply);
    return undefined;
  }

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

  // ¿Pasa? Con `PERSONAL_DEL_CENTRO`, sí: ya pasó las puertas de la ruta
  // (autenticado, de este tenant, con el módulo encendido) y lo que va a
  // hacer no enseña ninguna respuesta.
  const permiso = input.permiso ?? "SANITARIO";
  const pasa = permiso === "PERSONAL_DEL_CENTRO" || veredicto.puede;

  // LA LÍNEA, ANTES DE TODO. Si no se puede escribir, no se pasa.
  //
  // El `outcome` dice si ESTE acto se permitió, no qué opinaba la función
  // de acceso: una línea DENIED sobre un envío que sí ocurrió sería una
  // línea falsa, y un registro con líneas falsas no sirve para lo que
  // existe.
  try {
    await apuntarAcceso({
      tenantId: actor.tenantId,
      userId: actor.userId,
      clientId: input.clientId,
      action: input.action,
      outcome: pasa ? "ALLOWED" : "DENIED",
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

  if (!pasa) {
    // `pasa` sólo es falso cuando el permiso es `SANITARIO`, así que aquí
    // el veredicto SIEMPRE trae motivo. El `if` es para el typecheck.
    if (veredicto.puede) return handler(ctxDe(actor, input.clientId, veredicto));
    const status = HTTP_DEL_MOTIVO[veredicto.motivo];
    if (status === 404) {
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

  // clinica-7 · EL CONTRATO. Ver la cabecera: va después de la línea del
  // registro (un intento con el contrato revocado es de los que interesa
  // ver) y antes del handler.
  //
  // **Y mira la LECTURA además de la escritura**, que es lo que un test
  // encontró: con el contrato nunca aceptado, la decisión 4 dice «ni una
  // ruta clínica responde con datos». Un guard que solo mirara las
  // escrituras habría servido la historia entera de una clínica recién
  // encendida antes de que nadie aceptara nada.
  //
  // Qué cuenta como escritura: `WRITE` y nada más. `EXPORT` es una lectura
  // que se lleva una copia, y tiene que seguir funcionando con el contrato
  // revocado — es la devolución de datos del art. 28.3.g, y se pide
  // justamente cuando se revoca.
  const negativa = await negativaClinica(
    actor.tenantId,
    input.action === "WRITE" ? "ESCRIBIR" : "LEER",
  );
  if (negativa) {
    try {
      await apuntarAcceso({
        tenantId: actor.tenantId,
        userId: actor.userId,
        clientId: input.clientId,
        action: input.action,
        // DENIED porque el acto NO ocurrió. Una línea ALLOWED sobre algo
        // que se rechazó sería una línea falsa, y un registro con líneas
        // falsas no sirve para lo que existe.
        outcome: "DENIED",
        deviceId: actor.deviceId,
        route: rutaDe(request),
      });
    } catch (err) {
      request.log.error(
        { event: "clinical_access_log_failed", err },
        "no se pudo registrar el intento con el contrato no vigente",
      );
    }
    reply.code(423).send({
      error: negativa.code,
      code: negativa.code,
      message: negativa.message,
    });
    return undefined;
  }

  return handler(ctxDe(actor, input.clientId, veredicto));
}

function ctxDe(
  actor: Actor,
  clientId: string,
  veredicto: Veredicto,
): ContextoClinico {
  return {
    tenantId: actor.tenantId,
    userId: actor.userId,
    clientId,
    deviceId: actor.deviceId,
    veredicto,
  };
}
