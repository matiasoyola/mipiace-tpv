// clinica-2 · el enlace del test, siguiendo el patrón probado del PDF
// público del ticket (`tickets/public-pdf-route.ts`) y endureciéndolo
// donde el dato lo pide.
//
// ── Lo que se copia del patrón del ticket ─────────────────────────────
//
//   · La URL ES la credencial: no hay sesión, no hay contraseña. Decisión
//     de producto 4, «sin contraseñas»: un paciente de 78 años no va a
//     crear una cuenta para contestar diez preguntas, y pedírsela
//     significa que no contesta.
//   · Un formato fijo que se comprueba ANTES de ir a la base, para
//     contestar 404 rápido al 99% de los intentos que no son de nadie.
//   · La misma 404 para «no existe», «caducado» y «ya usado»: tres
//     respuestas distintas le dicen a un escáner que el token existía.
//
// ── Y lo que se endurece, con su razón ────────────────────────────────
//
//   1. **El token NO se guarda.** Se guarda su SHA-256. El slug del
//      ticket vive en claro en `tickets.public_slug` y está bien: abre un
//      PDF que su dueño ya tiene en el bolsillo. Esto abre el formulario
//      de salud de una persona. Con el hash, una copia de la base —un
//      backup, un volcado, un `SELECT` de alguien con acceso al VPS— no
//      abre ni un enlace.
//   2. **256 bits y no 64.** El slug del ticket son 16 hex (64 bits), que
//      sobran para lo que protege. Aquí el espacio es 2^256: no hay
//      fuerza bruta que valga ni con el rate-limit apagado.
//   3. **Caduca.** 30 días por email, 4 horas en la tablet de la sala (ver
//      los dos números más abajo).
//   4. **De un solo uso.** Al contestar se sella (`link_used_at`) y el
//      trigger de la base impide reabrirlo con un UPDATE.
//
// ── Un solo mecanismo para las dos puertas ────────────────────────────
//
// El token de la tablet es EL MISMO que el del email, con otra caducidad.
// Es la mitad del «un solo test, dos puertas» que pide el prompt: con un
// mecanismo por canal habría dos rutas públicas, dos formas de caducar y
// dos sitios donde equivocarse. Y de paso sale gratis lo que hacía falta
// de todos modos — **abrir la tablet invalida el enlace del email**,
// porque rotar el token deja el hash anterior sin nada contra lo que
// buscar.
//
// ── El rate-limit va por IP, tras el proxy ────────────────────────────
//
// `server.ts` arranca Fastify con `trustProxy: 1`, así que `request.ip` es
// el último salto del `X-Forwarded-For` que añade Caddy y no la IP del
// contenedor. Sin eso, todas las peticiones compartirían una sola clave y
// el límite caería sobre todos los pacientes a la vez.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import type { RateLimitConfig } from "../auth/rate-limit.js";

/** 32 bytes = 256 bits, en base64url (43 caracteres, sin relleno). */
const BYTES_DEL_TOKEN = 32;

/** El formato que se comprueba antes de tocar la base. */
export const PATRON_TOKEN = /^[A-Za-z0-9_-]{43}$/;

// Cuánto vive un enlace sin usar, según por dónde se le ofrece. Son dos
// números porque son dos situaciones, no por configurabilidad:
//
//   · EMAIL · 30 días. Una cita que se da para dentro de tres semanas
//     necesita el enlace vivo cuando el paciente lo abra; uno de hace un
//     año, no.
//   · TABLET · 4 horas. El paciente lo contesta ahí mismo, en la sala, con
//     la tablet en la mano. Cuatro horas cubren una mañana entera de
//     consulta con margen, y pasado eso el token que quedó en una tablet
//     que alguien se llevó a casa ya no abre nada.
export const DIAS_DE_VIDA_DEL_ENLACE = 30;
export const HORAS_DE_VIDA_EN_TABLET = 4;

function vidaEnMs(canal: "EMAIL" | "TABLET"): number {
  return canal === "EMAIL"
    ? DIAS_DE_VIDA_DEL_ENLACE * 24 * 60 * 60 * 1000
    : HORAS_DE_VIDA_EN_TABLET * 60 * 60 * 1000;
}

export interface TokenNuevo {
  /** El token en claro. Existe SÓLO aquí, en el email y en la URL del
   *  paciente. No se escribe en la base, ni en un log, ni en Sentry. */
  token: string;
  /** Lo que sí se guarda. */
  hash: string;
  expiraEn: Date;
}

