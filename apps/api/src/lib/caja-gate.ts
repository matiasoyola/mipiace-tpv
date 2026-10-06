// H1 · la puerta de la caja (ADR-016).
//
// Mismo patrón que `ensureAgendaEnabled` (ADR-R6): un `preHandler` que
// corre DESPUÉS de la autenticación, lee la capability del tenant y
// devuelve 403 con un error nombrado si está apagada.
//
//   app.post("/shift/open", {
//     preHandler: [requireCashierSession, ensureCajaEnabled],
//   }, handler)
//
// Diferencias con el gate de la agenda, las dos deliberadas:
//
//   1. Resuelve el tenant desde las TRES puertas de auth que existen
//      (`request.auth` del panel, `request.cashier` y `request.device`
//      del TPV), porque la caja se cruza desde las tres. La agenda sólo
//      se cruza desde `auth`.
//
//   2. Compara con `=== false`, no con `!`. `caja_enabled` es
//      `@default(true)`: sólo un `false` explícito apaga la caja. Si la
//      fila no se puede leer —no existe, o el cliente Prisma en uso no
//      expone el modelo `tenant`— la caja queda ENCENDIDA.
//
//      Esa dirección del fallo es la correcta: esto es una *capability*,
//      no la frontera de aislamiento. El aislamiento por tenant lo hacen
//      `requireCashierSession`, `requireDeviceToken` y `requireOwner`, y
//      ninguno depende de esta función. Fallar hacia "apagado" dejaría
//      sin cobrar a un cliente que cobra, que es lo peor que este bloque
//      puede romper; fallar hacia "encendido" deja exactamente el
//      comportamiento de master.
//
// El gate es la puerta del SERVIDOR. El TPV y el panel además esconden
// lo que no aplica, pero esconder no es gatear: el flag que cachea el
// TPV es UI, y un catálogo cacheado no abre esta puerta.
//
// ── clinica-1 · y la segunda pregunta que contesta esta puerta ────────
//
// «¿Tiene ESTE USUARIO caja?» El sanitario sin caja (`UserRole.CLINICIAN`)
// entra al TPV como un cajero —email y PIN— porque su agenda vive ahí, y
// a partir de ese momento no puede nacer de él ni un cobro, ni un turno,
// ni una apertura de cajón, ni un informe Z.
//
// La negativa va AQUÍ y no en cada ruta por una razón de cuentas: hay
// las 103 rutas con `ensureCajaEnabled` en el `preHandler` repartidas
// por tickets, turno, mesas, fiscal, fiado, impresión y catálogo del TPV.
// Cien sitios donde acordarse son cien sitios donde olvidarse, y el
// olvido aquí es un cobro firmado por quien no cobra. Este par de líneas
// los cubre todos de golpe, y cubre también el que escriba alguien
// mañana: si lleva el gate de la caja, lleva esto.
//
// Las dos rutas que NO llevan el gate de la caja siguen sin llevarlo, y
// las dos están bien así:
//
//   · `POST /shift/cashier-login` SÍ lo lleva, pero cuando corre todavía
//     no hay sesión ni rol que mirar (sólo el device token), así que el
//     sanitario entra. Es lo que tiene que pasar.
//   · `POST /shift/cashier-logout` no lo lleva a propósito desde H1
//     (cerrar sesión tiene que funcionar siempre). El sanitario sale.
//   · `GET /tpv/catalog/products` tampoco, también desde antes. Leer el
//     catálogo no es cobrar, y la agenda necesita los servicios.
//
// Lo que esto NO es: esconder botones. El TPV además no pinta la pantalla
// de venta a un sanitario, pero eso es UI; la frontera está aquí.

import type { FastifyReply, FastifyRequest } from "fastify";

import { getPrisma } from "../context.js";

export const CAJA_DISABLED_MESSAGE =
  "Esta empresa no tiene el módulo de caja activado. Si crees que debería tenerlo, avisa a Mi Piace.";

