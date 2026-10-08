// enlaces-publicos · DOS LÍMITES DE PETICIONES, NO UNO.
//
// Decisión S1.4 (07-10), con el número que RT midió: además del límite
// general, un tope de **tokens inexistentes por IP** (10/min), que es lo
// que para a quien prueba enlaces al azar.
//
// ── Por qué hacen falta los dos ──────────────────────────────────────
//
// El general que clinica-2 ya tenía es de ventana larga: 30 intentos
// fallidos por hora y candado de una hora. Acota el TOTAL, y está bien
// para eso, pero deja pasar una ráfaga de 29 intentos en dos segundos
// antes de enterarse. El de tokens inexistentes es de ventana corta: la
// undécima petición de la misma IP en un minuto contra un token que no
// existe se corta.
//
// Un paciente legítimo no toca ninguno de los dos: abre su enlace una vez
// (dos si recarga) y su token SÍ existe.
//
// ── Y van por IP, tras el proxy ──────────────────────────────────────
//
// `server.ts` arranca Fastify con `trustProxy: 1`, así que `request.ip` es
// el último salto del `X-Forwarded-For` que añade Caddy y no la IP del
// contenedor. Sin eso, todas las peticiones compartirían una sola clave y
// el límite caería sobre todos los pacientes a la vez.
//
// ── La excepción del equipo: el general por TOKEN ────────────────────
//
// Para los `purpose` del equipo (capacidades, B9) el general va por
// token y no por IP, porque **todas contestan desde el wifi del centro** y
// por IP serían un solo atacante. Lo declara el `purpose`
// (`limitePor: "TOKEN"`), y la clave es la HUELLA del token: lo que se
// mete en Redis no abre nada.
//
// **El de tokens inexistentes NO es configurable y va siempre por IP.** Un
// token que no existe no tiene identidad contra la que contar: por token
// le daría a un escáner un cubo nuevo por intento, que es ningún límite.

import type { RateLimitConfig } from "../auth/rate-limit.js";
import { throttle, type ThrottleState } from "../auth/rate-limit.js";
import type { ReglasDePurpose } from "./reglas.js";

// ── 1 · el general ────────────────────────────────────────────────────
//
// Umbrales propios, por la misma lógica que la descarga de la APK: no son
// los del login porque lo que se protege no es lo mismo. 30 intentos por
// hora y candado de una hora, que son los que clinica-2 eligió y que aquí
// se conservan tal cual — el enlace de la valoración no cambia de
// comportamiento al mudarse a la puerta común.
export const MAX_INTENTOS = 30;
export const VENTANA_SEGUNDOS = 60 * 60;
export const CANDADO_SEGUNDOS = 60 * 60;

/**
 * El cubo general del `purpose`.
 *
 * `quien` es la IP (lo normal) o la huella del token (los `purpose` del
 * equipo). El `purpose` entra en la clave para que un escáner que gasta el
 * cubo de la valoración no deje a nadie fuera de «mi cita»: son puertas
 * distintas y lo que pase en una no cierra la otra.
 */
export function limiteGeneral(
  reglas: ReglasDePurpose<never>,
  quien: string,
): RateLimitConfig {
  return {
    attemptsKey: `enlace-intentos:${reglas.purpose}:${quien}`,
    lockKey: `enlace-bloqueado:${reglas.purpose}:${quien}`,
    maxAttempts: MAX_INTENTOS,
    attemptTtlSeconds: VENTANA_SEGUNDOS,
    lockTtlSeconds: CANDADO_SEGUNDOS,
  };
}

// ── 2 · los tokens inexistentes ───────────────────────────────────────
//
// 10 por minuto y por IP, el número de RT. Cuenta SÓLO los tokens que no
// resuelven a ninguna fila (y los que ni tienen la forma de un token):
//
//   · Un enlace CADUCADO, GASTADO o ANULADO **no cuenta aquí.** El
//     paciente mayor que recarga quince veces la pantalla de «este enlace
//     ya no sirve» no es un escáner, y bloquearle sería castigar al único
//     que de verdad quería contestar. Su token existió; lo que le pasa es
//     otra cosa, y para el total ya está el cubo general.
//   · Lo que cuenta es el intento contra un token QUE NO ES DE NADIE, que
//     es la forma que tiene probar el espacio.
export const MAX_INEXISTENTES = 10;
export const VENTANA_INEXISTENTES_SEGUNDOS = 60;

/** La clave es sólo la IP: el cubo es de «esta IP probando enlaces», no de
 *  un `purpose` — quien prueba al azar no sabe para qué sirve el token que
 *  está inventando. */
export function claveDeInexistentes(ip: string): string {
  return `enlace-inexistentes:${ip}`;
}

/**
 * Cuenta un intento contra un token que no existe y dice si hay que
 * cortar.
 *
 * `exceeded` en la petición **número 11** dentro del minuto: `throttle`
 * devuelve `count > limit`, así que las diez primeras pasan (y contestan
 * la 404 de siempre) y la undécima recibe el 429.
 */
export async function contarTokenInexistente(
  ip: string,
): Promise<ThrottleState> {
  return throttle(
    claveDeInexistentes(ip),
    MAX_INEXISTENTES,
    VENTANA_INEXISTENTES_SEGUNDOS,
  );
}