/**
 * Un token nuevo y su hash.
 *
 * **El mismo token sirve para el email y para la tablet**, y eso es la
 * mitad del «un solo test, dos puertas» del prompt: con un mecanismo
 * distinto por canal habría dos rutas públicas, dos formas de caducar y
 * dos sitios donde equivocarse. Lo único que cambia es cuánto vive.
 *
 * `ahora` entra como parámetro para que el test pueda fijar la caducidad
 * sin tocar el reloj del proceso.
 */
export function nuevoTokenDeEnlace(
  canal: "EMAIL" | "TABLET" = "EMAIL",
  ahora = new Date(),
): TokenNuevo {
  const token = randomBytes(BYTES_DEL_TOKEN).toString("base64url");
  const expiraEn = new Date(ahora.getTime() + vidaEnMs(canal));
  return { token, hash: hashDeToken(token), expiraEn };
}

/** SHA-256 en hex. Sin sal y sin KDF a propósito: el token son 256 bits
 *  aleatorios, así que no hay diccionario que precomputar — lo que una sal
 *  defiende (contraseñas con entropía humana) aquí no existe, y un KDF
 *  lento sólo encarecería la lectura legítima. */
export function hashDeToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Compara dos hashes en tiempo constante.
 *
 * La búsqueda normal es por índice único sobre el hash, así que esto no
 * está en el camino caliente: existe para la comprobación de refuerzo que
 * hace la ruta pública después de cargar la fila. Es barato y quita de
 * encima la pregunta.
 */
export function mismoHash(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** La URL que viaja en el email. La pinta la PWA del TPV: el test ES una
 *  pantalla, y es LA MISMA que la de la tablet de la sala. */
export function urlDelEnlace(baseTpvUrl: string, token: string): string {
  return `${baseTpvUrl.replace(/\/+$/, "")}/valoracion/${token}`;
}

/**
 * ¿Sigue vivo este enlace?
 *
 * Las tres negativas se devuelven con su nombre para el LOG, no para el
 * cliente: la ruta pública contesta la misma 404 en los tres casos (ver la
 * cabecera). Distinguirlas aquí es lo que permite que el log diga «caducó»
 * en vez de «no existe», que es la diferencia entre poder ayudar a un
 * paciente que llama y no poder.
 */
export type EstadoDelEnlace =
  | { vivo: true }
  | { vivo: false; motivo: "NO_EXISTE" | "CADUCADO" | "YA_USADO" };

export function estadoDelEnlace(
  fila:
    | {
        linkExpiresAt: Date | null;
        linkUsedAt: Date | null;
        status: "PENDIENTE_PACIENTE" | "RESPONDIDA" | "VALIDADA";
      }
    | null,
  ahora = new Date(),
): EstadoDelEnlace {
  if (!fila) return { vivo: false, motivo: "NO_EXISTE" };
  if (fila.linkUsedAt != null) return { vivo: false, motivo: "YA_USADO" };
  // El estado y el sello van de la mano, y se comprueban los dos: si por
  // cualquier camino quedara una valoración RESPONDIDA sin sellar, el
  // enlace tampoco tiene que abrir. Lo que no se puede es que contestar
  // dos veces sea posible.
  if (fila.status !== "PENDIENTE_PACIENTE") {
    return { vivo: false, motivo: "YA_USADO" };
  }
  if (fila.linkExpiresAt == null || fila.linkExpiresAt.getTime() <= ahora.getTime()) {
    return { vivo: false, motivo: "CADUCADO" };
  }
  return { vivo: true };
}

// ── El rate-limit de la ruta pública ──────────────────────────────────
//
// Umbrales propios, por la misma lógica que la descarga de la APK: no son
// los del login porque lo que se protege no es lo mismo. 30 intentos por
// hora y candado de una hora.
//
// Y cuentan los intentos que NO encuentran token, que es lo que hace que
// probar el espacio no salga gratis. Un paciente legítimo abre su enlace
// una vez (dos si recarga): nunca se acerca al límite.
export const VALORACION_MAX_INTENTOS = 30;
export const VALORACION_VENTANA_SEGUNDOS = 60 * 60;
export const VALORACION_CANDADO_SEGUNDOS = 60 * 60;

export const rateLimitDelEnlace = (ip: string): RateLimitConfig => ({
  attemptsKey: `valoracion-enlace-intentos:${ip}`,
  lockKey: `valoracion-enlace-bloqueado:${ip}`,
  maxAttempts: VALORACION_MAX_INTENTOS,
  attemptTtlSeconds: VALORACION_VENTANA_SEGUNDOS,
  lockTtlSeconds: VALORACION_CANDADO_SEGUNDOS,
});