export const CLINICIAN_NO_CAJA_MESSAGE =
  "El personal sanitario no tiene acceso a la caja. Para cobrar, entra con un usuario de caja.";

// Las tres puertas de auth, en el orden en que se pueblan. Devuelve null
// cuando ninguna ha corrido todavía: en ese caso no hay nada que gatear
// y el `preHandler` de auth que va delante ya habrá respondido 401.
function resolveTenantId(request: FastifyRequest): string | null {
  return (
    request.auth?.tenantId ??
    request.cashier?.tid ??
    request.device?.tenantId ??
    null
  );
}

/**
 * `true` sólo cuando la fila del tenant dice explícitamente que la caja
 * está apagada. Ver la nota 2 de la cabecera sobre por qué el default es
 * "encendida".
 *
 * La lectura es tolerante a propósito, y es la otra cara de la nota 2:
 * **esta función no puede ser nunca la razón por la que un request
 * revienta**. Si el modelo `tenant` no está disponible, o la lectura
 * lanza, la caja queda encendida y el handler sigue su camino — el
 * mismo comportamiento que master. Un gate de capability que tumba una
 * venta con un 500 es peor que un gate que no llega a cerrarse.
 */
export async function cajaIsDisabled(tenantId: string): Promise<boolean> {
  const model = getPrisma().tenant as
    | {
        findUnique?: (args: unknown) => Promise<{ cajaEnabled?: boolean } | null>;
        findUniqueOrThrow?: (args: unknown) => Promise<{ cajaEnabled?: boolean }>;
      }
    | undefined;
  const read = model?.findUnique ?? model?.findUniqueOrThrow;
  if (typeof read !== "function") return false;
  try {
    const tenant = await read.call(model, {
      where: { id: tenantId },
      select: { cajaEnabled: true },
    });
    return tenant?.cajaEnabled === false;
  } catch {
    return false;
  }
}

/** El actor de esta petición, de las dos puertas que llevan rol. */
function resolveActor(
  request: FastifyRequest,
): { userId: string; role: string } | null {
  if (request.cashier) {
    return { userId: request.cashier.userId, role: request.cashier.role };
  }
  if (request.auth) {
    return { userId: request.auth.userId, role: request.auth.role };
  }
  // Ni sesión de TPV ni token de panel: sólo device, o nada. Un device
  // token por sí solo no llega a una ruta de cobro sin sesión detrás.
  return null;
}

/**
 * clinica-1 · ¿el actor de esta petición es un sanitario sin caja?
 *
 * Dos comprobaciones, y hacen falta las dos:
 *
 *   1. **El rol del JWT.** Sin I/O, así que no puede fallar. Cubre a
 *      cualquiera que fuera sanitario cuando entró — o sea, a todos los
 *      sanitarios reales: su token dice `CLINICIAN` desde el login.
 *
 *   2. **El rol en la base.** Cierra la VENTANA DE TRANSICIÓN, que es un
 *      agujero real y no una hipótesis: la sesión del TPV vive el turno
 *      entero (`cashierSessionTtlMinutes`, por defecto 12 h) y su JWT NO
 *      lleva `tokenVersion`, así que incrementarlo al cambiarle el rol
 *      —como hace `PATCH /staff/:id/clinica`— invalida los tokens del
 *      panel y NO el del TPV. Sin esta segunda comprobación, una cajera
 *      que pasa a sanitaria seguiría pudiendo cobrar hasta medio día con
 *      el token que dice `CASHIER`, y «ningún cobro nace de un
 *      CLINICIAN» dejaría de ser verdad justo el día de la implantación,
 *      que es el día en que se cambian los roles.
 *
 * La lectura **falla hacia ENCENDIDO**, igual que `cajaIsDisabled` y por
 * la misma razón de la casa: una lectura que revienta no puede ser el
 * motivo de que una venta no se cobre. Lo que se pierde al fallar es
 * exactamente la ventana que ya existía; lo que NO se pierde nunca es la
 * comprobación 1, que no depende de nada.
 *
 * Y el coste: una lectura por PK en las rutas que ya hacían una (la del
 * tenant, dos líneas más abajo). Se evita cuando el JWT ya basta para
 * decidir.
 */
export async function esSanitarioSinCaja(
  request: FastifyRequest,
): Promise<boolean> {
  const actor = resolveActor(request);
  if (!actor) return false;
  // 1 · el JWT. Si ya lo dice, no hace falta preguntar nada.
  if (actor.role === "CLINICIAN") return true;
  // Un OWNER o un MANAGER no se vuelve `CLINICIAN`: el PATCH de la
  // pantalla de personal sólo cambia el puesto entre CASHIER y CLINICIAN.
  // Así la consulta extra se la comen las sesiones de cajero y no las de
  // la propietaria, que son las que cobran todo el día en el piloto.
  if (actor.role !== "CASHIER") return false;
  // 2 · la base, para la ventana de transición.
  const model = getPrisma().user as
    | {
        findUnique?: (args: unknown) => Promise<{ role?: string } | null>;
      }
    | undefined;
  if (typeof model?.findUnique !== "function") return false;
  try {
    const row = await model.findUnique({
      where: { id: actor.userId },
      select: { role: true },
    });
    return row?.role === "CLINICIAN";
  } catch {
    return false;
  }
}

/**
 * clinica-3 · **sólo** la mitad del usuario: rechaza a un sanitario sin
 * caja y NO mira la capability de la caja del tenant.
 *
 * Para qué existe: hay dos rutas de AGENDA que son de dinero y que por eso
 * no llevan el gate de la caja —`POST /agenda/appointments/:id/checkout`,
 * que abre el borrador pre-poblado, y `GET /agenda/cobros-pendientes`, que
 * es la lista con precios de la recepción. Un `CLINICIAN` llega a las dos,
 * y en las dos recibiría importes: exactamente lo que la regla 8 del
 * bloque prohíbe (*el sanitario sin caja no ve importes en ninguna parte*,
 * y comprobado en la API).
 *
 * ── Por qué no `ensureCajaEnabled` entero ────────────────────────────
 *
 * Porque añadirlo cambiaría el comportamiento de un tenant con la agenda
 * encendida y la caja apagada: hoy esas dos rutas le funcionan, y con el
 * gate completo dejarían de funcionar. No hay ninguno así todavía (duda 5
 * de clinica-1 lo deja apuntado), pero el prompt de este bloque es
 * explícito: *el camino de cobro de una cita que no es clínica no cambia
 * ni una línea de comportamiento.* Esta función sólo rechaza a un
 * `CLINICIAN`, y `CLINICIAN` es un rol que no existía antes de clinica-1 —
 * así que **ningún tenant de hoy cambia de comportamiento, ni uno**.
 *
 * El mensaje y el código son los mismos que los de `ensureCajaEnabled`
 * para este caso: desde fuera es la misma negativa, porque lo es.
 */
export async function ensureNoEsSanitarioSinCaja(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (await esSanitarioSinCaja(request)) {
    reply.code(403).send({
      error: "CLINICIAN_NO_CAJA",
      code: "CLINICIAN_NO_CAJA",
      message: CLINICIAN_NO_CAJA_MESSAGE,
    });
  }
}

export async function ensureCajaEnabled(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // El usuario, ANTES del tenant. Un sanitario de una empresa con caja
  // encendida es el caso que importa, y preguntar primero por el tenant
  // lo dejaría pasar.
  if (await esSanitarioSinCaja(request)) {
    reply.code(403).send({
      error: "CLINICIAN_NO_CAJA",
      code: "CLINICIAN_NO_CAJA",
      message: CLINICIAN_NO_CAJA_MESSAGE,
    });
    return;
  }
  const tenantId = resolveTenantId(request);
  if (!tenantId) return;
  if (await cajaIsDisabled(tenantId)) {
    reply.code(403).send({
      error: "CAJA_DISABLED",
      message: CAJA_DISABLED_MESSAGE,
    });
  }
}
